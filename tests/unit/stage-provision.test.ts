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
  };
}

describe("provision stage orchestration", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("skips spec/tokens steps when the artifacts are missing (demo site)", async () => {
    const m = mockInfra();
    const msg = await provisionStage.run(await ctx());
    expect(m.core.mock.calls[0][1]).toEqual({ title: "boul" });
    expect(m.pages).not.toHaveBeenCalled(); expect(m.tokens).not.toHaveBeenCalled(); expect(m.footer).not.toHaveBeenCalled();
    expect(msg).toMatch(/no site-spec.json/); expect(msg).toMatch(/no design-tokens.json/);
  });
  it("applies identity, pages, menus, tokens and footer in order when both artifacts exist", async () => {
    const m = mockInfra();
    const order: string[] = [];
    m.core.mockImplementation(async () => { order.push("core"); return { freshInstall: false }; });
    m.identity.mockImplementation(async () => { order.push("identity"); });
    m.pages.mockImplementation(async () => { order.push("pages"); return { accueil: 1 }; });
    m.menus.mockImplementation(async () => { order.push("menus"); });
    m.tokens.mockImplementation(async () => { order.push("tokens"); });
    m.footer.mockImplementation(async () => { order.push("footer"); return 42; });
    const msg = await provisionStage.run(await ctx({ spec: true, tokens: true }));
    expect(order).toEqual(["core", "identity", "pages", "menus", "tokens", "footer"]);
    expect(m.core.mock.calls[0][1]).toEqual({ title: "Maison Rivet" });
    expect(msg).toMatch(/1 page/); expect(msg).toMatch(/tokens applied/); expect(msg).toMatch(/footer element #42/);
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
    expect(msg).toMatch(/footer skipped: gp-premium zip missing/);
  });
});
