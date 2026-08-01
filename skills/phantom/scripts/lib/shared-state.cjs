// Author: Subash Karki
// shared-state.cjs -- the single, dependency-free codec that owns Phantom's
// mutable-state root resolution and repository identity. Every layer routes
// through it so the CommonJS scripts, the portable ESM skill, the
// shell resolver (via a small `node -e` call), and the runtime resolver adapter
// all agree on ONE data root and ONE repository id for the same workspace.
//
// It uses only Node built-ins (fs, path, crypto, child_process) so the portable
// skill that ships this file stays standalone -- it never reaches outside its
// own bundle.
//
// Two concerns live here:
//   1. Data root      -- PHANTOM_DATA else $HOME/.phantom else <workspace>/.phantom.
//   2. Repository id  -- a versioned, collision-resistant identity derived from
//                        the normalized origin remote (or the Git common root
//                        when there is no remote).
//
// Runtime identity is canonical-only. Historical aliases are handled solely by
// explicit offline migration/report tooling outside the portable skill bundle.

'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');

// Bump when the identity derivation changes in a way that yields different ids
// for the same repository. Moving state across codec versions is an explicit
// offline migration; runtime resolution never probes or writes earlier ids.
const CODEC_VERSION = 2;

// Canonical dirname for the neutral, provider-independent data root. PHANTOM_DATA
// overrides the full path; this dirname is used only for the $HOME and workspace
// fallbacks.
const ROOT_DIRNAME = '.phantom';

// Default ports stripped per scheme so ssh://host:22 and ssh://host converge.
// A non-default port is preserved because it distinguishes different remotes.
const DEFAULT_PORTS = { ssh: '22', https: '443', http: '80', git: '9418', ftp: '21' };

// ---------------------------------------------------------------------------
// Data root
// ---------------------------------------------------------------------------

/**
 * Resolve the Phantom data root. Precedence, all resolved against the workspace
 * (realpath'd when it exists so macOS /var -> /private/var symlinks agree):
 *   1. PHANTOM_DATA (absolute wins; relative resolves against the workspace).
 *   2. $HOME/.phantom.
 *   3. <workspace>/.phantom.
 * `env` is injectable so callers with their own environment map (the runtime
 * resolver adapter) resolve deterministically.
 */
function resolveDataRoot(workspace = process.cwd(), env = process.env) {
  const resolved = path.resolve(workspace || process.cwd());
  let base = resolved;
  try { base = fs.realpathSync(resolved); } catch (_) { /* nonexistent -> resolved */ }
  if (env.PHANTOM_DATA) return path.resolve(base, env.PHANTOM_DATA);
  if (env.HOME) return path.resolve(base, env.HOME, ROOT_DIRNAME);
  return path.join(base, ROOT_DIRNAME);
}

// ---------------------------------------------------------------------------
// Remote normalization
// ---------------------------------------------------------------------------

/** Strip a trailing `.git`, and leading/trailing slashes, from a URL path. */
function normalizePathSegment(value) {
  return String(value || '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
}

/**
 * Normalize an origin remote so equivalent SCP, SSH, and HTTPS forms of the
 * same repository converge to one canonical string. Lowercases the host, strips
 * credentials, strips the scheme's default port, strips a trailing `.git`, and
 * preserves owner/repository path case. Returns null for empty input.
 *
 * Examples that all converge to `github.com/Owner/Repo`:
 *   git@github.com:Owner/Repo.git
 *   ssh://git@github.com:22/Owner/Repo
 *   https://user:pass@GitHub.com/Owner/Repo.git
 */
function normalizeRemote(rawUrl) {
  if (!rawUrl) return null;
  const url = String(rawUrl).trim();
  if (!url) return null;

  const schemeMatch = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    let rest = schemeMatch[2];
    const firstSlash = rest.indexOf('/');
    const at = rest.indexOf('@');
    // Credentials live before the first path slash: strip user[:pass]@.
    if (at !== -1 && (firstSlash === -1 || at < firstSlash)) rest = rest.slice(at + 1);
    const slash = rest.indexOf('/');
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    const remainder = slash === -1 ? '' : rest.slice(slash + 1);
    let host = authority;
    let port = null;
    const colon = authority.lastIndexOf(':');
    if (colon !== -1 && /^\d+$/.test(authority.slice(colon + 1))) {
      host = authority.slice(0, colon);
      port = authority.slice(colon + 1);
    }
    host = host.toLowerCase();
    if (port !== null && DEFAULT_PORTS[scheme] === port) port = null;
    const authorityOut = port ? `${host}:${port}` : host;
    const pathOut = normalizePathSegment(remainder);
    return pathOut ? `${authorityOut}/${pathOut}` : authorityOut;
  }

  // SCP-short form: [user@]host:path, with no scheme and the colon before any
  // slash. The host part cannot contain `/` or `:`.
  const scpMatch = url.match(/^(?:[^/@]+@)?([^/:]+):(.+)$/);
  if (scpMatch) {
    const host = scpMatch[1].toLowerCase();
    const pathOut = normalizePathSegment(scpMatch[2]);
    return pathOut ? `${host}/${pathOut}` : host;
  }

  // Local path or other opaque remote: keep it deterministic, path case intact.
  return normalizePathSegment(url) || null;
}

