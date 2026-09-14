import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps } from "../../src/wp.js";
import { parseDesignTokens } from "../../src/schemas/design-tokens.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { buildGenerateSettings, applyTokens, applyIdentity } from "../../src/provision/settings.js";

const tokens = parseDesignTokens(JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8")));
const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };
type Rule = { selector: string; fontFamily: string; fontSize: number | ""; lineHeight: number | ""; fontWeight: string; fontSizeMobile: number | "" };

describe("buildGenerateSettings", () => {
  const s = buildGenerateSettings(tokens);
  it("maps the palette to the 8 GeneratePress global colors in GP order", () => {
    expect(s.global_colors).toEqual([
      { name: "Contrast", slug: "contrast", color: "#2b1d0e" }, { name: "Contrast 2", slug: "contrast-2", color: "#6b5a46" }, { name: "Contrast 3", slug: "contrast-3", color: "#d9cdb8" },
      { name: "Base", slug: "base", color: "#faf6ef" }, { name: "Base 2", slug: "base-2", color: "#f1e8d8" }, { name: "Base 3", slug: "base-3", color: "#ffffff" },
      { name: "Accent", slug: "accent", color: "#7a8b6f" }, { name: "Accent 2", slug: "accent-2", color: "#c89b3c" },
    ]);
  });
  it("registers both Google fonts once and writes typography rules with GP's full key set", () => {
    expect(s.font_manager).toEqual([
      { fontFamily: "Fraunces", googleFont: true, googleFontCategory: "serif", googleFontVariants: "400,600,700" },
      { fontFamily: "Source Sans 3", googleFont: true, googleFontCategory: "sans-serif", googleFontVariants: "400,600" },
    ]);
    const rules = s.typography as Rule[];
    const by = (sel: string) => rules.find((r) => r.selector === sel)!;
    expect(by("body")).toMatchObject({ fontFamily: "Source Sans 3", fontSize: 18, lineHeight: 1.6, fontSizeUnit: "px", lineHeightUnit: "" });
    expect(by("all-headings")).toMatchObject({ fontFamily: "Fraunces", fontWeight: "600", lineHeight: 1.15 });
    expect(by("h1")).toMatchObject({ fontSize: 52, fontSizeMobile: 34 });
    expect(by("h4").fontSize).toBe(20);
    expect(by("main-title")).toMatchObject({ fontFamily: "Fraunces", fontSize: 26 });
    expect(by("primary-menu-items").fontFamily).toBe("Source Sans 3");
    expect(Object.keys(by("body"))).toContain("marginBottomUnit");
    expect(s.use_dynamic_typography).toBe(true);
  });
  it("sets layout keys for a block-built site", () => {
    expect(s).toMatchObject({ container_width: "1140", layout_setting: "no-sidebar", blog_layout_setting: "no-sidebar", single_layout_setting: "no-sidebar", content_layout_setting: "one-container", footer_widget_setting: "0", hide_tagline: true });
  });
  it("dedupes the font manager when heading and body share a family", () => {
    const one = buildGenerateSettings({ ...tokens, fonts: { heading: tokens.fonts.body, body: tokens.fonts.body } });
    expect(one.font_manager).toHaveLength(1);
  });
  it("tags every typography rule with module core, or GeneratePress drops it from the CSS", () => {
    for (const r of s.typography as { module: string }[]) expect(r.module).toBe("core");
  });
  it("forces the flexbox structure and svg icons so GP never renders in legacy mode", () => {
    expect(s).toMatchObject({ structure: "flexbox", icons: "svg", combine_css: true, dynamic_css_cache: true });
  });
  it("maps every component color to a palette variable, never a hex value", () => {
    expect(s).toMatchObject({
      background_color: "var(--base)", content_background_color: "var(--base)", text_color: "var(--contrast)",
      link_color: "var(--accent)", link_color_hover: "var(--contrast)",
      header_background_color: "var(--base-3)", navigation_background_color: "var(--base-3)",
      navigation_text_color: "var(--contrast)", navigation_text_hover_color: "var(--accent)", navigation_text_current_color: "var(--accent)",
      subnavigation_background_color: "var(--base-3)", subnavigation_text_color: "var(--contrast)",
      site_title_color: "var(--contrast)", site_tagline_color: "var(--contrast-2)",
      blog_post_title_color: "var(--contrast)", blog_post_title_hover_color: "var(--contrast-2)",
      entry_meta_text_color: "var(--contrast-2)", entry_meta_link_color: "var(--accent)",
      form_background_color: "var(--base-3)", form_text_color: "var(--contrast)", form_border_color: "var(--contrast-3)",
      form_button_background_color: "var(--accent)", form_button_background_color_hover: "var(--contrast)",
      form_button_text_color: "var(--base-3)", form_button_text_color_hover: "var(--base-3)",
      form_border_color_focus: "var(--accent)", form_background_color_focus: "var(--base-3)", form_text_color_focus: "var(--contrast)",
      footer_background_color: "var(--contrast)",
    });
    const { global_colors: _palette, ...rest } = s;
    expect(JSON.stringify(rest)).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});

describe("applyTokens / applyIdentity", () => {
  beforeEach(() => vi.restoreAllMocks());
  const calls = (spy: any) => spy.mock.calls.map((c: any[]) => ({ args: (c[2] as string[]).slice(1), input: (c[3] as { input?: string } | undefined)?.input }));
  it("stamps the GP version first, replaces the option without reading it, sets posts per page and clears the css cache", async () => {
    const spy = vi.spyOn(deps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      if (cmd.join(" ") === "wp theme get generatepress --field=version") return { stdout: "3.6.1\n", stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
    await applyTokens(ctx, tokens);
    const c = calls(spy);
    expect(c.map((x: any) => x.args.join(" "))).toEqual([
      "theme get generatepress --field=version",
      "option update generate_db_version 3.6.1",
      "option update generate_settings --format=json",
      "option update posts_per_page 9",
      "option update generate_dynamic_css_output ",
    ]);
    const written = JSON.parse(c[2].input!);
    expect(written).toEqual(buildGenerateSettings(tokens));
    expect(written.icons).toBe("svg");
  });
  it("refuses to write settings when the GeneratePress version cannot be read", async () => {
    vi.spyOn(deps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      if (cmd.join(" ") === "wp theme get generatepress --field=version") return { stdout: "", stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
    await expect(applyTokens(ctx, tokens)).rejects.toThrow(/GeneratePress version/);
  });
  it("applies the site name and tagline", async () => {
    const spy = vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "Success", stderr: "", code: 0 });
    await applyIdentity(ctx, spec);
    expect(calls(spy).map((x: any) => x.args)).toEqual([
      ["option", "update", "blogname", "Maison Rivet"],
      ["option", "update", "blogdescription", "Pain au levain et pâtisseries artisanales à Chantenay, Nantes"],
    ]);
  });
});
