import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps } from "../../src/wp.js";
import { gbScript, deps as gbDeps } from "../../src/gb.js";
import * as gbModule from "../../src/gb.js";
import { deps as phpDeps } from "../../src/php.js";
import { wpToolHandler, createFaktoryServer, FAKTORY_SERVER, TOOL_WP, resolveSitePath, gbBuildToolHandler, gbPreviewToolHandler, TOOL_GB_BUILD, TOOL_GB_PREVIEW, TOOL_PHP_CHECK, phpCheckToolHandler } from "../../src/tools/server.js";

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
  it("refuses destructive commands preceded by global flags, without calling wp", async () => {
    const spy = vi.spyOn(deps, "composeExec");
    const r = await wpToolHandler(ctx)({ args: ["--quiet", "db", "reset", "--yes"] });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  it("refuses eval, without calling wp", async () => {
    const spy = vi.spyOn(deps, "composeExec");
    const r = await wpToolHandler(ctx)({ args: ["eval", "echo 1;"] });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  it("allows db export", async () => {
    vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "-- dump --", stderr: "", code: 0 });
    const r = await wpToolHandler(ctx)({ args: ["db", "export"] });
    expect(r.isError).toBeFalsy();
  });
  it("refuses --exec and --require global flags, without calling wp", async () => {
    const spy = vi.spyOn(deps, "composeExec");
    const exec = await wpToolHandler(ctx)({ args: ["--exec=echo 1;", "post", "list"] });
    expect(exec.isError).toBe(true);
    const req = await wpToolHandler(ctx)({ args: ["--require=/x.php", "post", "list"] });
    expect(req.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  it("still allows --format=json", async () => {
    vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "[]", stderr: "", code: 0 });
    const r = await wpToolHandler(ctx)({ args: ["post", "list", "--format=json"] });
    expect(r.isError).toBeFalsy();
  });
  it("allows commands with a leading global flag and passes args through unchanged", async () => {
    const spy = vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "ok", stderr: "", code: 0 });
    const r = await wpToolHandler(ctx)({ args: ["--url=http://x", "post", "list"] });
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledWith(ctx, "wpcli", ["wp", "--url=http://x", "post", "list"], { input: undefined });
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

describe("resolveSitePath", () => {
  it("joins relative paths and rejects escapes", () => {
    expect(resolveSitePath(ctx, "design/preview.gb.html")).toBe("/tmp/fk/sites/demo/design/preview.gb.html");
    expect(() => resolveSitePath(ctx, "../other/x.html")).toThrow(/inside the site directory/);
    expect(() => resolveSitePath(ctx, "/etc/passwd")).toThrow(/inside the site directory/);
  });
});

describe("gb tools", () => {
  beforeEach(() => vi.restoreAllMocks());
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
  it.skipIf(!existsSync(gbScript(loadConfig(process.cwd()), "gb_preview.py")))("gb_preview renders and injects the palette (python3)", async () => {
    const c = { ...tmpCtx(), config: loadConfig(process.cwd()) };
    writeFileSync(join(c.siteDir, "m.html"), '<!-- wp:generateblocks/text {"uniqueId":"abcd1234","tagName":"p","css":".gb-text-abcd1234{color:var(\\u002d\\u002daccent)}"} -->\n<p class="gb-text gb-text-abcd1234">Hi</p>\n<!-- /wp:generateblocks/text -->\n');
    const r = await gbPreviewToolHandler(c)({ markup: "m.html", out: "preview.html", palette: { accent: "#123456" }, fonts: [{ family: "Fraunces", variants: "400,700" }], headingFont: "Fraunces" });
    expect(r.isError).toBeFalsy();
    const html = readFileSync(join(c.siteDir, "preview.html"), "utf8");
    expect(html).toContain("--accent:#123456");
    expect(html).toContain("family=Fraunces:wght@400;700");
  });
  it("coerces the palette, dropping non-string values, before calling gbPreview", async () => {
    const c = tmpCtx();
    writeFileSync(join(c.siteDir, "m.html"), "<html></html>");
    const spy = vi.spyOn(gbModule, "gbPreview").mockResolvedValue(undefined);
    const r = await gbPreviewToolHandler(c)({ markup: "m.html", out: "preview.html", palette: { accent: "#123456", weight: 5, base: null } as unknown as Record<string, string> });
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][3]).toEqual({ palette: { accent: "#123456" } });
  });
});

describe("php_check tool", () => {
  beforeEach(() => vi.restoreAllMocks());
  // ctx.siteDir is a fake path (/tmp/fk/sites/demo); build a real temp site + repoRoot for this block.
  const tmpPhpCtx = (): SiteContext => {
    const tmp = mkdtempSync(join(tmpdir(), "fk-php-tool-"));
    return { ...ctx, siteDir: tmp, config: { ...ctx.config, repoRoot: tmp } };
  };
  it("is exposed under the faktory namespace and appears in tools/list", async () => {
    expect(TOOL_PHP_CHECK).toBe("mcp__faktory__php_check");
  });
  it("resolves pluginDir inside the site dir and returns the phpCheck output", async () => {
    vi.spyOn(phpDeps, "run").mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const c = tmpPhpCtx();
    const dir = join(c.siteDir, "wp-content/plugins/faktory-x");
    mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "x.php"), "<?php");
    const r = await phpCheckToolHandler(c)({ pluginDir: "wp-content/plugins/faktory-x" });
    // phpstan is not installed under the test ctx repoRoot → explicit failure
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/PHPStan not installed/);
  });
  it("refuses a pluginDir outside the site dir", async () => {
    const r = await phpCheckToolHandler(tmpPhpCtx())({ pluginDir: "../../etc" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/inside the site directory/);
  });
});

describe("createFaktoryServer over MCP", () => {
  it("lists wp, gb_build, gb_preview and php_check through tools/list (regression: z.record broke the schema conversion)", async () => {
    const server = createFaktoryServer(ctx) as unknown as { name: string; instance: { connect(t: unknown): Promise<void> } };
    expect(server.name).toBe(FAKTORY_SERVER);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(a);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(b);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["gb_build", "gb_preview", "php_check", "wp"]);
    const gb = tools.find((t) => t.name === "gb_build")!;
    expect(JSON.stringify(gb.inputSchema)).toContain("\"tree\"");
    await client.close();
  });
});
