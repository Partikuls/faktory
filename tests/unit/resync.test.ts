import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { artifactPath, writeJsonArtifact, writeTextArtifact, readJsonArtifact } from "../../src/artifacts.js";
import { DesignTokensShape, parseDesignTokens } from "../../src/schemas/design-tokens.js";
import { resyncFromMarkdown, deps } from "../../src/resync.js";
import { readFileSync } from "node:fs";

const tokens = JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8"));
function ctx(): SiteContext {
  return { config: loadConfig("/tmp/fk"), slug: "demo", siteDir: mkdtempSync(join(tmpdir(), "fk-rs-")), state: createState("demo", 8100, "pw") };
}
const opts = { mdKey: "designSystemMd" as const, jsonKey: "designTokensJson" as const, shape: DesignTokensShape, parse: parseDesignTokens, what: "design tokens" };

describe("resyncFromMarkdown", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("does nothing when the markdown is not newer", async () => {
    const c = ctx();
    writeTextArtifact(c, "designSystemMd", "# ds"); writeJsonArtifact(c, "designTokensJson", tokens);
    const spy = vi.spyOn(deps, "runAgent");
    expect(await resyncFromMarkdown(c, opts)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
  it("re-extracts with a structured query using the resync model and Read only, then rewrites the json", async () => {
    const c = ctx();
    writeTextArtifact(c, "designSystemMd", "# ds"); writeJsonArtifact(c, "designTokensJson", tokens);
    const future = new Date(Date.now() + 5000); utimesSync(artifactPath(c, "designSystemMd"), future, future);
    const edited = { ...tokens, radius: 4 };
    const spy = vi.spyOn(deps, "runAgent").mockResolvedValue({ text: "", transcript: "", structured: edited, costUsd: 0.1, numTurns: 2 });
    const r = await resyncFromMarkdown(c, opts);
    expect(r?.radius).toBe(4);
    expect(readJsonArtifact(c, "designTokensJson", parseDesignTokens).radius).toBe(4);
    const call = spy.mock.calls[0][1];
    expect(call.stage).toBe("resync");
    expect(call.allowedTools).toEqual(["Read"]);
    expect(call.outputFormat?.type).toBe("json_schema");
    expect(call.prompt).toContain("design-system.md");
    expect(call.prompt).toContain("design-tokens.json");
  });
  it("throws a readable error when the re-extracted json is invalid", async () => {
    const c = ctx();
    writeTextArtifact(c, "designSystemMd", "# ds"); writeJsonArtifact(c, "designTokensJson", tokens);
    const future = new Date(Date.now() + 5000); utimesSync(artifactPath(c, "designSystemMd"), future, future);
    vi.spyOn(deps, "runAgent").mockResolvedValue({ text: "", transcript: "", structured: { ...tokens, radius: 99 }, costUsd: 0.1, numTurns: 2 });
    await expect(resyncFromMarkdown(c, opts)).rejects.toThrow(/Invalid design tokens/);
  });
});
