#!/usr/bin/env node
// Author: Subash Karki

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
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
import { BUNDLE_VERSION, resolveProfile } from './resolve-profile.mjs';
import {
  canonicalDelegationJson,
  delegationTaskDigest,
  validateDecisionContract,
  validateDelegationResultContract,
  validateDelegationTaskContract,
} from './lib/decision-contracts.mjs';
import {
  correctedWorkKind,
  defectProofErrors,
  hasDefectSignal,
  resolveWorkKind,
  workKindCorrectionErrors,
} from './lib/defect-proof.mjs';

const REQUIRED_GATES = ['verification', 'review'];
const SPECIALIST_ROLES = new Set(['justice']);
const LEGACY_SURVEYOR_GATE_RECOVERY = 'Legacy Surveyor gate requirements are unsupported because optional Surveyor is advisory only. '
  + 'Record fresh verification with explicit userVerification evidence.';
const ROUTES = new Set(['lite', 'direct', 'plan', 'brainstorm', 'full']);
const ROUTE_APPROVALS = {
  lite: [],
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
const AUTHORIZATION_SCOPES = new Set(['implementation', 'ship-pr']);
// Pre-rename name for the same gate. Accepted on authorize and on read for the
// whole 0.4.x line, so a session recorded under either name authorizes once.
const LEGACY_AUTHORIZATION_SCOPES = new Map([['ship-draft-pr', 'ship-pr']]);
const ARTIFACT_STATUSES = new Set(['pending', 'passed', 'failed', 'blocked', 'skipped']);
const ARTIFACTS = {
  context: {},
  capabilities: {},
  brainstorm: {},
  plan: {},
  decisions: {},
  'delegation-task': { run: true },
  'delegation-result': { run: true },
  execution: { run: true, role: 'engineer' },
  verification: { run: true, role: 'inspector' },
  review: { run: true, role: 'auditor' },
  wrap: { run: true, role: 'clerk' },
};
const MODEL_PROFILES = new Set(['inherit', 'economy', 'balanced', 'deep', 'frontier']);
const LOCK_WAIT_MS = 2_000;
const LOCK_RETRY_MS = 10;
const STALE_LOCK_MS = 5 * 60_000;
const lockWaiter = new Int32Array(new SharedArrayBuffer(4));

function approvalsForRoute(route) {
  return Object.hasOwn(ROUTE_APPROVALS, route) ? ROUTE_APPROVALS[route] : null;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function emptyDecision() {
  return { status: 'pending', decided_at: null };
}

function canonicalScope(scope) {
  const canonical = LEGACY_AUTHORIZATION_SCOPES.get(scope) || scope;
  return AUTHORIZATION_SCOPES.has(canonical) ? canonical : null;
}

function normalizeAuthorizations(existing) {
  const authorizations = {
    implementation: emptyDecision(),
    'ship-pr': emptyDecision(),
  };
  if (!isObject(existing)) return authorizations;
  for (const [scope, decision] of Object.entries(existing)) {
    const canonical = LEGACY_AUTHORIZATION_SCOPES.get(scope) || scope;
    // A legacy-named decision folds onto the canonical gate but never downgrades
    // one already recorded under the canonical name.
    if (canonical !== scope && granted(authorizations[canonical])) continue;
    authorizations[canonical] = decision;
  }
  return authorizations;
}

function lifecycleFor(session) {
  const existing = isObject(session.lifecycle) ? session.lifecycle : {};
  const mode = existing.mode === 'to-plan' || session.mode === 'to-plan' || session.to_plan === true
    ? 'to-plan'
    : 'standard';
  return {
    mode,
    approvals: {
      direction: emptyDecision(),
      plan: emptyDecision(),
      wiring: emptyDecision(),
      ...(isObject(existing.approvals) ? existing.approvals : {}),
    },
    authorizations: normalizeAuthorizations(existing.authorizations),
    actions: {
      execute: emptyDecision(),
      verify: emptyDecision(),
      ship: emptyDecision(),
      ...(isObject(existing.actions) ? existing.actions : {}),
    },
  };
}

function granted(decision) {
  return decision?.status === 'approved' || decision?.status === 'authorized';
}

function hashFileState(hash, workspace, relativePath, gitlink = false) {
  const file = join(workspace, relativePath);
  hash.update(`path\0${relativePath}\0`);
  let metadata;
  try {
    metadata = lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') {
      hash.update('missing\0');
      return;
    }
    throw error;
  }
  hash.update(`mode\0${metadata.mode & 0o7777}\0`);
  if (metadata.isSymbolicLink()) {
    hash.update(`link\0${readlinkSync(file)}\0`);
  } else if (metadata.isFile()) {
    hash.update('file\0');
    hash.update(readFileSync(file));
  } else if (metadata.isDirectory() && gitlink) {
    hash.update(`gitlink-worktree\0${worktreeFingerprint(file)}\0`);
  } else {
    hash.update(`node\0${metadata.mode & 0o170000}\0`);
  }
}

function workspaceFiles(workspace) {
  let indexRecords = [];
  let files = [];
  let gitlinks = new Set();
  try {
    indexRecords = execFileSync(
      'git',
      ['-C', workspace, 'ls-files', '--stage', '-z'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString('utf8').split('\0').filter(Boolean).sort();
    const tracked = [];
    for (const record of indexRecords) {
      const separator = record.indexOf('\t');
      if (separator < 0) continue;
      const metadata = record.slice(0, separator).split(' ');
      const relativePath = record.slice(separator + 1);
      tracked.push(relativePath);
      if (metadata[0] === '160000') gitlinks.add(relativePath);
    }
    const untracked = execFileSync(
      'git',
      ['-C', workspace, 'ls-files', '-z', '--others', '--exclude-standard'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString('utf8').split('\0').filter(Boolean);
    files = [...new Set([...tracked, ...untracked])].sort();
  } catch {
    indexRecords = [];
    gitlinks = new Set();
    const visit = (directory, prefix = '') => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.git') continue;
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const file = join(directory, entry.name);
        if (entry.isDirectory()) visit(file, relativePath);
        else files.push(relativePath);
      }
    };
    visit(workspace);
    files.sort();
  }

  return { files, gitlinks, indexRecords };
}

export function worktreeFingerprint(workspace) {
  const hash = createHash('sha256');
  hash.update(`workspace\0${workspace}\0`);
  const { files, gitlinks, indexRecords } = workspaceFiles(workspace);
  for (const record of indexRecords) hash.update(`index\0${record}\0`);
  for (const relativePath of files) {
    hashFileState(hash, workspace, relativePath, gitlinks.has(relativePath));
  }
  return `sha256:${hash.digest('hex')}`;
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

function isPortablePathSegment(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
    && value !== '.'
    && value !== '..';
}

function nearestExistingParent(candidate) {
  let current = candidate;
  while (!existsSync(current) && current !== dirname(current)) current = dirname(current);
  return current;
}

function resolveThroughExistingParent(candidate) {
  if (existsSync(candidate)) return resolve(realpathSync(candidate));
  const parent = nearestExistingParent(candidate);
  return resolve(realpathSync(parent), relative(parent, candidate));
}

function runDirectory(current, runId) {
  if (!isPortablePathSegment(runId)) {
    throw new Error(
      'record --run must be one portable path segment using only letters, numbers, dot, underscore, or hyphen.',
    );
  }
  const sessionRoot = resolve(realpathSync(current.paths.sessionDir));
  const runsRoot = join(current.paths.sessionDir, 'runs');
  const resolvedRunsRoot = resolveThroughExistingParent(runsRoot);
  const candidate = join(runsRoot, runId);
  const resolvedCandidate = resolveThroughExistingParent(candidate);
  if (!isWithin(sessionRoot, resolvedRunsRoot) || !isWithin(resolvedRunsRoot, resolvedCandidate)) {
    throw new Error('record --run resolves outside the active session runs directory.');
  }
  return candidate;
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
        throw new Error('Another Gorkhali lifecycle mutation is already in progress for this repository.');
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
  if (!session) return null;
  if (session.schema_version !== 1) {
    throw new Error(
      `Unsupported Gorkhali session schema version: ${JSON.stringify(session.schema_version)}.`,
    );
  }
  const sessionHadWorkKind = session.work_kind !== undefined;
  session.lifecycle = lifecycleFor(session);
  if (!sessionHadWorkKind) {
    session.work_kind = resolveWorkKind(undefined, session.intent_summary);
  }
  return {
    paths,
    pointer,
    session,
    sessionHadWorkKind,
  };
}

function requireCurrent(workspace) {
  const current = currentSession(workspace);
  if (!current) throw new Error('No active Gorkhali session for this workspace.');
  if (current.session.status === 'completed') throw new Error('The current Gorkhali session is already completed.');
  return current;
}

function start(workspace, args) {
  if (!args.task || !args.intent) throw new Error('start requires --task and --intent.');
  const route = args.route || 'plan';
  // route_source records WHY the session carries this route: 'explicit' when the
  // caller passed --route, 'default' when the 'plan' fallback above applied. The
  // vocabulary is closed to 'explicit' | 'default' | 'unknown'; 'unknown' is only
  // ever assigned below, to a preserved legacy route that predates this field.
  const routeSource = args.route ? 'explicit' : 'default';
  if (!ROUTES.has(route)) {
    throw new Error(`Unsupported route: ${route}`);
  }
  if (args.mode !== undefined && !['standard', 'to-plan'].includes(args.mode)) {
    throw new Error('Unsupported mode. Use --mode standard or --mode to-plan.');
  }
  const requestedMode = args['to-plan'] === true || args.mode === 'to-plan' ? 'to-plan' : 'standard';
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
  const correction = existing?.work_kind_correction ?? null;
  const requestedWorkKind = resolveWorkKind(args['work-kind'], args.intent, correction);
  if (existing) {
    const existingWorkKind = resolveWorkKind(existing.work_kind, existing.intent_summary, correction);
    if (existingWorkKind !== requestedWorkKind) {
      throw new Error(
        `Cannot change work kind for active task ${paths.task} from `
        + `${existingWorkKind} to ${requestedWorkKind}.`,
      );
    }
    if (ROUTES.has(existing.route) && existing.route !== route) {
      throw new Error(
        `Cannot change route for active task ${paths.task} from ${existing.route} to ${route}. `
        + 'Record the change as a revision, or complete this session and restart with a new task id.',
      );
    }
    if (!existing.intent_summary) {
      throw new Error(
        `Cannot resume active task ${paths.task}: its legacy session has no immutable intent summary. `
        + 'Recover the original session metadata, or complete it and restart with a new task id.',
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
    route_source: routeSource,
    intent_summary: args.intent,
  });
  session.bundle_version = BUNDLE_VERSION;
  session.status = 'active';
  session.route = ROUTES.has(existing?.route) ? existing.route : route;
  // route is immutable on an existing active task, so its provenance is too: when
  // the existing route wins, the existing route_source wins with it. A legacy
  // session that predates route_source gets 'unknown' - whether its route was
  // chosen or defaulted is no longer attributable.
  session.route_source = ROUTES.has(existing?.route)
    ? (existing.route_source === 'explicit' || existing.route_source === 'default'
      ? existing.route_source
      : 'unknown')
    : routeSource;
  session.work_kind = requestedWorkKind;
  session.lifecycle = lifecycleFor(existing ? session : { ...session, mode: requestedMode });
  session.intent_summary = existing?.intent_summary || args.intent;
  session.updated_at = now();
  atomicWriteJson(join(paths.sessionDir, 'session.json'), session);
  atomicWriteJson(join(paths.sessionDir, 'intent.json'), envelope('intent', paths, 'active', {
    bundle_version: BUNDLE_VERSION,
    summary: session.intent_summary,
    route: session.route,
    route_source: session.route_source,
    work_kind: session.work_kind,
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

function decisionStatuses(decisions) {
  return Object.fromEntries(
    Object.entries(decisions).map(([name, decision]) => [name, decision?.status || 'pending']),
  );
}

function statusNext(result, lifecycle, workspace) {
  if (result.status === 'none') return 'start';
  if (result.status === 'completed') return null;
  if (result.status === 'paused') return 'resume';
  const current = currentSession(workspace);
  if (lifecycle.mode === 'to-plan') {
    const plan = readJson(join(current.paths.sessionDir, 'plan.json'));
    return approvalArtifactErrors('plan', plan, current).length > 0 ? 'record:plan' : null;
  }
  const requiredApprovals = approvalsForRoute(result.route);
  if (!requiredApprovals) return 'recover:route';
  for (const gate of requiredApprovals) {
    const assessment = approvalBindingAssessment(current, gate, lifecycle.approvals[gate]);
    if (assessment.invalid) return `record:${assessment.invalid.type}`;
    if (assessment.approvalKind !== 'current') return `approve:${gate}`;
  }
  if (!granted(lifecycle.authorizations.implementation)) return 'authorize:implementation';
  if (lifecycle.actions.execute.status !== 'started') return 'execute';
  if (lifecycle.actions.verify.status !== 'started') return 'verify';
  const runsDirectory = join(current.paths.sessionDir, 'runs');
  const fingerprint = worktreeFingerprint(current.paths.repo.root);
  const verification = existsSync(runsDirectory)
    ? latestGateArtifact(runsDirectory, 'verification')
    : null;
  const verificationErrors = gateArtifactErrors(
    'verification', verification, current, fingerprint,
  );
  if (verificationErrors.length > 0) {
    if (verification?.evidence?.requiredSpecialists?.includes('surveyor')) {
      return 'record:verification-with-user-verification';
    }
    if (verification?.status === 'passed'
      && !isObject(verification?.evidence?.userVerification)) {
      return 'record:verification-with-user-verification-decision';
    }
    return ['failed', 'blocked'].includes(verification?.status)
      ? 'resolve:verification'
      : 'record:verification';
  }
  const review = latestGateArtifact(runsDirectory, 'review');
  const reviewErrors = gateArtifactErrors('review', review, current, fingerprint);
  if (reviewErrors.length > 0
    || review.record_sequence <= verification.record_sequence
    || requiredSpecialistEvidenceErrors(verification.evidence, review.evidence).length > 0) {
    return ['failed', 'blocked'].includes(review?.status) ? 'resolve:review' : 'record:review';
  }
  if (lifecycle.actions.ship.status === 'ready') return 'complete';
  return 'complete-or-request-shipping';
}

function statusProjection(result, workspace) {
  if (result.status === 'none') {
    return { schema_version: 1, ok: true, command: 'status', status: 'none', next: 'start' };
  }
  const lifecycle = lifecycleFor(result);
  return {
    schema_version: 1,
    ok: true,
    command: 'status',
    status: result.status,
    task_id: result.task_id,
    route: result.route || null,
    mode: lifecycle.mode,
    approvals: decisionStatuses(lifecycle.approvals),
    authorizations: decisionStatuses(lifecycle.authorizations),
    actions: decisionStatuses(lifecycle.actions),
    next: statusNext(result, lifecycle, workspace),
  };
}

function receiptNext(command, result) {
  if (command === 'start' || command === 'resume' || command === 'approve' || command === 'authorize') return 'status';
  if (command === 'pause') return 'resume';
  if (command === 'execute') return 'verify';
  if (command === 'verify') return 'record:verification';
  if (command === 'ship') return 'complete';
  if (command === 'complete') return null;
  if (command === 'record') {
    if (result.artifact.status !== 'passed'
      && REQUIRED_GATES.includes(result.artifact.artifact_type)) {
      return `resolve:${result.artifact.artifact_type}`;
    }
    if (result.artifact.artifact_type === 'verification') return 'record:review';
    if (result.artifact.artifact_type === 'review') return 'complete-or-request-shipping';
    return 'status';
  }
  return 'status';
}

function compactProjection(command, result, workspace) {
  if (command === 'status') return statusProjection(result, workspace);
  if (command === 'fingerprint') {
    return { ...result, ok: true, command: 'fingerprint' };
  }
  if (command === 'record') {
    return {
      schema_version: 1,
      ok: true,
      command,
      artifact_type: result.artifact.artifact_type,
      status: result.artifact.status,
      next: receiptNext(command, result),
    };
  }
  return {
    schema_version: 1,
    ok: true,
    command,
    status: result.status,
    task_id: result.task_id,
    next: receiptNext(command, result),
  };
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
    lifecycle: lifecycleFor(extra.lifecycle ? { ...current.session, lifecycle: extra.lifecycle } : current.session),
    bundle_version: BUNDLE_VERSION,
    status: nextStatus,
    updated_at: now(),
  };
  atomicWriteJson(join(current.paths.sessionDir, 'session.json'), session);
  atomicWriteJson(current.paths.currentFile, { ...current.pointer, updated_at: now() });
  return session;
}

function requireStandardMode(current, action) {
  if (current.session.lifecycle.mode === 'to-plan') {
    throw new Error(
      `Cannot ${action}: this session is permanently plan-only (--to-plan). `
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
      requireV3: true,
      enforceCanonicalQuick: true,
      enforceEvidenceFreshness: true,
      enforcePathProvenance: true,
      workspace: current.paths.repo.root,
    }));
  }
  return errors;
}

function approvalBindingState(current, gate) {
  const bindings = [];
  for (const type of APPROVAL_ARTIFACTS[gate]) {
    const artifact = readJson(join(current.paths.sessionDir, `${type}.json`));
    const errors = approvalArtifactErrors(type, artifact, current);
    if (errors.length) {
      return { bindings, invalid: { type, errors } };
    }
    bindings.push({
      artifact_type: type,
      record_sequence: artifact.record_sequence,
      digest: artifactDigest(artifact),
    });
  }
  return { bindings, invalid: null };
}

function currentApprovalBindings(current, gate, action) {
  const state = approvalBindingState(current, gate);
  if (state.invalid) {
    throw new Error(
      `Cannot ${action}: ${state.invalid.errors.join('; ')}. `
      + `Record a fresh passed ${state.invalid.type} artifact, then approve ${gate} again.`,
    );
  }
  return state.bindings;
}

function approvalBindingAssessment(current, gate, approval) {
  const state = approvalBindingState(current, gate);
  let approvalKind = 'current';
  if (!granted(approval)) approvalKind = 'missing';
  else if (!Array.isArray(approval.artifact_bindings)) approvalKind = 'unbound';
  else if (!state.invalid
    && JSON.stringify(approval.artifact_bindings) !== JSON.stringify(state.bindings)) {
    approvalKind = 'stale';
  }
  return { ...state, approvalKind };
}

function requireCurrentApproval(current, gate, action) {
  const approval = current.session.lifecycle.approvals[gate];
  const assessment = approvalBindingAssessment(current, gate, approval);
  if (assessment.approvalKind === 'missing') {
    missingPrerequisite(
      action,
      `${gate} approval is missing for route ${current.session.route}`,
      `gorkhali-state.mjs approve --gate ${gate} --workspace <path>`,
    );
  }
  if (assessment.approvalKind === 'unbound') {
    throw new Error(
      `Cannot ${action}: ${gate} approval has no artifact binding and cannot be safely recovered. `
      + `Record a fresh passed ${APPROVAL_ARTIFACTS[gate].join(' and ')} artifact, `
      + `then run \`gorkhali-state.mjs approve --gate ${gate} --workspace <path>\` again.`,
    );
  }
  if (assessment.invalid) {
    throw new Error(
      `Cannot ${action}: ${assessment.invalid.errors.join('; ')}. `
      + `Record a fresh passed ${assessment.invalid.type} artifact, then approve ${gate} again.`,
    );
  }
  if (assessment.approvalKind === 'stale') {
    throw new Error(
      `Cannot ${action}: ${gate} approval is stale for the current passed artifact. `
      + `Review it and run \`gorkhali-state.mjs approve --gate ${gate} --workspace <path>\` again.`,
    );
  }
}

function approve(workspace, args) {
  if (!APPROVAL_GATES.has(args.gate)) {
    throw new Error('approve requires --gate direction, --gate plan, or --gate wiring.');
  }
  const current = requireCurrent(workspace);
  const { route } = current.session;
  if (!approvalsForRoute(route)?.includes(args.gate)) {
    throw new Error(`Cannot approve ${args.gate}: route ${route} does not use that approval gate.`);
  }
  if (args.gate === 'plan' && ['brainstorm', 'full'].includes(route)
    && !granted(current.session.lifecycle.approvals.direction)) {
    missingPrerequisite('approve the plan', 'direction approval is missing',
      'gorkhali-state.mjs approve --gate direction --workspace <path>');
  }
  if (args.gate === 'plan' && ['brainstorm', 'full'].includes(route)) {
    requireCurrentApproval(current, 'direction', 'approve the plan');
  }
  if (args.gate === 'wiring' && !granted(current.session.lifecycle.approvals.plan)) {
    missingPrerequisite(
      'approve wiring',
      'plan approval is missing',
      'gorkhali-state.mjs approve --gate plan --workspace <path>',
    );
  }
  if (args.gate === 'wiring') requireCurrentApproval(current, 'plan', 'approve wiring');
  const artifactBindings = currentApprovalBindings(current, args.gate, `approve ${args.gate}`);
  const lifecycle = lifecycleFor(current.session);
  lifecycle.approvals[args.gate] = {
    status: 'approved',
    decided_at: now(),
    by: args.by || 'user',
    artifact_bindings: artifactBindings,
  };
  return updateStatus(workspace, current.session.status, { lifecycle }, current);
}

function authorize(workspace, args) {
  const scope = canonicalScope(args.scope);
  if (!scope) {
    throw new Error('authorize requires --scope implementation or --scope ship-pr.');
  }
  const current = requireCurrent(workspace);
  const lifecycle = lifecycleFor(current.session);
  lifecycle.authorizations[scope] = {
    status: 'authorized',
    decided_at: now(),
    by: args.by || 'user',
  };
  return updateStatus(workspace, current.session.status, { lifecycle }, current);
}

function correctWorkKind(workspace, args) {
  const current = requireCurrent(workspace);
  if (lifecycleFor(current.session).actions.execute.status === 'started') {
    throw new Error(
      'Cannot correct work kind: execution has already started through the lifecycle gate. '
      + 'Complete this session and restart with a new task id.',
    );
  }
  const correction = {
    record_type: 'work_kind_correction',
    from: current.session.work_kind,
    to: args['work-kind'],
    granted_by: args['granted-by'],
    reason: args.reason,
    at: now(),
  };
  const errors = workKindCorrectionErrors(correction);
  if (errors.length) {
    throw new Error(
      `Cannot correct work kind: ${errors.join('; ')}. `
      + 'Run `gorkhali-state.mjs correct-work-kind --work-kind <implementation|investigation> '
      + '--granted-by <who> --reason <why> --workspace <path>`.',
    );
  }
  const intentFile = join(current.paths.sessionDir, 'intent.json');
  const intent = readJson(intentFile);
  if (!isObject(intent)) {
    throw new Error('Cannot correct work kind: intent.json is missing or malformed.');
  }
  atomicWriteJson(intentFile, { ...intent, work_kind: correction.to, updated_at: now() });
  return updateStatus(
    workspace,
    current.session.status,
    { work_kind: correction.to, work_kind_correction: correction },
    current,
  );
}

function isLegacyClassificationArtifact(bundleVersion) {
  if (bundleVersion === undefined) return true;
  if (typeof bundleVersion !== 'string') return false;
  const match = bundleVersion.match(/^(\d+)\.(\d+)\.\d+$/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major < 2 || (major === 2 && minor < 2);
}

function authoritativeWorkKind(current) {
  const errors = [];
  const correction = current.session.work_kind_correction ?? null;
  const grantedKind = correctedWorkKind(correction);
  if (correction !== null && grantedKind === null) {
    errors.push(`session work_kind_correction is invalid: ${workKindCorrectionErrors(correction).join('; ')}`);
  }
  const sessionSummary = current.session.intent_summary;
  if (typeof sessionSummary !== 'string' || sessionSummary.trim() === '') {
    errors.push('session intent_summary is missing or malformed');
  }
  let sessionKind;
  try {
    if (!current.sessionHadWorkKind
      && !isLegacyClassificationArtifact(current.session.bundle_version)) {
      errors.push('session work_kind is missing from a current classification artifact');
    }
    sessionKind = resolveWorkKind(current.session.work_kind, sessionSummary, correction);
    if (current.session.work_kind !== sessionKind) {
      errors.push('session work_kind conflicts with defect signals in session intent_summary');
    }
  } catch (error) {
    errors.push(`session work_kind is invalid: ${error.message}`);
  }

  const intent = readJson(join(current.paths.sessionDir, 'intent.json'));
  let intentKind;
  if (!isObject(intent)) {
    errors.push('intent.json is missing or malformed');
  } else {
    if (intent.repo_id !== current.paths.repo.id) {
      errors.push('intent.json repo_id does not match the active session');
    }
    if (intent.task_id !== current.paths.task) {
      errors.push('intent.json task_id does not match the active session');
    }
    if (typeof intent.summary !== 'string' || intent.summary.trim() === '') {
      errors.push('intent.json summary is missing');
    } else if (intent.summary.trim() !== String(sessionSummary || '').trim()) {
      errors.push('intent.json summary does not match session intent_summary');
    }
    try {
      if (intent.work_kind === undefined
        && !isLegacyClassificationArtifact(intent.bundle_version)) {
        errors.push('intent.json work_kind is missing from a current classification artifact');
      }
      intentKind = resolveWorkKind(intent.work_kind, intent.summary, correction);
      if (intent.work_kind !== undefined && intent.work_kind !== intentKind) {
        errors.push('intent.json work_kind conflicts with defect signals in its summary');
      }
    } catch (error) {
      errors.push(`intent.json work_kind is invalid: ${error.message}`);
    }
  }

  if (sessionKind && intentKind && sessionKind !== intentKind) {
    errors.push('session and intent.json work_kind classifications do not match');
  }
  if (hasDefectSignal(sessionSummary) || hasDefectSignal(intent?.summary)) {
    const requiredKind = grantedKind ?? 'investigation';
    if (sessionKind !== requiredKind || intentKind !== requiredKind) {
      errors.push(`defect signals require ${requiredKind} classification`);
    }
  }
  return { errors, workKind: sessionKind };
}

function prepareExecute(current) {
  requireStandardMode(current, 'execute');
  const lifecycle = lifecycleFor(current.session);
  const currentFingerprint = worktreeFingerprint(current.paths.repo.root);
  const classification = authoritativeWorkKind(current);
  if (classification.errors.length) {
    throw new Error(
      'Cannot execute: authoritative classification artifacts are inconsistent. '
      + classification.errors.join('; '),
    );
  }
  if (classification.workKind === 'investigation') {
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
        'Cannot execute investigation: defect proof is not ready. '
        + `${errors.join('; ')}. Preserve waiting_for_evidence/unconfirmed_defect `
        + 'and run Detective again with the missing evidence.',
      );
    }
  }
  if (!granted(lifecycle.authorizations.implementation)) {
    missingPrerequisite(
      'execute',
      'implementation authorization is missing',
      'gorkhali-state.mjs authorize --scope implementation --workspace <path>',
    );
  }
  const requiredApprovals = approvalsForRoute(current.session.route);
  if (!requiredApprovals) {
    throw new Error(
      'Cannot execute: the recovered session has no supported route. '
      + 'Resume it with `gorkhali-state.mjs start --task <id> --intent <text> '
      + '--route <lite|direct|plan|brainstorm|full> --workspace <path>`.',
    );
  }
  for (const gate of requiredApprovals) {
    requireCurrentApproval(current, gate, 'execute');
  }
  if (lifecycle.actions.execute.status === 'started') return lifecycle;
  lifecycle.actions.execute = {
    status: 'started',
    decided_at: now(),
    worktree_fingerprint: currentFingerprint,
  };
  return lifecycle;
}

function execute(workspace) {
  const current = requireCurrent(workspace);
  const lifecycle = prepareExecute(current);
  return updateStatus(workspace, current.session.status, { lifecycle }, current);
}

function prepareVerify(current) {
  const lifecycle = lifecycleFor(current.session);
  if (lifecycle.actions.execute.status !== 'started') {
    missingPrerequisite(
      'verify',
      'execution has not started through the lifecycle gate',
      'gorkhali-state.mjs execute --workspace <path>',
    );
  }
  lifecycle.actions.verify = {
    status: 'started',
    decided_at: now(),
    worktree_fingerprint: worktreeFingerprint(current.paths.repo.root),
  };
  return lifecycle;
}

function verify(workspace) {
  const current = requireCurrent(workspace);
  const lifecycle = prepareVerify(current);
  return updateStatus(workspace, current.session.status, { lifecycle }, current);
}

function gateEvidenceErrors(type, evidence) {
  if (!isObject(evidence)) return [`${type} evidence must be an object.`];
  if (type === 'verification') {
    const errors = [];
    if (!Array.isArray(evidence.checks) || evidence.checks.length === 0) {
      errors.push('Passed verification evidence requires at least one check.');
    } else {
      errors.push(...evidence.checks.flatMap((check, index) => {
        if (!isObject(check)) return [`Verification check ${index + 1} must be an object.`];
        const checkErrors = [];
        if (typeof check.name !== 'string' || !check.name.trim()) {
          checkErrors.push(`Verification check ${index + 1} requires a name.`);
        }
        if (check.result !== 'passed') {
          checkErrors.push(`Verification check ${index + 1} must have result "passed".`);
        }
        return checkErrors;
      }));
    }
    if (!Array.isArray(evidence.requiredSpecialists)) {
      errors.push('Passed verification evidence requires a requiredSpecialists array.');
    } else {
      const seen = new Set();
      for (const role of evidence.requiredSpecialists) {
        if (role === 'surveyor') {
          errors.push(LEGACY_SURVEYOR_GATE_RECOVERY);
        } else if (!SPECIALIST_ROLES.has(role)) {
          errors.push(`Unsupported required specialist role: ${String(role)}.`);
        } else if (seen.has(role)) {
          errors.push(`Required specialist role is duplicated: ${role}.`);
        } else {
          seen.add(role);
        }
      }
    }
    if (evidence.visualVerification !== undefined) {
      errors.push('Verification visualVerification is unsupported; use userVerification.');
    }
    if (evidence.userVerificationRequired !== undefined) {
      errors.push('Verification userVerificationRequired is unsupported; classify in userVerification.required.');
    }
    const userVerification = evidence.userVerification;
    if (!isObject(userVerification)) {
      errors.push(
        'Passed verification evidence requires userVerification classification; '
        + 'use {"required":false} when user verification is not needed.',
      );
    } else {
      if (typeof userVerification.required !== 'boolean') {
        errors.push('Verification userVerification requires a boolean required field.');
      } else if (userVerification.required === false) {
        const unexpected = Object.keys(userVerification).filter((field) => field !== 'required');
        for (const field of unexpected) {
          errors.push(`Non-required userVerification must omit ${field}.`);
        }
      } else {
        const allowed = new Set(['required', 'status', 'routes', 'confirmedBy', 'observations']);
        for (const field of Object.keys(userVerification).filter((key) => !allowed.has(key))) {
          errors.push(`Required userVerification has unsupported field: ${field}.`);
        }
        if (!['confirmed', 'pending'].includes(userVerification.status)) {
          errors.push(
            'Verification userVerification status must be "confirmed" or "pending".',
          );
        }
        const routes = userVerification.routes;
        if (!Array.isArray(routes)
          || routes.some((route) => typeof route !== 'string' || !route.trim())) {
          errors.push('Verification userVerification requires a routes string array.');
        }
        if (!Array.isArray(userVerification.observations)
          || userVerification.observations.some(
            (observation) => typeof observation !== 'string' || !observation.trim(),
          )) {
          errors.push('Verification userVerification requires an observations string array.');
        }
        if (userVerification.status !== 'confirmed'
            || userVerification.confirmedBy !== 'user'
            || !Array.isArray(routes)
            || routes.length === 0) {
          errors.push(
            'Required userVerification must be confirmed by the user with at least one route.',
          );
        }
        if (userVerification.status === 'confirmed') {
          if (userVerification.confirmedBy !== 'user') {
            errors.push('Confirmed userVerification must set confirmedBy to "user".');
          }
        } else if (userVerification.confirmedBy !== undefined) {
          errors.push('Verification userVerification confirmedBy must be omitted unless confirmed.');
        }
      }
    }
    return errors;
  }
  if (type === 'review') {
    const errors = [];
    if (evidence.verdict !== 'pass') errors.push('Passed review evidence requires verdict "pass".');
    if (!Array.isArray(evidence.findings)) errors.push('Passed review evidence requires a findings array.');
    if (!Array.isArray(evidence.specialists)) {
      errors.push('Passed review evidence requires a specialists array.');
      return errors;
    }
    const seen = new Set();
    evidence.specialists.forEach((specialist, index) => {
      if (!isObject(specialist)) {
        errors.push(`Review specialist ${index + 1} must be an object.`);
        return;
      }
      const { role } = specialist;
      if (!SPECIALIST_ROLES.has(role)) {
        errors.push(`Review specialist ${index + 1} has unsupported role: ${String(role)}.`);
      } else if (seen.has(role)) {
        errors.push(`Review specialist role is duplicated: ${role}.`);
      } else {
        seen.add(role);
      }
      if (specialist.verdict !== 'pass') {
        errors.push(`Review specialist ${index + 1} must have verdict "pass".`);
      }
      if (!Array.isArray(specialist.findings)) {
        errors.push(`Review specialist ${index + 1} requires a findings array.`);
      }
      if (!Array.isArray(specialist.observationGaps)) {
        errors.push(`Review specialist ${index + 1} requires an observationGaps array.`);
      } else if (specialist.observationGaps.length > 0) {
        errors.push(`Review specialist ${index + 1} cannot pass with observation gaps.`);
      }
    });
    return errors;
  }
  return [];
}

function requiredSpecialistEvidenceErrors(verificationEvidence, reviewEvidence) {
  if (!Array.isArray(verificationEvidence?.requiredSpecialists)
    || !Array.isArray(reviewEvidence?.specialists)) {
    return [];
  }
  const required = new Set(verificationEvidence.requiredSpecialists);
  const observed = new Map(reviewEvidence.specialists.map((specialist) => [specialist?.role, specialist]));
  const errors = [];
  for (const role of required) {
    if (role === 'surveyor') {
      errors.push(LEGACY_SURVEYOR_GATE_RECOVERY);
      continue;
    }
    const specialist = observed.get(role);
    if (!specialist) {
      errors.push(`Required specialist evidence is missing for role: ${role}.`);
    } else if (specialist.verdict !== 'pass') {
      errors.push(`Required specialist evidence is not passed for role: ${role}.`);
    }
  }
  for (const role of observed.keys()) {
    if (SPECIALIST_ROLES.has(role) && !required.has(role)) {
      errors.push(`Review contains unrequired specialist evidence for role: ${role}.`);
    }
  }
  return errors;
}

function reviewDelegationProvenance(current, runId, verificationSequence) {
  const directory = runDirectory(current, runId);
  const task = readJson(join(directory, 'delegation-task.json'));
  const result = readJson(join(directory, 'delegation-result.json'));
  const errors = [];
  for (const [label, artifact, artifactType] of [
    ['task', task, 'delegation-task'],
    ['result', result, 'delegation-result'],
  ]) {
    if (!isObject(artifact)) {
      errors.push(`same-run ${artifactType}.json is missing`);
      continue;
    }
    if (artifact.schema_version !== 1) errors.push(`${label} envelope schema version is unsupported`);
    if (artifact.artifact_type !== artifactType) errors.push(`${label} envelope artifact type does not match`);
    if (artifact.repo_id !== current.paths.repo.id) errors.push(`${label} envelope belongs to another repository`);
    if (artifact.task_id !== current.paths.task) errors.push(`${label} envelope belongs to another session task`);
  }
  if (errors.length > 0) throw new Error(errors.join('; '));

  errors.push(...validateDelegationTaskContract(task.evidence));
  errors.push(...validateDelegationResultContract(result.evidence));
  if (task.evidence?.role !== 'auditor') errors.push('delegation task evidence role must be auditor');
  if (result.status !== 'passed') errors.push('delegation result envelope status must be passed');
  if (result.evidence?.status !== 'ok') errors.push('delegation result evidence status must be ok');
  if (result.producer?.role !== 'auditor') errors.push('delegation result producer role must be auditor');
  if (task.evidence?.task_id !== result.evidence?.task_id) {
    errors.push('delegation result task_id must match the task');
  }
  if (task.evidence?.delegation_id !== result.evidence?.delegation_id) {
    errors.push('delegation result delegation_id must match the task');
  }
  if (isObject(task.evidence)
    && result.evidence?.task_digest !== delegationTaskDigest(task.evidence)) {
    errors.push('delegation result task_digest must match the accepted canonical task');
  }
  if (!Number.isInteger(task.record_sequence) || task.record_sequence < 1) {
    errors.push('delegation task has no stable record sequence');
  }
  if (!Number.isInteger(result.record_sequence) || result.record_sequence < 1) {
    errors.push('delegation result has no stable record sequence');
  }
  if (!Number.isInteger(verificationSequence) || verificationSequence < 1) {
    errors.push('authoritative verification has no stable record sequence');
  } else {
    if (task.record_sequence <= verificationSequence) {
      errors.push('Auditor delegation task must be recorded after authoritative verification');
    }
    if (result.record_sequence <= verificationSequence) {
      errors.push('Auditor delegation result must be recorded after authoritative verification');
    }
  }
  if (Number.isInteger(task.record_sequence)
    && Number.isInteger(result.record_sequence)
    && result.record_sequence <= task.record_sequence) {
    errors.push('Auditor delegation result must be recorded after its task');
  }
  if (errors.length > 0) throw new Error(errors.join('; '));
  return {
    reference: {
      run_id: runId,
      verification_sequence: verificationSequence,
      task_sequence: task.record_sequence,
      result_sequence: result.record_sequence,
      result_digest: artifactDigest(result),
    },
    result_evidence: result.evidence,
  };
}

function reviewResultEvidenceErrors(reviewEvidence, resultEvidence) {
  const errors = [];
  if (resultEvidence?.output?.blocker !== null) {
    errors.push('passed review cannot accept an Auditor result with a blocker');
  }
  const classificationChecks = resultEvidence?.output?.checks?.filter(
    (check) => check?.name === 'user-verification-classification',
  ) || [];
  if (classificationChecks.length !== 1 || classificationChecks[0].status !== 'passed') {
    errors.push(
      'passed review requires exactly one passed Auditor user-verification-classification check',
    );
  }
  if (canonicalDelegationJson(reviewEvidence?.findings)
    !== canonicalDelegationJson(resultEvidence?.output?.findings)) {
    errors.push('passed review findings must exactly match the accepted Auditor result findings');
  }
  return errors;
}

function reviewProvenanceErrors(review, current) {
  if (!isObject(review.review_provenance)) {
    return ['review artifact has no independent delegation provenance.'];
  }
  const provenance = review.review_provenance;
  if (typeof provenance.run_id !== 'string' || !provenance.run_id) {
    return ['review artifact delegation provenance has no run id.'];
  }
  try {
    const runsDirectory = join(current.paths.sessionDir, 'runs');
    const verification = existsSync(runsDirectory)
      ? latestGateArtifact(runsDirectory, 'verification')
      : null;
    const currentProvenance = reviewDelegationProvenance(
      current, provenance.run_id, verification?.record_sequence,
    );
    if (provenance.verification_sequence !== currentProvenance.reference.verification_sequence
      || provenance.task_sequence !== currentProvenance.reference.task_sequence
      || provenance.result_sequence !== currentProvenance.reference.result_sequence
      || provenance.result_digest !== currentProvenance.reference.result_digest) {
      return ['review artifact delegation provenance is stale or tampered.'];
    }
    const evidenceErrors = reviewResultEvidenceErrors(
      review.evidence, currentProvenance.result_evidence,
    );
    if (evidenceErrors.length > 0) return evidenceErrors.map((error) => `${error}.`);
  } catch (error) {
    return [`review artifact delegation provenance is invalid: ${error.message}.`];
  }
  return [];
}

function gateArtifactErrors(type, artifact, current, fingerprint) {
  if (!isObject(artifact)) return [`current passed ${type} artifact is missing.`];
  const errors = [];
  if (artifact.schema_version !== 1) errors.push(`${type} artifact has an unsupported schema version.`);
  if (artifact.artifact_type !== type) errors.push(`${type} artifact type does not match its gate.`);
  if (artifact.repo_id !== current.paths.repo.id) errors.push(`${type} artifact belongs to another repository.`);
  if (artifact.task_id !== current.paths.task) errors.push(`${type} artifact belongs to another task.`);
  if (artifact.status !== 'passed') errors.push(`${type} artifact is not passed.`);
  if (!Number.isInteger(artifact.record_sequence) || artifact.record_sequence < 1) {
    errors.push(`${type} artifact has no stable record sequence; record a fresh ${type} artifact.`);
  }
  if (fingerprint && artifact.worktree_fingerprint !== fingerprint) {
    errors.push(
      `${type} artifact is stale for the current worktree; record a fresh passed ${type} artifact.`,
    );
  }
  errors.push(...gateEvidenceErrors(type, artifact.evidence));
  if (type === 'review') errors.push(...reviewProvenanceErrors(artifact, current));
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
  for (const entry of readdirSync(runsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(runsDirectory, entry.name, `${type}.json`);
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

function requireCurrentPassedVerification(current, action, fingerprint) {
  const runsDirectory = join(current.paths.sessionDir, 'runs');
  const verification = existsSync(runsDirectory)
    ? latestGateArtifact(runsDirectory, 'verification')
    : null;
  const errors = gateArtifactErrors('verification', verification, current, fingerprint);
  if (errors.length) {
    throw new Error(
      `Cannot ${action}: ${errors.join(' ')} `
      + 'Record a fresh passed verification artifact before independent review.',
    );
  }
  return verification;
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
  atomicWriteJson(file, value);
}

function record(workspace, args) {
  if (!args.type || !args.status) throw new Error('record requires --type and --status.');
  if (!Object.hasOwn(ARTIFACTS, args.type)) throw new Error(`Unsupported artifact type: ${args.type}`);
  if (!ARTIFACT_STATUSES.has(args.status)) throw new Error(`Unsupported artifact status: ${args.status}`);
  const current = requireCurrent(workspace);
  if (args.type === 'review' && args.role !== 'auditor') {
    const received = args.role === undefined ? 'no explicit role' : args.role;
    throw new Error(
      `Review evidence requires explicit independent role provenance via --role auditor; received ${received}.`,
    );
  }
  if (args.type === 'review' && !args.run) {
    throw new Error('Review evidence requires explicit --run with same-run Auditor delegation evidence.');
  }
  const runId = args.run || `run-${Date.now()}`;
  const directory = ARTIFACTS[args.type].run ? runDirectory(current, runId) : null;
  const file = ARTIFACTS[args.type].run
    ? join(directory, `${args.type}.json`)
    : join(current.paths.sessionDir, `${args.type}.json`);
  if (args.input) {
    const resolvedInput = resolve(realpathSync(args.input));
    const resolvedSession = resolve(realpathSync(current.paths.sessionDir));
    const resolvedDestination = resolveThroughExistingParent(file);
    if (isWithin(resolvedSession, resolvedInput) && resolvedInput !== resolvedDestination) {
      throw new Error(
        'record --input cannot use a transport file inside the active session because that '
        + 'would duplicate durable evidence. Use an external temporary path or stdin through an adapter.',
      );
    }
  }
  const payload = args.input ? JSON.parse(readFileSync(args.input, 'utf8')) : {};
  const fingerprint = ['verification', 'review'].includes(args.type)
    ? worktreeFingerprint(current.paths.repo.root)
    : null;
  const verificationForReview = args.type === 'review'
    ? requireCurrentPassedVerification(current, 'record review', fingerprint)
    : null;
  let reviewProvenance;
  let reviewResultEvidence;
  if (args.type === 'review') {
    try {
      const provenance = reviewDelegationProvenance(
        current, runId, verificationForReview.record_sequence,
      );
      reviewProvenance = provenance.reference;
      reviewResultEvidence = provenance.result_evidence;
    } catch (error) {
      throw new Error(`Cannot record review: ${error.message}.`);
    }
  }
  const delegatedTask = args.type === 'delegation-result'
    ? readJson(join(directory, 'delegation-task.json'))
    : null;
  if (args.type === 'delegation-result' && !delegatedTask) {
    throw new Error('Delegation result requires a task recorded under the same run.');
  }
  const delegatedTaskPayload = delegatedTask?.evidence;
  let contractErrors;
  if (args.type === 'delegation-task') {
    contractErrors = [
      ...validateDelegationTaskContract(payload),
      ...(payload.contract_version === 2 ? validateContextReferences(payload, current) : []),
    ];
  } else if (args.type === 'delegation-result') {
    contractErrors = [
      ...validateDelegationResultContract(payload, {
        allowVersion1: delegatedTaskPayload?.contract_version === 1,
      }),
      ...(isObject(delegatedTaskPayload)
        ? validateChangedPaths(payload, delegatedTaskPayload, current.paths.repo.root)
        : []),
    ];
  }
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
    if (delegatedTaskPayload?.task_id !== payload.task_id) {
      throw new Error('Delegation result task_id must match the task recorded under the same run.');
    }
    if (delegatedTaskPayload?.contract_version !== payload.contract_version) {
      throw new Error('Delegation result contract_version must match the task recorded under the same run.');
    }
    if (payload.contract_version === 2) {
      if (delegatedTaskPayload.delegation_id !== payload.delegation_id) {
        throw new Error('Delegation result delegation_id must match the task recorded under the same run.');
      }
      if (delegationTaskDigest(delegatedTaskPayload) !== payload.task_digest) {
        throw new Error('Delegation result task_digest must match the accepted canonical task.');
      }
    }
  }
  if (args.status === 'passed' && REQUIRED_GATES.includes(args.type)) {
    const evidenceErrors = [
      ...gateEvidenceErrors(args.type, payload),
      ...(args.type === 'review'
        ? [
          ...requiredSpecialistEvidenceErrors(verificationForReview.evidence, payload),
          ...reviewResultEvidenceErrors(payload, reviewResultEvidence),
        ]
        : []),
    ];
    if (evidenceErrors.length) throw new Error(`Invalid passed ${args.type} evidence: ${evidenceErrors.join('; ')}`);
  }
  const role = args.role
    || (args.type === 'delegation-task' ? payload.role : delegatedTask?.producer?.role)
    || ARTIFACTS[args.type].role
    || 'chief';
  const profileOverride = args.profile
    || (args.type === 'delegation-task'
      ? payload.profile
      : delegatedTask?.model_routing?.requested_profile);
  const risk = args.type === 'delegation-task' ? payload.risk : delegatedTaskPayload?.risk;
  const profile = resolveProfile({ role, profile: profileOverride, risk }).requested_profile;
  const routing = modelRouting(args, profile);
  let lifecycle = lifecycleFor(current.session);
  if (args.type === 'execution') lifecycle = prepareExecute(current);
  else if (args.type === 'verification') lifecycle = prepareVerify(current);
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
    ...(['verification', 'review'].includes(args.type)
      ? { worktree_fingerprint: fingerprint }
      : {}),
    producer: { role, compute_profile: profile },
    model_routing: routing,
    ...(args.type === 'review' ? { review_provenance: reviewProvenance } : {}),
    evidence: payload,
  });
  const previousArtifact = readJson(file);
  const previousSession = readJson(join(current.paths.sessionDir, 'session.json'));
  const previousPointer = readJson(current.paths.currentFile);
  atomicWriteJson(file, artifact);
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

function requireCurrentPassedGates(current, action) {
  const runsDirectory = join(current.paths.sessionDir, 'runs');
  const fingerprint = worktreeFingerprint(current.paths.repo.root);
  const artifacts = {};
  for (const gate of REQUIRED_GATES) {
    const artifact = existsSync(runsDirectory) ? latestGateArtifact(runsDirectory, gate) : null;
    const errors = gateArtifactErrors(gate, artifact, current, fingerprint);
    if (errors.length > 0) {
      throw new Error(`Cannot ${action}: ${errors.join(' ')}`);
    }
    artifacts[gate] = artifact;
  }
  const specialistErrors = requiredSpecialistEvidenceErrors(
    artifacts.verification.evidence,
    artifacts.review.evidence,
  );
  if (specialistErrors.length > 0) {
    throw new Error(`Cannot ${action}: ${specialistErrors.join(' ')}`);
  }
  if (artifacts.review.record_sequence <= artifacts.verification.record_sequence) {
    throw new Error(
      `Cannot ${action}: review artifact is stale because authoritative review must be newer `
      + 'than the current passed verification. Record a fresh review after verification.',
    );
  }
  return fingerprint;
}

function ship(workspace) {
  const current = requireCurrent(workspace);
  requireStandardMode(current, 'ship');
  const lifecycle = lifecycleFor(current.session);
  if (lifecycle.actions.execute.status !== 'started') {
    missingPrerequisite(
      'ship',
      'execution has not started through the lifecycle gate',
      'gorkhali-state.mjs execute --workspace <path>',
    );
  }
  if (!granted(lifecycle.authorizations['ship-pr'])) {
    missingPrerequisite(
      'ship',
      'PR shipping authorization is missing',
      'gorkhali-state.mjs authorize --scope ship-pr --workspace <path>',
    );
  }
  const fingerprint = requireCurrentPassedGates(current, 'ship');
  lifecycle.actions.ship = {
    status: 'ready',
    decided_at: now(),
    worktree_fingerprint: fingerprint,
  };
  return updateStatus(workspace, current.session.status, { lifecycle }, current);
}

function complete(workspace) {
  const current = requireCurrent(workspace);
  if (current.session.lifecycle.mode === 'to-plan') {
    const plan = readJson(join(current.paths.sessionDir, 'plan.json'));
    const errors = approvalArtifactErrors('plan', plan, current);
    if (errors.length) {
      throw new Error(
        `Cannot complete: ${errors.join('; ')}. `
        + 'Record a fresh passed plan artifact, then complete this plan-only session.',
      );
    }
  } else {
    if (current.session.lifecycle.actions.execute.status !== 'started') {
      missingPrerequisite(
        'complete',
        'execution has not started through the lifecycle gate',
        'gorkhali-state.mjs execute --workspace <path>',
      );
    }
    requireCurrentPassedGates(current, 'complete');
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
    else if (command === 'fingerprint') result = fingerprint(workspace);
    else result = withLifecycleLock(workspace, () => {
      if (command === 'start') return start(workspace, args);
      if (command === 'pause') return updateStatus(workspace, 'paused', { pause_reason: args.reason || 'Paused by user.' });
      if (command === 'resume') return updateStatus(workspace, 'active', { resumed_at: now() });
      if (command === 'approve') return approve(workspace, args);
      if (command === 'authorize') return authorize(workspace, args);
      if (command === 'correct-work-kind') return correctWorkKind(workspace, args);
      if (command === 'execute') return execute(workspace);
      if (command === 'verify') return verify(workspace);
      if (command === 'record') return record(workspace, args);
      if (command === 'ship') return ship(workspace);
      if (command === 'complete') return complete(workspace);
      throw new Error(
        'Usage: gorkhali-state.mjs '
        + '<start|status|fingerprint|pause|resume|approve|authorize|correct-work-kind'
        + '|execute|verify|record|ship|complete> [options]',
      );
    });
    const output = args.json === true
      ? JSON.stringify(result, null, 2)
      : JSON.stringify(compactProjection(command, result, workspace));
    process.stdout.write(`${output}\n`);
  } catch (error) {
    fail(error.message);
  }
}

if (isMainModule(import.meta.url)) main();
