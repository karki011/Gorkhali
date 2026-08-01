// Author: Subash Karki
// Atomic no-replace creation and lease-guarded replacement for canonical JSONL journals.
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync,
  opendirSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
export const MAX_ATOMIC_JOURNAL_EVENTS = 9; export const MAX_ATOMIC_JOURNAL_LINE_BYTES = 16 * 1024;
export const MAX_ATOMIC_JOURNAL_BYTES = 144 * 1024; export const ATOMIC_JOURNAL_FREE_SPACE_SCRATCH_BYTES = MAX_ATOMIC_JOURNAL_BYTES;
export const MAX_ATOMIC_JOURNAL_JSON_DEPTH = 64; export const MAX_ATOMIC_JOURNAL_JSON_NODES = 4096;
export const ATOMIC_JOURNAL_ERROR_CODES = Object.freeze({
  BOUNDS: 'PHANTOM_JOURNAL_BOUNDS', CANONICAL: 'PHANTOM_JOURNAL_CANONICAL',
  CHANGED: 'PHANTOM_JOURNAL_CHANGED', DUPLICATE: 'PHANTOM_JOURNAL_DUPLICATE',
  DURABILITY: 'PHANTOM_JOURNAL_DURABILITY', EXISTS: 'PHANTOM_JOURNAL_EXISTS',
  INPUT: 'PHANTOM_JOURNAL_INPUT', LEASE_INVALID: 'PHANTOM_JOURNAL_LEASE_INVALID',
  LEASE_REQUIRED: 'PHANTOM_JOURNAL_LEASE_REQUIRED', PATH: 'PHANTOM_JOURNAL_PATH',
  PREDECESSOR: 'PHANTOM_JOURNAL_PREDECESSOR', SEMANTIC: 'PHANTOM_JOURNAL_SEMANTIC',
  STAGING: 'PHANTOM_JOURNAL_STAGING', TYPE: 'PHANTOM_JOURNAL_TYPE',
});
const MAX_DIRECTORY_ENTRIES = 4096; const PRIVATE_FILE_MODE = 0o600; const PRIVATE_DIRECTORY_MODE_MASK = 0o077;
const GLOBAL_LOCK = '.session-state-migration.lock'; const SAFE_REPOSITORY = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,119}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code, message, cause) { const error = new Error(message, cause === undefined ? {} : { cause }); error.code = code; throw error; }
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const identity = (stat) => ({ device: stat.dev.toString(), inode: stat.ino.toString() });
const statMode = (stat) => Number(stat.mode & 0o777n);
const currentUid = () => (typeof process.getuid === 'function' ? BigInt(process.getuid()) : null);
function sameIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino; }
function sameGeneration(left, right) {
  return sameIdentity(left, right) && left.size === right.size && left.mode === right.mode
    && left.nlink === right.nlink && left.uid === right.uid
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
    && left.birthtimeNs === right.birthtimeNs;
}
function lstatIfPresent(file) {
  try { return lstatSync(file, { bigint: true }); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function assertOwnedPrivateDirectory(directory, label) {
  const stat = lstatSync(directory, { bigint: true });
  const uid = currentUid();
  if (stat.isSymbolicLink() || !stat.isDirectory()
    || (statMode(stat) & PRIVATE_DIRECTORY_MODE_MASK) !== 0
    || (uid !== null && stat.uid !== uid)) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.PATH, `${label} must be a private owned real directory: ${directory}`);
  }
  return stat;
}
function normalizePaths(options) {
  if (!isObject(options) || typeof options.trustedRoot !== 'string' || !options.trustedRoot.trim()
    || typeof options.journalPath !== 'string' || !options.journalPath.trim()) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.INPUT, 'trustedRoot and journalPath are required.');
  }
  const root = resolve(options.trustedRoot);
  assertOwnedPrivateDirectory(root, 'Journal trusted root');
  if (resolve(realpathSync(root)) !== root) fail(ATOMIC_JOURNAL_ERROR_CODES.PATH,
    `Journal trusted root has a symbolic-link ancestor: ${root}`);
  const file = isAbsolute(options.journalPath)
    ? resolve(options.journalPath) : resolve(root, options.journalPath);
  const rel = relative(root, file);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.PATH, `Journal path escapes its trusted root: ${file}`);
  }
  if (rel.split(sep)[0].toLowerCase() === 'locks') {
    fail(ATOMIC_JOURNAL_ERROR_CODES.PATH, `Journal path uses the reserved migration-lock namespace: ${file}`);
  }
  let current = root;
  for (const segment of relative(root, dirname(file)).split(sep).filter(Boolean)) {
    current = join(current, segment);
    assertOwnedPrivateDirectory(current, 'Journal parent');
  }
  return { root, file, parent: dirname(file) };
}
function assertJsonBounds(value) {
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop();
    nodes += 1;
    if (nodes > MAX_ATOMIC_JOURNAL_JSON_NODES) fail(ATOMIC_JOURNAL_ERROR_CODES.BOUNDS,
      'Journal JSON exceeds its node bound.');
    if (item.depth > MAX_ATOMIC_JOURNAL_JSON_DEPTH) fail(ATOMIC_JOURNAL_ERROR_CODES.BOUNDS,
      'Journal JSON exceeds its nesting-depth bound.');
    if (item.value !== null && typeof item.value === 'object') {
      if (seen.has(item.value)) fail(ATOMIC_JOURNAL_ERROR_CODES.CANONICAL, 'Journal JSON is cyclic.');
      seen.add(item.value);
      for (const child of Array.isArray(item.value) ? item.value : Object.values(item.value)) {
        stack.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
}
function encodeCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(encodeCanonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${encodeCanonical(value[key])}`).join(',')}}`;
  }
  if ((typeof value === 'number' && !Number.isFinite(value))
    || ['bigint', 'function', 'symbol', 'undefined'].includes(typeof value)) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.CANONICAL, 'Journal value contains an unsupported JSON scalar.');
  }
  let encoded;
  try { encoded = JSON.stringify(value); } catch (cause) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.CANONICAL, 'Journal scalar encoding failed.', cause);
  }
  if (encoded === undefined) fail(ATOMIC_JOURNAL_ERROR_CODES.CANONICAL, 'Journal value is not JSON-serializable.');
  return encoded;
}
export function canonicalJson(value) { assertJsonBounds(value); return encodeCanonical(value); }
export function atomicJournalTemporaryPrefix(journalPath) { return `.${basename(journalPath)}.atomic-journal.tmp-`; }
function assertPrivateFile(stat, file, links = 1n) {
  const uid = currentUid();
  if (!stat.isFile() || stat.isSymbolicLink?.() || stat.nlink !== links
    || statMode(stat) !== PRIVATE_FILE_MODE || (uid !== null && stat.uid !== uid)) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.TYPE,
      `Journal file must be an owned private regular ${links}-link file: ${file}`);
  }
}
function boundedRead(descriptor, maximum, label) {
  const chunks = [];
  let total = 0;
  while (total <= maximum) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, (maximum + 1) - total));
    const count = readSync(descriptor, chunk, 0, chunk.length, total);
    if (count === 0) break;
    chunks.push(chunk.subarray(0, count));
    total += count;
  }
  if (total > maximum) fail(ATOMIC_JOURNAL_ERROR_CODES.BOUNDS, `${label} exceeds ${maximum} bytes.`);
  return Buffer.concat(chunks, total);
}
function noFollow(base) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) fail(ATOMIC_JOURNAL_ERROR_CODES.TYPE,
    'This runtime cannot enforce no-follow journal access.');
  return base | constants.O_NOFOLLOW;
}
function openStablePrivate(file, maximum, checkpoint, label = 'Journal file', links = 1n) {
  const pathBefore = lstatIfPresent(file);
  if (pathBefore === null) return null;
  assertPrivateFile(pathBefore, file, links);
  let descriptor;
  try {
    descriptor = openSync(file, noFollow(constants.O_RDONLY));
    const before = fstatSync(descriptor, { bigint: true });
    assertPrivateFile(before, file, links);
    if (!sameIdentity(pathBefore, before)) fail(ATOMIC_JOURNAL_ERROR_CODES.CHANGED,
      `${label} changed before open: ${file}`);
    checkpoint?.('after_path_open', { journalPath: file });
    const bytes = boundedRead(descriptor, maximum, label);
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatIfPresent(file);
    if (pathAfter === null || !sameGeneration(pathBefore, before)
      || !sameGeneration(before, after) || !sameGeneration(after, pathAfter)
      || BigInt(bytes.length) !== after.size) {
      fail(ATOMIC_JOURNAL_ERROR_CODES.CHANGED, `${label} changed during pathname-bound read: ${file}`);
    }
    return { descriptor, bytes, stat: after };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}
function defaultValidateEvent(event, context) {
  return isObject(event) && event.sequence === context.index + 1
    && typeof event.event_digest === 'string' && event.event_digest.length > 0
    && event.previous_event_digest === context.previousDigest;
}
function hooksFrom(options) {
  for (const name of ['canonicalize', 'validateEvent', 'eventDigest', 'eventIdentity', 'checkpoint', 'fsyncFault']) {
    if (options[name] !== undefined && typeof options[name] !== 'function') {
      fail(ATOMIC_JOURNAL_ERROR_CODES.INPUT, `${name} must be a function.`);
    }
  }
  return {
    canonicalize: options.canonicalize ?? canonicalJson,
    validateEvent: options.validateEvent ?? defaultValidateEvent,
    eventDigest: options.eventDigest ?? ((event) => event?.event_digest),
    eventIdentity: options.eventIdentity ?? ((event) => event?.sequence),
    checkpoint: options.checkpoint,
    fsyncFault: options.fsyncFault,
  };
}
function parseLine(rawLine, hooks, label) {
  if (typeof rawLine !== 'string' || !rawLine.endsWith('\n') || rawLine.endsWith('\n\n')
    || rawLine === '\n' || rawLine.slice(0, -1).includes('\n')) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.CANONICAL, `${label} must be one nonblank line with one trailing newline.`);
  }
  if (Buffer.byteLength(rawLine) > MAX_ATOMIC_JOURNAL_LINE_BYTES) fail(ATOMIC_JOURNAL_ERROR_CODES.BOUNDS,
    `${label} exceeds ${MAX_ATOMIC_JOURNAL_LINE_BYTES} bytes.`);
  let event;
  try { event = JSON.parse(rawLine.slice(0, -1)); } catch (cause) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.CANONICAL, `${label} is malformed JSON.`, cause);
  }
  assertJsonBounds(event);
  let canonical;
  try { canonical = hooks.canonicalize(event); } catch (cause) {
    if (cause.code) throw cause;
    fail(ATOMIC_JOURNAL_ERROR_CODES.CANONICAL, `${label} canonicalization failed.`, cause);
  }
  if (typeof canonical !== 'string' || `${canonical}\n` !== rawLine) fail(ATOMIC_JOURNAL_ERROR_CODES.CANONICAL,
    `${label} is not caller-canonical JSON.`);
  return event;
}
function parseJournal(bytes, hooks, file) {
  if (bytes.length === 0 || bytes.at(-1) !== 0x0a) fail(ATOMIC_JOURNAL_ERROR_CODES.CANONICAL,
    `Journal must be nonempty with one trailing newline: ${file}`);
  const raw = bytes.toString('utf8');
  if (!Buffer.from(raw).equals(bytes)) fail(ATOMIC_JOURNAL_ERROR_CODES.CANONICAL, `Journal is not UTF-8: ${file}`);
  const lines = raw.slice(0, -1).split('\n');
  if (lines.some((line) => !line)) fail(ATOMIC_JOURNAL_ERROR_CODES.CANONICAL, `Journal contains a blank line: ${file}`);
  if (lines.length > MAX_ATOMIC_JOURNAL_EVENTS) fail(ATOMIC_JOURNAL_ERROR_CODES.BOUNDS,
    `Journal exceeds ${MAX_ATOMIC_JOURNAL_EVENTS} events: ${file}`);
  const events = []; const digests = []; const identities = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const event = parseLine(`${lines[index]}\n`, hooks, `Journal event ${index + 1}`);
    const previousDigest = digests.at(-1) ?? null;
    if (hooks.validateEvent(event, { file, index, previousDigest, previousEvent: events.at(-1) ?? null }) === false) {
      fail(ATOMIC_JOURNAL_ERROR_CODES.SEMANTIC, `Journal event ${index + 1} failed semantic validation.`);
    }
    const digest = hooks.eventDigest(event, { file, index });
    const eventIdentity = hooks.eventIdentity(event, { file, index });
    if (typeof digest !== 'string' || !digest || eventIdentity === null || eventIdentity === undefined) {
      fail(ATOMIC_JOURNAL_ERROR_CODES.SEMANTIC, `Journal event ${index + 1} lacks digest or identity.`);
    }
    const key = canonicalJson(eventIdentity);
    if (identities.has(key)) fail(ATOMIC_JOURNAL_ERROR_CODES.DUPLICATE, `Journal event ${index + 1} repeats an identity.`);
    identities.set(key, index); events.push(event); digests.push(digest);
  }
  return { raw, lines, events, digests, identities };
}
function absentSnapshot(file) { return { exists: false, file, bytes: Buffer.alloc(0), byteLength: 0,
  digest: sha256(Buffer.alloc(0)), events: [], digests: [], identities: new Map(), stat: null }; }
