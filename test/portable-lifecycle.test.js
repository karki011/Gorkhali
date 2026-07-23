// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const STATE = path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'phantom-state.mjs');
let gateSequence = 0;

function runScript(script, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const run = (args, env) => runScript(STATE, args, env);

function parse(result) {
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-lifecycle-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'neutral-data');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'planning.md'), '# Existing planning context\n');
  return { root, workspace, data, env: { PHANTOM_DATA: data } };
}

async function authorizeAndExecute(context, approvals = []) {
  const common = ['--workspace', context.workspace];
  for (const gate of approvals) {
    await recordApprovalArtifacts(context, gate);
    parse(await run(['approve', ...common, '--gate', gate], context.env));
  }
  parse(await run([
    'authorize', ...common, '--scope', 'implementation',
  ], context.env));
  return parse(await run(['execute', ...common], context.env));
}

async function recordArtifact(context, type, payload, status = 'passed') {
  gateSequence += 1;
  const input = path.join(context.root, `${type}-${gateSequence}.json`);
  fs.writeFileSync(input, JSON.stringify(payload));
  return parse(await run([
    'record',
    '--workspace', context.workspace,
    '--type', type,
    '--status', status,
    '--run', `artifact-${gateSequence}`,
    '--input', input,
  ], context.env));
}

async function recordApprovalArtifacts(context, gate) {
  if (gate === 'direction') {
    await recordArtifact(context, 'brainstorm', portableBrainstorm());
  } else if (gate === 'plan') {
    await recordArtifact(context, 'plan', portablePlan());
  } else {
    await recordArtifact(context, 'decisions', { wiring: 'Use the approved plan dependency order.' });
  }
}

async function recordGate(context, type, status = 'passed') {
  gateSequence += 1;
  const common = ['--workspace', context.workspace];
  const payload = type === 'verification'
    ? { checks: [{ name: 'focused tests', result: 'passed' }] }
    : { verdict: 'pass', findings: [] };
  const input = path.join(context.root, `${type}-${gateSequence}.json`);
  fs.writeFileSync(input, JSON.stringify(payload));
  return parse(await run([
    'record',
    ...common,
    '--type', type,
    '--status', status,
    '--run', `gate-${gateSequence}`,
    '--input', input,
  ], context.env));
}

const portablePlan = () => ({
  contract_version: 3,
  depth: 'quick',
  summary: 'Reviewers need the decision before its execution details. Lead with the researched direction, preserve the compact evidence, and generate the offline review from canonical JSON. The result is a decision-useful review without architecture-grade filler.',
  problem: 'Reviewers need to understand the decision before execution tasks',
  decision: {
    question: 'Use decision-first review output?',
    recommendation: 'Lead with the researched direction',
    rationale: ['It makes approval informed and fast'],
    status: 'pending',
  },
  outcome: { goal: 'A decision-useful review', doneWhen: ['The recommendation precedes tasks'] },
  scope: { in: ['Review output'], out: [], constraints: ['Offline HTML'] },
  scenarios: [],
  evidence: [{
    claim: 'Task-first output hid the rationale',
    source: 'user correction',
    status: 'verified',
    observed_at: '2026-07-19T12:00:00Z',
    confidence: 1,
    conflicts: [],
  }],
  alternatives: [],
  assumptions: [],
  open_questions: [],
  risks: [],
  validation: {
    strategy: 'Render and inspect the saved artifact',
    definitionOfDone: ['Decision-first HTML is generated'],
    checks: ['node --test test/portable-lifecycle.test.js'],
  },
  coverage: [],
  tasks: [{
    id: 'T1',
    description: 'Generate the review',
    action: 'Render the recorded plan envelope',
    read_first: ['planning.md'],
    files: ['plan.html'],
    new_files: ['plan.html'],
    acceptance_criteria: ['Decision brief appears before execution appendix'],
    verify: 'node --test test/portable-lifecycle.test.js',
    profile: 'economy',
  }],
});

const portableApproach = (id, name) => ({
  id,
  name,
  thesis: `${name} thesis`,
  description: `${name} description`,
  whyLens: 'decision clarity',
  effort: 'low',
  risk: 'low',
  reversibility: 'high',
  whatBreaks: ['The review contract must be revised'],
  whenToPick: 'Pick when it best meets the criteria',
});

const portableBrainstorm = () => ({
  contract_version: 3,
  depth: 'quick',
  stance: {
    mode: 'creative-partner',
    reason: 'The user owns the outcome while the agent develops alternatives',
  },
  phase: 'decision',
  decision: {
    question: 'How should review output be organized?',
    outcome: 'Fast informed approval',
    audience: ['Maintainers'],
    nonGoals: [],
    constraints: ['Offline HTML'],
    evaluationCriteria: ['Decision clarity'],
  },
  evidence: [{
    claim: 'Recommendation must lead',
    source: 'user correction',
    status: 'verified',
    observed_at: '2026-07-19T12:00:00Z',
    confidence: 1,
    conflicts: [],
  }],
  openQuestions: [],
  ideas: [
    {
      id: 'I1',
      title: 'Decision-first review',
      summary: 'Lead with the recommendation and evidence',
      lens: 'reviewer',
      technique: 'outcome-backward',
      evidence: ['The recommendation must lead'],
      assumptions: [],
    },
    {
      id: 'I2',
      title: 'Task-first review',
      summary: 'Lead with execution mechanics',
      lens: 'implementer',
      technique: 'simplest-path',
      evidence: ['Tasks are directly actionable'],
      assumptions: [],
    },
  ],
  clusters: [],
  approaches: [portableApproach('decision-first', 'Decision first'), portableApproach('task-first', 'Task first')],
  recommendedDefault: { id: 'decision-first', reason: 'It supports informed approval' },
  shortlist: [
    { approachId: 'decision-first', drivers: ['Decision clarity'], reservation: 'More review structure' },
    { approachId: 'task-first', drivers: ['Speed'], reservation: 'Hides rationale' },
  ],
  cheapestExperiment: {
    question: 'Can the reviewer find the recommendation first?',
    method: 'Render the saved artifact',
    successSignal: 'Recommendation appears before comparison',
    cost: 'One render',
  },
  directionGate: { question: 'Which direction should be used?', options: ['decision-first', 'task-first'] },
});

