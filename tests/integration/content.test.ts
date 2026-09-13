// tests/integration/content.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { wpJson, wpOk } from "../../src/wp.js";
import { artifactPath, pageTreePath } from "../../src/artifacts.js";
import { articlePath, articleSlug, type Article } from "../../src/schemas/article.js";
import { formsManifestPath } from "../../src/schemas/forms-manifest.js";
import { YOAST_META } from "../../src/content/seo.js";
import { decodeEntities } from "../../src/pages/render-check.js";
import { deps as pagesDeps } from "../../src/stages/pages.js";
import { deps as contentDeps } from "../../src/stages/content.js";
import { featureMarker, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type GbNode, type PageTree } from "../../src/schemas/page-tree.js";
import type { Page, SiteSpec } from "../../src/schemas/site-spec.js";
import type { SiteContext } from "../../src/docker.js";

const FIXTURE_ARTICLE = "fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json";

function stubTree(page: Page): PageTree {
  return page.sections.map((s, i): GbNode => ({
    type: "element", tagName: "section", htmlAttributes: { id: `s-${i}` },
    styles: { backgroundColor: i % 2 ? "var(--base-2)" : "var(--base)", padding: "48px 24px" },
    innerBlocks: [
      { type: "text", tagName: i === 0 ? "h1" : "h2", content: s.heading },
      { type: "text", tagName: "p", content: s.summary },
      ...(s.type === "custom-query" && s.feature
        ? [{ type: "element", tagName: "div", htmlAttributes: { [FEATURE_WRAPPER_ATTR]: s.feature },
             innerBlocks: [{ type: "text", tagName: "p", content: "Exemple de carte" }, { type: "raw", rawMarkup: featureMarker(s.feature) }] } satisfies GbNode]
        : []),
      ...((s.type === "form" || s.type === "contact") && s.form && !page.sections.slice(0, i).some((x) => x.form === s.form)
        ? [{ type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: s.form },
             innerBlocks: [{ type: "raw", rawMarkup: formMarker(s.form) }, { type: "text", tagName: "p", content: "Le formulaire sera disponible ici." }] } satisfies GbNode]
        : []),
    ] satisfies GbNode[],
  }));
}

