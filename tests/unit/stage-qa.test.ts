import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext, registry } from "../../src/pipeline.js";
import { writeJsonArtifact, pageTreePath } from "../../src/artifacts.js";
import { parseSiteSpec, type Page } from "../../src/schemas/site-spec.js";
import { featureMarker, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type PageTree } from "../../src/schemas/page-tree.js";
import { articleSlug } from "../../src/schemas/article.js";
import { checkPath, qaReportJsonPath, qaReportMdPath, parseQaReport, treeHash, QA_REPORT_JSON, type PageCheck, type QaReport } from "../../src/schemas/qa.js";
import { qaStage, deps, QA_CONCURRENCY, qaTargets } from "../../src/stages/qa.js";
import type { ReviewResult } from "../../src/qa/review.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const IDS: Record<string, number> = { accueil: 10, "nos-produits": 11, "commandes-evenements": 12, "la-maison": 13, actualites: 14, contact: 15 };
const NON_BLOG = ["accueil", "nos-produits", "commandes-evenements", "la-maison", "contact"];
const ARTICLES = spec.blog.articles.map((a) => articleSlug(a.title));
const fixtureCheck = (): PageCheck => JSON.parse(readFileSync("fixtures/qa/contact.check.json", "utf8"));
const tick = () => new Promise<void>((r) => setTimeout(r, 5));

function stubTree(page: Page): PageTree {
  return page.sections.map((s, i): PageTree[number] => ({
    type: "element" as const, tagName: "section", htmlAttributes: { id: `s-${i}` }, styles: { padding: "48px 24px" },
    innerBlocks: [
      { type: "text" as const, tagName: i === 0 ? "h1" : "h2", content: s.heading },
      ...(s.type === "custom-query" && s.feature ? [{ type: "element" as const, tagName: "div", htmlAttributes: { [FEATURE_WRAPPER_ATTR]: s.feature }, innerBlocks: [{ type: "text" as const, tagName: "p", content: "Exemple" }, { type: "raw" as const, rawMarkup: featureMarker(s.feature) }] }] : []),
      ...((s.type === "form" || s.type === "contact") && s.form && !page.sections.slice(0, i).some((x) => x.form === s.form)
        ? [{ type: "element" as const, tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: s.form }, innerBlocks: [{ type: "raw" as const, rawMarkup: formMarker(s.form) }, { type: "text" as const, tagName: "p", content: "Le formulaire sera disponible ici." }] }]
        : []),
    ],
  }));
}

async function ctx(opts: { trees?: string[] } = {}): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stqa-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  writeJsonArtifact(c, "siteSpecJson", spec);
  mkdirSync(join(c.siteDir, "pages"), { recursive: true });
  for (const slug of opts.trees ?? NON_BLOG) {
    const page = spec.sitemap.find((p) => p.slug === slug)!;
    if (slug === "accueil") copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, slug));
    else writeFileSync(pageTreePath(c, slug), JSON.stringify(stubTree(page), null, 2));
  }
  return c;
}

