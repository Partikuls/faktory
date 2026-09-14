import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline/promises";
import type { FaktoryConfig } from "./config.js";
import { composeDown, type SiteContext } from "./docker.js";
import { STAGES, readState, writeState, setStage, firstIncompleteStage, awaitingStage, type SiteState, type StageName } from "./state.js";
import { siteDir } from "./workspace.js";
import { ARTIFACTS, PAGES_DIR, artifactPath, hasArtifact, isStale, type ArtifactKey } from "./artifacts.js";
import { ARTICLES_DIR } from "./schemas/article.js";
import { RESYNC_TARGETS } from "./resync.js";
import { assertBudget } from "./budget.js";
import { provisionStage } from "./stages/provision.js";
import { specStage } from "./stages/spec.js";
import { designStage } from "./stages/design.js";
import { pagesStage } from "./stages/pages.js";
import { pluginsStage } from "./stages/plugins.js";
import { contentStage } from "./stages/content.js";
import { qaStage } from "./stages/qa.js";
import { exportStage } from "./stages/export.js";
import { appendRun, faktoryVersion, type RunRecord } from "./history.js";

export { assertBudget };

export interface Stage {
  name: StageName;
  checkpoint?: boolean;
  run(ctx: SiteContext): Promise<string | void>;
  /** Runs at `faktory approve` for checkpoint stages (e.g. re-sync JSON from an edited markdown). Throwing keeps the stage awaiting approval. */
  onApprove?(ctx: SiteContext): Promise<string | void>;
}

export const registry: Partial<Record<StageName, Stage>> = { spec: specStage, design: designStage, provision: provisionStage, pages: pagesStage, plugins: pluginsStage, content: contentStage, qa: qaStage, export: exportStage };

export const deps = {
  composeDown,
  isInteractive: (): boolean => process.stdin.isTTY === true,
  confirm: async (question: string): Promise<boolean> => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { return (await rl.question(question)).trim().toLowerCase() === "y"; } finally { rl.close(); }
  },
};

/** What a regeneration of a checkpoint stage overwrites; the first key is the hand-edited markdown that triggers the confirmation. */
export const REGENERATED: Partial<Record<StageName, ArtifactKey[]>> = {
  spec: ["siteSpecMd", "siteSpecJson"],
  design: ["designSystemMd", "designTokensJson", "previewHtml", "previewTree", "previewMarkup"],
};

const hasFiles = (dir: string, suffix: string): boolean => existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(suffix));

/** The warning shown before `--from/--only <checkpoint>` overwrites hand edits; undefined when nothing would be overwritten. */
export function regenerationNotice(ctx: SiteContext, stage: StageName): string | undefined {
  const keys = REGENERATED[stage];
  if (!keys || !hasArtifact(ctx, keys[0])) return undefined;
  const files = keys.filter((k) => existsSync(artifactPath(ctx, k))).map((k) => ARTIFACTS[k]);
  const later = STAGES.slice(STAGES.indexOf(stage) + 1);
  const kept = [
    ...(hasFiles(join(ctx.siteDir, PAGES_DIR), ".gb.json") ? ["pages/*.gb.json"] : []),
    ...(hasFiles(join(ctx.siteDir, ARTICLES_DIR), ".json") ? ["content/articles/*.json"] : []),
  ];
  return [
    `⚠ Régénérer ${stage} écrase : ${files.join(", ")}`,
    `  Les étapes suivantes repasseront en attente : ${later.join(", ")}`,
    ...(kept.length ? [`  Conservés et réutilisés par leurs étapes : ${kept.join(", ")} — supprimez-les pour tout reconstruire`] : []),
  ].join("\n");
}

export function loadContext(config: FaktoryConfig, slug: string): SiteContext {
  const dir = siteDir(config, slug);
  if (!existsSync(dir)) throw new Error(`Unknown site "${slug}" (expected ${dir})`);
  return { config, slug, siteDir: dir, state: readState(dir) };
}

