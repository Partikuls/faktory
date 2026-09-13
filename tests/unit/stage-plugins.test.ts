import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, cpSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext, registry } from "../../src/pipeline.js";
import { writeJsonArtifact } from "../../src/artifacts.js";
import { parseSiteSpec, type SiteSpec } from "../../src/schemas/site-spec.js";
import { manifestPath, pluginDirPath, parsePluginManifest } from "../../src/schemas/plugin-manifest.js";
import { pluginsStage, deps } from "../../src/stages/plugins.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const feature = spec.features[0];
const manifest = parsePluginManifest(JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8")));
const IDS: Record<string, number> = { accueil: 10, "nos-produits": 11, "commandes-evenements": 12, "la-maison": 13, actualites: 14, contact: 15 };

async function ctx(s: SiteSpec = spec): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stplg-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  writeJsonArtifact(c, "siteSpecJson", s);
  return c;
}
function installFixture(c: SiteContext): void {
  cpSync("fixtures/plugins/faktory-catalogue-produits", pluginDirPath(c, feature.id), { recursive: true });
  copyFileSync("fixtures/plugins/catalogue_produits.manifest.json", manifestPath(c, feature.id));
}
function spies(opts: { generateFails?: boolean; integrateFails?: boolean } = {}) {
  const order: string[] = [];
  const ensure = vi.spyOn(deps, "ensurePages").mockResolvedValue(IDS);
  const gen = vi.spyOn(deps, "generatePlugin").mockImplementation(async (c, _s, f) => {
    order.push(`gen:${f.id}`);
    if (opts.generateFails) throw new Error("plugins: output still invalid after one retry — php_check failed");
    installFixture(c);
    return { manifest, entries: 5, costUsd: 4.5, attempts: 1 as const };
  });
  const verify = vi.spyOn(deps, "verifyPlugin").mockImplementation(async (_c, _s, f) => { order.push(`verify:${f.id}`); return { manifest, entries: 5 }; });
  const integrate = vi.spyOn(deps, "integratePlugin").mockImplementation(async (_c, _s, m) => {
    order.push(`integrate:${m.feature}`);
    if (opts.integrateFails) throw new Error("/ (accueil) does not render data-faktory-plugin");
    return { pages: ["accueil", "nos-produits"], skipped: [] };
  });
  return { ensure, gen, verify, integrate, order };
}

describe("plugins stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("is registered in the pipeline, without checkpoint", () => {
    expect(registry.plugins).toBe(pluginsStage);
    expect(pluginsStage.checkpoint).toBeFalsy();
  });
  it("needs site-spec.json", async () => {
    const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stplg-")));
    await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
    await expect(pluginsStage.run(loadContext(config, "boul"))).rejects.toThrow(/site-spec.json not found/);
  });
  it("does nothing when the spec has no features", async () => {
    const c = await ctx({ ...spec, features: [], sitemap: spec.sitemap.map((p) => ({ ...p, sections: p.sections.filter((s) => s.type !== "custom-query") })) });
    const s = spies();
    expect(await pluginsStage.run(c)).toBe("no features in site-spec.json: nothing to do");
    expect(s.ensure).not.toHaveBeenCalled();
  });
  it("generates, then integrates each feature, and reports cost", async () => {
    const c = await ctx();
    const s = spies();
    const msg = await pluginsStage.run(c);
    expect(s.ensure).toHaveBeenCalledWith(c, spec);
    expect(s.order).toEqual(["gen:catalogue_produits", "integrate:catalogue_produits"]);
    expect(s.integrate).toHaveBeenCalledWith(c, spec, manifest, IDS);
    expect(msg).toBe("1 plugin: faktory-catalogue-produits (produit, 5 entries, 2 pages updated); 1 generated, 0 reused — $4.50");
  });
  it("reuses an existing manifest + plugin dir: verify, no agent", async () => {
    const c = await ctx();
    installFixture(c);
    const s = spies();
    const msg = await pluginsStage.run(c);
    expect(s.gen).not.toHaveBeenCalled();
    expect(s.order).toEqual(["verify:catalogue_produits", "integrate:catalogue_produits"]);
    expect(msg).toBe("1 plugin: faktory-catalogue-produits (produit, 5 entries, 2 pages updated); 0 generated, 1 reused — $0.00");
  });
  it("mentions pages skipped for lack of a tree", async () => {
    const c = await ctx();
    const s = spies();
    s.integrate.mockResolvedValue({ pages: [], skipped: ["accueil", "nos-produits"] });
    const msg = await pluginsStage.run(c);
    expect(msg).toContain("(produit, 5 entries, 0 pages updated, 2 waiting for the pages stage)");
  });
  it("refuses to generate once the budget is spent", async () => {
    const c = await ctx();
    c.state = { ...c.state, costUsd: 40 };
    const s = spies();
    await expect(pluginsStage.run(c)).rejects.toThrow(/Cost budget reached/);
    expect(s.gen).not.toHaveBeenCalled();
  });
  it("fails with the feature list when a plugin fails, after trying the others", async () => {
    const two: SiteSpec = { ...spec, features: [feature, { ...feature, id: "horaires", name: "Horaires", cpt: { slug: "horaire", singular: "Horaire", plural: "Horaires" } }] };
    const c = await ctx(two);
    const s = spies();
    s.gen.mockImplementation(async (cc, _s, f) => {
      if (f.id === "catalogue_produits") throw new Error("plugins: output still invalid after one retry — php_check failed");
      installFixture(cc);
      return { manifest: { ...manifest, feature: "horaires" }, entries: 4, costUsd: 3, attempts: 1 as const };
    });
    await expect(pluginsStage.run(c)).rejects.toThrow(/1 plugin\(s\) failed: catalogue_produits — fix or delete plugins\/<id>.json and re-run: faktory run boul --only plugins/);
    expect(s.integrate).toHaveBeenCalledTimes(1);
  });
  it("fails when integration fails", async () => {
    const c = await ctx();
    spies({ integrateFails: true });
    await expect(pluginsStage.run(c)).rejects.toThrow(/1 plugin\(s\) failed: catalogue_produits/);
  });
});
