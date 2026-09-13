import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps as wpDeps } from "../../src/wp.js";
import { pageMarkupPath } from "../../src/artifacts.js";
import { GP_PAGE_META } from "../../src/provision/pages.js";
import { compilePage, publishPage, deps } from "../../src/pages/publish.js";

const MARKUP = "<!-- wp:generateblocks/element {\"uniqueId\":\"a1\"} -->\n<section class=\"gb-element-a1\"></section>\n<!-- /wp:generateblocks/element -->\n";
function ctx(): SiteContext {
  const root = mkdtempSync(join(tmpdir(), "fk-pub-"));
  return { config: loadConfig(root), slug: "d", siteDir: join(root, "sites", "d"), state: createState("d", 8100, "pw") };
}

describe("compilePage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("compiles the tree with gb_build and writes pages/<slug>.html", async () => {
    const c = ctx();
    const build = vi.spyOn(deps, "gbBuild").mockResolvedValue(MARKUP);
    const tree = [{ type: "element" as const, tagName: "section" }];
    const out = await compilePage(c, "accueil", tree);
    expect(build).toHaveBeenCalledWith(c.config, tree);
    expect(out).toBe(MARKUP);
    expect(existsSync(pageMarkupPath(c, "accueil"))).toBe(true);
    expect(readFileSync(pageMarkupPath(c, "accueil"), "utf8")).toBe(MARKUP);
  });
  it("propagates a gb_build failure without writing the html", async () => {
    const c = ctx();
    vi.spyOn(deps, "gbBuild").mockRejectedValue(new Error("gb_build.py failed (exit 1): KeyError"));
    await expect(compilePage(c, "accueil", [{ type: "element" }])).rejects.toThrow(/gb_build.py failed/);
    expect(existsSync(pageMarkupPath(c, "accueil"))).toBe(false);
  });
});

describe("publishPage", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("updates the post content from stdin, publishes it and re-asserts the GP page meta", async () => {
    const c = ctx();
    const exec = vi.spyOn(wpDeps, "composeExec").mockResolvedValue({ stdout: "Success: Updated post 12.", stderr: "", code: 0 });
    await publishPage(c, 12, MARKUP);
    const calls = exec.mock.calls.map((k: any) => ({ args: (k[2] as string[]).slice(1).join(" "), input: k[3]?.input }));
    expect(calls[0]).toEqual({ args: "post update 12 - --post_status=publish", input: MARKUP });
    for (const [k, v] of GP_PAGE_META) expect(calls.map((x) => x.args)).toContain(`post meta update 12 ${k} ${v}`);
    expect(calls).toHaveLength(1 + GP_PAGE_META.length);
  });
  it("throws when wp fails", async () => {
    const c = ctx();
    vi.spyOn(wpDeps, "composeExec").mockResolvedValue({ stdout: "", stderr: "Error: Could not find the post.", code: 1 });
    await expect(publishPage(c, 99, MARKUP)).rejects.toThrow(/post update 99 - --post_status=publish failed: Error: Could not find the post/);
  });
});
