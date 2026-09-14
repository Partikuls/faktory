# Faktory

WordPress AI software factory: `brief.md` in, GeneratePress/GenerateBlocks site out.

## Getting started
New to Faktory? Follow [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md). It walks through the prerequisites, the one-time setup, writing a brief, the two approval checkpoints, the build, the QA report and the deliverable bundle, then how to re-run a stage and fix common errors. The sections below are the reference.

## Setup
```bash
npm install
npm run sync-skills                 # copies GP/GB + WP skills from ~/.claude/skills into plugin/skills
npm run setup-phpstan               # composer install into tools/phpstan (php + composer on the host), needed by the plugins stage
npm run setup-playwright            # downloads Chromium for the qa stage (doctor checks it)
cp docker/.env.example docker/.env  # optional license keys (not used yet)
# drop gp-premium*.zip, generateblocks-pro*.zip, gravityforms*.zip, gravityformscli*.zip into docker/vendor/
npm run faktory -- doctor           # add --agent to verify skill loading with a real query
# no ANTHROPIC_API_KEY needed: the SDK reuses your Claude Code login (doctor --agent proves it, ~$0.10-0.20)
```

`docker/vendor/` zips are optional; without them `provision` still runs and reports "missing vendor zips" instead of failing.

## Usage
```bash
npm run faktory -- init boulangerie --brief fixtures/briefs/boulangerie.md
npm run faktory -- run boulangerie          # spec → stops: edit sites/boulangerie/SITE-SPEC.md
npm run faktory -- approve boulangerie      # re-syncs site-spec.json if you edited the markdown
npm run faktory -- run boulangerie          # design → stops: open preview.html, edit design-system.md
npm run faktory -- approve boulangerie      # re-syncs design-tokens.json if you edited the markdown
npm run faktory -- run boulangerie          # provision (WP + GP stack, fr_FR packs, identity, menu, theme settings from tokens, child theme form styles, footer and blog elements) then pages (one agent per page, home first, then 3 in parallel): neither is a checkpoint, so one `run` does both — and, unless `--only` narrows it, this same `run` keeps going through `plugins`, `content`, `qa` and `export` too: spec and design are the only checkpoints, so one `run boulangerie` after the design approval drives the whole rest of the pipeline to `dist/`
npm run faktory -- run boulangerie --only design --max-cost 10
npm run faktory -- approve boulangerie --max-cost 10
npm run faktory -- run boulangerie --only pages --max-cost 15
npm run faktory -- run boulangerie --only plugins --max-cost 30   # one agent per feature: writes wp-content/plugins/faktory-<id>/, php_check, activates, seeds, then inserts the block into the pages
npm run faktory -- run boulangerie --only qa --max-cost 10   # browser checks + screenshots of every url, one review agent per generated page (≤ 2 fix rounds), qa/QA-REPORT.md
npm run faktory -- export boulangerie             # $0: sites/boulangerie/dist/ — db.sql (URL placeholder), wp-content.tar.gz, prod compose, README, MANIFEST
npm run faktory -- resync boulangerie       # re-syncs any checkpoint JSON whose .md you edited after approve (also --max-cost)
npm run faktory -- status boulangerie       # $0, no Docker: one row per stage (status, cost, duration, message), totals, site URL
npm run faktory -- destroy boulangerie
npm run faktory -- doctor --agent
```
Sites live in `sites/<slug>/` (gitignored). `faktory.json` holds stage status, port, admin credentials and cumulated cost; since phase 7 every stage record also carries its own `costUsd` (what that stage's last run spent, plus the checkpoint's `approve` re-sync) and `durationMs` (wall-clock of the last `run`, approval time excluded) — `faktory status <slug>` prints them as a table. A re-run of a stage overwrites its record.
Site URL: `http://localhost:<port>` (ports start at 8100). Admin: `admin` / password in `faktory.json`.

`faktory resync <slug>` is for edits made to `SITE-SPEC.md` or `design-system.md` *after* you already ran `approve` — `approve` only re-syncs once, at the checkpoint; a later hand edit is otherwise silently ignored until the next `run` or `resync`, which warns you when a `.md` is newer than its `.json`. Conversely, `run --only spec` (or `--only design`) regenerates that artifact from the brief with the agent and overwrites any hand edits to the `.md`/`.json`.

