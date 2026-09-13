# Faktory Phase 6a — QA Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `faktory run <slug>` checks every page and article of the site in a real browser, screenshots them, has an agent review and fix the generated pages (at most 2 fix rounds each), and writes `qa/QA-REPORT.md` + `qa/report.json`.

**Architecture:** The `qa` stage is code-driven: Faktory launches one Playwright Chromium, runs a deterministic `checkPage` (status, console errors, failed requests, broken links/images, unstyled GenerateBlocks classes, h1 count, mobile overflow) and captures desktop/mobile screenshots (full page + viewport tiles) for every URL. For each page that has a `pages/<slug>.gb.json`, one structured-output agent reads the screenshots and the check and may rewrite the tree; Faktory validates the tree, republishes it through the new `republishPage()` (extracted from the pages stage), re-checks, and resumes the same agent session for a second round. The stage never blocks on remaining issues: it reports them.

**Tech Stack:** Node 24, TypeScript 5, `@anthropic-ai/claude-agent-sdk` 0.3.269 (`outputFormat` json_schema, `resume`), `playwright` ^1.63 (Chromium on the host), `zod` 4, `commander` 12, `vitest` 2, `tsx`, Python 3 (`gb_build.py`), Docker Compose, WP-CLI, WordPress 7.1, GeneratePress 3.6.1, GenerateBlocks 2.4.1.

**Spec:** `docs/superpowers/specs/2026-09-13-faktory-phase6-qa-export-design.md` (section `qa`, decisions 1–11, « Contrôle d'une page », « Verdict de l'agent et rapport », « Prompt `src/prompts/qa.md` ») on top of `docs/superpowers/specs/2026-09-12-faktory-design.md` section « 7. qa ». Plan 6b (`2026-09-13-faktory-phase6b-export.md`) implements the `export` section afterwards.

## Global Constraints

- Repo root `/Users/khelil/Developer/partikuls/faktory` is its own git repo (branch `main`, remote `origin` = github Partikuls/faktory). Commit after every task; do not push unless asked.
- ESM only, strict TS, imports between `src/` files use the `.js` suffix. `tsconfig` has `"types": ["node"]` and no explicit `lib`, so DOM types (`document`, `window`) are available for the in-page script. Run `npm run typecheck` before every commit.
- **zod 4** (`import { z } from "zod"`). `z.record` is fine in ordinary schemas (never in an MCP `tool()` input shape). `toJsonSchema()` in `src/schemas/json-schema.ts` for the SDK `outputFormat`.
- Model resolution: `runAgent` uses `config.models[stage] ?? config.models.default`; the stage name passed to `runAgent` is `"qa"`. Never hardcode a model. Do not change `src/agent.ts`.
- Every WP-CLI call goes through `src/wp.ts`. Every page publication goes through `src/pages/publish.ts`.
- Test conventions: `deps` objects on modules as spy seams (`vi.spyOn(deps, "fn")`); helper params typed `any` where vitest 2.1.9 + strict tsc fight; void spies use `mockResolvedValue(undefined)`; `beforeEach(() => vi.restoreAllMocks())`. Unit tests that need a site dir use `loadConfig(mkdtempSync(join(tmpdir(), "fk-…-")))` + `initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" })` + `loadContext(config, "boul")` (`initSite` creates `pages/`, `plugins/`, `content/`, `qa/`, `dist/`, `wp-content/`).
- Integration tests needing Docker: `describe.skipIf(!process.env.FAKTORY_DOCKER)`, run with `FAKTORY_DOCKER=1 npm run test:integration`. Ports used so far: 8190–8196. **This plan uses 8197.** Unit tests needing Chromium: `describe.skipIf(!chromiumInstalled())` (Task 3) so `npm test` passes on a machine without the browser.
- Fixture spec `fixtures/specs/boulangerie.site-spec.json`: pages accueil (home), nos-produits, commandes-evenements, la-maison, actualites (blog), contact; 3 blog articles (first « La galette des rois revient : frangipane ou pomme ? »); feature `catalogue_produits` placed on accueil (see `fixtures/plugins/catalogue_produits.manifest.json`, `fixtures/pages/accueil.gb.json` carries its wrapper); forms `devis_evenement` (commandes-evenements) and `contact` (contact). The live `sites/boulangerie` spec has 5 articles: derive everything from the spec, never hardcode.
- Verified in the browser on boulangerie `/contact/` (2026-09-13): 58 `gb-*` classes all styled by the page's `<style>` tags (`#generateblocks-inline-css` among others), 0 broken images, 0 console errors, `.gform_wrapper` present, 1 `h1`, page 3 862 px high; `/`, `/contact/`, `/actualites/` answer 200. Chromium builds already exist in `~/Library/Caches/ms-playwright` (revisions 1223, 1234, 1243); `playwright install chromium` is still the supported way to get the one matching the installed package.
- Helpers to reuse, not duplicate: `readPageTree` (`src/pages/generate.ts`); `compilePage`, `publishPage` (`src/pages/publish.ts`); `applyPlacements`, `pluginPlacements`, `formPlacements`, `readPluginManifests`, `readFormsManifest` (`src/pages/placements.ts`); `assertRendered`, `assertFormRendered`, `pageUrl`, `deps.fetchText` (`src/pages/render-check.ts`); `runValidated`, `runAgent`, `AgentRun` (`src/agent.ts`); `assertBudget` (`src/budget.ts`); `mapLimit` (`src/concurrency.ts`); `siteUrl` (`src/docker.ts`); `loadPrompt` (`src/prompts.ts`); `toJsonSchema`; `readJsonArtifact`, `pageTreePath`, `pageTreeRel` (`src/artifacts.ts`); `articleSlug` (`src/schemas/article.ts`); `ensurePages` (`src/provision/pages.ts`); `TOOL_GB_BUILD` (`src/tools/server.ts`); `FEATURE_WRAPPER_ATTR`, `FORM_WRAPPER_ATTR`, `PageTree` (`src/schemas/page-tree.ts`).

## Decisions taken for this phase (approved 2026-09-13, keep them)

1. Faktory drives the loop; the agent only reviews and edits `pages/<slug>.gb.json`. No new MCP tool. Hard cap 2 fix rounds per page, then a final check. Concurrency 3, one shared browser, one context per check.
2. Every sitemap page and every article is checked and screenshotted; only pages with a tree (not the blog page) are reviewed by an agent.
3. `playwright` on the host; `npm run setup-playwright`; `doctor` checks Chromium; a missing browser fails the stage before any LLM call.
4. `checkPage` fields and the hard-failure rule (status ≠ 200 fails the stage) as in the spec's « Contrôle d'une page ».
5. Screenshots: full page + viewport tiles (max 12 per viewport), desktop 1440×900, mobile 390×844, scale 1; each round overwrites them.
6. Agent: tools `Read`, `Write` (roots `pages`), `gb_build`; `maxTurns` 20; structured output `QaVerdict`; consistency rules in `validateVerdict`; an invalid rewritten tree is restored from memory and recorded as a rejected fix (`needs_human`).
7. `republishPage()` in `src/pages/publish.ts`, extracted from the pages stage and used by both.
8. Report only, never blocking: `qa/report.json` + `qa/QA-REPORT.md`; stage fails only on a non-200 URL, missing browser, agent error or budget.
9. $0 re-run: a reviewed page with unchanged tree hash and verdict `ok` is re-checked, not re-reviewed (`reused`).
10. Failed pages collected, stage fails at the end with the list; budget error rethrown as-is; browser always closed.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` (modify) | dependency `playwright`, script `setup-playwright` |
| `src/cli.ts` (modify) | `doctor`: Playwright Chromium check |
| `src/schemas/qa.ts` | `QA_DIR`, paths, `VIEWPORTS`, `MAX_TILES`, `MAX_FIX_ROUNDS`, `PageCheckSchema`/`parsePageCheck`/`checkIssues`/`hasHardFailure`, `QaVerdictShape`/`parseQaVerdict`/`validateVerdict`/`assertVerdict`, `QaReportSchema`/`parseQaReport`/`readQaReport`/`computeTotals`/`finalVerdict`/`remainingIssues`, `hashTree`/`treeHash` |
| `src/qa/inpage.ts` | `inPageAudit()` — the function `page.evaluate` runs in the browser; `GB_CLASS_RE` |
| `src/qa/browser.ts` | `chromiumInstalled`, `launchBrowser`, `linkCandidates`, `checkLinks`, `checkPage` (check + screenshots), `screenshotOpts` |
| `src/pages/publish.ts` (modify) | `republishPage(ctx, spec, page, id, tree, opts)`; `deps` gains `compilePage`, `publishPage` |
| `src/stages/pages.ts` (modify) | inner loop uses `republishPage` |
| `src/prompts/qa.md`, `src/prompts.ts` (modify) | system prompt; `PromptName` gains `"qa"` |
| `src/qa/review.ts` | `qaUserPrompt`, `qaResumePrompt`, `screenshotList`, `reviewPage` |
| `src/qa/report.ts` | `renderQaReport`, `writeQaReport` |
| `src/stages/qa.ts`, `src/pipeline.ts` (modify) | `qaStage`, `QA_CONCURRENCY`; `registry.qa` |
| `fixtures/qa/contact.check.json`, `fixtures/qa/report.json` | valid check and report for the fixture spec |
| `tests/unit/qa-schema.test.ts`, `qa-browser.test.ts`, `publish-republish.test.ts`, `qa-review.test.ts`, `qa-report.test.ts`, `stage-qa.test.ts`; `stage-pages.test.ts`, `pipeline.test.ts`, `prompts.test.ts` (modify) | unit tests |
| `tests/integration/qa.test.ts` | Docker end-to-end on port 8197 |
| `README.md`, spec addendum | docs, measured cost, deviations |

---

### Task 1: Playwright dependency, setup script, doctor check

**Files:**
- Modify: `package.json`
- Modify: `src/cli.ts` (doctor checks)
- Create: `src/qa/browser.ts` (only `chromiumInstalled` for now; Task 3 fills it)

**Interfaces:**
- Produces: `chromiumInstalled(): boolean` (`src/qa/browser.ts`); `npm run setup-playwright`.

- [ ] **Step 1: Add the dependency and the script**

```bash
npm install playwright@^1.63.0
```

Then in `package.json` add to `"scripts"`:

```json
"setup-playwright": "playwright install chromium"
```

- [ ] **Step 2: Create `src/qa/browser.ts` with the installed-check only**

```ts
// src/qa/browser.ts
import { existsSync } from "node:fs";
import { chromium } from "playwright";

/** True when the Chromium build matching the installed `playwright` package is present (`npm run setup-playwright`). */
export function chromiumInstalled(): boolean {
  return existsSync(chromium.executablePath());
}
```

- [ ] **Step 3: Add the doctor check**

In `src/cli.ts`, import `chromiumInstalled` from `./qa/browser.js` and, after the `phpstan` check line, add:

```ts
    checks.push(["playwright chromium", chromiumInstalled(), "run npm run setup-playwright"]);
```

- [ ] **Step 4: Install the browser and verify**

```bash
npm run setup-playwright
npm run faktory -- doctor
```

Expected: a line `✔ playwright chromium`. Run `npm run typecheck && npm test` (all green).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/cli.ts src/qa/browser.ts
git commit -m "feat(faktory): playwright dependency, setup-playwright script, doctor check"
```

---

### Task 2: QA schemas — page check, agent verdict, report, paths, tree hash

**Files:**
- Create: `src/schemas/qa.ts`
- Create: `fixtures/qa/contact.check.json`, `fixtures/qa/report.json`
- Test: `tests/unit/qa-schema.test.ts`

**Interfaces:**
- Consumes: `SiteContext` (`src/docker.ts`), `pageTreePath` (`src/artifacts.ts`).
- Produces (all exported from `src/schemas/qa.ts`):
  - `QA_DIR = "qa"`, `QA_REPORT_JSON = "qa/report.json"`, `QA_REPORT_MD = "qa/QA-REPORT.md"`, `MAX_FIX_ROUNDS = 2`, `MAX_TILES = 12`, `MAX_LINKS = 50`
  - `type Viewport = "desktop" | "mobile"`, `VIEWPORTS: Record<Viewport, { width: number; height: number }>`
  - `checkRel(slug)`, `checkPath(ctx, slug)`, `screenshotRel(slug, viewport, tile?)`, `screenshotPath(ctx, slug, viewport, tile?)`, `qaReportJsonPath(ctx)`, `qaReportMdPath(ctx)`
  - `PageCheckSchema`, `type PageCheck`, `parsePageCheck(data)`, `hasHardFailure(check)`, `checkIssues(check): string[]`
  - `QA_VERDICTS`, `QaIssueSchema`, `type QaIssue`, `QaVerdictShape`, `type QaVerdict`, `parseQaVerdict(data)`, `validateVerdict(v, treeChanged): string[]`, `assertVerdict(v, treeChanged)`
  - `QaPageSchema`, `type QaPage`, `QaReportSchema`, `type QaReport`, `parseQaReport(data)`, `readQaReport(ctx): QaReport | undefined`, `computeTotals(pages)`, `finalVerdict(issues)`, `remainingIssues(page)`
  - `hashTree(text): string`, `treeHash(ctx, slug): string | undefined`

- [ ] **Step 1: Write the fixtures**

```json
// fixtures/qa/contact.check.json
{
  "url": "http://localhost:8101/contact/",
  "status": 200,
  "consoleErrors": [],
  "pageErrors": [],
  "failedRequests": [],
  "brokenLinks": [],
  "brokenImages": [],
  "missingAlt": 0,
  "unstyledBlocks": [],
  "h1Count": 1,
  "mobileOverflow": false,
  "checkedAt": "2026-09-13T15:25:27.000Z"
}
```

