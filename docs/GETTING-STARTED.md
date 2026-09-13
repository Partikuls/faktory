# Getting started with Faktory

This guide takes you from a fresh clone to a finished WordPress site and a deliverable `dist/` bundle. You write a brief, approve two checkpoints, and Faktory does the rest.

A full run on the sample brief takes about 30 minutes and costs about $17. See the [end-to-end run](../README.md#end-to-end-run) in the README for the measured breakdown.

## 1. Install the prerequisites

You need these on your machine:

| Tool | Why | Check |
|---|---|---|
| Node.js 24 | Runs the CLI | `node --version` |
| Docker Desktop with Compose v2 | Runs WordPress, MariaDB and WP-CLI per site | `docker compose version` |
| Python 3 | Compiles GenerateBlocks page trees | `python3 --version` |
| rsync | Copies the skills into the agent plugin | `rsync --version` |
| PHP and Composer | Lint and PHPStan checks on generated plugins | `php --version`, `composer --version` |
| Claude Code, logged in | The agents reuse your Claude Code login | no `ANTHROPIC_API_KEY` needed |

You also need these four skills in `~/.claude/skills/`: `generatepress-generateblocks`, `wp-plugin-development`, `wp-block-development` and `wp-wpcli-and-ops`.

## 2. Set up the repository

Run these once, from the repository root:

```bash
npm install
npm run sync-skills        # copies the four skills into plugin/skills/
npm run setup-phpstan      # installs PHPStan into tools/phpstan/
npm run setup-playwright   # downloads Chromium for the qa stage
```

Then add the premium plugin zips to `docker/vendor/`. The folder is gitignored and names are matched by prefix, so versioned file names work:

```
docker/vendor/gp-premium-2.5.6.zip
docker/vendor/generateblocks-pro-2.7.1.zip
docker/vendor/gravityforms_3.1.1.2.zip
docker/vendor/gravityformscli_1.7.zip
```

Provision still runs without them, but the site loses pieces. Without GP Premium there is no footer. Without Gravity Forms and its CLI add-on, the content stage cannot create the forms.

Check everything:

```bash
npm run faktory -- doctor          # toolchain, skills, Chromium, vendor zips
npm run faktory -- doctor --agent  # also proves the agent can load skills and reach WP-CLI (about $0.10–0.20)
```

Every line should show ✔. A line with ℹ is optional.

## 3. Write a brief

The brief is a plain Markdown file in French. It describes who the client is, what the site is for, the pages, the features, the forms, the visual identity and the constraints. Start from the sample:

```bash
cp fixtures/briefs/boulangerie.md my-brief.md
```

Give the facts you know. The agents never invent them, so anything missing ends up as a placeholder on the site. Opening hours, phone number, full address and photos are the usual gaps.

## 4. Create the site

```bash
npm run faktory -- init my-site --brief my-brief.md
```

The slug uses lowercase letters, digits and dashes. Faktory creates `sites/my-site/`, copies the brief, picks a free port starting at 8100 and generates an admin password. Both are stored in `sites/my-site/faktory.json`.

## 5. Generate and approve the spec

```bash
npm run faktory -- run my-site
```

The spec stage reads the brief and stops at the first checkpoint. It takes about a minute and costs under $1.

Open `sites/my-site/SITE-SPEC.md` and review it: sitemap, page sections, custom features, forms, blog articles and menus. Edit the Markdown directly if something is wrong. Then approve:

```bash
npm run faktory -- approve my-site
```

If you edited the Markdown, `approve` re-extracts `site-spec.json` from it.

## 6. Generate and approve the design

```bash
npm run faktory -- run my-site
```

The design stage stops at the second checkpoint. It takes about 4 minutes and costs about $1.

Open `sites/my-site/preview.html` in a browser to see the palette, fonts and components. Edit `sites/my-site/design-system.md` if needed, including its tokens section. Then approve:

```bash
npm run faktory -- approve my-site
```

If you edited the Markdown, `approve` re-extracts `design-tokens.json` and re-renders the preview.

## 7. Build the site

```bash
npm run faktory -- run my-site
```

There are no more checkpoints. This single command runs the remaining stages in order:

| Stage | What it does |
|---|---|
| provision | Starts the Docker stack, installs WordPress in French, the theme and plugins, creates the pages, menu and footer, applies the design tokens |
| plugins | One agent per custom feature writes, checks, activates and seeds a WordPress plugin |
| pages | One agent per page builds it with GenerateBlocks, home first, then three in parallel |
| content | Creates the Gravity Forms forms, sets the Yoast SEO fields, writes and publishes the articles |
| qa | Checks every URL in Chromium, takes screenshots, lets an agent fix each page in up to two rounds |
| export | Writes the deliverable bundle to `sites/my-site/dist/` |

This part takes about 25 minutes. Keep the terminal open, or run it detached with a log file:

```bash
nohup npm run faktory -- run my-site > my-site.log 2>&1 &
tail -f my-site.log
```

Each stage prints ▶ when it starts and ✔ with a summary when it ends.

## 8. Follow progress and cost

```bash
npm run faktory -- status my-site
```

This prints one row per stage with its status, cost, duration and last message, then the totals. It needs neither Docker nor an agent and costs nothing.

## 9. Review the result

The site runs at `http://localhost:<port>/`. The port is shown by `status`. The admin is at `http://localhost:<port>/wp-admin/` with user `admin` and the password from `sites/my-site/faktory.json`.

Then read the QA report:

```bash
open sites/my-site/qa/QA-REPORT.md
```

It lists, for every URL, the automated checks, the review verdict, what the agent fixed and what it left for a person. Screenshots are next to it in `sites/my-site/qa/`. Pages marked "à revoir" need a human look. That is normal and does not stop the export.

## 10. Deliver the bundle

`sites/my-site/dist/` contains everything needed to put the site online:

| File | Content |
|---|---|
| `db.sql` | The database, with the site URL replaced by `https://SITE_URL_PLACEHOLDER` |
| `wp-content.tar.gz` | Themes, plugins, uploads and translations |
| `docker-compose.prod.yml` and `.env.example` | The production stack |
| `README.md` | The restore runbook, in French |
| `MANIFEST.json` | Versions, pages, custom plugins, forms, articles, QA summary and cost |

Follow `dist/README.md` on the target server. It covers the restore, the URL replacement, the new admin password, and what to set up afterwards: SMTP for form emails, licence keys and monitoring. `db.sql` holds the admin password hash, so share the bundle through a private channel only.

To rebuild only the bundle later, at no cost:

```bash
npm run faktory -- export my-site
```

## Change something and re-run

Every stage can run on its own with `--only`. Most stages reuse what already exists, so a re-run only pays for what you deleted or changed.

| You want to | Do this |
|---|---|
| Change a page by hand | Edit `pages/<slug>.gb.json`, then `run my-site --only pages`. No agent runs. |
| Regenerate one page | Delete `pages/<slug>.gb.json`, then `run my-site --only pages` |
| Regenerate a plugin | Delete `plugins/<id>.json`, then `run my-site --only plugins` |
| Regenerate an article | Delete `content/articles/<slug>.json`, then `run my-site --only content` |
| Review every page again | Delete `qa/report.json`, then `run my-site --only qa` |
| Apply spec or design edits made after approval | `resync my-site` |
| Resume after a failure | Fix the cause, then `run my-site`. It restarts at the failed stage. |
| Restart from a given stage | `run my-site --from pages` |

Regenerating the spec or the design with `--only spec` or `--only design` overwrites your Markdown edits.

## Troubleshooting

| Message | Meaning and fix |
|---|---|
| `Stage spec awaits approval` | A checkpoint is waiting. Review the artifact, then run `approve`. |
| `Cost budget reached` | The site reached `maxCostUsd`, which defaults to $40 in `faktory.config.json`. Raise it, or pass `--max-cost 60` for one run. |
| `⚠ SITE-SPEC.md is newer than site-spec.json` | You edited the Markdown after approval. Run `resync` to apply the edit. |
| A stage shows `failed` in `status` | Its message holds the error. Fix the cause and run again. |
| The site does not respond | Check the containers with `docker ps`. `run my-site --only provision` starts the stack again. |

To delete a site completely, containers, volumes and workspace included:

```bash
npm run faktory -- destroy my-site
```
