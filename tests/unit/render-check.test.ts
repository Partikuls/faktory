import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import type { SiteContext } from "../../src/docker.js";
import { deps, decodeEntities, pageTitle, assertContains, assertTitle, assertRendered, assertFormRendered, formNeedle } from "../../src/pages/render-check.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };
const contact = spec.sitemap.find((p) => p.slug === "contact")!;

describe("decodeEntities / pageTitle", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("Pains &amp; viennoiseries &#8211; L&#039;atelier &quot;Rivet&quot; &lt;3 &#x27;ok&#x27;")).toBe("Pains & viennoiseries – L'atelier \"Rivet\" <3 'ok'");
  });
  it("extracts the first <title>, decoded and trimmed", () => {
    expect(pageTitle("<html><head>\n<title>\n  Contact &amp; horaires - Maison Rivet </title></head><title>second</title>")).toBe("Contact & horaires - Maison Rivet");
    expect(pageTitle("<html><head></head></html>")).toBeUndefined();
  });
});

describe("assertContains / assertTitle", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("returns the html when the needle is present, throws with the hint otherwise", async () => {
    vi.spyOn(deps, "fetchText").mockResolvedValue("<html>needle</html>");
    await expect(assertContains(ctx, "http://localhost:8100/x/", "needle", "check X")).resolves.toBe("<html>needle</html>");
    await expect(assertContains(ctx, "http://localhost:8100/x/", "absent", "check X")).rejects.toThrow(/http:\/\/localhost:8100\/x\/ does not contain "absent" — check X/);
  });
  it("assertTitle compares the decoded <title> with the expected string", async () => {
    vi.spyOn(deps, "fetchText").mockResolvedValue("<title>Contact &amp; horaires</title>");
    await expect(assertTitle(ctx, "http://localhost:8100/contact/", "Contact & horaires")).resolves.toBeUndefined();
    await expect(assertTitle(ctx, "http://localhost:8100/contact/", "Autre")).rejects.toThrow(/http:\/\/localhost:8100\/contact\/ has title "Contact & horaires", expected "Autre"/);
  });
  it("propagates fetch errors", async () => {
    vi.spyOn(deps, "fetchText").mockRejectedValue(new Error("GET http://localhost:8100/x/ → 404"));
    await expect(assertContains(ctx, "http://localhost:8100/x/", "n", "h")).rejects.toThrow(/→ 404/);
  });
});

describe("assertRendered / assertFormRendered", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("assertRendered keeps its message and URL mapping", async () => {
    const f = vi.spyOn(deps, "fetchText").mockResolvedValue("<div></div>");
    await expect(assertRendered(ctx, contact, "catalogue_produits")).rejects.toThrow(/\/contact\/ \(contact\) does not render data-faktory-plugin="catalogue_produits" — check the render function and that the block is registered/);
    expect(f).toHaveBeenCalledWith("http://localhost:8100/contact/");
  });
  it("assertFormRendered requires gform_wrapper_<gfId> on the page", async () => {
    expect(formNeedle(7)).toBe("gform_wrapper_7");
    vi.spyOn(deps, "fetchText").mockResolvedValue('<div class="gform_wrapper gravity-theme" id="gform_wrapper_7">');
    await expect(assertFormRendered(ctx, contact, 7)).resolves.toBeUndefined();
    await expect(assertFormRendered(ctx, contact, 8)).rejects.toThrow(/\/contact\/ \(contact\) does not render gform_wrapper_8 — check that Gravity Forms is active and form #8 exists/);
  });
});