test('portable lifecycle persists start, pause, resume, evidence, and completion', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];

  const started = parse(await run([
    'start',
    ...common,
    '--task', 'TASK-42',
    '--intent', 'Prove portable state',
    '--route', 'plan',
  ], context.env));
  assert.equal(started.status, 'active');
  assert.equal(started.task_id, 'TASK-42');
  assert.equal(started.route, 'plan');
  assert.equal(started.bundle_version, '2.1.0');
  assert.deepEqual(started.producer, { role: 'apex', compute_profile: 'frontier' });
  const sessionDirectory = path.join(context.data, 'repos', started.repo_id, 'sessions', started.task_id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(sessionDirectory, 'intent.json'))).bundle_version, '2.1.0');

  const paused = parse(await run(['pause', ...common, '--reason', 'Context boundary'], context.env));
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pause_reason, 'Context boundary');

  const sessionFile = path.join(sessionDirectory, 'session.json');
  const legacySession = JSON.parse(fs.readFileSync(sessionFile));
  delete legacySession.bundle_version;
  fs.writeFileSync(sessionFile, JSON.stringify(legacySession));

  const resumed = parse(await run(['resume', ...common], context.env));
  assert.equal(resumed.status, 'active');
  assert.equal(resumed.bundle_version, '2.1.0');
  assert.ok(resumed.resumed_at);
  await authorizeAndExecute(context, ['plan']);

  const evidenceFile = path.join(context.root, 'evidence.json');
  fs.writeFileSync(evidenceFile, JSON.stringify({ checks: [{ name: 'unit', result: 'passed' }] }));
  const recorded = parse(await run([
    'record',
    ...common,
    '--type', 'verification',
    '--status', 'passed',
    '--run', 'run-1',
    '--input', evidenceFile,
    '--actual-profile', 'inherit',
    '--fallback-reason', 'Host inherited its active model',
    '--wall-time-ms', '12.5',
    '--tool-turns', '3',
  ], context.env));
  assert.equal(recorded.artifact.status, 'passed');
  assert.equal(recorded.artifact.bundle_version, '2.1.0');
  assert.deepEqual(recorded.artifact.producer, { role: 'ward', compute_profile: 'economy' });
  assert.deepEqual(recorded.artifact.model_routing, {
    requested_profile: 'economy',
    actual_profile: 'inherit',
    fallback_reason: 'Host inherited its active model',
    outcome: 'passed',
    wall_time_ms: 12.5,
    tool_turns: 3,
  });
  assert.equal(recorded.artifact.evidence.checks[0].result, 'passed');
  assert.ok(fs.existsSync(recorded.file));

  const reviewFile = path.join(context.root, 'review.json');
  fs.writeFileSync(reviewFile, JSON.stringify({ verdict: 'pass', findings: [] }));
  const reviewed = parse(await run([
    'record',
    ...common,
    '--type', 'review',
    '--status', 'passed',
    '--run', 'run-1',
    '--input', reviewFile,
  ], context.env));
  assert.equal(reviewed.artifact.status, 'passed');
  assert.deepEqual(reviewed.artifact.producer, { role: 'gaze', compute_profile: 'deep' });
  assert.deepEqual(reviewed.artifact.model_routing, {
    requested_profile: 'deep',
    actual_profile: null,
    fallback_reason: null,
    outcome: 'passed',
  });

  const completed = parse(await run(['complete', ...common], context.env));
  assert.equal(completed.status, 'completed');

  const status = parse(await run(['status', ...common], context.env));
  assert.equal(status.status, 'completed');
  assert.equal(status.task_id, 'TASK-42');
});

test('portable state defaults to a neutral home directory and honors its override', async () => {
  const context = fixture();
  const isolatedHome = path.join(context.root, 'home');
  fs.mkdirSync(isolatedHome);
  const common = ['--workspace', context.workspace];
  const baseEnv = { HOME: isolatedHome, PHANTOM_DATA: '' };

  parse(await run([
    'start', ...common, '--task', 'HOME-1', '--intent', 'Use neutral home', '--route', 'direct',
  ], baseEnv));
  assert.ok(fs.existsSync(path.join(isolatedHome, '.phantom')));
  assert.equal(fs.existsSync(path.join(isolatedHome, '.claude')), false);
  assert.equal(fs.existsSync(path.join(isolatedHome, '.codex')), false);

  const overrideWorkspace = path.join(context.root, 'override-workspace');
  fs.mkdirSync(overrideWorkspace);
  parse(await run([
    'start',
    '--workspace', overrideWorkspace,
    '--task', 'OVERRIDE-1',
    '--intent', 'Use explicit data root',
    '--route', 'direct',
  ], context.env));
  assert.ok(fs.existsSync(context.data));
});

test('portable lifecycle records brainstorm artifacts and rejects an invalid declared v3 contract', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'BRAIN-1', '--intent', 'Compare approaches', '--route', 'brainstorm',
  ], context.env));

  const brainstormFile = path.join(context.root, 'brainstorm.json');
  fs.writeFileSync(brainstormFile, JSON.stringify(portableBrainstorm()));
  const recorded = parse(await run([
    'record',
    ...common,
    '--type', 'brainstorm',
    '--status', 'pending',
    '--input', brainstormFile,
  ], context.env));
  assert.equal(path.basename(recorded.file), 'brainstorm.json');

  const invalidFile = path.join(context.root, 'invalid-v3-plan.json');
  fs.writeFileSync(invalidFile, JSON.stringify({ contract_version: 3 }));
  const invalid = await run([
    'record',
    ...common,
    '--type', 'plan',
    '--status', 'pending',
    '--input', invalidFile,
  ], context.env);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /Invalid plan decision contract/);

  const unsupportedFile = path.join(context.root, 'unsupported-v4-plan.json');
  fs.writeFileSync(unsupportedFile, JSON.stringify({ contract_version: 4 }));
  const unsupported = await run([
    'record',
    ...common,
    '--type', 'plan',
    '--status', 'pending',
    '--input', unsupportedFile,
  ], context.env);
  assert.equal(unsupported.code, 1);
  assert.match(unsupported.stderr, /unsupported version/);
});

