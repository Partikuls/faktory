import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { manifestPath, pluginDirPath } from "../../src/schemas/plugin-manifest.js";
import {
  pluginsUserPrompt, readPluginManifest, verifyPlugin, generatePlugin, referencePluginDir, deps, PLUGINS_TOOLS, PLUGINS_MAX_TURNS, MIN_SEED_ENTRIES,
} from "../../src/plugins/generate.js";
import { TOOL_WP, TOOL_PHP_CHECK } from "../../src/tools/server.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const feature = spec.features[0];
const FIXTURE = "fixtures/plugins/faktory-catalogue-produits";
const MANIFEST = "fixtures/plugins/catalogue_produits.manifest.json";

async function ctx(): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-plg-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}
function installFixture(c: SiteContext, opts: { manifest?: boolean } = { manifest: true }): void {
  cpSync(FIXTURE, pluginDirPath(c, feature.id), { recursive: true });
  if (opts.manifest) copyFileSync(MANIFEST, manifestPath(c, feature.id));
}
/** wpJson answers for a healthy plugin: active, CPT registered, 5 entries, all terms. */
function healthyWp(overrides: Partial<Record<string, unknown>> = {}) {
  return vi.spyOn(deps, "wpJson").mockImplementation(async (_c, args: any) => {
    const k = args.slice(0, 2).join(" ");
    if (k in overrides) return overrides[k];
    if (k === "plugin list") return [{ name: "faktory-catalogue-produits", status: "active" }, { name: "generateblocks", status: "active" }];
    if (k === "post-type list") return [{ name: "post" }, { name: "page" }, { name: "produit" }];
    if (k === "post list") return [{ ID: 1 }, { ID: 2 }, { ID: 3 }, { ID: 4 }, { ID: 5 }];
    if (k === "term list") return [{ name: "Pains" }, { name: "Viennoiseries" }, { name: "Pâtisseries" }, { name: "Salé du midi" }];
    throw new Error(`unexpected wp ${args.join(" ")}`);
  });
}
const phpOk = () => vi.spyOn(deps, "phpCheck").mockResolvedValue({ ok: true, output: "OK", files: 9 });

describe("pluginsUserPrompt", () => {
  it("describes the feature, its pages, the contract files and the reference plugin", () => {
    const p = pluginsUserPrompt(spec, feature, { referenceDir: "/repo/fixtures/plugins/faktory-catalogue-produits" });
    expect(p).toContain("# Feature `catalogue_produits` — Catalogue produits");
    expect(p).toContain("CPT `produit` (Produit / Produits)");
    expect(p).toContain("`prix` Prix (price)");
    expect(p).toContain("`disponibilite` Disponibilité (select : Tous les jours | Week-end | Sur commande)");
    expect(p).toContain("`categorie_produit` Catégorie / Catégories : Pains, Viennoiseries, Pâtisseries, Salé du midi");
    expect(p).toContain("- `accueil` (/) — section « ");
    expect(p).toContain("- `nos-produits` (/nos-produits/) — section « ");
    expect(p).toContain("Quatre produits mis en avant depuis le catalogue.");
    expect(p).toContain("Plugin : `wp-content/plugins/faktory-catalogue-produits/`");
    expect(p).toContain("faktory-catalogue-produits.php, includes/post-type.php");
    expect(p).toContain("Manifeste : `plugins/catalogue_produits.json`");
    expect(p).toContain("/repo/fixtures/plugins/faktory-catalogue-produits");
    expect(p).toContain(feature.display);
  });
});

describe("readPluginManifest", () => {
  it("explains a missing file, invalid JSON, an invalid schema and failed cross-checks", async () => {
    const c = await ctx();
    expect(() => readPluginManifest(c, spec, feature)).toThrow(/plugins\/catalogue_produits.json was not written — write it with Write/);
    writeFileSync(manifestPath(c, feature.id), "{ nope");
    expect(() => readPluginManifest(c, spec, feature)).toThrow(/not valid JSON/);
    writeFileSync(manifestPath(c, feature.id), JSON.stringify({ feature: "catalogue_produits" }));
    expect(() => readPluginManifest(c, spec, feature)).toThrow(/Invalid plugin manifest/);
    const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
    writeFileSync(manifestPath(c, feature.id), JSON.stringify({ ...m, placements: { accueil: m.placements.accueil } }));
    expect(() => readPluginManifest(c, spec, feature)).toThrow(/missing placement for page "nos-produits"/);
    copyFileSync(MANIFEST, manifestPath(c, feature.id));
    expect(readPluginManifest(c, spec, feature).plugin).toBe("faktory-catalogue-produits");
  });
});

