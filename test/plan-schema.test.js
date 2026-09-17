// Author: Subash Karki
// plan-schema.test.js - one passing fixture plus one failure per rule the
// lean validator enforces: briefing, decision, outcome, scope, each required
// task field, and the dependency graph (unknown id, self-dependency, cycle).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan } = require('../lib/plan-schema');

function validPlan() {
  return {
    briefing: { tackling: 'Add a rate limiter', problem: 'One tenant can starve others', how: 'A per-tenant token bucket' },
    decision: {
      question: 'Approve the limiter?',
      recommendation: 'Add a per-tenant token bucket',
      rationale: ['A shared limit caused an outage'],
      status: 'pending',
    },
    outcome: { goal: 'A noisy tenant no longer degrades others', doneWhen: ['A tenant over its bucket gets 429'] },
    scope: { in: ['ingest middleware'], out: ['billing'] },
    tasks: [
      {
        id: 'T1',
        description: 'Add the limiter',
        files: ['src/ingest/middleware.js'],
        action: 'Enforce a per-tenant token bucket before the handler',
        acceptance_criteria: ['A tenant over its bucket gets 429'],
        verify: 'node --test test/ingest-rate-limit.test.js',
        dependsOn: [],
      },
      {
        id: 'T2',
        description: 'Add a rate-limit test',
        files: ['test/ingest-rate-limit.test.js'],
        action: 'Assert 429 once a tenant exceeds its bucket',
        acceptance_criteria: ['Test fails before T1, passes after'],
        verify: 'node --test test/ingest-rate-limit.test.js',
        dependsOn: ['T1'],
      },
    ],
  };
}

test('valid plan produces no errors', () => {
  assert.deepEqual(validatePlan(validPlan()), []);
});

test('non-object plan is rejected', () => {
  assert.deepEqual(validatePlan(null), ['plan: required object']);
  assert.deepEqual(validatePlan('nope'), ['plan: required object']);
});

test('missing briefing fields are reported', () => {
  const plan = validPlan();
  plan.briefing = { tackling: 'x' };
  const errors = validatePlan(plan);
  assert.ok(errors.includes('briefing.problem: required non-empty string'));
  assert.ok(errors.includes('briefing.how: required non-empty string'));
});

test('missing decision fields are reported', () => {
  const plan = validPlan();
  delete plan.decision;
  const errors = validatePlan(plan);
  assert.ok(errors.includes('decision: required object'));
});

test('decision.rationale must be a non-empty array', () => {
  const plan = validPlan();
  plan.decision.rationale = [];
  assert.ok(validatePlan(plan).includes('decision.rationale: required non-empty array'));
});

test('missing outcome fields are reported', () => {
  const plan = validPlan();
  plan.outcome = { goal: 'x' };
  assert.ok(validatePlan(plan).includes('outcome.doneWhen: required non-empty array'));
});

test('scope.in and scope.out must be arrays', () => {
  const plan = validPlan();
  plan.scope = { in: 'not-an-array', out: [] };
  const errors = validatePlan(plan);
  assert.ok(errors.includes('scope.in: required array'));
});

test('empty tasks array is rejected', () => {
  const plan = validPlan();
  plan.tasks = [];
  assert.deepEqual(validatePlan(plan), ['tasks: required non-empty array']);
});

test('a task missing id, description, files, action, acceptance_criteria, or verify is reported per field', () => {
  const plan = validPlan();
  plan.tasks = [{ dependsOn: [] }];
  const errors = validatePlan(plan);
  assert.ok(errors.includes('tasks[0].id: required non-empty string'));
  assert.ok(errors.includes('tasks[0].description: required non-empty string'));
  assert.ok(errors.includes('tasks[0].files: required non-empty array'));
  assert.ok(errors.includes('tasks[0].action: required non-empty string'));
  assert.ok(errors.includes('tasks[0].acceptance_criteria: required non-empty array'));
  assert.ok(errors.includes('tasks[0].verify: required non-empty string'));
});

test('dependsOn must be an array when present', () => {
  const plan = validPlan();
  plan.tasks[0].dependsOn = 'T2';
  assert.ok(validatePlan(plan).includes('tasks[0].dependsOn: must be array if present'));
});

test('duplicate task ids are reported', () => {
  const plan = validPlan();
  plan.tasks[1].id = 'T1';
  const errors = validatePlan(plan);
  assert.ok(errors.includes('tasks[1].id: duplicate task id "T1"'));
});

test('a task cannot depend on itself', () => {
  const plan = validPlan();
  plan.tasks[0].dependsOn = ['T1'];
  const errors = validatePlan(plan);
  assert.ok(errors.includes('tasks[0].dependsOn: task cannot depend on itself'));
});

test('dependsOn on an unknown task id is reported', () => {
  const plan = validPlan();
  plan.tasks[0].dependsOn = ['T9'];
  const errors = validatePlan(plan);
  assert.ok(errors.includes('tasks[0].dependsOn: unknown task id "T9"'));
});

test('a dependency cycle is detected', () => {
  const plan = validPlan();
  plan.tasks[0].dependsOn = ['T2'];
  plan.tasks[1].dependsOn = ['T1'];
  const errors = validatePlan(plan);
  assert.ok(errors.includes('tasks[].dependsOn: dependency cycle detected'));
});

test('legacy isolation, parallelSafe, and coordinationKeys fields are accepted and ignored', () => {
  const plan = validPlan();
  plan.isolation = 'worktree';
  plan.tasks[0].isolation = 'branch';
  plan.tasks[0].parallelSafe = true;
  plan.tasks[0].coordinationKeys = ['api-contract'];
  plan.tasks[1].parallelSafe = 'not-a-boolean';
  plan.tasks[1].coordinationKeys = 'not-an-array';
  assert.deepEqual(validatePlan(plan), []);
});
