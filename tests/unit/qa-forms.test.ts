import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Browser } from "playwright";
import type { SiteContext } from "../../src/docker.js";
import { formValues, tomorrow, submitForm, deps, type GfLiveForm } from "../../src/qa/forms.js";

const form: GfLiveForm = { id: 1, fields: [
  { id: 1, type: "text" }, { id: 2, type: "email" }, { id: 3, type: "phone" }, { id: 4, type: "date" },
  { id: 5, type: "number" }, { id: 6, type: "textarea" },
  { id: 7, type: "select", choices: [{ text: "Mariage", value: "mariage" }, { text: "Autre", value: "autre" }] },
  { id: 8, type: "website" }, { id: 9, type: "select", choices: "" },
] };

describe("formValues", () => {
  it("gives every field a valid value carrying the marker where it is free text", () => {
    const v = formValues(form, "fq1", new Date(2026, 11, 31, 12));
    expect(v).toEqual({
      1: "Test Faktory fq1", 2: "qa+fq1@faktory.test", 3: "+33 6 00 00 00 00", 4: "01/01/2027",
      5: "2", 6: "Message de test Faktory fq1", 7: "mariage", 8: "Test Faktory fq1", 9: "",
    });
  });
});

describe("tomorrow", () => {
  it("formats the next day as dd/mm/yyyy", () => {
    expect(tomorrow(new Date(2026, 8, 14, 23, 30))).toBe("15/09/2026");
  });
});

/** A minimal fake Browser whose page never touches a real DOM: every action is an async no-op, and the
 * confirmation locator resolves immediately (the test is about the entry-list branch, not submission). */
function fakeBrowser(): Browser {
  const page = {
    goto: async () => {},
    fill: async () => {},
    selectOption: async () => {},
    click: async () => {},
    keyboard: { press: async () => {} },
    locator: () => ({ waitFor: async () => {}, allInnerTexts: async () => [] as string[] }),
  };
  const context = { newPage: async () => page, close: async () => {} };
  return { newContext: async () => context } as unknown as Browser;
}

