import { readFileSync, writeFileSync } from "node:fs";
import type { SiteContext } from "../docker.js";
import { runAgent, runValidated, type AgentRun } from "../agent.js";
import { pageTreePath, pageTreeRel } from "../artifacts.js";
import { readPageTree } from "../pages/generate.js";
import { loadPrompt } from "../prompts.js";
import { toJsonSchema } from "../schemas/json-schema.js";
import type { PageTree } from "../schemas/page-tree.js";
import type { Page, SiteSpec } from "../schemas/site-spec.js";
import { assertVerdict, checkIssues, parseQaVerdict, screenshotRel, QaVerdictShape, type PageCheck, type QaVerdict, type Viewport } from "../schemas/qa.js";
import { TOOL_GB_BUILD } from "../tools/server.js";

export const deps = { runAgent };
export const QA_MAX_TURNS = 20;
export const QA_TOOLS = ["Read", "Write", TOOL_GB_BUILD];
export const QA_WRITE_ROOTS = ["pages"];

/** Site-relative screenshot paths in reading order: full page then tiles, desktop then mobile. */
export function screenshotList(slug: string, tiles: Record<Viewport, number>): string[] {
  const out: string[] = [];
  for (const v of ["desktop", "mobile"] as const) {
    out.push(screenshotRel(slug, v));
    for (let i = 1; i <= tiles[v]; i++) out.push(screenshotRel(slug, v, i));
  }
  return out;
}

function issueLines(check: PageCheck): string[] {
  const issues = checkIssues(check);
  return issues.length ? issues.map((i) => `- ${i}`) : ["Aucun défaut automatique."];
}

export function qaUserPrompt(spec: SiteSpec, page: Page, check: PageCheck, tiles: Record<Viewport, number>): string {
  const id = spec.identity;
  return [
    `# Page \`${page.slug}\` — ${page.title} [${page.kind}] — ${check.url}`,
    `Objectif : ${page.goal}`,
    `Site : ${id.name} — ${id.sector}${id.location ? ` (${id.location})` : ""}. Ton : ${id.tone}.`,
    "",
    "## Sections attendues (dans cet ordre)",
    ...page.sections.map((s, i) => `${i + 1}. **${s.type}** « ${s.heading} » — ${s.summary}`),
    "",
    "## Défauts relevés automatiquement",
    ...issueLines(check),
    "",
    "## Captures (à lire avec Read, dans cet ordre)",
    ...screenshotList(page.slug, tiles).map((p) => `- \`${p}\``),
    "",
    "## À faire",
    `Lis les captures, puis \`design-system.md\` et \`${pageTreeRel(page.slug)}\`. Corrige l'arbre si nécessaire (Write + \`gb_build\`), puis réponds avec l'objet JSON demandé.`,
  ].join("\n");
}

/** Second round, same session: the page was republished, the screenshots overwritten at the same paths (but a shorter page
 *  has fewer tiles now, so list the captures again rather than assume the first round's list still matches). */
export function qaResumePrompt(check: PageCheck, slug: string, tiles: Record<Viewport, number>): string {
  return [
    "La page a été republiée avec ton arbre corrigé et recontrôlée ; les captures ont été refaites aux mêmes chemins (relis-les).",
    "",
    "## Défauts relevés automatiquement après correction",
    ...issueLines(check),
    "",
    "## Captures (refaites, à relire dans cet ordre)",
    ...screenshotList(slug, tiles).map((p) => `- \`${p}\``),
    "",
    "Relis la page, corrige ce qui reste si c'est sûr (Write + `gb_build`), puis réponds avec l'objet JSON demandé.",
  ].join("\n");
}

export type ReviewResult = {
  verdict: QaVerdict; treeChanged: boolean; tree: PageTree; costUsd: number; attempts: 1 | 2; sessionId?: string;
  /** Set when the agent's rewritten tree was still invalid after the retry: the file was restored and the verdict synthesized. */
  rejected?: string;
};

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * One agent review of a page (spec decision 6): structured verdict validated against the tree on disk, one retry in
 * the same session, and — when the rewritten tree is still invalid — restoration of the previous tree plus a synthetic
 * `needs_human` verdict so the page is never lost and the stage keeps going.
 */
export async function reviewPage(
  ctx: SiteContext, spec: SiteSpec, page: Page, check: PageCheck, tiles: Record<Viewport, number>, opts: { resume?: string } = {},
): Promise<ReviewResult> {
  const rel = pageTreeRel(page.slug), abs = pageTreePath(ctx, page.slug);
  const before = readFileSync(abs, "utf8");
  const originalTree = readPageTree(ctx, page);
  const startCost = ctx.state.costUsd;
  const validate = (run: AgentRun): { verdict: QaVerdict; changed: boolean; tree: PageTree } => {
    const verdict = parseQaVerdict(run.structured);
    const changed = readFileSync(abs, "utf8") !== before;
    let tree = originalTree;
    if (changed) {
      try { tree = readPageTree(ctx, page); }
      catch (err) { throw new Error(`${rel} was rewritten but is invalid: ${err instanceof Error ? err.message : String(err)}`); }
    }
    assertVerdict(verdict, changed);
    return { verdict, changed, tree };
  };
  try {
    const r = await runValidated(deps.runAgent, ctx, {
      stage: "qa",
      systemPrompt: loadPrompt("qa"),
      prompt: opts.resume ? qaResumePrompt(check, page.slug, tiles) : qaUserPrompt(spec, page, check, tiles),
      allowedTools: QA_TOOLS,
      outputFormat: { type: "json_schema", schema: toJsonSchema(QaVerdictShape) },
      maxTurns: QA_MAX_TURNS,
      writeRoots: QA_WRITE_ROOTS,
      resume: opts.resume,
    }, validate);
    // `r.costUsd` is `runValidated`'s own sum of this call's attempt(s) — safe under concurrent `reviewPage` calls
    // sharing `ctx.state`, unlike a `ctx.state.costUsd` delta which would also pick up other pages' spend.
    return { verdict: r.value.verdict, treeChanged: r.value.changed, tree: r.value.tree, costUsd: r.costUsd, attempts: r.attempts, sessionId: r.run.sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("output still invalid after one retry")) throw err;
    if (readFileSync(abs, "utf8") !== before) writeFileSync(abs, before);
    console.warn(`  ⚠ ${rel}: fix rejected, previous tree restored — ${message.split("\n")[0].slice(0, 200)}`);
    return {
      verdict: { verdict: "needs_human", summary: "Correction refusée par Faktory : arbre restauré.", issues: [{ severity: "major", where: rel, what: `correction refusée : ${message}`, action: "left" }] },
      // `runValidated` threw without returning a cost here, so fall back to the `ctx.state` delta — approximate
      // under concurrent `reviewPage` calls (it can include other pages' spend in that window), unlike the success path above.
      treeChanged: false, tree: originalTree, costUsd: round4(ctx.state.costUsd - startCost), attempts: 2, rejected: message,
    };
  }
}
