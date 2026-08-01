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
const DIGEST_A = `sha256:${'a'.repeat(64)}`;

let adapterCapabilityPolicyDigest;
let appendWorkflowEvent;
let buildWorkspaceManifest;
let capabilityReservationDigest;
let capabilityExecutionAttestationDigest;
let capabilityExecutionAttestationSigningPayload;
let compileWorkflow;
let hostAdapterRegistrationDigest;
let hostAdapterRegistrationSigningPayload;
let ingestCapabilityAttestation;
let runCapabilityBroker;
let replayWorkflowSession;
let sessionPaths;
let workspaceSnapshot;
let workflowPaths;
let worktreeFingerprint;
let writeCompiledWorkflow;
let validateCapabilityReservation;
let validateCapabilityReservationTransition;

before(async () => {
  ({ ingestCapabilityAttestation, runCapabilityBroker } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/authorize-capability.mjs')).href
  ));
  ({
    adapterCapabilityPolicyDigest,
    capabilityExecutionAttestationDigest,
    capabilityExecutionAttestationSigningPayload,
    hostAdapterRegistrationDigest,
    hostAdapterRegistrationSigningPayload,
  } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/lib/host-adapter-contracts.mjs')).href
  ));
  ({ workspaceSnapshot } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/lib/filesystem-snapshot.mjs')).href
  ));
  ({
    capabilityReservationDigest,
    validateCapabilityReservation,
    validateCapabilityReservationTransition,
  } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/lib/capability-contracts.mjs')).href
  ));
  ({ sessionPaths } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/lib/portable.mjs')).href
  ));
  ({ compileWorkflow } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/lib/workflow-kernel.mjs')).href
  ));
  ({ buildWorkspaceManifest } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/lib/workspace-manifest.mjs')).href
  ));
  ({ worktreeFingerprint } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/phantom-state.mjs')).href
  ));
  ({ appendWorkflowEvent, replayWorkflowSession, workflowPaths, writeCompiledWorkflow } = await import(
    pathToFileURL(path.join(ROOT, 'skills/phantom/scripts/lib/workflow-journal.mjs')).href
  ));
});

const iso = (offset = 0) => new Date(Date.now() + offset).toISOString();
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const publicPem = (key) => key.export({ type: 'spki', format: 'pem' }).toString();

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function domainDigest(domain, value) {
  return `sha256:${createHash('sha256')
    .update(`${domain}\0`)
    .update(canonicalJson(value))
    .digest('hex')}`;
}

function rehashReservation(value) {
  const { binding_digest: ignored, ...hardBinding } = value.hard_enforcement;
  void ignored;
  value.hard_enforcement.binding_digest = digest(canonicalJson({
    request: value.request,
    binding: hardBinding,
  }));
  value.reservation_binding.hard_enforcement = structuredClone(value.hard_enforcement);
  value.reservation_digest = capabilityReservationDigest(value.reservation_binding);
  return value;
}

function privateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function signValue(value, payload, privateKey) {
  value.signature = sign(null, payload(value), privateKey).toString('base64');
  return value;
}

function githubCapability() {
  return {
    type: 'github.openDraftPr',
    contract: 'github-draft-pr-v1',
    target: {
      host: 'github.com',
      repository_id: 'cloudzero/research-phantom',
      allowed_base_refs: ['main'],
      draft_only: true,
    },
  };
}

function processCapability() {
  return {
    type: 'process.exec',
    contract: 'sandbox-exec-v1',
    policy: {
      shell: 'disabled',
      stdin: 'closed',
      network: 'denied',
      filesystem: 'request-scoped',
      repository_control: 'inaccessible',
      phantom_control: 'inaccessible',
      environment: 'allowlist-only',
      credentials: 'absent',
      allowed_environment_names: ['LANG'],
      process_tree: 'terminate-on-timeout',
      max_duration_ms: 60_000,
      max_output_bytes: 1_000_000,
      max_processes: 8,
    },
  };
}

function initializeLifecycle({ workspace, data, task, scopes }) {
  const authorityKeys = generateKeyPairSync('ed25519');
  privateJson(path.join(data, 'config', 'authority-trust.json'), {
    schema_version: 1,
    key_id: 'integration-authority-key',
    source: 'integration-host',
    public_key: publicPem(authorityKeys.publicKey),
  });
  const env = { ...process.env, PHANTOM_DATA: data };
  const state = (args) => JSON.parse(execFileSync(process.execPath, [STATE, ...args], {
    encoding: 'utf8',
    env,
  }));
  state([
    'start', '--workspace', workspace, '--task', task,
    '--intent', 'Verify signed host adapter integration', '--route', 'direct',
  ]);
  const paths = sessionPaths(workspace, task);
  const fingerprint = worktreeFingerprint(fs.realpathSync(workspace));
  scopes.forEach((scope, index) => {
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
      actor: 'integration-user',
      source: 'integration-host',
      source_event_id: `authority-source-${task}-${index}`,
      replay_id: `authority-replay-${task}-${index}`,
      key_id: 'integration-authority-key',
    };
    const decision = {
      ...unsigned,
      signature: sign(
        null,
        Buffer.from(canonicalJson(unsigned)),
        authorityKeys.privateKey,
      ).toString('base64'),
    };
    const decisionFile = path.join(data, `authority-${task}-${index}.json`);
    privateJson(decisionFile, decision);
    state(['authorize', '--workspace', workspace, '--scope', scope, '--decision', decisionFile]);
  });
  return { paths, fingerprint, state };
}

function installAdapter({
  data,
  paths,
  task,
  registryKeys,
  adapterKeys,
  capabilities = [githubCapability()],
  registrationOverrides = {},
}) {
  const trust = {
    schema_version: 1,
    trust_kind: 'host-adapter-registry',
    trust_id: `registry-trust-${task}`,
    key_id: 'registry-key-1',
    source: 'integration-host-registry',
    algorithm: 'ed25519',
    public_key: publicPem(registryKeys.publicKey),
    valid_from: iso(-60 * 60_000),
    valid_until: iso(60 * 60_000),
  };
  const registration = {
    schema_version: 1,
    registration_kind: 'host-adapter',
    registration_id: `registration-${task}`,
    adapter: {
      adapter_id: 'integration-host-adapter',
      adapter_version: '1.0.0',
      host_instance_id: 'integration-host-1',
      attestation_key_id: 'adapter-leaf-1',
      attestation_public_key: publicPem(adapterKeys.publicKey),
    },
    scope: { repo_id: paths.repo.id, task_id: task },
    capabilities,
    issued_at: iso(-60_000),
    expires_at: iso(9 * 60_000),
    source: 'integration-host-registry',
    source_event_id: `registration-source-${task}`,
    replay_id: `registration-replay-${task}`,
    registry_key_id: 'registry-key-1',
    signature: '',
    ...registrationOverrides,
  };
  signValue(registration, hostAdapterRegistrationSigningPayload, registryKeys.privateKey);
  privateJson(path.join(data, 'config', 'host-adapter-registry-trust.json'), trust);
  privateJson(path.join(paths.sessionDir, 'host-adapter-registration.json'), registration);
  return { trust, registration };
}

