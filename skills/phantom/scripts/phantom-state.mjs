#!/usr/bin/env node
// Author: Subash Karki

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import {
  atomicWriteJson,
  currentSessionFile,
  envelope,
  isMainModule,
  now,
  parseArgs,
  readJson,
  sessionPaths,
  workspacePath,
} from './lib/portable.mjs';
import {
  pinAuthorityTrust,
  verifyAuthorityDecision,
  verifyCapabilityProbe,
} from './lib/authority-decision.mjs';
import { readStableJsonFile, workspaceSnapshot } from './lib/filesystem-snapshot.mjs';
import { gitMetadata } from './lib/git-metadata.mjs';
import {
  replayWorkflowSession,
  workflowPaths,
} from './lib/workflow-journal.mjs';
import { BUNDLE_VERSION, resolveProfile } from './resolve-profile.mjs';
import {
  delegationTaskDigest,
  validateDecisionContract,
  validateDelegationResultContract,
  validateDelegationTaskContract,
} from './lib/decision-contracts.mjs';
import {
  defectProofErrors,
  resolveWorkKind,
} from './lib/defect-proof.mjs';

const ROUTES = new Set(['direct', 'plan', 'brainstorm', 'full']);
const ROUTE_APPROVALS = {
  direct: [],
  plan: ['plan'],
  brainstorm: ['direction', 'plan'],
  full: ['direction', 'plan', 'wiring'],
};
const APPROVAL_GATES = new Set(['direction', 'plan', 'wiring']);
const APPROVAL_ARTIFACTS = {
  direction: ['brainstorm'],
  plan: ['plan'],
  wiring: ['plan', 'decisions'],
};
const AUTHORIZATION_SCOPES = new Set(['implementation', 'ship-draft-pr', 'tracker-comment']);
const ARTIFACT_STATUSES = new Set(['pending', 'passed', 'failed', 'blocked', 'skipped']);
const ARTIFACTS = {
  context: {},
  capabilities: {},
  brainstorm: {},
  plan: {},
  decisions: {},
  'delegation-task': { run: true },
  'delegation-result': { run: true },
  execution: { run: true, role: 'blade' },
  wrap: { run: true, role: 'warden' },
};
const DECISION_ARTIFACTS = new Set(['brainstorm', 'plan', 'decisions']);
const MODEL_PROFILES = new Set(['inherit', 'economy', 'balanced', 'deep', 'frontier']);
const SESSION_STATUSES = new Set(['active', 'paused', 'completed']);
const WORK_KINDS = new Set(['implementation', 'investigation']);
const LOCK_WAIT_MS = 2_000;
const LOCK_RETRY_MS = 10;
const STALE_LOCK_MS = 5 * 60_000;
const lockWaiter = new Int32Array(new SharedArrayBuffer(4));
const BRANCH_NAME = /^(?!\/|.*(?:\.\.|@\{|\\|\s|~|\^|:|\?|\*|\[))(?!.*\/$)(?!.*\.lock$)[A-Za-z0-9._\/-]+$/;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function durableWriteJson(file, value) {
  atomicWriteJson(file, value);
  fsyncDirectory(dirname(file));
}

function durableUnlink(file) {
  try {
    unlinkSync(file);
    fsyncDirectory(dirname(file));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function durableRename(from, to) {
  renameSync(from, to);
  fsyncDirectory(dirname(from));
  if (dirname(to) !== dirname(from)) fsyncDirectory(dirname(to));
}

function emptyDecision() {
  return { status: 'pending', decided_at: null };
}

function newLifecycle(mode) {
  return {
    mode,
    approvals: {
      direction: emptyDecision(),
      plan: emptyDecision(),
      wiring: emptyDecision(),
    },
    authorizations: {
      implementation: emptyDecision(),
      'ship-draft-pr': emptyDecision(),
      'tracker-comment': emptyDecision(),
    },
    actions: {
      execute: emptyDecision(),
      ship: emptyDecision(),
    },
  };
}

function isTimestamp(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

function decisionErrors(value, label, allowedStatuses) {
  if (!isObject(value)) return [`${label} must be an object`];
  const errors = [];
  if (!allowedStatuses.includes(value.status)) {
    errors.push(`${label}.status must be ${allowedStatuses.join('|')}`);
  }
  if (value.status === 'pending') {
    if (value.decided_at !== null) errors.push(`${label}.decided_at must be null while pending`);
  } else if (!isTimestamp(value.decided_at)) {
    errors.push(`${label}.decided_at must be an ISO timestamp after a decision`);
  }
  return errors;
}

function lifecycleErrors(lifecycle) {
  if (!isObject(lifecycle)) return ['session.lifecycle must be an object'];
  const errors = [];
  if (!['standard', 'to-plan'].includes(lifecycle.mode)) {
    errors.push('session.lifecycle.mode must be standard|to-plan');
  }
  for (const [group, decisions] of [
    ['approvals', {
      direction: ['pending', 'approved'],
      plan: ['pending', 'approved'],
      wiring: ['pending', 'approved'],
    }],
    ['authorizations', {
      implementation: ['pending', 'authorized'],
      'ship-draft-pr': ['pending', 'authorized'],
      'tracker-comment': ['pending', 'authorized'],
    }],
    ['actions', {
      execute: ['pending', 'started'],
      ship: ['pending', 'ready'],
    }],
  ]) {
    if (!isObject(lifecycle[group])) {
      errors.push(`session.lifecycle.${group} must be an object`);
      continue;
    }
    const expectedNames = new Set(Object.keys(decisions));
    for (const name of Object.keys(lifecycle[group])) {
      if (!expectedNames.has(name)) errors.push(`session.lifecycle.${group}.${name} is unsupported`);
    }
    for (const [name, statuses] of Object.entries(decisions)) {
      errors.push(...decisionErrors(
        lifecycle[group][name],
        `session.lifecycle.${group}.${name}`,
        statuses,
      ));
    }
  }
  return errors;
}

function authorityTrustErrors(value) {
  if (value === null) return [];
  if (!isObject(value)) return ['session.authority_trust must be null or an object'];
  const errors = [];
  const fields = new Set(['schema_version', 'key_id', 'source', 'public_key_digest']);
  if (value.schema_version !== 1) errors.push('session.authority_trust.schema_version must be 1');
  for (const field of ['key_id', 'source']) {
    if (typeof value[field] !== 'string' || !value[field].trim()) {
      errors.push(`session.authority_trust.${field} must be a non-empty string`);
    }
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(value.public_key_digest || '')) {
    errors.push('session.authority_trust.public_key_digest must be a SHA-256 digest');
  }
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) errors.push(`session.authority_trust.${field} is unsupported`);
  }
  return errors;
}

function authorityHistoryErrors(value) {
  if (!Array.isArray(value)) return ['session.authority_decisions must be an array'];
  const errors = [];
  const replayIds = new Set();
  const sourceEventIds = new Set();
  value.forEach((entry, index) => {
    const label = `session.authority_decisions[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${label} must be an object`);
      return;
    }
    for (const field of ['decision_digest', 'actor', 'source', 'source_event_id', 'replay_id', 'key_id']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) errors.push(`${label}.${field} is required`);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(entry.decision_digest || '')) {
      errors.push(`${label}.decision_digest must be a SHA-256 digest`);
    }
    if (replayIds.has(entry.replay_id)) errors.push(`${label}.replay_id is duplicated`);
    if (sourceEventIds.has(entry.source_event_id)) errors.push(`${label}.source_event_id is duplicated`);
    replayIds.add(entry.replay_id);
    sourceEventIds.add(entry.source_event_id);
  });
  return errors;
}

