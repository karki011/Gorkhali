#!/usr/bin/env node
// Author: Subash Karki

import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import {
  currentSessionFile,
  dataRoot,
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
  assertCapabilityReservation,
  assertCapabilityReservationTransition,
  authorizeCapability,
  canonicalJson,
  capabilityDecisionRecord,
  capabilityRequestDigest,
  sha256,
  validateCapabilityRequest,
} from './lib/capability-contracts.mjs';
import {
  isPortableWorkspacePath,
  readStableJsonFile,
  workspaceSnapshot,
} from './lib/filesystem-snapshot.mjs';
import { gitMetadata } from './lib/git-metadata.mjs';
import {
  buildWorkspaceManifest,
  compactWorkspaceEvidence,
  diffWorkspaceManifests,
  verifyWorkspaceManifest,
} from './lib/workspace-manifest.mjs';
import {
  HostAdapterContractError,
  SUPPORTED_ADAPTER_CAPABILITIES,
  adapterCapabilityPolicyDigest,
  capabilityExecutionBindingDigest,
  capabilityExecutionAttestationDigest,
  hostAdapterRegistrationDigest,
  hostAdapterRegistryTrustDigest,
  verifyCapabilityExecutionAttestation,
  verifyHostAdapterRegistration,
} from './lib/host-adapter-contracts.mjs';
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
const HOST_ATTESTED_CAPABILITIES = new Set(SUPPORTED_ADAPTER_CAPABILITIES);
const HOST_ADAPTER_BINDING = 'signed-host-adapter-v1';
const NATIVE_ADAPTER_BINDING = 'native-tool-gate-v1';
const REGISTRY_TRUST_FILE = 'host-adapter-registry-trust.json';
const REGISTRATION_FILE = 'host-adapter-registration.json';
const ARTIFACT_KINDS = Object.freeze({
  request: 'requests',
  reservation: 'reservations',
  registryTrust: 'registry-trust',
  registration: 'registrations',
  policy: 'policies',
  attestation: 'attestations',
  result: 'results',
  snapshot: 'workspace-manifests',
  executionEvidence: 'execution-evidence',
});

const AUTHORIZATION_SCOPE = Object.freeze({
  'workspace.write': 'implementation',
  'process.exec': 'implementation',
  'git.commit': 'implementation',
  'git.push': 'ship-draft-pr',
  'github.openDraftPr': 'ship-draft-pr',
  'tracker.comment': 'tracker-comment',
});

function compareCodeUnits(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function readInput(file) {
  if (!file || file === '/dev/stdin') return JSON.parse(readFileSync(0, 'utf8'));
  return readStableJsonFile(file).value;
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const metadata = fstatSync(descriptor);
    if (!metadata.isDirectory()) throw new Error(`Expected a directory: ${directory}`);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function pathWithin(root, candidate) {
  const offset = relative(root, candidate);
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}

function assertDirectoryChain(rootInput, directoryInput, { create = false, privateChildren = false } = {}) {
  const root = resolve(rootInput);
  const directory = resolve(directoryInput);
  if (!pathWithin(root, directory)) {
    throw new Error(`Capability state path escapes its trusted root: ${directory}`);
  }
  const rootMetadata = lstatSync(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`Capability state root must be a regular non-symlink directory: ${root}`);
  }
  let current = root;
  const offset = relative(root, directory);
  for (const segment of offset === '' ? [] : offset.split(sep)) {
    current = join(current, segment);
    if (!existsSync(current)) {
      if (!create) throw new Error(`Capability state directory is missing: ${current}`);
      mkdirSync(current, { mode: 0o700 });
    }
    const metadata = lstatSync(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()
      || (privateChildren && (metadata.mode & 0o077) !== 0)) {
      throw new Error(`Capability state directory is not secure: ${current}`);
    }
  }
  return directory;
}

function assertFileBelow(root, file) {
  assertDirectoryChain(root, dirname(resolve(file)));
  if (!pathWithin(resolve(root), resolve(file))) {
    throw new Error(`Capability state file escapes its trusted root: ${file}`);
  }
}

function ensurePrivateDirectory(root, directory) {
  return assertDirectoryChain(root, directory, { create: true, privateChildren: true });
}

function durableReplacePrivateJson(root, file, value) {
  const directory = ensurePrivateDirectory(root, dirname(file));
  if (existsSync(file)) {
    assertFileBelow(root, file);
    readPrivateJson(file, 'Capability state file', { canonical: true });
  }
  const temporary = join(directory, `.${basename(file)}.tmp-${process.pid}-${randomBytes(12).toString('hex')}`);
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, `${canonicalJson(value)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  renameSync(temporary, file);
  fsyncDirectory(directory);
}

function writeNewPrivateJson(root, file, value, label = 'Capability state file') {
  const directory = ensurePrivateDirectory(root, dirname(file));
  let descriptor;
  try {
    descriptor = openSync(
      file,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, `${canonicalJson(value)}\n`, 'utf8');
    fsyncSync(descriptor);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = readPrivateJson(file, label, { canonical: true }).value;
    if (canonicalJson(existing) !== canonicalJson(value)) {
      throw new Error(`${label} conflicts with existing immutable content.`);
    }
    return existing;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  fsyncDirectory(directory);
  return value;
}

function assertPrivateJsonRecord(record, label, { canonical = false } = {}) {
  if (record.mode !== 0o600 || record.physical.nlink !== 1) {
    throw new Error(`${label} must be a private, single-link regular file.`);
  }
  if (canonical && record.bytes.toString('utf8') !== `${canonicalJson(record.value)}\n`) {
    throw new Error(`${label} is not in canonical immutable form.`);
  }
  return record;
}

function readPrivateJson(file, label, options = {}) {
  try {
    return assertPrivateJsonRecord(readStableJsonFile(file), label, options);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label} is missing.`);
    throw error;
  }
}

function artifactFile(sessionDir, kind, digest) {
  const token = digest.replace(/^sha256:/, '');
  if (!Object.values(ARTIFACT_KINDS).includes(kind) || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error('Capability artifact reference is invalid.');
  }
  return join(sessionDir, 'capability', 'artifacts', kind, `${token}.json`);
}

function artifactReference(sessionDir, file) {
  return relative(sessionDir, file).split(sep).join('/');
}

function readArtifact(sessionDir, kind, digest, expectedReference = null) {
  const file = artifactFile(sessionDir, kind, digest);
  if (expectedReference !== null && expectedReference !== artifactReference(sessionDir, file)) {
    throw new Error('Capability artifact reference does not match its content address.');
  }
  assertFileBelow(sessionDir, file);
  const record = readPrivateJson(file, 'Capability artifact', { canonical: true });
  if (sha256(canonicalJson(record.value)) !== digest) {
    throw new Error('Capability artifact content does not match its digest address.');
  }
  return { ...record, file, reference: artifactReference(sessionDir, file) };
}

