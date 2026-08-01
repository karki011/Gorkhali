// Author: Subash Karki
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
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
let finalizeClaimedCapability;
let runCapabilityBroker;
let sessionPaths;
let validateCapabilityRequest;
let validateCapabilityReservation;
let validateCapabilityReservationTransition;
let protectedBranches;
let worktreeFingerprint;
let workflowPaths;
let writeCompiledWorkflow;

before(async () => {
  ({
    authorizeCapability,
    capabilityRequestDigest,
    validateCapabilityRequest,
    validateCapabilityReservation,
    validateCapabilityReservationTransition,
  } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/lib/capability-contracts.mjs')).href
  ));
  ({ finalizeClaimedCapability, runCapabilityBroker } = await import(
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

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
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
    budget: { maxCostUnits: 1, maxDurationMs: 1_000 },
    type,
  };
  if (type === 'workspace.write') return { ...base, paths: ['src/app.js'], patchDigest: DIGEST_B, ...extra };
  if (type === 'process.exec') return { ...base, command: ['node', '--test'], cwd: '.', ...extra };
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
    return {
      ...base,
      baseRef: 'main',
      headSha: 'a'.repeat(40),
      titleDigest: DIGEST_A,
      bodyDigest: DIGEST_B,
      idempotencyKey: 'draft-pr:wf-1',
      ...extra,
    };
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
        allowed_commands: [['node', '--test']],
        allowed_cwds: ['.'],
        budget: { max_cost_units: 10, max_duration_ms: 10_000 },
      }],
    },
    workflowState: { nodes: { implement: {
      status: 'running',
      consumed_budget: { cost_units: 0, duration_ms: 0 },
      reserved_budget: { cost_units: 0, duration_ms: 0 },
    } } },
    currentWorktreeFingerprint: DIGEST_A,
    currentTreeDigest: DIGEST_B,
    headSha: 'a'.repeat(40),
    current_branch: 'feat/workflow',
    protected_branches: ['develop', 'main', 'master'],
    trusted_interception: true,
    hard_enforcement: true,
    remotes: ['origin'],
    runtimeCapabilities: {
      'workspace.write': 'available',
      'process.exec': 'available',
      'version_control': 'available',
      'review.publish': 'available',
      'issue.tracker': 'available',
    },
    remainingBudget: { cost: 10, duration_ms: 10_000 },
    externalAuthorizations: ['tracker.comment'],
    hostAdapter: {
      status: 'ready',
      capabilities: {
        'process.exec': { status: 'ready', policy_digest: DIGEST_A },
        'git.commit': { status: 'ready', policy_digest: DIGEST_A },
        'git.push': { status: 'ready', policy_digest: DIGEST_A },
        'github.openDraftPr': { status: 'ready', policy_digest: DIGEST_A },
        'tracker.comment': { status: 'ready', policy_digest: DIGEST_A },
      },
    },
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

  const missingBudget = request('workspace.write');
  delete missingBudget.budget;
  assert.match(validateCapabilityRequest(missingBudget).join('\n'), /budget: required/);
  assert.match(validateCapabilityRequest(request('workspace.write', {
    budget: { maxCostUnits: 0, maxDurationMs: 1_000 },
  })).join('\n'), /maxCostUnits: must be >= 0.000001/);
  assert.match(validateCapabilityRequest(request('workspace.write', {
    budget: { maxCostUnits: 1, maxDurationMs: 0 },
  })).join('\n'), /maxDurationMs: must be >= 1/);

  const legacy = request('workspace.write', { patch_digest: DIGEST_B });
  assert.match(validateCapabilityRequest(legacy).join('\n'), /patch_digest: unsupported property/);
  const traversal = request('workspace.write', { paths: ['../outside'] });
  assert.match(validateCapabilityRequest(traversal).join('\n'), /workspace-relative path/);
  const unnormalized = request('workspace.write', { paths: ['./src/app.js'] });
  assert.match(validateCapabilityRequest(unnormalized).join('\n'), /workspace-relative path/);
  for (const field of ['baseRef', 'titleDigest', 'bodyDigest']) {
    const incomplete = request('github.openDraftPr');
    delete incomplete[field];
    assert.match(validateCapabilityRequest(incomplete).join('\n'), new RegExp(`${field}.*required`));
  }
});

