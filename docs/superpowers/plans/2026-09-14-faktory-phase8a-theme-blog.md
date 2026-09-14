# Faktory Phase 8a — Theme styling and blog page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A site produced by an unattended run follows the design system on every page — GeneratePress header, menu, backgrounds, links and headings, a designed blog archive and article header, Gravity Forms forms, French theme strings — and `SITE-SPEC.md` lists the facts missing from the brief.

**Architecture:** Everything lands in the existing `provision` stage as focused modules under `src/provision/` (settings fix, shared element helpers, blog Elements, generated child theme, language packs), plus a pure `src/spec-gaps.ts` used by the `spec` stage, its markdown renderer and `approve`, and one new automatic QA check. No new pipeline stage; `faktory run <slug> --only provision` restyles an existing site at $0.

**Tech Stack:** TypeScript (ESM, `tsx`), vitest, zod 4, WP-CLI through `docker compose exec`, GeneratePress 3.6.1, GP Premium 2.5.6, GenerateBlocks 2.4.1, Gravity Forms 3.1.1.2, Playwright (QA).

**Spec:** `docs/superpowers/specs/2026-09-14-faktory-phase8a-design.md` (parent scope: `docs/superpowers/specs/2026-09-14-faktory-phase8-design.md`).

## Global Constraints

- Colors in theme settings and GB trees are palette variables only (`var(--base)`, `var(--base-2)`, `var(--base-3)`, `var(--contrast)`, `var(--contrast-2)`, `var(--contrast-3)`, `var(--accent)`, `var(--accent-2)`); the single exception is the Gravity Forms `gform_default_styles` payload, which takes hex values from the tokens.
- Faktory palette roles: `base` = page background, `base2` = alternate section background, `base3` = cards/surfaces, `contrast` = body text and dark backgrounds, `contrast2` = muted text, `contrast3` = borders, `accent` = primary action, `accent2` = secondary highlight.
- Missing-fact marker: any string matching `/à confirmer/i` (the spec prompt writes `[à confirmer]`; the fixture also has `[adresse à confirmer], 44100 Nantes`).
- Brief gaps never block `approve`: warn only.
- Blog: 9 posts per page; grid 3 columns desktop, 2 under `@media (max-width:1024px)`, 1 under `@media (max-width:767px)`.
- Element slugs: `faktory-footer` (existing), `faktory-blog-hero`, `faktory-blog-loop`, `faktory-post-hero`.
- Language packs are best-effort (warning in the provision summary); every other provision step fails fast through `wpOk`.
- User-facing strings in generated sites are French; code, comments and commit messages are English.
- Commit messages: `type(faktory): …`, ending with the attribution lines given by the session.
- Unit tests: `npm test` (= `vitest run tests/unit`). Docker integration tests: `FAKTORY_DOCKER=1 npx vitest run tests/integration/<file> --testTimeout=600000 --hookTimeout=600000`. Typecheck: `npm run typecheck`.
- Long pipeline runs (≈ 30 min) are started detached with `nohup … > log 2>&1 &`, never as a foreground tool command limited to 10 minutes.

## Deviations from the spec decided while planning

Record these in the spec's « Écarts et mesures » section in Task 12:

1. **Language packs run after `installStack`, not inside `installCore`**: `wp language theme install generatepress fr_FR` fails while the theme is not installed yet, and `installCore` runs before `installStack`. New function `installLanguagePacks` in `src/provision/stack.ts`.
2. **`Gap = { label: string; paths: string[] }`** instead of `{ path; label }`: gaps sharing a label (the 7 hour lines) are grouped into one entry carrying every path.
3. **The child theme is written whether or not Gravity Forms is present**: the filter is inert without GF, and the same file also carries the single-post content width (GeneratePress has no setting for a narrower single-post column, contrary to what the spec assumed).
4. **The child theme file is written through the `wpcli` container** (`sh -c 'cat > …'` then `php -l`), not from the host, so file ownership matches WordPress's and a syntax error fails provision.
5. **`isPlaceholder` moves to `src/spec-gaps.ts`** and is imported by `footer.ts` directly (not re-exported by `elements.ts`).
6. **GB `query-no-results` and `query-page-numbers` are emitted as `raw` nodes with hand-written CSS** because `gb_build.py` (a synced copy of a user skill, overwritten by `npm run sync-skills`) only knows `element|text|media|shape|looper|loop-item|query`.
7. **Orbital is selected by the filter payload (`theme: "orbital"`), not by writing `rg_gforms_default_theme`**, and the integration test checks the filter's output with `wp eval` instead of a `/contact/` page: forms are only created by the `content` stage, after provision. The `/contact/` rendering is checked in the Task 12 browser pass.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/spec-gaps.ts` | Create | `isPlaceholder`, `hasGapMarker`, `findSpecGaps`, `gapWarning` — pure |
| `src/render/site-spec-md.ts` | Modify | « Informations à compléter » section |
| `src/stages/spec.ts` | Modify | gap count in the summary; warning in `onApprove` |
| `src/resync.ts` | Modify | resync prompt ignores the derived section |
| `src/provision/settings.ts` | Modify | version stamp, full replacement, component colors, `module: "core"`, `posts_per_page` |
| `src/provision/elements.ts` | Create | shared GB node helpers + `upsertBlockElement` |
| `src/provision/footer.ts` | Modify | use `elements.ts` and `spec-gaps.ts` |
| `src/provision/blog.ts` | Create | blog hero / loop / post hero trees + `installBlog` |
| `src/provision/child-theme.ts` | Create | generated `functions.php` (GF styles, GF font, single-post width) + `installChildTheme` |
| `src/provision/stack.ts` | Modify | `installLanguagePacks` |
| `src/stages/provision.ts` | Modify | wire the new steps and summary parts |
| `src/qa/inpage.ts`, `src/qa/browser.ts`, `src/schemas/qa.ts`, `src/qa/report.ts`, `src/prompts/qa.md` | Modify | `untranslated` automatic check |
| `fixtures/qa/contact.check.json`, `fixtures/qa/report.json` | Modify | add `"untranslated": []` |
| `tests/unit/spec-gaps.test.ts`, `tests/unit/provision-blog.test.ts`, `tests/unit/provision-child-theme.test.ts`, `tests/unit/provision-elements.test.ts` | Create | unit tests |
| `tests/unit/site-spec-md.test.ts`, `tests/unit/stage-spec.test.ts`, `tests/unit/resync.test.ts`, `tests/unit/provision-settings.test.ts`, `tests/unit/provision-stack.test.ts`, `tests/unit/stage-provision.test.ts`, `tests/unit/qa-schema.test.ts`, `tests/unit/qa-browser.test.ts`, `tests/unit/qa-report.test.ts` | Modify | updated expectations |
| `tests/integration/provision-chrome.test.ts` | Modify | flexbox, fonts, repair, blog pages, GF styles, language pack |
| `README.md`, `docs/GETTING-STARTED.md` | Modify | provision description, phase status |
| `docs/superpowers/specs/2026-09-14-faktory-phase8a-design.md` | Modify | « Écarts et mesures » |

---

### Task 1: Brief gaps finder (`src/spec-gaps.ts`)

**Files:**
- Create: `src/spec-gaps.ts`
- Modify: `src/provision/footer.ts` (remove local `isPlaceholder`, import it)
- Test: `tests/unit/spec-gaps.test.ts`

**Interfaces:**
- Consumes: `SiteSpec` from `src/schemas/site-spec.ts`.
- Produces:
  - `isPlaceholder(v?: string): boolean` — true when empty or containing the marker.
  - `hasGapMarker(v: string): boolean`
  - `type Gap = { label: string; paths: string[] }`
  - `findSpecGaps(spec: SiteSpec): Gap[]` — ordered by first occurrence in a depth-first walk.
  - `gapWarning(gaps: Gap[]): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/spec-gaps.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/spec-gaps.test.ts`
Expected: FAIL — `Cannot find module '../../src/spec-gaps.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/spec-gaps.ts`:

```ts
import type { SiteSpec } from "./schemas/site-spec.js";

const GAP_RE = /à confirmer/i;

/** The spec prompt writes `[à confirmer]` for a fact absent from the brief, sometimes inside a longer value. */
export const hasGapMarker = (v: string): boolean => GAP_RE.test(v);

/** Values the spec author left unfilled, or empty — never render these. */
export const isPlaceholder = (v?: string): boolean => !v || hasGapMarker(v);

export type Gap = { label: string; paths: string[] };
type Path = (string | number)[];

const CONTACT_LABELS: Record<string, string> = { email: "Email", phone: "Téléphone", address: "Adresse", hours: "Horaires" };

function walk(v: unknown, path: Path, out: Path[]): void {
  if (typeof v === "string") { if (hasGapMarker(v)) out.push(path); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...path, i], out)); return; }
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k], out);
}

const formatPath = (p: Path): string => p.map((x, i) => (typeof x === "number" ? `[${x}]` : i ? `.${x}` : x)).join("");

function gapLabel(spec: SiteSpec, [root, a, b, c]: Path): string {
  if (root === "identity" && a === "contact" && typeof b === "string") return CONTACT_LABELS[b] ?? `Contact › ${b}`;
  if (root === "identity" && typeof a === "string") return `Identité › ${a}`;
  if (root === "sitemap" && typeof a === "number") {
    const page = spec.sitemap[a];
    if (b === "sections" && typeof c === "number") return `Page ${page.title} › ${page.sections[c].heading}`;
    if (b === "seo") return `Page ${page.title} › SEO`;
    return `Page ${page.title}`;
  }
  if (root === "features" && typeof a === "number") return `Fonctionnalité ${spec.features[a].name}`;
  if (root === "forms" && typeof a === "number") return `Formulaire ${spec.forms[a].name}`;
  if (root === "blog" && a === "articles" && typeof b === "number") return `Article « ${spec.blog.articles[b].title} »`;
  return formatPath([root, a, b, c].filter((x) => x !== undefined));
}

/** Every value still carrying the marker, grouped by readable label, in depth-first order. */
export function findSpecGaps(spec: SiteSpec): Gap[] {
  const paths: Path[] = [];
  walk(spec, [], paths);
  const byLabel = new Map<string, string[]>();
  for (const p of paths) {
    const label = gapLabel(spec, p);
    byLabel.set(label, [...(byLabel.get(label) ?? []), formatPath(p)]);
  }
  return [...byLabel].map(([label, ps]) => ({ label, paths: ps }));
}

export function gapWarning(gaps: Gap[]): string {
  const n = gaps.length;
  const names = gaps.slice(0, 3).map((g) => g.label).join(", ") + (n > 3 ? "…" : "");
  return `⚠ ${n} information${n > 1 ? "s" : ""} à compléter dans SITE-SPEC.md (${names}) — le site affichera des manques`;
}
```

Note: the form-name label test sets `forms[0].name` to contain the marker; the label then contains the marker text itself, which is expected.

- [ ] **Step 4: Point the footer at the shared helper**

In `src/provision/footer.ts`, delete these two lines:

```ts
/** Values the spec author left unfilled (e.g. `"[à confirmer]"`), or empty — never render these. */
const isPlaceholder = (v?: string): boolean => !v || /à confirmer/i.test(v);
```

and add to the imports:

```ts
import { isPlaceholder } from "../spec-gaps.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/spec-gaps.test.ts tests/unit/provision-footer.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/spec-gaps.ts src/provision/footer.ts tests/unit/spec-gaps.test.ts
git commit -m "feat(faktory): brief gaps finder over site-spec.json, shared placeholder test"
```

---

### Task 2: Gaps in SITE-SPEC.md, the spec summary, approve and resync

**Files:**
- Modify: `src/render/site-spec-md.ts`, `src/stages/spec.ts`, `src/resync.ts`
- Test: `tests/unit/site-spec-md.test.ts`, `tests/unit/stage-spec.test.ts`, `tests/unit/resync.test.ts`

**Interfaces:**
- Consumes: `findSpecGaps`, `gapWarning`, `type Gap` from Task 1; `readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec)` from `src/artifacts.ts`.
- Produces: `renderSiteSpecMarkdown(spec)` output gains `## Informations à compléter` right after the notice when gaps exist; spec summary gains `, N information(s) à compléter` before ` — $`; `specStage.onApprove` calls `console.warn(gapWarning(gaps))` when gaps exist.

- [ ] **Step 1: Write the failing tests**

Append to the `describe("renderSiteSpecMarkdown", …)` block in `tests/unit/site-spec-md.test.ts`:

```ts
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
```

In `tests/unit/stage-spec.test.ts`, change the summary expectation of the first test to:

```ts
    expect(msg).toMatch(/SITE-SPEC.md.*6 pages.*1 feature.*2 forms, 2 informations à compléter — \$0.42/);
```

and append a new test inside the same `describe`:

```ts
  it("onApprove warns about brief gaps without blocking", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockResolvedValue({ text: "", transcript: "", structured: fixture, costUsd: 0.4, numTurns: 3 });
    await specStage.run(c);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await specStage.onApprove!(c)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith("⚠ 2 informations à compléter dans SITE-SPEC.md (Téléphone, Adresse) — le site affichera des manques");
  });
```

In `tests/unit/resync.test.ts`, inside the test `"re-extracts with a structured query using the resync model and Read only, then rewrites the json"`, next to the existing `expect(call.prompt).toContain("design-tokens.json");`, add:

```ts
    expect(call.prompt).toContain("Ignore la section « Informations à compléter »");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/site-spec-md.test.ts tests/unit/stage-spec.test.ts tests/unit/resync.test.ts`
Expected: FAIL on the four new/changed expectations.

- [ ] **Step 3: Implement the markdown section**

In `src/render/site-spec-md.ts`, add the import:

```ts
import { findSpecGaps } from "../spec-gaps.js";
```

and replace:

```ts
  out.push(`# SITE-SPEC — ${id.name}`, "", NOTICE, "");
```

with:

```ts
  out.push(`# SITE-SPEC — ${id.name}`, "", NOTICE, "");

  const gaps = findSpecGaps(spec);
  if (gaps.length) {
    out.push("## Informations à compléter", "");
    for (const g of gaps) out.push(`- ${g.label}${g.paths.length > 1 ? ` (${g.paths.length} valeurs)` : ""}`);
    out.push("", "Remplacez chaque `[à confirmer]` dans ce fichier puis `faktory approve`.", "");
  }
```

- [ ] **Step 4: Implement the summary and the approve warning**

In `src/stages/spec.ts`, change the artifacts import and add two imports:

```ts
import { readJsonArtifact, writeJsonArtifact, writeTextArtifact } from "../artifacts.js";
import { findSpecGaps, gapWarning } from "../spec-gaps.js";
```

Replace the `return` at the end of `run` with:

```ts
    const gaps = findSpecGaps(spec).length;
    const gapPart = gaps ? `, ${gaps} information${gaps > 1 ? "s" : ""} à compléter` : "";
    return `SITE-SPEC.md written: ${spec.sitemap.length} pages, ${spec.features.length} feature${spec.features.length === 1 ? "" : "s"}, ${spec.forms.length} forms${gapPart} — $${r.costUsd.toFixed(2)}`;
```

Replace `onApprove` with:

```ts
  async onApprove(ctx) {
    const s = await resyncFromMarkdown(ctx, SPEC_RESYNC);
    const gaps = findSpecGaps(s ?? readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec));
    if (gaps.length) console.warn(gapWarning(gaps));
    return s ? `approved; site-spec.json re-synced from edited SITE-SPEC.md (${s.sitemap.length} pages)` : undefined;
  },
```

- [ ] **Step 5: Implement the resync sentence**

In `src/resync.ts`, in the `prompt` array of `resyncFromMarkdown`, insert before `"N'invente rien qui ne soit ni dans le markdown ni dans le JSON. Réponds uniquement avec la structure demandée."`:

```ts
      "Ignore la section « Informations à compléter » si elle existe : elle est recalculée depuis le JSON et ne contient aucune donnée.",
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/site-spec-md.test.ts tests/unit/stage-spec.test.ts tests/unit/resync.test.ts tests/unit/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/render/site-spec-md.ts src/stages/spec.ts src/resync.ts tests/unit/site-spec-md.test.ts tests/unit/stage-spec.test.ts tests/unit/resync.test.ts
git commit -m "feat(faktory): list brief gaps in SITE-SPEC.md, spec summary and approve warning"
```

---

### Task 3: GeneratePress settings fix (A1)

**Files:**
- Modify: `src/provision/settings.ts`
- Test: `tests/unit/provision-settings.test.ts`

**Interfaces:**
- Consumes: `runWp`, `wpOk` from `src/wp.ts`.
- Produces:
  - `TYPO_RULE_DEFAULTS` now includes `module: "core"`.
  - `COMPONENT_COLORS: Record<string, string>` (exported, palette variables only).
  - `POSTS_PER_PAGE = 9` (exported).
  - `buildGenerateSettings(t)` returns the complete option (no merge).
  - `applyTokens(ctx, tokens)` — command order: `theme get generatepress --field=version`, `option update generate_db_version <v>`, `option update generate_settings --format=json` (stdin), `option update posts_per_page 9`, `option update generate_dynamic_css_output ""`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/provision-settings.test.ts`:

1. Add to the `describe("buildGenerateSettings", …)` block:

```ts
  it("tags every typography rule with module core, or GeneratePress drops it from the CSS", () => {
    for (const r of s.typography as { module: string }[]) expect(r.module).toBe("core");
  });
  it("forces the flexbox structure and svg icons so GP never renders in legacy mode", () => {
    expect(s).toMatchObject({ structure: "flexbox", icons: "svg", combine_css: true, dynamic_css_cache: true });
  });
  it("maps every component color to a palette variable, never a hex value", () => {
    expect(s).toMatchObject({
      background_color: "var(--base)", content_background_color: "var(--base)", text_color: "var(--contrast)",
      link_color: "var(--accent)", link_color_hover: "var(--contrast)",
      header_background_color: "var(--base-3)", navigation_background_color: "var(--base-3)",
      navigation_text_color: "var(--contrast)", navigation_text_hover_color: "var(--accent)", navigation_text_current_color: "var(--accent)",
      subnavigation_background_color: "var(--base-3)", subnavigation_text_color: "var(--contrast)",
      site_title_color: "var(--contrast)", site_tagline_color: "var(--contrast-2)",
      blog_post_title_color: "var(--contrast)", blog_post_title_hover_color: "var(--contrast-2)",
      entry_meta_text_color: "var(--contrast-2)", entry_meta_link_color: "var(--accent)",
      form_background_color: "var(--base-3)", form_text_color: "var(--contrast)", form_border_color: "var(--contrast-3)",
      form_button_background_color: "var(--accent)", form_button_background_color_hover: "var(--contrast)",
      form_button_text_color: "var(--base-3)", form_button_text_color_hover: "var(--base-3)",
      footer_background_color: "var(--contrast)",
    });
    const { global_colors: _palette, ...rest } = s;
    expect(JSON.stringify(rest)).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
```

2. Replace the whole `it("merges over the existing option, writes JSON on stdin and invalidates the css cache", …)` and `it("starts from an empty object when the option does not exist yet", …)` tests with:

```ts
  it("stamps the GP version first, replaces the option without reading it, sets posts per page and clears the css cache", async () => {
    const spy = vi.spyOn(deps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      if (cmd.join(" ") === "wp theme get generatepress --field=version") return { stdout: "3.6.1\n", stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
    await applyTokens(ctx, tokens);
    const c = calls(spy);
    expect(c.map((x: any) => x.args.join(" "))).toEqual([
      "theme get generatepress --field=version",
      "option update generate_db_version 3.6.1",
      "option update generate_settings --format=json",
      "option update posts_per_page 9",
      "option update generate_dynamic_css_output ",
    ]);
    const written = JSON.parse(c[2].input!);
    expect(written).toEqual(buildGenerateSettings(tokens));
    expect(written.icons).toBe("svg");
  });
  it("refuses to write settings when the GeneratePress version cannot be read", async () => {
    vi.spyOn(deps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      if (cmd.join(" ") === "wp theme get generatepress --field=version") return { stdout: "", stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
    await expect(applyTokens(ctx, tokens)).rejects.toThrow(/GeneratePress version/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/provision-settings.test.ts`
Expected: FAIL (module core, structure, colors, command list, version error).

- [ ] **Step 3: Implement**

In `src/provision/settings.ts`:

1. Replace the `import { runWp, wpOk } from "../wp.js";` line with `import { wpOk } from "../wp.js";`.

2. In `TYPO_RULE_DEFAULTS`, change the first line to:

```ts
  selector: "", customSelector: "", module: "core", fontFamily: "", fontWeight: "", textTransform: "", textDecoration: "", fontStyle: "",
```

and replace its doc comment with:

```ts
/** Full key set of a GP typography rule (GeneratePress_Typography::get_defaults). `module: "core"` is required: get_css('core') drops rules without it. */
```

3. Add after the `mobile` helper:

```ts
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
```

4. In `buildGenerateSettings`, add these keys to the returned object right after `container_width`:

```ts
    structure: "flexbox",
    icons: "svg",
    combine_css: true,
    dynamic_css_cache: true,
    ...COMPONENT_COLORS,
```

5. Replace `applyTokens` with:

```ts
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
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/provision-settings.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/provision/settings.ts tests/unit/provision-settings.test.ts
git commit -m "fix(faktory): GeneratePress settings — stamp db version, replace option, palette component colors, core typography module"
```

---

### Task 4: Shared element helpers (`src/provision/elements.ts`)

**Files:**
- Create: `src/provision/elements.ts`
- Modify: `src/provision/footer.ts`
- Test: `tests/unit/provision-elements.test.ts`; `tests/unit/provision-footer.test.ts` must stay green unchanged

