import { existsSync, rmSync } from "node:fs";
import type { FaktoryConfig } from "./config.js";
import { composeDown, type SiteContext } from "./docker.js";
import { STAGES, readState, writeState, setStage, firstIncompleteStage, awaitingStage, type SiteState, type StageName } from "./state.js";
import { siteDir } from "./workspace.js";
import { isStale } from "./artifacts.js";
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

export { assertBudget };

export interface Stage {
  name: StageName;
  checkpoint?: boolean;
  run(ctx: SiteContext): Promise<string | void>;
  /** Runs at `faktory approve` for checkpoint stages (e.g. re-sync JSON from an edited markdown). Throwing keeps the stage awaiting approval. */
  onApprove?(ctx: SiteContext): Promise<string | void>;
}

export const registry: Partial<Record<StageName, Stage>> = { spec: specStage, design: designStage, provision: provisionStage, pages: pagesStage, plugins: pluginsStage, content: contentStage, qa: qaStage, export: exportStage };

export const deps = { composeDown };

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

export async function runSite(
  config: FaktoryConfig, slug: string,
  opts: { from?: StageName; only?: StageName; stages?: Partial<Record<StageName, Stage>> } = {},
): Promise<SiteState> {
  const ctx = loadContext(config, slug);
  const stages = opts.stages ?? registry;
  const start = opts.only ?? opts.from ?? firstIncompleteStage(ctx.state);
  if (!start) { console.log(`Site "${slug}": all stages done.`); return ctx.state; }
  if (!opts.only && !opts.from && awaitingStage(ctx.state) === start) {
    throw new Error(`Stage ${start} awaits approval: review the artifact, then run "faktory approve ${slug}"`);
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
    try {
      const msg = (await stage.run(ctx)) ?? undefined;
      const status = stage.checkpoint ? "awaiting_approval" : "done";
      persist(ctx, setStage(ctx.state, name, status, msg ?? undefined));
      console.log(`${stage.checkpoint ? "⏸" : "✔"} ${name}${msg ? ` — ${msg}` : ""}`);
      if (stage.checkpoint) { console.log(`Review the artifact, then: faktory approve ${slug} && faktory run ${slug}`); break; }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      persist(ctx, setStage(ctx.state, name, "failed", message));
      throw err;
    }
  }
  return ctx.state;
}

export async function approveSite(config: FaktoryConfig, slug: string, opts: { stages?: Partial<Record<StageName, Stage>> } = {}): Promise<SiteState> {
  const ctx = loadContext(config, slug);
  const waiting = awaitingStage(ctx.state);
  if (!waiting) throw new Error(`Nothing awaits approval for "${slug}"`);
  assertBudget(config, ctx.state);
  const stage = (opts.stages ?? registry)[waiting];
  const msg = stage?.onApprove ? await stage.onApprove(ctx) : undefined;
  return persist(ctx, setStage(ctx.state, waiting, "done", msg ?? "approved"));
}

/**
 * Re-sync any checkpoint JSON whose markdown twin was hand-edited after the fact (including after `approve`),
 * reusing each stage's own `onApprove` so the re-extraction and, for design, the preview re-render stay in one place.
 * Returns the stage names that were re-synced (empty when nothing is stale).
 */
export async function resyncSite(config: FaktoryConfig, slug: string, opts: { stages?: Partial<Record<StageName, Stage>> } = {}): Promise<string[]> {
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
