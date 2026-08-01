// Author: Subash Karki

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

import { canonicalJson } from './workflow-contracts.mjs';

const loadSchema = (name) => JSON.parse(
  readFileSync(new URL(`../../schemas/${name}`, import.meta.url), 'utf8'),
);

export const hostAdapterRegistryTrustSchema = loadSchema('host-adapter-registry-trust.schema.json');
export const hostAdapterRegistrationSchema = loadSchema('host-adapter-registration.schema.json');
export const capabilityExecutionAttestationSchema = loadSchema('capability-execution-attestation.schema.json');
export const SUPPORTED_ADAPTER_CAPABILITIES = Object.freeze([
  'git.commit', 'git.push', 'github.openDraftPr', 'process.exec', 'tracker.comment',
]);

export const MAX_REGISTRATION_LIFETIME_MS = 15 * 60_000;
export const MAX_ATTESTATION_LIFETIME_MS = 5 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const SAFE_ENVIRONMENT_NAMES = new Set([
  'CARGO_TERM_COLOR', 'CI', 'COLORTERM', 'FORCE_COLOR', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'NODE_ENV', 'NO_COLOR', 'PYTHONDONTWRITEBYTECODE', 'PYTHONUNBUFFERED', 'RUST_BACKTRACE',
  'TERM', 'TZ',
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

export class HostAdapterContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HostAdapterContractError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new HostAdapterContractError(code, message);
};

const typeMatches = (type, value) => {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
};

const referencedSchema = (root, reference) => {
  if (!reference.startsWith('#/')) fail('schema_invalid', `Unsupported schema reference: ${reference}`);
  let current = root;
  for (const token of reference.slice(2).split('/')) {
    current = current?.[token.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  if (!isObject(current)) fail('schema_invalid', `Missing schema reference: ${reference}`);
  return current;
};

function validateNode(root, schema, value, path, errors) {
  if (schema.$ref) return validateNode(root, referencedSchema(root, schema.$ref), value, path, errors);
  if (schema.oneOf) {
    const matches = schema.oneOf.map((candidate) => validateNode(root, candidate, value, path, []));
    const valid = matches.filter((candidate) => candidate.length === 0);
    if (valid.length !== 1) {
      const detail = matches.map((candidate) => candidate[0]).filter(Boolean).join(' | ');
      errors.push(`${path}: must match exactly one schema${detail ? ` (${detail})` : ''}`);
    }
    return errors;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.some((candidate) => canonicalJson(candidate) === canonicalJson(value))) {
    errors.push(`${path}: must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    return errors;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(type, value))) {
      errors.push(`${path}: must be ${types.join(' or ')}`);
      return errors;
    }
  }
  if (value === null) return errors;
  if (isObject(value)) {
    for (const field of schema.required || []) if (!Object.hasOwn(value, field)) {
      errors.push(`${path}.${field}: required`);
    }
    const properties = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const field of Object.keys(value)) if (!Object.hasOwn(properties, field)) {
        errors.push(`${path}.${field}: unsupported property`);
      }
    }
    for (const [field, fieldSchema] of Object.entries(properties)) if (Object.hasOwn(value, field)) {
      validateNode(root, fieldSchema, value[field], `${path}.${field}`, errors);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(
      `${path}: requires at least ${schema.minItems} item(s)`,
    );
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(
      `${path}: allows at most ${schema.maxItems} item(s)`,
    );
    if (schema.uniqueItems) {
      const seen = new Set();
      value.forEach((item, index) => {
        const key = canonicalJson(item);
        if (seen.has(key)) errors.push(`${path}[${index}]: duplicate item`);
        seen.add(key);
      });
    }
    value.forEach((item, index) => validateNode(root, schema.items || {}, item, `${path}[${index}]`, errors));
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(
      `${path}: must contain at least ${schema.minLength} character(s)`,
    );
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(
      `${path}: must contain at most ${schema.maxLength} character(s)`,
    );
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(
      `${path}: does not match ${schema.pattern}`,
    );
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }
  return errors;
}

const validateAgainst = (schema, value) => validateNode(schema, schema, value, '$', []);

export const validateHostAdapterRegistryTrust = (value) => validateAgainst(hostAdapterRegistryTrustSchema, value);
export const validateHostAdapterRegistration = (value) => validateAgainst(hostAdapterRegistrationSchema, value);
export const validateCapabilityExecutionAttestation = (value) =>
  validateAgainst(capabilityExecutionAttestationSchema, value);

const signingPayload = (value, label) => {
  if (!isObject(value)) fail('contract_invalid', `${label} must be an object.`);
  const { signature: ignored, ...unsigned } = value;
  void ignored;
  return Buffer.from(canonicalJson(unsigned), 'utf8');
};

export const hostAdapterRegistrationSigningPayload = (registration) =>
  signingPayload(registration, 'Host adapter registration');

export const capabilityExecutionAttestationSigningPayload = (attestation) =>
  signingPayload(attestation, 'Capability execution attestation');

export const hostAdapterRegistrationDigest = (registration) => digest(canonicalJson(registration));

export const hostAdapterRegistryTrustDigest = (registryTrust) => digest(canonicalJson(registryTrust));

export const capabilityExecutionAttestationDigest = (attestation) => digest(canonicalJson(attestation));

export const capabilityExecutionBindingDigest = (value) => digest(canonicalJson({
  registration_digest: value.registration_digest,
  reservation_digest: value.reservation_digest,
  execution_nonce: value.execution_nonce,
}));

export const adapterCapabilityPolicyDigest = (capability) => digest(canonicalJson(capability));

const publicEd25519Key = (value, label) => {
  let key;
  try {
    key = createPublicKey(value);
  } catch {
    fail('trust_invalid', `${label} is not a valid public key.`);
  }
  if (key.asymmetricKeyType !== 'ed25519') fail('trust_invalid', `${label} must be Ed25519.`);
  return key;
};

const canonicalTime = (value, label) => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail('time_invalid', `${label} must be a canonical ISO-8601 timestamp.`);
  }
  return parsed;
};

export function verifyHostRegistryTrust(registryTrust, { atMs = Date.now() } = {}) {
  const errors = validateHostAdapterRegistryTrust(registryTrust);
  if (errors.length) fail('trust_invalid', `Invalid host adapter registry trust: ${errors.join('; ')}`);
  const validFromMs = canonicalTime(registryTrust.valid_from, 'Registry trust valid_from');
  const validUntilMs = canonicalTime(registryTrust.valid_until, 'Registry trust valid_until');
  if (!Number.isFinite(atMs)) fail('time_invalid', 'Registry trust verification time must be finite.');
  if (validUntilMs <= validFromMs || atMs < validFromMs || atMs >= validUntilMs) {
    fail('trust_expired', 'Host adapter registry trust is not valid at the verification time.');
  }
  return {
    ...registryTrust, validFromMs, validUntilMs,
    trust_digest: hostAdapterRegistryTrustDigest(registryTrust),
    publicKey: publicEd25519Key(registryTrust.public_key, 'Registry public key'),
  };
}

const requireLifetime = (label, issuedValue, expiresValue, atMs, maximum) => {
  const issuedAt = canonicalTime(issuedValue, `${label} issued_at`);
  const expiresAt = canonicalTime(expiresValue, `${label} expires_at`);
  if (issuedAt > atMs + MAX_CLOCK_SKEW_MS) fail('not_yet_valid', `${label} issued_at is too far in the future.`);
  if (expiresAt <= issuedAt || expiresAt - issuedAt > maximum || expiresAt <= atMs) {
    fail('expired', `${label} is expired or exceeds its maximum lifetime.`);
  }
  return { issuedAt, expiresAt };
};

const requireSignature = (label, payload, signatureValue, publicKey) => {
  const signature = Buffer.from(signatureValue, 'base64');
  if (signature.length !== 64
    || signature.toString('base64') !== signatureValue
    || !verifySignature(null, payload, publicKey, signature)) {
    fail('signature_invalid', `${label} signature is invalid.`);
  }
};

const requireUnused = (value, used, label) => {
  if (used.includes(value)) fail('replay_detected', `${label} has already been used.`);
};

const capabilityMap = (registration) => new Map(
  registration.capabilities.map((capability) => [capability.type, capability]),
);

const requireExactObject = (value, fields, code, label) => {
  if (!isObject(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...fields].sort())) {
    fail(code, `${label} must contain exactly ${fields.join(', ')}.`);
  }
  return value;
};

export function verifyHostAdapterRegistration({
  registration, registryTrust, expected, atMs = Date.now(),
  usedReplayIds = [], usedSourceEventIds = [],
}) {
  const errors = validateHostAdapterRegistration(registration);
  if (errors.length) fail('contract_invalid', `Invalid host adapter registration: ${errors.join('; ')}`);
  if (!isObject(expected) || typeof expected.repo_id !== 'string' || typeof expected.task_id !== 'string') {
    fail('binding_missing', 'Registration verification requires expected repo_id and task_id.');
  }
  const trust = verifyHostRegistryTrust(registryTrust, { atMs });
  if (registration.registry_key_id !== trust.key_id || registration.source !== trust.source) {
    fail('trust_mismatch', 'Registration key or source does not match host adapter registry trust.');
  }
  if (registration.scope.repo_id !== expected.repo_id || registration.scope.task_id !== expected.task_id) {
    fail('binding_mismatch', 'Registration repository or task binding does not match the expected session.');
  }
  const capabilities = capabilityMap(registration);
  if (capabilities.size !== registration.capabilities.length) {
    fail('policy_invalid', 'Registration contains duplicate capability types.');
  }
  if (expected.capability_type && !capabilities.has(expected.capability_type)) {
    fail('capability_unavailable', `Registration does not provide ${expected.capability_type}.`);
  }
  for (const capability of registration.capabilities) if (capability.type === 'process.exec') {
    const unsafe = capability.policy.allowed_environment_names.find((name) =>
      !SAFE_ENVIRONMENT_NAMES.has(name));
    if (unsafe) fail('policy_invalid', 'Sandbox environment allowlist contains a non-portable safe name.');
  }
  const lifetime = requireLifetime('Host adapter registration', registration.issued_at,
    registration.expires_at, atMs, MAX_REGISTRATION_LIFETIME_MS);
  if (lifetime.issuedAt < trust.validFromMs || lifetime.expiresAt > trust.validUntilMs) {
    fail('trust_mismatch', 'Registration lifetime extends outside the registry trust window.');
  }
  requireUnused(registration.replay_id, usedReplayIds, 'Registration replay_id');
  requireUnused(registration.source_event_id, usedSourceEventIds, 'Registration source_event_id');
  requireSignature('Host adapter registration', hostAdapterRegistrationSigningPayload(registration),
    registration.signature, trust.publicKey);
  const attestationPublicKey = publicEd25519Key(
    registration.adapter.attestation_public_key,
    'Adapter attestation public key',
  );
  return {
    registration_digest: hostAdapterRegistrationDigest(registration),
    registration_id: registration.registration_id,
    adapter_id: registration.adapter.adapter_id,
    adapter_version: registration.adapter.adapter_version,
    host_instance_id: registration.adapter.host_instance_id,
    attestation_key_id: registration.adapter.attestation_key_id,
    capability_types: [...capabilities.keys()].sort(),
    policy_digests: Object.fromEntries([...capabilities].map(([type, value]) =>
      [type, adapterCapabilityPolicyDigest(value)])),
    scope: structuredClone(registration.scope),
    registry: {
      trust_id: trust.trust_id, trust_digest: trust.trust_digest,
      key_id: trust.key_id, source: trust.source,
      valid_from: trust.valid_from, valid_until: trust.valid_until,
    },
    registration_source_event_id: registration.source_event_id,
    registration_replay_id: registration.replay_id,
    issued_at: registration.issued_at,
    expires_at: registration.expires_at,
    issuedAtMs: lifetime.issuedAt,
    expiresAtMs: lifetime.expiresAt,
    attestationPublicKey,
    capabilities,
  };
}

export const CAPABILITY_ATTESTATION_BINDING_FIELDS = Object.freeze([
  'workflow_id', 'node_id', 'request_id', 'request_digest', 'decision_digest',
  'reservation_digest', 'idempotency_key', 'execution_nonce',
  'authorized_journal_tail_digest', 'worktree_fingerprint_before', 'worktree_fingerprint_after',
  'workspace_evidence_digest_before', 'workspace_evidence_digest_after',
]);
const bindingFields = CAPABILITY_ATTESTATION_BINDING_FIELDS;

const canonicalPortablePath = (value, { allowRoot = false } = {}) => {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')
    || value.includes('\0') || value.includes('//') || value.startsWith('/')
    || /^[A-Za-z]:/.test(value) || /(?:^|\/)\.\.?(?:\/|$)/.test(value)
    || posix.normalize(value) !== value || (!allowRoot && value === '.')) {
    fail('path_invalid', 'Execution scope contains a noncanonical portable path.');
  }
  return value.replace(/\/$/, '');
};

const withinScope = (candidate, scope) => {
  const path = canonicalPortablePath(candidate);
  const root = canonicalPortablePath(scope, { allowRoot: true });
  return root === '.' || path === root || path.startsWith(`${root}/`);
};

const requireResultBindings = (attestation, capability, expected) => {
  const result = attestation.result;
  if (result.type !== attestation.capability_type) fail('binding_mismatch', 'Attestation result type is inconsistent.');
  if (result.type === 'process.exec') {
    const scopes = expected.allowed_write_paths;
    if (!Array.isArray(scopes)) fail('binding_missing', 'Process attestation requires expected allowed_write_paths.');
    scopes.forEach((scope) => canonicalPortablePath(scope, { allowRoot: true }));
    const paths = result.changed_paths.map((entry) => entry.path);
    if (new Set(paths).size !== paths.length) fail('result_invalid', 'Process changed paths must be unique.');
    if (paths.some((path) => !scopes.some((scope) => withinScope(path, scope)))) {
      fail('scope_violation', 'Process attestation reports a changed path outside the authorized scope.');
    }
    if (result.duration_ms > capability.policy.max_duration_ms) {
      fail('result_invalid', 'Process duration exceeds the registered sandbox policy.');
    }
  } else if (result.type === 'git.commit') {
    for (const field of ['branch', 'parent_sha', 'tree_digest', 'message_digest']) {
      if (result[field] !== expected[field]) {
        fail('binding_mismatch', `Git commit result ${field} does not match the request binding.`);
      }
    }
  } else if (result.type === 'git.push') {
    const target = capability.target;
    if (result.remote !== target.remote || result.repository_id !== target.repository_id
      || !target.allowed_branches.includes(result.branch)) {
      fail('target_violation', 'Git push result is outside the registered target restriction.');
    }
    for (const field of ['remote', 'repository_id', 'branch', 'head_sha']) {
      if (result[field] !== expected[field]) {
        fail('binding_mismatch', `Git push result ${field} does not match the request binding.`);
      }
    }
  } else if (result.type === 'github.openDraftPr') {
    const target = capability.target;
    if (result.host !== target.host || result.repository_id !== target.repository_id
      || !target.allowed_base_refs.includes(result.base_ref)) {
      fail('target_violation', 'GitHub result is outside the registered target restriction.');
    }
    for (const field of ['host', 'repository_id', 'base_ref', 'head_ref', 'head_sha', 'title_digest', 'body_digest']) {
      if (result[field] !== expected[field]) fail('binding_mismatch', `GitHub result ${field} does not match the request binding.`);
    }
  } else {
    const target = capability.target;
    if (result.provider !== target.provider || result.tenant_id !== target.tenant_id
      || result.project_id !== target.project_id) {
      fail('target_violation', 'Tracker result is outside the registered target restriction.');
    }
    for (const field of ['provider', 'tenant_id', 'project_id', 'issue_id', 'body_digest']) {
      if (result[field] !== expected[field]) fail('binding_mismatch', `Tracker result ${field} does not match the request binding.`);
    }
  }
};

const effectiveStatus = (attestation) => {
  if (attestation.status === 'reconciled') {
    if (!attestation.reconciles_attestation_digest || !attestation.resolution) {
      fail('reconciliation_invalid', 'Reconciled attestation requires a prior digest and resolution.');
    }
    return attestation.resolution;
  }
  if (attestation.reconciles_attestation_digest !== null || attestation.resolution !== null) {
    fail('reconciliation_invalid', 'Only reconciled attestations may carry reconciliation fields.');
  }
  return attestation.status;
};

const hasExternalIdentity = (result) => (
  (result.type === 'git.commit' && result.commit_sha !== null)
  || (result.type === 'github.openDraftPr' && result.pull_request_id !== null)
  || (result.type === 'tracker.comment' && result.comment_id !== null)
);

const requireResultStatus = (attestation) => {
  const result = attestation.result;
  const status = effectiveStatus(attestation);
  if (attestation.status === 'indeterminate') {
    if (!result.error || result.external_reference !== null || hasExternalIdentity(result)) {
      fail('result_invalid', 'Indeterminate result requires an error and no asserted external identity.');
    }
    return status;
  }
  if (status === 'failed') {
    if (!result.error || result.external_reference !== null || hasExternalIdentity(result)) {
      fail('result_invalid', 'Failed result requires an error and no asserted external identity.');
    }
    return status;
  }
  if (result.error !== null) fail('result_invalid', 'Successful result cannot include an error.');
  if (result.type === 'process.exec' && result.exit_code !== 0) {
    fail('result_invalid', 'Successful process result requires exit_code 0.');
  }
  if (result.type === 'git.commit' && !result.commit_sha) {
    fail('result_invalid', 'Successful Git commit result requires a commit SHA.');
  }
  if (result.type === 'git.push' && !result.external_reference) {
    fail('result_invalid', 'Successful Git push result requires an external reference.');
  }
  if (result.type === 'github.openDraftPr'
    && (!result.pull_request_id || !result.external_reference)) {
    fail('result_invalid', 'Successful GitHub result requires a pull request id and external reference.');
  }
  if (result.type === 'tracker.comment' && (!result.comment_id || !result.external_reference)) {
    fail('result_invalid', 'Successful tracker result requires a comment id and external reference.');
  }
  return status;
};

export function verifyCapabilityExecutionAttestation({
  registration, registryTrust, attestation, expected, nowMs = Date.now(),
  recordedAt = new Date(nowMs).toISOString(),
  usedReplayIds = [], usedSourceEventIds = [], usedExecutionBindingDigests = [],
  reconciliation = null,
}) {
  const errors = validateCapabilityExecutionAttestation(attestation);
  if (errors.length) fail('contract_invalid', `Invalid capability execution attestation: ${errors.join('; ')}`);
  if (!isObject(expected)) fail('binding_missing', 'Attestation verification requires expected bindings.');
  if (!Number.isFinite(nowMs)) fail('time_invalid', 'Attestation verification time must be finite.');
  for (const field of ['repo_id', 'task_id', 'capability_type', ...bindingFields]) {
    if (!Object.hasOwn(expected, field)) fail('binding_missing', `Expected attestation binding ${field} is required.`);
  }
  const recordedAtMs = canonicalTime(recordedAt, 'Attestation recorded_at');
  if (recordedAtMs > nowMs + MAX_CLOCK_SKEW_MS) fail('not_yet_valid', 'Attestation recorded_at is in the future.');
  const completedAtMs = canonicalTime(attestation.completed_at, 'Attestation completed_at');
  const startedAtMs = canonicalTime(attestation.started_at, 'Attestation started_at');
  const issuedAtMs = canonicalTime(attestation.issued_at, 'Attestation issued_at');
  requireLifetime('Capability execution attestation', attestation.issued_at,
    attestation.expires_at, recordedAtMs, MAX_ATTESTATION_LIFETIME_MS);
  if (completedAtMs < startedAtMs || issuedAtMs < completedAtMs
    || issuedAtMs > recordedAtMs + MAX_CLOCK_SKEW_MS) {
    fail('time_invalid', 'Attestation execution chronology is invalid.');
  }

  const registrationExpectation = {
    repo_id: expected.repo_id,
    task_id: expected.task_id,
    capability_type: expected.capability_type,
  };
  let authorizedRegistration;
  let signingRegistration;
  if (attestation.status === 'reconciled') {
    if (!Object.hasOwn(expected, 'reconciles_attestation_digest')) {
      fail('binding_missing', 'Reconciliation requires the expected indeterminate attestation digest.');
    }
    const authentication = requireExactObject(
      reconciliation,
      ['registration', 'registry_trust', 'prior_attestation', 'prior_recorded_at'],
      'reconciliation_invalid',
      'Reconciliation authentication',
    );
    if (authentication.prior_attestation.status !== 'indeterminate'
      || capabilityExecutionAttestationDigest(authentication.prior_attestation)
        !== expected.reconciles_attestation_digest) {
      fail('reconciliation_invalid', 'Reconciliation does not authenticate the exact indeterminate attestation.');
    }
    const priorExpected = structuredClone(expected);
    delete priorExpected.reconciles_attestation_digest;
    const priorVerified = verifyCapabilityExecutionAttestation({
      registration,
      registryTrust,
      attestation: authentication.prior_attestation,
      expected: priorExpected,
      nowMs,
      recordedAt: authentication.prior_recorded_at,
    });
    if (priorVerified.resolved_status !== 'indeterminate') {
      fail('reconciliation_invalid', 'Reconciliation authority is not an indeterminate execution.');
    }
    authorizedRegistration = verifyHostAdapterRegistration({
      registration,
      registryTrust,
      expected: registrationExpectation,
      atMs: canonicalTime(authentication.prior_attestation.completed_at,
        'Prior attestation completed_at'),
    });
    signingRegistration = verifyHostAdapterRegistration({
      registration: authentication.registration,
      registryTrust: authentication.registry_trust,
      expected: registrationExpectation,
      atMs: recordedAtMs,
    });
    if (signingRegistration.registry.trust_digest
      !== authorizedRegistration.registry.trust_digest) {
      fail('trust_mismatch', 'Reconciliation cannot substitute the original registry trust.');
    }
    if (signingRegistration.adapter_id !== authorizedRegistration.adapter_id
      || signingRegistration.adapter_version !== authorizedRegistration.adapter_version
      || signingRegistration.host_instance_id !== authorizedRegistration.host_instance_id
      || canonicalJson(signingRegistration.scope) !== canonicalJson(authorizedRegistration.scope)) {
      fail('binding_mismatch', 'Reconciliation cannot substitute the authorized adapter identity or session scope.');
    }
    if (signingRegistration.policy_digests[expected.capability_type]
      !== authorizedRegistration.policy_digests[expected.capability_type]) {
      fail('policy_invalid', 'Reconciliation registration cannot change the authorized capability policy.');
    }
  } else {
    if (reconciliation !== null) {
      fail('reconciliation_invalid', 'Only reconciled attestations may provide reconciliation authentication.');
    }
    authorizedRegistration = verifyHostAdapterRegistration({
      registration,
      registryTrust,
      expected: registrationExpectation,
      atMs: completedAtMs,
    });
    signingRegistration = authorizedRegistration;
  }
  if (startedAtMs < signingRegistration.issuedAtMs
    || completedAtMs >= signingRegistration.expiresAtMs
    || issuedAtMs >= signingRegistration.expiresAtMs) {
    fail('time_invalid', 'Attestation execution chronology is outside the signing registration lifetime.');
  }
  requireUnused(attestation.replay_id, usedReplayIds, 'Attestation replay_id');
  requireUnused(attestation.source_event_id, usedSourceEventIds, 'Attestation source_event_id');
  if (attestation.registration_digest !== signingRegistration.registration_digest
    || attestation.adapter_id !== signingRegistration.adapter_id
    || attestation.adapter_version !== signingRegistration.adapter_version
    || attestation.attestation_key_id !== signingRegistration.attestation_key_id) {
    fail('binding_mismatch', 'Attestation does not match the verified adapter registration.');
  }
  for (const field of bindingFields) {
    if (attestation[field] !== expected[field]) fail('binding_mismatch', `Attestation ${field} does not match the reservation.`);
  }
  if (attestation.capability_type !== expected.capability_type) {
    fail('binding_mismatch', 'Attestation capability does not match the request.');
  }
  const executionBindingDigest = capabilityExecutionBindingDigest(attestation);
  if (attestation.status !== 'reconciled' && usedExecutionBindingDigests.includes(executionBindingDigest)) {
    fail('replay_detected', 'Capability reservation nonce has already produced an initial attestation.');
  }
  const capability = authorizedRegistration.capabilities.get(attestation.capability_type);
  if (attestation.policy_digest !== adapterCapabilityPolicyDigest(capability)
    || attestation.policy_digest
      !== signingRegistration.policy_digests[attestation.capability_type]) {
    fail('policy_invalid', 'Attestation policy digest does not match the authorized registration.');
  }
  if (attestation.status === 'reconciled'
    && attestation.reconciles_attestation_digest !== expected.reconciles_attestation_digest) {
    fail('reconciliation_invalid', 'Reconciliation does not bind the expected indeterminate attestation.');
  }
  requireResultBindings(attestation, capability, expected);
  const resolvedStatus = requireResultStatus(attestation);
  requireSignature('Capability execution attestation',
    capabilityExecutionAttestationSigningPayload(attestation), attestation.signature,
    signingRegistration.attestationPublicKey);
  return {
    attestation_digest: capabilityExecutionAttestationDigest(attestation),
    execution_binding_digest: executionBindingDigest,
    attestation_id: attestation.attestation_id,
    attestation_source_event_id: attestation.source_event_id,
    attestation_replay_id: attestation.replay_id,
    registration_digest: signingRegistration.registration_digest,
    authorization_registration_digest: authorizedRegistration.registration_digest,
    registry_trust_digest: signingRegistration.registry.trust_digest,
    adapter_id: signingRegistration.adapter_id, adapter_version: signingRegistration.adapter_version,
    host_instance_id: signingRegistration.host_instance_id,
    scope: structuredClone(signingRegistration.scope),
    capability_type: attestation.capability_type,
    policy_digest: attestation.policy_digest,
    status: attestation.status, resolution: attestation.resolution, resolved_status: resolvedStatus,
    result_digest: digest(Buffer.from(canonicalJson(attestation.result), 'utf8')),
    external_reference: attestation.result.external_reference,
    worktree_fingerprint_after: attestation.worktree_fingerprint_after,
    workspace_evidence_digest_after: attestation.workspace_evidence_digest_after,
    verified_at: recordedAt,
    historical: recordedAtMs < nowMs - MAX_CLOCK_SKEW_MS,
  };
}

export function hostAdapterReadiness({ registration, registryTrust, expected, atMs = Date.now() }) {
  const unavailable = Object.fromEntries(SUPPORTED_ADAPTER_CAPABILITIES.map((type) =>
    [type, { status: 'not_registered' }]));
  if (!registration) return { schema_version: 1, status: 'not_registered', capabilities: unavailable, problems: [] };
  if (!registryTrust) {
    return { schema_version: 1, status: 'blocked', capabilities: unavailable,
      problems: [{ code: 'trust_unavailable', message: 'Host adapter registry trust is unavailable.' }],
    };
  }
  try {
    const verified = verifyHostAdapterRegistration({ registration, registryTrust, expected, atMs });
    const capabilities = Object.fromEntries(SUPPORTED_ADAPTER_CAPABILITIES.map((type) => [
      type,
      verified.capability_types.includes(type)
        ? { status: 'ready', policy_digest: verified.policy_digests[type] }
        : { status: 'not_registered' },
    ]));
    return {
      schema_version: 1,
      status: 'ready',
      registration: {
        registration_id: verified.registration_id, registration_digest: verified.registration_digest,
        adapter_id: verified.adapter_id, adapter_version: verified.adapter_version,
        registry_trust_id: verified.registry.trust_id,
        registry_trust_digest: verified.registry.trust_digest,
        registry_key_id: verified.registry.key_id, source: verified.registry.source,
        issued_at: verified.issued_at, expires_at: verified.expires_at,
      },
      capabilities, problems: [],
    };
  } catch (error) {
    return { schema_version: 1, status: 'blocked', capabilities: unavailable,
      problems: [{
        code: error instanceof HostAdapterContractError ? error.code : 'verification_failed',
        message: error.message || String(error),
      }],
    };
  }
}
