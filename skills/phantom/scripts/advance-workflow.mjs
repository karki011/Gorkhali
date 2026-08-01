#!/usr/bin/env node
// Author: Subash Karki

import { createHash } from 'node:crypto';
import {
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  isMainModule,
  now,
  parseArgs,
  readJson,
  sessionPaths,
  workspacePath,
} from './lib/portable.mjs';
import {
  canonicalJson,
  isPortableWorkflowPath,
  pathWithinScope,
  validateEvaluationResult,
  validateSchema,
} from './lib/workflow-contracts.mjs';
import {
  appendWorkflowEvent,
  readWorkflowJournal,
  workflowPaths,
} from './lib/workflow-journal.mjs';
import { aggregateParallel } from './lib/workflow-kernel.mjs';
import {
  changedSnapshotPaths,
  readRegularFileOnce,
  readStableJsonFile,
  workspaceSnapshot,
} from './lib/filesystem-snapshot.mjs';
import {
  workflowCompilationContext,
  workflowStartContext,
  worktreeFingerprint,
} from './phantom-state.mjs';

const BROKER_ONLY_EVENTS = new Set(['capability.decision', 'capability.outcome']);
const OUTPUT_SCHEMAS = Object.freeze({
  'aggregation-result-v1': 'aggregation-result.schema.json',
  'evaluation-result-v1': 'evaluation-result.schema.json',
  'workflow-output-v1': 'workflow-output.schema.json',
});

const within = (root, candidate) => {
  const offset = relative(root, candidate);
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset));
};

const exactKeys = (value, required, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const expected = new Set(required);
  for (const field of required) {
    if (!Object.hasOwn(value, field)) throw new Error(`${label}.${field} is required.`);
  }
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) throw new Error(`${label}.${field} is unsupported.`);
  }
};

const exactStringSet = (actual, expected, label) => {
  if (!Array.isArray(actual)
    || actual.some((value) => typeof value !== 'string')
    || new Set(actual).size !== actual.length
    || new Set(expected).size !== expected.length
    || canonicalJson([...actual].sort()) !== canonicalJson([...expected].sort())) {
    throw new Error(`${label} must exactly match the declared artifacts or checks.`);
  }
};

const nonnegativeUsage = (payload, label) => {
  if (typeof payload.cost_units !== 'number' || !Number.isFinite(payload.cost_units) || payload.cost_units < 0) {
    throw new Error(`${label}.cost_units must be a non-negative number.`);
  }
  if (!Number.isInteger(payload.duration_ms) || payload.duration_ms < 0) {
    throw new Error(`${label}.duration_ms must be a non-negative integer.`);
  }
};

function artifactRecord(sessionDir, artifactRef) {
  if (!isPortableWorkflowPath(artifactRef) || artifactRef === '.') {
    throw new Error(`Artifact reference must be a normalized session-relative file: ${artifactRef}`);
  }
  const root = resolve(realpathSync(sessionDir));
  const candidate = resolve(root, artifactRef);
  if (!within(root, candidate)) throw new Error(`Artifact escapes the active session: ${artifactRef}`);
  let file;
  try {
    file = readRegularFileOnce(candidate, root);
  } catch (error) {
    throw new Error(`Artifact must be one stable regular non-symlink file: ${artifactRef}: ${error.message}`);
  }
  return {
    artifact_ref: artifactRef,
    bytes: file.bytes,
    digest: `sha256:${createHash('sha256').update(file.bytes).digest('hex')}`,
  };
}

function loadArtifactRecords(sessionDir, refs) {
  return [...refs].sort().map((artifactRef) => artifactRecord(sessionDir, artifactRef));
}

function artifactDigests(records) {
  return records.map(({ artifact_ref: artifactRef, digest }) => ({ artifact_ref: artifactRef, digest }));
}

function workspaceIdentity(workspace) {
  return `sha256:${createHash('sha256')
    .update('phantom-isolated-workspace-v1\0')
    .update(workspace)
    .digest('hex')}`;
}

function physicalIdentity(record) {
  return `${record.dev}:${record.ino}`;
}

function assertPhysicalIsolation(label, snapshot, otherSnapshots) {
  const symlink = snapshot.files.find((record) => record.kind === 'symlink');
  if (symlink) {
    throw new Error(`${label} contains a symbolic link: ${symlink.path}`);
  }
  const unsafe = snapshot.physical_files.find((record) => record.nlink !== 1);
  if (unsafe) {
    throw new Error(`${label} contains a hard-linked regular file: ${unsafe.path}`);
  }
  const external = new Set(otherSnapshots.flatMap((other) =>
    other.physical_files.map(physicalIdentity)));
  const shared = snapshot.physical_files.find((record) => external.has(physicalIdentity(record)));
  if (shared) {
    throw new Error(`${label} shares a physical regular file with another workspace: ${shared.path}`);
  }
}

