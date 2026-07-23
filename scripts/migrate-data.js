#!/usr/bin/env node
// Author: Subash Karki
// migrate-data.js — copy legacy Phantom state into the portable data root.
//
// The migration is deliberately copy-only. Existing destination entries always
// win, sources are never renamed or deleted, and every collision is reported.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { phantomData } = require('./lib/phantom-paths');

const MIGRATION_VERSION = 2;
const WHITELIST_DIRS = [
  'sessions',
  'state',
  'observations',
  'learnings',
  'audit',
  'repos',
  'global',
  'timing',
  'events',
];
const WHITELIST_FILES = [];
const STALE_STATE_PREFIXES = ['.active-wake-session'];
const STALE_STATE_DIRS = new Set(['routing-nudge']);

const DEST = phantomData();
const MARKER = path.join(DEST, `.data-root-migrated-v${MIGRATION_VERSION}`);
const LOCK = path.join(DEST, `.data-root-migrating-v${MIGRATION_VERSION}.lock`);
const REPORT = path.join(DEST, `.data-root-migration-v${MIGRATION_VERSION}-report.json`);
const LOCK_STALE_MS = positiveNumber(process.env.PHANTOM_MIGRATE_LOCK_STALE_MS, 10 * 60 * 1000);

const SOURCES = [
  {
    label: 'phantom-data',
    root: process.env.PHANTOM_MIGRATE_SRC_PHANTOM_DATA ||
      path.join(os.homedir(), '.claude', 'phantom-data'),
  },
  {
    label: 'phantom',
    root: process.env.PHANTOM_MIGRATE_SRC_PHANTOM ||
      path.join(os.homedir(), '.claude', 'phantom'),
  },
  {
    label: 'team',
    root: process.env.PHANTOM_MIGRATE_SRC_TEAM ||
      path.join(os.homedir(), '.claude', 'team'),
  },
];

const FORCE = process.argv.includes('--force');
const THEN_REPO_DIRS = process.argv.includes('--then-repo-dirs');

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
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

function processIdentity(pid) {
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return null;
  const identity = String(result.stdout || '').trim();
  return identity || null;
}

function lockSnapshot() {
  let fd;
  try {
    fd = fs.openSync(LOCK, 'r');
  } catch (_) {
    return null;
  }
  let stat;
  let raw;
  try {
    stat = fs.fstatSync(fd);
    raw = fs.readFileSync(fd, 'utf8');
  } catch (_) {
    return null;
  } finally {
    fs.closeSync(fd);
  }
  let value = {};
  try {
    value = JSON.parse(raw);
  } catch (_) {
    // A malformed lock is recoverable after the normal staleness window.
  }
  return { stat, value, raw };
}

function restoreRelocatedLock(stale) {
  try {
    fs.linkSync(stale, LOCK);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      // A newer owner already claimed LOCK. Leave the displaced generation for
      // audit/recovery rather than deleting a lock we now know was not stale.
      return;
    }
    try {
      fs.renameSync(stale, LOCK);
    } catch (_) {
      // The relocated generation remains at `stale`; never delete it on doubt.
    }
    return;
  }
  try {
    fs.unlinkSync(stale);
  } catch (_) {
    // The hard link at LOCK preserves the generation; stale-name cleanup is best effort.
  }
}

function reclaimStaleLock(snapshot) {
  const pid = Number(snapshot.value.pid);
  const hasOwner = Number.isInteger(pid) && pid > 0;
  const ownerAlive = hasOwner && processIsAlive(pid);
  const recordedIdentity = snapshot.value.ownerIdentity;
  const currentIdentity = ownerAlive ? processIdentity(pid) : null;
  const identityMismatch = Boolean(
    ownerAlive &&
    recordedIdentity &&
    currentIdentity &&
    recordedIdentity !== currentIdentity
  );
  const old = Date.now() - snapshot.stat.mtimeMs > LOCK_STALE_MS;
  if (ownerAlive && !identityMismatch) return false;
  if (!hasOwner && !old) return false;

  const stale = `${LOCK}.stale.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.renameSync(LOCK, stale);
  } catch (_) {
    return false;
  }
  let relocated;
  try {
    relocated = fs.readFileSync(stale, 'utf8');
  } catch (_) {
    restoreRelocatedLock(stale);
    return false;
  }
  if (relocated !== snapshot.raw) {
    restoreRelocatedLock(stale);
    return false;
  }
  try {
    fs.unlinkSync(stale);
  } catch (_) {
    // Exact stale generation was relocated; a leftover cannot replace a live lock.
  }
  return true;
}

function acquireLock() {
  const token = `${process.pid}-${crypto.randomBytes(12).toString('hex')}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(LOCK, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({
          version: MIGRATION_VERSION,
          pid: process.pid,
          token,
          createdAt: new Date().toISOString(),
          ownerIdentity: processIdentity(process.pid),
        }));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return token;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      const snapshot = lockSnapshot();
      if (!snapshot || reclaimStaleLock(snapshot)) continue;
      return null;
    }
  }
  return null;
}

