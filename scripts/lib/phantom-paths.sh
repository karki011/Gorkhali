# Author: Subash Karki
# phantom-paths.sh — single source of truth for Phantom mutable-state root.
# Safe to `source` from other scripts: sets PHANTOM_DATA and
# PHANTOM_PLUGIN_ROOT (if unset), no `set -e`, no output.

: "${PHANTOM_DATA:=$HOME/.claude/phantom-data}"
export PHANTOM_DATA

: "${PHANTOM_STATE_DIR:=$PHANTOM_DATA/state}"
: "${PHANTOM_AUDIT_DIR:=$PHANTOM_DATA/audit}"
: "${PHANTOM_GLOBAL_PATTERNS_DIR:=$PHANTOM_DATA/global/patterns}"
export PHANTOM_STATE_DIR PHANTOM_AUDIT_DIR PHANTOM_GLOBAL_PATTERNS_DIR

# Plugin root: script-relative self-location (env-free) — this lib lives at
# <root>/scripts/lib/, so root is two levels up. ${BASH_SOURCE:-$0}: bash sets
# BASH_SOURCE when sourced; zsh's $0 is the sourced file. cd runs in a subshell;
# empty on failure, never errors.
if [ -z "${PHANTOM_PLUGIN_ROOT:-}" ]; then
  PHANTOM_PLUGIN_ROOT=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE:-$0}")/../.." 2>/dev/null && pwd)
fi
export PHANTOM_PLUGIN_ROOT

# Portable realpath: prefer the binary; else resolve dirs via cd + `pwd -P`
# (follows symlinks like fs.realpathSync in the JS mirror). Prints nothing on
# failure so callers can test with -n.
phantom__realpath() {
  if command -v realpath >/dev/null 2>&1; then
    realpath "$1" 2>/dev/null && return 0
  fi
  if [ -d "$1" ]; then
    (CDPATH= cd -- "$1" 2>/dev/null && pwd -P)
    return 0
  fi
  return 1
}

# Resolve repo name at CALL time, not source time (sourced at shell startup with
# PWD=$HOME). IDENTICAL 6-step precedence to detectRepo() in phantom-paths.js:
#   1. <data>/worktrees/<repo> fast-path (phantom-MANAGED worktrees only;
#      ~/.phantom-os/worktrees is NOT this root — those ride step 3)
#   2. PHANTOM_REPO env override
#   3. `git remote get-url origin` basename minus .git
#   4. `git rev-parse --git-common-dir` -> main-root basename (no-remote fallback)
#   5. pure-shell walk up to the first `.git` entry (dir or file) basename
#   6. `_default`
# Every git INVOCATION is guarded (2>/dev/null); git absent/erroring degrades to
# the walk-up. Never errors. Optional $1 overrides $PWD (used by tests).
phantom_detect_repo() {
  _pcwd=${1:-$PWD}

  # (1) phantom-managed <data>/worktrees/<repo> fast-path.
  _wtroot=$(phantom__realpath "$PHANTOM_DATA/worktrees")
  _rcwd=$(phantom__realpath "$_pcwd")
  if [ -n "$_wtroot" ] && [ -n "$_rcwd" ] && [ "$_rcwd" != "$_wtroot" ]; then
    case "$_rcwd" in
      "$_wtroot"/*)
        _rest=${_rcwd#"$_wtroot"/}
        _repo=${_rest%%/*}
        if [ -n "$_repo" ]; then
          printf '%s\n' "$_repo"
          return 0
        fi
        ;;
    esac
  fi

  # (2) PHANTOM_REPO override.
  if [ -n "${PHANTOM_REPO:-}" ]; then
    printf '%s\n' "$PHANTOM_REPO"
    return 0
  fi

  # (3) git remote origin basename.
  _remote=$(git -C "$_pcwd" remote get-url origin 2>/dev/null)
  if [ -n "$_remote" ]; then
    _remote=${_remote%/}       # strip trailing slash
    _remote=${_remote##*/}     # https/ssh path segment
    _remote=${_remote##*:}     # scp-short host:repo
    _remote=${_remote%.git}    # strip .git suffix
    if [ -n "$_remote" ]; then
      printf '%s\n' "$_remote"
      return 0
    fi
  fi

  # (4) main-root basename via git common dir (no-remote / worktree-safe).
  _common=$(git -C "$_pcwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  if [ -n "$_common" ]; then
    _name=$(basename "$(dirname "$_common")")
    if [ -n "$_name" ] && [ "$_name" != ".git" ] && [ "$_name" != "." ]; then
      printf '%s\n' "$_name"
      return 0
    fi
  fi

  # (5) pure-shell walk up to the first `.git` entry basename.
  d=$_pcwd
  while [ -n "$d" ]; do
    if [ -e "$d/.git" ]; then
      printf '%s\n' "$(basename "$d")"
      return 0
    fi
    [ "$d" = "/" ] && break
    d=$(dirname "$d")
  done

  # (6) default.
  printf '%s\n' "_default"
}

# Per-repo dirs, all resolved at call time via phantom_detect_repo.
phantom_repo_dir()      { printf '%s\n' "$PHANTOM_DATA/repos/$(phantom_detect_repo)"; }
phantom_learnings_dir() { printf '%s\n' "$(phantom_repo_dir)/learnings"; }
phantom_sessions_dir()  { printf '%s\n' "$(phantom_repo_dir)/sessions"; }
phantom_runs_dir()         { printf '%s\n' "$(phantom_sessions_dir)/$1/runs"; }
phantom_run_dir()          { printf '%s\n' "$(phantom_runs_dir "$1")/$2"; }
phantom_current_run_pointer() { printf '%s\n' "$(phantom_runs_dir "$1")/current"; }
