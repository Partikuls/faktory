import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { FaktoryConfig } from "../config.js";
import type { SiteContext } from "../docker.js";
import { runAgent, runValidated } from "../agent.js";
import { loadPrompt } from "../prompts.js";
import { phpCheck } from "../php.js";
import { wpJson } from "../wp.js";
import { hexIssues } from "../schemas/page-tree.js";
import {
  assertPluginManifest, manifestPath, manifestRel, parsePluginManifest, placementPages, pluginDirPath, pluginDirRel, pluginSlug,
  blockName, shortcodeName, requiredPluginFiles, PLUGINS_DIR, RENDER_ATTR, kebab, type PluginManifest,
} from "../schemas/plugin-manifest.js";
import type { Feature, SiteSpec } from "../schemas/site-spec.js";
import { TOOL_PHP_CHECK, TOOL_WP } from "../tools/server.js";

export const deps = { runAgent, phpCheck, wpJson };
export const PLUGINS_MAX_TURNS = 80;
export const PLUGINS_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", TOOL_WP, TOOL_PHP_CHECK];
export const MIN_SEED_ENTRIES = 3;

export function referencePluginDir(config: FaktoryConfig): string {
  return join(config.repoRoot, "fixtures", "plugins", "faktory-catalogue-produits");
}

export function pluginsUserPrompt(spec: SiteSpec, feature: Feature, opts: { referenceDir: string }): string {
  const id = feature.id;
  const pages = spec.sitemap.filter((p) => placementPages(spec, id).includes(p.slug));
  const field = (f: Feature["fields"][number]): string =>
    `\`${f.key}\` ${f.label} (${f.type}${f.options?.length ? ` : ${f.options.join(" | ")}` : ""})`;
  const lines: string[] = [
    `# Feature \`${id}\` — ${feature.name}`,
    feature.description,
    "",
    `CPT \`${feature.cpt.slug}\` (${feature.cpt.singular} / ${feature.cpt.plural}).`,
    "",
    "## Champs",
    ...feature.fields.map((f) => `- ${field(f)}`),
    "",
    "## Taxonomies",
    ...(feature.taxonomies.length
      ? feature.taxonomies.map((t) => `- \`${t.slug}\` ${t.singular} / ${t.plural} : ${t.terms.join(", ")}`)
      : ["- aucune"]),
    "",
    "## Affichage attendu",
    feature.display,
    "",
    "## Pages où insérer le bloc (une entrée `placements` chacune, aucune autre)",
    ...pages.map((p) => {
      const sections = p.sections.filter((s) => s.type === "custom-query" && s.feature === id);
      return `- \`${p.slug}\` (${p.kind === "home" ? "/" : `/${p.slug}/`}) — ${sections.map((s) => `section « ${s.heading} » : ${s.summary}`).join(" ; ")}`;
    }),
    "",
    "## Identité",
    `${spec.identity.name} — ${spec.identity.sector}${spec.identity.location ? ` (${spec.identity.location})` : ""}. Ton : ${spec.identity.tone}.`,
    "",
    "## Nommage (dérivé de l'identifiant, à respecter exactement)",
    `Plugin : \`${pluginDirRel(id)}/\` (slug \`${pluginSlug(id)}\`, text domain \`${pluginSlug(id)}\`). Bloc : \`${blockName(id)}\`. Shortcode : \`[${shortcodeName(id)}]\`. Fonction de rendu : \`faktory_${id}_render\`. Meta : \`_${feature.cpt.slug}_<champ>\`. Attribut racine du rendu : \`${RENDER_ATTR}="${id}"\`. Dossier du bloc : \`blocks/${kebab(id)}/\`.`,
    `Fichiers obligatoires : ${requiredPluginFiles(id).join(", ")}.`,
    `Manifeste : \`${manifestRel(id)}\`.`,
    "",
    "## À faire",
    `Lis d'abord tous les fichiers du plugin de référence : \`${opts.referenceDir}\` (Read, chemin absolu). Puis écris le plugin, passe \`php_check\`, active-le, alimente ${MIN_SEED_ENTRIES + 1} à 6 entrées avec \`wp\`, écris le manifeste et réponds par une ligne de résumé.`,
  ];
  return lines.join("\n");
}