describe.skipIf(!process.env.FAKTORY_DOCKER)("content stage on a throwaway site (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8196 };
  let ctx: SiteContext;
  let spec: SiteSpec;
  const fixture = (): Article => JSON.parse(readFileSync(FIXTURE_ARTICLE, "utf8"));
  beforeAll(async () => {
    await initSite(config, { slug: "itcontent", briefPath: "fixtures/briefs/boulangerie.md" });
    ctx = loadContext(config, "itcontent");
    copyFileSync("fixtures/specs/boulangerie.site-spec.json", artifactPath(ctx, "siteSpecJson"));
    copyFileSync("fixtures/specs/boulangerie.design-tokens.json", artifactPath(ctx, "designTokensJson"));
    writeFileSync(artifactPath(ctx, "designSystemMd"), "# Maison Rivet — Design System Web\n");
    spec = JSON.parse(readFileSync(artifactPath(ctx, "siteSpecJson"), "utf8"));
    const p = await runSite(config, "itcontent", { only: "provision" });
    expect(p.stages.provision.status, p.stages.provision.message).toBe("done");
    vi.spyOn(pagesDeps, "generatePageTree").mockImplementation(async (c, _spec, page) => {
      const tree = stubTree(page);
      writeFileSync(pageTreePath(c, page.slug), JSON.stringify(tree, null, 2));
      return { tree, costUsd: 0, attempts: 1 as const };
    });
    const pg = await runSite(config, "itcontent", { only: "pages" });
    expect(pg.stages.pages.status, pg.stages.pages.message).toBe("done");
  }, 600_000);
  afterAll(async () => { vi.restoreAllMocks(); await destroySite(config, "itcontent"); });

  it("creates the forms, sets the seo meta, publishes the (stubbed) articles and renders everything", async () => {
    // The agent is stubbed: every spec article gets the fixture body under its own title (the other checks are real).
    const gen = vi.spyOn(contentDeps, "generateArticle").mockImplementation(async (c, _s, article) => {
      const slug = articleSlug(article.title);
      const a: Article = { ...fixture(), title: article.title, category: article.theme };
      mkdirSync(dirname(articlePath(c, slug)), { recursive: true });
      writeFileSync(articlePath(c, slug), JSON.stringify(a, null, 2));
      return { article: a, slug, costUsd: 0, attempts: 1 as const };
    });
    const state = await runSite(config, "itcontent", { only: "content" });
    expect(state.stages.content.status, state.stages.content.message).toBe("done");
    expect(gen).toHaveBeenCalledTimes(3);
    expect(state.stages.content.message).toMatch(/forms: devis_evenement → #\d+, contact → #\d+ \(2 created, 0 reused; 2 pages updated\); seo: 6 pages; articles: 3 published/);

    // forms: real Gravity Forms forms, with the admin notification, rendered on their pages
    const manifest = JSON.parse(readFileSync(formsManifestPath(ctx), "utf8"));
    const forms = await wpJson<{ id: string; title: string }[]>(ctx, ["gf", "form", "form_list"]);
    expect(forms.map((f) => f.title).sort()).toEqual(spec.forms.map((f) => f.name).sort());
    const contactForm = JSON.parse(await wpOk(ctx, ["gf", "form", "get", String(manifest.contact.gfId)]));
    expect(contactForm.fields.map((f: any) => f.type)).toEqual(["text", "email", "textarea"]);
    expect(contactForm.notifications.faktory_admin.to).toBe("contact@maisonrivet.fr");
    const contactHtml = await (await fetch(`http://localhost:${ctx.state.port}/contact/`)).text();
    expect(contactHtml).toContain(`gform_wrapper_${manifest.contact.gfId}`);
    expect(contactHtml).not.toContain("Le formulaire sera disponible ici.");
    const devisHtml = await (await fetch(`http://localhost:${ctx.state.port}/commandes-evenements/`)).text();
    expect(devisHtml).toContain(`gform_wrapper_${manifest.devis_evenement.gfId}`);
    expect(readFileSync(pageTreePath(ctx, "contact"), "utf8")).toContain(FORM_WRAPPER_ATTR); // tree keeps its wrapper

    // seo: Yoast meta present, rendered title
    const contactId = (await wpJson<{ ID: number }[]>(ctx, ["post", "list", "--post_type=page", "--name=contact", "--fields=ID"]))[0].ID;
    const contactPage = spec.sitemap.find((p) => p.slug === "contact")!;
    expect(await wpOk(ctx, ["post", "meta", "get", String(contactId), YOAST_META.title])).toBe(contactPage.seo.title);
    expect(await wpOk(ctx, ["post", "meta", "get", String(contactId), YOAST_META.metadesc])).toBe(contactPage.seo.metaDescription);
    // Yoast HTML-escapes the attribute value (e.g. "'" → "&#039;"), so decode before comparing (same helper assertTitle uses).
    const descMeta = contactHtml.match(/<meta name="description" content="([^"]*)"/);
    expect(descMeta && decodeEntities(descMeta[1])).toBe(contactPage.seo.metaDescription);

    // articles: published posts with category, excerpt, image, meta; listed on the posts page
    const posts = await wpJson<{ ID: number; post_name: string; post_status: string }[]>(ctx, ["post", "list", "--post_type=post", "--post_status=any", "--fields=ID,post_name,post_status"]);
    expect(posts.map((p) => p.post_name).sort()).toEqual(spec.blog.articles.map((a) => articleSlug(a.title)).sort());
    const galette = posts.find((p) => p.post_name === articleSlug(spec.blog.articles[0].title))!;
    expect(galette.post_status).toBe("publish");
    expect((await wpJson<{ name: string }[]>(ctx, ["post", "term", "list", String(galette.ID), "category", "--fields=name"])).map((t) => t.name)).toEqual(["Saison"]);
    expect(await wpOk(ctx, ["post", "meta", "get", String(galette.ID), "_thumbnail_id"])).toMatch(/^\d+$/);
    const cats = await wpJson<{ name: string }[]>(ctx, ["term", "list", "category", "--fields=name"]);
    for (const c of spec.blog.categories) expect(cats.map((t) => t.name)).toContain(c);
    const post = await (await fetch(`http://localhost:${ctx.state.port}/${galette.post_name}/`)).text();
    expect(post).toContain('class="wp-block-heading"');
    expect(post).toContain("Deux recettes, un seul feuilletage");
    const blog = await (await fetch(`http://localhost:${ctx.state.port}/actualites/`)).text();
    for (const p of posts) expect(blog).toContain(`href="http://localhost:${ctx.state.port}/${p.post_name}/"`);
  }, 600_000);

  it("reuses forms and articles on a second run (no agent), and the pages stage keeps the forms", async () => {
    const gen = vi.spyOn(contentDeps, "generateArticle").mockRejectedValue(new Error("must not be called"));
    const before = (await wpJson<{ id: string }[]>(ctx, ["gf", "form", "form_list"])).length;
    const state = await runSite(config, "itcontent", { only: "content" });
    expect(state.stages.content.status, state.stages.content.message).toBe("done");
    expect(state.stages.content.message).toContain("0 created, 2 reused");
    expect(state.stages.content.message).toContain("0 generated, 3 reused");
    expect(gen).not.toHaveBeenCalled();
    expect((await wpJson<{ id: string }[]>(ctx, ["gf", "form", "form_list"])).length).toBe(before);
    expect((await wpJson<{ ID: number }[]>(ctx, ["post", "list", "--post_type=post", "--fields=ID"])).length).toBe(3);

    const pg = await runSite(config, "itcontent", { only: "pages" });
    expect(pg.stages.pages.status, pg.stages.pages.message).toBe("done");
    expect(pg.stages.pages.message).toContain("forms applied (contact, devis_evenement)");
    const contactHtml = await (await fetch(`http://localhost:${ctx.state.port}/contact/`)).text();
    expect(contactHtml).toContain("gform_wrapper_");
    expect(existsSync(formsManifestPath(ctx))).toBe(true);
  }, 600_000);
});
