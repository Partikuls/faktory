import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SiteContext } from "../docker.js";
import { siteUrl } from "../docker.js";
import { runAgent, runValidated } from "../agent.js";
import { loadPrompt } from "../prompts.js";
import { runWp, wpOk, wpJson } from "../wp.js";
import { toJsonSchema } from "../schemas/json-schema.js";
import { ArticleShape, articlePath, articleRel, articleSlug, assertArticle, parseArticle, type Article } from "../schemas/article.js";
import type { SiteSpec } from "../schemas/site-spec.js";
import { serializeArticle } from "./serialize.js";
import { YOAST_META } from "./seo.js";
import { assertContains, assertTitle, pageUrl } from "../pages/render-check.js";

export const deps = { runAgent, wpOk, wpJson, runWp };
export const ARTICLES_MAX_TURNS = 8;
export const ARTICLES_TOOLS = ["Read"];
export const ARTICLES_WRITE_ROOTS = ["content"];
export const ARTICLES_CONCURRENCY = 3;
export const PLACEHOLDER_IMAGE = "https://placehold.co/1200x800.png";

export type SpecArticle = SiteSpec["blog"]["articles"][number];

/** The theme when it is one of the spec's categories, else the first category. */
export function articleCategory(spec: SiteSpec, article: SpecArticle): string {
  return spec.blog.categories.includes(article.theme) ? article.theme : spec.blog.categories[0];
}

export function articleUserPrompt(spec: SiteSpec, article: SpecArticle, slug: string): string {
  const id = spec.identity;
  const others = spec.blog.articles.filter((a) => a.title !== article.title);
  const lines: string[] = [
    `# Article \`${slug}\` — ${article.title}`,
    `Catégorie : ${articleCategory(spec, article)} (thème de la spec : ${article.theme})`,
    `Mots-clés : ${article.keywords.join(", ")}`,
    `Catégories possibles : ${spec.blog.categories.join(", ")}`,
    "",
    "## Identité",
    `${id.name} — ${id.sector}${id.location ? ` (${id.location})` : ""}. Accroche : ${id.tagline}. Ton : ${id.tone}.`,
    `Pages du site (pour les liens internes) : ${spec.sitemap.map((p) => `${p.kind === "home" ? "/" : `/${p.slug}/`} (${p.title})`).join(", ")}.`,
    "",
    "## Autres articles du blog (ne pas répéter leur sujet)",
    ...(others.length ? others.map((a) => `- ${a.title} (${a.theme})`) : ["- aucun"]),
    "",
    "## À faire",
    "Lis `brief.md`, `SITE-SPEC.md` et `design-system.md`, puis réponds uniquement par l'objet JSON structuré de l'article.",
  ];
  return lines.join("\n");
}

