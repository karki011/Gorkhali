#!/usr/bin/env bash
# apex-subagent-driven-law.sh
# Enforces Iron Law #13: subagent-driven development.
#
# Apex (top-level orchestrator) MUST NOT call Edit/Write/MultiEdit/NotebookEdit
# directly. All implementation must go through the Agent tool (spawned subagents).
#
# Active during phantom sessions only — controlled by ward file at
# ~/.claude/team/.apex-active (written by /phantom:start, removed by /phantom:wrap).
#
# Two enforcement modes:
#   OPTION C (ACTIVE):     Audit log — records violations to JSONL, allows tool
#   OPTION A (COMMENTED):  Hard block — exits 2 to prevent the edit
#
# To upgrade from C → A: uncomment the OPTION A block at the bottom.

set -euo pipefail

SENTINEL="$HOME/.claude/team/.apex-active"
AUDIT_DIR="$HOME/.claude/team/audit"
AUDIT_LOG="$AUDIT_DIR/apex-edits-$(date +%Y-%m-%d).jsonl"

# Only act when a phantom session is active
[ -f "$SENTINEL" ] || exit 0

# Read hook input (Claude Code passes JSON on stdin)
INPUT=$(cat)

# Extract fields (jq with safe fallbacks)
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
# (intent.md, decisions.md, contracts, learnings, plan files, etc.)
case "$FILE_PATH" in
  */sessions/*|*/.planning/*|*/contracts/*|*/decisions/*|*/learnings/*|*/audit/*|*/intent.md|*/plan.md|*/PLAN.md|*/ROADMAP.md|*MEMORY.md)
    exit 0
    ;;
esac

mkdir -p "$AUDIT_DIR"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# --- OPTION C: AUDIT LOG (ACTIVE) ---
# Records every direct edit during a apex-active session for later review.
# Wrap analyzes this log and reports violations.
printf '{"ts":"%s","tool":"%s","file":"%s","session":"%s","transcript":"%s"}\n' \
  "$TIMESTAMP" "$TOOL_NAME" "$FILE_PATH" "$SESSION_ID" "$TRANSCRIPT" \
  >> "$AUDIT_LOG"

exit 0

# --- OPTION A: HARD BLOCK (COMMENTED OUT) ---
# Uncomment the block below AND remove the `exit 0` above to activate.
# This enforces the law mechanically — Apex literally cannot edit files.
#
# Subagent detection: Claude Code does not currently expose a reliable
# "am I a subagent" signal in hook input. Best-effort approach below uses
# env vars that *may* be set during subagent execution. Verify on your
# system before enabling — false positives will block legitimate Blade edits.
#
# if [ -z "${CLAUDE_AGENT_TYPE:-}" ] && [ -z "${CLAUDE_SUBAGENT:-}" ] && [ -z "${CLAUDE_CODE_SUBAGENT:-}" ]; then
#   cat >&2 <<EOF
# IRON LAW #13 VIOLATION — Apex must not edit files directly.
#
#   Tool: $TOOL_NAME
#   File: $FILE_PATH
#
# Spawn a Blade agent via the Agent tool instead. All implementation goes
# through subagents — even 1-line typo fixes.
#
# See: ~/.claude/team/commands/_shared.md (Iron Law #13)
#      ~/.claude/team/agents/apex.md   (Iron Law #2)
# EOF
#   exit 2
# fi
#
# # Subagent confirmed — allow the edit but still log it for audit
# printf '{"ts":"%s","tool":"%s","file":"%s","session":"%s","subagent":true}\n' \
#   "$TIMESTAMP" "$TOOL_NAME" "$FILE_PATH" "$SESSION_ID" \
#   >> "$AUDIT_LOG"
# exit 0
