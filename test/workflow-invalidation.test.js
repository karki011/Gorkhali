// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const OLD_FINGERPRINT = `sha256:${'c'.repeat(64)}`;
const NEW_FINGERPRINT = `sha256:${'d'.repeat(64)}`;
const PLAN_DIGEST = `sha256:${'1'.repeat(64)}`;
const BUILD_DIGEST = `sha256:${'2'.repeat(64)}`;
const REVIEW_DIGEST = `sha256:${'3'.repeat(64)}`;

const node = (id, dependsOn, role, outputSchema, artifact) => ({
  id,
  kind: 'task',
  depends_on: dependsOn,
  retry_limit: 1,
  budget: { max_cost_units: 5, max_duration_ms: 5_000 },
  role,
  output_schema: 'workflow-output-v1',
  expected_artifacts: [artifact],
  acceptance_criteria: [`${id} is complete`],
});

const eventProducer = (compiled, input) => {
  const workflowNode = compiled.plan.nodes.find((candidate) => candidate.id === input.node_id);
  if (workflowNode?.kind === 'task'
    && ['node.started', 'node.completed', 'node.failed'].includes(input.event_type)) {
    return { role: workflowNode.role };
  }
  return { role: 'apex' };
};

const workflow = () => ({
  schema_version: 2,
  workflow_id: 'wf-invalidation-1',
  route: 'plan',
  risk: 'moderate',
  baseline_fingerprint: OLD_FINGERPRINT,
  session_binding: {
    repo_id: 'fixture',
    task_id: 'invalidation-test',
    route: 'plan',
    approved_plan: { artifact_type: 'plan', record_sequence: 1, digest: OLD_FINGERPRINT },
  },
  routing: {
    recommended_route: 'plan', confidence: 0.8, fallback_route: 'full', signals: {},
  },
  execution_mode: 'attended',
  acceptance_criteria: ['stale downstream evidence is cleared'],
  budget: { max_cost_units: 50, max_duration_ms: 50_000, max_attempts: 10 },
  nodes: [
    node('plan', [], 'apex', 'plan-v1', 'plan.json'),
    node('build', ['plan'], 'blade', 'build-v1', 'build.json'),
    node('review', ['build'], 'gaze', 'review-v1', 'review.json'),
  ],
});

