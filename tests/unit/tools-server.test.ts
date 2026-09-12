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
