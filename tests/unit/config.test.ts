import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  it("applies defaults when the file is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "faktory-"));
    const c = loadConfig(root);
    expect(c.sitesRoot).toBe(join(root, "sites"));
    expect(c.vendorDir).toBe(join(root, "docker", "vendor"));
    expect(c.portBase).toBe(8100);
    expect(c.models.default).toBe("claude-opus-5");
    expect(c.adminEmail).toBe("khelil@partikuls.com");
  });
  it("merges overrides from faktory.config.json", () => {
    const root = mkdtempSync(join(tmpdir(), "faktory-"));
    writeFileSync(join(root, "faktory.config.json"), JSON.stringify({ portBase: 9000, models: { default: "claude-opus-5", spec: "claude-sonnet-5" } }));
    const c = loadConfig(root);
    expect(c.portBase).toBe(9000);
    expect(c.models.spec).toBe("claude-sonnet-5");
  });
});
