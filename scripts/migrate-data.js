#!/usr/bin/env node
// Author: Subash Karki
// migrate-data.js -- dry-run-FIRST, fingerprinted, migration-wide-locked migrator
// that consolidates every historical Gorkhali data root into the ONE canonical
// neutral root (<data> resolved by the T1 codec -- ~/.gorkhali by default).
//
// Design goals (contract T4):
//   * The DEFAULT invocation is a DRY-RUN that performs ZERO filesystem writes
//     and emits the full per-item plan/manifest as JSON on stdout. Nothing on
//     disk -- source OR destination -- changes.
//   * APPLY is opt-in and gated: it requires BOTH --apply AND a manifest from a
//     prior dry-run (--manifest <path>). Without a reviewed plan it fails closed.
//   * External sources are never renamed, deleted, or symlinked; their bytes are
//     byte-identical after apply. The existing <data> root is the DESTINATION
//     BASELINE (not an immutable source): before a merge modifies a pre-existing
//     canonical file, its original bytes are copied to a content-addressed
//     rollback backup and both hashes are recorded in the manifest.
//   * Repository ids are mapped through the T1 identity codec + persisted aliases.
//     An id with zero/ambiguous mapping stays 'unresolved' and requires an
//     explicit --map <srcId>=<canonicalId>; it is NEVER guessed.
//   * Fingerprinting drives the per-item class: identical bytes at the canonical
//     path DEDUPLICATE; different bytes CONFLICT-PARK under a deterministic
//     source/content-hash suffix (the baseline is never overwritten); learnings
//     merge semantically through the T3 learning API.
//   * Apply takes a migration-wide lock for the whole inventory/copy window and
//     fails closed rather than running unlocked or concurrently. Learning merges
//     route through the T3 per-learnings-dir lock and per-repo writes through the
//     gorkhali-state lifecycle lock, so a concurrent state writer that races the
//     migration blocks or fails closed.
//
// Modes:
//   node migrate-data.js                          dry-run (default); manifest -> stdout
//   node migrate-data.js --apply --manifest <p>   apply using the prior dry-run manifest
//   --map <srcId>=<canonicalId>                   pin an ambiguous repo id (repeatable)
//   --force                                       apply: ignore the marker; rescan
//
// NEVER run apply against the real machine outside a gated, signed-off step
// (contract T6). Fixtures drive every test; env overrides isolate the roots.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { gorkhaliData } = require('./lib/gorkhali-paths');
const codec = require('../skills/gorkhali/scripts/lib/shared-state.cjs');
const learningGrammar = require('../skills/gorkhali/scripts/lib/learning-grammar.cjs');

const MIGRATION_VERSION = 3;
const MANIFEST_SCHEMA = 1;

// Top-level artifact-class dirs scanned in every source root. Repo-scoped state
// lives under `repos/<id>/...` (mapped through the codec); everything else maps
// path-for-path into the destination root.
const WHITELIST_DIRS = [
  'sessions',
  'completed',
  'learnings',
  'observations',
  'audit',
  'repos',
  'global',
  'timing',
  'events',
  'state',
  'brain',
  'decisions',
  'research',
];

// Suffixes appended by prior non-destructive sweeps. They are stripped (possibly
// repeatedly, e.g. `.migrated-away-migrated`) to recover the underlying repo id
// before mapping, so a preserved orphan still lands in its canonical repo.
const MIGRATED_SUFFIXES = ['.migrated-away-migrated', '.migrated-away', '.migrated'];

// Reserved repo buckets that aggregate unrelated sessions -- kept verbatim (never
// attributed to a single canonical repo).
const RESERVED_REPO_IDS = new Set(['_default']);

const CLASSES = [
  'imported',
  'deduplicated',
  'conflict-parked',
  'unresolved',
  'skipped-live-state',
];

const LOCK_STALE_MS = positiveNumber(process.env.GORKHALI_MIGRATE_LOCK_STALE_MS, 5 * 60 * 1000);

// --------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sha256File(file) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function sha256Bytes(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function shortDigest(digest) {
  // digest is `sha256:<hex>`; take a stable 12-char slice for deterministic
  // park/backup suffixes.
  return String(digest).replace(/^sha256:/, '').slice(0, 12);
}

function safeLabel(value) {
  return String(value || 'source').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
}

function realpathOr(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch (_) {
    return path.resolve(candidate);
  }
}

