// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FINGERPRINT = `sha256:${'3'.repeat(64)}`;

const plan = () => ({
  schema_version: 1,
  workflow_id: 'wf-replay-1',
  route: 'direct',
  risk: 'low',
  baseline_fingerprint: FINGERPRINT,
  session_binding: {
    repo_id: 'fixture', task_id: 'replay-test', route: 'direct', approved_plan: null,
  },
  routing: {
    recommended_route: 'direct', confidence: 0.95, fallback_route: null, signals: {},
  },
  execution_mode: 'attended',
  acceptance_criteria: ['journal replay reproduces live state'],
  budget: { max_cost_units: 10, max_duration_ms: 10_000, max_attempts: 3 },
  nodes: [{
    id: 'work', kind: 'task', depends_on: [], retry_limit: 1,
    budget: { max_cost_units: 5, max_duration_ms: 5_000 },
    role: 'blade', output_schema: 'workflow-output-v1', expected_artifacts: ['work.json'],
    acceptance_criteria: ['work artifact is complete'],
  }],
});

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-workflow-replay-'));

test('append-only journal replays to the materialized control-plane state', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { replayWorkflowDirectory } = await import('../skills/phantom/scripts/replay-workflow.mjs');
  const {
    appendWorkflowEvent,
    replayWorkflow,
    replayWorkflowSession,
    workflowPaths,
    writeCompiledWorkflow,
  } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const sessionDir = fixture();
  const compiled = compileWorkflow(plan());
  writeCompiledWorkflow(sessionDir, compiled);
  const append = (input) => appendWorkflowEvent({ sessionDir, compiled, input });
  append({
    event_id: 'evt-replay-1', recorded_at: '2026-07-31T12:04:01.000Z',
    event_type: 'workflow.started', producer: { role: 'apex', runtime: 'test' },
    worktree_fingerprint: FINGERPRINT,
  });
  append({
    event_id: 'evt-replay-2', recorded_at: '2026-07-31T12:04:02.000Z',
    event_type: 'node.started', node_id: 'work', producer: { role: 'blade', runtime: 'test' },
    payload: { input_refs: [] },
  });
  const completed = append({
    event_id: 'evt-replay-3', recorded_at: '2026-07-31T12:04:03.000Z',
    event_type: 'node.completed', node_id: 'work', producer: { role: 'blade', runtime: 'test' },
    artifact_refs: ['work.json'], worktree_fingerprint: FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'work.json', digest: FINGERPRINT }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  assert.equal(completed.state.status, 'accepted');

  const replayed = replayWorkflowSession(sessionDir);
  const materialized = JSON.parse(fs.readFileSync(workflowPaths(sessionDir).stateFile, 'utf8'));
  assert.deepEqual(replayed.state, materialized);
  assert.deepEqual(replayWorkflow(compiled, replayed.events), materialized);
  assert.equal(replayed.events.length, 3);
  assert.equal(replayed.events[1].previous_event_digest, replayed.events[0].event_digest);

  const output = path.join(sessionDir, 'replay-report.json');
  const report = replayWorkflowDirectory({ sessionDir, output });
  assert.deepEqual(report.legal_transitions, [
    { event_type: 'worktree.changed', node_id: null },
    { event_type: 'node.invalidated', node_id: 'work' },
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), {
    state: report.state,
    legal_transitions: report.legal_transitions,
  });
});

test('replay rejects corruption, reordering, duplicate IDs, and partial records', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { digestValue } = await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
  const {
    buildWorkflowEvent,
    parseWorkflowJournal,
    replayWorkflow,
  } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const compiled = compileWorkflow(plan());
  const first = buildWorkflowEvent(null, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-duplicate',
    recorded_at: '2026-07-31T12:05:01.000Z',
    event_type: 'workflow.started',
    worktree_fingerprint: FINGERPRINT,
    producer: { role: 'apex' },
  });
  const second = buildWorkflowEvent(first, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-start-work',
    recorded_at: '2026-07-31T12:05:02.000Z',
    event_type: 'node.started',
    node_id: 'work',
    producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  assert.throws(() => replayWorkflow(compiled, [second, first]), /sequence must be 1/);

  const tampered = structuredClone(second);
  tampered.payload.changed = true;
  assert.throws(() => replayWorkflow(compiled, [first, tampered]), /payload digest is invalid/);

  const duplicate = structuredClone(second);
  duplicate.event_id = first.event_id;
  const { event_digest: ignored, ...unsigned } = duplicate;
  void ignored;
  duplicate.event_digest = digestValue(unsigned);
  assert.throws(() => replayWorkflow(compiled, [first, duplicate]), /Duplicate workflow event_id/);

  assert.throws(() => parseWorkflowJournal(`${JSON.stringify(first)}\n{"broken"`), /line 2 is invalid JSON/);
  assert.throws(() => parseWorkflowJournal(`${JSON.stringify(first)}\n\n`), /empty record/);
});

