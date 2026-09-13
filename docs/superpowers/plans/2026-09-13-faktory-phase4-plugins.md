# Faktory Phase 4 — Plugins Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `faktory run <slug>` writes, checks (php -l + PHPStan), activates and seeds one custom WordPress plugin per `feature` of the site spec, then renders that plugin inside the pages in place of the example cards left by the `pages` stage.

**Architecture:** The `plugins` stage is code-owned like `pages`: one `query()` per feature, run sequentially, whose deliverables are the plugin directory `wp-content/plugins/faktory-<kebab>/` and a manifest `plugins/<id>.json` listing the block markup to place on each page. Faktory validates (manifest schema + cross-checks, required files, `php_check`, no hex in CSS, plugin active, CPT registered, ≥ 3 seeded entries, taxonomy terms present) with one `runValidated` retry, then integrates: page trees keep their placeholder wrapper forever and `applyPlugins(tree, manifests, pageSlug)` swaps the wrapper for a `raw` node **in memory at compile time**, in both the `plugins` and the `pages` stage; after republishing, Faktory fetches each page and requires the `data-faktory-plugin="<id>"` attribute the plugin's render function must emit. A new `php_check` MCP tool runs the host `php -l` and a composer-installed PHPStan (level 5, `szepeviktor/phpstan-wordpress`). `AgentOptions.writeRoots` restricts agent writes per stage.

**Tech Stack:** Node 24, TypeScript 5, `@anthropic-ai/claude-agent-sdk` 0.3.269, `zod` 4, `commander` 12, `vitest` 2, `tsx`, Python 3 (`gb_build.py`), Docker Compose, WP-CLI, host PHP 8.5 + Composer, PHPStan 2.2 + `szepeviktor/phpstan-wordpress` 2.0. WordPress 6.x, GeneratePress 3.6.1, GenerateBlocks 2.4.1.

**Spec:** `docs/superpowers/specs/2026-09-13-faktory-phase4-plugins-design.md` (this plan implements it entirely) on top of `docs/superpowers/specs/2026-09-12-faktory-design.md` section « 4. plugins ».

## Global Constraints

- Repo root `/Users/khelil/Developer/partikuls/faktory`; git root is the parent `partikuls` monorepo (run `git` from `faktory/`, paths relative to it). Work on branch `faktory/phase4` (already created, holds the spec commit 9333fed5). No `origin` remote: commits only, no push.
- ESM only, strict TS, imports between `src/` files use the `.js` suffix. Run `npm run typecheck` before every commit.
- **zod 4** (`import { z } from "zod"`). **Never use `z.record(...)` or `z.json()` in an in-process MCP `tool()` input shape** (breaks `tools/list` for the whole server); `z.record` is fine in ordinary schemas (`page-tree.ts` uses it).
- Default model `claude-opus-5` from `config.models.default`; never hardcode a model in a stage.
- `runAgent` keeps `settingSources: []`, `skills: pluginSkillNames()`, always allows `Skill`, `strictMcpConfig: true`, persists cost even on error. Do not change these.
- Every shell call goes through `src/exec.ts` `run()` (never throws; inspect `code`). WP-CLI goes through `src/wp.ts` (`runWp`, `wpOk`, `wpJson`).
- `sites/`, `docker/vendor/*.zip`, `docker/.env`, `plugin/skills/` are gitignored; this phase adds `tools/phpstan/vendor/`. `fixtures/` is committed.
- Test conventions: `deps` objects on modules as spy seams (`vi.spyOn(deps, "fn")`); helper params typed `any` where vitest 2.1.9 + strict tsc fight; void spies use `mockResolvedValue(undefined)`; `beforeEach(() => vi.restoreAllMocks())`. Unit tests that need a site dir use `loadConfig(mkdtempSync(...))` + `initSite(config, { slug, briefPath: "fixtures/briefs/boulangerie.md" })` + `loadContext`.
- Integration tests needing Docker: `describe.skipIf(!process.env.FAKTORY_DOCKER)`, run with `FAKTORY_DOCKER=1 npm run test:integration`. Ports used: 8190-8194. **This phase uses 8195.**
- Unit tests that need the host PHP toolchain are guarded with `describe.skipIf(!existsSync("tools/phpstan/vendor/bin/phpstan"))`.
- Fixture spec `fixtures/specs/boulangerie.site-spec.json` has one feature: `id: "catalogue_produits"`, `cpt.slug: "produit"`, fields `prix` (price), `disponibilite` (select: Tous les jours / Week-end / Sur commande), `mis_en_avant` (boolean), taxonomy `categorie_produit` with terms Pains, Viennoiseries, Pâtisseries, Salé du midi; pages `accueil` (home) and `nos-produits` each have one `custom-query` section referencing it. The live `sites/boulangerie` spec uses `id: "produits"` instead (same CPT) — the code must derive everything from the id, never hardcode either.
- Naming derived from a feature id `<id>` (snake_case): `<kebab>` = id with `_` → `-`; plugin slug `faktory-<kebab>`; block `faktory/<kebab>`; shortcode `faktory_<id>`; render function `faktory_<id>_render`; meta keys `_<cpt.slug>_<field.key>`; render root attribute `data-faktory-plugin="<id>"`.
- Phase 3 helpers to reuse, not duplicate: `findWrapper`, `walk`, `featureMarker`, `FEATURE_WRAPPER_ATTR` (`src/schemas/page-tree.ts`); `compilePage`, `publishPage` (`src/pages/publish.ts`); `readPageTree` (`src/pages/generate.ts`); `ensurePages` (`src/provision/pages.ts`); `runValidated`, `retryPrompt` (`src/agent.ts`); `assertBudget` (`src/budget.ts`); `siteUrl` (`src/docker.ts`); `resolveSitePath` (`src/tools/server.ts`).

## Decisions taken for this phase (approved 2026-09-13, keep them)

1. Stage order stays `provision → plugins → pages`; substitution happens at compile time (`applyPlugins`), never by mutating `pages/<slug>.gb.json`.
2. One agent per feature, sequential; per-agent budget split stays deferred.
3. Agent tools: Read, Write, Edit, Glob, Grep, `wp`, `php_check`; no Bash. Deliverables: plugin dir + manifest; the agent activates and seeds with `wp`.
4. Faktory validates via `runValidated` then integrates (recompile + republish + HTTP check of `data-faktory-plugin`).
5. Existing manifest + plugin dir = reuse (no LLM): re-verify + re-integrate. Poisoned manifest deleted after the failed retry.
6. `php_check` = host `php -l` + PHPStan level 5 from `tools/phpstan/` (composer); explicit failure when PHPStan is missing.
7. `AgentOptions.writeRoots`; pages → `["pages"]`, plugins → `["wp-content/plugins/faktory-<kebab>", "plugins"]`.
8. PHP-only plugin with a plain-JS (no build) block editor script; first `image` field = featured image.

---

## File Structure

| File | Responsibility |
|---|---|
| `tools/phpstan/composer.json`, `tools/phpstan/phpstan.neon`, `.gitignore`, `package.json` | PHPStan toolchain (`npm run setup-phpstan`) |
| `src/php.ts` | `listPhpFiles`, `phpstanBin`, `phpCheck(config, dir)` → `{ ok, output, files }` |
| `src/tools/server.ts` (modify) | `php_check` tool, `TOOL_PHP_CHECK` |
| `src/cli.ts` (modify) | `doctor`: php, composer, phpstan |
| `fixtures/plugins/faktory-catalogue-produits/**`, `fixtures/plugins/catalogue_produits.manifest.json` | Reference plugin + manifest for the fixture spec |
| `src/schemas/page-tree.ts` (modify) | Export `hexIssues`, `DENYLIST_RE` |
| `src/schemas/plugin-manifest.ts` | Naming helpers, paths, zod schema, `parsePluginManifest`, `placementPages`, `validatePluginManifest`, `assertPluginManifest`, `requiredPluginFiles` |
| `src/pages/apply-plugins.ts` | `applyPlugins`, `readPluginManifests` |
| `src/stages/pages.ts` (modify) | Apply manifests before compiling |
| `src/agent.ts` (modify) | `writeGuard(siteDir, roots?)`, `AgentOptions.writeRoots` |
| `src/pages/generate.ts` (modify) | `writeRoots: ["pages"]` |
| `src/prompts/plugins.md`, `src/prompts.ts` (modify) | Plugins system prompt |
| `src/plugins/generate.ts` | `pluginsUserPrompt`, `readPluginManifest`, `verifyPlugin`, `generatePlugin`, `PLUGINS_TOOLS` |
| `src/plugins/integrate.ts` | `integratePlugin`, `pageUrl` |
| `src/stages/plugins.ts` | `pluginsStage` |
| `src/pipeline.ts` (modify) | Register `plugins` |
| `src/workspace.ts` (modify) | `initSite` creates `plugins/` |
| `tests/unit/{php,plugin-manifest,apply-plugins,plugins-generate,plugins-integrate,stage-plugins}.test.ts`, `tests/unit/{agent,tools-server,stage-pages,pages-generate,cli,workspace}.test.ts` (modify) | Unit tests |
| `tests/integration/plugins.test.ts` | Docker, port 8195 |
| `README.md`, memory | Docs + measured cost |

---

### Task 1: PHPStan toolchain, `phpCheck`, `php_check` tool, doctor checks

**Files:**
- Create: `tools/phpstan/composer.json`, `tools/phpstan/phpstan.neon`, `src/php.ts`, `tests/unit/php.test.ts`
- Modify: `.gitignore`, `package.json`, `src/tools/server.ts`, `src/cli.ts`, `tests/unit/tools-server.test.ts`

**Interfaces:**
- Produces: `phpCheck(config: FaktoryConfig, dir: string): Promise<PhpCheckResult>` with `type PhpCheckResult = { ok: boolean; output: string; files: number }`; `phpstanBin(config)`, `phpstanConfigPath(config)`, `listPhpFiles(dir): string[]`; `deps = { run }` in `src/php.ts`; `TOOL_PHP_CHECK = "mcp__faktory__php_check"` and `phpCheckToolHandler(ctx)` in `src/tools/server.ts`.

- [ ] **Step 1: Toolchain files**

`tools/phpstan/composer.json`:
```json
{
  "name": "partikuls/faktory-phpstan",
  "description": "PHPStan toolchain used by Faktory's php_check tool (npm run setup-phpstan)",
  "type": "project",
  "license": "proprietary",
  "require-dev": {
    "phpstan/phpstan": "^2.2",
    "szepeviktor/phpstan-wordpress": "^2.0"
  },
  "config": { "sort-packages": true }
}
```
`tools/phpstan/phpstan.neon`:
```neon
includes:
  - vendor/szepeviktor/phpstan-wordpress/extension.neon
parameters:
  level: 5
  treatPhpDocTypesAsCertain: false
  reportUnmatchedIgnoredErrors: false
```
Append to `.gitignore`: `tools/phpstan/vendor/` and `tools/phpstan/composer.lock`. Add to `package.json` scripts: `"setup-phpstan": "composer install -d tools/phpstan --no-interaction"`.

Run: `npm run setup-phpstan && tools/phpstan/vendor/bin/phpstan --version`
Expected: PHPStan 2.2.x. If composer refuses PHP 8.5 for a package, add `"platform": { "php": "8.3.0" }` under `config` and re-run.

- [ ] **Step 2: Failing unit tests for `phpCheck`**

`tests/unit/php.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { phpCheck, listPhpFiles, phpstanBin, phpstanConfigPath, deps } from "../../src/php.js";

const config = loadConfig("/tmp/fk");
function pluginDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "fk-php-"));
  for (const [rel, body] of Object.entries(files)) { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), body); }
  return dir;
}
const okRun = { stdout: "", stderr: "", code: 0 };

describe("php paths", () => {
  it("point at tools/phpstan inside the repo", () => {
    expect(phpstanBin(config)).toBe("/tmp/fk/tools/phpstan/vendor/bin/phpstan");
    expect(phpstanConfigPath(config)).toBe("/tmp/fk/tools/phpstan/phpstan.neon");
  });
  it("lists .php files recursively, sorted, skipping vendor and node_modules", () => {
    const dir = pluginDir({ "b.php": "", "includes/a.php": "", "vendor/x.php": "", "node_modules/y.php": "", "style.css": "" });
    expect(listPhpFiles(dir).map((f) => f.slice(dir.length + 1))).toEqual(["b.php", "includes/a.php"]);
  });
});

describe("phpCheck (mocked run)", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("fails on a missing dir or a dir without PHP", async () => {
    expect(await phpCheck(config, "/nope/none")).toMatchObject({ ok: false, files: 0 });
    expect((await phpCheck(config, pluginDir({ "style.css": "" }))).output).toMatch(/no PHP files/);
  });
  it("runs php -l on every file and reports lint errors without running phpstan", async () => {
    const dir = pluginDir({ "a.php": "<?php", "b.php": "<?php" });
    const run = vi.spyOn(deps, "run").mockImplementation(async (_cmd, args: any) =>
      args[1]?.endsWith("b.php") ? { stdout: "", stderr: "PHP Parse error: syntax error in b.php on line 1", code: 255 } : okRun);
    const r = await phpCheck(config, dir);
    expect(r).toMatchObject({ ok: false, files: 2 });
    expect(r.output).toContain("php -l");
    expect(r.output).toContain("b.php on line 1");
    expect(run.mock.calls.every((c: any) => c[0] === "php")).toBe(true);
  });
  it("fails explicitly when phpstan is not installed", async () => {
    const dir = pluginDir({ "a.php": "<?php" });
    vi.spyOn(deps, "run").mockResolvedValue(okRun);
    const r = await phpCheck({ ...config, repoRoot: "/tmp/fk-no-phpstan" }, dir);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/PHPStan not installed — run npm run setup-phpstan/);
  });
  it("runs phpstan level 5 with the repo config and returns its output", async () => {
    const dir = pluginDir({ "a.php": "<?php" });
    const root = mkdtempSync(join(tmpdir(), "fk-root-"));
    mkdirSync(join(root, "tools/phpstan/vendor/bin"), { recursive: true });
    writeFileSync(join(root, "tools/phpstan/vendor/bin/phpstan"), "");
    const run = vi.spyOn(deps, "run").mockImplementation(async (cmd) => cmd === "php" ? okRun : { stdout: "a.php:3:Undefined variable $x\n", stderr: "", code: 1 });
    const r = await phpCheck({ ...config, repoRoot: root }, dir);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("Undefined variable $x");
    const call = run.mock.calls.find((c: any) => c[0] !== "php")!;
    expect(call[0]).toBe(join(root, "tools/phpstan/vendor/bin/phpstan"));
    expect(call[1]).toEqual(["analyse", "--no-progress", "--error-format=raw", "--level=5", "--memory-limit=512M", "-c", join(root, "tools/phpstan/phpstan.neon"), dir]);
    expect(call[2]).toMatchObject({ cwd: join(root, "tools/phpstan") });
  });
  it("reports OK with the file count when both pass", async () => {
    const dir = pluginDir({ "a.php": "<?php", "inc/b.php": "<?php" });
    const root = mkdtempSync(join(tmpdir(), "fk-root-"));
    mkdirSync(join(root, "tools/phpstan/vendor/bin"), { recursive: true });
    writeFileSync(join(root, "tools/phpstan/vendor/bin/phpstan"), "");
    vi.spyOn(deps, "run").mockResolvedValue(okRun);
    expect(await phpCheck({ ...config, repoRoot: root }, dir)).toEqual({ ok: true, files: 2, output: "OK: php -l and PHPStan level 5 passed on 2 PHP files" });
  });
});

describe.skipIf(!existsSync("tools/phpstan/vendor/bin/phpstan"))("phpCheck (real toolchain)", () => {
  it("catches a real lint error and a real phpstan error", async () => {
    const cfg = loadConfig(process.cwd());
    const lint = await phpCheck(cfg, pluginDir({ "a.php": "<?php echo 'x'" }));
    expect(lint.ok).toBe(false);
    const stan = await phpCheck(cfg, pluginDir({ "a.php": "<?php\nfunction f(): int { return $undefined; }\n" }));
    expect(stan.ok).toBe(false);
    expect(stan.output).toMatch(/undefined/i);
    const good = await phpCheck(cfg, pluginDir({ "a.php": "<?php\nfunction faktory_ok(): string { return esc_html( get_bloginfo( 'name' ) ); }\n" }));
    expect(good.ok, good.output).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/php.test.ts`
Expected: FAIL — cannot resolve `../../src/php.js`.

- [ ] **Step 4: Implement `src/php.ts`**

```ts
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FaktoryConfig } from "./config.js";
import { run } from "./exec.js";

export const deps = { run };
export const PHPSTAN_LEVEL = 5;
const SKIP_DIRS = new Set(["vendor", "node_modules"]);

export function phpstanDir(config: FaktoryConfig): string { return join(config.repoRoot, "tools", "phpstan"); }
export function phpstanBin(config: FaktoryConfig): string { return join(phpstanDir(config), "vendor", "bin", "phpstan"); }
export function phpstanConfigPath(config: FaktoryConfig): string { return join(phpstanDir(config), "phpstan.neon"); }

/** Every `.php` file under `dir`, depth-first, sorted per directory; `vendor/` and `node_modules/` skipped. */
export function listPhpFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) out.push(...listPhpFiles(p)); }
    else if (name.endsWith(".php")) out.push(p);
  }
  return out;
}

export type PhpCheckResult = { ok: boolean; output: string; files: number };

/** `php -l` on every PHP file, then PHPStan level 5 with the repo's WordPress-aware config. Never throws. */
export async function phpCheck(config: FaktoryConfig, dir: string): Promise<PhpCheckResult> {
  if (!existsSync(dir)) return { ok: false, files: 0, output: `${dir} not found` };
  const files = listPhpFiles(dir);
  if (!files.length) return { ok: false, files: 0, output: `no PHP files under ${dir}` };
  const lint: string[] = [];
  for (const f of files) {
    const r = await deps.run("php", ["-l", f]);
    if (r.code !== 0) lint.push((r.stderr || r.stdout).trim());
  }
  if (lint.length) return { ok: false, files: files.length, output: `php -l:\n${lint.join("\n")}` };
  const bin = phpstanBin(config);
  if (!existsSync(bin)) return { ok: false, files: files.length, output: "PHPStan not installed — run npm run setup-phpstan" };
  const r = await deps.run(bin, ["analyse", "--no-progress", "--error-format=raw", `--level=${PHPSTAN_LEVEL}`, "--memory-limit=512M", "-c", phpstanConfigPath(config), dir], { cwd: phpstanDir(config) });
  if (r.code !== 0) return { ok: false, files: files.length, output: `PHPStan level ${PHPSTAN_LEVEL}:\n${(r.stdout + "\n" + r.stderr).trim()}` };
  return { ok: true, files: files.length, output: `OK: php -l and PHPStan level ${PHPSTAN_LEVEL} passed on ${files.length} PHP files` };
}
```