```json
// fixtures/qa/report.json
{
  "generatedAt": "2026-09-13T16:00:00.000Z",
  "siteUrl": "http://localhost:8101",
  "costUsd": 1.23,
  "totals": { "urls": 2, "reviewed": 1, "ok": 0, "fixed": 1, "needsHuman": 0, "remainingIssues": 0 },
  "pages": [
    {
      "slug": "contact", "kind": "contact", "url": "http://localhost:8101/contact/", "status": 200,
      "check": {
        "url": "http://localhost:8101/contact/", "status": 200, "consoleErrors": [], "pageErrors": [], "failedRequests": [],
        "brokenLinks": [], "brokenImages": [], "missingAlt": 0, "unstyledBlocks": [], "h1Count": 1, "mobileOverflow": false,
        "checkedAt": "2026-09-13T15:25:27.000Z"
      },
      "screenshots": { "desktop": "qa/contact.desktop.png", "mobile": "qa/contact.mobile.png" },
      "reviewed": true, "reused": false, "treeHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000", "rounds": 1,
      "verdict": "fixed", "summary": "Bouton du formulaire sans état focus, corrigé.",
      "issues": [ { "severity": "minor", "where": "section form", "what": "bouton sans focus-visible", "action": "fixed" } ],
      "costUsd": 1.23
    },
    {
      "slug": "actualites", "kind": "blog", "url": "http://localhost:8101/actualites/", "status": 200,
      "check": {
        "url": "http://localhost:8101/actualites/", "status": 200, "consoleErrors": [], "pageErrors": [], "failedRequests": [],
        "brokenLinks": [], "brokenImages": [], "missingAlt": 0, "unstyledBlocks": [], "h1Count": 1, "mobileOverflow": false,
        "checkedAt": "2026-09-13T15:25:40.000Z"
      },
      "screenshots": { "desktop": "qa/actualites.desktop.png", "mobile": "qa/actualites.mobile.png" },
      "reviewed": false, "reused": false, "rounds": 0, "issues": [], "costUsd": 0
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/qa-schema.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import {
  QA_DIR, QA_REPORT_JSON, QA_REPORT_MD, MAX_FIX_ROUNDS, MAX_TILES, VIEWPORTS, checkRel, screenshotRel,
  parsePageCheck, hasHardFailure, checkIssues, parseQaVerdict, validateVerdict, assertVerdict,
  parseQaReport, readQaReport, computeTotals, finalVerdict, remainingIssues, hashTree, treeHash, type PageCheck,
} from "../../src/schemas/qa.js";

const check = (): PageCheck => JSON.parse(readFileSync("fixtures/qa/contact.check.json", "utf8"));
const report = () => JSON.parse(readFileSync("fixtures/qa/report.json", "utf8"));

async function ctx() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-qaschema-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}

describe("qa paths and constants", () => {
  it("names the qa dir, the reports, the viewports and the caps", () => {
    expect(QA_DIR).toBe("qa");
    expect(QA_REPORT_JSON).toBe("qa/report.json");
    expect(QA_REPORT_MD).toBe("qa/QA-REPORT.md");
    expect(MAX_FIX_ROUNDS).toBe(2);
    expect(MAX_TILES).toBe(12);
    expect(VIEWPORTS).toEqual({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } });
    expect(checkRel("contact")).toBe("qa/contact.check.json");
    expect(screenshotRel("contact", "desktop")).toBe("qa/contact.desktop.png");
    expect(screenshotRel("contact", "mobile", 3)).toBe("qa/contact.mobile.3.png");
  });
});

describe("page check", () => {
  it("parses the fixture, has no hard failure and no issue", () => {
    const c = parsePageCheck(check());
    expect(hasHardFailure(c)).toBe(false);
    expect(checkIssues(c)).toEqual([]);
  });
  it("rejects unknown keys and bad shapes", () => {
    expect(() => parsePageCheck({ ...check(), extra: 1 })).toThrow(/Invalid page check/);
    expect(() => parsePageCheck({ ...check(), status: "200" })).toThrow(/Invalid page check/);
  });
  it("lists one readable issue per failing check, in a stable order", () => {
    const c: PageCheck = {
      ...check(), status: 500, consoleErrors: ["Uncaught TypeError: x is not a function", "b", "c", "d"], pageErrors: ["ReferenceError: y"],
      failedRequests: [{ url: "http://localhost:8101/wp-content/x.css", status: 404 }], brokenLinks: [{ href: "http://localhost:8101/dead/", status: 404 }],
      brokenImages: ["http://localhost:8101/img.png"], missingAlt: 2, unstyledBlocks: ["gb-element-abc", "gb-text-def"], h1Count: 2, mobileOverflow: true,
    };
    expect(hasHardFailure(c)).toBe(true);
    expect(checkIssues(c)).toEqual([
      "statut HTTP 500",
      "4 erreur(s) console : Uncaught TypeError: x is not a function ; b ; c …",
      "1 exception(s) JavaScript : ReferenceError: y",
      "1 requête(s) en échec : http://localhost:8101/wp-content/x.css → 404",
      "1 lien(s) cassé(s) : http://localhost:8101/dead/ → 404",
      "1 image(s) cassée(s) : http://localhost:8101/img.png",
      "2 image(s) sans alt",
      "2 bloc(s) GenerateBlocks sans CSS : gb-element-abc, gb-text-def",
      "2 h1 (attendu : 1)",
      "débordement horizontal en mobile",
    ]);
  });
});

describe("agent verdict", () => {
  const fixed = { verdict: "fixed", summary: "ok", issues: [{ severity: "minor", where: "hero", what: "x", action: "fixed" }] };
  it("parses a verdict and rejects a bad one", () => {
    expect(parseQaVerdict(fixed).verdict).toBe("fixed");
    expect(() => parseQaVerdict({ verdict: "maybe", summary: "", issues: [] })).toThrow(/Invalid qa verdict/);
    expect(() => parseQaVerdict({ verdict: "ok", summary: "x".repeat(301), issues: [] })).toThrow(/Invalid qa verdict/);
  });
  it("enforces the consistency rules between verdict, actions and tree change", () => {
    expect(validateVerdict(parseQaVerdict(fixed), true)).toEqual([]);
    expect(validateVerdict(parseQaVerdict({ verdict: "ok", summary: "rien", issues: [] }), false)).toEqual([]);
    expect(validateVerdict(parseQaVerdict({ verdict: "needs_human", summary: "x", issues: [{ severity: "major", where: "a", what: "b", action: "left" }] }), false)).toEqual([]);
    expect(validateVerdict(parseQaVerdict({ verdict: "fixed", summary: "x", issues: [] }), true)).toEqual(['verdict "fixed" requires at least one issue with action "fixed"']);
    expect(validateVerdict(parseQaVerdict(fixed), false)).toEqual(['verdict "fixed" but pages/<slug>.gb.json did not change — write the corrected tree, or answer "ok" / "needs_human"']);
    expect(validateVerdict(parseQaVerdict({ verdict: "ok", summary: "x", issues: [{ severity: "minor", where: "a", what: "b", action: "left" }] }), false)).toEqual(['verdict "ok" but some issues are "left" — answer "needs_human"']);
    expect(validateVerdict(parseQaVerdict({ verdict: "needs_human", summary: "x", issues: [] }), false)).toEqual(['verdict "needs_human" requires at least one issue with action "left"']);
    expect(validateVerdict(parseQaVerdict({ verdict: "ok", summary: "x", issues: [] }), true)).toEqual(['verdict "ok" but the tree changed — answer "fixed"']);
    expect(() => assertVerdict(parseQaVerdict(fixed), false)).toThrow(/qa verdict is inconsistent:\n- verdict "fixed" but/);
  });
});

describe("report", () => {
  it("parses the fixture report and computes totals", () => {
    const r = parseQaReport(report());
    expect(r.pages).toHaveLength(2);
    expect(computeTotals(r.pages)).toEqual({ urls: 2, reviewed: 1, ok: 0, fixed: 1, needsHuman: 0, remainingIssues: 0 });
    expect(remainingIssues(r.pages[0])).toBe(0);
  });
  it("finalVerdict follows the issues", () => {
    expect(finalVerdict([])).toBe("ok");
    expect(finalVerdict([{ severity: "minor", where: "a", what: "b", action: "fixed" }])).toBe("fixed");
    expect(finalVerdict([{ severity: "minor", where: "a", what: "b", action: "fixed" }, { severity: "major", where: "c", what: "d", action: "left" }])).toBe("needs_human");
  });
  it("readQaReport returns undefined without a file and a clear error on a bad one", async () => {
    const c = await ctx();
    expect(readQaReport(c)).toBeUndefined();
    writeFileSync(join(c.siteDir, QA_REPORT_JSON), "{ nope");
    expect(() => readQaReport(c)).toThrow(/qa\/report.json is not valid JSON.*delete it/);
    writeFileSync(join(c.siteDir, QA_REPORT_JSON), JSON.stringify({ ...report(), totals: undefined }));
    expect(() => readQaReport(c)).toThrow(/qa\/report.json: Invalid qa report.*delete it/);
    writeFileSync(join(c.siteDir, QA_REPORT_JSON), JSON.stringify(report()));
    expect(readQaReport(c)?.pages[0].slug).toBe("contact");
  });
});

describe("tree hash", () => {
  it("hashes the file content, stable and prefixed", async () => {
    expect(hashTree("[]")).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashTree("[]")).toBe(hashTree("[]"));
    expect(hashTree("[] ")).not.toBe(hashTree("[]"));
    const c = await ctx();
    expect(treeHash(c, "accueil")).toBeUndefined();
    mkdirSync(join(c.siteDir, "pages"), { recursive: true });
    writeFileSync(join(c.siteDir, "pages/accueil.gb.json"), "[]");
    expect(treeHash(c, "accueil")).toBe(hashTree("[]"));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/qa-schema.test.ts`
Expected: FAIL — cannot resolve `../../src/schemas/qa.js`.

- [ ] **Step 4: Write the schema module**

```ts
// src/schemas/qa.ts
import { z } from "zod";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SiteContext } from "../docker.js";
import { pageTreePath } from "../artifacts.js";

export const QA_DIR = "qa";
export const QA_REPORT_JSON = `${QA_DIR}/report.json`;
export const QA_REPORT_MD = `${QA_DIR}/QA-REPORT.md`;
/** Agent review + fix + republish + re-check = one round; at most this many per page (spec decision 1). */
export const MAX_FIX_ROUNDS = 2;
/** Viewport-height screenshot tiles per viewport, so the agent reads a long page at scale (spec decision 5). */
export const MAX_TILES = 12;
/** Same-origin links checked per page (spec decision 4). */
export const MAX_LINKS = 50;

export type Viewport = "desktop" | "mobile";
export const VIEWPORTS: Record<Viewport, { width: number; height: number }> = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

export const checkRel = (slug: string): string => `${QA_DIR}/${slug}.check.json`;
export const checkPath = (ctx: SiteContext, slug: string): string => join(ctx.siteDir, checkRel(slug));
export const screenshotRel = (slug: string, viewport: Viewport, tile?: number): string => `${QA_DIR}/${slug}.${viewport}${tile ? `.${tile}` : ""}.png`;
export const screenshotPath = (ctx: SiteContext, slug: string, viewport: Viewport, tile?: number): string => join(ctx.siteDir, screenshotRel(slug, viewport, tile));
export const qaReportJsonPath = (ctx: SiteContext): string => join(ctx.siteDir, QA_REPORT_JSON);
export const qaReportMdPath = (ctx: SiteContext): string => join(ctx.siteDir, QA_REPORT_MD);

const issuesOf = (e: z.ZodError): string => e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

// ---------- page check (spec « Contrôle d'une page ») ----------

export const PageCheckSchema = z.strictObject({
  url: z.string().url(),
  status: z.number().int(),
  consoleErrors: z.array(z.string()),
  pageErrors: z.array(z.string()),
  failedRequests: z.array(z.strictObject({ url: z.string(), status: z.number().int() })),
  brokenLinks: z.array(z.strictObject({ href: z.string(), status: z.number().int() })),
  brokenImages: z.array(z.string()),
  missingAlt: z.number().int().min(0),
  unstyledBlocks: z.array(z.string()),
  h1Count: z.number().int().min(0),
  mobileOverflow: z.boolean(),
  checkedAt: z.string(),
});
export type PageCheck = z.infer<typeof PageCheckSchema>;

export function parsePageCheck(data: unknown): PageCheck {
  const r = PageCheckSchema.safeParse(data);
  if (!r.success) throw new Error(`Invalid page check: ${issuesOf(r.error)}`);
  return r.data;
}

/** A non-200 page is a broken site, not a page defect: the stage fails (spec decision 4). */
export function hasHardFailure(c: PageCheck): boolean {
  return c.status !== 200;
}

const sample = (items: string[]): string => items.slice(0, 3).join(" ; ") + (items.length > 3 ? " …" : "");

/** One readable French line per failing check, in a stable order; empty when the page is clean. */
export function checkIssues(c: PageCheck): string[] {
  const out: string[] = [];
  if (c.status !== 200) out.push(`statut HTTP ${c.status}`);
  if (c.consoleErrors.length) out.push(`${c.consoleErrors.length} erreur(s) console : ${sample(c.consoleErrors)}`);
  if (c.pageErrors.length) out.push(`${c.pageErrors.length} exception(s) JavaScript : ${sample(c.pageErrors)}`);
  if (c.failedRequests.length) out.push(`${c.failedRequests.length} requête(s) en échec : ${sample(c.failedRequests.map((r) => `${r.url} → ${r.status}`))}`);
  if (c.brokenLinks.length) out.push(`${c.brokenLinks.length} lien(s) cassé(s) : ${sample(c.brokenLinks.map((l) => `${l.href} → ${l.status}`))}`);
  if (c.brokenImages.length) out.push(`${c.brokenImages.length} image(s) cassée(s) : ${sample(c.brokenImages)}`);
  if (c.missingAlt) out.push(`${c.missingAlt} image(s) sans alt`);
  if (c.unstyledBlocks.length) out.push(`${c.unstyledBlocks.length} bloc(s) GenerateBlocks sans CSS : ${c.unstyledBlocks.join(", ")}`);
  if (c.h1Count !== 1) out.push(`${c.h1Count} h1 (attendu : 1)`);
  if (c.mobileOverflow) out.push("débordement horizontal en mobile");
  return out;
}

// ---------- agent verdict (spec decision 6) ----------

export const QA_VERDICTS = ["ok", "fixed", "needs_human"] as const;
export const QaIssueSchema = z.strictObject({
  severity: z.enum(["major", "minor"]).describe("major = visible à tout visiteur (lisibilité, débordement, contenu manquant) ; minor = détail"),
  where: z.string().min(1).describe("Où : section ou élément, ex. « section hero », « bouton du CTA »"),
  what: z.string().min(1).describe("Quoi : le défaut constaté, en français, une phrase"),
  action: z.enum(["fixed", "left"]).describe("fixed = corrigé dans pages/<slug>.gb.json ; left = laissé (hors de l'arbre, ou trop risqué)"),
});
export type QaIssue = z.infer<typeof QaIssueSchema>;
export const QaVerdictShape = z.object({
  verdict: z.enum(QA_VERDICTS).describe("ok = rien à corriger ; fixed = l'arbre a été réécrit ; needs_human = au moins un défaut laissé"),
  summary: z.string().min(1).max(300).describe("Une à deux phrases en français"),
  issues: z.array(QaIssueSchema),
});
export type QaVerdict = z.infer<typeof QaVerdictShape>;

export function parseQaVerdict(data: unknown): QaVerdict {
  const r = QaVerdictShape.safeParse(data);
  if (!r.success) throw new Error(`Invalid qa verdict: ${issuesOf(r.error)}`);
  return r.data;
}

/** Rules the shape cannot express: the verdict must match the actions and whether the tree really changed. */
export function validateVerdict(v: QaVerdict, treeChanged: boolean): string[] {
  const fixed = v.issues.filter((i) => i.action === "fixed").length;
  const left = v.issues.filter((i) => i.action === "left").length;
  const out: string[] = [];
  if (v.verdict === "fixed" && !fixed) out.push('verdict "fixed" requires at least one issue with action "fixed"');
  if (v.verdict === "fixed" && !treeChanged) out.push('verdict "fixed" but pages/<slug>.gb.json did not change — write the corrected tree, or answer "ok" / "needs_human"');
  if (v.verdict === "ok" && left) out.push('verdict "ok" but some issues are "left" — answer "needs_human"');
  if (v.verdict === "needs_human" && !left) out.push('verdict "needs_human" requires at least one issue with action "left"');
  if (v.verdict !== "fixed" && treeChanged) out.push(`verdict "${v.verdict}" but the tree changed — answer "fixed"`);
  return out;
}

export function assertVerdict(v: QaVerdict, treeChanged: boolean): void {
  const issues = validateVerdict(v, treeChanged);
  if (issues.length) throw new Error(`qa verdict is inconsistent:\n- ${issues.join("\n- ")}`);
}

// ---------- report (spec « Verdict de l'agent et rapport ») ----------

export const QaPageSchema = z.strictObject({
  slug: z.string(),
  kind: z.enum(["home", "standard", "blog", "contact", "article"]),
  url: z.string().url(),
  status: z.number().int(),
  check: PageCheckSchema,
  screenshots: z.strictObject({ desktop: z.string(), mobile: z.string() }),
  reviewed: z.boolean(),
  reused: z.boolean(),
  treeHash: z.string().optional(),
  rounds: z.number().int().min(0),
  verdict: z.enum(QA_VERDICTS).optional(),
  summary: z.string().optional(),
  issues: z.array(QaIssueSchema),
  costUsd: z.number().min(0),
});
export type QaPage = z.infer<typeof QaPageSchema>;

export const QaTotalsSchema = z.strictObject({
  urls: z.number().int(), reviewed: z.number().int(), ok: z.number().int(), fixed: z.number().int(), needsHuman: z.number().int(), remainingIssues: z.number().int(),
});
export const QaReportSchema = z.strictObject({
  generatedAt: z.string(),
  siteUrl: z.string().url(),
  costUsd: z.number().min(0),
  totals: QaTotalsSchema,
  pages: z.array(QaPageSchema),
});
export type QaReport = z.infer<typeof QaReportSchema>;

export function parseQaReport(data: unknown): QaReport {
  const r = QaReportSchema.safeParse(data);
  if (!r.success) throw new Error(`Invalid qa report: ${issuesOf(r.error)}`);
  return r.data;
}

/** `qa/report.json` of a previous run (for the $0 re-run rule), undefined when absent; an unreadable one must be deleted. */
export function readQaReport(ctx: SiteContext): QaReport | undefined {
  const p = qaReportJsonPath(ctx);
  if (!existsSync(p)) return undefined;
  let data: unknown;
  try { data = JSON.parse(readFileSync(p, "utf8")); }
  catch (err) { throw new Error(`${QA_REPORT_JSON} is not valid JSON: ${err instanceof Error ? err.message : String(err)} — delete it (the qa stage rewrites it)`); }
  try { return parseQaReport(data); }
  catch (err) { throw new Error(`${QA_REPORT_JSON}: ${err instanceof Error ? err.message : String(err)} — delete it (the qa stage rewrites it)`); }
}

export const remainingIssues = (p: Pick<QaPage, "issues">): number => p.issues.filter((i) => i.action === "left").length;

/** The page's final verdict is derived from its issues, whatever each round said (left > fixed > ok). */
export function finalVerdict(issues: QaIssue[]): QaVerdict["verdict"] {
  if (issues.some((i) => i.action === "left")) return "needs_human";
  if (issues.some((i) => i.action === "fixed")) return "fixed";
  return "ok";
}

export function computeTotals(pages: QaPage[]): QaReport["totals"] {
  const reviewed = pages.filter((p) => p.reviewed);
  return {
    urls: pages.length,
    reviewed: reviewed.length,
    ok: reviewed.filter((p) => p.verdict === "ok").length,
    fixed: reviewed.filter((p) => p.verdict === "fixed").length,
    needsHuman: reviewed.filter((p) => p.verdict === "needs_human").length,
    remainingIssues: pages.reduce((n, p) => n + remainingIssues(p), 0),
  };
}

// ---------- tree hash (spec decision 9) ----------

export const hashTree = (text: string): string => `sha256:${createHash("sha256").update(text).digest("hex")}`;

/** Hash of `pages/<slug>.gb.json` as stored on disk; undefined when the page has no tree. */
export function treeHash(ctx: SiteContext, slug: string): string | undefined {
  const p = pageTreePath(ctx, slug);
  return existsSync(p) ? hashTree(readFileSync(p, "utf8")) : undefined;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/qa-schema.test.ts`
