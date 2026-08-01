// Author: Subash Karki
// Deterministic, resumable publication of prepared regular files.
// Threat boundary: root and target parents must be private, caller-owned, real
// directories. Absent-target publication is atomic no-replace. Replacement
// safety relies on the caller's synchronous validator proving an exclusive
// lease across every generation check and rename boundary.

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { threadId } from 'node:worker_threads';

export const DURABLE_PUBLICATION_SCHEMA = 'phantom-durable-publication-v1';
export const DEFAULT_PUBLICATION_MAX_BYTES = 16 * 1024 * 1024;
export const REPLACEMENT_LEASE_PHASES = Object.freeze([
  'before_generation_check',
  'after_generation_check',
  'before_rename',
  'after_rename',
]);
export const DURABLE_PUBLICATION_ERROR_CODES = Object.freeze({
  BOUNDS: 'PHANTOM_PUBLICATION_BOUNDS',
  CHANGED: 'PHANTOM_PUBLICATION_CHANGED',
  DEBRIS: 'PHANTOM_PUBLICATION_DEBRIS',
  GENERATION_CHANGED: 'PHANTOM_PUBLICATION_GENERATION_CHANGED',
  INPUT: 'PHANTOM_PUBLICATION_INPUT',
  IO: 'PHANTOM_PUBLICATION_IO',
  LEASE_INVALID: 'PHANTOM_PUBLICATION_LEASE_INVALID',
  LEASE_REQUIRED: 'PHANTOM_PUBLICATION_LEASE_REQUIRED',
  LINKS: 'PHANTOM_PUBLICATION_LINKS',
  MISMATCH: 'PHANTOM_PUBLICATION_MISMATCH',
  MISSING: 'PHANTOM_PUBLICATION_MISSING',
  STAGING_ACTIVE: 'PHANTOM_PUBLICATION_STAGING_ACTIVE',
  TARGET_EXISTS: 'PHANTOM_PUBLICATION_TARGET_EXISTS',
  TRUST: 'PHANTOM_PUBLICATION_TRUST',
  TYPE: 'PHANTOM_PUBLICATION_TYPE',
  UNSUPPORTED: 'PHANTOM_PUBLICATION_UNSUPPORTED',
  VERIFY: 'PHANTOM_PUBLICATION_VERIFY',
});

const CODES = new Set(Object.values(DURABLE_PUBLICATION_ERROR_CODES));
const PREPARED_MODE = 0o600;
const MAX_DIRECTORY_ENTRIES = 4096;
const OPERATION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PREPARED_STEM = '.phantom-publish-v1-';
const STAGE_SUFFIX = /^([1-9]\d*)-(0|[1-9]\d*)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function fail(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  throw error;
}

function publicCall(label, operation) {
  try {
    return operation();
  } catch (error) {
    if (CODES.has(error?.code)) throw error;
    fail(DURABLE_PUBLICATION_ERROR_CODES.IO, `${label} failed: ${error?.message || error}`, error);
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeNumber(value, label) {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail(DURABLE_PUBLICATION_ERROR_CODES.CHANGED, `${label} is outside the safe integer range.`);
    }
    return Number(value);
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.CHANGED, `${label} is not a non-negative safe integer.`);
  }
  return value;
}

function integerText(value, label) {
  if (typeof value === 'bigint') {
    if (value < 0n) fail(DURABLE_PUBLICATION_ERROR_CODES.CHANGED, `${label} must be non-negative.`);
    return value.toString();
  }
  return String(safeNumber(value, label));
}

const statMode = (stat) => Number(stat.mode & 0o7777n);
const identity = (stat) => ({
  device: integerText(stat.dev, 'Filesystem device'),
  inode: integerText(stat.ino, 'Filesystem inode'),
});
const times = (stat) => ({
  mtimeNs: integerText(stat.mtimeNs, 'Filesystem mtime'),
  ctimeNs: integerText(stat.ctimeNs, 'Filesystem ctime'),
  birthtimeNs: integerText(stat.birthtimeNs, 'Filesystem birthtime'),
});
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
const sameStable = (left, right) => sameIdentity(left, right)
  && left.size === right.size && left.mode === right.mode && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
  && left.birthtimeNs === right.birthtimeNs;

