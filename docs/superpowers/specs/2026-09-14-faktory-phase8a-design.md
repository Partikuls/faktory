# Faktory — Phase 8a : habillage du thème et page blog

Addendum au périmètre `2026-09-14-faktory-phase8-design.md` (lot 8a, points A1 à A6). Rédigé le 2026-09-14. Là où ce document précise le périmètre, c'est ce document qui fait foi.

## Objectif

Un site livré par un run sans retouche suit le design system sur toutes ses pages : en-tête, menu, fonds, liens, titres, page blog, articles et formulaires. Critère de sortie : un run `provision → export` neuf sur `boulangerie` dont le QA ne relève aucun défaut de charte, avec coût et durée comparés à la phase 7 (16,70 $, 28 min 45 s).

## Décisions

| Question | Décision |
|---|---|
| En-tête | En-tête natif GeneratePress habillé par les réglages ; pas d'en-tête GB Pro. |
| Page blog | Gabarits déterministes construits par Faktory (arbres GB + Elements GP Premium), sans agent. |
| Formulaires | Thème Orbital de Gravity Forms réglé par le filtre `gform_default_styles` dans le thème enfant. |
| Manques du brief | Simple avertissement ; `approve` n'est jamais bloqué. |
| Emplacement | Tout dans l'étape `provision` (nouveaux modules sous `src/provision/`), sauf A6 (étape `spec` et `approve`). Pas de nouvelle étape. |

## A1 — Thème habillé par les tokens

### Causes, vérifiées dans GeneratePress 3.6.1 et sur `boulangerie-e2e`

1. **Mode hérité.** `applyTokens` écrit `generate_settings` avant que GeneratePress n'ait enregistré `generate_db_version`. Au premier chargement public, `GeneratePress_Theme_Update::init()` (`inc/class-theme-update.php`) voit des réglages sans version, en déduit une installation 2.0 et exécute `v_3_0_0` puis `v_3_1_0`, qui réécrivent les anciennes valeurs par défaut de toutes les clés absentes : `structure: floats`, `icons: font`, `#efefef`, `#222222`, `#1e73be`… Constaté : `structure = floats`, `generate_db_version = 3.6.1` estampillé après coup.
2. **Typographie non émise.** `GeneratePress_Typography::get_css('core')` ne garde que les règles portant `module: "core"`. `TYPO_RULE_DEFAULTS` n'a pas de clé `module` : les 9 règles sont stockées puis toutes filtrées, d'où l'absence de toute règle `font-family`.

### Changements (`src/provision/settings.ts`)

1. **Version d'abord.** `applyTokens` lit la version installée (`wp theme get generatepress --field=version`) et écrit `generate_db_version` avant `generate_settings`.
2. **Remplacement, pas fusion.** `generate_settings` est écrit à partir de `buildGenerateSettings(tokens)` seul ; les clés non fournies retombent sur les défauts d'une installation neuve (`inc/defaults.php`). Un rerun `--only provision` répare ainsi un site déjà migré. Faktory est propriétaire de ces réglages ; le logo (theme_mod) n'est pas concerné.
3. **Clés de structure explicites.** `structure: "flexbox"`, `icons: "svg"`, `combine_css: true`, `dynamic_css_cache: true`.
4. **Typographie.** `TYPO_RULE_DEFAULTS` gagne `module: "core"`.
5. **Couleurs de composants sur la palette.** Les rôles de la palette Faktory diffèrent de ceux de GeneratePress (`base` = fond de page, `base-3` = surfaces) :

