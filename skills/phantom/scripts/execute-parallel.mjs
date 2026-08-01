#!/usr/bin/env node
// Author: Subash Karki
// Receipt broker for an external isolated executor. This script does not provide an isolation backend.

import { resolve } from 'node:path';

import {
  isMainModule,
  now,
  parseArgs,
  readJson,
  sessionPaths,
  workspacePath,
} from './lib/portable.mjs';
import { canonicalJson } from './lib/workflow-contracts.mjs';
import { readStableJsonFile } from './lib/filesystem-snapshot.mjs';
import { buildWorkspaceManifest } from './lib/workspace-manifest.mjs';
import {
  appendWorkflowEvent,
  readWorkflowJournal,
  workflowPaths,
} from './lib/workflow-journal.mjs';
import { aggregateParallel } from './lib/workflow-kernel.mjs';
import { verifyExecutionReceipt } from './lib/isolated-executor-attestation.mjs';
import {
  artifactDigests,
  loadArtifactRecords,
  validateArtifactSchemas,
} from './advance-workflow.mjs';
import { workflowCompilationContext } from './phantom-state.mjs';

const branchForReceipt = (compiled, receipt) => compiled.plan.nodes
  .find((node) => node.id === receipt.node_id)?.branches
  ?.find((branch) => branch.id === receipt.branch_id);

const nodeForReceipt = (compiled, receipt) => compiled.plan.nodes
  .find((node) => node.id === receipt.node_id);

function assertLiveParallelBaseline(compiled, liveWorktreeFingerprint, livePhysicalTopologyRoot) {
  if (liveWorktreeFingerprint !== compiled.plan.baseline_fingerprint) {
    throw new Error('Isolated executor receipt ingestion requires the live host worktree to match the compiled parallel baseline.');
  }
  if (livePhysicalTopologyRoot !== compiled.plan.executor_binding?.baseline_physical_topology_root) {
    throw new Error('Isolated executor receipt ingestion requires the live host physical topology to match the compiled parallel baseline.');
  }
}

function assertCompiledBinding(compiled, context, livePhysicalTopologyRoot) {
  if (!compiled.plan.executor_binding) throw new Error('Compiled workflow has no isolated executor trust binding.');
  if (canonicalJson(compiled.plan.session_binding) !== canonicalJson(context.session_binding)
    || compiled.plan.route !== context.current.session.route) {
    throw new Error('Compiled workflow is not bound to the canonical active session and approved plan.');
  }
  assertLiveParallelBaseline(compiled, context.fingerprint, livePhysicalTopologyRoot);
}

function commonExpected(compiled, receipt) {
  return {
    repo_id: compiled.plan.session_binding.repo_id,
    task_id: compiled.plan.session_binding.task_id,
    workflow_id: compiled.plan.workflow_id,
    plan_digest: compiled.plan_digest,
    node_id: receipt.node_id,
  };
}

function assertArtifactBytes(sessionDir, refs, suppliedDigests, outputSchema, expectedNodeId) {
  const records = loadArtifactRecords(sessionDir, refs);
  const actualDigests = artifactDigests(records);
  if (canonicalJson(actualDigests) !== canonicalJson(suppliedDigests)) {
    throw new Error('Signed executor artifact digests do not match immutable session artifact bytes.');
  }
  const values = validateArtifactSchemas(records, outputSchema, expectedNodeId);
  return { records, values };
}

function validateBranchArtifacts(sessionDir, branch, receipt) {
  if (receipt.status === 'passed'
    && canonicalJson([...receipt.artifact_refs].sort()) !== canonicalJson([...branch.expected_artifacts].sort())) {
    throw new Error(`Passing branch ${branch.id} does not bind every declared artifact.`);
  }
  if (receipt.artifact_refs.some((artifact) => !branch.expected_artifacts.includes(artifact))) {
    throw new Error(`Branch ${branch.id} receipt claims an undeclared artifact.`);
  }
  const { values } = assertArtifactBytes(
    sessionDir,
    receipt.artifact_refs,
    receipt.artifact_digests,
    'workflow-output-v1',
    branch.id,
  );
  if (receipt.status === 'passed'
    && values.some((artifact) => artifact.status !== 'completed'
      || artifact.evidence.length === 0
      || artifact.evidence.some((evidence) => evidence.result !== 'passed'))) {
    throw new Error(`Passing branch ${branch.id} requires completed artifacts with passing evidence.`);
  }
}

function eventTypeForReceipt(receiptKind) {
  if (receiptKind === 'branch-started') return 'parallel.branch.started';
  if (receiptKind === 'branch-completed') return 'parallel.branch.completed';
  return 'parallel.aggregated';
}

function executorEvent(receipt, role, recordedAt, payload) {
  return {
    event_id: receipt.source_event_id,
    event_type: eventTypeForReceipt(receipt.receipt_kind),
    node_id: receipt.node_id,
    recorded_at: recordedAt,
    artifact_refs: receipt.artifact_refs,
    worktree_fingerprint: receipt.worktree_fingerprint,
    producer: { role, runtime: 'isolated-branch-executor-v1' },
    payload,
  };
}

