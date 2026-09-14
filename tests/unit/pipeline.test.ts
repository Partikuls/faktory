import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite, siteDir } from "../../src/workspace.js";
import { STAGES, readState, setStage, writeState, type StageName } from "../../src/state.js";
import { runSite, approveSite, resyncSite, destroySite, loadContext, deps, registry, type Stage } from "../../src/pipeline.js";
import { artifactPath, writeJsonArtifact, writeTextArtifact } from "../../src/artifacts.js";
import { deps as resyncDeps } from "../../src/resync.js";
import { addCost } from "../../src/agent.js";
import { readRuns, deps as historyDeps } from "../../src/history.js";

async function setup() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-")));
  await initSite(config, { slug: "pp", briefPath: "fixtures/briefs/boulangerie.md" });
  return config;
}
const ok = (name: Stage["name"], checkpoint = false, log: string[] = []): Stage => ({ name, checkpoint, run: async () => { log.push(name); return `${name} ok`; } });

/** All eight stages as stubs; spec and design are checkpoints with an onApprove that logs. */
function allStages(log: string[], approvals: string[] = []): Partial<Record<StageName, Stage>> {
  return Object.fromEntries(STAGES.map((name) => {
    const checkpoint = name === "spec" || name === "design";
    const stage: Stage = { name, checkpoint, run: async () => { log.push(name); return `${name} ok`; } };
    if (checkpoint) stage.onApprove = async () => { approvals.push(name); return undefined; };
    return [name, stage];
  }));
}

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
  it("--only spec also names the design files design will regenerate, only when they exist", async () => {
    const noticeFor = async (withDesign: boolean) => {
      const config = await setup();
      const dir = siteDir(config, "pp");
      let st = readState(dir);
      for (const name of STAGES) st = setStage(st, name, "done");
      writeState(dir, st);
      const ctx = loadContext(config, "pp");
      writeTextArtifact(ctx, "siteSpecMd", "# spec");
      if (withDesign) { writeTextArtifact(ctx, "designSystemMd", "# design"); writeJsonArtifact(ctx, "designTokensJson", {}); }
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await runSite(config, "pp", { only: "spec", yes: true, stages: { spec: ok("spec") } });
      const lines = warn.mock.calls.map((c) => String(c[0])).join("\n");
      warn.mockRestore();
      return lines;
    };
    const withDesign = await noticeFor(true);
    expect(withDesign).toContain("⚠ Régénérer spec écrase : SITE-SPEC.md\n  Seront régénérés ensuite par design : design-system.md, design-tokens.json\n");
    const without = await noticeFor(false);
    expect(without).toContain("⚠ Régénérer spec écrase : SITE-SPEC.md");
    expect(without).not.toContain("Seront régénérés ensuite par design");
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
