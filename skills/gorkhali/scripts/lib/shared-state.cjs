// Author: Subash Karki
// shared-state.cjs -- the single, dependency-free codec that owns Gorkhali's
// mutable-state root resolution and repository identity. Every layer routes
// through it so the CommonJS compatibility scripts, the portable ESM skill, the
// shell resolver (via a small `node -e` call), and the runtime resolver adapter
// all agree on ONE data root and ONE repository id for the same workspace.
//
// It uses only Node built-ins (fs, path, crypto, child_process) so the portable
// skill that ships this file stays standalone -- it never reaches outside its
// own bundle.
//
// Two concerns live here:
//   1. Data root      -- GORKHALI_DATA else $HOME/.gorkhali else <workspace>/.gorkhali.
//   2. Repository id  -- a versioned, collision-resistant identity derived from
//                        the normalized origin remote (or the Git common root
//                        when there is no remote), with persisted aliases so a
//                        repo's earlier ids remain discoverable.

'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');

// Bump when the identity derivation changes in a way that yields different ids
// for the same repository. Older ids then survive as aliases (see recordAliases)
// so nothing is orphaned across a codec upgrade.
const CODEC_VERSION = 1;

// Canonical dirname for the neutral, provider-independent data root. GORKHALI_DATA
// overrides the full path; this dirname is used only for the $HOME and workspace
// fallbacks.
const ROOT_DIRNAME = '.gorkhali';

// Default ports stripped per scheme so ssh://host:22 and ssh://host converge.
// A non-default port is preserved because it distinguishes different remotes.
const DEFAULT_PORTS = { ssh: '22', https: '443', http: '80', git: '9418', ftp: '21' };

// ---------------------------------------------------------------------------
// Data root
// ---------------------------------------------------------------------------

/**
 * Resolve the Gorkhali data root. Precedence, all resolved against the workspace
 * (realpath'd when it exists so macOS /var -> /private/var symlinks agree):
 *   1. GORKHALI_DATA (absolute wins; relative resolves against the workspace).
 *   2. $HOME/.gorkhali.
 *   3. <workspace>/.gorkhali.
 * `env` is injectable so callers with their own environment map (the runtime
 * resolver adapter) resolve deterministically.
 */
function resolveDataRoot(workspace = process.cwd(), env = process.env) {
  const resolved = path.resolve(workspace || process.cwd());
  let base = resolved;
  try { base = fs.realpathSync(resolved); } catch (_) { /* nonexistent -> resolved */ }
  if (env.GORKHALI_DATA) return path.resolve(base, env.GORKHALI_DATA);
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
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return (cleaned || 'repository').toLowerCase();
}

/** Last path segment of a normalized remote (the repository name), or null. */
function repoNameFromNormalized(canonical) {
  if (!canonical) return null;
  const segment = canonical.split('/').filter(Boolean).pop();
  return segment || null;
}

/**
 * Legacy plain repository name from a RAW remote url: last path/scp segment,
 * minus a trailing `.git`, case preserved. This mirrors the pre-codec resolver
 * so its output can be recorded as an alias.
 */
function repoNameFromRemote(url) {
  let s = String(url || '').trim().replace(/[/\\]+$/, '');
  s = s.slice(s.lastIndexOf('/') + 1);
  s = s.slice(s.lastIndexOf(':') + 1);
  return s.replace(/\.git$/i, '');
}

function shortHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 10);
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
    aliases: [],
  };
}

function defaultIdentity(root) {
  return literalIdentity('_default', 'default', root || null);
}

/**
 * The pre-codec path-derived id for a repository WITHOUT an origin remote. The
 * old resolver hashed the realpath'd main root and prefixed the sanitized,
 * lowercased basename (`<basename>-<hash>`, e.g. `myrepo-a1b2c3d4e5`), whereas
 * the codec now uses the bare basename. Recording the old id as an alias keeps
 * sessions, pointers, and repos/<old-id> state created before the upgrade
 * discoverable. `root` must be the same realpath'd main root the identity uses,
 * so the hash matches byte-for-byte what the old algorithm produced.
 */