| Réglages GeneratePress | Valeur |
|---|---|
| `background_color`, `content_background_color` | `var(--base)` |
| `text_color`, `site_title_color`, `blog_post_title_color`, `form_text_color` | `var(--contrast)` |
| `link_color` / `link_color_hover` | `var(--accent)` / `var(--contrast)` |
| `header_background_color`, `navigation_background_color` | `var(--base-3)` |
| `navigation_text_color` / `navigation_text_hover_color`, `navigation_text_current_color` | `var(--contrast)` / `var(--accent)` |
| `subnavigation_background_color` / `subnavigation_text_color` | `var(--base-3)` / `var(--contrast)` |
| `site_tagline_color`, `entry_meta_text_color`, `blog_post_title_hover_color` | `var(--contrast-2)` |
| `entry_meta_link_color` | `var(--accent)` |
| `form_background_color` / `form_border_color` | `var(--base-3)` / `var(--contrast-3)` |
| `form_button_background_color` / `form_button_background_color_hover` | `var(--accent)` / `var(--contrast)` |
| `form_button_text_color`, `form_button_text_color_hover` | `var(--base-3)` |
| `footer_background_color` | `var(--contrast)` (derrière l'Element pied de page) |

`applyTokens` règle aussi `posts_per_page` à 9 et vide toujours le cache `generate_dynamic_css_output`.

### Tests

- Unit : chaque règle typographique porte `module: "core"` ; aucune valeur de couleur n'est un hexadécimal brut ; `structure` vaut `flexbox` ; le résultat ne dépend d'aucune option existante.
- Intégration `@docker` : stack neuve, `generate_settings` hérité pré-injecté, provision, un GET de la page d'accueil (déclenche le hook `wp`), puis : `structure = flexbox`, la CSS inline contient `font-family` Fraunces sur les titres et Figtree sur `body`, et `var(--base)` en fond de `body`.

## A2 / A3 — Page blog et page d'un article

### Module

`src/provision/blog.ts` : constructeurs purs `blogHeroTree`, `blogLoopTree`, `postHeroTree`, et `installBlog(ctx, spec, tokens)` qui crée ou met à jour les Elements par slug. Les briques partagées avec le pied de page (`text`, `esc`, `isPlaceholder`, pas d'espacement `step`, `MOBILE`, création/mise à jour d'un Element bloc) passent dans `src/provision/elements.ts`, que `footer.ts` importe. Exécuté seulement si l'arborescence a une page `blog` et que GP Premium est présent.

### Elements

1. **`faktory-blog-hero`** — type `page-hero`, condition `general:blog`. Section sur `var(--base-2)` : `h1` = titre de la page blog dans la spec, paragraphe d'introduction = `seo.metaDescription` de cette page (texte destiné au visiteur, contrairement à `goal`), padding de section des tokens. Seul `h1` de `/actualites/`.
2. **`faktory-blog-loop`** — type `loop-template`, conditions `general:blog` et archives de catégorie.
   - Bloc GB `query` avec `inheritQuery: true` (requête principale et pagination) ;
   - `looper` en grille : 3 colonnes desktop, 2 tablette, 1 mobile ; écart pris dans la rampe d'espacement ;
   - chaque `loop-item` est une carte `var(--base-3)`, rayon des tokens, bordure 1 px `var(--contrast-3)` : `featured_image` recadrée (`aspect-ratio: 3/2`, `object-fit: cover`), catégorie (`term_list`) en petites capitales `var(--accent)`, date au format du site en `var(--contrast-2)`, titre `h2` lié à l'article en police de titre, `post_excerpt` d'environ 20 mots, lien « Lire l'article » dont le nom accessible contient le titre ; léger soulèvement au survol, contour `focus-visible` ;
   - pagination : bloc GB `query-page-numbers` (nœud `raw`) sur les variables de palette ;
   - `query-no-results` : « Aucun article pour le moment. »
3. **`faktory-post-hero`** — type `page-hero`, condition `post:post`. Conteneur étroit (≈ 760 px) : lien de catégorie, date, `h1` (`post_title`), image à la une pleine largeur (`aspect-ratio: 16/9`, rayon des tokens). Métas `_generate_disable_title`, `_generate_disable_featured_image` et `_generate_disable_primary_post_meta` à `true` pour que GeneratePress ne répète ni titre, ni image, ni « by admin ».

### Tests

- Unit (assertions structurelles, sans snapshot) : un seul `h1` par hero ; `inheritQuery` présent ; la grille passe à une colonne sous `MOBILE` ; aucune couleur hexadécimale ; texte de spec échappé.
- Intégration `@docker` : provision + 10 articles de test ; GET `/actualites/` → un `h1`, 9 `.gb-loop-item`, liens de pagination, pas de « by admin » ; GET `/actualites/page/2/` → 1 carte ; GET d'un article → un `h1`, une image à la une.

## A4 — Formulaires à la charte

### Module

`src/provision/child-theme.ts` : `childThemeFunctions(slug, tokens)` (pur) renvoie le `functions.php` complet ; `installChildTheme(ctx, tokens)` l'écrit dans `sites/<slug>/wp-content/themes/faktory-<slug>/` (monté dans le conteneur, donc inclus dans l'archive d'export). Réécrit à chaque provision, avec un en-tête « généré par Faktory, ne pas modifier » ; le code d'enqueue du scaffold est conservé.

### Contenu

Filtre `gform_default_styles` renvoyant en JSON :

| Clé Gravity Forms | Token |
|---|---|
| `inputPrimaryColor`, `buttonPrimaryBackgroundColor` | `accent` |
| `buttonPrimaryColor`, `inputBackgroundColor` | `base3` |
| `inputColor`, `labelColor` | `contrast` |
| `descriptionColor` | `contrast2` |
| `inputBorderColor` | `contrast3` |
| `inputBorderRadius` | `radius` |
| `inputSize` | `md` |

Gravity Forms n'accepte que des hexadécimaux : c'est le seul endroit où les tokens sont écrits en valeurs plutôt qu'en `var(--…)`, régénérés à chaque provision. `rg_gforms_default_theme` est fixé à `orbital` pendant provision. Police : `wp_add_inline_style` ajoute `.gform-theme--framework { --gf-font-family: <police du corps>; }`. Les chaînes injectées dans le PHP passent par un échappement (`'` et `\`) ; hexadécimaux, rayon et noms de police sont déjà validés par le schéma des tokens. Ignoré avec raison si Gravity Forms est absent.

### Tests

- Unit : toutes les clés présentes et égales aux tokens ; un nom de police contenant `'` est échappé.
- `php -l` sur le fichier généré.
- Intégration `@docker` : GET `/contact/` → le JSON de style du formulaire contient l'hexadécimal `accent`.

## A5 — Traductions

Constat : les fichiers français de Gravity Forms et de GP Premium sont présents ; ceux de GeneratePress manquent (pas de `languages/themes/`), d'où « by ».

- `installCore`, après `language core install` : `wp language theme install generatepress fr_FR` et `wp language plugin install generateblocks wordpress-seo fr_FR`. Les extensions commerciales ne sont pas sur wordpress.org.
- Best-effort : un échec du serveur de traductions ajoute un avertissement au résumé de provision sans faire échouer l'étape.
- Test d'intégration : `wp language theme is-installed generatepress fr_FR` renvoie 0 après provision.
- QA : contrôle déterministe des chaînes anglaises visibles (`by`, `Read more`, `Leave a Comment`, `Posted in`) dans le texte rendu de chaque page, compté comme défaut automatique.

## A6 — Rapport des manques du brief

### Module

`src/spec-gaps.ts` : `findSpecGaps(spec): Gap[]`, `Gap = { path: string; label: string }`. Parcourt récursivement toutes les chaînes de `site-spec.json` à la recherche du marqueur `[à confirmer]` exigé par `src/prompts/spec.md` (même test que `isPlaceholder`, qui est déplacé ici et importé par `elements.ts`). Libellés lisibles : `identity.contact.phone` → « Téléphone » ; les lignes `identity.contact.hours[*]` regroupées en « Horaires (7 jours) » ; `sitemap[…].sections[i]` → « Page Accueil › Horaires & accès » ; idem pour `forms`, `features`, `blog.articles`.

### Affichage

- `SITE-SPEC.md` : section `## Informations à compléter` juste après l'avertissement de tête, une puce par manque, puis « Remplacez chaque `[à confirmer]` dans ce fichier puis `faktory approve`. » Absente s'il n'y a aucun manque.
- Resync : la section est dérivée ; une phrase du prompt de resync demande de l'ignorer. Les manques sont toujours recalculés depuis le JSON.
- Console : le résumé de l'étape `spec` ajoute « N informations à compléter » ; `approveSite`, après un éventuel resync, affiche `⚠ N informations à compléter dans SITE-SPEC.md (Téléphone, Adresse, Horaires…) — le site affichera des manques` et approuve quand même.

### Tests

- Unit : la spec boulangerie des fixtures donne Téléphone, Adresse, Horaires ; une spec complète donne une liste vide et aucune section.
- Unit : rendu et échappement de la section.
- Pipeline (étapes factices) : `approve` affiche l'avertissement et l'état passe à approuvé.

## Déroulé de `provision`

`composeUp → waitForDb → installCore (+ paquets fr_FR) → installStack → applyIdentity → ensurePages / ensureMenus → applyTokens → installChildTheme → installFooter → installBlog`

Chaque nouvelle fonction est ajoutée à `deps` pour les tests de l'étape. Le résumé gagne `blog elements #a #b #c`, `gf styles`, `fr_FR packs: ok|warn`, ou la raison d'un saut (pas de page blog, GP Premium ou Gravity Forms absent). Seuls les paquets de langue sont best-effort ; les autres étapes restent en échec immédiat via `wpOk`.

## Vérification 8a

1. Suites unit et intégration vertes, `tsc` et phpstan propres.
2. Réparation : `faktory run boulangerie-e2e --only provision` sur le site hérité, puis contrôle navigateur : mode flexbox, polices des titres et du corps, couleurs de palette sur en-tête, menu, fonds et liens.
3. Run neuf : `boulangerie`, `provision → export`, lancé détaché (nohup + log).
4. Compte rendu dans une section « Écarts et mesures » ajoutée à ce document : défauts QA de charte (attendu : aucun sur en-tête, menu, fonds, titres, blog, formulaires) ; `/actualites/` en grille avec un seul `h1` ; aucune couleur par défaut de GeneratePress ou Gravity Forms sur les captures ; coût et durée comparés à la phase 7.
