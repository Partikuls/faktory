import type { SiteContext } from "../docker.js";
import { wpOk } from "../wp.js";
import { assertTitle, pageUrl } from "../pages/render-check.js";
import type { SiteSpec } from "../schemas/site-spec.js";

export const deps = { wpOk };

export const YOAST_META = { title: "_yoast_wpseo_title", metadesc: "_yoast_wpseo_metadesc", focuskw: "_yoast_wpseo_focuskw" } as const;

/** Yoast title / description / focus keyword of every sitemap page from `page.seo` (decision 4), then the rendered <title> must match. Returns the slugs done. */
export async function applyPageSeo(ctx: SiteContext, spec: SiteSpec, ids: Record<string, number>): Promise<string[]> {
  const done: string[] = [];
  for (const page of spec.sitemap) {
    const id = ids[page.slug];
    if (!id) throw new Error(`no WordPress page for slug "${page.slug}" — run the provision stage first`);
    await deps.wpOk(ctx, ["post", "meta", "update", String(id), YOAST_META.title, page.seo.title]);
    await deps.wpOk(ctx, ["post", "meta", "update", String(id), YOAST_META.metadesc, page.seo.metaDescription]);
    await deps.wpOk(ctx, ["post", "meta", "update", String(id), YOAST_META.focuskw, page.seo.keywords[0]]);
    try {
      await assertTitle(ctx, pageUrl(ctx, page), page.seo.title);
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : String(err)} — check that wordpress-seo is active`);
    }
    done.push(page.slug);
  }
  return done;
}
