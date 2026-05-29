#!/usr/bin/env bash
# apex-subagent-driven-law.sh
# Enforces Core Discipline #13: subagent-driven development.
#
# Apex (top-level orchestrator) MUST NOT call Edit/Write/MultiEdit/NotebookEdit
# directly. All implementation must go through the Agent tool (spawned subagents).
#
# Active during phantom sessions only — controlled by sentinel at
# ~/.claude/phantom/.apex-active (written by /phantom:start, removed by /phantom:wrap).
#
# Subagent detection uses a marker-file mutex:
#   .blade-editing — created by Apex before spawning Blades, removed after.
#   When .blade-editing exists, edits are allowed (a Blade is working).
#   When it doesn't exist, edits are BLOCKED (Apex is trying to edit directly).

set -euo pipefail

SENTINEL="$HOME/.claude/phantom/.apex-active"
BLADE_MARKER="$HOME/.claude/phantom/.blade-editing"
AUDIT_DIR="$HOME/.claude/phantom/audit"
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

# Blade marker present = subagent is editing = allow
if [ -f "$BLADE_MARKER" ]; then
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
goes through subagents — even 1-line typo fixes.

Before spawning: touch ~/.claude/phantom/.blade-editing
After completion: rm -f ~/.claude/phantom/.blade-editing
EOF
exit 2
