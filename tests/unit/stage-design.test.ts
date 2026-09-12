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
/** Simulates what the agent writes during its run. */
function agentWrites(c: ReturnType<typeof loadContext>, files: { md?: boolean; markup?: boolean; preview?: boolean } = { md: true, markup: true, preview: true }) {
  mkdirSync(join(c.siteDir, "design"), { recursive: true });
  if (files.md) writeFileSync(artifactPath(c, "designSystemMd"), "# Maison Rivet — Design System Web\n");
  if (files.markup) writeFileSync(artifactPath(c, "previewMarkup"), "<!-- wp:generateblocks/element {} --><div></div><!-- /wp:generateblocks/element -->\n");
  if (files.preview) writeFileSync(artifactPath(c, "previewHtml"), "<!doctype html><html><head><style>:root{--accent:#2563eb;}</style></head><body></body></html>");
}

describe("design stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("refuses to run without site-spec.json", async () => {
    const c = await ctx(false);
    await expect(designStage.run(c)).rejects.toThrow(/site-spec.json not found/);
  });
  it("runs the agent with Read/Write/gb tools, validates tokens, writes design-tokens.json and re-renders the preview", async () => {
    const c = await ctx();
    const run = vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { agentWrites(cc); return { text: "", structured: tokens, costUsd: 1.5, numTurns: 20 }; });
    const preview = vi.spyOn(deps, "gbPreview").mockResolvedValue(undefined);
    expect(designStage.checkpoint).toBe(true);
    const msg = await designStage.run(c);
    const call = run.mock.calls[0][1];
    expect(call.stage).toBe("design");
    expect(call.allowedTools).toEqual(["Read", "Write", TOOL_GB_BUILD, TOOL_GB_PREVIEW]);
    expect(call.outputFormat?.type).toBe("json_schema");
    expect(call.systemPrompt).toContain("design-system.md");
    expect(call.prompt).toContain("Maison Rivet");
    expect(readJsonArtifact(c, "designTokensJson", parseDesignTokens).containerWidth).toBe(1140);
    expect(preview).toHaveBeenCalledWith(c.config, artifactPath(c, "previewMarkup"), artifactPath(c, "previewHtml"), expect.objectContaining({ containerWidth: 1140, headingFont: "Fraunces" }));
    expect(msg).toMatch(/design-system.md.*design-tokens.json.*preview.html.*\$1.50/);
  });
  it("fails when the agent did not write design-system.md or the preview markup", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { agentWrites(cc, { md: false, markup: true, preview: true }); return { text: "", structured: tokens, costUsd: 1, numTurns: 5 }; });
    await expect(designStage.run(c)).rejects.toThrow(/design-system.md/);
    expect(hasArtifact(c, "designTokensJson")).toBe(false);
  });
  it("fails on invalid tokens before writing anything", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { agentWrites(cc); return { text: "", structured: { ...tokens, palette: {} }, costUsd: 1, numTurns: 5 }; });
    await expect(designStage.run(c)).rejects.toThrow(/Invalid design tokens/);
    expect(hasArtifact(c, "designTokensJson")).toBe(false);
  });
  it("builds a user prompt from the spec", () => {
    const p = designUserPrompt(parseSiteSpec(spec));
    expect(p).toContain("Maison Rivet");
    expect(p).toContain("Boulangerie-pâtisserie artisanale");
    expect(p).toContain("accueil");
    expect(p).toContain("hero");
  });
});
