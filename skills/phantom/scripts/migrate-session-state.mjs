#!/usr/bin/env node
// Author: Subash Karki
// Offline, manifest-bound migration from Phantom state envelope v1 to v2.

import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { isMainThread } from 'node:worker_threads';

import {
  dataRoot,
  isMainModule,
  repoIdentity,
  taskIdentity,
  taskPathSegment,
  workspacePath,
} from './lib/portable.mjs';
import {
  intentErrors,
  newLifecycle,
  pointerErrors,
  sessionErrors,
  throwStateErrors,
} from './lib/session-contracts.mjs';
import {
  classifyLegacyPointer,
  classifyLegacySession,
  legacyMigrationRequirement,
} from './lib/legacy-session-classifier.mjs';
import {
  captureTargetGeneration,
  DURABLE_PUBLICATION_ERROR_CODES,
  preparedPublicationName,
  prepareDurablePublication,
  publishDurablePublication,
} from './lib/session-migration/durable-publication.mjs';
import {
  appendAtomicJournalEvent,
  ATOMIC_JOURNAL_FREE_SPACE_SCRATCH_BYTES,
  MAX_ATOMIC_JOURNAL_BYTES,
  readAtomicJournalSnapshot,
} from './lib/session-migration/atomic-journal.mjs';
import { BUNDLE_VERSION } from './resolve-profile.mjs';

const require = createRequire(import.meta.url);
const stateCodec = require('./lib/shared-state.cjs');

const MANIFEST_SCHEMA_VERSION = 1;
const JOURNAL_SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TREE_BYTES = 32 * 1024 * 1024;
const MAX_TREE_FILES = 4096;
// Bound directory-only and deeply nested trees as strictly as file-heavy trees.
const MAX_TREE_ENTRIES = 4096;
const MAX_TREE_DEPTH = 64;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_ENTRIES = 4096;
const MAX_INVENTORY_TREE_RECORDS = 8 * 1024;
const MAX_INVENTORY_TREE_BYTES = 256 * 1024 * 1024;
// Bound lock descriptors while allowing one independently bound mutation per repository.
const MAX_MUTATING_ENTRIES = 64;
const MAX_RECOVERY_CLAIM_EPOCHS = 32;
const MAX_PREFLIGHT_RESTARTS = 4;
const MAX_LOCK_DIRECTORY_ENTRIES = 4096;
const SAFE_REPO = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,119}$/;
const ROUTES = new Set(['direct', 'plan', 'brainstorm', 'full']);
const WORK_KINDS = new Set(['implementation', 'investigation']);
const MUTATING_ACTIONS = new Set(['migrate_to_paused', 'archive_completed', 'quarantine_pointer']);
const TEST_CRASH_ENV = 'PHANTOM_TEST_MIGRATION_CRASH_AT';
const TEST_KILL_ENV = 'PHANTOM_TEST_MIGRATION_KILL_AT';
const TEST_TREE_SNAPSHOT_BARRIER_ENV = 'PHANTOM_TEST_TREE_SNAPSHOT_BARRIER';
const TEST_TREE_FILE_RECHECK_BARRIER_ENV = 'PHANTOM_TEST_TREE_FILE_RECHECK_BARRIER';
const TEST_LOCK_BARRIER_ENV = 'PHANTOM_TEST_MIGRATION_LOCK_BARRIER';
const TEST_RECOVERY_SNAPSHOT_BARRIER_ENV = 'PHANTOM_TEST_MIGRATION_RECOVERY_SNAPSHOT_BARRIER';
const TEST_RECOVERY_BEFORE_ENSURE_BARRIER_ENV = 'PHANTOM_TEST_MIGRATION_RECOVERY_BEFORE_ENSURE_BARRIER';
const TEST_RECOVERY_AFTER_ENSURE_BARRIER_ENV = 'PHANTOM_TEST_MIGRATION_RECOVERY_AFTER_ENSURE_BARRIER';
const TEST_RECOVERY_BEFORE_RESTART_BARRIER_ENV = 'PHANTOM_TEST_MIGRATION_RECOVERY_BEFORE_RESTART_BARRIER';
const TEST_CLAIM_PUBLISH_BARRIER_ENV = 'PHANTOM_TEST_MIGRATION_CLAIM_PUBLISH_BARRIER';
const TEST_RELEASE_BARRIER_ENV = 'PHANTOM_TEST_MIGRATION_RELEASE_BARRIER';
const TEST_AVAILABLE_BYTES_ENV = 'PHANTOM_TEST_MIGRATION_AVAILABLE_BYTES';
const TEST_AGGREGATE_TREE_BYTES_ENV = 'PHANTOM_TEST_MIGRATION_AGGREGATE_TREE_BYTES';
const TEST_PUBLICATION_FAILURE_ENV = 'PHANTOM_TEST_MIGRATION_PUBLICATION_FAILURE_AT';
const TEST_PUBLICATION_BARRIER_ENV = 'PHANTOM_TEST_MIGRATION_PUBLICATION_BARRIER';
const TEST_DIRECTORY_MODE_BARRIER_ENV = 'PHANTOM_TEST_MIGRATION_DIRECTORY_MODE_BARRIER';
const TEST_MAX_CLAIM_EPOCHS_ENV = 'PHANTOM_TEST_MIGRATION_MAX_CLAIM_EPOCHS';
const GLOBAL_MIGRATION_LOCK = '.session-state-migration.lock';
const GLOBAL_RECOVERY_LOCK = '.session-state-migration.recovery.lock';
const treeSnapshotWaiter = new Int32Array(new SharedArrayBuffer(4));
let treeSnapshotBarrierUsed = false;
let treeFileRecheckBarrierUsed = false;
let migrationLockBarrierUsed = false;
let recoverySnapshotBarrierUsed = false;
let migrationRecoveryBarrierUsed = false;
let claimPublicationBarrierUsed = false;
let migrationReleaseBarrierUsed = false;
let directoryModeBarrierUsed = false;
const publicationFailurePointsUsed = new Set();
const publicationBarriersUsed = new Set();
const recoveryPhaseBarriersUsed = new Set();

const compareText = (left, right) => (left < right ? -1 : (left > right ? 1 : 0));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const digestHex = (digest) => digest.slice('sha256:'.length);

function safeStatNumber(value, label) {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${label} cannot be represented safely as a number.`);
    }
    return Number(value);
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is not a safe integer.`);
  return value;
}

function statMode(metadata) {
  return typeof metadata.mode === 'bigint'
    ? Number(metadata.mode & 0o777n)
    : safeStatNumber(metadata.mode, 'Filesystem mode') & 0o777;
}

function statNlink(metadata) {
  return safeStatNumber(metadata.nlink, 'Filesystem link count');
}

function statSize(metadata) {
  return safeStatNumber(metadata.size, 'Filesystem file size');
}

export function physicalIdentity(metadata) {
  const field = (value, label) => {
    if (typeof value === 'bigint') {
      if (value < 0n) throw new Error(`${label} must be non-negative.`);
      return value.toString();
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer or bigint.`);
    }
    return String(value);
  };
  return {
    device: field(metadata?.dev, 'Filesystem device identity'),
    inode: field(metadata?.ino, 'Filesystem inode identity'),
  };
}

function resourceLimitError(message) {
  const error = new Error(message);
  error.code = 'PHANTOM_MIGRATION_RESOURCE_LIMIT';
  return error;
}

function generationChangedError(message) {
  const error = new Error(message);
  error.code = 'PHANTOM_MIGRATION_GENERATION_CHANGED';
  return error;
}

function preflightRestartError(message) {
  const error = new Error(message);
  error.code = 'PHANTOM_MIGRATION_RESTART_PREFLIGHT';
  return error;
}

function lstatIfPresent(file) {
  try { return lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isWithin(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function safeRepoId(value) {
  return typeof value === 'string' && SAFE_REPO.test(value) && value !== '.' && value !== '..';
}

function normalizedCollisionKey(value) {
  return value.normalize('NFC').toLocaleLowerCase('en-US');
}

function collisionNames(names) {
  const groups = new Map();
  for (const name of names) {
    const key = normalizedCollisionKey(name);
    const values = groups.get(key) || [];
    values.push(name);
    groups.set(key, values);
  }
  return [...groups.values()].filter((values) => values.length > 1)
    .map((values) => values.sort(compareText));
}

function assertRoot(root) {
  const resolved = resolve(root);
  if (!existsSync(resolved)) return resolved;
  const metadata = lstatSync(resolved);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Phantom data root is not a real directory: ${resolved}`);
  }
  if (resolve(realpathSync(resolved)) !== resolved) {
    throw new Error(`Phantom data root has a symbolic-link ancestor: ${resolved}`);
  }
  return resolved;
}

function assertSafeChain(root, candidate) {
  const safeRoot = resolve(root);
  const file = resolve(candidate);
  if (!isWithin(safeRoot, file)) throw new Error(`Path escapes the Phantom data root: ${file}`);
  if (existsSync(safeRoot)) {
    const rootMetadata = lstatSync(safeRoot);
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
      throw new Error(`Unsafe Phantom data root: ${safeRoot}`);
    }
  }
  const rel = relative(safeRoot, file);
  let current = safeRoot;
  const segments = rel === '' ? [] : rel.split(sep);
  for (const segment of segments) {
    current = join(current, segment);
    if (!existsSync(current)) {
      const error = new Error(`Missing path component: ${current}`);
      error.code = 'ENOENT';
      throw error;
    }
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${current}`);
  }
}

function sameFileGeneration(left, right) {
  return left.isFile() && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function boundedDescriptorRead(descriptor, maximum) {
  const chunks = [];
  let total = 0;
  while (total <= maximum) {
    const remaining = (maximum + 1) - total;
    if (remaining <= 0) break;
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const count = readSync(descriptor, chunk, 0, chunk.length, total);
    if (count === 0) break;
    chunks.push(chunk.subarray(0, count));
    total += count;
  }
  if (total > maximum) throw new Error(`Input exceeds ${maximum} bytes.`);
  return Buffer.concat(chunks, total);
}

function readRegularBytesWithLinks(file, root, maximum, allowedLinks) {
  assertSafeChain(root, file);
  const beforePath = lstatSync(file, { bigint: true });
  if (beforePath.isSymbolicLink() || !beforePath.isFile()) {
    throw new Error(`Input is not a regular file: ${file}`);
  }
  if (!allowedLinks.has(beforePath.nlink)) throw new Error(`Hard-linked input is not allowed: ${file}`);
  if (beforePath.size > BigInt(maximum)) throw new Error(`Input exceeds ${maximum} bytes: ${file}`);
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw new Error('This runtime cannot enforce no-follow migration reads.');
  }
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!allowedLinks.has(before.nlink) || before.size > BigInt(maximum)
      || !sameFileGeneration(beforePath, before)) {
      throw new Error(`Unsafe regular file generation: ${file}`);
    }
    const bytes = boundedDescriptorRead(descriptor, maximum);
    const after = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    if (afterPath.isSymbolicLink()
      || !sameFileGeneration(before, after)
      || !sameFileGeneration(after, afterPath)
      || BigInt(bytes.length) !== after.size) {
      throw new Error(`Input changed while it was read: ${file}`);
    }
    return {
      bytes,
      digest: sha256(bytes),
      size: bytes.length,
      mode: statMode(before),
      nlink: statNlink(before),
      ...physicalIdentity(before),
    };
  } finally {
    closeSync(descriptor);
  }
}

function readRegularBytes(file, root, maximum = MAX_FILE_BYTES) {
  return readRegularBytesWithLinks(file, root, maximum, new Set([1n]));
}

function parseJsonBytes(record, label) {
  try {
    return JSON.parse(record.bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is malformed JSON`);
  }
}

