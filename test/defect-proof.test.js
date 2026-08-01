// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const STATE = path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'phantom-state.mjs');
const DEFECT_PROOF = path.join(
  __dirname,
  '..',
  'skills',
  'phantom',
  'scripts',
  'lib',
  'defect-proof.mjs',
);
let authoritySequence = 0;

function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STATE, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function parse(result) {
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-defect-proof-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'source.txt'), 'baseline\n');
  execFileSync('git', ['init', '-q', '-b', 'feat/defect-proof'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'phantom@example.invalid'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Subash Karki'], { cwd: workspace });
  execFileSync('git', ['add', 'source.txt'], { cwd: workspace });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: workspace });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  fs.mkdirSync(path.join(data, 'config'), { recursive: true });
  fs.writeFileSync(path.join(data, 'config', 'authority-trust.json'), JSON.stringify({
    schema_version: 1,
    key_id: 'defect-proof-key',
    source: 'defect-proof-host',
    public_key: publicKey.export({ type: 'spki', format: 'pem' }),
  }));
  return { root, workspace, data, privateKey, env: { PHANTOM_DATA: data } };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function authorizeImplementation(context) {
  const pointerDirectory = path.join(context.data, 'state', 'current-session');
  const pointerFile = fs.readdirSync(pointerDirectory)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => path.join(pointerDirectory, entry))[0];
  const pointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
  const fingerprint = parse(await run([
    'fingerprint', '--workspace', context.workspace,
  ], context.env)).worktree_fingerprint;
  authoritySequence += 1;
  const issuedAt = new Date();
  const unsigned = {
    schema_version: 1,
    repo_id: pointer.repo_id,
    task_id: pointer.task_id,
    decision_kind: 'authorization',
    gate: null,
    scope: 'implementation',
    decision: 'authorized',
    worktree_fingerprint: fingerprint,
    approval_artifact_bindings: [],
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
    actor: 'defect-proof-test-user',
    source: 'defect-proof-host',
    source_event_id: `defect-proof-source-${authoritySequence}`,
    replay_id: `defect-proof-replay-${authoritySequence}`,
    key_id: 'defect-proof-key',
  };
  const decision = {
    ...unsigned,
    signature: sign(null, Buffer.from(canonicalJson(unsigned)), context.privateKey).toString('base64'),
  };
  const file = path.join(context.root, `authority-${authoritySequence}.json`);
  fs.writeFileSync(file, JSON.stringify(decision));
  return parse(await run([
    'authorize', '--workspace', context.workspace, '--scope', 'implementation', '--decision', file,
  ], context.env));
}

function writeEvidence(sessionDirectory) {
  const logs = path.join(sessionDirectory, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'reproduction.txt'), 'observed failure\n');
  fs.writeFileSync(path.join(logs, 'trace.txt'), 'causal trace\n');
}

function readyProof(started, fingerprint, diagnosticGrant = null) {
  const observedAt = new Date(Date.now() - 2_000).toISOString();
  return {
    _meta: {
      version: 1,
      writtenAt: new Date().toISOString(),
      repoId: started.repo_id,
      taskId: started.task_id,
      baselineFingerprint: fingerprint,
    },
    workKind: 'investigation',
    state: 'ready_for_fix',
    verdict: 'confirmed_defect',
    reproduction: {
      status: 'observed',
      scenario: 'node reproduce.mjs',
      expected: 'request succeeds',
      actual: 'request fails',
      observedAt,
      evidenceRefs: ['logs/reproduction.txt'],
    },
    rootCause: {
      status: 'confirmed',
      exactCodePath: ['src/entry.ts:handler', 'src/core.ts:transform'],
      claim: 'transform drops the required value',
      evidenceRefs: ['logs/trace.txt'],
      confirmedByUser: true,
      confirmedAt: new Date().toISOString(),
    },
    focusedRegressionCheck: {
      commandOrScenario: 'npm test -- failing-case',
      preFixStatus: 'failed',
      evidenceRefs: ['logs/reproduction.txt'],
    },
    diagnosticGrant,
    missingEvidence: [],
    nextObservation: null,
  };
}

function grant(overrides = {}) {
  const now = Date.now();
  return {
    grantedBy: 'user',
    objective: 'Observe the failing request boundary',
    grantedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    revokedAt: null,
    allowedActions: ['add temporary logging'],
    allowedPaths: ['src/request.ts'],
    baselineFingerprint: `sha256:${'a'.repeat(64)}`,
    cleanupRequired: false,
    instrumentation: [],
    cleanupStatus: 'not_required',
    cleanedAt: null,
    cleanupEvidenceRefs: [],
    cleanupApprovedBy: null,
    cleanupApprovedAt: null,
    ...overrides,
  };
}

