// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const snapshotDigest = (files) => {
  const hash = createHash('sha256');
  hash.update('phantom-filesystem-snapshot-v1\0');
  files.forEach((entry) => hash.update(`${entry.path}\0${entry.kind}\0${entry.mode}\0${entry.digest}\0`));
  return `sha256:${hash.digest('hex')}`;
};
const BASELINE_FILES = [];
const BASELINE = snapshotDigest(BASELINE_FILES);
const FILE_DIGEST = `sha256:${'f'.repeat(64)}`;

const parallelNode = () => ({
  id: 'implement',
  kind: 'parallel',
  depends_on: [],
  retry_limit: 1,
  budget: { max_cost_units: 10, max_duration_ms: 10_000 },
  output_schema: 'aggregation-result-v1',
  expected_artifacts: ['integrated.json'],
  verification: ['integration'],
  dependency_evidence: 'complete',
  branches: [
    {
      id: 'backend', role: 'blade', baseline_fingerprint: BASELINE, dependency_inputs: [],
      allowed_paths: ['src/api'], expected_artifacts: ['backend.json'], verification: ['api-test'],
      budget: { max_cost_units: 2, max_duration_ms: 2_000 }, retry_limit: 1,
    },
    {
      id: 'frontend', role: 'blade', baseline_fingerprint: BASELINE, dependency_inputs: [],
      allowed_paths: ['src/ui'], expected_artifacts: ['frontend.json'], verification: ['ui-test'],
      budget: { max_cost_units: 2, max_duration_ms: 2_000 }, retry_limit: 1,
    },
  ],
});

const result = (branchId, overrides = {}) => {
  const changedPaths = overrides.changed_paths
    ?? [branchId === 'backend' ? 'src/api/handler.ts' : 'src/ui/panel.tsx'];
  const currentFiles = changedPaths.map((filePath) => ({
    path: filePath, kind: 'file', mode: 0o644, digest: FILE_DIGEST,
  })).sort((left, right) => left.path.localeCompare(right.path));
  return {
    branch_id: branchId,
    status: 'passed',
    baseline_fingerprint: BASELINE,
    workspace_identity: `sha256:${branchId === 'backend' ? 'a' : 'b'}`.padEnd(71, branchId === 'backend' ? 'a' : 'b'),
    baseline_files: BASELINE_FILES,
    baseline_physical_files: [],
    current_files: currentFiles,
    current_physical_files: currentFiles.map((entry, index) => ({
      path: entry.path,
      dev: branchId === 'backend' ? '1' : '2',
      ino: String((branchId === 'backend' ? 100 : 200) + index),
      nlink: 1,
    })),
    changed_paths: changedPaths,
    artifact_refs: [`${branchId}.json`],
    artifact_digests: [{ artifact_ref: `${branchId}.json`, digest: BASELINE }],
    verification: [{ name: branchId === 'backend' ? 'api-test' : 'ui-test', result: 'passed' }],
    failure_class: null,
    cost_units: 1,
    duration_ms: 100,
    ...overrides,
  };
};

const integratedFiles = (results) => results
  .flatMap((branch) => branch.current_files)
  .sort((left, right) => left.path.localeCompare(right.path));
const canonicalResults = () => [result('backend'), result('frontend')];
const INTEGRATED_FILES = integratedFiles(canonicalResults());
const INTEGRATED = snapshotDigest(INTEGRATED_FILES);
const checks = [{ name: 'integration', result: 'passed', snapshot_digest: INTEGRATED }];

const planContract = (node = parallelNode()) => ({
  schema_version: 1,
  workflow_id: 'wf-parallel-1',
  route: 'plan',
  risk: 'moderate',
  baseline_fingerprint: BASELINE,
  session_binding: {
    repo_id: 'fixture',
    task_id: 'parallel-test',
    route: 'plan',
    approved_plan: { artifact_type: 'plan', record_sequence: 1, digest: BASELINE },
  },
  routing: {
    recommended_route: 'plan', confidence: 0.8, fallback_route: 'full', signals: {},
  },
  execution_mode: 'attended',
  acceptance_criteria: ['parallel changes integrate cleanly'],
  budget: { max_cost_units: 20, max_duration_ms: 20_000, max_attempts: 10 },
  nodes: [node],
});