test('canonical plan and brainstorm writes require a declared v3 contract', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'V3-REQUIRED', '--intent', 'Reject empty decisions', '--route', 'plan',
  ], context.env));
  const empty = path.join(context.root, 'empty.json');
  fs.writeFileSync(empty, '{}');

  for (const type of ['plan', 'brainstorm']) {
    const result = await run([
      'record', ...common, '--type', type, '--status', 'passed', '--input', empty,
    ], context.env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /contract_version: required and must be 3/);
  }
});

test('state recording enforces canonical quick plans and workspace path provenance', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'PLAN-1', '--intent', 'Persist a safe quick plan', '--route', 'plan',
  ], context.env));

  const recordPlan = async (name, mutate = () => {}) => {
    const payload = portablePlan();
    mutate(payload);
    const input = path.join(context.root, `${name}.json`);
    fs.writeFileSync(input, JSON.stringify(payload));
    return run([
      'record', ...common, '--type', 'plan', '--status', 'pending', '--input', input,
    ], context.env);
  };

  parse(await recordPlan('canonical'));

  const noncanonical = await recordPlan('noncanonical', (plan) => {
    plan.solution_shape = { summary: 'Unneeded quick architecture', components: ['renderer'], dataFlow: ['JSON'] };
  });
  assert.equal(noncanonical.code, 1);
  assert.match(noncanonical.stderr, /solution_shape: omit for quick plans/);

  const missingRead = await recordPlan('missing-read', (plan) => {
    plan.tasks[0].read_first = ['missing.md'];
  });
  assert.equal(missingRead.code, 1);
  assert.match(missingRead.stderr, /read_first\[0\]: path does not exist in the workspace/);

  const undeclaredNew = await recordPlan('undeclared-new', (plan) => {
    plan.tasks[0].new_files = [];
  });
  assert.equal(undeclaredNew.code, 1);
  assert.match(undeclaredNew.stderr, /files\[0\]: path does not exist in the workspace/);

  fs.writeFileSync(path.join(context.workspace, 'plan.html'), 'already present');
  const existingNew = await recordPlan('existing-new');
  assert.equal(existingNew.code, 1);
  assert.match(existingNew.stderr, /new_files\[0\]: declared new path already exists/);
});

test('saved v3 plan and brainstorm envelopes persist without a bundled renderer', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'REVIEW-1', '--intent', 'Persist saved decision artifacts', '--route', 'brainstorm',
  ], context.env));

  for (const [type, payload] of [
    ['plan', portablePlan()],
    ['brainstorm', portableBrainstorm()],
  ]) {
    const input = path.join(context.root, `${type}-v3.json`);
    fs.writeFileSync(input, JSON.stringify(payload));
    const recorded = parse(await run([
      'record', ...common, '--type', type, '--status', 'pending', '--input', input,
    ], context.env));
    const envelope = JSON.parse(fs.readFileSync(recorded.file, 'utf8'));
    assert.deepEqual(envelope.evidence, payload);
    assert.equal(fs.existsSync(path.join(context.root, `${type}-v3.html`)), false);
  }
  assert.equal(fs.existsSync(path.join(path.dirname(STATE), 'render-review.mjs')), false);
});

test('enriched v3 artifacts survive state persistence without renderer-specific output', async () => {
  const context = fixture();
  context.workspace = path.join(__dirname, '..');
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'RICH-1', '--intent', 'Preserve enriched review artifacts', '--route', 'brainstorm',
  ], context.env));

  for (const type of ['plan', 'brainstorm']) {
    const source = path.join(__dirname, 'fixtures', 'decision-first', `${type}-v3-rich.json`);
    const expected = JSON.parse(fs.readFileSync(source, 'utf8'));
    expected.evidence = expected.evidence.map((item) => ({
      ...item,
      observed_at: '2026-07-19T12:00:00Z',
      confidence: item.status === 'unknown' ? 0 : 0.9,
      conflicts: [],
    }));
    const input = path.join(context.root, `${type}-v3-rich.json`);
    fs.writeFileSync(input, JSON.stringify(expected));
    const recorded = parse(await run([
      'record', ...common, '--type', type, '--status', 'pending', '--input', input,
    ], context.env));
    const envelope = JSON.parse(fs.readFileSync(recorded.file, 'utf8'));
    assert.equal(envelope.schema_version, 1);
    assert.deepEqual(envelope.evidence, expected);

    assert.match(JSON.stringify(envelope.evidence), new RegExp(expected.title));
    assert.equal(fs.existsSync(path.join(context.root, `${type}-rich.html`)), false);
  }
});

test('concurrent artifact writes remain complete JSON and leave no temporary files', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'RACE-1', '--intent', 'Exercise atomic writes', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  const evidence = path.join(context.root, 'verification.json');
  fs.writeFileSync(evidence, JSON.stringify({ checks: [{ name: 'unit', result: 'passed' }] }));

  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => run([
    'record',
    ...common,
    '--type', 'verification',
    '--status', 'passed',
    '--run', 'shared-run',
    '--input', evidence,
  ], { ...context.env, PHANTOM_WRITER: String(index) })));
  for (const result of results) parse(result);

  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory)) {
      const file = path.join(directory, entry);
      if (fs.statSync(file).isDirectory()) visit(file);
      else files.push(file);
    }
  };
  visit(context.data);
  assert.deepEqual(files.filter((file) => file.includes('.tmp-')), []);
  for (const file of files.filter((candidate) => candidate.endsWith('.json'))) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')));
  }
});

