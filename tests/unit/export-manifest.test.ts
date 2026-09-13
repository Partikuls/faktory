import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps as wpDeps } from "../../src/wp.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { parsePluginManifest } from "../../src/schemas/plugin-manifest.js";
import { parseQaReport } from "../../src/schemas/qa.js";
import { gfPlacement } from "../../src/schemas/forms-manifest.js";
import { articleSlug } from "../../src/schemas/article.js";
import { faktoryVersion, gatherVersions, buildManifest } from "../../src/export/manifest.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const manifest = parsePluginManifest(JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8")));
const qa = parseQaReport(JSON.parse(readFileSync("fixtures/qa/report.json", "utf8")));
const PLUGINS = [{ name: "generateblocks", version: "2.4.1", status: "active" }, { name: "faktory-catalogue-produits", version: "1.0.0", status: "active" }];
const THEMES = [{ name: "faktory-boul", version: "0.1.0", status: "active" }, { name: "generatepress", version: "3.6.1", status: "parent" }];

function ctx(): SiteContext {
  const root = mkdtempSync(join(tmpdir(), "fk-manifest-"));
  const state = { ...createState("boul", 8101, "pw"), costUsd: 22.09 };
  return { config: loadConfig(root), slug: "boul", siteDir: join(root, "sites", "boul"), state };
}

describe("manifest", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("reads the faktory version from package.json", () => {
    expect(faktoryVersion()).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);
  });
  it("gathers wordpress, plugin and theme versions from wp-cli", async () => {
    const c = ctx();
    const exec = vi.spyOn(wpDeps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      const a = (cmd as string[]).slice(1).join(" ");
      if (a === "core version") return { stdout: "7.1\n", stderr: "PHP Warning: WP_DEBUG", code: 0 };
      if (a.startsWith("plugin list")) return { stdout: JSON.stringify(PLUGINS), stderr: "", code: 0 };
      if (a.startsWith("theme list")) return { stdout: JSON.stringify(THEMES), stderr: "", code: 0 };
      return { stdout: "", stderr: `unexpected ${a}`, code: 1 };
    });
    const v = await gatherVersions(c);
    expect(v).toEqual({ wordpress: "7.1", plugins: PLUGINS, themes: THEMES });
    expect(exec.mock.calls.map((k: any) => (k[2] as string[]).slice(1).join(" "))).toEqual([
      "core version", "plugin list --fields=name,version,status --format=json", "theme list --fields=name,version,status --format=json",
    ]);
  });
  it("builds the manifest from the spec, the artifacts and the versions", () => {
    const c = ctx();
    const m = buildManifest({
      ctx: c, spec, versions: { wordpress: "7.1", plugins: PLUGINS, themes: THEMES }, manifests: [manifest],
      forms: { contact: { gfId: 5, placement: gfPlacement(5) }, devis_evenement: { gfId: 4, placement: gfPlacement(4) } },
      qa, files: { "db.sql": 2088575, "wp-content.tar.gz": 31400000 }, generatedAt: "2026-09-13T17:00:00.000Z",
    });
    expect(m).toEqual({
      slug: "boul", name: "Maison Rivet", generatedAt: "2026-09-13T17:00:00.000Z", faktoryVersion: faktoryVersion(),
      wordpress: "7.1",
      theme: { generatepress: "3.6.1", child: "faktory-boul" },
      plugins: PLUGINS,
      pages: spec.sitemap.map((p) => ({ slug: p.slug, title: p.title, kind: p.kind, path: p.kind === "home" ? "/" : `/${p.slug}/` })),
      customPlugins: [{ feature: "catalogue_produits", plugin: "faktory-catalogue-produits", postType: manifest.postType, block: manifest.block }],
      forms: [{ id: "devis_evenement", name: spec.forms[0].name, gfId: 4 }, { id: "contact", name: spec.forms[1].name, gfId: 5 }],
      articles: spec.blog.articles.map((a) => articleSlug(a.title)),
      qa: { urls: 2, reviewed: 1, remainingIssues: 0, workspaceReport: "qa/QA-REPORT.md" },
      costUsd: 22.09,
      files: { "db.sql": 2088575, "wp-content.tar.gz": 31400000 },
    });
  });
  it("qa is null without a report, theme version empty without generatepress, forms only when in the manifest", () => {
    const c = ctx();
    const m = buildManifest({ ctx: c, spec, versions: { wordpress: "7.1", plugins: [], themes: [] }, manifests: [], forms: {}, qa: undefined, files: {}, generatedAt: "x" });
    expect(m.qa).toBeNull();
    expect(m.theme).toEqual({ generatepress: "", child: "faktory-boul" });
    expect(m.forms).toEqual([]);
    expect(m.customPlugins).toEqual([]);
  });
});
