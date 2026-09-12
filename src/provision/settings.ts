import type { SiteContext } from "../docker.js";
import { runWp, wpOk } from "../wp.js";
import type { DesignTokens, PaletteKey } from "../schemas/design-tokens.js";
import type { SiteSpec } from "../schemas/site-spec.js";

/** GeneratePress global color slugs, in the theme's default order (see inc/defaults.php), plus accent-2. */
export const GP_COLOR_SLUGS: [PaletteKey, string, string][] = [
  ["contrast", "contrast", "Contrast"], ["contrast2", "contrast-2", "Contrast 2"], ["contrast3", "contrast-3", "Contrast 3"],
  ["base", "base", "Base"], ["base2", "base-2", "Base 2"], ["base3", "base-3", "Base 3"],
  ["accent", "accent", "Accent"], ["accent2", "accent-2", "Accent 2"],
];

/** Full key set of a GP typography rule (GeneratePress_Typography::get_defaults). */
export const TYPO_RULE_DEFAULTS = {
  selector: "", customSelector: "", fontFamily: "", fontWeight: "", textTransform: "", textDecoration: "", fontStyle: "",
  fontSize: "", fontSizeTablet: "", fontSizeMobile: "", fontSizeUnit: "px",
  lineHeight: "", lineHeightTablet: "", lineHeightMobile: "", lineHeightUnit: "",
  letterSpacing: "", letterSpacingTablet: "", letterSpacingMobile: "", letterSpacingUnit: "px",
  marginBottom: "", marginBottomTablet: "", marginBottomMobile: "", marginBottomUnit: "px",
} as const;

type Rule = Record<keyof typeof TYPO_RULE_DEFAULTS, string | number>;
const rule = (selector: string, extra: Partial<Rule>): Rule => ({ ...TYPO_RULE_DEFAULTS, selector, ...extra });
const mobile = (px: number) => Math.max(18, Math.round(px * 0.65));

export function buildGenerateSettings(t: DesignTokens): Record<string, unknown> {
  const fonts = [t.fonts.heading, t.fonts.body];
  const font_manager = fonts
    .filter((f, i) => fonts.findIndex((g) => g.family === f.family) === i)
    .map((f) => ({ fontFamily: f.family, googleFont: true, googleFontCategory: f.category, googleFontVariants: f.variants }));
  const heading = t.fonts.heading.family, body = t.fonts.body.family;
  const spacingMid = t.spacing[Math.floor(t.spacing.length / 2)];
  return {
    container_width: String(t.containerWidth),
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

export async function applyTokens(ctx: SiteContext, tokens: DesignTokens): Promise<void> {
  const current = await runWp(ctx, ["option", "get", "generate_settings", "--format=json"]);
  const existing = current.code === 0 && current.stdout.trim() ? (JSON.parse(current.stdout) as Record<string, unknown>) : {};
  const merged = { ...existing, ...buildGenerateSettings(tokens) };
  await wpOk(ctx, ["option", "update", "generate_settings", "--format=json"], { input: JSON.stringify(merged) });
  await wpOk(ctx, ["option", "update", "generate_dynamic_css_output", ""]);
}

export async function applyIdentity(ctx: SiteContext, spec: SiteSpec): Promise<void> {
  await wpOk(ctx, ["option", "update", "blogname", spec.identity.name]);
  await wpOk(ctx, ["option", "update", "blogdescription", spec.identity.tagline]);
}