Expected: PASS (5 describe blocks). Then `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/schemas/qa.ts fixtures/qa tests/unit/qa-schema.test.ts
git commit -m "feat(faktory): qa schemas — page check, agent verdict, report, tree hash"
```

---

### Task 3: In-page audit and `checkPage` (Playwright)

**Files:**
- Create: `src/qa/inpage.ts`
- Modify: `src/qa/browser.ts` (add `launchBrowser`, `linkCandidates`, `checkLinks`, `screenshotOpts`, `checkPage`)
- Test: `tests/unit/qa-browser.test.ts`

**Interfaces:**
- Consumes: `VIEWPORTS`, `MAX_TILES`, `MAX_LINKS`, `PageCheck`, `Viewport`, `screenshotPath`, `screenshotRel` (`src/schemas/qa.ts`).
- Produces:
  - `inPageAudit(): InPageResult` with `type InPageResult = { unstyledBlocks: string[]; brokenImages: string[]; missingAlt: number; h1Count: number; links: string[] }` — serialized into the page by `page.evaluate`, so it must be self-contained (no imports, no outer variables).
  - `launchBrowser(): Promise<Browser>` (throws `Playwright Chromium is not installed — run: npm run setup-playwright`).
  - `linkCandidates(hrefs: string[], pageUrl: string): string[]`, `type LinkCache = Map<string, Promise<number>>`, `checkLinks(hrefs, cache): Promise<{ href: string; status: number }[]>`.
  - `type ScreenshotTargets = { desktop: string; mobile: string; tile: (viewport: Viewport, n: number) => string }` (absolute paths); `screenshotOpts(ctx, slug): ScreenshotTargets`.
  - `checkPage(browser, url, targets, cache?): Promise<{ check: PageCheck; tiles: Record<Viewport, number> }>`.
  - `deps = { launch, fetchStatus }`.

- [ ] **Step 1: Write the failing test (local HTTP server, real Chromium)**

```ts
// tests/unit/qa-browser.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { chromiumInstalled, launchBrowser, linkCandidates, checkLinks, checkPage, type LinkCache } from "../../src/qa/browser.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const html = (origin: string) => `<!doctype html><html><head><style>.gb-element-ok{padding:1px}</style></head><body>
<h1>Un</h1><h1>Deux</h1>
<div class="gb-element-ok gb-text-missing gb-container-x1 other">bloc</div>
<style>.gb-container-x1{margin:0}</style>
<img src="/missing.png" alt="cassée"><img src="/ok.png">
<a href="/dead">mort</a><a href="/">home</a><a href="/#top">ancre</a><a href="mailto:a@b.c">m</a><a href="tel:+33">t</a><a href="/wp-admin/">admin</a><a href="${origin}/ok/">ok</a><a href="https://example.com/">ext</a>
<div style="width:2000px">large</div>
<script>console.error("boom"); console.log("info"); setTimeout(() => { throw new Error("crash"); }, 0);</script>
</body></html>`;

describe("linkCandidates", () => {
  it("keeps same-origin page links once, without fragment, skips mailto/tel/wp-admin/wp-login/external, caps at 50", () => {
    const base = "http://localhost:8101";
    const hrefs = [`${base}/a/`, `${base}/a/#x`, `${base}/a/`, "mailto:x@y.z", "tel:+33", `${base}/wp-admin/`, `${base}/wp-login.php?x=1`, "https://example.com/", `${base}/b/?p=2`, `${base}/`];
    expect(linkCandidates(hrefs, `${base}/contact/`)).toEqual([`${base}/a/`, `${base}/b/?p=2`, `${base}/`]);
    const many = Array.from({ length: 60 }, (_, i) => `${base}/p${i}/`);
    expect(linkCandidates(many, `${base}/`)).toHaveLength(50);
  });
  it("excludes the page's own url", () => {
    expect(linkCandidates(["http://localhost:8101/contact/", "http://localhost:8101/contact/#form"], "http://localhost:8101/contact/")).toEqual([]);
  });
});

