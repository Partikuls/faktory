import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import {
  kebab, pluginSlug, blockName, shortcodeName, RENDER_ATTR, PLUGINS_DIR, manifestRel, manifestPath, pluginDirRel, pluginDirPath,
  requiredPluginFiles, parsePluginManifest, placementPages, validatePluginManifest, assertPluginManifest,
} from "../../src/schemas/plugin-manifest.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const feature = spec.features[0];
const manifest = JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8"));
const ctx = { siteDir: "/tmp/fk/sites/demo" } as SiteContext;

describe("naming and paths", () => {
  it("derives everything from the feature id", () => {
    expect(kebab("catalogue_produits")).toBe("catalogue-produits");
    expect(pluginSlug("catalogue_produits")).toBe("faktory-catalogue-produits");
    expect(blockName("produits")).toBe("faktory/produits");
    expect(shortcodeName("catalogue_produits")).toBe("faktory_catalogue_produits");
    expect(RENDER_ATTR).toBe("data-faktory-plugin");
    expect(PLUGINS_DIR).toBe("plugins");
    expect(manifestRel("produits")).toBe("plugins/produits.json");
    expect(manifestPath(ctx, "produits")).toBe("/tmp/fk/sites/demo/plugins/produits.json");
    expect(pluginDirRel("catalogue_produits")).toBe("wp-content/plugins/faktory-catalogue-produits");
    expect(pluginDirPath(ctx, "catalogue_produits")).toBe("/tmp/fk/sites/demo/wp-content/plugins/faktory-catalogue-produits");
  });
  it("lists the contract files", () => {
    expect(requiredPluginFiles("catalogue_produits")).toEqual([
      "faktory-catalogue-produits.php", "includes/post-type.php", "includes/taxonomies.php", "includes/meta.php", "includes/admin-columns.php",
      "includes/render.php", "blocks/catalogue-produits/block.json", "blocks/catalogue-produits/render.php", "blocks/catalogue-produits/index.js",
      "blocks/catalogue-produits/index.asset.php", "style.css", "uninstall.php",
    ]);
  });
});

describe("parsePluginManifest", () => {
  it("accepts the fixture manifest", () => {
    expect(parsePluginManifest(manifest).placements["accueil"]).toContain("wp:faktory/catalogue-produits");
  });
  it("rejects unknown keys, empty placements and a non-snake_case feature", () => {
    expect(() => parsePluginManifest({ ...manifest, extra: 1 })).toThrow(/Invalid plugin manifest/);
    expect(() => parsePluginManifest({ ...manifest, placements: { accueil: "" } })).toThrow(/placements.accueil/);
    expect(() => parsePluginManifest({ ...manifest, feature: "Catalogue-Produits" })).toThrow(/feature/);
  });
});

describe("placementPages / validatePluginManifest", () => {
  it("lists the pages whose custom-query sections reference the feature", () => {
    expect(placementPages(spec, "catalogue_produits")).toEqual(["accueil", "nos-produits"]);
    expect(placementPages(spec, "nope")).toEqual([]);
  });
  it("accepts the fixture manifest for the fixture feature", () => {
    expect(validatePluginManifest(parsePluginManifest(manifest), spec, feature)).toEqual([]);
    expect(() => assertPluginManifest(parsePluginManifest(manifest), spec, feature)).not.toThrow();
  });
  it("cross-checks every derived value against the spec", () => {
    const m = parsePluginManifest({ ...manifest, feature: "produits", plugin: "produits", postType: "product", block: "faktory/x", shortcode: "x" });
    const issues = validatePluginManifest(m, spec, feature);
    expect(issues).toContainEqual(expect.stringMatching(/feature must be "catalogue_produits"/));
    expect(issues).toContainEqual(expect.stringMatching(/plugin must be "faktory-catalogue-produits"/));
    expect(issues).toContainEqual(expect.stringMatching(/postType must be "produit"/));
    expect(issues).toContainEqual(expect.stringMatching(/block must be "faktory\/catalogue-produits"/));
    expect(issues).toContainEqual(expect.stringMatching(/shortcode must be "faktory_catalogue_produits"/));
  });
  it("requires one placement per page that shows the feature and none elsewhere", () => {
    const m = parsePluginManifest({ ...manifest, placements: { accueil: manifest.placements.accueil, contact: manifest.placements.accueil } });
    const issues = validatePluginManifest(m, spec, feature);
    expect(issues).toContainEqual(expect.stringMatching(/missing placement for page "nos-produits"/));
    expect(issues).toContainEqual(expect.stringMatching(/unexpected placement for page "contact"/));
  });
  it("requires block-comment placements for this block and refuses forbidden markup", () => {
    const m = parsePluginManifest({ ...manifest, placements: { accueil: "[faktory_catalogue_produits]", "nos-produits": "<!-- wp:faktory/catalogue-produits /--><script>x</script>" } });
    const issues = validatePluginManifest(m, spec, feature);
    expect(issues).toContainEqual(expect.stringMatching(/placements.accueil: must be a self-closing block comment <!-- wp:faktory\/catalogue-produits/));
    expect(issues).toContainEqual(expect.stringMatching(/placements.nos-produits: forbidden markup \(<script\)/));
    expect(() => assertPluginManifest(m, spec, feature)).toThrow(/plugins\/catalogue_produits.json is invalid:\n- /);
  });
  it("accepts a placement without attributes", () => {
    const m = parsePluginManifest({ ...manifest, placements: { accueil: "<!-- wp:faktory/catalogue-produits /-->", "nos-produits": manifest.placements["nos-produits"] } });
    expect(validatePluginManifest(m, spec, feature)).toEqual([]);
  });
});
