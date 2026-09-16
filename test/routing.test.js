const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scoreRisk,
  tierForTask,
  canRunInParallel,
  buildExecutionWaves,
  isolationForTask,
} = require('../lib/routing.js');

test('scoreRisk weights deterministic engineering risk signals', () => {
  assert.equal(scoreRisk({ riskSignals: { security: true, migration: true } }), 3);
  assert.equal(scoreRisk({ riskSignals: { publicContract: true }, verificationFailures: 2 }), 4);
});

test('engineer stays balanced until risk or repeated failure warrants deep reasoning', () => {
  assert.equal(tierForTask('engineer', { riskSignals: { crossPackage: true } }), 'balanced');
  assert.equal(tierForTask('engineer', {
    riskSignals: {
      security: true,
      publicContract: true,
      architectureAmbiguity: true,
    },
  }), 'deep');
  assert.equal(tierForTask('engineer', { implementationFailures: 2 }), 'deep');
});

test('auditor escalates earlier than engineer because review risk is cheap to isolate', () => {
  assert.equal(tierForTask('auditor', { riskSignals: { crossPackage: true } }), 'balanced');
  assert.equal(tierForTask('auditor', { riskSignals: { security: true, concurrency: true } }), 'deep');
  assert.equal(tierForTask('auditor', { verificationFailures: 1 }), 'deep');
});

test('fixed roles keep their configured tier', () => {
  assert.equal(tierForTask('inspector', { riskSignals: { security: true } }), 'economy');
  assert.equal(tierForTask('detective', {}), 'deep');
});

test('parallel engineers require explicit safety and disjoint files/resources', () => {
  const tasks = [
    { id: 'api', files: ['src/api.js'], coordinationKeys: ['api-contract'], parallelSafe: true },
    { id: 'ui', files: ['src/ui.js'], coordinationKeys: ['ui'], parallelSafe: true },
    { id: 'docs', files: ['src/ui.js'], coordinationKeys: ['docs'], parallelSafe: true },
  ];

  assert.equal(canRunInParallel(tasks[0], tasks[1], tasks), true);
  assert.equal(canRunInParallel(tasks[1], tasks[2], tasks), false);
  assert.equal(canRunInParallel({ ...tasks[0], parallelSafe: false }, tasks[1], tasks), false);
});

test('parallel engineers do not run across dependency edges or high-conflict changes', () => {
  const tasks = [
    { id: 'schema', files: ['db/schema.sql'], parallelSafe: true, riskSignals: { migration: true } },
    { id: 'api', files: ['src/api.js'], parallelSafe: true, dependsOn: ['schema'] },
  ];

  assert.equal(canRunInParallel(tasks[0], tasks[1], tasks), false);
});

test('buildExecutionWaves packs only independent parallel-safe tasks', () => {
  const tasks = [
    { id: 'api', files: ['src/api.js'], coordinationKeys: ['api'], parallelSafe: true },
    { id: 'ui', files: ['src/ui.js'], coordinationKeys: ['ui'], parallelSafe: true },
    { id: 'integration', files: ['test/integration.js'], parallelSafe: false, dependsOn: ['api', 'ui'] },
  ];

  assert.deepEqual(buildExecutionWaves(tasks), [['api', 'ui'], ['integration']]);
});

test('buildExecutionWaves serializes independent tasks unless parallel safety is explicit', () => {
  const tasks = [
    { id: 'one', files: ['one.js'] },
    { id: 'two', files: ['two.js'], parallelSafe: true },
  ];

  assert.deepEqual(buildExecutionWaves(tasks), [['one'], ['two']]);
});

test('scheduler rejects unknown and cyclic dependencies when invoked directly', () => {
  assert.throws(() => buildExecutionWaves([{ id: 'a', dependsOn: ['missing'] }]), /unknown/);
  assert.throws(() => buildExecutionWaves([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }]), /cycle/);
  assert.throws(() => buildExecutionWaves([{ id: 'a' }, { id: 'a' }]), /duplicate/);
});

test('directory ownership, aliases, globs and missing evidence stay conservative', () => {
  const a = { id: 'a', parallelSafe: true, files: ['src/'] };
  for (const files of [['src/a.js'], ['./SRC/a.js'], ['src/*.js'], [], undefined, ['../escape']]) {
    assert.equal(canRunInParallel(a, { id: 'b', parallelSafe: true, files }), false);
  }
  assert.equal(canRunInParallel({ ...a, coordinationKeys: ['db'] }, { id: 'b', files: ['docs/a'], coordinationKeys: ['db'], parallelSafe: true }), false);
});

test('failure scores cap and role thresholds have boundary coverage', () => {
  assert.equal(scoreRisk({ implementationFailures: 99, verificationFailures: 99 }), 4);
  assert.equal(tierForTask('auditor', { riskSignals: { security: true } }), 'balanced');
  assert.equal(tierForTask('auditor', { riskSignals: { security: true, migration: true } }), 'deep');
  assert.equal(tierForTask('engineer', { riskSignals: { security: true, publicContract: true, migration: true } }), 'balanced');
  assert.equal(tierForTask('unknown'), null);
});

test('unknown risk signals and malformed graph evidence cannot enable concurrency', () => {
  const a = { id: 'a', files: ['a'], parallelSafe: true, riskSignals: { destructiveDat: true } };
  const b = { id: 'b', files: ['b'], parallelSafe: true };
  assert.equal(canRunInParallel(a, b), false);
  assert.throws(() => buildExecutionWaves([null]), /valid task/);
  assert.throws(() => buildExecutionWaves([{ id: 'a', dependsOn: 'b' }]), /string array/);
});

function isolationState(overrides = {}) {
  return { pending: ['a'], activeEngineers: [], implementationFailures: 0, verificationFailures: 0, ...overrides };
}