test('work kind is explicit or conservatively detected', async () => {
  const { resolveWorkKind } = await import(pathToFileURL(DEFECT_PROOF).href);
  assert.equal(resolveWorkKind(undefined, 'Investigate this regression'), 'investigation');
  assert.equal(resolveWorkKind(undefined, 'Build pagination'), 'implementation');
  assert.equal(resolveWorkKind('implementation', 'Fix this bug'), 'investigation');
  assert.throws(() => resolveWorkKind('unknown', 'Fix this bug'), /work-kind must be/);
});

test('DiagnosticGrant validation rejects expiry, revocation, and scope escape', async () => {
  const { diagnosticGrantErrors } = await import(pathToFileURL(DEFECT_PROOF).href);
  const nowMs = Date.now();
  assert.deepEqual(diagnosticGrantErrors(grant(), { nowMs }), []);

  assert.ok(diagnosticGrantErrors(grant({
    expiresAt: new Date(nowMs - 1).toISOString(),
  }), { nowMs }).some((error) => error.includes('expired')));

  assert.ok(diagnosticGrantErrors(grant({
    revokedAt: new Date(nowMs - 1).toISOString(),
  }), { nowMs }).some((error) => error.includes('revoked')));

  assert.ok(diagnosticGrantErrors(grant({
    objective: '',
  }), { nowMs }).some((error) => error.includes('objective')));

  assert.ok(diagnosticGrantErrors(grant({
    cleanupRequired: undefined,
  }), { nowMs }).some((error) => error.includes('cleanupRequired')));

  assert.ok(diagnosticGrantErrors(grant({
    cleanupRequired: false,
    cleanupStatus: 'cleaned',
    cleanedAt: new Date().toISOString(),
    cleanupEvidenceRefs: ['logs/cleanup.txt'],
  }), { nowMs }).some((error) => error.includes('must be not_required')));

  assert.ok(diagnosticGrantErrors(grant({
    cleanupRequired: true,
  }), { nowMs }).some((error) => error.includes('cannot be not_required')));

  assert.ok(diagnosticGrantErrors(grant({
    cleanupRequired: true,
    instrumentation: [{
      action: 'add temporary logging',
      path: 'src/other.ts',
      evidenceRefs: ['logs/instrumentation.txt'],
    }],
    cleanupStatus: 'cleaned',
    cleanedAt: new Date().toISOString(),
    cleanupEvidenceRefs: ['logs/cleanup.txt'],
  }), { nowMs }).some((error) => error.includes('outside allowedPaths')));

  const scopeErrors = diagnosticGrantErrors(grant({
    allowedActions: null,
    allowedPaths: null,
    instrumentation: [{ action: 'log', path: 'src/a.ts', evidenceRefs: ['log.txt'] }],
  }), { nowMs });
  assert.ok(scopeErrors.some((error) => error.includes('allowedActions must be')));
  assert.ok(scopeErrors.some((error) => error.includes('allowedPaths must contain')));
  assert.ok(!scopeErrors.some((error) => error.includes('outside allowedActions')));
  assert.ok(!scopeErrors.some((error) => error.includes('outside allowedPaths')));
});

test('DiagnosticGrant evidence references must resolve to session files', async () => {
  const { diagnosticGrantErrors } = await import(pathToFileURL(DEFECT_PROOF).href);
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-grant-evidence-'));
  const logs = path.join(sessionDir, 'logs');
  fs.mkdirSync(logs);
  fs.writeFileSync(path.join(logs, 'instrumentation.txt'), 'captured output\n');
  fs.writeFileSync(path.join(logs, 'cleanup.txt'), 'cleanup diff\n');
  const nowMs = Date.now();
  const validGrant = grant({
    cleanupRequired: true,
    instrumentation: [{
      action: 'add temporary logging',
      path: 'src/request.ts',
      evidenceRefs: ['logs/instrumentation.txt'],
    }],
    cleanupStatus: 'cleaned',
    cleanedAt: new Date().toISOString(),
    cleanupEvidenceRefs: ['logs/cleanup.txt'],
  });
  assert.deepEqual(diagnosticGrantErrors(validGrant, { nowMs, sessionDir }), []);

  validGrant.instrumentation[0].evidenceRefs = ['logs/missing.txt'];
  assert.ok(diagnosticGrantErrors(validGrant, { nowMs, sessionDir })
    .some((error) => error.includes('instrumentation[0].evidenceRefs[0] does not reference')));

  validGrant.instrumentation[0].evidenceRefs = ['logs/instrumentation.txt'];
  validGrant.cleanupEvidenceRefs = ['../outside.txt'];
  assert.ok(diagnosticGrantErrors(validGrant, { nowMs, sessionDir })
    .some((error) => error.includes('cleanupEvidenceRefs[0] must be a normalized')));
});