function enumerateDirectoryNames(directory, maximum, label) {
  const names = [];
  const handle = opendirSync(directory);
  try {
    let entry;
    while ((entry = handle.readSync()) !== null) {
      if (names.length >= maximum) {
        throw resourceLimitError(`${label} exceeds maximum entry count ${maximum}: ${directory}`);
      }
      names.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  return names.sort(compareText);
}

function readDirectoryNames(
  directory,
  root,
  maximum = MAX_MANIFEST_ENTRIES,
  label = 'Directory',
) {
  assertSafeChain(root, directory);
  const before = lstatSync(directory, { bigint: true });
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new Error(`Expected a real directory: ${directory}`);
  }
  const names = enumerateDirectoryNames(directory, maximum, label);
  const collisions = collisionNames(names);
  if (collisions.length) {
    throw new Error(`Normalization/case-fold collision in ${directory}: ${JSON.stringify(collisions)}`);
  }
  const afterNames = enumerateDirectoryNames(directory, maximum, label);
  const after = lstatSync(directory, { bigint: true });
  if (!after.isDirectory() || after.isSymbolicLink()
    || after.dev !== before.dev || after.ino !== before.ino
    || statMode(after) !== statMode(before)
    || canonicalJson(afterNames) !== canonicalJson(names)) {
    throw generationChangedError(`Directory changed while it was inventoried: ${directory}`);
  }
  return names;
}

function pauseTestTreeSnapshot(root) {
  const token = process.env[TEST_TREE_SNAPSHOT_BARRIER_ENV];
  if (treeSnapshotBarrierUsed || typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) return;
  treeSnapshotBarrierUsed = true;
  const directory = join(root, 'locks');
  mkdirSync(directory, { recursive: true });
  const ready = join(directory, `.tree-snapshot-${token}.ready`);
  const resume = join(directory, `.tree-snapshot-${token}.resume`);
  writeFileSync(ready, 'ready\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 10_000;
  while (!existsSync(resume)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the tree-snapshot test barrier.');
    Atomics.wait(treeSnapshotWaiter, 0, 0, 10);
  }
}

function pauseTestTreeFileRecheck(root) {
  const token = process.env[TEST_TREE_FILE_RECHECK_BARRIER_ENV];
  if (treeFileRecheckBarrierUsed
    || typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) return;
  treeFileRecheckBarrierUsed = true;
  const directory = join(root, 'locks');
  mkdirSync(directory, { recursive: true });
  const ready = join(directory, `.tree-file-recheck-${token}.ready`);
  const resume = join(directory, `.tree-file-recheck-${token}.resume`);
  writeFileSync(ready, 'ready\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 10_000;
  while (!existsSync(resume)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the tree-file test barrier.');
    Atomics.wait(treeSnapshotWaiter, 0, 0, 10);
  }
}

function treeSnapshot(directory, root) {
  assertSafeChain(root, directory);
  const records = [];
  let totalBytes = 0;
  let fileCount = 0;
  let maximumDepth = 0;
  const directoryListings = new Map();

  function addRecord(record, depth) {
    if (depth > MAX_TREE_DEPTH) {
      throw resourceLimitError(`Session tree exceeds maximum depth ${MAX_TREE_DEPTH}: ${directory}`);
    }
    if (records.length >= MAX_TREE_ENTRIES) {
      throw resourceLimitError(`Session tree exceeds maximum entry count ${MAX_TREE_ENTRIES}: ${directory}`);
    }
    records.push(record);
    maximumDepth = Math.max(maximumDepth, depth);
  }

  function visit(current, rel, depth) {
    const metadata = lstatSync(current, { bigint: true });
    if (metadata.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${current}`);
    if (!metadata.isDirectory()) throw new Error(`Expected directory: ${current}`);
    addRecord({
      kind: 'directory',
      path: rel,
      mode: statMode(metadata),
      ...physicalIdentity(metadata),
    }, depth);
    const nameBudget = MAX_TREE_ENTRIES - records.length;
    const names = enumerateDirectoryNames(
      current,
      nameBudget,
      'Session tree directory',
    );
    const collisions = collisionNames(names);
    if (collisions.length) {
      throw new Error(`Normalization/case-fold collision in ${current}: ${JSON.stringify(collisions)}`);
    }
    pauseTestTreeSnapshot(root);
    for (const name of names) {
      const child = join(current, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const childMetadata = lstatSync(child, { bigint: true });
      if (childMetadata.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${child}`);
      if (childMetadata.isDirectory()) {
        visit(child, childRel, depth + 1);
        continue;
      }
      if (!childMetadata.isFile()) throw new Error(`Special files are not allowed: ${child}`);
      if (childMetadata.nlink !== 1n) throw new Error(`Hard-linked input is not allowed: ${child}`);
      if (childMetadata.size > BigInt(MAX_FILE_BYTES)) throw new Error(`Input file is oversized: ${child}`);
      fileCount += 1;
      totalBytes += statSize(childMetadata);
      if (fileCount > MAX_TREE_FILES || totalBytes > MAX_TREE_BYTES) {
        throw resourceLimitError(`Session tree exceeds migration limits: ${directory}`);
      }
      const file = readRegularBytes(child, root);
      addRecord({
        kind: 'file',
        path: childRel,
        digest: file.digest,
        size: file.size,
        mode: file.mode,
        nlink: file.nlink,
        device: file.device,
        inode: file.inode,
      }, depth + 1);
      pauseTestTreeFileRecheck(root);
    }
    const afterNames = enumerateDirectoryNames(current, nameBudget, 'Session tree directory');
    const after = lstatSync(current, { bigint: true });
    if (!after.isDirectory() || after.isSymbolicLink()
      || after.dev !== metadata.dev || after.ino !== metadata.ino
      || statMode(after) !== statMode(metadata)
      || canonicalJson(afterNames) !== canonicalJson(names)) {
      throw generationChangedError(`Session directory changed while it was inventoried: ${current}`);
    }
    directoryListings.set(rel, names);
  }

  visit(directory, '', 0);

  // A stable read of each file is not a coherent tree snapshot by itself: an
  // already-read sibling can change while later siblings are traversed. Fence
  // the complete generation once more before returning the plan.
  for (const record of records) {
    const target = record.path ? join(directory, ...record.path.split('/')) : directory;
    if (record.kind === 'file') {
      const current = readRegularBytes(target, root);
      if (canonicalJson(filePlan(current)) !== canonicalJson({
        digest: record.digest,
        size: record.size,
        mode: record.mode,
        nlink: record.nlink,
        device: record.device,
        inode: record.inode,
      })) {
        throw generationChangedError(`Session file changed while its tree was inventoried: ${target}`);
      }
      continue;
    }
    const metadata = lstatSync(target, { bigint: true });
    const identity = physicalIdentity(metadata);
    const names = enumerateDirectoryNames(
      target,
      MAX_TREE_ENTRIES,
      'Session tree directory',
    );
    if (!metadata.isDirectory() || metadata.isSymbolicLink()
      || identity.device !== record.device || identity.inode !== record.inode
      || statMode(metadata) !== record.mode
      || canonicalJson(names) !== canonicalJson(directoryListings.get(record.path))) {
      throw generationChangedError(`Session directory changed while its tree was inventoried: ${target}`);
    }
  }
  return {
    tree_digest: sha256(Buffer.from(canonicalJson(records))),
    total_bytes: totalBytes,
    file_count: fileCount,
    entry_count: records.length,
    max_depth: maximumDepth,
    records,
  };
}

function filePlan(record) {
  return {
    digest: record.digest,
    size: record.size,
    mode: record.mode,
    nlink: record.nlink,
    device: record.device,
    inode: record.inode,
  };
}

function planWithoutId(manifest) {
  const { migration_id: ignored, ...plan } = manifest;
  return plan;
}

function bindMigrationId(plan) {
  return sha256(Buffer.from(canonicalJson(plan)));
}

function assertManifestSerializedSize(manifest, label) {
  if (Buffer.byteLength(canonicalJson(manifest)) > MAX_MANIFEST_BYTES
    || Buffer.byteLength(prettyJson(manifest)) > MAX_MANIFEST_BYTES) {
    throw new Error(`${label} exceeds maximum serialized size ${MAX_MANIFEST_BYTES} bytes.`);
  }
}

function migrationKey(repoId, taskSegment) {
  return `${repoId}/${taskSegment}`;
}

function parseConfirmations(options = {}) {
  const inactive = [...new Set(options.confirmInactive || options.confirm_inactive || [])].sort(compareText);
  const workKind = {};
  const source = options.workKinds || options.work_kind || {};
  for (const [key, kind] of Object.entries(source)) {
    if (!WORK_KINDS.has(kind)) throw new Error(`Invalid work-kind override for ${key}: ${kind}`);
    workKind[key] = kind;
  }
  return { inactive, work_kind: Object.fromEntries(Object.entries(workKind).sort(([a], [b]) => compareText(a, b))) };
}

function relativeFromRoot(root, file) {
  const value = relative(root, file).split(sep).join('/');
  if (!value || value.startsWith('../') || value === '..') throw new Error(`Path is outside data root: ${file}`);
  return value;
}

function pointerRelative(repoId) {
  return `state/current-session/${repoId}.json`;
}

function sourceRelative(repoId, bucket, taskSegment) {
  return `repos/${repoId}/${bucket}/${taskSegment}`;
}

function historyRelative(repoId, bucket, taskSegment) {
  return `history/repos/${repoId}/${bucket}/${taskSegment}`;
}

function pointerHistoryRelative(repoId) {
  return `history/pointers/${repoId}.json`;
}

function pointerQuarantineRelative(repoId) {
  return `quarantine/pointers/${repoId}.json`;
}

function safeCanonicalWorkspace(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || !existsSync(value)) return false;
  try {
    const metadata = lstatSync(value);
    return metadata.isDirectory() && !metadata.isSymbolicLink()
      && resolve(realpathSync(value)) === resolve(value);
  } catch {
    return false;
  }
}

function workspaceBinding(workspaceInput) {
  const requestedPath = workspacePath(workspaceInput);
  const discovered = repoIdentity(requestedPath);
  const canonicalPath = workspacePath(discovered.root || requestedPath);
  const identity = repoIdentity(canonicalPath);
  const metadata = lstatSync(canonicalPath, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || resolve(realpathSync(canonicalPath)) !== canonicalPath) {
    throw new Error('Selected workspace is not a canonical real directory.');
  }
  return {
    canonical_path: canonicalPath,
    data_root: assertRoot(dataRoot(canonicalPath)),
    repo_id: identity.id,
    ...physicalIdentity(metadata),
  };
}

function entryWorkspaceBinding(workspaceInput, selectedBinding) {
  const requestedPath = workspacePath(workspaceInput);
  const requestedRoot = assertRoot(dataRoot(requestedPath));
  const discovered = stateCodec.repoIdentity(requestedPath, { dataRoot: requestedRoot });
  const canonicalPath = workspacePath(discovered.root || requestedPath);
  const root = assertRoot(dataRoot(canonicalPath));
  const identity = stateCodec.repoIdentity(canonicalPath, { dataRoot: root });
  if (canonicalPath === selectedBinding.canonical_path) return selectedBinding;
  const metadata = lstatSync(canonicalPath, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || resolve(realpathSync(canonicalPath)) !== canonicalPath
    || !safeRepoId(identity.id)) {
    throw new Error('Legacy session workspace cannot be independently bound.');
  }
  return {
    canonical_path: canonicalPath,
    data_root: root,
    repo_id: identity.id,
    ...physicalIdentity(metadata),
  };
}

function boundSessionPaths(binding, taskId) {
  const task = taskIdentity(taskId, 'task');
  const taskSegment = taskPathSegment(task);
  const repo = { id: binding.repo_id, root: binding.canonical_path };
  const repoRoot = join(binding.data_root, 'repos', binding.repo_id);
  return {
    root: binding.data_root,
    repo,
    task,
    taskSegment,
    repoRoot,
    sessionDir: join(repoRoot, 'sessions', taskSegment),
    completedDir: join(repoRoot, 'completed', taskSegment),
    currentFile: join(binding.data_root, 'state', 'current-session', `${binding.repo_id}.json`),
  };
}

function storageBindingPaths(entries) {
  const paths = new Set(['']);
  const addParents = (file) => {
    const segments = file.split('/').slice(0, -1);
    for (let index = 1; index <= segments.length; index += 1) {
      paths.add(segments.slice(0, index).join('/'));
    }
  };
  for (const entry of entries.filter((candidate) => MUTATING_ACTIONS.has(candidate.action))) {
    addParents(entry.pointer_relative);
    if (entry.source_relative) addParents(entry.source_relative);
  }
  return [...paths].sort(compareText);
}

function storageBinding(root, entries) {
  return storageBindingPaths(entries).map((relativePath) => {
    const target = relativePath ? join(root, ...relativePath.split('/')) : root;
    assertSafeChain(root, target);
    const metadata = lstatSync(target, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()
      || resolve(realpathSync(target)) !== resolve(target)) {
      throw new Error(`Migration storage ancestor is not a canonical directory: ${target}`);
    }
    return {
      path: relativePath,
      ...physicalIdentity(metadata),
    };
  });
}

function classifyV2PointerEntry(root, selectedBinding, repoId, pointerRecord, pointerValue, base) {
  let taskId;
  let taskSegment;
  try {
    if (typeof pointerValue.task_id !== 'string' || !pointerValue.task_id.trim()) {
      throw new Error('task_id is missing');
    }
    taskId = taskIdentity(pointerValue.task_id);
    taskSegment = taskPathSegment(taskId);
  } catch (error) {
    return { ...base, reason: `invalid_v2_pointer: ${error.message}` };
  }
  const bucket = pointerValue.status === 'completed' ? 'completed' : 'sessions';
  const sourceDir = join(root, 'repos', repoId, bucket, taskSegment);
  const identified = {
    ...base,
    entry_id: migrationKey(repoId, taskSegment),
    task_id: taskId,
    task_segment: taskSegment,
    source_relative: sourceRelative(repoId, bucket, taskSegment),
  };
  if (pointerValue.session_dir !== sourceDir || !existsSync(sourceDir)) {
    return { ...identified, reason: 'invalid_v2_pointer_runtime_path' };
  }
  try {
    const session = parseJsonBytes(
      readRegularBytes(join(sourceDir, 'session.json'), root),
      `${identified.source_relative}/session.json`,
    );
    if (!safeCanonicalWorkspace(session.workspace)) {
      throw new Error('session workspace is not canonical');
    }
    const binding = entryWorkspaceBinding(session.workspace, selectedBinding);
    if (binding.data_root !== root || binding.repo_id !== repoId) {
      throw new Error('session workspace does not bind this repository and data root');
    }
    const paths = boundSessionPaths(binding, taskId);
    const intent = parseJsonBytes(
      readRegularBytes(join(sourceDir, 'intent.json'), root),
      `${identified.source_relative}/intent.json`,
    );
    const errors = [
      ...pointerErrors(pointerValue, paths),
      ...sessionErrors(session, paths, pointerValue),
      ...intentErrors(intent, paths, session),
    ];
    if (errors.length) throw new Error(errors.join('; '));
    return {
      ...identified,
      action: 'ignore_v2',
      workspace_binding: binding,
      reason: 'state_envelope_v2',
    };
  } catch (error) {
    return { ...identified, reason: `invalid_v2_state: ${error.message}` };
  }
}

function classifyPointerEntry({
  root,
  binding,
  repoId,
  pointerRecord,
  pointerValue,
  confirmations,
  consumedConfirmations,
  issues,
}) {
  const base = {
    entry_id: `${repoId}/@pointer`,
    repo_id: repoId,
    task_id: null,
    task_segment: null,
    pointer_relative: pointerRelative(repoId),
    pointer: filePlan(pointerRecord),
    source_relative: null,
    source: null,
    metadata: null,
    workspace_binding: null,
    action: 'manual',
    reason: 'legacy_pointer_unclassified',
  };
  const first = classifyLegacyPointer(pointerValue, { repo_id: repoId });
  if (first.kind === 'state_v2') {
    return classifyV2PointerEntry(root, binding, repoId, pointerRecord, pointerValue, base);
  }
  if (isObject(pointerValue) && Number.isInteger(pointerValue.schema_version)
    && pointerValue.schema_version > 2) {
    return { ...base, reason: `unsupported_future_state_schema:${pointerValue.schema_version}` };
  }
  if (first.kind === 'legacy_telemetry') {
    if (repoId !== binding.repo_id) {
      return { ...base, reason: 'foreign_pointer_lacks_independent_workspace_binding' };
    }
    return {
      ...base,
      action: 'quarantine_pointer',
      workspace_binding: binding,
      reason: first.reason,
      quarantine_relative: pointerQuarantineRelative(repoId),
    };
  }
  if (first.kind !== 'legacy_state_v1' || !first.valid || !first.metadata?.task_id) {
    if (repoId !== binding.repo_id) {
      return { ...base, reason: 'foreign_pointer_lacks_independent_workspace_binding' };
    }
    if (first.source_schema !== 1) {
      return { ...base, reason: first.reason || 'pointer_schema_unknown' };
    }
    return {
      ...base,
      action: 'quarantine_pointer',
      workspace_binding: binding,
      reason: first.reason || 'legacy_pointer_invalid',
      quarantine_relative: pointerQuarantineRelative(repoId),
    };
  }

  let taskId;
  let taskSegment;
  try {
    taskId = taskIdentity(first.metadata.task_id);
    taskSegment = taskPathSegment(taskId);
  } catch (error) {
    return { ...base, reason: `unsafe_task_identity: ${error.message}` };
  }
  const bucket = first.metadata.status === 'completed' ? 'completed' : 'sessions';
  const sourceDir = join(root, 'repos', repoId, bucket, taskSegment);
  const expected = {
    repo_id: repoId,
    task_id: taskId,
    session_dir: join(root, 'repos', repoId, 'sessions', taskSegment),
    completed_dir: join(root, 'repos', repoId, 'completed', taskSegment),
  };
  const pointerClassification = classifyLegacyPointer(pointerValue, expected);
  const identified = {
    ...base,
    entry_id: migrationKey(repoId, taskSegment),
    task_id: taskId,
    task_segment: taskSegment,
    source_relative: sourceRelative(repoId, bucket, taskSegment),
  };
  if (!pointerClassification.valid) {
    if (repoId !== binding.repo_id) {
      return { ...identified, reason: 'foreign_pointer_runtime_path_unproven' };
    }
    return {
      ...identified,
      action: 'quarantine_pointer',
      workspace_binding: binding,
      reason: pointerClassification.reason,
      quarantine_relative: pointerQuarantineRelative(repoId),
    };
  }
  if (!existsSync(sourceDir)) {
    if (repoId !== binding.repo_id) {
      return { ...identified, reason: 'foreign_pointer_runtime_path_unproven' };
    }
    return {
      ...identified,
      action: 'quarantine_pointer',
      workspace_binding: binding,
      reason: 'legacy_pointer_dangling',
      quarantine_relative: pointerQuarantineRelative(repoId),
    };
  }

  let source;
  let sessionRecord;
  let sessionValue;
  try {
    source = treeSnapshot(sourceDir, root);
    sessionRecord = readRegularBytes(join(sourceDir, 'session.json'), root);
    sessionValue = parseJsonBytes(sessionRecord, `${identified.source_relative}/session.json`);
  } catch (error) {
    if (['PHANTOM_MIGRATION_RESOURCE_LIMIT', 'PHANTOM_MIGRATION_GENERATION_CHANGED'].includes(error.code)) {
      throw error;
    }
    return { ...identified, reason: `unsafe_legacy_session: ${error.message}` };
  }
  const sessionClassification = classifyLegacySession(sessionValue, {
    repo_id: repoId,
    task_id: taskId,
    source_path: join(sourceDir, 'session.json'),
    session_file: join(sourceDir, 'session.json'),
  });
  const requirement = legacyMigrationRequirement(pointerClassification, sessionClassification);
  const withSource = {
    ...identified,
    source,
    metadata: sessionClassification.metadata,
    reason: requirement.reason,
  };
  if (requirement.status !== 'required' || !sessionClassification.metadata) return withSource;
  const metadata = sessionClassification.metadata;
  if (!safeCanonicalWorkspace(metadata.workspace)) {
    return { ...withSource, reason: 'legacy_session_workspace_not_canonical_or_missing' };
  }
  let workspaceBindingForEntry;
  try {
    workspaceBindingForEntry = entryWorkspaceBinding(metadata.workspace, binding);
  } catch (error) {
    return { ...withSource, reason: `legacy_session_workspace_binding_invalid: ${error.message}` };
  }
  if (workspaceBindingForEntry.data_root !== root || workspaceBindingForEntry.repo_id !== repoId) {
    return { ...withSource, reason: 'legacy_session_workspace_or_repo_binding_mismatch' };
  }
  const runtimePaths = boundSessionPaths(workspaceBindingForEntry, taskId);
  if (resolve(runtimePaths.currentFile) !== resolve(root, pointerRelative(repoId))
    || resolve(bucket === 'completed' ? runtimePaths.completedDir : runtimePaths.sessionDir) !== sourceDir) {
    return { ...withSource, reason: 'legacy_session_runtime_path_binding_mismatch' };
  }
  if (!ROUTES.has(metadata.route)) return { ...withSource, reason: 'legacy_session_route_invalid' };
  const key = migrationKey(repoId, taskSegment);
  const workKindOverride = confirmations.work_kind[key];
  if (metadata.work_kind && workKindOverride) {
    consumedConfirmations.work_kind.add(key);
    issues.push(`${metadata.work_kind === workKindOverride ? 'redundant' : 'conflicting'}_work_kind_override:${key}`);
  }
  if (!metadata.work_kind && workKindOverride) consumedConfirmations.work_kind.add(key);
  const workKind = metadata.work_kind || workKindOverride || null;
  if (!WORK_KINDS.has(workKind)) return { ...withSource, reason: 'explicit_work_kind_required' };
  const migrated = {
    ...withSource,
    metadata: { ...metadata, workspace: workspaceBindingForEntry.canonical_path, work_kind: workKind },
    workspace_binding: workspaceBindingForEntry,
  };
  if (metadata.status === 'completed') {
    return {
      ...migrated,
      action: 'archive_completed',
      reason: 'completed_history_only',
      history_relative: historyRelative(repoId, bucket, taskSegment),
      pointer_history_relative: pointerHistoryRelative(repoId),
    };
  }
  if (metadata.status === 'active' && !confirmations.inactive.includes(key)) {
    return { ...migrated, reason: 'explicit_inactive_confirmation_required' };
  }
  if (metadata.status === 'active') consumedConfirmations.inactive.add(key);
  if (!['active', 'paused'].includes(metadata.status)) {
    return { ...migrated, reason: 'legacy_session_status_not_continuable' };
  }
  return {
    ...migrated,
    action: 'migrate_to_paused',
    reason: metadata.status === 'active' ? 'active_explicitly_confirmed_inactive' : 'paused_continuation',
    history_relative: historyRelative(repoId, bucket, taskSegment),
    successor_relative: sourceRelative(repoId, 'sessions', taskSegment),
  };
}

function inventoryCollector() {
  return {
    entries: [],
    serialized_entry_bytes: 0,
    tree_records: 0,
    mutating_tree_bytes: 0,
  };
}

function inventoryTreeByteLimit() {
  const seam = process.env[TEST_AGGREGATE_TREE_BYTES_ENV];
  if (seam === undefined) return MAX_INVENTORY_TREE_BYTES;
  if (!/^\d+$/.test(seam) || BigInt(seam) > BigInt(MAX_INVENTORY_TREE_BYTES)) {
    throw new Error(`${TEST_AGGREGATE_TREE_BYTES_ENV} must not exceed ${MAX_INVENTORY_TREE_BYTES}.`);
  }
  return Number(seam);
}

function addInventoryEntry(collector, entry) {
  if (collector.entries.length >= MAX_MANIFEST_ENTRIES) {
    throw new Error(`Migration inventory exceeds maximum entry count ${MAX_MANIFEST_ENTRIES}.`);
  }
  const entryBytes = Buffer.byteLength(prettyJson(entry));
  if (collector.serialized_entry_bytes + entryBytes > MAX_MANIFEST_BYTES) {
    throw new Error(`Migration inventory entries exceed maximum serialized size ${MAX_MANIFEST_BYTES} bytes.`);
  }
  const treeRecords = entry.source?.entry_count || 0;
  if (!Number.isInteger(treeRecords) || treeRecords < 0
    || collector.tree_records + treeRecords > MAX_INVENTORY_TREE_RECORDS) {
    throw new Error(
      `Migration inventory exceeds maximum aggregate tree records ${MAX_INVENTORY_TREE_RECORDS}.`,
    );
  }
  const mutatingTreeBytes = MUTATING_ACTIONS.has(entry.action) ? (entry.source?.total_bytes || 0) : 0;
  const treeByteLimit = inventoryTreeByteLimit();
  if (!Number.isInteger(mutatingTreeBytes) || mutatingTreeBytes < 0
    || collector.mutating_tree_bytes + mutatingTreeBytes > treeByteLimit) {
    throw new Error(
      `Migration inventory exceeds maximum aggregate tree bytes ${treeByteLimit}.`,
    );
  }
  collector.entries.push(entry);
  collector.serialized_entry_bytes += entryBytes;
  collector.tree_records += treeRecords;
  collector.mutating_tree_bytes += mutatingTreeBytes;
}

function collectUnpointedEntries(root, pointedSources, issues, collector) {
  const reposRoot = join(root, 'repos');
  if (!existsSync(reposRoot)) return;
  const repoNames = readDirectoryNames(reposRoot, root);
  for (const repoId of repoNames) {
    const repoDir = join(reposRoot, repoId);
    const metadata = lstatSync(repoDir);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || !safeRepoId(repoId)) {
      addInventoryEntry(collector, {
        entry_id: `unpointed:${repoId}`,
        repo_id: safeRepoId(repoId) ? repoId : null,
        task_id: null,
        task_segment: null,
        pointer_relative: null,
        pointer: null,
        source_relative: relativeFromRoot(root, repoDir),
        source: null,
        metadata: null,
        action: 'manual',
        reason: 'unsafe_repo_shard',
      });
      continue;
    }
    for (const bucket of ['sessions', 'completed']) {
      const bucketDir = join(repoDir, bucket);
      if (!existsSync(bucketDir)) continue;
      let taskSegments;
      try {
        taskSegments = readDirectoryNames(bucketDir, root);
      } catch (error) {
        issues.push(`unsafe_session_bucket:${repoId}/${bucket}:${error.message}`);
        addInventoryEntry(collector, {
          entry_id: `unpointed:${repoId}/${bucket}`,
          repo_id: repoId,
          task_id: null,
          task_segment: null,
          pointer_relative: null,
          pointer: null,
          source_relative: sourceRelative(repoId, bucket, '@bucket'),
          source: null,
          metadata: null,
          action: 'manual',
          reason: `unsafe_session_bucket: ${error.message}`,
        });
        continue;
      }
      for (const taskSegment of taskSegments) {
        const rel = sourceRelative(repoId, bucket, taskSegment);
        if (pointedSources.has(rel)) continue;
        const sessionDir = join(bucketDir, taskSegment);
        let source = null;
        let reason = 'historical_artifact_only_untouched';
        try {
          source = treeSnapshot(sessionDir, root);
          if (existsSync(join(sessionDir, 'session.json'))) {
            const sessionValue = parseJsonBytes(
              readRegularBytes(join(sessionDir, 'session.json'), root),
              `${rel}/session.json`,
            );
            const classification = classifyLegacySession(sessionValue, { repo_id: repoId });
            reason = classification.kind === 'legacy_state_v1'
              ? 'unpointed_legacy_session_requires_manual_decision'
              : 'unpointed_nonlegacy_session_untouched';
          }
        } catch (error) {
          if (['PHANTOM_MIGRATION_RESOURCE_LIMIT', 'PHANTOM_MIGRATION_GENERATION_CHANGED'].includes(error.code)) {
            throw error;
          }
          reason = `unsafe_unpointed_session: ${error.message}`;
        }
        addInventoryEntry(collector, {
          entry_id: `unpointed:${repoId}/${bucket}/${taskSegment}`,
          repo_id: repoId,
          task_id: null,
          task_segment: taskSegment,
          pointer_relative: null,
          pointer: null,
          source_relative: rel,
          source,
          metadata: null,
          action: 'manual',
          reason,
        });
      }
    }
  }
}

export function inventoryMigration(options = {}) {
  const workspace = workspacePath(options.workspace);
  const binding = workspaceBinding(workspace);
  const root = binding.data_root;
  const confirmations = parseConfirmations(options);
  const collector = inventoryCollector();
  const { entries } = collector;
  const issues = [];
  const consumedConfirmations = { inactive: new Set(), work_kind: new Set() };
  const pointedSources = new Set();
  const pointerDir = join(root, 'state', 'current-session');

  if (existsSync(root) && existsSync(pointerDir)) {
    let names;
    try {
      names = readDirectoryNames(pointerDir, root);
    } catch (error) {
      names = [];
      issues.push(`unsafe_pointer_directory: ${error.message}`);
    }
    for (const name of names) {
      if (!name.endsWith('.json')) {
        issues.push(`unexpected_pointer_entry:${name}`);
        continue;
      }
      const repoId = name.slice(0, -'.json'.length);
      if (!safeRepoId(repoId)) {
        issues.push(`unsafe_pointer_repo_id:${name}`);
        continue;
      }
      const pointerFile = join(pointerDir, name);
      let pointerRecord;
      try {
        pointerRecord = readRegularBytes(pointerFile, root);
      } catch (error) {
        addInventoryEntry(collector, {
          entry_id: `${repoId}/@pointer`,
          repo_id: repoId,
          task_id: null,
          task_segment: null,
          pointer_relative: pointerRelative(repoId),
          pointer: null,
          source_relative: null,
          source: null,
          metadata: null,
          action: 'manual',
          reason: `unsafe_or_malformed_pointer: ${error.message}`,
        });
        continue;
      }
      let pointerValue;
      try {
        pointerValue = parseJsonBytes(pointerRecord, pointerRelative(repoId));
      } catch (error) {
        addInventoryEntry(collector, {
          entry_id: `${repoId}/@pointer`,
          repo_id: repoId,
          task_id: null,
          task_segment: null,
          pointer_relative: pointerRelative(repoId),
          pointer: filePlan(pointerRecord),
          source_relative: null,
          source: null,
          metadata: null,
          action: repoId === binding.repo_id ? 'quarantine_pointer' : 'manual',
          workspace_binding: repoId === binding.repo_id ? binding : null,
          reason: `unsafe_or_malformed_pointer: ${error.message}`,
          ...(repoId === binding.repo_id
            ? { quarantine_relative: pointerQuarantineRelative(repoId) } : {}),
        });
        continue;
      }
      const entry = classifyPointerEntry({
        root,
        binding,
        repoId,
        pointerRecord,
        pointerValue,
        confirmations,
        consumedConfirmations,
        issues,
      });
      addInventoryEntry(collector, entry);
      if (entry.source_relative) pointedSources.add(entry.source_relative);
    }
    collectUnpointedEntries(root, pointedSources, issues, collector);
  } else if (existsSync(root)) {
    collectUnpointedEntries(root, pointedSources, issues, collector);
  }

  for (const key of confirmations.inactive) {
    if (!consumedConfirmations.inactive.has(key)) issues.push(`unused_inactive_confirmation:${key}`);
  }
  for (const key of Object.keys(confirmations.work_kind)) {
    if (!consumedConfirmations.work_kind.has(key)) issues.push(`unused_work_kind_override:${key}`);
  }
  entries.sort((left, right) => compareText(left.entry_id, right.entry_id));
  const summary = entries.reduce((result, entry) => {
    result[entry.action] = (result[entry.action] || 0) + 1;
    return result;
  }, {});
  const plan = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    artifact_type: 'phantom-session-state-migration-manifest',
    migration_contract: 'state-envelope-v1-to-v2-offline',
    data_root: root,
    workspace_binding: binding,
    storage_binding: storageBinding(root, entries),
    confirmations,
    aggregate_tree_bytes: collector.mutating_tree_bytes,
    issues: issues.sort(compareText),
    entries,
    summary,
  };
  const manifest = { ...plan, migration_id: bindMigrationId(plan) };
  assertManifestSerializedSize(manifest, 'Migration inventory');
  return manifest;
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = openSync(directory, 'r');
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertOutputRoot(root) {
  const safeRoot = assertRoot(root);
  if (!existsSync(safeRoot)) throw new Error(`Phantom data root must exist before migration apply: ${safeRoot}`);
  return safeRoot;
}

function durableMkdir(root, directory, mode = 0o700) {
  const safeRoot = assertOutputRoot(root);
  const target = resolve(directory);
  if (!isWithin(safeRoot, target)) throw new Error(`Output path escapes the Phantom data root: ${target}`);
  const rel = relative(safeRoot, target);
  let current = safeRoot;
  for (const segment of rel === '' ? [] : rel.split(sep)) {
    const parent = current;
    current = join(current, segment);
    const metadata = lstatIfPresent(current);
    if (metadata) {
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`Migration output parent is not a real directory: ${current}`);
      }
      continue;
    }
    mkdirSync(current, { mode });
    fsyncDirectory(parent);
  }
  assertSafeChain(safeRoot, target);
}

