#!/bin/bash
# feature-branch-gate.sh — PreToolUse hook
# Blocks Edit/Write on source files when on a default/protected branch.
# Protected set = auto-detected origin/HEAD ∪ configured list
# (PHANTOM_PROTECTED_BRANCHES env > git.protected_branches in config.yaml > main master develop).
# Core Discipline #1: Feature branch enforcement
# Author: Subash Karki

# Emits git.protected_branches from config.yaml (inline [a, b] or "- item" list), empty if absent.
phantom_config_protected() {
  local cfg="${PHANTOM_DATA:-$HOME/.claude/phantom-data}/config.yaml"
  [ -f "$cfg" ] || return 0
  local section inline
  section=$(sed -n '/^git:/,/^[a-z_][a-z_-]*:/{/^git:/d;/^[a-z_][a-z_-]*:/d;p;}' "$cfg") || true
  [ -n "$section" ] || return 0
  inline=$(echo "$section" | grep -m1 'protected_branches:[[:space:]]*\[') || true
  if [ -n "$inline" ]; then
    echo "$inline" | sed 's/.*\[//;s/\].*//;s/,/ /g;s/["'"'"']//g'
    return 0
  fi
  if echo "$section" | grep -q 'protected_branches:[[:space:]]*$'; then
    echo "$section" \
      | sed -n '/protected_branches:[[:space:]]*$/,/^[[:space:]]*[a-z_]/{s/^[[:space:]]*-[[:space:]]*//p;}' \
      | sed 's/["'"'"']//g;s/[[:space:]]*#.*//' | tr '\n' ' '
  fi
}

# Configured protected list: env var > config.yaml > default.
phantom_protected_branches() {
  local configured=""
  if [ -n "${PHANTOM_PROTECTED_BRANCHES:-}" ]; then
    configured=$(echo "$PHANTOM_PROTECTED_BRANCHES" | tr ',' ' ')
  else
    configured=$(phantom_config_protected) || true
  fi
  if [ -n "${configured// /}" ]; then
    echo "$configured"
  else
    echo "main master develop"
  fi
}

# Test seam: source with PHANTOM_GATE_SOURCE_ONLY=1 to load functions only.
if [ "${PHANTOM_GATE_SOURCE_ONLY:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

TOOL_NAME=$(echo "$1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)
FILE_PATH=$(echo "$1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)

# Only gate Edit and Write tools
if [[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" ]]; then
  exit 0
fi

# Skip non-source files (allow editing configs, docs, learnings, state, skills)
case "$FILE_PATH" in
  */.claude/*|*/CLAUDE.md|*/.planning/*|*/state/*|*/learnings/*|*/sessions/*|*/reference/*|*/commands/*|*/agents/*|*/hooks/*|*/docs/*)
    exit 0
    ;;
esac

# Check current branch
BRANCH=$(git branch --show-current 2>/dev/null) || true
[ -n "$BRANCH" ] || exit 0

# Auto-detected default branch (fail-open: empty if origin/HEAD unset).
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@') || true

for PROTECTED in $DEFAULT_BRANCH $(phantom_protected_branches); do
  if [[ "$BRANCH" == "$PROTECTED" ]]; then
    echo "BLOCKED: Cannot edit source files on $BRANCH branch."
    echo "Create a feature branch first: git checkout -b {ticket}/{slug}"
    exit 1
  fi
done

exit 0
