// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createHash,
  generateKeyPairSync,
  sign,
} = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATE = path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'phantom-state.mjs');
const bytesDigest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-executor-trust-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'README.md'), 'fixture\n');
  execFileSync('git', ['init', '-q', '-b', 'feat/executor-contract'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'phantom@example.invalid'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Subash Karki'], { cwd: workspace });
  execFileSync('git', ['add', 'README.md'], { cwd: workspace });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: workspace });
  return { root, workspace, data, env: { ...process.env, PHANTOM_DATA: data } };
}

function trustRecord(publicKey, overrides = {}) {
  return {
    schema_version: 1,
    trust_kind: 'isolated-executor-trust',
    generation: 1,
    key_id: 'executor-key-1',
    source: 'host-isolation-service',
    public_key: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    activated_at: '2026-07-31T10:00:00.000Z',
    expires_at: '2026-07-31T14:00:00.000Z',
    replaces_key_id: null,
    ...overrides,
  };
}

function probeRecord({ trust, privateKey, repoId, taskId, fingerprint, issuedAt, expiresAt }) {
  const unsigned = {
    schema_version: 1,
    probe_kind: 'isolated-branch-executor',
    executor_id: 'fixture-executor',
    contract_version: 'isolated-branch-executor-v1',
    repo_id: repoId,
    task_id: taskId,
    worktree_fingerprint: fingerprint,
    isolation_profile: {
      profile_id: 'continuous-isolation-v1',
      platform: 'darwin',
      backend: 'fixture-executor',
      backend_digest: bytesDigest('fixture-executor-v1'),
      filesystem: 'private-root-no-host-writes',
      process: 'contained-and-reaped',
      tool_plane: 'lease-scoped',
      artifact_egress: 'digest-bound',
      network: 'denied',
    },
    self_test: {
      status: 'passed',
      observed_at: issuedAt,
      evidence_digest: bytesDigest('executor-self-test'),
    },
    issued_at: issuedAt,
    expires_at: expiresAt,
    source: trust.source,
    source_event_id: 'executor-probe-event-1',
    replay_id: 'executor-probe-replay-1',
    key_id: trust.key_id,
  };
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(canonical(unsigned)), privateKey).toString('base64'),
  };
}

