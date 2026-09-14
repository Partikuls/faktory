import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { runWp, wpJson, wpOk } from "../../src/wp.js";
import { artifactPath } from "../../src/artifacts.js";
import { FOOTER_ELEMENT_SLUG } from "../../src/provision/footer.js";
import { BLOG_HERO_SLUG, BLOG_LOOP_SLUG, POST_HERO_SLUG } from "../../src/provision/blog.js";

describe.skipIf(!process.env.FAKTORY_DOCKER)("provision with spec + tokens (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8193 };
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
    expect(s1.stages.provision.message).toMatch(/fr_FR packs: ok; 6 pages \+ primary menu; tokens applied; child theme styles; footer element #\d+; blog elements #\d+ #\d+ #\d+/);
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
    expect(elements.map((e) => e.post_name).sort()).toEqual([BLOG_HERO_SLUG, BLOG_LOOP_SLUG, FOOTER_ELEMENT_SLUG, POST_HERO_SLUG].sort());

    const html = await (await fetch(`http://localhost:${ctx.state.port}/`)).text();
    expect(html).toContain("© " + new Date().getFullYear() + " Maison Rivet");
    expect(html).toContain("--accent:#7a8b6f");
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("Fraunces");
    expect(html).toMatch(/<nav[^>]*class="[^"]*main-navigation/);
    expect(html).toContain("/nos-produits/");

    const base = `http://localhost:${ctx.state.port}`;
    const gpOption = async (key: string) => wpOk(ctx, ["eval", `echo generate_get_option( '${key}' );`]);
    expect(await gpOption("structure")).toBe("flexbox");
    expect(await wpOk(ctx, ["option", "get", "generate_db_version"])).toMatch(/^3\./);
    expect(html).toMatch(/font-family:[^;}]*Fraunces/);
    expect(html).toMatch(/font-family:[^;}]*Source Sans 3/);
    expect(html).not.toContain("#efefef");
    expect(html).not.toContain("#1e73be");

    expect((await runWp(ctx, ["language", "theme", "is-installed", "generatepress", "fr_FR"])).code).toBe(0);
    const gf = await wpOk(ctx, ["eval", "echo wp_json_encode( apply_filters( 'gform_default_styles', false ) );"]);
    expect(JSON.parse(gf)).toMatchObject({ theme: "orbital", inputPrimaryColor: "#7a8b6f" });
    expect((await runWp(ctx, ["eval", "echo 1;"])).code).toBe(0); // child theme functions.php loads

    await wpOk(ctx, ["post", "generate", "--count=10", "--post_type=post", "--post_status=publish"]);
    const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
    const blog = await (await fetch(`${base}/actualites/`)).text();
    expect(count(blog, /<h1[\s>]/g)).toBe(1);
    expect(count(blog, /class="gb-loop-item gb-loop-item-/g)).toBe(9);
    expect(blog).toContain(`${base}/actualites/page/2/`);
    expect(blog).not.toContain('class="byline"');
    const page2 = await (await fetch(`${base}/actualites/page/2/`)).text();
    expect(count(page2, /class="gb-loop-item gb-loop-item-/g)).toBe(1);
    const postUrl = (await wpJson<{ url: string }[]>(ctx, ["post", "list", "--post_type=post", "--posts_per_page=1", "--fields=url"]))[0].url;
    const post = await (await fetch(postUrl)).text();
    expect(count(post, /<h1[\s>]/g)).toBe(1);
    expect(post).not.toContain('class="byline"');
    const categoryUrl = (await wpJson<{ url: string }[]>(ctx, ["term", "list", "category", "--fields=url"]))[0].url;
    const category = await (await fetch(categoryUrl)).text();
    expect(count(category, /<h1[\s>]/g)).toBe(1);
    expect(count(category, /class="gb-loop-item gb-loop-item-/g)).toBeGreaterThanOrEqual(1);

    // Repair: simulate the phase 7 legacy state, let GP migrate it on a page load, then provision again.
    await wpOk(ctx, ["option", "delete", "generate_db_version"]);
    await wpOk(ctx, ["option", "update", "generate_settings", "--format=json"], { input: JSON.stringify({ background_color: "#efefef" }) });
    await fetch(`${base}/`);
    expect(await gpOption("structure")).toBe("floats");

    const s2 = await runSite(config, "itchrome", { only: "provision" });
    expect(s2.stages.provision.status).toBe("done");
    expect(await gpOption("structure")).toBe("flexbox");
    const repaired = await (await fetch(`${base}/`)).text();
    expect(repaired).not.toContain("#efefef");
    expect(repaired).toMatch(/font-family:[^;}]*Fraunces/);
    const elements2 = await wpJson<{ post_name: string }[]>(ctx, ["post", "list", "--post_type=gp_elements", "--fields=post_name"]);
    expect(elements2).toHaveLength(4);
    const pages2 = await wpJson<{ post_name: string }[]>(ctx, ["post", "list", "--post_type=page", "--fields=post_name"]);
    expect(pages2).toHaveLength(6);
  });
});
