import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite, siteDir } from "../../src/workspace.js";
import { readState, setStage, writeState } from "../../src/state.js";
import { runSite, approveSite, type Stage } from "../../src/pipeline.js";

function setup() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-")));
  initSite(config, { slug: "pp", briefPath: "fixtures/briefs/boulangerie.md" });
  return config;
}
const ok = (name: Stage["name"], checkpoint = false, log: string[] = []): Stage => ({ name, checkpoint, run: async () => { log.push(name); return `${name} ok`; } });

describe("runSite", () => {
  it("runs stages in order, skips unregistered ones, and stops at a checkpoint", async () => {
    const config = setup(); const log: string[] = [];
    const stages = { spec: ok("spec", true, log), design: ok("design", false, log) };
    const s = await runSite(config, "pp", { stages });
    expect(log).toEqual(["spec"]);
    expect(s.stages.spec.status).toBe("awaiting_approval");
    expect(s.stages.design.status).toBe("pending");
  });
  it("refuses to run while a checkpoint awaits approval, then resumes after approve", async () => {
    const config = setup(); const log: string[] = [];
    const stages = { spec: ok("spec", true, log), design: ok("design", false, log) };
    await runSite(config, "pp", { stages });
    await expect(runSite(config, "pp", { stages })).rejects.toThrow(/awaits approval/);
    approveSite(config, "pp");
    const s = await runSite(config, "pp", { stages });
    expect(log).toEqual(["spec", "design"]);
    expect(s.stages.design.status).toBe("done");
    expect(s.stages.provision.status).toBe("done");
    expect(s.stages.provision.message).toMatch(/skipped/);
  });
  it("marks a throwing stage failed and rethrows", async () => {
    const config = setup();
    const stages = { spec: { name: "spec", run: async () => { throw new Error("kaboom"); } } as Stage };
    await expect(runSite(config, "pp", { stages })).rejects.toThrow("kaboom");
    const s = readState(siteDir(config, "pp"));
    expect(s.stages.spec.status).toBe("failed");
    expect(s.stages.spec.message).toBe("kaboom");
  });
  it("--only runs a single stage even if earlier ones are pending", async () => {
    const config = setup(); const log: string[] = [];
    const s = await runSite(config, "pp", { only: "design", stages: { design: ok("design", false, log) } });
    expect(log).toEqual(["design"]);
    expect(s.stages.spec.status).toBe("pending");
  });
  it("--from restarts at the given stage", async () => {
    const config = setup(); const log: string[] = [];
    const dir = siteDir(config, "pp");
    writeState(dir, setStage(setStage(readState(dir), "spec", "done"), "design", "done"));
    await runSite(config, "pp", { from: "spec", stages: { spec: ok("spec", false, log), design: ok("design", false, log) } });
    expect(log).toEqual(["spec", "design"]);
  });
});