function isDir(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch (_) {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function atomicWriteText(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

// Copy one source file to dest without following symlinks and preserving mtime.
// COPYFILE_EXCL guards against clobbering a file that appeared after planning.
function copyFileExcl(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  try {
    const stat = fs.lstatSync(src);
    fs.utimesSync(dest, stat.atime, stat.mtime);
  } catch (_) {
    // Timestamp preservation is best effort; bytes are what matter.
  }
}

// --------------------------------------------------------------------------
// Source registry (realpath-deduped)
// --------------------------------------------------------------------------

// On a case-insensitive filesystem ~/.Codex and ~/.codex resolve to the SAME
// inode; scanning both would manufacture false self-collisions. Sources are
// deduped by realpath, and any source that resolves to the destination baseline
// is dropped (the baseline is a merge target, not a source).
function buildSources(dest, env) {
  // Defaults are migration-only source roots (never operational roots). They are
  // written as full os.homedir()-composed literals so the legacy-root policy
  // scanner sees each in its migration context. Every root is env-overridable.
  const declared = [
    {
      label: 'gorkhali-data',
      root: env.GORKHALI_MIGRATE_SRC_GORKHALI_DATA
        || path.join(os.homedir(), '.claude', 'gorkhali-data'),
    },
    {
      label: 'codex-upper',
      root: env.GORKHALI_MIGRATE_SRC_CODEX_UPPER || path.join(os.homedir(), '.Codex', 'gorkhali'),
    },
    {
      label: 'codex-lower',
      root: env.GORKHALI_MIGRATE_SRC_CODEX_LOWER || path.join(os.homedir(), '.codex', 'gorkhali'),
    },
    {
      label: 'gorkhali',
      root: env.GORKHALI_MIGRATE_SRC_GORKHALI || path.join(os.homedir(), '.claude', 'gorkhali'),
    },
    {
      label: 'team',
      root: env.GORKHALI_MIGRATE_SRC_TEAM || path.join(os.homedir(), '.claude', 'team'),
    },
  ];

  const destReal = realpathOr(dest);
  const seen = new Map();
  const sources = [];
  for (const source of declared) {
    const present = isDir(source.root);
    const real = present ? realpathOr(source.root) : path.resolve(source.root);
    if (present && real === destReal) {
      sources.push({ ...source, present, realpath: real, skipped: 'source-is-destination' });
      continue;
    }
    if (present && seen.has(real)) {
      sources.push({ ...source, present, realpath: real, skipped: `alias-of-${seen.get(real)}` });
      continue;
    }
    if (present) seen.set(real, source.label);
    sources.push({ ...source, present, realpath: real });
  }
  return sources;
}

// --------------------------------------------------------------------------
// Repository id mapping (codec + aliases + --map; ambiguous -> unresolved)
// --------------------------------------------------------------------------

function stripMigratedSuffixes(id) {
  let base = id;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of MIGRATED_SUFFIXES) {
      if (base.length > suffix.length && base.endsWith(suffix)) {
        base = base.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return base;
}

// Resolve a source `repos/<id>` segment to its canonical destination id.
// Precedence: explicit --map (raw or base) > codec alias > self-canonical.
//
// The default is PRESERVE: a safe id is kept as-is (never merged onto another repo
// by guesswork). Duplicate hashed ids therefore migrate as DISTINCT dirs unless an
// alias or --map explicitly collapses them, and branch-name fragments are preserved
// for the repo-dirs sweep to consolidate. Only an id that cannot be safely
// materialized as a path segment is 'unresolved' and requires an explicit --map.
function mapRepoId(rawId, context) {
  const { mapOverrides, dest } = context;
  const base = stripMigratedSuffixes(rawId);

  if (mapOverrides[rawId]) return { status: 'resolved', id: mapOverrides[rawId], via: 'map' };
  if (mapOverrides[base]) return { status: 'resolved', id: mapOverrides[base], via: 'map' };

  if (!isSafeSegment(base)) {
    return {
      status: 'unresolved',
      id: base,
      reason: 'unsafe repo id segment; provide --map <srcId>=<canonicalId>',
    };
  }

  if (RESERVED_REPO_IDS.has(base)) return { status: 'resolved', id: base, via: 'reserved' };

  // A known-ambiguous plain/legacy name (shared basename across owners) must never
  // be auto-attributed -- resolveCanonical passes it through unchanged, so without
  // this it would fall to the self-preserve below and cross-mix distinct repos'
  // state. Route it to unresolved; an explicit --map is the only safe resolution.
  if (codec.isAmbiguousAlias(dest, base)) {
    return {
      status: 'unresolved',
      id: base,
      reason: 'ambiguous legacy repo id (shared basename across repos); provide --map <srcId>=<canonicalId>',
    };
  }

  const canonical = codec.resolveCanonical(dest, base);
  if (canonical && canonical !== base) return { status: 'resolved', id: canonical, via: 'alias' };

  // Preserve the id verbatim; the data-root migrator never guesses a cross-repo
  // merge (the repo-dirs sweep resolves branch-name fragments separately).
  return { status: 'resolved', id: base, via: 'self' };
}

// --------------------------------------------------------------------------
// Canonical destination + live-state classification
// --------------------------------------------------------------------------

// Runtime, per-process state that must never be copied into the canonical root:
// the runtime session-telemetry, stale active markers under state/, and the
// current-session pointers (reconstructed separately with identity validation).
//
// Managed worktrees (<root>/worktrees) and the active-editing markers
// (.chief-active/.engineer-editing, and their pre-rename spellings
// .apex-active/.blade-editing) live as root-level SIBLINGS of the WHITELIST_DIRS
// entries, not inside them. inventory() below only walks
// `source.root/<WHITELIST_DIRS entry>/...`, so relParts[0] here is always a
// WHITELIST_DIRS entry -- these root-level paths never reach this classifier;
// the whitelist walk itself is what excludes them from migration. See the
// "root-level runtime state is never inventoried" test in migrate-data.test.js.
function liveStateReason(relParts) {
  const [top, second] = relParts;
  if (top !== 'state') return null;
  if (second === 'current-session') return 'current-session-pointer';
  if (second === 'session-telemetry') return 'runtime-session-telemetry';
  if (second === 'routing-nudge') return 'stale-active-marker';
  if (second === 'memory-injected') return 'stale-active-marker';
  if (second && second.startsWith('.active-wake-session')) return 'stale-active-marker';
  return null;
}

// The artifact class for per-root/per-artifact counting: the top-level dir, or
// `repos/<class>` collapsed to the repo tree's inner class where useful.
function artifactClass(relParts) {
  if (relParts[0] === 'repos' && relParts.length >= 3) return `repos/${relParts[2]}`;
  return relParts[0] || 'root';
}

// Map a source-relative path to its canonical destination path, applying repo-id
// mapping under `repos/<id>/...`. Returns { dest, artifact } or { unresolved }.
function canonicalDest(relPath, context) {
  const parts = relPath.split(path.sep);
  if (parts[0] === 'repos' && parts.length >= 2) {
    const mapping = mapRepoId(parts[1], context);
    if (mapping.status === 'unresolved') {
      return { unresolved: true, rawId: parts[1], baseId: mapping.id, reason: mapping.reason };
    }
    const rest = parts.slice(2);
    return {
      dest: path.join(context.dest, 'repos', mapping.id, ...rest),
      artifact: rest.length ? `repos/${rest[0]}` : 'repos',
      repoId: mapping.id,
      mapVia: mapping.via,
    };
  }
  return {
    dest: path.join(context.dest, ...parts),
    artifact: artifactClass(parts),
    repoId: null,
  };
}

function isLearningsMerge(relParts) {
  return relParts.includes('learnings') && relParts[relParts.length - 1].endsWith('.md');
}

// --------------------------------------------------------------------------
// Inventory: walk every source, classify every file. Pure reads.
// --------------------------------------------------------------------------

function* walkFiles(root, base = root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full, base);
    } else if (entry.isFile()) {
      yield { file: full, rel: path.relative(base, full) };
    }
    // Symlinks and special files are intentionally skipped (never copied).
  }
}

function parkPath(item) {
  return `${item.dest}.from-${safeLabel(item.source)}.${shortDigest(item.digest)}`;
}

// Describe a file WITHOUT deciding its class-vs-destination yet: computes its
// digest, live-state/unresolved status, and canonical destination. Live-state and
// unresolved items are fully classified here (they need no destination compare).
function describeItem(source, rel, srcFile, context) {
  const relParts = rel.split(path.sep);
  const base = { source: source.label, src: srcFile, srcRel: rel, digest: sha256File(srcFile) };

  const live = liveStateReason(relParts);
  if (live) return { ...base, class: 'skipped-live-state', reason: live, artifact: artifactClass(relParts) };

  const mapped = canonicalDest(rel, context);
  if (mapped.unresolved) {
    return { ...base, class: 'unresolved', rawId: mapped.rawId, reason: mapped.reason, artifact: 'repos' };
  }
  return { ...base, dest: mapped.dest, artifact: mapped.artifact, repoId: mapped.repoId, relParts };
}

// Decide a resolvable item's class against BOTH the real baseline and the virtual
// destination accumulated so far this run (so the dry-run plan truthfully predicts
// intra-migration collisions -- two sources targeting one new path). Higher-priority
// sources are visited first, so they claim the canonical path and later sources
// dedup (identical bytes) or park (different bytes). Learnings files merge instead
// of parking. plannedDests maps a claimed canonical path to its winning digest.
function resolveClass(item, plannedDests) {
  const learnings = isLearningsMerge(item.relParts);

  if (plannedDests.has(item.dest)) {
    if (plannedDests.get(item.dest) === item.digest) {
      item.class = 'deduplicated';
      return;
    }
    if (learnings) {
      item.class = 'imported';
      item.merge = 'learnings';
      return;
    }
    item.class = 'conflict-parked';
    item.parked = parkPath(item);
    item.reason = 'different-bytes-at-canonical-path';
    return;
  }

  let destStat = null;
  try {
    destStat = fs.lstatSync(item.dest);
  } catch (_) {
    // baseline absent -> import
  }

  if (!destStat) {
    item.class = 'imported';
    plannedDests.set(item.dest, item.digest);
    return;
  }
  if (destStat.isDirectory()) {
    // A file whose canonical path is occupied by a directory is a structural
    // conflict; park it deterministically rather than fight the tree shape.
    item.class = 'conflict-parked';
    item.parked = parkPath(item);
    item.reason = 'destination-path-is-directory';
    return;
  }

  const destDigest = sha256File(item.dest);
  item.destDigest = destDigest;
  if (destDigest === item.digest) {
    item.class = 'deduplicated';
    return;
  }
  if (learnings) {
    // Append-only, line-deduped merge through the T3 lock. This MODIFIES a
    // pre-existing baseline file, so it carries a rollback backup on apply.
    item.class = 'imported';
    item.merge = 'learnings';
    return;
  }
  item.class = 'conflict-parked';
  item.parked = parkPath(item);
  item.reason = 'different-bytes-at-canonical-path';
}

const CURRENT_SESSION_PREFIX = path.join('state', 'current-session') + path.sep;

function inventory(context) {
  const priority = new Map(context.sources.map((source, index) => [source.label, index]));
  const described = [];
  for (const source of context.sources) {
    if (!source.present || source.skipped) continue;
    for (const dir of WHITELIST_DIRS) {
      const root = path.join(source.root, dir);
      if (!isDir(root)) continue;
      for (const { file, rel } of walkFiles(root)) {
        const relFull = path.join(dir, rel);
        // Current-session pointers are not raw-copied; the pointer phase below
        // reconstructs the valid ones with codec-canonical identity remapping.
        if (relFull.startsWith(CURRENT_SESSION_PREFIX)) continue;
        described.push(describeItem(source, relFull, file, context));
      }
    }
  }
  // Deterministic order: source priority, then canonical/source path -- so the
  // highest-priority source claims each contested canonical path.
  described.sort((a, b) => {
    const bySource = (priority.get(a.source) ?? 0) - (priority.get(b.source) ?? 0);
    if (bySource) return bySource;
    return (a.dest || a.src).localeCompare(b.dest || b.src);
  });

  const plannedDests = new Map();
  for (const item of described) {
    if (!item.class) resolveClass(item, plannedDests);
    delete item.relParts;
  }
  return [...described, ...inventoryPointers(context)];
}

// --------------------------------------------------------------------------
// Current-session pointer reconstruction
//
// A pointer is only reconstructed when it is a portable-v1 record whose backing
// session is genuinely active/paused and whose workspace still resolves to the
// pointer's repo id through the codec. The reconstructed pointer is remapped to
// the codec-canonical repo id and the destination session dir; the destination
// baseline pointer always wins a collision (a live pointer is never parked).
// --------------------------------------------------------------------------

function classifyPointerSchema(pointer) {
  if (pointer && pointer.schema_version === 1
    && typeof pointer.repo_id === 'string' && typeof pointer.task_id === 'string') {
    return 'portable-v1';
  }
  if (pointer && typeof pointer.session_id === 'string' && typeof pointer.cwd === 'string') {
    return 'legacy-hook';
  }
  return 'unknown';
}

function isSafeSegment(value) {
  return typeof value === 'string'
    && value !== '.' && value !== '..'
    && /^[A-Za-z0-9._-]+$/.test(value)
    && value.length <= 120;
}

function validateSourceSession(session, pointer) {
  if (!session || session.schema_version !== 1 || session.artifact_type !== 'session') {
    return 'invalid-session-envelope';
  }
  if (session.repo_id !== pointer.repo_id || session.task_id !== pointer.task_id) {
    return 'session-identity-mismatch';
  }
  if (!['active', 'paused'].includes(session.status)) return 'session-is-not-current';
  if (typeof session.workspace !== 'string' || !session.workspace) return 'missing-session-workspace';
  let identity = null;
  try {
    identity = codec.repoIdentity(session.workspace);
  } catch (_) {
    identity = null;
  }
  if (!identity || identity.id !== pointer.repo_id) return 'workspace-repo-identity-mismatch';
  return null;
}

function describePointer(source, file, context) {
  const pointer = readJson(file);
  const base = {
    source: source.label,
    src: file,
    srcRel: path.relative(source.root, file),
    artifact: 'state/current-session',
    kind: 'pointer',
    digest: sha256File(file),
  };
  const schema = classifyPointerSchema(pointer);
  if (schema !== 'portable-v1') {
    return { ...base, class: 'skipped-live-state', reason: `unsupported-${schema}-pointer` };
  }
  if (!isSafeSegment(pointer.repo_id) || !isSafeSegment(pointer.task_id)) {
    return { ...base, class: 'skipped-live-state', reason: 'unsafe-pointer-segment' };
  }
  if (path.basename(file) !== `${pointer.repo_id}.json`) {
    return { ...base, class: 'skipped-live-state', reason: 'pointer-filename-mismatch' };
  }
  const sourceSession = readJson(path.join(source.root, 'repos', pointer.repo_id, 'sessions', pointer.task_id, 'session.json'));
  const sessionReason = validateSourceSession(sourceSession, pointer);
  if (sessionReason) return { ...base, class: 'skipped-live-state', reason: `source-${sessionReason}` };

  const canonicalRepoId = codec.resolveCanonical(context.dest, pointer.repo_id);
  const destSessionDir = path.join(context.dest, 'repos', canonicalRepoId, 'sessions', pointer.task_id);
  const destPointer = path.join(context.dest, 'state', 'current-session', `${canonicalRepoId}.json`);
  const reconstructed = {
    schema_version: 1,
    repo_id: canonicalRepoId,
    task_id: pointer.task_id,
    session_dir: destSessionDir,
    updated_at: pointer.updated_at || new Date().toISOString(),
  };
  const item = {
    ...base,
    dest: destPointer,
    repoId: canonicalRepoId,
    destSessionDir,
    pointerContent: reconstructed,
  };
  const existing = readJson(destPointer);
  if (existing) {
    item.class = JSON.stringify(existing) === JSON.stringify(reconstructed)
      ? 'deduplicated'
      : 'skipped-live-state';
    if (item.class === 'skipped-live-state') item.reason = 'destination-pointer-exists';
    return item;
  }
  item.class = 'imported';
  return item;
}

function inventoryPointers(context) {
  const items = [];
  for (const source of context.sources) {
    if (!source.present || source.skipped) continue;
    const dir = path.join(source.root, 'state', 'current-session');
    let names;
    try {
      names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
    } catch (_) {
      continue;
    }
    for (const name of names) {
      items.push(describePointer(source, path.join(dir, name), context));
    }
  }
  return items;
}

// --------------------------------------------------------------------------
// Counts + manifest
// --------------------------------------------------------------------------

function emptyClassCounts() {
  const counts = {};
  for (const cls of CLASSES) counts[cls] = 0;
  return counts;
}

function tallyCounts(items, sources) {
  const byClass = emptyClassCounts();
  const byRoot = {};
  const byArtifact = {};
  for (const source of sources) byRoot[source.label] = emptyClassCounts();
  for (const item of items) {
    byClass[item.class] += 1;
    (byRoot[item.source] || (byRoot[item.source] = emptyClassCounts()))[item.class] += 1;
    const artifact = item.artifact || 'root';
    (byArtifact[artifact] || (byArtifact[artifact] = emptyClassCounts()))[item.class] += 1;
  }
  return { byClass, byRoot, byArtifact };
}

function buildManifest(context, items, mode, extra = {}) {
  const unresolvedIds = [];
  const seenUnresolved = new Set();
  for (const item of items) {
    if (item.class !== 'unresolved') continue;
    const key = `${item.source}::${item.rawId}`;
    if (seenUnresolved.has(key)) continue;
    seenUnresolved.add(key);
    unresolvedIds.push({ source: item.source, id: item.rawId, reason: item.reason });
  }
  return {
    schemaVersion: MANIFEST_SCHEMA,
    migrationVersion: MIGRATION_VERSION,
    mode,
    generatedAt: new Date().toISOString(),
    dest: context.dest,
    map: context.mapOverrides,
    sources: context.sources.map((source) => ({
      label: source.label,
      root: source.root,
      present: source.present,
      realpath: source.realpath,
      ...(source.skipped ? { skipped: source.skipped } : {}),
    })),
    counts: tallyCounts(items, context.sources),
    unresolvedIds,
    items,
    ...extra,
  };
}

// --------------------------------------------------------------------------
// Migration-wide lock (fail-safe ownership parse; see learning
// lockfile-create-write-window). Lives under <dest>/locks so it is visible to
// every state writer that shares that lock directory.
// --------------------------------------------------------------------------

function migrationLockPath(dest) {
  return path.join(dest, 'locks', '.data-migration.lock');
}

// True when a data-root migration currently holds the migration-wide lock. Other
// state writers (e.g. the repo-dirs sweep) call this to fail closed rather than
// mutate state during the migration window. A stale lock (dead owner or aged past
// the window) does not count as in-progress.
function isDataMigrationInProgress(dest) {
  const lock = migrationLockPath(dest);
  if (!fs.existsSync(lock)) return false;
  return !lockIsStale(lock);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

// A lock is stale only when its owner is PROVABLY dead (a valid, positive pid
// that no longer exists) or the lockfile has aged past the staleness window. An
// empty/partial/non-positive pid is UNKNOWN -- never treated as dead -- so a lock
// caught mid-creation is never broken.
function lockIsStale(file) {
  let raw;
  let mtimeMs;
  try {
    const stat = fs.statSync(file);
    mtimeMs = stat.mtimeMs;
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return true;
    return false;
  }
  let pid = null;
  try {
    const parsed = JSON.parse(raw);
    if (Number.isInteger(parsed.pid) && parsed.pid > 0) pid = parsed.pid;
  } catch (_) {
    // Malformed/partial lock: owner UNKNOWN, fall through to the age check only.
  }
  if (pid !== null && !processIsAlive(pid)) return true;
  return Date.now() - mtimeMs > LOCK_STALE_MS;
}

// Acquire an exclusive lock at `file`. Returns a release fn, or null when a live
// lock is held (caller fails closed). Reuses the JSON `{pid, token}` owner format
// so it mutually excludes with gorkhali-state's lifecycle lock on the same path.
function acquireLock(file) {
  const token = `${process.pid}-${crypto.randomBytes(12).toString('hex')}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    let fd;
    try {
      fd = fs.openSync(file, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, token, created_at: new Date().toISOString() })}\n`);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return () => releaseLock(file, token);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      if (!lockIsStale(file)) return null; // live lock -> fail closed
      // Single-winner stale takeover (see learning takeover-single-winner): rename
      // the stale generation aside atomically. Exactly one contender wins the
      // rename; losers get ENOENT and retry. Never unlink-by-path -- two contenders
      // could each remove a DIFFERENT generation and both proceed (lost update).
      const stale = `${file}.stale.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
      try {
        fs.renameSync(file, stale);
      } catch (renameError) {
        if (renameError && renameError.code === 'ENOENT') continue; // another winner took it
        throw renameError;
      }
      try {
        fs.unlinkSync(stale);
      } catch (_) {
        // Leftover stale generation; a live lock can never replace a live lock.
      }
    }
  }
  return null;
}

function releaseLock(file, token) {
  try {
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (owner.token === token) fs.unlinkSync(file);
  } catch (_) {
    // Never delete a lock we cannot prove we own.
  }
}

// Run `action` while holding the per-repo gorkhali-state lifecycle lock, so a
// concurrent session write for the same repo blocks or fails closed. Returns
// { ok: true, value } or { ok: false } when the live lock could not be taken.
function withRepoLock(dest, repoId, action) {
  const release = acquireLock(path.join(dest, 'locks', `${repoId}.lock`));
  if (!release) return { ok: false };
  try {
    return { ok: true, value: action() };
  } finally {
    release();
  }
}

// --------------------------------------------------------------------------
// Learnings merge (through the T3 learning API's per-dir lock)
// --------------------------------------------------------------------------

let learningApi = null;
async function loadLearningApi() {
  if (learningApi) return learningApi;
  const modulePath = path.join(
    __dirname,
    '..',
    'skills',
    'gorkhali',
    'scripts',
    'gorkhali-learning.mjs',
  );
  learningApi = await import(pathToFileURL(modulePath).href);
  return learningApi;
}

// Append-only, line-deduped merge of a source learnings .md into the canonical
// file, executed INSIDE the T3 per-learnings-dir lock (withLearningLock). The
// baseline bytes are backed up first (content-addressed) and both hashes are
// recorded. Returns { merged, addedLines, beforeHash, afterHash, backup } or
// { deferred, reason } when the learning lock is contended (fails closed -- the
// merge never runs unlocked).
async function mergeLearnings(item, context) {
  const api = await loadLearningApi();
  const learningsDir = path.dirname(item.dest);
  try {
    return api.withLearningLock(learningsDir, () => applyLearningsMerge(item, context));
  } catch (error) {
    return { deferred: true, reason: `learnings-lock-contended: ${error.message}` };
  }
}

function applyLearningsMerge(item, context) {
  const beforeBytes = fs.readFileSync(item.dest);
  const beforeHash = sha256Bytes(beforeBytes);
  const srcText = fs.readFileSync(item.src, 'utf8');
  // Merge through the T3 semantic grammar: INDEX.md and auto-captures.md fold by
  // normalized key (max validated count, newest date, single header); domain files
  // append validated bullets under one header and dedup remaining lines. A raw
  // line-append would corrupt these structured files, so it is never used here.
  const { content, changed, added } = learningGrammar.mergeLearningContent(
    path.basename(item.dest),
    beforeBytes.toString('utf8'),
    srcText,
    item.source,
  );

  if (!changed) {
    return { merged: false, addedLines: 0, beforeHash, afterHash: beforeHash, backup: null };
  }

  const backup = storeRollbackBackup(context.dest, beforeHash, beforeBytes);
  atomicWriteText(item.dest, content);
  const afterHash = sha256File(item.dest);
  return { merged: true, addedLines: added, beforeHash, afterHash, backup };
}

// --------------------------------------------------------------------------
// Rollback backups (content-addressed by the ORIGINAL bytes)
// --------------------------------------------------------------------------

function storeRollbackBackup(dest, beforeHash, beforeBytes) {
  const dir = path.join(dest, 'audit', 'rollback-backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `${shortDigest(beforeHash)}-${beforeHash.replace(/^sha256:/, '')}.bak`);
  if (!fs.existsSync(backup)) {
    const tmp = `${backup}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
    fs.writeFileSync(tmp, beforeBytes);
    fs.renameSync(tmp, backup);
  }
  return backup;
}

