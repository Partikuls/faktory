import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { run } from "../../src/exec.js";
import { artifactPath, pageTreePath } from "../../src/artifacts.js";
import { articlePath, articleSlug, type Article } from "../../src/schemas/article.js";
import { featureMarker, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type GbNode, type PageTree } from "../../src/schemas/page-tree.js";
import { SITE_URL_PLACEHOLDER } from "../../src/export/db.js";
import { deps as pagesDeps } from "../../src/stages/pages.js";
import { deps as contentDeps } from "../../src/stages/content.js";
import type { Page } from "../../src/schemas/site-spec.js";
import type { SiteContext } from "../../src/docker.js";

const FIXTURE_ARTICLE = "fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json";
const RESTORE_PORT = 8199;
const PROJECT = "faktory-itrestore";

function stubTree(page: Page): PageTree {
  return page.sections.map((s, i): GbNode => ({
    type: "element", tagName: "section", htmlAttributes: { id: `s-${i}` }, styles: { padding: "48px 24px" },
    innerBlocks: [
      { type: "text", tagName: i === 0 ? "h1" : "h2", content: s.heading },
      { type: "text", tagName: "p", content: s.summary },
      ...(s.type === "custom-query" && s.feature
        ? [{ type: "element", tagName: "div", htmlAttributes: { [FEATURE_WRAPPER_ATTR]: s.feature }, innerBlocks: [{ type: "text", tagName: "p", content: "Exemple" }, { type: "raw", rawMarkup: featureMarker(s.feature) }] } satisfies GbNode]
        : []),
      ...((s.type === "form" || s.type === "contact") && s.form && !page.sections.slice(0, i).some((x) => x.form === s.form)
        ? [{ type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: s.form }, innerBlocks: [{ type: "raw", rawMarkup: formMarker(s.form) }, { type: "text", tagName: "p", content: "Le formulaire sera disponible ici." }] } satisfies GbNode]
        : []),
    ] satisfies GbNode[],
  }));
}

/** `docker compose` in the restore dir with the exported file; env from its .env. */
const compose = (dir: string, ...args: string[]) => run("docker", ["compose", "-p", PROJECT, "-f", join(dir, "docker-compose.prod.yml"), "--env-file", join(dir, ".env"), ...args], { cwd: dir });
const wp = (dir: string, args: string[], input?: string) =>
  run("docker", ["compose", "-p", PROJECT, "-f", join(dir, "docker-compose.prod.yml"), "--env-file", join(dir, ".env"), "exec", "-T", "wpcli", "wp", ...args], { cwd: dir, input });

