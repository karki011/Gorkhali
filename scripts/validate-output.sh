#!/bin/bash
# =============================================================================
# Straw Hat Crew — Agent Output Validator (Layer 3)
# Author: Subash Karki
#
# Validates agent output after completion:
#   - Agent only touched files it owned
#   - New .ts/.tsx files have copyright headers
#   - No inline hex/px values (should use design tokens)
#   - Barrel exports updated for new files
#
# Usage: validate-output.sh <agent-name> <owned-files-csv> [project-root]
# Example: validate-output.sh nami "libs/ui/connections/src/Form.tsx,libs/ui/connections/src/List.tsx"
# =============================================================================

AGENT_NAME="${1}"
OWNED_FILES="${2}"
PROJECT_ROOT="${3:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

if [ -z "$AGENT_NAME" ]; then
  echo "Usage: validate-output.sh <agent-name> <owned-files-csv> [project-root]"
  exit 1
fi

WARNS=""
BLOCKS=""
PASSES=""

add_block() { BLOCKS="${BLOCKS}\n  BLOCK: $1"; }
add_warn()  { WARNS="${WARNS}\n  WARN:  $1"; }
add_pass()  { PASSES="${PASSES}\n  PASS:  $1"; }

# ─── 1. Check file ownership ───
# Get files changed since last commit (unstaged + staged)
CHANGED_FILES=$(cd "$PROJECT_ROOT" && git diff --name-only HEAD 2>/dev/null)
STAGED_FILES=$(cd "$PROJECT_ROOT" && git diff --name-only --cached 2>/dev/null)
ALL_CHANGED=$(echo -e "${CHANGED_FILES}\n${STAGED_FILES}" | sort -u | grep -v '^$')

if [ -n "$OWNED_FILES" ] && [ "$OWNED_FILES" != "-" ]; then
  IFS=',' read -ra OWNED_ARRAY <<< "$OWNED_FILES"
  UNAUTHORIZED=""
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    AUTHORIZED=false
    for owned in "${OWNED_ARRAY[@]}"; do
      owned=$(echo "$owned" | xargs) # trim
      if [[ "$file" == *"$owned"* ]] || [[ "$owned" == *"$file"* ]]; then
        AUTHORIZED=true
        break
      fi
    done
    if ! $AUTHORIZED; then
      # Allow common shared files
      if [[ "$file" == *"index.ts" ]] || [[ "$file" == *"index.tsx" ]] || [[ "$file" == *".json" ]]; then
        continue
      fi
      UNAUTHORIZED="${UNAUTHORIZED}\n    - ${file}"
    fi
  done <<< "$ALL_CHANGED"

  if [ -n "$UNAUTHORIZED" ]; then
    add_block "${AGENT_NAME} touched files outside ownership:${UNAUTHORIZED}"
  else
    add_pass "All changed files within ${AGENT_NAME}'s ownership"
  fi
fi

# ─── 2. Copyright header check on new .ts/.tsx files ───
NEW_FILES=$(cd "$PROJECT_ROOT" && git diff --name-only --diff-filter=A HEAD 2>/dev/null | grep -E '\.(ts|tsx)$')
MISSING_COPYRIGHT=0
while IFS= read -r file; do
  [ -z "$file" ] && continue
  FULL_PATH="$PROJECT_ROOT/$file"
  if [ -f "$FULL_PATH" ]; then
    # Check first 5 lines for copyright
    if ! head -5 "$FULL_PATH" | grep -qi "copyright\|license\|SPDX"; then
      MISSING_COPYRIGHT=$((MISSING_COPYRIGHT + 1))
      add_warn "Missing copyright header: $file"
    fi
  fi
done <<< "$NEW_FILES"

if [ $MISSING_COPYRIGHT -eq 0 ] && [ -n "$NEW_FILES" ]; then
  add_pass "All new .ts/.tsx files have copyright headers"
fi

