import { z } from "zod";
import { join } from "node:path";
import type { SiteContext } from "../docker.js";
import { CONTENT_DIR } from "../artifacts.js";
import { DENYLIST_RE } from "./page-tree.js";
import type { Page, SiteSpec } from "./site-spec.js";

export const FORMS_MANIFEST_REL = `${CONTENT_DIR}/forms.json`;
export const formsManifestPath = (ctx: SiteContext): string => join(ctx.siteDir, FORMS_MANIFEST_REL);

/** The Gravity Forms block Faktory places in a page (editable in Gutenberg, unlike the shortcode). */
export const gfPlacement = (gfId: number): string => `<!-- wp:gravityforms/form {"formId":"${gfId}","title":false,"description":false} /-->`;

const key = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key");

export const FormsManifestSchema = z.record(key, z.strictObject({
  gfId: z.number().int().positive(),
  placement: z.string().min(1),
}));
export type FormsManifest = z.infer<typeof FormsManifestSchema>;

export function parseFormsManifest(data: unknown): FormsManifest {
  const r = FormsManifestSchema.safeParse(data);
  if (!r.success) throw new Error(`Invalid forms manifest: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

function placementRe(gfId: number): RegExp {
  return new RegExp(`^<!-- wp:gravityforms/form \\{.*"formId":"${gfId}".*\\} /-->$`);
}

/** No forbidden markup, and a self-closing gravityforms/form block whose formId is the entry's gfId. */
export function validateFormsManifest(m: FormsManifest): string[] {
  const issues: string[] = [];
  for (const [id, entry] of Object.entries(m)) {
    const forbidden = entry.placement.match(DENYLIST_RE);
    if (forbidden) issues.push(`${id}: forbidden markup (${forbidden[0]})`);
    if (!placementRe(entry.gfId).test(entry.placement)) {
      issues.push(`${id}: must be the block <!-- wp:gravityforms/form {…"formId":"${entry.gfId}"…} /--> (got "${entry.placement.slice(0, 80)}")`);
    }
  }
  return issues;
}

export function assertFormsManifest(m: FormsManifest): void {
  const issues = validateFormsManifest(m);
  if (issues.length) throw new Error(`${FORMS_MANIFEST_REL} is invalid:\n- ${issues.join("\n- ")}`);
}

/** Form ids referenced by a page's form/contact sections, each once, in section order. */
export function pageForms(page: Page): string[] {
  const out: string[] = [];
  for (const s of page.sections) {
    if ((s.type === "form" || s.type === "contact") && s.form && !out.includes(s.form)) out.push(s.form);
  }
  return out;
}

/** Slugs of the pages that carry `formId`, in sitemap order. */
export function formPages(spec: SiteSpec, formId: string): string[] {
  return spec.sitemap.filter((p) => pageForms(p).includes(formId)).map((p) => p.slug);
}