function renewAdapterRegistration(fixture) {
  const adapterKeys = generateKeyPairSync('ed25519');
  const registration = {
    ...structuredClone(fixture.registration),
    registration_id: `${fixture.registration.registration_id}-renewed`,
    adapter: {
      ...structuredClone(fixture.registration.adapter),
      attestation_key_id: 'adapter-leaf-2',
      attestation_public_key: publicPem(adapterKeys.publicKey),
    },
    issued_at: iso(-60_000),
    expires_at: iso(9 * 60_000),
    source_event_id: `${fixture.registration.source_event_id}-renewed`,
    replay_id: `${fixture.registration.replay_id}-renewed`,
    signature: '',
  };
  signValue(
    registration,
    hostAdapterRegistrationSigningPayload,
    fixture.registryKeys.privateKey,
  );
  privateJson(
    path.join(fixture.paths.sessionDir, 'host-adapter-registration.json'),
    registration,
  );
  return { adapterKeys, registration };
}

function initializeGithubFixture(task, registrationOverrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-host-adapter-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  fs.mkdirSync(workspace);
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'phantom@example.com'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Phantom'], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, 'app.js'), 'export const value = 1;\n');
  execFileSync('git', ['add', 'app.js'], { cwd: workspace });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: workspace });
  execFileSync('git', ['switch', '-qc', 'feat/host-adapter'], { cwd: workspace });
  process.env.PHANTOM_DATA = data;
  const lifecycle = initializeLifecycle({
    workspace,
    data,
    task,
    scopes: ['ship-draft-pr'],
  });
  const registryKeys = generateKeyPairSync('ed25519');
  const adapterKeys = generateKeyPairSync('ed25519');
  const adapter = installAdapter({
    data,
    paths: lifecycle.paths,
    task,
    registryKeys,
    adapterKeys,
    registrationOverrides,
  });
  const compiled = compileWorkflow({
    schema_version: 2,
    workflow_id: 'wf-host-adapter',
    route: 'direct',
    risk: 'low',
    baseline_fingerprint: lifecycle.fingerprint,
    session_binding: {
      repo_id: lifecycle.paths.repo.id,
      task_id: task,
      route: 'direct',
      approved_plan: null,
    },
    routing: {
      recommended_route: 'direct',
      confidence: 0.95,
      fallback_route: null,
      signals: {},
    },
    execution_mode: 'attended',
    acceptance_criteria: ['a signed draft pull request result is journaled'],
    budget: { max_cost_units: 10, max_duration_ms: 10_000, max_attempts: 3 },
    nodes: [
      {
        id: 'gate',
        kind: 'task',
        depends_on: [],
        retry_limit: 0,
        budget: { max_cost_units: 2, max_duration_ms: 2_000 },
        role: 'apex',
        output_schema: 'workflow-output-v1',
        expected_artifacts: ['gate.json'],
        acceptance_criteria: ['shipping is ready'],
      },
      {
        id: 'ship',
        kind: 'external-action',
        depends_on: ['gate'],
        retry_limit: 0,
        budget: { max_cost_units: 2, max_duration_ms: 2_000 },
        action: 'draft-pr',
        idempotency_key: 'draft-pr:host-adapter',
        output_schema: 'workflow-output-v1',
        expected_artifacts: ['draft-pr.json'],
      },
    ],
  });
  writeCompiledWorkflow(lifecycle.paths.sessionDir, compiled);
  const append = (input) => appendWorkflowEvent({
    sessionDir: lifecycle.paths.sessionDir,
    compiled,
    input,
  });
  append({
    event_type: 'workflow.started',
    node_id: null,
    worktree_fingerprint: lifecycle.fingerprint,
    producer: { role: 'apex' },
    payload: {},
  });
  append({
    event_type: 'node.started',
    node_id: 'gate',
    worktree_fingerprint: lifecycle.fingerprint,
    producer: { role: 'apex' },
    payload: { input_refs: [] },
  });
  const gateArtifact = path.join(lifecycle.paths.sessionDir, 'gate.json');
  privateJson(gateArtifact, { status: 'ready' });
  const gateStat = fs.lstatSync(gateArtifact);
  assert.equal(gateStat.isFile(), true);
  assert.equal(gateStat.nlink, 1);
  const gateDigest = digest(fs.readFileSync(gateArtifact));
  append({
    event_type: 'node.completed',
    node_id: 'gate',
    worktree_fingerprint: lifecycle.fingerprint,
    artifact_refs: ['gate.json'],
    producer: { role: 'apex' },
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'gate.json', digest: gateDigest }],
      cost_units: 1,
      duration_ms: 10,
    },
  });
  lifecycle.state(['ship', '--workspace', workspace]);
  append({
    event_type: 'node.started',
    node_id: 'ship',
    worktree_fingerprint: lifecycle.fingerprint,
    producer: { role: 'apex' },
    payload: {
      input_refs: [{ source_node: 'gate', artifact_ref: 'gate.json', digest: gateDigest }],
    },
  });
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: workspace,
    encoding: 'utf8',
  }).trim();
  const request = {
    schema_version: 1,
    request_id: `request-${task}`,
    workflow_id: compiled.plan.workflow_id,
    node_id: 'ship',
    worktreeFingerprint: lifecycle.fingerprint,
    budget: { maxCostUnits: 1, maxDurationMs: 2_000 },
    type: 'github.openDraftPr',
    baseRef: 'main',
    headSha,
    titleDigest: digest('title'),
    bodyDigest: digest('body'),
    idempotencyKey: 'draft-pr:host-adapter',
  };
  const requestFile = path.join(root, 'request.json');
  privateJson(requestFile, request);
  return {
    ...lifecycle,
    ...adapter,
    adapterKeys,
    compiled,
    data,
    headSha,
    registryKeys,
    request,
    requestFile,
    root,
    workspace,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function initializeProcessFixture(task, { alias = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-process-adapter-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(workspace, 'allowed'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'phantom@example.com'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Phantom'], { cwd: workspace });
  const source = path.join(workspace, 'allowed', 'source.txt');
  fs.writeFileSync(source, 'bound content\n');
  execFileSync('git', ['add', 'allowed/source.txt'], { cwd: workspace });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: workspace });
  execFileSync('git', ['switch', '-qc', 'feat/process-adapter'], { cwd: workspace });
  if (alias === 'mixed-scope') fs.linkSync(source, path.join(workspace, 'outside.txt'));
  if (alias === 'external') fs.linkSync(source, path.join(root, 'external-alias.txt'));
  process.env.PHANTOM_DATA = data;
  const lifecycle = initializeLifecycle({ workspace, data, task, scopes: ['implementation'] });
  const registryKeys = generateKeyPairSync('ed25519');
  const adapterKeys = generateKeyPairSync('ed25519');
  const adapter = installAdapter({
    data,
    paths: lifecycle.paths,
    task,
    registryKeys,
    adapterKeys,
    capabilities: [processCapability()],
  });
  const command = ['node', '--test'];
  const compiled = compileWorkflow({
    schema_version: 2,
    workflow_id: 'wf-process-adapter',
    route: 'direct',
    risk: 'low',
    baseline_fingerprint: lifecycle.fingerprint,
    session_binding: {
      repo_id: lifecycle.paths.repo.id,
      task_id: task,
      route: 'direct',
      approved_plan: null,
    },
    routing: {
      recommended_route: 'direct',
      confidence: 0.95,
      fallback_route: null,
      signals: {},
    },
    execution_mode: 'attended',
    acceptance_criteria: ['only an exactly attested process delta is accepted'],
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
      acceptance_criteria: ['the process delta is scope bound'],
      allowed_paths: ['allowed'],
      allowed_commands: [command],
      allowed_cwds: ['.'],
    }],
  });
  writeCompiledWorkflow(lifecycle.paths.sessionDir, compiled);
  appendWorkflowEvent({
    sessionDir: lifecycle.paths.sessionDir,
    compiled,
    input: {
      event_type: 'workflow.started',
      node_id: null,
      worktree_fingerprint: lifecycle.fingerprint,
      producer: { role: 'apex' },
      payload: {},
    },
  });
  appendWorkflowEvent({
    sessionDir: lifecycle.paths.sessionDir,
    compiled,
    input: {
      event_type: 'node.started',
      node_id: 'implement',
      worktree_fingerprint: lifecycle.fingerprint,
      producer: { role: 'blade' },
      payload: { input_refs: [] },
    },
  });
  const request = {
    schema_version: 1,
    request_id: `request-${task}`,
    workflow_id: compiled.plan.workflow_id,
    node_id: 'implement',
    worktreeFingerprint: lifecycle.fingerprint,
    budget: { maxCostUnits: 1, maxDurationMs: 5_000 },
    type: 'process.exec',
    command,
    cwd: '.',
  };
  const requestFile = path.join(root, 'request.json');
  privateJson(requestFile, request);
  return {
    ...lifecycle,
    ...adapter,
    adapterKeys,
    compiled,
    data,
    registryKeys,
    request,
    requestFile,
    root,
    source,
    workspace,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function authorize(fixture) {
  return runCapabilityBroker([
    'authorize',
    '--workspace', fixture.workspace,
    '--task', fixture.paths.task,
    '--input', fixture.requestFile,
  ]);
}

function signedGithubAttestation(fixture, decision, overrides = {}) {
  const manifest = buildWorkspaceManifest(fixture.workspace);
  const afterFingerprint = workspaceSnapshot(fixture.workspace).digest;
  const signingRegistration = overrides.registration ?? fixture.registration;
  const signingKey = overrides.adapter_private_key ?? fixture.adapterKeys.privateKey;
  const result = {
    type: 'github.openDraftPr',
    host: 'github.com',
    repository_id: 'cloudzero/research-phantom',
    base_ref: fixture.request.baseRef,
    head_ref: 'feat/host-adapter',
    head_sha: fixture.headSha,
    draft: true,
    title_digest: fixture.request.titleDigest,
    body_digest: fixture.request.bodyDigest,
    pull_request_id: '123',
    external_reference: 'https://github.com/cloudzero/research-phantom/pull/123',
    error: null,
    ...(overrides.result ?? {}),
  };
  const value = {
    schema_version: 1,
    attestation_kind: 'capability-execution',
    attestation_id: overrides.attestation_id ?? `attestation-${fixture.paths.task}`,
    registration_digest: hostAdapterRegistrationDigest(signingRegistration),
    adapter_id: signingRegistration.adapter.adapter_id,
    adapter_version: signingRegistration.adapter.adapter_version,
    attestation_key_id: signingRegistration.adapter.attestation_key_id,
    capability_type: 'github.openDraftPr',
    workflow_id: fixture.request.workflow_id,
    node_id: fixture.request.node_id,
    request_id: fixture.request.request_id,
    request_digest: decision.request_digest,
    decision_digest: decision.decision_digest,
    reservation_digest: decision.reservation.reservation_digest,
    idempotency_key: fixture.request.idempotencyKey,
    execution_nonce: overrides.execution_nonce ?? decision.reservation.execution_nonce,
    authorized_journal_tail_digest: decision.reservation.authorized_journal_tail_digest,
    worktree_fingerprint_before: fixture.request.worktreeFingerprint,
    worktree_fingerprint_after: afterFingerprint,
    workspace_evidence_digest_before: decision.reservation.workspace_evidence_digest_before,
    workspace_evidence_digest_after: manifest.evidence.evidence_digest,
    policy_digest: adapterCapabilityPolicyDigest(githubCapability()),
    started_at: overrides.started_at ?? iso(-2_000),
    completed_at: overrides.completed_at ?? iso(-1_500),
    issued_at: overrides.issued_at ?? iso(-1_000),
    expires_at: overrides.expires_at ?? iso(4 * 60_000),
    status: overrides.status ?? 'succeeded',
    resolution: overrides.resolution ?? null,
    reconciles_attestation_digest: overrides.reconciles_attestation_digest ?? null,
    result,
    source_event_id: overrides.source_event_id ?? `execution-source-${fixture.paths.task}`,
    replay_id: overrides.replay_id ?? `execution-replay-${fixture.paths.task}`,
    signature: '',
  };
  return signValue(value, capabilityExecutionAttestationSigningPayload, signingKey);
}

function signedProcessAttestation(fixture, decision, changedPaths, overrides = {}) {
  const manifest = buildWorkspaceManifest(fixture.workspace);
  const value = {
    schema_version: 1,
    attestation_kind: 'capability-execution',
    attestation_id: overrides.attestation_id ?? `attestation-${fixture.paths.task}`,
    registration_digest: hostAdapterRegistrationDigest(fixture.registration),
    adapter_id: fixture.registration.adapter.adapter_id,
    adapter_version: fixture.registration.adapter.adapter_version,
    attestation_key_id: fixture.registration.adapter.attestation_key_id,
    capability_type: 'process.exec',
    workflow_id: fixture.request.workflow_id,
    node_id: fixture.request.node_id,
    request_id: fixture.request.request_id,
    request_digest: decision.request_digest,
    decision_digest: decision.decision_digest,
    reservation_digest: decision.reservation.reservation_digest,
    idempotency_key: decision.idempotency_key,
    execution_nonce: decision.reservation.execution_nonce,
    authorized_journal_tail_digest: decision.reservation.authorized_journal_tail_digest,
    worktree_fingerprint_before: fixture.request.worktreeFingerprint,
    worktree_fingerprint_after: workspaceSnapshot(fixture.workspace).digest,
    workspace_evidence_digest_before: decision.reservation.workspace_evidence_digest_before,
    workspace_evidence_digest_after: manifest.evidence.evidence_digest,
    policy_digest: adapterCapabilityPolicyDigest(processCapability()),
    started_at: overrides.started_at ?? iso(-2_000),
    completed_at: overrides.completed_at ?? iso(-1_500),
    issued_at: iso(-1_000),
    expires_at: iso(4 * 60_000),
    status: overrides.status ?? 'succeeded',
    resolution: null,
    reconciles_attestation_digest: null,
    result: {
      type: 'process.exec',
      exit_code: 0,
      signal: null,
      duration_ms: 20,
      stdout_digest: digest(''),
      stderr_digest: digest(''),
      output_truncated: false,
      changed_paths: changedPaths,
      external_reference: null,
      error: null,
      ...(overrides.result ?? {}),
    },
    source_event_id: overrides.source_event_id ?? `execution-source-${fixture.paths.task}`,
    replay_id: overrides.replay_id ?? `execution-replay-${fixture.paths.task}`,
    signature: '',
  };
  return signValue(value, capabilityExecutionAttestationSigningPayload, fixture.adapterKeys.privateKey);
}

function ledger(fixture) {
  return fs.readFileSync(workflowPaths(fixture.paths.sessionDir).journalFile, 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
}

test('broker accepts only signed host evidence and journals digest-only v2 outcomes', () => {
  const previousData = process.env.PHANTOM_DATA;
  const fixture = initializeGithubFixture('adapter-success');
  try {
    let callbackCalls = 0;
    const decision = runCapabilityBroker([
      'authorize', '--workspace', fixture.workspace, '--task', fixture.paths.task,
      '--input', fixture.requestFile,
    ], {
      adapter() {
        callbackCalls += 1;
      },
    });
    assert.equal(decision.status, 'authorized');
    assert.equal(callbackCalls, 0);
    assert.match(decision.reservation.execution_nonce, /^[A-Za-z0-9_-]{43}$/);

    const attestation = signedGithubAttestation(fixture, decision);
    const pendingFile = path.join(
      fixture.paths.sessionDir,
      'capability',
      'reservations',
      'pending',
      `${decision.decision_digest.replace('sha256:', '')}.json`,
    );
    const pendingRaw = fs.readFileSync(pendingFile, 'utf8');
    const missingHostDigest = JSON.parse(pendingRaw);
    const { binding_digest: ignoredBindingDigest, ...hostBinding } = missingHostDigest.hard_enforcement;
    void ignoredBindingDigest;
    delete hostBinding.policy_digest;
    missingHostDigest.hard_enforcement = {
      ...hostBinding,
      binding_digest: digest(canonicalJson({ request: missingHostDigest.request, binding: hostBinding })),
    };
    missingHostDigest.reservation_binding.hard_enforcement = structuredClone(
      missingHostDigest.hard_enforcement,
    );
    missingHostDigest.reservation_digest = digest(canonicalJson(missingHostDigest.reservation_binding));
    fs.writeFileSync(pendingFile, `${canonicalJson(missingHostDigest)}\n`);
    assert.throws(() => ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation,
    }), /hard_enforcement.*variant shape/i);
    fs.writeFileSync(pendingFile, pendingRaw);
    const ingested = ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation,
    });
    assert.equal(ingested.status, 'succeeded');
    const outcomeEvent = ledger(fixture).at(-1);
    assert.equal(outcomeEvent.event_type, 'capability.outcome');
    assert.equal(outcomeEvent.recorded_at, outcomeEvent.payload.recorded_at);
    assert.deepEqual(Object.keys(outcomeEvent.payload).sort(), [
      'attestation_digest', 'budget_charge', 'capability_type', 'decision_digest', 'error',
      'execution_nonce', 'external_reference', 'idempotency_key', 'outcome_digest', 'outcome_kind', 'policy_digest',
      'reconciliation_of', 'recorded_at', 'registration_digest', 'registry_trust_digest',
      'request_digest', 'request_id', 'reservation_digest', 'result_digest',
      'schema_version', 'status',
    ].sort());
    assert.deepEqual(outcomeEvent.payload.budget_charge, { cost_units: 1, duration_ms: 2_000 });
    const journalText = JSON.stringify(outcomeEvent.payload);
    assert.equal(journalText.includes(fixture.registration.signature), false);
    assert.equal(journalText.includes(fixture.registration.adapter.attestation_public_key), false);
    assert.equal(Object.hasOwn(outcomeEvent.payload, 'pull_request_id'), false);
    assert.deepEqual(outcomeEvent.artifact_refs.map((artifactRef) => artifactRef.split('/')[2]).sort(), [
      'attestations',
      'execution-evidence',
      'policies',
      'registrations',
      'registry-trust',
      'requests',
      'reservations',
      'results',
      'workspace-manifests',
    ]);
    assert.equal(replayWorkflowSession(fixture.paths.sessionDir).state.status, 'running');

    const journalFile = workflowPaths(fixture.paths.sessionDir).journalFile;
    const genuineJournal = fs.readFileSync(journalFile, 'utf8');
    const forgedEvents = ledger(fixture);
    const forgedOutcome = forgedEvents.at(-1);
    const forgedAttestation = structuredClone(attestation);
    forgedAttestation.signature = Buffer.alloc(64).toString('base64');
    const forgedAttestationDigest = digest(canonicalJson(forgedAttestation));
    const forgedAttestationRef = `capability/artifacts/attestations/${forgedAttestationDigest.slice(7)}.json`;
    privateJson(path.join(fixture.paths.sessionDir, forgedAttestationRef), forgedAttestation);
    forgedOutcome.artifact_refs = forgedOutcome.artifact_refs
      .map((artifactRef) => artifactRef.includes('/attestations/')
        ? forgedAttestationRef
        : artifactRef)
      .sort();
    forgedOutcome.payload.attestation_digest = forgedAttestationDigest;
    const { outcome_digest: ignoredOutcomeDigest, ...unsignedOutcome } = forgedOutcome.payload;
    void ignoredOutcomeDigest;
    forgedOutcome.payload.outcome_digest = digest(canonicalJson(unsignedOutcome));
    forgedOutcome.payload_digest = digest(canonicalJson(forgedOutcome.payload));
    const { event_digest: ignoredEventDigest, ...unsignedEvent } = forgedOutcome;
    void ignoredEventDigest;
    forgedOutcome.event_digest = digest(canonicalJson(unsignedEvent));
    fs.writeFileSync(journalFile, `${forgedEvents.map(JSON.stringify).join('\n')}\n`);
    try {
      assert.throws(
        () => replayWorkflowSession(fixture.paths.sessionDir),
        /capability execution attestation signature is invalid/i,
      );
    } finally {
      fs.writeFileSync(journalFile, genuineJournal);
    }

    const artifactRoot = path.join(fixture.paths.sessionDir, 'capability', 'artifacts');
    for (const kind of [
      'requests', 'reservations', 'registry-trust', 'registrations', 'policies', 'attestations',
      'results', 'workspace-manifests', 'execution-evidence',
    ]) {
      const files = fs.readdirSync(path.join(artifactRoot, kind));
      assert.ok(files.length >= 1);
      for (const file of files) {
        const metadata = fs.lstatSync(path.join(artifactRoot, kind, file));
        assert.equal(metadata.mode & 0o777, 0o600);
        assert.equal(metadata.nlink, 1);
      }
    }
    const beforeReplay = ledger(fixture).length;
    const replay = authorize(fixture);
    assert.equal(replay.status, 'duplicate');
    assert.deepEqual(replay.reason_codes, ['idempotent_replay']);
    assert.equal(ledger(fixture).length, beforeReplay);
    const replayedAttestation = ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation,
    });
    assert.equal(replayedAttestation.outcome.outcome_digest, ingested.outcome.outcome_digest);
    assert.throws(() => runCapabilityBroker([
      'execute', '--workspace', fixture.workspace, '--task', fixture.paths.task,
    ]), /Unknown capability broker action/);
  } finally {
    fixture.cleanup();
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
  }
});