# ─── 3. Inline hex/px check (design token violations) ───
HEX_VIOLATIONS=0
PX_VIOLATIONS=0
while IFS= read -r file; do
  [ -z "$file" ] && continue
  FULL_PATH="$PROJECT_ROOT/$file"
  if [ -f "$FULL_PATH" ] && echo "$file" | grep -qE '\.(tsx|ts)$'; then
    # Check for inline hex colors (skip imports, comments, and test files)
    if ! echo "$file" | grep -q "__tests__\|\.test\.\|\.spec\."; then
      HEX_COUNT=$(grep -cE '#[0-9a-fA-F]{3,8}' "$FULL_PATH" 2>/dev/null || echo 0)
      if [ "$HEX_COUNT" -gt 0 ]; then
        HEX_VIOLATIONS=$((HEX_VIOLATIONS + HEX_COUNT))
      fi
      # Check for inline px values in style objects (not in comments)
      PX_COUNT=$(grep -cE "'[0-9]+px'" "$FULL_PATH" 2>/dev/null || echo 0)
      if [ "$PX_COUNT" -gt 0 ]; then
        PX_VIOLATIONS=$((PX_VIOLATIONS + PX_COUNT))
      fi
    fi
  fi
done <<< "$ALL_CHANGED"

if [ $HEX_VIOLATIONS -gt 0 ]; then
  add_warn "$HEX_VIOLATIONS inline hex color(s) found — use Chakra design tokens instead"
fi
if [ $PX_VIOLATIONS -gt 0 ]; then
  add_warn "$PX_VIOLATIONS inline px value(s) found — use Chakra spacing tokens instead"
fi
if [ $HEX_VIOLATIONS -eq 0 ] && [ $PX_VIOLATIONS -eq 0 ]; then
  add_pass "No inline hex/px values — using design tokens"
fi

# ─── 4. Barrel export check ───
# For each new file, check if its parent directory's index.ts exports it
MISSING_EXPORTS=0
while IFS= read -r file; do
  [ -z "$file" ] && continue
  DIR=$(dirname "$PROJECT_ROOT/$file")
  BASENAME=$(basename "$file" | sed 's/\.[^.]*$//')
  INDEX_FILE="$DIR/index.ts"
  if [ -f "$INDEX_FILE" ] && [ "$BASENAME" != "index" ]; then
    if ! grep -q "$BASENAME" "$INDEX_FILE" 2>/dev/null; then
      MISSING_EXPORTS=$((MISSING_EXPORTS + 1))
      add_warn "New file '$file' not exported from $(basename "$DIR")/index.ts"
    fi
  fi
done <<< "$NEW_FILES"

if [ $MISSING_EXPORTS -eq 0 ] && [ -n "$NEW_FILES" ]; then
  add_pass "All new files have barrel exports"
fi

# ─── 5. Filename convention check (types.ts not *.types.ts) ───
BAD_NAMES=$(echo "$ALL_CHANGED" | grep -E '\.(types|utils|hooks|constants)\.(ts|tsx)$' || true)
if [ -n "$BAD_NAMES" ]; then
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    add_warn "Filename convention: '$file' should be 'types.ts' not '*.types.ts'"
  done <<< "$BAD_NAMES"
else
  add_pass "Filename conventions followed"
fi

# ─── Output ───
echo ""
echo "=== Straw Hat Output Validator ==="
echo "Agent: $AGENT_NAME"
echo "Files changed: $(echo "$ALL_CHANGED" | grep -c '.' || echo 0)"
echo "New files: $(echo "$NEW_FILES" | grep -c '.' || echo 0)"
echo "──────────────────────────────────"

if [ -n "$PASSES" ]; then echo -e "$PASSES"; fi
if [ -n "$WARNS" ]; then echo -e "$WARNS"; fi
if [ -n "$BLOCKS" ]; then echo -e "$BLOCKS"; fi

echo ""

if [ -n "$BLOCKS" ]; then
  echo "VERDICT: ISSUES FOUND — review before proceeding"
  exit 2
elif [ -n "$WARNS" ]; then
  echo "VERDICT: PASS with warnings"
  exit 1
else
  echo "VERDICT: PASS"
  exit 0
fi
