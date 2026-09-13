import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { wpOk } from "../../src/wp.js";
import { artifactPath, pageMarkupPath, pageTreePath } from "../../src/artifacts.js";
import { deps as pagesDeps } from "../../src/stages/pages.js";
import { featureMarker, formMarker, type PageTree } from "../../src/schemas/page-tree.js";
import type { Page } from "../../src/schemas/site-spec.js";

/** Stand-in for the agent: writes a minimal valid tree (h1 + markers) and returns it. */
function stubTree(page: Page): PageTree {
  return page.sections.map((s, i) => ({
    type: "element" as const, tagName: "section", htmlAttributes: { id: `s-${i}` },
    styles: { backgroundColor: i % 2 ? "var(--base-2)" : "var(--base)", padding: "48px 24px", "@media (max-width:767px)": { padding: "32px 16px" } },
    innerBlocks: [
      { type: "text" as const, tagName: i === 0 ? "h1" : "h2", content: s.heading, styles: { color: "var(--contrast)" } },
      { type: "text" as const, tagName: "p", content: s.summary },
      ...(s.type === "custom-query" && s.feature ? [{ type: "raw" as const, rawMarkup: featureMarker(s.feature) }] : []),
      ...((s.type === "form" || s.type === "contact") && s.form ? [{ type: "raw" as const, rawMarkup: formMarker(s.form) }] : []),
    ],
  }));
}

describe.skipIf(!process.env.FAKTORY_DOCKER)("pages stage on a throwaway site (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8194 };
  beforeAll(async () => {
    await initSite(config, { slug: "itpages", briefPath: "fixtures/briefs/boulangerie.md" });
    const ctx = loadContext(config, "itpages");
    copyFileSync("fixtures/specs/boulangerie.site-spec.json", artifactPath(ctx, "siteSpecJson"));
    copyFileSync("fixtures/specs/boulangerie.design-tokens.json", artifactPath(ctx, "designTokensJson"));
    writeFileSync(artifactPath(ctx, "designSystemMd"), "# Maison Rivet — Design System Web\n");
    const p = await runSite(config, "itpages", { only: "provision" });
    expect(p.stages.provision.status, p.stages.provision.message).toBe("done");
  });
  afterAll(async () => { vi.restoreAllMocks(); await destroySite(config, "itpages"); });

  it("publishes every non-blog page, styled by GenerateBlocks, and reuses the trees on a second run", async () => {
    const gen = vi.spyOn(pagesDeps, "generatePageTree").mockImplementation(async (ctx, _spec, page) => {
      const tree = stubTree(page);
      writeFileSync(pageTreePath(ctx, page.slug), JSON.stringify(tree, null, 2));
      return { tree, costUsd: 0, attempts: 1 };
    });
    const s1 = await runSite(config, "itpages", { only: "pages" });
    expect(s1.stages.pages.status, s1.stages.pages.message).toBe("done");
    expect(s1.stages.pages.message).toMatch(/^5 pages published \(accueil, nos-produits, commandes-evenements, la-maison, contact\); 5 generated, 0 reused; blog skipped \(actualites\)/);
    expect(gen).toHaveBeenCalledTimes(5);
    const ctx = loadContext(config, "itpages");

    for (const [slug, path, heading] of [
      ["accueil", "/", "Le pain comme en 1987, le levain comme toujours"],
      ["nos-produits", "/nos-produits/", "Nos produits"],
      ["contact", "/contact/", "Horaires"],
    ] as const) {
      expect(existsSync(pageMarkupPath(ctx, slug))).toBe(true);
      const res = await fetch(`http://localhost:${ctx.state.port}${path}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<h1 class="gb-text`);
      expect(html).toContain(heading);
      expect(html).toMatch(/class="gb-element-[0-9a-f]+"/);
      expect(html).toMatch(/\.gb-element-[0-9a-f]+\{/); // GB compiled the block CSS into the page
      expect(html).not.toContain("gb-block-preview");
    }
    const contactHtml = await (await fetch(`http://localhost:${ctx.state.port}/contact/`)).text();
    expect(contactHtml).toContain("faktory:form:contact");
    const homeContent = readFileSync(pageMarkupPath(ctx, "accueil"), "utf8");
    expect(homeContent).toContain(featureMarker("catalogue_produits"));

    const blogContent = await wpOk(ctx, ["post", "list", "--post_type=page", "--name=actualites", "--field=post_content"]);
    expect(blogContent.trim()).toBe("");

    gen.mockClear();
    const s2 = await runSite(config, "itpages", { only: "pages" });
    expect(s2.stages.pages.message).toMatch(/0 generated, 5 reused/);
    expect(gen).not.toHaveBeenCalled();
  });
});
