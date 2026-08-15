// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const STATE = path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'phantom-state.mjs');
const DECISION_CONTRACTS = path.join(
  __dirname,
  '..',
  'skills',
  'phantom',
  'scripts',
  'lib',
  'decision-contracts.mjs',
);
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

const run = (args, env) => runScript(STATE, [...args, '--json'], env);

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

function treeSnapshot(root) {
  const snapshot = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else snapshot[path.relative(root, file)] = fs.readFileSync(file).toString('base64');
    }
  };
  visit(root);
  return snapshot;
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

async function recordGazeDelegation(
  context,
  runId,
  { classificationStatuses = ['passed'] } = {},
) {
  const { delegationTaskDigest } = await import(pathToFileURL(DECISION_CONTRACTS).href);
  const common = ['--workspace', context.workspace];
  const task = {
    contract_version: 2,
    task_id: `gaze-${runId}`,
    delegation_id: `gaze-${runId}-attempt-1`,
    role: 'gaze',
    profile: 'deep',
    risk: 'moderate',
    requires_judgment: true,
    objective: 'Independently review the verified work',
    locked_decisions: [],
    corrections: [],
    constraints: [],
    deliverables: ['Independent review verdict'],
    acceptance_criteria: ['Review evidence is recorded'],
    write_scope: [],
    context_refs: [],
  };
  const taskInput = path.join(context.root, `${runId}-gaze-task.json`);
  fs.writeFileSync(taskInput, JSON.stringify(task));
  parse(await run([
    'record', ...common, '--type', 'delegation-task', '--status', 'pending',
    '--run', runId, '--input', taskInput,
  ], context.env));
  const result = {
    contract_version: 2,
    task_id: task.task_id,
    delegation_id: task.delegation_id,
    task_digest: delegationTaskDigest(task),
    status: 'ok',
    output: {
      summary: 'Independent review completed',
      files_changed: [],
      checks: classificationStatuses.map((status) => ({
        name: 'user-verification-classification',
        status,
        summary: 'The final diff is correctly classified for user verification',
      })),
      findings: [],
      risks: [],
      blocker: null,
    },
    error: null,
  };
  const resultInput = path.join(context.root, `${runId}-gaze-result.json`);
  fs.writeFileSync(resultInput, JSON.stringify(result));
  return parse(await run([
    'record', ...common, '--type', 'delegation-result', '--status', 'passed',
    '--run', runId, '--input', resultInput,
  ], context.env));
}

