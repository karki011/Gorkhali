#!/usr/bin/env node
// Author: Subash Karki

import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
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
import { BUNDLE_VERSION, resolveProfile } from './resolve-profile.mjs';
import {
  validateDecisionContract,
  validateDelegationResultContract,
  validateDelegationTaskContract,
} from './lib/decision-contracts.mjs';

const REQUIRED_GATES = ['verification', 'review'];
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
  verification: { run: true, role: 'ward' },
  review: { run: true, role: 'gaze' },
  wrap: { run: true, role: 'warden' },
};
const MODEL_PROFILES = new Set(['inherit', 'economy', 'balanced', 'deep', 'frontier']);
const LOCK_WAIT_MS = 2_000;
const LOCK_RETRY_MS = 10;
const STALE_LOCK_MS = 5 * 60_000;
const lockWaiter = new Int32Array(new SharedArrayBuffer(4));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function withLifecycleLock(workspace, action) {
  const lock = acquireLifecycleLock(workspace);
  try {
    return action();
  } finally {
    releaseLifecycleLock(lock);
  }
}

function currentSession(workspace) {
  const pointer = readJson(currentSessionFile(workspace));
  if (!pointer?.task_id) return null;
  const paths = sessionPaths(workspace, pointer.task_id);
  const sessionDirectory = pointer.session_dir || paths.sessionDir;
  const session = readJson(join(sessionDirectory, 'session.json'));
  paths.sessionDir = sessionDirectory;
  return session ? { paths, pointer, session } : null;
}

function requireCurrent(workspace) {
  const current = currentSession(workspace);
  if (!current) throw new Error('No active Phantom session for this workspace.');
  if (current.session.status === 'completed') throw new Error('The current Phantom session is already completed.');
  return current;
}

function start(workspace, args) {
  if (!args.task || !args.intent) throw new Error('start requires --task and --intent.');
  const route = args.route || 'plan';
  if (!new Set(['direct', 'plan', 'brainstorm', 'full']).has(route)) {
    throw new Error(`Unsupported route: ${route}`);
  }
  const paths = sessionPaths(workspace, args.task);
  const current = currentSession(workspace);
  if (current && current.session.status !== 'completed' && current.paths.task !== paths.task) {
    throw new Error(
      `Cannot start task ${paths.task} while current task ${current.paths.task} is ${current.session.status}. `
      + 'Complete the current task before starting another one.',
    );
  }
  mkdirSync(paths.sessionDir, { recursive: true });
  const existing = readJson(join(paths.sessionDir, 'session.json'));
  const session = existing || envelope('session', paths, 'active', {
    bundle_version: BUNDLE_VERSION,
    workspace: paths.repo.root,
    route,
    intent_summary: args.intent,
  });
  session.bundle_version = BUNDLE_VERSION;
  session.status = 'active';
  session.route = route;
  session.intent_summary = args.intent || session.intent_summary;
  session.updated_at = now();
  atomicWriteJson(join(paths.sessionDir, 'session.json'), session);
  atomicWriteJson(join(paths.sessionDir, 'intent.json'), envelope('intent', paths, 'active', {
    bundle_version: BUNDLE_VERSION,
    summary: args.intent,
    route: session.route,
  }));
  atomicWriteJson(paths.currentFile, {
    schema_version: 1,
    repo_id: paths.repo.id,
    task_id: paths.task,
    session_dir: paths.sessionDir,
    updated_at: now(),
  });
  return session;
}

function status(workspace) {
  const current = currentSession(workspace);
  return current?.session || { schema_version: 1, status: 'none', workspace };
}

function updateStatus(workspace, nextStatus, extra = {}, current = requireCurrent(workspace)) {
  const session = {
    ...current.session,
    ...extra,
    bundle_version: BUNDLE_VERSION,
    status: nextStatus,
    updated_at: now(),
  };
  atomicWriteJson(join(current.paths.sessionDir, 'session.json'), session);
  atomicWriteJson(current.paths.currentFile, { ...current.pointer, updated_at: now() });
  return session;
}

function gateEvidenceErrors(type, evidence) {
  if (!isObject(evidence)) return [`${type} evidence must be an object.`];
  if (type === 'verification') {
    if (!Array.isArray(evidence.checks) || evidence.checks.length === 0) {
      return ['Passed verification evidence requires at least one check.'];
    }
    return evidence.checks.flatMap((check, index) => {
      if (!isObject(check)) return [`Verification check ${index + 1} must be an object.`];
      const errors = [];
      if (typeof check.name !== 'string' || !check.name.trim()) {
        errors.push(`Verification check ${index + 1} requires a name.`);
      }
      if (check.result !== 'passed') {
        errors.push(`Verification check ${index + 1} must have result "passed".`);
      }
      return errors;
    });
  }
  if (type === 'review') {
    const errors = [];
    if (evidence.verdict !== 'pass') errors.push('Passed review evidence requires verdict "pass".');
    if (!Array.isArray(evidence.findings)) errors.push('Passed review evidence requires a findings array.');
    return errors;
  }
  return [];
}

