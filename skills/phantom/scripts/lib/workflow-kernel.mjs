// Author: Subash Karki
// Pure compiler and reducer for Phantom's fresh v1 workflow contract.

import {
  WorkflowContractError,
  assertContract,
  canonicalJson,
  digestValue,
  isPortableWorkflowPath,
  pathWithinScope,
  validateAggregationResult,
  validateEvaluationResult,
  validateWorkflowEvent,
  validateWorkflowPlan,
} from './workflow-contracts.mjs';
import { snapshotDigest } from './filesystem-snapshot.mjs';

const clone = (value) => structuredClone(value);
const byId = (left, right) => left.id.localeCompare(right.id);
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const MAX_SNAPSHOT_FILES = 20_000;
const EXTERNAL_CAPABILITIES = new Set(['git.push', 'github.openDraftPr', 'tracker.comment']);
const CAPABILITY_FOR_ACTION = Object.freeze({
  'draft-pr': 'github.openDraftPr',
  'git-push': 'git.push',
  'tracker-comment': 'tracker.comment',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameValue = (left, right) => canonicalJson(left) === canonicalJson(right);
const sortCanonical = (values) => [...values].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));

const normalizeNode = (node) => {
  const normalized = clone(node);
  normalized.depends_on = [...normalized.depends_on].sort();
  for (const field of ['allowed_paths', 'allowed_cwds', 'expected_artifacts', 'sources', 'verification']) {
    if (normalized[field]) normalized[field] = [...normalized[field]].sort();
  }
  if (normalized.allowed_commands) normalized.allowed_commands = sortCanonical(normalized.allowed_commands);
  if (normalized.branches) {
    normalized.branches = normalized.branches.map((branch) => ({
      ...branch,
      dependency_inputs: sortCanonical(branch.dependency_inputs),
      allowed_paths: [...branch.allowed_paths].sort(),
      expected_artifacts: [...branch.expected_artifacts].sort(),
      verification: [...branch.verification].sort(),
    })).sort(byId);
  }
  return normalized;
};

const graphErrors = (plan) => {
  const errors = [];
  const ids = new Set(plan.nodes.map((node) => node.id));
  plan.nodes.forEach((node, index) => {
    for (const dependency of node.depends_on) {
      if (dependency === node.id) errors.push(`$.nodes[${index}].depends_on: self-dependency ${dependency}`);
      else if (!ids.has(dependency)) errors.push(`$.nodes[${index}].depends_on: unknown node ${dependency}`);
    }
    for (const source of node.sources || []) {
      if (!ids.has(source)) errors.push(`$.nodes[${index}].sources: unknown node ${source}`);
    }
    for (const [branchIndex, branch] of (node.branches || []).entries()) {
      if (branch.baseline_fingerprint !== plan.baseline_fingerprint) {
        errors.push(`$.nodes[${index}].branches[${branchIndex}].baseline_fingerprint: must match workflow baseline`);
      }
      for (const input of branch.dependency_inputs) {
        if (!node.depends_on.includes(input.source_node)) {
          errors.push(`$.nodes[${index}].branches[${branchIndex}].dependency_inputs: ${input.source_node} is not a dependency`);
        }
      }
    }
  });
  return errors;
};

const topologicalWaves = (nodes) => {
  const remaining = new Map(nodes.map((node) => [node.id, new Set(node.depends_on)]));
  const waves = [];
  while (remaining.size) {
    const wave = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([id]) => id)
      .sort();
    if (wave.length === 0) {
      throw new WorkflowContractError('Invalid workflow graph', ['$.nodes: dependency cycle detected']);
    }
    waves.push(wave);
    wave.forEach((id) => remaining.delete(id));
    for (const dependencies of remaining.values()) wave.forEach((id) => dependencies.delete(id));
  }
  return waves;
};

export function compileWorkflow(input) {
  assertContract('Invalid workflow plan', validateWorkflowPlan(input));
  assertContract('Invalid workflow graph', graphErrors(input));
  const normalized = clone(input);
  normalized.nodes = normalized.nodes.map(normalizeNode);
  const executionWaves = topologicalWaves(normalized.nodes);
  const position = new Map(executionWaves.flat().map((id, index) => [id, index]));
  normalized.nodes.sort((left, right) => position.get(left.id) - position.get(right.id));
  return {
    schema_version: 1,
    plan: normalized,
    plan_digest: digestValue(normalized),
    topological_order: executionWaves.flat(),
    execution_waves: executionWaves,
  };
}

const evaluationState = () => ({
  iterations: 0,
  cost_units: 0,
  duration_ms: 0,
  failure_counts: {},
  terminal_state: null,
  last_result: null,
});

const branchStates = (node, previous = {}) => Object.fromEntries((node.branches || []).map((branch) => {
  const prior = previous[branch.id];
  return [branch.id, {
    status: 'pending',
    attempts: prior?.attempts ?? 0,
    consumed_budget: clone(prior?.consumed_budget ?? { cost_units: 0, duration_ms: 0 }),
    input_refs: [],
    artifact_digests: [],
    baseline_fingerprint: null,
    workspace_identity: null,
    workspace_root: null,
    baseline_files: [],
    baseline_physical_files: [],
    result: null,
  }];
}));

export function createInitialState(compiled) {
  if (compiled?.schema_version !== 1 || compiled.plan_digest !== digestValue(compiled.plan)) {
    throw new WorkflowContractError('Invalid compiled workflow', ['plan digest does not match plan']);
  }
  return {
    schema_version: 1,
    workflow_id: compiled.plan.workflow_id,
    plan_digest: compiled.plan_digest,
    status: 'pending',
    sequence: 0,
    last_event_digest: null,
    last_recorded_at: null,
    started_at: null,
    remaining_budget: {
      cost: compiled.plan.budget.max_cost_units,
      duration_ms: compiled.plan.budget.max_duration_ms,
      attempts: compiled.plan.budget.max_attempts,
    },
    nodes: Object.fromEntries(compiled.plan.nodes.map((node) => [node.id, {
      status: 'pending',
      attempts: 0,
      consumed_budget: { cost_units: 0, duration_ms: 0 },
      input_refs: [],
      artifact_refs: [],
      artifact_digests: [],
      worktree_fingerprint: null,
      last_event_sequence: null,
      terminal_state: null,
      latest_capability_event: null,
      capability_event_count: 0,
      capability_decisions: {},
      capability_outcomes: [],
      successful_capability_outcome_digest: null,
      ...(node.kind === 'parallel' ? { branches: branchStates(node), result: null } : {}),
      ...(node.kind === 'evaluate-optimize' ? { evaluation: evaluationState() } : {}),
    }])),
  };
}

const nodeMap = (compiled) => new Map(compiled.plan.nodes.map((node) => [node.id, node]));

const refreshReadiness = (compiled, state) => {
  if (!['running', 'accepted', 'failed', 'blocked'].includes(state.status)) return;
  for (const node of compiled.plan.nodes) {
    const current = state.nodes[node.id];
    if (!['pending', 'stale'].includes(current.status)) continue;
    if (node.depends_on.every((dependency) => state.nodes[dependency].status === 'completed')) {
      current.status = 'ready';
    }
  }
};

