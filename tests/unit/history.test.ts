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
