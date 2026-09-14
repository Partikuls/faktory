import type { SiteContext } from "../docker.js";
import { wpOk } from "../wp.js";
import { gbBuild } from "../gb.js";
import type { Page, SiteSpec } from "../schemas/site-spec.js";
import type { DesignTokens } from "../schemas/design-tokens.js";
import { MOBILE, TABLET, esc, stepper, text, upsertBlockElement, type GbNode } from "./elements.js";

export const deps = { gbBuild };
export const BLOG_HERO_SLUG = "faktory-blog-hero";
export const BLOG_LOOP_SLUG = "faktory-blog-loop";
export const POST_HERO_SLUG = "faktory-post-hero";

const container = { maxWidth: "var(--gb-container-width)", marginLeft: "auto", marginRight: "auto" };
const focusRing = { outline: "2px solid var(--accent)", outlineOffset: "3px" };

/** A GenerateBlocks block written by hand; `--` is forbidden inside block comments, so it is escaped as gb_build.py does. */
export function rawGbBlock(name: string, attrs: Record<string, unknown>, inner: string): string {
  const json = JSON.stringify(attrs).replace(/--/g, "\\u002d\\u002d");
  return inner ? `<!-- wp:${name} ${json} -->${inner}<!-- /wp:${name} -->` : `<!-- wp:${name} ${json} /-->`;
}

/** Posts page header: the page's only h1 and its meta description as a visitor-facing intro. */
export function blogHeroTree(page: Page, tokens: DesignTokens): GbNode[] {
  const step = stepper(tokens);
  return [{
    type: "element", tagName: "section", styles: {
      backgroundColor: "var(--base-2)", padding: `${tokens.sectionPadding.desktop}px 24px`,
      [MOBILE]: { padding: `${tokens.sectionPadding.mobile}px 16px` },
    }, innerBlocks: [{
      type: "element", tagName: "div", styles: { ...container }, innerBlocks: [
        text("h1", esc(page.title), { marginBottom: `${step(3)}px` }),
        text("p", esc(page.seo.metaDescription), { fontSize: "20px", color: "var(--contrast-2)", maxWidth: "60ch", marginBottom: "0", [MOBILE]: { fontSize: "18px" } }),
      ],
    }],
  }];
}

/** Archive loop: a card grid on the main query, empty state and page numbers. */
export function blogLoopTree(tokens: DesignTokens): GbNode[] {
  const step = stepper(tokens);
  const radius = `${tokens.radius}px`;

  const card: GbNode = {
    type: "loop-item", tagName: "article", styles: {
      display: "flex", flexDirection: "column", backgroundColor: "var(--base-3)", border: "1px solid var(--contrast-3)", borderRadius: radius,
      overflow: "hidden", transition: "transform 150ms ease, box-shadow 150ms ease",
      "&:hover": { transform: "translateY(-2px)", boxShadow: "0 8px 24px color-mix(in srgb, var(--contrast) 12%, transparent)" },
      "&:focus-within": focusRing,
    }, innerBlocks: [
      { type: "media", tagName: "img", htmlAttributes: { src: "{{featured_image key:url|size:medium_large}}", alt: "{{featured_image key:alt}}", loading: "lazy" },
        styles: { display: "block", width: "100%", height: "auto", aspectRatio: "3/2", objectFit: "cover", backgroundColor: "var(--base-2)" } },
      { type: "element", tagName: "div", styles: { display: "flex", flexDirection: "column", gap: `${step(2)}px`, padding: `${step(4)}px`, flexGrow: "1" }, innerBlocks: [
        text("p", "{{term_list tax:category}}", { fontSize: "13px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", margin: "0" }),
        text("h2", "{{post_title link:post}}", { fontSize: `${tokens.type.h4}px`, lineHeight: "1.25", margin: "0", "& a": { color: "var(--contrast)", textDecoration: "none" }, "& a:hover": { color: "var(--accent)" } }),
        text("p", "{{post_date}}", { fontSize: "14px", color: "var(--contrast-2)", margin: "0" }),
        text("p", "{{post_excerpt length:20}}", { margin: "0", flexGrow: "1" }),
        text("a", 'Lire l\'article<span class="screen-reader-text"> : {{post_title}}</span>', {
          alignSelf: "flex-start", fontWeight: "600", color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "3px",
          "&:hover": { color: "var(--contrast)" }, "&:focus-visible": focusRing,
        }, { href: "{{post_permalink}}" }),
      ] },
    ],
  };

  const noResults: GbNode = { type: "raw", rawMarkup: rawGbBlock(
    "generateblocks/query-no-results", { uniqueId: "fkblognr", tagName: "div" },
    '<div class="gb-query-no-results gb-query-no-results-fkblognr">'
      + rawGbBlock("generateblocks/text", { uniqueId: "fkblognt", tagName: "p", css: ".gb-text-fkblognt{text-align:center;color:var(--contrast-2)}" },
        '<p class="gb-text gb-text-fkblognt">Aucun article pour le moment.</p>')
      + "</div>",
  ) };

  const pageNumbersCss = [
    `.gb-query-page-numbers-fkblogpn{display:flex;flex-wrap:wrap;justify-content:center;gap:${step(2)}px;margin-top:${step(6)}px}`,
    `.gb-query-page-numbers-fkblogpn .page-numbers{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0 ${step(2)}px;border:1px solid var(--contrast-3);border-radius:${radius};color:var(--contrast);text-decoration:none}`,
    ".gb-query-page-numbers-fkblogpn .page-numbers.current{background-color:var(--accent);border-color:var(--accent);color:var(--base-3)}",
    ".gb-query-page-numbers-fkblogpn a.page-numbers:hover{border-color:var(--accent);color:var(--accent)}",
  ].join("");
  const pageNumbers: GbNode = { type: "raw", rawMarkup: rawGbBlock(
    "generateblocks/query-page-numbers", { uniqueId: "fkblogpn", tagName: "div", css: pageNumbersCss },
    '<div class="gb-query-page-numbers gb-query-page-numbers-fkblogpn"></div>',
  ) };

  return [{
    type: "query", tagName: "div", attrs: { inheritQuery: true, query: {} }, styles: {
      ...container, padding: `${step(7)}px 24px`, [MOBILE]: { padding: `${step(5)}px 16px` },
    }, innerBlocks: [
      { type: "looper", tagName: "div", styles: {
        display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: `${step(5)}px`,
        [TABLET]: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
        [MOBILE]: { gridTemplateColumns: "1fr" },
      }, innerBlocks: [card] },
      noResults,
      pageNumbers,
    ],
  }];
}

