import { SITE_URL_PLACEHOLDER, escapeSlashes } from "./db.js";

/** Decision 15: the same stack as docker/docker-compose.yml, parameterized by .env, without WP_DEBUG. */
export function prodCompose(): string {
  return `services:
  db:
    image: mariadb:11
    restart: unless-stopped
    environment:
      MARIADB_ROOT_PASSWORD: \${DB_ROOT_PASSWORD}
      MARIADB_DATABASE: wordpress
      MARIADB_USER: wordpress
      MARIADB_PASSWORD: \${DB_PASSWORD}
    volumes:
      - db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 20

  wordpress:
    image: wordpress:php8.3-apache
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "127.0.0.1:\${SITE_PORT}:80"
    environment: &wpenv
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_NAME: wordpress
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: \${DB_PASSWORD}
      WORDPRESS_CONFIG_EXTRA: |
        define('FS_METHOD', 'direct');
    volumes:
      - core:/var/www/html
      - ./wp-content:/var/www/html/wp-content

  wpcli:
    image: wordpress:cli-php8.3
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
      wordpress:
        condition: service_started
    user: "33:33"
    environment: *wpenv
    volumes:
      - core:/var/www/html
      - ./wp-content:/var/www/html/wp-content
    working_dir: /var/www/html
    entrypoint: ["sh", "-c", "sleep infinity"]

volumes:
  db:
  core:
`;
}

export function envExample(): string {
  return "SITE_PORT=8080\nDB_PASSWORD=change-me\nDB_ROOT_PASSWORD=change-me-too\n";
}

export function fmtSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} kB`;
  const mb = bytes / 1_000_000;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

export type ReadmeInput = {
  slug: string; name: string;
  customPlugins: { plugin: string; postType: string }[];
  forms: { id: string; name: string; gfId: number }[];
  articles: string[];
  vendorPlugins: string[];
};

/** Decision 16: the restore runbook for Partikuls ops, in French. The real url is an example the operator replaces. */
export function restoreReadme(i: ReadmeInput): string {
  const W = "docker compose -f docker-compose.prod.yml exec -T wpcli wp";
  const real = "https://www.exemple.fr";
  return `# ${i.name} — livraison Faktory

Site WordPress GeneratePress + GenerateBlocks généré par Faktory (\`${i.slug}\`). Ce dossier contient tout ce qu'il faut pour le remettre en ligne sur un serveur Docker.

## Contenu

| Fichier | Rôle |
|---|---|
| \`db.sql\` | Base de données complète ; l'URL du site y vaut \`${SITE_URL_PLACEHOLDER}\` |
| \`wp-content.tar.gz\` | Thèmes (GeneratePress + enfant), extensions, médias, traductions |
| \`docker-compose.prod.yml\` | Stack de production : MariaDB 11, WordPress (php8.3-apache), WP-CLI |
| \`.env.example\` | Variables à copier dans \`.env\` : port, mots de passe |
| \`MANIFEST.json\` | Versions, pages, extensions sur mesure, formulaires, articles, résumé QA, coût |

## Restauration

\`\`\`bash
cp .env.example .env            # puis éditer : SITE_PORT, DB_PASSWORD, DB_ROOT_PASSWORD
tar -xzf wp-content.tar.gz      # crée ./wp-content
sudo chown -R 33:33 wp-content   # www-data dans les conteneurs : sinon Apache ne peut pas écrire (médias, mises à jour)
docker compose -f docker-compose.prod.yml up -d --wait
${W} db check                   # répéter jusqu'à succès : WordPress écrit wp-config.php au premier démarrage
${W} db import - < db.sql
${W} search-replace '${SITE_URL_PLACEHOLDER}' '${real}' --all-tables-with-prefix
${W} search-replace '${escapeSlashes(SITE_URL_PLACEHOLDER)}' '${escapeSlashes(real)}' --all-tables-with-prefix   # forme JSON (index Yoast)
${W} yoast index --reindex --skip-confirmation
${W} rewrite flush
${W} user update admin --user_pass='un-nouveau-mot-de-passe'   # OBLIGATOIRE : changer le mot de passe admin généré en local — ou : wp user create … --role=administrator puis wp user delete admin --reassign=<id>
\`\`\`

Remplacer \`${real}\` par l'URL réelle (avec le schéma, sans barre finale). Ouvrir ensuite la page d'accueil, une page intérieure et le formulaire de contact.

## Après la restauration

- **Confidentialité** : \`db.sql\` contient le hash du mot de passe administrateur et les données du site ; transmettre ce dossier par un canal privé, le supprimer après restauration, ne jamais le joindre à un ticket.
- **E-mails** : le conteneur n'envoie aucun mail. Installer une extension SMTP (ou configurer le relais de l'hébergeur) avant de compter sur les notifications Gravity Forms.
- **Licences** : ${i.vendorPlugins.join(", ")} sont installés sans clé ; renseigner les clés (GP Premium, GenerateBlocks Pro, Gravity Forms) dans leurs réglages pour recevoir les mises à jour.
- **Supervision** : ajouter le site dans WP Umbrella avec le nouvel administrateur.
- **HTTPS** : placer le port \`SITE_PORT\` derrière le reverse proxy TLS de l'hébergeur ; l'URL du site est déjà en \`https://\` ; le port n'est exposé que sur \`127.0.0.1\` ; le reverse proxy TLS de l'hébergeur tourne sur la même machine (sinon retirer le préfixe \`127.0.0.1:\` dans \`docker-compose.prod.yml\`).

## Ce que contient le site

- Extensions sur mesure : ${i.customPlugins.length ? i.customPlugins.map((p) => `\`${p.plugin}\` (type de contenu \`${p.postType}\`)`).join(", ") : "aucune"}.
- Formulaires : ${i.forms.length ? i.forms.map((f) => `${f.name} (Gravity Forms #${f.gfId})`).join(", ") : "aucun"}.
- Articles : ${i.articles.length ? i.articles.join(", ") : "aucun"}.

Le détail (versions WordPress et extensions, pages, résumé QA, coût de génération) est dans \`MANIFEST.json\`.
`;
}
