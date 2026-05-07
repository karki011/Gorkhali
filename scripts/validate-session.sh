#!/bin/bash
# =============================================================================
# Phantom Works Crew — Session State Validator (Layer 4)
# Author: Subash Karki
#
# Validates session JSON integrity at checkpoints:
#   - Board JSON structure is valid
#   - Phase statuses use valid enum values
#   - Verification block present after verify phase
#   - Visual verification present when visualVerify: true
#   - Loop counts within bounds
#   - All required fields present
#
# Usage: validate-session.sh <session-json-path>
# =============================================================================

SESSION_FILE="${1}"

if [ -z "$SESSION_FILE" ] || [ ! -f "$SESSION_FILE" ]; then
  echo "BLOCK: Session file not found: ${SESSION_FILE}"
  exit 2
fi

# Validate JSON syntax first
if ! jq empty "$SESSION_FILE" 2>/dev/null; then
  echo "BLOCK: Invalid JSON in session file"
  exit 2
fi

WARNS=""
BLOCKS=""
PASSES=""

add_block() { BLOCKS="${BLOCKS}\n  BLOCK: $1"; }
add_warn()  { WARNS="${WARNS}\n  WARN:  $1"; }
add_pass()  { PASSES="${PASSES}\n  PASS:  $1"; }

# ─── 1. Required top-level fields ───
REQUIRED_FIELDS=("ticket" "status" "phases")
for field in "${REQUIRED_FIELDS[@]}"; do
  VAL=$(jq -r ".${field} // empty" "$SESSION_FILE")
  if [ -z "$VAL" ] || [ "$VAL" = "null" ]; then
    add_block "Missing required field: '$field'"
  fi
done

OPTIONAL_FIELDS=("title" "branch" "workflow" "createdAt" "updatedAt" "coordinator" "crew")
for field in "${OPTIONAL_FIELDS[@]}"; do
  VAL=$(jq -r ".${field} // empty" "$SESSION_FILE")
  if [ -z "$VAL" ] || [ "$VAL" = "null" ]; then
    add_warn "Missing optional field: '$field' (board may not render fully)"
  fi
done

# ─── 2. Phase status enum validation ───
VALID_STATUSES="pending in_progress in_review complete blocked"
PHASE_COUNT=$(jq '.phases | length' "$SESSION_FILE")
INVALID_STATUS=0

for i in $(seq 0 $((PHASE_COUNT - 1))); do
  STATUS=$(jq -r ".phases[$i].status // empty" "$SESSION_FILE")
  if [ -z "$STATUS" ]; then
    add_warn "Phase $i has no status"
    continue
  fi
  if ! echo "$VALID_STATUSES" | grep -qw "$STATUS"; then
    add_block "Phase $i has invalid status: '$STATUS' (valid: $VALID_STATUSES)"
    INVALID_STATUS=$((INVALID_STATUS + 1))
  fi
done

if [ $INVALID_STATUS -eq 0 ]; then
  add_pass "All phase statuses are valid"
fi

# ─── 3. Task status enum validation ───
VALID_TASK_STATUSES="pending in_progress complete done skipped"
INVALID_TASK=0

for i in $(seq 0 $((PHASE_COUNT - 1))); do
  TASK_COUNT=$(jq ".phases[$i].tasks | length" "$SESSION_FILE" 2>/dev/null || echo 0)
  for j in $(seq 0 $((TASK_COUNT - 1))); do
    TASK_TYPE=$(jq -r ".phases[$i].tasks[$j] | type" "$SESSION_FILE" 2>/dev/null)
    if [ "$TASK_TYPE" = "object" ]; then
      TSTATUS=$(jq -r ".phases[$i].tasks[$j].status // empty" "$SESSION_FILE")
      if [ -n "$TSTATUS" ] && ! echo "$VALID_TASK_STATUSES" | grep -qw "$TSTATUS"; then
        add_warn "Phase $i, task $j has invalid status: '$TSTATUS'"
        INVALID_TASK=$((INVALID_TASK + 1))
      fi
    fi
  done
done

if [ $INVALID_TASK -eq 0 ]; then
  add_pass "All task statuses are valid"
fi

# ─── 4. Verification block check ───
SESSION_STATUS=$(jq -r '.status // empty' "$SESSION_FILE")
VERIFICATION=$(jq -r '.verification // empty' "$SESSION_FILE")

# Check if any verify/sengoku phase is complete
HAS_VERIFY_COMPLETE=false
for i in $(seq 0 $((PHASE_COUNT - 1))); do
  PNAME=$(jq -r ".phases[$i].name // empty" "$SESSION_FILE" | tr '[:upper:]' '[:lower:]')
  PSTATUS=$(jq -r ".phases[$i].status // empty" "$SESSION_FILE")
  if echo "$PNAME" | grep -qi "verify\|chopper\|sengoku\|gauntlet" && [ "$PSTATUS" = "complete" ]; then
    HAS_VERIFY_COMPLETE=true
  fi
done

if $HAS_VERIFY_COMPLETE; then
  if [ -z "$VERIFICATION" ] || [ "$VERIFICATION" = "null" ]; then
    add_block "Verification phase completed but no 'verification' block in session JSON"
  else
    VSTATUS=$(jq -r '.verification.status // empty' "$SESSION_FILE")
    if [ -z "$VSTATUS" ]; then
      add_warn "Verification block exists but missing 'status' field"
    else
      add_pass "Verification block present with status: $VSTATUS"
    fi
  fi
