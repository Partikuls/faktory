export type InPageResult = { unstyledBlocks: string[]; brokenImages: string[]; missingAlt: number; h1Count: number; links: string[]; untranslated: string[] };

/** GenerateBlocks per-block classes (`gb-element-e756c829`, `gb-text-…`, …); every one must have a rule in the page's `<style>` tags. */
export const GB_CLASS_RE = /^gb-(element|text|media|container|grid|shape|looper|query)-[a-z0-9]+$/;

/** English strings WordPress/GeneratePress print when a French language pack is missing (inlined in inPageAudit). */
export const UNTRANSLATED = ["by", "Read more", "Leave a Comment", "Leave a comment", "Posted in"];

/**
 * Runs INSIDE the page via `page.evaluate(inPageAudit)`: Playwright serializes the function source, so it must
 * not reference anything outside its own body (no imports, no module constants — GB_CLASS_RE is inlined below).
 */
export function inPageAudit(): InPageResult {
  const re = /^gb-(element|text|media|container|grid|shape|looper|query)-[a-z0-9]+$/;
  const used = new Set<string>();
  document.querySelectorAll('[class*="gb-"]').forEach((el) => el.classList.forEach((c) => { if (re.test(c)) used.add(c); }));
  const css = Array.from(document.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n");
  const unstyledBlocks = Array.from(used).filter((c) => !css.includes("." + c)).sort();
  const imgs = Array.from(document.images);
  const brokenImages = imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.currentSrc || i.src);
  const missingAlt = imgs.filter((i) => !i.hasAttribute("alt")).length;
  const h1Count = document.querySelectorAll("h1").length;
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) => a.href);
  const words = ["by", "Read more", "Leave a Comment", "Leave a comment", "Posted in"];
  const bodyText = document.body.innerText;
  // "by" only as a lowercase standalone word, not inside "Baby" or "by-pass"
  const untranslated = words.filter((w) => new RegExp(`(^|[\\s(])${w}(?=[\\s:.,)]|$)`).test(bodyText));
  return { unstyledBlocks, brokenImages, missingAlt, h1Count, links, untranslated };
}