- [ ] **Step 5: Run the php tests**

Run: `npx vitest run tests/unit/php.test.ts`
Expected: PASS (the real-toolchain block runs only if Step 1 installed PHPStan; it must pass too).

- [ ] **Step 6: Failing tool tests**

Append to `tests/unit/tools-server.test.ts` (imports to add: `TOOL_PHP_CHECK, phpCheckToolHandler` from `../../src/tools/server.js`, `deps as phpDeps` from `../../src/php.js`, and `mkdirSync, writeFileSync` if missing):
```ts
describe("php_check tool", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("is exposed under the faktory namespace and appears in tools/list", async () => {
    expect(TOOL_PHP_CHECK).toBe("mcp__faktory__php_check");
  });
  it("resolves pluginDir inside the site dir and returns the phpCheck output", async () => {
    vi.spyOn(phpDeps, "run").mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const dir = join(ctx.siteDir, "wp-content/plugins/faktory-x");
    mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "x.php"), "<?php");
    const r = await phpCheckToolHandler(ctx)({ pluginDir: "wp-content/plugins/faktory-x" });
    // phpstan is not installed under the test ctx repoRoot → explicit failure
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/PHPStan not installed/);
  });
  it("refuses a pluginDir outside the site dir", async () => {
    const r = await phpCheckToolHandler(ctx)({ pluginDir: "../../etc" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/inside the site directory/);
  });
});
```
In the existing "createFaktoryServer over MCP" round-trip test, extend the expected tool-name list to include `"php_check"` (keep the existing names). Check how `ctx` is built at the top of this test file: if `ctx.siteDir` is a fake path like `/tmp/fk/sites/demo`, build a real temp site for this describe block with `mkdtempSync` and a `ctx` copy `{ ...ctx, siteDir: tmp, config: { ...ctx.config, repoRoot: tmp } }`.

- [ ] **Step 7: Implement the tool**

In `src/tools/server.ts` add `import { phpCheck } from "../php.js";`, `export const TOOL_PHP_CHECK = \`mcp__${FAKTORY_SERVER}__php_check\`;` and:
```ts
export function phpCheckToolHandler(ctx: SiteContext) {
  return async (input: { pluginDir: string }): Promise<{ content: { type: "text"; text: string }[]; isError?: true }> => {
    try {
      const abs = resolveSitePath(ctx, input.pluginDir);
      const r = await phpCheck(ctx.config, abs);
      return r.ok ? ok(r.output) : fail(r.output);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}
```
and in `createFaktoryServer`:
```ts
  const phpCheckTool = tool(
    "php_check",
    "Lint (php -l) and analyse (PHPStan level 5, WordPress-aware) every PHP file of a plugin directory. pluginDir is relative to the site directory, e.g. wp-content/plugins/faktory-produits. Fix every reported error before activating the plugin.",
    { pluginDir: z.string().describe("Plugin directory relative to the site dir") },
    phpCheckToolHandler(ctx),
  );
  return createSdkMcpServer({ name: FAKTORY_SERVER, version: "0.1.0", tools: [wp, gbBuildTool, gbPreviewTool, phpCheckTool] });
```

- [ ] **Step 8: Doctor checks**

In `src/cli.ts` doctor action, after the `rsync` check add (import `phpstanBin` from `./php.js`):
```ts
    checks.push(["php", await ver("php", ["--version"]), "needed by php_check (brew install php)"]);
    checks.push(["composer", await ver("composer", ["--version"]), "needed by npm run setup-phpstan"]);
    checks.push(["phpstan", existsSync(phpstanBin(config)), "run npm run setup-phpstan"]);
```
If `tests/unit/cli.test.ts` asserts the doctor check list, add the three names there.

- [ ] **Step 9: Run all unit tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add tools/phpstan/composer.json tools/phpstan/phpstan.neon .gitignore package.json src/php.ts src/tools/server.ts src/cli.ts tests/unit/php.test.ts tests/unit/tools-server.test.ts tests/unit/cli.test.ts
git commit -m "feat(faktory): php_check tool — host php -l + PHPStan level 5 from tools/phpstan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 2: Reference plugin fixture `fixtures/plugins/faktory-catalogue-produits/` + manifest fixture

**Files:**
- Create: `fixtures/plugins/faktory-catalogue-produits/{faktory-catalogue-produits.php, includes/post-type.php, includes/taxonomies.php, includes/meta.php, includes/admin-columns.php, includes/render.php, blocks/catalogue-produits/block.json, blocks/catalogue-produits/render.php, blocks/catalogue-produits/index.js, blocks/catalogue-produits/index.asset.php, style.css, uninstall.php}`, `fixtures/plugins/catalogue_produits.manifest.json`, `tests/unit/fixture-plugin.test.ts`

**Interfaces:**
- Produces: the reference plugin the prompt (Task 6) points the agent at, and the plugin + manifest the integration test (Task 9) installs. Contract summary (feature `catalogue_produits`, CPT `produit`, taxonomy `categorie_produit`): render root `<div class="faktory-catalogue-produits faktory-catalogue-produits--<view>" data-faktory-plugin="catalogue_produits">`; block `faktory/catalogue-produits` with attributes `view` (`grid`|`featured`), `limit`, `filter`, `taxonomy`, `term`; shortcode `[faktory_catalogue_produits]`; meta keys `_produit_prix`, `_produit_disponibilite`, `_produit_mis_en_avant`; terms seeded at activation.

- [ ] **Step 1: Failing fixture test**

`tests/unit/fixture-plugin.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { phpCheck } from "../../src/php.js";

const DIR = "fixtures/plugins/faktory-catalogue-produits";
const FILES = [
  "faktory-catalogue-produits.php", "includes/post-type.php", "includes/taxonomies.php", "includes/meta.php", "includes/admin-columns.php",
  "includes/render.php", "blocks/catalogue-produits/block.json", "blocks/catalogue-produits/render.php", "blocks/catalogue-produits/index.js",
  "blocks/catalogue-produits/index.asset.php", "style.css", "uninstall.php",
];

describe("reference plugin fixture", () => {
  it("has every file of the contract", () => {
    for (const f of FILES) expect(existsSync(join(DIR, f)), f).toBe(true);
  });
  it("declares the block, the render attribute and the palette-only CSS", () => {
    const block = JSON.parse(readFileSync(join(DIR, "blocks/catalogue-produits/block.json"), "utf8"));
    expect(block.name).toBe("faktory/catalogue-produits");
    expect(block.render).toBe("file:./render.php");
    expect(block.style).toBe("faktory-catalogue-produits");
    expect(readFileSync(join(DIR, "includes/render.php"), "utf8")).toContain('data-faktory-plugin="catalogue_produits"');
    expect(readFileSync(join(DIR, "style.css"), "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    const manifest = JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8"));
    expect(Object.keys(manifest.placements).sort()).toEqual(["accueil", "nos-produits"]);
    for (const p of Object.values(manifest.placements) as string[]) expect(p).toMatch(/^<!-- wp:faktory\/catalogue-produits \{.*\} \/-->$/);
  });
});

describe.skipIf(!existsSync("tools/phpstan/vendor/bin/phpstan"))("reference plugin fixture (php toolchain)", () => {
  it("passes php -l and PHPStan level 5", async () => {
    const r = await phpCheck(loadConfig(process.cwd()), DIR);
    expect(r.ok, r.output).toBe(true);
    expect(r.files).toBe(9);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/fixture-plugin.test.ts`
Expected: FAIL (files missing).

- [ ] **Step 3: Write the plugin**

`fixtures/plugins/faktory-catalogue-produits/faktory-catalogue-produits.php`:
```php
<?php
/**
 * Plugin Name: Faktory — Catalogue produits
 * Description: Catalogue de produits géré depuis l'administration : type de contenu « Produit », catégories, prix, disponibilité, mise en avant, bloc et shortcode d'affichage.
 * Version: 1.0.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * Author: Partikuls
 * Text Domain: faktory-catalogue-produits
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'FAKTORY_CATALOGUE_PRODUITS_VERSION', '1.0.0' );
define( 'FAKTORY_CATALOGUE_PRODUITS_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAKTORY_CATALOGUE_PRODUITS_URL', plugin_dir_url( __FILE__ ) );

require_once FAKTORY_CATALOGUE_PRODUITS_DIR . 'includes/post-type.php';
require_once FAKTORY_CATALOGUE_PRODUITS_DIR . 'includes/taxonomies.php';
require_once FAKTORY_CATALOGUE_PRODUITS_DIR . 'includes/meta.php';
require_once FAKTORY_CATALOGUE_PRODUITS_DIR . 'includes/admin-columns.php';
require_once FAKTORY_CATALOGUE_PRODUITS_DIR . 'includes/render.php';

function faktory_catalogue_produits_register_style(): void {
	wp_register_style( 'faktory-catalogue-produits', FAKTORY_CATALOGUE_PRODUITS_URL . 'style.css', array(), FAKTORY_CATALOGUE_PRODUITS_VERSION );
}
add_action( 'init', 'faktory_catalogue_produits_register_style', 9 );

function faktory_catalogue_produits_register_block(): void {
	register_block_type( FAKTORY_CATALOGUE_PRODUITS_DIR . 'blocks/catalogue-produits' );
}
add_action( 'init', 'faktory_catalogue_produits_register_block' );

/**
 * Shortcode équivalent du bloc : [faktory_catalogue_produits view="grid" limit="12" filter="1"].
 *
 * @param array<string, string>|string $atts
 */
function faktory_catalogue_produits_shortcode( $atts ): string {
	$args = shortcode_atts(
		array(
			'view'     => 'grid',
			'limit'    => '12',
			'filter'   => '1',
			'taxonomy' => '',
			'term'     => '',
		),
		is_array( $atts ) ? $atts : array(),
		'faktory_catalogue_produits'
	);
	return faktory_catalogue_produits_render(
		array(
			'view'     => $args['view'],
			'limit'    => (int) $args['limit'],
			'filter'   => in_array( $args['filter'], array( '1', 'true', 'yes' ), true ),
			'taxonomy' => $args['taxonomy'],
			'term'     => $args['term'],
		)
	);
}
add_shortcode( 'faktory_catalogue_produits', 'faktory_catalogue_produits_shortcode' );

function faktory_catalogue_produits_activate(): void {
	faktory_catalogue_produits_register_post_type();
	faktory_catalogue_produits_register_taxonomies();
	faktory_catalogue_produits_seed_terms();
	flush_rewrite_rules();
}
register_activation_hook( __FILE__, 'faktory_catalogue_produits_activate' );
register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );
```

`includes/post-type.php`:
```php
<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FAKTORY_CATALOGUE_PRODUITS_POST_TYPE = 'produit';

function faktory_catalogue_produits_register_post_type(): void {
	register_post_type(
		FAKTORY_CATALOGUE_PRODUITS_POST_TYPE,
		array(
			'labels'        => array(
				'name'               => 'Produits',
				'singular_name'      => 'Produit',
				'menu_name'          => 'Produits',
				'all_items'          => 'Tous les produits',
				'add_new'            => 'Ajouter',
				'add_new_item'       => 'Ajouter un produit',
				'edit_item'          => 'Modifier le produit',
				'new_item'           => 'Nouveau produit',
				'view_item'          => 'Voir le produit',
				'search_items'       => 'Rechercher un produit',
				'not_found'          => 'Aucun produit',
				'not_found_in_trash' => 'Aucun produit dans la corbeille',
			),
			'public'        => true,
			'show_in_rest'  => true,
			'has_archive'   => false,
			'menu_position' => 20,
			'menu_icon'     => 'dashicons-carrot',
			'supports'      => array( 'title', 'editor', 'thumbnail' ),
			'rewrite'       => array( 'slug' => 'produit' ),
		)
	);
}
add_action( 'init', 'faktory_catalogue_produits_register_post_type' );
```

`includes/taxonomies.php`:
```php
<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * @return array<string, array{singular: string, plural: string, terms: list<string>}>
 */
function faktory_catalogue_produits_taxonomies(): array {
	return array(
		'categorie_produit' => array(
			'singular' => 'Catégorie',
			'plural'   => 'Catégories',
			'terms'    => array( 'Pains', 'Viennoiseries', 'Pâtisseries', 'Salé du midi' ),
		),
	);
}

function faktory_catalogue_produits_register_taxonomies(): void {
	foreach ( faktory_catalogue_produits_taxonomies() as $slug => $tax ) {
		register_taxonomy(
			$slug,
			FAKTORY_CATALOGUE_PRODUITS_POST_TYPE,
			array(
				'labels'            => array(
					'name'          => $tax['plural'],
					'singular_name' => $tax['singular'],
					'menu_name'     => $tax['plural'],
				),
				'hierarchical'      => true,
				'show_in_rest'      => true,
				'show_admin_column' => true,
				'rewrite'           => array( 'slug' => str_replace( '_', '-', $slug ) ),
			)
		);
	}
}
add_action( 'init', 'faktory_catalogue_produits_register_taxonomies', 11 );

/** Crée les termes prévus par la spec s'ils manquent (appelé à l'activation). */
function faktory_catalogue_produits_seed_terms(): void {
	foreach ( faktory_catalogue_produits_taxonomies() as $slug => $tax ) {
		foreach ( $tax['terms'] as $name ) {
			if ( null === term_exists( $name, $slug ) ) {
				wp_insert_term( $name, $slug );
			}
		}
	}
}
```

`includes/meta.php`:
```php
<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Champs de la spec (hors « photo » = image à la une).
 *
 * @return array<string, array{label: string, type: string, options?: list<string>}>
 */
function faktory_catalogue_produits_fields(): array {
	return array(
		'prix'          => array(
			'label' => 'Prix',
			'type'  => 'price',
		),
		'disponibilite' => array(
			'label'   => 'Disponibilité',
			'type'    => 'select',
			'options' => array( 'Tous les jours', 'Week-end', 'Sur commande' ),
		),
		'mis_en_avant'  => array(
			'label' => "Mis en avant sur l'accueil",
			'type'  => 'boolean',
		),
	);
}

function faktory_catalogue_produits_meta_key( string $field ): string {
	return '_' . FAKTORY_CATALOGUE_PRODUITS_POST_TYPE . '_' . $field;
}

/**
 * @param mixed $value
 */
function faktory_catalogue_produits_sanitize( string $key, $value ): string {
	$fields = faktory_catalogue_produits_fields();
	if ( ! isset( $fields[ $key ] ) ) {
		return '';
	}
	$field = $fields[ $key ];
	$raw   = is_scalar( $value ) ? trim( (string) $value ) : '';
	switch ( $field['type'] ) {
		case 'price':
		case 'number':
			return '' === $raw ? '' : number_format( (float) str_replace( ',', '.', $raw ), 2, '.', '' );
		case 'select':
			return in_array( $raw, $field['options'] ?? array(), true ) ? $raw : '';
		case 'boolean':
			return in_array( $raw, array( '1', 'on', 'true' ), true ) ? '1' : '';
		case 'date':
			return 1 === preg_match( '/^\d{4}-\d{2}-\d{2}$/', $raw ) ? $raw : '';
		case 'url':
			return esc_url_raw( $raw );
		case 'textarea':
			return sanitize_textarea_field( $raw );
		default:
			return sanitize_text_field( $raw );
	}
}

function faktory_catalogue_produits_register_meta(): void {
	foreach ( faktory_catalogue_produits_fields() as $key => $field ) {
		register_post_meta(
			FAKTORY_CATALOGUE_PRODUITS_POST_TYPE,
			faktory_catalogue_produits_meta_key( $key ),
			array(
				'type'              => 'string',
				'single'            => true,
				'default'           => '',
				'show_in_rest'      => true,
				'sanitize_callback' => static fn( $value ): string => faktory_catalogue_produits_sanitize( $key, $value ),
				'auth_callback'     => static fn(): bool => current_user_can( 'edit_posts' ),
			)
		);
	}
}
add_action( 'init', 'faktory_catalogue_produits_register_meta' );

function faktory_catalogue_produits_add_meta_box(): void {
	add_meta_box(
		'faktory_catalogue_produits_fields',
		'Informations produit',
		'faktory_catalogue_produits_render_meta_box',
		FAKTORY_CATALOGUE_PRODUITS_POST_TYPE,
		'normal',
		'high'
	);
}
add_action( 'add_meta_boxes', 'faktory_catalogue_produits_add_meta_box' );

function faktory_catalogue_produits_render_meta_box( WP_Post $post ): void {
	wp_nonce_field( 'faktory_catalogue_produits_save', 'faktory_catalogue_produits_nonce' );
	echo '<table class="form-table"><tbody>';
	foreach ( faktory_catalogue_produits_fields() as $key => $field ) {
		$value = (string) get_post_meta( $post->ID, faktory_catalogue_produits_meta_key( $key ), true );
		$id    = esc_attr( 'faktory_' . $key );
		$name  = esc_attr( 'faktory_catalogue_produits[' . $key . ']' );
		echo '<tr><th scope="row"><label for="' . $id . '">' . esc_html( $field['label'] ) . '</label></th><td>';
		switch ( $field['type'] ) {
			case 'textarea':
				echo '<textarea id="' . $id . '" name="' . $name . '" rows="4" class="large-text">' . esc_textarea( $value ) . '</textarea>';
				break;
			case 'select':
				echo '<select id="' . $id . '" name="' . $name . '"><option value="">—</option>';
				foreach ( $field['options'] ?? array() as $option ) {
					echo '<option value="' . esc_attr( $option ) . '"' . selected( $value, $option, false ) . '>' . esc_html( $option ) . '</option>';
				}
				echo '</select>';
				break;
			case 'boolean':
				echo '<label><input type="checkbox" id="' . $id . '" name="' . $name . '" value="1"' . checked( $value, '1', false ) . '> Oui</label>';
				break;
			case 'price':
			case 'number':
				echo '<input type="number" step="0.01" min="0" id="' . $id . '" name="' . $name . '" value="' . esc_attr( $value ) . '" class="small-text">' . ( 'price' === $field['type'] ? ' €' : '' );
				break;
			case 'date':
				echo '<input type="date" id="' . $id . '" name="' . $name . '" value="' . esc_attr( $value ) . '">';
				break;
			default:
				echo '<input type="text" id="' . $id . '" name="' . $name . '" value="' . esc_attr( $value ) . '" class="regular-text">';
		}
		echo '</td></tr>';
	}
	echo '</tbody></table>';
}

function faktory_catalogue_produits_save_meta( int $post_id ): void {
	$nonce = isset( $_POST['faktory_catalogue_produits_nonce'] ) ? stripslashes( (string) $_POST['faktory_catalogue_produits_nonce'] ) : '';
	if ( '' === $nonce || false === wp_verify_nonce( sanitize_key( $nonce ), 'faktory_catalogue_produits_save' ) ) {
		return;
	}
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
		return;
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}
	$input = isset( $_POST['faktory_catalogue_produits'] ) && is_array( $_POST['faktory_catalogue_produits'] ) ? $_POST['faktory_catalogue_produits'] : array();
	foreach ( faktory_catalogue_produits_fields() as $key => $field ) {
		$raw = $input[ $key ] ?? '';
		if ( is_string( $raw ) ) {
			$raw = stripslashes( $raw );
		}
		update_post_meta( $post_id, faktory_catalogue_produits_meta_key( $key ), faktory_catalogue_produits_sanitize( $key, $raw ) );
	}
}
add_action( 'save_post_' . FAKTORY_CATALOGUE_PRODUITS_POST_TYPE, 'faktory_catalogue_produits_save_meta' );
```

