#!/usr/bin/env bash
# Author: Subash Karki
# Verifies a Gorkhali session directory has the expected artifacts for its phase.
# Usage: session-health.sh <session-dir> [--phase <phase>] [--fields a,b,c]
#   <session-dir>: path to session directory (e.g., ~/.gorkhali/repos/myrepo/sessions/ENG-1234)
#   --phase <phase>: expected phase (A, B, C, D, verify, wrap). Auto-detected from artifacts if omitted.
#   --fields <list>: comma-separated subset of the "Found artifacts:" block to
#     display (valid: context,intent,plan,execution,verification,wrap,pause,
#     contracts,decisions). Default is all of them. Validated via
#     scripts/lib/fields.js when the plugin cache is resolvable.
# Exit 0 = healthy, Exit 1 = missing required artifacts

set -euo pipefail

SESSION_DIR=""
EXPECTED_PHASE=""
FIELDS_ARG=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)
      EXPECTED_PHASE="$2"
      shift 2
      ;;
    --fields)
      FIELDS_ARG="$2"
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
  echo "Usage: session-health.sh <session-dir> [--phase <phase>] [--fields a,b,c]" >&2
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

# Helper: check if file exists and is valid JSON. FOUND_ARTIFACTS entries are
# "key::label" pairs - key is the canonical --fields name, label is what
# actually gets printed in the "Found artifacts:" block below.
check_json() {
  local key="$1"
  local label="$2"
  local filepath="$3"
  if [[ -f "$filepath" ]]; then
    FOUND_ARTIFACTS+=("$key::$label")
    if ! node -e "JSON.parse(require('fs').readFileSync('$filepath','utf8'))" 2>/dev/null; then
      ERRORS+=("INVALID JSON: $label at $filepath")
    fi
  else
    echo "  MISSING: $label ($filepath)"
  fi
}

echo "Session: $SESSION_DIR"
echo ""

# --- Validate --fields against the canonical artifact keys, if given ---
VALID_FIELDS="context,intent,plan,execution,verification,wrap,pause,contracts,decisions"
ALLOWED_FIELDS=""
if [[ -n "$FIELDS_ARG" ]]; then
  SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  FIELDS_JS="$SELF_DIR/lib/fields.js"
  if [[ ! -f "$FIELDS_JS" ]]; then
    PR="$(ls -dt "$HOME/.claude/plugins/cache/gorkhali/gorkhali/"*/ 2>/dev/null | head -1)"; PR="${PR%/}"
    [[ -n "$PR" && -f "$PR/scripts/lib/fields.js" ]] && FIELDS_JS="$PR/scripts/lib/fields.js"
  fi
  if [[ -f "$FIELDS_JS" ]]; then
    set +e
    RAW_FIELDS="$(node "$FIELDS_JS" parse "$FIELDS_ARG" --valid "$VALID_FIELDS" 2>&1)"
    FIELDS_STATUS=$?
    set -e
    if [[ $FIELDS_STATUS -ne 0 ]]; then
      echo "ERROR: $RAW_FIELDS" >&2
      exit 1
    fi
    ALLOWED_FIELDS="$(echo "$RAW_FIELDS" | tr '\n' ',' | sed 's/,$//')"
  else
    # No resolver available to validate against - trust the caller's list as-is.
    ALLOWED_FIELDS="$FIELDS_ARG"
  fi
fi

# --- Phase A artifacts ---
CONTEXT_JSON="$SESSION_DIR/context.json"
check_json "context" "context.json" "$CONTEXT_JSON"

# --- Phase B artifacts ---
INTENT_JSON="$SESSION_DIR/intent.json"
PLAN_JSON="$SESSION_DIR/plan.json"
check_json "intent" "intent.json" "$INTENT_JSON"
check_json "plan" "plan.json" "$PLAN_JSON"

# --- Phase C artifacts ---
EXECUTION_JSON="$SESSION_DIR/execution.json"
check_json "execution" "execution.json" "$EXECUTION_JSON"

# --- Verify artifacts ---
VERIFICATION_JSON="$SESSION_DIR/verification.json"
check_json "verification" "verification.json" "$VERIFICATION_JSON"

# --- Wrap artifacts ---
WRAP_JSON="$SESSION_DIR/wrap.json"
check_json "wrap" "wrap.json" "$WRAP_JSON"

# --- Pause state (optional) ---
PAUSE_JSON="$SESSION_DIR/pause-state.json"
if [[ -f "$PAUSE_JSON" ]]; then
  FOUND_ARTIFACTS+=("pause::pause-state.json")
  if ! node -e "JSON.parse(require('fs').readFileSync('$PAUSE_JSON','utf8'))" 2>/dev/null; then
    ERRORS+=("INVALID JSON: pause-state.json at $PAUSE_JSON")
  fi
fi

# --- Contracts directory ---
CONTRACTS_DIR="$SESSION_DIR/contracts"
if [[ -d "$CONTRACTS_DIR" ]]; then
  CONTRACT_COUNT=$(find "$CONTRACTS_DIR" \( -name "*.md" -o -name "*.html" \) | wc -l | tr -d ' ')
  FOUND_ARTIFACTS+=("contracts::contracts/ ($CONTRACT_COUNT file(s))")
fi

# --- Decisions file ---
DECISIONS="$SESSION_DIR/decisions.md"
if [[ -f "$DECISIONS" ]]; then
  FOUND_ARTIFACTS+=("decisions::decisions.md")
fi

echo ""
echo "Found artifacts:"
DISPLAYED_ARTIFACTS=0
for entry in "${FOUND_ARTIFACTS[@]}"; do
  key="${entry%%::*}"
  label="${entry#*::}"
  if [[ -n "$ALLOWED_FIELDS" ]] && [[ ",$ALLOWED_FIELDS," != *",$key,"* ]]; then
    continue
  fi
  echo "  + $label"
  DISPLAYED_ARTIFACTS=$((DISPLAYED_ARTIFACTS + 1))
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

COUNT_FOR_MSG=${#FOUND_ARTIFACTS[@]}
[[ -n "$ALLOWED_FIELDS" ]] && COUNT_FOR_MSG=$DISPLAYED_ARTIFACTS
echo "Session health: OK ($COUNT_FOR_MSG artifact(s) found)"
exit 0
