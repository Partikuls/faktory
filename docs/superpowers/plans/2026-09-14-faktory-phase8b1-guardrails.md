# Faktory Phase 8b1 — Pipeline guardrails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unattended run that cannot overshoot its budget through concurrent agents, crosses both checkpoints with `--yes`, proves every Gravity Forms form submits, asks before overwriting hand edits, keeps WordPress page titles in line with the spec, and records every stage execution so runs and sites can be compared.

**Architecture:** A per-site in-memory budget ledger in `src/budget.ts` hands each agent a reserved cap. `src/pipeline.ts` gains a shared `approveStage`, the `--yes` path, the regeneration confirmation and an append-only `runs.jsonl` writer built on a new `src/history.ts`. The QA stage calls a new `src/qa/forms.ts` once per form after its review rounds. `ensurePages` refreshes titles. The CLI adds `run --yes`, `status --history` and `compare`.

**Tech Stack:** TypeScript (ESM, `tsx`), vitest, zod 4, commander, Playwright, WP-CLI with the Gravity Forms CLI add-on through `docker compose exec`, `@anthropic-ai/claude-agent-sdk`.

**Spec:** `docs/superpowers/specs/2026-09-14-faktory-phase8b1-design.md` (parent scope: `docs/superpowers/specs/2026-09-14-faktory-phase8-design.md`, lot 8b).

## Global Constraints

- No new npm dependency.
- User-facing strings in generated sites and in the regeneration notice are French; code, comments, CLI help and commit messages are English.
- Commit messages: `type(faktory): …`, ending with the attribution lines given by the session.
- Budget floor per agent: `0.05` USD; caps are floored to the cent.
- Checkpoint stages are `spec` and `design`; regeneration overwrites: `spec` → `SITE-SPEC.md`, `site-spec.json`; `design` → `design-system.md`, `design-tokens.json`, `preview.html`, `design/preview.gb.json`, `design/preview.gb.html`.
- Kept files named by the notice: `pages/*.gb.json`, `content/articles/*.json`. Nothing is ever deleted by Faktory.
- History file: `sites/<slug>/runs.jsonl`, one JSON object per line, append-only; a write failure warns and never fails a run.
- Form submission failures are automatic QA defects; `hasHardFailure` is unchanged.
- Form test values: text `Test Faktory <marker>`, email `qa+<marker>@faktory.test`, phone `+33 6 00 00 00 00`, date tomorrow `dd/mm/yyyy`, number `2`, textarea `Message de test Faktory <marker>`, select first choice; unknown type → text value; `marker` = `fq<Date.now()>`.
- Gravity Forms selectors: `#input_<gfId>_<fieldId>`, `#gform_submit_button_<gfId>`, `#gform_confirmation_message_<gfId>` (15 s), validation text from `.gfield_validation_message, .gform_submission_error`.
- Unit tests: `npm test` (= `vitest run tests/unit`). Docker integration tests: `FAKTORY_DOCKER=1 npx vitest run tests/integration/<file> --testTimeout=600000 --hookTimeout=600000`. Typecheck: `npm run typecheck`.
- Long pipeline runs (≈ 30 min) are started detached with `nohup … > log 2>&1 &`, never as a foreground tool command limited to 10 minutes.

## Deviations from the spec decided while planning

Record these in the spec's « Écarts et mesures » section in Task 10:

1. **QA totals.** The spec says totals count a failed submission « comme les autres défauts automatiques ». In the code, `computeTotals` counts only the agent's `left` issues; automatic defects appear in each page section (`Défauts automatiques : …`) and its checks table. Submissions follow that existing rule: a `checkIssues` line and a `| Formulaires soumis | n/m |` row (only on pages that carry a tested form), no change to `totals`.
2. **Title comparison decodes HTML entities.** WordPress stores `Commandes & événements` as `Commandes &amp; événements`; without decoding, every `ensurePages` call would rewrite that title.
3. **`stageTotals` falls back per stage**, not only when `runs.jsonl` is missing: a stage with no `done`/`awaiting_approval` record in the log takes its `faktory.json` measures when that stage is `done`.
4. **Approval records** carry the duration of `onApprove` itself; `stageTotals` adds only their cost to the checkpoint.
5. **`withBudgetSlots` refuses to nest** (throws): no stage needs nested groups, and a nested one would break the reservation arithmetic.
6. **The regeneration notice is printed with `console.warn`** even with `--yes`, so the unattended log shows what was overwritten.
7. **`agentQueryOptions` takes the cap as a required 4th argument** (`maxBudgetUsd: number`).

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/budget.ts` | Modify | `withBudgetSlots`, `reserveBudget`, `MIN_AGENT_BUDGET_USD` |
| `src/agent.ts` | Modify | reserve/release around `query()`; cap passed to `agentQueryOptions`; `remainingBudget` removed |
| `src/stages/pages.ts`, `src/stages/content.ts` | Modify | concurrent loop inside `withBudgetSlots` |
| `src/history.ts` | Create | `RunRecordSchema`, `appendRun`, `readRuns`, `faktoryVersion`, `stageTotals` |
| `src/pipeline.ts` | Modify | `approveStage`, `yes`, regeneration confirm + reset, history writes |
| `src/status.ts` | Modify | `renderHistory`, `renderCompare` |
| `src/cli.ts` | Modify | `run --yes`, `status --history`, `compare` |
| `src/provision/pages.ts` | Modify | title refresh |
| `src/schemas/qa.ts` | Modify | `FormSubmissionSchema`, `formSubmissions`, `checkIssues` line |
| `src/qa/report.ts` | Modify | `Formulaires soumis` row |
| `src/qa/browser.ts` | Modify | `formSubmissions: []` in the check literal |
| `src/qa/forms.ts` | Create | `formValues`, `tomorrow`, `submitForm` |
| `src/stages/qa.ts` | Modify | `withBudgetSlots`, `formTargets`, submissions |
| `fixtures/qa/contact.check.json`, `fixtures/qa/report.json` | Modify | `"formSubmissions": []` |
| `tests/unit/budget.test.ts`, `tests/unit/agent-budget.test.ts`, `tests/unit/history.test.ts`, `tests/unit/qa-forms.test.ts` | Create | unit tests |
| `tests/unit/agent.test.ts`, `tests/unit/pipeline.test.ts`, `tests/unit/status.test.ts`, `tests/unit/cli.test.ts`, `tests/unit/provision-pages.test.ts`, `tests/unit/qa-schema.test.ts`, `tests/unit/qa-report.test.ts`, `tests/unit/stage-qa.test.ts` | Modify | updated expectations |
| `tests/integration/provision.test.ts`, `tests/integration/qa.test.ts` | Modify | title refresh; real submissions |
| `README.md`, `docs/GETTING-STARTED.md` | Modify | new options and commands, phase status |
| `docs/superpowers/specs/2026-09-14-faktory-phase8b1-design.md` | Modify | « Écarts et mesures » |

---

### Task 1: Budget ledger (B1)

**Files:**
- Modify: `src/budget.ts`, `src/agent.ts`, `src/stages/pages.ts`, `src/stages/content.ts`
- Create: `tests/unit/budget.test.ts`, `tests/unit/agent-budget.test.ts`
- Modify: `tests/unit/agent.test.ts`

(`src/stages/qa.ts` is wrapped in Task 8, which rewrites that loop.)

**Interfaces:**
- Consumes: `SiteContext` (`src/docker.ts`), `addCost` (`src/agent.ts`).
- Produces:
  - `MIN_AGENT_BUDGET_USD = 0.05`
  - `withBudgetSlots<T>(ctx: SiteContext, slots: number, fn: () => Promise<T>): Promise<T>`
  - `type BudgetReservation = { capUsd: number; release(): void }`
  - `reserveBudget(ctx: SiteContext): BudgetReservation`
  - `agentQueryOptions(ctx, opts, server, maxBudgetUsd: number): Options`

- [ ] **Step 1: Write the failing ledger test**

Create `tests/unit/budget.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import { addCost } from "../../src/agent.js";
import { reserveBudget, withBudgetSlots } from "../../src/budget.js";
import type { SiteContext } from "../../src/docker.js";

const site = (spent: number, max = 40): SiteContext => ({
  config: { ...loadConfig("/tmp/fk"), maxCostUsd: max }, slug: "d", siteDir: "/tmp/fk/sites/d",
  state: { ...createState("d", 8100, "pw"), costUsd: spent },
});

