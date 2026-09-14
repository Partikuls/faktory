import { z } from "zod";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SiteContext } from "../docker.js";
import { pageTreePath } from "../artifacts.js";

export const QA_DIR = "qa";
export const QA_REPORT_JSON = `${QA_DIR}/report.json`;
export const QA_REPORT_MD = `${QA_DIR}/QA-REPORT.md`;
/** Agent review + fix + republish + re-check = one round; at most this many per page (spec decision 1). */
export const MAX_FIX_ROUNDS = 2;
/** Viewport-height screenshot tiles per viewport, so the agent reads a long page at scale (spec decision 5). */
export const MAX_TILES = 12;
/** Same-origin links checked per page (spec decision 4). */
export const MAX_LINKS = 50;

export type Viewport = "desktop" | "mobile";
export const VIEWPORTS: Record<Viewport, { width: number; height: number }> = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

export const checkRel = (slug: string): string => `${QA_DIR}/${slug}.check.json`;
export const checkPath = (ctx: SiteContext, slug: string): string => join(ctx.siteDir, checkRel(slug));
export const screenshotRel = (slug: string, viewport: Viewport, tile?: number): string => `${QA_DIR}/${slug}.${viewport}${tile ? `.${tile}` : ""}.png`;
export const screenshotPath = (ctx: SiteContext, slug: string, viewport: Viewport, tile?: number): string => join(ctx.siteDir, screenshotRel(slug, viewport, tile));
export const qaReportJsonPath = (ctx: SiteContext): string => join(ctx.siteDir, QA_REPORT_JSON);
export const qaReportMdPath = (ctx: SiteContext): string => join(ctx.siteDir, QA_REPORT_MD);

const issuesOf = (e: z.ZodError): string => e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

// ---------- page check (spec « Contrôle d'une page ») ----------

/** One real submission of a Gravity Forms form by the qa stage (spec B3). */
export const FormSubmissionSchema = z.strictObject({
  formId: z.string(),
  gfId: z.number().int().positive(),
  url: z.string().url(),
  ok: z.boolean(),
  error: z.string().optional(),
  checkedAt: z.string(),
});
export type FormSubmission = z.infer<typeof FormSubmissionSchema>;

export const PageCheckSchema = z.strictObject({
  url: z.string().url(),
  status: z.number().int(),
  consoleErrors: z.array(z.string()),
  pageErrors: z.array(z.string()),
  failedRequests: z.array(z.strictObject({ url: z.string(), status: z.number().int() })),
  brokenLinks: z.array(z.strictObject({ href: z.string(), status: z.number().int() })),
  brokenImages: z.array(z.string()),
  missingAlt: z.number().int().min(0),
  unstyledBlocks: z.array(z.string()),
  h1Count: z.number().int().min(0),
  untranslated: z.array(z.string()).default([]),
  formSubmissions: z.array(FormSubmissionSchema).default([]),
  mobileOverflow: z.boolean(),
  checkedAt: z.string(),
});
export type PageCheck = z.infer<typeof PageCheckSchema>;

export function parsePageCheck(data: unknown): PageCheck {
  const r = PageCheckSchema.safeParse(data);
  if (!r.success) throw new Error(`Invalid page check: ${issuesOf(r.error)}`);
  return r.data;
}

/** A non-200 page is a broken site, not a page defect: the stage fails (spec decision 4). */
export function hasHardFailure(c: PageCheck): boolean {
  return c.status !== 200;
}

const sample = (items: string[]): string => items.slice(0, 3).join(" ; ") + (items.length > 3 ? " …" : "");