### Artifacts
| File | Written by | Edit it? |
|---|---|---|
| `SITE-SPEC.md` / `site-spec.json` | spec stage | Edit the `.md`; `approve` or `resync` re-extracts the JSON when the `.md` is newer |
| `design-system.md` / `design-tokens.json` / `preview.html` | design stage | Edit the `.md` (tokens section included); `approve` or `resync` re-extracts the JSON and re-renders the preview |
| `design/preview.gb.json`, `design/preview.gb.html` | design stage | Intermediate gb_build tree and markup |
| `pages/<slug>.gb.json` / `pages/<slug>.html` | pages stage | Edit the `.gb.json` (gb_build tree); the next `run --only pages` recompiles and republishes it without any LLM call. Delete it to regenerate the page. The agent may also leave `pages/<slug>.gb.html` (its own `gb_build` self-check) and `pages/<slug>.preview.html` (its `gb_preview`) next to Faktory's own `pages/<slug>.html`; those are scratch files, not artifacts Faktory reads back. |
| `plugins/<id>.json` | plugins stage | Manifest (block, shortcode, one block placement per page). Delete it to regenerate the plugin; edit `placements` and re-run `--only plugins` (or `--only pages`) to change how the block is inserted without any LLM call. |
| `wp-content/plugins/faktory-<kebab>/` | plugins stage | The plugin itself (bind-mounted into WordPress). Hand-edit it, then `--only plugins` re-runs php_check and the checks. |
| `qa/<slug>.check.json` | qa stage | Written by qa, not editable |
| `qa/<slug>.{desktop,mobile}[.N].png` | qa stage | Written by qa, not editable |
| `qa/report.json` / `qa/QA-REPORT.md` | qa stage | Written by qa, not editable; delete `report.json` to force every page to be reviewed again |
| `dist/*` (`db.sql`, `wp-content.tar.gz`, `docker-compose.prod.yml`, `.env.example`, `README.md`, `MANIFEST.json`) | export stage | Written by export, rewritten every run, not editable |

### Markers for later stages
Sections whose content comes from a later stage carry an HTML-comment marker inside a `raw` node of the tree — `<!-- faktory:feature:<id> -->` for a `custom-query` section, `<!-- faktory:form:<id> -->` for `form`/`contact` sections — and that marker node sits, together with its placeholder content (the 3 example cards, or the "bientôt disponible" card), inside one wrapper `element` carrying `htmlAttributes: { "data-faktory-feature": "<id>" }` or `{ "data-faktory-form": "<id>" }`.

The markers and their wrappers **stay in `pages/<slug>.gb.json` forever** — no stage ever rewrites the tree to bake the plugin in. Substitution happens at compile time: every time Faktory compiles a page (pages stage and plugins stage alike) it replaces each `data-faktory-feature` wrapper with the `placements` markup from `plugins/<id>.json`, when that manifest exists. So the tree stays the source of truth, and regenerating or hand-editing a page never loses the plugin — and running `--only pages` after `--only plugins` re-inserts the block by itself, with no LLM call. `data-faktory-form` wrappers keep their placeholder until the content stage does the same for forms. The `blog` page gets no generated content: GeneratePress renders the posts loop there.

### Plugin contract
One feature in `site-spec.json` (`features[].id`, snake_case) = one plugin, generated by one agent from the reference plugin `fixtures/plugins/faktory-catalogue-produits/`, which the agent reads in full and adapts (same files, same conventions; only the id, the CPT, the fields, the taxonomies and the rendering change).

Naming is derived from the feature id `<id>`, never invented: `<kebab>` = `<id>` with `_` → `-`; plugin slug `faktory-<kebab>`; block `faktory/<kebab>`; shortcode `faktory_<id>`; render function `faktory_<id>_render`; meta keys `_<cpt.slug>_<field.key>`.

Required files, all under `wp-content/plugins/faktory-<kebab>/`:

```
faktory-<kebab>.php          # header, constants, requires, activation hook (registers + flushes, seeds taxonomy terms)
includes/post-type.php       # register_post_type
includes/taxonomies.php      # register_taxonomy + terms
includes/meta.php            # register_post_meta, meta box, nonce + capability, sanitize on save
includes/admin-columns.php   # list-table columns (thumbnail, fields, taxonomy) + sortable
includes/render.php          # faktory_<id>_render($atts) shared by the block and the shortcode
blocks/<kebab>/block.json    # apiVersion 3, dynamic block, editorScript index.js
blocks/<kebab>/render.php    # server render callback → faktory_<id>_render
blocks/<kebab>/index.js      # editor script, plain JS
blocks/<kebab>/index.asset.php
style.css                    # front + editor styles
uninstall.php                # WP_UNINSTALL_PLUGIN guard, deletes posts/terms/meta
```

