import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps as wpDeps } from "../../src/wp.js";
import { gbBuild, gbScript } from "../../src/gb.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { parseDesignTokens } from "../../src/schemas/design-tokens.js";
import type { GbNode } from "../../src/provision/elements.js";
import {
  BLOG_HERO_SLUG, BLOG_LOOP_SLUG, POST_HERO_SLUG, blogHeroTree, blogLoopTree, postHeroTree, rawGbBlock, installBlog, deps,
} from "../../src/provision/blog.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const tokens = parseDesignTokens(JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8")));
const ctx: SiteContext = { config: loadConfig(process.cwd()), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };
const blogPage = spec.sitemap.find((p) => p.kind === "blog")!;
const flat = (nodes: GbNode[]): GbNode[] => nodes.flatMap((n) => [n, ...flat(n.innerBlocks ?? [])]);
const noHex = (tree: unknown) => expect(JSON.stringify(tree)).not.toMatch(/#[0-9a-f]{6}\b/i);

describe("blogHeroTree", () => {
  const tree = blogHeroTree(blogPage, tokens);
  it("has exactly one h1 with the blog page title and the meta description as intro", () => {
    const all = flat(tree);
    expect(all.filter((n) => n.tagName === "h1").map((n) => n.content)).toEqual([blogPage.title]);
    expect(all.some((n) => n.tagName === "p" && n.content === blogPage.seo.metaDescription)).toBe(true);
    noHex(tree);
  });
  it("escapes spec text", () => {
    const amp = { ...blogPage, title: "Pain & actus" };
    expect(flat(blogHeroTree(amp, tokens)).find((n) => n.tagName === "h1")!.content).toBe("Pain &amp; actus");
  });
});

describe("blogLoopTree", () => {
  const tree = blogLoopTree(tokens);
  const all = flat(tree);
  it("inherits the main query and lays cards in a 3/2/1 column grid", () => {
    expect(tree[0]).toMatchObject({ type: "query", attrs: { inheritQuery: true } });
    const looper = all.find((n) => n.type === "looper")!;
    expect(looper.styles).toMatchObject({ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" });
    expect(looper.styles?.["@media (max-width:1024px)"]).toMatchObject({ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" });
    expect(looper.styles?.["@media (max-width:767px)"]).toMatchObject({ gridTemplateColumns: "1fr" });
    noHex(tree);
  });
  it("renders a card with image, category, date, linked h2 title, excerpt and an accessible read link", () => {
    const item = all.find((n) => n.type === "loop-item")!;
    const inner = flat([item]);
    expect(inner.find((n) => n.type === "media")!.htmlAttributes).toMatchObject({ src: "{{featured_image key:url|size:medium_large}}", alt: "{{featured_image key:alt}}" });
    const contents = inner.map((n) => n.content ?? "");
    expect(contents).toEqual(expect.arrayContaining(["{{term_list tax:category}}", "{{post_date}}", "{{post_title link:post}}", "{{post_excerpt length:20}}"]));
    expect(inner.find((n) => n.tagName === "h2")!.content).toBe("{{post_title link:post}}");
    const read = inner.find((n) => n.tagName === "a")!;
    expect(read.htmlAttributes).toEqual({ href: "{{post_permalink}}" });
    expect(read.content).toContain('<span class="screen-reader-text">');
    expect(all.filter((n) => n.tagName === "h1")).toHaveLength(0);
  });
  it("ends with raw no-results and page-numbers blocks whose attribute JSON never contains --", () => {
    const raws = all.filter((n) => n.type === "raw").map((n) => n.rawMarkup!);
    expect(raws).toHaveLength(2);
    expect(raws[0]).toContain("wp:generateblocks/query-no-results");
    expect(raws[0]).toContain("Aucun article pour le moment.");
    expect(raws[1]).toContain("wp:generateblocks/query-page-numbers");
    for (const r of raws) for (const comment of r.match(/<!--[\s\S]*?-->/g)!) expect(comment.slice(4, -3)).not.toContain("--");
  });
});

describe("rawGbBlock", () => {
  it("escapes -- in attributes and self-closes when there is no inner markup", () => {
    expect(rawGbBlock("generateblocks/x", { css: ".a{color:var(--accent)}" }, "")).toBe('<!-- wp:generateblocks/x {"css":".a{color:var(\\u002d\\u002daccent)}"} /-->');
    expect(rawGbBlock("generateblocks/x", {}, "<p>i</p>")).toBe("<!-- wp:generateblocks/x {} --><p>i</p><!-- /wp:generateblocks/x -->");
  });
});

describe("postHeroTree", () => {
  const all = flat(postHeroTree(tokens));
  it("shows category link and date, a single h1 title and the featured image in 16/9", () => {
    expect(all.filter((n) => n.tagName === "h1").map((n) => n.content)).toEqual(["{{post_title}}"]);
    expect(all.some((n) => (n.content ?? "").includes("{{term_list tax:category|link:true}}") && (n.content ?? "").includes("{{post_date}}"))).toBe(true);
    expect(all.find((n) => n.type === "media")!.styles).toMatchObject({ aspectRatio: "16/9", objectFit: "cover" });
    noHex(postHeroTree(tokens));
  });
});

describe("installBlog", () => {
  beforeEach(() => vi.restoreAllMocks());
  const argsOf = (spy: any) => spy.mock.calls.map((c: any) => (c[2] as string[]).slice(1).join(" "));
  function fakeWp() {
    let next = 20;
    return vi.spyOn(wpDeps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      const a = cmd.slice(1).join(" ");
      if (a.startsWith("post list --post_type=gp_elements")) return { stdout: "[]", stderr: "", code: 0 };
      if (a.startsWith("post create")) return { stdout: `${next++}\n`, stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
  }
  it("returns undefined and touches nothing without a blog page", async () => {
    const spy = fakeWp();
    const noBlog = parseSiteSpec({ ...spec, sitemap: spec.sitemap.filter((p) => p.kind !== "blog"), menus: { primary: spec.menus.primary.filter((s) => s !== blogPage.slug), footer: spec.menus.footer.filter((s) => s !== blogPage.slug) } });
    expect(await installBlog(ctx, noBlog, tokens)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
  it("upserts the three elements with their types, hooks, disable flags and conditions, then clears the css cache", async () => {
    vi.spyOn(deps, "gbBuild").mockResolvedValue("<!-- wp:generateblocks/element {} --><div>x</div><!-- /wp:generateblocks/element -->");
    const spy = fakeWp();
    expect(await installBlog(ctx, spec, tokens)).toEqual([20, 21, 22]);
    const a = argsOf(spy);
    expect(a).toEqual(expect.arrayContaining([
      `post create --post_type=gp_elements --post_status=publish --post_title=Faktory blog hero --post_name=${BLOG_HERO_SLUG} --porcelain`,
      "post meta update 20 _generate_block_type page-hero",
      "post meta update 20 _generate_hook generate_after_header",
      "post meta update 20 _generate_disable_title true",
      'post meta update 20 _generate_element_display_conditions [{"rule":"general:blog","object":""}] --format=json',
      `post create --post_type=gp_elements --post_status=publish --post_title=Faktory blog loop --post_name=${BLOG_LOOP_SLUG} --porcelain`,
      "post meta update 21 _generate_block_type loop-template",
      'post meta update 21 _generate_element_display_conditions [{"rule":"general:blog","object":""},{"rule":"taxonomy:category","object":""}] --format=json',
      `post create --post_type=gp_elements --post_status=publish --post_title=Faktory post hero --post_name=${POST_HERO_SLUG} --porcelain`,
      "post meta update 22 _generate_block_type page-hero",
      "post meta update 22 _generate_disable_featured_image true",
      "post meta update 22 _generate_disable_primary_post_meta true",
      'post meta update 22 _generate_element_display_conditions [{"rule":"post:post","object":""}] --format=json',
    ]));
    expect(a.at(-1)).toBe("option update generate_dynamic_css_output ");
  });
  it.skipIf(!existsSync(gbScript(ctx.config, "gb_build.py")))("compiles the three real trees with gb_build.py (python3)", async () => {
    const loop = await gbBuild(ctx.config, blogLoopTree(tokens));
    expect(loop).toContain("wp:generateblocks/query");
    expect(loop).toContain('"inheritQuery":true');
    expect(loop).toContain("wp:generateblocks/loop-item");
    expect(loop).toContain("{{post_title link:post}}");
    expect(loop).toContain("wp:generateblocks/query-page-numbers");
    expect(await gbBuild(ctx.config, blogHeroTree(blogPage, tokens))).toContain("<h1");
    expect(await gbBuild(ctx.config, postHeroTree(tokens))).toContain("{{post_title}}");
  });
});
