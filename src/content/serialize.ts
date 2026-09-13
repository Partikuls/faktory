import type { Article, ArticleBlock } from "../schemas/article.js";

function block(b: ArticleBlock): string {
  switch (b.type) {
    case "paragraph":
      return `<!-- wp:paragraph -->\n<p>${b.text}</p>\n<!-- /wp:paragraph -->`;
    case "heading": {
      const attrs = b.level === 2 ? "" : ` {"level":${b.level}}`;
      return `<!-- wp:heading${attrs} -->\n<h${b.level} class="wp-block-heading">${b.text}</h${b.level}>\n<!-- /wp:heading -->`;
    }
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      const attrs = b.ordered ? ' {"ordered":true}' : "";
      const items = b.items.map((it) => `<!-- wp:list-item -->\n<li>${it}</li>\n<!-- /wp:list-item -->`).join("");
      return `<!-- wp:list${attrs} -->\n<${tag} class="wp-block-list">${items}</${tag}>\n<!-- /wp:list -->`;
    }
    case "quote": {
      const cite = b.cite ? `<cite>${b.cite}</cite>` : "";
      return `<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>${b.text}</p>\n<!-- /wp:paragraph -->${cite}</blockquote>\n<!-- /wp:quote -->`;
    }
  }
}

/** Core Gutenberg block markup for a validated article (decision 6). Text is inserted as-is: inline HTML was whitelisted by validateArticle. */
export function serializeArticle(a: Article): string {
  return a.blocks.map(block).join("\n\n") + "\n";
}
