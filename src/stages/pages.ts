import { existsSync } from "node:fs";
import type { Stage } from "../pipeline.js";
import { assertBudget } from "../budget.js";
import { hasArtifact, readJsonArtifact, pageTreePath } from "../artifacts.js";
import { mapLimit } from "../concurrency.js";
import { ensurePages } from "../provision/pages.js";
import { generatePageTree, readPageTree } from "../pages/generate.js";
import { compilePage, publishPage } from "../pages/publish.js";
import { applyPlacements, pluginPlacements, formPlacements, readPluginManifests, readFormsManifest } from "../pages/placements.js";
import { assertRendered, assertFormRendered } from "../pages/render-check.js";
import { parseSiteSpec, type Page } from "../schemas/site-spec.js";
import { parseDesignTokens } from "../schemas/design-tokens.js";
import { FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type PageTree } from "../schemas/page-tree.js";

export const deps = { ensurePages, generatePageTree, compilePage, publishPage };
// Each of these concurrent agents gets the whole remaining budget as its own maxBudgetUsd cap
// (see the comment on remainingBudget in src/agent.ts), so up to PAGES_CONCURRENCY - 1 extra
// runs' worth of cost can land before the site's maxCostUsd is enforced again. Proper per-run
// budget splitting is deferred to phase 4.
export const PAGES_CONCURRENCY = 3;

export const pagesStage: Stage = {
  name: "pages",
  async run(ctx) {
    const spec = readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec);
    // Parsed value discarded: this only fails fast, with a clear artifact error, when design-tokens.json
    // is missing or invalid — the pages themselves read the tokens directly (via the design-system.md /
    // design/preview.gb.json reads in the prompt), not through this return value.
    readJsonArtifact(ctx, "designTokensJson", parseDesignTokens);
    if (!hasArtifact(ctx, "designSystemMd")) throw new Error(`design-system.md not found in ${ctx.siteDir} — run the design stage first (faktory run ${ctx.slug} --only design)`);
    const manifests = readPluginManifests(ctx);
    const forms = readFormsManifest(ctx);
    const applied = new Set<string>();
    const formsApplied = new Set<string>();

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
      const formPl = formPlacements(forms, page);
      const a = applyPlacements(tree, [...pluginPlacements(manifests, page.slug), ...formPl]);
      const features = a.applied.filter((p) => p.attr === FEATURE_WRAPPER_ATTR).map((p) => p.id);
      const appliedForms = a.applied.filter((p) => p.attr === FORM_WRAPPER_ATTR).map((p) => p.id);
      features.forEach((id) => applied.add(id));
      appliedForms.forEach((id) => formsApplied.add(id));
      const markup = await deps.compilePage(ctx, page.slug, a.tree);
      await deps.publishPage(ctx, ids[page.slug], markup);
      // Fresh-site order (provision → plugins → pages → content): the plugins/content stages had no tree to
      // insert into, so this is where the render contract of every applied plugin and form is checked.
      for (const id of features) await assertRendered(ctx, page, id);
      for (const id of appliedForms) await assertFormRendered(ctx, page, forms[id].gfId);
      console.log(`  ✔ ${page.kind === "home" ? "/" : `/${page.slug}/`} published`);
    };

    await build(home); // fixes the pattern; a failing home aborts the stage
    const rest = pages.filter((p) => p.slug !== home.slug);
    const results = await mapLimit(rest, PAGES_CONCURRENCY, build);

    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        failed.push(rest[i].slug);
        console.error(`  ✖ ${rest[i].slug}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
    });

    // Budget exhaustion is a global condition, not a per-page failure: surface it as-is (every
    // rejection was already logged above).
    for (const r of results) {
      if (r.status === "rejected" && r.reason instanceof Error && r.reason.message.includes("Cost budget reached")) {
        throw r.reason;
      }
    }

    if (failed.length) {
      throw new Error(`${failed.length} page(s) failed: ${failed.join(", ")} — fix or delete pages/<slug>.gb.json and re-run: faktory run ${ctx.slug} --only pages`);
    }
    const blog = skipped.length ? `; blog skipped (${skipped.join(", ")})` : "";
    const plugins = applied.size ? `; plugins applied (${Array.from(applied).sort().join(", ")})` : "";
    const formsMsg = formsApplied.size ? `; forms applied (${Array.from(formsApplied).sort().join(", ")})` : "";
    return `${pages.length} pages published (${pages.map((p) => p.slug).join(", ")}); ${generated.length} generated, ${reused.length} reused${blog}${plugins}${formsMsg} — $${cost.toFixed(2)}`;
  },
};
