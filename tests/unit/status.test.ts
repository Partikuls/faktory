import { describe, it, expect } from "vitest";
import { createState, setStage, STAGES } from "../../src/state.js";
import { renderStatus, renderHistory, renderCompare, formatDuration, formatCost, totalDurationMs } from "../../src/status.js";
import type { RunRecord, StageTotal } from "../../src/history.js";

function sample() {
  let s = createState("demo", 8102, "pw");
  s = setStage(s, "spec", "done", "SITE-SPEC.md written: 6 pages", { costUsd: 0.52, durationMs: 61000 });
  s = setStage(s, "design", "done", "approved", { costUsd: 1.2, durationMs: 125500 });
  s = setStage(s, "provision", "done", "installed", { costUsd: 0, durationMs: 3600000 + 5000 });
  s = setStage(s, "plugins", "running");
  return { ...s, costUsd: 1.72 };
}

describe("formatDuration", () => {
  it("prints seconds, minutes and hours", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(61000)).toBe("1m 01s");
    expect(formatDuration(125500)).toBe("2m 06s");
    expect(formatDuration(3605000)).toBe("1h 00m 05s");
  });
  it("prints a dash when unknown", () => {
    expect(formatDuration(undefined)).toBe("–");
  });
});

describe("formatCost", () => {
  it("prints two decimals or a dash", () => {
    expect(formatCost(1.2)).toBe("$1.20");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(undefined)).toBe("–");
  });
});

describe("totalDurationMs", () => {
  it("sums the stages that have a duration", () => {
    expect(totalDurationMs(sample())).toBe(61000 + 125500 + 3605000);
  });
});

describe("renderStatus", () => {
  it("lists every stage with status, cost, duration and message, then the totals and the url", () => {
    const out = renderStatus(sample());
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^demo — http:\/\/localhost:8102 \(admin: admin\)/);
    expect(out).toContain("spec");
    expect(out).toMatch(/spec\s+done\s+\$0\.52\s+1m 01s\s+SITE-SPEC\.md written: 6 pages/);
    expect(out).toMatch(/plugins\s+running\s+–\s+–/);
    expect(out).toMatch(/pages\s+pending/);
    expect(out).toMatch(/total\s+\$1\.72\s+1h 03m 12s/);
  });
  it("marks the checkpoint awaiting approval", () => {
    const s = setStage(createState("demo", 8100, "pw"), "spec", "awaiting_approval", "SITE-SPEC.md written", { costUsd: 0.5, durationMs: 1000 });
    expect(renderStatus(s)).toMatch(/spec\s+awaiting_approval/);
    expect(renderStatus(s)).toContain("faktory approve demo");
  });
});

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