function lstatIfPresent(file) {
  try { return lstatSync(file, { bigint: true }); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertTrustedDirectory(stat, file) {
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.TRUST, `Publication directory is not real: ${file}`);
  }
  if (typeof process.geteuid !== 'function') {
    fail(DURABLE_PUBLICATION_ERROR_CODES.UNSUPPORTED, 'Directory ownership checks require geteuid().');
  }
  if (stat.uid !== BigInt(process.geteuid()) || (stat.mode & 0o077n) !== 0n) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.TRUST, `Publication directory is not private and caller-owned: ${file}`);
  }
}

function assertTrustedChain(root, directory) {
  assertTrustedDirectory(lstatSync(root, { bigint: true }), root);
  const rel = relative(root, directory);
  if (rel === '' || rel === '.') return;
  let current = root;
  for (const segment of rel.split(sep)) {
    current = resolve(current, segment);
    assertTrustedDirectory(lstatSync(current, { bigint: true }), current);
  }
}

function normalizeOptions(options) {
  if (!options || typeof options !== 'object') {
    fail(DURABLE_PUBLICATION_ERROR_CODES.INPUT, 'Publication options are required.');
  }
  if (typeof options.root !== 'string' || options.root.trim() === '') {
    fail(DURABLE_PUBLICATION_ERROR_CODES.INPUT, 'Publication root is required.');
  }
  const requestedRoot = resolve(options.root);
  const requestedStat = lstatSync(requestedRoot, { bigint: true });
  if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory()) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.TRUST, `Publication root is not a real directory: ${requestedRoot}`);
  }
  const root = resolve(realpathSync(requestedRoot));
  if (typeof options.target !== 'string' || options.target === ''
    || options.target.includes('\0') || isAbsolute(options.target)) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.INPUT, 'Publication target must be a non-empty root-relative path.');
  }
  const targetPath = resolve(root, options.target);
  const target = relative(root, targetPath);
  if (target === '' || target === '.' || target === '..'
    || target.startsWith(`..${sep}`) || isAbsolute(target)) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.TRUST, `Publication target escapes its root: ${options.target}`);
  }
  const parent = dirname(targetPath);
  assertTrustedChain(root, parent);
  if (typeof options.operation !== 'string' || !OPERATION.test(options.operation)) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.INPUT, 'Publication operation is not a safe identifier.');
  }
  if (!Number.isInteger(options.mode) || options.mode < 0 || options.mode > 0o777) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.INPUT, 'Publication mode must be an integer from 0000 through 0777.');
  }
  if (!(Buffer.isBuffer(options.bytes) || options.bytes instanceof Uint8Array)) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.INPUT, 'Publication bytes must be a Buffer or Uint8Array.');
  }
  if (options.hooks !== undefined
    && (typeof options.hooks !== 'object' || typeof options.hooks.onStep !== 'function')) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.INPUT, 'hooks must expose a synchronous onStep function.');
  }
  const bytes = Buffer.from(options.bytes);
  const maximum = options.maxBytes ?? DEFAULT_PUBLICATION_MAX_BYTES;
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.INPUT, 'Publication maxBytes must be a non-negative safe integer.');
  }
  if (bytes.length > maximum) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.BOUNDS, `Publication exceeds the ${maximum}-byte bound.`);
  }
  const digest = sha256(bytes);
  const contract = JSON.stringify({
    schema: DURABLE_PUBLICATION_SCHEMA,
    operation: options.operation,
    target,
    mode: options.mode,
    size: bytes.length,
    sha256: digest,
  });
  const targetToken = sha256(Buffer.from(`${DURABLE_PUBLICATION_SCHEMA}\0${target}`)).slice(0, 24);
  const contractToken = sha256(Buffer.from(contract));
  const candidatePrefix = `${PREPARED_STEM}${targetToken}-`;
  const preparedName = `${candidatePrefix}${contractToken}.prepared`;
  return {
    root, target, targetPath, parent, operation: options.operation, mode: options.mode,
    bytes, maximum, digest, candidatePrefix, preparedName,
    preparedPath: resolve(parent, preparedName),
    stagePrefix: `${candidatePrefix}${contractToken}.stage-`,
    onStep: options.hooks?.onStep,
  };
}

