import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { serializeArticle } from "../../src/content/serialize.js";
import type { Article } from "../../src/schemas/article.js";

const fixture = (): Article => JSON.parse(readFileSync("fixtures/content/la-galette-des-rois-revient-frangipane-ou-pomme.article.json", "utf8"));

describe("serializeArticle", () => {
  it("emits core block markup for each block type", () => {
    const a: Article = { ...fixture(), blocks: [
      { type: "paragraph", text: "Intro <strong>forte</strong>." },
      { type: "heading", level: 2, text: "Titre" },
      { type: "heading", level: 3, text: "Sous-titre" },
      { type: "list", ordered: false, items: ["un", "deux"] },
      { type: "list", ordered: true, items: ["a", "b"] },
      { type: "quote", text: "Citation", cite: "Auteur" },
      { type: "quote", text: "Sans auteur" },
    ] };
    expect(serializeArticle(a)).toBe([
      "<!-- wp:paragraph -->\n<p>Intro <strong>forte</strong>.</p>\n<!-- /wp:paragraph -->",
      '<!-- wp:heading -->\n<h2 class="wp-block-heading">Titre</h2>\n<!-- /wp:heading -->',
      '<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">Sous-titre</h3>\n<!-- /wp:heading -->',
      '<!-- wp:list -->\n<ul class="wp-block-list"><!-- wp:list-item -->\n<li>un</li>\n<!-- /wp:list-item --><!-- wp:list-item -->\n<li>deux</li>\n<!-- /wp:list-item --></ul>\n<!-- /wp:list -->',
      '<!-- wp:list {"ordered":true} -->\n<ol class="wp-block-list"><!-- wp:list-item -->\n<li>a</li>\n<!-- /wp:list-item --><!-- wp:list-item -->\n<li>b</li>\n<!-- /wp:list-item --></ol>\n<!-- /wp:list -->',
      '<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>Citation</p>\n<!-- /wp:paragraph --><cite>Auteur</cite></blockquote>\n<!-- /wp:quote -->',
      '<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>Sans auteur</p>\n<!-- /wp:paragraph --></blockquote>\n<!-- /wp:quote -->',
    ].join("\n\n") + "\n");
  });
  it("serializes the fixture with one block comment per block", () => {
    const out = serializeArticle(fixture());
    // each quote nests one paragraph block, hence the extra closing comments
    expect(out.match(/<!-- \/wp:(paragraph|heading|list|quote) -->/g)).toHaveLength(fixture().blocks.length + fixture().blocks.filter((b) => b.type === "quote").length);
  });
});
