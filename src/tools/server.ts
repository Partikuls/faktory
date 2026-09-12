import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { SiteContext } from "../docker.js";
import { runWp } from "../wp.js";

export const FAKTORY_SERVER = "faktory";
export const TOOL_WP = `mcp__${FAKTORY_SERVER}__wp`;
const MAX_OUT = 20_000;
const FORBIDDEN: string[][] = [
  ["db", "drop"],
  ["db", "reset"],
  ["db", "clean"],
  ["db", "query"],
  ["db", "import"],
  ["site", "empty"],
  ["core", "download"],
  ["eval"],
  ["eval-file"],
  ["shell"],
];

function forbidden(args: string[]): string | undefined {
  if (args.some((a) => a === "--allow-root")) return "--allow-root is not allowed";
  const positional = args.filter((a) => !a.startsWith("-"));
  for (const f of FORBIDDEN) if (f.every((p, i) => positional[i] === p)) return `wp ${f.join(" ")} is not allowed`;
  return undefined;
}
function clip(s: string): string { return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "\n[truncated]" : s; }

export function wpToolHandler(ctx: SiteContext) {
  return async (input: { args: string[]; stdin?: string }) => {
    const reason = forbidden(input.args);
    if (reason) return { content: [{ type: "text" as const, text: reason }], isError: true };
    const r = await runWp(ctx, input.args, { input: input.stdin });
    if (r.code !== 0) {
      return { content: [{ type: "text" as const, text: clip(`exit ${r.code}\n${r.stderr}\n${r.stdout}`.trim()) }], isError: true };
    }
    return { content: [{ type: "text" as const, text: clip(r.stdout.trim()) }] };
  };
}

export function createFaktoryServer(ctx: SiteContext) {
  const wp = tool(
    "wp",
    "Run a WP-CLI command against this site's WordPress (inside Docker). Pass args as an array, e.g. [\"post\",\"list\",\"--post_type=page\",\"--format=json\"]. Use stdin for post content. Destructive db/site commands and arbitrary PHP (eval, shell) are refused.",
    { args: z.array(z.string()).min(1).describe("wp-cli arguments without the leading 'wp'"), stdin: z.string().optional().describe("Text piped to the command's stdin") },
    wpToolHandler(ctx),
  );
  return createSdkMcpServer({ name: FAKTORY_SERVER, version: "0.1.0", tools: [wp] });
}
