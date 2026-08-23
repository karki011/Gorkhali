// Author: Subash Karki

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The shared codec owns data-root and repository-id resolution so this portable
// ESM layer, the CommonJS compatibility scripts, and the shell resolver all
// agree on one root and one id for the same workspace. It ships inside the skill
// (sibling file), so the portable skill stays standalone.
const require = createRequire(import.meta.url);
const codec = require('./shared-state.cjs');

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

export function sanitizeSegment(value, fallback = 'task') {
  const sanitized = String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return sanitized || fallback;
}

export function workspacePath(value) {
  const candidate = resolve(value || process.cwd());
  return existsSync(candidate) ? realpathSync(candidate) : candidate;
}

const repoIdentityCache = new Map();

export function repoIdentity(workspace) {
  const cached = repoIdentityCache.get(workspace);
  if (cached) return cached;
  const root = codec.resolveDataRoot(workspace);
  const identity = codec.repoIdentity(workspace, {
    dataRoot: root,
    gorkhaliRepo: process.env.GORKHALI_REPO,
  });
  // Persist this repo's aliases (legacy plain name, raw-hash, codec-upgrade ids)
  // so its earlier ids stay discoverable through <data>/repos/.aliases.json.
  // Merge-only and guarded: identity resolution must never break on a write
  // failure, so fail open with the identity still returned.
  try { codec.recordAliases(root, identity); } catch { /* fail open */ }
  repoIdentityCache.set(workspace, identity);
  return identity;
}

export function dataRoot(workspace) {
  return codec.resolveDataRoot(workspace);
}

const ALIAS_ID_RE = /^[A-Za-z0-9._-]+$/;

function isPopulated(dir) {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

// Mirrors scripts/lib/gorkhali-paths.js resolveRepoSubdir, which owns the
// rationale: fresh canonical data ALWAYS wins, an aliased dir answers only when
// the canonical one is absent or empty, and a missing or malformed alias map
// degrades to the canonical path. Alias keys become path segments, so the shape
// check is enforced here, where a key reaches join().
export function resolveRepoSubdir(workspace, ...segments) {
  const root = dataRoot(workspace);
  const repo = repoIdentity(workspace).id;
  const canonical = join(root, 'repos', repo, ...segments);
  if (isPopulated(canonical)) return canonical;
  for (const [id, target] of Object.entries(codec.readAliasMap(root))) {
    if (target !== repo || id === repo || !ALIAS_ID_RE.test(id) || id === '.' || id === '..') continue;
    const candidate = join(root, 'repos', id, ...segments);
    if (isPopulated(candidate)) return candidate;
  }
  return canonical;
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
  const task = sanitizeSegment(taskId, 'task');
  const repoRoot = join(root, 'repos', repo.id);
  return {
    root,
    repo,
    task,
    repoRoot,
    sessionDir: join(repoRoot, 'sessions', task),
    completedDir: join(repoRoot, 'completed', task),
    currentFile: join(root, 'state', 'current-session', `${repo.id}.json`),
  };
}

export function now() {
  return new Date().toISOString();
}

export function envelope(type, paths, status, extra = {}) {
  const timestamp = now();
  return {
    schema_version: 1,
    artifact_type: type,
    repo_id: paths.repo.id,
    task_id: paths.task,
    status,
    created_at: timestamp,
    updated_at: timestamp,
    producer: { role: 'chief', compute_profile: 'frontier' },
    ...extra,
  };
}