const refreshWorkflowStatus = (compiled, state) => {
  const statuses = compiled.plan.nodes.map((node) => state.nodes[node.id].status);
  if (statuses.every((status) => status === 'completed')) state.status = 'accepted';
  else if (statuses.includes('blocked')) state.status = 'blocked';
  else if (statuses.includes('failed')) state.status = 'failed';
  else state.status = 'running';
};

const requireNode = (compiled, state, event) => {
  const node = nodeMap(compiled).get(event.node_id);
  if (!node || !state.nodes[event.node_id]) throw new Error(`Unknown workflow node: ${event.node_id}`);
  return [node, state.nodes[event.node_id]];
};

const requireStatus = (nodeId, nodeState, allowed, action) => {
  if (!allowed.includes(nodeState.status)) {
    throw new Error(`Cannot ${action} ${nodeId} from status ${nodeState.status}; expected ${allowed.join(' or ')}`);
  }
};

const exactPayload = (event, fields) => {
  if (!isObject(event.payload)) throw new Error(`${event.event_type} requires an object payload.`);
  const actual = Object.keys(event.payload).sort();
  const expected = [...fields].sort();
  if (!sameValue(actual, expected)) {
    throw new Error(`${event.event_type} payload must contain exactly: ${expected.join(', ') || '(no fields)'}.`);
  }
};

const validateUsage = (value, label) => {
  if (!isObject(value)
    || typeof value.cost_units !== 'number' || !Number.isFinite(value.cost_units) || value.cost_units < 0
    || !Number.isInteger(value.duration_ms) || value.duration_ms < 0) {
    throw new Error(`${label} requires nonnegative cost_units and integer duration_ms.`);
  }
};

const maxBudget = (budget, field) => Number.isFinite(budget?.[field]) ? budget[field] : Number.POSITIVE_INFINITY;

const consumeUsage = (state, consumerState, budget, usage, label) => {
  validateUsage(usage, label);
  const nextCost = consumerState.consumed_budget.cost_units + usage.cost_units;
  const nextDuration = consumerState.consumed_budget.duration_ms + usage.duration_ms;
  if (nextCost > maxBudget(budget, 'max_cost_units')) throw new Error(`${label} exceeds its cost budget.`);
  if (nextDuration > maxBudget(budget, 'max_duration_ms')) throw new Error(`${label} exceeds its duration budget.`);
  if (usage.cost_units > state.remaining_budget.cost) throw new Error(`${label} exceeds the remaining workflow cost budget.`);
  if (usage.duration_ms > state.remaining_budget.duration_ms) {
    throw new Error(`${label} exceeds the remaining workflow duration budget.`);
  }
  consumerState.consumed_budget.cost_units = nextCost;
  consumerState.consumed_budget.duration_ms = nextDuration;
  state.remaining_budget.cost -= usage.cost_units;
  state.remaining_budget.duration_ms -= usage.duration_ms;
};

const localBudgetAvailable = (consumerState, budget) =>
  consumerState.consumed_budget.cost_units < maxBudget(budget, 'max_cost_units')
  && consumerState.consumed_budget.duration_ms < maxBudget(budget, 'max_duration_ms');

const workflowExecutionBudgetAvailable = (state) =>
  state.remaining_budget.attempts > 0
  && state.remaining_budget.cost > 0
  && state.remaining_budget.duration_ms > 0;

const nodeCanStart = (node, nodeState, state) => {
  if (nodeState.attempts >= node.retry_limit + 1) return false;
  if (!workflowExecutionBudgetAvailable(state) || !localBudgetAvailable(nodeState, node.budget)) return false;
  if (node.kind === 'evaluate-optimize' && nodeState.evaluation.iterations >= node.budget.max_iterations) return false;
  if (node.kind === 'parallel' && node.branches.some((branch) => {
    const branchState = nodeState.branches[branch.id];
    return branchState.attempts >= branch.retry_limit + 1 || !localBudgetAvailable(branchState, branch.budget);
  })) return false;
  return true;
};

const branchCanStart = (branch, branchState, state) =>
  branchState.attempts < branch.retry_limit + 1
  && workflowExecutionBudgetAvailable(state)
  && localBudgetAvailable(branchState, branch.budget);

const consumeAttempt = (state, consumerState, maximum, label) => {
  if (state.remaining_budget.attempts <= 0) throw new Error(`${label} exceeds the workflow attempt budget.`);
  if (consumerState.attempts >= maximum) throw new Error(`${label} exceeds its retry limit.`);
  consumerState.attempts += 1;
  state.remaining_budget.attempts -= 1;
};

const dependencyIds = (node) => node.kind === 'aggregate' ? node.sources : node.depends_on;

const expectedInputRefs = (state, node) => sortCanonical(dependencyIds(node).flatMap((sourceNode) =>
  state.nodes[sourceNode].artifact_digests.map(({ artifact_ref, digest }) => ({
    source_node: sourceNode,
    artifact_ref,
    digest,
  }))));

const assertInputRefs = (state, node, supplied, label) => {
  const expected = expectedInputRefs(state, node);
  if (!Array.isArray(supplied) || !sameValue(sortCanonical(supplied), expected)) {
    throw new Error(`${label} input_refs do not match completed dependency artifacts.`);
  }
  return expected;
};

const validateArtifactDigests = (artifactDigests, expectedArtifacts, label) => {
  if (!Array.isArray(artifactDigests)) throw new Error(`${label} requires artifact_digests.`);
  const sorted = sortCanonical(artifactDigests);
  const refs = sorted.map((item) => item?.artifact_ref).sort();
  if (!sameValue(refs, [...expectedArtifacts].sort())) {
    throw new Error(`${label} artifacts do not match expected_artifacts.`);
  }
  if (new Set(refs).size !== refs.length
    || sorted.some((item) => !isObject(item) || Object.keys(item).sort().join(',') !== 'artifact_ref,digest'
      || typeof item.artifact_ref !== 'string' || !digestPattern.test(item.digest || ''))) {
    throw new Error(`${label} contains invalid or duplicate artifact digests.`);
  }
  return sorted;
};

const validateSnapshotFiles = (files, label) => {
  if (!Array.isArray(files) || files.length > MAX_SNAPSHOT_FILES) {
    throw new Error(`${label} must contain at most ${MAX_SNAPSHOT_FILES} filesystem records.`);
  }
  let previousPath = null;
  return files.map((item) => {
    if (!isObject(item)
      || !sameValue(Object.keys(item).sort(), ['digest', 'kind', 'mode', 'path'])
      || !isPortableWorkflowPath(item.path) || item.path === '.'
      || !['file', 'symlink'].includes(item.kind)) {
      throw new Error(`${label} contains invalid filesystem evidence.`);
    }
    if (previousPath !== null && item.path <= previousPath) {
      throw new Error(`${label} paths must be unique and sorted.`);
    }
    previousPath = item.path;
    if (!Number.isInteger(item.mode) || item.mode < 0 || item.mode > 0o7777
      || !digestPattern.test(item.digest || '')) {
      throw new Error(`${label} file records require a valid mode and digest.`);
    }
    return clone(item);
  });
};

