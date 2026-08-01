// Author: Subash Karki

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
  HostAdapterContractError,
  adapterCapabilityPolicyDigest,
  capabilityExecutionBindingDigest,
  capabilityExecutionAttestationDigest,
  capabilityExecutionAttestationSigningPayload,
  hostAdapterRegistrationDigest,
  hostAdapterRegistrationSigningPayload,
  validateCapabilityExecutionAttestation,
  validateHostAdapterRegistration,
  validateHostAdapterRegistryTrust,
  verifyCapabilityExecutionAttestation,
  verifyHostAdapterRegistration,
  verifyHostRegistryTrust,
} from '../skills/phantom/scripts/lib/host-adapter-contracts.mjs';

const BASE = Date.parse('2026-07-31T12:00:00.000Z');
const iso = (offset = 0) => new Date(BASE + offset).toISOString();
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const clone = (value) => structuredClone(value);
const registryKeys = generateKeyPairSync('ed25519');
const adapterKeys = generateKeyPairSync('ed25519');
const publicPem = (key) => key.export({ type: 'spki', format: 'pem' }).toString();

const registryTrust = () => ({
  schema_version: 1,
  trust_kind: 'host-adapter-registry',
  trust_id: 'registry-trust-1',
  key_id: 'registry-key-1',
  source: 'phantom-host-registry',
  algorithm: 'ed25519',
  public_key: publicPem(registryKeys.publicKey),
  valid_from: iso(-60 * 60_000),
  valid_until: iso(60 * 60_000),
});

const processCapability = () => ({
  type: 'process.exec',
  contract: 'sandbox-exec-v1',
  policy: {
    shell: 'disabled', stdin: 'closed', network: 'denied', filesystem: 'request-scoped',
    repository_control: 'inaccessible', phantom_control: 'inaccessible',
    environment: 'allowlist-only', credentials: 'absent', allowed_environment_names: ['LANG'],
    process_tree: 'terminate-on-timeout', max_duration_ms: 60_000,
    max_output_bytes: 1_000_000, max_processes: 8,
  },
});

const gitCommitCapability = () => ({
  type: 'git.commit',
  contract: 'git-commit-v1',
  policy: { hooks: 'disabled', signing: 'disabled', allow_empty: false },
});

const gitPushCapability = () => ({
  type: 'git.push',
  contract: 'git-push-v1',
  target: {
    remote: 'origin',
    repository_id: 'Cloudzero/research-phantom-skills',
    allowed_branches: ['feature/adapter-contract'],
  },
  policy: { force: 'denied', delete: 'denied', tags: 'denied' },
});

const githubCapability = () => ({
  type: 'github.openDraftPr',
  contract: 'github-draft-pr-v1',
  target: {
    host: 'github.com', repository_id: 'Cloudzero/research-phantom-skills',
    allowed_base_refs: ['main'], draft_only: true,
  },
});

const trackerCapability = () => ({
  type: 'tracker.comment',
  contract: 'tracker-comment-v1',
  target: { provider: 'jira', tenant_id: 'cloudzero', project_id: 'CP' },
});

const signRegistration = (registration, key = registryKeys.privateKey) => {
  registration.signature = sign(null, hostAdapterRegistrationSigningPayload(registration), key).toString('base64');
  return registration;
};

const registration = (capabilities = [
  processCapability(), gitCommitCapability(), gitPushCapability(), githubCapability(), trackerCapability(),
]) =>
  signRegistration({
    schema_version: 1,
    registration_kind: 'host-adapter',
    registration_id: 'registration-1',
    adapter: {
      adapter_id: 'codex-host-adapter', adapter_version: '1.0.0',
      host_instance_id: 'host-instance-1', attestation_key_id: 'adapter-leaf-1',
      attestation_public_key: publicPem(adapterKeys.publicKey),
    },
    scope: { repo_id: 'repo-1', task_id: 'task-1' },
    capabilities,
    issued_at: iso(-2 * 60_000),
    expires_at: iso(10 * 60_000),
    source: 'phantom-host-registry',
    source_event_id: 'registry-event-1',
    replay_id: 'registration-replay-1',
    registry_key_id: 'registry-key-1',
    signature: '',
  });

