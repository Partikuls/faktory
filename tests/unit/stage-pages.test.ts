import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext, registry } from "../../src/pipeline.js";
import { artifactPath, pageTreePath, writeJsonArtifact } from "../../src/artifacts.js";
import { parseSiteSpec, type Page } from "../../src/schemas/site-spec.js";
import { featureMarker, formMarker, type PageTree } from "../../src/schemas/page-tree.js";
import { pagesStage, deps, PAGES_CONCURRENCY } from "../../src/stages/pages.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const tokens = JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8"));
const IDS: Record<string, number> = { accueil: 10, "nos-produits": 11, "commandes-evenements": 12, "la-maison": 13, actualites: 14, contact: 15 };
const NON_BLOG = ["accueil", "nos-produits", "commandes-evenements", "la-maison", "contact"];

/** Minimal valid tree for any page: h1 in the first section + the required markers. */
function stubTree(page: Page): PageTree {
  return page.sections.map((s, i) => ({
    type: "element" as const, tagName: "section", htmlAttributes: { id: `s-${i}` }, styles: { padding: "48px 24px" },
    innerBlocks: [
      { type: "text" as const, tagName: i === 0 ? "h1" : "h2", content: s.heading },
      ...(s.type === "custom-query" && s.feature ? [{ type: "raw" as const, rawMarkup: featureMarker(s.feature) }] : []),
      ...((s.type === "form" || s.type === "contact") && s.form ? [{ type: "raw" as const, rawMarkup: formMarker(s.form) }] : []),
    ],
  }));
}
const tick = () => new Promise<void>((r) => setTimeout(r, 5));

async function ctx(opts: { design?: boolean } = { design: true }) {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stpages-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  writeJsonArtifact(c, "siteSpecJson", spec);
  writeJsonArtifact(c, "designTokensJson", tokens);
  if (opts.design) writeFileSync(artifactPath(c, "designSystemMd"), "# Maison Rivet — Design System Web\n");
  return c;
}

function spies(opts: { fail?: string[]; delay?: boolean } = {}) {
  const order: string[] = []; let inFlight = 0, peak = 0;
  const ensure = vi.spyOn(deps, "ensurePages").mockResolvedValue(IDS);
  const gen = vi.spyOn(deps, "generatePageTree").mockImplementation(async (_c, _s, page) => {
    order.push(`gen:${page.slug}`); inFlight++; peak = Math.max(peak, inFlight);
    if (opts.delay) { await tick(); await tick(); }
    inFlight--;
    if (opts.fail?.includes(page.slug)) throw new Error(`pages: output still invalid after one retry — pages/${page.slug}.gb.json was not written`);
    return { tree: stubTree(page), costUsd: 1, attempts: 1 as const };
  });
  const compile = vi.spyOn(deps, "compilePage").mockImplementation(async (_c, slug) => { order.push(`compile:${slug}`); return `<!-- ${slug} -->`; });
  const publish = vi.spyOn(deps, "publishPage").mockImplementation(async (_c, id) => { order.push(`publish:${id}`); });
  return { ensure, gen, compile, publish, order, peak: () => peak };
}

describe("pages stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("is registered in the pipeline", () => {
    expect(registry.pages).toBe(pagesStage);
    expect(pagesStage.checkpoint).toBeFalsy();
    expect(PAGES_CONCURRENCY).toBe(3);
  });
  it("needs site-spec.json, design-tokens.json and design-system.md", async () => {
    const c = await ctx({ design: false });
    await expect(pagesStage.run(c)).rejects.toThrow(/design-system.md not found/);
    rmSync(artifactPath(c, "designTokensJson"));
    await expect(pagesStage.run(c)).rejects.toThrow(/design-tokens.json not found/);
  });
  it("generates home first, then the others (max 3 in flight), publishes each, skips the blog page", async () => {
    const c = await ctx();
    const s = spies({ delay: true });
    const msg = await pagesStage.run(c);
    expect(s.ensure).toHaveBeenCalledWith(c, spec);
    expect(s.order.slice(0, 3)).toEqual(["gen:accueil", "compile:accueil", "publish:10"]);
    expect(s.gen).toHaveBeenCalledTimes(5);
    expect(s.gen.mock.calls.map((k: any) => k[2].slug).sort()).toEqual([...NON_BLOG].sort());
    expect(s.gen.mock.calls[0][3]).toEqual({ homeSlug: undefined });
    expect(s.gen.mock.calls[1][3]).toEqual({ homeSlug: "accueil" });
    expect(s.peak()).toBe(3);
    expect(s.publish.mock.calls.map((k: any) => k[1]).sort()).toEqual([10, 11, 12, 13, 15]);
    expect(s.order).not.toContain("publish:14");
    expect(msg).toBe("5 pages published (accueil, nos-produits, commandes-evenements, la-maison, contact); 5 generated, 0 reused; blog skipped (actualites) — $5.00");
  });
  it("reuses an existing pages/<slug>.gb.json without calling the agent", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "pages"), { recursive: true });
    copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, "accueil"));
    const s = spies();
    const msg = await pagesStage.run(c);
    expect(s.gen.mock.calls.map((k: any) => k[2].slug)).not.toContain("accueil");
    expect(s.gen).toHaveBeenCalledTimes(4);
    expect(s.order.slice(0, 2)).toEqual(["compile:accueil", "publish:10"]);
    expect(msg).toMatch(/5 pages published .*; 4 generated, 1 reused; blog skipped \(actualites\) — \$4\.00/);
  });
  it("fails immediately when the home page fails, without generating the others", async () => {
    const c = await ctx();
    const s = spies({ fail: ["accueil"] });
    await expect(pagesStage.run(c)).rejects.toThrow(/accueil.gb.json was not written/);
    expect(s.gen).toHaveBeenCalledTimes(1);
    expect(s.publish).not.toHaveBeenCalled();
  });
  it("keeps publishing the other pages when one fails, then fails with the list", async () => {
    const c = await ctx();
    const s = spies({ fail: ["la-maison"] });
    await expect(pagesStage.run(c)).rejects.toThrow(/1 page\(s\) failed: la-maison — fix or delete pages\/<slug>.gb.json and re-run: faktory run boul --only pages/);
    expect(s.publish.mock.calls.map((k: any) => k[1]).sort()).toEqual([10, 11, 12, 15]);
  });
  it("refuses to generate once the budget is spent (existing trees still publish)", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "pages"), { recursive: true });
    copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, "accueil"));
    c.state = { ...c.state, costUsd: 40 };
    const s = spies();
    await expect(pagesStage.run(c)).rejects.toThrow(/Cost budget reached/);
    expect(s.gen).not.toHaveBeenCalled();
    expect(s.publish).toHaveBeenCalledWith(c, 10, "<!-- accueil -->");
  });
  it("logs every rejected page before rethrowing the budget error", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "pages"), { recursive: true });
    copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, "accueil"));
    c.state = { ...c.state, costUsd: 40 };
    spies();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(pagesStage.run(c)).rejects.toThrow(/Cost budget reached/);
    // nos-produits, commandes-evenements, la-maison, contact all reject with "Cost budget reached"
    expect(errSpy).toHaveBeenCalledTimes(4);
    for (const call of errSpy.mock.calls) expect(call[0]).toContain("Cost budget reached");
  });
});