test('mutating lifecycle commands fail clearly without an active session', async () => {
  const context = fixture();
  const result = await run(['pause', '--workspace', context.workspace], context.env);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /No active Phantom session/);
});

test('completion is blocked until verification and review pass', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'GATE-1', '--intent', 'Enforce completion gates', '--route', 'plan',
  ], context.env));

  const result = await run(['complete', ...common], context.env);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /execution has not started/);

  const status = parse(await run(['status', ...common], context.env));
  assert.equal(status.status, 'active');
});

test('record rejects undocumented statuses and empty passed gate evidence', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'EVIDENCE-1', '--intent', 'Validate gate evidence', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  parse(await run(['verify', ...common], context.env));

  const unsupported = await run([
    'record', ...common, '--type', 'context', '--status', 'totally-invalid',
  ], context.env);
  assert.equal(unsupported.code, 1);
  assert.match(unsupported.stderr, /Unsupported artifact status/);

  for (const type of ['verification', 'review']) {
    const empty = await run([
      'record', ...common, '--type', type, '--status', 'passed', '--run', `empty-${type}`,
    ], context.env);
    assert.equal(empty.code, 1);
    assert.match(empty.stderr, new RegExp(`Invalid passed ${type} evidence`));
  }
});

test('record validates provider-neutral routing diagnostics', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'ROUTING-1', '--intent', 'Validate routing diagnostics', '--route', 'direct',
  ], context.env));

  for (const [label, args, message] of [
    ['profile', ['--actual-profile', 'unknown'], /Unknown actual model profile/],
    ['wall-time', ['--wall-time-ms', '-1'], /wall-time-ms must be a non-negative/],
    ['tool-turns', ['--tool-turns', '1.5'], /tool-turns must be a non-negative integer/],
  ]) {
    const result = await run([
      'record', ...common, '--type', 'context', '--status', 'pending', '--run', label, ...args,
    ], context.env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, message);
  }
});

test('state records validated delegation task and result contracts', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'DELEGATE-1', '--intent', 'Persist delegation contracts', '--route', 'direct',
  ], context.env));

  const taskFile = path.join(context.root, 'delegation-task.json');
  fs.writeFileSync(taskFile, JSON.stringify({
    contract_version: 1,
    task_id: 'D1',
    role: 'blade',
    objective: 'Implement the bounded task',
    profile: 'balanced',
    requires_judgment: false,
    inputs: {},
    context_refs: [{ id: 'plan', kind: 'artifact', ref: 'plan.json' }],
    constraints: ['Preserve unrelated work'],
    deliverables: ['Focused patch'],
    acceptance_criteria: ['Focused checks pass'],
    write_scope: ['target.js'],
  }));
  const task = parse(await run([
    'record', ...common, '--type', 'delegation-task', '--status', 'pending', '--run', 'D1', '--input', taskFile,
  ], context.env));
  assert.equal(task.artifact.artifact_type, 'delegation-task');
  assert.equal(task.artifact.bundle_version, '2.1.0');
  assert.deepEqual(task.artifact.producer, { role: 'blade', compute_profile: 'balanced' });
  assert.equal(task.artifact.model_routing.requested_profile, 'balanced');
  assert.equal(task.artifact.model_routing.actual_profile, null);

  const resultFile = path.join(context.root, 'delegation-result.json');
  fs.writeFileSync(resultFile, JSON.stringify({
    contract_version: 1,
    task_id: 'D1',
    status: 'ok',
    output: { summary: 'Focused patch complete' },
    error: null,
  }));
  const result = parse(await run([
    'record', ...common, '--type', 'delegation-result', '--status', 'passed', '--run', 'D1', '--input', resultFile,
  ], context.env));
  assert.equal(result.artifact.artifact_type, 'delegation-result');
  assert.deepEqual(result.artifact.producer, { role: 'blade', compute_profile: 'balanced' });
  assert.equal(result.artifact.model_routing.requested_profile, 'balanced');
  assert.equal(result.artifact.model_routing.outcome, 'passed');

  fs.writeFileSync(resultFile, JSON.stringify({
    contract_version: 1,
    task_id: 'D1',
    status: 'error',
    output: null,
    error: { code: 'CHECK_FAILED', message: 'Verification failed', retryable: false },
  }));
  const contradictory = await run([
    'record', ...common, '--type', 'delegation-result', '--status', 'passed', '--run', 'D1', '--input', resultFile,
  ], context.env);
  assert.equal(contradictory.code, 1);
  assert.match(contradictory.stderr, /status error is inconsistent with artifact status passed/);
  const failed = parse(await run([
    'record', ...common, '--type', 'delegation-result', '--status', 'failed', '--run', 'D1', '--input', resultFile,
  ], context.env));
  assert.equal(failed.artifact.model_routing.outcome, 'failed');

  fs.writeFileSync(resultFile, JSON.stringify({
    contract_version: 1,
    task_id: 'D1',
    status: 'ok',
    output: { summary: 'Focused patch complete' },
    error: null,
  }));
  const overridden = parse(await run([
    'record', ...common, '--type', 'delegation-result', '--status', 'passed', '--run', 'D1', '--input', resultFile,
    '--role', 'apex', '--profile', 'economy',
  ], context.env));
  assert.deepEqual(overridden.artifact.producer, { role: 'apex', compute_profile: 'frontier' });
  assert.equal(overridden.artifact.model_routing.requested_profile, 'frontier');

  fs.writeFileSync(resultFile, JSON.stringify({
    contract_version: 1,
    task_id: 'DIFFERENT',
    status: 'ok',
    output: { summary: 'Wrong task' },
    error: null,
  }));
  const mismatched = await run([
    'record', ...common, '--type', 'delegation-result', '--status', 'passed', '--run', 'D1', '--input', resultFile,
  ], context.env);
  assert.equal(mismatched.code, 1);
  assert.match(mismatched.stderr, /task_id must match/);

  fs.writeFileSync(taskFile, JSON.stringify({ contract_version: 1, task_id: 'D2' }));
  const invalid = await run([
    'record', ...common, '--type', 'delegation-task', '--status', 'pending', '--run', 'D2', '--input', taskFile,
  ], context.env);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /Invalid delegation-task contract/);
});

