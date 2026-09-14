import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { parseQaReport, qaReportJsonPath, qaReportMdPath } from "../../src/schemas/qa.js";
import { renderQaReport, writeQaReport } from "../../src/qa/report.js";

const report = () => parseQaReport(JSON.parse(readFileSync("fixtures/qa/report.json", "utf8")));

describe("renderQaReport", () => {
  it("renders the summary, one section per url, the checks table, the issues and the screenshot links", () => {
    const md = renderQaReport(report(), "Maison Rivet");
    expect(md.startsWith("# Rapport QA — Maison Rivet\n")).toBe(true);
    expect(md).toContain("2026-09-13");
    expect(md).toContain("2 URL contrôlées, 1 page relue (0 ok, 1 corrigée, 0 à revoir), 0 défaut restant — $1.23");
    expect(md).toContain("## /contact/ — corrigée");
    expect(md).toContain("| Statut HTTP | 200 |");
    expect(md).toContain("| Erreurs console | 0 |");
    expect(md).toContain("| Blocs GenerateBlocks sans CSS | 0 |");
    expect(md).toContain("| Textes non traduits | 0 |");
    expect(md).toContain("| Débordement mobile | non |");
    expect(md).toContain("Tours : 1");
    expect(md).toContain("- [corrigé] (mineur) section form — bouton sans focus-visible");
    expect(md).toContain("Captures : [desktop](contact.desktop.png) · [mobile](contact.mobile.png)");
    expect(md).toContain("## /actualites/ — contrôle seul");
    expect(md).toContain("Bouton du formulaire sans état focus, corrigé.");
  });
  it("marks a page with remaining issues and lists the automated defects", () => {
    const r = report();
    r.pages[0].verdict = "needs_human";
    r.pages[0].issues = [{ severity: "major", where: "section hero", what: "titre illisible", action: "left" }];
    r.pages[0].check = { ...r.pages[0].check, h1Count: 2 };
    r.totals = { ...r.totals, fixed: 0, needsHuman: 1, remainingIssues: 1 };
    const md = renderQaReport(r, "X");
    expect(md).toContain("## /contact/ — à revoir");
    expect(md).toContain("- [restant] (majeur) section hero — titre illisible");
    expect(md).toContain("Défauts automatiques : 2 h1 (attendu : 1)");
    expect(md).toContain("1 défaut restant");
    expect(md).toContain("(0 ok, 0 corrigée, 1 à revoir), 1 défaut restant");
  });
  it("adds the partial-report line right after the summary, listing the failed urls", () => {
    const r = report();
    r.partial = true;
    r.failedUrls = ["http://localhost:8101/la-maison/", "http://localhost:8101/actualites/"];
    const md = renderQaReport(r, "Maison Rivet");
    expect(md).toContain("Rapport partiel : 2 URL(s) en échec — http://localhost:8101/la-maison/, http://localhost:8101/actualites/");
    expect(md.indexOf("Rapport partiel")).toBeGreaterThan(md.indexOf("$1.23"));
    expect(md.indexOf("Rapport partiel")).toBeLessThan(md.indexOf("## /contact/"));
  });
  it("adds the submitted forms row only on pages that carry a tested form", () => {
    const r = report();
    r.pages[0].check = { ...r.pages[0].check, formSubmissions: [
      { formId: "contact", gfId: 2, url: r.pages[0].url, ok: false, error: "pas de confirmation (« Ce champ est obligatoire. »)", checkedAt: "2026-09-14T00:00:00.000Z" },
    ] };
    const md = renderQaReport(r, "X");
    expect(md).toContain("| Formulaires soumis | 0/1 |");
    expect(md).toContain("formulaire contact (#2) : pas de confirmation (« Ce champ est obligatoire. »)");
    expect(md.match(/Formulaires soumis/g)).toHaveLength(1);
  });
  it("writeQaReport writes both files", async () => {
    const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-qareport-")));
    await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
    const c = loadContext(config, "boul");
    writeQaReport(c, report(), "Maison Rivet");
    expect(existsSync(qaReportMdPath(c))).toBe(true);
    expect(parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8"))).pages).toHaveLength(2);
  });
});
