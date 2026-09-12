import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { initSite } from "../../src/workspace.js";
import { composeUp, composeDown, composeExec, type SiteContext } from "../../src/docker.js";
import { waitForDb } from "../../src/wp.js";

describe.skipIf(!process.env.FAKTORY_DOCKER)("docker stack", () => {
  const repoRoot = resolve(".");
  const config = { ...loadConfig(repoRoot), sitesRoot: mkdtempSync(join(tmpdir(), "faktory-sites-")), portBase: 8190 };
  const { dir, state } = initSite(config, { slug: "itdocker", briefPath: "fixtures/briefs/boulangerie.md" });
  const ctx: SiteContext = { config, slug: "itdocker", siteDir: dir, state };

  afterAll(async () => { await composeDown(ctx, { volumes: true }); });

  it("boots the stack and wp-cli can reach the db", async () => {
    const up = await composeUp(ctx);
    expect(up.code, up.stderr).toBe(0);
    await waitForDb(ctx);
    const info = await composeExec(ctx, "wpcli", ["wp", "--info"]);
    expect(info.code, info.stderr).toBe(0);
    expect(info.stdout).toContain("WP-CLI version");
    const db = await composeExec(ctx, "wpcli", ["wp", "db", "check"]);
    expect(db.code, db.stderr).toBe(0);
  });
});