test('isolationForTask returns branch for a solo, uncontested, low-risk task', () => {
  const task = { id: 'a', files: ['a.js'] };
  const plan = { tasks: [task] };
  assert.equal(isolationForTask(task, ['a'], plan, isolationState()), 'branch');
});

test('isolationForTask returns worktree when the wave has more than one task', () => {
  const task = { id: 'a', files: ['a.js'] };
  const plan = { tasks: [task, { id: 'b', files: ['b.js'] }] };
  assert.equal(isolationForTask(task, ['a', 'b'], plan, isolationState()), 'worktree');
});

test('isolationForTask returns worktree when another task is still pending', () => {
  const task = { id: 'a', files: ['a.js'] };
  const plan = { tasks: [task, { id: 'b', files: ['b.js'] }] };
  assert.equal(isolationForTask(task, ['a'], plan, isolationState({ pending: ['a', 'b'] })), 'worktree');
});

test('isolationForTask returns worktree when a pending task depends on this one', () => {
  const task = { id: 'a', files: ['a.js'] };
  const dependent = { id: 'b', files: ['b.js'], dependsOn: ['a'] };
  const plan = { tasks: [task, dependent] };
  assert.equal(isolationForTask(task, ['a'], plan, isolationState({ pending: ['a', 'b'] })), 'worktree');
});

test('isolationForTask ignores a dependent task once it is no longer pending', () => {
  const task = { id: 'a', files: ['a.js'] };
  const dependent = { id: 'b', files: ['b.js'], dependsOn: ['a'] };
  const plan = { tasks: [task, dependent] };
  assert.equal(isolationForTask(task, ['a'], plan, isolationState({ pending: ['a'] })), 'branch');
});

test('isolationForTask returns worktree when a pending task shares a coordination key', () => {
  const task = { id: 'a', files: ['a.js'], coordinationKeys: ['shared-key'] };
  const sibling = { id: 'c', files: ['c.js'], coordinationKeys: ['shared-key'] };
  const plan = { tasks: [task, sibling] };
  assert.equal(isolationForTask(task, ['a'], plan, isolationState({ pending: ['a', 'c'] })), 'worktree');
});

test('isolationForTask ignores a coordination key match once that task is no longer pending', () => {
  const task = { id: 'a', files: ['a.js'], coordinationKeys: ['shared-key'] };
  const sibling = { id: 'c', files: ['c.js'], coordinationKeys: ['shared-key'] };
  const plan = { tasks: [task, sibling] };
  assert.equal(isolationForTask(task, ['a'], plan, isolationState({ pending: ['a'] })), 'branch');
});

test('isolationForTask returns worktree when the risk signals put the Engineer at deep tier', () => {
  const task = { id: 'a', files: ['a.js'], riskSignals: { security: true, destructiveData: true, publicContract: true } };
  const plan = { tasks: [task] };
  assert.equal(isolationForTask(task, ['a'], plan, isolationState()), 'worktree');
});

test('isolationForTask returns worktree once implementation has already failed', () => {
  const task = { id: 'a', files: ['a.js'] };
  const plan = { tasks: [task] };
  assert.equal(isolationForTask(task, ['a'], plan, isolationState({ implementationFailures: 1 })), 'worktree');
});

test('isolationForTask returns worktree when Engineers are already active', () => {
  const task = { id: 'a', files: ['a.js'] };
  const plan = { tasks: [task] };
  assert.equal(isolationForTask(task, ['a'], plan, isolationState({ activeEngineers: ['other-attempt'] })), 'worktree');
});

test('isolationForTask honors an explicit worktree setting on the task or the plan', () => {
  const plan = { tasks: [{ id: 'a', files: ['a.js'] }] };
  assert.equal(isolationForTask({ id: 'a', files: ['a.js'], isolation: 'worktree' }, ['a'], plan, isolationState()), 'worktree');
  assert.equal(isolationForTask({ id: 'a', files: ['a.js'] }, ['a'], { ...plan, isolation: 'worktree' }, isolationState()), 'worktree');
});

test('isolationForTask lets task-level isolation override plan-level isolation in both directions', () => {
  const state = isolationState();
  assert.equal(
    isolationForTask({ id: 'a', files: ['a.js'], isolation: 'branch' }, ['a'], { isolation: 'worktree', tasks: [{ id: 'a' }] }, state),
    'branch',
  );
  assert.equal(
    isolationForTask({ id: 'a', files: ['a.js'], isolation: 'worktree' }, ['a'], { isolation: 'branch', tasks: [{ id: 'a' }] }, state),
    'worktree',
  );
});

test('an explicit branch setting still yields worktree when structural rails require it', () => {
  const task = { id: 'a', files: ['a.js'], isolation: 'branch' };
  const plan = { tasks: [task, { id: 'b', files: ['b.js'] }] };
  assert.equal(isolationForTask(task, ['a', 'b'], plan, isolationState()), 'worktree');
  assert.equal(isolationForTask(task, ['a'], plan, isolationState({ activeEngineers: ['other-attempt'] })), 'worktree');
});

test('an explicit branch setting wins once structural rails pass, even under risk or pending work', () => {
  const riskyTask = {
    id: 'a',
    files: ['a.js'],
    isolation: 'branch',
    riskSignals: { security: true, destructiveData: true, publicContract: true },
  };
  const plan = { tasks: [riskyTask, { id: 'b', files: ['b.js'] }] };
  assert.equal(isolationForTask(riskyTask, ['a'], plan, isolationState()), 'branch');
  assert.equal(isolationForTask(riskyTask, ['a'], plan, isolationState({ pending: ['a', 'b'], implementationFailures: 3 })), 'branch');
});
