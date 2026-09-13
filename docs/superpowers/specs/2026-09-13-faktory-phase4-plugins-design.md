# Faktory — Phase 4 : étape `plugins`

Addendum au design `2026-09-12-faktory-design.md` (section « 4. plugins »). Approuvé en discussion le 2026-09-13. Là où ce document précise ou contredit le design initial ou le plan de la phase 3, c'est ce document qui fait foi.

## Objectif

`faktory run <slug>` écrit, vérifie, active et alimente un plugin WordPress sur-mesure par `feature` de la spec (CPT + taxonomies + champs + bloc dynamique + shortcode + colonnes admin), puis insère le rendu du plugin dans les pages à la place des cartes d'exemple posées par l'étape `pages`. Critère d'acceptation (design initial, « Ordre de construction » 4) : le plugin passe PHPStan, le CPT est visible en admin et rendu dans une page.

## Décisions

1. **Ordre des étapes inchangé (`provision → plugins → pages`), substitution à la compilation.** Les arbres `pages/<slug>.gb.json` gardent leur enveloppe `data-faktory-feature="<id>"` (cartes d'exemple + marqueur) pour toujours : c'est la surface d'édition. Au moment de compiler, `applyPlugins(tree, manifests, pageSlug)` remplace en mémoire chaque enveloppe par un nœud `{ "type": "raw", "rawMarkup": <placement> }` lu dans le manifeste du plugin. L'étape `pages` applique les manifestes présents ; l'étape `plugins`, après avoir construit un plugin, recompile et republie chaque arbre existant qui référence la feature. Les deux ordres d'exécution fonctionnent, régénérer une page ne perd jamais le plugin, et aucun helper de mutation d'arbre n'est nécessaire. Ceci remplace la formulation de la phase 3 (« remplacer le nœud dans le `.gb.json` »). Une enveloppe sans manifeste reste telle quelle (placeholder visible).
2. **Un `query()` par feature, en séquence.** Les features d'un site sont peu nombreuses (1 à 2) et chaque agent est long ; la concurrence n'apporte rien et la répartition du budget par agent reste différée. Le budget est vérifié avant chaque agent (`assertBudget`).
3. **Livrables de l'agent.** Outils : `Read`, `Write`, `Edit`, `Glob`, `Grep`, `wp`, `php_check` (nouveau). Pas de Bash. Skills : `wp-plugin-development`, `wp-block-development`, `wp-wpcli-and-ops`. L'agent écrit :
   - le plugin dans `wp-content/plugins/faktory-<kebab>/` (voir « Contrat de plugin ») ;
   - le manifeste `plugins/<id>.json` (voir « Manifeste ») ;
   - puis active le plugin (`wp plugin activate faktory-<kebab>`) et alimente 4 à 6 entrées de démonstration avec `wp` (termes des taxonomies, posts du CPT, meta, image à la une importée depuis `https://placehold.co/800x600.png` via `wp media import … --porcelain` puis `wp post meta update <id> _thumbnail_id <att>`).
   `<id>` est l'identifiant snake_case de la feature (`produits`), `<kebab>` sa forme kebab-case (`_` → `-`).
4. **Faktory valide puis intègre.** `runValidated` (une relance dans la même session) avec, dans l'ordre : manifeste conforme au schéma zod ; fichiers obligatoires présents ; `php_check` sans erreur ; aucune couleur hex dans `style.css` (même règle que `hexIssues` des pages) ; plugin `active` dans `wp plugin list` ; post type présent dans `wp post-type list` ; `wp post list --post_type=<cpt> --format=count` ≥ 3 ; chaque terme de chaque taxonomie présent ; un `placement` par page dont une section `custom-query` référence la feature, aucun pour les autres pages ; chaque placement passe la liste noire de la phase 3 (`<script`, `<iframe`, `javascript:`, `on*=`) et commence par `<!-- wp:faktory/<kebab>`. Intégration : pour chaque page placée dont l'arbre existe, `applyPlugins` → `compilePage` → `publishPage`, puis `GET http://localhost:<port>/<slug>/` (ou `/` pour la home) doit contenir `data-faktory-plugin="<id>"`. Une page sans arbre (étape `pages` pas encore passée) est simplement ignorée : l'étape `pages` appliquera le manifeste.
5. **Réutilisation.** Si `plugins/<id>.json` et le dossier du plugin existent, aucun appel LLM : Faktory relance la validation (php_check, activation, comptages) puis l'intégration. Supprimer le manifeste pour régénérer le plugin. Un manifeste poison (toujours invalide après la relance) est supprimé, comme les arbres de pages.
6. **`php_check`.** `php -l` sur chaque `.php` du dossier, puis PHPStan niveau 5 avec `szepeviktor/phpstan-wordpress`, exécutés avec le PHP de l'hôte. Les paquets sont installés une fois par `npm run setup-phpstan` (= `composer install -d tools/phpstan`) ; `tools/phpstan/composer.json` et `tools/phpstan/phpstan.neon` sont committés, `tools/phpstan/vendor/` est gitignoré. `faktory doctor` vérifie `php`, `composer` et la présence de `tools/phpstan/vendor/bin/phpstan`. Sans PHPStan installé, `php_check` échoue explicitement (pas de repli silencieux sur `php -l` seul).
7. **Portée d'écriture par étape.** `AgentOptions.writeRoots` (chemins relatifs au site) : le hook `PreToolUse` refuse tout `Write`/`Edit` hors de ces racines. `pages` : `["pages"]`. `plugins` : `["wp-content/plugins/faktory-<kebab>", "plugins"]`. Sans `writeRoots`, le comportement actuel (tout le dossier du site) est conservé.
8. **Différé.** Répartition du budget par agent concurrent, en-tête GB Pro, rafraîchissement des titres de page, police Fraunces des titres, avertissement `--from/--only` sur un checkpoint.

## Contrat de plugin

Dossier `wp-content/plugins/faktory-<kebab>/` :

| Fichier | Rôle |
|---|---|
| `faktory-<kebab>.php` | En-tête standard (`Plugin Name: Faktory — <feature.name>`, `Text Domain: faktory-<kebab>`, `Requires PHP: 8.1`), constantes, `require` des includes, `register_activation_hook` (enregistre le CPT puis `flush_rewrite_rules`), enregistrement du bloc et du shortcode. |
| `includes/post-type.php` | `register_post_type(<cpt.slug>)` : `public`, `show_in_rest`, `has_archive => false`, `supports => ['title', 'editor', 'thumbnail']`, libellés français depuis `cpt.singular`/`cpt.plural`, icône dashicon. |
| `includes/taxonomies.php` | Une `register_taxonomy` par taxonomie (`hierarchical => true`, `show_in_rest`, `show_admin_column`). |
| `includes/meta.php` | `register_post_meta` par champ (clé `_<cpt.slug>_<field.key>`, `show_in_rest` avec `auth_callback` = `current_user_can('edit_posts')`), meta box classique (PHP) avec nonce, `sanitize_*` par type et `esc_*` à l'affichage. Types : `text`/`url` → input, `textarea` → textarea, `number`/`price` → input number (prix en euros, 2 décimales), `date` → input date, `select` → select sur `options`, `boolean` → checkbox. Le **premier** champ `image` est l'image à la une (`thumbnail`), pas une meta ; tout champ `image` supplémentaire est une meta « ID d'attachement » avec bouton médiathèque (`wp_enqueue_media` + `assets/media-field.js`, JS sans build). |
| `includes/admin-columns.php` | Colonnes admin : miniature, champs courts (prix, disponibilité, booléens), taxonomies ; tri sur les champs `number`/`price`/`date`. |
| `includes/render.php` | `faktory_<id>_render(array $args): string` — la seule fonction de rendu, utilisée par le bloc et le shortcode. `WP_Query` sur le CPT, arguments `view` (`grid` \| `featured`), `limit`, `filter` (bool : filtres par taxonomie, liens `?<tax>=<term>` côté serveur, sans JS), `taxonomy`/`term`. L'élément racine porte `class="faktory-<kebab> faktory-<kebab>--<view>"` **et `data-faktory-plugin="<id>"`** (contrat vérifié par Faktory). Sortie échappée, markup sémantique (`<ul>`/`<li>` ou `<article>`), image `alt` = titre. |
| `blocks/<kebab>/block.json` | `"name": "faktory/<kebab>"`, `"apiVersion": 3`, `"render": "file:./render.php"`, `"editorScript": "file:./index.js"`, `"style": "faktory-<kebab>"` (handle enregistré par `wp_register_style` dans le fichier principal ; `faktory_<id>_render` l'enfile aussi, pour le shortcode), attributs `view`, `limit`, `filter`, `taxonomy`, `term` avec valeurs par défaut. |
| `blocks/<kebab>/render.php` | `echo faktory_<id>_render($attributes);` |
| `blocks/<kebab>/index.js` | JS sans build : `wp.blocks.registerBlockType('faktory/<kebab>', { edit: () => wp.element.createElement(wp.serverSideRender, { block: 'faktory/<kebab>', attributes }) , save: () => null })`, avec un `InspectorControls` minimal pour `view`/`limit`/`filter`. |
| `style.css` | Styles du rendu : uniquement `var(--base…)`, `var(--contrast…)`, `var(--accent…)`, `var(--gb-container-width)` ; grille responsive (`@media (max-width:767px)` → une colonne) ; aucune couleur hex ni `rgb()`. |
| `uninstall.php` | Supprime les posts du CPT, les termes des taxonomies et les meta ; garde-fou `WP_UNINSTALL_PLUGIN`. |

Shortcode équivalent : `[faktory_<id> view="grid" limit="12" filter="1"]` → `faktory_<id>_render`.

Le plugin de référence `fixtures/plugins/faktory-produits/` (écrit à la main pour la feature `produits` de la spec boulangerie, passe PHPStan niveau 5) est **le** modèle : le prompt indique son chemin absolu à l'agent, qui le lit et l'adapte à sa feature plutôt que de repartir de zéro.

## Manifeste `plugins/<id>.json`

```json
{
  "feature": "produits",
  "plugin": "faktory-produits",
  "postType": "produit",
  "block": "faktory/produits",
  "shortcode": "faktory_produits",
  "placements": {
    "accueil": "<!-- wp:faktory/produits {\"view\":\"featured\",\"limit\":4} /-->",
    "nos-produits": "<!-- wp:faktory/produits {\"view\":\"grid\",\"filter\":true} /-->"
  }
}
```

Schéma zod `src/schemas/plugin-manifest.ts` : `feature` = clé snake_case égale à l'id de la feature demandée ; `plugin` = `faktory-<kebab>` ; `postType` = `cpt.slug` de la spec ; `block` = `faktory/<kebab>` ; `shortcode` = `faktory_<id>` ; `placements` = objet slug de page → markup (chaînes non vides). Les contraintes croisées avec la spec (pages attendues, valeurs dérivées de l'id) sont vérifiées par `validatePluginManifest(manifest, spec, feature)`.

## Prompt `src/prompts/plugins.md`

Même forme que `pages.md` : rôle (développeur de plugins WordPress Partikuls), entrées à lire (le plugin de référence, `site-spec.json` uniquement pour la feature concernée — la feature complète et les pages qui l'affichent sont dans le prompt utilisateur), sortie (dossier du plugin + manifeste ; Faktory valide, insère dans les pages et republie), boucle de travail (écrire → `php_check` → corriger → `wp plugin activate` → seed → `wp post list` pour prouver), règles (contrat ci-dessus, palette GP uniquement, sécurité : nonce, capability, sanitize/escape, pas de SQL brut), limites (pas de Bash, pas d'écriture hors du dossier du plugin et de `plugins/`, deux allers-retours `php_check` maximum avant de répondre). Le prompt utilisateur `pluginsUserPrompt(spec, feature)` liste : la feature (id, nom, description, CPT, champs, taxonomies et termes, `display`), les pages qui l'affichent avec le `summary` de chaque section `custom-query` concernée, et le chemin du plugin de référence.

## Fichiers

| Fichier | Responsabilité |
|---|---|
| `tools/phpstan/composer.json`, `tools/phpstan/phpstan.neon`, `.gitignore` (+ `tools/phpstan/vendor/`), `package.json` (`setup-phpstan`) | Chaîne PHPStan locale |
| `src/php.ts` | `phpLint(dir)`, `phpstan(dir)`, `phpCheck(config, dir)` → `{ ok, output }` |
| `src/tools/server.ts` (modifier) | Outil `php_check` (`TOOL_PHP_CHECK`), `pluginDir` relatif au site |
| `src/agent.ts` (modifier) | `AgentOptions.writeRoots`, `writeGuard(siteDir, roots?)` |
| `src/pages/generate.ts` (modifier) | `writeRoots: ["pages"]` |
| `src/schemas/plugin-manifest.ts` | Schéma, `parsePluginManifest`, `validatePluginManifest`, `pluginSlug(id)`, `blockName(id)`, `shortcodeName(id)`, `manifestPath/Rel` |
| `src/pages/apply-plugins.ts` | `applyPlugins(tree, manifests, pageSlug)` (copie, sans mutation de l'entrée), `readPluginManifests(ctx)` |
| `src/pages/publish.ts` (modifier) | `compilePage` accepte l'arbre déjà appliqué (inchangé) ; `pagesStage` appelle `applyPlugins` avant `compilePage` |
| `src/plugins/generate.ts` | `pluginsUserPrompt`, `readPluginManifest`, `verifyPlugin(ctx, spec, feature)` (fichiers, php_check, hex CSS, wp plugin list, post-type, comptages, termes), `generatePlugin` (`runValidated`) |
| `src/plugins/integrate.ts` | `integratePlugin(ctx, spec, manifest, ids)` : arbres existants → apply → compile → publish → `fetch` et contrôle `data-faktory-plugin` |
| `src/stages/plugins.ts` | `pluginsStage` : features en séquence, réutilisation, message récapitulatif avec coût |
| `src/pipeline.ts` (modifier) | Enregistrer `plugins` |
| `src/prompts/plugins.md`, `src/prompts.ts` (modifier) | Prompt système |
| `src/cli.ts` (modifier) | `doctor` : php, composer, phpstan |
| `fixtures/plugins/faktory-produits/**` | Plugin de référence |
| `fixtures/plugins/produits.manifest.json` | Manifeste de référence |
| `tests/unit/{php,plugin-manifest,apply-plugins,plugins-generate,plugins-integrate,stage-plugins,agent-writeroots,tools-server}.test.ts` | Unitaires |
| `tests/integration/plugins.test.ts` | Docker (port 8195) : plugin de référence copié dans un site jetable, activé, alimenté, inséré dans une page stub, `data-faktory-plugin` rendu |
| `README.md`, mémoire projet | Usage, contrat, coût mesuré |

## Vérification de bout en bout

Sur `sites/boulangerie` (port 8101), dans l'ordre :

```bash
npm run setup-phpstan && npm run faktory -- doctor
rm sites/boulangerie/pages/*.gb.json          # arbres antérieurs à la convention d'enveloppe (handover phase 3), ≈ $6
npm run faktory -- run boulangerie --only pages --max-cost 20
npm run faktory -- run boulangerie --only plugins --max-cost 30
```

Attendu : `✔ plugins — 1 plugin (faktory-produits: produit, 5 entrées, 2 pages mises à jour) ; 1 généré, 0 réutilisé — $<coût>`. Contrôle dans Chrome : `/wp-admin/edit.php?post_type=produit` liste les produits avec miniatures et colonnes ; `/` montre 4 produits mis en avant ; `/nos-produits/` montre la grille complète avec filtres par catégorie fonctionnels ; aucune carte d'exemple ne subsiste sur ces deux pages ; largeur 390 px → une colonne. Coût attendu : 3 à 8 $ par feature, à mesurer et consigner dans le README.
