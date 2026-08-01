// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
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
let authoritySequence = 0;
const authorityFixtures = new Map();

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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const artifactDigest = (artifact) =>
  `sha256:${createHash('sha256').update(JSON.stringify(artifact)).digest('hex')}`;

function currentAuthorityState(env) {
  const data = env.PHANTOM_DATA;
  const directory = path.join(data, 'state', 'current-session');
  const pointers = fs.readdirSync(directory).filter((name) => name.endsWith('.json'));
  assert.equal(pointers.length, 1, 'authority fixture expects one current session pointer');
  const pointer = JSON.parse(fs.readFileSync(path.join(directory, pointers[0])));
  const session = JSON.parse(fs.readFileSync(path.join(pointer.session_dir, 'session.json')));
  return { pointer, session };
}

async function signedAuthorityArgs(args, env) {
  if (!['approve', 'authorize'].includes(args[0]) || args.includes('--decision')) return args;
  const fixtureAuthority = authorityFixtures.get(env.PHANTOM_DATA);
  assert.ok(fixtureAuthority, 'signed lifecycle decisions require the host authority fixture');
  const workspace = args[args.indexOf('--workspace') + 1];
  const { pointer, session } = currentAuthorityState(env);
  const fingerprintResult = await runScript(STATE, ['fingerprint', '--workspace', workspace], env);
  const fingerprint = parse(fingerprintResult).worktree_fingerprint;
  const gate = args.includes('--gate') ? args[args.indexOf('--gate') + 1] : null;
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : null;
  const routeGates = {
    direct: [],
    plan: ['plan'],
    brainstorm: ['direction', 'plan'],
    full: ['direction', 'plan', 'wiring'],
  };
  const bindings = gate
    ? (gate === 'direction' ? ['brainstorm'] : gate === 'plan' ? ['plan'] : ['plan', 'decisions'])
      .flatMap((type) => {
        const file = path.join(pointer.session_dir, `${type}.json`);
        if (!fs.existsSync(file)) return [];
        const artifact = JSON.parse(fs.readFileSync(file));
        return [{
          gate,
          artifact_type: type,
          record_sequence: artifact.record_sequence,
          digest: artifactDigest(artifact),
        }];
      })
    : routeGates[session.route].flatMap((requiredGate) =>
      (session.lifecycle.approvals[requiredGate].artifact_bindings || [])
        .map((binding) => ({ gate: requiredGate, ...binding })));
  bindings.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  authoritySequence += 1;
  const issuedAt = new Date();
  const unsigned = {
    schema_version: 1,
    repo_id: pointer.repo_id,
    task_id: pointer.task_id,
    decision_kind: gate ? 'approval' : 'authorization',
    gate,
    scope,
    decision: gate ? 'approved' : 'authorized',
    worktree_fingerprint: fingerprint,
    approval_artifact_bindings: bindings,
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
    actor: 'test-host-user',
    source: 'portable-lifecycle-test-host',
    source_event_id: `source-event-${authoritySequence}`,
    replay_id: `replay-${authoritySequence}`,
    key_id: 'portable-lifecycle-test-key',
  };
  const decision = {
    ...unsigned,
    signature: sign(null, Buffer.from(canonicalJson(unsigned)), fixtureAuthority.privateKey).toString('base64'),
  };
  const directory = path.join(env.PHANTOM_DATA, 'test-authority');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `decision-${authoritySequence}.json`);
  fs.writeFileSync(file, JSON.stringify(decision));
  return [...args, '--decision', file];
}

const run = async (args, env) => runScript(STATE, await signedAuthorityArgs(args, env), env);

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
  execFileSync('git', ['init', '-q', '-b', 'feat/portable-lifecycle'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'phantom-test@example.invalid'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Subash Karki'], { cwd: workspace });
  execFileSync('git', ['add', 'planning.md'], { cwd: workspace });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: workspace });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const trustDirectory = path.join(data, 'config');
  fs.mkdirSync(trustDirectory, { recursive: true });
  fs.writeFileSync(path.join(trustDirectory, 'authority-trust.json'), JSON.stringify({
    schema_version: 1,
    key_id: 'portable-lifecycle-test-key',
    source: 'portable-lifecycle-test-host',
    public_key: publicKey.export({ type: 'spki', format: 'pem' }),
  }));
  authorityFixtures.set(data, { privateKey });
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

