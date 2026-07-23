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
  delegationTaskDigest,
  validateDecisionContract,
  validateDelegationResultContract,
  validateDelegationTaskContract,
} from './lib/decision-contracts.mjs';

const REQUIRED_GATES = ['verification', 'review'];
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
const AUTHORIZATION_SCOPES = new Set(['implementation', 'ship-draft-pr']);
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

function emptyDecision() {
  return { status: 'pending', decided_at: null };
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
    authorizations: {
      implementation: emptyDecision(),
      'ship-draft-pr': emptyDecision(),
      ...(isObject(existing.authorizations) ? existing.authorizations : {}),
    },
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

function worktreeFingerprint(workspace) {
  const hash = createHash('sha256');
  hash.update(`workspace\0${workspace}\0`);
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
  session.lifecycle = lifecycleFor(session);
  return { paths, pointer, session };
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
  if (existing) {
    if (existing.route && existing.route !== route) {
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
    intent_summary: args.intent,
  });
  session.bundle_version = BUNDLE_VERSION;
  session.status = 'active';
  session.route = existing?.route || route;
  session.lifecycle = lifecycleFor(existing ? session : { ...session, mode: requestedMode });
  session.intent_summary = existing?.intent_summary || args.intent;
  session.updated_at = now();
  atomicWriteJson(join(paths.sessionDir, 'session.json'), session);
  atomicWriteJson(join(paths.sessionDir, 'intent.json'), envelope('intent', paths, 'active', {
    bundle_version: BUNDLE_VERSION,
    summary: session.intent_summary,
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

function requireCurrentApproval(current, gate, action) {
  const approval = current.session.lifecycle.approvals[gate];
  if (!granted(approval)) {
    missingPrerequisite(
      action,
      `${gate} approval is missing for route ${current.session.route}`,
      `phantom-state.mjs approve --gate ${gate} --workspace <path>`,
    );
  }
  if (!Array.isArray(approval.artifact_bindings)) {
    throw new Error(
      `Cannot ${action}: ${gate} approval has no artifact binding and cannot be safely recovered. `
      + `Record a fresh passed ${APPROVAL_ARTIFACTS[gate].join(' and ')} artifact, `
      + `then run \`phantom-state.mjs approve --gate ${gate} --workspace <path>\` again.`,
    );
  }
  const currentBindings = currentApprovalBindings(current, gate, action);
  if (JSON.stringify(approval.artifact_bindings) !== JSON.stringify(currentBindings)) {
    throw new Error(
      `Cannot ${action}: ${gate} approval is stale for the current passed artifact. `
      + `Review it and run \`phantom-state.mjs approve --gate ${gate} --workspace <path>\` again.`,
    );
  }
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
      'phantom-state.mjs approve --gate direction --workspace <path>');
  }
  if (args.gate === 'plan' && ['brainstorm', 'full'].includes(route)) {
    requireCurrentApproval(current, 'direction', 'approve the plan');
  }
  if (args.gate === 'wiring' && !granted(current.session.lifecycle.approvals.plan)) {
    missingPrerequisite(
      'approve wiring',
      'plan approval is missing',
      'phantom-state.mjs approve --gate plan --workspace <path>',
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
  if (!AUTHORIZATION_SCOPES.has(args.scope)) {
    throw new Error('authorize requires --scope implementation or --scope ship-draft-pr.');
  }
  const current = requireCurrent(workspace);
  const lifecycle = lifecycleFor(current.session);
  lifecycle.authorizations[args.scope] = {
    status: 'authorized',
    decided_at: now(),
    by: args.by || 'user',
  };
  return updateStatus(workspace, current.session.status, { lifecycle }, current);
}

function prepareExecute(current) {
  requireStandardMode(current, 'execute');
  const lifecycle = lifecycleFor(current.session);
  if (!granted(lifecycle.authorizations.implementation)) {
    missingPrerequisite(
      'execute',
      'implementation authorization is missing',
      'phantom-state.mjs authorize --scope implementation --workspace <path>',
    );
  }
  const requiredApprovals = ROUTE_APPROVALS[current.session.route];
  if (!requiredApprovals) {
    throw new Error(
      'Cannot execute: the recovered session has no supported route. '
      + 'Resume it with `phantom-state.mjs start --task <id> --intent <text> '
      + '--route <direct|plan|brainstorm|full> --workspace <path>`.',
    );
  }
  for (const gate of requiredApprovals) {
    requireCurrentApproval(current, gate, 'execute');
  }
  lifecycle.actions.execute = {
    status: 'started',
    decided_at: now(),
    worktree_fingerprint: worktreeFingerprint(current.paths.repo.root),
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
      'phantom-state.mjs execute --workspace <path>',
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
  const payload = args.input ? JSON.parse(readFileSync(args.input, 'utf8')) : {};
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
    const evidenceErrors = gateEvidenceErrors(args.type, payload);
    if (evidenceErrors.length) throw new Error(`Invalid passed ${args.type} evidence: ${evidenceErrors.join('; ')}`);
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
  const fingerprint = ['verification', 'review'].includes(args.type)
    ? worktreeFingerprint(current.paths.repo.root)
    : null;
  let lifecycle = lifecycleFor(current.session);
  if (args.type === 'execution') lifecycle = prepareExecute(current);
  else if (args.type === 'verification') lifecycle = prepareVerify(current);
  else if (args.type === 'review') {
    requireCurrentPassedVerification(current, 'record review', fingerprint);
  }
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
    evidence: payload,
  });
  const file = ARTIFACTS[args.type].run
    ? join(current.paths.sessionDir, 'runs', runId, `${args.type}.json`)
    : join(current.paths.sessionDir, `${args.type}.json`);
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
      'phantom-state.mjs execute --workspace <path>',
    );
  }
  if (!granted(lifecycle.authorizations['ship-draft-pr'])) {
    missingPrerequisite(
      'ship',
      'draft-PR shipping authorization is missing',
      'phantom-state.mjs authorize --scope ship-draft-pr --workspace <path>',
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
  if (current.session.lifecycle.actions.execute.status !== 'started') {
    missingPrerequisite(
      'complete',
      'execution has not started through the lifecycle gate',
      'phantom-state.mjs execute --workspace <path>',
    );
  }
  requireCurrentPassedGates(current, 'complete');
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
      if (command === 'approve') return approve(workspace, args);
      if (command === 'authorize') return authorize(workspace, args);
      if (command === 'execute') return execute(workspace);
      if (command === 'verify') return verify(workspace);
      if (command === 'record') return record(workspace, args);
      if (command === 'ship') return ship(workspace);
      if (command === 'complete') return complete(workspace);
      throw new Error(
        'Usage: phantom-state.mjs '
        + '<start|status|pause|resume|approve|authorize|execute|verify|record|ship|complete> [options]',
      );
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    fail(error.message);
  }
}

if (isMainModule(import.meta.url)) main();
