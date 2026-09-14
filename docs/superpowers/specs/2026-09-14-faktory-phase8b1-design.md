# Faktory — Phase 8b1 : garde-fous de la chaîne

Addendum au périmètre `2026-09-14-faktory-phase8-design.md` (lot 8b). Rédigé le 2026-09-14. Le lot 8b est découpé en deux : **8b1** (ce document : B1, B3, B7, B8, B9, B10, sans nouvelle dépendance) puis **8b2** (B2 vraies images, B4 axe-core, B5 Lighthouse, B6 comparaison visuelle), avec son propre design. Là où ce document précise le périmètre, c'est ce document qui fait foi.

## Objectif

Un run sans surveillance qui ne peut plus dépasser son budget, traverse les checkpoints sur demande, vérifie que les formulaires envoient, protège les éditions manuelles et laisse une trace comparable de chaque exécution. Critère de sortie : `faktory run boulangerie-8b --yes` va de `spec` à `export` sans intervention, le rapport QA montre la soumission réussie de chaque formulaire, et `faktory compare boulangerie-8a boulangerie-8b` produit le tableau de mesures.

## Décisions

| Question | Décision |
|---|---|
| Découpage de 8b | 8b1 (B1, B3, B7, B8, B9, B10) puis 8b2 (B2, B4, B5, B6). |
| Budget des agents concurrents | Registre de réservations : la somme des plafonds des agents en cours ne dépasse jamais le reste du budget. |
| Échec d'une soumission de formulaire | Défaut automatique du rapport QA ; l'étape `qa` n'échoue pas. |
| Régénération d'un checkpoint | Confirmation interactive (sautée par `--yes`, refusée sans terminal), puis étapes suivantes remises à `pending` ; les fichiers générés ensuite sont conservés. |
| Historique | `sites/<slug>/runs.jsonl` par site, `faktory status --history` et `faktory compare` entre sites. |
| Vérification | Run neuf sans surveillance `boulangerie-8b` avec `--yes`, lancé détaché. |

## B1 — Répartition du budget entre agents concurrents

### Constat

`agentQueryOptions` passe `remainingBudget(ctx)` (tout le reste du budget) en `maxBudgetUsd` à chaque agent. Avec 3 agents en parallèle (`PAGES_CONCURRENCY`, `ARTICLES_CONCURRENCY`, `QA_CONCURRENCY`), le site peut dépasser `maxCostUsd` de deux runs entiers avant que `assertBudget` ne voie le dépassement. Le coût d'un agent n'est ajouté à `ctx.state.costUsd` qu'à son message `result`.

### Approches écartées

- **Estimation avant lancement** : ne pas lancer un agent si dépense + coût estimé des agents en cours dépasse le plafond. Aucune garantie : le coût d'une page QA varie de 0,60 $ à 1,50 $.
- **Passage en séquentiel** quand le reste descend sous N fois un run typique : dépend aussi d'une estimation.

### Registre

Dans `src/budget.ts` :

- `withBudgetSlots<T>(ctx, n, fn: () => Promise<T>): Promise<T>` ouvre un groupe de `n` créneaux pour la durée de `fn`. Les trois boucles `mapLimit` de `pages`, `content` (articles) et `qa` sont enveloppées avec leur constante de concurrence.
- `reserveBudget(ctx): { capUsd: number; release(): void }` :
  - hors groupe : `capUsd` = reste du budget (comportement actuel pour `spec`, `design`, `plugins`, les resyncs) ;
  - dans un groupe : `capUsd = (maxCostUsd − costUsd − réservé) / (n − actifs)`, arrondi au centime inférieur, plancher 0,05 $ ;
  - `release()` retire la réservation ; appelée dans un `finally` de `runAgent`, après l'ajout du coût réel à l'état.
- Le registre est en mémoire, dans un `WeakMap` indexé par `ctx`, jamais écrit dans `faktory.json`.
- `agentQueryOptions` reçoit le plafond en paramètre au lieu d'appeler `remainingBudget`. `remainingBudget` et les commentaires « per-run splitting is still deferred » dans `agent.ts`, `pages.ts` et `qa.ts` sont supprimés.