describe.skipIf(!process.env.FAKTORY_DOCKER)("export stage and restore on a throwaway site (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8198 };
  const restoreDir = mkdtempSync(join(tmpdir(), "faktory-restore-"));
  let ctx: SiteContext;
  const fixture = (): Article => JSON.parse(readFileSync(FIXTURE_ARTICLE, "utf8"));
  beforeAll(async () => {
    await initSite(config, { slug: "itexport", briefPath: "fixtures/briefs/boulangerie.md" });
    ctx = loadContext(config, "itexport");
    copyFileSync("fixtures/specs/boulangerie.site-spec.json", artifactPath(ctx, "siteSpecJson"));
    copyFileSync("fixtures/specs/boulangerie.design-tokens.json", artifactPath(ctx, "designTokensJson"));
    writeFileSync(artifactPath(ctx, "designSystemMd"), "# Maison Rivet — Design System Web\n");
    const p = await runSite(config, "itexport", { only: "provision" });
    expect(p.stages.provision.status, p.stages.provision.message).toBe("done");
    vi.spyOn(pagesDeps, "generatePageTree").mockImplementation(async (c, _spec, page) => {
      const tree = stubTree(page);
      writeFileSync(pageTreePath(c, page.slug), JSON.stringify(tree, null, 2));
      return { tree, costUsd: 0, attempts: 1 as const };
    });
    expect((await runSite(config, "itexport", { only: "pages" })).stages.pages.status).toBe("done");
    vi.spyOn(contentDeps, "generateArticle").mockImplementation(async (c, _s, article) => {
      const slug = articleSlug(article.title);
      const a: Article = { ...fixture(), title: article.title, category: article.theme };
      mkdirSync(dirname(articlePath(c, slug)), { recursive: true });
      writeFileSync(articlePath(c, slug), JSON.stringify(a, null, 2));
      return { article: a, slug, costUsd: 0, attempts: 1 as const };
    });
    expect((await runSite(config, "itexport", { only: "content" })).stages.content.status).toBe("done");
  }, 600_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    await compose(restoreDir, "down", "-v");
    rmSync(restoreDir, { recursive: true, force: true });
    await destroySite(config, "itexport");
  });

  it("writes dist/ with a placeholder-only dump and a complete archive", async () => {
    const state = await runSite(config, "itexport", { only: "export" });
    expect(state.stages.export.status, state.stages.export.message).toBe("done");
    expect(state.stages.export.message).toMatch(/^dist\/: db\.sql \([\d.]+ [kM]B\), wp-content\.tar\.gz \(\d+ MB\), docker-compose\.prod\.yml, \.env\.example, README\.md, MANIFEST\.json$/);
    const dist = join(ctx.siteDir, "dist");
    const sql = readFileSync(join(dist, "db.sql"), "utf8");
    // `wp search-replace --export` formats INSERT tuples with a space after each comma (unlike plain `wp db export`).
    expect(sql).toContain(`'siteurl', '${SITE_URL_PLACEHOLDER}'`);
    expect(sql).not.toContain(`localhost:${ctx.state.port}`);
    const manifest = JSON.parse(readFileSync(join(dist, "MANIFEST.json"), "utf8"));
    expect(manifest.wordpress).toMatch(/^\d+\.\d+/);
    expect(manifest.theme.generatepress).toMatch(/^\d+\.\d+/);
    expect(manifest.plugins.map((p: any) => p.name)).toContain("gravityforms");
    expect(manifest.forms.map((f: any) => f.id).sort()).toEqual(["contact", "devis_evenement"]);
    expect(manifest.articles).toHaveLength(3);
    expect(manifest.qa).toBeNull();
    const listing = (await run("tar", ["-tzf", join(dist, "wp-content.tar.gz")])).stdout;
    expect(listing).toContain("wp-content/themes/faktory-itexport/style.css");
    expect(listing).not.toContain("twentytwentyfive");
    // the live site is untouched
    const home = await (await fetch(`http://localhost:${ctx.state.port}/`)).text();
    expect(home).toContain("gb-element-");
  }, 600_000);

  it("restores dist/ into a fresh stack from the exported compose file and the site renders", async () => {
    const dist = join(ctx.siteDir, "dist");
    cpSync(dist, restoreDir, { recursive: true });
    writeFileSync(join(restoreDir, ".env"), `SITE_PORT=${RESTORE_PORT}\nDB_PASSWORD=wordpress\nDB_ROOT_PASSWORD=root\n`);
    const untar = await run("tar", ["-xzf", join(restoreDir, "wp-content.tar.gz"), "-C", restoreDir]);
    expect(untar.code, untar.stderr).toBe(0);
    expect(existsSync(join(restoreDir, "wp-content/themes/generatepress/style.css"))).toBe(true);
    const up = await compose(restoreDir, "up", "-d", "--wait");
    expect(up.code, up.stderr).toBe(0);
    // wp-config.php appears once the wordpress entrypoint has run: retry db check like waitForDb
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) { ready = (await wp(restoreDir, ["db", "check"])).code === 0; if (!ready) await new Promise((r) => setTimeout(r, 2000)); }
    expect(ready).toBe(true);
    const imp = await wp(restoreDir, ["db", "import", "-"], readFileSync(join(restoreDir, "db.sql"), "utf8"));
    expect(imp.code, imp.stderr).toBe(0);
    const url = `http://localhost:${RESTORE_PORT}`;
    for (const [from, to] of [[SITE_URL_PLACEHOLDER, url], [SITE_URL_PLACEHOLDER.replace(/\//g, "\\/"), url.replace(/\//g, "\\/")]]) {
      const sr = await wp(restoreDir, ["search-replace", from, to, "--all-tables-with-prefix"]);
      expect(sr.code, sr.stderr).toBe(0);
    }
    expect((await wp(restoreDir, ["rewrite", "flush"])).code).toBe(0);
    const home = await fetch(`${url}/`);
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain("Maison Rivet");
    expect(html).toContain("gb-element-");
    expect(html).toContain("generateblocks-inline-css");
    const contact = await (await fetch(`${url}/contact/`)).text();
    expect(contact).toContain("gform_wrapper_");
    const article = await fetch(`${url}/${articleSlug("La galette des rois revient : frangipane ou pomme ?")}/`);
    expect(article.status).toBe(200);
  }, 600_000);
});
