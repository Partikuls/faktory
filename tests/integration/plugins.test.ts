import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { wpOk, wpJson } from "../../src/wp.js";
import { artifactPath, pageTreePath } from "../../src/artifacts.js";
import { manifestPath, pluginDirPath } from "../../src/schemas/plugin-manifest.js";
import { verifyPlugin } from "../../src/plugins/generate.js";
import { deps as pluginsDeps } from "../../src/stages/plugins.js";
import { deps as pagesDeps } from "../../src/stages/pages.js";
import { featureMarker, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type GbNode, type PageTree } from "../../src/schemas/page-tree.js";
import type { Page } from "../../src/schemas/site-spec.js";
import type { SiteContext } from "../../src/docker.js";

const FIXTURE = "fixtures/plugins/faktory-catalogue-produits";
const MANIFEST = "fixtures/plugins/catalogue_produits.manifest.json";

/** Same stand-in tree as tests/integration/pages.test.ts (wrapped markers). */
function stubTree(page: Page): PageTree {
  return page.sections.map((s, i): GbNode => ({
    type: "element", tagName: "section", htmlAttributes: { id: `s-${i}` },
    styles: { backgroundColor: i % 2 ? "var(--base-2)" : "var(--base)", padding: "48px 24px" },
    innerBlocks: [
      { type: "text", tagName: i === 0 ? "h1" : "h2", content: s.heading },
      { type: "text", tagName: "p", content: s.summary },
      ...(s.type === "custom-query" && s.feature
        ? [{ type: "element", tagName: "div", htmlAttributes: { [FEATURE_WRAPPER_ATTR]: s.feature },
             innerBlocks: [{ type: "text", tagName: "p", content: "Exemple de carte" }, { type: "raw", rawMarkup: featureMarker(s.feature) }] } satisfies GbNode]
        : []),
      ...((s.type === "form" || s.type === "contact") && s.form
        ? [{ type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: s.form },
             innerBlocks: [{ type: "raw", rawMarkup: formMarker(s.form) }, { type: "text", tagName: "p", content: "Le formulaire sera disponible ici." }] } satisfies GbNode]
        : []),
    ] satisfies GbNode[],
  }));
}

/** What the agent would do: copy the reference plugin + manifest, activate, seed 4 entries with meta, terms and (no) image. */
async function actAsAgent(ctx: SiteContext): Promise<void> {
  cpSync(FIXTURE, pluginDirPath(ctx, "catalogue_produits"), { recursive: true });
  copyFileSync(MANIFEST, manifestPath(ctx, "catalogue_produits"));
  await wpOk(ctx, ["plugin", "activate", "faktory-catalogue-produits"]);
  const seed: [string, string, string, string, string][] = [
    ["Tourte de meule", "Levain naturel, farine T80.", "4.80", "Tous les jours", "1"],
    ["Baguette tradition", "Croûte fine, mie crème.", "1.30", "Tous les jours", "1"],
    ["Croissant pur beurre", "Feuilletage 27 couches.", "1.40", "Week-end", ""],
    ["Tarte de saison", "Fruits du marché.", "18.00", "Sur commande", ""],
  ];
  const cats = ["Pains", "Pains", "Viennoiseries", "Pâtisseries"];
  for (const [i, [title, content, prix, dispo, featured]] of seed.entries()) {
    const id = await wpOk(ctx, ["post", "create", "--post_type=produit", "--post_status=publish", `--post_title=${title}`, `--post_content=${content}`, "--porcelain"]);
    await wpOk(ctx, ["post", "meta", "update", id, "_produit_prix", prix]);
    await wpOk(ctx, ["post", "meta", "update", id, "_produit_disponibilite", dispo]);
    if (featured) await wpOk(ctx, ["post", "meta", "update", id, "_produit_mis_en_avant", featured]);
    await wpOk(ctx, ["post", "term", "set", id, "categorie_produit", cats[i]]);
  }
}

