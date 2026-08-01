// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FINGERPRINT = `sha256:${'a'.repeat(64)}`;

const task = (id, dependsOn = []) => ({
  id,
  kind: 'task',
  depends_on: dependsOn,
  retry_limit: 1,
  budget: { max_cost_units: 10, max_duration_ms: 10_000 },
  role: 'blade',
  output_schema: 'workflow-output-v1',
  expected_artifacts: [`${id}.json`],
  acceptance_criteria: [`${id} output validates`],
});

const plan = (nodes) => ({
  schema_version: 1,
  workflow_id: 'wf-compiler-1',
  route: 'plan',
  risk: 'moderate',
  baseline_fingerprint: FINGERPRINT,
  session_binding: {
    repo_id: 'compiler-test-repo',
    task_id: 'compiler-test-task',
    route: 'plan',
    approved_plan: { artifact_type: 'plan', record_sequence: 1, digest: FINGERPRINT },
  },
  routing: {
    recommended_route: 'plan', confidence: 0.8, fallback_route: 'brainstorm', signals: {},
  },
  execution_mode: 'attended',
  acceptance_criteria: ['Every declared output validates'],
  budget: { max_cost_units: 100, max_duration_ms: 100_000, max_attempts: 20 },
  nodes,
});

test('compiler produces deterministic topological waves and digest', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const input = plan([
    task('integrate', ['frontend', 'backend']),
    task('frontend', ['inspect']),
    task('inspect'),
    task('backend', ['inspect']),
  ]);
  const first = compileWorkflow(input);
  const second = compileWorkflow(structuredClone(input));
  assert.deepEqual(first.execution_waves, [['inspect'], ['backend', 'frontend'], ['integrate']]);
  assert.deepEqual(first.topological_order, ['inspect', 'backend', 'frontend', 'integrate']);
  assert.equal(first.plan_digest, second.plan_digest);
  assert.deepEqual(first, second);
});

test('compiler rejects missing dependencies, self edges, and cycles', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  assert.throws(() => compileWorkflow(plan([task('a', ['missing'])])), /unknown node missing/);
  assert.throws(() => compileWorkflow(plan([task('a', ['a'])])), /self-dependency a/);
  assert.throws(() => compileWorkflow(plan([task('a', ['b']), task('b', ['a'])])), /dependency cycle/);
});

test('parallel compilation requires complete evidence and disjoint write scopes', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const parallel = {
    id: 'implement',
    kind: 'parallel',
    depends_on: [],
    retry_limit: 1,
    budget: { max_cost_units: 20, max_duration_ms: 20_000 },
    dependency_evidence: 'complete',
    output_schema: 'aggregation-result-v1',
    expected_artifacts: ['integrated.json'],
    verification: ['integration-test'],
    branches: [
      {
        id: 'frontend', role: 'blade', allowed_paths: ['src/ui'],
        baseline_fingerprint: FINGERPRINT, dependency_inputs: [],
        expected_artifacts: ['ui.json'], verification: ['ui-test'],
        budget: { max_cost_units: 10, max_duration_ms: 10_000 }, retry_limit: 1,
      },
      {
        id: 'backend', role: 'blade', allowed_paths: ['src/api'],
        baseline_fingerprint: FINGERPRINT, dependency_inputs: [],
        expected_artifacts: ['api.json'], verification: ['api-test'],
        budget: { max_cost_units: 10, max_duration_ms: 10_000 }, retry_limit: 1,
      },
    ],
  };
  assert.doesNotThrow(() => compileWorkflow(plan([parallel])));

  const partial = structuredClone(parallel);
  partial.dependency_evidence = 'partial';
  assert.throws(() => compileWorkflow(plan([partial])), /requires complete dependency evidence/);

  const overlapping = structuredClone(parallel);
  overlapping.branches[1].allowed_paths = ['src'];
  assert.throws(() => compileWorkflow(plan([overlapping])), /write scopes overlap/);
});

test('evaluator loops are independent and bounded', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const evaluator = {
    id: 'quality',
    kind: 'evaluate-optimize',
    depends_on: [],
    retry_limit: 1,
    generator_role: 'blade',
    evaluator_role: 'ward',
    output_schema: 'evaluation-result-v1',
    expected_artifacts: ['quality.json'],
    budget: {
      max_iterations: 2,
      max_duration_ms: 10_000,
      max_cost_units: 5,
      stuck_failure_limit: 2,
    },
  };
  assert.doesNotThrow(() => compileWorkflow(plan([evaluator])));
  const selfEvaluation = structuredClone(evaluator);
  selfEvaluation.evaluator_role = 'blade';
  assert.throws(() => compileWorkflow(plan([selfEvaluation])), /must be independent/);
  const unbounded = structuredClone(evaluator);
  delete unbounded.budget;
  assert.throws(() => compileWorkflow(plan([unbounded])), /budget: required/);
});

test('fresh v1 schema fails closed on unknown properties and critical direct routing', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const unknown = plan([task('only')]);
  unknown.unsupported_state = {};
  assert.throws(() => compileWorkflow(unknown), /unsupported_state: unsupported property/);
  const unsafe = plan([task('only')]);
  unsafe.route = 'direct';
  unsafe.risk = 'critical';
  assert.throws(() => compileWorkflow(unsafe), /critical-risk work cannot use direct/);
});

test('command capability scope accepts exact argv templates and portable working directories only', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const scoped = plan([{
    ...task('verify'),
    allowed_commands: [['git', 'status', '--short']],
    allowed_cwds: ['.', 'packages/api'],
  }]);
  assert.doesNotThrow(() => compileWorkflow(scoped));

  const commandPath = structuredClone(scoped);
  commandPath.nodes[0].allowed_commands = [['/usr/bin/git', 'status']];
  assert.throws(() => compileWorkflow(commandPath), /executable must be a portable name/);

  const prefixBypass = structuredClone(scoped);
  prefixBypass.nodes[0].allowed_commands = [['node']];
  assert.doesNotThrow(() => compileWorkflow(prefixBypass));

  for (const command of [
    ['env', 'git', 'status'],
    ['bash', '-lc', 'git status'],
    ['node', '--test'],
    ['python', '-m', 'pytest'],
    ['ruby', '-e', 'exit'],
    ['perl', '-e', 'exit'],
    ['git', 'push'],
    ['gh', 'pr', 'view'],
    ['curl', 'https://example.invalid'],
    ['wget', 'https://example.invalid'],
  ]) {
    const sandboxed = structuredClone(scoped);
    sandboxed.nodes[0].allowed_commands = [command];
    assert.doesNotThrow(() => compileWorkflow(sandboxed));
  }

  const escapedCwd = structuredClone(scoped);
  escapedCwd.nodes[0].allowed_cwds = ['../outside'];
  assert.throws(() => compileWorkflow(escapedCwd), /allowed_cwds.*portable relative path/);
});

test('validation entry point includes semantic DAG checks', async () => {
  const { validateWorkflowFile } = await import('../skills/phantom/scripts/validate-workflow.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-workflow-validation-'));
  const file = path.join(directory, 'cycle.json');
  fs.writeFileSync(file, JSON.stringify(plan([task('a', ['b']), task('b', ['a'])])));
  const result = validateWorkflowFile(file);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /dependency cycle/);
});
