// Author: Subash Karki
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { generateKeyPairSync, sign } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, 'skills/phantom/scripts/phantom-state.mjs');
let atomicWriteJson;
let authorizeCapability;
let appendWorkflowEvent;
let capabilityRequestDigest;
let compileWorkflow;
let executeAuthorizedCapability;
let finalizeClaimedCapability;
let runCapabilityBroker;
let sessionPaths;
let validateCapabilityRequest;
let protectedBranches;
let worktreeFingerprint;
let workflowPaths;
let writeCompiledWorkflow;

before(async () => {
  ({ authorizeCapability, capabilityRequestDigest, validateCapabilityRequest } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/lib/capability-contracts.mjs')).href
  ));
  ({ executeAuthorizedCapability, finalizeClaimedCapability, runCapabilityBroker } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/authorize-capability.mjs')).href
  ));
  ({ atomicWriteJson, sessionPaths } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/lib/portable.mjs')).href
  ));
  ({ protectedBranches, worktreeFingerprint } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/phantom-state.mjs')).href
  ));
  ({ compileWorkflow } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/lib/workflow-kernel.mjs')).href
  ));
  ({ appendWorkflowEvent, workflowPaths, writeCompiledWorkflow } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/lib/workflow-journal.mjs')).href
  ));
});

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
let authoritySequence = 0;
let probeSequence = 0;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function writeInterceptionProbe({ paths, fingerprint, privateKey }) {
  probeSequence += 1;
  const issuedAt = new Date();
  const unsigned = {
    schema_version: 1,
    probe_kind: 'native-tool-interception',
    repo_id: paths.repo.id,
    task_id: paths.task,
    worktree_fingerprint: fingerprint,
    adapter_binding: 'native-tool-gate-v1',
    capabilities: { 'lifecycle.hooks': 'available' },
    hooks: { pre_tool_use: 'enforced', post_tool_use: 'enforced' },
    host: 'capability-policy-test-host',
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
    source: 'capability-policy-test-host',
    source_event_id: `probe-source-${probeSequence}`,
    replay_id: `probe-replay-${probeSequence}`,
    key_id: 'capability-policy-test-key',
  };
  const probe = {
    ...unsigned,
    signature: sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString('base64'),
  };
  const file = path.join(paths.sessionDir, 'capability-probe.json');
  atomicWriteJson(file, probe);
  return { file, probe };
}

function initializeAuthorizedSession({ workspace, data, task, scopes }) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const trustDirectory = path.join(data, 'config');
  fs.mkdirSync(trustDirectory, { recursive: true });
  fs.writeFileSync(path.join(trustDirectory, 'authority-trust.json'), JSON.stringify({
    schema_version: 1,
    key_id: 'capability-policy-test-key',
    source: 'capability-policy-test-host',
    public_key: publicKey.export({ type: 'spki', format: 'pem' }),
  }));
  const env = { ...process.env, PHANTOM_DATA: data };
  const runState = (args) => JSON.parse(execFileSync(process.execPath, [STATE, ...args], {
    encoding: 'utf8',
    env,
  }));
  runState([
    'start', '--workspace', workspace, '--task', task,
    '--intent', 'Verify capability policy', '--route', 'direct',
  ]);
  const paths = sessionPaths(workspace, task);
  const fingerprint = worktreeFingerprint(fs.realpathSync(workspace));
  for (const scope of scopes) {
    authoritySequence += 1;
    const issuedAt = new Date();
    const unsigned = {
      schema_version: 1,
      repo_id: paths.repo.id,
      task_id: paths.task,
      decision_kind: 'authorization',
      gate: null,
      scope,
      decision: 'authorized',
      worktree_fingerprint: fingerprint,
      approval_artifact_bindings: [],
      issued_at: issuedAt.toISOString(),
      expires_at: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
      actor: 'capability-policy-test-user',
      source: 'capability-policy-test-host',
      source_event_id: `capability-source-${authoritySequence}`,
      replay_id: `capability-replay-${authoritySequence}`,
      key_id: 'capability-policy-test-key',
    };
    const decision = {
      ...unsigned,
      signature: sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString('base64'),
    };
    const decisionFile = path.join(data, `authority-${authoritySequence}.json`);
    fs.writeFileSync(decisionFile, JSON.stringify(decision));
    runState([
      'authorize', '--workspace', workspace, '--scope', scope, '--decision', decisionFile,
    ]);
  }
  const interception = writeInterceptionProbe({ paths, fingerprint, privateKey });
  return { paths, fingerprint, interception };
}