// ---------------------------------------------------------------------------
// Name / hash helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a repository name for use as a path segment, matching the portable
 * skill's segment rules, then lowercase it. The lowercase form is the display
 * half of a remote-backed id; case-sensitivity that matters is preserved in the
 * hashed source, not the name.
 */
function sanitizeName(value) {
  const cleaned = String(value == null ? '' : value)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 109);
  return (cleaned || 'repository').toLowerCase();
}

/** Last path segment of a normalized remote (the repository name), or null. */
function repoNameFromNormalized(canonical) {
  if (!canonical) return null;
  const segment = canonical.split('/').filter(Boolean).pop();
  return segment || null;
}

/** Last repository name from a raw remote URL, preserving its original case. */
function repoNameFromRemote(url) {
  let s = String(url || '').trim().replace(/[/\\]+$/, '');
  s = s.slice(s.lastIndexOf('/') + 1);
  s = s.slice(s.lastIndexOf(':') + 1);
  return s.replace(/\.git$/i, '');
}

function shortHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 10);
}

/** Require a single, portable path segment for caller-supplied identities. */
function validateIdentitySegment(value, label = 'repository identity') {
  const segment = String(value == null ? '' : value).trim();
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,119}$/.test(segment)
    || segment === '.' || segment === '..') {
    throw new TypeError(`${label} must be one safe path segment (1-120 characters).`);
  }
  return segment;
}

/** Preserve the logical task id; reject values that cannot fit one encoded path segment. */
function taskIdentity(value, fallback = 'task') {
  const task = value == null || value === '' ? fallback : String(value);
  const bytes = Buffer.byteLength(task, 'utf8');
  if (bytes === 0 || bytes > 150 || task.includes('\0')) {
    throw new TypeError('Task id must contain 1-150 UTF-8 bytes and no NUL characters.');
  }
  return task;
}

/** Encode unsafe task ids losslessly while leaving existing safe ids unchanged. */
function taskPathSegment(value, fallback = 'task') {
  const task = taskIdentity(value, fallback);
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(task)
    && task !== '.' && task !== '..') return task;
  return `id~${Buffer.from(task, 'utf8').toString('base64url')}`;
}

function realpathOr(candidate) {
  try { return fs.realpathSync(candidate); } catch (_) { return path.resolve(candidate); }
}

// ---------------------------------------------------------------------------
// Git resolution
// ---------------------------------------------------------------------------

/**
 * Run a git subcommand, returning trimmed stdout or null. Guards the RUN, not
 * just the precondition: a missing binary, non-git dir, timeout, or nonzero
 * exit all degrade to null so the caller falls through to the next step.
 */
