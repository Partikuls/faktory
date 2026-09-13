import { existsSync } from "node:fs";
import type { Stage } from "../pipeline.js";
import { assertBudget } from "../budget.js";
import { readJsonArtifact } from "../artifacts.js";
import { ensurePages } from "../provision/pages.js";
import { generatePlugin, verifyPlugin } from "../plugins/generate.js";
import { integratePlugin } from "../plugins/integrate.js";
import { parseSiteSpec } from "../schemas/site-spec.js";
import { manifestPath, pluginDirPath } from "../schemas/plugin-manifest.js";

export const deps = { ensurePages, generatePlugin, verifyPlugin, integratePlugin };

export const pluginsStage: Stage = {
  name: "plugins",
  async run(ctx) {
    const spec = readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec);
    if (!spec.features.length) return "no features in site-spec.json: nothing to do";
    const ids = await deps.ensurePages(ctx, spec);
    const generated: string[] = [], reused: string[] = [], failed: string[] = [], summaries: string[] = [];
    let cost = 0;

    // Features run one at a time (spec decision 2): few per site, long agents, no budget split needed.
    for (const feature of spec.features) {
      try {
        let manifest, entries: number;
        if (existsSync(manifestPath(ctx, feature.id)) && existsSync(pluginDirPath(ctx, feature.id))) {
          ({ manifest, entries } = await deps.verifyPlugin(ctx, spec, feature));
          reused.push(feature.id);
        } else {
          assertBudget(ctx.config, ctx.state);
          const g = await deps.generatePlugin(ctx, spec, feature);
          manifest = g.manifest; entries = g.entries; cost += g.costUsd; generated.push(feature.id);
        }
        const { pages, skipped } = await deps.integratePlugin(ctx, spec, manifest, ids);
        const waiting = skipped.length ? `, ${skipped.length} waiting for the pages stage` : "";
        summaries.push(`${manifest.plugin} (${manifest.postType}, ${entries} entries, ${pages.length} pages updated${waiting})`);
        console.log(`  ✔ ${manifest.plugin} active, ${entries} entries, ${pages.length} page(s) updated`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("Cost budget reached")) throw err;
        failed.push(feature.id);
        console.error(`  ✖ ${feature.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failed.length) {
      throw new Error(`${failed.length} plugin(s) failed: ${failed.join(", ")} — fix or delete plugins/<id>.json and re-run: faktory run ${ctx.slug} --only plugins`);
    }
    const n = spec.features.length;
    return `${n} plugin${n === 1 ? "" : "s"}: ${summaries.join("; ")}; ${generated.length} generated, ${reused.length} reused — $${cost.toFixed(2)}`;
  },
};
