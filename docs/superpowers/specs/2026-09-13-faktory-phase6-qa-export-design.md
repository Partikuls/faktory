# Faktory — Phase 6 : étapes `qa` et `export`

Addendum au design `2026-09-12-faktory-design.md` (sections « 7. qa » et « 8. export »). Approuvé en discussion le 2026-09-13. Là où ce document précise ou contredit le design initial ou les plans des phases 3 à 5, c'est ce document qui fait foi. Il couvre deux étapes indépendantes ; elles sont implémentées par deux plans (6a `qa`, 6b `export`) exécutés l'un après l'autre.

## Objectif

`faktory run <slug>` termine la chaîne : après `content`, l'étape `qa` contrôle chaque URL du site dans un navigateur (statut HTTP, erreurs console, requêtes en échec, liens et images cassés, blocs GenerateBlocks sans CSS, débordement mobile), capture chaque page en desktop et en mobile, fait relire les pages générées par un agent qui corrige l'arbre `pages/<slug>.gb.json` (deux tours au plus), puis écrit `qa/QA-REPORT.md`. L'étape `export` produit `dist/` : dump SQL avec URL placeholder, archive `wp-content`, Compose de production, README de restauration et `MANIFEST.json`. Critère d'acceptation (design initial, « Ordre de construction » 6) : `dist/` restauré dans un Compose neuf donne le même site.

Vérifié sur le site boulangerie avant rédaction (2026-09-13) : WordPress 7.1, GeneratePress 3.6.1, GenerateBlocks 2.4.1, GP Premium 2.5.6, GB Pro 2.7.1, Gravity Forms 3.1.1.2, Yoast 28.4. `wp search-replace http://localhost:8101 https://SITE_URL_PLACEHOLDER --all-tables-with-prefix --export` écrit le dump (2,1 Mo) sur stdout sans modifier la base ; il reste 5 occurrences de l'URL locale sous forme JSON échappée (`http:\/\/localhost:8101`) dans `wp_yoast_indexable`, qu'un second `search-replace` avec la forme échappée trouve aussi (5 remplacements en `--dry-run`). `wp db import -` lit stdin ; `wp yoast index --reindex` existe. Dans le navigateur, sur `/contact/` : 58 classes `gb-*` toutes stylées par les `<style>` de la page, 0 image cassée, 0 erreur console, `.gform_wrapper` présent, 1 seul `h1`, page de 3 862 px de haut. Playwright n'est pas installé dans le dépôt mais des builds Chromium existent déjà dans `~/Library/Caches/ms-playwright`.

## Décisions

### `qa`