function releaseLock(token) {
  try {
    const current = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    if (current.token === token) fs.unlinkSync(LOCK);
  } catch (_) {
    // Missing/replaced lock: never delete a lock we cannot prove we own.
  }
}

function excludedReason(relativePath) {
  const parts = relativePath.split(path.sep);
  if (parts[0] === 'worktrees') return 'managed-worktrees';
  if (parts[0] !== 'state' || parts.length < 2) return null;
  if (parts[1] === 'current-session') return 'classified-current-session';
  if (STALE_STATE_DIRS.has(parts[1])) return 'stale-active-marker';
  if (STALE_STATE_PREFIXES.some(prefix => parts[1].startsWith(prefix))) {
    return 'stale-active-marker';
  }
  return null;
}

function recordConflict(
  src,
  dest,
  sourceLabel,
  stats,
  migratedEntries,
  kind = 'destination-exists',
) {
  const priorMigration = migratedEntries.get(dest);
  const winnerOrigin = priorMigration ? 'legacy-source' : 'canonical-destination';
  stats.conflicts.push({
    src,
    dest,
    source: sourceLabel,
    kind,
    won: priorMigration ? priorMigration.source : 'destination',
    winnerOrigin,
    losingOrigin: 'legacy-source',
  });
  stats.skipped++;
}

function copyTree(src, dest, sourceRoot, sourceLabel, stats, migratedEntries) {
  const relativePath = path.relative(sourceRoot, src);
  const excluded = excludedReason(relativePath);
  if (excluded) {
    stats.excluded.push({ src, reason: excluded });
    stats.skipped++;
    return;
  }

  const sourceStat = fs.lstatSync(src);
  if (sourceStat.isDirectory()) {
    let destinationStat = null;
    try { destinationStat = fs.lstatSync(dest); } catch (_) {}
    if (destinationStat && !destinationStat.isDirectory()) {
      recordConflict(
        src,
        dest,
        sourceLabel,
        stats,
        migratedEntries,
        'destination-type-conflict',
      );
      return;
    }
    fs.mkdirSync(dest, { recursive: true });
    if (!destinationStat) {
      migratedEntries.set(dest, { source: sourceLabel, type: 'directory' });
    }
    for (const entry of fs.readdirSync(src)) {
      copyTree(
        path.join(src, entry),
        path.join(dest, entry),
        sourceRoot,
        sourceLabel,
        stats,
        migratedEntries,
      );
    }
    return;
  }

  if (!sourceStat.isFile()) {
    stats.excluded.push({ src, reason: 'non-regular-entry' });
    stats.skipped++;
    return;
  }

  if (fs.existsSync(dest)) {
    recordConflict(src, dest, sourceLabel, stats, migratedEntries);
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    fs.utimesSync(dest, sourceStat.atime, sourceStat.mtime);
    migratedEntries.set(dest, { source: sourceLabel, type: 'file' });
    stats.copied++;
    const top = path.relative(DEST, dest).split(path.sep)[0];
    stats.bySubdir[top] = (stats.bySubdir[top] || 0) + 1;
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      recordConflict(src, dest, sourceLabel, stats, migratedEntries);
      return;
    }
    throw error;
  }
}

function sameDirectory(left, right) {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch (_) {
    return path.resolve(left) === path.resolve(right);
  }
}