fi

# ─── 5. Visual verification check ───
VISUAL_VERIFY=$(jq -r '.visualVerify // false' "$SESSION_FILE")
VISUAL_BLOCK=$(jq -r '.visualVerification // empty' "$SESSION_FILE")

if [ "$VISUAL_VERIFY" = "true" ]; then
  # Check if Smoker phase exists
  SMOKER_EXISTS=false
  for i in $(seq 0 $((PHASE_COUNT - 1))); do
    PNAME=$(jq -r ".phases[$i].name // empty" "$SESSION_FILE" | tr '[:upper:]' '[:lower:]')
    POWNER=$(jq -r ".phases[$i].owner // empty" "$SESSION_FILE" | tr '[:upper:]' '[:lower:]')
    if echo "$PNAME $POWNER" | grep -qi "smoker\|visual"; then
      SMOKER_EXISTS=true
    fi
  done

  if ! $SMOKER_EXISTS; then
    add_block "visualVerify: true but no Smoker phase in plan"
  else
    add_pass "Smoker phase present for visual verification"
  fi

  # Check visual verification results if Smoker phase is complete
  SMOKER_COMPLETE=false
  for i in $(seq 0 $((PHASE_COUNT - 1))); do
    PNAME=$(jq -r ".phases[$i].name // empty" "$SESSION_FILE" | tr '[:upper:]' '[:lower:]')
    PSTATUS=$(jq -r ".phases[$i].status // empty" "$SESSION_FILE")
    if echo "$PNAME" | grep -qi "smoker\|visual" && [ "$PSTATUS" = "complete" ]; then
      SMOKER_COMPLETE=true
    fi
  done

  if $SMOKER_COMPLETE && ([ -z "$VISUAL_BLOCK" ] || [ "$VISUAL_BLOCK" = "null" ]); then
    add_warn "Smoker phase complete but no 'visualVerification' block in session JSON"
  fi
fi

# ─── 6. Loop count bounds ───
VERIFY_LOOP=$(jq -r '.verification.loop // 0' "$SESSION_FILE" 2>/dev/null)
VISUAL_LOOP=$(jq -r '.visualVerification.loop // 0' "$SESSION_FILE" 2>/dev/null)

if [ "$VERIFY_LOOP" -gt 3 ] 2>/dev/null; then
  add_block "Verification fix loop exceeded max (${VERIFY_LOOP}/3) — must escalate to user"
fi
if [ "$VISUAL_LOOP" -gt 3 ] 2>/dev/null; then
  add_block "Visual fix loop exceeded max (${VISUAL_LOOP}/3) — must escalate to user"
fi

# ─── 7. Board JSON freshness (updatedAt within last 10 minutes) ───
UPDATED_AT=$(jq -r '.updatedAt // empty' "$SESSION_FILE")
if [ -n "$UPDATED_AT" ]; then
  UPDATED_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${UPDATED_AT%%.*}" +%s 2>/dev/null || date -d "$UPDATED_AT" +%s 2>/dev/null || echo 0)
  NOW_EPOCH=$(date +%s)
  if [ $UPDATED_EPOCH -gt 0 ]; then
    AGE=$(( (NOW_EPOCH - UPDATED_EPOCH) ))
    if [ $AGE -gt 600 ]; then
      add_warn "Session JSON last updated $(( AGE / 60 )) minutes ago — may be stale"
    fi
  fi
fi

# ─── 8. Phase owner check ───
MISSING_OWNER=0
for i in $(seq 0 $((PHASE_COUNT - 1))); do
  OWNER=$(jq -r ".phases[$i].owner // empty" "$SESSION_FILE")
  if [ -z "$OWNER" ]; then
    MISSING_OWNER=$((MISSING_OWNER + 1))
  fi
done

if [ $MISSING_OWNER -gt 0 ]; then
  add_warn "$MISSING_OWNER phase(s) missing owner field"
else
  add_pass "All phases have owners"
fi

# ─── Output ───
TICKET=$(jq -r '.ticket // "unknown"' "$SESSION_FILE")
STATUS=$(jq -r '.status // "unknown"' "$SESSION_FILE")

echo ""
echo "=== Phantom Works Session Validator ==="
echo "Ticket: $TICKET | Status: $STATUS | Phases: $PHASE_COUNT"
echo "Verify loop: ${VERIFY_LOOP}/3 | Visual loop: ${VISUAL_LOOP}/3"
echo "────────────────────────────────────"

if [ -n "$PASSES" ]; then echo -e "$PASSES"; fi
if [ -n "$WARNS" ]; then echo -e "$WARNS"; fi
if [ -n "$BLOCKS" ]; then echo -e "$BLOCKS"; fi

echo ""

if [ -n "$BLOCKS" ]; then
  echo "VERDICT: ISSUES FOUND — fix before continuing"
  exit 2
elif [ -n "$WARNS" ]; then
  echo "VERDICT: PASS with warnings"
  exit 1
else
  echo "VERDICT: PASS"
  exit 0
fi