/** Read and cross-check `plugins/<id>.json`; throws a message the agent can act on. */
export function readPluginManifest(ctx: SiteContext, spec: SiteSpec, feature: Feature): PluginManifest {
  const rel = manifestRel(feature.id), abs = manifestPath(ctx, feature.id);
  if (!existsSync(abs)) throw new Error(`${rel} was not written — write it with Write`);
  let data: unknown;
  try { data = JSON.parse(readFileSync(abs, "utf8")); }
  catch (err) { throw new Error(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
  const m = parsePluginManifest(data);
  assertPluginManifest(m, spec, feature);
  return m;
}

export type VerifiedPlugin = { manifest: PluginManifest; entries: number };

type Named = { name: string; status?: string };

/** Everything the spec's decision 4 checks before a plugin is integrated. Throws the first failing check. */
export async function verifyPlugin(ctx: SiteContext, spec: SiteSpec, feature: Feature): Promise<VerifiedPlugin> {
  const id = feature.id, slug = pluginSlug(id), dir = pluginDirPath(ctx, id), rel = pluginDirRel(id);
  const manifest = readPluginManifest(ctx, spec, feature);
  const missing = requiredPluginFiles(id).filter((f) => !existsSync(join(dir, f)));
  if (missing.length) throw new Error(`missing file(s) in ${rel}: ${missing.join(", ")}`);
  const php = await deps.phpCheck(ctx.config, dir);
  if (!php.ok) throw new Error(`php_check failed:\n${php.output}`);
  const cssIssues: string[] = [];
  hexIssues(readFileSync(join(dir, "style.css"), "utf8"), "style.css", cssIssues);
  if (cssIssues.length) throw new Error(cssIssues.join("\n"));
  const plugins = await deps.wpJson<Named[]>(ctx, ["plugin", "list", "--fields=name,status"]);
  if (!plugins.some((p) => p.name === slug && p.status === "active")) {
    throw new Error(`plugin ${slug} is not active — run wp ["plugin","activate","${slug}"] and fix any activation error`);
  }
  const types = await deps.wpJson<Named[]>(ctx, ["post-type", "list", "--fields=name"]);
  if (!types.some((t) => t.name === feature.cpt.slug)) throw new Error(`post type "${feature.cpt.slug}" is not registered — check register_post_type in includes/post-type.php`);
  const posts = await deps.wpJson<{ ID: number }[]>(ctx, ["post", "list", `--post_type=${feature.cpt.slug}`, "--post_status=publish", "--fields=ID"]);
  if (posts.length < MIN_SEED_ENTRIES) {
    throw new Error(`only ${posts.length} published "${feature.cpt.slug}" entries, at least ${MIN_SEED_ENTRIES} expected — seed them with wp post create`);
  }
  for (const t of feature.taxonomies) {
    const terms = await deps.wpJson<Named[]>(ctx, ["term", "list", t.slug, "--fields=name"]);
    const present = new Set(terms.map((x) => x.name.toLowerCase()));
    const absent = t.terms.filter((name) => !present.has(name.toLowerCase()));
    if (absent.length) throw new Error(`taxonomy "${t.slug}" is missing term(s): ${absent.join(", ")} — create them with wp term create`);
  }
  return { manifest, entries: posts.length };
}

/** One agent run (plus one validated retry) producing the plugin dir + manifest, verified end to end. */
export async function generatePlugin(
  ctx: SiteContext, spec: SiteSpec, feature: Feature,
): Promise<{ manifest: PluginManifest; entries: number; costUsd: number; attempts: 1 | 2 }> {
  try {
    const r = await runValidated(deps.runAgent, ctx, {
      stage: "plugins",
      systemPrompt: loadPrompt("plugins"),
      prompt: pluginsUserPrompt(spec, feature, { referenceDir: referencePluginDir(ctx.config) }),
      allowedTools: PLUGINS_TOOLS,
      maxTurns: PLUGINS_MAX_TURNS,
      writeRoots: [pluginDirRel(feature.id), PLUGINS_DIR],
    }, () => verifyPlugin(ctx, spec, feature));
    return { manifest: r.value.manifest, entries: r.value.entries, costUsd: r.costUsd, attempts: r.attempts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Same convention as pages: a manifest that is still invalid after the retry is deleted so the next
    // run regenerates the plugin instead of "reusing" a broken one. The plugin dir is kept for inspection.
    if (message.includes("output still invalid after one retry")) {
      const abs = manifestPath(ctx, feature.id);
      if (existsSync(abs)) rmSync(abs);
      throw new Error(`${message} — ${manifestRel(feature.id)} deleted, the next run regenerates it`);
    }
    throw err;
  }
}
