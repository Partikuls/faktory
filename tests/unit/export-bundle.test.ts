import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { parsePluginManifest } from "../../src/schemas/plugin-manifest.js";
import { readFileSync } from "node:fs";
import { TAR_EXCLUDES, bundleWpContent, listTar, requiredTarEntries, assertTarEntries } from "../../src/export/bundle.js";

const manifest = parsePluginManifest(JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8")));

async function ctx() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-bundle-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  const wc = join(c.siteDir, "wp-content");
  for (const d of ["plugins/generateblocks", "plugins/faktory-catalogue-produits", "themes/generatepress", "themes/faktory-boul", "themes/twentytwentyfive", "uploads/2026/09", "languages", "upgrade"]) mkdirSync(join(wc, d), { recursive: true });
  writeFileSync(join(wc, "index.php"), "<?php // Silence\n");
  writeFileSync(join(wc, "debug.log"), "noise\n");
  writeFileSync(join(wc, "plugins/generateblocks/plugin.php"), "<?php\n");
  writeFileSync(join(wc, "plugins/faktory-catalogue-produits/faktory-catalogue-produits.php"), "<?php\n");
  writeFileSync(join(wc, "themes/generatepress/style.css"), "/* gp */\n");
  writeFileSync(join(wc, "themes/faktory-boul/style.css"), "/* child */\n");
  writeFileSync(join(wc, "themes/twentytwentyfive/style.css"), "/* default */\n");
  writeFileSync(join(wc, "uploads/2026/09/a.png"), "png");
  writeFileSync(join(wc, "languages/fr_FR.mo"), "mo");
  writeFileSync(join(wc, "upgrade/tmp"), "x");
  return c;
}

describe("wp-content bundle", () => {
  it("lists the excludes", () => {
    expect(TAR_EXCLUDES).toEqual(["wp-content/upgrade", "wp-content/debug.log", "wp-content/themes/twenty*"]);
  });
  it("archives wp-content without the excluded paths and lists it back", async () => {
    const c = await ctx();
    const out = join(c.siteDir, "dist", "wp-content.tar.gz");
    const bytes = await bundleWpContent(c, out);
    expect(bytes).toBe(statSync(out).size);
    expect(bytes).toBeGreaterThan(100);
    const listing = await listTar(out);
    expect(listing).toContain("wp-content/index.php");
    expect(listing).toContain("wp-content/themes/generatepress/style.css");
    expect(listing).toContain("wp-content/themes/faktory-boul/style.css");
    expect(listing).toContain("wp-content/plugins/generateblocks/plugin.php");
    expect(listing).toContain("wp-content/uploads/2026/09/a.png");
    expect(listing).toContain("wp-content/languages/fr_FR.mo");
    expect(listing.some((e) => e.includes("twentytwentyfive"))).toBe(false);
    expect(listing.some((e) => e.includes("wp-content/upgrade"))).toBe(false);
    expect(listing).not.toContain("wp-content/debug.log");
  });
  it("requires the parent theme, the child theme, generateblocks and every custom plugin", async () => {
    const c = await ctx();
    expect(requiredTarEntries(c, [manifest])).toEqual([
      "wp-content/themes/generatepress/style.css", "wp-content/themes/faktory-boul/style.css", "wp-content/plugins/generateblocks/", "wp-content/plugins/faktory-catalogue-produits/",
    ]);
    const out = join(c.siteDir, "dist", "wp-content.tar.gz");
    await bundleWpContent(c, out);
    const listing = await listTar(out);
    expect(() => assertTarEntries(listing, requiredTarEntries(c, [manifest]))).not.toThrow();
    expect(() => assertTarEntries(listing, ["wp-content/plugins/faktory-missing/"])).toThrow(/wp-content.tar.gz is missing: wp-content\/plugins\/faktory-missing\//);
  });
  it("fails clearly when tar fails", async () => {
    const c = await ctx();
    // brief.md is a file initSite copies into the site dir: mkdirSync(dirname(out)) throws ENOTDIR
    // (swallowed by bundleWpContent's try/catch), then `tar -czf` itself fails with a non-zero exit.
    await expect(bundleWpContent(c, join(c.siteDir, "brief.md", "x.tar.gz"))).rejects.toThrow(/tar failed/);
  });
});
