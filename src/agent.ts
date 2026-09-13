import { join, resolve, sep } from "node:path";
import { query, type HookCallback, type PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import type { FaktoryConfig } from "./config.js";
import type { SiteContext } from "./docker.js";
import { writeState, type SiteState } from "./state.js";
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
    if (fp && isInside(siteDir, resolve(siteDir, fp))) return {};
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

export const FAKTORY_SKILLS = ["generatepress-generateblocks", "wp-plugin-development", "wp-block-development", "wp-wpcli-and-ops"] as const;

export function pluginSkillNames(): string[] {
  return FAKTORY_SKILLS.map((name) => `faktory-skills:${name}`);
}

export function addCost(state: SiteState, usd: number): SiteState {
  return { ...state, costUsd: Math.round((state.costUsd + usd) * 10000) / 10000 };
}

export function remainingBudget(ctx: SiteContext): number {
  return Math.max(0.05, Math.round((ctx.config.maxCostUsd - ctx.state.costUsd) * 100) / 100);
}

export type AgentRun = { text: string; structured?: unknown; costUsd: number; sessionId?: string; numTurns: number };

export type AgentOptions = {
  stage: string; prompt: string; systemPrompt?: string; allowedTools: string[];
  outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
  maxTurns?: number; model?: string;
  /** SDK session id of a previous run to continue (used by `runValidated` for the one retry). */
  resume?: string;
};
export type AgentRunner = (ctx: SiteContext, opts: AgentOptions) => Promise<AgentRun>;

export async function runAgent(
  ctx: SiteContext,
  opts: AgentOptions,
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
      skills: pluginSkillNames(),
      plugins: [{ type: "local", path: pluginPath(ctx.config) }],
      mcpServers: { [FAKTORY_SERVER]: server },
      // only our in-process server: without this the CLI also loads the user's claude.ai connectors (~180 tools) into every agent
      strictMcpConfig: true,
      hooks: { PreToolUse: [{ matcher: "Write|Edit|MultiEdit|NotebookEdit", hooks: [writeGuard(ctx.siteDir)] }] },
      maxTurns: opts.maxTurns ?? 60,
      maxBudgetUsd: remainingBudget(ctx),
      outputFormat: opts.outputFormat,
      resume: opts.resume,
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text.trim()) console.log(`  [${opts.stage}] ${block.text.trim().split("\n")[0].slice(0, 160)}`);
      }
    }
    if (message.type === "result") {
      ctx.state = addCost(ctx.state, message.total_cost_usd);
      writeState(ctx.siteDir, ctx.state);
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
  return out;
}

export function retryPrompt(error: string): string {
  return [
    "Ta réponse précédente n'a pas passé la validation :",
    error,
    "Corrige uniquement ces points et réponds à nouveau, dans le même format. Ne change rien d'autre.",
  ].join("\n");
}

export type ValidatedRun<T> = { value: T; costUsd: number; attempts: 1 | 2; run: AgentRun };

/**
 * Run an agent and validate its output; on a validation error, resume the same session once with the error
 * (spec: "retry 1 fois sur erreur structurée"). The cost of both attempts is summed.
 */
export async function runValidated<T>(
  run: AgentRunner, ctx: SiteContext, opts: AgentOptions, validate: (r: AgentRun) => T | Promise<T>,
): Promise<ValidatedRun<T>> {
  const first = await run(ctx, opts);
  let error: string;
  try {
    return { value: await validate(first), costUsd: first.costUsd, attempts: 1, run: first };
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  console.warn(`↻ ${opts.stage}: output failed validation, retrying once — ${error.split("\n")[0].slice(0, 200)}`);
  const second = await run(ctx, { ...opts, prompt: retryPrompt(error), resume: first.sessionId });
  const costUsd = Math.round((first.costUsd + second.costUsd) * 10000) / 10000;
  try {
    return { value: await validate(second), costUsd, attempts: 2, run: second };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${opts.stage}: output still invalid after one retry — ${message}`);
  }
}