function readSnapshot(file, hooks) {
  const opened = openStablePrivate(file, MAX_ATOMIC_JOURNAL_BYTES, hooks.checkpoint);
  if (opened === null) {
    if (lstatIfPresent(file) !== null) fail(ATOMIC_JOURNAL_ERROR_CODES.CHANGED, `Journal appeared during absent read: ${file}`);
    return absentSnapshot(file);
  }
  try {
    return { exists: true, file, bytes: opened.bytes, byteLength: opened.bytes.length,
      digest: sha256(opened.bytes), ...parseJournal(opened.bytes, hooks, file), stat: opened.stat };
  } finally { closeSync(opened.descriptor); }
}
function sameSnapshot(left, right) {
  return left.exists === right.exists && (!left.exists
    || (left.digest === right.digest && left.bytes.equals(right.bytes) && sameGeneration(left.stat, right.stat)));
}
function syncFile(descriptor, stage, hooks) {
  try { hooks.fsyncFault?.(stage); fsyncSync(descriptor); } catch (cause) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.DURABILITY, `Journal file fsync failed at ${stage}.`, cause);
  }
}
function syncDirectory(directory, stage, hooks) {
  let descriptor;
  try {
    hooks.fsyncFault?.(stage);
    const directoryFlag = Number.isInteger(constants.O_DIRECTORY) ? constants.O_DIRECTORY : 0;
    descriptor = openSync(directory, noFollow(constants.O_RDONLY | directoryFlag));
    const stat = fstatSync(descriptor, { bigint: true });
    if (!stat.isDirectory()) fail(ATOMIC_JOURNAL_ERROR_CODES.PATH, `Expected directory: ${directory}`);
    fsyncSync(descriptor);
  } catch (cause) {
    if (cause.code?.startsWith('PHANTOM_JOURNAL_')) throw cause;
    fail(ATOMIC_JOURNAL_ERROR_CODES.DURABILITY, `Journal directory fsync failed at ${stage}.`, cause);
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
function assertExactPath(file, descriptor, expected, links = 1n) {
  const held = fstatSync(descriptor, { bigint: true });
  const pathStat = lstatIfPresent(file);
  if (pathStat === null || !sameGeneration(held, expected) || !sameGeneration(held, pathStat)) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.CHANGED, `Journal staging path changed: ${file}`);
  }
  assertPrivateFile(held, file, links);
  return held;
}
function cleanupExactTemporary(file, descriptor, expected, hooks, links = 1n) {
  if (lstatIfPresent(file) === null) return;
  hooks.checkpoint?.('before_staging_cleanup', { temporaryPath: file });
  assertExactPath(file, descriptor, expected, links);
  unlinkSync(file);
  syncDirectory(dirname(file), 'cleanup-parent', hooks);
}
function deadProcess(pid) {
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
}
function recoverLinkedPublication(file, temporary, hooks) {
  const staged = openStablePrivate(
    temporary, MAX_ATOMIC_JOURNAL_BYTES, hooks.checkpoint, 'Journal staging file', 2n,
  );
  if (staged === null) return;
  let canonical;
  try {
    canonical = openStablePrivate(file, MAX_ATOMIC_JOURNAL_BYTES, hooks.checkpoint, 'Journal file', 2n);
    if (canonical === null || !sameIdentity(staged.stat, canonical.stat)
      || !staged.bytes.equals(canonical.bytes)) {
      fail(ATOMIC_JOURNAL_ERROR_CODES.STAGING,
        `Two-link journal staging is not the canonical journal inode: ${temporary}`);
    }
    parseJournal(canonical.bytes, hooks, file);
    syncFile(canonical.descriptor, 'recovery-file', hooks);
    assertExactPath(file, canonical.descriptor, canonical.stat, 2n);
    hooks.checkpoint?.('before_linked_recovery_cleanup', { journalPath: file, temporaryPath: temporary });
    assertExactPath(temporary, staged.descriptor, staged.stat, 2n);
    assertExactPath(file, canonical.descriptor, canonical.stat, 2n);
    unlinkSync(temporary);
    syncDirectory(dirname(file), 'recovery-parent', hooks);
    const recovered = fstatSync(canonical.descriptor, { bigint: true });
    const pathRecovered = lstatIfPresent(file);
    assertPrivateFile(recovered, file);
    if (pathRecovered === null || !sameIdentity(recovered, pathRecovered)
      || recovered.size !== BigInt(canonical.bytes.length)) {
      fail(ATOMIC_JOURNAL_ERROR_CODES.CHANGED, `Recovered journal path changed: ${file}`);
    }
  } finally {
    if (canonical) closeSync(canonical.descriptor);
    closeSync(staged.descriptor);
  }
}
function cleanupStaleTemporaries(file, hooks) {
  const prefix = atomicJournalTemporaryPrefix(file);
  const directory = opendirSync(dirname(file));
  let count = 0;
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      count += 1;
      if (count > MAX_DIRECTORY_ENTRIES) fail(ATOMIC_JOURNAL_ERROR_CODES.BOUNDS, 'Journal directory exceeds 4096 entries.');
      if (!entry.name.startsWith(prefix)) continue;
      const suffix = entry.name.slice(prefix.length);
      const match = /^([1-9]\d*)-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(suffix);
      if (!match) fail(ATOMIC_JOURNAL_ERROR_CODES.STAGING, `Malformed journal staging name retained: ${entry.name}`);
      const temporary = join(dirname(file), entry.name);
      const pid = Number(match[1]);
      if (!deadProcess(pid) || pid === process.pid) continue;
      const temporaryStat = lstatIfPresent(temporary);
      if (temporaryStat?.nlink === 2n) {
        recoverLinkedPublication(file, temporary, hooks);
        continue;
      }
      const opened = openStablePrivate(temporary, MAX_ATOMIC_JOURNAL_BYTES, hooks.checkpoint, 'Journal staging file');
      if (opened === null) continue;
      try {
        parseJournal(opened.bytes, hooks, temporary);
        cleanupExactTemporary(temporary, opened.descriptor, opened.stat, hooks);
      } finally { closeSync(opened.descriptor); }
    }
  } finally { directory.closeSync(); }
}
function parseLock(raw, migrationId, label) {
  if (!raw.endsWith('\n') || raw.endsWith('\n\n') || raw.slice(0, -1).includes('\n')) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID, `${label} lock proof must be exactly one JSON line.`);
  }
  let owner;
  try { owner = JSON.parse(raw); } catch (cause) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID, `${label} lock proof is malformed.`, cause);
  }
  const fields = isObject(owner) ? Object.keys(owner).sort() : [];
  if (canonicalJson(fields) !== canonicalJson([
    'claim_digest', 'claim_epoch', 'created_at', 'migration_id', 'pid', 'state', 'token',
  ].sort()) || owner.migration_id !== migrationId || owner.state !== 'active'
    || owner.pid !== process.pid || typeof owner.token !== 'string' || !owner.token
    || typeof owner.created_at !== 'string' || !Number.isFinite(Date.parse(owner.created_at))
    || ((owner.claim_epoch === null) !== (owner.claim_digest === null))
    || (owner.claim_epoch !== null && (!Number.isInteger(owner.claim_epoch) || owner.claim_epoch < 0
      || !/^sha256:[a-f0-9]{64}$/.test(owner.claim_digest || '')))) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID, `${label} lock proof is not an active Phantom lock.`);
  }
  return owner;
}
function validateLockProof(expectedFile, proof, migrationId, label) {
  if (!isObject(proof) || proof.file !== expectedFile || !Number.isInteger(proof.descriptor)
    || proof.descriptor < 0 || typeof proof.raw !== 'string' || Buffer.byteLength(proof.raw) > 4096
    || !/^\d+$/.test(proof.device || '') || !/^\d+$/.test(proof.inode || '') || proof.released === true) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID, `${label} lock proof shape is invalid.`);
  }
  let held;
  try { held = fstatSync(proof.descriptor, { bigint: true }); } catch (cause) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID, `${label} lock descriptor is not open.`, cause);
  }
  assertPrivateFile(held, expectedFile);
  const heldBytes = boundedRead(proof.descriptor, 4096, `${label} lock descriptor`);
  const heldAfter = fstatSync(proof.descriptor, { bigint: true });
  const opened = openStablePrivate(expectedFile, 4096, undefined, `${label} lock`);
  if (opened === null) fail(ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID, `${label} lock was revoked.`);
  try {
    const exact = identity(held);
    if (!sameGeneration(held, heldAfter) || !sameIdentity(heldAfter, opened.stat)
      || exact.device !== proof.device || exact.inode !== proof.inode
      || !heldBytes.equals(opened.bytes) || heldBytes.toString('utf8') !== proof.raw) {
      fail(ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID, `${label} lock generation differs from its proof.`);
    }
  } finally { closeSync(opened.descriptor); }
  return parseLock(proof.raw, migrationId, label);
}
function validateLease(root, lease) {
  if (!isObject(lease) || typeof lease.migrationId !== 'string' || !lease.migrationId
    || !SAFE_REPOSITORY.test(lease.repositoryId || '')) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID, 'Replacement lease identity is invalid.');
  }
  const locks = join(root, 'locks');
  try {
    assertOwnedPrivateDirectory(locks, 'Migration locks directory');
    const globalOwner = validateLockProof(join(locks, GLOBAL_LOCK), lease.globalLock, lease.migrationId, 'Global');
    const repositoryOwner = validateLockProof(
      join(locks, `${lease.repositoryId}.lock`), lease.repositoryLock, lease.migrationId, 'Repository',
    );
    if (globalOwner.pid !== repositoryOwner.pid) fail(ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID,
      'Global and repository lock owners differ.');
  } catch (cause) {
    if (cause.code === ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID) throw cause;
    fail(ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID, 'Replacement lease proof is no longer exact.', cause);
  }
}
function durableDuplicate(file, expected, hooks) {
  const opened = openStablePrivate(file, MAX_ATOMIC_JOURNAL_BYTES, hooks.checkpoint);
  if (opened === null || sha256(opened.bytes) !== expected.digest || !opened.bytes.equals(expected.bytes)) {
    if (opened) closeSync(opened.descriptor);
    fail(ATOMIC_JOURNAL_ERROR_CODES.CHANGED, `Journal retry generation changed: ${file}`);
  }
  try {
    syncFile(opened.descriptor, 'retry-file', hooks);
    assertExactPath(file, opened.descriptor, opened.stat);
    syncDirectory(dirname(file), 'retry-parent', hooks);
    assertExactPath(file, opened.descriptor, opened.stat);
  } finally { closeSync(opened.descriptor); }
}
export function readAtomicJournalSnapshot(options) { const hooks = hooksFrom(options ?? {}); const { file } = normalizePaths(options);
  cleanupStaleTemporaries(file, hooks); return readSnapshot(file, hooks); }
