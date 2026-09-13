import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SiteContext } from "../docker.js";
import { gbBuild } from "../gb.js";
import { wpOk } from "../wp.js";
import { pageMarkupPath } from "../artifacts.js";
import { GP_PAGE_META } from "../provision/pages.js";
import { FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type PageTree } from "../schemas/page-tree.js";
import type { Page, SiteSpec } from "../schemas/site-spec.js";
import type { PluginManifest } from "../schemas/plugin-manifest.js";
import type { FormsManifest } from "../schemas/forms-manifest.js";
import { applyPlacements, formPlacements, pluginPlacements, readFormsManifest, readPluginManifests } from "./placements.js";
import { assertFormRendered, assertRendered } from "./render-check.js";

/** Compile a validated tree with gb_build.py and keep the markup next to the tree (`pages/<slug>.html`). */
export async function compilePage(ctx: SiteContext, slug: string, tree: PageTree): Promise<string> {
  const markup = await deps.gbBuild(ctx.config, tree);
  const out = pageMarkupPath(ctx, slug);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, markup);
  return markup;
}

/** Replace the page content (markup on stdin, same as the footer element) and re-assert the GP landing-page meta. */
export async function publishPage(ctx: SiteContext, id: number, markup: string): Promise<void> {
  await wpOk(ctx, ["post", "update", String(id), "-", "--post_status=publish"], { input: markup });
  for (const [k, v] of GP_PAGE_META) await wpOk(ctx, ["post", "meta", "update", String(id), k, v]);
}

export type Republished = { markup: string; features: string[]; forms: string[] };

/**
 * The whole "tree on disk → live page" path shared by the pages and qa stages (phase 6 decision 7): apply the
 * plugin and form placements at compile time, compile, publish, then fetch the page and require the render
 * attribute of every applied plugin and the wrapper of every applied form. `opts` lets a caller that loops over
 * pages read the manifests once.
 */
export async function republishPage(
  ctx: SiteContext, spec: SiteSpec, page: Page, id: number, tree: PageTree,
  opts: { manifests?: PluginManifest[]; forms?: FormsManifest } = {},
): Promise<Republished> {
  void spec;
  const manifests = opts.manifests ?? readPluginManifests(ctx);
  const forms = opts.forms ?? readFormsManifest(ctx);
  const a = applyPlacements(tree, [...pluginPlacements(manifests, page.slug), ...formPlacements(forms, page)]);
  const features = a.applied.filter((p) => p.attr === FEATURE_WRAPPER_ATTR).map((p) => p.id);
  const applied = a.applied.filter((p) => p.attr === FORM_WRAPPER_ATTR).map((p) => p.id);
  const markup = await deps.compilePage(ctx, page.slug, a.tree);
  await deps.publishPage(ctx, id, markup);
  for (const f of features) await assertRendered(ctx, page, f);
  for (const f of applied) await assertFormRendered(ctx, page, forms[f].gfId);
  return { markup, features, forms: applied };
}

// After the function declarations (hoisted) so the spy seam covers compile/publish too.
export const deps = { gbBuild, compilePage, publishPage };
