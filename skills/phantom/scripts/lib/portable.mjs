// Author: Subash Karki

import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

function gitValue(workspace, args) {
  try {
    return execFileSync('git', ['-C', workspace, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const repoIdentityCache = new Map();

export function repoIdentity(workspace) {
  const cached = repoIdentityCache.get(workspace);
  if (cached) return cached;
  const root = gitValue(workspace, ['rev-parse', '--show-toplevel']) || workspace;
  const remote = gitValue(root, ['config', '--get', 'remote.origin.url']);
  const source = remote || realpathSync(root);
  const nameSource = remote ? remote.replace(/\.git$/, '').split(/[/:]/).pop() : basename(root);
  const name = sanitizeSegment(nameSource, 'repository').toLowerCase();
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 10);
  const identity = { id: `${name}-${hash}`, root };
  repoIdentityCache.set(workspace, identity);
  return identity;
}

export function dataRoot(workspace) {
  const base = workspacePath(workspace);
  if (process.env.PHANTOM_DATA) return resolve(base, process.env.PHANTOM_DATA);
  if (process.env.HOME) return resolve(base, process.env.HOME, '.phantom');
  return join(base, '.phantom');
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
    producer: { role: 'apex', compute_profile: 'frontier' },
    ...extra,
  };
}
