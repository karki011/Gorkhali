// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const DIGEST = (character) => `sha256:${character.repeat(64)}`;
const FINGERPRINT = DIGEST('a');
const EXECUTION_NONCE = Buffer.alloc(32, 1).toString('base64url');

test('indeterminate capability attestations allow one bound final reconciliation and never imply success', async () => {
  const { compileWorkflow, createInitialState, legalTransitions, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { digestValue } = await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const compiled = compileWorkflow({
    schema_version: 2, workflow_id: 'wf-capability-reconcile', route: 'direct', risk: 'low',
    baseline_fingerprint: FINGERPRINT,
    session_binding: { repo_id: 'fixture', task_id: 'reconcile', route: 'direct', approved_plan: null },
    routing: { recommended_route: 'direct', confidence: 0.95, fallback_route: 'plan', signals: {} },
    execution_mode: 'attended', acceptance_criteria: ['external effect is confirmed'],
    budget: { max_cost_units: 10, max_duration_ms: 10_000, max_attempts: 4 },
    nodes: [
      {
        id: 'gate', kind: 'task', depends_on: [], retry_limit: 0,
        budget: { max_cost_units: 2, max_duration_ms: 2_000 }, role: 'blade',
        output_schema: 'workflow-output-v1', expected_artifacts: ['gate.json'],
        acceptance_criteria: ['gate complete'],
      },
      {
        id: 'ship', kind: 'external-action', depends_on: ['gate'], retry_limit: 0,
        budget: { max_cost_units: 2, max_duration_ms: 2_000 }, action: 'draft-pr',
        idempotency_key: 'draft-pr-reconcile', output_schema: 'workflow-output-v1',
        expected_artifacts: ['draft-pr.json'],
      },
    ],
  });
  let state = createInitialState(compiled);
  let previous = null;
  let serial = 0;
  const event = (input) => {
    serial += 1;
    return buildWorkflowEvent(previous, {
      workflow_id: compiled.plan.workflow_id,
      event_id: `reconcile-event-${serial}`,
      recorded_at: input.payload?.recorded_at
        ?? `2026-07-31T12:20:${String(serial).padStart(2, '0')}.000Z`,
      producer: { role: 'apex' }, worktree_fingerprint: FINGERPRINT, ...input,
    });
  };
  const apply = (input) => {
    const next = event(input);
    state = reduceWorkflowEvent(compiled, state, next);
    previous = next;
  };
  apply({ event_type: 'workflow.started' });
  apply({
    event_type: 'node.started', node_id: 'gate', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  apply({
    event_type: 'node.completed', node_id: 'gate', artifact_refs: ['gate.json'],
    producer: { role: 'blade' },
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'gate.json', digest: DIGEST('b') }],
      cost_units: 0.5, duration_ms: 10,
    },
  });
  apply({
    event_type: 'node.started', node_id: 'ship',
    payload: { input_refs: [{ source_node: 'gate', artifact_ref: 'gate.json', digest: DIGEST('b') }] },
  });
  const decisionUnsigned = {
    schema_version: 1, request_id: 'request-reconcile', idempotency_key: 'draft-pr-reconcile',
    capability_type: 'github.openDraftPr', request_digest: DIGEST('c'),
    decision: 'authorized', reason: 'policy authorized',
    reserved_budget: { cost_units: 0.5, duration_ms: 100 },
  };
  const decision = { ...decisionUnsigned, decision_digest: digestValue(decisionUnsigned) };
  apply({
    event_type: 'capability.decision', node_id: 'ship', producer: { role: 'capability-broker' },
    payload: decision,
  });
  const attested = (overrides = {}) => {
    const recordedAt = `2026-07-31T12:20:${String(serial + 1).padStart(2, '0')}.000Z`;
    const unsigned = {
      schema_version: 2, outcome_kind: 'signed-host-adapter-execution',
      request_id: decision.request_id, idempotency_key: decision.idempotency_key,
      capability_type: decision.capability_type, request_digest: decision.request_digest,
      decision_digest: decision.decision_digest, execution_nonce: EXECUTION_NONCE,
      budget_charge: { cost_units: 0.5, duration_ms: 100 },
      status: 'indeterminate', external_reference: null,
      error: 'provider response was ambiguous', registry_trust_digest: DIGEST('d'),
      registration_digest: DIGEST('e'), policy_digest: DIGEST('f'), reservation_digest: DIGEST('1'),
      attestation_digest: DIGEST('2'), result_digest: DIGEST('3'),
      recorded_at: recordedAt, reconciliation_of: null, ...overrides,
    };
    return { ...unsigned, outcome_digest: digestValue(unsigned) };
  };
  const uncertain = attested();
  apply({
    event_type: 'capability.outcome', node_id: 'ship', producer: { role: 'capability-broker' },
    payload: uncertain,
  });
  assert.deepEqual(state.nodes.ship.reserved_budget, { cost_units: 0, duration_ms: 0 });
  assert.deepEqual(state.nodes.ship.consumed_budget, { cost_units: 0.5, duration_ms: 100 });
  const chargedBudget = structuredClone(state.nodes.ship.consumed_budget);
  const remainingBudget = structuredClone(state.remaining_budget);
  const uncertainTransitions = legalTransitions(compiled, state);
  assert.ok(uncertainTransitions.some((transition) =>
    transition.event_type === 'capability.outcome' && transition.node_id === 'ship'));
  assert.ok(!uncertainTransitions.some((transition) =>
    ['worktree.changed', 'node.completed', 'node.failed', 'budget.exhausted']
      .includes(transition.event_type)));
  const completion = {
    event_type: 'node.completed', node_id: 'ship', artifact_refs: ['draft-pr.json'],
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'draft-pr.json', digest: DIGEST('4') }],
      cost_units: 0.5, duration_ms: 10,
    },
  };
  assert.throws(() => reduceWorkflowEvent(compiled, state, event(completion)),
    /unresolved capability effect freezes the workflow/);
  const secondUncertain = attested({ attestation_digest: DIGEST('5'), result_digest: DIGEST('6') });
  assert.throws(() => reduceWorkflowEvent(compiled, state, event({
    event_type: 'capability.outcome', node_id: 'ship', producer: { role: 'capability-broker' },
    payload: secondUncertain,
  })), /exactly one succeeded or failed reconciliation/);
  const wrongReconciliation = attested({
    status: 'succeeded', external_reference: 'https://example.invalid/pr/1', error: null,
    attestation_digest: DIGEST('7'), result_digest: DIGEST('8'), reconciliation_of: DIGEST('9'),
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, event({
    event_type: 'capability.outcome', node_id: 'ship', producer: { role: 'capability-broker' },
    payload: wrongReconciliation,
  })), /reconciliation_of must match/);
  const reconciled = attested({
    status: 'succeeded', external_reference: 'https://example.invalid/pr/1', error: null,
    attestation_digest: DIGEST('7'), result_digest: DIGEST('8'),
    reconciliation_of: uncertain.attestation_digest,
  });
  apply({
    event_type: 'capability.outcome', node_id: 'ship', producer: { role: 'capability-broker' },
    payload: reconciled,
  });
  assert.deepEqual(state.nodes.ship.consumed_budget, chargedBudget);
  assert.deepEqual(state.remaining_budget, remainingBudget);
  const reconciledTransitions = legalTransitions(compiled, state);
  assert.ok(!reconciledTransitions.some((transition) =>
    transition.event_type === 'capability.outcome' && transition.node_id === 'ship'));
  assert.ok(reconciledTransitions.some((transition) =>
    transition.event_type === 'node.completed' && transition.node_id === 'ship'));
  const duplicateFinal = attested({
    status: 'failed', error: 'retry failed', attestation_digest: DIGEST('9'),
    result_digest: DIGEST('0'), reconciliation_of: uncertain.attestation_digest,
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, event({
    event_type: 'capability.outcome', node_id: 'ship', producer: { role: 'capability-broker' },
    payload: duplicateFinal,
  })), /already has its final attested outcome/);
  apply(completion);
  assert.equal(state.status, 'accepted');
  assert.equal(state.nodes.ship.successful_capability_outcome_digest, reconciled.outcome_digest);
});