function normalizeOwnedPrivateMigrationDirectories(root, paths) {
  const safeRoot = assertOutputRoot(root);
  const migrationRoot = join(safeRoot, 'migrations', 'session-state');
  const directories = new Set([
    safeRoot,
    join(safeRoot, 'locks'),
    join(safeRoot, 'migrations'),
    migrationRoot,
  ]);
  for (const candidate of paths) {
    const parent = resolve(dirname(candidate));
    if (!isWithin(migrationRoot, parent)) {
      throw new Error(`Migration control path escapes the transaction hierarchy: ${candidate}`);
    }
    if (lstatIfPresent(parent)) directories.add(parent);
  }

  const expectedUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  for (const directory of directories) {
    if (!lstatIfPresent(directory)) continue;
    if (process.platform === 'win32'
      || !Number.isInteger(constants.O_DIRECTORY) || constants.O_DIRECTORY <= 0
      || !Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW <= 0) {
      throw new Error('This runtime cannot enforce no-follow migration directory normalization.');
    }
    let descriptor;
    try {
      descriptor = openSync(
        directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      const before = fstatSync(descriptor, { bigint: true });
      if (!before.isDirectory()) {
        throw new Error(`Migration output parent is not a real directory: ${directory}`);
      }
      if (expectedUid !== null && before.uid !== expectedUid) {
        throw new Error(`Migration control directory has a different owner: ${directory}`);
      }
      const device = before.dev;
      const inode = before.ino;
      pauseTestDirectoryModeNormalization(safeRoot, directory);
      fchmodSync(descriptor, 0o700);
      const after = fstatSync(descriptor, { bigint: true });
      if (!after.isDirectory() || after.dev !== device || after.ino !== inode
        || (expectedUid !== null && after.uid !== expectedUid)
        || statMode(after) !== 0o700) {
        throw new Error(`Migration control directory changed during private-mode normalization: ${directory}`);
      }
      const pathState = lstatSync(directory, { bigint: true });
      if (pathState.isSymbolicLink() || !pathState.isDirectory()
        || pathState.dev !== device || pathState.ino !== inode
        || statMode(pathState) !== 0o700) {
        throw new Error(`Migration control directory path changed during private-mode normalization: ${directory}`);
      }
    } catch (error) {
      if (error.code === 'ELOOP' || error.code === 'ENOTDIR') {
        throw new Error(`Migration output parent is not a real directory: ${directory}`);
      }
      throw error;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}

function pauseTestDirectoryModeNormalization(root, directory) {
  const seam = process.env[TEST_DIRECTORY_MODE_BARRIER_ENV];
  if (!seam || directoryModeBarrierUsed) return;
  const separator = seam.indexOf(':');
  if (separator <= 0 || resolve(directory) === resolve(root)
    || relativeFromRoot(root, directory) !== seam.slice(separator + 1)) return;
  directoryModeBarrierUsed = true;
  const token = seam.slice(0, separator);
  const ready = join(root, `.migration-directory-mode-${token}.ready`);
  const resume = join(root, `.migration-directory-mode-${token}.resume`);
  writeFileSync(ready, 'ready\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 10_000;
  while (!existsSync(resume)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the migration-directory-mode test barrier.');
    Atomics.wait(treeSnapshotWaiter, 0, 0, 10);
  }
}

function assertWritableLeaf(root, file) {
  const safeRoot = assertOutputRoot(root);
  const target = resolve(file);
  if (!isWithin(safeRoot, target)) throw new Error(`Output path escapes the Phantom data root: ${target}`);
  assertSafeChain(safeRoot, dirname(target));
  const metadata = lstatIfPresent(target);
  if (metadata) {
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
      throw new Error(`Migration output is not a private regular file: ${target}`);
    }
  }
  return target;
}

function migrationPublicationTarget(root, file) {
  const safeRoot = assertOutputRoot(root);
  const target = resolve(file);
  if (!isWithin(safeRoot, target) || target === safeRoot) {
    throw new Error(`Publication target escapes the Phantom data root: ${target}`);
  }
  return relative(safeRoot, target);
}

function pauseTestMigrationPublication(root, point) {
  const configured = process.env[TEST_PUBLICATION_BARRIER_ENV];
  if (typeof configured !== 'string') return;
  const separator = configured.lastIndexOf(':');
  if (separator < 1) return;
  const expected = configured.slice(0, separator);
  const token = configured.slice(separator + 1);
  if (expected !== point || publicationBarriersUsed.has(point)
    || !/^[A-Za-z0-9_-]{1,160}$/.test(point)
    || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) return;
  publicationBarriersUsed.add(point);
  const ready = join(root, 'locks', `.migration-publication-${token}.ready`);
  const resume = join(root, 'locks', `.migration-publication-${token}.resume`);
  writeFileSync(ready, 'ready\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 10_000;
  while (!existsSync(resume)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the migration-publication test barrier.');
    Atomics.wait(treeSnapshotWaiter, 0, 0, 10);
  }
}

function migrationPublicationHooks(root, operation) {
  return {
    onStep(step) {
      const point = `${operation}_${step}`;
      pauseTestMigrationPublication(root, point);
      crashAt(`publication_${point}`);
    },
  };
}

function migrationPublicationRequest(root, file, bytes, mode, operation) {
  return {
    root,
    target: migrationPublicationTarget(root, file),
    operation,
    mode,
    bytes,
    maxBytes: MAX_MANIFEST_BYTES,
    hooks: migrationPublicationHooks(root, operation),
  };
}

function publishMigrationBytes(root, file, bytes, mode, operation, options = {}) {
  durableMkdir(root, dirname(file));
  const request = migrationPublicationRequest(root, file, bytes, mode, operation);
  const validateLease = typeof options.validateLease === 'function'
    ? (phase, context) => {
      const valid = options.validateLease(phase, context);
      if (valid === true) {
        const point = `${operation}_${phase}`;
        pauseTestMigrationPublication(root, point);
        crashAt(`publication_${point}`);
      }
      return valid;
    }
    : undefined;
  const publication = {
    ...request,
    expectedTarget: options.expectedTarget ?? { state: 'absent' },
    ...(validateLease ? { validateLease } : {}),
  };
  try {
    return publishDurablePublication(publication);
  } catch (error) {
    const preparedPath = join(dirname(file), preparedPublicationName(request));
    const needsReplacementPreparation = options.expectedTarget?.state === 'present'
      && error.code === DURABLE_PUBLICATION_ERROR_CODES.MISMATCH
      && !existsSync(preparedPath);
    if (error.code !== DURABLE_PUBLICATION_ERROR_CODES.MISSING
      && !needsReplacementPreparation) throw error;
  }
  prepareDurablePublication(request);
  return publishDurablePublication(publication);
}

function publishMigrationJson(root, file, value, operation, options = {}) {
  return publishMigrationBytes(
    root,
    file,
    Buffer.from(prettyJson(value)),
    0o600,
    operation,
    options,
  );
}

function capturedPublicationRecord(generation) {
  if (generation.state !== 'present' || ![1, 2].includes(generation.nlink)) {
    throw new Error('Migration publication target has an unsafe link generation.');
  }
  return {
    bytes: generation.bytes,
    digest: sha256(generation.bytes),
    size: generation.size,
    mode: generation.mode,
    nlink: generation.nlink,
    device: generation.device,
    inode: generation.inode,
  };
}

function readPublicationTarget(root, file, maximum) {
  if (!lstatIfPresent(dirname(file))) return null;
  const generation = captureTargetGeneration({
    root,
    target: migrationPublicationTarget(root, file),
    maxBytes: maximum,
  });
  return generation.state === 'absent' ? null : capturedPublicationRecord(generation);
}

function publicationNames(root, file, bytes, mode, operation) {
  const prepared = preparedPublicationName(
    migrationPublicationRequest(root, file, bytes, mode, operation),
  );
  return {
    prepared,
    stagePrefix: `${prepared.slice(0, -'.prepared'.length)}.stage-`,
  };
}

function matchesPublicationName(name, publication) {
  return name === publication.prepared || name.startsWith(publication.stagePrefix);
}

function durableRename(root, source, destination) {
  const safeRoot = assertOutputRoot(root);
  if (!isWithin(safeRoot, source) || !isWithin(safeRoot, destination)) {
    throw new Error('Migration rename path escapes the Phantom data root.');
  }
  assertSafeChain(safeRoot, source);
  durableMkdir(safeRoot, dirname(destination));
  assertSafeChain(safeRoot, dirname(destination));
  if (lstatIfPresent(destination)) throw new Error(`Migration rename destination already exists: ${destination}`);
  renameSync(source, destination);
  fsyncDirectory(dirname(source));
  if (dirname(source) !== dirname(destination)) fsyncDirectory(dirname(destination));
}

function durableReplace(root, source, destination) {
  const safeRoot = assertOutputRoot(root);
  if (!isWithin(safeRoot, source) || !isWithin(safeRoot, destination)) {
    throw new Error('Migration replacement path escapes the Phantom data root.');
  }
  const sourceFile = readRegularBytes(source, safeRoot);
  assertSafeChain(safeRoot, dirname(destination));
  assertWritableLeaf(safeRoot, destination);
  renameSync(source, destination);
  const replaced = readRegularBytes(destination, safeRoot);
  if (replaced.device !== sourceFile.device || replaced.inode !== sourceFile.inode) {
    throw new Error(`Migration replacement changed physical identity: ${destination}`);
  }
  fsyncDirectory(dirname(source));
  if (dirname(source) !== dirname(destination)) fsyncDirectory(dirname(destination));
}

function durableUnlink(root, file) {
  const target = assertWritableLeaf(root, file);
  unlinkSync(target);
  fsyncDirectory(dirname(target));
}

function readManifest(file) {
  if (typeof file !== 'string' || !file) throw new Error('--manifest is required.');
  const absolute = resolve(file);
  const root = dirname(absolute);
  const record = readRegularBytes(absolute, root, MAX_MANIFEST_BYTES);
  if ((record.mode & 0o077) !== 0) {
    throw new Error('Migration manifest must be private (mode 0600 or stricter).');
  }
  const manifest = parseJsonBytes(record, 'migration manifest');
  validateManifest(manifest);
  return manifest;
}

function writePrivateManifest(file, manifest) {
  if (typeof file !== 'string' || !file.trim()) throw new Error('--output requires a file path.');
  const requested = resolve(file);
  const requestedParent = dirname(requested);
  const parentMetadata = lstatSync(requestedParent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    throw new Error(`Manifest output parent is not a real directory: ${requestedParent}`);
  }
  const parent = resolve(realpathSync(requestedParent));
  const target = join(parent, basename(requested));
  if (existsSync(target)) throw new Error(`Manifest output already exists: ${target}`);
  const temporary = join(parent, `.${basename(target)}.tmp-${process.pid}-${randomUUID()}`);
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(descriptor, prettyJson(manifest), 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    // link(2) supplies atomic no-replace publication. If the process dies
    // before the private temporary link is removed, readManifest rejects the
    // surviving nlink=2 file instead of trusting ambiguous provenance.
    linkSync(temporary, target);
    unlinkSync(temporary);
    fsyncDirectory(parent);
  } catch (error) {
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch {}
    throw error;
  }
  const published = readRegularBytes(target, parent, MAX_MANIFEST_BYTES);
  if (published.mode !== 0o600 || published.nlink !== 1
    || !published.bytes.equals(Buffer.from(prettyJson(manifest)))) {
    throw new Error(`Published migration manifest failed its private-file contract: ${target}`);
  }
  return target;
}

function assertFilePlan(plan, label) {
  if (!isObject(plan)
    || !/^sha256:[a-f0-9]{64}$/.test(plan.digest || '')
    || !Number.isInteger(plan.size) || plan.size < 0 || plan.size > MAX_FILE_BYTES
    || !Number.isInteger(plan.mode) || plan.mode < 0 || plan.mode > 0o777
    || plan.nlink !== 1
    || !/^\d+$/.test(plan.device)
    || !/^\d+$/.test(plan.inode)) {
    throw new Error(`${label} has an invalid regular-file binding.`);
  }
}

function assertTreePlan(plan, label) {
  if (!isObject(plan)
    || !/^sha256:[a-f0-9]{64}$/.test(plan.tree_digest || '')
    || !Number.isInteger(plan.total_bytes) || plan.total_bytes < 0 || plan.total_bytes > MAX_TREE_BYTES
    || !Number.isInteger(plan.file_count) || plan.file_count < 0 || plan.file_count > MAX_TREE_FILES
    || !Number.isInteger(plan.entry_count) || plan.entry_count < 1 || plan.entry_count > MAX_TREE_ENTRIES
    || !Number.isInteger(plan.max_depth) || plan.max_depth < 0 || plan.max_depth > MAX_TREE_DEPTH
    || !Array.isArray(plan.records)) {
    throw new Error(`${label} has an invalid tree binding.`);
  }
  const seen = new Set();
  let files = 0;
  let bytes = 0;
  let maximumDepth = 0;
  for (const record of plan.records) {
    if (!isObject(record) || !['directory', 'file'].includes(record.kind)
      || typeof record.path !== 'string' || record.path.includes('\\')
      || isAbsolute(record.path)
      || record.path.split('/').some((segment) => segment === '.' || segment === '..' || segment === '')) {
      if (!(record?.kind === 'directory' && record?.path === '')) {
        throw new Error(`${label} contains an unsafe tree record.`);
      }
    }
    const identity = `${record.kind}:${record.path}`;
    if (seen.has(identity)) throw new Error(`${label} contains a duplicate tree record.`);
    seen.add(identity);
    const depth = record.path === '' ? 0 : record.path.split('/').length;
    if (depth > MAX_TREE_DEPTH) throw new Error(`${label} contains an over-depth tree record.`);
    maximumDepth = Math.max(maximumDepth, depth);
    if (!Number.isInteger(record.mode) || record.mode < 0 || record.mode > 0o777) {
      throw new Error(`${label} contains an invalid mode.`);
    }
    if (!/^\d+$/.test(record.device) || !/^\d+$/.test(record.inode)) {
      throw new Error(`${label} contains an invalid physical identity.`);
    }
    if (record.kind === 'file') {
      assertFilePlan(record, `${label}:${record.path}`);
      files += 1;
      bytes += record.size;
    }
  }
  if (plan.records.length !== plan.entry_count
    || maximumDepth !== plan.max_depth
    || files !== plan.file_count || bytes !== plan.total_bytes
    || sha256(Buffer.from(canonicalJson(plan.records))) !== plan.tree_digest) {
    throw new Error(`${label} tree summary or digest differs.`);
  }
}

function assertWorkspaceBindingPlan(binding) {
  const fields = isObject(binding) ? Object.keys(binding).sort(compareText) : [];
  if (canonicalJson(fields) !== canonicalJson([
    'canonical_path', 'data_root', 'device', 'inode', 'repo_id',
  ])
    || !safeCanonicalWorkspace(binding.canonical_path)
    || typeof binding.data_root !== 'string' || !isAbsolute(binding.data_root)
    || !safeRepoId(binding.repo_id)
    || !/^\d+$/.test(binding.device)
    || !/^\d+$/.test(binding.inode)) {
    throw new Error('Migration manifest workspace binding is invalid.');
  }
}

function assertStorageBindingPlan(binding, entries) {
  if (!Array.isArray(binding)) throw new Error('Migration manifest storage binding is invalid.');
  const expectedPaths = storageBindingPaths(entries);
  const observedPaths = [];
  for (const record of binding) {
    const fields = isObject(record) ? Object.keys(record).sort(compareText) : [];
    if (canonicalJson(fields) !== canonicalJson(['device', 'inode', 'path'])
      || typeof record.path !== 'string'
      || !/^\d+$/.test(record.device)
      || !/^\d+$/.test(record.inode)) {
      throw new Error('Migration manifest storage binding is invalid.');
    }
    observedPaths.push(record.path);
  }
  if (canonicalJson(observedPaths) !== canonicalJson(expectedPaths)) {
    throw new Error('Migration manifest storage binding paths are incomplete or unordered.');
  }
}

function validateManifest(manifest) {
  if (!isObject(manifest)
    || manifest.schema_version !== MANIFEST_SCHEMA_VERSION
    || manifest.artifact_type !== 'phantom-session-state-migration-manifest'
    || manifest.migration_contract !== 'state-envelope-v1-to-v2-offline'
    || typeof manifest.data_root !== 'string' || !isAbsolute(manifest.data_root)
    || !isObject(manifest.workspace_binding)
    || !Array.isArray(manifest.storage_binding)
    || !Number.isInteger(manifest.aggregate_tree_bytes)
    || manifest.aggregate_tree_bytes < 0
    || manifest.aggregate_tree_bytes > MAX_INVENTORY_TREE_BYTES
    || !Array.isArray(manifest.entries)
    || manifest.entries.length > MAX_MANIFEST_ENTRIES
    || !isObject(manifest.confirmations)
    || !Array.isArray(manifest.issues)
    || typeof manifest.migration_id !== 'string') {
    throw new Error('Migration manifest contract is invalid.');
  }
  assertManifestSerializedSize(manifest, 'Migration manifest');
  const expectedId = bindMigrationId(planWithoutId(manifest));
  if (manifest.migration_id !== expectedId) throw new Error('Migration manifest digest does not match its plan.');
  assertWorkspaceBindingPlan(manifest.workspace_binding);
  if (manifest.workspace_binding.data_root !== manifest.data_root) {
    throw new Error('Migration manifest workspace and data-root bindings differ.');
  }
  if (manifest.issues.length) throw new Error(`Migration manifest has unresolved issues: ${manifest.issues.join(', ')}`);
  const seen = new Set();
  const mutatingRepos = new Set();
  let mutatingEntries = 0;
  let aggregateTreeRecords = 0;
  let aggregateTreeBytes = 0;
  for (const entry of manifest.entries) {
    if (!isObject(entry) || typeof entry.entry_id !== 'string' || seen.has(entry.entry_id)) {
      throw new Error('Migration manifest has invalid or duplicate entry identities.');
    }
    seen.add(entry.entry_id);
    if (entry.repo_id !== null && !safeRepoId(entry.repo_id)) throw new Error(`Unsafe repo identity: ${entry.entry_id}`);
    if (entry.pointer_relative !== null && entry.repo_id !== null
      && entry.pointer_relative !== pointerRelative(entry.repo_id)) {
      throw new Error(`Untrusted pointer path in manifest: ${entry.entry_id}`);
    }
    if (entry.source !== null) {
      assertTreePlan(entry.source, `Source ${entry.entry_id}`);
      aggregateTreeRecords += entry.source.entry_count;
      if (aggregateTreeRecords > MAX_INVENTORY_TREE_RECORDS) {
        throw new Error(`Migration manifest exceeds maximum aggregate tree records ${MAX_INVENTORY_TREE_RECORDS}.`);
      }
    }
    if (!MUTATING_ACTIONS.has(entry.action)) continue;
    aggregateTreeBytes += entry.source?.total_bytes || 0;
    if (aggregateTreeBytes > MAX_INVENTORY_TREE_BYTES) {
      throw new Error(`Migration manifest exceeds maximum aggregate tree bytes ${MAX_INVENTORY_TREE_BYTES}.`);
    }
    mutatingEntries += 1;
    if (mutatingEntries > MAX_MUTATING_ENTRIES) {
      throw new Error(`Migration manifest exceeds maximum mutating entry count ${MAX_MUTATING_ENTRIES}.`);
    }
    if (mutatingRepos.has(entry.repo_id)) {
      throw new Error(`Migration manifest has multiple mutations for repository ${entry.repo_id}.`);
    }
    mutatingRepos.add(entry.repo_id);
    if (!entry.pointer || !entry.repo_id) throw new Error(`Mutating entry lacks a bound pointer: ${entry.entry_id}`);
    assertWorkspaceBindingPlan(entry.workspace_binding);
    if (entry.workspace_binding.data_root !== manifest.data_root
      || entry.workspace_binding.repo_id !== entry.repo_id) {
      throw new Error(`Entry workspace binding differs: ${entry.entry_id}`);
    }
    assertFilePlan(entry.pointer, `Pointer ${entry.entry_id}`);
    if (entry.action === 'quarantine_pointer') {
      const expectedEntryId = entry.task_segment
        ? migrationKey(entry.repo_id, entry.task_segment) : `${entry.repo_id}/@pointer`;
      if (entry.entry_id !== expectedEntryId) throw new Error(`Invalid pointer entry identity: ${entry.entry_id}`);
      if (entry.quarantine_relative !== pointerQuarantineRelative(entry.repo_id)) {
        throw new Error(`Untrusted quarantine path in manifest: ${entry.entry_id}`);
      }
      continue;
    }
    if (!entry.task_id || !entry.task_segment || taskPathSegment(taskIdentity(entry.task_id)) !== entry.task_segment) {
      throw new Error(`Invalid task identity in manifest: ${entry.entry_id}`);
    }
    if (entry.entry_id !== migrationKey(entry.repo_id, entry.task_segment)) {
      throw new Error(`Invalid migration entry identity: ${entry.entry_id}`);
    }
    const bucket = entry.action === 'archive_completed' ? 'completed' : 'sessions';
    if (entry.source_relative !== sourceRelative(entry.repo_id, bucket, entry.task_segment)
      || entry.history_relative !== historyRelative(entry.repo_id, bucket, entry.task_segment)) {
      throw new Error(`Untrusted source/history path in manifest: ${entry.entry_id}`);
    }
    if (entry.action === 'migrate_to_paused'
      && entry.successor_relative !== sourceRelative(entry.repo_id, 'sessions', entry.task_segment)) {
      throw new Error(`Untrusted successor path in manifest: ${entry.entry_id}`);
    }
    if (['migrate_to_paused', 'archive_completed'].includes(entry.action)
      && (!isObject(entry.metadata)
        || entry.metadata.repo_id !== entry.repo_id
        || entry.metadata.task_id !== entry.task_id
        || !safeCanonicalWorkspace(entry.metadata.workspace)
        || !ROUTES.has(entry.metadata.route)
        || typeof entry.metadata.intent_summary !== 'string' || !entry.metadata.intent_summary.trim()
        || !WORK_KINDS.has(entry.metadata.work_kind)
        || !['standard', 'to-plan'].includes(entry.metadata.mode))) {
      throw new Error(`Invalid safe legacy metadata: ${entry.entry_id}`);
    }
    if (entry.action === 'archive_completed'
      && entry.pointer_history_relative !== pointerHistoryRelative(entry.repo_id)) {
      throw new Error(`Untrusted completed-pointer path in manifest: ${entry.entry_id}`);
    }
  }
  if (manifest.aggregate_tree_bytes !== aggregateTreeBytes) {
    throw new Error('Migration manifest aggregate_tree_bytes differs from its mutating entries.');
  }
  assertStorageBindingPlan(manifest.storage_binding, manifest.entries);
}

function transactionPaths(root, migrationId) {
  const id = digestHex(migrationId);
  const directory = join(root, 'migrations', 'session-state', id);
  return {
    directory,
    manifest: join(directory, 'manifest.json'),
    prepared: join(directory, 'transaction-prepared.json'),
    backups: join(directory, 'backups'),
    history: join(directory, 'history'),
    quarantine: join(directory, 'quarantine'),
    staging: join(directory, 'staging'),
    journals: join(directory, 'journals'),
    rollback: join(directory, 'rollback'),
    rollbackState: join(directory, 'rollback-state.json'),
  };
}

function deriveEntryPaths(root, tx, entry) {
  const pointer = join(root, 'state', 'current-session', `${entry.repo_id}.json`);
  const result = { pointer };
  if (entry.action === 'quarantine_pointer') {
    result.quarantine = join(tx.directory, pointerQuarantineRelative(entry.repo_id));
  } else if (entry.action === 'migrate_to_paused' || entry.action === 'archive_completed') {
    const bucket = entry.action === 'archive_completed' ? 'completed' : 'sessions';
    result.source = join(root, 'repos', entry.repo_id, bucket, entry.task_segment);
    result.archive = join(tx.directory, historyRelative(entry.repo_id, bucket, entry.task_segment));
    if (entry.action === 'migrate_to_paused') {
      result.successor = join(root, 'repos', entry.repo_id, 'sessions', entry.task_segment);
      result.stage = join(tx.staging, 'repos', entry.repo_id, 'sessions', entry.task_segment);
      result.pointerStage = join(tx.staging, 'pointers', `${entry.repo_id}.json`);
    } else {
      result.pointerHistory = join(tx.directory, pointerHistoryRelative(entry.repo_id));
    }
  }
  result.pointerBackup = join(tx.backups, 'files', digestHex(entry.pointer.digest), 'pointer.json');
  if (entry.source) result.treeBackup = join(tx.backups, 'trees', digestHex(entry.source.tree_digest), 'source');
  result.journal = join(tx.journals, `${entry.repo_id}.jsonl`);
  result.rollbackPointerStage = join(tx.rollback, 'pointers', `${entry.repo_id}.json`);
  return result;
}

function assertManifestWorkspaceBinding(manifest, workspace) {
  const current = workspaceBinding(workspace);
  if (canonicalJson(current) !== canonicalJson(manifest.workspace_binding)) {
    throw new Error('Selected workspace identity changed after migration inventory.');
  }
  return current;
}

function assertManifestStorageBinding(root, manifest) {
  const current = storageBinding(root, manifest.entries);
  if (canonicalJson(current) !== canonicalJson(manifest.storage_binding)) {
    throw new Error('Phantom data or state hierarchy identity changed after migration inventory.');
  }
}

function assertEntryRuntimeBinding(root, binding, entry) {
  const recorded = entry.workspace_binding;
  const current = entryWorkspaceBinding(recorded.canonical_path, binding);
  if (canonicalJson(current) !== canonicalJson(recorded)
    || current.data_root !== root || current.repo_id !== entry.repo_id) {
    throw new Error(`Entry workspace identity changed after inventory: ${entry.entry_id}`);
  }
  const paths = boundSessionPaths(current, entry.task_id || 'pointer-only');
  const runtimePointer = resolve(paths.currentFile);
  const plannedPointer = resolve(root, pointerRelative(entry.repo_id));
  if (runtimePointer !== plannedPointer) {
    throw new Error(`Entry pointer differs from the runtime pointer path: ${entry.entry_id}`);
  }
  if (!entry.source) return null;
  if (!isObject(entry.metadata) || entry.metadata.workspace !== current.canonical_path) {
    throw new Error(`Entry workspace differs from its canonical workspace: ${entry.entry_id}`);
  }
  if (canonicalJson(current) !== canonicalJson(recorded)) {
    throw new Error(`Entry workspace identity differs from the migration binding: ${entry.entry_id}`);
  }
  if (resolve(paths.root) !== root || paths.repo.id !== entry.repo_id
    || resolve(paths.currentFile) !== plannedPointer) {
    throw new Error(`Entry does not resolve to the selected runtime repository: ${entry.entry_id}`);
  }
  const plannedSource = resolve(root, entry.source_relative);
  const runtimeSource = entry.action === 'archive_completed'
    ? resolve(paths.completedDir) : resolve(paths.sessionDir);
  if (plannedSource !== runtimeSource) {
    throw new Error(`Entry source differs from the runtime session path: ${entry.entry_id}`);
  }
  if (entry.action === 'migrate_to_paused'
    && resolve(root, entry.successor_relative) !== resolve(paths.sessionDir)) {
    throw new Error(`Entry successor differs from the runtime session path: ${entry.entry_id}`);
  }
  return paths;
}

function assertManifestRuntimeBindings(root, binding, manifest) {
  for (const entry of manifest.entries.filter((candidate) => MUTATING_ACTIONS.has(candidate.action))) {
    assertEntryRuntimeBinding(root, binding, entry);
  }
}

function lockRecord(migrationId, state = 'active', source = null) {
  return `${JSON.stringify({
    pid: source?.pid ?? process.pid,
    token: source?.token ?? randomUUID(),
    migration_id: migrationId,
    created_at: source?.created_at ?? new Date().toISOString(),
    state,
    claim_epoch: source?.claim_epoch ?? null,
    claim_digest: source?.claim_digest ?? null,
  })}\n`;
}

function parsedLockOwner(record, migrationId) {
  let owner;
  try { owner = JSON.parse(record.bytes.toString('utf8')); } catch { return null; }
  const fields = isObject(owner) ? Object.keys(owner).sort(compareText) : [];
  if (canonicalJson(fields) !== canonicalJson([
    'claim_digest', 'claim_epoch', 'created_at', 'migration_id', 'pid', 'state', 'token',
  ])
    || owner.migration_id !== migrationId
    || !Number.isInteger(owner.pid) || owner.pid <= 0
    || typeof owner.token !== 'string' || !owner.token
    || typeof owner.created_at !== 'string' || !Number.isFinite(Date.parse(owner.created_at))
    || !['active', 'recovery_required'].includes(owner.state)
    || ((owner.claim_epoch === null) !== (owner.claim_digest === null))
    || (owner.claim_epoch !== null
      && (!Number.isInteger(owner.claim_epoch)
        || owner.claim_epoch < 0
        || owner.claim_epoch >= MAX_RECOVERY_CLAIM_EPOCHS
        || !/^sha256:[a-f0-9]{64}$/.test(owner.claim_digest || '')))) {
    return null;
  }
  return owner;
}

function processDefinitelyDead(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

function recoveryClaimFile(file) {
  return basename(file) === GLOBAL_MIGRATION_LOCK
    ? join(dirname(file), GLOBAL_RECOVERY_LOCK)
    : `${file}.recovery`;
}

function recoveryClaimRecord(migrationId, epoch, previousDigest, target) {
  return `${JSON.stringify({
    pid: process.pid,
    token: randomUUID(),
    replacement_token: randomUUID(),
    migration_id: migrationId,
    created_at: new Date().toISOString(),
    epoch,
    previous_claim_digest: previousDigest,
    target: target === null ? null : {
      digest: target.record.digest,
      device: target.record.device,
      inode: target.record.inode,
      owner_token: target.owner.token,
      owner_state: target.owner.state,
    },
  })}\n`;
}

function parsedRecoveryClaim(record, migrationId, epoch, previousDigest) {
  let owner;
  try { owner = JSON.parse(record.bytes.toString('utf8')); } catch { return null; }
  const fields = isObject(owner) ? Object.keys(owner).sort(compareText) : [];
  if (canonicalJson(fields) !== canonicalJson([
    'created_at', 'epoch', 'migration_id', 'pid', 'previous_claim_digest',
    'replacement_token', 'target', 'token',
  ])
    || owner.migration_id !== migrationId
    || !Number.isInteger(owner.pid) || owner.pid <= 0
    || typeof owner.token !== 'string' || !owner.token
    || typeof owner.replacement_token !== 'string' || !owner.replacement_token
    || typeof owner.created_at !== 'string' || !Number.isFinite(Date.parse(owner.created_at))
    || owner.epoch !== epoch
    || owner.previous_claim_digest !== previousDigest
    || (owner.target !== null
      && (!isObject(owner.target)
        || canonicalJson(Object.keys(owner.target).sort(compareText)) !== canonicalJson([
          'device', 'digest', 'inode', 'owner_state', 'owner_token',
        ])
        || !/^sha256:[a-f0-9]{64}$/.test(owner.target.digest || '')
        || !/^\d+$/.test(owner.target.device || '')
        || !/^\d+$/.test(owner.target.inode || '')
        || typeof owner.target.owner_token !== 'string' || !owner.target.owner_token
        || !['active', 'recovery_required'].includes(owner.target.owner_state)))) {
    return null;
  }
  return owner;
}

function publicationPrefix(file) {
  return `.migration-publish-${digestHex(sha256(Buffer.from(resolve(file)))).slice(0, 24)}-`;
}

function publicationCheckpoint(point) {
  crashAt(point);
  if (process.env[TEST_PUBLICATION_FAILURE_ENV] !== point
    || publicationFailurePointsUsed.has(point)) return;
  publicationFailurePointsUsed.add(point);
  throw new Error(`Injected migration publication failure at ${point}.`);
}

function cleanupDeadPreparedPublications(root, file) {
  const locksDirectory = join(root, 'locks');
  if (!existsSync(locksDirectory)) return;
  const prefix = publicationPrefix(file);
  const names = enumerateDirectoryNames(
    locksDirectory,
    MAX_LOCK_DIRECTORY_ENTRIES,
    'migration publication directory',
  ).filter((name) => name.startsWith(prefix));
  for (const name of names) {
    const suffix = name.slice(prefix.length);
    const match = /^([1-9]\d*)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(suffix);
    if (!match) throw new Error(`Prepared migration publication name is malformed: ${name}`);
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || !processDefinitelyDead(pid)) continue;
    const candidate = join(locksDirectory, name);
    if (!Number.isInteger(constants.O_NOFOLLOW)) {
      throw new Error('This runtime cannot enforce no-follow publication cleanup.');
    }
    let descriptor;
    try {
      descriptor = openSync(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
      const held = fstatSync(descriptor, { bigint: true });
      const pathState = lstatSync(candidate, { bigint: true });
      if (!held.isFile() || held.nlink !== 1n || (statMode(held) & 0o077) !== 0
        || !sameFileGeneration(held, pathState)) {
        throw new Error(`Prepared migration publication changed before cleanup: ${candidate}`);
      }
      const bytes = boundedDescriptorRead(descriptor, 4096);
      const afterRead = fstatSync(descriptor, { bigint: true });
      let owner;
      try { owner = JSON.parse(bytes.toString('utf8')); } catch {
        throw new Error(`Prepared migration publication is malformed: ${candidate}`);
      }
      if (!sameFileGeneration(held, afterRead)
        || owner?.pid !== pid
        || typeof owner?.token !== 'string' || !owner.token
        || !/^sha256:[a-f0-9]{64}$/.test(owner?.migration_id || '')) {
        throw new Error(`Prepared migration publication owner differs: ${candidate}`);
      }
      unlinkSync(candidate);
      fsyncDirectory(locksDirectory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}

function preparedPublication(root, file, raw, kind) {
  const locksDirectory = join(root, 'locks');
  durableMkdir(root, locksDirectory);
  cleanupDeadPreparedPublications(root, file);
  const temporary = join(
    locksDirectory,
    `${publicationPrefix(file)}${process.pid}-${randomUUID()}`,
  );
  const descriptor = openSync(temporary, 'wx+', 0o600);
  try {
    writeFileSync(descriptor, raw, 'utf8');
    fsyncSync(descriptor);
    fsyncDirectory(locksDirectory);
    publicationCheckpoint(`after_${kind}_prepare`);
    return { file, temporary, raw, descriptor };
  } catch (error) {
    closeSync(descriptor);
    try { unlinkSync(temporary); } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') error.cleanupError = cleanupError;
    }
    throw error;
  }
}

function closePreparedPublication(prepared) {
  if (prepared.descriptor === undefined) return;
  closeSync(prepared.descriptor);
  prepared.descriptor = undefined;
}

function discardPreparedPublication(root, prepared) {
  closePreparedPublication(prepared);
  try {
    const metadata = lstatSync(prepared.temporary, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Prepared migration publication changed type: ${prepared.temporary}`);
    }
    unlinkSync(prepared.temporary);
    fsyncDirectory(dirname(prepared.temporary));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function publishedRecordFromDescriptor(prepared) {
  const metadata = fstatSync(prepared.descriptor, { bigint: true });
  if (!metadata.isFile() || metadata.nlink < 1n || metadata.nlink > 2n) {
    throw new Error(`Published migration record has unsafe link count: ${prepared.file}`);
  }
  return {
    file: prepared.file,
    raw: prepared.raw,
    descriptor: prepared.descriptor,
    ...physicalIdentity(metadata),
  };
}

function publishPreparedNoReplace(root, prepared, kind) {
  let linked = false;
  try {
    if (kind === 'claim') pauseTestClaimPublication(root);
    linkSync(prepared.temporary, prepared.file);
    linked = true;
    fsyncDirectory(dirname(prepared.file));
    publicationCheckpoint(`after_${kind}_publish`);
    unlinkSync(prepared.temporary);
    fsyncDirectory(dirname(prepared.temporary));
    const published = publishedRecordFromDescriptor(prepared);
    if (fstatSync(prepared.descriptor, { bigint: true }).nlink !== 1n) {
      throw new Error(`Published migration record retained an extra link: ${prepared.file}`);
    }
    return published;
  } catch (error) {
    if (!linked && ['EEXIST', 'ENOENT'].includes(error.code)) {
      discardPreparedPublication(root, prepared);
      return null;
    }
    if (linked) {
      try {
        if (existsSync(prepared.temporary)) {
          unlinkSync(prepared.temporary);
          fsyncDirectory(dirname(prepared.temporary));
        }
        error.publishedRecord = publishedRecordFromDescriptor(prepared);
        prepared.descriptor = undefined;
      } catch (cleanupError) {
        error.cleanupError = cleanupError;
      }
    } else {
      try { discardPreparedPublication(root, prepared); } catch (cleanupError) {
        error.cleanupError = cleanupError;
      }
    }
    throw error;
  }
}

function readPublishedRecord(file, root, maximum = 4096) {
  const record = readRegularBytesWithLinks(file, root, maximum, new Set([1n, 2n]));
  if (record.nlink === 1) return record;
  let publishedOwner;
  try { publishedOwner = JSON.parse(record.bytes.toString('utf8')); } catch {
    throw new Error(`Hard-linked migration publication is malformed: ${file}`);
  }
  if (!Number.isInteger(publishedOwner?.pid) || publishedOwner.pid <= 0) {
    throw new Error(`Hard-linked migration publication lacks an exact owner: ${file}`);
  }
  if (publishedOwner.pid !== process.pid && !processDefinitelyDead(publishedOwner.pid)) {
    const error = new Error(`Migration publication is still owned by a live process: ${file}`);
    error.code = 'MIGRATION_PUBLICATION_IN_PROGRESS';
    throw error;
  }
  const locksDirectory = join(root, 'locks');
  const prefix = publicationPrefix(file);
  const candidates = enumerateDirectoryNames(
    locksDirectory,
    MAX_LOCK_DIRECTORY_ENTRIES,
    'migration publication directory',
  ).filter((name) => name.startsWith(prefix));
  const matches = [];
  for (const name of candidates) {
    const candidate = join(locksDirectory, name);
    let metadata;
    try { metadata = lstatSync(candidate, { bigint: true }); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const identity = physicalIdentity(metadata);
    if (!metadata.isSymbolicLink() && metadata.isFile()
      && identity.device === record.device && identity.inode === record.inode) {
      matches.push(candidate);
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Published migration record has ambiguous prepared links: ${file}`);
  }
  const prepared = readRegularBytesWithLinks(matches[0], root, maximum, new Set([2n]));
  if (prepared.device !== record.device || prepared.inode !== record.inode
    || !prepared.bytes.equals(record.bytes)) {
    throw new Error(`Prepared migration publication differs from its target: ${file}`);
  }
  unlinkSync(matches[0]);
  fsyncDirectory(dirname(matches[0]));
  return readRegularBytes(file, root, maximum);
}

function recoveryClaimEpochFile(directory, epoch) {
  return join(directory, `epoch-${String(epoch).padStart(2, '0')}.json`);
}

function recoveryClaimEpochLimit() {
  const seam = process.env[TEST_MAX_CLAIM_EPOCHS_ENV];
  if (seam === undefined) return MAX_RECOVERY_CLAIM_EPOCHS;
  if (!/^\d+$/.test(seam)) throw new Error(`${TEST_MAX_CLAIM_EPOCHS_ENV} must be an integer.`);
  const value = Number(seam);
  if (!Number.isInteger(value) || value < 1 || value > MAX_RECOVERY_CLAIM_EPOCHS) {
    throw new Error(`${TEST_MAX_CLAIM_EPOCHS_ENV} must be between 1 and ${MAX_RECOVERY_CLAIM_EPOCHS}.`);
  }
  return value;
}

function ensureRecoveryClaimDirectory(root, file) {
  const directory = recoveryClaimFile(file);
  let created = false;
  try {
    mkdirSync(directory, { mode: 0o700 });
    created = true;
    fsyncDirectory(dirname(directory));
    crashAt('after_recovery_claim_directory');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const metadata = lstatSync(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || (statMode(metadata) & 0o077) !== 0) {
    throw new Error(`Migration recovery barrier is not a private real directory: ${directory}`);
  }
  return { directory, created, metadata };
}

function readRecoveryClaimChain(root, file, migrationId) {
  const directory = recoveryClaimFile(file);
  let metadata;
  try { metadata = lstatSync(directory); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || (statMode(metadata) & 0o077) !== 0) {
    throw new Error(`Migration recovery barrier is not a private real directory: ${directory}`);
  }
  const names = enumerateDirectoryNames(
    directory,
    recoveryClaimEpochLimit() + 1,
    'migration recovery claim directory',
  );
  if (names.length > recoveryClaimEpochLimit()) {
    throw humanDecisionRequiredError(migrationId, 'Migration recovery claim epochs are exhausted.');
  }
  const chain = [];
  let previousDigest = null;
  for (let epoch = 0; epoch < names.length; epoch += 1) {
    const expectedName = basename(recoveryClaimEpochFile(directory, epoch));
    if (names[epoch] !== expectedName) {
      throw new Error(`Migration recovery claim topology is not contiguous: ${directory}`);
    }
    const claimFile = join(directory, names[epoch]);
    const record = readPublishedRecord(claimFile, root, 4096);
    if ((record.mode & 0o077) !== 0 || record.nlink !== 1) {
      throw new Error(`Migration recovery claim is not private and single-link: ${claimFile}`);
    }
    const owner = parsedRecoveryClaim(record, migrationId, epoch, previousDigest);
    if (!owner) throw new Error(`Migration recovery claim is malformed: ${claimFile}`);
    chain.push({ file: claimFile, raw: record.bytes.toString('utf8'), record, owner });
    previousDigest = record.digest;
  }
  return chain;
}

function humanDecisionRequiredError(migrationId, message) {
  const error = new Error(message);
  error.result = {
    schema_version: 1,
    status: 'human_decision_required',
    migration_id: migrationId,
    errors: [message],
  };
  return error;
}

function exactRecordMatches(left, right) {
  return left.digest === right.digest
    && left.device === right.device
    && left.inode === right.inode
    && left.bytes.equals(right.bytes);
}

function claimTargetsRecord(claim, record, owner) {
  return claim.owner.target !== null
    && claim.owner.target.digest === record.digest
    && claim.owner.target.device === record.device
    && claim.owner.target.inode === record.inode
    && claim.owner.target.owner_token === owner.token
    && claim.owner.target.owner_state === owner.state;
}

function lockBindsClaim(owner, claim) {
  return owner.claim_epoch === claim.owner.epoch
    && owner.claim_digest === claim.record.digest
    && owner.token === claim.owner.replacement_token;
}

function claimMayBeSuperseded(claim, currentOwner = null) {
  if (claim.owner.pid === process.pid || processDefinitelyDead(claim.owner.pid)) return true;
  return currentOwner?.state === 'recovery_required' && lockBindsClaim(currentOwner, claim);
}

function publishRecoveryClaim(root, file, migrationId, chain, target) {
  if (chain.length >= recoveryClaimEpochLimit()) {
    throw humanDecisionRequiredError(migrationId, 'Migration recovery claim epochs are exhausted.');
  }
  const epoch = chain.length;
  const previousDigest = chain.at(-1)?.record.digest ?? null;
  const raw = recoveryClaimRecord(migrationId, epoch, previousDigest, target);
  const claimFile = recoveryClaimEpochFile(recoveryClaimFile(file), epoch);
  const prepared = preparedPublication(root, claimFile, raw, 'claim');
  const published = publishPreparedNoReplace(root, prepared, 'claim');
  if (!published) return null;
  closeExactLock(published);
  return { file: claimFile, raw, record: readPublishedRecord(claimFile, root, 4096) };
}

function pauseTestRecoveryClaim(root) {
  const token = process.env.PHANTOM_TEST_MIGRATION_RECOVERY_BARRIER;
  if (migrationRecoveryBarrierUsed
    || typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) return;
  migrationRecoveryBarrierUsed = true;
  const ready = join(root, 'locks', `.migration-recovery-${token}.ready`);
  const resume = join(root, 'locks', `.migration-recovery-${token}.resume`);
  writeFileSync(ready, 'ready\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 10_000;
  while (!existsSync(resume)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the migration-recovery test barrier.');
    Atomics.wait(treeSnapshotWaiter, 0, 0, 10);
  }
}

function pauseTestRecoverySnapshot(root) {
  const token = process.env[TEST_RECOVERY_SNAPSHOT_BARRIER_ENV];
  if (recoverySnapshotBarrierUsed
    || typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) return;
  recoverySnapshotBarrierUsed = true;
  const ready = join(root, 'locks', `.migration-recovery-snapshot-${token}.ready`);
  const resume = join(root, 'locks', `.migration-recovery-snapshot-${token}.resume`);
  writeFileSync(ready, 'ready\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 10_000;
  while (!existsSync(resume)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the recovery-snapshot test barrier.');
    Atomics.wait(treeSnapshotWaiter, 0, 0, 10);
  }
}

function pauseTestRecoveryPhase(root, point, environmentVariable) {
  const token = process.env[environmentVariable];
  const key = `${point}:${token}`;
  if (recoveryPhaseBarriersUsed.has(key)
    || typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) return;
  recoveryPhaseBarriersUsed.add(key);
  const ready = join(root, 'locks', `.migration-recovery-${point}-${token}.ready`);
  const resume = join(root, 'locks', `.migration-recovery-${point}-${token}.resume`);
  writeFileSync(ready, 'ready\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 10_000;
  while (!existsSync(resume)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for the recovery-${point} test barrier.`);
    Atomics.wait(treeSnapshotWaiter, 0, 0, 10);
  }
}

function pauseTestClaimPublication(root) {
  const token = process.env[TEST_CLAIM_PUBLISH_BARRIER_ENV];
  if (claimPublicationBarrierUsed
    || typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) return;
  claimPublicationBarrierUsed = true;
  const ready = join(root, 'locks', `.migration-claim-publish-${token}.ready`);
  const resume = join(root, 'locks', `.migration-claim-publish-${token}.resume`);
  writeFileSync(ready, 'ready\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 10_000;
  while (!existsSync(resume)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the claim-publication test barrier.');
    Atomics.wait(treeSnapshotWaiter, 0, 0, 10);
  }
}

function pauseTestMigrationRelease(root) {
  const token = process.env[TEST_RELEASE_BARRIER_ENV];
  if (migrationReleaseBarrierUsed
    || typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) return;
  migrationReleaseBarrierUsed = true;
  const ready = join(root, 'locks', `.migration-release-${token}.ready`);
  const resume = join(root, 'locks', `.migration-release-${token}.resume`);
  writeFileSync(ready, 'ready\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 10_000;
  while (!existsSync(resume)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the migration-release test barrier.');
    Atomics.wait(treeSnapshotWaiter, 0, 0, 10);
  }
}

function closeExactLock(lock) {
  if (lock.descriptor === undefined) return;
  closeSync(lock.descriptor);
  lock.descriptor = undefined;
}

function installPreparedReplacement(root, prepared, expected, kind, finalCheck = () => {}) {
  let replaced = false;
  try {
    const current = readPublishedRecord(expected.file, root, 4096);
    if (!exactRecordMatches(current, expected)) {
      throw new Error(`Migration record changed before ${kind}: ${expected.file}`);
    }
    finalCheck();
    renameSync(prepared.temporary, expected.file);
    replaced = true;
    publicationCheckpoint(`after_${kind}_replace`);
    fsyncDirectory(dirname(expected.file));
    const published = publishedRecordFromDescriptor(prepared);
    closeExactLock(expected);
    prepared.descriptor = undefined;
    return published;
  } catch (error) {
    if (replaced) {
      try {
        error.publishedRecord = publishedRecordFromDescriptor(prepared);
        prepared.descriptor = undefined;
        closeExactLock(expected);
      } catch (identityError) {
        error.cleanupError = identityError;
      }
    } else {
      try { discardPreparedPublication(root, prepared); } catch (cleanupError) {
        error.cleanupError = cleanupError;
      }
    }
    throw error;
  }
}

function markRecoveryRequired(root, lock) {
  if (lock.released) return;
  const current = readPublishedRecord(lock.file, root, 4096);
  if (current.bytes.toString('utf8') !== lock.raw
    || current.device !== lock.device || current.inode !== lock.inode) {
    throw new Error(`Migration lock ownership changed before recovery fencing: ${lock.file}`);
  }
  const owner = parsedLockOwner(current, JSON.parse(lock.raw).migration_id);
  if (!owner) throw new Error(`Migration lock contract changed before recovery fencing: ${lock.file}`);
  if (owner.state === 'recovery_required') {
    closeExactLock(lock);
    return;
  }
  const raw = lockRecord(owner.migration_id, 'recovery_required', owner);
  const prepared = preparedPublication(root, lock.file, raw, 'recovery_fence');
  try {
    const replacement = installPreparedReplacement(root, prepared, {
      ...current,
      file: lock.file,
      raw: lock.raw,
      descriptor: lock.descriptor,
    }, 'recovery_fence');
    Object.assign(lock, replacement);
    lock.raw = raw;
    closeExactLock(lock);
  } catch (error) {
    if (error.publishedRecord) {
      Object.assign(lock, error.publishedRecord);
      lock.raw = raw;
      closeExactLock(lock);
    }
    throw error;
  }
}

function releaseExactLock(root, lock) {
  if (lock.released) return;
  let descriptor = lock.descriptor;
  let openedForRelease = false;
  if (descriptor === undefined) {
    if (!Number.isInteger(constants.O_NOFOLLOW)) {
      throw new Error('This runtime cannot enforce no-follow migration lock release.');
    }
    descriptor = openSync(lock.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    openedForRelease = true;
  }
  try {
    const before = fstatSync(descriptor, { bigint: true });
    const identity = physicalIdentity(before);
    if (!before.isFile() || before.nlink !== 1n
      || identity.device !== lock.device || identity.inode !== lock.inode) {
      throw new Error(`Migration lock descriptor ownership changed: ${lock.file}`);
    }
    const bytes = boundedDescriptorRead(descriptor, 4096);
    const after = fstatSync(descriptor, { bigint: true });
    if (!sameFileGeneration(before, after) || bytes.toString('utf8') !== lock.raw) {
      throw new Error(`Migration lock descriptor content changed: ${lock.file}`);
    }
    const current = readPublishedRecord(lock.file, root, 4096);
    if (current.bytes.toString('utf8') !== lock.raw
      || current.device !== lock.device || current.inode !== lock.inode) {
      throw new Error(`Migration lock ownership changed: ${lock.file}`);
    }
    unlinkSync(lock.file);
    fsyncDirectory(dirname(lock.file));
    lock.released = true;
  } finally {
    if (openedForRelease) closeSync(descriptor);
    else closeExactLock(lock);
  }
}

const RESTART_RECOVERY = Symbol('restart-recovery');
const RESTART_PREFLIGHT = Symbol('restart-preflight');

function currentLockGeneration(file, root, migrationId) {
  let record;
  try { record = readPublishedRecord(file, root, 4096); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const owner = parsedLockOwner(record, migrationId);
  if (!owner) throw new Error(`Migration lock contract is malformed or belongs to another migration: ${file}`);
  return { record, owner };
}

function verifyWinningClaim(root, file, migrationId, expectedClaim) {
  const chain = readRecoveryClaimChain(root, file, migrationId);
  const winner = chain.at(-1);
  if (!winner
    || winner.file !== expectedClaim.file
    || winner.raw !== expectedClaim.raw
    || winner.record.device !== expectedClaim.record.device
    || winner.record.inode !== expectedClaim.record.inode) {
    throw new Error(`Migration recovery claim winner changed before lock adoption: ${file}`);
  }
  return winner;
}

function sameBarrierNodeGeneration(left, right) {
  return left !== null && right !== null
    && left.isDirectory() && right.isDirectory()
    && left.dev === right.dev && left.ino === right.ino;
}

function recoveryBarrierSnapshot(root, file, migrationId) {
  return {
    current: currentLockGeneration(file, root, migrationId),
    claimNode: lstatIfPresent(recoveryClaimFile(file)),
  };
}

function observedRecoveryBarrierRemains(observed, current) {
  const mainRemains = observed.current !== null && current.current !== null
    && exactRecordMatches(observed.current.record, current.current.record);
  const claimRemains = sameBarrierNodeGeneration(observed.claimNode, current.claimNode);
  return mainRemains || claimRemains;
}

function removeCreatedRecoveryBarrier(root, created) {
  const current = lstatIfPresent(created.directory);
  if (!sameBarrierNodeGeneration(created.metadata, current)) return current === null;
  if (enumerateDirectoryNames(
    created.directory,
    1,
    'migration recovery claim directory',
  ).length !== 0) return false;
  try { rmdirSync(created.directory); } catch (error) {
    if (error.code === 'ENOENT') return true;
    if (error.code === 'ENOTEMPTY') return false;
    throw error;
  }
  fsyncDirectory(dirname(created.directory));
  return true;
}

function mustRestartPreflightAfterBarrierLoss(root, observed, snapshot, createdBarrier) {
  if (!observed.requireRecoveryBarrier
    || observedRecoveryBarrierRemains(observed, snapshot)
    || snapshot.current !== null) return false;
  if (createdBarrier.created) removeCreatedRecoveryBarrier(root, createdBarrier);
  pauseTestRecoveryPhase(
    root,
    'before-restart',
    TEST_RECOVERY_BEFORE_RESTART_BARRIER_ENV,
  );
  return true;
}

function recoverMigrationLockGeneration(root, file, migrationId, observed) {
  let snapshot = recoveryBarrierSnapshot(root, file, migrationId);
  if (observed.requireRecoveryBarrier
    && !observedRecoveryBarrierRemains(observed, snapshot)
    && snapshot.current === null && snapshot.claimNode === null) {
    return RESTART_PREFLIGHT;
  }
  pauseTestRecoveryPhase(root, 'before-ensure', TEST_RECOVERY_BEFORE_ENSURE_BARRIER_ENV);
  const createdBarrier = ensureRecoveryClaimDirectory(root, file);
  pauseTestRecoveryPhase(root, 'after-ensure', TEST_RECOVERY_AFTER_ENSURE_BARRIER_ENV);
  snapshot = recoveryBarrierSnapshot(root, file, migrationId);
  if (mustRestartPreflightAfterBarrierLoss(root, observed, snapshot, createdBarrier)) {
    return RESTART_PREFLIGHT;
  }
  const { current } = snapshot;
  const { current: expected } = observed;
  if ((expected === null) !== (current === null)
    || (expected !== null && !exactRecordMatches(expected.record, current.record))) {
    return RESTART_RECOVERY;
  }
  let chain = readRecoveryClaimChain(root, file, migrationId);
  const tail = chain.at(-1) || null;
  if (current !== null) {
    const compatible = tail === null
      || claimTargetsRecord(tail, current.record, current.owner)
      || lockBindsClaim(current.owner, tail);
    if (!compatible) {
      throw humanDecisionRequiredError(
        migrationId,
        `Migration recovery claim chain does not bind the current lock generation: ${file}`,
      );
    }
    const ownerRecoverable = current.owner.state === 'recovery_required'
      || processDefinitelyDead(current.owner.pid)
      || (current.owner.pid === process.pid && tail !== null && lockBindsClaim(current.owner, tail));
    if (!ownerRecoverable) return null;
  }
  if (tail && !claimMayBeSuperseded(tail, current?.owner || null)) return null;

  snapshot = recoveryBarrierSnapshot(root, file, migrationId);
  if (mustRestartPreflightAfterBarrierLoss(root, observed, snapshot, createdBarrier)) {
    return RESTART_PREFLIGHT;
  }
  const target = current === null ? null : current;
  const published = publishRecoveryClaim(root, file, migrationId, chain, target);
  if (!published) return RESTART_RECOVERY;
  chain = readRecoveryClaimChain(root, file, migrationId);
  const winner = chain.at(-1);
  if (!winner || winner.file !== published.file
    || winner.raw !== published.raw
    || winner.record.device !== published.record.device
    || winner.record.inode !== published.record.inode) {
    return RESTART_RECOVERY;
  }

  const beforeAdoption = currentLockGeneration(file, root, migrationId);
  if ((current === null) !== (beforeAdoption === null)
    || (current !== null && !exactRecordMatches(current.record, beforeAdoption.record))) {
    return RESTART_RECOVERY;
  }
  pauseTestRecoveryClaim(root);
  const raw = lockRecord(migrationId, 'active', {
    token: winner.owner.replacement_token,
    claim_epoch: winner.owner.epoch,
    claim_digest: winner.record.digest,
  });
  const prepared = preparedPublication(root, file, raw, 'lock_adoption');
  try {
    let adopted;
    if (current === null) {
      verifyWinningClaim(root, file, migrationId, winner);
      if (existsSync(file)) {
        discardPreparedPublication(root, prepared);
        return RESTART_RECOVERY;
      }
      adopted = publishPreparedNoReplace(root, prepared, 'lock_adoption');
      if (!adopted) return RESTART_RECOVERY;
    } else {
      adopted = installPreparedReplacement(
        root,
        prepared,
        {
          ...current.record,
          file,
          raw: current.record.bytes.toString('utf8'),
          descriptor: undefined,
        },
        'lock_adoption',
        () => verifyWinningClaim(root, file, migrationId, winner),
      );
    }
    return { ...adopted, raw, recovered: true, claimDirectory: recoveryClaimFile(file) };
  } catch (error) {
    if (error.publishedRecord) {
      const adopted = { ...error.publishedRecord, raw, recovered: true };
      try { markRecoveryRequired(root, adopted); } catch (fenceError) {
        throw new AggregateError([error, fenceError], 'Lock adoption failed after publication and recovery fencing failed.');
      }
    }
    throw error;
  }
}

function acquireExactLock(root, file, migrationId, options = {}) {
  durableMkdir(root, dirname(file));
  for (let attempt = 0; attempt < recoveryClaimEpochLimit() + 4; attempt += 1) {
    const current = currentLockGeneration(file, root, migrationId);
    const claimNode = lstatIfPresent(recoveryClaimFile(file));
    if (options.requireRecoveryBarrier === true && current === null && claimNode === null) {
      throw preflightRestartError(
        `Observed migration recovery barrier disappeared before lock acquisition: ${file}`,
      );
    }
    pauseTestRecoverySnapshot(root);
    if (current !== null && current.owner.state === 'active'
      && !processDefinitelyDead(current.owner.pid)) {
      const chain = claimNode ? readRecoveryClaimChain(root, file, migrationId) : [];
      const tail = chain.at(-1) || null;
      if (!(current.owner.pid === process.pid && tail && lockBindsClaim(current.owner, tail))) {
        throw new Error(`Migration lock is already held; refusing uncertain recovery: ${file}`);
      }
    }
    if (current === null && claimNode === null) {
      const raw = lockRecord(migrationId);
      const prepared = preparedPublication(root, file, raw, 'lock');
      try {
        if (lstatIfPresent(recoveryClaimFile(file))) {
          discardPreparedPublication(root, prepared);
          continue;
        }
        const published = publishPreparedNoReplace(root, prepared, 'lock');
        if (!published) continue;
        return { ...published, raw, recovered: false, claimDirectory: null };
      } catch (error) {
        if (error.publishedRecord) {
          const acquired = { ...error.publishedRecord, raw, recovered: false };
          try { markRecoveryRequired(root, acquired); } catch (fenceError) {
            throw new AggregateError([error, fenceError], 'Lock publication failed and recovery fencing failed.');
          }
        }
        throw error;
      }
    }
    const recovered = recoverMigrationLockGeneration(root, file, migrationId, {
      current,
      claimNode,
      requireRecoveryBarrier: options.requireRecoveryBarrier === true,
    });
    if (recovered === RESTART_PREFLIGHT) {
      throw preflightRestartError(
        `Observed migration recovery barrier disappeared during lock acquisition: ${file}`,
      );
    }
    if (recovered === RESTART_RECOVERY) continue;
    if (recovered) return recovered;
    throw new Error(`Migration lock is already held; refusing uncertain recovery: ${file}`);
  }
  throw humanDecisionRequiredError(migrationId, `Migration lock recovery did not converge: ${file}`);
}

function pauseTestMigrationLocks(root) {
  const token = process.env[TEST_LOCK_BARRIER_ENV];
  if (migrationLockBarrierUsed
    || typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) return;
  migrationLockBarrierUsed = true;
  const ready = join(root, 'locks', `.migration-lock-${token}.ready`);
  const resume = join(root, 'locks', `.migration-lock-${token}.resume`);
  writeFileSync(ready, 'ready\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 10_000;
  while (!existsSync(resume)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the migration-lock test barrier.');
    Atomics.wait(treeSnapshotWaiter, 0, 0, 10);
  }
}

function validateMigrationJournalEvent(file, event, { index, previousDigest }) {
  const fields = isObject(event) ? Object.keys(event).sort(compareText) : [];
  if (!isObject(event)
    || canonicalJson(fields) !== canonicalJson([
      'entry_id', 'event_digest', 'event_type', 'migration_id', 'payload',
      'previous_event_digest', 'recorded_at', 'repo_id', 'schema_version', 'sequence',
    ])
    || event.schema_version !== JOURNAL_SCHEMA_VERSION
    || event.sequence !== index + 1
    || event.previous_event_digest !== previousDigest) {
    throw new Error(`Migration journal continuity failed: ${file}`);
  }
  if (typeof event.migration_id !== 'string' || !safeRepoId(event.repo_id)
    || typeof event.entry_id !== 'string' || !event.entry_id
    || typeof event.event_type !== 'string' || !event.event_type
    || typeof event.recorded_at !== 'string' || !Number.isFinite(Date.parse(event.recorded_at))
    || !isObject(event.payload)) {
    throw new Error(`Migration journal event contract failed: ${file}`);
  }
  const { event_digest: supplied, ...input } = event;
  const expected = sha256(Buffer.from(canonicalJson(input)));
  if (supplied !== expected) throw new Error(`Migration journal digest failed: ${file}`);
  return true;
}

function migrationJournalIdentity(event) {
  return {
    migration_id: event.migration_id,
    repo_id: event.repo_id,
    entry_id: event.entry_id,
    event_type: event.event_type,
  };
}

function journalEvents(file, root) {
  if (!existsSync(file)) return [];
  const snapshot = readAtomicJournalSnapshot({
    trustedRoot: root,
    journalPath: file,
    canonicalize: canonicalJson,
    validateEvent: (event, context) => validateMigrationJournalEvent(file, event, context),
    eventDigest: (event) => event.event_digest,
    eventIdentity: migrationJournalIdentity,
    checkpoint: (point) => crashAt(`atomic_journal_${point}`),
  });
  return snapshot.events;
}

function exactPayloadFields(payload, fields, label) {
  const observed = isObject(payload) ? Object.keys(payload).sort(compareText) : [];
  if (canonicalJson(observed) !== canonicalJson([...fields].sort(compareText))) {
    throw new Error(`${label} payload is malformed.`);
  }
}

function assertJournalPayload(event, entry) {
  const label = `${event.event_type}:${entry.entry_id}`;
  if (event.event_type === 'entry_started') {
    exactPayloadFields(event.payload, ['cutover_at'], label);
    if (!Number.isFinite(Date.parse(event.payload.cutover_at))) throw new Error(`${label} cutover time is invalid.`);
    return;
  }
  if (event.event_type === 'backup_verified') {
    exactPayloadFields(event.payload, ['cutover_at', 'pointer_digest', 'source_tree_digest'], label);
    if (!Number.isFinite(Date.parse(event.payload.cutover_at))
      || event.payload.pointer_digest !== entry.pointer.digest
      || event.payload.source_tree_digest !== (entry.source?.tree_digest || null)) {
      throw new Error(`${label} backup receipt differs from the manifest.`);
    }
    return;
  }
  if (event.event_type === 'source_archived') {
    exactPayloadFields(event.payload, ['tree_digest'], label);
    if (!entry.source || event.payload.tree_digest !== entry.source.tree_digest) {
      throw new Error(`${label} archive receipt differs from the manifest.`);
    }
    return;
  }
  if (['successor_prepared', 'successor_activated'].includes(event.event_type)) {
    successorEventPayload(event, entry.entry_id, event.event_type);
    return;
  }
  if (event.event_type === 'pointer_prepared'
    || event.event_type === 'rollback_pointer_prepared'
    || (event.event_type === 'pointer_committed' && entry.action === 'migrate_to_paused')) {
    pointerEventIdentity(event, entry.entry_id, event.event_type);
    return;
  }
  if (event.event_type === 'pointer_committed') {
    exactPayloadFields(event.payload, [], label);
    return;
  }
  if (event.event_type === 'rollback_completed') {
    assertRollbackReceipt(event.payload, entry);
    return;
  }
  throw new Error(`Migration journal event type is unsupported: ${label}`);
}

function entryJournalEvents(file, root, manifest, entry) {
  const events = journalEvents(file, root);
  for (const event of events) {
    if (event.migration_id !== manifest.migration_id
      || event.repo_id !== entry.repo_id
      || event.entry_id !== entry.entry_id) {
      throw new Error(`Migration journal identity differs: ${entry.entry_id}`);
    }
    assertJournalPayload(event, entry);
  }
  const types = events.map((event) => event.event_type);
  const allowed = [...expectedEventTypes(entry), 'rollback_pointer_prepared', 'rollback_completed'];
  if (canonicalJson(types) !== canonicalJson(allowed.slice(0, types.length))) {
    throw new Error(`Migration journal topology differs: ${entry.entry_id}`);
  }
  const begin = events.find((event) => event.event_type === 'entry_started');
  const backup = events.find((event) => event.event_type === 'backup_verified');
  if (begin && backup && backup.payload.cutover_at !== begin.payload.cutover_at) {
    throw new Error(`Migration journal cutover receipts differ: ${entry.entry_id}`);
  }
  const prepared = events.find((event) => event.event_type === 'successor_prepared');
  const activated = events.find((event) => event.event_type === 'successor_activated');
  if (prepared && activated
    && canonicalJson(prepared.payload) !== canonicalJson(activated.payload)) {
    throw new Error(`Migration successor receipts differ: ${entry.entry_id}`);
  }
  const pointerPrepared = events.find((event) => event.event_type === 'pointer_prepared');
  const pointerCommitted = events.find((event) => event.event_type === 'pointer_committed');
  if (entry.action === 'migrate_to_paused' && pointerPrepared && pointerCommitted
    && canonicalJson(pointerPrepared.payload) !== canonicalJson(pointerCommitted.payload)) {
    throw new Error(`Migration pointer receipts differ: ${entry.entry_id}`);
  }
  return events;
}

function atomicJournalReplacementLease(root, manifest, entry, locks) {
  assertRollbackPublicationLease(root, manifest, locks);
  const globalFile = join(root, 'locks', GLOBAL_MIGRATION_LOCK);
  const repositoryFile = join(root, 'locks', `${entry.repo_id}.lock`);
  const globalLock = locks.find((lock) => resolve(lock.file) === resolve(globalFile));
  const repositoryLock = locks.find((lock) => resolve(lock.file) === resolve(repositoryFile));
  if (!globalLock || !repositoryLock) {
    throw new Error(`Migration journal replacement lacks exact locks: ${entry.entry_id}`);
  }
  return {
    migrationId: manifest.migration_id,
    repositoryId: entry.repo_id,
    globalLock,
    repositoryLock,
  };
}

function appendJournal(file, root, manifest, entry, locks, eventType, payload = {}) {
  const events = entryJournalEvents(file, root, manifest, entry);
  const existing = events.find((event) => event.event_type === eventType);
  if (existing) {
    if (canonicalJson(existing.payload) !== canonicalJson(payload)) {
      throw new Error(`Migration journal retry payload differs: ${entry.entry_id}/${eventType}`);
    }
  }
  const previousEventDigest = existing
    ? existing.previous_event_digest
    : (events.at(-1)?.event_digest || null);
  const event = existing || (() => {
    const input = {
      schema_version: JOURNAL_SCHEMA_VERSION,
      sequence: events.length + 1,
      migration_id: manifest.migration_id,
      repo_id: entry.repo_id,
      entry_id: entry.entry_id,
      event_type: eventType,
      recorded_at: new Date().toISOString(),
      previous_event_digest: previousEventDigest,
      payload,
    };
    return { ...input, event_digest: sha256(Buffer.from(canonicalJson(input))) };
  })();
  const line = `${canonicalJson(event)}\n`;
  durableMkdir(root, dirname(file));
  const result = appendAtomicJournalEvent({
    trustedRoot: root,
    journalPath: file,
    canonicalLine: line,
    expectedPredecessor: previousEventDigest,
    ...(events.length ? {
      replacementLease: atomicJournalReplacementLease(root, manifest, entry, locks),
    } : {}),
    canonicalize: canonicalJson,
    validateEvent: (candidate, context) => validateMigrationJournalEvent(file, candidate, context),
    eventDigest: (candidate) => candidate.event_digest,
    eventIdentity: migrationJournalIdentity,
    checkpoint: (point) => crashAt(`atomic_journal_${point}`),
  });
  return result.event;
}

function eventFor(paths, root, manifest, entry, type) {
  return entryJournalEvents(paths.journal, root, manifest, entry)
    .find((event) => event.event_type === type) || null;
}

function pointerEventIdentity(event, entryId, eventType) {
  const payload = event?.payload;
  const fields = isObject(payload) ? Object.keys(payload).sort(compareText) : [];
  if (canonicalJson(fields) !== canonicalJson(['pointer_device', 'pointer_inode'])
    || !/^\d+$/.test(payload.pointer_device)
    || !/^\d+$/.test(payload.pointer_inode)) {
    throw new Error(`${eventType} pointer identity is missing or malformed: ${entryId}`);
  }
  return {
    device: payload.pointer_device,
    inode: payload.pointer_inode,
  };
}

function pointerIdentityPayload(record) {
  return {
    pointer_device: record.device,
    pointer_inode: record.inode,
  };
}

function assertPointerEventIdentity(file, root, event, entryId, eventType) {
  const expected = pointerEventIdentity(event, entryId, eventType);
  const current = readRegularBytes(file, root);
  if (current.device !== expected.device || current.inode !== expected.inode) {
    throw new Error(`${eventType} pointer physical identity changed: ${entryId}`);
  }
  return current;
}

function successorEventPayload(event, entryId, eventType) {
  const payload = event?.payload;
  const fields = isObject(payload) ? Object.keys(payload).sort(compareText) : [];
  if (canonicalJson(fields) !== canonicalJson(['pointer_digest', 'successor_tree_digest'])
    || !/^sha256:[a-f0-9]{64}$/.test(payload.pointer_digest || '')
    || !/^sha256:[a-f0-9]{64}$/.test(payload.successor_tree_digest || '')) {
    throw new Error(`${eventType} successor identity is missing or malformed: ${entryId}`);
  }
  return payload;
}

function assertSuccessorEventIdentity(directory, root, event, entryId, eventType) {
  const expected = successorEventPayload(event, entryId, eventType);
  const current = treeSnapshot(directory, root);
  if (current.tree_digest !== expected.successor_tree_digest) {
    throw new Error(`${eventType} successor physical identity changed: ${entryId}`);
  }
  return current;
}

function expectedEventTypes(entry) {
  return [
    'entry_started',
    'backup_verified',
    ...(entry.source ? ['source_archived'] : []),
    ...(entry.action === 'migrate_to_paused'
      ? ['successor_prepared', 'successor_activated', 'pointer_prepared'] : []),
    'pointer_committed',
  ];
}

function sameFilePlan(file, root, plan) {
  if (!existsSync(file)) return false;
  try {
    return canonicalJson(filePlan(readRegularBytes(file, root, Math.max(MAX_FILE_BYTES, plan.size))))
      === canonicalJson(plan);
  } catch {
    return false;
  }
}

function sameTreePlan(directory, root, plan) {
  if (!existsSync(directory)) return false;
  try { return canonicalJson(treeSnapshot(directory, root)) === canonicalJson(plan); } catch { return false; }
}

function copyTreeBackup(source, destination, root, plan) {
  if (!existsSync(destination)) durableMkdir(root, destination);
  for (const record of plan.records.filter((candidate) => candidate.kind === 'directory')) {
    const target = record.path ? join(destination, ...record.path.split('/')) : destination;
    if (existsSync(target)) {
      assertSafeChain(root, target);
      const metadata = lstatSync(target);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`Partial backup directory is unsafe: ${target}`);
      }
      chmodSync(target, 0o700);
    }
  }
  for (const record of plan.records) {
    const target = record.path ? join(destination, ...record.path.split('/')) : destination;
    if (record.kind === 'directory') {
      durableMkdir(root, target);
      continue;
    }
    const origin = join(source, ...record.path.split('/'));
    const current = readRegularBytes(origin, root);
    if (current.digest !== record.digest || current.size !== record.size || current.nlink !== 1) {
      throw new Error(`Source drift while backing up ${origin}`);
    }
    publishMigrationBytes(root, target, current.bytes, 0o400, 'tree-backup');
    const existing = readRegularBytes(target, root);
    if (existing.digest !== record.digest || existing.size !== record.size || existing.nlink !== 1) {
      throw new Error(`Partial backup conflicts with source: ${target}`);
    }
  }
  const directories = plan.records.filter((record) => record.kind === 'directory')
    .sort((left, right) => right.path.length - left.path.length);
  for (const record of directories) {
    const target = record.path ? join(destination, ...record.path.split('/')) : destination;
    assertSafeChain(root, target);
    chmodSync(target, 0o500);
  }
  verifyTreeBackup(destination, root, plan);
}

function verifyTreeContent(directory, root, plan, { sealed = false, physical = false } = {}) {
  const expectedShape = plan.records.map(({ kind, path }) => ({ kind, path }));
  const observed = treeSnapshot(directory, root);
  const observedShape = observed.records.map(({ kind, path }) => ({ kind, path }));
  if (canonicalJson(observedShape) !== canonicalJson(expectedShape)) {
    throw new Error(`Tree shape differs: ${directory}`);
  }
  for (const record of plan.records) {
    const target = record.path ? join(directory, ...record.path.split('/')) : directory;
    const metadata = lstatSync(target, { bigint: true });
    const identity = physicalIdentity(metadata);
    if (physical
      && (identity.device !== record.device || identity.inode !== record.inode)) {
      throw new Error(`Tree physical identity differs: ${target}`);
    }
    if (record.kind === 'directory') {
      if (sealed && (statMode(metadata) & 0o277) !== 0) {
        throw new Error(`Historical directory is not sealed: ${target}`);
      }
      continue;
    }
    const current = readRegularBytes(target, root);
    if (current.digest !== record.digest || current.size !== record.size || current.nlink !== 1) {
      throw new Error(`Tree content differs: ${target}`);
    }
    if (sealed && (current.mode & 0o377) !== 0) {
      throw new Error(`Historical file is not sealed: ${target}`);
    }
  }
  return true;
}

function sealTree(root, directory, plan) {
  for (const record of plan.records.filter((candidate) => candidate.kind === 'file')) {
    const target = join(directory, ...record.path.split('/'));
    assertSafeChain(root, target);
    chmodSync(target, 0o400);
  }
  for (const record of plan.records.filter((candidate) => candidate.kind === 'directory')
    .sort((left, right) => right.path.length - left.path.length)) {
    const target = record.path ? join(directory, ...record.path.split('/')) : directory;
    assertSafeChain(root, target);
    chmodSync(target, 0o500);
  }
}

function restoreTreeModes(root, directory, plan) {
  for (const record of plan.records.filter((candidate) => candidate.kind === 'directory')) {
    const target = record.path ? join(directory, ...record.path.split('/')) : directory;
    assertSafeChain(root, target);
    chmodSync(target, 0o700);
  }
  for (const record of plan.records.filter((candidate) => candidate.kind === 'file')) {
    const target = join(directory, ...record.path.split('/'));
    assertSafeChain(root, target);
    chmodSync(target, record.mode);
  }
  for (const record of plan.records.filter((candidate) => candidate.kind === 'directory')
    .sort((left, right) => right.path.length - left.path.length)) {
    const target = record.path ? join(directory, ...record.path.split('/')) : directory;
    assertSafeChain(root, target);
    chmodSync(target, record.mode);
  }
}

function verifyTreeBackup(destination, root, plan) {
  return verifyTreeContent(destination, root, plan, { sealed: true });
}

function sameArchivePlan(entry, paths, root) {
  if (!existsSync(paths.archive)) return false;
  try {
    if (entry.action === 'archive_completed') {
      return verifyTreeContent(paths.archive, root, entry.source, { sealed: true, physical: true });
    }
    return sameTreePlan(paths.archive, root, entry.source);
  } catch {
    return false;
  }
}

function sameArchiveContent(entry, paths, root) {
  if (!existsSync(paths.archive)) return false;
  try {
    return verifyTreeContent(paths.archive, root, entry.source, { physical: true });
  } catch {
    return false;
  }
}

function pointerBackupMatches(backup, plan) {
  return backup.digest === plan.digest
    && backup.size === plan.size
    && backup.nlink === 1
    && (backup.mode & 0o377) === 0;
}

function copyPointerBackup(source, destination, root, plan) {
  const current = readRegularBytes(source, root);
  if (canonicalJson(filePlan(current)) !== canonicalJson(plan)) throw new Error(`Pointer drift before backup: ${source}`);
  publishMigrationBytes(root, destination, current.bytes, 0o400, 'pointer-backup');
  const existing = readRegularBytes(destination, root);
  if (!pointerBackupMatches(existing, plan)) {
    throw new Error(`Pointer backup integrity failed: ${destination}`);
  }
  assertSafeChain(root, destination);
  chmodSync(destination, 0o400);
}

function crashAt(point) {
  if (process.env[TEST_KILL_ENV] === point) process.kill(process.pid, 'SIGKILL');
  if (process.env[TEST_CRASH_ENV] === point) {
    throw new Error(`Injected migration crash at ${point}`);
  }
}

function v2Artifacts(entry, cutoverAt) {
  const metadata = entry.metadata;
  const producer = { role: 'apex', compute_profile: 'frontier' };
  const common = {
    schema_version: 2,
    repo_id: entry.repo_id,
    task_id: entry.task_id,
    created_at: cutoverAt,
    updated_at: cutoverAt,
    producer,
    bundle_version: BUNDLE_VERSION,
  };
  const session = {
    ...common,
    artifact_type: 'session',
    status: 'paused',
    workspace: metadata.workspace,
    route: metadata.route,
    intent_summary: metadata.intent_summary,
    work_kind: metadata.work_kind,
    lifecycle: newLifecycle(metadata.mode),
    authority_trust: null,
    authority_decisions: [],
    pause_reason: 'Migrated from Phantom state envelope v1; explicit resume is required.',
  };
  const intent = {
    ...common,
    artifact_type: 'intent',
    status: 'active',
    summary: metadata.intent_summary,
    route: metadata.route,
    work_kind: metadata.work_kind,
  };
  return { session, intent };
}

function expectedV2Pointer(entry, successor, cutoverAt) {
  return {
    schema_version: 2,
    repo_id: entry.repo_id,
    task_id: entry.task_id,
    session_dir: successor,
    updated_at: cutoverAt,
  };
}

function validateV2(entry, paths, root, cutoverAt) {
  const artifacts = v2Artifacts(entry, cutoverAt);
  const pointer = expectedV2Pointer(entry, paths.successor, cutoverAt);
  const contractPaths = boundSessionPaths(entry.workspace_binding, entry.task_id);
  if (contractPaths.root !== root) {
    throw new Error(`Migrated successor data root differs: ${entry.entry_id}`);
  }
  if (resolve(contractPaths.sessionDir) !== resolve(paths.successor)) {
    throw new Error(`Migrated successor differs from the runtime session path: ${entry.entry_id}`);
  }
  throwStateErrors(pointerErrors(pointer, contractPaths));
  throwStateErrors(sessionErrors(artifacts.session, contractPaths, pointer));
  throwStateErrors(intentErrors(artifacts.intent, contractPaths, artifacts.session));
  return { ...artifacts, pointer };
}

function buildStage(entry, paths, root, cutoverAt) {
  const artifacts = validateV2(entry, paths, root, cutoverAt);
  if (!existsSync(paths.stage)) durableMkdir(root, join(paths.stage, 'control-inputs', '.claims'));
  else {
    durableMkdir(root, join(paths.stage, 'control-inputs'));
    durableMkdir(root, join(paths.stage, 'control-inputs', '.claims'));
  }
  for (const [name, value] of [['session.json', artifacts.session], ['intent.json', artifacts.intent]]) {
    const file = join(paths.stage, name);
    publishMigrationJson(
      root,
      file,
      value,
      name === 'session.json' ? 'successor-session' : 'successor-intent',
    );
    if (readRegularBytes(file, root).bytes.toString('utf8') !== prettyJson(value)) {
      throw new Error(`Migration stage contains conflicting ${name}: ${paths.stage}`);
    }
  }
  return { artifacts, snapshot: cleanV2Tree(paths.stage, root) };
}

function cleanV2Tree(directory, root) {
  const expectedFiles = ['control-inputs', 'intent.json', 'session.json'];
  const names = readDirectoryNames(directory, root);
  if (canonicalJson(names) !== canonicalJson(expectedFiles)) {
    throw new Error(`Migrated successor is not a clean v2 tree: ${directory}`);
  }
  const controlNames = readDirectoryNames(join(directory, 'control-inputs'), root);
  if (canonicalJson(controlNames) !== canonicalJson(['.claims'])) {
    throw new Error(`Migrated successor has unexpected control inputs: ${directory}`);
  }
  const claimNames = readDirectoryNames(join(directory, 'control-inputs', '.claims'), root);
  if (claimNames.length) throw new Error(`Migrated successor has pre-existing claims: ${directory}`);
  return treeSnapshot(directory, root);
}

function preparedSuccessorLocation(paths, root, entry, prepared, activated = null) {
  const stagePresent = existsSync(paths.stage);
  const successorPresent = existsSync(paths.successor);
  if (stagePresent === successorPresent) {
    throw new Error(`Prepared successor must exist at exactly one recovery location: ${entry.entry_id}`);
  }
  const location = stagePresent ? paths.stage : paths.successor;
  const snapshot = assertSuccessorEventIdentity(
    location,
    root,
    prepared,
    entry.entry_id,
    'Prepared',
  );
  if (activated) {
    const preparedPayload = successorEventPayload(prepared, entry.entry_id, 'Prepared');
    const activatedPayload = successorEventPayload(activated, entry.entry_id, 'Activated');
    if (canonicalJson(activatedPayload) !== canonicalJson(preparedPayload)) {
      throw new Error(`Activated successor identity differs from its prepared receipt: ${entry.entry_id}`);
    }
    if (location !== paths.successor) {
      throw new Error(`Activated successor remained in staging: ${entry.entry_id}`);
    }
  }
  return { location, snapshot };
}

function preparedPointerLocation(entry, paths, root, cutoverAt, prepared, committed = null) {
  const expectedBytes = prettyJson(expectedV2Pointer(entry, paths.successor, cutoverAt));
  if (existsSync(paths.pointerStage)) {
    if (committed) throw new Error(`Committed pointer unexpectedly remains staged: ${entry.entry_id}`);
    const record = assertPointerEventIdentity(
      paths.pointerStage,
      root,
      prepared,
      entry.entry_id,
      'Prepared',
    );
    if (record.bytes.toString('utf8') !== expectedBytes) {
      throw new Error(`Prepared pointer bytes changed: ${entry.entry_id}`);
    }
    if (!sameFilePlan(paths.pointer, root, entry.pointer)) {
      throw new Error(`Legacy pointer changed before prepared cutover: ${entry.entry_id}`);
    }
    return { location: paths.pointerStage, record };
  }
  const record = assertPointerEventIdentity(
    paths.pointer,
    root,
    prepared,
    entry.entry_id,
    'Prepared',
  );
  if (record.bytes.toString('utf8') !== expectedBytes) {
    throw new Error(`Prepared pointer bytes changed after cutover: ${entry.entry_id}`);
  }
  if (committed) {
    const committedRecord = assertPointerEventIdentity(
      paths.pointer,
      root,
      committed,
      entry.entry_id,
      'Committed',
    );
    const preparedIdentity = pointerEventIdentity(prepared, entry.entry_id, 'Prepared');
    const committedIdentity = pointerEventIdentity(committed, entry.entry_id, 'Committed');
    if (canonicalJson(committedIdentity) !== canonicalJson(preparedIdentity)
      || committedRecord.device !== record.device || committedRecord.inode !== record.inode) {
      throw new Error(`Committed pointer identity differs from its prepared receipt: ${entry.entry_id}`);
    }
  }
  return { location: paths.pointer, record };
}

function cutoverTime(entry, paths, root, manifest, locks) {
  const existing = eventFor(paths, root, manifest, entry, 'entry_started');
  if (existing) return existing.payload.cutover_at;
  const timestamp = new Date().toISOString();
  appendJournal(paths.journal, root, manifest, entry, locks, 'entry_started', {
    cutover_at: timestamp,
  });
  return timestamp;
}

function assertInitialManifest(workspace, manifest) {
  const fresh = inventoryMigration({
    workspace,
    confirmInactive: manifest.confirmations.inactive,
    workKinds: manifest.confirmations.work_kind,
  });
  if (canonicalJson(fresh) !== canonicalJson(manifest)) {
    throw new Error('Migration source drifted after inventory; regenerate the manifest.');
  }
}

function preparedTransactionReceiptForOwner(manifest, owner) {
  return {
    schema_version: 1,
    artifact_type: 'phantom-session-state-migration-transaction-prepared',
    migration_id: manifest.migration_id,
    manifest_digest: sha256(Buffer.from(prettyJson(manifest))),
    global_lock: {
      token: owner.token,
      claim_epoch: owner.claim_epoch,
      claim_digest: owner.claim_digest,
    },
  };
}

function preparedTransactionReceipt(manifest, globalLock) {
  const owner = parsedLockOwner(
    { bytes: Buffer.from(globalLock.raw) },
    manifest.migration_id,
  );
  if (!owner) throw new Error('Global migration lock cannot bind a transaction receipt.');
  return preparedTransactionReceiptForOwner(manifest, owner);
}

function readPreparedTransactionReceipt(root, manifest, tx, { publicationSafe = false } = {}) {
  const record = publicationSafe
    ? readPublicationTarget(root, tx.prepared, 4096)
    : (existsSync(tx.prepared) ? readRegularBytes(tx.prepared, root, 4096) : null);
  if (!record) return null;
  let receipt;
  try { receipt = JSON.parse(record.bytes.toString('utf8')); } catch {
    throw new Error('Migration transaction prepared receipt is malformed.');
  }
  const fields = isObject(receipt) ? Object.keys(receipt).sort(compareText) : [];
  const lockFields = isObject(receipt?.global_lock)
    ? Object.keys(receipt.global_lock).sort(compareText) : [];
  if (canonicalJson(fields) !== canonicalJson([
    'artifact_type', 'global_lock', 'manifest_digest', 'migration_id', 'schema_version',
  ])
    || canonicalJson(lockFields) !== canonicalJson(['claim_digest', 'claim_epoch', 'token'])
    || receipt.schema_version !== 1
    || receipt.artifact_type !== 'phantom-session-state-migration-transaction-prepared'
    || receipt.migration_id !== manifest.migration_id
    || receipt.manifest_digest !== sha256(Buffer.from(prettyJson(manifest)))
    || !record.bytes.equals(Buffer.from(prettyJson(receipt)))
    || typeof receipt.global_lock.token !== 'string' || !receipt.global_lock.token
    || ((receipt.global_lock.claim_epoch === null) !== (receipt.global_lock.claim_digest === null))
    || (receipt.global_lock.claim_epoch !== null
      && (!Number.isInteger(receipt.global_lock.claim_epoch)
        || receipt.global_lock.claim_epoch < 0
        || receipt.global_lock.claim_epoch >= MAX_RECOVERY_CLAIM_EPOCHS
        || !/^sha256:[a-f0-9]{64}$/.test(receipt.global_lock.claim_digest || '')))) {
    throw new Error('Migration transaction prepared receipt contract differs.');
  }
  return { receipt, record };
}

function transactionDirectoryHasOnly(root, tx, fixedNames, publications) {
  if (!existsSync(tx.directory)) return fixedNames.length === 0;
  const names = readDirectoryNames(tx.directory, root);
  return names.every((name) => fixedNames.includes(name)
    || publications.some((publication) => matchesPublicationName(name, publication)));
}

function retainedMigrationLock(root, manifest) {
  const file = join(root, 'locks', GLOBAL_MIGRATION_LOCK);
  let record;
  try { record = readPublishedRecord(file, root, 4096); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const owner = parsedLockOwner(record, manifest.migration_id);
  if (!owner) {
    throw new Error('Migration lock is already held by malformed or unrelated retained state.');
  }
  return { file, record, owner };
}

function retainedLockBindsPreparedReceipt(retained, prepared) {
  return retained !== null
    && retained.owner.token === prepared.receipt.global_lock.token
    && retained.owner.claim_epoch === prepared.receipt.global_lock.claim_epoch
    && retained.owner.claim_digest === prepared.receipt.global_lock.claim_digest;
}

function receiptClaimLineage(chain, binding, endEpoch) {
  if (!Number.isInteger(endEpoch) || endEpoch < 0 || endEpoch >= chain.length) return null;
  let nextEpoch = 0;
  let anchored = false;
  const generationTokens = new Set([binding.token]);
  const proposedTokens = new Set();
  if (binding.claim_epoch !== null) {
    const anchor = chain[binding.claim_epoch];
    if (!anchor
      || anchor.record.digest !== binding.claim_digest
      || anchor.owner.replacement_token !== binding.token) {
      return null;
    }
    nextEpoch = binding.claim_epoch + 1;
    anchored = true;
  }
  for (let epoch = nextEpoch; epoch <= endEpoch; epoch += 1) {
    const claim = chain[epoch];
    if (!claim) return null;
    if (claim.owner.target === null) {
      // A missing lock can be reclaimed only after an earlier claim has
      // already anchored this chain to the prepared generation.
      if (!anchored) return null;
    } else {
      const targetToken = claim.owner.target.owner_token;
      if (!generationTokens.has(targetToken) && !proposedTokens.has(targetToken)) return null;
      generationTokens.add(targetToken);
      anchored = true;
    }
    proposedTokens.add(claim.owner.replacement_token);
  }
  const finalClaim = chain[endEpoch];
  return {
    anchored,
    claim: finalClaim,
    token: endEpoch < nextEpoch ? binding.token : finalClaim.owner.replacement_token,
  };
}

function preparedReceiptBindsLockOwner(root, manifest, prepared, owner) {
  const binding = prepared.receipt.global_lock;
  if (owner.token === binding.token
    && owner.claim_epoch === binding.claim_epoch
    && owner.claim_digest === binding.claim_digest) {
    return true;
  }
  if (owner.claim_epoch === null || owner.claim_digest === null) return false;
  const chain = readRecoveryClaimChain(
    root,
    join(root, 'locks', GLOBAL_MIGRATION_LOCK),
    manifest.migration_id,
  );
  const lineage = receiptClaimLineage(chain, binding, owner.claim_epoch);
  return lineage !== null
    && lineage.anchored
    && lineage.token === owner.token
    && lineage.claim.record.digest === owner.claim_digest;
}

function preparedReceiptBindsClaimBarrier(root, manifest, prepared) {
  const chain = readRecoveryClaimChain(
    root,
    join(root, 'locks', GLOBAL_MIGRATION_LOCK),
    manifest.migration_id,
  );
  if (!chain.length) return false;
  const lineage = receiptClaimLineage(
    chain,
    prepared.receipt.global_lock,
    chain.length - 1,
  );
  return lineage !== null && lineage.anchored;
}

function assertAcquiredGlobalLockAuthorization(root, manifest, globalLock, authorization) {
  assertExactOwnedLock(root, globalLock);
  const prepared = authorization?.prepared_receipt || null;
  if (prepared) {
    if (!globalLock.recovered) {
      throw new Error('Migration did not recover the prepared transaction lock lineage.');
    }
    const owner = parsedLockOwner({ bytes: Buffer.from(globalLock.raw) }, manifest.migration_id);
    if (!owner || !preparedReceiptBindsLockOwner(root, manifest, prepared, owner)) {
      throw new Error('Recovered global migration lock differs from the prepared transaction lineage.');
    }
    return;
  }
  const retained = authorization?.retained_lock || null;
  if (!retained) {
    if (globalLock.recovered) {
      throw new Error('Fresh migration acquired an unclassified retained global lock.');
    }
    return;
  }
  if (!globalLock.recovered) {
    throw new Error('Migration did not recover the authorized retained global lock.');
  }
  const owner = parsedLockOwner({ bytes: Buffer.from(globalLock.raw) }, manifest.migration_id);
  if (!owner || owner.claim_epoch === null || owner.claim_digest === null) {
    throw new Error('Recovered global migration lock lacks an exact claim binding.');
  }
  const chain = readRecoveryClaimChain(root, globalLock.file, manifest.migration_id);
  const claim = chain[owner.claim_epoch];
  if (!claim || claim.record.digest !== owner.claim_digest
    || !claimTargetsRecord(claim, retained.record, retained.owner)) {
    throw new Error('Recovered global migration lock differs from the authorized retained generation.');
  }
}

function preparedReceiptGenerationMatches(left, right) {
  return left.digest === right.digest
    && left.device === right.device
    && left.inode === right.inode
    && left.bytes.equals(right.bytes);
}

function preflightResume(root, manifest, tx, { manifestRecord = null } = {}) {
  const stored = (manifestRecord || readRegularBytes(tx.manifest, root, MAX_MANIFEST_BYTES))
    .bytes.toString('utf8');
  if (stored !== prettyJson(manifest)) throw new Error('Stored migration manifest does not match the requested manifest.');
  if (existsSync(tx.rollbackState)) {
    throw new Error('Migration transaction has entered rollback and cannot be reapplied.');
  }
  for (const entry of manifest.entries.filter((candidate) => MUTATING_ACTIONS.has(candidate.action))) {
    const paths = deriveEntryPaths(root, tx, entry);
    const entryEvents = entryJournalEvents(paths.journal, root, manifest, entry);
    const observedTypes = entryEvents.map((event) => event.event_type);
    const allowedPrefix = expectedEventTypes(entry).slice(0, observedTypes.length);
    if (canonicalJson(observedTypes) !== canonicalJson(allowedPrefix)) {
      throw new Error(`Migration journal is terminal or non-resumable: ${entry.entry_id}`);
    }
    const begin = entryEvents.find((event) => event.event_type === 'entry_started');
    const sourceArchived = entryEvents.find((event) => event.event_type === 'source_archived');
    if (entry.action === 'migrate_to_paused') {
      const successorPrepared = entryEvents.find((event) => event.event_type === 'successor_prepared');
      const activated = entryEvents.find((event) => event.event_type === 'successor_activated');
      const pointerPrepared = entryEvents.find((event) => event.event_type === 'pointer_prepared');
      const committed = entryEvents.find((event) => event.event_type === 'pointer_committed');
      if (successorPrepared) {
        preparedSuccessorLocation(paths, root, entry, successorPrepared, activated);
      } else if (existsSync(paths.successor)) {
        const untouchedLegacySource = !sourceArchived
          && entry.source !== null
          && resolve(paths.successor) === resolve(paths.source)
          && sameTreePlan(paths.successor, root, entry.source);
        if (!untouchedLegacySource) {
          throw new Error(`Successor activation lacks a prepared receipt: ${entry.entry_id}`);
        }
      }
      if (pointerPrepared) {
        if (!begin) throw new Error(`Prepared pointer lacks a cutover time: ${entry.entry_id}`);
        preparedPointerLocation(
          entry,
          paths,
          root,
          begin.payload.cutover_at,
          pointerPrepared,
          committed,
        );
      } else if (!sameFilePlan(paths.pointer, root, entry.pointer)) {
        throw new Error(`Pointer cutover lacks a prepared receipt: ${entry.entry_id}`);
      }
    } else if (entry.pointer && !sameFilePlan(paths.pointer, root, entry.pointer)) {
      const parked = entry.action === 'quarantine_pointer' ? paths.quarantine
        : entry.action === 'archive_completed' ? paths.pointerHistory : null;
      if (!(parked && sameFilePlan(parked, root, entry.pointer))) {
        throw new Error(`Pointer drift during migration recovery: ${entry.entry_id}`);
      }
    }
    if (entry.source) {
      const sourceOkay = sameTreePlan(paths.source, root, entry.source);
      const archiveOkay = sameArchivePlan(entry, paths, root)
        || (entry.action === 'archive_completed' && sameArchiveContent(entry, paths, root));
      const renameWindowOkay = !sourceArchived && !existsSync(paths.source) && archiveOkay;
      if ((sourceArchived && !archiveOkay)
        || (!sourceArchived && !sourceOkay && !renameWindowOkay)) {
        throw new Error(`Session source/archive drift during migration recovery: ${entry.entry_id}`);
      }
    }
  }
}

function preflightApplyReadOnly(root, workspace, manifest) {
  const tx = transactionPaths(root, manifest.migration_id);
  const manifestRecord = existsSync(tx.directory)
    ? readPublicationTarget(root, tx.manifest, MAX_MANIFEST_BYTES) : null;
  const hasTransactionManifest = manifestRecord !== null;
  if (hasTransactionManifest) {
    const stored = manifestRecord.bytes.toString('utf8');
    if (stored !== prettyJson(manifest)) {
      throw new Error('Stored migration manifest does not match the requested manifest.');
    }
    if (existsSync(tx.rollbackState)) {
      throw new Error('Migration transaction has entered rollback and cannot be reapplied.');
    }
  }
  const retained = retainedMigrationLock(root, manifest);
  if (!hasTransactionManifest) {
    if (existsSync(tx.directory)) {
      const manifestPublication = publicationNames(
        root,
        tx.manifest,
        Buffer.from(prettyJson(manifest)),
        0o600,
        'transaction-manifest',
      );
      const names = readDirectoryNames(tx.directory, root);
      if (names.length && (!retained || !transactionDirectoryHasOnly(
        root,
        tx,
        [],
        [manifestPublication],
      ))) {
        throw new Error('Migration transaction staging lacks exact retained-lock authorization.');
      }
    }
    assertInitialManifest(workspace, manifest);
    return {
      kind: 'fresh',
      retained_lock: retained,
      expected_prepared_receipt: retained
        ? preparedTransactionReceiptForOwner(manifest, retained.owner) : null,
      requires_global_recovery_barrier: retained !== null,
    };
  }
  const prepared = readPreparedTransactionReceipt(root, manifest, tx, { publicationSafe: true });
  const globalFile = join(root, 'locks', GLOBAL_MIGRATION_LOCK);
  const claimNode = lstatIfPresent(recoveryClaimFile(globalFile));
  const retainedIsPrepared = prepared && retained
    && (retainedLockBindsPreparedReceipt(retained, prepared)
      || preparedReceiptBindsLockOwner(root, manifest, prepared, retained.owner));
  const claimIsPrepared = prepared && !retained && claimNode
    && preparedReceiptBindsClaimBarrier(root, manifest, prepared);
  if (retainedIsPrepared || claimIsPrepared) {
    preflightResume(root, manifest, tx, { manifestRecord });
    return {
      kind: 'trusted_resume',
      prepared_record: prepared.record,
      prepared_receipt: prepared,
      expected_prepared_receipt: prepared.receipt,
      retained_lock: retained,
      requires_global_recovery_barrier: true,
    };
  }
  if (prepared && !retained && !claimNode) {
    const verification = verifyLocked(root, manifest, tx);
    if (verification.status === 'verified') {
      return { kind: 'already_verified', verification };
    }
    throw new Error(verification.errors.join('; '));
  }
  if (!retained) {
    throw new Error('Migration transaction manifest lacks its retained global lock; regenerate inventory.');
  }
  const expectedReceipt = preparedTransactionReceiptForOwner(manifest, retained.owner);
  const publications = [
    publicationNames(
      root,
      tx.manifest,
      Buffer.from(prettyJson(manifest)),
      0o600,
      'transaction-manifest',
    ),
    publicationNames(
      root,
      tx.prepared,
      Buffer.from(prettyJson(expectedReceipt)),
      0o600,
      'transaction-prepared-receipt',
    ),
  ];
  if (!transactionDirectoryHasOnly(root, tx, ['manifest.json'], publications)) {
    throw new Error('Migration transaction lacks a trusted prepared receipt; preserve it and regenerate inventory.');
  }
  assertInitialManifest(workspace, manifest);
  preflightResume(root, manifest, tx, { manifestRecord });
  return {
    kind: 'fresh_existing_manifest',
    retained_lock: retained,
    expected_prepared_receipt: expectedReceipt,
    requires_global_recovery_barrier: true,
  };
}

function authorizedPreparedTransactionReceipt(manifest, globalLock, authorization) {
  if (authorization?.expected_prepared_receipt) return authorization.expected_prepared_receipt;
  if (authorization?.retained_lock) {
    return preparedTransactionReceiptForOwner(manifest, authorization.retained_lock.owner);
  }
  return preparedTransactionReceipt(manifest, globalLock);
}

function writePreparedTransactionReceipt(root, manifest, tx, globalLock, authorization) {
  assertExactOwnedLock(root, globalLock);
  const receipt = authorizedPreparedTransactionReceipt(manifest, globalLock, authorization);
  publishMigrationJson(
    root,
    tx.prepared,
    receipt,
    'transaction-prepared-receipt',
  );
  return receipt;
}

function prepareTransaction(root, workspace, manifest, tx, globalLock, authorization) {
  let manifestWasPresent = existsSync(tx.manifest);
  if (!existsSync(tx.directory)) {
    assertInitialManifest(workspace, manifest);
    durableMkdir(root, tx.directory);
    crashAt('after_transaction_directory');
    manifestWasPresent = false;
  }
  if (!manifestWasPresent) {
    const manifestBytes = Buffer.from(prettyJson(manifest));
    const publication = publicationNames(
      root,
      tx.manifest,
      manifestBytes,
      0o600,
      'transaction-manifest',
    );
    const names = readDirectoryNames(tx.directory, root);
    if (names.some((name) => !matchesPublicationName(name, publication))) {
      throw new Error(`Unrecognized migration transaction directory: ${tx.directory}`);
    }
    assertInitialManifest(workspace, manifest);
  }

  publishMigrationJson(root, tx.manifest, manifest, 'transaction-manifest');
  const storedManifest = readRegularBytes(tx.manifest, root, MAX_MANIFEST_BYTES);
  if (storedManifest.bytes.toString('utf8') !== prettyJson(manifest)) {
    throw new Error('Stored migration manifest does not match the requested manifest.');
  }
  if (!manifestWasPresent) crashAt('after_transaction_manifest');

  const preparedWasPresent = existsSync(tx.prepared);
  writePreparedTransactionReceipt(root, manifest, tx, globalLock, authorization);
  const prepared = readPreparedTransactionReceipt(root, manifest, tx);
  if (authorization?.prepared_record
    && !preparedReceiptGenerationMatches(prepared.record, authorization.prepared_record)) {
    throw new Error('Migration transaction prepared receipt changed before locked resume.');
  }
  if (!preparedWasPresent) crashAt('after_transaction_prepared');
  preflightResume(root, manifest, tx);
}

function applyLocked(root, workspace, manifest, locks, authorization) {
  const globalLock = locks[0];
  const tx = transactionPaths(root, manifest.migration_id);
  prepareTransaction(root, workspace, manifest, tx, globalLock, authorization);
  const mutations = manifest.entries.filter((entry) => MUTATING_ACTIONS.has(entry.action));

  // Phase 1: every source is backed up before any source or pointer mutation.
  for (const entry of mutations) {
    const paths = deriveEntryPaths(root, tx, entry);
    const cutoverAt = cutoverTime(entry, paths, root, manifest, locks);
    if (entry.source) {
      const origin = existsSync(paths.source) && sameTreePlan(paths.source, root, entry.source)
        ? paths.source : paths.archive;
      copyTreeBackup(origin, paths.treeBackup, root, entry.source);
    }
    const pointerOrigin = existsSync(paths.pointer) && sameFilePlan(paths.pointer, root, entry.pointer)
      ? paths.pointer
      : (entry.action === 'quarantine_pointer' ? paths.quarantine : paths.pointerHistory);
    if (pointerOrigin && existsSync(pointerOrigin)) copyPointerBackup(pointerOrigin, paths.pointerBackup, root, entry.pointer);
    appendJournal(paths.journal, root, manifest, entry, locks, 'backup_verified', {
      cutover_at: cutoverAt,
      pointer_digest: entry.pointer.digest,
      source_tree_digest: entry.source?.tree_digest || null,
    });
  }
  crashAt('after_phase1');

  // Phase 2: archive complete legacy directories. Pointers still reference v1.
  for (const entry of mutations.filter((candidate) => candidate.source)) {
    const paths = deriveEntryPaths(root, tx, entry);
    if (!existsSync(paths.archive)) {
      if (!sameTreePlan(paths.source, root, entry.source)) throw new Error(`Legacy source drift: ${entry.entry_id}`);
      durableRename(root, paths.source, paths.archive);
      if (entry.action === 'archive_completed') {
        crashAt('after_completed_archive_rename');
        sealTree(root, paths.archive, entry.source);
      }
    } else if (entry.action === 'archive_completed' && sameArchiveContent(entry, paths, root)) {
      sealTree(root, paths.archive, entry.source);
    } else if (!sameArchivePlan(entry, paths, root)) {
      throw new Error(`Legacy archive conflict: ${entry.entry_id}`);
    }
    appendJournal(paths.journal, root, manifest, entry, locks, 'source_archived', {
      tree_digest: entry.source.tree_digest,
    });
  }
  crashAt('after_archive');

  // Phase 3: stage and activate clean paused v2 successors. Pointers remain v1.
  for (const entry of mutations.filter((candidate) => candidate.action === 'migrate_to_paused')) {
    const paths = deriveEntryPaths(root, tx, entry);
    const cutoverAt = cutoverTime(entry, paths, root, manifest, locks);
    const artifacts = validateV2(entry, paths, root, cutoverAt);
    let successorPrepared = eventFor(paths, root, manifest, entry, 'successor_prepared');
    if (!successorPrepared) {
      if (existsSync(paths.successor)) {
        throw new Error(`Successor activation lacks a prepared receipt: ${entry.entry_id}`);
      }
      const staged = buildStage(entry, paths, root, cutoverAt);
      successorPrepared = appendJournal(
        paths.journal,
        root,
        manifest,
        entry,
        locks,
        'successor_prepared',
        {
          successor_tree_digest: staged.snapshot.tree_digest,
          pointer_digest: sha256(Buffer.from(prettyJson(artifacts.pointer))),
        },
      );
    }
    const activated = eventFor(paths, root, manifest, entry, 'successor_activated');
    const preparedState = preparedSuccessorLocation(
      paths,
      root,
      entry,
      successorPrepared,
      activated,
    );
    const clean = cleanV2Tree(preparedState.location, root);
    if (clean.tree_digest !== preparedState.snapshot.tree_digest) {
      throw new Error(`Prepared successor contract drifted: ${entry.entry_id}`);
    }
    if (preparedState.location === paths.stage) {
      durableRename(root, paths.stage, paths.successor);
      crashAt('after_successor_rename_before_commit');
    }
    const current = assertSuccessorEventIdentity(
      paths.successor,
      root,
      successorPrepared,
      entry.entry_id,
      'Prepared',
    );
    const preparedPayload = successorEventPayload(successorPrepared, entry.entry_id, 'Prepared');
    appendJournal(
      paths.journal,
      root,
      manifest,
      entry,
      locks,
      'successor_activated',
      {
        successor_tree_digest: current.tree_digest,
        pointer_digest: preparedPayload.pointer_digest,
      },
    );
  }
  crashAt('after_successor');
  crashAt('before_pointer');

  // Phase 4: pointer cutover is globally last.
  for (const entry of mutations) {
    const paths = deriveEntryPaths(root, tx, entry);
    let committedPayload = {};
    if (entry.action === 'migrate_to_paused') {
      const cutoverAt = cutoverTime(entry, paths, root, manifest, locks);
      const pointer = expectedV2Pointer(entry, paths.successor, cutoverAt);
      let pointerPrepared = eventFor(paths, root, manifest, entry, 'pointer_prepared');
      if (!pointerPrepared) {
        publishMigrationJson(root, paths.pointerStage, pointer, 'pointer-stage');
        if (readRegularBytes(paths.pointerStage, root).bytes.toString('utf8') !== prettyJson(pointer)) {
          throw new Error(`Migration pointer stage conflicts: ${entry.entry_id}`);
        }
        const preparedPointer = readRegularBytes(paths.pointerStage, root);
        pointerPrepared = appendJournal(
          paths.journal,
          root,
          manifest,
          entry,
          locks,
          'pointer_prepared',
          pointerIdentityPayload(preparedPointer),
        );
      }
      const committed = eventFor(paths, root, manifest, entry, 'pointer_committed');
      const preparedState = preparedPointerLocation(
        entry,
        paths,
        root,
        cutoverAt,
        pointerPrepared,
        committed,
      );
      if (preparedState.location === paths.pointerStage) {
        durableReplace(root, paths.pointerStage, paths.pointer);
        crashAt('after_pointer_rename_before_commit');
      }
      const committedPointer = assertPointerEventIdentity(
        paths.pointer,
        root,
        pointerPrepared,
        entry.entry_id,
        'Prepared',
      );
      if (committedPointer.bytes.toString('utf8') !== prettyJson(pointer)) {
        throw new Error(`Migrated pointer changed during commit: ${entry.entry_id}`);
      }
      committedPayload = pointerIdentityPayload(committedPointer);
    } else {
      const target = entry.action === 'archive_completed' ? paths.pointerHistory : paths.quarantine;
      if (!existsSync(target)) {
        if (!sameFilePlan(paths.pointer, root, entry.pointer)) throw new Error(`Pointer drift before parking: ${entry.entry_id}`);
        durableRename(root, paths.pointer, target);
      } else if (existsSync(paths.pointer)) {
        throw new Error(`Pointer parking collision: ${entry.entry_id}`);
      }
    }
    appendJournal(
      paths.journal,
      root,
      manifest,
      entry,
      locks,
      'pointer_committed',
      committedPayload,
    );
  }
  crashAt('after_pointer');
  const verification = verifyLocked(root, manifest, tx);
  if (verification.status !== 'verified') {
    throw new Error(`Migration verification failed: ${verification.errors.join('; ')}`);
  }
  return verification;
}

function migrationRuntimeContext(manifest, workspaceInput) {
  const workspace = workspacePath(workspaceInput);
  const binding = assertManifestWorkspaceBinding(manifest, workspace);
  const root = binding.data_root;
  if (root !== resolve(manifest.data_root)) {
    throw new Error('Manifest data root does not match the selected workspace.');
  }
  assertManifestStorageBinding(root, manifest);
  assertManifestRuntimeBindings(root, binding, manifest);
  return { workspace, root };
}

function assertLockedRuntimeContext(root, workspace, manifest) {
  const binding = assertManifestWorkspaceBinding(manifest, workspace);
  if (binding.data_root !== root || root !== resolve(manifest.data_root)) {
    throw new Error('Manifest data root changed while migration locks were acquired.');
  }
  assertManifestStorageBinding(root, manifest);
  assertManifestRuntimeBindings(root, binding, manifest);
}

function migrationHasDurableMutation(root, manifest) {
  const tx = transactionPaths(root, manifest.migration_id);
  if (!existsSync(tx.directory)) return false;
  try {
    if (existsSync(tx.rollbackState)) return true;
    for (const entry of manifest.entries.filter((candidate) => MUTATING_ACTIONS.has(candidate.action))) {
      const paths = deriveEntryPaths(root, tx, entry);
      if (!sameFilePlan(paths.pointer, root, entry.pointer)) return true;
      if (entry.action === 'quarantine_pointer' && existsSync(paths.quarantine)) return true;
      if (entry.action === 'archive_completed' && existsSync(paths.pointerHistory)) return true;
      if (entry.source) {
        if (!sameTreePlan(paths.source, root, entry.source) || existsSync(paths.archive)) return true;
      }
    }
    return false;
  } catch {
    // Uncertain state is never proof that a barrier is safe to remove.
    return true;
  }
}

function migrationRequiresRecoveryBarrier(root, manifest) {
  const tx = transactionPaths(root, manifest.migration_id);
  // Any transaction artifact created while the exact lock is held retains that
  // lock as the provenance boundary for deterministic publication recovery.
  return (existsSync(tx.directory) && readDirectoryNames(tx.directory, root).length > 0)
    || migrationHasDurableMutation(root, manifest);
}

function terminalReleaseProof(root, manifest, status) {
  if (status === 'verified') return verifyLocked(root, manifest).status === 'verified';
  if (status === 'rolled_back') return completedRollbackResult(root, manifest)?.status === 'rolled_back';
  return !migrationRequiresRecoveryBarrier(root, manifest);
}

function migrationSpaceRequirement(manifest) {
  const mutations = manifest.entries.filter((entry) => MUTATING_ACTIONS.has(entry.action));
  let required = BigInt(manifest.aggregate_tree_bytes);
  required += mutations.reduce((total, entry) => total + BigInt(entry.pointer?.size || 0), 0n) * 2n;
  required += BigInt(Buffer.byteLength(prettyJson(manifest)));
  required += BigInt(mutations.length * MAX_ATOMIC_JOURNAL_BYTES);
  if (mutations.length) required += BigInt(ATOMIC_JOURNAL_FREE_SPACE_SCRATCH_BYTES);
  required += mutations.reduce((total, entry) => {
    if (entry.action !== 'migrate_to_paused') return total;
    const cutover = '2000-01-01T00:00:00.000Z';
    const artifacts = v2Artifacts(entry, cutover);
    const successor = join(manifest.data_root, ...entry.successor_relative.split('/'));
    return total
      + BigInt(Buffer.byteLength(prettyJson(artifacts.session)))
      + BigInt(Buffer.byteLength(prettyJson(artifacts.intent)))
      + BigInt(Buffer.byteLength(prettyJson(expectedV2Pointer(entry, successor, cutover))));
  }, 0n);
  // Reserve metadata/allocation overhead and a 25% safety margin. This is a
  // preflight guarantee, not an ENOSPC recovery substitute; later failures
  // retain the global barrier.
  const metadataMargin = 16n * 1024n * 1024n;
  return required + metadataMargin + (required / 4n);
}

function availableMigrationBytes(root) {
  const seam = process.env[TEST_AVAILABLE_BYTES_ENV];
  if (seam !== undefined) {
    if (!/^\d+$/.test(seam)) throw new Error(`${TEST_AVAILABLE_BYTES_ENV} must be a non-negative integer.`);
    return BigInt(seam);
  }
  const filesystem = statfsSync(root, { bigint: true });
  return filesystem.bavail * filesystem.bsize;
}

function assertMigrationSpaceReservation(root, manifest) {
  const required = migrationSpaceRequirement(manifest);
  const available = availableMigrationBytes(root);
  if (available < required) {
    throw new Error(
      `Insufficient free space for migration: requires ${required} bytes with safety margin; `
      + `${available} bytes are available.`,
    );
  }
}

function assertExactOwnedLock(root, lock) {
  if (lock.released) throw new Error(`Migration lock was already released: ${lock.file}`);
  const current = readPublishedRecord(lock.file, root, 4096);
  if (current.bytes.toString('utf8') !== lock.raw
    || current.device !== lock.device || current.inode !== lock.inode) {
    throw new Error(`Migration lock ownership changed: ${lock.file}`);
  }
  return current;
}

function expectedMigrationLockFiles(root, manifest) {
  const repositories = [...new Set(manifest.entries
    .filter((entry) => MUTATING_ACTIONS.has(entry.action))
    .map((entry) => entry.repo_id))].sort(compareText);
  return [
    join(root, 'locks', GLOBAL_MIGRATION_LOCK),
    ...repositories.map((repoId) => join(root, 'locks', `${repoId}.lock`)),
  ];
}

function assertRollbackPublicationLease(root, manifest, locks) {
  const expectedFiles = expectedMigrationLockFiles(root, manifest);
  if (!Array.isArray(locks)
    || canonicalJson(locks.map((lock) => resolve(lock?.file || '')))
      !== canonicalJson(expectedFiles.map((file) => resolve(file)))) {
    throw new Error('Rollback publication lease does not hold the complete migration lock set.');
  }
  for (const lock of locks) {
    if (lock.released || lock.descriptor === undefined) {
      throw new Error(`Rollback publication lease lost its open lock descriptor: ${lock.file}`);
    }
    const before = fstatSync(lock.descriptor, { bigint: true });
    const descriptorIdentity = physicalIdentity(before);
    if (!before.isFile() || before.nlink !== 1n
      || descriptorIdentity.device !== lock.device || descriptorIdentity.inode !== lock.inode) {
      throw new Error(`Rollback publication lease descriptor changed: ${lock.file}`);
    }
    const descriptorBytes = boundedDescriptorRead(lock.descriptor, 4096);
    const after = fstatSync(lock.descriptor, { bigint: true });
    if (!sameFileGeneration(before, after) || descriptorBytes.toString('utf8') !== lock.raw) {
      throw new Error(`Rollback publication lease descriptor content changed: ${lock.file}`);
    }
    const current = readRegularBytes(lock.file, root, 4096);
    if (current.bytes.toString('utf8') !== lock.raw
      || current.device !== lock.device || current.inode !== lock.inode) {
      throw new Error(`Rollback publication lease path changed: ${lock.file}`);
    }
    const owner = parsedLockOwner(current, manifest.migration_id);
    if (!owner || owner.pid !== process.pid || owner.state !== 'active') {
      throw new Error(`Rollback publication lease is not actively owned by this process: ${lock.file}`);
    }
  }
  return true;
}

function removeRecoveryClaimEpochs(root, lock, migrationId) {
  const directory = recoveryClaimFile(lock.file);
  if (!existsSync(directory)) return null;
  assertExactOwnedLock(root, lock);
  const chain = readRecoveryClaimChain(root, lock.file, migrationId);
  for (const claim of [...chain].reverse()) {
    assertExactOwnedLock(root, lock);
    releaseExactLock(root, {
      file: claim.file,
      raw: claim.raw,
      descriptor: undefined,
      device: claim.record.device,
      inode: claim.record.inode,
      released: false,
    });
  }
  assertExactOwnedLock(root, lock);
  if (enumerateDirectoryNames(directory, 1, 'migration recovery claim directory').length !== 0) {
    throw new Error(`Migration recovery claim directory changed during cleanup: ${directory}`);
  }
  return directory;
}

function removeRecoveryBarrierDirectory(root, directory) {
  if (!directory) return;
  const metadata = lstatSync(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || (statMode(metadata) & 0o077) !== 0) {
    throw new Error(`Migration recovery barrier changed before removal: ${directory}`);
  }
  if (enumerateDirectoryNames(directory, 1, 'migration recovery claim directory').length !== 0) {
    throw new Error(`Migration recovery barrier is not empty: ${directory}`);
  }
  rmdirSync(directory);
  fsyncDirectory(dirname(directory));
}

function releaseMigrationLocks(root, locks, manifest, status) {
  const [globalLock, ...repoLocks] = locks;
  pauseTestMigrationRelease(root);
  for (const lock of repoLocks.reverse()) {
    const claimDirectory = removeRecoveryClaimEpochs(root, lock, manifest.migration_id);
    releaseExactLock(root, lock);
    removeRecoveryBarrierDirectory(root, claimDirectory);
  }
  if (!terminalReleaseProof(root, manifest, status)) {
    throw new Error('Terminal migration state changed before global lock release.');
  }
  // Even a migration that never recovered gets a final canonical barrier. It
  // remains after the main lock is removed until the last safe rmdir.
  ensureRecoveryClaimDirectory(root, globalLock.file);
  const globalClaimDirectory = removeRecoveryClaimEpochs(
    root,
    globalLock,
    manifest.migration_id,
  );
  if (!terminalReleaseProof(root, manifest, status)) {
    throw new Error('Terminal migration state changed during global barrier cleanup.');
  }
  releaseExactLock(root, globalLock);
  removeRecoveryBarrierDirectory(root, globalClaimDirectory);
}

function retainMigrationLocks(root, locks) {
  let pending = locks.filter((lock) => !lock.released);
  let failures = [];
  // A second independent pass recovers transient teardown failures without
  // allowing one bad repository lock to strand other exact locks as active.
  for (let pass = 0; pass < 2 && pending.length; pass += 1) {
    failures = [];
    for (const lock of pending) {
      try { markRecoveryRequired(root, lock); } catch (error) {
        failures.push({ lock, error });
      }
    }
    pending = failures.map((failure) => failure.lock);
  }
  for (const lock of pending) {
    try { closeExactLock(lock); } catch {}
  }
  return failures.map((failure) => failure.error);
}

function combinedMigrationError(primary, failures, message) {
  if (!failures.length) return primary;
  const error = new AggregateError([primary, ...failures].filter(Boolean), message);
  if (primary?.result) error.result = primary.result;
  return error;
}

function withMigrationLocks(root, workspace, manifest, action, options = {}) {
  const locks = [];
  let acquisitionComplete = false;
  let result;
  let actionError = null;
  const globalFile = join(root, 'locks', GLOBAL_MIGRATION_LOCK);
  try {
    locks.push(acquireExactLock(root, globalFile, manifest.migration_id, {
      requireRecoveryBarrier: options.requireGlobalRecoveryBarrier === true,
    }));
    const repos = [...new Set(manifest.entries
      .filter((entry) => MUTATING_ACTIONS.has(entry.action))
      .map((entry) => entry.repo_id))].sort(compareText);
    for (const repoId of repos) {
      locks.push(acquireExactLock(root, join(root, 'locks', `${repoId}.lock`), manifest.migration_id));
    }
    acquisitionComplete = true;
    pauseTestMigrationLocks(root);
    assertLockedRuntimeContext(root, workspace, manifest);
    result = action({ globalLock: locks[0], locks });
    return result;
  } catch (error) {
    actionError = error;
    throw error;
  } finally {
    const recoveredBeforeComplete = !acquisitionComplete && locks.some((lock) => lock.recovered);
    const status = result?.status || null;
    const mayRelease = !recoveredBeforeComplete && terminalReleaseProof(root, manifest, status);
    if (!mayRelease) {
      const failures = retainMigrationLocks(root, locks);
      if (failures.length) {
        throw combinedMigrationError(
          actionError,
          failures,
          'Migration failed and one or more locks could not be fenced for recovery.',
        );
      }
    } else if (locks.length) {
      try {
        releaseMigrationLocks(root, locks, manifest, status);
      } catch (releaseError) {
        const failures = retainMigrationLocks(root, locks);
        throw combinedMigrationError(
          actionError || releaseError,
          actionError ? [releaseError, ...failures] : failures,
          'Migration lock release failed and recovery fencing was incomplete.',
        );
      }
    }
  }
}

function assertMainThreadMutation() {
  if (!isMainThread) {
    throw new Error('Offline session-state apply, verify, and rollback require the process main thread.');
  }
}

export function applyMigration(options = {}) {
  assertMainThreadMutation();
  const manifest = typeof options.manifest === 'string' ? readManifest(options.manifest) : options.manifest;
  validateManifest(manifest);
  const { workspace, root } = migrationRuntimeContext(manifest, options.workspace);
  const tx = transactionPaths(root, manifest.migration_id);
  normalizeOwnedPrivateMigrationDirectories(root, [tx.manifest]);
  for (let attempt = 0; attempt < MAX_PREFLIGHT_RESTARTS; attempt += 1) {
    const authorization = preflightApplyReadOnly(root, workspace, manifest);
    if (authorization.kind === 'already_verified') return authorization.verification;
    try {
      return withMigrationLocks(root, workspace, manifest, ({ globalLock, locks }) => {
        assertAcquiredGlobalLockAuthorization(root, manifest, globalLock, authorization);
        if (!migrationHasDurableMutation(root, manifest)) {
          assertMigrationSpaceReservation(root, manifest);
        }
        return applyLocked(root, workspace, manifest, locks, authorization);
      }, {
        requireGlobalRecoveryBarrier: authorization.requires_global_recovery_barrier === true,
      });
    } catch (error) {
      if (error.code !== 'PHANTOM_MIGRATION_RESTART_PREFLIGHT') throw error;
    }
  }
  throw humanDecisionRequiredError(
    manifest.migration_id,
    'Migration preflight did not converge after recovery-barrier changes.',
  );
}

function verifySuccessor(
  root,
  entry,
  paths,
  cutoverAt,
  successorPrepared,
  activated,
  pointerPrepared,
  committed,
) {
  const artifacts = validateV2(entry, paths, root, cutoverAt);
  if (!existsSync(paths.successor)) throw new Error(`Migrated successor is missing: ${entry.entry_id}`);
  const successorState = preparedSuccessorLocation(
    paths,
    root,
    entry,
    successorPrepared,
    activated,
  );
  const snapshot = successorState.snapshot;
  const sessionRaw = readRegularBytes(join(paths.successor, 'session.json'), root).bytes.toString('utf8');
  const intentRaw = readRegularBytes(join(paths.successor, 'intent.json'), root).bytes.toString('utf8');
  if (sessionRaw !== prettyJson(artifacts.session) || intentRaw !== prettyJson(artifacts.intent)) {
    throw new Error(`Migrated successor contract differs: ${entry.entry_id}`);
  }
  if (!existsSync(join(paths.successor, 'control-inputs', '.claims'))) {
    throw new Error(`Migrated successor lacks control-input claims: ${entry.entry_id}`);
  }
  const pointerRaw = preparedPointerLocation(
    entry,
    paths,
    root,
    cutoverAt,
    pointerPrepared,
    committed,
  ).record.bytes.toString('utf8');
  if (pointerRaw !== prettyJson(artifacts.pointer)) throw new Error(`Migrated pointer differs: ${entry.entry_id}`);
  return snapshot;
}

function verifyLocked(root, manifest, tx = transactionPaths(root, manifest.migration_id)) {
  const errors = [];
  let verified = 0;
  try {
    if (!existsSync(tx.manifest)
      || readRegularBytes(tx.manifest, root, MAX_MANIFEST_BYTES).bytes.toString('utf8') !== prettyJson(manifest)) {
      throw new Error('Stored migration manifest is missing or changed.');
    }
  } catch (error) { errors.push(error.message); }
  for (const entry of manifest.entries.filter((candidate) => MUTATING_ACTIONS.has(candidate.action))) {
    const paths = deriveEntryPaths(root, tx, entry);
    try {
      const entryEvents = entryJournalEvents(paths.journal, root, manifest, entry);
      if (canonicalJson(entryEvents.map((event) => event.event_type))
        !== canonicalJson(expectedEventTypes(entry))) {
        throw new Error(`Migration journal topology differs: ${entry.entry_id}`);
      }
      const begin = entryEvents.find((event) => event.event_type === 'entry_started');
      const committed = entryEvents.find((event) => event.event_type === 'pointer_committed');
      if (!begin || !committed) throw new Error(`Migration journal is incomplete: ${entry.entry_id}`);
      const pointerBackup = readRegularBytes(paths.pointerBackup, root);
      if (!pointerBackupMatches(pointerBackup, entry.pointer)) {
        throw new Error(`Pointer backup differs: ${entry.entry_id}`);
      }
      if (entry.source) {
        verifyTreeBackup(paths.treeBackup, root, entry.source);
        if (!sameArchivePlan(entry, paths, root)) throw new Error(`Legacy archive differs: ${entry.entry_id}`);
      }
      if (entry.action === 'migrate_to_paused') {
        const successorPrepared = entryEvents.find((event) => event.event_type === 'successor_prepared');
        const activated = entryEvents.find((event) => event.event_type === 'successor_activated');
        const pointerPrepared = entryEvents.find((event) => event.event_type === 'pointer_prepared');
        if (!successorPrepared || !activated || !pointerPrepared) {
          throw new Error(`Prepared migration journal is incomplete: ${entry.entry_id}`);
        }
        verifySuccessor(
          root,
          entry,
          paths,
          begin.payload.cutover_at,
          successorPrepared,
          activated,
          pointerPrepared,
          committed,
        );
      } else {
        const parked = entry.action === 'archive_completed' ? paths.pointerHistory : paths.quarantine;
        if (existsSync(paths.pointer) || !sameFilePlan(parked, root, entry.pointer)) {
          throw new Error(`Legacy pointer was not parked exactly: ${entry.entry_id}`);
        }
      }
      verified += 1;
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors.length
    ? { schema_version: 1, status: 'failed', migration_id: manifest.migration_id, errors }
    : { schema_version: 1, status: 'verified', migration_id: manifest.migration_id, entries_verified: verified };
}

export function verifyMigration(options = {}) {
  assertMainThreadMutation();
  const manifest = typeof options.manifest === 'string' ? readManifest(options.manifest) : options.manifest;
  validateManifest(manifest);
  const { workspace, root } = migrationRuntimeContext(manifest, options.workspace);
  const tx = transactionPaths(root, manifest.migration_id);
  normalizeOwnedPrivateMigrationDirectories(root, [tx.manifest]);
  return withMigrationLocks(
    root,
    workspace,
    manifest,
    () => completedRollbackResult(root, manifest) || verifyLocked(root, manifest),
  );
}

function rollbackRefusal(manifest, errors) {
  return {
    schema_version: 1,
    status: 'human_decision_required',
    migration_id: manifest.migration_id,
    errors,
    manual_recovery: [
      'Stop all Phantom processes that may use the affected repositories.',
      'Preserve the migration transaction directory and current data root byte-for-byte.',
      'Compare the v1 backup, archived source, v2 successor, pointer, and journal before choosing a winner.',
      'Restore session data first and the current-session pointer last.',
    ],
  };
}

function sameTreeDigest(directory, root, expectedDigest) {
  if (!existsSync(directory)) return false;
  try { return treeSnapshot(directory, root).tree_digest === expectedDigest; } catch { return false; }
}

function sameSourceContent(entry, paths, root) {
  if (!existsSync(paths.source)) return false;
  try {
    return verifyTreeContent(paths.source, root, entry.source, { physical: true });
  } catch {
    return false;
  }
}

function rollbackMarker(manifest, mutations, status, restoredEntries = []) {
  return {
    schema_version: 1,
    migration_id: manifest.migration_id,
    status,
    entry_ids: mutations.map((entry) => entry.entry_id),
    restored_entries: restoredEntries,
  };
}

function assertRollbackReceipt(receipt, entry) {
  const fields = isObject(receipt) ? Object.keys(receipt).sort(compareText) : [];
  if (canonicalJson(fields) !== canonicalJson(['entry_id', 'pointer', 'source_tree_digest'])
    || receipt.entry_id !== entry.entry_id
    || (receipt.source_tree_digest !== null
      && !/^sha256:[a-f0-9]{64}$/.test(receipt.source_tree_digest || ''))) {
    throw new Error(`Rollback receipt is malformed: ${entry.entry_id}`);
  }
  assertFilePlan(receipt.pointer, `Rollback pointer receipt ${entry.entry_id}`);
  if ((entry.source === null) !== (receipt.source_tree_digest === null)) {
    throw new Error(`Rollback source receipt differs: ${entry.entry_id}`);
  }
}

function restoredEntryReceipt(entry, paths, root) {
  const pointer = filePlan(readRegularBytes(paths.pointer, root));
  if (pointer.digest !== entry.pointer.digest
    || pointer.size !== entry.pointer.size
    || pointer.mode !== entry.pointer.mode
    || pointer.nlink !== entry.pointer.nlink) {
    throw new Error(`Restored pointer content differs: ${entry.entry_id}`);
  }
  let sourceTreeDigest = null;
  if (entry.source) {
    const source = treeSnapshot(paths.source, root);
    if (canonicalJson(source) !== canonicalJson(entry.source)) {
      throw new Error(`Restored source identity differs: ${entry.entry_id}`);
    }
    sourceTreeDigest = source.tree_digest;
  }
  return {
    entry_id: entry.entry_id,
    pointer,
    source_tree_digest: sourceTreeDigest,
  };
}

function rollbackPointerLocation(entry, paths, root, prepared, backup, events) {
  const expectedBytes = backup.bytes;
  if (existsSync(paths.rollbackPointerStage)) {
    const record = assertPointerEventIdentity(
      paths.rollbackPointerStage,
      root,
      prepared,
      entry.entry_id,
      'Rollback-prepared',
    );
    if (!record.bytes.equals(expectedBytes)) {
      throw new Error(`Rollback-prepared pointer bytes changed: ${entry.entry_id}`);
    }
    if (entry.action === 'migrate_to_paused') {
      const begin = events.find((event) => event.event_type === 'entry_started');
      preparedPointerLocation(
        entry,
        paths,
        root,
        begin.payload.cutover_at,
        events.find((event) => event.event_type === 'pointer_prepared'),
        events.find((event) => event.event_type === 'pointer_committed'),
      );
    } else if (existsSync(paths.pointer)) {
      throw new Error(`Rollback destination appeared before pointer restore: ${entry.entry_id}`);
    }
    return { location: paths.rollbackPointerStage, record };
  }
  const record = assertPointerEventIdentity(
    paths.pointer,
    root,
    prepared,
    entry.entry_id,
    'Rollback-prepared',
  );
  if (!record.bytes.equals(expectedBytes)) {
    throw new Error(`Restored pointer bytes changed after rollback cutover: ${entry.entry_id}`);
  }
  return { location: paths.pointer, record };
}

function verifyCompletedRollback(root, manifest, tx, mutations, marker) {
  const errors = [];
  if (!Array.isArray(marker.restored_entries)
    || marker.restored_entries.length !== mutations.length) {
    return ['Completed rollback marker lacks exact restored receipts.'];
  }
  for (const entry of mutations) {
    const paths = deriveEntryPaths(root, tx, entry);
    const receipt = marker.restored_entries.find((candidate) => candidate?.entry_id === entry.entry_id);
    try {
      assertRollbackReceipt(receipt, entry);
      const current = restoredEntryReceipt(entry, paths, root);
      if (canonicalJson(current) !== canonicalJson(receipt)) {
        throw new Error(`Completed rollback physical identity changed: ${entry.entry_id}`);
      }
      const events = entryJournalEvents(paths.journal, root, manifest, entry);
      const expectedTypes = [...expectedEventTypes(entry), 'rollback_pointer_prepared', 'rollback_completed'];
      if (canonicalJson(events.map((event) => event.event_type)) !== canonicalJson(expectedTypes)) {
        throw new Error(`Completed rollback journal topology differs: ${entry.entry_id}`);
      }
      const completed = events.at(-1);
      if (canonicalJson(completed.payload) !== canonicalJson(receipt)) {
        throw new Error(`Completed rollback journal receipt differs: ${entry.entry_id}`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors;
}

function readRollbackMarker(root, tx, manifest, mutations, { normalize = false } = {}) {
  if (!lstatIfPresent(dirname(tx.rollbackState))) return null;
  const generation = captureTargetGeneration({
    root,
    target: migrationPublicationTarget(root, tx.rollbackState),
    maxBytes: MAX_MANIFEST_BYTES,
  });
  if (generation.state === 'absent') return null;
  capturedPublicationRecord(generation);
  const value = parseJsonBytes({ bytes: generation.bytes }, 'rollback-state.json');
  const expectedIds = mutations.map((entry) => entry.entry_id);
  if (!isObject(value) || value.schema_version !== 1
    || value.migration_id !== manifest.migration_id
    || !['in_progress', 'completed'].includes(value.status)
    || canonicalJson(value.entry_ids) !== canonicalJson(expectedIds)
    || !Array.isArray(value.restored_entries)
    || (value.status === 'in_progress' && value.restored_entries.length !== 0)) {
    throw new Error('Rollback state marker is malformed or belongs to another migration.');
  }
  if (value.status === 'completed') {
    for (const entry of mutations) {
      const receipt = value.restored_entries.find((candidate) => candidate?.entry_id === entry.entry_id);
      assertRollbackReceipt(receipt, entry);
    }
  }
  if (!normalize || generation.nlink === 1) return { marker: value, generation };
  publishMigrationJson(
    root,
    tx.rollbackState,
    value,
    value.status === 'completed' ? 'rollback-marker-completed' : 'rollback-marker-in-progress',
  );
  const normalized = captureTargetGeneration({
    root,
    target: migrationPublicationTarget(root, tx.rollbackState),
    maxBytes: MAX_MANIFEST_BYTES,
  });
  if (normalized.state !== 'present' || normalized.nlink !== 1
    || !normalized.bytes.equals(Buffer.from(prettyJson(value)))) {
    throw new Error('Rollback state marker failed durable publication normalization.');
  }
  return { marker: value, generation: normalized };
}

function completedRollbackResult(root, manifest) {
  const tx = transactionPaths(root, manifest.migration_id);
  const mutations = manifest.entries.filter((entry) => MUTATING_ACTIONS.has(entry.action));
  let marker;
  try { marker = readRollbackMarker(root, tx, manifest, mutations)?.marker || null; } catch (error) {
    return {
      schema_version: 1,
      status: 'failed',
      migration_id: manifest.migration_id,
      errors: [error.message],
    };
  }
  if (marker?.status !== 'completed') return null;
  const errors = verifyCompletedRollback(root, manifest, tx, mutations, marker);
  return errors.length
    ? { schema_version: 1, status: 'failed', migration_id: manifest.migration_id, errors }
    : {
      schema_version: 1,
      status: 'rolled_back',
      migration_id: manifest.migration_id,
      entries_restored: mutations.length,
    };
}

function rollbackLocked(root, manifest, locks) {
  const tx = transactionPaths(root, manifest.migration_id);
  const mutations = manifest.entries.filter((entry) => MUTATING_ACTIONS.has(entry.action));
  let marker;
  let markerGeneration;
  try {
    const markerRecord = readRollbackMarker(root, tx, manifest, mutations, { normalize: true });
    marker = markerRecord?.marker || null;
    markerGeneration = markerRecord?.generation || null;
  } catch (error) {
    return rollbackRefusal(manifest, [error.message]);
  }
  if (marker?.status === 'completed') {
    const errors = verifyCompletedRollback(root, manifest, tx, mutations, marker);
    if (errors.length) return rollbackRefusal(manifest, errors);
    return {
      schema_version: 1,
      status: 'rolled_back',
      migration_id: manifest.migration_id,
      entries_restored: mutations.length,
    };
  }

  if (!marker) {
    const verified = verifyLocked(root, manifest, tx);
    if (verified.status !== 'verified') return rollbackRefusal(manifest, verified.errors);
  } else {
    try {
      if (readRegularBytes(tx.manifest, root, MAX_MANIFEST_BYTES).bytes.toString('utf8') !== prettyJson(manifest)) {
        throw new Error('Stored migration manifest changed during rollback.');
      }
    } catch (error) {
      return rollbackRefusal(manifest, [error.message]);
    }
  }

  // Classify the full partial-rollback state before making another mutation.
  const guardErrors = [];
  const pointerBackups = new Map();
  const rollbackStates = new Map();
  for (const entry of mutations) {
    const paths = deriveEntryPaths(root, tx, entry);
    let events = [];
    try {
      events = entryJournalEvents(paths.journal, root, manifest, entry);
    } catch (error) {
      guardErrors.push(error.message);
    }
    const eventTypes = events.map((event) => event.event_type);
    const baseTypes = expectedEventTypes(entry);
    const preparedTypes = [...baseTypes, 'rollback_pointer_prepared'];
    const completedTypes = [...preparedTypes, 'rollback_completed'];
    if (canonicalJson(eventTypes) !== canonicalJson(baseTypes)
      && canonicalJson(eventTypes) !== canonicalJson(preparedTypes)
      && canonicalJson(eventTypes) !== canonicalJson(completedTypes)) {
      guardErrors.push(`Journal changed after migration: ${entry.entry_id}`);
    }
    try {
      const backup = readRegularBytes(paths.pointerBackup, root);
      if (!pointerBackupMatches(backup, entry.pointer)) {
        guardErrors.push(`Pointer backup changed: ${entry.entry_id}`);
      } else pointerBackups.set(entry.entry_id, backup);
    } catch (error) {
      guardErrors.push(error.message);
    }
    let dataState = 'none';
    if (entry.action === 'migrate_to_paused') {
      const discarded = join(tx.rollback, 'discarded-successors', entry.repo_id, entry.task_segment);
      const successorPrepared = events.find((event) => event.event_type === 'successor_prepared');
      const activated = events.find((event) => event.event_type === 'successor_activated');
      let expectedV2Digest = null;
      try {
        const preparedPayload = successorEventPayload(successorPrepared, entry.entry_id, 'Prepared');
        const activatedPayload = successorEventPayload(activated, entry.entry_id, 'Activated');
        if (canonicalJson(activatedPayload) !== canonicalJson(preparedPayload)) {
          throw new Error(`Activated successor identity differs from its prepared receipt: ${entry.entry_id}`);
        }
        expectedV2Digest = preparedPayload.successor_tree_digest;
      } catch (error) {
        guardErrors.push(error.message);
      }
      const sourceIsV2 = expectedV2Digest && sameTreeDigest(paths.source, root, expectedV2Digest);
      const discardedIsV2 = expectedV2Digest && sameTreeDigest(discarded, root, expectedV2Digest);
      const sourceIsV1 = sameTreePlan(paths.source, root, entry.source);
      const archiveIsV1 = sameArchivePlan(entry, paths, root);
      if (sourceIsV2 && !existsSync(discarded) && archiveIsV1) dataState = 'initial';
      else if (!existsSync(paths.source) && discardedIsV2 && archiveIsV1) dataState = 'successor_parked';
      else if (sourceIsV1 && discardedIsV2 && !existsSync(paths.archive)) dataState = 'data_restored';
      else guardErrors.push(`Rollback data state is ambiguous: ${entry.entry_id}`);
    } else if (entry.action === 'archive_completed') {
      if (!existsSync(paths.source) && sameArchiveContent(entry, paths, root)) dataState = 'initial';
      else if (sameSourceContent(entry, paths, root) && !existsSync(paths.archive)) dataState = 'data_restored';
      else guardErrors.push(`Rollback completed-history state is ambiguous: ${entry.entry_id}`);
    }
    if (entry.action !== 'migrate_to_paused') {
      const parked = entry.action === 'archive_completed' ? paths.pointerHistory : paths.quarantine;
      if (!sameFilePlan(parked, root, entry.pointer)) guardErrors.push(`Parked pointer changed: ${entry.entry_id}`);
    }
    const rollbackPrepared = events.find((event) => event.event_type === 'rollback_pointer_prepared');
    const rollbackCompleted = events.find((event) => event.event_type === 'rollback_completed');
    let pointerRestored = false;
    if (rollbackPrepared) {
      try {
        const pointerState = rollbackPointerLocation(
          entry,
          paths,
          root,
          rollbackPrepared,
          pointerBackups.get(entry.entry_id),
          events,
        );
        pointerRestored = pointerState.location === paths.pointer;
        if (rollbackCompleted) {
          if (!pointerRestored) throw new Error(`Completed rollback pointer remains staged: ${entry.entry_id}`);
          const receipt = restoredEntryReceipt(entry, paths, root);
          if (canonicalJson(rollbackCompleted.payload) !== canonicalJson(receipt)) {
            throw new Error(`Completed rollback receipt differs: ${entry.entry_id}`);
          }
        }
      } catch (error) {
        guardErrors.push(error.message);
      }
    } else if (entry.action === 'migrate_to_paused') {
      const begin = events.find((event) => event.event_type === 'entry_started');
      try {
        preparedPointerLocation(
          entry,
          paths,
          root,
          begin.payload.cutover_at,
          events.find((event) => event.event_type === 'pointer_prepared'),
          events.find((event) => event.event_type === 'pointer_committed'),
        );
      } catch (error) {
        guardErrors.push(error.message);
      }
    } else if (existsSync(paths.pointer)) {
      guardErrors.push(`Rollback pointer state is ambiguous: ${entry.entry_id}`);
    }
    rollbackStates.set(entry.entry_id, { dataState, pointerRestored });
  }
  if (guardErrors.length) return rollbackRefusal(manifest, guardErrors);

  if (!marker) {
    marker = rollbackMarker(manifest, mutations, 'in_progress');
    const published = publishMigrationJson(
      root,
      tx.rollbackState,
      marker,
      'rollback-marker-in-progress',
    );
    markerGeneration = captureTargetGeneration({
      root,
      target: migrationPublicationTarget(root, tx.rollbackState),
      maxBytes: MAX_MANIFEST_BYTES,
    });
    if (markerGeneration.state !== 'present'
      || markerGeneration.device !== published.device
      || markerGeneration.inode !== published.inode
      || !markerGeneration.bytes.equals(Buffer.from(prettyJson(marker)))) {
      throw new Error('Published rollback marker generation changed before completion binding.');
    }
    crashAt('after_rollback_marker');
  }

  // Data first. Every inferred state is idempotent across process death.
  for (const entry of mutations.filter((candidate) => candidate.source)) {
    const paths = deriveEntryPaths(root, tx, entry);
    const state = rollbackStates.get(entry.entry_id);
    if (entry.action === 'migrate_to_paused') {
      const discarded = join(tx.rollback, 'discarded-successors', entry.repo_id, entry.task_segment);
      if (state.dataState === 'initial') {
        durableRename(root, paths.successor, discarded);
        crashAt('after_rollback_successor_parked');
      }
      if (state.dataState !== 'data_restored') durableRename(root, paths.archive, paths.source);
    } else {
      if (state.dataState === 'initial') {
        assertSafeChain(root, paths.archive);
        chmodSync(paths.archive, 0o700);
        crashAt('after_rollback_completed_archive_unsealed');
        durableRename(root, paths.archive, paths.source);
        crashAt('after_rollback_completed_restore_rename');
      }
      restoreTreeModes(root, paths.source, entry.source);
    }
  }
  crashAt('after_rollback_data');

  // Pointer restoration is globally last and uses the immutable byte backup.
  const restoredEntries = [];
  for (const entry of mutations) {
    const paths = deriveEntryPaths(root, tx, entry);
    const backup = pointerBackups.get(entry.entry_id);
    const events = entryJournalEvents(paths.journal, root, manifest, entry);
    let rollbackPrepared = events.find((event) => event.event_type === 'rollback_pointer_prepared');
    if (!rollbackPrepared) {
      publishMigrationBytes(
        root,
        paths.rollbackPointerStage,
        backup.bytes,
        entry.pointer.mode,
        'rollback-pointer-stage',
      );
      const staged = readRegularBytes(paths.rollbackPointerStage, root);
      if (!staged.bytes.equals(backup.bytes) || staged.mode !== entry.pointer.mode) {
        throw new Error(`Rollback pointer stage conflicts: ${entry.entry_id}`);
      }
      rollbackPrepared = appendJournal(
        paths.journal,
        root,
        manifest,
        entry,
        locks,
        'rollback_pointer_prepared',
        pointerIdentityPayload(staged),
      );
    }
    const pointerState = rollbackPointerLocation(
      entry,
      paths,
      root,
      rollbackPrepared,
      backup,
      entryJournalEvents(paths.journal, root, manifest, entry),
    );
    if (pointerState.location === paths.rollbackPointerStage) {
      durableReplace(root, paths.rollbackPointerStage, paths.pointer);
      crashAt('after_rollback_pointer');
    }
    const receipt = restoredEntryReceipt(entry, paths, root);
    appendJournal(
      paths.journal,
      root,
      manifest,
      entry,
      locks,
      'rollback_completed',
      receipt,
    );
    restoredEntries.push(receipt);
  }
  const completedMarker = rollbackMarker(manifest, mutations, 'completed', restoredEntries);
  publishMigrationJson(
    root,
    tx.rollbackState,
    completedMarker,
    'rollback-marker-completed',
    {
      expectedTarget: markerGeneration,
      validateLease: () => assertRollbackPublicationLease(root, manifest, locks),
    },
  );
  const completionErrors = verifyCompletedRollback(root, manifest, tx, mutations, completedMarker);
  if (completionErrors.length) return rollbackRefusal(manifest, completionErrors);
  return {
    schema_version: 1,
    status: 'rolled_back',
    migration_id: manifest.migration_id,
    entries_restored: mutations.length,
  };
}

export function rollbackMigration(options = {}) {
  assertMainThreadMutation();
  const manifest = typeof options.manifest === 'string' ? readManifest(options.manifest) : options.manifest;
  validateManifest(manifest);
  const { workspace, root } = migrationRuntimeContext(manifest, options.workspace);
  const tx = transactionPaths(root, manifest.migration_id);
  normalizeOwnedPrivateMigrationDirectories(root, [tx.rollbackState]);
  return withMigrationLocks(
    root,
    workspace,
    manifest,
    ({ locks }) => rollbackLocked(root, manifest, locks),
  );
}

function parseCli(argv) {
  const commands = new Set(['inventory', 'apply', 'verify', 'rollback']);
  let command = 'inventory';
  let index = 0;
  if (argv[0] && !argv[0].startsWith('--')) {
    command = argv[0];
    index = 1;
  }
  if (!commands.has(command)) throw new Error(`Unknown migration command: ${command}`);
  const result = {
    command,
    workspace: undefined,
    manifest: undefined,
    output: undefined,
    confirmInactive: [],
    workKinds: {},
  };
  while (index < argv.length) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!['--workspace', '--manifest', '--output', '--confirm-inactive', '--work-kind'].includes(option)) {
      throw new Error(`Unknown migration option: ${option}`);
    }
    if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value.`);
    if (option === '--workspace') {
      if (result.workspace !== undefined) throw new Error('--workspace may be supplied only once.');
      result.workspace = value;
    } else if (option === '--manifest') {
      if (result.manifest !== undefined) throw new Error('--manifest may be supplied only once.');
      result.manifest = value;
    } else if (option === '--output') {
      if (result.output !== undefined) throw new Error('--output may be supplied only once.');
      result.output = value;
    } else if (option === '--confirm-inactive') {
      result.confirmInactive.push(value);
    } else {
      const separator = value.lastIndexOf('=');
      if (separator <= 0) throw new Error('--work-kind requires <repo>/<task>=implementation|investigation.');
      const key = value.slice(0, separator);
      const kind = value.slice(separator + 1);
      if (!WORK_KINDS.has(kind)) throw new Error(`Invalid work kind: ${kind}`);
      if (Object.hasOwn(result.workKinds, key) && result.workKinds[key] !== kind) {
        throw new Error(`Conflicting work-kind overrides for ${key}.`);
      }
      result.workKinds[key] = kind;
    }
    index += 2;
  }
  if (command === 'inventory' && result.manifest) {
    throw new Error('inventory does not accept --manifest.');
  }
  if (command !== 'inventory' && result.output) throw new Error('--output is available only for inventory.');
  if (command !== 'inventory' && !result.manifest) throw new Error(`${command} requires --manifest.`);
  if (command !== 'inventory' && (result.confirmInactive.length || Object.keys(result.workKinds).length)) {
    throw new Error('Confirmations and work-kind overrides must be recorded by inventory, not supplied to apply/verify/rollback.');
  }
  return result;
}

export function runSessionMigration(argv = process.argv.slice(2), io = {}) {
  const parsed = parseCli(argv);
  const options = { workspace: parsed.workspace, manifest: parsed.manifest };
  let result;
  if (parsed.command === 'inventory') {
    const manifest = inventoryMigration({
      ...options,
      confirmInactive: parsed.confirmInactive,
      workKinds: parsed.workKinds,
    });
    if (parsed.output) {
      writePrivateManifest(parsed.output, manifest);
      result = {
        schema_version: 1,
        status: 'inventory_written',
        migration_id: manifest.migration_id,
      };
    } else result = manifest;
  } else if (parsed.command === 'apply') result = applyMigration(options);
  else if (parsed.command === 'verify') result = verifyMigration(options);
  else result = rollbackMigration(options);
  const output = `${canonicalJson(result)}\n`;
  (io.stdout || process.stdout).write(output);
  return result;
}

if (isMainModule(import.meta.url)) {
  try {
    const result = runSessionMigration();
    if (['failed', 'human_decision_required'].includes(result.status)) process.exitCode = 1;
  } catch (error) {
    if (error.result) process.stdout.write(`${canonicalJson(error.result)}\n`);
    else process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
