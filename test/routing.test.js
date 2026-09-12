const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scoreRisk,
  tierForTask,
  canRunInParallel,
  buildExecutionWaves,
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
