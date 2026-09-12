import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { artifactPath, hasArtifact, readJsonArtifact } from "../../src/artifacts.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { specStage, deps } from "../../src/stages/spec.js";
import { deps as resyncDeps } from "../../src/resync.js";

const fixture = JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8"));
async function ctx() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-spec-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}

describe("spec stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("is a checkpoint that asks for a structured site spec with Read only", async () => {
    const c = await ctx();
    const spy = vi.spyOn(deps, "runAgent").mockResolvedValue({ text: "", structured: fixture, costUsd: 0.42, numTurns: 3 });
    expect(specStage.checkpoint).toBe(true);
    const msg = await specStage.run(c);
    const call = spy.mock.calls[0][1];
    expect(call.stage).toBe("spec");
    expect(call.allowedTools).toEqual(["Read"]);
    expect(call.outputFormat?.type).toBe("json_schema");
    expect(call.systemPrompt).toContain("brief.md");
    expect(hasArtifact(c, "siteSpecJson")).toBe(true);
    expect(readFileSync(artifactPath(c, "siteSpecMd"), "utf8")).toContain("# SITE-SPEC — Maison Rivet");
    expect(readJsonArtifact(c, "siteSpecJson", parseSiteSpec).sitemap).toHaveLength(6);
    expect(msg).toMatch(/SITE-SPEC.md.*6 pages.*1 feature.*2 forms.*\$0.42/);
  });
  it("fails loudly when the structured output is invalid", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockResolvedValue({ text: "", structured: { identity: {} }, costUsd: 0.1, numTurns: 1 });
    await expect(specStage.run(c)).rejects.toThrow(/Invalid site spec/);
    expect(hasArtifact(c, "siteSpecJson")).toBe(false);
  });
  it("onApprove re-syncs site-spec.json only when SITE-SPEC.md was edited", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockResolvedValue({ text: "", structured: fixture, costUsd: 0.4, numTurns: 3 });
    await specStage.run(c);
    const spy = vi.spyOn(resyncDeps, "runAgent").mockResolvedValue({ text: "", structured: { ...fixture, identity: { ...fixture.identity, name: "Maison Rivet & Fils" } }, costUsd: 0.2, numTurns: 2 });
    expect(await specStage.onApprove!(c)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    const future = new Date(Date.now() + 5000); utimesSync(artifactPath(c, "siteSpecMd"), future, future);
    expect(await specStage.onApprove!(c)).toMatch(/re-synced/);
    expect(readJsonArtifact(c, "siteSpecJson", parseSiteSpec).identity.name).toBe("Maison Rivet & Fils");
  });
});