const renewedRegistration = (overrides = {}) => {
  const keys = overrides.keys ?? generateKeyPairSync('ed25519');
  const trust = overrides.trust ?? registryTrust();
  const original = registration(overrides.capabilities);
  const value = {
    ...original,
    registration_id: overrides.registration_id ?? 'registration-2',
    adapter: {
      ...original.adapter,
      attestation_key_id: 'adapter-leaf-2',
      attestation_public_key: publicPem(keys.publicKey),
      ...(overrides.adapter ?? {}),
    },
    scope: { ...original.scope, ...(overrides.scope ?? {}) },
    capabilities: overrides.capabilities ?? original.capabilities,
    issued_at: overrides.issued_at ?? iso(9 * 60_000),
    expires_at: overrides.expires_at ?? iso(20 * 60_000),
    source: trust.source,
    source_event_id: overrides.source_event_id ?? 'registry-event-2',
    replay_id: overrides.replay_id ?? 'registration-replay-2',
    registry_key_id: trust.key_id,
    signature: '',
  };
  signRegistration(value, overrides.registry_key ?? registryKeys.privateKey);
  return { keys, registration: value, trust };
};

const commonExpected = (capabilityType) => ({
  repo_id: 'repo-1', task_id: 'task-1', capability_type: capabilityType,
  workflow_id: 'workflow-1', node_id: 'node-1', request_id: 'request-1',
  request_digest: digest('request'), decision_digest: digest('decision'),
  reservation_digest: digest('reservation'), idempotency_key: 'idempotency-1',
  execution_nonce: Buffer.alloc(32, 7).toString('base64url'),
  authorized_journal_tail_digest: digest('journal-tail'),
  worktree_fingerprint_before: digest('worktree-before'),
  worktree_fingerprint_after: digest('worktree-after'),
  workspace_evidence_digest_before: digest('workspace-evidence-before'),
  workspace_evidence_digest_after: digest('workspace-evidence-after'),
});

const processResult = () => ({
  type: 'process.exec', exit_code: 0, signal: null, duration_ms: 900,
  stdout_digest: digest('stdout'), stderr_digest: digest('stderr'), output_truncated: false,
  changed_paths: [{ path: 'skills/phantom/example.mjs', digest: digest('changed') }],
  external_reference: null, error: null,
});

const gitCommitResult = () => ({
  type: 'git.commit', branch: 'feature/adapter-contract',
  parent_sha: 'abcdef1234567890', commit_sha: 'fedcba0987654321',
  tree_digest: digest('commit-tree'), message_digest: digest('commit-message'),
  external_reference: null, error: null,
});

const gitPushResult = () => ({
  type: 'git.push', remote: 'origin',
  repository_id: 'Cloudzero/research-phantom-skills',
  branch: 'feature/adapter-contract', head_sha: 'fedcba0987654321',
  forced: false, deleted: false,
  external_reference: 'git://origin/feature/adapter-contract@fedcba0987654321', error: null,
});

const githubResult = () => ({
  type: 'github.openDraftPr', host: 'github.com',
  repository_id: 'Cloudzero/research-phantom-skills', base_ref: 'main',
  head_ref: 'feature/adapter-contract', head_sha: 'abcdef1234567890', draft: true,
  title_digest: digest('title'), body_digest: digest('body'), pull_request_id: '123',
  external_reference: 'https://github.com/Cloudzero/research-phantom-skills/pull/123', error: null,
});

const trackerResult = () => ({
  type: 'tracker.comment', provider: 'jira', tenant_id: 'cloudzero', project_id: 'CP',
  issue_id: 'CP-123', body_digest: digest('comment-body'), comment_id: 'comment-1',
  external_reference: 'https://tracker.example/CP-123#comment-1', error: null,
});

const expectedFor = (type) => {
  const expected = commonExpected(type);
  if (type === 'process.exec') return { ...expected, allowed_write_paths: ['skills/phantom'] };
  if (type === 'git.commit') {
    const result = gitCommitResult();
    return Object.assign(expected, Object.fromEntries(
      ['branch', 'parent_sha', 'tree_digest', 'message_digest']
        .map((field) => [field, result[field]]),
    ));
  }
  if (type === 'git.push') {
    const result = gitPushResult();
    return Object.assign(expected, Object.fromEntries(
      ['remote', 'repository_id', 'branch', 'head_sha']
        .map((field) => [field, result[field]]),
    ));
  }
  if (type === 'github.openDraftPr') {
    const result = githubResult();
    return Object.assign(expected, Object.fromEntries(
      ['host', 'repository_id', 'base_ref', 'head_ref', 'head_sha', 'title_digest', 'body_digest']
        .map((field) => [field, result[field]]),
    ));
  }
  const result = trackerResult();
  return Object.assign(expected, Object.fromEntries(
    ['provider', 'tenant_id', 'project_id', 'issue_id', 'body_digest']
      .map((field) => [field, result[field]]),
  ));
};

