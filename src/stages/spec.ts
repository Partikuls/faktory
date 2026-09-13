import type { Stage } from "../pipeline.js";
import { runAgent } from "../agent.js";
import { writeJsonArtifact, writeTextArtifact } from "../artifacts.js";
import { loadPrompt } from "../prompts.js";
import { toJsonSchema } from "../schemas/json-schema.js";
import { SiteSpecShape, parseSiteSpec } from "../schemas/site-spec.js";
import { renderSiteSpecMarkdown } from "../render/site-spec-md.js";
import { resyncFromMarkdown, SPEC_RESYNC } from "../resync.js";

export const deps = { runAgent };

export const specStage: Stage = {
  name: "spec",
  checkpoint: true,
  async run(ctx) {
    const r = await deps.runAgent(ctx, {
      stage: "spec",
      systemPrompt: loadPrompt("spec"),
      prompt: "Lis `brief.md` puis produis la spécification structurée du site.",
      allowedTools: ["Read"],
      outputFormat: { type: "json_schema", schema: toJsonSchema(SiteSpecShape) },
      maxTurns: 12,
    });
    const spec = parseSiteSpec(r.structured);
    writeTextArtifact(ctx, "siteSpecMd", renderSiteSpecMarkdown(spec));
    writeJsonArtifact(ctx, "siteSpecJson", spec); // written last so the JSON is never older than the markdown
    return `SITE-SPEC.md written: ${spec.sitemap.length} pages, ${spec.features.length} feature${spec.features.length === 1 ? "" : "s"}, ${spec.forms.length} forms — $${r.costUsd.toFixed(2)}`;
  },
  async onApprove(ctx) {
    const s = await resyncFromMarkdown(ctx, SPEC_RESYNC);
    return s ? `approved; site-spec.json re-synced from edited SITE-SPEC.md (${s.sitemap.length} pages)` : undefined;
  },
};