test('deterministic aggregator accepts complete isolated verified branches', async () => {
  const { aggregateParallel } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const aggregate = aggregateParallel(
    parallelNode(),
    [result('frontend'), result('backend')],
    BASELINE,
    INTEGRATED,
    checks,
    INTEGRATED_FILES,
  );
  assert.equal(aggregate.status, 'accepted');
  assert.deepEqual(aggregate.conflicts, []);
  assert.deepEqual(aggregate.branches.map((branch) => branch.branch_id), ['backend', 'frontend']);
  assert.equal(aggregate.worktree_fingerprint, INTEGRATED);
});

test('aggregator fails closed for missing, stale, out-of-scope, and conflicting branches', async () => {
  const { aggregateParallel } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const missing = aggregateParallel(
    parallelNode(), [result('backend')], BASELINE, INTEGRATED, checks, INTEGRATED_FILES,
  );
  assert.equal(missing.status, 'missing_evidence');
  assert.match(missing.conflicts.join('\n'), /missing branch: frontend/);

  const stale = aggregateParallel(parallelNode(), [
    result('backend', { baseline_fingerprint: `sha256:${'0'.repeat(64)}` }),
    result('frontend'),
  ], BASELINE, INTEGRATED, checks, INTEGRATED_FILES);
  assert.equal(stale.status, 'rejected');
  assert.match(stale.conflicts.join('\n'), /stale baseline: backend/);

  const escaped = aggregateParallel(parallelNode(), [
    result('backend', { changed_paths: ['src/ui/stolen.tsx'] }),
    result('frontend', { changed_paths: ['src/ui/stolen.tsx'] }),
  ], BASELINE, INTEGRATED, checks, INTEGRATED_FILES);
  assert.equal(escaped.status, 'rejected');
  assert.match(escaped.conflicts.join('\n'), /path outside scope.*backend/);
  assert.match(escaped.conflicts.join('\n'), /changed-path conflict/);

  const noAggregateCheck = aggregateParallel(
    parallelNode(), [result('backend'), result('frontend')], BASELINE, INTEGRATED, [], INTEGRATED_FILES,
  );
  assert.equal(noAggregateCheck.status, 'rejected');
  assert.match(noAggregateCheck.conflicts.join('\n'), /aggregate verification missing/);

  const wrongNames = aggregateParallel(parallelNode(), [
    result('backend', { verification: [{ name: 'wrong-check', result: 'passed' }] }),
    result('frontend'),
  ], BASELINE, INTEGRATED, checks, INTEGRATED_FILES);
  assert.equal(wrongNames.status, 'rejected');
  assert.match(wrongNames.conflicts.join('\n'), /verification names do not match contract/);

  const forgedPaths = result('backend');
  forgedPaths.changed_paths = [];
  const forged = aggregateParallel(
    parallelNode(), [forgedPaths, result('frontend')], BASELINE, INTEGRATED, checks, INTEGRATED_FILES,
  );
  assert.equal(forged.status, 'rejected');
  assert.match(forged.conflicts.join('\n'), /changed paths do not match filesystem evidence/);

  const contaminatedFiles = [...INTEGRATED_FILES, {
    path: 'unrelated.txt', kind: 'file', mode: 0o644, digest: FILE_DIGEST,
  }].sort((left, right) => left.path.localeCompare(right.path));
  const contaminatedDigest = snapshotDigest(contaminatedFiles);
  const contaminated = aggregateParallel(
    parallelNode(),
    canonicalResults(),
    BASELINE,
    contaminatedDigest,
    [{ name: 'integration', result: 'passed', snapshot_digest: contaminatedDigest }],
    contaminatedFiles,
  );
  assert.equal(contaminated.status, 'rejected');
  assert.match(contaminated.conflicts.join('\n'), /do not exactly match the authorized branch union/);

  const unboundVerification = aggregateParallel(
    parallelNode(), canonicalResults(), BASELINE, INTEGRATED,
    [{ name: 'integration', result: 'passed', snapshot_digest: BASELINE }],
    INTEGRATED_FILES,
  );
  assert.equal(unboundVerification.status, 'rejected');
  assert.match(unboundVerification.conflicts.join('\n'), /not bound to the integrated snapshot/);
});

