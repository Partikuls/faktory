import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { applyPageSeo, deps, YOAST_META } from "../../src/content/seo.js";
import { deps as renderDeps } from "../../src/pages/render-check.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "boul", siteDir: "/tmp/fk/sites/boul", state: createState("boul", 8100, "pw") };
const IDS: Record<string, number> = { accueil: 10, "nos-produits": 11, "commandes-evenements": 12, "la-maison": 13, actualites: 14, contact: 15 };
const esc = (s: string) => s.replace(/&/g, "&amp;");

describe("applyPageSeo", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("sets the three Yoast meta of every page (blog page included) and verifies the rendered title", async () => {
    const wpOk = vi.spyOn(deps, "wpOk").mockResolvedValue("Success");
    const fetchText = vi.spyOn(renderDeps, "fetchText").mockImplementation(async (url) => {
      const page = spec.sitemap.find((p) => (p.kind === "home" ? url.endsWith(":8100/") : url.endsWith(`/${p.slug}/`)))!;
      return `<html><head><title>${esc(page.seo.title)}</title></head></html>`;
    });
    const done = await applyPageSeo(ctx, spec, IDS);
    expect(done).toEqual(spec.sitemap.map((p) => p.slug));
    expect(wpOk).toHaveBeenCalledTimes(spec.sitemap.length * 3);
    const contact = spec.sitemap.find((p) => p.slug === "contact")!;
    expect(wpOk).toHaveBeenCalledWith(ctx, ["post", "meta", "update", "15", YOAST_META.title, contact.seo.title]);
    expect(wpOk).toHaveBeenCalledWith(ctx, ["post", "meta", "update", "15", YOAST_META.metadesc, contact.seo.metaDescription]);
    expect(wpOk).toHaveBeenCalledWith(ctx, ["post", "meta", "update", "15", YOAST_META.focuskw, contact.seo.keywords[0]]);
    expect(fetchText).toHaveBeenCalledWith("http://localhost:8100/");
    expect(fetchText).toHaveBeenCalledWith("http://localhost:8100/actualites/");
  });
  it("fails when the rendered title differs (Yoast inactive or meta ignored)", async () => {
    vi.spyOn(deps, "wpOk").mockResolvedValue("Success");
    vi.spyOn(renderDeps, "fetchText").mockResolvedValue("<title>Maison Rivet</title>");
    await expect(applyPageSeo(ctx, spec, IDS)).rejects.toThrow(/http:\/\/localhost:8100\/ has title "Maison Rivet", expected ".*" — check that wordpress-seo is active/);
  });
  it("fails on a sitemap page without a WordPress id", async () => {
    vi.spyOn(deps, "wpOk").mockResolvedValue("Success");
    vi.spyOn(renderDeps, "fetchText").mockImplementation(async (url) => {
      const page = spec.sitemap.find((p) => (p.kind === "home" ? url.endsWith(":8100/") : url.endsWith(`/${p.slug}/`)))!;
      return `<html><head><title>${esc(page.seo.title)}</title></head></html>`;
    });
    await expect(applyPageSeo(ctx, spec, { accueil: 10 })).rejects.toThrow(/no WordPress page for slug "nos-produits" — run the provision stage first/);
  });
});
