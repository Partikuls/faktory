import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { pageTreePath } from "../../src/artifacts.js";
import { parseSiteSpec, type Page } from "../../src/schemas/site-spec.js";
import { featureMarker, formMarker, FORM_WRAPPER_ATTR } from "../../src/schemas/page-tree.js";
import { pagesUserPrompt, readPageTree, generatePageTree, deps, PAGES_TOOLS, PAGES_MAX_TURNS, PAGES_WRITE_ROOTS } from "../../src/pages/generate.js";
import { TOOL_GB_BUILD, TOOL_GB_PREVIEW } from "../../src/tools/server.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const home = spec.sitemap.find((p) => p.kind === "home")!;
const contact = spec.sitemap.find((p) => p.kind === "contact")!;

async function ctx() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-pages-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}
const fixtureTo = (c: ReturnType<typeof loadContext>, slug: string) => { mkdirSync(join(c.siteDir, "pages"), { recursive: true }); copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, slug)); };

describe("pagesUserPrompt", () => {
  it("describes the page, its sections, the required markers and the files to read", () => {
    const p = pagesUserPrompt(spec, home);
    expect(p).toContain("`accueil`");
    expect(p).toContain("[home]");
    expect(p).toContain("1. **hero** « Le pain comme en 1987, le levain comme toujours »");
    expect(p).toContain(featureMarker("catalogue_produits"));
    expect(p).toContain("Catalogue produits");
    expect(p).toContain("Mardi – Vendredi : 7h00 – 19h30");
    expect(p).toContain("`pages/accueil.gb.json`");
    expect(p).not.toContain("et `pages/accueil.gb.json`");
  });
  it("mentions the marker obligatoire and its wrapper attribute for a custom-query section", () => {
    const p = pagesUserPrompt(spec, home);
    expect(p).toMatch(/marqueur obligatoire.*catalogue_produits/);
    expect(p).toContain('data-faktory-feature="catalogue_produits"');
  });
  it("points non-home pages at the home tree and lists the forms", () => {
    const p = pagesUserPrompt(spec, contact, { homeSlug: "accueil" });
    expect(p).toContain("et `pages/accueil.gb.json`");
    expect(p).toContain("`pages/contact.gb.json`");
    expect(p).toContain(formMarker("contact"));
    expect(p).toMatch(/Nom\*|nom\*/);
    expect(p).toMatch(/marqueur obligatoire.*contact/);
    expect(p).toContain('data-faktory-form="contact"');
  });
  it("only calls a marker obligatoire when requiredMarkers actually requires it", () => {
    const homeCopy: Page = JSON.parse(JSON.stringify(home));
    const customSection = homeCopy.sections.find((s) => s.type === "custom-query")!;
    customSection.type = "text"; // s.feature is still set, but this section no longer requires a marker
    const p = pagesUserPrompt(spec, homeCopy);
    expect(p).not.toMatch(/marqueur obligatoire/);
  });
});

describe("readPageTree", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("reads and validates an existing tree", async () => {
    const c = await ctx(); fixtureTo(c, "accueil");
    expect(readPageTree(c, home)).toHaveLength(5);
  });
  it("explains a missing file, invalid JSON and an invalid tree", async () => {
    const c = await ctx();
    expect(() => readPageTree(c, home)).toThrow(/pages\/accueil.gb.json was not written/);
    mkdirSync(join(c.siteDir, "pages"), { recursive: true });
    writeFileSync(pageTreePath(c, "accueil"), "{ nope");
    expect(() => readPageTree(c, home)).toThrow(/not valid JSON/);
    fixtureTo(c, "contact");
    expect(() => readPageTree(c, contact)).toThrow(/faktory:form:contact/);
  });
});

describe("generatePageTree", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("runs the pages agent with Read/Write/gb tools and returns the validated tree", async () => {
    const c = await ctx();
    const run = vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { fixtureTo(cc, "accueil"); return { text: "ok", transcript: "ok", costUsd: 1.2, sessionId: "p-1", numTurns: 12 }; });
    const r = await generatePageTree(c, spec, home);
    expect(r.tree).toHaveLength(5);
    expect(r).toMatchObject({ costUsd: 1.2, attempts: 1 });
    const call = run.mock.calls[0][1];
    expect(call.stage).toBe("pages");
    expect(call.allowedTools).toEqual(PAGES_TOOLS);
    expect(PAGES_TOOLS).toEqual(["Read", "Write", TOOL_GB_BUILD, TOOL_GB_PREVIEW]);
    expect(call.writeRoots).toEqual(["pages"]);
    expect(PAGES_WRITE_ROOTS).toEqual(["pages"]);
    expect(call.maxTurns).toBe(PAGES_MAX_TURNS);
    expect(call.outputFormat).toBeUndefined();
    expect(call.systemPrompt).toContain("Tu es l'intégrateur GenerateBlocks");
    expect(call.prompt).toContain("`accueil`");
  });
  it("retries once with the validation issues when the tree is invalid, then succeeds", async () => {
    const c = await ctx();
    const run = vi.spyOn(deps, "runAgent")
      .mockImplementationOnce(async (cc) => { fixtureTo(cc, "contact"); return { text: "", transcript: "", costUsd: 1, sessionId: "p-2", numTurns: 10 }; })
      .mockImplementationOnce(async (cc) => {
        const t = JSON.parse(readFileSync(pageTreePath(cc, "contact"), "utf8"));
        t[1].innerBlocks[0].innerBlocks.push({
          type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: "contact" },
          innerBlocks: [{ type: "raw", rawMarkup: formMarker("contact") }],
        });
        writeFileSync(pageTreePath(cc, "contact"), JSON.stringify(t));
        return { text: "", transcript: "", costUsd: 0.3, sessionId: "p-2", numTurns: 4 };
      });
    const r = await generatePageTree(c, spec, contact, { homeSlug: "accueil" });
    expect(r).toMatchObject({ costUsd: 1.3, attempts: 2 });
    expect(run.mock.calls[1][1].resume).toBe("p-2");
    expect(run.mock.calls[1][1].prompt).toContain("faktory:form:contact");
  });
  it("fails after the retry when the agent never writes the file", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockResolvedValue({ text: "", transcript: "", costUsd: 0.5, sessionId: "p-3", numTurns: 2 });
    await expect(generatePageTree(c, spec, home)).rejects.toThrow(/pages: output still invalid after one retry — pages\/accueil.gb.json was not written/);
  });
  it("deletes pages/<slug>.gb.json and says so when the retry also fails validation on an invalid (not just missing) tree", async () => {
    const c = await ctx();
    const invalidTree = [{ type: "element", tagName: "section", innerBlocks: [{ type: "text", tagName: "h2", content: "no h1 here" }] }];
    vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => {
      mkdirSync(join(cc.siteDir, "pages"), { recursive: true });
      writeFileSync(pageTreePath(cc, "accueil"), JSON.stringify(invalidTree));
      return { text: "", transcript: "", costUsd: 0.4, sessionId: "p-4", numTurns: 3 };
    });
    await expect(generatePageTree(c, spec, home)).rejects.toThrow(/pages\/accueil\.gb\.json deleted, the next run regenerates it/);
    expect(existsSync(pageTreePath(c, "accueil"))).toBe(false);
  });
});