test('reservation v2 validation rejects rehashed semantic mutations and illegal transitions', () => {
  const previousData = process.env.PHANTOM_DATA;
  const fixture = initializeGithubFixture('reservation-v2-mutations');
  try {
    const decision = authorize(fixture);
    const reservationName = `${decision.decision_digest.replace('sha256:', '')}.json`;
    const reservationRoot = path.join(fixture.paths.sessionDir, 'capability', 'reservations');
    const pendingFile = path.join(reservationRoot, 'pending', reservationName);
    const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    assert.deepEqual(validateCapabilityReservation(pending, { lane: 'pending' }), []);
    assert.deepEqual(pending.reserved_budget, { cost_units: 1, duration_ms: 2_000 });

    const invalidTail = structuredClone(pending);
    invalidTail.authorized_journal_tail_digest = 'sha256:bad';
    invalidTail.reservation_binding.authorized_journal_tail_digest = 'sha256:bad';
    invalidTail.reservation_digest = capabilityReservationDigest(invalidTail.reservation_binding);
    assert.match(validateCapabilityReservation(invalidTail).join('\n'), /journal_tail_digest/);

    const invalidHardBinding = structuredClone(pending);
    invalidHardBinding.hard_enforcement.command = [''];
    rehashReservation(invalidHardBinding);
    assert.match(validateCapabilityReservation(invalidHardBinding).join('\n'), /bounded argv|does not match request/);
    const invalidHardDigest = structuredClone(pending);
    invalidHardDigest.hard_enforcement.authority_decision_digest = 'sha256:bad';
    rehashReservation(invalidHardDigest);
    assert.match(validateCapabilityReservation(invalidHardDigest).join('\n'), /authority_decision_digest/);
    const invalidHardPath = structuredClone(pending);
    invalidHardPath.hard_enforcement.paths = ['../escape'];
    rehashReservation(invalidHardPath);
    assert.match(validateCapabilityReservation(invalidHardPath).join('\n'), /portable paths|does not match request/);

    const invalidIdentifier = structuredClone(pending);
    invalidIdentifier.request.request_id = 'invalid identifier';
    invalidIdentifier.request_id = invalidIdentifier.request.request_id;
    invalidIdentifier.request_digest = digest(canonicalJson(invalidIdentifier.request));
    Object.assign(invalidIdentifier.reservation_binding, {
      request: structuredClone(invalidIdentifier.request),
      request_id: invalidIdentifier.request_id,
      request_digest: invalidIdentifier.request_digest,
    });
    rehashReservation(invalidIdentifier);
    assert.match(validateCapabilityReservation(invalidIdentifier).join('\n'), /request_id|request/);

    const invalidBaseline = structuredClone(pending);
    invalidBaseline.reservation_binding.host_adapter.baseline_snapshot.evidence.content_root = DIGEST_A;
    invalidBaseline.reservation_digest = capabilityReservationDigest(invalidBaseline.reservation_binding);
    assert.match(validateCapabilityReservation(invalidBaseline).join('\n'), /content_root/);

    const invalidTopologyRoot = structuredClone(pending);
    const topologyEvidence = invalidTopologyRoot.reservation_binding
      .host_adapter.baseline_snapshot.evidence;
    assert.notEqual(topologyEvidence.physical_topology_root, DIGEST_A);
    topologyEvidence.physical_topology_root = DIGEST_A;
    const { evidence_digest: ignoredEvidenceDigest, ...unsignedEvidence } = topologyEvidence;
    void ignoredEvidenceDigest;
    topologyEvidence.evidence_digest = domainDigest(
      'phantom-workspace-evidence-v2',
      unsignedEvidence,
    );
    invalidTopologyRoot.workspace_evidence_digest_before = topologyEvidence.evidence_digest;
    invalidTopologyRoot.reservation_binding.workspace_evidence_digest_before =
      topologyEvidence.evidence_digest;
    rehashReservation(invalidTopologyRoot);
    assert.equal(
      invalidTopologyRoot.reservation_digest,
      capabilityReservationDigest(invalidTopologyRoot.reservation_binding),
    );
    const topologyErrors = validateCapabilityReservation(invalidTopologyRoot).join('\n');
    assert.match(topologyErrors, /physical_topology_root: invalid/);
    assert.doesNotMatch(topologyErrors, /reservation_digest/);

    const missingTopologyDigest = structuredClone(pending);
    delete missingTopologyDigest.reservation_binding.host_adapter
      .baseline_snapshot.evidence.physical_shards[0].topology_digest;
    missingTopologyDigest.reservation_digest = capabilityReservationDigest(
      missingTopologyDigest.reservation_binding,
    );
    assert.match(
      validateCapabilityReservation(missingTopologyDigest).join('\n'),
      /physical_shards\[0\].*topology_digest|unsupported shard reference shape/,
    );

    const invalidArtifact = structuredClone(pending);
    invalidArtifact.reservation_binding.host_adapter.registration.artifact_ref =
      invalidArtifact.reservation_binding.host_adapter.registry_trust.artifact_ref;
    invalidArtifact.reservation_digest = capabilityReservationDigest(invalidArtifact.reservation_binding);
    assert.match(validateCapabilityReservation(invalidArtifact).join('\n'), /registration.*artifact_ref/);

    const attestation = signedGithubAttestation(fixture, decision);
    ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation,
    });
    const completed = JSON.parse(fs.readFileSync(
      path.join(reservationRoot, 'completed', reservationName),
      'utf8',
    ));
    assert.deepEqual(validateCapabilityReservation(completed, { lane: 'completed' }), []);

    const invalidAttestationStatus = structuredClone(completed);
    invalidAttestationStatus.attestations[0].status = 'reconciled';
    assert.match(validateCapabilityReservation(invalidAttestationStatus).join('\n'), /attestation status|status/);
    const invalidAttestationArtifact = structuredClone(completed);
    invalidAttestationArtifact.attestations[0].artifact_ref =
      invalidAttestationArtifact.attestations[0].workspace_after.artifact_ref;
    assert.match(validateCapabilityReservation(invalidAttestationArtifact).join('\n'), /attestation.*artifact_ref/);
    const invalidWorkspaceEvidence = structuredClone(completed);
    invalidWorkspaceEvidence.attestations[0].workspace_after.evidence.evidence_digest = DIGEST_A;
    assert.match(validateCapabilityReservation(invalidWorkspaceEvidence).join('\n'), /evidence_digest/);
    const invalidFinal = structuredClone(completed);
    invalidFinal.error = 'contradictory success';
    invalidFinal.external_reference = null;
    assert.match(validateCapabilityReservation(invalidFinal).join('\n'), /error|external_reference/);
    assert.match(validateCapabilityReservationTransition({
      fromLane: 'pending',
      toLane: 'completed',
      before: pending,
      after: completed,
    }).join('\n'), /unsupported reservation transition/);
  } finally {
    fixture.cleanup();
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
  }
});

