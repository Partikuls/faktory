import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps } from "../../src/wp.js";
import { installCore } from "../../src/provision/core.js";

const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "s3cret") };

function mockWp(handler: (args: string[]) => { stdout?: string; code?: number }) {
  return vi.spyOn(deps, "composeExec").mockImplementation(async (_ctx, _svc, cmd) => {
    const r = handler(cmd.slice(1));
    return { stdout: r.stdout ?? "", stderr: "", code: r.code ?? 0 };
  });
}
const calls = (spy: ReturnType<typeof mockWp>) => spy.mock.calls.map((c) => (c[2] as string[]).slice(1).join(" "));

describe("installCore", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("runs core install with url, admin and locale on a fresh site, then cleans sample content", async () => {
    const spy = mockWp((a) => {
      if (a.join(" ") === "core is-installed") return { code: 1 };
      if (a[0] === "post" && a[1] === "list") return { stdout: "[1,2]" };
      return {};
    });
    const r = await installCore(ctx, { title: "Maison Rivet" });
    expect(r.freshInstall).toBe(true);
    const c = calls(spy);
    expect(c.find((x) => x.startsWith("core install"))).toContain("--url=http://localhost:8100");
    expect(c.find((x) => x.startsWith("core install"))).toContain("--admin_password=s3cret");
    expect(c.find((x) => x.startsWith("core install"))).toContain("--admin_email=khelil@partikuls.com");
    expect(c).toContain("language core install fr_FR --activate");
    expect(c).toContain("rewrite structure /%postname%/");
    expect(c).toContain("option update timezone_string Europe/Paris");
    expect(c).toContain("post delete 1 2 --force");
    expect(c).toContain("plugin uninstall akismet hello --deactivate");
  });

  it("skips install and cleanup when already installed", async () => {
    const spy = mockWp(() => ({}));
    const r = await installCore(ctx, { title: "Maison Rivet" });
    expect(r.freshInstall).toBe(false);
    const c = calls(spy);
    expect(c.some((x) => x.startsWith("core install"))).toBe(false);
    expect(c.some((x) => x.startsWith("post delete"))).toBe(false);
    expect(c).toContain("option update timezone_string Europe/Paris");
  });
});
