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
});

describe("applyTokens / applyIdentity", () => {
  beforeEach(() => vi.restoreAllMocks());
  const calls = (spy: any) => spy.mock.calls.map((c: any[]) => ({ args: (c[2] as string[]).slice(1), input: (c[3] as { input?: string } | undefined)?.input }));
  it("merges over the existing option, writes JSON on stdin and invalidates the css cache", async () => {
    const spy = vi.spyOn(deps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      if (cmd.join(" ").startsWith("wp option get generate_settings")) return { stdout: JSON.stringify({ icons: "font", container_width: "1200" }), stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
    await applyTokens(ctx, tokens);
    const c = calls(spy);
    const upd = c.find((x: any) => x.args.join(" ").startsWith("option update generate_settings"))!;
    expect(upd.args).toEqual(["option", "update", "generate_settings", "--format=json"]);
    const written = JSON.parse(upd.input!);
    expect(written.icons).toBe("font");
    expect(written.container_width).toBe("1140");
    expect(c.at(-1)!.args).toEqual(["option", "update", "generate_dynamic_css_output", ""]);
  });
  it("starts from an empty object when the option does not exist yet", async () => {
    const spy = vi.spyOn(deps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      if (cmd.join(" ").startsWith("wp option get generate_settings")) return { stdout: "", stderr: "Error: Could not get 'generate_settings' option. Does it exist?", code: 1 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
    await applyTokens(ctx, tokens);
    const upd = calls(spy).find((x: any) => x.args.join(" ").startsWith("option update generate_settings"))!;
    expect(JSON.parse(upd.input!).global_colors).toHaveLength(8);
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