test('upstream invalidation clears evidence and stales every dependent', async () => {
  const { compileWorkflow, createInitialState, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const compiled = compileWorkflow(workflow());
  let state = createInitialState(compiled);
  let previous = null;
  let sequence = 0;
  const apply = (input) => {
    sequence += 1;
    previous = buildWorkflowEvent(previous, {
      workflow_id: compiled.plan.workflow_id,
      event_id: `evt-invalidate-${sequence}`,
      recorded_at: `2026-07-31T12:00:${String(sequence).padStart(2, '0')}.000Z`,
      producer: eventProducer(compiled, input),
      worktree_fingerprint: OLD_FINGERPRINT,
      ...input,
    });
    state = reduceWorkflowEvent(compiled, state, previous);
  };
  apply({ event_type: 'workflow.started' });
  const digests = { plan: PLAN_DIGEST, build: BUILD_DIGEST, review: REVIEW_DIGEST };
  const inputs = {
    plan: [],
    build: [{ source_node: 'plan', artifact_ref: 'plan.json', digest: PLAN_DIGEST }],
    review: [{ source_node: 'build', artifact_ref: 'build.json', digest: BUILD_DIGEST }],
  };
  for (const id of ['plan', 'build', 'review']) {
    apply({ event_type: 'node.started', node_id: id, payload: { input_refs: inputs[id] } });
    apply({
      event_type: 'node.completed', node_id: id, artifact_refs: [`${id}.json`],
      worktree_fingerprint: OLD_FINGERPRINT,
      payload: {
        output_schema: 'workflow-output-v1',
        artifact_digests: [{ artifact_ref: `${id}.json`, digest: digests[id] }],
        cost_units: 1,
        duration_ms: 100,
      },
    });
  }
  assert.equal(state.status, 'accepted');

  apply({ event_type: 'node.invalidated', node_id: 'plan', payload: { reason: 'plan replaced' } });
  assert.equal(state.status, 'running');
  assert.equal(state.nodes.plan.status, 'ready');
  assert.equal(state.nodes.build.status, 'stale');
  assert.equal(state.nodes.review.status, 'stale');
  assert.deepEqual(state.nodes.build.artifact_refs, []);
  assert.equal(state.nodes.review.worktree_fingerprint, null);

  apply({ event_type: 'node.started', node_id: 'plan', payload: { input_refs: [] } });
  apply({
    event_type: 'node.completed', node_id: 'plan', artifact_refs: ['plan.json'],
    worktree_fingerprint: OLD_FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'plan.json', digest: NEW_FINGERPRINT }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  assert.equal(state.nodes.build.status, 'ready');
  assert.equal(state.nodes.review.status, 'stale');
});

test('worktree change invalidates completed evidence bound to an older fingerprint', async () => {
  const { compileWorkflow, createInitialState, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const single = workflow();
  single.nodes = [single.nodes[0]];
  const compiled = compileWorkflow(single);
  let state = createInitialState(compiled);
  let previous = null;
  const apply = (input, id) => {
    previous = buildWorkflowEvent(previous, {
      workflow_id: compiled.plan.workflow_id,
      event_id: id,
      recorded_at: '2026-07-31T12:00:00.000Z',
      producer: { role: 'apex' },
      worktree_fingerprint: OLD_FINGERPRINT,
      ...input,
    });
    state = reduceWorkflowEvent(compiled, state, previous);
  };
  apply({ event_type: 'workflow.started' }, 'evt-worktree-1');
  apply({ event_type: 'node.started', node_id: 'plan', payload: { input_refs: [] } }, 'evt-worktree-2');
  apply({
    event_type: 'node.completed', node_id: 'plan', artifact_refs: ['plan.json'],
    worktree_fingerprint: OLD_FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'plan.json', digest: PLAN_DIGEST }],
      cost_units: 1,
      duration_ms: 100,
    },
  }, 'evt-worktree-3');
  assert.equal(state.status, 'accepted');
  apply({
    event_type: 'worktree.changed', worktree_fingerprint: NEW_FINGERPRINT,
    payload: {},
  }, 'evt-worktree-4');
  assert.equal(state.status, 'running');
  assert.equal(state.nodes.plan.status, 'ready');
  assert.deepEqual(state.nodes.plan.artifact_refs, []);
});