function request(type, extra = {}) {
  const base = {
    schema_version: 1,
    request_id: `req-${type.replaceAll('.', '-')}`,
    workflow_id: 'wf-1',
    node_id: 'implement',
    worktreeFingerprint: DIGEST_A,
    type,
  };
  if (type === 'workspace.write') return { ...base, paths: ['src/app.js'], patchDigest: DIGEST_B, ...extra };
  if (type === 'process.exec') return { ...base, command: ['git', 'status', '--short'], cwd: '.', ...extra };
  if (type === 'git.commit') return { ...base, treeDigest: DIGEST_B, message: 'feat: deterministic workflow', ...extra };
  if (type === 'git.push') {
    return {
      ...base,
      headSha: 'a'.repeat(40),
      remote: 'origin',
      branch: 'feat/workflow',
      idempotencyKey: 'git-push:wf-1',
      ...extra,
    };
  }
  if (type === 'github.openDraftPr') {
    return { ...base, headSha: 'a'.repeat(40), idempotencyKey: 'draft-pr:wf-1', ...extra };
  }
  return { ...base, issueId: 'CP-1', bodyDigest: DIGEST_B, idempotencyKey: 'tracker:wf-1', ...extra };
}

function context(extra = {}) {
  return {
    session: {
      status: 'active',
      lifecycle: {
        authorizations: {
          implementation: { status: 'authorized' },
          'ship-draft-pr': { status: 'authorized' },
        },
        actions: { ship: { status: 'ready' } },
      },
    },
    workflow: {
      workflow_id: 'wf-1',
      nodes: [{
        id: 'implement',
        allowed_paths: ['src'],
        allowed_commands: [['git', 'status', '--short']],
        allowed_cwds: ['.'],
      }],
    },
    workflowState: { nodes: { implement: { status: 'running' } } },
    currentWorktreeFingerprint: DIGEST_A,
    currentTreeDigest: DIGEST_B,
    headSha: 'a'.repeat(40),
    current_branch: 'feat/workflow',
    protected_branches: ['develop', 'main', 'master'],
    trusted_interception: true,
    hard_enforcement: true,
    remotes: ['origin'],
    runtimeCapabilities: [
      'workspace.write',
      'process.exec',
      'version_control',
      'review.publish',
      'issue.tracker',
    ],
    remainingBudget: { cost: 10, duration_ms: 10_000 },
    externalAuthorizations: ['tracker.comment'],
    priorDecisions: [],
    ...extra,
  };
}

function draftContext(extra = {}) {
  const value = context(extra);
  Object.assign(value.workflow.nodes[0], {
    kind: 'external-action',
    action: 'draft-pr',
    idempotency_key: 'draft-pr:wf-1',
  });
  return value;
}

function trackerContext(extra = {}) {
  const value = context(extra);
  Object.assign(value.workflow.nodes[0], {
    kind: 'external-action',
    action: 'tracker-comment',
    idempotency_key: 'tracker:wf-1',
  });
  return value;
}

function pushContext(extra = {}) {
  const value = context(extra);
  Object.assign(value.workflow.nodes[0], {
    kind: 'external-action',
    action: 'git-push',
    idempotency_key: 'git-push:wf-1',
  });
  return value;
}

test('capability request validation is typed, exact, and traversal-safe', () => {
  assert.deepEqual(validateCapabilityRequest(request('workspace.write')), []);
  assert.deepEqual(validateCapabilityRequest(request('process.exec')), []);
  assert.deepEqual(validateCapabilityRequest(request('git.commit')), []);
  assert.deepEqual(validateCapabilityRequest(request('git.push')), []);
  assert.deepEqual(validateCapabilityRequest(request('github.openDraftPr')), []);
  assert.deepEqual(validateCapabilityRequest(request('tracker.comment')), []);

  const legacy = request('workspace.write', { patch_digest: DIGEST_B });
  assert.match(validateCapabilityRequest(legacy).join('\n'), /patch_digest: unsupported property/);
  const traversal = request('workspace.write', { paths: ['../outside'] });
  assert.match(validateCapabilityRequest(traversal).join('\n'), /workspace-relative path/);
  const unnormalized = request('workspace.write', { paths: ['./src/app.js'] });
  assert.match(validateCapabilityRequest(unnormalized).join('\n'), /workspace-relative path/);
});

