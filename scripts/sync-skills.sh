#!/usr/bin/env bash
# Copy the skills Faktory needs from the user's Claude skills dir into plugin/skills/.
# Copies (not symlinks) so the Agent SDK plugin loader sees plain directories.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SKILLS_SRC:-$HOME/.claude/skills}"
DEST="${SKILLS_DEST:-$ROOT/plugin/skills}"
SKILLS=(generatepress-generateblocks wp-plugin-development wp-block-development wp-wpcli-and-ops)

missing=()
for s in "${SKILLS[@]}"; do
  [ -f "$SRC/$s/SKILL.md" ] || missing+=("$s")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "sync-skills: missing in $SRC: ${missing[*]}" >&2
  exit 1
fi

mkdir -p "$DEST"
for s in "${SKILLS[@]}"; do
  rsync -a --delete --exclude 'evals/' --exclude '.git/' "$SRC/$s/" "$DEST/$s/"
  echo "synced $s"
done