Invariant : au lancement de chaque agent, la somme des plafonds réservés est au plus `maxCostUsd − costUsd`. Le dépassement possible se limite au dernier tour de chaque agent, que le SDK termine avant de contrôler son budget. Contrepartie assumée : quand le budget est serré, un agent est arrêté en cours de route (`error_max_budget_usd`) et sa page échoue au lieu de dépenser au-delà du plafond.

Les tours successifs d'un même créneau (relance de `runValidated`, deuxième tour QA avec `resume`) réservent chacun à nouveau, avec le reste à jour.

### Tests

- Unit : trois agents factices concurrents dans un groupe de 3, coûts réels inférieurs aux plafonds : à chaque lancement, somme des plafonds ≤ reste ; un créneau libéré est réattribué avec le reste recalculé ; hors groupe, plafond = reste ; `release` appelé aussi quand l'agent lève une erreur.
- Unit : `agentQueryOptions` transmet le plafond reçu en `maxBudgetUsd`.

## B7 — Auto-approbation `run --yes`

- Nouvelle option `faktory run <slug> --yes`.
- La logique d'`approveSite` passe dans `approveStage(ctx, name, stages)` (appel de `onApprove`, avertissement des manques du brief, coût de resync imputé à l'étape, statut `done`, message « approved »), utilisée par `approveSite` et par `runSite`.
- Dans la boucle de `runSite`, quand une étape checkpoint se termine et que `yes` est vrai : `approveStage` puis étape suivante, avec le message `✔ <stage> — auto-approved (--yes)` au lieu de la consigne `faktory approve`.
- Si le site attend déjà une approbation au début du run, `--yes` l'approuve et continue, au lieu de lever « awaits approval ».
- `assertBudget` reste appelé avant chaque approbation.

### Tests

- Pipeline (étapes factices) : `run --yes` sur un site neuf traverse `spec` et `design` et termine toutes les étapes ; `onApprove` est appelé une fois par checkpoint ; un site en attente sur `design` est approuvé puis poursuivi ; sans `--yes`, comportement inchangé.

## B8 — Confirmation avant régénération d'un checkpoint

### Déclenchement

`runSite` avec `from` ou `only` égal à `spec` ou `design`, et le markdown de cette étape présent (`SITE-SPEC.md` ou `design-system.md`). Le premier run d'un site ne déclenche rien.

### Confirmation

Avant toute exécution, message puis question `[y/N]` :

```
⚠ Régénérer design écrase : design-system.md, design-tokens.json, preview.html, design/preview.gb.json
  Les étapes suivantes repasseront en attente : provision, plugins, pages, content, qa, export
  Conservés et réutilisés par leurs étapes : pages/*.gb.json, content/articles/*.json — supprimez-les pour tout reconstruire
Continuer ? [y/N]
```

- Fichiers écrasés : `spec` → `SITE-SPEC.md`, `site-spec.json` ; `design` → `design-system.md`, `design-tokens.json`, `preview.html`, `design/preview.gb.json`, `design/preview.gb.html`. Seuls ceux qui existent sont listés.
- La ligne des fichiers conservés n'apparaît que si l'un de ces fichiers existe.
- `--yes` : la question est sautée, le message est affiché.
- Sans terminal (`process.stdin.isTTY` faux) et sans `--yes` : erreur « Régénérer <stage> écrase des éditions manuelles ; relancez avec --yes pour confirmer ».
- Réponse autre que `y` : rien n'est exécuté, `Aborted.`
- La question passe par `deps.confirm` pour les tests.

### Remise en attente

Après confirmation, avant l'exécution : chaque étape postérieure à l'étape régénérée repasse à `pending`, sans message ni mesure. Avec `--from`, ces étapes sont de toute façon rejouées dans la foulée ; avec `--only`, un `faktory run` ultérieur les rejouera. Aucun fichier n'est supprimé.

### Tests

- Pipeline : `--only design` avec `design-system.md` présent → `confirm` appelé avec la liste attendue ; refus → aucune étape exécutée ; acceptation → étapes suivantes `pending` ; `--yes` → pas d'appel à `confirm` ; sans TTY et sans `--yes` → erreur ; `--only provision` et premier run → pas de confirmation.

