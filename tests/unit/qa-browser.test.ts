import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { chromiumInstalled, launchBrowser, linkCandidates, checkLinks, checkPage, type LinkCache } from "../../src/qa/browser.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const html = (origin: string, extraOrigin: string) => `<!doctype html><html><head><style>.gb-element-ok{padding:1px}</style></head><body>
<h1>Un</h1><h1>Deux</h1><p class="byline">by admin — Read more</p><p>Baby by-pass</p>
<div class="gb-element-ok gb-text-missing gb-container-x1 other">bloc</div>
<style>.gb-container-x1{margin:0}</style>
<img src="/missing.png" alt="cassée"><img src="/ok.png"><img src="${extraOrigin}/ext.png" alt="ext">
<a href="/dead">mort</a><a href="/">home</a><a href="/#top">ancre</a><a href="mailto:a@b.c">m</a><a href="tel:+33">t</a><a href="/wp-admin/">admin</a><a href="${origin}/ok/">ok</a><a href="https://example.com/">ext</a>
<div style="width:2000px">large</div>
<script>console.error("boom"); console.log("info"); setTimeout(() => { throw new Error("crash"); }, 0);</script>
</body></html>`;

describe("linkCandidates", () => {
  it("keeps same-origin page links once, without fragment, skips mailto/tel/wp-admin/wp-login/external, caps at 50", () => {
    const base = "http://localhost:8101";
    const hrefs = [`${base}/a/`, `${base}/a/#x`, `${base}/a/`, "mailto:x@y.z", "tel:+33", `${base}/wp-admin/`, `${base}/wp-login.php?x=1`, "https://example.com/", `${base}/b/?p=2`, `${base}/`];
    expect(linkCandidates(hrefs, `${base}/contact/`)).toEqual([`${base}/a/`, `${base}/b/?p=2`, `${base}/`]);
    const many = Array.from({ length: 60 }, (_, i) => `${base}/p${i}/`);
    expect(linkCandidates(many, `${base}/`)).toHaveLength(50);
  });
  it("excludes the page's own url", () => {
    expect(linkCandidates(["http://localhost:8101/contact/", "http://localhost:8101/contact/#form"], "http://localhost:8101/contact/")).toEqual([]);
  });
});

describe.skipIf(!chromiumInstalled())("checkPage against a local page (chromium)", () => {
  let server: Server; let origin = "";
  let extraServer: Server; let extraOrigin = "";
  let resizeHeight = 3000;
  const dir = mkdtempSync(join(tmpdir(), "fk-qabrowser-"));
  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? "/";
      if (url === "/" || url === "/ok/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html(origin, extraOrigin)); return; }
      if (url === "/ok.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG); return; }
      if (url === "/resize/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><html><body><div style="height:${resizeHeight}px">x</div></body></html>`); return; }
      res.writeHead(404, { "content-type": "text/plain" }); res.end("nope");
    });
    // A second origin (different port) so a cross-origin resource failure (e.g. a broken third-party
    // image) is distinguishable from a same-origin one already covered by failedRequests.
    extraServer = createServer((_req, res) => { res.writeHead(404, { "content-type": "text/plain" }); res.end("nope"); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => extraServer.listen(0, "127.0.0.1", r));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    extraOrigin = `http://127.0.0.1:${(extraServer.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => extraServer.close(() => r()));
  });

  it("checkLinks reuses the cache across calls", async () => {
    const cache: LinkCache = new Map();
    const a = await checkLinks([`${origin}/dead`, `${origin}/ok/`], cache);
    expect(a).toEqual([{ href: `${origin}/dead`, status: 404 }]);
    expect(cache.size).toBe(2);
    const b = await checkLinks([`${origin}/dead`], cache);
    expect(b).toEqual([{ href: `${origin}/dead`, status: 404 }]);
    expect(cache.size).toBe(2);
  }, 30_000);

  it("collects every check field and writes the screenshots", async () => {
    const browser = await launchBrowser();
    try {
      const targets = { desktop: join(dir, "p.desktop.png"), mobile: join(dir, "p.mobile.png"), tile: (v: "desktop" | "mobile", n: number) => join(dir, `p.${v}.${n}.png`) };
      const { check, tiles } = await checkPage(browser, `${origin}/`, targets, new Map());
      expect(check.url).toBe(`${origin}/`);
      expect(check.status).toBe(200);
      // "boom" is the page's own console.error; Chromium's own "Failed to load resource" line for the
      // same-origin /missing.png is suppressed (already in failedRequests), but the one for the
      // cross-origin ext.png survives — it has no other record.
      expect(check.consoleErrors).toContain("boom");
      const resourceErrors = check.consoleErrors.filter((m) => m.startsWith("Failed to load resource:"));
      expect(resourceErrors).toHaveLength(1);
      expect(check.consoleErrors).toHaveLength(2);
      expect(check.pageErrors.join(" ")).toContain("crash");
      expect(check.failedRequests).toEqual([{ url: `${origin}/missing.png`, status: 404 }]);
      expect(check.brokenLinks).toEqual([{ href: `${origin}/dead`, status: 404 }]);
      expect(check.brokenImages).toEqual([`${origin}/missing.png`, `${extraOrigin}/ext.png`]);
      expect(check.missingAlt).toBe(1);
      expect(check.unstyledBlocks).toEqual(["gb-text-missing"]);
      expect(check.h1Count).toBe(2);
      expect(check.untranslated).toEqual(["by", "Read more"]);
      expect(check.mobileOverflow).toBe(true);
      expect(check.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(tiles.desktop).toBeGreaterThanOrEqual(1);
      expect(tiles.mobile).toBeGreaterThanOrEqual(1);
      for (const f of [targets.desktop, targets.mobile, targets.tile("desktop", 1), targets.tile("mobile", 1)]) expect(existsSync(f), f).toBe(true);
    } finally { await browser.close(); }
  }, 60_000);

  it("drops stale tiles left over from a taller previous run", async () => {
    const browser = await launchBrowser();
    try {
      const targets = { desktop: join(dir, "resize.desktop.png"), mobile: join(dir, "resize.mobile.png"), tile: (v: "desktop" | "mobile", n: number) => join(dir, `resize.${v}.${n}.png`) };
      resizeHeight = 3000;
      const first = await checkPage(browser, `${origin}/resize/`, targets, new Map());
      expect(first.tiles.desktop).toBeGreaterThan(1);
      const staleTile = targets.tile("desktop", first.tiles.desktop);
      expect(existsSync(staleTile)).toBe(true);
      resizeHeight = 300;
      const second = await checkPage(browser, `${origin}/resize/`, targets, new Map());
      expect(second.tiles.desktop).toBeLessThan(first.tiles.desktop);
      expect(existsSync(staleTile)).toBe(false);
      expect(existsSync(targets.tile("desktop", second.tiles.desktop))).toBe(true);
    } finally { await browser.close(); resizeHeight = 3000; }
  }, 60_000);
});