describe.skipIf(!process.env.FAKTORY_DOCKER)("plugins stage on a throwaway site (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8195 };
  let ctx: SiteContext;
  beforeAll(async () => {
    await initSite(config, { slug: "itplugins", briefPath: "fixtures/briefs/boulangerie.md" });
    ctx = loadContext(config, "itplugins");
    copyFileSync("fixtures/specs/boulangerie.site-spec.json", artifactPath(ctx, "siteSpecJson"));
    copyFileSync("fixtures/specs/boulangerie.design-tokens.json", artifactPath(ctx, "designTokensJson"));
    writeFileSync(artifactPath(ctx, "designSystemMd"), "# Maison Rivet — Design System Web\n");
    const p = await runSite(config, "itplugins", { only: "provision" });
    expect(p.stages.provision.status, p.stages.provision.message).toBe("done");
    // pages stage with stub trees (no agent) so accueil and nos-produits exist with their wrappers
    vi.spyOn(pagesDeps, "generatePageTree").mockImplementation(async (c, _spec, page) => {
      const tree = stubTree(page);
      writeFileSync(pageTreePath(c, page.slug), JSON.stringify(tree, null, 2));
      return { tree, costUsd: 0, attempts: 1 as const };
    });
    const pg = await runSite(config, "itplugins", { only: "pages" });
    expect(pg.stages.pages.status, pg.stages.pages.message).toBe("done");
  }, 600_000);
  afterAll(async () => { vi.restoreAllMocks(); await destroySite(config, "itplugins"); });

  it("generates (stubbed agent), verifies for real, integrates, and renders the block on both pages", async () => {
    const gen = vi.spyOn(pluginsDeps, "generatePlugin").mockImplementation(async (c, spec, feature) => {
      await actAsAgent(c);
      const v = await verifyPlugin(c, spec, feature); // the real checks: files, php_check, wp plugin/post-type/post/term lists
      return { ...v, costUsd: 0, attempts: 1 as const };
    });
    const state = await runSite(config, "itplugins", { only: "plugins" });
    expect(state.stages.plugins.status, state.stages.plugins.message).toBe("done");
    expect(state.stages.plugins.message).toContain("faktory-catalogue-produits (produit, 4 entries, 2 pages updated)");
    expect(state.stages.plugins.message).toContain("1 generated, 0 reused");
    expect(gen).toHaveBeenCalledTimes(1);

    const home = await (await fetch(`http://localhost:${ctx.state.port}/`)).text();
    expect(home).toContain('data-faktory-plugin="catalogue_produits"');
    expect(home).toContain("faktory-catalogue-produits--featured");
    expect(home).toContain("Tourte de meule");
    expect(home).not.toContain("Exemple de carte");
    expect(home).not.toContain("faktory:feature:");
    const grid = await (await fetch(`http://localhost:${ctx.state.port}/nos-produits/`)).text();
    expect(grid).toContain("faktory-catalogue-produits--grid");
    expect(grid).toContain('aria-label="Filtrer par catégorie"');
    expect(grid).toContain("Croissant pur beurre");
    const filtered = await (await fetch(`http://localhost:${ctx.state.port}/nos-produits/?categorie_produit=pains`)).text();
    expect(filtered).toContain("Tourte de meule");
    expect(filtered).not.toContain("Croissant pur beurre");
    expect(grid).toContain("faktory-catalogue-produits/style.css"); // block style enqueued

    // the tree on disk still carries the placeholder wrapper (compile-time substitution)
    expect(readFileSync(pageTreePath(ctx, "accueil"), "utf8")).toContain(FEATURE_WRAPPER_ATTR);
    // admin side: CPT registered with the 4 terms
    const terms = await wpJson<{ name: string }[]>(ctx, ["term", "list", "categorie_produit", "--fields=name"]);
    expect(terms.map((t) => t.name).sort()).toEqual(["Pains", "Pâtisseries", "Salé du midi", "Viennoiseries"]);
  });

  it("reuses the plugin on a second run (no agent) and the pages stage keeps the block", async () => {
    const gen = vi.spyOn(pluginsDeps, "generatePlugin").mockRejectedValue(new Error("must not be called"));
    const state = await runSite(config, "itplugins", { only: "plugins" });
    expect(state.stages.plugins.status, state.stages.plugins.message).toBe("done");
    expect(state.stages.plugins.message).toContain("0 generated, 1 reused");
    expect(gen).not.toHaveBeenCalled();
    const pg = await runSite(config, "itplugins", { only: "pages" });
    expect(pg.stages.pages.message).toContain("plugins applied (catalogue_produits)");
    const home = await (await fetch(`http://localhost:${ctx.state.port}/`)).text();
    expect(home).toContain('data-faktory-plugin="catalogue_produits"');
    expect(existsSync(pluginDirPath(ctx, "catalogue_produits"))).toBe(true);
  });
});
