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
});
