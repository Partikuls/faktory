import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSiteSpec } from "../../src/schemas/site-spec.js";
import { toJsonSchema } from "../../src/schemas/json-schema.js";
import {
  ArticleShape, parseArticle, validateArticle, assertArticle, articleSlug, countWords, inlineHtmlIssues,
  ARTICLES_DIR, articleRel, WORDS_MIN, WORDS_MAX, type Article,
} from "../../src/schemas/article.js";

const spec = parseSiteSpec(JSON.parse(readFileSync("fixtures/specs/boulangerie.site-spec.json", "utf8")));
const fixture = (): Article => JSON.parse(readFileSync("fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json", "utf8"));
const cats = spec.blog.categories;

describe("articleSlug", () => {
  it("strips accents and punctuation, kebab-cases, caps at 60 chars without a trailing dash", () => {
    expect(articleSlug("La galette des rois revient : frangipane ou pomme ?")).toBe("la-galette-des-rois-revient-frangipane-ou-pomme");
    expect(articleSlug("Réussir ses tartines au levain à la maison")).toBe("reussir-ses-tartines-au-levain-a-la-maison");
    expect(articleSlug("4 heures du matin au fournil : une nuit avec l'équipe")).toBe("4-heures-du-matin-au-fournil-une-nuit-avec-l-equipe");
    expect(articleSlug("Organiser un petit-déjeuner d'entreprise sur l'Île de Nantes et ailleurs encore")).toBe("organiser-un-petit-dejeuner-d-entreprise-sur-l-ile-de-nantes");
    expect(articleSlug("   ")).toBe("article");
  });
  it("names the article files", () => {
    expect(ARTICLES_DIR).toBe("content/articles");
    expect(articleRel("x")).toBe("content/articles/x.json");
  });
});

describe("ArticleShape / parseArticle", () => {
  it("accepts the fixture and produces a JSON schema with the category enum", () => {
    const a = parseArticle(fixture(), cats);
    expect(a.category).toBe("Saison");
    const schema = toJsonSchema(ArticleShape(cats)) as any;
    expect(schema.properties.category.enum).toEqual(cats);
    expect(schema.$schema).toBeUndefined();
  });
  it("rejects an unknown category, an unknown block type, long titles and short excerpts", () => {
    expect(() => parseArticle({ ...fixture(), category: "Autre" }, cats)).toThrow(/Invalid article: category/);
    const pad = [{ type: "paragraph", text: "y" }, { type: "paragraph", text: "z" }];
    expect(() => parseArticle({ ...fixture(), blocks: [{ type: "image", src: "x" }, ...pad] }, cats)).toThrow(/Invalid article: blocks\.0/);
    expect(() => parseArticle({ ...fixture(), title: "x".repeat(91) }, cats)).toThrow(/Invalid article: title/);
    expect(() => parseArticle({ ...fixture(), excerpt: "court" }, cats)).toThrow(/Invalid article: excerpt/);
    expect(() => parseArticle({ ...fixture(), seo: { title: "x".repeat(71), metaDescription: "y".repeat(60) } }, cats)).toThrow(/Invalid article: seo.title/);
    expect(() => parseArticle({ ...fixture(), blocks: [{ type: "heading", level: 4, text: "x" }, ...pad] }, cats)).toThrow(/Invalid article: blocks\.0\.level/);
    expect(() => parseArticle({ ...fixture(), blocks: [{ type: "list", ordered: false, items: ["one"] }, ...pad] }, cats)).toThrow(/Invalid article: blocks\.0\.items/);
    expect(() => parseArticle({ ...fixture(), blocks: pad }, cats)).toThrow(/Invalid article: blocks/); // min 3 blocks
  });
});

describe("countWords / inlineHtmlIssues", () => {
  it("counts words across all block texts, tags excluded", () => {
    const a: Article = { ...fixture(), blocks: [
      { type: "paragraph", text: "Un <strong>deux</strong> trois." },
      { type: "heading", level: 2, text: "Quatre cinq" },
      { type: "list", ordered: true, items: ["six", "sept huit"] },
      { type: "quote", text: "neuf", cite: "dix" },
    ] };
    expect(countWords(a)).toBe(10);
    expect(countWords(fixture())).toBeGreaterThanOrEqual(WORDS_MIN);
  });
  it("allows strong/em/a with safe hrefs, refuses everything else", () => {
    const ok: string[] = [];
    inlineHtmlIssues('Un <strong>a</strong> <em>b</em> <a href="/contact/">c</a> <a href="https://x.fr/y">d</a>', "p", ok);
    expect(ok).toEqual([]);
    const bad: string[] = [];
    inlineHtmlIssues('<span>x</span> <a href="http://x.fr">y</a> <a href="javascript:alert(1)">z</a> <img src="x"> <a onclick="x" href="/a/">w</a>', "blocks.2", bad);
    expect(bad).toEqual([
      "blocks.2: forbidden markup (javascript:)",
      "blocks.2: forbidden markup (onclick=)",
      "blocks.2: forbidden inline HTML <span>",
      "blocks.2: forbidden inline HTML </span>",
      'blocks.2: forbidden inline HTML <a href="http://x.fr"> (href must start with / or https://)',
      "blocks.2: forbidden inline HTML <img src=\"x\">",
    ]);
  });
  it("catches the denylist in plain text, not just inside tags", () => {
    const i1: string[] = [];
    inlineHtmlIssues("Cliquez ici: javascript:alert(1)", "p", i1);
    expect(i1).toEqual(["p: forbidden markup (javascript:)"]);
  });
  it("still flags a closing tag that isn't strong/em/a", () => {
    const i2: string[] = [];
    inlineHtmlIssues("fin </iframe>", "p", i2);
    expect(i2).toEqual(["p: forbidden inline HTML </iframe>"]);
  });
});

describe("validateArticle", () => {
  it("accepts the fixture", () => {
    expect(validateArticle(fixture(), spec)).toEqual([]);
    expect(() => assertArticle(fixture(), spec)).not.toThrow();
  });
  it("lists every editorial rule broken", () => {
    const short: Article = { ...fixture(), category: "Recettes", blocks: [
      { type: "heading", level: 2, text: "Titre [à confirmer]" },
      { type: "paragraph", text: "Trop court <span>ici</span>." },
    ] };
    const issues = validateArticle(short, spec);
    // "Titre [à confirmer]" -> Titre, à, confirmer (3) + "Trop court ici." -> Trop, court, ici (3) = 6.
    expect(issues).toContain(`article has 6 words, expected between ${WORDS_MIN} and ${WORDS_MAX}`);
    expect(issues).toContain("article needs at least 2 headings, found 1");
    expect(issues).toContain("the first block must be a paragraph (an intro before the first heading), found heading");
    expect(issues).toContain("blocks.0: contains the placeholder [à confirmer] — use only facts from the brief");
    expect(issues).toContain("blocks.1: forbidden inline HTML <span>");
    const long: Article = { ...fixture(), blocks: [{ type: "paragraph", text: Array(WORDS_MAX + 1).fill("mot").join(" ") }, { type: "heading", level: 2, text: "a" }, { type: "heading", level: 2, text: "b" }] };
    expect(validateArticle(long, spec)).toContain(`article has ${WORDS_MAX + 3} words, expected between ${WORDS_MIN} and ${WORDS_MAX}`);
    expect(validateArticle({ ...fixture(), category: "Nope" }, spec)).toContain(`category "Nope" is not one of the spec's blog categories (${cats.join(", ")})`);
    expect(() => assertArticle(short, spec)).toThrow(/article is invalid:\n- article has 6 words/);
  });
});