async function currentFingerprint(context) {
  return parse(await run([
    'fingerprint', '--workspace', context.workspace,
  ], context.env)).worktree_fingerprint;
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

test('portable lifecycle persists state and rejects removed verification/review lifecycle paths', async () => {
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
  assert.equal(started.bundle_version, '3.0.0');
  assert.deepEqual(started.producer, { role: 'apex', compute_profile: 'frontier' });
  const sessionDirectory = path.join(context.data, 'repos', started.repo_id, 'sessions', started.task_id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(sessionDirectory, 'intent.json'))).bundle_version, '3.0.0');

  const paused = parse(await run(['pause', ...common, '--reason', 'Context boundary'], context.env));
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pause_reason, 'Context boundary');

  const sessionFile = path.join(sessionDirectory, 'session.json');
  const canonicalSession = JSON.parse(fs.readFileSync(sessionFile));
  const missingVersion = { ...canonicalSession };
  delete missingVersion.bundle_version;
  fs.writeFileSync(sessionFile, JSON.stringify(missingVersion));
  const rejectedResume = await run(['resume', ...common], context.env);
  assert.equal(rejectedResume.code, 1);
  assert.match(rejectedResume.stderr, /session\.json bundle_version must be 3\.0\.0/);

  fs.writeFileSync(sessionFile, JSON.stringify(canonicalSession));
  const resumed = parse(await run(['resume', ...common], context.env));
  assert.equal(resumed.status, 'active');
  assert.equal(resumed.bundle_version, '3.0.0');
  assert.ok(resumed.resumed_at);
  await authorizeAndExecute(context, ['plan']);

  const removedVerify = await run(['verify', ...common], context.env);
  assert.equal(removedVerify.code, 1);
  assert.match(removedVerify.stderr, /Usage: phantom-state\.mjs/);
  for (const type of ['verification', 'review']) {
    const removedRecord = await run([
      'record', ...common, '--type', type, '--status', 'passed',
    ], context.env);
    assert.equal(removedRecord.code, 1);
    assert.match(removedRecord.stderr, new RegExp(`Unsupported artifact type: ${type}`));
  }

  const completed = await run(['complete', ...common], context.env);
  assert.equal(completed.code, 1);
  assert.match(completed.stderr, /authoritative workflow replay failed/);

  const status = parse(await run(['status', ...common], context.env));
  assert.equal(status.status, 'active');
  assert.equal(status.task_id, 'TASK-42');
});

test('task ids remain exact while unsafe path characters use a lossless segment', async () => {
  const context = fixture();
  const taskId = 'feature/api:v1';
  const started = parse(await run([
    'start', '--workspace', context.workspace, '--task', taskId,
    '--intent', 'Preserve the exact task identity', '--route', 'direct',
  ], context.env));
  assert.equal(started.task_id, taskId);

  const pointerFile = path.join(context.data, 'state', 'current-session', `${started.repo_id}.json`);
  const pointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
  const segment = path.basename(pointer.session_dir);
  assert.match(segment, /^id~/);
  assert.equal(Buffer.from(segment.slice(3), 'base64url').toString('utf8'), taskId);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pointer.session_dir, 'session.json'))).task_id, taskId);
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

test('lifecycle authority requires a valid one-shot signed host decision', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'SIGNED-1', '--intent', 'Verify signed authority', '--route', 'direct',
  ], context.env));

  const bare = await runScript(STATE, ['authorize', ...common, '--scope', 'implementation'], context.env);
  assert.equal(bare.code, 1);
  assert.match(bare.stderr, /requires --decision <signed-authority-decision\.json>/);

  const signedArgs = await signedAuthorityArgs(
    ['authorize', ...common, '--scope', 'implementation'],
    context.env,
  );
  const callerIdentity = await runScript(STATE, [...signedArgs, '--by', 'forged-user'], context.env);
  assert.equal(callerIdentity.code, 1);
  assert.match(callerIdentity.stderr, /does not accept caller-controlled --by identity/);

  const accepted = parse(await runScript(STATE, signedArgs, context.env));
  assert.equal(accepted.lifecycle.authorizations.implementation.status, 'authorized');
  assert.equal(accepted.lifecycle.authorizations.implementation.by, undefined);
  assert.equal(accepted.lifecycle.authorizations.implementation.authority.actor, 'test-host-user');
  assert.match(accepted.lifecycle.authorizations.implementation.authority.decision_digest, /^sha256:/);

  const replay = await runScript(STATE, signedArgs, context.env);
  assert.equal(replay.code, 1);
  assert.match(replay.stderr, /already consumed/);

  const decisionFile = signedArgs.at(-1);
  const tampered = JSON.parse(fs.readFileSync(decisionFile));
  tampered.actor = 'forged-actor';
  tampered.replay_id = 'tampered-replay';
  tampered.source_event_id = 'tampered-source';
  const tamperedFile = path.join(context.root, 'tampered-authority.json');
  fs.writeFileSync(tamperedFile, JSON.stringify(tampered));
  const invalid = await runScript(STATE, [
    'authorize', ...common, '--scope', 'implementation', '--decision', tamperedFile,
  ], context.env);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /Ed25519 signature is invalid/);
});

