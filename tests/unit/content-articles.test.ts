import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { articlePath, articleSlug, type Article } from "../../src/schemas/article.js";
import { serializeArticle } from "../../src/content/serialize.js";
import { YOAST_META } from "../../src/content/seo.js";
import {
  articleCategory, articleUserPrompt, readArticle, generateArticle, ensureCategories, publishArticle, assertArticleRendered, assertBlogLists, deps,
  ARTICLES_TOOLS, ARTICLES_MAX_TURNS, ARTICLES_WRITE_ROOTS, PLACEHOLDER_IMAGE,
} from "../../src/content/articles.js";
import { deps as renderDeps } from "../../src/pages/render-check.js";
import type { SiteContext } from "../../src/docker.js";
import type { AgentRun } from "../../src/agent.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const fixture = (): Article => JSON.parse(readFileSync("fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json", "utf8"));
const first = spec.blog.articles[0];
const SLUG = "la-galette-des-rois-revient-frangipane-ou-pomme";

async function ctx(): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-art-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}
const run = (structured: unknown, costUsd = 0.3): AgentRun => ({ text: "", transcript: "", structured, costUsd, sessionId: "s1", numTurns: 2 });

describe("articleCategory / articleUserPrompt", () => {
  it("uses the theme when it is a spec category, else the first category", () => {
    expect(articleCategory(spec, first)).toBe("Saison");
    expect(articleCategory(spec, { ...first, theme: "Inconnu" })).toBe(spec.blog.categories[0]);
  });
  it("lists title, category, keywords, identity, pages and the other articles", () => {
    const p = articleUserPrompt(spec, first, SLUG);
    expect(p).toContain(`# Article \`${SLUG}\` — ${first.title}`);
    expect(p).toContain("Catégorie : Saison");
    expect(p).toContain("Mots-clés : galette des rois Nantes");
    expect(p).toContain(spec.identity.name);
    expect(p).toContain("/nos-produits/ (");
    expect(p).toContain("/ (");
    for (const a of spec.blog.articles.slice(1)) expect(p).toContain(a.title);
    expect(p).not.toContain(`- ${first.title}`);
    expect(p).toContain("Catégories possibles : Saison, Recettes, Coulisses");
  });
});

describe("readArticle", () => {
  it("reads and validates content/articles/<slug>.json, with actionable errors", async () => {
    const c = await ctx();
    expect(() => readArticle(c, spec, SLUG)).toThrow(/content\/articles\/la-galette-des-rois-revient-frangipane-ou-pomme.json not found/);
    mkdirSync(join(c.siteDir, "content/articles"), { recursive: true });
    writeFileSync(articlePath(c, SLUG), "{nope");
    expect(() => readArticle(c, spec, SLUG)).toThrow(/is not valid JSON/);
    writeFileSync(articlePath(c, SLUG), JSON.stringify({ ...fixture(), category: "Nope" }));
    expect(() => readArticle(c, spec, SLUG)).toThrow(/content\/articles\/.*\.json: Invalid article: category.*— fix or delete it/s);
    writeFileSync(articlePath(c, SLUG), JSON.stringify(fixture()));
    expect(readArticle(c, spec, SLUG).title).toBe(first.title);
  });
});

