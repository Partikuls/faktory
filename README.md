# Faktory

WordPress AI software factory: `brief.md` in, GeneratePress/GenerateBlocks site out.

## Setup
```bash
npm install
npm run sync-skills                 # copies GP/GB + WP skills from ~/.claude/skills into plugin/skills
cp docker/.env.example docker/.env  # optional license keys (not used yet — phase 2)
# drop gp-premium*.zip, generateblocks-pro*.zip, gravityforms*.zip, gravityformscli*.zip into docker/vendor/
npm run faktory -- doctor           # add --agent to verify skill loading with a real query
# no ANTHROPIC_API_KEY needed: the SDK reuses your Claude Code login (doctor --agent proves it, ~$0.10-0.20)
```

`docker/vendor/` zips are optional; without them `provision` still runs and reports "missing vendor zips" instead of failing.

## Usage
```bash
npm run faktory -- init boulangerie --brief fixtures/briefs/boulangerie.md
npm run faktory -- run boulangerie          # runs from the first incomplete stage; stops at checkpoints
npm run faktory -- approve boulangerie      # after editing SITE-SPEC.md / design-system.md
npm run faktory -- run boulangerie --only provision
npm run faktory -- destroy boulangerie
npm run faktory -- doctor --agent      # smoke test: lists the 4 plugin skills and calls the wp tool
```
Sites live in `sites/<slug>/` (gitignored). `faktory.json` holds stage status, port, admin credentials and cost.
Site URL: `http://localhost:<port>` (ports start at 8100). Admin: `admin` / password in `faktory.json`.

## Stages
spec ⏸ → design ⏸ → provision → plugins → pages → content → qa → export. Phase 1 implements `provision`; other stages are marked "skipped (not implemented)".

## Tests
```bash
npm test                              # unit
FAKTORY_DOCKER=1 npm run test:integration
```
