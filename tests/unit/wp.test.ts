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
  it("wpOk redacts secrets from the thrown error message", async () => {
    vi.spyOn(deps, "composeExec").mockResolvedValue({ stdout: "", stderr: "Error: nope", code: 1 });
    let message = "";
    try {
      await wpOk(ctx, ["core", "install", "--admin_password=s3cret"]);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("--admin_password=***");
    expect(message).not.toContain("s3cret");
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
