// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FINGERPRINT = `sha256:${'1'.repeat(64)}`;
const NEW_FINGERPRINT = `sha256:${'2'.repeat(64)}`;

const evaluatorNode = (budget = {}) => ({
  id: 'quality',
  kind: 'evaluate-optimize',
  depends_on: [],
  retry_limit: 5,
  generator_role: 'blade',
  evaluator_role: 'ward',
  output_schema: 'evaluation-result-v1',
  expected_artifacts: ['evaluation.json'],
  budget: {
    max_iterations: 4,
    max_duration_ms: 10_000,
    max_cost_units: 10,
    stuck_failure_limit: 3,
    ...budget,
  },
});

const evaluation = (overrides = {}) => ({
  schema_version: 1,
  node_id: 'quality',
  verdict: 'fail',
  worktree_fingerprint: FINGERPRINT,
  evaluator: { role: 'ward' },
  evidence: [{ name: 'unit', result: 'failed' }],
  failure_class: 'test_failure',
  feedback: ['Fix the focused failure'],
  retryable: true,
  cost_units: 1,
  duration_ms: 100,
  ...overrides,
});

const planContract = (node) => ({
  schema_version: 2,
  workflow_id: 'wf-evaluator-1',
  route: 'plan',
  risk: 'high',
  baseline_fingerprint: FINGERPRINT,
  session_binding: {
    repo_id: 'fixture',
    task_id: 'evaluator-test',
    route: 'plan',
    approved_plan: { artifact_type: 'plan', record_sequence: 1, digest: FINGERPRINT },
  },
  routing: {
    recommended_route: 'plan', confidence: 0.8, fallback_route: 'full', signals: {},
  },
  execution_mode: 'attended',
  acceptance_criteria: ['independent evaluation passes'],
  budget: { max_cost_units: 100, max_duration_ms: 100_000, max_attempts: 20 },
  nodes: [node],
});