function persist(ctx: SiteContext, next: SiteState): SiteState {
  ctx.state = next;
  writeState(ctx.siteDir, next);
  return next;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export type Recorder = (event: Omit<RunRecord, "runId" | "faktory" | "options">) => void;

/** One recorder per CLI call: every event it writes shares the call's run id, Faktory commit and options. */
export function recorder(ctx: SiteContext, opts: { from?: StageName; only?: StageName; yes?: boolean }): Recorder {
  const runId = new Date().toISOString();
  const faktory = faktoryVersion(ctx.config.repoRoot);
  const options = { from: opts.from ?? null, only: opts.only ?? null, yes: !!opts.yes, maxCostUsd: ctx.config.maxCostUsd };
  return (event) => appendRun(ctx.siteDir, { runId, faktory, options, ...event });
}

type StageMap = Partial<Record<StageName, Stage>>;

/** Approve the awaiting checkpoint `name`: its onApprove (re-sync, brief gaps warning), the re-sync cost charged to the stage, the run's duration kept. */
export async function approveStage(ctx: SiteContext, name: StageName, stages: StageMap, record: Recorder): Promise<SiteState> {
  assertBudget(ctx.config, ctx.state);
  const stage = stages[name];
  const prev = ctx.state.stages[name], startCost = ctx.state.costUsd, startedAt = Date.now();
  const msg = (stage?.onApprove ? await stage.onApprove(ctx) : undefined) ?? "approved";
  const approveCost = round4(ctx.state.costUsd - startCost);
  const next = persist(ctx, setStage(ctx.state, name, "done", msg, { costUsd: round4((prev.costUsd ?? 0) + approveCost), durationMs: prev.durationMs }));
  record({
    kind: "approve", stage: name, status: "done", costUsd: approveCost, durationMs: Date.now() - startedAt,
    startedAt: new Date(startedAt).toISOString(), endedAt: new Date().toISOString(), message: msg,
  });
  return next;
}

export async function runSite(
  config: FaktoryConfig, slug: string,
  opts: { from?: StageName; only?: StageName; yes?: boolean; stages?: StageMap } = {},
): Promise<SiteState> {
  const ctx = loadContext(config, slug);
  const stages = opts.stages ?? registry;
  const record = recorder(ctx, opts);
  const target = opts.only ?? opts.from;
  const notice = target ? regenerationNotice(ctx, target) : undefined;
  if (target && notice) {
    console.warn(notice);
    if (!opts.yes) {
      if (!deps.isInteractive()) throw new Error(`Régénérer ${target} écrase des éditions manuelles ; relancez avec --yes pour confirmer`);
      if (!(await deps.confirm("Continuer ? [y/N] "))) { console.log("Aborted."); return ctx.state; }
    }
    let next = ctx.state;
    for (const later of STAGES.slice(STAGES.indexOf(target) + 1)) next = setStage(next, later, "pending");
    persist(ctx, next);
  }
  let start = opts.only ?? opts.from ?? firstIncompleteStage(ctx.state);
  if (!start) { console.log(`Site "${slug}": all stages done.`); return ctx.state; }
  if (!opts.only && !opts.from && awaitingStage(ctx.state) === start) {
    if (!opts.yes) throw new Error(`Stage ${start} awaits approval: review the artifact, then run "faktory approve ${slug}"`);
    await approveStage(ctx, start, stages, record);
    console.log(`✔ ${start} — auto-approved (--yes)`);
    start = firstIncompleteStage(ctx.state);
    if (!start) { console.log(`Site "${slug}": all stages done.`); return ctx.state; }
  }
  const plan = opts.only ? [opts.only] : STAGES.slice(STAGES.indexOf(start));
  for (const name of plan) {
    const stage = stages[name];
    if (!stage) { persist(ctx, setStage(ctx.state, name, "done", "skipped (not implemented)")); continue; }
    assertBudget(config, ctx.state);
    if (isStale(ctx, "siteSpecMd", "siteSpecJson")) console.warn(`⚠ SITE-SPEC.md is newer than site-spec.json — edits made after approve are not applied; run: faktory resync ${slug}`);
    if (isStale(ctx, "designSystemMd", "designTokensJson")) console.warn(`⚠ design-system.md is newer than design-tokens.json — edits made after approve are not applied; run: faktory resync ${slug}`);
    persist(ctx, setStage(ctx.state, name, "running"));
    console.log(`▶ ${name}`);
    const startedAt = Date.now(), startCost = ctx.state.costUsd;
    // Agent runs add their cost to ctx.state as they finish, so the stage's spend is the delta on ctx.state.
    const measure = () => ({ costUsd: round4(ctx.state.costUsd - startCost), durationMs: Date.now() - startedAt });
    const event = (status: RunRecord["status"], m: { costUsd: number; durationMs: number }, message?: string) => record({
      kind: "stage", stage: name, status, costUsd: m.costUsd, durationMs: m.durationMs,
      startedAt: new Date(startedAt).toISOString(), endedAt: new Date().toISOString(), message,
    });
    let msg: string | undefined;
    try {
      msg = (await stage.run(ctx)) ?? undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const m = measure();
      persist(ctx, setStage(ctx.state, name, "failed", message, m));
      event("failed", m, message);
      throw err;
    }
    const status = stage.checkpoint ? "awaiting_approval" : "done";
    const m = measure();
    persist(ctx, setStage(ctx.state, name, status, msg, m));
    event(status, m, msg);
    console.log(`${stage.checkpoint ? "⏸" : "✔"} ${name}${msg ? ` — ${msg}` : ""}`);
    if (!stage.checkpoint) continue;
    if (opts.yes) {
      await approveStage(ctx, name, stages, record);
      console.log(`✔ ${name} — auto-approved (--yes)`);
      continue;
    }
    console.log(`Review the artifact, then: faktory approve ${slug} && faktory run ${slug}`);
    break;
  }
  return ctx.state;
}

export async function approveSite(config: FaktoryConfig, slug: string, opts: { stages?: StageMap } = {}): Promise<SiteState> {
  const ctx = loadContext(config, slug);
  const waiting = awaitingStage(ctx.state);
  if (!waiting) throw new Error(`Nothing awaits approval for "${slug}"`);
  return approveStage(ctx, waiting, opts.stages ?? registry, recorder(ctx, {}));
}

/**
 * Re-sync any checkpoint JSON whose markdown twin was hand-edited after the fact (including after `approve`),
 * reusing each stage's own `onApprove` so the re-extraction and, for design, the preview re-render stay in one place.
 * Returns the stage names that were re-synced (empty when nothing is stale).
 */
export async function resyncSite(config: FaktoryConfig, slug: string, opts: { stages?: StageMap } = {}): Promise<string[]> {
  const ctx = loadContext(config, slug);
  const stages = opts.stages ?? registry;
  const resynced: string[] = [];
  for (const target of RESYNC_TARGETS) {
    if (!isStale(ctx, target.mdKey, target.jsonKey)) continue;
    assertBudget(config, ctx.state);
    const stage = stages[target.name];
    if (!stage?.onApprove) continue;
    await stage.onApprove(ctx);
    resynced.push(target.name);
  }
  return resynced;
}

export async function destroySite(config: FaktoryConfig, slug: string, opts: { force?: boolean } = {}): Promise<void> {
  const ctx = loadContext(config, slug);
  const down = await deps.composeDown(ctx, { volumes: true });
  if (down.code !== 0) {
    if (!opts.force) {
      throw new Error(`docker compose down failed for faktory-${slug}; workspace kept so you can retry: ${down.stderr.trim()}`);
    }
    console.warn(`⚠ docker compose down failed for faktory-${slug}: ${down.stderr.trim()} — deleting workspace anyway (--force)`);
  }
  rmSync(ctx.siteDir, { recursive: true, force: true });
}
