# Author: Subash Karki
# phantom-paths.sh — single source of truth for Phantom mutable-state root.
# Safe to `source` from other scripts: sets PHANTOM_DATA and
# PHANTOM_PLUGIN_ROOT (if unset), no `set -e`, no output.

phantom__absolute_path() {
  _phantom_candidate=$1
  _phantom_base=${2:-$PWD}
  case "$_phantom_candidate" in
    /*) ;;
    *) _phantom_candidate="$_phantom_base/$_phantom_candidate" ;;
  esac

  _phantom_result=
  _phantom_old_ifs=$IFS
  IFS=/
  case $- in *f*) _phantom_had_noglob=1 ;; *) _phantom_had_noglob=0; set -f ;; esac
  set -- $_phantom_candidate
  [ "$_phantom_had_noglob" -eq 1 ] || set +f
  IFS=$_phantom_old_ifs
  for _phantom_part do
    case "$_phantom_part" in
      ''|.) ;;
      ..) _phantom_result=${_phantom_result%/*} ;;
      *) _phantom_result="$_phantom_result/$_phantom_part" ;;
    esac
  done
  printf '%s\n' "${_phantom_result:-/}"
}

_phantom_workspace=$(pwd -P 2>/dev/null)
[ -n "$_phantom_workspace" ] || _phantom_workspace=$PWD
if [ -n "${PHANTOM_DATA:-}" ]; then
  PHANTOM_DATA=$(phantom__absolute_path "$PHANTOM_DATA" "$_phantom_workspace")
elif [ -n "${HOME:-}" ]; then
  PHANTOM_DATA=$(phantom__absolute_path "$HOME/.phantom" "$_phantom_workspace")
else
  PHANTOM_DATA=$(phantom__absolute_path ".phantom" "$_phantom_workspace")
fi
export PHANTOM_DATA

: "${PHANTOM_STATE_DIR:=$PHANTOM_DATA/state}"
: "${PHANTOM_AUDIT_DIR:=$PHANTOM_DATA/audit}"
: "${PHANTOM_GLOBAL_PATTERNS_DIR:=$PHANTOM_DATA/global/patterns}"
export PHANTOM_STATE_DIR PHANTOM_AUDIT_DIR PHANTOM_GLOBAL_PATTERNS_DIR

# Plugin root: script-relative self-location (env-free) — this lib lives at
# <root>/scripts/lib/, so root is two levels up. ${BASH_SOURCE:-$0}: bash sets
# BASH_SOURCE when sourced; zsh's $0 is the sourced file. cd runs in a subshell;
# empty on failure, never errors.
# NOTE: strict POSIX sh (e.g. dash, Ubuntu's /bin/sh) has NO portable way for a
# *sourced* file to self-locate - BASH_SOURCE is unset and $0 is the shell name,
# not this file. Callers under such shells MUST export PHANTOM_PLUGIN_ROOT before
# sourcing (all real callers are bash, where self-location works; the parity
# tests source under sh and set it explicitly).
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

# Resolve repo id at CALL time, not source time (sourced at shell startup with
# PWD=$HOME). Same precedence as detectRepo() in phantom-paths.js, routed
# through the shared codec so all layers produce ONE id:
#   1. <data>/worktrees/<seg> fast-path with a validated safe segment
#      (phantom-MANAGED worktrees only;
#      ~/.phantom-os/worktrees is NOT this root - those ride step 3/4)
#   2. PHANTOM_REPO env override (one validated safe segment)
#   3. origin remote -> normalized -> `<name>-<hash>` (via codec)
#   4. no remote -> hashed canonical Git common root (via codec; worktree-safe)
#   5. walk up to the first `.git` entry -> hashed canonical root (via codec)
#   6. `_default`
# Steps 1-2 stay pure-shell after validation. Steps 3-6 delegate to the
# codec through a small `node -e` call so the hash matches the JS/ESM layers;
# without Node and the bundled codec, identity resolution fails closed instead
# of producing a divergent id. Optional $1 overrides $PWD (used by tests).
phantom_detect_repo() {
  _pcwd=${1:-$PWD}

  # (1) phantom-managed <data>/worktrees/<seg> fast-path.
  _wtroot=$(phantom__realpath "$PHANTOM_DATA/worktrees")
  _rcwd=$(phantom__realpath "$_pcwd")
  if [ -n "$_wtroot" ] && [ -n "$_rcwd" ] && [ "$_rcwd" != "$_wtroot" ]; then
    case "$_rcwd" in
      "$_wtroot"/*)
        _rest=${_rcwd#"$_wtroot"/}
        _repo=${_rest%%/*}
        case "$_repo" in
          ''|.|..|[!A-Za-z0-9_]*|*[!A-Za-z0-9._-]*) return 2 ;;
        esac
        if [ "${#_repo}" -le 120 ]; then
          printf '%s\n' "$_repo"
          return 0
        fi
        return 2
        ;;
    esac
  fi

  # (2) PHANTOM_REPO override.
  if [ -n "${PHANTOM_REPO:-}" ]; then
    case "$PHANTOM_REPO" in
      .|..|[!A-Za-z0-9_]*|*[!A-Za-z0-9._-]*)
        printf '%s\n' 'PHANTOM_REPO must be one safe path segment (1-120 characters).' >&2
        return 2
        ;;
    esac
    if [ "${#PHANTOM_REPO}" -gt 120 ]; then
      printf '%s\n' 'PHANTOM_REPO must be one safe path segment (1-120 characters).' >&2
      return 2
    fi
    printf '%s\n' "$PHANTOM_REPO"
    return 0
  fi

  # (3-6) Delegate git-based identity to the shared codec via node so the shell
  # produces the SAME canonical id as the JS and ESM layers.
  _codec="$PHANTOM_PLUGIN_ROOT/skills/phantom/scripts/lib/shared-state.cjs"
  if command -v node >/dev/null 2>&1 && [ -f "$_codec" ]; then
    _id=$(node -e 'const c=require(process.argv[1]);process.stdout.write(String(c.repoId(process.argv[2],{dataRoot:process.env.PHANTOM_DATA,phantomRepo:""})));' "$_codec" "$_pcwd" 2>/dev/null)
    if [ -n "$_id" ]; then
      printf '%s\n' "$_id"
      return 0
    fi
  fi

  printf '%s\n' 'Phantom repository identity requires Node and the bundled codec.' >&2
  return 2
}

# Per-repo dirs, all resolved at call time via phantom_detect_repo.
phantom_repo_dir() {
  _repo=$(phantom_detect_repo) || return $?
  printf '%s\n' "$PHANTOM_DATA/repos/$_repo"
}

# Current learnings always use the canonical repository id. Historical state is
# consolidated only by explicit offline migration commands.
phantom_learnings_dir() {
  _lrepo=$(phantom_detect_repo) || return $?
  printf '%s\n' "$PHANTOM_DATA/repos/$_lrepo/learnings"
}

phantom_sessions_dir() {
  _repo_dir=$(phantom_repo_dir) || return $?
  printf '%s\n' "$_repo_dir/sessions"
}

phantom_task_segment() {
  _codec="$PHANTOM_PLUGIN_ROOT/skills/phantom/scripts/lib/shared-state.cjs"
  if command -v node >/dev/null 2>&1 && [ -f "$_codec" ]; then
    node -e 'const c=require(process.argv[1]);process.stdout.write(c.taskPathSegment(process.argv[2]));' "$_codec" "$1"
    return $?
  fi
  printf '%s\n' 'Phantom task identity requires Node and the bundled codec.' >&2
  return 2
}

phantom_runs_dir() {
  _task_segment=$(phantom_task_segment "$1") || return $?
  _sessions_dir=$(phantom_sessions_dir) || return $?
  printf '%s\n' "$_sessions_dir/$_task_segment/runs"
}
phantom_run_dir() {
  _runs_dir=$(phantom_runs_dir "$1") || return $?
  printf '%s\n' "$_runs_dir/$2"
}

phantom_current_run_pointer() {
  _runs_dir=$(phantom_runs_dir "$1") || return $?
  printf '%s\n' "$_runs_dir/current"
}
