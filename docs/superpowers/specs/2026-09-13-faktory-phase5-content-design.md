# Faktory — Phase 5 : étape `content`

Addendum au design `2026-09-12-faktory-design.md` (section « 6. content »). Approuvé en discussion le 2026-09-13. Là où ce document précise ou contredit le design initial ou les plans des phases 3 et 4, c'est ce document qui fait foi.

## Objectif

`faktory run <slug>` livre, après `pages`, tout ce qui reste hors mise en page : les formulaires Gravity Forms créés depuis la spec et insérés dans les pages à la place des cartes « bientôt disponible », les meta Yoast (titre, description, mot-clé) de chaque page du sitemap, et les articles de blog de la spec, rédigés par un agent, publiés avec catégorie, extrait, image à la une et meta Yoast. Critère d'acceptation (design initial, « Ordre de construction » 5) : formulaire contact rendu sur sa page, meta SEO présentes, articles listés.

Vérifié sur le site boulangerie avant rédaction : Gravity Forms 3.1, son add-on CLI (`wp gf form create --form-json … --porcelain`, notifications acceptées dans le JSON) et Yoast 28 sont actifs dès `provision` ; les meta `_yoast_wpseo_title` / `_yoast_wpseo_metadesc` sont prises en compte immédiatement dans le `<title>` et la `<meta name="description">` sans réindexation ; le bloc `<!-- wp:gravityforms/form {"formId":"N"} /-->` et le shortcode `[gravityform id="N"]` rendent tous deux `gform_wrapper_N` sur la page publiée.

## Décisions

