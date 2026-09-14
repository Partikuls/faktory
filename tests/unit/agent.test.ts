import { describe, it, expect } from "vitest";
import { isInside, writeGuard, pluginPath, resolveModel, effectiveAllowedTools, pluginSkillNames, addCost, agentQueryOptions } from "../../src/agent.js";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import { createFaktoryServer, FAKTORY_SERVER } from "../../src/tools/server.js";
import type { SiteContext } from "../../src/docker.js";

describe("isInside", () => {
  it("accepts children and rejects escapes", () => {
    expect(isInside("/a/b", "/a/b/c.txt")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b", "/a/b/../c")).toBe(false);
    expect(isInside("/a/b", "/a/bc/x")).toBe(false);
  });
});

describe("writeGuard", () => {
  const guard = writeGuard("/site");
  const call = (tool: string, file_path: string) =>
    guard({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { file_path }, session_id: "s", transcript_path: "", cwd: "/site" } as never, "t1", { signal: new AbortController().signal });
  it("denies writes outside the site dir", async () => {
    const r = (await call("Write", "/etc/passwd")) as { hookSpecificOutput?: { permissionDecision?: string } };
    expect(r.hookSpecificOutput?.permissionDecision).toBe("deny");
  });
  it("allows writes inside the site dir", async () => {
    const r = await call("Edit", "/site/pages/home.gb.json");
    expect(r).toEqual({});
  });
  it("ignores non-write tools", async () => {
    const r = await call("Read", "/etc/passwd");
    expect(r).toEqual({});
  });
  it("resolves a relative file_path against the site dir, not process.cwd()", async () => {
    const r = await call("Write", "design-system.md");
    expect(r).toEqual({});
  });
  it("denies a relative path that escapes the site dir", async () => {
    const r = (await call("Write", "../x")) as { hookSpecificOutput?: { permissionDecision?: string } };
    expect(r.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  describe("with writeRoots", () => {
    const scoped = writeGuard("/site", ["pages", "wp-content/plugins/faktory-x"]);
    const callScoped = (file_path: string) =>
      scoped({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path }, session_id: "s", transcript_path: "", cwd: "/site" } as never, "t1", { signal: new AbortController().signal });
    it("allows writes under any root, relative or absolute", async () => {
      expect(await callScoped("pages/x.gb.json")).toEqual({});
      expect(await callScoped("/site/wp-content/plugins/faktory-x/includes/a.php")).toEqual({});
    });
    it("denies writes elsewhere in the site dir and names the roots", async () => {
      const r = (await callScoped("/site/design-system.md")) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
      expect(r.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(r.hookSpecificOutput?.permissionDecisionReason).toBe("Writes are restricted to /site/pages, /site/wp-content/plugins/faktory-x");
      const sibling = (await callScoped("/site/wp-content/plugins/faktory-xy/a.php")) as { hookSpecificOutput?: { permissionDecision?: string } };
      expect(sibling.hookSpecificOutput?.permissionDecision).toBe("deny");
    });
  });
});

describe("resolveModel / pluginPath", () => {
  const config = loadConfig("/tmp/fk");
  it("falls back stage → default", () => {
    expect(resolveModel({ ...config, models: { default: "claude-opus-5", spec: "claude-sonnet-5" } }, "spec")).toBe("claude-sonnet-5");
    expect(resolveModel(config, "pages")).toBe("claude-opus-5");
    expect(resolveModel(config, "pages", "claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });
  it("points at <repo>/plugin", () => {
    expect(pluginPath(config)).toBe("/tmp/fk/plugin");
  });
});

describe("effectiveAllowedTools", () => {
  it("appends Skill, deduplicated", () => {
    expect(effectiveAllowedTools(["mcp__faktory__wp"])).toEqual(["mcp__faktory__wp", "Skill"]);
    expect(effectiveAllowedTools(["mcp__faktory__wp", "Skill"])).toEqual(["mcp__faktory__wp", "Skill"]);
  });
});

describe("pluginSkillNames", () => {
  it("returns the four faktory-skills-qualified names in order", () => {
    expect(pluginSkillNames()).toEqual([
      "faktory-skills:generatepress-generateblocks",
      "faktory-skills:wp-plugin-development",
      "faktory-skills:wp-block-development",
      "faktory-skills:wp-wpcli-and-ops",
    ]);
  });
});

describe("addCost", () => {
  it("adds and rounds to 4 decimals", () => {
    const state = createState("d", 8100, "pw");
    expect(addCost(state, 0.12345).costUsd).toBe(0.1235);
  });
  it("avoids float drift across repeated additions", () => {
    const state = createState("d", 8100, "pw");
    const next = addCost(addCost(state, 0.1), 0.2);
    expect(next.costUsd).toBe(0.3);
  });
});

describe("agentQueryOptions", () => {
  const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "d", siteDir: "/tmp/fk/sites/d", state: createState("d", 8100, "pw") };
  const server = createFaktoryServer(ctx);
  it("builds the exact options passed to query()", () => {
    const opts = agentQueryOptions(ctx, { stage: "pages", prompt: "go", allowedTools: ["Read"] }, server, 12.5);
    expect(opts.strictMcpConfig).toBe(true);
    expect(opts.settingSources).toEqual([]);
    expect(opts.allowedTools?.at(-1)).toBe("Skill");
    expect(opts.mcpServers).toEqual({ [FAKTORY_SERVER]: server });
    expect(opts.maxTurns).toBe(60);
    expect(opts.resume).toBeUndefined();
    expect(opts.maxBudgetUsd).toBe(12.5);
  });
  it("defaults maxTurns to 60 and honours an override", () => {
    expect(agentQueryOptions(ctx, { stage: "pages", prompt: "go", allowedTools: [] }, server, 12.5).maxTurns).toBe(60);
    expect(agentQueryOptions(ctx, { stage: "pages", prompt: "go", allowedTools: [], maxTurns: 10 }, server, 12.5).maxTurns).toBe(10);
  });
  it("passes resume through", () => {
    expect(agentQueryOptions(ctx, { stage: "pages", prompt: "go", allowedTools: [], resume: "s1" }, server, 12.5).resume).toBe("s1");
  });
  it("builds the write guard from opts.writeRoots", async () => {
    const opts = agentQueryOptions(ctx, { stage: "pages", prompt: "go", allowedTools: [], writeRoots: ["pages"] }, server, 12.5);
    const guard = opts.hooks!.PreToolUse![0].hooks[0];
    const call = (file_path: string) =>
      guard({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path }, session_id: "s", transcript_path: "", cwd: ctx.siteDir } as never, "t1", { signal: new AbortController().signal });
    expect(await call(`${ctx.siteDir}/design-system.md`)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(await call(`${ctx.siteDir}/pages/a.json`)).toEqual({});
  });
});
