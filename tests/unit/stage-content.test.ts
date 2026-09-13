import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext, registry } from "../../src/pipeline.js";
import { writeJsonArtifact } from "../../src/artifacts.js";
import { parseSiteSpec, type SiteSpec } from "../../src/schemas/site-spec.js";
import { articlePath, articleSlug, type Article } from "../../src/schemas/article.js";
import { gfPlacement } from "../../src/schemas/forms-manifest.js";
import { contentStage, deps } from "../../src/stages/content.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const fixture = (): Article => JSON.parse(readFileSync("fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json", "utf8"));
const IDS: Record<string, number> = { accueil: 10, "nos-produits": 11, "commandes-evenements": 12, "la-maison": 13, actualites: 14, contact: 15 };
const MANIFEST = { devis_evenement: { gfId: 2, placement: gfPlacement(2) }, contact: { gfId: 1, placement: gfPlacement(1) } };
const SLUGS = spec.blog.articles.map((a) => articleSlug(a.title));
const tick = () => new Promise<void>((r) => setTimeout(r, 5));

async function ctx(s: SiteSpec = spec): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stcontent-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  writeJsonArtifact(c, "siteSpecJson", s);
  return c;
}
function spies(opts: { fail?: string[]; delay?: boolean } = {}) {
  const order: string[] = []; let inFlight = 0, peak = 0;
  const ensure = vi.spyOn(deps, "ensurePages").mockResolvedValue(IDS);
  const forms = vi.spyOn(deps, "ensureForms").mockImplementation(async () => { order.push("forms"); return { manifest: MANIFEST, created: ["devis_evenement", "contact"], reused: [] }; });
  const integrate = vi.spyOn(deps, "integrateForms").mockImplementation(async () => { order.push("integrate"); return { pages: ["commandes-evenements", "contact"], skipped: [] }; });
  const seo = vi.spyOn(deps, "applyPageSeo").mockImplementation(async () => { order.push("seo"); return spec.sitemap.map((p) => p.slug); });
  const cats = vi.spyOn(deps, "ensureCategories").mockImplementation(async () => { order.push("categories"); return { Saison: 5, Recettes: 6, Coulisses: 7 }; });
  const gen = vi.spyOn(deps, "generateArticle").mockImplementation(async (c, _s, article) => {
    const slug = articleSlug(article.title);
    order.push(`gen:${slug}`); inFlight++; peak = Math.max(peak, inFlight);
    if (opts.delay) { await tick(); await tick(); }
    inFlight--;
    if (opts.fail?.includes(slug)) throw new Error(`content: output still invalid after one retry — article is invalid:\n- article has 12 words`);
    const a = { ...fixture(), title: article.title };
    mkdirSync(join(c.siteDir, "content/articles"), { recursive: true });
    writeFileSync(articlePath(c, slug), JSON.stringify(a));
    return { article: a, slug, costUsd: 0.3, attempts: 1 as const };
  });
  const publish = vi.spyOn(deps, "publishArticle").mockImplementation(async (_c, slug) => { order.push(`publish:${slug}`); return 40 + SLUGS.indexOf(slug); });
  const rendered = vi.spyOn(deps, "assertArticleRendered").mockResolvedValue(undefined);
  const lists = vi.spyOn(deps, "assertBlogLists").mockImplementation(async () => { order.push("blog-lists"); });
  return { ensure, forms, integrate, seo, cats, gen, publish, rendered, lists, order, peak: () => peak };
}