async function recordArtifact(context, type, payload, status = 'passed') {
  gateSequence += 1;
  const runId = `artifact-${gateSequence}`;
  if (type === 'review') await recordGazeDelegation(context, runId);
  const input = path.join(context.root, `${type}-${gateSequence}.json`);
  fs.writeFileSync(input, JSON.stringify(payload));
  return parse(await run([
    'record',
    '--workspace', context.workspace,
    '--type', type,
    '--status', status,
    '--run', runId,
    ...(type === 'review' ? ['--role', 'gaze'] : []),
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
  const runId = `gate-${gateSequence}`;
  if (type === 'review') await recordGazeDelegation(context, runId);
  const common = ['--workspace', context.workspace];
  const payload = type === 'verification'
    ? {
      checks: [{ name: 'focused tests', result: 'passed' }],
      requiredSpecialists: [],
      userVerification: { required: false },
    }
    : { verdict: 'pass', findings: [], specialists: [] };
  const input = path.join(context.root, `${type}-${gateSequence}.json`);
  fs.writeFileSync(input, JSON.stringify(payload));
  return parse(await run([
    'record',
    ...common,
    '--type', type,
    '--status', status,
    '--run', runId,
    ...(type === 'review' ? ['--role', 'gaze'] : []),
    '--input', input,
  ], context.env));
}

const passedSpecialist = (role) => ({
  role,
  verdict: 'pass',
  findings: [],
  observationGaps: [],
});

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
  assert.equal(started.bundle_version, '2.2.8');
  assert.deepEqual(started.producer, { role: 'apex', compute_profile: 'frontier' });
  const sessionDirectory = path.join(context.data, 'repos', started.repo_id, 'sessions', started.task_id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(sessionDirectory, 'intent.json'))).bundle_version, '2.2.8');

  const paused = parse(await run(['pause', ...common, '--reason', 'Context boundary'], context.env));
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pause_reason, 'Context boundary');

  const sessionFile = path.join(sessionDirectory, 'session.json');
  const legacySession = JSON.parse(fs.readFileSync(sessionFile));
  delete legacySession.bundle_version;
  fs.writeFileSync(sessionFile, JSON.stringify(legacySession));

  const resumed = parse(await run(['resume', ...common], context.env));
  assert.equal(resumed.status, 'active');
  assert.equal(resumed.bundle_version, '2.2.8');
  assert.ok(resumed.resumed_at);
  await authorizeAndExecute(context, ['plan']);

  const evidenceFile = path.join(context.root, 'evidence.json');
  fs.writeFileSync(evidenceFile, JSON.stringify({
    checks: [{ name: 'unit', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  }));
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
  assert.equal(recorded.artifact.bundle_version, '2.2.8');
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
  fs.writeFileSync(reviewFile, JSON.stringify({ verdict: 'pass', findings: [], specialists: [] }));
  await recordGazeDelegation(context, 'run-1');
  const reviewed = parse(await run([
    'record',
    ...common,
    '--type', 'review',
    '--status', 'passed',
    '--run', 'run-1',
    '--role', 'gaze',
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

test('portable start shards under the canonical codec repo id', async () => {
  const context = fixture();
  execFileSync('git', ['-C', context.workspace, 'init', '-q']);
  execFileSync('git', ['-C', context.workspace, 'remote', 'add', 'origin', 'git@github.com:org/portable-shard.git']);
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start', ...common, '--task', 'SHARD-1', '--intent', 'Shard by codec id', '--route', 'direct',
  ], context.env));

  const codec = require('../skills/phantom/scripts/lib/shared-state.cjs');
  const expected = codec.repoId(context.workspace, { dataRoot: context.data });
  assert.match(started.repo_id, /^portable-shard-[0-9a-f]{10}$/, 'canonical remote-backed id');
  assert.equal(started.repo_id, expected, 'portable routes identity through the shared codec');
  assert.ok(fs.existsSync(path.join(context.data, 'repos', expected, 'sessions', 'SHARD-1')));
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
  fs.writeFileSync(evidence, JSON.stringify({
    checks: [{ name: 'unit', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  }));

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

  const emptyVerification = await run([
    'record', ...common, '--type', 'verification', '--status', 'passed', '--run', 'empty-verification',
  ], context.env);
  assert.equal(emptyVerification.code, 1);
  assert.match(emptyVerification.stderr, /Invalid passed verification evidence/);

  await recordGate(context, 'verification');
  await recordGazeDelegation(context, 'empty-review');
  const emptyReview = await run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'empty-review', '--role', 'gaze',
  ], context.env);
  assert.equal(emptyReview.code, 1);
  assert.match(emptyReview.stderr, /Invalid passed review evidence/);
});

test('Archer evidence is the only specialist evidence accepted when reviews record and ship', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'SPECIALIST-1', '--intent', 'Enforce specialist evidence', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  parse(await run(['authorize', ...common, '--scope', 'ship-pr'], context.env));
  await recordArtifact(context, 'verification', {
    checks: [{ name: 'focused tests', result: 'passed' }],
    requiredSpecialists: ['archer'],
    userVerification: { required: false },
  });

  const invalidReviews = [
    ['missing', []],
    ['failed', [{ ...passedSpecialist('archer'), verdict: 'fail' }]],
    ['blocked', [{ ...passedSpecialist('archer'), verdict: 'blocked' }]],
    ['duplicate', [passedSpecialist('archer'), passedSpecialist('archer')]],
    ['unrequired', [passedSpecialist('archer'), passedSpecialist('ward')]],
    ['unrequired-lens', [passedSpecialist('lens'), passedSpecialist('archer')]],
    ['invalid', [{ ...passedSpecialist('archer'), observationGaps: 'not-an-array' }]],
    ['gapped', [{ ...passedSpecialist('archer'), observationGaps: ['dependency path unavailable'] }]],
  ];

  for (const [label, specialists] of invalidReviews) {
    const input = path.join(context.root, `invalid-review-${label}.json`);
    fs.writeFileSync(input, JSON.stringify({ verdict: 'pass', findings: [], specialists }));
    await recordGazeDelegation(context, `invalid-review-${label}`);
    const result = await run([
      'record', ...common, '--type', 'review', '--status', 'passed',
      '--run', `invalid-review-${label}`, '--role', 'gaze', '--input', input,
    ], context.env);
    assert.equal(result.code, 1, `${label} specialist evidence must not record as passed`);
    assert.match(result.stderr, /specialist|required/i);
  }

  const validReview = await recordArtifact(context, 'review', {
    verdict: 'pass',
    findings: [],
    specialists: [passedSpecialist('archer')],
  });
  const shipped = parse(await run(['ship', ...common], context.env));
  assert.equal(shipped.lifecycle.actions.ship.status, 'ready');

  const tampered = JSON.parse(fs.readFileSync(validReview.file, 'utf8'));
  tampered.evidence.specialists[0].observationGaps = ['required path was not observed'];
  fs.writeFileSync(validReview.file, JSON.stringify(tampered));
  const rejectedGap = await run(['ship', ...common], context.env);
  assert.equal(rejectedGap.code, 1);
  assert.match(rejectedGap.stderr, /observation gaps/i);

  tampered.evidence.specialists = [];
  fs.writeFileSync(validReview.file, JSON.stringify(tampered));
  const rejected = await run(['ship', ...common], context.env);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /specialist|required/i);
});