- The render root element carries `class="faktory-<kebab> faktory-<kebab>--<view>"` **and** `data-faktory-plugin="<id>"`. Faktory fetches the published page over HTTP and fails the stage if that attribute is missing, so the attribute is what proves the block actually rendered.
- **PHP only, no build step.** `index.js` is hand-written ES5-ish JavaScript against the `wp.*` globals (`wp.blocks`, `wp.element`, `wp.blockEditor`, `wp.components`, `wp.i18n`) with `index.asset.php` declaring those dependencies — there is no npm, no webpack, no JSX in a plugin.
- The **first `image` field of the feature is the featured image** (`_thumbnail_id`), not a meta. Any further `image` field becomes an attachment-ID meta with a media-library button (`wp_enqueue_media` + `assets/media-field.js`, still no build).
- CSS uses the GeneratePress palette only (`var(--base)`, `var(--contrast)`, `var(--accent)`, …): a hex or `rgb()` colour in the plugin's CSS fails the stage.
- Security: nonce + capability check on the meta box, `sanitize_*` on save, `esc_*` on output, `WP_Query`/`get_posts` only (no raw SQL), `WP_UNINSTALL_PLUGIN` guard in `uninstall.php`.
- The agent also activates the plugin and seeds 4-6 realistic demo entries (with images, meta and terms) through WP-CLI; Faktory then checks the plugin is active, the post type is registered, there are at least 3 entries and the taxonomy terms exist, before inserting the block into the pages.
- `npm run setup-phpstan` is required: the agent's `php_check` tool runs `php -l` on every file then PHPStan level 5 with the WordPress stubs, and the stage fails explicitly (rather than silently skipping) if the toolchain is missing — `faktory doctor` reports `php`, `composer` and `phpstan`.

