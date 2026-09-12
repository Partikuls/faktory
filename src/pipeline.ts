import { existsSync, rmSync } from "node:fs";
import type { FaktoryConfig } from "./config.js";
import { composeDown, type SiteContext } from "./docker.js";
import { STAGES, readState, writeState, setStage, firstIncompleteStage, awaitingStage, type SiteState, type StageName } from "./state.js";
import { siteDir } from "./workspace.js";
import { provisionStage } from "./stages/provision.js";

export interface Stage {
  name: StageName;
  checkpoint?: boolean;
  run(ctx: SiteContext): Promise<string | void>;
}

export const registry: Partial<Record<StageName, Stage>> = { provision: provisionStage };

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

export function approveSite(config: FaktoryConfig, slug: string): SiteState {
  const ctx = loadContext(config, slug);
  const waiting = awaitingStage(ctx.state);
  if (!waiting) throw new Error(`Nothing awaits approval for "${slug}"`);
  return persist(ctx, setStage(ctx.state, waiting, "done", "approved"));
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
