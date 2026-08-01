// Author: Subash Karki

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const MAX_SNAPSHOT_FILES = 20_000;
export const MAX_CONTROL_INPUT_BYTES = 1024 * 1024;

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

export function readRegularFileOnce(file, rootInput) {
  const root = resolve(realpathSync(rootInput));
  const lexical = resolve(file);
  const candidate = join(resolve(realpathSync(dirname(lexical))), basename(lexical));
  assertParentChain(root, candidate);
  const noFollow = constants.O_NOFOLLOW;
  if (!Number.isInteger(noFollow)) throw new Error('This runtime cannot enforce no-follow file reads.');
  let descriptor;
  try {
    descriptor = openSync(candidate, constants.O_RDONLY | noFollow);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new Error(`Expected a regular file: ${candidate}`);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const pathMetadata = lstatSync(candidate, { bigint: true });
    if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()
      || generation(before) !== generation(after)
      || generation(after) !== generation(pathMetadata)
      || resolve(realpathSync(candidate)) !== candidate) {
      throw new Error(`File changed identity or generation while it was read: ${candidate}`);
    }
    return {
      bytes,
      mode: fileMode(after),
      generation: generation(after),
      physical: {
        dev: String(after.dev),
        ino: String(after.ino),
        nlink: Number(after.nlink),
      },
    };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function hashBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
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
  hash.update('phantom-filesystem-snapshot-v1\0');
  for (const entry of files) {
    hash.update(`${entry.path}\0${entry.kind}\0${entry.mode}\0${entry.digest}\0`);
  }
  return `sha256:${hash.digest('hex')}`;
}

export function workspaceSnapshot(workspaceInput) {
  const root = resolve(realpathSync(workspaceInput));
  const files = [];
  const physicalFiles = [];
  const visit = (directory, prefix = '') => {
    const directoryBefore = lstatSync(directory, { bigint: true });
    if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink()) {
      throw new Error(`Workspace snapshot directory is not stable: ${directory}`);
    }
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (entry.name === '.git' || (prefix === '' && entry.name === '.phantom')) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const candidate = join(directory, entry.name);
      const metadata = lstatSync(candidate, { bigint: true });
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
        visit(candidate, relativePath);
        continue;
      }
      if (files.length >= MAX_SNAPSHOT_FILES) {
        throw new Error(
          `Workspace snapshot exceeds the supported ${MAX_SNAPSHOT_FILES}-file boundary; `
          + `reduce the checkout to ${MAX_SNAPSHOT_FILES} files or fewer before running Phantom.`,
        );
      }
      if (metadata.isSymbolicLink()) {
        const target = readlinkSync(candidate, 'utf8');
        const after = lstatSync(candidate, { bigint: true });
        if (generation(metadata) !== generation(after)) {
          throw new Error(`Symbolic link changed while it was read: ${relativePath}`);
        }
        files.push({
          path: relativePath,
          kind: 'symlink',
          mode: fileMode(after),
          digest: hashBytes(Buffer.from(target, 'utf8')),
        });
        continue;
      }
      if (!metadata.isFile()) throw new Error(`Workspace contains an unsupported file type: ${relativePath}`);
      const file = readRegularFileOnce(candidate, root);
      files.push({ path: relativePath, kind: 'file', mode: file.mode, digest: hashBytes(file.bytes) });
      physicalFiles.push({ path: relativePath, ...file.physical });
    }
    const directoryAfter = lstatSync(directory, { bigint: true });
    if (generation(directoryBefore) !== generation(directoryAfter)) {
      throw new Error(`Workspace directory changed while it was snapshotted: ${directory}`);
    }
  };
  visit(root);
  files.sort((left, right) => compareText(left.path, right.path));
  physicalFiles.sort((left, right) => compareText(left.path, right.path));
  return {
    schema_version: 1,
    digest: snapshotDigest(files),
    files,
    physical_files: physicalFiles,
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