test('completion revalidates persisted gate evidence and envelope identity', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'TAMPER-1', '--intent', 'Reject tampered gates', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);

  const verificationInput = path.join(context.root, 'verification.json');
  const reviewInput = path.join(context.root, 'review.json');
  fs.writeFileSync(verificationInput, JSON.stringify({ checks: [{ name: 'unit', result: 'passed' }] }));
  fs.writeFileSync(reviewInput, JSON.stringify({ verdict: 'pass', findings: [] }));
  const verification = parse(await run([
    'record', ...common, '--type', 'verification', '--status', 'passed', '--run', 'tamper', '--input', verificationInput,
  ], context.env));
  parse(await run([
    'record', ...common, '--type', 'review', '--status', 'passed', '--run', 'tamper', '--input', reviewInput,
  ], context.env));

  const artifact = JSON.parse(fs.readFileSync(verification.file, 'utf8'));
  artifact.evidence = {};
  fs.writeFileSync(verification.file, JSON.stringify(artifact));
  const completed = await run(['complete', ...common], context.env);
  assert.equal(completed.code, 1);
  assert.match(completed.stderr, /Passed verification evidence requires at least one check/);
});

test('a newer failed gate overrides an older passed gate', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'LATEST-1', '--intent', 'Honor the latest gate', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);

  const verificationInput = path.join(context.root, 'verification.json');
  const reviewInput = path.join(context.root, 'review.json');
  fs.writeFileSync(verificationInput, JSON.stringify({ checks: [{ name: 'unit', result: 'passed' }] }));
  fs.writeFileSync(reviewInput, JSON.stringify({ verdict: 'pass', findings: [] }));
  const older = parse(await run([
    'record', ...common, '--type', 'verification', '--status', 'passed', '--run', 'zzz-older', '--input', verificationInput,
  ], context.env));
  parse(await run([
    'record', ...common, '--type', 'review', '--status', 'passed', '--run', 'review', '--input', reviewInput,
  ], context.env));
  const newer = parse(await run([
    'record', ...common, '--type', 'verification', '--status', 'failed', '--run', 'aaa-newer',
  ], context.env));

  assert.ok(newer.artifact.record_sequence > older.artifact.record_sequence);
  for (const recorded of [older, newer]) {
    const artifact = JSON.parse(fs.readFileSync(recorded.file, 'utf8'));
    artifact.updated_at = '2026-01-01T00:00:00.000Z';
    fs.writeFileSync(recorded.file, JSON.stringify(artifact));
  }
  const completed = await run(['complete', ...common], context.env);
  assert.equal(completed.code, 1);
  assert.match(completed.stderr, /verification artifact is not passed/);
});

test('route-specific execution gates fail actionably and pass after required approvals', async () => {
  for (const scenario of [
    { route: 'direct', approvals: [], missing: null },
    { route: 'plan', approvals: ['plan'], missing: /plan approval is missing.*approve --gate plan/s },
    {
      route: 'brainstorm',
      approvals: ['direction', 'plan'],
      missing: /direction approval is missing.*approve --gate direction/s,
    },
    {
      route: 'full',
      approvals: ['direction', 'plan', 'wiring'],
      missing: /direction approval is missing.*approve --gate direction/s,
    },
  ]) {
    const context = fixture();
    const common = ['--workspace', context.workspace];
    parse(await run([
      'start',
      ...common,
      '--task', `ROUTE-${scenario.route}`,
      '--intent', `Exercise ${scenario.route}`,
      '--route', scenario.route,
    ], context.env));

    const unauthorized = await run(['execute', ...common], context.env);
    assert.equal(unauthorized.code, 1);
    assert.match(
      unauthorized.stderr,
      /implementation authorization is missing.*authorize --scope implementation/s,
    );
    parse(await run([
      'authorize', ...common, '--scope', 'implementation',
    ], context.env));

    if (scenario.missing) {
      const unapproved = await run(['execute', ...common], context.env);
      assert.equal(unapproved.code, 1);
      assert.match(unapproved.stderr, scenario.missing);
    }
    for (const gate of scenario.approvals) {
      if (gate === 'plan' && ['brainstorm', 'full'].includes(scenario.route)) {
        const beforeDirection = fixture();
        const beforeCommon = ['--workspace', beforeDirection.workspace];
        parse(await run([
          'start',
          ...beforeCommon,
          '--task', `ORDER-${scenario.route}`,
          '--intent', 'Exercise approval order',
          '--route', scenario.route,
        ], beforeDirection.env));
        const outOfOrder = await run([
          'approve', ...beforeCommon, '--gate', 'plan',
        ], beforeDirection.env);
        assert.equal(outOfOrder.code, 1);
        assert.match(outOfOrder.stderr, /direction approval is missing.*approve --gate direction/s);
      }
      await recordApprovalArtifacts(context, gate);
      parse(await run(['approve', ...common, '--gate', gate], context.env));
    }
    const executed = parse(await run(['execute', ...common], context.env));
    assert.equal(executed.lifecycle.actions.execute.status, 'started');
  }
});

