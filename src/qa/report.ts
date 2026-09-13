import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SiteContext } from "../docker.js";
import { checkIssues, qaReportJsonPath, qaReportMdPath, QA_DIR, type QaPage, type QaReport } from "../schemas/qa.js";

const VERDICT_FR: Record<NonNullable<QaPage["verdict"]>, string> = { ok: "ok", fixed: "corrigée", needs_human: "à revoir" };
const yesNo = (b: boolean): string => (b ? "oui" : "non");
const rel = (p: string): string => p.startsWith(`${QA_DIR}/`) ? p.slice(QA_DIR.length + 1) : p;
// French: zero takes the singular ("0 défaut restant")
const plural = (n: number, s: string, p: string): string => `${n} ${n > 1 ? p : s}`;

function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

function pageSection(p: QaPage): string {
  const c = p.check;
  const heading = p.reviewed && p.verdict ? VERDICT_FR[p.verdict] : "contrôle seul";
  const lines = [
    `## ${pathOf(p.url)} — ${heading}${p.reused ? " (réutilisé)" : ""}`,
    "",
    "| Contrôle | Résultat |",
    "|---|---|",
    `| Statut HTTP | ${c.status} |`,
    `| Erreurs console | ${c.consoleErrors.length} |`,
    `| Exceptions JavaScript | ${c.pageErrors.length} |`,
    `| Requêtes en échec | ${c.failedRequests.length} |`,
    `| Liens cassés | ${c.brokenLinks.length} |`,
    `| Images cassées | ${c.brokenImages.length} |`,
    `| Images sans alt | ${c.missingAlt} |`,
    `| Blocs GenerateBlocks sans CSS | ${c.unstyledBlocks.length} |`,
    `| h1 | ${c.h1Count} |`,
    `| Débordement mobile | ${yesNo(c.mobileOverflow)} |`,
    "",
  ];
  const auto = checkIssues(c);
  if (auto.length) lines.push(`Défauts automatiques : ${auto.join(" ; ")}`, "");
  if (p.reviewed) {
    lines.push(`Tours : ${p.rounds}${p.costUsd ? ` — $${p.costUsd.toFixed(2)}` : ""}`, "");
    if (p.summary) lines.push(p.summary, "");
    if (p.issues.length) {
      for (const i of p.issues) lines.push(`- [${i.action === "fixed" ? "corrigé" : "restant"}] (${i.severity === "major" ? "majeur" : "mineur"}) ${i.where} — ${i.what}`);
      lines.push("");
    }
  }
  lines.push(`Captures : [desktop](${rel(p.screenshots.desktop)}) · [mobile](${rel(p.screenshots.mobile)})`, "");
  return lines.join("\n");
}

/** Human report (spec « Verdict de l'agent et rapport »): French, one section per URL in report order, links relative to `qa/`. */
export function renderQaReport(report: QaReport, siteName: string): string {
  const t = report.totals;
  const summary = `${plural(t.urls, "URL contrôlée", "URL contrôlées")}, ${plural(t.reviewed, "page relue", "pages relues")} (${t.ok} ok, ${plural(t.fixed, "corrigée", "corrigées")}, ${t.needsHuman} à revoir), ${plural(t.remainingIssues, "défaut restant", "défauts restants")} — $${report.costUsd.toFixed(2)}`;
  return [
    `# Rapport QA — ${siteName}`,
    "",
    `Généré le ${report.generatedAt.slice(0, 10)} sur ${report.siteUrl}.`,
    "",
    summary,
    ...(report.partial ? [`Rapport partiel : ${report.failedUrls.length} URL(s) en échec — ${report.failedUrls.join(", ")}`] : []),
    "",
    ...report.pages.map(pageSection),
  ].join("\n");
}

export function writeQaReport(ctx: SiteContext, report: QaReport, siteName: string): void {
  const json = qaReportJsonPath(ctx), md = qaReportMdPath(ctx);
  mkdirSync(dirname(json), { recursive: true });
  writeFileSync(json, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(md, renderQaReport(report, siteName));
}