test('lifecycle authority fails closed when host trust was not pinned at start', async () => {
  const context = fixture();
  fs.unlinkSync(path.join(context.data, 'config', 'authority-trust.json'));
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start', ...common, '--task', 'NO-TRUST', '--intent', 'Deny missing trust', '--route', 'direct',
  ], context.env));
  assert.equal(started.authority_trust, null);
  const signedArgs = await signedAuthorityArgs(
    ['authorize', ...common, '--scope', 'implementation'],
    context.env,
  );
  const denied = await runScript(STATE, signedArgs, context.env);
  assert.equal(denied.code, 1);
  assert.match(denied.stderr, /session has no pinned host trust/);
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
    assert.equal(envelope.schema_version, 2);
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
  const evidence = path.join(context.root, 'wrap.json');
  fs.writeFileSync(evidence, JSON.stringify({ summary: 'concurrent complete artifact' }));

  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => run([
    'record',
    ...common,
    '--type', 'wrap',
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

test('completion is blocked without an authoritative workflow', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'GATE-1', '--intent', 'Enforce completion gates', '--route', 'plan',
  ], context.env));

  const result = await run(['complete', ...common], context.env);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /authoritative workflow replay failed/);

  const status = parse(await run(['status', ...common], context.env));
  assert.equal(status.status, 'active');
});

test('record rejects undocumented statuses and removed lifecycle artifact types', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'EVIDENCE-1', '--intent', 'Validate gate evidence', '--route', 'direct',
  ], context.env));
  const unsupported = await run([
    'record', ...common, '--type', 'context', '--status', 'totally-invalid',
  ], context.env);
  assert.equal(unsupported.code, 1);
  assert.match(unsupported.stderr, /Unsupported artifact status/);

  for (const type of ['verification', 'review']) {
    const removed = await run([
      'record', ...common, '--type', type, '--status', 'passed', '--run', `empty-${type}`,
    ], context.env);
    assert.equal(removed.code, 1);
    assert.match(removed.stderr, new RegExp(`Unsupported artifact type: ${type}`));
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
  assert.equal(task.artifact.bundle_version, '3.0.0');
  assert.deepEqual(task.artifact.producer, { role: 'blade', compute_profile: 'balanced' });
  assert.equal(task.artifact.model_routing.requested_profile, 'balanced');
  assert.equal(task.artifact.model_routing.actual_profile, null);

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
    schema_version: 2,
    artifact_type: 'delegation-task',
    repo_id: started.repo_id,
    task_id: started.task_id,
    status: 'pending',
    created_at: started.created_at,
    updated_at: started.updated_at,
    bundle_version: started.bundle_version,
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
  const legacyResult = await run([
    'record',
    ...common,
    '--type', 'delegation-result',
    '--status', 'passed',
    '--run', 'LEGACY',
    '--input', resultFile,
  ], context.env);
  assert.equal(legacyResult.code, 1);
  assert.match(
    legacyResult.stderr,
    /Invalid delegation-task state envelope:.*record_sequence is required/,
  );
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
    ['oversize', (value) => { value.objective = 'é'.repeat(2_400); }, /maximum is 4800/],
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
    error: { code: 'TOO_LARGE', message: 'é'.repeat(1_000), retryable: false },
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
  assert.match(oversizedResult.stderr, /maximum is 2000/);
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
    assert.match(unauthorized.stderr, scenario.missing
      || /implementation authorization is missing.*authorize --scope implementation/s);
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
    parse(await run([
      'authorize', ...common, '--scope', 'implementation',
    ], context.env));
    const executed = parse(await run(['execute', ...common], context.env));
    assert.equal(executed.lifecycle.actions.execute.status, 'started');
  }
});