test('defect proof requires failed pre-fix regression evidence', async () => {
  const { defectProofErrors } = await import(pathToFileURL(DEFECT_PROOF).href);
  const fingerprint = `sha256:${'b'.repeat(64)}`;
  const proof = readyProof({ repo_id: 'repo-1', task_id: 'task-1' }, fingerprint);
  proof.focusedRegressionCheck.preFixStatus = 'passed';
  proof.focusedRegressionCheck.evidenceRefs = [];
  const errors = defectProofErrors(proof, {
    repoId: 'repo-1',
    taskId: 'task-1',
    baselineFingerprint: fingerprint,
  });
  assert.ok(errors.some((error) => error.includes('preFixStatus must be failed')));
  assert.ok(errors.some((error) => error.includes('evidenceRefs must be non-empty')));
});

test('defect proof evidence references must resolve to session files', async () => {
  const { defectProofErrors } = await import(pathToFileURL(DEFECT_PROOF).href);
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-proof-evidence-'));
  const fingerprint = `sha256:${'b'.repeat(64)}`;
  const proof = readyProof({ repo_id: 'repo-1', task_id: 'task-1' }, fingerprint);
  writeEvidence(sessionDir);
  const context = {
    repoId: 'repo-1',
    taskId: 'task-1',
    baselineFingerprint: fingerprint,
    sessionDir,
  };
  assert.deepEqual(defectProofErrors(proof, context), []);

  proof.rootCause.evidenceRefs = ['logs/missing.txt'];
  assert.ok(defectProofErrors(proof, context)
    .some((error) => error.includes('rootCause.evidenceRefs[0] does not reference an existing file')));

  proof.rootCause.evidenceRefs = ['../outside.txt'];
  assert.ok(defectProofErrors(proof, context)
    .some((error) => error.includes('must be a normalized session-relative path')));

  const outside = path.join(path.dirname(sessionDir), 'outside.txt');
  fs.writeFileSync(outside, 'outside session\n');
  fs.symlinkSync(outside, path.join(sessionDir, 'logs', 'escape.txt'));
  proof.rootCause.evidenceRefs = ['logs/escape.txt'];
  assert.ok(defectProofErrors(proof, context)
    .some((error) => error.includes('resolves outside the active session directory')));
});

test('fingerprint command reports the canonical workspace and sha256 fingerprint', async () => {
  const context = fixture();
  const result = parse(await run([
    'fingerprint',
    '--workspace', context.workspace,
  ], context.env));
  assert.equal(result.schema_version, 1);
  assert.equal(result.workspace, fs.realpathSync(context.workspace));
  assert.match(result.worktree_fingerprint, /^sha256:[a-f0-9]{64}$/);
});

test('portable execute fails closed until current confirmed defect proof exists', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start',
    ...common,
    '--task', 'BUG-1',
    '--intent', 'Fix the request regression',
    '--work-kind', 'implementation',
    '--route', 'direct',
  ], context.env));
  assert.equal(started.work_kind, 'investigation');

  const sessionDirectory = path.join(
    context.data,
    'repos',
    started.repo_id,
    'sessions',
    started.task_id,
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(sessionDirectory, 'intent.json'), 'utf8')).work_kind,
    'investigation',
  );

  await authorizeImplementation(context);
  const blocked = await run(['execute', ...common], context.env);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /defect proof is not ready.*waiting_for_evidence/s);

  const { worktreeFingerprint } = await import(pathToFileURL(STATE).href);
  const fingerprint = worktreeFingerprint(fs.realpathSync(context.workspace));
  writeEvidence(sessionDirectory);
  fs.writeFileSync(
    path.join(sessionDirectory, 'defect-proof.json'),
    JSON.stringify(readyProof(started, fingerprint)),
  );
  const executed = parse(await run(['execute', ...common], context.env));
  assert.equal(executed.lifecycle.actions.execute.status, 'started');
});

