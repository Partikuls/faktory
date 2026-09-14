import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSiteSpec, type SiteSpec } from "../../src/schemas/site-spec.js";
import { findSpecGaps, gapWarning, hasGapMarker, isPlaceholder } from "../../src/spec-gaps.js";

const load = (): SiteSpec => parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));

describe("markers", () => {
  it("detects the marker in any casing and inside a longer value", () => {
    expect(hasGapMarker("[à confirmer]")).toBe(true);
    expect(hasGapMarker("[adresse À CONFIRMER], 44100 Nantes")).toBe(true);
    expect(hasGapMarker("12 rue du Four")).toBe(false);
    expect(isPlaceholder(undefined)).toBe(true);
    expect(isPlaceholder("")).toBe(true);
    expect(isPlaceholder("[à confirmer]")).toBe(true);
    expect(isPlaceholder("contact@maisonrivet.fr")).toBe(false);
  });
});

describe("findSpecGaps", () => {
  it("lists the fixture's phone and address with readable labels", () => {
    expect(findSpecGaps(load())).toEqual([
      { label: "Téléphone", paths: ["identity.contact.phone"] },
      { label: "Adresse", paths: ["identity.contact.address"] },
    ]);
  });
  it("groups the hour lines into one entry carrying every path", () => {
    const spec = load();
    spec.identity.contact.hours = ["Lundi : [à confirmer]", "Mardi : 7h – 19h", "Mercredi : [à confirmer]"];
    const hours = findSpecGaps(spec).find((g) => g.label === "Horaires")!;
    expect(hours.paths).toEqual(["identity.contact.hours[0]", "identity.contact.hours[2]"]);
  });
  it("labels page sections, SEO, features, forms and articles", () => {
    const spec = load();
    const page = spec.sitemap[0];
    page.sections[0].summary = "Photo [à confirmer]";
    page.seo.metaDescription = "[à confirmer]";
    spec.features[0].description = "[à confirmer]";
    spec.forms[0].recipient = "a@b.fr";
    spec.forms[0].name = "Devis [à confirmer]";
    spec.blog.articles[0].theme = "[à confirmer]";
    const labels = findSpecGaps(spec).map((g) => g.label);
    expect(labels).toContain(`Page ${page.title} › ${page.sections[0].heading}`);
    expect(labels).toContain(`Page ${page.title} › SEO`);
    expect(labels).toContain(`Fonctionnalité ${spec.features[0].name}`);
    expect(labels).toContain(`Formulaire ${spec.forms[0].name}`);
    expect(labels).toContain(`Article « ${spec.blog.articles[0].title} »`);
  });
  it("returns an empty list for a complete spec", () => {
    const spec = load();
    spec.identity.contact.phone = "02 40 00 00 00";
    spec.identity.contact.address = "12 rue du Four, 44100 Nantes";
    expect(findSpecGaps(spec)).toEqual([]);
  });
});

describe("gapWarning", () => {
  it("counts gaps and names the first three labels", () => {
    const gaps = ["Téléphone", "Adresse", "Horaires", "Email"].map((label) => ({ label, paths: [label] }));
    expect(gapWarning(gaps)).toBe("⚠ 4 informations à compléter dans SITE-SPEC.md (Téléphone, Adresse, Horaires…) — le site affichera des manques");
    expect(gapWarning(gaps.slice(0, 1))).toBe("⚠ 1 information à compléter dans SITE-SPEC.md (Téléphone) — le site affichera des manques");
  });
});