describe("generateArticle", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("runs one structured-output agent with the content prompt and writes the validated article", async () => {
    const c = await ctx();
    const agent = vi.spyOn(deps, "runAgent").mockResolvedValue(run(fixture()));
    const r = await generateArticle(c, spec, first);
    expect(r.slug).toBe(SLUG);
    expect(r.article.title).toBe(first.title);
    expect(r.costUsd).toBe(0.3);
    expect(r.attempts).toBe(1);
    const opts = agent.mock.calls[0][1];
    expect(opts.stage).toBe("content");
    expect(opts.allowedTools).toEqual(ARTICLES_TOOLS);
    expect(opts.maxTurns).toBe(ARTICLES_MAX_TURNS);
    expect(opts.writeRoots).toEqual(ARTICLES_WRITE_ROOTS);
    expect(opts.systemPrompt).toContain("rédacteur web");
    expect(opts.prompt).toContain(first.title);
    expect(opts.outputFormat?.type).toBe("json_schema");
    expect((opts.outputFormat?.schema as any).properties.category.enum).toEqual(spec.blog.categories);
    expect(JSON.parse(readFileSync(articlePath(c, SLUG), "utf8"))).toEqual(fixture());
  });
  it("retries once in the same session on an invalid article, then writes the fixed one", async () => {
    const c = await ctx();
    const agent = vi.spyOn(deps, "runAgent")
      .mockResolvedValueOnce(run({ ...fixture(), category: "Nope" }))
      .mockResolvedValueOnce(run(fixture(), 0.2));
    const r = await generateArticle(c, spec, first);
    expect(r.attempts).toBe(2);
    expect(r.costUsd).toBe(0.5);
    expect(agent.mock.calls[1][1].resume).toBe("s1");
    // Not `assertArticle`'s custom "category ... is not one of the spec's blog categories" message: `parseArticle`
    // runs first in the validate callback and its zod `z.enum(categories)` rejects "Nope" before assertArticle ever sees it.
    expect(agent.mock.calls[1][1].prompt).toMatch(/category: Invalid option: expected one of/);
    expect(existsSync(articlePath(c, SLUG))).toBe(true);
  });
  it("fails after the retry without writing anything", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockResolvedValue(run({ ...fixture(), blocks: [{ type: "heading", level: 2, text: "x" }, { type: "paragraph", text: "y" }, { type: "paragraph", text: "z" }] }));
    await expect(generateArticle(c, spec, first)).rejects.toThrow(/content: output still invalid after one retry — article is invalid/);
    expect(existsSync(articlePath(c, SLUG))).toBe(false);
  });
});