## B3 — Test de soumission des formulaires

### Emplacement

Dans l'étape `qa`, après les tours de revue de la page qui porte le formulaire : chaque formulaire de `content/forms.json` est soumis une fois, sur la première page de `formPages(spec, id)`. Pas dans `checkPage`, qui est rejoué à chaque tour. Pas de test si le manifeste de formulaires est vide.

### Module `src/qa/forms.ts`

- `formValues(form: GfFormLive, marker: string): Record<number, string>` (pur) — une valeur par champ du formulaire réel, lu par `wp gf form get <gfId>` (les identifiants de champ d'un formulaire adopté peuvent différer de ceux de `buildGfForm`) :

  | Type Gravity Forms | Valeur |
  |---|---|
  | `text` | `Test Faktory <marker>` |
  | `email` | `qa+<marker>@faktory.test` |
  | `phone` | `+33 6 00 00 00 00` |
  | `date` | lendemain au format `dd/mm/yyyy` |
  | `number` | `2` |
  | `textarea` | `Message de test Faktory <marker>` |
  | `select` | premier choix |

  Un type absent de la table reçoit la valeur `text`. `marker` = `fq` suivi de l'horodatage en millisecondes.
- `submitForm(browser, ctx, url, formId, gfId, opts?): Promise<FormSubmission>` :
  1. lit le formulaire avec `wp gf form get` ;
  2. ouvre `url` dans un nouveau contexte de navigateur, remplit `#input_<gfId>_<fieldId>` (option choisie par `selectOption` pour un `select`) ; `opts.values` remplace les valeurs pour les tests ;
  3. clique `#gform_submit_button_<gfId>` et attend `#gform_confirmation_message_<gfId>` (15 s) ; à défaut, relève le texte de `.gfield_validation_message` et `.gform_submission_error` ;
  4. cherche l'entrée dont une valeur contient `marker` dans `wp gf entry list <gfId>` et la supprime avec `wp gf entry delete <entryId> --force` ;
  5. ne lève jamais : toute erreur devient `ok: false` avec `error`.
- `FormSubmission = { formId: string; gfId: number; url: string; ok: boolean; error?: string; checkedAt: string }`. Erreurs : `pas de confirmation (« <messages de validation> »)`, `aucune entrée créée`, `entrée #<id> non supprimée`.
- Une entrée trouvée est toujours supprimée, même quand la confirmation manque.

### Rapport

- `PageCheckSchema` gagne `formSubmissions: z.array(FormSubmissionSchema).default([])` : les rapports et contrôles existants restent lisibles.
- `checkIssues` ajoute une ligne par soumission en échec : `formulaire devis (#1) : <error>`. Les totaux et `QA-REPORT.md` la comptent comme les autres défauts automatiques.
- Le résultat est écrit dans `qa/<slug>.check.json` de la page et dans son entrée du rapport.
- `hasHardFailure` est inchangé.

### Envoi du mail

Pas de SMTP dans la stack : `wp_mail` échoue en silence pour la notification admin, Gravity Forms enregistre quand même l'entrée et affiche la confirmation. L'envoi du mail reste hors test, comme prévu en phase 8.

### Tests

- Unit : `formValues` pour chaque type et pour un type inconnu ; ligne de `checkIssues` ; `formSubmissions` absent → `[]`.
- Unit, étape `qa` avec `deps` factices : un formulaire sur deux pages n'est soumis qu'une fois, sur la première ; aucune soumission sans manifeste.
- Intégration `@docker` : site provisionné, formulaire créé par `ensureForms` et publié sur une page ; `submitForm` → `ok`, le nombre d'entrées est le même avant et après ; avec `opts.values` qui vide un champ requis → `ok: false`, `error` contient le message de validation.

## B9 — Rafraîchissement des titres de page

- `ensurePages` lit aussi `post_title`. Pour une page existante dont le titre diffère de celui de la spec : `wp post update <id> --post_title=<titre>` et `  ↻ title /<slug>/: "<ancien>" → "<nouveau>"`.
- Toutes les étapes qui appellent `ensurePages` (provision, plugins, pages, content, qa) remettent donc les titres à jour. Les éléments du menu qui pointent vers ces pages suivent, WordPress prenant le titre de la page tant qu'aucun libellé personnalisé n'est saisi.
- Changer un slug reste hors périmètre : `ensurePages` créerait une nouvelle page.

### Tests

- Unit (`wpJson`/`wpOk` factices) : titre différent → une mise à jour ; titre identique → aucune.
- Intégration `@docker` (provision) : titre modifié à la main, provision → titre de la spec rétabli.

## B10 — Historique des runs

### Fichier

`sites/<slug>/runs.jsonl`, une ligne JSON ajoutée par événement, jamais réécrite :

```json
{ "runId": "2026-09-14T20:01:02.345Z", "kind": "stage", "stage": "pages", "status": "done",
  "costUsd": 5.62, "durationMs": 513000, "startedAt": "…", "endedAt": "…", "message": "…",
  "faktory": { "commit": "b0d5692", "dirty": false },
  "options": { "from": null, "only": null, "yes": true, "maxCostUsd": 40 } }
```

- `runId` : horodatage du début de l'appel `faktory run` ou `faktory approve`. Un `faktory resync` n'écrit rien : son coût reste visible dans le total de `faktory.json`.
- `kind` : `stage` (écrit par `runSite` à la fin de chaque étape : `done`, `awaiting_approval` ou `failed`) ou `approve` (écrit par `approveStage`, avec le seul coût du resync).
- `faktory.commit` : `git rev-parse --short HEAD` et `git status --porcelain` non vide pour `dirty`, calculés une fois par appel ; `null` hors dépôt git.
- Un échec d'écriture affiche un avertissement et n'interrompt jamais le run.
- `runs.jsonl` est inclus dans le répertoire du site, pas dans `dist/`.

### Module `src/history.ts`

- `appendRun(siteDir, record)`, `readRuns(siteDir): RunRecord[]` (une ligne illisible est ignorée avec un avertissement), `RunRecordSchema` (zod).
- `stageTotals(siteDir): Record<StageName, { costUsd?: number; durationMs?: number }>` : pour chaque étape, le dernier enregistrement `stage` au statut `done` ou `awaiting_approval`, plus le coût des `approve` du même checkpoint postérieurs à ce run ; sans `runs.jsonl` (sites antérieurs, dont `boulangerie-8a`), repli sur les mesures de `faktory.json`.

### Commandes

- `faktory status <slug> --history` : après le tableau habituel, un bloc par `runId` (date, commit, options), une ligne par événement : étape, statut, coût, durée, message tronqué.
- `faktory compare <slugA> <slugB> [slugC…]` : tableau étape × site en `coût · durée`, ligne de total, au format des tableaux des documents de phase (colonnes alignées, `$` et durées de `status.ts`). Rendu pur `renderCompare(sites)`, sans Docker ni LLM.

### Tests

- Unit : ajout et relecture, ligne corrompue ignorée ; `stageTotals` prend le dernier `done`, ajoute le coût d'approbation, se replie sur `faktory.json` ; rendu de `--history` et de `compare`.
- Pipeline : un run factice de 8 étapes avec `--yes` écrit 10 lignes (8 étapes, 2 approbations) ; une étape en échec écrit `failed`.

## Fichiers

| Fichier | Action |
|---|---|
| `src/budget.ts` | registre `withBudgetSlots`, `reserveBudget` |
| `src/agent.ts` | plafond réservé et libéré par `runAgent` ; suppression de `remainingBudget` |
| `src/stages/pages.ts`, `src/stages/content.ts`, `src/stages/qa.ts` | boucles enveloppées par `withBudgetSlots` ; `qa` soumet les formulaires |
| `src/pipeline.ts` | `approveStage`, `--yes`, confirmation et remise en attente, écriture de l'historique |
| `src/cli.ts` | `run --yes`, `status --history`, `compare` |
| `src/qa/forms.ts` | création : `formValues`, `submitForm` |
| `src/schemas/qa.ts`, `src/qa/report.ts` | `formSubmissions`, ligne de défaut |
| `src/provision/pages.ts` | mise à jour des titres |
| `src/history.ts`, `src/status.ts` | création de l'historique ; rendu `--history` et `compare` |
| `tests/unit/…`, `tests/integration/…` | tests décrits par point |
| `README.md`, `docs/GETTING-STARTED.md` | `--yes`, confirmation, `status --history`, `compare`, test des formulaires |

## Vérification 8b1

1. Suites unit et intégration vertes, `npm run typecheck` propre.
2. Run neuf : `faktory init boulangerie-8b --brief fixtures/briefs/boulangerie.md`, puis `nohup faktory run boulangerie-8b --yes > run.log 2>&1 &`, sans aucune approbation manuelle.
3. Attendu :
   - les deux checkpoints auto-approuvés, l'avertissement des manques du brief dans le log ;
   - aucune étape arrêtée par un plafond de budget ;
   - `formSubmissions` à `ok` pour `devis` et `contact`, aucune entrée de test restante dans Gravity Forms ;
   - `runs.jsonl` compte 10 lignes.
4. `faktory compare boulangerie-8a boulangerie-8b` reporté dans une section « Écarts et mesures » de ce document.
5. Registre de budget en conditions réelles : `faktory run boulangerie-8b --only qa --max-cost <dépense + 1>`. Les revues d'arbres inchangés étant réutilisées, le plafond n'est atteint que si des pages sont relues ; le compte rendu indique si le cas s'est produit (dépense finale ≤ plafond + un tour par agent) ou si seuls les tests unitaires couvrent l'invariant.

## Écarts et mesures

Exécution du plan `docs/superpowers/plans/2026-09-14-faktory-phase8b1-guardrails.md` sur la branche `faktory/phase8b1` : 9 tâches revues une à une, une revue finale de la branche et une vague de corrections, puis un run neuf sans surveillance et un contrôle sous plafond de budget.

### Écarts au design

1. **Totaux QA inchangés.** Le document dit qu'un échec de soumission compte « comme les autres défauts automatiques ». En code, `computeTotals` ne compte que les `left` de l'agent ; les défauts automatiques restent visibles dans chaque section de page (« Défauts automatiques : … ») et son tableau de contrôles. Les soumissions suivent cette règle existante : une ligne dans `checkIssues` et une ligne `| Formulaires soumis | n/m |` (seulement sur les pages qui portent un formulaire testé), sans toucher aux totaux.
2. **Comparaison des titres avec entités décodées.** WordPress stocke « Commandes & événements » en « Commandes &amp; événements » ; sans décodage, chaque appel à `ensurePages` aurait réécrit ce titre.
3. **`stageTotals` se replie par étape**, pas seulement quand `runs.jsonl` est absent : une étape sans enregistrement `done`/`awaiting_approval` dans le journal reprend les mesures de `faktory.json` quand cette étape est `done`.
4. **Les enregistrements d'approbation** portent la durée d'`onApprove` lui-même ; `stageTotals` n'ajoute que leur coût au checkpoint.
5. **`withBudgetSlots` refuse de s'imbriquer** (lève une erreur) : aucune étape n'a besoin de groupes imbriqués, et un groupe imbriqué casserait l'arithmétique des réservations.
6. **L'avertissement de régénération est affiché avec `console.warn`** même avec `--yes`, pour que le log du run sans surveillance montre ce qui a été écrasé.
7. **`agentQueryOptions` prend le plafond comme 4ᵉ argument obligatoire** (`maxBudgetUsd: number`).
8. **Recherche d'entrée Gravity Forms** (trouvé à l'exécution) : `wp gf entry list --format=json` nomme ses colonnes d'après les libellés traduits (« ID de l'entrée »), et `wp gf entry delete` sort en code 0 même quand rien n'est supprimé. L'entrée de test est donc trouvée avec `wp gf entry list <gfId> --format=ids` puis `wp gf entry get <id> --raw --format=json` (recherche du marqueur), supprimée avec `--force`, et la suppression confirmée par un `wp gf entry get <id>` en échec. Nouvelles erreurs : `liste des entrées illisible (#<gfId>)`, et toute erreur imprévue est préfixée `erreur du navigateur : `.
9. **Régénérer `spec` nomme aussi les fichiers de `design`** : une ligne d'avertissement supplémentaire `Seront régénérés ensuite par design : …`, car `design` régénère toujours ses fichiers.
10. **La ligne de résumé de l'étape `qa`** ajoute `; N form(s) failed` quand une soumission a échoué (les totaux restent inchangés).
11. **Formulation de B9.** Les titres sont rafraîchis par cinq étapes (`provision`, `plugins`, `pages`, `content`, `qa`), pas quatre — la puce de B9 de ce document qui en listait quatre est corrigée en conséquence.
12. **Non traité.**
    - Après `Cost budget reached`, la remise en attente des étapes suivantes (B8) peut déjà être persistée.
    - Un `onApprove` qui lève n'écrit aucun enregistrement d'historique.
    - Les entités HTML hexadécimales (`&#x27;`) ne sont pas décodées.
    - Les entrées laissées par un run tué ne sont pas balayées.
    - Le test d'intégration Docker de `content` a été tué par un manque de mémoire de l'hôte pendant la vérification et n'a pas été relancé (le changement dans `content` est uniquement l'enveloppe `withBudgetSlots`, testée en unitaire) ; Docker `qa` 3/3 et `provision` 2/2 sont passés.