describe.skipIf(!chromiumInstalled())("checkPage against a local page (chromium)", () => {
  let server: Server; let origin = "";
  const dir = mkdtempSync(join(tmpdir(), "fk-qabrowser-"));
  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? "/";
      if (url === "/" || url === "/ok/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html(origin)); return; }
      if (url === "/ok.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG); return; }
      res.writeHead(404, { "content-type": "text/plain" }); res.end("nope");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it("checkLinks reuses the cache across calls", async () => {
    const cache: LinkCache = new Map();
    const a = await checkLinks([`${origin}/dead`, `${origin}/ok/`], cache);
    expect(a).toEqual([{ href: `${origin}/dead`, status: 404 }]);
    expect(cache.size).toBe(2);
    const b = await checkLinks([`${origin}/dead`], cache);
    expect(b).toEqual([{ href: `${origin}/dead`, status: 404 }]);
    expect(cache.size).toBe(2);
  }, 30_000);

  it("collects every check field and writes the screenshots", async () => {
    const browser = await launchBrowser();
    try {
      const targets = { desktop: join(dir, "p.desktop.png"), mobile: join(dir, "p.mobile.png"), tile: (v: "desktop" | "mobile", n: number) => join(dir, `p.${v}.${n}.png`) };
      const { check, tiles } = await checkPage(browser, `${origin}/`, targets, new Map());
      expect(check.url).toBe(`${origin}/`);
      expect(check.status).toBe(200);
      expect(check.consoleErrors).toEqual(["boom"]);
      expect(check.pageErrors.join(" ")).toContain("crash");
      expect(check.failedRequests).toEqual([{ url: `${origin}/missing.png`, status: 404 }]);
      expect(check.brokenLinks).toEqual([{ href: `${origin}/dead`, status: 404 }]);
      expect(check.brokenImages).toEqual([`${origin}/missing.png`]);
      expect(check.missingAlt).toBe(1);
      expect(check.unstyledBlocks).toEqual(["gb-text-missing"]);
      expect(check.h1Count).toBe(2);
      expect(check.mobileOverflow).toBe(true);
      expect(check.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(tiles.desktop).toBeGreaterThanOrEqual(1);
      expect(tiles.mobile).toBeGreaterThanOrEqual(1);
      for (const f of [targets.desktop, targets.mobile, targets.tile("desktop", 1), targets.tile("mobile", 1)]) expect(existsSync(f), f).toBe(true);
    } finally { await browser.close(); }
  }, 60_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/qa-browser.test.ts`
Expected: FAIL — `linkCandidates` is not exported.

- [ ] **Step 3: Write the in-page audit**

```ts
// src/qa/inpage.ts
export type InPageResult = { unstyledBlocks: string[]; brokenImages: string[]; missingAlt: number; h1Count: number; links: string[] };

/** GenerateBlocks per-block classes (`gb-element-e756c829`, `gb-text-…`, …); every one must have a rule in the page's `<style>` tags. */
export const GB_CLASS_RE = /^gb-(element|text|media|container|grid|shape|looper|query)-[a-z0-9]+$/;

/**
 * Runs INSIDE the page via `page.evaluate(inPageAudit)`: Playwright serializes the function source, so it must
 * not reference anything outside its own body (no imports, no module constants — GB_CLASS_RE is inlined below).
 */
export function inPageAudit(): InPageResult {
  const re = /^gb-(element|text|media|container|grid|shape|looper|query)-[a-z0-9]+$/;
  const used = new Set<string>();
  document.querySelectorAll('[class*="gb-"]').forEach((el) => el.classList.forEach((c) => { if (re.test(c)) used.add(c); }));
  const css = Array.from(document.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n");
  const unstyledBlocks = Array.from(used).filter((c) => !css.includes("." + c)).sort();
  const imgs = Array.from(document.images);
  const brokenImages = imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.currentSrc || i.src);
  const missingAlt = imgs.filter((i) => !i.hasAttribute("alt")).length;
  const h1Count = document.querySelectorAll("h1").length;
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) => a.href);
  return { unstyledBlocks, brokenImages, missingAlt, h1Count, links };
}
```

- [ ] **Step 4: Write the browser module**

Replace `src/qa/browser.ts` with:

```ts
// src/qa/browser.ts
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { SiteContext } from "../docker.js";
import { MAX_LINKS, MAX_TILES, VIEWPORTS, screenshotPath, type PageCheck, type Viewport } from "../schemas/qa.js";
import { inPageAudit } from "./inpage.js";

/** GET (following redirects) and return the status; 0 on a network error. Links are pages, so GET is safe and HEAD is often refused. */
export async function fetchStatus(url: string): Promise<number> {
  try { return (await fetch(url, { redirect: "follow" })).status; } catch { return 0; }
}
export const deps = { launch: (): Promise<Browser> => chromium.launch(), fetchStatus };

/** True when the Chromium build matching the installed `playwright` package is present (`npm run setup-playwright`). */
export function chromiumInstalled(): boolean {
  return existsSync(chromium.executablePath());
}

export async function launchBrowser(): Promise<Browser> {
  if (!chromiumInstalled()) throw new Error("Playwright Chromium is not installed — run: npm run setup-playwright");
  return deps.launch();
}

const SKIP_PATH_RE = /^\/(wp-admin|wp-login\.php)/;

/** Same-origin page links to probe: fragment stripped, own url / mailto / tel / admin / external skipped, deduplicated, capped at MAX_LINKS. */
export function linkCandidates(hrefs: string[], pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const self = page.origin + page.pathname + page.search;
  const out: string[] = [];
  for (const h of hrefs) {
    let u: URL;
    try { u = new URL(h, pageUrl); } catch { continue; }
    if (u.origin !== page.origin || SKIP_PATH_RE.test(u.pathname)) continue;
    const clean = u.origin + u.pathname + u.search;
    if (clean === self || out.includes(clean)) continue;
    out.push(clean);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

export type LinkCache = Map<string, Promise<number>>;

/** Probe each link once per run (shared cache); returns the broken ones (status ≥ 400 or 0). */
export async function checkLinks(hrefs: string[], cache: LinkCache): Promise<{ href: string; status: number }[]> {
  const out: { href: string; status: number }[] = [];
  for (const href of hrefs) {
    let p = cache.get(href);
    if (!p) { p = deps.fetchStatus(href); cache.set(href, p); }
    const status = await p;
    if (status === 0 || status >= 400) out.push({ href, status });
  }
  return out;
}

export type ScreenshotTargets = { desktop: string; mobile: string; tile: (viewport: Viewport, n: number) => string };

export function screenshotOpts(ctx: SiteContext, slug: string): ScreenshotTargets {
  return { desktop: screenshotPath(ctx, slug, "desktop"), mobile: screenshotPath(ctx, slug, "mobile"), tile: (v, n) => screenshotPath(ctx, slug, v, n) };
}

/** Scroll to the bottom viewport by viewport (lazy images, animations), then back to the top. */
async function scrollFully(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(200);
}

/** Full-page screenshot plus viewport-height tiles (max MAX_TILES); returns the number of tiles written. */
async function capture(page: Page, viewport: Viewport, targets: ScreenshotTargets): Promise<number> {
  const full = viewport === "desktop" ? targets.desktop : targets.mobile;
  mkdirSync(dirname(full), { recursive: true });
  await page.screenshot({ path: full, fullPage: true });
  const { width, height } = VIEWPORTS[viewport];
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const tiles = Math.max(1, Math.min(MAX_TILES, Math.ceil(total / height)));
  for (let i = 0; i < tiles; i++) {
    const h = Math.max(1, Math.min(height, total - i * height));
    await page.screenshot({ path: targets.tile(viewport, i + 1), fullPage: true, clip: { x: 0, y: i * height, width, height: h } });
  }
  return tiles;
}

/**
 * The deterministic half of the qa stage (spec decision 4 + 5): one browser context, desktop then mobile,
 * every check field of `PageCheck`, screenshots written to `targets`. Never throws on a page defect — a
 * non-200 status is reported in `check.status` and the stage decides (`hasHardFailure`).
 */
export async function checkPage(
  browser: Browser, url: string, targets: ScreenshotTargets, cache: LinkCache = new Map(),
): Promise<{ check: PageCheck; tiles: Record<Viewport, number> }> {
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    const origin = new URL(url).origin;
    const consoleErrors: string[] = [], pageErrors: string[] = [], failedRequests: { url: string; status: number }[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
    page.on("pageerror", (e) => pageErrors.push(String(e.message ?? e).slice(0, 300)));
    page.on("requestfailed", (r) => { if (r.url().startsWith(origin)) failedRequests.push({ url: r.url(), status: 0 }); });
    // Chromium requests /favicon.ico on its own; a site without one is not a page defect.
    page.on("response", (r) => {
      if (!r.url().startsWith(origin) || r.url() === url || r.status() < 400 || new URL(r.url()).pathname === "/favicon.ico") return;
      failedRequests.push({ url: r.url(), status: r.status() });
    });
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    const status = response?.status() ?? 0;
    await scrollFully(page);
    const audit = await page.evaluate(inPageAudit);
    const desktop = await capture(page, "desktop", targets);
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.waitForTimeout(300);
    await scrollFully(page);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const mobile = await capture(page, "mobile", targets);
    const brokenLinks = await checkLinks(linkCandidates(audit.links, url), cache);
    // pageerror can fire after networkidle (setTimeout in the page): give it a tick
    await page.waitForTimeout(100);
    const check: PageCheck = {
      url, status, consoleErrors, pageErrors, failedRequests, brokenLinks,
      brokenImages: audit.brokenImages, missingAlt: audit.missingAlt, unstyledBlocks: audit.unstyledBlocks, h1Count: audit.h1Count,
      mobileOverflow, checkedAt: new Date().toISOString(),
    };
    return { check, tiles: { desktop, mobile } };
  } finally {
    await context.close();
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/qa-browser.test.ts`
Expected: PASS (3 tests in the chromium block, 2 in linkCandidates). Then `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/qa/inpage.ts src/qa/browser.ts tests/unit/qa-browser.test.ts
git commit -m "feat(faktory): qa browser check — in-page audit, links, screenshots with tiles"
```

---

### Task 4: `republishPage` extracted from the pages stage

**Files:**
- Modify: `src/pages/publish.ts`
- Modify: `src/stages/pages.ts` (inner `build`)
- Modify: `tests/unit/stage-pages.test.ts` (spies move to `publish.ts` deps)
- Test: `tests/unit/publish-republish.test.ts`

**Interfaces:**
- Consumes: `applyPlacements`, `pluginPlacements`, `formPlacements`, `readPluginManifests`, `readFormsManifest` (`src/pages/placements.ts`); `assertRendered`, `assertFormRendered` (`src/pages/render-check.ts`).
- Produces: in `src/pages/publish.ts` — `deps = { gbBuild, compilePage, publishPage }`; `type Republished = { markup: string; features: string[]; forms: string[] }`; `republishPage(ctx: SiteContext, spec: SiteSpec, page: Page, id: number, tree: PageTree, opts?: { manifests?: PluginManifest[]; forms?: FormsManifest }): Promise<Republished>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/publish-republish.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { gfPlacement } from "../../src/schemas/forms-manifest.js";
import { FORM_WRAPPER_ATTR, formMarker, type PageTree } from "../../src/schemas/page-tree.js";
import { republishPage, deps } from "../../src/pages/publish.js";
import { deps as renderDeps } from "../../src/pages/render-check.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const home = spec.sitemap.find((p) => p.kind === "home")!;
const contact = spec.sitemap.find((p) => p.slug === "contact")!;
const homeTree = (): PageTree => JSON.parse(readFileSync("fixtures/pages/accueil.gb.json", "utf8"));
const contactTree = (): PageTree => [{ type: "element", tagName: "section", innerBlocks: [
  { type: "text", tagName: "h1", content: "Contact" },
  { type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: "contact" }, innerBlocks: [{ type: "raw", rawMarkup: formMarker("contact") }, { type: "text", tagName: "p", content: "Le formulaire sera disponible ici." }] },
] }];

async function ctx() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-republish-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}
function spies(html = '<div data-faktory-plugin="catalogue_produits"></div><div id="gform_wrapper_1"></div>') {
  const compile = vi.spyOn(deps, "compilePage").mockImplementation(async (_c, slug) => `<!-- ${slug} -->`);
  const publish = vi.spyOn(deps, "publishPage").mockResolvedValue(undefined);
  const fetchText = vi.spyOn(renderDeps, "fetchText").mockResolvedValue(html);
  return { compile, publish, fetchText };
}

describe("republishPage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("applies the manifests read from the site dir, compiles, publishes and checks the render contract", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "plugins"), { recursive: true });
    copyFileSync("fixtures/plugins/catalogue_produits.manifest.json", join(c.siteDir, "plugins/catalogue_produits.json"));
    const s = spies();
    const r = await republishPage(c, spec, home, 10, homeTree());
    expect(r).toEqual({ markup: "<!-- accueil -->", features: ["catalogue_produits"], forms: [] });
    const compiled = s.compile.mock.calls[0][2] as PageTree;
    expect(JSON.stringify(compiled)).not.toContain("data-faktory-feature");
    expect(s.publish).toHaveBeenCalledWith(c, 10, "<!-- accueil -->");
    expect(s.fetchText).toHaveBeenCalledWith(`http://localhost:${c.state.port}/`);
  });
  it("accepts pre-read manifests and applies form placements", async () => {
    const c = await ctx();
    const s = spies();
    const r = await republishPage(c, spec, contact, 15, contactTree(), { manifests: [], forms: { contact: { gfId: 1, placement: gfPlacement(1) } } });
    expect(r.forms).toEqual(["contact"]);
    expect(JSON.stringify(s.compile.mock.calls[0][2])).toContain("gravityforms/form");
    expect(s.fetchText).toHaveBeenCalledWith(`http://localhost:${c.state.port}/contact/`);
  });
  it("fails when an applied form does not render", async () => {
    const c = await ctx();
    spies("<html>no form</html>");
    await expect(republishPage(c, spec, contact, 15, contactTree(), { manifests: [], forms: { contact: { gfId: 1, placement: gfPlacement(1) } } }))
      .rejects.toThrow(/\/contact\/ \(contact\) does not render gform_wrapper_1"/);
  });
  it("fetches nothing when nothing applies", async () => {
    const c = await ctx();
    const s = spies();
    writeFileSync(join(c.siteDir, "content/forms.json"), "{}");
    const r = await republishPage(c, spec, contact, 15, contactTree());
    expect(r).toEqual({ markup: "<!-- contact -->", features: [], forms: [] });
    expect(s.fetchText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/publish-republish.test.ts`
Expected: FAIL — `republishPage` is not exported.

- [ ] **Step 3: Implement `republishPage`**

Replace `src/pages/publish.ts` with:

```ts
// src/pages/publish.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SiteContext } from "../docker.js";
import { gbBuild } from "../gb.js";
import { wpOk } from "../wp.js";
import { pageMarkupPath } from "../artifacts.js";
import { GP_PAGE_META } from "../provision/pages.js";
import { FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type PageTree } from "../schemas/page-tree.js";
import type { Page, SiteSpec } from "../schemas/site-spec.js";
import type { PluginManifest } from "../schemas/plugin-manifest.js";
import type { FormsManifest } from "../schemas/forms-manifest.js";
import { applyPlacements, formPlacements, pluginPlacements, readFormsManifest, readPluginManifests } from "./placements.js";
import { assertFormRendered, assertRendered } from "./render-check.js";

/** Compile a validated tree with gb_build.py and keep the markup next to the tree (`pages/<slug>.html`). */
export async function compilePage(ctx: SiteContext, slug: string, tree: PageTree): Promise<string> {
  const markup = await deps.gbBuild(ctx.config, tree);
  const out = pageMarkupPath(ctx, slug);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, markup);
  return markup;
}

/** Replace the page content (markup on stdin, same as the footer element) and re-assert the GP landing-page meta. */
export async function publishPage(ctx: SiteContext, id: number, markup: string): Promise<void> {
  await wpOk(ctx, ["post", "update", String(id), "-", "--post_status=publish"], { input: markup });
  for (const [k, v] of GP_PAGE_META) await wpOk(ctx, ["post", "meta", "update", String(id), k, v]);
}

export type Republished = { markup: string; features: string[]; forms: string[] };

/**
 * The whole "tree on disk → live page" path shared by the pages and qa stages (phase 6 decision 7): apply the
 * plugin and form placements at compile time, compile, publish, then fetch the page and require the render
 * attribute of every applied plugin and the wrapper of every applied form. `opts` lets a caller that loops over
 * pages read the manifests once.
 */
export async function republishPage(
  ctx: SiteContext, spec: SiteSpec, page: Page, id: number, tree: PageTree,
  opts: { manifests?: PluginManifest[]; forms?: FormsManifest } = {},
): Promise<Republished> {
  void spec;
  const manifests = opts.manifests ?? readPluginManifests(ctx);
  const forms = opts.forms ?? readFormsManifest(ctx);
  const a = applyPlacements(tree, [...pluginPlacements(manifests, page.slug), ...formPlacements(forms, page)]);
  const features = a.applied.filter((p) => p.attr === FEATURE_WRAPPER_ATTR).map((p) => p.id);
  const applied = a.applied.filter((p) => p.attr === FORM_WRAPPER_ATTR).map((p) => p.id);
  const markup = await deps.compilePage(ctx, page.slug, a.tree);
  await deps.publishPage(ctx, id, markup);
  for (const f of features) await assertRendered(ctx, page, f);
  for (const f of applied) await assertFormRendered(ctx, page, forms[f].gfId);
  return { markup, features, forms: applied };
}

// After the function declarations (hoisted) so the spy seam covers compile/publish too.
export const deps = { gbBuild, compilePage, publishPage };
```

`spec` is accepted (and voided) so callers pass the same shape everywhere; the qa stage passes it too.

- [ ] **Step 4: Use it in the pages stage**

In `src/stages/pages.ts`: replace the imports of `compilePage, publishPage` and `applyPlacements, pluginPlacements, formPlacements` and `assertRendered, assertFormRendered` and the `FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR` import by:

```ts
import { republishPage } from "../pages/publish.js";
import { readPluginManifests, readFormsManifest } from "../pages/placements.js";
import type { PageTree } from "../schemas/page-tree.js";
```

set `export const deps = { ensurePages, generatePageTree, republishPage };` and replace the body of `build` after the tree is obtained (from `const formPl = …` down to the `console.log`) by:

```ts
      const r = await deps.republishPage(ctx, spec, page, ids[page.slug], tree, { manifests, forms });
      r.features.forEach((id) => applied.add(id));
      r.forms.forEach((id) => formsApplied.add(id));
      console.log(`  ✔ ${page.kind === "home" ? "/" : `/${page.slug}/`} published`);
```

- [ ] **Step 5: Move the stage test's spies**

In `tests/unit/stage-pages.test.ts` add `import { deps as publishDeps } from "../../src/pages/publish.js";` and in `spies()` change:

```ts
  const compile = vi.spyOn(publishDeps, "compilePage").mockImplementation(async (_c, slug) => { order.push(`compile:${slug}`); return `<!-- ${slug} -->`; });
  const publish = vi.spyOn(publishDeps, "publishPage").mockImplementation(async (_c, id) => { order.push(`publish:${id}`); });
```

Everything else in that file stays as it is (same order, same call shapes).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/publish-republish.test.ts tests/unit/stage-pages.test.ts tests/unit/pages-publish.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/publish.ts src/stages/pages.ts tests/unit/publish-republish.test.ts tests/unit/stage-pages.test.ts
git commit -m "refactor(faktory): republishPage — shared tree-to-live-page path for pages and qa"
```

---

### Task 5: QA prompt and `reviewPage` (agent, validation, restoration)

**Files:**
- Create: `src/prompts/qa.md`
- Modify: `src/prompts.ts` (`PromptName` gains `"qa"`)
- Create: `src/qa/review.ts`
- Test: `tests/unit/qa-review.test.ts`; modify `tests/unit/prompts.test.ts`

**Interfaces:**
- Consumes: `runAgent`, `runValidated`, `AgentRun` (`src/agent.ts`); `readPageTree` (`src/pages/generate.ts`); `loadPrompt`; `toJsonSchema`; `TOOL_GB_BUILD`; `pageTreePath`, `pageTreeRel`; `checkIssues`, `parseQaVerdict`, `assertVerdict`, `screenshotRel`, `QaVerdict`, `Viewport`, `PageCheck` (`src/schemas/qa.ts`).
- Produces (`src/qa/review.ts`): `deps = { runAgent }`; `QA_MAX_TURNS = 20`; `QA_TOOLS = ["Read", "Write", TOOL_GB_BUILD]`; `QA_WRITE_ROOTS = ["pages"]`; `screenshotList(slug, tiles: Record<Viewport, number>): string[]`; `qaUserPrompt(spec, page, check, tiles): string`; `qaResumePrompt(check): string`; `type ReviewResult = { verdict: QaVerdict; treeChanged: boolean; tree: PageTree; costUsd: number; attempts: 1 | 2; sessionId?: string; rejected?: string }`; `reviewPage(ctx, spec, page, check, tiles, opts?: { resume?: string }): Promise<ReviewResult>`.

- [ ] **Step 1: Write the system prompt**

```markdown
<!-- src/prompts/qa.md -->
Tu es le relecteur QA de Partikuls : l'œil du designer et de l'intégrateur sur UNE page d'un site WordPress GeneratePress + GenerateBlocks déjà publiée. Tu n'es pas rédacteur. Tu travailles dans le dossier du site (cwd) : tous les chemins sont relatifs à ce dossier.

## Entrées (à lire avec Read, dans cet ordre)
1. Les captures listées dans le prompt : la page entière puis ses tuiles, en desktop (1440 px) puis en mobile (390 px). Les tuiles sont la page à l'échelle, dans l'ordre de lecture ; la page entière donne la vue d'ensemble.
2. `design-system.md` — la doctrine du site : typographies, couleurs, espacements, composants.
3. `pages/<slug>.gb.json` — l'arbre `gb_build` de la page, la seule chose que tu peux modifier.
Le prompt te donne aussi les défauts relevés automatiquement (console, requêtes, liens, images, blocs sans CSS, `h1`, débordement mobile) et les sections attendues par la spécification. Ne lis rien d'autre.

## Ce que tu cherches
- Hiérarchie et lisibilité : titres, contrastes, tailles de texte, longueurs de ligne.
- Respect du design system : couleurs (`var(--…)` uniquement), espacements de l'échelle, typographies, rayons, boutons.
- Cohérence avec la spécification : chaque section attendue est présente, dans l'ordre, avec un contenu qui correspond à son résumé.
- Responsive : grilles et rangées empilées en mobile, aucun débordement horizontal, titres réduits, boutons et liens lisibles et cliquables, images à la bonne taille.
- Images : présentes, `alt` renseigné.
- Les défauts automatiques qui relèvent de l'arbre (`h1` en double ou absent, `alt` manquant, débordement, image cassée dans l'arbre).

## Ce que tu ne fais pas
- Réécrire la copy (une coquille visible peut être corrigée, rien de plus), ajouter ou retirer une section.
- Toucher aux enveloppes `data-faktory-feature` / `data-faktory-form` ni aux nœuds marqueurs `<!-- faktory:… -->` : ils sont obligatoires, à l'identique. Le rendu d'un plugin ou d'un formulaire qui les remplace n'est pas dans l'arbre : s'il est défectueux, signale-le avec `action: "left"`.
- Introduire une couleur hex ou `rgb()`, du `<script>`, un `<iframe>`, un `javascript:` ou un `on*=`.
- Écrire ailleurs que dans `pages/<slug>.gb.json`. Pas de Bash, pas de `wp`.

## Comment tu corriges
Modifie l'arbre avec `Write` (le fichier entier, JSON valide, mêmes conventions que l'existant), puis vérifie-le avec `gb_build` : `{ "tree": <le tableau>, "out": "pages/<slug>.gb.html" }`. Deux allers-retours au plus. Ne corrige que ce qui est visible et sûr ; dans le doute, laisse et signale. Faktory republie la page, la recontrôle et te relance pour un second tour si tu as modifié l'arbre.

## Sortie
Uniquement l'objet JSON structuré demandé :
- `verdict` : `ok` si tu n'as rien modifié et rien laissé ; `fixed` si tu as réécrit l'arbre (au moins un `issue` avec `action: "fixed"`) ; `needs_human` si au moins un défaut est laissé (`action: "left"`).
- `summary` : une à deux phrases en français.
- `issues` : un élément par défaut constaté, `severity` `major` (visible par tout visiteur) ou `minor`, `where` (section ou élément), `what` (le défaut), `action` `fixed` ou `left`.
Un verdict `fixed` sans modification réelle du fichier est refusé, comme un verdict `ok` avec un défaut laissé.
```

In `src/prompts.ts` change `export type PromptName = "spec" | "design" | "pages" | "plugins" | "content";` to `… | "content" | "qa";`. In `tests/unit/prompts.test.ts` add:

```ts
  it("loads the qa prompt with its key rules", () => {
    const p = loadPrompt("qa");
    for (const s of ["design-system.md", "pages/<slug>.gb.json", "data-faktory-feature", "data-faktory-form", "gb_build", "needs_human", "action: \"left\""]) expect(p).toContain(s);
  });
```

- [ ] **Step 2: Write the failing review test**

```ts
// tests/unit/qa-review.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { writeState } from "../../src/state.js";
import { pageTreePath } from "../../src/artifacts.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { TOOL_GB_BUILD } from "../../src/tools/server.js";
import type { PageCheck } from "../../src/schemas/qa.js";
import type { AgentRun } from "../../src/agent.js";
import { qaUserPrompt, qaResumePrompt, screenshotList, reviewPage, deps, QA_MAX_TURNS, QA_TOOLS, QA_WRITE_ROOTS } from "../../src/qa/review.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const home = spec.sitemap.find((p) => p.kind === "home")!;
const check = (): PageCheck => ({ ...JSON.parse(readFileSync("fixtures/qa/contact.check.json", "utf8")), url: "http://localhost:8101/" });
const TILES = { desktop: 2, mobile: 4 } as const;
const OK = { verdict: "ok", summary: "Rien à signaler.", issues: [] };
const FIXED = { verdict: "fixed", summary: "Titre mobile réduit.", issues: [{ severity: "minor", where: "section hero", what: "titre trop grand en mobile", action: "fixed" }] };

async function ctx() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-qareview-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  mkdirSync(join(c.siteDir, "pages"), { recursive: true });
  copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, "accueil"));
  return c;
}
/** Simulates the agent: optionally rewrites the tree (adding cost to the state like runAgent does), then returns `structured`. */
function agent(steps: { structured: unknown; rewrite?: string; cost?: number }[]) {
  let i = 0;
  return vi.spyOn(deps, "runAgent").mockImplementation(async (c, opts) => {
    const s = steps[Math.min(i++, steps.length - 1)];
    if (s.rewrite !== undefined) writeFileSync(pageTreePath(c, "accueil"), s.rewrite);
    c.state = { ...c.state, costUsd: c.state.costUsd + (s.cost ?? 0.5) };
    writeState(c.siteDir, c.state);
    return { text: "", transcript: "", structured: s.structured, costUsd: s.cost ?? 0.5, sessionId: `s${i}`, numTurns: 3 } satisfies AgentRun;
  });
}

describe("qa prompts", () => {
  it("lists the screenshots full page first, then tiles, desktop then mobile", () => {
    expect(screenshotList("accueil", TILES)).toEqual([
      "qa/accueil.desktop.png", "qa/accueil.desktop.1.png", "qa/accueil.desktop.2.png",
      "qa/accueil.mobile.png", "qa/accueil.mobile.1.png", "qa/accueil.mobile.2.png", "qa/accueil.mobile.3.png", "qa/accueil.mobile.4.png",
    ]);
  });
  it("user prompt carries the page, its sections, the automated issues and the files to read", () => {
    const p = qaUserPrompt(spec, home, { ...check(), h1Count: 2, mobileOverflow: true }, TILES);
    expect(p).toContain("# Page `accueil` — ");
    expect(p).toContain("1. **hero**");
    expect(p).toContain("- 2 h1 (attendu : 1)");
    expect(p).toContain("- débordement horizontal en mobile");
    expect(p).toContain("qa/accueil.desktop.png");
    expect(p).toContain("qa/accueil.mobile.4.png");
    expect(p).toContain("pages/accueil.gb.json");
    expect(p).toContain("design-system.md");
    expect(qaUserPrompt(spec, home, check(), TILES)).toContain("Aucun défaut automatique.");
  });
  it("resume prompt says the page was republished and lists the remaining automated issues", () => {
    const p = qaResumePrompt({ ...check(), missingAlt: 1 });
    expect(p).toContain("republiée");
    expect(p).toContain("- 1 image(s) sans alt");
    expect(qaResumePrompt(check())).toContain("Aucun défaut automatique.");
  });
});

describe("reviewPage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("runs the qa agent with the right options and returns an unchanged tree on ok", async () => {
    const c = await ctx();
    const run = agent([{ structured: OK, cost: 0.4 }]);
    const r = await reviewPage(c, spec, home, check(), TILES);
    expect(r.verdict).toEqual(OK);
    expect(r.treeChanged).toBe(false);
    expect(r.attempts).toBe(1);
    expect(r.costUsd).toBe(0.4);
    expect(r.sessionId).toBe("s1");
    const opts = run.mock.calls[0][1];
    expect(opts.stage).toBe("qa");
    expect(opts.allowedTools).toEqual(["Read", "Write", TOOL_GB_BUILD]);
    expect(QA_TOOLS).toEqual(["Read", "Write", TOOL_GB_BUILD]);
    expect(opts.maxTurns).toBe(QA_MAX_TURNS);
    expect(opts.writeRoots).toEqual(QA_WRITE_ROOTS);
    expect(opts.outputFormat?.type).toBe("json_schema");
    expect(opts.resume).toBeUndefined();
    expect(opts.systemPrompt).toContain("relecteur QA");
  });
  it("returns the rewritten, validated tree on fixed", async () => {
    const c = await ctx();
    const tree = JSON.parse(readFileSync(pageTreePath(c, "accueil"), "utf8"));
    tree[0].styles = { ...(tree[0].styles ?? {}), paddingTop: "32px" };
    agent([{ structured: FIXED, rewrite: JSON.stringify(tree, null, 2) }]);
    const r = await reviewPage(c, spec, home, check(), TILES);
    expect(r.treeChanged).toBe(true);
    expect(r.verdict.verdict).toBe("fixed");
    expect((r.tree[0].styles as any).paddingTop).toBe("32px");
  });
  it("resumes the given session for a second round", async () => {
    const c = await ctx();
    const run = agent([{ structured: OK }]);
    await reviewPage(c, spec, home, check(), TILES, { resume: "prev" });
    expect(run.mock.calls[0][1].resume).toBe("prev");
    expect(run.mock.calls[0][1].prompt).toContain("republiée");
  });
  it("retries once on an inconsistent verdict, then accepts", async () => {
    const c = await ctx();
    const run = agent([{ structured: FIXED }, { structured: OK }]); // "fixed" without a change → retry → ok
    const r = await reviewPage(c, spec, home, check(), TILES);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][1].resume).toBe("s1");
    expect(run.mock.calls[1][1].prompt).toContain("did not change");
    expect(r.attempts).toBe(2);
    expect(r.verdict).toEqual(OK);
    expect(r.costUsd).toBe(1);
  });
  it("restores an invalid rewritten tree and reports a rejected fix instead of failing", async () => {
    const c = await ctx();
    const before = readFileSync(pageTreePath(c, "accueil"), "utf8");
    agent([{ structured: FIXED, rewrite: "[]" }, { structured: FIXED, rewrite: "{ nope" }]);
    const r = await reviewPage(c, spec, home, check(), TILES);
    expect(readFileSync(pageTreePath(c, "accueil"), "utf8")).toBe(before);
    expect(r.treeChanged).toBe(false);
    expect(r.verdict.verdict).toBe("needs_human");
    expect(r.verdict.issues).toHaveLength(1);
    expect(r.verdict.issues[0]).toMatchObject({ severity: "major", where: "pages/accueil.gb.json", action: "left" });
    expect(r.verdict.issues[0].what).toMatch(/correction refusée : .*not valid JSON/);
    expect(r.rejected).toMatch(/output still invalid after one retry/);
    expect(r.attempts).toBe(2);
  });
  it("propagates other agent failures (budget, SDK error)", async () => {
    const c = await ctx();
    vi.spyOn(deps, "runAgent").mockRejectedValue(new Error("Cost budget reached ($40.00 >= $40)"));
    await expect(reviewPage(c, spec, home, check(), TILES)).rejects.toThrow(/Cost budget reached/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/qa-review.test.ts tests/unit/prompts.test.ts`
Expected: FAIL — cannot resolve `../../src/qa/review.js`; the prompts test fails on `loadPrompt("qa")` until Step 1's file exists (Step 1 already wrote it, so only the review test should fail now).

- [ ] **Step 4: Write `src/qa/review.ts`**

```ts
// src/qa/review.ts
import { readFileSync, writeFileSync } from "node:fs";
import type { SiteContext } from "../docker.js";
import { runAgent, runValidated, type AgentRun } from "../agent.js";
import { pageTreePath, pageTreeRel } from "../artifacts.js";
import { readPageTree } from "../pages/generate.js";
import { loadPrompt } from "../prompts.js";
import { toJsonSchema } from "../schemas/json-schema.js";
import type { PageTree } from "../schemas/page-tree.js";
import type { Page, SiteSpec } from "../schemas/site-spec.js";
import { assertVerdict, checkIssues, parseQaVerdict, screenshotRel, QaVerdictShape, type PageCheck, type QaVerdict, type Viewport } from "../schemas/qa.js";
import { TOOL_GB_BUILD } from "../tools/server.js";

export const deps = { runAgent };
export const QA_MAX_TURNS = 20;
export const QA_TOOLS = ["Read", "Write", TOOL_GB_BUILD];
export const QA_WRITE_ROOTS = ["pages"];

/** Site-relative screenshot paths in reading order: full page then tiles, desktop then mobile. */
export function screenshotList(slug: string, tiles: Record<Viewport, number>): string[] {
  const out: string[] = [];
  for (const v of ["desktop", "mobile"] as const) {
    out.push(screenshotRel(slug, v));
    for (let i = 1; i <= tiles[v]; i++) out.push(screenshotRel(slug, v, i));
  }
  return out;
}

function issueLines(check: PageCheck): string[] {
  const issues = checkIssues(check);
  return issues.length ? issues.map((i) => `- ${i}`) : ["Aucun défaut automatique."];
}

export function qaUserPrompt(spec: SiteSpec, page: Page, check: PageCheck, tiles: Record<Viewport, number>): string {
  const id = spec.identity;
  return [
    `# Page \`${page.slug}\` — ${page.title} [${page.kind}] — ${check.url}`,
    `Objectif : ${page.goal}`,
    `Site : ${id.name} — ${id.sector}${id.location ? ` (${id.location})` : ""}. Ton : ${id.tone}.`,
    "",
    "## Sections attendues (dans cet ordre)",
    ...page.sections.map((s, i) => `${i + 1}. **${s.type}** « ${s.heading} » — ${s.summary}`),
    "",
    "## Défauts relevés automatiquement",
    ...issueLines(check),
    "",
    "## Captures (à lire avec Read, dans cet ordre)",
    ...screenshotList(page.slug, tiles).map((p) => `- \`${p}\``),
    "",
    "## À faire",
    `Lis les captures, puis \`design-system.md\` et \`${pageTreeRel(page.slug)}\`. Corrige l'arbre si nécessaire (Write + \`gb_build\`), puis réponds avec l'objet JSON demandé.`,
  ].join("\n");
}

/** Second round, same session: the page was republished, the screenshots overwritten at the same paths. */
export function qaResumePrompt(check: PageCheck): string {
  return [
    "La page a été republiée avec ton arbre corrigé et recontrôlée ; les captures ont été refaites aux mêmes chemins (relis-les).",
    "",
    "## Défauts relevés automatiquement après correction",
    ...issueLines(check),
    "",
    "Relis la page, corrige ce qui reste si c'est sûr (Write + `gb_build`), puis réponds avec l'objet JSON demandé.",
  ].join("\n");
}

export type ReviewResult = {
  verdict: QaVerdict; treeChanged: boolean; tree: PageTree; costUsd: number; attempts: 1 | 2; sessionId?: string;
  /** Set when the agent's rewritten tree was still invalid after the retry: the file was restored and the verdict synthesized. */
  rejected?: string;
};

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * One agent review of a page (spec decision 6): structured verdict validated against the tree on disk, one retry in
 * the same session, and — when the rewritten tree is still invalid — restoration of the previous tree plus a synthetic
 * `needs_human` verdict so the page is never lost and the stage keeps going.
 */
export async function reviewPage(
  ctx: SiteContext, spec: SiteSpec, page: Page, check: PageCheck, tiles: Record<Viewport, number>, opts: { resume?: string } = {},
): Promise<ReviewResult> {
  const rel = pageTreeRel(page.slug), abs = pageTreePath(ctx, page.slug);
  const before = readFileSync(abs, "utf8");
  const originalTree = readPageTree(ctx, page);
  const startCost = ctx.state.costUsd;
  const validate = (run: AgentRun): { verdict: QaVerdict; changed: boolean; tree: PageTree } => {
    const verdict = parseQaVerdict(run.structured);
    const changed = readFileSync(abs, "utf8") !== before;
    let tree = originalTree;
    if (changed) {
      try { tree = readPageTree(ctx, page); }
      catch (err) { throw new Error(`${rel} was rewritten but is invalid: ${err instanceof Error ? err.message : String(err)}`); }
    }
    assertVerdict(verdict, changed);
    return { verdict, changed, tree };
  };
  try {
    const r = await runValidated(deps.runAgent, ctx, {
      stage: "qa",
      systemPrompt: loadPrompt("qa"),
      prompt: opts.resume ? qaResumePrompt(check) : qaUserPrompt(spec, page, check, tiles),
      allowedTools: QA_TOOLS,
      outputFormat: { type: "json_schema", schema: toJsonSchema(QaVerdictShape) },
      maxTurns: QA_MAX_TURNS,
      writeRoots: QA_WRITE_ROOTS,
      resume: opts.resume,
    }, validate);
    return { verdict: r.value.verdict, treeChanged: r.value.changed, tree: r.value.tree, costUsd: round4(ctx.state.costUsd - startCost), attempts: r.attempts, sessionId: r.run.sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("output still invalid after one retry")) throw err;
    if (readFileSync(abs, "utf8") !== before) writeFileSync(abs, before);
    console.warn(`  ⚠ ${rel}: fix rejected, previous tree restored — ${message.split("\n")[0].slice(0, 200)}`);
    return {
      verdict: { verdict: "needs_human", summary: "Correction refusée par Faktory : arbre restauré.", issues: [{ severity: "major", where: rel, what: `correction refusée : ${message}`, action: "left" }] },
      treeChanged: false, tree: originalTree, costUsd: round4(ctx.state.costUsd - startCost), attempts: 2, rejected: message,
    };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/qa-review.test.ts tests/unit/prompts.test.ts && npm run typecheck`
Expected: PASS. (`runValidated` resumes with `first.sessionId`, so the retry's `resume` is `s1` and its prompt is `retryPrompt(error)`, which contains the validation message — the test checks "did not change".)

- [ ] **Step 6: Commit**

```bash
git add src/prompts/qa.md src/prompts.ts src/qa/review.ts tests/unit/qa-review.test.ts tests/unit/prompts.test.ts
git commit -m "feat(faktory): qa prompt and reviewPage — structured verdict, retry, tree restoration"
```

---

### Task 6: QA report rendering

**Files:**
- Create: `src/qa/report.ts`
- Test: `tests/unit/qa-report.test.ts`

**Interfaces:**
- Consumes: `QaReport`, `QaPage`, `checkIssues`, `remainingIssues`, `qaReportJsonPath`, `qaReportMdPath` (`src/schemas/qa.ts`).
- Produces: `renderQaReport(report: QaReport, siteName: string): string`; `writeQaReport(ctx, report, siteName): void` (writes `qa/report.json` and `qa/QA-REPORT.md`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/qa-report.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { parseQaReport, qaReportJsonPath, qaReportMdPath } from "../../src/schemas/qa.js";
import { renderQaReport, writeQaReport } from "../../src/qa/report.js";

const report = () => parseQaReport(JSON.parse(readFileSync("fixtures/qa/report.json", "utf8")));

describe("renderQaReport", () => {
  it("renders the summary, one section per url, the checks table, the issues and the screenshot links", () => {
    const md = renderQaReport(report(), "Maison Rivet");
    expect(md.startsWith("# Rapport QA — Maison Rivet\n")).toBe(true);
    expect(md).toContain("2026-09-13");
    expect(md).toContain("2 URL contrôlées, 1 page relue (0 ok, 1 corrigée, 0 à revoir), 0 défaut restant — $1.23");
    expect(md).toContain("## /contact/ — corrigée");
    expect(md).toContain("| Statut HTTP | 200 |");
    expect(md).toContain("| Erreurs console | 0 |");
    expect(md).toContain("| Blocs GenerateBlocks sans CSS | 0 |");
    expect(md).toContain("| Débordement mobile | non |");
    expect(md).toContain("Tours : 1");
    expect(md).toContain("- [corrigé] (mineur) section form — bouton sans focus-visible");
    expect(md).toContain("Captures : [desktop](contact.desktop.png) · [mobile](contact.mobile.png)");
    expect(md).toContain("## /actualites/ — contrôle seul");
    expect(md).toContain("Bouton du formulaire sans état focus, corrigé.");
  });
  it("marks a page with remaining issues and lists the automated defects", () => {
    const r = report();
    r.pages[0].verdict = "needs_human";
    r.pages[0].issues = [{ severity: "major", where: "section hero", what: "titre illisible", action: "left" }];
    r.pages[0].check = { ...r.pages[0].check, h1Count: 2 };
    r.totals = { ...r.totals, fixed: 0, needsHuman: 1, remainingIssues: 1 };
    const md = renderQaReport(r, "X");
    expect(md).toContain("## /contact/ — à revoir");
    expect(md).toContain("- [restant] (majeur) section hero — titre illisible");
    expect(md).toContain("Défauts automatiques : 2 h1 (attendu : 1)");
    expect(md).toContain("1 défaut restant");
  });
  it("writeQaReport writes both files", async () => {
    const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-qareport-")));
    await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
    const c = loadContext(config, "boul");
    writeQaReport(c, report(), "Maison Rivet");
    expect(existsSync(qaReportMdPath(c))).toBe(true);
    expect(parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8"))).pages).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/qa-report.test.ts`
Expected: FAIL — cannot resolve `../../src/qa/report.js`.

- [ ] **Step 3: Write the renderer**

```ts
// src/qa/report.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SiteContext } from "../docker.js";
import { checkIssues, qaReportJsonPath, qaReportMdPath, QA_DIR, type QaPage, type QaReport } from "../schemas/qa.js";

const VERDICT_FR: Record<NonNullable<QaPage["verdict"]>, string> = { ok: "ok", fixed: "corrigée", needs_human: "à revoir" };
const yesNo = (b: boolean): string => (b ? "oui" : "non");
const rel = (p: string): string => p.startsWith(`${QA_DIR}/`) ? p.slice(QA_DIR.length + 1) : p;
// French: zero takes the singular ("0 défaut restant")
const plural = (n: number, s: string, p: string): string => `${n} ${n > 1 ? p : s}`;

function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

function pageSection(p: QaPage): string {
  const c = p.check;
  const heading = p.reviewed && p.verdict ? VERDICT_FR[p.verdict] : "contrôle seul";
  const lines = [
    `## ${pathOf(p.url)} — ${heading}${p.reused ? " (réutilisé)" : ""}`,
    "",
    "| Contrôle | Résultat |",
    "|---|---|",
    `| Statut HTTP | ${c.status} |`,
    `| Erreurs console | ${c.consoleErrors.length} |`,
    `| Exceptions JavaScript | ${c.pageErrors.length} |`,
    `| Requêtes en échec | ${c.failedRequests.length} |`,
    `| Liens cassés | ${c.brokenLinks.length} |`,
    `| Images cassées | ${c.brokenImages.length} |`,
    `| Images sans alt | ${c.missingAlt} |`,
    `| Blocs GenerateBlocks sans CSS | ${c.unstyledBlocks.length} |`,
    `| h1 | ${c.h1Count} |`,
    `| Débordement mobile | ${yesNo(c.mobileOverflow)} |`,
    "",
  ];
  const auto = checkIssues(c);
  if (auto.length) lines.push(`Défauts automatiques : ${auto.join(" ; ")}`, "");
  if (p.reviewed) {
    lines.push(`Tours : ${p.rounds}${p.costUsd ? ` — $${p.costUsd.toFixed(2)}` : ""}`, "");
    if (p.summary) lines.push(p.summary, "");
    if (p.issues.length) {
      for (const i of p.issues) lines.push(`- [${i.action === "fixed" ? "corrigé" : "restant"}] (${i.severity === "major" ? "majeur" : "mineur"}) ${i.where} — ${i.what}`);
      lines.push("");
    }
  }
  lines.push(`Captures : [desktop](${rel(p.screenshots.desktop)}) · [mobile](${rel(p.screenshots.mobile)})`, "");
  return lines.join("\n");
}

/** Human report (spec « Verdict de l'agent et rapport »): French, one section per URL in report order, links relative to `qa/`. */
export function renderQaReport(report: QaReport, siteName: string): string {
  const t = report.totals;
  const summary = `${plural(t.urls, "URL contrôlée", "URL contrôlées")}, ${plural(t.reviewed, "page relue", "pages relues")} (${t.ok} ok, ${t.fixed} corrigée${t.fixed === 1 ? "" : "s"}, ${t.needsHuman} à revoir), ${plural(t.remainingIssues, "défaut restant", "défauts restants")} — $${report.costUsd.toFixed(2)}`;
  return [
    `# Rapport QA — ${siteName}`,
    "",
    `Généré le ${report.generatedAt.slice(0, 10)} sur ${report.siteUrl}.`,
    "",
    summary,
    "",
    ...report.pages.map(pageSection),
  ].join("\n");
}

export function writeQaReport(ctx: SiteContext, report: QaReport, siteName: string): void {
  const json = qaReportJsonPath(ctx), md = qaReportMdPath(ctx);
  mkdirSync(dirname(json), { recursive: true });
  writeFileSync(json, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(md, renderQaReport(report, siteName));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/qa-report.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/report.ts tests/unit/qa-report.test.ts
git commit -m "feat(faktory): qa report — report.json and QA-REPORT.md renderer"
```

---

### Task 7: The `qa` stage and its registration

**Files:**
- Create: `src/stages/qa.ts`
- Modify: `src/pipeline.ts` (`registry.qa`)
- Test: `tests/unit/stage-qa.test.ts`; modify `tests/unit/pipeline.test.ts` (registry keys)

**Interfaces:**
- Consumes: everything produced by Tasks 2–6; `mapLimit`; `assertBudget`; `ensurePages`; `pageUrl`; `siteUrl`; `articleSlug`; `readPluginManifests`, `readFormsManifest`.
- Produces: `qaStage: Stage`; `QA_CONCURRENCY = 3`; `deps = { ensurePages, launchBrowser, checkPage, reviewPage, republishPage, readQaReport }`; `qaTargets(ctx, spec): Target[]` with `type Target = { slug: string; kind: QaPage["kind"]; url: string; page?: Page }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/stage-qa.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext, registry } from "../../src/pipeline.js";
import { writeJsonArtifact, pageTreePath } from "../../src/artifacts.js";
import { parseSiteSpec, type Page } from "../../src/schemas/site-spec.js";
import { featureMarker, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type PageTree } from "../../src/schemas/page-tree.js";
import { articleSlug } from "../../src/schemas/article.js";
import { checkPath, qaReportJsonPath, qaReportMdPath, parseQaReport, treeHash, QA_REPORT_JSON, type PageCheck, type QaReport } from "../../src/schemas/qa.js";
import { qaStage, deps, QA_CONCURRENCY, qaTargets } from "../../src/stages/qa.js";
import type { ReviewResult } from "../../src/qa/review.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const IDS: Record<string, number> = { accueil: 10, "nos-produits": 11, "commandes-evenements": 12, "la-maison": 13, actualites: 14, contact: 15 };
const NON_BLOG = ["accueil", "nos-produits", "commandes-evenements", "la-maison", "contact"];
const ARTICLES = spec.blog.articles.map((a) => articleSlug(a.title));
const fixtureCheck = (): PageCheck => JSON.parse(readFileSync("fixtures/qa/contact.check.json", "utf8"));
const tick = () => new Promise<void>((r) => setTimeout(r, 5));

function stubTree(page: Page): PageTree {
  return page.sections.map((s, i) => ({
    type: "element" as const, tagName: "section", htmlAttributes: { id: `s-${i}` }, styles: { padding: "48px 24px" },
    innerBlocks: [
      { type: "text" as const, tagName: i === 0 ? "h1" : "h2", content: s.heading },
      ...(s.type === "custom-query" && s.feature ? [{ type: "element" as const, tagName: "div", htmlAttributes: { [FEATURE_WRAPPER_ATTR]: s.feature }, innerBlocks: [{ type: "text" as const, tagName: "p", content: "Exemple" }, { type: "raw" as const, rawMarkup: featureMarker(s.feature) }] }] : []),
      ...((s.type === "form" || s.type === "contact") && s.form && !page.sections.slice(0, i).some((x) => x.form === s.form)
        ? [{ type: "element" as const, tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: s.form }, innerBlocks: [{ type: "raw" as const, rawMarkup: formMarker(s.form) }, { type: "text" as const, tagName: "p", content: "Le formulaire sera disponible ici." }] }]
        : []),
    ],
  }));
}

async function ctx(opts: { trees?: string[] } = {}): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stqa-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  writeJsonArtifact(c, "siteSpecJson", spec);
  mkdirSync(join(c.siteDir, "pages"), { recursive: true });
  for (const slug of opts.trees ?? NON_BLOG) {
    const page = spec.sitemap.find((p) => p.slug === slug)!;
    if (slug === "accueil") copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, slug));
    else writeFileSync(pageTreePath(c, slug), JSON.stringify(stubTree(page), null, 2));
  }
  return c;
}

type Plan = Record<string, ("ok" | "fixed" | "needs_human")[]>;
/** `plan[slug]` = the verdict of each successive round; "fixed" rewrites the tree so the stage republishes and re-checks. */
function spies(opts: { plan?: Plan; status?: Record<string, number>; delay?: boolean; launchFails?: boolean } = {}) {
  const order: string[] = []; let inFlight = 0, peak = 0;
  const close = vi.fn(async () => { order.push("close"); });
  const ensure = vi.spyOn(deps, "ensurePages").mockResolvedValue(IDS);
  const launch = opts.launchFails
    ? vi.spyOn(deps, "launchBrowser").mockRejectedValue(new Error("Playwright Chromium is not installed — run: npm run setup-playwright"))
    : vi.spyOn(deps, "launchBrowser").mockResolvedValue({ close } as any);
  const check = vi.spyOn(deps, "checkPage").mockImplementation(async (_b, url) => {
    const slug = url.endsWith("/") && new URL(url).pathname !== "/" ? new URL(url).pathname.replace(/\//g, "") : "accueil";
    order.push(`check:${slug}`); inFlight++; peak = Math.max(peak, inFlight);
    if (opts.delay) { await tick(); await tick(); }
    inFlight--;
    return { check: { ...fixtureCheck(), url, status: opts.status?.[slug] ?? 200 }, tiles: { desktop: 2, mobile: 4 } };
  });
  const rounds: Record<string, number> = {};
  const review = vi.spyOn(deps, "reviewPage").mockImplementation(async (c, _s, page, _check, _tiles, o): Promise<ReviewResult> => {
    const n = (rounds[page.slug] = (rounds[page.slug] ?? 0) + 1);
    order.push(`review:${page.slug}:${n}${o?.resume ? ":resume" : ""}`);
    const verdict = opts.plan?.[page.slug]?.[n - 1] ?? "ok";
    c.state = { ...c.state, costUsd: c.state.costUsd + 0.5 };
    const tree: PageTree = JSON.parse(readFileSync(pageTreePath(c, page.slug), "utf8"));
    if (verdict === "fixed") {
      (tree[0].styles as Record<string, unknown>).paddingTop = `${n}px`;
      writeFileSync(pageTreePath(c, page.slug), JSON.stringify(tree, null, 2));
      return { verdict: { verdict, summary: `tour ${n}`, issues: [{ severity: "minor", where: "hero", what: `padding ${n}`, action: "fixed" }] }, treeChanged: true, tree, costUsd: 0.5, attempts: 1, sessionId: `s-${page.slug}-${n}` };
    }
    if (verdict === "needs_human") return { verdict: { verdict, summary: "à revoir", issues: [{ severity: "major", where: "plugin", what: "grille vide", action: "left" }] }, treeChanged: false, tree, costUsd: 0.5, attempts: 1, sessionId: `s-${page.slug}-${n}` };
    return { verdict: { verdict: "ok", summary: "rien", issues: [] }, treeChanged: false, tree, costUsd: 0.5, attempts: 1, sessionId: `s-${page.slug}-${n}` };
  });
  const republish = vi.spyOn(deps, "republishPage").mockImplementation(async (_c, _s, page) => { order.push(`republish:${page.slug}`); return { markup: "", features: [], forms: [] }; });
  return { ensure, launch, close, check, review, republish, order, peak: () => peak };
}

describe("qa stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("is registered in the pipeline after content, without checkpoint", () => {
    expect(registry.qa).toBe(qaStage);
    expect(qaStage.checkpoint).toBeFalsy();
    expect(QA_CONCURRENCY).toBe(3);
    expect(Object.keys(registry)).toEqual(["spec", "design", "provision", "pages", "plugins", "content", "qa"]);
  });
  it("targets every sitemap page then every article", async () => {
    const c = await ctx();
    const t = qaTargets(c, spec);
    expect(t.map((x) => x.slug)).toEqual([...spec.sitemap.map((p) => p.slug), ...ARTICLES]);
    expect(t[0]).toMatchObject({ kind: "home", url: `http://localhost:${c.state.port}/` });
    expect(t.at(-1)).toMatchObject({ kind: "article", url: `http://localhost:${c.state.port}/${ARTICLES.at(-1)}/` });
  });
  it("needs site-spec.json", async () => {
    const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stqa-")));
    await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
    await expect(qaStage.run(loadContext(config, "boul"))).rejects.toThrow(/site-spec.json not found/);
  });
  it("checks every url (3 in flight max), reviews only pages with a tree, writes the checks and both reports", async () => {
    const c = await ctx();
    const s = spies({ delay: true });
    const msg = await qaStage.run(c);
    expect(s.check).toHaveBeenCalledTimes(spec.sitemap.length + ARTICLES.length);
    expect(s.peak()).toBe(3);
    expect(s.review.mock.calls.map((k: any) => k[2].slug).sort()).toEqual([...NON_BLOG].sort());
    expect(s.order.at(-1)).toBe("close");
    for (const slug of [...spec.sitemap.map((p) => p.slug), ...ARTICLES]) expect(existsSync(checkPath(c, slug)), slug).toBe(true);
    const report = parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8")));
    expect(report.totals).toEqual({ urls: 9, reviewed: 5, ok: 5, fixed: 0, needsHuman: 0, remainingIssues: 0 });
    expect(report.pages.map((p) => p.slug)).toEqual([...spec.sitemap.map((p) => p.slug), ...ARTICLES]);
    expect(report.pages.find((p) => p.slug === "actualites")).toMatchObject({ kind: "blog", reviewed: false, rounds: 0 });
    expect(report.pages.find((p) => p.slug === "accueil")).toMatchObject({ reviewed: true, rounds: 1, verdict: "ok", treeHash: treeHash(c, "accueil"), costUsd: 0.5 });
    expect(report.costUsd).toBe(2.5);
    expect(readFileSync(qaReportMdPath(c), "utf8")).toContain("# Rapport QA — Maison Rivet");
    expect(msg).toBe("qa: 9 urls checked; 5 reviewed (5 ok, 0 fixed, 0 needs human); 0 remaining issues — $2.50");
  });
  it("republishes and re-checks after a fix, resumes the session for round 2, and derives the final verdict", async () => {
    const c = await ctx();
    const s = spies({ plan: { accueil: ["fixed", "ok"] } });
    const msg = await qaStage.run(c);
    expect(s.order.filter((o) => o.includes("accueil"))).toEqual(["check:accueil", "review:accueil:1", "republish:accueil", "check:accueil", "review:accueil:2:resume"]);
    expect(s.review.mock.calls.filter((k: any) => k[2].slug === "accueil")[1][5]).toEqual({ resume: "s-accueil-1" });
    const report = parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8")));
    const home = report.pages.find((p) => p.slug === "accueil")!;
    expect(home).toMatchObject({ rounds: 2, verdict: "fixed", costUsd: 1 });
    expect(home.issues).toEqual([{ severity: "minor", where: "hero", what: "padding 1", action: "fixed" }]);
    expect(home.treeHash).toBe(treeHash(c, "accueil"));
    expect(msg).toContain("5 reviewed (4 ok, 1 fixed, 0 needs human); 0 remaining issues");
  });
  it("caps the fix rounds at 2, with a final check after the last republish", async () => {
    const c = await ctx();
    const s = spies({ plan: { contact: ["fixed", "fixed", "fixed"] } });
    await qaStage.run(c);
    expect(s.order.filter((o) => o.includes("contact"))).toEqual(["check:contact", "review:contact:1", "republish:contact", "check:contact", "review:contact:2:resume", "republish:contact", "check:contact"]);
    const report = parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8")));
    expect(report.pages.find((p) => p.slug === "contact")).toMatchObject({ rounds: 2, verdict: "fixed" });
    expect(report.pages.find((p) => p.slug === "contact")!.issues.map((i) => i.what)).toEqual(["padding 1", "padding 2"]);
  });
  it("reports remaining issues without failing", async () => {
    const c = await ctx();
    spies({ plan: { "la-maison": ["needs_human"] } });
    const msg = await qaStage.run(c);
    expect(msg).toContain("(4 ok, 0 fixed, 1 needs human); 1 remaining issue —");
    expect(readFileSync(qaReportMdPath(c), "utf8")).toContain("## /la-maison/ — à revoir");
  });
  it("skips the review of a page whose tree hash and ok verdict are already in report.json", async () => {
    const c = await ctx();
    spies();
    await qaStage.run(c);
    vi.restoreAllMocks();
    const s = spies();
    const msg = await qaStage.run(c);
    expect(s.review).not.toHaveBeenCalled();
    expect(s.check).toHaveBeenCalledTimes(9);
    expect(msg).toBe("qa: 9 urls checked; 5 reviewed (5 ok, 0 fixed, 0 needs human, 5 reused); 0 remaining issues — $0.00");
    const report = parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(c), "utf8")));
    expect(report.pages.find((p) => p.slug === "accueil")).toMatchObject({ reviewed: true, reused: true, verdict: "ok", rounds: 0, costUsd: 0 });
  });
  it("re-reviews a page whose tree changed since the last report", async () => {
    const c = await ctx();
    spies();
    await qaStage.run(c);
    vi.restoreAllMocks();
    writeFileSync(pageTreePath(c, "contact"), JSON.stringify(stubTree(spec.sitemap.find((p) => p.slug === "contact")!)) + "\n");
    const s = spies();
    await qaStage.run(c);
    expect(s.review.mock.calls.map((k: any) => k[2].slug)).toEqual(["contact"]);
  });
  it("fails the stage on a non-200 url, after checking the others, and closes the browser", async () => {
    const c = await ctx();
    const s = spies({ status: { "la-maison": 500 } });
    await expect(qaStage.run(c)).rejects.toThrow(/1 url\(s\) failed: la-maison — fix the site and re-run: faktory run boul --only qa/);
    expect(s.check).toHaveBeenCalledTimes(9);
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(existsSync(qaReportJsonPath(c))).toBe(false);
  });
  it("fails before any review when the browser is missing", async () => {
    const c = await ctx();
    const s = spies({ launchFails: true });
    await expect(qaStage.run(c)).rejects.toThrow(/Playwright Chromium is not installed/);
    expect(s.check).not.toHaveBeenCalled();
    expect(s.review).not.toHaveBeenCalled();
  });
  it("rethrows the budget error as-is and closes the browser", async () => {
    const c = await ctx();
    c.state = { ...c.state, costUsd: 40 };
    const s = spies();
    await expect(qaStage.run(c)).rejects.toThrow(/Cost budget reached/);
    expect(s.review).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalledTimes(1);
  });
  it("refuses a corrupt report.json with a delete hint", async () => {
    const c = await ctx();
    writeFileSync(join(c.siteDir, QA_REPORT_JSON), "{ nope");
    spies();
    await expect(qaStage.run(c)).rejects.toThrow(/qa\/report.json is not valid JSON.*delete it/);
  });
  it("does not review a page without a tree", async () => {
    const c = await ctx({ trees: ["accueil"] });
    const s = spies();
    const msg = await qaStage.run(c);
    expect(s.review.mock.calls.map((k: any) => k[2].slug)).toEqual(["accueil"]);
    expect(msg).toContain("9 urls checked; 1 reviewed");
  });
});
```

In `tests/unit/pipeline.test.ts` line 190 change the expected registry keys to `["spec", "design", "provision", "pages", "plugins", "content", "qa"]`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/stage-qa.test.ts`
Expected: FAIL — cannot resolve `../../src/stages/qa.js`.

