# Faktory — Phase 8 : finitions visuelles et reports

Addendum au design `2026-09-12-faktory-design.md` (« Ordre de construction » 8). Rédigé le 2026-09-14 après le run de bout en bout de la phase 7. **Statut : périmètre retenu, décisions à prendre.** Chaque lot passe par sa propre discussion (questions, approches, design) avant son plan d'implémentation ; les pistes ci-dessous sont des recommandations, pas des décisions approuvées.

## Objectif

Que le site livré par un run sans retouche ressemble au design system sur **toutes** ses pages, pas seulement dans le contenu GenerateBlocks, puis solder les points reportés par les phases 4 à 7. Critère de sortie global : un nouveau run de bout en bout sur `boulangerie` dont le QA ne relève plus aucun défaut de charte (en-tête, menu, fonds, titres, blog, formulaires), avec le coût et la durée comparés à la phase 7 (16,70 $, 28 min 45 s).

## Constats du run phase 7 (site `boulangerie-e2e`, 2026-09-14)

Relevés sur `http://localhost:8100` et dans `generate_settings`, captures `qa/actualites.desktop.1.png` et `qa/la-maison.desktop.1.png`.

1. **Le thème n'est pas habillé par les tokens (bogue).** Seul le contenu GenerateBlocks suit la charte. Autour, GeneratePress affiche ses valeurs par défaut historiques sur toutes les pages :
   - `generate_settings` contient encore les couleurs héritées en hexadécimal : `background_color` `#efefef`, `text_color` `#3a3a3a`, `navigation_background_color` `#222222`, `link_color` `#1e73be`, `header_background_color` `#ffffff`, `footer_background_color` `#222222`, `form_button_background_color` `#666666` ;
   - le thème tourne en mode hérité : `structure` = `floats`, feuilles `generate-style-grid`, `generate-mobile-style` et `generate-font-icons` chargées ;
   - la CSS dynamique (`generate-style-inline-css`, 7 222 caractères) déclare bien `--accent`, `--base`… mais ne contient **aucune** règle `font-family` : la liste `typography` écrite par `applyTokens` (Figtree pour le corps, Fraunces pour les titres) n'est pas émise, bien que `use_dynamic_typography` vaille `true` et que les deux polices Google soient chargées.
   Conséquence visible : menu gris foncé, fond de page gris, liens bleus, titres et logo hors police de titre. Les pages générées le masquent en partie parce que leurs sections GB ont leur propre fond ; la page blog le montre en entier. Le QA l'a signalé (titres hors Fraunces sur 3 pages, barre de navigation sur `/la-maison/`) sans pouvoir le corriger : ce n'est pas dans l'arbre de page.
   Hypothèse à vérifier en premier : `applyTokens` fusionne ses clés dans un `generate_settings` déjà peuplé, et GeneratePress traite alors le site comme une mise à niveau d'une ancienne version (mode `floats`, typographie héritée), au lieu d'une installation neuve.
2. **La page blog n'est pas designée (bogue signalé).** `/actualites/` est le gabarit d'archive par défaut de GeneratePress : chaque article en pleine largeur avec son image à la une en 1200 × 800, titre en lien bleu, méta « septembre 13, 2026 by admin », aucun en-tête de page ni `h1`, une colonne qui fait 5 912 px de haut en desktop pour 5 articles. L'étape `pages` saute la page de type `blog` par conception (phase 3) et la mise en page du blog avait été reportée en phase 5 ; il n'existe donc aucun design pour cette page ni pour la page d'un article.
3. **Formulaires hors charte.** Le bouton « Envoyer » et les champs Gravity Forms gardent le thème par défaut de Gravity Forms (bleu, angles droits), relevé sur `/contact/` et `/commandes-evenements/`.
4. **Chaînes non traduites.** « by » dans la méta des articles : le paquet de langue français de GeneratePress n'est pas installé, alors que le site est en `fr_FR`.
5. **Manques du brief.** Horaires (« Bientôt précisé »), téléphone, adresse exacte et photos sont absents du brief ; ils représentent la majorité des 16 défauts `needs_human` du rapport QA, et chaque run les repaiera tant que le brief ne les fournit pas.

## Périmètre

Découpage proposé en trois lots, exécutés dans l'ordre, chacun avec son design et son plan.

### 8a — Habillage et page blog (bogues)