test('broker authorizes valid scoped requests and fails closed on policy drift', () => {
  assert.equal(authorizeCapability(request('workspace.write'), context()).status, 'authorized');
  assert.deepEqual(
    authorizeCapability(request('process.exec'), context()).reason_codes,
    ['sandbox_executor_attestation_unavailable'],
  );
  assert.deepEqual(
    authorizeCapability(request('process.exec', { command: ['node', '--test', 'extra'] }), context()).reason_codes,
    ['command_not_allowed', 'sandbox_executor_attestation_unavailable'],
  );
  assert.equal(authorizeCapability(request('git.commit'), context()).status, 'authorized');
  assert.equal(authorizeCapability(request('tracker.comment'), trackerContext()).status, 'authorized');

  const stale = authorizeCapability(request('workspace.write'), context({ currentWorktreeFingerprint: DIGEST_B }));
  assert.deepEqual(stale.reason_codes, ['stale_worktree']);
  const outside = authorizeCapability(request('workspace.write', { paths: ['README.md'] }), context());
  assert.deepEqual(outside.reason_codes, ['path_outside_node_scope']);
  const command = authorizeCapability(request('process.exec', { command: ['bash', '-lc', 'true'] }), context());
  assert.deepEqual(command.reason_codes, ['command_not_allowed', 'sandbox_executor_attestation_unavailable']);
  const processBypass = context();
  processBypass.workflow.nodes[0].allowed_commands = [['git', 'push']];
  assert.deepEqual(
    authorizeCapability(request('process.exec', { command: ['git', 'push'] }), processBypass).reason_codes,
    ['sandbox_executor_attestation_unavailable'],
  );
  for (const sandboxCommand of [
    ['git', '-c', 'credential.helper=!false', 'push'],
    ['env', 'git', 'status'],
    ['env', 'git', 'push'],
    ['sh', '-c', 'git push'],
    ['bash', '-lc', 'git push'],
    ['node', '--test'],
    ['python', '-m', 'pytest'],
    ['ruby', '-e', 'exit'],
    ['perl', '-e', 'exit'],
    ['gh', '--hostname', 'github.com', 'pr', 'create'],
    ['curl', 'https://example.invalid'],
    ['wget', 'https://example.invalid'],
  ]) {
    const declared = context();
    declared.workflow.nodes[0].allowed_commands = [sandboxCommand];
    const decision = authorizeCapability(request('process.exec', { command: sandboxCommand }), declared);
    assert.equal(decision.status, 'denied');
    assert.ok(decision.reason_codes.includes('sandbox_executor_attestation_unavailable'));
  }
  const protectedWrite = context();
  protectedWrite.workflow.nodes[0].allowed_paths = ['.'];
  for (const protectedPath of [
    '.git',
    '.git/config',
    'nested/.git/HEAD',
    '.gitmodules',
    'nested/.gitmodules',
    'nested/.gitmodules/config',
    '.gitconfig',
    'nested/.gitconfig',
    'nested/.gitconfig/include',
    '.gitattributes',
    'nested/.gitattributes',
    'nested/.gitattributes/rules',
    '.phantom/session.json',
  ]) {
    assert.deepEqual(
      authorizeCapability(request('workspace.write', { paths: [protectedPath] }), protectedWrite)
        .reason_codes,
      ['control_plane_path_protected'],
      protectedPath,
    );
  }
  assert.equal(
    authorizeCapability(request('workspace.write', { paths: ['.editorconfig'] }), protectedWrite).status,
    'authorized',
  );
  assert.deepEqual(
    authorizeCapability(request('workspace.write', { paths: ['state/control/session.json'] }), context({
      protected_control_paths: ['state/control'],
    })).reason_codes,
    ['control_plane_path_protected', 'path_outside_node_scope'],
  );
  const exhausted = authorizeCapability(request('workspace.write'), context({ remainingBudget: { cost: 0 } }));
  assert.deepEqual(exhausted.reason_codes, ['cost_budget_exhausted']);
  const criticalDirect = context();
  criticalDirect.session.route = 'direct';
  criticalDirect.workflow.nodes[0].risk = 'critical';
  assert.deepEqual(
    authorizeCapability(request('workspace.write'), criticalDirect).reason_codes,
    ['route_policy_violation'],
  );
  assert.deepEqual(
    authorizeCapability(request('workspace.write'), context({ hard_enforcement: false })).reason_codes,
    ['protected_branch_enforcement_unavailable'],
  );
  for (const [type, buildContext] of [
    ['workspace.write', context],
    ['process.exec', context],
    ['git.commit', context],
    ['git.push', pushContext],
    ['github.openDraftPr', draftContext],
    ['tracker.comment', trackerContext],
  ]) {
    assert.deepEqual(
      authorizeCapability(request(type), buildContext({ trusted_interception: false })).reason_codes,
      type === 'process.exec'
        ? ['host_interception_unavailable', 'sandbox_executor_attestation_unavailable']
        : ['host_interception_unavailable'],
    );
  }
  assert.deepEqual(
    authorizeCapability(request('workspace.write'), context({ current_branch: 'main' })).reason_codes,
    ['protected_branch'],
  );
});

