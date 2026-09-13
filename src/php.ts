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
