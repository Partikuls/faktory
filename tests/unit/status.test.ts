import { describe, it, expect } from "vitest";
import { createState, setStage } from "../../src/state.js";
import { renderStatus, formatDuration, formatCost, totalDurationMs } from "../../src/status.js";

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