async function runEvaluations(node, results, artifactRefs = ['evaluation.json']) {
  const { compileWorkflow, createInitialState, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const compiled = compileWorkflow(planContract(node));
  let state = createInitialState(compiled);
  let previous = null;
  let sequence = 0;
  const apply = (input) => {
    sequence += 1;
    previous = buildWorkflowEvent(previous, {
      workflow_id: compiled.plan.workflow_id,
      event_id: `evt-evaluator-${sequence}`,
      recorded_at: `2026-07-31T12:02:${String(sequence).padStart(2, '0')}.000Z`,
      producer: {
        role: input.event_type === 'evaluation.recorded'
          ? node.evaluator_role
          : (input.event_type === 'node.started' ? node.generator_role : 'apex'),
      },
      worktree_fingerprint: FINGERPRINT,
      ...input,
    });
    state = reduceWorkflowEvent(compiled, state, previous);
  };
  apply({ event_type: 'workflow.started' });
  apply({ event_type: 'node.started', node_id: 'quality', payload: { input_refs: [] } });
  for (const [index, result] of results.entries()) {
    const refs = index === 0 ? artifactRefs : ['evaluation.json'];
    apply({
      event_type: 'evaluation.recorded', node_id: 'quality',
      payload: {
        ...result,
        artifact_digests: refs.map((artifactRef) => ({ artifact_ref: artifactRef, digest: FINGERPRINT })),
      },
      worktree_fingerprint: result.worktree_fingerprint,
      artifact_refs: refs,
    });
    if (index < results.length - 1) {
      apply({ event_type: 'node.started', node_id: 'quality', payload: { input_refs: [] } });
    }
  }
  return { compiled, state, previous, apply };
}

test('loop stops immediately on evidence-backed independent acceptance', async () => {
  const accepted = evaluation({
    verdict: 'pass',
    evidence: [{ name: 'unit', result: 'passed' }],
    failure_class: null,
    feedback: [],
    retryable: false,
  });
  const { state } = await runEvaluations(evaluatorNode(), [accepted]);
  assert.equal(state.status, 'accepted');
  assert.equal(state.nodes.quality.terminal_state, 'accepted');
  assert.equal(state.nodes.quality.evaluation.iterations, 1);
  assert.deepEqual(state.nodes.quality.artifact_digests, [
    { artifact_ref: 'evaluation.json', digest: FINGERPRINT },
  ]);
  assert.equal(state.remaining_budget.cost, 99);
});

test('evaluate-optimize binds generator actions and evaluation evidence to independent roles', async () => {
  const { compileWorkflow, createInitialState, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const node = evaluatorNode();
  const compiled = compileWorkflow(planContract(node));
  let state = createInitialState(compiled);
  let previous = null;
  const build = (input) => buildWorkflowEvent(previous, {
    workflow_id: compiled.plan.workflow_id,
    event_id: `evt-evaluator-role-${state.sequence + 1}-${input.event_type}`,
    recorded_at: `2026-07-31T12:01:${String(state.sequence + 1).padStart(2, '0')}.000Z`,
    worktree_fingerprint: FINGERPRINT,
    ...input,
  });
  const apply = (input) => {
    const event = build(input);
    state = reduceWorkflowEvent(compiled, state, event);
    previous = event;
  };

  apply({ event_type: 'workflow.started', producer: { role: 'apex' } });
  assert.throws(() => reduceWorkflowEvent(compiled, state, build({
    event_type: 'node.started', node_id: 'quality', producer: { role: 'ward' },
    payload: { input_refs: [] },
  })), /producer role blade/);
  apply({
    event_type: 'node.started', node_id: 'quality', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, build({
    event_type: 'node.failed', node_id: 'quality', producer: { role: 'ward' },
    payload: { failure_class: 'generation_failed', cost_units: 1, duration_ms: 100 },
  })), /producer role blade/);
  const accepted = evaluation({
    verdict: 'pass',
    evidence: [{ name: 'unit', result: 'passed' }],
    failure_class: null,
    feedback: [],
    retryable: false,
    artifact_digests: [{ artifact_ref: 'evaluation.json', digest: FINGERPRINT }],
  });
  assert.throws(() => reduceWorkflowEvent(compiled, state, build({
    event_type: 'evaluation.recorded', node_id: 'quality', producer: { role: 'blade' },
    artifact_refs: ['evaluation.json'], payload: accepted,
  })), /producer role ward/);
});

test('missing evidence and human decisions block rather than accept', async () => {
  const missing = await runEvaluations(
    evaluatorNode(),
    [evaluation({ evidence: [], failure_class: 'missing_evidence' })],
    [],
  );
  assert.equal(missing.state.status, 'blocked');
  assert.equal(missing.state.nodes.quality.terminal_state, 'missing_evidence');

  const human = await runEvaluations(evaluatorNode(), [evaluation({
    verdict: 'blocked', failure_class: 'human_decision_required', retryable: false,
  })]);
  assert.equal(human.state.status, 'blocked');
  assert.equal(human.state.nodes.quality.terminal_state, 'human_decision_required');
});

test('non-retryable rejection and budget exhaustion are terminal', async () => {
  const rejected = await runEvaluations(evaluatorNode(), [evaluation({ retryable: false })]);
  assert.equal(rejected.state.nodes.quality.terminal_state, 'rejected');
  assert.equal(rejected.state.status, 'failed');

  const exhausted = await runEvaluations(
    evaluatorNode({ max_cost_units: 1 }),
    [evaluation({ cost_units: 1 })],
  );
  assert.equal(exhausted.state.nodes.quality.terminal_state, 'budget_exhausted');
});

test('iteration and repeated-failure limits stop bounded retries', async () => {
  const iteration = await runEvaluations(
    evaluatorNode({ max_iterations: 2, stuck_failure_limit: 3 }),
    [evaluation({ failure_class: 'first' }), evaluation({ failure_class: 'second' })],
  );
  assert.equal(iteration.state.nodes.quality.terminal_state, 'iteration_limit');
  assert.equal(iteration.state.nodes.quality.attempts, 2);

  const stuck = await runEvaluations(
    evaluatorNode({ max_iterations: 5, stuck_failure_limit: 2 }),
    [evaluation(), evaluation()],
  );
  assert.equal(stuck.state.nodes.quality.terminal_state, 'stuck_same_failure');
  assert.equal(stuck.state.nodes.quality.evaluation.failure_counts.test_failure, 2);
});

test('prototype-named failure classes cannot bypass the repeated-failure limit', async () => {
  for (const failureClass of ['__proto__', 'constructor', 'toString']) {
    const stuck = await runEvaluations(
      evaluatorNode({ max_iterations: 5, stuck_failure_limit: 2 }),
      [evaluation({ failure_class: failureClass }), evaluation({ failure_class: failureClass })],
    );
    const counts = stuck.state.nodes.quality.evaluation.failure_counts;
    assert.equal(stuck.state.nodes.quality.terminal_state, 'stuck_same_failure');
    assert.equal(Object.getPrototypeOf(counts), null);
    assert.equal(Object.hasOwn(counts, failureClass), true);
    assert.equal(counts[failureClass], 2);
    if (failureClass === '__proto__') {
      const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
      const { reduceWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
      const invalidation = buildWorkflowEvent(stuck.previous, {
        workflow_id: stuck.compiled.plan.workflow_id,
        event_id: 'evt-evaluator-prototype-invalidation',
        event_type: 'node.invalidated',
        node_id: 'quality',
        recorded_at: '2026-07-31T12:03:00.000Z',
        producer: { role: 'apex' },
        worktree_fingerprint: FINGERPRINT,
        payload: { reason: 'upstream artifact changed' },
      });
      const invalidated = reduceWorkflowEvent(stuck.compiled, stuck.state, invalidation);
      const preserved = invalidated.nodes.quality.evaluation.failure_counts;
      assert.equal(Object.getPrototypeOf(preserved), null);
      assert.equal(preserved.__proto__, 2);
    }
  }
});

test('new worktree fingerprint invalidates an accepted evaluation', async () => {
  const accepted = evaluation({
    verdict: 'pass', evidence: [{ name: 'unit', result: 'passed' }],
    failure_class: null, feedback: [], retryable: false,
  });
  const run = await runEvaluations(evaluatorNode(), [accepted]);
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const { reduceWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const event = buildWorkflowEvent(run.previous, {
    workflow_id: run.compiled.plan.workflow_id,
    event_id: 'evt-evaluator-worktree',
    recorded_at: '2026-07-31T12:03:00.000Z',
    event_type: 'worktree.changed',
    worktree_fingerprint: NEW_FINGERPRINT,
    producer: { role: 'apex' },
    payload: {},
  });
  const invalidated = reduceWorkflowEvent(run.compiled, run.state, event);
  assert.equal(invalidated.status, 'running');
  assert.equal(invalidated.nodes.quality.status, 'ready');
  assert.equal(invalidated.nodes.quality.evaluation.iterations, 1, 'invalidation cannot reset the iteration budget');
  assert.equal(invalidated.nodes.quality.terminal_state, null);
});

test('evaluation acceptance is rejected before it can overspend a node budget', async () => {
  const accepted = evaluation({
    verdict: 'pass',
    evidence: [{ name: 'unit', result: 'passed' }],
    failure_class: null,
    feedback: [],
    retryable: false,
    cost_units: 2,
  });
  await assert.rejects(
    runEvaluations(evaluatorNode({ max_cost_units: 1 }), [accepted]),
    /exceeds its cost budget/,
  );
});

test('budget.exhausted cannot be asserted while authoritative budget remains', async () => {
  const run = await runEvaluations(evaluatorNode(), []);
  assert.throws(() => run.apply({
    event_type: 'budget.exhausted',
    node_id: 'quality',
    payload: { failure_class: 'budget_exhausted' },
  }), /not derived from authoritative budget state/);
});

test('advance records evaluation artifacts from canonical files and actual bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-evaluation-artifact-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  const previousData = process.env.PHANTOM_DATA;
  fs.mkdirSync(workspace);
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'phantom@example.com'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Phantom'], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: workspace });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: workspace });
  process.env.PHANTOM_DATA = data;
  try {
    const { canonicalEventInput } = await import('../skills/phantom/scripts/advance-workflow.mjs');
    const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
    const { appendWorkflowEvent, readWorkflowJournal, writeCompiledWorkflow } =
      await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
    const { sessionPaths } = await import('../skills/phantom/scripts/lib/portable.mjs');
    const { worktreeFingerprint } = await import('../skills/phantom/scripts/phantom-state.mjs');
    const task = 'evaluation-artifact-test';
    const canonicalWorkspace = fs.realpathSync(workspace);
    const fingerprint = worktreeFingerprint(canonicalWorkspace);
    const compiled = compileWorkflow({
      ...planContract(evaluatorNode()),
      baseline_fingerprint: fingerprint,
      session_binding: {
        repo_id: 'fixture', task_id: task, route: 'plan',
        approved_plan: { artifact_type: 'plan', record_sequence: 1, digest: fingerprint },
      },
    });
    const sessionDir = sessionPaths(workspace, task).sessionDir;
    writeCompiledWorkflow(sessionDir, compiled);
    const advance = (value) => {
      const snapshot = readWorkflowJournal(sessionDir, compiled);
      const canonical = canonicalEventInput({
        input: value,
        compiled,
        snapshot,
        sessionDir,
        fingerprint,
      });
      return appendWorkflowEvent({ sessionDir, compiled, input: canonical });
    };
    advance({ event_id: 'evaluation-start', event_type: 'workflow.started', payload: {} });
    advance({
      event_id: 'evaluation-node-start', event_type: 'node.started', node_id: 'quality', payload: {},
    });
    const accepted = evaluation({
      verdict: 'pass',
      worktree_fingerprint: fingerprint,
      evidence: [{ name: 'unit', result: 'passed' }],
      failure_class: null,
      feedback: [],
      retryable: false,
    });
    const artifactBytes = Buffer.from(JSON.stringify(accepted));
    fs.writeFileSync(path.join(sessionDir, 'evaluation.json'), artifactBytes);
    const actualDigest = `sha256:${createHash('sha256').update(artifactBytes).digest('hex')}`;
    assert.throws(() => advance({
      event_id: 'evaluation-forged-digest',
      event_type: 'evaluation.recorded',
      node_id: 'quality',
      artifact_refs: ['evaluation.json'],
      payload: {
        ...accepted,
        artifact_digests: [{ artifact_ref: 'evaluation.json', digest: FINGERPRINT }],
      },
    }), /does not match canonical runtime evidence/);
    assert.throws(() => advance({
      event_id: 'evaluation-mismatched-content',
      event_type: 'evaluation.recorded',
      node_id: 'quality',
      artifact_refs: ['evaluation.json'],
      payload: { ...accepted, feedback: ['not present in the artifact'] },
    }), /must exactly contain the canonical evaluation result/);
    const completed = advance({
      event_id: 'evaluation-valid',
      event_type: 'evaluation.recorded',
      node_id: 'quality',
      artifact_refs: ['evaluation.json'],
      payload: accepted,
    });
    assert.equal(completed.state.status, 'accepted');
    assert.deepEqual(completed.state.nodes.quality.artifact_digests, [
      { artifact_ref: 'evaluation.json', digest: actualDigest },
    ]);
    const journal = readWorkflowJournal(sessionDir, compiled);
    assert.deepEqual(journal.events.at(-1).payload.artifact_digests, [
      { artifact_ref: 'evaluation.json', digest: actualDigest },
    ]);
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