function expectedBranchFiles(branchState) {
  return branchState.result?.current_files ?? branchState.baseline_files;
}

function schemaForOutput(outputSchema) {
  const candidate = OUTPUT_SCHEMAS[outputSchema];
  if (!candidate) return null;
  try {
    return JSON.parse(readFileSync(new URL(`../schemas/${candidate}`, import.meta.url), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function validateArtifactSchemas(records, outputSchema, expectedNodeId = null) {
  const schema = schemaForOutput(outputSchema);
  if (!schema) throw new Error(`Output schema is not registered: ${outputSchema}`);
  const values = [];
  for (const record of records) {
    let value;
    try {
      value = JSON.parse(record.bytes.toString('utf8'));
    } catch (error) {
      throw new Error(`Artifact ${record.artifact_ref} is not valid JSON: ${error.message}`);
    }
    const errors = validateSchema(schema, value);
    if (errors.length) {
      throw new Error(`Artifact ${record.artifact_ref} does not satisfy ${outputSchema}: ${errors.join('; ')}`);
    }
    if (expectedNodeId !== null && value.node_id !== expectedNodeId) {
      throw new Error(`Artifact ${record.artifact_ref} node_id does not match ${expectedNodeId}.`);
    }
    values.push(value);
  }
  return values;
}

const nodeById = (compiled, nodeId) => compiled.plan.nodes.find((node) => node.id === nodeId);

function computedInputs(snapshot, node, sessionDir) {
  return node.depends_on.flatMap((sourceNode) => {
    const source = snapshot.state.nodes[sourceNode];
    if (!source || source.status !== 'completed') {
      throw new Error(`Dependency ${sourceNode} is not complete.`);
    }
    return artifactDigests(loadArtifactRecords(sessionDir, source.artifact_refs))
      .map((binding) => ({ source_node: sourceNode, ...binding }));
  }).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function assertSuppliedValue(supplied, canonical, label) {
  if (supplied !== undefined && canonicalJson(supplied) !== canonicalJson(canonical)) {
    throw new Error(`${label} does not match canonical runtime evidence.`);
  }
}

function completionPayload({ input, node, sessionDir }) {
  const payload = input.payload || {};
  exactKeys(payload, ['output_schema', 'artifact_digests', 'cost_units', 'duration_ms'], 'payload');
  const refs = input.artifact_refs || [];
  exactStringSet(refs, node.expected_artifacts || [], 'artifact_refs');
  if (payload.output_schema !== node.output_schema) throw new Error('payload.output_schema does not match the node contract.');
  const records = loadArtifactRecords(sessionDir, refs);
  const digests = artifactDigests(records);
  assertSuppliedValue(payload.artifact_digests, digests, 'payload.artifact_digests');
  nonnegativeUsage(payload, 'payload');
  if (payload.cost_units > node.budget.max_cost_units || payload.duration_ms > node.budget.max_duration_ms) {
    throw new Error(`Node ${node.id} completion exceeds its declared budget.`);
  }
  const artifacts = validateArtifactSchemas(records, node.output_schema, node.id);
  if (node.output_schema === 'workflow-output-v1'
    && artifacts.some((artifact) => artifact.status !== 'completed'
      || artifact.evidence.length === 0
      || artifact.evidence.some((item) => item.result !== 'passed'))) {
    throw new Error(`Node ${node.id} completion requires a completed artifact with passing evidence.`);
  }
  return { ...payload, artifact_digests: digests };
}

function checkVerification(actual, expected, label, snapshotDigest = null) {
  if (!Array.isArray(actual)) throw new Error(`${label} must be an array.`);
  exactStringSet(actual.map((check) => check?.name), expected, label);
  for (const check of actual) {
    exactKeys(check, ['name', 'result'], `${label} check`);
    if (!['passed', 'failed'].includes(check.result)) throw new Error(`${label} result must be passed or failed.`);
  }
  return actual.map((check) => ({
    name: check.name,
    result: check.result,
    ...(snapshotDigest === null ? {} : { snapshot_digest: snapshotDigest }),
  }));
}

function canonicalEventInput({ input, compiled, snapshot, sessionDir, workspace, fingerprint }) {
  if (BROKER_ONLY_EVENTS.has(input.event_type)) {
    throw new Error(`${input.event_type} is broker-only and cannot be appended through advance-workflow.`);
  }
  const node = input.node_id ? nodeById(compiled, input.node_id) : null;
  let payload = input.payload || {};
  let artifactRefs = input.artifact_refs || [];
  let eventFingerprint = fingerprint;
  if (input.event_type === 'workflow.started' || input.event_type === 'worktree.changed') {
    exactKeys(payload, [], 'payload');
    if (input.event_type === 'workflow.started' && fingerprint !== compiled.plan.baseline_fingerprint) {
      throw new Error('workflow.started requires the compiled baseline to match the current worktree fingerprint.');
    }
  } else if (!node) {
    throw new Error(`Unknown workflow node: ${input.node_id ?? 'missing'}`);
  } else if (input.event_type === 'node.started') {
    const inputRefs = computedInputs(snapshot, node, sessionDir);
    if (Object.keys(payload).length) {
      exactKeys(payload, ['input_refs'], 'payload');
      assertSuppliedValue(payload.input_refs, inputRefs, 'payload.input_refs');
    }
    payload = { input_refs: inputRefs };
  } else if (input.event_type === 'node.completed') {
    payload = completionPayload({ input, node, sessionDir });
  } else if (input.event_type === 'node.failed') {
    exactKeys(payload, ['failure_class', 'cost_units', 'duration_ms'], 'payload');
    if (typeof payload.failure_class !== 'string' || !payload.failure_class) {
      throw new Error('payload.failure_class is required.');
    }
    nonnegativeUsage(payload, 'payload');
  } else if (input.event_type === 'node.invalidated') {
    exactKeys(payload, ['reason'], 'payload');
    if (typeof payload.reason !== 'string' || !payload.reason) throw new Error('payload.reason is required.');
  } else if (input.event_type === 'parallel.branch.started') {
    exactKeys(payload, ['branch_id', 'input_refs', 'branch_workspace'], 'payload');
    const branch = node.branches?.find((candidate) => candidate.id === payload.branch_id);
    if (!branch) throw new Error(`Unknown parallel branch: ${payload.branch_id}`);
    const runtimeInputs = computedInputs(snapshot, node, sessionDir);
    const declared = [...branch.dependency_inputs]
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
    if (canonicalJson(runtimeInputs) !== canonicalJson(declared)) {
      throw new Error(`Parallel branch ${branch.id} dependency inputs are stale or incomplete.`);
    }
    if (fingerprint !== branch.baseline_fingerprint) {
      throw new Error(`Parallel branch ${branch.id} cannot start from a stale worktree baseline.`);
    }
    assertSuppliedValue(payload.input_refs, runtimeInputs, 'payload.input_refs');
    if (typeof payload.branch_workspace !== 'string' || !isAbsolute(payload.branch_workspace)) {
      throw new Error(`Parallel branch ${branch.id} requires an absolute isolated branch_workspace.`);
    }
    const primaryRoot = resolve(realpathSync(workspace));
    const branchRoot = resolve(realpathSync(payload.branch_workspace));
    if (payload.branch_workspace !== branchRoot
      || within(primaryRoot, branchRoot)
      || within(branchRoot, primaryRoot)) {
      throw new Error(`Parallel branch ${branch.id} branch_workspace must be canonical and disjoint from the primary workspace.`);
    }
    const siblingStates = Object.values(snapshot.state.nodes[node.id]?.branches || {})
      .filter((branchState) => branchState.workspace_root);
    const siblingRoots = siblingStates.map((branchState) => branchState.workspace_root);
    if (siblingRoots.some((sibling) => within(sibling, branchRoot) || within(branchRoot, sibling))) {
      throw new Error(`Parallel branch ${branch.id} branch_workspace overlaps a sibling workspace.`);
    }
    const baseline = workspaceSnapshot(branchRoot);
    const primary = workspaceSnapshot(primaryRoot);
    const siblingSnapshots = siblingRoots.map((root) => workspaceSnapshot(root));
    assertPhysicalIsolation(
      `Parallel branch ${branch.id} isolated workspace`,
      baseline,
      [primary, ...siblingSnapshots],
    );
    siblingSnapshots.forEach((sibling, index) => assertPhysicalIsolation(
      `Parallel sibling workspace ${siblingStates[index].workspace_root}`,
      sibling,
      [primary, baseline, ...siblingSnapshots.filter((_, candidate) => candidate !== index)],
    ));
    if (baseline.digest !== branch.baseline_fingerprint) {
      throw new Error(`Parallel branch ${branch.id} isolated workspace does not match its declared baseline.`);
    }
    const identity = workspaceIdentity(branchRoot);
    eventFingerprint = baseline.digest;
    payload = {
      branch_id: branch.id,
      input_refs: runtimeInputs,
      baseline_fingerprint: baseline.digest,
      workspace_identity: identity,
      workspace_root: branchRoot,
      baseline_files: baseline.files,
      baseline_physical_files: baseline.physical_files,
    };
  } else if (input.event_type === 'parallel.branch.completed') {
    exactKeys(payload, [
      'branch_id', 'status', 'baseline_fingerprint', 'changed_paths', 'artifact_refs',
      'artifact_digests', 'verification', 'failure_class', 'cost_units', 'duration_ms',
    ], 'payload');
    const branch = node.branches?.find((candidate) => candidate.id === payload.branch_id);
    if (!branch) throw new Error(`Unknown parallel branch: ${payload.branch_id}`);
    if (!['passed', 'failed'].includes(payload.status)) throw new Error('payload.status must be passed or failed.');
    if (payload.baseline_fingerprint !== branch.baseline_fingerprint) {
      throw new Error(`Parallel branch ${branch.id} has a stale baseline.`);
    }
    exactStringSet(payload.artifact_refs, branch.expected_artifacts, 'payload.artifact_refs');
    artifactRefs = payload.artifact_refs;
    const records = loadArtifactRecords(sessionDir, artifactRefs);
    const digests = artifactDigests(records);
    assertSuppliedValue(payload.artifact_digests, digests, 'payload.artifact_digests');
    const branchState = snapshot.state.nodes[node.id]?.branches?.[branch.id];
    if (!branchState?.workspace_identity || !branchState.workspace_root
      || !Array.isArray(branchState.baseline_files)
      || !Array.isArray(branchState.baseline_physical_files)) {
      throw new Error(`Parallel branch ${branch.id} has no canonical isolated workspace evidence.`);
    }
    if (payload.baseline_fingerprint !== branchState.baseline_fingerprint) {
      throw new Error(`Parallel branch ${branch.id} completion does not match its recorded baseline.`);
    }
    const branchRoot = resolve(realpathSync(branchState.workspace_root));
    if (branchRoot !== branchState.workspace_root) {
      throw new Error(`Parallel branch ${branch.id} workspace identity changed after start.`);
    }
    const current = workspaceSnapshot(branchRoot);
    const primary = workspaceSnapshot(workspace);
    if (primary.digest !== compiled.plan.baseline_fingerprint) {
      throw new Error(
        `Parallel branch ${branch.id} completion detected primary workspace drift before integration.`,
      );
    }
    const siblingStates = Object.entries(snapshot.state.nodes[node.id]?.branches || {})
      .filter(([siblingId, sibling]) => siblingId !== branch.id && sibling.workspace_root);
    const siblingSnapshots = siblingStates.map(([siblingId, sibling]) => {
      const actual = workspaceSnapshot(sibling.workspace_root);
      if (canonicalJson(actual.files) !== canonicalJson(expectedBranchFiles(sibling))) {
        throw new Error(`Parallel branch ${branch.id} completion detected drift in sibling workspace ${siblingId}.`);
      }
      return actual;
    });
    assertPhysicalIsolation(
      `Parallel branch ${branch.id} isolated workspace`,
      current,
      [primary, ...siblingSnapshots],
    );
    siblingSnapshots.forEach((sibling, index) => assertPhysicalIsolation(
      `Parallel sibling workspace ${siblingStates[index][0]}`,
      sibling,
      [primary, current, ...siblingSnapshots.filter((_, candidate) => candidate !== index)],
    ));
    const changedPaths = changedSnapshotPaths(branchState.baseline_files, current.files);
    assertSuppliedValue(payload.changed_paths, changedPaths, 'payload.changed_paths');
    if (changedPaths.some((changed) => !branch.allowed_paths.some((scope) => pathWithinScope(changed, scope)))) {
      throw new Error(`Parallel branch ${branch.id} contains a changed path outside its declared scope.`);
    }
    const verification = checkVerification(payload.verification, branch.verification, 'payload.verification');
    nonnegativeUsage(payload, 'payload');
    if (payload.cost_units > branch.budget.max_cost_units
      || payload.duration_ms > branch.budget.max_duration_ms) {
      throw new Error(`Parallel branch ${branch.id} exceeds its declared budget.`);
    }
    const artifacts = validateArtifactSchemas(records, 'workflow-output-v1', branch.id);
    if (payload.status === 'passed'
      && artifacts.some((artifact) => artifact.status !== 'completed'
        || artifact.evidence.length === 0
        || artifact.evidence.some((item) => item.result !== 'passed'))) {
      throw new Error(`Passing parallel branch ${branch.id} requires completed artifacts with passing evidence.`);
    }
    eventFingerprint = current.digest;
    payload = {
      ...payload,
      changed_paths: changedPaths,
      artifact_digests: digests,
      verification,
      workspace_identity: branchState.workspace_identity,
      baseline_files: branchState.baseline_files,
      baseline_physical_files: branchState.baseline_physical_files,
      current_files: current.files,
      current_physical_files: current.physical_files,
    };
  } else if (input.event_type === 'parallel.branch.retry_requested') {
    exactKeys(payload, ['branch_id', 'failure_class'], 'payload');
    if (!node.branches?.some((branch) => branch.id === payload.branch_id)) {
      throw new Error(`Unknown parallel branch: ${payload.branch_id}`);
    }
    if (typeof payload.failure_class !== 'string' || !payload.failure_class) {
      throw new Error('payload.failure_class is required.');
    }
  } else if (input.event_type === 'parallel.aggregated') {
    exactKeys(payload, [
      'output_schema', 'artifact_digests', 'aggregate_verification', 'cost_units', 'duration_ms',
    ], 'payload');
    artifactRefs = input.artifact_refs || [];
    exactStringSet(artifactRefs, node.expected_artifacts || [], 'artifact_refs');
    const outputSchema = node.output_schema || 'aggregation-result-v1';
    if (payload.output_schema !== outputSchema) throw new Error('payload.output_schema does not match the parallel contract.');
    const records = loadArtifactRecords(sessionDir, artifactRefs);
    const digests = artifactDigests(records);
    assertSuppliedValue(payload.artifact_digests, digests, 'payload.artifact_digests');
    const integrated = workspaceSnapshot(workspace);
    const verification = checkVerification(
      payload.aggregate_verification,
      node.verification,
      'payload.aggregate_verification',
      integrated.digest,
    );
    nonnegativeUsage(payload, 'payload');
    if (payload.cost_units > node.budget.max_cost_units || payload.duration_ms > node.budget.max_duration_ms) {
      throw new Error(`Parallel node ${node.id} exceeds its declared budget.`);
    }
    const artifacts = validateArtifactSchemas(records, outputSchema, node.id);
    const branchResults = Object.values(snapshot.state.nodes[node.id].branches)
      .map((branchState) => branchState.result)
      .filter(Boolean);
    const aggregate = aggregateParallel(
      node,
      branchResults,
      compiled.plan.baseline_fingerprint,
      integrated.digest,
      verification,
      integrated.files,
    );
    if (artifacts.some((artifact) => canonicalJson(artifact) !== canonicalJson(aggregate))) {
      throw new Error('Parallel aggregation artifacts must exactly contain the canonical aggregation result.');
    }
    eventFingerprint = integrated.digest;
    payload = {
      ...payload,
      artifact_digests: digests,
      aggregate_verification: verification,
      integrated_snapshot_digest: integrated.digest,
      integrated_files: integrated.files,
      authorized_changed_paths: aggregate.authorized_changed_paths,
    };
  } else if (input.event_type === 'evaluation.recorded') {
    artifactRefs = input.artifact_refs || [];
    exactStringSet(artifactRefs, node.expected_artifacts || [], 'artifact_refs');
    const records = loadArtifactRecords(sessionDir, artifactRefs);
    const digests = artifactDigests(records);
    assertSuppliedValue(payload.artifact_digests, digests, 'payload.artifact_digests');
    const artifactPayload = { ...payload };
    delete artifactPayload.artifact_digests;
    const artifacts = validateArtifactSchemas(records, 'evaluation-result-v1', node.id);
    if (artifacts.some((artifact) => Object.hasOwn(artifact, 'artifact_digests')
      || canonicalJson(artifact) !== canonicalJson(artifactPayload))) {
      throw new Error('Evaluation artifacts must exactly contain the canonical evaluation result.');
    }
    payload = { ...artifactPayload, artifact_digests: digests };
    const errors = validateEvaluationResult(payload);
    if (errors.length) throw new Error(`Invalid evaluation payload: ${errors.join('; ')}`);
  } else if (input.event_type === 'budget.exhausted') {
    exactKeys(payload, ['failure_class'], 'payload');
    if (payload.failure_class !== 'budget_exhausted') {
      throw new Error('payload.failure_class must be budget_exhausted.');
    }
  }
  const role = input.event_type.startsWith('parallel.branch.')
    ? node?.branches?.find((branch) => branch.id === payload.branch_id)?.role
    : (node?.role || node?.evaluator_role || 'apex');
  if (Object.hasOwn(input, 'worktree_fingerprint') && input.worktree_fingerprint !== eventFingerprint) {
    throw new Error('Caller worktree_fingerprint does not match canonical runtime evidence.');
  }
  return {
    event_id: input.event_id,
    event_type: input.event_type,
    node_id: input.node_id ?? null,
    recorded_at: now(),
    artifact_refs: artifactRefs,
    worktree_fingerprint: eventFingerprint,
    producer: { role: role || 'apex', runtime: 'advance-workflow-v1' },
    payload,
  };
}

function assertCompiledBinding(compiled, context) {
  const binding = compiled?.plan?.session_binding;
  if (!binding || canonicalJson(binding) !== canonicalJson(context.session_binding)) {
    throw new Error('Compiled workflow is not bound to the canonical active session and approved plan.');
  }
  if (compiled.plan.route !== context.current.session.route) {
    throw new Error('Compiled workflow route does not match the active session.');
  }
}

export function advanceWorkflowFile({
  workspace,
  task,
  input,
  sessionDir = null,
  offlineTest = false,
}) {
  if (!input) throw new Error('advance-workflow requires --input <event-input.json>.');
  const canonicalWorkspace = workspacePath(workspace);
  const canonicalSession = sessionPaths(canonicalWorkspace, task).sessionDir;
  if (sessionDir !== null) {
    if (!offlineTest) throw new Error('--session-dir is available only with explicit --offline-test opt-in.');
    if (resolve(sessionDir) !== resolve(canonicalSession)) {
      throw new Error('--session-dir must equal the canonical session directory for --workspace and --task.');
    }
  }
  const actualSession = canonicalSession;
  const compiled = readJson(workflowPaths(actualSession).planFile);
  if (!compiled) throw new Error('Workflow plan is not initialized for this canonical session.');
  const eventInput = readStableJsonFile(resolve(input)).value;
  if (!offlineTest && (eventInput?.event_type?.startsWith('parallel.branch.')
    || eventInput?.event_type === 'parallel.aggregated')) {
    throw new Error(
      'Native parallel branch execution is disabled because no trusted isolated executor attestation is bundled; '
      + 'lower the workflow to current-agent or sequential chain nodes.',
    );
  }
  const fingerprint = worktreeFingerprint(canonicalWorkspace);
  let context = null;
  if (!offlineTest) {
    context = eventInput.event_type === 'workflow.started'
      ? workflowStartContext(canonicalWorkspace)
      : workflowCompilationContext(canonicalWorkspace, { requireDefectProof: false });
    if (sessionPaths(canonicalWorkspace, task).task !== context.current.paths.task) {
      throw new Error(`Requested task ${task} is not the canonical active task ${context.current.paths.task}.`);
    }
    assertCompiledBinding(compiled, context);
  }
  const snapshot = readWorkflowJournal(actualSession, compiled);
  const staleCompleted = Object.values(snapshot.state.nodes)
    .some((node) => node.status === 'completed' && node.worktree_fingerprint !== fingerprint);
  if (staleCompleted && eventInput.event_type !== 'worktree.changed') {
    throw new Error('Completed workflow evidence is stale; append worktree.changed before another transition.');
  }
  const canonicalInput = canonicalEventInput({
    input: eventInput,
    compiled,
    snapshot,
    sessionDir: actualSession,
    workspace: canonicalWorkspace,
    fingerprint,
  });
  return appendWorkflowEvent({
    sessionDir: actualSession,
    compiled,
    input: canonicalInput,
    expected_previous_event_digest: eventInput.expected_previous_event_digest,
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (!args.task) throw new Error('advance-workflow requires --task <id> and --workspace <path>.');
    if (args.plan) throw new Error('--plan is unsupported; only the canonical session-bound plan may advance.');
    const result = advanceWorkflowFile({
      workspace: args.workspace,
      task: args.task,
      input: args.input,
      sessionDir: args['session-dir'] || null,
      offlineTest: args['offline-test'] === true,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) main();
