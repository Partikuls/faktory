import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { runSite, destroySite, loadContext } from "../../src/pipeline.js";
import { wpJson } from "../../src/wp.js";

describe.skipIf(!process.env.FAKTORY_DOCKER)("provision stage (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8192 };
  beforeAll(async () => { await initSite(config, { slug: "itprov", briefPath: "fixtures/briefs/boulangerie.md" }); });
  afterAll(async () => { await destroySite(config, "itprov"); });

  it("installs WordPress fr_FR with GeneratePress, GenerateBlocks, Yoast and the child theme, and is idempotent", async () => {
    const s1 = await runSite(config, "itprov", { only: "provision" });
    expect(s1.stages.provision.status, s1.stages.provision.message).toBe("done");
    const ctx = loadContext(config, "itprov");
    const themes = await wpJson<{ name: string; status: string }[]>(ctx, ["theme", "list", "--fields=name,status"]);
    expect(themes.find((t) => t.name === "faktory-itprov")?.status).toBe("active");
    expect(themes.some((t) => t.name === "generatepress")).toBe(true);
    const plugins = await wpJson<{ name: string; status: string }[]>(ctx, ["plugin", "list", "--fields=name,status"]);
    for (const p of ["generateblocks", "wordpress-seo"]) expect(plugins.find((x) => x.name === p)?.status).toBe("active");
    const locale = await wpJson<string>(ctx, ["option", "get", "WPLANG"]);
    expect(locale).toBe("fr_FR");
    const res = await fetch(`http://localhost:${ctx.state.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('lang="fr-FR"');
    const s2 = await runSite(config, "itprov", { only: "provision" });
    expect(s2.stages.provision.message).toContain("already installed");
  });
});
