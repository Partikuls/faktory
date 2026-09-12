import { describe, it, expect } from "vitest";
import { isInside, writeGuard, pluginPath, resolveModel, effectiveAllowedTools, pluginSkillNames, addCost } from "../../src/agent.js";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";

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
