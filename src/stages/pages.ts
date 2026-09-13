import { existsSync } from "node:fs";
import type { Stage } from "../pipeline.js";
import { assertBudget } from "../budget.js";
import { hasArtifact, readJsonArtifact, pageTreePath } from "../artifacts.js";
import { mapLimit } from "../concurrency.js";
import { ensurePages } from "../provision/pages.js";
import { generatePageTree, readPageTree } from "../pages/generate.js";
import { compilePage, publishPage } from "../pages/publish.js";
import { parseSiteSpec, type Page } from "../schemas/site-spec.js";
import { parseDesignTokens } from "../schemas/design-tokens.js";
import type { PageTree } from "../schemas/page-tree.js";

export const deps = { ensurePages, generatePageTree, compilePage, publishPage };
export const PAGES_CONCURRENCY = 3;

export const pagesStage: Stage = {
  name: "pages",
  async run(ctx) {
    const spec = readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec);
    readJsonArtifact(ctx, "designTokensJson", parseDesignTokens);
    if (!hasArtifact(ctx, "designSystemMd")) throw new Error(`design-system.md not found in ${ctx.siteDir} — run the design stage first (faktory run ${ctx.slug} --only design)`);

    const ids = await deps.ensurePages(ctx, spec);
    const home = spec.sitemap.find((p) => p.kind === "home")!; // SiteSpec guarantees exactly one
    const pages = spec.sitemap.filter((p) => p.kind !== "blog");
    const skipped = spec.sitemap.filter((p) => p.kind === "blog").map((p) => p.slug);
    const generated: string[] = [], reused: string[] = [];
    let cost = 0;

    const build = async (page: Page): Promise<void> => {
      let tree: PageTree;
      if (existsSync(pageTreePath(ctx, page.slug))) {
        tree = readPageTree(ctx, page);
        reused.push(page.slug);
      } else {
        assertBudget(ctx.config, ctx.state);
        const g = await deps.generatePageTree(ctx, spec, page, { homeSlug: page.kind === "home" ? undefined : home.slug });
        tree = g.tree; cost += g.costUsd; generated.push(page.slug);
      }
      const markup = await deps.compilePage(ctx, page.slug, tree);
      await deps.publishPage(ctx, ids[page.slug], markup);
      console.log(`  ✔ ${page.kind === "home" ? "/" : `/${page.slug}/`} published`);
    };

    await build(home); // fixes the pattern; a failing home aborts the stage
    const rest = pages.filter((p) => p.slug !== home.slug);
    const results = await mapLimit(rest, PAGES_CONCURRENCY, build);

    // Budget exhaustion is a global condition, not a per-page failure: surface it as-is.
    for (const r of results) {
      if (r.status === "rejected" && r.reason instanceof Error && r.reason.message.includes("Cost budget reached")) {
        throw r.reason;
      }
    }

    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        failed.push(rest[i].slug);
        console.error(`  ✖ ${rest[i].slug}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
    });
    if (failed.length) {
      throw new Error(`${failed.length} page(s) failed: ${failed.join(", ")} — fix or delete pages/<slug>.gb.json and re-run: faktory run ${ctx.slug} --only pages`);
    }
    const blog = skipped.length ? `; blog skipped (${skipped.join(", ")})` : "";
    return `${pages.length} pages published (${pages.map((p) => p.slug).join(", ")}); ${generated.length} generated, ${reused.length} reused${blog} — $${cost.toFixed(2)}`;
  },
};