`includes/admin-columns.php`:
```php
<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * @param array<string, string> $columns
 * @return array<string, string>
 */
function faktory_catalogue_produits_columns( array $columns ): array {
	$out = array();
	foreach ( $columns as $key => $label ) {
		if ( 'title' === $key ) {
			$out['faktory_thumb'] = 'Photo';
		}
		$out[ $key ] = $label;
		if ( 'title' === $key ) {
			$out['faktory_prix']          = 'Prix';
			$out['faktory_disponibilite'] = 'Disponibilité';
			$out['faktory_mis_en_avant']  = 'Mis en avant';
		}
	}
	return $out;
}
add_filter( 'manage_' . FAKTORY_CATALOGUE_PRODUITS_POST_TYPE . '_posts_columns', 'faktory_catalogue_produits_columns' );

function faktory_catalogue_produits_column_content( string $column, int $post_id ): void {
	switch ( $column ) {
		case 'faktory_thumb':
			echo has_post_thumbnail( $post_id ) ? get_the_post_thumbnail( $post_id, array( 48, 48 ) ) : '—';
			break;
		case 'faktory_prix':
			$prix = (string) get_post_meta( $post_id, faktory_catalogue_produits_meta_key( 'prix' ), true );
			echo '' === $prix ? '—' : esc_html( number_format( (float) $prix, 2, ',', ' ' ) . ' €' );
			break;
		case 'faktory_disponibilite':
			echo esc_html( (string) get_post_meta( $post_id, faktory_catalogue_produits_meta_key( 'disponibilite' ), true ) );
			break;
		case 'faktory_mis_en_avant':
			echo '1' === (string) get_post_meta( $post_id, faktory_catalogue_produits_meta_key( 'mis_en_avant' ), true ) ? '★' : '—';
			break;
	}
}
add_action( 'manage_' . FAKTORY_CATALOGUE_PRODUITS_POST_TYPE . '_posts_custom_column', 'faktory_catalogue_produits_column_content', 10, 2 );

/**
 * @param array<string, string> $columns
 * @return array<string, string>
 */
function faktory_catalogue_produits_sortable_columns( array $columns ): array {
	$columns['faktory_prix'] = 'faktory_prix';
	return $columns;
}
add_filter( 'manage_edit-' . FAKTORY_CATALOGUE_PRODUITS_POST_TYPE . '_sortable_columns', 'faktory_catalogue_produits_sortable_columns' );

function faktory_catalogue_produits_orderby( WP_Query $query ): void {
	if ( ! is_admin() || ! $query->is_main_query() || 'faktory_prix' !== $query->get( 'orderby' ) ) {
		return;
	}
	$query->set( 'meta_key', faktory_catalogue_produits_meta_key( 'prix' ) );
	$query->set( 'orderby', 'meta_value_num' );
}
add_action( 'pre_get_posts', 'faktory_catalogue_produits_orderby' );
```

`includes/render.php`:
```php
<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * La seule fonction de rendu : utilisée par le bloc et par le shortcode.
 *
 * @param array<string, mixed> $args view (grid|featured), limit, filter, taxonomy, term.
 */
function faktory_catalogue_produits_render( array $args ): string {
	$view       = isset( $args['view'] ) && 'featured' === $args['view'] ? 'featured' : 'grid';
	$limit      = isset( $args['limit'] ) ? (int) $args['limit'] : ( 'featured' === $view ? 4 : 12 );
	$limit      = $limit > 0 ? $limit : -1;
	$filter     = ! empty( $args['filter'] );
	$taxonomy   = isset( $args['taxonomy'] ) && is_string( $args['taxonomy'] ) ? sanitize_key( $args['taxonomy'] ) : '';
	$term       = isset( $args['term'] ) && is_string( $args['term'] ) ? sanitize_title( $args['term'] ) : '';
	$taxonomies = array_keys( faktory_catalogue_produits_taxonomies() );
	$filter_tax = $taxonomies[0] ?? '';
	$active     = '';
	if ( $filter && '' !== $filter_tax && isset( $_GET[ $filter_tax ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- lecture seule, filtre public.
		$active = sanitize_title( (string) $_GET[ $filter_tax ] );
	}
	if ( '' === $term && '' !== $active ) {
		$taxonomy = $filter_tax;
		$term     = $active;
	}

	wp_enqueue_style( 'faktory-catalogue-produits' );

	$query_args = array(
		'post_type'      => FAKTORY_CATALOGUE_PRODUITS_POST_TYPE,
		'post_status'    => 'publish',
		'posts_per_page' => $limit,
		'orderby'        => 'date',
		'order'          => 'DESC',
		'no_found_rows'  => true,
	);
	if ( '' !== $taxonomy && '' !== $term ) {
		$query_args['tax_query'] = array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
			array(
				'taxonomy' => $taxonomy,
				'field'    => 'slug',
				'terms'    => $term,
			),
		);
	}
	if ( 'featured' === $view ) {
		$query_args['meta_query'] = array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
			array(
				'key'   => faktory_catalogue_produits_meta_key( 'mis_en_avant' ),
				'value' => '1',
			),
		);
	}
	$posts = get_posts( $query_args );
	if ( 'featured' === $view && $limit > 0 && count( $posts ) < $limit ) {
		// Moins d'entrées « mises en avant » que demandé : on complète avec les plus récentes.
		$more  = get_posts(
			array(
				'post_type'      => FAKTORY_CATALOGUE_PRODUITS_POST_TYPE,
				'post_status'    => 'publish',
				'posts_per_page' => $limit - count( $posts ),
				'post__not_in'   => wp_list_pluck( $posts, 'ID' ),
				'orderby'        => 'date',
				'order'          => 'DESC',
				'no_found_rows'  => true,
			)
		);
		$posts = array_merge( $posts, $more );
	}

	$html = '<div class="' . esc_attr( 'faktory-catalogue-produits faktory-catalogue-produits--' . $view ) . '" data-faktory-plugin="catalogue_produits">';
	if ( $filter && '' !== $filter_tax ) {
		$html .= faktory_catalogue_produits_render_filter( $filter_tax, $active );
	}
	if ( empty( $posts ) ) {
		$html .= '<p class="faktory-catalogue-produits__empty">Aucun produit pour le moment.</p>';
	} else {
		$html .= '<ul class="faktory-catalogue-produits__grid">';
		foreach ( $posts as $post ) {
			if ( $post instanceof WP_Post ) {
				$html .= faktory_catalogue_produits_render_card( $post );
			}
		}
		$html .= '</ul>';
	}
	return $html . '</div>';
}

function faktory_catalogue_produits_render_filter( string $taxonomy, string $active ): string {
	$terms = get_terms(
		array(
			'taxonomy'   => $taxonomy,
			'hide_empty' => false,
		)
	);
	if ( ! is_array( $terms ) || empty( $terms ) ) {
		return '';
	}
	$base = remove_query_arg( $taxonomy );
	$html = '<nav class="faktory-catalogue-produits__filter" aria-label="Filtrer par catégorie"><ul>';
	$html .= '<li><a href="' . esc_url( $base ) . '"' . ( '' === $active ? ' aria-current="true"' : '' ) . '>Tout</a></li>';
	foreach ( $terms as $t ) {
		if ( ! $t instanceof WP_Term ) {
			continue;
		}
		$url   = add_query_arg( $taxonomy, $t->slug, $base );
		$html .= '<li><a href="' . esc_url( $url ) . '"' . ( $active === $t->slug ? ' aria-current="true"' : '' ) . '>' . esc_html( $t->name ) . '</a></li>';
	}
	return $html . '</ul></nav>';
}

function faktory_catalogue_produits_render_card( WP_Post $post ): string {
	$prix    = (string) get_post_meta( $post->ID, faktory_catalogue_produits_meta_key( 'prix' ), true );
	$dispo   = (string) get_post_meta( $post->ID, faktory_catalogue_produits_meta_key( 'disponibilite' ), true );
	$excerpt = has_excerpt( $post ) ? get_the_excerpt( $post ) : wp_trim_words( wp_strip_all_tags( $post->post_content ), 20 );
	$title   = get_the_title( $post );
	$html    = '<li class="faktory-catalogue-produits__card"><article>';
	if ( has_post_thumbnail( $post ) ) {
		$html .= '<div class="faktory-catalogue-produits__media">' . get_the_post_thumbnail(
			$post,
			'medium_large',
			array(
				'alt'     => $title,
				'loading' => 'lazy',
			)
		) . '</div>';
	}
	$html .= '<div class="faktory-catalogue-produits__body"><h3 class="faktory-catalogue-produits__title">' . esc_html( $title ) . '</h3>';
	if ( '' !== $excerpt ) {
		$html .= '<p class="faktory-catalogue-produits__text">' . esc_html( $excerpt ) . '</p>';
	}
	$html .= '<p class="faktory-catalogue-produits__meta">';
	if ( '' !== $prix ) {
		$html .= '<span class="faktory-catalogue-produits__price">' . esc_html( number_format( (float) $prix, 2, ',', ' ' ) ) . ' €</span>';
	}
	if ( '' !== $dispo ) {
		$html .= '<span class="faktory-catalogue-produits__badge">' . esc_html( $dispo ) . '</span>';
	}
	return $html . '</p></div></article></li>';
}
```

`blocks/catalogue-produits/block.json`:
```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "faktory/catalogue-produits",
  "title": "Catalogue produits",
  "category": "widgets",
  "icon": "carrot",
  "description": "Grille des produits du catalogue : vue grille filtrable par catégorie ou sélection mise en avant.",
  "textdomain": "faktory-catalogue-produits",
  "attributes": {
    "view": { "type": "string", "default": "grid", "enum": ["grid", "featured"] },
    "limit": { "type": "number", "default": 12 },
    "filter": { "type": "boolean", "default": true },
    "taxonomy": { "type": "string", "default": "" },
    "term": { "type": "string", "default": "" }
  },
  "supports": { "html": false, "align": ["wide", "full"] },
  "editorScript": "file:./index.js",
  "style": "faktory-catalogue-produits",
  "render": "file:./render.php"
}
```

`blocks/catalogue-produits/render.php`:
```php
<?php
/**
 * Rendu du bloc : délègue à la fonction de rendu partagée avec le shortcode.
 * $attributes est fourni par WordPress (register_block_type + "render").
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
echo faktory_catalogue_produits_render( isset( $attributes ) && is_array( $attributes ) ? $attributes : array() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- échappé dans la fonction de rendu.
```

`blocks/catalogue-produits/index.asset.php`:
```php
<?php
return array(
	'dependencies' => array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-server-side-render', 'wp-i18n' ),
	'version'      => '1.0.0',
);
```

`blocks/catalogue-produits/index.js` (no build step: globals only):
```js
( function ( wp ) {
	var el = wp.element.createElement;
	var InspectorControls = wp.blockEditor.InspectorControls;
	var PanelBody = wp.components.PanelBody;
	var SelectControl = wp.components.SelectControl;
	var RangeControl = wp.components.RangeControl;
	var ToggleControl = wp.components.ToggleControl;

	wp.blocks.registerBlockType( 'faktory/catalogue-produits', {
		edit: function ( props ) {
			var a = props.attributes;
			return el(
				wp.element.Fragment,
				null,
				el(
					InspectorControls,
					null,
					el(
						PanelBody,
						{ title: 'Affichage' },
						el( SelectControl, {
							label: 'Vue',
							value: a.view,
							options: [ { label: 'Grille', value: 'grid' }, { label: 'Mis en avant', value: 'featured' } ],
							onChange: function ( v ) { props.setAttributes( { view: v } ); }
						} ),
						el( RangeControl, {
							label: 'Nombre maximum',
							value: a.limit,
							min: 1,
							max: 48,
							onChange: function ( v ) { props.setAttributes( { limit: v } ); }
						} ),
						el( ToggleControl, {
							label: 'Filtres par catégorie',
							checked: !! a.filter,
							onChange: function ( v ) { props.setAttributes( { filter: v } ); }
						} )
					)
				),
				el( wp.serverSideRender, { block: 'faktory/catalogue-produits', attributes: a } )
			);
		},
		save: function () { return null; }
	} );
} )( window.wp );
```

`style.css`:
```css
/* Faktory — Catalogue produits. Palette GeneratePress uniquement (var(--base…), var(--contrast…), var(--accent…)). */
.faktory-catalogue-produits { width: 100%; }
.faktory-catalogue-produits__filter ul { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 24px; padding: 0; }
.faktory-catalogue-produits__filter a { display: inline-block; padding: 6px 14px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--contrast) 20%, transparent); color: var(--contrast); text-decoration: none; }
.faktory-catalogue-produits__filter a[aria-current="true"],
.faktory-catalogue-produits__filter a:hover,
.faktory-catalogue-produits__filter a:focus-visible { background: var(--accent); border-color: var(--accent); color: var(--base-3); }
.faktory-catalogue-produits__grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 24px; }
.faktory-catalogue-produits__card article { height: 100%; display: flex; flex-direction: column; background: var(--base-3); border-radius: 12px; overflow: hidden; }
.faktory-catalogue-produits__media img { display: block; width: 100%; height: 200px; object-fit: cover; }
.faktory-catalogue-produits__body { padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 8px; }
.faktory-catalogue-produits__title { margin: 0; font-size: 1.125rem; color: var(--contrast); }
.faktory-catalogue-produits__text { margin: 0; color: var(--contrast-2); }
.faktory-catalogue-produits__meta { margin: auto 0 0; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.faktory-catalogue-produits__price { font-weight: 700; color: var(--contrast); }
.faktory-catalogue-produits__badge { font-size: 0.8125rem; padding: 2px 10px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
.faktory-catalogue-produits__empty { color: var(--contrast-2); }
@media (max-width: 767px) {
  .faktory-catalogue-produits__grid { grid-template-columns: 1fr; }
}
```

`uninstall.php`:
```php
<?php
/**
 * Désinstallation : supprime les produits, les termes et leurs meta.
 */
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$faktory_catalogue_produits_post_ids = get_posts(
	array(
		'post_type'      => 'produit',
		'post_status'    => 'any',
		'posts_per_page' => -1,
		'fields'         => 'ids',
	)
);
foreach ( $faktory_catalogue_produits_post_ids as $faktory_catalogue_produits_post_id ) {
	if ( is_int( $faktory_catalogue_produits_post_id ) ) {
		wp_delete_post( $faktory_catalogue_produits_post_id, true );
	}
}

// Le plugin n'est pas chargé pendant la désinstallation : on ré-enregistre la taxonomie pour pouvoir lister ses termes.
register_taxonomy( 'categorie_produit', 'produit' );
$faktory_catalogue_produits_term_ids = get_terms(
	array(
		'taxonomy'   => 'categorie_produit',
		'hide_empty' => false,
		'fields'     => 'ids',
	)
);
if ( is_array( $faktory_catalogue_produits_term_ids ) ) {
	foreach ( $faktory_catalogue_produits_term_ids as $faktory_catalogue_produits_term_id ) {
		if ( is_int( $faktory_catalogue_produits_term_id ) ) {
			wp_delete_term( $faktory_catalogue_produits_term_id, 'categorie_produit' );
		}
	}
}
```