function storeArtifact(sessionDir, kind, value, expectedDigest) {
  const digest = sha256(canonicalJson(value));
  if (digest !== expectedDigest) throw new Error('Capability artifact digest is inconsistent.');
  const file = artifactFile(sessionDir, kind, digest);
  const directory = ensurePrivateDirectory(sessionDir, dirname(file));
  if (existsSync(file)) return readArtifact(sessionDir, kind, digest);
  const noFollow = constants.O_NOFOLLOW;
  if (!Number.isInteger(noFollow)) throw new Error('This runtime cannot enforce no-follow artifact writes.');
  let descriptor;
  try {
    descriptor = openSync(
      file,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    );
    writeFileSync(descriptor, `${canonicalJson(value)}\n`, 'utf8');
    fsyncSync(descriptor);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  fsyncDirectory(directory);
  return readArtifact(sessionDir, kind, digest);
}

function requestArtifactValue(request) {
  return request !== null && typeof request === 'object' && !Array.isArray(request)
    ? request
    : { invalid_request: request };
}

function storeRequestArtifact(sessionDir, request, expectedDigest) {
  return storeArtifact(
    sessionDir,
    ARTIFACT_KINDS.request,
    requestArtifactValue(request),
    expectedDigest,
  );
}

function reservationArtifactReferences(sessionDir, reservation) {
  const binding = reservation.reservation_binding;
  const references = [
    readArtifact(sessionDir, ARTIFACT_KINDS.request, reservation.request_digest).reference,
    readArtifact(sessionDir, ARTIFACT_KINDS.reservation, reservation.reservation_digest).reference,
  ];
  const host = binding.host_adapter;
  if (host) {
    references.push(
      readArtifact(
        sessionDir,
        ARTIFACT_KINDS.registryTrust,
        host.registry_trust.digest,
        host.registry_trust.artifact_ref,
      ).reference,
      readArtifact(
        sessionDir,
        ARTIFACT_KINDS.registration,
        host.registration.digest,
        host.registration.artifact_ref,
      ).reference,
      readArtifact(sessionDir, ARTIFACT_KINDS.policy, host.policy.digest).reference,
      readArtifact(
        sessionDir,
        ARTIFACT_KINDS.snapshot,
        host.baseline_snapshot.digest,
        host.baseline_snapshot.artifact_ref,
      ).reference,
    );
  }
  return [...new Set(references)].sort(compareCodeUnits);
}

function adapterConfigurationFiles(workspace, sessionDir) {
  return {
    registryTrust: join(dataRoot(workspace), 'config', REGISTRY_TRUST_FILE),
    registration: join(sessionDir, REGISTRATION_FILE),
  };
}

function adapterReadiness(verified) {
  return {
    status: 'ready',
    capabilities: Object.fromEntries(verified.capability_types.map((type) => [
      type,
      { status: 'ready', policy_digest: verified.policy_digests[type] },
    ])),
  };
}

function loadHostAdapter({ workspace, sessionDir, repoId, task, capabilityType, atMs }) {
  if (!HOST_ATTESTED_CAPABILITIES.has(capabilityType)) return null;
  try {
    const files = adapterConfigurationFiles(workspace, sessionDir);
    assertFileBelow(dataRoot(workspace), files.registryTrust);
    assertFileBelow(sessionDir, files.registration);
    const registryTrust = readPrivateJson(files.registryTrust, 'Configured host adapter registry trust').value;
    const registration = readPrivateJson(files.registration, 'Signed session host adapter registration').value;
    const verified = verifyHostAdapterRegistration({
      registration,
      registryTrust,
      expected: { repo_id: repoId, task_id: task, capability_type: capabilityType },
      atMs,
    });
    const capability = verified.capabilities.get(capabilityType);
    return {
      status: 'ready',
      readiness: adapterReadiness(verified),
      registryTrust,
      registration,
      verified,
      capability,
      policyDigest: adapterCapabilityPolicyDigest(capability),
    };
  } catch (error) {
    return {
      status: 'blocked',
      readiness: { status: 'blocked', capabilities: {} },
      problem: error instanceof HostAdapterContractError ? error.code : 'host_adapter_unavailable',
    };
  }
}

function storedArtifacts(sessionDir, kind) {
  const directory = join(sessionDir, 'capability', 'artifacts', kind);
  if (!existsSync(directory)) return [];
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Capability artifact directory is not a regular directory.');
  }
  return readdirSync(directory)
    .filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry))
    .sort()
    .map((entry) => {
      const digest = `sha256:${entry.slice(0, -5)}`;
      return { ...readArtifact(sessionDir, kind, digest), digest };
    });
}

function assertArtifactIdentityUnused(sessionDir, kind, digest, value, fields) {
  for (const artifact of storedArtifacts(sessionDir, kind)) {
    if (artifact.digest === digest) continue;
    for (const field of fields) {
      if (artifact.value[field] === value[field]) {
        throw new Error(`Capability artifact ${field} was already bound to different content.`);
      }
    }
  }
}

function reservationFiles(sessionDir) {
  return ['staged', 'pending', 'consuming', 'indeterminate', 'completed'].flatMap((lane) => {
    const directory = join(sessionDir, 'capability', 'reservations', lane);
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry))
      .map((entry) => join(directory, entry));
  });
}

function readReservation(sessionDir, file) {
  assertFileBelow(sessionDir, file);
  return readPrivateJson(file, 'Capability reservation', { canonical: true }).value;
}

function executionNonce(sessionDir) {
  const used = new Set(reservationFiles(sessionDir)
    .map((file) => readReservation(sessionDir, file).execution_nonce));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const nonce = randomBytes(32).toString('base64url');
    if (!used.has(nonce)) return nonce;
  }
  throw new Error('Could not allocate a unique capability execution nonce.');
}

function hostReservationArtifacts(sessionDir, hostAdapter, manifest) {
  verifyWorkspaceManifest(manifest);
  const workspaceEvidence = compactWorkspaceEvidence(manifest);
  const registryTrustDigest = hostAdapterRegistryTrustDigest(hostAdapter.registryTrust);
  const registrationDigest = hostAdapterRegistrationDigest(hostAdapter.registration);
  assertArtifactIdentityUnused(
    sessionDir,
    ARTIFACT_KINDS.registration,
    registrationDigest,
    hostAdapter.registration,
    ['registration_id', 'source_event_id', 'replay_id'],
  );
  const trust = storeArtifact(
    sessionDir,
    ARTIFACT_KINDS.registryTrust,
    hostAdapter.registryTrust,
    registryTrustDigest,
  );
  const registration = storeArtifact(
    sessionDir,
    ARTIFACT_KINDS.registration,
    hostAdapter.registration,
    registrationDigest,
  );
  const snapshotDigest = sha256(canonicalJson(manifest));
  const snapshot = storeArtifact(
    sessionDir,
    ARTIFACT_KINDS.snapshot,
    manifest,
    snapshotDigest,
  );
  storeArtifact(
    sessionDir,
    ARTIFACT_KINDS.policy,
    hostAdapter.capability,
    hostAdapter.policyDigest,
  );
  return {
    registry_trust: { digest: registryTrustDigest, artifact_ref: trust.reference },
    registration: { digest: registrationDigest, artifact_ref: registration.reference },
    policy: {
      digest: hostAdapter.policyDigest,
      value: structuredClone(hostAdapter.capability),
    },
    baseline_snapshot: {
      digest: snapshotDigest,
      evidence: workspaceEvidence,
      artifact_ref: snapshot.reference,
    },
    adapter: {
      adapter_id: hostAdapter.verified.adapter_id,
      adapter_version: hostAdapter.verified.adapter_version,
      host_instance_id: hostAdapter.verified.host_instance_id,
      attestation_key_id: hostAdapter.verified.attestation_key_id,
    },
  };
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
        indeterminate_outcome: null,
      };
      if (event.payload.status === 'succeeded') {
        previous.execution_status = 'succeeded';
        previous.has_succeeded_outcome = true;
        previous.succeeded_outcome = event.payload;
      } else if (!previous.has_succeeded_outcome) {
        previous.execution_status = event.payload.status;
      }
      if (event.payload.status === 'indeterminate') previous.indeterminate_outcome = event.payload;
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
      indeterminate_outcome: outcome.indeterminate_outcome ?? null,
    };
  });
}

function externalAuthorizations(session) {
  const authorizations = session?.lifecycle?.authorizations ?? {};
  return Object.entries(authorizations)
    .filter(([, decision]) => ['approved', 'authorized'].includes(decision?.status))
    .map(([scope]) => scope === 'tracker-comment' ? 'tracker.comment' : scope);
}

function workflowEffectUnresolved(state) {
  return Object.values(state?.nodes ?? {}).some((nodeState) =>
    Object.values(nodeState?.capability_decisions ?? {}).some((decision) => {
      if (decision?.payload?.decision !== 'authorized') return false;
      const outcomes = (nodeState.capability_outcomes ?? []).filter((outcome) =>
        outcome?.payload?.decision_digest === decision.payload.decision_digest);
      return outcomes.length === 0
        || (outcomes.length === 1 && outcomes[0].payload.status === 'indeterminate');
    }));
}