test('untrusted self-signed and stale registrations cannot create reservations', () => {
  const previousData = process.env.PHANTOM_DATA;
  const selfSigned = initializeGithubFixture('adapter-self-signed');
  try {
    signValue(
      selfSigned.registration,
      hostAdapterRegistrationSigningPayload,
      selfSigned.adapterKeys.privateKey,
    );
    privateJson(
      path.join(selfSigned.paths.sessionDir, 'host-adapter-registration.json'),
      selfSigned.registration,
    );
    const denied = authorize(selfSigned);
    assert.equal(denied.status, 'denied');
    assert.ok(denied.reason_codes.includes('host_adapter_unavailable'));
    const reservationRoot = path.join(selfSigned.paths.sessionDir, 'capability', 'reservations');
    assert.equal(fs.existsSync(reservationRoot), false);
  } finally {
    selfSigned.cleanup();
  }

  const stale = initializeGithubFixture('adapter-stale');
  try {
    stale.registration.issued_at = iso(-10 * 60_000);
    stale.registration.expires_at = iso(-1_000);
    signValue(stale.registration, hostAdapterRegistrationSigningPayload, stale.registryKeys.privateKey);
    privateJson(path.join(stale.paths.sessionDir, 'host-adapter-registration.json'), stale.registration);
    const denied = authorize(stale);
    assert.equal(denied.status, 'denied');
    assert.ok(denied.reason_codes.includes('host_adapter_unavailable'));
  } finally {
    stale.cleanup();
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
  }
});

