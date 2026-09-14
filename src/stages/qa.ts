import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Stage } from "../pipeline.js";
import { assertBudget, withBudgetSlots } from "../budget.js";
import { readJsonArtifact, pageTreePath } from "../artifacts.js";
import { mapLimit } from "../concurrency.js";
import { siteUrl, type SiteContext } from "../docker.js";
import { ensurePages } from "../provision/pages.js";
import { pageUrl } from "../pages/render-check.js";
import { republishPage } from "../pages/publish.js";
import { readFormsManifest, readPluginManifests } from "../pages/placements.js";
import { checkPage, launchBrowser, screenshotOpts, type LinkCache } from "../qa/browser.js";
import { reviewPage } from "../qa/review.js";
import { submitForm } from "../qa/forms.js";
import { formPages, type FormsManifest } from "../schemas/forms-manifest.js";
import { writeQaReport } from "../qa/report.js";
import { parseSiteSpec, type Page, type SiteSpec } from "../schemas/site-spec.js";
import { articleSlug } from "../schemas/article.js";
import {
  MAX_FIX_ROUNDS, checkIssues, checkPath, computeTotals, finalVerdict, hasHardFailure, readQaReport, screenshotRel, treeHash,
  type PageCheck, type QaIssue, type QaPage, type QaReport,
} from "../schemas/qa.js";

export const deps = { ensurePages, launchBrowser, checkPage, reviewPage, republishPage, readQaReport, submitForm };
// Pages audited in parallel; their review agents share the remaining budget (see withBudgetSlots).
export const QA_CONCURRENCY = 3;

export type Target = { slug: string; kind: QaPage["kind"]; url: string; page?: Page };

/** Every sitemap page (in order) then every article of the spec (spec decision 2). */
export function qaTargets(ctx: SiteContext, spec: SiteSpec): Target[] {
  const targets = [
    ...spec.sitemap.map((p): Target => ({ slug: p.slug, kind: p.kind, url: pageUrl(ctx, p), page: p })),
    ...spec.blog.articles.map((a): Target => { const slug = articleSlug(a.title); return { slug, kind: "article", url: `${siteUrl(ctx)}/${slug}/` }; }),
  ];
  const seen = new Set<string>();
  for (const t of targets) {
    if (seen.has(t.slug)) throw new Error(`qa targets share the slug "${t.slug}" (a page and an article, or two articles) — rename one title in SITE-SPEC.md and run: faktory resync ${t.slug}`);
    seen.add(t.slug);
  }
  return targets;
}

/** Each form of the manifest once, on the first sitemap page that carries it (spec B3); forms on no target are skipped. */
export function formTargets(spec: SiteSpec, forms: FormsManifest, targets: Target[]): { formId: string; gfId: number; target: Target }[] {
  const out: { formId: string; gfId: number; target: Target }[] = [];
  for (const [formId, entry] of Object.entries(forms)) {
    const target = targets.find((t) => t.slug === formPages(spec, formId)[0]);
    if (target) out.push({ formId, gfId: entry.gfId, target });
  }
  return out;
}

function writeCheck(ctx: SiteContext, slug: string, check: PageCheck): void {
  const p = checkPath(ctx, slug);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(check, null, 2) + "\n");
}