**Interfaces:**
- Consumes: `wpOk`, `wpJson` from `src/wp.ts`; `DesignTokens`.
- Produces:
  - `MOBILE = "@media (max-width:767px)"`, `TABLET = "@media (max-width:1024px)"`
  - `type GbNode = { type: string; tagName?: string; content?: string; htmlAttributes?: Record<string, string>; attrs?: Record<string, unknown>; styles?: Record<string, unknown>; innerBlocks?: GbNode[]; rawMarkup?: string }`
  - `text(tagName, content, styles?, htmlAttributes?): GbNode`
  - `esc(s: string): string` (escapes `& < > "`)
  - `stepper(tokens): (i: number) => number`
  - `type ElementCondition = { rule: string; object: string }`
  - `upsertBlockElement(ctx, el: { slug: string; title: string; markup: string; meta: Record<string, string>; conditions: ElementCondition[] }): Promise<number>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/provision-elements.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps as wpDeps } from "../../src/wp.js";
import { parseDesignTokens } from "../../src/schemas/design-tokens.js";
import { esc, stepper, text, upsertBlockElement } from "../../src/provision/elements.js";

const tokens = parseDesignTokens(JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8")));
const ctx: SiteContext = { config: loadConfig(process.cwd()), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };

describe("node helpers", () => {
  it("escapes html, clamps the spacing ramp and builds text nodes", () => {
    expect(esc(`Pain & "Co" <b>`)).toBe("Pain &amp; &quot;Co&quot; &lt;b&gt;");
    const step = stepper(tokens);
    expect(step(0)).toBe(tokens.spacing[0]);
    expect(step(99)).toBe(tokens.spacing.at(-1));
    expect(text("h1", "Titre")).toEqual({ type: "text", tagName: "h1", content: "Titre", styles: {} });
    expect(text("a", "x", {}, { href: "/" }).htmlAttributes).toEqual({ href: "/" });
  });
});

describe("upsertBlockElement", () => {
  beforeEach(() => vi.restoreAllMocks());
  const argsOf = (spy: any) => spy.mock.calls.map((c: any) => ({ a: (c[2] as string[]).slice(1).join(" "), input: (c[3] as { input?: string } | undefined)?.input }));
  it("creates the element, pushes markup on stdin, writes the type, every meta and the conditions", async () => {
    const spy = vi.spyOn(wpDeps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      const a = cmd.slice(1).join(" ");
      if (a.startsWith("post list --post_type=gp_elements")) return { stdout: "[]", stderr: "", code: 0 };
      if (a.startsWith("post create")) return { stdout: "7\n", stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
    const id = await upsertBlockElement(ctx, { slug: "faktory-x", title: "Faktory x", markup: "<p>m</p>", meta: { _generate_block_type: "page-hero", _generate_hook: "generate_after_header" }, conditions: [{ rule: "general:blog", object: "" }] });
    expect(id).toBe(7);
    const c = argsOf(spy);
    expect(c.map((x: any) => x.a)).toEqual([
      "option update generate_package_elements activated",
      "post list --post_type=gp_elements --post_status=any --fields=ID,post_name --format=json",
      "post create --post_type=gp_elements --post_status=publish --post_title=Faktory x --post_name=faktory-x --porcelain",
      "post update 7 -",
      "post meta update 7 _generate_element_type block",
      "post meta update 7 _generate_block_type page-hero",
      "post meta update 7 _generate_hook generate_after_header",
      'post meta update 7 _generate_element_display_conditions [{"rule":"general:blog","object":""}] --format=json',
    ]);
    expect(c[3].input).toBe("<p>m</p>");
  });
  it("reuses an existing element with the same slug", async () => {
    const spy = vi.spyOn(wpDeps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      const a = cmd.slice(1).join(" ");
      if (a.startsWith("post list --post_type=gp_elements")) return { stdout: JSON.stringify([{ ID: 3, post_name: "faktory-x" }]), stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
    expect(await upsertBlockElement(ctx, { slug: "faktory-x", title: "t", markup: "m", meta: {}, conditions: [] })).toBe(3);
    expect(argsOf(spy).some((x: any) => x.a.startsWith("post create"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/provision-elements.test.ts`
Expected: FAIL — cannot find module `elements.js`.

- [ ] **Step 3: Implement `elements.ts`**

Create `src/provision/elements.ts`:

```ts
import type { SiteContext } from "../docker.js";
import { wpOk, wpJson } from "../wp.js";
import type { DesignTokens } from "../schemas/design-tokens.js";

export const MOBILE = "@media (max-width:767px)";
export const TABLET = "@media (max-width:1024px)";

/** A gb_build.py node (see plugin/skills/generatepress-generateblocks/scripts/gb_build.py). */
export type GbNode = {
  type: string; tagName?: string; content?: string; htmlAttributes?: Record<string, string>; attrs?: Record<string, unknown>;
  styles?: Record<string, unknown>; innerBlocks?: GbNode[]; rawMarkup?: string;
};

export const text = (tagName: string, content: string, styles: Record<string, unknown> = {}, htmlAttributes?: Record<string, string>): GbNode =>
  ({ type: "text", tagName, content, styles, ...(htmlAttributes ? { htmlAttributes } : {}) });

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPE[c]!);

/** Index into the tokens' spacing ramp, clamped to its last step. */
export const stepper = (tokens: DesignTokens) => (i: number): number => tokens.spacing[Math.min(i, tokens.spacing.length - 1)];

export type ElementCondition = { rule: string; object: string };
export type BlockElement = { slug: string; title: string; markup: string; meta: Record<string, string>; conditions: ElementCondition[] };

/** Create or update a GP Premium block element by slug: markup, `_generate_element_type=block`, extra metas, display conditions. */
export async function upsertBlockElement(ctx: SiteContext, el: BlockElement): Promise<number> {
  await wpOk(ctx, ["option", "update", "generate_package_elements", "activated"]);
  const existing = await wpJson<{ ID: number; post_name: string }[]>(ctx, ["post", "list", "--post_type=gp_elements", "--post_status=any", "--fields=ID,post_name"]);
  let id = existing.find((e) => e.post_name === el.slug)?.ID;
  if (!id) id = Number(await wpOk(ctx, ["post", "create", "--post_type=gp_elements", "--post_status=publish", `--post_title=${el.title}`, `--post_name=${el.slug}`, "--porcelain"]));
  await wpOk(ctx, ["post", "update", String(id), "-"], { input: el.markup });
  await wpOk(ctx, ["post", "meta", "update", String(id), "_generate_element_type", "block"]);
  for (const [key, value] of Object.entries(el.meta)) await wpOk(ctx, ["post", "meta", "update", String(id), key, value]);
  await wpOk(ctx, ["post", "meta", "update", String(id), "_generate_element_display_conditions", JSON.stringify(el.conditions), "--format=json"]);
  return id;
}
```

- [ ] **Step 4: Refactor the footer onto it**

In `src/provision/footer.ts`:

1. Replace the imports block and the local helpers (`MOBILE`, `type Node`, `text`, `ESCAPE`, `esc`) with:

```ts
import type { SiteContext } from "../docker.js";
import { wpOk } from "../wp.js";
import { gbBuild } from "../gb.js";
import type { SiteSpec } from "../schemas/site-spec.js";
import type { DesignTokens } from "../schemas/design-tokens.js";
import { isPlaceholder } from "../spec-gaps.js";
import { MOBILE, esc, stepper, text, upsertBlockElement, type GbNode as Node } from "./elements.js";

export const deps = { gbBuild };
export const FOOTER_ELEMENT_SLUG = "faktory-footer";
```

Keep `link` and `columnTitle` as they are.

2. In `footerTree`, replace:

```ts
  const sp = tokens.spacing;
  const step = (i: number) => sp[Math.min(i, sp.length - 1)];
```

with:

```ts
  const step = stepper(tokens);
```

3. Replace `installFooter` with:

```ts
/** Create or update the `faktory-footer` GP Premium block element and point it at the site-wide footer hook. */
export async function installFooter(ctx: SiteContext, spec: SiteSpec, tokens: DesignTokens): Promise<number> {
  const markup = await deps.gbBuild(ctx.config, footerTree(spec, tokens));
  const id = await upsertBlockElement(ctx, {
    slug: FOOTER_ELEMENT_SLUG, title: "Faktory footer", markup,
    meta: { _generate_block_type: "site-footer" },
    conditions: [{ rule: "general:site", object: "" }],
  });
  await wpOk(ctx, ["option", "update", "generate_dynamic_css_output", ""]);
  return id;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/unit/provision-elements.test.ts tests/unit/provision-footer.test.ts && npm run typecheck`