function defaultGitRunner(cwd, args) {
  try {
    const out = execFileSync('git', ['-C', cwd, ...args], {
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

function literalIdentity(id, kind, root) {
  return {
    id,
    name: id,
    hash: null,
    root: root || null,
    source: id,
    remote: null,
    kind,
    codec_version: CODEC_VERSION,
  };
}

function defaultIdentity(root) {
  return literalIdentity('_default', 'default', root || null);
}

function localIdentity(root, kind) {
  const canonicalRoot = realpathOr(root);
  const name = sanitizeName(path.basename(canonicalRoot));
  const hash = shortHash(canonicalRoot);
  return {
    id: `${name}-${hash}`,
    name,
    hash,
    root: canonicalRoot,
    source: canonicalRoot,
    remote: null,
    kind,
    codec_version: CODEC_VERSION,
  };
}

/**
 * Resolve the repository identity for a workspace. Precedence -- first match
 * wins. Filesystem and Git discovery failures degrade safely; invalid
 * caller-supplied path segments throw:
 *   1. cwd inside <data-root>/worktrees/<seg>/... -> that <seg> (Phantom-managed
 *      worktree; validated as one safe segment).
 *   2. PHANTOM_REPO override (trimmed and validated as one safe segment).
 *   3. Origin remote -> normalized -> `<name>-<hash>` (collision-resistant;
 *      SSH/HTTPS/renamed-clone/worktree all converge here).
 *   4. No remote -> hashed canonical Git common root (worktree-safe and
 *      collision-resistant across equal basenames).
 *   5. Walk up to the first `.git` entry -> hashed canonical root (git absent).
 *   6. `_default`.
 *
 * Options: { dataRoot, phantomRepo, gitRunner }. `dataRoot` enables step 1;
 * `phantomRepo` supplies step 2; `gitRunner(cwd, args)` is injectable for tests.
 */
function repoIdentity(cwd = process.cwd(), options = {}) {
  const git = options.gitRunner || defaultGitRunner;
  const dataRoot = options.dataRoot;
  const phantomRepo = options.phantomRepo;

  let resolvedCwd;
  try {
    resolvedCwd = path.resolve(cwd);
  } catch (_) {
    return defaultIdentity();
  }

  // (1) Phantom-managed worktree fast-path.
  let managedSegment = null;
  if (dataRoot) {
    try {
      const realRoot = fs.realpathSync(path.join(dataRoot, 'worktrees'));
      const realCwd = fs.realpathSync(resolvedCwd);
      if (realCwd !== realRoot && realCwd.startsWith(realRoot + path.sep)) {
        managedSegment = realCwd.slice(realRoot.length + 1).split(path.sep)[0];
      }
    } catch (_) { /* root or cwd unresolvable -> next step */ }
  }
  if (managedSegment) {
    return literalIdentity(
      validateIdentitySegment(managedSegment, 'Phantom worktree repository identity'),
      'worktree',
      resolvedCwd,
    );
  }

  // (2) PHANTOM_REPO override (deterministic and path-safe).
  if (phantomRepo && String(phantomRepo).trim()) {
    return literalIdentity(
      validateIdentitySegment(phantomRepo, 'PHANTOM_REPO'),
      'env',
      resolvedCwd,
    );
  }

  try {
    // (3) Origin remote -> canonical hashed id.
    const remote = git(resolvedCwd, ['config', '--get', 'remote.origin.url']);
    if (remote) {
      const canonical = normalizeRemote(remote);
      const name = sanitizeName(repoNameFromNormalized(canonical) || repoNameFromRemote(remote));
      const hash = shortHash(canonical);
      const id = `${name}-${hash}`;
      const root = realpathOr(git(resolvedCwd, ['rev-parse', '--show-toplevel']) || resolvedCwd);
      return {
        id,
        name,
        hash,
        root,
        source: canonical,
        remote,
        kind: 'remote',
        codec_version: CODEC_VERSION,
      };
    }

    // (4) No remote -> hashed canonical main root via Git common dir.
    const commonDir = git(resolvedCwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (commonDir) {
      const root = realpathOr(path.dirname(path.resolve(resolvedCwd, commonDir)));
      if (path.basename(root) !== '.git' && path.basename(root) !== '.') {
        return localIdentity(root, 'common-dir');
      }
    }

    // (5) Walk up to the first `.git` entry (dir or file).
    let dir = resolvedCwd;
    while (true) {
      if (fs.existsSync(path.join(dir, '.git'))) {
        const root = realpathOr(dir);
        if (path.basename(root)) return localIdentity(root, 'walk-up');
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    // (6) Default.
    return defaultIdentity(resolvedCwd);
  } catch (_) {
    return defaultIdentity(resolvedCwd);
  }
}

/** Convenience: the repository id string for a workspace. */
function repoId(cwd = process.cwd(), options = {}) {
  return repoIdentity(cwd, options).id;
}

module.exports = {
  CODEC_VERSION,
  ROOT_DIRNAME,
  resolveDataRoot,
  normalizeRemote,
  repoIdentity,
  repoId,
  // Exposed for reuse and focused testing.
  sanitizeName,
  repoNameFromRemote,
  repoNameFromNormalized,
  shortHash,
  taskIdentity,
  taskPathSegment,
  validateIdentitySegment,
};
