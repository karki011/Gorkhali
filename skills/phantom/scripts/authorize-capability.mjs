#!/usr/bin/env node
// Author: Subash Karki

import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  sep,
} from 'node:path';
import {
  atomicWriteJson,
  currentSessionFile,
  isMainModule,
  parseArgs,
  readJson,
  sessionPaths,
  workspacePath,
} from './lib/portable.mjs';
import {
  assertCurrentLifecycleAuthorization,
  assertTrustedHostInterception,
  protectedBranches,
  worktreeFingerprint,
} from './phantom-state.mjs';
import {
  authorizeCapability,
  canonicalJson,
  capabilityDecisionRecord,
  capabilityRequestDigest,
  sha256,
  validateCapabilityRequest,
} from './lib/capability-contracts.mjs';
import { readStableJsonFile, workspaceSnapshot } from './lib/filesystem-snapshot.mjs';
import { gitMetadata } from './lib/git-metadata.mjs';
import {
  appendWorkflowEvent,
  readWorkflowJournal,
  WorkflowJournalConflictError,
  workflowPaths,
} from './lib/workflow-journal.mjs';

const BRANCH_BOUND_CAPABILITIES = new Set([
  'workspace.write',
  'process.exec',
  'git.commit',
  'git.push',
  'github.openDraftPr',
]);

const AUTHORIZATION_SCOPE = Object.freeze({
  'workspace.write': 'implementation',
  'process.exec': 'implementation',
  'git.commit': 'implementation',
  'git.push': 'ship-draft-pr',
  'github.openDraftPr': 'ship-draft-pr',
  'tracker.comment': 'tracker-comment',
});

function readInput(file) {
  if (!file || file === '/dev/stdin') return JSON.parse(readFileSync(0, 'utf8'));
  return readStableJsonFile(file).value;
}

function resolveTask(workspace, requested) {
  if (requested) return requested;
  const pointer = readJson(currentSessionFile(workspace));
  if (!pointer?.task_id) throw new Error('No active Phantom task; pass --task explicitly.');
  return pointer.task_id;
}

function priorDecisions(events) {
  const outcomes = new Map();
  for (const event of events) {
    if (event.event_type === 'capability.outcome') {
      const previous = outcomes.get(event.payload.decision_digest) ?? {
        execution_status: null,
        has_succeeded_outcome: false,
        succeeded_outcome: null,
      };
      if (event.payload.status === 'succeeded') {
        previous.execution_status = 'succeeded';
        previous.has_succeeded_outcome = true;
        previous.succeeded_outcome = event.payload;
      } else if (!previous.has_succeeded_outcome) {
        previous.execution_status = event.payload.status;
      }
      outcomes.set(event.payload.decision_digest, previous);
    }
  }
  return events.filter((event) => event.event_type === 'capability.decision').map((event) => {
    const outcome = outcomes.get(event.payload.decision_digest) ?? {};
    return {
      request_id: event.payload.request_id,
      request_digest: event.payload.request_digest,
      decision_digest: event.payload.decision_digest,
      idempotency_key: event.payload.idempotency_key,
      capability_type: event.payload.capability_type,
      node_id: event.node_id,
      status: event.payload.decision,
      execution_status: outcome.execution_status,
      has_succeeded_outcome: outcome.has_succeeded_outcome === true,
      succeeded_outcome: outcome.succeeded_outcome ?? null,
    };
  });
}

function externalAuthorizations(session) {
  const authorizations = session?.lifecycle?.authorizations ?? {};
  return Object.entries(authorizations)
    .filter(([, decision]) => ['approved', 'authorized'].includes(decision?.status))
    .map(([scope]) => scope === 'tracker-comment' ? 'tracker.comment' : scope);
}

