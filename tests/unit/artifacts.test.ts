import { describe, it, expect } from "vitest";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { ARTIFACTS, artifactPath, hasArtifact, readJsonArtifact, writeJsonArtifact, writeTextArtifact, isStale, pageTreePath, pageMarkupPath, pageTreeRel, pageMarkupRel } from "../../src/artifacts.js";

function ctx(): SiteContext {
  const siteDir = mkdtempSync(join(tmpdir(), "fk-art-"));
  return { config: loadConfig("/tmp/fk"), slug: "demo", siteDir, state: createState("demo", 8100, "pw") };
}

describe("artifacts", () => {
  it("resolves paths inside the site dir and creates parent dirs on write", () => {
    const c = ctx();
    expect(artifactPath(c, "previewTree")).toBe(join(c.siteDir, "design", "preview.gb.json"));
    writeJsonArtifact(c, "previewTree", [{ type: "element" }]);
    expect(hasArtifact(c, "previewTree")).toBe(true);
    expect(readJsonArtifact(c, "previewTree", (u) => u as unknown[])).toEqual([{ type: "element" }]);
  });
  it("throws a friendly error when a JSON artifact is missing", () => {
    const c = ctx();
    expect(() => readJsonArtifact(c, "siteSpecJson", (u) => u)).toThrow(/site-spec.json not found.*run the spec stage/);
  });
  it("throws a friendly error when a JSON artifact has a syntax error", () => {
    const c = ctx();
    writeFileSync(artifactPath(c, "siteSpecJson"), "{ not json");
    expect(() => readJsonArtifact(c, "siteSpecJson", (u) => u)).toThrow(/site-spec.json is not valid JSON/);
  });
  it("isStale is true only when the markdown is newer than the json by more than 1s", () => {
    const c = ctx();
    writeTextArtifact(c, "siteSpecMd", "# spec");
    writeJsonArtifact(c, "siteSpecJson", {});
    expect(isStale(c, "siteSpecMd", "siteSpecJson")).toBe(false);
    const future = new Date(Date.now() + 5000);
    utimesSync(artifactPath(c, "siteSpecMd"), future, future);
    expect(isStale(c, "siteSpecMd", "siteSpecJson")).toBe(true);
  });
  it("isStale is false when either file is missing", () => {
    const c = ctx();
    writeFileSync(artifactPath(c, "siteSpecMd"), "# spec");
    expect(isStale(c, "siteSpecMd", "siteSpecJson")).toBe(false);
  });
  it("lists every artifact name the pipeline uses", () => {
    expect(ARTIFACTS.brief).toBe("brief.md");
    expect(ARTIFACTS.designTokensJson).toBe("design-tokens.json");
    expect(ARTIFACTS.previewHtml).toBe("preview.html");
  });
});

describe("page artifact paths", () => {
  it("live under pages/ with .gb.json and .html suffixes", () => {
    const c = { config: loadConfig("/tmp/fk"), slug: "d", siteDir: "/tmp/fk/sites/d", state: createState("d", 8100, "pw") };
    expect(pageTreeRel("nos-produits")).toBe("pages/nos-produits.gb.json");
    expect(pageMarkupRel("nos-produits")).toBe("pages/nos-produits.html");
    expect(pageTreePath(c, "nos-produits")).toBe("/tmp/fk/sites/d/pages/nos-produits.gb.json");
    expect(pageMarkupPath(c, "nos-produits")).toBe("/tmp/fk/sites/d/pages/nos-produits.html");
  });
});
