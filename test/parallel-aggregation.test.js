// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const {
  createHash,
  generateKeyPairSync,
  sign,
} = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const digest = (value) => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
const bytesDigest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const writeCapabilityArtifact = (sessionDir, kind, value) => {
  const valueDigest = digest(value);
  const artifactRef = `capability/artifacts/${kind}/${valueDigest.slice('sha256:'.length)}.json`;
  const file = path.join(sessionDir, artifactRef);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${canonical(value)}\n`, { mode: 0o600 });
  return { artifactRef, digest: valueDigest };
};
const completeTeardown = () => ({
  tool_lease_revoked: true,
  process_tree_reaped: true,
  descendants_remaining: 0,
  mounts_removed: true,
  sandbox_destroyed: true,
});
const activeTeardown = () => ({
  tool_lease_revoked: false,
  process_tree_reaped: false,
  descendants_remaining: 0,
  mounts_removed: false,
  sandbox_destroyed: false,
});

async function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-attested-parallel-'));
  const baselineDir = path.join(root, 'baseline');
  const frontendBaseDir = path.join(root, 'frontend-base');
  const backendBaseDir = path.join(root, 'backend-base');
  const integrationBaseDir = path.join(root, 'integration-base');
  const frontendDir = path.join(root, 'frontend');
  const backendDir = path.join(root, 'backend');
  const integratedDir = path.join(root, 'integrated');
  const wrongDir = path.join(root, 'wrong');
  const physicalMismatchDir = path.join(root, 'physical-mismatch');
  const physicalEscapeDir = path.join(root, 'physical-escape');
  const sessionDir = path.join(root, 'session');
  for (const directory of [baselineDir, sessionDir]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(path.join(baselineDir, 'README.md'), 'shared baseline\n');
  for (const directory of [frontendBaseDir, backendBaseDir, integrationBaseDir]) {
    fs.cpSync(baselineDir, directory, { recursive: true });
  }
  fs.cpSync(frontendBaseDir, frontendDir, { recursive: true });
  fs.cpSync(backendBaseDir, backendDir, { recursive: true });
  fs.cpSync(integrationBaseDir, integratedDir, { recursive: true });
  fs.cpSync(frontendBaseDir, physicalEscapeDir, { recursive: true });
  const manifest = await import('../skills/phantom/scripts/lib/workspace-manifest.mjs');
  const snapshot = await import('../skills/phantom/scripts/lib/filesystem-snapshot.mjs');
  const baselineBundle = manifest.buildWorkspaceManifest(baselineDir);
  const baseBundles = {
    frontendBase: manifest.buildWorkspaceManifest(frontendDir),
    backendBase: manifest.buildWorkspaceManifest(backendDir),
    integrationBase: manifest.buildWorkspaceManifest(integratedDir),
    physicalEscapeBase: manifest.buildWorkspaceManifest(physicalEscapeDir),
  };
  fs.mkdirSync(path.join(frontendDir, 'src', 'ui'), { recursive: true });
  fs.writeFileSync(path.join(frontendDir, 'src', 'ui', 'panel.tsx'), 'export const panel = true;\n');
  fs.mkdirSync(path.join(backendDir, 'src', 'api'), { recursive: true });
  fs.writeFileSync(path.join(backendDir, 'src', 'api', 'handler.ts'), 'export const handler = true;\n');
  fs.cpSync(frontendDir, integratedDir, { recursive: true });
  fs.cpSync(backendDir, integratedDir, { recursive: true });
  fs.cpSync(integratedDir, wrongDir, { recursive: true });
  fs.cpSync(integratedDir, physicalMismatchDir, { recursive: true });
  fs.writeFileSync(path.join(wrongDir, 'src', 'api', 'handler.ts'), 'export const handler = false;\n');
  const externalAlias = path.join(root, 'physical-alias-source.md');
  fs.writeFileSync(externalAlias, 'shared baseline\n');
  fs.unlinkSync(path.join(physicalEscapeDir, 'README.md'));
  fs.linkSync(externalAlias, path.join(physicalEscapeDir, 'README.md'));

  const bundles = {
    baseline: baselineBundle,
    ...baseBundles,
    frontend: manifest.buildWorkspaceManifest(frontendDir),
    backend: manifest.buildWorkspaceManifest(backendDir),
    integrated: manifest.buildWorkspaceManifest(integratedDir),
    wrong: manifest.buildWorkspaceManifest(wrongDir),
    physicalMismatch: manifest.buildWorkspaceManifest(physicalMismatchDir),
    physicalEscape: manifest.buildWorkspaceManifest(physicalEscapeDir),
  };
  const fingerprints = Object.fromEntries(Object.entries({
    baseline: baselineDir, frontendBase: frontendBaseDir, backendBase: backendBaseDir,
    integrationBase: integrationBaseDir, frontend: frontendDir, backend: backendDir,
    integrated: integratedDir, wrong: wrongDir, physicalMismatch: physicalMismatchDir,
    physicalEscape: physicalEscapeDir,
  }).map(([key, directory]) => [key, snapshot.workspaceSnapshot(directory).digest]));
  const transition = (after, before = baselineBundle) => {
    const delta = manifest.diffWorkspaceManifests(before, after);
    const beforeShards = new Map(before.content_shards.map((shard) => [shard.bucket, shard]));
    const afterShards = new Map(after.content_shards.map((shard) => [shard.bucket, shard]));
    const beforePhysical = new Map(before.physical_shards.map((shard) => [shard.bucket, shard]));
    const afterPhysical = new Map(after.physical_shards.map((shard) => [shard.bucket, shard]));
    return {
      baseline_manifest: structuredClone(before.evidence),
      current_manifest: structuredClone(after.evidence),
      workspace_delta: delta,
      changed_content_shards: delta.changed_content_shards.map(({ bucket }) => ({
        bucket,
        before: structuredClone(beforeShards.get(bucket) ?? null),
        after: structuredClone(afterShards.get(bucket) ?? null),
      })),
      changed_physical_shards: delta.changed_physical_shards.map(({ bucket }) => ({
        bucket,
        before: structuredClone(beforePhysical.get(bucket) ?? null),
        after: structuredClone(afterPhysical.get(bucket) ?? null),
      })),
      changed_paths: [...delta.changed_paths],
      changed_physical_paths: [...delta.changed_physical_paths],
    };
  };

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const profile = {
    profile_id: 'continuous-isolation-v1', platform: 'darwin', backend: 'fixture-executor',
    backend_digest: bytesDigest('fixture-executor'), filesystem: 'private-root-no-host-writes',
    process: 'contained-and-reaped', tool_plane: 'lease-scoped', artifact_egress: 'digest-bound',
    network: 'denied',
  };
  const trust = {
    schema_version: 1, trust_kind: 'isolated-executor-trust', generation: 1,
    key_id: 'fixture-key', source: 'fixture-executor', public_key: publicKeyPem,
    activated_at: '2026-07-31T11:00:00.000Z', expires_at: '2026-07-31T14:00:00.000Z',
    replaces_key_id: null,
  };
  const binding = {
    baseline_content_manifest_digest: baselineBundle.evidence.manifest_digest,
    baseline_fingerprint: fingerprints.baseline,
    baseline_physical_topology_root: baselineBundle.evidence.physical_topology_root,
    contract_version: 'isolated-branch-executor-v1', executor_id: 'fixture-executor',
    isolation_profile: profile, key_id: trust.key_id, probe_digest: bytesDigest('probe'),
    profile_digest: digest(profile), public_key: publicKeyPem,
    public_key_digest: bytesDigest(publicKey.export({ type: 'spki', format: 'der' })),
    source: trust.source, trust_activated_at: trust.activated_at, trust_digest: digest(trust),
    trust_expires_at: trust.expires_at, trust_generation: trust.generation,
    trust_replaces_key_id: null,
  };
  const node = {
    id: 'implement', kind: 'parallel', depends_on: [], retry_limit: 1,
    budget: { max_cost_units: 10, max_duration_ms: 10_000 },
    output_schema: 'aggregation-result-v2', expected_artifacts: ['integrated.json'],
    verification: ['integration'], dependency_evidence: 'complete',
    branches: [
      {
        id: 'backend', role: 'blade', baseline_fingerprint: fingerprints.baseline,
        dependency_inputs: [], allowed_paths: ['src/api'], expected_artifacts: ['backend.json'],
        verification: ['api-test'], budget: { max_cost_units: 2, max_duration_ms: 2_000 }, retry_limit: 1,
      },
      {
        id: 'frontend', role: 'blade', baseline_fingerprint: fingerprints.baseline,
        dependency_inputs: [], allowed_paths: ['src/ui'], expected_artifacts: ['frontend.json'],
        verification: ['ui-test'], budget: { max_cost_units: 2, max_duration_ms: 2_000 }, retry_limit: 1,
      },
    ],
  };
  const plan = {
    schema_version: 2, workflow_id: 'wf-parallel-1', route: 'direct', risk: 'moderate',
    baseline_fingerprint: fingerprints.baseline, executor_binding: binding,
    session_binding: { repo_id: 'fixture', task_id: 'parallel-test', route: 'direct', approved_plan: null },
    routing: { recommended_route: 'direct', confidence: 0.95, fallback_route: 'plan', signals: {} },
    execution_mode: 'attended', acceptance_criteria: ['parallel changes integrate cleanly'],
    budget: { max_cost_units: 20, max_duration_ms: 20_000, max_attempts: 10 }, nodes: [node],
  };
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const compiled = compileWorkflow(plan);
  const attestation = await import('../skills/phantom/scripts/lib/isolated-executor-attestation.mjs');
  const signReceipt = (receipt) => ({
    ...receipt,
    signature: sign(null, attestation.executionReceiptSigningPayload(receipt), privateKey).toString('base64'),
  });
  let nonce = 0;
  const baseReceipt = ({ kind, branchId, attempt, run, lease, startDigest, status, fp, evidence }) => {
    nonce += 1;
    return {
      schema_version: 1, receipt_kind: kind, executor_id: binding.executor_id,
      contract_version: binding.contract_version, profile_digest: binding.profile_digest,
      source: binding.source, repo_id: plan.session_binding.repo_id, task_id: plan.session_binding.task_id,
      workflow_id: plan.workflow_id, plan_digest: compiled.plan_digest, node_id: node.id,
      branch_id: branchId, attempt, run_id: run, lease_id: lease,
      start_receipt_digest: startDigest, baseline_fingerprint: fingerprints.baseline,
      worktree_fingerprint: fp, input_refs: [], workspace_identity: bytesDigest(`workspace-${run}`),
      status, changed_paths: evidence.changed_paths,
      changed_physical_paths: evidence.changed_physical_paths,
      artifact_refs: [], artifact_digests: [],
      verification: [], cost_units: 0, duration_ms: 0, failure_class: null,
      ...evidence, branch_receipts: [], teardown: kind === 'branch-started' ? activeTeardown() : completeTeardown(),
      issued_at: '2026-07-31T12:00:00.000Z', expires_at: '2026-07-31T12:10:00.000Z',
      source_event_id: `executor-event-${nonce}`, replay_id: `executor-replay-${nonce}`,
      key_id: binding.key_id, signature: '',
    };
  };
  return {
    root, workspace: baselineDir, sessionDir, node, compiled, binding, fingerprints, bundles, transition,
    baseReceipt, signReceipt, attestation,
  };
}

function writeOutput(sessionDir, file, nodeId, evidenceName) {
  const value = {
    schema_version: 1, node_id: nodeId, status: 'completed',
    evidence: [{ name: evidenceName, result: 'passed' }], output: {},
  };
  const bytes = Buffer.from(JSON.stringify(value));
  fs.writeFileSync(path.join(sessionDir, file), bytes);
  return { value, digest: bytesDigest(bytes) };
}

async function initializeRunningParallel(fixture, suffix) {
  const { appendWorkflowEvent, writeCompiledWorkflow } =
    await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  writeCompiledWorkflow(fixture.sessionDir, fixture.compiled);
  const append = (input) => appendWorkflowEvent({
    sessionDir: fixture.sessionDir,
    compiled: fixture.compiled,
    input,
  });
  append({
    event_id: `stale-workflow-${suffix}`,
    event_type: 'workflow.started',
    node_id: null,
    recorded_at: '2026-07-31T12:01:00.000Z',
    artifact_refs: [],
    worktree_fingerprint: fixture.fingerprints.baseline,
    producer: { role: 'apex' },
    payload: {},
  });
  append({
    event_id: `stale-node-${suffix}`,
    event_type: 'node.started',
    node_id: fixture.node.id,
    recorded_at: '2026-07-31T12:01:01.000Z',
    artifact_refs: [],
    worktree_fingerprint: fixture.fingerprints.baseline,
    producer: { role: 'apex' },
    payload: { input_refs: [] },
  });
  return append;
}

async function appendWorkspaceMutation(fixture, append, fingerprint, suffix) {
  const { digestValue } = await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
  const reservedBudget = { cost_units: 0.25, duration_ms: 10 };
  const request = {
    schema_version: 1,
    type: 'workspace.write',
    request_id: `request-${suffix}`,
    workflow_id: fixture.compiled.plan.workflow_id,
    node_id: fixture.node.id,
    worktreeFingerprint: fixture.fingerprints.baseline,
    paths: [],
    patchDigest: bytesDigest(`patch-${suffix}`),
    budget: { maxCostUnits: reservedBudget.cost_units, maxDurationMs: reservedBudget.duration_ms },
  };
  const requestArtifact = writeCapabilityArtifact(fixture.sessionDir, 'requests', request);
  const decisionUnsigned = {
    schema_version: 1,
    request_id: request.request_id,
    idempotency_key: `workspace-write-${suffix}`,
    capability_type: 'workspace.write',
    request_digest: requestArtifact.digest,
    decision: 'authorized',
    reason: 'Fixture-authorized workspace mutation',
    reserved_budget: reservedBudget,
  };
  const decision = { ...decisionUnsigned, decision_digest: digestValue(decisionUnsigned) };
  const events = fs.readFileSync(
    path.join(fixture.sessionDir, 'workflow', 'events.jsonl'),
    'utf8',
  ).trim().split('\n').map(JSON.parse);
  const executionNonce = Buffer.alloc(32, suffix.length).toString('base64url');
  const reservation = {
    schema_version: 2,
    reservation_kind: 'native-tool-execution',
    decision_digest: decision.decision_digest,
    request_digest: requestArtifact.digest,
    request_id: request.request_id,
    workflow_id: request.workflow_id,
    node_id: request.node_id,
    capability_type: request.type,
    idempotency_key: decision.idempotency_key,
    execution_nonce: executionNonce,
    authorized_journal_tail_digest: events.at(-1).event_digest,
    workspace_evidence_digest_before: null,
    created_at: '2026-07-31T12:03:59.000Z',
    request,
    reserved_budget: reservedBudget,
    hard_enforcement: { adapter_binding: 'native-tool-gate-v1' },
    host_adapter: null,
  };
  const reservationArtifact = writeCapabilityArtifact(
    fixture.sessionDir,
    'reservations',
    reservation,
  );
  const artifactRefs = [requestArtifact.artifactRef, reservationArtifact.artifactRef];
  append({
    event_id: `decision-${suffix}`,
    event_type: 'capability.decision',
    node_id: fixture.node.id,
    recorded_at: '2026-07-31T12:04:00.000Z',
    artifact_refs: artifactRefs,
    worktree_fingerprint: fixture.fingerprints.baseline,
    producer: { role: 'capability-broker' },
    payload: decision,
  });
  const outcomeUnsigned = {
    schema_version: 2,
    outcome_kind: 'native-tool-execution',
    request_id: decision.request_id,
    idempotency_key: decision.idempotency_key,
    capability_type: decision.capability_type,
    request_digest: decision.request_digest,
    decision_digest: decision.decision_digest,
    reservation_digest: reservationArtifact.digest,
    execution_nonce: executionNonce,
    status: 'succeeded',
    external_reference: null,
    error: null,
    recorded_at: '2026-07-31T12:04:01.000Z',
    budget_charge: reservedBudget,
  };
  return append({
    event_id: `outcome-${suffix}`,
    event_type: 'capability.outcome',
    node_id: fixture.node.id,
    recorded_at: outcomeUnsigned.recorded_at,
    artifact_refs: artifactRefs,
    worktree_fingerprint: fingerprint,
    producer: { role: 'capability-broker' },
    payload: { ...outcomeUnsigned, outcome_digest: digestValue(outcomeUnsigned) },
  });
}

async function completePassingBranches(fixture) {
  const { appendAttestedParallelReceipt } =
    await import('../skills/phantom/scripts/execute-parallel.mjs');
  const started = {};
  const branches = {
    backend: {
      bundle: fixture.bundles.backend,
      baseline: fixture.bundles.backendBase,
      fingerprint: fixture.fingerprints.backend,
      verification: 'api-test',
    },
    frontend: {
      bundle: fixture.bundles.frontend,
      baseline: fixture.bundles.frontendBase,
      fingerprint: fixture.fingerprints.frontend,
      verification: 'ui-test',
    },
  };
  for (const [index, [branchId, branch]] of Object.entries(branches).entries()) {
    const start = fixture.signReceipt(fixture.baseReceipt({
      kind: 'branch-started',
      branchId,
      attempt: 1,
      run: `stale-${branchId}-run`,
      lease: `stale-${branchId}-lease`,
      startDigest: null,
      status: 'started',
      fp: fixture.fingerprints.baseline,
      evidence: fixture.transition(branch.baseline, branch.baseline),
    }));
    started[branchId] = start;
    appendAttestedParallelReceipt({
      sessionDir: fixture.sessionDir,
      compiled: fixture.compiled,
      liveWorktreeFingerprint: fixture.fingerprints.baseline,
      livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
      receipt: start,
      recordedAt: `2026-07-31T12:02:0${index}.000Z`,
    });
  }
  for (const [index, [branchId, branch]] of Object.entries(branches).entries()) {
    const artifact = writeOutput(
      fixture.sessionDir,
      `${branchId}.json`,
      branchId,
      branch.verification,
    );
    const completion = fixture.baseReceipt({
      kind: 'branch-completed',
      branchId,
      attempt: 1,
      run: `stale-${branchId}-run`,
      lease: `stale-${branchId}-lease`,
      startDigest: fixture.attestation.executionReceiptDigest(started[branchId]),
      status: 'passed',
      fp: branch.fingerprint,
      evidence: fixture.transition(branch.bundle, branch.baseline),
    });
    Object.assign(completion, {
      artifact_refs: [`${branchId}.json`],
      artifact_digests: [{ artifact_ref: `${branchId}.json`, digest: artifact.digest }],
      verification: [{ name: branch.verification, result: 'passed' }],
      cost_units: 1,
      duration_ms: 100,
    });
    appendAttestedParallelReceipt({
      sessionDir: fixture.sessionDir,
      compiled: fixture.compiled,
      liveWorktreeFingerprint: fixture.fingerprints.baseline,
      livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
      receipt: fixture.signReceipt(completion),
      recordedAt: `2026-07-31T12:03:0${index}.000Z`,
    });
  }
}

test('main-worktree mutation before branch start blocks the compiled parallel baseline', async () => {
  const fixture = await createFixture();
  try {
    const append = await initializeRunningParallel(fixture, 'before-branch');
    const mutation = await appendWorkspaceMutation(
      fixture,
      append,
      fixture.fingerprints.wrong,
      'before-branch',
    );
    const { legalTransitions } =
      await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
    assert.ok(!legalTransitions(fixture.compiled, mutation.state).some((transition) =>
      transition.event_type === 'parallel.branch.started'));

    const receipt = fixture.signReceipt(fixture.baseReceipt({
      kind: 'branch-started',
      branchId: 'backend',
      attempt: 1,
      run: 'stale-before-branch-run',
      lease: 'stale-before-branch-lease',
      startDigest: null,
      status: 'started',
      fp: fixture.fingerprints.baseline,
      evidence: fixture.transition(fixture.bundles.backendBase, fixture.bundles.backendBase),
    }));
    const { appendAttestedParallelReceipt } =
      await import('../skills/phantom/scripts/execute-parallel.mjs');
    assert.throws(() => appendAttestedParallelReceipt({
      sessionDir: fixture.sessionDir,
      compiled: fixture.compiled,
      liveWorktreeFingerprint: fixture.fingerprints.baseline,
      livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
      receipt,
      recordedAt: '2026-07-31T12:05:00.000Z',
    }), /cannot start after the integrated worktree diverges from the compiled baseline/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('unjournaled live host drift blocks valid signed receipts at branch start and fan-in', async () => {
  const fixture = await createFixture();
  try {
    await initializeRunningParallel(fixture, 'unjournaled-live-drift');
    const start = fixture.signReceipt(fixture.baseReceipt({
      kind: 'branch-started',
      branchId: 'backend',
      attempt: 1,
      run: 'live-drift-start-run',
      lease: 'live-drift-start-lease',
      startDigest: null,
      status: 'started',
      fp: fixture.fingerprints.baseline,
      evidence: fixture.transition(fixture.bundles.backendBase, fixture.bundles.backendBase),
    }));
    const integration = fixture.baseReceipt({
      kind: 'integration-completed',
      branchId: null,
      attempt: null,
      run: 'live-drift-integration-run',
      lease: 'live-drift-integration-lease',
      startDigest: null,
      status: 'accepted',
      fp: fixture.fingerprints.integrated,
      evidence: fixture.transition(fixture.bundles.integrated, fixture.bundles.integrationBase),
    });
    integration.branch_receipts = fixture.node.branches.map((branch) => ({
      branch_id: branch.id,
      completion_receipt_digest: bytesDigest(`live-drift-${branch.id}`),
    }));
    integration.verification = [{
      name: 'integration', result: 'passed', snapshot_digest: fixture.fingerprints.integrated,
    }];
    const fanIn = fixture.signReceipt(integration);
    for (const receipt of [start, fanIn]) {
      assert.doesNotThrow(() => fixture.attestation.verifyExecutionReceipt({
        receipt,
        binding: fixture.binding,
        atTime: '2026-07-31T12:05:00.000Z',
      }));
    }

    const { appendAttestedParallelReceipt } =
      await import('../skills/phantom/scripts/execute-parallel.mjs');
    const { workspaceSnapshot } =
      await import('../skills/phantom/scripts/lib/filesystem-snapshot.mjs');
    const { buildWorkspaceManifest } =
      await import('../skills/phantom/scripts/lib/workspace-manifest.mjs');
    fs.writeFileSync(path.join(fixture.workspace, 'README.md'), 'unjournaled host mutation\n');
    const contentDrift = workspaceSnapshot(fixture.workspace).digest;
    assert.notEqual(contentDrift, fixture.fingerprints.baseline);
    for (const receipt of [start, fanIn]) {
      assert.throws(() => appendAttestedParallelReceipt({
        sessionDir: fixture.sessionDir,
        compiled: fixture.compiled,
        receipt,
        liveWorktreeFingerprint: contentDrift,
        livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
        recordedAt: '2026-07-31T12:05:00.000Z',
      }), /live host worktree.*compiled parallel baseline/i);
    }

    fs.writeFileSync(path.join(fixture.workspace, 'README.md'), 'shared baseline\n');
    const outsideAlias = path.join(fixture.root, 'live-topology-alias.md');
    fs.linkSync(path.join(fixture.workspace, 'README.md'), outsideAlias);
    const topologyDrift = buildWorkspaceManifest(fixture.workspace).evidence.physical_topology_root;
    assert.equal(workspaceSnapshot(fixture.workspace).digest, fixture.fingerprints.baseline);
    assert.notEqual(topologyDrift, fixture.binding.baseline_physical_topology_root);
    for (const receipt of [start, fanIn]) {
      assert.throws(() => appendAttestedParallelReceipt({
        sessionDir: fixture.sessionDir,
        compiled: fixture.compiled,
        receipt,
        liveWorktreeFingerprint: fixture.fingerprints.baseline,
        livePhysicalTopologyRoot: topologyDrift,
        recordedAt: '2026-07-31T12:05:00.000Z',
      }), /live host physical topology.*compiled parallel baseline/i);
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('main-worktree mutation after branch completion blocks deterministic fan-in', async () => {
  const fixture = await createFixture();
  try {
    const append = await initializeRunningParallel(fixture, 'before-fan-in');
    await completePassingBranches(fixture);
    const mutation = await appendWorkspaceMutation(
      fixture,
      append,
      fixture.fingerprints.wrong,
      'before-fan-in',
    );
    const { legalTransitions } =
      await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
    assert.ok(!legalTransitions(fixture.compiled, mutation.state).some((transition) =>
      transition.event_type === 'parallel.aggregated'));

    const receipt = fixture.baseReceipt({
      kind: 'integration-completed',
      branchId: null,
      attempt: null,
      run: 'stale-fan-in-run',
      lease: 'stale-fan-in-lease',
      startDigest: null,
      status: 'accepted',
      fp: fixture.fingerprints.integrated,
      evidence: fixture.transition(fixture.bundles.integrated, fixture.bundles.integrationBase),
    });
    receipt.branch_receipts = fixture.node.branches.map((branch) => ({
      branch_id: branch.id,
      completion_receipt_digest:
        mutation.state.nodes.implement.branches[branch.id].completion_receipt_digest,
    }));
    receipt.verification = [{
      name: 'integration',
      result: 'passed',
      snapshot_digest: fixture.fingerprints.integrated,
    }];
    receipt.artifact_refs = ['integrated.json'];
    receipt.artifact_digests = [{
      artifact_ref: 'integrated.json',
      digest: bytesDigest('stale-integration-artifact'),
    }];
    const signed = fixture.signReceipt(receipt);
    assert.throws(() => append({
      event_id: signed.source_event_id,
      event_type: 'parallel.aggregated',
      node_id: fixture.node.id,
      recorded_at: '2026-07-31T12:05:00.000Z',
      artifact_refs: signed.artifact_refs,
      worktree_fingerprint: signed.worktree_fingerprint,
      producer: { role: 'executor', runtime: 'isolated-branch-executor-v1' },
      payload: { output_schema: 'aggregation-result-v2', executor_receipt: signed },
    }), /requires the current integrated worktree to match the compiled baseline/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a later parallel stage cannot reuse the baseline after an earlier stage advances the tree', async () => {
  const fixture = await createFixture();
  try {
    const {
      compileWorkflow,
      createInitialState,
      legalTransitions,
      reduceWorkflowEvent,
    } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
    const { buildWorkflowEvent } =
      await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
    const upstreamDigest = bytesDigest('first-stage-artifact');
    const inputRefs = [{
      source_node: 'first-stage',
      artifact_ref: 'first-stage.json',
      digest: upstreamDigest,
    }];
    const first = structuredClone(fixture.node);
    first.id = 'first-stage';
    first.expected_artifacts = ['first-stage.json'];
    const second = structuredClone(fixture.node);
    second.id = 'second-stage';
    second.depends_on = ['first-stage'];
    second.expected_artifacts = ['second-stage.json'];
    second.branches.forEach((branch) => { branch.dependency_inputs = structuredClone(inputRefs); });
    const plan = structuredClone(fixture.compiled.plan);
    plan.workflow_id = 'wf-stale-later-parallel-stage';
    plan.nodes = [first, second];
    const compiled = compileWorkflow(plan);
    let state = createInitialState(compiled);
    const workflowStarted = buildWorkflowEvent(null, {
      workflow_id: plan.workflow_id,
      event_id: 'later-stage-workflow-started',
      recorded_at: '2026-07-31T12:01:00.000Z',
      event_type: 'workflow.started',
      worktree_fingerprint: fixture.fingerprints.baseline,
      producer: { role: 'apex' },
      payload: {},
    });
    state = reduceWorkflowEvent(compiled, state, workflowStarted);

    state.current_worktree_fingerprint = fixture.fingerprints.integrated;
    Object.assign(state.nodes['first-stage'], {
      status: 'completed',
      artifact_refs: ['first-stage.json'],
      artifact_digests: [{ artifact_ref: 'first-stage.json', digest: upstreamDigest }],
      worktree_fingerprint: fixture.fingerprints.integrated,
    });
    state.nodes['second-stage'].status = 'ready';
    const secondStarted = buildWorkflowEvent(workflowStarted, {
      workflow_id: plan.workflow_id,
      event_id: 'later-stage-node-started',
      recorded_at: '2026-07-31T12:02:00.000Z',
      event_type: 'node.started',
      node_id: 'second-stage',
      worktree_fingerprint: fixture.fingerprints.integrated,
      producer: { role: 'apex' },
      payload: { input_refs: inputRefs },
    });
    assert.ok(!legalTransitions(compiled, state).some((transition) =>
      transition.event_type === 'node.started'
        && transition.node_id === 'second-stage'));
    assert.throws(
      () => reduceWorkflowEvent(compiled, state, secondStarted),
      /requires the current worktree to match its compiled baseline/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('signed executor receipts preserve siblings, require fresh retries, and aggregate exact shard content', async () => {
  const fixture = await createFixture();
  try {
    const { appendWorkflowEvent, readWorkflowJournal, writeCompiledWorkflow } =
      await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
    const { aggregateParallel } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
    const { validateAggregationResult } =
      await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
    const { appendAttestedParallelReceipt } = await import('../skills/phantom/scripts/execute-parallel.mjs');
    writeCompiledWorkflow(fixture.sessionDir, fixture.compiled);
    appendWorkflowEvent({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled,
      input: {
        event_id: 'workflow-start', event_type: 'workflow.started', node_id: null,
        recorded_at: '2026-07-31T12:01:00.000Z', artifact_refs: [],
        worktree_fingerprint: fixture.fingerprints.baseline, producer: { role: 'apex' }, payload: {},
      },
    });
    appendWorkflowEvent({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled,
      input: {
        event_id: 'node-start', event_type: 'node.started', node_id: 'implement',
        recorded_at: '2026-07-31T12:01:01.000Z', artifact_refs: [],
        worktree_fingerprint: fixture.fingerprints.baseline, producer: { role: 'apex' },
        payload: { input_refs: [] },
      },
    });
    const started = {};
    for (const branchId of ['frontend', 'backend']) {
      const baseline = fixture.bundles[`${branchId}Base`];
      const receipt = fixture.signReceipt(fixture.baseReceipt({
        kind: 'branch-started', branchId, attempt: 1, run: `${branchId}-run-1`,
        lease: `${branchId}-lease-1`, startDigest: null, status: 'started',
        fp: fixture.fingerprints.baseline, evidence: fixture.transition(baseline, baseline),
      }));
      started[branchId] = receipt;
      appendAttestedParallelReceipt({
        sessionDir: fixture.sessionDir, compiled: fixture.compiled, receipt,
        liveWorktreeFingerprint: fixture.fingerprints.baseline,
        livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
        recordedAt: '2026-07-31T12:02:00.000Z',
      });
    }
    const frontendArtifact = writeOutput(fixture.sessionDir, 'frontend.json', 'frontend', 'ui-test');
    const frontendCompletion = fixture.baseReceipt({
      kind: 'branch-completed', branchId: 'frontend', attempt: 1, run: 'frontend-run-1',
      lease: 'frontend-lease-1', startDigest: fixture.attestation.executionReceiptDigest(started.frontend),
      status: 'passed', fp: fixture.fingerprints.frontend,
      evidence: fixture.transition(fixture.bundles.frontend, fixture.bundles.frontendBase),
    });
    Object.assign(frontendCompletion, {
      artifact_refs: ['frontend.json'],
      artifact_digests: [{ artifact_ref: 'frontend.json', digest: frontendArtifact.digest }],
      verification: [{ name: 'ui-test', result: 'passed' }], cost_units: 1, duration_ms: 100,
    });
    appendAttestedParallelReceipt({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled,
      liveWorktreeFingerprint: fixture.fingerprints.baseline,
      livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
      receipt: fixture.signReceipt(frontendCompletion), recordedAt: '2026-07-31T12:03:00.000Z',
    });

    const failedCompletion = fixture.baseReceipt({
      kind: 'branch-completed', branchId: 'backend', attempt: 1, run: 'backend-run-1',
      lease: 'backend-lease-1', startDigest: fixture.attestation.executionReceiptDigest(started.backend),
      status: 'failed', fp: fixture.fingerprints.baseline,
      evidence: fixture.transition(fixture.bundles.backendBase, fixture.bundles.backendBase),
    });
    Object.assign(failedCompletion, {
      verification: [{ name: 'api-test', result: 'failed' }],
      failure_class: 'test_failure', cost_units: 0.5, duration_ms: 50,
    });
    appendAttestedParallelReceipt({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled,
      liveWorktreeFingerprint: fixture.fingerprints.baseline,
      livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
      receipt: fixture.signReceipt(failedCompletion), recordedAt: '2026-07-31T12:04:00.000Z',
    });
    const reusedUnsigned = fixture.baseReceipt({
      kind: 'branch-started', branchId: 'backend', attempt: 2, run: 'backend-run-1',
      lease: 'backend-lease-1', startDigest: null, status: 'started',
      fp: fixture.fingerprints.baseline,
      evidence: fixture.transition(fixture.bundles.backendBase, fixture.bundles.backendBase),
    });
    reusedUnsigned.workspace_identity = bytesDigest('fresh-workspace-with-reused-run');
    const reused = fixture.signReceipt(reusedUnsigned);
    assert.throws(() => appendAttestedParallelReceipt({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled, receipt: reused,
      liveWorktreeFingerprint: fixture.fingerprints.baseline,
      livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
      recordedAt: '2026-07-31T12:05:00.000Z',
    }), /fresh run_id|fresh lease_id/);
    let snapshot = readWorkflowJournal(fixture.sessionDir, fixture.compiled);
    assert.equal(snapshot.state.nodes.implement.branches.frontend.status, 'completed');
    assert.equal(snapshot.state.nodes.implement.branches.backend.status, 'failed');

    const retryStart = fixture.signReceipt(fixture.baseReceipt({
      kind: 'branch-started', branchId: 'backend', attempt: 2, run: 'backend-run-2',
      lease: 'backend-lease-2', startDigest: null, status: 'started',
      fp: fixture.fingerprints.baseline,
      evidence: fixture.transition(fixture.bundles.backendBase, fixture.bundles.backendBase),
    }));
    appendAttestedParallelReceipt({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled, receipt: retryStart,
      liveWorktreeFingerprint: fixture.fingerprints.baseline,
      livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
      recordedAt: '2026-07-31T12:05:00.000Z',
    });
    const backendArtifact = writeOutput(fixture.sessionDir, 'backend.json', 'backend', 'api-test');
    const backendCompletion = fixture.baseReceipt({
      kind: 'branch-completed', branchId: 'backend', attempt: 2, run: 'backend-run-2',
      lease: 'backend-lease-2', startDigest: fixture.attestation.executionReceiptDigest(retryStart),
      status: 'passed', fp: fixture.fingerprints.backend,
      evidence: fixture.transition(fixture.bundles.backend, fixture.bundles.backendBase),
    });
    Object.assign(backendCompletion, {
      artifact_refs: ['backend.json'],
      artifact_digests: [{ artifact_ref: 'backend.json', digest: backendArtifact.digest }],
      verification: [{ name: 'api-test', result: 'passed' }], cost_units: 1, duration_ms: 100,
    });
    appendAttestedParallelReceipt({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled,
      liveWorktreeFingerprint: fixture.fingerprints.baseline,
      livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
      receipt: fixture.signReceipt(backendCompletion), recordedAt: '2026-07-31T12:06:00.000Z',
    });
    snapshot = readWorkflowJournal(fixture.sessionDir, fixture.compiled);
    const results = Object.values(snapshot.state.nodes.implement.branches).map((branch) => branch.result);
    const physicalMismatchEvidence = {
      ...fixture.transition(fixture.bundles.physicalMismatch, fixture.bundles.integrationBase),
      baseline_fingerprint: fixture.fingerprints.baseline,
      worktree_fingerprint: fixture.fingerprints.physicalMismatch,
    };
    const physicalMismatch = aggregateParallel(
      fixture.node, results, fixture.fingerprints.baseline,
      fixture.fingerprints.physicalMismatch,
      [{
        name: 'integration', result: 'passed',
        snapshot_digest: fixture.fingerprints.physicalMismatch,
      }],
      physicalMismatchEvidence,
    );
    assert.equal(physicalMismatch.status, 'rejected');
    assert.match(
      physicalMismatch.conflicts.join('\n'),
      /integrated changed paths do not exactly match the authorized branch union/,
    );
    const wrongEvidence = {
      ...fixture.transition(fixture.bundles.wrong, fixture.bundles.integrationBase),
      baseline_fingerprint: fixture.fingerprints.baseline,
      worktree_fingerprint: fixture.fingerprints.wrong,
    };
    const wrong = aggregateParallel(
      fixture.node, results, fixture.fingerprints.baseline, fixture.fingerprints.wrong,
      [{ name: 'integration', result: 'passed', snapshot_digest: fixture.fingerprints.wrong }],
      wrongEvidence,
    );
    assert.equal(wrong.schema_version, 2);
    assert.equal(wrong.status, 'rejected');
    assert.match(wrong.conflicts.join('\n'), /integrated content differs for src\/api\/handler.ts/);
    assert.match(
      validateAggregationResult({ ...wrong, schema_version: 1 }).join('\n'),
      /unsupported aggregation result contract version 1; expected 2/,
    );

    const integration = fixture.baseReceipt({
      kind: 'integration-completed', branchId: null, attempt: null, run: 'integration-run-1',
      lease: 'integration-lease-1', startDigest: null, status: 'accepted',
      fp: fixture.fingerprints.integrated,
      evidence: fixture.transition(fixture.bundles.integrated, fixture.bundles.integrationBase),
    });
    integration.branch_receipts = fixture.node.branches.map((branch) => ({
      branch_id: branch.id,
      completion_receipt_digest: snapshot.state.nodes.implement.branches[branch.id].completion_receipt_digest,
    }));
    integration.verification = [{
      name: 'integration', result: 'passed', snapshot_digest: fixture.fingerprints.integrated,
    }];
    integration.artifact_refs = ['integrated.json'];
    integration.artifact_digests = [{ artifact_ref: 'integrated.json', digest: bytesDigest('placeholder') }];
    integration.cost_units = 1;
    integration.duration_ms = 100;
    const aggregate = aggregateParallel(
      fixture.node, results, fixture.fingerprints.baseline, fixture.fingerprints.integrated,
      integration.verification, integration,
    );
    assert.equal(aggregate.schema_version, 2);
    const aggregateBytes = Buffer.from(JSON.stringify(aggregate));
    fs.writeFileSync(path.join(fixture.sessionDir, 'integrated.json'), aggregateBytes);
    integration.artifact_digests = [{ artifact_ref: 'integrated.json', digest: bytesDigest(aggregateBytes) }];
    const completed = appendAttestedParallelReceipt({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled,
      liveWorktreeFingerprint: fixture.fingerprints.baseline,
      livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
      receipt: fixture.signReceipt(integration), recordedAt: '2026-07-31T12:07:00.000Z',
    });
    assert.equal(completed.state.status, 'accepted');
    assert.equal(completed.state.nodes.implement.branches.backend.attempts, 2);
    assert.equal(completed.state.nodes.implement.branches.frontend.attempts, 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('aggregation preserves hardlink alias equivalence classes across isolated roots', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-parallel-alias-groups-'));
  try {
    const baselineDir = path.join(root, 'baseline');
    const branchOneDir = path.join(root, 'branch-one');
    const branchTwoDir = path.join(root, 'branch-two');
    const integrationDir = path.join(root, 'integration');
    fs.mkdirSync(path.join(baselineDir, 'src', 'ui'), { recursive: true });
    fs.mkdirSync(path.join(baselineDir, 'src', 'api'), { recursive: true });
    fs.writeFileSync(path.join(baselineDir, 'src', 'ui', 'a.txt'), 'same\n');
    fs.writeFileSync(path.join(baselineDir, 'src', 'ui', 'b.txt'), 'same\n');
    fs.writeFileSync(path.join(baselineDir, 'src', 'api', 'c.txt'), 'unchanged\n');
    for (const directory of [branchOneDir, branchTwoDir, integrationDir]) {
      fs.cpSync(baselineDir, directory, { recursive: true });
    }

    const manifest = await import('../skills/phantom/scripts/lib/workspace-manifest.mjs');
    const snapshot = await import('../skills/phantom/scripts/lib/filesystem-snapshot.mjs');
    const branchOneBase = manifest.buildWorkspaceManifest(branchOneDir);
    const branchTwoBase = manifest.buildWorkspaceManifest(branchTwoDir);
    const integrationBase = manifest.buildWorkspaceManifest(integrationDir);

    fs.unlinkSync(path.join(branchOneDir, 'src', 'ui', 'b.txt'));
    fs.linkSync(
      path.join(branchOneDir, 'src', 'ui', 'a.txt'),
      path.join(branchOneDir, 'src', 'ui', 'b.txt'),
    );
    const externalOne = path.join(root, 'external-one.txt');
    const externalTwo = path.join(root, 'external-two.txt');
    fs.writeFileSync(externalOne, 'same\n');
    fs.writeFileSync(externalTwo, 'same\n');
    for (const [target, external] of [
      ['a.txt', externalOne],
      ['b.txt', externalTwo],
    ]) {
      fs.unlinkSync(path.join(integrationDir, 'src', 'ui', target));
      fs.linkSync(external, path.join(integrationDir, 'src', 'ui', target));
    }

    const branchOne = manifest.buildWorkspaceManifest(branchOneDir);
    const branchTwo = manifest.buildWorkspaceManifest(branchTwoDir);
    const integration = manifest.buildWorkspaceManifest(integrationDir);
    const fingerprint = snapshot.workspaceSnapshot(baselineDir).digest;
    assert.equal(snapshot.workspaceSnapshot(branchOneDir).digest, fingerprint);
    assert.equal(snapshot.workspaceSnapshot(integrationDir).digest, fingerprint);

    const transition = (before, after) => {
      const delta = manifest.diffWorkspaceManifests(before, after);
      const proofs = (references, beforeShards, afterShards) => {
        const beforeByBucket = new Map(beforeShards.map((shard) => [shard.bucket, shard]));
        const afterByBucket = new Map(afterShards.map((shard) => [shard.bucket, shard]));
        return references.map(({ bucket }) => ({
          bucket,
          before: structuredClone(beforeByBucket.get(bucket) ?? null),
          after: structuredClone(afterByBucket.get(bucket) ?? null),
        }));
      };
      return {
        baseline_manifest: structuredClone(before.evidence),
        current_manifest: structuredClone(after.evidence),
        workspace_delta: delta,
        changed_content_shards: proofs(
          delta.changed_content_shards,
          before.content_shards,
          after.content_shards,
        ),
        changed_physical_shards: proofs(
          delta.changed_physical_shards,
          before.physical_shards,
          after.physical_shards,
        ),
        changed_paths: [...delta.changed_paths],
        changed_physical_paths: [...delta.changed_physical_paths],
      };
    };
    const complete = completeTeardown();
    const node = {
      id: 'implement', kind: 'parallel', depends_on: [], retry_limit: 0,
      budget: { max_cost_units: 10, max_duration_ms: 10_000 },
      output_schema: 'aggregation-result-v2', expected_artifacts: [],
      verification: ['integration'], dependency_evidence: 'complete',
      branches: [
        {
          id: 'one', role: 'blade', baseline_fingerprint: fingerprint,
          dependency_inputs: [], allowed_paths: ['src/ui'], expected_artifacts: [],
          verification: ['one-test'], budget: { max_cost_units: 2, max_duration_ms: 2_000 },
          retry_limit: 0,
        },
        {
          id: 'two', role: 'blade', baseline_fingerprint: fingerprint,
          dependency_inputs: [], allowed_paths: ['src/api'], expected_artifacts: [],
          verification: ['two-test'], budget: { max_cost_units: 2, max_duration_ms: 2_000 },
          retry_limit: 0,
        },
      ],
    };
    const result = (branchId, evidence, verification, suffix) => ({
      branch_id: branchId,
      status: 'passed',
      run_id: `run-${suffix}`,
      lease_id: `lease-${suffix}`,
      start_receipt_digest: bytesDigest(`start-${suffix}`),
      completion_receipt_digest: bytesDigest(`complete-${suffix}`),
      baseline_fingerprint: fingerprint,
      workspace_identity: bytesDigest(`workspace-${suffix}`),
      ...evidence,
      artifact_refs: [],
      artifact_digests: [],
      verification: [{ name: verification, result: 'passed' }],
      failure_class: null,
      cost_units: 1,
      duration_ms: 1,
      teardown: complete,
    });
    const results = [
      result('one', transition(branchOneBase, branchOne), 'one-test', 'one'),
      result('two', transition(branchTwoBase, branchTwo), 'two-test', 'two'),
    ];
    const integrationEvidence = {
      ...transition(integrationBase, integration),
      baseline_fingerprint: fingerprint,
      worktree_fingerprint: fingerprint,
    };
    const { aggregateParallel } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
    const aggregate = aggregateParallel(
      node,
      results,
      fingerprint,
      fingerprint,
      [{ name: 'integration', result: 'passed', snapshot_digest: fingerprint }],
      integrationEvidence,
    );

    assert.equal(aggregate.status, 'rejected');
    assert.match(
      aggregate.conflicts.join('\n'),
      /physical (?:alias|topology)|unproven hardlink/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reducer rejects forged executor receipts and ordinary advance has no parallel/offline bypass', async () => {
  const fixture = await createFixture();
  try {
    const { appendWorkflowEvent, readWorkflowJournal, writeCompiledWorkflow } =
      await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
    const { canonicalEventInput, advanceWorkflowFile } = await import('../skills/phantom/scripts/advance-workflow.mjs');
    writeCompiledWorkflow(fixture.sessionDir, fixture.compiled);
    appendWorkflowEvent({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled,
      input: {
        event_id: 'workflow-start', event_type: 'workflow.started', node_id: null,
        recorded_at: '2026-07-31T12:01:00.000Z', artifact_refs: [],
        worktree_fingerprint: fixture.fingerprints.baseline, producer: { role: 'apex' }, payload: {},
      },
    });
    appendWorkflowEvent({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled,
      input: {
        event_id: 'node-start', event_type: 'node.started', node_id: 'implement',
        recorded_at: '2026-07-31T12:01:01.000Z', artifact_refs: [],
        worktree_fingerprint: fixture.fingerprints.baseline, producer: { role: 'apex' },
        payload: { input_refs: [] },
      },
    });
    const disconnectedBaseline = fixture.baseReceipt({
      kind: 'branch-completed', branchId: 'backend', attempt: 1, run: 'disconnected-run',
      lease: 'disconnected-lease', startDigest: bytesDigest('disconnected-start'), status: 'failed',
      fp: fixture.fingerprints.frontend,
      evidence: fixture.transition(fixture.bundles.frontend, fixture.bundles.frontend),
    });
    disconnectedBaseline.failure_class = 'test_failure';
    assert.throws(() => fixture.attestation.verifyExecutionReceipt({
      receipt: fixture.signReceipt(disconnectedBaseline),
      binding: fixture.binding,
      atTime: '2026-07-31T12:02:00.000Z',
    }), /workspace baseline does not match the compiled host manifest binding/);
    const valid = fixture.signReceipt(fixture.baseReceipt({
      kind: 'branch-started', branchId: 'backend', attempt: 1, run: 'backend-forged-run',
      lease: 'backend-forged-lease', startDigest: null, status: 'started',
      fp: fixture.fingerprints.baseline,
      evidence: fixture.transition(fixture.bundles.backendBase, fixture.bundles.backendBase),
    }));
    const forged = { ...valid, run_id: 'attacker-run' };
    assert.throws(() => appendWorkflowEvent({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled,
      input: {
        event_id: forged.source_event_id, event_type: 'parallel.branch.started', node_id: 'implement',
        recorded_at: '2026-07-31T12:02:00.000Z', artifact_refs: [],
        worktree_fingerprint: fixture.fingerprints.baseline,
        producer: { role: 'blade', runtime: 'isolated-branch-executor-v1' },
        payload: { executor_receipt: forged },
      },
    }), /signature is invalid/);
    assert.equal(readWorkflowJournal(fixture.sessionDir, fixture.compiled).events.length, 2);
    assert.throws(() => canonicalEventInput({
      input: { event_type: 'parallel.branch.started' }, compiled: fixture.compiled,
      snapshot: readWorkflowJournal(fixture.sessionDir, fixture.compiled),
      sessionDir: fixture.sessionDir, fingerprint: fixture.fingerprints.baseline,
    }), /broker-only/);
    assert.throws(() => advanceWorkflowFile({
      workspace: fixture.root, task: 'parallel-test', input: 'ignored', offlineTest: true,
    }), /offlineTest is not available/);
    const cli = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'advance-workflow.mjs'),
      '--workspace', fixture.root, '--task', 'parallel-test', '--offline-test', 'true',
    ], { encoding: 'utf8' });
    assert.notEqual(cli.status, 0);
    assert.match(cli.stderr, /--offline-test is unsupported/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('physical-only branch mutations require complete proofs and remain inside branch scope', async () => {
  const fixture = await createFixture();
  try {
    const { appendWorkflowEvent, writeCompiledWorkflow } =
      await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
    const { appendAttestedParallelReceipt } = await import('../skills/phantom/scripts/execute-parallel.mjs');
    writeCompiledWorkflow(fixture.sessionDir, fixture.compiled);
    appendWorkflowEvent({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled,
      input: {
        event_id: 'physical-workflow-start', event_type: 'workflow.started', node_id: null,
        recorded_at: '2026-07-31T12:01:00.000Z', artifact_refs: [],
        worktree_fingerprint: fixture.fingerprints.baseline,
        producer: { role: 'apex' }, payload: {},
      },
    });
    appendWorkflowEvent({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled,
      input: {
        event_id: 'physical-node-start', event_type: 'node.started', node_id: 'implement',
        recorded_at: '2026-07-31T12:01:01.000Z', artifact_refs: [],
        worktree_fingerprint: fixture.fingerprints.baseline,
        producer: { role: 'apex' }, payload: { input_refs: [] },
      },
    });
    const started = fixture.signReceipt(fixture.baseReceipt({
      kind: 'branch-started', branchId: 'frontend', attempt: 1,
      run: 'physical-run-1', lease: 'physical-lease-1', startDigest: null,
      status: 'started', fp: fixture.fingerprints.baseline,
      evidence: fixture.transition(
        fixture.bundles.physicalEscapeBase,
        fixture.bundles.physicalEscapeBase,
      ),
    }));
    appendAttestedParallelReceipt({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled, receipt: started,
      liveWorktreeFingerprint: fixture.fingerprints.baseline,
      livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
      recordedAt: '2026-07-31T12:02:00.000Z',
    });
    const artifact = writeOutput(fixture.sessionDir, 'frontend.json', 'frontend', 'ui-test');
    const evidence = fixture.transition(
      fixture.bundles.physicalEscape,
      fixture.bundles.physicalEscapeBase,
    );
    assert.deepEqual(evidence.changed_paths, []);
    assert.deepEqual(evidence.changed_physical_paths, ['README.md']);
    const completion = fixture.baseReceipt({
      kind: 'branch-completed', branchId: 'frontend', attempt: 1,
      run: 'physical-run-1', lease: 'physical-lease-1',
      startDigest: fixture.attestation.executionReceiptDigest(started),
      status: 'passed', fp: fixture.fingerprints.physicalEscape, evidence,
    });
    Object.assign(completion, {
      artifact_refs: ['frontend.json'],
      artifact_digests: [{ artifact_ref: 'frontend.json', digest: artifact.digest }],
      verification: [{ name: 'ui-test', result: 'passed' }],
      cost_units: 1,
      duration_ms: 10,
    });
    const signed = fixture.signReceipt(completion);
    assert.doesNotThrow(() => fixture.attestation.verifyExecutionReceipt({
      receipt: signed,
      binding: fixture.binding,
      atTime: '2026-07-31T12:03:00.000Z',
    }));
    const omitted = fixture.signReceipt({ ...completion, changed_physical_shards: [] });
    assert.throws(() => fixture.attestation.verifyExecutionReceipt({
      receipt: omitted,
      binding: fixture.binding,
      atTime: '2026-07-31T12:03:00.000Z',
    }), /changed_physical_shards is incomplete/);
    assert.throws(() => appendAttestedParallelReceipt({
      sessionDir: fixture.sessionDir, compiled: fixture.compiled, receipt: signed,
      liveWorktreeFingerprint: fixture.fingerprints.baseline,
      livePhysicalTopologyRoot: fixture.binding.baseline_physical_topology_root,
      recordedAt: '2026-07-31T12:03:00.000Z',
    }), /outside its scope/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('filesystem evidence is path-independent, ignores Git fsmonitor metadata, and rejects symlink reads', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-filesystem-evidence-'));
  try {
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');
    fs.mkdirSync(left);
    fs.mkdirSync(right);
    fs.writeFileSync(path.join(left, 'source.txt'), 'same bytes\n');
    fs.writeFileSync(path.join(right, 'source.txt'), 'same bytes\n');
    const sentinel = path.join(root, 'fsmonitor-executed');
    fs.mkdirSync(path.join(left, '.git'));
    fs.writeFileSync(path.join(left, '.git', 'config'), [
      '[core]', `\tfsmonitor = !touch ${sentinel}`, '[remote "origin"]',
      '\turl = git@example.invalid:org/repo.git', '',
    ].join('\n'));
    fs.mkdirSync(path.join(left, '.git', 'refs', 'heads', 'feat'), { recursive: true });
    fs.writeFileSync(path.join(left, '.git', 'HEAD'), 'ref: refs/heads/feat/safe\n');
    fs.writeFileSync(path.join(left, '.git', 'refs', 'heads', 'feat', 'safe'), `${'a'.repeat(40)}\n`);
    const { readRegularFileOnce, workspaceSnapshot } =
      await import('../skills/phantom/scripts/lib/filesystem-snapshot.mjs');
    assert.equal(workspaceSnapshot(left).digest, workspaceSnapshot(right).digest);
    assert.equal(fs.existsSync(sentinel), false);
    const { gitMetadata } = await import('../skills/phantom/scripts/lib/git-metadata.mjs');
    assert.deepEqual(gitMetadata(left), {
      current_branch: 'feat/safe', head_sha: 'a'.repeat(40), origin_head: null, remotes: ['origin'],
    });
    assert.equal(fs.existsSync(sentinel), false);
    fs.unlinkSync(path.join(left, '.git', 'HEAD'));
    fs.symlinkSync(path.join(left, 'source.txt'), path.join(left, '.git', 'HEAD'));
    assert.throws(() => gitMetadata(left), /symbolic|ELOOP|regular/i);
    fs.symlinkSync(path.join(left, 'source.txt'), path.join(left, 'linked.txt'));
    assert.throws(() => readRegularFileOnce(path.join(left, 'linked.txt'), left), /symbolic link|ELOOP|regular file/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('filesystem snapshots expose no artificial file-count ceiling', async () => {
  const snapshot = await import('../skills/phantom/scripts/lib/filesystem-snapshot.mjs');
  assert.equal(Object.hasOwn(snapshot, 'MAX_SNAPSHOT_FILES'), false);
});

test('stable JSON reads never validate and hash a mixed concurrent file generation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-stable-json-'));
  try {
    const file = path.join(root, 'artifact.json');
    const first = `${JSON.stringify({ generation: 'a'.repeat(4096) })}\n`;
    const second = `${JSON.stringify({ generation: 'b'.repeat(4096) })}\n`;
    fs.writeFileSync(file, first);
    const writer = spawn(process.execPath, ['-e', [
      "const fs = require('node:fs');",
      'const [file, first, second] = process.argv.slice(1);',
      'for (let index = 0; index < 500; index += 1) {',
      '  fs.writeFileSync(file, index % 2 ? first : second);',
      '}',
    ].join('\n'), file, first, second]);
    const { readStableJsonFile } = await import('../skills/phantom/scripts/lib/filesystem-snapshot.mjs');
    let validated = 0;
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      try {
        const record = readStableJsonFile(file);
        assert.ok(record.value.generation === 'a'.repeat(4096)
          || record.value.generation === 'b'.repeat(4096));
        const expectedBytes = record.value.generation[0] === 'a' ? first : second;
        assert.equal(record.digest, bytesDigest(expectedBytes));
        validated += 1;
      } catch (error) {
        assert.match(error.message, /changed identity|invalid|regular|ENOENT/i);
      }
    }
    await once(writer, 'exit');
    assert.ok(validated > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
