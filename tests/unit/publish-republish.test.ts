import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { gfPlacement } from "../../src/schemas/forms-manifest.js";
import { FORM_WRAPPER_ATTR, formMarker, type PageTree } from "../../src/schemas/page-tree.js";
import { republishPage, deps } from "../../src/pages/publish.js";
import { deps as renderDeps } from "../../src/pages/render-check.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const home = spec.sitemap.find((p) => p.kind === "home")!;
const contact = spec.sitemap.find((p) => p.slug === "contact")!;
const homeTree = (): PageTree => JSON.parse(readFileSync("fixtures/pages/accueil.gb.json", "utf8"));
const contactTree = (): PageTree => [{ type: "element", tagName: "section", innerBlocks: [
  { type: "text", tagName: "h1", content: "Contact" },
  { type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: "contact" }, innerBlocks: [{ type: "raw", rawMarkup: formMarker("contact") }, { type: "text", tagName: "p", content: "Le formulaire sera disponible ici." }] },
] }];

async function ctx() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-republish-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}
function spies(html = '<div data-faktory-plugin="catalogue_produits"></div><div id="gform_wrapper_1"></div>') {
  const compile = vi.spyOn(deps, "compilePage").mockImplementation(async (_c, slug) => `<!-- ${slug} -->`);
  const publish = vi.spyOn(deps, "publishPage").mockResolvedValue(undefined);
  const fetchText = vi.spyOn(renderDeps, "fetchText").mockResolvedValue(html);
  return { compile, publish, fetchText };
}

describe("republishPage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("applies the manifests read from the site dir, compiles, publishes and checks the render contract", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "plugins"), { recursive: true });
    copyFileSync("fixtures/plugins/catalogue_produits.manifest.json", join(c.siteDir, "plugins/catalogue_produits.json"));
    const s = spies();
    const r = await republishPage(c, spec, home, 10, homeTree());
    expect(r).toEqual({ markup: "<!-- accueil -->", features: ["catalogue_produits"], forms: [] });
    const compiled = s.compile.mock.calls[0][2] as PageTree;
    expect(JSON.stringify(compiled)).not.toContain("data-faktory-feature");
    expect(s.publish).toHaveBeenCalledWith(c, 10, "<!-- accueil -->");
    expect(s.fetchText).toHaveBeenCalledWith(`http://localhost:${c.state.port}/`);
  });
  it("accepts pre-read manifests and applies form placements", async () => {
    const c = await ctx();
    const s = spies();
    const r = await republishPage(c, spec, contact, 15, contactTree(), { manifests: [], forms: { contact: { gfId: 1, placement: gfPlacement(1) } } });
    expect(r.forms).toEqual(["contact"]);
    expect(JSON.stringify(s.compile.mock.calls[0][2])).toContain("gravityforms/form");
    expect(s.fetchText).toHaveBeenCalledWith(`http://localhost:${c.state.port}/contact/`);
  });
  it("fails when an applied form does not render", async () => {
    const c = await ctx();
    spies("<html>no form</html>");
    await expect(republishPage(c, spec, contact, 15, contactTree(), { manifests: [], forms: { contact: { gfId: 1, placement: gfPlacement(1) } } }))
      .rejects.toThrow(/\/contact\/ \(contact\) does not render gform_wrapper_1"/);
  });
  it("fetches nothing when nothing applies", async () => {
    const c = await ctx();
    const s = spies();
    writeFileSync(join(c.siteDir, "content/forms.json"), "{}");
    const r = await republishPage(c, spec, contact, 15, contactTree());
    expect(r).toEqual({ markup: "<!-- contact -->", features: [], forms: [] });
    expect(s.fetchText).not.toHaveBeenCalled();
  });
});
