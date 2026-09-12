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
  it("defaults maxCostUsd to 40 and accepts an override", () => {
    expect(loadConfig("/tmp/nonexistent-fk").maxCostUsd).toBe(40);
    const dir = mkdtempSync(join(tmpdir(), "fk-cfg-"));
    writeFileSync(join(dir, "faktory.config.json"), JSON.stringify({ maxCostUsd: 12.5, models: { default: "claude-opus-5", resync: "claude-sonnet-5" } }));
    const c = loadConfig(dir);
    expect(c.maxCostUsd).toBe(12.5);
    expect(c.models.resync).toBe("claude-sonnet-5");
  });
});