test('signed target escape, stale workspace, and missing or mutated artifacts fail closed', () => {
  const previousData = process.env.PHANTOM_DATA;
  const target = initializeGithubFixture('adapter-target');
  try {
    const decision = authorize(target);
    const wrongNonce = signedGithubAttestation(target, decision, {
      attestation_id: 'attestation-wrong-nonce',
      source_event_id: 'execution-source-wrong-nonce',
      replay_id: 'execution-replay-wrong-nonce',
      execution_nonce: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    assert.throws(() => ingestCapabilityAttestation({
      workspace: target.workspace,
      task: target.paths.task,
      attestation: wrongNonce,
    }), /execution_nonce does not match the reservation/i);
    for (const [field, value] of [
      ['base_ref', 'develop'],
      ['title_digest', digest('provider-mutated-title')],
      ['body_digest', digest('provider-mutated-body')],
    ]) {
      const drift = signedGithubAttestation(target, decision, {
        attestation_id: `attestation-drift-${field}`,
        source_event_id: `execution-source-drift-${field}`,
        replay_id: `execution-replay-drift-${field}`,
        result: { [field]: value },
      });
      assert.throws(() => ingestCapabilityAttestation({
        workspace: target.workspace,
        task: target.paths.task,
        attestation: drift,
      }), /registered target restriction|does not match the request binding/i);
    }
    const escaped = signedGithubAttestation(target, decision, {
      result: { repository_id: 'cloudzero/other-repository' },
    });
    assert.throws(() => ingestCapabilityAttestation({
      workspace: target.workspace,
      task: target.paths.task,
      attestation: escaped,
    }), /registered target restriction|target/i);
    assert.equal(ledger(target).filter((event) => event.event_type === 'capability.outcome').length, 0);
  } finally {
    target.cleanup();
  }

  const stale = initializeGithubFixture('adapter-worktree');
  try {
    const decision = authorize(stale);
    fs.writeFileSync(path.join(stale.workspace, 'unexpected.txt'), 'changed after reservation\n');
    const attestation = signedGithubAttestation(stale, decision);
    assert.throws(() => ingestCapabilityAttestation({
      workspace: stale.workspace,
      task: stale.paths.task,
      attestation,
    }), /changed the bound workspace/i);
  } finally {
    stale.cleanup();
  }

  const missing = initializeGithubFixture('adapter-missing-artifact');
  try {
    const decision = authorize(missing);
    const registrationDirectory = path.join(
      missing.paths.sessionDir,
      'capability',
      'artifacts',
      'registrations',
    );
    fs.unlinkSync(path.join(registrationDirectory, fs.readdirSync(registrationDirectory)[0]));
    const attestation = signedGithubAttestation(missing, decision);
    assert.throws(() => ingestCapabilityAttestation({
      workspace: missing.workspace,
      task: missing.paths.task,
      attestation,
    }), /Capability artifact is missing/i);
  } finally {
    missing.cleanup();
  }

  const mutated = initializeGithubFixture('adapter-mutated-artifact');
  try {
    const decision = authorize(mutated);
    const registrationDirectory = path.join(
      mutated.paths.sessionDir,
      'capability',
      'artifacts',
      'registrations',
    );
    const registrationArtifact = path.join(registrationDirectory, fs.readdirSync(registrationDirectory)[0]);
    fs.appendFileSync(registrationArtifact, ' ');
    const attestation = signedGithubAttestation(mutated, decision);
    assert.throws(() => ingestCapabilityAttestation({
      workspace: mutated.workspace,
      task: mutated.paths.task,
      attestation,
    }), /canonical immutable form|digest/i);
  } finally {
    mutated.cleanup();
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
  }
});

test('indeterminate execution blocks retry until a same-reservation signed reconciliation', () => {
  const previousData = process.env.PHANTOM_DATA;
  const fixture = initializeGithubFixture('adapter-reconciliation');
  try {
    const decision = authorize(fixture);
    const indeterminate = signedGithubAttestation(fixture, decision, {
      status: 'indeterminate',
      result: {
        pull_request_id: null,
        external_reference: null,
        error: 'host response was lost after dispatch',
      },
    });
    const first = ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation: indeterminate,
    });
    assert.equal(first.status, 'indeterminate');
    const retry = authorize(fixture);
    assert.equal(retry.status, 'denied');
    assert.deepEqual(retry.reason_codes, ['idempotency_reconciliation_required']);

    const priorDigest = capabilityExecutionAttestationDigest(indeterminate);
    const registrationArtifacts = path.join(
      fixture.paths.sessionDir,
      'capability',
      'artifacts',
      'registrations',
    );
    assert.equal(fs.readdirSync(registrationArtifacts).length, 1);
    const pinnedRegistration = JSON.parse(fs.readFileSync(
      path.join(registrationArtifacts, fs.readdirSync(registrationArtifacts)[0]),
      'utf8',
    ));
    assert.equal(
      hostAdapterRegistrationDigest(pinnedRegistration),
      hostAdapterRegistrationDigest(fixture.registration),
    );
    const wrong = signedGithubAttestation(fixture, decision, {
      attestation_id: 'attestation-reconciliation-wrong',
      source_event_id: 'execution-source-reconciliation-wrong',
      replay_id: 'execution-replay-reconciliation-wrong',
      status: 'reconciled',
      resolution: 'succeeded',
      reconciles_attestation_digest: digest('wrong-indeterminate-attestation'),
    });
    assert.throws(() => ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation: wrong,
    }), /reconciliation|reservation/i);
    assert.equal(fs.readdirSync(registrationArtifacts).length, 1);
    assert.equal(
      hostAdapterRegistrationDigest(JSON.parse(fs.readFileSync(
        path.join(fixture.paths.sessionDir, 'host-adapter-registration.json'),
        'utf8',
      ))),
      hostAdapterRegistrationDigest(pinnedRegistration),
    );

    const reconciled = signedGithubAttestation(fixture, decision, {
      attestation_id: 'attestation-reconciliation-final',
      source_event_id: 'execution-source-reconciliation-final',
      replay_id: 'execution-replay-reconciliation-final',
      status: 'reconciled',
      resolution: 'succeeded',
      reconciles_attestation_digest: priorDigest,
    });
    const final = ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation: reconciled,
    });
    assert.equal(final.status, 'succeeded');
    const outcomes = ledger(fixture)
      .filter((event) => event.event_type === 'capability.outcome'
        && event.payload.schema_version === 2);
    assert.deepEqual(outcomes.map((event) => event.payload.status), [
      'indeterminate',
      'succeeded',
    ]);
    assert.equal(outcomes[1].payload.reconciliation_of, priorDigest);
    assert.equal(outcomes[0].payload.reservation_digest, outcomes[1].payload.reservation_digest);
  } finally {
    fixture.cleanup();
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
  }
});

