import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createState } from "../../src/state.js";
import type { SiteContext } from "../../src/docker.js";
import { deps } from "../../src/wp.js";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { ensurePages, ensureMenus, GP_PAGE_META, PRIMARY_MENU } from "../../src/provision/pages.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const ctx: SiteContext = { config: loadConfig("/tmp/fk"), slug: "demo", siteDir: "/tmp/fk/sites/demo", state: createState("demo", 8100, "pw") };
const argsOf = (spy: any) => spy.mock.calls.map((c: any) => (c[2] as string[]).slice(1).join(" "));

/** Fake WP: existing pages/menus/items; `post create` returns incrementing ids. */
function fakeWp(state: { pages: { ID: number; post_name: string }[]; menus: { term_id: number; name: string }[]; items: { object_id: number }[] }) {
  let next = 100;
  return vi.spyOn(deps, "composeExec").mockImplementation(async (_c, _s, cmd) => {
    const a = cmd.slice(1).join(" ");
    const json = (v: unknown) => ({ stdout: JSON.stringify(v), stderr: "", code: 0 });
    if (a.startsWith("post list --post_type=page")) return json(state.pages);
    if (a.startsWith("post create")) return { stdout: `${next++}\n`, stderr: "", code: 0 };
    if (a.startsWith("menu list")) return json(state.menus);
    if (a.startsWith("menu create")) return { stdout: "7\n", stderr: "", code: 0 };
    if (a.startsWith("menu item list")) return json(state.items);
    return { stdout: "Success", stderr: "", code: 0 };
  });
}

describe("ensurePages", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("creates missing pages as published placeholders with GP meta and returns slug → id", async () => {
    const spy = fakeWp({ pages: [{ ID: 12, post_name: "accueil" }], menus: [], items: [] });
    const ids = await ensurePages(ctx, spec);
    expect(ids.accueil).toBe(12);
    expect(ids["nos-produits"]).toBe(100);
    expect(Object.keys(ids)).toHaveLength(6);
    const a = argsOf(spy);
    expect(a).toContain("post create --post_type=page --post_status=publish --post_title=Nos produits --post_name=nos-produits --porcelain");
    expect(a.filter((x: string) => x.startsWith("post create"))).toHaveLength(5);
    for (const [k, v] of GP_PAGE_META) expect(a).toContain(`post meta update 12 ${k} ${v}`);
  });
  it("sets the static front page and the posts page", async () => {
    const spy = fakeWp({ pages: [], menus: [], items: [] });
    const ids = await ensurePages(ctx, spec);
    const a = argsOf(spy);
    expect(a).toContain("option update show_on_front page");
    expect(a).toContain(`option update page_on_front ${ids.accueil}`);
    expect(a).toContain(`option update page_for_posts ${ids.actualites}`);
  });
});

describe("ensureMenus", () => {
  beforeEach(() => vi.restoreAllMocks());
  const ids = { accueil: 1, "nos-produits": 2, "commandes-evenements": 3, "la-maison": 4, actualites: 5, contact: 6 };
  it("creates the primary menu, adds missing pages in spec order and assigns the primary location", async () => {
    const spy = fakeWp({ pages: [], menus: [], items: [] });
    await ensureMenus(ctx, spec, ids);
    const a = argsOf(spy);
    expect(a).toContain(`menu create ${PRIMARY_MENU} --porcelain`);
    const adds = a.filter((x: string) => x.startsWith("menu item add-post"));
    expect(adds).toEqual([1, 2, 3, 4, 5, 6].map((id) => `menu item add-post 7 ${id}`));
    expect(a.at(-1)).toBe("menu location assign 7 primary");
  });
  it("is idempotent: reuses the menu and skips pages already in it", async () => {
    const spy = fakeWp({ pages: [], menus: [{ term_id: 9, name: PRIMARY_MENU }], items: [{ object_id: 1 }, { object_id: 2 }] });
    await ensureMenus(ctx, spec, ids);
    const a = argsOf(spy);
    expect(a.some((x: string) => x.startsWith("menu create"))).toBe(false);
    expect(a.filter((x: string) => x.startsWith("menu item add-post"))).toEqual([3, 4, 5, 6].map((id) => `menu item add-post 9 ${id}`));
  });
});
