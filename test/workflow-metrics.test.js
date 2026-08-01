// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const metricsModule = import('../scripts/workflow-metrics.mjs');

const started = (workflow, at = '2026-07-31T12:00:00.000Z') => ({
  workflow_id: workflow,
  event_type: 'workflow.started',
  sequence: 1,
  recorded_at: at,
  payload: {},
});

const evaluation = (workflow, verdict = 'pass', at = '2026-07-31T12:00:01.000Z') => ({
  workflow_id: workflow,
  event_type: 'evaluation.recorded',
  sequence: 2,
  recorded_at: at,
  payload: {
    verdict,
    evidence: [{ name: 'tests', result: verdict === 'pass' ? 'passed' : 'failed' }],
    cost_units: 2,
  },
});

const run = (id, status, events, completionSequence = status === 'accepted' ? 2 : null) => ({
  session_dir: `/tmp/${id}`,
  replay_ok: true,
  state: {
    status,
    nodes: completionSequence === null ? {} : { final: { last_event_sequence: completionSequence } },
  },
  events,
});

test('hasVerifiedEvidence requires accepted replay state and typed passing evidence', async () => {
  const { hasVerifiedEvidence } = await metricsModule;
  assert.equal(hasVerifiedEvidence(run('ok', 'accepted', [started('ok'), evaluation('ok')])), true);
  assert.equal(hasVerifiedEvidence(run('failed', 'failed', [started('failed'), evaluation('failed')])), false);
  assert.equal(hasVerifiedEvidence(run('claim-only', 'accepted', [started('claim-only')])), false);
  const contradictory = evaluation('contradictory');
  contradictory.payload.evidence[0].result = 'failed';
  assert.equal(hasVerifiedEvidence(run('contradictory', 'accepted', [started('contradictory'), contradictory])), false);
});

test('summarizeRuns calculates replay, verified completion, duration, and coverage conservatively', async () => {
  const { summarizeRuns } = await metricsModule;
  const runs = [
    run('verified', 'accepted', [started('verified'), evaluation('verified')]),
    run('rejected', 'failed', [started('rejected'), evaluation('rejected', 'fail')]),
    run('running', 'running', [started('running')]),
    { session_dir: '/tmp/corrupt', replay_ok: false, error: 'digest mismatch' },
  ];
  const report = summarizeRuns(runs);
  assert.deepEqual(report.observed, {
    workflows_attempted: 4,
    workflows_replayable: 3,
    workflows_terminal: 2,
    workflows_verified: 1,
  });
  assert.equal(report.metrics.verified_completion_rate.value, 0.25);
  assert.equal(report.metrics.verified_completion_rate.coverage, 0.75);
  assert.equal(report.metrics.workflow_replay_success_rate.value, 0.75);
  assert.deepEqual(report.metrics.time_to_verified_completion_ms.value, { median: 1000, p90: 1000 });
  assert.equal(report.metrics.observed_evaluation_cost_units_per_verified_completion.value, 2);
  assert.equal(report.replay_failures.length, 1);
});

test('verified completion duration stops at the acceptance transition', async () => {
  const { summarizeRuns } = await metricsModule;
  const laterJournalEvent = {
    workflow_id: 'verified',
    event_type: 'worktree.changed',
    sequence: 3,
    recorded_at: '2026-07-31T12:01:00.000Z',
    payload: {},
  };
  const report = summarizeRuns([
    run('verified', 'accepted', [started('verified'), evaluation('verified'), laterJournalEvent], 2),
  ]);
  assert.deepEqual(report.metrics.time_to_verified_completion_ms.value, { median: 1000, p90: 1000 });
  assert.match(report.metrics.time_to_verified_completion_ms.source, /accepted state transition/);
});

test('whole-workflow cost and human intervention metrics stay unavailable without contract events', async () => {
  const { summarizeRuns } = await metricsModule;
  const report = summarizeRuns([run('verified', 'accepted', [started('verified'), evaluation('verified')])]);
  assert.equal(report.metrics.cost_per_verified_completion.status, 'unavailable');
  assert.match(report.metrics.cost_per_verified_completion.reason, /complete workflow cost/);
  assert.equal(report.metrics.human_interventions_per_task.status, 'unavailable');
  assert.match(report.metrics.human_interventions_per_task.reason, /not an observed human intervention/);
});

test('verified completion includes incomplete attempts in its denominator', async () => {
  const { summarizeRuns } = await metricsModule;
  const report = summarizeRuns([run('running', 'running', [started('running')])]);
  assert.equal(report.metrics.verified_completion_rate.status, 'available');
  assert.equal(report.metrics.verified_completion_rate.value, 0);
  assert.equal(report.metrics.verified_completion_rate.denominator, 1);
});

test('zero attempts leave replay and completion rates unavailable', async () => {
  const { summarizeRuns } = await metricsModule;
  const report = summarizeRuns([]);
  assert.equal(report.metrics.verified_completion_rate.status, 'unavailable');
  assert.equal(report.metrics.workflow_replay_success_rate.status, 'unavailable');
  assert.equal(report.metrics.workflow_replay_success_rate.value, null);
});

test('validateJournalEvents delegates to the exported event contract and rejects unknown types', async () => {
  const { validateJournalEvents } = await metricsModule;
  const errors = validateJournalEvents([{ event_type: 'legacy.completed' }]);
  assert.ok(errors.some((error) => error.includes('unsupported event_type')));
  assert.ok(errors.some((error) => error.includes('required')));
});

test('loadWorkflowRun reports strict replay failure instead of mining mutable session files', async () => {
  const { loadWorkflowRun } = await metricsModule;
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-metrics-empty-'));
  const result = loadWorkflowRun(empty);
  assert.equal(result.replay_ok, false);
  assert.match(result.error, /plan is not initialized/);
});

test('parseArgs accepts repeated fresh session directories and no legacy roots', async () => {
  const { parseArgs } = await metricsModule;
  const parsed = parseArgs(['--session-dir', '/tmp/one', '--session-dir', '/tmp/two']);
  assert.deepEqual(parsed.sessionDirs, ['/tmp/one', '/tmp/two']);
  assert.throws(() => parseArgs([]), /at least one/);
  assert.throws(() => parseArgs(['--sessions-root', '/tmp/legacy']), /unknown argument/);
});
