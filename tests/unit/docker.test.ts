import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import { composeArgs, composeEnv, composeFile, siteUrl, type SiteContext } from "../../src/docker.js";

const config = loadConfig("/tmp/fk-root");
const ctx: SiteContext = { config, slug: "demo", siteDir: "/tmp/fk-root/sites/demo", state: createState("demo", 8123, "pw") };

describe("docker helpers", () => {
  it("builds compose args with project name and file", () => {
    expect(composeArgs(ctx, "up", "-d")).toEqual(["compose", "-p", "faktory-demo", "-f", composeFile(config), "up", "-d"]);
    expect(composeFile(config)).toBe("/tmp/fk-root/docker/docker-compose.yml");
  });
  it("exposes port, site dir and vendor dir in env", () => {
    const env = composeEnv(ctx);
    expect(env.FAKTORY_PORT).toBe("8123");
    expect(env.FAKTORY_SITE_DIR).toBe("/tmp/fk-root/sites/demo");
    expect(env.FAKTORY_VENDOR_DIR).toBe("/tmp/fk-root/docker/vendor");
  });
  it("computes the site url", () => {
    expect(siteUrl(ctx)).toBe("http://localhost:8123");
  });
});