1. **Une étape, trois sous-étapes dans cet ordre : `forms` → `seo` → `articles`, sans checkpoint.** Les deux premières sont déterministes ($0, aucun appel LLM) ; seule la troisième lance des agents. Une sous-étape qui échoue arrête l'étape (message explicite, statut `failed`) ; les sous-étapes déjà faites sont idempotentes et se réexécutent sans coût au `run` suivant.
2. **Formulaires construits par Faktory, pas par un agent.** `buildGfForm(spec, form)` transforme `spec.forms[i]` en JSON Gravity Forms (voir « Formulaire Gravity Forms »), `wp gf form create <nom> --form-json=<json> --porcelain` le crée, la notification admin est incluse dans le JSON, la confirmation est celle que Gravity Forms génère par défaut (message français). Le résultat est consigné dans `content/forms.json` (voir « Manifeste des formulaires »). Réutilisation, dans cet ordre : entrée présente dans le manifeste **et** `wp gf form get <gfId>` réussit → rien à créer ; sinon un formulaire actif de même titre dans `wp gf form form_list --format=json` est repris ; sinon création. Un formulaire n'est jamais supprimé par Faktory.
3. **Insertion par substitution à la compilation, comme les plugins (phase 4, décision 1).** `applyPlugins` est généralisé en `applyPlacements(tree, placements, pageSlug)` : un placement est `{ attr, id, markup }` et remplace en mémoire la première enveloppe `attr="<id>"` par `{ "type": "raw", "rawMarkup": markup }`. Les enveloppes `data-faktory-feature` (manifestes `plugins/*.json`) et `data-faktory-form` (`content/forms.json`) passent par la même fonction. L'étape `content`, après avoir créé les formulaires, recompile et republie chaque arbre `pages/<slug>.gb.json` existant qui porte une enveloppe de formulaire, puis `GET` la page et exige `gform_wrapper_<gfId>`. L'étape `pages` applique aussi `content/forms.json` s'il existe et fait la même vérification : les deux ordres fonctionnent, régénérer une page ne perd jamais son formulaire. Une enveloppe sans placement reste telle quelle (carte « bientôt disponible » visible). Le placement est le **bloc** Gravity Forms (éditable dans Gutenberg), pas le shortcode : `<!-- wp:gravityforms/form {"formId":"<gfId>","title":false,"description":false} /-->`.
4. **SEO des pages : déterministe, depuis `page.seo`.** Pour chaque page du sitemap (page blog comprise) : `_yoast_wpseo_title` = `seo.title`, `_yoast_wpseo_metadesc` = `seo.metaDescription`, `_yoast_wpseo_focuskw` = `seo.keywords[0]`, via `wp post meta update`. Vérification : `GET` de chaque page, le `<title>` (entités HTML décodées) doit être égal à `seo.title`. Aucun réglage Yoast global (séparateur, organisation, réseaux sociaux) : différé.
5. **Un agent par article, en parallèle (concurrence 3, comme `pages`), sortie structurée.** Chaque `spec.blog.articles[i]` donne un `query()` avec `outputFormat` = schéma JSON de `Article` (zod → `toJsonSchema`), outils `Read` uniquement (pour `brief.md`, `SITE-SPEC.md`, `design-system.md`), `maxTurns` 8, `writeRoots: ["content"]` par précaution (l'agent n'écrit rien : Faktory enregistre lui-même la sortie validée dans `content/articles/<slug>.json`). Validation par `runValidated` (une relance dans la même session) : schéma zod, catégorie parmi `spec.blog.categories`, 500 à 1 200 mots, au moins deux intertitres, premier bloc = paragraphe, HTML en ligne limité à `<strong>`, `<em>`, `<a href="…">` (href relatif au site ou `https://`), liste noire de la phase 3 (`<script`, `<iframe`, `javascript:`, `on*=`), aucune occurrence de `[à confirmer]`. Le modèle est `config.models.content ?? config.models.default` (Opus par défaut, pas d'override posé dans `faktory.config.json`).
6. **Faktory sérialise et publie.** `serializeArticle(article)` produit du markup de blocs Gutenberg cœur (heading, paragraph, list/list-item, quote) ; la publication est idempotente par `post_name` = `slugify(article.title)` (accents retirés, kebab-case, 60 caractères max) : `wp post create` si absent, `wp post update` sinon, avec titre, extrait, catégorie (terme créé au besoin depuis `spec.blog.categories`), statut `publish`, image à la une importée depuis `https://placehold.co/1200x800.png` (`wp media import --porcelain`, `alt` = titre ; import déjà fait si `_thumbnail_id` existe ; échec d'import = avertissement, pas d'erreur), meta Yoast titre / description / mot-clé. Vérification : `GET http://localhost:<port>/<slug>/` doit répondre 200 avec le `<title>` attendu, puis `GET` de la page blog (`kind: "blog"`) doit contenir chaque titre d'article.
7. **Réutilisation des articles.** `content/articles/<slug>.json` présent → aucun appel LLM : le fichier est relu, revalidé (mêmes règles) et republié. Un article toujours invalide après la relance voit son fichier supprimé (convention pages/plugins) ; supprimer le fichier régénère l'article. Le slug est calculé par Faktory depuis `spec.blog.articles[i].title` (jamais par l'agent), donc stable entre deux runs tant que la spec ne change pas.
8. **Échecs.** Un article qui échoue n'arrête pas les autres ; l'étape échoue à la fin avec la liste des slugs à corriger ou supprimer, comme `pages`. L'erreur « Cost budget reached » est relancée telle quelle. Le budget est vérifié avant chaque agent (`assertBudget`).
9. **Différé.** Test de soumission réel des formulaires (Playwright, étape `qa`) ; envoi effectif des e-mails (pas de SMTP dans le conteneur ; à documenter dans le README d'export) ; réglages Yoast globaux ; mise en page de la page blog (thème GeneratePress par défaut, contrôlée en `qa`) ; répartition du budget par agent concurrent (toujours différée).

## Formulaire Gravity Forms

`buildGfForm(spec, form)` → objet passé tel quel dans `--form-json` :

| Clé | Valeur |
|---|---|
| `title` | `form.name` |
| `description` | `""` |
| `labelPlacement` / `requiredIndicator` | `top_label` / `text` |
| `button` | `{ "type": "text", "text": "Envoyer" }` |
| `fields[i]` | `{ id: i+1, type, label: field.label, adminLabel: field.key, isRequired: field.required }` + spécifiques par type |
| `notifications` | `{ "faktory_admin": { id: "faktory_admin", name: "Notification admin", event: "form_submission", to: form.recipient, toType: "email", from: "{admin_email}", fromName: identity.name, subject: "[<identity.name>] <form.name>", message: "{all_fields}", isActive: true } }` |

Types de champs (`FORM_FIELD_TYPES` de la spec → Gravity Forms) : `text` → `text` ; `email` → `email` ; `phone` → `phone` + `phoneFormat: "international"` ; `date` → `date` + `dateType: "datepicker"`, `dateFormat: "dmy"` ; `number` → `number` + `numberFormat: "decimal_dot"` ; `textarea` → `textarea` ; `select` → `select` + `choices: options.map(o => ({ text: o, value: o }))` — un `select` sans `options` est une erreur de spec signalée avant tout appel `wp`.

## Manifeste des formulaires `content/forms.json`

```json
{
  "contact": { "gfId": 1, "placement": "<!-- wp:gravityforms/form {\"formId\":\"1\",\"title\":false,\"description\":false} /-->" },
  "devis_evenement": { "gfId": 2, "placement": "<!-- wp:gravityforms/form {\"formId\":\"2\",\"title\":false,\"description\":false} /-->" }
}
```

Schéma zod `src/schemas/forms-manifest.ts` : clés = identifiants snake_case de formulaires, `gfId` entier positif, `placement` = chaîne non vide passant la liste noire et de la forme `<!-- wp:gravityforms/form {…} /-->` avec `"formId":"<gfId>"`. Relu et revalidé à chaque exécution (`readFormsManifest`), comme `readPluginManifests`. Pages concernées par un formulaire `<id>` : celles dont une section `form` ou `contact` porte `form: "<id>"` (`formPages(spec, id)`) ; chaque page en porte au plus une enveloppe (règle du prompt `pages`), `applyPlacements` remplace la première trouvée.

## Article `content/articles/<slug>.json`

```json
{
  "title": "La galette des rois revient : frangipane ou pomme ?",
  "excerpt": "Deux galettes cette année au fournil : la frangipane classique et une version aux pommes du verger. Ce qui change, et comment réserver.",
  "category": "Saison",
  "seo": { "title": "Galette des rois à Nantes : frangipane ou pomme ? | Maison Rivet", "metaDescription": "…" },
  "blocks": [
    { "type": "paragraph", "text": "Chaque janvier, …" },
    { "type": "heading", "level": 2, "text": "Deux recettes, un seul feuilletage" },
    { "type": "paragraph", "text": "… <strong>levain</strong> … <a href=\"/nos-produits/\">nos produits</a>." },
    { "type": "list", "ordered": false, "items": ["…", "…"] },
    { "type": "quote", "text": "…", "cite": "Marc, boulanger" }
  ]
}
```

Schéma zod `src/schemas/article.ts` (`ArticleShape(categories)` pour l'`outputFormat`, `parseArticle`, `validateArticle(article, spec)` pour les règles ci-dessus, `articleSlug(title)`, `countWords`) : `title` ≤ 90, `excerpt` 40–200 caractères, `category` ∈ `spec.blog.categories`, `seo.title` ≤ 70, `seo.metaDescription` 50–160, `blocks` : `heading` (`level` 2 ou 3, `text`), `paragraph` (`text`), `list` (`ordered`, `items` ≥ 2), `quote` (`text`, `cite` optionnel). Sérialisation (`src/content/serialize.ts`) : `<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">…</h2><!-- /wp:heading -->`, `<!-- wp:paragraph --><p>…</p><!-- /wp:paragraph -->`, `<!-- wp:list {"ordered":true} --><ol class="wp-block-list"><!-- wp:list-item --><li>…</li><!-- /wp:list-item -->…</ol><!-- /wp:list -->` (attribut `ordered` omis pour `<ul>`), `<!-- wp:quote --><blockquote class="wp-block-quote"><!-- wp:paragraph --><p>…</p><!-- /wp:paragraph --><cite>…</cite></blockquote><!-- /wp:quote -->`. Le texte est inséré tel quel (HTML en ligne déjà validé), `cite` et les `items` aussi.

## Prompt `src/prompts/content.md`

Même forme que `pages.md` : rôle (rédacteur web de Partikuls, français, factuel, ton de la spec), entrées à lire avec `Read` (`brief.md` pour les faits, `SITE-SPEC.md` pour l'identité, les pages et les autres articles, `design-system.md` pour la voix), sortie (l'objet JSON structuré demandé, rien d'autre ; Faktory l'enregistre, le sérialise et le publie), règles : 700 à 900 mots visés (bornes 500–1 200), un paragraphe d'accroche avant le premier intertitre, 3 à 5 intertitres `h2` (des `h3` si besoin), listes et citation quand elles servent, aucun fait inventé (prix, adresse, horaires, noms : uniquement ceux du brief ; jamais `[à confirmer]` dans le texte), un à trois liens internes vers des pages du site (`/slug/`), pas de lien externe hors `https://`, mots-clés placés naturellement (titre, un intertitre, premier paragraphe, meta), `excerpt` et `seo` cohérents avec l'article, HTML en ligne limité à `<strong>`, `<em>`, `<a>`. Le prompt utilisateur `articleUserPrompt(spec, article, slug)` donne : le titre imposé (à garder tel quel ou à raffiner sans changer le sujet), la catégorie attendue (= `article.theme` quand c'est une catégorie de la spec, sinon la première catégorie), les mots-clés, l'identité (nom, secteur, lieu, accroche, ton), les pages du site avec leur URL et les titres des autres articles (pour éviter les redites).

## Fichiers

| Fichier | Responsabilité |
|---|---|
| `src/schemas/forms-manifest.ts` | Schéma du manifeste, `parseFormsManifest`, `validateFormsManifest`, `formPages(spec, id)`, `gfPlacement(gfId)`, `FORMS_MANIFEST_REL`, `formsManifestPath` |
| `src/schemas/article.ts` | `ArticleShape(categories)`, `parseArticle`, `validateArticle`, `articleSlug`, `countWords`, `ARTICLES_DIR`, `articlePath/Rel` |
| `src/pages/placements.ts` (remplace `apply-plugins.ts`) | `applyPlacements(tree, placements, pageSlug)`, `pluginPlacements(manifests)`, `formPlacements(manifest)`, `readPluginManifests(ctx)` (déplacé), `readFormsManifest(ctx)` |
| `src/pages/render-check.ts` (modifier) | `assertContains(ctx, url, needle, hint)` générique ; `assertRendered` (plugins) et le contrôle `gform_wrapper_<N>` l'utilisent |
| `src/content/forms.ts` | `buildGfForm(spec, form)`, `ensureForms(ctx, spec)` (réutilisation, création, manifeste), `integrateForms(ctx, spec, manifest, ids)` (arbres existants → apply → compile → publish → contrôle HTTP) |
| `src/content/seo.ts` | `applyPageSeo(ctx, spec, ids)` + vérification `<title>`, `decodeEntities` |
| `src/content/articles.ts` | `articleUserPrompt`, `readArticle(ctx, spec, slug)`, `generateArticle(ctx, spec, article)` (`runValidated`, écriture du JSON), `publishArticle(ctx, spec, slug, article)` (catégorie, post, image, Yoast), `ensureCategories(ctx, spec)` |
| `src/content/serialize.ts` | `serializeArticle(article)` → markup de blocs |
| `src/stages/content.ts` | `contentStage` : forms → seo → articles (concurrence 3), résumé avec coût |
| `src/stages/pages.ts` (modifier) | applique aussi `content/forms.json` et vérifie `gform_wrapper_<N>` |
| `src/prompts/content.md`, `src/prompts.ts` (modifier) | Prompt système ; `PromptName` + `"content"` |
| `src/pipeline.ts` (modifier) | `registry.content` |
| `src/artifacts.ts` (modifier) | `CONTENT_DIR = "content"` |
| `fixtures/content/forms.json`, `fixtures/content/galette-des-rois.article.json` | Manifeste et article valides pour la spec fixture (catégorie `Saison`) |
| `tests/unit/forms-manifest.test.ts`, `article.test.ts`, `placements.test.ts` (remplace `apply-plugins.test.ts`), `content-forms.test.ts`, `content-seo.test.ts`, `content-articles.test.ts`, `serialize.test.ts`, `stage-content.test.ts` ; `stage-pages.test.ts` (modifier) | Unitaires |
| `tests/integration/content.test.ts` | Docker, port **8196** : provision + pages stub + `content` réel avec `generateArticle` mocké sur la fixture → formulaires créés et rendus, meta Yoast lues via `wp post meta get` et `<title>`, article publié et listé sur la page blog |
| `README.md`, ce document | Documentation, écarts constatés |

## Vérification de bout en bout

```bash
npm run typecheck && npm test
FAKTORY_DOCKER=1 npx vitest run tests/integration/content.test.ts --testTimeout=600000 --hookTimeout=600000
npm run faktory -- run boulangerie --only content
# attendu : 2 formulaires (contact, devis_evenement) créés et rendus sur /contact/ et /commandes-evenements/,
#           meta Yoast sur 6 pages, 5 articles publiés ; coût mesuré à reporter dans README.md
open http://localhost:8101/contact/ http://localhost:8101/actualites/
```

## Écarts constatés à l'exécution (2026-09-13)

- Articles empoisonnés : Faktory n'écrit `content/articles/<slug>.json` qu'après validation, donc rien n'est jamais supprimé automatiquement ; un fichier édité à la main et invalide fait échouer l'article avec un message « fix or delete it », et l'étape liste les slugs à corriger.
- Page blog : la vérification cherche le lien de chaque article (`href="http://localhost:<port>/<slug>/"`) plutôt que son titre, que WordPress réécrit (apostrophes typographiques, entités).
- Yoast échappe les apostrophes dans `<meta name="description">` (`&#039;`) : les contrôles de titre et de description décodent les entités HTML (`decodeEntities`) avant comparaison.
- `assertRendered` (plugins) et `assertFormRendered` (formulaires) partagent un helper privé de page ; `assertContains` / `assertTitle` travaillent sur une URL.
- `inlineHtmlIssues` : la liste noire (`<script`, `<iframe`, `javascript:`, `on*=`) est appliquée sur tout le texte, puis chaque balise doit être `<strong>`, `<em>`, `<a href="/…|https://…">` ou leur fermeture ; une fermeture orpheline (`</iframe>`) est refusée.
- Spec fixture : les clés des champs du formulaire `devis_evenement` sont `date_evenement` et `nombre_personnes` (alignées sur la spec boulangerie réelle).
- Mesuré sur boulangerie : `content` = $2.06 pour 5 articles (≈ $0,41 par article, 0 relance), formulaires #4 et #5 (les identifiants 1 à 3 ont servi aux sondages préalables), articles de 643 à 694 mots — sous la cible 700–900 du prompt mais dans les bornes 500–1 200 ; cumul du site $22,09.
- Test d'intégration : Docker Desktop a renvoyé une erreur 500 transitoire sur `compose up --wait` lors des deux premières exécutions (environnement, pas le code) ; le test passe en ≈ 275 s.
- `tests/unit/cli.test.ts` : le test `--help` a un timeout de 20 s (le démarrage de `tsx` dépasse 5 s sous charge).
