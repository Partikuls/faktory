import type { SiteContext } from "../docker.js";
import { wpOk } from "../wp.js";
import { gbBuild } from "../gb.js";
import type { SiteSpec } from "../schemas/site-spec.js";
import type { DesignTokens } from "../schemas/design-tokens.js";
import { isPlaceholder } from "../spec-gaps.js";
import { MOBILE, esc, stepper, text, upsertBlockElement, type GbNode as Node } from "./elements.js";

export const deps = { gbBuild };
export const FOOTER_ELEMENT_SLUG = "faktory-footer";

function link(href: string, label: string): Node {
  return text("a", label, { display: "block", color: "inherit", textDecoration: "none", opacity: "0.85", padding: "4px 0", transition: "opacity 150ms ease", "&:hover": { opacity: "1", textDecoration: "underline" }, "&:focus-visible": { outline: "2px solid var(--accent-2)", outlineOffset: "2px" } }, { href });
}

function columnTitle(label: string, step: (i: number) => number): Node {
  return text("p", label, { fontSize: "13px", letterSpacing: "0.08em", textTransform: "uppercase", opacity: "0.6", marginBottom: `${step(3)}px` });
}

/** Deterministic footer: brand + footer menu + contact, copyright bar. Colors only through GP palette variables. */
export function footerTree(spec: SiteSpec, tokens: DesignTokens, year: number = new Date().getFullYear()): unknown[] {
  const step = stepper(tokens);
  const pad = Math.round(tokens.sectionPadding.desktop * 0.75), padMobile = Math.round(tokens.sectionPadding.mobile * 0.8);
  const { identity: id } = spec;
  const pages = new Map(spec.sitemap.map((p) => [p.slug, p]));

  const brand: Node = { type: "element", tagName: "div", styles: {}, innerBlocks: [
    text("p", `<strong>${esc(id.name)}</strong>`, { fontSize: "22px", marginBottom: `${step(2)}px` }),
    text("p", esc(id.tagline), { opacity: "0.75", maxWidth: "36ch", lineHeight: "1.5" }),
  ] };

  const navLinks = spec.menus.footer.map((slug) => { const p = pages.get(slug); return link(p?.kind === "home" ? "/" : `/${slug}/`, esc(p?.title ?? slug)); });
  const nav: Node | undefined = navLinks.length ? { type: "element", tagName: "nav", htmlAttributes: { "aria-label": "Pied de page" }, styles: {}, innerBlocks: [
    columnTitle("Navigation", step),
    ...navLinks,
  ] } : undefined;

  const contactLines: Node[] = [];
  if (!isPlaceholder(id.contact.address)) contactLines.push(text("p", esc(id.contact.address!), { opacity: "0.85", marginBottom: `${step(1)}px` }));
  const phoneDigits = id.contact.phone && !isPlaceholder(id.contact.phone) ? id.contact.phone.replace(/[^+\d]/g, "") : "";
  if (phoneDigits) contactLines.push(link(`tel:${phoneDigits}`, esc(id.contact.phone!)));
  if (!isPlaceholder(id.contact.email)) contactLines.push(link(`mailto:${id.contact.email}`, esc(id.contact.email!)));
  for (const h of id.contact.hours ?? []) if (!isPlaceholder(h)) contactLines.push(text("p", esc(h), { opacity: "0.85", fontSize: "15px" }));
  const contact: Node | undefined = contactLines.length ? { type: "element", tagName: "div", styles: {}, innerBlocks: [columnTitle("Contact", step), ...contactLines] } : undefined;

  const columns = [brand, nav, contact].filter((c): c is Node => c !== undefined);
  const gridTemplateColumns = columns.length <= 1 ? "1fr" : ["2fr", "1fr", "1.4fr"].slice(0, columns.length).join(" ");

  const grid: Node = { type: "element", tagName: "div", styles: {
    maxWidth: "var(--gb-container-width)", marginLeft: "auto", marginRight: "auto",
    display: "grid", gridTemplateColumns, gap: `${step(6)}px`,
    [MOBILE]: { gridTemplateColumns: "1fr", gap: `${step(5)}px` },
  }, innerBlocks: columns };

  const bar: Node = { type: "element", tagName: "div", styles: {
    maxWidth: "var(--gb-container-width)", marginLeft: "auto", marginRight: "auto", marginTop: `${step(6)}px`, paddingTop: `${step(4)}px`,
    borderTop: "1px solid color-mix(in srgb, var(--base-3) 18%, transparent)", display: "flex", justifyContent: "space-between", gap: `${step(3)}px`, fontSize: "14px", opacity: "0.7",
    [MOBILE]: { flexDirection: "column" },
  }, innerBlocks: [
    text("p", `© ${year} ${esc(id.name)}`),
    text("p", id.location ? `${esc(id.sector)} — ${esc(id.location)}` : esc(id.sector)),
  ] };

  const footer: Node = { type: "element", tagName: "footer", htmlAttributes: { class: "site-footer" }, styles: {
    backgroundColor: "var(--contrast)", color: "var(--base-3)", padding: `${pad}px 24px ${step(5)}px`,
    [MOBILE]: { padding: `${padMobile}px 16px ${step(4)}px` },
  }, innerBlocks: [grid, bar] };
  return [footer];
}

/** Create or update the `faktory-footer` GP Premium block element and point it at the site-wide footer hook. */
export async function installFooter(ctx: SiteContext, spec: SiteSpec, tokens: DesignTokens): Promise<number> {
  const markup = await deps.gbBuild(ctx.config, footerTree(spec, tokens));
  const id = await upsertBlockElement(ctx, {
    slug: FOOTER_ELEMENT_SLUG, title: "Faktory footer", markup,
    meta: { _generate_block_type: "site-footer" },
    conditions: [{ rule: "general:site", object: "" }],
  });
  await wpOk(ctx, ["option", "update", "generate_dynamic_css_output", ""]);
  return id;
}
