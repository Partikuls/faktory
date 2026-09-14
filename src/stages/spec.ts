import type { Stage } from "../pipeline.js";
import { runAgent, runValidated } from "../agent.js";
import { readJsonArtifact, writeJsonArtifact, writeTextArtifact } from "../artifacts.js";
import { loadPrompt } from "../prompts.js";
import { toJsonSchema } from "../schemas/json-schema.js";
import { SiteSpecShape, parseSiteSpec } from "../schemas/site-spec.js";
import { renderSiteSpecMarkdown } from "../render/site-spec-md.js";
import { resyncFromMarkdown, SPEC_RESYNC } from "../resync.js";
import { findSpecGaps, gapWarning } from "../spec-gaps.js";

export const deps = { runAgent };

export const specStage: Stage = {
  name: "spec",
  checkpoint: true,
  async run(ctx) {
    const r = await runValidated(deps.runAgent, ctx, {
      stage: "spec",
      systemPrompt: loadPrompt("spec"),
      prompt: "Lis `brief.md` puis produis la spécification structurée du site.",
      allowedTools: ["Read"],
      outputFormat: { type: "json_schema", schema: toJsonSchema(SiteSpecShape) },
      maxTurns: 12,
    }, (a) => parseSiteSpec(a.structured));
    const spec = r.value;
    writeTextArtifact(ctx, "siteSpecMd", renderSiteSpecMarkdown(spec));
    writeJsonArtifact(ctx, "siteSpecJson", spec); // written last so the JSON is never older than the markdown
    const gaps = findSpecGaps(spec).length;
    const gapPart = gaps ? `, ${gaps} information${gaps > 1 ? "s" : ""} à compléter` : "";
    return `SITE-SPEC.md written: ${spec.sitemap.length} pages, ${spec.features.length} feature${spec.features.length === 1 ? "" : "s"}, ${spec.forms.length} forms${gapPart} — $${r.costUsd.toFixed(2)}`;
  },
  async onApprove(ctx) {
    const s = await resyncFromMarkdown(ctx, SPEC_RESYNC);
    const gaps = findSpecGaps(s ?? readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec));
    if (gaps.length) console.warn(gapWarning(gaps));
    return s ? `approved; site-spec.json re-synced from edited SITE-SPEC.md (${s.sitemap.length} pages)` : undefined;
  },
};
