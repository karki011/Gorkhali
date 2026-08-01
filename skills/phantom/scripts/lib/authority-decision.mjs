// Author: Subash Karki
// Verification boundary for short-lived host-issued lifecycle decisions.

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dataRoot } from './portable.mjs';
import { canonicalJson, validateSchema } from './workflow-contracts.mjs';

const AUTHORITY_SCHEMA = JSON.parse(readFileSync(
  new URL('../../schemas/authority-decision.schema.json', import.meta.url),
  'utf8',
));
const CAPABILITY_PROBE_SCHEMA = JSON.parse(readFileSync(
  new URL('../../schemas/capability-probe.schema.json', import.meta.url),
  'utf8',
));
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_SIGNED_EVIDENCE_LIFETIME_MS = 15 * 60_000;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const compareText = (left, right) => (left < right ? -1 : (left > right ? 1 : 0));
const digestBytes = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export const authorityTrustFile = (workspace) =>
  join(dataRoot(workspace), 'config', 'authority-trust.json');

const publicKeyDigest = (key) => digestBytes(key.export({ type: 'spki', format: 'der' }));

export function readAuthorityTrust(workspace) {
  const file = authorityTrustFile(workspace);
  if (!existsSync(file)) return null;
  const trust = JSON.parse(readFileSync(file, 'utf8'));
  const expected = new Set(['schema_version', 'key_id', 'source', 'public_key']);
  if (!isObject(trust)
    || trust.schema_version !== 1
    || typeof trust.key_id !== 'string'
    || !trust.key_id.trim()
    || typeof trust.source !== 'string'
    || !trust.source.trim()
    || typeof trust.public_key !== 'string'
    || !trust.public_key.trim()
    || Object.keys(trust).some((field) => !expected.has(field))) {
    throw new Error(`Invalid authority trust configuration: ${file}`);
  }
  let publicKey;
  try {
    publicKey = createPublicKey(trust.public_key);
  } catch {
    throw new Error(`Invalid Ed25519 public key in authority trust configuration: ${file}`);
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`Authority trust key must be Ed25519: ${file}`);
  }
  return {
    file,
    trust,
    publicKey,
    pin: {
      schema_version: 1,
      key_id: trust.key_id,
      source: trust.source,
      public_key_digest: publicKeyDigest(publicKey),
    },
  };
}

export function pinAuthorityTrust(workspace) {
  return readAuthorityTrust(workspace)?.pin ?? null;
}

export function authorityDecisionSigningPayload(decision) {
  if (!isObject(decision)) throw new Error('Authority decision must be an object.');
  const { signature: ignored, ...unsigned } = decision;
  void ignored;
  return Buffer.from(canonicalJson(unsigned), 'utf8');
}

export function authorityDecisionDigest(decision) {
  return digestBytes(Buffer.from(canonicalJson(decision), 'utf8'));
}

export function capabilityProbeSigningPayload(probe) {
  if (!isObject(probe)) throw new Error('Capability probe must be an object.');
  const { signature: ignored, ...unsigned } = probe;
  void ignored;
  return Buffer.from(canonicalJson(unsigned), 'utf8');
}

export function capabilityProbeDigest(probe) {
  return digestBytes(Buffer.from(canonicalJson(probe), 'utf8'));
}

function requirePinnedTrust(workspace, pinnedTrust, subject) {
  if (!pinnedTrust) throw new Error(`${subject} denied: this session has no pinned host trust.`);
  const loaded = readAuthorityTrust(workspace);
  if (!loaded) throw new Error(`${subject} denied: host trust configuration is unavailable.`);
  if (canonicalJson(loaded.pin) !== canonicalJson(pinnedTrust)) {
    throw new Error(`${subject} denied: host trust does not match the session-pinned key and source.`);
  }
  return loaded;
}

function requireBoundLifetime(subject, issuedAtValue, expiresAtValue, nowMs) {
  const issuedAt = Date.parse(issuedAtValue);
  const expiresAt = Date.parse(expiresAtValue);
  if (!Number.isFinite(nowMs)
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || new Date(issuedAt).toISOString() !== issuedAtValue
    || new Date(expiresAt).toISOString() !== expiresAtValue) {
    throw new Error(`${subject} denied: issued_at and expires_at must be canonical ISO timestamps.`);
  }
  if (issuedAt > nowMs + MAX_CLOCK_SKEW_MS) {
    throw new Error(`${subject} denied: issued_at is too far in the future.`);
  }
  if (expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_SIGNED_EVIDENCE_LIFETIME_MS
    || expiresAt <= nowMs) {
    throw new Error(`${subject} denied: evidence is expired or has an invalid lifetime.`);
  }
}

