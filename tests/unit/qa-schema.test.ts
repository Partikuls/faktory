import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import {
  QA_DIR, QA_REPORT_JSON, QA_REPORT_MD, MAX_FIX_ROUNDS, MAX_TILES, VIEWPORTS, checkRel, screenshotRel,
  parsePageCheck, hasHardFailure, checkIssues, parseQaVerdict, validateVerdict, assertVerdict,
  parseQaReport, readQaReport, computeTotals, finalVerdict, remainingIssues, hashTree, treeHash, type PageCheck,
} from "../../src/schemas/qa.js";

const check = (): PageCheck => JSON.parse(readFileSync("fixtures/qa/contact.check.json", "utf8"));
const report = () => JSON.parse(readFileSync("fixtures/qa/report.json", "utf8"));

async function ctx() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-qaschema-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}

describe("qa paths and constants", () => {
  it("names the qa dir, the reports, the viewports and the caps", () => {
    expect(QA_DIR).toBe("qa");
    expect(QA_REPORT_JSON).toBe("qa/report.json");
    expect(QA_REPORT_MD).toBe("qa/QA-REPORT.md");
    expect(MAX_FIX_ROUNDS).toBe(2);
    expect(MAX_TILES).toBe(12);
    expect(VIEWPORTS).toEqual({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } });
    expect(checkRel("contact")).toBe("qa/contact.check.json");
    expect(screenshotRel("contact", "desktop")).toBe("qa/contact.desktop.png");
    expect(screenshotRel("contact", "mobile", 3)).toBe("qa/contact.mobile.3.png");
  });
});

describe("page check", () => {
  it("parses the fixture, has no hard failure and no issue", () => {
    const c = parsePageCheck(check());
    expect(hasHardFailure(c)).toBe(false);
    expect(checkIssues(c)).toEqual([]);
  });
  it("rejects unknown keys and bad shapes", () => {
    expect(() => parsePageCheck({ ...check(), extra: 1 })).toThrow(/Invalid page check/);
    expect(() => parsePageCheck({ ...check(), status: "200" })).toThrow(/Invalid page check/);
  });
  it("lists one readable issue per failing check, in a stable order", () => {
    const c: PageCheck = {
      ...check(), status: 500, consoleErrors: ["Uncaught TypeError: x is not a function", "b", "c", "d"], pageErrors: ["ReferenceError: y"],
      failedRequests: [{ url: "http://localhost:8101/wp-content/x.css", status: 404 }], brokenLinks: [{ href: "http://localhost:8101/dead/", status: 404 }],
      brokenImages: ["http://localhost:8101/img.png"], missingAlt: 2, unstyledBlocks: ["gb-element-abc", "gb-text-def"], h1Count: 2, mobileOverflow: true,
      untranslated: ["by", "Read more"],
    };
    expect(hasHardFailure(c)).toBe(true);
    expect(checkIssues(c)).toEqual([
      "statut HTTP 500",
      "4 erreur(s) console : Uncaught TypeError: x is not a function ; b ; c …",
      "1 exception(s) JavaScript : ReferenceError: y",
      "1 requête(s) en échec : http://localhost:8101/wp-content/x.css → 404",
      "1 lien(s) cassé(s) : http://localhost:8101/dead/ → 404",
      "1 image(s) cassée(s) : http://localhost:8101/img.png",
      "2 image(s) sans alt",
      "2 bloc(s) GenerateBlocks sans CSS : gb-element-abc, gb-text-def",
      "2 h1 (attendu : 1)",
      "débordement horizontal en mobile",
      "textes anglais non traduits : by, Read more",
    ]);
  });
  it("accepts a stored check without untranslated (earlier runs) and defaults it to []", () => {
    const { untranslated: _u, ...old } = check();
    expect(parsePageCheck(old).untranslated).toEqual([]);
  });
  it("accepts a stored check without formSubmissions and defaults it to []", () => {
    const { formSubmissions: _f, ...old } = check();
    expect(parsePageCheck(old).formSubmissions).toEqual([]);
  });
  it("lists a failed form submission as an automated issue", () => {
    const c = { ...check(), formSubmissions: [
      { formId: "contact", gfId: 2, url: "http://localhost:8101/contact/", ok: true, checkedAt: "2026-09-14T00:00:00.000Z" },
      { formId: "devis_evenement", gfId: 1, url: "http://localhost:8101/commandes-evenements/", ok: false, error: "aucune entrée créée", checkedAt: "2026-09-14T00:00:00.000Z" },
    ] };
    expect(checkIssues(parsePageCheck(c))).toContain("formulaire devis_evenement (#1) : aucune entrée créée");
    expect(checkIssues(parsePageCheck(c)).filter((l) => l.startsWith("formulaire"))).toHaveLength(1);
  });
});

