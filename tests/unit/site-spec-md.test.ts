import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { renderSiteSpecMarkdown } from "../../src/render/site-spec-md.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));

describe("renderSiteSpecMarkdown", () => {
  const md = renderSiteSpecMarkdown(spec);
  it("starts with the title and the edit notice", () => {
    expect(md.startsWith("# SITE-SPEC — Maison Rivet\n")).toBe(true);
    expect(md).toContain("faktory approve");
  });
  it("lists every page with slug, kind, SEO and sections", () => {
    for (const p of spec.sitemap) expect(md).toContain(`## Page : ${p.title} (\`/${p.slug}/\`)`);
    expect(md).toContain("- Type : home");
    expect(md).toContain("- Meta description : Boulangerie-pâtisserie artisanale à Chantenay");
    expect(md).toContain("1. **hero** — Le pain comme en 1987, le levain comme toujours");
    expect(md).toContain("→ feature `catalogue_produits`");
    expect(md).toContain("→ formulaire `devis_evenement`");
  });
  it("renders features, forms, blog and menus", () => {
    expect(md).toContain("### Catalogue produits (`catalogue_produits`)");
    expect(md).toContain("| prix | Prix | price |");
    expect(md).toContain("| disponibilite | Disponibilité | select | Tous les jours, Week-end, Sur commande |");
    expect(md).toContain("- Taxonomie `categorie_produit` (Catégories) : Pains, Viennoiseries, Pâtisseries, Salé du midi");
    expect(md).toContain("| telephone | Téléphone | phone | oui |");
    expect(md).toContain("- [Saison] La galette des rois revient : frangipane ou pomme ?");
    expect(md).toContain("- Menu principal : accueil → nos-produits → commandes-evenements → la-maison → actualites → contact");
  });
  it("is deterministic", () => {
    expect(renderSiteSpecMarkdown(spec)).toBe(md);
  });
  it("lists the brief gaps right after the notice, one bullet per label", () => {
    const withHours = parseSiteSpec({ ...spec, identity: { ...spec.identity, contact: { ...spec.identity.contact, hours: ["Lundi : [à confirmer]", "Mardi : [à confirmer]"] } } });
    const out = renderSiteSpecMarkdown(withHours);
    const section = out.indexOf("## Informations à compléter");
    expect(section).toBeGreaterThan(out.indexOf("faktory approve"));
    expect(section).toBeLessThan(out.indexOf("## Identité"));
    expect(out).toContain("- Téléphone\n- Adresse\n- Horaires (2 valeurs)\n");
    expect(out).toContain("Remplacez chaque `[à confirmer]` dans ce fichier puis `faktory approve`.");
  });
  it("omits the gaps section for a complete spec", () => {
    const complete = parseSiteSpec({ ...spec, identity: { ...spec.identity, contact: { ...spec.identity.contact, phone: "02 40 00 00 00", address: "12 rue du Four, 44100 Nantes" } } });
    expect(renderSiteSpecMarkdown(complete)).not.toContain("Informations à compléter");
  });
});
