import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPlacements, pluginPlacements, formPlacements, readPluginManifests, readFormsManifest, type Placement,
} from "../../src/pages/placements.js";
import { parsePluginManifest } from "../../src/schemas/plugin-manifest.js";
import { parseFormsManifest, gfPlacement } from "../../src/schemas/forms-manifest.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { findWrapper, findMarkers, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type PageTree } from "../../src/schemas/page-tree.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const tree = (): PageTree => JSON.parse(readFileSync("fixtures/pages/accueil.gb.json", "utf8"));
const manifest = parsePluginManifest(JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8")));
const forms = parseFormsManifest(JSON.parse(readFileSync("fixtures/content/forms.json", "utf8")));
const contact = spec.sitemap.find((p) => p.slug === "contact")!;

/** A contact-page tree with the form wrapper the pages prompt requires. */
const contactTree = (): PageTree => [{
  type: "element", tagName: "section", innerBlocks: [
    { type: "text", tagName: "h1", content: "Contact" },
    { type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: "contact" }, innerBlocks: [
      { type: "raw", rawMarkup: formMarker("contact") },
      { type: "text", tagName: "p", content: "Le formulaire sera disponible ici." },
    ] },
  ],
}];

describe("pluginPlacements / formPlacements", () => {
  it("builds one feature placement per manifest that places on the page", () => {
    expect(pluginPlacements([manifest], "accueil")).toEqual([{ attr: FEATURE_WRAPPER_ATTR, id: "catalogue_produits", markup: manifest.placements["accueil"] }]);
    expect(pluginPlacements([manifest], "contact")).toEqual([]);
  });
  it("builds one form placement per form of the page present in the manifest", () => {
    expect(formPlacements(forms, contact)).toEqual([{ attr: FORM_WRAPPER_ATTR, id: "contact", markup: gfPlacement(1) }]);
    expect(formPlacements({}, contact)).toEqual([]);
    expect(formPlacements(forms, spec.sitemap.find((p) => p.slug === "accueil")!)).toEqual([]);
  });
});

describe("applyPlacements", () => {
  it("replaces the whole feature wrapper with a raw node carrying the placement, without mutating the input", () => {
    const input = tree();
    const before = JSON.stringify(input);
    const r = applyPlacements(input, pluginPlacements([manifest], "accueil"));
    expect(r.applied.map((p) => p.id)).toEqual(["catalogue_produits"]);
    expect(JSON.stringify(input)).toBe(before);
    expect(findWrapper(r.tree, "feature", "catalogue_produits")).toBeUndefined();
    expect(findMarkers(r.tree)).toEqual([]);
    const section = r.tree[1].innerBlocks![0];
    const raw = section.innerBlocks!.find((n) => n.type === "raw")!;
    expect(raw.rawMarkup).toBe(manifest.placements["accueil"]);
  });
  it("replaces the form wrapper (marker + placeholder card) with the Gravity Forms block", () => {
    const r = applyPlacements(contactTree(), formPlacements(forms, contact));
    expect(r.applied.map((p) => p.id)).toEqual(["contact"]);
    expect(findWrapper(r.tree, "form", "contact")).toBeUndefined();
    expect(JSON.stringify(r.tree)).not.toContain("Le formulaire sera disponible ici.");
    expect(r.tree[0].innerBlocks![1]).toEqual({ type: "raw", rawMarkup: gfPlacement(1) });
  });
  it("leaves the tree untouched when nothing matches", () => {
    const none: Placement[] = [{ attr: FORM_WRAPPER_ATTR, id: "other", markup: gfPlacement(9) }];
    const r = applyPlacements(contactTree(), none);
    expect(r.applied).toEqual([]);
    expect(r.tree).toEqual(contactTree());
  });
});

describe("readPluginManifests / readFormsManifest", () => {
  function site(): SiteContext {
    const dir = mkdtempSync(join(tmpdir(), "fk-plc-"));
    return { siteDir: dir } as SiteContext;
  }
  it("return [] / {} when the files do not exist", () => {
    const c = site();
    expect(readPluginManifests(c)).toEqual([]);
    expect(readFormsManifest(c)).toEqual({});
  });
  it("read and re-validate the manifests on disk", () => {
    const c = site();
    mkdirSync(join(c.siteDir, "plugins")); mkdirSync(join(c.siteDir, "content"));
    writeFileSync(join(c.siteDir, "plugins/catalogue_produits.json"), readFileSync("fixtures/plugins/catalogue_produits.manifest.json"));
    writeFileSync(join(c.siteDir, "content/forms.json"), readFileSync("fixtures/content/forms.json"));
    expect(readPluginManifests(c).map((m) => m.feature)).toEqual(["catalogue_produits"]);
    expect(readFormsManifest(c)).toEqual(forms);
  });
  it("fail with the file name when a manifest is invalid JSON or invalid", () => {
    const c = site();
    mkdirSync(join(c.siteDir, "content"));
    writeFileSync(join(c.siteDir, "content/forms.json"), "{nope");
    expect(() => readFormsManifest(c)).toThrow(/content\/forms.json is not valid JSON/);
    writeFileSync(join(c.siteDir, "content/forms.json"), JSON.stringify({ contact: { gfId: 1, placement: "<script>" } }));
    expect(() => readFormsManifest(c)).toThrow(/content\/forms.json is invalid/);
  });
});
