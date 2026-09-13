import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { artifactPath, hasArtifact, readJsonArtifact, writeJsonArtifact } from "../../src/artifacts.js";
import { parseDesignTokens } from "../../src/schemas/design-tokens.js";
import { designStage, designUserPrompt, deps } from "../../src/stages/design.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { TOOL_GB_BUILD, TOOL_GB_PREVIEW } from "../../src/tools/server.js";

const spec = JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8"));
const tokens = JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8"));

async function ctx(withSpec = true) {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-design-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  if (withSpec) writeJsonArtifact(c, "siteSpecJson", spec);
  return c;
}
const PREVIEW_TREE = [{ type: "element", tagName: "section", innerBlocks: [{ type: "text", tagName: "h1", content: "Bonjour" }] }];

/** Simulates what the agent writes during its run. */
function agentWrites(c: ReturnType<typeof loadContext>, files: { md?: boolean; tree?: boolean } = { md: true, tree: true }) {
  mkdirSync(join(c.siteDir, "design"), { recursive: true });
  if (files.md) writeFileSync(artifactPath(c, "designSystemMd"), "# Maison Rivet — Design System Web\n");
  if (files.tree) writeFileSync(artifactPath(c, "previewTree"), JSON.stringify(PREVIEW_TREE));
}

describe("design stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("refuses to run without site-spec.json", async () => {
    const c = await ctx(false);
    await expect(designStage.run(c)).rejects.toThrow(/site-spec.json not found/);
  });
  it("runs the agent with Read/Write/gb tools, compiles+renders the preview itself, validates tokens and writes design-tokens.json", async () => {
    const c = await ctx();
    const run = vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { agentWrites(cc); return { text: "", transcript: "", structured: tokens, costUsd: 1.5, numTurns: 20 }; });
    const markup = "<!-- wp:generateblocks/element {} -->\n<section></section>\n<!-- /wp:generateblocks/element -->\n";
    const build = vi.spyOn(deps, "gbBuild").mockResolvedValue(markup);
    const preview = vi.spyOn(deps, "gbPreview").mockResolvedValue(undefined);
    expect(designStage.checkpoint).toBe(true);
    const msg = await designStage.run(c);
    const call = run.mock.calls[0][1];
    expect(call.stage).toBe("design");
    expect(call.allowedTools).toEqual(["Read", "Write", TOOL_GB_BUILD, TOOL_GB_PREVIEW]);
    expect(call.outputFormat?.type).toBe("json_schema");
    expect(call.systemPrompt).toContain("design-system.md");
    expect(call.prompt).toContain("Maison Rivet");
    expect(build).toHaveBeenCalledWith(c.config, PREVIEW_TREE);
    expect(readFileSync(artifactPath(c, "previewMarkup"), "utf8")).toBe(markup);
    expect(preview).toHaveBeenCalledWith(c.config, artifactPath(c, "previewMarkup"), artifactPath(c, "previewHtml"), expect.objectContaining({ containerWidth: 1140, headingFont: "Fraunces" }));
    expect(readJsonArtifact(c, "designTokensJson", parseDesignTokens).containerWidth).toBe(1140);
    expect(msg).toMatch(/design-system.md.*design-tokens.json.*preview.html.*\$1.50/);
  });
  it("fails when the agent did not write design-system.md", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { agentWrites(cc, { md: false, tree: true }); return { text: "", transcript: "", structured: tokens, costUsd: 1, numTurns: 5 }; });
    await expect(designStage.run(c)).rejects.toThrow(/design-system.md/);
    expect(hasArtifact(c, "designTokensJson")).toBe(false);
  });
  it("fails when the agent did not write design/preview.gb.json", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { agentWrites(cc, { md: true, tree: false }); return { text: "", transcript: "", structured: tokens, costUsd: 1, numTurns: 5 }; });
    await expect(designStage.run(c)).rejects.toThrow(/preview.gb.json/);
    expect(hasArtifact(c, "designTokensJson")).toBe(false);
  });
  it("fails when gb_build rejects", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { agentWrites(cc); return { text: "", transcript: "", structured: tokens, costUsd: 1, numTurns: 5 }; });
    vi.spyOn(deps, "gbBuild").mockRejectedValue(new Error("gb_build.py failed (exit 1): KeyError"));
    await expect(designStage.run(c)).rejects.toThrow(/gb_build.py failed/);
    expect(hasArtifact(c, "designTokensJson")).toBe(false);
  });
  it("fails on invalid tokens before writing anything", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { agentWrites(cc); return { text: "", transcript: "", structured: { ...tokens, palette: {} }, costUsd: 1, numTurns: 5 }; });
    vi.spyOn(deps, "gbBuild").mockResolvedValue("<!-- wp:generateblocks/element {} -->\n<section></section>\n<!-- /wp:generateblocks/element -->\n");
    vi.spyOn(deps, "gbPreview").mockResolvedValue(undefined);
    await expect(designStage.run(c)).rejects.toThrow(/Invalid design tokens/);
    expect(hasArtifact(c, "designTokensJson")).toBe(false);
  });
  it("retries once when the agent forgot a file, and succeeds if the retry writes it", async () => {
    const c = await ctx();
    const run = vi.spyOn(deps, "runAgent")
      .mockImplementationOnce(async (cc) => { agentWrites(cc, { md: true, tree: false }); return { text: "", transcript: "", structured: tokens, costUsd: 1, sessionId: "d-1", numTurns: 5 }; })
      .mockImplementationOnce(async (cc) => { agentWrites(cc); return { text: "", transcript: "", structured: tokens, costUsd: 0.3, sessionId: "d-1", numTurns: 3 }; });
    vi.spyOn(deps, "gbBuild").mockResolvedValue("<!-- wp:generateblocks/element {} -->\n<section></section>\n<!-- /wp:generateblocks/element -->\n");
    vi.spyOn(deps, "gbPreview").mockResolvedValue(undefined);
    const msg = await designStage.run(c);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][1].resume).toBe("d-1");
    expect(run.mock.calls[1][1].prompt).toMatch(/preview\.gb\.json/);
    expect(msg).toMatch(/\$1\.30/);
  });
  it("builds a user prompt from the spec", () => {
    const p = designUserPrompt(parseSiteSpec(spec));
    expect(p).toContain("Maison Rivet");
    expect(p).toContain("Boulangerie-pâtisserie artisanale");
    expect(p).toContain("accueil");
    expect(p).toContain("hero");
  });
});