test('only an authorized mutation advances the main worktree without invalidating its inputs', async () => {
  const { compileWorkflow, createInitialState, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { digestValue } = await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const input = workflow();
  input.nodes = input.nodes.slice(0, 2);
  const compiled = compileWorkflow(input);
  let state = createInitialState(compiled);
  let previous = null;
  let sequence = 0;
  const build = (event) => buildWorkflowEvent(previous, {
    workflow_id: compiled.plan.workflow_id,
    event_id: `evt-authorized-mutation-${sequence + 1}`,
    recorded_at: `2026-07-31T13:00:${String(sequence + 1).padStart(2, '0')}.000Z`,
    producer: eventProducer(compiled, event),
    worktree_fingerprint: state.current_worktree_fingerprint ?? OLD_FINGERPRINT,
    ...event,
  });
  const apply = (event) => {
    const next = build(event);
    state = reduceWorkflowEvent(compiled, state, next);
    previous = next;
    sequence += 1;
  };
  apply({ event_type: 'workflow.started' });
  apply({ event_type: 'node.started', node_id: 'plan', payload: { input_refs: [] } });
  apply({
    event_type: 'node.completed', node_id: 'plan', artifact_refs: ['plan.json'],
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'plan.json', digest: PLAN_DIGEST }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  const planInput = [{ source_node: 'plan', artifact_ref: 'plan.json', digest: PLAN_DIGEST }];
  apply({ event_type: 'node.started', node_id: 'build', payload: { input_refs: planInput } });
  assert.throws(() => reduceWorkflowEvent(compiled, state, build({
    event_type: 'node.completed', node_id: 'build', artifact_refs: ['build.json'],
    worktree_fingerprint: NEW_FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'build.json', digest: BUILD_DIGEST }],
      cost_units: 1,
      duration_ms: 100,
    },
  })), /record the authorized mutation first/);

  const decisionUnsigned = {
    schema_version: 1,
    request_id: 'request-authorized-write',
    idempotency_key: 'write:build',
    capability_type: 'workspace.write',
    request_digest: `sha256:${'4'.repeat(64)}`,
    decision: 'authorized',
    reason: 'Bound implementation write',
    reserved_budget: { cost_units: 0.5, duration_ms: 100 },
  };
  const decision = { ...decisionUnsigned, decision_digest: digestValue(decisionUnsigned) };
  apply({
    event_type: 'capability.decision', node_id: 'build',
    producer: { role: 'capability-broker' }, payload: decision,
  });
  const outcomeUnsigned = {
    schema_version: 2,
    outcome_kind: 'native-tool-execution',
    request_id: decision.request_id,
    idempotency_key: decision.idempotency_key,
    capability_type: decision.capability_type,
    request_digest: decision.request_digest,
    decision_digest: decision.decision_digest,
    reservation_digest: `sha256:${'5'.repeat(64)}`,
    execution_nonce: Buffer.alloc(32, 5).toString('base64url'),
    budget_charge: { cost_units: 0.5, duration_ms: 100 },
    status: 'succeeded',
    external_reference: null,
    error: null,
    recorded_at: '2026-07-31T13:00:06.000Z',
  };
  apply({
    event_type: 'capability.outcome', node_id: 'build',
    recorded_at: outcomeUnsigned.recorded_at,
    worktree_fingerprint: NEW_FINGERPRINT,
    producer: { role: 'capability-broker' },
    payload: { ...outcomeUnsigned, outcome_digest: digestValue(outcomeUnsigned) },
  });
  apply({
    event_type: 'node.completed', node_id: 'build', artifact_refs: ['build.json'],
    worktree_fingerprint: NEW_FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'build.json', digest: BUILD_DIGEST }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  assert.equal(state.current_worktree_fingerprint, NEW_FINGERPRINT);
  assert.equal(state.nodes.plan.status, 'completed');
  assert.equal(state.nodes.plan.worktree_fingerprint, OLD_FINGERPRINT);
  assert.equal(state.nodes.build.status, 'completed');
  assert.equal(state.status, 'accepted');
});