function appendReceiptEvent(sessionDir, compiled, receipt, state, recordedAt) {
  const node = nodeForReceipt(compiled, receipt);
  if (!node || node.kind !== 'parallel') throw new Error(`Unknown parallel node: ${receipt.node_id}`);
  if (receipt.receipt_kind === 'branch-started') {
    const branch = branchForReceipt(compiled, receipt);
    if (!branch) throw new Error(`Unknown parallel branch: ${receipt.branch_id}`);
    const branchState = state.nodes[node.id].branches[branch.id];
    let expectedPreviousEventDigest;
    if (branchState.status === 'failed') {
      const retry = appendWorkflowEvent({
        sessionDir,
        compiled,
        input: {
          event_id: `${receipt.source_event_id}.retry`,
          event_type: 'parallel.branch.retry_requested',
          node_id: node.id,
          recorded_at: recordedAt,
          artifact_refs: [],
          worktree_fingerprint: receipt.worktree_fingerprint,
          producer: { role: branch.role, runtime: 'isolated-branch-executor-v1' },
          payload: {
            branch_id: branch.id,
            failure_class: branchState.result?.failure_class,
            next_start_receipt: receipt,
          },
        },
      });
      expectedPreviousEventDigest = retry.event.event_digest;
    } else if (branchState.status !== 'ready') {
      throw new Error(`Branch ${branch.id} cannot start from status ${branchState.status}.`);
    }
    return appendWorkflowEvent({
      sessionDir,
      compiled,
      input: executorEvent(receipt, branch.role, recordedAt, { executor_receipt: receipt }),
      expected_previous_event_digest: expectedPreviousEventDigest,
    });
  }
  if (receipt.receipt_kind === 'branch-completed') {
    const branch = branchForReceipt(compiled, receipt);
    if (!branch) throw new Error(`Unknown parallel branch: ${receipt.branch_id}`);
    validateBranchArtifacts(sessionDir, branch, receipt);
    return appendWorkflowEvent({
      sessionDir,
      compiled,
      input: executorEvent(receipt, branch.role, recordedAt, { executor_receipt: receipt }),
    });
  }
  const branchResults = Object.values(state.nodes[node.id].branches)
    .map((branchState) => branchState.result)
    .filter(Boolean);
  const aggregation = aggregateParallel(
    node,
    branchResults,
    compiled.plan.baseline_fingerprint,
    receipt.worktree_fingerprint,
    receipt.verification,
    receipt,
  );
  const { values } = assertArtifactBytes(
    sessionDir,
    receipt.artifact_refs,
    receipt.artifact_digests,
    'aggregation-result-v2',
    node.id,
  );
  if (values.some((value) => canonicalJson(value) !== canonicalJson(aggregation))) {
    throw new Error('Integration artifact must exactly contain the deterministic aggregation result.');
  }
  return appendWorkflowEvent({
    sessionDir,
    compiled,
    input: executorEvent(receipt, 'executor', recordedAt, {
      output_schema: 'aggregation-result-v2',
      executor_receipt: receipt,
    }),
  });
}

export function appendAttestedParallelReceipt({
  sessionDir,
  compiled,
  receipt,
  liveWorktreeFingerprint,
  livePhysicalTopologyRoot,
  recordedAt = now(),
}) {
  assertLiveParallelBaseline(compiled, liveWorktreeFingerprint, livePhysicalTopologyRoot);
  verifyExecutionReceipt({
    receipt,
    binding: compiled.plan.executor_binding,
    expected: commonExpected(compiled, receipt),
    atTime: recordedAt,
  });
  const snapshot = readWorkflowJournal(sessionDir, compiled);
  return appendReceiptEvent(sessionDir, compiled, receipt, snapshot.state, recordedAt);
}

export function executeParallelFile(options) {
  for (const field of ['offlineTest', 'sessionDir']) {
    if (Object.hasOwn(options, field)) {
      throw new Error(`execute-parallel ${field} is unsupported.`);
    }
  }
  const { workspace, task, receipt: receiptFile } = options;
  if (!receiptFile) throw new Error('execute-parallel requires --receipt <signed-receipt.json>.');
  const canonicalWorkspace = workspacePath(workspace);
  const context = workflowCompilationContext(canonicalWorkspace, { requireDefectProof: false });
  if (sessionPaths(canonicalWorkspace, task).task !== context.current.paths.task) {
    throw new Error(`Requested task ${task} is not the canonical active task ${context.current.paths.task}.`);
  }
  const sessionDir = context.current.paths.sessionDir;
  const compiled = readJson(workflowPaths(sessionDir).planFile);
  if (!compiled) throw new Error('Workflow plan is not initialized for this canonical session.');
  const livePhysicalTopologyRoot = buildWorkspaceManifest(canonicalWorkspace)
    .evidence.physical_topology_root;
  assertCompiledBinding(compiled, context, livePhysicalTopologyRoot);
  const receipt = readStableJsonFile(resolve(receiptFile)).value;
  const recordedAt = now();
  return appendAttestedParallelReceipt({
    sessionDir,
    compiled,
    receipt,
    liveWorktreeFingerprint: context.fingerprint,
    livePhysicalTopologyRoot,
    recordedAt,
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (!args.task) throw new Error('execute-parallel requires --task <id> and --workspace <path>.');
    for (const field of ['offline-test', 'session-dir', 'plan']) {
      if (args[field] !== undefined) throw new Error(`execute-parallel --${field} is unsupported.`);
    }
    const result = executeParallelFile({
      workspace: args.workspace,
      task: args.task,
      receipt: args.receipt,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) main();