function requireEd25519Signature(subject, payload, signatureValue, publicKey) {
  const signature = Buffer.from(signatureValue, 'base64');
  if (signature.length !== 64
    || signature.toString('base64') !== signatureValue
    || !verifySignature(null, payload, publicKey, signature)) {
    throw new Error(`${subject} denied: Ed25519 signature is invalid.`);
  }
}

const canonicalBindings = (bindings) => [...bindings]
  .map((binding) => structuredClone(binding))
  .sort((left, right) => compareText(canonicalJson(left), canonicalJson(right)));

export function verifyAuthorityDecision({
  workspace,
  decision,
  pinnedTrust,
  repoId,
  taskId,
  decisionKind,
  gate = null,
  scope = null,
  worktreeFingerprint,
  approvalArtifactBindings = [],
  usedReplayIds = [],
  usedSourceEventIds = [],
  nowMs = Date.now(),
}) {
  const errors = validateSchema(AUTHORITY_SCHEMA, decision);
  if (errors.length) throw new Error(`Invalid authority decision: ${errors.join('; ')}`);
  const loaded = requirePinnedTrust(workspace, pinnedTrust, 'Authority decision');
  if (decision.key_id !== pinnedTrust.key_id || decision.source !== pinnedTrust.source) {
    throw new Error('Authority decision denied: key or source does not match the session-pinned trust.');
  }
  if (decision.repo_id !== repoId || decision.task_id !== taskId) {
    throw new Error('Authority decision denied: repository or task binding does not match the active session.');
  }
  if (decision.decision_kind !== decisionKind
    || decision.gate !== gate
    || decision.scope !== scope
    || decision.decision !== (decisionKind === 'approval' ? 'approved' : 'authorized')) {
    throw new Error('Authority decision denied: gate, scope, or decision binding does not match the request.');
  }
  if (decision.worktree_fingerprint !== worktreeFingerprint) {
    throw new Error('Authority decision denied: worktree fingerprint is stale.');
  }
  if (canonicalJson(canonicalBindings(decision.approval_artifact_bindings))
    !== canonicalJson(canonicalBindings(approvalArtifactBindings))) {
    throw new Error('Authority decision denied: approval artifact bindings are stale or incomplete.');
  }

  requireBoundLifetime('Authority decision', decision.issued_at, decision.expires_at, nowMs);
  if (usedReplayIds.includes(decision.replay_id)
    || usedSourceEventIds.includes(decision.source_event_id)) {
    throw new Error('Authority decision denied: replay or source event was already consumed.');
  }

  requireEd25519Signature(
    'Authority decision',
    authorityDecisionSigningPayload(decision),
    decision.signature,
    loaded.publicKey,
  );

  return {
    decision_digest: authorityDecisionDigest(decision),
    actor: decision.actor,
    source: decision.source,
    source_event_id: decision.source_event_id,
    replay_id: decision.replay_id,
    key_id: decision.key_id,
    issued_at: decision.issued_at,
    expires_at: decision.expires_at,
    worktree_fingerprint: decision.worktree_fingerprint,
    approval_artifact_bindings: canonicalBindings(decision.approval_artifact_bindings),
  };
}

export function verifyCapabilityProbe({
  workspace,
  probe,
  pinnedTrust,
  repoId,
  taskId,
  worktreeFingerprint,
  nowMs = Date.now(),
}) {
  const errors = validateSchema(CAPABILITY_PROBE_SCHEMA, probe);
  if (errors.length) throw new Error(`Invalid capability probe: ${errors.join('; ')}`);
  const loaded = requirePinnedTrust(workspace, pinnedTrust, 'Capability probe');
  if (probe.key_id !== pinnedTrust.key_id || probe.source !== pinnedTrust.source) {
    throw new Error('Capability probe denied: key or source does not match the session-pinned trust.');
  }
  if (probe.repo_id !== repoId || probe.task_id !== taskId) {
    throw new Error('Capability probe denied: repository or task binding does not match the active session.');
  }
  if (probe.worktree_fingerprint !== worktreeFingerprint) {
    throw new Error('Capability probe denied: worktree fingerprint is stale.');
  }
  requireBoundLifetime('Capability probe', probe.issued_at, probe.expires_at, nowMs);
  requireEd25519Signature(
    'Capability probe',
    capabilityProbeSigningPayload(probe),
    probe.signature,
    loaded.publicKey,
  );
  return { probe_digest: capabilityProbeDigest(probe) };
}

export {
  AUTHORITY_SCHEMA as authorityDecisionSchema,
  CAPABILITY_PROBE_SCHEMA as capabilityProbeSchema,
};