function brokerContext({ workspace, task, sessionDir, compiled, snapshot }) {
  const session = readJson(join(sessionDir, 'session.json'));
  if (!session) throw new Error(`Active session is missing: ${join(sessionDir, 'session.json')}`);
  const capabilityArtifact = readJson(join(sessionDir, 'capabilities.json'), {});
  const metadata = gitMetadata(workspace);
  const filesystem = workspaceSnapshot(workspace);
  const branch = metadata.current_branch;
  const protectedSet = protectedBranches(workspace);
  const fingerprint = filesystem.digest;
  const paths = sessionPaths(workspace, task);
  const protectedControlPaths = [paths.root, paths.sessionDir]
    .map((candidate) => relative(workspace, candidate))
    .filter((candidate) => candidate === ''
      || (candidate !== '..' && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate)))
    .map((candidate) => candidate.split(sep).join('/') || '.');
  let interception = null;
  try {
    interception = assertTrustedHostInterception(workspace, {
      task,
      fingerprint,
      action: 'authorize a consequential capability',
    });
  } catch {
    // Policy records a fail-closed denial without treating untrusted probe text as evidence.
  }
  return {
    repo: compiled.plan.session_binding?.repo_id ?? session.repo_id ?? null,
    workspace,
    task,
    session,
    route: compiled.plan.route,
    current_branch: branch,
    protected_branches: protectedSet,
    trusted_interception: interception !== null,
    hard_enforcement: Boolean(interception && branch && protectedSet.length),
    interception_probe_digest: interception?.probe_digest ?? null,
    workflow: compiled.plan,
    workflowState: snapshot.state,
    currentWorktreeFingerprint: fingerprint,
    currentTreeDigest: filesystem.digest,
    protected_control_paths: [...new Set(protectedControlPaths)].sort(),
    headSha: metadata.head_sha,
    remotes: metadata.remotes,
    runtimeCapabilities: capabilityArtifact.evidence?.capabilities ?? capabilityArtifact.capabilities ?? {},
    remainingBudget: snapshot.state.remaining_budget,
    externalAuthorizations: externalAuthorizations(session),
    priorDecisions: priorDecisions(snapshot.events),
  };
}

function assertRequestAuthority({ workspace, task, request, action }) {
  const scope = AUTHORIZATION_SCOPE[request.type];
  if (!scope) throw new Error(`No lifecycle authorization scope is defined for ${request.type}.`);
  return assertCurrentLifecycleAuthorization(workspace, {
    task,
    scope,
    fingerprint: request.worktreeFingerprint,
    action,
  });
}

function assertRequestInterception({ workspace, task, request, action }) {
  return assertTrustedHostInterception(workspace, {
    task,
    fingerprint: request.worktreeFingerprint,
    action,
  });
}

function decisionPayload(decision) {
  const unsigned = capabilityDecisionRecord(decision);
  const decisionDigest = sha256(canonicalJson(unsigned));
  if (decision.decision_digest !== decisionDigest) throw new Error('Capability decision digest is invalid.');
  return { ...unsigned, decision_digest: decisionDigest };
}

function outcomePayload(decision, status, externalReference = null, error = null) {
  if (['succeeded', 'deduplicated'].includes(status)
    && ['git.push', 'github.openDraftPr', 'tracker.comment'].includes(decision.capability_type)
    && (typeof externalReference !== 'string' || externalReference.length === 0)) {
    throw new Error('A successful external capability outcome requires a nonempty external reference.');
  }
  const unsigned = {
    schema_version: 1,
    request_id: decision.request_id,
    idempotency_key: decision.idempotency_key,
    capability_type: decision.capability_type,
    request_digest: decision.request_digest,
    decision_digest: decision.decision_digest,
    status,
    external_reference: externalReference,
    error,
  };
  return { ...unsigned, outcome_digest: sha256(canonicalJson(unsigned)) };
}

function appendCapabilityEvent({ sessionDir, compiled, snapshot, eventType, nodeId, fingerprint, payload }) {
  return appendWorkflowEvent({
    sessionDir,
    compiled,
    expected_previous_event_digest: snapshot.events.at(-1)?.event_digest ?? null,
    input: {
      event_type: eventType,
      node_id: nodeId,
      worktree_fingerprint: fingerprint,
      producer: { role: 'capability-broker' },
      payload,
    },
  });
}

