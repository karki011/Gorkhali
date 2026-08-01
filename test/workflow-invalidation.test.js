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

const workflow = () => ({
  schema_version: 1,
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
      producer: { role: 'apex' },
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
    worktree_fingerprint: NEW_FINGERPRINT,
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