describe("reserveBudget", () => {
  it("outside a group, the cap is the whole remaining budget floored to the cent, at least $0.05", () => {
    expect(reserveBudget(site(10.004)).capUsd).toBe(29.99);
    expect(reserveBudget(site(45)).capUsd).toBe(0.05);
  });
  it("inside a group, splits what is left among the free slots and never reserves more than is left", async () => {
    const ctx = site(10);
    await withBudgetSlots(ctx, 3, async () => {
      const a = reserveBudget(ctx), b = reserveBudget(ctx), c = reserveBudget(ctx);
      expect([a.capUsd, b.capUsd, c.capUsd]).toEqual([10, 10, 10]);
      ctx.state = addCost(ctx.state, 4); // a finishes having spent $4
      a.release();
      const d = reserveBudget(ctx); // (40 - 14 - 20) / 1
      expect(d.capUsd).toBe(6);
      expect(b.capUsd + c.capUsd + d.capUsd).toBeLessThanOrEqual(40 - ctx.state.costUsd);
    });
  });
  it("release is idempotent, and the group closes even when fn throws", async () => {
    const ctx = site(0);
    await expect(withBudgetSlots(ctx, 2, async () => {
      const r = reserveBudget(ctx);
      r.release(); r.release();
      expect(reserveBudget(ctx).capUsd).toBe(20);
      throw new Error("x");
    })).rejects.toThrow("x");
    expect(reserveBudget(ctx).capUsd).toBe(40);
  });
  it("refuses a nested group", async () => {
    const ctx = site(0);
    await expect(withBudgetSlots(ctx, 2, () => withBudgetSlots(ctx, 2, async () => 1))).rejects.toThrow(/already open/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/budget.test.ts`
Expected: FAIL — `reserveBudget` / `withBudgetSlots` are not exported.

- [ ] **Step 3: Implement the ledger**

Append to `src/budget.ts` (keep `assertBudget`; add the imports at the top):

```ts
import type { SiteContext } from "./docker.js";

/** Smallest cap an agent is ever given (the SDK rejects a zero budget). */
export const MIN_AGENT_BUDGET_USD = 0.05;

type SlotGroup = { slots: number; active: number; reserved: number };
// In memory only: a group lives for one concurrent loop of one stage run.
const groups = new WeakMap<SiteContext, SlotGroup>();

const floorCents = (n: number): number => Math.floor(Math.round(n * 10000) / 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Open a group of `slots` concurrent agent runs for the duration of `fn`: every `reserveBudget` inside it gets a
 * share of what is left after the site's spend and the caps still reserved, so the caps in flight never add up to
 * more than the remaining budget.
 */
export async function withBudgetSlots<T>(ctx: SiteContext, slots: number, fn: () => Promise<T>): Promise<T> {
  if (groups.has(ctx)) throw new Error("withBudgetSlots: a budget group is already open for this site");
  groups.set(ctx, { slots: Math.max(1, slots), active: 0, reserved: 0 });
  try { return await fn(); } finally { groups.delete(ctx); }
}

export type BudgetReservation = { capUsd: number; release(): void };

/** The `maxBudgetUsd` of one agent run. Outside a group: the whole remaining budget. Call `release` once the run's real cost is on `ctx.state`. */
export function reserveBudget(ctx: SiteContext): BudgetReservation {
  const left = ctx.config.maxCostUsd - ctx.state.costUsd;
  const group = groups.get(ctx);
  if (!group) return { capUsd: Math.max(MIN_AGENT_BUDGET_USD, floorCents(left)), release: () => {} };
  const free = Math.max(1, group.slots - group.active);
  const capUsd = Math.max(MIN_AGENT_BUDGET_USD, floorCents((left - group.reserved) / free));
  group.active++;
  group.reserved = round4(group.reserved + capUsd);
  let released = false;
  return {
    capUsd,
    release: () => {
      if (released) return;
      released = true;
      group.active--;
      group.reserved = round4(group.reserved - capUsd);
    },
  };
}
```

`floorCents` rounds to 4 decimals before flooring so `29.996` gives `29.99` and `9.9999999` from float drift gives `10.00`.

- [ ] **Step 4: Run the ledger test to verify it passes**

Run: `npx vitest run tests/unit/budget.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing runAgent test**

Create `tests/unit/agent-budget.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({ ...(await importOriginal<object>()), query: vi.fn() }));

import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { runAgent } from "../../src/agent.js";
import { reserveBudget, withBudgetSlots } from "../../src/budget.js";

describe("runAgent budget", () => {
  it("passes a reserved cap as maxBudgetUsd and releases it after an error and after a result", async () => {
    const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-ab-")));
    await initSite(config, { slug: "ab", briefPath: "fixtures/briefs/boulangerie.md" });
    const ctx = loadContext(config, "ab");
    const q = query as unknown as ReturnType<typeof vi.fn>;
    const seen: number[] = [];
    await withBudgetSlots(ctx, 2, async () => {
      q.mockImplementationOnce(({ options }: { options: { maxBudgetUsd: number } }) => {
        seen.push(options.maxBudgetUsd);
        return (async function* () { throw new Error("boom"); })();
      });
      await expect(runAgent(ctx, { stage: "pages", prompt: "x", allowedTools: [] })).rejects.toThrow("boom");
      q.mockImplementationOnce(({ options }: { options: { maxBudgetUsd: number } }) => {
        seen.push(options.maxBudgetUsd);
        return (async function* () { yield { type: "result", subtype: "success", total_cost_usd: 1, result: "ok", session_id: "s", num_turns: 1 }; })();
      });
      await runAgent(ctx, { stage: "pages", prompt: "x", allowedTools: [] });
      expect(seen).toEqual([20, 20]); // the failed run gave its slot back
      expect(reserveBudget(ctx).capUsd).toBe(19.5); // (40 - 1) / 2: nothing left reserved
    });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/unit/agent-budget.test.ts`
Expected: FAIL — `seen` is `[40, 40]` (whole remaining budget) and the last assertion gives `39`.

- [ ] **Step 7: Use the reservation in `src/agent.ts`**

1. Add the import: `import { reserveBudget } from "./budget.js";`
2. Delete the comment block above `remainingBudget` and the `remainingBudget` function.
3. Change `agentQueryOptions`:

```ts
/** The exact `options` object `runAgent` passes to `query()`; extracted so it can be unit-tested without a live agent call. */
export function agentQueryOptions(ctx: SiteContext, opts: AgentOptions, server: ReturnType<typeof createFaktoryServer>, maxBudgetUsd: number): Options {
```

and inside it replace `maxBudgetUsd: remainingBudget(ctx),` with `maxBudgetUsd,`.

4. In `runAgent`, wrap the loop:

```ts
export async function runAgent(
  ctx: SiteContext,
  opts: AgentOptions,
): Promise<AgentRun> {
  const server = createFaktoryServer(ctx);
  let out: AgentRun | undefined;
  const transcriptParts: string[] = [];
  // A share of the budget reserved for this run; released once its real cost is on ctx.state (or it failed).
  const budget = reserveBudget(ctx);
  try {
    for await (const message of query({
      prompt: opts.prompt,
      options: agentQueryOptions(ctx, opts, server, budget.capUsd),
    })) {
      // …existing body of the loop, unchanged…
    }
  } finally {
    budget.release();
  }
  if (!out) throw new Error(`Agent stage "${opts.stage}" produced no result`);
  return out;
}
```

`budget.ts` imports only types from `docker.ts`, so there is no import cycle with `agent.ts`.

- [ ] **Step 8: Update `tests/unit/agent.test.ts`**

1. Remove `remainingBudget` from the import list and delete the whole `describe("remainingBudget", …)` block.
2. Every `agentQueryOptions(ctx, {…}, server)` call gains a 4th argument `12.5`, e.g. `agentQueryOptions(ctx, { stage: "pages", prompt: "go", allowedTools: ["Read"] }, server, 12.5)`.
3. In `it("builds the exact options passed to query()")` add: `expect(opts.maxBudgetUsd).toBe(12.5);`

- [ ] **Step 9: Wrap the concurrent loops**

`src/stages/pages.ts`:
1. Import: `import { assertBudget, withBudgetSlots } from "../budget.js";` (replacing the `assertBudget`-only import).
2. Replace the comment above `PAGES_CONCURRENCY` with `// Pages generated in parallel after the home page; they share the remaining budget (see withBudgetSlots).`
3. Replace `const results = await mapLimit(rest, PAGES_CONCURRENCY, build);` with:

```ts
    const results = await withBudgetSlots(ctx, PAGES_CONCURRENCY, () => mapLimit(rest, PAGES_CONCURRENCY, build));
```

`src/stages/content.ts`:
1. Import: `import { assertBudget, withBudgetSlots } from "../budget.js";`
2. Replace `const results = await mapLimit(spec.blog.articles, ARTICLES_CONCURRENCY, build);` with:

```ts
    const results = await withBudgetSlots(ctx, ARTICLES_CONCURRENCY, () => mapLimit(spec.blog.articles, ARTICLES_CONCURRENCY, build));
```

- [ ] **Step 10: Run the suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all unit tests PASS; `tsc` reports no error. If `tsc` flags another `agentQueryOptions` or `remainingBudget` call site, pass `reserveBudget(ctx).capUsd` there — `grep -rn "remainingBudget\|agentQueryOptions(" src tests` must show no leftover use of `remainingBudget`.

- [ ] **Step 11: Commit**

```bash
git add src/budget.ts src/agent.ts src/stages/pages.ts src/stages/content.ts tests/unit/budget.test.ts tests/unit/agent-budget.test.ts tests/unit/agent.test.ts
git commit -m "feat(faktory): concurrent agents share the remaining budget through a reservation ledger"
```

---

### Task 2: Run history module (B10, data)

**Files:**
- Create: `src/history.ts`, `tests/unit/history.test.ts`

**Interfaces:**
- Consumes: `STAGES`, `STAGE_STATUSES`, `readState`, `StageName` from `src/state.ts`.
- Produces:
  - `RUNS_FILE = "runs.jsonl"`
  - `RunRecordSchema`, `type RunRecord`, `type RunOptions = RunRecord["options"]`, `type FaktoryVersion = RunRecord["faktory"]`
  - `deps = { git(repoRoot: string, args: string[]): string }`
  - `faktoryVersion(repoRoot: string): FaktoryVersion`
  - `appendRun(siteDir: string, record: RunRecord): void`
  - `readRuns(siteDir: string): RunRecord[]`
  - `type StageTotal = { costUsd?: number; durationMs?: number }`
  - `stageTotals(siteDir: string): Record<StageName, StageTotal>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/history.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createState, setStage, writeState } from "../../src/state.js";
import { appendRun, readRuns, stageTotals, faktoryVersion, deps, RUNS_FILE, type RunRecord } from "../../src/history.js";

function siteDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fk-hist-"));
  writeState(dir, createState("h", 8100, "pw"));
  return dir;
}
const rec = (over: Partial<RunRecord>): RunRecord => ({
  runId: "2026-09-14T10:00:00.000Z", kind: "stage", stage: "spec", status: "done", costUsd: 1, durationMs: 1000,
  startedAt: "2026-09-14T10:00:00.000Z", endedAt: "2026-09-14T10:00:01.000Z", message: "ok",
  faktory: { commit: "abc1234", dirty: false }, options: { from: null, only: null, yes: false, maxCostUsd: 40 },
  ...over,
});

describe("appendRun / readRuns", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("appends one line per record and reads them back in order", () => {
    const dir = siteDir();
    appendRun(dir, rec({ stage: "spec" }));
    appendRun(dir, rec({ stage: "design" }));
    expect(readRuns(dir).map((r) => r.stage)).toEqual(["spec", "design"]);
  });
  it("returns [] without a runs file and skips an unreadable line with a warning", () => {
    const dir = siteDir();
    expect(readRuns(dir)).toEqual([]);
    appendRun(dir, rec({}));
    appendFileSync(join(dir, RUNS_FILE), "{not json\n");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readRuns(dir)).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("line 2"));
  });
  it("warns instead of throwing when the file cannot be written", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => appendRun("/nonexistent/dir", rec({}))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(RUNS_FILE));
  });
});

describe("faktoryVersion", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("reads the short commit and the dirty flag", () => {
    vi.spyOn(deps, "git").mockImplementation((_r, args) => (args[0] === "rev-parse" ? "b0d5692\n" : " M src/a.ts\n"));
    expect(faktoryVersion("/repo")).toEqual({ commit: "b0d5692", dirty: true });
  });
  it("gives a null commit outside a git repository", () => {
    vi.spyOn(deps, "git").mockImplementation(() => { throw new Error("not a git repository"); });
    expect(faktoryVersion("/tmp")).toEqual({ commit: null, dirty: false });
  });
});

describe("stageTotals", () => {
  it("takes each stage's latest done or awaiting run and adds the later approval cost", () => {
    const dir = siteDir();
    appendRun(dir, rec({ stage: "spec", status: "awaiting_approval", costUsd: 0.5, durationMs: 60000, endedAt: "2026-09-14T10:01:00.000Z" }));
    appendRun(dir, rec({ kind: "approve", stage: "spec", status: "done", costUsd: 0.25, durationMs: 5000, endedAt: "2026-09-14T10:02:00.000Z" }));
    appendRun(dir, rec({ stage: "pages", status: "done", costUsd: 5, durationMs: 500000 }));
    appendRun(dir, rec({ stage: "pages", status: "failed", costUsd: 1, durationMs: 1000, endedAt: "2026-09-14T11:00:00.000Z" }));
    const t = stageTotals(dir);
    expect(t.spec).toEqual({ costUsd: 0.75, durationMs: 60000 });
    expect(t.pages).toEqual({ costUsd: 5, durationMs: 500000 });
    expect(t.design).toEqual({});
  });
  it("falls back to faktory.json for a stage the log does not cover", () => {
    const dir = siteDir();
    writeState(dir, setStage(setStage(createState("h", 8100, "pw"), "qa", "done", "qa ok", { costUsd: 5.38, durationMs: 288000 }), "export", "failed", "x", { costUsd: 0, durationMs: 1 }));
    const t = stageTotals(dir);
    expect(t.qa).toEqual({ costUsd: 5.38, durationMs: 288000 });
    expect(t.export).toEqual({});
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/history.test.ts`
Expected: FAIL — cannot resolve `../../src/history.js`.

- [ ] **Step 3: Implement `src/history.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/history.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/history.ts tests/unit/history.test.ts
git commit -m "feat(faktory): append-only run history with per-stage totals"
```

---

### Task 3: `approveStage`, `run --yes` and history writes (B7, B10)

**Files:**
- Modify: `src/pipeline.ts`
- Modify: `tests/unit/pipeline.test.ts`

**Interfaces:**
- Consumes: `appendRun`, `faktoryVersion`, `type RunRecord`, `deps as historyDeps` from `src/history.ts` (Task 2).
- Produces:
  - `runSite(config, slug, opts: { from?: StageName; only?: StageName; yes?: boolean; stages?: Partial<Record<StageName, Stage>> })`
  - `approveStage(ctx: SiteContext, name: StageName, stages: Partial<Record<StageName, Stage>>, record: Recorder): Promise<SiteState>`
  - `type Recorder = (event: Omit<RunRecord, "runId" | "faktory" | "options">) => void`
  - `recorder(ctx: SiteContext, opts: { from?: StageName; only?: StageName; yes?: boolean }): Recorder`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/pipeline.test.ts`:

1. Extend the imports:

```ts
import { STAGES, readState, setStage, writeState, type StageName } from "../../src/state.js";
import { readRuns, deps as historyDeps } from "../../src/history.js";
```

(replace the existing `state.js` import line).

2. Add after the `ok` helper:

```ts
/** All eight stages as stubs; spec and design are checkpoints with an onApprove that logs. */
function allStages(log: string[], approvals: string[] = []): Partial<Record<StageName, Stage>> {
  return Object.fromEntries(STAGES.map((name) => {
    const checkpoint = name === "spec" || name === "design";
    const stage: Stage = { name, checkpoint, run: async () => { log.push(name); return `${name} ok`; } };
    if (checkpoint) stage.onApprove = async () => { approvals.push(name); return undefined; };
    return [name, stage];
  }));
}
```

3. Append these blocks at the end of the file:

```ts
describe("run --yes", () => {
  it("approves both checkpoints on the way and runs every stage", async () => {
    const config = await setup(); const log: string[] = [], approvals: string[] = [];
    const s = await runSite(config, "pp", { yes: true, stages: allStages(log, approvals) });
    expect(log).toEqual([...STAGES]);
    expect(approvals).toEqual(["spec", "design"]);
    for (const name of STAGES) expect(s.stages[name].status, name).toBe("done");
    expect(s.stages.spec.message).toBe("approved");
  });
  it("approves a checkpoint that already awaits approval, then continues", async () => {
    const config = await setup(); const log: string[] = [], approvals: string[] = [];
    const stages = allStages(log, approvals);
    await runSite(config, "pp", { stages });
    expect(log).toEqual(["spec"]);
    const s = await runSite(config, "pp", { yes: true, stages });
    expect(approvals).toEqual(["spec", "design"]);
    expect(log).toEqual([...STAGES]);
    expect(s.stages.export.status).toBe("done");
  });
});

describe("run history", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(historyDeps, "git").mockImplementation(() => { throw new Error("not a repo"); }); });
  it("appends one record per stage and per approval, sharing the run id and options", async () => {
    const config = await setup();
    await runSite(config, "pp", { yes: true, stages: allStages([]) });
    const runs = readRuns(siteDir(config, "pp"));
    expect(runs).toHaveLength(10);
    expect(runs.slice(0, 5).map((r) => `${r.kind}:${r.stage}:${r.status}`)).toEqual([
      "stage:spec:awaiting_approval", "approve:spec:done", "stage:design:awaiting_approval", "approve:design:done", "stage:provision:done",
    ]);
    expect(new Set(runs.map((r) => r.runId)).size).toBe(1);
    expect(runs[0].options).toEqual({ from: null, only: null, yes: true, maxCostUsd: 40 });
    expect(runs[0].faktory).toEqual({ commit: null, dirty: false });
    expect(runs[4].message).toBe("provision ok");
  });
  it("records a failed stage with its message", async () => {
    const config = await setup();
    const stages = { spec: { name: "spec", run: async () => { throw new Error("kaboom"); } } as Stage };
    await expect(runSite(config, "pp", { stages })).rejects.toThrow("kaboom");
    const [r] = readRuns(siteDir(config, "pp"));
    expect(r).toMatchObject({ kind: "stage", stage: "spec", status: "failed", message: "kaboom" });
  });
  it("approveSite records the approval with the cost of onApprove only", async () => {
    const config = await setup();
    const spec: Stage = {
      name: "spec", checkpoint: true,
      run: async (ctx) => { ctx.state = addCost(ctx.state, 0.5); return "ok"; },
      onApprove: async (ctx) => { ctx.state = addCost(ctx.state, 0.3); return "re-synced"; },
    };
    await runSite(config, "pp", { stages: { spec } });
    await approveSite(config, "pp", { stages: { spec } });
    const runs = readRuns(siteDir(config, "pp"));
    expect(runs.map((r) => r.kind)).toEqual(["stage", "approve"]);
    expect(runs[1]).toMatchObject({ stage: "spec", status: "done", costUsd: 0.3, message: "re-synced" });
    expect(runs[1].runId).not.toBe(runs[0].runId);
  });
});
```

`runs[1].runId` differs because `approveSite` is a separate call; both are ISO timestamps taken milliseconds apart — if they collide on a fast machine, add `await new Promise((r) => setTimeout(r, 2));` between the two calls.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/pipeline.test.ts`
Expected: FAIL — `run --yes` stops at `spec`; `readRuns` returns `[]`.

- [ ] **Step 3: Implement in `src/pipeline.ts`**

1. Imports — add:

```ts
import { appendRun, faktoryVersion, type RunRecord } from "./history.js";
```

2. Add below `round4`:

```ts
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
```

3. Replace `runSite` with:

```ts
export async function runSite(
  config: FaktoryConfig, slug: string,
  opts: { from?: StageName; only?: StageName; yes?: boolean; stages?: StageMap } = {},
): Promise<SiteState> {
  const ctx = loadContext(config, slug);
  const stages = opts.stages ?? registry;
  const record = recorder(ctx, opts);
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
```

The `try` now covers only `stage.run`: a throwing `onApprove` under `--yes` leaves the stage `awaiting_approval` (the same as `faktory approve`) instead of marking it `failed`.

4. Replace `approveSite` with:

```ts
export async function approveSite(config: FaktoryConfig, slug: string, opts: { stages?: StageMap } = {}): Promise<SiteState> {
  const ctx = loadContext(config, slug);
  const waiting = awaitingStage(ctx.state);
  if (!waiting) throw new Error(`Nothing awaits approval for "${slug}"`);
  return approveStage(ctx, waiting, opts.stages ?? registry, recorder(ctx, {}));
}
```

5. In `resyncSite`, change the `opts` type to `{ stages?: StageMap }` (no behaviour change).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/pipeline.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, no type error.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline.ts tests/unit/pipeline.test.ts
git commit -m "feat(faktory): run --yes approves checkpoints; every stage run and approval goes to runs.jsonl"
```

---

### Task 4: Confirmation before regenerating a checkpoint (B8)

**Files:**
- Modify: `src/pipeline.ts`
- Modify: `tests/unit/pipeline.test.ts`

**Interfaces:**
- Consumes: `ARTIFACTS`, `hasArtifact`, `artifactPath`, `PAGES_DIR`, `type ArtifactKey` (`src/artifacts.ts`), `ARTICLES_DIR` (`src/schemas/article.ts`), `runSite` from Task 3.
- Produces:
  - `deps = { composeDown, isInteractive(): boolean, confirm(question: string): Promise<boolean> }`
  - `REGENERATED: Partial<Record<StageName, ArtifactKey[]>>`
  - `regenerationNotice(ctx: SiteContext, stage: StageName): string | undefined` — `undefined` when no confirmation is needed.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/pipeline.test.ts`, add `mkdirSync, writeFileSync` to the `node:fs` import, then append:

```ts
describe("regenerating a checkpoint", () => {
  beforeEach(() => vi.restoreAllMocks());
  const LATER = ["provision", "plugins", "pages", "content", "qa", "export"] as const;

  /** Every stage done, design.md + tokens and one page tree on disk. */
  async function doneSite() {
    const config = await setup();
    const dir = siteDir(config, "pp");
    let s = readState(dir);
    for (const name of STAGES) s = setStage(s, name, "done");
    writeState(dir, s);
    const ctx = loadContext(config, "pp");
    writeTextArtifact(ctx, "designSystemMd", "# design");
    writeJsonArtifact(ctx, "designTokensJson", {});
    mkdirSync(join(dir, "pages"), { recursive: true });
    writeFileSync(join(dir, "pages/accueil.gb.json"), "[]");
    return config;
  }

  it("--only design asks first, names the overwritten and kept files, then resets the later stages", async () => {
    const config = await doneSite(); const log: string[] = [];
    vi.spyOn(deps, "isInteractive").mockReturnValue(true);
    const confirm = vi.spyOn(deps, "confirm").mockResolvedValue(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await runSite(config, "pp", { only: "design", stages: { design: ok("design", false, log) } });
    expect(confirm).toHaveBeenCalledTimes(1);
    const notice = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(notice).toContain("⚠ Régénérer design écrase : design-system.md, design-tokens.json");
    expect(notice).not.toContain("preview.html");
    expect(notice).toContain("Les étapes suivantes repasseront en attente : provision, plugins, pages, content, qa, export");
    expect(notice).toContain("Conservés et réutilisés par leurs étapes : pages/*.gb.json — supprimez-les pour tout reconstruire");
    expect(log).toEqual(["design"]);
    expect(s.stages.spec.status).toBe("done");
    for (const name of LATER) expect(s.stages[name].status, name).toBe("pending");
  });
  it("runs nothing and changes nothing when the answer is no", async () => {
    const config = await doneSite(); const log: string[] = [];
    vi.spyOn(deps, "isInteractive").mockReturnValue(true);
    vi.spyOn(deps, "confirm").mockResolvedValue(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await runSite(config, "pp", { only: "design", stages: { design: ok("design", false, log) } });
    expect(log).toEqual([]);
    for (const name of STAGES) expect(s.stages[name].status, name).toBe("done");
  });
  it("--yes skips the question but still resets the later stages", async () => {
    const config = await doneSite(); const log: string[] = [];
    const confirm = vi.spyOn(deps, "confirm");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await runSite(config, "pp", { only: "design", yes: true, stages: { design: ok("design", false, log) } });
    expect(confirm).not.toHaveBeenCalled();
    expect(log).toEqual(["design"]);
    expect(s.stages.provision.status).toBe("pending");
  });
  it("refuses without a terminal and without --yes", async () => {
    const config = await doneSite(); const log: string[] = [];
    vi.spyOn(deps, "isInteractive").mockReturnValue(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(runSite(config, "pp", { only: "design", stages: { design: ok("design", false, log) } })).rejects.toThrow(/relancez avec --yes pour confirmer/);
    expect(log).toEqual([]);
  });
  it("does not ask for a non-checkpoint stage, nor for a checkpoint that was never generated", async () => {
    const confirm = vi.spyOn(deps, "confirm");
    const done = await doneSite();
    await runSite(done, "pp", { only: "provision", stages: { provision: ok("provision") } });
    const fresh = await setup();
    await runSite(fresh, "pp", { only: "spec", stages: { spec: ok("spec") } });
    expect(confirm).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/pipeline.test.ts -t "regenerating a checkpoint"`
Expected: FAIL — `deps.isInteractive` does not exist (`vi.spyOn` throws), no notice printed.

- [ ] **Step 3: Implement in `src/pipeline.ts`**

1. Imports — change/add:

```ts
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline/promises";
import { ARTIFACTS, PAGES_DIR, artifactPath, hasArtifact, isStale, type ArtifactKey } from "./artifacts.js";
import { ARTICLES_DIR } from "./schemas/article.js";
```

(`isStale` was already imported from `./artifacts.js`: merge into this line.)

2. Replace `export const deps = { composeDown };` with:

```ts
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
```

3. In `runSite`, right after `const record = recorder(ctx, opts);`, insert:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/pipeline.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no error.

```bash
git add src/pipeline.ts tests/unit/pipeline.test.ts
git commit -m "feat(faktory): confirm before regenerating spec or design, then reset the later stages"
```

---

### Task 5: CLI — `run --yes`, `status --history`, `compare` (B7, B10)

**Files:**
- Modify: `src/status.ts`, `src/cli.ts`
- Modify: `tests/unit/status.test.ts`, `tests/unit/cli.test.ts`

**Interfaces:**
- Consumes: `readRuns`, `stageTotals`, `type RunRecord`, `type StageTotal` (Task 2); `runSite(…, { yes })` (Task 3).
- Produces:
  - `renderHistory(runs: RunRecord[]): string`
  - `renderCompare(sites: { slug: string; totals: Record<StageName, StageTotal> }[]): string`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/status.test.ts` (add `renderHistory, renderCompare` to the `status.js` import, and `import { STAGES } from "../../src/state.js";` plus `import type { RunRecord, StageTotal } from "../../src/history.js";`):

```ts
describe("renderHistory", () => {
  const rec = (over: Partial<RunRecord>): RunRecord => ({
    runId: "2026-09-14T10:00:00.000Z", kind: "stage", stage: "spec", status: "awaiting_approval", costUsd: 0.39, durationMs: 65000,
    startedAt: "2026-09-14T10:00:00.000Z", endedAt: "2026-09-14T10:01:05.000Z", message: "SITE-SPEC.md written: 6 pages",
    faktory: { commit: "b0d5692", dirty: true }, options: { from: null, only: null, yes: true, maxCostUsd: 40 }, ...over,
  });
  it("prints one block per run id with its commit, options and events", () => {
    const out = renderHistory([
      rec({}),
      rec({ kind: "approve", status: "done", costUsd: 0, durationMs: 10, message: "approved" }),
      rec({ runId: "2026-09-14T12:00:00.000Z", stage: "qa", status: "done", costUsd: 5.38, durationMs: 288000, message: "qa ok", faktory: { commit: null, dirty: false }, options: { from: null, only: "qa", yes: false, maxCostUsd: 20 } }),
    ]);
    const [first, second] = out.split("\n\n");
    expect(first.split("\n")[0]).toBe("2026-09-14T10:00:00.000Z — b0d5692+dirty — --yes, max $40");
    expect(first).toMatch(/stage\s+spec\s+awaiting_approval\s+\$0\.39\s+1m 05s\s+SITE-SPEC\.md written: 6 pages/);
    expect(first).toMatch(/approve\s+spec\s+done\s+\$0\.00\s+0s\s+approved/);
    expect(second.split("\n")[0]).toBe("2026-09-14T12:00:00.000Z — no commit — --only qa, max $20");
  });
  it("says so when there is no history", () => {
    expect(renderHistory([])).toBe("No run history yet.");
  });
});

describe("renderCompare", () => {
  const totals = (cost: number, ms: number): Record<(typeof STAGES)[number], StageTotal> =>
    Object.fromEntries(STAGES.map((s) => [s, s === "export" ? {} : { costUsd: cost, durationMs: ms }])) as Record<(typeof STAGES)[number], StageTotal>;
  it("prints a stage × site table with totals", () => {
    const out = renderCompare([{ slug: "boulangerie-8a", totals: totals(1, 60000) }, { slug: "boulangerie-8b", totals: totals(0.5, 30000) }]);
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^stage\s+boulangerie-8a\s+boulangerie-8b$/);
    expect(out).toMatch(/spec\s+\$1\.00 · 1m 00s\s+\$0\.50 · 30s/);
    expect(out).toMatch(/export\s+–\s+–/);
    expect(lines.at(-1)).toMatch(/^total\s+\$7\.00 · 7m 00s\s+\$3\.50 · 3m 30s$/);
  });
});
```

In `tests/unit/cli.test.ts`, add `"compare"` to the command list, and add:

```ts
  it("documents run --yes and status --history", async () => {
    const run = await exec("npx", ["tsx", "src/cli.ts", "run", "--help"]);
    expect(run.stdout).toContain("--yes");
    const status = await exec("npx", ["tsx", "src/cli.ts", "status", "--help"]);
    expect(status.stdout).toContain("--history");
  }, 20000);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/status.test.ts tests/unit/cli.test.ts`
Expected: FAIL — `renderHistory` / `renderCompare` not exported; `compare` and `--yes` missing from help.

- [ ] **Step 3: Implement the renderers in `src/status.ts`**

Change the imports and append:

```ts
import { STAGES, type SiteState, type StageName } from "./state.js";
import type { RunRecord, StageTotal } from "./history.js";
```

```ts
/** `faktory status <slug> --history`: one block per CLI call, oldest first. */
export function renderHistory(runs: RunRecord[]): string {
  if (!runs.length) return "No run history yet.";
  const blocks: string[] = [];
  for (const runId of [...new Set(runs.map((r) => r.runId))]) {
    const events = runs.filter((r) => r.runId === runId);
    const { faktory, options } = events[0];
    const commit = faktory.commit ? `${faktory.commit}${faktory.dirty ? "+dirty" : ""}` : "no commit";
    const flags = [options.from && `--from ${options.from}`, options.only && `--only ${options.only}`, options.yes && "--yes", `max $${options.maxCostUsd}`].filter(Boolean).join(", ");
    const rows = [["event", "stage", "status", "cost", "duration", "message"],
      ...events.map((r) => [r.kind, r.stage, r.status, formatCost(r.costUsd), formatDuration(r.durationMs), (r.message ?? "").slice(0, 80)])];
    blocks.push([`${runId} — ${commit} — ${flags}`, table(rows)].join("\n"));
  }
  return blocks.join("\n\n");
}

/** `faktory compare`: cost · duration of each stage per site, then the totals (same figures as the phase documents' tables). */
export function renderCompare(sites: { slug: string; totals: Record<StageName, StageTotal> }[]): string {
  const cell = (t: StageTotal): string => (t.costUsd === undefined && t.durationMs === undefined ? "–" : `${formatCost(t.costUsd)} · ${formatDuration(t.durationMs)}`);
  const rows = [["stage", ...sites.map((s) => s.slug)]];
  for (const name of STAGES) rows.push([name, ...sites.map((s) => cell(s.totals[name]))]);
  rows.push(["total", ...sites.map((s) => {
    const cost = STAGES.reduce((n, st) => n + (s.totals[st].costUsd ?? 0), 0);
    const ms = STAGES.reduce((n, st) => n + (s.totals[st].durationMs ?? 0), 0);
    return cell({ costUsd: Math.round(cost * 100) / 100, durationMs: ms });
  })]);
  return table(rows);
}
```

- [ ] **Step 4: Wire the CLI in `src/cli.ts`**

1. Imports — add `import { readRuns, stageTotals } from "./history.js";` and change the status import to `import { renderStatus, renderHistory, renderCompare } from "./status.js";`
2. `run` command:

```ts
program.command("run <slug>").description("Run the pipeline from the first incomplete stage")
  .option("--from <stage>").option("--only <stage>")
  .option("--max-cost <usd>", "Stop before any stage once the cumulated cost reaches this amount (default: faktory.config.json maxCostUsd)")
  .option("--yes", "Approve spec and design automatically, and confirm the regeneration of a checkpoint (unattended runs)")
  .action(async (slug: string, opts: { from?: string; only?: string; maxCost?: string; yes?: boolean }) => {
    await runSite(withMaxCost(opts.maxCost), slug, { from: asStage(opts.from), only: asStage(opts.only), yes: opts.yes });
  });
```

3. `status` command:

```ts
program.command("status <slug>").description("Show stage status, cost and duration of a site (no LLM, no Docker)")
  .option("--history", "Also list every recorded stage run and approval (runs.jsonl)")
  .action(async (slug: string, opts: { history?: boolean }) => {
    const ctx = loadContext(loadConfig(), slug);
    console.log(renderStatus(ctx.state));
    if (opts.history) console.log(`\n${renderHistory(readRuns(ctx.siteDir))}`);
  });
program.command("compare <slugs...>").description("Compare the cost and duration of each stage across sites (no LLM, no Docker)")
  .action(async (slugs: string[]) => {
    if (slugs.length < 2) throw new Error("compare needs at least two sites");
    const config = loadConfig();
    console.log(renderCompare(slugs.map((slug) => ({ slug, totals: stageTotals(loadContext(config, slug).siteDir) }))));
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/status.test.ts tests/unit/cli.test.ts && npm run typecheck`
Expected: PASS, no type error.

- [ ] **Step 6: Try it on the real sites**

Run: `npm run faktory -- compare boulangerie-e2e boulangerie-8a`
Expected: an 8-stage table whose `boulangerie-8a` column matches the « Run neuf `boulangerie-8a` » table of `docs/superpowers/specs/2026-09-14-faktory-phase8a-design.md` (e.g. `pages $5.62 · 8m 33s`), built from the `faktory.json` fallback.

- [ ] **Step 7: Commit**

```bash
git add src/status.ts src/cli.ts tests/unit/status.test.ts tests/unit/cli.test.ts
git commit -m "feat(faktory): run --yes, status --history and compare commands"
```

---

### Task 6: Page titles follow the spec (B9)

**Files:**
- Modify: `src/provision/pages.ts`
- Modify: `tests/unit/provision-pages.test.ts`, `tests/integration/provision.test.ts`

**Interfaces:**
- Consumes: `wpOk`, `wpJson` (`src/wp.ts`).
- Produces: `decodeEntities(s: string): string` (exported for tests); `ensurePages` signature unchanged.

- [ ] **Step 1: Write the failing unit tests**

In `tests/unit/provision-pages.test.ts`:
1. Change the `fakeWp` state type to `pages: { ID: number; post_name: string; post_title?: string }[]`.
2. In the first `ensurePages` test, use `{ ID: 12, post_name: "accueil", post_title: "Accueil" }`.
3. Import `decodeEntities` from `../../src/provision/pages.js` and add inside `describe("ensurePages")`:

```ts
  it("reads titles and rewrites only the ones that differ from the spec, entities decoded", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const spy = fakeWp({ pages: [
      { ID: 12, post_name: "accueil", post_title: "Accueil" },
      { ID: 13, post_name: "commandes-evenements", post_title: "Commandes &amp; événements" },
      { ID: 14, post_name: "la-maison", post_title: "Maison" },
    ], menus: [], items: [] });
    await ensurePages(ctx, spec);
    const a = argsOf(spy);
    expect(a[0]).toBe("post list --post_type=page --post_status=any --fields=ID,post_name,post_title --format=json");
    expect(a.filter((x: string) => x.startsWith("post update"))).toEqual(["post update 14 --post_title=La maison"]);
    expect(log).toHaveBeenCalledWith('  ↻ title /la-maison/: "Maison" → "La maison"');
  });
});

describe("decodeEntities", () => {
  it("decodes the entities WordPress writes into titles", () => {
    expect(decodeEntities("A &amp; B &lt;C&gt; &quot;D&quot; &#039;E&#039; &#8217;")).toBe("A & B <C> \"D\" 'E' ’");
  });
```

(the closing `});` of the added test ends `describe("ensurePages")`, which the new `describe("decodeEntities")` follows — keep the file's braces balanced.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/provision-pages.test.ts`
Expected: FAIL — `decodeEntities` not exported; `--fields=ID,post_name` without `post_title`.

- [ ] **Step 3: Implement in `src/provision/pages.ts`**

```ts
type PageRow = { ID: number; post_name: string; post_title: string };

/** WordPress stores titles through kses (`&` → `&amp;`); compare what a visitor reads. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Create every sitemap page as a published, empty placeholder (phase 3 fills them by slug) and keep existing titles in line with the spec. Returns slug → ID. */
export async function ensurePages(ctx: SiteContext, spec: SiteSpec): Promise<Record<string, number>> {
  const existing = await wpJson<PageRow[]>(ctx, ["post", "list", "--post_type=page", "--post_status=any", "--fields=ID,post_name,post_title"]);
  const ids: Record<string, number> = {};
  for (const page of spec.sitemap) {
    const row = existing.find((p) => p.post_name === page.slug);
    let id = row?.ID;
    if (!id) {
      id = Number(await wpOk(ctx, ["post", "create", "--post_type=page", "--post_status=publish", `--post_title=${page.title}`, `--post_name=${page.slug}`, "--porcelain"]));
    } else if (decodeEntities(row!.post_title ?? "") !== page.title) {
      await wpOk(ctx, ["post", "update", String(id), `--post_title=${page.title}`]);
      console.log(`  ↻ title /${page.slug}/: "${decodeEntities(row!.post_title ?? "")}" → "${page.title}"`);
    }
    for (const [k, v] of GP_PAGE_META) await wpOk(ctx, ["post", "meta", "update", String(id), k, v]);
    ids[page.slug] = id;
  }
  // …front page / posts page block unchanged…
```

Keep the rest of the function (home/blog options, `return ids`) as it is.

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npm test`
Expected: PASS. Stage tests mock `ensurePages`, so only `provision-pages.test.ts` exercises the change.

- [ ] **Step 5: Add the integration check**

In `tests/integration/provision.test.ts`, import `wpOk` next to `wpJson`, add `import { readFileSync } from "node:fs";` (merge with the existing `node:fs` import) and add after the existing `it`:

```ts
  it("puts back a page title edited in WordPress to the spec's title", async () => {
    const ctx = loadContext(config, "itprov");
    const spec = JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8"));
    writeFileSync(join(ctx.siteDir, "site-spec.json"), JSON.stringify(spec));
    const s1 = await runSite(config, "itprov", { only: "provision" });
    expect(s1.stages.provision.status, s1.stages.provision.message).toBe("done");
    const [page] = await wpJson<{ ID: number }[]>(ctx, ["post", "list", "--post_type=page", "--name=commandes-evenements", "--fields=ID"]);
    await wpOk(ctx, ["post", "update", String(page.ID), "--post_title=Ancien titre"]);
    const s2 = await runSite(config, "itprov", { only: "provision" });
    expect(s2.stages.provision.status, s2.stages.provision.message).toBe("done");
    expect(await wpOk(ctx, ["post", "get", String(page.ID), "--field=post_title"])).toBe("Commandes &amp; événements");
  });
```

Before writing it, read the top of `tests/integration/provision.test.ts` and `src/stages/provision.ts`: if provision creates pages only when `site-spec.json` exists (it does — `ensurePages` needs the spec), the spec copy above is what makes the pages exist. If the first `it` already copies the spec, drop the `writeFileSync` line. Add `writeFileSync` to the `node:fs` import if kept.

- [ ] **Step 6: Run the integration test**

Run: `FAKTORY_DOCKER=1 npx vitest run tests/integration/provision.test.ts --testTimeout=600000 --hookTimeout=600000`
Expected: PASS (2 tests). If the stored title comes back decoded (`Commandes & événements`), assert `decodeEntities(...)` equality instead — the requirement is that the title matches the spec as a visitor reads it.

- [ ] **Step 7: Commit**

```bash
git add src/provision/pages.ts tests/unit/provision-pages.test.ts tests/integration/provision.test.ts
git commit -m "feat(faktory): ensurePages rewrites page titles that no longer match the spec"
```

---

### Task 7: Form submission module and check schema (B3, part 1)

**Files:**
- Create: `src/qa/forms.ts`, `tests/unit/qa-forms.test.ts`
- Modify: `src/schemas/qa.ts`, `src/qa/report.ts`, `src/qa/browser.ts`
- Modify: `fixtures/qa/contact.check.json`, `fixtures/qa/report.json`, `tests/unit/qa-schema.test.ts`, `tests/unit/qa-report.test.ts`

**Interfaces:**
- Consumes: `runWp` (`src/wp.ts`), `VIEWPORTS` (`src/schemas/qa.ts`), `Browser` (`playwright`).
- Produces:
  - `FormSubmissionSchema`, `type FormSubmission = { formId: string; gfId: number; url: string; ok: boolean; error?: string; checkedAt: string }`
  - `PageCheck.formSubmissions: FormSubmission[]` (default `[]`)
  - `type GfLiveField = { id: number; type: string; isRequired?: boolean; choices?: { text: string; value: string }[] | "" }`, `type GfLiveForm = { id: number | string; fields: GfLiveField[] }`
  - `tomorrow(now?: Date): string`
  - `formValues(form: GfLiveForm, marker: string, now?: Date): Record<number, string>`
  - `submitForm(browser: Browser, ctx: SiteContext, url: string, formId: string, gfId: number, opts?: { values?: Record<number, string>; timeoutMs?: number }): Promise<FormSubmission>`
  - `deps = { runWp }` in `src/qa/forms.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/qa-forms.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formValues, tomorrow, type GfLiveForm } from "../../src/qa/forms.js";

