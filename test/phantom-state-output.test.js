// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const STATE = path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'phantom-state.mjs');
const MUTATION_RECEIPT_BYTES = 800;
const STATUS_PROJECTION_BYTES = 2_000;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-state-output-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'source.txt'), 'baseline\n');
  return { root, workspace, data, env: { ...process.env, PHANTOM_DATA: data } };
}

function run(args, context) {
  return spawnSync(process.execPath, [STATE, ...args], {
    env: context.env,
    encoding: 'utf8',
  });
}

function compact(result, maxBytes) {
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.endsWith('\n'), 'output has one trailing newline');
  assert.equal(result.stdout.trim().split('\n').length, 1, 'compact output is one JSON line');
  assert.ok(Buffer.byteLength(result.stdout) <= maxBytes, `output exceeds ${maxBytes} bytes`);
  return JSON.parse(result.stdout);
}

function filesUnder(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else files.push(file);
    }
  };
  visit(root);
  return files;
}

function treeSnapshot(root) {
  const snapshot = {};
  const visit = (file, relative = '') => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      snapshot[relative] = `link:${fs.readlinkSync(file)}`;
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file)) visit(path.join(file, name), path.join(relative, name));
    } else {
      snapshot[relative] = `file:${fs.readFileSync(file).toString('base64')}`;
    }
  };
  if (fs.existsSync(root)) visit(root);
  return snapshot;
}

function writeInput(context, name, payload) {
  const file = path.join(context.root, name);
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function gazeTask(runId) {
  return {
    contract_version: 2,
    task_id: `auditor-${runId}`,
    delegation_id: `auditor-${runId}-attempt-1`,
    role: 'auditor',
    profile: 'deep',
    risk: 'moderate',
    requires_judgment: true,
    objective: 'Independently review the verified work',
    locked_decisions: [], corrections: [], constraints: [],
    deliverables: ['Review verdict'], acceptance_criteria: ['Review completes'],
    write_scope: [], context_refs: [],
  };
}

function recordGazeTask(context, common, runId) {
  const task = gazeTask(runId);
  const input = writeInput(context, `${runId}-task.json`, task);
  compact(run([
    'record', ...common, '--type', 'delegation-task', '--status', 'pending',
    '--run', runId, '--input', input,
  ], context), MUTATION_RECEIPT_BYTES);
  return task;
}

function recordGazeResult(
  context,
  common,
  runId,
  task,
  { failed = false, findings = [], blocker = null } = {},
) {
  const result = {
    contract_version: 2,
    task_id: task.task_id,
    delegation_id: task.delegation_id,
    task_digest: crypto.createHash('sha256')
      .update(JSON.stringify(sortJson(task)))
      .digest('hex'),
    status: failed ? 'error' : 'ok',
    output: failed ? null : {
      summary: 'Independent review complete', files_changed: [], checks: [{
        name: 'user-verification-classification',
        status: 'passed',
        summary: 'The final diff is correctly classified for user verification',
      }],
      findings, risks: [], blocker,
    },
    error: failed ? { code: 'REVIEW_FAILED', message: 'Review failed', retryable: false } : null,
  };
  const input = writeInput(context, `${runId}-result.json`, result);
  compact(run([
    'record', ...common, '--type', 'delegation-result',
    '--status', failed ? 'failed' : 'passed', '--run', runId, '--input', input,
  ], context), MUTATION_RECEIPT_BYTES);
  return result;
}

function recordGazeDelegation(context, common, runId) {
  const task = recordGazeTask(context, common, runId);
  recordGazeResult(context, common, runId, task);
}

test('default lifecycle output is compact JSON while --json preserves the full result', () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  const empty = compact(run(['status', ...common], context), STATUS_PROJECTION_BYTES);
  assert.deepEqual(empty, {
    schema_version: 1,
    ok: true,
    command: 'status',
    status: 'none',
    next: 'start',
  });

  const started = compact(run([
    'start', ...common, '--task', 'OUTPUT-1', '--intent', 'Keep model-facing output compact', '--route', 'direct',
  ], context), MUTATION_RECEIPT_BYTES);
  assert.equal(started.command, 'start');
  assert.equal(started.status, 'active');
  assert.equal(started.task_id, 'OUTPUT-1');

  const status = compact(run(['status', ...common], context), STATUS_PROJECTION_BYTES);
  assert.equal(status.command, 'status');
  assert.equal(status.mode, 'standard');
  assert.deepEqual(status.authorizations, {
    implementation: 'pending',
    'ship-pr': 'pending',
  });
  assert.equal(status.next, 'authorize:implementation');

  const fingerprint = compact(run(['fingerprint', ...common], context), MUTATION_RECEIPT_BYTES);
  assert.match(fingerprint.worktree_fingerprint, /^sha256:[a-f0-9]{64}$/);

  assert.equal(compact(run(['pause', ...common], context), MUTATION_RECEIPT_BYTES).next, 'resume');
  assert.equal(compact(run(['resume', ...common], context), MUTATION_RECEIPT_BYTES).next, 'status');

  const full = run(['status', ...common, '--json'], context);
  assert.equal(full.status, 0, full.stderr);
  assert.ok(full.stdout.includes('\n  "'), 'full diagnostics retain the previous pretty JSON form');
  const fullStatus = JSON.parse(full.stdout);
  const sessionFile = path.join(
    context.data, 'repos', fullStatus.repo_id, 'sessions', 'OUTPUT-1', 'session.json',
  );
  assert.deepEqual(fullStatus, JSON.parse(fs.readFileSync(sessionFile, 'utf8')));
});