### Run neuf `boulangerie-8b`

`init` depuis `fixtures/briefs/boulangerie.md` sur le port 8103, puis `faktory run boulangerie-8b --yes` lancé détaché (nohup + log), commit `0f08d30`, arbre propre, sans aucune approbation manuelle.

| Étape | 8b1 | 8a |
|---|---|---|
| spec | 0,39 $ · 1 min 04 s | 0,39 $ · 1 min 05 s |
| design | 1,06 $ · 3 min 23 s | 1,06 $ · 3 min 18 s |
| provision | 0,00 $ · 2 min 15 s | 0,00 $ · 1 min 59 s |
| plugins | 1,46 $ · 4 min 07 s | 1,50 $ · 4 min 03 s |
| pages | 5,68 $ · 8 min 48 s | 5,62 $ · 8 min 33 s |
| content | 1,84 $ · 3 min 11 s | 1,90 $ · 2 min 49 s |
| qa | 0,00 $ · 50 s | 5,38 $ · 4 min 48 s |
| export | 0,00 $ · 9 s | 0,00 $ · 11 s |
| **total** | **10,44 $ · 23 min 47 s** | **15,84 $ · 26 min 47 s** |

Résultats :

- Les deux checkpoints (`spec`, `design`) auto-approuvés avec l'avertissement des manques (10 informations à compléter) ; aucune ligne `error_max_budget_usd` ni `Cost budget reached` dans `run.log`.
- `runs.jsonl` compte 10 lignes (8 étapes, 2 approbations).
- Les deux formulaires soumis : `devis_evenement` (#1) sur `/commandes-evenements/` et `contact` (#2) sur `/contact/`, tous deux `ok: true` ; 0 entrée restante dans Gravity Forms après le run (`wp gf entry list 1/2 --format=ids` → sortie vide).
- QA : 11 URL contrôlées, 5 pages relues, 16 défauts restants, tous `needs_human`. Ils viennent des manques du brief (horaires, téléphone, adresse, noms de l'équipe, lien d'itinéraire) et des images de remplacement (lot 8b2), plus les points Gravity Forms (bouton, mention « (Nécessaire) ») déjà relevés en 8a.
- Coût de `qa` : 2,31 $ contre 5,38 $ en 8a, chaque page s'étant arrêtée après le premier tour (arbre inchangé, donc pas de second tour) — sans lien avec un changement de 8b1.

Contrôle sous plafond de budget : `faktory run boulangerie-8b --only qa --max-cost 13.75` avec 12,747 $ déjà dépensés — les 5 revues sont toutes réutilisées (arbres inchangés), 0,00 $, les deux formulaires resoumis, le plafond n'est jamais atteint. L'invariant du registre de budget n'est donc couvert ici que par `tests/unit/budget.test.ts` et `tests/unit/agent-budget.test.ts`.

Observation hors périmètre : les agents de revue QA signalent leur écriture dans `pages/<slug>.gb.json` comme refusée à chaque run depuis la phase 7 (0 correction). À investiguer en 8b2.
