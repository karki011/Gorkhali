#!/bin/bash
# =============================================================================
# Phantom Works Crew — Plan Validator (Layer 1)
# Author: Subash Karki
#
# Validates a session JSON plan before execution begins.
# Usage: validate-plan.sh <session-json-path>
#
# Exit codes: 0 = PASS, 1 = WARN only, 2 = BLOCK (must fix before executing)
# =============================================================================

SESSION_FILE="${1}"

if [ -z "$SESSION_FILE" ] || [ ! -f "$SESSION_FILE" ]; then
  echo "BLOCK: Session file not found: ${SESSION_FILE}"
  exit 2
fi

BLOCKS=""
WARNS=""
PASSES=""

# ─── Helper ───
add_block() { BLOCKS="${BLOCKS}\n  BLOCK: $1"; }
add_warn()  { WARNS="${WARNS}\n  WARN:  $1"; }
add_pass()  { PASSES="${PASSES}\n  PASS:  $1"; }

# ─── Read session JSON ───
PHASES=$(jq -r '.phases // empty' "$SESSION_FILE")
PHASE_COUNT=$(echo "$PHASES" | jq 'length')
VISUAL_VERIFY=$(jq -r '.visualVerify // false' "$SESSION_FILE")
WORKFLOW=$(jq -r '.workflow // "feature"' "$SESSION_FILE")

if [ "$PHASE_COUNT" = "0" ] || [ -z "$PHASES" ]; then
  add_block "No phases found in session JSON"
  echo -e "\n=== Phantom Works Plan Validator ==="
  echo -e "$BLOCKS"
  exit 2
fi

# ─── 1. User Feedback must be last ───
LAST_PHASE_NAME=$(echo "$PHASES" | jq -r '.[-1].name // empty' | tr '[:upper:]' '[:lower:]')
if echo "$LAST_PHASE_NAME" | grep -qi "user\|feedback\|testing"; then
  add_pass "User Feedback is last phase"
else
  add_block "Last phase must be User Feedback/Testing (got: '$(echo "$PHASES" | jq -r '.[-1].name')')"
fi

# ─── 2. Sengoku must be present (before User Feedback) ───
SENGOKU_FOUND=false
SENGOKU_IDX=-1
for i in $(seq 0 $((PHASE_COUNT - 1))); do
  PNAME=$(echo "$PHASES" | jq -r ".[$i].name // empty" | tr '[:upper:]' '[:lower:]')
  POWNER=$(echo "$PHASES" | jq -r ".[$i].owner // empty" | tr '[:upper:]' '[:lower:]')
  if echo "$PNAME $POWNER" | grep -qi "sengoku\|quality gate\|gauntlet"; then
    SENGOKU_FOUND=true
    SENGOKU_IDX=$i
  fi
done

if $SENGOKU_FOUND; then
  add_pass "Sengoku quality gauntlet found (phase $SENGOKU_IDX)"
else
  add_block "Sengoku quality gauntlet is missing — must be second-to-last (or third-to-last if Smoker)"
fi

# ─── 3. Smoker for UI tasks / Figma ───
SMOKER_FOUND=false
for i in $(seq 0 $((PHASE_COUNT - 1))); do
  PNAME=$(echo "$PHASES" | jq -r ".[$i].name // empty" | tr '[:upper:]' '[:lower:]')
  POWNER=$(echo "$PHASES" | jq -r ".[$i].owner // empty" | tr '[:upper:]' '[:lower:]')
  if echo "$PNAME $POWNER" | grep -qi "smoker\|visual"; then
    SMOKER_FOUND=true
  fi
done

# Check if any phase involves UI work
HAS_UI_TASKS=false
ALL_NAMES=$(echo "$PHASES" | jq -r '.[].name // empty' | tr '[:upper:]' '[:lower:]')
ALL_TASKS=$(echo "$PHASES" | jq -r '.[].tasks[]? | if type == "string" then . else .name // empty end' 2>/dev/null | tr '[:upper:]' '[:lower:]')
COMBINED="$ALL_NAMES $ALL_TASKS"

if echo "$COMBINED" | grep -qi "ui\|component\|layout\|page\|figma\|style\|nami\|visual\|design"; then
  HAS_UI_TASKS=true
fi

if [ "$VISUAL_VERIFY" = "true" ] || $HAS_UI_TASKS; then
  if $SMOKER_FOUND; then
    add_pass "Smoker visual inspection included for UI task"
  else
    add_block "UI/Figma task detected but Smoker visual inspection is missing — add visualVerify: true and a Smoker phase"
  fi
else
  if $SMOKER_FOUND; then
    add_warn "Smoker included but no UI tasks detected — may be unnecessary"
  else
    add_pass "No UI tasks — Smoker correctly skipped"
  fi
fi

# ─── 4. Phase order: Roger → Chopper → Sengoku → Smoker → User Feedback ───
ROGER_IDX=-1
CHOPPER_IDX=-1
SMOKER_IDX=-1
FEEDBACK_IDX=$((PHASE_COUNT - 1))

