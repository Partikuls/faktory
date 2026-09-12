# Faktory Phase 2 — Spec + Design + Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `faktory run <slug>` turns `brief.md` into an editable `SITE-SPEC.md` (checkpoint 1), then into `design-system.md` + `design-tokens.json` + `preview.html` (checkpoint 2), and `provision` applies the approved tokens, identity, pages, primary menu and a GP Premium footer element to the live WordPress.

**Architecture:** Two new LLM stages (`spec`, `design`) built on the phase 1 `Stage`/`runAgent` interfaces. Structured data comes back through the SDK `outputFormat` (JSON Schema generated from zod 4 schemas); prose artifacts are written by the agent with `Write`. Human edits to the markdown are re-synced into the JSON at `faktory approve` time by a cheap structured-output query, only when the markdown is newer than its JSON. `provision` stays deterministic: it reads `site-spec.json` + `design-tokens.json` and drives WP-CLI (`generate_settings` written as JSON, placeholder pages, `wp menu`, a `gp_elements` `site-footer` post compiled with `gb_build.py`). The header stays GeneratePress' native header, themed through `generate_settings`.

**Tech Stack:** Node 24, TypeScript 5, `@anthropic-ai/claude-agent-sdk` 0.3.269 (`outputFormat`, `structured_output`, `maxBudgetUsd`), `zod` 4 (`z.toJSONSchema`), `commander` 12, `vitest` 2, `tsx`, Python 3 (`gb_build.py`, `gb_preview.py` from the synced skill), Docker Compose, WP-CLI. GeneratePress 3.6.1, GP Premium 2.5.6, GenerateBlocks 2.4.1, GB Pro 2.7.1 (all present on the demo site).

**Spec:** `docs/superpowers/specs/2026-09-12-faktory-design.md` (sections "1. spec", "2. design", "3. provision" steps 5-6, "Outils MCP in-process", "Gestion des erreurs → Budget").

## Global Constraints

- Repo root `/Users/khelil/Developer/partikuls/faktory`; git root is the parent `partikuls` monorepo (run `git` from `faktory/`, paths are relative to it). No `origin` remote: commits only, no push.
- ESM only, `moduleResolution: "bundler"`, strict TS. Imports between `src/` files use the `.js` suffix.
- **zod 4** (`import { z } from "zod"`, `z.toJSONSchema(schema)`). Never add `--legacy-peer-deps`.
- Default model `claude-opus-5` from `config.models.default`; never hardcode a model in a stage. The `resync` pseudo-stage uses `config.models.resync` (set to `claude-sonnet-5` in `faktory.config.json`).
- `runAgent` keeps `settingSources: []`, `skills: pluginSkillNames()`, always allows `Skill`, persists cost even on error. Do not change these.
- Every shell call goes through `src/exec.ts` `run()` (never throws; inspect `code`). WP-CLI goes through `src/wp.ts` (`runWp`, `wpOk`, `wpJson`).
- `sites/`, `docker/vendor/*.zip`, `docker/.env`, `plugin/skills/` are gitignored. `fixtures/` is committed.
- Integration tests needing Docker: `describe.skipIf(!process.env.FAKTORY_DOCKER)`, run with `FAKTORY_DOCKER=1 npm run test:integration` (`--hookTimeout=600000` is already in the script). Integration ports: 8190-8192 (this phase uses 8191).
- Unit tests that shell out to `python3` are guarded with `describe.skipIf(!existsSync(<gb_build.py path>))` so `npm test` passes on a machine without synced skills.
- Site language `fr`, admin email `khelil@partikuls.com`, permalinks `/%postname%/`.
- GP facts verified on the demo site (2026-09-13), do not re-derive: `generate_settings` does not exist on a fresh install (GP merges with `generate_get_defaults()`), `wp option update generate_settings --format=json` with JSON on stdin stores a PHP array; GP Premium modules activate with `wp option update generate_package_<module> activated` (Elements: `generate_package_elements`); a `gp_elements` post with meta `_generate_element_type=block`, `_generate_block_type=site-footer`, `_generate_element_display_conditions=[{"rule":"general:site","object":""}]` (written with `--format=json`) replaces the native footer; after writing settings invalidate `generate_dynamic_css_output` with an empty string; GP 3.x default color keys already reference `var(--contrast)` etc., so only `global_colors` needs to change; raw typography selectors (`h1`, `h2`…) pass through `get_css_selector` unchanged; GeneratePress registers only the `primary` menu location.
- Artifact file names inside `sites/<slug>/`: `brief.md`, `site-spec.json`, `SITE-SPEC.md`, `design-system.md`, `design-tokens.json`, `preview.html`, `design/preview.gb.json`, `design/preview.gb.html`.

## Decisions taken for this phase (deviations from the spec text, keep them)

