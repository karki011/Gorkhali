#!/bin/bash
# feature-branch-gate.sh — PreToolUse hook
# Blocks Edit/Write on source files when on main/master/develop
# Iron Law #1: Feature branch enforcement
# Author: Subash Karki

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
BRANCH=$(git branch --show-current 2>/dev/null)
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" || "$BRANCH" == "develop" ]]; then
  echo "BLOCKED: Cannot edit source files on $BRANCH branch."
  echo "Create a feature branch first: git checkout -b {ticket}/{slug}"
  exit 1
fi

exit 0