test('implementation and draft-PR shipping authorizations remain separate', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'AUTH-1', '--intent', 'Separate authorities', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  await recordGate(context, 'verification');
  await recordGate(context, 'review');

  const unauthorizedShip = await run(['ship', ...common], context.env);
  assert.equal(unauthorizedShip.code, 1);
  assert.match(
    unauthorizedShip.stderr,
    /draft-PR shipping authorization is missing.*authorize --scope ship-draft-pr/s,
  );
  parse(await run([
    'authorize', ...common, '--scope', 'ship-draft-pr',
  ], context.env));
  const ready = parse(await run(['ship', ...common], context.env));
  assert.equal(ready.lifecycle.actions.ship.status, 'ready');
});

test('to-plan sessions permanently deny execute and ship even after authorization', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start',
    ...common,
    '--task', 'PLAN-ONLY',
    '--intent', 'Produce a plan only',
    '--route', 'plan',
    '--mode', 'to-plan',
  ], context.env));
  for (const scope of ['implementation', 'ship-draft-pr']) {
    parse(await run(['authorize', ...common, '--scope', scope], context.env));
  }
  for (const action of ['execute', 'ship']) {
    const denied = await run([action, ...common], context.env);
    assert.equal(denied.code, 1);
    assert.match(denied.stderr, /permanently plan-only/);
  }

  parse(await run([
    'start',
    ...common,
    '--task', 'PLAN-ONLY',
    '--intent', 'Produce a plan only',
    '--route', 'plan',
    '--mode', 'standard',
  ], context.env));
  const stillDenied = await run(['execute', ...common], context.env);
  assert.equal(stillDenied.code, 1);
  assert.match(stillDenied.stderr, /permanently plan-only/);
});

test('matching start preserves legacy top-level plan-only mode fields', async () => {
  for (const [label, legacyMode] of [
    ['mode', { mode: 'to-plan' }],
    ['to-plan-flag', { to_plan: true }],
  ]) {
    const context = fixture();
    const common = ['--workspace', context.workspace];
    const intent = `Preserve legacy ${label}`;
    const started = parse(await run([
      'start', ...common, '--task', `LEGACY-${label}`, '--intent', intent, '--route', 'direct',
    ], context.env));
    const sessionFile = path.join(
      context.data,
      'repos',
      started.repo_id,
      'sessions',
      started.task_id,
      'session.json',
    );
    const legacy = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    delete legacy.lifecycle;
    Object.assign(legacy, legacyMode);
    fs.writeFileSync(sessionFile, JSON.stringify(legacy));

    const resumed = parse(await run([
      'start', ...common, '--task', `LEGACY-${label}`, '--intent', intent, '--route', 'direct',
    ], context.env));
    assert.equal(resumed.lifecycle.mode, 'to-plan');
    for (const scope of ['implementation', 'ship-draft-pr']) {
      parse(await run(['authorize', ...common, '--scope', scope], context.env));
    }
    for (const action of ['execute', 'ship']) {
      const denied = await run([action, ...common], context.env);
      assert.equal(denied.code, 1);
      assert.match(denied.stderr, /permanently plan-only/);
    }
  }
});

test('shipping and completion reject stale or superseded worktree evidence', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'FRESH-1', '--intent', 'Bind quality evidence', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  parse(await run([
    'authorize', ...common, '--scope', 'ship-draft-pr',
  ], context.env));
  const verified = await recordGate(context, 'verification');
  const reviewed = await recordGate(context, 'review');
  assert.match(verified.artifact.worktree_fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(reviewed.artifact.worktree_fingerprint, verified.artifact.worktree_fingerprint);

  fs.appendFileSync(path.join(context.workspace, 'planning.md'), 'Changed after review\n');
  for (const action of ['ship', 'complete']) {
    const stale = await run([action, ...common], context.env);
    assert.equal(stale.code, 1);
    assert.match(stale.stderr, /verification artifact is stale for the current worktree/);
  }

  await recordGate(context, 'verification');
  const staleReview = await run(['ship', ...common], context.env);
  assert.equal(staleReview.code, 1);
  assert.match(staleReview.stderr, /review artifact is stale for the current worktree/);
  await recordGate(context, 'review');
  assert.equal(parse(await run(['ship', ...common], context.env)).lifecycle.actions.ship.status, 'ready');

  await recordGate(context, 'verification', 'failed');
  const rejectedReviewInput = path.join(context.root, 'review-after-failed-verification.json');
  fs.writeFileSync(rejectedReviewInput, JSON.stringify({ verdict: 'pass', findings: [] }));
  const rejectedReview = await run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'review-after-failed-verification',
    '--input', rejectedReviewInput,
  ], context.env);
  assert.equal(rejectedReview.code, 1);
  assert.match(rejectedReview.stderr, /verification artifact is not passed/);
  const superseded = await run(['ship', ...common], context.env);
  assert.equal(superseded.code, 1);
  assert.match(superseded.stderr, /verification artifact is not passed/);
});

test('older sessions recover lifecycle defaults and identify the next command', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start', ...common, '--task', 'LEGACY-1', '--intent', 'Recover old state', '--route', 'direct',
  ], context.env));
  const sessionFile = path.join(
    context.data,
    'repos',
    started.repo_id,
    'sessions',
    started.task_id,
    'session.json',
  );
  const legacy = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  delete legacy.lifecycle;
  delete legacy.route;
  fs.writeFileSync(sessionFile, JSON.stringify(legacy));

  const recovered = parse(await run(['status', ...common], context.env));
  assert.equal(recovered.lifecycle.mode, 'standard');
  assert.equal(recovered.lifecycle.authorizations.implementation.status, 'pending');
  const blocked = await run(['execute', ...common], context.env);
  assert.equal(blocked.code, 1);
  assert.match(
    blocked.stderr,
    /implementation authorization is missing.*phantom-state\.mjs authorize --scope implementation/s,
  );
  parse(await run([
    'authorize', ...common, '--scope', 'implementation',
  ], context.env));
  const unrouted = await run(['execute', ...common], context.env);
  assert.equal(unrouted.code, 1);
  assert.match(unrouted.stderr, /recovered session has no supported route.*start --task <id>/s);
  parse(await run([
    'start',
    ...common,
    '--task', 'LEGACY-1',
    '--intent', 'Recover old state',
    '--route', 'direct',
  ], context.env));
  assert.equal(parse(await run(['execute', ...common], context.env)).lifecycle.actions.execute.status, 'started');
});

