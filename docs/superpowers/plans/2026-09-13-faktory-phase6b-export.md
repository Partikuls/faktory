# Faktory Phase 6b — Export Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `faktory run <slug>` (or `faktory export <slug>`) writes a restorable `dist/`: `db.sql` with the local URL replaced by `https://SITE_URL_PLACEHOLDER`, `wp-content.tar.gz`, `docker-compose.prod.yml` + `.env.example`, a French restore `README.md` and `MANIFEST.json`.

**Architecture:** The `export` stage is deterministic ($0). It captures `wp search-replace … --export` on stdout, post-processes the JSON-escaped URL form in Node and asserts no local URL remains; archives `wp-content` with the host `tar` (bsdtar) and verifies the listing; renders the compose/env/README templates; gathers versions from WP-CLI and the site artifacts (plugin manifests, forms manifest, articles, `qa/report.json`) into `MANIFEST.json`. The integration test restores `dist/` into a fresh Compose stack from the exported compose file and checks the site renders.

**Tech Stack:** Node 24, TypeScript 5, `zod` 4, `commander` 12, `vitest` 2, `tsx`, Docker Compose, WP-CLI (`search-replace --export`, `db import -`, `core version`, `plugin list`, `theme list`), macOS bsdtar 3.5, WordPress 7.1, MariaDB 11.

**Spec:** `docs/superpowers/specs/2026-09-13-faktory-phase6-qa-export-design.md` (section `export`, decisions 12–19, « `dist/` — fichiers produits ») on top of `docs/superpowers/specs/2026-09-12-faktory-design.md` section « 8. export ». Plan 6a (`2026-09-13-faktory-phase6a-qa.md`) must be executed first: this plan reads `qa/report.json` through `readQaReport` (`src/schemas/qa.ts`).

## Global Constraints

- Repo root `/Users/khelil/Developer/partikuls/faktory`, branch `main`, remote `origin`. Commit after every task; do not push unless asked.
- ESM only, strict TS, `.js` import suffixes, `npm run typecheck` before every commit. zod 4.
- Every WP-CLI call goes through `src/wp.ts` (`runWp` never throws — inspect `code`; `wpOk` throws with stderr; `wpJson` appends `--format=json`). The wpcli container prints a harmless `PHP Warning: Constant WP_DEBUG already defined` on **stderr** for every command: never treat stderr as an error by itself, and never mix it into stdout.
- Every shell call goes through `run()` in `src/exec.ts` (`{ stdout, stderr, code }`, never throws; `code` 127 when the binary is missing).
- Test conventions as in plan 6a (`deps` spy seams, `vi.spyOn(wpDeps, "composeExec")` for WP-CLI, temp site dirs via `initSite`, `beforeEach(() => vi.restoreAllMocks())`). Integration: `describe.skipIf(!process.env.FAKTORY_DOCKER)`; ports used so far 8190–8197. **This plan uses 8198 (source site) and 8199 (restored site).**
- Verified on boulangerie (2026-09-13): `wp search-replace http://localhost:8101 https://SITE_URL_PLACEHOLDER --all-tables-with-prefix --export` exits 0, writes a 2 088 575-byte dump on stdout (starts with a blank line then `DROP TABLE IF EXISTS \`wp_commentmeta\`;`), does not modify the database, and leaves exactly 5 `http:\/\/localhost:8101` (JSON-escaped) occurrences in `wp_yoast_indexable`; a second `search-replace` with the escaped forms finds those 5. `wp db import -` reads stdin. `wp yoast index --reindex` exists. `wp core version` → `7.1`; `wp plugin list --fields=name,version,status --format=json` and `wp theme list --fields=name,version,status --format=json` return arrays of string fields. `wp-content` on disk: plugins 58 MB, themes 18 MB (`twentytwentythree/four/five` = 14.6 MB of it), uploads 0.6 MB, `languages/`, `upgrade/`, no `mu-plugins/`.
- Helpers to reuse: `readPluginManifests`, `readFormsManifest` (`src/pages/placements.ts`); `readQaReport`, `QaReport` (`src/schemas/qa.ts`); `articleSlug` (`src/schemas/article.ts`); `VENDOR_PLUGINS`, `WPORG_PLUGINS` (`src/provision/stack.ts`); `siteUrl` (`src/docker.ts`); `readJsonArtifact` (`src/artifacts.ts`); `run` (`src/exec.ts`); `runWp`, `wpOk`, `wpJson` (`src/wp.ts`).

## Decisions taken for this phase (approved 2026-09-13, keep them)