const validatePhysicalFiles = (physicalFiles, snapshotFiles, label) => {
  if (!Array.isArray(physicalFiles) || physicalFiles.length > MAX_SNAPSHOT_FILES) {
    throw new Error(`${label} must contain at most ${MAX_SNAPSHOT_FILES} physical file records.`);
  }
  const regularPaths = snapshotFiles
    .filter((item) => item.kind === 'file')
    .map((item) => item.path);
  const identities = new Set();
  let previousPath = null;
  const validated = physicalFiles.map((item) => {
    if (!isObject(item)
      || !sameValue(Object.keys(item).sort(), ['dev', 'ino', 'nlink', 'path'])
      || !isPortableWorkflowPath(item.path) || item.path === '.'
      || !/^[0-9]+$/.test(item.dev || '')
      || !/^[0-9]+$/.test(item.ino || '')
      || item.nlink !== 1) {
      throw new Error(`${label} contains invalid or hard-linked physical file evidence.`);
    }
    if (previousPath !== null && item.path <= previousPath) {
      throw new Error(`${label} paths must be unique and sorted.`);
    }
    previousPath = item.path;
    const identity = `${item.dev}:${item.ino}`;
    if (identities.has(identity)) throw new Error(`${label} reuses one physical file identity.`);
    identities.add(identity);
    return clone(item);
  });
  if (!sameValue(validated.map((item) => item.path), regularPaths)) {
    throw new Error(`${label} must exactly bind every regular snapshot file.`);
  }
  return validated;
};

const changedSnapshotPaths = (baselineFiles, currentFiles) => {
  const baseline = new Map(baselineFiles.map((entry) => [entry.path, entry]));
  const current = new Map(currentFiles.map((entry) => [entry.path, entry]));
  return [...new Set([...baseline.keys(), ...current.keys()])]
    .filter((filePath) => !sameValue(baseline.get(filePath) ?? null, current.get(filePath) ?? null))
    .sort();
};

const validateOutput = (node, event, expectedSchema = node.output_schema) => {
  exactPayload(event, ['output_schema', 'artifact_digests', 'cost_units', 'duration_ms']);
  if (event.payload.output_schema !== expectedSchema) throw new Error('Output schema does not match the declared node output_schema.');
  const artifacts = validateArtifactDigests(event.payload.artifact_digests, node.expected_artifacts, 'node completion');
  if (!sameValue(event.artifact_refs, artifacts.map((item) => item.artifact_ref).sort())) {
    throw new Error('Event artifact_refs do not match the completed artifact digests.');
  }
  if (!digestPattern.test(event.worktree_fingerprint || '')) {
    throw new Error('node completion requires a worktree fingerprint.');
  }
  validateUsage(event.payload, 'node completion');
  return artifacts;
};

const clearNodeEvidence = (node, state) => {
  state.input_refs = [];
  state.artifact_refs = [];
  state.artifact_digests = [];
  state.worktree_fingerprint = null;
  state.last_event_sequence = null;
  state.terminal_state = null;
  state.latest_capability_event = null;
  state.capability_decisions = {};
  state.capability_outcomes = [];
  state.successful_capability_outcome_digest = null;
  if (node.kind === 'parallel') {
    state.branches = branchStates(node, state.branches);
    state.result = null;
  }
  if (node.kind === 'evaluate-optimize') {
    const previous = state.evaluation;
    state.evaluation = {
      ...evaluationState(),
      iterations: previous.iterations,
      cost_units: previous.cost_units,
      duration_ms: previous.duration_ms,
      failure_counts: clone(previous.failure_counts),
    };
  }
};

const invalidateFrom = (compiled, state, rootId) => {
  const nodes = nodeMap(compiled);
  const impacted = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of compiled.plan.nodes) {
      if (!impacted.has(node.id) && node.depends_on.some((dependency) => impacted.has(dependency))) {
        impacted.add(node.id);
        changed = true;
      }
    }
  }
  for (const id of impacted) {
    clearNodeEvidence(nodes.get(id), state.nodes[id]);
    state.nodes[id].status = id === rootId ? 'pending' : 'stale';
  }
  state.status = 'running';
  refreshReadiness(compiled, state);
  for (const id of impacted) {
    const node = nodes.get(id);
    const current = state.nodes[id];
    if (current.status === 'ready' && !nodeCanStart(node, current, state)) {
      current.status = 'failed';
      current.terminal_state = budgetIsExhausted(node, current, state) ? 'budget_exhausted' : 'retry_limit';
    }
  }
};

const verificationPassed = (checks) =>
  Array.isArray(checks) && checks.length > 0 && checks.every((check) => check?.result === 'passed');

const verificationNamesMatch = (checks, expected) =>
  Array.isArray(checks)
  && checks.length === expected.length
  && new Set(checks.map((check) => check?.name)).size === checks.length
  && sameValue(checks.map((check) => check?.name).sort(), [...expected].sort());

const validVerificationChecks = (checks) => Array.isArray(checks)
  && checks.every((check) => isObject(check)
    && sameValue(Object.keys(check).sort(), ['name', 'result'])
    && typeof check.name === 'string' && check.name.length > 0
    && ['passed', 'failed'].includes(check.result));

const validAggregateVerification = (checks, snapshot) => Array.isArray(checks)
  && checks.every((check) => isObject(check)
    && sameValue(Object.keys(check).sort(), ['name', 'result', 'snapshot_digest'])
    && typeof check.name === 'string' && check.name.length > 0
    && ['passed', 'failed'].includes(check.result)
    && check.snapshot_digest === snapshot);

