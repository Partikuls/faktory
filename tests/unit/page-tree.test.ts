import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSiteSpec, type Page } from "../../src/schemas/site-spec.js";
import { parsePageTree, validatePageTree, assertPageTree, findMarkers, requiredMarkers, featureMarker, formMarker, type PageTree } from "../../src/schemas/page-tree.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const home = spec.sitemap.find((p) => p.kind === "home")!;
const contact = spec.sitemap.find((p) => p.kind === "contact")!;
const fixture = (): PageTree => parsePageTree(JSON.parse(readFileSync("fixtures/pages/accueil.gb.json", "utf8")));

describe("parsePageTree", () => {
  it("accepts the accueil fixture", () => {
    const t = fixture();
    expect(t).toHaveLength(5);
    expect(t[0].type).toBe("element");
  });
  it("rejects an unknown node type, a non-array root and a non-string htmlAttribute", () => {
    expect(() => parsePageTree([{ type: "container" }])).toThrow(/Invalid page tree/);
    expect(() => parsePageTree({ type: "element" })).toThrow(/Invalid page tree/);
    expect(() => parsePageTree([{ type: "element", htmlAttributes: { id: 3 } }])).toThrow(/Invalid page tree/);
  });
  it("keeps nested innerBlocks and raw markup", () => {
    const t = parsePageTree([{ type: "element", innerBlocks: [{ type: "raw", rawMarkup: "<!-- x -->" }] }]);
    expect(t[0].innerBlocks?.[0].rawMarkup).toBe("<!-- x -->");
  });
});

describe("markers", () => {
  it("formats and finds markers", () => {
    expect(featureMarker("catalogue_produits")).toBe("<!-- faktory:feature:catalogue_produits -->");
    expect(formMarker("contact")).toBe("<!-- faktory:form:contact -->");
    expect(findMarkers(fixture())).toEqual([{ kind: "feature", id: "catalogue_produits" }]);
  });
  it("derives the required markers from the page sections", () => {
    expect(requiredMarkers(home)).toEqual([featureMarker("catalogue_produits")]);
    expect(requiredMarkers(contact)).toEqual([formMarker("contact")]);
  });
});

describe("validatePageTree", () => {
  it("accepts the fixture for the home page", () => {
    expect(validatePageTree(fixture(), home)).toEqual([]);
    expect(() => assertPageTree(fixture(), home)).not.toThrow();
  });
  it("flags a missing marker", () => {
    const t = fixture();
    t[1].innerBlocks![0].innerBlocks = t[1].innerBlocks![0].innerBlocks!.filter((n) => n.type !== "raw");
    expect(validatePageTree(t, home)).toEqual([expect.stringContaining("faktory:feature:catalogue_produits")]);
  });
  it("flags hex colors anywhere in styles, with the path", () => {
    const t = fixture();
    t[0].styles = { ...t[0].styles, "@media (max-width:767px)": { color: "#333" } };
    const issues = validatePageTree(t, home);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/\[0\]\.styles\.@media \(max-width:767px\)\.color: hex color #333/);
  });
  it("ignores url(#id) SVG references but still flags a real hex color alongside one", () => {
    const t = fixture();
    t[0].styles = { ...t[0].styles, fill: "url(#fade)" };
    expect(validatePageTree(t, home)).toEqual([]);
    const t2 = fixture();
    t2[0].styles = { ...t2[0].styles, background: "url(#fade) #fade" };
    const issues = validatePageTree(t2, home);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("hex color #fade");
  });
  it("flags zero or two h1", () => {
    const t = fixture();
    const h1 = t[0].innerBlocks![0].innerBlocks![0].innerBlocks![1];
    h1.tagName = "h2";
    expect(validatePageTree(t, home)).toEqual([expect.stringMatching(/exactly one h1.*found 0/)]);
    const t2 = fixture();
    t2[4].innerBlocks![0].tagName = "h1";
    expect(validatePageTree(t2, home)).toEqual([expect.stringMatching(/exactly one h1.*found 2/)]);
  });
  it("flags a media node without alt and a root node that is not an element", () => {
    const t = fixture();
    delete t[0].innerBlocks![0].innerBlocks![1].htmlAttributes!.alt;
    expect(validatePageTree(t, home)).toEqual([expect.stringContaining("media without alt")]);
    const t2: PageTree = [{ type: "text", tagName: "h1", content: "x" }];
    expect(validatePageTree(t2, home)).toContainEqual(expect.stringContaining("[0]: root nodes must be element sections"));
  });
  it("assertPageTree joins every issue", () => {
    const t = fixture();
    t[0].styles = { color: "#fff" };
    t[1].innerBlocks![0].innerBlocks = t[1].innerBlocks![0].innerBlocks!.filter((n) => n.type !== "raw");
    expect(() => assertPageTree(t, home)).toThrow(/hex color #fff[\s\S]*faktory:feature:catalogue_produits/);
  });
});
