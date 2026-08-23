# Author: Subash Karki
# gorkhali-paths.sh — single source of truth for Gorkhali mutable-state root.
# Safe to `source` from other scripts: sets GORKHALI_DATA and
# GORKHALI_PLUGIN_ROOT (if unset), no `set -e`, no output.

gorkhali__absolute_path() {
  _gorkhali_candidate=$1
  _gorkhali_base=${2:-$PWD}
  case "$_gorkhali_candidate" in
    /*) ;;
    *) _gorkhali_candidate="$_gorkhali_base/$_gorkhali_candidate" ;;
  esac

  _gorkhali_result=
  _gorkhali_old_ifs=$IFS
  IFS=/
  case $- in *f*) _gorkhali_had_noglob=1 ;; *) _gorkhali_had_noglob=0; set -f ;; esac
  set -- $_gorkhali_candidate
  [ "$_gorkhali_had_noglob" -eq 1 ] || set +f
  IFS=$_gorkhali_old_ifs
  for _gorkhali_part do
    case "$_gorkhali_part" in
      ''|.) ;;
      ..) _gorkhali_result=${_gorkhali_result%/*} ;;
      *) _gorkhali_result="$_gorkhali_result/$_gorkhali_part" ;;
    esac
  done
  printf '%s\n' "${_gorkhali_result:-/}"
}

_gorkhali_workspace=$(pwd -P 2>/dev/null)
[ -n "$_gorkhali_workspace" ] || _gorkhali_workspace=$PWD
if [ -n "${GORKHALI_DATA:-}" ]; then
  GORKHALI_DATA=$(gorkhali__absolute_path "$GORKHALI_DATA" "$_gorkhali_workspace")
elif [ -n "${HOME:-}" ]; then
  GORKHALI_DATA=$(gorkhali__absolute_path "$HOME/.gorkhali" "$_gorkhali_workspace")
else
  GORKHALI_DATA=$(gorkhali__absolute_path ".gorkhali" "$_gorkhali_workspace")
fi
export GORKHALI_DATA

: "${GORKHALI_STATE_DIR:=$GORKHALI_DATA/state}"
: "${GORKHALI_AUDIT_DIR:=$GORKHALI_DATA/audit}"
: "${GORKHALI_GLOBAL_PATTERNS_DIR:=$GORKHALI_DATA/global/patterns}"
export GORKHALI_STATE_DIR GORKHALI_AUDIT_DIR GORKHALI_GLOBAL_PATTERNS_DIR

# Plugin root: script-relative self-location (env-free) — this lib lives at
# <root>/scripts/lib/, so root is two levels up. ${BASH_SOURCE:-$0}: bash sets
# BASH_SOURCE when sourced; zsh's $0 is the sourced file. cd runs in a subshell;
# empty on failure, never errors.
# NOTE: strict POSIX sh (e.g. dash, Ubuntu's /bin/sh) has NO portable way for a
# *sourced* file to self-locate - BASH_SOURCE is unset and $0 is the shell name,
# not this file. Callers under such shells MUST export GORKHALI_PLUGIN_ROOT before
# sourcing (all real callers are bash, where self-location works; the parity
# tests source under sh and set it explicitly).
if [ -z "${GORKHALI_PLUGIN_ROOT:-}" ]; then
  GORKHALI_PLUGIN_ROOT=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE:-$0}")/../.." 2>/dev/null && pwd)
fi
export GORKHALI_PLUGIN_ROOT

# Portable realpath: prefer the binary; else resolve dirs via cd + `pwd -P`
# (follows symlinks like fs.realpathSync in the JS mirror). Prints nothing on
# failure so callers can test with -n.
gorkhali__realpath() {
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
# PWD=$HOME). Same precedence as detectRepo() in gorkhali-paths.js, routed
# through the shared codec so all layers produce ONE id:
#   1. <data>/worktrees/<seg> fast-path (gorkhali-MANAGED worktrees only;
#      ~/.gorkhali-os/worktrees is NOT this root - those ride step 3/4)
#   2. GORKHALI_REPO env override (verbatim)
#   3. origin remote -> normalized -> `<name>-<hash>` (via codec)
#   4. no remote -> Git common-root basename (via codec; worktree-safe)
#   5. walk up to the first `.git` entry basename (via codec)
#   6. `_default`
# Steps 1-2 stay pure-shell (verbatim, node-free). Steps 3-6 delegate to the
# codec through a small `node -e` call so the hash matches the JS/ESM layers;
# if node is unavailable the shell degrades to a pure-shell walk-up. Never
# errors. Optional $1 overrides $PWD (used by tests).
gorkhali_detect_repo() {
  _pcwd=${1:-$PWD}

  # (1) gorkhali-managed <data>/worktrees/<seg> fast-path.
  _wtroot=$(gorkhali__realpath "$GORKHALI_DATA/worktrees")
  _rcwd=$(gorkhali__realpath "$_pcwd")
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

  # (2) GORKHALI_REPO override.
  if [ -n "${GORKHALI_REPO:-}" ]; then
    printf '%s\n' "$GORKHALI_REPO"
    return 0
  fi

  # (3-6) Delegate git-based identity to the shared codec via node so the shell
  # produces the SAME canonical id as the JS and ESM layers.
  _codec="$GORKHALI_PLUGIN_ROOT/skills/gorkhali/scripts/lib/shared-state.cjs"
  if command -v node >/dev/null 2>&1 && [ -f "$_codec" ]; then
    _id=$(node -e 'const c=require(process.argv[1]);process.stdout.write(String(c.repoId(process.argv[2],{dataRoot:process.env.GORKHALI_DATA,gorkhaliRepo:""})));' "$_codec" "$_pcwd" 2>/dev/null)
    if [ -n "$_id" ]; then
      printf '%s\n' "$_id"
      return 0
    fi
  fi

  # Fallback when node is unavailable: pure-shell walk up to the first `.git`
  # entry basename, else `_default`. This degraded path keeps the shell
  # non-fatal; the canonical remote id needs the codec.
  d=$_pcwd
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

# Per-repo dirs, all resolved at call time via gorkhali_detect_repo.
gorkhali_repo_dir()      { printf '%s\n' "$GORKHALI_DATA/repos/$(gorkhali_detect_repo)"; }

# Alias-aware learnings dir, mirroring resolveRepoSubdir() in gorkhali-paths.js:
# canonical wins when populated, else the first populated aliased dir, else the
# canonical path (so a first WRITE still has a stable target). The command layer
# reaches this dir by shelling out (commands/pause.md -> `gorkhali-learning.mjs
# capture --learnings <dir>`) and cannot require() the JS resolver, so without this
# the command layer would WRITE into the empty canonical dir while JS READS the
# aliased one - splitting the knowledge across two directories. Delegates through
# `node -e` exactly like gorkhali_detect_repo above (the JS side owns the alias-key
# shape check, so no path is ever built from a map key here). Never errors and never
# prints empty: any failure falls back to the canonical join.
gorkhali_learnings_dir() {
  _lrepo=$(gorkhali_detect_repo)
  _lcanonical="$GORKHALI_DATA/repos/$_lrepo/learnings"
  _lpaths="$GORKHALI_PLUGIN_ROOT/scripts/lib/gorkhali-paths.js"
  if command -v node >/dev/null 2>&1 && [ -f "$_lpaths" ]; then
    _ldir=$(node -e 'const p=require(process.argv[1]);process.stdout.write(String(p.resolveRepoSubdir(process.argv[2],"learnings")));' "$_lpaths" "$_lrepo" 2>/dev/null)
    if [ -n "$_ldir" ]; then
      printf '%s\n' "$_ldir"
      return 0
    fi
  fi
  printf '%s\n' "$_lcanonical"
}

gorkhali_sessions_dir()  { printf '%s\n' "$(gorkhali_repo_dir)/sessions"; }
gorkhali_runs_dir()         { printf '%s\n' "$(gorkhali_sessions_dir)/$1/runs"; }
gorkhali_run_dir()          { printf '%s\n' "$(gorkhali_runs_dir "$1")/$2"; }
gorkhali_current_run_pointer() { printf '%s\n' "$(gorkhali_runs_dir "$1")/current"; }
