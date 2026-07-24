// Author: Subash Karki
// phantom-paths.js — single source of truth for Phantom mutable-state paths.
// Pure path computation: no side effects, no mkdir at import time.
// Callers create directories as needed.

'use strict';

const path = require('path');
const codec = require('../../skills/phantom/scripts/lib/shared-state.cjs');

/** Root for all Phantom mutable state. PHANTOM_DATA overrides the default. */
function phantomData(workspace = process.cwd()) {
  return codec.resolveDataRoot(workspace);
}

// Per-process memoization. Hooks are hot paths (detectRepo runs on every
// PreToolUse); a cold resolve shells out to git twice. Key on the inputs that
// change the answer — resolved cwd + PHANTOM_REPO + data root — so env flips
// (and tests) stay correct while the warm path is a single Map hit (<10ms).
const REPO_CACHE = new Map();

/**
 * Resolve the current repo id. The full precedence lives in the shared codec
 * (skills/phantom/scripts/lib/shared-state.cjs) so this CommonJS layer, the
 * portable ESM skill, and the shell resolver all agree on ONE id:
 *   1. cwd inside <data>/worktrees/<seg>/... -> that <seg> (Phantom-managed
 *      worktree; verbatim). NOTE: user worktrees at ~/.phantom-os/worktrees/ are
 *      NOT this root; they never hit this step and are resolved by (3)/(4).
 *   2. PHANTOM_REPO env override (per-spawn, verbatim; never export globally).
 *   3. Origin remote -> normalized -> `<name>-<hash>` (worktree- and
 *      clone-name-invariant; SSH/HTTPS/renamed clones converge; collision-safe
 *      across owners and hosts).
 *   4. `git rev-parse --git-common-dir` -> main-root basename. No-remote,
 *      worktree-safe fallback (common-dir points at the MAIN checkout's .git).
 *   5. Walk up to the first `.git` entry (dir or file) and take its basename.
 *   6. '_default'. Never throws; git absent/erroring degrades to (5).
 */
function detectRepo(cwd = process.cwd()) {
  let key;
  try {
    key = path.resolve(cwd) + '\0' + (process.env.PHANTOM_REPO || '') + '\0' + phantomData();
  } catch (_) {
    key = String(cwd);
  }
  if (REPO_CACHE.has(key)) return REPO_CACHE.get(key);
  const dataRoot = phantomData();
  const identity = codec.repoIdentity(cwd, {
    dataRoot,
    phantomRepo: process.env.PHANTOM_REPO,
  });
  // Persist this repo's aliases (legacy plain name, raw-hash, codec-upgrade ids)
  // into <data>/repos/.aliases.json so its earlier ids stay discoverable and the
  // migrators collapse them onto the canonical id. Merge-only: recordAliases writes
  // only when the map would change, and detection must never break on a write
  // failure, so fail open with the id still returned. Cold path only (memoized).
  try { codec.recordAliases(dataRoot, identity); } catch (_) { /* fail open */ }
  REPO_CACHE.set(key, identity.id);
  return identity.id;
}

/** Per-repo state dir: <data>/repos/<repoName> */
function repoDir(repoName) {
  return path.join(phantomData(), 'repos', repoName);
}

/** Per-repo event log dir: <data>/events/<repo> */
function eventsDir(repo) {
  return path.join(phantomData(), 'events', repo);
}

/** Observation capture dir: <data>/observations */
function observationsDir() {
  return path.join(phantomData(), 'observations');
}

/** Agent timing log dir: <data>/timing (per-repo <repo>.jsonl) */
function timingDir() {
  return path.join(phantomData(), 'timing');
}

/** Promoted global patterns dir: <data>/global/patterns */
function globalPatternsDir() {
  return path.join(phantomData(), 'global', 'patterns');
}

/** Hook/session state dir: <data>/state */
function stateDir()     { return path.join(phantomData(), 'state'); }

/**
 * Runtime session-telemetry dir: <data>/state/session-telemetry.
 * Per-repo `<repo>.json` = { session_id, cwd, ts } written by the
 * UserPromptSubmit hook. This is transient runtime telemetry and is kept
 * PHYSICALLY SEPARATE from the durable portable task pointer at
 * state/current-session/<repo>.json (owned by phantom-state.mjs), so a
 * per-prompt telemetry write can never overwrite the active task pointer.
 */
function sessionTelemetryDir() { return path.join(stateDir(), 'session-telemetry'); }

/** Path to a repo's runtime session-telemetry file. */
function sessionTelemetryFile(repo = detectRepo()) {
  return path.join(sessionTelemetryDir(), repo + '.json');
}

/** Per-repo session dir: <data>/repos/<repo>/sessions */
function sessionsDir(repo = detectRepo())  { return path.join(repoDir(repo), 'sessions'); }

/** Per-repo archived session dir: <data>/repos/<repo>/completed */
function completedDir(repo = detectRepo()) { return path.join(repoDir(repo), 'completed'); }

/** Per-repo learnings dir: <data>/repos/<repo>/learnings */
function learningsDir(repo = detectRepo()) { return path.join(repoDir(repo), 'learnings'); }

/** Audit log dir: <data>/audit */
function auditDir()     { return path.join(phantomData(), 'audit'); }

/** Per-ticket runs dir: <data>/repos/<repo>/sessions/<ticket>/runs */
function runsDir(ticket, repo = detectRepo()) { return path.join(sessionsDir(repo), ticket, 'runs'); }

/** Per-run artifact dir: <data>/repos/<repo>/sessions/<ticket>/runs/<ts> */
function runDir(ticket, ts, repo = detectRepo()) { return path.join(runsDir(ticket, repo), ts); }

/** Path to the current-run pointer file: <data>/repos/<repo>/sessions/<ticket>/runs/current */
function currentRunPointer(ticket, repo = detectRepo()) { return path.join(runsDir(ticket, repo), 'current'); }

/** Worktrees root: <data>/worktrees — FLAT, directly under the data root (NOT under repos/). */
function worktreesRoot() {
  return path.join(phantomData(), 'worktrees');
}

/** Per-ticket worktree: <data>/worktrees/<repo>/<ticket> */
function worktreeDir(ticket, repo = detectRepo()) {
  return path.join(worktreesRoot(), repo, ticket);
}

module.exports = {
  phantomData,
  detectRepo,
  repoDir,
  eventsDir,
  observationsDir,
  timingDir,
  globalPatternsDir,
  stateDir,
  sessionsDir,
  completedDir,
  learningsDir,
  auditDir,
  runsDir,
  runDir,
  currentRunPointer,
  worktreesRoot,
  worktreeDir,
  sessionTelemetryDir,
  sessionTelemetryFile,
};