export function aggregateParallel(
  node,
  branchResults,
  baselineFingerprint,
  currentFingerprint,
  aggregateVerification = [],
  integratedFiles = [],
) {
  const conflicts = [];
  const results = [...branchResults].sort((left, right) => left.branch_id.localeCompare(right.branch_id));
  const expected = new Map(node.branches.map((branch) => [branch.id, branch]));
  const seen = new Set();
  const workspaceIdentities = new Set();
  const currentPhysicalOwners = new Map();
  let canonicalBaseline = null;
  let validatedIntegrated = [];
  try {
    validatedIntegrated = validateSnapshotFiles(integratedFiles, 'integrated_files');
    if (snapshotDigest(validatedIntegrated) !== currentFingerprint) {
      conflicts.push('integrated snapshot digest does not match worktree fingerprint');
    }
  } catch {
    conflicts.push('invalid integrated filesystem evidence');
  }
  for (const result of results) {
    if (seen.has(result.branch_id)) conflicts.push(`duplicate branch result: ${result.branch_id}`);
    seen.add(result.branch_id);
    const branch = expected.get(result.branch_id);
    if (!branch) {
      conflicts.push(`unexpected branch: ${result.branch_id}`);
      continue;
    }
    if (result.baseline_fingerprint !== baselineFingerprint
      || result.baseline_fingerprint !== branch.baseline_fingerprint) conflicts.push(`stale baseline: ${result.branch_id}`);
    if (result.status !== 'passed') conflicts.push(`branch failed: ${result.branch_id}`);
    for (const artifact of branch.expected_artifacts) {
      if (!result.artifact_refs?.includes(artifact)) conflicts.push(`missing expected artifact ${artifact}: ${result.branch_id}`);
    }
    if (!verificationNamesMatch(result.verification, branch.verification)) {
      conflicts.push(`verification names do not match contract: ${result.branch_id}`);
    } else if (!verificationPassed(result.verification)) {
      conflicts.push(`verification missing or failed: ${result.branch_id}`);
    }
    if (result.cost_units > branch.budget.max_cost_units
      || result.duration_ms > branch.budget.max_duration_ms) conflicts.push(`branch budget exceeded: ${result.branch_id}`);
    let derivedChangedPaths = result.changed_paths || [];
    try {
      if (!digestPattern.test(result.workspace_identity || '')) throw new Error('invalid workspace identity');
      if (workspaceIdentities.has(result.workspace_identity)) {
        conflicts.push(`reused isolated workspace: ${result.branch_id}`);
      }
      workspaceIdentities.add(result.workspace_identity);
      const baselineFiles = validateSnapshotFiles(
        result.baseline_files,
        `branch ${result.branch_id} baseline_files`,
      );
      const currentFiles = validateSnapshotFiles(
        result.current_files,
        `branch ${result.branch_id} current_files`,
      );
      validatePhysicalFiles(
        result.baseline_physical_files,
        baselineFiles,
        `branch ${result.branch_id} baseline_physical_files`,
      );
      const currentPhysicalFiles = validatePhysicalFiles(
        result.current_physical_files,
        currentFiles,
        `branch ${result.branch_id} current_physical_files`,
      );
      for (const item of currentPhysicalFiles) {
        const identity = `${item.dev}:${item.ino}`;
        const owner = currentPhysicalOwners.get(identity);
        if (owner && owner !== result.branch_id) {
          conflicts.push(`shared physical file identity: ${owner}/${result.branch_id}`);
        } else {
          currentPhysicalOwners.set(identity, result.branch_id);
        }
      }
      if (snapshotDigest(baselineFiles) !== result.baseline_fingerprint) {
        conflicts.push(`baseline snapshot digest mismatch: ${result.branch_id}`);
      }
      if (canonicalBaseline === null) canonicalBaseline = baselineFiles;
      else if (!sameValue(canonicalBaseline, baselineFiles)) {
        conflicts.push(`branch baselines differ: ${result.branch_id}`);
      }
      derivedChangedPaths = changedSnapshotPaths(baselineFiles, currentFiles);
      if (!sameValue(result.changed_paths, derivedChangedPaths)) {
        conflicts.push(`changed paths do not match filesystem evidence: ${result.branch_id}`);
      }
    } catch {
      conflicts.push(`invalid filesystem evidence: ${result.branch_id}`);
    }
    for (const changedPath of derivedChangedPaths) {
      if (!branch.allowed_paths.some((scope) => pathWithinScope(changedPath, scope))) {
        conflicts.push(`path outside scope ${changedPath}: ${result.branch_id}`);
      }
    }
  }
  const missing = [...expected.keys()].filter((id) => !seen.has(id)).sort();
  missing.forEach((id) => conflicts.push(`missing branch: ${id}`));
  for (let left = 0; left < results.length; left += 1) {
    for (let right = left + 1; right < results.length; right += 1) {
      const overlap = (results[left].changed_paths || []).find((path) =>
        (results[right].changed_paths || []).some((candidate) =>
          pathWithinScope(path, candidate) || pathWithinScope(candidate, path)));
      if (overlap) conflicts.push(`changed-path conflict ${overlap}: ${results[left].branch_id}/${results[right].branch_id}`);
    }
  }
  const authorizedChangedPaths = [...new Set(results.flatMap((result) => result.changed_paths || []))].sort();
  if (canonicalBaseline !== null) {
    const integratedChangedPaths = changedSnapshotPaths(canonicalBaseline, validatedIntegrated);
    if (!sameValue(authorizedChangedPaths, integratedChangedPaths)) {
      conflicts.push('integrated changed paths do not exactly match the authorized branch union');
    }
    const integratedByPath = new Map(validatedIntegrated.map((entry) => [entry.path, entry]));
    for (const result of results) {
      const currentByPath = new Map((result.current_files || []).map((entry) => [entry.path, entry]));
      for (const changedPath of result.changed_paths || []) {
        if (!sameValue(currentByPath.get(changedPath) ?? null, integratedByPath.get(changedPath) ?? null)) {
          conflicts.push(`integrated content differs for ${changedPath}: ${result.branch_id}`);
        }
      }
    }
  }
  if (!verificationNamesMatch(aggregateVerification, node.verification)) {
    conflicts.push('aggregate verification names do not match contract');
  }
  if (!validAggregateVerification(aggregateVerification, currentFingerprint)) {
    conflicts.push('aggregate verification is not bound to the integrated snapshot');
  }
  if (!verificationPassed(aggregateVerification)) conflicts.push('aggregate verification missing or failed');
  const result = {
    schema_version: 1,
    node_id: node.id,
    status: missing.length ? 'missing_evidence' : (conflicts.length ? 'rejected' : 'accepted'),
    baseline_fingerprint: baselineFingerprint,
    worktree_fingerprint: currentFingerprint,
    integrated_snapshot_digest: currentFingerprint,
    integrated_files: validatedIntegrated,
    authorized_changed_paths: authorizedChangedPaths,
    branches: results,
    conflicts: [...new Set(conflicts)].sort(),
    aggregate_verification: clone(aggregateVerification),
  };
  assertContract('Invalid aggregation result', validateAggregationResult(result));
  return result;
}

const finishEvaluation = (nodeState, terminalState) => {
  nodeState.evaluation.terminal_state = terminalState;
  nodeState.terminal_state = terminalState;
  nodeState.status = terminalState === 'accepted'
    ? 'completed'
    : (['missing_evidence', 'human_decision_required'].includes(terminalState) ? 'blocked' : 'failed');
};

