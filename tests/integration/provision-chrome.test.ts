import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { wpJson, wpOk } from "../../src/wp.js";
import { artifactPath } from "../../src/artifacts.js";
import { FOOTER_ELEMENT_SLUG } from "../../src/provision/footer.js";

describe.skipIf(!process.env.FAKTORY_DOCKER)("provision with spec + tokens (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8191 };
  beforeAll(async () => {
    await initSite(config, { slug: "itchrome", briefPath: "fixtures/briefs/boulangerie.md" });
    const ctx = loadContext(config, "itchrome");
    copyFileSync("fixtures/specs/boulangerie.site-spec.json", artifactPath(ctx, "siteSpecJson"));
    copyFileSync("fixtures/specs/boulangerie.design-tokens.json", artifactPath(ctx, "designTokensJson"));
  });
  afterAll(async () => { await destroySite(config, "itchrome"); });

  it("applies identity, pages, menu, tokens and the footer element, idempotently", async () => {
    const s1 = await runSite(config, "itchrome", { only: "provision" });
    expect(s1.stages.provision.status, s1.stages.provision.message).toBe("done");
    expect(s1.stages.provision.message).toMatch(/6 pages \+ primary menu; tokens applied; footer element #\d+/);
    const ctx = loadContext(config, "itchrome");

    expect(await wpOk(ctx, ["option", "get", "blogname"])).toBe("Maison Rivet");
    const pages = await wpJson<{ post_name: string; post_status: string }[]>(ctx, ["post", "list", "--post_type=page", "--fields=post_name,post_status"]);
    expect(pages.map((p) => p.post_name).sort()).toEqual(["accueil", "actualites", "commandes-evenements", "contact", "la-maison", "nos-produits"]);
    expect(await wpOk(ctx, ["option", "get", "show_on_front"])).toBe("page");
    const locations = await wpJson<{ location: string; name: string }[]>(ctx, ["menu", "location", "list"]);
    // `wp menu location list` shows assigned menus via `wp menu list`:
    const menus = await wpJson<{ name: string; locations: string[]; count: number }[]>(ctx, ["menu", "list", "--fields=name,locations,count"]);
    expect(menus.find((m) => m.name === "Principal")).toMatchObject({ locations: ["primary"], count: 6 });
    expect(locations.some((l) => l.location === "primary")).toBe(true);

    const settings = await wpJson<{ global_colors: { slug: string; color: string }[]; container_width: string; typography: { selector: string }[] }>(ctx, ["option", "get", "generate_settings"]);
    expect(settings.global_colors.find((c) => c.slug === "accent")?.color).toBe("#7a8b6f");
    expect(settings.container_width).toBe("1140");
    expect(settings.typography.map((r) => r.selector)).toContain("h1");

    const elements = await wpJson<{ post_name: string }[]>(ctx, ["post", "list", "--post_type=gp_elements", "--fields=post_name"]);
    expect(elements.map((e) => e.post_name)).toEqual([FOOTER_ELEMENT_SLUG]);

    const html = await (await fetch(`http://localhost:${ctx.state.port}/`)).text();
    expect(html).toContain("© " + new Date().getFullYear() + " Maison Rivet");
    expect(html).toContain("--accent:#7a8b6f");
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("Fraunces");
    expect(html).toMatch(/<nav[^>]*class="[^"]*main-navigation/);
    expect(html).toContain("/nos-produits/");

    const s2 = await runSite(config, "itchrome", { only: "provision" });
    expect(s2.stages.provision.status).toBe("done");
    const elements2 = await wpJson<{ post_name: string }[]>(ctx, ["post", "list", "--post_type=gp_elements", "--fields=post_name"]);
    expect(elements2).toHaveLength(1);
    const pages2 = await wpJson<{ post_name: string }[]>(ctx, ["post", "list", "--post_type=page", "--fields=post_name"]);
    expect(pages2).toHaveLength(6);
  });
});