export function appendAtomicJournalEvent(options) {
  if (!isObject(options) || !Object.hasOwn(options, 'expectedPredecessor')) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.INPUT, 'expectedPredecessor is required.');
  }
  if (options.expectedPredecessor !== null
    && (typeof options.expectedPredecessor !== 'string' || !options.expectedPredecessor)) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.INPUT, 'expectedPredecessor must be null or a nonempty string.');
  }
  const hooks = hooksFrom(options); const { root, file, parent } = normalizePaths(options);
  cleanupStaleTemporaries(file, hooks);
  const observedPresent = lstatIfPresent(file) !== null;
  if (observedPresent && options.replacementLease !== undefined) validateLease(root, options.replacementLease);
  hooks.checkpoint?.('before_predecessor_read', { journalPath: file });
  const before = readSnapshot(file, hooks);
  if (before.exists && !observedPresent) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.CHANGED, 'Journal appeared before its predecessor could be lease-guarded.');
  }
  if (before.exists && options.replacementLease !== undefined) validateLease(root, options.replacementLease);
  hooks.checkpoint?.('after_predecessor_read', { journalPath: file });
  if (before.exists && options.replacementLease !== undefined) validateLease(root, options.replacementLease);
  const event = parseLine(options.canonicalLine, hooks, 'Candidate journal event');
  const eventIdentity = hooks.eventIdentity(event, { file, index: before.events.length });
  if (eventIdentity === null || eventIdentity === undefined) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.SEMANTIC, 'Candidate event lacks duplicate identity.');
  }
  const duplicateIndex = before.identities.get(canonicalJson(eventIdentity));
  if (duplicateIndex !== undefined) {
    const existing = before.events[duplicateIndex];
    if (hooks.canonicalize(existing) !== hooks.canonicalize(event)) {
      fail(ATOMIC_JOURNAL_ERROR_CODES.DUPLICATE, 'Retry identity has different canonical content.');
    }
    durableDuplicate(file, before, hooks);
    return { status: 'already_present', event: existing, eventCount: before.events.length,
      journalDigest: before.digest, byteLength: before.byteLength };
  }
  if (before.exists && options.replacementLease === undefined) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.LEASE_REQUIRED, 'Present journal replacement requires an exact exclusive lease.');
  }
  const predecessor = before.digests.at(-1) ?? null;
  if (predecessor !== options.expectedPredecessor) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.PREDECESSOR, 'Journal predecessor differs from the caller expectation.');
  }
  if (before.events.length >= MAX_ATOMIC_JOURNAL_EVENTS) fail(ATOMIC_JOURNAL_ERROR_CODES.BOUNDS, 'Journal event bound reached.');
  if (hooks.validateEvent(event, { file, index: before.events.length, previousDigest: predecessor,
    previousEvent: before.events.at(-1) ?? null }) === false) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.SEMANTIC, 'Candidate event failed semantic validation.');
  }
  const candidateDigest = hooks.eventDigest(event, { file, index: before.events.length });
  if (typeof candidateDigest !== 'string' || !candidateDigest) {
    fail(ATOMIC_JOURNAL_ERROR_CODES.SEMANTIC, 'Candidate event has no semantic digest.');
  }
  const nextBytes = Buffer.concat([before.bytes, Buffer.from(options.canonicalLine)]);
  if (nextBytes.length > MAX_ATOMIC_JOURNAL_BYTES) fail(ATOMIC_JOURNAL_ERROR_CODES.BOUNDS, 'Journal byte bound reached.');
  const temporary = join(parent, `${atomicJournalTemporaryPrefix(file)}${process.pid}-${randomUUID()}`);
  let descriptor; let prepared; let linked = false;
  try {
    descriptor = openSync(temporary, noFollow(constants.O_CREAT | constants.O_EXCL | constants.O_RDWR), PRIVATE_FILE_MODE);
    writeFileSync(descriptor, nextBytes); prepared = fstatSync(descriptor, { bigint: true });
    assertPrivateFile(prepared, temporary); if (prepared.size !== BigInt(nextBytes.length)) fail(ATOMIC_JOURNAL_ERROR_CODES.STAGING, 'Prepared journal size differs.');
    syncFile(descriptor, 'prepared-file', hooks); syncDirectory(parent, 'prepared-parent', hooks);
    hooks.checkpoint?.('after_prepare', { journalPath: file, temporaryPath: temporary });
    assertExactPath(temporary, descriptor, prepared);
    if (!before.exists) {
      if (readSnapshot(file, hooks).exists) fail(ATOMIC_JOURNAL_ERROR_CODES.EXISTS, 'Absent journal was concurrently published.');
      hooks.checkpoint?.('before_no_replace', { journalPath: file, temporaryPath: temporary });
      if (readSnapshot(file, hooks).exists) fail(ATOMIC_JOURNAL_ERROR_CODES.EXISTS, 'Absent journal was concurrently published.');
      try { linkSync(temporary, file); linked = true; } catch (cause) {
        if (cause.code === 'EEXIST') fail(ATOMIC_JOURNAL_ERROR_CODES.EXISTS, 'Absent journal lost no-replace publication.', cause);
        throw cause;
      }
      hooks.checkpoint?.('after_no_replace_link', { journalPath: file, temporaryPath: temporary });
      syncDirectory(parent, 'no-replace-parent', hooks);
      assertExactPath(temporary, descriptor, fstatSync(descriptor, { bigint: true }), 2n);
      unlinkSync(temporary); linked = false;
    } else {
      validateLease(root, options.replacementLease);
      const current = readSnapshot(file, hooks); validateLease(root, options.replacementLease);
      if (!sameSnapshot(before, current)) fail(ATOMIC_JOURNAL_ERROR_CODES.CHANGED, 'Journal predecessor changed before replacement.');
      hooks.checkpoint?.('before_rename', { journalPath: file, temporaryPath: temporary });
      validateLease(root, options.replacementLease);
      const finalCurrent = readSnapshot(file, hooks); validateLease(root, options.replacementLease);
      if (!sameSnapshot(before, finalCurrent)) fail(ATOMIC_JOURNAL_ERROR_CODES.CHANGED, 'Journal predecessor changed immediately before replacement.');
      validateLease(root, options.replacementLease);
      renameSync(temporary, file);
      validateLease(root, options.replacementLease);
      hooks.checkpoint?.('after_rename', { journalPath: file, temporaryPath: temporary });
    }
    const published = fstatSync(descriptor, { bigint: true }); assertPrivateFile(published, file);
    const pathPublished = lstatSync(file, { bigint: true });
    if (!sameIdentity(published, pathPublished) || published.size !== BigInt(nextBytes.length)) {
      fail(ATOMIC_JOURNAL_ERROR_CODES.CHANGED, 'Published journal inode differs from staging.');
    }
    syncFile(descriptor, 'published-file', hooks); syncDirectory(parent, 'published-parent', hooks);
    assertExactPath(file, descriptor, published);
    hooks.checkpoint?.('after_publish', { journalPath: file, journalDigest: sha256(nextBytes) });
    return { status: 'appended', event, eventCount: before.events.length + 1,
      journalDigest: sha256(nextBytes), byteLength: nextBytes.length };
  } catch (error) {
    try {
      if (descriptor !== undefined && prepared !== undefined && lstatIfPresent(temporary) !== null) {
        const links = linked ? 2n : 1n;
        cleanupExactTemporary(temporary, descriptor, fstatSync(descriptor, { bigint: true }), hooks, links);
      }
    } catch (cleanupError) {
      const aggregate = new AggregateError([error, cleanupError], 'Journal publication and exact staging cleanup failed.');
      aggregate.code = ATOMIC_JOURNAL_ERROR_CODES.STAGING; throw aggregate;
    }
    throw error;
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
