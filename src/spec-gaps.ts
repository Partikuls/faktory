import type { SiteSpec } from "./schemas/site-spec.js";

const GAP_RE = /à confirmer/i;

/** The spec prompt writes `[à confirmer]` for a fact absent from the brief, sometimes inside a longer value. */
export const hasGapMarker = (v: string): boolean => GAP_RE.test(v);

/** Values the spec author left unfilled, or empty — never render these. */
export const isPlaceholder = (v?: string): boolean => !v || hasGapMarker(v);

export type Gap = { label: string; paths: string[] };
type Path = (string | number)[];

const CONTACT_LABELS: Record<string, string> = { email: "Email", phone: "Téléphone", address: "Adresse", hours: "Horaires" };

function walk(v: unknown, path: Path, out: Path[]): void {
  if (typeof v === "string") { if (hasGapMarker(v)) out.push(path); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...path, i], out)); return; }
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k], out);
}

const formatPath = (p: Path): string => p.map((x, i) => (typeof x === "number" ? `[${x}]` : i ? `.${x}` : x)).join("");

function gapLabel(spec: SiteSpec, [root, a, b, c]: Path): string {
  if (root === "identity" && a === "contact" && typeof b === "string") return CONTACT_LABELS[b] ?? `Contact › ${b}`;
  if (root === "identity" && typeof a === "string") return `Identité › ${a}`;
  if (root === "sitemap" && typeof a === "number") {
    const page = spec.sitemap[a];
    if (b === "sections" && typeof c === "number") return `Page ${page.title} › ${page.sections[c].heading}`;
    if (b === "seo") return `Page ${page.title} › SEO`;
    return `Page ${page.title}`;
  }
  if (root === "features" && typeof a === "number") return `Fonctionnalité ${spec.features[a].name}`;
  if (root === "forms" && typeof a === "number") return `Formulaire ${spec.forms[a].name}`;
  if (root === "blog" && a === "articles" && typeof b === "number") return `Article « ${spec.blog.articles[b].title} »`;
  return formatPath([root, a, b, c].filter((x) => x !== undefined));
}

/** Every value still carrying the marker, grouped by readable label, in depth-first order. */
export function findSpecGaps(spec: SiteSpec): Gap[] {
  const paths: Path[] = [];
  walk(spec, [], paths);
  const byLabel = new Map<string, string[]>();
  for (const p of paths) {
    const label = gapLabel(spec, p);
    byLabel.set(label, [...(byLabel.get(label) ?? []), formatPath(p)]);
  }
  return [...byLabel].map(([label, ps]) => ({ label, paths: ps }));
}

export function gapWarning(gaps: Gap[]): string {
  const n = gaps.length;
  const names = gaps.slice(0, 3).map((g) => g.label).join(", ") + (n > 3 ? "…" : "");
  return `⚠ ${n} information${n > 1 ? "s" : ""} à compléter dans SITE-SPEC.md (${names}) — le site affichera des manques`;
}