### Content
`content` runs after `pages`, in three sub-steps. **Forms**: one Gravity Forms form per `spec.forms[i]`, built by Faktory (field types, required flags, French submit button, an admin notification to the form's recipient with `{all_fields}`, default confirmation) and created with the Gravity Forms CLI; `content/forms.json` records form id → Gravity Forms id; the `data-faktory-form` wrapper left by the pages stage is swapped for the `gravityforms/form` block at compile time (same mechanism as plugins), the page is republished and must render `gform_wrapper_<id>`. E-mail delivery needs an SMTP configuration on the production host (the container has none). A form that already exists is never updated: to change its fields after the first run, delete it in Gravity Forms (or remove its entry from content/forms.json) and re-run. **SEO**: Yoast title, meta description and focus keyword of every sitemap page from `page.seo`, verified on the rendered `<title>`. **Articles**: one structured-output agent per `spec.blog.articles[i]` (tools: `Read` only; 500–1200 words, intro paragraph, ≥ 2 headings, inline `<strong>/<em>/<a>` only, no invented facts), saved to `content/articles/<slug>.json` — the editing surface: delete a file to regenerate that article, edit it and re-run to republish — then serialized to core Gutenberg blocks and published with category, excerpt, placeholder featured image and Yoast meta. The posts page must link every article.

### QA
`qa` runs after `content`. Faktory opens every sitemap page and every article in Playwright Chromium and records, per URL, the HTTP status, console errors and uncaught exceptions, failed same-origin requests, broken internal links, broken images and missing `alt`, GenerateBlocks classes without CSS, the `h1` count and horizontal overflow at 390 px, then screenshots desktop (1440) and mobile (390), full page plus viewport tiles. Each page that has a `pages/<slug>.gb.json` is then reviewed by one agent (tools `Read`, `Write` on `pages/`, `gb_build`) that reads the screenshots and may rewrite the tree; Faktory validates it, republishes it (placements applied, render contract checked), re-checks it and resumes the agent for a second round — 2 fix rounds at most. An invalid rewritten tree is restored and reported as a rejected fix. The stage never fails on remaining issues: it writes `qa/QA-REPORT.md` and `qa/report.json` and `export` runs anyway; it fails only on a non-200 URL, a missing browser, an agent error or the budget. A page whose tree is unchanged since the last report is not reviewed again, whatever its verdict — the previous verdict and issues are carried forward at $0.

### Export
`export` is deterministic ($0) and rewrites `dist/` every run: `db.sql` is `wp search-replace http://localhost:<port> https://SITE_URL_PLACEHOLDER --all-tables-with-prefix --export` plus a pass on the JSON-escaped form Yoast stores, verified to contain no local URL; `wp-content.tar.gz` holds plugins, themes (without the bundled `twenty*`), uploads and languages, verified to contain the parent and child themes, GenerateBlocks and every custom plugin; `docker-compose.prod.yml` + `.env.example` describe the production stack (no `WP_DEBUG`); `README.md` (French) is the restore runbook — compose up, `wp db import`, both `search-replace` forms to the real URL, Yoast reindex, rewrite flush, admin password, then SMTP, licence keys and WP Umbrella; `MANIFEST.json` records versions, pages, custom plugins, forms, articles, the QA summary, the cumulated cost and file sizes. `faktory export <slug>` is an alias of `run --only export`. The integration test restores `dist/` into a fresh stack from the exported compose file.

### Cost
The reference measurement is the [end-to-end run](#end-to-end-run): **$16.70 and 28m 45s of stage time for the whole boulangerie site** on 2026-09-13. The per-stage figures below were measured earlier, stage by stage, on the reference `boulangerie` site, partly with reuse.

`maxCostUsd` in `faktory.config.json` (default 40) caps the cumulated cost of a site; `run --max-cost <usd>` overrides it for one invocation. The SDK also receives the remaining budget as `maxBudgetUsd`. Measured on the boulangerie brief: spec ≈ $0.52 (+ ≈$0.31 for a re-sync triggered by editing `SITE-SPEC.md`), design ≈ $0.90–$1.41 per attempt, provision ≈ $0 (no LLM calls); cumulative cost through a completed provision was $4.34 (including ≈$2.3 spent on two earlier failed design attempts before the design stage was fixed to compile the preview itself). The `pages` stage cost $4.82 for the 5 generated pages (accueil, nos-produits, commandes-evenements, la-maison, contact; blog skipped), ≈$0.96 per page with 0 retries; cumulative cost after `pages` was $9.17. That $4.82 / ≈$0.96-per-page run was measured while the `gb_build`/`gb_preview` MCP tools were unavailable to the agent (it wrote the tree blind, without self-checking it); with the agent's `gb_build` self-check active, measured pages cost ≈ $1.17 per page (2 pages, $2.35). The phase 4 re-run of the same 5 pages (trees deleted, wrapper convention, `gb_build` self-check active) cost **$6.16, ≈ $1.23 per page, 0 retries**.

The `plugins` stage cost **≈ $1.44 for one feature** — measured on the boulangerie `produits` feature (CPT `produit`, 5 fields, 1 taxonomy, 2 pages): one agent, 0 retries, 12 plugin files, 5 seeded entries. Cumulative site cost went $12.43 → $18.59 after the `pages` re-run → **$20.03 after `plugins`**, against a `maxCostUsd` of 40. A reused plugin (manifest + plugin dir already there) costs $0: the stage only re-verifies and re-integrates.

The `content` stage cost **$2.06 for 5 articles** (≈ $0.41 per article, 0 retries; forms and SEO are $0) — measured on the boulangerie spec (2 Gravity Forms forms, Yoast meta on 6 pages, 5 Opus articles of 640–700 words with concurrency 3). Cumulative site cost after `content`: **$22.09** against a `maxCostUsd` of 40. A second run reuses the forms and the articles ($0).

The `qa` stage cost **$6.04 for 5 reviewed pages** (≈ $1.21 per page, 1–2 fix rounds — 3 of the 5 pages needed a second round; checks and screenshots are $0). Cumulative site cost after `qa`: $28.13. Every reviewed page ended `needs_human` (0 `ok`), and reuse at the time only applied to a page whose previous verdict was `ok`, so a second `qa` run re-reviewed all 5 pages instead of reusing them ($2.41 more, 1 round each). Cumulative site cost after both `qa` runs: $30.54. That ok-only rule was replaced during this phase by hash-keyed reuse: a page is skipped whenever its `pages/<slug>.gb.json` tree hash is unchanged since the last report, whatever its verdict. A third `qa` run against the same, still-unchanged site cost **$0.00**, with all 5 reviewed pages reused.

Every agent stage validates its output (zod + file checks) and, on failure, resumes the same session once with the validation errors before failing the stage.

`export` is $0; measured bundle on boulangerie: db.sql 2.3 MB, wp-content.tar.gz 16 MB.

## End-to-end run
Measured on 2026-09-13 (phase 7) on a fresh site, `boulangerie-e2e`, created from `fixtures/briefs/boulangerie.md` with nothing copied from the reference `boulangerie` site, the two checkpoints approved without editing `SITE-SPEC.md` or `design-system.md`, and no other intervention:

```bash
npm run faktory -- init boulangerie-e2e --brief fixtures/briefs/boulangerie.md
npm run faktory -- run boulangerie-e2e        # spec ⏸
npm run faktory -- approve boulangerie-e2e
npm run faktory -- run boulangerie-e2e        # design ⏸
npm run faktory -- approve boulangerie-e2e
npm run faktory -- run boulangerie-e2e        # provision → plugins → pages → content → qa → export
npm run faktory -- status boulangerie-e2e
```

| Stage | Cost | Duration | What it produced |
|---|---|---|---|
| spec | $0.39 | 1m 06s | 6 pages, 1 feature (`catalogue_produits`), 2 forms, 5 article briefs |
| design | $1.15 | 3m 35s | tokens (Fraunces / Figtree, sage green accent), preview |
| provision | $0.00 | 1m 17s | fresh install: WP + GP/GB/Premium/Pro/GF/Yoast, child theme, 6 pages, menu, footer element |
| plugins | $1.56 | 4m 16s | `faktory-catalogue-produits` (12 files, PHPStan ok, 5 seeded entries), 0 retries |
| pages | $5.74 | 8m 48s | 5 pages generated (≈ $1.15 per page), 0 retries; blog page left to GeneratePress |
| content | $1.93 | 3m 04s | 2 Gravity Forms forms, Yoast meta on 6 pages, 5 articles (≈ $0.39 each), 0 retries |
| qa | $5.92 | 6m 31s | 11 URLs checked, 5 pages reviewed in 1–2 rounds, 7 issues fixed, 16 left `needs_human` |
| export | $0.00 | 9s | `dist/`: db.sql 1.4 MB, wp-content.tar.gz 16 MB, compose, README, MANIFEST |
| **total** | **$16.70** | **28m 45s** | wall clock from `init` to `export` done: 29m 55s, including the two approvals |

Cost is 42 % of the default `maxCostUsd` of 40. The stage durations come from `faktory.json` (`durationMs`, approval time excluded); the provision figure is a few seconds short of a cold start because the stack was already coming up when that stage was (re)started — see the phase 7 design addendum. Three of the five QA review agents returned a verdict the validator rejected once (verdict/issue mismatch) and were resumed with the error; every retry validated, and their cost is included above.

Acceptance criteria (design, « Critères d'acceptation v1 »), checked on `http://localhost:8100` after the run: 6 pages served with GenerateBlocks inline CSS (39–98 `gb-element-` classes on the 5 generated pages, 9 on the blog page), header, footer and the primary menu on every page, the `catalogue_produits` block rendered on the home and products pages (`data-faktory-plugin`), Gravity Forms forms #1 and #2 rendered on `/commandes-evenements/` and `/contact/`, a Yoast `<title>` and meta description on every page, 5 published articles listed on `/actualites/`; `dist/` restored into a fresh stack from `dist/docker-compose.prod.yml` on another port following `dist/README.md` (both `search-replace` forms, 93 + 5 replacements) served the same home, products, contact, blog and article pages with the same block counts, the plugin block, the form and no local URL left.

What the QA report leaves to a person on this run (all 5 reviewed pages ended `needs_human`): placeholder images from placehold.co where the brief provides none (hero, map, product photos), opening hours shown as « Bientôt précisé » and a missing phone number (both unknown in the brief), the Gravity Forms submit button and fields in the plugin's default blue rather than the design system's accent, and headings rendered in the body font — Fraunces is loaded and used by a few blocks, but the design tokens are not applied to GeneratePress' global heading typography (a provision gap to fix in a later phase). One automated finding: the blog page has no `h1` (GeneratePress archive template). Phase 8a addresses the forms colors, the heading font and the blog page `h1`.

## Stages
spec ⏸ → design ⏸ → provision → plugins → pages → content → qa → export. Phase 2 implements `spec`, `design` and the spec/token-driven part of `provision` (identity, placeholder pages, primary menu, GeneratePress settings, GP Premium footer element). The header is GeneratePress' native header themed by the tokens. Phase 3 implements `pages`. Phase 4 implements `plugins`, phase 5 `content`. Phase 6a implements `qa`, phase 6b `export`: every stage of the pipeline is implemented. Phase 7 ran the whole chain on a fresh site (see « End-to-end run ») and added the per-stage cost and duration to `faktory.json` plus `faktory status`. Phase 8a styles the whole theme from the tokens (GeneratePress settings no longer fall into legacy mode, heading and body fonts are emitted, header, menu, backgrounds and links use the palette), builds the blog archive and article headers as GP Premium elements, styles Gravity Forms through the child theme, installs the fr_FR packs, lists the brief's missing facts at the top of `SITE-SPEC.md`, and adds an untranslated-strings QA check — see `docs/superpowers/specs/2026-09-14-faktory-phase8a-design.md`. Phases 8b (pipeline reliability) and 8c (delivery) are planned in `docs/superpowers/specs/2026-09-14-faktory-phase8-design.md`.

## Tests
```bash
npm test                              # unit
FAKTORY_DOCKER=1 npm run test:integration
```