// --------------------------------------------------------------------------
// Dry-run
// --------------------------------------------------------------------------

function dryRun(context) {
  const items = inventory(context);
  const manifest = buildManifest(context, items, 'dry-run');
  return manifest;
}

// --------------------------------------------------------------------------
// Apply
// --------------------------------------------------------------------------

function validatePriorManifest(manifestPath, context) {
  if (!manifestPath) {
    return { ok: false, reason: 'apply requires --manifest <path> pointing at a prior dry-run manifest' };
  }
  const prior = readJson(manifestPath);
  if (!prior || prior.schemaVersion !== MANIFEST_SCHEMA) {
    return { ok: false, reason: `prior manifest is missing or unreadable: ${manifestPath}` };
  }
  if (realpathOr(prior.dest) !== realpathOr(context.dest)) {
    return { ok: false, reason: 'prior manifest was generated for a different destination root' };
  }
  return { ok: true, prior };
}

async function apply(context, options) {
  const dest = context.dest;
  const marker = path.join(dest, `.data-root-migrated-v${MIGRATION_VERSION}`);
  if (fs.existsSync(marker) && !options.force) {
    return { status: 'already-migrated' };
  }

  const validated = validatePriorManifest(options.manifest, context);
  if (!validated.ok) {
    return { status: 'refused', reason: validated.reason };
  }

  fs.mkdirSync(dest, { recursive: true });
  const releaseMigration = acquireLock(migrationLockPath(dest));
  if (!releaseMigration) {
    // Fail closed: never migrate unlocked or alongside another migration.
    return { status: 'locked', reason: 'another migration holds the migration-wide lock' };
  }

  try {
    if (fs.existsSync(marker) && !options.force) {
      return { status: 'already-migrated' };
    }

    // Belt-and-suspenders: seed the alias map from the live workspace identity so a
    // machine where no session hook ran after the codec upgrade still collapses
    // this repo's legacy/plain/raw-hash source dirs onto the canonical id when
    // mapRepoId -> resolveCanonical runs during inventory below. Guarded and
    // merge-only; a seeding failure must never abort the migration.
    try {
      codec.recordAliases(dest, codec.repoIdentity(process.cwd(), {
        dataRoot: dest,
        gorkhaliRepo: process.env.GORKHALI_REPO,
      }));
    } catch (_) { /* fail open: seeding is best-effort */ }

    // Re-inventory from LIVE sources so changed sources are rescanned and the
    // plan reflects current bytes (idempotent reruns dedup against what landed).
    const items = inventory(context);
    const rollbackBackups = [];
    const actions = [];

    // Group repo-scoped writes so each repo's copies run under its lifecycle lock.
    const byRepo = new Map();
    const loose = [];
    for (const item of items) {
      if (item.repoId) {
        if (!byRepo.has(item.repoId)) byRepo.set(item.repoId, []);
        byRepo.get(item.repoId).push(item);
      } else {
        loose.push(item);
      }
    }

    for (const item of loose) {
      // eslint-disable-next-line no-await-in-loop
      actions.push(await executeItem(item, context, rollbackBackups));
    }
    for (const [repoId, repoItems] of byRepo) {
      const result = withRepoLock(dest, repoId, () => executeRepoItemsSync(repoItems, context, rollbackBackups, actions));
      if (!result.ok) {
        // Fail closed for this repo: a concurrent session writer holds its lock.
        for (const item of repoItems) {
          actions.push({ ...actionStub(item), applied: 'deferred', reason: 'repo-lifecycle-lock-contended' });
        }
      } else {
        for (const learningItem of result.value) {
          // eslint-disable-next-line no-await-in-loop
          actions.push(await executeLearningItem(learningItem, context, rollbackBackups));
        }
      }
    }

    const manifest = buildManifest(context, items, 'apply', {
      actions,
      rollbackBackups,
      appliedAt: new Date().toISOString(),
      priorManifest: options.manifest,
    });

    const reportPath = path.join(
      dest,
      'audit',
      `data-root-migration-v${MIGRATION_VERSION}-${manifest.appliedAt.replace(/[:.]/g, '-')}.json`,
    );
    atomicWriteJson(reportPath, manifest);
    manifest.reportPath = reportPath;
    atomicWriteJson(marker, {
      migrationVersion: MIGRATION_VERSION,
      appliedAt: manifest.appliedAt,
      counts: manifest.counts.byClass,
      reportPath,
    });
    return { status: 'migrated', manifest };
  } finally {
    releaseMigration();
  }
}