function emit(plan, step, path = null) {
  if (!plan.onStep) return;
  const result = plan.onStep(step, Object.freeze({
    root: plan.root,
    target: plan.target,
    targetPath: plan.targetPath,
    preparedPath: plan.preparedPath,
    path,
  }));
  if (result && typeof result.then === 'function') {
    fail(DURABLE_PUBLICATION_ERROR_CODES.INPUT, 'Publication hooks must be synchronous.');
  }
}

function syncDescriptor(plan, descriptor, label, path) {
  emit(plan, `before_${label}_fsync`, path);
  fsyncSync(descriptor);
  emit(plan, `after_${label}_fsync`, path);
}

function syncDirectory(plan, label) {
  let descriptor;
  try {
    const directoryFlag = Number.isInteger(constants.O_DIRECTORY) ? constants.O_DIRECTORY : 0;
    descriptor = openSync(plan.parent, constants.O_RDONLY | directoryFlag);
    syncDescriptor(plan, descriptor, label, plan.parent);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function noFollow(base) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.UNSUPPORTED, 'This runtime cannot enforce no-follow reads.');
  }
  return base | constants.O_NOFOLLOW;
}

function boundedRead(descriptor, stat, maximum, label) {
  const size = safeNumber(stat.size, 'Filesystem file size');
  if (size > maximum) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.BOUNDS, `${label} exceeds the ${maximum}-byte bound.`);
  }
  const bytes = Buffer.alloc(size);
  for (let offset = 0; offset < size;) {
    const count = readSync(descriptor, bytes, offset, size - offset, offset);
    if (count === 0) fail(DURABLE_PUBLICATION_ERROR_CODES.CHANGED, `${label} ended during read.`);
    offset += count;
  }
  return bytes;
}

function openStable(file, maximum, { privateOwned = false, singleLink = false } = {}) {
  const pathBefore = lstatSync(file, { bigint: true });
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.TYPE, `Publication input is not a regular non-symlink file: ${file}`);
  }
  let descriptor;
  try {
    descriptor = openSync(file, noFollow(constants.O_RDONLY));
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || !sameIdentity(pathBefore, before)) {
      fail(DURABLE_PUBLICATION_ERROR_CODES.CHANGED, `Publication input changed before open: ${file}`);
    }
    if (singleLink && before.nlink !== 1n) {
      fail(DURABLE_PUBLICATION_ERROR_CODES.LINKS, `Publication input must be single-link: ${file}`);
    }
    if (privateOwned && ((before.mode & 0o077n) !== 0n || before.uid !== BigInt(process.geteuid()))) {
      fail(DURABLE_PUBLICATION_ERROR_CODES.TRUST, `Publication input must be private and caller-owned: ${file}`);
    }
    const bytes = boundedRead(descriptor, before, maximum, file);
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(file, { bigint: true });
    if (!sameStable(before, after) || !sameStable(after, pathAfter)) {
      fail(DURABLE_PUBLICATION_ERROR_CODES.CHANGED, `Publication input changed during read: ${file}`);
    }
    return { descriptor, bytes, stat: after };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function scan(plan) {
  const directory = opendirSync(plan.parent);
  const stages = [];
  let prepared = false;
  let count = 0;
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (++count > MAX_DIRECTORY_ENTRIES) {
        fail(DURABLE_PUBLICATION_ERROR_CODES.BOUNDS, 'Publication directory exceeds its entry bound.');
      }
      if (!entry.name.startsWith(plan.candidatePrefix)) continue;
      if (entry.name === plan.preparedName) prepared = true;
      else if (entry.name.startsWith(plan.stagePrefix)
        && STAGE_SUFFIX.test(entry.name.slice(plan.stagePrefix.length))) stages.push(entry.name);
      else fail(DURABLE_PUBLICATION_ERROR_CODES.DEBRIS, `Unrecognized prepared debris was retained: ${entry.name}`);
    }
  } finally {
    directory.closeSync();
  }
  return { prepared, stages: stages.sort() };
}

