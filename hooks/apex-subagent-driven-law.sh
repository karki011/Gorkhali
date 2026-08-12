#!/usr/bin/env bash
# apex-subagent-driven-law.sh
# Enforces Core Discipline #13: subagent-driven development.
#
# Apex (top-level orchestrator) MUST NOT call Edit/Write/MultiEdit/NotebookEdit
# directly. All implementation must go through the Agent tool (spawned subagents).
#
# Active during phantom sessions only — controlled by sentinel at
# $PHANTOM_DATA/.apex-active (written by /phantom:start, removed by /phantom:wrap).
#
# Subagent detection uses one marker per live editing agent, created only by the
# SubagentStart hook and cleared by SubagentStop. Markers are scoped to both the
# current repository and session. A fresh legacy .blade-editing marker remains
# accepted during upgrades.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../scripts/lib/phantom-paths.sh"

SENTINEL="$PHANTOM_DATA/.apex-active"
AUDIT_DIR="$PHANTOM_AUDIT_DIR"
AUDIT_LOG="$AUDIT_DIR/apex-edits-$(date +%Y-%m-%d).jsonl"

# Only act when a phantom session is active
[ -f "$SENTINEL" ] || exit 0

# Read hook input (Claude Code passes JSON on stdin)
INPUT=$(cat)

# Extract fields
if command -v jq >/dev/null 2>&1; then
  TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')
  SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
  TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // ""')
else
  TOOL_NAME="unknown"
  FILE_PATH=""
  SESSION_ID=""
  TRANSCRIPT=""
fi

# Orchestration artifacts — Apex is allowed to write these directly
case "$FILE_PATH" in
  */sessions/*|*/.planning/*|*/contracts/*|*/decisions/*|*/learnings/*|*/audit/*|*/intent.md|*/plan.md|*/PLAN.md|*/ROADMAP.md|*MEMORY.md|*/.claude/*)
    exit 0
    ;;
esac

mkdir -p "$AUDIT_DIR"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# A fresh legacy marker or a live marker for this exact repo and session allows edits.
if printf '%s' "$INPUT" | node "$SCRIPT_DIR/blade-marker-state.js" active \
  || printf '%s' "$INPUT" | node "$SCRIPT_DIR/blade-marker-state.js" legacy; then
  printf '{"ts":"%s","tool":"%s","file":"%s","session":"%s","source":"blade"}\n' \
    "$TIMESTAMP" "$TOOL_NAME" "$FILE_PATH" "$SESSION_ID" \
    >> "$AUDIT_LOG"
  exit 0
fi

# No blade marker = Apex trying to edit directly = BLOCK
printf '{"ts":"%s","tool":"%s","file":"%s","session":"%s","source":"apex-blocked"}\n' \
  "$TIMESTAMP" "$TOOL_NAME" "$FILE_PATH" "$SESSION_ID" \
  >> "$AUDIT_LOG"

cat >&2 <<EOF
CORE DISCIPLINE #13 VIOLATION — Apex must not edit files directly.

  Tool: $TOOL_NAME
  File: $FILE_PATH

Spawn a Blade agent via the Agent tool instead. All implementation
goes through subagents — even 1-line typo fixes. Editing markers are
managed automatically by SubagentStart and SubagentStop hooks.
EOF
exit 2
