import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { phpCheck } from "../../src/php.js";

const DIR = "fixtures/plugins/faktory-catalogue-produits";
const FILES = [
  "faktory-catalogue-produits.php", "includes/post-type.php", "includes/taxonomies.php", "includes/meta.php", "includes/admin-columns.php",
  "includes/render.php", "blocks/catalogue-produits/block.json", "blocks/catalogue-produits/render.php", "blocks/catalogue-produits/index.js",
  "blocks/catalogue-produits/index.asset.php", "style.css", "uninstall.php",
];

describe("reference plugin fixture", () => {
  it("has every file of the contract", () => {
    for (const f of FILES) expect(existsSync(join(DIR, f)), f).toBe(true);
  });
  it("declares the block, the render attribute and the palette-only CSS", () => {
    const block = JSON.parse(readFileSync(join(DIR, "blocks/catalogue-produits/block.json"), "utf8"));
    expect(block.name).toBe("faktory/catalogue-produits");
    expect(block.render).toBe("file:./render.php");
    expect(block.style).toBe("faktory-catalogue-produits");
    expect(readFileSync(join(DIR, "includes/render.php"), "utf8")).toContain('data-faktory-plugin="catalogue_produits"');
    expect(readFileSync(join(DIR, "style.css"), "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    const manifest = JSON.parse(readFileSync("fixtures/plugins/catalogue_produits.manifest.json", "utf8"));
    expect(Object.keys(manifest.placements).sort()).toEqual(["accueil", "nos-produits"]);
    for (const p of Object.values(manifest.placements) as string[]) expect(p).toMatch(/^<!-- wp:faktory\/catalogue-produits \{.*\} \/-->$/);
  });
});

describe.skipIf(!existsSync("tools/phpstan/vendor/bin/phpstan"))("reference plugin fixture (php toolchain)", () => {
  it("passes php -l and PHPStan level 5", async () => {
    const r = await phpCheck(loadConfig(process.cwd()), DIR);
    expect(r.ok, r.output).toBe(true);
    expect(r.files).toBe(9);
  });
});