for i in $(seq 0 $((PHASE_COUNT - 1))); do
  PNAME=$(echo "$PHASES" | jq -r ".[$i].name // empty" | tr '[:upper:]' '[:lower:]')
  POWNER=$(echo "$PHASES" | jq -r ".[$i].owner // empty" | tr '[:upper:]' '[:lower:]')
  COMBINED_P="$PNAME $POWNER"
  if echo "$COMBINED_P" | grep -qi "roger\|quality review\|principal"; then ROGER_IDX=$i; fi
  if echo "$COMBINED_P" | grep -qi "chopper\|build\|verify\|ci\|integration pass"; then CHOPPER_IDX=$i; fi
  if echo "$COMBINED_P" | grep -qi "smoker\|visual inspect"; then SMOKER_IDX=$i; fi
done

if [ $ROGER_IDX -ge 0 ] && [ $CHOPPER_IDX -ge 0 ] && [ $ROGER_IDX -gt $CHOPPER_IDX ]; then
  add_warn "Roger review (phase $ROGER_IDX) is after Chopper verify (phase $CHOPPER_IDX) — usually Roger reviews before Chopper verifies"
fi

if [ $SENGOKU_IDX -ge 0 ] && [ $SENGOKU_IDX -ge $FEEDBACK_IDX ]; then
  add_block "Sengoku (phase $SENGOKU_IDX) must come before User Feedback (phase $FEEDBACK_IDX)"
fi

if [ $SMOKER_IDX -ge 0 ] && [ $SENGOKU_IDX -ge 0 ] && [ $SMOKER_IDX -le $SENGOKU_IDX ]; then
  add_block "Smoker (phase $SMOKER_IDX) must come after Sengoku (phase $SENGOKU_IDX)"
fi

# ─── 5. Every task has an assignee ───
MISSING_ASSIGNEE=0
for i in $(seq 0 $((PHASE_COUNT - 1))); do
  TASK_COUNT=$(echo "$PHASES" | jq ".[$i].tasks | length" 2>/dev/null)
  if [ -z "$TASK_COUNT" ] || [ "$TASK_COUNT" = "0" ]; then continue; fi
  for j in $(seq 0 $((TASK_COUNT - 1))); do
    IS_OBJ=$(echo "$PHASES" | jq ".[$i].tasks[$j] | type" -r 2>/dev/null)
    if [ "$IS_OBJ" = "object" ]; then
      ASSIGNEE=$(echo "$PHASES" | jq -r ".[$i].tasks[$j].assignee // empty" 2>/dev/null)
      if [ -z "$ASSIGNEE" ]; then
        TNAME=$(echo "$PHASES" | jq -r ".[$i].tasks[$j].name // \"unknown\"" 2>/dev/null)
        MISSING_ASSIGNEE=$((MISSING_ASSIGNEE + 1))
      fi
    fi
  done
done

if [ $MISSING_ASSIGNEE -gt 0 ]; then
  add_warn "$MISSING_ASSIGNEE task(s) missing assignee"
else
  add_pass "All tasks have assignees"
fi

# ─── 6. Every phase has an owner ───
MISSING_OWNER=0
for i in $(seq 0 $((PHASE_COUNT - 1))); do
  OWNER=$(echo "$PHASES" | jq -r ".[$i].owner // empty" 2>/dev/null)
  if [ -z "$OWNER" ]; then
    MISSING_OWNER=$((MISSING_OWNER + 1))
  fi
done

if [ $MISSING_OWNER -gt 0 ]; then
  add_warn "$MISSING_OWNER phase(s) missing owner"
else
  add_pass "All phases have owners"
fi

# ─── 7. No duplicate file ownership (check task metadata if available) ───
# This is a best-effort check — only works if tasks have "files" in metadata
DUPES=$(echo "$PHASES" | jq -r '[.[].tasks[]? | select(type == "object") | {assignee, files: (.files // [] | .[])}] | group_by(.files) | map(select(length > 1)) | length' 2>/dev/null)
if [ -n "$DUPES" ] && [ "$DUPES" -gt 0 ]; then
  add_block "$DUPES file(s) assigned to multiple agents — use sequential tasks or split files"
fi

# ─── Output ───
echo ""
echo "=== Phantom Works Plan Validator ==="
echo "Session: $(basename "$SESSION_FILE")"
echo "Phases: $PHASE_COUNT | Workflow: $WORKFLOW | Visual verify: $VISUAL_VERIFY"
echo "───────────────────────────────"

HAS_BLOCKS=false
HAS_WARNS=false

if [ -n "$PASSES" ]; then
  echo -e "$PASSES"
fi

if [ -n "$WARNS" ]; then
  echo -e "$WARNS"
  HAS_WARNS=true
fi

if [ -n "$BLOCKS" ]; then
  echo -e "$BLOCKS"
  HAS_BLOCKS=true
fi

echo ""

if $HAS_BLOCKS; then
  echo "VERDICT: BLOCKED — fix issues above before executing"
  exit 2
elif $HAS_WARNS; then
  echo "VERDICT: PASS with warnings"
  exit 1
else
  echo "VERDICT: PASS"
  exit 0
fi
