import type { SiteSpec } from "../schemas/site-spec.js";
import { findSpecGaps } from "../spec-gaps.js";

const NOTICE = `> Généré depuis \`site-spec.json\`. Modifiez librement ce fichier (titres, sections, champs, SEO…).
> À \`faktory approve\`, si ce fichier est plus récent que \`site-spec.json\`, le JSON est re-synchronisé automatiquement.`;

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

export function renderSiteSpecMarkdown(spec: SiteSpec): string {
  const { identity: id } = spec;
  const out: string[] = [];
  out.push(`# SITE-SPEC — ${id.name}`, "", NOTICE, "");

  const gaps = findSpecGaps(spec);
  if (gaps.length) {
    out.push("## Informations à compléter", "");
    for (const g of gaps) out.push(`- ${g.label}${g.paths.length > 1 ? ` (${g.paths.length} valeurs)` : ""}`);
    out.push("", "Remplacez chaque `[à confirmer]` dans ce fichier puis `faktory approve`.", "");
  }

  out.push("## Identité", "");
  out.push(`- Nom : ${id.name}`, `- Secteur : ${id.sector}`, `- Accroche : ${id.tagline}`, `- Ton : ${id.tone}`, `- Langue : ${id.language}`);
  if (id.location) out.push(`- Localisation : ${id.location}`);
  if (id.contact.email) out.push(`- Email : ${id.contact.email}`);
  if (id.contact.phone) out.push(`- Téléphone : ${id.contact.phone}`);
  if (id.contact.address) out.push(`- Adresse : ${id.contact.address}`);
  if (id.contact.hours?.length) { out.push("- Horaires :"); for (const h of id.contact.hours) out.push(`  - ${h}`); }
  out.push("");

  out.push("## Arborescence", "");
  for (const p of spec.sitemap) {
    out.push(`## Page : ${p.title} (\`/${p.slug}/\`)`, "");
    out.push(`- Type : ${p.kind}`, `- Objectif : ${p.goal}`);
    out.push(`- Titre SEO : ${p.seo.title}`, `- Meta description : ${p.seo.metaDescription}`, `- Mots-clés : ${p.seo.keywords.join(", ")}`);
    out.push("", "Sections :", "");
    p.sections.forEach((s, i) => {
      const refs = [s.feature ? `→ feature \`${s.feature}\`` : "", s.form ? `→ formulaire \`${s.form}\`` : ""].filter(Boolean).join(" ");
      out.push(`${i + 1}. **${s.type}** — ${s.heading}${refs ? ` ${refs}` : ""}`, `   ${s.summary}`);
    });
    out.push("");
  }

  out.push("## Fonctionnalités (plugins sur mesure)", "");
  if (!spec.features.length) out.push("Aucune.", "");
  for (const f of spec.features) {
    out.push(`### ${f.name} (\`${f.id}\`)`, "", f.description, "");
    out.push(`- CPT \`${f.cpt.slug}\` : ${f.cpt.singular} / ${f.cpt.plural}`);
    for (const t of f.taxonomies) out.push(`- Taxonomie \`${t.slug}\` (${t.plural}) : ${t.terms.join(", ")}`);
    out.push(`- Affichage : ${f.display}`, "");
    if (f.fields.length) out.push(table(["Clé", "Libellé", "Type", "Options"], f.fields.map((x) => [x.key, x.label, x.type, x.options?.join(", ") ?? ""])), "");
  }

  out.push("## Formulaires", "");
  if (!spec.forms.length) out.push("Aucun.", "");
  for (const f of spec.forms) {
    out.push(`### ${f.name} (\`${f.id}\`)`, "", `- Destinataire : ${f.recipient}`, "");
    out.push(table(["Clé", "Libellé", "Type", "Obligatoire", "Options"], f.fields.map((x) => [x.key, x.label, x.type, x.required ? "oui" : "non", x.options?.join(", ") ?? ""])), "");
  }

  out.push("## Blog", "", `- Catégories : ${spec.blog.categories.join(", ")}`, "- Articles :");
  for (const a of spec.blog.articles) out.push(`- [${a.theme}] ${a.title} (${a.keywords.join(", ")})`);
  out.push("");

  out.push("## Menus", "", `- Menu principal : ${spec.menus.primary.join(" → ")}`, `- Pied de page : ${spec.menus.footer.join(" → ") || "—"}`, "");
  return out.join("\n");
}
