import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { pageTreePath } from "../../src/artifacts.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { parsePluginManifest, manifestPath } from "../../src/schemas/plugin-manifest.js";
import { gfPlacement, formsManifestPath } from "../../src/schemas/forms-manifest.js";
import { integratePlugin, pageUrl, deps } from "../../src/plugins/integrate.js";
import { deps as renderDeps } from "../../src/pages/render-check.js";
import type { SiteContext } from "../../src/docker.js";
import { featureMarker, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type PageTree } from "../../src/schemas/page-tree.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const manifest = parsePluginManifest(JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8")));
const IDS = { accueil: 10, "nos-produits": 11 };

async function ctx(): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-int-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  mkdirSync(join(c.siteDir, "pages"), { recursive: true });
  copyFileSync("fixtures/plugins/catalogue_produits.manifest.json", manifestPath(c, "catalogue_produits"));
  return c;
}
function spies(html = (slug: string) => `<html><div data-faktory-plugin="catalogue_produits" data-page="${slug}"></div></html>`) {
  const compile = vi.spyOn(deps, "compilePage").mockImplementation(async (_c, slug) => `<!-- ${slug} -->`);
  const publish = vi.spyOn(deps, "publishPage").mockResolvedValue(undefined);
  const fetchText = vi.spyOn(renderDeps, "fetchText").mockImplementation(async (url) => html(url));
  return { compile, publish, fetchText };
}

describe("pageUrl", () => {
  it("maps the home to / and other pages to /<slug>/", async () => {
    const c = await ctx();
    const home = spec.sitemap.find((p) => p.kind === "home")!, other = spec.sitemap.find((p) => p.slug === "nos-produits")!;
    expect(pageUrl(c, home)).toBe(`http://localhost:${c.state.port}/`);
    expect(pageUrl(c, other)).toBe(`http://localhost:${c.state.port}/nos-produits/`);
  });
});

describe("integratePlugin", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("recompiles, republishes and checks every placement page whose tree exists; skips the others", async () => {
    const c = await ctx();
    copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, "accueil"));
    const s = spies();
    const r = await integratePlugin(c, spec, manifest, IDS);
    expect(r).toEqual({ pages: ["accueil"], skipped: ["nos-produits"] });
    const tree = s.compile.mock.calls[0][2] as PageTree;
    expect(JSON.stringify(tree)).toContain('"view\\":\\"featured\\"');
    expect(JSON.stringify(tree)).not.toContain("data-faktory-feature");
    expect(s.publish).toHaveBeenCalledWith(c, 10, "<!-- accueil -->");
    expect(s.fetchText).toHaveBeenCalledWith(`http://localhost:${c.state.port}/`);
  });
  it("fails when the published page does not render the plugin attribute", async () => {
    const c = await ctx();
    copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, "accueil"));
    spies(() => "<html>no plugin here</html>");
    await expect(integratePlugin(c, spec, manifest, IDS)).rejects.toThrow(/\/ \(accueil\) does not render data-faktory-plugin="catalogue_produits" — check the render function and that the block is registered/);
  });
  it("propagates fetch errors and invalid trees", async () => {
    const c = await ctx();
    copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, "accueil"));
    const s = spies();
    s.fetchText.mockRejectedValue(new Error("GET http://x → 500"));
    await expect(integratePlugin(c, spec, manifest, IDS)).rejects.toThrow(/GET http:\/\/x → 500/);
  });
  it("returns no pages when no tree exists yet", async () => {
    const c = await ctx();
    const s = spies();
    expect(await integratePlugin(c, spec, manifest, IDS)).toEqual({ pages: [], skipped: ["accueil", "nos-produits"] });
    expect(s.compile).not.toHaveBeenCalled();
  });
  it("also applies and checks the forms manifest when republishing", async () => {
    const c = await ctx();
    // commandes-evenements carries a form (devis_evenement) and isn't a placement of the fixture manifest
    // (which only places on accueil / nos-produits) — extend it here so the tree exercises both wrappers.
    const extended = { ...manifest, placements: { ...manifest.placements, "commandes-evenements": '<!-- wp:faktory/catalogue-produits {"view":"list"} /-->' } };
    writeFileSync(manifestPath(c, "catalogue_produits"), JSON.stringify(extended));
    writeFileSync(formsManifestPath(c), JSON.stringify({ devis_evenement: { gfId: 2, placement: gfPlacement(2) } }));
    const tree: PageTree = [{
      type: "element", tagName: "section", innerBlocks: [
        { type: "text", tagName: "h1", content: "Commandes & événements" },
        { type: "element", tagName: "div", htmlAttributes: { [FEATURE_WRAPPER_ATTR]: "catalogue_produits" }, innerBlocks: [
          { type: "raw", rawMarkup: featureMarker("catalogue_produits") } ] },
        { type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: "devis_evenement" }, innerBlocks: [
          { type: "raw", rawMarkup: formMarker("devis_evenement") } ] },
      ],
    }];
    writeFileSync(pageTreePath(c, "commandes-evenements"), JSON.stringify(tree));
    const ids = { ...IDS, "commandes-evenements": 12 };
    const s = spies(() => '<div data-faktory-plugin="catalogue_produits"></div><div id="gform_wrapper_2"></div>');
    const r = await integratePlugin(c, spec, extended, ids);
    expect(r.pages).toEqual(["commandes-evenements"]);
    const compiled = s.compile.mock.calls[0][2] as PageTree;
    const json = JSON.stringify(compiled);
    expect(json).toContain(gfPlacement(2).replace(/"/g, '\\"'));
    expect(json).not.toContain(FORM_WRAPPER_ATTR);
  });
  it("fails when the published page does not render the form wrapper", async () => {
    const c = await ctx();
    const extended = { ...manifest, placements: { ...manifest.placements, "commandes-evenements": '<!-- wp:faktory/catalogue-produits {"view":"list"} /-->' } };
    writeFileSync(manifestPath(c, "catalogue_produits"), JSON.stringify(extended));
    writeFileSync(formsManifestPath(c), JSON.stringify({ devis_evenement: { gfId: 2, placement: gfPlacement(2) } }));
    const tree: PageTree = [{
      type: "element", tagName: "section", innerBlocks: [
        { type: "text", tagName: "h1", content: "Commandes & événements" },
        { type: "element", tagName: "div", htmlAttributes: { [FEATURE_WRAPPER_ATTR]: "catalogue_produits" }, innerBlocks: [
          { type: "raw", rawMarkup: featureMarker("catalogue_produits") } ] },
        { type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: "devis_evenement" }, innerBlocks: [
          { type: "raw", rawMarkup: formMarker("devis_evenement") } ] },
      ],
    }];
    writeFileSync(pageTreePath(c, "commandes-evenements"), JSON.stringify(tree));
    const ids = { ...IDS, "commandes-evenements": 12 };
    spies(() => '<div data-faktory-plugin="catalogue_produits"></div>');
    await expect(integratePlugin(c, spec, extended, ids)).rejects.toThrow(/does not render gform_wrapper_2"/);
  });
});