1. **Faktory pilote la boucle, l'agent relit.** Aucun nouvel outil MCP : l'agent ne touche pas au navigateur. Pour chaque URL, Faktory exécute le contrôle et les captures (Playwright sur l'hôte), puis, pour les pages qui ont un arbre, lance un agent qui lit les captures et les résultats, et peut réécrire `pages/<slug>.gb.json`. Si l'arbre a changé, Faktory le valide, réapplique les placements, recompile, republie, recontrôle, et relance l'agent dans la même session (`resume`). **Deux tours de correction au plus par page**, puis un contrôle final. Concurrence 3 (comme `pages`), un seul navigateur partagé, un contexte par contrôle.
2. **Périmètre.** Toutes les pages du sitemap (`pageUrl`) et tous les articles publiés (`/<slug>/`, `slug = articleSlug(title)`) sont contrôlés et capturés. Seules les pages qui ont un `pages/<slug>.gb.json` sont relues par l'agent ; la page blog et les articles n'ont que le contrôle et les captures (rien à corriger dans un arbre).
3. **Navigateur : `playwright` sur l'hôte.** Dépendance `playwright` (^1.63), script `npm run setup-playwright` (`playwright install chromium`), `doctor` vérifie l'exécutable Chromium (`chromium.executablePath()`) et indique le script. Navigateur absent = échec explicite de l'étape avant tout appel LLM.
4. **Contrôle d'une URL** (`checkPage`) → `qa/<slug>.check.json` :
   - navigation Chromium 1440×900, `waitUntil: "networkidle"` ; statut de la réponse principale ; **statut ≠ 200 = échec de l'étape** (site cassé, pas un défaut de page) ;
   - `consoleErrors` (messages `console` de type `error`), `pageErrors` (exceptions non rattrapées) ;
   - `failedRequests` : requêtes de même origine en échec réseau ou en statut ≥ 400 ;
   - `brokenLinks` : chaque `<a href>` de même origine (fragment retiré ; `mailto:`, `tel:`, `wp-admin`, `wp-login` ignorés ; 50 liens par page au plus) est demandé une fois par run (cache partagé) ; statut ≥ 400 = cassé ;
   - `brokenImages` (`naturalWidth === 0`), `missingAlt` (nombre d'images sans `alt`) ;
   - `unstyledBlocks` : classes `gb-(element|text|media|container|grid|shape|looper|query)-<id>` présentes dans le DOM dont le sélecteur `.gb-…-<id>` n'apparaît dans aucun `<style>` de la page ;
   - `h1Count` ;
   - `mobileOverflow` : en 390×844, `document.documentElement.scrollWidth > window.innerWidth` ;
   - `checkedAt`.
5. **Captures.** Après un défilement complet (images différées), en desktop 1440×900 puis mobile 390×844 (`deviceScaleFactor` 1) : la page entière (`qa/<slug>.desktop.png`, `qa/<slug>.mobile.png`) **et** des tuiles de la hauteur du viewport (`qa/<slug>.desktop.<n>.png`, `qa/<slug>.mobile.<n>.png`, 12 tuiles au plus par viewport) pour que l'agent lise la page à l'échelle. Les captures d'un tour écrasent celles du précédent ; celles du contrôle final restent dans `qa/`.
6. **Agent de relecture** (un par page relue) : prompt `src/prompts/qa.md`, modèle `config.models.qa ?? config.models.default`, outils `Read`, `Write` (`writeRoots: ["pages"]`), `gb_build`, `maxTurns` 20, `assertBudget` avant chaque lancement. Le prompt utilisateur donne la page (sections de la spec, objectif), la liste des défauts automatiques du contrôle, les chemins des captures à lire (page entière puis tuiles), et demande de lire `design-system.md` et `pages/<slug>.gb.json`. Sortie structurée (`outputFormat`) :
   ```json
   { "verdict": "ok" | "fixed" | "needs_human", "summary": "…", "issues": [ { "severity": "major" | "minor", "where": "section hero", "what": "…", "action": "fixed" | "left" } ] }
   ```
   Validation (`runValidated`, une relance) : schéma zod ; `fixed` ⇒ au moins un `issue.action = "fixed"` **et** l'arbre a changé (hash SHA-256 du fichier) ; `ok` ⇒ aucun `issue.action = "left"` ; `needs_human` ⇒ au moins un `left` ; un arbre modifié doit passer `readPageTree` (schéma, marqueurs obligatoires, liste noire). **Un arbre modifié invalide est restauré** à son contenu précédent (gardé en mémoire) et consigné comme correction refusée (`issue` `left`, `what` = l'erreur) : une page n'est jamais perdue. L'agent ne voit que ce que le prompt lui donne : il ne lit pas `SITE-SPEC.md` ni le brief.
7. **Republication** par `republishPage(ctx, spec, page, id, tree)` dans `src/pages/publish.ts` : applique `pluginPlacements` + `formPlacements`, compile, publie, vérifie `assertRendered` / `assertFormRendered`. Cette fonction est **extraite** de la boucle interne de l'étape `pages`, qui l'utilise désormais (refactor ciblé ; `plugins/integrate.ts` et `content/forms.ts` gardent leur code).
8. **Résultat : rapport, jamais blocage.** `qa/report.json` (machine) et `qa/QA-REPORT.md` (humain, français) : ligne de synthèse (URLs contrôlées, pages relues, `ok` / `fixed` / `needs_human`, défauts restants, coût), puis par URL : statut, tableau des contrôles, tours, verdict, défauts trouvés / corrigés / restants, liens vers les captures, coût. L'étape est `done` même avec des défauts restants ; elle échoue seulement sur une URL ≠ 200, un navigateur absent, une erreur d'agent ou le budget. Message d'étape : `qa: 11 urls checked; 5 reviewed (3 ok, 2 fixed, 0 needs human); 0 remaining issues — $X.XX`.
9. **Relance à 0 $.** `report.json` mémorise le hash de l'arbre de chaque page relue. Au run suivant, une page relue dont le hash est inchangé est recontrôlée et recapturée mais **pas relue** (`reused`), quel que soit son verdict — `ok`, `fixed` ou `needs_human` — le verdict et les défauts du run précédent sont repris tels quels. Supprimer `qa/report.json` force la relecture de toutes les pages.
10. **Échecs.** Une page dont l'agent échoue n'arrête pas les autres ; l'étape échoue à la fin avec la liste, comme `pages`. « Cost budget reached » est relancé tel quel. Le navigateur est toujours fermé (`finally`).
11. **Différé.** Soumission réelle des formulaires (les `notifications` partiraient dans le vide sans SMTP) ; contrôle d'accessibilité (axe) ; comparaison visuelle automatique entre tours ; Lighthouse.

### `export`

12. **Déterministe, 0 $, `dist/` réécrit à chaque run** (contenu précédent supprimé d'abord). Aucune modification de la base ni de `wp-content` du site.
13. **`dist/db.sql`.** `wp search-replace http://localhost:<port> https://SITE_URL_PLACEHOLDER --all-tables-with-prefix --export` capturé sur stdout, puis une passe Node remplace la forme JSON échappée `http:\/\/localhost:<port>` par `https:\/\/SITE_URL_PLACEHOLDER`. Faktory exige ensuite `SITE_URL_PLACEHOLDER` présent et **zéro** occurrence de `localhost:<port>`. Les GUID sont remplacés comme le reste (site jamais publié).
14. **`dist/wp-content.tar.gz`.** Archive de `sites/<slug>/wp-content` par `tar` (bsdtar de macOS ; `-C <siteDir> wp-content`), racine `wp-content/` ; exclusions : `wp-content/upgrade`, `wp-content/debug.log`, `wp-content/themes/twenty*`. Vérification par `tar -tzf` : `wp-content/themes/generatepress/style.css`, `wp-content/themes/faktory-<slug>/style.css`, `wp-content/plugins/generateblocks/`, `wp-content/plugins/faktory-<kebab>/` pour chaque `plugins/*.json`.
15. **`dist/docker-compose.prod.yml` + `dist/.env.example`.** Services `db` (mariadb:11, mot de passe depuis `.env`), `wordpress` (wordpress:php8.3-apache, `./wp-content:/var/www/html/wp-content`, `${SITE_PORT}:80`, `WORDPRESS_CONFIG_EXTRA` avec `FS_METHOD direct` et **sans** `WP_DEBUG`), `wpcli` (wordpress:cli-php8.3, même montage, `sleep infinity`). Variables : `SITE_PORT=8080`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`.
16. **`dist/README.md`** (français, pour l'exploitation Partikuls) : contenu du livrable ; restauration pas à pas — `cp .env.example .env`, `tar -xzf wp-content.tar.gz`, `docker compose -f docker-compose.prod.yml up -d --wait`, `docker compose … exec -T wpcli wp db import - < db.sql`, les **deux** `search-replace` (`https://SITE_URL_PLACEHOLDER` → URL réelle, puis la forme échappée), `wp yoast index --reindex`, `wp rewrite flush`, `wp user update admin --user_pass=…` (ou création d'un nouvel admin et suppression de `admin`), contrôle des pages ; après restauration — SMTP requis pour les notifications Gravity Forms, clés de licence GP Premium / GB Pro / Gravity Forms pour les mises à jour, ajout du site dans WP Umbrella ; ce que contient `MANIFEST.json`.
17. **`dist/MANIFEST.json`** : `slug`, `name` (identité), `generatedAt`, `faktoryVersion` (`package.json`), `wordpress` (`wp core version`), `theme` (`generatepress` version, `child` slug), `plugins` (`wp plugin list --fields=name,version,status`), `pages` (slug, titre, kind, URL relative), `customPlugins` (`plugins/*.json` : feature, plugin, postType, block), `forms` (`content/forms.json` : id, nom, gfId), `articles` (slugs), `qa` (depuis `qa/report.json` s'il existe : URLs contrôlées, pages relues, défauts restants ; sinon `null`), `costUsd` (cumul `faktory.json`), `files` (nom → taille en octets).
18. **CLI.** `faktory export <slug>` = alias de `run --only export` (comme `provision`). Message d'étape : `dist/: db.sql (2.1 MB), wp-content.tar.gz (31 MB), docker-compose.prod.yml, .env.example, README.md, MANIFEST.json`.
19. **Différé.** Déploiement sur serveur, `wp-content/uploads` volumineux (pas de découpage), export incrémental, chiffrement du livrable.

## Contrôle d'une page `qa/<slug>.check.json`

```json
{
  "url": "http://localhost:8101/contact/",
  "status": 200,
  "consoleErrors": [],
  "pageErrors": [],
  "failedRequests": [],
  "brokenLinks": [],
  "brokenImages": [],
  "missingAlt": 0,
  "unstyledBlocks": [],
  "h1Count": 1,
  "mobileOverflow": false,
  "checkedAt": "2026-09-13T15:25:27.000Z"
}
```

Schéma zod `src/schemas/qa.ts` (`PageCheckSchema`, `checkIssues(check): string[]` — une ligne lisible par défaut, vide quand tout va bien ; `hasHardFailure(check)` = statut ≠ 200). `failedRequests[i]` = `{ url, status }` (`status` 0 en échec réseau) ; `brokenLinks[i]` = `{ href, status }`.

## Verdict de l'agent et rapport `qa/report.json`

```json
{
  "generatedAt": "…", "siteUrl": "http://localhost:8101", "costUsd": 4.12,
  "totals": { "urls": 11, "reviewed": 5, "ok": 3, "fixed": 2, "needsHuman": 0, "remainingIssues": 0 },
  "pages": [
    {
      "slug": "accueil", "kind": "home", "url": "http://localhost:8101/", "status": 200,
      "check": { "…": "le dernier contrôle" },
      "screenshots": { "desktop": "qa/accueil.desktop.png", "mobile": "qa/accueil.mobile.png" },
      "reviewed": true, "reused": false, "treeHash": "sha256:…", "rounds": 1,
      "verdict": "fixed", "summary": "…",
      "issues": [ { "severity": "minor", "where": "section cta", "what": "bouton sans focus-visible", "action": "fixed" } ],
      "costUsd": 0.81
    },
    { "slug": "actualites", "kind": "blog", "url": "…", "status": 200, "check": { }, "screenshots": { }, "reviewed": false, "rounds": 0, "issues": [], "costUsd": 0 },
    { "slug": "la-galette-des-rois-…", "kind": "article", "url": "…", "status": 200, "check": { }, "screenshots": { }, "reviewed": false, "rounds": 0, "issues": [], "costUsd": 0 }
  ]
}
```

Schémas zod `src/schemas/qa.ts` : `QaVerdictShape` (sortie de l'agent, pour `toJsonSchema`), `validateVerdict(verdict, treeChanged)`, `QaReportSchema`, `parseQaReport`, `QA_DIR = "qa"`, `QA_REPORT_JSON = "qa/report.json"`, `QA_REPORT_MD = "qa/QA-REPORT.md"`, `checkRel/checkPath(slug)`, `screenshotRel(slug, viewport, tile?)`, `treeHash(ctx, slug)`.

`QA-REPORT.md` (`renderQaReport(report)`, `src/qa/report.ts`) : titre `# Rapport QA — <name>`, date, synthèse (`totals` en une phrase + coût), puis une section par URL dans l'ordre sitemap puis articles : `## /contact/ — ok` (verdict ou « contrôle seul »), tableau `| Contrôle | Résultat |` (statut, erreurs console, requêtes en échec, liens cassés, images cassées, `alt` manquants, blocs sans CSS, `h1`, débordement mobile), `Tours : n`, liste des défauts (`- [corrigé|restant] (majeur|mineur) section hero — …`), `Captures : [desktop](accueil.desktop.png) · [mobile](accueil.mobile.png)` (chemins relatifs à `qa/`).

## Prompt `src/prompts/qa.md`

Même forme que `pages.md` : rôle (relecteur QA de Partikuls : l'œil du designer et de l'intégrateur, pas un rédacteur), entrées (les captures listées dans le prompt — page entière puis tuiles, desktop puis mobile — à lire avec `Read` ; `design-system.md` ; `pages/<slug>.gb.json`), ce qu'il cherche (hiérarchie et lisibilité, respect du design system — couleurs, espacements, typographies —, cohérence avec les sections de la spec, responsive : empilement, débordements, tailles de titres, boutons et liens lisibles et cliquables, images et `alt`, défauts automatiques du contrôle qui relèvent de l'arbre), ce qu'il ne fait pas (réécrire la copy, ajouter des sections, changer les marqueurs / enveloppes `data-faktory-*`, introduire des couleurs hex, toucher à autre chose que `pages/<slug>.gb.json`), comment il corrige (modifier l'arbre avec `Write`, vérifier avec `gb_build` — deux allers-retours au plus — ; Faktory republie et recontrôle ; ne corriger que ce qui est visible et sûr), la sortie (le JSON structuré demandé, verdict cohérent avec les actions ; `needs_human` pour ce qu'il ne peut pas corriger dans l'arbre : contenu manquant dans la spec, rendu d'un plugin ou d'un formulaire, thème). Deuxième tour (`resume`) : « l'arbre a été republié, nouvelles captures aux mêmes chemins, défauts automatiques restants : … ; relis et conclus ».

## `dist/` — fichiers produits

| Fichier | Contenu |
|---|---|
| `db.sql` | Dump complet, URL locale remplacée par `https://SITE_URL_PLACEHOLDER` (formes brute et JSON-échappée) |
| `wp-content.tar.gz` | `wp-content/` : `plugins`, `themes` (sans `twenty*`), `uploads`, `languages`, `mu-plugins` si présent, `index.php` |
| `docker-compose.prod.yml` | `db`, `wordpress`, `wpcli` ; variables de `.env` |
| `.env.example` | `SITE_PORT`, `DB_PASSWORD`, `DB_ROOT_PASSWORD` |
| `README.md` | Restauration, post-restauration, contenu |
| `MANIFEST.json` | Versions, pages, plugins, formulaires, articles, QA, coût, tailles |

## Fichiers

| Fichier | Responsabilité |
|---|---|
| `package.json` (modifier) | dépendance `playwright`, script `setup-playwright` |
| `src/schemas/qa.ts` | `PageCheckSchema`, `checkIssues`, `hasHardFailure`, `QaVerdictShape`, `validateVerdict`, `QaReportSchema`, `parseQaReport`, constantes et chemins `qa/`, `treeHash` |
| `src/qa/browser.ts` | `launchBrowser(config)`, `checkPage(browser, url, opts)` (contrôle + captures, cache des liens), `closeBrowser` ; script in-page dans `src/qa/inpage.ts` (pur, testable sans navigateur : `IN_PAGE_SCRIPT`, `summarize`) |
| `src/qa/review.ts` | `qaUserPrompt(spec, page, check, screenshots)`, `qaResumePrompt(check)`, `reviewPage(ctx, spec, page, …)` : agent + validation + restauration d'un arbre invalide |
| `src/qa/report.ts` | `renderQaReport(report)` → markdown, `writeQaReport(ctx, report)` |
| `src/pages/publish.ts` (modifier) | `republishPage(ctx, spec, page, id, tree)` extrait de `stages/pages.ts` |
| `src/stages/pages.ts` (modifier) | utilise `republishPage` |
| `src/stages/qa.ts`, `src/pipeline.ts` (modifier) | `qaStage` : navigateur → URLs → contrôles → relectures (concurrence 3, ≤ 2 tours) → contrôle final → rapports ; `registry.qa` |
| `src/prompts/qa.md`, `src/prompts.ts` (modifier) | Prompt système ; `PromptName` + `"qa"` |
| `src/cli.ts` (modifier) | `doctor` : Chromium Playwright ; commande `export <slug>` |
| `src/export/db.ts` | `exportDb(ctx)` : search-replace `--export`, passe échappée, assertions |
| `src/export/bundle.ts` | `bundleWpContent(ctx, out)` (tar + vérification `tar -tzf`), `TAR_EXCLUDES`, `requiredTarEntries(ctx, manifests)` |
| `src/export/templates.ts` | `prodCompose()`, `envExample()`, `restoreReadme(ctx, spec, manifest)` |
| `src/export/manifest.ts` | `buildManifest(ctx, spec, …)` |
| `src/stages/export.ts`, `src/pipeline.ts` (modifier) | `exportStage` ; `registry.export` |
| `fixtures/qa/contact.check.json`, `fixtures/qa/report.json` | Contrôle et rapport valides pour les tests |
| `tests/unit/qa-schema.test.ts`, `qa-inpage.test.ts`, `qa-review.test.ts`, `qa-report.test.ts`, `stage-qa.test.ts`, `publish-republish.test.ts` ; `stage-pages.test.ts`, `pipeline.test.ts`, `prompts.test.ts`, `cli.test.ts` (modifier) | Unitaires 6a |
| `tests/unit/export-db.test.ts`, `export-bundle.test.ts`, `export-templates.test.ts`, `export-manifest.test.ts`, `stage-export.test.ts` | Unitaires 6b |
| `tests/integration/qa.test.ts` | Docker, port **8197** : provision + pages stub + `qa` avec Playwright réel et `reviewPage` mocké (renvoie un arbre corrigé au tour 1) → contrôles écrits, captures présentes, page republiée, rapport cohérent, relance à 0 $ |
| `tests/integration/export.test.ts` | Docker, port **8198** : `export` sur un site provisionné avec pages stub, puis restauration de `dist/` dans un Compose neuf (`docker-compose.prod.yml` exporté, projet `faktory-itrestore`) → page d'accueil 200 avec le nom du site et du CSS GenerateBlocks, formulaire rendu sur `/contact/` |
| `README.md`, ce document | Documentation, coût mesuré, écarts constatés |

## Vérification de bout en bout

```bash
npm install && npm run setup-playwright && npm run faktory -- doctor
npm run typecheck && npm test
FAKTORY_DOCKER=1 npx vitest run tests/integration/qa.test.ts --testTimeout=600000 --hookTimeout=600000
FAKTORY_DOCKER=1 npx vitest run tests/integration/export.test.ts --testTimeout=600000 --hookTimeout=600000
npm run faktory -- run boulangerie --only qa       # ≈ $3–7 : 5 relectures Opus avec captures
open sites/boulangerie/qa/QA-REPORT.md
npm run faktory -- export boulangerie             # $0
ls -la sites/boulangerie/dist/
# restauration manuelle selon dist/README.md sur un port libre, contrôle visuel, puis compose down -v
```

## Écarts constatés à l'exécution — qa (2026-09-13)

Exécution réelle de `qa` sur `boulangerie` (`http://localhost:8101`, conteneurs déjà debout), après un re-run de `content` ($0, republie les 5 articles avec l'auteur admin — cf. « Panne connue (c) » ci-dessous).

**Coût et tours mesurés.** Premier run : **$6.04 pour 5 pages relues**, ≈ $1,21/page, 11 URLs contrôlées (0 $ pour les 6 non relues : 5 articles + `/actualites/`). 3 pages sur 5 ont eu un second tour (`accueil` $2,00 sur 2 tours, `la-maison` $1,58 sur 2 tours, `contact` $1,20 sur 2 tours), 2 pages se sont arrêtées au premier tour (`nos-produits` $0,54, `commandes-evenements` $0,72). Coût cumulé du site après ce run : $28,13. Un second run complet, lancé pour vérifier la réutilisation, a coûté **$2,41 de plus** (5 pages relues à nouveau, 1 tour chacune) au lieu de $0 — voir « Écart sur la réutilisation » plus bas. Coût cumulé après les deux runs : $30,54, contre un plafond `maxCostUsd` de 40.

**Écart sur la réutilisation.** La conception prévoit qu'une page dont l'arbre est inchangé et dont le dernier verdict était `ok` n'est pas relue (`src/stages/qa.ts`, `prev?.reviewed && prev.verdict === "ok" && prev.treeHash === hash`). Sur ce run réel, les 5 pages relues se sont **toutes** terminées `needs_human` après leur dernier tour (0 `ok`, 0 `fixed`) : aucune ne remplissait la condition de réutilisation, donc le second run a relu les 5 pages intégralement au lieu de les réutiliser à 0 $. Ce n'est pas un bug — la règle « réutiliser seulement si `ok` » est correcte et documentée — mais c'est un écart par rapport à l'hypothèse de ce document (et du plan de test) selon laquelle un run réel produirait au moins quelques verdicts `ok` réutilisables : sur un site à ce stade du brief (photos placeholder, horaires à confirmer, police de titre globale non appliquée, formulaires stylés par le plugin Gravity Forms hors palette), le jugement de l'agent classe tout en `needs_human` car il reste toujours au moins un défaut légitimement laissé de côté (« left »). La réutilisation à 0 $ ne s'observera en pratique qu'une fois ces défauts hors-arbre corrigés ailleurs (thème, contenu réel) ou sur un site déjà propre.

**Retries de validation du verdict.** Le garde-fou `validateVerdict`/`assertVerdict` (`src/schemas/qa.ts`) — qui rejette par exemple un verdict `fixed` sans arbre modifié, ou un verdict autre que `fixed` alors que l'arbre a changé — s'est déclenché **3 fois** sur les 5 relectures du premier run (`qa verdict is inconsistent`, log `↻ qa: output failed validation, retrying once`), et la reprise automatique (`src/agent.ts`) a chaque fois produit un verdict cohérent dès le second essai. C'est le mécanisme prévu qui fonctionne comme conçu, mais la fréquence (3/5 relectures) sur un run réel confirme que Opus produit assez souvent un verdict formellement incohérent avec ses propres actions au premier essai ; le garde-fou n'est donc pas un filet de sécurité théorique, il a été utile ici.

**Bugs connus des vérifications automatiques.**
- (a) Les lignes « Failed to load resource » que Chromium écrit lui-même dans la console ne sont écartées de `consoleErrors` que pour les ressources de même origine — elles restent comptées dans `failedRequests`. Sur ce run, aucune ressource (y compris les images placeholder externes `placehold.co`) n'a échoué, donc l'écart n'a pas pu être observé directement ; il reste à vérifier sur un site avec une ressource externe qui échoue réellement.
- (b) La page de liste du blog (`kind: "blog"`) n'a pas de `h1` sous le template natif « articles » de GeneratePress : son contrôle rapporte systématiquement « 0 h1 (attendu : 1) », confirmé ici sur `/actualites/` aux deux runs. Cette page n'a pas de `pages/<slug>.gb.json`, donc elle n'est jamais relue par l'agent — le défaut reste seul dans le rapport, sans tour de correction possible.
- (c) Le run d'intégration précédent (tâche 8) avait révélé que les articles étaient publiés sans auteur (lien de byline `/author/` cassé, 404). Corrigé dans le stage `content` au cours de cette phase (commit `1224ca8`) : les articles récupèrent l'utilisateur admin comme auteur. Le re-run de `content` effectué avant ce `qa` (0 $, 5 articles republiés) confirme la correction — aucun des 5 articles relus par `qa` n'a de lien d'auteur cassé dans son rapport.
- (d) Le coût par page vient du coût déclaré par l'agent SDK pour l'exécution de la relecture elle-même, pas d'un delta de coût d'état avant/après — les relectures tournent avec une concurrence de 3, donc un delta global ne pourrait pas être réparti proprement par page.
- (e) Le test d'intégration `tests/integration/qa.test.ts` prend environ 7 minutes (392–412 s mesurées), dominé par le lancement de Chromium et les contrôles/captures sur 11 URLs plutôt que par l'agent (mocké dans ce test).

**Pertinence des corrections de l'agent.** Sur les 3 pages où l'agent a répondu `fixed` au premier tour (`accueil`, `la-maison`, `contact`), les corrections observées dans les captures d'écran (`qa/accueil.desktop.png`, `qa/la-maison.mobile.png`, `qa/contact.desktop.png`) correspondent bien à ce que le rapport annonce : les séparateurs de la liste « Horaires » sont redevenus des filets droits (le rayon de 12 px en trop a disparu) sur `accueil` et `contact`, et sur `la-maison` la galerie « L'équipe » est repassée sur 2 colonnes en mobile et le texte de la section « Le levain » précède maintenant l'image (l'ordre CSS erroné a été corrigé). Aucune régression visuelle n'a été repérée. Dans les deux cas, le verdict final (après le tour suivant) est redevenu `needs_human` car il restait des défauts légitimement hors de portée de l'arbre (police de titre globale, pied de page « (test) », photos placeholder, style du formulaire Gravity Forms) — l'agent les a correctement laissés en `left` plutôt que de tenter un correctif hasardeux hors de `pages/<slug>.gb.json`.

**Le prompt n'a pas eu besoin d'être resserré.** Les verdicts sont restés disciplinés run après run : mêmes catégories de défauts « left » (photos placeholder, contenu à confirmer, styles de thème/plugin hors arbre), pas de tentative de corriger ce qui est hors de `pages/<slug>.gb.json`, et les 3 retries de validation se sont résolus seuls. Le seul point à surveiller pour une itération future du prompt : sur un site déjà propre en dehors de l'arbre (thème et plugin corrigés), il faudra revérifier qu'un verdict `ok` franc reste atteignable — ce run n'a pas pu l'exercer puisque `boulangerie` a encore, à ce stade du brief, des défauts hors-arbre non résolus sur toutes les pages.

**Correction de la règle de réutilisation (tâche 9b).** La règle « réutiliser seulement si `ok` » ci-dessus (décision 9 d'origine) a été remplacée après ce run réel : les 5/5 pages `needs_human` du premier run ont fait échouer la réutilisation au second run ($2,41 au lieu de $0 — voir « Écart sur la réutilisation » ci-dessus). La règle est maintenant : une page relue dont le hash de l'arbre est inchangé est réutilisée quel que soit son verdict. Un troisième run sur `boulangerie` a confirmé la correction : les 5 pages relues ont été réutilisées (`5 reused`) pour $0,00.