/** One readable French line per failing check, in a stable order; empty when the page is clean. */
export function checkIssues(c: PageCheck): string[] {
  const out: string[] = [];
  if (c.status !== 200) out.push(`statut HTTP ${c.status}`);
  if (c.consoleErrors.length) out.push(`${c.consoleErrors.length} erreur(s) console : ${sample(c.consoleErrors)}`);
  if (c.pageErrors.length) out.push(`${c.pageErrors.length} exception(s) JavaScript : ${sample(c.pageErrors)}`);
  if (c.failedRequests.length) out.push(`${c.failedRequests.length} requête(s) en échec : ${sample(c.failedRequests.map((r) => `${r.url} → ${r.status}`))}`);
  if (c.brokenLinks.length) out.push(`${c.brokenLinks.length} lien(s) cassé(s) : ${sample(c.brokenLinks.map((l) => `${l.href} → ${l.status}`))}`);
  if (c.brokenImages.length) out.push(`${c.brokenImages.length} image(s) cassée(s) : ${sample(c.brokenImages)}`);
  if (c.missingAlt) out.push(`${c.missingAlt} image(s) sans alt`);
  if (c.unstyledBlocks.length) out.push(`${c.unstyledBlocks.length} bloc(s) GenerateBlocks sans CSS : ${c.unstyledBlocks.join(", ")}`);
  if (c.h1Count !== 1) out.push(`${c.h1Count} h1 (attendu : 1)`);
  if (c.mobileOverflow) out.push("débordement horizontal en mobile");
  if (c.untranslated.length) out.push(`textes anglais non traduits : ${c.untranslated.join(", ")}`);
  for (const f of c.formSubmissions) if (!f.ok) out.push(`formulaire ${f.formId} (#${f.gfId}) : ${f.error ?? "échec"}`);
  return out;
}

// ---------- agent verdict (spec decision 6) ----------

export const QA_VERDICTS = ["ok", "fixed", "needs_human"] as const;
export const QaIssueSchema = z.strictObject({
  severity: z.enum(["major", "minor"]).describe("major = visible à tout visiteur (lisibilité, débordement, contenu manquant) ; minor = détail"),
  where: z.string().min(1).describe("Où : section ou élément, ex. « section hero », « bouton du CTA »"),
  what: z.string().min(1).describe("Quoi : le défaut constaté, en français, une phrase"),
  action: z.enum(["fixed", "left"]).describe("fixed = corrigé dans pages/<slug>.gb.json ; left = laissé (hors de l'arbre, ou trop risqué)"),
});
export type QaIssue = z.infer<typeof QaIssueSchema>;
export const QaVerdictShape = z.object({
  verdict: z.enum(QA_VERDICTS).describe("ok = rien à corriger ; fixed = l'arbre a été réécrit ; needs_human = au moins un défaut laissé"),
  summary: z.string().min(1).max(300).describe("Une à deux phrases en français"),
  issues: z.array(QaIssueSchema),
});
export type QaVerdict = z.infer<typeof QaVerdictShape>;

export function parseQaVerdict(data: unknown): QaVerdict {
  const r = QaVerdictShape.safeParse(data);
  if (!r.success) throw new Error(`Invalid qa verdict: ${issuesOf(r.error)}`);
  return r.data;
}

/** Rules the shape cannot express: the verdict must match the actions and whether the tree really changed. */
export function validateVerdict(v: QaVerdict, treeChanged: boolean): string[] {
  const fixed = v.issues.filter((i) => i.action === "fixed").length;
  const left = v.issues.filter((i) => i.action === "left").length;
  const out: string[] = [];
  if (v.verdict === "fixed" && !fixed) out.push('verdict "fixed" requires at least one issue with action "fixed"');
  if (v.verdict === "fixed" && !treeChanged) out.push('verdict "fixed" but pages/<slug>.gb.json did not change — write the corrected tree, or answer "ok" / "needs_human"');
  if (v.verdict === "ok" && left) out.push('verdict "ok" but some issues are "left" — answer "needs_human"');
  if (v.verdict === "needs_human" && !left) out.push('verdict "needs_human" requires at least one issue with action "left"');
  if (v.verdict !== "fixed" && treeChanged) out.push(`verdict "${v.verdict}" but the tree changed — answer "fixed"`);
  return out;
}

export function assertVerdict(v: QaVerdict, treeChanged: boolean): void {
  const issues = validateVerdict(v, treeChanged);
  if (issues.length) throw new Error(`qa verdict is inconsistent:\n- ${issues.join("\n- ")}`);
}