function actionStub(item) {
  return {
    source: item.source,
    srcRel: item.srcRel,
    dest: item.dest,
    class: item.class,
  };
}

// Synchronous execution of a repo's non-learnings items (copies, parking) under
// the repo lock; learnings merges are collected and applied afterwards through
// their own async lock so we never nest an await inside the sync lock body.
function executeRepoItemsSync(repoItems, context, rollbackBackups, actions) {
  const deferredLearnings = [];
  for (const item of repoItems) {
    if (item.class === 'imported' && item.merge === 'learnings') {
      deferredLearnings.push(item);
      continue;
    }
    actions.push(executeSyncItem(item, context, rollbackBackups));
  }
  return deferredLearnings;
}

async function executeItem(item, context, rollbackBackups) {
  if (item.class === 'imported' && item.merge === 'learnings') {
    return executeLearningItem(item, context, rollbackBackups);
  }
  return executeSyncItem(item, context, rollbackBackups);
}

async function executeLearningItem(item, context, rollbackBackups) {
  const result = await mergeLearnings(item, context);
  if (result.deferred) {
    return { ...actionStub(item), applied: 'deferred', reason: result.reason };
  }
  if (!result.merged) {
    return { ...actionStub(item), applied: 'deduplicated', addedLines: 0 };
  }
  rollbackBackups.push({
    dest: item.dest,
    beforeHash: result.beforeHash,
    afterHash: result.afterHash,
    backup: result.backup,
    source: item.source,
  });
  return { ...actionStub(item), applied: 'merged', addedLines: result.addedLines };
}