function reservationPaths(sessionDir, decisionDigest) {
  const digest = decisionDigest.replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Capability reservation requires a valid decision digest.');
  const root = join(sessionDir, 'capability', 'reservations');
  return {
    pending: join(root, 'pending', `${digest}.json`),
    consuming: join(root, 'consuming', `${digest}.json`),
    completed: join(root, 'completed', `${digest}.json`),
  };
}

function reservationBinding(request, context) {
  const binding = {
    adapter_binding: 'native-tool-gate-v1',
    authority_decision_digest: context.authority_decision_digest,
    interception_probe_digest: context.interception_probe_digest,
    worktree_fingerprint: request.worktreeFingerprint,
    current_branch: context.current_branch,
    protected_branches: [...context.protected_branches],
    head_sha: request.headSha ?? null,
    body_digest: request.patchDigest ?? request.bodyDigest ?? null,
    tree_digest: request.treeDigest ?? null,
    command: request.command ?? null,
    cwd: request.cwd ?? null,
    paths: request.paths ?? null,
  };
  return { ...binding, binding_digest: sha256(canonicalJson({ request, binding })) };
}

function createReservation({ sessionDir, request, decision, context }) {
  const paths = reservationPaths(sessionDir, decision.decision_digest);
  mkdirSync(join(sessionDir, 'capability', 'reservations', 'pending'), { recursive: true });
  mkdirSync(join(sessionDir, 'capability', 'reservations', 'consuming'), { recursive: true });
  mkdirSync(join(sessionDir, 'capability', 'reservations', 'completed'), { recursive: true });
  const reservation = {
    schema_version: 1,
    status: 'pending',
    decision_digest: decision.decision_digest,
    request_digest: decision.request_digest,
    request_id: decision.request_id,
    workflow_id: decision.workflow_id,
    node_id: decision.node_id,
    capability_type: decision.capability,
    idempotency_key: decision.idempotency_key,
    created_at: new Date().toISOString(),
    request: structuredClone(request),
    hard_enforcement: reservationBinding(request, context),
  };
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(paths.pending, 'wx', 0o600);
    writeFileSync(descriptor, `${canonicalJson(reservation)}\n`, 'utf8');
    fsyncSync(descriptor);
    created = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = JSON.parse(readFileSync(paths.pending, 'utf8'));
    const expectedExisting = { ...reservation, created_at: existing.created_at };
    if (typeof existing.created_at !== 'string'
      || existing.status !== 'pending'
      || canonicalJson(existing) !== canonicalJson(expectedExisting)) {
      throw new Error('Capability reservation path is already bound to a different request.');
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (created) {
    const directory = openSync(dirname(paths.pending), 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
  return paths;
}

function claimReservation(sessionDir, decisionDigest) {
  const paths = reservationPaths(sessionDir, decisionDigest);
  if (!existsSync(paths.pending)) throw new Error('Authorized capability reservation is not pending.');
  try {
    linkSync(paths.pending, paths.consuming);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Authorized capability reservation is already being consumed.');
    throw error;
  }
  unlinkSync(paths.pending);
  const reservation = JSON.parse(readFileSync(paths.consuming, 'utf8'));
  atomicWriteJson(paths.consuming, {
    ...reservation,
    status: 'consuming',
    consuming_at: new Date().toISOString(),
  });
  return paths;
}

function completeReservation(paths, outcome) {
  const reservation = JSON.parse(readFileSync(paths.consuming, 'utf8'));
  atomicWriteJson(paths.consuming, {
    ...reservation,
    status: outcome.status,
    completed_at: new Date().toISOString(),
    outcome_digest: outcome.outcome_digest,
    external_reference: outcome.external_reference,
    error: outcome.error,
  });
  try {
    linkSync(paths.consuming, paths.completed);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const completed = JSON.parse(readFileSync(paths.completed, 'utf8'));
    if (completed.outcome_digest !== outcome.outcome_digest) {
      throw new Error('Completed capability reservation is bound to a different outcome.');
    }
  }
  unlinkSync(paths.consuming);
}

function withJournalRetry(operation) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!(error instanceof WorkflowJournalConflictError) || attempt === 2) throw error;
    }
  }
  throw new Error('Capability journal retry limit reached.');
}

