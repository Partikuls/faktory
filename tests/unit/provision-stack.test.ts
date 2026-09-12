import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps } from "../../src/wp.js";
import { findVendorZip, installStack } from "../../src/provision/stack.js";

function ctxWithVendor(files: string[]): SiteContext {
  const vendorDir = mkdtempSync(join(tmpdir(), "vendor-"));
  for (const f of files) writeFileSync(join(vendorDir, f), "");
  return { config: { ...loadConfig("/tmp/fk"), vendorDir }, slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };
}
function mockWp(activeThemes: string[] = [], plugins: (string | { name: string; status: string })[] = []) {
  const normalizePlugins = (p: typeof plugins) => p.map((x) => (typeof x === "string" ? { name: x, status: "active" } : x));
  return vi.spyOn(deps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
    const a = cmd.slice(1).join(" ");
    if (a.startsWith("theme list")) return { stdout: JSON.stringify(activeThemes.map((name) => ({ name, status: "active" }))), stderr: "", code: 0 };
    if (a.startsWith("plugin list")) return { stdout: JSON.stringify(normalizePlugins(plugins)), stderr: "", code: 0 };
    return { stdout: "", stderr: "", code: 0 };
  });
}
const calls = (spy: ReturnType<typeof mockWp>) => spy.mock.calls.map((c) => (c[2] as string[]).slice(1).join(" "));

describe("findVendorZip", () => {
  it("matches by exact prefix and ignores longer names", () => {
    const ctx = ctxWithVendor(["gravityforms_2.9.zip", "gravityformscli-1.0.zip"]);
    expect(findVendorZip(ctx.config.vendorDir, "gravityforms")).toBe("gravityforms_2.9.zip");
    expect(findVendorZip(ctx.config.vendorDir, "gravityformscli")).toBe("gravityformscli-1.0.zip");
    expect(findVendorZip(ctx.config.vendorDir, "gp-premium")).toBeUndefined();
  });
});

describe("installStack", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("installs GP, wp.org plugins, present vendor zips, and scaffolds the child theme", async () => {
    const ctx = ctxWithVendor(["gp-premium-2.5.zip"]);
    const spy = mockWp();
    const r = await installStack(ctx);
    const c = calls(spy);
    expect(c).toContain("theme install generatepress --activate");
    expect(c).toContain("plugin install generateblocks wordpress-seo --activate");
    expect(c).toContain("plugin install /vendor/gp-premium-2.5.zip --activate");
    expect(c).toContain("scaffold child-theme faktory-demo --parent_theme=generatepress --theme_name=Faktory demo --activate");
    expect(r.installed).toContain("gp-premium");
    expect(r.missingVendor).toEqual(["generateblocks-pro", "gravityforms", "gravityformscli"]);
  });

  it("is idempotent: skips theme/plugins already active", async () => {
    const ctx = ctxWithVendor([]);
    const spy = mockWp(["generatepress", "faktory-demo"], ["generateblocks", "wordpress-seo"]);
    await installStack(ctx);
    const c = calls(spy);
    expect(c.some((x) => x.startsWith("theme install"))).toBe(false);
    expect(c.some((x) => x.startsWith("plugin install generateblocks"))).toBe(false);
    expect(c.some((x) => x.startsWith("scaffold child-theme"))).toBe(false);
  });

  it("activates installed-but-inactive plugins", async () => {
    const ctx = ctxWithVendor([]);
    const spy = mockWp(["generatepress", "faktory-demo"], [
      { name: "generateblocks", status: "inactive" },
      { name: "wordpress-seo", status: "active" },
      { name: "gp-premium", status: "inactive" },
    ]);
    const r = await installStack(ctx);
    const c = calls(spy);
    expect(c).toContain("plugin activate generateblocks");
    expect(c).toContain("plugin activate gp-premium");
    expect(c.some((x) => x.startsWith("plugin install"))).toBe(false);
    expect(r.missingVendor).toEqual(["generateblocks-pro", "gravityforms", "gravityformscli"]);
  });
});