12. Deterministic, $0, `dist/` emptied and rewritten each run; the live DB and `wp-content` are never modified.
13. `db.sql` = `search-replace --export` stdout + Node pass on the JSON-escaped form; assert placeholder present and zero `localhost:<port>` left; GUIDs replaced like everything else.
14. `wp-content.tar.gz` via host `tar`, root `wp-content/`, excludes `upgrade`, `debug.log`, `themes/twenty*`; verified with `tar -tzf` for the parent theme, the child theme, generateblocks and every custom plugin.
15. `docker-compose.prod.yml` (db, wordpress, wpcli; no `WP_DEBUG`) + `.env.example` (`SITE_PORT`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`).
16. French `README.md`: restore steps (both search-replace forms, Yoast reindex, rewrite flush, admin password), post-restore (SMTP, licences, WP Umbrella), manifest description.
17. `MANIFEST.json` fields as listed in the spec; `qa` is `null` without `qa/report.json`.
18. `faktory export <slug>` CLI alias; stage message lists the files with sizes.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/artifacts.ts` (modify) | `DIST_DIR = "dist"` |
| `src/export/db.ts` | `SITE_URL_PLACEHOLDER`, `escapeSlashes`, `replaceEscapedUrls`, `assertPlaceholderDump`, `exportDb(ctx)` |
| `src/export/bundle.ts` | `TAR_EXCLUDES`, `bundleWpContent(ctx, out)`, `listTar(out)`, `requiredTarEntries(ctx, manifests)`, `assertTarEntries(listing, required)` |
| `src/export/templates.ts` | `prodCompose()`, `envExample()`, `restoreReadme(input)`, `fmtSize(bytes)` |
| `src/export/manifest.ts` | `faktoryVersion()`, `gatherVersions(ctx)`, `buildManifest(input)`, `type Manifest` |
| `src/stages/export.ts`, `src/pipeline.ts` (modify) | `exportStage`; `registry.export` |
| `src/cli.ts` (modify) | `export <slug>` command |
| `tests/unit/export-db.test.ts`, `export-bundle.test.ts`, `export-templates.test.ts`, `export-manifest.test.ts`, `stage-export.test.ts`; `pipeline.test.ts`, `cli.test.ts` (modify) | unit tests |
| `tests/integration/export.test.ts` | Docker: export on 8198, restore on 8199 |
| `README.md`, spec addendum | docs, deviations |

---

### Task 1: Database dump with the URL placeholder

**Files:**
- Modify: `src/artifacts.ts` (add `DIST_DIR`)
- Create: `src/export/db.ts`
- Test: `tests/unit/export-db.test.ts`

**Interfaces:**
- Consumes: `runWp` (`src/wp.ts`), `siteUrl` (`src/docker.ts`).
- Produces: `DIST_DIR = "dist"` (`src/artifacts.ts`); in `src/export/db.ts`: `SITE_URL_PLACEHOLDER = "https://SITE_URL_PLACEHOLDER"`; `escapeSlashes(s: string): string` (`/` → `\/`); `replaceEscapedUrls(dump: string, localUrl: string): string`; `assertPlaceholderDump(dump: string, localUrl: string): void`; `exportDb(ctx): Promise<{ sql: string; bytes: number }>`; `deps = { runWp }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/export-db.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps as wpDeps } from "../../src/wp.js";
import { DIST_DIR } from "../../src/artifacts.js";
import { SITE_URL_PLACEHOLDER, escapeSlashes, replaceEscapedUrls, assertPlaceholderDump, exportDb } from "../../src/export/db.js";

const LOCAL = "http://localhost:8101";
const DUMP = `\nDROP TABLE IF EXISTS \`wp_options\`;\nINSERT INTO \`wp_options\` VALUES (1,'siteurl','${SITE_URL_PLACEHOLDER}','yes');\nINSERT INTO \`wp_yoast_indexable\` VALUES (5,'{\\"url\\": \\"http:\\\\/\\\\/localhost:8101\\\\/wp-content\\\\/uploads\\\\/a.png\\"}');\n`;

function ctx(): SiteContext {
  const root = mkdtempSync(join(tmpdir(), "fk-exportdb-"));
  return { config: loadConfig(root), slug: "d", siteDir: join(root, "sites", "d"), state: createState("d", 8101, "pw") };
}

describe("db export helpers", () => {
  it("names dist and the placeholder", () => {
    expect(DIST_DIR).toBe("dist");
    expect(SITE_URL_PLACEHOLDER).toBe("https://SITE_URL_PLACEHOLDER");
  });
  it("escapes slashes the way JSON-in-SQL does", () => {
    expect(escapeSlashes("http://localhost:8101")).toBe("http:\\/\\/localhost:8101");
  });
  it("replaces the escaped local url (single- and double-backslash forms) by the escaped placeholder", () => {
    const out = replaceEscapedUrls(DUMP, LOCAL);
    expect(out).not.toContain("localhost:8101");
    expect(out).toContain("https:\\\\/\\\\/SITE_URL_PLACEHOLDER\\\\/wp-content");
    expect(replaceEscapedUrls("x http:\\/\\/localhost:8101\\/p y", LOCAL)).toBe("x https:\\/\\/SITE_URL_PLACEHOLDER\\/p y");
  });
  it("asserts the placeholder is present and no local url remains", () => {
    expect(() => assertPlaceholderDump(replaceEscapedUrls(DUMP, LOCAL), LOCAL)).not.toThrow();
    expect(() => assertPlaceholderDump(DUMP, LOCAL)).toThrow(/db.sql still contains 1 occurrence\(s\) of localhost:8101/);
    expect(() => assertPlaceholderDump("DROP TABLE x;", LOCAL)).toThrow(/db.sql does not contain https:\/\/SITE_URL_PLACEHOLDER — is the site url http:\/\/localhost:8101\?/);
    expect(() => assertPlaceholderDump("", LOCAL)).toThrow(/db.sql is empty/);
  });
});

describe("exportDb", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("runs search-replace --export against the site url and post-processes stdout", async () => {
    const c = ctx();
    const exec = vi.spyOn(wpDeps, "composeExec").mockResolvedValue({ stdout: DUMP, stderr: "PHP Warning: Constant WP_DEBUG already defined\nWarning: Skipping an uninitialized class", code: 0 });
    const r = await exportDb(c);
    expect(exec.mock.calls[0][2]).toEqual(["wp", "search-replace", LOCAL, SITE_URL_PLACEHOLDER, "--all-tables-with-prefix", "--export"]);
    expect(r.sql).not.toContain("localhost:8101");
    expect(r.sql).toContain(`'siteurl','${SITE_URL_PLACEHOLDER}'`);
    expect(r.bytes).toBe(Buffer.byteLength(r.sql));
  });
  it("fails with stderr when wp fails, and when the dump still has the local url", async () => {
    const c = ctx();
    vi.spyOn(wpDeps, "composeExec").mockResolvedValue({ stdout: "", stderr: "Error: no db", code: 1 });
    await expect(exportDb(c)).rejects.toThrow(/wp search-replace .* failed: Error: no db/);
    vi.spyOn(wpDeps, "composeExec").mockResolvedValue({ stdout: "INSERT x 'http://localhost:8101/' 'https://SITE_URL_PLACEHOLDER';", stderr: "", code: 0 });
    await expect(exportDb(c)).rejects.toThrow(/still contains 1 occurrence/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/export-db.test.ts`
Expected: FAIL — `DIST_DIR` / module not found.

- [ ] **Step 3: Implement**

In `src/artifacts.ts` add after `CONTENT_DIR`:

```ts
export const DIST_DIR = "dist";
```

```ts
// src/export/db.ts
import { siteUrl, type SiteContext } from "../docker.js";
import { runWp } from "../wp.js";

export const deps = { runWp };
export const SITE_URL_PLACEHOLDER = "https://SITE_URL_PLACEHOLDER";

export const escapeSlashes = (s: string): string => s.replace(/\//g, "\\/");
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * `wp search-replace` handles PHP-serialized values but not JSON stored as text: Yoast indexables keep the url
 * as `http:\/\/localhost:<port>` (and, once dumped inside a SQL string, `http:\\/\\/…`). Replace both forms.
 */
export function replaceEscapedUrls(dump: string, localUrl: string): string {
  const one = new RegExp(escapeRe(escapeSlashes(localUrl)), "g");
  const two = new RegExp(escapeRe(localUrl.replace(/\//g, "\\\\/")), "g");
  return dump.replace(two, SITE_URL_PLACEHOLDER.replace(/\//g, "\\\\/")).replace(one, escapeSlashes(SITE_URL_PLACEHOLDER));
}

export function assertPlaceholderDump(dump: string, localUrl: string): void {
  if (!dump.trim()) throw new Error("db.sql is empty — wp search-replace --export produced nothing");
  if (!dump.includes(SITE_URL_PLACEHOLDER)) throw new Error(`db.sql does not contain ${SITE_URL_PLACEHOLDER} — is the site url ${localUrl}?`);
  const host = localUrl.replace(/^https?:\/\//, "");
  const left = dump.split(host).length - 1;
  if (left) throw new Error(`db.sql still contains ${left} occurrence(s) of ${host} — the export must not leak the local url`);
}

/** Decision 13: the whole database with the local url replaced, captured on stdout; the live database is untouched. */
export async function exportDb(ctx: SiteContext): Promise<{ sql: string; bytes: number }> {
  const local = siteUrl(ctx);
  const args = ["search-replace", local, SITE_URL_PLACEHOLDER, "--all-tables-with-prefix", "--export"];
  const r = await deps.runWp(ctx, args);
  if (r.code !== 0) throw new Error(`wp ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim().split("\n").filter((l) => !l.includes("WP_DEBUG already defined")).join("\n")}`);
  const sql = replaceEscapedUrls(r.stdout, local);
  assertPlaceholderDump(sql, local);
  return { sql, bytes: Buffer.byteLength(sql) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/export-db.test.ts && npm run typecheck`
Expected: PASS. (The double-backslash form in the test dump is what a SQL dump of a JSON column looks like; the regex `two` handles it, `one` the plain JSON form.)

- [ ] **Step 5: Commit**

```bash
git add src/artifacts.ts src/export/db.ts tests/unit/export-db.test.ts
git commit -m "feat(faktory): export db dump with SITE_URL_PLACEHOLDER (raw and json-escaped forms)"
```

---

### Task 2: `wp-content` archive

**Files:**
- Create: `src/export/bundle.ts`
- Test: `tests/unit/export-bundle.test.ts`

**Interfaces:**
- Consumes: `run` (`src/exec.ts`), `PluginManifest` (`src/schemas/plugin-manifest.ts`).
- Produces: `TAR_EXCLUDES: string[]`; `bundleWpContent(ctx, out: string): Promise<number>` (bytes written); `listTar(out): Promise<string[]>`; `requiredTarEntries(ctx, manifests): string[]`; `assertTarEntries(listing: string[], required: string[]): void`; `deps = { run }`.

- [ ] **Step 1: Write the failing test (real bsdtar on a temp site)**

```ts
// tests/unit/export-bundle.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { parsePluginManifest } from "../../src/schemas/plugin-manifest.js";
import { readFileSync } from "node:fs";
import { TAR_EXCLUDES, bundleWpContent, listTar, requiredTarEntries, assertTarEntries } from "../../src/export/bundle.js";

const manifest = parsePluginManifest(JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8")));

async function ctx() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-bundle-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  const wc = join(c.siteDir, "wp-content");
  for (const d of ["plugins/generateblocks", "plugins/faktory-catalogue-produits", "themes/generatepress", "themes/faktory-boul", "themes/twentytwentyfive", "uploads/2026/09", "languages", "upgrade"]) mkdirSync(join(wc, d), { recursive: true });
  writeFileSync(join(wc, "index.php"), "<?php // Silence\n");
  writeFileSync(join(wc, "debug.log"), "noise\n");
  writeFileSync(join(wc, "plugins/generateblocks/plugin.php"), "<?php\n");
  writeFileSync(join(wc, "plugins/faktory-catalogue-produits/faktory-catalogue-produits.php"), "<?php\n");
  writeFileSync(join(wc, "themes/generatepress/style.css"), "/* gp */\n");
  writeFileSync(join(wc, "themes/faktory-boul/style.css"), "/* child */\n");
  writeFileSync(join(wc, "themes/twentytwentyfive/style.css"), "/* default */\n");
  writeFileSync(join(wc, "uploads/2026/09/a.png"), "png");
  writeFileSync(join(wc, "languages/fr_FR.mo"), "mo");
  writeFileSync(join(wc, "upgrade/tmp"), "x");
  return c;
}

describe("wp-content bundle", () => {
  it("lists the excludes", () => {
    expect(TAR_EXCLUDES).toEqual(["wp-content/upgrade", "wp-content/debug.log", "wp-content/themes/twenty*"]);
  });
  it("archives wp-content without the excluded paths and lists it back", async () => {
    const c = await ctx();
    const out = join(c.siteDir, "dist", "wp-content.tar.gz");
    const bytes = await bundleWpContent(c, out);
    expect(bytes).toBe(statSync(out).size);
    expect(bytes).toBeGreaterThan(100);
    const listing = await listTar(out);
    expect(listing).toContain("wp-content/index.php");
    expect(listing).toContain("wp-content/themes/generatepress/style.css");
    expect(listing).toContain("wp-content/themes/faktory-boul/style.css");
    expect(listing).toContain("wp-content/plugins/generateblocks/plugin.php");
    expect(listing).toContain("wp-content/uploads/2026/09/a.png");
    expect(listing).toContain("wp-content/languages/fr_FR.mo");
    expect(listing.some((e) => e.includes("twentytwentyfive"))).toBe(false);
    expect(listing.some((e) => e.includes("wp-content/upgrade"))).toBe(false);
    expect(listing).not.toContain("wp-content/debug.log");
  });
  it("requires the parent theme, the child theme, generateblocks and every custom plugin", async () => {
    const c = await ctx();
    expect(requiredTarEntries(c, [manifest])).toEqual([
      "wp-content/themes/generatepress/style.css", "wp-content/themes/faktory-boul/style.css", "wp-content/plugins/generateblocks/", "wp-content/plugins/faktory-catalogue-produits/",
    ]);
    const out = join(c.siteDir, "dist", "wp-content.tar.gz");
    await bundleWpContent(c, out);
    const listing = await listTar(out);
    expect(() => assertTarEntries(listing, requiredTarEntries(c, [manifest]))).not.toThrow();
    expect(() => assertTarEntries(listing, ["wp-content/plugins/faktory-missing/"])).toThrow(/wp-content.tar.gz is missing: wp-content\/plugins\/faktory-missing\//);
  });
  it("fails clearly when tar fails", async () => {
    const c = await ctx();
    await expect(bundleWpContent(c, join(c.siteDir, "nope", "deep", "x.tar.gz"))).rejects.toThrow(/tar failed/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/export-bundle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/export/bundle.ts
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { SiteContext } from "../docker.js";
import { run } from "../exec.js";
import type { PluginManifest } from "../schemas/plugin-manifest.js";

export const deps = { run };
/** Decision 14: what never ships — update scratch, the debug log, the WordPress default themes copied by the image. */
export const TAR_EXCLUDES = ["wp-content/upgrade", "wp-content/debug.log", "wp-content/themes/twenty*"];

/** `tar -czf <out> -C <siteDir> wp-content` with the excludes (bsdtar on macOS, GNU tar elsewhere: both accept these flags). Returns the archive size. */
export async function bundleWpContent(ctx: SiteContext, out: string): Promise<number> {
  try { mkdirSync(dirname(out), { recursive: true }); } catch { /* tar reports the real error below */ }
  const args = ["-czf", out, "-C", ctx.siteDir, ...TAR_EXCLUDES.flatMap((e) => ["--exclude", e]), "wp-content"];
  const r = await deps.run("tar", args);
  if (r.code !== 0) throw new Error(`tar failed (exit ${r.code}): ${r.stderr.trim()}`);
  return statSync(out).size;
}

export async function listTar(out: string): Promise<string[]> {
  const r = await deps.run("tar", ["-tzf", out]);
  if (r.code !== 0) throw new Error(`tar -t failed (exit ${r.code}): ${r.stderr.trim()}`);
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Entries the archive must contain for the site to restore: parent theme, child theme, GenerateBlocks, every custom plugin. */
export function requiredTarEntries(ctx: SiteContext, manifests: PluginManifest[]): string[] {
  return [
    "wp-content/themes/generatepress/style.css",
    `wp-content/themes/faktory-${ctx.slug}/style.css`,
    "wp-content/plugins/generateblocks/",
    ...manifests.map((m) => `wp-content/plugins/${m.plugin}/`),
  ];
}

export function assertTarEntries(listing: string[], required: string[]): void {
  const missing = required.filter((r) => !listing.some((e) => e === r || e.startsWith(r)));
  if (missing.length) throw new Error(`wp-content.tar.gz is missing: ${missing.join(", ")}`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/export-bundle.test.ts && npm run typecheck`
Expected: PASS. bsdtar lists directories with a trailing `/`, so `wp-content/plugins/generateblocks/` matches by `startsWith` on its files too.

- [ ] **Step 5: Commit**

```bash
git add src/export/bundle.ts tests/unit/export-bundle.test.ts
git commit -m "feat(faktory): export wp-content archive with excludes and listing check"
```

---

### Task 3: Production compose, env example, restore README, size formatting

**Files:**
- Create: `src/export/templates.ts`
- Test: `tests/unit/export-templates.test.ts`

**Interfaces:**
- Consumes: `SITE_URL_PLACEHOLDER` (`src/export/db.ts`).
- Produces: `prodCompose(): string`; `envExample(): string`; `fmtSize(bytes: number): string` (`812 kB`, `2.1 MB`, `31 MB`); `type ReadmeInput = { slug: string; name: string; customPlugins: { plugin: string; postType: string }[]; forms: { id: string; name: string; gfId: number }[]; articles: string[]; vendorPlugins: string[] }`; `restoreReadme(input: ReadmeInput): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/export-templates.test.ts
import { describe, it, expect } from "vitest";
import { prodCompose, envExample, fmtSize, restoreReadme } from "../../src/export/templates.js";

describe("export templates", () => {
  it("prod compose has db, wordpress, wpcli, env variables and no WP_DEBUG", () => {
    const y = prodCompose();
    for (const s of ["services:", "  db:", "image: mariadb:11", "  wordpress:", "image: wordpress:php8.3-apache", "  wpcli:", "image: wordpress:cli-php8.3",
      "${SITE_PORT}:80", "MARIADB_PASSWORD: ${DB_PASSWORD}", "MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}", "WORDPRESS_DB_PASSWORD: ${DB_PASSWORD}",
      "./wp-content:/var/www/html/wp-content", "define('FS_METHOD', 'direct');", "restart: unless-stopped", "healthcheck:"]) expect(y).toContain(s);
    expect(y).not.toContain("WP_DEBUG");
  });
  it("env example lists the three variables", () => {
    expect(envExample()).toBe("SITE_PORT=8080\nDB_PASSWORD=change-me\nDB_ROOT_PASSWORD=change-me-too\n");
  });
  it("formats sizes", () => {
    expect(fmtSize(812_345)).toBe("812 kB");
    expect(fmtSize(2_088_575)).toBe("2.1 MB");
    expect(fmtSize(31_400_000)).toBe("31 MB");
    expect(fmtSize(999)).toBe("1 kB");
  });
  it("restore readme walks through restoration, post-restore and the manifest, in French", () => {
    const md = restoreReadme({
      slug: "boulangerie", name: "Maison Rivet", customPlugins: [{ plugin: "faktory-produits", postType: "produit" }],
      forms: [{ id: "contact", name: "Contact", gfId: 5 }], articles: ["la-galette"], vendorPlugins: ["gp-premium", "generateblocks-pro", "gravityforms", "gravityformscli"],
    });
    expect(md.startsWith("# Maison Rivet — livraison Faktory\n")).toBe(true);
    for (const s of [
      "cp .env.example .env", "tar -xzf wp-content.tar.gz", "docker compose -f docker-compose.prod.yml up -d --wait",
      "wp db import - < db.sql", "wp search-replace 'https://SITE_URL_PLACEHOLDER' 'https://www.exemple.fr' --all-tables-with-prefix",
      "wp search-replace 'https:\\/\\/SITE_URL_PLACEHOLDER' 'https:\\/\\/www.exemple.fr' --all-tables-with-prefix",
      "wp yoast index --reindex", "wp rewrite flush", "wp user update admin --user_pass=",
      "SMTP", "Gravity Forms", "GP Premium", "GenerateBlocks Pro", "WP Umbrella", "MANIFEST.json",
      "`faktory-produits` (type de contenu `produit`)", "Contact (Gravity Forms #5)", "la-galette",
    ]) expect(md, s).toContain(s);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/export-templates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/export/templates.ts
import { SITE_URL_PLACEHOLDER } from "./db.js";

/** Decision 15: the same stack as docker/docker-compose.yml, parameterized by .env, without WP_DEBUG. */
export function prodCompose(): string {
  return `services:
  db:
    image: mariadb:11
    restart: unless-stopped
    environment:
      MARIADB_ROOT_PASSWORD: \${DB_ROOT_PASSWORD}
      MARIADB_DATABASE: wordpress
      MARIADB_USER: wordpress
      MARIADB_PASSWORD: \${DB_PASSWORD}
    volumes:
      - db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 20

  wordpress:
    image: wordpress:php8.3-apache
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "\${SITE_PORT}:80"
    environment: &wpenv
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_NAME: wordpress
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: \${DB_PASSWORD}
      WORDPRESS_CONFIG_EXTRA: |
        define('FS_METHOD', 'direct');
    volumes:
      - core:/var/www/html
      - ./wp-content:/var/www/html/wp-content

  wpcli:
    image: wordpress:cli-php8.3
    depends_on:
      db:
        condition: service_healthy
      wordpress:
        condition: service_started
    user: "33:33"
    environment: *wpenv
    volumes:
      - core:/var/www/html
      - ./wp-content:/var/www/html/wp-content
    working_dir: /var/www/html
    entrypoint: ["sh", "-c", "sleep infinity"]

volumes:
  db:
  core:
`;
}

export function envExample(): string {
  return "SITE_PORT=8080\nDB_PASSWORD=change-me\nDB_ROOT_PASSWORD=change-me-too\n";
}

export function fmtSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} kB`;
  const mb = bytes / 1_000_000;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

export type ReadmeInput = {
  slug: string; name: string;
  customPlugins: { plugin: string; postType: string }[];
  forms: { id: string; name: string; gfId: number }[];
  articles: string[];
  vendorPlugins: string[];
};

const esc = (u: string): string => u.replace(/\//g, "\\/");

/** Decision 16: the restore runbook for Partikuls ops, in French. The real url is an example the operator replaces. */
export function restoreReadme(i: ReadmeInput): string {
  const W = "docker compose -f docker-compose.prod.yml exec -T wpcli wp";
  const real = "https://www.exemple.fr";
  return `# ${i.name} — livraison Faktory

Site WordPress GeneratePress + GenerateBlocks généré par Faktory (\`${i.slug}\`). Ce dossier contient tout ce qu'il faut pour le remettre en ligne sur un serveur Docker.

## Contenu

| Fichier | Rôle |
|---|---|
| \`db.sql\` | Base de données complète ; l'URL du site y vaut \`${SITE_URL_PLACEHOLDER}\` |
| \`wp-content.tar.gz\` | Thèmes (GeneratePress + enfant), extensions, médias, traductions |
| \`docker-compose.prod.yml\` | Stack de production : MariaDB 11, WordPress (php8.3-apache), WP-CLI |
| \`.env.example\` | Variables à copier dans \`.env\` : port, mots de passe |
| \`MANIFEST.json\` | Versions, pages, extensions sur mesure, formulaires, articles, résumé QA, coût |

## Restauration

\`\`\`bash
cp .env.example .env            # puis éditer : SITE_PORT, DB_PASSWORD, DB_ROOT_PASSWORD
tar -xzf wp-content.tar.gz      # crée ./wp-content
docker compose -f docker-compose.prod.yml up -d --wait
${W} db check                   # répéter jusqu'à succès : WordPress écrit wp-config.php au premier démarrage
${W} db import - < db.sql
${W} search-replace '${SITE_URL_PLACEHOLDER}' '${real}' --all-tables-with-prefix
${W} search-replace '${esc(SITE_URL_PLACEHOLDER)}' '${esc(real)}' --all-tables-with-prefix   # forme JSON (index Yoast)
${W} yoast index --reindex
${W} rewrite flush
${W} user update admin --user_pass='un-nouveau-mot-de-passe'   # ou : wp user create … --role=administrator puis wp user delete admin --reassign=<id>
\`\`\`

Remplacer \`${real}\` par l'URL réelle (avec le schéma, sans barre finale). Ouvrir ensuite la page d'accueil, une page intérieure et le formulaire de contact.

## Après la restauration

- **E-mails** : le conteneur n'envoie aucun mail. Installer une extension SMTP (ou configurer le relais de l'hébergeur) avant de compter sur les notifications Gravity Forms.
- **Licences** : ${i.vendorPlugins.join(", ")} sont installés sans clé ; renseigner les clés (GP Premium, GenerateBlocks Pro, Gravity Forms) dans leurs réglages pour recevoir les mises à jour.
- **Supervision** : ajouter le site dans WP Umbrella avec le nouvel administrateur.
- **HTTPS** : placer le port \`SITE_PORT\` derrière le reverse proxy TLS de l'hébergeur ; l'URL du site est déjà en \`https://\`.

## Ce que contient le site

- Extensions sur mesure : ${i.customPlugins.length ? i.customPlugins.map((p) => `\`${p.plugin}\` (type de contenu \`${p.postType}\`)`).join(", ") : "aucune"}.
- Formulaires : ${i.forms.length ? i.forms.map((f) => `${f.name} (Gravity Forms #${f.gfId})`).join(", ") : "aucun"}.
- Articles : ${i.articles.length ? i.articles.join(", ") : "aucun"}.

Le détail (versions WordPress et extensions, pages, résumé QA, coût de génération) est dans \`MANIFEST.json\`.
`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/export-templates.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/export/templates.ts tests/unit/export-templates.test.ts
git commit -m "feat(faktory): export templates — prod compose, env example, restore readme"
```

---

### Task 4: Manifest

**Files:**
- Create: `src/export/manifest.ts`
- Test: `tests/unit/export-manifest.test.ts`

**Interfaces:**
- Consumes: `wpOk`, `wpJson` (`src/wp.ts`); `PluginManifest`; `FormsManifest`; `QaReport`; `SiteSpec`; `articleSlug`.
- Produces: `faktoryVersion(): string` (from `package.json`); `type WpItem = { name: string; version: string; status: string }`; `gatherVersions(ctx): Promise<{ wordpress: string; plugins: WpItem[]; themes: WpItem[] }>`; `type Manifest` (spec decision 17); `type ManifestInput = { ctx: SiteContext; spec: SiteSpec; versions: …; manifests: PluginManifest[]; forms: FormsManifest; qa: QaReport | undefined; files: Record<string, number>; generatedAt: string }`; `buildManifest(input): Manifest`; `deps = { wpOk, wpJson }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/export-manifest.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps as wpDeps } from "../../src/wp.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { parsePluginManifest } from "../../src/schemas/plugin-manifest.js";
import { parseQaReport } from "../../src/schemas/qa.js";
import { gfPlacement } from "../../src/schemas/forms-manifest.js";
import { articleSlug } from "../../src/schemas/article.js";
import { faktoryVersion, gatherVersions, buildManifest } from "../../src/export/manifest.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const manifest = parsePluginManifest(JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8")));
const qa = parseQaReport(JSON.parse(readFileSync("fixtures/qa/report.json", "utf8")));
const PLUGINS = [{ name: "generateblocks", version: "2.4.1", status: "active" }, { name: "faktory-catalogue-produits", version: "1.0.0", status: "active" }];
const THEMES = [{ name: "faktory-boul", version: "0.1.0", status: "active" }, { name: "generatepress", version: "3.6.1", status: "parent" }];

function ctx(): SiteContext {
  const root = mkdtempSync(join(tmpdir(), "fk-manifest-"));
  const state = { ...createState("boul", 8101, "pw"), costUsd: 22.09 };
  return { config: loadConfig(root), slug: "boul", siteDir: join(root, "sites", "boul"), state };
}

describe("manifest", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("reads the faktory version from package.json", () => {
    expect(faktoryVersion()).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);
  });
  it("gathers wordpress, plugin and theme versions from wp-cli", async () => {
    const c = ctx();
    const exec = vi.spyOn(wpDeps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      const a = (cmd as string[]).slice(1).join(" ");
      if (a === "core version") return { stdout: "7.1\n", stderr: "PHP Warning: WP_DEBUG", code: 0 };
      if (a.startsWith("plugin list")) return { stdout: JSON.stringify(PLUGINS), stderr: "", code: 0 };
      if (a.startsWith("theme list")) return { stdout: JSON.stringify(THEMES), stderr: "", code: 0 };
      return { stdout: "", stderr: `unexpected ${a}`, code: 1 };
    });
    const v = await gatherVersions(c);
    expect(v).toEqual({ wordpress: "7.1", plugins: PLUGINS, themes: THEMES });
    expect(exec.mock.calls.map((k: any) => (k[2] as string[]).slice(1).join(" "))).toEqual([
      "core version", "plugin list --fields=name,version,status --format=json", "theme list --fields=name,version,status --format=json",
    ]);
  });
  it("builds the manifest from the spec, the artifacts and the versions", () => {
    const c = ctx();
    const m = buildManifest({
      ctx: c, spec, versions: { wordpress: "7.1", plugins: PLUGINS, themes: THEMES }, manifests: [manifest],
      forms: { contact: { gfId: 5, placement: gfPlacement(5) }, devis_evenement: { gfId: 4, placement: gfPlacement(4) } },
      qa, files: { "db.sql": 2088575, "wp-content.tar.gz": 31400000 }, generatedAt: "2026-09-13T17:00:00.000Z",
    });
    expect(m).toEqual({
      slug: "boul", name: "Maison Rivet", generatedAt: "2026-09-13T17:00:00.000Z", faktoryVersion: faktoryVersion(),
      wordpress: "7.1",
      theme: { generatepress: "3.6.1", child: "faktory-boul" },
      plugins: PLUGINS,
      pages: spec.sitemap.map((p) => ({ slug: p.slug, title: p.title, kind: p.kind, path: p.kind === "home" ? "/" : `/${p.slug}/` })),
      customPlugins: [{ feature: "catalogue_produits", plugin: "faktory-catalogue-produits", postType: manifest.postType, block: manifest.block }],
      forms: [{ id: "devis_evenement", name: spec.forms[0].name, gfId: 4 }, { id: "contact", name: spec.forms[1].name, gfId: 5 }],
      articles: spec.blog.articles.map((a) => articleSlug(a.title)),
      qa: { urls: 2, reviewed: 1, remainingIssues: 0, report: "qa/QA-REPORT.md" },
      costUsd: 22.09,
      files: { "db.sql": 2088575, "wp-content.tar.gz": 31400000 },
    });
  });
  it("qa is null without a report, theme version empty without generatepress, forms only when in the manifest", () => {
    const c = ctx();
    const m = buildManifest({ ctx: c, spec, versions: { wordpress: "7.1", plugins: [], themes: [] }, manifests: [], forms: {}, qa: undefined, files: {}, generatedAt: "x" });
    expect(m.qa).toBeNull();
    expect(m.theme).toEqual({ generatepress: "", child: "faktory-boul" });
    expect(m.forms).toEqual([]);
    expect(m.customPlugins).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/export-manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/export/manifest.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SiteContext } from "../docker.js";
import { wpJson, wpOk } from "../wp.js";
import { QA_REPORT_MD, type QaReport } from "../schemas/qa.js";
import { articleSlug } from "../schemas/article.js";
import type { PluginManifest } from "../schemas/plugin-manifest.js";
import type { FormsManifest } from "../schemas/forms-manifest.js";
import type { SiteSpec } from "../schemas/site-spec.js";

export const deps = { wpOk, wpJson };

export function faktoryVersion(): string {
  return (JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { version: string }).version;
}

export type WpItem = { name: string; version: string; status: string };
export type Versions = { wordpress: string; plugins: WpItem[]; themes: WpItem[] };

export async function gatherVersions(ctx: SiteContext): Promise<Versions> {
  const wordpress = await deps.wpOk(ctx, ["core", "version"]);
  const plugins = await deps.wpJson<WpItem[]>(ctx, ["plugin", "list", "--fields=name,version,status"]);
  const themes = await deps.wpJson<WpItem[]>(ctx, ["theme", "list", "--fields=name,version,status"]);
  return { wordpress, plugins, themes };
}

export type Manifest = {
  slug: string; name: string; generatedAt: string; faktoryVersion: string;
  wordpress: string;
  theme: { generatepress: string; child: string };
  plugins: WpItem[];
  pages: { slug: string; title: string; kind: string; path: string }[];
  customPlugins: { feature: string; plugin: string; postType: string; block: string }[];
  forms: { id: string; name: string; gfId: number }[];
  articles: string[];
  qa: { urls: number; reviewed: number; remainingIssues: number; report: string } | null;
  costUsd: number;
  files: Record<string, number>;
};

export type ManifestInput = {
  ctx: SiteContext; spec: SiteSpec; versions: Versions; manifests: PluginManifest[]; forms: FormsManifest;
  qa: QaReport | undefined; files: Record<string, number>; generatedAt: string;
};

/** Decision 17: everything an operator or a later Faktory needs to know about the bundle, derived from the artifacts — never typed by hand. */
export function buildManifest(i: ManifestInput): Manifest {
  return {
    slug: i.ctx.slug,
    name: i.spec.identity.name,
    generatedAt: i.generatedAt,
    faktoryVersion: faktoryVersion(),
    wordpress: i.versions.wordpress,
    theme: { generatepress: i.versions.themes.find((t) => t.name === "generatepress")?.version ?? "", child: `faktory-${i.ctx.slug}` },
    plugins: i.versions.plugins,
    pages: i.spec.sitemap.map((p) => ({ slug: p.slug, title: p.title, kind: p.kind, path: p.kind === "home" ? "/" : `/${p.slug}/` })),
    customPlugins: i.manifests.map((m) => ({ feature: m.feature, plugin: m.plugin, postType: m.postType, block: m.block })),
    forms: i.spec.forms.filter((f) => i.forms[f.id]).map((f) => ({ id: f.id, name: f.name, gfId: i.forms[f.id].gfId })),
    articles: i.spec.blog.articles.map((a) => articleSlug(a.title)),
    qa: i.qa ? { urls: i.qa.totals.urls, reviewed: i.qa.totals.reviewed, remainingIssues: i.qa.totals.remainingIssues, report: QA_REPORT_MD } : null,
    costUsd: i.ctx.state.costUsd,
    files: i.files,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/export-manifest.test.ts && npm run typecheck`
Expected: PASS. (The fixture spec lists `devis_evenement` before `contact` in `spec.forms`; the manifest keeps spec order.)

- [ ] **Step 5: Commit**

```bash
git add src/export/manifest.ts tests/unit/export-manifest.test.ts
git commit -m "feat(faktory): export manifest — versions, pages, plugins, forms, articles, qa, cost"
```

---

### Task 5: The `export` stage, registration and CLI alias

**Files:**
- Create: `src/stages/export.ts`
- Modify: `src/pipeline.ts` (`registry.export`), `src/cli.ts` (`export <slug>`)
- Test: `tests/unit/stage-export.test.ts`; modify `tests/unit/pipeline.test.ts` (registry keys), `tests/unit/cli.test.ts` (help lists `export`)

**Interfaces:**
- Consumes: Tasks 1–4; `readPluginManifests`, `readFormsManifest`; `readQaReport`; `VENDOR_PLUGINS`; `DIST_DIR`.
- Produces: `exportStage: Stage`; `DIST_FILES = ["db.sql", "wp-content.tar.gz", "docker-compose.prod.yml", ".env.example", "README.md", "MANIFEST.json"]`; `deps = { exportDb, bundleWpContent, listTar, gatherVersions }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/stage-export.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext, registry } from "../../src/pipeline.js";
import { writeJsonArtifact } from "../../src/artifacts.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { gfPlacement } from "../../src/schemas/forms-manifest.js";
import { SITE_URL_PLACEHOLDER } from "../../src/export/db.js";
import { exportStage, deps, DIST_FILES } from "../../src/stages/export.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const VERSIONS = { wordpress: "7.1", plugins: [{ name: "generateblocks", version: "2.4.1", status: "active" }], themes: [{ name: "generatepress", version: "3.6.1", status: "parent" }] };

async function ctx(opts: { manifest?: boolean; forms?: boolean; qa?: boolean } = {}): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stexport-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  writeJsonArtifact(c, "siteSpecJson", spec);
  if (opts.manifest) { mkdirSync(join(c.siteDir, "plugins"), { recursive: true }); copyFileSync("fixtures/plugins/catalogue_produits.manifest.json", join(c.siteDir, "plugins/catalogue_produits.json")); }
  if (opts.forms) writeFileSync(join(c.siteDir, "content/forms.json"), JSON.stringify({ contact: { gfId: 5, placement: gfPlacement(5) } }));
  if (opts.qa) copyFileSync("fixtures/qa/report.json", join(c.siteDir, "qa/report.json"));
  writeFileSync(join(c.siteDir, "dist/stale.txt"), "old");
  return c;
}
function spies(opts: { listing?: string[] } = {}) {
  const order: string[] = [];
  const db = vi.spyOn(deps, "exportDb").mockImplementation(async () => { order.push("db"); return { sql: `-- ${SITE_URL_PLACEHOLDER}\n`, bytes: 30 }; });
  const bundle = vi.spyOn(deps, "bundleWpContent").mockImplementation(async (_c, out) => { order.push("bundle"); mkdirSync(join(out, ".."), { recursive: true }); writeFileSync(out, "tgz"); return 3; });
  const list = vi.spyOn(deps, "listTar").mockResolvedValue(opts.listing ?? ["wp-content/themes/generatepress/style.css", "wp-content/themes/faktory-boul/style.css", "wp-content/plugins/generateblocks/", "wp-content/plugins/faktory-catalogue-produits/"]);
  const versions = vi.spyOn(deps, "gatherVersions").mockImplementation(async () => { order.push("versions"); return VERSIONS; });
  return { db, bundle, list, versions, order };
}

describe("export stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("is registered last in the pipeline, without checkpoint", () => {
    expect(registry.export).toBe(exportStage);
    expect(exportStage.checkpoint).toBeFalsy();
    expect(Object.keys(registry)).toEqual(["spec", "design", "provision", "pages", "plugins", "content", "qa", "export"]);
    expect(DIST_FILES).toEqual(["db.sql", "wp-content.tar.gz", "docker-compose.prod.yml", ".env.example", "README.md", "MANIFEST.json"]);
  });
  it("needs site-spec.json", async () => {
    const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stexport-")));
    await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
    await expect(exportStage.run(loadContext(config, "boul"))).rejects.toThrow(/site-spec.json not found/);
  });
  it("empties dist/, writes the six files and summarizes them with sizes", async () => {
    const c = await ctx({ manifest: true, forms: true, qa: true });
    const s = spies();
    const msg = await exportStage.run(c);
    expect(s.order).toEqual(["db", "bundle", "versions"]);
    const dist = join(c.siteDir, "dist");
    expect(readdirSync(dist).sort()).toEqual([...DIST_FILES].sort());
    expect(existsSync(join(dist, "stale.txt"))).toBe(false);
    expect(readFileSync(join(dist, "db.sql"), "utf8")).toContain(SITE_URL_PLACEHOLDER);
    expect(readFileSync(join(dist, "docker-compose.prod.yml"), "utf8")).toContain("image: mariadb:11");
    expect(readFileSync(join(dist, ".env.example"), "utf8")).toContain("SITE_PORT=");
    const readme = readFileSync(join(dist, "README.md"), "utf8");
    expect(readme).toContain("# Maison Rivet — livraison Faktory");
    expect(readme).toContain("`faktory-catalogue-produits`");
    expect(readme).toContain("Gravity Forms #5");
    const manifest = JSON.parse(readFileSync(join(dist, "MANIFEST.json"), "utf8"));
    expect(manifest.wordpress).toBe("7.1");
    expect(manifest.customPlugins).toHaveLength(1);
    expect(manifest.forms).toEqual([{ id: "contact", name: spec.forms.find((f) => f.id === "contact")!.name, gfId: 5 }]);
    expect(manifest.qa).toEqual({ urls: 2, reviewed: 1, remainingIssues: 0, report: "qa/QA-REPORT.md" });
    expect(Object.keys(manifest.files).sort()).toEqual(["README.md", ".env.example", "db.sql", "docker-compose.prod.yml", "wp-content.tar.gz"].sort());
    expect(manifest.files["db.sql"]).toBe(30);
    expect(msg).toBe("dist/: db.sql (1 kB), wp-content.tar.gz (1 kB), docker-compose.prod.yml, .env.example, README.md, MANIFEST.json");
  });
  it("works without plugins, forms or qa report", async () => {
    const c = await ctx();
    spies({ listing: ["wp-content/themes/generatepress/style.css", "wp-content/themes/faktory-boul/style.css", "wp-content/plugins/generateblocks/"] });
    await exportStage.run(c);
    const manifest = JSON.parse(readFileSync(join(c.siteDir, "dist/MANIFEST.json"), "utf8"));
    expect(manifest.qa).toBeNull();
    expect(manifest.customPlugins).toEqual([]);
    expect(manifest.forms).toEqual([]);
  });
  it("fails when the archive misses a required entry, keeping db.sql for inspection", async () => {
    const c = await ctx({ manifest: true });
    spies({ listing: ["wp-content/themes/generatepress/style.css"] });
    await expect(exportStage.run(c)).rejects.toThrow(/wp-content.tar.gz is missing: wp-content\/themes\/faktory-boul\/style.css, wp-content\/plugins\/generateblocks\/, wp-content\/plugins\/faktory-catalogue-produits\//);
    expect(existsSync(join(c.siteDir, "dist/db.sql"))).toBe(true);
    expect(existsSync(join(c.siteDir, "dist/MANIFEST.json"))).toBe(false);
  });
  it("propagates a db export failure before touching the archive", async () => {
    const c = await ctx();
    const s = spies();
    s.db.mockRejectedValue(new Error("db.sql still contains 5 occurrence(s) of localhost:8101"));
    await expect(exportStage.run(c)).rejects.toThrow(/still contains 5/);
    expect(s.bundle).not.toHaveBeenCalled();
  });
});
```

In `tests/unit/pipeline.test.ts` set the expected registry keys to `["spec", "design", "provision", "pages", "plugins", "content", "qa", "export"]`. In `tests/unit/cli.test.ts` add `"export"` to the list of commands expected in `--help`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/stage-export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the stage**

```ts
// src/stages/export.ts
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Stage } from "../pipeline.js";
import { readJsonArtifact, DIST_DIR } from "../artifacts.js";
import { readFormsManifest, readPluginManifests } from "../pages/placements.js";
import { VENDOR_PLUGINS } from "../provision/stack.js";
import { exportDb } from "../export/db.js";
import { assertTarEntries, bundleWpContent, listTar, requiredTarEntries } from "../export/bundle.js";
import { envExample, fmtSize, prodCompose, restoreReadme } from "../export/templates.js";
import { buildManifest, gatherVersions } from "../export/manifest.js";
import { parseSiteSpec } from "../schemas/site-spec.js";
import { readQaReport } from "../schemas/qa.js";
import { articleSlug } from "../schemas/article.js";

export const deps = { exportDb, bundleWpContent, listTar, gatherVersions };
export const DIST_FILES = ["db.sql", "wp-content.tar.gz", "docker-compose.prod.yml", ".env.example", "README.md", "MANIFEST.json"] as const;

export const exportStage: Stage = {
  name: "export",
  async run(ctx) {
    const spec = readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec);
    const manifests = readPluginManifests(ctx);
    const forms = readFormsManifest(ctx);
    const qa = readQaReport(ctx);
    const dist = join(ctx.siteDir, DIST_DIR);
    rmSync(dist, { recursive: true, force: true });
    mkdirSync(dist, { recursive: true });

    // 1. database (decision 13) — first: it is the step most likely to fail, and nothing else is worth doing without it
    const db = await deps.exportDb(ctx);
    writeFileSync(join(dist, "db.sql"), db.sql);
    console.log(`  ✔ db.sql (${fmtSize(db.bytes)})`);

    // 2. wp-content (decision 14)
    const tar = join(dist, "wp-content.tar.gz");
    const tarBytes = await deps.bundleWpContent(ctx, tar);
    assertTarEntries(await deps.listTar(tar), requiredTarEntries(ctx, manifests));
    console.log(`  ✔ wp-content.tar.gz (${fmtSize(tarBytes)})`);

    // 3. stack + runbook (decisions 15, 16)
    writeFileSync(join(dist, "docker-compose.prod.yml"), prodCompose());
    writeFileSync(join(dist, ".env.example"), envExample());
    writeFileSync(join(dist, "README.md"), restoreReadme({
      slug: ctx.slug, name: spec.identity.name,
      customPlugins: manifests.map((m) => ({ plugin: m.plugin, postType: m.postType })),
      forms: spec.forms.filter((f) => forms[f.id]).map((f) => ({ id: f.id, name: f.name, gfId: forms[f.id].gfId })),
      articles: spec.blog.articles.map((a) => articleSlug(a.title)),
      vendorPlugins: VENDOR_PLUGINS.map((v) => v.slug),
    }));

    // 4. manifest (decision 17) — sizes of everything written so far
    const versions = await deps.gatherVersions(ctx);
    const files: Record<string, number> = {};
    for (const f of DIST_FILES) if (f !== "MANIFEST.json") files[f] = statSync(join(dist, f)).size;
    const manifest = buildManifest({ ctx, spec, versions, manifests, forms, qa, files, generatedAt: new Date().toISOString() });
    writeFileSync(join(dist, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");

    return `${DIST_DIR}/: db.sql (${fmtSize(db.bytes)}), wp-content.tar.gz (${fmtSize(tarBytes)}), docker-compose.prod.yml, .env.example, README.md, MANIFEST.json`;
  },
};
```

In `src/pipeline.ts` add `import { exportStage } from "./stages/export.js";` and `export: exportStage` at the end of `registry`. In `src/cli.ts` after the `provision` command add:

```ts
program.command("export <slug>").description("Alias for run --only export (writes sites/<slug>/dist/)")
  .action(async (slug: string) => { await runSite(loadConfig(), slug, { only: "export" }); });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/stage-export.test.ts tests/unit/pipeline.test.ts tests/unit/cli.test.ts && npm run typecheck && npm test`
Expected: all PASS. (`fmtSize(30)` and `fmtSize(3)` both give `1 kB` — the floor in `fmtSize`.)

- [ ] **Step 5: Commit**

```bash
git add src/stages/export.ts src/pipeline.ts src/cli.ts tests/unit/stage-export.test.ts tests/unit/pipeline.test.ts tests/unit/cli.test.ts
git commit -m "feat(faktory): export stage — dist/ bundle, prod compose, readme, manifest; faktory export alias"
```

---

### Task 6: Docker integration test — export, then restore in a fresh stack

**Files:**
- Create: `tests/integration/export.test.ts`

Source site on port **8198** (provision + stub pages + stub content, like `tests/integration/content.test.ts`), restored site on port **8199** from the exported `docker-compose.prod.yml`, Compose project `faktory-itrestore`.

- [ ] **Step 1: Write the test**

```ts
// tests/integration/export.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { run } from "../../src/exec.js";
import { artifactPath, pageTreePath } from "../../src/artifacts.js";
import { articlePath, articleSlug, type Article } from "../../src/schemas/article.js";
import { featureMarker, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type GbNode, type PageTree } from "../../src/schemas/page-tree.js";
import { SITE_URL_PLACEHOLDER } from "../../src/export/db.js";
import { deps as pagesDeps } from "../../src/stages/pages.js";
import { deps as contentDeps } from "../../src/stages/content.js";
import type { Page } from "../../src/schemas/site-spec.js";
import type { SiteContext } from "../../src/docker.js";

const FIXTURE_ARTICLE = "fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json";
const RESTORE_PORT = 8199;
const PROJECT = "faktory-itrestore";

function stubTree(page: Page): PageTree {
  return page.sections.map((s, i): GbNode => ({
    type: "element", tagName: "section", htmlAttributes: { id: `s-${i}` }, styles: { padding: "48px 24px" },
    innerBlocks: [
      { type: "text", tagName: i === 0 ? "h1" : "h2", content: s.heading },
      { type: "text", tagName: "p", content: s.summary },
      ...(s.type === "custom-query" && s.feature
        ? [{ type: "element", tagName: "div", htmlAttributes: { [FEATURE_WRAPPER_ATTR]: s.feature }, innerBlocks: [{ type: "text", tagName: "p", content: "Exemple" }, { type: "raw", rawMarkup: featureMarker(s.feature) }] } satisfies GbNode]
        : []),
      ...((s.type === "form" || s.type === "contact") && s.form && !page.sections.slice(0, i).some((x) => x.form === s.form)
        ? [{ type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: s.form }, innerBlocks: [{ type: "raw", rawMarkup: formMarker(s.form) }, { type: "text", tagName: "p", content: "Le formulaire sera disponible ici." }] } satisfies GbNode]
        : []),
    ] satisfies GbNode[],
  }));
}

/** `docker compose` in the restore dir with the exported file; env from its .env. */
const compose = (dir: string, ...args: string[]) => run("docker", ["compose", "-p", PROJECT, "-f", join(dir, "docker-compose.prod.yml"), "--env-file", join(dir, ".env"), ...args], { cwd: dir });
const wp = (dir: string, args: string[], input?: string) =>
  run("docker", ["compose", "-p", PROJECT, "-f", join(dir, "docker-compose.prod.yml"), "--env-file", join(dir, ".env"), "exec", "-T", "wpcli", "wp", ...args], { cwd: dir, input });

describe.skipIf(!process.env.FAKTORY_DOCKER)("export stage and restore on a throwaway site (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8198 };
  const restoreDir = mkdtempSync(join(tmpdir(), "faktory-restore-"));
  let ctx: SiteContext;
  const fixture = (): Article => JSON.parse(readFileSync(FIXTURE_ARTICLE, "utf8"));
  beforeAll(async () => {
    await initSite(config, { slug: "itexport", briefPath: "fixtures/briefs/boulangerie.md" });
    ctx = loadContext(config, "itexport");
    copyFileSync("fixtures/specs/boulangerie.site-spec.json", artifactPath(ctx, "siteSpecJson"));
    copyFileSync("fixtures/specs/boulangerie.design-tokens.json", artifactPath(ctx, "designTokensJson"));
    writeFileSync(artifactPath(ctx, "designSystemMd"), "# Maison Rivet — Design System Web\n");
    const p = await runSite(config, "itexport", { only: "provision" });
    expect(p.stages.provision.status, p.stages.provision.message).toBe("done");
    vi.spyOn(pagesDeps, "generatePageTree").mockImplementation(async (c, _spec, page) => {
      const tree = stubTree(page);
      writeFileSync(pageTreePath(c, page.slug), JSON.stringify(tree, null, 2));
      return { tree, costUsd: 0, attempts: 1 as const };
    });
    expect((await runSite(config, "itexport", { only: "pages" })).stages.pages.status).toBe("done");
    vi.spyOn(contentDeps, "generateArticle").mockImplementation(async (c, _s, article) => {
      const slug = articleSlug(article.title);
      const a: Article = { ...fixture(), title: article.title, category: article.theme };
      mkdirSync(dirname(articlePath(c, slug)), { recursive: true });
      writeFileSync(articlePath(c, slug), JSON.stringify(a, null, 2));
      return { article: a, slug, costUsd: 0, attempts: 1 as const };
    });
    expect((await runSite(config, "itexport", { only: "content" })).stages.content.status).toBe("done");
  }, 600_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    await compose(restoreDir, "down", "-v");
    await destroySite(config, "itexport");
  });

  it("writes dist/ with a placeholder-only dump and a complete archive", async () => {
    const state = await runSite(config, "itexport", { only: "export" });
    expect(state.stages.export.status, state.stages.export.message).toBe("done");
    expect(state.stages.export.message).toMatch(/^dist\/: db\.sql \([\d.]+ [kM]B\), wp-content\.tar\.gz \(\d+ MB\), docker-compose\.prod\.yml, \.env\.example, README\.md, MANIFEST\.json$/);
    const dist = join(ctx.siteDir, "dist");
    const sql = readFileSync(join(dist, "db.sql"), "utf8");
    expect(sql).toContain(`'siteurl','${SITE_URL_PLACEHOLDER}'`);
    expect(sql).not.toContain(`localhost:${ctx.state.port}`);
    const manifest = JSON.parse(readFileSync(join(dist, "MANIFEST.json"), "utf8"));
    expect(manifest.wordpress).toMatch(/^\d+\.\d+/);
    expect(manifest.theme.generatepress).toMatch(/^\d+\.\d+/);
    expect(manifest.plugins.map((p: any) => p.name)).toContain("gravityforms");
    expect(manifest.forms.map((f: any) => f.id).sort()).toEqual(["contact", "devis_evenement"]);
    expect(manifest.articles).toHaveLength(3);
    expect(manifest.qa).toBeNull();
    const listing = (await run("tar", ["-tzf", join(dist, "wp-content.tar.gz")])).stdout;
    expect(listing).toContain("wp-content/themes/faktory-itexport/style.css");
    expect(listing).not.toContain("twentytwentyfive");
    // the live site is untouched
    const home = await (await fetch(`http://localhost:${ctx.state.port}/`)).text();
    expect(home).toContain("gb-element-");
  }, 600_000);

  it("restores dist/ into a fresh stack from the exported compose file and the site renders", async () => {
    const dist = join(ctx.siteDir, "dist");
    cpSync(dist, restoreDir, { recursive: true });
    writeFileSync(join(restoreDir, ".env"), `SITE_PORT=${RESTORE_PORT}\nDB_PASSWORD=wordpress\nDB_ROOT_PASSWORD=root\n`);
    const untar = await run("tar", ["-xzf", join(restoreDir, "wp-content.tar.gz"), "-C", restoreDir]);
    expect(untar.code, untar.stderr).toBe(0);
    expect(existsSync(join(restoreDir, "wp-content/themes/generatepress/style.css"))).toBe(true);
    const up = await compose(restoreDir, "up", "-d", "--wait");
    expect(up.code, up.stderr).toBe(0);
    // wp-config.php appears once the wordpress entrypoint has run: retry db check like waitForDb
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) { ready = (await wp(restoreDir, ["db", "check"])).code === 0; if (!ready) await new Promise((r) => setTimeout(r, 2000)); }
    expect(ready).toBe(true);
    const imp = await wp(restoreDir, ["db", "import", "-"], readFileSync(join(restoreDir, "db.sql"), "utf8"));
    expect(imp.code, imp.stderr).toBe(0);
    const url = `http://localhost:${RESTORE_PORT}`;
    for (const [from, to] of [[SITE_URL_PLACEHOLDER, url], [SITE_URL_PLACEHOLDER.replace(/\//g, "\\/"), url.replace(/\//g, "\\/")]]) {
      const sr = await wp(restoreDir, ["search-replace", from, to, "--all-tables-with-prefix"]);
      expect(sr.code, sr.stderr).toBe(0);
    }
    expect((await wp(restoreDir, ["rewrite", "flush"])).code).toBe(0);
    const home = await fetch(`${url}/`);
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain("Maison Rivet");
    expect(html).toContain("gb-element-");
    expect(html).toContain("generateblocks-inline-css");
    const contact = await (await fetch(`${url}/contact/`)).text();
    expect(contact).toContain("gform_wrapper_");
    const article = await fetch(`${url}/${articleSlug("La galette des rois revient : frangipane ou pomme ?")}/`);
    expect(article.status).toBe(200);
  }, 600_000);
});
```

- [ ] **Step 2: Run it**

```bash
FAKTORY_DOCKER=1 npx vitest run tests/integration/export.test.ts --testTimeout=600000 --hookTimeout=600000
```

Expected: 2 tests pass in ≈ 6–8 min. If the restored home page is a 500 or the WordPress install screen: the import ran before `wp-config.php` existed (the `db check` loop must succeed first) or the `.env` was not picked up (`--env-file` must point at the restore dir's `.env`). If `search-replace` on the escaped form reports 0 replacements, that is fine (the stub site may have no Yoast indexable with a media url). If Yoast prints `Skipping an uninitialized class` on stderr, ignore it: exit code is what matters.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/export.test.ts
git commit -m "test(faktory): export stage docker integration test with restore in a fresh stack"
```

---

### Task 7: Live export of boulangerie, docs, deviations

**Files:**
- Modify: `README.md` (Usage, Artifacts, Stages, an « Export » section), `docs/superpowers/specs/2026-09-13-faktory-phase6-qa-export-design.md` (« Écarts constatés à l'exécution — export »)

- [ ] **Step 1: Export the live site and restore it by hand once**

```bash
npm run faktory -- export boulangerie
ls -la sites/boulangerie/dist/
cat sites/boulangerie/dist/MANIFEST.json | head -40
```

Then follow `sites/boulangerie/dist/README.md` in a temporary directory with `SITE_PORT=8299` and the real url set to `http://localhost:8299`, open the site, check the home page, `/nos-produits/` (plugin grid with the 5 seeded products and their images), `/contact/` (form), one article; then `docker compose -p <that dir's project> -f docker-compose.prod.yml down -v` and delete the directory. Note the sizes printed by the stage.

- [ ] **Step 2: README**

- Usage: add `npm run faktory -- export boulangerie             # $0: sites/boulangerie/dist/ — db.sql (URL placeholder), wp-content.tar.gz, prod compose, README, MANIFEST` and describe `faktory run boulangerie` now running through `qa` and `export`.
- Artifacts table: add `dist/*` (written by export, rewritten every run, not editable).
- Stages: replace the sentence about `export` being skipped by `Phase 6a implements \`qa\`, phase 6b \`export\`: every stage of the pipeline is implemented.`
- New section after « QA »:

```markdown
### Export
`export` is deterministic ($0) and rewrites `dist/` every run: `db.sql` is `wp search-replace http://localhost:<port> https://SITE_URL_PLACEHOLDER --all-tables-with-prefix --export` plus a pass on the JSON-escaped form Yoast stores, verified to contain no local URL; `wp-content.tar.gz` holds plugins, themes (without the bundled `twenty*`), uploads and languages, verified to contain the parent and child themes, GenerateBlocks and every custom plugin; `docker-compose.prod.yml` + `.env.example` describe the production stack (no `WP_DEBUG`); `README.md` (French) is the restore runbook — compose up, `wp db import`, both `search-replace` forms to the real URL, Yoast reindex, rewrite flush, admin password, then SMTP, licence keys and WP Umbrella; `MANIFEST.json` records versions, pages, custom plugins, forms, articles, the QA summary, the cumulated cost and file sizes. `faktory export <slug>` is an alias of `run --only export`. The integration test restores `dist/` into a fresh stack from the exported compose file.
```

- Cost: add `\`export\` is $0; measured bundle on boulangerie: db.sql X MB, wp-content.tar.gz Y MB.`

- [ ] **Step 3: Spec addendum**

Append to the phase 6 spec a section `## Écarts constatés à l'exécution — export (2026-09-13)` (at least: the restore test uses port 8199 for the restored stack in addition to 8198; measured sizes; anything the manual restore revealed — e.g. whether `wp rewrite flush` was needed, whether the escaped search-replace found rows on the real site).

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-13-faktory-phase6-qa-export-design.md
git commit -m "docs(faktory): export stage usage, measured bundle, phase 6b deviations"
```

---

## Done criteria for phase 6

`npm run faktory -- run <slug>` on a fresh brief goes spec ⏸ → design ⏸ → provision → plugins → pages → content → qa → export with no stage marked "skipped (not implemented)"; `sites/<slug>/qa/QA-REPORT.md` and `sites/<slug>/dist/` exist; `dist/` restored in a fresh Compose stack renders the same site. Phase 7 (E2E run on the boulangerie brief from scratch, cost/duration measurement, README) is the design's last build step.