function canonicalLifecycle(lifecycle) {
  throwStateErrors(lifecycleErrors(lifecycle));
  return structuredClone(lifecycle);
}

function envelopeErrors(value, type, paths) {
  if (!isObject(value)) return [`${type}.json must be an object`];
  const errors = [];
  if (value.schema_version !== 1) errors.push(`${type}.json schema_version must be 1`);
  if (value.artifact_type !== type) errors.push(`${type}.json artifact_type must be ${type}`);
  if (value.repo_id !== paths.repo.id) errors.push(`${type}.json repo_id must match the workspace`);
  if (value.task_id !== paths.task) errors.push(`${type}.json task_id must match the pointer`);
  if (!isTimestamp(value.created_at)) errors.push(`${type}.json created_at must be an ISO timestamp`);
  if (!isTimestamp(value.updated_at)) errors.push(`${type}.json updated_at must be an ISO timestamp`);
  if (!isObject(value.producer)) errors.push(`${type}.json producer must be an object`);
  return errors;
}

function pointerErrors(pointer, paths) {
  if (!isObject(pointer)) return ['current-session pointer must be an object'];
  const errors = [];
  if (pointer.schema_version !== 1) errors.push('current-session pointer schema_version must be 1');
  if (pointer.repo_id !== paths.repo.id) errors.push('current-session pointer repo_id must match the workspace');
  if (pointer.task_id !== paths.task) errors.push('current-session pointer task_id must be canonical');
  if (pointer.status !== undefined && pointer.status !== 'completed') {
    errors.push('current-session pointer status must be omitted or completed');
  }
  const expectedDirectory = pointer.status === 'completed' ? paths.completedDir : paths.sessionDir;
  if (pointer.session_dir !== expectedDirectory) {
    errors.push(`current-session pointer session_dir must be ${expectedDirectory}`);
  }
  if (!isTimestamp(pointer.updated_at)) errors.push('current-session pointer updated_at must be an ISO timestamp');
  return errors;
}

function sessionErrors(session, paths, pointer) {
  const errors = envelopeErrors(session, 'session', paths);
  if (!isObject(session)) return errors;
  if (session.bundle_version !== BUNDLE_VERSION) {
    errors.push(`session.json bundle_version must be ${BUNDLE_VERSION}`);
  }
  if (session.workspace !== paths.repo.root) errors.push('session.json workspace must match the canonical workspace');
  if (!SESSION_STATUSES.has(session.status)) errors.push('session.json status must be active|paused|completed');
  if ((pointer.status === 'completed') !== (session.status === 'completed')) {
    errors.push('session.json completion status must match the current-session pointer');
  }
  if (!ROUTES.has(session.route)) errors.push('session.json route must be direct|plan|brainstorm|full');
  if (typeof session.intent_summary !== 'string' || !session.intent_summary.trim()) {
    errors.push('session.json intent_summary must be a non-empty string');
  }
  if (!WORK_KINDS.has(session.work_kind)) {
    errors.push('session.json work_kind must be implementation|investigation');
  }
  if (Object.hasOwn(session, 'mode')) errors.push('session.json top-level mode is unsupported; use lifecycle.mode');
  if (Object.hasOwn(session, 'to_plan')) errors.push('session.json top-level to_plan is unsupported; use lifecycle.mode');
  errors.push(...lifecycleErrors(session.lifecycle));
  errors.push(...authorityTrustErrors(session.authority_trust));
  errors.push(...authorityHistoryErrors(session.authority_decisions));
  return errors;
}

function intentErrors(intent, paths, session) {
  const errors = envelopeErrors(intent, 'intent', paths);
  if (!isObject(intent)) return errors;
  if (intent.bundle_version !== BUNDLE_VERSION) {
    errors.push(`intent.json bundle_version must be ${BUNDLE_VERSION}`);
  }
  if (intent.status !== 'active') errors.push('intent.json status must be active');
  if (typeof intent.summary !== 'string' || !intent.summary.trim()) {
    errors.push('intent.json summary must be a non-empty string');
  } else if (intent.summary.trim() !== session.intent_summary.trim()) {
    errors.push('intent.json summary must match session intent_summary');
  }
  if (intent.route !== session.route) errors.push('intent.json route must match session route');
  if (!WORK_KINDS.has(intent.work_kind)) {
    errors.push('intent.json work_kind must be implementation|investigation');
  } else if (intent.work_kind !== session.work_kind) {
    errors.push('intent.json work_kind must match session work_kind');
  }
  return errors;
}

function throwStateErrors(errors) {
  if (errors.length) throw new Error(`Noncanonical Phantom state: ${errors.join('; ')}.`);
}

function granted(decision) {
  return decision?.status === 'approved' || decision?.status === 'authorized';
}

export function worktreeFingerprint(workspace) {
  return workspaceSnapshot(workspace).digest;
}

export function protectedBranches(workspace) {
  const configured = String(process.env.PHANTOM_PROTECTED_BRANCHES || '')
    .split(/[\s,]+/)
    .map((branch) => branch.trim())
    .filter(Boolean);
  const originHead = gitMetadata(workspace).origin_head;
  const branches = ['main', 'master', 'develop', originHead, ...configured].filter(Boolean);
  for (const branch of branches) {
    if (!BRANCH_NAME.test(branch)) {
      throw new Error(`Invalid protected branch name: ${branch}`);
    }
  }
  return [...new Set(branches)].sort();
}

export function branchPolicyContext(workspace) {
  return {
    current_branch: gitMetadata(workspace).current_branch,
    protected_branches: protectedBranches(workspace),
  };
}

export function assertFeatureBranch(workspace, action = 'mutate the workspace') {
  const policy = branchPolicyContext(workspace);
  if (!policy.current_branch) {
    throw new Error(`Cannot ${action}: Git is unavailable or HEAD is detached; a named feature branch is required.`);
  }
  if (policy.protected_branches.includes(policy.current_branch)) {
    throw new Error(
      `Cannot ${action}: ${policy.current_branch} is a protected branch. Create and select a feature branch first.`,
    );
  }
  return policy;
}

function isWithin(root, candidate) {
  const offset = relative(root, candidate);
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset));
}

function isPortablePath(value) {
  return typeof value === 'string'
    && value.trim() !== ''
    && !value.includes('\\')
    && !isAbsolute(value)
    && !/^[A-Za-z]:/.test(value)
    && value !== '.'
    && posix.normalize(value) === value
    && !value.split('/').includes('..');
}

function nearestExistingParent(candidate) {
  let current = candidate;
  while (!existsSync(current) && current !== dirname(current)) current = dirname(current);
  return current;
}

function validateContextReferences(payload, current) {
  const errors = [];
  if (!Array.isArray(payload.context_refs)) return errors;
  payload.context_refs.forEach((reference, index) => {
    const label = `task.context_refs[${index}]`;
    if (!isObject(reference) || !isPortablePath(reference.locator)) return;
    const base = reference.source === 'session'
      ? current.paths.sessionDir
      : current.paths.repo.root;
    let root;
    try {
      root = resolve(base);
      const candidate = resolve(root, reference.locator);
      if (!isWithin(root, candidate)) {
        errors.push(`${label}.locator: path resolves outside its ${reference.source} root`);
        return;
      }
      if (!existsSync(candidate)) {
        errors.push(`${label}.locator: referenced file does not exist`);
        return;
      }
      if (!statSync(candidate).isFile()) {
        errors.push(`${label}.locator: referenced path must be a file`);
        return;
      }
      const resolvedCandidate = resolve(realpathSync(candidate));
      const resolvedRoot = resolve(realpathSync(root));
      if (!isWithin(resolvedRoot, resolvedCandidate)) {
        errors.push(`${label}.locator: symlink resolves outside its ${reference.source} root`);
        return;
      }
      const digest = createHash('sha256').update(readFileSync(candidate)).digest('hex');
      if (digest !== reference.content_sha256) {
        errors.push(`${label}.content_sha256: does not match the referenced file bytes`);
      }
    } catch {
      errors.push(`${label}.locator: referenced file cannot be resolved`);
    }
  });
  return errors;
}

