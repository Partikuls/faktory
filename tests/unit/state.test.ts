import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES, createState, readState, writeState, setStage, firstIncompleteStage, awaitingStage } from "../../src/state.js";

describe("state", () => {
  it("creates a state with every stage pending", () => {
    const s = createState("demo", 8100, "pw");
    expect(Object.keys(s.stages)).toEqual([...STAGES]);
    expect(s.stages.spec.status).toBe("pending");
    expect(s.costUsd).toBe(0);
    expect(s.adminUser).toBe("admin");
  });
  it("round-trips through faktory.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "faktory-"));
    const s = createState("demo", 8100, "pw");
    writeState(dir, s);
    expect(readState(dir)).toEqual(s);
  });
  it("rejects a corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "faktory-"));
    writeState(dir, createState("demo", 8100, "pw"));
    writeFileSync(join(dir, "faktory.json"), "{\"slug\":1}");
    expect(() => readState(dir)).toThrow();
  });
  it("setStage returns a new state with timestamp and message", () => {
    const s = setStage(createState("demo", 8100, "pw"), "spec", "failed", "boom");
    expect(s.stages.spec.status).toBe("failed");
    expect(s.stages.spec.message).toBe("boom");
    expect(s.stages.spec.updatedAt).toBeTruthy();
  });
  it("firstIncompleteStage skips done stages and stops at awaiting_approval", () => {
    let s = createState("demo", 8100, "pw");
    s = setStage(s, "spec", "done");
    expect(firstIncompleteStage(s)).toBe("design");
    s = setStage(s, "design", "awaiting_approval");
    expect(firstIncompleteStage(s)).toBe("design");
    expect(awaitingStage(s)).toBe("design");
    s = setStage(s, "design", "done");
    expect(awaitingStage(s)).toBeUndefined();
  });
  it("firstIncompleteStage is undefined when everything is done", () => {
    let s = createState("demo", 8100, "pw");
    for (const n of STAGES) s = setStage(s, n, "done");
    expect(firstIncompleteStage(s)).toBeUndefined();
  });
});
