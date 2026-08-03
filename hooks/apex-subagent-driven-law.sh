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
# Subagent detection uses a marker-file mutex:
#   .blade-editing — created by Apex before spawning Blades, removed after.
#   When .blade-editing exists, edits are allowed (a Blade is working).
#   When it doesn't exist, edits are BLOCKED (Apex is trying to edit directly).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../scripts/lib/phantom-paths.sh"

# Session activity is read from the per-repo current-session pointer that
# phantom-state.mjs already writes on start and clears on complete, rather than a
# separate global flag. A single global sentinel cannot express "a session is
# active in repo A but not repo B", so it blocks Apex edits in every repository at
# once the moment any one session starts -- and concurrent sessions across repos
# are the normal case here. Reusing the pointer also removes a second source of
# truth that could disagree with real session state.
SENTINEL="$PHANTOM_STATE_DIR/current-session/$(phantom_detect_repo 2>/dev/null).json"
LEGACY_SENTINEL="$PHANTOM_DATA/.apex-active"
# One marker file per live Blade rather than a single shared flag: with parallel
# Blades a shared flag is cleared by the first subagent to stop, which silently
# reopens the gate while its siblings are still editing. "A Blade is editing"
# means this directory is non-empty.
# Scoped per repository, matching the sentinel. A global marker directory means a
# Blade running in repository A reports "a Blade is editing" for repository B, which
# lets Apex edit B directly and defeats the isolation the per-repo sentinel adds.
BLADE_MARKER_DIR="$PHANTOM_DATA/.blade-editing.d/$(phantom_detect_repo 2>/dev/null)"
BLADE_MARKER="$PHANTOM_DATA/.blade-editing"
AUDIT_DIR="$PHANTOM_AUDIT_DIR"
AUDIT_LOG="$AUDIT_DIR/apex-edits-$(date +%Y-%m-%d).jsonl"
# SHARED SEMANTICS -- keep identical in hooks/routing-gate.js: a session is
# active when the sentinel exists AND is younger than this. A marker left behind
# by a crashed session must never disable tools permanently; the recovery for an
# undiscoverable hidden file is not something a user can be expected to find.
MARKER_MAX_AGE_SECONDS=$((24 * 60 * 60))

# Portable mtime in epoch seconds. GNU and BSD stat disagree on flags, and chaining
# them with `||` is not enough: on GNU, `-f` is --file-system, so `stat -f %m` exits
# 0 while printing something that is not a timestamp, and the fallback never runs.
# The result is then non-numeric, every freshness test fails, and the hook goes
# silently inert on Linux. So validate the output rather than trusting exit status.
phantom__mtime_epoch() {
  local value
  value=$(stat -c %Y "$1" 2>/dev/null)
  case "$value" in ''|*[!0-9]*) value=$(stat -f %m "$1" 2>/dev/null) ;; esac
  case "$value" in ''|*[!0-9]*) value=0 ;; esac
  printf '%s\n' "$value"
}

phantom__fresh() {
  [ -e "$1" ] || return 1
  local mtime age
  mtime=$(phantom__mtime_epoch "$1")
  [ "$mtime" -gt 0 ] 2>/dev/null || return 1
  age=$(( $(date +%s) - mtime ))
  [ "$age" -lt "$MARKER_MAX_AGE_SECONDS" ]
}

# Completing a session rewrites its pointer with status "completed" AND a fresh
# updated_at, so recency alone reports a finished session as live and would block
# direct edits for a further 24h after the work was done. Status decides liveness;
# age only bounds the damage from a session that crashed without completing.
phantom__pointer_completed() {
  [ -f "$1" ] || return 1
  grep -q '"status"[[:space:]]*:[[:space:]]*"completed"' "$1" 2>/dev/null
}

phantom__session_live() {
  phantom__fresh "$1" || return 1
  ! phantom__pointer_completed "$1"
}

# Only act when a session is active for THIS repository and not stale. The legacy
# global flag is still honored so a 0.2.x session already in flight keeps its
# discipline through the upgrade instead of silently losing it mid-run.
phantom__session_live "$SENTINEL" || phantom__fresh "$LEGACY_SENTINEL" || exit 0

# Reap Blade markers whose subagent died without a SubagentStop. Without this the
# directory stays non-empty forever and the law stops enforcing silently, which is
# worse than blocking: it looks enforced and is not.
if [ -d "$BLADE_MARKER_DIR" ]; then
  find "$BLADE_MARKER_DIR" -type f -mmin "+$((MARKER_MAX_AGE_SECONDS / 60))" -delete 2>/dev/null || true
fi

blade_active() {
  # Legacy single-flag form stays honored so an in-flight 0.2.x session and a
  # partially upgraded install do not lose their mutex mid-run.
  phantom__fresh "$BLADE_MARKER" && return 0
  [ -d "$BLADE_MARKER_DIR" ] || return 1
  find "$BLADE_MARKER_DIR" -type f -print -quit 2>/dev/null | read -r _
}

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

# A live Blade is editing = allow
if blade_active; then
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
Apex must not edit files directly during a Phantom session.

  Tool: $TOOL_NAME
  File: $FILE_PATH

Spawn a Blade through the Agent tool and let it make this edit. Apex
orchestrates and reviews; implementation belongs to a subagent, so Apex
holds the expensive tier for decomposition while Blades run cheaper.

The Blade marker is managed for you: it is created when a subagent is
spawned and cleared when it stops. There is nothing to touch by hand.

Apex may still write orchestration artifacts directly (sessions,
planning, contracts, decisions, learnings, plans, roadmaps, memory).

If a crashed session is blocking you, this sentinel expires by itself
after 24h, or remove it now:
  rm -f $SENTINEL
EOF
exit 2
