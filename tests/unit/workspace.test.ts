import { describe, it, expect } from "vitest";
import { createServer } from "node:net";
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
  it("initSite creates the layout and copies the brief", async () => {
    const config = freshConfig();
    const { dir, state } = await initSite(config, { slug: "boulangerie", briefPath: BRIEF });
    expect(dir).toBe(siteDir(config, "boulangerie"));
    for (const sub of ["brief.md", "faktory.json", "wp-content", "pages", "content", "qa", "dist"]) {
      expect(existsSync(join(dir, sub))).toBe(true);
    }
    expect(readFileSync(join(dir, "brief.md"), "utf8")).toContain("Maison Rivet");
    expect(state.port).toBe(8100);
    expect(state.adminPassword.length).toBeGreaterThanOrEqual(16);
  });
  it("allocates the next free port", async () => {
    const config = freshConfig();
    await initSite(config, { slug: "one", briefPath: BRIEF });
    await initSite(config, { slug: "two", briefPath: BRIEF });
    expect(listSites(config).sort()).toEqual(["one", "two"]);
    expect(await allocatePort(config)).toBe(8102);
  });
  it("refuses to init twice", async () => {
    const config = freshConfig();
    await initSite(config, { slug: "dup", briefPath: BRIEF });
    await expect(initSite(config, { slug: "dup", briefPath: BRIEF })).rejects.toThrow(/already exists/);
  });
  it("refuses an invalid slug", async () => {
    await expect(initSite(freshConfig(), { slug: "Bad Slug", briefPath: BRIEF })).rejects.toThrow(/slug/i);
  });
  it("allocatePort skips a port that is in use", async () => {
    const config = freshConfig();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(config.portBase, "127.0.0.1", resolve));
    try {
      expect(await allocatePort(config)).toBe(config.portBase + 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("siteDir rejects an invalid slug", () => {
    const config = freshConfig();
    expect(() => siteDir(config, "Bad Slug")).toThrow(/invalid slug/i);
  });
});
