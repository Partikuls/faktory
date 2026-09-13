# Faktory

WordPress AI software factory: `brief.md` in, GeneratePress/GenerateBlocks site out.

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
npm run faktory -- run boulangerie          # provision (WP + GP stack, identity, menu, tokens, footer) then pages (one agent per page, home first, then 3 in parallel): neither is a checkpoint, so one `run` does both
npm run faktory -- run boulangerie --only design --max-cost 10
npm run faktory -- approve boulangerie --max-cost 10
npm run faktory -- run boulangerie --only pages --max-cost 15
npm run faktory -- run boulangerie --only plugins --max-cost 30   # one agent per feature: writes wp-content/plugins/faktory-<id>/, php_check, activates, seeds, then inserts the block into the pages
npm run faktory -- run boulangerie --only qa --max-cost 10   # browser checks + screenshots of every url, one review agent per generated page (≤ 2 fix rounds), qa/QA-REPORT.md
npm run faktory -- resync boulangerie       # re-syncs any checkpoint JSON whose .md you edited after approve (also --max-cost)
npm run faktory -- destroy boulangerie
npm run faktory -- doctor --agent
```
Sites live in `sites/<slug>/` (gitignored). `faktory.json` holds stage status, port, admin credentials and cumulated cost.
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
`qa` runs after `content`. Faktory opens every sitemap page and every article in Playwright Chromium and records, per URL, the HTTP status, console errors and uncaught exceptions, failed same-origin requests, broken internal links, broken images and missing `alt`, GenerateBlocks classes without CSS, the `h1` count and horizontal overflow at 390 px, then screenshots desktop (1440) and mobile (390), full page plus viewport tiles. Each page that has a `pages/<slug>.gb.json` is then reviewed by one agent (tools `Read`, `Write` on `pages/`, `gb_build`) that reads the screenshots and may rewrite the tree; Faktory validates it, republishes it (placements applied, render contract checked), re-checks it and resumes the agent for a second round — 2 fix rounds at most. An invalid rewritten tree is restored and reported as a rejected fix. The stage never fails on remaining issues: it writes `qa/QA-REPORT.md` and `qa/report.json` and `export` runs anyway; it fails only on a non-200 URL, a missing browser, an agent error or the budget. A page whose tree is unchanged and was `ok` is not reviewed again ($0).

### Cost
`maxCostUsd` in `faktory.config.json` (default 40) caps the cumulated cost of a site; `run --max-cost <usd>` overrides it for one invocation. The SDK also receives the remaining budget as `maxBudgetUsd`. Measured on the boulangerie brief: spec ≈ $0.52 (+ ≈$0.31 for a re-sync triggered by editing `SITE-SPEC.md`), design ≈ $0.90–$1.41 per attempt, provision ≈ $0 (no LLM calls); cumulative cost through a completed provision was $4.34 (including ≈$2.3 spent on two earlier failed design attempts before the design stage was fixed to compile the preview itself). The `pages` stage cost $4.82 for the 5 generated pages (accueil, nos-produits, commandes-evenements, la-maison, contact; blog skipped), ≈$0.96 per page with 0 retries; cumulative cost after `pages` was $9.17. That $4.82 / ≈$0.96-per-page run was measured while the `gb_build`/`gb_preview` MCP tools were unavailable to the agent (it wrote the tree blind, without self-checking it); with the agent's `gb_build` self-check active, measured pages cost ≈ $1.17 per page (2 pages, $2.35). The phase 4 re-run of the same 5 pages (trees deleted, wrapper convention, `gb_build` self-check active) cost **$6.16, ≈ $1.23 per page, 0 retries**.

The `plugins` stage cost **≈ $1.44 for one feature** — measured on the boulangerie `produits` feature (CPT `produit`, 5 fields, 1 taxonomy, 2 pages): one agent, 0 retries, 12 plugin files, 5 seeded entries. Cumulative site cost went $12.43 → $18.59 after the `pages` re-run → **$20.03 after `plugins`**, against a `maxCostUsd` of 40. A reused plugin (manifest + plugin dir already there) costs $0: the stage only re-verifies and re-integrates.

The `content` stage cost **$2.06 for 5 articles** (≈ $0.41 per article, 0 retries; forms and SEO are $0) — measured on the boulangerie spec (2 Gravity Forms forms, Yoast meta on 6 pages, 5 Opus articles of 640–700 words with concurrency 3). Cumulative site cost after `content`: **$22.09** against a `maxCostUsd` of 40. A second run reuses the forms and the articles ($0).

The `qa` stage cost **$6.04 for 5 reviewed pages** (≈ $1.21 per page, 1–2 fix rounds — 3 of the 5 pages needed a second round; checks and screenshots are $0). Cumulative site cost after `qa`: $28.13. Every reviewed page ended `needs_human` (0 `ok`), so a second `qa` run re-reviewed all 5 pages instead of reusing them ($2.41 more, 1 round each): reuse only applies to a page whose previous verdict was `ok`, not `fixed` or `needs_human`. Cumulative site cost after both `qa` runs: $30.54.

Every agent stage validates its output (zod + file checks) and, on failure, resumes the same session once with the validation errors before failing the stage.

## Stages
spec ⏸ → design ⏸ → provision → plugins → pages → content → qa → export. Phase 2 implements `spec`, `design` and the spec/token-driven part of `provision` (identity, placeholder pages, primary menu, GeneratePress settings, GP Premium footer element). The header is GeneratePress' native header themed by the tokens. Phase 3 implements `pages`. Phase 4 implements `plugins`, phase 5 `content`, phase 6a `qa`. Only `export` is still marked "skipped (not implemented)".

## Tests
```bash
npm test                              # unit
FAKTORY_DOCKER=1 npm run test:integration
```