Expected: PASS (footer tests unchanged), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/provision/elements.ts src/provision/footer.ts tests/unit/provision-elements.test.ts
git commit -m "refactor(faktory): shared GB node helpers and block element upsert, footer uses them"
```

---

### Task 5: Blog Elements (A2/A3)

**Files:**
- Create: `src/provision/blog.ts`
- Test: `tests/unit/provision-blog.test.ts`

**Interfaces:**
- Consumes: from Task 4 `GbNode`, `MOBILE`, `TABLET`, `esc`, `stepper`, `text`, `upsertBlockElement`; `gbBuild` from `src/gb.ts`; `Page` type from `src/schemas/site-spec.ts`; `wpOk`.
- Produces:
  - `BLOG_HERO_SLUG = "faktory-blog-hero"`, `BLOG_LOOP_SLUG = "faktory-blog-loop"`, `POST_HERO_SLUG = "faktory-post-hero"`
  - `blogHeroTree(page: Page, tokens: DesignTokens): GbNode[]`
  - `blogLoopTree(tokens: DesignTokens): GbNode[]`
  - `postHeroTree(tokens: DesignTokens): GbNode[]`
  - `rawGbBlock(name: string, attrs: Record<string, unknown>, inner: string): string`
  - `installBlog(ctx, spec, tokens): Promise<number[] | undefined>` — `undefined` when the sitemap has no `blog` page; otherwise `[heroId, loopId, postHeroId]`.
  - `export const deps = { gbBuild }`

Background (verified in the installed plugins, do not re-derive):
- GenerateBlocks 2.4.1 dynamic tags are written `{{tag option:value|option2:value}}` in text content and html attributes of `generateblocks/{element,loop-item,looper,media,query,query-page-numbers,shape,text}`. Tags used: `{{post_title}}`, `{{post_title link:post}}` (wraps in a link to the post), `{{post_excerpt length:20}}`, `{{post_date}}` (site date format), `{{post_permalink}}`, `{{featured_image key:url|size:medium_large}}`, `{{featured_image key:alt}}`, `{{term_list tax:category}}`, `{{term_list tax:category|link:true}}`.
- `generateblocks/query` attribute `inheritQuery: true` follows the main query; `generateblocks/query-page-numbers` then renders `paginate_links()` inside `<div class="gb-query-page-numbers gb-query-page-numbers-<id>">`, and its `css` attribute is output. `generateblocks/query-no-results` returns its saved content only when the query has no posts.
- GP Premium block element types: `page-hero` hooks `_generate_hook` (we use `generate_after_header`) and honours `_generate_disable_title`, `_generate_disable_featured_image`, `_generate_disable_primary_post_meta`; `loop-template` hooks `generate_before_main_content` and disables GP's default loop. Conditions: `general:blog` (posts page), `taxonomy:category`, `post:post`.
- WordPress forbids `--` inside block comments: every `--` in block attribute JSON must be written `\u002d\u002d` (as `gb_build.py` does).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/provision-blog.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps as wpDeps } from "../../src/wp.js";
import { gbBuild, gbScript } from "../../src/gb.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { parseDesignTokens } from "../../src/schemas/design-tokens.js";
import type { GbNode } from "../../src/provision/elements.js";
import {
  BLOG_HERO_SLUG, BLOG_LOOP_SLUG, POST_HERO_SLUG, blogHeroTree, blogLoopTree, postHeroTree, rawGbBlock, installBlog, deps,
} from "../../src/provision/blog.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const tokens = parseDesignTokens(JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8")));
const ctx: SiteContext = { config: loadConfig(process.cwd()), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };
const blogPage = spec.sitemap.find((p) => p.kind === "blog")!;
const flat = (nodes: GbNode[]): GbNode[] => nodes.flatMap((n) => [n, ...flat(n.innerBlocks ?? [])]);
const noHex = (tree: unknown) => expect(JSON.stringify(tree)).not.toMatch(/#[0-9a-f]{6}\b/i);

describe("blogHeroTree", () => {
  const tree = blogHeroTree(blogPage, tokens);
  it("has exactly one h1 with the blog page title and the meta description as intro", () => {
    const all = flat(tree);
    expect(all.filter((n) => n.tagName === "h1").map((n) => n.content)).toEqual([blogPage.title]);
    expect(all.some((n) => n.tagName === "p" && n.content === blogPage.seo.metaDescription)).toBe(true);
    noHex(tree);
  });
  it("escapes spec text", () => {
    const amp = { ...blogPage, title: "Pain & actus" };
    expect(flat(blogHeroTree(amp, tokens)).find((n) => n.tagName === "h1")!.content).toBe("Pain &amp; actus");
  });
});

describe("blogLoopTree", () => {
  const tree = blogLoopTree(tokens);
  const all = flat(tree);
  it("inherits the main query and lays cards in a 3/2/1 column grid", () => {
    expect(tree[0]).toMatchObject({ type: "query", attrs: { inheritQuery: true } });
    const looper = all.find((n) => n.type === "looper")!;
    expect(looper.styles).toMatchObject({ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" });
    expect(looper.styles?.["@media (max-width:1024px)"]).toMatchObject({ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" });
    expect(looper.styles?.["@media (max-width:767px)"]).toMatchObject({ gridTemplateColumns: "1fr" });
    noHex(tree);
  });
  it("renders a card with image, category, date, linked h2 title, excerpt and an accessible read link", () => {
    const item = all.find((n) => n.type === "loop-item")!;
    const inner = flat([item]);
    expect(inner.find((n) => n.type === "media")!.htmlAttributes).toMatchObject({ src: "{{featured_image key:url|size:medium_large}}", alt: "{{featured_image key:alt}}" });
    const contents = inner.map((n) => n.content ?? "");
    expect(contents).toEqual(expect.arrayContaining(["{{term_list tax:category}}", "{{post_date}}", "{{post_title link:post}}", "{{post_excerpt length:20}}"]));
    expect(inner.find((n) => n.tagName === "h2")!.content).toBe("{{post_title link:post}}");
    const read = inner.find((n) => n.tagName === "a")!;
    expect(read.htmlAttributes).toEqual({ href: "{{post_permalink}}" });
    expect(read.content).toContain('<span class="screen-reader-text">');
    expect(all.filter((n) => n.tagName === "h1")).toHaveLength(0);
  });
  it("ends with raw no-results and page-numbers blocks whose attribute JSON never contains --", () => {
    const raws = all.filter((n) => n.type === "raw").map((n) => n.rawMarkup!);
    expect(raws).toHaveLength(2);
    expect(raws[0]).toContain("wp:generateblocks/query-no-results");
    expect(raws[0]).toContain("Aucun article pour le moment.");
    expect(raws[1]).toContain("wp:generateblocks/query-page-numbers");
    for (const r of raws) for (const comment of r.match(/<!--[\s\S]*?-->/g)!) expect(comment.slice(4, -3)).not.toContain("--");
  });
});

describe("rawGbBlock", () => {
  it("escapes -- in attributes and self-closes when there is no inner markup", () => {
    expect(rawGbBlock("generateblocks/x", { css: ".a{color:var(--accent)}" }, "")).toBe('<!-- wp:generateblocks/x {"css":".a{color:var(\\u002d\\u002daccent)}"} /-->');
    expect(rawGbBlock("generateblocks/x", {}, "<p>i</p>")).toBe("<!-- wp:generateblocks/x {} --><p>i</p><!-- /wp:generateblocks/x -->");
  });
});

describe("postHeroTree", () => {
  const all = flat(postHeroTree(tokens));
  it("shows category link and date, a single h1 title and the featured image in 16/9", () => {
    expect(all.filter((n) => n.tagName === "h1").map((n) => n.content)).toEqual(["{{post_title}}"]);
    expect(all.some((n) => (n.content ?? "").includes("{{term_list tax:category|link:true}}") && (n.content ?? "").includes("{{post_date}}"))).toBe(true);
    expect(all.find((n) => n.type === "media")!.styles).toMatchObject({ aspectRatio: "16/9", objectFit: "cover" });
    noHex(postHeroTree(tokens));
  });
});

describe("installBlog", () => {
  beforeEach(() => vi.restoreAllMocks());
  const argsOf = (spy: any) => spy.mock.calls.map((c: any) => (c[2] as string[]).slice(1).join(" "));
  function fakeWp() {
    let next = 20;
    return vi.spyOn(wpDeps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      const a = cmd.slice(1).join(" ");
      if (a.startsWith("post list --post_type=gp_elements")) return { stdout: "[]", stderr: "", code: 0 };
      if (a.startsWith("post create")) return { stdout: `${next++}\n`, stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
  }
  it("returns undefined and touches nothing without a blog page", async () => {
    const spy = fakeWp();
    const noBlog = parseSiteSpec({ ...spec, sitemap: spec.sitemap.filter((p) => p.kind !== "blog"), menus: { primary: spec.menus.primary.filter((s) => s !== blogPage.slug), footer: spec.menus.footer.filter((s) => s !== blogPage.slug) } });
    expect(await installBlog(ctx, noBlog, tokens)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
  it("upserts the three elements with their types, hooks, disable flags and conditions, then clears the css cache", async () => {
    vi.spyOn(deps, "gbBuild").mockResolvedValue("<!-- wp:generateblocks/element {} --><div>x</div><!-- /wp:generateblocks/element -->");
    const spy = fakeWp();
    expect(await installBlog(ctx, spec, tokens)).toEqual([20, 21, 22]);
    const a = argsOf(spy);
    expect(a).toEqual(expect.arrayContaining([
      `post create --post_type=gp_elements --post_status=publish --post_title=Faktory blog hero --post_name=${BLOG_HERO_SLUG} --porcelain`,
      "post meta update 20 _generate_block_type page-hero",
      "post meta update 20 _generate_hook generate_after_header",
      "post meta update 20 _generate_disable_title true",
      'post meta update 20 _generate_element_display_conditions [{"rule":"general:blog","object":""}] --format=json',
      `post create --post_type=gp_elements --post_status=publish --post_title=Faktory blog loop --post_name=${BLOG_LOOP_SLUG} --porcelain`,
      "post meta update 21 _generate_block_type loop-template",
      'post meta update 21 _generate_element_display_conditions [{"rule":"general:blog","object":""},{"rule":"taxonomy:category","object":""}] --format=json',
      `post create --post_type=gp_elements --post_status=publish --post_title=Faktory post hero --post_name=${POST_HERO_SLUG} --porcelain`,
      "post meta update 22 _generate_block_type page-hero",
      "post meta update 22 _generate_disable_featured_image true",
      "post meta update 22 _generate_disable_primary_post_meta true",
      'post meta update 22 _generate_element_display_conditions [{"rule":"post:post","object":""}] --format=json',
    ]));
    expect(a.at(-1)).toBe("option update generate_dynamic_css_output ");
  });
  it.skipIf(!existsSync(gbScript(ctx.config, "gb_build.py")))("compiles the three real trees with gb_build.py (python3)", async () => {
    const loop = await gbBuild(ctx.config, blogLoopTree(tokens));
    expect(loop).toContain("wp:generateblocks/query");
    expect(loop).toContain('"inheritQuery":true');
    expect(loop).toContain("wp:generateblocks/loop-item");
    expect(loop).toContain("{{post_title link:post}}");
    expect(loop).toContain("wp:generateblocks/query-page-numbers");
    expect(await gbBuild(ctx.config, blogHeroTree(blogPage, tokens))).toContain("<h1");
    expect(await gbBuild(ctx.config, postHeroTree(tokens))).toContain("{{post_title}}");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/provision-blog.test.ts`
Expected: FAIL — cannot find module `blog.js`.

- [ ] **Step 3: Implement `blog.ts`**

Create `src/provision/blog.ts`:

```ts
import type { SiteContext } from "../docker.js";
import { wpOk } from "../wp.js";
import { gbBuild } from "../gb.js";
import type { Page, SiteSpec } from "../schemas/site-spec.js";
import type { DesignTokens } from "../schemas/design-tokens.js";
import { MOBILE, TABLET, esc, stepper, text, upsertBlockElement, type GbNode } from "./elements.js";

export const deps = { gbBuild };
export const BLOG_HERO_SLUG = "faktory-blog-hero";
export const BLOG_LOOP_SLUG = "faktory-blog-loop";
export const POST_HERO_SLUG = "faktory-post-hero";

const container = { maxWidth: "var(--gb-container-width)", marginLeft: "auto", marginRight: "auto" };
const focusRing = { outline: "2px solid var(--accent)", outlineOffset: "3px" };

/** A GenerateBlocks block written by hand; `--` is forbidden inside block comments, so it is escaped as gb_build.py does. */
export function rawGbBlock(name: string, attrs: Record<string, unknown>, inner: string): string {
  const json = JSON.stringify(attrs).replace(/--/g, "\\u002d\\u002d");
  return inner ? `<!-- wp:${name} ${json} -->${inner}<!-- /wp:${name} -->` : `<!-- wp:${name} ${json} /-->`;
}

/** Posts page header: the page's only h1 and its meta description as a visitor-facing intro. */
export function blogHeroTree(page: Page, tokens: DesignTokens): GbNode[] {
  const step = stepper(tokens);
  return [{
    type: "element", tagName: "section", styles: {
      backgroundColor: "var(--base-2)", padding: `${tokens.sectionPadding.desktop}px 24px`,
      [MOBILE]: { padding: `${tokens.sectionPadding.mobile}px 16px` },
    }, innerBlocks: [{
      type: "element", tagName: "div", styles: { ...container }, innerBlocks: [
        text("h1", esc(page.title), { marginBottom: `${step(3)}px` }),
        text("p", esc(page.seo.metaDescription), { fontSize: "20px", color: "var(--contrast-2)", maxWidth: "60ch", marginBottom: "0", [MOBILE]: { fontSize: "18px" } }),
      ],
    }],
  }];
}

/** Archive loop: a card grid on the main query, empty state and page numbers. */
export function blogLoopTree(tokens: DesignTokens): GbNode[] {
  const step = stepper(tokens);
  const radius = `${tokens.radius}px`;

  const card: GbNode = {
    type: "loop-item", tagName: "article", styles: {
      display: "flex", flexDirection: "column", backgroundColor: "var(--base-3)", border: "1px solid var(--contrast-3)", borderRadius: radius,
      overflow: "hidden", transition: "transform 150ms ease, box-shadow 150ms ease",
      "&:hover": { transform: "translateY(-2px)", boxShadow: "0 8px 24px color-mix(in srgb, var(--contrast) 12%, transparent)" },
      "&:focus-within": focusRing,
    }, innerBlocks: [
      { type: "media", tagName: "img", htmlAttributes: { src: "{{featured_image key:url|size:medium_large}}", alt: "{{featured_image key:alt}}", loading: "lazy" },
        styles: { display: "block", width: "100%", height: "auto", aspectRatio: "3/2", objectFit: "cover", backgroundColor: "var(--base-2)" } },
      { type: "element", tagName: "div", styles: { display: "flex", flexDirection: "column", gap: `${step(2)}px`, padding: `${step(4)}px`, flexGrow: "1" }, innerBlocks: [
        text("p", "{{term_list tax:category}}", { fontSize: "13px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", margin: "0" }),
        text("h2", "{{post_title link:post}}", { fontSize: `${tokens.type.h4}px`, lineHeight: "1.25", margin: "0", "& a": { color: "var(--contrast)", textDecoration: "none" }, "& a:hover": { color: "var(--accent)" } }),
        text("p", "{{post_date}}", { fontSize: "14px", color: "var(--contrast-2)", margin: "0" }),
        text("p", "{{post_excerpt length:20}}", { margin: "0", flexGrow: "1" }),
        text("a", 'Lire l\'article<span class="screen-reader-text"> : {{post_title}}</span>', {
          alignSelf: "flex-start", fontWeight: "600", color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "3px",
          "&:hover": { color: "var(--contrast)" }, "&:focus-visible": focusRing,
        }, { href: "{{post_permalink}}" }),
      ] },
    ],
  };

  const noResults: GbNode = { type: "raw", rawMarkup: rawGbBlock(
    "generateblocks/query-no-results", { uniqueId: "fkblognr", tagName: "div" },
    '<div class="gb-query-no-results gb-query-no-results-fkblognr">'
      + rawGbBlock("generateblocks/text", { uniqueId: "fkblognt", tagName: "p", css: ".gb-text-fkblognt{text-align:center;color:var(--contrast-2)}" },
        '<p class="gb-text gb-text-fkblognt">Aucun article pour le moment.</p>')
      + "</div>",
  ) };

  const pageNumbersCss = [
    `.gb-query-page-numbers-fkblogpn{display:flex;flex-wrap:wrap;justify-content:center;gap:${step(2)}px;margin-top:${step(6)}px}`,
    `.gb-query-page-numbers-fkblogpn .page-numbers{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0 ${step(2)}px;border:1px solid var(--contrast-3);border-radius:${radius};color:var(--contrast);text-decoration:none}`,
    ".gb-query-page-numbers-fkblogpn .page-numbers.current{background-color:var(--accent);border-color:var(--accent);color:var(--base-3)}",
    ".gb-query-page-numbers-fkblogpn a.page-numbers:hover{border-color:var(--accent);color:var(--accent)}",
  ].join("");
  const pageNumbers: GbNode = { type: "raw", rawMarkup: rawGbBlock(
    "generateblocks/query-page-numbers", { uniqueId: "fkblogpn", tagName: "div", css: pageNumbersCss },
    '<div class="gb-query-page-numbers gb-query-page-numbers-fkblogpn"></div>',
  ) };

  return [{
    type: "query", tagName: "div", attrs: { inheritQuery: true, query: {} }, styles: {
      ...container, padding: `${step(7)}px 24px`, [MOBILE]: { padding: `${step(5)}px 16px` },
    }, innerBlocks: [
      { type: "looper", tagName: "div", styles: {
        display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: `${step(5)}px`,
        [TABLET]: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
        [MOBILE]: { gridTemplateColumns: "1fr" },
      }, innerBlocks: [card] },
      noResults,
      pageNumbers,
    ],
  }];
}

/** Single post header: category + date, the only h1, featured image in 16/9. */
export function postHeroTree(tokens: DesignTokens): GbNode[] {
  const step = stepper(tokens);
  return [{
    type: "element", tagName: "section", styles: { backgroundColor: "var(--base)", padding: `${step(7)}px 24px ${step(5)}px`, [MOBILE]: { padding: `${step(5)}px 16px ${step(4)}px` } },
    innerBlocks: [{
      type: "element", tagName: "div", styles: { maxWidth: "760px", marginLeft: "auto", marginRight: "auto" }, innerBlocks: [
        text("p", "{{term_list tax:category|link:true}} · {{post_date}}", {
          fontSize: "14px", color: "var(--contrast-2)", marginBottom: `${step(3)}px`,
          "& a": { color: "var(--accent)", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "13px" },
          "& a:hover": { textDecoration: "underline" },
        }),
        text("h1", "{{post_title}}", { marginBottom: `${step(5)}px` }),
        { type: "media", tagName: "img", htmlAttributes: { src: "{{featured_image key:url|size:large}}", alt: "{{featured_image key:alt}}" },
          styles: { display: "block", width: "100%", height: "auto", aspectRatio: "16/9", objectFit: "cover", borderRadius: `${tokens.radius}px`, backgroundColor: "var(--base-2)" } },
      ],
    }],
  }];
}

const HERO_META = { _generate_block_type: "page-hero", _generate_hook: "generate_after_header" };

/** Blog archive hero + loop template and single post hero, as GP Premium block elements. No blog page → nothing. */
export async function installBlog(ctx: SiteContext, spec: SiteSpec, tokens: DesignTokens): Promise<number[] | undefined> {
  const page = spec.sitemap.find((p) => p.kind === "blog");
  if (!page) return undefined;
  const hero = await upsertBlockElement(ctx, {
    slug: BLOG_HERO_SLUG, title: "Faktory blog hero", markup: await deps.gbBuild(ctx.config, blogHeroTree(page, tokens)),
    meta: { ...HERO_META, _generate_disable_title: "true" },
    conditions: [{ rule: "general:blog", object: "" }],
  });
  const loop = await upsertBlockElement(ctx, {
    slug: BLOG_LOOP_SLUG, title: "Faktory blog loop", markup: await deps.gbBuild(ctx.config, blogLoopTree(tokens)),
    meta: { _generate_block_type: "loop-template" },
    conditions: [{ rule: "general:blog", object: "" }, { rule: "taxonomy:category", object: "" }],
  });
  const post = await upsertBlockElement(ctx, {
    slug: POST_HERO_SLUG, title: "Faktory post hero", markup: await deps.gbBuild(ctx.config, postHeroTree(tokens)),
    meta: { ...HERO_META, _generate_disable_title: "true", _generate_disable_featured_image: "true", _generate_disable_primary_post_meta: "true" },
    conditions: [{ rule: "post:post", object: "" }],
  });
  await wpOk(ctx, ["option", "update", "generate_dynamic_css_output", ""]);
  return [hero, loop, post];
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/provision-blog.test.ts && npm run typecheck`
Expected: PASS (the gb_build test runs when `plugin/skills/.../gb_build.py` exists), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/provision/blog.ts tests/unit/provision-blog.test.ts
git commit -m "feat(faktory): deterministic blog hero, card loop template and post hero elements"
```

---

### Task 6: Generated child theme — Gravity Forms styles (A4)

**Files:**
- Create: `src/provision/child-theme.ts`
- Test: `tests/unit/provision-child-theme.test.ts`

**Interfaces:**
- Consumes: `composeExec` from `src/docker.ts`; `DesignTokens`.
- Produces:
  - `gfStyles(t: DesignTokens): Record<string, string | number>`
  - `childThemeFunctions(slug: string, t: DesignTokens): string` — full PHP file.
  - `childThemeFunctionsPath(slug: string): string` — container path `/var/www/html/wp-content/themes/faktory-<slug>/functions.php`.
  - `installChildTheme(ctx, tokens): Promise<void>` — writes through `wpcli` then `php -l`; throws on failure.
  - `export const deps = { composeExec }`

Background: Gravity Forms 3.1 `GFFormDisplay::validate_form_styles` accepts an array or a JSON string from `gform_default_styles`; whitelisted keys used here: `theme`, `inputSize`, `inputBorderRadius`, `inputBorderColor`, `inputBackgroundColor`, `inputColor`, `inputPrimaryColor`, `labelColor`, `descriptionColor`, `buttonPrimaryBackgroundColor`, `buttonPrimaryColor`. The current scaffolded `functions.php` only enqueues the parent and child `style.css` with handles `generatepress-style` and `faktory-<slug>-style`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/provision-child-theme.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { parseDesignTokens } from "../../src/schemas/design-tokens.js";
import { childThemeFunctions, childThemeFunctionsPath, gfStyles, installChildTheme, deps } from "../../src/provision/child-theme.js";

const tokens = parseDesignTokens(JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8")));
const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "boulangerie-e2e", siteDir: "/tmp/fk/sites/boulangerie-e2e", state: createState("boulangerie-e2e", 8100, "pw") };

describe("gfStyles", () => {
  it("maps the tokens onto Orbital's style keys", () => {
    const p = tokens.palette;
    expect(gfStyles(tokens)).toEqual({
      theme: "orbital", inputSize: "md", inputBorderRadius: tokens.radius,
      inputBorderColor: p.contrast3, inputBackgroundColor: p.base3, inputColor: p.contrast, inputPrimaryColor: p.accent,
      labelColor: p.contrast, descriptionColor: p.contrast2,
      buttonPrimaryBackgroundColor: p.accent, buttonPrimaryColor: p.base3,
    });
  });
});

describe("childThemeFunctions", () => {
  const php = childThemeFunctions("boulangerie-e2e", tokens);
  it("keeps the parent/child enqueue with slug-safe function names", () => {
    expect(php.startsWith("<?php\n")).toBe(true);
    expect(php).toContain("Generated by Faktory");
    expect(php).toContain("function faktory_boulangerie_e2e_enqueue_styles()");
    expect(php).toContain("'generatepress-style', get_template_directory_uri() . '/style.css'");
    expect(php).toContain("'faktory-boulangerie-e2e-style', get_stylesheet_directory_uri() . '/style.css'");
  });
  it("returns the GF styles from gform_default_styles as decoded JSON", () => {
    expect(php).toContain("add_filter( 'gform_default_styles', 'faktory_boulangerie_e2e_gform_default_styles' );");
    expect(php).toContain(`return json_decode( '${JSON.stringify(gfStyles(tokens))}', true );`);
  });
  it("sets the GF font and the single post reading width in inline css", () => {
    expect(php).toContain(`.gform-theme--framework{--gf-font-family:"${tokens.fonts.body.family}", sans-serif;}`);
    expect(php).toContain(".single-post .entry-content{max-width:760px;margin-left:auto;margin-right:auto;}");
    expect(php).toContain("wp_add_inline_style( 'faktory-boulangerie-e2e-style',");
  });
  it("escapes quotes and backslashes in injected strings", () => {
    const odd = { ...tokens, fonts: { ...tokens.fonts, body: { ...tokens.fonts.body, family: `O'Brien\\Sans "X"` } } };
    const out = childThemeFunctions("demo", odd);
    expect(out).toContain(`--gf-font-family:"O\\'BrienSans X", sans-serif;`);
  });
});

