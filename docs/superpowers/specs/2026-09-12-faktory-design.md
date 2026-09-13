# Faktory — WordPress AI software factory

## Contexte

Partikuls livre des sites WordPress (GeneratePress + GenerateBlocks) à des PME/assos/collectivités. Chaque site répète la même chaîne manuelle : lire le brief, poser un design system, monter les pages en GB, écrire un ou deux plugins métier, brancher formulaires/SEO/blog, vérifier, livrer. Khelil a déjà outillé des morceaux de cette chaîne (compilateur `gb_build.py`, boucle publish → screenshot → refine de la skill Elementor-import, doctrine `design-system.md`), mais rien ne les enchaîne.

Faktory est un binaire TypeScript sur le **Claude Agent SDK** qui prend un `brief.md` et sort un site WordPress complet, prêt à déployer, avec deux checkpoints humains (spec, design system). Outil interne, mono-utilisateur, cible build = Docker local, livraison = export `dist/`.

### Décisions prises pendant le cadrage

| Sujet | Décision |
|---|---|
| Usage | Outil interne Partikuls, pas de multi-tenant ni UI |
| Entrée | `brief.md` en markdown libre |
| Livrable v1 | Pages + design system GP/GB, header/footer/menus, formulaires (Gravity Forms), SEO (Yoast), 3-5 articles de blog, **plugins sur-mesure** (CPT + taxos + meta + bloc/shortcode + colonnes admin) |
| Hors scope v1 | Copywriting approfondi (copy court dérivé du brief seulement), images générées (placeholders), déploiement sur serveur, multilingue, plugins avec logique métier lourde (paiement, API, espace membre) |
| Cible build | Docker Compose local (WordPress + MariaDB + wp-cli), un projet Compose par site |
| Orchestration | **Approche A** : pipeline piloté par le code, un `query()` Agent SDK par étape, artefacts sur disque, reprise par étape |
| Humain | 2 checkpoints : après SITE-SPEC, après design system. Ensuite full auto jusqu'au rapport QA |
| Licences | GP Premium + GenerateBlocks Pro + Gravity Forms (zips fournis par l'utilisateur dans `docker/vendor/`, gitignoré) |
| Livraison | Export uniquement : `dist/` avec wp-content, dump SQL, compose prod, README |
| Modèle | `claude-opus-5` par défaut sur toutes les étapes, surchargeable par étape dans la config |

## Architecture

```
brief.md ──▶ [1 spec] ──▶ SITE-SPEC.md ──▶ ⏸ checkpoint 1
                                             │
        ┌────────────────────────────────────┘
        ▼
   [2 design] ──▶ design-system.md + design-tokens.json + preview.html ──▶ ⏸ checkpoint 2
        │
        ▼
   [3 provision] (déterministe, sans LLM) ──▶ WP up, GP/GB/Premium/Pro/GF/Yoast, child theme, tokens appliqués, menus, header/footer
        │
        ▼
   [4 plugins] ──▶ sites/<slug>/wp-content/plugins/<name>/ (PHP) ──▶ php -l + PHPStan ──▶ activate + seed
        │
        ▼
   [5 pages] ──▶ pages/<slug>.gb.json ──▶ gb_build.py ──▶ wp post create + meta GP
        │
        ▼
   [6 content] ──▶ formulaires GF, meta Yoast, articles blog
        │
        ▼
   [7 qa] ──▶ Playwright screenshots desktop/mobile + console/404 ──▶ refine ≤ 2 tours/page ──▶ QA-REPORT.md
        │
        ▼
   [8 export] ──▶ dist/ (wp-content.tar.gz, db.sql, docker-compose.prod.yml, README.md, MANIFEST.json)
```

Le CLI est propriétaire de la séquence. Chaque étape :
- lit ses entrées sur disque dans `sites/<slug>/`,
- lance zéro ou plusieurs `query()` avec un prompt système dédié (`src/prompts/<stage>.md`), un jeu d'outils restreint, et `outputFormat` JSON Schema quand la sortie est une structure,
- écrit ses artefacts sur disque,
- met à jour `sites/<slug>/faktory.json` (statut par étape, port, session ids, coût cumulé).

Reprise : `faktory run <slug>` repart de la première étape non terminée. `--from <stage>` et `--only <stage>` pour itérer.

Checkpoint : l'étape passe en `awaiting_approval`, le CLI affiche le chemin de l'artefact et sort. L'utilisateur édite le fichier à la main, puis `faktory approve <slug>` et `faktory run <slug>`. Pas de prompt interactif bloquant, donc scriptable.

## Layout du dépôt `faktory/`

```
package.json            # @anthropic-ai/claude-agent-sdk, zod, commander, playwright, vitest, tsx
tsconfig.json
src/
  cli.ts                # commander : init | run | approve | stage | export | destroy
  pipeline.ts           # registre des étapes, runner, gestion de faktory.json
  config.ts             # chargement faktory.config.json (modèles par étape, ports, chemins vendor)
  agent.ts              # wrapper query() : options communes, plugin local, hooks, coût
  stages/
    spec.ts  design.ts  provision.ts  plugins.ts  pages.ts  content.ts  qa.ts  export.ts
  tools/                # serveur MCP in-process via createSdkMcpServer + tool()
    wp.ts               # wp(args) → docker compose -p faktory-<slug> exec -T wpcli wp …
    gb.ts               # gb_build(json) / gb_preview(html) → appelle les scripts Python de la skill
    php.ts              # php_check(pluginDir) → php -l + phpstan (image composer, phpstan-wordpress)
    browser.ts          # screenshot(url, viewport) / check_page(url) → Playwright natif (pas MCP)
  schemas/
    site-spec.ts        # zod : identité, sitemap, sections par page, features→plugins, forms, seo, blog
    design-tokens.ts    # zod : palette, typo, échelle spacing, radius, header/footer variant
    page-tree.ts        # zod : arbre gb_build (validation avant compilation)
    plugin-spec.ts      # zod : CPT, taxos, meta, bloc/shortcode, colonnes admin
  prompts/
    spec.md  design.md  plugins.md  pages.md  content.md  qa.md
plugin/                 # plugin Claude Code chargé via options.plugins [{type:"local"}]
  .claude-plugin/plugin.json
  skills/               # copies synchronisées (script sync-skills), pas de symlinks
    generatepress-generateblocks/   wp-plugin-development/   wp-block-development/   wp-wpcli-and-ops/
docker/
  docker-compose.yml    # db (mariadb:11), wordpress (wordpress:6.x-php8.3-apache), wpcli (wordpress:cli)
  Dockerfile.wordpress  # + php extensions, wp-cli utilitaires si besoin
  vendor/               # gitignoré : gp-premium.zip, generateblocks-pro.zip, gravityforms.zip, gravityformscli.zip
  .env.example          # GP_LICENSE, GB_LICENSE, GF_LICENSE
sites/                  # gitignoré : un workspace par site
  <slug>/
    brief.md  SITE-SPEC.md  design-system.md  design-tokens.json  preview.html
    faktory.json  pages/*.gb.json  pages/*.html  content/  qa/  dist/
    wp-content/          # bind-mounted into the container; custom plugins go in wp-content/plugins/<name>/
fixtures/briefs/boulangerie.md      # brief de test réaliste (PME, 6 pages, 1 plugin "horaires & produits")
docs/superpowers/specs/2026-09-12-faktory-design.md   # ce design, committé en tâche 1
tests/
  unit/                 # vitest : schemas, pipeline state, wp arg builder, gb wrapper
  integration/          # tag @docker : provision sur site jetable, php_check sur plugin fixture
```

## Détail des étapes

### 1. `spec` — brief → SITE-SPEC.md
- Entrée : `brief.md`. Sortie : `SITE-SPEC.md` (lisible, à éditer) + `site-spec.json` (structuré, `outputFormat` = schéma zod converti en JSON Schema).
- Contenu : identité (nom, secteur, ton, langue), sitemap (pages avec slug, titre, objectif, liste ordonnée de sections typées : hero, features, cta, testimonials, faq, contact, custom-query), **features** nécessitant un plugin (nom, CPT, champs, taxos, affichage), formulaires (champs), SEO (title/meta par page, mots-clés), blog (thèmes des 3-5 articles), menus (principal, footer).
- Outils : Read seulement (le brief). Modèle Opus 5.
- Checkpoint 1.

### 2. `design` — spec → design system
- Entrée : `site-spec.json`, `brief.md`. Sortie : `design-system.md` (prose, forme du `levoyageur/design-system.md`), `design-tokens.json` (schéma), `preview.html` (hero + section type compilés via `gb_build` puis `gb_preview` pour vérification visuelle).
- Outils : Read, Write, `gb_build`, `gb_preview`. Skill `generatepress-generateblocks` chargée (doctrine `references/design-system.md`).
- Checkpoint 2.

### 3. `provision` — déterministe, sans LLM
Script TS pur, idempotent :
1. `docker compose -p faktory-<slug> up -d` avec port alloué dans `faktory.json`.
2. `wp core install` (fr_FR, permalinks `/%postname%/`, timezone Europe/Paris, suppression contenu exemple).
3. Install/activation : generatepress, generateblocks (wp.org) ; gp-premium, generateblocks-pro, gravityforms, gravityformscli (zips vendor, clés licence depuis `.env`) ; wordpress-seo (wp.org).
4. Child theme `faktory-<slug>` généré (style.css, functions.php minimal).
5. Application des tokens : `generate_settings` (couleurs globales, typographie) via `wp option update`. Les clés exactes seront relevées sur un site configuré à la main (`wp option get generate_settings --format=json`) pendant l'implémentation, pas devinées.
6. Menus (`wp menu create` + items depuis le sitemap), header et footer en GP Premium Elements (bloc GB compilé, CPT `gp_elements`, meta type/display conditions relevées de la même façon).

### 4. `plugins` — un `query()` par feature
- Entrée : `site-spec.json.features[i]` → `plugin-spec`. Sortie : `sites/<slug>/wp-content/plugins/<name>/` (bind mount).
- Contrat de plugin : header standard, `includes/` (register CPT/tax/meta), `blocks/<name>/block.json + render.php` (bloc dynamique rendu serveur, insérable dans les pages GB via `type: raw`), shortcode équivalent, colonnes admin, désinstallation propre.
- Outils : Read, Write, Edit, Glob, Grep, `php_check`, `wp`. Bash refusé via hook PreToolUse. Skills `wp-plugin-development`, `wp-block-development`.
- Boucle : écrire → `php_check` (php -l + PHPStan niveau 5 avec `szepeviktor/phpstan-wordpress`) → corriger → `wp plugin activate` → seed 3-5 entrées de démo → `wp post list --post_type=<cpt>` pour prouver.

### 5. `pages` — un `query()` par page
- Home d'abord (fixe le pattern), puis les autres pages en parallèle (concurrence 3).
- Entrée : spec de la page, `design-tokens.json`, `design-system.md`, liste des blocs plugins disponibles. Sortie : `pages/<slug>.gb.json` (validé par `page-tree`), `pages/<slug>.html` (gb_build), post créé avec meta `_generate-full-width-content`, `_generate-sidebar-layout-meta`, `_generate-disable-headline` (commandes reprises de la skill Elementor-import).
- Copy : court, factuel, dérivé du brief. Images : placeholders (`https://placehold.co` ou SVG local), `alt` renseigné.
- Outils : Read, Write, `gb_build`, `wp`. Skill `generatepress-generateblocks`.

### 6. `content` — formulaires, SEO, blog
- Formulaires : JSON Gravity Forms généré depuis la spec, importé par `wp gf form import` (add-on CLI). Shortcode `[gravityform id=N]` injecté dans la page contact (déjà réservé par l'étape pages via `type: raw`).
- SEO : `_yoast_wpseo_title` / `_yoast_wpseo_metadesc` par page via `wp post meta update`.
- Blog : 3-5 articles (~800 mots, blocs core Gutenberg) depuis les thèmes de la spec, catégorie, extrait, meta Yoast.

### 7. `qa` — vérification et raffinement borné
- Pour chaque page : `check_page` (status, erreurs console, liens 404, images cassées, blocs GB non stylés détectés par absence de `.gb-element-*` css) + `screenshot` desktop 1440 et mobile 390 après scroll complet.
- L'agent lit les captures (Read image), compare à la spec, corrige le `.gb.json` → recompile → `wp post update`. Max 2 tours par page.
- Sortie : `qa/QA-REPORT.md` (par page : statut, problèmes trouvés/corrigés/restants, captures).

### 8. `export`
- `wp db export` + `wp search-replace` vers `https://SITE_URL_PLACEHOLDER` dans le dump.
- `wp-content.tar.gz` (themes, plugins, uploads, mu-plugins).
- `docker-compose.prod.yml`, `README.md` (procédure de restauration, search-replace final, création admin, pointeurs WP Umbrella), `MANIFEST.json` (versions WP/plugins, pages, plugins custom, formulaires, coût de génération).

## Outils MCP in-process (`src/tools/`)

Tous définis avec `tool()` + zod, regroupés dans un `createSdkMcpServer({ name: "faktory" })`, passés dans `options.mcpServers`. Chaque étape reçoit `allowedTools` explicite (`mcp__faktory__wp`, `Read`, …). Un hook `PreToolUse` refuse tout `Write`/`Edit` hors de `sites/<slug>/` et tout `Bash` sauf dans l'étape qa si nécessaire.

| Outil | Signature | Implémentation |
|---|---|---|
| `wp` | `{ args: string[] }` → stdout/stderr/code | `docker compose -p faktory-<slug> -f docker/docker-compose.yml exec -T wpcli wp …` |
| `gb_build` | `{ tree: object, out: string }` | `python3 <plugin>/skills/generatepress-generateblocks/scripts/gb_build.py` |
| `gb_preview` | `{ html: string, out: string }` | `gb_preview.py` |
| `php_check` | `{ pluginDir: string }` → lint + phpstan | `docker run --rm -v … composer:2` avec phpstan-wordpress |
| `screenshot` | `{ url, viewport, out }` | Playwright chromium, scroll complet avant capture |
| `check_page` | `{ url }` → erreurs console, 404, images cassées, blocs non stylés | Playwright |

## Chargement des skills

`options.plugins = [{ type: "local", path: "<repo>/plugin" }]`. Le dossier `plugin/skills/` est rempli par `npm run sync-skills` (rsync depuis `~/.claude/skills/{generatepress-generateblocks,wp-plugin-development,wp-block-development,wp-wpcli-and-ops}`), pas de symlink pour éviter les surprises de résolution. Pas de `settingSources: ["user"]` : ça chargerait ~150 skills et gonflerait le contexte.

Fichiers réutilisés sans les modifier :
- `~/.claude/skills/generatepress-generateblocks/scripts/gb_build.py` et `gb_preview.py`
- `~/.claude/skills/generatepress-generateblocks/references/design-system.md` (doctrine injectée dans le prompt design)
- Boucle publish de `~/.claude/skills/generatepress-elementor-import/SKILL.md` (commandes wp post create + meta GP)
- `/Users/khelil/Developer/partikuls/levoyageur/design-system.md` (exemple de forme pour `design-system.md`)
- `/Users/khelil/Developer/partikuls/france-connect-wordpress/docker-compose.yml` (base du compose)

## Gestion des erreurs

- Chaque étape est atomique côté `faktory.json` : `pending | running | awaiting_approval | done | failed` + message. Un échec n'efface pas les artefacts produits ; `run` reprend là où ça a cassé.
- `query()` : capture `result.subtype` (`error_max_turns`, `error_max_structured_output_retries`…), retry 1 fois sur erreur structurée, sinon `failed`.
- `wp` renvoie code + stderr dans le tool result avec `isError: true` ; l'agent voit l'erreur et corrige.
- Budget : `--max-cost` (USD) lu depuis `result.total_cost_usd` cumulé ; dépassement → arrêt propre.
- `faktory destroy <slug>` : `compose down -v` + suppression workspace (confirmation).

## Ordre de construction

1. **Squelette + provision** : CLI, config, `faktory.json`, Docker stack, provision complète sans LLM, `sync-skills`. Vérif : `faktory init demo && faktory provision demo` → WP fr_FR avec GP/GB/Premium/Pro/GF/Yoast actifs sur `http://localhost:<port>`.
2. **spec + design + checkpoints** : schémas zod, prompts, `gb_build`/`gb_preview` tools, application des tokens, menus, header/footer. Vérif : sur `fixtures/briefs/boulangerie.md`, SITE-SPEC cohérent, preview.html propre, header/footer visibles sur le site.
3. **pages** : tool `wp`, page-tree schema, génération home puis parallèle. Vérif : toutes les pages du sitemap publiées, stylées (css GB présent), navigables.
4. **plugins** : tool `php_check`, contrat plugin, seed. Vérif : plugin fixture passe PHPStan, CPT visible en admin et rendu dans une page.
5. **content** : GF import, Yoast meta, articles. Vérif : formulaire contact fonctionnel (soumission test), meta SEO présentes, articles listés.
6. **qa + export** : Playwright tools, boucle refine, rapport, `dist/`. Vérif : `dist/` restauré dans un compose neuf → site identique.
7. **E2E** : run complet sur le brief boulangerie, mesure coût/durée, doc `README.md`.
8. **Finitions et différés** : habillage global du thème par les tokens (en-tête, menu, fonds, titres), page blog designée, formulaires à la charte, rapport des manques du brief, puis les reports des phases 4 à 7 (budget par agent, vraies images, soumission de formulaire, a11y, auto-approbation…). Détail et découpage : `2026-09-14-faktory-phase8-design.md`.

Chaque phase suit TDD (vitest) : schémas et logique pure en unit, Docker/wp en integration `@docker`.

## Vérification de bout en bout

```bash
npm run sync-skills
cp fixtures/briefs/boulangerie.md sites/boulangerie/brief.md   # via faktory init boulangerie --brief fixtures/…
faktory run boulangerie            # → s'arrête après SITE-SPEC.md
faktory approve boulangerie && faktory run boulangerie   # → s'arrête après design-system.md
faktory approve boulangerie && faktory run boulangerie   # → provision → plugins → pages → content → qa → export
open http://localhost:<port>       # contrôle visuel
cat sites/boulangerie/qa/QA-REPORT.md
ls sites/boulangerie/dist/
```

Critères d'acceptation v1 : le site du brief boulangerie a ses 6 pages stylées GB, header/footer/menus, un plugin CPT fonctionnel rendu dans une page, un formulaire contact GF qui envoie, meta Yoast sur chaque page, 3 articles, un `dist/` restaurable, et le run complet coûte moins que le `--max-cost` fixé (à mesurer, ordre de grandeur attendu : quelques dizaines de dollars).

## Hypothèses à confirmer pendant l'implémentation

- Clés exactes de `generate_settings` (GP) et meta des `gp_elements` (GP Premium) : à relever sur un site configuré à la main, pas à deviner.
- Gravity Forms CLI add-on disponible avec la licence ; sinon import par `wp eval-file` avec `GFAPI::add_form()`.
- Résolution des skills dans un plugin local Agent SDK : vérifiée à la phase 1 avec un `query()` de test qui liste les skills chargées.