function validateChangedPaths(payload, task, workspace) {
  if (
    payload.contract_version !== 2
    || payload.status !== 'ok'
    || !Array.isArray(payload.output?.files_changed)
    || !Array.isArray(task.write_scope)
  ) return [];
  const errors = [];
  const root = resolve(realpathSync(workspace));
  const scopes = task.write_scope.filter(isPortablePath);
  payload.output.files_changed.forEach((value, index) => {
    const label = `result.output.files_changed[${index}]`;
    if (!isPortablePath(value)) {
      errors.push(`${label}: must be a normalized workspace-relative path`);
      return;
    }
    if (!scopes.some((scope) => value === scope || value.startsWith(`${scope}/`))) {
      errors.push(`${label}: path is outside task.write_scope`);
      return;
    }
    const candidate = resolve(root, value);
    if (!isWithin(root, candidate)) {
      errors.push(`${label}: path resolves outside the workspace`);
      return;
    }
    const existing = nearestExistingParent(candidate);
    try {
      if (!isWithin(root, resolve(realpathSync(existing)))) {
        errors.push(`${label}: nearest existing parent resolves outside the workspace`);
      }
    } catch {
      errors.push(`${label}: nearest existing parent cannot be resolved`);
    }
  });
  return errors;
}

function lockFile(workspace) {
  const paths = sessionPaths(workspace, 'lock');
  return join(paths.root, 'locks', `${paths.repo.id}.lock`);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function lockIsStale(file) {
  try {
    const owner = JSON.parse(readFileSync(file, 'utf8'));
    if (Number.isInteger(owner.pid) && owner.pid > 0) return !processIsAlive(owner.pid);
  } catch (error) {
    if (error.code === 'ENOENT') return true;
  }

  try {
    return Date.now() - statSync(file).mtimeMs >= STALE_LOCK_MS;
  } catch (error) {
    return error.code === 'ENOENT';
  }
}

function recoverStaleLock(file) {
  const recoveryFile = `${file}.recovery`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSync(recoveryFile, 'wx', 0o600);
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, created_at: now() })}\n`, 'utf8');
      closeSync(descriptor);
      descriptor = undefined;
      break;
    } catch (error) {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        try { unlinkSync(recoveryFile); } catch {}
      }
      if (error.code !== 'EEXIST') throw error;
      if (attempt > 0 || !lockIsStale(recoveryFile)) return false;
      try { unlinkSync(recoveryFile); } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      }
    }
  }

  try {
    if (lockIsStale(file)) {
      try { unlinkSync(file); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return true;
  } finally {
    try { unlinkSync(recoveryFile); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function acquireLifecycleLock(workspace) {
  const file = lockFile(workspace);
  const token = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  mkdirSync(dirname(file), { recursive: true });

  while (true) {
    let descriptor;
    try {
      descriptor = openSync(file, 'wx', 0o600);
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token, created_at: now() })}\n`, 'utf8');
      closeSync(descriptor);
      descriptor = undefined;
      return { file, token };
    } catch (error) {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        try { unlinkSync(file); } catch {}
      }
      if (error.code !== 'EEXIST') throw error;
      if (lockIsStale(file) && recoverStaleLock(file)) continue;
      if (Date.now() >= deadline) {
        throw new Error('Another Phantom lifecycle mutation is already in progress for this repository.');
      }
      Atomics.wait(lockWaiter, 0, 0, LOCK_RETRY_MS);
    }
  }
}

