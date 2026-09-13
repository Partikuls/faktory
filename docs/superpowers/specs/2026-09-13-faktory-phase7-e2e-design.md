# Faktory — Phase 7 : run de bout en bout, mesure, documentation

Addendum au design `2026-09-12-faktory-design.md` (« Ordre de construction » 7 : *E2E — run complet sur le brief boulangerie, mesure coût/durée, doc README.md*). Rédigé le 2026-09-13, après la phase 6. Là où ce document précise le design initial, c'est ce document qui fait foi.

## Objectif

Prouver que la chaîne complète tient d'un bout à l'autre sur un site neuf, sans aucune intervention manuelle autre que les deux approbations (`spec`, `design`), et mesurer ce qu'elle coûte et ce qu'elle dure, étape par étape. Les mesures du README jusqu'ici viennent de runs partiels et de re-runs avec réutilisation ; aucune ne décrit un run complet à froid.

Critères d'acceptation v1 (design initial) à vérifier sur le site produit : 6 pages stylées GB, header/footer/menus, un plugin CPT rendu dans une page, un formulaire contact GF, meta Yoast sur chaque page, ≥ 3 articles, un `dist/` restaurable dans un Compose neuf, coût total sous `maxCostUsd` (40 $).

## Décisions

1. **Site neuf, slug `boulangerie-e2e`.** Le site `boulangerie` (30,54 $ d'artefacts, référence des phases 2 à 6) est conservé tel quel ; le run E2E part de `faktory init boulangerie-e2e --brief fixtures/briefs/boulangerie.md` sur le port suivant libre. Aucun artefact n'est copié depuis `boulangerie` : tout est régénéré (spec, design, pages, plugin, formulaires, articles, qa, export).
2. **Approbations sans édition.** Aux deux checkpoints, `faktory approve` est lancé sans toucher à `SITE-SPEC.md` ni `design-system.md` : la mesure décrit ce que l'agent produit seul. Le nombre de pages, de features et de formulaires est celui que le `spec` décide (le site de référence en a 6 / 1 / 2 après édition manuelle).
3. **Mesure par étape dans `faktory.json`.** Chaque `stages.<name>` gagne deux champs optionnels : `costUsd` (dépense de l'étape = delta de `costUsd` du site pendant `run`, plus, pour un checkpoint, le delta de son `onApprove`) et `durationMs` (durée murale de `stage.run`, l'approbation exclue — le temps humain n'est pas une mesure de la chaîne). `setStage` accepte ces champs en supplément ; `runSite` les mesure autour de `stage.run`, aussi en cas d'échec ; `approveSite` conserve `durationMs` et ajoute le coût de la re-synchronisation. Les états existants (sans ces champs) restent valides.
4. **`faktory status <slug>`.** Nouvelle commande, sans LLM ni Docker : tableau des étapes (statut, coût, durée, message), coût cumulé, durée cumulée des étapes `run`, URL du site et port. `renderStatus(state)` est pure (`src/status.ts`) pour être testée ; la CLI l'imprime. C'est cette sortie qui alimente le README.
5. **Restauration vérifiée à la main.** Après `export`, `dist/` est restauré dans un Compose neuf sur un port libre en suivant `dist/README.md` (les deux `search-replace`, reindex Yoast, flush), la page d'accueil, une page avec le bloc plugin, la page contact et un article sont contrôlés en HTTP, puis la pile est détruite (`compose down -v`). Le test d'intégration de la phase 6b couvre déjà ce chemin ; ici il s'agit du livrable réel.
6. **README.** Section « End-to-end run » : commandes exactes, tableau par étape (coût, durée, cumul), durée totale, résultat des critères d'acceptation, ce qui a demandé une intervention (rien attendu) et les défauts restants du rapport QA. La section « Cost » existante garde ses mesures partielles, précédées d'une ligne renvoyant au run complet.
7. **Différé.** Auto-approbation (`run --yes`) : les checkpoints sont volontaires ; ce run les traverse à la main. Historique des runs (un seul état par site) ; export des mesures ailleurs que dans `faktory.json` et le README.

## Fichiers

| Fichier | Responsabilité |
|---|---|
| `src/state.ts` (modifier) | `StageRecord` + `costUsd?`, `durationMs?` ; `setStage(state, name, status, message?, extra?)` fusionne `extra` |
| `src/pipeline.ts` (modifier) | `runSite` mesure durée et coût de chaque étape ; `approveSite` ajoute le coût de `onApprove` au record |
| `src/status.ts` | `renderStatus(state): string`, `formatDuration(ms)`, `sumDuration(state)` |
| `src/cli.ts` (modifier) | commande `status <slug>` |
| `tests/unit/state.test.ts`, `tests/unit/pipeline.test.ts`, `tests/unit/status.test.ts`, `tests/unit/cli.test.ts` | tests |
| `README.md` | usage `status`, section « End-to-end run » |

## Vérification de bout en bout

```bash
npm run faktory -- init boulangerie-e2e --brief fixtures/briefs/boulangerie.md
npm run faktory -- run boulangerie-e2e        # spec ⏸
npm run faktory -- approve boulangerie-e2e
npm run faktory -- run boulangerie-e2e        # design ⏸
npm run faktory -- approve boulangerie-e2e
npm run faktory -- run boulangerie-e2e        # provision → plugins → pages → content → qa → export
npm run faktory -- status boulangerie-e2e
cat sites/boulangerie-e2e/qa/QA-REPORT.md
# restauration de sites/boulangerie-e2e/dist/ selon dist/README.md sur un port libre, contrôle HTTP, compose down -v
```

## Écarts constatés à l'exécution (2026-09-13)

Run complet sur `boulangerie-e2e` (port 8100), de `init` (23:12) à `export` terminé (23:42) : **16,70 $, 28 min 45 s de temps d'étapes, 29 min 55 s mur** avec les deux approbations. Détail par étape et critères d'acceptation dans le README, section « End-to-end run ». Tous les critères v1 sont tenus ; `dist/` restauré sur le port 8110 depuis `dist/docker-compose.prod.yml` sert les mêmes pages (mêmes comptes de blocs, bloc plugin, formulaire, article, aucune URL locale restante), puis pile détruite.

1. **Relance de la commande `run` au début de `provision`.** Le premier lancement du dernier `run` est passé par un outil limité à 10 minutes ; il a été interrompu quelques secondes après `▶ provision` (conteneurs en cours de démarrage, rien d'installé) et relancé détaché (`nohup`). `faktory run` a repris à `provision` (statut `running` ≠ `done`) et l'a terminé en « fresh install ». La durée mesurée de `provision` (1 min 17 s) est donc inférieure de quelques secondes à un démarrage à froid. Le coût n'est pas affecté (0 $).
2. **Trois verdicts QA refusés puis acceptés.** Sur les 5 agents de relecture, 3 ont rendu un premier verdict incohérent (règles `fixed` ⇒ issue `fixed` + arbre modifié, etc.), relancé une fois dans la même session avec l'erreur ; les trois relances ont validé. Leur coût est compris dans les 5,92 $ de l'étape. Le journal ne montrait que la première ligne de l'erreur (« qa verdict is inconsistent: ») : `runValidated` aplatit désormais l'erreur sur une ligne (`oneLine`) avant de la journaliser.
3. **Titres en police de corps.** Les tokens (`fonts.heading` = Fraunces) chargent bien la police Google et quelques blocs l'utilisent en style inline, mais aucune règle globale `h1…h6` ne l'applique : la typographie des titres de GeneratePress n'est pas réglée par `provision`. Relevé par le QA sur 3 pages, laissé en `needs_human`. À corriger dans `provision/settings.ts` lors d'une phase ultérieure.
4. **Boutons Gravity Forms hors charte.** Le bouton « Envoyer » et les champs gardent le thème par défaut de Gravity Forms (bleu, angles droits) au lieu de l'accent des tokens. Les formulaires fonctionnent ; l'habillage relève d'une règle CSS du thème enfant à ajouter par `content/forms.ts` ou `provision`, phase ultérieure.
5. **Ce que le brief ne dit pas reste vide.** Horaires (« Bientôt précisé »), téléphone, adresse exacte et photos (placehold.co) sont signalés par le QA sur 4 pages ; c'est le comportement attendu (pas d'invention), mais chaque run coûtera ces `needs_human` tant que le brief ne les fournit pas.
6. **Page blog sans `h1`.** Le gabarit d'archive de GeneratePress n'affiche pas de titre de page ; contrôle automatique `h1Count = 0` sur `/actualites/`, non bloquant.
7. **Pas d'auto-approbation.** Les deux `approve` ont pris moins d'une seconde (aucune édition, donc aucune re-synchronisation) ; le besoin d'un `run --yes` ne s'est pas fait sentir, il reste différé.
