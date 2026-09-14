import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { SiteContext } from "../docker.js";
import { MAX_LINKS, MAX_TILES, VIEWPORTS, screenshotPath, type PageCheck, type Viewport } from "../schemas/qa.js";
import { inPageAudit } from "./inpage.js";

/** GET (following redirects) and return the status; 0 on a network error. Links are pages, so GET is safe and HEAD is often refused. */
export async function fetchStatus(url: string): Promise<number> {
  try { return (await fetch(url, { redirect: "follow" })).status; } catch { return 0; }
}
export const deps = { launch: (): Promise<Browser> => chromium.launch(), fetchStatus };

/** True when the Chromium build matching the installed `playwright` package is present (`npm run setup-playwright`). */
export function chromiumInstalled(): boolean {
  return existsSync(chromium.executablePath());
}

export async function launchBrowser(): Promise<Browser> {
  if (!chromiumInstalled()) throw new Error("Playwright Chromium is not installed — run: npm run setup-playwright");
  return deps.launch();
}

const SKIP_PATH_RE = /^\/(wp-admin|wp-login\.php)/;

/** Same-origin page links to probe: fragment stripped, own url / mailto / tel / admin / external skipped, deduplicated, capped at MAX_LINKS. */
export function linkCandidates(hrefs: string[], pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const self = page.origin + page.pathname + page.search;
  const out: string[] = [];
  for (const h of hrefs) {
    let u: URL;
    try { u = new URL(h, pageUrl); } catch { continue; }
    if (u.origin !== page.origin || SKIP_PATH_RE.test(u.pathname)) continue;
    const clean = u.origin + u.pathname + u.search;
    if (clean === self || out.includes(clean)) continue;
    out.push(clean);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

export type LinkCache = Map<string, Promise<number>>;

/** Probe each link once per run (shared cache); returns the broken ones (status ≥ 400 or 0). */
export async function checkLinks(hrefs: string[], cache: LinkCache): Promise<{ href: string; status: number }[]> {
  const out: { href: string; status: number }[] = [];
  for (const href of hrefs) {
    let p = cache.get(href);
    if (!p) { p = deps.fetchStatus(href); cache.set(href, p); }
    const status = await p;
    if (status === 0 || status >= 400) out.push({ href, status });
  }
  return out;
}

export type ScreenshotTargets = { desktop: string; mobile: string; tile: (viewport: Viewport, n: number) => string };

export function screenshotOpts(ctx: SiteContext, slug: string): ScreenshotTargets {
  return { desktop: screenshotPath(ctx, slug, "desktop"), mobile: screenshotPath(ctx, slug, "mobile"), tile: (v, n) => screenshotPath(ctx, slug, v, n) };
}

/** Scroll to the bottom viewport by viewport (lazy images, animations), then back to the top. */
async function scrollFully(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(200);
}

/** Full-page screenshot plus viewport-height tiles (max MAX_TILES); returns the number of tiles written. */
async function capture(page: Page, viewport: Viewport, targets: ScreenshotTargets): Promise<number> {
  const full = viewport === "desktop" ? targets.desktop : targets.mobile;
  const dir = dirname(full);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: full, fullPage: true });
  const { width, height } = VIEWPORTS[viewport];
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const tiles = Math.max(1, Math.min(MAX_TILES, Math.ceil(total / height)));
  for (let i = 0; i < tiles; i++) {
    const h = Math.max(1, Math.min(height, total - i * height));
    await page.screenshot({ path: targets.tile(viewport, i + 1), fullPage: true, clip: { x: 0, y: i * height, width, height: h } });
  }
  // A shorter page on a re-run needs fewer tiles: drop any tile left over from a previous, taller version.
  const prefix = basename(full, ".png"); // "<slug>.<viewport>"
  const staleRe = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(\\d+)\\.png$`);
  for (const name of readdirSync(dir)) {
    const m = staleRe.exec(name);
    if (m && Number(m[1]) > tiles) rmSync(join(dir, name));
  }
  return tiles;
}

/**
 * The deterministic half of the qa stage (spec decision 4 + 5): one browser context, desktop then mobile,
 * every check field of `PageCheck`, screenshots written to `targets`. Never throws on a page defect — a
 * non-200 status is reported in `check.status` and the stage decides (`hasHardFailure`).
 */
export async function checkPage(
  browser: Browser, url: string, targets: ScreenshotTargets, cache: LinkCache = new Map(),
): Promise<{ check: PageCheck; tiles: Record<Viewport, number> }> {
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    const origin = new URL(url).origin;
    const consoleErrors: string[] = [], pageErrors: string[] = [], failedRequests: { url: string; status: number }[] = [];
    // Chromium logs its own "Failed to load resource: …" line to the console for every failed request;
    // for a same-origin resource that's already captured in failedRequests, so drop only that case —
    // a cross-origin failure (e.g. a broken third-party image) has no other record and must stay.
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      if (m.text().startsWith("Failed to load resource:") && m.location().url.startsWith(origin)) return;
      consoleErrors.push(m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => pageErrors.push(String(e.message ?? e).slice(0, 300)));
    // Chromium requests /favicon.ico on its own; a site without one is not a page defect.
    page.on("requestfailed", (r) => { if (r.url().startsWith(origin) && new URL(r.url()).pathname !== "/favicon.ico") failedRequests.push({ url: r.url(), status: 0 }); });
    page.on("response", (r) => {
      if (!r.url().startsWith(origin) || r.url() === url || r.status() < 400 || new URL(r.url()).pathname === "/favicon.ico") return;
      failedRequests.push({ url: r.url(), status: r.status() });
    });
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    const status = response?.status() ?? 0;
    await scrollFully(page);
    const audit = await page.evaluate(inPageAudit);
    const desktop = await capture(page, "desktop", targets);
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.waitForTimeout(300);
    await scrollFully(page);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const mobile = await capture(page, "mobile", targets);
    const brokenLinks = await checkLinks(linkCandidates(audit.links, url), cache);
    // pageerror can fire after networkidle (setTimeout in the page): give it a tick
    await page.waitForTimeout(100);
    const check: PageCheck = {
      url, status, consoleErrors, pageErrors, failedRequests, brokenLinks,
      brokenImages: audit.brokenImages, missingAlt: audit.missingAlt, unstyledBlocks: audit.unstyledBlocks, h1Count: audit.h1Count,
      untranslated: audit.untranslated,
      formSubmissions: [],
      mobileOverflow, checkedAt: new Date().toISOString(),
    };
    return { check, tiles: { desktop, mobile } };
  } finally {
    await context.close();
  }
}