// Reconstruct a current-session pointer under the repo lifecycle lock. Only
// written when the destination session dir is present (so the pointer never
// dangles) and no baseline pointer already occupies the path (dest wins).
function executePointer(item) {
  const stub = actionStub(item);
  if (item.class === 'deduplicated') return { ...stub, applied: 'deduplicated' };
  if (item.class !== 'imported') return { ...stub, applied: 'skipped', reason: item.reason };
  if (!isDir(item.destSessionDir)) return { ...stub, applied: 'skipped', reason: 'session-data-not-present' };
  if (fs.existsSync(item.dest)) return { ...stub, applied: 'skipped', reason: 'destination-pointer-exists' };
  atomicWriteJson(item.dest, item.pointerContent);
  return { ...stub, applied: 'imported' };
}

function executeSyncItem(item, context, rollbackBackups) {
  const stub = actionStub(item);
  if (item.kind === 'pointer') return executePointer(item);
  switch (item.class) {
    case 'skipped-live-state':
      return { ...stub, applied: 'skipped', reason: item.reason };
    case 'unresolved':
      return { ...stub, applied: 'unresolved', reason: item.reason };
    case 'deduplicated':
      return { ...stub, applied: 'deduplicated' };
    case 'imported':
      try {
        copyFileExcl(item.src, item.dest);
        return { ...stub, applied: 'imported' };
      } catch (error) {
        if (error && error.code === 'EEXIST') {
          // A file converged at the canonical path between planning and apply
          // (a higher-priority source, or a prior run, landed it first). Identical
          // bytes dedup; different bytes park -- the baseline is never overwritten.
          if (sha256File(item.dest) === item.digest) {
            return { ...stub, applied: 'deduplicated', reason: 'converged-at-apply' };
          }
          return parkItem(item, stub);
        }
        throw error;
      }
    case 'conflict-parked':
      return parkItem(item, stub);
    default:
      return { ...stub, applied: 'skipped', reason: `unknown-class-${item.class}` };
  }
}

