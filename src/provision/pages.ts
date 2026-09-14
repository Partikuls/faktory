import type { SiteContext } from "../docker.js";
import { wpOk, wpJson } from "../wp.js";
import type { SiteSpec } from "../schemas/site-spec.js";

/** GeneratePress per-page meta for block-built landing pages (same as the Elementor-import publish loop). */
export const GP_PAGE_META: [string, string][] = [
  ["_generate-full-width-content", "true"],
  ["_generate-sidebar-layout-meta", "no-sidebar"],
  ["_generate-disable-headline", "true"],
];
export const PRIMARY_MENU = "Principal";

type PageRow = { ID: number; post_name: string; post_title: string };

/** WordPress stores titles through kses (`&` → `&amp;`); compare what a visitor reads. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Create every sitemap page as a published, empty placeholder (phase 3 fills them by slug) and keep existing titles in line with the spec. Returns slug → ID. */
export async function ensurePages(ctx: SiteContext, spec: SiteSpec): Promise<Record<string, number>> {
  const existing = await wpJson<PageRow[]>(ctx, ["post", "list", "--post_type=page", "--post_status=any", "--fields=ID,post_name,post_title"]);
  const ids: Record<string, number> = {};
  for (const page of spec.sitemap) {
    const row = existing.find((p) => p.post_name === page.slug);
    let id = row?.ID;
    if (!id) {
      id = Number(await wpOk(ctx, ["post", "create", "--post_type=page", "--post_status=publish", `--post_title=${page.title}`, `--post_name=${page.slug}`, "--porcelain"]));
    } else if (decodeEntities(row!.post_title ?? "") !== page.title) {
      await wpOk(ctx, ["post", "update", String(id), `--post_title=${page.title}`]);
      console.log(`  ↻ title /${page.slug}/: "${decodeEntities(row!.post_title ?? "")}" → "${page.title}"`);
    }
    for (const [k, v] of GP_PAGE_META) await wpOk(ctx, ["post", "meta", "update", String(id), k, v]);
    ids[page.slug] = id;
  }
  const home = spec.sitemap.find((p) => p.kind === "home");
  const blog = spec.sitemap.find((p) => p.kind === "blog");
  if (home) {
    await wpOk(ctx, ["option", "update", "show_on_front", "page"]);
    await wpOk(ctx, ["option", "update", "page_on_front", String(ids[home.slug])]);
  }
  if (blog) await wpOk(ctx, ["option", "update", "page_for_posts", String(ids[blog.slug])]);
  return ids;
}

/** Create/complete the "Principal" menu from spec.menus.primary and assign it to GeneratePress' `primary` location. */
export async function ensureMenus(ctx: SiteContext, spec: SiteSpec, ids: Record<string, number>): Promise<void> {
  const menus = await wpJson<{ term_id: number; name: string }[]>(ctx, ["menu", "list", "--fields=term_id,name"]);
  let menu = menus.find((m) => m.name === PRIMARY_MENU)?.term_id;
  if (!menu) menu = Number(await wpOk(ctx, ["menu", "create", PRIMARY_MENU, "--porcelain"]));
  const items = await wpJson<{ object_id: number | string }[]>(ctx, ["menu", "item", "list", String(menu), "--fields=object_id"]);
  const present = new Set(items.map((i) => String(i.object_id)));
  for (const slug of spec.menus.primary) {
    const id = ids[slug];
    if (!id) { console.warn(`⚠ menu: no page for slug "${slug}", skipped`); continue; }
    if (present.has(String(id))) continue;
    await wpOk(ctx, ["menu", "item", "add-post", String(menu), String(id)]);
  }
  await wpOk(ctx, ["menu", "location", "assign", String(menu), "primary"]);
}
