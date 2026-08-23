// Author: Subash Karki
// phantom-paths.js — single source of truth for Phantom mutable-state paths.
// Path computation only: nothing here writes, and no mkdir happens at import
// time. Callers create directories as needed. One resolver, resolveRepoSubdir,
// READS the filesystem and the alias map to choose between a repo's canonical
// and aliased state dirs -- it still never writes.

'use strict';

const fs = require('fs');
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

// Alias ids become path segments, and the alias map is a JSON object keyed by
// directory names written by other processes -- untrusted input. A key like
// `../../etc` would escape <data>/repos, so the shape check is enforced at the one
// place a key can reach path.join (aliasCandidates below), not merely declared.
const ALIAS_ID_RE = /^[A-Za-z0-9._-]+$/;

function isSafeAliasId(id) {
  return ALIAS_ID_RE.test(id) && id !== '.' && id !== '..';
}

/** True when `dir` exists and holds at least one entry. Fail open: false on any read error. */
function isPopulatedDir(dir) {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Ids OTHER than `repo` that the alias map points at `repo`: the earlier ids
 * (legacy plain name, pre-normalization raw hash, pre-codec-upgrade) under which
 * this repo's durable state may still live. Reverse lookup, because the map is
 * stored alias -> canonical. Object.entries so only own enumerable keys are read
 * and a `constructor`/`__proto__` key from JSON.parse cannot reach through to a
 * prototype value.
 */
function aliasCandidates(repo) {
  return Object.entries(codec.readAliasMap(phantomData()))
    .filter(([id, canonical]) => canonical === repo && id !== repo && isSafeAliasId(id))
    .map(([id]) => id);
}

/**
 * Alias-aware resolution for a repo's durable state subdir. detectRepo() returns
 * the CANONICAL id, but the state can still sit under an earlier id that
 * <data>/repos/.aliases.json already maps to that canonical id -- a bare join then
 * reads an empty dir and the knowledge layer silently returns nothing.
 *
 * Order is the safety property: FRESH CANONICAL DATA ALWAYS WINS. An aliased dir
 * comes back only when the canonical one is absent or empty; reversing that would
 * silently serve stale knowledge. With neither populated the canonical path is
 * returned unchanged, so callers that CREATE the dir still get a stable target.
 *
 * Never throws: a missing or malformed alias map degrades to the canonical path
 * (readAliasMap already returns {} on any read/parse failure), matching how
 * detectRepo fails open above.
 */
function resolveRepoSubdir(repo, ...segments) {
  const canonical = path.join(repoDir(repo), ...segments);
  if (isPopulatedDir(canonical)) return canonical;
  for (const alias of aliasCandidates(repo)) {
    const candidate = path.join(repoDir(alias), ...segments);
    if (isPopulatedDir(candidate)) return candidate;
  }
  return canonical;
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

/**
 * Per-repo learnings dir: <data>/repos/<repo>/learnings, or the aliased dir that
 * actually holds the learnings (see resolveRepoSubdir).
 */
function learningsDir(repo = detectRepo()) { return resolveRepoSubdir(repo, 'learnings'); }

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
  aliasCandidates,
  resolveRepoSubdir,
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
