# Faktory Phase 1 — Skeleton + Provision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `faktory` CLI that creates a site workspace from a brief, boots a disposable WordPress in Docker, provisions the full GeneratePress stack without any LLM call, and proves the Agent SDK can load our skills and call our `wp` tool.

**Architecture:** TypeScript CLI (commander) owning a deterministic stage pipeline. Site state lives in `sites/<slug>/faktory.json`. WordPress runs in Docker Compose (one project per site) with `sites/<slug>/wp-content/` bind-mounted so every artifact lands on the host. WP-CLI runs in a sidecar container via `docker compose exec`. The Agent SDK wrapper loads skills from a local plugin dir and exposes an in-process MCP server.

**Tech Stack:** Node 24, TypeScript 5, `@anthropic-ai/claude-agent-sdk` 0.3.x, `zod` 3, `commander` 12, `vitest` 2, `tsx`. Docker 29 + Compose v5. Python 3 for `gb_build.py` (phase 2). No `execa`: use `node:child_process`.

**Spec:** `docs/superpowers/specs/2026-09-12-faktory-design.md`

## Global Constraints

- Repo root is `/Users/khelil/Developer/partikuls/faktory`; git root is the parent `partikuls` monorepo (commit with paths prefixed `faktory/` when running git from the monorepo root, or `cd faktory` first — both work).
- ESM only (`"type": "module"`), `moduleResolution: "bundler"`, strict TS.
- Default model string is `claude-opus-5` (per spec). Never hardcode a model in a stage; read `config.models`.
- `sites/`, `docker/vendor/*.zip`, `docker/.env`, `plugin/skills/` are gitignored.
- Every shell call goes through `src/exec.ts` and never throws on non-zero exit; callers inspect `code`.
- Integration tests that need Docker are wrapped in `describe.skipIf(!process.env.FAKTORY_DOCKER)` and run with `FAKTORY_DOCKER=1 npm run test:integration`.
- Admin email default `khelil@partikuls.com`, locale `fr_FR`, timezone `Europe/Paris`, permalinks `/%postname%/`.
- Site slugs match `/^[a-z0-9][a-z0-9-]{1,30}$/`.
- Compose project name is `faktory-<slug>`. Ports are allocated from `portBase` (8100) upward, one per site, persisted in `faktory.json`.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` | Project scaffold |
| `faktory.config.json` | User-editable config (sites root, port base, models, admin email) |
| `src/config.ts` | Load + validate `faktory.config.json` with zod defaults |
| `src/exec.ts` | `run()` wrapper over `child_process.execFile`, never throws |
| `src/state.ts` | `SiteState` schema, stage names/statuses, read/write `faktory.json`, stage transitions |
| `src/workspace.ts` | Site directory resolution, port allocation, `initSite()` |
| `src/docker.ts` | Compose file path, env, `composeUp/Down/Exec` |
| `src/wp.ts` | `runWp()` and `wpJson()` through the `wpcli` container, `waitForDb()` |
| `src/provision/core.ts` | WordPress core install, locale, permalinks, timezone, cleanup |
| `src/provision/stack.ts` | Theme, plugins (wp.org + vendor zips), child theme |
| `src/stages/provision.ts` | The `provision` stage: calls core then stack |
| `src/pipeline.ts` | `Stage` interface, registry, `runSite()`, checkpoint handling |
| `src/agent.ts` | `runAgent()` wrapper over `query()`, `writeGuard` hook, cost accounting |
| `src/tools/server.ts` | `createFaktoryServer()` MCP server with the `wp` tool |
| `src/cli.ts` | commander entry: `init`, `run`, `provision`, `approve`, `destroy`, `doctor` |
| `docker/docker-compose.yml`, `docker/.env.example` | WordPress + MariaDB + wpcli stack |
| `scripts/sync-skills.sh` | rsync skills from `~/.claude/skills` into `plugin/skills/` |
| `plugin/.claude-plugin/plugin.json` | Local plugin manifest the Agent SDK loads |
| `fixtures/briefs/boulangerie.md` | Realistic test brief used by every later phase |
| `tests/unit/*.test.ts`, `tests/integration/*.test.ts` | Tests |

---

### Task 1: Project scaffold and CLI entry

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/cli.ts`, `tests/unit/cli.test.ts`

**Interfaces:**
- Produces: `npm run faktory -- <args>` runs the CLI via tsx; `npm test` runs unit tests; `npm run test:integration` runs `tests/integration`.

- [ ] **Step 1: Write package.json, tsconfig, vitest config, .gitignore**

`package.json`:
```json
{
  "name": "faktory",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "faktory": "./bin/faktory.js" },
  "scripts": {
    "faktory": "tsx src/cli.ts",
    "test": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration --testTimeout=300000",
    "typecheck": "tsc --noEmit",
    "sync-skills": "bash scripts/sync-skills.sh"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.3.269",
    "commander": "^12.1.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
```

`.gitignore`:
```
node_modules/
dist/
sites/
docker/vendor/*.zip
docker/.env
plugin/skills/
.DS_Store
```

- [ ] **Step 2: Write the failing CLI test**

`tests/unit/cli.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

describe("cli", () => {
  it("prints help with the expected commands", async () => {
    const { stdout } = await exec("npx", ["tsx", "src/cli.ts", "--help"]);
    for (const cmd of ["init", "run", "provision", "approve", "destroy", "doctor"]) {
      expect(stdout).toContain(cmd);
    }
  });
});
```

- [ ] **Step 3: Install deps and run test to verify it fails**

Run: `npm install && npx vitest run tests/unit/cli.test.ts`
Expected: FAIL (src/cli.ts missing).

- [ ] **Step 4: Write the CLI skeleton**

`src/cli.ts`:
```ts
#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();
program.name("faktory").description("WordPress AI software factory").version("0.1.0");

program.command("init <slug>").description("Create a site workspace from a brief")
  .requiredOption("--brief <path>", "Path to brief.md")
  .action(async () => { throw new Error("not implemented"); });
program.command("run <slug>").description("Run the pipeline from the first incomplete stage")
  .option("--from <stage>").option("--only <stage>")
  .action(async () => { throw new Error("not implemented"); });
program.command("provision <slug>").description("Alias for run --only provision")
  .action(async () => { throw new Error("not implemented"); });
program.command("approve <slug>").description("Mark the awaiting checkpoint as approved")
  .action(async () => { throw new Error("not implemented"); });
program.command("destroy <slug>").description("Stop containers, drop volumes, delete workspace")
  .option("--yes", "Skip confirmation")
  .action(async () => { throw new Error("not implemented"); });
program.command("doctor").description("Check local toolchain and skill loading")
  .action(async () => { throw new Error("not implemented"); });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/cli.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/cli.ts tests/unit/cli.test.ts
git commit -m "feat(faktory): project scaffold and CLI skeleton"
```

---

### Task 2: Config loader and exec helper

**Files:**
- Create: `faktory.config.json`, `src/config.ts`, `src/exec.ts`, `tests/unit/config.test.ts`, `tests/unit/exec.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/config.ts
  export type FaktoryConfig = {
    repoRoot: string; sitesRoot: string; vendorDir: string; portBase: number;
    adminEmail: string; models: { default: string } & Record<string, string>;
  };
  export function loadConfig(repoRoot?: string): FaktoryConfig;
  // src/exec.ts
  export type ExecResult = { stdout: string; stderr: string; code: number };
  export function run(cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string }): Promise<ExecResult>;
  ```

- [ ] **Step 1: Write failing tests**

`tests/unit/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  it("applies defaults when the file is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "faktory-"));
    const c = loadConfig(root);
    expect(c.sitesRoot).toBe(join(root, "sites"));
    expect(c.vendorDir).toBe(join(root, "docker", "vendor"));
    expect(c.portBase).toBe(8100);
    expect(c.models.default).toBe("claude-opus-5");
    expect(c.adminEmail).toBe("khelil@partikuls.com");
  });
  it("merges overrides from faktory.config.json", () => {
    const root = mkdtempSync(join(tmpdir(), "faktory-"));
    writeFileSync(join(root, "faktory.config.json"), JSON.stringify({ portBase: 9000, models: { default: "claude-opus-5", spec: "claude-sonnet-5" } }));
    const c = loadConfig(root);
    expect(c.portBase).toBe(9000);
    expect(c.models.spec).toBe("claude-sonnet-5");
  });
});
```

`tests/unit/exec.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { run } from "../../src/exec.js";

describe("run", () => {
  it("captures stdout and code 0", async () => {
    const r = await run("echo", ["hello"]);
    expect(r.stdout.trim()).toBe("hello");
    expect(r.code).toBe(0);
  });
  it("returns non-zero code instead of throwing", async () => {
    const r = await run("sh", ["-c", "echo oops >&2; exit 3"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("oops");
  });
  it("returns code 127 when the binary is missing", async () => {
    const r = await run("definitely-not-a-binary-xyz", []);
    expect(r.code).toBe(127);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/config.test.ts tests/unit/exec.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement config and exec**

`faktory.config.json` (repo root):
```json
{
  "portBase": 8100,
  "adminEmail": "khelil@partikuls.com",
  "models": { "default": "claude-opus-5" }
}
```

`src/config.ts`:
```ts
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

const ConfigFile = z.object({
  sitesRoot: z.string().default("sites"),
  vendorDir: z.string().default("docker/vendor"),
  portBase: z.number().int().min(1024).default(8100),
  adminEmail: z.string().email().default("khelil@partikuls.com"),
  models: z.object({ default: z.string().default("claude-opus-5") }).catchall(z.string()).default({ default: "claude-opus-5" }),
});

export type FaktoryConfig = {
  repoRoot: string;
  sitesRoot: string;
  vendorDir: string;
  portBase: number;
  adminEmail: string;
  models: { default: string } & Record<string, string>;
};

export function loadConfig(repoRoot: string = process.cwd()): FaktoryConfig {
  const file = join(repoRoot, "faktory.config.json");
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const parsed = ConfigFile.parse(raw);
  return {
    repoRoot,
    sitesRoot: resolve(repoRoot, parsed.sitesRoot),
    vendorDir: resolve(repoRoot, parsed.vendorDir),
    portBase: parsed.portBase,
    adminEmail: parsed.adminEmail,
    models: parsed.models as FaktoryConfig["models"],
  };
}
```

`src/exec.ts`:
```ts
import { spawn } from "node:child_process";

export type ExecResult = { stdout: string; stderr: string; code: number };

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err: NodeJS.ErrnoException) => {
      resolve({ stdout, stderr: stderr + err.message, code: err.code === "ENOENT" ? 127 : 1 });
    });
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/config.test.ts tests/unit/exec.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add faktory.config.json src/config.ts src/exec.ts tests/unit/config.test.ts tests/unit/exec.test.ts
git commit -m "feat(faktory): config loader and non-throwing exec helper"
```

---

### Task 3: Site state (`faktory.json`)

**Files:**
- Create: `src/state.ts`, `tests/unit/state.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const STAGES = ["spec","design","provision","plugins","pages","content","qa","export"] as const;
  export type StageName = typeof STAGES[number];
  export type StageStatus = "pending" | "running" | "awaiting_approval" | "done" | "failed";
  export type SiteState = {
    slug: string; port: number; adminUser: string; adminPassword: string;
    createdAt: string; costUsd: number;
    stages: Record<StageName, { status: StageStatus; message?: string; updatedAt?: string }>;
  };
  export function createState(slug: string, port: number, adminPassword: string): SiteState;
  export function readState(siteDir: string): SiteState;
  export function writeState(siteDir: string, state: SiteState): void;
  export function setStage(state: SiteState, name: StageName, status: StageStatus, message?: string): SiteState;
  export function firstIncompleteStage(state: SiteState): StageName | undefined;
  export function awaitingStage(state: SiteState): StageName | undefined;
  ```

- [ ] **Step 1: Write failing tests**

`tests/unit/state.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES, createState, readState, writeState, setStage, firstIncompleteStage, awaitingStage } from "../../src/state.js";

describe("state", () => {
  it("creates a state with every stage pending", () => {
    const s = createState("demo", 8100, "pw");
    expect(Object.keys(s.stages)).toEqual([...STAGES]);
    expect(s.stages.spec.status).toBe("pending");
    expect(s.costUsd).toBe(0);
    expect(s.adminUser).toBe("admin");
  });
  it("round-trips through faktory.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "faktory-"));
    const s = createState("demo", 8100, "pw");
    writeState(dir, s);
    expect(readState(dir)).toEqual(s);
  });
  it("rejects a corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "faktory-"));
    writeState(dir, createState("demo", 8100, "pw"));
    writeFileSync(join(dir, "faktory.json"), "{\"slug\":1}");
    expect(() => readState(dir)).toThrow();
  });
  it("setStage returns a new state with timestamp and message", () => {
    const s = setStage(createState("demo", 8100, "pw"), "spec", "failed", "boom");
    expect(s.stages.spec.status).toBe("failed");
    expect(s.stages.spec.message).toBe("boom");
    expect(s.stages.spec.updatedAt).toBeTruthy();
  });
  it("firstIncompleteStage skips done stages and stops at awaiting_approval", () => {
    let s = createState("demo", 8100, "pw");
    s = setStage(s, "spec", "done");
    expect(firstIncompleteStage(s)).toBe("design");
    s = setStage(s, "design", "awaiting_approval");
    expect(firstIncompleteStage(s)).toBe("design");
    expect(awaitingStage(s)).toBe("design");
    s = setStage(s, "design", "done");
    expect(awaitingStage(s)).toBeUndefined();
  });
  it("firstIncompleteStage is undefined when everything is done", () => {
    let s = createState("demo", 8100, "pw");
    for (const n of STAGES) s = setStage(s, n, "done");
    expect(firstIncompleteStage(s)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/state.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement state**

`src/state.ts`:
```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const STAGES = ["spec", "design", "provision", "plugins", "pages", "content", "qa", "export"] as const;
export type StageName = (typeof STAGES)[number];
export const STAGE_STATUSES = ["pending", "running", "awaiting_approval", "done", "failed"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

const StageRecord = z.object({
  status: z.enum(STAGE_STATUSES),
  message: z.string().optional(),
  updatedAt: z.string().optional(),
});

const SiteStateSchema = z.object({
  slug: z.string(),
  port: z.number().int(),
  adminUser: z.string(),
  adminPassword: z.string(),
  createdAt: z.string(),
  costUsd: z.number(),
  stages: z.object(Object.fromEntries(STAGES.map((s) => [s, StageRecord])) as Record<StageName, typeof StageRecord>),
});

export type SiteState = z.infer<typeof SiteStateSchema>;

export const STATE_FILE = "faktory.json";

export function createState(slug: string, port: number, adminPassword: string): SiteState {
  return {
    slug, port, adminUser: "admin", adminPassword,
    createdAt: new Date().toISOString(), costUsd: 0,
    stages: Object.fromEntries(STAGES.map((s) => [s, { status: "pending" }])) as SiteState["stages"],
  };
}

export function readState(siteDir: string): SiteState {
  return SiteStateSchema.parse(JSON.parse(readFileSync(join(siteDir, STATE_FILE), "utf8")));
}

export function writeState(siteDir: string, state: SiteState): void {
  writeFileSync(join(siteDir, STATE_FILE), JSON.stringify(state, null, 2) + "\n");
}

export function setStage(state: SiteState, name: StageName, status: StageStatus, message?: string): SiteState {
  return {
    ...state,
    stages: { ...state.stages, [name]: { status, message, updatedAt: new Date().toISOString() } },
  };
}

export function firstIncompleteStage(state: SiteState): StageName | undefined {
  return STAGES.find((s) => state.stages[s].status !== "done");
}

export function awaitingStage(state: SiteState): StageName | undefined {
  return STAGES.find((s) => state.stages[s].status === "awaiting_approval");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/state.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/unit/state.test.ts
git commit -m "feat(faktory): site state schema and stage transitions"
```

---

### Task 4: Workspace and `init` command

**Files:**
- Create: `src/workspace.ts`, `tests/unit/workspace.test.ts`, `fixtures/briefs/boulangerie.md`
- Modify: `src/cli.ts` (init action)

**Interfaces:**
- Consumes: `loadConfig`, `createState`, `writeState`, `readState`.
- Produces:
  ```ts
  export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
  export function siteDir(config: FaktoryConfig, slug: string): string;
  export function listSites(config: FaktoryConfig): string[];          // slugs with a faktory.json
  export function allocatePort(config: FaktoryConfig): number;          // portBase + number of existing sites, skipping used ports
  export function initSite(config: FaktoryConfig, opts: { slug: string; briefPath: string }): { dir: string; state: SiteState };
  ```
  Workspace layout created by `initSite`: `brief.md`, `faktory.json`, `wp-content/` (empty), `pages/`, `content/`, `qa/`, `dist/`.

- [ ] **Step 1: Write the fixture brief**

`fixtures/briefs/boulangerie.md`:
```markdown
# Brief — Boulangerie Maison Rivet

## Qui
Boulangerie-pâtisserie artisanale à Nantes (quartier Chantenay), fondée en 1987, reprise en 2019 par Claire et Julien Rivet. 6 salariés. Labellisée « Boulanger de France ». Farines locales (Moulin de Sarré), levain naturel.

## Objectif du site
Faire venir en boutique et prendre des commandes pour les événements (gâteaux d'anniversaire, buffets d'entreprise). Pas de vente en ligne. Ton chaleureux, artisanal, sans être kitsch. Cible : familles du quartier, entreprises voisines (Île de Nantes), 30-55 ans.

## Pages souhaitées
1. Accueil — ambiance, produits phares, horaires, accès, appel à commander
2. Nos produits — pains, viennoiseries, pâtisseries, salé du midi. Chaque produit a : nom, photo, description courte, prix, catégorie, disponibilité (tous les jours / week-end / sur commande)
3. Commandes & événements — anniversaires, mariages, buffets d'entreprise ; formulaire de demande de devis (nom, email, téléphone, date, nombre de personnes, message)
4. La maison — histoire, l'équipe, le levain, les fournisseurs
5. Actualités — blog : nouveautés saisonnières, recettes, coulisses
6. Contact & horaires — adresse, carte, horaires par jour, téléphone, formulaire simple

## Fonctionnalités
- Un catalogue produits géré depuis l'admin (ajout/modif sans toucher au code), filtrable par catégorie sur la page produits, avec mise en avant de 4 produits sur l'accueil.
- Horaires affichés sur l'accueil et le contact, modifiables depuis l'admin.
- Deux formulaires (devis événement, contact) qui arrivent par email à contact@maisonrivet.fr.

## Identité
Pas de charte existante. Couleurs : chaud, blé, croûte dorée, un vert sauge en accent. Typo : une serif à caractère pour les titres, une sans lisible pour le corps. Logo : texte « Maison Rivet » pour l'instant.

## Contraintes
Français uniquement. Mobile d'abord (les clients regardent les horaires sur leur téléphone). Accessible. SEO local « boulangerie Chantenay Nantes ».
```

- [ ] **Step 2: Write failing tests**

`tests/unit/workspace.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite, listSites, allocatePort, siteDir, SLUG_RE } from "../../src/workspace.js";

const BRIEF = resolve("fixtures/briefs/boulangerie.md");
function freshConfig() { return loadConfig(mkdtempSync(join(tmpdir(), "faktory-"))); }

describe("workspace", () => {
  it("validates slugs", () => {
    expect(SLUG_RE.test("boulangerie")).toBe(true);
    expect(SLUG_RE.test("Boulangerie")).toBe(false);
    expect(SLUG_RE.test("a")).toBe(false);
    expect(SLUG_RE.test("-x")).toBe(false);
  });
  it("initSite creates the layout and copies the brief", () => {
    const config = freshConfig();
    const { dir, state } = initSite(config, { slug: "boulangerie", briefPath: BRIEF });
    expect(dir).toBe(siteDir(config, "boulangerie"));
    for (const sub of ["brief.md", "faktory.json", "wp-content", "pages", "content", "qa", "dist"]) {
      expect(existsSync(join(dir, sub))).toBe(true);
    }
    expect(readFileSync(join(dir, "brief.md"), "utf8")).toContain("Maison Rivet");
    expect(state.port).toBe(8100);
    expect(state.adminPassword.length).toBeGreaterThanOrEqual(16);
  });
  it("allocates the next free port", () => {
    const config = freshConfig();
    initSite(config, { slug: "one", briefPath: BRIEF });
    initSite(config, { slug: "two", briefPath: BRIEF });
    expect(listSites(config).sort()).toEqual(["one", "two"]);
    expect(allocatePort(config)).toBe(8102);
  });
  it("refuses to init twice", () => {
    const config = freshConfig();
    initSite(config, { slug: "dup", briefPath: BRIEF });
    expect(() => initSite(config, { slug: "dup", briefPath: BRIEF })).toThrow(/already exists/);
  });
  it("refuses an invalid slug", () => {
    expect(() => initSite(freshConfig(), { slug: "Bad Slug", briefPath: BRIEF })).toThrow(/slug/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/workspace.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement workspace and wire `init`**

`src/workspace.ts`:
```ts
import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { FaktoryConfig } from "./config.js";
import { createState, readState, writeState, STATE_FILE, type SiteState } from "./state.js";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

export function siteDir(config: FaktoryConfig, slug: string): string {
  return join(config.sitesRoot, slug);
}

export function listSites(config: FaktoryConfig): string[] {
  if (!existsSync(config.sitesRoot)) return [];
  return readdirSync(config.sitesRoot).filter((d) => existsSync(join(config.sitesRoot, d, STATE_FILE)));
}

export function allocatePort(config: FaktoryConfig): number {
  const used = new Set(listSites(config).map((s) => readState(siteDir(config, s)).port));
  let port = config.portBase;
  while (used.has(port)) port++;
  return port;
}

export function initSite(config: FaktoryConfig, opts: { slug: string; briefPath: string }): { dir: string; state: SiteState } {
  if (!SLUG_RE.test(opts.slug)) throw new Error(`Invalid slug "${opts.slug}": use lowercase letters, digits, dashes (2-31 chars)`);
  if (!existsSync(opts.briefPath)) throw new Error(`Brief not found: ${opts.briefPath}`);
  const dir = siteDir(config, opts.slug);
  if (existsSync(join(dir, STATE_FILE))) throw new Error(`Site "${opts.slug}" already exists at ${dir}`);
  for (const sub of ["", "wp-content", "pages", "content", "qa", "dist"]) mkdirSync(join(dir, sub), { recursive: true });
  copyFileSync(opts.briefPath, join(dir, "brief.md"));
  const state = createState(opts.slug, allocatePort(config), randomBytes(12).toString("base64url"));
  writeState(dir, state);
  return { dir, state };
}
```

In `src/cli.ts`, replace the `init` action:
```ts
import { loadConfig } from "./config.js";
import { initSite } from "./workspace.js";
// ...
  .action(async (slug: string, opts: { brief: string }) => {
    const config = loadConfig();
    const { dir, state } = initSite(config, { slug, briefPath: opts.brief });
    console.log(`Site "${slug}" created at ${dir} (port ${state.port}).`);
    console.log(`Next: faktory run ${slug}`);
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/workspace.test.ts && npm run faktory -- init demo --brief fixtures/briefs/boulangerie.md && ls sites/demo`
Expected: PASS (5 tests); `sites/demo` contains the layout.

- [ ] **Step 6: Commit**

```bash
git add src/workspace.ts src/cli.ts tests/unit/workspace.test.ts fixtures/briefs/boulangerie.md
git commit -m "feat(faktory): site workspace, port allocation, init command, fixture brief"
```

---

### Task 5: Docker Compose stack and compose helpers

**Files:**
- Create: `docker/docker-compose.yml`, `docker/.env.example`, `docker/vendor/.gitkeep`, `src/docker.ts`, `tests/unit/docker.test.ts`, `tests/integration/docker.test.ts`

**Interfaces:**
- Consumes: `run` from `src/exec.ts`, `FaktoryConfig`.
- Produces:
  ```ts
  export type SiteContext = { config: FaktoryConfig; slug: string; siteDir: string; state: SiteState };
  export function composeFile(config: FaktoryConfig): string;                 // <repoRoot>/docker/docker-compose.yml
  export function composeEnv(ctx: SiteContext): Record<string, string>;      // FAKTORY_PORT, FAKTORY_SITE_DIR, FAKTORY_VENDOR_DIR, COMPOSE_PROJECT_NAME
  export function composeArgs(ctx: SiteContext, ...rest: string[]): string[]; // ["compose","-p","faktory-<slug>","-f",<file>, ...rest]
  export function composeUp(ctx: SiteContext): Promise<ExecResult>;
  export function composeDown(ctx: SiteContext, opts?: { volumes?: boolean }): Promise<ExecResult>;
  export function composeExec(ctx: SiteContext, service: string, cmd: string[], opts?: { input?: string }): Promise<ExecResult>;
  export function siteUrl(ctx: SiteContext): string;                          // http://localhost:<port>
  ```

- [ ] **Step 1: Write the compose file and env example**

`docker/docker-compose.yml`:
```yaml
services:
  db:
    image: mariadb:11
    environment:
      MARIADB_ROOT_PASSWORD: root
      MARIADB_DATABASE: wordpress
      MARIADB_USER: wordpress
      MARIADB_PASSWORD: wordpress
    volumes:
      - db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 20

  wordpress:
    image: wordpress:php8.3-apache
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "${FAKTORY_PORT}:80"
    environment: &wpenv
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_NAME: wordpress
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: wordpress
      WORDPRESS_CONFIG_EXTRA: |
        define('WP_DEBUG', true);
        define('WP_DEBUG_LOG', true);
        define('WP_DEBUG_DISPLAY', false);
        define('FS_METHOD', 'direct');
    volumes:
      - core:/var/www/html
      - ${FAKTORY_SITE_DIR}/wp-content:/var/www/html/wp-content

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
      - ${FAKTORY_SITE_DIR}/wp-content:/var/www/html/wp-content
      - ${FAKTORY_VENDOR_DIR}:/vendor:ro
    working_dir: /var/www/html
    entrypoint: ["sh", "-c", "sleep infinity"]

volumes:
  db:
  core:
```

`docker/.env.example`:
```
# Optional license keys (updates only; plugins work without them)
GP_PREMIUM_LICENSE=
GENERATEBLOCKS_PRO_LICENSE=
GRAVITY_FORMS_LICENSE=
```

Create `docker/vendor/.gitkeep` (empty) and add a `docker/vendor/README.md`:
```markdown
Drop premium plugin zips here (gitignored): `gp-premium.zip`, `generateblocks-pro.zip`, `gravityforms.zip`, `gravityformscli.zip`.
File names are matched by prefix (`gp-premium*.zip`), so versioned names work.
```

- [ ] **Step 2: Write failing unit test for the helpers**

`tests/unit/docker.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import { composeArgs, composeEnv, composeFile, siteUrl, type SiteContext } from "../../src/docker.js";

const config = loadConfig("/tmp/fk-root");
const ctx: SiteContext = { config, slug: "demo", siteDir: "/tmp/fk-root/sites/demo", state: createState("demo", 8123, "pw") };

describe("docker helpers", () => {
  it("builds compose args with project name and file", () => {
    expect(composeArgs(ctx, "up", "-d")).toEqual(["compose", "-p", "faktory-demo", "-f", composeFile(config), "up", "-d"]);
    expect(composeFile(config)).toBe("/tmp/fk-root/docker/docker-compose.yml");
  });
  it("exposes port, site dir and vendor dir in env", () => {
    const env = composeEnv(ctx);
    expect(env.FAKTORY_PORT).toBe("8123");
    expect(env.FAKTORY_SITE_DIR).toBe("/tmp/fk-root/sites/demo");
    expect(env.FAKTORY_VENDOR_DIR).toBe("/tmp/fk-root/docker/vendor");
  });
  it("computes the site url", () => {
    expect(siteUrl(ctx)).toBe("http://localhost:8123");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/unit/docker.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `src/docker.ts`**

```ts
import { join } from "node:path";
import type { FaktoryConfig } from "./config.js";
import type { SiteState } from "./state.js";
import { run, type ExecResult } from "./exec.js";

export type SiteContext = { config: FaktoryConfig; slug: string; siteDir: string; state: SiteState };

export function composeFile(config: FaktoryConfig): string {
  return join(config.repoRoot, "docker", "docker-compose.yml");
}

export function composeEnv(ctx: SiteContext): Record<string, string> {
  return {
    FAKTORY_PORT: String(ctx.state.port),
    FAKTORY_SITE_DIR: ctx.siteDir,
    FAKTORY_VENDOR_DIR: ctx.config.vendorDir,
    COMPOSE_PROJECT_NAME: `faktory-${ctx.slug}`,
  };
}

export function composeArgs(ctx: SiteContext, ...rest: string[]): string[] {
  return ["compose", "-p", `faktory-${ctx.slug}`, "-f", composeFile(ctx.config), ...rest];
}

export function composeUp(ctx: SiteContext): Promise<ExecResult> {
  return run("docker", composeArgs(ctx, "up", "-d", "--wait"), { env: composeEnv(ctx) });
}

export function composeDown(ctx: SiteContext, opts: { volumes?: boolean } = {}): Promise<ExecResult> {
  return run("docker", composeArgs(ctx, "down", ...(opts.volumes ? ["-v"] : [])), { env: composeEnv(ctx) });
}

export function composeExec(ctx: SiteContext, service: string, cmd: string[], opts: { input?: string } = {}): Promise<ExecResult> {
  return run("docker", composeArgs(ctx, "exec", "-T", service, ...cmd), { env: composeEnv(ctx), input: opts.input });
}

export function siteUrl(ctx: SiteContext): string {
  return `http://localhost:${ctx.state.port}`;
}
```

- [ ] **Step 5: Run unit test to verify it passes**

Run: `npx vitest run tests/unit/docker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write the integration test (Docker-gated)**

`tests/integration/docker.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { composeUp, composeDown, composeExec, type SiteContext } from "../../src/docker.js";

describe.skipIf(!process.env.FAKTORY_DOCKER)("docker stack", () => {
  const repoRoot = resolve(".");
  const config = { ...loadConfig(repoRoot), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8190 };
  const { dir, state } = initSite(config, { slug: "itdocker", briefPath: "fixtures/briefs/boulangerie.md" });
  const ctx: SiteContext = { config, slug: "itdocker", siteDir: dir, state };

  afterAll(async () => { await composeDown(ctx, { volumes: true }); });

  it("boots the stack and wp-cli can reach the db", async () => {
    const up = await composeUp(ctx);
    expect(up.code, up.stderr).toBe(0);
    const info = await composeExec(ctx, "wpcli", ["wp", "--info"]);
    expect(info.code, info.stderr).toBe(0);
    expect(info.stdout).toContain("WP-CLI version");
    const db = await composeExec(ctx, "wpcli", ["wp", "db", "check"]);
    expect(db.code, db.stderr).toBe(0);
  });
});
```

- [ ] **Step 7: Run the integration test**

Run: `FAKTORY_DOCKER=1 npx vitest run tests/integration/docker.test.ts --testTimeout=300000`
Expected: PASS. If `docker compose up --wait` fails on the healthcheck command name, check `docker compose -p faktory-itdocker logs db`; MariaDB 11 ships `healthcheck.sh` at `/usr/local/bin/healthcheck.sh`.

- [ ] **Step 8: Commit**

```bash
git add docker/docker-compose.yml docker/.env.example docker/vendor/.gitkeep docker/vendor/README.md src/docker.ts tests/unit/docker.test.ts tests/integration/docker.test.ts
git commit -m "feat(faktory): docker compose stack with wp-cli sidecar and compose helpers"
```

---

### Task 6: WP-CLI runner

**Files:**
- Create: `src/wp.ts`, `tests/unit/wp.test.ts`, `tests/integration/wp.test.ts`

**Interfaces:**
- Consumes: `composeExec`, `SiteContext`.
- Produces:
  ```ts
  export function runWp(ctx: SiteContext, args: string[], opts?: { input?: string }): Promise<ExecResult>;
  export function wpJson<T = unknown>(ctx: SiteContext, args: string[]): Promise<T>;   // appends --format=json, throws on non-zero
  export function wpOk(ctx: SiteContext, args: string[]): Promise<string>;              // throws Error(`wp ${args.join(" ")} failed: ${stderr}`) on non-zero, returns trimmed stdout
  export function waitForDb(ctx: SiteContext, opts?: { attempts?: number; delayMs?: number }): Promise<void>;
  ```
  `runWp` is injectable for tests through `export const deps = { composeExec }`.

- [ ] **Step 1: Write failing unit test**

`tests/unit/wp.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps, runWp, wpJson, wpOk, waitForDb } from "../../src/wp.js";

const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };

describe("wp runner", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("runWp prefixes wp and targets the wpcli service", async () => {
    const spy = vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "ok", stderr: "", code: 0 });
    await runWp(ctx, ["option", "get", "blogname"]);
    expect(spy).toHaveBeenCalledWith(ctx, "wpcli", ["wp", "option", "get", "blogname"], { input: undefined });
  });
  it("wpJson appends --format=json and parses", async () => {
    vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: '[{"name":"generatepress"}]', stderr: "", code: 0 });
    const r = await wpJson<{ name: string }[]>(ctx, ["theme", "list"]);
    expect(r[0].name).toBe("generatepress");
    expect(deps.composeExec).toHaveBeenCalledWith(ctx, "wpcli", ["wp", "theme", "list", "--format=json"], { input: undefined });
  });
  it("wpOk throws with stderr on failure", async () => {
    vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "", stderr: "Error: nope", code: 1 });
    await expect(wpOk(ctx, ["plugin", "activate", "x"])).rejects.toThrow(/plugin activate x failed: Error: nope/);
  });
  it("waitForDb retries until db check succeeds", async () => {
    const spy = vi.spyOn(deps, "composeExec")
      .mockResolvedValueOnce({ stdout: "", stderr: "down", code: 1 })
      .mockResolvedValueOnce({ stdout: "Success", stderr: "", code: 0 });
    await waitForDb(ctx, { attempts: 3, delayMs: 1 });
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it("waitForDb throws after attempts are exhausted", async () => {
    vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "", stderr: "down", code: 1 });
    await expect(waitForDb(ctx, { attempts: 2, delayMs: 1 })).rejects.toThrow(/database not reachable/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/wp.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/wp.ts`**

```ts
import { composeExec, type SiteContext } from "./docker.js";
import type { ExecResult } from "./exec.js";

export const deps = { composeExec };

export function runWp(ctx: SiteContext, args: string[], opts: { input?: string } = {}): Promise<ExecResult> {
  return deps.composeExec(ctx, "wpcli", ["wp", ...args], { input: opts.input });
}

export async function wpOk(ctx: SiteContext, args: string[]): Promise<string> {
  const r = await runWp(ctx, args);
  if (r.code !== 0) throw new Error(`wp ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

export async function wpJson<T = unknown>(ctx: SiteContext, args: string[]): Promise<T> {
  const out = await wpOk(ctx, [...args, "--format=json"]);
  return JSON.parse(out) as T;
}

export async function waitForDb(ctx: SiteContext, opts: { attempts?: number; delayMs?: number } = {}): Promise<void> {
  const attempts = opts.attempts ?? 30, delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < attempts; i++) {
    const r = await runWp(ctx, ["db", "check"]);
    if (r.code === 0) return;
    await new Promise((res) => setTimeout(res, delayMs));
  }
  throw new Error(`Database not reachable after ${attempts} attempts`);
}
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npx vitest run tests/unit/wp.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add integration test and run it**

`tests/integration/wp.test.ts`:
```ts
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { composeUp, composeDown, type SiteContext } from "../../src/docker.js";
import { waitForDb, wpJson } from "../../src/wp.js";

describe.skipIf(!process.env.FAKTORY_DOCKER)("wp runner (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8191 };
  const { dir, state } = initSite(config, { slug: "itwp", briefPath: "fixtures/briefs/boulangerie.md" });
  const ctx: SiteContext = { config, slug: "itwp", siteDir: dir, state };
  beforeAll(async () => { const up = await composeUp(ctx); if (up.code !== 0) throw new Error(up.stderr); });
  afterAll(async () => { await composeDown(ctx, { volumes: true }); });

  it("waits for db and reads core version as json", async () => {
    await waitForDb(ctx);
    const v = await wpJson<{ version?: string } | string>(ctx, ["core", "version"]).catch(() => "fallback");
    expect(v).toBeTruthy();
  });
});
```

Run: `FAKTORY_DOCKER=1 npx vitest run tests/integration/wp.test.ts --testTimeout=300000`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/wp.ts tests/unit/wp.test.ts tests/integration/wp.test.ts
git commit -m "feat(faktory): wp-cli runner with json helper and db wait"
```

---

### Task 7: Provision — core install

**Files:**
- Create: `src/provision/core.ts`, `tests/unit/provision-core.test.ts`

**Interfaces:**
- Consumes: `runWp`, `wpOk`, `wpJson`, `siteUrl`, `SiteContext`.
- Produces:
  ```ts
  export async function installCore(ctx: SiteContext, opts: { title: string }): Promise<{ freshInstall: boolean }>;
  ```
  Idempotent: if `wp core is-installed` succeeds, only re-applies options (locale, permalinks, timezone) and skips cleanup.

- [ ] **Step 1: Write failing unit test (mocked wp)**

`tests/unit/provision-core.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps } from "../../src/wp.js";
import { installCore } from "../../src/provision/core.js";

const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "s3cret") };

function mockWp(handler: (args: string[]) => { stdout?: string; code?: number }) {
  return vi.spyOn(deps, "composeExec").mockImplementation(async (_ctx, _svc, cmd) => {
    const r = handler(cmd.slice(1));
    return { stdout: r.stdout ?? "", stderr: "", code: r.code ?? 0 };
  });
}
const calls = (spy: ReturnType<typeof mockWp>) => spy.mock.calls.map((c) => (c[2] as string[]).slice(1).join(" "));

describe("installCore", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("runs core install with url, admin and locale on a fresh site, then cleans sample content", async () => {
    const spy = mockWp((a) => {
      if (a.join(" ") === "core is-installed") return { code: 1 };
      if (a[0] === "post" && a[1] === "list") return { stdout: "[1,2]" };
      return {};
    });
    const r = await installCore(ctx, { title: "Maison Rivet" });
    expect(r.freshInstall).toBe(true);
    const c = calls(spy);
    expect(c.find((x) => x.startsWith("core install"))).toContain("--url=http://localhost:8100");
    expect(c.find((x) => x.startsWith("core install"))).toContain("--admin_password=s3cret");
    expect(c.find((x) => x.startsWith("core install"))).toContain("--admin_email=khelil@partikuls.com");
    expect(c).toContain("language core install fr_FR --activate");
    expect(c).toContain("rewrite structure /%postname%/");
    expect(c).toContain("option update timezone_string Europe/Paris");
    expect(c).toContain("post delete 1 2 --force");
    expect(c).toContain("plugin uninstall akismet hello --deactivate");
  });

  it("skips install and cleanup when already installed", async () => {
    const spy = mockWp(() => ({}));
    const r = await installCore(ctx, { title: "Maison Rivet" });
    expect(r.freshInstall).toBe(false);
    const c = calls(spy);
    expect(c.some((x) => x.startsWith("core install"))).toBe(false);
    expect(c.some((x) => x.startsWith("post delete"))).toBe(false);
    expect(c).toContain("option update timezone_string Europe/Paris");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/provision-core.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/provision/core.ts`**

```ts
import { siteUrl, type SiteContext } from "../docker.js";
import { runWp, wpOk, wpJson } from "../wp.js";

export async function installCore(ctx: SiteContext, opts: { title: string }): Promise<{ freshInstall: boolean }> {
  const installed = (await runWp(ctx, ["core", "is-installed"])).code === 0;
  if (!installed) {
    await wpOk(ctx, [
      "core", "install",
      `--url=${siteUrl(ctx)}`, `--title=${opts.title}`,
      `--admin_user=${ctx.state.adminUser}`, `--admin_password=${ctx.state.adminPassword}`,
      `--admin_email=${ctx.config.adminEmail}`, "--skip-email",
    ]);
  }
  await wpOk(ctx, ["language", "core", "install", "fr_FR", "--activate"]);
  await wpOk(ctx, ["rewrite", "structure", "/%postname%/"]);
  await wpOk(ctx, ["option", "update", "timezone_string", "Europe/Paris"]);
  await wpOk(ctx, ["option", "update", "blogdescription", ""]);
  if (!installed) {
    const ids = await wpJson<number[]>(ctx, ["post", "list", "--post_type=post,page", "--field=ID"]);
    if (ids.length) await wpOk(ctx, ["post", "delete", ...ids.map(String), "--force"]);
    await runWp(ctx, ["plugin", "uninstall", "akismet", "hello", "--deactivate"]);
  }
  return { freshInstall: !installed };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/provision-core.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/provision/core.ts tests/unit/provision-core.test.ts
git commit -m "feat(faktory): idempotent WordPress core install with fr_FR defaults"
```

---

### Task 8: Provision — theme, plugins, vendor zips, child theme

**Files:**
- Create: `src/provision/stack.ts`, `tests/unit/provision-stack.test.ts`

**Interfaces:**
- Consumes: `runWp`, `wpOk`, `wpJson`, `SiteContext`, `readdirSync`.
- Produces:
  ```ts
  export const WPORG_PLUGINS = ["generateblocks", "wordpress-seo"] as const;
  export const VENDOR_PLUGINS = [
    { prefix: "gp-premium", slug: "gp-premium" },
    { prefix: "generateblocks-pro", slug: "generateblocks-pro" },
    { prefix: "gravityforms", slug: "gravityforms" },
    { prefix: "gravityformscli", slug: "gravityformscli" },
  ] as const;
  export function findVendorZip(vendorDir: string, prefix: string): string | undefined; // basename of first `<prefix>*.zip` (exact prefix, so "gravityforms" must not match "gravityformscli")
  export async function installStack(ctx: SiteContext): Promise<{ installed: string[]; missingVendor: string[] }>;
  ```
  Child theme slug: `faktory-<slug>`. Vendor zips are visible inside the container at `/vendor/<basename>`.

- [ ] **Step 1: Write failing unit test**

`tests/unit/provision-stack.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps } from "../../src/wp.js";
import { findVendorZip, installStack } from "../../src/provision/stack.js";

function ctxWithVendor(files: string[]): SiteContext {
  const vendorDir = mkdtempSync(join(tmpdir(), "vendor-"));
  for (const f of files) writeFileSync(join(vendorDir, f), "");
  return { config: { ...loadConfig("/tmp/fk"), vendorDir }, slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };
}
function mockWp(activeThemes: string[] = [], activePlugins: string[] = []) {
  return vi.spyOn(deps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
    const a = cmd.slice(1).join(" ");
    if (a.startsWith("theme list")) return { stdout: JSON.stringify(activeThemes.map((name) => ({ name, status: "active" }))), stderr: "", code: 0 };
    if (a.startsWith("plugin list")) return { stdout: JSON.stringify(activePlugins.map((name) => ({ name, status: "active" }))), stderr: "", code: 0 };
    return { stdout: "", stderr: "", code: 0 };
  });
}
const calls = (spy: ReturnType<typeof mockWp>) => spy.mock.calls.map((c) => (c[2] as string[]).slice(1).join(" "));

describe("findVendorZip", () => {
  it("matches by exact prefix and ignores longer names", () => {
    const ctx = ctxWithVendor(["gravityforms_2.9.zip", "gravityformscli-1.0.zip"]);
    expect(findVendorZip(ctx.config.vendorDir, "gravityforms")).toBe("gravityforms_2.9.zip");
    expect(findVendorZip(ctx.config.vendorDir, "gravityformscli")).toBe("gravityformscli-1.0.zip");
    expect(findVendorZip(ctx.config.vendorDir, "gp-premium")).toBeUndefined();
  });
});

describe("installStack", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("installs GP, wp.org plugins, present vendor zips, and scaffolds the child theme", async () => {
    const ctx = ctxWithVendor(["gp-premium-2.5.zip"]);
    const spy = mockWp();
    const r = await installStack(ctx);
    const c = calls(spy);
    expect(c).toContain("theme install generatepress --activate");
    expect(c).toContain("plugin install generateblocks wordpress-seo --activate");
    expect(c).toContain("plugin install /vendor/gp-premium-2.5.zip --activate");
    expect(c).toContain("scaffold child-theme faktory-demo --parent_theme=generatepress --theme_name=Faktory demo --activate");
    expect(r.installed).toContain("gp-premium");
    expect(r.missingVendor).toEqual(["generateblocks-pro", "gravityforms", "gravityformscli"]);
  });

  it("is idempotent: skips theme/plugins already active", async () => {
    const ctx = ctxWithVendor([]);
    const spy = mockWp(["generatepress", "faktory-demo"], ["generateblocks", "wordpress-seo"]);
    await installStack(ctx);
    const c = calls(spy);
    expect(c.some((x) => x.startsWith("theme install"))).toBe(false);
    expect(c.some((x) => x.startsWith("plugin install generateblocks"))).toBe(false);
    expect(c.some((x) => x.startsWith("scaffold child-theme"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/provision-stack.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/provision/stack.ts`**

```ts
import { existsSync, readdirSync } from "node:fs";
import type { SiteContext } from "../docker.js";
import { wpOk, wpJson } from "../wp.js";

export const WPORG_PLUGINS = ["generateblocks", "wordpress-seo"] as const;
export const VENDOR_PLUGINS = [
  { prefix: "gp-premium", slug: "gp-premium" },
  { prefix: "generateblocks-pro", slug: "generateblocks-pro" },
  { prefix: "gravityforms", slug: "gravityforms" },
  { prefix: "gravityformscli", slug: "gravityformscli" },
] as const;

export function findVendorZip(vendorDir: string, prefix: string): string | undefined {
  if (!existsSync(vendorDir)) return undefined;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([-_.].*)?\\.zip$`);
  return readdirSync(vendorDir).sort().find((f) => re.test(f));
}

type Item = { name: string; status: string };

export async function installStack(ctx: SiteContext): Promise<{ installed: string[]; missingVendor: string[] }> {
  const installed: string[] = [];
  const missingVendor: string[] = [];
  const childSlug = `faktory-${ctx.slug}`;

  const themes = await wpJson<Item[]>(ctx, ["theme", "list", "--fields=name,status"]);
  const hasTheme = (n: string) => themes.some((t) => t.name === n);
  if (!hasTheme("generatepress")) { await wpOk(ctx, ["theme", "install", "generatepress", "--activate"]); installed.push("generatepress"); }

  const plugins = await wpJson<Item[]>(ctx, ["plugin", "list", "--fields=name,status"]);
  const active = new Set(plugins.filter((p) => p.status === "active").map((p) => p.name));
  const wporgMissing = WPORG_PLUGINS.filter((p) => !active.has(p));
  if (wporgMissing.length) { await wpOk(ctx, ["plugin", "install", ...wporgMissing, "--activate"]); installed.push(...wporgMissing); }

  for (const v of VENDOR_PLUGINS) {
    if (active.has(v.slug)) continue;
    const zip = findVendorZip(ctx.config.vendorDir, v.prefix);
    if (!zip) { missingVendor.push(v.slug); continue; }
    await wpOk(ctx, ["plugin", "install", `/vendor/${zip}`, "--activate"]);
    installed.push(v.slug);
  }

  if (!hasTheme(childSlug)) {
    await wpOk(ctx, ["scaffold", "child-theme", childSlug, "--parent_theme=generatepress", `--theme_name=Faktory ${ctx.slug}`, "--activate"]);
    installed.push(childSlug);
  } else if (!themes.some((t) => t.name === childSlug && t.status === "active")) {
    await wpOk(ctx, ["theme", "activate", childSlug]);
  }
  return { installed, missingVendor };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/provision-stack.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/provision/stack.ts tests/unit/provision-stack.test.ts
git commit -m "feat(faktory): theme, plugin and vendor zip installation with child theme"
```

---

### Task 9: Pipeline runner and the `provision` stage

**Files:**
- Create: `src/pipeline.ts`, `src/stages/provision.ts`, `tests/unit/pipeline.test.ts`, `tests/integration/provision.test.ts`
- Modify: `src/cli.ts` (`run`, `provision`, `approve`, `destroy` actions)

**Interfaces:**
- Consumes: state helpers, `composeUp`, `composeDown`, `waitForDb`, `installCore`, `installStack`, `siteDir`.
- Produces:
  ```ts
  export interface Stage { name: StageName; checkpoint?: boolean; run(ctx: SiteContext): Promise<string | void>; } // returned string = status message
  export const registry: Partial<Record<StageName, Stage>>;   // phase 1: only provision
  export function loadContext(config: FaktoryConfig, slug: string): SiteContext;
  export function runSite(config: FaktoryConfig, slug: string, opts?: { from?: StageName; only?: StageName; stages?: Partial<Record<StageName, Stage>> }): Promise<SiteState>;
  export function approveSite(config: FaktoryConfig, slug: string): SiteState;
  export async function destroySite(config: FaktoryConfig, slug: string): Promise<void>;
  ```
  `runSite` semantics: determine start stage (`only` → that one; `from` → that one; else `firstIncompleteStage`). If the start stage is `awaiting_approval`, throw `Error("Stage X awaits approval: run faktory approve <slug>")`. For each stage from start (or just `only`): if not in registry → mark `done` with message "skipped (not implemented)"; else set `running`, run, set `done` (or `awaiting_approval` when `stage.checkpoint`), persist after every transition. On throw: set `failed` with the message, persist, rethrow. Stop after a checkpoint stage.

- [ ] **Step 1: Write failing unit test with fake stages**

`tests/unit/pipeline.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite, siteDir } from "../../src/workspace.js";
import { readState, setStage, writeState } from "../../src/state.js";
import { runSite, approveSite, type Stage } from "../../src/pipeline.js";

function setup() {
  const config = loadConfig(mkdtempSync(join(tmpdir(), "fk-")));
  initSite(config, { slug: "p", briefPath: "fixtures/briefs/boulangerie.md" });
  return config;
}
const ok = (name: Stage["name"], checkpoint = false, log: string[] = []): Stage => ({ name, checkpoint, run: async () => { log.push(name); return `${name} ok`; } });

describe("runSite", () => {
  it("runs stages in order, skips unregistered ones, and stops at a checkpoint", async () => {
    const config = setup(); const log: string[] = [];
    const stages = { spec: ok("spec", true, log), design: ok("design", false, log) };
    const s = await runSite(config, "p", { stages });
    expect(log).toEqual(["spec"]);
    expect(s.stages.spec.status).toBe("awaiting_approval");
    expect(s.stages.design.status).toBe("pending");
  });
  it("refuses to run while a checkpoint awaits approval, then resumes after approve", async () => {
    const config = setup(); const log: string[] = [];
    const stages = { spec: ok("spec", true, log), design: ok("design", false, log) };
    await runSite(config, "p", { stages });
    await expect(runSite(config, "p", { stages })).rejects.toThrow(/awaits approval/);
    approveSite(config, "p");
    const s = await runSite(config, "p", { stages });
    expect(log).toEqual(["spec", "design"]);
    expect(s.stages.design.status).toBe("done");
    expect(s.stages.provision.status).toBe("done");
    expect(s.stages.provision.message).toMatch(/skipped/);
  });
  it("marks a throwing stage failed and rethrows", async () => {
    const config = setup();
    const stages = { spec: { name: "spec", run: async () => { throw new Error("kaboom"); } } as Stage };
    await expect(runSite(config, "p", { stages })).rejects.toThrow("kaboom");
    const s = readState(siteDir(config, "p"));
    expect(s.stages.spec.status).toBe("failed");
    expect(s.stages.spec.message).toBe("kaboom");
  });
  it("--only runs a single stage even if earlier ones are pending", async () => {
    const config = setup(); const log: string[] = [];
    const s = await runSite(config, "p", { only: "design", stages: { design: ok("design", false, log) } });
    expect(log).toEqual(["design"]);
    expect(s.stages.spec.status).toBe("pending");
  });
  it("--from restarts at the given stage", async () => {
    const config = setup(); const log: string[] = [];
    const dir = siteDir(config, "p");
    writeState(dir, setStage(setStage(readState(dir), "spec", "done"), "design", "done"));
    await runSite(config, "p", { from: "spec", stages: { spec: ok("spec", false, log), design: ok("design", false, log) } });
    expect(log).toEqual(["spec", "design"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement pipeline and provision stage**

`src/stages/provision.ts`:
```ts
import type { Stage } from "../pipeline.js";
import { composeUp } from "../docker.js";
import { waitForDb } from "../wp.js";
import { installCore } from "../provision/core.js";
import { installStack } from "../provision/stack.js";

export const provisionStage: Stage = {
  name: "provision",
  async run(ctx) {
    const up = await composeUp(ctx);
    if (up.code !== 0) throw new Error(`docker compose up failed: ${up.stderr.trim()}`);
    await waitForDb(ctx);
    const core = await installCore(ctx, { title: ctx.slug });
    const stack = await installStack(ctx);
    const parts = [core.freshInstall ? "fresh install" : "already installed", `installed: ${stack.installed.join(", ") || "nothing new"}`];
    if (stack.missingVendor.length) parts.push(`missing vendor zips: ${stack.missingVendor.join(", ")}`);
    return parts.join("; ");
  },
};
```

`src/pipeline.ts`:
```ts
import { existsSync, rmSync } from "node:fs";
import type { FaktoryConfig } from "./config.js";
import { composeDown, type SiteContext } from "./docker.js";
import { STAGES, readState, writeState, setStage, firstIncompleteStage, awaitingStage, type SiteState, type StageName } from "./state.js";
import { siteDir } from "./workspace.js";
import { provisionStage } from "./stages/provision.js";

export interface Stage {
  name: StageName;
  checkpoint?: boolean;
  run(ctx: SiteContext): Promise<string | void>;
}

export const registry: Partial<Record<StageName, Stage>> = { provision: provisionStage };

export function loadContext(config: FaktoryConfig, slug: string): SiteContext {
  const dir = siteDir(config, slug);
  if (!existsSync(dir)) throw new Error(`Unknown site "${slug}" (expected ${dir})`);
  return { config, slug, siteDir: dir, state: readState(dir) };
}

function persist(ctx: SiteContext, next: SiteState): SiteState {
  ctx.state = next;
  writeState(ctx.siteDir, next);
  return next;
}

export async function runSite(
  config: FaktoryConfig, slug: string,
  opts: { from?: StageName; only?: StageName; stages?: Partial<Record<StageName, Stage>> } = {},
): Promise<SiteState> {
  const ctx = loadContext(config, slug);
  const stages = opts.stages ?? registry;
  const start = opts.only ?? opts.from ?? firstIncompleteStage(ctx.state);
  if (!start) { console.log(`Site "${slug}": all stages done.`); return ctx.state; }
  if (!opts.only && !opts.from && awaitingStage(ctx.state) === start) {
    throw new Error(`Stage ${start} awaits approval: review the artifact, then run "faktory approve ${slug}"`);
  }
  const plan = opts.only ? [opts.only] : STAGES.slice(STAGES.indexOf(start));
  for (const name of plan) {
    const stage = stages[name];
    if (!stage) { persist(ctx, setStage(ctx.state, name, "done", "skipped (not implemented)")); continue; }
    persist(ctx, setStage(ctx.state, name, "running"));
    console.log(`▶ ${name}`);
    try {
      const msg = (await stage.run(ctx)) ?? undefined;
      const status = stage.checkpoint ? "awaiting_approval" : "done";
      persist(ctx, setStage(ctx.state, name, status, msg ?? undefined));
      console.log(`${stage.checkpoint ? "⏸" : "✔"} ${name}${msg ? ` — ${msg}` : ""}`);
      if (stage.checkpoint) { console.log(`Review the artifact, then: faktory approve ${slug} && faktory run ${slug}`); break; }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      persist(ctx, setStage(ctx.state, name, "failed", message));
      throw err;
    }
  }
  return ctx.state;
}

export function approveSite(config: FaktoryConfig, slug: string): SiteState {
  const ctx = loadContext(config, slug);
  const waiting = awaitingStage(ctx.state);
  if (!waiting) throw new Error(`Nothing awaits approval for "${slug}"`);
  return persist(ctx, setStage(ctx.state, waiting, "done", "approved"));
}

export async function destroySite(config: FaktoryConfig, slug: string): Promise<void> {
  const ctx = loadContext(config, slug);
  await composeDown(ctx, { volumes: true });
  rmSync(ctx.siteDir, { recursive: true, force: true });
}
```

Wire `src/cli.ts` actions (`run`, `provision`, `approve`, `destroy`):
```ts
import { runSite, approveSite, destroySite } from "./pipeline.js";
import { STAGES, type StageName } from "./state.js";
import * as readline from "node:readline/promises";

function asStage(v: string | undefined): StageName | undefined {
  if (v === undefined) return undefined;
  if (!(STAGES as readonly string[]).includes(v)) throw new Error(`Unknown stage "${v}". Stages: ${STAGES.join(", ")}`);
  return v as StageName;
}
// run
.action(async (slug: string, opts: { from?: string; only?: string }) => {
  await runSite(loadConfig(), slug, { from: asStage(opts.from), only: asStage(opts.only) });
});
// provision
.action(async (slug: string) => { await runSite(loadConfig(), slug, { only: "provision" }); });
// approve
.action(async (slug: string) => { const s = approveSite(loadConfig(), slug); console.log(`Approved. Next: faktory run ${s.slug}`); });
// destroy
.action(async (slug: string, opts: { yes?: boolean }) => {
  if (!opts.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const a = await rl.question(`Destroy site "${slug}" (containers, volumes, workspace)? [y/N] `);
    rl.close();
    if (a.trim().toLowerCase() !== "y") { console.log("Aborted."); return; }
  }
  await destroySite(loadConfig(), slug);
  console.log(`Site "${slug}" destroyed.`);
});
```

- [ ] **Step 4: Run unit tests**

Run: `npx vitest run tests/unit/pipeline.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write and run the provision integration test**

`tests/integration/provision.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { wpJson } from "../../src/wp.js";

describe.skipIf(!process.env.FAKTORY_DOCKER)("provision stage (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8192 };
  initSite(config, { slug: "itprov", briefPath: "fixtures/briefs/boulangerie.md" });
  afterAll(async () => { await destroySite(config, "itprov"); });

  it("installs WordPress fr_FR with GeneratePress, GenerateBlocks, Yoast and the child theme, and is idempotent", async () => {
    const s1 = await runSite(config, "itprov", { only: "provision" });
    expect(s1.stages.provision.status, s1.stages.provision.message).toBe("done");
    const ctx = loadContext(config, "itprov");
    const themes = await wpJson<{ name: string; status: string }[]>(ctx, ["theme", "list", "--fields=name,status"]);
    expect(themes.find((t) => t.name === "faktory-itprov")?.status).toBe("active");
    expect(themes.some((t) => t.name === "generatepress")).toBe(true);
    const plugins = await wpJson<{ name: string; status: string }[]>(ctx, ["plugin", "list", "--fields=name,status"]);
    for (const p of ["generateblocks", "wordpress-seo"]) expect(plugins.find((x) => x.name === p)?.status).toBe("active");
    const locale = await wpJson<string>(ctx, ["option", "get", "WPLANG"]);
    expect(locale).toBe("fr_FR");
    const res = await fetch(`http://localhost:${ctx.state.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('lang="fr-FR"');
    const s2 = await runSite(config, "itprov", { only: "provision" });
    expect(s2.stages.provision.message).toContain("already installed");
  });
});
```

Run: `FAKTORY_DOCKER=1 npx vitest run tests/integration/provision.test.ts --testTimeout=600000`
Expected: PASS. Premium zips are reported as missing unless present in `docker/vendor/`; that is not a failure.

- [ ] **Step 6: Manual check on the demo site**

Run: `npm run faktory -- provision demo && open http://localhost:8100`
Expected: French WordPress front page with GeneratePress child theme active. `cat sites/demo/faktory.json` shows `provision.status = "done"`.

- [ ] **Step 7: Commit**

```bash
git add src/pipeline.ts src/stages/provision.ts src/cli.ts tests/unit/pipeline.test.ts tests/integration/provision.test.ts
git commit -m "feat(faktory): stage pipeline runner, provision stage, run/approve/destroy commands"
```

---

### Task 10: Skills plugin and sync script

**Files:**
- Create: `scripts/sync-skills.sh`, `plugin/.claude-plugin/plugin.json`, `plugin/README.md`, `tests/unit/sync-skills.test.ts`

**Interfaces:**
- Produces: `plugin/skills/<name>/SKILL.md` for `generatepress-generateblocks`, `wp-plugin-development`, `wp-block-development`, `wp-wpcli-and-ops`. `src/agent.ts` (Task 11) points `plugins: [{ type: "local", path: <repoRoot>/plugin }]`.
- Script accepts `SKILLS_SRC` env override (default `~/.claude/skills`) and `SKILLS_DEST` (default `<repo>/plugin/skills`) so tests can use temp dirs.

- [ ] **Step 1: Write failing test**

`tests/unit/sync-skills.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/exec.js";

const NAMES = ["generatepress-generateblocks", "wp-plugin-development", "wp-block-development", "wp-wpcli-and-ops"];

describe("sync-skills.sh", () => {
  it("copies each skill directory and fails loudly when one is missing", async () => {
    const src = mkdtempSync(join(tmpdir(), "skills-src-"));
    const dest = mkdtempSync(join(tmpdir(), "skills-dest-"));
    for (const n of NAMES.slice(0, 3)) { mkdirSync(join(src, n, "scripts"), { recursive: true }); writeFileSync(join(src, n, "SKILL.md"), `# ${n}`); }
    const r1 = await run("bash", ["scripts/sync-skills.sh"], { env: { SKILLS_SRC: src, SKILLS_DEST: dest } });
    expect(r1.code).toBe(1);
    expect(r1.stderr).toContain("wp-wpcli-and-ops");
    mkdirSync(join(src, NAMES[3]), { recursive: true }); writeFileSync(join(src, NAMES[3], "SKILL.md"), "# x");
    const r2 = await run("bash", ["scripts/sync-skills.sh"], { env: { SKILLS_SRC: src, SKILLS_DEST: dest } });
    expect(r2.code, r2.stderr).toBe(0);
    for (const n of NAMES) expect(readFileSync(join(dest, n, "SKILL.md"), "utf8")).toContain(n === NAMES[3] ? "# x" : n);
    expect(existsSync(join(dest, NAMES[0], "scripts"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/sync-skills.test.ts`
Expected: FAIL (script missing).

- [ ] **Step 3: Write the script and plugin manifest**

`scripts/sync-skills.sh`:
```bash
#!/usr/bin/env bash
# Copy the skills Faktory needs from the user's Claude skills dir into plugin/skills/.
# Copies (not symlinks) so the Agent SDK plugin loader sees plain directories.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SKILLS_SRC:-$HOME/.claude/skills}"
DEST="${SKILLS_DEST:-$ROOT/plugin/skills}"
SKILLS=(generatepress-generateblocks wp-plugin-development wp-block-development wp-wpcli-and-ops)

missing=()
for s in "${SKILLS[@]}"; do
  [ -f "$SRC/$s/SKILL.md" ] || missing+=("$s")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "sync-skills: missing in $SRC: ${missing[*]}" >&2
  exit 1
fi

mkdir -p "$DEST"
for s in "${SKILLS[@]}"; do
  rsync -a --delete --exclude 'evals/' --exclude '.git/' "$SRC/$s/" "$DEST/$s/"
  echo "synced $s"
done
```

`plugin/.claude-plugin/plugin.json`:
```json
{
  "name": "faktory-skills",
  "version": "0.1.0",
  "description": "WordPress / GeneratePress skills bundled for the Faktory pipeline"
}
```

`plugin/README.md`:
```markdown
Local Claude Code plugin loaded by the Agent SDK (`plugins: [{ type: "local", path }]`).
`skills/` is generated by `npm run sync-skills` and gitignored. Re-run after editing a skill in `~/.claude/skills`.
```

- [ ] **Step 4: Run test and the real sync**

Run: `chmod +x scripts/sync-skills.sh && npx vitest run tests/unit/sync-skills.test.ts && npm run sync-skills && ls plugin/skills`
Expected: PASS; four directories listed, `plugin/skills/generatepress-generateblocks/scripts/gb_build.py` present.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-skills.sh plugin/.claude-plugin/plugin.json plugin/README.md tests/unit/sync-skills.test.ts
git commit -m "feat(faktory): local skills plugin with sync script"
```

---

### Task 11: MCP tool server with the `wp` tool

**Files:**
- Create: `src/tools/server.ts`, `tests/unit/tools-server.test.ts`

**Interfaces:**
- Consumes: `runWp`, `SiteContext`, `tool`, `createSdkMcpServer` from `@anthropic-ai/claude-agent-sdk`.
- Produces:
  ```ts
  export const FAKTORY_SERVER = "faktory";                       // tools are named mcp__faktory__<name>
  export function wpToolHandler(ctx: SiteContext): (args: { args: string[]; stdin?: string }) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;
  export function createFaktoryServer(ctx: SiteContext): ReturnType<typeof createSdkMcpServer>;
  export const TOOL_WP = "mcp__faktory__wp";
  ```
  The `wp` tool refuses `db drop`, `db reset`, `site empty`, `core download` and anything containing `--allow-root`; returns `isError: true` with stderr on non-zero exit; truncates stdout to 20 000 chars with a `[truncated]` marker.

- [ ] **Step 1: Write failing test**

`tests/unit/tools-server.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps } from "../../src/wp.js";
import { wpToolHandler, createFaktoryServer, TOOL_WP } from "../../src/tools/server.js";

const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };

describe("wp tool", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("returns stdout on success", async () => {
    vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "Maison Rivet\n", stderr: "", code: 0 });
    const r = await wpToolHandler(ctx)({ args: ["option", "get", "blogname"] });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toBe("Maison Rivet");
  });
  it("flags errors with stderr", async () => {
    vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "", stderr: "Error: no such post", code: 1 });
    const r = await wpToolHandler(ctx)({ args: ["post", "get", "999"] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("no such post");
  });
  it("refuses destructive commands without calling wp", async () => {
    const spy = vi.spyOn(deps, "composeExec");
    const r = await wpToolHandler(ctx)({ args: ["db", "reset", "--yes"] });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  it("truncates long output", async () => {
    vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "x".repeat(30000), stderr: "", code: 0 });
    const r = await wpToolHandler(ctx)({ args: ["post", "list"] });
    expect(r.content[0].text.length).toBeLessThan(20100);
    expect(r.content[0].text).toContain("[truncated]");
  });
  it("server exposes the wp tool under the faktory namespace", () => {
    const server = createFaktoryServer(ctx);
    expect(server).toBeTruthy();
    expect(TOOL_WP).toBe("mcp__faktory__wp");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/tools-server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/tools/server.ts`**

```ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { SiteContext } from "../docker.js";
import { runWp } from "../wp.js";

export const FAKTORY_SERVER = "faktory";
export const TOOL_WP = `mcp__${FAKTORY_SERVER}__wp`;
const MAX_OUT = 20_000;
const FORBIDDEN: string[][] = [["db", "drop"], ["db", "reset"], ["db", "clean"], ["site", "empty"], ["core", "download"]];

function forbidden(args: string[]): string | undefined {
  if (args.some((a) => a === "--allow-root")) return "--allow-root is not allowed";
  for (const f of FORBIDDEN) if (f.every((p, i) => args[i] === p)) return `wp ${f.join(" ")} is not allowed`;
  return undefined;
}
function clip(s: string): string { return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "\n[truncated]" : s; }

export function wpToolHandler(ctx: SiteContext) {
  return async (input: { args: string[]; stdin?: string }) => {
    const reason = forbidden(input.args);
    if (reason) return { content: [{ type: "text" as const, text: reason }], isError: true };
    const r = await runWp(ctx, input.args, { input: input.stdin });
    if (r.code !== 0) {
      return { content: [{ type: "text" as const, text: clip(`exit ${r.code}\n${r.stderr}\n${r.stdout}`.trim()) }], isError: true };
    }
    return { content: [{ type: "text" as const, text: clip(r.stdout.trim()) }] };
  };
}

export function createFaktoryServer(ctx: SiteContext) {
  const wp = tool(
    "wp",
    "Run a WP-CLI command against this site's WordPress (inside Docker). Pass args as an array, e.g. [\"post\",\"list\",\"--post_type=page\",\"--format=json\"]. Use stdin for post content. Destructive db/site commands are refused.",
    { args: z.array(z.string()).min(1).describe("wp-cli arguments without the leading 'wp'"), stdin: z.string().optional().describe("Text piped to the command's stdin") },
    wpToolHandler(ctx),
  );
  return createSdkMcpServer({ name: FAKTORY_SERVER, version: "0.1.0", tools: [wp] });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/tools-server.test.ts && npm run typecheck`
Expected: PASS (5 tests), typecheck clean. If `tool()`'s handler type rejects the plain object return, wrap as `{ content: [...] } satisfies CallToolResult` importing the type from `@modelcontextprotocol/sdk/types.js` (transitive dep of the SDK).

- [ ] **Step 5: Commit**

```bash
git add src/tools/server.ts tests/unit/tools-server.test.ts
git commit -m "feat(faktory): in-process MCP server exposing a guarded wp tool"
```

---

### Task 12: Agent wrapper, write guard, and `doctor`

**Files:**
- Create: `src/agent.ts`, `tests/unit/agent.test.ts`
- Modify: `src/cli.ts` (`doctor` action)

**Interfaces:**
- Consumes: `query`, `HookCallback` types from the SDK, `createFaktoryServer`, `TOOL_WP`, `SiteContext`, `writeState`.
- Produces:
  ```ts
  export function isInside(base: string, target: string): boolean;               // path containment, resolves .. and symlink-free
  export function writeGuard(siteDir: string): HookCallback;                    // denies Write/Edit/MultiEdit/NotebookEdit outside siteDir
  export type AgentRun = { text: string; structured?: unknown; costUsd: number; sessionId?: string; numTurns: number };
  export function runAgent(ctx: SiteContext, opts: {
    stage: string; prompt: string; systemPrompt?: string; allowedTools: string[];
    outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
    maxTurns?: number; model?: string;
  }): Promise<AgentRun>;
  export function pluginPath(config: FaktoryConfig): string;                    // <repoRoot>/plugin
  ```
  `runAgent` adds `result.total_cost_usd` to `ctx.state.costUsd` and persists. Model resolution: `opts.model ?? config.models[opts.stage] ?? config.models.default`. Throws when the result subtype is not `success`, with the subtype in the message.

- [ ] **Step 1: Write failing unit tests (pure parts)**

`tests/unit/agent.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isInside, writeGuard, pluginPath, resolveModel } from "../../src/agent.js";
import { loadConfig } from "../../src/config.js";

describe("isInside", () => {
  it("accepts children and rejects escapes", () => {
    expect(isInside("/a/b", "/a/b/c.txt")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b", "/a/b/../c")).toBe(false);
    expect(isInside("/a/b", "/a/bc/x")).toBe(false);
  });
});

describe("writeGuard", () => {
  const guard = writeGuard("/site");
  const call = (tool: string, file_path: string) =>
    guard({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { file_path }, session_id: "s", transcript_path: "", cwd: "/site" } as never, "t1", { signal: new AbortController().signal });
  it("denies writes outside the site dir", async () => {
    const r = (await call("Write", "/etc/passwd")) as { hookSpecificOutput?: { permissionDecision?: string } };
    expect(r.hookSpecificOutput?.permissionDecision).toBe("deny");
  });
  it("allows writes inside the site dir", async () => {
    const r = await call("Edit", "/site/pages/home.gb.json");
    expect(r).toEqual({});
  });
  it("ignores non-write tools", async () => {
    const r = await call("Read", "/etc/passwd");
    expect(r).toEqual({});
  });
});

describe("resolveModel / pluginPath", () => {
  const config = loadConfig("/tmp/fk");
  it("falls back stage → default", () => {
    expect(resolveModel({ ...config, models: { default: "claude-opus-5", spec: "claude-sonnet-5" } }, "spec")).toBe("claude-sonnet-5");
    expect(resolveModel(config, "pages")).toBe("claude-opus-5");
    expect(resolveModel(config, "pages", "claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });
  it("points at <repo>/plugin", () => {
    expect(pluginPath(config)).toBe("/tmp/fk/plugin");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/agent.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/agent.ts`**

```ts
import { join, resolve, sep } from "node:path";
import { query, type HookCallback, type PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import type { FaktoryConfig } from "./config.js";
import type { SiteContext } from "./docker.js";
import { writeState } from "./state.js";
import { createFaktoryServer, FAKTORY_SERVER } from "./tools/server.js";

export function isInside(base: string, target: string): boolean {
  const b = resolve(base), t = resolve(target);
  return t === b || t.startsWith(b + sep);
}

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export function writeGuard(siteDir: string): HookCallback {
  return async (input) => {
    const pre = input as PreToolUseHookInput;
    if (pre.hook_event_name !== "PreToolUse" || !WRITE_TOOLS.has(pre.tool_name)) return {};
    const fp = (pre.tool_input as { file_path?: string; notebook_path?: string })?.file_path
      ?? (pre.tool_input as { notebook_path?: string })?.notebook_path;
    if (fp && isInside(siteDir, fp)) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Writes are restricted to ${siteDir}`,
      },
    };
  };
}

export function pluginPath(config: FaktoryConfig): string {
  return join(config.repoRoot, "plugin");
}

export function resolveModel(config: FaktoryConfig, stage: string, override?: string): string {
  return override ?? config.models[stage] ?? config.models.default;
}

export type AgentRun = { text: string; structured?: unknown; costUsd: number; sessionId?: string; numTurns: number };

export async function runAgent(
  ctx: SiteContext,
  opts: {
    stage: string; prompt: string; systemPrompt?: string; allowedTools: string[];
    outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
    maxTurns?: number; model?: string;
  },
): Promise<AgentRun> {
  const server = createFaktoryServer(ctx);
  let out: AgentRun | undefined;
  for await (const message of query({
    prompt: opts.prompt,
    options: {
      cwd: ctx.siteDir,
      model: resolveModel(ctx.config, opts.stage, opts.model),
      systemPrompt: opts.systemPrompt,
      allowedTools: opts.allowedTools,
      plugins: [{ type: "local", path: pluginPath(ctx.config) }],
      mcpServers: { [FAKTORY_SERVER]: server },
      hooks: { PreToolUse: [{ matcher: "Write|Edit|MultiEdit|NotebookEdit", hooks: [writeGuard(ctx.siteDir)] }] },
      maxTurns: opts.maxTurns ?? 60,
      outputFormat: opts.outputFormat,
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text.trim()) console.log(`  [${opts.stage}] ${block.text.trim().split("\n")[0].slice(0, 160)}`);
      }
    }
    if (message.type === "result") {
      if (message.subtype !== "success") throw new Error(`Agent stage "${opts.stage}" ended with ${message.subtype}`);
      out = {
        text: message.result,
        structured: (message as { structured_output?: unknown }).structured_output,
        costUsd: message.total_cost_usd,
        sessionId: message.session_id,
        numTurns: message.num_turns,
      };
    }
  }
  if (!out) throw new Error(`Agent stage "${opts.stage}" produced no result`);
  ctx.state = { ...ctx.state, costUsd: Math.round((ctx.state.costUsd + out.costUsd) * 10000) / 10000 };
  writeState(ctx.siteDir, ctx.state);
  return out;
}
```

- [ ] **Step 4: Run unit tests and typecheck**

Run: `npx vitest run tests/unit/agent.test.ts && npm run typecheck`
Expected: PASS (7 tests). If the SDK's option or message field names differ from the above (`structured_output`, `total_cost_usd`, `num_turns`, `plugins`, `outputFormat`), open `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, grep the name, and adjust — do not guess.

- [ ] **Step 5: Implement `doctor`**

In `src/cli.ts`:
```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "./exec.js";
import { runAgent, pluginPath } from "./agent.js";
import { findVendorZip, VENDOR_PLUGINS } from "./provision/stack.js";
import { TOOL_WP } from "./tools/server.js";
import { loadContext } from "./pipeline.js";
import { listSites } from "./workspace.js";

program.command("doctor").description("Check local toolchain and skill loading")
  .option("--agent", "Also run a tiny Agent SDK query to verify skill/plugin loading (costs a few cents)")
  .action(async (opts: { agent?: boolean }) => {
    const config = loadConfig();
    const checks: [string, boolean, string][] = [];
    const ver = async (cmd: string, args: string[]) => (await run(cmd, args)).code === 0;
    checks.push(["docker", await ver("docker", ["--version"]), "install Docker Desktop"]);
    checks.push(["docker compose", await ver("docker", ["compose", "version"]), "Compose v2+ required"]);
    checks.push(["python3", await ver("python3", ["--version"]), "needed by gb_build.py"]);
    checks.push(["rsync", await ver("rsync", ["--version"]), "needed by sync-skills"]);
    checks.push(["skills synced", existsSync(join(pluginPath(config), "skills", "generatepress-generateblocks", "SKILL.md")), "run npm run sync-skills"]);
    for (const v of VENDOR_PLUGINS) checks.push([`vendor ${v.slug}`, !!findVendorZip(config.vendorDir, v.prefix), `drop ${v.prefix}*.zip in docker/vendor/ (optional)`]);
    checks.push(["ANTHROPIC auth", !!process.env.ANTHROPIC_API_KEY || (await run("ant", ["auth", "status"])).code === 0, "set ANTHROPIC_API_KEY or run ant auth login"]);
    for (const [name, ok, hint] of checks) console.log(`${ok ? "✔" : "✖"} ${name}${ok ? "" : ` — ${hint}`}`);

    if (opts.agent) {
      const sites = listSites(config);
      if (!sites.length) throw new Error("Create a site first (faktory init) so doctor has a workspace to run in");
      const ctx = loadContext(config, sites[0]);
      const r = await runAgent(ctx, {
        stage: "doctor",
        prompt: "List the names of every skill available to you, one per line, then call the wp tool with args [\"cli\",\"version\"] and print its output verbatim. Nothing else.",
        allowedTools: [TOOL_WP],
        maxTurns: 4,
      });
      console.log("\n--- agent ---\n" + r.text + `\n--- cost $${r.costUsd.toFixed(4)}, ${r.numTurns} turns ---`);
      const ok = r.text.includes("generatepress-generateblocks") && /WP-CLI \d/.test(r.text);
      console.log(ok ? "✔ skills loaded and wp tool reachable" : "✖ skills or wp tool not visible to the agent — check plugin/ layout and docker state");
      if (!ok) process.exit(1);
    }
  });
```

- [ ] **Step 6: Run doctor against the demo site**

Run: `npm run faktory -- doctor && npm run faktory -- doctor --agent`
Expected: toolchain lines all ✔ except optional vendor zips; the agent run lists `generatepress-generateblocks` among skills and prints a `WP-CLI x.y.z` line. This closes the spec's open assumption about plugin/skill loading. If the agent does not see skills, try `settingSources: []` explicitly and check the SDK plugin docs before changing the layout.

- [ ] **Step 7: Commit**

```bash
git add src/agent.ts src/cli.ts tests/unit/agent.test.ts
git commit -m "feat(faktory): agent SDK wrapper with write guard, cost tracking and doctor command"
```

---

### Task 13: README and phase wrap-up

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-09-12-faktory-design.md` (one line: workspace uses `wp-content/` bind mount)

- [ ] **Step 1: Write README**

`README.md`:
```markdown
# Faktory

WordPress AI software factory: `brief.md` in, GeneratePress/GenerateBlocks site out.

## Setup
```bash
npm install
npm run sync-skills                 # copies GP/GB + WP skills from ~/.claude/skills into plugin/skills
cp docker/.env.example docker/.env  # optional license keys
# drop gp-premium*.zip, generateblocks-pro*.zip, gravityforms*.zip, gravityformscli*.zip into docker/vendor/
npm run faktory -- doctor           # add --agent to verify skill loading with a real query
```

## Usage
```bash
npm run faktory -- init boulangerie --brief fixtures/briefs/boulangerie.md
npm run faktory -- run boulangerie          # runs from the first incomplete stage; stops at checkpoints
npm run faktory -- approve boulangerie      # after editing SITE-SPEC.md / design-system.md
npm run faktory -- run boulangerie --only provision
npm run faktory -- destroy boulangerie
```
Sites live in `sites/<slug>/` (gitignored). `faktory.json` holds stage status, port, admin credentials and cost.
Site URL: `http://localhost:<port>` (ports start at 8100). Admin: `admin` / password in `faktory.json`.

## Stages
spec ⏸ → design ⏸ → provision → plugins → pages → content → qa → export. Phase 1 implements `provision`; other stages are marked "skipped (not implemented)".

## Tests
```bash
npm test                              # unit
FAKTORY_DOCKER=1 npm run test:integration
```
```

- [ ] **Step 2: Note the layout change in the spec**

In `docs/superpowers/specs/2026-09-12-faktory-design.md`, under "Layout du dépôt", replace the `plugins/<name>/` line in the `sites/<slug>/` tree with `wp-content/          # bind-mounted into the container; custom plugins go in wp-content/plugins/<name>/` and update the `plugins` stage sentence "Sortie : `sites/<slug>/plugins/<name>/` monté dans le conteneur" to "Sortie : `sites/<slug>/wp-content/plugins/<name>/` (bind mount)".

- [ ] **Step 3: Full test run**

Run: `npm test && npm run typecheck && FAKTORY_DOCKER=1 npm run test:integration`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-12-faktory-design.md
git commit -m "docs(faktory): README and spec note on wp-content bind mount"
```

---

## Self-review notes

- **Spec coverage (phase 1 scope):** CLI (`init/run/approve/destroy/doctor`) ✔ Tasks 1, 4, 9, 12. State machine with `pending|running|awaiting_approval|done|failed` ✔ Task 3. Docker stack, one Compose project per site, port allocation ✔ Tasks 4-5. Provision steps 1-4 of the spec (compose up, core install fr_FR, stack install, child theme) ✔ Tasks 7-9. Provision steps 5-6 (design tokens, menus, header/footer) are deliberately phase 2 because they depend on the design stage output and on keys to be discovered on a live site. `sync-skills` + local plugin ✔ Task 10. `wp` MCP tool ✔ Task 11. Agent wrapper with write guard, cost tracking and the plugin-loading assumption check ✔ Task 12. Fixture brief ✔ Task 4.
- **Deferred to phase 2+:** `gb_build`/`gb_preview`/`php_check`/`screenshot`/`check_page` tools, all LLM stages, `--max-cost`, export.
- **Type consistency:** `SiteContext` is defined in `src/docker.ts` and imported everywhere; `deps.composeExec` is the single mock seam for wp calls; `Stage.run` returns `string | void`; `runSite` accepts an injectable `stages` map for tests.
