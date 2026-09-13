import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SiteContext } from "../docker.js";
import { gbBuild } from "../gb.js";
import { wpOk } from "../wp.js";
import { pageMarkupPath } from "../artifacts.js";
import { GP_PAGE_META } from "../provision/pages.js";
import type { PageTree } from "../schemas/page-tree.js";

export const deps = { gbBuild };

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
