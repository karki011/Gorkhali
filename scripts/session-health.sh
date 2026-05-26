#!/usr/bin/env bash
# Author: Subash Karki
# Verifies a team skill session directory has the expected artifacts for its phase.
# Usage: session-health.sh <session-dir> [--phase <phase>]
#   <session-dir>: path to session directory (e.g., ~/.claude/team/repos/myrepo/sessions/ENG-1234)
#   --phase <phase>: expected phase (A, B, C, D, verify, wrap). Auto-detected from artifacts if omitted.
# Exit 0 = healthy, Exit 1 = missing required artifacts

set -euo pipefail

SESSION_DIR=""
EXPECTED_PHASE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)
      EXPECTED_PHASE="$2"
      shift 2
      ;;
    *)
      SESSION_DIR="$1"
      shift
      ;;
  esac
done

# Expand tilde
SESSION_DIR="${SESSION_DIR/#\~/$HOME}"

if [[ -z "$SESSION_DIR" ]]; then
  echo "Usage: session-health.sh <session-dir> [--phase <phase>]" >&2
  echo "  Phases: A B C D verify wrap" >&2
  exit 1
fi

if [[ ! -d "$SESSION_DIR" ]]; then
  echo "ERROR: Session directory not found: $SESSION_DIR" >&2
  exit 1
fi

ERRORS=()
WARNINGS=()
FOUND_ARTIFACTS=()

# Helper: check if file exists and is valid JSON
check_json() {
  local label="$1"
  local filepath="$2"
  if [[ -f "$filepath" ]]; then
    FOUND_ARTIFACTS+=("$label")
    if ! node -e "JSON.parse(require('fs').readFileSync('$filepath','utf8'))" 2>/dev/null; then
      ERRORS+=("INVALID JSON: $label at $filepath")
    fi
  else
    echo "  MISSING: $label ($filepath)"
  fi
}

echo "Session: $SESSION_DIR"
echo ""

# --- Phase A artifacts ---
CONTEXT_JSON="$SESSION_DIR/context.json"
check_json "context.json" "$CONTEXT_JSON"

# --- Phase B artifacts ---
INTENT_JSON="$SESSION_DIR/intent.json"
PLAN_JSON="$SESSION_DIR/plan.json"
check_json "intent.json" "$INTENT_JSON"
check_json "plan.json" "$PLAN_JSON"

# --- Phase C artifacts ---
EXECUTION_JSON="$SESSION_DIR/execution.json"
check_json "execution.json" "$EXECUTION_JSON"

# --- Verify artifacts ---
VERIFICATION_JSON="$SESSION_DIR/verification.json"
check_json "verification.json" "$VERIFICATION_JSON"

# --- Wrap artifacts ---
WRAP_JSON="$SESSION_DIR/wrap.json"
check_json "wrap.json" "$WRAP_JSON"

# --- Pause state (optional) ---
PAUSE_JSON="$SESSION_DIR/pause-state.json"
if [[ -f "$PAUSE_JSON" ]]; then
  FOUND_ARTIFACTS+=("pause-state.json")
  if ! node -e "JSON.parse(require('fs').readFileSync('$PAUSE_JSON','utf8'))" 2>/dev/null; then
    ERRORS+=("INVALID JSON: pause-state.json at $PAUSE_JSON")
  fi
fi

# --- Contracts directory ---
CONTRACTS_DIR="$SESSION_DIR/contracts"
if [[ -d "$CONTRACTS_DIR" ]]; then
  CONTRACT_COUNT=$(find "$CONTRACTS_DIR" -name "*.md" | wc -l | tr -d ' ')
  FOUND_ARTIFACTS+=("contracts/ ($CONTRACT_COUNT file(s))")
fi

# --- Decisions file ---
DECISIONS="$SESSION_DIR/decisions.md"
if [[ -f "$DECISIONS" ]]; then
  FOUND_ARTIFACTS+=("decisions.md")
fi

echo ""
echo "Found artifacts:"
for a in "${FOUND_ARTIFACTS[@]}"; do
  echo "  + $a"
done

# --- Phase-specific required artifact check ---
if [[ -n "$EXPECTED_PHASE" ]]; then
  echo ""
  echo "Phase check: $EXPECTED_PHASE"
  case "$EXPECTED_PHASE" in
    A)
      [[ ! -f "$CONTEXT_JSON" ]] && ERRORS+=("Phase A requires context.json")
      ;;
    B)
      [[ ! -f "$CONTEXT_JSON" ]] && ERRORS+=("Phase B requires context.json")
      [[ ! -f "$INTENT_JSON" ]] && ERRORS+=("Phase B requires intent.json")
      [[ ! -f "$PLAN_JSON" ]] && ERRORS+=("Phase B requires plan.json")
      ;;
    C)
      [[ ! -f "$CONTEXT_JSON" ]] && ERRORS+=("Phase C requires context.json")
      [[ ! -f "$PLAN_JSON" ]] && ERRORS+=("Phase C requires plan.json")
      ;;
    D|verify)
      [[ ! -f "$PLAN_JSON" ]] && ERRORS+=("Phase verify requires plan.json")
      [[ ! -f "$EXECUTION_JSON" ]] && ERRORS+=("Phase verify requires execution.json")
      ;;
    wrap)
      [[ ! -f "$EXECUTION_JSON" ]] && ERRORS+=("Phase wrap requires execution.json")
      [[ ! -f "$VERIFICATION_JSON" ]] && ERRORS+=("Phase wrap requires verification.json")
      ;;
    *)
      WARNINGS+=("WARN: Unknown phase '$EXPECTED_PHASE' — skipping phase-specific checks")
      ;;
  esac
fi

# --- Auto-detect current phase from what's present ---
if [[ -z "$EXPECTED_PHASE" ]]; then
  DETECTED_PHASE="none"
  [[ -f "$CONTEXT_JSON" ]] && DETECTED_PHASE="A"
  [[ -f "$INTENT_JSON" ]] && DETECTED_PHASE="B"
  [[ -f "$PLAN_JSON" ]] && DETECTED_PHASE="B (plan ready)"
  [[ -f "$EXECUTION_JSON" ]] && DETECTED_PHASE="C (complete)"
  [[ -f "$VERIFICATION_JSON" ]] && DETECTED_PHASE="verify"
  [[ -f "$WRAP_JSON" ]] && DETECTED_PHASE="wrap (complete)"
  [[ -f "$PAUSE_JSON" ]] && DETECTED_PHASE="$DETECTED_PHASE [PAUSED]"
  echo ""
  echo "Detected phase: $DETECTED_PHASE"
fi

# --- Report ---
echo ""
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  for w in "${WARNINGS[@]}"; do
    echo "$w"
  done
fi

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo "Session health: FAIL"
  for e in "${ERRORS[@]}"; do
    echo "  ERROR: $e" >&2
  done
  exit 1
fi

echo "Session health: OK (${#FOUND_ARTIFACTS[@]} artifact(s) found)"
exit 0
