import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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

/**
 * PHP constructs an agent-written plugin must never use: code evaluation, shell access, opaque
 * (de)serialisation, raw SQL and remote reads through `file_get_contents`. Screened before the plugin is
 * activated in the container — PHPStan does not judge intent.
 */
export const PHP_DENYLIST = [
  "eval(", "assert(", "create_function(", "exec(", "shell_exec(", "system(", "passthru(", "popen(", "proc_open(",
  "base64_decode(", "unserialize(", "$wpdb->query(", "file_get_contents('http", 'file_get_contents("http',
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A call of exactly this name: `\bexec\s*\(` matches `exec( $x )` but not `shell_exec(`, `wp_remote_get(`,
 * `maybe_unserialize(`, `$obj->system(` or the word in a comment.
 */
function denylistRe(token: string): RegExp {
  const i = token.indexOf("(");
  const name = token.slice(0, i), rest = token.slice(i + 1);
  const boundary = /^[A-Za-z_]/.test(name) ? "(?<![\\w$>:])" : "";
  return new RegExp(`${boundary}${escapeRe(name)}\\s*\\(\\s*${escapeRe(rest)}`, "i");
}
const PHP_DENYLIST_RES: [string, RegExp][] = PHP_DENYLIST.map((t) => [t, denylistRe(t)]);

/** `<file>:<line>: forbidden PHP construct <token>` for every denylisted call under `dir` (empty = clean). */
export function phpDenylistIssues(dir: string): string[] {
  const abs = resolve(dir);
  const issues: string[] = [];
  for (const file of listPhpFiles(abs)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const [token, re] of PHP_DENYLIST_RES) {
        if (re.test(line)) issues.push(`${relative(abs, file)}:${i + 1}: forbidden PHP construct ${token}`);
      }
    });
  }
  return issues;
}

export type PhpCheckResult = { ok: boolean; output: string; files: number };

/** `php -l` on every PHP file, then PHPStan level 5 with the repo's WordPress-aware config. Never throws. */
export async function phpCheck(config: FaktoryConfig, dir: string): Promise<PhpCheckResult> {
  const abs = resolve(dir);
  if (!existsSync(abs)) return { ok: false, files: 0, output: `${abs} not found` };
  const files = listPhpFiles(abs);
  if (!files.length) return { ok: false, files: 0, output: `no PHP files under ${abs}` };
  const lint: string[] = [];
  for (const f of files) {
    const r = await deps.run("php", ["-l", f]);
    if (r.code !== 0) lint.push((r.stderr || r.stdout).trim());
  }
  if (lint.length) return { ok: false, files: files.length, output: `php -l:\n${lint.join("\n")}` };
  const bin = phpstanBin(config);
  if (!existsSync(bin)) return { ok: false, files: files.length, output: "PHPStan not installed — run npm run setup-phpstan" };
  const r = await deps.run(bin, ["analyse", "--no-progress", "--error-format=raw", `--level=${PHPSTAN_LEVEL}`, "--memory-limit=1G", "-c", phpstanConfigPath(config), ...files], { cwd: phpstanDir(config) });
  if (r.code !== 0) return { ok: false, files: files.length, output: `PHPStan level ${PHPSTAN_LEVEL}:\n${(r.stdout + "\n" + r.stderr).trim()}` };
  return { ok: true, files: files.length, output: `OK: php -l and PHPStan level ${PHPSTAN_LEVEL} passed on ${files.length} PHP files` };
}
