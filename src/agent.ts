import { join, resolve, sep } from "node:path";
import { query, type HookCallback, type PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import type { FaktoryConfig } from "./config.js";
import type { SiteContext } from "./docker.js";
import { writeState } from "./state.js";
import { createFaktoryServer, FAKTORY_SERVER } from "./tools/server.js";

export function isInside(base: string, target: string): boolean {
  const b = resolve(base), t = resolve(target);
  return t === b || t.startsWith(b + sep);
}

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export function writeGuard(siteDir: string): HookCallback {
  return async (input) => {
    const pre = input as PreToolUseHookInput;
    if (pre.hook_event_name !== "PreToolUse" || !WRITE_TOOLS.has(pre.tool_name)) return {};
    const fp = (pre.tool_input as { file_path?: string; notebook_path?: string })?.file_path
      ?? (pre.tool_input as { notebook_path?: string })?.notebook_path;
    if (fp && isInside(siteDir, fp)) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Writes are restricted to ${siteDir}`,
      },
    };
  };
}

export function pluginPath(config: FaktoryConfig): string {
  return join(config.repoRoot, "plugin");
}

export function resolveModel(config: FaktoryConfig, stage: string, override?: string): string {
  return override ?? config.models[stage] ?? config.models.default;
}

export function effectiveAllowedTools(tools: string[]): string[] {
  return Array.from(new Set([...tools, "Skill"]));
}

export type AgentRun = { text: string; structured?: unknown; costUsd: number; sessionId?: string; numTurns: number };

export async function runAgent(
  ctx: SiteContext,
  opts: {
    stage: string; prompt: string; systemPrompt?: string; allowedTools: string[];
    outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
    maxTurns?: number; model?: string;
  },
): Promise<AgentRun> {
  const server = createFaktoryServer(ctx);
  let out: AgentRun | undefined;
  for await (const message of query({
    prompt: opts.prompt,
    options: {
      cwd: ctx.siteDir,
      model: resolveModel(ctx.config, opts.stage, opts.model),
      systemPrompt: opts.systemPrompt,
      allowedTools: effectiveAllowedTools(opts.allowedTools),
      settingSources: [],
      skills: "all",
      plugins: [{ type: "local", path: pluginPath(ctx.config) }],
      mcpServers: { [FAKTORY_SERVER]: server },
      hooks: { PreToolUse: [{ matcher: "Write|Edit|MultiEdit|NotebookEdit", hooks: [writeGuard(ctx.siteDir)] }] },
      maxTurns: opts.maxTurns ?? 60,
      outputFormat: opts.outputFormat,
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text.trim()) console.log(`  [${opts.stage}] ${block.text.trim().split("\n")[0].slice(0, 160)}`);
      }
    }
    if (message.type === "result") {
      if (message.subtype !== "success") throw new Error(`Agent stage "${opts.stage}" ended with ${message.subtype}`);
      out = {
        text: message.result,
        structured: (message as { structured_output?: unknown }).structured_output,
        costUsd: message.total_cost_usd,
        sessionId: message.session_id,
        numTurns: message.num_turns,
      };
    }
  }
  if (!out) throw new Error(`Agent stage "${opts.stage}" produced no result`);
  ctx.state = { ...ctx.state, costUsd: Math.round((ctx.state.costUsd + out.costUsd) * 10000) / 10000 };
  writeState(ctx.siteDir, ctx.state);
  return out;
}