test('executor trust is strict, expires, and rejects stale keys after replacement', async () => {
  const context = fixture();
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = context.data;
  try {
    const attestation = await import('../skills/phantom/scripts/lib/isolated-executor-attestation.mjs');
    const first = generateKeyPairSync('ed25519');
    const trustFile = attestation.executorTrustFile(context.workspace);
    fs.mkdirSync(path.dirname(trustFile), { recursive: true });
    const firstTrust = trustRecord(first.publicKey);
    fs.writeFileSync(trustFile, JSON.stringify(firstTrust));
    const firstProbe = probeRecord({
      trust: firstTrust, privateKey: first.privateKey, repoId: 'repo', taskId: 'task',
      fingerprint: bytesDigest('baseline'), issuedAt: '2026-07-31T12:00:00.000Z',
      expiresAt: '2026-07-31T12:10:00.000Z',
    });
    const verified = attestation.verifyExecutorProbe({
      workspace: context.workspace, probe: firstProbe, repoId: 'repo', taskId: 'task',
      worktreeFingerprint: bytesDigest('baseline'), atTime: '2026-07-31T12:05:00.000Z',
    });
    assert.equal(verified.binding.key_id, firstTrust.key_id);
    assert.equal(verified.binding.trust_generation, 1);
    assert.throws(() => attestation.readExecutorTrust(context.workspace, {
      atTime: '2026-07-31T15:00:00.000Z',
    }), /trust is not active/);

    fs.writeFileSync(trustFile, JSON.stringify({ ...firstTrust, unsupported: true }));
    assert.throws(() => attestation.readExecutorTrust(context.workspace, {
      atTime: '2026-07-31T12:05:00.000Z',
    }), /unsupported property/);

    const second = generateKeyPairSync('ed25519');
    const secondTrust = trustRecord(second.publicKey, {
      generation: 2,
      key_id: 'executor-key-2',
      replaces_key_id: firstTrust.key_id,
    });
    fs.writeFileSync(trustFile, JSON.stringify(secondTrust));
    assert.throws(() => attestation.verifyExecutorProbe({
      workspace: context.workspace, probe: firstProbe, repoId: 'repo', taskId: 'task',
      worktreeFingerprint: bytesDigest('baseline'), atTime: '2026-07-31T12:05:00.000Z',
    }), /does not match the pinned executor trust root/);
    const secondProbe = probeRecord({
      trust: secondTrust, privateKey: second.privateKey, repoId: 'repo', taskId: 'task',
      fingerprint: bytesDigest('baseline'), issuedAt: '2026-07-31T12:01:00.000Z',
      expiresAt: '2026-07-31T12:11:00.000Z',
    });
    assert.equal(attestation.verifyExecutorProbe({
      workspace: context.workspace, probe: secondProbe, repoId: 'repo', taskId: 'task',
      worktreeFingerprint: bytesDigest('baseline'), atTime: '2026-07-31T12:05:00.000Z',
    }).binding.trust_replaces_key_id, firstTrust.key_id);
    fs.writeFileSync(trustFile, JSON.stringify({ ...secondTrust, replaces_key_id: null }));
    assert.throws(() => attestation.readExecutorTrust(context.workspace, {
      atTime: '2026-07-31T12:05:00.000Z',
    }), /replacement lineage is inconsistent/);
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test('production compiler injects only a current signed executor binding before writing', async () => {
  const context = fixture();
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = context.data;
  try {
    execFileSync(process.execPath, [
      STATE, 'start', '--workspace', context.workspace, '--task', 'parallel-compile',
      '--intent', 'Implement an attested parallel fixture', '--route', 'direct',
    ], { env: context.env });
    const { compileWorkflowFile } = await import('../skills/phantom/scripts/compile-workflow.mjs');
    const attestation = await import('../skills/phantom/scripts/lib/isolated-executor-attestation.mjs');
    const { repoIdentity, sessionPaths } = await import('../skills/phantom/scripts/lib/portable.mjs');
    const { workflowPaths } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
    const { worktreeFingerprint } = await import('../skills/phantom/scripts/phantom-state.mjs');
    const task = 'parallel-compile';
    const session = sessionPaths(context.workspace, task);
    const fingerprint = worktreeFingerprint(context.workspace);
    const keys = generateKeyPairSync('ed25519');
    const current = new Date();
    const trust = trustRecord(keys.publicKey, {
      activated_at: new Date(current.getTime() - 60 * 60_000).toISOString(),
      expires_at: new Date(current.getTime() + 60 * 60_000).toISOString(),
    });
    const trustFile = attestation.executorTrustFile(context.workspace);
    fs.mkdirSync(path.dirname(trustFile), { recursive: true });
    fs.writeFileSync(trustFile, JSON.stringify(trust));
    const planFile = path.join(context.root, 'parallel-plan.json');
    const plan = {
      schema_version: 2, workflow_id: 'wf-production-parallel', route: 'direct', risk: 'moderate',
      baseline_fingerprint: bytesDigest('caller-baseline'),
      routing: { recommended_route: 'direct', confidence: 0.95, fallback_route: 'plan', signals: {} },
      execution_mode: 'attended', acceptance_criteria: ['parallel evidence is signed'],
      budget: { max_cost_units: 10, max_duration_ms: 10_000, max_attempts: 5 },
      nodes: [{
        id: 'implement', kind: 'parallel', depends_on: [], retry_limit: 0,
        budget: { max_cost_units: 5, max_duration_ms: 5_000 },
        output_schema: 'aggregation-result-v2', expected_artifacts: ['integrated.json'],
        verification: ['integration'], dependency_evidence: 'complete',
        branches: [
          {
            id: 'left', role: 'blade', baseline_fingerprint: bytesDigest('caller-baseline'),
            dependency_inputs: [], allowed_paths: ['left'], expected_artifacts: ['left.json'],
            verification: ['left-test'], budget: { max_cost_units: 2, max_duration_ms: 2_000 }, retry_limit: 0,
          },
          {
            id: 'right', role: 'blade', baseline_fingerprint: bytesDigest('caller-baseline'),
            dependency_inputs: [], allowed_paths: ['right'], expected_artifacts: ['right.json'],
            verification: ['right-test'], budget: { max_cost_units: 2, max_duration_ms: 2_000 }, retry_limit: 0,
          },
        ],
      }],
    };
    fs.writeFileSync(planFile, JSON.stringify(plan));
    const paths = workflowPaths(session.sessionDir);
    assert.throws(() => compileWorkflowFile({ workspace: context.workspace, task, input: planFile }), /signed isolated executor probe/);
    assert.equal(fs.existsSync(paths.planFile), false);
    const callerBound = { ...plan, executor_binding: {} };
    fs.writeFileSync(planFile, JSON.stringify(callerBound));
    assert.throws(() => compileWorkflowFile({ workspace: context.workspace, task, input: planFile }), /not trusted/);
    assert.equal(fs.existsSync(paths.planFile), false);
    fs.writeFileSync(planFile, JSON.stringify(plan));

    const issued = new Date();
    const probe = probeRecord({
      trust, privateKey: keys.privateKey, repoId: repoIdentity(context.workspace).id,
      taskId: session.task, fingerprint, issuedAt: issued.toISOString(),
      expiresAt: new Date(issued.getTime() + 10 * 60_000).toISOString(),
    });
    fs.writeFileSync(attestation.executorProbeFile(session.sessionDir), JSON.stringify(probe));
    const compiled = compileWorkflowFile({ workspace: context.workspace, task, input: planFile });
    assert.equal(compiled.plan.executor_binding.key_id, trust.key_id);
    assert.equal(compiled.plan.executor_binding.source, trust.source);
    assert.equal(compiled.plan.executor_binding.probe_digest, attestation.executorProbeDigest(probe));
    assert.equal(compiled.plan.executor_binding.baseline_fingerprint, fingerprint);
    const { buildWorkspaceManifest, diffWorkspaceManifests } =
      await import('../skills/phantom/scripts/lib/workspace-manifest.mjs');
    const hostManifest = buildWorkspaceManifest(context.workspace);
    assert.equal(
      compiled.plan.executor_binding.baseline_content_manifest_digest,
      hostManifest.evidence.manifest_digest,
    );
    assert.equal(hostManifest.evidence.snapshot_digest, fingerprint);
    const oldBinding = structuredClone(compiled.plan.executor_binding);
    delete oldBinding.baseline_content_manifest_digest;
    assert.throws(
      () => attestation.validateExecutorBinding(oldBinding),
      /missing required pinned trust fields/,
      'pre-content-manifest executor bindings must fail closed',
    );
    assert.deepEqual(Object.keys(hostManifest.physical_shards[0]).sort(), [
      'bucket', 'digest', 'entries', 'entry_count', 'kind', 'schema_version', 'topology_digest',
    ]);
    assert.deepEqual(Object.keys(hostManifest.evidence.physical_shards[0]).sort(), [
      'bucket', 'digest', 'entry_count', 'topology_digest',
    ]);
    assert.equal(
      hostManifest.physical_shards[0].topology_digest,
      hostManifest.evidence.physical_shards[0].topology_digest,
    );
    assert.equal(
      compiled.plan.executor_binding.baseline_physical_topology_root,
      hostManifest.evidence.physical_topology_root,
    );
    assert.equal(compiled.plan.baseline_fingerprint, fingerprint);
    assert.equal(fs.existsSync(paths.planFile), true);
    assert.throws(() => compileWorkflowFile({
      workspace: context.workspace, task, input: planFile, offlineTest: true,
    }), /offlineTest is not available/);

    const isolated = path.join(context.root, 'isolated-copy');
    fs.mkdirSync(isolated);
    fs.copyFileSync(path.join(context.workspace, 'README.md'), path.join(isolated, 'README.md'));
    const startReceipt = (manifest, suffix) => {
      const unsigned = {
        schema_version: 1,
        receipt_kind: 'branch-started',
        executor_id: compiled.plan.executor_binding.executor_id,
        contract_version: compiled.plan.executor_binding.contract_version,
        profile_digest: compiled.plan.executor_binding.profile_digest,
        source: compiled.plan.executor_binding.source,
        repo_id: compiled.plan.session_binding.repo_id,
        task_id: compiled.plan.session_binding.task_id,
        workflow_id: compiled.plan.workflow_id,
        plan_digest: compiled.plan_digest,
        node_id: 'implement',
        branch_id: 'left',
        attempt: 1,
        run_id: `run-${suffix}`,
        lease_id: `lease-${suffix}`,
        start_receipt_digest: null,
        baseline_fingerprint: compiled.plan.baseline_fingerprint,
        worktree_fingerprint: compiled.plan.baseline_fingerprint,
        input_refs: [],
        workspace_identity: bytesDigest(`workspace-${suffix}`),
        status: 'started',
        changed_paths: [],
        changed_physical_paths: [],
        artifact_refs: [],
        artifact_digests: [],
        verification: [],
        cost_units: 0,
        duration_ms: 0,
        failure_class: null,
        baseline_manifest: manifest.evidence,
        current_manifest: manifest.evidence,
        workspace_delta: diffWorkspaceManifests(manifest, manifest),
        changed_content_shards: [],
        changed_physical_shards: [],
        branch_receipts: [],
        teardown: {
          tool_lease_revoked: false,
          process_tree_reaped: false,
          descendants_remaining: 0,
          mounts_removed: false,
          sandbox_destroyed: false,
        },
        issued_at: issued.toISOString(),
        expires_at: new Date(issued.getTime() + 10 * 60_000).toISOString(),
        source_event_id: `source-${suffix}`,
        replay_id: `replay-${suffix}`,
        key_id: compiled.plan.executor_binding.key_id,
        signature: '',
      };
      return {
        ...unsigned,
        signature: sign(
          null,
          attestation.executionReceiptSigningPayload(unsigned),
          keys.privateKey,
        ).toString('base64'),
      };
    };
    const matchingManifest = buildWorkspaceManifest(isolated);
    assert.equal(matchingManifest.evidence.fingerprint, hostManifest.evidence.fingerprint);
    assert.equal(
      matchingManifest.evidence.physical_topology_root,
      hostManifest.evidence.physical_topology_root,
    );
    assert.notEqual(matchingManifest.evidence.physical_root, hostManifest.evidence.physical_root);
    assert.doesNotThrow(() => attestation.verifyExecutionReceipt({
      receipt: startReceipt(matchingManifest, 'matching'),
      binding: compiled.plan.executor_binding,
      atTime: issued,
    }));

    const oldManifestReceipt = startReceipt(matchingManifest, 'missing-snapshot-digest');
    oldManifestReceipt.baseline_manifest = structuredClone(oldManifestReceipt.baseline_manifest);
    oldManifestReceipt.current_manifest = structuredClone(oldManifestReceipt.current_manifest);
    delete oldManifestReceipt.baseline_manifest.snapshot_digest;
    delete oldManifestReceipt.current_manifest.snapshot_digest;
    oldManifestReceipt.signature = sign(
      null,
      attestation.executionReceiptSigningPayload(oldManifestReceipt),
      keys.privateKey,
    ).toString('base64');
    assert.throws(() => attestation.verifyExecutionReceipt({
      receipt: oldManifestReceipt,
      binding: compiled.plan.executor_binding,
      atTime: issued,
    }), /canonical compact workspace manifest evidence/);

    const substitutedDirectory = path.join(context.root, 'substituted-baseline');
    fs.mkdirSync(substitutedDirectory);
    fs.writeFileSync(path.join(substitutedDirectory, 'README.md'), 'changed\n');
    const substitutedManifest = buildWorkspaceManifest(substitutedDirectory);
    assert.notEqual(
      substitutedManifest.evidence.snapshot_digest,
      hostManifest.evidence.snapshot_digest,
    );
    assert.notEqual(
      substitutedManifest.evidence.manifest_digest,
      hostManifest.evidence.manifest_digest,
    );
    assert.equal(
      substitutedManifest.evidence.physical_topology_root,
      hostManifest.evidence.physical_topology_root,
    );
    assert.throws(() => attestation.verifyExecutionReceipt({
      receipt: startReceipt(substitutedManifest, 'substituted-content'),
      binding: compiled.plan.executor_binding,
      atTime: issued,
    }), /workspace baseline does not match the compiled host manifest binding/);

    const mismatchedCurrent = startReceipt(matchingManifest, 'mismatched-current-snapshot');
    Object.assign(mismatchedCurrent, {
      receipt_kind: 'branch-completed',
      start_receipt_digest: bytesDigest('mismatched-current-start'),
      worktree_fingerprint: substitutedManifest.evidence.snapshot_digest,
      status: 'failed',
      failure_class: 'test_failure',
      teardown: {
        tool_lease_revoked: true,
        process_tree_reaped: true,
        descendants_remaining: 0,
        mounts_removed: true,
        sandbox_destroyed: true,
      },
    });
    mismatchedCurrent.signature = sign(
      null,
      attestation.executionReceiptSigningPayload(mismatchedCurrent),
      keys.privateKey,
    ).toString('base64');
    assert.throws(() => attestation.verifyExecutionReceipt({
      receipt: mismatchedCurrent,
      binding: compiled.plan.executor_binding,
      atTime: issued,
    }), /current manifest snapshot does not match the claimed worktree fingerprint/);

    const missingTopology = startReceipt(matchingManifest, 'missing-topology');
    delete missingTopology.baseline_manifest.physical_shards[0].topology_digest;
    missingTopology.signature = sign(
      null,
      attestation.executionReceiptSigningPayload(missingTopology),
      keys.privateKey,
    ).toString('base64');
    assert.throws(() => attestation.verifyExecutionReceipt({
      receipt: missingTopology,
      binding: compiled.plan.executor_binding,
      atTime: issued,
    }), /baseline_manifest\.physical_shards contains an invalid shard reference/);

    fs.linkSync(path.join(isolated, 'README.md'), path.join(context.root, 'outside-alias.md'));
    const wrongTopology = buildWorkspaceManifest(isolated);
    assert.equal(wrongTopology.evidence.fingerprint, hostManifest.evidence.fingerprint);
    assert.notEqual(
      wrongTopology.evidence.physical_topology_root,
      hostManifest.evidence.physical_topology_root,
    );
    assert.throws(() => attestation.verifyExecutionReceipt({
      receipt: startReceipt(wrongTopology, 'wrong-topology'),
      binding: compiled.plan.executor_binding,
      atTime: issued,
    }), /workspace baseline does not match the compiled host manifest binding/);
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});
