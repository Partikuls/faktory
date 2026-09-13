import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SiteContext } from "./docker.js";

export const ARTIFACTS = {
  brief: "brief.md",
  siteSpecJson: "site-spec.json",
  siteSpecMd: "SITE-SPEC.md",
  designSystemMd: "design-system.md",
  designTokensJson: "design-tokens.json",
  previewHtml: "preview.html",
  previewTree: "design/preview.gb.json",
  previewMarkup: "design/preview.gb.html",
} as const;
export type ArtifactKey = keyof typeof ARTIFACTS;

const PRODUCER: Partial<Record<ArtifactKey, string>> = {
  siteSpecJson: "spec", siteSpecMd: "spec", designSystemMd: "design", designTokensJson: "design", previewHtml: "design",
};

export function artifactPath(ctx: SiteContext, key: ArtifactKey): string {
  return join(ctx.siteDir, ARTIFACTS[key]);
}

export function hasArtifact(ctx: SiteContext, key: ArtifactKey): boolean {
  return existsSync(artifactPath(ctx, key));
}

export function readJsonArtifact<T>(ctx: SiteContext, key: ArtifactKey, parse: (u: unknown) => T): T {
  const p = artifactPath(ctx, key);
  if (!existsSync(p)) {
    const hint = PRODUCER[key] ? ` — run the ${PRODUCER[key]} stage first (faktory run ${ctx.slug} --only ${PRODUCER[key]})` : "";
    throw new Error(`${ARTIFACTS[key]} not found in ${ctx.siteDir}${hint}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(p, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${ARTIFACTS[key]} is not valid JSON: ${message}`);
  }
  return parse(data);
}

export function writeJsonArtifact(ctx: SiteContext, key: ArtifactKey, data: unknown): void {
  const p = artifactPath(ctx, key);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

export function writeTextArtifact(ctx: SiteContext, key: ArtifactKey, text: string): void {
  const p = artifactPath(ctx, key);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text.endsWith("\n") ? text : text + "\n");
}

/** True when the human-editable markdown was modified after its JSON twin (1 s tolerance for fs timestamp granularity). */
export function isStale(ctx: SiteContext, mdKey: ArtifactKey, jsonKey: ArtifactKey): boolean {
  const md = artifactPath(ctx, mdKey), json = artifactPath(ctx, jsonKey);
  if (!existsSync(md) || !existsSync(json)) return false;
  return statSync(md).mtimeMs > statSync(json).mtimeMs + 1000;
}