const applyEvaluation = (state, node, nodeState, event) => {
  const result = event.payload;
  assertContract('Invalid evaluation result', validateEvaluationResult(result));
  if (result.node_id !== node.id) throw new Error('Evaluation result node_id does not match event node_id.');
  if (result.evaluator.role !== node.evaluator_role) throw new Error('Evaluation result came from the wrong evaluator role.');
  if (result.worktree_fingerprint !== event.worktree_fingerprint) {
    throw new Error('Evaluation result is stale for the event worktree fingerprint.');
  }
  const artifacts = [...event.artifact_refs].sort();
  const expectedArtifacts = [...node.expected_artifacts].sort();
  if ((result.verdict === 'pass' && !sameValue(artifacts, expectedArtifacts))
    || (result.verdict !== 'pass' && artifacts.some((artifact) => !expectedArtifacts.includes(artifact)))) {
    throw new Error('Evaluation artifacts do not match expected_artifacts.');
  }
  const artifactDigests = validateArtifactDigests(result.artifact_digests, artifacts, 'evaluation');
  if (!sameValue(artifacts, artifactDigests.map((item) => item.artifact_ref).sort())) {
    throw new Error('Evaluation artifact references do not match their actual-byte digests.');
  }
  consumeUsage(state, nodeState, node.budget, result, 'evaluation');
  const evaluation = nodeState.evaluation;
  evaluation.iterations += 1;
  evaluation.cost_units += result.cost_units;
  evaluation.duration_ms += result.duration_ms;
  evaluation.last_result = clone(result);
  nodeState.worktree_fingerprint = result.worktree_fingerprint;
  nodeState.artifact_refs = [...event.artifact_refs];
  nodeState.artifact_digests = artifactDigests;
  if (!result.evidence.length || !event.artifact_refs.length || result.failure_class === 'missing_evidence') {
    finishEvaluation(nodeState, 'missing_evidence');
  } else if (result.verdict === 'pass') {
    finishEvaluation(nodeState, 'accepted');
  } else if (result.verdict === 'blocked') {
    finishEvaluation(nodeState, 'human_decision_required');
  } else {
    evaluation.failure_counts[result.failure_class] = (evaluation.failure_counts[result.failure_class] || 0) + 1;
    if (!result.retryable) finishEvaluation(nodeState, 'rejected');
    else if (!localBudgetAvailable(nodeState, node.budget)
      || state.remaining_budget.cost <= 0 || state.remaining_budget.duration_ms <= 0) {
      finishEvaluation(nodeState, 'budget_exhausted');
    } else if (evaluation.failure_counts[result.failure_class] >= node.budget.stuck_failure_limit) {
      finishEvaluation(nodeState, 'stuck_same_failure');
    } else if (evaluation.iterations >= node.budget.max_iterations) {
      finishEvaluation(nodeState, 'iteration_limit');
    } else if (state.remaining_budget.attempts <= 0) {
      finishEvaluation(nodeState, 'budget_exhausted');
    } else if (nodeState.attempts >= node.retry_limit + 1) {
      finishEvaluation(nodeState, 'iteration_limit');
    } else {
      nodeState.status = 'ready';
    }
  }
};

const semanticTimestamp = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, offsetHour = '00', offsetMinute = '00'] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > daysInMonth
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || Number(offsetHour) > 14 || Number(offsetMinute) > 59
    || (Number(offsetHour) === 14 && Number(offsetMinute) !== 0)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
};

const assertEventIntegrity = (state, compiled, event) => {
  assertContract('Invalid workflow event', validateWorkflowEvent(event));
  if (event.workflow_id !== compiled.plan.workflow_id) throw new Error('Event workflow_id does not match the plan.');
  if (event.sequence !== state.sequence + 1) throw new Error(`Event sequence must be ${state.sequence + 1}.`);
  if (event.previous_event_digest !== state.last_event_digest) throw new Error('Event digest chain is discontinuous.');
  if (event.payload_digest !== digestValue(event.payload)) throw new Error('Event payload digest is invalid.');
  const { event_digest: recordedDigest, ...unsigned } = event;
  if (recordedDigest !== digestValue(unsigned)) throw new Error('Event digest is invalid.');
  const recordedAt = semanticTimestamp(event.recorded_at);
  if (recordedAt === null) throw new Error('Event recorded_at is not a semantic ISO-8601 timestamp.');
  if (state.last_recorded_at !== null && recordedAt < semanticTimestamp(state.last_recorded_at)) {
    throw new Error('Event recorded_at regresses relative to the journal tail.');
  }
};

const recordCapabilityDecision = (node, nodeState, event) => {
  if (event.producer.role !== 'capability-broker') throw new Error('Capability events are broker-only.');
  const payload = event.payload;
  const { decision_digest: recordedDigest, ...unsigned } = payload;
  if (recordedDigest !== digestValue(unsigned)) throw new Error('Capability decision digest is invalid.');
  if (nodeState.capability_decisions[recordedDigest]) throw new Error('Capability decision digest is already recorded.');
  const sameRequest = Object.values(nodeState.capability_decisions)
    .find((record) => record.payload.request_id === payload.request_id);
  if (sameRequest && (sameRequest.payload.request_digest !== payload.request_digest
    || sameRequest.payload.idempotency_key !== payload.idempotency_key
    || sameRequest.payload.capability_type !== payload.capability_type)) {
    throw new Error('Capability request_id is already bound to a different request.');
  }
  if (payload.decision === 'authorized' && node.kind === 'external-action') {
    if (payload.capability_type !== CAPABILITY_FOR_ACTION[node.action]) {
      throw new Error('Authorized capability type does not match the external action.');
    }
    if (payload.idempotency_key !== node.idempotency_key) {
      throw new Error('Authorized capability idempotency key does not match the external action.');
    }
  }
  nodeState.capability_decisions[recordedDigest] = {
    sequence: event.sequence,
    worktree_fingerprint: event.worktree_fingerprint,
    payload: clone(payload),
  };
};

const recordCapabilityOutcome = (nodeState, event) => {
  if (event.producer.role !== 'capability-broker') throw new Error('Capability events are broker-only.');
  const payload = event.payload;
  const { outcome_digest: recordedDigest, ...unsigned } = payload;
  if (recordedDigest !== digestValue(unsigned)) throw new Error('Capability outcome digest is invalid.');
  if (nodeState.capability_outcomes.some((record) => record.payload.outcome_digest === recordedDigest)) {
    throw new Error('Capability outcome digest is already recorded.');
  }
  const decision = nodeState.capability_decisions[payload.decision_digest]?.payload;
  if (!decision || decision.decision !== 'authorized') {
    throw new Error('Capability outcome must reference a preceding authorized decision on the same node.');
  }
  for (const field of ['request_id', 'idempotency_key', 'capability_type', 'request_digest']) {
    if (payload[field] !== decision[field]) throw new Error(`Capability outcome ${field} does not match its decision.`);
  }
  const prior = nodeState.capability_outcomes.filter((record) =>
    record.payload.decision_digest === payload.decision_digest);
  const succeeded = prior.find((record) => record.payload.status === 'succeeded');
  if (payload.status === 'succeeded' && prior.length > 0) {
    throw new Error('A capability decision can have only one executed outcome.');
  }
  if (payload.status === 'failed' && prior.length > 0) {
    throw new Error('A capability decision can have only one executed outcome.');
  }
  if (payload.status === 'deduplicated') {
    if (!succeeded) throw new Error('Deduplicated outcome requires a prior succeeded outcome for the same decision.');
    if (payload.external_reference !== succeeded.payload.external_reference) {
      throw new Error('Deduplicated outcome must preserve the prior external reference.');
    }
  }
  if (['succeeded', 'deduplicated'].includes(payload.status)
    && EXTERNAL_CAPABILITIES.has(payload.capability_type)
    && (typeof payload.external_reference !== 'string' || payload.external_reference.length === 0)) {
    throw new Error('Successful external capability outcome requires a nonempty external reference.');
  }
  nodeState.capability_outcomes.push({
    sequence: event.sequence,
    worktree_fingerprint: event.worktree_fingerprint,
    payload: clone(payload),
  });
};

