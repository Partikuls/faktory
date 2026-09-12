import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { composeUp, composeDown, type SiteContext } from "../../src/docker.js";
import { waitForDb, wpOk } from "../../src/wp.js";

describe.skipIf(!process.env.FAKTORY_DOCKER)("wp runner (docker)", () => {
  const config = { ...loadConfig(resolve(".")), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8191 };
  let ctx: SiteContext;
  beforeAll(async () => {
    const { dir, state } = await initSite(config, { slug: "itwp", briefPath: "fixtures/briefs/boulangerie.md" });
    ctx = { config, slug: "itwp", siteDir: dir, state };
    const up = await composeUp(ctx);
    if (up.code !== 0) throw new Error(up.stderr);
  });
  afterAll(async () => { await composeDown(ctx, { volumes: true }); });

  it("waits for db and reads core version", async () => {
    await waitForDb(ctx);
    const version = await wpOk(ctx, ["core", "version"]);
    expect(version).toMatch(/^\d+\.\d+/);
  });
});
