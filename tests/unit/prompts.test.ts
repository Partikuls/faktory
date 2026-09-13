import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { loadPrompt, designDoctrine, designSystemPrompt } from "../../src/prompts.js";

describe("prompts", () => {
  it("loads the spec prompt with its key rules", () => {
    const p = loadPrompt("spec");
    expect(p).toContain("brief.md");
    expect(p).toContain("exactement une page `home`");
    expect(p).toContain("[à confirmer]");
  });
  it("loads the design prompt with the artifact names and tool names", () => {
    const p = loadPrompt("design");
    for (const s of ["design-system.md", "design/preview.gb.json", "design/preview.gb.html", "preview.html", "gb_build", "gb_preview"]) expect(p).toContain(s);
  });
  it("appends the doctrine when skills are synced, warns otherwise", () => {
    const config = loadConfig(process.cwd());
    const synced = existsSync("plugin/skills/generatepress-generateblocks/references/design-system.md");
    const d = designDoctrine(config);
    if (synced) expect(d).toContain("Establish a system first");
    else expect(d).toBe("");
    expect(designSystemPrompt(config).startsWith(loadPrompt("design"))).toBe(true);
  });
  it("loads the pages prompt", () => {
    const p = loadPrompt("pages");
    expect(p).toContain("pages/<slug>.gb.json");
    expect(p).toContain("faktory:feature:<id>");
    expect(p).toContain("faktory:form:<id>");
    expect(p).toContain("data-faktory-feature");
    expect(p).toContain("data-faktory-form");
  });
});
