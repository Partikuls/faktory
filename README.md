# Faktory

WordPress AI software factory: `brief.md` in, GeneratePress/GenerateBlocks site out.

## Setup
```bash
npm install
npm run sync-skills                 # copies GP/GB + WP skills from ~/.claude/skills into plugin/skills
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
npm run faktory -- run boulangerie          # provision: WP + GP stack, identity, pages, menu, tokens, footer
npm run faktory -- run boulangerie --only design --max-cost 10
npm run faktory -- approve boulangerie --max-cost 10
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

### Cost
`maxCostUsd` in `faktory.config.json` (default 40) caps the cumulated cost of a site; `run --max-cost <usd>` overrides it for one invocation. The SDK also receives the remaining budget as `maxBudgetUsd`. Measured on the boulangerie brief: spec ≈ $0.52 (+ ≈$0.31 for a re-sync triggered by editing `SITE-SPEC.md`), design ≈ $0.90–$1.41 per attempt, provision ≈ $0 (no LLM calls); cumulative cost through a completed provision was $4.34 (including ≈$2.3 spent on two earlier failed design attempts before the design stage was fixed to compile the preview itself).

## Stages
spec ⏸ → design ⏸ → provision → plugins → pages → content → qa → export. Phase 2 implements `spec`, `design` and the spec/token-driven part of `provision` (identity, placeholder pages, primary menu, GeneratePress settings, GP Premium footer element). The header is GeneratePress' native header themed by the tokens. Other stages are marked "skipped (not implemented)".

## Tests
```bash
npm test                              # unit
FAKTORY_DOCKER=1 npm run test:integration
```