test('invalidated external actions reuse their exact successful effect without executing it again', async () => {
  const { compileWorkflow, createInitialState, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { digestValue } = await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const input = workflow();
  input.workflow_id = 'wf-external-invalidation';
  input.nodes = [
    node('gate', [], 'apex', 'workflow-output-v1', 'gate.json'),
    {
      id: 'ship',
      kind: 'external-action',
      depends_on: ['gate'],
      retry_limit: 2,
      budget: { max_cost_units: 5, max_duration_ms: 5_000 },
      action: 'draft-pr',
      idempotency_key: 'draft-pr:invalidation',
      output_schema: 'workflow-output-v1',
      expected_artifacts: ['draft-pr.json'],
    },
  ];
  const compiled = compileWorkflow(input);
  let state = createInitialState(compiled);
  let previous = null;
  let sequence = 0;
  const build = (inputEvent) => buildWorkflowEvent(previous, {
      workflow_id: compiled.plan.workflow_id,
      event_id: `evt-external-invalidation-${sequence + 1}`,
      recorded_at: `2026-07-31T14:00:${String(sequence + 1).padStart(2, '0')}.000Z`,
      producer: { role: 'apex' },
      worktree_fingerprint: OLD_FINGERPRINT,
      ...inputEvent,
    });
  const apply = (inputEvent) => {
    const event = build(inputEvent);
    state = reduceWorkflowEvent(compiled, state, event);
    previous = event;
    sequence += 1;
  };
  apply({ event_type: 'workflow.started' });
  apply({ event_type: 'node.started', node_id: 'gate', payload: { input_refs: [] } });
  apply({
    event_type: 'node.completed', node_id: 'gate', artifact_refs: ['gate.json'],
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'gate.json', digest: PLAN_DIGEST }],
      cost_units: 0.5,
      duration_ms: 50,
    },
  });
  const gateInput = [{ source_node: 'gate', artifact_ref: 'gate.json', digest: PLAN_DIGEST }];
  apply({ event_type: 'node.started', node_id: 'ship', payload: { input_refs: gateInput } });
  const decisionUnsigned = {
    schema_version: 1,
    request_id: 'request-external-invalidation',
    idempotency_key: 'draft-pr:invalidation',
    capability_type: 'github.openDraftPr',
    request_digest: `sha256:${'4'.repeat(64)}`,
    decision: 'authorized',
    reason: 'Bound draft pull request authorization',
    reserved_budget: { cost_units: 0.5, duration_ms: 100 },
  };
  const decision = { ...decisionUnsigned, decision_digest: digestValue(decisionUnsigned) };
  apply({
    event_type: 'capability.decision', node_id: 'ship',
    producer: { role: 'capability-broker' }, payload: decision,
  });
  const outcomeUnsigned = {
    schema_version: 2,
    outcome_kind: 'signed-host-adapter-execution',
    request_id: decision.request_id,
    idempotency_key: decision.idempotency_key,
    capability_type: decision.capability_type,
    request_digest: decision.request_digest,
    decision_digest: decision.decision_digest,
    reservation_digest: `sha256:${'5'.repeat(64)}`,
    execution_nonce: Buffer.alloc(32, 5).toString('base64url'),
    budget_charge: decision.reserved_budget,
    status: 'succeeded',
    external_reference: 'https://example.invalid/pr/42',
    error: null,
    recorded_at: '2026-07-31T14:00:06.000Z',
    registry_trust_digest: `sha256:${'6'.repeat(64)}`,
    registration_digest: `sha256:${'7'.repeat(64)}`,
    policy_digest: `sha256:${'8'.repeat(64)}`,
    attestation_digest: `sha256:${'9'.repeat(64)}`,
    result_digest: `sha256:${'a'.repeat(64)}`,
    reconciliation_of: null,
  };
  const outcome = { ...outcomeUnsigned, outcome_digest: digestValue(outcomeUnsigned) };
  apply({
    event_type: 'capability.outcome', node_id: 'ship',
    recorded_at: outcome.recorded_at,
    producer: { role: 'capability-broker' }, payload: outcome,
  });
  const completion = {
    event_type: 'node.completed', node_id: 'ship', artifact_refs: ['draft-pr.json'],
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'draft-pr.json', digest: REVIEW_DIGEST }],
      cost_units: 0.5,
      duration_ms: 100,
    },
  };
  apply(completion);
  assert.equal(state.status, 'accepted');
  const historyBeforeInvalidation = {
    decisions: state.capability_decision_history.length,
    outcomes: state.capability_outcome_history.length,
  };

  apply({ event_type: 'node.invalidated', node_id: 'ship', payload: { reason: 'artifact rematerialized' } });
  assert.equal(state.nodes.ship.status, 'ready');
  apply({ event_type: 'node.started', node_id: 'ship', payload: { input_refs: gateInput } });
  apply(completion);

  assert.equal(state.status, 'accepted');
  assert.deepEqual({
    decisions: state.capability_decision_history.length,
    outcomes: state.capability_outcome_history.length,
  }, historyBeforeInvalidation);
  assert.equal(state.nodes.ship.successful_capability_outcome_digest, outcome.outcome_digest);

  apply({
    event_type: 'node.invalidated', node_id: 'gate',
    payload: { reason: 'dependency evidence changed' },
  });
  apply({ event_type: 'node.started', node_id: 'gate', payload: { input_refs: [] } });
  apply({
    event_type: 'node.completed', node_id: 'gate', artifact_refs: ['gate.json'],
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'gate.json', digest: BUILD_DIGEST }],
      cost_units: 0.5,
      duration_ms: 50,
    },
  });
  const changedGateInput = [{
    source_node: 'gate', artifact_ref: 'gate.json', digest: BUILD_DIGEST,
  }];
  apply({ event_type: 'node.started', node_id: 'ship', payload: { input_refs: changedGateInput } });
  assert.throws(() => reduceWorkflowEvent(compiled, state, build(completion)));
});