const form: GfLiveForm = { id: 1, fields: [
  { id: 1, type: "text" }, { id: 2, type: "email" }, { id: 3, type: "phone" }, { id: 4, type: "date" },
  { id: 5, type: "number" }, { id: 6, type: "textarea" },
  { id: 7, type: "select", choices: [{ text: "Mariage", value: "mariage" }, { text: "Autre", value: "autre" }] },
  { id: 8, type: "website" }, { id: 9, type: "select", choices: "" },
] };

describe("formValues", () => {
  it("gives every field a valid value carrying the marker where it is free text", () => {
    const v = formValues(form, "fq1", new Date(2026, 11, 31, 12));
    expect(v).toEqual({
      1: "Test Faktory fq1", 2: "qa+fq1@faktory.test", 3: "+33 6 00 00 00 00", 4: "01/01/2027",
      5: "2", 6: "Message de test Faktory fq1", 7: "mariage", 8: "Test Faktory fq1", 9: "",
    });
  });
});

describe("tomorrow", () => {
  it("formats the next day as dd/mm/yyyy", () => {
    expect(tomorrow(new Date(2026, 8, 14, 23, 30))).toBe("15/09/2026");
  });
});
```

In `tests/unit/qa-schema.test.ts`, next to the `untranslated` default test, add:

```ts
  it("accepts a stored check without formSubmissions and defaults it to []", () => {
    const { formSubmissions: _f, ...old } = check();
    expect(parsePageCheck(old).formSubmissions).toEqual([]);
  });
  it("lists a failed form submission as an automated issue", () => {
    const c = { ...check(), formSubmissions: [
      { formId: "contact", gfId: 2, url: "http://localhost:8101/contact/", ok: true, checkedAt: "2026-09-14T00:00:00.000Z" },
      { formId: "devis_evenement", gfId: 1, url: "http://localhost:8101/commandes-evenements/", ok: false, error: "aucune entrée créée", checkedAt: "2026-09-14T00:00:00.000Z" },
    ] };
    expect(checkIssues(parsePageCheck(c))).toContain("formulaire devis_evenement (#1) : aucune entrée créée");
    expect(checkIssues(parsePageCheck(c)).filter((l) => l.startsWith("formulaire"))).toHaveLength(1);
  });
