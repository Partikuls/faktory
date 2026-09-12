import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite, siteDir } from "../../src/workspace.js";
import { readState, setStage, writeState } from "../../src/state.js";
import { runSite, approveSite, destroySite, deps, type Stage } from "../../src/pipeline.js";

async function setup() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-")));
  await initSite(config, { slug: "pp", briefPath: "fixtures/briefs/boulangerie.md" });
  return config;
}
const ok = (name: Stage["name"], checkpoint = false, log: string[] = []): Stage => ({ name, checkpoint, run: async () => { log.push(name); return `${name} ok`; } });

describe("runSite", () => {
  it("runs stages in order, skips unregistered ones, and stops at a checkpoint", async () => {
    const config = await setup(); const log: string[] = [];
    const stages = { spec: ok("spec", true, log), design: ok("design", false, log) };
    const s = await runSite(config, "pp", { stages });
    expect(log).toEqual(["spec"]);
    expect(s.stages.spec.status).toBe("awaiting_approval");
    expect(s.stages.design.status).toBe("pending");
  });
  it("refuses to run while a checkpoint awaits approval, then resumes after approve", async () => {
    const config = await setup(); const log: string[] = [];
    const stages = { spec: ok("spec", true, log), design: ok("design", false, log) };
    await runSite(config, "pp", { stages });
    await expect(runSite(config, "pp", { stages })).rejects.toThrow(/awaits approval/);
    await approveSite(config, "pp");
    const s = await runSite(config, "pp", { stages });
    expect(log).toEqual(["spec", "design"]);
    expect(s.stages.design.status).toBe("done");
    expect(s.stages.provision.status).toBe("done");
    expect(s.stages.provision.message).toMatch(/skipped/);
  });
  it("marks a throwing stage failed and rethrows", async () => {
    const config = await setup();
    const stages = { spec: { name: "spec", run: async () => { throw new Error("kaboom"); } } as Stage };
    await expect(runSite(config, "pp", { stages })).rejects.toThrow("kaboom");
    const s = readState(siteDir(config, "pp"));
    expect(s.stages.spec.status).toBe("failed");
    expect(s.stages.spec.message).toBe("kaboom");
  });
  it("--only runs a single stage even if earlier ones are pending", async () => {
    const config = await setup(); const log: string[] = [];
    const s = await runSite(config, "pp", { only: "design", stages: { design: ok("design", false, log) } });
    expect(log).toEqual(["design"]);
    expect(s.stages.spec.status).toBe("pending");
  });
  it("--from restarts at the given stage", async () => {
    const config = await setup(); const log: string[] = [];
    const dir = siteDir(config, "pp");
    writeState(dir, setStage(setStage(readState(dir), "spec", "done"), "design", "done"));
    await runSite(config, "pp", { from: "spec", stages: { spec: ok("spec", false, log), design: ok("design", false, log) } });
    expect(log).toEqual(["spec", "design"]);
  });
});

describe("destroySite", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("throws and keeps the workspace when compose down fails", async () => {
    const config = await setup();
    const dir = siteDir(config, "pp");
    vi.spyOn(deps, "composeDown").mockResolvedValue({ stdout: "", stderr: "boom", code: 1 });
    await expect(destroySite(config, "pp")).rejects.toThrow(/docker compose down failed/);
    expect(existsSync(dir)).toBe(true);
  });

  it("removes the workspace anyway when force is set, despite a failing compose down", async () => {
    const config = await setup();
    const dir = siteDir(config, "pp");
    vi.spyOn(deps, "composeDown").mockResolvedValue({ stdout: "", stderr: "boom", code: 1 });
    await destroySite(config, "pp", { force: true });
    expect(existsSync(dir)).toBe(false);
  });
});

describe("approveSite with onApprove", () => {
  it("runs the checkpoint stage's onApprove and stores its message", async () => {
    const config = await setup();
    const spec: Stage = { name: "spec", checkpoint: true, run: async () => "spec ok", onApprove: async () => "site-spec.json re-synced" };
    await runSite(config, "pp", { stages: { spec } });
    const s = await approveSite(config, "pp", { stages: { spec } });
    expect(s.stages.spec.status).toBe("done");
    expect(s.stages.spec.message).toBe("site-spec.json re-synced");
  });
  it("keeps the stage awaiting approval when onApprove throws", async () => {
    const config = await setup();
    const spec: Stage = { name: "spec", checkpoint: true, run: async () => "ok", onApprove: async () => { throw new Error("md invalid"); } };
    await runSite(config, "pp", { stages: { spec } });
    await expect(approveSite(config, "pp", { stages: { spec } })).rejects.toThrow("md invalid");
    expect(readState(siteDir(config, "pp")).stages.spec.status).toBe("awaiting_approval");
  });
  it("defaults the message to approved when there is no onApprove", async () => {
    const config = await setup();
    await runSite(config, "pp", { stages: { spec: ok("spec", true) } });
    const s = await approveSite(config, "pp");
    expect(s.stages.spec.message).toBe("approved");
  });
});

describe("cost budget", () => {
  it("refuses to start a stage once the budget is spent", async () => {
    const config = await setup();
    const dir = siteDir(config, "pp");
    writeState(dir, { ...readState(dir), costUsd: 40 });
    await expect(runSite(config, "pp", { stages: { spec: ok("spec") } })).rejects.toThrow(/Cost budget reached \(\$40.00 >= \$40\)/);
    expect(readState(dir).stages.spec.status).toBe("pending");
  });
  it("honours a raised budget from config", async () => {
    const config = { ...(await setup()), maxCostUsd: 100 };
    const dir = siteDir(config, "pp");
    writeState(dir, { ...readState(dir), costUsd: 40 });
    const log: string[] = [];
    await runSite(config, "pp", { stages: { spec: ok("spec", false, log) } });
    expect(log).toEqual(["spec"]);
  });
});
