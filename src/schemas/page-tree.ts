import { z } from "zod";
import type { Page } from "./site-spec.js";

/** Node types understood by gb_build.py (plugin/skills/generatepress-generateblocks/scripts/gb_build.py BLOCKS + raw). */
export const GB_NODE_TYPES = ["element", "text", "media", "shape", "looper", "loop-item", "query", "raw"] as const;

const NodeBase = z.object({
  type: z.enum(GB_NODE_TYPES),
  tagName: z.string().optional(),
  styles: z.record(z.string(), z.unknown()).optional(),
  globalClasses: z.array(z.string()).optional(),
  htmlAttributes: z.record(z.string(), z.string()).optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  content: z.string().optional(),
  rawMarkup: z.string().optional(),
  uniqueId: z.string().optional(),
});

export type GbNode = z.infer<typeof NodeBase> & { innerBlocks?: GbNode[] };

export const GbNodeSchema: z.ZodType<GbNode> = z.object({
  ...NodeBase.shape,
  innerBlocks: z.lazy(() => z.array(GbNodeSchema)).optional(),
});

/** A page = an array of top-level sections (gb_build.py stacks them). */
export const PageTreeSchema = z.array(GbNodeSchema).min(1);
export type PageTree = GbNode[];

export function parsePageTree(data: unknown): PageTree {
  const r = PageTreeSchema.safeParse(data);
  if (!r.success) throw new Error(`Invalid page tree: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

export const featureMarker = (id: string): string => `<!-- faktory:feature:${id} -->`;
export const formMarker = (id: string): string => `<!-- faktory:form:${id} -->`;
const MARKER_RE = /<!-- faktory:(feature|form):([a-z][a-z0-9_]*) -->/g;

/** Depth-first visit; `path` is a JSON-pointer-ish label like `[1].innerBlocks[0]` for error messages. */
export function walk(nodes: GbNode[], visit: (node: GbNode, path: string) => void, prefix = ""): void {
  nodes.forEach((n, i) => {
    const path = `${prefix}[${i}]`;
    visit(n, path);
    if (n.innerBlocks?.length) walk(n.innerBlocks, visit, `${path}.innerBlocks`);
  });
}

export function findMarkers(tree: PageTree): { kind: "feature" | "form"; id: string }[] {
  const out: { kind: "feature" | "form"; id: string }[] = [];
  walk(tree, (n) => {
    if (n.type !== "raw" || !n.rawMarkup) return;
    for (const m of n.rawMarkup.matchAll(MARKER_RE)) out.push({ kind: m[1] as "feature" | "form", id: m[2] });
  });
  return out;
}

/** Markers a page must carry so later stages (plugins, forms) can replace them. */
export function requiredMarkers(page: Page): string[] {
  const out: string[] = [];
  for (const s of page.sections) {
    if (s.type === "custom-query" && s.feature) out.push(featureMarker(s.feature));
    if ((s.type === "form" || s.type === "contact") && s.form) out.push(formMarker(s.form));
  }
  return Array.from(new Set(out));
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;

function hexIssues(value: unknown, at: string, issues: string[]): void {
  if (typeof value === "string") {
    const m = value.replace(/url\([^)]*\)/g, "").match(HEX_RE);
    if (m) issues.push(`${at}: hex color ${m[0]} — use var(--base), var(--accent)… instead`);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) hexIssues(v, `${at}.${k}`, issues);
  }
}

/** Page-level rules the zod shape cannot express. Returns human-readable issues (empty = valid). */
export function validatePageTree(tree: PageTree, page: Page): string[] {
  const issues: string[] = [];
  let h1 = 0;
  tree.forEach((n, i) => { if (n.type !== "element") issues.push(`[${i}]: root nodes must be element sections (got ${n.type})`); });
  walk(tree, (n, path) => {
    if (n.styles) hexIssues(n.styles, `${path}.styles`, issues);
    if (n.type === "text" && n.tagName?.toLowerCase() === "h1") h1++;
    if (n.type === "media" && !n.htmlAttributes?.alt) issues.push(`${path}: media without alt`);
  });
  if (h1 !== 1) issues.push(`page must have exactly one h1 (text node with tagName "h1"), found ${h1}`);
  const present = new Set(findMarkers(tree).map((m) => (m.kind === "feature" ? featureMarker(m.id) : formMarker(m.id))));
  for (const marker of requiredMarkers(page)) {
    if (!present.has(marker)) issues.push(`missing marker node { "type": "raw", "rawMarkup": "${marker}" } (section "${page.sections.find((s) => (s.feature && featureMarker(s.feature) === marker) || (s.form && formMarker(s.form) === marker))?.heading}")`);
  }
  return issues;
}

export function assertPageTree(tree: PageTree, page: Page): void {
  const issues = validatePageTree(tree, page);
  if (issues.length) throw new Error(`pages/${page.slug}.gb.json is invalid:\n- ${issues.join("\n- ")}`);
}
