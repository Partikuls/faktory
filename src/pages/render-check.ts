import { siteUrl, type SiteContext } from "../docker.js";
import { RENDER_ATTR } from "../schemas/plugin-manifest.js";
import type { Page } from "../schemas/site-spec.js";

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.text();
}

export const deps = { fetchText };

export function pageUrl(ctx: SiteContext, page: Page): string {
  return page.kind === "home" ? `${siteUrl(ctx)}/` : `${siteUrl(ctx)}/${page.slug}/`;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—" };

/** Decode the HTML entities WordPress and Yoast emit in titles (named subset + numeric). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m);
}

/** Decoded, whitespace-collapsed text of the first <title>; undefined when the page has none. */
export function pageTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : undefined;
}

/** Fetch `url` and require `needle` in its HTML; the hint says what to look at when it is missing. Returns the HTML. */
export async function assertContains(ctx: SiteContext, url: string, needle: string, hint: string): Promise<string> {
  void ctx;
  const html = await deps.fetchText(url);
  if (!html.includes(needle)) throw new Error(`${url} does not contain "${needle}" — ${hint}`);
  return html;
}

/** Fetch `url` and require its decoded <title> to equal `expected`. */
export async function assertTitle(ctx: SiteContext, url: string, expected: string): Promise<void> {
  void ctx;
  const title = pageTitle(await deps.fetchText(url));
  if (title !== expected) throw new Error(`${url} has title ${title === undefined ? "none" : `"${title}"`}, expected "${expected}"`);
}

function label(page: Page): string {
  return `${page.kind === "home" ? "/" : `/${page.slug}/`} (${page.slug})`;
}

async function assertPageContains(ctx: SiteContext, page: Page, needle: string, hint: string): Promise<void> {
  void ctx;
  const html = await deps.fetchText(pageUrl(ctx, page));
  if (!html.includes(needle)) throw new Error(`${label(page)} does not render ${needle} — ${hint}`);
}

/**
 * The published-page half of the plugin contract: whichever stage inserted the block (`plugins` on an
 * existing tree, `pages` on a fresh one), the page must actually render `data-faktory-plugin="<id>"`.
 */
export async function assertRendered(ctx: SiteContext, page: Page, featureId: string): Promise<void> {
  await assertPageContains(ctx, page, `${RENDER_ATTR}="${featureId}"`, "check the render function and that the block is registered");
}

export const formNeedle = (gfId: number): string => `gform_wrapper_${gfId}`;

/** The published-page half of the forms contract: the Gravity Forms block placed by `content` or `pages` must render its wrapper. */
export async function assertFormRendered(ctx: SiteContext, page: Page, gfId: number): Promise<void> {
  await assertPageContains(ctx, page, formNeedle(gfId), `check that Gravity Forms is active and form #${gfId} exists`);
}
