// Author: Subash Karki

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  digestValue,
  validateCapabilityOutcomePayload,
} from '../skills/phantom/scripts/lib/workflow-contracts.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;

const NONCE = Buffer.alloc(32, 7).toString('base64url');

const signedPayload = (value) => ({ ...value, outcome_digest: digestValue(value) });

const native = (overrides = {}) => signedPayload({
  schema_version: 2,
  outcome_kind: 'native-tool-execution',
  request_id: 'request-1',
  idempotency_key: 'effect:1',
  capability_type: 'workspace.write',
  request_digest: DIGEST,
  decision_digest: DIGEST,
  reservation_digest: DIGEST,
  execution_nonce: NONCE,
  budget_charge: { cost_units: 1, duration_ms: 1_000 },
  status: 'succeeded',
  external_reference: null,
  error: null,
  recorded_at: '2026-07-31T12:00:00.000Z',
  ...overrides,
});

const host = (overrides = {}) => signedPayload({
  ...native({
    outcome_kind: 'signed-host-adapter-execution',
    capability_type: 'github.openDraftPr',
    external_reference: 'https://example.invalid/pull/1',
  }),
  outcome_digest: undefined,
  registry_trust_digest: DIGEST,
  registration_digest: DIGEST,
  policy_digest: DIGEST,
  reservation_digest: DIGEST,
  attestation_digest: DIGEST,
  result_digest: DIGEST,
  recorded_at: '2026-07-31T12:00:00.000Z',
  reconciliation_of: null,
  ...overrides,
});

test('capability outcomes are strict v2-only discriminated contracts', () => {
  assert.deepEqual(validateCapabilityOutcomePayload(native()), []);
  assert.match(
    validateCapabilityOutcomePayload(native({ schema_version: 1 })).join('\n'),
    /schema_version: must equal 2/,
  );
  assert.match(
    validateCapabilityOutcomePayload(native({ status: 'deduplicated' })).join('\n'),
    /status: must be succeeded, failed/,
  );
  assert.match(
    validateCapabilityOutcomePayload(native({ registration_digest: DIGEST })).join('\n'),
    /registration_digest: unsupported property/,
  );
  assert.match(
    validateCapabilityOutcomePayload(native({
      budget_charge: { cost_units: 0, duration_ms: 1_000 },
    })).join('\n'),
    /budget_charge.cost_units: required positive finite number/,
  );
  assert.match(
    validateCapabilityOutcomePayload(native({
      budget_charge: { cost_units: 1, duration_ms: 1_000, actual: 0 },
    })).join('\n'),
    /must contain exactly cost_units and duration_ms/,
  );
});

test('capability outcome v2 requires complete verified attestation evidence', () => {
  assert.deepEqual(validateCapabilityOutcomePayload(host()), []);
  const missing = host();
  delete missing.policy_digest;
  assert.match(validateCapabilityOutcomePayload(missing).join('\n'), /policy_digest: required/);
  assert.match(
    validateCapabilityOutcomePayload(host({ registration_digest: 'sha256:bad' })).join('\n'),
    /registration_digest: required sha256 digest/,
  );
  assert.match(
    validateCapabilityOutcomePayload(host({ execution_nonce: 'not-canonical' })).join('\n'),
    /execution_nonce: must be canonical 32-byte base64url/,
  );
  const forgedDigest = host();
  forgedDigest.outcome_digest = DIGEST;
  assert.match(
    validateCapabilityOutcomePayload(forgedDigest).join('\n'),
    /outcome_digest: does not match the exact payload/,
  );
  assert.match(
    validateCapabilityOutcomePayload(host({ recorded_at: '2026-07-31T12:00:00Z' })).join('\n'),
    /recorded_at: required canonical millisecond-Z timestamp/,
  );
});

test('indeterminate and reconciliation payload semantics fail closed', () => {
  assert.deepEqual(validateCapabilityOutcomePayload(host({
    status: 'indeterminate',
    external_reference: null,
    error: 'provider response was ambiguous',
  })), []);
  assert.match(validateCapabilityOutcomePayload(host({
    status: 'indeterminate',
    error: null,
  })).join('\n'), /indeterminate outcome requires an error/);
  assert.match(validateCapabilityOutcomePayload(host({
    status: 'indeterminate',
    external_reference: null,
    error: 'ambiguous',
    reconciliation_of: DIGEST,
  })).join('\n'), /cannot reconcile another attestation/);
  assert.deepEqual(validateCapabilityOutcomePayload(host({ reconciliation_of: DIGEST })), []);
  assert.match(
    validateCapabilityOutcomePayload(host({ status: 'deduplicated' })).join('\n'),
    /must be succeeded, failed, indeterminate/,
  );
});