`fixtures/plugins/catalogue_produits.manifest.json`:
```json
{
  "feature": "catalogue_produits",
  "plugin": "faktory-catalogue-produits",
  "postType": "produit",
  "block": "faktory/catalogue-produits",
  "shortcode": "faktory_catalogue_produits",
  "placements": {
    "accueil": "<!-- wp:faktory/catalogue-produits {\"view\":\"featured\",\"limit\":4,\"filter\":false} /-->",
    "nos-produits": "<!-- wp:faktory/catalogue-produits {\"view\":\"grid\",\"filter\":true} /-->"
  }
}
```

- [ ] **Step 4: Run the fixture test, fix PHPStan findings**

Run: `npx vitest run tests/unit/fixture-plugin.test.ts`
Expected: PASS. If PHPStan reports errors in the fixture (stub type mismatches are the likely kind), fix the PHP — never loosen `phpstan.neon` below level 5 and never add `ignoreErrors`. Typical fixes: guard `WP_Post|int` unions with `instanceof`, cast `mixed` meta values with `(string)`, replace `$_GET`/`$_POST` string ops with the `isset` + `(string)` pattern used above.

- [ ] **Step 5: Commit**

```bash
git add fixtures/plugins tests/unit/fixture-plugin.test.ts
git commit -m "feat(faktory): reference plugin fixture (catalogue_produits) passing PHPStan level 5

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 3: `plugin-manifest` schema, naming helpers, cross-checks

**Files:**
- Create: `src/schemas/plugin-manifest.ts`, `tests/unit/plugin-manifest.test.ts`
- Modify: `src/schemas/page-tree.ts` (export `hexIssues` and `DENYLIST_RE`), `src/workspace.ts` (`initSite` also creates `plugins/`), `tests/unit/workspace.test.ts` (if it lists the created sub-dirs, add `plugins`)

**Interfaces:**
- Produces (all in `src/schemas/plugin-manifest.ts`):
  - `kebab(id: string): string`, `pluginSlug(id): string` (`faktory-<kebab>`), `blockName(id): string` (`faktory/<kebab>`), `shortcodeName(id): string` (`faktory_<id>`), `RENDER_ATTR = "data-faktory-plugin"`.
  - `PLUGINS_DIR = "plugins"`, `manifestRel(id): string` (`plugins/<id>.json`), `manifestPath(ctx, id): string`, `pluginDirRel(id): string` (`wp-content/plugins/faktory-<kebab>`), `pluginDirPath(ctx, id): string`.
  - `requiredPluginFiles(id): string[]` (relative to the plugin dir).
  - `PluginManifestSchema`, `type PluginManifest = { feature: string; plugin: string; postType: string; block: string; shortcode: string; placements: Record<string, string> }`, `parsePluginManifest(data: unknown): PluginManifest`.
  - `placementPages(spec: SiteSpec, featureId: string): string[]`, `validatePluginManifest(m, spec, feature): string[]`, `assertPluginManifest(m, spec, feature): void`.
- Consumes: `hexIssues(value, at, issues)` and `DENYLIST_RE` from `page-tree.ts` (made exported here), `Feature`/`SiteSpec` types from `site-spec.ts` (add `export type Feature = z.infer<typeof Feature>;` next to `export type Page`).

- [ ] **Step 1: Failing tests**

`tests/unit/plugin-manifest.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import {
  kebab, pluginSlug, blockName, shortcodeName, RENDER_ATTR, PLUGINS_DIR, manifestRel, manifestPath, pluginDirRel, pluginDirPath,
  requiredPluginFiles, parsePluginManifest, placementPages, validatePluginManifest, assertPluginManifest,
} from "../../src/schemas/plugin-manifest.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const feature = spec.features[0];
const manifest = JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8"));
const ctx = { siteDir: "/tmp/fk/sites/demo" } as SiteContext;

describe("naming and paths", () => {
  it("derives everything from the feature id", () => {
    expect(kebab("catalogue_produits")).toBe("catalogue-produits");
    expect(pluginSlug("catalogue_produits")).toBe("faktory-catalogue-produits");
    expect(blockName("produits")).toBe("faktory/produits");
    expect(shortcodeName("catalogue_produits")).toBe("faktory_catalogue_produits");
    expect(RENDER_ATTR).toBe("data-faktory-plugin");
    expect(PLUGINS_DIR).toBe("plugins");
    expect(manifestRel("produits")).toBe("plugins/produits.json");
    expect(manifestPath(ctx, "produits")).toBe("/tmp/fk/sites/demo/plugins/produits.json");
    expect(pluginDirRel("catalogue_produits")).toBe("wp-content/plugins/faktory-catalogue-produits");
    expect(pluginDirPath(ctx, "catalogue_produits")).toBe("/tmp/fk/sites/demo/wp-content/plugins/faktory-catalogue-produits");
  });
  it("lists the contract files", () => {
    expect(requiredPluginFiles("catalogue_produits")).toEqual([
      "faktory-catalogue-produits.php", "includes/post-type.php", "includes/taxonomies.php", "includes/meta.php", "includes/admin-columns.php",
      "includes/render.php", "blocks/catalogue-produits/block.json", "blocks/catalogue-produits/render.php", "blocks/catalogue-produits/index.js",
      "blocks/catalogue-produits/index.asset.php", "style.css", "uninstall.php",
    ]);
  });
});

describe("parsePluginManifest", () => {
  it("accepts the fixture manifest", () => {
    expect(parsePluginManifest(manifest).placements["accueil"]).toContain("wp:faktory/catalogue-produits");
  });
  it("rejects unknown keys, empty placements and a non-snake_case feature", () => {
    expect(() => parsePluginManifest({ ...manifest, extra: 1 })).toThrow(/Invalid plugin manifest/);
    expect(() => parsePluginManifest({ ...manifest, placements: { accueil: "" } })).toThrow(/placements.accueil/);
    expect(() => parsePluginManifest({ ...manifest, feature: "Catalogue-Produits" })).toThrow(/feature/);
  });
});