function parkItem(item, stub) {
  const target = item.parked || parkPath(item);
  // The park suffix encodes the source content hash, so an existing file at the
  // deterministic path with the SAME bytes means this conflict was already parked
  // on a prior run -- an idempotent no-op (no duplicate `.2` park on rerun). Only a
  // genuine short-hash collision with DIFFERENT bytes bumps to a unique name.
  if (fs.existsSync(target) && sha256File(target) === item.digest) {
    return { ...stub, applied: 'conflict-parked', parked: target, note: 'already-parked' };
  }
  const parked = uniqueParkPath(target);
  copyFileExcl(item.src, parked);
  return { ...stub, applied: 'conflict-parked', parked };
}

function uniqueParkPath(target) {
  if (!fs.existsSync(target)) return target;
  let index = 2;
  let candidate = `${target}.${index}`;
  while (fs.existsSync(candidate)) {
    index += 1;
    candidate = `${target}.${index}`;
  }
  return candidate;
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { apply: false, force: false, manifest: null, map: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--manifest') options.manifest = argv[++i];
    else if (arg.startsWith('--manifest=')) options.manifest = arg.slice('--manifest='.length);
    else if (arg === '--map' && argv[i + 1]) {
      const [k, v] = argv[++i].split('=');
      if (k && v) options.map[k] = v;
    } else if (arg.startsWith('--map=')) {
      const [k, v] = arg.slice('--map='.length).split('=');
      if (k && v) options.map[k] = v;
    }
  }
  return options;
}