function processAlive(pid) {
  if (pid === process.pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'EPERM') return true;
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function cleanupStages(plan, names) {
  for (const name of names) {
    const match = STAGE_SUFFIX.exec(name.slice(plan.stagePrefix.length));
    const pid = Number(match[1]);
    const ownerThread = Number(match[2]);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ownerThread)
      || (pid === process.pid && ownerThread !== threadId) || processAlive(pid)) {
      fail(DURABLE_PUBLICATION_ERROR_CODES.STAGING_ACTIVE, `Prepared staging is owned by a live process: ${name}`);
    }
    const file = resolve(plan.parent, name);
    const stageState = lstatSync(file, { bigint: true });
    const preparedState = lstatIfPresent(plan.preparedPath);
    const installed = stageState.nlink === 2n && preparedState?.nlink === 2n
      && sameIdentity(stageState, preparedState);
    if (stageState.nlink !== 1n && !installed) {
      fail(DURABLE_PUBLICATION_ERROR_CODES.LINKS, `Prepared staging has an unsafe link count: ${name}`);
    }
    const held = openStable(file, plan.maximum, { privateOwned: true });
    try {
      const pathState = lstatSync(file, { bigint: true });
      if (!sameStable(held.stat, pathState)) {
        fail(DURABLE_PUBLICATION_ERROR_CODES.CHANGED, `Prepared staging changed before cleanup: ${name}`);
      }
      if (installed) verifyBytes(plan, held, 'Installed prepared staging');
      unlinkSync(file);
      syncDirectory(plan, 'staging_cleanup_parent');
    } finally {
      closeSync(held.descriptor);
    }
  }
}

function verifyBytes(plan, held, label) {
  if (held.bytes.length !== plan.bytes.length || sha256(held.bytes) !== plan.digest
    || !held.bytes.equals(plan.bytes)) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.MISMATCH, `${label} bytes differ from the publication contract.`);
  }
}

function receipt(plan, status, stat = null) {
  return {
    schema: DURABLE_PUBLICATION_SCHEMA,
    operation: plan.operation,
    target: plan.target,
    mode: plan.mode,
    size: plan.bytes.length,
    sha256: `sha256:${plan.digest}`,
    preparedName: plan.preparedName,
    preparedPath: plan.preparedPath,
    status,
    ...(stat ? identity(stat) : {}),
  };
}

function fileGeneration(stat, bytes) {
  return {
    state: 'present',
    bytes,
    ...identity(stat),
    size: safeNumber(stat.size, 'Filesystem file size'),
    mode: statMode(stat),
    nlink: safeNumber(stat.nlink, 'Filesystem link count'),
    ...times(stat),
  };
}

function captureGeneration(plan) {
  if (lstatIfPresent(plan.targetPath) === null) return { state: 'absent' };
  const held = openStable(plan.targetPath, plan.maximum);
  try { return fileGeneration(held.stat, held.bytes); } finally { closeSync(held.descriptor); }
}