test('shipping authority cannot replace replayed graph readiness', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'AUTH-1', '--intent', 'Separate authorities', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);

  const unauthorizedShip = await run(['ship', ...common], context.env);
  assert.equal(unauthorizedShip.code, 1);
  assert.match(unauthorizedShip.stderr, /authoritative workflow replay failed/);
  parse(await run([
    'authorize', ...common, '--scope', 'ship-draft-pr',
  ], context.env));
  const stillDenied = await run(['ship', ...common], context.env);
  assert.equal(stillDenied.code, 1);
  assert.match(stillDenied.stderr, /authoritative workflow replay failed/);
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
  await recordApprovalArtifacts(context, 'plan');
  parse(await run(['approve', ...common, '--gate', 'plan'], context.env));
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

test('status and matching start reject legacy top-level plan-only mode fields', async () => {
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
    Object.assign(legacy, legacyMode);
    fs.writeFileSync(sessionFile, JSON.stringify(legacy));

    for (const args of [
      ['status', ...common],
      ['start', ...common, '--task', `LEGACY-${label}`, '--intent', intent, '--route', 'direct'],
    ]) {
      const denied = await run(args, context.env);
      assert.equal(denied.code, 1);
      assert.match(denied.stderr, new RegExp(`top-level ${label === 'mode' ? 'mode' : 'to_plan'} is unsupported`));
    }
  }
});

test('accepted workflows reject post-compile decisions and stale approved-plan bindings', async (t) => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const task = 'BOUND-WORKFLOW-1';
  parse(await run([
    'start', ...common, '--task', task, '--intent', 'Bind accepted workflow to approved plan', '--route', 'plan',
  ], context.env));
  await authorizeAndExecute(context, ['plan']);

  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = context.data;
  t.after(() => {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
  });
  const { compileWorkflowFile } = await import(pathToFileURL(path.join(
    __dirname, '..', 'skills', 'phantom', 'scripts', 'compile-workflow.mjs',
  )).href);
  const { advanceWorkflowFile } = await import(pathToFileURL(path.join(
    __dirname, '..', 'skills', 'phantom', 'scripts', 'advance-workflow.mjs',
  )).href);
  const workflowInput = path.join(context.root, 'bound-workflow.json');
  fs.writeFileSync(workflowInput, JSON.stringify({
    schema_version: 2,
    workflow_id: 'wf-bound-approved-plan',
    route: 'plan',
    risk: 'low',
    baseline_fingerprint: `sha256:${'0'.repeat(64)}`,
    routing: {
      recommended_route: 'plan', confidence: 0.95, fallback_route: null, signals: {},
    },
    execution_mode: 'attended',
    acceptance_criteria: ['current approved plan remains bound'],
    budget: { max_cost_units: 10, max_duration_ms: 10_000, max_attempts: 2 },
    nodes: [{
      id: 'implement',
      kind: 'task',
      depends_on: [],
      retry_limit: 0,
      budget: { max_cost_units: 5, max_duration_ms: 5_000 },
      role: 'blade',
      output_schema: 'workflow-output-v1',
      expected_artifacts: ['execution.json'],
      acceptance_criteria: ['bound work is complete'],
      allowed_paths: ['planning.md'],
      allowed_commands: [['git', 'status', '--short']],
      allowed_cwds: ['.'],
    }],
  }));
  compileWorkflowFile({ workspace: context.workspace, task, input: workflowInput });
  let eventSequence = 0;
  const advance = (input) => {
    eventSequence += 1;
    const file = path.join(context.root, `bound-event-${eventSequence}.json`);
    fs.writeFileSync(file, JSON.stringify(input));
    return advanceWorkflowFile({ workspace: context.workspace, task, input: file });
  };
  advance({ event_id: 'bound-start', event_type: 'workflow.started', payload: {} });
  advance({ event_id: 'bound-node-start', event_type: 'node.started', node_id: 'implement', payload: {} });
  const status = parse(await run(['status', ...common], context.env));
  const sessionDir = path.join(context.data, 'repos', status.repo_id, 'sessions', task);
  const artifactBytes = Buffer.from(`${JSON.stringify({
    schema_version: 1,
    node_id: 'implement',
    status: 'completed',
    evidence: [{ name: 'unit', result: 'passed' }],
    output: {},
  })}\n`);
  fs.writeFileSync(path.join(sessionDir, 'execution.json'), artifactBytes);
  const accepted = advance({
    event_id: 'bound-node-complete',
    event_type: 'node.completed',
    node_id: 'implement',
    artifact_refs: ['execution.json'],
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{
        artifact_ref: 'execution.json',
        digest: `sha256:${createHash('sha256').update(artifactBytes).digest('hex')}`,
      }],
      cost_units: 1,
      duration_ms: 10,
    },
  });
  assert.equal(accepted.state.status, 'accepted');

  for (const type of ['brainstorm', 'plan', 'decisions']) {
    const rejected = await run([
      'record', ...common, '--type', type, '--status', 'passed', '--input', workflowInput,
    ], context.env);
    assert.equal(rejected.code, 1, type);
    assert.match(rejected.stderr, new RegExp(`Cannot record ${type} after workflow compilation`));
  }

  const approvedPlanFile = path.join(sessionDir, 'plan.json');
  const newerPlan = JSON.parse(fs.readFileSync(approvedPlanFile, 'utf8'));
  newerPlan.record_sequence += 1;
  newerPlan.updated_at = new Date().toISOString();
  fs.writeFileSync(approvedPlanFile, JSON.stringify(newerPlan));
  for (const action of ['ship', 'complete']) {
    const denied = await run([action, ...common], context.env);
    assert.equal(denied.code, 1, action);
    assert.match(denied.stderr, /plan approval is stale for the current passed artifact/, action);
  }
  assert.equal(parse(await run(['status', ...common], context.env)).status, 'active');
});