/** Read and validate `content/articles/<slug>.json`; throws a message telling what to fix. */
export function readArticle(ctx: SiteContext, spec: SiteSpec, slug: string): Article {
  const rel = articleRel(slug), abs = articlePath(ctx, slug);
  if (!existsSync(abs)) throw new Error(`${rel} not found`);
  let data: unknown;
  try { data = JSON.parse(readFileSync(abs, "utf8")); }
  catch (err) { throw new Error(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
  try {
    const a = parseArticle(data, spec.blog.categories);
    assertArticle(a, spec);
    return a;
  } catch (err) {
    throw new Error(`${rel}: ${err instanceof Error ? err.message : String(err)} — fix or delete it (a deleted article is regenerated)`);
  }
}

/** One structured-output agent run (plus one validated retry); the validated article is written to `content/articles/<slug>.json`. */
export async function generateArticle(
  ctx: SiteContext, spec: SiteSpec, article: SpecArticle,
): Promise<{ article: Article; slug: string; costUsd: number; attempts: 1 | 2 }> {
  const slug = articleSlug(article.title);
  const r = await runValidated(deps.runAgent, ctx, {
    stage: "content",
    systemPrompt: loadPrompt("content"),
    prompt: articleUserPrompt(spec, article, slug),
    allowedTools: ARTICLES_TOOLS,
    outputFormat: { type: "json_schema", schema: toJsonSchema(ArticleShape(spec.blog.categories)) },
    maxTurns: ARTICLES_MAX_TURNS,
    writeRoots: ARTICLES_WRITE_ROOTS,
  }, (run) => {
    const a = parseArticle(run.structured, spec.blog.categories);
    assertArticle(a, spec);
    return a;
  });
  const abs = articlePath(ctx, slug);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(r.value, null, 2) + "\n");
  return { article: r.value, slug, costUsd: r.costUsd, attempts: r.attempts };
}

type Term = { term_id: number; name: string };

/** Create the missing blog categories; returns name → term id for every spec category. */
export async function ensureCategories(ctx: SiteContext, spec: SiteSpec): Promise<Record<string, number>> {
  const terms = await deps.wpJson<Term[]>(ctx, ["term", "list", "category", "--fields=term_id,name"]);
  const ids: Record<string, number> = {};
  for (const name of spec.blog.categories) {
    const t = terms.find((x) => x.name.toLowerCase() === name.toLowerCase());
    ids[name] = t ? t.term_id : Number(await deps.wpOk(ctx, ["term", "create", "category", name, "--porcelain"]));
  }
  return ids;
}

/** Idempotent publication by post_name (decision 6): create or update, category, placeholder featured image, Yoast meta. Returns the post id. */
export async function publishArticle(ctx: SiteContext, slug: string, article: Article, categories: Record<string, number>, focusKeyword: string): Promise<number> {
  const cat = categories[article.category];
  if (!cat) throw new Error(`no category term for "${article.category}" — ensureCategories must run first`);
  const markup = serializeArticle(article);
  const authorId = await deps.wpOk(ctx, ["user", "get", ctx.state.adminUser, "--field=ID"]);
  const existing = await deps.wpJson<{ ID: number }[]>(ctx, ["post", "list", "--post_type=post", "--post_status=any", `--name=${slug}`, "--fields=ID"]);
  let id: number;
  if (existing.length) {
    id = existing[0].ID;
    await deps.wpOk(ctx, ["post", "update", String(id), "-", "--post_status=publish", `--post_title=${article.title}`, `--post_excerpt=${article.excerpt}`, `--post_author=${authorId}`], { input: markup });
  } else {
    id = Number(await deps.wpOk(ctx, ["post", "create", "-", "--post_type=post", "--post_status=publish", `--post_title=${article.title}`, `--post_name=${slug}`, `--post_excerpt=${article.excerpt}`, `--post_author=${authorId}`, "--porcelain"], { input: markup }));
  }
  await deps.wpOk(ctx, ["post", "term", "set", String(id), "category", String(cat), "--by=id"]);
  const thumb = await deps.runWp(ctx, ["post", "meta", "get", String(id), "_thumbnail_id"]);
  if (thumb.code !== 0 || !thumb.stdout.trim()) {
    try {
      await deps.wpOk(ctx, ["media", "import", PLACEHOLDER_IMAGE, `--post_id=${id}`, "--featured_image", `--alt=${article.title}`, "--porcelain"]);
    } catch (err) {
      console.warn(`⚠ ${slug}: featured image not imported (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  await deps.wpOk(ctx, ["post", "meta", "update", String(id), YOAST_META.title, article.seo.title]);
  await deps.wpOk(ctx, ["post", "meta", "update", String(id), YOAST_META.metadesc, article.seo.metaDescription]);
  await deps.wpOk(ctx, ["post", "meta", "update", String(id), YOAST_META.focuskw, focusKeyword]);
  return id;
}

export async function assertArticleRendered(ctx: SiteContext, slug: string, article: Article): Promise<void> {
  await assertTitle(ctx, `${siteUrl(ctx)}/${slug}/`, article.seo.title);
}

/** The posts page (`kind: "blog"`) must link every published article; no-op when the sitemap has no blog page. */
export async function assertBlogLists(ctx: SiteContext, spec: SiteSpec, slugs: string[]): Promise<void> {
  const blog = spec.sitemap.find((p) => p.kind === "blog");
  if (!blog) return;
  const url = pageUrl(ctx, blog);
  const html = await assertContains(ctx, url, `href="${siteUrl(ctx)}/${slugs[0]}/"`, "the posts page does not list the article; check page_for_posts");
  for (const slug of slugs.slice(1)) {
    const needle = `href="${siteUrl(ctx)}/${slug}/"`;
    if (!html.includes(needle)) throw new Error(`${url} does not contain "${needle}" — the posts page does not list the article; check page_for_posts`);
  }
}