describe("ensureCategories / publishArticle", () => {
  beforeEach(() => vi.restoreAllMocks());
  function spies(opts: { existingPost?: number; thumb?: string; mediaFails?: boolean } = {}) {
    const calls: string[][] = [];
    const wpJson = vi.spyOn(deps, "wpJson").mockImplementation(async (_c, args) => {
      calls.push(args);
      if (args[0] === "term" && args[1] === "list") return [{ term_id: 1, name: "Uncategorized" }, { term_id: 5, name: "Saison" }] as any;
      if (args[0] === "post" && args[1] === "list") return (opts.existingPost ? [{ ID: opts.existingPost }] : []) as any;
      throw new Error(`unexpected wpJson ${args.join(" ")}`);
    });
    const wpOk = vi.spyOn(deps, "wpOk").mockImplementation(async (_c, args) => {
      calls.push(args);
      if (args[0] === "term" && args[1] === "create") return String(args[3] === "Recettes" ? 6 : 7);
      if (args[0] === "post" && args[1] === "create") return "42";
      if (args[0] === "post" && args[1] === "update") return "Success";
      if (args[0] === "post" && args[1] === "term") return "Success";
      if (args[0] === "post" && args[1] === "meta") return "Success";
      if (args[0] === "media") { if (opts.mediaFails) throw new Error("wp media import failed: curl"); return "99"; }
      throw new Error(`unexpected wpOk ${args.join(" ")}`);
    });
    const runWp = vi.spyOn(deps, "runWp").mockImplementation(async (_c, args) => {
      calls.push(args);
      if (args[0] === "post" && args[1] === "meta" && args[2] === "get") return { code: opts.thumb ? 0 : 1, stdout: opts.thumb ?? "", stderr: "" };
      throw new Error(`unexpected runWp ${args.join(" ")}`);
    });
    return { wpJson, wpOk, runWp, calls };
  }
  it("ensureCategories creates the missing spec categories and maps every name to its id", async () => {
    const c = await ctx();
    const s = spies();
    expect(await ensureCategories(c, spec)).toEqual({ Saison: 5, Recettes: 6, Coulisses: 7 });
    expect(s.wpOk).toHaveBeenCalledWith(c, ["term", "create", "category", "Recettes", "--porcelain"]);
    expect(s.wpOk).toHaveBeenCalledWith(c, ["term", "create", "category", "Coulisses", "--porcelain"]);
    expect(s.wpOk).toHaveBeenCalledTimes(2);
  });
  it("creates the post from stdin, sets category, featured image and Yoast meta", async () => {
    const c = await ctx();
    const s = spies();
    const a = fixture();
    const id = await publishArticle(c, SLUG, a, { Saison: 5 }, "galette des rois Nantes");
    expect(id).toBe(42);
    const create = s.calls.find((k) => k[0] === "post" && k[1] === "create")!;
    expect(create).toEqual(["post", "create", "-", "--post_type=post", "--post_status=publish", `--post_title=${a.title}`, `--post_name=${SLUG}`, `--post_excerpt=${a.excerpt}`, "--porcelain"]);
    expect(s.wpOk.mock.calls.find((k: any) => k[1][1] === "create")![2]).toEqual({ input: serializeArticle(a) });
    expect(s.wpOk).toHaveBeenCalledWith(c, ["post", "term", "set", "42", "category", "5", "--by=id"]);
    expect(s.wpOk).toHaveBeenCalledWith(c, ["media", "import", PLACEHOLDER_IMAGE, "--post_id=42", "--featured_image", `--alt=${a.title}`, "--porcelain"]);
    expect(s.wpOk).toHaveBeenCalledWith(c, ["post", "meta", "update", "42", YOAST_META.title, a.seo.title]);
    expect(s.wpOk).toHaveBeenCalledWith(c, ["post", "meta", "update", "42", YOAST_META.metadesc, a.seo.metaDescription]);
    expect(s.wpOk).toHaveBeenCalledWith(c, ["post", "meta", "update", "42", YOAST_META.focuskw, "galette des rois Nantes"]);
  });
  it("updates an existing post by post_name and skips the image when a thumbnail exists", async () => {
    const c = await ctx();
    const s = spies({ existingPost: 17, thumb: "99" });
    const a = fixture();
    expect(await publishArticle(c, SLUG, a, { Saison: 5 }, "galette des rois Nantes")).toBe(17);
    expect(s.wpOk).toHaveBeenCalledWith(c, ["post", "update", "17", "-", "--post_status=publish", `--post_title=${a.title}`, `--post_excerpt=${a.excerpt}`], { input: serializeArticle(a) });
    expect(s.wpOk.mock.calls.some((k: any) => k[1][0] === "media")).toBe(false);
    expect(s.wpOk.mock.calls.some((k: any) => k[1][1] === "create")).toBe(false);
  });
  it("warns and continues when the placeholder image cannot be imported", async () => {
    const c = await ctx();
    spies({ mediaFails: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await publishArticle(c, SLUG, fixture(), { Saison: 5 }, "galette des rois Nantes")).toBe(42);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/⚠ .*featured image not imported.*curl/));
  });
  it("refuses a category missing from the map", async () => {
    const c = await ctx();
    spies();
    await expect(publishArticle(c, SLUG, fixture(), {}, "galette des rois Nantes")).rejects.toThrow(/no category term for "Saison" — ensureCategories must run first/);
  });
});

describe("assertArticleRendered / assertBlogLists", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("checks the post title and the posts page links", async () => {
    const c = await ctx();
    const a = fixture();
    const f = vi.spyOn(renderDeps, "fetchText").mockImplementation(async (url) =>
      url.endsWith("/actualites/") ? `<a href="http://localhost:${c.state.port}/${SLUG}/">x</a>` : `<title>${a.seo.title.replace(/&/g, "&amp;")}</title>`);
    await expect(assertArticleRendered(c, SLUG, a)).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledWith(`http://localhost:${c.state.port}/${SLUG}/`);
    await expect(assertBlogLists(c, spec, [SLUG])).resolves.toBeUndefined();
    await expect(assertBlogLists(c, spec, ["autre"])).rejects.toThrow(/\/actualites\/ does not contain "href="http:\/\/localhost:\d+\/autre\/"" — the posts page does not list the article; check page_for_posts/);
  });
  it("assertBlogLists is a no-op without a blog page", async () => {
    const c = await ctx();
    const f = vi.spyOn(renderDeps, "fetchText");
    await assertBlogLists(c, { ...spec, sitemap: spec.sitemap.filter((p) => p.kind !== "blog"), menus: { primary: ["accueil"], footer: [] } }, [SLUG]);
    expect(f).not.toHaveBeenCalled();
  });
});