- [ ] **Step 3: Write the stage**

```ts
// src/stages/qa.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Stage } from "../pipeline.js";
import { assertBudget } from "../budget.js";
import { readJsonArtifact, pageTreePath } from "../artifacts.js";
import { mapLimit } from "../concurrency.js";
import { siteUrl, type SiteContext } from "../docker.js";
import { ensurePages } from "../provision/pages.js";
import { pageUrl } from "../pages/render-check.js";
import { republishPage } from "../pages/publish.js";
import { readFormsManifest, readPluginManifests } from "../pages/placements.js";
import { checkPage, launchBrowser, screenshotOpts, type LinkCache } from "../qa/browser.js";
import { reviewPage } from "../qa/review.js";
import { writeQaReport } from "../qa/report.js";
import { parseSiteSpec, type Page, type SiteSpec } from "../schemas/site-spec.js";
import { articleSlug } from "../schemas/article.js";
import {
  MAX_FIX_ROUNDS, checkIssues, checkPath, computeTotals, finalVerdict, hasHardFailure, readQaReport, screenshotRel, treeHash,
  type PageCheck, type QaIssue, type QaPage, type QaReport,
} from "../schemas/qa.js";

export const deps = { ensurePages, launchBrowser, checkPage, reviewPage, republishPage, readQaReport };
// Same caveat as PAGES_CONCURRENCY: each concurrent agent gets the whole remaining budget as its own cap.
export const QA_CONCURRENCY = 3;

export type Target = { slug: string; kind: QaPage["kind"]; url: string; page?: Page };

/** Every sitemap page (in order) then every article of the spec (spec decision 2). */
export function qaTargets(ctx: SiteContext, spec: SiteSpec): Target[] {
  return [
    ...spec.sitemap.map((p): Target => ({ slug: p.slug, kind: p.kind, url: pageUrl(ctx, p), page: p })),
    ...spec.blog.articles.map((a): Target => { const slug = articleSlug(a.title); return { slug, kind: "article", url: `${siteUrl(ctx)}/${slug}/` }; }),
  ];
}

function writeCheck(ctx: SiteContext, slug: string, check: PageCheck): void {
  const p = checkPath(ctx, slug);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(check, null, 2) + "\n");
}

const label = (t: Target): string => (t.kind === "home" ? "/" : `/${t.slug}/`);
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export const qaStage: Stage = {
  name: "qa",
  async run(ctx) {
    const spec = readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec);
    const previous = deps.readQaReport(ctx);
    const ids = await deps.ensurePages(ctx, spec);
    const manifests = readPluginManifests(ctx), forms = readFormsManifest(ctx);
    const targets = qaTargets(ctx, spec);
    const browser = await deps.launchBrowser();
    const cache: LinkCache = new Map();
    const startCost = ctx.state.costUsd;

    const audit = async (t: Target): Promise<QaPage> => {
      const shots = screenshotOpts(ctx, t.slug);
      let { check, tiles } = await deps.checkPage(browser, t.url, shots, cache);
      writeCheck(ctx, t.slug, check);
      if (hasHardFailure(check)) throw new Error(`${t.url} answered HTTP ${check.status} — the site is broken, fix it before running qa`);
      const entry: QaPage = {
        slug: t.slug, kind: t.kind, url: t.url, status: check.status, check,
        screenshots: { desktop: screenshotRel(t.slug, "desktop"), mobile: screenshotRel(t.slug, "mobile") },
        reviewed: false, reused: false, rounds: 0, issues: [], costUsd: 0,
      };
      const page = t.page;
      if (!page || page.kind === "blog" || !existsSync(pageTreePath(ctx, t.slug))) {
        console.log(`  ✔ ${label(t)} checked (${checkIssues(check).length} automated issue(s))`);
        return entry;
      }
      const hash = treeHash(ctx, t.slug)!;
      const prev = previous?.pages.find((p) => p.slug === t.slug);
      if (prev?.reviewed && prev.verdict === "ok" && prev.treeHash === hash) {
        console.log(`  ✔ ${label(t)} checked, review reused (tree unchanged)`);
        return { ...entry, reviewed: true, reused: true, treeHash: hash, verdict: "ok", summary: prev.summary };
      }
      let issues: QaIssue[] = [], summary = "", rounds = 0, cost = 0, resume: string | undefined;
      for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
        assertBudget(ctx.config, ctx.state);
        const r = await deps.reviewPage(ctx, spec, page, check, tiles, { resume });
        rounds = round; cost += r.costUsd; resume = r.sessionId; summary = r.verdict.summary;
        // keep what earlier rounds fixed; the latest round owns everything else
        issues = [...issues.filter((i) => i.action === "fixed"), ...r.verdict.issues];
        console.log(`  ${r.treeChanged ? "↻" : "✔"} ${label(t)} round ${round}: ${r.verdict.verdict} (${r.verdict.issues.length} issue(s))`);
        if (!r.treeChanged) break;
        await deps.republishPage(ctx, spec, page, ids[t.slug], r.tree, { manifests, forms });
        ({ check, tiles } = await deps.checkPage(browser, t.url, shots, cache));
        writeCheck(ctx, t.slug, check);
        if (hasHardFailure(check)) throw new Error(`${t.url} answered HTTP ${check.status} after republishing — the site is broken, fix it before running qa`);
      }
      return { ...entry, check, status: check.status, reviewed: true, treeHash: treeHash(ctx, t.slug), rounds, verdict: finalVerdict(issues), summary, issues, costUsd: round4(cost) };
    };

    let results: PromiseSettledResult<QaPage>[];
    try { results = await mapLimit(targets, QA_CONCURRENCY, audit); }
    finally { await browser.close(); }

    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        failed.push(targets[i].slug);
        console.error(`  ✖ ${targets[i].slug}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
    });
    for (const r of results) {
      if (r.status === "rejected" && r.reason instanceof Error && r.reason.message.includes("Cost budget reached")) throw r.reason;
    }
    if (failed.length) throw new Error(`${failed.length} url(s) failed: ${failed.join(", ")} — fix the site and re-run: faktory run ${ctx.slug} --only qa`);

    const pages = results.map((r) => (r as PromiseFulfilledResult<QaPage>).value);
    const report: QaReport = { generatedAt: new Date().toISOString(), siteUrl: siteUrl(ctx), costUsd: round4(ctx.state.costUsd - startCost), totals: computeTotals(pages), pages };
    writeQaReport(ctx, report, spec.identity.name);
    const t = report.totals, reused = pages.filter((p) => p.reused).length;
    return `qa: ${t.urls} urls checked; ${t.reviewed} reviewed (${t.ok} ok, ${t.fixed} fixed, ${t.needsHuman} needs human${reused ? `, ${reused} reused` : ""}); ${t.remainingIssues} remaining issue${t.remainingIssues === 1 ? "" : "s"} — $${report.costUsd.toFixed(2)}`;
  },
};
```

In `src/pipeline.ts` add `import { qaStage } from "./stages/qa.js";` and `qa: qaStage` at the end of `registry`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/stage-qa.test.ts tests/unit/pipeline.test.ts && npm run typecheck && npm test`
Expected: all PASS. Note on the reuse test: the first run's `costUsd` in the report is `2.5` because the mocked `reviewPage` adds $0.5 to the state per call — the stage measures the state delta, exactly like the real path.