test('current state rejects missing canonical pointer, session, intent, and lifecycle fields', async () => {
  for (const [label, mutate, expected] of [
    ['pointer v1', ({ pointer }) => { pointer.schema_version = 1; }, /pointer schema_version must be 2/],
    ['pointer session_dir', ({ pointer }) => { delete pointer.session_dir; }, /pointer session_dir must be/],
    ['session v1', ({ session }) => { session.schema_version = 1; }, /session\.json schema_version must be 2/],
    ['session route', ({ session }) => { delete session.route; }, /session\.json route must be/],
    ['session lifecycle', ({ session }) => { delete session.lifecycle; }, /session\.lifecycle must be an object/],
    ['intent v1', ({ intent }) => { intent.schema_version = 1; }, /intent\.json schema_version must be 2/],
    ['intent work_kind', ({ intent }) => { delete intent.work_kind; }, /intent\.json work_kind must be/],
  ]) {
    const context = fixture();
    const common = ['--workspace', context.workspace];
    const started = parse(await run([
      'start', ...common, '--task', `NONCANONICAL-${label}`, '--intent', 'Reject old state', '--route', 'direct',
    ], context.env));
    const pointerFile = path.join(context.data, 'state', 'current-session', `${started.repo_id}.json`);
    const originalPointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
    const sessionDirectory = originalPointer.session_dir;
    const files = {
      pointer: pointerFile,
      session: path.join(sessionDirectory, 'session.json'),
      intent: path.join(sessionDirectory, 'intent.json'),
    };
    const artifacts = Object.fromEntries(
      Object.entries(files).map(([name, file]) => [name, JSON.parse(fs.readFileSync(file, 'utf8'))]),
    );
    mutate(artifacts);
    for (const [name, file] of Object.entries(files)) {
      fs.writeFileSync(file, JSON.stringify(artifacts[name]));
    }

    const rejected = await run(['status', ...common], context.env);
    assert.equal(rejected.code, 1, label);
    assert.match(rejected.stderr, expected, label);
  }
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
  const blocked = await run([
    'authorize', ...common, '--scope', 'implementation',
  ], context.env);
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
  const retiredPlan = JSON.parse(fs.readFileSync(plan.file, 'utf8'));
  retiredPlan.schema_version = 1;
  fs.writeFileSync(plan.file, JSON.stringify(retiredPlan));
  const retired = await run(['approve', ...common, '--gate', 'plan'], context.env);
  assert.equal(retired.code, 1);
  assert.match(retired.stderr, /plan\.json schema_version must be 2/);

  retiredPlan.schema_version = 2;
  fs.writeFileSync(plan.file, JSON.stringify(retiredPlan));
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
  const stale = await run(['authorize', ...common, '--scope', 'implementation'], context.env);
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

test('record failures do not advance execution lifecycle state', async () => {
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

  const executionInput = path.join(context.root, 'atomic-execution.json');
  fs.writeFileSync(executionInput, JSON.stringify({ observation: 'not persisted on failure' }));
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
    'record', ...common, '--type', 'execution', '--status', 'pending',
    '--run', 'write-failure', '--input', executionInput,
  ], context.env);
  assert.equal(writeFailure.code, 1);
  assert.equal(parse(await run(['status', ...common], context.env)).lifecycle.actions.execute.status, 'pending');

  if (process.platform !== 'win32') {
    const pointerDirectory = path.join(context.data, 'state', 'current-session');
    const partialArtifact = path.join(runDirectory, 'state-write-failure', 'execution.json');
    fs.chmodSync(pointerDirectory, 0o555);
    let stateWriteFailure;
    try {
      stateWriteFailure = await run([
        'record', ...common, '--type', 'execution', '--status', 'pending',
        '--run', 'state-write-failure', '--input', executionInput,
      ], context.env);
    } finally {
      fs.chmodSync(pointerDirectory, 0o755);
    }
    assert.equal(stateWriteFailure.code, 1);
    assert.equal(fs.existsSync(partialArtifact), false);
    assert.equal(parse(await run(['status', ...common], context.env)).lifecycle.actions.execute.status, 'pending');
  }
});