// ---------- report (spec « Verdict de l'agent et rapport ») ----------

export const QaPageSchema = z.strictObject({
  slug: z.string(),
  kind: z.enum(["home", "standard", "blog", "contact", "article"]),
  url: z.string().url(),
  status: z.number().int(),
  check: PageCheckSchema,
  screenshots: z.strictObject({ desktop: z.string(), mobile: z.string() }),
  reviewed: z.boolean(),
  reused: z.boolean(),
  treeHash: z.string().optional(),
  rounds: z.number().int().min(0),
  verdict: z.enum(QA_VERDICTS).optional(),
  summary: z.string().optional(),
  issues: z.array(QaIssueSchema),
  costUsd: z.number().min(0),
});
export type QaPage = z.infer<typeof QaPageSchema>;

export const QaTotalsSchema = z.strictObject({
  urls: z.number().int(), reviewed: z.number().int(), ok: z.number().int(), fixed: z.number().int(), needsHuman: z.number().int(), remainingIssues: z.number().int(),
});
export const QaReportSchema = z.strictObject({
  generatedAt: z.string(),
  siteUrl: z.string().url(),
  costUsd: z.number().min(0),
  totals: QaTotalsSchema,
  pages: z.array(QaPageSchema),
  /** True when one or more targets failed (non-budget error): `pages` then covers only the fulfilled ones. */
  partial: z.boolean().default(false),
  /** URLs of the failed targets when `partial` is true; empty otherwise. */
  failedUrls: z.array(z.string()).default([]),
});
export type QaReport = z.infer<typeof QaReportSchema>;

export function parseQaReport(data: unknown): QaReport {
  const r = QaReportSchema.safeParse(data);
  if (!r.success) throw new Error(`Invalid qa report: ${issuesOf(r.error)}`);
  return r.data;
}

/** `qa/report.json` of a previous run (for the $0 re-run rule), undefined when absent; an unreadable one must be deleted. */
export function readQaReport(ctx: SiteContext): QaReport | undefined {
  const p = qaReportJsonPath(ctx);
  if (!existsSync(p)) return undefined;
  let data: unknown;
  try { data = JSON.parse(readFileSync(p, "utf8")); }
  catch (err) { throw new Error(`${QA_REPORT_JSON} is not valid JSON: ${err instanceof Error ? err.message : String(err)} — delete it (the qa stage rewrites it)`); }
  try { return parseQaReport(data); }
  catch (err) { throw new Error(`${QA_REPORT_JSON}: ${err instanceof Error ? err.message : String(err)} — delete it (the qa stage rewrites it)`); }
}

export const remainingIssues = (p: Pick<QaPage, "issues">): number => p.issues.filter((i) => i.action === "left").length;

/** The page's final verdict is derived from its issues, whatever each round said (left > fixed > ok). */
export function finalVerdict(issues: QaIssue[]): QaVerdict["verdict"] {
  if (issues.some((i) => i.action === "left")) return "needs_human";
  if (issues.some((i) => i.action === "fixed")) return "fixed";
  return "ok";
}

export function computeTotals(pages: QaPage[]): QaReport["totals"] {
  const reviewed = pages.filter((p) => p.reviewed);
  return {
    urls: pages.length,
    reviewed: reviewed.length,
    ok: reviewed.filter((p) => p.verdict === "ok").length,
    fixed: reviewed.filter((p) => p.verdict === "fixed").length,
    needsHuman: reviewed.filter((p) => p.verdict === "needs_human").length,
    remainingIssues: pages.reduce((n, p) => n + remainingIssues(p), 0),
  };
}

// ---------- tree hash (spec decision 9) ----------

export const hashTree = (text: string): string => `sha256:${createHash("sha256").update(text).digest("hex")}`;

/** Hash of `pages/<slug>.gb.json` as stored on disk; undefined when the page has no tree. */
export function treeHash(ctx: SiteContext, slug: string): string | undefined {
  const p = pageTreePath(ctx, slug);
  return existsSync(p) ? hashTree(readFileSync(p, "utf8")) : undefined;
}
