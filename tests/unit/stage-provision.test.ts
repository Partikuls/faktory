import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { writeJsonArtifact } from "../../src/artifacts.js";
import { provisionStage, deps } from "../../src/stages/provision.js";

const spec = JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8"));
const tokens = JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8"));

async function ctx(opts: { spec?: boolean; tokens?: boolean } = {}) {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-prov-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  if (opts.spec) writeJsonArtifact(c, "siteSpecJson", spec);
  if (opts.tokens) writeJsonArtifact(c, "designTokensJson", tokens);
  return c;
}
function mockInfra() {
  vi.spyOn(deps, "composeUp").mockResolvedValue({ stdout: "", stderr: "", code: 0 });
  vi.spyOn(deps, "waitForDb").mockResolvedValue(undefined);
  const core = vi.spyOn(deps, "installCore").mockResolvedValue({ freshInstall: true });
  const stack = vi.spyOn(deps, "installStack").mockResolvedValue({ installed: ["generatepress"], missingVendor: [] });
  return {
    core,
    stack,
    identity: vi.spyOn(deps, "applyIdentity").mockResolvedValue(undefined),
    pages: vi.spyOn(deps, "ensurePages").mockResolvedValue({ accueil: 1, "nos-produits": 2, "commandes-evenements": 3, "la-maison": 4, actualites: 5, contact: 6 }),
    menus: vi.spyOn(deps, "ensureMenus").mockResolvedValue(undefined),
    tokens: vi.spyOn(deps, "applyTokens").mockResolvedValue(undefined),
    footer: vi.spyOn(deps, "installFooter").mockResolvedValue(42),
    languages: vi.spyOn(deps, "installLanguagePacks").mockResolvedValue([]),
    childTheme: vi.spyOn(deps, "installChildTheme").mockResolvedValue(undefined),
    blog: vi.spyOn(deps, "installBlog").mockResolvedValue([51, 52, 53]),
  };
}

describe("provision stage orchestration", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("skips spec/tokens steps when the artifacts are missing (demo site)", async () => {
    const m = mockInfra();
    const msg = await provisionStage.run(await ctx());
    expect(m.core.mock.calls[0][1]).toEqual({ title: "boul" });
    expect(m.pages).not.toHaveBeenCalled(); expect(m.tokens).not.toHaveBeenCalled(); expect(m.footer).not.toHaveBeenCalled();
    expect(m.childTheme).not.toHaveBeenCalled(); expect(m.blog).not.toHaveBeenCalled(); expect(m.languages).toHaveBeenCalled();
    expect(msg).toMatch(/no site-spec.json/); expect(msg).toMatch(/no design-tokens.json/);
  });
  it("runs every step in order and summarises them when both artifacts exist", async () => {
    const m = mockInfra();
    const order: string[] = [];
    m.core.mockImplementation(async () => { order.push("core"); return { freshInstall: false }; });
    m.stack.mockImplementation(async () => { order.push("stack"); return { installed: [], missingVendor: [] }; });
    m.languages.mockImplementation(async () => { order.push("languages"); return []; });
    m.identity.mockImplementation(async () => { order.push("identity"); });
    m.pages.mockImplementation(async () => { order.push("pages"); return { accueil: 1 }; });
    m.menus.mockImplementation(async () => { order.push("menus"); });
    m.tokens.mockImplementation(async () => { order.push("tokens"); });
    m.childTheme.mockImplementation(async () => { order.push("childTheme"); });
    m.footer.mockImplementation(async () => { order.push("footer"); return 42; });
    m.blog.mockImplementation(async () => { order.push("blog"); return [51, 52, 53]; });
    const msg = await provisionStage.run(await ctx({ spec: true, tokens: true }));
    expect(order).toEqual(["core", "stack", "languages", "identity", "pages", "menus", "tokens", "childTheme", "footer", "blog"]);
    expect(m.core.mock.calls[0][1]).toEqual({ title: "Maison Rivet" });
    expect(msg).toMatch(/fr_FR packs: ok; 1 page \+ primary menu; tokens applied; child theme styles; footer element #42; blog elements #51 #52 #53$/);
  });
  it("reports language pack warnings and a sitemap without blog page", async () => {
    const m = mockInfra();
    m.languages.mockResolvedValue(["language theme install generatepress fr_FR: Error: offline"]);
    m.blog.mockResolvedValue(undefined);
    const msg = await provisionStage.run(await ctx({ spec: true, tokens: true }));
    expect(msg).toContain("fr_FR packs: warn (language theme install generatepress fr_FR: Error: offline)");
    expect(msg).toContain("blog elements skipped: no blog page");
  });
  it("creates pages and menus without tokens, and skips the footer", async () => {
    const m = mockInfra();
    const msg = await provisionStage.run(await ctx({ spec: true }));
    expect(m.pages).toHaveBeenCalled(); expect(m.menus).toHaveBeenCalled();
    expect(m.tokens).not.toHaveBeenCalled(); expect(m.footer).not.toHaveBeenCalled();
    expect(msg).toMatch(/6 pages/); expect(msg).toMatch(/no design-tokens.json/);
  });
  it("skips the footer when gp-premium is missing, even with spec and tokens", async () => {
    const m = mockInfra();
    m.stack.mockResolvedValue({ installed: [], missingVendor: ["gp-premium"] });
    const msg = await provisionStage.run(await ctx({ spec: true, tokens: true }));
    expect(m.footer).not.toHaveBeenCalled();
    expect(m.blog).not.toHaveBeenCalled(); expect(m.childTheme).toHaveBeenCalled();
    expect(msg).toMatch(/footer skipped: gp-premium zip missing/);
  });
});
