const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scoreRisk,
  tierForTask,
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

test('buildExecutionWaves runs strictly one task per wave, in plan order among ready tasks', () => {
  const tasks = [
    { id: 'api', files: ['src/api.js'] },
    { id: 'ui', files: ['src/ui.js'] },
    { id: 'integration', files: ['test/integration.js'], dependsOn: ['api', 'ui'] },
  ];

  const waves = buildExecutionWaves(tasks);
  assert.deepEqual(waves, [['api'], ['ui'], ['integration']]);
  assert.ok(waves.every((wave) => wave.length === 1));
});

test('buildExecutionWaves respects dependsOn order even when it disagrees with plan order', () => {
  const tasks = [
    { id: 'consumer', files: ['src/consumer.js'], dependsOn: ['schema'] },
    { id: 'schema', files: ['db/schema.sql'] },
    { id: 'docs', files: ['docs/index.md'] },
  ];

  assert.deepEqual(buildExecutionWaves(tasks), [['schema'], ['consumer'], ['docs']]);
});

test('parallelSafe and coordinationKeys have no effect on wave composition', () => {
  const tasks = [
    { id: 'one', files: ['one.js'], parallelSafe: true, coordinationKeys: ['x'] },
    { id: 'two', files: ['two.js'], parallelSafe: true, coordinationKeys: ['y'] },
    { id: 'three', files: ['three.js'] },
  ];

  assert.deepEqual(buildExecutionWaves(tasks), [['one'], ['two'], ['three']]);
  assert.deepEqual(buildExecutionWaves([]), []);
});

test('scheduler rejects unknown and cyclic dependencies when invoked directly', () => {
  assert.throws(() => buildExecutionWaves([{ id: 'a', dependsOn: ['missing'] }]), /unknown/);
  assert.throws(() => buildExecutionWaves([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }]), /cycle/);
  assert.throws(() => buildExecutionWaves([{ id: 'a' }, { id: 'a' }]), /duplicate/);
});

test('failure scores cap and role thresholds have boundary coverage', () => {
  assert.equal(scoreRisk({ implementationFailures: 99, verificationFailures: 99 }), 4);
  assert.equal(tierForTask('auditor', { riskSignals: { security: true } }), 'balanced');
  assert.equal(tierForTask('auditor', { riskSignals: { security: true, migration: true } }), 'deep');
  assert.equal(tierForTask('engineer', { riskSignals: { security: true, publicContract: true, migration: true } }), 'balanced');
  assert.equal(tierForTask('unknown'), null);
});

test('malformed graph evidence is rejected before scheduling', () => {
  assert.throws(() => buildExecutionWaves([null]), /valid task/);
  assert.throws(() => buildExecutionWaves([{ id: 'a', dependsOn: 'b' }]), /string array/);
});
