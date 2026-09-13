import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import {
  parseFormsManifest, validateFormsManifest, assertFormsManifest, gfPlacement, formPages, pageForms, FORMS_MANIFEST_REL,
} from "../../src/schemas/forms-manifest.js";
import { CONTENT_DIR } from "../../src/artifacts.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));

describe("forms manifest", () => {
  it("names the content dir and the manifest path", () => {
    expect(CONTENT_DIR).toBe("content");
    expect(FORMS_MANIFEST_REL).toBe("content/forms.json");
  });
  it("gfPlacement is the self-closing Gravity Forms block without title/description", () => {
    expect(gfPlacement(3)).toBe('<!-- wp:gravityforms/form {"formId":"3","title":false,"description":false} /-->');
  });
  it("parses the fixture manifest and finds no issue", () => {
    const m = parseFormsManifest(JSON.parse(readFileSync("fixtures/content/forms.json", "utf8")));
    expect(Object.keys(m).sort()).toEqual(["contact", "devis_evenement"]);
    expect(m.contact.gfId).toBe(1);
    expect(validateFormsManifest(m)).toEqual([]);
    expect(() => assertFormsManifest(m)).not.toThrow();
  });
  it("rejects bad keys, ids and shapes", () => {
    expect(() => parseFormsManifest({ "Contact-Form": { gfId: 1, placement: gfPlacement(1) } })).toThrow(/Invalid forms manifest/);
    expect(() => parseFormsManifest({ contact: { gfId: 0, placement: gfPlacement(0) } })).toThrow(/Invalid forms manifest/);
    expect(() => parseFormsManifest({ contact: { gfId: 1 } })).toThrow(/Invalid forms manifest/);
    expect(() => parseFormsManifest({ contact: { gfId: 1, placement: gfPlacement(1), extra: true } })).toThrow(/Invalid forms manifest/);
  });
  it("flags forbidden markup and a placement whose formId differs from gfId", () => {
    const issues = validateFormsManifest({
      contact: { gfId: 1, placement: '<!-- wp:gravityforms/form {"formId":"2","title":false,"description":false} /-->' },
      devis: { gfId: 2, placement: '<script>alert(1)</script>' },
    });
    expect(issues).toHaveLength(3);
    expect(issues[0]).toMatch(/contact: must be the block <!-- wp:gravityforms\/form \{…"formId":"1"…\} \/-->/);
    expect(issues[1]).toMatch(/devis: forbidden markup \(<script\)/);
    expect(issues[2]).toMatch(/devis: must be the block/);
    expect(() => assertFormsManifest({ contact: { gfId: 1, placement: "x" } })).toThrow(/content\/forms.json is invalid:\n- contact: must be the block/);
  });
  it("formPages lists, in sitemap order, the pages whose form/contact section references the form", () => {
    expect(formPages(spec, "contact")).toEqual(["contact"]);
    expect(formPages(spec, "devis_evenement")).toEqual(["commandes-evenements"]);
    expect(formPages(spec, "nope")).toEqual([]);
  });
  it("pageForms lists each form id of a page once, in section order", () => {
    const contact = spec.sitemap.find((p) => p.slug === "contact")!;
    expect(pageForms(contact)).toEqual(["contact"]);
    expect(pageForms(spec.sitemap.find((p) => p.slug === "accueil")!)).toEqual([]);
  });
});
