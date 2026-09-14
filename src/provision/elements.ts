import type { SiteContext } from "../docker.js";
import { wpOk, wpJson } from "../wp.js";
import type { DesignTokens } from "../schemas/design-tokens.js";

export const MOBILE = "@media (max-width:767px)";
export const TABLET = "@media (max-width:1024px)";

/** A gb_build.py node (see plugin/skills/generatepress-generateblocks/scripts/gb_build.py). */
export type GbNode = {
  type: string; tagName?: string; content?: string; htmlAttributes?: Record<string, string>; attrs?: Record<string, unknown>;
  styles?: Record<string, unknown>; innerBlocks?: GbNode[]; rawMarkup?: string;
};

export const text = (tagName: string, content: string, styles: Record<string, unknown> = {}, htmlAttributes?: Record<string, string>): GbNode =>
  ({ type: "text", tagName, content, styles, ...(htmlAttributes ? { htmlAttributes } : {}) });

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPE[c]!);

/** Index into the tokens' spacing ramp, clamped to its last step. */
export const stepper = (tokens: DesignTokens) => (i: number): number => tokens.spacing[Math.min(i, tokens.spacing.length - 1)];

export type ElementCondition = { rule: string; object: string };
export type BlockElement = { slug: string; title: string; markup: string; meta: Record<string, string>; conditions: ElementCondition[] };

/** Create or update a GP Premium block element by slug: markup, `_generate_element_type=block`, extra metas, display conditions. */
export async function upsertBlockElement(ctx: SiteContext, el: BlockElement): Promise<number> {
  await wpOk(ctx, ["option", "update", "generate_package_elements", "activated"]);
  const existing = await wpJson<{ ID: number; post_name: string }[]>(ctx, ["post", "list", "--post_type=gp_elements", "--post_status=any", "--fields=ID,post_name"]);
  let id = existing.find((e) => e.post_name === el.slug)?.ID;
  if (!id) id = Number(await wpOk(ctx, ["post", "create", "--post_type=gp_elements", "--post_status=publish", `--post_title=${el.title}`, `--post_name=${el.slug}`, "--porcelain"]));
  await wpOk(ctx, ["post", "update", String(id), "-"], { input: el.markup });
  await wpOk(ctx, ["post", "meta", "update", String(id), "_generate_element_type", "block"]);
  for (const [key, value] of Object.entries(el.meta)) await wpOk(ctx, ["post", "meta", "update", String(id), key, value]);
  await wpOk(ctx, ["post", "meta", "update", String(id), "_generate_element_display_conditions", JSON.stringify(el.conditions), "--format=json"]);
  return id;
}
