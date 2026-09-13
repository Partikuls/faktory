import { z } from "zod";
import { join } from "node:path";
import type { SiteContext } from "../docker.js";
import type { Feature, SiteSpec } from "./site-spec.js";
import { DENYLIST_RE } from "./page-tree.js";

export const RENDER_ATTR = "data-faktory-plugin";
export const PLUGINS_DIR = "plugins";

export const kebab = (id: string): string => id.replace(/_/g, "-");
export const pluginSlug = (id: string): string => `faktory-${kebab(id)}`;
export const blockName = (id: string): string => `faktory/${kebab(id)}`;
export const shortcodeName = (id: string): string => `faktory_${id}`;

export const manifestRel = (id: string): string => `${PLUGINS_DIR}/${id}.json`;
export const manifestPath = (ctx: SiteContext, id: string): string => join(ctx.siteDir, manifestRel(id));
export const pluginDirRel = (id: string): string => `wp-content/plugins/${pluginSlug(id)}`;
export const pluginDirPath = (ctx: SiteContext, id: string): string => join(ctx.siteDir, pluginDirRel(id));

/** Files the plugin contract requires, relative to the plugin dir (spec « Contrat de plugin »). */
export function requiredPluginFiles(id: string): string[] {
  const k = kebab(id);
  return [
    `${pluginSlug(id)}.php`, "includes/post-type.php", "includes/taxonomies.php", "includes/meta.php", "includes/admin-columns.php",
    "includes/render.php", `blocks/${k}/block.json`, `blocks/${k}/render.php`, `blocks/${k}/index.js`, `blocks/${k}/index.asset.php`,
    "style.css", "uninstall.php",
  ];
}

const key = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key");

export const PluginManifestSchema = z.strictObject({
  feature: key,
  plugin: z.string().min(1),
  postType: z.string().min(1),
  block: z.string().min(1),
  shortcode: z.string().min(1),
  placements: z.record(z.string(), z.string().min(1)),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export function parsePluginManifest(data: unknown): PluginManifest {
  const r = PluginManifestSchema.safeParse(data);
  if (!r.success) throw new Error(`Invalid plugin manifest: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

/** Slugs of the pages that carry a `custom-query` section for `featureId`, in sitemap order. */
export function placementPages(spec: SiteSpec, featureId: string): string[] {
  return spec.sitemap.filter((p) => p.sections.some((s) => s.type === "custom-query" && s.feature === featureId)).map((p) => p.slug);
}

function placementRe(id: string): RegExp {
  const name = blockName(id).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`^<!-- wp:${name}( \\{.*\\})? /-->$`);
}

/**
 * The placement checks that need no spec: no forbidden markup, and a self-closing block comment of the
 * manifest's own block. Runs both on the plugins path (`validatePluginManifest`) and on the pages path
 * (`readPluginManifests`), which reads manifests written by an earlier run.
 */
export function validatePlacements(m: PluginManifest): string[] {
  const issues: string[] = [];
  const re = placementRe(m.feature);
  for (const [slug, markup] of Object.entries(m.placements)) {
    const forbidden = markup.match(DENYLIST_RE);
    if (forbidden) issues.push(`placements.${slug}: forbidden markup (${forbidden[0]})`);
    if (!re.test(markup)) issues.push(`placements.${slug}: must be a self-closing block comment <!-- wp:${blockName(m.feature)} {...} /--> (got "${markup.slice(0, 80)}")`);
  }
  return issues;
}

/** Cross-checks the manifest against the spec's feature and sitemap. Returns human-readable issues (empty = valid). */
export function validatePluginManifest(m: PluginManifest, spec: SiteSpec, feature: Feature): string[] {
  const issues: string[] = [];
  const id = feature.id;
  if (m.feature !== id) issues.push(`feature must be "${id}" (got "${m.feature}")`);
  if (m.plugin !== pluginSlug(id)) issues.push(`plugin must be "${pluginSlug(id)}" (got "${m.plugin}")`);
  if (m.postType !== feature.cpt.slug) issues.push(`postType must be "${feature.cpt.slug}" (got "${m.postType}")`);
  if (m.block !== blockName(id)) issues.push(`block must be "${blockName(id)}" (got "${m.block}")`);
  if (m.shortcode !== shortcodeName(id)) issues.push(`shortcode must be "${shortcodeName(id)}" (got "${m.shortcode}")`);
  const expected = placementPages(spec, id);
  for (const slug of expected) if (!(slug in m.placements)) issues.push(`missing placement for page "${slug}" (its custom-query section shows ${id})`);
  for (const slug of Object.keys(m.placements)) {
    if (!expected.includes(slug)) issues.push(`unexpected placement for page "${slug}" (no custom-query section for ${id} there)`);
  }
  issues.push(...validatePlacements(m));
  return issues;
}

export function assertPluginManifest(m: PluginManifest, spec: SiteSpec, feature: Feature): void {
  const issues = validatePluginManifest(m, spec, feature);
  if (issues.length) throw new Error(`${manifestRel(feature.id)} is invalid:\n- ${issues.join("\n- ")}`);
}