test('record receipts omit evidence and new sessions create no durable input duplicates', () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  compact(run([
    'start', ...common, '--task', 'OUTPUT-2', '--intent', 'Store one canonical payload', '--route', 'direct',
  ], context), MUTATION_RECEIPT_BYTES);
  const marker = `unique-evidence-${'x'.repeat(256)}`;
  const input = path.join(context.root, 'context-input.json');
  fs.writeFileSync(input, JSON.stringify({ note: marker }));

  const receiptResult = run([
    'record', ...common, '--type', 'context', '--status', 'pending', '--input', input,
  ], context);
  const receipt = compact(receiptResult, MUTATION_RECEIPT_BYTES);
  assert.deepEqual(receipt, {
    schema_version: 1,
    ok: true,
    command: 'record',
    artifact_type: 'context',
    status: 'pending',
    next: 'status',
  });
  assert.equal(receiptResult.stdout.includes(marker), false, 'default receipt does not echo evidence');

  const durableFiles = filesUnder(context.data);
  assert.deepEqual(
    durableFiles.filter((file) => /-input\.json$/.test(file)),
    [],
    'new sessions never create durable raw-input copies',
  );
  assert.equal(
    durableFiles.filter((file) => fs.readFileSync(file).includes(marker)).length,
    1,
    'the canonical artifact is the only durable copy of the input payload',
  );
});

test('session-local transport inputs fail without mutation while the canonical same path is supported', () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  compact(run([
    'start', ...common, '--task', 'OUTPUT-LOCAL', '--intent', 'Reject durable transport copies', '--route', 'direct',
  ], context), MUTATION_RECEIPT_BYTES);
  const full = JSON.parse(run(['status', ...common, '--json'], context).stdout);
  const sessionDirectory = path.join(
    context.data, 'repos', full.repo_id, 'sessions', 'OUTPUT-LOCAL',
  );
  const transport = path.join(sessionDirectory, 'context-input.json');
  const transportBytes = JSON.stringify({ note: 'must remain transport-only' });
  fs.writeFileSync(transport, transportBytes);

  const rejected = run([
    'record', ...common, '--type', 'context', '--status', 'pending', '--input', transport,
  ], context);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /cannot use a transport file inside the active session.*external temporary path/s);
  assert.equal(fs.readFileSync(transport, 'utf8'), transportBytes, 'rejection is non-destructive');
  assert.equal(fs.existsSync(path.join(sessionDirectory, 'context.json')), false);

  const canonical = path.join(sessionDirectory, 'context.json');
  fs.writeFileSync(canonical, JSON.stringify({ note: 'canonical same-path update' }));
  const accepted = compact(run([
    'record', ...common, '--type', 'context', '--status', 'pending', '--input', canonical,
  ], context), MUTATION_RECEIPT_BYTES);
  assert.equal(accepted.artifact_type, 'context');
  assert.equal(JSON.parse(fs.readFileSync(canonical, 'utf8')).evidence.note, 'canonical same-path update');
});

