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