test('an expired original registration permits one reconciliation through a current trusted key', (t) => {
  const previousData = process.env.PHANTOM_DATA;
  const fixture = initializeGithubFixture('adapter-expired-reconciliation');
  let timersMocked = false;
  try {
    const decision = authorize(fixture);
    const indeterminate = signedGithubAttestation(fixture, decision, {
      status: 'indeterminate',
      result: {
        pull_request_id: null,
        external_reference: null,
        error: 'host response was lost after dispatch',
      },
    });
    assert.equal(ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation: indeterminate,
    }).status, 'indeterminate');

    const reservationName = `${decision.decision_digest.replace('sha256:', '')}.json`;
    const reservationRoot = path.join(
      fixture.paths.sessionDir,
      'capability',
      'reservations',
    );
    const indeterminateFile = path.join(reservationRoot, 'indeterminate', reservationName);
    const originalReservation = JSON.parse(fs.readFileSync(indeterminateFile, 'utf8'));
    const pinnedHostEvidence = structuredClone(
      originalReservation.reservation_binding.host_adapter,
    );
    const registrationArtifacts = path.join(
      fixture.paths.sessionDir,
      'capability',
      'artifacts',
      'registrations',
    );
    const trustArtifacts = path.join(
      fixture.paths.sessionDir,
      'capability',
      'artifacts',
      'registry-trust',
    );
    const originalRegistrationArtifact = path.join(
      registrationArtifacts,
      `${decision.reservation.registration_digest.replace('sha256:', '')}.json`,
    );
    const originalRegistrationBytes = fs.readFileSync(originalRegistrationArtifact);
    assert.equal(ledger(fixture)
      .filter((event) => event.event_type === 'capability.decision').length, 1);

    t.mock.timers.enable({
      apis: ['Date'],
      now: Date.parse(fixture.registration.expires_at) + 1,
    });
    timersMocked = true;
    const renewed = renewAdapterRegistration(fixture);
    const renewedDigest = hostAdapterRegistrationDigest(renewed.registration);
    assert.notEqual(renewedDigest, decision.reservation.registration_digest);

    const priorDigest = capabilityExecutionAttestationDigest(indeterminate);
    const reconciled = signedGithubAttestation(fixture, decision, {
      adapter_private_key: renewed.adapterKeys.privateKey,
      registration: renewed.registration,
      attestation_id: 'attestation-expired-reconciliation-final',
      source_event_id: 'execution-source-expired-reconciliation-final',
      replay_id: 'execution-replay-expired-reconciliation-final',
      status: 'reconciled',
      resolution: 'succeeded',
      reconciles_attestation_digest: priorDigest,
    });
    assert.equal(ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation: reconciled,
    }).status, 'succeeded');

    const events = ledger(fixture);
    assert.equal(events.filter((event) => event.event_type === 'capability.decision').length, 1);
    const outcomes = events.filter((event) => event.event_type === 'capability.outcome'
      && event.payload.schema_version === 2);
    assert.deepEqual(outcomes.map((event) => event.payload.status), [
      'indeterminate',
      'succeeded',
    ]);
    assert.equal(outcomes[1].payload.reconciliation_of, priorDigest);
    assert.equal(outcomes[1].payload.registration_digest, renewedDigest);
    assert.equal(
      outcomes[1].payload.registry_trust_digest,
      decision.reservation.registry_trust_digest,
    );
    assert.equal(outcomes[0].payload.reservation_digest, outcomes[1].payload.reservation_digest);

    const completedReservation = JSON.parse(fs.readFileSync(
      path.join(reservationRoot, 'completed', reservationName),
      'utf8',
    ));
    assert.deepEqual(
      completedReservation.reservation_binding.host_adapter,
      pinnedHostEvidence,
    );
    assert.deepEqual(fs.readFileSync(originalRegistrationArtifact), originalRegistrationBytes);
    assert.equal(fs.readdirSync(registrationArtifacts).length, 2);
    assert.equal(fs.readdirSync(trustArtifacts).length, 1);

    const duplicate = signedGithubAttestation(fixture, decision, {
      adapter_private_key: renewed.adapterKeys.privateKey,
      registration: renewed.registration,
      attestation_id: 'attestation-expired-reconciliation-duplicate',
      source_event_id: 'execution-source-expired-reconciliation-duplicate',
      replay_id: 'execution-replay-expired-reconciliation-duplicate',
      status: 'reconciled',
      resolution: 'succeeded',
      reconciles_attestation_digest: priorDigest,
    });
    assert.throws(() => ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation: duplicate,
    }), /indeterminate reservation/i);
    assert.equal(ledger(fixture).length, events.length);
    assert.equal(fs.readdirSync(registrationArtifacts).length, 2);
  } finally {
    if (timersMocked) t.mock.timers.reset();
    fixture.cleanup();
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
  }
});