describe("content stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("is registered in the pipeline, without checkpoint, after pages", () => {
    expect(registry.content).toBe(contentStage);
    expect(contentStage.checkpoint).toBeFalsy();
    expect(Object.keys(registry)).toEqual(["spec", "design", "provision", "pages", "plugins", "content"]);
  });
  it("needs site-spec.json", async () => {
    const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stcontent-")));
    await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
    await expect(contentStage.run(loadContext(config, "boul"))).rejects.toThrow(/site-spec.json not found/);
  });
  it("runs forms → seo → articles (3 in flight max), publishes and checks each, then the blog page", async () => {
    const c = await ctx();
    const s = spies({ delay: true });
    const msg = await contentStage.run(c);
    expect(s.ensure).toHaveBeenCalledWith(c, spec);
    expect(s.forms).toHaveBeenCalledWith(c, spec);
    expect(s.integrate).toHaveBeenCalledWith(c, spec, MANIFEST, IDS);
    expect(s.seo).toHaveBeenCalledWith(c, spec, IDS);
    expect(s.order.slice(0, 4)).toEqual(["forms", "integrate", "seo", "categories"]);
    expect(s.gen).toHaveBeenCalledTimes(3);
    expect(s.peak()).toBe(3);
    expect(s.publish.mock.calls.map((k: any) => k[1]).sort()).toEqual([...SLUGS].sort());
    expect(s.publish.mock.calls[0][4]).toBe(spec.blog.articles.find((a) => articleSlug(a.title) === s.publish.mock.calls[0][1])!.keywords[0]);
    expect(s.rendered).toHaveBeenCalledTimes(3);
    expect(s.order.at(-1)).toBe("blog-lists");
    expect(s.lists).toHaveBeenCalledWith(c, spec, SLUGS);
    expect(msg).toBe(`forms: devis_evenement → #2, contact → #1 (2 created, 0 reused; 2 pages updated); seo: 6 pages; articles: 3 published (${SLUGS.join(", ")}); 3 generated, 0 reused — $0.90`);
  });
  it("skips the forms sub-step when the spec has no forms", async () => {
    const c = await ctx({ ...spec, forms: [], sitemap: spec.sitemap.map((p) => ({ ...p, sections: p.sections.filter((x) => x.type !== "form" && x.type !== "contact") })) });
    const s = spies();
    const msg = await contentStage.run(c);
    expect(s.forms).not.toHaveBeenCalled();
    expect(s.integrate).not.toHaveBeenCalled();
    expect(msg).toMatch(/^forms: none; seo: 6 pages; articles: 3 published/);
  });
  it("reuses content/articles/<slug>.json without calling the agent", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "content/articles"), { recursive: true });
    writeFileSync(articlePath(c, SLUGS[0]), JSON.stringify(fixture()));
    const s = spies();
    const msg = await contentStage.run(c);
    expect(s.gen).toHaveBeenCalledTimes(2);
    expect(s.gen.mock.calls.map((k: any) => articleSlug(k[2].title))).not.toContain(SLUGS[0]);
    expect(s.publish).toHaveBeenCalledTimes(3);
    expect(msg).toMatch(/3 published .*; 2 generated, 1 reused — \$0\.60$/);
  });
  it("keeps publishing the other articles when one fails, then fails with the list", async () => {
    const c = await ctx();
    const s = spies({ fail: [SLUGS[1]] });
    await expect(contentStage.run(c)).rejects.toThrow(new RegExp(`1 article\\(s\\) failed: ${SLUGS[1]} — fix or delete content/articles/<slug>.json and re-run: faktory run boul --only content`));
    expect(s.publish).toHaveBeenCalledTimes(2);
    expect(s.lists).not.toHaveBeenCalled();
  });
  it("reports a hand-edited invalid article as a failure with the fix-or-delete hint", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "content/articles"), { recursive: true });
    writeFileSync(articlePath(c, SLUGS[0]), JSON.stringify({ ...fixture(), category: "Nope" }));
    const s = spies();
    await expect(contentStage.run(c)).rejects.toThrow(/1 article\(s\) failed/);
    expect(s.gen).toHaveBeenCalledTimes(2);
  });
  it("refuses to generate once the budget is spent (existing articles still publish)", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "content/articles"), { recursive: true });
    writeFileSync(articlePath(c, SLUGS[0]), JSON.stringify(fixture()));
    c.state = { ...c.state, costUsd: 40 };
    const s = spies();
    await expect(contentStage.run(c)).rejects.toThrow(/Cost budget reached/);
    expect(s.gen).not.toHaveBeenCalled();
    expect(s.publish).toHaveBeenCalledWith(c, SLUGS[0], expect.anything(), { Saison: 5, Recettes: 6, Coulisses: 7 }, spec.blog.articles[0].keywords[0]);
  });
  it("fails the stage when the forms sub-step fails, before seo and articles", async () => {
    const c = await ctx();
    const s = spies();
    s.integrate.mockRejectedValue(new Error("/contact/ (contact) does not render gform_wrapper_1"));
    await expect(contentStage.run(c)).rejects.toThrow(/does not render gform_wrapper_1/);
    expect(s.seo).not.toHaveBeenCalled();
    expect(s.gen).not.toHaveBeenCalled();
  });
  it("rejects two blog articles that slugify to the same slug, before generating anything", async () => {
    const dupSpec: SiteSpec = {
      ...spec,
      blog: { ...spec.blog, articles: [
        { ...spec.blog.articles[0], title: "Nos meilleures brioches !" },
        { ...spec.blog.articles[1], title: "Nos meilleures brioches ?" },
        spec.blog.articles[2],
      ] },
    };
    const c = await ctx(dupSpec);
    const s = spies();
    await expect(contentStage.run(c)).rejects.toThrow(/two blog articles share the slug "nos-meilleures-brioches" — change one title in SITE-SPEC.md and run: faktory resync boul/);
    expect(s.gen).not.toHaveBeenCalled();
  });
});
