import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
import { STAGES, STAGE_STATUSES, readState, type StageName } from "./state.js";

/** Append-only log of every stage execution and approval of a site (spec B10). */
export const RUNS_FILE = "runs.jsonl";

export const RunRecordSchema = z.object({
  /** Start time of the `faktory run` / `faktory approve` call that produced the record. */
  runId: z.string(),
  kind: z.enum(["stage", "approve"]),
  stage: z.enum(STAGES),
  status: z.enum(STAGE_STATUSES),
  /** Stage run: the stage's cost delta. Approval: the cost of `onApprove` only. */
  costUsd: z.number(),
  durationMs: z.number().int().nonnegative(),
  startedAt: z.string(),
  endedAt: z.string(),
  message: z.string().optional(),
  faktory: z.object({ commit: z.string().nullable(), dirty: z.boolean() }),
  options: z.object({ from: z.string().nullable(), only: z.string().nullable(), yes: z.boolean(), maxCostUsd: z.number() }),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;
export type RunOptions = RunRecord["options"];
export type FaktoryVersion = RunRecord["faktory"];

export const deps = {
  git: (repoRoot: string, args: string[]): string =>
    execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
};

/** Commit of the Faktory checkout that ran the pipeline; `commit: null` outside a git repository. */
export function faktoryVersion(repoRoot: string): FaktoryVersion {
  try {
    const commit = deps.git(repoRoot, ["rev-parse", "--short", "HEAD"]).trim();
    const dirty = deps.git(repoRoot, ["status", "--porcelain"]).trim() !== "";
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: false };
  }
}

/** Never throws: the history is a record of the run, not a reason to fail it. */
export function appendRun(siteDir: string, record: RunRecord): void {
  try {
    appendFileSync(join(siteDir, RUNS_FILE), JSON.stringify(record) + "\n");
  } catch (err) {
    console.warn(`⚠ could not append to ${RUNS_FILE}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function readRuns(siteDir: string): RunRecord[] {
  const p = join(siteDir, RUNS_FILE);
  if (!existsSync(p)) return [];
  const out: RunRecord[] = [];
  readFileSync(p, "utf8").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try { out.push(RunRecordSchema.parse(JSON.parse(line))); }
    catch { console.warn(`⚠ ${RUNS_FILE}: line ${i + 1} is unreadable, skipped`); }
  });
  return out;
}

export type StageTotal = { costUsd?: number; durationMs?: number };

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Cost and duration of each stage as `faktory compare` shows them: the latest `done` / `awaiting_approval` run of the
 * stage plus the cost of the approvals that followed it; a stage the log does not cover takes its `faktory.json`
 * measures when it is done (sites created before the history existed).
 */
export function stageTotals(siteDir: string): Record<StageName, StageTotal> {
  const runs = readRuns(siteDir);
  const state = readState(siteDir);
  const totals = {} as Record<StageName, StageTotal>;
  for (const name of STAGES) {
    const last = runs.filter((r) => r.kind === "stage" && r.stage === name && (r.status === "done" || r.status === "awaiting_approval")).at(-1);
    if (!last) {
      const st = state.stages[name];
      totals[name] = st.status === "done" ? { costUsd: st.costUsd, durationMs: st.durationMs } : {};
      continue;
    }
    const approvals = runs.filter((r) => r.kind === "approve" && r.stage === name && r.endedAt >= last.endedAt);
    totals[name] = { costUsd: round4(last.costUsd + approvals.reduce((s, r) => s + r.costUsd, 0)), durationMs: last.durationMs };
  }
  return totals;
}
