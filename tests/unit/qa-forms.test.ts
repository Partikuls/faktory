import { describe, it, expect } from "vitest";
import { formValues, tomorrow, type GfLiveForm } from "../../src/qa/forms.js";

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
