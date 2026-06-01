# Author: Subash Karki
# phantom-paths.sh — single source of truth for Phantom mutable-state root.
# Safe to `source` from other scripts: sets only PHANTOM_DATA (if unset),
# no `set -e`, no output.

: "${PHANTOM_DATA:=$HOME/.claude/phantom-data}"
export PHANTOM_DATA

: "${PHANTOM_STATE_DIR:=$PHANTOM_DATA/state}"
: "${PHANTOM_AUDIT_DIR:=$PHANTOM_DATA/audit}"
: "${PHANTOM_GLOBAL_PATTERNS_DIR:=$PHANTOM_DATA/global/patterns}"
export PHANTOM_STATE_DIR PHANTOM_AUDIT_DIR PHANTOM_GLOBAL_PATTERNS_DIR

# Resolve repo name at CALL time, not source time (sourced at shell startup with
# PWD=$HOME). PHANTOM_REPO overrides; else pure-shell walk up to first `.git`
# entry (dir or file) basename; else `_default`. No `git` binary; never errors.
phantom_detect_repo() {
  if [ -n "${PHANTOM_REPO:-}" ]; then
    printf '%s\n' "$PHANTOM_REPO"
    return 0
  fi
  d=$PWD
  while [ -n "$d" ]; do
    if [ -e "$d/.git" ]; then
      printf '%s\n' "$(basename "$d")"
      return 0
    fi
    [ "$d" = "/" ] && break
    d=$(dirname "$d")
  done
  printf '%s\n' "_default"
}

# Per-repo dirs, all resolved at call time via phantom_detect_repo.
phantom_repo_dir()      { printf '%s\n' "$PHANTOM_DATA/repos/$(phantom_detect_repo)"; }
phantom_learnings_dir() { printf '%s\n' "$(phantom_repo_dir)/learnings"; }
phantom_sessions_dir()  { printf '%s\n' "$(phantom_repo_dir)/sessions"; }