test('visual confirmation stays in canonical verification evidence without a Lens artifact', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'USER-VERIFY-1', '--intent', 'Verify rendered interaction', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);

  const base = {
    checks: [{ name: 'focused tests', result: 'passed' }],
    requiredSpecialists: [],
  };
  for (const [label, userVerification] of [
    ['missing', undefined],
    ['null', null],
    ['pending', { required: true, status: 'pending', routes: ['/primary-flow'] }],
    ['actor', { required: true, status: 'confirmed', routes: ['/primary-flow'] }],
    ['routes', { required: true, status: 'confirmed', confirmedBy: 'user', routes: [] }],
    ['not-applicable', { required: false, status: 'confirmed', routes: [], observations: [] }],
    ['not-applicable-routes', {
      required: false,
      status: 'not-applicable',
      routes: ['/primary-flow'],
      observations: [],
    }],
    ['not-applicable-actor', {
      required: false,
      status: 'not-applicable',
      routes: [],
      confirmedBy: 'user',
      observations: [],
    }],
    ['non-ui-unknown', { required: false, userConfirmed: true }],
    ['ui-unknown', {
      required: true,
      status: 'confirmed',
      routes: ['/primary-flow'],
      confirmedBy: 'user',
      observations: [],
      userConfirmed: true,
    }],
    ['observations', {
      required: true,
      status: 'confirmed',
      routes: ['/primary-flow'],
      confirmedBy: 'user',
    }],
  ]) {
    const input = path.join(context.root, `invalid-user-verification-${label}.json`);
    fs.writeFileSync(input, JSON.stringify({
      ...base,
      ...(userVerification !== undefined ? { userVerification } : {}),
    }));
    const rejected = await run([
      'record', ...common, '--type', 'verification', '--status', 'passed',
      '--run', `invalid-user-verification-${label}`, '--input', input,
    ], context.env);
    assert.equal(rejected.code, 1, label);
    assert.match(rejected.stderr, /userVerification/);
  }

  const recorded = await recordArtifact(context, 'verification', {
    ...base,
    userVerification: {
      required: true,
      status: 'confirmed',
      routes: ['/primary-flow'],
      confirmedBy: 'user',
      observations: ['Primary interaction completes at the supported viewport'],
    },
  });
  assert.deepEqual(recorded.artifact.evidence.requiredSpecialists, []);
  assert.equal(recorded.artifact.evidence.userVerification.status, 'confirmed');
  assert.equal(fs.existsSync(path.join(path.dirname(recorded.file), 'lens.json')), false);

  const nonVisual = await recordArtifact(context, 'verification', {
    ...base,
    userVerification: { required: false },
  });
  assert.deepEqual(nonVisual.artifact.evidence.userVerification, { required: false });

  const legacyInput = path.join(context.root, 'legacy-visual-verification.json');
  fs.writeFileSync(legacyInput, JSON.stringify({
    ...base,
    visualVerification: { status: 'pass', routes: ['/primary-flow'], fixLoops: 0 },
  }));
  const legacyRejected = await run([
    'record', ...common, '--type', 'verification', '--status', 'passed',
    '--run', 'legacy-visual-verification', '--input', legacyInput,
  ], context.env);
  assert.equal(legacyRejected.code, 1);
  assert.match(legacyRejected.stderr, /visualVerification.*unsupported.*userVerification/);

  const duplicateInput = path.join(context.root, 'duplicate-user-verification-decision.json');
  fs.writeFileSync(duplicateInput, JSON.stringify({
    ...base,
    userVerificationRequired: false,
    userVerification: { required: false },
  }));
  const duplicateRejected = await run([
    'record', ...common, '--type', 'verification', '--status', 'passed',
    '--run', 'duplicate-user-verification-decision', '--input', duplicateInput,
  ], context.env);
  assert.equal(duplicateRejected.code, 1);
  assert.match(duplicateRejected.stderr, /userVerificationRequired.*unsupported/);
});

test('explicit user-verification classification binds to the complete final worktree', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'FULL-FINGERPRINT-1',
    '--intent', 'Change server-only rendering configuration', '--route', 'direct',
  ], context.env));
  const executed = await authorizeAndExecute(context);
  assert.equal(executed.lifecycle.actions.execute.ui_candidate_fingerprint, undefined);

  const unconventional = path.join(context.workspace, 'config', 'render.pipeline');
  fs.mkdirSync(path.dirname(unconventional), { recursive: true });
  fs.writeFileSync(unconventional, 'server-only=true\n');

  const repeated = parse(await run(['execute', ...common], context.env));
  assert.equal(repeated.lifecycle.actions.execute.ui_candidate_fingerprint, undefined);

  const input = path.join(context.root, 'explicit-non-ui-classification.json');
  fs.writeFileSync(input, JSON.stringify({
    checks: [{ name: 'focused tests', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  }));
  const recorded = parse(await run([
    'record', ...common, '--type', 'verification', '--status', 'passed',
    '--run', 'explicit-non-ui-classification', '--input', input,
  ], context.env));
  assert.deepEqual(recorded.artifact.evidence.userVerification, { required: false });
  assert.match(recorded.artifact.worktree_fingerprint, /^sha256:[a-f0-9]{64}$/);

  fs.writeFileSync(unconventional, 'server-only=false\n');
  const revalidated = await runScript(STATE, ['status', ...common], context.env);
  assert.equal(revalidated.code, 0, revalidated.stderr);
  assert.equal(JSON.parse(revalidated.stdout).next, 'record:verification');
});