test('draft PR requires separate authorization, a ready ship gate, and the exact head', () => {
  assert.equal(authorizeCapability(request('git.push'), pushContext()).status, 'authorized');
  assert.deepEqual(
    authorizeCapability(request('git.push', { remote: 'upstream' }), pushContext()).reason_codes,
    ['remote_not_available'],
  );
  assert.equal(authorizeCapability(request('github.openDraftPr'), draftContext()).status, 'authorized');
  const unauthorized = draftContext();
  unauthorized.session.lifecycle.authorizations['ship-draft-pr'] = { status: 'pending' };
  assert.deepEqual(
    authorizeCapability(request('github.openDraftPr'), unauthorized).reason_codes,
    ['draft_pr_not_authorized'],
  );
  const notReady = draftContext();
  notReady.session.lifecycle.actions.ship.status = 'pending';
  assert.deepEqual(
    authorizeCapability(request('github.openDraftPr'), notReady).reason_codes,
    ['ship_gate_not_ready'],
  );
  assert.deepEqual(
    authorizeCapability(request('github.openDraftPr'), draftContext({ headSha: 'b'.repeat(40) })).reason_codes,
    ['head_sha_mismatch'],
  );
  assert.deepEqual(
    authorizeCapability(
      request('github.openDraftPr', { idempotencyKey: 'draft-pr:other' }),
      draftContext(),
    ).reason_codes,
    ['idempotency_key_mismatch'],
  );
});

test('idempotency replays the same request once and rejects key reuse for different work', () => {
  const originalRequest = request('github.openDraftPr');
  const original = authorizeCapability(originalRequest, draftContext());
  const pending = authorizeCapability(originalRequest, draftContext({ priorDecisions: [original] }));
  assert.equal(pending.status, 'denied');
  assert.deepEqual(pending.reason_codes, ['idempotency_reservation_pending']);
  const completed = {
    ...original,
    execution_status: 'succeeded',
    has_succeeded_outcome: true,
  };
  const repeated = authorizeCapability(originalRequest, draftContext({ priorDecisions: [completed] }));
  assert.equal(repeated.status, 'duplicate');
  assert.deepEqual(repeated.reason_codes, ['idempotent_replay']);

  const conflictingRequest = request('github.openDraftPr', { headSha: 'b'.repeat(40) });
  const conflictContext = draftContext({ headSha: 'b'.repeat(40), priorDecisions: [original] });
  const conflict = authorizeCapability(conflictingRequest, conflictContext);
  assert.equal(conflict.status, 'denied');
  assert.deepEqual(conflict.reason_codes, ['idempotency_key_conflict']);
  assert.notEqual(capabilityRequestDigest(originalRequest), capabilityRequestDigest(conflictingRequest));

  const denied = authorizeCapability(conflictingRequest, draftContext());
  assert.equal(denied.status, 'denied');
  const corrected = authorizeCapability(originalRequest, draftContext({ priorDecisions: [denied] }));
  assert.equal(corrected.status, 'authorized');
});