test('record contains --run to one portable session-local path segment without mutation', () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  compact(run([
    'start', ...common, '--task', 'OUTPUT-RUN', '--intent', 'Contain run artifacts', '--route', 'direct',
  ], context), MUTATION_RECEIPT_BYTES);

  for (const runId of ['../escape', 'nested/run', 'nested\\run', '/tmp/escape', '.', '..', 'C:\\escape', 'run name']) {
    const before = treeSnapshot(context.data);
    const rejected = run([
      'record', ...common, '--type', 'execution', '--status', 'pending', '--run', runId,
    ], context);
    assert.equal(rejected.status, 1, runId);
    assert.match(rejected.stderr, /one portable path segment/, runId);
    assert.deepEqual(treeSnapshot(context.data), before, `${runId} must not mutate state`);
  }

  const full = JSON.parse(run(['status', ...common, '--json'], context).stdout);
  const sessionDirectory = path.join(context.data, 'repos', full.repo_id, 'sessions', 'OUTPUT-RUN');
  const runsDirectory = path.join(sessionDirectory, 'runs');
  const outside = path.join(context.root, 'outside-runs');
  fs.mkdirSync(runsDirectory, { recursive: true });
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(runsDirectory, 'escape'));
  const before = treeSnapshot(context.data);
  const escaped = run([
    'record', ...common, '--type', 'execution', '--status', 'pending', '--run', 'escape',
  ], context);
  assert.equal(escaped.status, 1);
  assert.match(escaped.stderr, /resolves outside the active session runs directory/);
  assert.deepEqual(treeSnapshot(context.data), before, 'symlink escape must not mutate state');
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('review recording requires explicit auditor provenance and never nudges shipping implicitly', () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  compact(run([
    'start', ...common, '--task', 'OUTPUT-REVIEW', '--intent', 'Require explicit review provenance', '--route', 'direct',
  ], context), MUTATION_RECEIPT_BYTES);
  compact(run(['authorize', ...common, '--scope', 'implementation'], context), MUTATION_RECEIPT_BYTES);
  compact(run(['execute', ...common], context), MUTATION_RECEIPT_BYTES);
  compact(run(['verify', ...common], context), MUTATION_RECEIPT_BYTES);
  recordGazeDelegation(context, common, 'pre-verification-review');
  const verification = writeInput(context, 'review-verification.json', {
    checks: [{ name: 'focused', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  });
  compact(run([
    'record', ...common, '--type', 'verification', '--status', 'passed',
    '--run', 'verification', '--input', verification,
  ], context), MUTATION_RECEIPT_BYTES);
  const review = writeInput(context, 'explicit-review.json', {
    verdict: 'pass', findings: [], specialists: [],
  });

  const preVerification = run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'pre-verification-review', '--role', 'auditor', '--input', review,
  ], context);
  assert.equal(preVerification.status, 1);
  assert.match(preVerification.stderr, /Auditor delegation task must be recorded after authoritative verification/);

  for (const roleArgs of [[], ['--role', 'engineer'], ['--role', 'chief']]) {
    const rejected = run([
      'record', ...common, '--type', 'review', '--status', 'passed',
      '--run', `rejected-${roleArgs[1] || 'omitted'}`, ...roleArgs, '--input', review,
    ], context);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /explicit independent role provenance via --role auditor/);
  }

  const missingRun = run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--role', 'auditor', '--input', review,
  ], context);
  assert.equal(missingRun.status, 1);
  assert.match(missingRun.stderr, /requires explicit --run/);

  const missingResultTask = recordGazeTask(context, common, 'missing-result');
  assert.ok(missingResultTask);
  const missingResult = run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'missing-result', '--role', 'auditor', '--input', review,
  ], context);
  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /same-run delegation-result\.json is missing/);

  const failedTask = recordGazeTask(context, common, 'failed-result');
  recordGazeResult(context, common, 'failed-result', failedTask, { failed: true });
  const failedResult = run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'failed-result', '--role', 'auditor', '--input', review,
  ], context);
  assert.equal(failedResult.status, 1);
  assert.match(failedResult.stderr, /result envelope status must be passed|result evidence status must be ok/);

  const wrongRoleTask = { ...gazeTask('wrong-delegation-role'), role: 'engineer' };
  const wrongRoleTaskInput = writeInput(context, 'wrong-role-task.json', wrongRoleTask);
  compact(run([
    'record', ...common, '--type', 'delegation-task', '--status', 'pending',
    '--run', 'wrong-delegation-role', '--input', wrongRoleTaskInput,
  ], context), MUTATION_RECEIPT_BYTES);
  recordGazeResult(context, common, 'wrong-delegation-role', wrongRoleTask);
  const wrongDelegationRole = run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'wrong-delegation-role', '--role', 'auditor', '--input', review,
  ], context);
  assert.equal(wrongDelegationRole.status, 1);
  assert.match(wrongDelegationRole.stderr, /task evidence role must be auditor|result producer role must be auditor/);

  const tamperedTask = recordGazeTask(context, common, 'tampered-result');
  recordGazeResult(context, common, 'tampered-result', tamperedTask);
  const full = JSON.parse(run(['status', ...common, '--json'], context).stdout);
  const tamperedResultFile = path.join(
    context.data, 'repos', full.repo_id, 'sessions', 'OUTPUT-REVIEW',
    'runs', 'tampered-result', 'delegation-result.json',
  );
  const tamperedResult = JSON.parse(fs.readFileSync(tamperedResultFile, 'utf8'));
  tamperedResult.evidence.delegation_id = 'mismatched-attempt';
  fs.writeFileSync(tamperedResultFile, JSON.stringify(tamperedResult));
  const mismatched = run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'tampered-result', '--role', 'auditor', '--input', review,
  ], context);
  assert.equal(mismatched.status, 1);
  assert.match(mismatched.stderr, /delegation_id must match the task/);

  const blockedTask = recordGazeTask(context, common, 'blocked-auditor-review');
  recordGazeResult(context, common, 'blocked-auditor-review', blockedTask, {
    findings: ['P0 destructive defect'], blocker: 'P0 data loss',
  });
  const contradictory = run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'blocked-auditor-review', '--role', 'auditor', '--input', review,
  ], context);
  assert.equal(contradictory.status, 1);
  assert.match(contradictory.stderr, /cannot accept an Auditor result with a blocker/);

  const mismatchTask = recordGazeTask(context, common, 'finding-mismatch-review');
  recordGazeResult(context, common, 'finding-mismatch-review', mismatchTask, {
    findings: ['P1 behavior mismatch'],
  });
  const omittedFinding = run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'finding-mismatch-review', '--role', 'auditor', '--input', review,
  ], context);
  assert.equal(omittedFinding.status, 1);
  assert.match(omittedFinding.stderr, /findings must exactly match/);

  const acceptedFindings = ['P2 acknowledged follow-up'];
  const acceptedReview = writeInput(context, 'matching-review.json', {
    verdict: 'pass', findings: acceptedFindings, specialists: [],
  });
  const matchingTask = recordGazeTask(context, common, 'auditor-review');
  recordGazeResult(context, common, 'auditor-review', matchingTask, { findings: acceptedFindings });
  const accepted = compact(run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'auditor-review', '--role', 'auditor', '--input', acceptedReview,
  ], context), MUTATION_RECEIPT_BYTES);
  assert.equal(accepted.next, 'complete-or-request-shipping');

  const gazeResultFile = path.join(
    context.data, 'repos', full.repo_id, 'sessions', 'OUTPUT-REVIEW',
    'runs', 'auditor-review', 'delegation-result.json',
  );
  const gazeResult = JSON.parse(fs.readFileSync(gazeResultFile, 'utf8'));
  const reviewFile = path.join(path.dirname(gazeResultFile), 'review.json');
  const persistedReview = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
  assert.ok(persistedReview.review_provenance.verification_sequence
    < persistedReview.review_provenance.task_sequence);
  assert.ok(persistedReview.review_provenance.task_sequence
    < persistedReview.review_provenance.result_sequence);

  const mismatchedReview = structuredClone(persistedReview);
  mismatchedReview.evidence.findings = [];
  fs.writeFileSync(reviewFile, JSON.stringify(mismatchedReview));
  assert.equal(compact(run(['status', ...common], context), STATUS_PROJECTION_BYTES).next, 'record:review');
  const contentBlocked = run(['complete', ...common], context);
  assert.equal(contentBlocked.status, 1);
  assert.match(contentBlocked.stderr, /findings must exactly match/);
  fs.writeFileSync(reviewFile, JSON.stringify(persistedReview));

  const temporallyTamperedReview = structuredClone(persistedReview);
  temporallyTamperedReview.review_provenance.verification_sequence -= 1;
  fs.writeFileSync(reviewFile, JSON.stringify(temporallyTamperedReview));
  assert.equal(compact(run(['status', ...common], context), STATUS_PROJECTION_BYTES).next, 'record:review');
  const temporalBlocked = run(['complete', ...common], context);
  assert.equal(temporalBlocked.status, 1);
  assert.match(temporalBlocked.stderr, /delegation provenance is stale or tampered/);
  fs.writeFileSync(reviewFile, JSON.stringify(persistedReview));

  gazeResult.evidence.output.summary = 'tampered after review';
  fs.writeFileSync(gazeResultFile, JSON.stringify(gazeResult));
  assert.equal(compact(run(['status', ...common], context), STATUS_PROJECTION_BYTES).next, 'record:review');
  const blocked = run(['complete', ...common], context);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /delegation provenance is stale or tampered/);
});