type Plan = Record<string, ("ok" | "fixed" | "needs_human")[]>;
/** `plan[slug]` = the verdict of each successive round; "fixed" rewrites the tree so the stage republishes and re-checks. */
function spies(opts: { plan?: Plan; status?: Record<string, number>; delay?: boolean; launchFails?: boolean } = {}) {
  const order: string[] = []; let inFlight = 0, peak = 0;
  const close = vi.fn(async () => { order.push("close"); });
  const ensure = vi.spyOn(deps, "ensurePages").mockResolvedValue(IDS);
  const launch = opts.launchFails
    ? vi.spyOn(deps, "launchBrowser").mockRejectedValue(new Error("Playwright Chromium is not installed — run: npm run setup-playwright"))
    : vi.spyOn(deps, "launchBrowser").mockResolvedValue({ close } as any);
  const check = vi.spyOn(deps, "checkPage").mockImplementation(async (_b, url) => {
    const slug = url.endsWith("/") && new URL(url).pathname !== "/" ? new URL(url).pathname.replace(/\//g, "") : "accueil";
    order.push(`check:${slug}`); inFlight++; peak = Math.max(peak, inFlight);
    if (opts.delay) { await tick(); await tick(); }
    inFlight--;
    return { check: { ...fixtureCheck(), url, status: opts.status?.[slug] ?? 200 }, tiles: { desktop: 2, mobile: 4 } };
  });
  const rounds: Record<string, number> = {};
  const review = vi.spyOn(deps, "reviewPage").mockImplementation(async (c, _s, page, _check, _tiles, o): Promise<ReviewResult> => {
    const n = (rounds[page.slug] = (rounds[page.slug] ?? 0) + 1);
    order.push(`review:${page.slug}:${n}${o?.resume ? ":resume" : ""}`);
    const verdict = opts.plan?.[page.slug]?.[n - 1] ?? "ok";
    c.state = { ...c.state, costUsd: c.state.costUsd + 0.5 };
    const tree: PageTree = JSON.parse(readFileSync(pageTreePath(c, page.slug), "utf8"));
    if (verdict === "fixed") {
      (tree[0].styles as Record<string, unknown>).paddingTop = `${n}px`;
      writeFileSync(pageTreePath(c, page.slug), JSON.stringify(tree, null, 2));
      return { verdict: { verdict, summary: `tour ${n}`, issues: [{ severity: "minor", where: "hero", what: `padding ${n}`, action: "fixed" }] }, treeChanged: true, tree, costUsd: 0.5, attempts: 1, sessionId: `s-${page.slug}-${n}` };
    }
    if (verdict === "needs_human") return { verdict: { verdict, summary: "à revoir", issues: [{ severity: "major", where: "plugin", what: "grille vide", action: "left" }] }, treeChanged: false, tree, costUsd: 0.5, attempts: 1, sessionId: `s-${page.slug}-${n}` };
    return { verdict: { verdict: "ok", summary: "rien", issues: [] }, treeChanged: false, tree, costUsd: 0.5, attempts: 1, sessionId: `s-${page.slug}-${n}` };
  });
  const republish = vi.spyOn(deps, "republishPage").mockImplementation(async (_c, _s, page) => { order.push(`republish:${page.slug}`); return { markup: "", features: [], forms: [] }; });
  return { ensure, launch, close, check, review, republish, order, peak: () => peak };
}

describe("qa stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("is registered in the pipeline after content, without checkpoint", () => {
    expect(registry.qa).toBe(qaStage);
    expect(qaStage.checkpoint).toBeFalsy();
    expect(QA_CONCURRENCY).toBe(3);
    expect(Object.keys(registry)).toEqual(["spec", "design", "provision", "pages", "plugins", "content", "qa", "export"]);
  });
  it("targets every sitemap page then every article", async () => {
    const c = await ctx();
    const t = qaTargets(c, spec);
    expect(t.map((x) => x.slug)).toEqual([...spec.sitemap.map((p) => p.slug), ...ARTICLES]);
    expect(t[0]).toMatchObject({ kind: "home", url: `http://localhost:${c.state.port}/` });
    expect(t.at(-1)).toMatchObject({ kind: "article", url: `http://localhost:${c.state.port}/${ARTICLES.at(-1)}/` });
  });
  it("needs site-spec.json", async () => {
    const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stqa-")));
    await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
    await expect(qaStage.run(loadContext(config, "boul"))).rejects.toThrow(/site-spec.json not found/);
  });
  it("checks every url (3 in flight max), reviews only pages with a tree, writes the checks and both reports", async () => {
    const c = await ctx();
    const s = spies({ delay: true });
    const msg = await qaStage.run(c);
    expect(s.check).toHaveBeenCalledTimes(spec.sitemap.length + ARTICLES.length);
    expect(s.peak()).toBe(3);
    expect(s.review.mock.calls.map((k: any) => k[2].slug).sort()).toEqual([...NON_BLOG].sort());
    expect(s.order.at(-1)).toBe("close");
    for (const slug of [...spec.sitemap.map((p) => p.slug), ...ARTICLES]) expect(existsSync(checkPath(c, slug)), slug).toBe(true);
    const report = parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8")));
    expect(report.totals).toEqual({ urls: 9, reviewed: 5, ok: 5, fixed: 0, needsHuman: 0, remainingIssues: 0 });
    expect(report.pages.map((p) => p.slug)).toEqual([...spec.sitemap.map((p) => p.slug), ...ARTICLES]);
    expect(report.pages.find((p) => p.slug === "actualites")).toMatchObject({ kind: "blog", reviewed: false, rounds: 0 });
    expect(report.pages.find((p) => p.slug === "accueil")).toMatchObject({ reviewed: true, rounds: 1, verdict: "ok", treeHash: treeHash(c, "accueil"), costUsd: 0.5 });
    expect(report.costUsd).toBe(2.5);
    expect(readFileSync(qaReportMdPath(c), "utf8")).toContain("# Rapport QA — Maison Rivet");
    expect(msg).toBe("qa: 9 urls checked; 5 reviewed (5 ok, 0 fixed, 0 needs human); 0 remaining issues — $2.50");
  });
  it("republishes and re-checks after a fix, resumes the session for round 2, and derives the final verdict", async () => {
    const c = await ctx();
    const s = spies({ plan: { accueil: ["fixed", "ok"] } });
    const msg = await qaStage.run(c);
    expect(s.order.filter((o) => o.includes("accueil"))).toEqual(["check:accueil", "review:accueil:1", "republish:accueil", "check:accueil", "review:accueil:2:resume"]);
    expect(s.review.mock.calls.filter((k: any) => k[2].slug === "accueil")[1][5]).toEqual({ resume: "s-accueil-1" });
    const report = parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8")));
    const home = report.pages.find((p) => p.slug === "accueil")!;
    expect(home).toMatchObject({ rounds: 2, verdict: "fixed", costUsd: 1 });
    expect(home.issues).toEqual([{ severity: "minor", where: "hero", what: "padding 1", action: "fixed" }]);
    expect(home.treeHash).toBe(treeHash(c, "accueil"));
    expect(msg).toContain("5 reviewed (4 ok, 1 fixed, 0 needs human); 0 remaining issues");
  });
  it("caps the fix rounds at 2, with a final check after the last republish", async () => {
    const c = await ctx();
    const s = spies({ plan: { contact: ["fixed", "fixed", "fixed"] } });
    await qaStage.run(c);
    expect(s.order.filter((o) => o.includes("contact"))).toEqual(["check:contact", "review:contact:1", "republish:contact", "check:contact", "review:contact:2:resume", "republish:contact", "check:contact"]);
    const report = parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8")));
    expect(report.pages.find((p) => p.slug === "contact")).toMatchObject({ rounds: 2, verdict: "fixed" });
    expect(report.pages.find((p) => p.slug === "contact")!.issues.map((i) => i.what)).toEqual(["padding 1", "padding 2"]);
  });
  it("reports remaining issues without failing", async () => {
    const c = await ctx();
    spies({ plan: { "la-maison": ["needs_human"] } });
    const msg = await qaStage.run(c);
    expect(msg).toContain("(4 ok, 0 fixed, 1 needs human); 1 remaining issue —");
    expect(readFileSync(qaReportMdPath(c), "utf8")).toContain("## /la-maison/ — à revoir");
  });
  it("skips the review of a page whose tree hash is unchanged since the last report, whatever its verdict", async () => {
    const c = await ctx();
    spies();
    await qaStage.run(c);
    vi.restoreAllMocks();
    const s = spies();
    const msg = await qaStage.run(c);
    expect(s.review).not.toHaveBeenCalled();
    expect(s.check).toHaveBeenCalledTimes(9);
    expect(msg).toBe("qa: 9 urls checked; 5 reviewed (5 ok, 0 fixed, 0 needs human, 5 reused); 0 remaining issues — $0.00");
    const report = parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8")));
    expect(report.pages.find((p) => p.slug === "accueil")).toMatchObject({ reviewed: true, reused: true, verdict: "ok", rounds: 0, costUsd: 0 });
  });
  it("reuses a needs_human page too, carrying its left issue forward at $0", async () => {
    const c = await ctx();
    spies({ plan: { "la-maison": ["needs_human"] } });
    await qaStage.run(c);
    vi.restoreAllMocks();
    const s = spies();
    const msg = await qaStage.run(c);
    expect(s.review).not.toHaveBeenCalled();
    expect(msg).toBe("qa: 9 urls checked; 5 reviewed (4 ok, 0 fixed, 1 needs human, 5 reused); 1 remaining issue — $0.00");
    const report = parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8")));
    expect(report.pages.find((p) => p.slug === "la-maison")).toMatchObject({
      reviewed: true, reused: true, verdict: "needs_human", rounds: 0, costUsd: 0,
      issues: [{ severity: "major", where: "plugin", what: "grille vide", action: "left" }],
    });
  });
  it("re-reviews a page whose tree changed since the last report", async () => {
    const c = await ctx();
    spies();
    await qaStage.run(c);
    vi.restoreAllMocks();
    writeFileSync(pageTreePath(c, "contact"), JSON.stringify(stubTree(spec.sitemap.find((p) => p.slug === "contact")!)) + "\n");
    const s = spies();
    await qaStage.run(c);
    expect(s.review.mock.calls.map((k: any) => k[2].slug)).toEqual(["contact"]);
  });
  it("fails the stage on a non-200 url, after checking the others, closes the browser, and still writes a partial report", async () => {
    const c = await ctx();
    const s = spies({ status: { "la-maison": 500 } });
    await expect(qaStage.run(c)).rejects.toThrow(/1 url\(s\) failed: la-maison — fix the site and re-run: faktory run boul --only qa/);
    expect(s.check).toHaveBeenCalledTimes(9);
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(existsSync(qaReportJsonPath(c))).toBe(true);
    const report = parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8")));
    expect(report.partial).toBe(true);
    const failedTarget = qaTargets(c, spec).find((t) => t.slug === "la-maison")!;
    expect(report.failedUrls).toEqual([failedTarget.url]);
    expect(report.pages).toHaveLength(8);
    expect(report.pages.some((p) => p.slug === "la-maison")).toBe(false);
  });
  it("throws when a page and an article share the same slug", async () => {
    const c = await ctx();
    const colliding = parseSiteSpec({
      ...spec,
      blog: { ...spec.blog, articles: [...spec.blog.articles, { title: "Contact", theme: spec.blog.articles[0].theme, keywords: ["contact"] }] },
    });
    expect(() => qaTargets(c, colliding)).toThrow(/qa targets share the slug "contact" \(a page and an article, or two articles\) — rename one title in SITE-SPEC.md and run: faktory resync contact/);
  });
  it("fails before any review when the browser is missing", async () => {
    const c = await ctx();
    const s = spies({ launchFails: true });
    await expect(qaStage.run(c)).rejects.toThrow(/Playwright Chromium is not installed/);
    expect(s.check).not.toHaveBeenCalled();
    expect(s.review).not.toHaveBeenCalled();
  });
  it("rethrows the budget error as-is and closes the browser", async () => {
    const c = await ctx();
    c.state = { ...c.state, costUsd: 40 };
    const s = spies();
    await expect(qaStage.run(c)).rejects.toThrow(/Cost budget reached/);
    expect(s.review).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(existsSync(qaReportJsonPath(c))).toBe(false);
  });
  it("refuses a corrupt report.json with a delete hint", async () => {
    const c = await ctx();
    writeFileSync(join(c.siteDir, QA_REPORT_JSON), "{ nope");
    spies();
    await expect(qaStage.run(c)).rejects.toThrow(/qa\/report.json is not valid JSON.*delete it/);
  });
  it("does not review a page without a tree", async () => {
    const c = await ctx({ trees: ["accueil"] });
    const s = spies();
    const msg = await qaStage.run(c);
    expect(s.review.mock.calls.map((k: any) => k[2].slug)).toEqual(["accueil"]);
    expect(msg).toContain("9 urls checked; 1 reviewed");
  });
});