function releaseLifecycleLock(lock) {
  try {
    const owner = JSON.parse(readFileSync(lock.file, 'utf8'));
    if (owner.token === lock.token) unlinkSync(lock.file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function stateTransactionFile(workspace) {
  const paths = sessionPaths(workspace, 'transaction');
  return join(paths.root, 'state', 'transactions', `${paths.repo.id}.json`);
}

function assertTransactionPath(root, file) {
  const candidate = resolve(file);
  if (!isWithin(resolve(root), candidate)) {
    throw new Error(`State transaction target is outside the Phantom data root: ${file}`);
  }
  return candidate;
}

function restoreTransactionSnapshot(snapshot) {
  if (snapshot.existed) durableWriteJson(snapshot.file, snapshot.value);
  else durableUnlink(snapshot.file);
}

function rollbackStateTransaction(workspace, transaction) {
  const root = sessionPaths(workspace, 'transaction').root;
  if (!isObject(transaction)
    || transaction.schema_version !== 1
    || !Array.isArray(transaction.snapshots)) {
    throw new Error('State transaction journal is malformed; refusing unsafe recovery.');
  }
  if (transaction.rename !== null) {
    if (!isObject(transaction.rename)) throw new Error('State transaction rename is malformed.');
    const from = assertTransactionPath(root, transaction.rename.from);
    const to = assertTransactionPath(root, transaction.rename.to);
    if (existsSync(to) && !existsSync(from)) durableRename(to, from);
    else if (existsSync(to) && existsSync(from)) {
      throw new Error('State transaction recovery found both rename endpoints; manual recovery is required.');
    } else if (!existsSync(from)) {
      throw new Error('State transaction recovery found neither rename endpoint; manual recovery is required.');
    }
  }
  for (const snapshot of transaction.snapshots) {
    if (!isObject(snapshot) || typeof snapshot.file !== 'string' || typeof snapshot.existed !== 'boolean') {
      throw new Error('State transaction snapshot is malformed; refusing unsafe recovery.');
    }
    snapshot.file = assertTransactionPath(root, snapshot.file);
    restoreTransactionSnapshot(snapshot);
  }
}

function recoverStateTransaction(workspace) {
  const file = stateTransactionFile(workspace);
  const transaction = readJson(file);
  if (!transaction) return false;
  rollbackStateTransaction(workspace, transaction);
  durableUnlink(file);
  return true;
}

function runStateTransaction(workspace, operation, files, action, rename = null) {
  const file = stateTransactionFile(workspace);
  if (existsSync(file)) {
    throw new Error('An unrecovered Phantom state transaction already exists.');
  }
  const root = sessionPaths(workspace, 'transaction').root;
  const snapshots = files.map((candidate) => {
    const target = assertTransactionPath(root, candidate);
    const existed = existsSync(target);
    return { file: target, existed, value: existed ? readJson(target) : null };
  });
  const transaction = {
    schema_version: 1,
    operation,
    created_at: now(),
    snapshots,
    rename: rename === null ? null : {
      from: assertTransactionPath(root, rename.from),
      to: assertTransactionPath(root, rename.to),
    },
  };
  durableWriteJson(file, transaction);
  try {
    const result = action();
    durableUnlink(file);
    return result;
  } catch (error) {
    try {
      rollbackStateTransaction(workspace, transaction);
      durableUnlink(file);
    } catch (rollbackError) {
      throw new Error(`${error.message} State rollback failed: ${rollbackError.message}`);
    }
    throw error;
  }
}

function withLifecycleLock(workspace, action) {
  const lock = acquireLifecycleLock(workspace);
  try {
    recoverStateTransaction(workspace);
    return action();
  } finally {
    releaseLifecycleLock(lock);
  }
}

function currentSession(workspace) {
  const pointerFile = currentSessionFile(workspace);
  if (!existsSync(pointerFile)) return null;
  const pointer = readJson(pointerFile);
  if (!isObject(pointer) || typeof pointer.task_id !== 'string' || !pointer.task_id.trim()) {
    throwStateErrors(['current-session pointer task_id must be a non-empty string']);
  }
  const paths = sessionPaths(workspace, pointer.task_id);
  throwStateErrors(pointerErrors(pointer, paths));
  paths.sessionDir = pointer.session_dir;
  const session = readJson(join(paths.sessionDir, 'session.json'));
  throwStateErrors(sessionErrors(session, paths, pointer));
  const intent = readJson(join(paths.sessionDir, 'intent.json'));
  throwStateErrors(intentErrors(intent, paths, session));
  return { paths, pointer, session, intent };
}

function requireCurrent(workspace) {
  const current = currentSession(workspace);
  if (!current) throw new Error('No active Phantom session for this workspace.');
  if (current.session.status === 'completed') throw new Error('The current Phantom session is already completed.');
  return current;
}

export function workflowControlContext(workspaceInput) {
  const workspace = workspacePath(workspaceInput);
  const current = currentSession(workspace);
  if (!current || current.session.status === 'completed') return null;
  return {
    workspace,
    task: current.paths.task,
    dataRoot: current.paths.root,
    sessionDir: current.paths.sessionDir,
    status: current.session.status,
    route: current.session.route,
  };
}

function start(workspace, args) {
  if (!args.task || !args.intent || !args.route) {
    throw new Error('start requires --task, --intent, and --route.');
  }
  const requestedWorkKind = resolveWorkKind(args['work-kind'], args.intent);
  const route = args.route;
  if (!ROUTES.has(route)) {
    throw new Error(`Unsupported route: ${route}`);
  }
  if (args['to-plan'] !== undefined) {
    throw new Error('Unsupported --to-plan flag. Use --mode to-plan.');
  }
  if (args.mode !== undefined && !['standard', 'to-plan'].includes(args.mode)) {
    throw new Error('Unsupported mode. Use --mode standard or --mode to-plan.');
  }
  const requestedMode = args.mode === 'to-plan' ? 'to-plan' : 'standard';
  const paths = sessionPaths(workspace, args.task);
  const authorityTrust = pinAuthorityTrust(workspace);
  const current = currentSession(workspace);
  if (current && current.session.status !== 'completed' && current.paths.task !== paths.task) {
    throw new Error(
      `Cannot start task ${paths.task} while current task ${current.paths.task} is ${current.session.status}. `
      + 'Complete the current task before starting another one.',
    );
  }
  mkdirSync(paths.sessionDir, { recursive: true });
  mkdirSync(join(paths.sessionDir, 'control-inputs'), { recursive: true });
  mkdirSync(join(paths.sessionDir, 'control-inputs', '.claims'), { recursive: true });
  const existing = readJson(join(paths.sessionDir, 'session.json'));
  if (existing) {
    if (!current || current.paths.task !== paths.task || current.paths.sessionDir !== paths.sessionDir) {
      throw new Error(
        `Cannot resume task ${paths.task}: its session is not selected by a canonical current-session pointer.`,
      );
    }
    if (existing.work_kind !== requestedWorkKind) {
      throw new Error(
        `Cannot change work kind for active task ${paths.task} from `
        + `${existing.work_kind} to ${requestedWorkKind}.`,
      );
    }
    if (existing.route !== route) {
      throw new Error(
        `Cannot change route for active task ${paths.task} from ${existing.route} to ${route}. `
        + 'Record the change as a revision, or complete this session and restart with a new task id.',
      );
    }
    if (existing.intent_summary.trim() !== args.intent.trim()) {
      throw new Error(
        `Cannot change material intent for active task ${paths.task}. `
        + 'Record the changed intent as a revision, or complete this session and restart with a new task id.',
      );
    }
  }
  const session = existing || envelope('session', paths, 'active', {
    bundle_version: BUNDLE_VERSION,
    workspace: paths.repo.root,
    route,
    intent_summary: args.intent,
    authority_trust: authorityTrust,
    authority_decisions: [],
  });
  session.bundle_version = BUNDLE_VERSION;
  session.status = 'active';
  session.route = route;
  session.work_kind = requestedWorkKind;
  session.lifecycle = existing ? canonicalLifecycle(existing.lifecycle) : newLifecycle(requestedMode);
  session.authority_trust = existing?.authority_trust ?? authorityTrust;
  session.authority_decisions = existing?.authority_decisions ?? [];
  session.intent_summary = existing?.intent_summary ?? args.intent;
  session.updated_at = now();
  const sessionFile = join(paths.sessionDir, 'session.json');
  const intentFile = join(paths.sessionDir, 'intent.json');
  const intent = envelope('intent', paths, 'active', {
    bundle_version: BUNDLE_VERSION,
    summary: session.intent_summary,
    route: session.route,
    work_kind: session.work_kind,
  });
  const pointer = {
    schema_version: 1,
    repo_id: paths.repo.id,
    task_id: paths.task,
    session_dir: paths.sessionDir,
    updated_at: now(),
  };
  return runStateTransaction(
    workspace,
    'start',
    [sessionFile, intentFile, paths.currentFile],
    () => {
      durableWriteJson(sessionFile, session);
      durableWriteJson(intentFile, intent);
      durableWriteJson(paths.currentFile, pointer);
      return session;
    },
  );
}

function status(workspace) {
  const current = currentSession(workspace);
  return current?.session || { schema_version: 1, status: 'none', workspace };
}

function fingerprint(workspace) {
  return {
    schema_version: 1,
    workspace,
    worktree_fingerprint: worktreeFingerprint(workspace),
  };
}

function updateStatus(workspace, nextStatus, extra = {}, current = requireCurrent(workspace)) {
  const session = {
    ...current.session,
    ...extra,
    lifecycle: canonicalLifecycle(extra.lifecycle ?? current.session.lifecycle),
    bundle_version: BUNDLE_VERSION,
    status: nextStatus,
    updated_at: now(),
  };
  const sessionFile = join(current.paths.sessionDir, 'session.json');
  return runStateTransaction(
    workspace,
    'update-status',
    [sessionFile, current.paths.currentFile],
    () => {
      durableWriteJson(sessionFile, session);
      durableWriteJson(current.paths.currentFile, { ...current.pointer, updated_at: now() });
      return session;
    },
  );
}

function requireStandardMode(current, action) {
  if (current.session.lifecycle.mode === 'to-plan') {
    throw new Error(
      `Cannot ${action}: this session is permanently plan-only (--mode to-plan). `
      + 'Start a separate standard session when implementation or shipping is authorized.',
    );
  }
}

function missingPrerequisite(action, requirement, command) {
  throw new Error(`Cannot ${action}: ${requirement}. Run \`${command}\` first.`);
}

function artifactDigest(artifact) {
  return `sha256:${createHash('sha256').update(JSON.stringify(artifact)).digest('hex')}`;
}

function approvalArtifactErrors(type, artifact, current) {
  if (!isObject(artifact)) return [`current passed ${type} artifact is missing`];
  const errors = [];
  if (artifact.schema_version !== 1) errors.push(`${type} artifact has an unsupported schema version`);
  if (artifact.artifact_type !== type) errors.push(`${type} artifact type does not match`);
  if (artifact.repo_id !== current.paths.repo.id) errors.push(`${type} artifact belongs to another repository`);
  if (artifact.task_id !== current.paths.task) errors.push(`${type} artifact belongs to another task`);
  if (artifact.status !== 'passed') errors.push(`${type} artifact is not passed`);
  if (!Number.isInteger(artifact.record_sequence) || artifact.record_sequence < 1) {
    errors.push(`${type} artifact has no stable record sequence`);
  }
  if (['brainstorm', 'plan'].includes(type)) {
    errors.push(...validateDecisionContract(type, artifact.evidence, {
      workspace: current.paths.repo.root,
    }));
  }
  return errors;
}

function currentApprovalBindings(current, gate, action) {
  const bindings = [];
  for (const type of APPROVAL_ARTIFACTS[gate]) {
    const artifact = readJson(join(current.paths.sessionDir, `${type}.json`));
    const errors = approvalArtifactErrors(type, artifact, current);
    if (errors.length) {
      throw new Error(
        `Cannot ${action}: ${errors.join('; ')}. `
        + `Record a fresh passed ${type} artifact, then approve ${gate} again.`,
      );
    }
    bindings.push({
      artifact_type: type,
      record_sequence: artifact.record_sequence,
      digest: artifactDigest(artifact),
    });
  }
  return bindings;
}

function signedApprovalBindings(current, gates, action) {
  return gates.flatMap((gate) => currentApprovalBindings(current, gate, action)
    .map((binding) => ({ gate, ...binding })))
    .sort((left, right) => canonicalJsonValue(left).localeCompare(canonicalJsonValue(right)));
}

function authorityDecisionInput(args, action) {
  if (args.by !== undefined) {
    throw new Error(`${action} does not accept caller-controlled --by identity.`);
  }
  if (!args.decision || args.decision === true) {
    throw new Error(`${action} requires --decision <signed-authority-decision.json>.`);
  }
  return readStableJsonFile(resolve(args.decision)).value;
}

function consumedAuthorityIds(current) {
  const history = current.session.authority_decisions || [];
  return {
    usedReplayIds: history.map((entry) => entry.replay_id),
    usedSourceEventIds: history.map((entry) => entry.source_event_id),
  };
}

function appendAuthorityHistory(session, kind, target, record) {
  return [
    ...(session.authority_decisions || []),
    {
      decision_kind: kind,
      target,
      decided_at: now(),
      ...record,
    },
  ];
}

function requireCurrentApproval(current, gate, action) {
  const approval = current.session.lifecycle.approvals[gate];
  if (!granted(approval)) {
    missingPrerequisite(
      action,
      `${gate} approval is missing for route ${current.session.route}`,
      `phantom-state.mjs approve --gate ${gate} --decision <signed.json> --workspace <path>`,
    );
  }
  if (!Array.isArray(approval.artifact_bindings)) {
    throw new Error(
      `Cannot ${action}: ${gate} approval has no artifact binding and cannot be safely recovered. `
      + `Record a fresh passed ${APPROVAL_ARTIFACTS[gate].join(' and ')} artifact, `
      + `then run \`phantom-state.mjs approve --gate ${gate} --decision <signed.json> --workspace <path>\` again.`,
    );
  }
  const currentBindings = currentApprovalBindings(current, gate, action);
  if (JSON.stringify(approval.artifact_bindings) !== JSON.stringify(currentBindings)) {
    throw new Error(
      `Cannot ${action}: ${gate} approval is stale for the current passed artifact. `
      + `Review it and run \`phantom-state.mjs approve --gate ${gate} --decision <signed.json> --workspace <path>\` again.`,
    );
  }
}

function requireCurrentAuthorization(current, scope, action, fingerprint) {
  const authorization = current.session.lifecycle.authorizations[scope];
  const label = scope === 'ship-draft-pr' ? 'draft-PR shipping' : scope;
  if (!granted(authorization)) {
    missingPrerequisite(
      action,
      `${label} authorization is missing`,
      `phantom-state.mjs authorize --scope ${scope} --decision <signed.json> --workspace <path>`,
    );
  }
  if (!isObject(authorization.authority)
    || authorization.authority.worktree_fingerprint !== fingerprint) {
    throw new Error(
      `Cannot ${action}: ${label} authorization is missing a current signed fingerprint binding. `
      + `Run \`phantom-state.mjs authorize --scope ${scope} --decision <signed.json> --workspace <path>\` again.`,
    );
  }
  const expectedBindings = signedApprovalBindings(
    current,
    ROUTE_APPROVALS[current.session.route],
    action,
  );
  if (canonicalJsonValue(authorization.authority.approval_artifact_bindings)
    !== canonicalJsonValue(expectedBindings)) {
    throw new Error(`Cannot ${action}: ${scope} authorization has stale approval artifact bindings.`);
  }
  const trust = current.session.authority_trust;
  if (!isObject(trust)
    || authorization.authority.key_id !== trust.key_id
    || authorization.authority.source !== trust.source) {
    throw new Error(`Cannot ${action}: ${scope} authorization no longer matches the session-pinned host trust.`);
  }
  const expiresAt = Date.parse(authorization.authority.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error(`Cannot ${action}: ${scope} authorization is expired; obtain a fresh signed decision.`);
  }
  const decisions = current.session.authority_decisions.filter((entry) =>
    entry.decision_kind === 'authorization' && entry.target === scope);
  const latest = decisions.at(-1);
  if (!isObject(latest)) {
    throw new Error(`Cannot ${action}: ${scope} authorization has no consumed authority-history record.`);
  }
  for (const [field, value] of Object.entries(authorization.authority)) {
    if (canonicalJsonValue(latest[field]) !== canonicalJsonValue(value)) {
      throw new Error(`Cannot ${action}: ${scope} authorization was replaced or its authority record is inconsistent.`);
    }
  }
  return authorization;
}

function currentCapabilityContext(workspaceInput, task, fingerprint, action) {
  const workspace = workspacePath(workspaceInput);
  const current = requireCurrent(workspace);
  if (current.session.status !== 'active') {
    throw new Error(`Cannot ${action}: the Phantom session is ${current.session.status}, not active.`);
  }
  if (task !== null && current.paths.task !== task) {
    throw new Error(`Cannot ${action}: requested task ${task} is not the canonical active task ${current.paths.task}.`);
  }
  const currentFingerprint = worktreeFingerprint(current.paths.repo.root);
  if (fingerprint !== null && fingerprint !== currentFingerprint) {
    throw new Error(`Cannot ${action}: the supplied worktree fingerprint is stale.`);
  }
  return { workspace, current, fingerprint: currentFingerprint };
}

export function assertCurrentLifecycleAuthorization(workspaceInput, {
  task = null,
  scope,
  fingerprint = null,
  action = 'use a consequential capability',
} = {}) {
  if (!AUTHORIZATION_SCOPES.has(scope)) {
    throw new Error('Lifecycle authorization check requires a supported scope.');
  }
  const { current, fingerprint: currentFingerprint } = currentCapabilityContext(
    workspaceInput,
    task,
    fingerprint,
    action,
  );
  const authorization = requireCurrentAuthorization(
    current,
    scope,
    action,
    currentFingerprint,
  );
  return {
    current,
    fingerprint: currentFingerprint,
    authority: structuredClone(authorization.authority),
  };
}

export function assertTrustedHostInterception(workspaceInput, {
  task = null,
  fingerprint = null,
  action = 'use native tool interception',
} = {}) {
  const { workspace, current, fingerprint: currentFingerprint } = currentCapabilityContext(
    workspaceInput,
    task,
    fingerprint,
    action,
  );
  const file = join(current.paths.sessionDir, 'capability-probe.json');
  const probe = readJson(file);
  if (probe === null) {
    throw new Error(
      `Cannot ${action}: signed host interception evidence is unavailable at ${file}.`,
    );
  }
  const verified = verifyCapabilityProbe({
    workspace,
    probe,
    pinnedTrust: current.session.authority_trust,
    repoId: current.paths.repo.id,
    taskId: current.paths.task,
    worktreeFingerprint: currentFingerprint,
  });
  return {
    current,
    fingerprint: currentFingerprint,
    probe_digest: verified.probe_digest,
    probe: structuredClone(probe),
  };
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function approve(workspace, args) {
  if (!APPROVAL_GATES.has(args.gate)) {
    throw new Error('approve requires --gate direction, --gate plan, or --gate wiring.');
  }
  const current = requireCurrent(workspace);
  const { route } = current.session;
  if (!ROUTE_APPROVALS[route]?.includes(args.gate)) {
    throw new Error(`Cannot approve ${args.gate}: route ${route} does not use that approval gate.`);
  }
  if (args.gate === 'plan' && ['brainstorm', 'full'].includes(route)
    && !granted(current.session.lifecycle.approvals.direction)) {
    missingPrerequisite('approve the plan', 'direction approval is missing',
      'phantom-state.mjs approve --gate direction --decision <signed.json> --workspace <path>');
  }
  if (args.gate === 'plan' && ['brainstorm', 'full'].includes(route)) {
    requireCurrentApproval(current, 'direction', 'approve the plan');
  }
  if (args.gate === 'wiring' && !granted(current.session.lifecycle.approvals.plan)) {
    missingPrerequisite(
      'approve wiring',
      'plan approval is missing',
      'phantom-state.mjs approve --gate plan --decision <signed.json> --workspace <path>',
    );
  }
  if (args.gate === 'wiring') requireCurrentApproval(current, 'plan', 'approve wiring');
  const artifactBindings = currentApprovalBindings(current, args.gate, `approve ${args.gate}`);
  const signedBindings = artifactBindings.map((binding) => ({ gate: args.gate, ...binding }));
  const decision = authorityDecisionInput(args, 'approve');
  const authority = verifyAuthorityDecision({
    workspace,
    decision,
    pinnedTrust: current.session.authority_trust,
    repoId: current.paths.repo.id,
    taskId: current.paths.task,
    decisionKind: 'approval',
    gate: args.gate,
    worktreeFingerprint: worktreeFingerprint(current.paths.repo.root),
    approvalArtifactBindings: signedBindings,
    ...consumedAuthorityIds(current),
  });
  const lifecycle = canonicalLifecycle(current.session.lifecycle);
  lifecycle.approvals[args.gate] = {
    status: 'approved',
    decided_at: now(),
    artifact_bindings: artifactBindings,
    authority,
  };
  return updateStatus(workspace, current.session.status, {
    lifecycle,
    authority_decisions: appendAuthorityHistory(current.session, 'approval', args.gate, authority),
  }, current);
}

function authorize(workspace, args) {
  if (!AUTHORIZATION_SCOPES.has(args.scope)) {
    throw new Error(
      'authorize requires --scope implementation, --scope ship-draft-pr, or --scope tracker-comment.',
    );
  }
  const current = requireCurrent(workspace);
  const requiredGates = ROUTE_APPROVALS[current.session.route];
  for (const gate of requiredGates) requireCurrentApproval(current, gate, `authorize ${args.scope}`);
  const approvalBindings = signedApprovalBindings(current, requiredGates, `authorize ${args.scope}`);
  const decision = authorityDecisionInput(args, 'authorize');
  const authority = verifyAuthorityDecision({
    workspace,
    decision,
    pinnedTrust: current.session.authority_trust,
    repoId: current.paths.repo.id,
    taskId: current.paths.task,
    decisionKind: 'authorization',
    scope: args.scope,
    worktreeFingerprint: worktreeFingerprint(current.paths.repo.root),
    approvalArtifactBindings: approvalBindings,
    ...consumedAuthorityIds(current),
  });
  const lifecycle = canonicalLifecycle(current.session.lifecycle);
  lifecycle.authorizations[args.scope] = {
    status: 'authorized',
    decided_at: now(),
    authority,
  };
  return updateStatus(workspace, current.session.status, {
    lifecycle,
    authority_decisions: appendAuthorityHistory(current.session, 'authorization', args.scope, authority),
  }, current);
}

function authoritativeWorkKind(current) {
  const errors = [];
  const sessionKind = resolveWorkKind(
    current.session.work_kind,
    current.session.intent_summary,
  );
  const intentKind = resolveWorkKind(current.intent.work_kind, current.intent.summary);
  if (current.session.work_kind !== sessionKind) {
    errors.push('session work_kind conflicts with defect signals in session intent_summary');
  }
  if (current.intent.work_kind !== intentKind) {
    errors.push('intent.json work_kind conflicts with defect signals in its summary');
  }
  if (sessionKind !== intentKind) {
    errors.push('session and intent.json work_kind classifications do not match');
  }
  return { errors, workKind: sessionKind };
}

function assertDefectProofCurrent(current, currentFingerprint, action) {
  const classification = authoritativeWorkKind(current);
  if (classification.errors.length) {
    throw new Error(
      `Cannot ${action}: authoritative classification artifacts are inconsistent. `
      + classification.errors.join('; '),
    );
  }
  if (classification.workKind !== 'investigation') return classification;
  const proof = readJson(join(current.paths.sessionDir, 'defect-proof.json'));
  const errors = defectProofErrors(proof, {
    repoId: current.paths.repo.id,
    taskId: current.paths.task,
    baselineFingerprint: currentFingerprint,
    sessionDir: current.paths.sessionDir,
    nowMs: Date.now(),
  });
  if (errors.length) {
    throw new Error(
      `Cannot ${action} investigation: defect proof is not ready. `
      + `${errors.join('; ')}. Preserve waiting_for_evidence/unconfirmed_defect `
      + 'and run Hound again with the missing evidence.',
    );
  }
  return classification;
}

function prepareExecute(current) {
  requireStandardMode(current, 'execute');
  const lifecycle = canonicalLifecycle(current.session.lifecycle);
  const currentFingerprint = worktreeFingerprint(current.paths.repo.root);
  assertDefectProofCurrent(current, currentFingerprint, 'execute');
  assertFeatureBranch(current.paths.repo.root, 'execute');
  const requiredApprovals = ROUTE_APPROVALS[current.session.route];
  for (const gate of requiredApprovals) {
    requireCurrentApproval(current, gate, 'execute');
  }
  requireCurrentAuthorization(current, 'implementation', 'execute', currentFingerprint);
  lifecycle.actions.execute = {
    status: 'started',
    decided_at: now(),
    worktree_fingerprint: currentFingerprint,
  };
  return lifecycle;
}

function workflowSessionBinding(current, requiredGates) {
  const planApproval = current.session.lifecycle.approvals.plan;
  const approvedPlan = requiredGates.includes('plan')
    ? planApproval.artifact_bindings.find((binding) => binding.artifact_type === 'plan')
    : null;
  if (requiredGates.includes('plan') && !approvedPlan) {
    throw new Error('Cannot compile workflow: the current plan approval has no plan artifact binding.');
  }
  return {
    repo_id: current.paths.repo.id,
    task_id: current.paths.task,
    route: current.session.route,
    approved_plan: approvedPlan ? structuredClone(approvedPlan) : null,
  };
}

export function workflowCompilationContext(workspace, { requireDefectProof = true } = {}) {
  const current = requireCurrent(workspace);
  const fingerprint = worktreeFingerprint(current.paths.repo.root);
  if (requireDefectProof) assertDefectProofCurrent(current, fingerprint, 'compile workflow for');
  const requiredGates = ROUTE_APPROVALS[current.session.route];
  for (const gate of requiredGates) requireCurrentApproval(current, gate, 'compile workflow for');
  return {
    current,
    fingerprint,
    session_binding: workflowSessionBinding(current, requiredGates),
  };
}

export function workflowStartContext(workspace) {
  const current = requireCurrent(workspace);
  const fingerprint = worktreeFingerprint(current.paths.repo.root);
  assertDefectProofCurrent(current, fingerprint, 'start workflow for');
  assertFeatureBranch(current.paths.repo.root, 'start workflow execution');
  for (const gate of ROUTE_APPROVALS[current.session.route]) {
    requireCurrentApproval(current, gate, 'start workflow execution');
  }
  requireCurrentAuthorization(current, 'implementation', 'start workflow execution', fingerprint);
  if (current.session.lifecycle.actions.execute.status !== 'started'
    || current.session.lifecycle.actions.execute.worktree_fingerprint !== fingerprint) {
    throw new Error('Cannot start workflow execution: pass the current portable execute gate first.');
  }
  return {
    current,
    fingerprint,
    session_binding: workflowSessionBinding(current, ROUTE_APPROVALS[current.session.route]),
  };
}

function execute(workspace) {
  const current = requireCurrent(workspace);
  const lifecycle = prepareExecute(current);
  return updateStatus(workspace, current.session.status, { lifecycle }, current);
}

function optionalNonnegative(value, label, integer = false) {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${label} must be a non-negative${integer ? ' integer' : ''}.`);
  }
  return parsed;
}

function modelRouting(args, requestedProfile) {
  const actualProfile = args['actual-profile'];
  if (actualProfile !== undefined && !MODEL_PROFILES.has(actualProfile)) {
    throw new Error(`Unknown actual model profile: ${actualProfile}`);
  }
  const fallbackReason = args['fallback-reason'];
  if (fallbackReason !== undefined && (typeof fallbackReason !== 'string' || !fallbackReason.trim())) {
    throw new Error('fallback-reason must be a non-empty string.');
  }
  const routing = {
    requested_profile: requestedProfile,
    actual_profile: actualProfile ?? null,
    fallback_reason: fallbackReason?.trim() || null,
    outcome: args.status,
  };
  const wallTime = optionalNonnegative(args['wall-time-ms'], 'wall-time-ms');
  const toolTurns = optionalNonnegative(args['tool-turns'], 'tool-turns', true);
  if (wallTime !== undefined) routing.wall_time_ms = wallTime;
  if (toolTurns !== undefined) routing.tool_turns = toolTurns;
  return routing;
}

function latestRecordSequence(directory) {
  if (!existsSync(directory)) return 0;
  let latest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestRecordSequence(file));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      const artifact = readJson(file);
      if (Number.isInteger(artifact?.record_sequence)) {
        latest = Math.max(latest, artifact.record_sequence);
      }
    }
  }
  return latest;
}

function restoreJson(file, value) {
  if (JSON.stringify(readJson(file)) === JSON.stringify(value)) return;
  if (value === null) {
    try {
      unlinkSync(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return;
  }
  durableWriteJson(file, value);
}

function record(workspace, args) {
  if (!args.type || !args.status) throw new Error('record requires --type and --status.');
  if (!Object.hasOwn(ARTIFACTS, args.type)) throw new Error(`Unsupported artifact type: ${args.type}`);
  if (!ARTIFACT_STATUSES.has(args.status)) throw new Error(`Unsupported artifact status: ${args.status}`);
  const current = requireCurrent(workspace);
  if (DECISION_ARTIFACTS.has(args.type)
    && existsSync(workflowPaths(current.paths.sessionDir).planFile)) {
    throw new Error(
      `Cannot record ${args.type} after workflow compilation; `
      + 'start a new session and compile its replacement workflow so decision evidence and journal authority cannot diverge.',
    );
  }
  const payload = args.input ? readStableJsonFile(resolve(args.input)).value : {};
  const runId = args.run || `run-${Date.now()}`;
  const delegatedTask = args.type === 'delegation-result'
    ? readJson(join(current.paths.sessionDir, 'runs', runId, 'delegation-task.json'))
    : null;
  if (args.type === 'delegation-result' && !delegatedTask) {
    throw new Error('Delegation result requires a task recorded under the same run.');
  }
  const delegatedTaskPayload = delegatedTask?.evidence;
  let contractErrors;
  if (args.type === 'delegation-task') {
    contractErrors = [
      ...validateDelegationTaskContract(payload),
      ...validateContextReferences(payload, current),
    ];
  } else if (args.type === 'delegation-result') {
    contractErrors = [
      ...validateDelegationResultContract(payload),
      ...(isObject(delegatedTaskPayload)
        ? validateChangedPaths(payload, delegatedTaskPayload, current.paths.repo.root)
        : []),
    ];
  } else if (['plan', 'brainstorm'].includes(args.type)) {
    contractErrors = validateDecisionContract(args.type, payload, {
      workspace: current.paths.repo.root,
    });
  } else contractErrors = [];
  if (contractErrors.length) {
    const label = args.type.startsWith('delegation-') ? `${args.type} contract` : `${args.type} decision contract`;
    throw new Error(`Invalid ${label}: ${contractErrors.join('; ')}`);
  }
  if (args.type === 'delegation-result') {
    const validOuterStatus = payload.status === 'ok'
      ? args.status === 'passed'
      : ['failed', 'blocked'].includes(args.status);
    if (!validOuterStatus) {
      throw new Error(`Delegation result status ${payload.status} is inconsistent with artifact status ${args.status}.`);
    }
    if (delegatedTaskPayload?.task_id !== payload.task_id) {
      throw new Error('Delegation result task_id must match the task recorded under the same run.');
    }
    if (delegatedTaskPayload?.contract_version !== payload.contract_version) {
      throw new Error('Delegation result contract_version must match the task recorded under the same run.');
    }
    if (delegatedTaskPayload.delegation_id !== payload.delegation_id) {
      throw new Error('Delegation result delegation_id must match the task recorded under the same run.');
    }
    if (delegationTaskDigest(delegatedTaskPayload) !== payload.task_digest) {
      throw new Error('Delegation result task_digest must match the accepted canonical task.');
    }
  }
  const role = args.role
    || (args.type === 'delegation-task' ? payload.role : delegatedTask?.producer?.role)
    || ARTIFACTS[args.type].role
    || 'apex';
  const profileOverride = args.profile
    || (args.type === 'delegation-task'
      ? payload.profile
      : delegatedTask?.model_routing?.requested_profile);
  const risk = args.type === 'delegation-task' ? payload.risk : delegatedTaskPayload?.risk;
  const profile = resolveProfile({ role, profile: profileOverride, risk }).requested_profile;
  const routing = modelRouting(args, profile);
  let lifecycle = canonicalLifecycle(current.session.lifecycle);
  if (args.type === 'execution') lifecycle = prepareExecute(current);
  const recordSequence = Math.max(
    Number.isInteger(current.session.last_record_sequence) ? current.session.last_record_sequence : 0,
    latestRecordSequence(current.paths.sessionDir),
  ) + 1;
  const stateUpdate = { last_record_sequence: recordSequence, lifecycle };
  if (['brainstorm', 'plan'].includes(args.type)) {
    if (args.type === 'brainstorm') lifecycle.approvals.direction = emptyDecision();
    lifecycle.approvals.plan = emptyDecision();
    lifecycle.approvals.wiring = emptyDecision();
  }
  if (args.type === 'decisions') lifecycle.approvals.wiring = emptyDecision();
  const artifact = envelope(args.type, current.paths, args.status, {
    bundle_version: BUNDLE_VERSION,
    record_sequence: recordSequence,
    producer: { role, compute_profile: profile },
    model_routing: routing,
    evidence: payload,
  });
  const file = ARTIFACTS[args.type].run
    ? join(current.paths.sessionDir, 'runs', runId, `${args.type}.json`)
    : join(current.paths.sessionDir, `${args.type}.json`);
  const previousArtifact = readJson(file);
  const previousSession = readJson(join(current.paths.sessionDir, 'session.json'));
  const previousPointer = readJson(current.paths.currentFile);
  durableWriteJson(file, artifact);
  try {
    updateStatus(workspace, current.session.status, stateUpdate, current);
  } catch (error) {
    const rollbackErrors = [];
    for (const [rollbackFile, value] of [
      [join(current.paths.sessionDir, 'session.json'), previousSession],
      [current.paths.currentFile, previousPointer],
      [file, previousArtifact],
    ]) {
      try {
        restoreJson(rollbackFile, value);
      } catch (rollbackError) {
        rollbackErrors.push(`${rollbackFile}: ${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length) {
      throw new Error(
        `${error.message} Record rollback was incomplete: ${rollbackErrors.join('; ')}`,
      );
    }
    throw error;
  }
  return { artifact, file };
}

function replayCurrentWorkflow(current, action) {
  let replay;
  try {
    replay = replayWorkflowSession(current.paths.sessionDir);
  } catch (error) {
    throw new Error(`Cannot ${action}: authoritative workflow replay failed: ${error.message}`);
  }
  if (replay.events.length === 0) {
    throw new Error(`Cannot ${action}: authoritative workflow journal has no accepted events.`);
  }
  const requiredGates = ROUTE_APPROVALS[current.session.route];
  for (const gate of requiredGates) requireCurrentApproval(current, gate, action);
  const expectedBinding = workflowSessionBinding(current, requiredGates);
  const binding = replay.compiled.plan.session_binding;
  if (canonicalJsonValue(binding) !== canonicalJsonValue(expectedBinding)) {
    throw new Error(
      `Cannot ${action}: compiled workflow is not bound to the current session and its current approved plan.`,
    );
  }
  const fingerprint = worktreeFingerprint(current.paths.repo.root);
  const tail = replay.events.at(-1);
  if (tail.worktree_fingerprint !== fingerprint) {
    throw new Error(`Cannot ${action}: replayed workflow evidence is stale for the current worktree.`);
  }
  return { ...replay, fingerprint };
}

function requireShipReadyWorkflow(current) {
  const replay = replayCurrentWorkflow(current, 'ship');
  const nodes = replay.compiled.plan.nodes;
  const nonExternal = nodes.filter((node) => node.kind !== 'external-action');
  const incomplete = nonExternal.filter((node) => replay.state.nodes[node.id]?.status !== 'completed');
  if (incomplete.length) {
    throw new Error(
      `Cannot ship: replayed workflow prerequisites are incomplete: ${incomplete.map((node) => node.id).join(', ')}.`,
    );
  }
  const shipping = nodes.filter((node) => node.kind === 'external-action'
    && ['git-push', 'draft-pr'].includes(node.action));
  if (shipping.length === 0) {
    throw new Error('Cannot ship: compiled workflow declares no git-push or draft-pr external action.');
  }
  const ready = shipping.filter((node) => replay.state.nodes[node.id]?.status === 'ready');
  if (ready.length === 0) {
    throw new Error('Cannot ship: no declared git-push or draft-pr node is legally ready in replayed state.');
  }
  const invalid = shipping.filter((node) => !['pending', 'ready', 'completed']
    .includes(replay.state.nodes[node.id]?.status));
  if (invalid.length) {
    throw new Error(`Cannot ship: external workflow state is not current for ${invalid.map((node) => node.id).join(', ')}.`);
  }
  return replay;
}

function ship(workspace) {
  const current = requireCurrent(workspace);
  requireStandardMode(current, 'ship');
  const lifecycle = canonicalLifecycle(current.session.lifecycle);
  const { fingerprint } = requireShipReadyWorkflow(current);
  requireCurrentAuthorization(current, 'ship-draft-pr', 'ship', fingerprint);
  lifecycle.actions.ship = {
    status: 'ready',
    decided_at: now(),
    worktree_fingerprint: fingerprint,
  };
  return updateStatus(workspace, current.session.status, { lifecycle }, current);
}

function complete(workspace) {
  const current = requireCurrent(workspace);
  const replay = replayCurrentWorkflow(current, 'complete');
  if (replay.state.status !== 'accepted') {
    throw new Error(
      `Cannot complete: replayed workflow state is ${replay.state.status}; expected accepted.`,
    );
  }
  if (existsSync(current.paths.completedDir)) {
    throw new Error(`Completed session already exists: ${current.paths.completedDir}`);
  }
  const session = {
    ...current.session,
    bundle_version: BUNDLE_VERSION,
    status: 'completed',
    completed_at: now(),
    updated_at: now(),
  };
  const sessionFile = join(current.paths.sessionDir, 'session.json');
  const completedRoot = join(current.paths.repoRoot, 'completed');
  mkdirSync(completedRoot, { recursive: true });
  fsyncDirectory(dirname(completedRoot));
  return runStateTransaction(
    workspace,
    'complete',
    [sessionFile, current.paths.currentFile],
    () => {
      durableWriteJson(sessionFile, session);
      durableRename(current.paths.sessionDir, current.paths.completedDir);
      durableWriteJson(current.paths.currentFile, {
        ...current.pointer,
        status: 'completed',
        session_dir: current.paths.completedDir,
        updated_at: now(),
      });
      return session;
    },
    { from: current.paths.sessionDir, to: current.paths.completedDir },
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const workspace = workspacePath(args.workspace);

  try {
    let result;
    if (command === 'fingerprint') result = fingerprint(workspace);
    else result = withLifecycleLock(workspace, () => {
      if (command === 'status') return status(workspace);
      if (command === 'start') return start(workspace, args);
      if (command === 'pause') return updateStatus(workspace, 'paused', { pause_reason: args.reason || 'Paused by user.' });
      if (command === 'resume') return updateStatus(workspace, 'active', { resumed_at: now() });
      if (command === 'approve') return approve(workspace, args);
      if (command === 'authorize') return authorize(workspace, args);
      if (command === 'execute') return execute(workspace);
      if (command === 'record') return record(workspace, args);
      if (command === 'ship') return ship(workspace);
      if (command === 'complete') return complete(workspace);
      throw new Error(
        'Usage: phantom-state.mjs '
        + '<start|status|fingerprint|pause|resume|approve|authorize|execute|record|ship|complete> [options]',
      );
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    fail(error.message);
  }
}

if (isMainModule(import.meta.url)) main();
