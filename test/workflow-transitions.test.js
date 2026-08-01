// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const FINGERPRINT = `sha256:${'b'.repeat(64)}`;
const INSPECTION_DIGEST = `sha256:${'1'.repeat(64)}`;
const CHANGE_DIGEST = `sha256:${'2'.repeat(64)}`;
const EXTERNAL_DIGEST = `sha256:${'3'.repeat(64)}`;

const taskNode = (id, dependsOn, outputSchema, artifact, role = 'blade') => ({
  id,
  kind: 'task',
  depends_on: dependsOn,
  retry_limit: 1,
  budget: { max_cost_units: 5, max_duration_ms: 5_000 },
  role,
  output_schema: 'workflow-output-v1',
  expected_artifacts: [artifact],
  acceptance_criteria: [`${id} output is complete`],
});

const inputPlan = () => ({
  schema_version: 1,
  workflow_id: 'wf-transitions-1',
  route: 'plan',
  risk: 'moderate',
  baseline_fingerprint: FINGERPRINT,
  session_binding: {
    repo_id: 'fixture',
    task_id: 'transition-test',
    route: 'plan',
    approved_plan: { artifact_type: 'plan', record_sequence: 1, digest: FINGERPRINT },
  },
  routing: {
    recommended_route: 'plan', confidence: 0.8, fallback_route: 'full', signals: {},
  },
  execution_mode: 'attended',
  acceptance_criteria: ['all workflow nodes complete'],
  budget: { max_cost_units: 50, max_duration_ms: 50_000, max_attempts: 10 },
  nodes: [
    taskNode('inspect', [], 'inspection-v1', 'inspection.json', 'apex'),
    taskNode('implement', ['inspect'], 'change-v1', 'change.json'),
  ],
});

test('reducer enforces dependencies and derives completion', async () => {
  const { compileWorkflow, createInitialState, legalTransitions, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const compiled = compileWorkflow(inputPlan());
  let state = createInitialState(compiled);
  let previous = null;
  let counter = 0;
  const apply = (eventInput) => {
    counter += 1;
    previous = buildWorkflowEvent(previous, {
      workflow_id: compiled.plan.workflow_id,
      event_id: `evt-transition-${counter}`,
      recorded_at: `2026-07-31T12:00:0${counter}.000Z`,
      producer: { role: 'apex', runtime: 'test' },
      worktree_fingerprint: FINGERPRINT,
      ...eventInput,
    });
    state = reduceWorkflowEvent(compiled, state, previous);
  };

  assert.deepEqual(legalTransitions(compiled, state), [{ event_type: 'workflow.started', node_id: null }]);
  apply({ event_type: 'workflow.started', node_id: null });
  assert.equal(state.nodes.inspect.status, 'ready');
  assert.equal(state.nodes.implement.status, 'pending');

  const illegal = buildWorkflowEvent(previous, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-illegal',
    recorded_at: '2026-07-31T12:00:09.000Z',
    event_type: 'node.completed',
    node_id: 'implement',
    producer: { role: 'blade' },
    artifact_refs: ['change.json'],
    worktree_fingerprint: FINGERPRINT,
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, illegal), /from status pending/);

  apply({ event_type: 'node.started', node_id: 'inspect', payload: { input_refs: [] } });
  apply({
    event_type: 'node.completed', node_id: 'inspect', artifact_refs: ['inspection.json'],
    worktree_fingerprint: FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'inspection.json', digest: INSPECTION_DIGEST }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  assert.equal(state.nodes.implement.status, 'ready');
  const missingInput = buildWorkflowEvent(previous, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-missing-input',
    recorded_at: '2026-07-31T12:00:03.500Z',
    event_type: 'node.started',
    node_id: 'implement',
    producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, missingInput), /input_refs do not match/);
  apply({
    event_type: 'node.started',
    node_id: 'implement',
    payload: {
      input_refs: [{ source_node: 'inspect', artifact_ref: 'inspection.json', digest: INSPECTION_DIGEST }],
    },
  });
  apply({
    event_type: 'node.completed', node_id: 'implement', artifact_refs: ['change.json'],
    worktree_fingerprint: FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'change.json', digest: CHANGE_DIGEST }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  assert.equal(state.status, 'accepted');
  assert.equal(state.nodes.implement.status, 'completed');
  assert.equal(state.sequence, 5);
});

test('reducer rejects tampered payloads and broken sequence chains', async () => {
  const { compileWorkflow, createInitialState, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const compiled = compileWorkflow(inputPlan());
  const state = createInitialState(compiled);
  const event = buildWorkflowEvent(null, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-start',
    recorded_at: '2026-07-31T12:00:00.000Z',
    event_type: 'workflow.started',
    worktree_fingerprint: FINGERPRINT,
    producer: { role: 'apex' },
  });
  const tampered = structuredClone(event);
  tampered.payload.changed = true;
  assert.throws(() => reduceWorkflowEvent(compiled, state, tampered), /payload digest is invalid/);
  const wrongSequence = structuredClone(event);
  wrongSequence.sequence = 2;
  assert.throws(() => reduceWorkflowEvent(compiled, state, wrongSequence), /sequence must be 1/);

  const invalidDate = buildWorkflowEvent(null, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-invalid-date',
    recorded_at: '2026-02-30T12:00:00.000Z',
    event_type: 'workflow.started',
    worktree_fingerprint: FINGERPRINT,
    producer: { role: 'apex' },
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, invalidDate), /semantic ISO-8601/);

  const worktreeBeforeStart = buildWorkflowEvent(null, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-early-worktree',
    recorded_at: '2026-07-31T12:00:00.000Z',
    event_type: 'worktree.changed',
    worktree_fingerprint: FINGERPRINT,
    producer: { role: 'apex' },
    payload: {},
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, worktreeBeforeStart), /cannot precede workflow.started/);

  const started = reduceWorkflowEvent(compiled, state, event);
  const regressed = buildWorkflowEvent(event, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-regressed-time',
    recorded_at: '2026-07-31T11:59:59.000Z',
    event_type: 'node.started',
    node_id: 'inspect',
    producer: { role: 'apex' },
    payload: { input_refs: [] },
  });
  assert.throws(() => reduceWorkflowEvent(compiled, started, regressed), /recorded_at regresses/);
});

