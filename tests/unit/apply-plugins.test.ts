import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPlugins, readPluginManifests } from "../../src/pages/apply-plugins.js";
import { parsePluginManifest } from "../../src/schemas/plugin-manifest.js";
import { findWrapper, findMarkers, type PageTree } from "../../src/schemas/page-tree.js";
import type { SiteContext } from "../../src/docker.js";

const tree = (): PageTree => JSON.parse(readFileSync("fixtures/pages/accueil.gb.json", "utf8"));
const manifest = parsePluginManifest(JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8")));

describe("applyPlugins", () => {
  it("replaces the whole feature wrapper with a raw node carrying the page's placement", () => {
    const input = tree();
    const before = JSON.stringify(input);
    const r = applyPlugins(input, [manifest], "accueil");
    expect(r.applied).toEqual(["catalogue_produits"]);
    expect(JSON.stringify(input)).toBe(before); // pure
    expect(findWrapper(r.tree, "feature", "catalogue_produits")).toBeUndefined();
    expect(findMarkers(r.tree)).toEqual([]);
    const section = r.tree[1].innerBlocks![0];
    const raw = section.innerBlocks!.find((n) => n.type === "raw")!;
    expect(raw.rawMarkup).toBe(manifest.placements["accueil"]);
    expect(section.innerBlocks!.filter((n) => n.type === "text")).toHaveLength(1); // the h2 stays
  });
  it("leaves the tree untouched when the page has no placement or no manifest matches", () => {
    const r1 = applyPlugins(tree(), [manifest], "contact");
    expect(r1.applied).toEqual([]);
    expect(r1.tree).toEqual(tree());
    const r2 = applyPlugins(tree(), [], "accueil");
    expect(r2.applied).toEqual([]);
    expect(findWrapper(r2.tree, "feature", "catalogue_produits")).toBeDefined();
  });
  it("uses the placement of the given page, not another page's", () => {
    const r = applyPlugins(tree(), [manifest], "nos-produits");
    // the fixture tree is the home tree, but the placement chosen is the nos-produits one
    const raw = r.tree[1].innerBlocks![0].innerBlocks!.find((n) => n.type === "raw")!;
    expect(raw.rawMarkup).toContain('"view":"grid"');
  });
});

describe("readPluginManifests", () => {
  const ctx = (): SiteContext => ({ siteDir: mkdtempSync(join(tmpdir(), "fk-apply-")) } as SiteContext);
  it("returns [] without a plugins dir, else every manifest sorted by file name", () => {
    const c = ctx();
    expect(readPluginManifests(c)).toEqual([]);
    mkdirSync(join(c.siteDir, "plugins"));
    writeFileSync(join(c.siteDir, "plugins/zzz.json"), JSON.stringify({ ...manifest, feature: "zzz", placements: { accueil: "<!-- wp:faktory/zzz /-->" } }));
    writeFileSync(join(c.siteDir, "plugins/catalogue_produits.json"), JSON.stringify(manifest));
    writeFileSync(join(c.siteDir, "plugins/notes.txt"), "ignored");
    expect(readPluginManifests(c).map((m) => m.feature)).toEqual(["catalogue_produits", "zzz"]);
  });
  it("names the offending file on invalid JSON or an invalid manifest", () => {
    const c = ctx();
    mkdirSync(join(c.siteDir, "plugins"));
    writeFileSync(join(c.siteDir, "plugins/bad.json"), "{ nope");
    expect(() => readPluginManifests(c)).toThrow(/plugins\/bad.json is not valid JSON/);
    writeFileSync(join(c.siteDir, "plugins/bad.json"), JSON.stringify({ feature: "bad" }));
    expect(() => readPluginManifests(c)).toThrow(/plugins\/bad.json: Invalid plugin manifest/);
  });
  it("re-checks the placements of every manifest it reads (denylist and block-comment shape)", () => {
    const c = ctx();
    mkdirSync(join(c.siteDir, "plugins"));
    const file = join(c.siteDir, "plugins/catalogue_produits.json");
    writeFileSync(file, JSON.stringify({ ...manifest, placements: { accueil: '<!-- wp:faktory/catalogue-produits /--><script>alert(1)</script>' } }));
    expect(() => readPluginManifests(c)).toThrow(/plugins\/catalogue_produits.json: .*placements.accueil: forbidden markup \(<script\)/);
    writeFileSync(file, JSON.stringify({ ...manifest, placements: { accueil: "[faktory_catalogue_produits]" } }));
    expect(() => readPluginManifests(c)).toThrow(/plugins\/catalogue_produits.json: placements.accueil: must be a self-closing block comment <!-- wp:faktory\/catalogue-produits/);
  });
});
