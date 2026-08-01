// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FINGERPRINT = `sha256:${'a'.repeat(64)}`;
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const digest = (value) => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
const { publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const profile = {
  profile_id: 'continuous-isolation-v1', platform: 'darwin', backend: 'test-executor',
  backend_digest: FINGERPRINT, filesystem: 'private-root-no-host-writes',
  process: 'contained-and-reaped', tool_plane: 'lease-scoped', artifact_egress: 'digest-bound',
  network: 'denied',
};
const trust = {
  schema_version: 1, trust_kind: 'isolated-executor-trust', generation: 1,
  key_id: 'test-key', source: 'test-executor', public_key: publicKeyPem,
  activated_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z',
  replaces_key_id: null,
};
const EXECUTOR_BINDING = {
  baseline_content_manifest_digest: FINGERPRINT,
  baseline_fingerprint: FINGERPRINT, baseline_physical_topology_root: FINGERPRINT,
  contract_version: 'isolated-branch-executor-v1', executor_id: 'test-executor',
  isolation_profile: profile, key_id: trust.key_id, probe_digest: FINGERPRINT,
  profile_digest: digest(profile), public_key: publicKeyPem,
  public_key_digest: `sha256:${createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex')}`,
  source: trust.source, trust_activated_at: trust.activated_at, trust_digest: digest(trust),
  trust_expires_at: trust.expires_at, trust_generation: trust.generation,
  trust_replaces_key_id: trust.replaces_key_id,
};

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
  schema_version: 2,
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
  ...(nodes.some((node) => node.kind === 'parallel') ? { executor_binding: EXECUTOR_BINDING } : {}),
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
  assert.equal(first.schema_version, 2);
  assert.equal(first.plan.schema_version, 2);
  assert.deepEqual(first.execution_waves, [['inspect'], ['backend', 'frontend'], ['integrate']]);
  assert.deepEqual(first.topological_order, ['inspect', 'backend', 'frontend', 'integrate']);
  assert.equal(first.plan_digest, second.plan_digest);
  assert.deepEqual(first, second);
});

