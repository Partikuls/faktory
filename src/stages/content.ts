import { existsSync } from "node:fs";
import type { Stage } from "../pipeline.js";
import { assertBudget } from "../budget.js";
import { readJsonArtifact } from "../artifacts.js";
import { mapLimit } from "../concurrency.js";
import { ensurePages } from "../provision/pages.js";
import { ensureForms, integrateForms } from "../content/forms.js";
import { applyPageSeo } from "../content/seo.js";
import {
  ensureCategories, generateArticle, publishArticle, readArticle, assertArticleRendered, assertBlogLists, ARTICLES_CONCURRENCY, type SpecArticle,
} from "../content/articles.js";
import { parseSiteSpec } from "../schemas/site-spec.js";
import { articlePath, articleSlug, type Article } from "../schemas/article.js";

export const deps = { ensurePages, ensureForms, integrateForms, applyPageSeo, ensureCategories, generateArticle, publishArticle, assertArticleRendered, assertBlogLists };

export const contentStage: Stage = {
  name: "content",
  async run(ctx) {
    const spec = readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec);
    const ids = await deps.ensurePages(ctx, spec);

    // 1. forms (deterministic)
    let formsMsg = "forms: none";
    if (spec.forms.length) {
      const f = await deps.ensureForms(ctx, spec);
      const i = await deps.integrateForms(ctx, spec, f.manifest, ids);
      const waiting = i.skipped.length ? `, ${i.skipped.length} waiting for the pages stage` : "";
      formsMsg = `forms: ${spec.forms.map((x) => `${x.id} → #${f.manifest[x.id].gfId}`).join(", ")} (${f.created.length} created, ${f.reused.length} reused; ${i.pages.length} pages updated${waiting})`;
    }

    // 2. seo (deterministic)
    const seoDone = await deps.applyPageSeo(ctx, spec, ids);
    console.log(`  ✔ seo meta on ${seoDone.length} pages`);

    // 3. articles (one agent each, ARTICLES_CONCURRENCY in flight)
    const categories = await deps.ensureCategories(ctx, spec);
    const generated: string[] = [], reused: string[] = [], published: string[] = [];
    let cost = 0;
    const build = async (article: SpecArticle): Promise<string> => {
      const slug = articleSlug(article.title);
      let a: Article;
      if (existsSync(articlePath(ctx, slug))) {
        a = readArticle(ctx, spec, slug);
        reused.push(slug);
      } else {
        assertBudget(ctx.config, ctx.state);
        const g = await deps.generateArticle(ctx, spec, article);
        a = g.article; cost += g.costUsd; generated.push(slug);
      }
      await deps.publishArticle(ctx, slug, a, categories, article.keywords[0]);
      await deps.assertArticleRendered(ctx, slug, a);
      published.push(slug);
      console.log(`  ✔ /${slug}/ published`);
      return slug;
    };
    const results = await mapLimit(spec.blog.articles, ARTICLES_CONCURRENCY, build);
    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        failed.push(articleSlug(spec.blog.articles[i].title));
        console.error(`  ✖ ${articleSlug(spec.blog.articles[i].title)}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
    });
    for (const r of results) {
      if (r.status === "rejected" && r.reason instanceof Error && r.reason.message.includes("Cost budget reached")) throw r.reason;
    }
    if (failed.length) {
      throw new Error(`${failed.length} article(s) failed: ${failed.join(", ")} — fix or delete content/articles/<slug>.json and re-run: faktory run ${ctx.slug} --only content`);
    }
    const slugs = spec.blog.articles.map((a) => articleSlug(a.title));
    await deps.assertBlogLists(ctx, spec, slugs);
    return `${formsMsg}; seo: ${seoDone.length} pages; articles: ${published.length} published (${slugs.join(", ")}); ${generated.length} generated, ${reused.length} reused — $${cost.toFixed(2)}`;
  },
};
