import { z } from "zod";
import { join } from "node:path";
import type { SiteContext } from "../docker.js";
import { CONTENT_DIR } from "../artifacts.js";
import { DENYLIST_RE } from "./page-tree.js";
import type { SiteSpec } from "./site-spec.js";

export const ARTICLES_DIR = `${CONTENT_DIR}/articles`;
export const articleRel = (slug: string): string => `${ARTICLES_DIR}/${slug}.json`;
export const articlePath = (ctx: SiteContext, slug: string): string => join(ctx.siteDir, articleRel(slug));

export const WORDS_MIN = 500;
export const WORDS_MAX = 1200;
export const PLACEHOLDER = "[à confirmer]";

/** Deterministic post_name from the spec's article title: accents stripped, kebab-case, ≤ 60 chars. */
export function articleSlug(title: string): string {
  const s = title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const cut = s.slice(0, 60).replace(/-+$/g, "");
  return cut || "article";
}

const text = z.string().min(1);
const Heading = z.strictObject({ type: z.literal("heading"), level: z.number().int().min(2).max(3), text });
const Paragraph = z.strictObject({ type: z.literal("paragraph"), text });
const List = z.strictObject({ type: z.literal("list"), ordered: z.boolean(), items: z.array(text).min(2) });
const Quote = z.strictObject({ type: z.literal("quote"), text, cite: z.string().optional() });

export type ArticleBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string; cite?: string };

export type Article = {
  title: string; excerpt: string; category: string;
  seo: { title: string; metaDescription: string };
  blocks: ArticleBlock[];
};

/** The agent's output format: the category enum is the spec's list, so the JSON schema pins it. */
export function ArticleShape(categories: string[]): z.ZodType<Article> {
  return z.strictObject({
    title: z.string().min(1).max(90).describe("Article title, French"),
    excerpt: z.string().min(40).max(200).describe("1-2 sentences shown in listings"),
    category: z.enum(categories as [string, ...string[]]),
    seo: z.strictObject({ title: z.string().min(1).max(70), metaDescription: z.string().min(50).max(160) }),
    blocks: z.array(z.discriminatedUnion("type", [Heading, Paragraph, List, Quote])).min(3)
      .describe("Body, in order: paragraph / heading (level 2-3) / list / quote. Inline HTML allowed: <strong>, <em>, <a href>"),
  }) as unknown as z.ZodType<Article>;
}

export function parseArticle(data: unknown, categories: string[]): Article {
  const r = ArticleShape(categories).safeParse(data);
  if (!r.success) throw new Error(`Invalid article: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

function texts(a: Article): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  a.blocks.forEach((b, i) => {
    const at = `blocks.${i}`;
    if (b.type === "list") b.items.forEach((it, j) => out.push({ at: `${at}.items.${j}`, text: it }));
    else out.push({ at, text: b.text });
    if (b.type === "quote" && b.cite) out.push({ at: `${at}.cite`, text: b.cite });
  });
  return out;
}

export function countWords(a: Article): number {
  return texts(a).reduce((n, t) => n + (t.text.replace(/<[^>]+>/g, " ").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length, 0);
}

const INLINE_RE = /<[^>]+>/g;
const ALLOWED_RE = /^<\/?(strong|em)>$|^<\/a>$|^<a href="([^"]*)">$/;

/**
 * Only <strong>, <em> and <a href="/…"|"https://…"> may appear in article text (decision 5).
 * The denylist (script/iframe/javascript:/on*=) is checked across the whole text — not just
 * inside tags — so a bare "javascript:" or "onclick=" in plain text is caught too. Closing tags
 * are whitelisted by name only (</strong>, </em>, </a>); any other closing tag (e.g. </iframe>)
 * is still flagged as forbidden inline HTML.
 */
export function inlineHtmlIssues(text: string, at: string, issues: string[]): void {
  for (const m of text.matchAll(new RegExp(DENYLIST_RE.source, "gi"))) issues.push(`${at}: forbidden markup (${m[0]})`);
  for (const tag of text.match(INLINE_RE) ?? []) {
    if (DENYLIST_RE.test(tag)) continue; // already reported above
    const m = tag.match(ALLOWED_RE);
    if (!m) { issues.push(`${at}: forbidden inline HTML ${tag}`); continue; }
    if (m[2] !== undefined && !(m[2].startsWith("/") || m[2].startsWith("https://"))) {
      issues.push(`${at}: forbidden inline HTML ${tag} (href must start with / or https://)`);
    }
  }
}

/** Editorial rules on top of the schema (decision 5). Empty = valid. */
export function validateArticle(a: Article, spec: SiteSpec): string[] {
  const issues: string[] = [];
  const cats = spec.blog.categories;
  if (!cats.includes(a.category)) issues.push(`category "${a.category}" is not one of the spec's blog categories (${cats.join(", ")})`);
  const words = countWords(a);
  if (words < WORDS_MIN || words > WORDS_MAX) issues.push(`article has ${words} words, expected between ${WORDS_MIN} and ${WORDS_MAX}`);
  const headings = a.blocks.filter((b) => b.type === "heading").length;
  if (headings < 2) issues.push(`article needs at least 2 headings, found ${headings}`);
  if (a.blocks[0]?.type !== "paragraph") issues.push(`the first block must be a paragraph (an intro before the first heading), found ${a.blocks[0]?.type ?? "nothing"}`);
  for (const t of [...texts(a), { at: "title", text: a.title }, { at: "excerpt", text: a.excerpt }, { at: "seo.title", text: a.seo.title }, { at: "seo.metaDescription", text: a.seo.metaDescription }]) {
    if (t.text.includes(PLACEHOLDER)) issues.push(`${t.at}: contains the placeholder ${PLACEHOLDER} — use only facts from the brief`);
    inlineHtmlIssues(t.text, t.at, issues);
  }
  return issues;
}

export function assertArticle(a: Article, spec: SiteSpec): void {
  const issues = validateArticle(a, spec);
  if (issues.length) throw new Error(`article is invalid:\n- ${issues.join("\n- ")}`);
}
