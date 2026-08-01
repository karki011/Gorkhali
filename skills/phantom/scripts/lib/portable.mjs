// Author: Subash Karki

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The shared codec owns data-root and repository-id resolution so this portable
// ESM layer, the CommonJS scripts, and the shell resolver all
// agree on one root and one id for the same workspace. It ships inside the skill
// (sibling file), so the portable skill stays standalone.
const require = createRequire(import.meta.url);
const codec = require('./shared-state.cjs');

export const STATE_ENVELOPE_VERSION = 2;

export function isMainModule(moduleUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync(argvPath) === realpathSync(modulePath);
  } catch {
    return resolve(argvPath) === resolve(modulePath);
  }
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function taskIdentity(value, fallback = 'task') {
  return codec.taskIdentity(value, fallback);
}

export function taskPathSegment(value, fallback = 'task') {
  return codec.taskPathSegment(value, fallback);
}

export function workspacePath(value) {
  const candidate = resolve(value || process.cwd());
  return existsSync(candidate) ? realpathSync(candidate) : candidate;
}

const repoIdentityCache = new Map();

export function repoIdentity(workspace) {
  const root = codec.resolveDataRoot(workspace);
  const key = `${workspace}\0${root}\0${process.env.PHANTOM_REPO || ''}`;
  const cached = repoIdentityCache.get(key);
  if (cached) return cached;
  const identity = codec.repoIdentity(workspace, {
    dataRoot: root,
    phantomRepo: process.env.PHANTOM_REPO,
  });
  repoIdentityCache.set(key, identity);
  return identity;
}

export function dataRoot(workspace) {
  return codec.resolveDataRoot(workspace);
}

// Current runtime state always lives under the canonical repository id. Explicit
// offline migrators own any discovery or consolidation of historical ids.
export function resolveRepoSubdir(workspace, ...segments) {
  const root = dataRoot(workspace);
  const repo = repoIdentity(workspace).id;
  return join(root, 'repos', repo, ...segments);
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export function atomicWriteJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, file);
}

export function currentSessionFile(workspace) {
  return join(dataRoot(workspace), 'state', 'current-session', `${repoIdentity(workspace).id}.json`);
}

export function sessionPaths(workspace, taskId) {
  const repo = repoIdentity(workspace);
  const root = dataRoot(workspace);
  const task = taskIdentity(taskId, 'task');
  const taskSegment = taskPathSegment(task);
  const repoRoot = join(root, 'repos', repo.id);
  return {
    root,
    repo,
    task,
    taskSegment,
    repoRoot,
    sessionDir: join(repoRoot, 'sessions', taskSegment),
    completedDir: join(repoRoot, 'completed', taskSegment),
    currentFile: join(root, 'state', 'current-session', `${repo.id}.json`),
  };
}

export function now() {
  return new Date().toISOString();
}

export function envelope(type, paths, status, extra = {}) {
  const timestamp = now();
  return {
    schema_version: STATE_ENVELOPE_VERSION,
    artifact_type: type,
    repo_id: paths.repo.id,
    task_id: paths.task,
    status,
    created_at: timestamp,
    updated_at: timestamp,
    producer: { role: 'apex', compute_profile: 'frontier' },
    ...extra,
  };
}
