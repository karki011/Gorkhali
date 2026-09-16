// Author: Subash Karki
// paths.js - lean path resolver for the data root, the repo slug and session
// directories. Self-contained: no dependency on any other module in the
// tree.
// Reads the persisted physical-repository identity when present. Nothing writes or creates directories at
// import time.
'use strict';

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Root for all Gorkhali mutable state. GORKHALI_DATA overrides the default,
 * so hooks and tests can point it at a temporary root. An absolute override
 * wins as-is; a relative one resolves against cwd. With no override, the
 * root is $HOME/.gorkhali, falling back to <cwd>/.gorkhali when no home
 * directory is available.
 */
function dataRoot(cwd = process.cwd()) {
  const override = process.env.GORKHALI_DATA;
  if (override && override.trim()) {
    const value = override.trim();
    return path.isAbsolute(value) ? value : path.resolve(cwd, value);
  }
  const home = os.homedir();
  return path.join(home || cwd, '.gorkhali');
}

function runGit(args, cwd) {
  return execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
}

function repositoryIdentity(cwd = process.cwd()) {
  try { return fs.realpathSync(path.resolve(cwd, runGit('rev-parse --git-common-dir', cwd))); }
  catch (_) { return fs.realpathSync(cwd); }
}
function identityFile(cwd = process.cwd()) {
  const hash = crypto.createHash('sha256').update(repositoryIdentity(cwd)).digest('hex');
  return path.join(dataRoot(cwd), 'identities', `${hash}.json`);
}

/** Normalize a git remote URL into a stable `<name>-<hash>` slug. */
function normalizeRemote(remote) {
  let value = remote.trim();
  const scp = value.match(/^([^@\s]+)@([^:]+):(.+)$/);
  if (scp && !/^[a-z]+:\/\//i.test(value)) {
    value = `ssh://${scp[2]}/${scp[3]}`;
  }
  let host = '';
  let pathname = value;
  try {
    const url = new URL(value);
    host = url.hostname.toLowerCase();
    pathname = url.pathname;
  } catch (_) {
    // Not a parseable URL; use the raw string as the path component.
  }
  pathname = pathname.replace(/\.git$/, '').replace(/^\/+/, '');
  const normalized = `${host}/${pathname}`.toLowerCase();
  const name = path.basename(pathname) || 'repo';
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 10);
  return `${name}-${hash}`;
}

/**
 * Resolve the current repo slug. GORKHALI_REPO wins verbatim when set (per-
 * spawn override for hooks and tests). Otherwise: the persisted physical-repository
 * state ID, then the origin remote,
 * normalized and hashed; else the basename of the git main root; else the
 * basename of cwd; else '_default'. Never throws.
 */
function repoSlug(cwd = process.cwd()) {
  const override = process.env.GORKHALI_REPO;
  if (override && override.trim()) return override.trim();
  try {
    const saved = JSON.parse(fs.readFileSync(identityFile(cwd), 'utf8'));
    if (saved.identity === repositoryIdentity(cwd) && /^[A-Za-z0-9_.-]+$/.test(saved.repo) && !['.', '..'].includes(saved.repo)) return saved.repo;
  } catch (_) { /* First use resolves origin or local name below. */ }

  try {
    const remote = runGit('remote get-url origin', cwd);
    if (remote) return normalizeRemote(remote);
  } catch (_) {
    // No origin remote or git unavailable; fall through.
  }

  try {
    const commonDir = runGit('rev-parse --git-common-dir', cwd);
    if (commonDir) {
      const gitDir = path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir);
      const base = path.basename(path.dirname(gitDir));
      if (base) return base;
    }
  } catch (_) {
    // No git repo; fall through.
  }

  const cwdBase = path.basename(path.resolve(cwd));
  return cwdBase || '_default';
}

/** Per-repo state dir: <data>/repos/<repo> */
function repoDir(repo, cwd = process.cwd()) {
  if (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(repo) || ['.', '..'].includes(repo)) throw new Error('Invalid repository ID');
  return path.join(dataRoot(cwd), 'repos', repo);
}

/** Per-repo sessions dir: <data>/repos/<repo>/sessions */
function sessionsDir(repo, cwd = process.cwd()) {
  return path.join(repoDir(repo, cwd), 'sessions');
}

/** Per-task session dir: <data>/repos/<repo>/sessions/<task> */
function sessionDir(repo, task, cwd = process.cwd()) {
  if (typeof task !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(task) || ['.', '..'].includes(task)) throw new Error('Invalid task ID');
  return path.join(sessionsDir(repo, cwd), task);
}

/**
 * Real path of this checkout's own worktree (`git rev-parse --show-toplevel`),
 * falling back to the realpath of cwd outside Git. Unlike repositoryIdentity
 * (keyed on the shared git-common-dir), this differs per worktree, so each
 * checkout of a repository gets its own sentinel below.
 */
function checkoutIdentity(cwd = process.cwd()) {
  try { return fs.realpathSync(runGit('rev-parse --show-toplevel', cwd)); }
  catch (_) { return fs.realpathSync(cwd); }
}

/** Legacy machine-global active-session sentinel, kept only as a read/cleanup fallback: <data>/.session-active */
function legacySentinelPath(cwd = process.cwd()) {
  return path.join(dataRoot(cwd), '.session-active');
}

/** Path to the active-session sentinel, keyed by checkout so concurrent leads on one machine do not collide. */
function sentinelPath(cwd = process.cwd()) {
  const hash = crypto.createHash('sha256').update(checkoutIdentity(cwd)).digest('hex');
  return path.join(dataRoot(cwd), 'state', 'sessions', `${hash}.json`);
}

module.exports = {
  repositoryIdentity,
  identityFile,
  dataRoot,
  repoSlug,
  repoDir,
  sessionsDir,
  sessionDir,
  checkoutIdentity,
  legacySentinelPath,
  sentinelPath,
};
