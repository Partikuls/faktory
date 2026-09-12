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
