#!/bin/bash
# Author: Subash Karki
# Warn-only hook: flags skill/reference files that exceed line caps.
# Does NOT block — just surfaces the issue so /phantom:evolve can address it.

PHANTOM_DIR="${PHANTOM_DIR:-$HOME/.claude/phantom}"
COMMANDS_CAP=80
REFERENCE_CAP=100
AGENTS_CAP=80
WARNINGS=0

check_dir() {
  local dir="$1" cap="$2" label="$3"
  [ -d "$dir" ] || return
  for f in "$dir"/*.md; do
    [ -f "$f" ] || continue
    lines=$(wc -l < "$f" | tr -d ' ')
    if [ "$lines" -gt "$cap" ]; then
      name=$(basename "$f")
      echo "SIZE_WARN: $label/$name = ${lines} lines (cap: ${cap})"
      WARNINGS=$((WARNINGS + 1))
    fi
  done
}

check_dir "$PHANTOM_DIR/commands" "$COMMANDS_CAP" "commands"
check_dir "$PHANTOM_DIR/reference" "$REFERENCE_CAP" "reference"
check_dir "$PHANTOM_DIR/agents" "$AGENTS_CAP" "agents"

if [ "$WARNINGS" -gt 0 ]; then
  echo "---"
  echo "$WARNINGS file(s) over cap. Run /phantom:evolve to distill."
fi