test('broker authorizes valid scoped requests and fails closed on policy drift', () => {
  const authorizedWrite = authorizeCapability(request('workspace.write'), context());
  assert.equal(authorizedWrite.status, 'authorized');
  assert.deepEqual(authorizedWrite.reserved_budget, { cost_units: 1, duration_ms: 1_000 });
  assert.equal(authorizeCapability(request('process.exec'), context()).status, 'authorized');
  assert.deepEqual(
    authorizeCapability(request('process.exec', { command: ['node', '--test', 'extra'] }), context()).reason_codes,
    ['command_not_allowed'],
  );
  assert.equal(authorizeCapability(request('git.commit'), context()).status, 'authorized');
  assert.equal(authorizeCapability(request('tracker.comment'), trackerContext()).status, 'authorized');

  const stale = authorizeCapability(request('workspace.write'), context({ currentWorktreeFingerprint: DIGEST_B }));
  assert.deepEqual(stale.reason_codes, ['stale_worktree']);
  const frozen = authorizeCapability(request('workspace.write'), context({ workflowEffectUnresolved: true }));
  assert.deepEqual(frozen.reason_codes, ['workflow_effect_reconciliation_required']);
  const outside = authorizeCapability(request('workspace.write', { paths: ['README.md'] }), context());
  assert.deepEqual(outside.reason_codes, ['path_outside_node_scope']);
  const command = authorizeCapability(request('process.exec', { command: ['bash', '-lc', 'true'] }), context());
  assert.deepEqual(command.reason_codes, ['command_not_allowed', 'reserved_effect_command']);
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
    declared.hostAdapter = null;
    const decision = authorizeCapability(request('process.exec', { command: sandboxCommand }), declared);
    assert.equal(decision.status, 'denied');
    assert.ok(decision.reason_codes.includes('host_adapter_unavailable'));
  }
  for (const reservedCommand of [
    ['/usr/bin/git', 'push', 'origin', 'HEAD'],
    ['C:\\Program Files\\Git\\bin\\git.exe', 'push'],
    ['gh', 'pr', 'create'],
    ['env', 'git', 'push'],
    ['nice', 'git', 'commit'],
    ['node', '--eval', 'process.exit(0)'],
    ['find', '.', '-exec', 'git', 'status', ';'],
  ]) {
    const declared = context();
    declared.workflow.nodes[0].allowed_commands = [reservedCommand];
    const denied = authorizeCapability(
      request('process.exec', { command: reservedCommand }),
      declared,
    );
    assert.equal(denied.status, 'denied');
    assert.deepEqual(denied.reason_codes, ['reserved_effect_command']);
  }
  const ordinaryInterpreter = context();
  ordinaryInterpreter.workflow.nodes[0].allowed_commands = [['python', '-m', 'pytest']];
  assert.equal(authorizeCapability(request('process.exec', {
    command: ['python', '-m', 'pytest'],
  }), ordinaryInterpreter).status, 'authorized');
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
  const exhausted = authorizeCapability(request('workspace.write'), context({
    remainingBudget: { cost: 0, duration_ms: 10_000 },
  }));
  assert.deepEqual(exhausted.reason_codes, ['cost_budget_exhausted']);
  assert.deepEqual(authorizeCapability(request('workspace.write'), context({
    remainingBudget: { cost: 0.5, duration_ms: 10_000 },
  })).reason_codes, ['cost_budget_exhausted']);
  assert.deepEqual(authorizeCapability(request('workspace.write'), context({
    remainingBudget: { cost: 10, duration_ms: 999 },
  })).reason_codes, ['time_budget_exhausted']);
  const locallyReserved = context();
  locallyReserved.workflowState.nodes.implement.reserved_budget.cost_units = 9.5;
  assert.deepEqual(
    authorizeCapability(request('workspace.write'), locallyReserved).reason_codes,
    ['node_cost_budget_exhausted'],
  );
  assert.deepEqual(authorizeCapability(request('workspace.write'), context({
    remainingBudget: { cost: 10 },
  })).reason_codes, ['budget_state_unavailable']);
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
    const unavailable = buildContext({ trusted_interception: false });
    const hostAttested = [
      'process.exec', 'git.commit', 'git.push', 'github.openDraftPr', 'tracker.comment',
    ].includes(type);
    if (hostAttested) {
      unavailable.hostAdapter = null;
    }
    assert.deepEqual(
      authorizeCapability(request(type), unavailable).reason_codes,
      hostAttested
        ? ['host_adapter_unavailable']
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

  const uncertain = {
    ...original,
    execution_status: 'indeterminate',
    indeterminate_outcome: { attestation_digest: DIGEST_B },
  };
  const blockedRetry = authorizeCapability(originalRequest, draftContext({ priorDecisions: [uncertain] }));
  assert.equal(blockedRetry.status, 'denied');
  assert.deepEqual(blockedRetry.reason_codes, ['idempotency_reconciliation_required']);

  const conflictingRequest = request('github.openDraftPr', { headSha: 'b'.repeat(40) });
  const conflictContext = draftContext({ headSha: 'b'.repeat(40), priorDecisions: [original] });
  const conflict = authorizeCapability(conflictingRequest, conflictContext);
  assert.equal(conflict.status, 'denied');
  assert.deepEqual(conflict.reason_codes, ['idempotency_key_conflict']);
  assert.notEqual(capabilityRequestDigest(originalRequest), capabilityRequestDigest(conflictingRequest));
  for (const mutation of [
    { baseRef: 'develop' },
    { titleDigest: DIGEST_B },
    { bodyDigest: DIGEST_A },
  ]) {
    assert.notEqual(
      capabilityRequestDigest(originalRequest),
      capabilityRequestDigest(request('github.openDraftPr', mutation)),
    );
  }

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
      schema_version: 2,
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
        producer: { role: 'blade' },
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
    const reservationRoot = path.join(paths.sessionDir, 'capability', 'reservations');
    const pendingDirectory = path.join(reservationRoot, 'pending');
    const stagedDirectory = path.join(reservationRoot, 'staged');
    assert.equal(fs.readdirSync(pendingDirectory).length, 0);
    const stagedFiles = fs.readdirSync(stagedDirectory);
    assert.equal(stagedFiles.length, 1);
    const stagedFile = path.join(stagedDirectory, stagedFiles[0]);
    const crashRaw = fs.readFileSync(stagedFile, 'utf8');
    const crashReservation = JSON.parse(crashRaw);
    assert.deepEqual(
      crashReservation.hard_enforcement.protected_branches,
      protectedBranches(canonicalWorkspace),
    );
    assert.deepEqual(crashReservation.reserved_budget, { cost_units: 1, duration_ms: 1_000 });
    const budgetTamper = structuredClone(crashReservation);
    budgetTamper.reserved_budget.cost_units = 0.5;
    assert.match(
      validateCapabilityReservation(budgetTamper).join('\n'),
      /reserved_budget.*does not match reservation_binding|reserved_budget.*does not match request budget/,
    );
    const crossVariant = structuredClone(crashReservation);
    const { binding_digest: ignoredBindingDigest, ...nativeBinding } = crossVariant.hard_enforcement;
    void ignoredBindingDigest;
    Object.assign(nativeBinding, {
      registry_trust_digest: DIGEST_A,
      registration_digest: DIGEST_A,
      policy_digest: DIGEST_A,
    });
    crossVariant.hard_enforcement = {
      ...nativeBinding,
      binding_digest: sha256(canonicalJson({ request: crossVariant.request, binding: nativeBinding })),
    };
    crossVariant.reservation_binding.hard_enforcement = structuredClone(crossVariant.hard_enforcement);
    crossVariant.reservation_digest = sha256(canonicalJson(crossVariant.reservation_binding));
    fs.writeFileSync(stagedFile, `${canonicalJson(crossVariant)}\n`);
    assert.throws(() => runCapabilityBroker(args), /hard_enforcement.*variant shape/i);
    fs.writeFileSync(stagedFile, crashRaw);
    const first = runCapabilityBroker(args);
    const second = runCapabilityBroker(args);
    assert.equal(first.status, 'authorized', JSON.stringify(first));
    assert.deepEqual(first.reservation.reserved_budget, { cost_units: 1, duration_ms: 1_000 });
    assert.equal(second.status, 'denied');
    assert.deepEqual(second.reason_codes, ['idempotency_reservation_pending']);
    const ledgerFile = workflowPaths(paths.sessionDir).journalFile;
    const ledger = fs.readFileSync(ledgerFile, 'utf8')
      .trim().split('\n').map(JSON.parse);
    assert.equal(ledger.length, 3);
    assert.deepEqual(ledger.map((event) => event.event_type), [
      'workflow.started',
      'node.started',
      'capability.decision',
    ]);
    assert.deepEqual(ledger.map((event) => event.sequence), [1, 2, 3]);

    const reservationName = `${first.decision_digest.replace('sha256:', '')}.json`;
    const pending = path.join(reservationRoot, 'pending', reservationName);
    const consuming = path.join(reservationRoot, 'consuming', reservationName);
    const pendingReservation = JSON.parse(fs.readFileSync(pending, 'utf8'));
    const consumingReservation = {
      ...pendingReservation,
      status: 'consuming',
      consuming_at: new Date().toISOString(),
      claim: {
        schema_version: 1,
        tool_name: 'Write',
        effect_digest: DIGEST_A,
        tool_call_id: 'test-tool-call',
        host_session_id: 'test-host-session',
        write_preflight: [{
          path: 'app.js',
          materialized: true,
          dev: '1',
          ino: '2',
          generation: '1:2:33188:1:24:1:1',
        }],
      },
    };
    assert.deepEqual(validateCapabilityReservationTransition({
      fromLane: 'pending',
      toLane: 'consuming',
      before: pendingReservation,
      after: consumingReservation,
    }), []);
    const duplicatePreflight = structuredClone(consumingReservation);
    duplicatePreflight.claim.write_preflight.push({
      path: 'app.js',
      materialized: false,
    });
    assert.match(validateCapabilityReservation(duplicatePreflight).join('\n'),
      /write_preflight.*unique and sorted|write_preflight.*authorized request/);
    fs.writeFileSync(consuming, `${canonicalJson(consumingReservation)}\n`, { mode: 0o600, flag: 'wx' });
    fs.unlinkSync(pending);
    const finalized = finalizeClaimedCapability({
      workspace,
      task,
      decisionDigest: first.decision_digest,
      status: 'succeeded',
    });
    assert.equal(finalized.status, 'succeeded');
    const completedFile = path.join(reservationRoot, 'completed', reservationName);
    assert.equal(fs.existsSync(completedFile), true);
    const completedReservation = JSON.parse(fs.readFileSync(completedFile, 'utf8'));
    assert.deepEqual(validateCapabilityReservationTransition({
      fromLane: 'consuming',
      toLane: 'completed',
      before: consumingReservation,
      after: completedReservation,
    }), []);
    const changedPreflight = structuredClone(completedReservation);
    changedPreflight.claim.write_preflight[0].generation = 'changed-generation';
    assert.match(validateCapabilityReservationTransition({
      fromLane: 'consuming',
      toLane: 'completed',
      before: consumingReservation,
      after: changedPreflight,
    }).join('\n'), /changed native claim|changed write_preflight/);

    ledger[0].payload = { tampered: true };
    fs.writeFileSync(ledgerFile, `${ledger.map(JSON.stringify).join('\n')}\n`);
    assert.throws(() => runCapabilityBroker(args), /digest/i);
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