test('one failed branch retries without discarding its successful sibling', async () => {
  const { compileWorkflow, createInitialState, reduceWorkflowEvent } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { buildWorkflowEvent } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const compiled = compileWorkflow(planContract());
  let state = createInitialState(compiled);
  let previous = null;
  let sequence = 0;
  const apply = (input) => {
    sequence += 1;
    previous = buildWorkflowEvent(previous, {
      workflow_id: compiled.plan.workflow_id,
      event_id: `evt-parallel-${sequence}`,
      recorded_at: `2026-07-31T12:01:${String(sequence).padStart(2, '0')}.000Z`,
      producer: { role: 'apex' },
      worktree_fingerprint: BASELINE,
      ...input,
    });
    state = reduceWorkflowEvent(compiled, state, previous);
  };

  apply({ event_type: 'workflow.started' });
  apply({ event_type: 'node.started', node_id: 'implement', payload: { input_refs: [] } });
  apply({
    event_type: 'parallel.branch.started', node_id: 'implement',
    payload: {
      branch_id: 'frontend', input_refs: [], baseline_fingerprint: BASELINE,
      workspace_identity: result('frontend').workspace_identity,
      workspace_root: '/isolated/frontend', baseline_files: BASELINE_FILES,
      baseline_physical_files: [],
    },
  });
  apply({
    event_type: 'parallel.branch.completed', node_id: 'implement', payload: result('frontend'),
    artifact_refs: ['frontend.json'],
    worktree_fingerprint: snapshotDigest(result('frontend').current_files),
  });
  apply({
    event_type: 'parallel.branch.started', node_id: 'implement',
    payload: {
      branch_id: 'backend', input_refs: [], baseline_fingerprint: BASELINE,
      workspace_identity: result('backend').workspace_identity,
      workspace_root: '/isolated/backend', baseline_files: BASELINE_FILES,
      baseline_physical_files: [],
    },
  });
  apply({
    event_type: 'parallel.branch.completed', node_id: 'implement',
    payload: result('backend', {
      status: 'failed', artifact_refs: [], artifact_digests: [],
      verification: [{ name: 'api-test', result: 'failed' }], failure_class: 'test_failure',
    }),
    artifact_refs: [], worktree_fingerprint: snapshotDigest(result('backend').current_files),
  });
  assert.equal(state.nodes.implement.branches.frontend.status, 'completed');
  assert.equal(state.nodes.implement.branches.backend.status, 'failed');

  apply({
    event_type: 'parallel.branch.retry_requested', node_id: 'implement',
    payload: { branch_id: 'backend', failure_class: 'test_failure' },
  });
  assert.equal(state.nodes.implement.branches.frontend.status, 'completed');
  assert.equal(state.nodes.implement.branches.backend.status, 'ready');
  apply({
    event_type: 'parallel.branch.started', node_id: 'implement',
    payload: {
      branch_id: 'backend', input_refs: [], baseline_fingerprint: BASELINE,
      workspace_identity: result('backend').workspace_identity,
      workspace_root: '/isolated/backend', baseline_files: BASELINE_FILES,
      baseline_physical_files: [],
    },
  });
  apply({
    event_type: 'parallel.branch.completed', node_id: 'implement', payload: result('backend'),
    artifact_refs: ['backend.json'],
    worktree_fingerprint: snapshotDigest(result('backend').current_files),
  });
  apply({
    event_type: 'parallel.aggregated', node_id: 'implement',
    worktree_fingerprint: INTEGRATED,
    artifact_refs: ['integrated.json'],
    payload: {
      output_schema: 'aggregation-result-v1',
      artifact_digests: [{ artifact_ref: 'integrated.json', digest: INTEGRATED }],
      aggregate_verification: checks,
      integrated_snapshot_digest: INTEGRATED,
      integrated_files: INTEGRATED_FILES,
      authorized_changed_paths: ['src/api/handler.ts', 'src/ui/panel.tsx'],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  assert.equal(state.status, 'accepted');
  assert.equal(state.nodes.implement.result.status, 'accepted');
  assert.equal(state.nodes.implement.branches.backend.attempts, 2);
  assert.equal(state.nodes.implement.branches.frontend.attempts, 1);
  assert.equal(state.nodes.implement.branches.backend.consumed_budget.cost_units, 2);
  assert.equal(state.remaining_budget.cost, 16);
});

test('parallel contracts reject stale branch baselines and declared branch overspend', async () => {
  const { aggregateParallel, compileWorkflow } =
    await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const stale = parallelNode();
  stale.branches[0].baseline_fingerprint = INTEGRATED;
  assert.throws(() => compileWorkflow(planContract(stale)), /must match the workflow baseline/);

  const overspent = aggregateParallel(parallelNode(), [
    result('backend', { cost_units: 3 }),
    result('frontend'),
  ], BASELINE, INTEGRATED, checks, INTEGRATED_FILES);
  assert.equal(overspent.status, 'rejected');
  assert.match(overspent.conflicts.join('\n'), /branch budget exceeded: backend/);
});

test('production compilation rejects parallel topology without mutating session workflow state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-parallel-compile-denied-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  const previousData = process.env.PHANTOM_DATA;
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'BASE.md'), 'fixture\n');
  process.env.PHANTOM_DATA = data;
  try {
    const { compileWorkflowFile } = await import('../skills/phantom/scripts/compile-workflow.mjs');
    const { sessionPaths } = await import('../skills/phantom/scripts/lib/portable.mjs');
    const { workflowPaths } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
    const { worktreeFingerprint } = await import('../skills/phantom/scripts/phantom-state.mjs');
    const task = 'parallel-production-denied';
    const fingerprint = worktreeFingerprint(workspace);
    const node = parallelNode();
    node.branches.forEach((branch) => { branch.baseline_fingerprint = fingerprint; });
    const input = path.join(root, 'parallel-plan.json');
    fs.writeFileSync(input, JSON.stringify({
      ...planContract(node), baseline_fingerprint: fingerprint,
    }));
    assert.throws(
      () => compileWorkflowFile({ workspace, task, input }),
      /no trusted isolated executor attestation is bundled.*lower the workflow/s,
    );
    const paths = workflowPaths(sessionPaths(workspace, task).sessionDir);
    assert.equal(fs.existsSync(paths.planFile), false);
    assert.equal(fs.existsSync(paths.journalFile), false);
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('advance derives isolated branch paths and scope from canonical filesystem evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-parallel-evidence-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  const branchWorkspace = path.join(root, 'branch-backend');
  const previousData = process.env.PHANTOM_DATA;
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'BASE.md'), 'fixture\n');
  fs.mkdirSync(branchWorkspace);
  fs.writeFileSync(path.join(branchWorkspace, 'BASE.md'), 'fixture\n');
  process.env.PHANTOM_DATA = data;
  try {
    const { advanceWorkflowFile } = await import('../skills/phantom/scripts/advance-workflow.mjs');
    const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
    const { writeCompiledWorkflow } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
    const { sessionPaths } = await import('../skills/phantom/scripts/lib/portable.mjs');
    const { worktreeFingerprint } = await import('../skills/phantom/scripts/phantom-state.mjs');
    const task = 'parallel-evidence-test';
    const canonicalWorkspace = fs.realpathSync(workspace);
    const fingerprint = worktreeFingerprint(canonicalWorkspace);
    const node = parallelNode();
    node.branches.forEach((branch) => { branch.baseline_fingerprint = fingerprint; });
    const compiled = compileWorkflow({
      ...planContract(node),
      baseline_fingerprint: fingerprint,
      session_binding: {
        repo_id: 'fixture', task_id: task, route: 'plan',
        approved_plan: { artifact_type: 'plan', record_sequence: 1, digest: fingerprint },
      },
    });
    const sessionDir = sessionPaths(workspace, task).sessionDir;
    writeCompiledWorkflow(sessionDir, compiled);
    const untrustedBranchInput = path.join(root, 'untrusted-parallel-branch.json');
    fs.writeFileSync(untrustedBranchInput, JSON.stringify({
      event_type: 'parallel.branch.started',
      node_id: 'implement',
      payload: {
        branch_id: 'backend', input_refs: [],
        branch_workspace: fs.realpathSync(branchWorkspace),
      },
    }));
    assert.throws(
      () => advanceWorkflowFile({ workspace: canonicalWorkspace, task, input: untrustedBranchInput }),
      /no trusted isolated executor attestation is bundled.*sequential chain/s,
    );
    let inputSequence = 0;
    const advance = (value) => {
      inputSequence += 1;
      const file = path.join(root, `parallel-input-${inputSequence}.json`);
      fs.writeFileSync(file, JSON.stringify(value));
      return advanceWorkflowFile({ workspace: canonicalWorkspace, task, input: file, offlineTest: true });
    };
    advance({ event_id: 'parallel-start', event_type: 'workflow.started', payload: {} });
    advance({
      event_id: 'parallel-node-start', event_type: 'node.started', node_id: 'implement', payload: {},
    });
    const hardlinkWorkspace = path.join(root, 'hardlink-branch');
    fs.mkdirSync(hardlinkWorkspace);
    fs.linkSync(path.join(workspace, 'BASE.md'), path.join(hardlinkWorkspace, 'BASE.md'));
    assert.throws(() => advance({
      event_id: 'parallel-hardlink-start',
      event_type: 'parallel.branch.started',
      node_id: 'implement',
      payload: {
        branch_id: 'backend', input_refs: [],
        branch_workspace: fs.realpathSync(hardlinkWorkspace),
      },
    }), /hard-linked regular file|shares a physical regular file/);
    assert.equal(fs.readFileSync(path.join(workspace, 'BASE.md'), 'utf8'), 'fixture\n');
    fs.rmSync(hardlinkWorkspace, { recursive: true, force: true });
    const outsideSentinel = path.join(root, 'outside-sentinel.txt');
    fs.writeFileSync(outsideSentinel, 'unchanged\n');
    const symlinkWorkspace = path.join(root, 'symlink-branch');
    fs.mkdirSync(symlinkWorkspace);
    fs.symlinkSync(outsideSentinel, path.join(symlinkWorkspace, 'BASE.md'));
    assert.throws(() => advance({
      event_id: 'parallel-symlink-start',
      event_type: 'parallel.branch.started',
      node_id: 'implement',
      payload: {
        branch_id: 'backend', input_refs: [],
        branch_workspace: fs.realpathSync(symlinkWorkspace),
      },
    }), /contains a symbolic link/);
    assert.equal(fs.readFileSync(outsideSentinel, 'utf8'), 'unchanged\n');
    fs.rmSync(symlinkWorkspace, { recursive: true, force: true });
    advance({
      event_id: 'parallel-branch-start',
      event_type: 'parallel.branch.started',
      node_id: 'implement',
      payload: {
        branch_id: 'backend',
        input_refs: [],
        branch_workspace: fs.realpathSync(branchWorkspace),
      },
    });
    const artifact = {
      schema_version: 1,
      node_id: 'backend',
      status: 'completed',
      evidence: [{ name: 'api-test', result: 'passed' }],
      output: {},
    };
    const artifactBytes = Buffer.from(JSON.stringify(artifact));
    fs.writeFileSync(path.join(sessionDir, 'backend.json'), artifactBytes);
    const artifactDigest = `sha256:${createHash('sha256').update(artifactBytes).digest('hex')}`;
    const completion = (eventId, changedPaths) => ({
      event_id: eventId,
      event_type: 'parallel.branch.completed',
      node_id: 'implement',
      artifact_refs: ['backend.json'],
      payload: {
        branch_id: 'backend',
        status: 'passed',
        baseline_fingerprint: fingerprint,
        changed_paths: changedPaths,
        artifact_refs: ['backend.json'],
        artifact_digests: [{ artifact_ref: 'backend.json', digest: artifactDigest }],
        verification: [{ name: 'api-test', result: 'passed' }],
        failure_class: null,
        cost_units: 1,
        duration_ms: 100,
      },
    });
    fs.unlinkSync(path.join(branchWorkspace, 'BASE.md'));
    fs.symlinkSync(outsideSentinel, path.join(branchWorkspace, 'BASE.md'));
    assert.throws(
      () => advance(completion('parallel-symlink-completion', [])),
      /contains a symbolic link/,
    );
    assert.equal(fs.readFileSync(outsideSentinel, 'utf8'), 'unchanged\n');
    fs.unlinkSync(path.join(branchWorkspace, 'BASE.md'));
    fs.writeFileSync(path.join(branchWorkspace, 'BASE.md'), 'fixture\n');

    fs.unlinkSync(path.join(branchWorkspace, 'BASE.md'));
    fs.linkSync(path.join(workspace, 'BASE.md'), path.join(branchWorkspace, 'BASE.md'));
    assert.throws(
      () => advance(completion('parallel-hardlink-completion', [])),
      /hard-linked regular file|shares a physical regular file/,
    );
    fs.unlinkSync(path.join(branchWorkspace, 'BASE.md'));
    fs.writeFileSync(path.join(branchWorkspace, 'BASE.md'), 'fixture\n');

    fs.unlinkSync(path.join(branchWorkspace, 'BASE.md'));
    fs.linkSync(path.join(workspace, 'BASE.md'), path.join(branchWorkspace, 'BASE.md'));
    fs.writeFileSync(path.join(branchWorkspace, 'BASE.md'), 'mutated through transient link\n');
    fs.unlinkSync(path.join(branchWorkspace, 'BASE.md'));
    fs.writeFileSync(path.join(branchWorkspace, 'BASE.md'), 'fixture\n');
    assert.throws(
      () => advance(completion('parallel-transient-hardlink-completion', [])),
      /primary workspace drift/,
    );
    fs.writeFileSync(path.join(workspace, 'BASE.md'), 'fixture\n');
    fs.writeFileSync(path.join(workspace, 'primary-noise.txt'), 'must be rejected as primary drift\n');
    fs.writeFileSync(path.join(branchWorkspace, 'outside.txt'), 'out of scope\n');
    assert.throws(
      () => advance(completion('parallel-caller-paths', [])),
      /primary workspace drift/,
    );
    fs.unlinkSync(path.join(workspace, 'primary-noise.txt'));
    assert.throws(
      () => advance(completion('parallel-caller-paths-after-primary-restore', [])),
      /changed_paths does not match canonical runtime evidence/,
    );
    assert.throws(
      () => advance(completion('parallel-outside-scope', ['outside.txt'])),
      /outside its declared scope/,
    );
    fs.unlinkSync(path.join(branchWorkspace, 'outside.txt'));
    fs.mkdirSync(path.join(branchWorkspace, 'src', 'api'), { recursive: true });
    fs.writeFileSync(path.join(branchWorkspace, 'src', 'api', 'handler.ts'), 'export const ok = true;\n');
    const completed = advance(completion('parallel-canonical-evidence', ['src/api/handler.ts']));
    const branch = completed.state.nodes.implement.branches.backend;
    assert.equal(branch.status, 'completed');
    assert.deepEqual(branch.result.changed_paths, ['src/api/handler.ts']);
    assert.match(branch.result.workspace_identity, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(
      branch.result.current_files.filter((entry) => entry.path === 'src/api/handler.ts')
        .map((entry) => entry.digest),
      [`sha256:${createHash('sha256')
        .update(fs.readFileSync(path.join(branchWorkspace, 'src', 'api', 'handler.ts'))).digest('hex')}`],
    );
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(root, { recursive: true, force: true });
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
      '[core]',
      `\tfsmonitor = !touch ${sentinel}`,
      '[remote "origin"]',
      '\turl = git@example.invalid:org/repo.git',
      '',
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
      current_branch: 'feat/safe',
      head_sha: 'a'.repeat(40),
      origin_head: null,
      remotes: ['origin'],
    });
    assert.equal(fs.existsSync(sentinel), false);
    fs.unlinkSync(path.join(left, '.git', 'HEAD'));
    fs.symlinkSync(path.join(left, 'source.txt'), path.join(left, '.git', 'HEAD'));
    assert.throws(() => gitMetadata(left), /symbolic|ELOOP|regular/i);
    fs.symlinkSync(path.join(left, 'source.txt'), path.join(left, 'linked.txt'));
    assert.throws(
      () => readRegularFileOnce(path.join(left, 'linked.txt'), left),
      /symbolic link|ELOOP|regular file/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('filesystem snapshots fail clearly above the documented 20,000-file boundary', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-snapshot-boundary-'));
  try {
    const { MAX_SNAPSHOT_FILES, workspaceSnapshot } =
      await import('../skills/phantom/scripts/lib/filesystem-snapshot.mjs');
    assert.equal(MAX_SNAPSHOT_FILES, 20_000);
    for (let index = 0; index <= MAX_SNAPSHOT_FILES; index += 1) {
      fs.writeFileSync(path.join(root, String(index)), '');
    }
    assert.throws(
      () => workspaceSnapshot(root),
      /exceeds the supported 20000-file boundary; reduce the checkout to 20000 files or fewer/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    const { readStableJsonFile } =
      await import('../skills/phantom/scripts/lib/filesystem-snapshot.mjs');
    let validated = 0;
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      try {
        const record = readStableJsonFile(file);
        assert.ok(record.value.generation === 'a'.repeat(4096)
          || record.value.generation === 'b'.repeat(4096));
        const expectedBytes = record.value.generation[0] === 'a' ? first : second;
        assert.equal(record.digest, `sha256:${createHash('sha256').update(expectedBytes).digest('hex')}`);
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