test('external actions complete only after a successful matching capability outcome', async () => {
  const { compileWorkflow, createInitialState, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { digestValue } = await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const externalPlan = inputPlan();
  externalPlan.nodes.push({
    id: 'ship',
    kind: 'external-action',
    depends_on: ['implement'],
    retry_limit: 0,
    budget: { max_cost_units: 5, max_duration_ms: 5_000 },
    action: 'draft-pr',
    idempotency_key: 'draft-pr-1',
    output_schema: 'workflow-output-v1',
    expected_artifacts: ['draft-pr.json'],
  });
  const compiled = compileWorkflow(externalPlan);
  let state = createInitialState(compiled);
  let previous = null;
  let sequence = 0;
  const apply = (input) => {
    sequence += 1;
    const event = buildWorkflowEvent(previous, {
      workflow_id: compiled.plan.workflow_id,
      event_id: `evt-external-${sequence}`,
      recorded_at: `2026-07-31T12:08:${String(sequence).padStart(2, '0')}.000Z`,
      producer: { role: 'apex' },
      worktree_fingerprint: FINGERPRINT,
      ...input,
    });
    state = reduceWorkflowEvent(compiled, state, event);
    previous = event;
  };
  apply({ event_type: 'workflow.started' });
  apply({ event_type: 'node.started', node_id: 'inspect', payload: { input_refs: [] } });
  apply({
    event_type: 'node.completed', node_id: 'inspect', artifact_refs: ['inspection.json'],
    worktree_fingerprint: FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'inspection.json', digest: INSPECTION_DIGEST }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  apply({
    event_type: 'node.started', node_id: 'implement',
    payload: {
      input_refs: [{ source_node: 'inspect', artifact_ref: 'inspection.json', digest: INSPECTION_DIGEST }],
    },
  });
  apply({
    event_type: 'node.completed', node_id: 'implement', artifact_refs: ['change.json'],
    worktree_fingerprint: FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'change.json', digest: CHANGE_DIGEST }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  apply({
    event_type: 'node.started', node_id: 'ship',
    payload: {
      input_refs: [{ source_node: 'implement', artifact_ref: 'change.json', digest: CHANGE_DIGEST }],
    },
  });
  const completionInput = {
    event_type: 'node.completed', node_id: 'ship', artifact_refs: ['draft-pr.json'],
    worktree_fingerprint: FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'draft-pr.json', digest: EXTERNAL_DIGEST }],
      cost_units: 1,
      duration_ms: 100,
    },
  };
  const premature = buildWorkflowEvent(previous, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-external-premature',
    recorded_at: '2026-07-31T12:08:30.000Z',
    producer: { role: 'apex' },
    ...completionInput,
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, premature), /successful linked matching capability outcome/);

  const requestDigest = `sha256:${'5'.repeat(64)}`;
  const decisionUnsigned = {
    schema_version: 1, request_id: 'request-ship', idempotency_key: 'draft-pr-1',
    capability_type: 'github.openDraftPr', request_digest: requestDigest,
    decision: 'authorized', reason: 'Authorized by bound policy',
  };
  const decision = { ...decisionUnsigned, decision_digest: digestValue(decisionUnsigned) };
  const forgedDecision = buildWorkflowEvent(previous, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-external-forged-decision',
    recorded_at: '2026-07-31T12:08:31.000Z',
    event_type: 'capability.decision',
    node_id: 'ship',
    producer: { role: 'capability-broker' },
    worktree_fingerprint: FINGERPRINT,
    payload: { ...decision, decision_digest: requestDigest },
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, forgedDecision), /decision digest is invalid/);
  apply({
    event_type: 'capability.decision', node_id: 'ship',
    producer: { role: 'capability-broker' },
    worktree_fingerprint: FINGERPRINT,
    payload: decision,
  });
  const outcomeUnsigned = {
    schema_version: 1, request_id: 'request-ship', idempotency_key: 'draft-pr-1',
    capability_type: 'github.openDraftPr', request_digest: requestDigest,
    decision_digest: decision.decision_digest, status: 'succeeded',
    external_reference: 'https://example.invalid/pr/1', error: null,
  };
  const outcome = { ...outcomeUnsigned, outcome_digest: digestValue(outcomeUnsigned) };
  const mismatchedUnsigned = { ...outcomeUnsigned, request_id: 'request-other' };
  const mismatchedOutcome = buildWorkflowEvent(previous, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-external-mismatched-outcome',
    recorded_at: '2026-07-31T12:08:31.000Z',
    event_type: 'capability.outcome',
    node_id: 'ship',
    producer: { role: 'capability-broker' },
    worktree_fingerprint: FINGERPRINT,
    payload: { ...mismatchedUnsigned, outcome_digest: digestValue(mismatchedUnsigned) },
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, mismatchedOutcome), /request_id does not match/);
  apply({
    event_type: 'capability.outcome', node_id: 'ship',
    producer: { role: 'capability-broker' },
    worktree_fingerprint: FINGERPRINT,
    payload: outcome,
  });
  apply(completionInput);
  assert.equal(state.status, 'accepted');
});

