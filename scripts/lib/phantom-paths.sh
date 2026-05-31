# Author: Subash Karki
# phantom-paths.sh — single source of truth for Phantom mutable-state root.
# Safe to `source` from other scripts: sets only PHANTOM_DATA (if unset),
# no `set -e`, no output.

: "${PHANTOM_DATA:=$HOME/.claude/phantom-data}"
export PHANTOM_DATA

: "${PHANTOM_STATE_DIR:=$PHANTOM_DATA/state}"
: "${PHANTOM_SESSIONS_DIR:=$PHANTOM_STATE_DIR/sessions}"
: "${PHANTOM_LEARNINGS_DIR:=$PHANTOM_DATA/learnings}"
: "${PHANTOM_AUDIT_DIR:=$PHANTOM_DATA/audit}"
: "${PHANTOM_GLOBAL_PATTERNS_DIR:=$PHANTOM_DATA/global/patterns}"
export PHANTOM_STATE_DIR PHANTOM_SESSIONS_DIR PHANTOM_LEARNINGS_DIR PHANTOM_AUDIT_DIR PHANTOM_GLOBAL_PATTERNS_DIR