function authorizeRequest({ workspace, task, sessionDir, compiled, request, afterReservation = null }) {
  if (afterReservation !== null && typeof afterReservation !== 'function') {
    throw new Error('afterReservation must be a function.');
  }
  return withJournalRetry(() => {
    const snapshot = readWorkflowJournal(sessionDir, compiled);
    const context = brokerContext({ workspace, task, sessionDir, compiled, snapshot });
    const contractErrors = validateCapabilityRequest(request);
    const authority = contractErrors.length === 0
      ? assertRequestAuthority({ workspace, task, request, action: `authorize ${request.type}` })
      : null;
    context.authority_decision_digest = authority?.authority.decision_digest ?? null;
    const decision = authorizeCapability(request, context);
    if (decision.status === 'duplicate') {
      const priorDecision = snapshot.events.find((event) => event.event_type === 'capability.decision'
        && event.payload.decision_digest === decision.prior_decision_digest
        && event.payload.decision === 'authorized');
      const succeeded = snapshot.events.find((event) => event.event_type === 'capability.outcome'
        && event.payload.decision_digest === decision.prior_decision_digest
        && event.payload.status === 'succeeded');
      if (!priorDecision || !succeeded) {
        throw new Error('Deduplication requires a prior authorized decision with a succeeded outcome.');
      }
      appendCapabilityEvent({
        sessionDir,
        compiled,
        snapshot,
        eventType: 'capability.outcome',
        nodeId: priorDecision.node_id,
        fingerprint: context.currentWorktreeFingerprint,
        payload: outcomePayload(priorDecision.payload, 'deduplicated', succeeded.payload.external_reference),
      });
      return decision;
    }
    if (decision.status === 'authorized') {
      const freshAuthority = assertRequestAuthority({
        workspace,
        task,
        request,
        action: `reserve ${request.type}`,
      });
      if (freshAuthority.authority.decision_digest !== context.authority_decision_digest) {
        throw new Error('Lifecycle authorization changed while the capability reservation was being created.');
      }
      const freshInterception = assertRequestInterception({
        workspace,
        task,
        request,
        action: `reserve ${request.type}`,
      });
      if (freshInterception.probe_digest !== context.interception_probe_digest) {
        throw new Error('Trusted host interception changed while the capability reservation was being created.');
      }
      const reservation = createReservation({ sessionDir, request, decision, context });
      if (afterReservation !== null) {
        afterReservation({ decision: structuredClone(decision), reservation: structuredClone(reservation) });
      }
    }
    appendCapabilityEvent({
      sessionDir,
      compiled,
      snapshot,
      eventType: 'capability.decision',
      nodeId: request.node_id,
      fingerprint: context.currentWorktreeFingerprint,
      payload: decisionPayload(decision),
    });
    return decision;
  });
}