function pathDerivedLegacyId(root) {
  return `${sanitizeName(path.basename(root))}-${shortHash(root)}`;
}

/**
 * Compute the alias ids under which a remote-backed repository may already have
 * durable state: the legacy plain remote basename (both cases) and the
 * pre-normalization raw-hash id. The canonical id itself is never listed.
 */
function remoteAliases(rawRemote, canonicalId, canonicalName) {
  const legacyPlain = repoNameFromRemote(rawRemote);
  const rawHashId = `${sanitizeName(legacyPlain)}-${shortHash(rawRemote)}`;
  const aliases = new Set([
    legacyPlain,
    legacyPlain.toLowerCase(),
    canonicalName,
    rawHashId,
  ]);
  aliases.delete(canonicalId);
  return [...aliases].filter(Boolean);
}

/**
 * Resolve the repository identity for a workspace. Precedence -- first match
 * wins, never throws:
 *   1. cwd inside <data-root>/worktrees/<seg>/... -> that <seg> (Gorkhali-managed
 *      worktree; verbatim segment).
 *   2. GORKHALI_REPO override (verbatim, trimmed).
 *   3. Origin remote -> normalized -> `<name>-<hash>` (collision-resistant;
 *      SSH/HTTPS/renamed-clone/worktree all converge here).
 *   4. No remote -> Git common-dir main root basename (worktree-safe: the
 *      worktree and its main checkout resolve to the same plain id).
 *   5. Walk up to the first `.git` entry -> that dir's basename (git absent).
 *   6. `_default`.
 *
 * Options: { dataRoot, gorkhaliRepo, gitRunner }. `dataRoot` enables step 1;
 * `gorkhaliRepo` supplies step 2; `gitRunner(cwd, args)` is injectable for tests.
 */