test('legacy verification lifecycle fields are rejected instead of recovered', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start', ...common, '--task', 'ORDERED-1', '--intent', 'Order quality gates', '--route', 'direct',
  ], context.env));
  const sessionFile = path.join(
    context.data, 'repos', started.repo_id, 'sessions', started.task_id, 'session.json',
  );
  const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  session.lifecycle.actions.verify = { status: 'pending', decided_at: null };
  fs.writeFileSync(sessionFile, JSON.stringify(session));
  const rejected = await run(['status', ...common], context.env);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /session\.lifecycle\.actions\.verify is unsupported/);
});

test('worktree fingerprints use filesystem state and ignore Git-only index metadata', async () => {
  const context = fixture();
  const git = (...args) => execFileSync('git', ['-C', context.workspace, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const common = ['--workspace', context.workspace];
  parse(await run([
    'start', ...common, '--task', 'FINGERPRINT-1', '--intent', 'Cover worktree state', '--route', 'direct',
  ], context.env));
  await authorizeAndExecute(context);
  const baseline = await currentFingerprint(context);

  fs.writeFileSync(path.join(context.workspace, 'planning.md'), 'staged-only content\n');
  git('add', 'planning.md');
  fs.writeFileSync(path.join(context.workspace, 'planning.md'), '# Existing planning context\n');
  const stagedOnly = await currentFingerprint(context);
  assert.equal(stagedOnly, baseline);

  git('reset', '--', 'planning.md');
  if (process.platform !== 'win32') {
    fs.chmodSync(path.join(context.workspace, 'planning.md'), 0o755);
    const executable = await currentFingerprint(context);
    assert.notEqual(executable, baseline);
    fs.chmodSync(path.join(context.workspace, 'planning.md'), 0o644);
  }

  fs.unlinkSync(path.join(context.workspace, 'planning.md'));
  const deleted = await currentFingerprint(context);
  assert.notEqual(deleted, baseline);
  fs.writeFileSync(path.join(context.workspace, 'planning.md'), '# Existing planning context\n');

  fs.writeFileSync(path.join(context.workspace, 'untracked.txt'), 'untracked content\n');
  const untracked = await currentFingerprint(context);
  assert.notEqual(untracked, baseline);
  fs.unlinkSync(path.join(context.workspace, 'untracked.txt'));

  if (process.platform !== 'win32') {
    fs.symlinkSync('missing-target', path.join(context.workspace, 'dangling-link'));
    const dangling = await currentFingerprint(context);
    assert.notEqual(dangling, baseline);
  }

  const beforeGitlink = await currentFingerprint(context);
  const head = git('rev-parse', 'HEAD').toString('utf8').trim();
  git('update-index', '--add', '--cacheinfo', `160000,${head},vendor/submodule`);
  const gitlink = await currentFingerprint(context);
  assert.equal(gitlink, beforeGitlink);
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