describe("installChildTheme", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("writes the file through the wpcli container, then lints it", async () => {
    const spy = vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "No syntax errors detected", stderr: "", code: 0 });
    await installChildTheme(ctx, tokens);
    const path = childThemeFunctionsPath("boulangerie-e2e");
    expect(path).toBe("/var/www/html/wp-content/themes/faktory-boulangerie-e2e/functions.php");
    expect(spy.mock.calls[0][1]).toBe("wpcli");
    expect(spy.mock.calls[0][2]).toEqual(["sh", "-c", `cat > ${path}`]);
    expect(spy.mock.calls[0][3]?.input).toBe(childThemeFunctions("boulangerie-e2e", tokens));
    expect(spy.mock.calls[1][2]).toEqual(["php", "-l", path]);
  });
  it("throws with the linter output when the file does not parse", async () => {
    vi.spyOn(deps, "composeExec")
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "PHP Parse error: syntax error", stderr: "", code: 255 });
    await expect(installChildTheme(ctx, tokens)).rejects.toThrow(/php -l .*syntax error/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/provision-child-theme.test.ts`
Expected: FAIL — cannot find module `child-theme.js`.

- [ ] **Step 3: Implement**

Create `src/provision/child-theme.ts`:

```ts
import { composeExec, type SiteContext } from "../docker.js";
import type { DesignTokens } from "../schemas/design-tokens.js";

export const deps = { composeExec };

export const childThemeFunctionsPath = (slug: string): string => `/var/www/html/wp-content/themes/faktory-${slug}/functions.php`;

/** Gravity Forms Orbital style settings from the tokens (GF only accepts hex values here). */
export function gfStyles(t: DesignTokens): Record<string, string | number> {
  const p = t.palette;
  return {
    theme: "orbital", inputSize: "md", inputBorderRadius: t.radius,
    inputBorderColor: p.contrast3, inputBackgroundColor: p.base3, inputColor: p.contrast, inputPrimaryColor: p.accent,
    labelColor: p.contrast, descriptionColor: p.contrast2,
    buttonPrimaryBackgroundColor: p.accent, buttonPrimaryColor: p.base3,
  };
}

/** Single-quoted PHP string body: only `\` and `'` need escaping. */
const phpQuote = (s: string): string => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** The child theme's whole functions.php, regenerated on every provision. */
export function childThemeFunctions(slug: string, t: DesignTokens): string {
  const fn = `faktory_${slug.replace(/[^a-z0-9]/g, "_")}`;
  const handle = `faktory-${slug}-style`;
  const font = t.fonts.body.family.replace(/["\\]/g, "");
  const css = `.gform-theme--framework{--gf-font-family:"${font}", sans-serif;}`
    + ".single-post .entry-content{max-width:760px;margin-left:auto;margin-right:auto;}";
  return `<?php
/**
 * Generated by Faktory from design-tokens.json — do not edit: every provision rewrites this file.
 *
 * @package faktory-${slug}
 */

add_action( 'wp_enqueue_scripts', '${fn}_enqueue_styles' );

/**
 * Parent and child stylesheets, plus the token-driven inline CSS.
 */
function ${fn}_enqueue_styles() {
	wp_enqueue_style( 'generatepress-style', get_template_directory_uri() . '/style.css', array(), '0.1.0' );
	wp_enqueue_style( '${handle}', get_stylesheet_directory_uri() . '/style.css', array( 'generatepress-style' ), '0.1.0' );
	wp_add_inline_style( '${handle}', '${phpQuote(css)}' );
}

add_filter( 'gform_default_styles', '${fn}_gform_default_styles' );

/**
 * Gravity Forms Orbital theme settings from the design tokens.
 *
 * @return array
 */
function ${fn}_gform_default_styles() {
	return json_decode( '${phpQuote(JSON.stringify(gfStyles(t)))}', true );
}
`;
}

/** Write functions.php inside the wpcli container (same owner as WordPress files), then lint it. */
export async function installChildTheme(ctx: SiteContext, tokens: DesignTokens): Promise<void> {
  const path = childThemeFunctionsPath(ctx.slug);
  const write = await deps.composeExec(ctx, "wpcli", ["sh", "-c", `cat > ${path}`], { input: childThemeFunctions(ctx.slug, tokens) });
  if (write.code !== 0) throw new Error(`writing ${path} failed: ${(write.stderr || write.stdout).trim()}`);
  const lint = await deps.composeExec(ctx, "wpcli", ["php", "-l", path]);
  if (lint.code !== 0) throw new Error(`php -l ${path} failed: ${(lint.stderr || lint.stdout).trim()}`);
}
```

Slugs are validated by `SLUG_RE` in `src/workspace.ts` (lowercase letters, digits, dashes), so `path` is shell-safe.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/provision-child-theme.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/provision/child-theme.ts tests/unit/provision-child-theme.test.ts
git commit -m "feat(faktory): generated child theme — Gravity Forms Orbital styles, form font, single post width"
```

---

### Task 7: French language packs (A5)

**Files:**
- Modify: `src/provision/stack.ts`
- Test: `tests/unit/provision-stack.test.ts`

**Interfaces:**
- Consumes: `runWp` from `src/wp.ts`.
- Produces: `LANGUAGE_PLUGINS = ["generateblocks", "wordpress-seo"] as const`; `installLanguagePacks(ctx): Promise<string[]>` — returns one warning line per failed command, never throws.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/provision-stack.test.ts` (add `installLanguagePacks` to the existing import from `../../src/provision/stack.js`; the file already builds a `ctx` and mocks `deps.composeExec` from `src/wp.ts` — reuse its helpers if present, else use this self-contained block):

```ts
describe("installLanguagePacks", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("installs fr_FR for GeneratePress and the wordpress.org plugins", async () => {
    const spy = vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "Success", stderr: "", code: 0 });
    expect(await installLanguagePacks(ctx)).toEqual([]);
    expect(spy.mock.calls.map((c) => (c[2] as string[]).slice(1).join(" "))).toEqual([
      "language theme install generatepress fr_FR",
      "language plugin install generateblocks wordpress-seo fr_FR",
    ]);
  });
  it("returns a warning instead of throwing when the translation server fails", async () => {
    vi.spyOn(deps, "composeExec")
      .mockResolvedValueOnce({ stdout: "", stderr: "Warning: x\nError: Could not reach translate.wordpress.org", code: 1 })
      .mockResolvedValueOnce({ stdout: "Success", stderr: "", code: 0 });
    expect(await installLanguagePacks(ctx)).toEqual(["language theme install generatepress fr_FR: Error: Could not reach translate.wordpress.org"]);
  });
});
```

If `tests/unit/provision-stack.test.ts` does not already import `beforeEach`, `vi`, `deps` (from `../../src/wp.js`) and define `ctx`, add them at the top in the same shape as `tests/unit/provision-core.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/provision-stack.test.ts`
Expected: FAIL — `installLanguagePacks` is not exported.

- [ ] **Step 3: Implement**

In `src/provision/stack.ts`, change the wp import to `import { runWp, wpOk, wpJson } from "../wp.js";` and append:

```ts
/** wordpress.org plugins with French packs; the commercial ones (GP Premium, GF) ship their own. */
export const LANGUAGE_PLUGINS = ["generateblocks", "wordpress-seo"] as const;

/**
 * fr_FR packs for the theme and plugins (GeneratePress's own strings, e.g. the "by" of post meta).
 * Best-effort: a translation server failure must not block a run, it is reported in the provision summary.
 */