const matchingExternalOutcome = (node, nodeState, event) => {
  const capabilityType = CAPABILITY_FOR_ACTION[node.action];
  return [...nodeState.capability_outcomes].reverse().find((record) => {
    const payload = record.payload;
    const decision = nodeState.capability_decisions[payload.decision_digest]?.payload;
    return ['succeeded', 'deduplicated'].includes(payload.status)
      && decision?.decision === 'authorized'
      && payload.capability_type === capabilityType
      && payload.idempotency_key === node.idempotency_key
      && payload.request_id === decision.request_id
      && payload.request_digest === decision.request_digest
      && record.worktree_fingerprint === event.worktree_fingerprint;
  });
};

const budgetIsExhausted = (node, nodeState, state) => {
  if (state.remaining_budget.cost <= 0 || state.remaining_budget.duration_ms <= 0) return true;
  if (!localBudgetAvailable(nodeState, node.budget)) return true;
  if (nodeState.status === 'ready' && state.remaining_budget.attempts <= 0) return true;
  if (node.kind === 'evaluate-optimize' && nodeState.evaluation.iterations >= node.budget.max_iterations) return true;
  if (node.kind === 'parallel') {
    return Object.entries(nodeState.branches).some(([branchId, branchState]) => {
      const branch = node.branches.find((candidate) => candidate.id === branchId);
      return ['ready', 'failed'].includes(branchState.status)
        && (state.remaining_budget.attempts <= 0 || !localBudgetAvailable(branchState, branch.budget));
    });
  }
  return false;
};