function revalidateDecision({ workspace, task, sessionDir, compiled, snapshot, request, decisionEvent }) {
  const requestDigest = capabilityRequestDigest(request);
  const decision = decisionEvent.payload;
  if (request.request_id !== decision.request_id
    || request.node_id !== decisionEvent.node_id
    || request.type !== decision.capability_type
    || requestDigest !== decision.request_digest) {
    throw new Error('Outcome request does not match its authorized capability decision.');
  }
  const context = brokerContext({ workspace, task, sessionDir, compiled, snapshot });
  const authority = assertRequestAuthority({
    workspace,
    task,
    request,
    action: `execute ${request.type}`,
  });
  const interception = assertRequestInterception({
    workspace,
    task,
    request,
    action: `execute ${request.type}`,
  });
  const pendingReservation = JSON.parse(readFileSync(
    reservationPaths(sessionDir, decision.decision_digest).pending,
    'utf8',
  ));
  if (pendingReservation.hard_enforcement?.authority_decision_digest
    !== authority.authority.decision_digest) {
    throw new Error('Capability reservation is bound to a stale or replaced lifecycle authority decision.');
  }
  if (pendingReservation.hard_enforcement?.interception_probe_digest
    !== interception.probe_digest
    || context.interception_probe_digest !== interception.probe_digest) {
    throw new Error('Capability reservation is bound to stale or replaced trusted host interception evidence.');
  }
  const revalidated = authorizeCapability(request, { ...context, priorDecisions: [] });
  if (revalidated.status !== 'authorized' || revalidated.decision_digest !== decision.decision_digest) {
    throw new Error(`Capability authorization is stale at execution time: ${revalidated.reason_codes.join(',') || 'digest_mismatch'}.`);
  }
  return context;
}

function appendRecordedOutcome({
  workspace,
  sessionDir,
  compiled,
  decisionDigest,
  status,
  externalReference,
  error,
  expectedPreviousEventDigest,
}) {
  return withJournalRetry(() => {
    const snapshot = readWorkflowJournal(sessionDir, compiled);
    const actualPreviousEventDigest = snapshot.events.at(-1)?.event_digest ?? null;
    if (expectedPreviousEventDigest !== undefined && actualPreviousEventDigest !== expectedPreviousEventDigest) {
      throw new Error('Workflow journal advanced after capability execution authorization; outcome append is refused.');
    }
    const decisionEvent = snapshot.events.find((event) => event.event_type === 'capability.decision'
      && event.payload.decision_digest === decisionDigest);
    if (!decisionEvent || decisionEvent.payload.decision !== 'authorized') {
      throw new Error('Outcome must reference an authorized capability decision.');
    }
    if (snapshot.events.some((event) => event.event_type === 'capability.outcome'
      && event.payload.decision_digest === decisionDigest && event.payload.status === 'succeeded')) {
      throw new Error('A succeeded capability outcome is immutable.');
    }
    const payload = outcomePayload(decisionEvent.payload, status, externalReference, error);
    appendCapabilityEvent({
      sessionDir,
      compiled,
      snapshot,
      eventType: 'capability.outcome',
      nodeId: decisionEvent.node_id,
      fingerprint: worktreeFingerprint(workspace),
      payload,
    });
    return payload;
  });
}

function validateClaimedReservation({ workspace, sessionDir, compiled, decisionDigest }) {
  const paths = reservationPaths(sessionDir, decisionDigest);
  const file = existsSync(paths.consuming) ? paths.consuming : (existsSync(paths.completed) ? paths.completed : null);
  if (!file) throw new Error('Capability reservation is not in the consuming lane.');
  const reservation = JSON.parse(readFileSync(file, 'utf8'));
  const request = reservation.request;
  const contractErrors = validateCapabilityRequest(request);
  if (contractErrors.length) throw new Error(`Claimed capability request is invalid: ${contractErrors.join('; ')}`);
  const requestDigest = capabilityRequestDigest(request);
  if (reservation.decision_digest !== decisionDigest
    || reservation.request_digest !== requestDigest
    || reservation.request_id !== request.request_id
    || reservation.workflow_id !== request.workflow_id
    || reservation.node_id !== request.node_id
    || reservation.capability_type !== request.type) {
    throw new Error('Claimed capability reservation digest binding is invalid.');
  }
  const branch = gitMetadata(workspace).current_branch;
  const protectedSet = protectedBranches(workspace);
  if (BRANCH_BOUND_CAPABILITIES.has(request.type) && (!branch || protectedSet.includes(branch))) {
    throw new Error('Claimed capability no longer has an enforceable unprotected branch binding.');
  }
  const expectedBinding = reservationBinding(request, {
    authority_decision_digest: reservation.hard_enforcement?.authority_decision_digest,
    interception_probe_digest: reservation.hard_enforcement?.interception_probe_digest,
    current_branch: branch,
    protected_branches: protectedSet,
  });
  if (canonicalJson(reservation.hard_enforcement) !== canonicalJson(expectedBinding)) {
    throw new Error('Claimed capability hard-enforcement binding is invalid.');
  }
  const snapshot = readWorkflowJournal(sessionDir, compiled);
  const decisionEvent = snapshot.events.find((event) => event.event_type === 'capability.decision'
    && event.payload.decision_digest === decisionDigest
    && event.payload.decision === 'authorized');
  if (!decisionEvent
    || decisionEvent.node_id !== request.node_id
    || decisionEvent.payload.request_id !== request.request_id
    || decisionEvent.payload.request_digest !== requestDigest
    || decisionEvent.payload.capability_type !== request.type
    || decisionEvent.payload.idempotency_key !== reservation.idempotency_key) {
    throw new Error('Claimed capability request does not match its authorized journal decision.');
  }
  return { paths, reservation, request, snapshot };
}

