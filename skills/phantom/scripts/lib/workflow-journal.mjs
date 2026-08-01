// Author: Subash Karki
// Durable append-only journal and strict replay for workflow contract v2.

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { atomicWriteJson, now, readJson } from './portable.mjs';
import {
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_PLAN_SCHEMA_VERSION,
  WorkflowContractError,
  assertContract,
  canonicalJson,
  digestValue,
  isPortableWorkflowPath,
  validateWorkflowEvent,
} from './workflow-contracts.mjs';
import { readRegularFileOnce } from './filesystem-snapshot.mjs';
import {
  compileWorkflow,
  createInitialState,
  reduceWorkflowEvent,
} from './workflow-kernel.mjs';
import { verifyCapabilityExecutionAttestation } from './host-adapter-contracts.mjs';

const LOCK_WAIT_MS = 2_000;
const STALE_LOCK_MS = 5 * 60_000;
const waiter = new Int32Array(new SharedArrayBuffer(4));

const fsyncDirectory = (directory) => {
  let descriptor;
  try {
    descriptor = openSync(directory, 'r');
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

export const workflowPaths = (sessionDir) => {
  if (typeof sessionDir !== 'string' || sessionDir.length === 0) throw new Error('sessionDir is required.');
  const directory = join(sessionDir, 'workflow');
  return {
    directory,
    planFile: join(directory, 'plan.json'),
    journalFile: join(directory, 'events.jsonl'),
    stateFile: join(directory, 'state.json'),
    lockFile: join(directory, '.journal.lock'),
  };
};

const processAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const readLockGeneration = (file) => {
  let descriptor;
  try {
    descriptor = openSync(file, 'r');
    const metadata = fstatSync(descriptor);
    return { raw: readFileSync(descriptor, 'utf8'), mtimeMs: metadata.mtimeMs };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

const judgedStaleGeneration = (file) => {
  const generation = readLockGeneration(file);
  if (!generation) return null;
  const complete = generation.raw.endsWith('\n');
  try {
    const value = complete ? JSON.parse(generation.raw) : null;
    if (Number.isInteger(value?.pid) && value.pid > 0) {
      return processAlive(value.pid) ? null : generation.raw;
    }
  } catch {
    // A malformed or partially written owner is unknown, not provably dead.
  }
  return Date.now() - generation.mtimeMs > STALE_LOCK_MS ? generation.raw : null;
};

const restoreRelocatedGeneration = (relocated, file) => {
  try {
    linkSync(relocated, file);
    fsyncDirectory(dirname(file));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    try { unlinkSync(relocated); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    fsyncDirectory(dirname(file));
  }
};

const relocateExactGeneration = (file, judgedRaw, purpose) => {
  const relocated = `${file}.${purpose}.${process.pid}.${randomUUID()}`;
  try {
    renameSync(file, relocated);
    fsyncDirectory(dirname(file));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const moved = readFileSync(relocated, 'utf8');
  if (moved !== judgedRaw) {
    restoreRelocatedGeneration(relocated, file);
    return false;
  }
  unlinkSync(relocated);
  fsyncDirectory(dirname(file));
  return true;
};

const withJournalLock = (paths, action) => {
  mkdirSync(paths.directory, { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  const token = randomUUID();
  const lockRecord = `${JSON.stringify({ pid: process.pid, token, created_at: now() })}\n`;
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(paths.lockFile, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stale = judgedStaleGeneration(paths.lockFile);
      if (stale !== null && relocateExactGeneration(paths.lockFile, stale, 'stale')) continue;
      if (Date.now() >= deadline) throw new Error('Workflow journal mutation is already in progress.');
      Atomics.wait(waiter, 0, 0, 10);
    }
  }
  try {
    writeFileSync(descriptor, lockRecord, 'utf8');
    fsyncSync(descriptor);
    fsyncDirectory(paths.directory);
  } catch (error) {
    closeSync(descriptor);
    const generation = readLockGeneration(paths.lockFile);
    if (generation?.raw === lockRecord) relocateExactGeneration(paths.lockFile, lockRecord, 'failed');
    throw error;
  }
  try {
    return action();
  } finally {
    closeSync(descriptor);
    const generation = readLockGeneration(paths.lockFile);
    if (generation) {
      let owner = null;
      try { owner = JSON.parse(generation.raw); } catch {}
      if (owner?.token === token) relocateExactGeneration(paths.lockFile, generation.raw, 'release');
    }
  }
};

const assertCompiled = (compiled) => {
  if (compiled?.schema_version !== WORKFLOW_PLAN_SCHEMA_VERSION) {
    throw new WorkflowContractError('Invalid compiled workflow', [
      `unsupported compiled workflow contract version ${JSON.stringify(compiled?.schema_version)}; expected ${WORKFLOW_PLAN_SCHEMA_VERSION}`,
    ]);
  }
  const canonical = compileWorkflow(compiled?.plan || {});
  if (compiled.plan_digest !== canonical.plan_digest
    || canonicalJson(compiled) !== canonicalJson(canonical)) {
    throw new WorkflowContractError('Invalid compiled workflow', ['compiled plan or digest is inconsistent']);
  }
  return canonical;
};

export function writeCompiledWorkflow(sessionDir, compiled) {
  const canonical = assertCompiled(compiled);
  const paths = workflowPaths(sessionDir);
  mkdirSync(paths.directory, { recursive: true });
  fsyncDirectory(dirname(paths.directory));
  return withJournalLock(paths, () => bindCompiledWorkflow(paths, canonical));
}

const bindCompiledWorkflow = (paths, canonical) => {
  const existing = readJson(paths.planFile);
  if (existing) {
    const bound = assertCompiled(existing);
    if (bound.plan_digest !== canonical.plan_digest) {
      throw new Error('A different workflow plan is already bound to this session.');
    }
  }
  if (!existing) {
    atomicWriteJson(paths.planFile, canonical);
    fsyncDirectory(paths.directory);
  }
  return { paths, compiled: canonical };
};

export function buildWorkflowEvent(previousEvent, input) {
  if (!input || typeof input !== 'object') throw new Error('Workflow event input is required.');
  const event = {
    schema_version: WORKFLOW_EVENT_SCHEMA_VERSION,
    sequence: previousEvent ? previousEvent.sequence + 1 : 1,
    event_id: input.event_id || `evt-${randomUUID()}`,
    workflow_id: input.workflow_id,
    event_type: input.event_type,
    node_id: input.node_id ?? null,
    recorded_at: input.recorded_at || now(),
    previous_event_digest: previousEvent?.event_digest || null,
    payload_digest: digestValue(input.payload || {}),
    artifact_refs: [...new Set(input.artifact_refs || [])].sort(),
    worktree_fingerprint: input.worktree_fingerprint ?? null,
    producer: structuredClone(input.producer || { role: 'apex' }),
    payload: structuredClone(input.payload || {}),
  };
  event.event_digest = digestValue(event);
  assertContract('Invalid workflow event', validateWorkflowEvent(event));
  return event;
}

export function parseWorkflowJournal(journalText) {
  if (journalText === '') return [];
  const lines = journalText.endsWith('\n') ? journalText.slice(0, -1).split('\n') : journalText.split('\n');
  if (lines.some((line) => line.length === 0)) throw new Error('Workflow journal contains an empty record.');
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Workflow journal line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
}

export function replayWorkflow(compiledInput, journalInput = '') {
  const compiled = assertCompiled(compiledInput);
  const events = Array.isArray(journalInput) ? structuredClone(journalInput) : parseWorkflowJournal(journalInput);
  const eventIds = new Set();
  let state = createInitialState(compiled);
  for (const event of events) {
    if (eventIds.has(event.event_id)) throw new Error(`Duplicate workflow event_id: ${event.event_id}`);
    eventIds.add(event.event_id);
    state = reduceWorkflowEvent(compiled, state, event);
  }
  return state;
}

const CAPABILITY_EVENT_TYPES = new Set(['capability.decision', 'capability.outcome']);
const HOST_CAPABILITY_TYPES = new Set([
  'git.commit',
  'git.push',
  'github.openDraftPr',
  'process.exec',
  'tracker.comment',
]);
const CAPABILITY_ARTIFACT_KINDS = new Set([
  'attestations',
  'execution-evidence',
  'policies',
  'registrations',
  'registry-trust',
  'requests',
  'reservations',
  'results',
  'workspace-manifests',
]);
const CAPABILITY_ARTIFACT_REFERENCE =
  /^capability\/artifacts\/([a-z-]+)\/([a-f0-9]{64})\.json$/;

const capabilityArtifactRecord = (artifactRef) => {
  const match = CAPABILITY_ARTIFACT_REFERENCE.exec(artifactRef);
  if (!match || !CAPABILITY_ARTIFACT_KINDS.has(match[1])) return null;
  return {
    artifact_ref: artifactRef,
    digest: `sha256:${match[2]}`,
    kind: match[1],
    verification: 'canonical-json',
  };
};

const capabilityArtifactReference = (kind, digest) => {
  const token = typeof digest === 'string' ? digest.replace(/^sha256:/, '') : '';
  if (!CAPABILITY_ARTIFACT_KINDS.has(kind) || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error('Capability evidence contains an invalid content address.');
  }
  return `capability/artifacts/${kind}/${token}.json`;
};

const artifactDigestRecords = (event) => {
  if (CAPABILITY_EVENT_TYPES.has(event.event_type)) {
    if (event.artifact_refs.length === 0) {
      throw new Error(`Capability event ${event.event_id} has no immutable evidence artifacts.`);
    }
    return event.artifact_refs.map((artifactRef) => {
      const record = capabilityArtifactRecord(artifactRef);
      if (!record) {
        throw new Error(
          `Capability event ${event.event_id} has a non-content-addressed evidence reference: ${artifactRef}.`,
        );
      }
      return record;
    });
  }
  const direct = event.payload?.artifact_digests;
  const receipt = event.payload?.executor_receipt?.artifact_digests;
  if (Array.isArray(direct) && Array.isArray(receipt)) {
    throw new Error(`Workflow event ${event.event_id} has ambiguous artifact digest evidence.`);
  }
  return Array.isArray(direct) ? direct : (Array.isArray(receipt) ? receipt : null);
};

const capabilityArtifactsForEvent = (event, artifacts) => event.artifact_refs
  .map((artifactRef) => artifacts.get(artifactRef));

const oneCapabilityArtifact = (event, artifacts, kind) => {
  const matches = capabilityArtifactsForEvent(event, artifacts)
    .filter((artifact) => artifact.kind === kind);
  if (matches.length !== 1) {
    throw new Error(`Capability event ${event.event_id} requires exactly one ${kind} artifact.`);
  }
  return matches[0];
};

const requireCapabilityArtifact = (event, artifacts, artifactRef, label) => {
  if (!event.artifact_refs.includes(artifactRef)) {
    throw new Error(`Capability event ${event.event_id} is missing its ${label} artifact.`);
  }
  const artifact = artifacts.get(artifactRef);
  if (!artifact) throw new Error(`Capability event ${event.event_id} has unreadable ${label} evidence.`);
  return artifact;
};

const requireExactCapabilityReferences = (event, expected) => {
  const actual = [...event.artifact_refs].sort();
  const required = [...new Set(expected)].sort();
  if (canonicalJson(actual) !== canonicalJson(required)) {
    throw new Error(`Capability event ${event.event_id} does not bind its exact evidence artifact set.`);
  }
};

const boundReservationEvidence = (event, artifacts, requestArtifact, reservationArtifact) => {
  const payload = event.payload;
  const reservation = reservationArtifact.value;
  const required = new Set([requestArtifact.artifact_ref, reservationArtifact.artifact_ref]);
  if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation)
    || reservation.schema_version !== 2
    || !['native-tool-execution', 'host-adapter-execution'].includes(reservation.reservation_kind)) {
    throw new Error(`Capability event ${event.event_id} has an invalid immutable reservation artifact.`);
  }
  for (const [field, expected] of [
    ['decision_digest', payload.decision_digest],
    ['request_digest', payload.request_digest],
    ['request_id', payload.request_id],
    ['node_id', event.node_id],
    ['capability_type', payload.capability_type],
    ['idempotency_key', payload.idempotency_key],
  ]) {
    if (reservation[field] !== expected) {
      throw new Error(`Capability event ${event.event_id} reservation ${field} binding is invalid.`);
    }
  }
  if (canonicalJson(reservation.request) !== canonicalJson(requestArtifact.value)) {
    throw new Error(`Capability event ${event.event_id} reservation request binding is invalid.`);
  }
  const host = reservation.host_adapter;
  if (reservation.reservation_kind === 'native-tool-execution') {
    if (host !== null || HOST_CAPABILITY_TYPES.has(payload.capability_type)) {
      throw new Error(`Capability event ${event.event_id} has an invalid native reservation binding.`);
    }
    return { reservation, host: null, required };
  }
  if (!host || !HOST_CAPABILITY_TYPES.has(payload.capability_type)) {
    throw new Error(`Capability event ${event.event_id} has an invalid host reservation binding.`);
  }
  const trustRef = capabilityArtifactReference('registry-trust', host.registry_trust?.digest);
  const registrationRef = capabilityArtifactReference('registrations', host.registration?.digest);
  const policyRef = capabilityArtifactReference('policies', host.policy?.digest);
  const baselineRef = capabilityArtifactReference('workspace-manifests', host.baseline_snapshot?.digest);
  if (host.registry_trust?.artifact_ref !== trustRef
    || host.registration?.artifact_ref !== registrationRef
    || host.baseline_snapshot?.artifact_ref !== baselineRef) {
    throw new Error(`Capability event ${event.event_id} reservation evidence was rebound.`);
  }
  required.add(trustRef);
  required.add(registrationRef);
  required.add(policyRef);
  required.add(baselineRef);
  const policy = requireCapabilityArtifact(event, artifacts, policyRef, 'policy');
  if (digestValue(host.policy?.value) !== host.policy?.digest
    || canonicalJson(policy.value) !== canonicalJson(host.policy.value)) {
    throw new Error(`Capability event ${event.event_id} policy artifact is inconsistent.`);
  }
  requireCapabilityArtifact(event, artifacts, trustRef, 'registry trust');
  requireCapabilityArtifact(event, artifacts, registrationRef, 'registration');
  requireCapabilityArtifact(event, artifacts, baselineRef, 'baseline workspace');
  return { reservation, host, required };
};

const verifyCapabilityDecisionEvidence = (event, artifacts) => {
  const request = oneCapabilityArtifact(event, artifacts, 'requests');
  if (request.digest !== event.payload.request_digest) {
    throw new Error(`Capability event ${event.event_id} request evidence was rebound.`);
  }
  if (event.payload.decision !== 'authorized') {
    requireExactCapabilityReferences(event, [request.artifact_ref]);
    return;
  }
  const reservation = oneCapabilityArtifact(event, artifacts, 'reservations');
  const evidence = boundReservationEvidence(event, artifacts, request, reservation);
  if (evidence.reservation.authorized_journal_tail_digest !== event.previous_event_digest
    || canonicalJson(evidence.reservation.reserved_budget)
      !== canonicalJson(event.payload.reserved_budget)) {
    throw new Error(`Capability event ${event.event_id} reservation authorization binding is invalid.`);
  }
  requireExactCapabilityReferences(event, evidence.required);
};

const attestationExpectedBindings = (compiled, event, evidence, executionValue) => {
  const request = evidence.reservation.request;
  const policy = evidence.host.policy.value;
  const expected = {
    repo_id: compiled.plan.session_binding.repo_id,
    task_id: compiled.plan.session_binding.task_id,
    capability_type: request.type,
    workflow_id: event.workflow_id,
    node_id: event.node_id,
    request_id: event.payload.request_id,
    request_digest: event.payload.request_digest,
    decision_digest: event.payload.decision_digest,
    reservation_digest: event.payload.reservation_digest,
    idempotency_key: event.payload.idempotency_key,
    execution_nonce: event.payload.execution_nonce,
    authorized_journal_tail_digest: evidence.reservation.authorized_journal_tail_digest,
    worktree_fingerprint_before: request.worktreeFingerprint,
    worktree_fingerprint_after: event.worktree_fingerprint,
    workspace_evidence_digest_before: evidence.reservation.workspace_evidence_digest_before,
    workspace_evidence_digest_after: executionValue.workspace_manifest.evidence.evidence_digest,
  };
  if (request.type === 'process.exec') {
    expected.allowed_write_paths = compiled.plan.nodes
      .find((node) => node.id === event.node_id)?.allowed_paths ?? [];
  } else if (request.type === 'git.commit') {
    Object.assign(expected, {
      branch: evidence.reservation.hard_enforcement.current_branch,
      parent_sha: evidence.reservation.hard_enforcement.head_sha,
      tree_digest: request.treeDigest,
      message_digest: evidence.reservation.hard_enforcement.body_digest,
    });
  } else if (request.type === 'git.push') {
    Object.assign(expected, {
      remote: request.remote,
      repository_id: policy.target.repository_id,
      branch: request.branch,
      head_sha: request.headSha,
    });
  } else if (request.type === 'github.openDraftPr') {
    Object.assign(expected, {
      host: policy.target.host,
      repository_id: policy.target.repository_id,
      base_ref: request.baseRef,
      head_ref: evidence.reservation.hard_enforcement.current_branch,
      head_sha: request.headSha,
      title_digest: request.titleDigest,
      body_digest: request.bodyDigest,
    });
  } else {
    Object.assign(expected, {
      provider: policy.target.provider,
      tenant_id: policy.target.tenant_id,
      project_id: policy.target.project_id,
      issue_id: request.issueId,
      body_digest: request.bodyDigest,
    });
  }
  if (event.payload.reconciliation_of !== null) {
    expected.reconciles_attestation_digest = event.payload.reconciliation_of;
  }
  return expected;
};

const verifyAttestedOutcomeEvidence = (event, artifacts, evidence, compiled, replayContext) => {
  const payload = event.payload;
  const attestation = oneCapabilityArtifact(event, artifacts, 'attestations');
  const result = oneCapabilityArtifact(event, artifacts, 'results');
  const execution = oneCapabilityArtifact(event, artifacts, 'execution-evidence');
  if (attestation.digest !== payload.attestation_digest || result.digest !== payload.result_digest) {
    throw new Error(`Capability event ${event.event_id} signed result evidence was rebound.`);
  }
  const trustRef = capabilityArtifactReference('registry-trust', payload.registry_trust_digest);
  const registrationRef = capabilityArtifactReference('registrations', payload.registration_digest);
  const policyRef = capabilityArtifactReference('policies', payload.policy_digest);
  const signingTrust = requireCapabilityArtifact(event, artifacts, trustRef, 'signing registry trust');
  const signingRegistration = requireCapabilityArtifact(
    event,
    artifacts,
    registrationRef,
    'signing registration',
  );
  requireCapabilityArtifact(event, artifacts, policyRef, 'execution policy');
  for (const artifactRef of [trustRef, registrationRef, policyRef]) evidence.required.add(artifactRef);
  const signed = attestation.value;
  for (const [field, expected] of [
    ['capability_type', payload.capability_type],
    ['workflow_id', event.workflow_id],
    ['node_id', event.node_id],
    ['request_id', payload.request_id],
    ['request_digest', payload.request_digest],
    ['decision_digest', payload.decision_digest],
    ['reservation_digest', payload.reservation_digest],
    ['idempotency_key', payload.idempotency_key],
    ['execution_nonce', payload.execution_nonce],
    ['policy_digest', payload.policy_digest],
    ['registration_digest', payload.registration_digest],
    ['reconciles_attestation_digest', payload.reconciliation_of],
  ]) {
    if (signed?.[field] !== expected) {
      throw new Error(`Capability event ${event.event_id} attestation ${field} binding is invalid.`);
    }
  }
  const resolvedStatus = signed.status === 'reconciled' ? signed.resolution : signed.status;
  if (resolvedStatus !== payload.status
    || canonicalJson(signed.result) !== canonicalJson(result.value)
    || signed.result?.external_reference !== payload.external_reference
    || signed.result?.error !== payload.error) {
    throw new Error(`Capability event ${event.event_id} attested result is inconsistent.`);
  }
  if (signed.worktree_fingerprint_before !== evidence.reservation.request.worktreeFingerprint
    || signed.workspace_evidence_digest_before
      !== evidence.reservation.workspace_evidence_digest_before
    || signed.worktree_fingerprint_after !== event.worktree_fingerprint) {
    throw new Error(`Capability event ${event.event_id} attested workspace binding is invalid.`);
  }
  const executionValue = execution.value;
  const workspace = executionValue?.workspace_manifest;
  const workspaceRef = capabilityArtifactReference('workspace-manifests', workspace?.digest);
  if (executionValue?.schema_version !== 1
    || executionValue.worktree_fingerprint !== signed.worktree_fingerprint_after
    || workspace?.artifact_ref !== workspaceRef
    || workspace?.evidence?.evidence_digest !== signed.workspace_evidence_digest_after) {
    throw new Error(`Capability event ${event.event_id} execution snapshot binding is invalid.`);
  }
  const authorizedTrustRef = capabilityArtifactReference(
    'registry-trust',
    evidence.host.registry_trust.digest,
  );
  const authorizedRegistrationRef = capabilityArtifactReference(
    'registrations',
    evidence.host.registration.digest,
  );
  const prior = payload.reconciliation_of === null
    ? null
    : replayContext.attestations.get(payload.reconciliation_of);
  if (payload.reconciliation_of !== null && !prior) {
    throw new Error(`Capability event ${event.event_id} reconciliation attestation is not historical.`);
  }
  const recordedAtMs = Date.parse(event.recorded_at);
  const verified = verifyCapabilityExecutionAttestation({
    registration: artifacts.get(authorizedRegistrationRef).value,
    registryTrust: artifacts.get(authorizedTrustRef).value,
    attestation: signed,
    expected: attestationExpectedBindings(compiled, event, evidence, executionValue),
    nowMs: recordedAtMs,
    recordedAt: event.recorded_at,
    usedReplayIds: replayContext.replayIds,
    usedSourceEventIds: replayContext.sourceEventIds,
    usedExecutionBindingDigests: replayContext.executionBindingDigests,
    reconciliation: prior ? {
      registration: signingRegistration.value,
      registry_trust: signingTrust.value,
      prior_attestation: prior.attestation,
      prior_recorded_at: prior.recorded_at,
    } : null,
  });
  for (const [field, expected] of [
    ['attestation_digest', payload.attestation_digest],
    ['registration_digest', payload.registration_digest],
    ['registry_trust_digest', payload.registry_trust_digest],
    ['policy_digest', payload.policy_digest],
    ['result_digest', payload.result_digest],
    ['resolved_status', payload.status],
    ['external_reference', payload.external_reference],
    ['worktree_fingerprint_after', event.worktree_fingerprint],
    ['workspace_evidence_digest_after', signed.workspace_evidence_digest_after],
  ]) {
    if (verified[field] !== expected) {
      throw new Error(`Capability event ${event.event_id} verified ${field} binding is invalid.`);
    }
  }
  requireCapabilityArtifact(event, artifacts, workspaceRef, 'workspace-after snapshot');
  for (const artifactRef of [
    attestation.artifact_ref,
    result.artifact_ref,
    execution.artifact_ref,
    workspaceRef,
  ]) evidence.required.add(artifactRef);
  requireExactCapabilityReferences(event, evidence.required);
  replayContext.replayIds.push(verified.attestation_replay_id);
  replayContext.sourceEventIds.push(verified.attestation_source_event_id);
  replayContext.executionBindingDigests.push(verified.execution_binding_digest);
  replayContext.attestations.set(verified.attestation_digest, {
    attestation: signed,
    recorded_at: event.recorded_at,
  });
};

const verifyCapabilityOutcomeEvidence = (event, artifacts, compiled, replayContext) => {
  const request = oneCapabilityArtifact(event, artifacts, 'requests');
  const reservation = oneCapabilityArtifact(event, artifacts, 'reservations');
  if (request.digest !== event.payload.request_digest
    || reservation.digest !== event.payload.reservation_digest) {
    throw new Error(`Capability event ${event.event_id} request or reservation evidence was rebound.`);
  }
  const evidence = boundReservationEvidence(event, artifacts, request, reservation);
  if (evidence.reservation.execution_nonce !== event.payload.execution_nonce
    || canonicalJson(evidence.reservation.reserved_budget)
      !== canonicalJson(event.payload.budget_charge)) {
    throw new Error(`Capability event ${event.event_id} reservation outcome binding is invalid.`);
  }
  if (event.payload.outcome_kind === 'native-tool-execution') {
    if (evidence.host !== null) {
      throw new Error(`Capability event ${event.event_id} native outcome uses host evidence.`);
    }
    requireExactCapabilityReferences(event, evidence.required);
    return;
  }
  if (evidence.host === null
    || event.payload.policy_digest !== evidence.host.policy.digest
    || event.payload.registry_trust_digest === undefined
    || event.payload.registration_digest === undefined) {
    throw new Error(`Capability event ${event.event_id} signed outcome lacks host evidence.`);
  }
  verifyAttestedOutcomeEvidence(event, artifacts, evidence, compiled, replayContext);
};

const verifyCapabilityEventEvidence = (event, artifacts, compiled, replayContext) => {
  if (event.event_type === 'capability.decision') {
    verifyCapabilityDecisionEvidence(event, artifacts);
  } else {
    verifyCapabilityOutcomeEvidence(event, artifacts, compiled, replayContext);
  }
};

const within = (root, candidate) => {
  const offset = relative(root, candidate);
  return offset !== '' && !offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset);
};

export function verifyWorkflowArtifacts(sessionDir, events, compiledInput) {
  if (!Array.isArray(events)) throw new Error('Workflow artifact verification requires replayed events.');
  const compiled = assertCompiled(compiledInput);
  const bindings = new Map();

  for (const event of events) {
    const records = artifactDigestRecords(event);
    if (event.artifact_refs.length === 0) continue;
    if (!records) {
      throw new Error(`Workflow event ${event.event_id} references artifacts without digest evidence.`);
    }
    const byReference = new Map(records.map((record) => [record.artifact_ref, record.digest]));
    if (byReference.size !== records.length
      || event.artifact_refs.length !== records.length
      || event.artifact_refs.some((artifactRef) => !byReference.has(artifactRef))) {
      throw new Error(`Workflow event ${event.event_id} artifact references do not exactly match digest evidence.`);
    }
    for (const artifactRef of event.artifact_refs) {
      if (!isPortableWorkflowPath(artifactRef) || artifactRef === '.') {
        throw new Error(`Workflow artifact reference is not a safe session-relative file: ${artifactRef}`);
      }
      const digest = byReference.get(artifactRef);
      const record = records.find((candidate) => candidate.artifact_ref === artifactRef);
      const previous = bindings.get(artifactRef);
      if (previous && (previous.digest !== digest
        || previous.verification !== (record.verification ?? 'bytes'))) {
        throw new Error(
          `Workflow artifact reference ${artifactRef} was rebound from ${previous.digest} `
          + `to ${digest}; historical artifact references are immutable.`,
        );
      }
      if (!previous) bindings.set(artifactRef, {
        digest,
        event_id: event.event_id,
        kind: record.kind ?? null,
        verification: record.verification ?? 'bytes',
      });
    }
  }

  if (bindings.size === 0) return [];
  const root = resolve(realpathSync(sessionDir));
  const capabilityArtifacts = new Map();
  for (const [artifactRef, binding] of bindings) {
    const candidate = resolve(root, artifactRef);
    if (!within(root, candidate)) {
      throw new Error(`Workflow artifact escapes the canonical session boundary: ${artifactRef}`);
    }
    let record;
    try {
      record = readRegularFileOnce(candidate, root);
    } catch (error) {
      throw new Error(
        `Workflow artifact ${artifactRef} referenced by ${binding.event_id} is missing or unsafe: ${error.message}`,
      );
    }
    if (record.physical.nlink !== 1) {
      throw new Error(`Workflow artifact ${artifactRef} must be a single-link regular file.`);
    }
    let actual;
    if (binding.verification === 'canonical-json') {
      if (record.mode !== 0o600) {
        throw new Error(`Capability artifact ${artifactRef} must be a private regular file.`);
      }
      let value;
      try {
        value = JSON.parse(record.bytes.toString('utf8'));
      } catch (error) {
        throw new Error(`Capability artifact ${artifactRef} is invalid JSON: ${error.message}`);
      }
      if (record.bytes.toString('utf8') !== `${canonicalJson(value)}\n`) {
        throw new Error(`Capability artifact ${artifactRef} is not canonical JSON.`);
      }
      actual = digestValue(value);
      capabilityArtifacts.set(artifactRef, {
        artifact_ref: artifactRef,
        digest: actual,
        kind: binding.kind,
        value,
      });
    } else {
      actual = `sha256:${createHash('sha256').update(record.bytes).digest('hex')}`;
    }
    if (actual !== binding.digest) {
      throw new Error(
        `Workflow artifact ${artifactRef} digest mismatch: expected ${binding.digest}, found ${actual}.`,
      );
    }
  }
  const replayContext = {
    attestations: new Map(),
    executionBindingDigests: [],
    replayIds: [],
    sourceEventIds: [],
  };
  for (const event of events) {
    if (CAPABILITY_EVENT_TYPES.has(event.event_type)) {
      verifyCapabilityEventEvidence(event, capabilityArtifacts, compiled, replayContext);
    }
  }
  return [...bindings].map(([artifact_ref, binding]) => ({ artifact_ref, digest: binding.digest }));
}

const readWorkflowJournalUnchecked = (sessionDir, compiledInput) => {
  const paths = workflowPaths(sessionDir);
  const text = existsSync(paths.journalFile) ? readFileSync(paths.journalFile, 'utf8') : '';
  const events = parseWorkflowJournal(text);
  const state = replayWorkflow(compiledInput, events);
  return { paths, events, state };
};

export function readWorkflowJournal(sessionDir, compiledInput) {
  const journal = readWorkflowJournalUnchecked(sessionDir, compiledInput);
  verifyWorkflowArtifacts(sessionDir, journal.events, compiledInput);
  return journal;
}

const appendDurably = (file, event) => {
  const descriptor = openSync(file, 'a', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(event)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncDirectory(dirname(file));
};

/**
 * Public broker/kernel integration API. The caller supplies the active session,
 * compiled v2 plan, and an unhashed event input; this function serializes,
 * validates, appends, replays, and atomically refreshes the materialized view.
 */
export class WorkflowJournalConflictError extends Error {
  constructor(expected, actual) {
    super(`Workflow journal tail changed: expected ${expected ?? 'null'}, found ${actual ?? 'null'}.`);
    this.name = 'WorkflowJournalConflictError';
    this.code = 'WORKFLOW_JOURNAL_CONFLICT';
    this.expected = expected;
    this.actual = actual;
  }
}

export function appendWorkflowEvent({
  sessionDir,
  compiled: compiledInput,
  input,
  expected_previous_event_digest,
}) {
  const compiled = assertCompiled(compiledInput);
  const paths = workflowPaths(sessionDir);
  return withJournalLock(paths, () => {
    bindCompiledWorkflow(paths, compiled);
    const before = readWorkflowJournalUnchecked(sessionDir, compiled);
    if (input.event_id && before.events.some((event) => event.event_id === input.event_id)) {
      throw new Error(`Duplicate workflow event_id: ${input.event_id}`);
    }
    const previous = before.events.at(-1) || null;
    const actualPreviousDigest = previous?.event_digest || null;
    if (expected_previous_event_digest !== undefined
      && expected_previous_event_digest !== actualPreviousDigest) {
      throw new WorkflowJournalConflictError(expected_previous_event_digest, actualPreviousDigest);
    }
    const event = buildWorkflowEvent(previous, { ...input, workflow_id: compiled.plan.workflow_id });
    const state = reduceWorkflowEvent(compiled, before.state, event);
    verifyWorkflowArtifacts(sessionDir, [...before.events, event], compiled);
    appendDurably(paths.journalFile, event);
    atomicWriteJson(paths.stateFile, state);
    fsyncDirectory(paths.directory);
    return { event, state, paths };
  });
}

export const appendAndReduce = appendWorkflowEvent;

export function replayWorkflowSession(sessionDir) {
  const paths = workflowPaths(sessionDir);
  const compiled = readJson(paths.planFile);
  if (!compiled) throw new Error('Workflow plan is not initialized for this session.');
  const { events, state } = readWorkflowJournal(sessionDir, compiled);
  return { compiled: assertCompiled(compiled), events, state, paths };
}

export const workflowJournalLockInternals = Object.freeze({
  judgedStaleGeneration,
  relocateExactGeneration,
});
