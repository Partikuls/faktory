import { existsSync } from "node:fs";
import type { SiteContext } from "../docker.js";
import { pageTreePath } from "../artifacts.js";
import { readPageTree } from "../pages/generate.js";
import { applyPlacements, formPlacements, pluginPlacements, readFormsManifest, readPluginManifests } from "../pages/placements.js";
import { assertFormRendered, assertRendered, pageUrl } from "../pages/render-check.js";
import { compilePage, publishPage } from "../pages/publish.js";
import type { PluginManifest } from "../schemas/plugin-manifest.js";
import type { SiteSpec } from "../schemas/site-spec.js";

export { pageUrl };
export const deps = { compilePage, publishPage };

/**
 * For every page the manifest places the plugin on and whose tree already exists: apply every manifest
 * of the site (not only this one) plus the forms manifest, recompile, republish, then fetch the page and
 * require the render attribute (and the wrapper of every form placed on that page). Pages without a tree
 * are skipped: the `pages` stage applies the manifests — and checks the attribute — when it builds them.
 */
export async function integratePlugin(
  ctx: SiteContext, spec: SiteSpec, manifest: PluginManifest, ids: Record<string, number>,
): Promise<{ pages: string[]; skipped: string[] }> {
  const manifests = readPluginManifests(ctx);
  const forms = readFormsManifest(ctx);
  const pages: string[] = [], skipped: string[] = [];
  for (const slug of Object.keys(manifest.placements)) {
    const page = spec.sitemap.find((p) => p.slug === slug);
    if (!page) throw new Error(`manifest places ${manifest.feature} on unknown page "${slug}"`);
    if (!existsSync(pageTreePath(ctx, slug))) { skipped.push(slug); continue; }
    const id = ids[slug];
    if (!id) throw new Error(`no WordPress page for slug "${slug}" — run the provision stage first`);
    const tree = readPageTree(ctx, page);
    const formPl = formPlacements(forms, page);
    const markup = await deps.compilePage(ctx, slug, applyPlacements(tree, [...pluginPlacements(manifests, slug), ...formPl]).tree);
    await deps.publishPage(ctx, id, markup);
    await assertRendered(ctx, page, manifest.feature);
    for (const f of formPl) await assertFormRendered(ctx, page, forms[f.id].gfId);
    pages.push(slug);
    console.log(`  ✔ ${page.kind === "home" ? "/" : `/${slug}/`} renders ${manifest.block}`);
  }
  return { pages, skipped };
}
