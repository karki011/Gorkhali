#!/usr/bin/env node
// Author: Subash Karki
// Derives conservative quality metrics from the fresh v2 workflow journal only.

import { resolve } from 'node:path';

import {
  WORKFLOW_EVENT_TYPES,
  validateWorkflowEvent,
} from '../skills/phantom/scripts/lib/workflow-contracts.mjs';
import { replayWorkflowSession } from '../skills/phantom/scripts/lib/workflow-journal.mjs';

const TERMINAL_WORKFLOW_STATES = new Set(['accepted', 'failed', 'blocked']);
const EVENT_TYPES = new Set(WORKFLOW_EVENT_TYPES);

const ratio = (numerator, denominator) => denominator === 0 ? null : numerator / denominator;

const percentile = (values, proportion) => {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * proportion) - 1)];
};

export function validateJournalEvents(events) {
  const errors = [];
  if (!Array.isArray(events)) return ['events must be an array'];
  events.forEach((event, index) => {
    if (!EVENT_TYPES.has(event?.event_type)) errors.push(`event ${index + 1}: unsupported event_type ${JSON.stringify(event?.event_type)}`);
    for (const error of validateWorkflowEvent(event)) errors.push(`event ${index + 1}: ${error}`);
  });
  return errors;
}

export function loadWorkflowRun(sessionDir) {
  const absolute = resolve(sessionDir);
  try {
    const replay = replayWorkflowSession(absolute);
    const errors = validateJournalEvents(replay.events);
    if (errors.length) throw new Error(errors.join('; '));
    return {
      session_dir: absolute,
      replay_ok: true,
      events: replay.events,
      state: replay.state,
      plan: replay.compiled.plan,
    };
  } catch (error) {
    return { session_dir: absolute, replay_ok: false, error: error.message };
  }
}

const passedEvidence = (items) => Array.isArray(items)
  && items.length > 0
  && items.every((item) => item?.result === 'passed');

export function hasVerifiedEvidence(run) {
  if (!run.replay_ok || run.state.status !== 'accepted') return false;
  return run.events.some((event) => {
    if (event.event_type === 'evaluation.recorded') {
      return event.payload?.verdict === 'pass' && passedEvidence(event.payload.evidence);
    }
    if (event.event_type === 'parallel.aggregated') {
      return passedEvidence(event.payload?.aggregate_verification);
    }
    return false;
  });
}

function verifiedDurationMs(run) {
  if (!hasVerifiedEvidence(run)) return null;
  const started = run.events.find((event) => event.event_type === 'workflow.started');
  const completionSequence = Object.values(run.state.nodes || {}).reduce(
    (latest, node) => Number.isInteger(node.last_event_sequence)
      ? Math.max(latest, node.last_event_sequence)
      : latest,
    -1,
  );
  const completed = run.events.find((event) => event.sequence === completionSequence);
  const startMs = Date.parse(started?.recorded_at || '');
  const endMs = Date.parse(completed?.recorded_at || '');
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : null;
}

function observedEvaluationCost(run) {
  return run.events
    .filter((event) => event.event_type === 'evaluation.recorded')
    .reduce((total, event) => total + event.payload.cost_units, 0);
}

const availableMetric = (value, numerator, denominator, coverage, source) => ({
  status: 'available', value, numerator, denominator, coverage, source,
});

const unavailableMetric = (reason, source) => ({
  status: 'unavailable', value: null, numerator: null, denominator: null, coverage: 0, source, reason,
});

export function summarizeRuns(runs) {
  const attempted = runs.length;
  const replayable = runs.filter((run) => run.replay_ok);
  const terminal = replayable.filter((run) => TERMINAL_WORKFLOW_STATES.has(run.state.status));
  const verified = terminal.filter(hasVerifiedEvidence);
  const durations = verified.map(verifiedDurationMs).filter(Number.isFinite);
  const evaluationCostCoverage = verified.filter((run) => run.events.some((event) => event.event_type === 'evaluation.recorded'));
  const observedCost = evaluationCostCoverage.reduce((total, run) => total + observedEvaluationCost(run), 0);
  const verifiedCompletionMetric = attempted
    ? availableMetric(
      ratio(verified.length, attempted),
      verified.length,
      attempted,
      ratio(replayable.length, attempted),
      'all attempted workflows; verified numerator requires replayed acceptance plus typed passing evaluation or aggregate evidence',
    )
    : unavailableMetric('no workflow attempts were supplied', 'workflow attempt set');

  const replaySuccessMetric = attempted
    ? availableMetric(
      ratio(replayable.length, attempted),
      replayable.length,
      attempted,
      1,
      'strict replayWorkflowSession outcome',
    )
    : unavailableMetric('no workflow attempts were supplied', 'strict replayWorkflowSession outcome');

  return {
    schema_version: 1,
    source_contract: 'workflow-event-v2',
    observed: {
      workflows_attempted: attempted,
      workflows_replayable: replayable.length,
      workflows_terminal: terminal.length,
      workflows_verified: verified.length,
    },
    metrics: {
      verified_completion_rate: verifiedCompletionMetric,
      workflow_replay_success_rate: replaySuccessMetric,
      time_to_verified_completion_ms: {
        status: durations.length ? 'available' : 'unavailable',
        value: durations.length ? { median: percentile(durations, 0.5), p90: percentile(durations, 0.9) } : null,
        numerator: durations.length,
        denominator: verified.length,
        coverage: ratio(durations.length, verified.length) ?? 0,
        source: 'workflow.started and accepted state transition timestamps',
        ...(durations.length ? {} : { reason: 'no verified workflow has a complete timestamp interval' }),
      },
      cost_per_verified_completion: unavailableMetric(
        'workflow-event-v2 records evaluator cost units, not complete workflow cost',
        'not derivable without whole-workflow cost events',
      ),
      human_interventions_per_task: unavailableMetric(
        'human_decision_required records a demand for intervention, not an observed human intervention',
        'not derivable without explicit human decision events',
      ),
      observed_evaluation_cost_units_per_verified_completion: {
        status: evaluationCostCoverage.length ? 'partial' : 'unavailable',
        value: ratio(observedCost, evaluationCostCoverage.length),
        numerator: observedCost,
        denominator: evaluationCostCoverage.length,
        coverage: ratio(evaluationCostCoverage.length, verified.length) ?? 0,
        source: 'evaluation.recorded payload.cost_units only',
        ...(evaluationCostCoverage.length ? {} : { reason: 'no verified workflow contains evaluator cost evidence' }),
      },
    },
    replay_failures: runs
      .filter((run) => !run.replay_ok)
      .map((run) => ({ session_dir: run.session_dir, error: run.error })),
  };
}

export function parseArgs(argv) {
  const sessionDirs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--session-dir') throw new Error(`unknown argument: ${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error('--session-dir requires a value');
    sessionDirs.push(resolve(value));
  }
  if (sessionDirs.length === 0) throw new Error('at least one --session-dir is required');
  return { sessionDirs };
}

function main() {
  try {
    const { sessionDirs } = parseArgs(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(summarizeRuns(sessionDirs.map(loadWorkflowRun)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
