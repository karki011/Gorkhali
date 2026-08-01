// Author: Subash Karki

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';

export const MAX_CONTROL_INPUT_BYTES = 1024 * 1024;
export const FILESYSTEM_SNAPSHOT_ALGORITHM = 'phantom-filesystem-snapshot-v2';

const snapshotCaches = new WeakMap();
const FILE_HASH_CHUNK_BYTES = 64 * 1024;
const compareText = (left, right) => (left < right ? -1 : (left > right ? 1 : 0));

const within = (root, candidate) => {
  const offset = relative(root, candidate);
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset));
};

const generation = (metadata) => [
  metadata.dev,
  metadata.ino,
  metadata.mode,
  metadata.nlink,
  metadata.size,
  metadata.mtimeNs,
  metadata.ctimeNs,
].map(String).join(':');

const fileMode = (metadata) => Number(metadata.mode & 0o7777n);

// dev/ino keep hardlink equivalence classes explicit, while nlink records
// whether the class has members outside the scanned workspace.
const physicalRecord = (metadata) => ({
  dev: String(metadata.dev),
  ino: String(metadata.ino),
  nlink: Number(metadata.nlink),
});

const hashBytes = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

export function isPortableWorkspacePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0
    || filePath.includes('\\') || filePath.includes('\0')
    || filePath.startsWith('//') || posix.isAbsolute(filePath)
    || filePath.includes('//') || posix.normalize(filePath) !== filePath) return false;
  const segments = filePath.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..'
    && !/^[A-Za-z]:/.test(segment));
}

function assertPortableWorkspacePath(filePath) {
  if (!isPortableWorkspacePath(filePath)) {
    throw new Error(`Workspace contains a non-portable path: ${JSON.stringify(filePath)}.`);
  }
}

function assertParentChain(root, candidate) {
  const offset = relative(root, candidate);
  if (!within(root, candidate) || offset === '') throw new Error(`Path is not a file below ${root}.`);
  let current = root;
  for (const segment of offset.split(sep).slice(0, -1)) {
    current = join(current, segment);
    const metadata = lstatSync(current, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`File parent must be a regular directory without symbolic links: ${current}`);
    }
  }
}

function assertStableRegularFile(candidate, descriptor, before) {
  const pathBefore = lstatSync(candidate, { bigint: true });
  const canonicalPath = resolve(realpathSync(candidate));
  const pathAfter = lstatSync(candidate, { bigint: true });
  const after = fstatSync(descriptor, { bigint: true });
  const expectedGeneration = generation(before);
  if (!before.isFile() || !after.isFile()
    || !pathBefore.isFile() || pathBefore.isSymbolicLink()
    || !pathAfter.isFile() || pathAfter.isSymbolicLink()
    || generation(after) !== expectedGeneration
    || generation(pathBefore) !== expectedGeneration
    || generation(pathAfter) !== expectedGeneration
    || canonicalPath !== candidate) {
    throw new Error(`File changed identity or generation while it was read: ${candidate}`);
  }
  return after;
}

function readDescriptorContent(descriptor, { captureBytes = false } = {}) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(FILE_HASH_CHUNK_BYTES);
  const chunks = captureBytes ? [] : null;
  let bytesHashed = 0;
  let maxChunkBytes = 0;
  let readOperations = 0;
  while (true) {
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    const chunk = buffer.subarray(0, bytesRead);
    hash.update(chunk);
    if (chunks) chunks.push(Buffer.from(chunk));
    bytesHashed += bytesRead;
    maxChunkBytes = Math.max(maxChunkBytes, bytesRead);
    readOperations += 1;
  }
  return {
    bytes: chunks ? Buffer.concat(chunks, bytesHashed) : null,
    digest: `sha256:${hash.digest('hex')}`,
    bytesHashed,
    maxChunkBytes,
    readOperations,
  };
}

