import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Stage } from "../pipeline.js";
import { readJsonArtifact, DIST_DIR } from "../artifacts.js";
import { readFormsManifest, readPluginManifests } from "../pages/placements.js";
import { VENDOR_PLUGINS } from "../provision/stack.js";
import { exportDb } from "../export/db.js";
import { assertTarEntries, bundleWpContent, listTar, requiredTarEntries } from "../export/bundle.js";
import { envExample, fmtSize, prodCompose, restoreReadme } from "../export/templates.js";
import { buildManifest, gatherVersions } from "../export/manifest.js";
import { parseSiteSpec } from "../schemas/site-spec.js";
import { readQaReport } from "../schemas/qa.js";
import { articleSlug } from "../schemas/article.js";

export const deps = { exportDb, bundleWpContent, listTar, gatherVersions };
export const DIST_FILES = ["db.sql", "wp-content.tar.gz", "docker-compose.prod.yml", ".env.example", "README.md", "MANIFEST.json"] as const;

export const exportStage: Stage = {
  name: "export",
  async run(ctx) {
    const spec = readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec);
    const manifests = readPluginManifests(ctx);
    const forms = readFormsManifest(ctx);
    const qa = readQaReport(ctx);
    const dist = join(ctx.siteDir, DIST_DIR);
    rmSync(dist, { recursive: true, force: true });
    mkdirSync(dist, { recursive: true });

    // 1. database (decision 13) — first: it is the step most likely to fail, and nothing else is worth doing without it
    const db = await deps.exportDb(ctx);
    writeFileSync(join(dist, "db.sql"), db.sql);
    console.log(`  ✔ db.sql (${fmtSize(db.bytes)})`);

    // 2. wp-content (decision 14)
    const tar = join(dist, "wp-content.tar.gz");
    const tarBytes = await deps.bundleWpContent(ctx, tar);
    assertTarEntries(await deps.listTar(tar), requiredTarEntries(ctx, manifests));
    console.log(`  ✔ wp-content.tar.gz (${fmtSize(tarBytes)})`);

    // 3. stack + runbook (decisions 15, 16)
    writeFileSync(join(dist, "docker-compose.prod.yml"), prodCompose());
    writeFileSync(join(dist, ".env.example"), envExample());
    writeFileSync(join(dist, "README.md"), restoreReadme({
      slug: ctx.slug, name: spec.identity.name,
      customPlugins: manifests.map((m) => ({ plugin: m.plugin, postType: m.postType })),
      forms: spec.forms.filter((f) => forms[f.id]).map((f) => ({ id: f.id, name: f.name, gfId: forms[f.id].gfId })),
      articles: spec.blog.articles.map((a) => articleSlug(a.title)),
      vendorPlugins: VENDOR_PLUGINS.map((v) => v.slug),
    }));

    // 4. manifest (decision 17) — sizes of everything written so far
    const versions = await deps.gatherVersions(ctx);
    const files: Record<string, number> = {};
    for (const f of DIST_FILES) if (f !== "MANIFEST.json") files[f] = statSync(join(dist, f)).size;
    const manifest = buildManifest({ ctx, spec, versions, manifests, forms, qa, files, generatedAt: new Date().toISOString() });
    writeFileSync(join(dist, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");

    return `${DIST_DIR}/: db.sql (${fmtSize(db.bytes)}), wp-content.tar.gz (${fmtSize(tarBytes)}), docker-compose.prod.yml, .env.example, README.md, MANIFEST.json`;
  },
};