test('new decision artifacts invalidate approvals that depended on older content', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'REPLAN-1', '--intent', 'Require reapproval', '--route', 'plan',
  ], context.env));
  const input = path.join(context.root, 'replan.json');
  fs.writeFileSync(input, JSON.stringify(portablePlan()));
  parse(await run([
    'record', ...common, '--type', 'plan', '--status', 'passed', '--input', input,
  ], context.env));
  parse(await run(['approve', ...common, '--gate', 'plan'], context.env));
  parse(await run([
    'record', ...common, '--type', 'plan', '--status', 'passed', '--input', input,
  ], context.env));
  parse(await run([
    'authorize', ...common, '--scope', 'implementation',
  ], context.env));

  const blocked = await run(['execute', ...common], context.env);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /plan approval is missing.*approve --gate plan/s);
});

test('starting a different task does not orphan the current active session', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'FIRST', '--intent', 'Keep this task current', '--route', 'plan',
  ], context.env));

  const second = await run([
    'start', ...common, '--task', 'SECOND', '--intent', 'Do not orphan the first task', '--route', 'direct',
  ], context.env);
  assert.equal(second.code, 1);
  assert.match(second.stderr, /Cannot start task SECOND while current task FIRST is active/);
  assert.equal(parse(await run(['status', ...common], context.env)).task_id, 'FIRST');
});

test('same-task restarts preserve immutable route and material intent', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'IMMUTABLE-1', '--intent', 'Preserve this intent', '--route', 'plan',
  ], context.env));

  for (const [args, expected] of [
    [['--intent', 'Preserve this intent', '--route', 'direct'], /Cannot change route.*revision.*restart/s],
    [['--intent', 'A materially different intent', '--route', 'plan'], /Cannot change material intent.*revision.*restart/s],
  ]) {
    const result = await run(['start', ...common, '--task', 'IMMUTABLE-1', ...args], context.env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, expected);
  }

  const status = parse(await run(['status', ...common], context.env));
  assert.equal(status.route, 'plan');
  assert.equal(status.intent_summary, 'Preserve this intent');
});

test('approvals require and remain bound to current passed decision artifacts', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'BOUND-1', '--intent', 'Bind approval', '--route', 'plan',
  ], context.env));

  const missing = await run(['approve', ...common, '--gate', 'plan'], context.env);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /current passed plan artifact is missing.*fresh passed plan artifact/s);

  const plan = await recordArtifact(context, 'plan', portablePlan());
  const approved = parse(await run(['approve', ...common, '--gate', 'plan'], context.env));
  assert.deepEqual(approved.lifecycle.approvals.plan.artifact_bindings, [{
    artifact_type: 'plan',
    record_sequence: plan.artifact.record_sequence,
    digest: approved.lifecycle.approvals.plan.artifact_bindings[0].digest,
  }]);
  assert.match(approved.lifecycle.approvals.plan.artifact_bindings[0].digest, /^sha256:[a-f0-9]{64}$/);

  const artifact = JSON.parse(fs.readFileSync(plan.file, 'utf8'));
  artifact.evidence.summary = `${artifact.evidence.summary} Changed after approval.`;
  fs.writeFileSync(plan.file, JSON.stringify(artifact));
  parse(await run(['authorize', ...common, '--scope', 'implementation'], context.env));
  const stale = await run(['execute', ...common], context.env);
  assert.equal(stale.code, 1);
  assert.match(stale.stderr, /plan approval is stale.*approve --gate plan/s);
});

test('wiring approval explicitly binds the current passed plan and decisions artifacts', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'WIRING-1', '--intent', 'Bind wiring', '--route', 'full',
  ], context.env));
  await recordApprovalArtifacts(context, 'direction');
  parse(await run(['approve', ...common, '--gate', 'direction'], context.env));
  await recordApprovalArtifacts(context, 'plan');
  parse(await run(['approve', ...common, '--gate', 'plan'], context.env));

  const missing = await run(['approve', ...common, '--gate', 'wiring'], context.env);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /current passed decisions artifact is missing/);
  await recordApprovalArtifacts(context, 'wiring');
  const approved = parse(await run(['approve', ...common, '--gate', 'wiring'], context.env));
  assert.deepEqual(
    approved.lifecycle.approvals.wiring.artifact_bindings.map((binding) => binding.artifact_type),
    ['plan', 'decisions'],
  );
});

test('record failures do not advance execution or verification lifecycle state', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'ATOMIC-1', '--intent', 'Keep failed records atomic', '--route', 'direct',
  ], context.env));
  parse(await run(['authorize', ...common, '--scope', 'implementation'], context.env));

  for (const args of [
    ['--actual-profile', 'unknown'],
    ['--wall-time-ms', '-1'],
    ['--tool-turns', '1.5'],
  ]) {
    const failed = await run([
      'record', ...common, '--type', 'execution', '--status', 'pending', ...args,
    ], context.env);
    assert.equal(failed.code, 1);
    assert.equal(parse(await run(['status', ...common], context.env)).lifecycle.actions.execute.status, 'pending');
  }

  parse(await run(['execute', ...common], context.env));
  const verificationInput = path.join(context.root, 'atomic-verification.json');
  fs.writeFileSync(verificationInput, JSON.stringify({
    checks: [{ name: 'atomic persistence', result: 'passed' }],
  }));
  const runDirectory = path.join(
    context.data,
    'repos',
    parse(await run(['status', ...common], context.env)).repo_id,
    'sessions',
    'ATOMIC-1',
    'runs',
  );
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(path.join(runDirectory, 'write-failure'), 'blocks artifact directory creation');
  const writeFailure = await run([
    'record', ...common, '--type', 'verification', '--status', 'passed',
    '--run', 'write-failure', '--input', verificationInput,
  ], context.env);
  assert.equal(writeFailure.code, 1);
  assert.equal(parse(await run(['status', ...common], context.env)).lifecycle.actions.verify.status, 'pending');

  if (process.platform !== 'win32') {
    const pointerDirectory = path.join(context.data, 'state', 'current-session');
    const partialArtifact = path.join(runDirectory, 'state-write-failure', 'verification.json');
    fs.chmodSync(pointerDirectory, 0o555);
    let stateWriteFailure;
    try {
      stateWriteFailure = await run([
        'record', ...common, '--type', 'verification', '--status', 'passed',
        '--run', 'state-write-failure', '--input', verificationInput,
      ], context.env);
    } finally {
      fs.chmodSync(pointerDirectory, 0o755);
    }
    assert.equal(stateWriteFailure.code, 1);
    assert.equal(fs.existsSync(partialArtifact), false);
    assert.equal(parse(await run(['status', ...common], context.env)).lifecycle.actions.verify.status, 'pending');
  }
});