function finalizeClaimed({
  workspace,
  sessionDir,
  compiled,
  decisionDigest,
  status,
  externalReference,
  error,
}) {
  if (!['succeeded', 'failed'].includes(status)) {
    throw new Error('Claimed capability outcome status must be succeeded or failed.');
  }
  if (status === 'failed' && (typeof error !== 'string' || error.length === 0)) {
    throw new Error('A failed claimed capability outcome requires an error.');
  }
  const claimed = validateClaimedReservation({ workspace, sessionDir, compiled, decisionDigest });
  const existing = claimed.snapshot.events.find((event) => event.event_type === 'capability.outcome'
    && event.payload.decision_digest === decisionDigest
    && event.payload.status === status);
  if (existing) {
    if (existing.payload.external_reference !== externalReference || existing.payload.error !== error) {
      throw new Error('Claimed capability outcome conflicts with its existing journal outcome.');
    }
    if (existsSync(claimed.paths.consuming)) completeReservation(claimed.paths, existing.payload);
    return existing.payload;
  }
  const outcome = appendRecordedOutcome({
    workspace,
    sessionDir,
    compiled,
    decisionDigest,
    status,
    externalReference,
    error,
  });
  completeReservation(claimed.paths, outcome);
  return outcome;
}

export function finalizeClaimedCapability({
  workspace: workspaceInput,
  task: requestedTask,
  decisionDigest,
  status,
  externalReference = null,
  error = null,
}) {
  const workspace = workspacePath(workspaceInput);
  const task = resolveTask(workspace, requestedTask);
  const sessionDir = sessionPaths(workspace, task).sessionDir;
  const compiled = readJson(workflowPaths(sessionDir).planFile);
  if (!compiled) throw new Error('A compiled workflow is required before capability finalization.');
  return finalizeClaimed({
    workspace,
    sessionDir,
    compiled,
    decisionDigest,
    status,
    externalReference,
    error,
  });
}

function recordOutcome({ workspace, sessionDir, compiled, args }) {
  if (!['succeeded', 'failed'].includes(args.status)) {
    throw new Error('outcome requires --status succeeded or --status failed.');
  }
  if (!args['decision-digest']) throw new Error('outcome requires --decision-digest.');
  if (!args.input) throw new Error('outcome requires the original --input <request.json>.');
  if (args.status === 'failed' && !args.error) throw new Error('A failed outcome requires --error.');
  const request = readInput(args.input);
  const claimed = validateClaimedReservation({
    workspace,
    sessionDir,
    compiled,
    decisionDigest: args['decision-digest'],
  });
  if (canonicalJson(request) !== canonicalJson(claimed.request)) {
    throw new Error('Outcome input does not match the claimed capability request.');
  }
  return finalizeClaimed({
    workspace,
    sessionDir,
    compiled,
    decisionDigest: args['decision-digest'],
    status: args.status,
    externalReference: args['external-id'] ?? null,
    error: args.error ?? null,
  });
}