function gateArtifactErrors(type, artifact, current) {
  if (!isObject(artifact)) return [`${type} artifact must be an object.`];
  const errors = [];
  if (artifact.schema_version !== 1) errors.push(`${type} artifact has an unsupported schema version.`);
  if (artifact.artifact_type !== type) errors.push(`${type} artifact type does not match its gate.`);
  if (artifact.repo_id !== current.paths.repo.id) errors.push(`${type} artifact belongs to another repository.`);
  if (artifact.task_id !== current.paths.task) errors.push(`${type} artifact belongs to another task.`);
  if (artifact.status !== 'passed') errors.push(`${type} artifact is not passed.`);
  errors.push(...gateEvidenceErrors(type, artifact.evidence));
  return errors;
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

function latestGateArtifact(runsDirectory, type) {
  let latest = null;
  for (const runId of readdirSync(runsDirectory)) {
    const file = join(runsDirectory, runId, `${type}.json`);
    const artifact = readJson(file);
    if (!artifact) continue;
    const sequence = Number.isInteger(artifact.record_sequence) ? artifact.record_sequence : 0;
    const parsedTime = Date.parse(artifact.updated_at);
    const updatedAt = Number.isFinite(parsedTime) ? parsedTime : Number.NEGATIVE_INFINITY;
    if (!latest
      || sequence > latest.sequence
      || (sequence === latest.sequence && updatedAt > latest.updatedAt)
      || (sequence === latest.sequence && updatedAt === latest.updatedAt && file > latest.file)) {
      latest = { artifact, file, sequence, updatedAt };
    }
  }
  return latest?.artifact;
}

function record(workspace, args) {
  if (!args.type || !args.status) throw new Error('record requires --type and --status.');
  if (!Object.hasOwn(ARTIFACTS, args.type)) throw new Error(`Unsupported artifact type: ${args.type}`);
  if (!ARTIFACT_STATUSES.has(args.status)) throw new Error(`Unsupported artifact status: ${args.status}`);
  const current = requireCurrent(workspace);
  const payload = args.input ? JSON.parse(readFileSync(args.input, 'utf8')) : {};
  let contractErrors;
  if (args.type === 'delegation-task') contractErrors = validateDelegationTaskContract(payload);
  else if (args.type === 'delegation-result') contractErrors = validateDelegationResultContract(payload);
  else {
    contractErrors = validateDecisionContract(args.type, payload, {
      requireV3: ['plan', 'brainstorm'].includes(args.type),
      enforceCanonicalQuick: true,
      enforceEvidenceFreshness: true,
      enforcePathProvenance: true,
      workspace: current.paths.repo.root,
    });
  }
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
  }
  if (args.status === 'passed' && REQUIRED_GATES.includes(args.type)) {
    const evidenceErrors = gateEvidenceErrors(args.type, payload);
    if (evidenceErrors.length) throw new Error(`Invalid passed ${args.type} evidence: ${evidenceErrors.join('; ')}`);
  }
  const runId = args.run || `run-${Date.now()}`;
  const delegatedTask = args.type === 'delegation-result'
    ? readJson(join(current.paths.sessionDir, 'runs', runId, 'delegation-task.json'))
    : null;
  if (args.type === 'delegation-result') {
    if (!delegatedTask) throw new Error('Delegation result requires a task recorded under the same run.');
    if (delegatedTask.evidence?.task_id !== payload.task_id) {
      throw new Error('Delegation result task_id must match the task recorded under the same run.');
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
  const profile = resolveProfile({ role, profile: profileOverride }).requested_profile;
  const routing = modelRouting(args, profile);
  const recordSequence = Number.isInteger(current.session.last_record_sequence)
    ? current.session.last_record_sequence + 1
    : 1;
  updateStatus(workspace, current.session.status, { last_record_sequence: recordSequence }, current);
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
  atomicWriteJson(file, artifact);
  return { artifact, file };
}

function complete(workspace) {
  const current = requireCurrent(workspace);
  const runsDirectory = join(current.paths.sessionDir, 'runs');
  for (const gate of REQUIRED_GATES) {
    const artifact = existsSync(runsDirectory) ? latestGateArtifact(runsDirectory, gate) : null;
    if (gateArtifactErrors(gate, artifact, current).length > 0) {
      throw new Error(`Cannot complete without a valid latest passed ${gate} artifact.`);
    }
  }
  if (existsSync(current.paths.completedDir)) {
    throw new Error(`Completed session already exists: ${current.paths.completedDir}`);
  }
  const session = updateStatus(workspace, 'completed', { completed_at: now() }, current);
  mkdirSync(join(current.paths.repoRoot, 'completed'), { recursive: true });
  renameSync(current.paths.sessionDir, current.paths.completedDir);
  atomicWriteJson(current.paths.currentFile, {
    ...current.pointer,
    status: 'completed',
    session_dir: current.paths.completedDir,
    updated_at: now(),
  });
  return session;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const workspace = workspacePath(args.workspace);

  try {
    let result;
    if (command === 'status') result = status(workspace);
    else result = withLifecycleLock(workspace, () => {
      if (command === 'start') return start(workspace, args);
      if (command === 'pause') return updateStatus(workspace, 'paused', { pause_reason: args.reason || 'Paused by user.' });
      if (command === 'resume') return updateStatus(workspace, 'active', { resumed_at: now() });
      if (command === 'record') return record(workspace, args);
      if (command === 'complete') return complete(workspace);
      throw new Error('Usage: phantom-state.mjs <start|status|pause|resume|record|complete> [options]');
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    fail(error.message);
  }
}

if (isMainModule(import.meta.url)) main();