describe("verifyPlugin", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("returns the manifest and the entry count when everything checks out", async () => {
    const c = await ctx(); installFixture(c);
    const php = phpOk(); healthyWp();
    const r = await verifyPlugin(c, spec, feature);
    expect(r.manifest.feature).toBe("catalogue_produits");
    expect(r.entries).toBe(5);
    expect(php).toHaveBeenCalledWith(c.config, pluginDirPath(c, feature.id));
  });
  it("lists missing contract files before running php_check", async () => {
    const c = await ctx(); installFixture(c);
    writeFileSync(manifestPath(c, feature.id), readFileSync(MANIFEST));
    const { rmSync } = await import("node:fs");
    rmSync(join(pluginDirPath(c, feature.id), "uninstall.php"));
    rmSync(join(pluginDirPath(c, feature.id), "includes/render.php"));
    const php = phpOk();
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/missing file\(s\) in wp-content\/plugins\/faktory-catalogue-produits: includes\/render.php, uninstall.php/);
    expect(php).not.toHaveBeenCalled();
  });
  it("surfaces php_check output", async () => {
    const c = await ctx(); installFixture(c);
    vi.spyOn(deps, "phpCheck").mockResolvedValue({ ok: false, output: "PHPStan level 5:\nincludes/render.php:12:Undefined variable $x", files: 9 });
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/php_check failed:\nPHPStan level 5:\nincludes\/render.php:12/);
  });
  it("refuses a dangerous PHP construct before the plugin is activated", async () => {
    const c = await ctx(); installFixture(c); phpOk(); healthyWp();
    const file = join(pluginDirPath(c, feature.id), "includes/render.php");
    writeFileSync(file, readFileSync(file, "utf8") + "\n$out = eval( $code );\n");
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/forbidden PHP construct\(s\) in wp-content\/plugins\/faktory-catalogue-produits:\n- includes\/render.php:\d+: forbidden PHP construct eval\(/);
  });
  it("refuses hex colors in style.css", async () => {
    const c = await ctx(); installFixture(c); phpOk();
    writeFileSync(join(pluginDirPath(c, feature.id), "style.css"), ".x { color: #fff; }");
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/style.css: hex color #fff/);
  });
  it("requires the plugin to be active, the post type registered, 3 entries and every term", async () => {
    const c = await ctx(); installFixture(c); phpOk();
    healthyWp({ "plugin list": [{ name: "faktory-catalogue-produits", status: "inactive" }] });
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/plugin faktory-catalogue-produits is not active — run wp \["plugin","activate","faktory-catalogue-produits"\]/);
    vi.restoreAllMocks(); phpOk();
    healthyWp({ "post-type list": [{ name: "post" }] });
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/post type "produit" is not registered/);
    vi.restoreAllMocks(); phpOk();
    healthyWp({ "post list": [{ ID: 1 }, { ID: 2 }] });
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/only 2 published "produit" entries, at least 3 expected — seed them with wp post create/);
    vi.restoreAllMocks(); phpOk();
    healthyWp({ "term list": [{ name: "Pains" }] });
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/taxonomy "categorie_produit" is missing term\(s\): Viennoiseries, Pâtisseries, Salé du midi/);
    expect(MIN_SEED_ENTRIES).toBe(3);
  });
});

describe("generatePlugin", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("runs the plugins agent with the plugin tools, scoped writes and the reference dir, then verifies", async () => {
    const c = await ctx(); phpOk(); healthyWp();
    const run = vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { installFixture(cc); return { text: "ok", transcript: "ok", costUsd: 4.2, sessionId: "g-1", numTurns: 40 }; });
    const r = await generatePlugin(c, spec, feature);
    expect(r).toMatchObject({ costUsd: 4.2, attempts: 1, entries: 5 });
    expect(r.manifest.block).toBe("faktory/catalogue-produits");
    const call = run.mock.calls[0][1];
    expect(call.stage).toBe("plugins");
    expect(call.allowedTools).toEqual(PLUGINS_TOOLS);
    expect(PLUGINS_TOOLS).toEqual(["Read", "Write", "Edit", "Glob", "Grep", TOOL_WP, TOOL_PHP_CHECK]);
    expect(call.maxTurns).toBe(PLUGINS_MAX_TURNS);
    expect(call.writeRoots).toEqual(["wp-content/plugins/faktory-catalogue-produits", "plugins"]);
    expect(call.systemPrompt).toContain("Tu es le développeur de plugins WordPress");
    expect(call.prompt).toContain(referencePluginDir(c.config));
    expect(referencePluginDir(c.config)).toBe(join(c.config.repoRoot, "fixtures/plugins/faktory-catalogue-produits"));
  });
  it("retries once in the same session with the verification error", async () => {
    const c = await ctx(); phpOk(); healthyWp();
    const run = vi.spyOn(deps, "runAgent")
      .mockImplementationOnce(async (cc) => { installFixture(cc, { manifest: false }); return { text: "", transcript: "", costUsd: 3, sessionId: "g-2", numTurns: 30 }; })
      .mockImplementationOnce(async (cc) => { copyFileSync(MANIFEST, manifestPath(cc, feature.id)); return { text: "", transcript: "", costUsd: 0.5, sessionId: "g-2", numTurns: 5 }; });
    const r = await generatePlugin(c, spec, feature);
    expect(r).toMatchObject({ costUsd: 3.5, attempts: 2 });
    expect(run.mock.calls[1][1].resume).toBe("g-2");
    expect(run.mock.calls[1][1].prompt).toContain("plugins/catalogue_produits.json was not written");
  });
  it("deletes a manifest that is still invalid after the retry, keeps the plugin dir", async () => {
    const c = await ctx(); phpOk(); healthyWp();
    vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => {
      installFixture(cc);
      const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
      writeFileSync(manifestPath(cc, feature.id), JSON.stringify({ ...m, placements: {} }));
      return { text: "", transcript: "", costUsd: 1, sessionId: "g-3", numTurns: 3 };
    });
    await expect(generatePlugin(c, spec, feature)).rejects.toThrow(/plugins: output still invalid after one retry — .*plugins\/catalogue_produits\.json deleted, the next run regenerates it/s);
    expect(existsSync(manifestPath(c, feature.id))).toBe(false);
    expect(existsSync(pluginDirPath(c, feature.id))).toBe(true);
  });
});
