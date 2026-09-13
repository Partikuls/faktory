import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite, siteDir } from "../../src/workspace.js";
import { readState, setStage, writeState } from "../../src/state.js";
import { runSite, approveSite, resyncSite, destroySite, loadContext, deps, registry, type Stage } from "../../src/pipeline.js";
import { artifactPath, writeJsonArtifact, writeTextArtifact } from "../../src/artifacts.js";
import { deps as resyncDeps } from "../../src/resync.js";
import { addCost } from "../../src/agent.js";

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
  it("warns before a stage starts when SITE-SPEC.md is newer than site-spec.json", async () => {
    const config = await setup();
    const ctx = loadContext(config, "pp");
    writeTextArtifact(ctx, "siteSpecMd", "# spec");
    writeJsonArtifact(ctx, "siteSpecJson", {});
    const future = new Date(Date.now() + 5000);
    utimesSync(artifactPath(ctx, "siteSpecMd"), future, future);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runSite(config, "pp", { stages: { spec: ok("spec", true) } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SITE-SPEC.md is newer than site-spec.json"));
    warn.mockRestore();
  });
});

describe("stage measurement", () => {
  it("records the duration and the cost delta of every stage, including a failing one", async () => {
    const config = await setup();
    const spending: Stage = { name: "spec", run: async (ctx) => { ctx.state = addCost(ctx.state, 1.5); await new Promise((r) => setTimeout(r, 20)); return "spent"; } };
    const failing: Stage = { name: "design", run: async (ctx) => { ctx.state = addCost(ctx.state, 0.25); throw new Error("kaboom"); } };
    await expect(runSite(config, "pp", { stages: { spec: spending, design: failing } })).rejects.toThrow("kaboom");
    const s = readState(siteDir(config, "pp"));
    expect(s.stages.spec.costUsd).toBe(1.5);
    expect(s.stages.spec.durationMs).toBeGreaterThanOrEqual(15);
    expect(s.stages.design.status).toBe("failed");
    expect(s.stages.design.costUsd).toBe(0.25);
    expect(typeof s.stages.design.durationMs).toBe("number");
    expect(s.costUsd).toBe(1.75);
  });
  it("records $0 for a stage that spends nothing", async () => {
    const config = await setup();
    const s = await runSite(config, "pp", { stages: { spec: ok("spec") } });
    expect(s.stages.spec.costUsd).toBe(0);
  });
  it("approveSite keeps the run duration and adds the cost of onApprove to the stage", async () => {
    const config = await setup();
    const spec: Stage = {
      name: "spec", checkpoint: true,
      run: async (ctx) => { ctx.state = addCost(ctx.state, 0.5); return "ok"; },
      onApprove: async (ctx) => { ctx.state = addCost(ctx.state, 0.3); return "re-synced"; },
    };
    const ran = await runSite(config, "pp", { stages: { spec } });
    const s = await approveSite(config, "pp", { stages: { spec } });
    expect(s.stages.spec.costUsd).toBe(0.8);
    expect(s.stages.spec.durationMs).toBe(ran.stages.spec.durationMs);
    expect(s.costUsd).toBe(0.8);
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
  it("approveSite rejects with Cost budget reached and does not call onApprove", async () => {
    const config = await setup();
    const dir = siteDir(config, "pp");
    const onApprove = vi.fn(async () => "resynced");
    const spec: Stage = { name: "spec", checkpoint: true, run: async () => "ok", onApprove };
    await runSite(config, "pp", { stages: { spec } });
    writeState(dir, { ...readState(dir), costUsd: 40 });
    await expect(approveSite(config, "pp", { stages: { spec } })).rejects.toThrow(/Cost budget reached \(\$40.00 >= \$40\)/);
    expect(onApprove).not.toHaveBeenCalled();
  });
});

describe("resyncSite", () => {
  beforeEach(() => vi.restoreAllMocks());
  const spec = JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8"));
  const tokens = JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8"));

  it("re-syncs only the stale targets, via each stage's onApprove", async () => {
    const config = await setup();
    const ctx = loadContext(config, "pp");
    writeTextArtifact(ctx, "siteSpecMd", "# spec"); writeJsonArtifact(ctx, "siteSpecJson", spec);
    writeTextArtifact(ctx, "designSystemMd", "# design"); writeJsonArtifact(ctx, "designTokensJson", tokens);
    const future = new Date(Date.now() + 5000);
    utimesSync(artifactPath(ctx, "siteSpecMd"), future, future); // only SITE-SPEC.md is stale
    const run = vi.spyOn(resyncDeps, "runAgent").mockResolvedValue({ text: "", transcript: "", structured: spec, costUsd: 0.1, numTurns: 2 });
    const resynced = await resyncSite(config, "pp");
    expect(resynced).toEqual(["spec"]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list and calls nothing when nothing is stale", async () => {
    const config = await setup();
    const ctx = loadContext(config, "pp");
    writeTextArtifact(ctx, "siteSpecMd", "# spec"); writeJsonArtifact(ctx, "siteSpecJson", spec);
    const run = vi.spyOn(resyncDeps, "runAgent");
    expect(await resyncSite(config, "pp")).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects with Cost budget reached when the budget is already spent", async () => {
    const config = await setup();
    const dir = siteDir(config, "pp");
    const ctx = loadContext(config, "pp");
    writeTextArtifact(ctx, "siteSpecMd", "# spec"); writeJsonArtifact(ctx, "siteSpecJson", spec);
    const future = new Date(Date.now() + 5000);
    utimesSync(artifactPath(ctx, "siteSpecMd"), future, future);
    writeState(dir, { ...readState(dir), costUsd: 40 });
    const run = vi.spyOn(resyncDeps, "runAgent");
    await expect(resyncSite(config, "pp")).rejects.toThrow(/Cost budget reached/);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("registry", () => {
  it("registers spec, design, provision, pages, plugins and content", () => {
    expect(Object.keys(registry)).toEqual(["spec", "design", "provision", "pages", "plugins", "content", "qa", "export"]);
  });
});