describe("submitForm", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  const MARKER_NOW = 1789420634145;
  const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
  const fail = (stderr: string) => ({ stdout: "", stderr, code: 1 });

  /**
   * A fake WP-CLI: `gf entry list --format=ids` prints `ids`, `gf entry get <id> --raw --format=json` prints the raw
   * entry of `entries[id]` (a missing id exits 1), `gf entry delete` removes it unless `deleteWorks` is false.
   */
  function fakeWp(opts: { ids: { stdout: string; code: number }; entries: Record<string, Record<string, unknown> | string>; deleteWorks?: boolean }) {
    const calls: string[][] = [];
    const entries = { ...opts.entries };
    vi.spyOn(deps, "runWp").mockImplementation(async (_ctx, args) => {
      calls.push(args);
      if (args[1] === "form" && args[2] === "get") return ok(JSON.stringify({ id: 2, fields: [{ id: 1, type: "text" }] }));
      if (args[1] === "entry" && args[2] === "list") return { ...opts.ids, stderr: "" };
      if (args[1] === "entry" && args[2] === "get") {
        const e = entries[args[3]];
        if (e === undefined) return fail(`Error: Entrée avec l’ID ${args[3]} introuvable\n`);
        return ok(typeof e === "string" ? e : JSON.stringify(e) + "\n");
      }
      if (args[1] === "entry" && args[2] === "delete") {
        if (opts.deleteWorks !== false) delete entries[args[3]];
        return ok(`Success: Deleted entry ${args[3]}\n`);
      }
      throw new Error(`unexpected wp call: ${args.join(" ")}`);
    });
    return calls;
  }

  async function submit() {
    const now = vi.spyOn(Date, "now").mockReturnValue(MARKER_NOW);
    try {
      return await submitForm(fakeBrowser(), {} as SiteContext, "http://localhost:8197/contact/", "contact", 2);
    } finally {
      now.mockRestore();
    }
  }

  it("reports an unreadable entry id list instead of guessing", async () => {
    fakeWp({ ids: { stdout: "Warning: x\n12 11", code: 0 }, entries: {} });
    expect(await submit()).toMatchObject({ ok: false, error: "liste des entrées illisible (#2)" });
  });

  it("reports an entry id list the CLI failed to print", async () => {
    fakeWp({ ids: { stdout: "", code: 1 }, entries: {} });
    expect(await submit()).toMatchObject({ ok: false, error: "liste des entrées illisible (#2)" });
  });

  it("finds the marked entry by reading each raw entry and deletes that one, confirmed by a failing get", async () => {
    const calls = fakeWp({
      ids: { stdout: "12 11 10", code: 0 },
      entries: {
        "12": { id: "12", form_id: "2", "1": "Test Faktory fq1" },
        "11": { id: "11", form_id: "2", "1": `Test Faktory fq${MARKER_NOW}` },
        "10": { id: "10", form_id: "2", "1": `Test Faktory fq${MARKER_NOW}` },
      },
    });
    expect(await submit()).toMatchObject({ ok: true });
    expect(calls.slice(1)).toEqual([
      ["gf", "entry", "list", "2", "--format=ids", "--page_size=50"],
      ["gf", "entry", "get", "12", "--raw", "--format=json"],
      ["gf", "entry", "get", "11", "--raw", "--format=json"],
      ["gf", "entry", "delete", "11", "--force"],
      ["gf", "entry", "get", "11"],
    ]);
  });

  it("skips an entry whose get fails or does not parse", async () => {
    const calls = fakeWp({
      ids: { stdout: "13 12 11", code: 0 },
      entries: { "12": `Warning: x\n{"id":"12","1":"Test Faktory fq${MARKER_NOW}"}`, "11": { id: "11", "1": `Test Faktory fq${MARKER_NOW}` } },
    });
    expect(await submit()).toMatchObject({ ok: true });
    expect(calls.find((a) => a[2] === "delete")).toEqual(["gf", "entry", "delete", "11", "--force"]);
  });

  it("reports a delete that did not happen (the entry can still be read)", async () => {
    fakeWp({ ids: { stdout: "11", code: 0 }, entries: { "11": { id: "11", "1": `Test Faktory fq${MARKER_NOW}` } }, deleteWorks: false });
    expect(await submit()).toMatchObject({ ok: false, error: "entrée #11 non supprimée" });
  });

  it("reports no entry when none carries the marker, and deletes nothing", async () => {
    const calls = fakeWp({ ids: { stdout: "12", code: 0 }, entries: { "12": { id: "12", "1": "Test Faktory fq1" } } });
    expect(await submit()).toMatchObject({ ok: false, error: "aucune entrée créée" });
    expect(calls.some((a) => a[2] === "delete")).toBe(false);
  });

  it("reports no entry on an empty id list", async () => {
    fakeWp({ ids: { stdout: "", code: 0 }, entries: {} });
    expect(await submit()).toMatchObject({ ok: false, error: "aucune entrée créée" });
  });

  it("always deletes an entry found, even when the confirmation is missing", async () => {
    const browser = fakeBrowser();
    const context = await browser.newContext();
    const page = await context.newPage() as unknown as { locator: () => unknown };
    page.locator = () => ({ waitFor: async () => { throw new Error("Timeout"); }, allInnerTexts: async () => ["Champ requis"] });
    (browser as unknown as { newContext: () => Promise<unknown> }).newContext = async () => ({ newPage: async () => page, close: async () => {} });
    const calls = fakeWp({ ids: { stdout: "11", code: 0 }, entries: { "11": { id: "11", "1": `Test Faktory fq${MARKER_NOW}` } } });
    const now = vi.spyOn(Date, "now").mockReturnValue(MARKER_NOW);
    const result = await submitForm(browser, {} as SiteContext, "http://localhost:8197/contact/", "contact", 2);
    now.mockRestore();
    expect(result).toMatchObject({ ok: false, error: "pas de confirmation (« Champ requis »)" });
    expect(calls.some((a) => a[2] === "delete" && a[3] === "11")).toBe(true);
  });

  it("prefixes a browser error in French", async () => {
    const browser = fakeBrowser();
    const context = await browser.newContext();
    const page = await context.newPage() as unknown as { fill: () => Promise<void> };
    page.fill = async () => { throw new Error("page.fill: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator"); };
    (browser as unknown as { newContext: () => Promise<unknown> }).newContext = async () => ({ newPage: async () => page, close: async () => {} });
    fakeWp({ ids: { stdout: "", code: 0 }, entries: {} });
    const result = await submitForm(browser, {} as SiteContext, "http://localhost:8197/contact/", "contact", 2);
    expect(result).toMatchObject({ ok: false, error: "erreur du navigateur : page.fill: Timeout 30000ms exceeded." });
  });
});
