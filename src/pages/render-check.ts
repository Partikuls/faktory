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

/**
 * The published-page half of the plugin contract: whichever stage inserted the block (`plugins` on an
 * existing tree, `pages` on a fresh one), the page must actually render `data-faktory-plugin="<id>"`.
 */
export async function assertRendered(ctx: SiteContext, page: Page, featureId: string): Promise<void> {
  const html = await deps.fetchText(pageUrl(ctx, page));
  const needle = `${RENDER_ATTR}="${featureId}"`;
  if (!html.includes(needle)) {
    throw new Error(`${page.kind === "home" ? "/" : `/${page.slug}/`} (${page.slug}) does not render ${needle} — check the render function and that the block is registered`);
  }
}