describe("placementPages / validatePluginManifest", () => {
  it("lists the pages whose custom-query sections reference the feature", () => {
    expect(placementPages(spec, "catalogue_produits")).toEqual(["accueil", "nos-produits"]);
    expect(placementPages(spec, "nope")).toEqual([]);
  });
  it("accepts the fixture manifest for the fixture feature", () => {
    expect(validatePluginManifest(parsePluginManifest(manifest), spec, feature)).toEqual([]);
    expect(() => assertPluginManifest(parsePluginManifest(manifest), spec, feature)).not.toThrow();
  });
  it("cross-checks every derived value against the spec", () => {
    const m = parsePluginManifest({ ...manifest, feature: "produits", plugin: "produits", postType: "product", block: "faktory/x", shortcode: "x" });
    const issues = validatePluginManifest(m, spec, feature);
    expect(issues).toContainEqual(expect.stringMatching(/feature must be "catalogue_produits"/));
    expect(issues).toContainEqual(expect.stringMatching(/plugin must be "faktory-catalogue-produits"/));
    expect(issues).toContainEqual(expect.stringMatching(/postType must be "produit"/));
    expect(issues).toContainEqual(expect.stringMatching(/block must be "faktory\/catalogue-produits"/));
    expect(issues).toContainEqual(expect.stringMatching(/shortcode must be "faktory_catalogue_produits"/));
  });
  it("requires one placement per page that shows the feature and none elsewhere", () => {
    const m = parsePluginManifest({ ...manifest, placements: { accueil: manifest.placements.accueil, contact: manifest.placements.accueil } });
    const issues = validatePluginManifest(m, spec, feature);
    expect(issues).toContainEqual(expect.stringMatching(/missing placement for page "nos-produits"/));
    expect(issues).toContainEqual(expect.stringMatching(/unexpected placement for page "contact"/));
  });
  it("requires block-comment placements for this block and refuses forbidden markup", () => {
    const m = parsePluginManifest({ ...manifest, placements: { accueil: "[faktory_catalogue_produits]", "nos-produits": "<!-- wp:faktory/catalogue-produits /--><script>x</script>" } });
    const issues = validatePluginManifest(m, spec, feature);
    expect(issues).toContainEqual(expect.stringMatching(/placements.accueil: must be a self-closing block comment <!-- wp:faktory\/catalogue-produits/));
    expect(issues).toContainEqual(expect.stringMatching(/placements.nos-produits: forbidden markup \(<script\)/));
    expect(() => assertPluginManifest(m, spec, feature)).toThrow(/plugins\/catalogue_produits.json is invalid:\n- /);
  });
  it("accepts a placement without attributes", () => {
    const m = parsePluginManifest({ ...manifest, placements: { accueil: "<!-- wp:faktory/catalogue-produits /-->", "nos-produits": manifest.placements["nos-produits"] } });
    expect(validatePluginManifest(m, spec, feature)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/plugin-manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

In `src/schemas/page-tree.ts` change `function hexIssues(` to `export function hexIssues(` and `const DENYLIST_RE` to `export const DENYLIST_RE`. In `src/schemas/site-spec.ts` add `export type Feature = z.infer<typeof Feature>;` after the `Feature` schema. In `src/workspace.ts` `initSite`, change the sub-dir list to `["", "wp-content", "pages", "plugins", "content", "qa", "dist"]`.

`src/schemas/plugin-manifest.ts`:
```ts
import { z } from "zod";
import { join } from "node:path";
import type { SiteContext } from "../docker.js";
import type { Feature, SiteSpec } from "./site-spec.js";
import { DENYLIST_RE } from "./page-tree.js";

export const RENDER_ATTR = "data-faktory-plugin";
export const PLUGINS_DIR = "plugins";

export const kebab = (id: string): string => id.replace(/_/g, "-");
export const pluginSlug = (id: string): string => `faktory-${kebab(id)}`;
export const blockName = (id: string): string => `faktory/${kebab(id)}`;
export const shortcodeName = (id: string): string => `faktory_${id}`;

export const manifestRel = (id: string): string => `${PLUGINS_DIR}/${id}.json`;
export const manifestPath = (ctx: SiteContext, id: string): string => join(ctx.siteDir, manifestRel(id));
export const pluginDirRel = (id: string): string => `wp-content/plugins/${pluginSlug(id)}`;
export const pluginDirPath = (ctx: SiteContext, id: string): string => join(ctx.siteDir, pluginDirRel(id));

/** Files the plugin contract requires, relative to the plugin dir (spec « Contrat de plugin »). */
export function requiredPluginFiles(id: string): string[] {
  const k = kebab(id);
  return [
    `${pluginSlug(id)}.php`, "includes/post-type.php", "includes/taxonomies.php", "includes/meta.php", "includes/admin-columns.php",
    "includes/render.php", `blocks/${k}/block.json`, `blocks/${k}/render.php`, `blocks/${k}/index.js`, `blocks/${k}/index.asset.php`,
    "style.css", "uninstall.php",
  ];
}

const key = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key");

export const PluginManifestSchema = z.strictObject({
  feature: key,
  plugin: z.string().min(1),
  postType: z.string().min(1),
  block: z.string().min(1),
  shortcode: z.string().min(1),
  placements: z.record(z.string(), z.string().min(1)),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export function parsePluginManifest(data: unknown): PluginManifest {
  const r = PluginManifestSchema.safeParse(data);
  if (!r.success) throw new Error(`Invalid plugin manifest: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

/** Slugs of the pages that carry a `custom-query` section for `featureId`, in sitemap order. */
export function placementPages(spec: SiteSpec, featureId: string): string[] {
  return spec.sitemap.filter((p) => p.sections.some((s) => s.type === "custom-query" && s.feature === featureId)).map((p) => p.slug);
}

function placementRe(id: string): RegExp {
  const name = blockName(id).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`^<!-- wp:${name}( \\{.*\\})? /-->$`);
}

/** Cross-checks the manifest against the spec's feature and sitemap. Returns human-readable issues (empty = valid). */
export function validatePluginManifest(m: PluginManifest, spec: SiteSpec, feature: Feature): string[] {
  const issues: string[] = [];
  const id = feature.id;
  if (m.feature !== id) issues.push(`feature must be "${id}" (got "${m.feature}")`);
  if (m.plugin !== pluginSlug(id)) issues.push(`plugin must be "${pluginSlug(id)}" (got "${m.plugin}")`);
  if (m.postType !== feature.cpt.slug) issues.push(`postType must be "${feature.cpt.slug}" (got "${m.postType}")`);
  if (m.block !== blockName(id)) issues.push(`block must be "${blockName(id)}" (got "${m.block}")`);
  if (m.shortcode !== shortcodeName(id)) issues.push(`shortcode must be "${shortcodeName(id)}" (got "${m.shortcode}")`);
  const expected = placementPages(spec, id);
  for (const slug of expected) if (!(slug in m.placements)) issues.push(`missing placement for page "${slug}" (its custom-query section shows ${id})`);
  const re = placementRe(id);
  for (const [slug, markup] of Object.entries(m.placements)) {
    if (!expected.includes(slug)) { issues.push(`unexpected placement for page "${slug}" (no custom-query section for ${id} there)`); continue; }
    const forbidden = markup.match(DENYLIST_RE);
    if (forbidden) issues.push(`placements.${slug}: forbidden markup (${forbidden[0]})`);
    if (!re.test(markup)) issues.push(`placements.${slug}: must be a self-closing block comment <!-- wp:${blockName(id)} {...} /--> (got "${markup.slice(0, 80)}")`);
  }
  return issues;
}

export function assertPluginManifest(m: PluginManifest, spec: SiteSpec, feature: Feature): void {
  const issues = validatePluginManifest(m, spec, feature);
  if (issues.length) throw new Error(`${manifestRel(feature.id)} is invalid:\n- ${issues.join("\n- ")}`);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/plugin-manifest.test.ts tests/unit/workspace.test.ts tests/unit/page-tree.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schemas/plugin-manifest.ts src/schemas/page-tree.ts src/schemas/site-spec.ts src/workspace.ts tests/unit/plugin-manifest.test.ts tests/unit/workspace.test.ts
git commit -m "feat(faktory): plugin manifest schema, naming helpers and spec cross-checks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 4: `applyPlugins` at compile time, wired into the `pages` stage

**Files:**
- Create: `src/pages/apply-plugins.ts`, `tests/unit/apply-plugins.test.ts`
- Modify: `src/stages/pages.ts`, `tests/unit/stage-pages.test.ts`

**Interfaces:**
- Produces: `applyPlugins(tree: PageTree, manifests: PluginManifest[], pageSlug: string): { tree: PageTree; applied: string[] }` (pure: deep-copies, never mutates its input; `applied` = feature ids whose wrapper was replaced), `readPluginManifests(ctx: SiteContext): PluginManifest[]` (every `plugins/*.json`, parsed with `parsePluginManifest`, sorted by file name; empty when the dir is missing; throws `plugins/<f>.json is not valid JSON` / `Invalid plugin manifest` with the file name prefixed).
- Consumes: `findWrapper`, `FEATURE_WRAPPER_ATTR`, `GbNode`, `PageTree` (page-tree.ts); `PluginManifest`, `parsePluginManifest`, `PLUGINS_DIR` (plugin-manifest.ts).

- [ ] **Step 1: Failing tests**

`tests/unit/apply-plugins.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPlugins, readPluginManifests } from "../../src/pages/apply-plugins.js";
import { parsePluginManifest } from "../../src/schemas/plugin-manifest.js";
import { findWrapper, findMarkers, type PageTree } from "../../src/schemas/page-tree.js";
import type { SiteContext } from "../../src/docker.js";

const tree = (): PageTree => JSON.parse(readFileSync("fixtures/pages/accueil.gb.json", "utf8"));
const manifest = parsePluginManifest(JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8")));

describe("applyPlugins", () => {
  it("replaces the whole feature wrapper with a raw node carrying the page's placement", () => {
    const input = tree();
    const before = JSON.stringify(input);
    const r = applyPlugins(input, [manifest], "accueil");
    expect(r.applied).toEqual(["catalogue_produits"]);
    expect(JSON.stringify(input)).toBe(before); // pure
    expect(findWrapper(r.tree, "feature", "catalogue_produits")).toBeUndefined();
    expect(findMarkers(r.tree)).toEqual([]);
    const section = r.tree[1].innerBlocks![0];
    const raw = section.innerBlocks!.find((n) => n.type === "raw")!;
    expect(raw.rawMarkup).toBe(manifest.placements["accueil"]);
    expect(section.innerBlocks!.filter((n) => n.type === "text")).toHaveLength(1); // the h2 stays
  });
  it("leaves the tree untouched when the page has no placement or no manifest matches", () => {
    const r1 = applyPlugins(tree(), [manifest], "contact");
    expect(r1.applied).toEqual([]);
    expect(r1.tree).toEqual(tree());
    const r2 = applyPlugins(tree(), [], "accueil");
    expect(r2.applied).toEqual([]);
    expect(findWrapper(r2.tree, "feature", "catalogue_produits")).toBeDefined();
  });
  it("uses the placement of the given page, not another page's", () => {
    const r = applyPlugins(tree(), [manifest], "nos-produits");
    // the fixture tree is the home tree, but the placement chosen is the nos-produits one
    const raw = r.tree[1].innerBlocks![0].innerBlocks!.find((n) => n.type === "raw")!;
    expect(raw.rawMarkup).toContain('"view":"grid"');
  });
});

describe("readPluginManifests", () => {
  const ctx = (): SiteContext => ({ siteDir: mkdtempSync(join(tmpdir(), "fk-apply-")) } as SiteContext);
  it("returns [] without a plugins dir, else every manifest sorted by file name", () => {
    const c = ctx();
    expect(readPluginManifests(c)).toEqual([]);
    mkdirSync(join(c.siteDir, "plugins"));
    writeFileSync(join(c.siteDir, "plugins/zzz.json"), JSON.stringify({ ...manifest, feature: "zzz" }));
    writeFileSync(join(c.siteDir, "plugins/catalogue_produits.json"), JSON.stringify(manifest));
    writeFileSync(join(c.siteDir, "plugins/notes.txt"), "ignored");
    expect(readPluginManifests(c).map((m) => m.feature)).toEqual(["catalogue_produits", "zzz"]);
  });
  it("names the offending file on invalid JSON or an invalid manifest", () => {
    const c = ctx();
    mkdirSync(join(c.siteDir, "plugins"));
    writeFileSync(join(c.siteDir, "plugins/bad.json"), "{ nope");
    expect(() => readPluginManifests(c)).toThrow(/plugins\/bad.json is not valid JSON/);
    writeFileSync(join(c.siteDir, "plugins/bad.json"), JSON.stringify({ feature: "bad" }));
    expect(() => readPluginManifests(c)).toThrow(/plugins\/bad.json: Invalid plugin manifest/);
  });
});
```

Add to `tests/unit/stage-pages.test.ts` (imports: `readPluginManifests` not needed; use files):
```ts
  it("applies plugin manifests at compile time and keeps the tree on disk untouched", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "pages"), { recursive: true });
    copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, "accueil"));
    mkdirSync(join(c.siteDir, "plugins"), { recursive: true });
    copyFileSync("fixtures/plugins/catalogue_produits.manifest.json", join(c.siteDir, "plugins/catalogue_produits.json"));
    const s = spies();
    const msg = await pagesStage.run(c);
    const compiled = s.compile.mock.calls.find((k: any) => k[1] === "accueil")![2] as PageTree;
    expect(JSON.stringify(compiled)).toContain('"view\\":\\"featured\\"');
    expect(JSON.stringify(compiled)).not.toContain("data-faktory-feature");
    expect(readFileSync(pageTreePath(c, "accueil"), "utf8")).toContain("data-faktory-feature");
    expect(msg).toMatch(/; plugins applied \(catalogue_produits\) — \$/);
  });
  it("fails fast on an invalid manifest before generating anything", async () => {
    const c = await ctx();
    mkdirSync(join(c.siteDir, "plugins"), { recursive: true });
    writeFileSync(join(c.siteDir, "plugins/x.json"), "{ nope");
    const s = spies();
    await expect(pagesStage.run(c)).rejects.toThrow(/plugins\/x.json is not valid JSON/);
    expect(s.gen).not.toHaveBeenCalled();
  });
```
Note: `spies()`'s `generatePageTree` mock returns `stubTree(page)` whose markers are **not** wrapped, so `applyPlugins` finds no wrapper for generated pages in these tests — only the copied fixture home tree has one; the assertion above targets `accueil`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/apply-plugins.test.ts tests/unit/stage-pages.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/pages/apply-plugins.ts`:
```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SiteContext } from "../docker.js";
import { FEATURE_WRAPPER_ATTR, type GbNode, type PageTree } from "../schemas/page-tree.js";
import { PLUGINS_DIR, parsePluginManifest, type PluginManifest } from "../schemas/plugin-manifest.js";

/** Replace, in `nodes` (recursively), the first element carrying `data-faktory-feature=<id>` by `replacement`. Returns true when replaced. */
function replaceWrapper(nodes: GbNode[], id: string, replacement: GbNode): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === "element" && n.htmlAttributes?.[FEATURE_WRAPPER_ATTR] === id) { nodes[i] = replacement; return true; }
    if (n.innerBlocks?.length && replaceWrapper(n.innerBlocks, id, replacement)) return true;
  }
  return false;
}

/**
 * Compile-time substitution (spec decision 1): the tree on disk keeps its placeholder wrapper; the copy
 * handed to gb_build gets the plugin's block markup for this page instead. Pure — the input is not mutated.
 */
export function applyPlugins(tree: PageTree, manifests: PluginManifest[], pageSlug: string): { tree: PageTree; applied: string[] } {
  const copy: PageTree = JSON.parse(JSON.stringify(tree));
  const applied: string[] = [];
  for (const m of manifests) {
    const placement = m.placements[pageSlug];
    if (!placement) continue;
    if (replaceWrapper(copy, m.feature, { type: "raw", rawMarkup: placement })) applied.push(m.feature);
  }
  return { tree: copy, applied };
}

/** Every `plugins/*.json` of the site, parsed, sorted by file name; [] when the directory does not exist. */
export function readPluginManifests(ctx: SiteContext): PluginManifest[] {
  const dir = join(ctx.siteDir, PLUGINS_DIR);
  if (!existsSync(dir)) return [];
  const out: PluginManifest[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const rel = `${PLUGINS_DIR}/${f}`;
    let data: unknown;
    try { data = JSON.parse(readFileSync(join(dir, f), "utf8")); }
    catch (err) { throw new Error(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
    try { out.push(parsePluginManifest(data)); }
    catch (err) { throw new Error(`${rel}: ${err instanceof Error ? err.message : String(err)}`); }
  }
  return out;
}
```

In `src/stages/pages.ts`: import `applyPlugins, readPluginManifests` from `../pages/apply-plugins.js`; after the design-system check add `const manifests = readPluginManifests(ctx); const applied = new Set<string>();`; in `build`, replace `const markup = await deps.compilePage(ctx, page.slug, tree);` with:
```ts
      const a = applyPlugins(tree, manifests, page.slug);
      a.applied.forEach((id) => applied.add(id));
      const markup = await deps.compilePage(ctx, page.slug, a.tree);
```
and in the return line, before ` — $`, insert `${applied.size ? `; plugins applied (${Array.from(applied).sort().join(", ")})` : ""}`. Keep everything else unchanged.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/apply-plugins.test.ts tests/unit/stage-pages.test.ts && npm run typecheck`
Expected: PASS (the existing message assertions still match: no manifests → no suffix).

- [ ] **Step 5: Commit**

```bash
git add src/pages/apply-plugins.ts src/stages/pages.ts tests/unit/apply-plugins.test.ts tests/unit/stage-pages.test.ts
git commit -m "feat(faktory): apply plugin manifests to page trees at compile time

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 5: `writeRoots` — per-stage write scoping

**Files:**
- Modify: `src/agent.ts`, `src/pages/generate.ts`, `tests/unit/agent.test.ts`, `tests/unit/pages-generate.test.ts`

**Interfaces:**
- Produces: `writeGuard(siteDir: string, roots?: string[]): HookCallback` (roots relative to `siteDir`; `undefined` = whole site dir), `AgentOptions.writeRoots?: string[]`, `agentQueryOptions` passes `opts.writeRoots` to the guard. `PAGES_WRITE_ROOTS = ["pages"]` exported from `src/pages/generate.ts` and passed as `writeRoots`.

- [ ] **Step 1: Failing tests**

Add to the `writeGuard` describe in `tests/unit/agent.test.ts`:
```ts
  describe("with writeRoots", () => {
    const scoped = writeGuard("/site", ["pages", "wp-content/plugins/faktory-x"]);
    const callScoped = (file_path: string) =>
      scoped({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path }, session_id: "s", transcript_path: "", cwd: "/site" } as never, "t1", { signal: new AbortController().signal });
    it("allows writes under any root, relative or absolute", async () => {
      expect(await callScoped("pages/x.gb.json")).toEqual({});
      expect(await callScoped("/site/wp-content/plugins/faktory-x/includes/a.php")).toEqual({});
    });
    it("denies writes elsewhere in the site dir and names the roots", async () => {
      const r = (await callScoped("/site/design-system.md")) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
      expect(r.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(r.hookSpecificOutput?.permissionDecisionReason).toBe("Writes are restricted to /site/pages, /site/wp-content/plugins/faktory-x");
      const sibling = (await callScoped("/site/wp-content/plugins/faktory-xy/a.php")) as { hookSpecificOutput?: { permissionDecision?: string } };
      expect(sibling.hookSpecificOutput?.permissionDecision).toBe("deny");
    });
  });
```
In the `agentQueryOptions` test of the same file (find the existing `it` that inspects the returned options), add an assertion that the hook list is built from `opts.writeRoots`: easiest is a behavioural check — build options with `writeRoots: ["pages"]`, take `options.hooks!.PreToolUse![0].hooks[0]`, call it with a `Write` to `<siteDir>/design-system.md` and expect `deny`, then with `<siteDir>/pages/a.json` and expect `{}`.

In `tests/unit/pages-generate.test.ts`, in the test "runs the pages agent with Read/Write/gb tools…" add `expect(call.writeRoots).toEqual(["pages"]);` and import `PAGES_WRITE_ROOTS` to assert `expect(PAGES_WRITE_ROOTS).toEqual(["pages"])`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/agent.test.ts tests/unit/pages-generate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/agent.ts`:
```ts
/** Deny Write/Edit outside `roots` (relative to `siteDir`; default: the whole site dir). */
export function writeGuard(siteDir: string, roots?: string[]): HookCallback {
  const allowed = (roots?.length ? roots : [""]).map((r) => resolve(siteDir, r));
  return async (input) => {
    const pre = input as PreToolUseHookInput;
    if (pre.hook_event_name !== "PreToolUse" || !WRITE_TOOLS.has(pre.tool_name)) return {};
    const fp = (pre.tool_input as { file_path?: string; notebook_path?: string })?.file_path
      ?? (pre.tool_input as { notebook_path?: string })?.notebook_path;
    if (fp && allowed.some((base) => isInside(base, resolve(siteDir, fp)))) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Writes are restricted to ${allowed.join(", ")}`,
      },
    };
  };
}
```
Add `writeRoots?: string[];` to `AgentOptions` (doc: "Site-relative directories the agent may write to; default: the whole site dir"), and in `agentQueryOptions` use `hooks: [writeGuard(ctx.siteDir, opts.writeRoots)]`.

In `src/pages/generate.ts`: `export const PAGES_WRITE_ROOTS = ["pages"];` and add `writeRoots: PAGES_WRITE_ROOTS,` to the `runValidated` options.

- [ ] **Step 4: Run all unit tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS (existing `writeGuard("/site")` tests keep passing: `resolve("/site", "")` is `/site`).

- [ ] **Step 5: Commit**

```bash
git add src/agent.ts src/pages/generate.ts tests/unit/agent.test.ts tests/unit/pages-generate.test.ts
git commit -m "feat(faktory): writeRoots — scope agent writes per stage (pages → pages/)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 6: Plugins prompt, `pluginsUserPrompt`, `readPluginManifest`, `verifyPlugin`, `generatePlugin`

**Files:**
- Create: `src/prompts/plugins.md`, `src/plugins/generate.ts`, `tests/unit/plugins-generate.test.ts`
- Modify: `src/prompts.ts` (`PromptName` += `"plugins"`), `tests/unit/prompts.test.ts` (if it enumerates prompt names, add `plugins`)

**Interfaces:**
- Produces (in `src/plugins/generate.ts`):
  - `deps = { runAgent, phpCheck, wpJson }`, `PLUGINS_MAX_TURNS = 80`, `PLUGINS_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", TOOL_WP, TOOL_PHP_CHECK]`, `MIN_SEED_ENTRIES = 3`.
  - `referencePluginDir(config: FaktoryConfig): string` → `<repoRoot>/fixtures/plugins/faktory-catalogue-produits`.
  - `pluginsUserPrompt(spec: SiteSpec, feature: Feature, opts: { referenceDir: string }): string`.
  - `readPluginManifest(ctx, spec, feature): PluginManifest` (missing / invalid JSON / schema / cross-checks → actionable error).
  - `verifyPlugin(ctx, spec, feature): Promise<VerifiedPlugin>` with `type VerifiedPlugin = { manifest: PluginManifest; entries: number }`.
  - `generatePlugin(ctx, spec, feature): Promise<{ manifest: PluginManifest; entries: number; costUsd: number; attempts: 1 | 2 }>`.
- Consumes: `runValidated`, `AgentOptions.writeRoots` (Task 5), `phpCheck` (Task 1), `TOOL_PHP_CHECK` (Task 1), plugin-manifest helpers (Task 3), `hexIssues` (Task 3), `wpJson` (`src/wp.ts`), `loadPrompt`.

- [ ] **Step 1: Write the system prompt `src/prompts/plugins.md`**

```markdown
Tu es le développeur de plugins WordPress de Partikuls. Tu écris UN plugin sur-mesure pour une « feature » d'un site GeneratePress + GenerateBlocks : un type de contenu géré depuis l'administration, ses taxonomies, ses champs, un bloc dynamique et un shortcode qui l'affichent dans les pages. Tu travailles dans le dossier du site (cwd) : tous les chemins ci-dessous sont relatifs à ce dossier.

## Entrées (à lire avec Read, dans cet ordre)
1. Le plugin de référence dont le chemin absolu est donné dans le prompt : lis TOUS ses fichiers. C'est le modèle exact du contrat (structure, nommage, sécurité, rendu, bloc, shortcode, colonnes admin, désinstallation). Adapte-le à ta feature au lieu de repartir de zéro : mêmes fichiers, mêmes conventions, seuls l'identifiant, le CPT, les champs, les taxonomies et l'affichage changent.
2. `design-system.md` — pour le style du rendu (espacements, rayons, cartes). Le CSS du plugin n'utilise que la palette GeneratePress : `var(--base)`, `var(--base-2)`, `var(--base-3)`, `var(--contrast)`, `var(--contrast-2)`, `var(--contrast-3)`, `var(--accent)`, `var(--accent-2)`. **Jamais de hex, jamais de `rgb()`.**
Ne lis rien d'autre : la feature complète et les pages qui l'affichent sont dans le prompt.

## Sorties
1. Le dossier `wp-content/plugins/faktory-<kebab>/` (Write / Edit) avec exactement les fichiers du contrat listés dans le prompt.
2. Le manifeste `plugins/<id>.json` (Write) :
   `{ "feature": "<id>", "plugin": "faktory-<kebab>", "postType": "<cpt>", "block": "faktory/<kebab>", "shortcode": "faktory_<id>", "placements": { "<slug de page>": "<!-- wp:faktory/<kebab> {\"view\":\"…\",\"limit\":N,\"filter\":true|false} /-->", … } }`
   Une entrée `placements` par page listée dans le prompt, et aucune autre : c'est le bloc que Faktory insère dans cette page à la place des cartes d'exemple. Choisis `view`, `limit` et `filter` d'après le résumé de la section de chaque page.
**Faktory valide le plugin, l'insère dans les pages et les republie lui-même** ; ta réponse finale est une ligne de résumé (fichiers écrits, entrées créées, choix notables).

## Boucle de travail
1. Lis le plugin de référence, puis écris le plugin complet.
2. `php_check` (`{ "pluginDir": "wp-content/plugins/faktory-<kebab>" }`) : corrige chaque erreur (php -l puis PHPStan niveau 5) jusqu'à « OK ». Deux allers-retours maximum après le premier, puis passe à la suite en signalant ce qui reste.
3. `wp` `["plugin","activate","faktory-<kebab>"]` — l'activation crée les termes des taxonomies.
4. Alimente 4 à 6 entrées de démonstration réalistes (titres et textes courts en français, dérivés de la feature ; prix plausibles ; au moins 2 entrées « mises en avant » quand la feature a un tel champ) :
   - `wp` `["media","import","https://placehold.co/800x600.png","--porcelain"]` → ID d'attachement (une image par entrée ; si l'import échoue, continue sans image) ;
   - `wp` `["post","create","--post_type=<cpt>","--post_status=publish","--post_title=…","--post_content=…","--porcelain"]` → ID ;
   - `wp` `["post","meta","update","<ID>","_thumbnail_id","<attachement>"]` et une commande `post meta update` par champ (`_<cpt>_<champ>`, valeurs déjà normalisées : prix `12.50`, booléen `1`, select = une des options exactes) ;
   - `wp` `["post","term","set","<ID>","<taxonomie>","<terme>"]`.
5. Prouve le résultat : `wp` `["post","list","--post_type=<cpt>","--fields=ID,post_title","--format=json"]` et `wp` `["term","list","<taxonomie>","--fields=name","--format=json"]`.
6. Écris le manifeste, puis réponds.

## Règles
- Contrat de fichiers, nommage et rendu : identiques au plugin de référence. L'élément racine du rendu porte `class="faktory-<kebab> faktory-<kebab>--<view>"` **et** `data-faktory-plugin="<id>"` — Faktory vérifie cet attribut sur la page publiée.
- Le premier champ de type `image` est l'image à la une (`thumbnail`), pas une meta. Un champ `image` supplémentaire devient une meta « ID d'attachement » avec un bouton médiathèque (`wp_enqueue_media` + `assets/media-field.js`, sans build).
- Sécurité : nonce et capacité sur la meta box, `sanitize_*` à l'enregistrement, `esc_*` à l'affichage, `WP_Query`/`get_posts` uniquement (pas de SQL brut), `WP_UNINSTALL_PLUGIN` dans `uninstall.php`.
- Textes en français ; pas de `[à confirmer]` dans les données de démonstration : invente des valeurs plausibles pour la démo, elles seront remplacées par le client.
- Pas de Bash, pas d'écriture hors de `wp-content/plugins/faktory-<kebab>/` et de `plugins/`. Tu peux charger les skills `faktory-skills:wp-plugin-development`, `faktory-skills:wp-block-development` et `faktory-skills:wp-wpcli-and-ops`.
```

In `src/prompts.ts`: `export type PromptName = "spec" | "design" | "pages" | "plugins";`.

- [ ] **Step 2: Failing tests**

`tests/unit/plugins-generate.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { manifestPath, pluginDirPath } from "../../src/schemas/plugin-manifest.js";
import {
  pluginsUserPrompt, readPluginManifest, verifyPlugin, generatePlugin, referencePluginDir, deps, PLUGINS_TOOLS, PLUGINS_MAX_TURNS, MIN_SEED_ENTRIES,
} from "../../src/plugins/generate.js";
import { TOOL_WP, TOOL_PHP_CHECK } from "../../src/tools/server.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const feature = spec.features[0];
const FIXTURE = "fixtures/plugins/faktory-catalogue-produits";
const MANIFEST = "fixtures/plugins/catalogue_produits.manifest.json";

async function ctx(): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-plg-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  return loadContext(config, "boul");
}
function installFixture(c: SiteContext, opts: { manifest?: boolean } = { manifest: true }): void {
  cpSync(FIXTURE, pluginDirPath(c, feature.id), { recursive: true });
  if (opts.manifest) copyFileSync(MANIFEST, manifestPath(c, feature.id));
}
/** wpJson answers for a healthy plugin: active, CPT registered, 5 entries, all terms. */
function healthyWp(overrides: Partial<Record<string, unknown>> = {}) {
  return vi.spyOn(deps, "wpJson").mockImplementation(async (_c, args: any) => {
    const k = args.slice(0, 2).join(" ");
    if (k in overrides) return overrides[k];
    if (k === "plugin list") return [{ name: "faktory-catalogue-produits", status: "active" }, { name: "generateblocks", status: "active" }];
    if (k === "post-type list") return [{ name: "post" }, { name: "page" }, { name: "produit" }];
    if (k === "post list") return [{ ID: 1 }, { ID: 2 }, { ID: 3 }, { ID: 4 }, { ID: 5 }];
    if (k === "term list") return [{ name: "Pains" }, { name: "Viennoiseries" }, { name: "Pâtisseries" }, { name: "Salé du midi" }];
    throw new Error(`unexpected wp ${args.join(" ")}`);
  });
}
const phpOk = () => vi.spyOn(deps, "phpCheck").mockResolvedValue({ ok: true, output: "OK", files: 9 });

describe("pluginsUserPrompt", () => {
  it("describes the feature, its pages, the contract files and the reference plugin", () => {
    const p = pluginsUserPrompt(spec, feature, { referenceDir: "/repo/fixtures/plugins/faktory-catalogue-produits" });
    expect(p).toContain("# Feature `catalogue_produits` — Catalogue produits");
    expect(p).toContain("CPT `produit` (Produit / Produits)");
    expect(p).toContain("`prix` Prix (price)");
    expect(p).toContain("`disponibilite` Disponibilité (select : Tous les jours | Week-end | Sur commande)");
    expect(p).toContain("`categorie_produit` Catégorie / Catégories : Pains, Viennoiseries, Pâtisseries, Salé du midi");
    expect(p).toContain("- `accueil` (/) — section « ");
    expect(p).toContain("- `nos-produits` (/nos-produits/) — section « ");
    expect(p).toContain("Quatre produits mis en avant depuis le catalogue.");
    expect(p).toContain("Plugin : `wp-content/plugins/faktory-catalogue-produits/`");
    expect(p).toContain("faktory-catalogue-produits.php, includes/post-type.php");
    expect(p).toContain("Manifeste : `plugins/catalogue_produits.json`");
    expect(p).toContain("/repo/fixtures/plugins/faktory-catalogue-produits");
    expect(p).toContain(feature.display);
  });
});

describe("readPluginManifest", () => {
  it("explains a missing file, invalid JSON, an invalid schema and failed cross-checks", async () => {
    const c = await ctx();
    expect(() => readPluginManifest(c, spec, feature)).toThrow(/plugins\/catalogue_produits.json was not written — write it with Write/);
    writeFileSync(manifestPath(c, feature.id), "{ nope");
    expect(() => readPluginManifest(c, spec, feature)).toThrow(/not valid JSON/);
    writeFileSync(manifestPath(c, feature.id), JSON.stringify({ feature: "catalogue_produits" }));
    expect(() => readPluginManifest(c, spec, feature)).toThrow(/Invalid plugin manifest/);
    const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
    writeFileSync(manifestPath(c, feature.id), JSON.stringify({ ...m, placements: { accueil: m.placements.accueil } }));
    expect(() => readPluginManifest(c, spec, feature)).toThrow(/missing placement for page "nos-produits"/);
    copyFileSync(MANIFEST, manifestPath(c, feature.id));
    expect(readPluginManifest(c, spec, feature).plugin).toBe("faktory-catalogue-produits");
  });
});

describe("verifyPlugin", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("returns the manifest and the entry count when everything checks out", async () => {
    const c = await ctx(); installFixture(c);
    const php = phpOk(); healthyWp();
    const r = await verifyPlugin(c, spec, feature);
    expect(r.manifest.feature).toBe("catalogue_produits");
    expect(r.entries).toBe(5);
    expect(php).toHaveBeenCalledWith(c.config, pluginDirPath(c, feature.id));
  });
  it("lists missing contract files before running php_check", async () => {
    const c = await ctx(); installFixture(c);
    writeFileSync(manifestPath(c, feature.id), readFileSync(MANIFEST));
    const { rmSync } = await import("node:fs");
    rmSync(join(pluginDirPath(c, feature.id), "uninstall.php"));
    rmSync(join(pluginDirPath(c, feature.id), "includes/render.php"));
    const php = phpOk();
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/missing file\(s\) in wp-content\/plugins\/faktory-catalogue-produits: includes\/render.php, uninstall.php/);
    expect(php).not.toHaveBeenCalled();
  });
  it("surfaces php_check output", async () => {
    const c = await ctx(); installFixture(c);
    vi.spyOn(deps, "phpCheck").mockResolvedValue({ ok: false, output: "PHPStan level 5:\nincludes/render.php:12:Undefined variable $x", files: 9 });
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/php_check failed:\nPHPStan level 5:\nincludes\/render.php:12/);
  });
  it("refuses hex colors in style.css", async () => {
    const c = await ctx(); installFixture(c); phpOk();
    writeFileSync(join(pluginDirPath(c, feature.id), "style.css"), ".x { color: #fff; }");
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/style.css: hex color #fff/);
  });
  it("requires the plugin to be active, the post type registered, 3 entries and every term", async () => {
    const c = await ctx(); installFixture(c); phpOk();
    healthyWp({ "plugin list": [{ name: "faktory-catalogue-produits", status: "inactive" }] });
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/plugin faktory-catalogue-produits is not active — run wp \["plugin","activate","faktory-catalogue-produits"\]/);
    vi.restoreAllMocks(); phpOk();
    healthyWp({ "post-type list": [{ name: "post" }] });
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/post type "produit" is not registered/);
    vi.restoreAllMocks(); phpOk();
    healthyWp({ "post list": [{ ID: 1 }, { ID: 2 }] });
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/only 2 published "produit" entries, at least 3 expected — seed them with wp post create/);
    vi.restoreAllMocks(); phpOk();
    healthyWp({ "term list": [{ name: "Pains" }] });
    await expect(verifyPlugin(c, spec, feature)).rejects.toThrow(/taxonomy "categorie_produit" is missing term\(s\): Viennoiseries, Pâtisseries, Salé du midi/);
    expect(MIN_SEED_ENTRIES).toBe(3);
  });
});

describe("generatePlugin", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("runs the plugins agent with the plugin tools, scoped writes and the reference dir, then verifies", async () => {
    const c = await ctx(); phpOk(); healthyWp();
    const run = vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => { installFixture(cc); return { text: "ok", transcript: "ok", costUsd: 4.2, sessionId: "g-1", numTurns: 40 }; });
    const r = await generatePlugin(c, spec, feature);
    expect(r).toMatchObject({ costUsd: 4.2, attempts: 1, entries: 5 });
    expect(r.manifest.block).toBe("faktory/catalogue-produits");
    const call = run.mock.calls[0][1];
    expect(call.stage).toBe("plugins");
    expect(call.allowedTools).toEqual(PLUGINS_TOOLS);
    expect(PLUGINS_TOOLS).toEqual(["Read", "Write", "Edit", "Glob", "Grep", TOOL_WP, TOOL_PHP_CHECK]);
    expect(call.maxTurns).toBe(PLUGINS_MAX_TURNS);
    expect(call.writeRoots).toEqual(["wp-content/plugins/faktory-catalogue-produits", "plugins"]);
    expect(call.systemPrompt).toContain("Tu es le développeur de plugins WordPress");
    expect(call.prompt).toContain(referencePluginDir(c.config));
    expect(referencePluginDir(c.config)).toBe(join(c.config.repoRoot, "fixtures/plugins/faktory-catalogue-produits"));
  });
  it("retries once in the same session with the verification error", async () => {
    const c = await ctx(); phpOk(); healthyWp();
    const run = vi.spyOn(deps, "runAgent")
      .mockImplementationOnce(async (cc) => { installFixture(cc, { manifest: false }); return { text: "", transcript: "", costUsd: 3, sessionId: "g-2", numTurns: 30 }; })
      .mockImplementationOnce(async (cc) => { copyFileSync(MANIFEST, manifestPath(cc, feature.id)); return { text: "", transcript: "", costUsd: 0.5, sessionId: "g-2", numTurns: 5 }; });
    const r = await generatePlugin(c, spec, feature);
    expect(r).toMatchObject({ costUsd: 3.5, attempts: 2 });
    expect(run.mock.calls[1][1].resume).toBe("g-2");
    expect(run.mock.calls[1][1].prompt).toContain("plugins/catalogue_produits.json was not written");
  });
  it("deletes a manifest that is still invalid after the retry, keeps the plugin dir", async () => {
    const c = await ctx(); phpOk(); healthyWp();
    vi.spyOn(deps, "runAgent").mockImplementation(async (cc) => {
      installFixture(cc);
      const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
      writeFileSync(manifestPath(cc, feature.id), JSON.stringify({ ...m, placements: {} }));
      return { text: "", transcript: "", costUsd: 1, sessionId: "g-3", numTurns: 3 };
    });
    await expect(generatePlugin(c, spec, feature)).rejects.toThrow(/plugins: output still invalid after one retry — .*plugins\/catalogue_produits\.json deleted, the next run regenerates it/s);
    expect(existsSync(manifestPath(c, feature.id))).toBe(false);
    expect(existsSync(pluginDirPath(c, feature.id))).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/plugins-generate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/plugins/generate.ts`**

```ts
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { FaktoryConfig } from "../config.js";
import type { SiteContext } from "../docker.js";
import { runAgent, runValidated } from "../agent.js";
import { loadPrompt } from "../prompts.js";
import { phpCheck } from "../php.js";
import { wpJson } from "../wp.js";
import { hexIssues } from "../schemas/page-tree.js";
import {
  assertPluginManifest, manifestPath, manifestRel, parsePluginManifest, placementPages, pluginDirPath, pluginDirRel, pluginSlug,
  blockName, shortcodeName, requiredPluginFiles, PLUGINS_DIR, RENDER_ATTR, kebab, type PluginManifest,
} from "../schemas/plugin-manifest.js";
import type { Feature, SiteSpec } from "../schemas/site-spec.js";
import { TOOL_PHP_CHECK, TOOL_WP } from "../tools/server.js";

export const deps = { runAgent, phpCheck, wpJson };
export const PLUGINS_MAX_TURNS = 80;
export const PLUGINS_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", TOOL_WP, TOOL_PHP_CHECK];
export const MIN_SEED_ENTRIES = 3;

export function referencePluginDir(config: FaktoryConfig): string {
  return join(config.repoRoot, "fixtures", "plugins", "faktory-catalogue-produits");
}

export function pluginsUserPrompt(spec: SiteSpec, feature: Feature, opts: { referenceDir: string }): string {
  const id = feature.id;
  const pages = spec.sitemap.filter((p) => placementPages(spec, id).includes(p.slug));
  const field = (f: Feature["fields"][number]): string =>
    `\`${f.key}\` ${f.label} (${f.type}${f.options?.length ? ` : ${f.options.join(" | ")}` : ""})`;
  const lines: string[] = [
    `# Feature \`${id}\` — ${feature.name}`,
    feature.description,
    "",
    `CPT \`${feature.cpt.slug}\` (${feature.cpt.singular} / ${feature.cpt.plural}).`,
    "",
    "## Champs",
    ...feature.fields.map((f) => `- ${field(f)}`),
    "",
    "## Taxonomies",
    ...(feature.taxonomies.length
      ? feature.taxonomies.map((t) => `- \`${t.slug}\` ${t.singular} / ${t.plural} : ${t.terms.join(", ")}`)
      : ["- aucune"]),
    "",
    "## Affichage attendu",
    feature.display,
    "",
    "## Pages où insérer le bloc (une entrée `placements` chacune, aucune autre)",
    ...pages.map((p) => {
      const sections = p.sections.filter((s) => s.type === "custom-query" && s.feature === id);
      return `- \`${p.slug}\` (${p.kind === "home" ? "/" : `/${p.slug}/`}) — ${sections.map((s) => `section « ${s.heading} » : ${s.summary}`).join(" ; ")}`;
    }),
    "",
    "## Identité",
    `${spec.identity.name} — ${spec.identity.sector}${spec.identity.location ? ` (${spec.identity.location})` : ""}. Ton : ${spec.identity.tone}.`,
    "",
    "## Nommage (dérivé de l'identifiant, à respecter exactement)",
    `Plugin : \`${pluginDirRel(id)}/\` (slug \`${pluginSlug(id)}\`, text domain \`${pluginSlug(id)}\`). Bloc : \`${blockName(id)}\`. Shortcode : \`[${shortcodeName(id)}]\`. Fonction de rendu : \`faktory_${id}_render\`. Meta : \`_${feature.cpt.slug}_<champ>\`. Attribut racine du rendu : \`${RENDER_ATTR}="${id}"\`. Dossier du bloc : \`blocks/${kebab(id)}/\`.`,
    `Fichiers obligatoires : ${requiredPluginFiles(id).join(", ")}.`,
    `Manifeste : \`${manifestRel(id)}\`.`,
    "",
    "## À faire",
    `Lis d'abord tous les fichiers du plugin de référence : \`${opts.referenceDir}\` (Read, chemin absolu). Puis écris le plugin, passe \`php_check\`, active-le, alimente ${MIN_SEED_ENTRIES + 1} à 6 entrées avec \`wp\`, écris le manifeste et réponds par une ligne de résumé.`,
  ];
  return lines.join("\n");
}

/** Read and cross-check `plugins/<id>.json`; throws a message the agent can act on. */
export function readPluginManifest(ctx: SiteContext, spec: SiteSpec, feature: Feature): PluginManifest {
  const rel = manifestRel(feature.id), abs = manifestPath(ctx, feature.id);
  if (!existsSync(abs)) throw new Error(`${rel} was not written — write it with Write`);
  let data: unknown;
  try { data = JSON.parse(readFileSync(abs, "utf8")); }
  catch (err) { throw new Error(`${rel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
  const m = parsePluginManifest(data);
  assertPluginManifest(m, spec, feature);
  return m;
}

export type VerifiedPlugin = { manifest: PluginManifest; entries: number };

type Named = { name: string; status?: string };

/** Everything the spec's decision 4 checks before a plugin is integrated. Throws the first failing check. */
export async function verifyPlugin(ctx: SiteContext, spec: SiteSpec, feature: Feature): Promise<VerifiedPlugin> {
  const id = feature.id, slug = pluginSlug(id), dir = pluginDirPath(ctx, id), rel = pluginDirRel(id);
  const manifest = readPluginManifest(ctx, spec, feature);
  const missing = requiredPluginFiles(id).filter((f) => !existsSync(join(dir, f)));
  if (missing.length) throw new Error(`missing file(s) in ${rel}: ${missing.join(", ")}`);
  const php = await deps.phpCheck(ctx.config, dir);
  if (!php.ok) throw new Error(`php_check failed:\n${php.output}`);
  const cssIssues: string[] = [];
  hexIssues(readFileSync(join(dir, "style.css"), "utf8"), "style.css", cssIssues);
  if (cssIssues.length) throw new Error(cssIssues.join("\n"));
  const plugins = await deps.wpJson<Named[]>(ctx, ["plugin", "list", "--fields=name,status"]);
  if (!plugins.some((p) => p.name === slug && p.status === "active")) {
    throw new Error(`plugin ${slug} is not active — run wp ["plugin","activate","${slug}"] and fix any activation error`);
  }
  const types = await deps.wpJson<Named[]>(ctx, ["post-type", "list", "--fields=name"]);
  if (!types.some((t) => t.name === feature.cpt.slug)) throw new Error(`post type "${feature.cpt.slug}" is not registered — check register_post_type in includes/post-type.php`);
  const posts = await deps.wpJson<{ ID: number }[]>(ctx, ["post", "list", `--post_type=${feature.cpt.slug}`, "--post_status=publish", "--fields=ID"]);
  if (posts.length < MIN_SEED_ENTRIES) {
    throw new Error(`only ${posts.length} published "${feature.cpt.slug}" entries, at least ${MIN_SEED_ENTRIES} expected — seed them with wp post create`);
  }
  for (const t of feature.taxonomies) {
    const terms = await deps.wpJson<Named[]>(ctx, ["term", "list", t.slug, "--fields=name"]);
    const present = new Set(terms.map((x) => x.name.toLowerCase()));
    const absent = t.terms.filter((name) => !present.has(name.toLowerCase()));
    if (absent.length) throw new Error(`taxonomy "${t.slug}" is missing term(s): ${absent.join(", ")} — create them with wp term create`);
  }
  return { manifest, entries: posts.length };
}

/** One agent run (plus one validated retry) producing the plugin dir + manifest, verified end to end. */
export async function generatePlugin(
  ctx: SiteContext, spec: SiteSpec, feature: Feature,
): Promise<{ manifest: PluginManifest; entries: number; costUsd: number; attempts: 1 | 2 }> {
  try {
    const r = await runValidated(deps.runAgent, ctx, {
      stage: "plugins",
      systemPrompt: loadPrompt("plugins"),
      prompt: pluginsUserPrompt(spec, feature, { referenceDir: referencePluginDir(ctx.config) }),
      allowedTools: PLUGINS_TOOLS,
      maxTurns: PLUGINS_MAX_TURNS,
      writeRoots: [pluginDirRel(feature.id), PLUGINS_DIR],
    }, () => verifyPlugin(ctx, spec, feature));
    return { manifest: r.value.manifest, entries: r.value.entries, costUsd: r.costUsd, attempts: r.attempts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Same convention as pages: a manifest that is still invalid after the retry is deleted so the next
    // run regenerates the plugin instead of "reusing" a broken one. The plugin dir is kept for inspection.
    if (message.includes("output still invalid after one retry")) {
      const abs = manifestPath(ctx, feature.id);
      if (existsSync(abs)) rmSync(abs);
      throw new Error(`${message} — ${manifestRel(feature.id)} deleted, the next run regenerates it`);
    }
    throw err;
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/unit/plugins-generate.test.ts tests/unit/prompts.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/prompts/plugins.md src/prompts.ts src/plugins/generate.ts tests/unit/plugins-generate.test.ts tests/unit/prompts.test.ts
git commit -m "feat(faktory): plugins prompt, manifest reading, plugin verification and agent run

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 7: `integratePlugin` — recompile, republish, HTTP check

**Files:**
- Create: `src/plugins/integrate.ts`, `tests/unit/plugins-integrate.test.ts`

**Interfaces:**
- Produces: `deps = { compilePage, publishPage, fetchText }` where `fetchText(url: string): Promise<string>` (default: global `fetch`, throws `GET <url> → <status>` on a non-2xx); `pageUrl(ctx: SiteContext, page: Page): string` (`<siteUrl>/` for the home, `<siteUrl>/<slug>/` otherwise); `integratePlugin(ctx, spec, manifest, ids: Record<string, number>): Promise<{ pages: string[]; skipped: string[] }>` — `pages` = slugs recompiled + republished + verified, `skipped` = placement pages whose `pages/<slug>.gb.json` does not exist yet.
- Consumes: `readPageTree` (`src/pages/generate.ts`), `applyPlugins`, `readPluginManifests` (Task 4), `compilePage`, `publishPage`, `pageTreePath`, `siteUrl`, `RENDER_ATTR`.

- [ ] **Step 1: Failing tests**

`tests/unit/plugins-integrate.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext } from "../../src/pipeline.js";
import { pageTreePath } from "../../src/artifacts.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { parsePluginManifest, manifestPath } from "../../src/schemas/plugin-manifest.js";
import { integratePlugin, pageUrl, deps } from "../../src/plugins/integrate.js";
import type { SiteContext } from "../../src/docker.js";
import type { PageTree } from "../../src/schemas/page-tree.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const manifest = parsePluginManifest(JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8")));
const IDS = { accueil: 10, "nos-produits": 11 };

async function ctx(): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-int-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  mkdirSync(join(c.siteDir, "pages"), { recursive: true });
  copyFileSync("fixtures/plugins/catalogue_produits.manifest.json", manifestPath(c, "catalogue_produits"));
  return c;
}
function spies(html = (slug: string) => `<html><div data-faktory-plugin="catalogue_produits" data-page="${slug}"></div></html>`) {
  const compile = vi.spyOn(deps, "compilePage").mockImplementation(async (_c, slug) => `<!-- ${slug} -->`);
  const publish = vi.spyOn(deps, "publishPage").mockResolvedValue(undefined);
  const fetchText = vi.spyOn(deps, "fetchText").mockImplementation(async (url) => html(url));
  return { compile, publish, fetchText };
}