function sameGeneration(actual, expected) {
  const fields = [
    'device', 'inode', 'size', 'mode', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs',
  ];
  return expected?.state === 'present' && Buffer.isBuffer(expected.bytes)
    && actual.bytes.equals(expected.bytes)
    && fields.every((field) => actual[field] === expected[field]);
}

function validateLease(options, plan, phase) {
  if (typeof options.validateLease !== 'function') {
    fail(DURABLE_PUBLICATION_ERROR_CODES.LEASE_REQUIRED, 'Present-target replacement requires validateLease.');
  }
  let valid;
  try {
    valid = options.validateLease(phase, Object.freeze({
      root: plan.root,
      target: plan.target,
      targetPath: plan.targetPath,
      preparedPath: plan.preparedPath,
      expectedTarget: options.expectedTarget,
    }));
  } catch (error) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.LEASE_INVALID, `Exclusive lease validation failed at ${phase}.`, error);
  }
  if (valid !== true) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.LEASE_INVALID, `Exclusive lease is invalid at ${phase}.`);
  }
}

function verifyPublished(plan, descriptor) {
  const before = fstatSync(descriptor, { bigint: true });
  const pathBefore = lstatSync(plan.targetPath, { bigint: true });
  const bytes = boundedRead(descriptor, before, plan.maximum, plan.targetPath);
  const after = fstatSync(descriptor, { bigint: true });
  const pathAfter = lstatSync(plan.targetPath, { bigint: true });
  if (!after.isFile() || after.nlink !== 1n || statMode(after) !== plan.mode
    || after.uid !== BigInt(process.geteuid()) || !sameStable(before, after)
    || !sameStable(after, pathBefore) || !sameStable(after, pathAfter)
    || sha256(bytes) !== plan.digest || !bytes.equals(plan.bytes)) {
    fail(DURABLE_PUBLICATION_ERROR_CODES.VERIFY, `Published file failed verification: ${plan.target}`);
  }
  syncDescriptor(plan, descriptor, 'published_file', plan.targetPath);
  syncDirectory(plan, 'published_parent');
  return after;
}

function alreadyPublished(plan) {
  const target = lstatIfPresent(plan.targetPath);
  if (!target) fail(DURABLE_PUBLICATION_ERROR_CODES.MISSING, `Prepared publication is missing: ${plan.target}`);
  const held = openStable(plan.targetPath, plan.maximum, { singleLink: true });
  try {
    if (statMode(held.stat) !== plan.mode || held.stat.uid !== BigInt(process.geteuid())) {
      fail(DURABLE_PUBLICATION_ERROR_CODES.MISSING, `Target does not match the missing prepared publication: ${plan.target}`);
    }
    verifyBytes(plan, held, 'Published target');
    const stat = verifyPublished(plan, held.descriptor);
    return { ...receipt(plan, 'already_published', stat), publishedPath: plan.targetPath };
  } finally {
    closeSync(held.descriptor);
  }
}

function recoverLinkedPublication(plan) {
  const prepared = lstatSync(plan.preparedPath, { bigint: true });
  if (prepared.nlink !== 2n) return null;
  const target = lstatIfPresent(plan.targetPath);
  if (!target || target.nlink !== 2n || !sameIdentity(prepared, target)) return null;
  const held = openStable(plan.targetPath, plan.maximum);
  try {
    if (!sameStable(held.stat, target) || statMode(held.stat) !== plan.mode
      || held.stat.uid !== BigInt(process.geteuid())) {
      fail(DURABLE_PUBLICATION_ERROR_CODES.VERIFY, 'Linked publication recovery failed metadata verification.');
    }
    verifyBytes(plan, held, 'Linked published target');
    unlinkSync(plan.preparedPath);
    const stat = verifyPublished(plan, held.descriptor);
    return { ...receipt(plan, 'already_published', stat), publishedPath: plan.targetPath };
  } finally { closeSync(held.descriptor); }
}

export function preparedPublicationName(options) {
  return publicCall('Preparing deterministic publication name', () => normalizeOptions(options).preparedName);
}

