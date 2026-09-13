import { describe, it, expect } from "vitest";
import { prodCompose, envExample, fmtSize, restoreReadme } from "../../src/export/templates.js";

describe("export templates", () => {
  it("prod compose has db, wordpress, wpcli, env variables and no WP_DEBUG", () => {
    const y = prodCompose();
    for (const s of ["services:", "  db:", "image: mariadb:11", "  wordpress:", "image: wordpress:php8.3-apache", "  wpcli:", "image: wordpress:cli-php8.3",
      "127.0.0.1:${SITE_PORT}:80", "MARIADB_PASSWORD: ${DB_PASSWORD}", "MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}", "WORDPRESS_DB_PASSWORD: ${DB_PASSWORD}",
      "./wp-content:/var/www/html/wp-content", "define('FS_METHOD', 'direct');", "restart: unless-stopped", "healthcheck:"]) expect(y).toContain(s);
    expect(y).not.toContain("WP_DEBUG");
  });
  it("env example lists the three variables", () => {
    expect(envExample()).toBe("SITE_PORT=8080\nDB_PASSWORD=change-me\nDB_ROOT_PASSWORD=change-me-too\n");
  });
  it("formats sizes", () => {
    expect(fmtSize(812_345)).toBe("812 kB");
    expect(fmtSize(2_088_575)).toBe("2.1 MB");
    expect(fmtSize(31_400_000)).toBe("31 MB");
    expect(fmtSize(999)).toBe("1 kB");
  });
  it("restore readme walks through restoration, post-restore and the manifest, in French", () => {
    const md = restoreReadme({
      slug: "boulangerie", name: "Maison Rivet", customPlugins: [{ plugin: "faktory-produits", postType: "produit" }],
      forms: [{ id: "contact", name: "Contact", gfId: 5 }], articles: ["la-galette"], vendorPlugins: ["gp-premium", "generateblocks-pro", "gravityforms", "gravityformscli"],
    });
    expect(md.startsWith("# Maison Rivet — livraison Faktory\n")).toBe(true);
    for (const s of [
      "cp .env.example .env", "tar -xzf wp-content.tar.gz", "docker compose -f docker-compose.prod.yml up -d --wait",
      "sudo chown -R 33:33 wp-content", "wp db import - < db.sql", "wp search-replace 'https://SITE_URL_PLACEHOLDER' 'https://www.exemple.fr' --all-tables-with-prefix",
      "wp search-replace 'https:\\/\\/SITE_URL_PLACEHOLDER' 'https:\\/\\/www.exemple.fr' --all-tables-with-prefix",
      "wp yoast index --reindex --skip-confirmation", "wp rewrite flush", "wp user update admin --user_pass=",
      "SMTP", "Gravity Forms", "GP Premium", "GenerateBlocks Pro", "WP Umbrella", "MANIFEST.json",
      "`faktory-produits` (type de contenu `produit`)", "Contact (Gravity Forms #5)", "la-galette",
      "le port n'est exposé que sur `127.0.0.1`",
      "**Confidentialité** : `db.sql` contient le hash du mot de passe administrateur et les données du site ; transmettre ce dossier par un canal privé, le supprimer après restauration, ne jamais le joindre à un ticket.",
    ]) expect(md, s).toContain(s);
  });
});