test('portable execute rejects classification artifact tampering', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start',
    ...common,
    '--task', 'FEATURE-1',
    '--intent', 'Build request pagination',
    '--route', 'direct',
  ], context.env));
  await authorizeImplementation(context);

  const sessionDirectory = path.join(
    context.data,
    'repos',
    started.repo_id,
    'sessions',
    started.task_id,
  );
  const intentFile = path.join(sessionDirectory, 'intent.json');
  const intent = JSON.parse(fs.readFileSync(intentFile, 'utf8'));
  intent.work_kind = 'investigation';
  fs.writeFileSync(intentFile, JSON.stringify(intent));

  const blocked = await run(['execute', ...common], context.env);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /intent\.json work_kind must match session work_kind/);
});

test('portable execute rejects legacy classification artifacts without current work_kind metadata', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start',
    ...common,
    '--task', 'LEGACY-1',
    '--intent', 'Build request pagination',
    '--route', 'direct',
  ], context.env));
  await authorizeImplementation(context);

  const sessionDirectory = path.join(
    context.data,
    'repos',
    started.repo_id,
    'sessions',
    started.task_id,
  );
  for (const file of ['session.json', 'intent.json']) {
    const artifactFile = path.join(sessionDirectory, file);
    const artifact = JSON.parse(fs.readFileSync(artifactFile, 'utf8'));
    artifact.bundle_version = '2.1.0';
    delete artifact.work_kind;
    fs.writeFileSync(artifactFile, JSON.stringify(artifact));
  }

  const rejected = await run(['execute', ...common], context.env);
  assert.equal(rejected.code, 1);
  assert.match(
    rejected.stderr,
    /session\.json bundle_version must be 3\.0\.0.*session\.json work_kind must be implementation\|investigation/s,
  );
});

test('portable execute rejects missing work_kind in current classification artifacts', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start',
    ...common,
    '--task', 'CURRENT-1',
    '--intent', 'Build request pagination',
    '--route', 'direct',
  ], context.env));
  await authorizeImplementation(context);

  const intentFile = path.join(
    context.data,
    'repos',
    started.repo_id,
    'sessions',
    started.task_id,
    'intent.json',
  );
  const intent = JSON.parse(fs.readFileSync(intentFile, 'utf8'));
  delete intent.work_kind;
  fs.writeFileSync(intentFile, JSON.stringify(intent));

  const blocked = await run(['execute', ...common], context.env);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /intent\.json work_kind must be implementation\|investigation/);
});

test('portable execute rejects a session downgrade after defect classification', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start',
    ...common,
    '--task', 'BUG-2',
    '--intent', 'Fix this bug',
    '--work-kind', 'implementation',
    '--route', 'direct',
  ], context.env));
  assert.equal(started.work_kind, 'investigation');
  await authorizeImplementation(context);

  const sessionFile = path.join(
    context.data,
    'repos',
    started.repo_id,
    'sessions',
    started.task_id,
    'session.json',
  );
  const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  session.work_kind = 'implementation';
  fs.writeFileSync(sessionFile, JSON.stringify(session));

  const blocked = await run(['execute', ...common], context.env);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /intent\.json work_kind must match session work_kind/);
});

test('waiting_for_evidence remains resumable without weakening execute', async () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const started = parse(await run([
    'start',
    ...common,
    '--task', 'DEFECT-2',
    '--intent', 'Investigate this defect',
    '--route', 'direct',
  ], context.env));
  const proofFile = path.join(
    context.data,
    'repos',
    started.repo_id,
    'sessions',
    started.task_id,
    'defect-proof.json',
  );
  const waiting = JSON.stringify({
    workKind: 'investigation',
    state: 'waiting_for_evidence',
    verdict: 'unconfirmed_defect',
  });
  fs.writeFileSync(proofFile, waiting);

  parse(await run(['pause', ...common, '--reason', 'Need reproduction evidence'], context.env));
  const resumed = parse(await run(['resume', ...common], context.env));
  assert.equal(resumed.status, 'active');
  assert.equal(resumed.work_kind, 'investigation');
  assert.equal(fs.readFileSync(proofFile, 'utf8'), waiting);

  await authorizeImplementation(context);
  const blocked = await run(['execute', ...common], context.env);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /state must be ready_for_fix/);
});
