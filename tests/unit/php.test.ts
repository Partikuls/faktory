import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { phpCheck, listPhpFiles, phpstanBin, phpstanConfigPath, phpDenylistIssues, PHP_DENYLIST, deps } from "../../src/php.js";

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

describe("phpDenylistIssues", () => {
  it("flags every dangerous construct with its file and line", () => {
    const dir = pluginDir({
      "a.php": "<?php\n$x = 1;\neval( $code );\n",
      "inc/b.php": "<?php\n$out = shell_exec('ls');\n$rows = $wpdb->query( $sql );\n$body = file_get_contents( 'https://x' );\n$b = base64_decode($s) . unserialize($t);\n",
    });
    expect(phpDenylistIssues(dir)).toEqual([
      "a.php:3: forbidden PHP construct eval(",
      "inc/b.php:2: forbidden PHP construct shell_exec(",
      "inc/b.php:3: forbidden PHP construct $wpdb->query(",
      "inc/b.php:4: forbidden PHP construct file_get_contents('http",
      "inc/b.php:5: forbidden PHP construct base64_decode(",
      "inc/b.php:5: forbidden PHP construct unserialize(",
    ]);
    expect(PHP_DENYLIST).toContain("eval(");
    expect(PHP_DENYLIST).toContain("$wpdb->query(");
  });
  it("matches calls only: lookalike function names, prose and a local file read pass", () => {
    const dir = pluginDir({
      "a.php": "<?php\n// eval, exec and system are forbidden in this plugin.\n$r = wp_remote_get( $url );\n$v = maybe_unserialize( $raw );\n$t = file_get_contents( $path );\n$wpdb->prepare( $sql );\n$s = $this->system( 'x' );\n",
      "style.css": "eval(",
    });
    expect(phpDenylistIssues(dir)).toEqual([]);
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
    expect(call[1]).toEqual(["analyse", "--no-progress", "--error-format=raw", "--level=5", "--memory-limit=1G", "-c", join(root, "tools/phpstan/phpstan.neon"), join(dir, "a.php")]);
    expect(call[2]).toMatchObject({ cwd: join(root, "tools/phpstan") });
  });
  it("resolves a relative dir to its absolute form before running phpstan (its cwd is tools/phpstan, not ours)", async () => {
    const dir = pluginDir({ "a.php": "<?php" });
    const root = mkdtempSync(join(tmpdir(), "fk-root-"));
    mkdirSync(join(root, "tools/phpstan/vendor/bin"), { recursive: true });
    writeFileSync(join(root, "tools/phpstan/vendor/bin/phpstan"), "");
    const relDir = relative(process.cwd(), dir);
    const run = vi.spyOn(deps, "run").mockResolvedValue(okRun);
    const r = await phpCheck({ ...config, repoRoot: root }, relDir);
    expect(r).toMatchObject({ ok: true, files: 1 });
    const call = run.mock.calls.find((c: any) => c[0] !== "php")!;
    expect(call[1][call[1].length - 1]).toBe(join(resolve(relDir), "a.php"));
    expect(call[1][call[1].length - 1]).toBe(join(dir, "a.php"));
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
  beforeEach(() => vi.restoreAllMocks());
  it("catches a real lint error and a real phpstan error", async () => {
    const cfg = loadConfig(process.cwd());
    const lint = await phpCheck(cfg, pluginDir({ "a.php": "<?php echo 'x'" }));
    expect(lint.ok).toBe(false);
    const stan = await phpCheck(cfg, pluginDir({ "a.php": "<?php\nfunction f(): int { return $undefined; }\n" }));
    expect(stan.ok).toBe(false);
    expect(stan.output).toMatch(/undefined/i);
    const good = await phpCheck(cfg, pluginDir({ "a.php": "<?php\nfunction faktory_ok(): string { return esc_html( get_bloginfo( 'name' ) ); }\n" }));
    expect(good.ok, good.output).toBe(true);
  }, 60_000);
});