```

Read the top of `tests/unit/qa-schema.test.ts` first: if its `check()` helper builds a literal, add `formSubmissions: []` to it; import `checkIssues` if it is not imported yet.

In `tests/unit/qa-report.test.ts`, add:

```ts
  it("adds the submitted forms row only on pages that carry a tested form", () => {
    const r = report();
    r.pages[0].check = { ...r.pages[0].check, formSubmissions: [
      { formId: "contact", gfId: 2, url: r.pages[0].url, ok: false, error: "pas de confirmation (« Ce champ est obligatoire. »)", checkedAt: "2026-09-14T00:00:00.000Z" },
    ] };
    const md = renderQaReport(r, "X");
    expect(md).toContain("| Formulaires soumis | 0/1 |");
    expect(md).toContain("formulaire contact (#2) : pas de confirmation (« Ce champ est obligatoire. »)");
    expect(md.match(/Formulaires soumis/g)).toHaveLength(1);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/qa-forms.test.ts tests/unit/qa-schema.test.ts tests/unit/qa-report.test.ts`
Expected: FAIL — `src/qa/forms.ts` missing, `formSubmissions` unknown to the strict schema.

- [ ] **Step 3: Extend the schema in `src/schemas/qa.ts`**

Above `PageCheckSchema`:

```ts
/** One real submission of a Gravity Forms form by the qa stage (spec B3). */
export const FormSubmissionSchema = z.strictObject({
  formId: z.string(),
  gfId: z.number().int().positive(),
  url: z.string().url(),
  ok: z.boolean(),
  error: z.string().optional(),
  checkedAt: z.string(),
});
export type FormSubmission = z.infer<typeof FormSubmissionSchema>;
```

In `PageCheckSchema`, after `untranslated`:

```ts
  formSubmissions: z.array(FormSubmissionSchema).default([]),
```

In `checkIssues`, after the `untranslated` line:

```ts
  for (const f of c.formSubmissions) if (!f.ok) out.push(`formulaire ${f.formId} (#${f.gfId}) : ${f.error ?? "échec"}`);
```

- [ ] **Step 4: Report row and browser literal**

`src/qa/report.ts`, in `pageSection`, replace the `Textes non traduits` line with:

```ts
    `| Textes non traduits | ${c.untranslated.length} |`,
    ...(c.formSubmissions.length ? [`| Formulaires soumis | ${c.formSubmissions.filter((f) => f.ok).length}/${c.formSubmissions.length} |`] : []),
```

`src/qa/browser.ts`, in the `check` literal of `checkPage`, after `untranslated: audit.untranslated,` add `formSubmissions: [],`.

Fixtures: in `fixtures/qa/contact.check.json` and in each `check` object of `fixtures/qa/report.json` (2 occurrences), add `"formSubmissions": [],` after the `"untranslated": [],` line. Then run `grep -rn "untranslated: \[" tests src` and add `formSubmissions: []` to any other `PageCheck` literal the grep shows.

- [ ] **Step 5: Implement `src/qa/forms.ts`**

```ts
import type { Browser } from "playwright";
import type { SiteContext } from "../docker.js";
import { runWp } from "../wp.js";
import { VIEWPORTS, type FormSubmission } from "../schemas/qa.js";

export const deps = { runWp };

/** The parts of `wp gf form get <id>` the submission needs. */
export type GfLiveField = { id: number; type: string; isRequired?: boolean; choices?: { text: string; value: string }[] | "" };
export type GfLiveForm = { id: number | string; fields: GfLiveField[] };

const pad = (n: number): string => String(n).padStart(2, "0");

/** The next day in the `dmy` format Faktory gives its date fields. */
export function tomorrow(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** A valid value for every field of the live form; free-text values carry `marker` so the entry can be found and deleted. */
export function formValues(form: GfLiveForm, marker: string, now: Date = new Date()): Record<number, string> {
  const out: Record<number, string> = {};
  for (const f of form.fields) {
    switch (f.type) {
      case "email": out[f.id] = `qa+${marker}@faktory.test`; break;
      case "phone": out[f.id] = "+33 6 00 00 00 00"; break;
      case "date": out[f.id] = tomorrow(now); break;
      case "number": out[f.id] = "2"; break;
      case "textarea": out[f.id] = `Message de test Faktory ${marker}`; break;
      case "select": out[f.id] = Array.isArray(f.choices) && f.choices.length ? f.choices[0].value : ""; break;
      default: out[f.id] = `Test Faktory ${marker}`;
    }
  }
  return out;
}

type EntryRow = { id: string | number } & Record<string, unknown>;

/**
 * Fill and send form `gfId` on `url` like a visitor, wait for its confirmation, then find the entry by its marker and
 * delete it. Never throws: every problem is reported as `ok: false` with a French `error`. The admin notification is
 * not checked (no SMTP in the stack).
 */
export async function submitForm(
  browser: Browser, ctx: SiteContext, url: string, formId: string, gfId: number,
  opts: { values?: Record<number, string>; timeoutMs?: number } = {},
): Promise<FormSubmission> {
  const done = (error?: string): FormSubmission => ({ formId, gfId, url, ok: !error, ...(error ? { error } : {}), checkedAt: new Date().toISOString() });
  const marker = `fq${Date.now()}`;
  try {
    const got = await deps.runWp(ctx, ["gf", "form", "get", String(gfId)]);
    if (got.code !== 0) return done(`formulaire introuvable : ${(got.stderr || got.stdout).trim().slice(0, 200)}`);
    const form = JSON.parse(got.stdout) as GfLiveForm;
    const values = { ...formValues(form, marker), ...opts.values };
    let problem: string | undefined;
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "load", timeout: 60_000 });
      for (const f of form.fields) {
        const selector = `#input_${gfId}_${f.id}`, value = values[f.id] ?? "";
        if (f.type === "select") { if (value) await page.selectOption(selector, value); }
        else await page.fill(selector, value);
      }
      await page.keyboard.press("Escape"); // closes the date picker, which can cover the submit button
      await page.click(`#gform_submit_button_${gfId}`);
      try {
        await page.locator(`#gform_confirmation_message_${gfId}`).waitFor({ timeout: opts.timeoutMs ?? 15_000 });
      } catch {
        const messages = await page.locator(".gfield_validation_message, .gform_submission_error").allInnerTexts().catch(() => [] as string[]);
        problem = `pas de confirmation (« ${messages.map((m) => m.trim()).filter(Boolean).join(" ; ").slice(0, 200)} »)`;
      }
    } finally {
      await context.close();
    }
    const listed = await deps.runWp(ctx, ["gf", "entry", "list", String(gfId), "--format=json", "--page_size=50"]);
    const entries = listed.code === 0 ? (JSON.parse(listed.stdout) as EntryRow[]) : [];
    const entry = entries.find((e) => Object.values(e).some((v) => typeof v === "string" && v.includes(marker)));
    if (!entry) return done(problem ?? "aucune entrée créée");
    // An entry is always removed, even when the confirmation was missing.
    const removed = await deps.runWp(ctx, ["gf", "entry", "delete", String(entry.id), "--force"]);
    if (removed.code !== 0) return done(problem ?? `entrée #${entry.id} non supprimée`);
    return done(problem);
  } catch (err) {
    return done((err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 300));
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS, no type error.

- [ ] **Step 7: Commit**

```bash
git add src/qa/forms.ts src/schemas/qa.ts src/qa/report.ts src/qa/browser.ts fixtures/qa tests/unit/qa-forms.test.ts tests/unit/qa-schema.test.ts tests/unit/qa-report.test.ts
git commit -m "feat(faktory): submit a Gravity Forms form like a visitor and report it in the page check"
```

(add any other test file changed by the `grep` in Step 4.)

---

### Task 8: QA stage submits every form; budget slots for reviews (B3, part 2 + B1)

**Files:**
- Modify: `src/stages/qa.ts`
- Modify: `tests/unit/stage-qa.test.ts`, `tests/integration/qa.test.ts`

**Interfaces:**
- Consumes: `submitForm`, `type FormSubmission` (Task 7); `withBudgetSlots` (Task 1); `formPages`, `type FormsManifest` (`src/schemas/forms-manifest.ts`).
- Produces:
  - `deps.submitForm` in `src/stages/qa.ts`
  - `formTargets(spec: SiteSpec, forms: FormsManifest, targets: Target[]): { formId: string; gfId: number; target: Target }[]`

- [ ] **Step 1: Write the failing unit tests**

In `tests/unit/stage-qa.test.ts`, add `gfPlacement` import (`import { gfPlacement } from "../../src/schemas/forms-manifest.js";`), add `parsePageCheck` to the `schemas/qa.js` import, add `formTargets` to the `stages/qa.js` import, then add inside `describe("qa stage")`:

```ts
  const writeForms = (c: SiteContext) => {
    mkdirSync(join(c.siteDir, "content"), { recursive: true });
    writeFileSync(join(c.siteDir, "content/forms.json"), JSON.stringify({
      devis_evenement: { gfId: 1, placement: gfPlacement(1) }, contact: { gfId: 2, placement: gfPlacement(2) },
    }));
  };
  it("targets each form once, on the first page of the spec that carries it", async () => {
    const c = await ctx();
    const t = formTargets(spec, { devis_evenement: { gfId: 1, placement: gfPlacement(1) }, contact: { gfId: 2, placement: gfPlacement(2) } }, qaTargets(c, spec));
    expect(t.map((x) => [x.formId, x.gfId, x.target.slug])).toEqual([["devis_evenement", 1, "commandes-evenements"], ["contact", 2, "contact"]]);
  });
  it("submits every form after the reviews and records the result in that page's check and report", async () => {
    const c = await ctx(); writeForms(c);
    const s = spies();
    const submit = vi.spyOn(deps, "submitForm").mockImplementation(async (_b, _c, url, formId, gfId) => ({
      formId, gfId, url, ok: formId === "contact", ...(formId === "contact" ? {} : { error: "aucune entrée créée" }), checkedAt: "2026-09-14T00:00:00.000Z",
    }));
    await qaStage.run(c);
    expect(submit.mock.calls.map((k: any) => [k[3], k[4], new URL(k[2]).pathname])).toEqual([["devis_evenement", 1, "/commandes-evenements/"], ["contact", 2, "/contact/"]]);
    expect(s.close).toHaveBeenCalledTimes(1);
    const report = parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8")));
    expect(report.pages.find((p) => p.slug === "contact")!.check.formSubmissions).toMatchObject([{ formId: "contact", ok: true }]);
    expect(report.pages.find((p) => p.slug === "accueil")!.check.formSubmissions).toEqual([]);
    expect(parsePageCheck(JSON.parse(readFileSync(checkPath(c, "commandes-evenements"), "utf8"))).formSubmissions[0].error).toBe("aucune entrée créée");
    expect(readFileSync(qaReportMdPath(c), "utf8")).toContain("formulaire devis_evenement (#1) : aucune entrée créée");
  });
  it("submits nothing without a forms manifest", async () => {
    const c = await ctx();
    spies();
    const submit = vi.spyOn(deps, "submitForm");
    await qaStage.run(c);
    expect(submit).not.toHaveBeenCalled();
  });
```

If `stage-qa.test.ts` has no `SiteContext` import, it already imports `type SiteContext` from `../../src/docker.js` (see its header) — keep one import.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/stage-qa.test.ts`
Expected: FAIL — `formTargets` not exported, `deps.submitForm` missing.

- [ ] **Step 3: Implement in `src/stages/qa.ts`**

1. Imports — add:

```ts
import { assertBudget, withBudgetSlots } from "../budget.js";
import { submitForm } from "../qa/forms.js";
import { formPages, type FormsManifest } from "../schemas/forms-manifest.js";
```

(replace the existing `assertBudget` import.)

2. `deps` and constant:

```ts
export const deps = { ensurePages, launchBrowser, checkPage, reviewPage, republishPage, readQaReport, submitForm };
// Pages audited in parallel; their review agents share the remaining budget (see withBudgetSlots).
export const QA_CONCURRENCY = 3;
```

3. After `qaTargets`, add:

```ts
/** Each form of the manifest once, on the first sitemap page that carries it (spec B3); forms on no target are skipped. */
export function formTargets(spec: SiteSpec, forms: FormsManifest, targets: Target[]): { formId: string; gfId: number; target: Target }[] {
  const out: { formId: string; gfId: number; target: Target }[] = [];
  for (const [formId, entry] of Object.entries(forms)) {
    const target = targets.find((t) => t.slug === formPages(spec, formId)[0]);
    if (target) out.push({ formId, gfId: entry.gfId, target });
  }
  return out;
}
```

4. Replace the block

```ts
    let results: PromiseSettledResult<QaPage>[];
    try { results = await mapLimit(targets, QA_CONCURRENCY, audit); }
    finally { await browser.close(); }
```

with:

```ts
    let results: PromiseSettledResult<QaPage>[];
    try {
      results = await withBudgetSlots(ctx, QA_CONCURRENCY, () => mapLimit(targets, QA_CONCURRENCY, audit));
      // After the review rounds, so a republished page is never submitted twice; sequential, one browser context each.
      for (const f of formTargets(spec, forms, targets)) {
        const settled = results[targets.indexOf(f.target)];
        if (settled.status !== "fulfilled") continue;
        const s = await deps.submitForm(browser, ctx, f.target.url, f.formId, f.gfId);
        console.log(`  ${s.ok ? "✔" : "✖"} ${label(f.target)} form ${f.formId} (#${f.gfId}) ${s.ok ? "submitted" : `— ${s.error}`}`);
        const page = settled.value;
        page.check = { ...page.check, formSubmissions: [...page.check.formSubmissions, s] };
        writeCheck(ctx, page.slug, page.check);
      }
    } finally { await browser.close(); }
```

`forms` is the `readFormsManifest(ctx)` value already read at the top of `run`.

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS, no type error.

- [ ] **Step 5: Extend the Docker QA integration test**

In `tests/integration/qa.test.ts`:
1. Imports: `import { wpJson } from "../../src/wp.js";`, `import { launchBrowser } from "../../src/qa/browser.js";` (merge with the existing `chromiumInstalled` import), `import { submitForm } from "../../src/qa/forms.js";`, `import { readFormsManifest } from "../../src/pages/placements.js";`.
2. At the end of the first `it` (after `expect(html).toContain("gb-element-");`), add:

```ts
    // B3: every form really submits, and the test entry is removed afterwards
    const forms = readFormsManifest(ctx);
    const devis = report.pages.find((p) => p.slug === "commandes-evenements")!.check.formSubmissions;
    const contact = report.pages.find((p) => p.slug === "contact")!.check.formSubmissions;
    expect(devis, JSON.stringify(devis)).toMatchObject([{ formId: "devis_evenement", gfId: forms.devis_evenement.gfId, ok: true }]);
    expect(contact, JSON.stringify(contact)).toMatchObject([{ formId: "contact", gfId: forms.contact.gfId, ok: true }]);
    for (const { gfId } of Object.values(forms)) expect(await wpJson<unknown[]>(ctx, ["gf", "entry", "list", String(gfId)]), `entries of #${gfId}`).toEqual([]);
```

3. Add a third test at the end of the `describe`:

```ts
  it("reports a submission that fails validation, quoting the message, and leaves no entry", async () => {
    const forms = readFormsManifest(ctx);
    const browser = await launchBrowser();
    try {
      const url = `http://localhost:${ctx.state.port}/contact/`;
      const s = await submitForm(browser, ctx, url, "contact", forms.contact.gfId, { values: { 1: "" } }); // field 1 "Nom" is required
      expect(s.ok).toBe(false);
      expect(s.error).toMatch(/^pas de confirmation \(« .+ »\)$/);
      expect(await wpJson<unknown[]>(ctx, ["gf", "entry", "list", String(forms.contact.gfId)])).toEqual([]);
    } finally { await browser.close(); }
  }, 120_000);
```

- [ ] **Step 6: Run the integration test**

Run: `FAKTORY_DOCKER=1 npx vitest run tests/integration/qa.test.ts --testTimeout=600000 --hookTimeout=600000`
Expected: PASS (3 tests). Debug a failing submission before changing any assertion:
- `pas de confirmation («  »)` with no message: take a screenshot in `submitForm` (temporarily) and check whether the page reloaded — GF may render the confirmation in a `.gform_confirmation_wrapper` whose inner id differs in this GF version; read the rendered HTML with `curl` after a manual POST and fix the selector in `src/qa/forms.ts` and the Global Constraints of this plan.
- a validation message on the date or phone field: fix the value in `formValues` (and its unit test) to the format GF accepts.
- `aucune entrée créée` with a confirmation: `wp gf entry list` output format differs; print it and adapt the `EntryRow` lookup.

- [ ] **Step 7: Commit**

```bash
git add src/stages/qa.ts tests/unit/stage-qa.test.ts tests/integration/qa.test.ts
git commit -m "feat(faktory): qa submits every form once and shares the budget among review agents"
```

---

### Task 9: Documentation

**Files:**
- Modify: `README.md`, `docs/GETTING-STARTED.md`

- [ ] **Step 1: README**

1. In « Usage », after the `resync` line, add:

```
npm run faktory -- run boulangerie --yes          # unattended: approves spec and design on the way (and confirms a regeneration)
npm run faktory -- status boulangerie --history   # every stage run and approval recorded in sites/<slug>/runs.jsonl
npm run faktory -- compare boulangerie-8a boulangerie-8b   # cost · duration per stage, side by side
```

2. In the paragraph that starts `` `faktory resync <slug>` is for edits…``, replace its last sentence (« Conversely, `run --only spec` … overwrites any hand edits to the `.md`/`.json`. ») with: « Conversely, `run --only spec` (or `--from`/`--only design`) regenerates that artifact from the brief and overwrites hand edits: when the `.md` already exists Faktory lists what it will overwrite, asks `[y/N]` (refused without a terminal unless `--yes`), then sets every later stage back to `pending`. `pages/*.gb.json` and `content/articles/*.json` are kept and reused by their stages; delete them for a full rebuild. »
3. In the `faktory.json` paragraph (« Sites live in `sites/<slug>/` … »), append: « Since phase 8b1 every stage run and approval is also appended to `sites/<slug>/runs.jsonl` (run id, status, cost, duration, Faktory commit, options); `faktory status <slug> --history` lists it and `faktory compare` reads it, falling back to `faktory.json` for older sites. »
4. In « QA », append: « After the review rounds, each Gravity Forms form of `content/forms.json` is filled and sent once in the browser, on the first page that carries it; the confirmation and the new entry are checked, then the entry is deleted. A failure is an automatic defect of that page (`qa/<slug>.check.json` → `formSubmissions`). The admin e-mail is not checked (no SMTP). »
5. In « Cost », replace « The SDK also receives the remaining budget as `maxBudgetUsd`. » with « Each agent receives a reserved share of the remaining budget as `maxBudgetUsd`: inside the concurrent loops of `pages`, `content` and `qa`, what is left after the site's spend and the caps of the agents still running is divided among the free slots, so concurrent agents cannot add up to more than `maxCostUsd` (beyond each one's last turn). When the budget is tight an agent can be stopped mid-run and its page fails. »
6. In « Stages », replace « Phases 8b (pipeline reliability) and 8c (delivery) are planned in … » with « Phase 8b1 adds the budget ledger, `run --yes`, the regeneration confirmation, page title refresh, the form submission test and the run history — see `docs/superpowers/specs/2026-09-14-faktory-phase8b1-design.md`. Phases 8b2 (real images, accessibility, Lighthouse, visual diff) and 8c (delivery) are planned in `docs/superpowers/specs/2026-09-14-faktory-phase8-design.md`. »

- [ ] **Step 2: GETTING-STARTED**

1. In « 7. Build the site », add after the first command block: « To go from brief to bundle without stopping at the checkpoints, run `npm run faktory -- run my-site --yes` instead: spec and design are approved as generated (the brief gaps warning is still printed). »
2. In « 8. Follow progress and cost », add: « `npm run faktory -- status my-site --history` lists every stage run and approval with its cost, duration and Faktory commit; `npm run faktory -- compare site-a site-b` compares two sites stage by stage. »
3. In « 9. Review the result », add: « `QA-REPORT.md` shows `| Formulaires soumis | n/m |` on pages with a form: QA sent each form once and deleted the test entry. »
4. In « Change something and re-run », add: « Regenerating the spec or the design (`run --only spec`, `--from design`…) asks for confirmation, because it overwrites your edits, then sets the later stages back to pending. Page titles changed in `SITE-SPEC.md` are applied to WordPress by the next `provision`, `pages`, `content` or `qa` run. »
5. In « Troubleshooting », add a row: `| Régénérer design écrase des éditions manuelles ; relancez avec --yes pour confirmer | You ran a regeneration without a terminal (script, nohup). Add --yes once you are sure. |`

Read each section before editing so the sentences fit the existing wording; keep the file's tone and formatting.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/GETTING-STARTED.md
git commit -m "docs(faktory): phase 8b1 options, history, form test and budget sharing"
```

---

### Task 10: Verification run and « Écarts et mesures »

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-faktory-phase8b1-design.md`

- [ ] **Step 1: Full test pass**

Run: `npm test && npm run typecheck`
Then: `FAKTORY_DOCKER=1 npx vitest run tests/integration/provision.test.ts tests/integration/qa.test.ts tests/integration/content.test.ts --testTimeout=600000 --hookTimeout=600000`
Expected: all PASS. Record any flaky or skipped test in « Écarts ».

- [ ] **Step 2: Start the unattended run, detached**

```bash
npm run faktory -- init boulangerie-8b --brief fixtures/briefs/boulangerie.md
nohup npm run faktory -- run boulangerie-8b --yes > sites/boulangerie-8b/run.log 2>&1 &
```

Note the port printed by `init`. The run takes ≈ 27 min and ≈ $16; check progress with `npm run faktory -- status boulangerie-8b` and `tail -n 20 sites/boulangerie-8b/run.log`, never by blocking a tool call for more than 10 minutes.

- [ ] **Step 3: Check the expected outcome**

1. `grep -E "auto-approved|informations à compléter" sites/boulangerie-8b/run.log` → both checkpoints auto-approved, the gaps warning present.
2. `grep -E "error_max_budget_usd|Cost budget reached" sites/boulangerie-8b/run.log` → nothing.
3. `npm run faktory -- status boulangerie-8b --history` → one block, 10 events (8 stages, 2 approvals), all `done` / `awaiting_approval`.
4. `python3 -c "import json;r=json.load(open('sites/boulangerie-8b/qa/report.json'));print([(p['slug'],p['check']['formSubmissions']) for p in r['pages'] if p['check']['formSubmissions']])"` → one `ok: true` per form.
5. For each `gfId` of `sites/boulangerie-8b/content/forms.json`: `wp gf entry list <gfId> --format=json` through the site's `wpcli` container → `[]`.
6. `npm run faktory -- compare boulangerie-8a boulangerie-8b` → copy the table.

If an expectation fails, investigate the cause (superpowers:systematic-debugging) and fix it in its own commit before writing the measures; re-run only the stage concerned (`--only qa`, for example).

- [ ] **Step 4: Budget ledger under a real cap**

```bash
SPENT=$(python3 -c "import json;print(json.load(open('sites/boulangerie-8b/faktory.json'))['costUsd'])")
npm run faktory -- run boulangerie-8b --only qa --max-cost $(python3 -c "print(round($SPENT + 1, 2))") 2>&1 | tee sites/boulangerie-8b/qa-cap.log
```

Record: whether any review agent ran (reviews of unchanged trees are reused at $0), the final `costUsd`, and whether it stayed ≤ cap + one turn per agent. If every review was reused, say that the invariant is covered by `tests/unit/budget.test.ts` and `tests/unit/agent-budget.test.ts` only.

- [ ] **Step 5: Write « Écarts et mesures »**

Replace « À compléter après exécution. » in the spec with, in French and in the style of the phase 8a section:
- « Écarts au design »: the seven planning deviations listed at the top of this plan, plus anything changed during execution (selectors, value formats, flaky tests).
- « Run neuf `boulangerie-8b` »: the `compare` table against `boulangerie-8a`, the run log checks of Step 3, the QA results (URLs, remaining defects, form submissions), the budget-cap check of Step 4.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-09-14-faktory-phase8b1-design.md
git commit -m "docs(faktory): phase 8b1 end-to-end measurements, deviations"
```
