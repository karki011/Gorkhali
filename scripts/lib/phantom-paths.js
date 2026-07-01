// Author: Subash Karki
// phantom-paths.js — single source of truth for Phantom mutable-state paths.
// Pure path computation: no side effects, no mkdir at import time.
// Callers create directories as needed.

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let DATA_DIRNAME = 'phantom-data';
try {
  DATA_DIRNAME = require('./constants').PHANTOM_DATA_DIRNAME || DATA_DIRNAME;
} catch (_) { /* fail open: lib missing → inline default */ }

/** Root for all Phantom mutable state. PHANTOM_DATA overrides the default. */
function phantomData() {
  return process.env.PHANTOM_DATA || path.join(os.homedir(), '.claude', DATA_DIRNAME);
}

// Per-process memoization. Hooks are hot paths (detectRepo runs on every
// PreToolUse); a cold resolve shells out to git twice. Key on the inputs that
// change the answer — resolved cwd + PHANTOM_REPO + data root — so env flips
// (and tests) stay correct while the warm path is a single Map hit (<10ms).
const REPO_CACHE = new Map();

/**
 * Run a git subcommand, capturing trimmed stdout or null. Guards the RUN, not
 * just the precondition (per [guards]): a missing binary, non-git dir, timeout,
 * or nonzero exit all degrade to null and the caller falls through to the next
 * precedence step.
 */
function gitCapture(cwd, gitArgs) {
  try {
    const out = execSync('git ' + gitArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
      encoding: 'utf8',
    });
    const value = out.trim();
    return value || null;
  } catch (_) {
    return null;
  }
}

/** Repo name from a remote URL: last path/scp segment, minus a trailing .git. */
function repoNameFromRemote(url) {
  let s = url.trim().replace(/[/\\]+$/, '');
  s = s.slice(s.lastIndexOf('/') + 1);   // https/ssh path segment
  s = s.slice(s.lastIndexOf(':') + 1);   // scp-short host:repo (no slash)
  return s.replace(/\.git$/, '');
}

/**
 * Resolve the current repo name. Precedence (identical in phantom-paths.sh):
 *   1. cwd inside <data>/worktrees/<repo>/... -> that <repo> segment. Phantom-
 *      MANAGED worktrees only. NOTE: user worktrees at ~/.phantom-os/worktrees/
 *      are NOT this root — they never hit this step and are resolved by (3).
 *   2. PHANTOM_REPO env override (per-spawn; never export globally).
 *   3. `git remote get-url origin` basename minus .git — worktree-invariant and
 *      clone-name-invariant, so it survives the ~/.phantom-os/worktrees/{repo}/
 *      {branch} layout where a walk-up would return the BRANCH, not the repo.
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
  const result = resolveRepo(cwd);
  REPO_CACHE.set(key, result);
  return result;
}

function resolveRepo(cwd) {
  try {
    // (1) phantom-managed <data>/worktrees/<repo> fast-path.
    try {
      // realpath both sides: macOS tmp/home symlinks (/var -> /private/var).
      const realRoot = fs.realpathSync(worktreesRoot());
      const realCwd = fs.realpathSync(path.resolve(cwd));
      if (realCwd !== realRoot && realCwd.startsWith(realRoot + path.sep)) {
        const repo = realCwd.slice(realRoot.length + 1).split(path.sep)[0];
        if (repo) return repo;
      }
    } catch (_) { /* root or cwd unresolvable -> next step */ }

    // (2) PHANTOM_REPO override.
    const override = process.env.PHANTOM_REPO;
    if (override && override.trim()) return override.trim();

    const resolvedCwd = path.resolve(cwd);

    // (3) git remote origin basename.
    const remote = gitCapture(resolvedCwd, 'remote get-url origin');
    if (remote) {
      const name = repoNameFromRemote(remote);
      if (name) return name;
    }

    // (4) main-root basename via git common dir (no-remote / worktree-safe).
    const commonDir = gitCapture(resolvedCwd, 'rev-parse --path-format=absolute --git-common-dir');
    if (commonDir) {
      const name = path.basename(path.dirname(path.resolve(resolvedCwd, commonDir)));
      if (name && name !== '.git' && name !== '.') return name;
    }

    // (5) walk-up to the first .git entry basename.
    let dir = resolvedCwd;
    while (true) {
      if (fs.existsSync(path.join(dir, '.git'))) return path.basename(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break; // reached filesystem root
      dir = parent;
    }

    // (6) default.
    return '_default';
  } catch (_err) {
    return '_default';
  }
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
};