function brokerContext({ workspace, task, sessionDir, compiled, snapshot, hostAdapter = null }) {
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
    repo: compiled.plan.session_binding.repo_id,
    workspace,
    task,
    session,
    route: compiled.plan.route,
    current_branch: branch,
    protected_branches: protectedSet,
    trusted_interception: interception !== null,
    hard_enforcement: Boolean((interception || hostAdapter?.status === 'ready')
      && branch && protectedSet.length),
    interception_probe_digest: interception?.probe_digest ?? null,
    hostAdapter: hostAdapter?.readiness ?? null,
    host_adapter: hostAdapter?.status === 'ready' ? {
      registry_trust_digest: hostAdapter.verified.registry.trust_digest,
      registration_digest: hostAdapter.verified.registration_digest,
      policy_digest: hostAdapter.policyDigest,
      adapter_id: hostAdapter.verified.adapter_id,
      adapter_version: hostAdapter.verified.adapter_version,
      attestation_key_id: hostAdapter.verified.attestation_key_id,
    } : null,
    workflow: compiled.plan,
    workflowState: snapshot.state,
    workflowEffectUnresolved: workflowEffectUnresolved(snapshot.state),
    currentWorktreeFingerprint: fingerprint,
    currentTreeDigest: filesystem.digest,
    protected_control_paths: [...new Set(protectedControlPaths)].sort(),
    headSha: metadata.head_sha,
    remotes: metadata.remotes,
    runtimeCapabilities: capabilityArtifact.evidence?.capabilities ?? {},
    remainingBudget: snapshot.state.remaining_budget,
    externalAuthorizations: externalAuthorizations(session),
    priorDecisions: priorDecisions(snapshot.events),
    filesystemSnapshot: filesystem,
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

function outcomePayload(
  decision,
  reservation,
  status,
  externalReference = null,
  error = null,
  recordedAt = new Date().toISOString(),
) {
  if (status === 'succeeded'
    && ['git.push', 'github.openDraftPr', 'tracker.comment'].includes(decision.capability_type)
    && (typeof externalReference !== 'string' || externalReference.length === 0)) {
    throw new Error('A successful external capability outcome requires a nonempty external reference.');
  }
  const unsigned = {
    schema_version: 2,
    outcome_kind: 'native-tool-execution',
    request_id: decision.request_id,
    idempotency_key: decision.idempotency_key,
    capability_type: decision.capability_type,
    request_digest: decision.request_digest,
    decision_digest: decision.decision_digest,
    reservation_digest: reservation.reservation_digest,
    execution_nonce: reservation.execution_nonce,
    budget_charge: structuredClone(reservation.reserved_budget),
    status,
    external_reference: externalReference,
    error,
    recorded_at: recordedAt,
  };
  return { ...unsigned, outcome_digest: sha256(canonicalJson(unsigned)) };
}

function attestedOutcomePayload(decision, reservation, verified, attestation, recordedAt) {
  const status = verified.resolved_status;
  if (!['succeeded', 'failed', 'indeterminate'].includes(status)) {
    throw new Error('Verified host attestation did not resolve to a supported journal status.');
  }
  const unsigned = {
    schema_version: 2,
    outcome_kind: 'signed-host-adapter-execution',
    request_id: decision.request_id,
    idempotency_key: decision.idempotency_key,
    capability_type: decision.capability_type,
    request_digest: decision.request_digest,
    decision_digest: decision.decision_digest,
    execution_nonce: reservation.execution_nonce,
    budget_charge: structuredClone(reservation.reserved_budget),
    status,
    external_reference: verified.external_reference,
    error: attestation.result.error,
    registry_trust_digest: verified.registry_trust_digest,
    registration_digest: verified.registration_digest,
    policy_digest: verified.policy_digest,
    reservation_digest: reservation.reservation_digest,
    attestation_digest: verified.attestation_digest,
    result_digest: verified.result_digest,
    recorded_at: recordedAt,
    reconciliation_of: attestation.status === 'reconciled'
      ? attestation.reconciles_attestation_digest
      : null,
  };
  return { ...unsigned, outcome_digest: sha256(canonicalJson(unsigned)) };
}

function appendCapabilityEvent({
  sessionDir,
  compiled,
  snapshot,
  eventType,
  nodeId,
  fingerprint,
  payload,
  artifactRefs,
  recordedAt,
}) {
  if (!Array.isArray(artifactRefs) || artifactRefs.length === 0) {
    throw new Error('Capability journal events require immutable evidence artifacts.');
  }
  return appendWorkflowEvent({
    sessionDir,
    compiled,
    expected_previous_event_digest: snapshot.events.at(-1)?.event_digest ?? null,
    input: {
      event_type: eventType,
      node_id: nodeId,
      ...(recordedAt ? { recorded_at: recordedAt } : {}),
      worktree_fingerprint: fingerprint,
      producer: { role: 'capability-broker' },
      artifact_refs: [...new Set(artifactRefs)].sort(compareCodeUnits),
      payload,
    },
  });
}

function reservationPaths(sessionDir, decisionDigest) {
  const digest = decisionDigest.replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Capability reservation requires a valid decision digest.');
  const root = join(sessionDir, 'capability', 'reservations');
  return {
    staged: join(root, 'staged', `${digest}.json`),
    pending: join(root, 'pending', `${digest}.json`),
    consuming: join(root, 'consuming', `${digest}.json`),
    indeterminate: join(root, 'indeterminate', `${digest}.json`),
    completed: join(root, 'completed', `${digest}.json`),
  };
}

function reservationBinding(request, context) {
  const binding = {
    adapter_binding: context.host_adapter ? HOST_ADAPTER_BINDING : NATIVE_ADAPTER_BINDING,
    authority_decision_digest: context.authority_decision_digest,
    interception_probe_digest: context.interception_probe_digest,
    worktree_fingerprint: request.worktreeFingerprint,
    current_branch: context.current_branch,
    protected_branches: [...context.protected_branches],
    head_sha: request.headSha ?? (request.type === 'git.commit' ? context.headSha : null),
    body_digest: request.patchDigest
      ?? request.bodyDigest
      ?? (request.type === 'git.commit' ? sha256(request.message) : null),
    tree_digest: request.treeDigest ?? null,
    command: request.command ?? null,
    cwd: request.cwd ?? null,
    paths: request.paths ?? null,
  };
  if (context.host_adapter) {
    Object.assign(binding, {
      registry_trust_digest: context.host_adapter.registry_trust_digest,
      registration_digest: context.host_adapter.registration_digest,
      policy_digest: context.host_adapter.policy_digest,
    });
  }
  return { ...binding, binding_digest: sha256(canonicalJson({ request, binding })) };
}

function assertReservationBinding(reservation) {
  return assertCapabilityReservation(reservation);
}

function assertReservationRequest(reservation, request, decision, status) {
  if (reservation.status !== status
    || reservation.request_digest !== decision.request_digest
    || reservation.decision_digest !== decision.decision_digest
    || canonicalJson(reservation.request) !== canonicalJson(request)) {
    throw new Error('Capability reservation path is already bound to a different request.');
  }
  return reservation;
}

function createReservation({ sessionDir, request, decision, context, snapshot, hostAdapter = null }) {
  const paths = reservationPaths(sessionDir, decision.decision_digest);
  for (const lane of ['staged', 'pending', 'consuming', 'indeterminate', 'completed']) {
    ensurePrivateDirectory(sessionDir, join(sessionDir, 'capability', 'reservations', lane));
  }
  if (existsSync(paths.pending)) {
    const existing = assertReservationRequest(
      assertReservationBinding(readReservation(sessionDir, paths.pending)),
      request,
      decision,
      'pending',
    );
    if (hostAdapter && (existing.reservation_binding.host_adapter?.registration.digest
      !== hostAdapter.verified.registration_digest
      || existing.reservation_binding.host_adapter?.registry_trust.digest
        !== hostAdapter.verified.registry.trust_digest)) {
      throw new Error('Capability reservation is bound to a different host adapter registration or trust root.');
    }
    reservationArtifactReferences(sessionDir, existing);
    return { paths, reservation: existing };
  }
  const authorizedJournalTailDigest = snapshot.events.at(-1)?.event_digest ?? null;
  if (hostAdapter && authorizedJournalTailDigest === null) {
    throw new Error('Host adapter execution requires an initialized workflow journal tail.');
  }
  const createdAt = new Date().toISOString();
  const hardEnforcement = reservationBinding(request, context);
  let baselineManifest = null;
  if (hostAdapter) {
    const baseline = captureStableManifest(context.workspace);
    baselineManifest = baseline.manifest;
    if (baseline.worktreeFingerprint !== context.filesystemSnapshot.digest
      || baseline.git.current_branch !== context.current_branch
      || baseline.git.head_sha !== context.headSha) {
      throw new Error('Workspace changed while host adapter reservation evidence was captured.');
    }
    if (request.type === 'process.exec') {
      const node = context.workflow.nodes.find((entry) => entry.id === request.node_id);
      assertNoWritableAliasEscape(baselineManifest, processAllowedWritePaths(node));
    }
  }
  const hostArtifacts = hostAdapter
    ? hostReservationArtifacts(sessionDir, hostAdapter, baselineManifest)
    : null;
  const reservationBindingValue = {
    schema_version: 2,
    reservation_kind: hostAdapter ? 'host-adapter-execution' : 'native-tool-execution',
    decision_digest: decision.decision_digest,
    request_digest: decision.request_digest,
    request_id: decision.request_id,
    workflow_id: decision.workflow_id,
    node_id: decision.node_id,
    capability_type: decision.capability,
    idempotency_key: decision.idempotency_key,
    execution_nonce: executionNonce(sessionDir),
    authorized_journal_tail_digest: authorizedJournalTailDigest,
    workspace_evidence_digest_before:
      hostArtifacts?.baseline_snapshot.evidence.evidence_digest ?? null,
    created_at: createdAt,
    request: structuredClone(request),
    reserved_budget: structuredClone(decision.reserved_budget),
    hard_enforcement: hardEnforcement,
    host_adapter: hostArtifacts,
  };
  const reservationDigest = sha256(canonicalJson(reservationBindingValue));
  const reservation = {
    schema_version: 2,
    status: 'staged',
    ...Object.fromEntries(Object.entries(reservationBindingValue)
      .filter(([field]) => !['schema_version', 'reservation_kind', 'host_adapter'].includes(field))),
    reservation_kind: reservationBindingValue.reservation_kind,
    reservation_digest: reservationDigest,
    reservation_binding: reservationBindingValue,
  };
  if (existsSync(paths.staged)) {
    const existing = assertReservationBinding(readReservation(sessionDir, paths.staged));
    if (existing.request_digest !== decision.request_digest
      || existing.decision_digest !== decision.decision_digest
      || canonicalJson(existing.request) !== canonicalJson(request)) {
      throw new Error('Capability staged reservation path is bound to a different request.');
    }
    if (existing.authorized_journal_tail_digest === authorizedJournalTailDigest
      && existing.hard_enforcement.binding_digest === hardEnforcement.binding_digest
      && canonicalJson(existing.reservation_binding.host_adapter)
        === canonicalJson(hostArtifacts)) {
      reservationArtifactReferences(sessionDir, existing);
      return { paths, reservation: assertReservationRequest(existing, request, decision, 'staged') };
    }
    const published = snapshot.events.some((event) => event.event_type === 'capability.decision'
      && event.payload.decision_digest === existing.decision_digest
      && event.payload.decision === 'authorized'
      && event.previous_event_digest === existing.authorized_journal_tail_digest);
    if (published) {
      throw new Error('A staged capability reservation already has a durable journal decision.');
    }
    storeArtifact(
      sessionDir,
      ARTIFACT_KINDS.reservation,
      reservationBindingValue,
      reservationDigest,
    );
    durableReplacePrivateJson(sessionDir, paths.staged, reservation);
    return { paths, reservation };
  }
  storeArtifact(
    sessionDir,
    ARTIFACT_KINDS.reservation,
    reservationBindingValue,
    reservationDigest,
  );
  writeNewPrivateJson(sessionDir, paths.staged, reservation, 'Staged capability reservation');
  return { paths, reservation };
}

function promoteReservation(sessionDir, paths, staged) {
  assertReservationRequest(staged, staged.request, {
    request_digest: staged.request_digest,
    decision_digest: staged.decision_digest,
  }, 'staged');
  const pending = { ...staged, status: 'pending' };
  assertCapabilityReservationTransition({
    fromLane: 'staged',
    toLane: 'pending',
    before: staged,
    after: pending,
  });
  writeNewPrivateJson(sessionDir, paths.pending, pending, 'Pending capability reservation');
  if (existsSync(paths.staged)) {
    const source = assertReservationBinding(readReservation(sessionDir, paths.staged));
    if (source.reservation_digest !== staged.reservation_digest) {
      throw new Error('Staged capability reservation changed before publication.');
    }
    unlinkSync(paths.staged);
    fsyncDirectory(dirname(paths.staged));
  }
  return assertReservationBinding(readReservation(sessionDir, paths.pending));
}

function reservationSummary(reservation) {
  return {
    reservation_digest: reservation.reservation_digest,
    execution_nonce: reservation.execution_nonce,
    authorized_journal_tail_digest: reservation.authorized_journal_tail_digest,
    workspace_evidence_digest_before: reservation.workspace_evidence_digest_before,
    reserved_budget: structuredClone(reservation.reserved_budget),
    registry_trust_digest:
      reservation.reservation_binding.host_adapter?.registry_trust.digest ?? null,
    registration_digest:
      reservation.reservation_binding.host_adapter?.registration.digest ?? null,
    policy_digest: reservation.reservation_binding.host_adapter?.policy.digest ?? null,
  };
}

function completeReservation(sessionDir, paths, outcome) {
  const reservation = assertReservationBinding(readReservation(sessionDir, paths.consuming));
  const completed = {
    ...reservation,
    status: outcome.status,
    completed_at: outcome.recorded_at ?? reservation.consuming_at,
    outcome_digest: outcome.outcome_digest,
    external_reference: outcome.external_reference,
    error: outcome.error,
  };
  assertCapabilityReservationTransition({
    fromLane: 'consuming',
    toLane: 'completed',
    before: reservation,
    after: completed,
  });
  writeNewPrivateJson(sessionDir, paths.completed, completed, 'Completed capability reservation');
  const existing = assertReservationBinding(readReservation(sessionDir, paths.completed));
  if (existing.outcome_digest !== outcome.outcome_digest) {
    throw new Error('Completed capability reservation is bound to a different outcome.');
  }
  if (existsSync(paths.consuming)) {
    const source = assertReservationBinding(readReservation(sessionDir, paths.consuming));
    if (source.reservation_digest !== reservation.reservation_digest) {
      throw new Error('Consuming capability reservation changed before completion.');
    }
    unlinkSync(paths.consuming);
    fsyncDirectory(dirname(paths.consuming));
  }
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

function recoveredAuthorization(sessionDir, snapshot, request) {
  const requestDigest = capabilityRequestDigest(request);
  const decisions = snapshot.events.filter((event) => event.event_type === 'capability.decision'
    && event.payload.decision === 'authorized'
    && event.payload.request_id === request.request_id
    && event.payload.request_digest === requestDigest
    && event.payload.capability_type === request.type
    && event.node_id === request.node_id);
  for (const event of decisions) {
    const paths = reservationPaths(sessionDir, event.payload.decision_digest);
    if (!existsSync(paths.staged)) continue;
    const reservation = assertReservationBinding(readReservation(sessionDir, paths.staged));
    if (canonicalJson(reservation.request) !== canonicalJson(request)) continue;
    decisionForReservation(snapshot, reservation);
    const published = promoteReservation(sessionDir, paths, reservation);
    return {
      schema_version: event.payload.schema_version,
      request_id: request.request_id,
      request_digest: requestDigest,
      workflow_id: request.workflow_id,
      node_id: request.node_id,
      capability: request.type,
      status: 'authorized',
      reason_codes: [],
      idempotency_key: event.payload.idempotency_key,
      decision_digest: event.payload.decision_digest,
      reservation: reservationSummary(published),
    };
  }
  return null;
}

function authorizeRequest({ workspace, task, sessionDir, compiled, request, afterReservation = null }) {
  if (afterReservation !== null && typeof afterReservation !== 'function') {
    throw new Error('afterReservation must be a function.');
  }
  return withJournalRetry(() => {
    const snapshot = readWorkflowJournal(sessionDir, compiled);
    const recovered = validateCapabilityRequest(request).length === 0
      ? recoveredAuthorization(sessionDir, snapshot, request)
      : null;
    if (recovered) return recovered;
    const hostAdapter = loadHostAdapter({
      workspace,
      sessionDir,
      repoId: compiled.plan.session_binding.repo_id,
      task,
      capabilityType: request.type,
      atMs: Date.now(),
    });
    const context = brokerContext({
      workspace,
      task,
      sessionDir,
      compiled,
      snapshot,
      hostAdapter,
    });
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
      decision.prior_outcome = structuredClone(succeeded.payload);
      return decision;
    }
    if (context.workflowEffectUnresolved) {
      if (decision.status !== 'denied') {
        throw new Error('An unresolved capability effect must deny every new reservation.');
      }
      return decision;
    }
    const requestArtifact = storeRequestArtifact(sessionDir, request, decision.request_digest);
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
      let freshHostAdapter = null;
      if (HOST_ATTESTED_CAPABILITIES.has(request.type)) {
        freshHostAdapter = loadHostAdapter({
          workspace,
          sessionDir,
          repoId: compiled.plan.session_binding.repo_id,
          task,
          capabilityType: request.type,
          atMs: Date.now(),
        });
        if (freshHostAdapter?.status !== 'ready'
          || freshHostAdapter.verified.registration_digest
            !== hostAdapter?.verified.registration_digest
          || freshHostAdapter.verified.registry.trust_digest
            !== hostAdapter?.verified.registry.trust_digest
          || freshHostAdapter.policyDigest !== hostAdapter?.policyDigest) {
          throw new Error('Host adapter registration, trust, or policy changed while the reservation was being created.');
        }
      } else {
        const freshInterception = assertRequestInterception({
          workspace,
          task,
          request,
          action: `reserve ${request.type}`,
        });
        if (freshInterception.probe_digest !== context.interception_probe_digest) {
          throw new Error('Trusted host interception changed while the capability reservation was being created.');
        }
      }
      const reserved = createReservation({
        sessionDir,
        request,
        decision,
        context,
        snapshot,
        hostAdapter: freshHostAdapter,
      });
      if (afterReservation !== null) {
        afterReservation({
          decision: structuredClone(decision),
          reservation: structuredClone(reserved.reservation),
        });
      }
      decision.reservation = reservationSummary(reserved.reservation);
      appendCapabilityEvent({
        sessionDir,
        compiled,
        snapshot,
        eventType: 'capability.decision',
        nodeId: request.node_id,
        fingerprint: context.currentWorktreeFingerprint,
        payload: decisionPayload(decision),
        artifactRefs: reservationArtifactReferences(sessionDir, reserved.reservation),
      });
      const pending = promoteReservation(sessionDir, reserved.paths, reserved.reservation);
      decision.reservation = reservationSummary(pending);
      return decision;
    }
    appendCapabilityEvent({
      sessionDir,
      compiled,
      snapshot,
      eventType: 'capability.decision',
      nodeId: request.node_id,
      fingerprint: context.currentWorktreeFingerprint,
      payload: decisionPayload(decision),
      artifactRefs: [requestArtifact.reference],
    });
    return decision;
  });
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
  const paths = reservationPaths(sessionDir, decisionDigest);
  const reservationFile = existsSync(paths.consuming) ? paths.consuming : paths.completed;
  const reservation = assertReservationBinding(readReservation(sessionDir, reservationFile));
  const recordedAt = new Date().toISOString();
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
    const payload = outcomePayload(
      decisionEvent.payload,
      reservation,
      status,
      externalReference,
      error,
      recordedAt,
    );
    appendCapabilityEvent({
      sessionDir,
      compiled,
      snapshot,
      eventType: 'capability.outcome',
      nodeId: decisionEvent.node_id,
      fingerprint: worktreeFingerprint(workspace),
      payload,
      artifactRefs: reservationArtifactReferences(sessionDir, reservation),
      recordedAt,
    });
    return payload;
  });
}