- [ ] **Step 5: Commit**

```bash
git add src/stages/qa.ts src/pipeline.ts tests/unit/stage-qa.test.ts tests/unit/pipeline.test.ts
git commit -m "feat(faktory): qa stage — browser checks, agent review rounds, report"
```

---

### Task 8: Docker integration test

**Files:**
- Create: `tests/integration/qa.test.ts`

Port **8197**. Runs provision → pages (stub trees) → content (fixture article, forms real) → qa with the real browser and a mocked `reviewPage` that fixes the home page once, then a second qa run that reuses the reviews.

- [ ] **Step 1: Write the test**

```ts
// tests/integration/qa.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { artifactPath, pageTreePath } from "../../src/artifacts.js";
import { articlePath, articleSlug, type Article } from "../../src/schemas/article.js";
import { featureMarker, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type GbNode, type PageTree } from "../../src/schemas/page-tree.js";
import { checkPath, parsePageCheck, parseQaReport, qaReportJsonPath, qaReportMdPath, screenshotPath } from "../../src/schemas/qa.js";
import { chromiumInstalled } from "../../src/qa/browser.js";
import { deps as pagesDeps } from "../../src/stages/pages.js";
import { deps as contentDeps } from "../../src/stages/content.js";
import { deps as qaDeps } from "../../src/stages/qa.js";
import type { ReviewResult } from "../../src/qa/review.js";
import type { Page, SiteSpec } from "../../src/schemas/site-spec.js";
import type { SiteContext } from "../../src/docker.js";

const FIXTURE_ARTICLE = "fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json";

function stubTree(page: Page): PageTree {
  return page.sections.map((s, i): GbNode => ({
    type: "element", tagName: "section", htmlAttributes: { id: `s-${i}` },
    styles: { backgroundColor: i % 2 ? "var(--base-2)" : "var(--base)", padding: "48px 24px", "@media (max-width:767px)": { padding: "32px 16px" } },
    innerBlocks: [
      { type: "text", tagName: i === 0 ? "h1" : "h2", content: s.heading, styles: { color: "var(--contrast)" } },
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

describe.skipIf(!process.env.FAKTORY_DOCKER || !chromiumInstalled())("qa stage on a throwaway site (docker + chromium)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8197 };
  let ctx: SiteContext;
  let spec: SiteSpec;
  const fixture = (): Article => JSON.parse(readFileSync(FIXTURE_ARTICLE, "utf8"));
  beforeAll(async () => {
    await initSite(config, { slug: "itqa", briefPath: "fixtures/briefs/boulangerie.md" });
    ctx = loadContext(config, "itqa");
    copyFileSync("fixtures/specs/boulangerie.site-spec.json", artifactPath(ctx, "siteSpecJson"));
    copyFileSync("fixtures/specs/boulangerie.design-tokens.json", artifactPath(ctx, "designTokensJson"));
    writeFileSync(artifactPath(ctx, "designSystemMd"), "# Maison Rivet — Design System Web\n");
    spec = JSON.parse(readFileSync(artifactPath(ctx, "siteSpecJson"), "utf8"));
    const p = await runSite(config, "itqa", { only: "provision" });
    expect(p.stages.provision.status, p.stages.provision.message).toBe("done");
    vi.spyOn(pagesDeps, "generatePageTree").mockImplementation(async (c, _spec, page) => {
      const tree = stubTree(page);
      writeFileSync(pageTreePath(c, page.slug), JSON.stringify(tree, null, 2));
      return { tree, costUsd: 0, attempts: 1 as const };
    });
    const pg = await runSite(config, "itqa", { only: "pages" });
    expect(pg.stages.pages.status, pg.stages.pages.message).toBe("done");
    vi.spyOn(contentDeps, "generateArticle").mockImplementation(async (c, _s, article) => {
      const slug = articleSlug(article.title);
      const a: Article = { ...fixture(), title: article.title, category: article.theme };
      mkdirSync(dirname(articlePath(c, slug)), { recursive: true });
      writeFileSync(articlePath(c, slug), JSON.stringify(a, null, 2));
      return { article: a, slug, costUsd: 0, attempts: 1 as const };
    });
    const ct = await runSite(config, "itqa", { only: "content" });
    expect(ct.stages.content.status, ct.stages.content.message).toBe("done");
  }, 600_000);
  afterAll(async () => { vi.restoreAllMocks(); await destroySite(config, "itqa"); });

  it("checks every url in a real browser, republishes the home page fixed by the (stubbed) agent, and reports", async () => {
    const review = vi.spyOn(qaDeps, "reviewPage").mockImplementation(async (c, _s, page, _check, _tiles, o): Promise<ReviewResult> => {
      const tree: PageTree = JSON.parse(readFileSync(pageTreePath(c, page.slug), "utf8"));
      if (page.kind === "home" && !o?.resume) {
        (tree[0].innerBlocks![0] as GbNode).content = "Bienvenue chez Maison Rivet (QA)";
        writeFileSync(pageTreePath(c, page.slug), JSON.stringify(tree, null, 2));
        return { verdict: { verdict: "fixed", summary: "Titre précisé.", issues: [{ severity: "minor", where: "hero", what: "titre générique", action: "fixed" }] }, treeChanged: true, tree, costUsd: 0, attempts: 1, sessionId: "s1" };
      }
      return { verdict: { verdict: "ok", summary: "Rien à signaler.", issues: [] }, treeChanged: false, tree, costUsd: 0, attempts: 1, sessionId: "s2" };
    });
    const state = await runSite(config, "itqa", { only: "qa" });
    expect(state.stages.qa.status, state.stages.qa.message).toBe("done");
    expect(state.stages.qa.message).toBe("qa: 9 urls checked; 5 reviewed (4 ok, 1 fixed, 0 needs human); 0 remaining issues — $0.00");
    expect(review).toHaveBeenCalledTimes(6); // 5 pages + the home's second round

    const report = parseQaReport(JSON.parse(readFileSync(qaReportJsonPath(ctx), "utf8")));
    expect(report.totals).toEqual({ urls: 9, reviewed: 5, ok: 4, fixed: 1, needsHuman: 0, remainingIssues: 0 });
    const home = report.pages.find((p) => p.kind === "home")!;
    expect(home).toMatchObject({ rounds: 2, verdict: "fixed", status: 200 });
    // the real site is clean on the stub pages: no console error, nothing unstyled, no broken image/link
    for (const p of report.pages) {
      expect(p.check.status, p.url).toBe(200);
      expect(p.check.consoleErrors, p.url).toEqual([]);
      expect(p.check.unstyledBlocks, p.url).toEqual([]);
      expect(p.check.brokenImages, p.url).toEqual([]);
      expect(p.check.brokenLinks, p.url).toEqual([]);
      expect(p.check.h1Count, p.url).toBe(1);
      expect(existsSync(checkPath(ctx, p.slug)), p.slug).toBe(true);
      expect(parsePageCheck(JSON.parse(readFileSync(checkPath(ctx, p.slug), "utf8"))).url).toBe(p.url);
      for (const f of [screenshotPath(ctx, p.slug, "desktop"), screenshotPath(ctx, p.slug, "mobile"), screenshotPath(ctx, p.slug, "desktop", 1), screenshotPath(ctx, p.slug, "mobile", 1)]) expect(existsSync(f), f).toBe(true);
    }
    expect(readFileSync(qaReportMdPath(ctx), "utf8")).toContain("## / — corrigée");
    // the fix went live
    const html = await (await fetch(`http://localhost:${ctx.state.port}/`)).text();
    expect(html).toContain("Bienvenue chez Maison Rivet (QA)");
    expect(html).toContain("gb-element-"); // still a GenerateBlocks page
  }, 600_000);

  it("reuses the ok reviews on a second run and only re-reviews the page that was fixed", async () => {
    const review = vi.spyOn(qaDeps, "reviewPage").mockImplementation(async (c, _s, page): Promise<ReviewResult> => ({
      verdict: { verdict: "ok", summary: "Rien à signaler.", issues: [] }, treeChanged: false, tree: JSON.parse(readFileSync(pageTreePath(c, page.slug), "utf8")), costUsd: 0, attempts: 1, sessionId: "s3",
    }));
    const state = await runSite(config, "itqa", { only: "qa" });
    expect(state.stages.qa.status, state.stages.qa.message).toBe("done");
    expect(review.mock.calls.map((k: any) => k[2].slug)).toEqual(["accueil"]);
    expect(state.stages.qa.message).toContain("5 reviewed (5 ok, 0 fixed, 0 needs human, 4 reused)");
  }, 600_000);
});
```

Note: the fixture spec's home page places the `catalogue_produits` feature, but no plugin exists on the throwaway site, so the wrapper keeps its placeholder card — `republishPage` applies nothing and checks nothing there.

- [ ] **Step 2: Run it**

```bash
FAKTORY_DOCKER=1 npx vitest run tests/integration/qa.test.ts --testTimeout=600000 --hookTimeout=600000
```

Expected: 2 tests pass in ≈ 5–7 min. If `unstyledBlocks` is not empty on a stub page, print the classes: GenerateBlocks 2 emits every block's CSS in `#generateblocks-inline-css` — an entry here means the in-page audit matched a class that is not a per-block class (fix `GB_CLASS_RE`), not a real site bug. If `consoleErrors` contains a Gravity Forms or Yoast message, record it in the spec deviations and relax that assertion to `not.toContain("Uncaught")` rather than hiding it.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/qa.test.ts
git commit -m "test(faktory): qa stage docker + chromium integration test"
```

---

### Task 9: Live run on boulangerie, docs, deviations

**Files:**
- Modify: `README.md` (Setup, Usage, Artifacts, Stages, Cost, a « QA » section), `docs/superpowers/specs/2026-09-13-faktory-phase6-qa-export-design.md` (« Écarts constatés à l'exécution — qa »)

- [ ] **Step 1: Run the stage on the live site** (≈ $3–7: 5 Opus reviews with screenshots; the site is at `http://localhost:8101`, containers must be up — `npm run faktory -- provision boulangerie` re-attaches them if not)