test('CLI resolves the active session and writes an append-only decision ledger', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-capability-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  fs.mkdirSync(workspace);
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'phantom@example.com'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Phantom'], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, 'app.js'), 'export const value = 1;\n');
  execFileSync('git', ['add', 'app.js'], { cwd: workspace });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: workspace });
  execFileSync('git', ['switch', '-qc', 'feat/workflow'], { cwd: workspace });
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = data;
  try {
    const task = 'broker-test';
    const { paths, fingerprint } = initializeAuthorizedSession({
      workspace, data, task, scopes: ['implementation'],
    });
    atomicWriteJson(path.join(paths.sessionDir, 'capabilities.json'), {
      evidence: { capabilities: { 'workspace.write': 'available' } },
    });
    const canonicalWorkspace = fs.realpathSync(workspace);
    const inputFile = path.join(root, 'request.json');
    const compiled = compileWorkflow({
      schema_version: 1,
      workflow_id: 'wf-1',
      route: 'direct',
      risk: 'low',
      baseline_fingerprint: fingerprint,
      session_binding: {
        repo_id: 'fixture', task_id: task, route: 'direct', approved_plan: null,
      },
      routing: {
        recommended_route: 'direct', confidence: 0.95, fallback_route: null, signals: {},
      },
      execution_mode: 'attended',
      acceptance_criteria: ['workspace write is authorized only once'],
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
        acceptance_criteria: ['authorization is policy bound'],
        allowed_paths: ['app.js'],
      }],
    });
    writeCompiledWorkflow(paths.sessionDir, compiled);
    appendWorkflowEvent({
      sessionDir: paths.sessionDir,
      compiled,
      input: {
        event_type: 'workflow.started',
        node_id: null,
        worktree_fingerprint: fingerprint,
        producer: { role: 'apex' },
        payload: {},
      },
    });
    appendWorkflowEvent({
      sessionDir: paths.sessionDir,
      compiled,
      input: {
        event_type: 'node.started',
        node_id: 'implement',
        worktree_fingerprint: fingerprint,
        producer: { role: 'apex' },
        payload: { input_refs: [] },
      },
    });
    atomicWriteJson(inputFile, request('workspace.write', {
      paths: ['app.js'],
      worktreeFingerprint: fingerprint,
    }));
    assert.equal(worktreeFingerprint(canonicalWorkspace), fingerprint);

    const args = ['authorize', '--workspace', workspace, '--task', task, '--input', inputFile];
    assert.throws(() => runCapabilityBroker(args, {
      afterReservation() {
        throw new Error('injected crash after durable reservation');
      },
    }), /injected crash after durable reservation/);
    const ledgerAfterCrash = fs.readFileSync(workflowPaths(paths.sessionDir).journalFile, 'utf8')
      .trim().split('\n').map(JSON.parse);
    assert.deepEqual(ledgerAfterCrash.map((event) => event.event_type), [
      'workflow.started',
      'node.started',
    ]);
    const pendingDirectory = path.join(paths.sessionDir, 'capability', 'reservations', 'pending');
    const pendingFiles = fs.readdirSync(pendingDirectory);
    assert.equal(pendingFiles.length, 1);
    const crashReservation = JSON.parse(fs.readFileSync(path.join(pendingDirectory, pendingFiles[0]), 'utf8'));
    assert.deepEqual(
      crashReservation.hard_enforcement.protected_branches,
      protectedBranches(canonicalWorkspace),
    );
    const first = runCapabilityBroker(args);
    const second = runCapabilityBroker(args);
    assert.equal(first.status, 'authorized', JSON.stringify(first));
    assert.equal(second.status, 'denied');
    assert.deepEqual(second.reason_codes, ['idempotency_reservation_pending']);
    const ledgerFile = workflowPaths(paths.sessionDir).journalFile;
    const ledger = fs.readFileSync(ledgerFile, 'utf8')
      .trim().split('\n').map(JSON.parse);
    assert.equal(ledger.length, 4);
    assert.deepEqual(ledger.map((event) => event.event_type), [
      'workflow.started',
      'node.started',
      'capability.decision',
      'capability.decision',
    ]);
    assert.deepEqual(ledger.map((event) => event.sequence), [1, 2, 3, 4]);
    assert.equal(ledger[3].previous_event_digest, ledger[2].event_digest);

    const reservationRoot = path.join(paths.sessionDir, 'capability', 'reservations');
    const reservationName = `${first.decision_digest.replace('sha256:', '')}.json`;
    const pending = path.join(reservationRoot, 'pending', reservationName);
    const consuming = path.join(reservationRoot, 'consuming', reservationName);
    fs.linkSync(pending, consuming);
    fs.unlinkSync(pending);
    const finalized = finalizeClaimedCapability({
      workspace,
      task,
      decisionDigest: first.decision_digest,
      status: 'succeeded',
    });
    assert.equal(finalized.status, 'succeeded');
    assert.equal(fs.existsSync(path.join(reservationRoot, 'completed', reservationName)), true);

    ledger[0].payload = { tampered: true };
    fs.writeFileSync(ledgerFile, `${ledger.map(JSON.stringify).join('\n')}\n`);
    assert.throws(() => runCapabilityBroker(args), /digest/i);
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('authorized adapter execution journals one external effect and replays by prior decision linkage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-capability-execute-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  fs.mkdirSync(workspace);
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'phantom@example.com'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Phantom'], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, 'app.js'), 'export const value = 1;\n');
  execFileSync('git', ['add', 'app.js'], { cwd: workspace });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: workspace });
  execFileSync('git', ['switch', '-qc', 'feat/workflow'], { cwd: workspace });
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = data;
  try {
    const task = 'external-execute';
    const { paths, fingerprint, interception } = initializeAuthorizedSession({
      workspace,
      data,
      task,
      scopes: ['implementation', 'ship-draft-pr'],
    });
    assert.throws(() => execFileSync(process.execPath, [STATE, 'ship', '--workspace', workspace], {
      encoding: 'utf8', env: { ...process.env, PHANTOM_DATA: data },
    }), /authoritative workflow replay failed/);
    atomicWriteJson(path.join(paths.sessionDir, 'capabilities.json'), {
      evidence: { capabilities: { 'github.openDraftPr': 'available' } },
    });
    const canonicalWorkspace = fs.realpathSync(workspace);
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
    const compiled = compileWorkflow({
      schema_version: 1,
      workflow_id: 'wf-1',
      route: 'direct',
      risk: 'low',
      baseline_fingerprint: fingerprint,
      session_binding: {
        repo_id: paths.repo.id, task_id: task, route: 'direct', approved_plan: null,
      },
      routing: {
        recommended_route: 'direct', confidence: 0.95, fallback_route: null, signals: {},
      },
      execution_mode: 'attended',
      acceptance_criteria: ['draft PR is created exactly once'],
      budget: { max_cost_units: 10, max_duration_ms: 10_000, max_attempts: 3 },
      nodes: [
        {
          id: 'gate', kind: 'task', depends_on: [], retry_limit: 0,
          budget: { max_cost_units: 2, max_duration_ms: 2_000 },
          role: 'apex', output_schema: 'workflow-output-v1', expected_artifacts: ['gate.json'],
          acceptance_criteria: ['shipping gate is ready'],
        },
        {
          id: 'ship', kind: 'external-action', depends_on: ['gate'], retry_limit: 0,
          budget: { max_cost_units: 2, max_duration_ms: 2_000 },
          action: 'draft-pr', idempotency_key: 'draft-pr:e2e',
          output_schema: 'workflow-output-v1', expected_artifacts: ['draft-pr.json'],
        },
      ],
    });
    writeCompiledWorkflow(paths.sessionDir, compiled);
    const append = (input) => appendWorkflowEvent({ sessionDir: paths.sessionDir, compiled, input });
    append({
      event_type: 'workflow.started', node_id: null, producer: { role: 'apex' }, payload: {},
      worktree_fingerprint: fingerprint,
    });
    append({
      event_type: 'node.started', node_id: 'gate', producer: { role: 'apex' },
      payload: { input_refs: [] },
    });
    append({
      event_type: 'node.completed', node_id: 'gate', producer: { role: 'apex' },
      worktree_fingerprint: fingerprint, artifact_refs: ['gate.json'],
      payload: {
        output_schema: 'workflow-output-v1',
        artifact_digests: [{ artifact_ref: 'gate.json', digest: DIGEST_A }],
        cost_units: 1,
        duration_ms: 10,
      },
    });
    const shipLifecycle = JSON.parse(execFileSync(
      process.execPath,
      [STATE, 'ship', '--workspace', workspace],
      { encoding: 'utf8', env: { ...process.env, PHANTOM_DATA: data } },
    ));
    assert.equal(shipLifecycle.lifecycle.actions.ship.status, 'ready');
    append({
      event_type: 'node.started', node_id: 'ship', producer: { role: 'apex' },
      payload: {
        input_refs: [{ source_node: 'gate', artifact_ref: 'gate.json', digest: DIGEST_A }],
      },
    });
    const capabilityRequest = request('github.openDraftPr', {
      request_id: 'req-draft-pr-e2e',
      node_id: 'ship',
      headSha,
      idempotencyKey: 'draft-pr:e2e',
      worktreeFingerprint: fingerprint,
    });
    let adapterCalls = 0;
    const adapter = (boundRequest) => {
      adapterCalls += 1;
      return {
        status: 'succeeded',
        request_digest: capabilityRequestDigest(boundRequest),
        worktree_fingerprint: boundRequest.worktreeFingerprint,
        head_sha: boundRequest.headSha,
        external_reference: 'https://example.invalid/pr/1',
      };
    };
    const sessionFile = path.join(paths.sessionDir, 'session.json');
    const authorizedSession = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    fs.unlinkSync(interception.file);
    const absentProbe = executeAuthorizedCapability({
      workspace: canonicalWorkspace,
      task,
      sessionDir: paths.sessionDir,
      compiled,
      request: { ...capabilityRequest, request_id: 'req-draft-pr-absent-probe' },
      adapter,
    });
    assert.deepEqual(absentProbe.decision.reason_codes, ['host_interception_unavailable']);
    assert.equal(adapterCalls, 0);
    const forgedProbe = { ...interception.probe, host: 'forged-untrusted-host' };
    atomicWriteJson(interception.file, forgedProbe);
    const forged = executeAuthorizedCapability({
      workspace: canonicalWorkspace,
      task,
      sessionDir: paths.sessionDir,
      compiled,
      request: { ...capabilityRequest, request_id: 'req-draft-pr-forged-probe' },
      adapter,
    });
    assert.deepEqual(forged.decision.reason_codes, ['host_interception_unavailable']);
    assert.equal(adapterCalls, 0);
    atomicWriteJson(interception.file, interception.probe);
    const replacedSession = structuredClone(authorizedSession);
    replacedSession.lifecycle.authorizations['ship-draft-pr'].authority.decision_digest = DIGEST_A;
    atomicWriteJson(sessionFile, replacedSession);
    assert.throws(() => executeAuthorizedCapability({
      workspace: canonicalWorkspace,
      task,
      sessionDir: paths.sessionDir,
      compiled,
      request: capabilityRequest,
      adapter,
    }), /replaced or its authority record is inconsistent/);
    assert.equal(adapterCalls, 0);
    atomicWriteJson(sessionFile, authorizedSession);
    const first = executeAuthorizedCapability({
      workspace: canonicalWorkspace,
      task,
      sessionDir: paths.sessionDir,
      compiled,
      request: capabilityRequest,
      adapter,
    });
    assert.equal(first.decision.status, 'authorized');
    assert.equal(first.outcome.status, 'succeeded');
    const replay = executeAuthorizedCapability({
      workspace: canonicalWorkspace,
      task,
      sessionDir: paths.sessionDir,
      compiled,
      request: capabilityRequest,
      adapter,
    });
    assert.equal(replay.decision.status, 'duplicate');
    assert.equal(adapterCalls, 1);
    const completed = append({
      event_type: 'node.completed', node_id: 'ship', producer: { role: 'apex' },
      worktree_fingerprint: fingerprint, artifact_refs: ['draft-pr.json'],
      payload: {
        output_schema: 'workflow-output-v1',
        artifact_digests: [{ artifact_ref: 'draft-pr.json', digest: DIGEST_B }],
        cost_units: 1,
        duration_ms: 10,
      },
    });
    assert.equal(completed.state.status, 'accepted');
    const ledger = fs.readFileSync(workflowPaths(paths.sessionDir).journalFile, 'utf8')
      .trim().split('\n').map(JSON.parse);
    assert.deepEqual(ledger.slice(-4).map((event) => event.event_type), [
      'capability.decision', 'capability.outcome', 'capability.outcome', 'node.completed',
    ]);
    assert.equal(ledger.at(-2).payload.decision_digest, ledger.at(-3).payload.decision_digest);
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
  }
});
