import type { SiteContext } from "../docker.js";
import { wpOk, wpJson } from "../wp.js";
import { gbBuild } from "../gb.js";
import type { SiteSpec } from "../schemas/site-spec.js";
import type { DesignTokens } from "../schemas/design-tokens.js";

export const deps = { gbBuild };
export const FOOTER_ELEMENT_SLUG = "faktory-footer";
const MOBILE = "@media (max-width:767px)";

type Node = { type: string; tagName?: string; content?: string; htmlAttributes?: Record<string, string>; styles?: Record<string, unknown>; innerBlocks?: Node[] };

const text = (tagName: string, content: string, styles: Record<string, unknown> = {}, htmlAttributes?: Record<string, string>): Node =>
  ({ type: "text", tagName, content, styles, ...(htmlAttributes ? { htmlAttributes } : {}) });

function link(href: string, label: string): Node {
  return text("a", label, { display: "block", color: "inherit", textDecoration: "none", opacity: "0.85", padding: "4px 0", transition: "opacity 150ms ease", "&:hover": { opacity: "1", textDecoration: "underline" }, "&:focus-visible": { outline: "2px solid var(--accent-2)", outlineOffset: "2px" } }, { href });
}

function columnTitle(label: string, step: (i: number) => number): Node {
  return text("p", label, { fontSize: "13px", letterSpacing: "0.08em", textTransform: "uppercase", opacity: "0.6", marginBottom: `${step(3)}px` });
}

/** Deterministic footer: brand + footer menu + contact, copyright bar. Colors only through GP palette variables. */
export function footerTree(spec: SiteSpec, tokens: DesignTokens, year: number = new Date().getFullYear()): unknown[] {
  const sp = tokens.spacing;
  const step = (i: number) => sp[Math.min(i, sp.length - 1)];
  const pad = Math.round(tokens.sectionPadding.desktop * 0.75), padMobile = Math.round(tokens.sectionPadding.mobile * 0.8);
  const { identity: id } = spec;
  const pages = new Map(spec.sitemap.map((p) => [p.slug, p]));

  const brand: Node = { type: "element", tagName: "div", styles: {}, innerBlocks: [
    text("p", `<strong>${id.name}</strong>`, { fontSize: "22px", marginBottom: `${step(2)}px` }),
    text("p", id.tagline, { opacity: "0.75", maxWidth: "36ch", lineHeight: "1.5" }),
  ] };

  const nav: Node = { type: "element", tagName: "nav", htmlAttributes: { "aria-label": "Pied de page" }, styles: {}, innerBlocks: [
    columnTitle("Navigation", step),
    ...spec.menus.footer.map((slug) => { const p = pages.get(slug); return link(p?.kind === "home" ? "/" : `/${slug}/`, p?.title ?? slug); }),
  ] };

  const contactLines: Node[] = [columnTitle("Contact", step)];
  if (id.contact.address) contactLines.push(text("p", id.contact.address, { opacity: "0.85", marginBottom: `${step(1)}px` }));
  if (id.contact.phone) contactLines.push(link(`tel:${id.contact.phone.replace(/[^+\d]/g, "")}`, id.contact.phone));
  if (id.contact.email) contactLines.push(link(`mailto:${id.contact.email}`, id.contact.email));
  for (const h of id.contact.hours ?? []) contactLines.push(text("p", h, { opacity: "0.85", fontSize: "15px" }));
  const contact: Node = { type: "element", tagName: "div", styles: {}, innerBlocks: contactLines };

  const grid: Node = { type: "element", tagName: "div", styles: {
    maxWidth: "var(--gb-container-width)", marginLeft: "auto", marginRight: "auto",
    display: "grid", gridTemplateColumns: "2fr 1fr 1.4fr", gap: `${step(6)}px`,
    [MOBILE]: { gridTemplateColumns: "1fr", gap: `${step(5)}px` },
  }, innerBlocks: [brand, nav, contact] };

  const bar: Node = { type: "element", tagName: "div", styles: {
    maxWidth: "var(--gb-container-width)", marginLeft: "auto", marginRight: "auto", marginTop: `${step(6)}px`, paddingTop: `${step(4)}px`,
    borderTop: "1px solid rgba(255,255,255,0.15)", display: "flex", justifyContent: "space-between", gap: `${step(3)}px`, fontSize: "14px", opacity: "0.7",
    [MOBILE]: { flexDirection: "column" },
  }, innerBlocks: [
    text("p", `© ${year} ${id.name}`),
    text("p", id.location ? `${id.sector} — ${id.location}` : id.sector),
  ] };

  const footer: Node = { type: "element", tagName: "footer", htmlAttributes: { class: "site-footer" }, styles: {
    backgroundColor: "var(--contrast)", color: "var(--base-3)", padding: `${pad}px 24px ${step(5)}px`,
    [MOBILE]: { padding: `${padMobile}px 16px ${step(4)}px` },
  }, innerBlocks: [grid, bar] };
  return [footer];
}

/** Create or update the `faktory-footer` GP Premium block element and point it at the site-wide footer hook. */
export async function installFooter(ctx: SiteContext, spec: SiteSpec, tokens: DesignTokens): Promise<number> {
  await wpOk(ctx, ["option", "update", "generate_package_elements", "activated"]);
  const markup = await deps.gbBuild(ctx.config, footerTree(spec, tokens));
  const existing = await wpJson<{ ID: number; post_name: string }[]>(ctx, ["post", "list", "--post_type=gp_elements", "--post_status=any", "--fields=ID,post_name"]);
  let id = existing.find((e) => e.post_name === FOOTER_ELEMENT_SLUG)?.ID;
  if (!id) id = Number(await wpOk(ctx, ["post", "create", "--post_type=gp_elements", "--post_status=publish", "--post_title=Faktory footer", `--post_name=${FOOTER_ELEMENT_SLUG}`, "--porcelain"]));
  await wpOk(ctx, ["post", "update", String(id), "-"], { input: markup });
  await wpOk(ctx, ["post", "meta", "update", String(id), "_generate_element_type", "block"]);
  await wpOk(ctx, ["post", "meta", "update", String(id), "_generate_block_type", "site-footer"]);
  await wpOk(ctx, ["post", "meta", "update", String(id), "_generate_element_display_conditions", JSON.stringify([{ rule: "general:site", object: "" }]), "--format=json"]);
  await wpOk(ctx, ["option", "update", "generate_dynamic_css_output", ""]);
  return id;
}
