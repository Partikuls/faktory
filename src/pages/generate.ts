import { existsSync, readFileSync, rmSync } from "node:fs";
import type { SiteContext } from "../docker.js";
import { runAgent, runValidated } from "../agent.js";
import { pageTreePath, pageTreeRel } from "../artifacts.js";
import { loadPrompt } from "../prompts.js";
import {
  featureMarker, formMarker, parsePageTree, assertPageTree, requiredMarkers,
  FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type PageTree,
} from "../schemas/page-tree.js";
import type { Page, SiteSpec } from "../schemas/site-spec.js";
import { TOOL_GB_BUILD, TOOL_GB_PREVIEW } from "../tools/server.js";

export const deps = { runAgent };
export const PAGES_MAX_TURNS = 30;
export const PAGES_TOOLS = ["Read", "Write", TOOL_GB_BUILD, TOOL_GB_PREVIEW];
export const PAGES_WRITE_ROOTS = ["pages"];

const NA = "[à confirmer]";

export function pagesUserPrompt(spec: SiteSpec, page: Page, opts: { homeSlug?: string } = {}): string {
  const id = spec.identity;
  const features = spec.features.filter((f) => page.sections.some((s) => s.feature === f.id));
  const forms = spec.forms.filter((f) => page.sections.some((s) => s.form === f.id));
  const required = new Set(requiredMarkers(page));
  const lines: string[] = [
    `# Page \`${page.slug}\` — ${page.title} [${page.kind}]`,
    `Objectif : ${page.goal}`,
    `Titre SEO : ${page.seo.title}`,
    "",
    "## Sections (dans cet ordre)",
    ...page.sections.map((s, i) => {
      const extra = [
        s.type === "custom-query" && s.feature && required.has(featureMarker(s.feature))
          ? `feature \`${s.feature}\` → marqueur obligatoire \`${featureMarker(s.feature)}\` → enveloppe \`${FEATURE_WRAPPER_ATTR}="${s.feature}"\` contenant les cartes d'exemple puis le marqueur`
          : "",
        (s.type === "form" || s.type === "contact") && s.form && required.has(formMarker(s.form))
          ? `formulaire \`${s.form}\` → marqueur obligatoire \`${formMarker(s.form)}\` → enveloppe \`${FORM_WRAPPER_ATTR}="${s.form}"\` contenant le marqueur puis la carte « bientôt disponible »`
          : "",
      ].filter(Boolean).join(" ; ");
      return `${i + 1}. **${s.type}** « ${s.heading} » — ${s.summary}${extra ? ` — ${extra}` : ""}`;
    }),
    "",
    "## Identité",
    `${id.name} — ${id.sector}${id.location ? ` (${id.location})` : ""}. Accroche : ${id.tagline}. Ton : ${id.tone}.`,
    `Contact : email ${id.contact.email ?? NA}, téléphone ${id.contact.phone ?? NA}, adresse ${id.contact.address ?? NA}.`,
  ];
  if (id.contact.hours?.length) lines.push(`Horaires : ${id.contact.hours.join(" ; ")}`);
  lines.push(`Pages du site (pour les liens) : ${spec.sitemap.map((p) => `${p.kind === "home" ? "/" : `/${p.slug}/`} (${p.title})`).join(", ")}.`);
  if (features.length) {
    lines.push("", "## Features affichées (3 cartes d'exemple à illustrer, puis le marqueur)");
    for (const f of features) lines.push(`- \`${f.id}\` ${f.name} : ${f.description} Champs : ${f.fields.map((x) => x.label).join(", ")}. Affichage : ${f.display}`);
  }
  if (forms.length) {
    lines.push("", "## Formulaires (livrés plus tard : intro + marqueur + carte « bientôt disponible »)");
    for (const f of forms) lines.push(`- \`${f.id}\` ${f.name} : ${f.fields.map((x) => `${x.label}${x.required ? "*" : ""}`).join(", ")}`);
  }
  const reads = ["`design-system.md`", "`design-tokens.json`", "`design/preview.gb.json`"];
  const readList = opts.homeSlug ? `${reads.join(", ")} et \`${pageTreeRel(opts.homeSlug)}\`` : reads.join(", ");
  lines.push("", "## À faire", `Lis ${readList}, puis écris \`${pageTreeRel(page.slug)}\` (Write) et vérifie-le avec \`gb_build\`. Réponds ensuite par une ligne de résumé.`);
  return lines.join("\n");
}

/** Read `pages/<slug>.gb.json` and validate it for `page`; throws a message the agent can act on. */
export function readPageTree(ctx: SiteContext, page: Page): PageTree {
  const rel = pageTreeRel(page.slug), abs = pageTreePath(ctx, page.slug);
  if (!existsSync(abs)) throw new Error(`${rel} was not written — write it with Write`);
  let data: unknown;
  try { data = JSON.parse(readFileSync(abs, "utf8")); }
  catch (err) { throw new Error(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
  const tree = parsePageTree(data);
  assertPageTree(tree, page);
  return tree;
}

/** One agent run (plus one validated retry) producing `pages/<slug>.gb.json`. */
export async function generatePageTree(
  ctx: SiteContext, spec: SiteSpec, page: Page, opts: { homeSlug?: string } = {},
): Promise<{ tree: PageTree; costUsd: number; attempts: 1 | 2 }> {
  try {
    const r = await runValidated(deps.runAgent, ctx, {
      stage: "pages",
      systemPrompt: loadPrompt("pages"),
      prompt: pagesUserPrompt(spec, page, opts),
      allowedTools: PAGES_TOOLS,
      maxTurns: PAGES_MAX_TURNS,
      writeRoots: PAGES_WRITE_ROOTS,
    }, () => readPageTree(ctx, page));
    return { tree: r.value, costUsd: r.costUsd, attempts: r.attempts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Only when the retry's own output is still invalid (not e.g. an agent/budget failure):
    // delete the poisoned tree so the next `run --only pages` regenerates it instead of reusing it.
    if (message.includes("output still invalid after one retry")) {
      const abs = pageTreePath(ctx, page.slug);
      if (existsSync(abs)) rmSync(abs);
      throw new Error(`${message} — ${pageTreeRel(page.slug)} deleted, the next run regenerates it`);
    }
    throw err;
  }
}