function validateExecutionBindings(request, execution) {
  if (!execution || !['succeeded', 'failed'].includes(execution.status)) {
    throw new Error('Capability adapter must return status succeeded or failed.');
  }
  const expected = {
    request_digest: capabilityRequestDigest(request),
    worktree_fingerprint: request.worktreeFingerprint,
    ...(request.headSha ? { head_sha: request.headSha } : {}),
    ...((request.patchDigest ?? request.bodyDigest)
      ? { body_digest: request.patchDigest ?? request.bodyDigest }
      : {}),
  };
  for (const [field, value] of Object.entries(expected)) {
    if (execution[field] !== value) throw new Error(`Capability adapter did not revalidate ${field}.`);
  }
  if (execution.status === 'failed' && (typeof execution.error !== 'string' || execution.error.length === 0)) {
    throw new Error('A failed capability adapter result requires an error.');
  }
}

export function executeAuthorizedCapability({
  workspace,
  task,
  sessionDir,
  compiled,
  request,
  adapter,
  afterReservation = null,
}) {
  if (typeof adapter !== 'function') throw new Error('Capability execution requires an adapter function.');
  const decision = authorizeRequest({
    workspace,
    task,
    sessionDir,
    compiled,
    request,
    afterReservation,
  });
  if (decision.status !== 'authorized') return { decision, outcome: null };

  const snapshot = readWorkflowJournal(sessionDir, compiled);
  const decisionEvent = snapshot.events.find((event) => event.event_type === 'capability.decision'
    && event.payload.decision_digest === decision.decision_digest);
  if (!decisionEvent) throw new Error('Authorized capability decision is missing from the journal.');
  revalidateDecision({ workspace, task, sessionDir, compiled, snapshot, request, decisionEvent });
  const reservation = claimReservation(sessionDir, decision.decision_digest);
  const authorizedAtDigest = snapshot.events.at(-1)?.event_digest ?? null;

  let execution;
  try {
    execution = adapter(structuredClone(request));
    validateExecutionBindings(request, execution);
  } catch (adapterError) {
    const outcome = appendRecordedOutcome({
      workspace,
      sessionDir,
      compiled,
      decisionDigest: decision.decision_digest,
      status: 'failed',
      externalReference: null,
      error: adapterError.message || String(adapterError),
      expectedPreviousEventDigest: authorizedAtDigest,
    });
    completeReservation(reservation, outcome);
    return { decision, outcome };
  }
  const outcome = appendRecordedOutcome({
    workspace,
    sessionDir,
    compiled,
    decisionDigest: decision.decision_digest,
    status: execution.status,
    externalReference: execution.external_reference ?? null,
    error: execution.error ?? null,
    expectedPreviousEventDigest: authorizedAtDigest,
  });
  completeReservation(reservation, outcome);
  return { decision, outcome };
}

export function runCapabilityBroker(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  const action = args._[0] ?? 'authorize';
  const workspace = workspacePath(args.workspace);
  const task = resolveTask(workspace, args.task);
  const sessionDir = sessionPaths(workspace, task).sessionDir;
  const compiled = readJson(workflowPaths(sessionDir).planFile);
  if (!compiled) throw new Error('A compiled workflow is required before capability authorization.');

  if (action === 'outcome') return recordOutcome({ workspace, sessionDir, compiled, args });
  if (!['authorize', 'execute'].includes(action)) throw new Error(`Unknown capability broker action: ${action}`);
  if (!args.input) throw new Error(`${action} requires --input <json-file|/dev/stdin>.`);
  const request = readInput(args.input);
  if (action === 'execute') {
    return executeAuthorizedCapability({
      workspace,
      task,
      sessionDir,
      compiled,
      request,
      adapter: options.adapter,
      afterReservation: options.afterReservation ?? null,
    });
  }
  return authorizeRequest({
    workspace,
    task,
    sessionDir,
    compiled,
    request,
    afterReservation: options.afterReservation ?? null,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    const result = runCapabilityBroker();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === 'denied') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