const signAttestation = (attestation, key = adapterKeys.privateKey) => {
  attestation.signature = sign(
    null,
    capabilityExecutionAttestationSigningPayload(attestation),
    key,
  ).toString('base64');
  return attestation;
};

const attestation = (type, result, options = {}) => {
  const expected = expectedFor(type);
  const registrationValue = options.registration ?? registration();
  const capability = registrationValue.capabilities.find((entry) => entry.type === type);
  return signAttestation({
    schema_version: 1, attestation_kind: 'capability-execution',
    attestation_id: `attestation-${type.replaceAll('.', '-')}`,
    registration_digest: hostAdapterRegistrationDigest(registrationValue),
    adapter_id: registrationValue.adapter.adapter_id,
    adapter_version: registrationValue.adapter.adapter_version,
    attestation_key_id: registrationValue.adapter.attestation_key_id,
    capability_type: type,
    ...Object.fromEntries(Object.keys(commonExpected(type)).filter((field) => !['repo_id', 'task_id', 'capability_type'].includes(field))
      .map((field) => [field, expected[field]])),
    policy_digest: adapterCapabilityPolicyDigest(capability),
    started_at: options.started_at ?? iso(-60_000),
    completed_at: options.completed_at ?? iso(-30_000),
    issued_at: options.issued_at ?? iso(-20_000),
    expires_at: options.expires_at ?? iso(4 * 60_000),
    status: 'succeeded', resolution: null,
    reconciles_attestation_digest: null, result,
    source_event_id: `execution-event-${type.replaceAll('.', '-')}`,
    replay_id: `execution-replay-${type.replaceAll('.', '-')}`,
    signature: '',
  }, options.key ?? adapterKeys.privateKey);
};

const verifyExecution = (value, expected = expectedFor(value.capability_type), options = {}) =>
  verifyCapabilityExecutionAttestation({
    registration: registration(), registryTrust: registryTrust(), attestation: value,
    expected, recordedAt: iso(), nowMs: BASE, ...options,
  });

const rejectsCode = (code) => (error) => (
  error instanceof HostAdapterContractError && error.code === code
);

test('registry trust and registration contracts are strict, typed, and credential-free', () => {
  const trust = registryTrust();
  const value = registration();
  assert.deepEqual(validateHostAdapterRegistryTrust(trust), []);
  assert.deepEqual(validateHostAdapterRegistration(value), []);
  assert.equal(verifyHostRegistryTrust(trust, { atMs: BASE }).algorithm, 'ed25519');
  const verified = verifyHostAdapterRegistration({
    registration: value, registryTrust: trust,
    expected: { repo_id: 'repo-1', task_id: 'task-1' }, atMs: BASE,
  });
  assert.deepEqual(verified.capability_types, [
    'git.commit', 'git.push', 'github.openDraftPr', 'process.exec', 'tracker.comment',
  ]);
  assert.match(verified.registry.trust_digest, /^sha256:/);

  const executable = clone(value);
  executable.adapter.module_path = '/tmp/adapter.mjs';
  assert.ok(validateHostAdapterRegistration(executable).some((item) => item.includes('unsupported property')));
  const credential = clone(value);
  credential.credentials = { token: 'never-allowed' };
  assert.throws(() => verifyHostAdapterRegistration({
    registration: credential, registryTrust: trust,
    expected: { repo_id: 'repo-1', task_id: 'task-1' }, atMs: BASE,
  }), rejectsCode('contract_invalid'));
  const secret = clone(value);
  secret.capabilities[0].policy.allowed_environment_names = ['GITHUB_TOKEN'];
  signRegistration(secret);
  assert.throws(() => verifyHostAdapterRegistration({
    registration: secret, registryTrust: trust,
    expected: { repo_id: 'repo-1', task_id: 'task-1' }, atMs: BASE,
  }), rejectsCode('policy_invalid'));
});