test('compact status derives the authoritative verification and review next action', () => {
  const context = fixture();
  const common = ['--workspace', context.workspace];
  compact(run([
    'start', ...common, '--task', 'OUTPUT-STATUS', '--intent', 'Project authoritative gates', '--route', 'direct',
  ], context), MUTATION_RECEIPT_BYTES);
  compact(run(['authorize', ...common, '--scope', 'implementation'], context), MUTATION_RECEIPT_BYTES);
  compact(run(['execute', ...common], context), MUTATION_RECEIPT_BYTES);
  compact(run(['verify', ...common], context), MUTATION_RECEIPT_BYTES);

  compact(run([
    'record', ...common, '--type', 'verification', '--status', 'failed', '--run', 'failed-verification',
  ], context), MUTATION_RECEIPT_BYTES);
  assert.equal(compact(run(['status', ...common], context), STATUS_PROJECTION_BYTES).next, 'resolve:verification');

  const verification = writeInput(context, 'passed-verification.json', {
    checks: [{ name: 'focused', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  });
  compact(run([
    'record', ...common, '--type', 'verification', '--status', 'passed',
    '--run', 'passed-verification', '--input', verification,
  ], context), MUTATION_RECEIPT_BYTES);
  assert.equal(compact(run(['status', ...common], context), STATUS_PROJECTION_BYTES).next, 'record:review');

  const review = writeInput(context, 'passed-review.json', {
    verdict: 'pass', findings: [], specialists: [],
  });
  recordGazeDelegation(context, common, 'first-review');
  compact(run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'first-review', '--role', 'auditor', '--input', review,
  ], context), MUTATION_RECEIPT_BYTES);
  assert.equal(
    compact(run(['status', ...common], context), STATUS_PROJECTION_BYTES).next,
    'complete-or-request-shipping',
  );

  compact(run([
    'record', ...common, '--type', 'verification', '--status', 'passed',
    '--run', 'newer-verification', '--input', verification,
  ], context), MUTATION_RECEIPT_BYTES);
  assert.equal(compact(run(['status', ...common], context), STATUS_PROJECTION_BYTES).next, 'record:review');

  recordGazeDelegation(context, common, 'fresh-review');
  compact(run([
    'record', ...common, '--type', 'review', '--status', 'passed',
    '--run', 'fresh-review', '--role', 'auditor', '--input', review,
  ], context), MUTATION_RECEIPT_BYTES);
  assert.equal(
    compact(run(['status', ...common], context), STATUS_PROJECTION_BYTES).next,
    'complete-or-request-shipping',
  );
});

test('--json mutation output remains the exact persisted full envelope', () => {
  const context = fixture();
  const result = run([
    'start', '--workspace', context.workspace, '--task', 'OUTPUT-JSON',
    '--intent', 'Preserve full automation output', '--route', 'direct', '--json',
  ], context);
  assert.equal(result.status, 0, result.stderr);
  const full = JSON.parse(result.stdout);
  const persisted = JSON.parse(fs.readFileSync(path.join(
    context.data, 'repos', full.repo_id, 'sessions', 'OUTPUT-JSON', 'session.json',
  ), 'utf8'));
  assert.deepEqual(full, persisted);
  assert.ok(Buffer.byteLength(result.stdout) > Buffer.byteLength(JSON.stringify({
    schema_version: 1,
    ok: true,
    command: 'start',
    status: 'active',
    task_id: 'OUTPUT-JSON',
    next: 'status',
  })));
});