test('ambiguous failed attestations cannot assert a successful external identity', () => {
  const previousData = process.env.PHANTOM_DATA;
  const fixture = initializeGithubFixture('adapter-ambiguous-failure');
  try {
    const decision = authorize(fixture);
    const ambiguous = signedGithubAttestation(fixture, decision, {
      status: 'failed',
      result: { error: 'host reported failure while retaining a pull request identity' },
    });
    assert.throws(() => ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation: ambiguous,
    }), /Failed result requires an error and no asserted external identity/i);
    assert.equal(ledger(fixture).filter((event) => event.event_type === 'capability.outcome').length, 0);
  } finally {
    fixture.cleanup();
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
  }
});

test('process reservation preflight rejects mixed-scope and unknown hard-link aliases', () => {
  const previousData = process.env.PHANTOM_DATA;
  for (const alias of ['mixed-scope', 'external']) {
    const fixture = initializeProcessFixture(`adapter-hardlink-${alias}`, { alias });
    try {
      assert.throws(() => authorize(fixture), /physical file identity|hard-link identity/i);
      const pending = path.join(
        fixture.paths.sessionDir,
        'capability',
        'reservations',
        'pending',
      );
      assert.deepEqual(fs.readdirSync(pending), []);
      assert.equal(ledger(fixture).some((event) => event.event_type === 'capability.decision'), false);
    } finally {
      fixture.cleanup();
    }
  }
  if (previousData === undefined) delete process.env.PHANTOM_DATA;
  else process.env.PHANTOM_DATA = previousData;
});