function migrateSource(source, stats, migratedEntries) {
  if (!fs.existsSync(source.root)) return;
  if (sameDirectory(source.root, DEST)) {
    stats.excluded.push({ src: source.root, reason: 'source-is-destination' });
    stats.skipped++;
    return;
  }

  for (const dir of WHITELIST_DIRS) {
    const src = path.join(source.root, dir);
    let sourceStat = null;
    try { sourceStat = fs.lstatSync(src); } catch (_) {}
    if (sourceStat && sourceStat.isDirectory()) {
      copyTree(
        src,
        path.join(DEST, dir),
        source.root,
        source.label,
        stats,
        migratedEntries,
      );
    }
  }
  for (const file of WHITELIST_FILES) {
    const src = path.join(source.root, file);
    let sourceStat = null;
    try { sourceStat = fs.lstatSync(src); } catch (_) {}
    if (sourceStat && sourceStat.isFile()) {
      copyTree(
        src,
        path.join(DEST, file),
        source.root,
        source.label,
        stats,
        migratedEntries,
      );
    }
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function gitValue(workspace, args) {
  const result = spawnSync('git', ['-C', workspace, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function sanitizeSegment(value, fallback = 'repository') {
  const sanitized = String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return sanitized || fallback;
}

function isSafeSegment(value) {
  return (
    typeof value === 'string' &&
    value !== '.' &&
    value !== '..' &&
    sanitizeSegment(value, '') === value
  );
}

function repoIdentity(workspace) {
  try {
    const resolvedWorkspace = fs.realpathSync(workspace);
    const gitRoot = gitValue(resolvedWorkspace, ['rev-parse', '--show-toplevel']);
    const root = gitRoot ? fs.realpathSync(gitRoot) : resolvedWorkspace;
    const remote = gitValue(root, ['config', '--get', 'remote.origin.url']);
    const source = remote || root;
    const nameSource = remote
      ? remote.replace(/\.git$/, '').split(/[/:]/).pop()
      : path.basename(root);
    const name = sanitizeSegment(nameSource).toLowerCase();
    const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 10);
    return { id: `${name}-${hash}`, root };
  } catch (_) {
    return null;
  }
}

function classifyPointer(pointer) {
  if (
    pointer &&
    pointer.schema_version === 1 &&
    typeof pointer.repo_id === 'string' &&
    typeof pointer.task_id === 'string'
  ) {
    return 'portable-v1';
  }
  if (
    pointer &&
    typeof pointer.session_id === 'string' &&
    typeof pointer.cwd === 'string'
  ) {
    return 'legacy-hook';
  }
  return 'unknown';
}

function validateSession(session, pointer) {
  if (!session || session.schema_version !== 1 || session.artifact_type !== 'session') {
    return 'invalid-session-envelope';
  }
  if (session.repo_id !== pointer.repo_id || session.task_id !== pointer.task_id) {
    return 'session-identity-mismatch';
  }
  if (!['active', 'paused'].includes(session.status)) {
    return 'session-is-not-current';
  }
  if (typeof session.workspace !== 'string' || !session.workspace) {
    return 'missing-session-workspace';
  }
  const identity = repoIdentity(session.workspace);
  if (!identity || identity.id !== pointer.repo_id) {
    return 'workspace-repo-identity-mismatch';
  }
  return null;
}

function validatePointerCandidate(source, file, pointer) {
  const schema = classifyPointer(pointer);
  if (schema !== 'portable-v1') return { schema, reason: `unsupported-${schema}-pointer` };
  if (!isSafeSegment(pointer.repo_id) || !isSafeSegment(pointer.task_id)) {
    return { schema, reason: 'unsafe-pointer-segment' };
  }
  if (path.basename(file) !== `${pointer.repo_id}.json`) {
    return { schema, reason: 'pointer-filename-mismatch' };
  }

  const sourceSessionDir = path.join(
    source.root,
    'repos',
    pointer.repo_id,
    'sessions',
    pointer.task_id,
  );
  if (pointer.session_dir) {
    const declared = path.isAbsolute(pointer.session_dir)
      ? pointer.session_dir
      : path.resolve(source.root, pointer.session_dir);
    if (!sameDirectory(declared, sourceSessionDir)) {
      return { schema, reason: 'pointer-target-mismatch' };
    }
  }

  const sourceSession = readJson(path.join(sourceSessionDir, 'session.json'));
  const sourceReason = validateSession(sourceSession, pointer);
  if (sourceReason) return { schema, reason: `source-${sourceReason}` };

  const destinationSessionDir = path.join(
    DEST,
    'repos',
    pointer.repo_id,
    'sessions',
    pointer.task_id,
  );
  const destinationSession = readJson(path.join(destinationSessionDir, 'session.json'));
  const destinationReason = validateSession(destinationSession, pointer);
  if (destinationReason) return { schema, reason: `destination-${destinationReason}` };

  return {
    schema,
    pointer: {
      schema_version: 1,
      repo_id: pointer.repo_id,
      task_id: pointer.task_id,
      session_dir: destinationSessionDir,
      updated_at: pointer.updated_at || destinationSession.updated_at || new Date().toISOString(),
    },
  };
}

function currentPointerFiles(source) {
  const directory = path.join(source.root, 'state', 'current-session');
  try {
    return fs.readdirSync(directory)
      .filter(name => name.endsWith('.json'))
      .sort()
      .map(name => path.join(directory, name));
  } catch (_) {
    return [];
  }
}

function migrateCurrentPointers(stats, migratedEntries) {
  for (const source of SOURCES) {
    const sourceStats = stats[source.label];
    for (const file of currentPointerFiles(source)) {
      const pointer = readJson(file);
      const validation = validatePointerCandidate(source, file, pointer);
      const record = {
        src: file,
        schema: validation.schema,
        status: validation.pointer ? 'valid' : 'rejected',
      };
      if (!validation.pointer) {
        record.reason = validation.reason;
        sourceStats.pointers.push(record);
        sourceStats.excluded.push({ src: file, reason: validation.reason });
        sourceStats.skipped++;
        continue;
      }

      const destination = path.join(
        DEST,
        'state',
        'current-session',
        `${validation.pointer.repo_id}.json`,
      );
      record.dest = destination;
      if (fs.existsSync(destination)) {
        record.status = 'collision';
        sourceStats.pointers.push(record);
        recordConflict(
          file,
          destination,
          source.label,
          sourceStats,
          migratedEntries,
          'current-session-pointer-collision',
        );
        continue;
      }

      atomicWriteJson(destination, validation.pointer);
      migratedEntries.set(destination, { source: source.label, type: 'current-session-pointer' });
      sourceStats.copied++;
      sourceStats.bySubdir.state = (sourceStats.bySubdir.state || 0) + 1;
      sourceStats.pointers.push(record);
    }
  }
}

function runMigration() {
  if (fs.existsSync(MARKER) && !FORCE) {
    console.log(`  ○ data migration v${MIGRATION_VERSION}: already migrated (skipping)`);
    return { status: 'already-migrated' };
  }

  fs.mkdirSync(DEST, { recursive: true });
  const lockToken = acquireLock();
  if (!lockToken) {
    console.log(`  ○ data migration v${MIGRATION_VERSION}: migration in progress (skipping)`);
    return { status: 'in-progress' };
  }

  try {
    if (fs.existsSync(MARKER) && !FORCE) {
      console.log(`  ○ data migration v${MIGRATION_VERSION}: already migrated (skipping)`);
      return { status: 'already-migrated' };
    }

    const stats = {};
    const migratedEntries = new Map();
    for (const source of SOURCES) {
      stats[source.label] = {
        copied: 0,
        skipped: 0,
        conflicts: [],
        excluded: [],
        pointers: [],
        bySubdir: {},
      };
      migrateSource(source, stats[source.label], migratedEntries);
    }
    migrateCurrentPointers(stats, migratedEntries);

    const sources = {};
    const conflicts = [];
    const excluded = [];
    let totalCopied = 0;
    for (const source of SOURCES) {
      const sourceStats = stats[source.label];
      sources[source.label] = {
        root: source.root,
        present: fs.existsSync(source.root),
        copied: sourceStats.copied,
        skipped: sourceStats.skipped,
        bySubdir: sourceStats.bySubdir,
        pointers: sourceStats.pointers,
      };
      conflicts.push(...sourceStats.conflicts);
      excluded.push(...sourceStats.excluded);
      totalCopied += sourceStats.copied;
    }

    const migratedAt = new Date().toISOString();
    const report = {
      migrationVersion: MIGRATION_VERSION,
      migratedAt,
      dest: DEST,
      sources,
      copied: totalCopied,
      conflicts,
      excluded,
      sourcePriority: SOURCES.map(source => source.label),
      collisionPolicy: 'canonical-destination-then-source-priority',
      whitelist: { dirs: WHITELIST_DIRS, files: WHITELIST_FILES },
    };
    atomicWriteJson(REPORT, report);
    atomicWriteJson(MARKER, {
      migrationVersion: MIGRATION_VERSION,
      migratedAt,
      sources: SOURCES.map(source => source.root),
      copied: totalCopied,
      conflicts: conflicts.length,
    });

    const perSource = SOURCES
      .map(source => `${source.label}=${stats[source.label].copied}`)
      .join(', ');
    console.log(
      `  ✓ data migration v${MIGRATION_VERSION}: copied ${totalCopied} files ` +
      `(${perSource}, conflicts=${conflicts.length}) → ${DEST}`,
    );
    return { status: 'migrated' };
  } finally {
    releaseLock(lockToken);
  }
}

function runRepoDirMigration() {
  const script = path.join(__dirname, 'migrate-repo-dirs.js');
  if (!fs.existsSync(script)) return;
  spawnSync(process.execPath, [script, '--apply'], {
    stdio: 'ignore',
    timeout: 30000,
    env: process.env,
  });
}

function main() {
  try {
    const result = runMigration();
    if (
      THEN_REPO_DIRS &&
      (result.status === 'migrated' || result.status === 'already-migrated')
    ) {
      runRepoDirMigration();
    }
  } catch (error) {
    process.stderr.write(`data migration v${MIGRATION_VERSION}: ${error.message}\n`);
    return 1;
  }
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  _internals: {
    LOCK,
    lockSnapshot,
    reclaimStaleLock,
  },
};