test('compiler preserves Unicode inputs and output across subprocess locales', () => {
  const unicodeTask = {
    ...task('I-task'),
    allowed_paths: [
      'artifacts/ışık.txt', 'artifacts/äther.txt', 'artifacts/zeta.txt',
      'artifacts/İnput.txt', 'artifacts/input.txt',
    ],
    allowed_commands: [
      ['node', 'tool.mjs', 'ı'],
      ['node', 'tool.mjs', 'ä'],
      ['node', 'tool.mjs', 'z'],
      ['node', 'tool.mjs', 'İ'],
      ['node', 'tool.mjs', 'i'],
    ],
    allowed_cwds: ['cwd/ışık', 'cwd/äther', 'cwd/zeta', 'cwd/İnput', 'cwd/input'],
    expected_artifacts: [
      'ışık-output.json', 'äther-output.json', 'z-output.json',
      'İ-output.json', 'i-output.json',
    ],
  };
  const parallel = {
    id: 'parallel',
    kind: 'parallel',
    depends_on: [],
    retry_limit: 1,
    budget: { max_cost_units: 30, max_duration_ms: 30_000 },
    dependency_evidence: 'complete',
    output_schema: 'aggregation-result-v2',
    expected_artifacts: ['résultat-東京.json'],
    verification: ['integration-test'],
    branches: [
      {
        id: 'i-branch', role: 'blade', allowed_paths: ['src/ışık'],
        baseline_fingerprint: FINGERPRINT, dependency_inputs: [],
        expected_artifacts: ['ışık.json'], verification: ['i-test'],
        budget: { max_cost_units: 10, max_duration_ms: 10_000 }, retry_limit: 1,
      },
      {
        id: 'z-branch', role: 'blade', allowed_paths: ['src/äther'],
        baseline_fingerprint: FINGERPRINT, dependency_inputs: [],
        expected_artifacts: ['äther.json'], verification: ['z-test'],
        budget: { max_cost_units: 10, max_duration_ms: 10_000 }, retry_limit: 1,
      },
      {
        id: 'I-branch', role: 'blade', allowed_paths: ['src/東京'],
        baseline_fingerprint: FINGERPRINT, dependency_inputs: [],
        expected_artifacts: ['東京.json'], verification: ['I-test'],
        budget: { max_cost_units: 10, max_duration_ms: 10_000 }, retry_limit: 1,
      },
    ],
  };
  const input = plan([task('z-task'), parallel, task('i-task'), unicodeTask]);
  input.session_binding.repo_id = 'répo-İstanbul-東京';
  input.session_binding.task_id = 'tâche-ışık-東京';

  const kernelUrl = pathToFileURL(path.join(
    __dirname,
    '..',
    'skills',
    'phantom',
    'scripts',
    'lib',
    'workflow-kernel.mjs',
  )).href;
  const childSource = `
    String.prototype.localeCompare = () => {
      throw new Error('localeCompare is forbidden in deterministic workflow compilation');
    };
    const { compileWorkflow } = await import(${JSON.stringify(kernelUrl)});
    const compiled = compileWorkflow(JSON.parse(process.env.PHANTOM_LOCALE_PLAN));
    process.stdout.write(JSON.stringify(compiled));
  `;
  const compiledByLocale = ['en_US', 'sv_SE', 'tr_TR'].map((locale) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        LANG: locale,
        LC_ALL: locale,
        PHANTOM_LOCALE_PLAN: JSON.stringify(input),
      },
      windowsHide: true,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, `${locale}: ${child.stderr || child.stdout}`);
    return JSON.parse(child.stdout);
  });

  for (const compiled of compiledByLocale.slice(1)) {
    assert.equal(compiled.plan_digest, compiledByLocale[0].plan_digest);
    assert.deepEqual(compiled.topological_order, compiledByLocale[0].topological_order);
    assert.deepEqual(compiled.execution_waves, compiledByLocale[0].execution_waves);
    assert.deepEqual(compiled, compiledByLocale[0]);
  }

  const compiled = compiledByLocale[0];
  assert.deepEqual(compiled.topological_order, ['I-task', 'i-task', 'parallel', 'z-task']);
  assert.equal(compiled.plan.session_binding.repo_id, 'répo-İstanbul-東京');
  assert.equal(compiled.plan.session_binding.task_id, 'tâche-ışık-東京');
  const normalizedTask = compiled.plan.nodes.find((node) => node.id === 'I-task');
  assert.deepEqual(normalizedTask.allowed_paths, [
    'artifacts/input.txt', 'artifacts/zeta.txt', 'artifacts/äther.txt',
    'artifacts/İnput.txt', 'artifacts/ışık.txt',
  ]);
  assert.deepEqual(normalizedTask.allowed_cwds, [
    'cwd/input', 'cwd/zeta', 'cwd/äther', 'cwd/İnput', 'cwd/ışık',
  ]);
  assert.deepEqual(normalizedTask.expected_artifacts, [
    'i-output.json', 'z-output.json', 'äther-output.json',
    'İ-output.json', 'ışık-output.json',
  ]);
  assert.deepEqual(normalizedTask.allowed_commands, [
    ['node', 'tool.mjs', 'i'],
    ['node', 'tool.mjs', 'z'],
    ['node', 'tool.mjs', 'ä'],
    ['node', 'tool.mjs', 'İ'],
    ['node', 'tool.mjs', 'ı'],
  ]);
  assert.deepEqual(
    compiled.plan.nodes.find((node) => node.id === 'parallel').branches.map((branch) => branch.id),
    ['I-branch', 'i-branch', 'z-branch'],
  );
});