```bash
npm run faktory -- run boulangerie --only qa
open sites/boulangerie/qa/QA-REPORT.md
```

Expected: `✔ qa — qa: 11 urls checked; 5 reviewed (N ok, M fixed, K needs human); R remaining issues — $X.XX`. Read the report and the fixed pages in the browser. Note the cost and the new `costUsd` in `sites/boulangerie/faktory.json`. Run it a second time and confirm `reused` pages and `$0.00` for them.

- [ ] **Step 2: README**

- Setup: add `npm run setup-playwright             # downloads Chromium for the qa stage (doctor checks it)` after `setup-phpstan`.
- Usage: add `npm run faktory -- run boulangerie --only qa --max-cost 10   # browser checks + screenshots of every url, one review agent per generated page (≤ 2 fix rounds), qa/QA-REPORT.md`.
- Artifacts table: add rows `qa/<slug>.check.json`, `qa/<slug>.{desktop,mobile}[.N].png` (written by qa, not editable), `qa/report.json` / `qa/QA-REPORT.md` (delete `report.json` to force every page to be reviewed again).
- Stages: replace `Phase 4 implements \`plugins\`, phase 5 \`content\`. Only \`qa\` and \`export\` are still marked "skipped (not implemented)".` by `Phase 4 implements \`plugins\`, phase 5 \`content\`, phase 6a \`qa\`. Only \`export\` is still marked "skipped (not implemented)".`
- New section after « Content »:

```markdown
### QA
`qa` runs after `content`. Faktory opens every sitemap page and every article in Playwright Chromium and records, per URL, the HTTP status, console errors and uncaught exceptions, failed same-origin requests, broken internal links, broken images and missing `alt`, GenerateBlocks classes without CSS, the `h1` count and horizontal overflow at 390 px, then screenshots desktop (1440) and mobile (390), full page plus viewport tiles. Each page that has a `pages/<slug>.gb.json` is then reviewed by one agent (tools `Read`, `Write` on `pages/`, `gb_build`) that reads the screenshots and may rewrite the tree; Faktory validates it, republishes it (placements applied, render contract checked), re-checks it and resumes the agent for a second round — 2 fix rounds at most. An invalid rewritten tree is restored and reported as a rejected fix. The stage never fails on remaining issues: it writes `qa/QA-REPORT.md` and `qa/report.json` and `export` runs anyway; it fails only on a non-200 URL, a missing browser, an agent error or the budget. A page whose tree is unchanged and was `ok` is not reviewed again ($0).
```

- Cost: add the measured line: `The \`qa\` stage cost **$X.XX for 5 reviewed pages** (≈ $Y per page, N fix rounds; checks and screenshots are $0). Cumulative site cost after \`qa\`: $Z.`

- [ ] **Step 3: Spec addendum**

Append to the phase 6 spec a section `## Écarts constatés à l'exécution — qa (2026-09-13)` listing what differed (at least: measured cost and rounds; any console message the real site emits and how the check treats it; any Playwright/Chromium surprise; whether the agent's fixes were sensible or the prompt needed tightening).

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-13-faktory-phase6-qa-export-design.md
git commit -m "docs(faktory): qa stage usage, measured cost, phase 6a deviations"
```

---

## Handover to plan 6b

Plan 6b (`export`) reads `qa/report.json` through `readQaReport` (Task 2) for `MANIFEST.json`, reuses `republishPage`-free deterministic code only, and uses port 8198. Nothing in this plan needs to change for it.