function validateClaimedReservation({ workspace, sessionDir, compiled, decisionDigest }) {
  const paths = reservationPaths(sessionDir, decisionDigest);
  const file = existsSync(paths.consuming) ? paths.consuming : (existsSync(paths.completed) ? paths.completed : null);
  if (!file) throw new Error('Capability reservation is not in the consuming lane.');
  const reservation = assertReservationBinding(readReservation(sessionDir, file));
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
  if (reservation.reservation_kind !== 'native-tool-execution'
    || reservation.hard_enforcement?.adapter_binding !== NATIVE_ADAPTER_BINDING
    || HOST_ATTESTED_CAPABILITIES.has(request.type)) {
    throw new Error('This capability requires a signed host execution attestation.');
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
    && event.payload.outcome_kind === 'native-tool-execution'
    && event.payload.reservation_digest === claimed.reservation.reservation_digest
    && event.payload.execution_nonce === claimed.reservation.execution_nonce
    && event.payload.status === status);
  if (existing) {
    const { outcome_digest: outcomeDigest, ...unsignedOutcome } = existing.payload;
    if (outcomeDigest !== sha256(canonicalJson(unsignedOutcome))
      || existing.recorded_at !== existing.payload.recorded_at
      || existing.payload.external_reference !== externalReference
      || existing.payload.error !== error) {
      throw new Error('Claimed capability outcome conflicts with its existing journal outcome.');
    }
    if (existsSync(claimed.paths.consuming)) {
      completeReservation(sessionDir, claimed.paths, existing.payload);
    }
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
  completeReservation(sessionDir, claimed.paths, outcome);
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

function portableScope(path, scopes) {
  return scopes.some((scope) => scope === '.'
    || path === scope
    || path.startsWith(`${scope.replace(/\/$/, '')}/`));
}

function manifestContentEntries(manifest) {
  return manifest.content_shards.flatMap((shard) => shard.entries);
}

function manifestPhysicalEntries(manifest) {
  return manifest.physical_shards.flatMap((shard) => shard.entries);
}

function processAllowedWritePaths(node) {
  const allowedPaths = node?.allowed_paths ?? [];
  if (!Array.isArray(allowedPaths)
    || allowedPaths.some((scope) => scope !== '.' && !isPortableWorkspacePath(scope))) {
    throw new Error('Process node allowed_write_paths must contain canonical portable paths.');
  }
  return [...new Set(allowedPaths)].sort(compareCodeUnits);
}

function assertNoWritableAliasEscape(manifest, allowedPaths) {
  const groups = new Map();
  for (const entry of manifestPhysicalEntries(manifest)) {
    const identity = `${entry.dev}:${entry.ino}`;
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(entry);
  }
  for (const aliases of groups.values()) {
    const writable = aliases.filter((entry) => portableScope(entry.path, allowedPaths));
    if (writable.length === 0) continue;
    if (writable.length !== aliases.length) {
      throw new Error('Process writable scope shares a physical file identity with an out-of-scope path.');
    }
    if (aliases.some((entry) => entry.nlink > aliases.length)) {
      throw new Error('Process writable scope contains a hard-link identity with an unknown external alias.');
    }
  }
}

function assertNoOutOfScopeAliases(manifest, changedPaths, allowedPaths) {
  const physical = manifestPhysicalEntries(manifest);
  const groups = new Map();
  for (const entry of physical) {
    const identity = `${entry.dev}:${entry.ino}`;
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(entry);
  }
  const byPath = new Map(physical.map((entry) => [entry.path, entry]));
  for (const path of changedPaths) {
    const entry = byPath.get(path);
    if (!entry) continue;
    const aliases = groups.get(`${entry.dev}:${entry.ino}`) ?? [];
    if (aliases.some((alias) => !portableScope(alias.path, allowedPaths))
      || entry.nlink > aliases.length) {
      throw new Error(`Process target ${path} has a hard-link alias outside the authorized scope.`);
    }
  }
}

function hostReservationEvidence(sessionDir, reservation) {
  const host = reservation.reservation_binding.host_adapter;
  if (reservation.reservation_kind !== 'host-adapter-execution'
    || reservation.hard_enforcement?.adapter_binding !== HOST_ADAPTER_BINDING
    || !host) {
    throw new Error('Capability reservation is not bound to a signed host adapter.');
  }
  const trust = readArtifact(
    sessionDir,
    ARTIFACT_KINDS.registryTrust,
    host.registry_trust.digest,
    host.registry_trust.artifact_ref,
  );
  const registration = readArtifact(
    sessionDir,
    ARTIFACT_KINDS.registration,
    host.registration.digest,
    host.registration.artifact_ref,
  );
  const baseline = readArtifact(
    sessionDir,
    ARTIFACT_KINDS.snapshot,
    host.baseline_snapshot.digest,
    host.baseline_snapshot.artifact_ref,
  );
  verifyWorkspaceManifest(baseline.value);
  if (hostAdapterRegistryTrustDigest(trust.value) !== host.registry_trust.digest
    || hostAdapterRegistrationDigest(registration.value) !== host.registration.digest
    || adapterCapabilityPolicyDigest(host.policy.value) !== host.policy.digest
    || canonicalJson(compactWorkspaceEvidence(baseline.value))
      !== canonicalJson(host.baseline_snapshot.evidence)
    || reservation.workspace_evidence_digest_before
      !== host.baseline_snapshot.evidence.evidence_digest) {
    throw new Error('Host adapter reservation artifact binding is invalid.');
  }
  return { host, trust: trust.value, registration: registration.value, baseline: baseline.value };
}

function decisionForReservation(snapshot, reservation) {
  const decision = snapshot.events.find((event) => event.event_type === 'capability.decision'
    && event.payload.decision_digest === reservation.decision_digest
    && event.payload.decision === 'authorized');
  if (!decision
    || decision.previous_event_digest !== reservation.authorized_journal_tail_digest
    || decision.node_id !== reservation.node_id
    || decision.payload.request_id !== reservation.request_id
    || decision.payload.request_digest !== reservation.request_digest
    || decision.payload.capability_type !== reservation.capability_type
    || decision.payload.idempotency_key !== reservation.idempotency_key
    || canonicalJson(decision.payload.reserved_budget) !== canonicalJson(reservation.reserved_budget)) {
    throw new Error('Host adapter reservation does not match its authorized journal decision.');
  }
  const { decision_digest: journalDecisionDigest, ...unsignedDecision } = decision.payload;
  if (journalDecisionDigest !== sha256(canonicalJson(unsignedDecision))) {
    throw new Error('Host adapter reservation journal decision digest is invalid.');
  }
  return decision;
}

function indeterminateOutcomeForReservation(sessionDir, snapshot, reservation) {
  const matches = snapshot.events.filter((event) => event.event_type === 'capability.outcome'
    && event.payload.schema_version === 2
    && event.payload.status === 'indeterminate'
    && event.payload.decision_digest === reservation.decision_digest
    && event.payload.reservation_digest === reservation.reservation_digest);
  if (matches.length !== 1) {
    throw new Error('Reconciliation requires one authoritative indeterminate journal outcome.');
  }
  const event = matches[0];
  const { outcome_digest: outcomeDigest, ...unsignedOutcome } = event.payload;
  if (outcomeDigest !== sha256(canonicalJson(unsignedOutcome))
    || event.recorded_at !== event.payload.recorded_at
    || reservation.status !== 'indeterminate'
    || reservation.outcome_digest !== outcomeDigest
    || reservation.indeterminate_attestation_digest !== event.payload.attestation_digest) {
    throw new Error('Indeterminate reservation does not match its durable journal outcome.');
  }
  const attestationEvidence = reservation.attestations?.find((entry) =>
    entry.digest === event.payload.attestation_digest);
  if (!attestationEvidence || attestationEvidence.status !== 'indeterminate'
    || attestationEvidence.recorded_at !== event.recorded_at) {
    throw new Error('Indeterminate reservation is missing its immutable attestation evidence.');
  }
  const priorAttestation = readArtifact(
    sessionDir,
    ARTIFACT_KINDS.attestation,
    attestationEvidence.digest,
    attestationEvidence.artifact_ref,
  );
  const priorWorkspace = readArtifact(
    sessionDir,
    ARTIFACT_KINDS.snapshot,
    attestationEvidence.workspace_after.digest,
    attestationEvidence.workspace_after.artifact_ref,
  );
  const workspaceEvidence = compactWorkspaceEvidence(priorWorkspace.value);
  if (capabilityExecutionAttestationDigest(priorAttestation.value) !== attestationEvidence.digest
    || canonicalJson(workspaceEvidence)
      !== canonicalJson(attestationEvidence.workspace_after.evidence)
    || priorAttestation.value.workspace_evidence_digest_after
      !== workspaceEvidence.evidence_digest) {
    throw new Error('Indeterminate reconciliation evidence is inconsistent.');
  }
  const afterEvidence = readExecutionEvidence(
    sessionDir,
    attestationEvidence.execution_evidence,
  );
  if (afterEvidence.workspaceArtifact.digest !== attestationEvidence.workspace_after.digest
    || afterEvidence.workspaceArtifact.reference !== attestationEvidence.workspace_after.artifact_ref
    || canonicalJson(afterEvidence.evidence)
      !== canonicalJson(attestationEvidence.workspace_after.evidence)) {
    throw new Error('Indeterminate reconciliation execution evidence is inconsistent.');
  }
  return {
    event,
    attestation: priorAttestation.value,
    workspace: priorWorkspace.value,
    afterEvidence,
  };
}

function attestationExpected({
  compiled,
  task,
  reservation,
  policy,
  node,
  afterEvidence,
  reconcilesAttestationDigest = null,
}) {
  const request = reservation.request;
  const expected = {
    repo_id: compiled.plan.session_binding.repo_id,
    task_id: task,
    capability_type: request.type,
    workflow_id: request.workflow_id,
    node_id: request.node_id,
    request_id: request.request_id,
    request_digest: reservation.request_digest,
    decision_digest: reservation.decision_digest,
    reservation_digest: reservation.reservation_digest,
    idempotency_key: reservation.idempotency_key,
    execution_nonce: reservation.execution_nonce,
    authorized_journal_tail_digest: reservation.authorized_journal_tail_digest,
    worktree_fingerprint_before: request.worktreeFingerprint,
    worktree_fingerprint_after: afterEvidence.worktreeFingerprint,
    workspace_evidence_digest_before: reservation.workspace_evidence_digest_before,
    workspace_evidence_digest_after: afterEvidence.evidence.evidence_digest,
  };
  if (request.type === 'process.exec') {
    expected.allowed_write_paths = node.allowed_paths ?? [];
  } else if (request.type === 'git.commit') {
    Object.assign(expected, {
      branch: reservation.hard_enforcement.current_branch,
      parent_sha: reservation.hard_enforcement.head_sha,
      tree_digest: request.treeDigest,
      message_digest: reservation.hard_enforcement.body_digest,
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
      head_ref: reservation.hard_enforcement.current_branch,
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
  if (reconcilesAttestationDigest !== null) {
    expected.reconciles_attestation_digest = reconcilesAttestationDigest;
  }
  return expected;
}

function captureStableManifest(workspace) {
  const gitBefore = gitMetadata(workspace);
  const before = workspaceSnapshot(workspace);
  const manifest = buildWorkspaceManifest(workspace);
  const after = workspaceSnapshot(workspace);
  const gitAfter = gitMetadata(workspace);
  if (before.digest !== after.digest || canonicalJson(gitBefore) !== canonicalJson(gitAfter)) {
    throw new Error('Workspace changed while execution evidence was captured.');
  }
  const evidence = compactWorkspaceEvidence(manifest);
  if (evidence.snapshot_digest !== after.digest
    || typeof evidence.physical_root !== 'string'
    || typeof evidence.physical_topology_root !== 'string') {
    throw new Error('Workspace execution evidence is not bound to its content snapshot and physical identity roots.');
  }
  return { manifest, worktreeFingerprint: after.digest, evidence, git: gitAfter };
}

function storeExecutionEvidence(sessionDir, captured) {
  const workspaceDigest = sha256(canonicalJson(captured.manifest));
  const workspaceArtifact = storeArtifact(
    sessionDir,
    ARTIFACT_KINDS.snapshot,
    captured.manifest,
    workspaceDigest,
  );
  const value = {
    schema_version: 1,
    worktree_fingerprint: captured.worktreeFingerprint,
    workspace_manifest: {
      digest: workspaceDigest,
      artifact_ref: workspaceArtifact.reference,
      evidence: structuredClone(captured.evidence),
    },
    git: structuredClone(captured.git),
  };
  const digest = sha256(canonicalJson(value));
  const artifact = storeArtifact(sessionDir, ARTIFACT_KINDS.executionEvidence, value, digest);
  return {
    digest,
    artifact_ref: artifact.reference,
    value,
    workspaceArtifact: { ...workspaceArtifact, digest: workspaceDigest },
  };
}

function attestedOutcomeArtifactReferences({
  sessionDir,
  reservation,
  verified,
  attestationArtifact,
  resultArtifact,
  executionEvidence,
}) {
  const references = reservationArtifactReferences(sessionDir, reservation);
  references.push(
    readArtifact(
      sessionDir,
      ARTIFACT_KINDS.registryTrust,
      verified.registry_trust_digest,
    ).reference,
    readArtifact(
      sessionDir,
      ARTIFACT_KINDS.registration,
      verified.registration_digest,
    ).reference,
    readArtifact(sessionDir, ARTIFACT_KINDS.policy, verified.policy_digest).reference,
    readArtifact(
      sessionDir,
      ARTIFACT_KINDS.attestation,
      verified.attestation_digest,
      attestationArtifact.reference,
    ).reference,
    readArtifact(
      sessionDir,
      ARTIFACT_KINDS.result,
      verified.result_digest,
      resultArtifact.reference,
    ).reference,
    readArtifact(
      sessionDir,
      ARTIFACT_KINDS.executionEvidence,
      executionEvidence.digest,
      executionEvidence.artifact_ref,
    ).reference,
    readArtifact(
      sessionDir,
      ARTIFACT_KINDS.snapshot,
      executionEvidence.workspaceArtifact.digest,
      executionEvidence.workspaceArtifact.reference,
    ).reference,
  );
  return [...new Set(references)].sort(compareCodeUnits);
}

function readExecutionEvidence(sessionDir, binding) {
  if (!binding || typeof binding.digest !== 'string' || typeof binding.artifact_ref !== 'string') {
    throw new Error('Consuming reservation is missing immutable execution evidence.');
  }
  const artifact = readArtifact(
    sessionDir,
    ARTIFACT_KINDS.executionEvidence,
    binding.digest,
    binding.artifact_ref,
  );
  const value = artifact.value;
  if (value?.schema_version !== 1
    || canonicalJson(Object.keys(value).sort())
      !== canonicalJson(['git', 'schema_version', 'workspace_manifest', 'worktree_fingerprint'])
    || canonicalJson(Object.keys(value.workspace_manifest ?? {}).sort())
      !== canonicalJson(['artifact_ref', 'digest', 'evidence'])) {
    throw new Error('Execution evidence artifact has an unsupported shape.');
  }
  const workspaceArtifact = readArtifact(
    sessionDir,
    ARTIFACT_KINDS.snapshot,
    value.workspace_manifest.digest,
    value.workspace_manifest.artifact_ref,
  );
  verifyWorkspaceManifest(workspaceArtifact.value);
  const evidence = compactWorkspaceEvidence(workspaceArtifact.value);
  if (canonicalJson(evidence) !== canonicalJson(value.workspace_manifest.evidence)) {
    throw new Error('Execution evidence does not match its workspace manifest.');
  }
  return {
    manifest: workspaceArtifact.value,
    worktreeFingerprint: value.worktree_fingerprint,
    evidence,
    git: value.git,
    binding: { digest: binding.digest, artifact_ref: binding.artifact_ref },
    workspaceArtifact: { ...workspaceArtifact, digest: value.workspace_manifest.digest },
  };
}

function assertWorkspaceResult(reservation, attestation, baseline, current, allowedPaths, gitState) {
  const delta = diffWorkspaceManifests(baseline, current);
  const changedPaths = delta.changed_paths;
  const physicalPaths = delta.changed_physical_paths;
  if (reservation.capability_type !== 'process.exec') {
    if (changedPaths.length || physicalPaths.length
      || baseline.evidence.evidence_digest !== current.evidence.evidence_digest) {
      throw new Error('External host adapter execution changed the bound workspace.');
    }
    if (reservation.capability_type === 'github.openDraftPr' && attestation.result.draft !== true) {
      throw new Error('Host adapter attempted to report a non-draft pull request.');
    }
    const resolvedStatus = attestation.status === 'reconciled'
      ? attestation.resolution
      : attestation.status;
    if (reservation.capability_type === 'git.commit') {
      if (gitState.current_branch !== reservation.hard_enforcement.current_branch) {
        throw new Error('Git commit attestation does not match the current branch.');
      }
      if (resolvedStatus === 'succeeded' && gitState.head_sha !== attestation.result.commit_sha) {
        throw new Error('Git commit attestation does not match the current HEAD.');
      }
      if (resolvedStatus === 'failed'
        && gitState.head_sha !== reservation.hard_enforcement.head_sha) {
        throw new Error('Failed Git commit attestation changed the current HEAD.');
      }
    }
    if (['git.push', 'github.openDraftPr'].includes(reservation.capability_type)
      && (gitState.current_branch !== reservation.hard_enforcement.current_branch
        || gitState.head_sha !== reservation.hard_enforcement.head_sha)) {
      throw new Error(`${reservation.capability_type} attestation is stale relative to the current HEAD.`);
    }
    return;
  }
  if (changedPaths.some((path) => !portableScope(path, allowedPaths))
    || physicalPaths.some((path) => !portableScope(path, allowedPaths))) {
    throw new Error('Process execution changed a path outside the authorized scope.');
  }
  const actualPaths = [...new Set([...changedPaths, ...physicalPaths])]
    .sort(compareCodeUnits);
  const reported = [...attestation.result.changed_paths]
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  if (canonicalJson(reported.map((entry) => entry.path)) !== canonicalJson(actualPaths)) {
    throw new Error('Process attestation does not report the exact workspace delta.');
  }
  const currentContent = new Map(manifestContentEntries(current).map((entry) => [entry.path, entry]));
  for (const entry of reported) {
    if (currentContent.get(entry.path)?.digest !== entry.digest) {
      throw new Error(`Process attestation digest for ${entry.path} does not match the workspace.`);
    }
  }
  assertNoOutOfScopeAliases(baseline, actualPaths, allowedPaths);
  assertNoOutOfScopeAliases(current, actualPaths, allowedPaths);
}

function attestationReplayEvidence(sessionDir, currentDigest) {
  const prior = storedArtifacts(sessionDir, ARTIFACT_KINDS.attestation)
    .filter((artifact) => artifact.digest !== currentDigest);
  return {
    replayIds: prior.map((artifact) => artifact.value.replay_id),
    sourceEventIds: prior.map((artifact) => artifact.value.source_event_id),
    executionBindingDigests: prior.map((artifact) =>
      capabilityExecutionBindingDigest(artifact.value)),
  };
}

function reservationForAttestation(sessionDir, attestation) {
  const paths = reservationPaths(sessionDir, attestation.decision_digest);
  const attestationDigest = capabilityExecutionAttestationDigest(attestation);
  const source = attestation.status === 'reconciled' ? paths.indeterminate : paths.pending;
  if (existsSync(paths.consuming)) {
    const reservation = assertReservationBinding(readReservation(sessionDir, paths.consuming));
    if (reservation.ingesting_attestation_digest
      !== attestationDigest) {
      throw new Error('Capability reservation is consuming a different attestation.');
    }
    return {
      sessionDir,
      paths,
      source,
      reservation,
      alreadyClaimed: true,
      alreadyFinalized: false,
    };
  }
  if (!existsSync(source)) {
    const finalPath = attestation.status === 'indeterminate' ? paths.indeterminate : paths.completed;
    if (existsSync(finalPath)) {
      const reservation = assertReservationBinding(readReservation(sessionDir, finalPath));
      if (reservation.attestations?.some((entry) => entry.digest === attestationDigest)) {
        return {
          sessionDir,
          paths,
          source,
          reservation,
          alreadyClaimed: false,
          alreadyFinalized: true,
        };
      }
    }
    throw new Error(attestation.status === 'reconciled'
      ? 'Reconciliation requires an indeterminate reservation.'
      : 'Execution attestation requires a pending reservation.');
  }
  const reservation = assertReservationBinding(readReservation(sessionDir, source));
  if (attestation.status === 'reconciled') {
    if (reservation.status !== 'indeterminate' || !reservation.indeterminate_attestation_digest) {
      throw new Error('Reconciliation requires the same indeterminate reservation.');
    }
  } else if (reservation.status !== 'pending') {
    throw new Error('Execution attestation requires a pending reservation.');
  }
  return {
    sessionDir,
    paths,
    source,
    reservation,
    alreadyClaimed: false,
    alreadyFinalized: false,
  };
}

function removeClaimSource(candidate, reservationDigest) {
  if (!existsSync(candidate.source)) return;
  const source = assertReservationBinding(readReservation(candidate.sessionDir, candidate.source));
  if (source.reservation_digest !== reservationDigest) {
    throw new Error('Capability reservation source changed during one-shot claim.');
  }
  unlinkSync(candidate.source);
  fsyncDirectory(dirname(candidate.source));
}

function claimHostReservation(candidate, attestationDigest, recordedAt, executionEvidence) {
  if (candidate.alreadyClaimed) {
    if (candidate.reservation.ingesting_recorded_at !== recordedAt
      || canonicalJson(candidate.reservation.ingesting_execution_evidence)
        !== canonicalJson(executionEvidence)) {
      throw new Error('Consuming capability reservation has conflicting ingestion evidence.');
    }
    removeClaimSource(candidate, candidate.reservation.reservation_digest);
    return candidate.reservation;
  }
  const consuming = {
    ...candidate.reservation,
    status: 'consuming',
    consuming_at: new Date().toISOString(),
    ingesting_attestation_digest: attestationDigest,
    ingesting_recorded_at: recordedAt,
    ingesting_from: basename(dirname(candidate.source)),
    ingesting_execution_evidence: structuredClone(executionEvidence),
  };
  assertCapabilityReservationTransition({
    fromLane: basename(dirname(candidate.source)),
    toLane: 'consuming',
    before: candidate.reservation,
    after: consuming,
  });
  writeNewPrivateJson(
    candidate.sessionDir,
    candidate.paths.consuming,
    consuming,
    'Consuming capability reservation',
  );
  const claimed = assertReservationBinding(
    readReservation(candidate.sessionDir, candidate.paths.consuming),
  );
  removeClaimSource(candidate, claimed.reservation_digest);
  return claimed;
}

function finalizeHostReservation(
  sessionDir,
  paths,
  reservation,
  outcome,
  attestationArtifact,
  workspaceArtifact,
  workspaceEvidence,
) {
  const lane = outcome.status === 'indeterminate' ? 'indeterminate' : 'completed';
  const target = paths[lane];
  const attestations = [...(reservation.attestations ?? []), {
    digest: outcome.attestation_digest,
    artifact_ref: attestationArtifact.reference,
    recorded_at: outcome.recorded_at,
    status: outcome.status,
    workspace_after: {
      digest: workspaceArtifact.digest,
      artifact_ref: workspaceArtifact.reference,
      evidence: workspaceEvidence,
    },
    execution_evidence: structuredClone(reservation.ingesting_execution_evidence),
  }];
  const final = {
    ...reservation,
    status: outcome.status,
    attestations,
    indeterminate_attestation_digest: outcome.status === 'indeterminate'
      ? outcome.attestation_digest
      : reservation.indeterminate_attestation_digest ?? null,
    completed_at: outcome.recorded_at,
    outcome_digest: outcome.outcome_digest,
    external_reference: outcome.external_reference,
    error: outcome.error,
  };
  delete final.ingesting_attestation_digest;
  delete final.ingesting_recorded_at;
  delete final.ingesting_from;
  delete final.ingesting_execution_evidence;
  assertCapabilityReservationTransition({
    fromLane: 'consuming',
    toLane: lane,
    before: reservation,
    after: final,
  });
  writeNewPrivateJson(sessionDir, target, final, 'Final capability reservation');
  const existing = assertReservationBinding(readReservation(sessionDir, target));
  if (existing.outcome_digest !== outcome.outcome_digest) {
    throw new Error('Capability reservation finalization conflicts with an existing outcome.');
  }
  if (existsSync(paths.consuming)) {
    const source = assertReservationBinding(readReservation(sessionDir, paths.consuming));
    if (source.reservation_digest !== reservation.reservation_digest) {
      throw new Error('Consuming capability reservation changed before finalization.');
    }
    unlinkSync(paths.consuming);
    fsyncDirectory(dirname(paths.consuming));
  }
  return final;
}

function appendAttestedOutcome({
  sessionDir,
  compiled,
  reservation,
  verified,
  attestation,
  artifactRefs,
  recordedAt,
}) {
  return withJournalRetry(() => {
    const snapshot = readWorkflowJournal(sessionDir, compiled);
    const decision = decisionForReservation(snapshot, reservation);
    const payload = attestedOutcomePayload(decision.payload, reservation, verified, attestation, recordedAt);
    const existing = snapshot.events.find((event) => event.event_type === 'capability.outcome'
      && event.payload.schema_version === 2
      && event.payload.attestation_digest === verified.attestation_digest);
    if (existing) {
      if (canonicalJson(existing.payload) !== canonicalJson(payload)
        || canonicalJson(existing.artifact_refs) !== canonicalJson(artifactRefs)
        || existing.recorded_at !== recordedAt) {
        throw new Error('Recorded host attestation outcome conflicts with immutable evidence.');
      }
      return payload;
    }
    appendCapabilityEvent({
      sessionDir,
      compiled,
      snapshot,
      eventType: 'capability.outcome',
      nodeId: decision.node_id,
      fingerprint: attestation.worktree_fingerprint_after,
      payload,
      artifactRefs,
      recordedAt,
    });
    return payload;
  });
}

export function ingestCapabilityAttestation({ workspace: workspaceInput, task: requestedTask, attestation }) {
  const workspace = workspacePath(workspaceInput);
  const task = resolveTask(workspace, requestedTask);
  const sessionDir = sessionPaths(workspace, task).sessionDir;
  const compiled = readJson(workflowPaths(sessionDir).planFile);
  if (!compiled) throw new Error('A compiled workflow is required before attestation ingestion.');
  const candidate = reservationForAttestation(sessionDir, attestation);
  const reservation = candidate.reservation;
  if (attestation.capability_type !== reservation.capability_type) {
    throw new Error('Attestation capability does not match its reservation.');
  }
  const evidence = hostReservationEvidence(sessionDir, reservation);
  const snapshot = readWorkflowJournal(sessionDir, compiled);
  decisionForReservation(snapshot, reservation);
  const attestationDigest = capabilityExecutionAttestationDigest(attestation);
  if (candidate.alreadyFinalized) {
    const event = snapshot.events.find((entry) => entry.event_type === 'capability.outcome'
      && entry.payload.schema_version === 2
      && entry.payload.attestation_digest === attestationDigest
      && entry.payload.reservation_digest === reservation.reservation_digest);
    const attestationEvidence = reservation.attestations?.find((entry) =>
      entry.digest === attestationDigest);
    if (!event || !attestationEvidence
      || reservation.outcome_digest !== event.payload.outcome_digest
      || attestationEvidence.recorded_at !== event.recorded_at) {
      throw new Error('Final capability reservation does not match its journaled outcome.');
    }
    const { outcome_digest: outcomeDigest, ...unsignedOutcome } = event.payload;
    const storedAttestation = readArtifact(
      sessionDir,
      ARTIFACT_KINDS.attestation,
      attestationDigest,
      attestationEvidence.artifact_ref,
    );
    if (outcomeDigest !== sha256(canonicalJson(unsignedOutcome))
      || canonicalJson(storedAttestation.value) !== canonicalJson(attestation)) {
      throw new Error('Final capability reservation evidence is inconsistent.');
    }
    return { status: event.payload.status, outcome: event.payload };
  }
  const existing = snapshot.events.find((event) => event.event_type === 'capability.outcome'
    && event.payload.schema_version === 2
    && event.payload.attestation_digest === attestationDigest);
  const recordedAt = existing?.recorded_at
    ?? reservation.ingesting_recorded_at
    ?? new Date().toISOString();
  const nowMs = Date.now();
  const node = compiled.plan.nodes.find((entry) => entry.id === reservation.node_id);
  if (!node) throw new Error('Host attestation reservation references an unknown workflow node.');
  const priorIndeterminate = attestation.status === 'reconciled'
    ? indeterminateOutcomeForReservation(sessionDir, snapshot, reservation)
    : null;
  const reconciliationAdapter = priorIndeterminate
    ? loadHostAdapter({
      workspace,
      sessionDir,
      repoId: compiled.plan.session_binding.repo_id,
      task,
      capabilityType: reservation.capability_type,
      atMs: nowMs,
    })
    : null;
  if (priorIndeterminate && reconciliationAdapter.status !== 'ready') {
    throw new HostAdapterContractError(
      reconciliationAdapter.problem,
      `Signed reconciliation requires a current trusted registration: ${reconciliationAdapter.problem}.`,
    );
  }
  const currentWorkspace = candidate.alreadyClaimed
    ? readExecutionEvidence(sessionDir, reservation.ingesting_execution_evidence)
    : (priorIndeterminate?.afterEvidence ?? captureStableManifest(workspace));
  if (priorIndeterminate && canonicalJson(currentWorkspace.evidence)
    !== canonicalJson(priorIndeterminate.afterEvidence.evidence)) {
    throw new Error('Reconciliation does not use the original indeterminate execution evidence.');
  }
  const expected = attestationExpected({
    compiled,
    task,
    reservation,
    policy: evidence.host.policy.value,
    node,
    afterEvidence: currentWorkspace,
    reconcilesAttestationDigest: priorIndeterminate?.event.payload.attestation_digest ?? null,
  });
  const replay = attestationReplayEvidence(sessionDir, attestationDigest);
  const verified = verifyCapabilityExecutionAttestation({
    registration: evidence.registration,
    registryTrust: evidence.trust,
    attestation,
    expected,
    nowMs,
    recordedAt,
    usedReplayIds: replay.replayIds,
    usedSourceEventIds: replay.sourceEventIds,
    usedExecutionBindingDigests: replay.executionBindingDigests,
    reconciliation: priorIndeterminate ? {
      registration: reconciliationAdapter.registration,
      registry_trust: reconciliationAdapter.registryTrust,
      prior_attestation: priorIndeterminate.attestation,
      prior_recorded_at: priorIndeterminate.event.recorded_at,
    } : null,
  });
  const signedDurationMs = Date.parse(attestation.completed_at) - Date.parse(attestation.started_at);
  if (!Number.isInteger(signedDurationMs)
    || signedDurationMs < 0
    || signedDurationMs > reservation.reserved_budget.duration_ms
    || (reservation.capability_type === 'process.exec'
      && attestation.result.duration_ms > reservation.reserved_budget.duration_ms)) {
    throw new Error('Signed capability execution exceeds its reserved duration budget.');
  }
  if (attestation.status === 'reconciled') {
    if (verified.resolved_status === 'indeterminate'
      || attestation.reconciles_attestation_digest
        !== priorIndeterminate.event.payload.attestation_digest) {
      throw new Error('Signed reconciliation does not resolve the same indeterminate reservation.');
    }
  } else if (reservation.indeterminate_attestation_digest) {
    throw new Error('Indeterminate capability execution requires a signed reconciliation attestation.');
  }
  const allowedPaths = expected.allowed_write_paths ?? [];
  assertWorkspaceResult(
    reservation,
    attestation,
    evidence.baseline,
    currentWorkspace.manifest,
    allowedPaths,
    currentWorkspace.git,
  );
  if (reconciliationAdapter) {
    const registrationDigest = hostAdapterRegistrationDigest(reconciliationAdapter.registration);
    const trustDigest = hostAdapterRegistryTrustDigest(reconciliationAdapter.registryTrust);
    if (registrationDigest !== verified.registration_digest
      || trustDigest !== verified.registry_trust_digest) {
      throw new Error('Reconciliation authentication artifacts do not match the verified attestation.');
    }
    assertArtifactIdentityUnused(
      sessionDir,
      ARTIFACT_KINDS.registration,
      registrationDigest,
      reconciliationAdapter.registration,
      ['registration_id', 'source_event_id', 'replay_id'],
    );
    storeArtifact(
      sessionDir,
      ARTIFACT_KINDS.registryTrust,
      reconciliationAdapter.registryTrust,
      trustDigest,
    );
    storeArtifact(
      sessionDir,
      ARTIFACT_KINDS.registration,
      reconciliationAdapter.registration,
      registrationDigest,
    );
    storeArtifact(
      sessionDir,
      ARTIFACT_KINDS.policy,
      reconciliationAdapter.capability,
      reconciliationAdapter.policyDigest,
    );
  }
  assertArtifactIdentityUnused(
    sessionDir,
    ARTIFACT_KINDS.attestation,
    attestationDigest,
    attestation,
    ['attestation_id', 'source_event_id', 'replay_id'],
  );
  const artifact = storeArtifact(
    sessionDir,
    ARTIFACT_KINDS.attestation,
    attestation,
    attestationDigest,
  );
  const resultArtifact = storeArtifact(
    sessionDir,
    ARTIFACT_KINDS.result,
    attestation.result,
    verified.result_digest,
  );
  const storedExecution = currentWorkspace.binding
    ? {
      digest: currentWorkspace.binding.digest,
      artifact_ref: currentWorkspace.binding.artifact_ref,
      workspaceArtifact: currentWorkspace.workspaceArtifact,
    }
    : storeExecutionEvidence(sessionDir, currentWorkspace);
  const artifactRefs = attestedOutcomeArtifactReferences({
    sessionDir,
    reservation,
    verified,
    attestationArtifact: artifact,
    resultArtifact,
    executionEvidence: storedExecution,
  });
  const consuming = claimHostReservation(candidate, attestationDigest, recordedAt, {
    digest: storedExecution.digest,
    artifact_ref: storedExecution.artifact_ref,
  });
  const outcome = appendAttestedOutcome({
    sessionDir,
    compiled,
    reservation: consuming,
    verified,
    attestation,
    artifactRefs,
    recordedAt,
  });
  finalizeHostReservation(
    sessionDir,
    candidate.paths,
    consuming,
    outcome,
    artifact,
    storedExecution.workspaceArtifact,
    currentWorkspace.evidence,
  );
  return { status: outcome.status, outcome };
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
  if (action === 'attest') {
    if (!args.input) throw new Error('attest requires --input <attestation.json>.');
    return ingestCapabilityAttestation({
      workspace,
      task,
      attestation: readInput(args.input),
    });
  }
  if (action !== 'authorize') throw new Error(`Unknown capability broker action: ${action}`);
  if (!args.input) throw new Error(`${action} requires --input <json-file|/dev/stdin>.`);
  const request = readInput(args.input);
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
