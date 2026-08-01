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
  schema_version: 2,
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
    worktree_fingerprint: FINGERPRINT,
    payload: { input_refs: [] },
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, missingInput), /input_refs do not match/);
  apply({
    event_type: 'node.started',
    node_id: 'implement',
    producer: { role: 'blade' },
    payload: {
      input_refs: [{ source_node: 'inspect', artifact_ref: 'inspection.json', digest: INSPECTION_DIGEST }],
    },
  });
  apply({
    event_type: 'node.completed', node_id: 'implement', artifact_refs: ['change.json'],
    producer: { role: 'blade' },
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

test('reducer binds workflow controls and task lifecycle events to their declared roles', async () => {
  const { compileWorkflow, createInitialState, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const taskPlan = inputPlan();
  taskPlan.nodes = [taskNode('work', [], 'change-v1', 'work.json', 'blade')];
  const compiled = compileWorkflow(taskPlan);
  let state = createInitialState(compiled);
  let previous = null;
  const build = (input) => buildWorkflowEvent(previous, {
    workflow_id: compiled.plan.workflow_id,
    event_id: `evt-role-${state.sequence + 1}-${input.event_type}`,
    recorded_at: `2026-07-31T12:01:${String(state.sequence + 1).padStart(2, '0')}.000Z`,
    worktree_fingerprint: FINGERPRINT,
    ...input,
  });
  const apply = (input) => {
    const event = build(input);
    state = reduceWorkflowEvent(compiled, state, event);
    previous = event;
  };
  const spoof = (input, expected) => {
    assert.throws(() => reduceWorkflowEvent(compiled, state, build(input)), expected);
  };

  spoof({ event_type: 'workflow.started', producer: { role: 'blade' } }, /producer role apex/);
  apply({ event_type: 'workflow.started', producer: { role: 'apex' } });
  spoof({ event_type: 'worktree.changed', producer: { role: 'blade' } }, /producer role apex/);
  spoof({
    event_type: 'node.started', node_id: 'work', producer: { role: 'apex' },
    payload: { input_refs: [] },
  }, /producer role blade/);
  apply({
    event_type: 'node.started', node_id: 'work', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  const output = {
    output_schema: 'workflow-output-v1',
    artifact_digests: [{ artifact_ref: 'work.json', digest: CHANGE_DIGEST }],
    cost_units: 1,
    duration_ms: 100,
  };
  spoof({
    event_type: 'node.completed', node_id: 'work', producer: { role: 'apex' },
    artifact_refs: ['work.json'], payload: output,
  }, /producer role blade/);
  spoof({
    event_type: 'node.failed', node_id: 'work', producer: { role: 'apex' },
    payload: { failure_class: 'test_failure', cost_units: 1, duration_ms: 100 },
  }, /producer role blade/);
  spoof({
    event_type: 'budget.exhausted', node_id: 'work', producer: { role: 'blade' },
    payload: { failure_class: 'budget_exhausted' },
  }, /producer role apex/);
  apply({
    event_type: 'node.completed', node_id: 'work', producer: { role: 'blade' },
    artifact_refs: ['work.json'], payload: output,
  });
  spoof({
    event_type: 'node.invalidated', node_id: 'work', producer: { role: 'blade' },
    payload: { reason: 'spoofed invalidation' },
  }, /producer role apex/);
});

test('aggregate and external-action lifecycle events remain Apex-controlled', async () => {
  const { compileWorkflow, createInitialState, legalTransitions, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const nonTaskPlan = inputPlan();
  nonTaskPlan.nodes = [
    taskNode('source', [], 'source-v1', 'source.json', 'blade'),
    {
      id: 'aggregate', kind: 'aggregate', depends_on: ['source'], sources: ['source'], retry_limit: 0,
      budget: { max_cost_units: 5, max_duration_ms: 5_000 }, output_schema: 'workflow-output-v1',
      expected_artifacts: ['aggregate.json'],
    },
    {
      id: 'external', kind: 'external-action', depends_on: ['source'], retry_limit: 0,
      budget: { max_cost_units: 5, max_duration_ms: 5_000 }, action: 'draft-pr',
      idempotency_key: 'role-test-pr', output_schema: 'workflow-output-v1',
      expected_artifacts: ['external.json'],
    },
  ];
  const compiled = compileWorkflow(nonTaskPlan);
  let state = createInitialState(compiled);
  let previous = null;
  const build = (input) => buildWorkflowEvent(previous, {
    workflow_id: compiled.plan.workflow_id,
    event_id: `evt-non-task-role-${state.sequence + 1}-${input.node_id ?? 'workflow'}`,
    recorded_at: `2026-07-31T12:02:${String(state.sequence + 1).padStart(2, '0')}.000Z`,
    worktree_fingerprint: FINGERPRINT,
    ...input,
  });
  const apply = (input) => {
    const event = build(input);
    state = reduceWorkflowEvent(compiled, state, event);
    previous = event;
  };
  const spoof = (input) => {
    assert.throws(() => reduceWorkflowEvent(compiled, state, build(input)), /producer role apex/);
  };

  apply({ event_type: 'workflow.started', producer: { role: 'apex' } });
  apply({
    event_type: 'node.started', node_id: 'source', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  apply({
    event_type: 'node.completed', node_id: 'source', producer: { role: 'blade' },
    artifact_refs: ['source.json'],
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'source.json', digest: INSPECTION_DIGEST }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  const inputRefs = [{ source_node: 'source', artifact_ref: 'source.json', digest: INSPECTION_DIGEST }];
  for (const nodeId of ['aggregate', 'external']) {
    spoof({
      event_type: 'node.started', node_id: nodeId, producer: { role: 'blade' },
      payload: { input_refs: inputRefs },
    });
    apply({
      event_type: 'node.started', node_id: nodeId, producer: { role: 'apex' },
      payload: { input_refs: inputRefs },
    });
    spoof({
      event_type: 'node.completed', node_id: nodeId, producer: { role: 'blade' },
      artifact_refs: [`${nodeId}.json`], payload: {},
    });
  }
  const transitions = legalTransitions(compiled, state);
  assert.ok(transitions.some((transition) =>
    transition.event_type === 'node.failed' && transition.node_id === 'aggregate'));
  assert.ok(transitions.some((transition) =>
    transition.event_type === 'node.completed' && transition.node_id === 'aggregate'));
  assert.ok(transitions.some((transition) =>
    transition.event_type === 'node.failed' && transition.node_id === 'external'));
  assert.ok(!transitions.some((transition) =>
    transition.event_type === 'node.completed' && transition.node_id === 'external'));
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
  const { compileWorkflow, createInitialState, legalTransitions, reduceWorkflowEvent } =
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
    producer: { role: 'blade' },
    payload: {
      input_refs: [{ source_node: 'inspect', artifact_ref: 'inspection.json', digest: INSPECTION_DIGEST }],
    },
  });
  apply({
    event_type: 'node.completed', node_id: 'implement', artifact_refs: ['change.json'],
    producer: { role: 'blade' },
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
  const shipTransitions = () => legalTransitions(compiled, state)
    .filter((transition) => transition.node_id === 'ship')
    .map((transition) => transition.event_type);
  assert.deepEqual(shipTransitions(), ['capability.decision', 'node.failed']);
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
    reserved_budget: { cost_units: 0.5, duration_ms: 100 },
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
  assert.deepEqual(shipTransitions(), ['capability.outcome']);
  assert.deepEqual(state.nodes.ship.reserved_budget, { cost_units: 0.5, duration_ms: 100 });
  assert.deepEqual(state.nodes.ship.consumed_budget, { cost_units: 0, duration_ms: 0 });
  const outcomeUnsigned = {
    schema_version: 2, outcome_kind: 'signed-host-adapter-execution',
    request_id: 'request-ship', idempotency_key: 'draft-pr-1',
    capability_type: 'github.openDraftPr', request_digest: requestDigest,
    decision_digest: decision.decision_digest,
    reservation_digest: `sha256:${'6'.repeat(64)}`,
    execution_nonce: Buffer.alloc(32, 6).toString('base64url'),
    budget_charge: { cost_units: 0.5, duration_ms: 100 },
    status: 'succeeded', external_reference: 'https://example.invalid/pr/1', error: null,
    recorded_at: '2026-07-31T12:08:08.000Z',
    registry_trust_digest: `sha256:${'7'.repeat(64)}`,
    registration_digest: `sha256:${'8'.repeat(64)}`,
    policy_digest: `sha256:${'9'.repeat(64)}`,
    attestation_digest: `sha256:${'a'.repeat(64)}`,
    result_digest: `sha256:${'b'.repeat(64)}`,
    reconciliation_of: null,
  };
  const outcome = { ...outcomeUnsigned, outcome_digest: digestValue(outcomeUnsigned) };
  const mismatchedUnsigned = { ...outcomeUnsigned, request_id: 'request-other' };
  const mismatchedOutcome = buildWorkflowEvent(previous, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-external-mismatched-outcome',
    recorded_at: outcomeUnsigned.recorded_at,
    event_type: 'capability.outcome',
    node_id: 'ship',
    producer: { role: 'capability-broker' },
    worktree_fingerprint: FINGERPRINT,
    payload: { ...mismatchedUnsigned, outcome_digest: digestValue(mismatchedUnsigned) },
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, mismatchedOutcome), /request_id does not match/);
  const budgetMismatchUnsigned = {
    ...outcomeUnsigned,
    budget_charge: { cost_units: 0.25, duration_ms: 100 },
  };
  const budgetMismatchOutcome = buildWorkflowEvent(previous, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-external-budget-mismatch',
    recorded_at: outcomeUnsigned.recorded_at,
    event_type: 'capability.outcome',
    node_id: 'ship',
    producer: { role: 'capability-broker' },
    worktree_fingerprint: FINGERPRINT,
    payload: { ...budgetMismatchUnsigned, outcome_digest: digestValue(budgetMismatchUnsigned) },
  });
  assert.throws(
    () => reduceWorkflowEvent(compiled, state, budgetMismatchOutcome),
    /budget charge does not match its reserved budget/,
  );
  apply({
    event_type: 'capability.outcome', node_id: 'ship',
    recorded_at: outcomeUnsigned.recorded_at,
    producer: { role: 'capability-broker' },
    worktree_fingerprint: FINGERPRINT,
    payload: outcome,
  });
  assert.deepEqual(shipTransitions(), ['capability.decision', 'node.completed', 'node.failed']);
  assert.deepEqual(state.nodes.ship.reserved_budget, { cost_units: 0, duration_ms: 0 });
  assert.deepEqual(state.nodes.ship.consumed_budget, { cost_units: 0.5, duration_ms: 100 });
  apply(completionInput);
  assert.equal(state.status, 'accepted');
});

test('capability reservations prevent cumulative overbooking and failed outcomes charge once', async () => {
  const { compileWorkflow, createInitialState, legalTransitions, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { digestValue } = await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const plan = inputPlan();
  plan.workflow_id = 'wf-capability-budget';
  plan.budget = { max_cost_units: 2, max_duration_ms: 200, max_attempts: 2 };
  plan.nodes = [taskNode('work', [], 'work-v1', 'work.json')];
  const compiled = compileWorkflow(plan);
  let state = createInitialState(compiled);
  let previous = null;
  let sequence = 0;
  const build = (input) => {
    sequence += 1;
    return buildWorkflowEvent(previous, {
      workflow_id: compiled.plan.workflow_id,
      event_id: `evt-capability-budget-${sequence}`,
      recorded_at: `2026-07-31T12:09:${String(sequence).padStart(2, '0')}.000Z`,
      worktree_fingerprint: FINGERPRINT,
      ...input,
    });
  };
  const apply = (input) => {
    const event = build(input);
    state = reduceWorkflowEvent(compiled, state, event);
    previous = event;
  };
  apply({ event_type: 'workflow.started', producer: { role: 'apex' } });
  apply({
    event_type: 'node.started', node_id: 'work', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  const deniedUnsigned = {
    schema_version: 1,
    request_id: 'request-budget-denied',
    idempotency_key: 'write:budget:denied',
    capability_type: 'workspace.write',
    request_digest: `sha256:${'d'.repeat(64)}`,
    decision: 'denied',
    reason: 'policy_denied',
    reserved_budget: null,
  };
  apply({
    event_type: 'capability.decision', node_id: 'work', producer: { role: 'capability-broker' },
    payload: { ...deniedUnsigned, decision_digest: digestValue(deniedUnsigned) },
  });
  assert.deepEqual(state.nodes.work.reserved_budget, { cost_units: 0, duration_ms: 0 });
  assert.deepEqual(state.remaining_budget, { cost: 2, duration_ms: 200, attempts: 1 });
  const decision = (index, budget = { cost_units: 1, duration_ms: 100 }) => {
    const unsigned = {
      schema_version: 1,
      request_id: `request-budget-${index}`,
      idempotency_key: `write:budget:${index}`,
      capability_type: 'workspace.write',
      request_digest: `sha256:${String(index).repeat(64)}`,
      decision: 'authorized',
      reason: 'policy_satisfied',
      reserved_budget: budget,
    };
    return { ...unsigned, decision_digest: digestValue(unsigned) };
  };
  const first = decision(1);
  const second = decision(2);
  apply({
    event_type: 'capability.decision', node_id: 'work',
    producer: { role: 'capability-broker' }, payload: first,
  });
  assert.deepEqual(state.nodes.work.reserved_budget, { cost_units: 1, duration_ms: 100 });
  assert.deepEqual(state.remaining_budget, { cost: 1, duration_ms: 100, attempts: 1 });
  const unresolvedTransitions = legalTransitions(compiled, state);
  assert.deepEqual(unresolvedTransitions, [{ event_type: 'capability.outcome', node_id: 'work' }]);
  assert.throws(() => reduceWorkflowEvent(compiled, state, build({
    event_type: 'capability.decision', node_id: 'work',
    producer: { role: 'capability-broker' }, payload: second,
  })), /unresolved capability effect freezes the workflow/);
  assert.throws(() => reduceWorkflowEvent(compiled, state, build({
    event_type: 'node.failed', node_id: 'work', producer: { role: 'blade' },
    payload: { failure_class: 'execution_failed', cost_units: 0, duration_ms: 0 },
  })), /unresolved capability effect freezes the workflow/);

  const failedOutcome = (payload, index) => {
    const recordedAt = `2026-07-31T12:09:${String(sequence + 1).padStart(2, '0')}.000Z`;
    const unsigned = {
      schema_version: 2,
      outcome_kind: 'native-tool-execution',
      request_id: payload.request_id,
      idempotency_key: payload.idempotency_key,
      capability_type: payload.capability_type,
      request_digest: payload.request_digest,
      decision_digest: payload.decision_digest,
      reservation_digest: `sha256:${String(index + 3).repeat(64)}`,
      execution_nonce: Buffer.alloc(32, index).toString('base64url'),
      budget_charge: payload.reserved_budget,
      status: 'failed',
      external_reference: null,
      error: 'execution failed',
      recorded_at: recordedAt,
    };
    return { ...unsigned, outcome_digest: digestValue(unsigned) };
  };
  const firstOutcome = failedOutcome(first, 1);
  apply({
    event_type: 'capability.outcome', node_id: 'work', recorded_at: firstOutcome.recorded_at,
    producer: { role: 'capability-broker' }, payload: firstOutcome,
  });
  apply({
    event_type: 'capability.decision', node_id: 'work',
    producer: { role: 'capability-broker' }, payload: second,
  });
  assert.deepEqual(state.nodes.work.reserved_budget, { cost_units: 1, duration_ms: 100 });
  assert.deepEqual(state.nodes.work.consumed_budget, { cost_units: 1, duration_ms: 100 });
  assert.deepEqual(state.remaining_budget, { cost: 0, duration_ms: 0, attempts: 1 });
  const secondOutcome = failedOutcome(second, 2);
  apply({
    event_type: 'capability.outcome', node_id: 'work', recorded_at: secondOutcome.recorded_at,
    producer: { role: 'capability-broker' }, payload: secondOutcome,
  });
  const overbooked = decision(3, { cost_units: 0.1, duration_ms: 1 });
  assert.throws(() => reduceWorkflowEvent(compiled, state, build({
    event_type: 'capability.decision', node_id: 'work',
    producer: { role: 'capability-broker' }, payload: overbooked,
  })), /remaining workflow cost budget/);
  assert.deepEqual(state.nodes.work.reserved_budget, { cost_units: 0, duration_ms: 0 });
  assert.deepEqual(state.nodes.work.consumed_budget, { cost_units: 2, duration_ms: 200 });
  assert.deepEqual(state.remaining_budget, { cost: 0, duration_ms: 0, attempts: 1 });
  const resolvedTransitions = legalTransitions(compiled, state);
  assert.ok(resolvedTransitions.some((transition) => transition.event_type === 'worktree.changed'));
  assert.ok(resolvedTransitions.some((transition) =>
    transition.event_type === 'node.failed' && transition.node_id === 'work'));
  assert.ok(!resolvedTransitions.some((transition) =>
    transition.event_type === 'capability.outcome' && transition.node_id === 'work'));
});

test('an unresolved or indeterminate effect freezes the workflow to its matching outcome path', async () => {
  const { compileWorkflow, createInitialState, legalTransitions, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { digestValue } = await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const plan = inputPlan();
  plan.workflow_id = 'wf-capability-reconciliation-freeze';
  plan.nodes = [
    taskNode('done', [], 'done-v1', 'done.json'),
    taskNode('effect', [], 'effect-v1', 'effect.json'),
    taskNode('ready', [], 'ready-v1', 'ready.json'),
  ];
  const compiled = compileWorkflow(plan);
  let state = createInitialState(compiled);
  let previous = null;
  let sequence = 0;
  const build = (input) => buildWorkflowEvent(previous, {
    workflow_id: compiled.plan.workflow_id,
    event_id: `evt-capability-freeze-${sequence + 1}-${input.event_type}`,
    recorded_at: `2026-07-31T14:10:${String(sequence + 1).padStart(2, '0')}.000Z`,
    worktree_fingerprint: FINGERPRINT,
    ...input,
  });
  const apply = (input) => {
    const event = build(input);
    state = reduceWorkflowEvent(compiled, state, event);
    previous = event;
    sequence += 1;
  };
  const unrelatedStartIsRejected = () => {
    try {
      reduceWorkflowEvent(compiled, state, build({
        event_type: 'node.started', node_id: 'ready', producer: { role: 'blade' },
        payload: { input_refs: [] },
      }));
      return false;
    } catch {
      return true;
    }
  };
  apply({ event_type: 'workflow.started', producer: { role: 'apex' } });
  apply({
    event_type: 'node.started', node_id: 'done', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  apply({
    event_type: 'node.completed', node_id: 'done', producer: { role: 'blade' },
    artifact_refs: ['done.json'],
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'done.json', digest: INSPECTION_DIGEST }],
      cost_units: 0.5,
      duration_ms: 50,
    },
  });
  apply({
    event_type: 'node.started', node_id: 'effect', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  const decisionUnsigned = {
    schema_version: 1,
    request_id: 'request-reconciliation-freeze',
    idempotency_key: 'process:reconciliation-freeze',
    capability_type: 'process.exec',
    request_digest: `sha256:${'c'.repeat(64)}`,
    decision: 'authorized',
    reason: 'Bound process execution',
    reserved_budget: { cost_units: 0.5, duration_ms: 100 },
  };
  const decision = { ...decisionUnsigned, decision_digest: digestValue(decisionUnsigned) };
  apply({
    event_type: 'capability.decision', node_id: 'effect',
    producer: { role: 'capability-broker' }, payload: decision,
  });
  const unresolved = {
    transitions: legalTransitions(compiled, state),
    unrelated_start_rejected: unrelatedStartIsRejected(),
  };
  const indeterminateUnsigned = {
    schema_version: 2,
    outcome_kind: 'signed-host-adapter-execution',
    request_id: decision.request_id,
    idempotency_key: decision.idempotency_key,
    capability_type: decision.capability_type,
    request_digest: decision.request_digest,
    decision_digest: decision.decision_digest,
    reservation_digest: `sha256:${'d'.repeat(64)}`,
    execution_nonce: Buffer.alloc(32, 13).toString('base64url'),
    budget_charge: decision.reserved_budget,
    status: 'indeterminate',
    external_reference: null,
    error: 'host result is unknown',
    recorded_at: '2026-07-31T14:10:06.000Z',
    registry_trust_digest: `sha256:${'e'.repeat(64)}`,
    registration_digest: `sha256:${'f'.repeat(64)}`,
    policy_digest: `sha256:${'0'.repeat(64)}`,
    attestation_digest: `sha256:${'1'.repeat(64)}`,
    result_digest: `sha256:${'2'.repeat(64)}`,
    reconciliation_of: null,
  };
  const indeterminate = {
    ...indeterminateUnsigned,
    outcome_digest: digestValue(indeterminateUnsigned),
  };
  apply({
    event_type: 'capability.outcome', node_id: 'effect',
    recorded_at: indeterminate.recorded_at,
    producer: { role: 'capability-broker' }, payload: indeterminate,
  });
  const awaitingReconciliation = {
    transitions: legalTransitions(compiled, state),
    unrelated_start_rejected: unrelatedStartIsRejected(),
  };
  const onlyMatchingOutcome = [{ event_type: 'capability.outcome', node_id: 'effect' }];
  assert.deepEqual({ unresolved, awaitingReconciliation }, {
    unresolved: { transitions: onlyMatchingOutcome, unrelated_start_rejected: true },
    awaitingReconciliation: { transitions: onlyMatchingOutcome, unrelated_start_rejected: true },
  });
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
    apply({
      event_type: 'node.started', node_id: id, producer: { role: 'blade' }, payload: { input_refs: [] },
    });
    apply({
      event_type: 'node.completed', node_id: id,
      producer: { role: 'blade' },
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
