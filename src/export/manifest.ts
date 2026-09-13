import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SiteContext } from "../docker.js";
import { wpJson, wpOk } from "../wp.js";
import { QA_REPORT_MD, type QaReport } from "../schemas/qa.js";
import { articleSlug } from "../schemas/article.js";
import type { PluginManifest } from "../schemas/plugin-manifest.js";
import type { FormsManifest } from "../schemas/forms-manifest.js";
import type { SiteSpec } from "../schemas/site-spec.js";

export const deps = { wpOk, wpJson };

export function faktoryVersion(): string {
  return (JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { version: string }).version;
}

export type WpItem = { name: string; version: string; status: string };
export type Versions = { wordpress: string; plugins: WpItem[]; themes: WpItem[] };

export async function gatherVersions(ctx: SiteContext): Promise<Versions> {
  const wordpress = await deps.wpOk(ctx, ["core", "version"]);
  const plugins = await deps.wpJson<WpItem[]>(ctx, ["plugin", "list", "--fields=name,version,status"]);
  const themes = await deps.wpJson<WpItem[]>(ctx, ["theme", "list", "--fields=name,version,status"]);
  return { wordpress, plugins, themes };
}

export type Manifest = {
  slug: string; name: string; generatedAt: string; faktoryVersion: string;
  wordpress: string;
  theme: { generatepress: string; child: string };
  plugins: WpItem[];
  pages: { slug: string; title: string; kind: string; path: string }[];
  customPlugins: { feature: string; plugin: string; postType: string; block: string }[];
  forms: { id: string; name: string; gfId: number }[];
  articles: string[];
  qa: { urls: number; reviewed: number; remainingIssues: number; report: string } | null;
  costUsd: number;
  files: Record<string, number>;
};

export type ManifestInput = {
  ctx: SiteContext; spec: SiteSpec; versions: Versions; manifests: PluginManifest[]; forms: FormsManifest;
  qa: QaReport | undefined; files: Record<string, number>; generatedAt: string;
};

/** Decision 17: everything an operator or a later Faktory needs to know about the bundle, derived from the artifacts — never typed by hand. */
export function buildManifest(i: ManifestInput): Manifest {
  return {
    slug: i.ctx.slug,
    name: i.spec.identity.name,
    generatedAt: i.generatedAt,
    faktoryVersion: faktoryVersion(),
    wordpress: i.versions.wordpress,
    theme: { generatepress: i.versions.themes.find((t) => t.name === "generatepress")?.version ?? "", child: `faktory-${i.ctx.slug}` },
    plugins: i.versions.plugins,
    pages: i.spec.sitemap.map((p) => ({ slug: p.slug, title: p.title, kind: p.kind, path: p.kind === "home" ? "/" : `/${p.slug}/` })),
    customPlugins: i.manifests.map((m) => ({ feature: m.feature, plugin: m.plugin, postType: m.postType, block: m.block })),
    forms: i.spec.forms.filter((f) => i.forms[f.id]).map((f) => ({ id: f.id, name: f.name, gfId: i.forms[f.id].gfId })),
    articles: i.spec.blog.articles.map((a) => articleSlug(a.title)),
    qa: i.qa ? { urls: i.qa.totals.urls, reviewed: i.qa.totals.reviewed, remainingIssues: i.qa.totals.remainingIssues, report: QA_REPORT_MD } : null,
    costUsd: i.ctx.state.costUsd,
    files: i.files,
  };
}