test('aggregate nodes require deterministic fan-in references from every declared source', async () => {
  const { compileWorkflow, createInitialState, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const plan = inputPlan();
  plan.workflow_id = 'wf-aggregate-1';
  plan.nodes = [
    taskNode('left', [], 'left-v1', 'left.json'),
    taskNode('right', [], 'right-v1', 'right.json'),
    {
      id: 'join', kind: 'aggregate', depends_on: ['left', 'right'], sources: ['left', 'right'],
      retry_limit: 0, budget: { max_cost_units: 5, max_duration_ms: 5_000 },
      output_schema: 'workflow-output-v1', expected_artifacts: ['joined.json'],
    },
  ];
  const compiled = compileWorkflow(plan);
  let state = createInitialState(compiled);
  let previous = null;
  let sequence = 0;
  const apply = (input) => {
    sequence += 1;
    previous = buildWorkflowEvent(previous, {
      workflow_id: compiled.plan.workflow_id,
      event_id: `evt-aggregate-${sequence}`,
      recorded_at: `2026-07-31T13:00:${String(sequence).padStart(2, '0')}.000Z`,
      producer: { role: 'apex' },
      worktree_fingerprint: FINGERPRINT,
      ...input,
    });
    state = reduceWorkflowEvent(compiled, state, previous);
  };
  apply({ event_type: 'workflow.started' });
  for (const [id, digest] of [['left', INSPECTION_DIGEST], ['right', CHANGE_DIGEST]]) {
    apply({ event_type: 'node.started', node_id: id, payload: { input_refs: [] } });
    apply({
      event_type: 'node.completed', node_id: id,
      artifact_refs: [`${id}.json`], worktree_fingerprint: FINGERPRINT,
      payload: {
        output_schema: 'workflow-output-v1',
        artifact_digests: [{ artifact_ref: `${id}.json`, digest }],
        cost_units: 1,
        duration_ms: 100,
      },
    });
  }
  assert.equal(state.nodes.join.status, 'ready');
  const inputRefs = [
    { source_node: 'left', artifact_ref: 'left.json', digest: INSPECTION_DIGEST },
    { source_node: 'right', artifact_ref: 'right.json', digest: CHANGE_DIGEST },
  ];
  apply({ event_type: 'node.started', node_id: 'join', payload: { input_refs: inputRefs } });
  apply({
    event_type: 'node.completed', node_id: 'join', artifact_refs: ['joined.json'],
    worktree_fingerprint: FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'joined.json', digest: EXTERNAL_DIGEST }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  assert.equal(state.status, 'accepted');
  assert.deepEqual(state.nodes.join.input_refs, inputRefs);
});