test('registry trust is separate from lifecycle authority and an adapter leaf cannot self-register', () => {
  const leafSigned = registration();
  signRegistration(leafSigned, adapterKeys.privateKey);
  assert.throws(() => verifyHostAdapterRegistration({
    registration: leafSigned, registryTrust: registryTrust(),
    expected: { repo_id: 'repo-1', task_id: 'task-1' }, atMs: BASE,
  }), rejectsCode('signature_invalid'));

  const lifecycleTrust = { ...registryTrust(), trust_kind: 'lifecycle-authority' };
  assert.throws(() => verifyHostRegistryTrust(lifecycleTrust, { atMs: BASE }), rejectsCode('trust_invalid'));
  const ambiguousTrust = { ...registryTrust(), algorithm: 'rsa' };
  assert.throws(() => verifyHostRegistryTrust(ambiguousTrust, { atMs: BASE }), rejectsCode('trust_invalid'));
  const expiredTrust = { ...registryTrust(), valid_until: iso(-1) };
  assert.throws(() => verifyHostRegistryTrust(expiredTrust, { atMs: BASE }), rejectsCode('trust_expired'));
  assert.throws(() => verifyHostAdapterRegistration({
    registration: registration(), registryTrust: registryTrust(),
    expected: { repo_id: 'repo-1', task_id: 'task-1' }, atMs: BASE,
    usedReplayIds: ['registration-replay-1'],
  }), rejectsCode('replay_detected'));

  const longLived = registration();
  longLived.expires_at = iso(20 * 60_000);
  signRegistration(longLived);
  assert.throws(() => verifyHostAdapterRegistration({
    registration: longLived, registryTrust: registryTrust(),
    expected: { repo_id: 'repo-1', task_id: 'task-1' }, atMs: BASE,
  }), rejectsCode('expired'));
  assert.throws(() => verifyHostAdapterRegistration({
    registration: registration(), registryTrust: { ...registryTrust(), valid_until: iso(5 * 60_000) },
    expected: { repo_id: 'repo-1', task_id: 'task-1' }, atMs: BASE,
  }), rejectsCode('trust_mismatch'));
});

test('process attestations bind nonce, reservation, policy, scope, and leaf signature', () => {
  const value = attestation('process.exec', processResult());
  assert.deepEqual(validateCapabilityExecutionAttestation(value), []);
  assert.equal(verifyExecution(value).resolved_status, 'succeeded');

  const wrongNonce = clone(value);
  wrongNonce.execution_nonce = 'nonce_00000000000000000000000000000000';
  signAttestation(wrongNonce);
  assert.throws(() => verifyExecution(wrongNonce), rejectsCode('binding_mismatch'));
  const wrongPolicy = clone(value);
  wrongPolicy.policy_digest = digest('wrong-policy');
  signAttestation(wrongPolicy);
  assert.throws(() => verifyExecution(wrongPolicy), rejectsCode('policy_invalid'));
  const escaped = clone(value);
  escaped.result.changed_paths = [{ path: 'test/escaped.js', digest: digest('escaped') }];
  signAttestation(escaped);
  assert.throws(() => verifyExecution(escaped), rejectsCode('scope_violation'));
  const badSignature = clone(value);
  badSignature.signature = `${badSignature.signature.slice(0, -2)}AA`;
  assert.throws(() => verifyExecution(badSignature), rejectsCode('signature_invalid'));
  assert.throws(() => verifyExecution(value, expectedFor('process.exec'), {
    usedReplayIds: [value.replay_id],
  }), rejectsCode('replay_detected'));
  assert.throws(() => verifyExecution(value, expectedFor('process.exec'), {
    usedExecutionBindingDigests: [capabilityExecutionBindingDigest(value)],
  }), rejectsCode('replay_detected'));

  const windowsTraversal = clone(value);
  windowsTraversal.result.changed_paths = [{
    path: 'skills/phantom/safe\\..\\..\\outside.txt', digest: digest('escaped'),
  }];
  signAttestation(windowsTraversal);
  assert.throws(() => verifyExecution(windowsTraversal), rejectsCode('contract_invalid'));
  assert.throws(() => verifyExecution(value, {
    ...expectedFor('process.exec'), allowed_write_paths: ['skills\\phantom'],
  }), rejectsCode('path_invalid'));
});

