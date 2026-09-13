import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SiteContext } from "../docker.js";
import { FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type GbNode, type PageTree } from "../schemas/page-tree.js";
import { PLUGINS_DIR, parsePluginManifest, validatePlacements, type PluginManifest } from "../schemas/plugin-manifest.js";
import { FORMS_MANIFEST_REL, assertFormsManifest, formsManifestPath, pageForms, parseFormsManifest, type FormsManifest } from "../schemas/forms-manifest.js";
import type { Page } from "../schemas/site-spec.js";

/** A wrapper `attr="<id>"` in a page tree and the block markup that replaces it at compile time. */
export type Placement = { attr: string; id: string; markup: string };

/** Replace, in `nodes` (recursively), the first element carrying `attr=<id>` by `replacement`. Returns true when replaced. */
function replaceWrapper(nodes: GbNode[], attr: string, id: string, replacement: GbNode): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === "element" && n.htmlAttributes?.[attr] === id) { nodes[i] = replacement; return true; }
    if (n.innerBlocks?.length && replaceWrapper(n.innerBlocks, attr, id, replacement)) return true;
  }
  return false;
}

/**
 * Compile-time substitution (phase 4 decision 1, phase 5 decision 3): the tree on disk keeps its placeholder
 * wrappers; the copy handed to gb_build gets the plugin block / Gravity Forms block instead. Pure — the input is not mutated.
 */
export function applyPlacements(tree: PageTree, placements: Placement[]): { tree: PageTree; applied: Placement[] } {
  const copy: PageTree = JSON.parse(JSON.stringify(tree));
  const applied: Placement[] = [];
  for (const p of placements) {
    if (replaceWrapper(copy, p.attr, p.id, { type: "raw", rawMarkup: p.markup })) applied.push(p);
  }
  return { tree: copy, applied };
}

/** Feature placements of `pageSlug` from every plugin manifest that places there. */
export function pluginPlacements(manifests: PluginManifest[], pageSlug: string): Placement[] {
  const out: Placement[] = [];
  for (const m of manifests) {
    const markup = m.placements[pageSlug];
    if (markup) out.push({ attr: FEATURE_WRAPPER_ATTR, id: m.feature, markup });
  }
  return out;
}

/** Form placements of `page`: its form/contact sections' forms that exist in the manifest. */
export function formPlacements(manifest: FormsManifest, page: Page): Placement[] {
  const out: Placement[] = [];
  for (const id of pageForms(page)) {
    const entry = manifest[id];
    if (entry) out.push({ attr: FORM_WRAPPER_ATTR, id, markup: entry.placement });
  }
  return out;
}

/**
 * Every `plugins/*.json` of the site, parsed and re-checked, sorted by file name; [] when the directory
 * does not exist. The placements are markup this stage injects into pages, so they are validated here too.
 */
export function readPluginManifests(ctx: SiteContext): PluginManifest[] {
  const dir = join(ctx.siteDir, PLUGINS_DIR);
  if (!existsSync(dir)) return [];
  const out: PluginManifest[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const rel = `${PLUGINS_DIR}/${f}`;
    let data: unknown;
    try { data = JSON.parse(readFileSync(join(dir, f), "utf8")); }
    catch (err) { throw new Error(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
    let m: PluginManifest;
    try { m = parsePluginManifest(data); }
    catch (err) { throw new Error(`${rel}: ${err instanceof Error ? err.message : String(err)}`); }
    const issues = validatePlacements(m);
    if (issues.length) throw new Error(`${rel}: ${issues.join("; ")}`);
    out.push(m);
  }
  return out;
}

/** `content/forms.json`, parsed and re-validated; {} when the file does not exist. */
export function readFormsManifest(ctx: SiteContext): FormsManifest {
  const p = formsManifestPath(ctx);
  if (!existsSync(p)) return {};
  let data: unknown;
  try { data = JSON.parse(readFileSync(p, "utf8")); }
  catch (err) { throw new Error(`${FORMS_MANIFEST_REL} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
  let m: FormsManifest;
  try { m = parseFormsManifest(data); }
  catch (err) { throw new Error(`${FORMS_MANIFEST_REL}: ${err instanceof Error ? err.message : String(err)}`); }
  assertFormsManifest(m);
  return m;
}
