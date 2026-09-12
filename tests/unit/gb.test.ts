import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { gbScript, gbBuild, gbPreview, previewOptionsFromTokens, countBlocks, googleFontsHref, deps } from "../../src/gb.js";
import { parseDesignTokens } from "../../src/schemas/design-tokens.js";

const config = loadConfig(process.cwd());
const synced = existsSync(gbScript(config, "gb_build.py"));
const tokens = parseDesignTokens(JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8")));

describe("gbScript / previewOptionsFromTokens / countBlocks (pure)", () => {
  it("points at the synced skill scripts", () => {
    expect(gbScript(config, "gb_preview.py")).toBe(join(config.repoRoot, "plugin/skills/generatepress-generateblocks/scripts/gb_preview.py"));
  });
  it("maps tokens to GP css variable names and fonts", () => {
    const o = previewOptionsFromTokens(tokens);
    expect(o.palette).toEqual({ base: "#faf6ef", "base-2": "#f1e8d8", "base-3": "#ffffff", contrast: "#2b1d0e", "contrast-2": "#6b5a46", "contrast-3": "#d9cdb8", accent: "#7a8b6f", "accent-2": "#c89b3c" });
    expect(o.fonts).toEqual([{ family: "Fraunces", variants: "400,600,700" }, { family: "Source Sans 3", variants: "400,600" }]);
    expect(o.headingFont).toBe("Fraunces"); expect(o.bodyFont).toBe("Source Sans 3"); expect(o.containerWidth).toBe(1140);
  });
  it("counts GenerateBlocks opening delimiters", () => {
    expect(countBlocks("<!-- wp:generateblocks/element {} -->\n<div></div>\n<!-- /wp:generateblocks/element -->\n<!-- wp:generateblocks/text {} -->x<!-- /wp:generateblocks/text -->")).toBe(2);
  });
  it("formats Google Fonts URL with italic variants in ital,wght axis syntax", () => {
    expect(googleFontsHref([{ family: "Fraunces", variants: "400,400italic,700" }, { family: "Source Sans 3", variants: "400,600" }])).toBe("https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:wght@400;600&display=swap");
  });
  it("surfaces python failures with stderr", async () => {
    vi.spyOn(deps, "run").mockResolvedValue({ stdout: "", stderr: "Traceback: boom", code: 1 });
    await expect(gbBuild(config, {})).rejects.toThrow(/gb_build.py failed.*boom/);
  });
  afterEach(() => vi.restoreAllMocks());
});

describe.skipIf(!synced)("gbBuild / gbPreview (python3)", () => {
  const tree = [{ type: "element", tagName: "section", styles: { backgroundColor: "var(--base-2)", padding: "64px 24px", "@media (max-width:767px)": { padding: "32px 16px" } },
    innerBlocks: [{ type: "text", tagName: "h1", content: "Bonjour", styles: { color: "var(--contrast)" } }] }];
  it("compiles a tree into markup with css and escaped double dashes", async () => {
    const markup = await gbBuild(config, tree);
    expect(markup).toContain("wp:generateblocks/element");
    expect(markup).toContain("\\u002d\\u002dbase-2");
    expect(markup).toMatch(/"css":".gb-element-[a-f0-9]{8}\{background-color:var\(/);
    expect(countBlocks(markup)).toBe(2);
  });
  it("previews with an injected palette, fonts and container width", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fk-gb-"));
    const markupPath = join(dir, "preview.gb.html"), out = join(dir, "preview.html");
    writeFileSync(markupPath, await gbBuild(config, tree));
    await gbPreview(config, markupPath, out, previewOptionsFromTokens(tokens));
    const html = readFileSync(out, "utf8");
    expect(html).toContain("--accent:#7a8b6f");
    expect(html).toContain("--gb-container-width:1140px");
    expect(html).toContain("fonts.googleapis.com/css2?family=Fraunces:wght@400;600;700&family=Source+Sans+3:wght@400;600");
    expect(html).toContain('body{font-family:"Source Sans 3"');
    expect(html).toContain('h1,h2,h3,h4,h5,h6{font-family:"Fraunces"');
    expect(html).toContain("<h1");
    expect(html).not.toContain("wp:generateblocks");
  });
  it("keeps the stub palette when no options are given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fk-gb-"));
    const markupPath = join(dir, "p.html"), out = join(dir, "p.preview.html");
    writeFileSync(markupPath, await gbBuild(config, tree));
    await gbPreview(config, markupPath, out);
    expect(readFileSync(out, "utf8")).toContain("--accent:#2563eb");
  });
});