test('review requires current passed verification and becomes stale after later verification', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'ORDERED-1', '--intent', 'Order quality gates', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  parse(await run(['verify', ...common], context.env));
  const reviewInput = path.join(context.root, 'ordered-review.json');
  fs.writeFileSync(reviewInput, JSON.stringify({ verdict: 'pass', findings: [] }));
  const premature = await run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'premature', '--input', reviewInput,
  ], context.env);
  assert.equal(premature.code, 1);
  assert.match(premature.stderr, /current passed verification artifact is missing/);

  const verification = await recordGate(context, 'verification');
  const review = await recordGate(context, 'review');
  assert.ok(review.artifact.record_sequence > verification.artifact.record_sequence);
  await recordGate(context, 'verification');
  const stale = await run(['complete', ...common], context.env);
  assert.equal(stale.code, 1);
  assert.match(stale.stderr, /authoritative review must be newer.*fresh review after verification/s);
});

test('worktree fingerprints include index metadata, file state, untracked content, and dangling links', async () => {
  const context = fixture();
  const git = (...args) => execFileSync('git', ['-C', context.workspace, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  git('init');
  git('config', 'user.name', 'Subash Karki');
  git('config', 'user.email', 'subash@example.com');
  git('add', 'planning.md');
  git('commit', '-m', 'fixture');
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'FINGERPRINT-1', '--intent', 'Cover worktree state', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  const baseline = await recordGate(context, 'verification');

  fs.writeFileSync(path.join(context.workspace, 'planning.md'), 'staged-only content\n');
  git('add', 'planning.md');
  fs.writeFileSync(path.join(context.workspace, 'planning.md'), '# Existing planning context\n');
  const stagedOnly = await recordGate(context, 'verification');
  assert.notEqual(stagedOnly.artifact.worktree_fingerprint, baseline.artifact.worktree_fingerprint);

  git('reset', '--', 'planning.md');
  if (process.platform !== 'win32') {
    fs.chmodSync(path.join(context.workspace, 'planning.md'), 0o755);
    const executable = await recordGate(context, 'verification');
    assert.notEqual(executable.artifact.worktree_fingerprint, baseline.artifact.worktree_fingerprint);
    fs.chmodSync(path.join(context.workspace, 'planning.md'), 0o644);
  }

  fs.unlinkSync(path.join(context.workspace, 'planning.md'));
  const deleted = await recordGate(context, 'verification');
  assert.notEqual(deleted.artifact.worktree_fingerprint, baseline.artifact.worktree_fingerprint);
  fs.writeFileSync(path.join(context.workspace, 'planning.md'), '# Existing planning context\n');

  fs.writeFileSync(path.join(context.workspace, 'untracked.txt'), 'untracked content\n');
  const untracked = await recordGate(context, 'verification');
  assert.notEqual(untracked.artifact.worktree_fingerprint, baseline.artifact.worktree_fingerprint);
  fs.unlinkSync(path.join(context.workspace, 'untracked.txt'));

  if (process.platform !== 'win32') {
    fs.symlinkSync('missing-target', path.join(context.workspace, 'dangling-link'));
    const dangling = await recordGate(context, 'verification');
    assert.notEqual(dangling.artifact.worktree_fingerprint, baseline.artifact.worktree_fingerprint);
  }

  const beforeGitlink = await recordGate(context, 'verification');
  const head = git('rev-parse', 'HEAD').toString('utf8').trim();
  git('update-index', '--add', '--cacheinfo', `160000,${head},vendor/submodule`);
  const gitlink = await recordGate(context, 'verification');
  assert.notEqual(gitlink.artifact.worktree_fingerprint, beforeGitlink.artifact.worktree_fingerprint);
});

test('lifecycle lock blocks concurrent owners and recovers after a dead owner', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start', ...common, '--task', 'LOCK-1', '--intent', 'Exercise lifecycle locking', '--route', 'direct',
  ], context.env));
  const locks = path.join(context.data, 'locks');
  const lock = path.join(locks, `${started.repo_id}.lock`);
  fs.mkdirSync(locks, { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'active', created_at: new Date().toISOString() }));

  const blocked = await run(['pause', ...common], context.env);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /lifecycle mutation is already in progress/);

  fs.writeFileSync(lock, JSON.stringify({ pid: 2_147_483_647, token: 'stale', created_at: '2000-01-01T00:00:00.000Z' }));
  fs.writeFileSync(`${lock}.recovery`, JSON.stringify({
    pid: 2_147_483_647,
    created_at: '2000-01-01T00:00:00.000Z',
  }));
  const paused = parse(await run(['pause', ...common], context.env));
  assert.equal(paused.status, 'paused');
  assert.equal(fs.existsSync(lock), false);
  assert.equal(fs.existsSync(`${lock}.recovery`), false);
});