test('optimistic tail binding rejects a concurrent stale append', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const {
    appendWorkflowEvent,
    WorkflowJournalConflictError,
  } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const compiled = compileWorkflow(plan());
  const sessionDir = fixture();
  const first = appendWorkflowEvent({
    sessionDir,
    compiled,
    expected_previous_event_digest: null,
    input: {
      event_id: 'evt-tail-1', recorded_at: '2026-07-31T12:06:01.000Z',
      event_type: 'workflow.started', producer: { role: 'apex' },
      worktree_fingerprint: FINGERPRINT,
    },
  });
  assert.throws(() => appendWorkflowEvent({
    sessionDir,
    compiled,
    expected_previous_event_digest: null,
    input: {
      event_id: 'evt-tail-2', recorded_at: '2026-07-31T12:06:02.000Z',
      event_type: 'node.started', node_id: 'work', producer: { role: 'blade' },
    },
  }), (error) => error instanceof WorkflowJournalConflictError
    && error.code === 'WORKFLOW_JOURNAL_CONFLICT'
    && error.actual === first.event.event_digest);
});

test('canonical capability events are audited without advancing the active node', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { appendWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const compiled = compileWorkflow(plan());
  const sessionDir = fixture();
  const append = (input) => appendWorkflowEvent({ sessionDir, compiled, input });
  append({
    event_id: 'evt-capability-1', recorded_at: '2026-07-31T12:07:01.000Z',
    event_type: 'workflow.started', producer: { role: 'apex' },
    worktree_fingerprint: FINGERPRINT,
  });
  append({
    event_id: 'evt-capability-2', recorded_at: '2026-07-31T12:07:02.000Z',
    event_type: 'node.started', node_id: 'work', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  const { digestValue } = await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
  const requestDigest = `sha256:${'4'.repeat(64)}`;
  const decisionUnsigned = {
    schema_version: 1,
    request_id: 'request-1',
    idempotency_key: 'draft-pr-1',
    capability_type: 'github.openDraftPr',
    request_digest: requestDigest,
    decision: 'authorized',
    reason: 'Bound authorization is valid',
  };
  const decisionPayload = { ...decisionUnsigned, decision_digest: digestValue(decisionUnsigned) };
  const decision = append({
    event_id: 'evt-capability-3', recorded_at: '2026-07-31T12:07:03.000Z',
    event_type: 'capability.decision', node_id: 'work', producer: { role: 'capability-broker' },
    payload: decisionPayload,
  });
  assert.equal(decision.state.nodes.work.status, 'running');
  assert.equal(decision.state.nodes.work.capability_event_count, 1);

  const outcomeUnsigned = {
    schema_version: 1,
    request_id: 'request-1',
    idempotency_key: 'draft-pr-1',
    capability_type: 'github.openDraftPr',
    request_digest: requestDigest,
    decision_digest: decisionPayload.decision_digest,
    status: 'succeeded',
    external_reference: 'https://example.invalid/pr/1',
    error: null,
  };
  const outcome = append({
    event_id: 'evt-capability-4', recorded_at: '2026-07-31T12:07:04.000Z',
    event_type: 'capability.outcome', node_id: 'work', producer: { role: 'capability-broker' },
    payload: { ...outcomeUnsigned, outcome_digest: digestValue(outcomeUnsigned) },
  });
  assert.equal(outcome.state.nodes.work.status, 'running');
  assert.equal(outcome.state.nodes.work.capability_event_count, 2);
  assert.equal(outcome.state.nodes.work.latest_capability_event.event_type, 'capability.outcome');
});