export function reduceWorkflowEvent(compiled, previousState, event) {
  const state = clone(previousState);
  if (state.schema_version !== 1
    || state.workflow_id !== compiled.plan.workflow_id
    || state.plan_digest !== compiled.plan_digest) {
    throw new Error('Workflow state is not bound to the compiled plan.');
  }
  assertEventIntegrity(state, compiled, event);
  if (event.event_type === 'workflow.started') {
    exactPayload(event, []);
    if (state.status !== 'pending' || event.sequence !== 1) throw new Error('workflow.started must be the first event.');
    if (event.worktree_fingerprint !== compiled.plan.baseline_fingerprint) {
      throw new Error('workflow.started worktree fingerprint must match the compiled baseline.');
    }
    state.status = 'running';
    state.started_at = event.recorded_at;
    refreshReadiness(compiled, state);
  } else if (event.event_type === 'worktree.changed') {
    exactPayload(event, []);
    if (state.status === 'pending') throw new Error('worktree.changed cannot precede workflow.started.');
    if (!digestPattern.test(event.worktree_fingerprint || '')) throw new Error('worktree.changed requires a fingerprint.');
    const stale = compiled.plan.nodes
      .filter((node) => state.nodes[node.id].status === 'completed'
        && state.nodes[node.id].worktree_fingerprint !== event.worktree_fingerprint)
      .map((node) => node.id);
    stale.forEach((id) => invalidateFrom(compiled, state, id));
    refreshWorkflowStatus(compiled, state);
  } else {
    if (state.status === 'pending') throw new Error('workflow.started must precede node events.');
    const [node, nodeState] = requireNode(compiled, state, event);
    if (event.event_type === 'node.started') {
      exactPayload(event, ['input_refs']);
      requireStatus(node.id, nodeState, ['ready'], 'start');
      if (!nodeCanStart(node, nodeState, state)) throw new Error(`Cannot start ${node.id}; execution budget or retry limit is exhausted.`);
      nodeState.input_refs = assertInputRefs(state, node, event.payload.input_refs, `node ${node.id}`);
      consumeAttempt(state, nodeState, node.retry_limit + 1, `node ${node.id}`);
      nodeState.status = 'running';
      if (node.kind === 'parallel') {
        Object.values(nodeState.branches).forEach((branch) => { if (branch.status === 'pending') branch.status = 'ready'; });
      }
    } else if (event.event_type === 'node.completed') {
      requireStatus(node.id, nodeState, ['running'], 'complete');
      if (['parallel', 'evaluate-optimize'].includes(node.kind)) throw new Error(`${node.kind} nodes use their typed completion event.`);
      const artifacts = validateOutput(node, event);
      if (node.kind === 'external-action') {
        const capability = matchingExternalOutcome(node, nodeState, event);
        if (!capability) throw new Error('external-action completion requires a successful linked matching capability outcome.');
        nodeState.successful_capability_outcome_digest = capability.payload.outcome_digest;
      }
      consumeUsage(state, nodeState, node.budget, event.payload, `node ${node.id} completion`);
      nodeState.status = 'completed';
      nodeState.artifact_refs = artifacts.map((item) => item.artifact_ref);
      nodeState.artifact_digests = artifacts;
      nodeState.worktree_fingerprint = event.worktree_fingerprint;
    } else if (event.event_type === 'node.failed') {
      exactPayload(event, ['failure_class', 'cost_units', 'duration_ms']);
      requireStatus(node.id, nodeState, ['running'], 'fail');
      if (typeof event.payload.failure_class !== 'string' || !event.payload.failure_class) {
        throw new Error('node.failed requires payload.failure_class.');
      }
      consumeUsage(state, nodeState, node.budget, event.payload, `node ${node.id} failure`);
      nodeState.status = 'failed';
      nodeState.terminal_state = 'rejected';
    } else if (event.event_type === 'node.invalidated') {
      exactPayload(event, ['reason']);
      requireStatus(node.id, nodeState, ['completed', 'failed', 'blocked'], 'invalidate');
      if (typeof event.payload.reason !== 'string' || !event.payload.reason) throw new Error('node.invalidated requires a reason.');
      invalidateFrom(compiled, state, node.id);
    } else if (event.event_type === 'parallel.branch.started') {
      exactPayload(event, [
        'branch_id', 'input_refs', 'baseline_fingerprint', 'workspace_identity',
        'workspace_root', 'baseline_files', 'baseline_physical_files',
      ]);
      requireStatus(node.id, nodeState, ['running'], 'start branch for');
      if (node.kind !== 'parallel') throw new Error('Branch events require a parallel node.');
      const branch = node.branches.find((candidate) => candidate.id === event.payload.branch_id);
      const branchState = nodeState.branches[event.payload.branch_id];
      if (!branch || !branchState) throw new Error(`Unknown parallel branch: ${event.payload.branch_id}`);
      requireStatus(branch.id, branchState, ['ready'], 'start');
      const inputs = assertInputRefs(state, node, event.payload.input_refs, `branch ${branch.id}`);
      if (!sameValue(inputs, branch.dependency_inputs)) {
        throw new Error(`Branch ${branch.id} dependency_inputs do not match the plan.`);
      }
      if (branch.baseline_fingerprint !== compiled.plan.baseline_fingerprint) {
        throw new Error(`Branch ${branch.id} baseline does not match the workflow baseline.`);
      }
      if (event.payload.baseline_fingerprint !== branch.baseline_fingerprint
        || event.payload.baseline_fingerprint !== event.worktree_fingerprint) {
        throw new Error(`Branch ${branch.id} start evidence does not match its worktree baseline.`);
      }
      if (!digestPattern.test(event.payload.workspace_identity || '')
        || typeof event.payload.workspace_root !== 'string'
        || event.payload.workspace_root.length === 0) {
        throw new Error(`Branch ${branch.id} start requires an isolated workspace identity and root.`);
      }
      const baselineFiles = validateSnapshotFiles(
        event.payload.baseline_files,
        `branch ${branch.id} baseline_files`,
      );
      const baselinePhysicalFiles = validatePhysicalFiles(
        event.payload.baseline_physical_files,
        baselineFiles,
        `branch ${branch.id} baseline_physical_files`,
      );
      if (snapshotDigest(baselineFiles) !== event.payload.baseline_fingerprint) {
        throw new Error(`Branch ${branch.id} baseline files do not match its baseline fingerprint.`);
      }
      if (Object.values(nodeState.branches).some((candidate) =>
        candidate !== branchState && candidate.workspace_identity === event.payload.workspace_identity)) {
        throw new Error(`Branch ${branch.id} cannot reuse a sibling's isolated workspace.`);
      }
      if (!branchCanStart(branch, branchState, state)) throw new Error(`Cannot start branch ${branch.id}; budget or retry limit is exhausted.`);
      consumeAttempt(state, branchState, branch.retry_limit + 1, `branch ${branch.id}`);
      branchState.input_refs = inputs;
      branchState.baseline_fingerprint = event.payload.baseline_fingerprint;
      branchState.workspace_identity = event.payload.workspace_identity;
      branchState.workspace_root = event.payload.workspace_root;
      branchState.baseline_files = baselineFiles;
      branchState.baseline_physical_files = baselinePhysicalFiles;
      branchState.status = 'running';
    } else if (event.event_type === 'parallel.branch.completed') {
      exactPayload(event, [
        'branch_id', 'status', 'baseline_fingerprint', 'changed_paths', 'artifact_refs', 'artifact_digests',
        'verification', 'failure_class', 'cost_units', 'duration_ms', 'workspace_identity',
        'baseline_files', 'current_files', 'baseline_physical_files', 'current_physical_files',
      ]);
      if (node.kind !== 'parallel') throw new Error('Branch events require a parallel node.');
      const result = event.payload;
      const branch = node.branches.find((candidate) => candidate.id === result.branch_id);
      const branchState = nodeState.branches[result.branch_id];
      if (!branch || !branchState) throw new Error(`Unknown parallel branch: ${result.branch_id}`);
      requireStatus(result.branch_id, branchState, ['running'], 'complete');
      if (!['passed', 'failed'].includes(result.status)) throw new Error('Branch result status must be passed or failed.');
      if (!validVerificationChecks(result.verification)) throw new Error(`Branch ${branch.id} verification is invalid.`);
      if (result.baseline_fingerprint !== compiled.plan.baseline_fingerprint
        || result.baseline_fingerprint !== branch.baseline_fingerprint
        || result.baseline_fingerprint !== branchState.baseline_fingerprint) {
        throw new Error(`Branch ${branch.id} completed against a stale baseline.`);
      }
      if (result.workspace_identity !== branchState.workspace_identity
        || !sameValue(result.baseline_files, branchState.baseline_files)
        || !sameValue(result.baseline_physical_files, branchState.baseline_physical_files)) {
        throw new Error(`Branch ${branch.id} completion does not match its isolated workspace baseline.`);
      }
      const baselineFiles = validateSnapshotFiles(result.baseline_files, `branch ${branch.id} baseline_files`);
      const currentFiles = validateSnapshotFiles(result.current_files, `branch ${branch.id} current_files`);
      validatePhysicalFiles(
        result.baseline_physical_files,
        baselineFiles,
        `branch ${branch.id} baseline_physical_files`,
      );
      validatePhysicalFiles(
        result.current_physical_files,
        currentFiles,
        `branch ${branch.id} current_physical_files`,
      );
      const derivedChangedPaths = changedSnapshotPaths(baselineFiles, currentFiles);
      if (!sameValue(result.changed_paths, derivedChangedPaths)) {
        throw new Error(`Branch ${branch.id} changed_paths do not match canonical filesystem evidence.`);
      }
      if (!verificationNamesMatch(result.verification, branch.verification)) {
        throw new Error(`Branch ${branch.id} verification names do not match the plan.`);
      }
      if (result.status === 'passed' && !verificationPassed(result.verification)) {
        throw new Error(`Passing branch ${branch.id} requires passing verification.`);
      }
      if (result.status === 'passed' ? result.failure_class !== null
        : typeof result.failure_class !== 'string' || !result.failure_class) {
        throw new Error(`Branch ${branch.id} failure_class is inconsistent with its status.`);
      }
      if (derivedChangedPaths.some((changedPath) =>
        !branch.allowed_paths.some((scope) => pathWithinScope(changedPath, scope)))) {
        throw new Error(`Branch ${branch.id} changed a path outside its scope.`);
      }
      const expectedArtifacts = result.status === 'passed' ? branch.expected_artifacts : result.artifact_refs;
      const artifacts = validateArtifactDigests(result.artifact_digests, expectedArtifacts, `branch ${branch.id}`);
      if (!sameValue([...result.artifact_refs].sort(), artifacts.map((item) => item.artifact_ref).sort())
        || !sameValue([...event.artifact_refs].sort(), [...result.artifact_refs].sort())) {
        throw new Error(`Branch ${branch.id} artifact references do not match their digests.`);
      }
      if (event.worktree_fingerprint !== snapshotDigest(currentFiles)) {
        throw new Error('Branch completion fingerprint does not match its isolated workspace snapshot.');
      }
      consumeUsage(state, branchState, branch.budget, result, `branch ${branch.id}`);
      branchState.artifact_digests = artifacts;
      branchState.result = clone(result);
      branchState.status = result.status === 'passed' ? 'completed' : 'failed';
    } else if (event.event_type === 'parallel.branch.retry_requested') {
      exactPayload(event, ['branch_id', 'failure_class']);
      if (node.kind !== 'parallel') throw new Error('Branch retry requires a parallel node.');
      const branch = node.branches.find((candidate) => candidate.id === event.payload.branch_id);
      const branchState = nodeState.branches[event.payload.branch_id];
      if (!branch || !branchState) throw new Error(`Unknown parallel branch: ${event.payload.branch_id}`);
      requireStatus(branch.id, branchState, ['failed'], 'retry');
      if (event.payload.failure_class !== branchState.result?.failure_class) {
        throw new Error(`Branch ${branch.id} retry failure_class does not match its result.`);
      }
      if (!branchCanStart(branch, branchState, state)) throw new Error(`Cannot retry branch ${branch.id}; budget or retry limit is exhausted.`);
      branchState.status = 'ready';
      branchState.artifact_digests = [];
      branchState.baseline_fingerprint = null;
      branchState.workspace_identity = null;
      branchState.workspace_root = null;
      branchState.baseline_files = [];
      branchState.baseline_physical_files = [];
      branchState.result = null;
    } else if (event.event_type === 'parallel.aggregated') {
      exactPayload(event, [
        'output_schema', 'artifact_digests', 'aggregate_verification', 'integrated_snapshot_digest',
        'integrated_files', 'authorized_changed_paths', 'cost_units', 'duration_ms',
      ]);
      requireStatus(node.id, nodeState, ['running'], 'aggregate');
      if (node.kind !== 'parallel') throw new Error('parallel.aggregated requires a parallel node.');
      if (event.payload.output_schema !== 'aggregation-result-v1' || node.output_schema !== 'aggregation-result-v1') {
        throw new Error('parallel.aggregated requires output_schema aggregation-result-v1.');
      }
      if (event.payload.integrated_snapshot_digest !== event.worktree_fingerprint) {
        throw new Error('Parallel aggregation snapshot digest does not match its event fingerprint.');
      }
      const results = Object.values(nodeState.branches).map((branch) => branch.result).filter(Boolean);
      const aggregation = aggregateParallel(
        node,
        results,
        compiled.plan.baseline_fingerprint,
        event.worktree_fingerprint,
        event.payload.aggregate_verification,
        event.payload.integrated_files,
      );
      if (!sameValue(event.payload.authorized_changed_paths, aggregation.authorized_changed_paths)) {
        throw new Error('Parallel aggregation changed paths do not match the authorized branch union.');
      }
      if (aggregation.status === 'missing_evidence') throw new Error('Cannot aggregate while required branch evidence is missing.');
      const artifacts = validateArtifactDigests(event.payload.artifact_digests, node.expected_artifacts, 'parallel aggregation');
      if (!sameValue(event.artifact_refs, artifacts.map((item) => item.artifact_ref).sort())) {
        throw new Error('Parallel aggregation artifact_refs do not match artifact_digests.');
      }
      if (!digestPattern.test(event.worktree_fingerprint || '')) throw new Error('Parallel aggregation requires a worktree fingerprint.');
      consumeUsage(state, nodeState, node.budget, event.payload, `parallel node ${node.id} aggregation`);
      nodeState.result = aggregation;
      nodeState.artifact_refs = artifacts.map((item) => item.artifact_ref);
      nodeState.artifact_digests = artifacts;
      nodeState.worktree_fingerprint = event.worktree_fingerprint;
      nodeState.status = aggregation.status === 'accepted' ? 'completed' : 'failed';
      nodeState.terminal_state = aggregation.status;
    } else if (event.event_type === 'evaluation.recorded') {
      requireStatus(node.id, nodeState, ['running'], 'evaluate');
      if (node.kind !== 'evaluate-optimize') throw new Error('evaluation.recorded requires an evaluate-optimize node.');
      applyEvaluation(state, node, nodeState, event);
    } else if (event.event_type === 'budget.exhausted') {
      exactPayload(event, ['failure_class']);
      requireStatus(node.id, nodeState, ['ready', 'running'], 'exhaust budget for');
      if (event.payload.failure_class !== 'budget_exhausted') {
        throw new Error('budget.exhausted requires failure_class budget_exhausted.');
      }
      if (!budgetIsExhausted(node, nodeState, state)) throw new Error('budget.exhausted is not derived from authoritative budget state.');
      if (node.kind === 'evaluate-optimize') finishEvaluation(nodeState, 'budget_exhausted');
      else {
        nodeState.status = 'failed';
        nodeState.terminal_state = 'budget_exhausted';
      }
    } else if (event.event_type === 'capability.decision') {
      requireStatus(node.id, nodeState, ['running'], 'record capability decision for');
      recordCapabilityDecision(node, nodeState, event);
      nodeState.latest_capability_event = {
        event_type: event.event_type,
        sequence: event.sequence,
        payload: clone(event.payload),
      };
      nodeState.capability_event_count += 1;
    } else if (event.event_type === 'capability.outcome') {
      requireStatus(node.id, nodeState, ['running'], 'record capability outcome for');
      recordCapabilityOutcome(nodeState, event);
      nodeState.latest_capability_event = {
        event_type: event.event_type,
        sequence: event.sequence,
        payload: clone(event.payload),
      };
      nodeState.capability_event_count += 1;
    } else {
      throw new Error(`Unsupported workflow transition: ${event.event_type}`);
    }
    nodeState.last_event_sequence = event.sequence;
    refreshReadiness(compiled, state);
    refreshWorkflowStatus(compiled, state);
  }
  state.sequence = event.sequence;
  state.last_event_digest = event.event_digest;
  state.last_recorded_at = event.recorded_at;
  return state;
}

