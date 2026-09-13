import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { SiteContext } from "../docker.js";
import { run } from "../exec.js";
import type { PluginManifest } from "../schemas/plugin-manifest.js";

export const deps = { run };
/** Decision 14: what never ships — update scratch, the debug log, the WordPress default themes copied by the image. */
export const TAR_EXCLUDES = ["wp-content/upgrade", "wp-content/debug.log", "wp-content/themes/twenty*"];

/** `tar -czf <out> -C <siteDir> wp-content` with the excludes (bsdtar on macOS, GNU tar elsewhere: both accept these flags). Returns the archive size. */
export async function bundleWpContent(ctx: SiteContext, out: string): Promise<number> {
  try { mkdirSync(dirname(out), { recursive: true }); } catch { /* tar reports the real error below */ }
  const args = ["-czf", out, "-C", ctx.siteDir, ...TAR_EXCLUDES.flatMap((e) => ["--exclude", e]), "wp-content"];
  const r = await deps.run("tar", args);
  if (r.code !== 0) throw new Error(`tar failed (exit ${r.code}): ${r.stderr.trim()}`);
  return statSync(out).size;
}

export async function listTar(out: string): Promise<string[]> {
  const r = await deps.run("tar", ["-tzf", out]);
  if (r.code !== 0) throw new Error(`tar -t failed (exit ${r.code}): ${r.stderr.trim()}`);
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Entries the archive must contain for the site to restore: parent theme, child theme, GenerateBlocks, every custom plugin. */
export function requiredTarEntries(ctx: SiteContext, manifests: PluginManifest[]): string[] {
  return [
    "wp-content/themes/generatepress/style.css",
    `wp-content/themes/faktory-${ctx.slug}/style.css`,
    "wp-content/plugins/generateblocks/",
    ...manifests.map((m) => `wp-content/plugins/${m.plugin}/`),
  ];
}

export function assertTarEntries(listing: string[], required: string[]): void {
  const missing = required.filter((r) => !listing.some((e) => e === r || e.startsWith(r)));
  if (missing.length) throw new Error(`wp-content.tar.gz is missing: ${missing.join(", ")}`);
}
