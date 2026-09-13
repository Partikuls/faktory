import { existsSync } from "node:fs";
import { siteUrl, type SiteContext } from "../docker.js";
import { pageTreePath } from "../artifacts.js";
import { readPageTree } from "../pages/generate.js";
import { applyPlugins, readPluginManifests } from "../pages/apply-plugins.js";
import { compilePage, publishPage } from "../pages/publish.js";
import { RENDER_ATTR, type PluginManifest } from "../schemas/plugin-manifest.js";
import type { Page, SiteSpec } from "../schemas/site-spec.js";

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.text();
}

export const deps = { compilePage, publishPage, fetchText };

export function pageUrl(ctx: SiteContext, page: Page): string {
  return page.kind === "home" ? `${siteUrl(ctx)}/` : `${siteUrl(ctx)}/${page.slug}/`;
}

/**
 * For every page the manifest places the plugin on and whose tree already exists: apply every manifest
 * of the site (not only this one), recompile, republish, then fetch the page and require the render attribute.
 * Pages without a tree are skipped: the `pages` stage applies the manifests when it builds them.
 */
export async function integratePlugin(
  ctx: SiteContext, spec: SiteSpec, manifest: PluginManifest, ids: Record<string, number>,
): Promise<{ pages: string[]; skipped: string[] }> {
  const manifests = readPluginManifests(ctx);
  const pages: string[] = [], skipped: string[] = [];
  for (const slug of Object.keys(manifest.placements)) {
    const page = spec.sitemap.find((p) => p.slug === slug);
    if (!page) throw new Error(`manifest places ${manifest.feature} on unknown page "${slug}"`);
    if (!existsSync(pageTreePath(ctx, slug))) { skipped.push(slug); continue; }
    const id = ids[slug];
    if (!id) throw new Error(`no WordPress page for slug "${slug}" — run the provision stage first`);
    const tree = readPageTree(ctx, page);
    const markup = await deps.compilePage(ctx, slug, applyPlugins(tree, manifests, slug).tree);
    await deps.publishPage(ctx, id, markup);
    const url = pageUrl(ctx, page);
    const html = await deps.fetchText(url);
    const needle = `${RENDER_ATTR}="${manifest.feature}"`;
    if (!html.includes(needle)) {
      throw new Error(`${page.kind === "home" ? "/" : `/${slug}/`} (${slug}) does not render ${needle} — check the render function and that the block is registered`);
    }
    pages.push(slug);
    console.log(`  ✔ ${page.kind === "home" ? "/" : `/${slug}/`} renders ${manifest.block}`);
  }
  return { pages, skipped };
}