test('Git, GitHub, and tracker attestations enforce registered and request-bound targets', () => {
  for (const [type, result] of [
    ['git.commit', gitCommitResult()],
    ['git.push', gitPushResult()],
    ['github.openDraftPr', githubResult()],
    ['tracker.comment', trackerResult()],
  ]) {
    const value = attestation(type, result);
    assert.equal(verifyExecution(value).resolved_status, 'succeeded');
  }

  const github = attestation('github.openDraftPr', githubResult());
  github.result.repository_id = 'Cloudzero/other';
  signAttestation(github);
  assert.throws(() => verifyExecution(
    github,
    { ...expectedFor('github.openDraftPr'), repository_id: 'Cloudzero/other' },
  ), rejectsCode('target_violation'));
  const tracker = attestation('tracker.comment', trackerResult());
  tracker.result.project_id = 'OTHER';
  signAttestation(tracker);
  assert.throws(() => verifyExecution(
    tracker,
    { ...expectedFor('tracker.comment'), project_id: 'OTHER' },
  ), rejectsCode('target_violation'));

  const commit = attestation('git.commit', gitCommitResult());
  commit.result.parent_sha = '0'.repeat(16);
  signAttestation(commit);
  assert.throws(() => verifyExecution(commit), rejectsCode('binding_mismatch'));
  const push = attestation('git.push', gitPushResult());
  push.result.branch = 'main';
  signAttestation(push);
  assert.throws(() => verifyExecution(
    push,
    { ...expectedFor('git.push'), branch: 'main' },
  ), rejectsCode('target_violation'));
});

test('indeterminate executions require nonce-bound reconciliation and never imply success', () => {
  const uncertain = attestation('github.openDraftPr', {
    ...githubResult(), pull_request_id: null, external_reference: null, error: 'response lost',
  });
  uncertain.status = 'indeterminate';
  signAttestation(uncertain);
  assert.equal(verifyExecution(uncertain).resolved_status, 'indeterminate');

  const contradictory = clone(uncertain);
  contradictory.result.pull_request_id = '123';
  signAttestation(contradictory);
  assert.throws(() => verifyExecution(contradictory), rejectsCode('result_invalid'));

  const priorDigest = capabilityExecutionAttestationDigest(uncertain);
  const reconciled = attestation('github.openDraftPr', githubResult());
  reconciled.status = 'reconciled';
  reconciled.resolution = 'succeeded';
  reconciled.reconciles_attestation_digest = priorDigest;
  reconciled.attestation_id = 'attestation-reconciliation-1';
  reconciled.source_event_id = 'execution-event-reconciliation-1';
  reconciled.replay_id = 'execution-replay-reconciliation-1';
  signAttestation(reconciled);
  const expected = { ...expectedFor('github.openDraftPr'), reconciles_attestation_digest: priorDigest };
  const reconciliation = {
    registration: registration(),
    registry_trust: registryTrust(),
    prior_attestation: uncertain,
    prior_recorded_at: iso(),
  };
  assert.equal(verifyExecution(reconciled, expected, { reconciliation }).resolved_status, 'succeeded');
  assert.throws(() => verifyExecution(reconciled, {
    ...expected, reconciles_attestation_digest: digest('other-attestation'),
  }, { reconciliation }), rejectsCode('reconciliation_invalid'));
});

