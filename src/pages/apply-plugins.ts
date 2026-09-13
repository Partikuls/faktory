import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SiteContext } from "../docker.js";
import { FEATURE_WRAPPER_ATTR, type GbNode, type PageTree } from "../schemas/page-tree.js";
import { PLUGINS_DIR, parsePluginManifest, type PluginManifest } from "../schemas/plugin-manifest.js";

/** Replace, in `nodes` (recursively), the first element carrying `data-faktory-feature=<id>` by `replacement`. Returns true when replaced. */
function replaceWrapper(nodes: GbNode[], id: string, replacement: GbNode): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === "element" && n.htmlAttributes?.[FEATURE_WRAPPER_ATTR] === id) { nodes[i] = replacement; return true; }
    if (n.innerBlocks?.length && replaceWrapper(n.innerBlocks, id, replacement)) return true;
  }
  return false;
}

/**
 * Compile-time substitution (spec decision 1): the tree on disk keeps its placeholder wrapper; the copy
 * handed to gb_build gets the plugin's block markup for this page instead. Pure — the input is not mutated.
 */
export function applyPlugins(tree: PageTree, manifests: PluginManifest[], pageSlug: string): { tree: PageTree; applied: string[] } {
  const copy: PageTree = JSON.parse(JSON.stringify(tree));
  const applied: string[] = [];
  for (const m of manifests) {
    const placement = m.placements[pageSlug];
    if (!placement) continue;
    if (replaceWrapper(copy, m.feature, { type: "raw", rawMarkup: placement })) applied.push(m.feature);
  }
  return { tree: copy, applied };
}

/** Every `plugins/*.json` of the site, parsed, sorted by file name; [] when the directory does not exist. */
export function readPluginManifests(ctx: SiteContext): PluginManifest[] {
  const dir = join(ctx.siteDir, PLUGINS_DIR);
  if (!existsSync(dir)) return [];
  const out: PluginManifest[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const rel = `${PLUGINS_DIR}/${f}`;
    let data: unknown;
    try { data = JSON.parse(readFileSync(join(dir, f), "utf8")); }
    catch (err) { throw new Error(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
    try { out.push(parsePluginManifest(data)); }
    catch (err) { throw new Error(`${rel}: ${err instanceof Error ? err.message : String(err)}`); }
  }
  return out;
}
