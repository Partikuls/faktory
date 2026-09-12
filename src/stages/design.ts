import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Stage } from "../pipeline.js";
import { runAgent } from "../agent.js";
import { ARTIFACTS, artifactPath, hasArtifact, readJsonArtifact, writeJsonArtifact, writeTextArtifact } from "../artifacts.js";
import { gbBuild, gbPreview, previewOptionsFromTokens } from "../gb.js";
import { designSystemPrompt } from "../prompts.js";
import { toJsonSchema } from "../schemas/json-schema.js";
import { DesignTokensShape, parseDesignTokens } from "../schemas/design-tokens.js";
import { parseSiteSpec, type SiteSpec } from "../schemas/site-spec.js";
import { resyncFromMarkdown } from "../resync.js";
import { TOOL_GB_BUILD, TOOL_GB_PREVIEW } from "../tools/server.js";

export const deps = { runAgent, gbBuild, gbPreview };

export function designUserPrompt(spec: SiteSpec): string {
  const home = spec.sitemap.find((p) => p.kind === "home") ?? spec.sitemap[0];
  return [
    `Site : ${spec.identity.name} — ${spec.identity.sector}${spec.identity.location ? ` (${spec.identity.location})` : ""}.`,
    `Ton : ${spec.identity.tone}. Accroche : ${spec.identity.tagline}.`,
    `Pages : ${spec.sitemap.map((p) => `${p.slug} [${p.kind}]`).join(", ")}.`,
    `Sections de la page d'accueil (\`${home.slug}\`) : ${home.sections.map((s) => `${s.type} « ${s.heading} »`).join(" ; ")}.`,
    "",
    "Lis `site-spec.json` et `brief.md`, puis produis `design-system.md`, `design/preview.gb.json` → gb_build → gb_preview → `preview.html`, et termine par les tokens structurés.",
  ].join("\n");
}

export const designStage: Stage = {
  name: "design",
  checkpoint: true,
  async run(ctx) {
    const spec = readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec);
    mkdirSync(join(ctx.siteDir, "design"), { recursive: true });
    const r = await deps.runAgent(ctx, {
      stage: "design",
      systemPrompt: designSystemPrompt(ctx.config),
      prompt: designUserPrompt(spec),
      allowedTools: ["Read", "Write", TOOL_GB_BUILD, TOOL_GB_PREVIEW],
      outputFormat: { type: "json_schema", schema: toJsonSchema(DesignTokensShape) },
      maxTurns: 40,
    });
    const tokens = parseDesignTokens(r.structured);
    for (const key of ["designSystemMd", "previewTree"] as const) {
      if (!hasArtifact(ctx, key)) throw new Error(`design stage ended without writing ${ARTIFACTS[key]} — re-run with: faktory run ${ctx.slug} --only design`);
    }
    const tree = readJsonArtifact(ctx, "previewTree", (u) => u);
    const markup = await deps.gbBuild(ctx.config, tree);
    writeTextArtifact(ctx, "previewMarkup", markup);
    await deps.gbPreview(ctx.config, artifactPath(ctx, "previewMarkup"), artifactPath(ctx, "previewHtml"), previewOptionsFromTokens(tokens));
    writeJsonArtifact(ctx, "designTokensJson", tokens); // last: never older than design-system.md
    return `design-system.md, design-tokens.json and preview.html written (open ${artifactPath(ctx, "previewHtml")}) — $${r.costUsd.toFixed(2)}`;
  },
  async onApprove(ctx) {
    const t = await resyncFromMarkdown(ctx, { mdKey: "designSystemMd", jsonKey: "designTokensJson", shape: DesignTokensShape, parse: parseDesignTokens, what: "les design tokens" });
    if (!t) return undefined;
    if (hasArtifact(ctx, "previewMarkup")) await deps.gbPreview(ctx.config, artifactPath(ctx, "previewMarkup"), artifactPath(ctx, "previewHtml"), previewOptionsFromTokens(t));
    return "approved; design-tokens.json re-synced from edited design-system.md";
  },
};