test('one fresh-registration reconciliation is valid after original expiry and boundaries fail closed', () => {
  const uncertain = attestation('github.openDraftPr', {
    ...githubResult(), pull_request_id: null, external_reference: null, error: 'response lost',
  });
  uncertain.status = 'indeterminate';
  signAttestation(uncertain);
  const priorDigest = capabilityExecutionAttestationDigest(uncertain);
  const renewed = renewedRegistration();
  const reconciled = attestation('github.openDraftPr', githubResult(), {
    registration: renewed.registration,
    key: renewed.keys.privateKey,
    started_at: iso(11 * 60_000),
    completed_at: iso(11 * 60_000 + 10_000),
    issued_at: iso(11 * 60_000 + 20_000),
    expires_at: iso(14 * 60_000),
  });
  Object.assign(reconciled, {
    status: 'reconciled',
    resolution: 'succeeded',
    reconciles_attestation_digest: priorDigest,
    attestation_id: 'attestation-renewed-reconciliation',
    source_event_id: 'execution-event-renewed-reconciliation',
    replay_id: 'execution-replay-renewed-reconciliation',
  });
  signAttestation(reconciled, renewed.keys.privateKey);
  const expected = { ...expectedFor('github.openDraftPr'), reconciles_attestation_digest: priorDigest };
  const recordedAt = iso(11 * 60_000 + 30_000);
  const verified = verifyCapabilityExecutionAttestation({
    registration: registration(),
    registryTrust: registryTrust(),
    attestation: reconciled,
    expected,
    nowMs: Date.parse(recordedAt),
    recordedAt,
    reconciliation: {
      registration: renewed.registration,
      registry_trust: renewed.trust,
      prior_attestation: uncertain,
      prior_recorded_at: iso(),
    },
  });
  assert.equal(verified.resolved_status, 'succeeded');
  assert.equal(verified.authorization_registration_digest, hostAdapterRegistrationDigest(registration()));
  assert.equal(verified.registration_digest, hostAdapterRegistrationDigest(renewed.registration));

  const originalBoundary = attestation('process.exec', processResult(), {
    started_at: iso(9 * 60_000),
    completed_at: iso(10 * 60_000),
    issued_at: iso(10 * 60_000),
    expires_at: iso(14 * 60_000),
  });
  assert.throws(() => verifyExecution(originalBoundary, expectedFor('process.exec'), {
    nowMs: Date.parse(iso(10 * 60_000)),
    recordedAt: iso(10 * 60_000),
  }), rejectsCode('expired'));

  const renewedBoundary = clone(reconciled);
  Object.assign(renewedBoundary, {
    started_at: iso(19 * 60_000),
    completed_at: iso(19 * 60_000 + 50_000),
    issued_at: iso(19 * 60_000 + 50_000),
    expires_at: iso(23 * 60_000),
    attestation_id: 'attestation-renewed-expiry-boundary',
    source_event_id: 'execution-event-renewed-expiry-boundary',
    replay_id: 'execution-replay-renewed-expiry-boundary',
  });
  signAttestation(renewedBoundary, renewed.keys.privateKey);
  assert.throws(() => verifyCapabilityExecutionAttestation({
    registration: registration(),
    registryTrust: registryTrust(),
    attestation: renewedBoundary,
    expected,
    nowMs: Date.parse(iso(20 * 60_000)),
    recordedAt: iso(20 * 60_000),
    reconciliation: {
      registration: renewed.registration,
      registry_trust: renewed.trust,
      prior_attestation: uncertain,
      prior_recorded_at: iso(),
    },
  }), rejectsCode('expired'));
});