1. **Header is GeneratePress' native header**, themed by `generate_settings` (palette, `main-title` and `primary-menu-items` typography). The spec said "header et footer en GP Premium Elements"; GB Pro's navigation blocks (`generateblocks-pro/navigation`, `menu-container`, `menu-toggle`, `classic-menu`) need markup copied from an editor-built element, which is phase-3+ work. The **footer is a GP Premium `site-footer` block element** built from a deterministic TS tree + `gb_build.py`.
2. **Markdown is the editing surface, JSON is the machine truth.** `SITE-SPEC.md` is rendered from `site-spec.json` by TS; `design-system.md` is written by the agent. At `faktory approve`, if the markdown is newer than its JSON (mtime, 1 s tolerance), a structured-output query re-extracts the JSON. `approve` becomes async.
3. **Provision creates empty placeholder pages** (published, GP meta set) for every sitemap entry so menus and `page_on_front`/`page_for_posts` can be set now; phase 3 fills them by slug with `wp post update`.
4. **`--max-cost` lands now** (first LLM stages): `config.maxCostUsd` (default 40), CLI `--max-cost <usd>` override, checked before each stage, and passed to the SDK as `maxBudgetUsd` (remaining budget).
5. **Design tokens come back as structured output**; prose (`design-system.md`) and the preview are written by the agent with `Write` + the `gb_build`/`gb_preview` tools. After the run, TS regenerates `preview.html` from `design/preview.gb.html` with the final tokens so both always agree.
6. `provision` still works on a site without spec/tokens (the demo): the new steps are skipped with a message.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/schemas/json-schema.ts` | `toJsonSchema(zodSchema)` for `outputFormat` (drops `$schema`) |
| `src/schemas/site-spec.ts` | zod `SiteSpecShape`/`SiteSpec` (+ cross-checks), enums, `parseSiteSpec` |
| `src/schemas/design-tokens.ts` | zod `DesignTokensShape`/`DesignTokens`, `parseDesignTokens` |
| `src/artifacts.ts` | Artifact names/paths, `hasArtifact`, `readJsonArtifact`, `writeJsonArtifact`, `isStale` |
| `src/render/site-spec-md.ts` | `renderSiteSpecMarkdown(spec)` deterministic SITE-SPEC.md |
| `src/prompts.ts`, `src/prompts/spec.md`, `src/prompts/design.md` | Prompt loading, system prompts, design doctrine injection |
| `src/gb.ts` | `gbBuild`, `gbPreview` (+ palette/font injection), `previewOptionsFromTokens` |
| `src/tools/server.ts` (modify) | `gb_build` and `gb_preview` MCP tools next to `wp` |
| `src/resync.ts` | `resyncFromMarkdown` (approve-time re-extraction) |
| `src/stages/spec.ts`, `src/stages/design.ts` | The two LLM stages |
| `src/provision/settings.ts` | `buildGenerateSettings(tokens)`, `applyTokens`, `applyIdentity` |
| `src/provision/pages.ts` | `ensurePages`, `ensureMenus` |
| `src/provision/footer.ts` | `footerTree`, `installFooter` |
| `src/stages/provision.ts` (modify) | Wire identity/pages/menus/tokens/footer after the stack |
| `src/pipeline.ts`, `src/config.ts`, `src/agent.ts`, `src/wp.ts`, `src/cli.ts` (modify) | `onApprove`, async approve, `maxCostUsd`, `wpOk` stdin, CLI flags, doctor gb check |
| `fixtures/specs/boulangerie.site-spec.json`, `fixtures/specs/boulangerie.design-tokens.json` | Hand-written valid artifacts for unit + integration tests |
| `tests/unit/*.test.ts`, `tests/integration/provision-chrome.test.ts` | Tests |
| `README.md`, `faktory.config.json` | Docs, `models.resync`, `maxCostUsd` |

---

### Task 1: zod schemas, JSON Schema helper, fixtures

**Files:**
- Create: `src/schemas/json-schema.ts`, `src/schemas/site-spec.ts`, `src/schemas/design-tokens.ts`
- Create: `fixtures/specs/boulangerie.site-spec.json`, `fixtures/specs/boulangerie.design-tokens.json`
- Test: `tests/unit/schemas.test.ts`

**Interfaces:**
- Produces: `toJsonSchema(schema: z.ZodType): Record<string, unknown>`; `SiteSpecShape` (ZodObject), `SiteSpec` (with cross-checks), `type SiteSpec`, `parseSiteSpec(data: unknown): SiteSpec`, `PAGE_KINDS`, `SECTION_TYPES`; `DesignTokensShape`, `DesignTokens`, `type DesignTokens`, `parseDesignTokens(data: unknown): DesignTokens`, `PALETTE_KEYS`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/schemas.test.ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/schemas.test.ts`
Expected: FAIL — cannot resolve `../../src/schemas/json-schema.js`.

- [ ] **Step 3: Write the JSON Schema helper**

```ts
// src/schemas/json-schema.ts
import { z } from "zod";

/** JSON Schema for the Agent SDK `outputFormat`. zod 4 emits draft 2020-12 with a `$schema` key we drop. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}
```

- [ ] **Step 4: Write the site spec schema**

```ts
// src/schemas/site-spec.ts
import { z } from "zod";

export const PAGE_KINDS = ["home", "standard", "blog", "contact"] as const;
export const SECTION_TYPES = ["hero", "features", "text", "gallery", "testimonials", "faq", "cta", "contact", "form", "custom-query", "hours"] as const;
export const FIELD_TYPES = ["text", "textarea", "number", "price", "date", "select", "boolean", "image", "url"] as const;
export const FORM_FIELD_TYPES = ["text", "email", "phone", "date", "number", "textarea", "select"] as const;

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case slug").describe("kebab-case, used in the URL");
const key = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key");

export const Section = z.object({
  type: z.enum(SECTION_TYPES),
  heading: z.string().describe("Short French heading"),
  summary: z.string().describe("What the section shows, 1-3 sentences; copy hints allowed"),
  feature: z.string().optional().describe("Feature id when type is custom-query"),
  form: z.string().optional().describe("Form id when type is form or contact"),
});

export const Page = z.object({
  slug,
  title: z.string(),
  kind: z.enum(PAGE_KINDS).describe("Exactly one home page; blog = the posts page; contact = the page carrying the main contact form"),
  goal: z.string().describe("What the visitor should do or learn on this page"),
  seo: z.object({
    title: z.string().max(70),
    metaDescription: z.string().max(160),
    keywords: z.array(z.string()).min(1).max(8),
  }),
  sections: z.array(Section).min(1),
});

export const Feature = z.object({
  id: key,
  name: z.string(),
  description: z.string(),
  cpt: z.object({
    slug: z.string().regex(/^[a-z][a-z0-9_]{0,18}$/).describe("WordPress post type key, max 19 chars"),
    singular: z.string(),
    plural: z.string(),
  }),
  fields: z.array(z.object({ key, label: z.string(), type: z.enum(FIELD_TYPES), options: z.array(z.string()).optional() })),
  taxonomies: z.array(z.object({
    slug: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
    singular: z.string(),
    plural: z.string(),
    terms: z.array(z.string()),
  })),
  display: z.string().describe("How and where entries are rendered (grid on which page, how many featured on home, filters)"),
});

export const Form = z.object({
  id: key,
  name: z.string(),
  recipient: z.string().email(),
  fields: z.array(z.object({
    key, label: z.string(), type: z.enum(FORM_FIELD_TYPES), required: z.boolean(), options: z.array(z.string()).optional(),
  })).min(1),
});

export const SiteSpecShape = z.object({
  identity: z.object({
    name: z.string(),
    sector: z.string(),
    tagline: z.string().describe("One line, French, used as site tagline"),
    tone: z.string(),
    language: z.literal("fr"),
    location: z.string().optional().describe("City / neighbourhood for local SEO"),
    contact: z.object({
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      hours: z.array(z.string()).optional().describe("One line per day or group of days"),
    }),
  }),
  sitemap: z.array(Page).min(1).max(12),
  features: z.array(Feature).describe("Admin-managed content types that need a custom plugin; empty when none"),
  forms: z.array(Form),
  blog: z.object({
    categories: z.array(z.string()).min(1),
    articles: z.array(z.object({ title: z.string(), theme: z.string(), keywords: z.array(z.string()).min(1) })).min(3).max(5),
  }),
  menus: z.object({
    primary: z.array(slug).min(1).describe("Page slugs in order"),
    footer: z.array(slug),
  }),
});

export const SiteSpec = SiteSpecShape.superRefine((s, ctx) => {
  const slugs = new Set(s.sitemap.map((p) => p.slug));
  const features = new Set(s.features.map((f) => f.id));
  const forms = new Set(s.forms.map((f) => f.id));
  if (s.sitemap.filter((p) => p.kind === "home").length !== 1) ctx.addIssue({ code: "custom", path: ["sitemap"], message: "sitemap needs exactly one page with kind \"home\"" });
  if (slugs.size !== s.sitemap.length) ctx.addIssue({ code: "custom", path: ["sitemap"], message: "duplicate page slugs" });
  for (const m of ["primary", "footer"] as const) {
    for (const sl of s.menus[m]) if (!slugs.has(sl)) ctx.addIssue({ code: "custom", path: ["menus", m], message: `menus.${m}: unknown page slug "${sl}"` });
  }
  s.sitemap.forEach((p, pi) => p.sections.forEach((sec, si) => {
    if (sec.feature && !features.has(sec.feature)) ctx.addIssue({ code: "custom", path: ["sitemap", pi, "sections", si], message: `unknown feature "${sec.feature}"` });
    if (sec.form && !forms.has(sec.form)) ctx.addIssue({ code: "custom", path: ["sitemap", pi, "sections", si], message: `unknown form "${sec.form}"` });
  }));
});

export type SiteSpec = z.infer<typeof SiteSpecShape>;

export function parseSiteSpec(data: unknown): SiteSpec {
  const r = SiteSpec.safeParse(data);
  if (!r.success) throw new Error(`Invalid site spec: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}
```

- [ ] **Step 5: Write the design tokens schema**

```ts
// src/schemas/design-tokens.ts
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
```

- [ ] **Step 6: Write the fixtures**

`fixtures/specs/boulangerie.site-spec.json`:

```json
{
  "identity": {
    "name": "Maison Rivet",
    "sector": "Boulangerie-pâtisserie artisanale",
    "tagline": "Pain au levain et pâtisseries artisanales à Chantenay, Nantes",
    "tone": "Chaleureux, artisanal, précis, sans kitsch",
    "language": "fr",
    "location": "Chantenay, Nantes",
    "contact": {
      "email": "contact@maisonrivet.fr",
      "phone": "[à confirmer]",
      "address": "[adresse à confirmer], 44100 Nantes",
      "hours": ["Mardi – Vendredi : 7h00 – 19h30", "Samedi : 7h00 – 19h00", "Dimanche : 7h00 – 13h00", "Fermé le lundi"]
    }
  },
  "sitemap": [
    {
      "slug": "accueil", "title": "Accueil", "kind": "home",
      "goal": "Donner envie de venir en boutique et orienter vers la commande événementielle",
      "seo": { "title": "Boulangerie Maison Rivet – Chantenay, Nantes", "metaDescription": "Boulangerie-pâtisserie artisanale à Chantenay (Nantes) : pain au levain, farines locales, viennoiseries et gâteaux sur commande depuis 1987.", "keywords": ["boulangerie Chantenay", "boulangerie Nantes", "pain au levain Nantes"] },
      "sections": [
        { "type": "hero", "heading": "Le pain comme en 1987, le levain comme toujours", "summary": "Accroche chaleureuse, photo d'ambiance, deux boutons : Nos produits et Commander pour un événement." },
        { "type": "custom-query", "heading": "Nos incontournables", "summary": "Quatre produits mis en avant depuis le catalogue.", "feature": "catalogue_produits" },
        { "type": "hours", "heading": "Horaires & accès", "summary": "Horaires par jour, adresse, lien vers la page contact." },
        { "type": "text", "heading": "Une maison, deux générations", "summary": "Trois phrases sur l'histoire et le label Boulanger de France, lien vers La maison." },
        { "type": "cta", "heading": "Un événement à fêter ?", "summary": "Gâteaux d'anniversaire, buffets d'entreprise : bouton vers Commandes & événements." }
      ]
    },
    {
      "slug": "nos-produits", "title": "Nos produits", "kind": "standard",
      "goal": "Présenter le catalogue complet, filtrable par catégorie",
      "seo": { "title": "Pains, viennoiseries et pâtisseries – Maison Rivet", "metaDescription": "Découvrez nos pains au levain, viennoiseries pur beurre, pâtisseries et salé du midi. Farines du Moulin de Sarré.", "keywords": ["pain au levain", "viennoiseries Nantes", "pâtisserie Chantenay"] },
      "sections": [
        { "type": "hero", "heading": "Nos produits", "summary": "Titre court et phrase sur les farines locales et le levain naturel." },
        { "type": "custom-query", "heading": "Le catalogue", "summary": "Grille de tous les produits avec filtre par catégorie (pains, viennoiseries, pâtisseries, salé) et mention de disponibilité.", "feature": "catalogue_produits" },
        { "type": "cta", "heading": "Envie d'une pièce sur mesure ?", "summary": "Renvoi vers la page Commandes & événements." }
      ]
    },
    {
      "slug": "commandes-evenements", "title": "Commandes & événements", "kind": "standard",
      "goal": "Obtenir des demandes de devis pour anniversaires, mariages et buffets d'entreprise",
      "seo": { "title": "Gâteaux et buffets sur commande – Maison Rivet Nantes", "metaDescription": "Anniversaires, mariages, buffets d'entreprise sur l'Île de Nantes : demandez un devis à la boulangerie Maison Rivet.", "keywords": ["gâteau anniversaire Nantes", "buffet entreprise Nantes", "traiteur boulangerie Nantes"] },
      "sections": [
        { "type": "hero", "heading": "Commandes & événements", "summary": "Promesse courte : du sur-mesure, préparé à la main, livré ou à retirer." },
        { "type": "features", "heading": "Ce que nous préparons", "summary": "Trois cartes : anniversaires, mariages, buffets d'entreprise, avec délais de commande." },
        { "type": "form", "heading": "Demander un devis", "summary": "Formulaire de demande de devis.", "form": "devis_evenement" }
      ]
    },
    {
      "slug": "la-maison", "title": "La maison", "kind": "standard",
      "goal": "Raconter l'histoire, l'équipe, le levain et les fournisseurs pour créer la confiance",
      "seo": { "title": "Notre histoire – Boulangerie Maison Rivet", "metaDescription": "Fondée en 1987, reprise en 2019 par Claire et Julien Rivet : une équipe de 6, un levain naturel et des farines du Moulin de Sarré.", "keywords": ["boulanger de France Nantes", "boulangerie artisanale histoire"] },
      "sections": [
        { "type": "hero", "heading": "La maison", "summary": "Titre et photo de la boutique." },
        { "type": "text", "heading": "Depuis 1987", "summary": "Histoire en deux paragraphes, reprise en 2019." },
        { "type": "features", "heading": "L'équipe", "summary": "Six portraits avec prénom et rôle (placeholders)." },
        { "type": "text", "heading": "Le levain & les farines", "summary": "Levain naturel, Moulin de Sarré, label Boulanger de France." }
      ]
    },
    {
      "slug": "actualites", "title": "Actualités", "kind": "blog",
      "goal": "Publier nouveautés saisonnières, recettes et coulisses",
      "seo": { "title": "Actualités de la boulangerie – Maison Rivet", "metaDescription": "Nouveautés de saison, recettes et coulisses de la boulangerie Maison Rivet à Chantenay.", "keywords": ["actualités boulangerie Nantes", "recettes pain levain"] },
      "sections": [ { "type": "text", "heading": "Actualités", "summary": "Liste des articles (gérée par WordPress)." } ]
    },
    {
      "slug": "contact", "title": "Contact & horaires", "kind": "contact",
      "goal": "Donner horaires, adresse, téléphone et un formulaire simple",
      "seo": { "title": "Contact & horaires – Maison Rivet, Chantenay", "metaDescription": "Horaires d'ouverture, adresse et téléphone de la boulangerie Maison Rivet à Chantenay, Nantes. Écrivez-nous.", "keywords": ["boulangerie Chantenay horaires", "boulangerie Nantes contact"] },
      "sections": [
        { "type": "hours", "heading": "Horaires", "summary": "Horaires par jour." },
        { "type": "contact", "heading": "Nous trouver", "summary": "Adresse, carte (placeholder), téléphone, email." },
        { "type": "form", "heading": "Écrivez-nous", "summary": "Formulaire de contact simple.", "form": "contact" }
      ]
    }
  ],
  "features": [
    {
      "id": "catalogue_produits",
      "name": "Catalogue produits",
      "description": "Produits gérés depuis l'admin, filtrables par catégorie, 4 mis en avant sur l'accueil.",
      "cpt": { "slug": "produit", "singular": "Produit", "plural": "Produits" },
      "fields": [
        { "key": "prix", "label": "Prix", "type": "price" },
        { "key": "disponibilite", "label": "Disponibilité", "type": "select", "options": ["Tous les jours", "Week-end", "Sur commande"] },
        { "key": "mis_en_avant", "label": "Mis en avant sur l'accueil", "type": "boolean" }
      ],
      "taxonomies": [ { "slug": "categorie_produit", "singular": "Catégorie", "plural": "Catégories", "terms": ["Pains", "Viennoiseries", "Pâtisseries", "Salé du midi"] } ],
      "display": "Grille filtrable sur Nos produits ; 4 produits 'mis en avant' sur l'accueil ; photo, nom, description courte, prix, disponibilité."
    }
  ],
  "forms": [
    {
      "id": "devis_evenement", "name": "Demande de devis événement", "recipient": "contact@maisonrivet.fr",
      "fields": [
        { "key": "nom", "label": "Nom", "type": "text", "required": true },
        { "key": "email", "label": "Email", "type": "email", "required": true },
        { "key": "telephone", "label": "Téléphone", "type": "phone", "required": true },
        { "key": "date", "label": "Date de l'événement", "type": "date", "required": true },
        { "key": "personnes", "label": "Nombre de personnes", "type": "number", "required": true },
        { "key": "message", "label": "Votre projet", "type": "textarea", "required": false }
      ]
    },
    {
      "id": "contact", "name": "Contact", "recipient": "contact@maisonrivet.fr",
      "fields": [
        { "key": "nom", "label": "Nom", "type": "text", "required": true },
        { "key": "email", "label": "Email", "type": "email", "required": true },
        { "key": "message", "label": "Message", "type": "textarea", "required": true }
      ]
    }
  ],
  "blog": {
    "categories": ["Saison", "Recettes", "Coulisses"],
    "articles": [
      { "title": "La galette des rois revient : frangipane ou pomme ?", "theme": "Saison", "keywords": ["galette des rois Nantes"] },
      { "title": "Réussir ses tartines au levain à la maison", "theme": "Recettes", "keywords": ["recette pain levain"] },
      { "title": "Une nuit au fournil : 4h du matin chez Maison Rivet", "theme": "Coulisses", "keywords": ["coulisses boulangerie"] }
    ]
  },
  "menus": {
    "primary": ["accueil", "nos-produits", "commandes-evenements", "la-maison", "actualites", "contact"],
    "footer": ["nos-produits", "commandes-evenements", "la-maison", "actualites", "contact"]
  }
}
```

`fixtures/specs/boulangerie.design-tokens.json`:

```json
{
  "palette": {
    "base": "#faf6ef", "base2": "#f1e8d8", "base3": "#ffffff",
    "contrast": "#2b1d0e", "contrast2": "#6b5a46", "contrast3": "#d9cdb8",
    "accent": "#7a8b6f", "accent2": "#c89b3c"
  },
  "fonts": {
    "heading": { "family": "Fraunces", "category": "serif", "variants": "400,600,700" },
    "body": { "family": "Source Sans 3", "category": "sans-serif", "variants": "400,600" }
  },
  "type": { "body": 18, "h1": 52, "h2": 36, "h3": 26, "h4": 20, "lineHeightBody": 1.6, "lineHeightHeadings": 1.15, "headingWeight": "600" },
  "spacing": [4, 8, 12, 16, 24, 32, 48, 64, 96, 128],
  "sectionPadding": { "desktop": 96, "mobile": 56 },
  "radius": 10,
  "containerWidth": 1140,
  "buttonStyle": "solid"
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/unit/schemas.test.ts && npm run typecheck`
Expected: 9 tests PASS, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/schemas fixtures/specs tests/unit/schemas.test.ts
git commit -m "feat(faktory): site-spec and design-tokens zod schemas with JSON Schema export and fixtures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 2: Artifact paths, JSON artifact IO, staleness

**Files:**
- Create: `src/artifacts.ts`
- Test: `tests/unit/artifacts.test.ts`

**Interfaces:**
- Consumes: `SiteContext` from `src/docker.ts`.
- Produces: `ARTIFACTS` (name map), `type ArtifactKey`, `artifactPath(ctx, key): string`, `hasArtifact(ctx, key): boolean`, `readJsonArtifact<T>(ctx, key, parse: (u: unknown) => T): T`, `writeJsonArtifact(ctx, key, data: unknown): void`, `writeTextArtifact(ctx, key, text: string): void`, `isStale(ctx, mdKey, jsonKey): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/artifacts.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { ARTIFACTS, artifactPath, hasArtifact, readJsonArtifact, writeJsonArtifact, writeTextArtifact, isStale } from "../../src/artifacts.js";

function ctx(): SiteContext {
  const siteDir = mkdtempSync(join(tmpdir(), "fk-art-"));
  return { config: loadConfig("/tmp/fk"), slug: "demo", siteDir, state: createState("demo", 8100, "pw") };
}

describe("artifacts", () => {
  it("resolves paths inside the site dir and creates parent dirs on write", () => {
    const c = ctx();
    expect(artifactPath(c, "previewTree")).toBe(join(c.siteDir, "design", "preview.gb.json"));
    writeJsonArtifact(c, "previewTree", [{ type: "element" }]);
    expect(hasArtifact(c, "previewTree")).toBe(true);
    expect(readJsonArtifact(c, "previewTree", (u) => u as unknown[])).toEqual([{ type: "element" }]);
  });
  it("throws a friendly error when a JSON artifact is missing", () => {
    const c = ctx();
    expect(() => readJsonArtifact(c, "siteSpecJson", (u) => u)).toThrow(/site-spec.json not found.*run the spec stage/);
  });
  it("isStale is true only when the markdown is newer than the json by more than 1s", () => {
    const c = ctx();
    writeTextArtifact(c, "siteSpecMd", "# spec");
    writeJsonArtifact(c, "siteSpecJson", {});
    expect(isStale(c, "siteSpecMd", "siteSpecJson")).toBe(false);
    const future = new Date(Date.now() + 5000);
    utimesSync(artifactPath(c, "siteSpecMd"), future, future);
    expect(isStale(c, "siteSpecMd", "siteSpecJson")).toBe(true);
  });
  it("isStale is false when either file is missing", () => {
    const c = ctx();
    writeFileSync(artifactPath(c, "siteSpecMd"), "# spec");
    expect(isStale(c, "siteSpecMd", "siteSpecJson")).toBe(false);
  });
  it("lists every artifact name the pipeline uses", () => {
    expect(ARTIFACTS.brief).toBe("brief.md");
    expect(ARTIFACTS.designTokensJson).toBe("design-tokens.json");
    expect(ARTIFACTS.previewHtml).toBe("preview.html");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/artifacts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/artifacts.ts
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SiteContext } from "./docker.js";

export const ARTIFACTS = {
  brief: "brief.md",
  siteSpecJson: "site-spec.json",
  siteSpecMd: "SITE-SPEC.md",
  designSystemMd: "design-system.md",
  designTokensJson: "design-tokens.json",
  previewHtml: "preview.html",
  previewTree: "design/preview.gb.json",
  previewMarkup: "design/preview.gb.html",
} as const;
export type ArtifactKey = keyof typeof ARTIFACTS;

const PRODUCER: Partial<Record<ArtifactKey, string>> = {
  siteSpecJson: "spec", siteSpecMd: "spec", designSystemMd: "design", designTokensJson: "design", previewHtml: "design",
};

export function artifactPath(ctx: SiteContext, key: ArtifactKey): string {
  return join(ctx.siteDir, ARTIFACTS[key]);
}

export function hasArtifact(ctx: SiteContext, key: ArtifactKey): boolean {
  return existsSync(artifactPath(ctx, key));
}

export function readJsonArtifact<T>(ctx: SiteContext, key: ArtifactKey, parse: (u: unknown) => T): T {
  const p = artifactPath(ctx, key);
  if (!existsSync(p)) {
    const hint = PRODUCER[key] ? ` — run the ${PRODUCER[key]} stage first (faktory run ${ctx.slug} --only ${PRODUCER[key]})` : "";
    throw new Error(`${ARTIFACTS[key]} not found in ${ctx.siteDir}${hint}`);
  }
  return parse(JSON.parse(readFileSync(p, "utf8")));
}

export function writeJsonArtifact(ctx: SiteContext, key: ArtifactKey, data: unknown): void {
  const p = artifactPath(ctx, key);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

export function writeTextArtifact(ctx: SiteContext, key: ArtifactKey, text: string): void {
  const p = artifactPath(ctx, key);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text.endsWith("\n") ? text : text + "\n");
}

/** True when the human-editable markdown was modified after its JSON twin (1 s tolerance for fs timestamp granularity). */
export function isStale(ctx: SiteContext, mdKey: ArtifactKey, jsonKey: ArtifactKey): boolean {
  const md = artifactPath(ctx, mdKey), json = artifactPath(ctx, jsonKey);
  if (!existsSync(md) || !existsSync(json)) return false;
  return statSync(md).mtimeMs > statSync(json).mtimeMs + 1000;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/artifacts.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/artifacts.ts tests/unit/artifacts.test.ts
git commit -m "feat(faktory): artifact paths, JSON artifact IO and markdown staleness check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 3: Deterministic SITE-SPEC.md renderer

**Files:**
- Create: `src/render/site-spec-md.ts`
- Test: `tests/unit/site-spec-md.test.ts`

**Interfaces:**
- Consumes: `SiteSpec` type from Task 1.
- Produces: `renderSiteSpecMarkdown(spec: SiteSpec): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/site-spec-md.test.ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/site-spec-md.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the renderer**

```ts
// src/render/site-spec-md.ts
import type { SiteSpec } from "../schemas/site-spec.js";

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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/site-spec-md.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render tests/unit/site-spec-md.test.ts
git commit -m "feat(faktory): deterministic SITE-SPEC.md renderer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 4: Prompt loader and the spec / design system prompts

**Files:**
- Create: `src/prompts.ts`, `src/prompts/spec.md`, `src/prompts/design.md`
- Test: `tests/unit/prompts.test.ts`

**Interfaces:**
- Consumes: `pluginPath(config)` from `src/agent.ts`.
- Produces: `loadPrompt(name: "spec" | "design"): string`, `designDoctrine(config: FaktoryConfig): string` (contents of the skill's `references/design-system.md`, or an empty string with a console warning when skills are not synced), `designSystemPrompt(config): string` = design prompt + doctrine.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/prompts.test.ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { loadPrompt, designDoctrine, designSystemPrompt } from "../../src/prompts.js";

describe("prompts", () => {
  it("loads the spec prompt with its key rules", () => {
    const p = loadPrompt("spec");
    expect(p).toContain("brief.md");
    expect(p).toContain("exactement une page `home`");
    expect(p).toContain("[à confirmer]");
  });
  it("loads the design prompt with the artifact names and tool names", () => {
    const p = loadPrompt("design");
    for (const s of ["design-system.md", "design/preview.gb.json", "design/preview.gb.html", "preview.html", "gb_build", "gb_preview"]) expect(p).toContain(s);
  });
  it("appends the doctrine when skills are synced, warns otherwise", () => {
    const config = loadConfig(process.cwd());
    const synced = existsSync("plugin/skills/generatepress-generateblocks/references/design-system.md");
    const d = designDoctrine(config);
    if (synced) expect(d).toContain("Establish a system first");
    else expect(d).toBe("");
    expect(designSystemPrompt(config).startsWith(loadPrompt("design"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/prompts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the loader**

```ts
// src/prompts.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FaktoryConfig } from "./config.js";
import { pluginPath } from "./agent.js";

export type PromptName = "spec" | "design";

export function loadPrompt(name: PromptName): string {
  return readFileSync(fileURLToPath(new URL(`./prompts/${name}.md`, import.meta.url)), "utf8");
}

export function designDoctrine(config: FaktoryConfig): string {
  const p = join(pluginPath(config), "skills", "generatepress-generateblocks", "references", "design-system.md");
  if (!existsSync(p)) { console.warn(`⚠ ${p} missing — run npm run sync-skills; design prompt continues without the doctrine`); return ""; }
  return readFileSync(p, "utf8");
}

export function designSystemPrompt(config: FaktoryConfig): string {
  const doctrine = designDoctrine(config);
  return doctrine ? `${loadPrompt("design")}\n\n---\n\n# Doctrine de design (références/design-system.md)\n\n${doctrine}` : loadPrompt("design");
}
```

- [ ] **Step 4: Write `src/prompts/spec.md`**

```markdown
Tu es l'architecte de l'information de Partikuls, une agence qui livre des sites WordPress (GeneratePress + GenerateBlocks) à des PME, associations et collectivités françaises.

Ta mission : transformer `brief.md` (dans le dossier courant) en une spécification de site structurée. Tu ne rédiges pas le site, tu décides ce qu'il contient.

## Méthode
1. Lis `brief.md` en entier avec l'outil Read. Ne lis rien d'autre.
2. Déduis : identité, arborescence, sections par page, fonctionnalités nécessitant un plugin, formulaires, SEO local, blog, menus.
3. Réponds uniquement avec la structure demandée (sortie structurée). Pas de prose autour.

## Règles
- Langue : tout en français (titres, accroches, libellés). `identity.language` vaut toujours `fr`.
- Arborescence : exactement une page `home`. Une page `blog` si le brief demande des actualités/articles. Une page `contact` quand il y a un formulaire de contact. Les autres sont `standard`. 4 à 8 pages en général, jamais plus que le brief ne le justifie.
- Slugs en kebab-case, courts, sans accents (`nos-produits`, pas `nos-produits-artisanaux-de-qualite`).
- Sections : 3 à 6 par page, typées (`hero`, `features`, `text`, `gallery`, `testimonials`, `faq`, `cta`, `contact`, `form`, `custom-query`, `hours`). Chaque page commence par un `hero` sauf la page `blog`. `summary` décrit ce que montre la section et donne des pistes de copy courtes et factuelles dérivées du brief.
- Fonctionnalités (`features`) : uniquement quand le brief demande du contenu géré depuis l'admin (catalogue, équipe, horaires modifiables, événements…). Une feature = un CPT (`cpt.slug` ≤ 19 caractères, snake_case), ses champs, ses taxonomies avec des termes initiaux, et `display` qui dit où et comment c'est affiché. Les sections qui affichent cette donnée sont de type `custom-query` et référencent `feature` par son `id`. Si le brief ne demande rien de tel, `features` est vide.
- Horaires : si le brief demande des horaires modifiables, c'est une section `hours` (pas une feature) ; mets les horaires connus dans `identity.contact.hours`.
- Formulaires : un par besoin (devis, contact…), destinataire = l'email du brief. Les sections `form`/`contact` référencent le formulaire par `id`.
- SEO : titre ≤ 70 caractères, meta description ≤ 160, mots-clés locaux quand le brief mentionne une ville ou un quartier.
- Blog : 3 à 5 sujets d'articles concrets, 1 à 3 catégories.
- Menus : `primary` = 4 à 7 slugs dans l'ordre de lecture, accueil en premier. `footer` = les pages utiles hors accueil.
- N'invente jamais une donnée factuelle absente du brief (adresse, téléphone, prix, dates) : écris `[à confirmer]` à la place. Tu peux en revanche proposer titres, accroches et sujets d'articles.
- Ton : celui demandé par le brief ; par défaut sobre et chaleureux, jamais kitsch.
```

- [ ] **Step 5: Write `src/prompts/design.md`**

```markdown
Tu es le directeur artistique de Partikuls. Tu poses le système de design d'un site WordPress GeneratePress + GenerateBlocks à partir d'une spécification et d'un brief. Tu travailles dans le dossier du site (cwd) : tous les chemins ci-dessous sont relatifs à ce dossier.

## Entrées (à lire avec Read, dans cet ordre)
1. `site-spec.json` — identité, arborescence, sections.
2. `brief.md` — le ton, les envies du client, les contraintes.

## Sorties attendues (dans cet ordre)
1. **`design-system.md`** (Write) — en français, structuré comme un vrai guide de marque, 150 à 300 lignes :
   `# <Nom> — Design System Web`, puis les sections `## 1. Identité de marque` (positionnement, ton, logo texte), `## 2. Typographies` (familles Google Fonts, rôles, échelle en tableau), `## 3. Couleurs` (tableau des 8 couleurs GeneratePress avec slug CSS `--base`, `--base-2`, `--base-3`, `--contrast`, `--contrast-2`, `--contrast-3`, `--accent`, `--accent-2`, hex et usage ; règle des 90/10), `## 4. Espacements` (gamme et règles), `## 5. Formes & rayons`, `## 6. Composants` (boutons, cartes, navigation, formulaires : états hover/focus), `## 7. Layout & grille` (largeur de conteneur, patterns de sections), `## 8. Responsive`, `## 9. Accessibilité` (contraste ≥ 4,5:1 vérifié pour contrast/base et base-3/accent), `## 10. Tokens` (un bloc JSON identique à ta sortie structurée finale).
2. **`design/preview.gb.json`** (Write) — un tableau JSON de 3 sections GenerateBlocks pour la page `home` : le `hero`, une section de contenu (features ou custom-query rendue avec des cartes statiques d'exemple) et le `cta`. Format : arbre `gb_build` (`type`, `tagName`, `styles` camelCase, `innerBlocks`, `content`, `htmlAttributes`). Couleurs via `var(--base)`, `var(--accent)`… jamais de hex dans l'arbre. Breakpoint mobile `@media (max-width:767px)` sur tout ce qui doit s'empiler. Images : `https://placehold.co/800x600` avec `alt` rempli. Copy courte dérivée de la spec.
3. Compile avec l'outil **`gb_build`** : `{ "tree": <le tableau>, "out": "design/preview.gb.html" }`.
4. Rends visible avec l'outil **`gb_preview`** : `{ "markup": "design/preview.gb.html", "out": "preview.html", "palette": { "base": "#…", "base-2": "#…", "base-3": "#…", "contrast": "#…", "contrast-2": "#…", "contrast-3": "#…", "accent": "#…", "accent-2": "#…" }, "fonts": [{ "family": "<heading>", "variants": "400,700" }, { "family": "<body>", "variants": "400,600" }], "headingFont": "<heading>", "bodyFont": "<body>", "containerWidth": <px> }`. Relis `preview.html` (Read) et corrige l'arbre si la hiérarchie, les espacements ou le responsive ne tiennent pas. Deux allers-retours maximum.
5. **Réponse finale** : uniquement les tokens, dans la structure demandée (sortie structurée). Les hex sont en 6 chiffres, les polices sont des familles Google Fonts réelles et orthographiées exactement, `spacing` est une gamme croissante, `h1 ≥ h2 ≥ h3 ≥ h4 ≥ body`.

## Règles
- Un système, pas un catalogue : une gamme d'espacement, une échelle typographique (ratio ≈ 1,25), un rayon, un accent dominant (10 % de la page) et un accent secondaire discret.
- Pars du brief : les couleurs et les polices doivent raconter le secteur et le ton (une boulangerie n'a pas la palette d'un cabinet d'avocats). Évite les gris/bleus génériques sauf demande explicite.
- Mobile d'abord : `sectionPadding.mobile` ≈ 55–60 % du desktop, titres fluides, grilles qui s'empilent.
- Accessibilité : contraste texte/fond ≥ 4,5:1 ; calcule-le pour `contrast` sur `base` et pour le texte des boutons sur `accent` (choisis `base3` ou `contrast` comme couleur de texte de bouton selon le résultat).
- Pas de Bash, pas d'écriture hors du dossier courant, pas de nouveaux fichiers en dehors de ceux listés.
- Tu peux charger la skill `faktory-skills:generatepress-generateblocks` si tu as besoin du format exact des blocs.
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/prompts.test.ts && npm run typecheck`
Expected: 3 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/prompts.ts src/prompts tests/unit/prompts.test.ts
git commit -m "feat(faktory): prompt loader with spec and design system prompts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 5: `gbBuild` / `gbPreview` wrappers with palette and font injection

**Files:**
- Create: `src/gb.ts`
- Test: `tests/unit/gb.test.ts`

**Interfaces:**
- Consumes: `run` from `src/exec.ts`, `DesignTokens` from Task 1. (No import from `src/agent.ts`: it would create the cycle agent → tools/server → gb → agent.)
- Produces: `gbScript(config, name)`, `gbBuild(config, tree: unknown): Promise<string>` (markup), `type PreviewOptions = { palette?: Record<string, string>; fonts?: { family: string; variants?: string }[]; headingFont?: string; bodyFont?: string; containerWidth?: number }`, `gbPreview(config, markupPath: string, outPath: string, opts?: PreviewOptions): Promise<void>`, `previewOptionsFromTokens(tokens: DesignTokens): PreviewOptions`, `countBlocks(markup: string): number`, `deps = { run }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/gb.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { gbScript, gbBuild, gbPreview, previewOptionsFromTokens, countBlocks, deps } from "../../src/gb.js";
import { parseDesignTokens } from "../../src/schemas/design-tokens.js";

const config = loadConfig(process.cwd());
const synced = existsSync(gbScript(config, "gb_build.py"));
const tokens = parseDesignTokens(JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8")));

describe("gbScript / previewOptionsFromTokens / countBlocks (pure)", () => {
  it("points at the synced skill scripts", () => {
    expect(gbScript(config, "gb_preview.py")).toBe(join(config.repoRoot, "plugin/skills/generatepress-generateblocks/scripts/gb_preview.py"));
  });
  it("maps tokens to GP css variable names and fonts", () => {
    const o = previewOptionsFromTokens(tokens);
    expect(o.palette).toEqual({ base: "#faf6ef", "base-2": "#f1e8d8", "base-3": "#ffffff", contrast: "#2b1d0e", "contrast-2": "#6b5a46", "contrast-3": "#d9cdb8", accent: "#7a8b6f", "accent-2": "#c89b3c" });
    expect(o.fonts).toEqual([{ family: "Fraunces", variants: "400,600,700" }, { family: "Source Sans 3", variants: "400,600" }]);
    expect(o.headingFont).toBe("Fraunces"); expect(o.bodyFont).toBe("Source Sans 3"); expect(o.containerWidth).toBe(1140);
  });
  it("counts GenerateBlocks opening delimiters", () => {
    expect(countBlocks("<!-- wp:generateblocks/element {} -->\n<div></div>\n<!-- /wp:generateblocks/element -->\n<!-- wp:generateblocks/text {} -->x<!-- /wp:generateblocks/text -->")).toBe(2);
  });
  it("surfaces python failures with stderr", async () => {
    vi.spyOn(deps, "run").mockResolvedValue({ stdout: "", stderr: "Traceback: boom", code: 1 });
    await expect(gbBuild(config, {})).rejects.toThrow(/gb_build.py failed.*boom/);
  });
  afterEach(() => vi.restoreAllMocks());
});

describe.skipIf(!synced)("gbBuild / gbPreview (python3)", () => {
  const tree = [{ type: "element", tagName: "section", styles: { backgroundColor: "var(--base-2)", padding: "64px 24px", "@media (max-width:767px)": { padding: "32px 16px" } },
    innerBlocks: [{ type: "text", tagName: "h1", content: "Bonjour", styles: { color: "var(--contrast)" } }] }];
  it("compiles a tree into markup with css and escaped double dashes", async () => {
    const markup = await gbBuild(config, tree);
    expect(markup).toContain("wp:generateblocks/element");
    expect(markup).toContain("\\u002d\\u002dbase-2");
    expect(markup).toMatch(/"css":".gb-element-[a-f0-9]{8}\{background-color:var\(/);
    expect(countBlocks(markup)).toBe(2);
  });
  it("previews with an injected palette, fonts and container width", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fk-gb-"));
    const markupPath = join(dir, "preview.gb.html"), out = join(dir, "preview.html");
    writeFileSync(markupPath, await gbBuild(config, tree));
    await gbPreview(config, markupPath, out, previewOptionsFromTokens(tokens));
    const html = readFileSync(out, "utf8");
    expect(html).toContain("--accent:#7a8b6f");
    expect(html).toContain("--gb-container-width:1140px");
    expect(html).toContain("fonts.googleapis.com/css2?family=Fraunces:wght@400;600;700&family=Source+Sans+3:wght@400;600");
    expect(html).toContain('body{font-family:"Source Sans 3"');
    expect(html).toContain('h1,h2,h3,h4,h5,h6{font-family:"Fraunces"');
    expect(html).toContain("<h1");
    expect(html).not.toContain("wp:generateblocks");
  });
  it("keeps the stub palette when no options are given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fk-gb-"));
    const markupPath = join(dir, "p.html"), out = join(dir, "p.preview.html");
    writeFileSync(markupPath, await gbBuild(config, tree));
    await gbPreview(config, markupPath, out);
    expect(readFileSync(out, "utf8")).toContain("--accent:#2563eb");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/gb.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/gb.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FaktoryConfig } from "./config.js";
import { run } from "./exec.js";
import type { DesignTokens } from "./schemas/design-tokens.js";

export const deps = { run };

/** Script path inside the synced plugin (same root as `pluginPath()` in agent.ts, inlined to avoid an import cycle agent → tools/server → gb → agent). */
export function gbScript(config: FaktoryConfig, name: "gb_build.py" | "gb_preview.py"): string {
  return join(config.repoRoot, "plugin", "skills", "generatepress-generateblocks", "scripts", name);
}

export function countBlocks(markup: string): number {
  return (markup.match(/<!-- wp:generateblocks(?:-pro)?\//g) ?? []).length;
}

/** Compile a gb_build tree (node or array of nodes) into GenerateBlocks markup. */
export async function gbBuild(config: FaktoryConfig, tree: unknown): Promise<string> {
  const r = await deps.run("python3", [gbScript(config, "gb_build.py")], { input: JSON.stringify(tree) });
  if (r.code !== 0) throw new Error(`gb_build.py failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

export type PreviewOptions = {
  palette?: Record<string, string>;
  fonts?: { family: string; variants?: string }[];
  headingFont?: string;
  bodyFont?: string;
  containerWidth?: number;
};

const PALETTE_VAR: Record<keyof DesignTokens["palette"], string> = {
  base: "base", base2: "base-2", base3: "base-3", contrast: "contrast", contrast2: "contrast-2", contrast3: "contrast-3", accent: "accent", accent2: "accent-2",
};

export function previewOptionsFromTokens(t: DesignTokens): PreviewOptions {
  const palette: Record<string, string> = {};
  for (const [k, v] of Object.entries(PALETTE_VAR)) palette[v] = t.palette[k as keyof DesignTokens["palette"]];
  return {
    palette,
    fonts: [{ family: t.fonts.heading.family, variants: t.fonts.heading.variants }, { family: t.fonts.body.family, variants: t.fonts.body.variants }],
    headingFont: t.fonts.heading.family,
    bodyFont: t.fonts.body.family,
    containerWidth: t.containerWidth,
  };
}

export function googleFontsHref(fonts: { family: string; variants?: string }[]): string {
  const fam = fonts.map((f) => {
    const weights = (f.variants ?? "400").split(",").map((v) => v.trim()).filter((v) => /^\d+$/.test(v));
    return `family=${f.family.replace(/ /g, "+")}${weights.length ? `:wght@${weights.join(";")}` : ""}`;
  });
  return `https://fonts.googleapis.com/css2?${fam.join("&")}&display=swap`;
}

function injectPreviewOptions(html: string, opts: PreviewOptions): string {
  let out = html;
  if (opts.palette || opts.containerWidth) {
    out = out.replace(/:root\{[^}]*\}/, (block) => {
      let b = block;
      for (const [name, color] of Object.entries(opts.palette ?? {})) {
        const re = new RegExp(`--${name}:[^;]*;`);
        b = re.test(b) ? b.replace(re, `--${name}:${color};`) : b.replace(/\}$/, `--${name}:${color};}`);
      }
      if (opts.containerWidth) b = b.replace(/--gb-container-width:[^;]*;/, `--gb-container-width:${opts.containerWidth}px;`);
      return b;
    });
  }
  const extra: string[] = [];
  if (opts.fonts?.length) extra.push(`<link rel="stylesheet" href="${googleFontsHref(opts.fonts)}">`);
  const css: string[] = [];
  if (opts.bodyFont) css.push(`body{font-family:"${opts.bodyFont}",system-ui,sans-serif;}`);
  if (opts.headingFont) css.push(`h1,h2,h3,h4,h5,h6{font-family:"${opts.headingFont}",serif;}`);
  if (css.length) extra.push(`<style>${css.join("")}</style>`);
  if (extra.length) out = out.replace("</head>", `${extra.join("\n")}\n</head>`);
  return out;
}

/** Render markup to a standalone HTML page via gb_preview.py, then patch palette/fonts/width into it. */
export async function gbPreview(config: FaktoryConfig, markupPath: string, outPath: string, opts: PreviewOptions = {}): Promise<void> {
  const r = await deps.run("python3", [gbScript(config, "gb_preview.py"), markupPath, "-o", outPath]);
  if (r.code !== 0) throw new Error(`gb_preview.py failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  if (Object.keys(opts).length) writeFileSync(outPath, injectPreviewOptions(readFileSync(outPath, "utf8"), opts));
}
```

Note: the `:root{…}` block in `gb_preview.py`'s shell spans several lines; the `[^}]*` regex covers newlines because `[^}]` matches them. Names with dashes (`base-2`) are inserted literally in the RegExp; they contain no special characters.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/gb.test.ts`
Expected: 7 PASS (4 pure + 3 python) on a synced machine.

- [ ] **Step 5: Commit**

```bash
git add src/gb.ts tests/unit/gb.test.ts
git commit -m "feat(faktory): gb_build/gb_preview wrappers with token-driven preview palette and fonts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 6: `gb_build` and `gb_preview` MCP tools

**Files:**
- Modify: `src/tools/server.ts`
- Test: `tests/unit/tools-server.test.ts` (append)

**Interfaces:**
- Consumes: `gbBuild`, `gbPreview`, `countBlocks`, `deps as gbDeps` from `src/gb.ts`. Do not import `src/agent.ts` here (agent.ts imports this module).
- Produces: `TOOL_GB_BUILD = "mcp__faktory__gb_build"`, `TOOL_GB_PREVIEW = "mcp__faktory__gb_preview"`, `resolveSitePath(ctx, rel: string): string` (throws when the path escapes the site dir), `gbBuildToolHandler(ctx)`, `gbPreviewToolHandler(ctx)`; `createFaktoryServer(ctx)` now registers three tools.

- [ ] **Step 1: Append the failing tests**

```ts
// tests/unit/tools-server.test.ts — add these imports at the top…
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gbScript, deps as gbDeps } from "../../src/gb.js";
import { resolveSitePath, gbBuildToolHandler, gbPreviewToolHandler, TOOL_GB_BUILD, TOOL_GB_PREVIEW } from "../../src/tools/server.js";

// …and these suites at the bottom
describe("resolveSitePath", () => {
  it("joins relative paths and rejects escapes", () => {
    expect(resolveSitePath(ctx, "design/preview.gb.html")).toBe("/tmp/fk/sites/demo/design/preview.gb.html");
    expect(() => resolveSitePath(ctx, "../other/x.html")).toThrow(/inside the site directory/);
    expect(() => resolveSitePath(ctx, "/etc/passwd")).toThrow(/inside the site directory/);
  });
});

describe("gb tools", () => {
  const tmpCtx = () => ({ ...ctx, siteDir: mkdtempSync(join(tmpdir(), "fk-tools-")) });
  it("exposes the tool names", () => {
    expect(TOOL_GB_BUILD).toBe("mcp__faktory__gb_build");
    expect(TOOL_GB_PREVIEW).toBe("mcp__faktory__gb_preview");
  });
  it("gb_build writes the compiled markup and reports the block count", async () => {
    vi.spyOn(gbDeps, "run").mockResolvedValue({ stdout: "<!-- wp:generateblocks/element {} -->\n<div></div>\n<!-- /wp:generateblocks/element -->\n", stderr: "", code: 0 });
    const c = tmpCtx();
    const r = await gbBuildToolHandler(c)({ tree: [{ type: "element" }], out: "design/preview.gb.html" });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toMatch(/Wrote design\/preview.gb.html \(1 block/);
    expect(readFileSync(join(c.siteDir, "design/preview.gb.html"), "utf8")).toContain("wp:generateblocks/element");
  });
  it("gb_build reports python errors as tool errors", async () => {
    vi.spyOn(gbDeps, "run").mockResolvedValue({ stdout: "", stderr: "KeyError: 'type'", code: 1 });
    const r = await gbBuildToolHandler(tmpCtx())({ tree: {}, out: "x.html" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("KeyError");
  });
  it("gb_build refuses to write outside the site dir without running python", async () => {
    const spy = vi.spyOn(gbDeps, "run");
    const r = await gbBuildToolHandler(tmpCtx())({ tree: {}, out: "../../x.html" });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  it("gb_preview requires an existing markup file", async () => {
    const r = await gbPreviewToolHandler(tmpCtx())({ markup: "design/missing.html", out: "preview.html" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/not found/);
  });
  it.skipIf(!existsSync(gbScript(ctx.config, "gb_preview.py")))("gb_preview renders and injects the palette (python3)", async () => {
    const c = { ...tmpCtx(), config: loadConfig(process.cwd()) };
    writeFileSync(join(c.siteDir, "m.html"), '<!-- wp:generateblocks/text {"uniqueId":"abcd1234","tagName":"p","css":".gb-text-abcd1234{color:var(\\u002d\\u002daccent)}"} -->\n<p class="gb-text gb-text-abcd1234">Hi</p>\n<!-- /wp:generateblocks/text -->\n');
    const r = await gbPreviewToolHandler(c)({ markup: "m.html", out: "preview.html", palette: { accent: "#123456" }, fonts: [{ family: "Fraunces", variants: "400,700" }], headingFont: "Fraunces" });
    expect(r.isError).toBeFalsy();
    const html = readFileSync(join(c.siteDir, "preview.html"), "utf8");
    expect(html).toContain("--accent:#123456");
    expect(html).toContain("family=Fraunces:wght@400;700");
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run tests/unit/tools-server.test.ts`
Expected: FAIL — `resolveSitePath` is not exported.

- [ ] **Step 3: Extend the server**

Replace `src/tools/server.ts` imports and add the tools (keep the existing `wp` tool, `FORBIDDEN`, `forbidden`, `clip`, `wpToolHandler` unchanged):

```ts
// src/tools/server.ts — new imports
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { gbBuild, gbPreview, countBlocks, type PreviewOptions } from "../gb.js";

export const TOOL_GB_BUILD = `mcp__${FAKTORY_SERVER}__gb_build`;
export const TOOL_GB_PREVIEW = `mcp__${FAKTORY_SERVER}__gb_preview`;

/** Resolve a tool-supplied path against the site dir; absolute paths and `..` escapes are refused. (Same check as `isInside` in agent.ts, inlined: agent.ts imports this module.) */
export function resolveSitePath(ctx: SiteContext, rel: string): string {
  const base = resolve(ctx.siteDir), abs = resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + sep)) throw new Error(`Path "${rel}" must stay inside the site directory`);
  return abs;
}

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

export function gbBuildToolHandler(ctx: SiteContext) {
  return async (input: { tree: unknown; out: string }) => {
    try {
      const abs = resolveSitePath(ctx, input.out);
      const markup = await gbBuild(ctx.config, input.tree);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, markup);
      const n = countBlocks(markup);
      return ok(`Wrote ${input.out} (${n} block${n === 1 ? "" : "s"}, ${Buffer.byteLength(markup)} bytes). Next: gb_preview to render it.`);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

export function gbPreviewToolHandler(ctx: SiteContext) {
  return async (input: { markup: string; out: string } & PreviewOptions) => {
    try {
      const src = resolveSitePath(ctx, input.markup);
      const dst = resolveSitePath(ctx, input.out);
      if (!existsSync(src)) return fail(`Markup file not found: ${input.markup} — run gb_build first`);
      mkdirSync(dirname(dst), { recursive: true });
      const { markup: _m, out: _o, ...opts } = input;
      await gbPreview(ctx.config, src, dst, opts);
      return ok(`Wrote ${input.out}. Read it to inspect the compiled HTML/CSS, or open it in a browser.`);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}
```

And in `createFaktoryServer`:

```ts
export function createFaktoryServer(ctx: SiteContext) {
  const wp = tool(/* unchanged */);
  const gbBuildTool = tool(
    "gb_build",
    "Compile a GenerateBlocks tree (gb_build.py JSON: a node or an array of section nodes with type/tagName/styles/innerBlocks/content/htmlAttributes) into WordPress block markup and write it to `out` (path relative to the site directory).",
    {
      tree: z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]).describe("gb_build.py tree"),
      out: z.string().describe("Output markup path relative to the site dir, e.g. design/preview.gb.html"),
    },
    gbBuildToolHandler(ctx),
  );
  const gbPreviewTool = tool(
    "gb_preview",
    "Render compiled GenerateBlocks markup into a standalone preview HTML (stub GeneratePress shell). Optionally inject the palette (keys: base, base-2, base-3, contrast, contrast-2, contrast-3, accent, accent-2 → hex), Google Fonts, heading/body font families and the container width so the preview matches the design tokens.",
    {
      markup: z.string().describe("Markup path relative to the site dir (output of gb_build)"),
      out: z.string().describe("Preview HTML path relative to the site dir, e.g. preview.html"),
      palette: z.record(z.string(), z.string()).optional(),
      fonts: z.array(z.object({ family: z.string(), variants: z.string().optional() })).optional(),
      headingFont: z.string().optional(),
      bodyFont: z.string().optional(),
      containerWidth: z.number().int().optional(),
    },
    gbPreviewToolHandler(ctx),
  );
  return createSdkMcpServer({ name: FAKTORY_SERVER, version: "0.1.0", tools: [wp, gbBuildTool, gbPreviewTool] });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/tools-server.test.ts && npm run typecheck`
Expected: all PASS (existing wp tests + 7 new).

- [ ] **Step 5: Commit**

```bash
git add src/tools/server.ts tests/unit/tools-server.test.ts
git commit -m "feat(faktory): gb_build and gb_preview MCP tools scoped to the site directory

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 7: Pipeline `onApprove`, cost budget, `wpOk` stdin, CLI flags

**Files:**
- Modify: `src/pipeline.ts`, `src/config.ts`, `src/agent.ts`, `src/wp.ts`, `src/cli.ts`, `faktory.config.json`
- Test: `tests/unit/pipeline.test.ts` (append), `tests/unit/config.test.ts` (append), `tests/unit/wp.test.ts` (append), `tests/unit/agent.test.ts` (append)

**Interfaces:**
- Produces: `Stage.onApprove?(ctx: SiteContext): Promise<string | void>`; `approveSite(config, slug, opts?: { stages? }): Promise<SiteState>`; `FaktoryConfig.maxCostUsd: number` (default 40); `runSite` throws `Cost budget reached` before starting a stage when `state.costUsd >= config.maxCostUsd`; `remainingBudget(ctx): number`; `runAgent` passes `maxBudgetUsd`; `wpOk(ctx, args, opts?: { input?: string })`; CLI `run --max-cost <usd>`, `approve` awaits `onApprove`.

- [ ] **Step 1: Append failing tests**

```ts
// tests/unit/pipeline.test.ts — append inside the file (imports already cover runSite/approveSite/readState/siteDir/setStage/writeState/setup/ok)
describe("approveSite with onApprove", () => {
  it("runs the checkpoint stage's onApprove and stores its message", async () => {
    const config = await setup();
    const spec: Stage = { name: "spec", checkpoint: true, run: async () => "spec ok", onApprove: async () => "site-spec.json re-synced" };
    await runSite(config, "pp", { stages: { spec } });
    const s = await approveSite(config, "pp", { stages: { spec } });
    expect(s.stages.spec.status).toBe("done");
    expect(s.stages.spec.message).toBe("site-spec.json re-synced");
  });
  it("keeps the stage awaiting approval when onApprove throws", async () => {
    const config = await setup();
    const spec: Stage = { name: "spec", checkpoint: true, run: async () => "ok", onApprove: async () => { throw new Error("md invalid"); } };
    await runSite(config, "pp", { stages: { spec } });
    await expect(approveSite(config, "pp", { stages: { spec } })).rejects.toThrow("md invalid");
    expect(readState(siteDir(config, "pp")).stages.spec.status).toBe("awaiting_approval");
  });
  it("defaults the message to approved when there is no onApprove", async () => {
    const config = await setup();
    await runSite(config, "pp", { stages: { spec: ok("spec", true) } });
    const s = await approveSite(config, "pp");
    expect(s.stages.spec.message).toBe("approved");
  });
});

describe("cost budget", () => {
  it("refuses to start a stage once the budget is spent", async () => {
    const config = await setup();
    const dir = siteDir(config, "pp");
    writeState(dir, { ...readState(dir), costUsd: 40 });
    await expect(runSite(config, "pp", { stages: { spec: ok("spec") } })).rejects.toThrow(/Cost budget reached \(\$40.00 >= \$40\)/);
    expect(readState(dir).stages.spec.status).toBe("pending");
  });
  it("honours a raised budget from config", async () => {
    const config = { ...(await setup()), maxCostUsd: 100 };
    const dir = siteDir(config, "pp");
    writeState(dir, { ...readState(dir), costUsd: 40 });
    const log: string[] = [];
    await runSite(config, "pp", { stages: { spec: ok("spec", false, log) } });
    expect(log).toEqual(["spec"]);
  });
});
```

```ts
// tests/unit/config.test.ts — append
it("defaults maxCostUsd to 40 and accepts an override", () => {
  expect(loadConfig("/tmp/nonexistent-fk").maxCostUsd).toBe(40);
  const dir = mkdtempSync(join(tmpdir(), "fk-cfg-"));
  writeFileSync(join(dir, "faktory.config.json"), JSON.stringify({ maxCostUsd: 12.5, models: { default: "claude-opus-5", resync: "claude-sonnet-5" } }));
  const c = loadConfig(dir);
  expect(c.maxCostUsd).toBe(12.5);
  expect(c.models.resync).toBe("claude-sonnet-5");
});
```
(Add `mkdtempSync, writeFileSync` / `tmpdir` / `join` imports if the file lacks them.)

```ts
// tests/unit/wp.test.ts — append
it("wpOk forwards stdin", async () => {
  const spy = vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "Success\n", stderr: "", code: 0 });
  await wpOk(ctx, ["option", "update", "generate_settings", "--format=json"], { input: "{\"a\":1}" });
  expect(spy).toHaveBeenCalledWith(ctx, "wpcli", ["wp", "option", "update", "generate_settings", "--format=json"], { input: "{\"a\":1}" });
});
```
(Reuse the `ctx` and `deps` already set up in that file; import `wpOk` if missing.)

```ts
// tests/unit/agent.test.ts — append
import { remainingBudget } from "../../src/agent.js";
describe("remainingBudget", () => {
  const base = { config: loadConfig("/tmp/fk"), slug: "d", siteDir: "/tmp/fk/sites/d", state: createState("d", 8100, "pw") };
  it("is maxCostUsd minus spent, floored at 0.05", () => {
    expect(remainingBudget({ ...base, state: { ...base.state, costUsd: 10 } })).toBe(30);
    expect(remainingBudget({ ...base, state: { ...base.state, costUsd: 45 } })).toBe(0.05);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/pipeline.test.ts tests/unit/config.test.ts tests/unit/wp.test.ts tests/unit/agent.test.ts`
Expected: FAIL (onApprove/maxCostUsd/remainingBudget/stdin not implemented).

- [ ] **Step 3: Config**

In `src/config.ts` add `maxCostUsd: z.number().positive().default(40)` to `ConfigFile`, `maxCostUsd: number` to `FaktoryConfig`, and `maxCostUsd: parsed.maxCostUsd` in the returned object. Update `faktory.config.json`:

```json
{
  "portBase": 8100,
  "adminEmail": "khelil@partikuls.com",
  "maxCostUsd": 40,
  "models": { "default": "claude-opus-5", "resync": "claude-sonnet-5" }
}
```

- [ ] **Step 4: Pipeline**

In `src/pipeline.ts`:

```ts
export interface Stage {
  name: StageName;
  checkpoint?: boolean;
  run(ctx: SiteContext): Promise<string | void>;
  /** Runs at `faktory approve` for checkpoint stages (e.g. re-sync JSON from an edited markdown). Throwing keeps the stage awaiting approval. */
  onApprove?(ctx: SiteContext): Promise<string | void>;
}
```

In `runSite`, inside the `for (const name of plan)` loop, before `persist(ctx, setStage(ctx.state, name, "running"))`:

```ts
    if (ctx.state.costUsd >= config.maxCostUsd) {
      throw new Error(`Cost budget reached ($${ctx.state.costUsd.toFixed(2)} >= $${config.maxCostUsd}); raise maxCostUsd in faktory.config.json or pass --max-cost to continue`);
    }
```

Replace `approveSite`:

```ts
export async function approveSite(config: FaktoryConfig, slug: string, opts: { stages?: Partial<Record<StageName, Stage>> } = {}): Promise<SiteState> {
  const ctx = loadContext(config, slug);
  const waiting = awaitingStage(ctx.state);
  if (!waiting) throw new Error(`Nothing awaits approval for "${slug}"`);
  const stage = (opts.stages ?? registry)[waiting];
  const msg = stage?.onApprove ? await stage.onApprove(ctx) : undefined;
  return persist(ctx, setStage(ctx.state, waiting, "done", msg ?? "approved"));
}
```

- [ ] **Step 5: Agent budget**

In `src/agent.ts` add and use:

```ts
export function remainingBudget(ctx: SiteContext): number {
  return Math.max(0.05, Math.round((ctx.config.maxCostUsd - ctx.state.costUsd) * 100) / 100);
}
```
and in the `query()` options: `maxBudgetUsd: remainingBudget(ctx),` right after `maxTurns`.

- [ ] **Step 6: `wpOk` stdin**

In `src/wp.ts`:

```ts
export async function wpOk(ctx: SiteContext, args: string[], opts: { input?: string } = {}): Promise<string> {
  const r = await runWp(ctx, args, opts);
  if (r.code !== 0) throw new Error(`wp ${redact(args)} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}
```

- [ ] **Step 7: CLI**

In `src/cli.ts`:

```ts
function withMaxCost(maxCost?: string) {
  const config = loadConfig();
  if (maxCost === undefined) return config;
  const n = Number(maxCost);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--max-cost must be a positive number of USD, got "${maxCost}"`);
  return { ...config, maxCostUsd: n };
}

program.command("run <slug>").description("Run the pipeline from the first incomplete stage")
  .option("--from <stage>").option("--only <stage>")
  .option("--max-cost <usd>", "Stop before any stage once the cumulated cost reaches this amount (default: faktory.config.json maxCostUsd)")
  .action(async (slug: string, opts: { from?: string; only?: string; maxCost?: string }) => {
    await runSite(withMaxCost(opts.maxCost), slug, { from: asStage(opts.from), only: asStage(opts.only) });
  });
program.command("approve <slug>").description("Mark the awaiting checkpoint as approved (re-syncs JSON from an edited markdown when needed)")
  .action(async (slug: string) => { const s = await approveSite(loadConfig(), slug); console.log(`Approved. Next: faktory run ${s.slug}`); });
```

- [ ] **Step 8: Run all unit tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/pipeline.ts src/config.ts src/agent.ts src/wp.ts src/cli.ts faktory.config.json tests/unit
git commit -m "feat(faktory): checkpoint onApprove hook, cost budget with --max-cost, wpOk stdin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 8: `resyncFromMarkdown` and the `spec` stage

**Files:**
- Create: `src/resync.ts`, `src/stages/spec.ts`
- Modify: `src/pipeline.ts` (register `spec`)
- Test: `tests/unit/resync.test.ts`, `tests/unit/stage-spec.test.ts`

**Interfaces:**
- Consumes: `runAgent` + `AgentRun` (`src/agent.ts`), artifacts (Task 2), schemas (Task 1), renderer (Task 3), prompts (Task 4).
- Produces: `resync.deps = { runAgent }`, `resyncFromMarkdown<T>(ctx, opts: { mdKey, jsonKey, shape: z.ZodType, parse: (u) => T, what: string }): Promise<T | undefined>` (undefined when not stale); `specStage: Stage` with `deps = { runAgent }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/resync.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { artifactPath, writeJsonArtifact, writeTextArtifact, readJsonArtifact } from "../../src/artifacts.js";
import { DesignTokensShape, parseDesignTokens } from "../../src/schemas/design-tokens.js";
import { resyncFromMarkdown, deps } from "../../src/resync.js";
import { readFileSync } from "node:fs";

const tokens = JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8"));
function ctx(): SiteContext {
  return { config: loadConfig("/tmp/fk"), slug: "demo", siteDir: mkdtempSync(join(tmpdir(), "fk-rs-")), state: createState("demo", 8100, "pw") };
}
const opts = { mdKey: "designSystemMd" as const, jsonKey: "designTokensJson" as const, shape: DesignTokensShape, parse: parseDesignTokens, what: "design tokens" };

describe("resyncFromMarkdown", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("does nothing when the markdown is not newer", async () => {
    const c = ctx();
    writeTextArtifact(c, "designSystemMd", "# ds"); writeJsonArtifact(c, "designTokensJson", tokens);
    const spy = vi.spyOn(deps, "runAgent");
    expect(await resyncFromMarkdown(c, opts)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
  it("re-extracts with a structured query using the resync model and Read only, then rewrites the json", async () => {
    const c = ctx();
    writeTextArtifact(c, "designSystemMd", "# ds"); writeJsonArtifact(c, "designTokensJson", tokens);
    const future = new Date(Date.now() + 5000); utimesSync(artifactPath(c, "designSystemMd"), future, future);
    const edited = { ...tokens, radius: 4 };
    const spy = vi.spyOn(deps, "runAgent").mockResolvedValue({ text: "", structured: edited, costUsd: 0.1, numTurns: 2 });
    const r = await resyncFromMarkdown(c, opts);
    expect(r?.radius).toBe(4);
    expect(readJsonArtifact(c, "designTokensJson", parseDesignTokens).radius).toBe(4);
    const call = spy.mock.calls[0][1];
    expect(call.stage).toBe("resync");
    expect(call.allowedTools).toEqual(["Read"]);
    expect(call.outputFormat?.type).toBe("json_schema");
    expect(call.prompt).toContain("design-system.md");
    expect(call.prompt).toContain("design-tokens.json");
  });
  it("throws a readable error when the re-extracted json is invalid", async () => {
    const c = ctx();
    writeTextArtifact(c, "designSystemMd", "# ds"); writeJsonArtifact(c, "designTokensJson", tokens);
    const future = new Date(Date.now() + 5000); utimesSync(artifactPath(c, "designSystemMd"), future, future);
    vi.spyOn(deps, "runAgent").mockResolvedValue({ text: "", structured: { ...tokens, radius: 99 }, costUsd: 0.1, numTurns: 2 });
    await expect(resyncFromMarkdown(c, opts)).rejects.toThrow(/Invalid design tokens/);
  });
});
```

```ts
// tests/unit/stage-spec.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { artifactPath, hasArtifact, readJsonArtifact } from "../../src/artifacts.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { specStage, deps } from "../../src/stages/spec.js";
import { deps as resyncDeps } from "../../src/resync.js";

const fixture = JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8"));
async function ctx() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-spec-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}

describe("spec stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("is a checkpoint that asks for a structured site spec with Read only", async () => {
    const c = await ctx();
    const spy = vi.spyOn(deps, "runAgent").mockResolvedValue({ text: "", structured: fixture, costUsd: 0.42, numTurns: 3 });
    expect(specStage.checkpoint).toBe(true);
    const msg = await specStage.run(c);
    const call = spy.mock.calls[0][1];
    expect(call.stage).toBe("spec");
    expect(call.allowedTools).toEqual(["Read"]);
    expect(call.outputFormat?.type).toBe("json_schema");
    expect(call.systemPrompt).toContain("brief.md");
    expect(hasArtifact(c, "siteSpecJson")).toBe(true);
    expect(readFileSync(artifactPath(c, "siteSpecMd"), "utf8")).toContain("# SITE-SPEC — Maison Rivet");
    expect(readJsonArtifact(c, "siteSpecJson", parseSiteSpec).sitemap).toHaveLength(6);
    expect(msg).toMatch(/SITE-SPEC.md.*6 pages.*1 feature.*2 forms.*\$0.42/);
  });
  it("fails loudly when the structured output is invalid", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockResolvedValue({ text: "", structured: { identity: {} }, costUsd: 0.1, numTurns: 1 });
    await expect(specStage.run(c)).rejects.toThrow(/Invalid site spec/);
    expect(hasArtifact(c, "siteSpecJson")).toBe(false);
  });
  it("onApprove re-syncs site-spec.json only when SITE-SPEC.md was edited", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockResolvedValue({ text: "", structured: fixture, costUsd: 0.4, numTurns: 3 });
    await specStage.run(c);
    const spy = vi.spyOn(resyncDeps, "runAgent").mockResolvedValue({ text: "", structured: { ...fixture, identity: { ...fixture.identity, name: "Maison Rivet & Fils" } }, costUsd: 0.2, numTurns: 2 });
    expect(await specStage.onApprove!(c)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    const future = new Date(Date.now() + 5000); utimesSync(artifactPath(c, "siteSpecMd"), future, future);
    expect(await specStage.onApprove!(c)).toMatch(/re-synced/);
    expect(readJsonArtifact(c, "siteSpecJson", parseSiteSpec).identity.name).toBe("Maison Rivet & Fils");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/resync.test.ts tests/unit/stage-spec.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/resync.ts`**

```ts
// src/resync.ts
import type { z } from "zod";
import type { SiteContext } from "./docker.js";
import { runAgent } from "./agent.js";
import { ARTIFACTS, isStale, writeJsonArtifact, type ArtifactKey } from "./artifacts.js";
import { toJsonSchema } from "./schemas/json-schema.js";

export const deps = { runAgent };

export type ResyncOptions<T> = {
  mdKey: ArtifactKey;
  jsonKey: ArtifactKey;
  shape: z.ZodType;
  parse: (u: unknown) => T;
  what: string;
};

/**
 * When the human-edited markdown is newer than its JSON twin, re-extract the JSON with a cheap
 * structured-output query (model `config.models.resync`). Returns the new data, or undefined when nothing to do.
 */
export async function resyncFromMarkdown<T>(ctx: SiteContext, opts: ResyncOptions<T>): Promise<T | undefined> {
  if (!isStale(ctx, opts.mdKey, opts.jsonKey)) return undefined;
  const md = ARTIFACTS[opts.mdKey], json = ARTIFACTS[opts.jsonKey];
  console.log(`↻ ${md} was edited after ${json}: re-extracting ${opts.what}…`);
  const r = await deps.runAgent(ctx, {
    stage: "resync",
    prompt: [
      `Le fichier \`${md}\` a été modifié à la main après la génération de \`${json}\`.`,
      `Lis les deux fichiers avec Read. Produis la nouvelle version structurée de ${opts.what} qui reflète exactement le contenu de \`${md}\` :`,
      `reprends les valeurs de \`${json}\` partout où le markdown n'a rien changé, et applique chaque modification du markdown (ajouts, suppressions, renommages, nouvelles valeurs).`,
      "N'invente rien qui ne soit ni dans le markdown ni dans le JSON. Réponds uniquement avec la structure demandée.",
    ].join("\n"),
    allowedTools: ["Read"],
    outputFormat: { type: "json_schema", schema: toJsonSchema(opts.shape) },
    maxTurns: 8,
  });
  const data = opts.parse(r.structured);
  writeJsonArtifact(ctx, opts.jsonKey, data);
  return data;
}
```

- [ ] **Step 4: Implement `src/stages/spec.ts`**

```ts
// src/stages/spec.ts
import type { Stage } from "../pipeline.js";
import { runAgent } from "../agent.js";
import { writeJsonArtifact, writeTextArtifact } from "../artifacts.js";
import { loadPrompt } from "../prompts.js";
import { toJsonSchema } from "../schemas/json-schema.js";
import { SiteSpecShape, parseSiteSpec } from "../schemas/site-spec.js";
import { renderSiteSpecMarkdown } from "../render/site-spec-md.js";
import { resyncFromMarkdown } from "../resync.js";

export const deps = { runAgent };

export const specStage: Stage = {
  name: "spec",
  checkpoint: true,
  async run(ctx) {
    const r = await deps.runAgent(ctx, {
      stage: "spec",
      systemPrompt: loadPrompt("spec"),
      prompt: "Lis `brief.md` puis produis la spécification structurée du site.",
      allowedTools: ["Read"],
      outputFormat: { type: "json_schema", schema: toJsonSchema(SiteSpecShape) },
      maxTurns: 12,
    });
    const spec = parseSiteSpec(r.structured);
    writeTextArtifact(ctx, "siteSpecMd", renderSiteSpecMarkdown(spec));
    writeJsonArtifact(ctx, "siteSpecJson", spec); // written last so the JSON is never older than the markdown
    return `SITE-SPEC.md written: ${spec.sitemap.length} pages, ${spec.features.length} feature${spec.features.length === 1 ? "" : "s"}, ${spec.forms.length} forms — $${r.costUsd.toFixed(2)}`;
  },
  async onApprove(ctx) {
    const s = await resyncFromMarkdown(ctx, { mdKey: "siteSpecMd", jsonKey: "siteSpecJson", shape: SiteSpecShape, parse: parseSiteSpec, what: "la spécification du site" });
    return s ? `approved; site-spec.json re-synced from edited SITE-SPEC.md (${s.sitemap.length} pages)` : undefined;
  },
};
```

Note on the test expectation `1 feature`: the message uses the singular for 1 and the regex `1 feature` matches both spellings.

- [ ] **Step 5: Register the stage**

In `src/pipeline.ts`: `import { specStage } from "./stages/spec.js";` and `export const registry: Partial<Record<StageName, Stage>> = { spec: specStage, provision: provisionStage };`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/resync.test.ts tests/unit/stage-spec.test.ts tests/unit/pipeline.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/resync.ts src/stages/spec.ts src/pipeline.ts tests/unit/resync.test.ts tests/unit/stage-spec.test.ts
git commit -m "feat(faktory): spec stage with structured site spec, SITE-SPEC.md and approve-time re-sync

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 9: The `design` stage

**Files:**
- Create: `src/stages/design.ts`
- Modify: `src/pipeline.ts` (register `design`)
- Test: `tests/unit/stage-design.test.ts`

**Interfaces:**
- Consumes: `runAgent`, artifacts, `SiteSpec`/`DesignTokensShape`/`parseDesignTokens`, `designSystemPrompt(config)`, `gbPreview` + `previewOptionsFromTokens` (`src/gb.ts`), `TOOL_GB_BUILD`/`TOOL_GB_PREVIEW`, `resyncFromMarkdown`.
- Produces: `designStage: Stage` (checkpoint), `deps = { runAgent, gbPreview }`, `designUserPrompt(spec: SiteSpec): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/stage-design.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { artifactPath, hasArtifact, readJsonArtifact, writeJsonArtifact } from "../../src/artifacts.js";
import { parseDesignTokens } from "../../src/schemas/design-tokens.js";
import { designStage, designUserPrompt, deps } from "../../src/stages/design.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { TOOL_GB_BUILD, TOOL_GB_PREVIEW } from "../../src/tools/server.js";

const spec = JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8"));
const tokens = JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8"));

async function ctx(withSpec = true) {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-design-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  if (withSpec) writeJsonArtifact(c, "siteSpecJson", spec);
  return c;
}
/** Simulates what the agent writes during its run. */
function agentWrites(c: ReturnType<typeof loadContext>, files: { md?: boolean; markup?: boolean; preview?: boolean } = { md: true, markup: true, preview: true }) {
  mkdirSync(join(c.siteDir, "design"), { recursive: true });
  if (files.md) writeFileSync(artifactPath(c, "designSystemMd"), "# Maison Rivet — Design System Web\n");
  if (files.markup) writeFileSync(artifactPath(c, "previewMarkup"), "<!-- wp:generateblocks/element {} --><div></div><!-- /wp:generateblocks/element -->\n");
  if (files.preview) writeFileSync(artifactPath(c, "previewHtml"), "<!doctype html><html><head><style>:root{--accent:#2563eb;}</style></head><body></body></html>");
}

describe("design stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("refuses to run without site-spec.json", async () => {
    const c = await ctx(false);
    await expect(designStage.run(c)).rejects.toThrow(/site-spec.json not found/);
  });
  it("runs the agent with Read/Write/gb tools, validates tokens, writes design-tokens.json and re-renders the preview", async () => {
    const c = await ctx();
    const run = vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { agentWrites(cc); return { text: "", structured: tokens, costUsd: 1.5, numTurns: 20 }; });
    const preview = vi.spyOn(deps, "gbPreview").mockResolvedValue(undefined);
    expect(designStage.checkpoint).toBe(true);
    const msg = await designStage.run(c);
    const call = run.mock.calls[0][1];
    expect(call.stage).toBe("design");
    expect(call.allowedTools).toEqual(["Read", "Write", TOOL_GB_BUILD, TOOL_GB_PREVIEW]);
    expect(call.outputFormat?.type).toBe("json_schema");
    expect(call.systemPrompt).toContain("design-system.md");
    expect(call.prompt).toContain("Maison Rivet");
    expect(readJsonArtifact(c, "designTokensJson", parseDesignTokens).containerWidth).toBe(1140);
    expect(preview).toHaveBeenCalledWith(c.config, artifactPath(c, "previewMarkup"), artifactPath(c, "previewHtml"), expect.objectContaining({ containerWidth: 1140, headingFont: "Fraunces" }));
    expect(msg).toMatch(/design-system.md.*design-tokens.json.*preview.html.*\$1.50/);
  });
  it("fails when the agent did not write design-system.md or the preview markup", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { agentWrites(cc, { md: false, markup: true, preview: true }); return { text: "", structured: tokens, costUsd: 1, numTurns: 5 }; });
    await expect(designStage.run(c)).rejects.toThrow(/design-system.md/);
    expect(hasArtifact(c, "designTokensJson")).toBe(false);
  });
  it("fails on invalid tokens before writing anything", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { agentWrites(cc); return { text: "", structured: { ...tokens, palette: {} }, costUsd: 1, numTurns: 5 }; });
    await expect(designStage.run(c)).rejects.toThrow(/Invalid design tokens/);
    expect(hasArtifact(c, "designTokensJson")).toBe(false);
  });
  it("builds a user prompt from the spec", () => {
    const p = designUserPrompt(parseSiteSpec(spec));
    expect(p).toContain("Maison Rivet");
    expect(p).toContain("Boulangerie-pâtisserie artisanale");
    expect(p).toContain("accueil");
    expect(p).toContain("hero");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/stage-design.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/stages/design.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Stage } from "../pipeline.js";
import { runAgent } from "../agent.js";
import { ARTIFACTS, artifactPath, hasArtifact, readJsonArtifact, writeJsonArtifact } from "../artifacts.js";
import { gbPreview, previewOptionsFromTokens } from "../gb.js";
import { designSystemPrompt } from "../prompts.js";
import { toJsonSchema } from "../schemas/json-schema.js";
import { DesignTokensShape, parseDesignTokens } from "../schemas/design-tokens.js";
import { parseSiteSpec, type SiteSpec } from "../schemas/site-spec.js";
import { resyncFromMarkdown } from "../resync.js";
import { TOOL_GB_BUILD, TOOL_GB_PREVIEW } from "../tools/server.js";

export const deps = { runAgent, gbPreview };

export function designUserPrompt(spec: SiteSpec): string {
  const home = spec.sitemap.find((p) => p.kind === "home") ?? spec.sitemap[0];
  return [
    `Site : ${spec.identity.name} — ${spec.identity.sector}${spec.identity.location ? ` (${spec.identity.location})` : ""}.`,
    `Ton : ${spec.identity.tone}. Accroche : ${spec.identity.tagline}.`,
    `Pages : ${spec.sitemap.map((p) => `${p.slug} [${p.kind}]`).join(", ")}.`,
    `Sections de la page d'accueil (\`${home.slug}\`) : ${home.sections.map((s) => `${s.type} « ${s.heading} »`).join(" ; ")}.`,
    "",
    "Lis `site-spec.json` et `brief.md`, puis produis `design-system.md`, `design/preview.gb.json` → gb_build → gb_preview → `preview.html`, et termine par les tokens structurés.",
  ].join("\n");
}

export const designStage: Stage = {
  name: "design",
  checkpoint: true,
  async run(ctx) {
    const spec = readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec);
    mkdirSync(join(ctx.siteDir, "design"), { recursive: true });
    const r = await deps.runAgent(ctx, {
      stage: "design",
      systemPrompt: designSystemPrompt(ctx.config),
      prompt: designUserPrompt(spec),
      allowedTools: ["Read", "Write", TOOL_GB_BUILD, TOOL_GB_PREVIEW],
      outputFormat: { type: "json_schema", schema: toJsonSchema(DesignTokensShape) },
      maxTurns: 40,
    });
    const tokens = parseDesignTokens(r.structured);
    for (const key of ["designSystemMd", "previewMarkup"] as const) {
      if (!hasArtifact(ctx, key)) throw new Error(`design stage ended without writing ${ARTIFACTS[key]} — re-run with: faktory run ${ctx.slug} --only design`);
    }
    await deps.gbPreview(ctx.config, artifactPath(ctx, "previewMarkup"), artifactPath(ctx, "previewHtml"), previewOptionsFromTokens(tokens));
    writeJsonArtifact(ctx, "designTokensJson", tokens); // last: never older than design-system.md
    return `design-system.md, design-tokens.json and preview.html written (open ${artifactPath(ctx, "previewHtml")}) — $${r.costUsd.toFixed(2)}`;
  },
  async onApprove(ctx) {
    const t = await resyncFromMarkdown(ctx, { mdKey: "designSystemMd", jsonKey: "designTokensJson", shape: DesignTokensShape, parse: parseDesignTokens, what: "les design tokens" });
    if (!t) return undefined;
    if (hasArtifact(ctx, "previewMarkup")) await deps.gbPreview(ctx.config, artifactPath(ctx, "previewMarkup"), artifactPath(ctx, "previewHtml"), previewOptionsFromTokens(t));
    return "approved; design-tokens.json re-synced from edited design-system.md";
  },
};
```

- [ ] **Step 4: Register**

In `src/pipeline.ts`: `import { designStage } from "./stages/design.js";` → `registry = { spec: specStage, design: designStage, provision: provisionStage }`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/stage-design.test.ts tests/unit/pipeline.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/stages/design.ts src/pipeline.ts tests/unit/stage-design.test.ts
git commit -m "feat(faktory): design stage producing design-system.md, structured tokens and a token-accurate preview

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 10: `generate_settings` from tokens, identity

**Files:**
- Create: `src/provision/settings.ts`
- Test: `tests/unit/provision-settings.test.ts`

**Interfaces:**
- Consumes: `DesignTokens`, `SiteSpec`, `runWp`/`wpOk` (`src/wp.ts`).
- Produces: `GP_COLOR_SLUGS`, `TYPO_RULE_DEFAULTS`, `buildGenerateSettings(tokens): Record<string, unknown>`, `applyTokens(ctx, tokens): Promise<void>`, `applyIdentity(ctx, spec): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/provision-settings.test.ts
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
  const calls = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => ({ args: (c[2] as string[]).slice(1), input: (c[3] as { input?: string } | undefined)?.input }));
  it("merges over the existing option, writes JSON on stdin and invalidates the css cache", async () => {
    const spy = vi.spyOn(deps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      if (cmd.join(" ").startsWith("wp option get generate_settings")) return { stdout: JSON.stringify({ icons: "font", container_width: "1200" }), stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
    await applyTokens(ctx, tokens);
    const c = calls(spy);
    const upd = c.find((x) => x.args.join(" ").startsWith("option update generate_settings"))!;
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
    const upd = calls(spy).find((x) => x.args.join(" ").startsWith("option update generate_settings"))!;
    expect(JSON.parse(upd.input!).global_colors).toHaveLength(8);
  });
  it("applies the site name and tagline", async () => {
    const spy = vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "Success", stderr: "", code: 0 });
    await applyIdentity(ctx, spec);
    expect(calls(spy).map((x) => x.args)).toEqual([
      ["option", "update", "blogname", "Maison Rivet"],
      ["option", "update", "blogdescription", "Pain au levain et pâtisseries artisanales à Chantenay, Nantes"],
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/provision-settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/provision/settings.ts
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
```

`mobile(52)` = `Math.round(33.8)` = 34, matching the test.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/provision-settings.test.ts && npm run typecheck`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/provision/settings.ts tests/unit/provision-settings.test.ts
git commit -m "feat(faktory): apply design tokens and identity to GeneratePress settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 11: Placeholder pages, front/blog page, primary menu

**Files:**
- Create: `src/provision/pages.ts`
- Test: `tests/unit/provision-pages.test.ts`

**Interfaces:**
- Consumes: `SiteSpec`, `wpOk`/`wpJson`.
- Produces: `GP_PAGE_META: [string, string][]`, `PRIMARY_MENU = "Principal"`, `ensurePages(ctx, spec): Promise<Record<string, number>>` (slug → post ID), `ensureMenus(ctx, spec, ids): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/provision-pages.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps } from "../../src/wp.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { ensurePages, ensureMenus, GP_PAGE_META, PRIMARY_MENU } from "../../src/provision/pages.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };
const argsOf = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => (c[2] as string[]).slice(1).join(" "));

/** Fake WP: existing pages/menus/items; `post create` returns incrementing ids. */
function fakeWp(state: { pages: { ID: number; post_name: string }[]; menus: { term_id: number; name: string }[]; items: { object_id: number }[] }) {
  let next = 100;
  return vi.spyOn(deps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
    const a = cmd.slice(1).join(" ");
    const json = (v: unknown) => ({ stdout: JSON.stringify(v), stderr: "", code: 0 });
    if (a.startsWith("post list --post_type=page")) return json(state.pages);
    if (a.startsWith("post create")) return { stdout: `${next++}\n`, stderr: "", code: 0 };
    if (a.startsWith("menu list")) return json(state.menus);
    if (a.startsWith("menu create")) return { stdout: "7\n", stderr: "", code: 0 };
    if (a.startsWith("menu item list")) return json(state.items);
    return { stdout: "Success", stderr: "", code: 0 };
  });
}

describe("ensurePages", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("creates missing pages as published placeholders with GP meta and returns slug → id", async () => {
    const spy = fakeWp({ pages: [{ ID: 12, post_name: "accueil" }], menus: [], items: [] });
    const ids = await ensurePages(ctx, spec);
    expect(ids.accueil).toBe(12);
    expect(ids["nos-produits"]).toBe(100);
    expect(Object.keys(ids)).toHaveLength(6);
    const a = argsOf(spy);
    expect(a).toContain("post create --post_type=page --post_status=publish --post_title=Nos produits --post_name=nos-produits --porcelain");
    expect(a.filter((x) => x.startsWith("post create"))).toHaveLength(5);
    for (const [k, v] of GP_PAGE_META) expect(a).toContain(`post meta update 12 ${k} ${v}`);
  });
  it("sets the static front page and the posts page", async () => {
    const spy = fakeWp({ pages: [], menus: [], items: [] });
    const ids = await ensurePages(ctx, spec);
    const a = argsOf(spy);
    expect(a).toContain("option update show_on_front page");
    expect(a).toContain(`option update page_on_front ${ids.accueil}`);
    expect(a).toContain(`option update page_for_posts ${ids.actualites}`);
  });
});

describe("ensureMenus", () => {
  beforeEach(() => vi.restoreAllMocks());
  const ids = { accueil: 1, "nos-produits": 2, "commandes-evenements": 3, "la-maison": 4, actualites: 5, contact: 6 };
  it("creates the primary menu, adds missing pages in spec order and assigns the primary location", async () => {
    const spy = fakeWp({ pages: [], menus: [], items: [] });
    await ensureMenus(ctx, spec, ids);
    const a = argsOf(spy);
    expect(a).toContain(`menu create ${PRIMARY_MENU} --porcelain`);
    const adds = a.filter((x) => x.startsWith("menu item add-post"));
    expect(adds).toEqual([1, 2, 3, 4, 5, 6].map((id) => `menu item add-post 7 ${id}`));
    expect(a.at(-1)).toBe("menu location assign 7 primary");
  });
  it("is idempotent: reuses the menu and skips pages already in it", async () => {
    const spy = fakeWp({ pages: [], menus: [{ term_id: 9, name: PRIMARY_MENU }], items: [{ object_id: 1 }, { object_id: 2 }] });
    await ensureMenus(ctx, spec, ids);
    const a = argsOf(spy);
    expect(a.some((x) => x.startsWith("menu create"))).toBe(false);
    expect(a.filter((x) => x.startsWith("menu item add-post"))).toEqual([3, 4, 5, 6].map((id) => `menu item add-post 9 ${id}`));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/provision-pages.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/provision/pages.ts
import type { SiteContext } from "../docker.js";
import { wpOk, wpJson } from "../wp.js";
import type { SiteSpec } from "../schemas/site-spec.js";

/** GeneratePress per-page meta for block-built landing pages (same as the Elementor-import publish loop). */
export const GP_PAGE_META: [string, string][] = [
  ["_generate-full-width-content", "true"],
  ["_generate-sidebar-layout-meta", "no-sidebar"],
  ["_generate-disable-headline", "true"],
];
export const PRIMARY_MENU = "Principal";

type PageRow = { ID: number; post_name: string };

/** Create every sitemap page as a published, empty placeholder (phase 3 fills them by slug). Returns slug → ID. */
export async function ensurePages(ctx: SiteContext, spec: SiteSpec): Promise<Record<string, number>> {
  const existing = await wpJson<PageRow[]>(ctx, ["post", "list", "--post_type=page", "--post_status=any", "--fields=ID,post_name"]);
  const ids: Record<string, number> = {};
  for (const page of spec.sitemap) {
    let id = existing.find((p) => p.post_name === page.slug)?.ID;
    if (!id) {
      id = Number(await wpOk(ctx, ["post", "create", "--post_type=page", "--post_status=publish", `--post_title=${page.title}`, `--post_name=${page.slug}`, "--porcelain"]));
    }
    for (const [k, v] of GP_PAGE_META) await wpOk(ctx, ["post", "meta", "update", String(id), k, v]);
    ids[page.slug] = id;
  }
  const home = spec.sitemap.find((p) => p.kind === "home");
  const blog = spec.sitemap.find((p) => p.kind === "blog");
  if (home) {
    await wpOk(ctx, ["option", "update", "show_on_front", "page"]);
    await wpOk(ctx, ["option", "update", "page_on_front", String(ids[home.slug])]);
  }
  if (blog) await wpOk(ctx, ["option", "update", "page_for_posts", String(ids[blog.slug])]);
  return ids;
}

/** Create/complete the "Principal" menu from spec.menus.primary and assign it to GeneratePress' `primary` location. */
export async function ensureMenus(ctx: SiteContext, spec: SiteSpec, ids: Record<string, number>): Promise<void> {
  const menus = await wpJson<{ term_id: number; name: string }[]>(ctx, ["menu", "list", "--fields=term_id,name"]);
  let menu = menus.find((m) => m.name === PRIMARY_MENU)?.term_id;
  if (!menu) menu = Number(await wpOk(ctx, ["menu", "create", PRIMARY_MENU, "--porcelain"]));
  const items = await wpJson<{ object_id: number | string }[]>(ctx, ["menu", "item", "list", String(menu), "--fields=object_id"]);
  const present = new Set(items.map((i) => String(i.object_id)));
  for (const slug of spec.menus.primary) {
    const id = ids[slug];
    if (!id) { console.warn(`⚠ menu: no page for slug "${slug}", skipped`); continue; }
    if (present.has(String(id))) continue;
    await wpOk(ctx, ["menu", "item", "add-post", String(menu), String(id)]);
  }
  await wpOk(ctx, ["menu", "location", "assign", String(menu), "primary"]);
}
```

`wp menu item list` only returns `object_id` when asked through `--fields=object_id` (verified on the demo: the default field set is `db_id,type,title,link,position`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/provision-pages.test.ts && npm run typecheck`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/provision/pages.ts tests/unit/provision-pages.test.ts
git commit -m "feat(faktory): provision placeholder pages, front/blog pages and the primary menu from the site spec

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 12: Footer as a GP Premium `site-footer` element

**Files:**
- Create: `src/provision/footer.ts`
- Test: `tests/unit/provision-footer.test.ts`

**Interfaces:**
- Consumes: `SiteSpec`, `DesignTokens`, `gbBuild` (`src/gb.ts`), `wpOk`/`wpJson`.
- Produces: `FOOTER_ELEMENT_SLUG = "faktory-footer"`, `footerTree(spec, tokens, year?: number): unknown[]`, `installFooter(ctx, spec, tokens): Promise<number>` (element post ID), `deps = { gbBuild }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/provision-footer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps as wpDeps } from "../../src/wp.js";
import { gbScript, gbBuild } from "../../src/gb.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { parseDesignTokens } from "../../src/schemas/design-tokens.js";
import { footerTree, installFooter, FOOTER_ELEMENT_SLUG, deps } from "../../src/provision/footer.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const tokens = parseDesignTokens(JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8")));
const ctx: SiteContext = { config: loadConfig(process.cwd()), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };
type Node = { type: string; tagName?: string; content?: string; htmlAttributes?: Record<string, string>; styles?: Record<string, unknown>; innerBlocks?: Node[] };
const flat = (nodes: Node[]): Node[] => nodes.flatMap((n) => [n, ...flat(n.innerBlocks ?? [])]);

describe("footerTree", () => {
  const tree = footerTree(spec, tokens, 2026) as Node[];
  const all = flat(tree);
  it("is one footer section using palette variables and the spacing ramp", () => {
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ type: "element", tagName: "footer" });
    expect(tree[0].styles?.backgroundColor).toBe("var(--contrast)");
    expect(JSON.stringify(tree)).not.toMatch(/#[0-9a-f]{6}/i);
    expect(tree[0].styles?.["@media (max-width:767px)"]).toBeDefined();
  });
  it("lists the footer menu pages as links and the brand, contact and copyright", () => {
    const links = all.filter((n) => n.tagName === "a").map((n) => n.htmlAttributes?.href);
    expect(links).toEqual(expect.arrayContaining(["/nos-produits/", "/commandes-evenements/", "/la-maison/", "/actualites/", "/contact/", "mailto:contact@maisonrivet.fr"]));
    const text = all.map((n) => n.content ?? "").join("\n");
    expect(text).toContain("Maison Rivet");
    expect(text).toContain("Pain au levain et pâtisseries artisanales");
    expect(text).toContain("Mardi – Vendredi : 7h00 – 19h30");
    expect(text).toContain("© 2026 Maison Rivet");
  });
  it("links the home page to / when it is in the footer menu", () => {
    const withHome = footerTree({ ...spec, menus: { ...spec.menus, footer: ["accueil", "contact"] } }, tokens, 2026) as Node[];
    expect(flat(withHome).find((n) => n.content === "Accueil")?.htmlAttributes?.href).toBe("/");
  });
});

describe("installFooter", () => {
  beforeEach(() => vi.restoreAllMocks());
  const argsOf = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => ({ a: (c[2] as string[]).slice(1).join(" "), input: (c[3] as { input?: string } | undefined)?.input }));
  function fakeWp(elements: { ID: number; post_name: string }[]) {
    return vi.spyOn(wpDeps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      const a = cmd.slice(1).join(" ");
      if (a.startsWith("post list --post_type=gp_elements")) return { stdout: JSON.stringify(elements), stderr: "", code: 0 };
      if (a.startsWith("post create")) return { stdout: "42\n", stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
  }
  it("activates the Elements module, creates the element, pushes the markup on stdin and sets the metas", async () => {
    vi.spyOn(deps, "gbBuild").mockResolvedValue("<!-- wp:generateblocks/element {} -->\n<footer>x</footer>\n<!-- /wp:generateblocks/element -->\n");
    const spy = fakeWp([]);
    expect(await installFooter(ctx, spec, tokens)).toBe(42);
    const c = argsOf(spy);
    expect(c.map((x) => x.a)).toEqual(expect.arrayContaining([
      "option update generate_package_elements activated",
      `post create --post_type=gp_elements --post_status=publish --post_title=Faktory footer --post_name=${FOOTER_ELEMENT_SLUG} --porcelain`,
      "post meta update 42 _generate_element_type block",
      "post meta update 42 _generate_block_type site-footer",
      'post meta update 42 _generate_element_display_conditions [{"rule":"general:site","object":""}] --format=json',
      "option update generate_dynamic_css_output ",
    ]));
    const upd = c.find((x) => x.a === "post update 42 -")!;
    expect(upd.input).toContain("<footer>x</footer>");
  });
  it("updates the existing element instead of creating a second one", async () => {
    vi.spyOn(deps, "gbBuild").mockResolvedValue("<!-- wp:generateblocks/element {} --><footer>y</footer><!-- /wp:generateblocks/element -->");
    const spy = fakeWp([{ ID: 8, post_name: FOOTER_ELEMENT_SLUG }]);
    expect(await installFooter(ctx, spec, tokens)).toBe(8);
    const a = argsOf(spy).map((x) => x.a);
    expect(a.some((x) => x.startsWith("post create"))).toBe(false);
    expect(a).toContain("post update 8 -");
  });
  it.skipIf(!existsSync(gbScript(ctx.config, "gb_build.py")))("compiles the real tree with gb_build.py (python3)", async () => {
    const markup = await gbBuild(ctx.config, footerTree(spec, tokens, 2026));
    expect(markup).toContain("wp:generateblocks/element");
    expect(markup).toContain('<footer class="gb-element-');
    expect(markup).toContain("\\u002d\\u002dcontrast");
    expect(markup).toContain("© 2026 Maison Rivet");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/provision-footer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/provision/footer.ts
import type { SiteContext } from "../docker.js";
import { wpOk, wpJson } from "../wp.js";
import { gbBuild } from "../gb.js";
import type { SiteSpec } from "../schemas/site-spec.js";
import type { DesignTokens } from "../schemas/design-tokens.js";

export const deps = { gbBuild };
export const FOOTER_ELEMENT_SLUG = "faktory-footer";
const MOBILE = "@media (max-width:767px)";

type Node = { type: string; tagName?: string; content?: string; htmlAttributes?: Record<string, string>; styles?: Record<string, unknown>; innerBlocks?: Node[] };

const text = (tagName: string, content: string, styles: Record<string, unknown> = {}, htmlAttributes?: Record<string, string>): Node =>
  ({ type: "text", tagName, content, styles, ...(htmlAttributes ? { htmlAttributes } : {}) });

function link(href: string, label: string): Node {
  return text("a", label, { display: "block", color: "inherit", textDecoration: "none", opacity: "0.85", padding: "4px 0", transition: "opacity 150ms ease", "&:hover": { opacity: "1", textDecoration: "underline" }, "&:focus-visible": { outline: "2px solid var(--accent-2)", outlineOffset: "2px" } }, { href });
}

function columnTitle(label: string, sp: number[]): Node {
  return text("p", label, { fontSize: "13px", letterSpacing: "0.08em", textTransform: "uppercase", opacity: "0.6", marginBottom: `${sp[3]}px` });
}

/** Deterministic footer: brand + footer menu + contact, copyright bar. Colors only through GP palette variables. */
export function footerTree(spec: SiteSpec, tokens: DesignTokens, year: number = new Date().getFullYear()): unknown[] {
  const sp = tokens.spacing;
  const pad = Math.round(tokens.sectionPadding.desktop * 0.75), padMobile = Math.round(tokens.sectionPadding.mobile * 0.8);
  const { identity: id } = spec;
  const pages = new Map(spec.sitemap.map((p) => [p.slug, p]));

  const brand: Node = { type: "element", tagName: "div", styles: {}, innerBlocks: [
    text("p", `<strong>${id.name}</strong>`, { fontSize: "22px", marginBottom: `${sp[2]}px` }),
    text("p", id.tagline, { opacity: "0.75", maxWidth: "36ch", lineHeight: "1.5" }),
  ] };

  const nav: Node = { type: "element", tagName: "nav", htmlAttributes: { "aria-label": "Pied de page" }, styles: {}, innerBlocks: [
    columnTitle("Navigation", sp),
    ...spec.menus.footer.map((slug) => { const p = pages.get(slug); return link(p?.kind === "home" ? "/" : `/${slug}/`, p?.title ?? slug); }),
  ] };

  const contactLines: Node[] = [columnTitle("Contact", sp)];
  if (id.contact.address) contactLines.push(text("p", id.contact.address, { opacity: "0.85", marginBottom: `${sp[1]}px` }));
  if (id.contact.phone) contactLines.push(link(`tel:${id.contact.phone.replace(/[^+\d]/g, "")}`, id.contact.phone));
  if (id.contact.email) contactLines.push(link(`mailto:${id.contact.email}`, id.contact.email));
  for (const h of id.contact.hours ?? []) contactLines.push(text("p", h, { opacity: "0.85", fontSize: "15px" }));
  const contact: Node = { type: "element", tagName: "div", styles: {}, innerBlocks: contactLines };

  const grid: Node = { type: "element", tagName: "div", styles: {
    maxWidth: "var(--gb-container-width)", marginLeft: "auto", marginRight: "auto",
    display: "grid", gridTemplateColumns: "2fr 1fr 1.4fr", gap: `${sp[6]}px`,
    [MOBILE]: { gridTemplateColumns: "1fr", gap: `${sp[5]}px` },
  }, innerBlocks: [brand, nav, contact] };

  const bar: Node = { type: "element", tagName: "div", styles: {
    maxWidth: "var(--gb-container-width)", marginLeft: "auto", marginRight: "auto", marginTop: `${sp[6]}px`, paddingTop: `${sp[4]}px`,
    borderTop: "1px solid rgba(255,255,255,0.15)", display: "flex", justifyContent: "space-between", gap: `${sp[3]}px`, fontSize: "14px", opacity: "0.7",
    [MOBILE]: { flexDirection: "column" },
  }, innerBlocks: [
    text("p", `© ${year} ${id.name}`),
    text("p", id.location ? `${id.sector} — ${id.location}` : id.sector),
  ] };

  const footer: Node = { type: "element", tagName: "footer", htmlAttributes: { class: "site-footer" }, styles: {
    backgroundColor: "var(--contrast)", color: "var(--base-3)", padding: `${pad}px 24px ${sp[5]}px`,
    [MOBILE]: { padding: `${padMobile}px 16px ${sp[4]}px` },
  }, innerBlocks: [grid, bar] };
  return [footer];
}

/** Create or update the `faktory-footer` GP Premium block element and point it at the site-wide footer hook. */
export async function installFooter(ctx: SiteContext, spec: SiteSpec, tokens: DesignTokens): Promise<number> {
  await wpOk(ctx, ["option", "update", "generate_package_elements", "activated"]);
  const markup = await deps.gbBuild(ctx.config, footerTree(spec, tokens));
  const existing = await wpJson<{ ID: number; post_name: string }[]>(ctx, ["post", "list", "--post_type=gp_elements", "--post_status=any", "--fields=ID,post_name"]);
  let id = existing.find((e) => e.post_name === FOOTER_ELEMENT_SLUG)?.ID;
  if (!id) id = Number(await wpOk(ctx, ["post", "create", "--post_type=gp_elements", "--post_status=publish", "--post_title=Faktory footer", `--post_name=${FOOTER_ELEMENT_SLUG}`, "--porcelain"]));
  await wpOk(ctx, ["post", "update", String(id), "-"], { input: markup });
  await wpOk(ctx, ["post", "meta", "update", String(id), "_generate_element_type", "block"]);
  await wpOk(ctx, ["post", "meta", "update", String(id), "_generate_block_type", "site-footer"]);
  await wpOk(ctx, ["post", "meta", "update", String(id), "_generate_element_display_conditions", JSON.stringify([{ rule: "general:site", object: "" }]), "--format=json"]);
  await wpOk(ctx, ["option", "update", "generate_dynamic_css_output", ""]);
  return id;
}
```

`wp post update <id> -` reads the post content from stdin (WP-CLI: "Passing `-` as the filename will cause post content to be read from STDIN"). `gb_build.py` merges `htmlAttributes.class` with the computed classes, so the `<footer>` keeps GP's `site-footer` class for styling hooks.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/provision-footer.test.ts && npm run typecheck`
Expected: 6 PASS (5 + python one on a synced machine).

- [ ] **Step 5: Commit**

```bash
git add src/provision/footer.ts tests/unit/provision-footer.test.ts
git commit -m "feat(faktory): deterministic GP Premium site-footer element compiled with gb_build

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 13: Wire identity/pages/menus/tokens/footer into the provision stage + Docker integration test

**Files:**
- Modify: `src/stages/provision.ts`
- Test: `tests/unit/stage-provision.test.ts`, `tests/integration/provision-chrome.test.ts`

**Interfaces:**
- Consumes: Tasks 10-12, artifacts (Task 2), schemas (Task 1).
- Produces: `provisionStage` unchanged in name; `deps = { composeUp, waitForDb, installCore, installStack, applyIdentity, ensurePages, ensureMenus, applyTokens, installFooter }` for tests.

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/unit/stage-provision.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { writeJsonArtifact } from "../../src/artifacts.js";
import { provisionStage, deps } from "../../src/stages/provision.js";

const spec = JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8"));
const tokens = JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8"));

async function ctx(opts: { spec?: boolean; tokens?: boolean } = {}) {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-prov-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  if (opts.spec) writeJsonArtifact(c, "siteSpecJson", spec);
  if (opts.tokens) writeJsonArtifact(c, "designTokensJson", tokens);
  return c;
}
function mockInfra() {
  vi.spyOn(deps, "composeUp").mockResolvedValue({ stdout: "", stderr: "", code: 0 });
  vi.spyOn(deps, "waitForDb").mockResolvedValue(undefined);
  const core = vi.spyOn(deps, "installCore").mockResolvedValue({ freshInstall: true });
  vi.spyOn(deps, "installStack").mockResolvedValue({ installed: ["generatepress"], missingVendor: [] });
  return {
    core,
    identity: vi.spyOn(deps, "applyIdentity").mockResolvedValue(undefined),
    pages: vi.spyOn(deps, "ensurePages").mockResolvedValue({ accueil: 1, "nos-produits": 2, "commandes-evenements": 3, "la-maison": 4, actualites: 5, contact: 6 }),
    menus: vi.spyOn(deps, "ensureMenus").mockResolvedValue(undefined),
    tokens: vi.spyOn(deps, "applyTokens").mockResolvedValue(undefined),
    footer: vi.spyOn(deps, "installFooter").mockResolvedValue(42),
  };
}

describe("provision stage orchestration", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("skips spec/tokens steps when the artifacts are missing (demo site)", async () => {
    const m = mockInfra();
    const msg = await provisionStage.run(await ctx());
    expect(m.core.mock.calls[0][1]).toEqual({ title: "boul" });
    expect(m.pages).not.toHaveBeenCalled(); expect(m.tokens).not.toHaveBeenCalled(); expect(m.footer).not.toHaveBeenCalled();
    expect(msg).toMatch(/no site-spec.json/); expect(msg).toMatch(/no design-tokens.json/);
  });
  it("applies identity, pages, menus, tokens and footer in order when both artifacts exist", async () => {
    const m = mockInfra();
    const order: string[] = [];
    m.core.mockImplementation(async () => { order.push("core"); return { freshInstall: false }; });
    m.identity.mockImplementation(async () => { order.push("identity"); });
    m.pages.mockImplementation(async () => { order.push("pages"); return { accueil: 1 }; });
    m.menus.mockImplementation(async () => { order.push("menus"); });
    m.tokens.mockImplementation(async () => { order.push("tokens"); });
    m.footer.mockImplementation(async () => { order.push("footer"); return 42; });
    const msg = await provisionStage.run(await ctx({ spec: true, tokens: true }));
    expect(order).toEqual(["core", "identity", "pages", "menus", "tokens", "footer"]);
    expect(m.core.mock.calls[0][1]).toEqual({ title: "Maison Rivet" });
    expect(msg).toMatch(/1 page/); expect(msg).toMatch(/tokens applied/); expect(msg).toMatch(/footer element #42/);
  });
  it("creates pages and menus without tokens, and skips the footer", async () => {
    const m = mockInfra();
    const msg = await provisionStage.run(await ctx({ spec: true }));
    expect(m.pages).toHaveBeenCalled(); expect(m.menus).toHaveBeenCalled();
    expect(m.tokens).not.toHaveBeenCalled(); expect(m.footer).not.toHaveBeenCalled();
    expect(msg).toMatch(/6 pages/); expect(msg).toMatch(/no design-tokens.json/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/stage-provision.test.ts`
Expected: FAIL — `deps` is not exported.

- [ ] **Step 3: Rewrite `src/stages/provision.ts`**

```ts
// src/stages/provision.ts
import type { Stage } from "../pipeline.js";
import { composeUp } from "../docker.js";
import { waitForDb } from "../wp.js";
import { installCore } from "../provision/core.js";
import { installStack } from "../provision/stack.js";
import { applyIdentity, applyTokens } from "../provision/settings.js";
import { ensurePages, ensureMenus } from "../provision/pages.js";
import { installFooter } from "../provision/footer.js";
import { hasArtifact, readJsonArtifact } from "../artifacts.js";
import { parseSiteSpec } from "../schemas/site-spec.js";
import { parseDesignTokens } from "../schemas/design-tokens.js";

export const deps = { composeUp, waitForDb, installCore, installStack, applyIdentity, ensurePages, ensureMenus, applyTokens, installFooter };

export const provisionStage: Stage = {
  name: "provision",
  async run(ctx) {
    const spec = hasArtifact(ctx, "siteSpecJson") ? readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec) : undefined;
    const tokens = hasArtifact(ctx, "designTokensJson") ? readJsonArtifact(ctx, "designTokensJson", parseDesignTokens) : undefined;

    const up = await deps.composeUp(ctx);
    if (up.code !== 0) throw new Error(`docker compose up failed: ${up.stderr.trim()}`);
    await deps.waitForDb(ctx);
    const core = await deps.installCore(ctx, { title: spec?.identity.name ?? ctx.slug });
    const stack = await deps.installStack(ctx);
    const parts = [core.freshInstall ? "fresh install" : "already installed", `installed: ${stack.installed.join(", ") || "nothing new"}`];
    if (stack.missingVendor.length) parts.push(`missing vendor zips: ${stack.missingVendor.join(", ")}`);

    if (spec) {
      await deps.applyIdentity(ctx, spec);
      const ids = await deps.ensurePages(ctx, spec);
      await deps.ensureMenus(ctx, spec, ids);
      const n = Object.keys(ids).length;
      parts.push(`${n} page${n === 1 ? "" : "s"} + primary menu`);
    } else {
      parts.push("no site-spec.json: identity/pages/menus skipped");
    }
    if (tokens) {
      await deps.applyTokens(ctx, tokens);
      parts.push("tokens applied");
    } else {
      parts.push("no design-tokens.json: tokens/footer skipped");
    }
    if (spec && tokens) {
      const id = await deps.installFooter(ctx, spec, tokens);
      parts.push(`footer element #${id}`);
    }
    return parts.join("; ");
  },
};
```

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run tests/unit/stage-provision.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Write the Docker integration test**

```ts
// tests/integration/provision-chrome.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { wpJson, wpOk } from "../../src/wp.js";
import { artifactPath } from "../../src/artifacts.js";
import { FOOTER_ELEMENT_SLUG } from "../../src/provision/footer.js";

describe.skipIf(!process.env.FAKTORY_DOCKER)("provision with spec + tokens (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8191 };
  beforeAll(async () => {
    await initSite(config, { slug: "itchrome", briefPath: "fixtures/briefs/boulangerie.md" });
    const ctx = loadContext(config, "itchrome");
    copyFileSync("fixtures/specs/boulangerie.site-spec.json", artifactPath(ctx, "siteSpecJson"));
    copyFileSync("fixtures/specs/boulangerie.design-tokens.json", artifactPath(ctx, "designTokensJson"));
  });
  afterAll(async () => { await destroySite(config, "itchrome"); });

  it("applies identity, pages, menu, tokens and the footer element, idempotently", async () => {
    const s1 = await runSite(config, "itchrome", { only: "provision" });
    expect(s1.stages.provision.status, s1.stages.provision.message).toBe("done");
    expect(s1.stages.provision.message).toMatch(/6 pages \+ primary menu; tokens applied; footer element #\d+/);
    const ctx = loadContext(config, "itchrome");

    expect(await wpOk(ctx, ["option", "get", "blogname"])).toBe("Maison Rivet");
    const pages = await wpJson<{ post_name: string; post_status: string }[]>(ctx, ["post", "list", "--post_type=page", "--fields=post_name,post_status"]);
    expect(pages.map((p) => p.post_name).sort()).toEqual(["accueil", "actualites", "commandes-evenements", "contact", "la-maison", "nos-produits"]);
    expect(await wpOk(ctx, ["option", "get", "show_on_front"])).toBe("page");
    const locations = await wpJson<{ location: string; name: string }[]>(ctx, ["menu", "location", "list"]);
    // `wp menu location list` shows assigned menus via `wp menu list`:
    const menus = await wpJson<{ name: string; locations: string[]; count: number }[]>(ctx, ["menu", "list", "--fields=name,locations,count"]);
    expect(menus.find((m) => m.name === "Principal")).toMatchObject({ locations: ["primary"], count: 6 });
    expect(locations.some((l) => l.location === "primary")).toBe(true);

    const settings = await wpJson<{ global_colors: { slug: string; color: string }[]; container_width: string; typography: { selector: string }[] }>(ctx, ["option", "get", "generate_settings"]);
    expect(settings.global_colors.find((c) => c.slug === "accent")?.color).toBe("#7a8b6f");
    expect(settings.container_width).toBe("1140");
    expect(settings.typography.map((r) => r.selector)).toContain("h1");

    const elements = await wpJson<{ post_name: string }[]>(ctx, ["post", "list", "--post_type=gp_elements", "--fields=post_name"]);
    expect(elements.map((e) => e.post_name)).toEqual([FOOTER_ELEMENT_SLUG]);

    const html = await (await fetch(`http://localhost:${ctx.state.port}/`)).text();
    expect(html).toContain("© " + new Date().getFullYear() + " Maison Rivet");
    expect(html).toContain("--accent:#7a8b6f");
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("Fraunces");
    expect(html).toMatch(/<nav[^>]*class="[^"]*main-navigation/);
    expect(html).toContain("/nos-produits/");

    const s2 = await runSite(config, "itchrome", { only: "provision" });
    expect(s2.stages.provision.status).toBe("done");
    const elements2 = await wpJson<{ post_name: string }[]>(ctx, ["post", "list", "--post_type=gp_elements", "--fields=post_name"]);
    expect(elements2).toHaveLength(1);
    const pages2 = await wpJson<{ post_name: string }[]>(ctx, ["post", "list", "--post_type=page", "--fields=post_name"]);
    expect(pages2).toHaveLength(6);
  });
});
```

- [ ] **Step 6: Run the integration test**

Run: `FAKTORY_DOCKER=1 npx vitest run tests/integration/provision-chrome.test.ts --testTimeout=600000 --hookTimeout=600000`
Expected: PASS in 2-4 minutes. If `--accent:#7a8b6f` is missing from the HTML, check that `generate_dynamic_css_output` was emptied (GP caches compiled CSS) and that `global_colors` has the 8 entries. If the footer marker is missing, check `wp option get generate_package_elements` equals `activated` and the element's three metas.

- [ ] **Step 7: Commit**

```bash
git add src/stages/provision.ts tests/unit/stage-provision.test.ts tests/integration/provision-chrome.test.ts
git commit -m "feat(faktory): provision applies identity, pages, menu, tokens and footer from the approved artifacts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 14: `doctor` gb check, README, end-to-end run on the boulangerie brief

**Files:**
- Modify: `src/cli.ts` (doctor), `README.md`
- Test: manual E2E (LLM calls, costs money) + `tests/unit/cli.test.ts` unchanged

- [ ] **Step 1: Add a `gb_build.py` smoke check to `doctor`**

In `src/cli.ts`, after the `skills synced` check:

```ts
    const gbProbe = await run("python3", [gbScript(config, "gb_build.py")], { input: JSON.stringify({ type: "text", content: "ok" }) });
    checks.push(["gb_build.py", gbProbe.code === 0 && gbProbe.stdout.includes("wp:generateblocks/text"), "python3 + synced skills required"]);
```
with `import { gbScript } from "./gb.js";`. Run `npm run faktory -- doctor` and confirm the line `✔ gb_build.py`.

- [ ] **Step 2: Update `README.md`**

Replace the "Usage" and "Stages" sections with:

````markdown
## Usage
```bash
npm run faktory -- init boulangerie --brief fixtures/briefs/boulangerie.md
npm run faktory -- run boulangerie          # spec → stops: edit sites/boulangerie/SITE-SPEC.md
npm run faktory -- approve boulangerie      # re-syncs site-spec.json if you edited the markdown
npm run faktory -- run boulangerie          # design → stops: open preview.html, edit design-system.md
npm run faktory -- approve boulangerie      # re-syncs design-tokens.json if you edited the markdown
npm run faktory -- run boulangerie          # provision: WP + GP stack, identity, pages, menu, tokens, footer
npm run faktory -- run boulangerie --only design --max-cost 10
npm run faktory -- destroy boulangerie
npm run faktory -- doctor --agent
```
Sites live in `sites/<slug>/` (gitignored). `faktory.json` holds stage status, port, admin credentials and cumulated cost.
Site URL: `http://localhost:<port>` (ports start at 8100). Admin: `admin` / password in `faktory.json`.

### Artifacts
| File | Written by | Edit it? |
|---|---|---|
| `SITE-SPEC.md` / `site-spec.json` | spec stage | Edit the `.md`; `approve` re-extracts the JSON when the `.md` is newer |
| `design-system.md` / `design-tokens.json` / `preview.html` | design stage | Edit the `.md` (tokens section included); `approve` re-extracts the JSON and re-renders the preview |
| `design/preview.gb.json`, `design/preview.gb.html` | design stage | Intermediate gb_build tree and markup |

### Cost
`maxCostUsd` in `faktory.config.json` (default 40) caps the cumulated cost of a site; `run --max-cost <usd>` overrides it for one invocation. The SDK also receives the remaining budget as `maxBudgetUsd`. Measured on the boulangerie brief: spec ≈ $__, design ≈ $__ (fill in after the E2E run).

## Stages
spec ⏸ → design ⏸ → provision → plugins → pages → content → qa → export. Phase 2 implements `spec`, `design` and the spec/token-driven part of `provision` (identity, placeholder pages, primary menu, GeneratePress settings, GP Premium footer element). The header is GeneratePress' native header themed by the tokens. Other stages are marked "skipped (not implemented)".
````

- [ ] **Step 3: End-to-end run (manual, ~$3-8)**

```bash
npm run sync-skills && npm run faktory -- doctor
npm run faktory -- destroy boulangerie --yes 2>/dev/null; npm run faktory -- init boulangerie --brief fixtures/briefs/boulangerie.md
npm run faktory -- run boulangerie            # spec; note the cost line
cat sites/boulangerie/SITE-SPEC.md            # sanity: 6 pages, 1 feature "produits", 2 forms, menus
```
Edit `SITE-SPEC.md`: change the tagline line (e.g. append " (test)") and save. Then:
```bash
npm run faktory -- approve boulangerie        # must print "re-extracting" and finish; check:
grep tagline sites/boulangerie/site-spec.json # contains "(test)"
npm run faktory -- run boulangerie            # design; open sites/boulangerie/preview.html in a browser
```
Check `preview.html`: hero + section + CTA, palette warm/wheat/sage as the brief asks, fonts loaded, stacks at 390px wide. Check `design-system.md` has the 10 sections and the Tokens JSON block. Then:
```bash
npm run faktory -- approve boulangerie
npm run faktory -- run boulangerie            # provision
open http://localhost:$(node -e "console.log(require('./sites/boulangerie/faktory.json').port)")
```
Check on the live site: site title "Maison Rivet", primary menu with 6 entries, Google fonts applied (inspect `h1` → Fraunces or whatever the agent chose), footer dark with 3 columns and the copyright, `--accent` in the page CSS matches `design-tokens.json`. Record the costs from `faktory.json` (`costUsd`) in README "Cost".

- [ ] **Step 4: Run the full suites**

Run: `npm test && npm run typecheck && FAKTORY_DOCKER=1 npm run test:integration`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts README.md
git commit -m "docs(faktory): phase 2 usage, artifacts and cost; doctor checks gb_build.py

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

## Acceptance for phase 2 (from the spec's "Ordre de construction" step 2)

- `fixtures/briefs/boulangerie.md` → coherent `SITE-SPEC.md` (6 pages, catalogue feature, 2 forms, local SEO), editable, re-synced at approve.
- `preview.html` clean and token-accurate; `design-system.md` in the shape of `levoyageur/design-system.md`.
- On the live site after provision: identity, 6 pages in the primary menu, GP palette + fonts from the tokens, GP Premium footer element visible on every page, native header themed.
- `npm test` green without Docker/LLM; `FAKTORY_DOCKER=1 npm run test:integration` green; no LLM call in any test.
