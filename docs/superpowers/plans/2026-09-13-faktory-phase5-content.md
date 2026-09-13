# Faktory Phase 5 — Content Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `faktory run <slug>` creates the Gravity Forms forms of the site spec and renders them in the pages, sets the Yoast title/description/keyword of every page, and writes, publishes and verifies the blog articles of the spec.

**Architecture:** The `content` stage runs three sub-steps in order: `forms` (deterministic: Faktory builds the Gravity Forms JSON from `spec.forms`, creates it with `wp gf form create`, records `content/forms.json`, and swaps the `data-faktory-form` wrapper of each page tree for the Gravity Forms block at compile time through the generalized `applyPlacements`), `seo` (deterministic: Yoast post meta from `page.seo`, verified on the rendered `<title>`), `articles` (one structured-output agent per `spec.blog.articles[i]`, concurrency 3, validated by zod + editorial rules with one retry, saved to `content/articles/<slug>.json`, serialized by Faktory to core Gutenberg blocks and published with category, excerpt, featured image and Yoast meta). The `pages` stage applies `content/forms.json` too, so both stage orders work.

**Tech Stack:** Node 24, TypeScript 5, `@anthropic-ai/claude-agent-sdk` 0.3.269 (`outputFormat` json_schema), `zod` 4, `commander` 12, `vitest` 2, `tsx`, Python 3 (`gb_build.py`), Docker Compose, WP-CLI, Gravity Forms 3.1 + CLI add-on 1.7, Yoast SEO 28, WordPress 6.x, GeneratePress 3.6.1, GenerateBlocks 2.4.1.

**Spec:** `docs/superpowers/specs/2026-09-13-faktory-phase5-content-design.md` (this plan implements it entirely) on top of `docs/superpowers/specs/2026-09-12-faktory-design.md` section « 6. content ».

## Global Constraints

- Repo root `/Users/khelil/Developer/partikuls/faktory`; git root is the parent `partikuls` monorepo (run `git` from `faktory/`, paths relative to it). Work on branch `faktory/phase5` (already created, holds the spec commit 6f84e499). No `origin` remote: commits only, no push.
- ESM only, strict TS, imports between `src/` files use the `.js` suffix. Run `npm run typecheck` before every commit.
- **zod 4** (`import { z } from "zod"`). `z.record` is fine in ordinary schemas (never in an MCP `tool()` input shape). `z.toJSONSchema` via `toJsonSchema()` in `src/schemas/json-schema.ts` for the SDK `outputFormat`.
- Default model `config.models.default`; `runAgent` resolves `config.models[stage]` first — never hardcode a model. Stage name passed to `runAgent` is `"content"`.
- `runAgent` keeps `settingSources: []`, `skills: pluginSkillNames()`, always allows `Skill`, `strictMcpConfig: true`, persists cost even on error. Do not change `src/agent.ts`.
- Every WP-CLI call goes through `src/wp.ts` (`runWp` never throws, inspect `code`; `wpOk` throws with stderr; `wpJson` appends `--format=json`). Content for a post goes on stdin: `wpOk(ctx, ["post", "create", "-", …], { input: markup })`.
- Test conventions: `deps` objects on modules as spy seams (`vi.spyOn(deps, "fn")`); helper params typed `any` where vitest 2.1.9 + strict tsc fight; void spies use `mockResolvedValue(undefined)`; `beforeEach(() => vi.restoreAllMocks())`. Unit tests that need a site dir use `loadConfig(mkdtempSync(join(tmpdir(), "fk-…-")))` + `initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" })` + `loadContext(config, "boul")` (`initSite` creates `pages/`, `plugins/`, `content/`, `qa/`, `dist/`, `wp-content/`).
- Integration tests needing Docker: `describe.skipIf(!process.env.FAKTORY_DOCKER)`, run with `FAKTORY_DOCKER=1 npm run test:integration`. Ports used so far: 8190-8195. **This phase uses 8196.**
- Fixture spec `fixtures/specs/boulangerie.site-spec.json`: forms `devis_evenement` (6 fields: nom text, email email, telephone phone, date_evenement date, nombre_personnes number, message textarea; recipient contact@maisonrivet.fr) placed on `commandes-evenements` (section `form`) and `contact` (3 fields: nom, email, message) placed on `contact` (sections `contact` + `form`, same id — one wrapper per page). Blog categories `Saison`, `Recettes`, `Coulisses`; 3 articles, the first titled « La galette des rois revient : frangipane ou pomme ? », theme `Saison`, keywords `["galette des rois Nantes"]`. Pages: accueil (home), nos-produits, commandes-evenements, la-maison, actualites (blog), contact. The live `sites/boulangerie` spec has different categories and 5 articles: derive everything from the spec, never hardcode.
- Verified WP-CLI behaviour (2026-09-13, boulangerie container): `wp gf form create "<title>" --form-json='<json>' --porcelain` prints the new id and accepts a `notifications` object inside the JSON; `wp gf form get <id>` exits 1 with `Error: Form not found` for an unknown id; `wp gf form form_list --format=json` returns `[{ "id": "3", "title": "…", "is_active": "1", … }]` (strings); `wp gf form delete <id> --force` deletes (without `--force` it only trashes). `wp post create - --post_type=post … --porcelain` reads the content from stdin; `wp post term set <id> category <termId> --by=id` works; `wp media import <url> --post_id=<id> --featured_image --alt=<alt> --porcelain` sets `_thumbnail_id` and prints the attachment id; the post URL is `http://localhost:<port>/<slug>/` and the posts page lists it as `href="http://localhost:<port>/<slug>/"`. Yoast meta `_yoast_wpseo_title` / `_yoast_wpseo_metadesc` change the rendered `<title>` and `<meta name="description">` immediately. Both `<!-- wp:gravityforms/form {"formId":"N","title":false,"description":false} /-->` and the shortcode render `gform_wrapper_N`; this phase uses the block.
- Phase 3/4 helpers to reuse, not duplicate: `findWrapper`, `walk`, `featureMarker`, `formMarker`, `FEATURE_WRAPPER_ATTR`, `FORM_WRAPPER_ATTR`, `DENYLIST_RE` (`src/schemas/page-tree.ts`); `compilePage`, `publishPage` (`src/pages/publish.ts`); `readPageTree` (`src/pages/generate.ts`); `ensurePages` (`src/provision/pages.js`); `runValidated`, `runAgent` (`src/agent.ts`); `assertBudget` (`src/budget.ts`); `mapLimit` (`src/concurrency.ts`); `siteUrl` (`src/docker.ts`); `pageUrl`, `deps.fetchText` (`src/pages/render-check.ts`); `loadPrompt` (`src/prompts.ts`); `toJsonSchema` (`src/schemas/json-schema.ts`); `readJsonArtifact` (`src/artifacts.ts`).

## Decisions taken for this phase (approved 2026-09-13, keep them)

1. One stage `content`, sub-steps `forms → seo → articles`, no checkpoint; a failing sub-step fails the stage; everything is idempotent.
2. Forms are built by Faktory (no agent) and created through the Gravity Forms CLI; notification included in the JSON; default confirmation kept; reuse = manifest entry whose `gfId` still exists, else an active form of the same title, else create; Faktory never deletes a form.
3. Compile-time substitution generalized: `applyPlacements(tree, placements)` handles `data-faktory-feature` and `data-faktory-form` wrappers; content republishes existing trees with form wrappers and checks `gform_wrapper_<gfId>`; pages applies `content/forms.json` too and checks the same.
4. Page SEO from `page.seo` via Yoast post meta, verified on the rendered `<title>`.
5. One agent per article, `outputFormat` JSON schema, tools `Read` only, `maxTurns` 8, concurrency 3, `runValidated` once; editorial rules (500–1200 words, ≥ 2 headings, first block paragraph, inline HTML whitelist, denylist, no `[à confirmer]`).
6. Faktory serializes core blocks and publishes idempotently by `post_name = articleSlug(title)`; category ensured; placeholder featured image; Yoast meta; verification by post URL `<title>` and by the posts page linking each post.
7. Article reuse from `content/articles/<slug>.json` ($0). Since Faktory only writes validated output, no poisoned file can result from generation; a hand-edited invalid file fails with a "fix or delete" message.
8. Failed articles are collected; stage fails at the end with the list; budget errors rethrown as-is.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/artifacts.ts` (modify) | `CONTENT_DIR = "content"` |
| `src/schemas/forms-manifest.ts` | `FormsManifest` schema, `parseFormsManifest`, `validateFormsManifest`, `assertFormsManifest`, `gfPlacement(gfId)`, `formPages(spec, formId)`, `FORMS_MANIFEST_REL`, `formsManifestPath(ctx)` |
| `src/pages/placements.ts` (replaces `src/pages/apply-plugins.ts`) | `Placement`, `applyPlacements(tree, placements)`, `pluginPlacements(manifests, pageSlug)`, `formPlacements(manifest, page)`, `readPluginManifests(ctx)`, `readFormsManifest(ctx)` |
| `src/pages/render-check.ts` (modify) | `assertContains(ctx, url, needle, hint)`, `assertTitle(ctx, url, expected)`, `pageTitle(html)`, `decodeEntities(s)`, `formNeedle(gfId)`, `assertFormRendered(ctx, page, gfId)`; `assertRendered` unchanged API |
| `src/content/forms.ts` | `buildGfForm(spec, form)`, `ensureForms(ctx, spec)`, `integrateForms(ctx, spec, manifest, ids)` |
| `src/content/seo.ts` | `YOAST_META`, `applyPageSeo(ctx, spec, ids)` |
| `src/schemas/article.ts` | `ArticleShape(categories)`, `Article`, `ArticleBlock`, `parseArticle`, `validateArticle`, `assertArticle`, `articleSlug`, `countWords`, `inlineHtmlIssues`, `ARTICLES_DIR`, `articleRel/articlePath`, `WORDS_MIN/MAX` |
| `src/content/serialize.ts` | `serializeArticle(article)` |
| `src/prompts/content.md`, `src/prompts.ts` (modify) | System prompt; `PromptName` gains `"content"` |
| `src/content/articles.ts` | `articleCategory`, `articleUserPrompt`, `readArticle`, `generateArticle`, `ensureCategories`, `publishArticle`, `assertArticleRendered`, `assertBlogLists` |
| `src/stages/content.ts`, `src/pipeline.ts` (modify) | `contentStage`, `registry.content` |
| `src/stages/pages.ts` (modify) | applies form placements and checks `gform_wrapper_<N>` |
| `src/plugins/integrate.ts` (modify) | imports from `placements.ts` |
| `fixtures/content/forms.json`, `fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json` | Fixtures for the fixture spec |
| `tests/unit/forms-manifest.test.ts`, `placements.test.ts` (replaces `apply-plugins.test.ts`), `render-check.test.ts`, `content-forms.test.ts`, `content-seo.test.ts`, `article.test.ts`, `serialize.test.ts`, `content-articles.test.ts`, `stage-content.test.ts`; `stage-pages.test.ts`, `pipeline.test.ts`, `prompts.test.ts` (modify) | Unit tests |
| `tests/integration/content.test.ts` | Docker end-to-end on port 8196 |
| `README.md`, spec addendum | Docs, measured cost, deviations |

---

### Task 1: Forms manifest schema

**Files:**
- Modify: `src/artifacts.ts` (add `CONTENT_DIR`)
- Create: `src/schemas/forms-manifest.ts`
- Test: `tests/unit/forms-manifest.test.ts`

**Interfaces:**
- Consumes: `SiteSpec`, `Page` (`src/schemas/site-spec.ts`), `DENYLIST_RE` (`src/schemas/page-tree.ts`), `SiteContext` (`src/docker.ts`).
- Produces: `CONTENT_DIR = "content"`; `FORMS_MANIFEST_REL = "content/forms.json"`; `formsManifestPath(ctx): string`; `gfPlacement(gfId: number): string`; `FormsManifestSchema`; `type FormsManifest = Record<string, { gfId: number; placement: string }>`; `parseFormsManifest(data: unknown): FormsManifest`; `validateFormsManifest(m): string[]`; `assertFormsManifest(m): void`; `formPages(spec: SiteSpec, formId: string): string[]`; `pageForms(page: Page): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/forms-manifest.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import {
  parseFormsManifest, validateFormsManifest, assertFormsManifest, gfPlacement, formPages, pageForms, FORMS_MANIFEST_REL,
} from "../../src/schemas/forms-manifest.js";
import { CONTENT_DIR } from "../../src/artifacts.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));

