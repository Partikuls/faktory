import type { SiteContext } from "../docker.js";
import { wpOk } from "../wp.js";
import type { DesignTokens, PaletteKey } from "../schemas/design-tokens.js";
import type { SiteSpec } from "../schemas/site-spec.js";

/** GeneratePress global color slugs, in the theme's default order (see inc/defaults.php), plus accent-2. */
export const GP_COLOR_SLUGS: [PaletteKey, string, string][] = [
  ["contrast", "contrast", "Contrast"], ["contrast2", "contrast-2", "Contrast 2"], ["contrast3", "contrast-3", "Contrast 3"],
  ["base", "base", "Base"], ["base2", "base-2", "Base 2"], ["base3", "base-3", "Base 3"],
  ["accent", "accent", "Accent"], ["accent2", "accent-2", "Accent 2"],
];

/** Full key set of a GP typography rule (GeneratePress_Typography::get_defaults). `module: "core"` is required: get_css('core') drops rules without it. */
export const TYPO_RULE_DEFAULTS = {
  selector: "", customSelector: "", module: "core", fontFamily: "", fontWeight: "", textTransform: "", textDecoration: "", fontStyle: "",
  fontSize: "", fontSizeTablet: "", fontSizeMobile: "", fontSizeUnit: "px",
  lineHeight: "", lineHeightTablet: "", lineHeightMobile: "", lineHeightUnit: "",
  letterSpacing: "", letterSpacingTablet: "", letterSpacingMobile: "", letterSpacingUnit: "px",
  marginBottom: "", marginBottomTablet: "", marginBottomMobile: "", marginBottomUnit: "px",
} as const;

type Rule = Record<keyof typeof TYPO_RULE_DEFAULTS, string | number>;
const rule = (selector: string, extra: Partial<Rule>): Rule => ({ ...TYPO_RULE_DEFAULTS, selector, ...extra });
const mobile = (px: number) => Math.max(18, Math.round(px * 0.65));

export const POSTS_PER_PAGE = 9;

/**
 * GeneratePress component colors on Faktory's palette roles (base = page, base-3 = surfaces, contrast = text).
 * Written explicitly: a key left out falls back to GP's fresh-install default, which uses GP's own roles.
 */
export const COMPONENT_COLORS: Record<string, string> = {
  background_color: "var(--base)",
  content_background_color: "var(--base)",
  text_color: "var(--contrast)",
  link_color: "var(--accent)",
  link_color_hover: "var(--contrast)",
  header_background_color: "var(--base-3)",
  site_title_color: "var(--contrast)",
  site_tagline_color: "var(--contrast-2)",
  navigation_background_color: "var(--base-3)",
  navigation_text_color: "var(--contrast)",
  navigation_text_hover_color: "var(--accent)",
  navigation_text_current_color: "var(--accent)",
  subnavigation_background_color: "var(--base-3)",
  subnavigation_text_color: "var(--contrast)",
  blog_post_title_color: "var(--contrast)",
  blog_post_title_hover_color: "var(--contrast-2)",
  entry_meta_text_color: "var(--contrast-2)",
  entry_meta_link_color: "var(--accent)",
  form_background_color: "var(--base-3)",
  form_text_color: "var(--contrast)",
  form_border_color: "var(--contrast-3)",
  form_button_background_color: "var(--accent)",
  form_button_background_color_hover: "var(--contrast)",
  form_button_text_color: "var(--base-3)",
  form_button_text_color_hover: "var(--base-3)",
  footer_background_color: "var(--contrast)",
};

export function buildGenerateSettings(t: DesignTokens): Record<string, unknown> {
  const fonts = [t.fonts.heading, t.fonts.body];
  const font_manager = fonts
    .filter((f, i) => fonts.findIndex((g) => g.family === f.family) === i)
    .map((f) => ({ fontFamily: f.family, googleFont: true, googleFontCategory: f.category, googleFontVariants: f.variants }));
  const heading = t.fonts.heading.family, body = t.fonts.body.family;
  const spacingMid = t.spacing[Math.floor(t.spacing.length / 2)];
  return {
    container_width: String(t.containerWidth),
    structure: "flexbox",
    icons: "svg",
    combine_css: true,
    dynamic_css_cache: true,
    ...COMPONENT_COLORS,
    layout_setting: "no-sidebar",
    blog_layout_setting: "no-sidebar",
    single_layout_setting: "no-sidebar",
    content_layout_setting: "one-container",
    footer_widget_setting: "0",
    hide_tagline: true,
    underline_links: "not-hover",
    global_colors: GP_COLOR_SLUGS.map(([key, slug, name]) => ({ name, slug, color: t.palette[key] })),
    use_dynamic_typography: true,
    font_manager,
    typography: [
      rule("body", { fontFamily: body, fontSize: t.type.body, lineHeight: t.type.lineHeightBody }),
      rule("all-headings", { fontFamily: heading, fontWeight: t.type.headingWeight, lineHeight: t.type.lineHeightHeadings, marginBottom: spacingMid }),
      rule("h1", { fontSize: t.type.h1, fontSizeMobile: mobile(t.type.h1) }),
      rule("h2", { fontSize: t.type.h2, fontSizeMobile: mobile(t.type.h2) }),
      rule("h3", { fontSize: t.type.h3, fontSizeMobile: mobile(t.type.h3) }),
      rule("h4", { fontSize: t.type.h4 }),
      rule("main-title", { fontFamily: heading, fontSize: 26, fontWeight: t.type.headingWeight }),
      rule("primary-menu-items", { fontFamily: body, fontSize: 16, fontWeight: "500" }),
      rule("buttons", { fontFamily: body, fontWeight: "600" }),
    ],
  };
}

/**
 * GeneratePress treats `generate_settings` without `generate_db_version` as a pre-2.3 install and re-applies its
 * old defaults (floats structure, #efefef background…) on the next page load. Stamp the version first, then write
 * the whole option: keys we do not set fall back to GP's fresh-install defaults.
 */
export async function applyTokens(ctx: SiteContext, tokens: DesignTokens): Promise<void> {
  const version = (await wpOk(ctx, ["theme", "get", "generatepress", "--field=version"])).split("\n").at(-1)!.trim();
  if (!/^\d+\.\d+/.test(version)) throw new Error(`Could not read the GeneratePress version (got "${version}")`);
  await wpOk(ctx, ["option", "update", "generate_db_version", version]);
  await wpOk(ctx, ["option", "update", "generate_settings", "--format=json"], { input: JSON.stringify(buildGenerateSettings(tokens)) });
  await wpOk(ctx, ["option", "update", "posts_per_page", String(POSTS_PER_PAGE)]);
  await wpOk(ctx, ["option", "update", "generate_dynamic_css_output", ""]);
}

export async function applyIdentity(ctx: SiteContext, spec: SiteSpec): Promise<void> {
  await wpOk(ctx, ["option", "update", "blogname", spec.identity.name]);
  await wpOk(ctx, ["option", "update", "blogdescription", spec.identity.tagline]);
}