function repoIdentity(cwd = process.cwd(), options = {}) {
  const git = options.gitRunner || defaultGitRunner;
  const dataRoot = options.dataRoot;
  const gorkhaliRepo = options.gorkhaliRepo;

  let resolvedCwd;
  try {
    resolvedCwd = path.resolve(cwd);
  } catch (_) {
    return defaultIdentity();
  }

  // (1) Gorkhali-managed worktree fast-path.
  if (dataRoot) {
    try {
      const realRoot = fs.realpathSync(path.join(dataRoot, 'worktrees'));
      const realCwd = fs.realpathSync(resolvedCwd);
      if (realCwd !== realRoot && realCwd.startsWith(realRoot + path.sep)) {
        const segment = realCwd.slice(realRoot.length + 1).split(path.sep)[0];
        if (segment) return literalIdentity(segment, 'worktree', realCwd);
      }
    } catch (_) { /* root or cwd unresolvable -> next step */ }
  }

  // (2) GORKHALI_REPO override (deterministic, verbatim).
  if (gorkhaliRepo && String(gorkhaliRepo).trim()) {
    return literalIdentity(String(gorkhaliRepo).trim(), 'env', resolvedCwd);
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
        aliases: remoteAliases(remote, id, name),
      };
    }

    // (4) No remote -> main root via Git common dir (worktree-safe).
    const commonDir = git(resolvedCwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (commonDir) {
      const root = realpathOr(path.dirname(path.resolve(resolvedCwd, commonDir)));
      const base = path.basename(root);
      if (base && base !== '.git' && base !== '.') {
        const legacyId = pathDerivedLegacyId(root);
        return {
          id: base,
          name: base,
          hash: null,
          root,
          source: root,
          remote: null,
          kind: 'common-dir',
          codec_version: CODEC_VERSION,
          aliases: legacyId === base ? [] : [legacyId],
        };
      }
    }

    // (5) Walk up to the first `.git` entry (dir or file).
    let dir = resolvedCwd;
    while (true) {
      if (fs.existsSync(path.join(dir, '.git'))) {
        const root = realpathOr(dir);
        const base = path.basename(root);
        if (base) {
          return {
            id: base,
            name: base,
            hash: null,
            root,
            source: root,
            remote: null,
            kind: 'walk-up',
            codec_version: CODEC_VERSION,
            aliases: [],
          };
        }
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

// ---------------------------------------------------------------------------
// Alias persistence (origin-change / legacy discoverability)
// ---------------------------------------------------------------------------

/** Reverse alias map location: <data-root>/repos/.aliases.json (alias -> canonical). */
function aliasMapPath(dataRoot) {
  return path.join(dataRoot, 'repos', '.aliases.json');
}

// Sentinel value for an AMBIGUOUS alias: a plain/legacy name (e.g. a bare repo
// basename) claimed by two or more DISTINCT canonical repos -- typically the same
// repository name under different owners. It is a non-string so resolveCanonical
// treats it as NO match (the id passes through unchanged) and a migrator cannot
// silently attribute the shared legacy dir to whichever repo was detected last;
// an explicit --map is required instead. Once ambiguous, an alias never reverts.
const AMBIGUOUS_ALIAS = { ambiguous: true };

function isAmbiguousValue(value) {
  return !!value && typeof value === 'object' && value.ambiguous === true;
}

function readAliasMap(dataRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(aliasMapPath(dataRoot), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/**
 * Persist an identity's aliases into the reverse map so a repository whose id
 * changed (origin rewrite, codec upgrade, legacy/plain/raw-hash history) stays
 * discoverable. Merge-only: existing entries are never dropped. No-ops for
 * identities without aliases (env override, worktree, no-remote, default).
 * Returns the resulting map.
 */
function recordAliases(dataRoot, identity) {
  const map = readAliasMap(dataRoot);
  if (!dataRoot || !identity || !identity.id) return map;
  if (!Array.isArray(identity.aliases) || identity.aliases.length === 0) return map;
  let changed = false;
  for (const alias of identity.aliases) {
    if (!alias || alias === identity.id) continue;
    const existing = map[alias];
    if (existing === identity.id) continue; // already ours
    if (isAmbiguousValue(existing)) continue; // already ambiguous -- never revert
    if (existing === undefined) {
      map[alias] = identity.id;
      changed = true;
    } else {
      // A DIFFERENT canonical id already claims this plain/legacy alias: two repos
      // share it (same basename, different owners). Do NOT last-write-win -- mark it
      // ambiguous so no migrator attributes the shared legacy dir to either repo.
      map[alias] = AMBIGUOUS_ALIAS;
      changed = true;
    }
  }
  if (map[identity.id] !== identity.id) {
    map[identity.id] = identity.id;
    changed = true;
  }
  if (changed) atomicWriteJson(aliasMapPath(dataRoot), map);
  return map;
}

/**
 * Map any known (possibly legacy/plain/raw-hash) id to its canonical id. An
 * unknown id -- and an AMBIGUOUS alias (a non-string sentinel) -- passes through
 * unchanged, so an ambiguous plain name is never silently collapsed onto a repo.
 */
function resolveCanonical(dataRoot, id) {
  const value = readAliasMap(dataRoot)[id];
  return typeof value === 'string' ? value : id;
}

/**
 * True when `id` is a KNOWN-ambiguous alias -- a plain/legacy name shared by two or
 * more distinct repos. resolveCanonical passes it through unchanged (safe for any
 * live writer resolving its own id), so migrators use this to distinguish it from a
 * merely-unknown id and route the shared legacy dir to their unresolved (explicit
 * --map required) path instead of importing it under an arbitrary repo.
 */
function isAmbiguousAlias(dataRoot, id) {
  return isAmbiguousValue(readAliasMap(dataRoot)[id]);
}

module.exports = {
  CODEC_VERSION,
  ROOT_DIRNAME,
  resolveDataRoot,
  normalizeRemote,
  repoIdentity,
  repoId,
  aliasMapPath,
  readAliasMap,
  recordAliases,
  resolveCanonical,
  isAmbiguousAlias,
  // Exposed for reuse and focused testing.
  sanitizeName,
  repoNameFromRemote,
  repoNameFromNormalized,
  shortHash,
};
