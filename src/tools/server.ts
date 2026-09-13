import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { SiteContext } from "../docker.js";
import { runWp } from "../wp.js";
import { gbBuild, gbPreview, countBlocks, type PreviewOptions } from "../gb.js";
import { phpCheck } from "../php.js";

export const FAKTORY_SERVER = "faktory";
export const TOOL_WP = `mcp__${FAKTORY_SERVER}__wp`;
export const TOOL_GB_BUILD = `mcp__${FAKTORY_SERVER}__gb_build`;
export const TOOL_GB_PREVIEW = `mcp__${FAKTORY_SERVER}__gb_preview`;
export const TOOL_PHP_CHECK = `mcp__${FAKTORY_SERVER}__php_check`;
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
  const flag = args.find((a) => /^--(exec|require|ssh|path|http)(=|$)/.test(a));
  if (flag) return `${flag.split("=")[0]} is not allowed`;
  const positional = args.filter((a) => !a.startsWith("-"));
  for (const f of FORBIDDEN) if (f.every((p, i) => positional[i] === p)) return `wp ${f.join(" ")} is not allowed`;
  return undefined;
}
function clip(s: string): string { return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "\n[truncated]" : s; }

/** Resolve a tool-supplied path against the site dir; absolute paths inside the site dir are accepted, only escapes (`..`, or absolute paths outside it) are refused. (Same check as `isInside` in agent.ts, inlined: agent.ts imports this module.) */
export function resolveSitePath(ctx: SiteContext, rel: string): string {
  const base = resolve(ctx.siteDir), abs = resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + sep)) throw new Error(`Path "${rel}" must stay inside the site directory`);
  return abs;
}

const ok = (text: string): { content: { type: "text"; text: string }[] } => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string): { content: { type: "text"; text: string }[]; isError: true } => ({ content: [{ type: "text" as const, text }], isError: true });

export function gbBuildToolHandler(ctx: SiteContext) {
  return async (input: { tree: unknown; out: string }): Promise<{ content: { type: "text"; text: string }[]; isError?: true }> => {
    try {
      const abs = resolveSitePath(ctx, input.out);
      const markup = await gbBuild(ctx.config, input.tree);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, markup);
      const n = countBlocks(markup);
      return ok(`Wrote ${input.out} (${n} block${n === 1 ? "" : "s"}, ${Buffer.byteLength(markup)} bytes). Next: gb_preview to render it.`);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

export function gbPreviewToolHandler(ctx: SiteContext) {
  return async (input: { markup: string; out: string; palette?: Record<string, unknown> } & Omit<PreviewOptions, "palette">): Promise<{ content: { type: "text"; text: string }[]; isError?: true }> => {
    try {
      const src = resolveSitePath(ctx, input.markup);
      const dst = resolveSitePath(ctx, input.out);
      if (!existsSync(src)) return fail(`Markup file not found: ${input.markup} — run gb_build first`);
      mkdirSync(dirname(dst), { recursive: true });
      const { markup: _m, out: _o, ...opts } = input;
      const palette = input.palette ? Object.fromEntries(Object.entries(input.palette).filter(([, v]) => typeof v === "string")) as Record<string, string> : undefined;
      await gbPreview(ctx.config, src, dst, { ...opts, palette });
      return ok(`Wrote ${input.out}. Read it to inspect the compiled HTML/CSS, or open it in a browser.`);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

export function phpCheckToolHandler(ctx: SiteContext) {
  return async (input: { pluginDir: string }): Promise<{ content: { type: "text"; text: string }[]; isError?: true }> => {
    try {
      const abs = resolveSitePath(ctx, input.pluginDir);
      const r = await phpCheck(ctx.config, abs);
      return r.ok ? ok(r.output) : fail(r.output);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

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
  // Never use z.record(...) in a tool input shape: it breaks the Agent SDK's zod→JSON-schema
  // conversion (zod 4.6.2) and tools/list fails for the whole server (regression test:
  // "createFaktoryServer over MCP" in tests/unit/tools-server.test.ts). Use z.looseObject({})
  // for open-ended key/value shapes instead, and coerce/filter in the handler if needed.
  const gbBuildTool = tool(
    "gb_build",
    "Compile a GenerateBlocks tree (gb_build.py JSON: a node or an array of section nodes with type/tagName/styles/innerBlocks/content/htmlAttributes) into WordPress block markup and write it to `out` (path relative to the site directory).",
    {
      tree: z.union([z.looseObject({}), z.array(z.looseObject({}))]).describe("gb_build.py tree"),
      out: z.string().describe("Output markup path relative to the site dir, e.g. design/preview.gb.html"),
    },
    gbBuildToolHandler(ctx),
  );
  const gbPreviewTool = tool(
    "gb_preview",
    "Render compiled GenerateBlocks markup into a standalone preview HTML (stub GeneratePress shell). Optionally inject the palette (keys: base, base-2, base-3, contrast, contrast-2, contrast-3, accent, accent-2 → hex), Google Fonts, heading/body font families and the container width so the preview matches the design tokens.",
    {
      markup: z.string().describe("Markup path relative to the site dir (output of gb_build)"),
      out: z.string().describe("Preview HTML path relative to the site dir, e.g. preview.html"),
      palette: z.looseObject({}).optional().describe("GP palette slug → hex, e.g. { \"base\": \"#faf6ef\" }"),
      fonts: z.array(z.object({ family: z.string(), variants: z.string().optional() })).optional(),
      headingFont: z.string().optional(),
      bodyFont: z.string().optional(),
      containerWidth: z.number().int().optional(),
    },
    gbPreviewToolHandler(ctx),
  );
  const phpCheckTool = tool(
    "php_check",
    "Lint (php -l) and analyse (PHPStan level 5, WordPress-aware) every PHP file of a plugin directory. pluginDir is relative to the site directory, e.g. wp-content/plugins/faktory-produits. Fix every reported error before activating the plugin.",
    { pluginDir: z.string().describe("Plugin directory relative to the site dir") },
    phpCheckToolHandler(ctx),
  );
  return createSdkMcpServer({ name: FAKTORY_SERVER, version: "0.1.0", tools: [wp, gbBuildTool, gbPreviewTool, phpCheckTool] });
}