function buildContext(env, mapOverrides) {
  const dest = gorkhaliData();
  const sources = buildSources(dest, env);
  return { dest, sources, mapOverrides };
}

async function run(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const context = buildContext(env, options.map);

  if (!options.apply) {
    // Dry-run performs ZERO filesystem writes; the plan goes to stdout. Capture it
    // with a shell redirect to feed `--apply --manifest <path>`.
    return { mode: 'dry-run', manifest: dryRun(context) };
  }

  const result = await apply(context, options);
  return { mode: 'apply', ...result };
}

async function main() {
  try {
    const outcome = await run();
    if (outcome.mode === 'dry-run') {
      process.stdout.write(`${JSON.stringify(outcome.manifest, null, 2)}\n`);
      return 0;
    }
    switch (outcome.status) {
      case 'migrated': {
        const counts = outcome.manifest.counts.byClass;
        process.stdout.write(
          `  * data migration v${MIGRATION_VERSION} applied: `
          + `imported=${counts.imported} deduplicated=${counts.deduplicated} `
          + `conflict-parked=${counts['conflict-parked']} unresolved=${counts.unresolved} `
          + `skipped-live-state=${counts['skipped-live-state']} -> ${outcome.manifest.reportPath}\n`,
        );
        return 0;
      }
      case 'already-migrated':
        process.stdout.write(`  o data migration v${MIGRATION_VERSION}: already migrated (skipping)\n`);
        return 0;
      case 'locked':
        process.stdout.write(`  o data migration v${MIGRATION_VERSION}: ${outcome.reason} (skipping)\n`);
        return 0;
      case 'refused':
        process.stderr.write(`data migration v${MIGRATION_VERSION} refused: ${outcome.reason}\n`);
        return 2;
      default:
        process.stderr.write(`data migration v${MIGRATION_VERSION}: unexpected status ${outcome.status}\n`);
        return 1;
    }
  } catch (error) {
    process.stderr.write(`data migration v${MIGRATION_VERSION}: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = {
  run,
  MIGRATION_VERSION,
  isDataMigrationInProgress,
  atomicWriteText,
  loadLearningApi,
  _internals: {
    buildSources,
    mapRepoId,
    canonicalDest,
    describeItem,
    resolveClass,
    liveStateReason,
    inventory,
    buildContext,
    dryRun,
    apply,
    acquireLock,
    lockIsStale,
    migrationLockPath,
    stripMigratedSuffixes,
  },
};