describe("forms manifest", () => {
  it("names the content dir and the manifest path", () => {
    expect(CONTENT_DIR).toBe("content");
    expect(FORMS_MANIFEST_REL).toBe("content/forms.json");
  });
  it("gfPlacement is the self-closing Gravity Forms block without title/description", () => {
    expect(gfPlacement(3)).toBe('<!-- wp:gravityforms/form {"formId":"3","title":false,"description":false} /-->');
  });
  it("parses the fixture manifest and finds no issue", () => {
    const m = parseFormsManifest(JSON.parse(readFileSync("fixtures/content/forms.json", "utf8")));
    expect(Object.keys(m).sort()).toEqual(["contact", "devis_evenement"]);
    expect(m.contact.gfId).toBe(1);
    expect(validateFormsManifest(m)).toEqual([]);
    expect(() => assertFormsManifest(m)).not.toThrow();
  });
  it("rejects bad keys, ids and shapes", () => {
    expect(() => parseFormsManifest({ "Contact-Form": { gfId: 1, placement: gfPlacement(1) } })).toThrow(/Invalid forms manifest/);
    expect(() => parseFormsManifest({ contact: { gfId: 0, placement: gfPlacement(0) } })).toThrow(/Invalid forms manifest/);
    expect(() => parseFormsManifest({ contact: { gfId: 1 } })).toThrow(/Invalid forms manifest/);
    expect(() => parseFormsManifest({ contact: { gfId: 1, placement: gfPlacement(1), extra: true } })).toThrow(/Invalid forms manifest/);
  });
  it("flags forbidden markup and a placement whose formId differs from gfId", () => {
    const issues = validateFormsManifest({
      contact: { gfId: 1, placement: '<!-- wp:gravityforms/form {"formId":"2","title":false,"description":false} /-->' },
      devis: { gfId: 2, placement: '<script>alert(1)</script>' },
    });
    expect(issues).toHaveLength(3);
    expect(issues[0]).toMatch(/contact: must be the block <!-- wp:gravityforms\/form \{…"formId":"1"…\} \/-->/);
    expect(issues[1]).toMatch(/devis: forbidden markup \(<script\)/);
    expect(issues[2]).toMatch(/devis: must be the block/);
    expect(() => assertFormsManifest({ contact: { gfId: 1, placement: "x" } })).toThrow(/content\/forms.json is invalid:\n- contact: must be the block/);
  });
  it("formPages lists, in sitemap order, the pages whose form/contact section references the form", () => {
    expect(formPages(spec, "contact")).toEqual(["contact"]);
    expect(formPages(spec, "devis_evenement")).toEqual(["commandes-evenements"]);
    expect(formPages(spec, "nope")).toEqual([]);
  });
  it("pageForms lists each form id of a page once, in section order", () => {
    const contact = spec.sitemap.find((p) => p.slug === "contact")!;
    expect(pageForms(contact)).toEqual(["contact"]);
    expect(pageForms(spec.sitemap.find((p) => p.slug === "accueil")!)).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the fixture manifest**

```json
// fixtures/content/forms.json
{
  "contact": { "gfId": 1, "placement": "<!-- wp:gravityforms/form {\"formId\":\"1\",\"title\":false,\"description\":false} /-->" },
  "devis_evenement": { "gfId": 2, "placement": "<!-- wp:gravityforms/form {\"formId\":\"2\",\"title\":false,\"description\":false} /-->" }
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/forms-manifest.test.ts`
Expected: FAIL — `Cannot find module '../../src/schemas/forms-manifest.js'`.

- [ ] **Step 4: Implement**

In `src/artifacts.ts`, after `PAGES_DIR`:

```ts
export const CONTENT_DIR = "content";
```

```ts
// src/schemas/forms-manifest.ts
import { z } from "zod";
import { join } from "node:path";
import type { SiteContext } from "../docker.js";
import { CONTENT_DIR } from "../artifacts.js";
import { DENYLIST_RE } from "./page-tree.js";
import type { Page, SiteSpec } from "./site-spec.js";

export const FORMS_MANIFEST_REL = `${CONTENT_DIR}/forms.json`;
export const formsManifestPath = (ctx: SiteContext): string => join(ctx.siteDir, FORMS_MANIFEST_REL);

/** The Gravity Forms block Faktory places in a page (editable in Gutenberg, unlike the shortcode). */
export const gfPlacement = (gfId: number): string => `<!-- wp:gravityforms/form {"formId":"${gfId}","title":false,"description":false} /-->`;

const key = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key");

export const FormsManifestSchema = z.record(key, z.strictObject({
  gfId: z.number().int().positive(),
  placement: z.string().min(1),
}));
export type FormsManifest = z.infer<typeof FormsManifestSchema>;

export function parseFormsManifest(data: unknown): FormsManifest {
  const r = FormsManifestSchema.safeParse(data);
  if (!r.success) throw new Error(`Invalid forms manifest: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

function placementRe(gfId: number): RegExp {
  return new RegExp(`^<!-- wp:gravityforms/form \\{.*"formId":"${gfId}".*\\} /-->$`);
}

/** No forbidden markup, and a self-closing gravityforms/form block whose formId is the entry's gfId. */
export function validateFormsManifest(m: FormsManifest): string[] {
  const issues: string[] = [];
  for (const [id, entry] of Object.entries(m)) {
    const forbidden = entry.placement.match(DENYLIST_RE);
    if (forbidden) issues.push(`${id}: forbidden markup (${forbidden[0]})`);
    if (!placementRe(entry.gfId).test(entry.placement)) {
      issues.push(`${id}: must be the block <!-- wp:gravityforms/form {…"formId":"${entry.gfId}"…} /--> (got "${entry.placement.slice(0, 80)}")`);
    }
  }
  return issues;
}

export function assertFormsManifest(m: FormsManifest): void {
  const issues = validateFormsManifest(m);
  if (issues.length) throw new Error(`${FORMS_MANIFEST_REL} is invalid:\n- ${issues.join("\n- ")}`);
}

/** Form ids referenced by a page's form/contact sections, each once, in section order. */
export function pageForms(page: Page): string[] {
  const out: string[] = [];
  for (const s of page.sections) {
    if ((s.type === "form" || s.type === "contact") && s.form && !out.includes(s.form)) out.push(s.form);
  }
  return out;
}

/** Slugs of the pages that carry `formId`, in sitemap order. */
export function formPages(spec: SiteSpec, formId: string): string[] {
  return spec.sitemap.filter((p) => pageForms(p).includes(formId)).map((p) => p.slug);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/forms-manifest.test.ts && npm run typecheck`
Expected: 7 tests pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/artifacts.ts src/schemas/forms-manifest.ts fixtures/content/forms.json tests/unit/forms-manifest.test.ts
git commit -m "feat(faktory): forms manifest schema for the content stage"
```

---

### Task 2: Generalize compile-time placements (features + forms)

**Files:**
- Create: `src/pages/placements.ts`
- Delete: `src/pages/apply-plugins.ts`
- Modify: `src/stages/pages.ts` (imports + call), `src/plugins/integrate.ts` (imports + call)
- Test: `tests/unit/placements.test.ts` (replaces `tests/unit/apply-plugins.test.ts`, delete the old file)

**Interfaces:**
- Consumes: `FEATURE_WRAPPER_ATTR`, `FORM_WRAPPER_ATTR`, `GbNode`, `PageTree` (`src/schemas/page-tree.ts`); `PluginManifest`, `parsePluginManifest`, `validatePlacements`, `PLUGINS_DIR` (`src/schemas/plugin-manifest.ts`); `FormsManifest`, `parseFormsManifest`, `assertFormsManifest`, `formsManifestPath`, `FORMS_MANIFEST_REL`, `pageForms` (Task 1); `Page`.
- Produces: `type Placement = { attr: string; id: string; markup: string }`; `applyPlacements(tree: PageTree, placements: Placement[]): { tree: PageTree; applied: Placement[] }` (pure); `pluginPlacements(manifests: PluginManifest[], pageSlug: string): Placement[]`; `formPlacements(manifest: FormsManifest, page: Page): Placement[]`; `readPluginManifests(ctx): PluginManifest[]` (moved, unchanged); `readFormsManifest(ctx): FormsManifest` (`{}` when the file does not exist; parsed + `assertFormsManifest` otherwise).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/placements.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPlacements, pluginPlacements, formPlacements, readPluginManifests, readFormsManifest, type Placement,
} from "../../src/pages/placements.js";
import { parsePluginManifest } from "../../src/schemas/plugin-manifest.js";
import { parseFormsManifest, gfPlacement } from "../../src/schemas/forms-manifest.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { findWrapper, findMarkers, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type PageTree } from "../../src/schemas/page-tree.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const tree = (): PageTree => JSON.parse(readFileSync("fixtures/pages/accueil.gb.json", "utf8"));
const manifest = parsePluginManifest(JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8")));
const forms = parseFormsManifest(JSON.parse(readFileSync("fixtures/content/forms.json", "utf8")));
const contact = spec.sitemap.find((p) => p.slug === "contact")!;

/** A contact-page tree with the form wrapper the pages prompt requires. */
const contactTree = (): PageTree => [{
  type: "element", tagName: "section", innerBlocks: [
    { type: "text", tagName: "h1", content: "Contact" },
    { type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: "contact" }, innerBlocks: [
      { type: "raw", rawMarkup: formMarker("contact") },
      { type: "text", tagName: "p", content: "Le formulaire sera disponible ici." },
    ] },
  ],
}];

describe("pluginPlacements / formPlacements", () => {
  it("builds one feature placement per manifest that places on the page", () => {
    expect(pluginPlacements([manifest], "accueil")).toEqual([{ attr: FEATURE_WRAPPER_ATTR, id: "catalogue_produits", markup: manifest.placements["accueil"] }]);
    expect(pluginPlacements([manifest], "contact")).toEqual([]);
  });
  it("builds one form placement per form of the page present in the manifest", () => {
    expect(formPlacements(forms, contact)).toEqual([{ attr: FORM_WRAPPER_ATTR, id: "contact", markup: gfPlacement(1) }]);
    expect(formPlacements({}, contact)).toEqual([]);
    expect(formPlacements(forms, spec.sitemap.find((p) => p.slug === "accueil")!)).toEqual([]);
  });
});

describe("applyPlacements", () => {
  it("replaces the whole feature wrapper with a raw node carrying the placement, without mutating the input", () => {
    const input = tree();
    const before = JSON.stringify(input);
    const r = applyPlacements(input, pluginPlacements([manifest], "accueil"));
    expect(r.applied.map((p) => p.id)).toEqual(["catalogue_produits"]);
    expect(JSON.stringify(input)).toBe(before);
    expect(findWrapper(r.tree, "feature", "catalogue_produits")).toBeUndefined();
    expect(findMarkers(r.tree)).toEqual([]);
    const section = r.tree[1].innerBlocks![0];
    const raw = section.innerBlocks!.find((n) => n.type === "raw")!;
    expect(raw.rawMarkup).toBe(manifest.placements["accueil"]);
  });
  it("replaces the form wrapper (marker + placeholder card) with the Gravity Forms block", () => {
    const r = applyPlacements(contactTree(), formPlacements(forms, contact));
    expect(r.applied.map((p) => p.id)).toEqual(["contact"]);
    expect(findWrapper(r.tree, "form", "contact")).toBeUndefined();
    expect(JSON.stringify(r.tree)).not.toContain("Le formulaire sera disponible ici.");
    expect(r.tree[0].innerBlocks![1]).toEqual({ type: "raw", rawMarkup: gfPlacement(1) });
  });
  it("leaves the tree untouched when nothing matches", () => {
    const none: Placement[] = [{ attr: FORM_WRAPPER_ATTR, id: "other", markup: gfPlacement(9) }];
    const r = applyPlacements(contactTree(), none);
    expect(r.applied).toEqual([]);
    expect(r.tree).toEqual(contactTree());
  });
});

describe("readPluginManifests / readFormsManifest", () => {
  function site(): SiteContext {
    const dir = mkdtempSync(join(tmpdir(), "fk-plc-"));
    return { siteDir: dir } as SiteContext;
  }
  it("return [] / {} when the files do not exist", () => {
    const c = site();
    expect(readPluginManifests(c)).toEqual([]);
    expect(readFormsManifest(c)).toEqual({});
  });
  it("read and re-validate the manifests on disk", () => {
    const c = site();
    mkdirSync(join(c.siteDir, "plugins")); mkdirSync(join(c.siteDir, "content"));
    writeFileSync(join(c.siteDir, "plugins/catalogue_produits.json"), readFileSync("fixtures/plugins/catalogue_produits.manifest.json"));
    writeFileSync(join(c.siteDir, "content/forms.json"), readFileSync("fixtures/content/forms.json"));
    expect(readPluginManifests(c).map((m) => m.feature)).toEqual(["catalogue_produits"]);
    expect(readFormsManifest(c)).toEqual(forms);
  });
  it("fail with the file name when a manifest is invalid JSON or invalid", () => {
    const c = site();
    mkdirSync(join(c.siteDir, "content"));
    writeFileSync(join(c.siteDir, "content/forms.json"), "{nope");
    expect(() => readFormsManifest(c)).toThrow(/content\/forms.json is not valid JSON/);
    writeFileSync(join(c.siteDir, "content/forms.json"), JSON.stringify({ contact: { gfId: 1, placement: "<script>" } }));
    expect(() => readFormsManifest(c)).toThrow(/content\/forms.json is invalid/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/placements.test.ts`
Expected: FAIL — `Cannot find module '../../src/pages/placements.js'`.

- [ ] **Step 3: Implement `src/pages/placements.ts`, delete `apply-plugins.ts`**

```ts
// src/pages/placements.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SiteContext } from "../docker.js";
import { FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type GbNode, type PageTree } from "../schemas/page-tree.js";
import { PLUGINS_DIR, parsePluginManifest, validatePlacements, type PluginManifest } from "../schemas/plugin-manifest.js";
import { FORMS_MANIFEST_REL, assertFormsManifest, formsManifestPath, pageForms, parseFormsManifest, type FormsManifest } from "../schemas/forms-manifest.js";
import type { Page } from "../schemas/site-spec.js";

/** A wrapper `attr="<id>"` in a page tree and the block markup that replaces it at compile time. */
export type Placement = { attr: string; id: string; markup: string };

/** Replace, in `nodes` (recursively), the first element carrying `attr=<id>` by `replacement`. Returns true when replaced. */
function replaceWrapper(nodes: GbNode[], attr: string, id: string, replacement: GbNode): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === "element" && n.htmlAttributes?.[attr] === id) { nodes[i] = replacement; return true; }
    if (n.innerBlocks?.length && replaceWrapper(n.innerBlocks, attr, id, replacement)) return true;
  }
  return false;
}

/**
 * Compile-time substitution (phase 4 decision 1, phase 5 decision 3): the tree on disk keeps its placeholder
 * wrappers; the copy handed to gb_build gets the plugin block / Gravity Forms block instead. Pure — the input is not mutated.
 */
export function applyPlacements(tree: PageTree, placements: Placement[]): { tree: PageTree; applied: Placement[] } {
  const copy: PageTree = JSON.parse(JSON.stringify(tree));
  const applied: Placement[] = [];
  for (const p of placements) {
    if (replaceWrapper(copy, p.attr, p.id, { type: "raw", rawMarkup: p.markup })) applied.push(p);
  }
  return { tree: copy, applied };
}

/** Feature placements of `pageSlug` from every plugin manifest that places there. */
export function pluginPlacements(manifests: PluginManifest[], pageSlug: string): Placement[] {
  const out: Placement[] = [];
  for (const m of manifests) {
    const markup = m.placements[pageSlug];
    if (markup) out.push({ attr: FEATURE_WRAPPER_ATTR, id: m.feature, markup });
  }
  return out;
}

/** Form placements of `page`: its form/contact sections' forms that exist in the manifest. */
export function formPlacements(manifest: FormsManifest, page: Page): Placement[] {
  const out: Placement[] = [];
  for (const id of pageForms(page)) {
    const entry = manifest[id];
    if (entry) out.push({ attr: FORM_WRAPPER_ATTR, id, markup: entry.placement });
  }
  return out;
}

/**
 * Every `plugins/*.json` of the site, parsed and re-checked, sorted by file name; [] when the directory
 * does not exist. The placements are markup this stage injects into pages, so they are validated here too.
 */
export function readPluginManifests(ctx: SiteContext): PluginManifest[] {
  const dir = join(ctx.siteDir, PLUGINS_DIR);
  if (!existsSync(dir)) return [];
  const out: PluginManifest[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const rel = `${PLUGINS_DIR}/${f}`;
    let data: unknown;
    try { data = JSON.parse(readFileSync(join(dir, f), "utf8")); }
    catch (err) { throw new Error(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
    let m: PluginManifest;
    try { m = parsePluginManifest(data); }
    catch (err) { throw new Error(`${rel}: ${err instanceof Error ? err.message : String(err)}`); }
    const issues = validatePlacements(m);
    if (issues.length) throw new Error(`${rel}: ${issues.join("; ")}`);
    out.push(m);
  }
  return out;
}

/** `content/forms.json`, parsed and re-validated; {} when the file does not exist. */
export function readFormsManifest(ctx: SiteContext): FormsManifest {
  const p = formsManifestPath(ctx);
  if (!existsSync(p)) return {};
  let data: unknown;
  try { data = JSON.parse(readFileSync(p, "utf8")); }
  catch (err) { throw new Error(`${FORMS_MANIFEST_REL} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
  let m: FormsManifest;
  try { m = parseFormsManifest(data); }
  catch (err) { throw new Error(`${FORMS_MANIFEST_REL}: ${err instanceof Error ? err.message : String(err)}`); }
  assertFormsManifest(m);
  return m;
}
```

Then `git rm src/pages/apply-plugins.ts tests/unit/apply-plugins.test.ts`.

- [ ] **Step 4: Update the two call sites**

In `src/stages/pages.ts`: replace the import `import { applyPlugins, readPluginManifests } from "../pages/apply-plugins.js";` by `import { applyPlacements, pluginPlacements, readPluginManifests } from "../pages/placements.js";` and, inside `build`, replace

```ts
      const a = applyPlugins(tree, manifests, page.slug);
      a.applied.forEach((id) => applied.add(id));
      const markup = await deps.compilePage(ctx, page.slug, a.tree);
      await deps.publishPage(ctx, ids[page.slug], markup);
      // Fresh-site order (provision → plugins → pages): the plugins stage had no tree to insert the block
      // into, so this is the only place the render contract of every applied plugin is checked.
      for (const id of a.applied) await assertRendered(ctx, page, id);
```

by

```ts
      const a = applyPlacements(tree, pluginPlacements(manifests, page.slug));
      const features = a.applied.map((p) => p.id);
      features.forEach((id) => applied.add(id));
      const markup = await deps.compilePage(ctx, page.slug, a.tree);
      await deps.publishPage(ctx, ids[page.slug], markup);
      // Fresh-site order (provision → plugins → pages): the plugins stage had no tree to insert the block
      // into, so this is the only place the render contract of every applied plugin is checked.
      for (const id of features) await assertRendered(ctx, page, id);
```

(Task 9 adds the form placements here.) In `src/plugins/integrate.ts`: replace the import by `import { applyPlacements, pluginPlacements, readPluginManifests } from "../pages/placements.js";` and the compile line by

```ts
    const markup = await deps.compilePage(ctx, slug, applyPlacements(tree, pluginPlacements(manifests, slug)).tree);
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm run typecheck && npx vitest run tests/unit/placements.test.ts tests/unit/stage-pages.test.ts tests/unit/plugins-integrate.test.ts tests/unit/stage-plugins.test.ts`
Expected: all pass (the pages/plugins tests exercise the same behaviour through the new module).

- [ ] **Step 6: Commit**

```bash
git add -A src/pages/placements.ts src/pages/apply-plugins.ts src/stages/pages.ts src/plugins/integrate.ts tests/unit/placements.test.ts tests/unit/apply-plugins.test.ts
git commit -m "refactor(faktory): generalize compile-time placements to feature and form wrappers"
```

---

### Task 3: Generic render checks (`assertContains`, `assertTitle`, `assertFormRendered`)

**Files:**
- Modify: `src/pages/render-check.ts`
- Test: `tests/unit/render-check.test.ts` (new)

**Interfaces:**
- Consumes: `siteUrl`, `SiteContext` (`src/docker.ts`); `RENDER_ATTR`; `Page`.
- Produces (all exported from `src/pages/render-check.ts`, `deps.fetchText` stays the spy seam): `decodeEntities(s: string): string`; `pageTitle(html: string): string | undefined` (decoded, whitespace-collapsed content of the first `<title>`); `assertContains(ctx, url: string, needle: string, hint: string): Promise<string>` (returns the HTML); `assertTitle(ctx, url: string, expected: string): Promise<void>`; `formNeedle(gfId: number): string` = `gform_wrapper_<gfId>`; `assertFormRendered(ctx, page: Page, gfId: number): Promise<void>`; `assertRendered(ctx, page, featureId)` unchanged signature, now built on `assertContains`; `pageUrl` unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/render-check.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import type { SiteContext } from "../../src/docker.js";
import { deps, decodeEntities, pageTitle, assertContains, assertTitle, assertRendered, assertFormRendered, formNeedle } from "../../src/pages/render-check.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };
const contact = spec.sitemap.find((p) => p.slug === "contact")!;

describe("decodeEntities / pageTitle", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("Pains &amp; viennoiseries &#8211; L&#039;atelier &quot;Rivet&quot; &lt;3 &#x27;ok&#x27;")).toBe("Pains & viennoiseries – L'atelier \"Rivet\" <3 'ok'");
  });
  it("extracts the first <title>, decoded and trimmed", () => {
    expect(pageTitle("<html><head>\n<title>\n  Contact &amp; horaires - Maison Rivet </title></head><title>second</title>")).toBe("Contact & horaires - Maison Rivet");
    expect(pageTitle("<html><head></head></html>")).toBeUndefined();
  });
});

describe("assertContains / assertTitle", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("returns the html when the needle is present, throws with the hint otherwise", async () => {
    vi.spyOn(deps, "fetchText").mockResolvedValue("<html>needle</html>");
    await expect(assertContains(ctx, "http://localhost:8100/x/", "needle", "check X")).resolves.toBe("<html>needle</html>");
    await expect(assertContains(ctx, "http://localhost:8100/x/", "absent", "check X")).rejects.toThrow(/http:\/\/localhost:8100\/x\/ does not contain "absent" — check X/);
  });
  it("assertTitle compares the decoded <title> with the expected string", async () => {
    vi.spyOn(deps, "fetchText").mockResolvedValue("<title>Contact &amp; horaires</title>");
    await expect(assertTitle(ctx, "http://localhost:8100/contact/", "Contact & horaires")).resolves.toBeUndefined();
    await expect(assertTitle(ctx, "http://localhost:8100/contact/", "Autre")).rejects.toThrow(/http:\/\/localhost:8100\/contact\/ has title "Contact & horaires", expected "Autre"/);
  });
  it("propagates fetch errors", async () => {
    vi.spyOn(deps, "fetchText").mockRejectedValue(new Error("GET http://localhost:8100/x/ → 404"));
    await expect(assertContains(ctx, "http://localhost:8100/x/", "n", "h")).rejects.toThrow(/→ 404/);
  });
});

describe("assertRendered / assertFormRendered", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("assertRendered keeps its message and URL mapping", async () => {
    const f = vi.spyOn(deps, "fetchText").mockResolvedValue("<div></div>");
    await expect(assertRendered(ctx, contact, "catalogue_produits")).rejects.toThrow(/\/contact\/ \(contact\) does not render data-faktory-plugin="catalogue_produits" — check the render function and that the block is registered/);
    expect(f).toHaveBeenCalledWith("http://localhost:8100/contact/");
  });
  it("assertFormRendered requires gform_wrapper_<gfId> on the page", async () => {
    expect(formNeedle(7)).toBe("gform_wrapper_7");
    vi.spyOn(deps, "fetchText").mockResolvedValue('<div class="gform_wrapper gravity-theme" id="gform_wrapper_7">');
    await expect(assertFormRendered(ctx, contact, 7)).resolves.toBeUndefined();
    await expect(assertFormRendered(ctx, contact, 8)).rejects.toThrow(/\/contact\/ \(contact\) does not render gform_wrapper_8 — check that Gravity Forms is active and form #8 exists/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/render-check.test.ts`
Expected: FAIL — `decodeEntities` / `assertContains` are not exported.

- [ ] **Step 3: Rewrite `src/pages/render-check.ts`**

```ts
import { siteUrl, type SiteContext } from "../docker.js";
import { RENDER_ATTR } from "../schemas/plugin-manifest.js";
import type { Page } from "../schemas/site-spec.js";

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.text();
}

export const deps = { fetchText };

export function pageUrl(ctx: SiteContext, page: Page): string {
  return page.kind === "home" ? `${siteUrl(ctx)}/` : `${siteUrl(ctx)}/${page.slug}/`;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—" };

/** Decode the HTML entities WordPress and Yoast emit in titles (named subset + numeric). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m);
}

/** Decoded, whitespace-collapsed text of the first <title>; undefined when the page has none. */
export function pageTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : undefined;
}

/** Fetch `url` and require `needle` in its HTML; the hint says what to look at when it is missing. Returns the HTML. */
export async function assertContains(ctx: SiteContext, url: string, needle: string, hint: string): Promise<string> {
  void ctx;
  const html = await deps.fetchText(url);
  if (!html.includes(needle)) throw new Error(`${url} does not contain "${needle}" — ${hint}`);
  return html;
}

/** Fetch `url` and require its decoded <title> to equal `expected`. */
export async function assertTitle(ctx: SiteContext, url: string, expected: string): Promise<void> {
  void ctx;
  const title = pageTitle(await deps.fetchText(url));
  if (title !== expected) throw new Error(`${url} has title ${title === undefined ? "none" : `"${title}"`}, expected "${expected}"`);
}

function label(page: Page): string {
  return `${page.kind === "home" ? "/" : `/${page.slug}/`} (${page.slug})`;
}

/**
 * The published-page half of the plugin contract: whichever stage inserted the block (`plugins` on an
 * existing tree, `pages` on a fresh one), the page must actually render `data-faktory-plugin="<id>"`.
 */
export async function assertRendered(ctx: SiteContext, page: Page, featureId: string): Promise<void> {
  const needle = `${RENDER_ATTR}="${featureId}"`;
  const html = await deps.fetchText(pageUrl(ctx, page));
  if (!html.includes(needle)) {
    throw new Error(`${label(page)} does not render ${needle} — check the render function and that the block is registered`);
  }
}

export const formNeedle = (gfId: number): string => `gform_wrapper_${gfId}`;

/** The published-page half of the forms contract: the Gravity Forms block placed by `content` or `pages` must render its wrapper. */
export async function assertFormRendered(ctx: SiteContext, page: Page, gfId: number): Promise<void> {
  const html = await deps.fetchText(pageUrl(ctx, page));
  if (!html.includes(formNeedle(gfId))) {
    throw new Error(`${label(page)} does not render ${formNeedle(gfId)} — check that Gravity Forms is active and form #${gfId} exists`);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run typecheck && npx vitest run tests/unit/render-check.test.ts tests/unit/plugins-integrate.test.ts tests/unit/stage-pages.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/render-check.ts tests/unit/render-check.test.ts
git commit -m "feat(faktory): generic render checks (contains, title, Gravity Forms wrapper)"
```

---

### Task 4: Forms — build, create, record, integrate

**Files:**
- Create: `src/content/forms.ts`
- Test: `tests/unit/content-forms.test.ts`

**Interfaces:**
- Consumes: `SiteSpec`, `Form` type (`z.infer<typeof Form>` — export it from `src/schemas/site-spec.ts` as `export type Form = z.infer<typeof Form>;` right after the `Form` schema), `runWp`, `wpOk`, `wpJson` (`src/wp.ts`), `readPageTree`, `pageTreePath`, `compilePage`, `publishPage`, `applyPlacements`, `pluginPlacements`, `formPlacements`, `readPluginManifests`, `readFormsManifest`, `assertFormRendered`, `gfPlacement`, `formPages`, `formsManifestPath`, `FORMS_MANIFEST_REL`, `FormsManifest`.
- Produces: `deps = { runWp, wpOk, wpJson, compilePage, publishPage }`; `type GfForm` (the JSON object); `buildGfForm(spec: SiteSpec, form: Form, slug = "<slug>"): GfForm` (throws on `select` without options; `slug` only names the site in the resync hint); `ensureForms(ctx, spec): Promise<{ manifest: FormsManifest; created: string[]; reused: string[] }>` (writes `content/forms.json`); `integrateForms(ctx, spec, manifest, ids: Record<string, number>): Promise<{ pages: string[]; skipped: string[] }>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/content-forms.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { pageTreePath } from "../../src/artifacts.js";
import { parseSiteSpec, type Page } from "../../src/schemas/site-spec.js";
import { formMarker, FORM_WRAPPER_ATTR, type PageTree } from "../../src/schemas/page-tree.js";
import { gfPlacement, formsManifestPath } from "../../src/schemas/forms-manifest.js";
import { buildGfForm, ensureForms, integrateForms, deps } from "../../src/content/forms.js";
import { deps as renderDeps } from "../../src/pages/render-check.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const devis = spec.forms.find((f) => f.id === "devis_evenement")!;
const contactForm = spec.forms.find((f) => f.id === "contact")!;
const IDS: Record<string, number> = { accueil: 10, "nos-produits": 11, "commandes-evenements": 12, "la-maison": 13, actualites: 14, contact: 15 };

function stubTree(page: Page): PageTree {
  return page.sections.map((s, i) => ({
    type: "element" as const, tagName: "section", innerBlocks: [
      { type: "text" as const, tagName: i === 0 ? "h1" : "h2", content: s.heading },
      ...((s.type === "form" || s.type === "contact") && s.form && !page.sections.slice(0, i).some((x) => x.form === s.form)
        ? [{ type: "element" as const, tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: s.form }, innerBlocks: [
            { type: "raw" as const, rawMarkup: formMarker(s.form) }, { type: "text" as const, tagName: "p", content: "Le formulaire sera disponible ici." } ] }]
        : []),
    ],
  }));
}
async function ctx(): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-forms-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}

describe("buildGfForm", () => {
  it("maps every spec field type, required flags and the admin notification", () => {
    const f = buildGfForm(spec, devis);
    expect(f.title).toBe(devis.name);
    expect(f.description).toBe("");
    expect(f.labelPlacement).toBe("top_label");
    expect(f.requiredIndicator).toBe("text");
    expect(f.button).toEqual({ type: "text", text: "Envoyer" });
    expect(f.fields.map((x) => [x.id, x.type, x.label, x.adminLabel, x.isRequired])).toEqual([
      [1, "text", "Nom", "nom", true], [2, "email", "Email", "email", true], [3, "phone", "Téléphone", "telephone", true],
      [4, "date", "Date de l'événement", "date_evenement", true], [5, "number", "Nombre de personnes", "nombre_personnes", true], [6, "textarea", "Votre projet", "message", false],
    ]);
    expect(f.fields[2]).toMatchObject({ phoneFormat: "international" });
    expect(f.fields[3]).toMatchObject({ dateType: "datepicker", dateFormat: "dmy" });
    expect(f.fields[4]).toMatchObject({ numberFormat: "decimal_dot" });
    expect(f.notifications).toEqual({ faktory_admin: {
      id: "faktory_admin", name: "Notification admin", event: "form_submission", to: "contact@maisonrivet.fr", toType: "email",
      from: "{admin_email}", fromName: spec.identity.name, subject: `[${spec.identity.name}] ${devis.name}`, message: "{all_fields}", isActive: true,
    } });
  });
  it("maps select options to choices and refuses a select without options", () => {
    const f = buildGfForm(spec, { ...contactForm, fields: [...contactForm.fields, { key: "sujet", label: "Sujet", type: "select", required: false, options: ["Commande", "Autre"] }] });
    expect(f.fields[3]).toMatchObject({ type: "select", choices: [{ text: "Commande", value: "Commande" }, { text: "Autre", value: "Autre" }] });
    expect(() => buildGfForm(spec, { ...contactForm, fields: [{ key: "sujet", label: "Sujet", type: "select", required: false }] }))
      .toThrow(/form "contact": field "sujet" is a select without options — fix SITE-SPEC.md and run: faktory resync <slug>/);
  });
});

describe("ensureForms", () => {
  beforeEach(() => vi.restoreAllMocks());
  function spies(opts: { existing?: number[]; listed?: { id: string; title: string; is_active: string }[] } = {}) {
    let next = 100;
    const runWp = vi.spyOn(deps, "runWp").mockImplementation(async (_c, args) => {
      if (args[0] === "gf" && args[2] === "get") return { code: (opts.existing ?? []).includes(Number(args[3])) ? 0 : 1, stdout: "", stderr: "Error: Form not found" };
      throw new Error(`unexpected runWp ${args.join(" ")}`);
    });
    const wpJson = vi.spyOn(deps, "wpJson").mockImplementation(async (_c, args) => {
      if (args[0] === "gf" && args[2] === "form_list") return (opts.listed ?? []) as any;
      throw new Error(`unexpected wpJson ${args.join(" ")}`);
    });
    const wpOk = vi.spyOn(deps, "wpOk").mockImplementation(async (_c, args) => {
      if (args[0] === "gf" && args[2] === "create") return String(next++);
      throw new Error(`unexpected wpOk ${args.join(" ")}`);
    });
    return { runWp, wpJson, wpOk };
  }
  it("creates every form of the spec with its JSON, writes the manifest", async () => {
    const c = await ctx();
    const s = spies();
    const r = await ensureForms(c, spec);
    expect(r.created).toEqual(["devis_evenement", "contact"]);
    expect(r.reused).toEqual([]);
    expect(r.manifest).toEqual({ devis_evenement: { gfId: 100, placement: gfPlacement(100) }, contact: { gfId: 101, placement: gfPlacement(101) } });
    const call = s.wpOk.mock.calls[0][1] as string[];
    expect(call.slice(0, 4)).toEqual(["gf", "form", "create", devis.name]);
    expect(call[4].startsWith("--form-json=")).toBe(true);
    expect(JSON.parse(call[4].slice("--form-json=".length))).toEqual(buildGfForm(spec, devis));
    expect(call[5]).toBe("--porcelain");
    expect(JSON.parse(readFileSync(formsManifestPath(c), "utf8"))).toEqual(r.manifest);
  });
  it("reuses a manifest entry whose form still exists, recreates a vanished one", async () => {
    const c = await ctx();
    writeFileSync(formsManifestPath(c), JSON.stringify({ devis_evenement: { gfId: 3, placement: gfPlacement(3) }, contact: { gfId: 4, placement: gfPlacement(4) } }));
    const s = spies({ existing: [3] });
    const r = await ensureForms(c, spec);
    expect(r.reused).toEqual(["devis_evenement"]);
    expect(r.created).toEqual(["contact"]);
    expect(r.manifest.devis_evenement.gfId).toBe(3);
    expect(r.manifest.contact.gfId).toBe(100);
    expect(s.wpOk).toHaveBeenCalledTimes(1);
  });
  it("adopts an active form of the same title before creating", async () => {
    const c = await ctx();
    const s = spies({ listed: [{ id: "7", title: contactForm.name, is_active: "1" }, { id: "8", title: devis.name, is_active: "0" }] });
    const r = await ensureForms(c, spec);
    expect(r.manifest.contact.gfId).toBe(7);
    expect(r.reused).toEqual(["contact"]);
    expect(r.created).toEqual(["devis_evenement"]); // inactive twin ignored → created
    expect(s.wpOk).toHaveBeenCalledTimes(1);
  });
  it("writes nothing and returns an empty manifest when the spec has no forms", async () => {
    const c = await ctx();
    spies();
    const r = await ensureForms(c, { ...spec, forms: [], sitemap: spec.sitemap.map((p) => ({ ...p, sections: p.sections.filter((s) => s.type !== "form" && s.type !== "contact") })) });
    expect(r).toEqual({ manifest: {}, created: [], reused: [] });
    expect(existsSync(formsManifestPath(c))).toBe(false);
  });
});

describe("integrateForms", () => {
  beforeEach(() => vi.restoreAllMocks());
  const manifest = { devis_evenement: { gfId: 2, placement: gfPlacement(2) }, contact: { gfId: 1, placement: gfPlacement(1) } };
  function spies(html = (url: string) => `<div id="gform_wrapper_${url.includes("contact") ? 1 : 2}"></div>`) {
    const compile = vi.spyOn(deps, "compilePage").mockImplementation(async (_c, slug) => `<!-- ${slug} -->`);
    const publish = vi.spyOn(deps, "publishPage").mockResolvedValue(undefined);
    const fetchText = vi.spyOn(renderDeps, "fetchText").mockImplementation(async (url) => html(url));
    return { compile, publish, fetchText };
  }
  it("recompiles, republishes and checks each page whose tree exists; skips the others", async () => {
    const c = await ctx();
    const contact = spec.sitemap.find((p) => p.slug === "contact")!;
    writeFileSync(pageTreePath(c, "contact"), JSON.stringify(stubTree(contact)));
    const s = spies();
    const r = await integrateForms(c, spec, manifest, IDS);
    expect(r).toEqual({ pages: ["contact"], skipped: ["commandes-evenements"] });
    const tree = s.compile.mock.calls[0][2] as PageTree;
    expect(JSON.stringify(tree)).toContain(gfPlacement(1).replace(/"/g, '\\"'));
    expect(JSON.stringify(tree)).not.toContain(FORM_WRAPPER_ATTR);
    expect(s.publish).toHaveBeenCalledWith(c, 15, "<!-- contact -->");
    expect(s.fetchText).toHaveBeenCalledWith(`http://localhost:${c.state.port}/contact/`);
  });
  it("also applies the plugin manifests of the site when republishing", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "pages"), { recursive: true });
    copyFileSync("fixtures/plugins/catalogue_produits.manifest.json", join(c.siteDir, "plugins/catalogue_produits.json"));
    const commandes = spec.sitemap.find((p) => p.slug === "commandes-evenements")!;
    writeFileSync(pageTreePath(c, "commandes-evenements"), JSON.stringify(stubTree(commandes)));
    spies();
    const r = await integrateForms(c, spec, manifest, IDS);
    expect(r.pages).toEqual(["commandes-evenements"]);
  });
  it("fails when the published page does not render the wrapper", async () => {
    const c = await ctx();
    const contact = spec.sitemap.find((p) => p.slug === "contact")!;
    writeFileSync(pageTreePath(c, "contact"), JSON.stringify(stubTree(contact)));
    spies(() => "<html>no form</html>");
    await expect(integrateForms(c, spec, manifest, IDS)).rejects.toThrow(/\/contact\/ \(contact\) does not render gform_wrapper_1/);
  });
  it("fails on a page with a tree but no WordPress id", async () => {
    const c = await ctx();
    const contact = spec.sitemap.find((p) => p.slug === "contact")!;
    writeFileSync(pageTreePath(c, "contact"), JSON.stringify(stubTree(contact)));
    spies();
    await expect(integrateForms(c, spec, manifest, {})).rejects.toThrow(/no WordPress page for slug "contact" — run the provision stage first/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/content-forms.test.ts`
Expected: FAIL — module `src/content/forms.js` not found.

- [ ] **Step 3: Implement**

Add to `src/schemas/site-spec.ts` right after the `Form` schema: `export type Form = z.infer<typeof Form>;`.

```ts
// src/content/forms.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SiteContext } from "../docker.js";
import { runWp, wpOk, wpJson } from "../wp.js";
import { pageTreePath } from "../artifacts.js";
import { readPageTree } from "../pages/generate.js";
import { compilePage, publishPage } from "../pages/publish.js";
import { applyPlacements, formPlacements, pluginPlacements, readFormsManifest, readPluginManifests } from "../pages/placements.js";
import { assertFormRendered } from "../pages/render-check.js";
import { formPages, formsManifestPath, gfPlacement, type FormsManifest } from "../schemas/forms-manifest.js";
import type { Form, SiteSpec } from "../schemas/site-spec.js";

export const deps = { runWp, wpOk, wpJson, compilePage, publishPage };

export type GfField = {
  id: number; type: string; label: string; adminLabel: string; isRequired: boolean;
  phoneFormat?: string; dateType?: string; dateFormat?: string; numberFormat?: string; choices?: { text: string; value: string }[];
};
export type GfForm = {
  title: string; description: string; labelPlacement: string; requiredIndicator: string;
  button: { type: string; text: string }; fields: GfField[];
  notifications: Record<string, { id: string; name: string; event: string; to: string; toType: string; from: string; fromName: string; subject: string; message: string; isActive: boolean }>;
};

/** Spec form → Gravity Forms form JSON (spec « Formulaire Gravity Forms »). Throws on a select without options. */
export function buildGfForm(spec: SiteSpec, form: Form, slug = "<slug>"): GfForm {
  const fields = form.fields.map((f, i): GfField => {
    const base: GfField = { id: i + 1, type: f.type, label: f.label, adminLabel: f.key, isRequired: f.required };
    switch (f.type) {
      case "phone": return { ...base, phoneFormat: "international" };
      case "date": return { ...base, dateType: "datepicker", dateFormat: "dmy" };
      case "number": return { ...base, numberFormat: "decimal_dot" };
      case "select":
        if (!f.options?.length) throw new Error(`form "${form.id}": field "${f.key}" is a select without options — fix SITE-SPEC.md and run: faktory resync ${slug}`);
        return { ...base, choices: f.options.map((o) => ({ text: o, value: o })) };
      default: return base;
    }
  });
  const name = spec.identity.name;
  return {
    title: form.name, description: "", labelPlacement: "top_label", requiredIndicator: "text",
    button: { type: "text", text: "Envoyer" }, fields,
    notifications: { faktory_admin: {
      id: "faktory_admin", name: "Notification admin", event: "form_submission", to: form.recipient, toType: "email",
      from: "{admin_email}", fromName: name, subject: `[${name}] ${form.name}`, message: "{all_fields}", isActive: true,
    } },
  };
}

type Listed = { id: string; title: string; is_active: string };

async function formExists(ctx: SiteContext, gfId: number): Promise<boolean> {
  return (await deps.runWp(ctx, ["gf", "form", "get", String(gfId)])).code === 0;
}

/**
 * Create the Gravity Forms forms of the spec (decision 2): reuse the manifest entry when its form still exists,
 * else adopt an active form of the same title, else create. Writes `content/forms.json`; no form is ever deleted.
 */
export async function ensureForms(ctx: SiteContext, spec: SiteSpec): Promise<{ manifest: FormsManifest; created: string[]; reused: string[] }> {
  if (!spec.forms.length) return { manifest: {}, created: [], reused: [] };
  const previous = readFormsManifest(ctx);
  const manifest: FormsManifest = {};
  const created: string[] = [], reused: string[] = [];
  let listed: Listed[] | undefined;
  for (const form of spec.forms) {
    const gf = buildGfForm(spec, form, ctx.slug); // validates the spec before any wp call
    const prev = previous[form.id];
    if (prev && await formExists(ctx, prev.gfId)) {
      manifest[form.id] = { gfId: prev.gfId, placement: gfPlacement(prev.gfId) };
      reused.push(form.id);
      continue;
    }
    listed ??= await deps.wpJson<Listed[]>(ctx, ["gf", "form", "form_list"]);
    const twin = listed.find((l) => l.title === form.name && l.is_active === "1");
    if (twin) {
      manifest[form.id] = { gfId: Number(twin.id), placement: gfPlacement(Number(twin.id)) };
      reused.push(form.id);
      continue;
    }
    const gfId = Number(await deps.wpOk(ctx, ["gf", "form", "create", form.name, `--form-json=${JSON.stringify(gf)}`, "--porcelain"]));
    if (!Number.isInteger(gfId) || gfId <= 0) throw new Error(`wp gf form create "${form.name}" did not return a form id`);
    manifest[form.id] = { gfId, placement: gfPlacement(gfId) };
    created.push(form.id);
    console.log(`  ✔ form ${form.id} → Gravity Forms #${gfId}`);
  }
  const p = formsManifestPath(ctx);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(manifest, null, 2) + "\n");
  return { manifest, created, reused };
}

/**
 * For every page that carries a form of the manifest and whose tree exists: apply every placement of the site
 * (plugins + forms), recompile, republish, then require `gform_wrapper_<gfId>` on the page. Pages without a
 * tree are skipped: the `pages` stage applies the manifest — and checks the wrapper — when it builds them.
 */
export async function integrateForms(
  ctx: SiteContext, spec: SiteSpec, manifest: FormsManifest, ids: Record<string, number>,
): Promise<{ pages: string[]; skipped: string[] }> {
  const manifests = readPluginManifests(ctx);
  const slugs: string[] = [];
  for (const id of Object.keys(manifest)) for (const s of formPages(spec, id)) if (!slugs.includes(s)) slugs.push(s);
  const pages: string[] = [], skipped: string[] = [];
  for (const slug of slugs) {
    const page = spec.sitemap.find((p) => p.slug === slug)!;
    if (!existsSync(pageTreePath(ctx, slug))) { skipped.push(slug); continue; }
    const id = ids[slug];
    if (!id) throw new Error(`no WordPress page for slug "${slug}" — run the provision stage first`);
    const tree = readPageTree(ctx, page);
    const forms = formPlacements(manifest, page);
    const a = applyPlacements(tree, [...pluginPlacements(manifests, slug), ...forms]);
    const markup = await deps.compilePage(ctx, slug, a.tree);
    await deps.publishPage(ctx, id, markup);
    for (const f of forms) await assertFormRendered(ctx, page, manifest[f.id].gfId);
    pages.push(slug);
    console.log(`  ✔ /${slug}/ renders ${forms.map((f) => `form ${f.id} (#${manifest[f.id].gfId})`).join(", ")}`);
  }
  return { pages, skipped };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run typecheck && npx vitest run tests/unit/content-forms.test.ts`
Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/forms.ts src/schemas/site-spec.ts tests/unit/content-forms.test.ts
git commit -m "feat(faktory): build, create and integrate Gravity Forms forms from the site spec"
```

---

### Task 5: Page SEO (Yoast meta + title check)

**Files:**
- Create: `src/content/seo.ts`
- Test: `tests/unit/content-seo.test.ts`

**Interfaces:**
- Consumes: `wpOk` (`src/wp.ts`), `assertTitle`, `pageUrl` (`src/pages/render-check.ts`), `SiteSpec`.
- Produces: `deps = { wpOk }`; `YOAST_META = { title: "_yoast_wpseo_title", metadesc: "_yoast_wpseo_metadesc", focuskw: "_yoast_wpseo_focuskw" }`; `applyPageSeo(ctx, spec, ids: Record<string, number>): Promise<string[]>` (slugs updated, in sitemap order; throws on a page without id or whose rendered title differs).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/content-seo.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { applyPageSeo, deps, YOAST_META } from "../../src/content/seo.js";
import { deps as renderDeps } from "../../src/pages/render-check.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "boul", siteDir: "/tmp/fk/sites/boul", state: createState("boul", 8100, "pw") };
const IDS: Record<string, number> = { accueil: 10, "nos-produits": 11, "commandes-evenements": 12, "la-maison": 13, actualites: 14, contact: 15 };
const esc = (s: string) => s.replace(/&/g, "&amp;");

describe("applyPageSeo", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("sets the three Yoast meta of every page (blog page included) and verifies the rendered title", async () => {
    const wpOk = vi.spyOn(deps, "wpOk").mockResolvedValue("Success");
    const fetchText = vi.spyOn(renderDeps, "fetchText").mockImplementation(async (url) => {
      const page = spec.sitemap.find((p) => (p.kind === "home" ? url.endsWith(":8100/") : url.endsWith(`/${p.slug}/`)))!;
      return `<html><head><title>${esc(page.seo.title)}</title></head></html>`;
    });
    const done = await applyPageSeo(ctx, spec, IDS);
    expect(done).toEqual(spec.sitemap.map((p) => p.slug));
    expect(wpOk).toHaveBeenCalledTimes(spec.sitemap.length * 3);
    const contact = spec.sitemap.find((p) => p.slug === "contact")!;
    expect(wpOk).toHaveBeenCalledWith(ctx, ["post", "meta", "update", "15", YOAST_META.title, contact.seo.title]);
    expect(wpOk).toHaveBeenCalledWith(ctx, ["post", "meta", "update", "15", YOAST_META.metadesc, contact.seo.metaDescription]);
    expect(wpOk).toHaveBeenCalledWith(ctx, ["post", "meta", "update", "15", YOAST_META.focuskw, contact.seo.keywords[0]]);
    expect(fetchText).toHaveBeenCalledWith("http://localhost:8100/");
    expect(fetchText).toHaveBeenCalledWith("http://localhost:8100/actualites/");
  });
  it("fails when the rendered title differs (Yoast inactive or meta ignored)", async () => {
    vi.spyOn(deps, "wpOk").mockResolvedValue("Success");
    vi.spyOn(renderDeps, "fetchText").mockResolvedValue("<title>Maison Rivet</title>");
    await expect(applyPageSeo(ctx, spec, IDS)).rejects.toThrow(/http:\/\/localhost:8100\/ has title "Maison Rivet", expected ".*" — check that wordpress-seo is active/);
  });
  it("fails on a sitemap page without a WordPress id", async () => {
    vi.spyOn(deps, "wpOk").mockResolvedValue("Success");
    await expect(applyPageSeo(ctx, spec, { accueil: 10 })).rejects.toThrow(/no WordPress page for slug "nos-produits" — run the provision stage first/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/content-seo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/content/seo.ts
import type { SiteContext } from "../docker.js";
import { wpOk } from "../wp.js";
import { assertTitle, pageUrl } from "../pages/render-check.js";
import type { SiteSpec } from "../schemas/site-spec.js";

export const deps = { wpOk };

export const YOAST_META = { title: "_yoast_wpseo_title", metadesc: "_yoast_wpseo_metadesc", focuskw: "_yoast_wpseo_focuskw" } as const;

/** Yoast title / description / focus keyword of every sitemap page from `page.seo` (decision 4), then the rendered <title> must match. Returns the slugs done. */
export async function applyPageSeo(ctx: SiteContext, spec: SiteSpec, ids: Record<string, number>): Promise<string[]> {
  const done: string[] = [];
  for (const page of spec.sitemap) {
    const id = ids[page.slug];
    if (!id) throw new Error(`no WordPress page for slug "${page.slug}" — run the provision stage first`);
    await deps.wpOk(ctx, ["post", "meta", "update", String(id), YOAST_META.title, page.seo.title]);
    await deps.wpOk(ctx, ["post", "meta", "update", String(id), YOAST_META.metadesc, page.seo.metaDescription]);
    await deps.wpOk(ctx, ["post", "meta", "update", String(id), YOAST_META.focuskw, page.seo.keywords[0]]);
    try {
      await assertTitle(ctx, pageUrl(ctx, page), page.seo.title);
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : String(err)} — check that wordpress-seo is active`);
    }
    done.push(page.slug);
  }
  return done;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run typecheck && npx vitest run tests/unit/content-seo.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/seo.ts tests/unit/content-seo.test.ts
git commit -m "feat(faktory): Yoast title, description and keyword per page"
```

---

### Task 6: Article schema, editorial validation, slug, serializer, fixture

**Files:**
- Create: `src/schemas/article.ts`, `src/content/serialize.ts`, `fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json`
- Test: `tests/unit/article.test.ts`, `tests/unit/serialize.test.ts`

**Interfaces:**
- Consumes: `DENYLIST_RE` (`src/schemas/page-tree.ts`), `CONTENT_DIR`, `SiteSpec`, `toJsonSchema`.
- Produces (`src/schemas/article.ts`): `ARTICLES_DIR = "content/articles"`; `articleRel(slug)`, `articlePath(ctx, slug)`; `articleSlug(title: string): string`; `WORDS_MIN = 500`, `WORDS_MAX = 1200`; `type ArticleBlock = { type: "heading"; level: number; text: string } | { type: "paragraph"; text: string } | { type: "list"; ordered: boolean; items: string[] } | { type: "quote"; text: string; cite?: string }`; `type Article = { title: string; excerpt: string; category: string; seo: { title: string; metaDescription: string }; blocks: ArticleBlock[] }`; `ArticleShape(categories: string[]): z.ZodType<Article>`; `parseArticle(data: unknown, categories: string[]): Article`; `countWords(article): number`; `inlineHtmlIssues(text: string, at: string, issues: string[]): void`; `validateArticle(article, spec): string[]`; `assertArticle(article, spec): void`. (`src/content/serialize.ts`): `serializeArticle(article: Article): string`.

- [ ] **Step 1: Write the fixture article** (valid for the fixture spec: category `Saison`, ≥ 500 words, first block paragraph, ≥ 2 headings, one internal link)

```json
{
  "title": "La galette des rois revient : frangipane ou pomme ?",
  "excerpt": "Chaque janvier, deux galettes sortent du fournil de Maison Rivet : la frangipane classique et une version aux pommes. Comment elles sont faites, comment choisir, comment réserver.",
  "category": "Saison",
  "seo": {
    "title": "Galette des rois à Nantes : frangipane ou pomme ? | Maison Rivet",
    "metaDescription": "Galette des rois artisanale à Chantenay, Nantes : frangipane pur beurre ou pommes du verger. Nos deux recettes, nos conseils pour choisir et réserver."
  },
  "blocks": [
    { "type": "paragraph", "text": "Chaque année, la galette des rois revient au fournil avec les premiers jours de janvier. Chez Maison Rivet, à Chantenay, nous en préparons deux : la <strong>frangipane</strong> classique, celle que l'on attend, et une galette aux <strong>pommes</strong> plus légère, pensée pour ceux qui préfèrent le fruit à la crème d'amande. Cet article raconte comment elles sont faites, ce qui les distingue, et comment les réserver sans stress pour l'Épiphanie." },
    { "type": "heading", "level": 2, "text": "Deux recettes, un seul feuilletage" },
    { "type": "paragraph", "text": "Tout commence par la pâte feuilletée. Nous la préparons au beurre, en plusieurs tours, sur deux jours, pour obtenir des couches fines et régulières qui gonflent bien à la cuisson. C'est le même feuilletage pour les deux galettes : il doit rester croustillant à l'extérieur et fondant à l'intérieur, sans jamais devenir gras. Une galette réussie se reconnaît à sa croûte dorée, à ses stries nettes et à son parfum de beurre cuit quand on la coupe." },
    { "type": "paragraph", "text": "La frangipane est un mélange de crème d'amande et de crème pâtissière. Nous utilisons des amandes en poudre de bonne qualité, du beurre, du sucre et des œufs, avec une pointe de rhum pour relever l'ensemble. La galette aux pommes reprend le même feuilletage mais remplace la crème par des pommes coupées en petits morceaux, cuites doucement avec un peu de sucre et de cannelle jusqu'à obtenir une compotée encore texturée." },
    { "type": "heading", "level": 2, "text": "Frangipane ou pomme : comment choisir ?" },
    { "type": "paragraph", "text": "La question revient chaque année au comptoir, et la réponse dépend surtout du moment où la galette sera servie. Quelques repères simples :" },
    { "type": "list", "ordered": false, "items": [
      "<strong>Pour un goûter en famille</strong> : la frangipane fait l'unanimité, les enfants comme les grands-parents la connaissent et l'attendent.",
      "<strong>Pour un repas déjà copieux</strong> : la galette aux pommes passe mieux en fin de repas, elle est moins riche et plus acidulée.",
      "<strong>Pour un bureau ou une grande tablée</strong> : prenez une de chaque, les deux formats se coupent facilement en huit ou dix parts.",
      "<strong>Pour les amateurs de tradition</strong> : la frangipane reste la galette de référence, celle que l'on trouve dans les boulangeries depuis des générations."
    ] },
    { "type": "paragraph", "text": "Dans les deux cas, la galette se déguste tiède. Quelques minutes au four, à basse température, suffisent pour réveiller le feuilletage si vous la servez le lendemain. Évitez le micro-ondes, qui ramollit la pâte." },
    { "type": "heading", "level": 2, "text": "La fève, la couronne et le rituel" },
    { "type": "paragraph", "text": "Chaque galette est livrée avec sa fève et sa couronne dorée. Le rituel reste le même : le plus jeune de la table se glisse dessous et attribue les parts à l'aveugle. Celui ou celle qui trouve la fève devient roi ou reine de la journée et, selon la tradition, offre la galette suivante. C'est souvent ce qui explique que la saison dure tout le mois de janvier plutôt qu'une seule journée." },
    { "type": "quote", "text": "Une bonne galette, c'est d'abord un bon feuilletage. Le reste, c'est une question de goût.", "cite": "L'équipe du fournil" },
    { "type": "heading", "level": 2, "text": "Comment réserver votre galette" },
    { "type": "paragraph", "text": "Les galettes sont disponibles en boutique tout le mois de janvier, en plusieurs tailles selon le nombre de convives. Pour être certain d'avoir la vôtre un week-end ou pour une grande tablée, nous vous conseillons de la réserver quelques jours à l'avance, en boutique ou par téléphone. Retrouvez l'ensemble de nos pains, viennoiseries et pâtisseries sur la page <a href=\"/nos-produits/\">nos produits</a>, et pour une commande d'entreprise ou un événement, consultez la page <a href=\"/commandes-evenements/\">commandes et événements</a>." },
    { "type": "paragraph", "text": "Frangipane ou pomme, il n'y a pas de mauvais choix : les deux sortent du même four, avec le même soin, et disparaissent en général avant la fin de l'après-midi. Nous vous attendons au fournil de Chantenay pour partager la galette des rois à Nantes, comme chaque année." }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/article.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { toJsonSchema } from "../../src/schemas/json-schema.js";
import {
  ArticleShape, parseArticle, validateArticle, assertArticle, articleSlug, countWords, inlineHtmlIssues,
  ARTICLES_DIR, articleRel, WORDS_MIN, WORDS_MAX, type Article,
} from "../../src/schemas/article.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const fixture = (): Article => JSON.parse(readFileSync("fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json", "utf8"));
const cats = spec.blog.categories;

describe("articleSlug", () => {
  it("strips accents and punctuation, kebab-cases, caps at 60 chars without a trailing dash", () => {
    expect(articleSlug("La galette des rois revient : frangipane ou pomme ?")).toBe("la-galette-des-rois-revient-frangipane-ou-pomme");
    expect(articleSlug("Réussir ses tartines au levain à la maison")).toBe("reussir-ses-tartines-au-levain-a-la-maison");
    expect(articleSlug("4 heures du matin au fournil : une nuit avec l'équipe")).toBe("4-heures-du-matin-au-fournil-une-nuit-avec-l-equipe");
    expect(articleSlug("Organiser un petit-déjeuner d'entreprise sur l'Île de Nantes et ailleurs encore")).toBe("organiser-un-petit-dejeuner-d-entreprise-sur-l-ile-de-nantes");
    expect(articleSlug("   ")).toBe("article");
  });
  it("names the article files", () => {
    expect(ARTICLES_DIR).toBe("content/articles");
    expect(articleRel("x")).toBe("content/articles/x.json");
  });
});

describe("ArticleShape / parseArticle", () => {
  it("accepts the fixture and produces a JSON schema with the category enum", () => {
    const a = parseArticle(fixture(), cats);
    expect(a.category).toBe("Saison");
    const schema = toJsonSchema(ArticleShape(cats)) as any;
    expect(schema.properties.category.enum).toEqual(cats);
    expect(schema.$schema).toBeUndefined();
  });
  it("rejects an unknown category, an unknown block type, long titles and short excerpts", () => {
    expect(() => parseArticle({ ...fixture(), category: "Autre" }, cats)).toThrow(/Invalid article: category/);
    const pad = [{ type: "paragraph", text: "y" }, { type: "paragraph", text: "z" }];
    expect(() => parseArticle({ ...fixture(), blocks: [{ type: "image", src: "x" }, ...pad] }, cats)).toThrow(/Invalid article: blocks\.0/);
    expect(() => parseArticle({ ...fixture(), title: "x".repeat(91) }, cats)).toThrow(/Invalid article: title/);
    expect(() => parseArticle({ ...fixture(), excerpt: "court" }, cats)).toThrow(/Invalid article: excerpt/);
    expect(() => parseArticle({ ...fixture(), seo: { title: "x".repeat(71), metaDescription: "y".repeat(60) } }, cats)).toThrow(/Invalid article: seo.title/);
    expect(() => parseArticle({ ...fixture(), blocks: [{ type: "heading", level: 4, text: "x" }, ...pad] }, cats)).toThrow(/Invalid article: blocks\.0\.level/);
    expect(() => parseArticle({ ...fixture(), blocks: [{ type: "list", ordered: false, items: ["one"] }, ...pad] }, cats)).toThrow(/Invalid article: blocks\.0\.items/);
    expect(() => parseArticle({ ...fixture(), blocks: pad }, cats)).toThrow(/Invalid article: blocks/); // min 3 blocks
  });
});

describe("countWords / inlineHtmlIssues", () => {
  it("counts words across all block texts, tags excluded", () => {
    const a: Article = { ...fixture(), blocks: [
      { type: "paragraph", text: "Un <strong>deux</strong> trois." },
      { type: "heading", level: 2, text: "Quatre cinq" },
      { type: "list", ordered: true, items: ["six", "sept huit"] },
      { type: "quote", text: "neuf", cite: "dix" },
    ] };
    expect(countWords(a)).toBe(10);
    expect(countWords(fixture())).toBeGreaterThanOrEqual(WORDS_MIN);
  });
  it("allows strong/em/a with safe hrefs, refuses everything else", () => {
    const ok: string[] = [];
    inlineHtmlIssues('Un <strong>a</strong> <em>b</em> <a href="/contact/">c</a> <a href="https://x.fr/y">d</a>', "p", ok);
    expect(ok).toEqual([]);
    const bad: string[] = [];
    inlineHtmlIssues('<span>x</span> <a href="http://x.fr">y</a> <a href="javascript:alert(1)">z</a> <img src="x"> <a onclick="x" href="/a/">w</a>', "blocks.2", bad);
    expect(bad).toEqual([
      "blocks.2: forbidden inline HTML <span>",
      'blocks.2: forbidden inline HTML <a href="http://x.fr"> (href must start with / or https://)',
      "blocks.2: forbidden markup (javascript:)",
      "blocks.2: forbidden inline HTML <img src=\"x\">",
      "blocks.2: forbidden markup (onclick=)",
    ]);
  });
});

describe("validateArticle", () => {
  it("accepts the fixture", () => {
    expect(validateArticle(fixture(), spec)).toEqual([]);
    expect(() => assertArticle(fixture(), spec)).not.toThrow();
  });
  it("lists every editorial rule broken", () => {
    const short: Article = { ...fixture(), category: "Recettes", blocks: [
      { type: "heading", level: 2, text: "Titre [à confirmer]" },
      { type: "paragraph", text: "Trop court <span>ici</span>." },
    ] };
    const issues = validateArticle(short, spec);
    expect(issues).toContain(`article has 5 words, expected between ${WORDS_MIN} and ${WORDS_MAX}`);
    expect(issues).toContain("article needs at least 2 headings, found 1");
    expect(issues).toContain("the first block must be a paragraph (an intro before the first heading), found heading");
    expect(issues).toContain("blocks.0: contains the placeholder [à confirmer] — use only facts from the brief");
    expect(issues).toContain("blocks.1: forbidden inline HTML <span>");
    const long: Article = { ...fixture(), blocks: [{ type: "paragraph", text: Array(WORDS_MAX + 1).fill("mot").join(" ") }, { type: "heading", level: 2, text: "a" }, { type: "heading", level: 2, text: "b" }] };
    expect(validateArticle(long, spec)).toContain(`article has ${WORDS_MAX + 3} words, expected between ${WORDS_MIN} and ${WORDS_MAX}`);
    expect(validateArticle({ ...fixture(), category: "Nope" }, spec)).toContain(`category "Nope" is not one of the spec's blog categories (${cats.join(", ")})`);
    expect(() => assertArticle(short, spec)).toThrow(/article is invalid:\n- article has 5 words/);
  });
});
```

```ts
// tests/unit/serialize.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { serializeArticle } from "../../src/content/serialize.js";
import type { Article } from "../../src/schemas/article.js";

const fixture = (): Article => JSON.parse(readFileSync("fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json", "utf8"));

describe("serializeArticle", () => {
  it("emits core block markup for each block type", () => {
    const a: Article = { ...fixture(), blocks: [
      { type: "paragraph", text: "Intro <strong>forte</strong>." },
      { type: "heading", level: 2, text: "Titre" },
      { type: "heading", level: 3, text: "Sous-titre" },
      { type: "list", ordered: false, items: ["un", "deux"] },
      { type: "list", ordered: true, items: ["a", "b"] },
      { type: "quote", text: "Citation", cite: "Auteur" },
      { type: "quote", text: "Sans auteur" },
    ] };
    expect(serializeArticle(a)).toBe([
      "<!-- wp:paragraph -->\n<p>Intro <strong>forte</strong>.</p>\n<!-- /wp:paragraph -->",
      '<!-- wp:heading -->\n<h2 class="wp-block-heading">Titre</h2>\n<!-- /wp:heading -->',
      '<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">Sous-titre</h3>\n<!-- /wp:heading -->',
      '<!-- wp:list -->\n<ul class="wp-block-list"><!-- wp:list-item -->\n<li>un</li>\n<!-- /wp:list-item --><!-- wp:list-item -->\n<li>deux</li>\n<!-- /wp:list-item --></ul>\n<!-- /wp:list -->',
      '<!-- wp:list {"ordered":true} -->\n<ol class="wp-block-list"><!-- wp:list-item -->\n<li>a</li>\n<!-- /wp:list-item --><!-- wp:list-item -->\n<li>b</li>\n<!-- /wp:list-item --></ol>\n<!-- /wp:list -->',
      '<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>Citation</p>\n<!-- /wp:paragraph --><cite>Auteur</cite></blockquote>\n<!-- /wp:quote -->',
      '<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>Sans auteur</p>\n<!-- /wp:paragraph --></blockquote>\n<!-- /wp:quote -->',
    ].join("\n\n") + "\n");
  });
  it("serializes the fixture with one block comment per block", () => {
    const out = serializeArticle(fixture());
    // each quote nests one paragraph block, hence the extra closing comments
    expect(out.match(/<!-- \/wp:(paragraph|heading|list|quote) -->/g)).toHaveLength(fixture().blocks.length + fixture().blocks.filter((b) => b.type === "quote").length);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/article.test.ts tests/unit/serialize.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `src/schemas/article.ts`**

```ts
import { z } from "zod";
import { join } from "node:path";
import type { SiteContext } from "../docker.js";
import { CONTENT_DIR } from "../artifacts.js";
import { DENYLIST_RE } from "./page-tree.js";
import type { SiteSpec } from "./site-spec.js";

export const ARTICLES_DIR = `${CONTENT_DIR}/articles`;
export const articleRel = (slug: string): string => `${ARTICLES_DIR}/${slug}.json`;
export const articlePath = (ctx: SiteContext, slug: string): string => join(ctx.siteDir, articleRel(slug));

export const WORDS_MIN = 500;
export const WORDS_MAX = 1200;
export const PLACEHOLDER = "[à confirmer]";

/** Deterministic post_name from the spec's article title: accents stripped, kebab-case, ≤ 60 chars. */
export function articleSlug(title: string): string {
  const s = title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const cut = s.slice(0, 60).replace(/-+$/g, "");
  return cut || "article";
}

const text = z.string().min(1);
const Heading = z.strictObject({ type: z.literal("heading"), level: z.number().int().min(2).max(3), text });
const Paragraph = z.strictObject({ type: z.literal("paragraph"), text });
const List = z.strictObject({ type: z.literal("list"), ordered: z.boolean(), items: z.array(text).min(2) });
const Quote = z.strictObject({ type: z.literal("quote"), text, cite: z.string().optional() });

export type ArticleBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string; cite?: string };

export type Article = {
  title: string; excerpt: string; category: string;
  seo: { title: string; metaDescription: string };
  blocks: ArticleBlock[];
};

/** The agent's output format: the category enum is the spec's list, so the JSON schema pins it. */
export function ArticleShape(categories: string[]): z.ZodType<Article> {
  return z.strictObject({
    title: z.string().min(1).max(90).describe("Article title, French"),
    excerpt: z.string().min(40).max(200).describe("1-2 sentences shown in listings"),
    category: z.enum(categories as [string, ...string[]]),
    seo: z.strictObject({ title: z.string().min(1).max(70), metaDescription: z.string().min(50).max(160) }),
    blocks: z.array(z.discriminatedUnion("type", [Heading, Paragraph, List, Quote])).min(3)
      .describe("Body, in order: paragraph / heading (level 2-3) / list / quote. Inline HTML allowed: <strong>, <em>, <a href>"),
  }) as unknown as z.ZodType<Article>;
}

export function parseArticle(data: unknown, categories: string[]): Article {
  const r = ArticleShape(categories).safeParse(data);
  if (!r.success) throw new Error(`Invalid article: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

function texts(a: Article): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  a.blocks.forEach((b, i) => {
    const at = `blocks.${i}`;
    if (b.type === "list") b.items.forEach((it, j) => out.push({ at: `${at}.items.${j}`, text: it }));
    else out.push({ at, text: b.text });
    if (b.type === "quote" && b.cite) out.push({ at: `${at}.cite`, text: b.cite });
  });
  return out;
}

export function countWords(a: Article): number {
  return texts(a).reduce((n, t) => n + (t.text.replace(/<[^>]+>/g, " ").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length, 0);
}

const INLINE_RE = /<[^>]+>/g;
const ALLOWED_RE = /^<\/?(strong|em)>$|^<\/a>$|^<a href="([^"]*)">$/;

/** Only <strong>, <em> and <a href="/…"|"https://…"> may appear in article text (decision 5). */
export function inlineHtmlIssues(text: string, at: string, issues: string[]): void {
  const forbidden = text.match(DENYLIST_RE);
  if (forbidden) issues.push(`${at}: forbidden markup (${forbidden[0]})`);
  for (const tag of text.match(INLINE_RE) ?? []) {
    if (DENYLIST_RE.test(tag)) continue; // already reported above
    const m = tag.match(ALLOWED_RE);
    if (!m) { issues.push(`${at}: forbidden inline HTML ${tag}`); continue; }
    if (m[2] !== undefined && !(m[2].startsWith("/") || m[2].startsWith("https://"))) {
      issues.push(`${at}: forbidden inline HTML ${tag} (href must start with / or https://)`);
    }
  }
}

/** Editorial rules on top of the schema (decision 5). Empty = valid. */
export function validateArticle(a: Article, spec: SiteSpec): string[] {
  const issues: string[] = [];
  const cats = spec.blog.categories;
  if (!cats.includes(a.category)) issues.push(`category "${a.category}" is not one of the spec's blog categories (${cats.join(", ")})`);
  const words = countWords(a);
  if (words < WORDS_MIN || words > WORDS_MAX) issues.push(`article has ${words} words, expected between ${WORDS_MIN} and ${WORDS_MAX}`);
  const headings = a.blocks.filter((b) => b.type === "heading").length;
  if (headings < 2) issues.push(`article needs at least 2 headings, found ${headings}`);
  if (a.blocks[0]?.type !== "paragraph") issues.push(`the first block must be a paragraph (an intro before the first heading), found ${a.blocks[0]?.type ?? "nothing"}`);
  for (const t of [...texts(a), { at: "title", text: a.title }, { at: "excerpt", text: a.excerpt }, { at: "seo.title", text: a.seo.title }, { at: "seo.metaDescription", text: a.seo.metaDescription }]) {
    if (t.text.includes(PLACEHOLDER)) issues.push(`${t.at}: contains the placeholder ${PLACEHOLDER} — use only facts from the brief`);
    inlineHtmlIssues(t.text, t.at, issues);
  }
  return issues;
}

export function assertArticle(a: Article, spec: SiteSpec): void {
  const issues = validateArticle(a, spec);
  if (issues.length) throw new Error(`article is invalid:\n- ${issues.join("\n- ")}`);
}
```

Note on `countWords` for the unit test: "Un <strong>deux</strong> trois." → 3, "Quatre cinq" → 2, "six" + "sept huit" → 3, "neuf" + cite "dix" → 2 = 10. The regex treats `l'équipe` as one word (apostrophe joiner), which is the intent.

- [ ] **Step 5: Implement `src/content/serialize.ts`**

```ts
import type { Article, ArticleBlock } from "../schemas/article.js";

function block(b: ArticleBlock): string {
  switch (b.type) {
    case "paragraph":
      return `<!-- wp:paragraph -->\n<p>${b.text}</p>\n<!-- /wp:paragraph -->`;
    case "heading": {
      const attrs = b.level === 2 ? "" : ` {"level":${b.level}}`;
      return `<!-- wp:heading${attrs} -->\n<h${b.level} class="wp-block-heading">${b.text}</h${b.level}>\n<!-- /wp:heading -->`;
    }
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      const attrs = b.ordered ? ' {"ordered":true}' : "";
      const items = b.items.map((it) => `<!-- wp:list-item -->\n<li>${it}</li>\n<!-- /wp:list-item -->`).join("");
      return `<!-- wp:list${attrs} -->\n<${tag} class="wp-block-list">${items}</${tag}>\n<!-- /wp:list -->`;
    }
    case "quote": {
      const cite = b.cite ? `<cite>${b.cite}</cite>` : "";
      return `<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>${b.text}</p>\n<!-- /wp:paragraph -->${cite}</blockquote>\n<!-- /wp:quote -->`;
    }
  }
}

/** Core Gutenberg block markup for a validated article (decision 6). Text is inserted as-is: inline HTML was whitelisted by validateArticle. */
export function serializeArticle(a: Article): string {
  return a.blocks.map(block).join("\n\n") + "\n";
}
```

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npx vitest run tests/unit/article.test.ts tests/unit/serialize.test.ts`
Expected: all pass. If `countWords(fixture())` is below 500, extend the fixture's paragraphs (keep the same facts) until it passes — never lower `WORDS_MIN`.

- [ ] **Step 7: Commit**

```bash
git add src/schemas/article.ts src/content/serialize.ts fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json tests/unit/article.test.ts tests/unit/serialize.test.ts
git commit -m "feat(faktory): article schema, editorial validation and Gutenberg serializer"
```

---

### Task 7: Article agent — prompt, generation, publication, checks

**Files:**
- Create: `src/prompts/content.md`, `src/content/articles.ts`
- Modify: `src/prompts.ts` (`PromptName`), `tests/unit/prompts.test.ts` (add a case)
- Test: `tests/unit/content-articles.test.ts`

**Interfaces:**
- Consumes: `runAgent`, `runValidated`, `AgentRun` (`src/agent.ts`); `loadPrompt`; `toJsonSchema`; `ArticleShape`, `parseArticle`, `assertArticle`, `articleSlug`, `articlePath`, `articleRel`, `Article`; `serializeArticle`; `wpOk`, `wpJson`, `runWp`; `siteUrl`; `assertTitle`, `assertContains`, `pageUrl`; `YOAST_META`; `SiteSpec`.
- Produces: `deps = { runAgent, wpOk, wpJson, runWp }`; `ARTICLES_MAX_TURNS = 8`; `ARTICLES_TOOLS = ["Read"]`; `ARTICLES_WRITE_ROOTS = ["content"]`; `ARTICLES_CONCURRENCY = 3`; `PLACEHOLDER_IMAGE = "https://placehold.co/1200x800.png"`; `type SpecArticle = SiteSpec["blog"]["articles"][number]`; `articleCategory(spec, article: SpecArticle): string`; `articleUserPrompt(spec, article: SpecArticle, slug: string): string`; `readArticle(ctx, spec, slug): Article`; `generateArticle(ctx, spec, article: SpecArticle): Promise<{ article: Article; slug: string; costUsd: number; attempts: 1 | 2 }>` (writes `content/articles/<slug>.json`); `ensureCategories(ctx, spec): Promise<Record<string, number>>` (name → term id); `publishArticle(ctx, slug, article, categories: Record<string, number>, focusKeyword: string): Promise<number>` (post id; `focusKeyword` = the spec article's first keyword); `assertArticleRendered(ctx, slug, article): Promise<void>`; `assertBlogLists(ctx, spec, slugs: string[]): Promise<void>`.

- [ ] **Step 1: Write the system prompt `src/prompts/content.md`**

```markdown
Tu es le rédacteur web de Partikuls. Tu écris UN article de blog en français pour le site d'une PME construit par Faktory (GeneratePress + GenerateBlocks). Tu travailles dans le dossier du site (cwd) : tous les chemins ci-dessous sont relatifs à ce dossier.

## Entrées (à lire avec Read, dans cet ordre)
1. `brief.md` — la seule source de faits : nom, lieu, histoire, produits, fournisseurs, prix, horaires, personnes. Tout ce qui n'y figure pas n'existe pas.
2. `SITE-SPEC.md` — identité, ton, pages du site (pour les liens internes), autres articles prévus (pour ne pas les répéter).
3. `design-system.md` — la voix éditoriale (section « Voix » ou équivalente) si elle existe ; sinon le ton de la spec suffit.
Ne lis rien d'autre.

## Sortie
Uniquement l'objet JSON structuré demandé (titre, extrait, catégorie, seo, blocs) — pas de markdown, pas de commentaire, pas de fichier. **Faktory enregistre, sérialise, publie et vérifie l'article lui-même.**

## Règles éditoriales
- **700 à 900 mots visés** (Faktory refuse en dessous de 500 et au-dessus de 1 200). Compte large : titres, listes et citation inclus.
- Structure : un paragraphe d'accroche **avant** le premier intertitre ; 3 à 5 intertitres `heading` niveau 2 (niveau 3 seulement pour subdiviser) ; des paragraphes courts (2 à 4 phrases) ; une liste (`list`) et une citation (`quote`, `cite` = une personne ou « L'équipe » de l'entreprise) quand elles servent le propos ; un paragraphe de conclusion qui renvoie vers une page du site.
- **Aucun fait inventé** : prix, adresse, horaires, dates, noms, fournisseurs, chiffres viennent du brief ou n'apparaissent pas. Jamais la mention `[à confirmer]` dans le texte : contourne (« nos horaires en boutique », « sur simple demande »).
- Mots-clés : le premier mot-clé dans le titre SEO, dans le premier paragraphe et dans un intertitre, placés naturellement ; les autres une fois chacun. Pas de bourrage.
- Liens : 1 à 3 liens internes vers des pages du site listées dans le prompt, sous la forme `<a href="/slug/">texte</a>` (`/` seul pour l'accueil) ; pas de lien externe sauf en `https://` vers un site nommé dans le brief.
- HTML en ligne autorisé dans les textes : `<strong>`, `<em>`, `<a href="…">` — rien d'autre (pas de `<br>`, `<span>`, `<img>`, pas de balises de bloc).
- `title` : le titre imposé, éventuellement raffiné sans changer le sujet (90 caractères max). `excerpt` : 1 à 2 phrases (40 à 200 caractères) qui donnent envie sans répéter le titre. `seo.title` ≤ 70 caractères, se termine par ` | <nom de l'entreprise>` si la place le permet ; `seo.metaDescription` 50 à 160 caractères, une promesse concrète.
- `category` : exactement l'une des catégories proposées.
- Ton : celui de la spec, phrases courtes, lisibles sur mobile, vouvoiement, pas de superlatifs creux, pas d'emoji.
```

- [ ] **Step 2: Extend the prompt loader and its test**

`src/prompts.ts`: `export type PromptName = "spec" | "design" | "pages" | "plugins" | "content";`

Add to `tests/unit/prompts.test.ts`:

```ts
  it("loads the content prompt with its key rules", () => {
    const p = loadPrompt("content");
    for (const s of ["brief.md", "SITE-SPEC.md", "700 à 900 mots", "[à confirmer]", "<strong>", "paragraphe d'accroche"]) expect(p).toContain(s);
  });
```

- [ ] **Step 3: Write the failing test**

```ts
// tests/unit/content-articles.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { articlePath, articleSlug, type Article } from "../../src/schemas/article.js";
import { serializeArticle } from "../../src/content/serialize.js";
import { YOAST_META } from "../../src/content/seo.js";
import {
  articleCategory, articleUserPrompt, readArticle, generateArticle, ensureCategories, publishArticle, assertArticleRendered, assertBlogLists, deps,
  ARTICLES_TOOLS, ARTICLES_MAX_TURNS, ARTICLES_WRITE_ROOTS, PLACEHOLDER_IMAGE,
} from "../../src/content/articles.js";
import { deps as renderDeps } from "../../src/pages/render-check.js";
import type { SiteContext } from "../../src/docker.js";
import type { AgentRun } from "../../src/agent.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const fixture = (): Article => JSON.parse(readFileSync("fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json", "utf8"));
const first = spec.blog.articles[0];
const SLUG = "la-galette-des-rois-revient-frangipane-ou-pomme";

async function ctx(): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-art-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}
const run = (structured: unknown, costUsd = 0.3): AgentRun => ({ text: "", transcript: "", structured, costUsd, sessionId: "s1", numTurns: 2 });

describe("articleCategory / articleUserPrompt", () => {
  it("uses the theme when it is a spec category, else the first category", () => {
    expect(articleCategory(spec, first)).toBe("Saison");
    expect(articleCategory(spec, { ...first, theme: "Inconnu" })).toBe(spec.blog.categories[0]);
  });
  it("lists title, category, keywords, identity, pages and the other articles", () => {
    const p = articleUserPrompt(spec, first, SLUG);
    expect(p).toContain(`# Article \`${SLUG}\` — ${first.title}`);
    expect(p).toContain("Catégorie : Saison");
    expect(p).toContain("Mots-clés : galette des rois Nantes");
    expect(p).toContain(spec.identity.name);
    expect(p).toContain("/nos-produits/ (");
    expect(p).toContain("/ (");
    for (const a of spec.blog.articles.slice(1)) expect(p).toContain(a.title);
    expect(p).not.toContain(`- ${first.title}`);
    expect(p).toContain("Catégories possibles : Saison, Recettes, Coulisses");
  });
});

describe("readArticle", () => {
  it("reads and validates content/articles/<slug>.json, with actionable errors", async () => {
    const c = await ctx();
    expect(() => readArticle(c, spec, SLUG)).toThrow(/content\/articles\/la-galette-des-rois-revient-frangipane-ou-pomme.json not found/);
    mkdirSync(join(c.siteDir, "content/articles"), { recursive: true });
    writeFileSync(articlePath(c, SLUG), "{nope");
    expect(() => readArticle(c, spec, SLUG)).toThrow(/is not valid JSON/);
    writeFileSync(articlePath(c, SLUG), JSON.stringify({ ...fixture(), category: "Nope" }));
    expect(() => readArticle(c, spec, SLUG)).toThrow(/content\/articles\/.*\.json: Invalid article: category.*— fix or delete it/s);
    writeFileSync(articlePath(c, SLUG), JSON.stringify(fixture()));
    expect(readArticle(c, spec, SLUG).title).toBe(first.title);
  });
});

describe("generateArticle", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("runs one structured-output agent with the content prompt and writes the validated article", async () => {
    const c = await ctx();
    const agent = vi.spyOn(deps, "runAgent").mockResolvedValue(run(fixture()));
    const r = await generateArticle(c, spec, first);
    expect(r.slug).toBe(SLUG);
    expect(r.article.title).toBe(first.title);
    expect(r.costUsd).toBe(0.3);
    expect(r.attempts).toBe(1);
    const opts = agent.mock.calls[0][1];
    expect(opts.stage).toBe("content");
    expect(opts.allowedTools).toEqual(ARTICLES_TOOLS);
    expect(opts.maxTurns).toBe(ARTICLES_MAX_TURNS);
    expect(opts.writeRoots).toEqual(ARTICLES_WRITE_ROOTS);
    expect(opts.systemPrompt).toContain("rédacteur web");
    expect(opts.prompt).toContain(first.title);
    expect(opts.outputFormat?.type).toBe("json_schema");
    expect((opts.outputFormat?.schema as any).properties.category.enum).toEqual(spec.blog.categories);
    expect(JSON.parse(readFileSync(articlePath(c, SLUG), "utf8"))).toEqual(fixture());
  });
  it("retries once in the same session on an invalid article, then writes the fixed one", async () => {
    const c = await ctx();
    const agent = vi.spyOn(deps, "runAgent")
      .mockResolvedValueOnce(run({ ...fixture(), category: "Nope" }))
      .mockResolvedValueOnce(run(fixture(), 0.2));
    const r = await generateArticle(c, spec, first);
    expect(r.attempts).toBe(2);
    expect(r.costUsd).toBe(0.5);
    expect(agent.mock.calls[1][1].resume).toBe("s1");
    expect(agent.mock.calls[1][1].prompt).toMatch(/category "Nope" is not one of/);
    expect(existsSync(articlePath(c, SLUG))).toBe(true);
  });
  it("fails after the retry without writing anything", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockResolvedValue(run({ ...fixture(), blocks: [{ type: "heading", level: 2, text: "x" }, { type: "paragraph", text: "y" }, { type: "paragraph", text: "z" }] }));
    await expect(generateArticle(c, spec, first)).rejects.toThrow(/content: output still invalid after one retry — article is invalid/);
    expect(existsSync(articlePath(c, SLUG))).toBe(false);
  });
});

describe("ensureCategories / publishArticle", () => {
  beforeEach(() => vi.restoreAllMocks());
  function spies(opts: { existingPost?: number; thumb?: string; mediaFails?: boolean } = {}) {
    const calls: string[][] = [];
    const wpJson = vi.spyOn(deps, "wpJson").mockImplementation(async (_c, args) => {
      calls.push(args);
      if (args[0] === "term" && args[1] === "list") return [{ term_id: 1, name: "Uncategorized" }, { term_id: 5, name: "Saison" }] as any;
      if (args[0] === "post" && args[1] === "list") return (opts.existingPost ? [{ ID: opts.existingPost }] : []) as any;
      throw new Error(`unexpected wpJson ${args.join(" ")}`);
    });
    const wpOk = vi.spyOn(deps, "wpOk").mockImplementation(async (_c, args) => {
      calls.push(args);
      if (args[0] === "term" && args[1] === "create") return String(args[3] === "Recettes" ? 6 : 7);
      if (args[0] === "post" && args[1] === "create") return "42";
      if (args[0] === "post" && args[1] === "update") return "Success";
      if (args[0] === "post" && args[1] === "term") return "Success";
      if (args[0] === "post" && args[1] === "meta") return "Success";
      if (args[0] === "media") { if (opts.mediaFails) throw new Error("wp media import failed: curl"); return "99"; }
      throw new Error(`unexpected wpOk ${args.join(" ")}`);
    });
    const runWp = vi.spyOn(deps, "runWp").mockImplementation(async (_c, args) => {
      calls.push(args);
      if (args[0] === "post" && args[1] === "meta" && args[2] === "get") return { code: opts.thumb ? 0 : 1, stdout: opts.thumb ?? "", stderr: "" };
      throw new Error(`unexpected runWp ${args.join(" ")}`);
    });
    return { wpJson, wpOk, runWp, calls };
  }
  it("ensureCategories creates the missing spec categories and maps every name to its id", async () => {
    const c = await ctx();
    const s = spies();
    expect(await ensureCategories(c, spec)).toEqual({ Saison: 5, Recettes: 6, Coulisses: 7 });
    expect(s.wpOk).toHaveBeenCalledWith(c, ["term", "create", "category", "Recettes", "--porcelain"]);
    expect(s.wpOk).toHaveBeenCalledWith(c, ["term", "create", "category", "Coulisses", "--porcelain"]);
    expect(s.wpOk).toHaveBeenCalledTimes(2);
  });
  it("creates the post from stdin, sets category, featured image and Yoast meta", async () => {
    const c = await ctx();
    const s = spies();
    const a = fixture();
    const id = await publishArticle(c, SLUG, a, { Saison: 5 }, "galette des rois Nantes");
    expect(id).toBe(42);
    const create = s.calls.find((k) => k[0] === "post" && k[1] === "create")!;
    expect(create).toEqual(["post", "create", "-", "--post_type=post", "--post_status=publish", `--post_title=${a.title}`, `--post_name=${SLUG}`, `--post_excerpt=${a.excerpt}`, "--porcelain"]);
    expect(s.wpOk.mock.calls.find((k: any) => k[1][1] === "create")![2]).toEqual({ input: serializeArticle(a) });
    expect(s.wpOk).toHaveBeenCalledWith(c, ["post", "term", "set", "42", "category", "5", "--by=id"]);
    expect(s.wpOk).toHaveBeenCalledWith(c, ["media", "import", PLACEHOLDER_IMAGE, "--post_id=42", "--featured_image", `--alt=${a.title}`, "--porcelain"]);
    expect(s.wpOk).toHaveBeenCalledWith(c, ["post", "meta", "update", "42", YOAST_META.title, a.seo.title]);
    expect(s.wpOk).toHaveBeenCalledWith(c, ["post", "meta", "update", "42", YOAST_META.metadesc, a.seo.metaDescription]);
    expect(s.wpOk).toHaveBeenCalledWith(c, ["post", "meta", "update", "42", YOAST_META.focuskw, "galette des rois Nantes"]);
  });
  it("updates an existing post by post_name and skips the image when a thumbnail exists", async () => {
    const c = await ctx();
    const s = spies({ existingPost: 17, thumb: "99" });
    const a = fixture();
    expect(await publishArticle(c, SLUG, a, { Saison: 5 }, "galette des rois Nantes")).toBe(17);
    expect(s.wpOk).toHaveBeenCalledWith(c, ["post", "update", "17", "-", "--post_status=publish", `--post_title=${a.title}`, `--post_excerpt=${a.excerpt}`], { input: serializeArticle(a) });
    expect(s.wpOk.mock.calls.some((k: any) => k[1][0] === "media")).toBe(false);
    expect(s.wpOk.mock.calls.some((k: any) => k[1][1] === "create")).toBe(false);
  });
  it("warns and continues when the placeholder image cannot be imported", async () => {
    const c = await ctx();
    spies({ mediaFails: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await publishArticle(c, SLUG, fixture(), { Saison: 5 }, "galette des rois Nantes")).toBe(42);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/⚠ .*featured image not imported.*curl/));
  });
  it("refuses a category missing from the map", async () => {
    const c = await ctx();
    spies();
    await expect(publishArticle(c, SLUG, fixture(), {}, "galette des rois Nantes")).rejects.toThrow(/no category term for "Saison" — ensureCategories must run first/);
  });
});

describe("assertArticleRendered / assertBlogLists", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("checks the post title and the posts page links", async () => {
    const c = await ctx();
    const a = fixture();
    const f = vi.spyOn(renderDeps, "fetchText").mockImplementation(async (url) =>
      url.endsWith("/actualites/") ? `<a href="http://localhost:${c.state.port}/${SLUG}/">x</a>` : `<title>${a.seo.title.replace(/&/g, "&amp;")}</title>`);
    await expect(assertArticleRendered(c, SLUG, a)).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledWith(`http://localhost:${c.state.port}/${SLUG}/`);
    await expect(assertBlogLists(c, spec, [SLUG])).resolves.toBeUndefined();
    await expect(assertBlogLists(c, spec, ["autre"])).rejects.toThrow(/\/actualites\/ does not contain "href="http:\/\/localhost:\d+\/autre\/"" — the posts page does not list the article; check page_for_posts/);
  });
  it("assertBlogLists is a no-op without a blog page", async () => {
    const c = await ctx();
    const f = vi.spyOn(renderDeps, "fetchText");
    await assertBlogLists(c, { ...spec, sitemap: spec.sitemap.filter((p) => p.kind !== "blog"), menus: { primary: ["accueil"], footer: [] } }, [SLUG]);
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/unit/content-articles.test.ts tests/unit/prompts.test.ts`
Expected: FAIL — `src/content/articles.js` not found; prompts test fails on `loadPrompt("content")` until the prompt file exists.

- [ ] **Step 5: Implement `src/content/articles.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SiteContext } from "../docker.js";
import { siteUrl } from "../docker.js";
import { runAgent, runValidated } from "../agent.js";
import { loadPrompt } from "../prompts.js";
import { runWp, wpOk, wpJson } from "../wp.js";
import { toJsonSchema } from "../schemas/json-schema.js";
import { ArticleShape, articlePath, articleRel, articleSlug, assertArticle, parseArticle, type Article } from "../schemas/article.js";
import type { SiteSpec } from "../schemas/site-spec.js";
import { serializeArticle } from "./serialize.js";
import { YOAST_META } from "./seo.js";
import { assertContains, assertTitle, pageUrl } from "../pages/render-check.js";

export const deps = { runAgent, wpOk, wpJson, runWp };
export const ARTICLES_MAX_TURNS = 8;
export const ARTICLES_TOOLS = ["Read"];
export const ARTICLES_WRITE_ROOTS = ["content"];
export const ARTICLES_CONCURRENCY = 3;
export const PLACEHOLDER_IMAGE = "https://placehold.co/1200x800.png";

export type SpecArticle = SiteSpec["blog"]["articles"][number];

/** The theme when it is one of the spec's categories, else the first category. */
export function articleCategory(spec: SiteSpec, article: SpecArticle): string {
  return spec.blog.categories.includes(article.theme) ? article.theme : spec.blog.categories[0];
}

export function articleUserPrompt(spec: SiteSpec, article: SpecArticle, slug: string): string {
  const id = spec.identity;
  const others = spec.blog.articles.filter((a) => a.title !== article.title);
  const lines: string[] = [
    `# Article \`${slug}\` — ${article.title}`,
    `Catégorie : ${articleCategory(spec, article)} (thème de la spec : ${article.theme})`,
    `Mots-clés : ${article.keywords.join(", ")}`,
    `Catégories possibles : ${spec.blog.categories.join(", ")}`,
    "",
    "## Identité",
    `${id.name} — ${id.sector}${id.location ? ` (${id.location})` : ""}. Accroche : ${id.tagline}. Ton : ${id.tone}.`,
    `Pages du site (pour les liens internes) : ${spec.sitemap.map((p) => `${p.kind === "home" ? "/" : `/${p.slug}/`} (${p.title})`).join(", ")}.`,
    "",
    "## Autres articles du blog (ne pas répéter leur sujet)",
    ...(others.length ? others.map((a) => `- ${a.title} (${a.theme})`) : ["- aucun"]),
    "",
    "## À faire",
    "Lis `brief.md`, `SITE-SPEC.md` et `design-system.md`, puis réponds uniquement par l'objet JSON structuré de l'article.",
  ];
  return lines.join("\n");
}

/** Read and validate `content/articles/<slug>.json`; throws a message telling what to fix. */
export function readArticle(ctx: SiteContext, spec: SiteSpec, slug: string): Article {
  const rel = articleRel(slug), abs = articlePath(ctx, slug);
  if (!existsSync(abs)) throw new Error(`${rel} not found`);
  let data: unknown;
  try { data = JSON.parse(readFileSync(abs, "utf8")); }
  catch (err) { throw new Error(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
  try {
    const a = parseArticle(data, spec.blog.categories);
    assertArticle(a, spec);
    return a;
  } catch (err) {
    throw new Error(`${rel}: ${err instanceof Error ? err.message : String(err)} — fix or delete it (a deleted article is regenerated)`);
  }
}

/** One structured-output agent run (plus one validated retry); the validated article is written to `content/articles/<slug>.json`. */
export async function generateArticle(
  ctx: SiteContext, spec: SiteSpec, article: SpecArticle,
): Promise<{ article: Article; slug: string; costUsd: number; attempts: 1 | 2 }> {
  const slug = articleSlug(article.title);
  const r = await runValidated(deps.runAgent, ctx, {
    stage: "content",
    systemPrompt: loadPrompt("content"),
    prompt: articleUserPrompt(spec, article, slug),
    allowedTools: ARTICLES_TOOLS,
    outputFormat: { type: "json_schema", schema: toJsonSchema(ArticleShape(spec.blog.categories)) },
    maxTurns: ARTICLES_MAX_TURNS,
    writeRoots: ARTICLES_WRITE_ROOTS,
  }, (run) => {
    const a = parseArticle(run.structured, spec.blog.categories);
    assertArticle(a, spec);
    return a;
  });
  const abs = articlePath(ctx, slug);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(r.value, null, 2) + "\n");
  return { article: r.value, slug, costUsd: r.costUsd, attempts: r.attempts };
}

type Term = { term_id: number; name: string };

/** Create the missing blog categories; returns name → term id for every spec category. */
export async function ensureCategories(ctx: SiteContext, spec: SiteSpec): Promise<Record<string, number>> {
  const terms = await deps.wpJson<Term[]>(ctx, ["term", "list", "category", "--fields=term_id,name"]);
  const ids: Record<string, number> = {};
  for (const name of spec.blog.categories) {
    const t = terms.find((x) => x.name.toLowerCase() === name.toLowerCase());
    ids[name] = t ? t.term_id : Number(await deps.wpOk(ctx, ["term", "create", "category", name, "--porcelain"]));
  }
  return ids;
}

/** Idempotent publication by post_name (decision 6): create or update, category, placeholder featured image, Yoast meta. Returns the post id. */
export async function publishArticle(ctx: SiteContext, slug: string, article: Article, categories: Record<string, number>, focusKeyword: string): Promise<number> {
  const cat = categories[article.category];
  if (!cat) throw new Error(`no category term for "${article.category}" — ensureCategories must run first`);
  const markup = serializeArticle(article);
  const existing = await deps.wpJson<{ ID: number }[]>(ctx, ["post", "list", "--post_type=post", "--post_status=any", `--name=${slug}`, "--fields=ID"]);
  let id: number;
  if (existing.length) {
    id = existing[0].ID;
    await deps.wpOk(ctx, ["post", "update", String(id), "-", "--post_status=publish", `--post_title=${article.title}`, `--post_excerpt=${article.excerpt}`], { input: markup });
  } else {
    id = Number(await deps.wpOk(ctx, ["post", "create", "-", "--post_type=post", "--post_status=publish", `--post_title=${article.title}`, `--post_name=${slug}`, `--post_excerpt=${article.excerpt}`, "--porcelain"], { input: markup }));
  }
  await deps.wpOk(ctx, ["post", "term", "set", String(id), "category", String(cat), "--by=id"]);
  const thumb = await deps.runWp(ctx, ["post", "meta", "get", String(id), "_thumbnail_id"]);
  if (thumb.code !== 0 || !thumb.stdout.trim()) {
    try {
      await deps.wpOk(ctx, ["media", "import", PLACEHOLDER_IMAGE, `--post_id=${id}`, "--featured_image", `--alt=${article.title}`, "--porcelain"]);
    } catch (err) {
      console.warn(`⚠ ${slug}: featured image not imported (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  await deps.wpOk(ctx, ["post", "meta", "update", String(id), YOAST_META.title, article.seo.title]);
  await deps.wpOk(ctx, ["post", "meta", "update", String(id), YOAST_META.metadesc, article.seo.metaDescription]);
  await deps.wpOk(ctx, ["post", "meta", "update", String(id), YOAST_META.focuskw, focusKeyword]);
  return id;
}
```

Continue the module:

```ts
export async function assertArticleRendered(ctx: SiteContext, slug: string, article: Article): Promise<void> {
  await assertTitle(ctx, `${siteUrl(ctx)}/${slug}/`, article.seo.title);
}

/** The posts page (`kind: "blog"`) must link every published article; no-op when the sitemap has no blog page. */
export async function assertBlogLists(ctx: SiteContext, spec: SiteSpec, slugs: string[]): Promise<void> {
  const blog = spec.sitemap.find((p) => p.kind === "blog");
  if (!blog) return;
  const url = pageUrl(ctx, blog);
  for (const slug of slugs) {
    await assertContains(ctx, url, `href="${siteUrl(ctx)}/${slug}/"`, "the posts page does not list the article; check page_for_posts");
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npx vitest run tests/unit/content-articles.test.ts tests/unit/prompts.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/prompts/content.md src/prompts.ts src/content/articles.ts tests/unit/content-articles.test.ts tests/unit/prompts.test.ts
git commit -m "feat(faktory): article agent (structured output), publication and render checks"
```

---

### Task 8: The `content` stage and its registration

**Files:**
- Create: `src/stages/content.ts`
- Modify: `src/pipeline.ts` (import + `registry.content`), `tests/unit/pipeline.test.ts` (registry keys)
- Test: `tests/unit/stage-content.test.ts`

**Interfaces:**
- Consumes: `Stage` (`src/pipeline.ts`), `assertBudget`, `readJsonArtifact`, `parseSiteSpec`, `ensurePages`, `ensureForms`, `integrateForms`, `applyPageSeo`, `ensureCategories`, `generateArticle`, `readArticle`, `publishArticle`, `assertArticleRendered`, `assertBlogLists`, `ARTICLES_CONCURRENCY`, `articleSlug`, `articlePath`, `mapLimit`.
- Produces: `contentStage: Stage` (`name: "content"`, no checkpoint); `deps = { ensurePages, ensureForms, integrateForms, applyPageSeo, ensureCategories, generateArticle, publishArticle, assertArticleRendered, assertBlogLists }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/stage-content.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext, registry } from "../../src/pipeline.js";
import { writeJsonArtifact } from "../../src/artifacts.js";
import { parseSiteSpec, type SiteSpec } from "../../src/schemas/site-spec.js";
import { articlePath, articleSlug, type Article } from "../../src/schemas/article.js";
import { gfPlacement } from "../../src/schemas/forms-manifest.js";
import { contentStage, deps } from "../../src/stages/content.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const fixture = (): Article => JSON.parse(readFileSync("fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json", "utf8"));
const IDS: Record<string, number> = { accueil: 10, "nos-produits": 11, "commandes-evenements": 12, "la-maison": 13, actualites: 14, contact: 15 };
const MANIFEST = { devis_evenement: { gfId: 2, placement: gfPlacement(2) }, contact: { gfId: 1, placement: gfPlacement(1) } };
const SLUGS = spec.blog.articles.map((a) => articleSlug(a.title));
const tick = () => new Promise<void>((r) => setTimeout(r, 5));

async function ctx(s: SiteSpec = spec): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stcontent-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  writeJsonArtifact(c, "siteSpecJson", s);
  return c;
}
function spies(opts: { fail?: string[]; delay?: boolean } = {}) {
  const order: string[] = []; let inFlight = 0, peak = 0;
  const ensure = vi.spyOn(deps, "ensurePages").mockResolvedValue(IDS);
  const forms = vi.spyOn(deps, "ensureForms").mockImplementation(async () => { order.push("forms"); return { manifest: MANIFEST, created: ["devis_evenement", "contact"], reused: [] }; });
  const integrate = vi.spyOn(deps, "integrateForms").mockImplementation(async () => { order.push("integrate"); return { pages: ["commandes-evenements", "contact"], skipped: [] }; });
  const seo = vi.spyOn(deps, "applyPageSeo").mockImplementation(async () => { order.push("seo"); return spec.sitemap.map((p) => p.slug); });
  const cats = vi.spyOn(deps, "ensureCategories").mockImplementation(async () => { order.push("categories"); return { Saison: 5, Recettes: 6, Coulisses: 7 }; });
  const gen = vi.spyOn(deps, "generateArticle").mockImplementation(async (c, _s, article) => {
    const slug = articleSlug(article.title);
    order.push(`gen:${slug}`); inFlight++; peak = Math.max(peak, inFlight);
    if (opts.delay) { await tick(); await tick(); }
    inFlight--;
    if (opts.fail?.includes(slug)) throw new Error(`content: output still invalid after one retry — article is invalid:\n- article has 12 words`);
    const a = { ...fixture(), title: article.title };
    mkdirSync(join(c.siteDir, "content/articles"), { recursive: true });
    writeFileSync(articlePath(c, slug), JSON.stringify(a));
    return { article: a, slug, costUsd: 0.3, attempts: 1 as const };
  });
  const publish = vi.spyOn(deps, "publishArticle").mockImplementation(async (_c, slug) => { order.push(`publish:${slug}`); return 40 + SLUGS.indexOf(slug); });
  const rendered = vi.spyOn(deps, "assertArticleRendered").mockResolvedValue(undefined);
  const lists = vi.spyOn(deps, "assertBlogLists").mockImplementation(async () => { order.push("blog-lists"); });
  return { ensure, forms, integrate, seo, cats, gen, publish, rendered, lists, order, peak: () => peak };
}

describe("content stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("is registered in the pipeline, without checkpoint, after pages", () => {
    expect(registry.content).toBe(contentStage);
    expect(contentStage.checkpoint).toBeFalsy();
    expect(Object.keys(registry)).toEqual(["spec", "design", "provision", "pages", "plugins", "content"]);
  });
  it("needs site-spec.json", async () => {
    const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stcontent-")));
    await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
    await expect(contentStage.run(loadContext(config, "boul"))).rejects.toThrow(/site-spec.json not found/);
  });
  it("runs forms → seo → articles (3 in flight max), publishes and checks each, then the blog page", async () => {
    const c = await ctx();
    const s = spies({ delay: true });
    const msg = await contentStage.run(c);
    expect(s.ensure).toHaveBeenCalledWith(c, spec);
    expect(s.forms).toHaveBeenCalledWith(c, spec);
    expect(s.integrate).toHaveBeenCalledWith(c, spec, MANIFEST, IDS);
    expect(s.seo).toHaveBeenCalledWith(c, spec, IDS);
    expect(s.order.slice(0, 4)).toEqual(["forms", "integrate", "seo", "categories"]);
    expect(s.gen).toHaveBeenCalledTimes(3);
    expect(s.peak()).toBe(3);
    expect(s.publish.mock.calls.map((k: any) => k[1]).sort()).toEqual([...SLUGS].sort());
    expect(s.publish.mock.calls[0][4]).toBe(spec.blog.articles.find((a) => articleSlug(a.title) === s.publish.mock.calls[0][1])!.keywords[0]);
    expect(s.rendered).toHaveBeenCalledTimes(3);
    expect(s.order.at(-1)).toBe("blog-lists");
    expect(s.lists).toHaveBeenCalledWith(c, spec, SLUGS);
    expect(msg).toBe(`forms: devis_evenement → #2, contact → #1 (2 created, 0 reused; 2 pages updated); seo: 6 pages; articles: 3 published (${SLUGS.join(", ")}); 3 generated, 0 reused — $0.90`);
  });
  it("skips the forms sub-step when the spec has no forms", async () => {
    const c = await ctx({ ...spec, forms: [], sitemap: spec.sitemap.map((p) => ({ ...p, sections: p.sections.filter((x) => x.type !== "form" && x.type !== "contact") })) });
    const s = spies();
    const msg = await contentStage.run(c);
    expect(s.forms).not.toHaveBeenCalled();
    expect(s.integrate).not.toHaveBeenCalled();
    expect(msg).toMatch(/^forms: none; seo: 6 pages; articles: 3 published/);
  });
  it("reuses content/articles/<slug>.json without calling the agent", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "content/articles"), { recursive: true });
    writeFileSync(articlePath(c, SLUGS[0]), JSON.stringify(fixture()));
    const s = spies();
    const msg = await contentStage.run(c);
    expect(s.gen).toHaveBeenCalledTimes(2);
    expect(s.gen.mock.calls.map((k: any) => articleSlug(k[2].title))).not.toContain(SLUGS[0]);
    expect(s.publish).toHaveBeenCalledTimes(3);
    expect(msg).toMatch(/3 published .*; 2 generated, 1 reused — \$0\.60$/);
  });
  it("keeps publishing the other articles when one fails, then fails with the list", async () => {
    const c = await ctx();
    const s = spies({ fail: [SLUGS[1]] });
    await expect(contentStage.run(c)).rejects.toThrow(new RegExp(`1 article\\(s\\) failed: ${SLUGS[1]} — fix or delete content/articles/<slug>.json and re-run: faktory run boul --only content`));
    expect(s.publish).toHaveBeenCalledTimes(2);
    expect(s.lists).not.toHaveBeenCalled();
  });
  it("reports a hand-edited invalid article as a failure with the fix-or-delete hint", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "content/articles"), { recursive: true });
    writeFileSync(articlePath(c, SLUGS[0]), JSON.stringify({ ...fixture(), category: "Nope" }));
    const s = spies();
    await expect(contentStage.run(c)).rejects.toThrow(/1 article\(s\) failed/);
    expect(s.gen).toHaveBeenCalledTimes(2);
  });
  it("refuses to generate once the budget is spent (existing articles still publish)", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "content/articles"), { recursive: true });
    writeFileSync(articlePath(c, SLUGS[0]), JSON.stringify(fixture()));
    c.state = { ...c.state, costUsd: 40 };
    const s = spies();
    await expect(contentStage.run(c)).rejects.toThrow(/Cost budget reached/);
    expect(s.gen).not.toHaveBeenCalled();
    expect(s.publish).toHaveBeenCalledWith(c, SLUGS[0], expect.anything(), { Saison: 5, Recettes: 6, Coulisses: 7 }, spec.blog.articles[0].keywords[0]);
  });
  it("fails the stage when the forms sub-step fails, before seo and articles", async () => {
    const c = await ctx();
    const s = spies();
    s.integrate.mockRejectedValue(new Error("/contact/ (contact) does not render gform_wrapper_1"));
    await expect(contentStage.run(c)).rejects.toThrow(/does not render gform_wrapper_1/);
    expect(s.seo).not.toHaveBeenCalled();
    expect(s.gen).not.toHaveBeenCalled();
  });
});
```

Also update `tests/unit/pipeline.test.ts` line ~190: `expect(Object.keys(registry)).toEqual(["spec", "design", "provision", "pages", "plugins", "content"]);`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/stage-content.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/stages/content.ts
import { existsSync } from "node:fs";
import type { Stage } from "../pipeline.js";
import { assertBudget } from "../budget.js";
import { readJsonArtifact } from "../artifacts.js";
import { mapLimit } from "../concurrency.js";
import { ensurePages } from "../provision/pages.js";
import { ensureForms, integrateForms } from "../content/forms.js";
import { applyPageSeo } from "../content/seo.js";
import {
  ensureCategories, generateArticle, publishArticle, readArticle, assertArticleRendered, assertBlogLists, ARTICLES_CONCURRENCY, type SpecArticle,
} from "../content/articles.js";
import { parseSiteSpec } from "../schemas/site-spec.js";
import { articlePath, articleSlug, type Article } from "../schemas/article.js";

export const deps = { ensurePages, ensureForms, integrateForms, applyPageSeo, ensureCategories, generateArticle, publishArticle, assertArticleRendered, assertBlogLists };

export const contentStage: Stage = {
  name: "content",
  async run(ctx) {
    const spec = readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec);
    const ids = await deps.ensurePages(ctx, spec);

    // 1. forms (deterministic)
    let formsMsg = "forms: none";
    if (spec.forms.length) {
      const f = await deps.ensureForms(ctx, spec);
      const i = await deps.integrateForms(ctx, spec, f.manifest, ids);
      const waiting = i.skipped.length ? `, ${i.skipped.length} waiting for the pages stage` : "";
      formsMsg = `forms: ${spec.forms.map((x) => `${x.id} → #${f.manifest[x.id].gfId}`).join(", ")} (${f.created.length} created, ${f.reused.length} reused; ${i.pages.length} pages updated${waiting})`;
    }

    // 2. seo (deterministic)
    const seoDone = await deps.applyPageSeo(ctx, spec, ids);
    console.log(`  ✔ seo meta on ${seoDone.length} pages`);

    // 3. articles (one agent each, ARTICLES_CONCURRENCY in flight)
    const categories = await deps.ensureCategories(ctx, spec);
    const generated: string[] = [], reused: string[] = [], published: string[] = [];
    let cost = 0;
    const build = async (article: SpecArticle): Promise<string> => {
      const slug = articleSlug(article.title);
      let a: Article;
      if (existsSync(articlePath(ctx, slug))) {
        a = readArticle(ctx, spec, slug);
        reused.push(slug);
      } else {
        assertBudget(ctx.config, ctx.state);
        const g = await deps.generateArticle(ctx, spec, article);
        a = g.article; cost += g.costUsd; generated.push(slug);
      }
      await deps.publishArticle(ctx, slug, a, categories, article.keywords[0]);
      await deps.assertArticleRendered(ctx, slug, a);
      published.push(slug);
      console.log(`  ✔ /${slug}/ published`);
      return slug;
    };
    const results = await mapLimit(spec.blog.articles, ARTICLES_CONCURRENCY, build);
    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        failed.push(articleSlug(spec.blog.articles[i].title));
        console.error(`  ✖ ${articleSlug(spec.blog.articles[i].title)}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
    });
    for (const r of results) {
      if (r.status === "rejected" && r.reason instanceof Error && r.reason.message.includes("Cost budget reached")) throw r.reason;
    }
    if (failed.length) {
      throw new Error(`${failed.length} article(s) failed: ${failed.join(", ")} — fix or delete content/articles/<slug>.json and re-run: faktory run ${ctx.slug} --only content`);
    }
    const slugs = spec.blog.articles.map((a) => articleSlug(a.title));
    await deps.assertBlogLists(ctx, spec, slugs);
    return `${formsMsg}; seo: ${seoDone.length} pages; articles: ${published.length} published (${slugs.join(", ")}); ${generated.length} generated, ${reused.length} reused — $${cost.toFixed(2)}`;
  },
};
```

In `src/pipeline.ts`: add `import { contentStage } from "./stages/content.js";` and `registry = { spec: specStage, design: designStage, provision: provisionStage, pages: pagesStage, plugins: pluginsStage, content: contentStage }`.

- [ ] **Step 4: Run the tests**

Run: `npm run typecheck && npx vitest run tests/unit/stage-content.test.ts tests/unit/pipeline.test.ts`
Expected: all pass. (The stage-level order test relies on `publish.mock.calls[0][4]` being the focus keyword: the 5th positional argument of `publishArticle`.)

- [ ] **Step 5: Commit**

```bash
git add src/stages/content.ts src/pipeline.ts tests/unit/stage-content.test.ts tests/unit/pipeline.test.ts
git commit -m "feat(faktory): content stage — forms, seo, articles"
```

---

### Task 9: The `pages` stage applies `content/forms.json` too

**Files:**
- Modify: `src/stages/pages.ts`
- Test: `tests/unit/stage-pages.test.ts` (add two cases)

**Interfaces:**
- Consumes: `readFormsManifest`, `formPlacements`, `applyPlacements`, `pluginPlacements` (Task 2); `assertFormRendered` (Task 3); `FORM_WRAPPER_ATTR`.
- Produces: the stage message gains `; forms applied (<form ids>)` when at least one form placement was applied.

- [ ] **Step 1: Add the failing tests to `tests/unit/stage-pages.test.ts`**

Add the imports `import { gfPlacement } from "../../src/schemas/forms-manifest.js";` and `FORM_WRAPPER_ATTR` from page-tree; change `stubTree` so form sections carry the wrapper (as the pages prompt requires):

```ts
function stubTree(page: Page): PageTree {
  return page.sections.map((s, i) => ({
    type: "element" as const, tagName: "section", htmlAttributes: { id: `s-${i}` }, styles: { padding: "48px 24px" },
    innerBlocks: [
      { type: "text" as const, tagName: i === 0 ? "h1" : "h2", content: s.heading },
      ...(s.type === "custom-query" && s.feature ? [{ type: "raw" as const, rawMarkup: featureMarker(s.feature) }] : []),
      ...((s.type === "form" || s.type === "contact") && s.form && !page.sections.slice(0, i).some((x) => x.form === s.form)
        ? [{ type: "element" as const, tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: s.form }, innerBlocks: [
            { type: "raw" as const, rawMarkup: formMarker(s.form) }, { type: "text" as const, tagName: "p", content: "Le formulaire sera disponible ici." } ] }]
        : []),
    ],
  }));
}
```

(The existing tests keep passing: markers are still present and wrapped.) Then add, inside `describe("pages stage")`:

```ts
  it("applies content/forms.json when present and checks the Gravity Forms wrapper", async () => {
    const c = await ctx();
    writeFileSync(join(c.siteDir, "content/forms.json"), JSON.stringify({ devis_evenement: { gfId: 2, placement: gfPlacement(2) }, contact: { gfId: 1, placement: gfPlacement(1) } }));
    const s = spies({ html: '<div data-faktory-plugin="catalogue_produits"></div><div id="gform_wrapper_1"></div><div id="gform_wrapper_2"></div>' });
    const msg = await pagesStage.run(c);
    const contactTree = s.compile.mock.calls.find((k: any) => k[1] === "contact")![2] as PageTree;
    expect(JSON.stringify(contactTree)).toContain('gravityforms/form');
    expect(JSON.stringify(contactTree)).not.toContain(FORM_WRAPPER_ATTR);
    expect(s.fetchText).toHaveBeenCalledWith(`http://localhost:${c.state.port}/contact/`);
    expect(msg).toMatch(/; forms applied \(contact, devis_evenement\) — \$5\.00$/);
  });
  it("fails a page whose applied form does not render", async () => {
    const c = await ctx();
    writeFileSync(join(c.siteDir, "content/forms.json"), JSON.stringify({ contact: { gfId: 1, placement: gfPlacement(1) } }));
    spies({ html: "<html>no form</html>" });
    await expect(pagesStage.run(c)).rejects.toThrow(/1 page\(s\) failed: contact/);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/stage-pages.test.ts`
Expected: the two new tests fail (no `forms applied` in the message; `fetchText` for `/contact/` never called).

- [ ] **Step 3: Implement in `src/stages/pages.ts`**

Imports: `import { applyPlacements, pluginPlacements, formPlacements, readPluginManifests, readFormsManifest } from "../pages/placements.js";` and `import { assertRendered, assertFormRendered } from "../pages/render-check.js";`. After `const manifests = readPluginManifests(ctx);` add `const forms = readFormsManifest(ctx); const formsApplied = new Set<string>();`. In `build`, replace the placement block by:

```ts
      const formPl = formPlacements(forms, page);
      const a = applyPlacements(tree, [...pluginPlacements(manifests, page.slug), ...formPl]);
      const features = a.applied.filter((p) => p.attr === FEATURE_WRAPPER_ATTR).map((p) => p.id);
      const appliedForms = a.applied.filter((p) => p.attr === FORM_WRAPPER_ATTR).map((p) => p.id);
      features.forEach((id) => applied.add(id));
      appliedForms.forEach((id) => formsApplied.add(id));
      const markup = await deps.compilePage(ctx, page.slug, a.tree);
      await deps.publishPage(ctx, ids[page.slug], markup);
      // Fresh-site order (provision → plugins → pages → content): the plugins/content stages had no tree to
      // insert into, so this is where the render contract of every applied plugin and form is checked.
      for (const id of features) await assertRendered(ctx, page, id);
      for (const id of appliedForms) await assertFormRendered(ctx, page, forms[id].gfId);
```

(import `FEATURE_WRAPPER_ATTR`, `FORM_WRAPPER_ATTR` from `../schemas/page-tree.js`). In the return message, after `plugins`: `const formsMsg = formsApplied.size ? `; forms applied (${Array.from(formsApplied).sort().join(", ")})` : "";` and append `${formsMsg}` right after `${plugins}`.

- [ ] **Step 4: Run the tests**

Run: `npm run typecheck && npx vitest run tests/unit/stage-pages.test.ts`
Expected: all pass, including the pre-existing message assertions (no forms manifest → no suffix).

- [ ] **Step 5: Commit**

```bash
git add src/stages/pages.ts tests/unit/stage-pages.test.ts
git commit -m "feat(faktory): pages stage applies the forms manifest and checks the wrapper"
```

---

### Task 10: Docker integration test

**Files:**
- Create: `tests/integration/content.test.ts`

**Interfaces:**
- Consumes: everything above; `runSite`, `destroySite`, `loadContext`, `initSite`, `wpJson`, `wpOk`, `artifactPath`, `pageTreePath`, `deps as pagesDeps` (`src/stages/pages.ts`), `deps as contentDeps` (`src/stages/content.ts`), `articleSlug`, `articlePath`, `formsManifestPath`.

- [ ] **Step 1: Write the test**

```ts
// tests/integration/content.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { wpJson, wpOk } from "../../src/wp.js";
import { artifactPath, pageTreePath } from "../../src/artifacts.js";
import { articlePath, articleSlug, type Article } from "../../src/schemas/article.js";
import { formsManifestPath } from "../../src/schemas/forms-manifest.js";
import { YOAST_META } from "../../src/content/seo.js";
import { deps as pagesDeps } from "../../src/stages/pages.js";
import { deps as contentDeps } from "../../src/stages/content.js";
import { featureMarker, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type GbNode, type PageTree } from "../../src/schemas/page-tree.js";
import type { Page, SiteSpec } from "../../src/schemas/site-spec.js";
import type { SiteContext } from "../../src/docker.js";

const FIXTURE_ARTICLE = "fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json";

function stubTree(page: Page): PageTree {
  return page.sections.map((s, i): GbNode => ({
    type: "element", tagName: "section", htmlAttributes: { id: `s-${i}` },
    styles: { backgroundColor: i % 2 ? "var(--base-2)" : "var(--base)", padding: "48px 24px" },
    innerBlocks: [
      { type: "text", tagName: i === 0 ? "h1" : "h2", content: s.heading },
      { type: "text", tagName: "p", content: s.summary },
      ...(s.type === "custom-query" && s.feature
        ? [{ type: "element", tagName: "div", htmlAttributes: { [FEATURE_WRAPPER_ATTR]: s.feature },
             innerBlocks: [{ type: "text", tagName: "p", content: "Exemple de carte" }, { type: "raw", rawMarkup: featureMarker(s.feature) }] } satisfies GbNode]
        : []),
      ...((s.type === "form" || s.type === "contact") && s.form && !page.sections.slice(0, i).some((x) => x.form === s.form)
        ? [{ type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: s.form },
             innerBlocks: [{ type: "raw", rawMarkup: formMarker(s.form) }, { type: "text", tagName: "p", content: "Le formulaire sera disponible ici." }] } satisfies GbNode]
        : []),
    ] satisfies GbNode[],
  }));
}

describe.skipIf(!process.env.FAKTORY_DOCKER)("content stage on a throwaway site (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8196 };
  let ctx: SiteContext;
  let spec: SiteSpec;
  const fixture = (): Article => JSON.parse(readFileSync(FIXTURE_ARTICLE, "utf8"));
  beforeAll(async () => {
    await initSite(config, { slug: "itcontent", briefPath: "fixtures/briefs/boulangerie.md" });
    ctx = loadContext(config, "itcontent");
    copyFileSync("fixtures/specs/boulangerie.site-spec.json", artifactPath(ctx, "siteSpecJson"));
    copyFileSync("fixtures/specs/boulangerie.design-tokens.json", artifactPath(ctx, "designTokensJson"));
    writeFileSync(artifactPath(ctx, "designSystemMd"), "# Maison Rivet — Design System Web\n");
    spec = JSON.parse(readFileSync(artifactPath(ctx, "siteSpecJson"), "utf8"));
    const p = await runSite(config, "itcontent", { only: "provision" });
    expect(p.stages.provision.status, p.stages.provision.message).toBe("done");
    vi.spyOn(pagesDeps, "generatePageTree").mockImplementation(async (c, _spec, page) => {
      const tree = stubTree(page);
      writeFileSync(pageTreePath(c, page.slug), JSON.stringify(tree, null, 2));
      return { tree, costUsd: 0, attempts: 1 as const };
    });
    const pg = await runSite(config, "itcontent", { only: "pages" });
    expect(pg.stages.pages.status, pg.stages.pages.message).toBe("done");
  }, 600_000);
  afterAll(async () => { vi.restoreAllMocks(); await destroySite(config, "itcontent"); });

  it("creates the forms, sets the seo meta, publishes the (stubbed) articles and renders everything", async () => {
    // The agent is stubbed: every spec article gets the fixture body under its own title (the other checks are real).
    const gen = vi.spyOn(contentDeps, "generateArticle").mockImplementation(async (c, _s, article) => {
      const slug = articleSlug(article.title);
      const a: Article = { ...fixture(), title: article.title, category: article.theme };
      mkdirSync(dirname(articlePath(c, slug)), { recursive: true });
      writeFileSync(articlePath(c, slug), JSON.stringify(a, null, 2));
      return { article: a, slug, costUsd: 0, attempts: 1 as const };
    });
    const state = await runSite(config, "itcontent", { only: "content" });
    expect(state.stages.content.status, state.stages.content.message).toBe("done");
    expect(gen).toHaveBeenCalledTimes(3);
    expect(state.stages.content.message).toMatch(/forms: devis_evenement → #\d+, contact → #\d+ \(2 created, 0 reused; 2 pages updated\); seo: 6 pages; articles: 3 published/);

    // forms: real Gravity Forms forms, with the admin notification, rendered on their pages
    const manifest = JSON.parse(readFileSync(formsManifestPath(ctx), "utf8"));
    const forms = await wpJson<{ id: string; title: string }[]>(ctx, ["gf", "form", "form_list"]);
    expect(forms.map((f) => f.title).sort()).toEqual(spec.forms.map((f) => f.name).sort());
    const contactForm = JSON.parse(await wpOk(ctx, ["gf", "form", "get", String(manifest.contact.gfId)]));
    expect(contactForm.fields.map((f: any) => f.type)).toEqual(["text", "email", "textarea"]);
    expect(contactForm.notifications.faktory_admin.to).toBe("contact@maisonrivet.fr");
    const contactHtml = await (await fetch(`http://localhost:${ctx.state.port}/contact/`)).text();
    expect(contactHtml).toContain(`gform_wrapper_${manifest.contact.gfId}`);
    expect(contactHtml).not.toContain("Le formulaire sera disponible ici.");
    const devisHtml = await (await fetch(`http://localhost:${ctx.state.port}/commandes-evenements/`)).text();
    expect(devisHtml).toContain(`gform_wrapper_${manifest.devis_evenement.gfId}`);
    expect(readFileSync(pageTreePath(ctx, "contact"), "utf8")).toContain(FORM_WRAPPER_ATTR); // tree keeps its wrapper

    // seo: Yoast meta present, rendered title
    const contactId = (await wpJson<{ ID: number }[]>(ctx, ["post", "list", "--post_type=page", "--name=contact", "--fields=ID"]))[0].ID;
    const contactPage = spec.sitemap.find((p) => p.slug === "contact")!;
    expect(await wpOk(ctx, ["post", "meta", "get", String(contactId), YOAST_META.title])).toBe(contactPage.seo.title);
    expect(await wpOk(ctx, ["post", "meta", "get", String(contactId), YOAST_META.metadesc])).toBe(contactPage.seo.metaDescription);
    expect(contactHtml).toContain(`<meta name="description" content="${contactPage.seo.metaDescription}"`);

    // articles: published posts with category, excerpt, image, meta; listed on the posts page
    const posts = await wpJson<{ ID: number; post_name: string; post_status: string }[]>(ctx, ["post", "list", "--post_type=post", "--post_status=any", "--fields=ID,post_name,post_status"]);
    expect(posts.map((p) => p.post_name).sort()).toEqual(spec.blog.articles.map((a) => articleSlug(a.title)).sort());
    const galette = posts.find((p) => p.post_name === articleSlug(spec.blog.articles[0].title))!;
    expect(galette.post_status).toBe("publish");
    expect((await wpJson<{ name: string }[]>(ctx, ["post", "term", "list", String(galette.ID), "category", "--fields=name"])).map((t) => t.name)).toEqual(["Saison"]);
    expect(await wpOk(ctx, ["post", "meta", "get", String(galette.ID), "_thumbnail_id"])).toMatch(/^\d+$/);
    const cats = await wpJson<{ name: string }[]>(ctx, ["term", "list", "category", "--fields=name"]);
    for (const c of spec.blog.categories) expect(cats.map((t) => t.name)).toContain(c);
    const post = await (await fetch(`http://localhost:${ctx.state.port}/${galette.post_name}/`)).text();
    expect(post).toContain('class="wp-block-heading"');
    expect(post).toContain("Deux recettes, un seul feuilletage");
    const blog = await (await fetch(`http://localhost:${ctx.state.port}/actualites/`)).text();
    for (const p of posts) expect(blog).toContain(`href="http://localhost:${ctx.state.port}/${p.post_name}/"`);
  }, 600_000);

  it("reuses forms and articles on a second run (no agent), and the pages stage keeps the forms", async () => {
    const gen = vi.spyOn(contentDeps, "generateArticle").mockRejectedValue(new Error("must not be called"));
    const before = (await wpJson<{ id: string }[]>(ctx, ["gf", "form", "form_list"])).length;
    const state = await runSite(config, "itcontent", { only: "content" });
    expect(state.stages.content.status, state.stages.content.message).toBe("done");
    expect(state.stages.content.message).toContain("0 created, 2 reused");
    expect(state.stages.content.message).toContain("0 generated, 3 reused");
    expect(gen).not.toHaveBeenCalled();
    expect((await wpJson<{ id: string }[]>(ctx, ["gf", "form", "form_list"])).length).toBe(before);
    expect((await wpJson<{ ID: number }[]>(ctx, ["post", "list", "--post_type=post", "--fields=ID"])).length).toBe(3);

    const pg = await runSite(config, "itcontent", { only: "pages" });
    expect(pg.stages.pages.status, pg.stages.pages.message).toBe("done");
    expect(pg.stages.pages.message).toContain("forms applied (contact, devis_evenement)");
    const contactHtml = await (await fetch(`http://localhost:${ctx.state.port}/contact/`)).text();
    expect(contactHtml).toContain("gform_wrapper_");
    expect(existsSync(formsManifestPath(ctx))).toBe(true);
  }, 600_000);
});
```

- [ ] **Step 2: Run it**

Run: `FAKTORY_DOCKER=1 npx vitest run tests/integration/content.test.ts --testTimeout=600000 --hookTimeout=600000`
Expected: 2 tests pass (about 3–5 minutes: the stack is installed from `docker/vendor`). If `wp gf form get` output is preceded by a PHP warning line (`WP_DEBUG already defined` is on stderr, not stdout, so it should not), take the last line before `JSON.parse`.

- [ ] **Step 3: Run the whole unit suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/content.test.ts
git commit -m "test(faktory): content stage docker integration test"
```

---

### Task 11: Live run on boulangerie, docs, deviations

**Files:**
- Modify: `README.md` (Stages, Cost, a « Content » section), `docs/superpowers/specs/2026-09-13-faktory-phase5-content-design.md` (« Écarts constatés à l'exécution »)

- [ ] **Step 1: Run the stage on the live site** (costs a few dollars: 5 Opus articles)

```bash
npm run faktory -- run boulangerie --only content
```

Expected: `✔ content — forms: devis_evenement → #N, contact → #M (2 created, 0 reused; 2 pages updated); seo: 6 pages; articles: 5 published (…); 5 generated, 0 reused — $X.XX`. Then check by eye `http://localhost:8101/contact/`, `/commandes-evenements/`, `/actualites/` and one article. Note the cost printed and the new `costUsd` in `sites/boulangerie/faktory.json`.

- [ ] **Step 2: README**

In « Stages », replace `Phase 4 implements \`plugins\`. Only \`content\`, \`qa\` and \`export\` are still marked "skipped (not implemented)".` by `Phase 4 implements \`plugins\`, phase 5 \`content\`. Only \`qa\` and \`export\` are still marked "skipped (not implemented)".` Add after the plugins section a section:

```markdown
### Content
`content` runs after `pages`, in three sub-steps. **Forms**: one Gravity Forms form per `spec.forms[i]`, built by Faktory (field types, required flags, French submit button, an admin notification to the form's recipient with `{all_fields}`, default confirmation) and created with the Gravity Forms CLI; `content/forms.json` records form id → Gravity Forms id; the `data-faktory-form` wrapper left by the pages stage is swapped for the `gravityforms/form` block at compile time (same mechanism as plugins), the page is republished and must render `gform_wrapper_<id>`. E-mail delivery needs an SMTP configuration on the production host (the container has none). **SEO**: Yoast title, meta description and focus keyword of every sitemap page from `page.seo`, verified on the rendered `<title>`. **Articles**: one structured-output agent per `spec.blog.articles[i]` (tools: `Read` only; 500–1200 words, intro paragraph, ≥ 2 headings, inline `<strong>/<em>/<a>` only, no invented facts), saved to `content/articles/<slug>.json` — the editing surface: delete a file to regenerate that article, edit it and re-run to republish — then serialized to core Gutenberg blocks and published with category, excerpt, placeholder featured image and Yoast meta. The posts page must link every article.
```

In « Cost », add the measured figures: `The \`content\` stage cost **$X.XX for 5 articles** (≈ $Y per article, forms and SEO are $0); cumulative site cost after \`content\`: $Z.`

- [ ] **Step 3: Spec addendum**

Append to the phase 5 spec a section `## Écarts constatés à l'exécution (2026-09-13)` listing what differed (at least: the poisoned-article convention — Faktory only writes validated output, so nothing is deleted; the posts-page check uses the article link, not its title; any CLI surprise met in Task 10).

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-13-faktory-phase5-content-design.md
git commit -m "docs(faktory): content stage, measured cost, phase 5 deviations"
```