| # | Point | Piste recommandée | À décider |
|---|---|---|---|
| A1 | Thème habillé par les tokens (inclut la police des titres, reportée en phase 4) | Trouver pourquoi le site est en mode hérité et le mettre en mode flexbox + typographie dynamique dès `provision` ; mapper les couleurs de composants (fond, texte, liens, en-tête, menu, sous-menu, pied de page, méta, boutons) sur les variables de palette (`var(--base)`, `var(--contrast)`, `var(--accent)`…) ; vérifier dans le navigateur que `h1…h6` et `body` héritent des polices des tokens. | Faut-il un en-tête GB Pro (report phase 4) ou l'en-tête natif GeneratePress habillé suffit-il ? |
| A2 | Page blog designée | Un Element GP Premium (hook ou « content template » / « archive navigation ») qui donne à l'archive un en-tête de page (`h1`, introduction depuis la spec) et une grille de cartes d'articles (image recadrée, catégorie, date, extrait, lien), aux tokens ; même traitement pour l'en-tête d'un article seul. Déterministe si possible, sans agent. | Gabarit déterministe construit par Faktory, ou arbre `gb.json` généré par l'agent `pages` comme les autres pages ? Nombre d'articles par page et pagination. |
| A3 | `h1` de la page blog | Couvert par A2 ; le contrôle automatique `h1Count` doit passer à 1 sur `/actualites/`. | — |
| A4 | Formulaires à la charte | Désactiver le thème CSS de Gravity Forms (ou choisir le thème « orbital » et régler ses variables) et ajouter au thème enfant des règles sur les variables de palette et les rayons des tokens. | Réglage Gravity Forms seul, ou CSS du thème enfant ? |
| A5 | Traductions | Installer les paquets de langue `fr_FR` des thèmes et extensions pendant `provision` (`wp language theme install`, `wp language plugin install`), et contrôler l'absence de « by » / « Read more » en QA. | — |
| A6 | Rapport des manques du brief | À l'étape `spec`, lister dans `SITE-SPEC.md` les informations attendues mais absentes (horaires, téléphone, adresse, photos…), pour qu'elles soient complétées avant `approve` au lieu d'apparaître comme défauts QA. | Blocage du checkpoint tant que la liste n'est pas vide, ou simple avertissement ? |

Vérification 8a : rerun `provision → export` sur un site neuf ; en-tête, menu, fonds, liens, titres et formulaires à la charte sur toutes les URL ; page blog en grille avec `h1` ; les captures QA ne montrent plus aucune couleur par défaut de GeneratePress ou Gravity Forms.

### 8b — Fiabilité et qualité de la chaîne

Découpé le 2026-09-14 en 8b1 (B1, B3, B7, B8, B9, B10 : `2026-09-14-faktory-phase8b1-design.md`) et 8b2 (B2, B4, B5, B6).

| # | Point | Origine | Piste |
|---|---|---|---|
| B1 | Répartition du budget par agent concurrent | reporté phases 4, 5 | Diviser le reste du budget entre les agents lancés en parallèle (`pages`, `content`, `qa`) au lieu de donner le reste entier à chacun, pour que `maxCostUsd` ne puisse plus être dépassé de plusieurs runs. |
| B2 | Vraies images | constaté phase 7 | Remplacer placehold.co : dossier `assets/` fourni avec le brief et importé dans la médiathèque, avec repli sur une banque d'images libres ; images des pages, des articles et des entrées du plugin. Source et licence à décider. |
| B3 | Test de soumission des formulaires | reporté phases 5, 6 ; critère v1 « formulaire qui envoie » | En QA, remplir et envoyer chaque formulaire dans Playwright, vérifier la confirmation et l'entrée créée dans Gravity Forms, puis la supprimer. Sans SMTP : l'envoi du mail reste hors test. |
| B4 | Accessibilité | reporté phase 6 | axe-core dans le contrôle de page ; violations graves comptées comme défauts automatiques. |
| B5 | Lighthouse | reporté phase 6 | Scores performance / accessibilité / SEO par URL dans le rapport, sans seuil bloquant au départ. |
| B6 | Comparaison visuelle entre tours QA | reporté phase 6 | Diff d'images entre avant et après correction, pour détecter une régression introduite par l'agent. |
| B7 | Auto-approbation `run --yes` | reporté phase 7 | Traverser les deux checkpoints sans intervention, pour les runs de mesure et la CI. |
| B8 | Avertissement `--from` / `--only` sur un checkpoint | reporté phase 4 | Prévenir qu'une régénération de `spec` ou `design` écrase les éditions manuelles et invalide les étapes suivantes. |
| B9 | Rafraîchissement des titres de page | reporté phase 4 | Mettre à jour le titre WordPress d'une page quand la spec change après `provision`. |
| B10 | Historique des runs | reporté phase 7 | Conserver les mesures de chaque run (et non seulement le dernier record par étape) pour comparer les runs entre eux. |

### 8c — Livraison

| # | Point | Origine | Piste |
|---|---|---|---|
| C1 | Réglages Yoast globaux | reporté phase 5 | Séparateur, organisation (nom, logo), réseaux sociaux depuis l'identité de la spec. |
| C2 | Déploiement sur serveur | reporté phase 6 | Commande `faktory deploy <slug> <host>` qui reprend les étapes de `dist/README.md` par SSH. Cible d'hébergement à préciser. |
| C3 | Export incrémental et gros `uploads` | reporté phase 6 | Ne réarchiver que ce qui a changé ; découper `uploads` au-delà d'un seuil. Utile surtout après B2. |
| C4 | Chiffrement du livrable | reporté phase 6 | `db.sql` contient le hash du mot de passe admin : chiffrer `dist/` (age ou GPG) avant transmission. |
| C5 | Deuxième brief | constaté phase 7 | Mesurer un run complet sur un autre métier que la boulangerie pour vérifier que coûts et défauts se généralisent. |

## Hors périmètre

Rien de nouveau n'est reporté par ce document ; un point qui ne tiendrait pas dans 8a, 8b ou 8c sera noté dans la section « Écarts » du lot concerné.

## Ordre de travail

1. 8a en premier : c'est ce qui se voit, et A1 conditionne A2 et A4 (mêmes variables de palette et de typographie).
2. 8b ensuite, en commençant par B3 (dernier critère v1 non vérifié) et B1 (garde-fou de coût).
3. 8c selon le besoin de livraison réel ; C2 attend le choix de l'hébergement.
