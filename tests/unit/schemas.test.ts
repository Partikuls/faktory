import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { toJsonSchema } from "../../src/schemas/json-schema.js";
import { SiteSpecShape, parseSiteSpec } from "../../src/schemas/site-spec.js";
import { DesignTokensShape, parseDesignTokens } from "../../src/schemas/design-tokens.js";

const spec = JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8"));
const tokens = JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8"));

describe("toJsonSchema", () => {
  it("emits a plain JSON Schema object without $schema", () => {
    const s = toJsonSchema(SiteSpecShape);
    expect(s.$schema).toBeUndefined();
    expect(s.type).toBe("object");
    expect((s.properties as Record<string, unknown>).sitemap).toBeDefined();
  });
});

describe("SiteSpec", () => {
  it("accepts the boulangerie fixture", () => {
    const s = parseSiteSpec(spec);
    expect(s.sitemap).toHaveLength(6);
    expect(s.sitemap.filter((p) => p.kind === "home")).toHaveLength(1);
    expect(s.features[0].cpt.slug).toBe("produit");
  });
  it("rejects two home pages", () => {
    const bad = structuredClone(spec);
    bad.sitemap[1].kind = "home";
    expect(() => parseSiteSpec(bad)).toThrow(/exactly one/);
  });
  it("rejects a menu slug that is not in the sitemap", () => {
    const bad = structuredClone(spec);
    bad.menus.primary.push("nope");
    expect(() => parseSiteSpec(bad)).toThrow(/menus.primary/);
  });
  it("rejects a section pointing at an unknown feature or form", () => {
    const bad = structuredClone(spec);
    bad.sitemap[0].sections[0].feature = "ghost";
    expect(() => parseSiteSpec(bad)).toThrow(/feature "ghost"/);
  });
  it("rejects a non kebab-case slug", () => {
    const bad = structuredClone(spec);
    bad.sitemap[2].slug = "Nos Produits";
    expect(() => parseSiteSpec(bad)).toThrow();
  });
});

describe("DesignTokens", () => {
  it("accepts the boulangerie fixture", () => {
    const t = parseDesignTokens(tokens);
    expect(t.palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t.spacing[0]).toBeLessThan(t.spacing[t.spacing.length - 1]);
  });
  it("rejects a non-hex color and a descending spacing ramp", () => {
    expect(() => parseDesignTokens({ ...tokens, palette: { ...tokens.palette, accent: "sage" } })).toThrow();
    expect(() => parseDesignTokens({ ...tokens, spacing: [64, 8, 4, 2, 1, 0] })).toThrow(/ascending/);
  });
  it("exposes a JSON schema with the palette keys", () => {
    const s = toJsonSchema(DesignTokensShape) as { properties: { palette: { properties: Record<string, unknown> } } };
    expect(Object.keys(s.properties.palette.properties)).toEqual(["base", "base2", "base3", "contrast", "contrast2", "contrast3", "accent", "accent2"]);
  });
});
