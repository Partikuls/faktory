import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps as wpDeps } from "../../src/wp.js";
import { gbScript, gbBuild } from "../../src/gb.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { parseDesignTokens } from "../../src/schemas/design-tokens.js";
import { footerTree, installFooter, FOOTER_ELEMENT_SLUG, deps } from "../../src/provision/footer.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const tokens = parseDesignTokens(JSON.parse(readFileSync("fixtures/specs/boulangerie.design-tokens.json", "utf8")));
const ctx: SiteContext = { config: loadConfig(process.cwd()), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };
type Node = { type: string; tagName?: string; content?: string; htmlAttributes?: Record<string, string>; styles?: Record<string, unknown>; innerBlocks?: Node[] };
const flat = (nodes: Node[]): Node[] => nodes.flatMap((n) => [n, ...flat(n.innerBlocks ?? [])]);

describe("footerTree", () => {
  const tree = footerTree(spec, tokens, 2026) as Node[];
  const all = flat(tree);
  it("is one footer section using palette variables and the spacing ramp", () => {
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ type: "element", tagName: "footer" });
    expect(tree[0].styles?.backgroundColor).toBe("var(--contrast)");
    expect(JSON.stringify(tree)).not.toMatch(/#[0-9a-f]{6}/i);
    expect(tree[0].styles?.["@media (max-width:767px)"]).toBeDefined();
  });
  it("lists the footer menu pages as links and the brand, contact and copyright", () => {
    const links = all.filter((n) => n.tagName === "a").map((n) => n.htmlAttributes?.href);
    expect(links).toEqual(expect.arrayContaining(["/nos-produits/", "/commandes-evenements/", "/la-maison/", "/actualites/", "/contact/", "mailto:contact@maisonrivet.fr"]));
    const text = all.map((n) => n.content ?? "").join("\n");
    expect(text).toContain("Maison Rivet");
    expect(text).toContain("Pain au levain et pâtisseries artisanales");
    expect(text).toContain("Mardi – Vendredi : 7h00 – 19h30");
    expect(text).toContain("© 2026 Maison Rivet");
  });
  it("links the home page to / when it is in the footer menu", () => {
    const withHome = footerTree({ ...spec, menus: { ...spec.menus, footer: ["accueil", "contact"] } }, tokens, 2026) as Node[];
    expect(flat(withHome).find((n) => n.content === "Accueil")?.htmlAttributes?.href).toBe("/");
  });
  it("skips placeholder phone/address instead of rendering an empty tel: link or the raw placeholder text", () => {
    const hrefs = all.filter((n) => n.tagName === "a").map((n) => n.htmlAttributes?.href);
    expect(hrefs.some((h) => h?.startsWith("tel:"))).toBe(false);
    const text = all.map((n) => n.content ?? "").join("\n");
    expect(text).not.toMatch(/à confirmer/i);
  });
  it("renders only the brand column (gridTemplateColumns 1fr) when the footer menu and contact are both empty", () => {
    const bare = parseSiteSpec({
      ...spec,
      identity: { ...spec.identity, contact: {} },
      menus: { ...spec.menus, footer: [] },
    });
    const tree = footerTree(bare, tokens, 2026) as Node[];
    const grid = flat(tree).find((n) => n.styles?.gridTemplateColumns)!;
    expect(grid.styles?.gridTemplateColumns).toBe("1fr");
    expect(grid.innerBlocks).toHaveLength(1);
    const text = flat(tree).map((n) => n.content ?? "").join("\n");
    expect(text).not.toContain("Navigation");
    expect(text).not.toContain("Contact");
  });
  it("HTML-escapes the brand name and copyright line", () => {
    const amp = parseSiteSpec({ ...spec, identity: { ...spec.identity, name: "Pain & Co" } });
    const tree = footerTree(amp, tokens, 2026) as Node[];
    const text = flat(tree).map((n) => n.content ?? "").join("\n");
    expect(text).toContain("Pain &amp; Co");
    expect(text).not.toContain("Pain & Co");
  });
});

describe("installFooter", () => {
  beforeEach(() => vi.restoreAllMocks());
  const argsOf = (spy: any) => spy.mock.calls.map((c: any) => ({ a: (c[2] as string[]).slice(1).join(" "), input: (c[3] as { input?: string } | undefined)?.input }));
  function fakeWp(elements: { ID: number; post_name: string }[]) {
    return vi.spyOn(wpDeps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
      const a = cmd.slice(1).join(" ");
      if (a.startsWith("post list --post_type=gp_elements")) return { stdout: JSON.stringify(elements), stderr: "", code: 0 };
      if (a.startsWith("post create")) return { stdout: "42\n", stderr: "", code: 0 };
      return { stdout: "Success", stderr: "", code: 0 };
    });
  }
  it("activates the Elements module, creates the element, pushes the markup on stdin and sets the metas", async () => {
    vi.spyOn(deps, "gbBuild").mockResolvedValue("<!-- wp:generateblocks/element {} -->\n<footer>x</footer>\n<!-- /wp:generateblocks/element -->\n");
    const spy = fakeWp([]);
    expect(await installFooter(ctx, spec, tokens)).toBe(42);
    const c = argsOf(spy);
    expect(c.map((x: any) => x.a)).toEqual(expect.arrayContaining([
      "option update generate_package_elements activated",
      `post create --post_type=gp_elements --post_status=publish --post_title=Faktory footer --post_name=${FOOTER_ELEMENT_SLUG} --porcelain`,
      "post meta update 42 _generate_element_type block",
      "post meta update 42 _generate_block_type site-footer",
      'post meta update 42 _generate_element_display_conditions [{"rule":"general:site","object":""}] --format=json',
      "option update generate_dynamic_css_output ",
    ]));
    const upd = c.find((x: any) => x.a === "post update 42 -")!;
    expect(upd.input).toContain("<footer>x</footer>");
  });
  it("updates the existing element instead of creating a second one", async () => {
    vi.spyOn(deps, "gbBuild").mockResolvedValue("<!-- wp:generateblocks/element {} --><footer>y</footer><!-- /wp:generateblocks/element -->");
    const spy = fakeWp([{ ID: 8, post_name: FOOTER_ELEMENT_SLUG }]);
    expect(await installFooter(ctx, spec, tokens)).toBe(8);
    const a = argsOf(spy).map((x: any) => x.a);
    expect(a.some((x: any) => x.startsWith("post create"))).toBe(false);
    expect(a).toContain("post update 8 -");
  });
  it.skipIf(!existsSync(gbScript(ctx.config, "gb_build.py")))("compiles the real tree with gb_build.py (python3)", async () => {
    const markup = await gbBuild(ctx.config, footerTree(spec, tokens, 2026));
    expect(markup).toContain("wp:generateblocks/element");
    expect(markup).toContain('<footer class="gb-element-');
    expect(markup).toContain("\\u002d\\u002dcontrast");
    expect(markup).toContain("© 2026 Maison Rivet");
  });
});