test('compiler hard-rejects v1 plans and compiled envelopes', async () => {
  const { compileWorkflow, createInitialState } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const legacyPlan = plan([task('only')]);
  legacyPlan.schema_version = 1;
  assert.throws(
    () => compileWorkflow(legacyPlan),
    /unsupported workflow plan contract version 1; expected 2/,
  );

  const legacyCompiled = compileWorkflow(plan([task('only')]));
  legacyCompiled.schema_version = 1;
  assert.throws(
    () => createInitialState(legacyCompiled),
    /unsupported compiled workflow contract version 1; expected 2/,
  );

  const legacyEmbeddedPlan = compileWorkflow(plan([task('only')]));
  legacyEmbeddedPlan.plan.schema_version = 1;
  assert.throws(
    () => createInitialState(legacyEmbeddedPlan),
    /unsupported embedded workflow plan contract version 1; expected 2/,
  );
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
    output_schema: 'aggregation-result-v2',
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
  const oldBinding = plan([parallel]);
  delete oldBinding.executor_binding.baseline_content_manifest_digest;
  assert.throws(
    () => compileWorkflow(oldBinding),
    /baseline_content_manifest_digest: required/,
    'pre-content-manifest executor bindings must not compile',
  );

  const partial = structuredClone(parallel);
  partial.dependency_evidence = 'partial';
  assert.throws(() => compileWorkflow(plan([partial])), /requires complete dependency evidence/);

  const legacyAggregation = structuredClone(parallel);
  legacyAggregation.output_schema = 'aggregation-result-v1';
  assert.throws(() => compileWorkflow(plan([legacyAggregation])), /aggregation-result-v2/);

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

test('fresh v2 schema fails closed on unknown properties and critical direct routing', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const unknown = plan([task('only')]);
  unknown.unsupported_state = {};
  assert.throws(() => compileWorkflow(unknown), /unsupported_state: unsupported property/);
  const unsafe = plan([task('only')]);
  unsafe.route = 'direct';
  unsafe.risk = 'critical';
  assert.throws(() => compileWorkflow(unsafe), /critical-risk work cannot use direct/);
});

test('full routing requires Blade implementation, transitive Ward verification, then Gaze review', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const roleTask = (id, role, dependsOn = []) => ({ ...task(id, dependsOn), role });
  const full = plan([
    roleTask('review', 'gaze', ['review-ready']),
    roleTask('implementation', 'blade'),
    roleTask('verification-ready', 'apex', ['implementation']),
    roleTask('verification', 'ward', ['verification-ready']),
    roleTask('review-ready', 'apex', ['verification']),
  ]);
  full.route = 'full';
  full.risk = 'critical';
  full.session_binding.route = 'full';
  full.routing = {
    recommended_route: 'full', confidence: 1, fallback_route: null, signals: {},
  };

  assert.doesNotThrow(() => compileWorkflow(full));

  const apexOnly = structuredClone(full);
  apexOnly.nodes.find((node) => node.id === 'implementation').role = 'apex';
  assert.throws(
    () => compileWorkflow(apexOnly),
    /full route requires a non-Apex implementation producer/,
  );

  const unorderedVerification = structuredClone(full);
  unorderedVerification.nodes.find((node) => node.id === 'verification').depends_on = [];
  assert.throws(
    () => compileWorkflow(unorderedVerification),
    /Ward verification gate after implementation/,
  );

  const unorderedReview = structuredClone(full);
  unorderedReview.nodes.find((node) => node.id === 'review').depends_on = ['implementation'];
  assert.throws(
    () => compileWorkflow(unorderedReview),
    /Gaze review gate after Ward verification/,
  );
});

test('role topology policy preserves valid direct and plan workflows', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  assert.doesNotThrow(() => compileWorkflow(plan([task('planned-work')])));
  const direct = plan([task('direct-work')]);
  direct.route = 'direct';
  direct.risk = 'low';
  direct.session_binding.route = 'direct';
  direct.session_binding.approved_plan = null;
  direct.routing = {
    recommended_route: 'direct', confidence: 0.95, fallback_route: 'plan', signals: {},
  };
  assert.doesNotThrow(() => compileWorkflow(direct));
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