export async function installLanguagePacks(ctx: SiteContext): Promise<string[]> {
  const warnings: string[] = [];
  for (const args of [["language", "theme", "install", "generatepress", "fr_FR"], ["language", "plugin", "install", ...LANGUAGE_PLUGINS, "fr_FR"]]) {
    const r = await runWp(ctx, args);
    if (r.code !== 0) warnings.push(`${args.join(" ")}: ${(r.stderr || r.stdout).trim().split("\n").at(-1)}`);
  }
  return warnings;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/provision-stack.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/provision/stack.ts tests/unit/provision-stack.test.ts
git commit -m "feat(faktory): best-effort fr_FR language packs for GeneratePress, GenerateBlocks and Yoast"
```

---

### Task 8: QA check for untranslated English strings

**Files:**
- Modify: `src/qa/inpage.ts`, `src/qa/browser.ts`, `src/schemas/qa.ts`, `src/qa/report.ts`, `src/prompts/qa.md`, `fixtures/qa/contact.check.json`, `fixtures/qa/report.json`
- Test: `tests/unit/qa-schema.test.ts`, `tests/unit/qa-browser.test.ts`, `tests/unit/qa-report.test.ts`

**Interfaces:**
- Produces: `InPageResult.untranslated: string[]`; `PageCheck.untranslated: string[]` (schema default `[]`, so stored checks from earlier runs still parse); `checkIssues` appends `textes anglais non traduits : <list>` as the last line; report table row `| Textes non traduits | N |`.

- [ ] **Step 1: Update fixtures**

Run:

```bash
node -e '
const fs=require("fs");
const c=JSON.parse(fs.readFileSync("fixtures/qa/contact.check.json","utf8"));
const out={};for(const [k,v] of Object.entries(c)){out[k]=v;if(k==="h1Count")out.untranslated=[];}
fs.writeFileSync("fixtures/qa/contact.check.json",JSON.stringify(out,null,2)+"\n");
const r=JSON.parse(fs.readFileSync("fixtures/qa/report.json","utf8"));
for(const p of r.pages){const o={};for(const [k,v] of Object.entries(p.check)){o[k]=v;if(k==="h1Count")o.untranslated=[];}p.check=o;}
fs.writeFileSync("fixtures/qa/report.json",JSON.stringify(r,null,2)+"\n");
'
git diff --stat fixtures/qa
```

Expected: both files changed; `git diff fixtures/qa` shows only added `"untranslated": []` lines (if the report file's original indentation differs from 2 spaces, the diff will be larger; that is acceptable only if the JSON content is otherwise identical — check with `git diff -w`).

- [ ] **Step 2: Write the failing tests**

In `tests/unit/qa-schema.test.ts`, in the test that builds `c` with `status: 500 …`, add `untranslated: ["by", "Read more"],` to the object literal, and append to the expected `checkIssues(c)` array after `"débordement horizontal en mobile",`:

```ts
      "textes anglais non traduits : by, Read more",
```

Add a test in the same file's page check `describe`:

```ts
  it("accepts a stored check without untranslated (earlier runs) and defaults it to []", () => {
    const { untranslated: _u, ...old } = check();
    expect(parsePageCheck(old).untranslated).toEqual([]);
  });
```

In `tests/unit/qa-browser.test.ts`, change the fixture page's first line of body from `<h1>Un</h1><h1>Deux</h1>` to:

```ts
<h1>Un</h1><h1>Deux</h1><p class="byline">by admin — Read more</p><p>Baby by-pass</p>
```

and add in `"collects every check field and writes the screenshots"`:

```ts
      expect(check.untranslated).toEqual(["by", "Read more"]);
```

In `tests/unit/qa-report.test.ts`, find the test asserting the markdown table and add:

```ts
    expect(md).toContain("| Textes non traduits | 0 |");
```

(use the variable name that test already uses for the rendered markdown).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/qa-schema.test.ts tests/unit/qa-browser.test.ts tests/unit/qa-report.test.ts`
Expected: FAIL on the new expectations (qa-browser only runs when Chromium is installed).

- [ ] **Step 4: Implement**

`src/qa/inpage.ts`:
- Change the type to `export type InPageResult = { unstyledBlocks: string[]; brokenImages: string[]; missingAlt: number; h1Count: number; links: string[]; untranslated: string[] };`
- Add above `inPageAudit`:

```ts
/** English strings WordPress/GeneratePress print when a French language pack is missing (inlined in inPageAudit). */
export const UNTRANSLATED = ["by", "Read more", "Leave a Comment", "Posted in"];
```

- Inside `inPageAudit`, before `return`:

```ts
  const words = ["by", "Read more", "Leave a Comment", "Posted in"];
  const bodyText = document.body.innerText;
  // "by" only as a lowercase standalone word, not inside "Baby" or "by-pass"
  const untranslated = words.filter((w) => new RegExp(`(^|[\\s(])${w}(?=[\\s:.,)]|$)`).test(bodyText));
```

- Return `{ unstyledBlocks, brokenImages, missingAlt, h1Count, links, untranslated }`.

`src/qa/browser.ts`: in the `check` object add `untranslated: audit.untranslated,` after `h1Count: audit.h1Count,`.

`src/schemas/qa.ts`:
- In `PageCheckSchema`, after `h1Count`, add `untranslated: z.array(z.string()).default([]),`.
- In `checkIssues`, after the `mobileOverflow` line, add:

```ts
  if (c.untranslated.length) out.push(`textes anglais non traduits : ${c.untranslated.join(", ")}`);
```

`src/qa/report.ts`: after the `| h1 | … |` line add `` `| Textes non traduits | ${c.untranslated.length} |`, ``.

`src/prompts/qa.md`: on line 7 change `(console, requêtes, liens, images, blocs sans CSS, \`h1\`, débordement mobile)` to `(console, requêtes, liens, images, blocs sans CSS, \`h1\`, débordement mobile, textes anglais non traduits)`, and add this bullet under the list of things left to a person (the list that contains items outside the page tree):

```md
- Les textes anglais non traduits (`by`, `Read more`…) : ils viennent du thème ou d'une extension, pas de l'arbre ; laisse-les (`left`).
```

- [ ] **Step 5: Run the QA unit tests and typecheck**

Run: `npx vitest run tests/unit/qa-schema.test.ts tests/unit/qa-browser.test.ts tests/unit/qa-report.test.ts tests/unit/qa-review.test.ts tests/unit/stage-qa.test.ts tests/unit/prompts.test.ts && npm run typecheck`
Expected: PASS. `PageCheck` is `z.infer` (output type), so `untranslated` is `string[]`; any test object literal typed `PageCheck` missing the field now fails typecheck — add `untranslated: []` to it.

- [ ] **Step 6: Commit**

```bash
git add src/qa src/schemas/qa.ts src/prompts/qa.md fixtures/qa tests/unit/qa-schema.test.ts tests/unit/qa-browser.test.ts tests/unit/qa-report.test.ts
git commit -m "feat(faktory): qa flags untranslated English theme strings as an automatic defect"
```

---

### Task 9: Wire the provision stage

**Files:**
- Modify: `src/stages/provision.ts`
- Test: `tests/unit/stage-provision.test.ts`

**Interfaces:**
- Consumes: `installLanguagePacks` (Task 7), `installChildTheme` (Task 6), `installBlog` (Task 5), existing steps.
- Produces: execution order `composeUp → waitForDb → installCore → installStack → installLanguagePacks → applyIdentity → ensurePages → ensureMenus → applyTokens → installChildTheme → installFooter → installBlog`. Summary parts, in this order: install state, `installed: …`, `missing vendor zips: …` (if any), `fr_FR packs: ok` | `fr_FR packs: warn (…)`, pages/menu, `tokens applied`, `child theme styles`, `footer element #N` | `footer skipped: gp-premium zip missing`, `blog elements #A #B #C` | `blog elements skipped: no blog page` (the blog part is omitted when the footer is skipped for gp-premium).

- [ ] **Step 1: Write the failing tests**

In `tests/unit/stage-provision.test.ts`, extend `mockInfra()`'s returned object with:

```ts
    languages: vi.spyOn(deps, "installLanguagePacks").mockResolvedValue([]),
    childTheme: vi.spyOn(deps, "installChildTheme").mockResolvedValue(undefined),
    blog: vi.spyOn(deps, "installBlog").mockResolvedValue([51, 52, 53]),
```

Replace the test `"applies identity, pages, menus, tokens and footer in order when both artifacts exist"` with:

```ts
  it("runs every step in order and summarises them when both artifacts exist", async () => {
    const m = mockInfra();
    const order: string[] = [];
    m.core.mockImplementation(async () => { order.push("core"); return { freshInstall: false }; });
    m.stack.mockImplementation(async () => { order.push("stack"); return { installed: [], missingVendor: [] }; });
    m.languages.mockImplementation(async () => { order.push("languages"); return []; });
    m.identity.mockImplementation(async () => { order.push("identity"); });
    m.pages.mockImplementation(async () => { order.push("pages"); return { accueil: 1 }; });
    m.menus.mockImplementation(async () => { order.push("menus"); });
    m.tokens.mockImplementation(async () => { order.push("tokens"); });
    m.childTheme.mockImplementation(async () => { order.push("childTheme"); });
    m.footer.mockImplementation(async () => { order.push("footer"); return 42; });
    m.blog.mockImplementation(async () => { order.push("blog"); return [51, 52, 53]; });
    const msg = await provisionStage.run(await ctx({ spec: true, tokens: true }));
    expect(order).toEqual(["core", "stack", "languages", "identity", "pages", "menus", "tokens", "childTheme", "footer", "blog"]);
    expect(m.core.mock.calls[0][1]).toEqual({ title: "Maison Rivet" });
    expect(msg).toMatch(/fr_FR packs: ok; 1 page \+ primary menu; tokens applied; child theme styles; footer element #42; blog elements #51 #52 #53$/);
  });
  it("reports language pack warnings and a sitemap without blog page", async () => {
    const m = mockInfra();
    m.languages.mockResolvedValue(["language theme install generatepress fr_FR: Error: offline"]);
    m.blog.mockResolvedValue(undefined);
    const msg = await provisionStage.run(await ctx({ spec: true, tokens: true }));
    expect(msg).toContain("fr_FR packs: warn (language theme install generatepress fr_FR: Error: offline)");
    expect(msg).toContain("blog elements skipped: no blog page");
  });
```

In `"skips spec/tokens steps when the artifacts are missing (demo site)"` add `expect(m.childTheme).not.toHaveBeenCalled(); expect(m.blog).not.toHaveBeenCalled(); expect(m.languages).toHaveBeenCalled();`.

In `"skips the footer when gp-premium is missing, even with spec and tokens"` add `expect(m.blog).not.toHaveBeenCalled(); expect(m.childTheme).toHaveBeenCalled();`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/stage-provision.test.ts`
Expected: FAIL — `installLanguagePacks` is not a property of `deps`.

- [ ] **Step 3: Implement**

Replace `src/stages/provision.ts` with:

```ts
import type { Stage } from "../pipeline.js";
import { composeUp } from "../docker.js";
import { waitForDb } from "../wp.js";
import { installCore } from "../provision/core.js";
import { installStack, installLanguagePacks } from "../provision/stack.js";
import { applyIdentity, applyTokens } from "../provision/settings.js";
import { ensurePages, ensureMenus } from "../provision/pages.js";
import { installFooter } from "../provision/footer.js";
import { installChildTheme } from "../provision/child-theme.js";
import { installBlog } from "../provision/blog.js";
import { hasArtifact, readJsonArtifact } from "../artifacts.js";
import { parseSiteSpec } from "../schemas/site-spec.js";
import { parseDesignTokens } from "../schemas/design-tokens.js";

export const deps = { composeUp, waitForDb, installCore, installStack, installLanguagePacks, applyIdentity, ensurePages, ensureMenus, applyTokens, installChildTheme, installFooter, installBlog };

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
    const languageWarnings = await deps.installLanguagePacks(ctx);
    parts.push(languageWarnings.length ? `fr_FR packs: warn (${languageWarnings.join("; ")})` : "fr_FR packs: ok");

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
      await deps.installChildTheme(ctx, tokens);
      parts.push("child theme styles");
    } else {
      parts.push("no design-tokens.json: tokens/footer skipped");
    }
    if (spec && tokens) {
      if (stack.missingVendor.includes("gp-premium")) {
        parts.push("footer skipped: gp-premium zip missing");
      } else {
        const id = await deps.installFooter(ctx, spec, tokens);
        parts.push(`footer element #${id}`);
        const blog = await deps.installBlog(ctx, spec, tokens);
        parts.push(blog ? `blog elements #${blog.join(" #")}` : "blog elements skipped: no blog page");
      }
    }
    return parts.join("; ");
  },
};
```

- [ ] **Step 4: Run the whole unit suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all unit tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/stages/provision.ts tests/unit/stage-provision.test.ts
git commit -m "feat(faktory): provision runs language packs, child theme styles and blog elements"
```

---

### Task 10: Docker integration test

**Files:**
- Modify: `tests/integration/provision-chrome.test.ts`

**Interfaces:**
- Consumes: everything above; `runWp`, `wpOk`, `wpJson` from `src/wp.ts`; element slugs from `blog.ts` and `footer.ts`.

Prerequisites: Docker running; `docker/vendor/` contains the GP Premium, GB Pro, Gravity Forms and GF CLI zips (the existing test already needs GP Premium for the footer).

- [ ] **Step 1: Extend the test**

In `tests/integration/provision-chrome.test.ts`:

1. Change the imports to:

```ts
import { runWp, wpJson, wpOk } from "../../src/wp.js";
import { artifactPath } from "../../src/artifacts.js";
import { FOOTER_ELEMENT_SLUG } from "../../src/provision/footer.js";
import { BLOG_HERO_SLUG, BLOG_LOOP_SLUG, POST_HERO_SLUG } from "../../src/provision/blog.js";
```

2. Replace the summary regex line with:

```ts
    expect(s1.stages.provision.message).toMatch(/fr_FR packs: ok; 6 pages \+ primary menu; tokens applied; child theme styles; footer element #\d+; blog elements #\d+ #\d+ #\d+/);
```

3. Replace both element-list assertions (`expect(elements.map(...)).toEqual([FOOTER_ELEMENT_SLUG]);` and `expect(elements2).toHaveLength(1);`) with:

```ts
    expect(elements.map((e) => e.post_name).sort()).toEqual([BLOG_HERO_SLUG, BLOG_LOOP_SLUG, FOOTER_ELEMENT_SLUG, POST_HERO_SLUG].sort());
```

and

```ts
    expect(elements2).toHaveLength(4);
```

4. After the existing `html` assertions (before `const s2 = …`), add:

```ts
    const base = `http://localhost:${ctx.state.port}`;
    const gpOption = async (key: string) => wpOk(ctx, ["eval", `echo generate_get_option( '${key}' );`]);
    expect(await gpOption("structure")).toBe("flexbox");
    expect(await wpOk(ctx, ["option", "get", "generate_db_version"])).toMatch(/^3\./);
    expect(html).toMatch(/font-family:[^;}]*Fraunces/);
    expect(html).toMatch(/font-family:[^;}]*Source Sans 3/);
    expect(html).not.toContain("#efefef");
    expect(html).not.toContain("#1e73be");

    expect((await runWp(ctx, ["language", "theme", "is-installed", "generatepress", "fr_FR"])).code).toBe(0);
    const gf = await wpOk(ctx, ["eval", "echo wp_json_encode( apply_filters( 'gform_default_styles', false ) );"]);
    expect(JSON.parse(gf)).toMatchObject({ theme: "orbital", inputPrimaryColor: "#7a8b6f" });
    expect((await runWp(ctx, ["eval", "echo 1;"])).code).toBe(0); // child theme functions.php loads

    await wpOk(ctx, ["post", "generate", "--count=10", "--post_type=post", "--post_status=publish"]);
    const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
    const blog = await (await fetch(`${base}/actualites/`)).text();
    expect(count(blog, /<h1[\s>]/g)).toBe(1);
    expect(count(blog, /class="gb-loop-item gb-loop-item-/g)).toBe(9);
    expect(blog).toContain(`${base}/actualites/page/2/`);
    expect(blog).not.toContain('class="byline"');
    const page2 = await (await fetch(`${base}/actualites/page/2/`)).text();
    expect(count(page2, /class="gb-loop-item gb-loop-item-/g)).toBe(1);
    const postUrl = (await wpJson<{ url: string }[]>(ctx, ["post", "list", "--post_type=post", "--posts_per_page=1", "--fields=url"]))[0].url;
    const post = await (await fetch(postUrl)).text();
    expect(count(post, /<h1[\s>]/g)).toBe(1);
    expect(post).not.toContain('class="byline"');

    // Repair: simulate the phase 7 legacy state, let GP migrate it on a page load, then provision again.
    await wpOk(ctx, ["option", "delete", "generate_db_version"]);
    await wpOk(ctx, ["option", "update", "generate_settings", "--format=json"], { input: JSON.stringify({ background_color: "#efefef" }) });
    await fetch(`${base}/`);
    expect(await gpOption("structure")).toBe("floats");
```

5. After `const s2 = await runSite(config, "itchrome", { only: "provision" });` and its status assertion, add:

```ts
    expect(await gpOption("structure")).toBe("flexbox");
    const repaired = await (await fetch(`${base}/`)).text();
    expect(repaired).not.toContain("#efefef");
    expect(repaired).toMatch(/font-family:[^;}]*Fraunces/);
```

6. The fixture `pages2` assertion stays `6` (posts are `post`, not `page`).

- [ ] **Step 2: Run it**

Run: `FAKTORY_DOCKER=1 npx vitest run tests/integration/provision-chrome.test.ts --testTimeout=600000 --hookTimeout=600000`
Expected: PASS (≈ 3–5 min).

If an assertion fails, diagnose against the running stack before changing code — the test's `afterAll` destroys the site, so temporarily comment out `destroySite` in `afterAll`, rerun, and inspect with `docker compose -p faktory-itchrome exec -T wpcli wp …` and `curl http://localhost:8193/actualites/`. Likely culprits and the checks to run:
- no `font-family` in CSS → `wp eval 'echo GeneratePress_Typography::get_css();'`;
- 0 loop items → `wp post get <loop element id> --field=post_content` and confirm `"inheritQuery":true` and that the element's `_generate_block_type` is `loop-template`;
- page numbers missing → confirm `wp option get posts_per_page` is `9`;
- font regex mismatch because GP writes the family quoted → loosen the regex to `/font-family:[^;}]*"?Fraunces/`.
Restore `destroySite` before committing.

- [ ] **Step 3: Run the other provision integration test**

Run: `FAKTORY_DOCKER=1 npx vitest run tests/integration/provision.test.ts --testTimeout=600000 --hookTimeout=600000`
Expected: PASS (no spec/tokens: language packs run, the rest is skipped).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/provision-chrome.test.ts
git commit -m "test(faktory): provision integration — flexbox and fonts, legacy repair, blog grid and pagination, gf styles, fr_FR pack"
```

---

### Task 11: Documentation

**Files:**
- Modify: `README.md`, `docs/GETTING-STARTED.md`

- [ ] **Step 1: Update the README**

In `README.md`:

1. Line 29, replace `# provision (WP + GP stack, identity, menu, tokens, footer)` with `# provision (WP + GP stack, fr_FR packs, identity, menu, theme settings from tokens, child theme form styles, footer and blog elements)`.
2. In the phase paragraph (line 151), replace the sentence starting `Phase 8 is planned, not started:` up to the end of that sentence with:

```
Phase 8a styles the whole theme from the tokens (GeneratePress settings no longer fall into legacy mode, heading and body fonts are emitted, header, menu, backgrounds and links use the palette), builds the blog archive and article headers as GP Premium elements, styles Gravity Forms through the child theme, installs the fr_FR packs, lists the brief's missing facts at the top of `SITE-SPEC.md`, and adds an untranslated-strings QA check — see `docs/superpowers/specs/2026-09-14-faktory-phase8a-design.md`. Phases 8b (pipeline reliability) and 8c (delivery) are planned in `docs/superpowers/specs/2026-09-14-faktory-phase8-design.md`.
```

3. Line 148 describes phase 7 defects; leave it as a historical measurement, and append at the end of that paragraph: ` Phase 8a addresses the forms colors, the heading font and the blog page \`h1\`.`

- [ ] **Step 2: Update the getting started guide**

In `docs/GETTING-STARTED.md`:

1. Line 42, replace `Without GP Premium there is no footer.` with `Without GP Premium there is no footer and no blog layout.`
2. Line 113, replace the provision row description with: `Starts the Docker stack, installs WordPress in French with the theme, plugins and their French translations, creates the pages and menu, applies the design tokens to the theme and the forms, and adds the footer and the blog layout`.
3. After the table containing line 113, if the guide has a section about reviewing `SITE-SPEC.md` before `approve` (search for `SITE-SPEC.md`), add one sentence there: `If the brief lacks facts such as the phone number, address or opening hours, the file starts with « Informations à compléter »; replace each \`[à confirmer]\` before approving, or the site will show the gaps. \`approve\` warns but does not block.`

- [ ] **Step 3: Commit**

```bash
git add README.md docs/GETTING-STARTED.md
git commit -m "docs(faktory): phase 8a provision behaviour, brief gaps, phase status"
```

---

### Task 12: Verification runs and « Écarts et mesures »

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-faktory-phase8a-design.md`, `README.md` (measurement table, only if the run succeeds)

- [ ] **Step 1: Full local checks**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Repair the phase 7 site**

The `boulangerie-e2e` stack runs on port 8100 with the legacy settings.

```bash
npm run faktory -- run boulangerie-e2e --only provision
```

Expected: provision `done`, summary contains `fr_FR packs: ok`, `tokens applied`, `child theme styles`, `footer element #…`, `blog elements #… #… #…`.

Then check in a browser (Playwright MCP or Claude in Chrome) on `http://localhost:8100/`, `/la-maison/`, `/actualites/`, one article, `/contact/`:
- `getComputedStyle(document.querySelector('h1')).fontFamily` contains `Fraunces`; `getComputedStyle(document.body).fontFamily` contains `Figtree`;
- `.main-navigation` background equals the tokens' `base3` (`#FFFDF8` → `rgb(255, 253, 248)`), body background equals `base` (`rgb(250, 245, 236)`);
- `/actualites/`: one `h1`, card grid, no `by admin`;
- `/contact/`: submit button background equals `accent` (`rgb(74, 99, 67)`).
Record screenshots of `/actualites/` (desktop + mobile) and `/contact/` in the scratchpad for the report.

- [ ] **Step 3: Fresh end-to-end run, detached**

```bash
npm run faktory -- init boulangerie-8a --brief fixtures/briefs/boulangerie.md
npm run faktory -- run boulangerie-8a        # spec ⏸ — check the summary shows the gap count, and SITE-SPEC.md the « Informations à compléter » section
npm run faktory -- approve boulangerie-8a    # expect the ⚠ gaps warning, approval succeeds
npm run faktory -- run boulangerie-8a        # design ⏸
npm run faktory -- approve boulangerie-8a
nohup npm run faktory -- run boulangerie-8a > "$SCRATCHPAD/boulangerie-8a-run.log" 2>&1 &
```

(`$SCRATCHPAD` = the session scratchpad directory.) Poll `npm run faktory -- status boulangerie-8a` every few minutes until `export` is `done` or a stage fails (≈ 30 min, ≈ $17). Do not edit `SITE-SPEC.md` or `design-system.md`: the measurement is what the chain produces alone, as in phase 7.

- [ ] **Step 4: Collect results**

- `npm run faktory -- status boulangerie-8a` → per-stage cost and duration, total.
- `sites/boulangerie-8a/qa/QA-REPORT.md` → list every issue mentioning header, menu, background, link color, heading font, blog, form colors, or untranslated text. Target: none.
- `/actualites/` automatic check: `h1 | 1`.
- Grep the QA screenshots' page CSS is not possible; instead fetch each URL and assert no `#efefef`, `#222222`, `#1e73be` in the HTML: `for u in / /actualites/ /contact/; do curl -s http://localhost:<port>$u | grep -c -E '#efefef|#1e73be|#222222'; done` → all `0`.

- [ ] **Step 5: Write « Écarts et mesures »**

Append to `docs/superpowers/specs/2026-09-14-faktory-phase8a-design.md`:

```md
## Écarts et mesures

### Écarts au design

1. Paquets de langue installés par `installLanguagePacks` après `installStack`, et non dans `installCore` : le thème et les extensions n'existent pas encore quand `installCore` s'exécute.
2. `Gap = { label; paths }` : les manques de même libellé (lignes d'horaires) sont regroupés.
3. Thème enfant écrit même sans Gravity Forms : le filtre est inerte, et le fichier porte aussi la largeur de lecture des articles (GeneratePress n'a pas de réglage pour cela).
4. `functions.php` écrit via le conteneur `wpcli` puis vérifié par `php -l`.
5. `isPlaceholder` déplacé dans `src/spec-gaps.ts`, importé directement par `footer.ts`.
6. `query-no-results` et `query-page-numbers` émis en blocs bruts avec CSS écrite à la main : `gb_build.py` est une copie synchronisée d'un skill et ne connaît pas ces blocs.
7. Orbital choisi par la clé `theme` du filtre plutôt que par l'option `rg_gforms_default_theme` ; le test d'intégration vérifie la sortie du filtre, les formulaires n'existant qu'après l'étape `content`.
<autres écarts constatés pendant l'exécution, un par ligne>

### Réparation de `boulangerie-e2e`

<résumé de provision, contrôles navigateur (polices, couleurs, blog, formulaire), captures>

### Run neuf `boulangerie-8a`

| Étape | Coût | Durée | Phase 7 |
|---|---|---|---|
<une ligne par étape depuis faktory status, colonne Phase 7 depuis le README>

Défauts QA de charte : <liste ou « aucun »>. `h1` sur `/actualites/` : <n>. Couleurs par défaut GeneratePress dans le HTML : <0/…>.
```

Replace every `<…>` with the measured facts before committing; do not leave any bracket placeholder.

- [ ] **Step 6: Update the README measurement (only if the run completed)**

In `README.md`, below the phase 7 « End-to-end run » table, add a short paragraph `Phase 8a rerun on \`boulangerie-8a\` (<date>): $<total>, <duration>; …` with the same facts as the spec section.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-09-14-faktory-phase8a-design.md README.md
git commit -m "docs(faktory): phase 8a repair and end-to-end measurements, deviations"
```