describe("pageUrl", () => {
  it("maps the home to / and other pages to /<slug>/", async () => {
    const c = await ctx();
    const home = spec.sitemap.find((p) => p.kind === "home")!, other = spec.sitemap.find((p) => p.slug === "nos-produits")!;
    expect(pageUrl(c, home)).toBe(`http://localhost:${c.state.port}/`);
    expect(pageUrl(c, other)).toBe(`http://localhost:${c.state.port}/nos-produits/`);
  });
});

describe("integratePlugin", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("recompiles, republishes and checks every placement page whose tree exists; skips the others", async () => {
    const c = await ctx();
    copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, "accueil"));
    const s = spies();
    const r = await integratePlugin(c, spec, manifest, IDS);
    expect(r).toEqual({ pages: ["accueil"], skipped: ["nos-produits"] });
    const tree = s.compile.mock.calls[0][2] as PageTree;
    expect(JSON.stringify(tree)).toContain('"view\\":\\"featured\\"');
    expect(JSON.stringify(tree)).not.toContain("data-faktory-feature");
    expect(s.publish).toHaveBeenCalledWith(c, 10, "<!-- accueil -->");
    expect(s.fetchText).toHaveBeenCalledWith(`http://localhost:${c.state.port}/`);
  });
  it("fails when the published page does not render the plugin attribute", async () => {
    const c = await ctx();
    copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, "accueil"));
    spies(() => "<html>no plugin here</html>");
    await expect(integratePlugin(c, spec, manifest, IDS)).rejects.toThrow(/\/ \(accueil\) does not render data-faktory-plugin="catalogue_produits" — check the render function and that the block is registered/);
  });
  it("propagates fetch errors and invalid trees", async () => {
    const c = await ctx();
    copyFileSync("fixtures/pages/accueil.gb.json", pageTreePath(c, "accueil"));
    const s = spies();
    s.fetchText.mockRejectedValue(new Error("GET http://x → 500"));
    await expect(integratePlugin(c, spec, manifest, IDS)).rejects.toThrow(/GET http:\/\/x → 500/);
  });
  it("returns no pages when no tree exists yet", async () => {
    const c = await ctx();
    const s = spies();
    expect(await integratePlugin(c, spec, manifest, IDS)).toEqual({ pages: [], skipped: ["accueil", "nos-produits"] });
    expect(s.compile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/plugins-integrate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/plugins/integrate.ts`**

```ts
import { existsSync } from "node:fs";
import { siteUrl, type SiteContext } from "../docker.js";
import { pageTreePath } from "../artifacts.js";
import { readPageTree } from "../pages/generate.js";
import { applyPlugins, readPluginManifests } from "../pages/apply-plugins.js";
import { compilePage, publishPage } from "../pages/publish.js";
import { RENDER_ATTR, type PluginManifest } from "../schemas/plugin-manifest.js";
import type { Page, SiteSpec } from "../schemas/site-spec.js";

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.text();
}

export const deps = { compilePage, publishPage, fetchText };

export function pageUrl(ctx: SiteContext, page: Page): string {
  return page.kind === "home" ? `${siteUrl(ctx)}/` : `${siteUrl(ctx)}/${page.slug}/`;
}

/**
 * For every page the manifest places the plugin on and whose tree already exists: apply every manifest
 * of the site (not only this one), recompile, republish, then fetch the page and require the render attribute.
 * Pages without a tree are skipped: the `pages` stage applies the manifests when it builds them.
 */
export async function integratePlugin(
  ctx: SiteContext, spec: SiteSpec, manifest: PluginManifest, ids: Record<string, number>,
): Promise<{ pages: string[]; skipped: string[] }> {
  const manifests = readPluginManifests(ctx);
  const pages: string[] = [], skipped: string[] = [];
  for (const slug of Object.keys(manifest.placements)) {
    const page = spec.sitemap.find((p) => p.slug === slug);
    if (!page) throw new Error(`manifest places ${manifest.feature} on unknown page "${slug}"`);
    if (!existsSync(pageTreePath(ctx, slug))) { skipped.push(slug); continue; }
    const id = ids[slug];
    if (!id) throw new Error(`no WordPress page for slug "${slug}" — run the provision stage first`);
    const tree = readPageTree(ctx, page);
    const markup = await deps.compilePage(ctx, slug, applyPlugins(tree, manifests, slug).tree);
    await deps.publishPage(ctx, id, markup);
    const url = pageUrl(ctx, page);
    const html = await deps.fetchText(url);
    const needle = `${RENDER_ATTR}="${manifest.feature}"`;
    if (!html.includes(needle)) {
      throw new Error(`${page.kind === "home" ? "/" : `/${slug}/`} (${slug}) does not render ${needle} — check the render function and that the block is registered`);
    }
    pages.push(slug);
    console.log(`  ✔ ${page.kind === "home" ? "/" : `/${slug}/`} renders ${manifest.block}`);
  }
  return { pages, skipped };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/plugins-integrate.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/integrate.ts tests/unit/plugins-integrate.test.ts
git commit -m "feat(faktory): integrate a plugin into the published pages and verify its render attribute

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 8: The `plugins` stage — sequential features, reuse, registration

**Files:**
- Create: `src/stages/plugins.ts`, `tests/unit/stage-plugins.test.ts`
- Modify: `src/pipeline.ts` (register), `tests/unit/pipeline.test.ts` (if it asserts which stages are "skipped (not implemented)", `plugins` no longer is)

**Interfaces:**
- Produces: `pluginsStage: Stage` (`name: "plugins"`, no checkpoint), `deps = { ensurePages, generatePlugin, verifyPlugin, integratePlugin }`.
- Consumes: Task 6 `generatePlugin`/`verifyPlugin`, Task 7 `integratePlugin`, `ensurePages`, `assertBudget`, `manifestPath`, `pluginDirPath`, `readJsonArtifact`, `parseSiteSpec`.

- [ ] **Step 1: Failing tests**

`tests/unit/stage-plugins.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, cpSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { loadContext, registry } from "../../src/pipeline.js";
import { writeJsonArtifact } from "../../src/artifacts.js";
import { parseSiteSpec, type SiteSpec } from "../../src/schemas/site-spec.js";
import { manifestPath, pluginDirPath, parsePluginManifest } from "../../src/schemas/plugin-manifest.js";
import { pluginsStage, deps } from "../../src/stages/plugins.js";
import type { SiteContext } from "../../src/docker.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const feature = spec.features[0];
const manifest = parsePluginManifest(JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8")));
const IDS: Record<string, number> = { accueil: 10, "nos-produits": 11, "commandes-evenements": 12, "la-maison": 13, actualites: 14, contact: 15 };

async function ctx(s: SiteSpec = spec): Promise<SiteContext> {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stplg-")));
  await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
  const c = loadContext(config, "boul");
  writeJsonArtifact(c, "siteSpecJson", s);
  return c;
}
function installFixture(c: SiteContext): void {
  cpSync("fixtures/plugins/faktory-catalogue-produits", pluginDirPath(c, feature.id), { recursive: true });
  copyFileSync("fixtures/plugins/catalogue_produits.manifest.json", manifestPath(c, feature.id));
}
function spies(opts: { generateFails?: boolean; integrateFails?: boolean } = {}) {
  const order: string[] = [];
  const ensure = vi.spyOn(deps, "ensurePages").mockResolvedValue(IDS);
  const gen = vi.spyOn(deps, "generatePlugin").mockImplementation(async (c, _s, f) => {
    order.push(`gen:${f.id}`);
    if (opts.generateFails) throw new Error("plugins: output still invalid after one retry — php_check failed");
    installFixture(c);
    return { manifest, entries: 5, costUsd: 4.5, attempts: 1 as const };
  });
  const verify = vi.spyOn(deps, "verifyPlugin").mockImplementation(async (_c, _s, f) => { order.push(`verify:${f.id}`); return { manifest, entries: 5 }; });
  const integrate = vi.spyOn(deps, "integratePlugin").mockImplementation(async (_c, _s, m) => {
    order.push(`integrate:${m.feature}`);
    if (opts.integrateFails) throw new Error("/ (accueil) does not render data-faktory-plugin");
    return { pages: ["accueil", "nos-produits"], skipped: [] };
  });
  return { ensure, gen, verify, integrate, order };
}

describe("plugins stage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("is registered in the pipeline, without checkpoint", () => {
    expect(registry.plugins).toBe(pluginsStage);
    expect(pluginsStage.checkpoint).toBeFalsy();
  });
  it("needs site-spec.json", async () => {
    const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-stplg-")));
    await initSite(config, { slug: "boul", briefPath: "fixtures/briefs/boulangerie.md" });
    await expect(pluginsStage.run(loadContext(config, "boul"))).rejects.toThrow(/site-spec.json not found/);
  });
  it("does nothing when the spec has no features", async () => {
    const c = await ctx({ ...spec, features: [], sitemap: spec.sitemap.map((p) => ({ ...p, sections: p.sections.filter((s) => s.type !== "custom-query") })) });
    const s = spies();
    expect(await pluginsStage.run(c)).toBe("no features in site-spec.json: nothing to do");
    expect(s.ensure).not.toHaveBeenCalled();
  });
  it("generates, then integrates each feature, and reports cost", async () => {
    const c = await ctx();
    const s = spies();
    const msg = await pluginsStage.run(c);
    expect(s.ensure).toHaveBeenCalledWith(c, spec);
    expect(s.order).toEqual(["gen:catalogue_produits", "integrate:catalogue_produits"]);
    expect(s.integrate).toHaveBeenCalledWith(c, spec, manifest, IDS);
    expect(msg).toBe("1 plugin: faktory-catalogue-produits (produit, 5 entries, 2 pages updated); 1 generated, 0 reused — $4.50");
  });
  it("reuses an existing manifest + plugin dir: verify, no agent", async () => {
    const c = await ctx();
    installFixture(c);
    const s = spies();
    const msg = await pluginsStage.run(c);
    expect(s.gen).not.toHaveBeenCalled();
    expect(s.order).toEqual(["verify:catalogue_produits", "integrate:catalogue_produits"]);
    expect(msg).toBe("1 plugin: faktory-catalogue-produits (produit, 5 entries, 2 pages updated); 0 generated, 1 reused — $0.00");
  });
  it("mentions pages skipped for lack of a tree", async () => {
    const c = await ctx();
    const s = spies();
    s.integrate.mockResolvedValue({ pages: [], skipped: ["accueil", "nos-produits"] });
    const msg = await pluginsStage.run(c);
    expect(msg).toContain("(produit, 5 entries, 0 pages updated, 2 waiting for the pages stage)");
  });
  it("refuses to generate once the budget is spent", async () => {
    const c = await ctx();
    c.state = { ...c.state, costUsd: 40 };
    const s = spies();
    await expect(pluginsStage.run(c)).rejects.toThrow(/Cost budget reached/);
    expect(s.gen).not.toHaveBeenCalled();
  });
  it("fails with the feature list when a plugin fails, after trying the others", async () => {
    const two: SiteSpec = { ...spec, features: [feature, { ...feature, id: "horaires", name: "Horaires", cpt: { slug: "horaire", singular: "Horaire", plural: "Horaires" } }] };
    const c = await ctx(two);
    const s = spies();
    s.gen.mockImplementation(async (cc, _s, f) => {
      if (f.id === "catalogue_produits") throw new Error("plugins: output still invalid after one retry — php_check failed");
      installFixture(cc);
      return { manifest: { ...manifest, feature: "horaires" }, entries: 4, costUsd: 3, attempts: 1 as const };
    });
    await expect(pluginsStage.run(c)).rejects.toThrow(/1 plugin\(s\) failed: catalogue_produits — fix or delete plugins\/<id>.json and re-run: faktory run boul --only plugins/);
    expect(s.integrate).toHaveBeenCalledTimes(1);
  });
  it("fails when integration fails", async () => {
    const c = await ctx();
    spies({ integrateFails: true });
    await expect(pluginsStage.run(c)).rejects.toThrow(/1 plugin\(s\) failed: catalogue_produits/);
  });
});
```
Note on the "two features" test: `horaires` has no `custom-query` section in the sitemap, so its manifest placements would fail `validatePluginManifest` — the stage never validates here because `generatePlugin` is mocked; that is intended, the test exercises the loop, not the cross-checks.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/stage-plugins.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/stages/plugins.ts` and register it**

```ts
import { existsSync } from "node:fs";
import type { Stage } from "../pipeline.js";
import { assertBudget } from "../budget.js";
import { readJsonArtifact } from "../artifacts.js";
import { ensurePages } from "../provision/pages.js";
import { generatePlugin, verifyPlugin } from "../plugins/generate.js";
import { integratePlugin } from "../plugins/integrate.js";
import { parseSiteSpec } from "../schemas/site-spec.js";
import { manifestPath, pluginDirPath } from "../schemas/plugin-manifest.js";

export const deps = { ensurePages, generatePlugin, verifyPlugin, integratePlugin };

export const pluginsStage: Stage = {
  name: "plugins",
  async run(ctx) {
    const spec = readJsonArtifact(ctx, "siteSpecJson", parseSiteSpec);
    if (!spec.features.length) return "no features in site-spec.json: nothing to do";
    const ids = await deps.ensurePages(ctx, spec);
    const generated: string[] = [], reused: string[] = [], failed: string[] = [], summaries: string[] = [];
    let cost = 0;

    // Features run one at a time (spec decision 2): few per site, long agents, no budget split needed.
    for (const feature of spec.features) {
      try {
        let manifest, entries: number;
        if (existsSync(manifestPath(ctx, feature.id)) && existsSync(pluginDirPath(ctx, feature.id))) {
          ({ manifest, entries } = await deps.verifyPlugin(ctx, spec, feature));
          reused.push(feature.id);
        } else {
          assertBudget(ctx.config, ctx.state);
          const g = await deps.generatePlugin(ctx, spec, feature);
          manifest = g.manifest; entries = g.entries; cost += g.costUsd; generated.push(feature.id);
        }
        const { pages, skipped } = await deps.integratePlugin(ctx, spec, manifest, ids);
        const waiting = skipped.length ? `, ${skipped.length} waiting for the pages stage` : "";
        summaries.push(`${manifest.plugin} (${manifest.postType}, ${entries} entries, ${pages.length} pages updated${waiting})`);
        console.log(`  ✔ ${manifest.plugin} active, ${entries} entries, ${pages.length} page(s) updated`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("Cost budget reached")) throw err;
        failed.push(feature.id);
        console.error(`  ✖ ${feature.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failed.length) {
      throw new Error(`${failed.length} plugin(s) failed: ${failed.join(", ")} — fix or delete plugins/<id>.json and re-run: faktory run ${ctx.slug} --only plugins`);
    }
    const n = spec.features.length;
    return `${n} plugin${n === 1 ? "" : "s"}: ${summaries.join("; ")}; ${generated.length} generated, ${reused.length} reused — $${cost.toFixed(2)}`;
  },
};
```
In `src/pipeline.ts`: `import { pluginsStage } from "./stages/plugins.js";` and add `plugins: pluginsStage` to `registry`.

- [ ] **Step 4: Run all unit tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. If `tests/unit/pipeline.test.ts` counted `plugins` among the skipped stages, update that expectation (the skipped set is now `content`, `qa`, `export`).

- [ ] **Step 5: Commit**

```bash
git add src/stages/plugins.ts src/pipeline.ts tests/unit/stage-plugins.test.ts tests/unit/pipeline.test.ts
git commit -m "feat(faktory): plugins stage — one agent per feature, reuse, integration into pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 9: Docker integration test — reference plugin activated, seeded, rendered in a stub page

**Files:**
- Create: `tests/integration/plugins.test.ts`

**Interfaces:**
- Consumes: `runSite`, `destroySite`, `loadContext`, `wpOk`, `initSite`, `artifactPath`, `pageTreePath`, `pluginDirPath`, `manifestPath`, `verifyPlugin`, `deps as pluginsDeps` (`src/stages/plugins.ts`), `deps as pagesDeps` (`src/stages/pages.ts`), `FEATURE_WRAPPER_ATTR`, `featureMarker`, `formMarker`, `FORM_WRAPPER_ATTR`.

- [ ] **Step 1: Write the test**

`tests/integration/plugins.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { wpOk, wpJson } from "../../src/wp.js";
import { artifactPath, pageTreePath } from "../../src/artifacts.js";
import { manifestPath, pluginDirPath } from "../../src/schemas/plugin-manifest.js";
import { verifyPlugin } from "../../src/plugins/generate.js";
import { deps as pluginsDeps } from "../../src/stages/plugins.js";
import { deps as pagesDeps } from "../../src/stages/pages.js";
import { featureMarker, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type GbNode, type PageTree } from "../../src/schemas/page-tree.js";
import type { Page } from "../../src/schemas/site-spec.js";
import type { SiteContext } from "../../src/docker.js";

const FIXTURE = "fixtures/plugins/faktory-catalogue-produits";
const MANIFEST = "fixtures/plugins/catalogue_produits.manifest.json";

/** Same stand-in tree as tests/integration/pages.test.ts (wrapped markers). */
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
      ...((s.type === "form" || s.type === "contact") && s.form
        ? [{ type: "element", tagName: "div", htmlAttributes: { [FORM_WRAPPER_ATTR]: s.form },
             innerBlocks: [{ type: "raw", rawMarkup: formMarker(s.form) }, { type: "text", tagName: "p", content: "Le formulaire sera disponible ici." }] } satisfies GbNode]
        : []),
    ] satisfies GbNode[],
  }));
}

/** What the agent would do: copy the reference plugin + manifest, activate, seed 4 entries with meta, terms and (no) image. */
async function actAsAgent(ctx: SiteContext): Promise<void> {
  cpSync(FIXTURE, pluginDirPath(ctx, "catalogue_produits"), { recursive: true });
  copyFileSync(MANIFEST, manifestPath(ctx, "catalogue_produits"));
  await wpOk(ctx, ["plugin", "activate", "faktory-catalogue-produits"]);
  const seed: [string, string, string, string, string][] = [
    ["Tourte de meule", "Levain naturel, farine T80.", "4.80", "Tous les jours", "1"],
    ["Baguette tradition", "Croûte fine, mie crème.", "1.30", "Tous les jours", "1"],
    ["Croissant pur beurre", "Feuilletage 27 couches.", "1.40", "Week-end", ""],
    ["Tarte de saison", "Fruits du marché.", "18.00", "Sur commande", ""],
  ];
  const cats = ["Pains", "Pains", "Viennoiseries", "Pâtisseries"];
  for (const [i, [title, content, prix, dispo, featured]] of seed.entries()) {
    const id = await wpOk(ctx, ["post", "create", "--post_type=produit", "--post_status=publish", `--post_title=${title}`, `--post_content=${content}`, "--porcelain"]);
    await wpOk(ctx, ["post", "meta", "update", id, "_produit_prix", prix]);
    await wpOk(ctx, ["post", "meta", "update", id, "_produit_disponibilite", dispo]);
    if (featured) await wpOk(ctx, ["post", "meta", "update", id, "_produit_mis_en_avant", featured]);
    await wpOk(ctx, ["post", "term", "set", id, "categorie_produit", cats[i]]);
  }
}

describe.skipIf(!process.env.FAKTORY_DOCKER)("plugins stage on a throwaway site (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8195 };
  let ctx: SiteContext;
  beforeAll(async () => {
    await initSite(config, { slug: "itplugins", briefPath: "fixtures/briefs/boulangerie.md" });
    ctx = loadContext(config, "itplugins");
    copyFileSync("fixtures/specs/boulangerie.site-spec.json", artifactPath(ctx, "siteSpecJson"));
    copyFileSync("fixtures/specs/boulangerie.design-tokens.json", artifactPath(ctx, "designTokensJson"));
    writeFileSync(artifactPath(ctx, "designSystemMd"), "# Maison Rivet — Design System Web\n");
    const p = await runSite(config, "itplugins", { only: "provision" });
    expect(p.stages.provision.status, p.stages.provision.message).toBe("done");
    // pages stage with stub trees (no agent) so accueil and nos-produits exist with their wrappers
    vi.spyOn(pagesDeps, "generatePageTree").mockImplementation(async (c, _spec, page) => {
      const tree = stubTree(page);
      writeFileSync(pageTreePath(c, page.slug), JSON.stringify(tree, null, 2));
      return { tree, costUsd: 0, attempts: 1 as const };
    });
    const pg = await runSite(config, "itplugins", { only: "pages" });
    expect(pg.stages.pages.status, pg.stages.pages.message).toBe("done");
  }, 600_000);
  afterAll(async () => { vi.restoreAllMocks(); await destroySite(config, "itplugins"); });

  it("generates (stubbed agent), verifies for real, integrates, and renders the block on both pages", async () => {
    const gen = vi.spyOn(pluginsDeps, "generatePlugin").mockImplementation(async (c, spec, feature) => {
      await actAsAgent(c);
      const v = await verifyPlugin(c, spec, feature); // the real checks: files, php_check, wp plugin/post-type/post/term lists
      return { ...v, costUsd: 0, attempts: 1 as const };
    });
    const state = await runSite(config, "itplugins", { only: "plugins" });
    expect(state.stages.plugins.status, state.stages.plugins.message).toBe("done");
    expect(state.stages.plugins.message).toContain("faktory-catalogue-produits (produit, 4 entries, 2 pages updated)");
    expect(state.stages.plugins.message).toContain("1 generated, 0 reused");
    expect(gen).toHaveBeenCalledTimes(1);

    const home = await (await fetch(`http://localhost:${ctx.state.port}/`)).text();
    expect(home).toContain('data-faktory-plugin="catalogue_produits"');
    expect(home).toContain("faktory-catalogue-produits--featured");
    expect(home).toContain("Tourte de meule");
    expect(home).not.toContain("Exemple de carte");
    expect(home).not.toContain("faktory:feature:");
    const grid = await (await fetch(`http://localhost:${ctx.state.port}/nos-produits/`)).text();
    expect(grid).toContain("faktory-catalogue-produits--grid");
    expect(grid).toContain('aria-label="Filtrer par catégorie"');
    expect(grid).toContain("Croissant pur beurre");
    const filtered = await (await fetch(`http://localhost:${ctx.state.port}/nos-produits/?categorie_produit=pains`)).text();
    expect(filtered).toContain("Tourte de meule");
    expect(filtered).not.toContain("Croissant pur beurre");
    expect(grid).toContain("faktory-catalogue-produits/style.css"); // block style enqueued

    // the tree on disk still carries the placeholder wrapper (compile-time substitution)
    expect(readFileSync(pageTreePath(ctx, "accueil"), "utf8")).toContain(FEATURE_WRAPPER_ATTR);
    // admin side: CPT registered with the 4 terms
    const terms = await wpJson<{ name: string }[]>(ctx, ["term", "list", "categorie_produit", "--fields=name"]);
    expect(terms.map((t) => t.name).sort()).toEqual(["Pains", "Pâtisseries", "Salé du midi", "Viennoiseries"]);
  });

  it("reuses the plugin on a second run (no agent) and the pages stage keeps the block", async () => {
    const gen = vi.spyOn(pluginsDeps, "generatePlugin").mockRejectedValue(new Error("must not be called"));
    const state = await runSite(config, "itplugins", { only: "plugins" });
    expect(state.stages.plugins.status, state.stages.plugins.message).toBe("done");
    expect(state.stages.plugins.message).toContain("0 generated, 1 reused");
    expect(gen).not.toHaveBeenCalled();
    const pg = await runSite(config, "itplugins", { only: "pages" });
    expect(pg.stages.pages.message).toContain("plugins applied (catalogue_produits)");
    const home = await (await fetch(`http://localhost:${ctx.state.port}/`)).text();
    expect(home).toContain('data-faktory-plugin="catalogue_produits"');
    expect(existsSync(pluginDirPath(ctx, "catalogue_produits"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it against Docker**

Run: `FAKTORY_DOCKER=1 npx vitest run tests/integration/plugins.test.ts --testTimeout=600000 --hookTimeout=600000`
Expected: PASS. Likely first-run failures and their fixes: (a) `verifyPlugin` fails on `php_check` → PHPStan not installed: run `npm run setup-phpstan`; (b) the block renders nothing → `register_block_type` path or `index.asset.php` issue: check `wp block list`-free debugging via `wp eval` is forbidden for agents but allowed for you in a shell: `docker compose -p faktory-itplugins -f docker/docker-compose.yml exec -T wpcli wp eval 'var_dump(WP_Block_Type_Registry::get_instance()->is_registered("faktory/catalogue-produits"));'`; (c) filter link test fails because the term slug is `pains` (WordPress slugifies) — that is what the test uses; if `Pâtisseries` becomes `patisseries` nothing in the test depends on it. The `wp-content/plugins/` bind mount is owned by the host user: if the wordpress container cannot read the plugin, `chmod -R a+rX` the fixture copy in `actAsAgent`.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/plugins.test.ts
git commit -m "test(faktory): docker integration — reference plugin activated, seeded and rendered in stub pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

---

### Task 10: README, end-to-end on the boulangerie site, memory

**Files:**
- Modify: `README.md`, `/Users/khelil/.claude/projects/-Users-khelil-Developer-partikuls/memory/faktory-project-state.md`, `MEMORY.md` line

- [ ] **Step 1: Update `README.md`**

Setup: add `npm run setup-phpstan   # composer install into tools/phpstan (php + composer on the host), needed by the plugins stage` after `npm run sync-skills`. Usage: add `npm run faktory -- run boulangerie --only plugins --max-cost 30` with the comment `# one agent per feature: writes wp-content/plugins/faktory-<id>/, php_check, activates, seeds, then inserts the block into the pages`. Artifacts table: add rows

| `plugins/<id>.json` | plugins stage | Manifest (block, shortcode, one block placement per page). Delete it to regenerate the plugin; edit `placements` and re-run `--only plugins` (or `--only pages`) to change how the block is inserted without any LLM call. |
| `wp-content/plugins/faktory-<kebab>/` | plugins stage | The plugin itself (bind-mounted into WordPress). Hand-edit it, then `--only plugins` re-runs php_check and the checks. |

Replace the "Markers for later stages" paragraph with: markers and wrappers stay in `pages/<slug>.gb.json` forever; at compile time Faktory replaces each `data-faktory-feature` wrapper with the placement from `plugins/<id>.json` (pages and plugins stages alike), so regenerating a page never loses the plugin; `data-faktory-form` wrappers wait for the content stage. Add a "Plugin contract" subsection: the file list, naming rules (from the Global Constraints "Naming derived from a feature id" line), the `data-faktory-plugin` attribute, "PHP only, no build step, `index.js` uses the `wp.*` globals", "first image field = featured image", and that `fixtures/plugins/faktory-catalogue-produits/` is the reference the agent copies. Stages line: `Phase 4 implements plugins`; only `content`, `qa`, `export` are skipped. Cost paragraph: leave a `plugins ≈ $<measured>` placeholder to fill in Step 3.

- [ ] **Step 2: Unit suite, typecheck, doctor**

Run: `npm test && npm run typecheck && npm run faktory -- doctor`
Expected: all green, doctor shows `✔ php`, `✔ composer`, `✔ phpstan`.

- [ ] **Step 3: End to end on the live boulangerie site (port 8101)**

Per the phase 3 handover, the 5 trees predate the wrapper convention:
```bash
rm sites/boulangerie/pages/*.gb.json
npm run faktory -- run boulangerie --only pages --max-cost 20
npm run faktory -- run boulangerie --only plugins --max-cost 30
```
Expected: `✔ pages — 5 pages published …` then `✔ plugins — 1 plugin: faktory-produits (produit, N entries, 2 pages updated); 1 generated, 0 reused — $<cost>`. Note the cost and the retry count (`↻ plugins:` lines). Then verify in Chrome (tabs_context first, new tab): `http://localhost:8101/wp-admin/edit.php?post_type=produit` (log in with `admin` / password from `sites/boulangerie/faktory.json`): products listed with thumbnail, price, availability and category columns; open one product: the meta box shows the fields; `http://localhost:8101/` shows 4 products in the featured block, no example cards; `http://localhost:8101/nos-produits/` shows the full grid with category filter links that work; at 390 px width the grid is one column. If the agent's plugin fails a check twice, read `sites/boulangerie/wp-content/plugins/faktory-produits/` and the `↻` line, fix the prompt or the reference plugin, `rm sites/boulangerie/plugins/produits.json`, re-run `--only plugins`, and commit the fix separately.

- [ ] **Step 4: Record the measured cost and commit**

```bash
git add README.md
git commit -m "docs(faktory): phase 4 plugins stage usage, contract and measured cost

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LStg5xdyFKEL6V4rV5tUMA"
```

- [ ] **Step 5: Update the project memory**

In `faktory-project-state.md`: phase 4 plan path and branch; decisions 1-8 of this plan; the measured cost per feature and cumulative site cost; the phase 4 handover items for phase 5 (content stage: replace `data-faktory-form` wrappers the same way via a `forms/<id>.json`-style manifest and `applyPlugins`-like substitution; Gravity Forms import), plus what stays deferred (budget split, GB Pro header, title refresh, Fraunces, `--from/--only` checkpoint warning). Keep the `MEMORY.md` line current. Then merge: `git checkout main && git merge --ff-only faktory/phase4 && git branch -d faktory/phase4` and push the subtree: `cd /Users/khelil/Developer/partikuls && git subtree push --prefix=faktory faktory main`.

---

## Self-review

- **Spec coverage.** Decision 1 (compile-time substitution, both stages): Task 4 (`applyPlugins` + pages stage) and Task 7 (`integratePlugin`) ✔. Decision 2 (sequential, `assertBudget` before each agent): Task 8 ✔. Decision 3 (tools, no Bash, deliverables, activation + seed by the agent): Task 6 `PLUGINS_TOOLS`, prompt steps 3-5 ✔. Decision 4 (validation order: manifest → files → php_check → hex CSS → active → post type → ≥3 entries → terms → placements/denylist; integration + HTTP check): Task 3 `validatePluginManifest` (placements, denylist, block-comment form), Task 6 `verifyPlugin` (the rest), Task 7 (HTTP check) ✔. Decision 5 (reuse, poisoned manifest deleted): Task 8 reuse path, Task 6 `generatePlugin` catch ✔. Decision 6 (`php_check`, composer toolchain, doctor, explicit failure without PHPStan): Task 1 ✔. Decision 7 (`writeRoots`): Task 5, used in Task 6 ✔. Decision 8 (PHP-only plugin, plain-JS block, featured image): Task 2 fixture + prompt rules ✔. « Contrat de plugin » table: Task 2 files (+ `index.asset.php`, needed for the editor script dependencies, added to `requiredPluginFiles` in Task 3 — an addition to the spec table, not a contradiction). « Manifeste » schema: Task 3 ✔. « Prompt » section: Task 6 Step 1 ✔. « Fichiers » table: every row has a task (`src/php.ts` T1, `tools/server.ts` T1, `agent.ts` T5, `pages/generate.ts` T5, `plugin-manifest.ts` T3, `apply-plugins.ts` T4, `pages/publish.ts` unchanged — `compilePage` already takes any tree, T4 changes the caller instead, `plugins/generate.ts` T6, `plugins/integrate.ts` T7, `stages/plugins.ts` + `pipeline.ts` T8, prompts T6, `cli.ts` T1, fixtures T2, tests T1-T9, README/memory T10) ✔. « Vérification de bout en bout »: Task 10 Step 3 ✔.
- **Placeholders.** The only intentional one is the README cost figure (`$<measured>`) filled in Task 10 Step 4 after the live run. Every other step carries code or an exact command.
- **Type consistency.** `phpCheck(config, dir) → { ok, output, files }` (T1) used in T6 `verifyPlugin` and mocked with the same shape in T6/T9 tests ✔. `writeGuard(siteDir, roots?)` / `AgentOptions.writeRoots` (T5) used by T6 ✔. `parsePluginManifest`, `assertPluginManifest(m, spec, feature)`, `placementPages`, `manifestPath/Rel`, `pluginDirPath/Rel`, `pluginSlug`, `blockName`, `shortcodeName`, `requiredPluginFiles`, `RENDER_ATTR`, `PLUGINS_DIR`, `kebab` (T3) used identically in T4, T6, T7, T8, T9 ✔. `applyPlugins(tree, manifests, slug) → { tree, applied }` and `readPluginManifests(ctx)` (T4) used in T7 and the pages stage ✔. `verifyPlugin → { manifest, entries }`, `generatePlugin → { manifest, entries, costUsd, attempts }` (T6) match T8's destructuring and T9's stub ✔. `integratePlugin(ctx, spec, manifest, ids) → { pages, skipped }` (T7) matches T8 ✔. `Feature` type exported in T3 is imported in T6 ✔. Stage message format in T8 matches the T9 `toContain` assertions ("faktory-catalogue-produits (produit, 4 entries, 2 pages updated)", "1 generated, 0 reused") ✔.
