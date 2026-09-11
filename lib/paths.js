// Author: Subash Karki
// paths.js - lean path resolver for the data root, the repo slug and session
// directories. Self-contained: no dependency on any module elsewhere in the
// tree, portable or otherwise, and no dependency on scripts/lib. Path
// computation only: nothing here writes, and no mkdir happens at import time.
'use strict';

const path = require('path');
const os = require('os');
const crypto = require('crypto');
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
 * spawn override for hooks and tests). Otherwise: the origin remote,
 * normalized and hashed; else the basename of the git main root; else the
 * basename of cwd; else '_default'. Never throws.
 */
function repoSlug(cwd = process.cwd()) {
  const override = process.env.GORKHALI_REPO;
  if (override && override.trim()) return override.trim();

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
  return path.join(dataRoot(cwd), 'repos', repo);
}

/** Per-repo sessions dir: <data>/repos/<repo>/sessions */
function sessionsDir(repo, cwd = process.cwd()) {
  return path.join(repoDir(repo, cwd), 'sessions');
}

/** Per-task session dir: <data>/repos/<repo>/sessions/<task> */
function sessionDir(repo, task, cwd = process.cwd()) {
  return path.join(sessionsDir(repo, cwd), task);
}

/** Path to the single active-session sentinel: <data>/.session-active */
function sentinelPath(cwd = process.cwd()) {
  return path.join(dataRoot(cwd), '.session-active');
}

module.exports = {
  dataRoot,
  repoSlug,
  repoDir,
  sessionsDir,
  sessionDir,
  sentinelPath,
};