function stableRegularFile(
  file,
  rootInput,
  expectedGeneration = null,
  { captureBytes = false } = {},
) {
  const lexicalRoot = resolve(rootInput);
  const lexical = resolve(file);
  // Permit platform aliases above the trust root (for example macOS /var), but
  // reject every symbolic-link directory introduced below that lexical root.
  assertParentChain(lexicalRoot, lexical);
  const root = resolve(realpathSync(lexicalRoot));
  const candidate = resolve(root, relative(lexicalRoot, lexical));
  assertParentChain(root, candidate);
  const noFollow = constants.O_NOFOLLOW;
  if (!Number.isInteger(noFollow)) throw new Error('This runtime cannot enforce no-follow file reads.');
  let descriptor;
  try {
    descriptor = openSync(candidate, constants.O_RDONLY | noFollow);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new Error(`Expected a regular file: ${candidate}`);
    const cacheHit = expectedGeneration !== null && generation(before) === expectedGeneration;
    const content = cacheHit
      ? { bytes: null, digest: null, bytesHashed: 0, maxChunkBytes: 0, readOperations: 0 }
      : readDescriptorContent(descriptor, { captureBytes });
    const after = assertStableRegularFile(candidate, descriptor, before);
    return {
      ...content,
      mode: fileMode(after),
      generation: generation(after),
      physical: physicalRecord(after),
      cacheHit,
    };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readRegularFileOnce(file, rootInput) {
  const record = stableRegularFile(file, rootInput, null, { captureBytes: true });
  return {
    bytes: record.bytes,
    mode: record.mode,
    generation: record.generation,
    physical: record.physical,
  };
}

export function createWorkspaceSnapshotCache() {
  const cache = Object.freeze({ schema_version: 2, kind: 'workspace-generation-cache' });
  snapshotCaches.set(cache, new Map());
  return cache;
}

function cacheRecords(cache, root) {
  if (cache === null || cache === undefined) return null;
  const roots = snapshotCaches.get(cache);
  if (!roots) {
    throw new Error('Workspace snapshot cache must come from createWorkspaceSnapshotCache().');
  }
  return { roots, records: roots.get(root) ?? new Map() };
}

function emptyInstrumentation() {
  return {
    directories_scanned: 0,
    entries_seen: 0,
    regular_files: 0,
    symbolic_links: 0,
    cache_hits: 0,
    cache_misses: 0,
    content_files_hashed: 0,
    content_bytes_hashed: 0,
    content_read_operations: 0,
    max_content_chunk_bytes: 0,
    link_targets_hashed: 0,
    link_bytes_hashed: 0,
  };
}

function snapshotDrift(label, relativePath, cause) {
  const error = new Error(`Workspace ${label} changed during snapshot validation: ${relativePath}.`);
  error.cause = cause;
  return error;
}

function revalidateRegularFile(root, record) {
  let descriptor;
  try {
    assertParentChain(root, record.file);
    const noFollow = constants.O_NOFOLLOW;
    if (!Number.isInteger(noFollow)) throw new Error('This runtime cannot enforce no-follow file reads.');
    descriptor = openSync(record.file, constants.O_RDONLY | noFollow);
    const before = fstatSync(descriptor, { bigint: true });
    const after = assertStableRegularFile(record.file, descriptor, before);
    if (generation(after) !== record.generation) throw new Error('Regular-file generation differs.');
  } catch (error) {
    throw snapshotDrift('regular file', record.relativePath, error);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function revalidateSymbolicLink(record) {
  try {
    const before = lstatSync(record.file, { bigint: true });
    const target = readlinkSync(record.file, 'utf8');
    const after = lstatSync(record.file, { bigint: true });
    if (!before.isSymbolicLink() || !after.isSymbolicLink()
      || generation(before) !== record.generation
      || generation(after) !== record.generation
      || target !== record.target) {
      throw new Error('Symbolic-link generation or target differs.');
    }
  } catch (error) {
    throw snapshotDrift('symbolic link', record.relativePath, error);
  }
}

function sameListing(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function revalidateDirectory(record) {
  try {
    const before = lstatSync(record.directory, { bigint: true });
    const listing = readdirSync(record.directory).sort(compareText);
    const after = lstatSync(record.directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()
      || !after.isDirectory() || after.isSymbolicLink()
      || generation(before) !== record.generation
      || generation(after) !== record.generation
      || !sameListing(listing, record.listing)) {
      throw new Error('Directory generation or listing differs.');
    }
  } catch (error) {
    throw snapshotDrift('directory', record.relativePath, error);
  }
}

function revalidateSnapshot(root, entryRecords, directoryRecords) {
  for (const record of entryRecords) {
    if (record.kind === 'file') revalidateRegularFile(root, record);
    else revalidateSymbolicLink(record);
  }
  for (const record of directoryRecords) revalidateDirectory(record);
}

export function readControlInputJson(file, sessionDirectory = null) {
  if (typeof file !== 'string' || !isAbsolute(file)) {
    throw new Error('Control input must use an absolute canonical path.');
  }
  const parent = resolve(realpathSync(dirname(file)));
  if (basename(parent) !== 'control-inputs') {
    throw new Error('Control input must be stored in the canonical control-inputs directory.');
  }
  if (sessionDirectory !== null) {
    const expectedParent = join(resolve(realpathSync(sessionDirectory)), 'control-inputs');
    if (parent !== resolve(realpathSync(expectedParent))) {
      throw new Error('Control input does not belong to the active canonical session.');
    }
  }
  const canonicalFile = resolve(realpathSync(file));
  if (canonicalFile !== file) throw new Error('Control input path must be canonical and must not be a symbolic link.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.json$/.test(basename(file))) {
    throw new Error('Control input filename must be a safe unique JSON name.');
  }
  const record = readStableJsonFile(file);
  if (record.bytes.length === 0 || record.bytes.length > MAX_CONTROL_INPUT_BYTES) {
    throw new Error(`Control input must contain 1-${MAX_CONTROL_INPUT_BYTES} bytes.`);
  }
  const digest = hashBytes(record.bytes);
  const { value } = record;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Control input must contain one JSON object.');
  }
  return { ...record, value, digest };
}

export function readStableJsonFile(file) {
  if (typeof file !== 'string') throw new Error('JSON input path is required.');
  const lexical = resolve(file);
  const metadata = lstatSync(lexical);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('JSON input must be a canonical regular non-symlink file.');
  }
  const candidate = resolve(realpathSync(lexical));
  const parent = resolve(realpathSync(dirname(candidate)));
  const record = readRegularFileOnce(candidate, parent);
  let value;
  try {
    value = JSON.parse(record.bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`JSON input is invalid: ${error.message}`);
  }
  return { ...record, value, digest: hashBytes(record.bytes) };
}

export function snapshotDigest(files) {
  const hash = createHash('sha256');
  hash.update(`${FILESYSTEM_SNAPSHOT_ALGORITHM}\0`);
  for (const entry of files) {
    hash.update(`${entry.path}\0${entry.kind}\0${entry.mode}\0${entry.digest}\0`);
  }
  return `sha256:${hash.digest('hex')}`;
}

export function workspaceSnapshot(workspaceInput, { cache = null } = {}) {
  const root = resolve(realpathSync(workspaceInput));
  const cacheState = cacheRecords(cache, root);
  const previousCache = cacheState?.records ?? new Map();
  const nextCache = new Map();
  const files = [];
  const physicalFiles = [];
  const entryRecords = [];
  const directoryRecords = [];
  const instrumentation = emptyInstrumentation();

  const visit = (directory, prefix = '') => {
    const directoryBefore = lstatSync(directory, { bigint: true });
    if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink()) {
      throw new Error(`Workspace snapshot directory is not stable: ${directory}`);
    }
    instrumentation.directories_scanned += 1;
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    const listing = entries.map((entry) => entry.name);
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      assertPortableWorkspacePath(relativePath);
      if (entry.name === '.git' || (prefix === '' && entry.name === '.phantom')) continue;
      const candidate = join(directory, entry.name);
      const metadata = lstatSync(candidate, { bigint: true });
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
        visit(candidate, relativePath);
        continue;
      }
      instrumentation.entries_seen += 1;
      if (metadata.isSymbolicLink()) {
        const target = readlinkSync(candidate, 'utf8');
        const after = lstatSync(candidate, { bigint: true });
        if (generation(metadata) !== generation(after)) {
          throw new Error(`Symbolic link changed while it was read: ${relativePath}`);
        }
        const digest = hashBytes(Buffer.from(target, 'utf8'));
        files.push({ path: relativePath, kind: 'symlink', mode: fileMode(after), digest });
        entryRecords.push({
          file: candidate,
          relativePath,
          kind: 'symlink',
          generation: generation(after),
          target,
        });
        instrumentation.symbolic_links += 1;
        instrumentation.link_targets_hashed += 1;
        instrumentation.link_bytes_hashed += Buffer.byteLength(target, 'utf8');
        continue;
      }
      if (!metadata.isFile()) throw new Error(`Workspace contains an unsupported file type: ${relativePath}`);

      const cached = previousCache.get(relativePath);
      const record = stableRegularFile(
        candidate,
        root,
        cached?.kind === 'file' ? cached.generation : null,
      );
      let digest;
      if (record.cacheHit) {
        digest = cached.digest;
        instrumentation.cache_hits += 1;
      } else {
        digest = record.digest;
        instrumentation.cache_misses += 1;
        instrumentation.content_files_hashed += 1;
        instrumentation.content_bytes_hashed += record.bytesHashed;
        instrumentation.content_read_operations += record.readOperations;
        instrumentation.max_content_chunk_bytes = Math.max(
          instrumentation.max_content_chunk_bytes,
          record.maxChunkBytes,
        );
      }
      files.push({ path: relativePath, kind: 'file', mode: record.mode, digest });
      physicalFiles.push({ path: relativePath, ...record.physical });
      entryRecords.push({
        file: candidate,
        relativePath,
        kind: 'file',
        generation: record.generation,
      });
      nextCache.set(relativePath, { kind: 'file', generation: record.generation, digest });
      instrumentation.regular_files += 1;
    }
    const directoryAfter = lstatSync(directory, { bigint: true });
    if (generation(directoryBefore) !== generation(directoryAfter)) {
      throw new Error(`Workspace directory changed while it was snapshotted: ${directory}`);
    }
    directoryRecords.push({
      directory,
      relativePath: prefix || '.',
      generation: generation(directoryAfter),
      listing,
    });
  };

  visit(root);
  files.sort((left, right) => compareText(left.path, right.path));
  physicalFiles.sort((left, right) => compareText(left.path, right.path));
  // Revalidation closes drift observed during this traversal, but it is not a
  // filesystem transaction. Security-sensitive consumers must also hold an
  // external workspace lease or use an immutable executor boundary through
  // snapshot construction and consumption.
  revalidateSnapshot(root, entryRecords, directoryRecords);
  if (cacheState) cacheState.roots.set(root, nextCache);
  return {
    schema_version: 2,
    algorithm: FILESYSTEM_SNAPSHOT_ALGORITHM,
    digest: snapshotDigest(files),
    files,
    physical_files: physicalFiles,
    instrumentation,
  };
}

export function changedSnapshotPaths(baselineFiles, currentFiles) {
  const baseline = new Map(baselineFiles.map((entry) => [entry.path, entry]));
  const current = new Map(currentFiles.map((entry) => [entry.path, entry]));
  return [...new Set([...baseline.keys(), ...current.keys()])]
    .filter((filePath) => JSON.stringify(baseline.get(filePath) ?? null)
      !== JSON.stringify(current.get(filePath) ?? null))
    .sort();
}