/** Single post header: category + date, the only h1, featured image in 16/9. */
export function postHeroTree(tokens: DesignTokens): GbNode[] {
  const step = stepper(tokens);
  return [{
    type: "element", tagName: "section", styles: { backgroundColor: "var(--base)", padding: `${step(7)}px 24px ${step(5)}px`, [MOBILE]: { padding: `${step(5)}px 16px ${step(4)}px` } },
    innerBlocks: [{
      type: "element", tagName: "div", styles: { maxWidth: "760px", marginLeft: "auto", marginRight: "auto" }, innerBlocks: [
        text("p", "{{term_list tax:category|link:true}} · {{post_date}}", {
          fontSize: "14px", color: "var(--contrast-2)", marginBottom: `${step(3)}px`,
          "& a": { color: "var(--accent)", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "13px" },
          "& a:hover": { textDecoration: "underline" },
        }),
        text("h1", "{{post_title}}", { marginBottom: `${step(5)}px` }),
        { type: "media", tagName: "img", htmlAttributes: { src: "{{featured_image key:url|size:large}}", alt: "{{featured_image key:alt}}" },
          styles: { display: "block", width: "100%", height: "auto", aspectRatio: "16/9", objectFit: "cover", borderRadius: `${tokens.radius}px`, backgroundColor: "var(--base-2)" } },
      ],
    }],
  }];
}

const HERO_META = { _generate_block_type: "page-hero", _generate_hook: "generate_after_header" };

/** Blog archive hero + loop template and single post hero, as GP Premium block elements. No blog page → nothing. */
export async function installBlog(ctx: SiteContext, spec: SiteSpec, tokens: DesignTokens): Promise<number[] | undefined> {
  const page = spec.sitemap.find((p) => p.kind === "blog");
  if (!page) return undefined;
  const hero = await upsertBlockElement(ctx, {
    slug: BLOG_HERO_SLUG, title: "Faktory blog hero", markup: await deps.gbBuild(ctx.config, blogHeroTree(page, tokens)),
    meta: { ...HERO_META, _generate_disable_title: "true" },
    conditions: [{ rule: "general:blog", object: "" }],
  });
  const loop = await upsertBlockElement(ctx, {
    slug: BLOG_LOOP_SLUG, title: "Faktory blog loop", markup: await deps.gbBuild(ctx.config, blogLoopTree(tokens)),
    meta: { _generate_block_type: "loop-template" },
    conditions: [{ rule: "general:blog", object: "" }, { rule: "taxonomy:category", object: "" }],
  });
  const post = await upsertBlockElement(ctx, {
    slug: POST_HERO_SLUG, title: "Faktory post hero", markup: await deps.gbBuild(ctx.config, postHeroTree(tokens)),
    meta: { ...HERO_META, _generate_disable_title: "true", _generate_disable_featured_image: "true", _generate_disable_primary_post_meta: "true" },
    conditions: [{ rule: "post:post", object: "" }],
  });
  await wpOk(ctx, ["option", "update", "generate_dynamic_css_output", ""]);
  return [hero, loop, post];
}
