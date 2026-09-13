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