export function prepareDurablePublication(options) {
  return publicCall('Preparing durable publication', () => {
    const plan = normalizeOptions(options);
    let state = scan(plan);
    cleanupStages(plan, state.stages);
    state = scan(plan);
    if (state.prepared) {
      const held = openStable(plan.preparedPath, plan.maximum, { privateOwned: true, singleLink: true });
      try {
        verifyBytes(plan, held, 'Prepared file');
        syncDescriptor(plan, held.descriptor, 'prepared_file', plan.preparedPath);
        syncDirectory(plan, 'prepared_parent');
        return { ...receipt(plan, 'prepared'), resumed: true };
      } finally { closeSync(held.descriptor); }
    }

    const stageName = `${plan.stagePrefix}${process.pid}-${threadId}-${randomUUID()}`;
    const stagePath = resolve(plan.parent, stageName);
    let descriptor;
    try {
      descriptor = openSync(stagePath, noFollow(constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL), PREPARED_MODE);
      fchmodSync(descriptor, PREPARED_MODE);
      for (let offset = 0; offset < plan.bytes.length;) {
        const count = writeSync(descriptor, plan.bytes, offset, plan.bytes.length - offset, offset);
        if (count === 0) fail(DURABLE_PUBLICATION_ERROR_CODES.CHANGED, 'Prepared staging stopped accepting bytes.');
        offset += count;
      }
      syncDescriptor(plan, descriptor, 'staging_file', stagePath);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }

    const staged = openStable(stagePath, plan.maximum, { privateOwned: true, singleLink: true });
    try {
      verifyBytes(plan, staged, 'Prepared staging');
      syncDescriptor(plan, staged.descriptor, 'verified_staging_file', stagePath);
      syncDirectory(plan, 'staging_parent');
      emit(plan, 'before_prepared_install', stagePath);
      try {
        linkSync(stagePath, plan.preparedPath);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const pathState = lstatSync(stagePath, { bigint: true });
        if (!sameStable(staged.stat, pathState)) {
          fail(DURABLE_PUBLICATION_ERROR_CODES.CHANGED, 'Prepared staging changed during install contention.');
        }
        unlinkSync(stagePath);
        syncDirectory(plan, 'contended_staging_cleanup_parent');
        const winner = openStable(plan.preparedPath, plan.maximum, { privateOwned: true, singleLink: true });
        try {
          verifyBytes(plan, winner, 'Contended prepared file');
          syncDescriptor(plan, winner.descriptor, 'prepared_file', plan.preparedPath);
          syncDirectory(plan, 'prepared_parent');
          return { ...receipt(plan, 'prepared'), resumed: true };
        } finally { closeSync(winner.descriptor); }
      }
      emit(plan, 'after_prepared_install', plan.preparedPath);
      syncDirectory(plan, 'prepared_install_parent');
      const installed = lstatSync(plan.preparedPath, { bigint: true });
      const staging = lstatSync(stagePath, { bigint: true });
      if (!sameIdentity(installed, staging) || installed.nlink !== 2n || staging.nlink !== 2n) {
        fail(DURABLE_PUBLICATION_ERROR_CODES.VERIFY, 'Prepared no-replace installation failed identity verification.');
      }
      unlinkSync(stagePath);
      syncDirectory(plan, 'staging_unlink_parent');
    } finally { closeSync(staged.descriptor); }

    const prepared = openStable(plan.preparedPath, plan.maximum, { privateOwned: true, singleLink: true });
    try {
      verifyBytes(plan, prepared, 'Prepared file');
      return { ...receipt(plan, 'prepared'), resumed: false };
    } finally { closeSync(prepared.descriptor); }
  });
}

