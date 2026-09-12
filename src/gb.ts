import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FaktoryConfig } from "./config.js";
import { run } from "./exec.js";
import type { DesignTokens } from "./schemas/design-tokens.js";

export const deps = { run };

/** Script path inside the synced plugin (same root as `pluginPath()` in agent.ts, inlined to avoid an import cycle agent → tools/server → gb → agent). */
export function gbScript(config: FaktoryConfig, name: "gb_build.py" | "gb_preview.py"): string {
  return join(config.repoRoot, "plugin", "skills", "generatepress-generateblocks", "scripts", name);
}

export function countBlocks(markup: string): number {
  return (markup.match(/<!-- wp:generateblocks(?:-pro)?\//g) ?? []).length;
}

/** Compile a gb_build tree (node or array of nodes) into GenerateBlocks markup. */
export async function gbBuild(config: FaktoryConfig, tree: unknown): Promise<string> {
  const r = await deps.run("python3", [gbScript(config, "gb_build.py")], { input: JSON.stringify(tree) });
  if (r.code !== 0) throw new Error(`gb_build.py failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

export type PreviewOptions = {
  palette?: Record<string, string>;
  fonts?: { family: string; variants?: string }[];
  headingFont?: string;
  bodyFont?: string;
  containerWidth?: number;
};

const PALETTE_VAR: Record<keyof DesignTokens["palette"], string> = {
  base: "base", base2: "base-2", base3: "base-3", contrast: "contrast", contrast2: "contrast-2", contrast3: "contrast-3", accent: "accent", accent2: "accent-2",
};

export function previewOptionsFromTokens(t: DesignTokens): PreviewOptions {
  const palette: Record<string, string> = {};
  for (const [k, v] of Object.entries(PALETTE_VAR)) palette[v] = t.palette[k as keyof DesignTokens["palette"]];
  return {
    palette,
    fonts: [{ family: t.fonts.heading.family, variants: t.fonts.heading.variants }, { family: t.fonts.body.family, variants: t.fonts.body.variants }],
    headingFont: t.fonts.heading.family,
    bodyFont: t.fonts.body.family,
    containerWidth: t.containerWidth,
  };
}

export function googleFontsHref(fonts: { family: string; variants?: string }[]): string {
  const fam = fonts.map((f) => {
    const variantStr = f.variants ?? "400";
    const variants = variantStr.split(",").map((v) => v.trim()).filter((v) => v.length > 0);

    // Parse each variant into (ital, weight) tuples
    const tuples: Array<[ital: number, weight: number]> = [];
    for (const v of variants) {
      if (/^\d+$/.test(v)) {
        // Bare weight: "400", "600", "700"
        tuples.push([0, parseInt(v, 10)]);
      } else if (/^(\d+)italic$/.test(v)) {
        // Weight + italic: "400italic", "600italic"
        const match = v.match(/^(\d+)italic$/);
        if (match) tuples.push([1, parseInt(match[1], 10)]);
      } else if (v === "italic") {
        // Just "italic" → weight 400
        tuples.push([1, 400]);
      }
      // else: ignore unrecognized variants
    }

    // Deduplicate and sort by ital then weight
    const unique = Array.from(new Set(tuples.map((t) => `${t[0]},${t[1]}`)));
    const sorted = unique
      .map((s) => s.split(",").map((x) => parseInt(x, 10)) as [number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    // Format the axis string
    const familyName = f.family.replace(/ /g, "+");
    if (sorted.length === 0) {
      // Empty variants; default to 400
      return `family=${familyName}:wght@400`;
    } else if (sorted.every((t) => t[0] === 0)) {
      // No italic tuples: use simple wght@... format
      const weights = sorted.map((t) => t[1]);
      return `family=${familyName}:wght@${weights.join(";")}`;
    } else {
      // Has italic tuples: use ital,wght@... format
      return `family=${familyName}:ital,wght@${sorted.map((t) => `${t[0]},${t[1]}`).join(";")}`;
    }
  });
  return `https://fonts.googleapis.com/css2?${fam.join("&")}&display=swap`;
}

function injectPreviewOptions(html: string, opts: PreviewOptions): string {
  let out = html;
  if (opts.palette || opts.containerWidth) {
    out = out.replace(/:root\{[^}]*\}/, (block) => {
      let b = block;
      for (const [name, color] of Object.entries(opts.palette ?? {})) {
        const re = new RegExp(`--${name}:[^;]*;`);
        b = re.test(b) ? b.replace(re, `--${name}:${color};`) : b.replace(/\}$/, `--${name}:${color};}`);
      }
      if (opts.containerWidth) b = b.replace(/--gb-container-width:[^;]*;/, `--gb-container-width:${opts.containerWidth}px;`);
      return b;
    });
  }
  const extra: string[] = [];
  if (opts.fonts?.length) extra.push(`<link rel="stylesheet" href="${googleFontsHref(opts.fonts)}">`);
  const css: string[] = [];
  if (opts.bodyFont) css.push(`body{font-family:"${opts.bodyFont}",system-ui,sans-serif;}`);
  if (opts.headingFont) css.push(`h1,h2,h3,h4,h5,h6{font-family:"${opts.headingFont}",serif;}`);
  if (css.length) extra.push(`<style>${css.join("")}</style>`);
  if (extra.length) out = out.replace("</head>", `${extra.join("\n")}\n</head>`);
  return out;
}

/** Render markup to a standalone HTML page via gb_preview.py, then patch palette/fonts/width into it. */
export async function gbPreview(config: FaktoryConfig, markupPath: string, outPath: string, opts: PreviewOptions = {}): Promise<void> {
  const r = await deps.run("python3", [gbScript(config, "gb_preview.py"), markupPath, "-o", outPath]);
  if (r.code !== 0) throw new Error(`gb_preview.py failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  if (Object.keys(opts).length) writeFileSync(outPath, injectPreviewOptions(readFileSync(outPath, "utf8"), opts));
}
