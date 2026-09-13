import { z } from "zod";
import type { Page } from "./site-spec.js";

/** Node types understood by gb_build.py (plugin/skills/generatepress-generateblocks/scripts/gb_build.py BLOCKS + raw). */
export const GB_NODE_TYPES = ["element", "text", "media", "shape", "looper", "loop-item", "query", "raw"] as const;

const NodeBase = z.strictObject({
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

// z.strictObject (not z.object): unknown keys (e.g. a typo like "tagname" or "innerblocks")
// are a validation error instead of being silently dropped.
export const GbNodeSchema: z.ZodType<GbNode> = z.strictObject({
  ...NodeBase.shape,
  innerBlocks: z.lazy(() => z.array(GbNodeSchema)).optional(),
});

/** A page = an array of top-level sections (gb_build.py stacks them). */
export const PageTreeSchema = z.array(GbNodeSchema).min(1);
export type PageTree = GbNode[];

/** Format a zod issue path like `walk`'s labels: numeric indices in brackets, e.g. `[0].innerBlocks[1]`. */
function formatIssuePath(path: (string | number | symbol)[]): string {
  return path.reduce<string>((s, p) => (typeof p === "number" ? `${s}[${p}]` : `${s}${s ? "." : ""}${String(p)}`), "");
}

export function parsePageTree(data: unknown): PageTree {
  const r = PageTreeSchema.safeParse(data);
  if (!r.success) throw new Error(`Invalid page tree: ${r.error.issues.map((i) => `${formatIssuePath(i.path)}: ${i.message}`).join("; ")}`);
  return r.data;
}

export const featureMarker = (id: string): string => `<!-- faktory:feature:${id} -->`;
export const formMarker = (id: string): string => `<!-- faktory:form:${id} -->`;
const MARKER_RE = /<!-- faktory:(feature|form):([a-z][a-z0-9_]*) -->/g;
const MARKER_ONE_RE = /^<!-- faktory:(feature|form):([a-z][a-z0-9_]*) -->$/;

/**
 * Placeholder wrapper convention: the 3 example cards (or the "bientôt disponible" card) and the
 * marker node for a given feature/form sit together inside one `element` node carrying this
 * attribute. Phase 4/5 locate that element with `findWrapper` and replace it wholesale.
 */
export const FEATURE_WRAPPER_ATTR = "data-faktory-feature";
export const FORM_WRAPPER_ATTR = "data-faktory-form";

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

/** Depth-first search for the `element` node whose `htmlAttributes[<attr for kind>] === id`; phase 4/5 replace that node wholesale. */
export function findWrapper(tree: PageTree, kind: "feature" | "form", id: string): { node: GbNode; path: string } | undefined {
  const attr = kind === "feature" ? FEATURE_WRAPPER_ATTR : FORM_WRAPPER_ATTR;
  let found: { node: GbNode; path: string } | undefined;
  walk(tree, (n, path) => {
    if (found || n.type !== "element") return;
    if (n.htmlAttributes?.[attr] === id) found = { node: n, path };
  });
  return found;
}

/** True when the marker node for `kind`/`id` sits at any depth inside its wrapper element. */
function markerIsWrapped(tree: PageTree, kind: "feature" | "form", id: string): boolean {
  const attr = kind === "feature" ? FEATURE_WRAPPER_ATTR : FORM_WRAPPER_ATTR;
  const marker = kind === "feature" ? featureMarker(id) : formMarker(id);
  let wrapped = false;
  const visit = (nodes: GbNode[], ancestors: GbNode[]): void => {
    for (const n of nodes) {
      if (n.type === "raw" && n.rawMarkup === marker && ancestors.some((a) => a.type === "element" && a.htmlAttributes?.[attr] === id)) {
        wrapped = true;
      }
      if (n.innerBlocks?.length) visit(n.innerBlocks, [...ancestors, n]);
    }
  };
  visit(tree, []);
  return wrapped;
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

/** Scripts, iframes, javascript: URLs and on* event handlers are never allowed in generated markup. */
const DENYLIST_RE = /<script\b|<iframe\b|javascript:|\bon[a-z]+\s*=/i;

function denylistIssue(value: string | undefined, path: string, issues: string[]): void {
  if (typeof value !== "string") return;
  const m = value.match(DENYLIST_RE);
  if (m) issues.push(`${path}: forbidden markup (${m[0]}) — scripts, iframes, javascript: URLs and on* handlers are not allowed`);
}

/** Page-level rules the zod shape cannot express. Returns human-readable issues (empty = valid). */
export function validatePageTree(tree: PageTree, page: Page): string[] {
  const issues: string[] = [];
  let h1 = 0;
  tree.forEach((n, i) => { if (n.type !== "element") issues.push(`[${i}]: root nodes must be element sections (got ${n.type})`); });
  walk(tree, (n, path) => {
    if (n.styles) hexIssues(n.styles, `${path}.styles`, issues);
    if (typeof n.htmlAttributes?.style === "string") hexIssues(n.htmlAttributes.style, `${path}.htmlAttributes.style`, issues);
    if (n.tagName?.toLowerCase() === "h1") h1++;
    if (n.type === "media" && !n.htmlAttributes?.alt) issues.push(`${path}: media without alt`);
    if (n.type === "raw" && !n.rawMarkup) issues.push(`${path}: raw node without rawMarkup`);
    if (n.type === "text" && !n.content) issues.push(`${path}: text node without content`);
    denylistIssue(n.content, path, issues);
    denylistIssue(n.rawMarkup, path, issues);
    if (n.htmlAttributes) for (const v of Object.values(n.htmlAttributes)) denylistIssue(v, path, issues);
  });
  if (h1 !== 1) issues.push(`page must have exactly one h1 (text node with tagName "h1"), found ${h1}`);
  const present = new Set(findMarkers(tree).map((m) => (m.kind === "feature" ? featureMarker(m.id) : formMarker(m.id))));
  for (const marker of requiredMarkers(page)) {
    if (!present.has(marker)) {
      issues.push(`missing marker node { "type": "raw", "rawMarkup": "${marker}" } (section "${page.sections.find((s) => (s.feature && featureMarker(s.feature) === marker) || (s.form && formMarker(s.form) === marker))?.heading}")`);
      continue;
    }
    const m = marker.match(MARKER_ONE_RE)!;
    const kind = m[1] as "feature" | "form", id = m[2];
    if (!markerIsWrapped(tree, kind, id)) {
      const attr = kind === "feature" ? FEATURE_WRAPPER_ATTR : FORM_WRAPPER_ATTR;
      issues.push(`missing wrapper: the marker ${marker} must sit inside an element with htmlAttributes { "${attr}": "${id}" } that also contains the placeholder cards`);
    }
  }
  return issues;
}

export function assertPageTree(tree: PageTree, page: Page): void {
  const issues = validatePageTree(tree, page);
  if (issues.length) throw new Error(`pages/${page.slug}.gb.json is invalid:\n- ${issues.join("\n- ")}`);
}
