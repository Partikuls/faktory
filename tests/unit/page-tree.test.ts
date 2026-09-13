import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSiteSpec, type Page } from "../../src/schemas/site-spec.js";
import {
  parsePageTree, validatePageTree, assertPageTree, findMarkers, requiredMarkers, findWrapper,
  featureMarker, formMarker, FEATURE_WRAPPER_ATTR, FORM_WRAPPER_ATTR, type PageTree,
} from "../../src/schemas/page-tree.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const home = spec.sitemap.find((p) => p.kind === "home")!;
const contact = spec.sitemap.find((p) => p.kind === "contact")!;
const fixture = (): PageTree => parsePageTree(JSON.parse(readFileSync("fixtures/pages/accueil.gb.json", "utf8")));
/** The `data-faktory-feature="catalogue_produits"` wrapper element inside the "incontournables" section. */
const wrapperOf = (t: PageTree) => t[1].innerBlocks![0].innerBlocks![1];

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
  it("rejects unknown keys on a node (strict shape), reporting a bracketed path", () => {
    expect(() => parsePageTree([{ type: "element", innerBlocks: [{ type: "text", content: "a" }, { type: "text", tagname: "h1" }] }]))
      .toThrow(/\[0\]\.innerBlocks\[1\]: Unrecognized key: "tagname"/);
    expect(() => parsePageTree([{ type: "element", innerblocks: [] }])).toThrow(/innerblocks/i);
    expect(() => parsePageTree([{ type: "element", style: "color:red" }])).toThrow(/style/i);
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

describe("findWrapper", () => {
  it("finds the wrapper element carrying the feature attribute in the fixture", () => {
    const t = fixture();
    const found = findWrapper(t, "feature", "catalogue_produits");
    expect(found).toBeDefined();
    expect(found!.node.htmlAttributes?.[FEATURE_WRAPPER_ATTR]).toBe("catalogue_produits");
    expect(found!.path).toBe("[1].innerBlocks[0].innerBlocks[1]");
  });
  it("returns undefined when no such wrapper exists", () => {
    expect(findWrapper(fixture(), "form", "contact")).toBeUndefined();
  });
});

describe("validatePageTree", () => {
  it("accepts the fixture for the home page", () => {
    expect(validatePageTree(fixture(), home)).toEqual([]);
    expect(() => assertPageTree(fixture(), home)).not.toThrow();
  });
  it("flags a missing marker", () => {
    const t = fixture();
    const wrapper = wrapperOf(t);
    wrapper.innerBlocks = wrapper.innerBlocks!.filter((n) => n.type !== "raw");
    expect(validatePageTree(t, home)).toEqual([expect.stringContaining("faktory:feature:catalogue_produits")]);
  });
  it("flags a marker that is present but not inside its wrapper element", () => {
    const t = fixture();
    const wrapper = wrapperOf(t);
    const marker = wrapper.innerBlocks!.find((n) => n.type === "raw")!;
    wrapper.innerBlocks = wrapper.innerBlocks!.filter((n) => n.type !== "raw");
    // reattach the marker as a plain sibling, outside any wrapper
    t[1].innerBlocks![0].innerBlocks!.push(marker);
    const issues = validatePageTree(t, home);
    expect(issues).toEqual([expect.stringContaining("missing wrapper")]);
    expect(issues[0]).toContain(featureMarker("catalogue_produits"));
    expect(issues[0]).toContain(`"${FEATURE_WRAPPER_ATTR}": "catalogue_produits"`);
    expect(issues[0]).toContain("placeholder cards");
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
  it("flags a hex color in htmlAttributes.style the same way as in styles", () => {
    const t = fixture();
    t[0].htmlAttributes = { ...t[0].htmlAttributes, style: "color: #123abc" };
    const issues = validatePageTree(t, home);
    expect(issues).toEqual([expect.stringContaining("[0].htmlAttributes.style: hex color #123abc")]);
    const t2 = fixture();
    t2[0].htmlAttributes = { ...t2[0].htmlAttributes, style: "fill: url(#fade)" };
    expect(validatePageTree(t2, home)).toEqual([]);
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
  it("counts an h1 tagName on any node type, not just text", () => {
    const t: PageTree = [{ type: "element", tagName: "h1", innerBlocks: [] }];
    expect(validatePageTree(t, home).filter((i) => i.includes("h1"))).toEqual([]);
    const t2: PageTree = [{ type: "element", tagName: "H1", innerBlocks: [] }];
    expect(validatePageTree(t2, home).filter((i) => i.includes("h1"))).toEqual([]);
  });
  it("flags a media node without alt and a root node that is not an element", () => {
    const t = fixture();
    delete t[0].innerBlocks![0].innerBlocks![1].htmlAttributes!.alt;
    expect(validatePageTree(t, home)).toEqual([expect.stringContaining("media without alt")]);
    const t2: PageTree = [{ type: "text", tagName: "h1", content: "x" }];
    expect(validatePageTree(t2, home)).toContainEqual(expect.stringContaining("[0]: root nodes must be element sections"));
  });
  it("flags a raw node without rawMarkup and a text node without content", () => {
    const t: PageTree = [{ type: "element", tagName: "section", innerBlocks: [
      { type: "text", tagName: "h1", content: "x" },
      { type: "raw" },
      { type: "text", tagName: "p", content: "" },
    ] }];
    const issues = validatePageTree(t, home);
    expect(issues).toContainEqual(expect.stringContaining("raw node without rawMarkup"));
    expect(issues).toContainEqual(expect.stringContaining("text node without content"));
  });
  it("flags forbidden markup in content, rawMarkup and htmlAttributes, but not the marker comment", () => {
    const t = fixture();
    t[0].innerBlocks![0].innerBlocks![0].innerBlocks![0].content = "<script>alert(1)</script>";
    const issues = validatePageTree(t, home);
    expect(issues).toContainEqual(expect.stringContaining("forbidden markup (<script)"));
    const t2 = fixture();
    wrapperOf(t2).innerBlocks!.push({ type: "raw", rawMarkup: "<iframe src=x></iframe>" });
    expect(validatePageTree(t2, home)).toContainEqual(expect.stringContaining("forbidden markup (<iframe)"));
    const t3 = fixture();
    t3[0].innerBlocks![0].innerBlocks![1].htmlAttributes!.title = "onmouseover=alert(1)";
    expect(validatePageTree(t3, home)).toContainEqual(expect.stringContaining("forbidden markup (onmouseover=)"));
    const t4 = fixture();
    t4[0].innerBlocks![0].innerBlocks![0].innerBlocks![3].htmlAttributes!.href = "javascript:alert(1)";
    expect(validatePageTree(t4, home)).toContainEqual(expect.stringContaining("forbidden markup (javascript:)"));
    // the marker itself must still pass
    expect(validatePageTree(fixture(), home)).toEqual([]);
  });
  it("assertPageTree joins every issue", () => {
    const t = fixture();
    t[0].styles = { color: "#fff" };
    const wrapper = wrapperOf(t);
    wrapper.innerBlocks = wrapper.innerBlocks!.filter((n) => n.type !== "raw");
    expect(() => assertPageTree(t, home)).toThrow(/hex color #fff[\s\S]*faktory:feature:catalogue_produits/);
  });
});
