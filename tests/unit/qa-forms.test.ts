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

  it("reports an unreadable entry list instead of throwing the JSON.parse error", async () => {
    vi.spyOn(deps, "runWp").mockImplementation(async (_ctx, args) => {
      if (args[0] === "gf" && args[1] === "form" && args[2] === "get") {
        return { stdout: JSON.stringify({ id: 1, fields: [{ id: 1, type: "text" }] }), stderr: "", code: 0 };
      }
      if (args[0] === "gf" && args[1] === "entry" && args[2] === "list") {
        // A WP-CLI deprecation notice printed to stdout before the JSON array: code 0, but not clean JSON.
        return { stdout: "Warning: x\n[]", stderr: "", code: 0 };
      }
      throw new Error(`unexpected wp call: ${args.join(" ")}`);
    });
    const ctx = {} as unknown as SiteContext;

    const result = await submitForm(fakeBrowser(), ctx, "http://localhost:8101/contact/", "contact", 1);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("liste des entrées illisible (#1)");
  });
});