export function legalTransitions(compiled, state) {
  if (state.status === 'pending') return [{ event_type: 'workflow.started', node_id: null }];
  const transitions = [{ event_type: 'worktree.changed', node_id: null }];
  for (const node of compiled.plan.nodes) {
    const current = state.nodes[node.id];
    if (current.status === 'ready') {
      if (nodeCanStart(node, current, state)) transitions.push({ event_type: 'node.started', node_id: node.id });
      else if (budgetIsExhausted(node, current, state)) transitions.push({ event_type: 'budget.exhausted', node_id: node.id });
    }
    if (current.status === 'running') {
      transitions.push({ event_type: 'capability.decision', node_id: node.id });
      if (Object.values(current.capability_decisions).some((record) => record.payload.decision === 'authorized')) {
        transitions.push({ event_type: 'capability.outcome', node_id: node.id });
      }
      if (node.kind === 'parallel') {
        for (const branch of node.branches) {
          const branchState = current.branches[branch.id];
          if (branchState.status === 'ready' && branchCanStart(branch, branchState, state)) {
            transitions.push({ event_type: 'parallel.branch.started', node_id: node.id, branch_id: branch.id });
          }
          if (branchState.status === 'running') {
            transitions.push({ event_type: 'parallel.branch.completed', node_id: node.id, branch_id: branch.id });
          }
          if (branchState.status === 'failed' && branchCanStart(branch, branchState, state)) {
            transitions.push({ event_type: 'parallel.branch.retry_requested', node_id: node.id, branch_id: branch.id });
          }
        }
        if (Object.values(current.branches).every((branch) => branch.result !== null)) {
          transitions.push({ event_type: 'parallel.aggregated', node_id: node.id });
        }
      } else if (node.kind === 'evaluate-optimize') {
        transitions.push({ event_type: 'evaluation.recorded', node_id: node.id });
      } else {
        transitions.push(
          { event_type: 'node.completed', node_id: node.id },
          { event_type: 'node.failed', node_id: node.id },
        );
      }
      if (budgetIsExhausted(node, current, state)) transitions.push({ event_type: 'budget.exhausted', node_id: node.id });
    }
    if (['completed', 'failed', 'blocked'].includes(current.status)) {
      transitions.push({ event_type: 'node.invalidated', node_id: node.id });
    }
  }
  return transitions;
}

export { canonicalJson };