test('process attestation must report the union of content and physical workspace changes', () => {
  const previousData = process.env.PHANTOM_DATA;
  const fixture = initializeProcessFixture('adapter-process-union');
  try {
    const decision = authorize(fixture);
    fs.linkSync(fixture.source, path.join(fixture.workspace, 'allowed', 'alias.txt'));
    const manifest = buildWorkspaceManifest(fixture.workspace);
    const content = new Map(manifest.content_shards
      .flatMap((shard) => shard.entries)
      .map((entry) => [entry.path, entry.digest]));
    const attestation = signedProcessAttestation(fixture, decision, [
      { path: 'allowed/alias.txt', digest: content.get('allowed/alias.txt') },
      { path: 'allowed/source.txt', digest: content.get('allowed/source.txt') },
    ]);
    const outcome = ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation,
    });
    assert.equal(outcome.status, 'succeeded');
  } finally {
    fixture.cleanup();
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
  }
});

test('signed execution timing cannot exceed the reserved duration budget', () => {
  const previousData = process.env.PHANTOM_DATA;
  const fixture = initializeProcessFixture('adapter-process-budget');
  try {
    const decision = authorize(fixture);
    const signedOverrun = signedProcessAttestation(fixture, decision, [], {
      started_at: iso(-7_000),
      completed_at: iso(-1_000),
      attestation_id: 'attestation-process-budget-signed-time',
      source_event_id: 'execution-source-process-budget-signed-time',
      replay_id: 'execution-replay-process-budget-signed-time',
    });
    assert.throws(() => ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation: signedOverrun,
    }), /exceeds its reserved duration budget/i);

    const reportedOverrun = signedProcessAttestation(fixture, decision, [], {
      result: { duration_ms: 5_001 },
      attestation_id: 'attestation-process-budget-reported-time',
      source_event_id: 'execution-source-process-budget-reported-time',
      replay_id: 'execution-replay-process-budget-reported-time',
    });
    assert.throws(() => ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation: reportedOverrun,
    }), /exceeds its reserved duration budget/i);
    assert.equal(ledger(fixture).filter((event) => event.event_type === 'capability.outcome').length, 0);
  } finally {
    fixture.cleanup();
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
  }
});

test('signed process evidence cannot hide an actual out-of-scope workspace delta', () => {
  const previousData = process.env.PHANTOM_DATA;
  const fixture = initializeProcessFixture('adapter-process-scope');
  try {
    const decision = authorize(fixture);
    fs.writeFileSync(path.join(fixture.workspace, 'outside.txt'), 'scope escape\n');
    const baselineDigest = buildWorkspaceManifest(fixture.workspace).content_shards
      .flatMap((shard) => shard.entries)
      .find((entry) => entry.path === 'allowed/source.txt').digest;
    const attestation = signedProcessAttestation(fixture, decision, [
      { path: 'allowed/source.txt', digest: baselineDigest },
    ]);
    assert.throws(() => ingestCapabilityAttestation({
      workspace: fixture.workspace,
      task: fixture.paths.task,
      attestation,
    }), /outside the authorized scope/i);
    assert.equal(ledger(fixture).filter((event) => event.event_type === 'capability.outcome').length, 0);
  } finally {
    fixture.cleanup();
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
  }
});
