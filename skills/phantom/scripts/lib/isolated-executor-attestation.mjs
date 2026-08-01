// Author: Subash Karki
// Verification boundary for externally enforced isolated branch execution.

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dataRoot } from './portable.mjs';
import { readStableJsonFile } from './filesystem-snapshot.mjs';
import {
  canonicalJson,
  digestValue,
  isPortableWorkflowPath,
  validateSchema,
} from './workflow-contracts.mjs';

const PROBE_SCHEMA = JSON.parse(readFileSync(
  new URL('../../schemas/isolated-executor-probe.schema.json', import.meta.url),
  'utf8',
));
const RECEIPT_SCHEMA = JSON.parse(readFileSync(
  new URL('../../schemas/isolated-execution-receipt.schema.json', import.meta.url),
  'utf8',
));
const TRUST_SCHEMA = JSON.parse(readFileSync(
  new URL('../../schemas/isolated-executor-trust.schema.json', import.meta.url),
  'utf8',
));

const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_EVIDENCE_LIFETIME_MS = 15 * 60_000;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const BUCKET = /^[a-f0-9]{2}$/;
const MANIFEST_ALGORITHM = 'phantom-workspace-merkle-v2';
const DELTA_ALGORITHM = 'phantom-workspace-delta-v2';
const MANIFEST_POLICY = Object.freeze({
  policy_id: 'portable-all-files-v2',
  tracked: 'include',
  untracked: 'include',
  ignored: 'include',
  control_exclusions: Object.freeze(['.git', '.phantom']),
  special_files: 'reject',
});
const EXECUTOR_BINDING_FIELDS = [
  'baseline_content_manifest_digest',
  'baseline_fingerprint',
  'baseline_physical_topology_root',
  'contract_version',
  'executor_id',
  'isolation_profile',
  'key_id',
  'probe_digest',
  'profile_digest',
  'public_key',
  'public_key_digest',
  'source',
  'trust_activated_at',
  'trust_digest',
  'trust_expires_at',
  'trust_generation',
  'trust_replaces_key_id',
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const compareText = (left, right) => (left < right ? -1 : (left > right ? 1 : 0));
const digestBytes = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const publicKeyDigest = (key) => digestBytes(key.export({ type: 'spki', format: 'der' }));
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const domainDigest = (domain, value) => `sha256:${createHash('sha256')
  .update(`${domain}\0`)
  .update(canonicalJson(value))
  .digest('hex')}`;
const MANIFEST_POLICY_DIGEST = domainDigest('phantom-workspace-policy-v2', MANIFEST_POLICY);
const bucketForPath = (filePath) => createHash('sha256').update(filePath, 'utf8').digest('hex').slice(0, 2);

function hasExactKeys(value, expected) {
  return isObject(value) && same(Object.keys(value).sort(), [...expected].sort());
}

function assertSortedUnique(values, label, key = (value) => value) {
  let previous = null;
  for (const value of values) {
    const current = key(value);
    if (previous !== null && current <= previous) throw new Error(`${label} must be unique and sorted.`);
    previous = current;
  }
}

export const executorTrustFile = (workspace) =>
  join(dataRoot(workspace), 'config', 'executor-trust.json');

export const executorProbeFile = (sessionDir) => join(sessionDir, 'isolated-executor-probe.json');

function parseEd25519PublicKey(value, label) {
  let publicKey;
  try {
    publicKey = createPublicKey(value);
  } catch {
    throw new Error(`${label} must contain a valid Ed25519 public key.`);
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${label} must contain an Ed25519 public key.`);
  }
  return publicKey;
}

const observedTime = (value) => value instanceof Date ? value.getTime() : Date.parse(value ?? new Date().toISOString());

function assertTrustWindow(subject, activatedValue, expiresValue, atTime) {
  const activatedAt = Date.parse(activatedValue);
  const expiresAt = Date.parse(expiresValue);
  const observedAt = observedTime(atTime);
  if (!Number.isFinite(activatedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(observedAt)
    || expiresAt <= activatedAt) {
    throw new Error(`${subject} denied: executor trust lifetime is invalid.`);
  }
  if (observedAt + MAX_CLOCK_SKEW_MS < activatedAt || observedAt - MAX_CLOCK_SKEW_MS > expiresAt) {
    throw new Error(`${subject} denied: executor trust is not active for this event.`);
  }
}

function assertTrustContract(trust, atTime = null) {
  const errors = validateSchema(TRUST_SCHEMA, trust);
  if (errors.length) throw new Error(`Invalid executor trust configuration: ${errors.join('; ')}`);
  if ((trust.generation === 1 && trust.replaces_key_id !== null)
    || (trust.generation > 1 && (typeof trust.replaces_key_id !== 'string'
      || trust.replaces_key_id.length === 0
      || trust.replaces_key_id === trust.key_id))) {
    throw new Error('Invalid executor trust configuration: replacement lineage is inconsistent.');
  }
  assertTrustWindow('Isolated executor', trust.activated_at, trust.expires_at,
    atTime ?? trust.activated_at);
}

export function readExecutorTrust(workspace, { atTime = new Date() } = {}) {
  const file = executorTrustFile(workspace);
  if (!existsSync(file)) return null;
  let trust;
  try {
    trust = readStableJsonFile(file).value;
  } catch (error) {
    throw new Error(`Invalid executor trust configuration: ${file}: ${error.message}`);
  }
  try {
    assertTrustContract(trust, atTime);
  } catch (error) {
    throw new Error(`Invalid executor trust configuration: ${file}: ${error.message}`);
  }
  const publicKey = parseEd25519PublicKey(trust.public_key, 'Executor trust configuration');
  return {
    file,
    trust,
    trust_digest: digestValue(trust),
    publicKey,
    public_key_digest: publicKeyDigest(publicKey),
  };
}

function signingPayload(value) {
  if (!isObject(value)) throw new Error('Signed executor evidence must be an object.');
  const { signature: ignored, ...unsigned } = value;
  void ignored;
  return Buffer.from(canonicalJson(unsigned), 'utf8');
}

export const executorProbeSigningPayload = signingPayload;
export const executionReceiptSigningPayload = signingPayload;
export const executorProbeDigest = digestValue;
export const executionReceiptDigest = digestValue;
export const isolationProfileDigest = digestValue;
export const executorTrustDigest = digestValue;

function assertSignedWindow(subject, issuedValue, expiresValue, atTime) {
  const issuedAt = Date.parse(issuedValue);
  const expiresAt = Date.parse(expiresValue);
  const observedAt = observedTime(atTime);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(observedAt)) {
    throw new Error(`${subject} denied: signed evidence lifetime is invalid.`);
  }
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_EVIDENCE_LIFETIME_MS) {
    throw new Error(`${subject} denied: signed evidence lifetime exceeds the allowed window.`);
  }
  if (observedAt + MAX_CLOCK_SKEW_MS < issuedAt || observedAt - MAX_CLOCK_SKEW_MS > expiresAt) {
    throw new Error(`${subject} denied: signed evidence is not current for this event.`);
  }
}

function assertSignature(subject, value, publicKey) {
  let signature;
  try {
    signature = Buffer.from(value.signature, 'base64');
  } catch {
    throw new Error(`${subject} denied: Ed25519 signature is invalid.`);
  }
  if (signature.length !== 64 || signature.toString('base64') !== value.signature
    || !verifySignature(null, signingPayload(value), publicKey, signature)) {
    throw new Error(`${subject} denied: Ed25519 signature is invalid.`);
  }
}

const trustRecordFromBinding = (binding) => ({
  schema_version: 1,
  trust_kind: 'isolated-executor-trust',
  generation: binding.trust_generation,
  key_id: binding.key_id,
  source: binding.source,
  public_key: binding.public_key,
  activated_at: binding.trust_activated_at,
  expires_at: binding.trust_expires_at,
  replaces_key_id: binding.trust_replaces_key_id,
});

export function validateExecutorBinding(binding, { atTime = null } = {}) {
  if (!isObject(binding)
    || !same(Object.keys(binding).sort(), [...EXECUTOR_BINDING_FIELDS].sort())) {
    throw new Error('Executor binding is missing required pinned trust fields.');
  }
  if (binding.contract_version !== 'isolated-branch-executor-v1'
    || !DIGEST.test(binding.baseline_content_manifest_digest || '')
    || !DIGEST.test(binding.baseline_fingerprint || '')
    || !DIGEST.test(binding.baseline_physical_topology_root || '')
    || typeof binding.executor_id !== 'string'
    || binding.executor_id.length === 0
    || typeof binding.key_id !== 'string'
    || binding.key_id.length === 0
    || typeof binding.source !== 'string'
    || binding.source.length === 0
    || !DIGEST.test(binding.probe_digest || '')
    || !DIGEST.test(binding.profile_digest || '')
    || isolationProfileDigest(binding.isolation_profile) !== binding.profile_digest) {
    throw new Error('Executor binding is invalid or has a mismatched isolation profile.');
  }
  const publicKey = parseEd25519PublicKey(binding.public_key, 'Executor binding');
  if (publicKeyDigest(publicKey) !== binding.public_key_digest) {
    throw new Error('Executor binding public key digest is invalid.');
  }
  const trust = trustRecordFromBinding(binding);
  assertTrustContract(trust, atTime);
  if (digestValue(trust) !== binding.trust_digest) {
    throw new Error('Executor binding trust root digest is invalid.');
  }
  return publicKey;
}

function assertEvidenceWithinTrust(subject, issuedValue, expiresValue, activatedValue, trustExpiresValue) {
  const issuedAt = Date.parse(issuedValue);
  const expiresAt = Date.parse(expiresValue);
  const activatedAt = Date.parse(activatedValue);
  const trustExpiresAt = Date.parse(trustExpiresValue);
  if (issuedAt < activatedAt || expiresAt > trustExpiresAt) {
    throw new Error(`${subject} denied: signed evidence falls outside the pinned trust lifetime.`);
  }
}

export function verifyExecutorProbe({
  workspace,
  probe,
  repoId,
  taskId,
  worktreeFingerprint,
  atTime = new Date(),
}) {
  const errors = validateSchema(PROBE_SCHEMA, probe);
  if (errors.length) throw new Error(`Invalid isolated executor probe: ${errors.join('; ')}`);
  const trusted = readExecutorTrust(workspace, { atTime });
  if (!trusted) {
    throw new Error(`Isolated executor denied: separate executor trust is unavailable at ${executorTrustFile(workspace)}.`);
  }
  if (probe.key_id !== trusted.trust.key_id || probe.source !== trusted.trust.source) {
    throw new Error('Isolated executor denied: probe does not match the pinned executor trust root.');
  }
  if (probe.repo_id !== repoId || probe.task_id !== taskId) {
    throw new Error('Isolated executor denied: probe repository or task binding is stale.');
  }
  if (probe.worktree_fingerprint !== worktreeFingerprint) {
    throw new Error('Isolated executor denied: probe worktree fingerprint is stale.');
  }
  const selfTestAt = Date.parse(probe.self_test.observed_at);
  const issuedAt = Date.parse(probe.issued_at);
  if (!Number.isFinite(selfTestAt) || !Number.isFinite(issuedAt) || selfTestAt > issuedAt
    || issuedAt - selfTestAt > MAX_EVIDENCE_LIFETIME_MS) {
    throw new Error('Isolated executor denied: backend self-test evidence is stale or invalid.');
  }
  assertSignedWindow('Isolated executor probe', probe.issued_at, probe.expires_at, atTime);
  assertEvidenceWithinTrust(
    'Isolated executor probe',
    probe.issued_at,
    probe.expires_at,
    trusted.trust.activated_at,
    trusted.trust.expires_at,
  );
  assertSignature('Isolated executor probe', probe, trusted.publicKey);
  const profileDigest = isolationProfileDigest(probe.isolation_profile);
  return {
    probe_digest: executorProbeDigest(probe),
    binding: {
      contract_version: probe.contract_version,
      executor_id: probe.executor_id,
      isolation_profile: structuredClone(probe.isolation_profile),
      key_id: probe.key_id,
      probe_digest: executorProbeDigest(probe),
      profile_digest: profileDigest,
      public_key: trusted.trust.public_key,
      public_key_digest: trusted.public_key_digest,
      source: probe.source,
      trust_activated_at: trusted.trust.activated_at,
      trust_digest: trusted.trust_digest,
      trust_expires_at: trusted.trust.expires_at,
      trust_generation: trusted.trust.generation,
      trust_replaces_key_id: trusted.trust.replaces_key_id,
    },
  };
}

const manifestReference = (evidence) => ({
  algorithm: evidence.algorithm,
  fingerprint: evidence.fingerprint,
  policy_digest: evidence.policy_digest,
  snapshot_digest: evidence.snapshot_digest,
  manifest_digest: evidence.manifest_digest,
  evidence_digest: evidence.evidence_digest,
  physical_root: evidence.physical_root,
  physical_topology_root: evidence.physical_topology_root,
});

function validateShardReferences(references, label, { physical = false } = {}) {
  if (!Array.isArray(references) || references.length > 256) {
    throw new Error(`${label} must contain at most 256 shard references.`);
  }
  assertSortedUnique(references, label, (reference) => reference?.bucket);
  for (const reference of references) {
    const fields = physical
      ? ['bucket', 'digest', 'entry_count', 'topology_digest']
      : ['bucket', 'digest', 'entry_count'];
    if (!hasExactKeys(reference, fields)
      || !BUCKET.test(reference.bucket || '') || !DIGEST.test(reference.digest || '')
      || !Number.isInteger(reference.entry_count) || reference.entry_count < 1
      || (physical && !DIGEST.test(reference.topology_digest || ''))) {
      throw new Error(`${label} contains an invalid shard reference.`);
    }
  }
}

function physicalTopologyRootFromReferences(references) {
  return domainDigest(
    'phantom-workspace-physical-topology-root-v2',
    references.map(({ bucket, entry_count: entryCount, topology_digest: topologyDigest }) => ({
      bucket,
      entry_count: entryCount,
      topology_digest: topologyDigest,
    })),
  );
}

function validateCompactManifest(evidence, label) {
  const fields = [
    'schema_version', 'algorithm', 'policy_digest', 'content_root', 'entry_count',
    'regular_file_count', 'symbolic_link_count', 'content_shards', 'policy',
    'fingerprint', 'manifest_digest', 'snapshot_digest', 'physical_root', 'physical_topology_root',
    'physical_shards', 'evidence_digest',
  ];
  if (!hasExactKeys(evidence, fields) || evidence.schema_version !== 2
    || evidence.algorithm !== MANIFEST_ALGORITHM
    || !same(evidence.policy, MANIFEST_POLICY)
    || evidence.policy_digest !== MANIFEST_POLICY_DIGEST
    || !DIGEST.test(evidence.snapshot_digest || '')
    || !DIGEST.test(evidence.physical_topology_root || '')
    || !Number.isInteger(evidence.entry_count) || evidence.entry_count < 0
    || !Number.isInteger(evidence.regular_file_count) || evidence.regular_file_count < 0
    || !Number.isInteger(evidence.symbolic_link_count) || evidence.symbolic_link_count < 0) {
    throw new Error(`${label} is not canonical compact workspace manifest evidence.`);
  }
  validateShardReferences(evidence.content_shards, `${label}.content_shards`);
  validateShardReferences(
    evidence.physical_shards,
    `${label}.physical_shards`,
    { physical: true },
  );
  const entryCount = evidence.content_shards.reduce((total, shard) => total + shard.entry_count, 0);
  const regularCount = evidence.physical_shards.reduce((total, shard) => total + shard.entry_count, 0);
  if (entryCount !== evidence.entry_count || regularCount !== evidence.regular_file_count
    || entryCount - regularCount !== evidence.symbolic_link_count) {
    throw new Error(`${label} shard counts do not match its compact header.`);
  }
  const contentRoot = domainDigest('phantom-workspace-content-root-v2', evidence.content_shards);
  const physicalRoot = domainDigest('phantom-workspace-physical-root-v2', evidence.physical_shards);
  const physicalTopologyRoot = physicalTopologyRootFromReferences(evidence.physical_shards);
  const contentHeader = {
    schema_version: 2,
    algorithm: MANIFEST_ALGORITHM,
    policy_digest: MANIFEST_POLICY_DIGEST,
    snapshot_digest: evidence.snapshot_digest,
    content_root: contentRoot,
    entry_count: entryCount,
    regular_file_count: regularCount,
    symbolic_link_count: entryCount - regularCount,
    content_shards: evidence.content_shards,
  };
  const manifestDigest = domainDigest('phantom-workspace-manifest-v2', contentHeader);
  const fingerprint = domainDigest('phantom-workspace-fingerprint-v2', {
    policy_digest: MANIFEST_POLICY_DIGEST,
    content_root: contentRoot,
  });
  const unsignedEvidence = {
    ...contentHeader,
    policy: MANIFEST_POLICY,
    fingerprint,
    manifest_digest: manifestDigest,
    physical_root: physicalRoot,
    physical_topology_root: physicalTopologyRoot,
    physical_shards: evidence.physical_shards,
  };
  const expected = {
    ...unsignedEvidence,
    evidence_digest: domainDigest('phantom-workspace-evidence-v2', unsignedEvidence),
  };
  if (!same(evidence, expected)) throw new Error(`${label} digest chain is invalid.`);
}

function changedShardReferences(beforeReferences, afterReferences) {
  const before = new Map(beforeReferences.map((reference) => [reference.bucket, reference]));
  const after = new Map(afterReferences.map((reference) => [reference.bucket, reference]));
  return [...new Set([...before.keys(), ...after.keys()])].sort()
    .filter((bucket) => before.get(bucket)?.digest !== after.get(bucket)?.digest)
    .map((bucket) => ({
      bucket,
      before_digest: before.get(bucket)?.digest ?? null,
      after_digest: after.get(bucket)?.digest ?? null,
    }));
}

function validateDeltaReference(reference, evidence, label) {
  if (!hasExactKeys(reference, [
    'algorithm', 'fingerprint', 'policy_digest', 'snapshot_digest', 'manifest_digest', 'evidence_digest',
    'physical_root', 'physical_topology_root',
  ]) || !same(reference, manifestReference(evidence))) {
    throw new Error(`${label} does not match its workspace manifest.`);
  }
}

function validateChangedShardReferences(references, label) {
  if (!Array.isArray(references) || references.length > 256) {
    throw new Error(`${label} must contain at most 256 changed shard references.`);
  }
  assertSortedUnique(references, label, (reference) => reference?.bucket);
  for (const reference of references) {
    if (!hasExactKeys(reference, ['bucket', 'before_digest', 'after_digest'])
      || !BUCKET.test(reference.bucket || '')
      || (reference.before_digest !== null && !DIGEST.test(reference.before_digest || ''))
      || (reference.after_digest !== null && !DIGEST.test(reference.after_digest || ''))
      || reference.before_digest === reference.after_digest) {
      throw new Error(`${label} contains an invalid changed shard reference.`);
    }
  }
}

function validateContentShard(shard, label) {
  if (!hasExactKeys(shard, ['schema_version', 'kind', 'bucket', 'entry_count', 'entries', 'digest'])
    || shard.schema_version !== 2 || shard.kind !== 'content'
    || !BUCKET.test(shard.bucket || '') || !Array.isArray(shard.entries)
    || shard.entries.length === 0 || shard.entry_count !== shard.entries.length) {
    throw new Error(`${label} is malformed.`);
  }
  assertSortedUnique(shard.entries, `${label}.entries`, (entry) => entry?.path);
  for (const entry of shard.entries) {
    if (!hasExactKeys(entry, ['path', 'kind', 'mode', 'digest'])
      || !isPortableWorkflowPath(entry.path) || entry.path === '.'
      || bucketForPath(entry.path) !== shard.bucket
      || !['file', 'symlink'].includes(entry.kind)
      || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o7777
      || !DIGEST.test(entry.digest || '')) {
      throw new Error(`${label} contains an invalid content entry.`);
    }
  }
  const unsigned = {
    schema_version: 2,
    kind: 'content',
    bucket: shard.bucket,
    entry_count: shard.entry_count,
    entries: shard.entries,
  };
  if (shard.digest !== domainDigest('phantom-workspace-content-shard-v2', unsigned)) {
    throw new Error(`${label} digest is invalid.`);
  }
}

function validatePhysicalShard(shard, label) {
  if (!hasExactKeys(shard, [
    'schema_version', 'kind', 'bucket', 'entry_count', 'entries', 'topology_digest', 'digest',
  ])
    || shard.schema_version !== 2 || shard.kind !== 'physical'
    || !BUCKET.test(shard.bucket || '') || !Array.isArray(shard.entries)
    || shard.entries.length === 0 || shard.entry_count !== shard.entries.length
    || !DIGEST.test(shard.topology_digest || '')) {
    throw new Error(`${label} is malformed.`);
  }
  assertSortedUnique(shard.entries, `${label}.entries`, (entry) => entry?.path);
  for (const entry of shard.entries) {
    if (!hasExactKeys(entry, ['path', 'dev', 'ino', 'nlink'])
      || !isPortableWorkflowPath(entry.path) || entry.path === '.'
      || bucketForPath(entry.path) !== shard.bucket
      || !/^[0-9]+$/.test(entry.dev || '') || !/^[0-9]+$/.test(entry.ino || '')
      || !Number.isInteger(entry.nlink) || entry.nlink < 1) {
      throw new Error(`${label} contains an invalid physical entry.`);
    }
  }
  const unsigned = {
    schema_version: 2,
    kind: 'physical',
    bucket: shard.bucket,
    entry_count: shard.entry_count,
    entries: shard.entries,
    topology_digest: shard.topology_digest,
  };
  if (shard.digest !== domainDigest('phantom-workspace-physical-shard-v2', unsigned)) {
    throw new Error(`${label} digest is invalid.`);
  }
}

function entriesByPath(shard) {
  return new Map((shard?.entries || []).map((entry) => [entry.path, entry]));
}

function validateChangedContentProofs(proofs, delta) {
  if (!Array.isArray(proofs) || proofs.length > 256) {
    throw new Error('changed_content_shards must contain at most 256 proofs.');
  }
  assertSortedUnique(proofs, 'changed_content_shards', (proof) => proof?.bucket);
  const expected = new Map(delta.changed_content_shards.map((reference) => [reference.bucket, reference]));
  if (proofs.length !== expected.size) throw new Error('changed_content_shards is incomplete.');
  const changes = [];
  for (const proof of proofs) {
    if (!hasExactKeys(proof, ['bucket', 'before', 'after']) || !BUCKET.test(proof.bucket || '')) {
      throw new Error('changed_content_shards contains a malformed proof.');
    }
    const reference = expected.get(proof.bucket);
    if (!reference) throw new Error(`Unexpected changed content shard proof: ${proof.bucket}`);
    if (proof.before !== null) validateContentShard(proof.before, `changed content shard ${proof.bucket}.before`);
    if (proof.after !== null) validateContentShard(proof.after, `changed content shard ${proof.bucket}.after`);
    if ((proof.before !== null && proof.before.bucket !== proof.bucket)
      || (proof.after !== null && proof.after.bucket !== proof.bucket)
      || (proof.before?.digest ?? null) !== reference.before_digest
      || (proof.after?.digest ?? null) !== reference.after_digest) {
      throw new Error(`Changed content shard proof ${proof.bucket} does not match the manifest delta.`);
    }
    const before = entriesByPath(proof.before);
    const after = entriesByPath(proof.after);
    for (const filePath of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const beforeEntry = before.get(filePath) ?? null;
      const afterEntry = after.get(filePath) ?? null;
      if (!same(beforeEntry, afterEntry)) changes.push({ path: filePath, before: beforeEntry, after: afterEntry });
    }
  }
  return changes.sort((left, right) => compareText(left.path, right.path));
}

function validateChangedPhysicalProofs(proofs, delta) {
  if (!Array.isArray(proofs) || proofs.length > 256) {
    throw new Error('changed_physical_shards must contain at most 256 proofs.');
  }
  assertSortedUnique(proofs, 'changed_physical_shards', (proof) => proof?.bucket);
  const expected = new Map(delta.changed_physical_shards.map((reference) => [reference.bucket, reference]));
  if (proofs.length !== expected.size) throw new Error('changed_physical_shards is incomplete.');
  const changes = [];
  for (const proof of proofs) {
    if (!hasExactKeys(proof, ['bucket', 'before', 'after']) || !BUCKET.test(proof.bucket || '')) {
      throw new Error('changed_physical_shards contains a malformed proof.');
    }
    const reference = expected.get(proof.bucket);
    if (!reference) throw new Error(`Unexpected changed physical shard proof: ${proof.bucket}`);
    if (proof.before !== null) validatePhysicalShard(proof.before, `changed physical shard ${proof.bucket}.before`);
    if (proof.after !== null) validatePhysicalShard(proof.after, `changed physical shard ${proof.bucket}.after`);
    if ((proof.before !== null && proof.before.bucket !== proof.bucket)
      || (proof.after !== null && proof.after.bucket !== proof.bucket)
      || (proof.before?.digest ?? null) !== reference.before_digest
      || (proof.after?.digest ?? null) !== reference.after_digest) {
      throw new Error(`Changed physical shard proof ${proof.bucket} does not match the manifest delta.`);
    }
    const before = entriesByPath(proof.before);
    const after = entriesByPath(proof.after);
    for (const filePath of [...new Set([...before.keys(), ...after.keys()])].sort(compareText)) {
      const beforeEntry = before.get(filePath) ?? null;
      const afterEntry = after.get(filePath) ?? null;
      if (!same(beforeEntry, afterEntry)) {
        changes.push({ path: filePath, before: beforeEntry, after: afterEntry });
      }
    }
  }
  return changes.sort((left, right) => compareText(left.path, right.path));
}

export function validateWorkspaceTransitionEvidence(receipt) {
  const baseline = receipt.baseline_manifest;
  const current = receipt.current_manifest;
  const delta = receipt.workspace_delta;
  validateCompactManifest(baseline, 'baseline_manifest');
  validateCompactManifest(current, 'current_manifest');
  if (!hasExactKeys(delta, [
    'schema_version', 'algorithm', 'from', 'to', 'changed_paths', 'changed_physical_paths',
    'changed_content_shards', 'changed_physical_shards', 'delta_digest',
  ]) || delta.schema_version !== 2 || delta.algorithm !== DELTA_ALGORITHM
    || !Array.isArray(delta.changed_paths) || !Array.isArray(delta.changed_physical_paths)) {
    throw new Error('workspace_delta is malformed.');
  }
  validateDeltaReference(delta.from, baseline, 'workspace_delta.from');
  validateDeltaReference(delta.to, current, 'workspace_delta.to');
  for (const [paths, label] of [
    [delta.changed_paths, 'workspace_delta.changed_paths'],
    [delta.changed_physical_paths, 'workspace_delta.changed_physical_paths'],
  ]) {
    assertSortedUnique(paths, label);
    if (paths.some((filePath) => !isPortableWorkflowPath(filePath) || filePath === '.')) {
      throw new Error(`${label} contains a non-portable path.`);
    }
  }
  validateChangedShardReferences(delta.changed_content_shards, 'workspace_delta.changed_content_shards');
  validateChangedShardReferences(delta.changed_physical_shards, 'workspace_delta.changed_physical_shards');
  const expectedContent = changedShardReferences(baseline.content_shards, current.content_shards);
  const expectedPhysical = changedShardReferences(baseline.physical_shards, current.physical_shards);
  if (!same(delta.changed_content_shards, expectedContent)
    || !same(delta.changed_physical_shards, expectedPhysical)) {
    throw new Error('workspace_delta changed shards do not match the compact manifests.');
  }
  const unsigned = {
    schema_version: 2,
    algorithm: DELTA_ALGORITHM,
    from: delta.from,
    to: delta.to,
    changed_paths: delta.changed_paths,
    changed_physical_paths: delta.changed_physical_paths,
    changed_content_shards: delta.changed_content_shards,
    changed_physical_shards: delta.changed_physical_shards,
  };
  if (delta.delta_digest !== domainDigest('phantom-workspace-delta-evidence-v2', unsigned)) {
    throw new Error('workspace_delta digest is invalid.');
  }
  const changes = validateChangedContentProofs(receipt.changed_content_shards, delta);
  const physicalChanges = validateChangedPhysicalProofs(receipt.changed_physical_shards, delta);
  if (!same(changes.map((change) => change.path), delta.changed_paths)
    || !same(receipt.changed_paths, delta.changed_paths)
    || !same(physicalChanges.map((change) => change.path), delta.changed_physical_paths)
    || !same(receipt.changed_physical_paths, delta.changed_physical_paths)) {
    throw new Error('Signed changed paths do not match the content and physical shard proofs.');
  }
  return { changes, physicalChanges };
}

const teardownComplete = (teardown) => teardown.tool_lease_revoked === true
  && teardown.process_tree_reaped === true
  && teardown.descendants_remaining === 0
  && teardown.mounts_removed === true
  && teardown.sandbox_destroyed === true;

function assertReceiptShape(receipt) {
  const empty = (value) => Array.isArray(value) && value.length === 0;
  if (receipt.receipt_kind === 'branch-started') {
    if (receipt.branch_id === null || receipt.attempt === null || receipt.status !== 'started'
      || receipt.start_receipt_digest !== null
      || receipt.worktree_fingerprint !== receipt.baseline_fingerprint
      || !empty(receipt.changed_paths) || !empty(receipt.changed_physical_paths)
      || !empty(receipt.artifact_refs)
      || !empty(receipt.artifact_digests) || !empty(receipt.verification)
      || !empty(receipt.branch_receipts) || receipt.cost_units !== 0 || receipt.duration_ms !== 0
      || receipt.failure_class !== null || !same(receipt.current_manifest, receipt.baseline_manifest)
      || !empty(receipt.changed_content_shards) || !empty(receipt.changed_physical_shards)
      || Object.values(receipt.teardown).some((value) => value !== false && value !== 0)) {
      throw new Error('Isolated executor receipt denied: branch start evidence is inconsistent.');
    }
    return;
  }
  if (receipt.receipt_kind === 'branch-completed') {
    if (receipt.branch_id === null || receipt.attempt === null
      || !DIGEST.test(receipt.start_receipt_digest || '')
      || !['passed', 'failed'].includes(receipt.status)
      || !empty(receipt.branch_receipts) || !teardownComplete(receipt.teardown)
      || (receipt.status === 'passed' ? receipt.failure_class !== null
        : typeof receipt.failure_class !== 'string' || receipt.failure_class.length === 0)) {
      throw new Error('Isolated executor receipt denied: branch completion or teardown evidence is inconsistent.');
    }
    return;
  }
  if (receipt.branch_id !== null || receipt.attempt !== null || receipt.start_receipt_digest !== null
    || !empty(receipt.input_refs) || !['accepted', 'rejected'].includes(receipt.status)
    || receipt.branch_receipts.length < 2 || !teardownComplete(receipt.teardown)
    || (receipt.status === 'accepted' ? receipt.failure_class !== null
      : typeof receipt.failure_class !== 'string' || receipt.failure_class.length === 0)) {
    throw new Error('Isolated executor receipt denied: integration evidence is inconsistent.');
  }
}

export function verifyExecutionReceipt({
  receipt,
  binding,
  expected = {},
  atTime = new Date(),
}) {
  const errors = validateSchema(RECEIPT_SCHEMA, receipt);
  if (errors.length) throw new Error(`Invalid isolated execution receipt: ${errors.join('; ')}`);
  const publicKey = validateExecutorBinding(binding, { atTime });
  if (receipt.executor_id !== binding.executor_id
    || receipt.contract_version !== binding.contract_version
    || receipt.profile_digest !== binding.profile_digest
    || receipt.source !== binding.source
    || receipt.key_id !== binding.key_id) {
    throw new Error('Isolated executor receipt denied: executor binding does not match the compiled plan.');
  }
  for (const [field, value] of Object.entries(expected)) {
    if (!same(receipt[field], value)) {
      throw new Error(`Isolated executor receipt denied: ${field} does not match authoritative workflow state.`);
    }
  }
  assertSignedWindow('Isolated executor receipt', receipt.issued_at, receipt.expires_at, atTime);
  assertEvidenceWithinTrust(
    'Isolated executor receipt',
    receipt.issued_at,
    receipt.expires_at,
    binding.trust_activated_at,
    binding.trust_expires_at,
  );
  assertSignature('Isolated executor receipt', receipt, publicKey);
  assertReceiptShape(receipt);
  const transition = validateWorkspaceTransitionEvidence(receipt);
  if (receipt.baseline_fingerprint !== binding.baseline_fingerprint
    || receipt.baseline_manifest.snapshot_digest !== receipt.baseline_fingerprint
    || receipt.baseline_manifest.manifest_digest !== binding.baseline_content_manifest_digest
    || receipt.baseline_manifest.physical_topology_root
      !== binding.baseline_physical_topology_root) {
    throw new Error('Isolated executor receipt denied: workspace baseline does not match the compiled host manifest binding.');
  }
  if (receipt.current_manifest.snapshot_digest !== receipt.worktree_fingerprint) {
    throw new Error('Isolated executor receipt denied: current manifest snapshot does not match the claimed worktree fingerprint.');
  }
  return { receipt_digest: executionReceiptDigest(receipt), transition };
}

export const isolatedExecutorAttestationInternals = Object.freeze({
  MAX_CLOCK_SKEW_MS,
  MAX_EVIDENCE_LIFETIME_MS,
  teardownComplete,
});