describe("agent verdict", () => {
  const fixed = { verdict: "fixed", summary: "ok", issues: [{ severity: "minor", where: "hero", what: "x", action: "fixed" }] };
  it("parses a verdict and rejects a bad one", () => {
    expect(parseQaVerdict(fixed).verdict).toBe("fixed");
    expect(() => parseQaVerdict({ verdict: "maybe", summary: "", issues: [] })).toThrow(/Invalid qa verdict/);
    expect(() => parseQaVerdict({ verdict: "ok", summary: "x".repeat(301), issues: [] })).toThrow(/Invalid qa verdict/);
  });
  it("enforces the consistency rules between verdict, actions and tree change", () => {
    expect(validateVerdict(parseQaVerdict(fixed), true)).toEqual([]);
    expect(validateVerdict(parseQaVerdict({ verdict: "ok", summary: "rien", issues: [] }), false)).toEqual([]);
    expect(validateVerdict(parseQaVerdict({ verdict: "needs_human", summary: "x", issues: [{ severity: "major", where: "a", what: "b", action: "left" }] }), false)).toEqual([]);
    expect(validateVerdict(parseQaVerdict({ verdict: "fixed", summary: "x", issues: [] }), true)).toEqual(['verdict "fixed" requires at least one issue with action "fixed"']);
    expect(validateVerdict(parseQaVerdict(fixed), false)).toEqual(['verdict "fixed" but pages/<slug>.gb.json did not change — write the corrected tree, or answer "ok" / "needs_human"']);
    expect(validateVerdict(parseQaVerdict({ verdict: "ok", summary: "x", issues: [{ severity: "minor", where: "a", what: "b", action: "left" }] }), false)).toEqual(['verdict "ok" but some issues are "left" — answer "needs_human"']);
    expect(validateVerdict(parseQaVerdict({ verdict: "needs_human", summary: "x", issues: [] }), false)).toEqual(['verdict "needs_human" requires at least one issue with action "left"']);
    expect(validateVerdict(parseQaVerdict({ verdict: "ok", summary: "x", issues: [] }), true)).toEqual(['verdict "ok" but the tree changed — answer "fixed"']);
    expect(() => assertVerdict(parseQaVerdict(fixed), false)).toThrow(/qa verdict is inconsistent:\n- verdict "fixed" but/);
  });
});

describe("report", () => {
  it("parses the fixture report and computes totals", () => {
    const r = parseQaReport(report());
    expect(r.pages).toHaveLength(2);
    expect(computeTotals(r.pages)).toEqual({ urls: 2, reviewed: 1, ok: 0, fixed: 1, needsHuman: 0, remainingIssues: 0 });
    expect(remainingIssues(r.pages[0])).toBe(0);
  });
  it("finalVerdict follows the issues", () => {
    expect(finalVerdict([])).toBe("ok");
    expect(finalVerdict([{ severity: "minor", where: "a", what: "b", action: "fixed" }])).toBe("fixed");
    expect(finalVerdict([{ severity: "minor", where: "a", what: "b", action: "fixed" }, { severity: "major", where: "c", what: "d", action: "left" }])).toBe("needs_human");
  });
  it("readQaReport returns undefined without a file and a clear error on a bad one", async () => {
    const c = await ctx();
    expect(readQaReport(c)).toBeUndefined();
    writeFileSync(join(c.siteDir, QA_REPORT_JSON), "{ nope");
    expect(() => readQaReport(c)).toThrow(/qa\/report.json is not valid JSON.*delete it/);
    writeFileSync(join(c.siteDir, QA_REPORT_JSON), JSON.stringify({ ...report(), totals: undefined }));
    expect(() => readQaReport(c)).toThrow(/qa\/report.json: Invalid qa report.*delete it/);
    writeFileSync(join(c.siteDir, QA_REPORT_JSON), JSON.stringify(report()));
    expect(readQaReport(c)?.pages[0].slug).toBe("contact");
  });
});

describe("tree hash", () => {
  it("hashes the file content, stable and prefixed", async () => {
    expect(hashTree("[]")).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashTree("[]")).toBe(hashTree("[]"));
    expect(hashTree("[] ")).not.toBe(hashTree("[]"));
    const c = await ctx();
    expect(treeHash(c, "accueil")).toBeUndefined();
    mkdirSync(join(c.siteDir, "pages"), { recursive: true });
    writeFileSync(join(c.siteDir, "pages/accueil.gb.json"), "[]");
    expect(treeHash(c, "accueil")).toBe(hashTree("[]"));
  });
});
