import { z } from "zod";

export const PALETTE_KEYS = ["base", "base2", "base3", "contrast", "contrast2", "contrast3", "accent", "accent2"] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "6-digit hex color");
const px = z.number().int().min(0);

export const GoogleFont = z.object({
  family: z.string().describe("Exact Google Fonts family name, e.g. \"Fraunces\""),
  category: z.enum(["serif", "sans-serif", "display", "handwriting", "monospace"]),
  variants: z.string().describe("Comma-separated weights, e.g. \"400,600,700\" (italics as \"400italic\")"),
});

export const DesignTokensShape = z.object({
  palette: z.object({
    base: hex.describe("Page background"),
    base2: hex.describe("Alternate section background"),
    base3: hex.describe("Cards / surfaces, usually white"),
    contrast: hex.describe("Body text and dark backgrounds"),
    contrast2: hex.describe("Muted text"),
    contrast3: hex.describe("Borders, dividers"),
    accent: hex.describe("Primary action color"),
    accent2: hex.describe("Secondary highlight"),
  }),
  fonts: z.object({ heading: GoogleFont, body: GoogleFont }),
  type: z.object({
    body: z.number().int().min(14).max(20),
    h1: px, h2: px, h3: px, h4: px,
    lineHeightBody: z.number().min(1.3).max(1.8),
    lineHeightHeadings: z.number().min(1).max(1.4),
    headingWeight: z.enum(["400", "500", "600", "700"]),
  }),
  spacing: z.array(px).min(6).max(12).describe("Ascending spacing ramp in px, e.g. [4,8,12,16,24,32,48,64,96,128]"),
  sectionPadding: z.object({ desktop: px, mobile: px }),
  radius: z.number().int().min(0).max(32),
  containerWidth: z.number().int().min(960).max(1400),
  buttonStyle: z.enum(["solid", "outline", "pill"]),
});

export const DesignTokens = DesignTokensShape.superRefine((t, ctx) => {
  for (let i = 1; i < t.spacing.length; i++) {
    if (t.spacing[i] <= t.spacing[i - 1]) { ctx.addIssue({ code: "custom", path: ["spacing"], message: "spacing ramp must be strictly ascending" }); break; }
  }
  if (!(t.type.h1 >= t.type.h2 && t.type.h2 >= t.type.h3 && t.type.h3 >= t.type.h4 && t.type.h4 >= t.type.body)) {
    ctx.addIssue({ code: "custom", path: ["type"], message: "type scale must satisfy h1 >= h2 >= h3 >= h4 >= body" });
  }
});

export type DesignTokens = z.infer<typeof DesignTokensShape>;

export function parseDesignTokens(data: unknown): DesignTokens {
  const r = DesignTokens.safeParse(data);
  if (!r.success) throw new Error(`Invalid design tokens: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}