export function captureTargetGeneration({ root, target, maxBytes = DEFAULT_PUBLICATION_MAX_BYTES }) {
  return publicCall('Capturing target generation', () => {
    const plan = normalizeOptions({
      root, target, operation: 'capture-target-generation', mode: 0,
      bytes: Buffer.alloc(0), maxBytes,
    });
    return captureGeneration(plan);
  });
}

export function publishDurablePublication(options) {
  return publicCall('Publishing durable publication', () => {
    const plan = normalizeOptions(options);
    const state = scan(plan);
    cleanupStages(plan, state.stages);
    if (!state.prepared) return alreadyPublished(plan);
    const linkedRecovery = recoverLinkedPublication(plan);
    if (linkedRecovery) return linkedRecovery;
    const held = openStable(plan.preparedPath, plan.maximum, { privateOwned: true, singleLink: true });
    let moved = false;
    let modeChanged = false;
    try {
      verifyBytes(plan, held, 'Prepared file');
      const expected = options.expectedTarget;
      if (expected?.state === 'present') {
        validateLease(options, plan, 'before_generation_check');
        const actual = captureGeneration(plan);
        if (!sameGeneration(actual, expected)) {
          fail(DURABLE_PUBLICATION_ERROR_CODES.GENERATION_CHANGED, `Target generation changed before replacement: ${plan.target}`);
        }
        validateLease(options, plan, 'after_generation_check');
      } else if (expected !== undefined && expected?.state !== 'absent') {
        fail(DURABLE_PUBLICATION_ERROR_CODES.INPUT, 'expectedTarget must be an absent or present captured generation.');
      } else if (lstatIfPresent(plan.targetPath) !== null) {
        fail(DURABLE_PUBLICATION_ERROR_CODES.TARGET_EXISTS, `No-replace target already exists: ${plan.target}`);
      }

      fchmodSync(held.descriptor, plan.mode);
      modeChanged = true;
      syncDescriptor(plan, held.descriptor, 'prepared_final_mode_file', plan.preparedPath);
      const preparedState = fstatSync(held.descriptor, { bigint: true });
      const preparedPathState = lstatSync(plan.preparedPath, { bigint: true });
      if (!sameStable(preparedState, preparedPathState) || preparedState.nlink !== 1n) {
        fail(DURABLE_PUBLICATION_ERROR_CODES.CHANGED, 'Prepared path changed before publication.');
      }

      if (expected?.state === 'present') {
        validateLease(options, plan, 'before_rename');
        renameSync(plan.preparedPath, plan.targetPath);
        moved = true;
        validateLease(options, plan, 'after_rename');
      } else {
        emit(plan, 'before_absent_link', plan.targetPath);
        try { linkSync(plan.preparedPath, plan.targetPath); } catch (error) {
          if (error.code === 'EEXIST') {
            fail(DURABLE_PUBLICATION_ERROR_CODES.TARGET_EXISTS, `No-replace publication lost its target race: ${plan.target}`, error);
          }
          throw error;
        }
        moved = true;
        emit(plan, 'after_absent_link', plan.targetPath);
        const linked = lstatSync(plan.targetPath, { bigint: true });
        const source = lstatSync(plan.preparedPath, { bigint: true });
        if (!sameIdentity(linked, source) || linked.nlink !== 2n || source.nlink !== 2n) {
          fail(DURABLE_PUBLICATION_ERROR_CODES.VERIFY, 'No-replace publication failed link verification.');
        }
        unlinkSync(plan.preparedPath);
      }
      const stat = verifyPublished(plan, held.descriptor);
      return { ...receipt(plan, 'published', stat), publishedPath: plan.targetPath };
    } catch (error) {
      if (!moved && modeChanged) {
        try {
          fchmodSync(held.descriptor, PREPARED_MODE);
          syncDescriptor(plan, held.descriptor, 'prepared_mode_restore_file', plan.preparedPath);
        } catch (restoreError) { error.restoreError = restoreError; }
      }
      throw error;
    } finally { closeSync(held.descriptor); }
  });
}