const label = (t: Target): string => (t.kind === "home" ? "/" : `/${t.slug}/`);
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export const qaStage: Stage = {
  name: "qa",
  async run(ctx) {
    const spec = readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec);
    const previous = deps.readQaReport(ctx);
    const ids = await deps.ensurePages(ctx, spec);
    const manifests = readPluginManifests(ctx), forms = readFormsManifest(ctx);
    const targets = qaTargets(ctx, spec);
    const browser = await deps.launchBrowser();
    const cache: LinkCache = new Map();
    const startCost = ctx.state.costUsd;

    const audit = async (t: Target): Promise<QaPage> => {
      const shots = screenshotOpts(ctx, t.slug);
      let { check, tiles } = await deps.checkPage(browser, t.url, shots, cache);
      writeCheck(ctx, t.slug, check);
      if (hasHardFailure(check)) throw new Error(`${t.url} answered HTTP ${check.status} — the site is broken, fix it before running qa`);
      const entry: QaPage = {
        slug: t.slug, kind: t.kind, url: t.url, status: check.status, check,
        screenshots: { desktop: screenshotRel(t.slug, "desktop"), mobile: screenshotRel(t.slug, "mobile") },
        reviewed: false, reused: false, rounds: 0, issues: [], costUsd: 0,
      };
      const page = t.page;
      if (!page || page.kind === "blog" || !existsSync(pageTreePath(ctx, t.slug))) {
        console.log(`  ✔ ${label(t)} checked (${checkIssues(check).length} automated issue(s))`);
        return entry;
      }
      const hash = treeHash(ctx, t.slug)!;
      const prev = previous?.pages.find((p) => p.slug === t.slug);
      if (prev?.reviewed && prev.treeHash === hash) {
        console.log(`  ✔ ${label(t)} checked, review reused (tree unchanged)`);
        return { ...entry, reviewed: true, reused: true, treeHash: hash, verdict: prev.verdict, summary: prev.summary, issues: prev.issues, costUsd: 0, rounds: 0 };
      }
      let issues: QaIssue[] = [], summary = "", rounds = 0, cost = 0, resume: string | undefined;
      for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
        assertBudget(ctx.config, ctx.state);
        const r = await deps.reviewPage(ctx, spec, page, check, tiles, { resume });
        rounds = round; cost += r.costUsd; resume = r.sessionId; summary = r.verdict.summary;
        // keep what earlier rounds fixed; the latest round owns everything else
        issues = [...issues.filter((i) => i.action === "fixed"), ...r.verdict.issues];
        console.log(`  ${r.treeChanged ? "↻" : "✔"} ${label(t)} round ${round}: ${r.verdict.verdict} (${r.verdict.issues.length} issue(s))`);
        if (!r.treeChanged) break;
        await deps.republishPage(ctx, spec, page, ids[t.slug], r.tree, { manifests, forms });
        ({ check, tiles } = await deps.checkPage(browser, t.url, shots, cache));
        writeCheck(ctx, t.slug, check);
        if (hasHardFailure(check)) throw new Error(`${t.url} answered HTTP ${check.status} after republishing — the site is broken, fix it before running qa`);
      }
      return { ...entry, check, status: check.status, reviewed: true, treeHash: treeHash(ctx, t.slug), rounds, verdict: finalVerdict(issues), summary, issues, costUsd: round4(cost) };
    };

    let results: PromiseSettledResult<QaPage>[];
    try {
      results = await withBudgetSlots(ctx, QA_CONCURRENCY, () => mapLimit(targets, QA_CONCURRENCY, audit));
      // After the review rounds, so a republished page is never submitted twice; sequential, one browser context each.
      for (const f of formTargets(spec, forms, targets)) {
        const settled = results[targets.indexOf(f.target)];
        if (settled.status !== "fulfilled") continue;
        const s = await deps.submitForm(browser, ctx, f.target.url, f.formId, f.gfId);
        console.log(`  ${s.ok ? "✔" : "✖"} ${label(f.target)} form ${f.formId} (#${f.gfId}) ${s.ok ? "submitted" : `— ${s.error}`}`);
        const page = settled.value;
        page.check = { ...page.check, formSubmissions: [...page.check.formSubmissions, s] };
        writeCheck(ctx, page.slug, page.check);
      }
    } finally { await browser.close(); }

    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        failed.push(targets[i].slug);
        console.error(`  ✖ ${targets[i].slug}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
    });
    for (const r of results) {
      if (r.status === "rejected" && r.reason instanceof Error && r.reason.message.includes("Cost budget reached")) throw r.reason;
    }

    // Non-budget failures still get a report: it covers the fulfilled pages, flagged partial, so a failed url
    // never discards the rest of the run's findings.
    const pages = results.filter((r): r is PromiseFulfilledResult<QaPage> => r.status === "fulfilled").map((r) => r.value);
    const failedUrls = targets.filter((t) => failed.includes(t.slug)).map((t) => t.url);
    const report: QaReport = {
      generatedAt: new Date().toISOString(), siteUrl: siteUrl(ctx), costUsd: round4(ctx.state.costUsd - startCost),
      totals: computeTotals(pages), pages, partial: failed.length > 0, failedUrls,
    };
    writeQaReport(ctx, report, spec.identity.name);
    if (failed.length) throw new Error(`${failed.length} url(s) failed: ${failed.join(", ")} — fix the site and re-run: faktory run ${ctx.slug} --only qa`);

    const t = report.totals, reused = pages.filter((p) => p.reused).length;
    const formsFailed = pages.reduce((n, p) => n + p.check.formSubmissions.filter((f) => !f.ok).length, 0);
    return `qa: ${t.urls} urls checked; ${t.reviewed} reviewed (${t.ok} ok, ${t.fixed} fixed, ${t.needsHuman} needs human${reused ? `, ${reused} reused` : ""}); ${t.remainingIssues} remaining issue${t.remainingIssues === 1 ? "" : "s"}${formsFailed ? `; ${formsFailed} form${formsFailed === 1 ? "" : "s"} failed` : ""} — $${report.costUsd.toFixed(2)}`;
  },
};
