import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext, registry } from "../../src/pipeline.js";
import { writeJsonArtifact } from "../../src/artifacts.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { gfPlacement } from "../../src/schemas/forms-manifest.js";
import { SITE_URL_PLACEHOLDER } from "../../src/export/db.js";
import { exportStage, deps, DIST_FILES } from "../../src/stages/export.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const VERSIONS = { wordpress: "7.1", plugins: [{ name: "generateblocks", version: "2.4.1", status: "active" }], themes: [{ name: "generatepress", version: "3.6.1", status: "parent" }] };

async function ctx(opts: { manifest?: boolean; forms?: boolean; qa?: boolean } = {}): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stexport-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  writeJsonArtifact(c, "siteSpecJson", spec);
  if (opts.manifest) { mkdirSync(join(c.siteDir, "plugins"), { recursive: true }); copyFileSync("fixtures/plugins/catalogue_produits.manifest.json", join(c.siteDir, "plugins/catalogue_produits.json")); }
  if (opts.forms) writeFileSync(join(c.siteDir, "content/forms.json"), JSON.stringify({ contact: { gfId: 5, placement: gfPlacement(5) } }));
  if (opts.qa) copyFileSync("fixtures/qa/report.json", join(c.siteDir, "qa/report.json"));
  writeFileSync(join(c.siteDir, "dist/stale.txt"), "old");
  return c;
}
function spies(opts: { listing?: string[] } = {}) {
  const order: string[] = [];
  const db = vi.spyOn(deps, "exportDb").mockImplementation(async () => { order.push("db"); return { sql: `-- ${SITE_URL_PLACEHOLDER}\n`, bytes: 30 }; });
  const bundle = vi.spyOn(deps, "bundleWpContent").mockImplementation(async (_c, out) => { order.push("bundle"); mkdirSync(join(out, ".."), { recursive: true }); writeFileSync(out, "tgz"); return 3; });
  const list = vi.spyOn(deps, "listTar").mockResolvedValue(opts.listing ?? ["wp-content/themes/generatepress/style.css", "wp-content/themes/faktory-boul/style.css", "wp-content/plugins/generateblocks/", "wp-content/plugins/faktory-catalogue-produits/"]);
  const versions = vi.spyOn(deps, "gatherVersions").mockImplementation(async () => { order.push("versions"); return VERSIONS; });
  return { db, bundle, list, versions, order };
}

describe("export stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("is registered last in the pipeline, without checkpoint", () => {
    expect(registry.export).toBe(exportStage);
    expect(exportStage.checkpoint).toBeFalsy();
    expect(Object.keys(registry)).toEqual(["spec", "design", "provision", "pages", "plugins", "content", "qa", "export"]);
    expect(DIST_FILES).toEqual(["db.sql", "wp-content.tar.gz", "docker-compose.prod.yml", ".env.example", "README.md", "MANIFEST.json"]);
  });
  it("needs site-spec.json", async () => {
    const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stexport-")));
    await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
    await expect(exportStage.run(loadContext(config, "boul"))).rejects.toThrow(/site-spec.json not found/);
  });
  it("empties dist/, writes the six files and summarizes them with sizes", async () => {
    const c = await ctx({ manifest: true, forms: true, qa: true });
    const s = spies();
    const msg = await exportStage.run(c);
    expect(s.order).toEqual(["db", "bundle", "versions"]);
    const dist = join(c.siteDir, "dist");
    expect(readdirSync(dist).sort()).toEqual([...DIST_FILES].sort());
    expect(existsSync(join(dist, "stale.txt"))).toBe(false);
    expect(readFileSync(join(dist, "db.sql"), "utf8")).toContain(SITE_URL_PLACEHOLDER);
    expect(readFileSync(join(dist, "docker-compose.prod.yml"), "utf8")).toContain("image: mariadb:11");
    expect(readFileSync(join(dist, ".env.example"), "utf8")).toContain("SITE_PORT=");
    const readme = readFileSync(join(dist, "README.md"), "utf8");
    expect(readme).toContain("# Maison Rivet — livraison Faktory");
    expect(readme).toContain("`faktory-catalogue-produits`");
    expect(readme).toContain("Gravity Forms #5");
    const manifest = JSON.parse(readFileSync(join(dist, "MANIFEST.json"), "utf8"));
    expect(manifest.wordpress).toBe("7.1");
    expect(manifest.customPlugins).toHaveLength(1);
    expect(manifest.forms).toEqual([{ id: "contact", name: spec.forms.find((f) => f.id === "contact")!.name, gfId: 5 }]);
    expect(manifest.qa).toEqual({ urls: 2, reviewed: 1, remainingIssues: 0, report: "qa/QA-REPORT.md" });
    expect(Object.keys(manifest.files).sort()).toEqual(["README.md", ".env.example", "db.sql", "docker-compose.prod.yml", "wp-content.tar.gz"].sort());
    expect(manifest.files["db.sql"]).toBe(32); // actual on-disk size of the mocked sql string (statSync), not the mock's bytes field
    expect(msg).toBe("dist/: db.sql (1 kB), wp-content.tar.gz (1 kB), docker-compose.prod.yml, .env.example, README.md, MANIFEST.json");
  });
  it("works without plugins, forms or qa report", async () => {
    const c = await ctx();
    spies({ listing: ["wp-content/themes/generatepress/style.css", "wp-content/themes/faktory-boul/style.css", "wp-content/plugins/generateblocks/"] });
    await exportStage.run(c);
    const manifest = JSON.parse(readFileSync(join(c.siteDir, "dist/MANIFEST.json"), "utf8"));
    expect(manifest.qa).toBeNull();
    expect(manifest.customPlugins).toEqual([]);
    expect(manifest.forms).toEqual([]);
  });
  it("fails when the archive misses a required entry, keeping db.sql for inspection", async () => {
    const c = await ctx({ manifest: true });
    spies({ listing: ["wp-content/themes/generatepress/style.css"] });
    await expect(exportStage.run(c)).rejects.toThrow(/wp-content.tar.gz is missing: wp-content\/themes\/faktory-boul\/style.css, wp-content\/plugins\/generateblocks\/, wp-content\/plugins\/faktory-catalogue-produits\//);
    expect(existsSync(join(c.siteDir, "dist/db.sql"))).toBe(true);
    expect(existsSync(join(c.siteDir, "dist/MANIFEST.json"))).toBe(false);
  });
  it("propagates a db export failure before touching the archive", async () => {
    const c = await ctx();
    const s = spies();
    s.db.mockRejectedValue(new Error("db.sql still contains 5 occurrence(s) of localhost:8101"));
    await expect(exportStage.run(c)).rejects.toThrow(/still contains 5/);
    expect(s.bundle).not.toHaveBeenCalled();
  });
});