test('reconciliation rejects adapter, session scope, trust, and policy substitution', () => {
  const uncertain = attestation('github.openDraftPr', {
    ...githubResult(), pull_request_id: null, external_reference: null, error: 'response lost',
  });
  uncertain.status = 'indeterminate';
  signAttestation(uncertain);
  const priorDigest = capabilityExecutionAttestationDigest(uncertain);
  const expected = { ...expectedFor('github.openDraftPr'), reconciles_attestation_digest: priorDigest };
  const recordedAt = iso(11 * 60_000 + 30_000);
  const reconciliationAttestation = (renewed, suffix) => {
    const value = attestation('github.openDraftPr', githubResult(), {
      registration: renewed.registration,
      key: renewed.keys.privateKey,
      started_at: iso(11 * 60_000),
      completed_at: iso(11 * 60_000 + 10_000),
      issued_at: iso(11 * 60_000 + 20_000),
      expires_at: iso(14 * 60_000),
    });
    Object.assign(value, {
      status: 'reconciled',
      resolution: 'succeeded',
      reconciles_attestation_digest: priorDigest,
      attestation_id: `attestation-substitution-${suffix}`,
      source_event_id: `execution-event-substitution-${suffix}`,
      replay_id: `execution-replay-substitution-${suffix}`,
    });
    return signAttestation(value, renewed.keys.privateKey);
  };
  const verifyRenewed = (renewed, value) => verifyCapabilityExecutionAttestation({
    registration: registration(),
    registryTrust: registryTrust(),
    attestation: value,
    expected,
    nowMs: Date.parse(recordedAt),
    recordedAt,
    reconciliation: {
      registration: renewed.registration,
      registry_trust: renewed.trust,
      prior_attestation: uncertain,
      prior_recorded_at: iso(),
    },
  });

  const adapterSubstitution = renewedRegistration({ adapter: { adapter_id: 'other-adapter' } });
  assert.throws(() => verifyRenewed(
    adapterSubstitution,
    reconciliationAttestation(adapterSubstitution, 'adapter'),
  ), rejectsCode('binding_mismatch'));

  const scopeSubstitution = renewedRegistration({ scope: { task_id: 'other-task' } });
  assert.throws(() => verifyRenewed(
    scopeSubstitution,
    reconciliationAttestation(scopeSubstitution, 'scope'),
  ), rejectsCode('binding_mismatch'));

  const alternateRegistryKeys = generateKeyPairSync('ed25519');
  const alternateTrust = {
    ...registryTrust(),
    trust_id: 'registry-trust-substitute',
    key_id: 'registry-key-substitute',
    source: 'substitute-host-registry',
    public_key: publicPem(alternateRegistryKeys.publicKey),
  };
  const trustSubstitution = renewedRegistration({
    trust: alternateTrust,
    registry_key: alternateRegistryKeys.privateKey,
  });
  assert.throws(() => verifyRenewed(
    trustSubstitution,
    reconciliationAttestation(trustSubstitution, 'trust'),
  ), rejectsCode('trust_mismatch'));

  const expandedGithub = githubCapability();
  expandedGithub.target.allowed_base_refs = ['develop', 'main'];
  const policySubstitution = renewedRegistration({
    capabilities: [
      processCapability(), gitCommitCapability(), gitPushCapability(), expandedGithub, trackerCapability(),
    ],
  });
  assert.throws(() => verifyRenewed(
    policySubstitution,
    reconciliationAttestation(policySubstitution, 'policy'),
  ), rejectsCode('policy_invalid'));
});

test('historical verification uses recorded time instead of current wall time', () => {
  const value = attestation('process.exec', processResult());
  const later = BASE + 24 * 60 * 60_000;
  const verified = verifyExecution(value, expectedFor('process.exec'), { nowMs: later });
  assert.equal(verified.historical, true);
  assert.throws(() => verifyCapabilityExecutionAttestation({
    registration: registration(), registryTrust: registryTrust(), attestation: value,
    expected: expectedFor('process.exec'), nowMs: later,
  }), rejectsCode('expired'));

  assert.throws(() => verifyHostRegistryTrust(registryTrust(), { atMs: Number.NaN }), rejectsCode('time_invalid'));
  assert.throws(() => verifyExecution(value, expectedFor('process.exec'), { nowMs: Number.NaN }), rejectsCode('time_invalid'));

  const issuedAfterRegistration = clone(value);
  issuedAfterRegistration.issued_at = iso(11 * 60_000);
  issuedAfterRegistration.expires_at = iso(14 * 60_000);
  signAttestation(issuedAfterRegistration);
  assert.throws(() => verifyExecution(
    issuedAfterRegistration,
    expectedFor('process.exec'),
    { recordedAt: iso(11 * 60_000), nowMs: BASE + 24 * 60 * 60_000 },
  ), rejectsCode('time_invalid'));
});

test('signature encodings are canonical and environment policy is positive-only', () => {
  const value = registration();
  value.signature = `${value.signature.slice(0, -2)}${value.signature.endsWith('==') ? '' : '='}`;
  assert.throws(() => verifyHostAdapterRegistration({
    registration: value, registryTrust: registryTrust(),
    expected: { repo_id: 'repo-1', task_id: 'task-1' }, atMs: BASE,
  }), rejectsCode('signature_invalid'));

  for (const unsafeName of ['GITHUB_PAT', 'CI_JOB_JWT', 'PGPASSFILE', 'NETRC']) {
    const unsafe = registration();
    unsafe.capabilities[0].policy.allowed_environment_names = [unsafeName];
    signRegistration(unsafe);
    assert.throws(() => verifyHostAdapterRegistration({
      registration: unsafe, registryTrust: registryTrust(),
      expected: { repo_id: 'repo-1', task_id: 'task-1' }, atMs: BASE,
    }), rejectsCode('policy_invalid'));
  }
});