test('non-UI changes keep user interaction optional', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'NON-UI-SURFACE-1',
    '--intent', 'Change a backend service', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  const service = path.join(context.workspace, 'src', 'service.js');
  fs.mkdirSync(path.dirname(service), { recursive: true });
  fs.writeFileSync(service, 'module.exports = { ready: true };\n');
  for (const relative of [
    'src/components/Button.test.tsx',
    'docs/Demo.tsx',
    'test/fixtures/Card.tsx',
  ]) {
    const file = path.join(context.workspace, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export const Fixture = () => null;\n');
  }

  const recorded = await recordArtifact(context, 'verification', {
    checks: [{ name: 'focused tests', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  });
  assert.deepEqual(recorded.artifact.evidence.userVerification, { required: false });
});

test('passed review requires exactly one passed Gaze user-verification classification check', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'GAZE-CLASSIFICATION-1',
    '--intent', 'Review a backend-only change', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  await recordArtifact(context, 'verification', {
    checks: [{ name: 'focused tests', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  });

  for (const [label, classificationStatuses] of [
    ['missing', []],
    ['failed', ['failed']],
    ['skipped', ['skipped']],
    ['contradictory-duplicate', ['passed', 'failed']],
  ]) {
    const runId = `${label}-classification-check`;
    await recordGazeDelegation(context, runId, { classificationStatuses });
    const input = path.join(context.root, `${label}-classification-review.json`);
    fs.writeFileSync(input, JSON.stringify({ verdict: 'pass', findings: [], specialists: [] }));
    const rejected = await run([
      'record', ...common, '--type', 'review', '--status', 'passed',
      '--run', runId, '--role', 'gaze', '--input', input,
    ], context.env);
    assert.equal(rejected.code, 1, label);
    assert.match(
      rejected.stderr,
      /exactly one passed Gaze user-verification-classification check/,
      label,
    );
  }
});

test('a commit after classification makes user-verification evidence stale', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  execFileSync('git', ['init'], { cwd: context.workspace, stdio: 'ignore' });
  execFileSync('git', ['add', 'planning.md'], { cwd: context.workspace });
  execFileSync('git', [
    '-c', 'user.name=Phantom Test', '-c', 'user.email=phantom@example.test',
    'commit', '-m', 'initial',
  ], { cwd: context.workspace, stdio: 'ignore' });
  parse(await run([
    'start', ...common, '--task', 'COMMITTED-FINGERPRINT-1',
    '--intent', 'Commit a server runtime configuration', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);

  await recordArtifact(context, 'verification', {
    checks: [{ name: 'focused tests', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  });

  const config = path.join(context.workspace, 'config', 'runtime.data');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, 'cache=true\n');
  execFileSync('git', ['add', 'config/runtime.data'], { cwd: context.workspace });
  execFileSync('git', [
    '-c', 'user.name=Phantom Test', '-c', 'user.email=phantom@example.test',
    'commit', '-m', 'change runtime config',
  ], { cwd: context.workspace, stdio: 'ignore' });

  const status = await runScript(STATE, ['status', ...common], context.env);
  assert.equal(status.code, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).next, 'record:verification');
});

test('legacy UI candidate baselines remain inspectable without migration', async () => {
  for (const [label, baseline] of [
    ['missing', undefined],
    ['unknown-version', 'ui-v999:sha256:unknown'],
  ]) {
    const context = fixture();
    const common = ['--workspace', context.workspace];
    const started = parse(await run([
      'start', ...common, '--task', `LEGACY-UI-BASELINE-${label}`,
      '--intent', 'Recover an old execution baseline', '--route', 'direct',
    ], context.env));
    await authorizeAndExecute(context);
    const sessionFile = path.join(
      context.data, 'repos', started.repo_id, 'sessions', started.task_id, 'session.json',
    );
    const legacy = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    if (baseline === undefined) {
      delete legacy.lifecycle.actions.execute.ui_candidate_fingerprint;
    } else {
      legacy.lifecycle.actions.execute.ui_candidate_fingerprint = baseline;
    }
    fs.writeFileSync(sessionFile, JSON.stringify(legacy));

    const recorded = await recordArtifact(context, 'verification', {
      checks: [{ name: 'focused tests', result: 'passed' }],
      requiredSpecialists: [],
      userVerification: { required: false },
    });
    assert.equal(recorded.artifact.status, 'passed', label);
  }
});

test('legacy passed verification without a UI decision remains inspectable and requires refresh', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'LEGACY-UI-DECISION-1',
    '--intent', 'Recover missing UI classification', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  const verification = await recordArtifact(context, 'verification', {
    checks: [{ name: 'focused tests', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  });
  const legacy = JSON.parse(fs.readFileSync(verification.file, 'utf8'));
  delete legacy.evidence.userVerification;
  fs.writeFileSync(verification.file, JSON.stringify(legacy));

  const before = treeSnapshot(context.data);
  const inspection = parse(await run(['status', ...common], context.env));
  assert.equal(inspection.task_id, 'LEGACY-UI-DECISION-1');
  assert.deepEqual(treeSnapshot(context.data), before, 'legacy inspection must be read-only');

  const compactStatus = await runScript(STATE, ['status', ...common], context.env);
  assert.equal(compactStatus.code, 0, compactStatus.stderr);
  assert.equal(
    JSON.parse(compactStatus.stdout).next,
    'record:verification-with-user-verification-decision',
  );
  const blocked = await run(['complete', ...common], context.env);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /requires userVerification classification.*required.*false/is);

  await recordArtifact(context, 'verification', {
    checks: [{ name: 'focused tests', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  });
  const recovered = await runScript(STATE, ['status', ...common], context.env);
  assert.equal(JSON.parse(recovered.stdout).next, 'record:review');
});

test('legacy Lens verification is inspectable and recovers through fresh user verification', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'LEGACY-LENS-1', '--intent', 'Recover visual evidence', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  const verification = await recordArtifact(context, 'verification', {
    checks: [{ name: 'focused tests', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  });
  const legacy = JSON.parse(fs.readFileSync(verification.file, 'utf8'));
  legacy.evidence.requiredSpecialists = ['lens'];
  fs.writeFileSync(verification.file, JSON.stringify(legacy));

  const before = treeSnapshot(context.data);
  const inspection = parse(await run(['status', ...common], context.env));
  assert.equal(inspection.task_id, 'LEGACY-LENS-1');
  assert.deepEqual(treeSnapshot(context.data), before, 'legacy inspection must be read-only');

  const compactStatus = await runScript(STATE, ['status', ...common], context.env);
  assert.equal(compactStatus.code, 0, compactStatus.stderr);
  assert.equal(
    JSON.parse(compactStatus.stdout).next,
    'record:verification-with-user-verification',
  );
  const blocked = await run(['complete', ...common], context.env);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /Legacy Lens gate requirements.*advisory only.*fresh verification.*userVerification/s);

  await recordArtifact(context, 'verification', {
    checks: [{ name: 'focused tests', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: {
      required: true,
      status: 'confirmed',
      routes: ['/legacy-visual-scenario'],
      confirmedBy: 'user',
      observations: ['User reconfirmed the current rendered behavior'],
    },
  });
  const recovered = await runScript(STATE, ['status', ...common], context.env);
  assert.equal(JSON.parse(recovered.stdout).next, 'record:review');
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

test('state records bounded delegation v2 tasks and matching typed results', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start', ...common, '--task', 'DELEGATE-1', '--intent', 'Persist delegation contracts', '--route', 'direct',
  ], context.env));
  const { delegationTaskDigest } = await import(pathToFileURL(DECISION_CONTRACTS).href);

  const taskFile = path.join(context.root, 'delegation-task.json');
  const referenceFile = path.join(context.workspace, 'planning.md');
  const referenceDigest = require('node:crypto')
    .createHash('sha256')
    .update(fs.readFileSync(referenceFile))
    .digest('hex');
  const taskPayload = {
    contract_version: 2,
    task_id: 'D1',
    delegation_id: 'delegation-D1-attempt-1',
    role: 'blade',
    objective: 'Implement the bounded task',
    profile: 'balanced',
    risk: 'moderate',
    requires_judgment: false,
    locked_decisions: ['Keep the state contract provider-neutral'],
    corrections: [],
    constraints: ['Preserve unrelated work'],
    deliverables: ['Focused patch'],
    acceptance_criteria: ['Focused checks pass'],
    write_scope: ['target.js'],
    context_refs: [{
      id: 'plan',
      kind: 'artifact',
      source: 'workspace',
      locator: 'planning.md',
      content_sha256: referenceDigest,
      observed_at: '2026-07-23T20:00:00Z',
    }],
  };
  fs.writeFileSync(taskFile, JSON.stringify(taskPayload));
  const task = parse(await run([
    'record', ...common, '--type', 'delegation-task', '--status', 'pending', '--run', 'D1', '--input', taskFile,
  ], context.env));
  assert.equal(task.artifact.artifact_type, 'delegation-task');
  assert.equal(task.artifact.bundle_version, '2.2.8');
  assert.deepEqual(task.artifact.producer, { role: 'blade', compute_profile: 'balanced' });
  assert.equal(task.artifact.model_routing.requested_profile, 'balanced');
  assert.equal(task.artifact.model_routing.actual_profile, null);

  const lensPayload = {
    ...taskPayload,
    task_id: 'D-LENS',
    delegation_id: 'delegation-D-LENS-attempt-1',
    role: 'lens',
    objective: 'Inspect the requested UI without changing code',
  };
  fs.writeFileSync(taskFile, JSON.stringify(lensPayload));
  const lensTask = parse(await run([
    'record', ...common, '--type', 'delegation-task', '--status', 'pending',
    '--run', 'D-LENS', '--input', taskFile,
  ], context.env));
  assert.deepEqual(lensTask.artifact.producer, { role: 'lens', compute_profile: 'balanced' });
  assert.equal(lensTask.artifact.model_routing.requested_profile, 'balanced');
  fs.writeFileSync(taskFile, JSON.stringify(taskPayload));

  const resultFile = path.join(context.root, 'delegation-result.json');
  const resultPayload = {
    contract_version: 2,
    task_id: 'D1',
    delegation_id: taskPayload.delegation_id,
    task_digest: delegationTaskDigest(taskPayload),
    status: 'ok',
    output: {
      summary: 'Focused patch complete',
      files_changed: ['target.js'],
      checks: [{ name: 'focused', status: 'passed', summary: 'Contract accepted' }],
      findings: [],
      risks: [],
      blocker: null,
    },
    error: null,
  };
  fs.writeFileSync(resultFile, JSON.stringify(resultPayload));
  const result = parse(await run([
    'record', ...common, '--type', 'delegation-result', '--status', 'passed', '--run', 'D1', '--input', resultFile,
  ], context.env));
  assert.equal(result.artifact.artifact_type, 'delegation-result');
  assert.deepEqual(result.artifact.producer, { role: 'blade', compute_profile: 'balanced' });
  assert.equal(result.artifact.model_routing.requested_profile, 'balanced');
  assert.equal(result.artifact.model_routing.outcome, 'passed');

  fs.writeFileSync(resultFile, JSON.stringify({
    ...resultPayload,
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

  fs.writeFileSync(resultFile, JSON.stringify(resultPayload));
  const overridden = parse(await run([
    'record', ...common, '--type', 'delegation-result', '--status', 'passed', '--run', 'D1', '--input', resultFile,
    '--role', 'apex', '--profile', 'economy',
  ], context.env));
  assert.deepEqual(overridden.artifact.producer, { role: 'apex', compute_profile: 'frontier' });
  assert.equal(overridden.artifact.model_routing.requested_profile, 'frontier');

  fs.writeFileSync(resultFile, JSON.stringify({ ...resultPayload, task_id: 'DIFFERENT' }));
  const mismatched = await run([
    'record', ...common, '--type', 'delegation-result', '--status', 'passed', '--run', 'D1', '--input', resultFile,
  ], context.env);
  assert.equal(mismatched.code, 1);
  assert.match(mismatched.stderr, /task_id must match/);

  fs.writeFileSync(taskFile, JSON.stringify({ ...taskPayload, contract_version: 1, task_id: 'D2' }));
  const invalid = await run([
    'record', ...common, '--type', 'delegation-task', '--status', 'pending', '--run', 'D2', '--input', taskFile,
  ], context.env);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /Invalid delegation-task contract/);

  fs.writeFileSync(resultFile, JSON.stringify({
    ...resultPayload,
    task_digest: '0'.repeat(64),
  }));
  const wrongDigest = await run([
    'record', ...common, '--type', 'delegation-result', '--status', 'passed', '--run', 'D1', '--input', resultFile,
  ], context.env);
  assert.equal(wrongDigest.code, 1);
  assert.match(wrongDigest.stderr, /task_digest must match/);

  fs.writeFileSync(resultFile, JSON.stringify({
    ...resultPayload,
    output: { ...resultPayload.output, files_changed: ['outside.js'] },
  }));
  const outsideScope = await run([
    'record', ...common, '--type', 'delegation-result', '--status', 'passed', '--run', 'D1', '--input', resultFile,
  ], context.env);
  assert.equal(outsideScope.code, 1);
  assert.match(outsideScope.stderr, /outside task\.write_scope/);

  const sessionDirectory = path.join(
    context.data,
    'repos',
    started.repo_id,
    'sessions',
    started.task_id,
  );
  const legacyTask = {
    contract_version: 1,
    task_id: 'LEGACY',
    role: 'blade',
    profile: 'balanced',
    objective: 'Finish work already in flight',
    requires_judgment: false,
    inputs: {},
    context_refs: [{ id: 'plan', kind: 'artifact', ref: 'plan.json' }],
    constraints: [],
    deliverables: ['Result'],
    acceptance_criteria: ['Result is returned'],
    write_scope: [],
  };
  const legacyRun = path.join(sessionDirectory, 'runs', 'LEGACY');
  fs.mkdirSync(legacyRun, { recursive: true });
  fs.writeFileSync(path.join(legacyRun, 'delegation-task.json'), JSON.stringify({
    schema_version: 1,
    artifact_type: 'delegation-task',
    repo_id: started.repo_id,
    task_id: started.task_id,
    status: 'pending',
    producer: { role: 'blade', compute_profile: 'balanced' },
    model_routing: { requested_profile: 'balanced' },
    evidence: legacyTask,
  }));
  fs.writeFileSync(resultFile, JSON.stringify({
    contract_version: 1,
    task_id: 'LEGACY',
    status: 'ok',
    output: { summary: 'Existing work completed' },
    error: null,
  }));
  const legacyResult = parse(await run([
    'record',
    ...common,
    '--type', 'delegation-result',
    '--status', 'passed',
    '--run', 'LEGACY',
    '--input', resultFile,
  ], context.env));
  assert.equal(legacyResult.artifact.evidence.contract_version, 1);
});

test('delegation v2 rejects unsafe references, stale hashes, and oversized envelopes', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'DELEGATE-SAFETY', '--intent', 'Reject unsafe handoffs', '--route', 'direct',
  ], context.env));
  const input = path.join(context.root, 'task.json');
  const reference = path.join(context.workspace, 'planning.md');
  const referenceDigest = require('node:crypto')
    .createHash('sha256')
    .update(fs.readFileSync(reference))
    .digest('hex');
  const base = {
    contract_version: 2,
    task_id: 'SAFE',
    delegation_id: 'safe-attempt-1',
    role: 'blade',
    profile: 'balanced',
    risk: 'high',
    objective: 'Validate reference boundaries',
    requires_judgment: false,
    locked_decisions: [],
    corrections: [],
    constraints: [],
    deliverables: [],
    acceptance_criteria: [],
    write_scope: [],
    context_refs: [{
      id: 'context',
      kind: 'resource',
      source: 'workspace',
      locator: 'planning.md',
      content_sha256: referenceDigest,
      observed_at: '2026-07-23T20:00:00Z',
    }],
  };
  const recordTask = async (runId, mutate) => {
    const payload = structuredClone(base);
    mutate(payload);
    fs.writeFileSync(input, JSON.stringify(payload));
    return run([
      'record', ...common, '--type', 'delegation-task', '--status', 'pending', '--run', runId, '--input', input,
    ], context.env);
  };

  for (const [label, mutate, expected] of [
    ['absolute', (value) => { value.context_refs[0].locator = reference; }, /normalized repository-relative path/],
    ['traversal', (value) => { value.context_refs[0].locator = '../planning.md'; }, /normalized repository-relative path/],
    ['missing', (value) => { value.context_refs[0].locator = 'missing.md'; }, /does not exist/],
    ['directory', (value) => { value.context_refs[0].locator = 'directory'; fs.mkdirSync(path.join(context.workspace, 'directory')); }, /must be a file/],
    ['hash', (value) => { value.context_refs[0].content_sha256 = '0'.repeat(64); }, /does not match/],
    ['oversize', (value) => { value.objective = 'é'.repeat(33_000); }, /maximum is 64000/],
  ]) {
    const result = await recordTask(label, mutate);
    assert.equal(result.code, 1, `${label} unexpectedly passed`);
    assert.match(result.stderr, expected);
  }

  const outside = path.join(context.root, 'outside.txt');
  fs.writeFileSync(outside, 'outside');
  fs.symlinkSync(outside, path.join(context.workspace, 'escape.txt'));
  const escaped = await recordTask('escape', (value) => {
    value.context_refs[0].locator = 'escape.txt';
    value.context_refs[0].content_sha256 = require('node:crypto')
      .createHash('sha256')
      .update(fs.readFileSync(outside))
      .digest('hex');
  });
  assert.equal(escaped.code, 1);
  assert.match(escaped.stderr, /symlink resolves outside/);

  const accepted = structuredClone(base);
  accepted.task_id = 'RESULT-BOUNDS';
  accepted.delegation_id = 'result-bounds-attempt-1';
  fs.writeFileSync(input, JSON.stringify(accepted));
  parse(await run([
    'record',
    ...common,
    '--type', 'delegation-task',
    '--status', 'pending',
    '--run', 'result-bounds',
    '--input', input,
  ], context.env));
  const { delegationTaskDigest } = await import(pathToFileURL(DECISION_CONTRACTS).href);
  const resultFile = path.join(context.root, 'oversized-result.json');
  fs.writeFileSync(resultFile, JSON.stringify({
    contract_version: 2,
    task_id: accepted.task_id,
    delegation_id: accepted.delegation_id,
    task_digest: delegationTaskDigest(accepted),
    status: 'error',
    output: null,
    error: { code: 'TOO_LARGE', message: 'é'.repeat(17_000), retryable: false },
  }));
  const oversizedResult = await run([
    'record',
    ...common,
    '--type', 'delegation-result',
    '--status', 'failed',
    '--run', 'result-bounds',
    '--input', resultFile,
  ], context.env);
  assert.equal(oversizedResult.code, 1);
  assert.match(oversizedResult.stderr, /maximum is 32000/);
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
  fs.writeFileSync(verificationInput, JSON.stringify({
    checks: [{ name: 'unit', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  }));
  fs.writeFileSync(reviewInput, JSON.stringify({ verdict: 'pass', findings: [], specialists: [] }));
  const verification = parse(await run([
    'record', ...common, '--type', 'verification', '--status', 'passed', '--run', 'tamper', '--input', verificationInput,
  ], context.env));
  await recordGazeDelegation(context, 'tamper');
  parse(await run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'tamper', '--role', 'gaze', '--input', reviewInput,
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
  fs.writeFileSync(verificationInput, JSON.stringify({
    checks: [{ name: 'unit', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  }));
  fs.writeFileSync(reviewInput, JSON.stringify({ verdict: 'pass', findings: [], specialists: [] }));
  const older = parse(await run([
    'record', ...common, '--type', 'verification', '--status', 'passed', '--run', 'zzz-older', '--input', verificationInput,
  ], context.env));
  await recordGazeDelegation(context, 'review');
  parse(await run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'review', '--role', 'gaze', '--input', reviewInput,
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

test('implementation and PR shipping authorizations remain separate', async () => {
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
    /PR shipping authorization is missing.*authorize --scope ship-pr/s,
  );
  parse(await run([
    'authorize', ...common, '--scope', 'ship-pr',
  ], context.env));
  const ready = parse(await run(['ship', ...common], context.env));
  assert.equal(ready.lifecycle.actions.ship.status, 'ready');
});

test('the legacy ship-draft-pr scope name still authorizes the ship-pr gate', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start', ...common, '--task', 'LEGACY-SCOPE', '--intent', 'Accept the pre-rename scope', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  await recordGate(context, 'verification');
  await recordGate(context, 'review');

  const authorized = parse(await run([
    'authorize', ...common, '--scope', 'ship-draft-pr',
  ], context.env));
  assert.equal(authorized.lifecycle.authorizations['ship-pr'].status, 'authorized');
  assert.equal(authorized.lifecycle.authorizations['ship-draft-pr'], undefined);

  // A session written before the rename carries the decision under the legacy
  // key alone; reading it must still cross the same gate.
  const sessionFile = path.join(
    context.data, 'repos', started.repo_id, 'sessions', started.task_id, 'session.json',
  );
  const legacy = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  legacy.lifecycle.authorizations = {
    implementation: legacy.lifecycle.authorizations.implementation,
    'ship-draft-pr': legacy.lifecycle.authorizations['ship-pr'],
  };
  fs.writeFileSync(sessionFile, JSON.stringify(legacy));

  const ready = parse(await run(['ship', ...common], context.env));
  assert.equal(ready.lifecycle.actions.ship.status, 'ready');
  assert.equal(ready.lifecycle.authorizations['ship-pr'].status, 'authorized');
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
  const awaitingPlan = await runScript(STATE, ['status', ...common], context.env);
  assert.equal(awaitingPlan.code, 0, awaitingPlan.stderr);
  assert.equal(JSON.parse(awaitingPlan.stdout).next, 'record:plan');

  await recordArtifact(context, 'plan', portablePlan());
  const planComplete = await runScript(STATE, ['status', ...common], context.env);
  assert.equal(planComplete.code, 0, planComplete.stderr);
  assert.equal(JSON.parse(planComplete.stdout).next, null);

  for (const scope of ['implementation', 'ship-pr']) {
    parse(await run(['authorize', ...common, '--scope', scope], context.env));
  }
  const authorized = await runScript(STATE, ['status', ...common], context.env);
  assert.equal(authorized.code, 0, authorized.stderr);
  assert.equal(JSON.parse(authorized.stdout).next, null);
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

test('to-plan sessions complete on a validated plan and release the workspace', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start',
    ...common,
    '--task', 'PLAN-DONE',
    '--intent', 'Produce a plan only',
    '--route', 'plan',
    '--mode', 'to-plan',
  ], context.env));

  const withoutPlan = await run(['complete', ...common], context.env);
  assert.equal(withoutPlan.code, 1);
  assert.match(withoutPlan.stderr, /plan artifact is missing.*Record a fresh passed plan artifact/s);

  await recordArtifact(context, 'plan', portablePlan());
  const completed = parse(await run(['complete', ...common], context.env));
  assert.equal(completed.status, 'completed');

  const next = parse(await run([
    'start',
    ...common,
    '--task', 'PLAN-NEXT',
    '--intent', 'Plan the follow-up task',
    '--route', 'plan',
    '--mode', 'to-plan',
  ], context.env));
  assert.equal(next.task_id, 'PLAN-NEXT');
  assert.equal(next.status, 'active');
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
    for (const scope of ['implementation', 'ship-pr']) {
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
    'authorize', ...common, '--scope', 'ship-pr',
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
  fs.writeFileSync(rejectedReviewInput, JSON.stringify({ verdict: 'pass', findings: [], specialists: [] }));
  const rejectedReview = await run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'review-after-failed-verification', '--role', 'gaze',
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

  const missingRouteSnapshot = fs.readFileSync(sessionFile, 'utf8');
  assert.equal(parse(await runScript(STATE, ['status', ...common], context.env)).next, 'recover:route');
  assert.equal(fs.readFileSync(sessionFile, 'utf8'), missingRouteSnapshot);
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
  assert.equal(parse(await runScript(STATE, ['status', ...common], context.env)).next, 'recover:route');
  const unrouted = await run(['execute', ...common], context.env);
  assert.equal(unrouted.code, 1);
  assert.match(unrouted.stderr, /recovered session has no supported route.*start --task <id>/s);
  const inheritedRoute = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  inheritedRoute.route = 'constructor';
  fs.writeFileSync(sessionFile, JSON.stringify(inheritedRoute));
  const inheritedRouteSnapshot = fs.readFileSync(sessionFile, 'utf8');
  assert.equal(parse(await runScript(STATE, ['status', ...common], context.env)).next, 'recover:route');
  assert.equal(fs.readFileSync(sessionFile, 'utf8'), inheritedRouteSnapshot);
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
  assert.equal(parse(await runScript(STATE, ['status', ...common], context.env)).next, 'record:plan');

  const missing = await run(['approve', ...common, '--gate', 'plan'], context.env);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /current passed plan artifact is missing.*fresh passed plan artifact/s);

  const plan = await recordArtifact(context, 'plan', portablePlan());
  const invalidArtifact = JSON.parse(fs.readFileSync(plan.file, 'utf8'));
  invalidArtifact.status = 'failed';
  fs.writeFileSync(plan.file, JSON.stringify(invalidArtifact));
  assert.equal(parse(await runScript(STATE, ['status', ...common], context.env)).next, 'record:plan');
  invalidArtifact.status = 'passed';
  fs.writeFileSync(plan.file, JSON.stringify(invalidArtifact));
  assert.equal(parse(await runScript(STATE, ['status', ...common], context.env)).next, 'approve:plan');
  const approved = parse(await run(['approve', ...common, '--gate', 'plan'], context.env));
  assert.deepEqual(approved.lifecycle.approvals.plan.artifact_bindings, [{
    artifact_type: 'plan',
    record_sequence: plan.artifact.record_sequence,
    digest: approved.lifecycle.approvals.plan.artifact_bindings[0].digest,
  }]);
  assert.match(approved.lifecycle.approvals.plan.artifact_bindings[0].digest, /^sha256:[a-f0-9]{64}$/);

  const sessionFile = path.join(path.dirname(plan.file), 'session.json');
  const legacyApproval = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  const bindings = legacyApproval.lifecycle.approvals.plan.artifact_bindings;
  delete legacyApproval.lifecycle.approvals.plan.artifact_bindings;
  fs.writeFileSync(sessionFile, JSON.stringify(legacyApproval));
  const unboundSnapshot = fs.readFileSync(sessionFile, 'utf8');
  assert.equal(parse(await runScript(STATE, ['status', ...common], context.env)).next, 'approve:plan');
  assert.equal(fs.readFileSync(sessionFile, 'utf8'), unboundSnapshot);
  legacyApproval.lifecycle.approvals.plan.artifact_bindings = bindings;
  fs.writeFileSync(sessionFile, JSON.stringify(legacyApproval));

  const artifact = JSON.parse(fs.readFileSync(plan.file, 'utf8'));
  artifact.evidence.summary = `${artifact.evidence.summary} Changed after approval.`;
  fs.writeFileSync(plan.file, JSON.stringify(artifact));
  assert.equal(parse(await runScript(STATE, ['status', ...common], context.env)).next, 'approve:plan');
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
  assert.equal(parse(await runScript(STATE, ['status', ...common], context.env)).next, 'record:decisions');
  await recordApprovalArtifacts(context, 'wiring');
  assert.equal(parse(await runScript(STATE, ['status', ...common], context.env)).next, 'approve:wiring');
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
    requiredSpecialists: [],
    userVerification: { required: false },
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
  fs.writeFileSync(reviewInput, JSON.stringify({ verdict: 'pass', findings: [], specialists: [] }));
  const premature = await run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'premature', '--role', 'gaze', '--input', reviewInput,
  ], context.env);
  assert.equal(premature.code, 1);
  assert.match(premature.stderr, /current passed verification artifact is missing/);

  const verification = await recordGate(context, 'verification');
  const nonIndependent = await run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'non-independent', '--role', 'blade', '--input', reviewInput,
  ], context.env);
  assert.equal(nonIndependent.code, 1);
  assert.match(nonIndependent.stderr, /explicit independent role provenance.*blade/);
  const review = await recordGate(context, 'review');
  assert.ok(review.artifact.record_sequence > verification.artifact.record_sequence);
  await recordGate(context, 'verification');
  const stale = await run(['complete', ...common], context.env);
  assert.equal(stale.code, 1);
  assert.match(stale.stderr, /Gaze delegation task must be recorded after authoritative verification/);
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
