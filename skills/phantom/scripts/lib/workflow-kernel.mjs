// Author: Subash Karki
// Pure compiler and reducer for Phantom's fresh v2 workflow contract.

import {
  AGGREGATION_RESULT_SCHEMA_VERSION,
  WORKFLOW_PLAN_SCHEMA_VERSION,
  WorkflowContractError,
  assertContract,
  canonicalJson,
  digestValue,
  pathWithinScope,
  validateAggregationResult,
  validateEvaluationResult,
  validateWorkflowEvent,
  validateWorkflowPlan,
} from './workflow-contracts.mjs';
import {
  validateWorkspaceTransitionEvidence,
  validateExecutorBinding,
  verifyExecutionReceipt,
} from './isolated-executor-attestation.mjs';

const clone = (value) => structuredClone(value);
export const compareCodeUnits = (left, right) => (left < right ? -1 : (left > right ? 1 : 0));
const byId = (left, right) => compareCodeUnits(left.id, right.id);
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const EXTERNAL_CAPABILITIES = new Set(['git.push', 'github.openDraftPr', 'tracker.comment']);
const SIGNED_HOST_CAPABILITIES = new Set([
  'process.exec', 'git.commit', 'git.push', 'github.openDraftPr', 'tracker.comment',
]);
const WORKTREE_MUTATING_CAPABILITIES = new Set(['workspace.write', 'process.exec']);
const CAPABILITY_FOR_ACTION = Object.freeze({
  'draft-pr': 'github.openDraftPr',
  'git-push': 'git.push',
  'tracker-comment': 'tracker.comment',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameValue = (left, right) => canonicalJson(left) === canonicalJson(right);
const sortCanonical = (values) => [...values]
  .sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right)));

const normalizeNode = (node) => {
  const normalized = clone(node);
  normalized.depends_on = [...normalized.depends_on].sort(compareCodeUnits);
  for (const field of ['allowed_paths', 'allowed_cwds', 'expected_artifacts', 'sources', 'verification']) {
    if (normalized[field]) normalized[field] = [...normalized[field]].sort(compareCodeUnits);
  }
  if (normalized.allowed_commands) normalized.allowed_commands = sortCanonical(normalized.allowed_commands);
  if (normalized.branches) {
    normalized.branches = normalized.branches.map((branch) => ({
      ...branch,
      dependency_inputs: sortCanonical(branch.dependency_inputs),
      allowed_paths: [...branch.allowed_paths].sort(compareCodeUnits),
      expected_artifacts: [...branch.expected_artifacts].sort(compareCodeUnits),
      verification: [...branch.verification].sort(compareCodeUnits),
    })).sort(byId);
  }
  return normalized;
};

const nodeHasRole = (node, role, phase) => {
  if (node.kind === 'task') return node.role === role;
  if (node.kind === 'parallel') return node.branches.some((branch) => branch.role === role);
  if (node.kind !== 'evaluate-optimize') return false;
  return phase === 'produce' ? node.generator_role === role : node.evaluator_role === role;
};

const transitivelyDependsOn = (nodesById, nodeId, dependencyId) => {
  const pending = [...(nodesById.get(nodeId)?.depends_on ?? [])];
  const visited = new Set();
  while (pending.length) {
    const candidate = pending.pop();
    if (candidate === dependencyId) return true;
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    pending.push(...(nodesById.get(candidate)?.depends_on ?? []));
  }
  return false;
};

const fullRouteTopologyErrors = (plan) => {
  if (plan.route !== 'full') return [];
  const nodesById = new Map(plan.nodes.map((node) => [node.id, node]));
  const implementation = plan.nodes.filter((node) => nodeHasRole(node, 'blade', 'produce'));
  if (implementation.length === 0) {
    return ['$.nodes: full route requires a non-Apex implementation producer'];
  }
  const verification = plan.nodes.filter((node) => nodeHasRole(node, 'ward', 'evaluate'));
  const orderedVerification = verification.filter((ward) =>
    implementation.some((producer) => transitivelyDependsOn(nodesById, ward.id, producer.id)));
  if (orderedVerification.length === 0) {
    return ['$.nodes: full route requires an independent Ward verification gate after implementation'];
  }
  const review = plan.nodes.filter((node) => nodeHasRole(node, 'gaze', 'evaluate'));
  if (!review.some((gaze) =>
    orderedVerification.some((ward) => transitivelyDependsOn(nodesById, gaze.id, ward.id)))) {
    return ['$.nodes: full route requires an independent Gaze review gate after Ward verification'];
  }
  return [];
};

const graphErrors = (plan) => {
  const errors = [];
  const hasParallel = plan.nodes.some((node) => node.kind === 'parallel');
  if (hasParallel && plan.executor_binding === undefined) {
    errors.push('$.executor_binding: required for attested parallel execution');
  } else if (!hasParallel && plan.executor_binding !== undefined) {
    errors.push('$.executor_binding: unsupported without a parallel node');
  } else if (plan.executor_binding !== undefined) {
    try {
      validateExecutorBinding(plan.executor_binding);
      if (plan.executor_binding.baseline_fingerprint !== plan.baseline_fingerprint) {
        errors.push('$.executor_binding.baseline_fingerprint: must match workflow baseline');
      }
    } catch (error) {
      errors.push(`$.executor_binding: ${error.message}`);
    }
  }
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
  errors.push(...fullRouteTopologyErrors(plan));
  return errors;
};

const topologicalWaves = (nodes) => {
  const remaining = new Map(nodes.map((node) => [node.id, new Set(node.depends_on)]));
  const waves = [];
  while (remaining.size) {
    const wave = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([id]) => id)
      .sort(compareCodeUnits);
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
    schema_version: WORKFLOW_PLAN_SCHEMA_VERSION,
    plan: normalized,
    plan_digest: digestValue(normalized),
    topological_order: executionWaves.flat(),
    execution_waves: executionWaves,
  };
}

const copyFailureCounts = (source = {}) => {
  const counts = Object.create(null);
  for (const [failureClass, count] of Object.entries(source)) {
    Object.defineProperty(counts, failureClass, {
      value: count,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return counts;
};

const evaluationState = () => ({
  iterations: 0,
  cost_units: 0,
  duration_ms: 0,
  failure_counts: copyFailureCounts(),
  terminal_state: null,
  last_result: null,
});

const incrementFailureCount = (counts, failureClass) => {
  const next = (Object.hasOwn(counts, failureClass) ? counts[failureClass] : 0) + 1;
  Object.defineProperty(counts, failureClass, {
    value: next,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return next;
};

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
    run_id: null,
    lease_id: null,
    start_receipt_digest: null,
    completion_receipt_digest: null,
    pending_start_receipt_digest: null,
    baseline_manifest: null,
    teardown_verified: false,
    result: null,
  }];
}));

const assertCompiledSchemaVersion = (compiled) => {
  if (compiled?.schema_version !== WORKFLOW_PLAN_SCHEMA_VERSION) {
    throw new WorkflowContractError('Invalid compiled workflow', [
      `unsupported compiled workflow contract version ${JSON.stringify(compiled?.schema_version)}; expected ${WORKFLOW_PLAN_SCHEMA_VERSION}`,
    ]);
  }
  if (compiled.plan?.schema_version !== WORKFLOW_PLAN_SCHEMA_VERSION) {
    throw new WorkflowContractError('Invalid compiled workflow', [
      `unsupported embedded workflow plan contract version ${JSON.stringify(compiled.plan?.schema_version)}; expected ${WORKFLOW_PLAN_SCHEMA_VERSION}`,
    ]);
  }
};

export function createInitialState(compiled) {
  assertCompiledSchemaVersion(compiled);
  if (compiled.plan_digest !== digestValue(compiled.plan)) {
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
    executor_receipt_replay_ids: [],
    executor_run_ids: [],
    executor_lease_ids: [],
    capability_decision_history: [],
    capability_outcome_history: [],
    current_worktree_fingerprint: null,
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
      reserved_budget: { cost_units: 0, duration_ms: 0 },
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
      ...(node.kind === 'parallel' ? {
        branches: branchStates(node),
        result: null,
        integration_receipt_digest: null,
      } : {}),
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
  const actual = Object.keys(event.payload).sort(compareCodeUnits);
  const expected = [...fields].sort(compareCodeUnits);
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

const reservedBudget = (consumerState) => consumerState.reserved_budget
  ?? { cost_units: 0, duration_ms: 0 };

const consumeUsage = (state, consumerState, budget, usage, label) => {
  validateUsage(usage, label);
  const reserved = reservedBudget(consumerState);
  const nextCost = consumerState.consumed_budget.cost_units + reserved.cost_units + usage.cost_units;
  const nextDuration = consumerState.consumed_budget.duration_ms + reserved.duration_ms + usage.duration_ms;
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

const reserveCapabilityUsage = (state, nodeState, budget, usage) => {
  validateUsage(usage, 'capability reservation');
  if (usage.cost_units < 0.000001 || usage.duration_ms < 1) {
    throw new Error('capability reservation requires a positive cost and duration budget.');
  }
  const reserved = reservedBudget(nodeState);
  const nextCost = nodeState.consumed_budget.cost_units + reserved.cost_units + usage.cost_units;
  const nextDuration = nodeState.consumed_budget.duration_ms + reserved.duration_ms + usage.duration_ms;
  if (nextCost > maxBudget(budget, 'max_cost_units')) {
    throw new Error('capability reservation exceeds its node cost budget.');
  }
  if (nextDuration > maxBudget(budget, 'max_duration_ms')) {
    throw new Error('capability reservation exceeds its node duration budget.');
  }
  if (usage.cost_units > state.remaining_budget.cost) {
    throw new Error('capability reservation exceeds the remaining workflow cost budget.');
  }
  if (usage.duration_ms > state.remaining_budget.duration_ms) {
    throw new Error('capability reservation exceeds the remaining workflow duration budget.');
  }
  nodeState.reserved_budget.cost_units += usage.cost_units;
  nodeState.reserved_budget.duration_ms += usage.duration_ms;
  state.remaining_budget.cost -= usage.cost_units;
  state.remaining_budget.duration_ms -= usage.duration_ms;
};

const chargeCapabilityUsage = (nodeState, usage) => {
  validateUsage(usage, 'capability budget charge');
  const remainingReservedCost = nodeState.reserved_budget.cost_units - usage.cost_units;
  const remainingReservedDuration = nodeState.reserved_budget.duration_ms - usage.duration_ms;
  if (remainingReservedCost < -Number.EPSILON || remainingReservedDuration < 0) {
    throw new Error('capability outcome exceeds its reserved budget.');
  }
  nodeState.reserved_budget.cost_units = Math.max(0, remainingReservedCost);
  nodeState.reserved_budget.duration_ms = remainingReservedDuration;
  nodeState.consumed_budget.cost_units += usage.cost_units;
  nodeState.consumed_budget.duration_ms += usage.duration_ms;
};

const localBudgetAvailable = (consumerState, budget) => {
  const reserved = reservedBudget(consumerState);
  return consumerState.consumed_budget.cost_units + reserved.cost_units
    < maxBudget(budget, 'max_cost_units')
    && consumerState.consumed_budget.duration_ms + reserved.duration_ms
      < maxBudget(budget, 'max_duration_ms');
};

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
  const refs = sorted.map((item) => item?.artifact_ref).sort(compareCodeUnits);
  if (!sameValue(refs, [...expectedArtifacts].sort(compareCodeUnits))) {
    throw new Error(`${label} artifacts do not match expected_artifacts.`);
  }
  if (new Set(refs).size !== refs.length
    || sorted.some((item) => !isObject(item) || Object.keys(item).sort(compareCodeUnits).join(',') !== 'artifact_ref,digest'
      || typeof item.artifact_ref !== 'string' || !digestPattern.test(item.digest || ''))) {
    throw new Error(`${label} contains invalid or duplicate artifact digests.`);
  }
  return sorted;
};

const validateOutput = (node, event, expectedSchema = node.output_schema) => {
  exactPayload(event, ['output_schema', 'artifact_digests', 'cost_units', 'duration_ms']);
  if (event.payload.output_schema !== expectedSchema) throw new Error('Output schema does not match the declared node output_schema.');
  const artifacts = validateArtifactDigests(event.payload.artifact_digests, node.expected_artifacts, 'node completion');
  if (!sameValue(event.artifact_refs, artifacts.map((item) => item.artifact_ref).sort(compareCodeUnits))) {
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
  if (node.kind !== 'external-action') {
    state.capability_decisions = {};
    state.capability_outcomes = [];
    state.successful_capability_outcome_digest = null;
  }
  if (node.kind === 'parallel') {
    state.branches = branchStates(node, state.branches);
    state.result = null;
    state.integration_receipt_digest = null;
  }
  if (node.kind === 'evaluate-optimize') {
    const previous = state.evaluation;
    state.evaluation = {
      ...evaluationState(),
      iterations: previous.iterations,
      cost_units: previous.cost_units,
      duration_ms: previous.duration_ms,
      failure_counts: copyFailureCounts(previous.failure_counts),
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
  && sameValue(
    checks.map((check) => check?.name).sort(compareCodeUnits),
    [...expected].sort(compareCodeUnits),
  );

const validVerificationChecks = (checks) => Array.isArray(checks)
  && checks.every((check) => isObject(check)
    && sameValue(Object.keys(check).sort(compareCodeUnits), ['name', 'result'])
    && typeof check.name === 'string' && check.name.length > 0
    && ['passed', 'failed'].includes(check.result));

const validAggregateVerification = (checks, snapshot) => Array.isArray(checks)
  && checks.every((check) => isObject(check)
    && sameValue(Object.keys(check).sort(compareCodeUnits), ['name', 'result', 'snapshot_digest'])
    && typeof check.name === 'string' && check.name.length > 0
    && ['passed', 'failed'].includes(check.result)
    && check.snapshot_digest === snapshot);

const teardownComplete = (teardown) => isObject(teardown)
  && teardown.tool_lease_revoked === true
  && teardown.process_tree_reaped === true
  && teardown.descendants_remaining === 0
  && teardown.mounts_removed === true
  && teardown.sandbox_destroyed === true;

const receiptExpected = (compiled, nodeId) => ({
  repo_id: compiled.plan.session_binding.repo_id,
  task_id: compiled.plan.session_binding.task_id,
  workflow_id: compiled.plan.workflow_id,
  plan_digest: compiled.plan_digest,
  node_id: nodeId,
});

const verifiedEventReceipt = (compiled, event, expected = {}) => {
  if (!compiled.plan.executor_binding) {
    throw new Error('Parallel execution requires a compiled executor trust binding.');
  }
  const receipt = event.payload.executor_receipt;
  const verification = verifyExecutionReceipt({
    receipt,
    binding: compiled.plan.executor_binding,
    expected: { ...receiptExpected(compiled, event.node_id), ...expected },
    atTime: event.recorded_at,
  });
  return { receipt, digest: verification.receipt_digest, transition: verification.transition };
};

const assertExecutorEvent = (event, expectedRole, sourceEventId) => {
  if (event.producer?.runtime !== 'isolated-branch-executor-v1'
    || event.producer.role !== expectedRole) {
    throw new Error(`${event.event_type} requires the attested isolated executor producer.`);
  }
  if (event.event_id !== sourceEventId) {
    throw new Error(`${event.event_type} event_id must match the signed executor source_event_id.`);
  }
};

const assertUnusedReceipt = (state, receipt) => {
  if (state.executor_receipt_replay_ids.includes(receipt.replay_id)) {
    throw new Error(`Isolated executor receipt replay denied: ${receipt.replay_id}`);
  }
};

const recordReceipt = (state, receipt, { recordRun = false } = {}) => {
  assertUnusedReceipt(state, receipt);
  state.executor_receipt_replay_ids.push(receipt.replay_id);
  state.executor_receipt_replay_ids.sort(compareCodeUnits);
  if (recordRun) {
    if (state.executor_run_ids.includes(receipt.run_id)) {
      throw new Error(`Isolated executor run_id reuse denied: ${receipt.run_id}`);
    }
    if (state.executor_lease_ids.includes(receipt.lease_id)) {
      throw new Error(`Isolated executor lease_id reuse denied: ${receipt.lease_id}`);
    }
    state.executor_run_ids.push(receipt.run_id);
    state.executor_lease_ids.push(receipt.lease_id);
    state.executor_run_ids.sort(compareCodeUnits);
    state.executor_lease_ids.sort(compareCodeUnits);
  }
};

const assertFreshStartReceipt = (state, receipt) => {
  assertUnusedReceipt(state, receipt);
  if (state.executor_run_ids.includes(receipt.run_id)) {
    throw new Error(`Isolated executor retry requires a fresh run_id: ${receipt.run_id}`);
  }
  if (state.executor_lease_ids.includes(receipt.lease_id)) {
    throw new Error(`Isolated executor retry requires a fresh lease_id: ${receipt.lease_id}`);
  }
};

const manifestContentIdentity = (manifest) => ({
  schema_version: manifest.schema_version,
  algorithm: manifest.algorithm,
  policy_digest: manifest.policy_digest,
  snapshot_digest: manifest.snapshot_digest,
  content_root: manifest.content_root,
  entry_count: manifest.entry_count,
  regular_file_count: manifest.regular_file_count,
  symbolic_link_count: manifest.symbolic_link_count,
  content_shards: manifest.content_shards,
  fingerprint: manifest.fingerprint,
  manifest_digest: manifest.manifest_digest,
});

const transitionChangedPaths = (transition) => [...new Set([
  ...transition.changes.map((change) => change.path),
  ...transition.physicalChanges.map((change) => change.path),
])].sort(compareCodeUnits);

const physicalAliasTopology = (changes, selectedPaths = changes.map((change) => change.path)) => {
  const buildSide = (side) => {
    const groups = new Map();
    for (const change of changes) {
      const entry = change[side];
      if (entry === null) continue;
      const identity = `${entry.dev}:${entry.ino}`;
      const group = groups.get(identity) ?? { paths: [], nlinks: new Set() };
      group.paths.push(entry.path);
      group.nlinks.add(entry.nlink);
      groups.set(identity, group);
    }
    const byPath = new Map();
    const incomplete = [];
    for (const group of groups.values()) {
      const aliases = [...group.paths].sort(compareCodeUnits);
      const nlinks = [...group.nlinks];
      const nlink = nlinks.length === 1 ? nlinks[0] : null;
      if (nlink === null || nlink !== aliases.length) incomplete.push(...aliases);
      const descriptor = { aliases, nlink };
      aliases.forEach((filePath) => byPath.set(filePath, descriptor));
    }
    return { byPath, incomplete };
  };
  const before = buildSide('before');
  const after = buildSide('after');
  const paths = [...new Set(selectedPaths)].sort(compareCodeUnits);
  return {
    entries: paths.map((filePath) => ({
      path: filePath,
      before: before.byPath.get(filePath) ?? null,
      after: after.byPath.get(filePath) ?? null,
    })),
    incomplete: [...new Set([...before.incomplete, ...after.incomplete])].sort(compareCodeUnits),
  };
};

export function aggregateParallel(
  node,
  branchResults,
  baselineFingerprint,
  currentFingerprint,
  aggregateVerification = [],
  integrationEvidence,
) {
  const conflicts = [];
  const results = [...branchResults]
    .sort((left, right) => compareCodeUnits(left.branch_id, right.branch_id));
  const expected = new Map(node.branches.map((branch) => [branch.id, branch]));
  const seen = new Set();
  const workspaceIdentities = new Set();
  const runIds = new Set();
  const leaseIds = new Set();
  const branchTransitions = new Map();
  const branchChangedPaths = new Map();
  const branchContentPaths = new Map();
  const branchPhysicalPaths = new Map();
  let canonicalBaseline = null;
  const integrationTransition = validateWorkspaceTransitionEvidence(integrationEvidence);
  if (integrationEvidence.baseline_fingerprint !== baselineFingerprint
    || integrationEvidence.worktree_fingerprint !== currentFingerprint) {
    conflicts.push('integrated manifest evidence does not match workflow fingerprints');
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
    let derivedChangedPaths = [...new Set([
      ...(result.changed_paths || []),
      ...(result.changed_physical_paths || []),
    ])].sort(compareCodeUnits);
    try {
      if (!digestPattern.test(result.workspace_identity || '')) throw new Error('invalid workspace identity');
      if (workspaceIdentities.has(result.workspace_identity)) {
        conflicts.push(`reused isolated workspace: ${result.branch_id}`);
      }
      workspaceIdentities.add(result.workspace_identity);
      for (const [value, values, label] of [
        [result.run_id, runIds, 'run'],
        [result.lease_id, leaseIds, 'lease'],
      ]) {
        if (typeof value !== 'string' || value.length === 0 || values.has(value)) {
          conflicts.push(`reused or invalid isolated ${label}: ${result.branch_id}`);
        }
        values.add(value);
      }
      if (!digestPattern.test(result.start_receipt_digest || '')
        || !digestPattern.test(result.completion_receipt_digest || '')
        || !teardownComplete(result.teardown)) {
        conflicts.push(`missing attested receipt or teardown evidence: ${result.branch_id}`);
      }
      const baselineContent = manifestContentIdentity(result.baseline_manifest);
      if (canonicalBaseline === null) canonicalBaseline = baselineContent;
      else if (!sameValue(canonicalBaseline, baselineContent)) {
        conflicts.push(`branch baselines differ: ${result.branch_id}`);
      }
      const transition = validateWorkspaceTransitionEvidence(result);
      branchTransitions.set(result.branch_id, transition);
      branchContentPaths.set(
        result.branch_id,
        transition.changes.map((change) => change.path).sort(compareCodeUnits),
      );
      branchPhysicalPaths.set(
        result.branch_id,
        transition.physicalChanges.map((change) => change.path).sort(compareCodeUnits),
      );
      const topology = physicalAliasTopology(transition.physicalChanges);
      if (topology.incomplete.length) {
        conflicts.push(
          `branch physical alias proof is incomplete for ${topology.incomplete.join(', ')}: ${result.branch_id}`,
        );
      }
      derivedChangedPaths = transitionChangedPaths(transition);
    } catch {
      conflicts.push(`invalid content-addressed manifest evidence: ${result.branch_id}`);
    }
    branchChangedPaths.set(result.branch_id, derivedChangedPaths);
    for (const changedPath of derivedChangedPaths) {
      if (!branch.allowed_paths.some((scope) => pathWithinScope(changedPath, scope))) {
        conflicts.push(`path outside scope ${changedPath}: ${result.branch_id}`);
      }
    }
  }
  const missing = [...expected.keys()].filter((id) => !seen.has(id)).sort(compareCodeUnits);
  missing.forEach((id) => conflicts.push(`missing branch: ${id}`));
  for (let left = 0; left < results.length; left += 1) {
    for (let right = left + 1; right < results.length; right += 1) {
      const overlap = (branchChangedPaths.get(results[left].branch_id) || []).find((path) =>
        (branchChangedPaths.get(results[right].branch_id) || []).some((candidate) =>
          pathWithinScope(path, candidate) || pathWithinScope(candidate, path)));
      if (overlap) conflicts.push(`changed-path conflict ${overlap}: ${results[left].branch_id}/${results[right].branch_id}`);
    }
  }
  const authorizedChangedPaths = [...new Set(results.flatMap((result) =>
    branchChangedPaths.get(result.branch_id) || []))]
    .sort(compareCodeUnits);
  const authorizedContentPaths = [...new Set(results.flatMap((result) =>
    branchContentPaths.get(result.branch_id) || []))]
    .sort(compareCodeUnits);
  const authorizedPhysicalPaths = [...new Set(results.flatMap((result) =>
    branchPhysicalPaths.get(result.branch_id) || []))]
    .sort(compareCodeUnits);
  if (canonicalBaseline !== null) {
    if (!sameValue(canonicalBaseline, manifestContentIdentity(integrationEvidence.baseline_manifest))) {
      conflicts.push('integration baseline differs from branch baselines');
    }
    const integratedChangedPaths = transitionChangedPaths(integrationTransition);
    if (!sameValue(authorizedChangedPaths, integratedChangedPaths)) {
      conflicts.push('integrated changed paths do not exactly match the authorized branch union');
    }
    const integratedContentPaths = integrationTransition.changes
      .map((change) => change.path).sort(compareCodeUnits);
    const integratedPhysicalPaths = integrationTransition.physicalChanges
      .map((change) => change.path).sort(compareCodeUnits);
    if (!sameValue(authorizedContentPaths, integratedContentPaths)) {
      conflicts.push('integrated content paths do not exactly match the authorized branch union');
    }
    if (!sameValue(authorizedPhysicalPaths, integratedPhysicalPaths)) {
      conflicts.push('integrated physical paths do not exactly match the authorized branch union');
    }
    const integratedTopology = physicalAliasTopology(integrationTransition.physicalChanges);
    if (integratedTopology.incomplete.length) {
      conflicts.push(
        `integration physical alias proof is incomplete for ${integratedTopology.incomplete.join(', ')}`,
      );
    }
    const integratedByPath = new Map(integrationTransition.changes.map((change) => [change.path, change]));
    for (const result of results) {
      const transition = branchTransitions.get(result.branch_id);
      const branchByPath = new Map((transition?.changes || []).map((change) => [change.path, change]));
      for (const changedPath of transition?.changes.map((change) => change.path) || []) {
        const branchChange = branchByPath.get(changedPath);
        const integratedChange = integratedByPath.get(changedPath);
        if (!branchChange || !integratedChange
          || !sameValue(branchChange.before, integratedChange.before)
          || !sameValue(branchChange.after, integratedChange.after)) {
          conflicts.push(`integrated content differs for ${changedPath}: ${result.branch_id}`);
        }
      }
      const physicalPaths = transition?.physicalChanges.map((change) => change.path) || [];
      const branchTopology = physicalAliasTopology(transition?.physicalChanges || [], physicalPaths);
      const selectedIntegrationTopology = physicalAliasTopology(
        integrationTransition.physicalChanges,
        physicalPaths,
      );
      for (const changedPath of physicalPaths) {
        const branchChange = branchTopology.entries.find((entry) => entry.path === changedPath);
        const integratedChange = selectedIntegrationTopology.entries
          .find((entry) => entry.path === changedPath);
        if (!branchChange || !integratedChange || !sameValue(branchChange, integratedChange)) {
          conflicts.push(`integrated physical topology differs for ${changedPath}: ${result.branch_id}`);
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
  let status = 'accepted';
  if (missing.length) status = 'missing_evidence';
  else if (conflicts.length) status = 'rejected';
  const result = {
    schema_version: AGGREGATION_RESULT_SCHEMA_VERSION,
    node_id: node.id,
    status,
    baseline_fingerprint: baselineFingerprint,
    worktree_fingerprint: currentFingerprint,
    integrated_snapshot_digest: currentFingerprint,
    integrated_manifest: clone(integrationEvidence.current_manifest),
    integration_delta: clone(integrationEvidence.workspace_delta),
    integration_changed_content_shards: clone(integrationEvidence.changed_content_shards),
    integration_changed_physical_shards: clone(integrationEvidence.changed_physical_shards),
    authorized_changed_paths: authorizedChangedPaths,
    branches: results,
    conflicts: [...new Set(conflicts)].sort(compareCodeUnits),
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
  const artifacts = [...event.artifact_refs].sort(compareCodeUnits);
  const expectedArtifacts = [...node.expected_artifacts].sort(compareCodeUnits);
  if ((result.verdict === 'pass' && !sameValue(artifacts, expectedArtifacts))
    || (result.verdict !== 'pass' && artifacts.some((artifact) => !expectedArtifacts.includes(artifact)))) {
    throw new Error('Evaluation artifacts do not match expected_artifacts.');
  }
  const artifactDigests = validateArtifactDigests(result.artifact_digests, artifacts, 'evaluation');
  if (!sameValue(artifacts, artifactDigests.map((item) => item.artifact_ref).sort(compareCodeUnits))) {
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
    const repeatedFailures = incrementFailureCount(evaluation.failure_counts, result.failure_class);
    if (!result.retryable) finishEvaluation(nodeState, 'rejected');
    else if (!localBudgetAvailable(nodeState, node.budget)
      || state.remaining_budget.cost <= 0 || state.remaining_budget.duration_ms <= 0) {
      finishEvaluation(nodeState, 'budget_exhausted');
    } else if (repeatedFailures >= node.budget.stuck_failure_limit) {
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

const assertProducerRole = (event, expectedRole) => {
  if (event.producer?.role !== expectedRole) {
    throw new Error(`${event.event_type} requires producer role ${expectedRole}.`);
  }
};

const assertNodeEventProducer = (node, event) => {
  if (['capability.decision', 'capability.outcome'].includes(event.event_type)
    || event.event_type.startsWith('parallel.branch.')
    || event.event_type === 'parallel.aggregated') return;
  if (['node.invalidated', 'budget.exhausted'].includes(event.event_type)) {
    assertProducerRole(event, 'apex');
    return;
  }
  if (event.event_type === 'evaluation.recorded') {
    assertProducerRole(event, node.evaluator_role);
    return;
  }
  if (['node.started', 'node.completed', 'node.failed'].includes(event.event_type)) {
    const expectedRole = node.kind === 'task'
      ? node.role
      : (node.kind === 'evaluate-optimize' ? node.generator_role : 'apex');
    assertProducerRole(event, expectedRole);
  }
};

const recordCapabilityDecision = (state, node, nodeState, event) => {
  if (event.producer.role !== 'capability-broker') throw new Error('Capability events are broker-only.');
  const payload = event.payload;
  const { decision_digest: recordedDigest, ...unsigned } = payload;
  if (recordedDigest !== digestValue(unsigned)) throw new Error('Capability decision digest is invalid.');
  if (state.capability_decision_history.some((record) =>
    record.payload.decision_digest === recordedDigest)) {
    throw new Error('Capability decision digest is already recorded.');
  }
  const sameRequest = state.capability_decision_history
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
  if (payload.decision === 'authorized') {
    reserveCapabilityUsage(state, nodeState, node.budget, payload.reserved_budget);
  }
  const record = {
    node_id: event.node_id,
    sequence: event.sequence,
    worktree_fingerprint: event.worktree_fingerprint,
    input_refs: clone(nodeState.input_refs),
    payload: clone(payload),
  };
  state.capability_decision_history.push(record);
  nodeState.capability_decisions[recordedDigest] = clone(record);
};

const recordCapabilityOutcome = (state, nodeState, event) => {
  if (event.producer.role !== 'capability-broker') throw new Error('Capability events are broker-only.');
  const payload = event.payload;
  const recordedOutcomes = state.capability_outcome_history;
  if (event.recorded_at !== payload.recorded_at) {
    throw new Error('Capability outcome event and payload recorded_at must match exactly.');
  }
  const { outcome_digest: recordedDigest, ...unsigned } = payload;
  if (recordedDigest !== digestValue(unsigned)) throw new Error('Capability outcome digest is invalid.');
  if (recordedOutcomes.some((record) => record.payload.outcome_digest === recordedDigest)) {
    throw new Error('Capability outcome digest is already recorded.');
  }
  const decision = nodeState.capability_decisions[payload.decision_digest]?.payload;
  if (!decision || decision.decision !== 'authorized') {
    throw new Error('Capability outcome must reference a preceding authorized decision on the same node.');
  }
  for (const field of ['request_id', 'idempotency_key', 'capability_type', 'request_digest']) {
    if (payload[field] !== decision[field]) throw new Error(`Capability outcome ${field} does not match its decision.`);
  }
  if (!sameValue(payload.budget_charge, decision.reserved_budget)) {
    throw new Error('Capability outcome budget charge does not match its reserved budget.');
  }
  const prior = recordedOutcomes.filter((record) =>
    record.payload.decision_digest === payload.decision_digest);
  const sameExecution = recordedOutcomes.filter((record) =>
    record.payload.reservation_digest === payload.reservation_digest
    || record.payload.execution_nonce === payload.execution_nonce);
  if (payload.outcome_kind === 'signed-host-adapter-execution') {
    if (!SIGNED_HOST_CAPABILITIES.has(payload.capability_type)) {
      throw new Error('Signed host outcome uses an unsupported capability type.');
    }
    const reconciliationOf = payload.reconciliation_of ?? null;
    if (prior.length === 0) {
      if (reconciliationOf !== null) {
        throw new Error('Capability reconciliation requires one prior indeterminate attestation.');
      }
      if (sameExecution.length > 0) {
        throw new Error('Capability reservation or execution nonce is already recorded.');
      }
    } else if (prior.length === 1 && prior[0].payload.status === 'indeterminate') {
      if (!['succeeded', 'failed'].includes(payload.status)) {
        throw new Error('An indeterminate capability outcome permits exactly one succeeded or failed reconciliation.');
      }
      if (reconciliationOf !== prior[0].payload.attestation_digest) {
        throw new Error('Capability reconciliation_of must match the prior indeterminate attestation digest.');
      }
      if (payload.reservation_digest !== prior[0].payload.reservation_digest
        || payload.execution_nonce !== prior[0].payload.execution_nonce) {
        throw new Error('Capability reconciliation must retain the original reservation and execution nonce.');
      }
    } else {
      throw new Error('A capability decision already has its final attested outcome.');
    }
    if (payload.status === 'indeterminate' && prior.length > 0) {
      throw new Error('A capability decision can have only one indeterminate attestation.');
    }
    if (recordedOutcomes.some((record) =>
      record.payload.outcome_kind === 'signed-host-adapter-execution'
      && record.payload.attestation_digest === payload.attestation_digest)) {
      throw new Error('Capability attestation digest is already recorded.');
    }
  } else {
    if (payload.outcome_kind !== 'native-tool-execution' || payload.capability_type !== 'workspace.write') {
      throw new Error('Native capability outcomes are restricted to workspace.write.');
    }
    if (prior.length > 0) {
      throw new Error('A capability decision can have only one executed outcome.');
    }
    if (sameExecution.length > 0) {
      throw new Error('Capability reservation or execution nonce is already recorded.');
    }
  }
  if (prior.length > 0 && !sameValue(payload.budget_charge, prior[0].payload.budget_charge)) {
    throw new Error('Capability reconciliation changed the original budget charge.');
  }
  if (payload.status === 'succeeded'
    && EXTERNAL_CAPABILITIES.has(payload.capability_type)
    && (typeof payload.external_reference !== 'string' || payload.external_reference.length === 0)) {
    throw new Error('Successful external capability outcome requires a nonempty external reference.');
  }
  if (prior.length === 0) chargeCapabilityUsage(nodeState, payload.budget_charge);
  const record = {
    node_id: event.node_id,
    sequence: event.sequence,
    worktree_fingerprint: event.worktree_fingerprint,
    payload: clone(payload),
  };
  state.capability_outcome_history.push(record);
  nodeState.capability_outcomes.push(clone(record));
};

const unresolvedCapabilityDecisions = (nodeState) => Object.values(nodeState.capability_decisions)
  .filter((record) => {
    if (record.payload.decision !== 'authorized') return false;
    const outcomes = nodeState.capability_outcomes.filter((outcome) =>
      outcome.payload.decision_digest === record.payload.decision_digest);
    return outcomes.length === 0
      || (outcomes.length === 1 && outcomes[0].payload.status === 'indeterminate');
  });

const unresolvedCapabilityNodes = (state) => Object.entries(state.nodes)
  .filter(([, nodeState]) => unresolvedCapabilityDecisions(nodeState).length > 0)
  .map(([nodeId]) => nodeId);

const assertNoUnresolvedCapabilities = (nodeState, transition) => {
  if (unresolvedCapabilityDecisions(nodeState).length > 0) {
    throw new Error(`${transition} requires every authorized capability reservation to have a final outcome.`);
  }
};

const matchingExternalOutcome = (node, nodeState, event) => {
  const capabilityType = CAPABILITY_FOR_ACTION[node.action];
  return [...nodeState.capability_outcomes].reverse().find((record) => {
    const payload = record.payload;
    const decisionRecord = nodeState.capability_decisions[payload.decision_digest];
    const decision = decisionRecord?.payload;
    return payload.status === 'succeeded'
      && decision?.decision === 'authorized'
      && sameValue(decisionRecord.input_refs, nodeState.input_refs)
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
  assertCompiledSchemaVersion(compiled);
  const state = clone(previousState);
  for (const node of compiled.plan.nodes.filter((candidate) => candidate.kind === 'evaluate-optimize')) {
    state.nodes[node.id].evaluation.failure_counts = copyFailureCounts(
      state.nodes[node.id].evaluation.failure_counts,
    );
  }
  if (state.schema_version !== 1
    || state.workflow_id !== compiled.plan.workflow_id
    || state.plan_digest !== compiled.plan_digest
    || (state.sequence > 0 && !digestPattern.test(state.current_worktree_fingerprint || ''))) {
    throw new Error('Workflow state is not bound to the compiled plan.');
  }
  assertEventIntegrity(state, compiled, event);
  const unresolvedNodes = unresolvedCapabilityNodes(state);
  if (unresolvedNodes.length > 0
    && (event.event_type !== 'capability.outcome' || !unresolvedNodes.includes(event.node_id))) {
    throw new Error('An unresolved capability effect freezes the workflow until its matching outcome or reconciliation is recorded.');
  }
  if (['workflow.started', 'worktree.changed'].includes(event.event_type)) {
    assertProducerRole(event, 'apex');
  }
  const isolatedBranchEvent = event.event_type.startsWith('parallel.branch.');
  const mutatingCapabilityOutcome = event.event_type === 'capability.outcome'
    && WORKTREE_MUTATING_CAPABILITIES.has(event.payload.capability_type);
  const advancesIntegratedWorktree = event.event_type === 'parallel.aggregated';
  if (state.sequence > 0
    && event.event_type !== 'worktree.changed'
    && !isolatedBranchEvent
    && !mutatingCapabilityOutcome
    && !advancesIntegratedWorktree
    && event.worktree_fingerprint !== state.current_worktree_fingerprint) {
    throw new Error('Workflow event worktree fingerprint is stale; append worktree.changed or record the authorized mutation first.');
  }
  if (event.event_type === 'workflow.started') {
    exactPayload(event, []);
    if (state.status !== 'pending' || event.sequence !== 1) throw new Error('workflow.started must be the first event.');
    if (event.worktree_fingerprint !== compiled.plan.baseline_fingerprint) {
      throw new Error('workflow.started worktree fingerprint must match the compiled baseline.');
    }
    state.status = 'running';
    state.started_at = event.recorded_at;
    state.current_worktree_fingerprint = event.worktree_fingerprint;
    refreshReadiness(compiled, state);
  } else if (event.event_type === 'worktree.changed') {
    exactPayload(event, []);
    if (state.status === 'pending') throw new Error('worktree.changed cannot precede workflow.started.');
    if (!digestPattern.test(event.worktree_fingerprint || '')) throw new Error('worktree.changed requires a fingerprint.');
    if (Object.values(state.nodes).some((nodeState) =>
      unresolvedCapabilityDecisions(nodeState).length > 0)) {
      throw new Error('worktree.changed cannot strand an unresolved authorized capability reservation.');
    }
    const stale = compiled.plan.nodes
      .filter((node) => ['completed', 'running'].includes(state.nodes[node.id].status)
        && state.nodes[node.id].worktree_fingerprint !== event.worktree_fingerprint)
      .map((node) => node.id);
    const staleSet = new Set(stale);
    const nodesById = nodeMap(compiled);
    const staleRoots = stale.filter((id) => {
      const pending = [...nodesById.get(id).depends_on];
      const visited = new Set();
      while (pending.length) {
        const dependency = pending.pop();
        if (staleSet.has(dependency)) return false;
        if (!visited.has(dependency)) {
          visited.add(dependency);
          pending.push(...nodesById.get(dependency).depends_on);
        }
      }
      return true;
    });
    staleRoots.forEach((id) => invalidateFrom(compiled, state, id));
    state.current_worktree_fingerprint = event.worktree_fingerprint;
    refreshWorkflowStatus(compiled, state);
  } else {
    if (state.status === 'pending') throw new Error('workflow.started must precede node events.');
    const [node, nodeState] = requireNode(compiled, state, event);
    assertNodeEventProducer(node, event);
    if (event.event_type === 'node.started') {
      exactPayload(event, ['input_refs']);
      requireStatus(node.id, nodeState, ['ready'], 'start');
      if (node.kind === 'parallel'
        && state.current_worktree_fingerprint !== compiled.plan.baseline_fingerprint) {
        throw new Error(`Parallel node ${node.id} requires the current worktree to match its compiled baseline; compile a fresh workflow or use the chain fallback.`);
      }
      if (!nodeCanStart(node, nodeState, state)) throw new Error(`Cannot start ${node.id}; execution budget or retry limit is exhausted.`);
      nodeState.input_refs = assertInputRefs(state, node, event.payload.input_refs, `node ${node.id}`);
      consumeAttempt(state, nodeState, node.retry_limit + 1, `node ${node.id}`);
      nodeState.status = 'running';
      nodeState.worktree_fingerprint = event.worktree_fingerprint;
      if (node.kind === 'parallel') {
        Object.values(nodeState.branches).forEach((branch) => { if (branch.status === 'pending') branch.status = 'ready'; });
      }
    } else if (event.event_type === 'node.completed') {
      requireStatus(node.id, nodeState, ['running'], 'complete');
      if (['parallel', 'evaluate-optimize'].includes(node.kind)) throw new Error(`${node.kind} nodes use their typed completion event.`);
      assertNoUnresolvedCapabilities(nodeState, `${node.id} completion`);
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
      assertNoUnresolvedCapabilities(nodeState, `${node.id} failure`);
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
      exactPayload(event, ['executor_receipt']);
      requireStatus(node.id, nodeState, ['running'], 'start branch for');
      if (node.kind !== 'parallel') throw new Error('Branch events require a parallel node.');
      const branchId = event.payload.executor_receipt?.branch_id;
      const branch = node.branches.find((candidate) => candidate.id === branchId);
      const branchState = nodeState.branches[branchId];
      if (!branch || !branchState) throw new Error(`Unknown parallel branch: ${branchId}`);
      requireStatus(branch.id, branchState, ['ready'], 'start');
      const { receipt, digest } = verifiedEventReceipt(compiled, event, {
        receipt_kind: 'branch-started',
        branch_id: branch.id,
        attempt: branchState.attempts + 1,
      });
      assertExecutorEvent(event, branch.role, receipt.source_event_id);
      const inputs = assertInputRefs(state, node, receipt.input_refs, `branch ${branch.id}`);
      if (!sameValue(inputs, branch.dependency_inputs)) {
        throw new Error(`Branch ${branch.id} dependency_inputs do not match the plan.`);
      }
      if (branch.baseline_fingerprint !== compiled.plan.baseline_fingerprint) {
        throw new Error(`Branch ${branch.id} baseline does not match the workflow baseline.`);
      }
      if (state.current_worktree_fingerprint !== compiled.plan.baseline_fingerprint
        || nodeState.worktree_fingerprint !== compiled.plan.baseline_fingerprint) {
        throw new Error(`Branch ${branch.id} cannot start after the integrated worktree diverges from the compiled baseline.`);
      }
      if (receipt.baseline_fingerprint !== branch.baseline_fingerprint
        || receipt.worktree_fingerprint !== branch.baseline_fingerprint
        || event.worktree_fingerprint !== branch.baseline_fingerprint) {
        throw new Error(`Branch ${branch.id} start evidence does not match its worktree baseline.`);
      }
      if (Object.values(nodeState.branches).some((candidate) =>
        candidate !== branchState && candidate.workspace_identity === receipt.workspace_identity)) {
        throw new Error(`Branch ${branch.id} cannot reuse a sibling's isolated workspace.`);
      }
      if (branchState.pending_start_receipt_digest !== null
        && branchState.pending_start_receipt_digest !== digest) {
        throw new Error(`Branch ${branch.id} start receipt does not match its authorized retry receipt.`);
      }
      if (event.artifact_refs.length !== 0) throw new Error('Branch start cannot claim artifacts.');
      assertFreshStartReceipt(state, receipt);
      if (!branchCanStart(branch, branchState, state)) throw new Error(`Cannot start branch ${branch.id}; budget or retry limit is exhausted.`);
      recordReceipt(state, receipt, { recordRun: true });
      consumeAttempt(state, branchState, branch.retry_limit + 1, `branch ${branch.id}`);
      branchState.input_refs = inputs;
      branchState.baseline_fingerprint = receipt.baseline_fingerprint;
      branchState.workspace_identity = receipt.workspace_identity;
      branchState.run_id = receipt.run_id;
      branchState.lease_id = receipt.lease_id;
      branchState.start_receipt_digest = digest;
      branchState.completion_receipt_digest = null;
      branchState.pending_start_receipt_digest = null;
      branchState.baseline_manifest = clone(receipt.baseline_manifest);
      branchState.teardown_verified = false;
      branchState.status = 'running';
    } else if (event.event_type === 'parallel.branch.completed') {
      exactPayload(event, ['executor_receipt']);
      if (node.kind !== 'parallel') throw new Error('Branch events require a parallel node.');
      const branchId = event.payload.executor_receipt?.branch_id;
      const branch = node.branches.find((candidate) => candidate.id === branchId);
      const branchState = nodeState.branches[branchId];
      if (!branch || !branchState) throw new Error(`Unknown parallel branch: ${branchId}`);
      requireStatus(branch.id, branchState, ['running'], 'complete');
      const { receipt, digest, transition } = verifiedEventReceipt(compiled, event, {
        receipt_kind: 'branch-completed',
        branch_id: branch.id,
        attempt: branchState.attempts,
        run_id: branchState.run_id,
        lease_id: branchState.lease_id,
        start_receipt_digest: branchState.start_receipt_digest,
      });
      assertExecutorEvent(event, branch.role, receipt.source_event_id);
      assertUnusedReceipt(state, receipt);
      if (!validVerificationChecks(receipt.verification)) throw new Error(`Branch ${branch.id} verification is invalid.`);
      if (receipt.baseline_fingerprint !== compiled.plan.baseline_fingerprint
        || receipt.baseline_fingerprint !== branch.baseline_fingerprint
        || receipt.baseline_fingerprint !== branchState.baseline_fingerprint) {
        throw new Error(`Branch ${branch.id} completed against a stale baseline.`);
      }
      if (receipt.workspace_identity !== branchState.workspace_identity
        || !sameValue(receipt.input_refs, branchState.input_refs)
        || !sameValue(receipt.baseline_manifest, branchState.baseline_manifest)) {
        throw new Error(`Branch ${branch.id} completion does not match its isolated workspace baseline.`);
      }
      const derivedChangedPaths = transitionChangedPaths(transition);
      if (!verificationNamesMatch(receipt.verification, branch.verification)) {
        throw new Error(`Branch ${branch.id} verification names do not match the plan.`);
      }
      if (receipt.status === 'passed' && !verificationPassed(receipt.verification)) {
        throw new Error(`Passing branch ${branch.id} requires passing verification.`);
      }
      if (derivedChangedPaths.some((changedPath) =>
        !branch.allowed_paths.some((scope) => pathWithinScope(changedPath, scope)))) {
        throw new Error(`Branch ${branch.id} changed a path outside its scope.`);
      }
      if (receipt.status === 'failed'
        && receipt.artifact_refs.some((artifact) => !branch.expected_artifacts.includes(artifact))) {
        throw new Error(`Failed branch ${branch.id} claimed an undeclared artifact.`);
      }
      const expectedArtifacts = receipt.status === 'passed' ? branch.expected_artifacts : receipt.artifact_refs;
      const artifacts = validateArtifactDigests(receipt.artifact_digests, expectedArtifacts, `branch ${branch.id}`);
      if (!sameValue(
        [...receipt.artifact_refs].sort(compareCodeUnits),
        artifacts.map((item) => item.artifact_ref).sort(compareCodeUnits),
      ) || !sameValue(
        [...event.artifact_refs].sort(compareCodeUnits),
        [...receipt.artifact_refs].sort(compareCodeUnits),
      )) {
        throw new Error(`Branch ${branch.id} artifact references do not match their digests.`);
      }
      if (event.worktree_fingerprint !== receipt.worktree_fingerprint) {
        throw new Error('Branch completion fingerprint does not match its signed executor receipt.');
      }
      if (!teardownComplete(receipt.teardown)) {
        throw new Error(`Branch ${branch.id} completion requires complete teardown evidence.`);
      }
      const result = {
        branch_id: branch.id,
        status: receipt.status,
        run_id: receipt.run_id,
        lease_id: receipt.lease_id,
        start_receipt_digest: receipt.start_receipt_digest,
        completion_receipt_digest: digest,
        baseline_fingerprint: receipt.baseline_fingerprint,
        workspace_identity: receipt.workspace_identity,
        baseline_manifest: clone(receipt.baseline_manifest),
        current_manifest: clone(receipt.current_manifest),
        workspace_delta: clone(receipt.workspace_delta),
        changed_content_shards: clone(receipt.changed_content_shards),
        changed_physical_shards: clone(receipt.changed_physical_shards),
        changed_paths: clone(receipt.changed_paths),
        changed_physical_paths: clone(receipt.changed_physical_paths),
        artifact_refs: clone(receipt.artifact_refs),
        artifact_digests: artifacts,
        verification: clone(receipt.verification),
        failure_class: receipt.failure_class,
        cost_units: receipt.cost_units,
        duration_ms: receipt.duration_ms,
        teardown: clone(receipt.teardown),
      };
      recordReceipt(state, receipt);
      consumeUsage(state, branchState, branch.budget, receipt, `branch ${branch.id}`);
      branchState.artifact_digests = artifacts;
      branchState.completion_receipt_digest = digest;
      branchState.teardown_verified = true;
      branchState.result = result;
      branchState.status = receipt.status === 'passed' ? 'completed' : 'failed';
    } else if (event.event_type === 'parallel.branch.retry_requested') {
      exactPayload(event, ['branch_id', 'failure_class', 'next_start_receipt']);
      if (node.kind !== 'parallel') throw new Error('Branch retry requires a parallel node.');
      const branch = node.branches.find((candidate) => candidate.id === event.payload.branch_id);
      const branchState = nodeState.branches[event.payload.branch_id];
      if (!branch || !branchState) throw new Error(`Unknown parallel branch: ${event.payload.branch_id}`);
      requireStatus(branch.id, branchState, ['failed'], 'retry');
      if (event.payload.failure_class !== branchState.result?.failure_class) {
        throw new Error(`Branch ${branch.id} retry failure_class does not match its result.`);
      }
      if (!branchState.teardown_verified || !teardownComplete(branchState.result?.teardown)) {
        throw new Error(`Branch ${branch.id} cannot retry without complete teardown evidence.`);
      }
      const retryEvent = { ...event, payload: { executor_receipt: event.payload.next_start_receipt } };
      const { receipt, digest } = verifiedEventReceipt(compiled, retryEvent, {
        receipt_kind: 'branch-started',
        branch_id: branch.id,
        attempt: branchState.attempts + 1,
      });
      assertExecutorEvent(event, branch.role, `${receipt.source_event_id}.retry`);
      if (state.current_worktree_fingerprint !== compiled.plan.baseline_fingerprint
        || nodeState.worktree_fingerprint !== compiled.plan.baseline_fingerprint) {
        throw new Error(`Branch ${branch.id} cannot retry after the integrated worktree diverges from the compiled baseline.`);
      }
      if (receipt.baseline_fingerprint !== branch.baseline_fingerprint
        || receipt.worktree_fingerprint !== branch.baseline_fingerprint
        || event.worktree_fingerprint !== branch.baseline_fingerprint
        || !sameValue(receipt.input_refs, branch.dependency_inputs)) {
        throw new Error(`Branch ${branch.id} retry start receipt is stale or has incorrect inputs.`);
      }
      if (receipt.workspace_identity === branchState.workspace_identity) {
        throw new Error(`Branch ${branch.id} retry requires a fresh isolated workspace identity.`);
      }
      assertFreshStartReceipt(state, receipt);
      if (event.artifact_refs.length !== 0) throw new Error('Branch retry cannot claim artifacts.');
      if (!branchCanStart(branch, branchState, state)) throw new Error(`Cannot retry branch ${branch.id}; budget or retry limit is exhausted.`);
      branchState.status = 'ready';
      branchState.artifact_digests = [];
      branchState.baseline_fingerprint = null;
      branchState.workspace_identity = null;
      branchState.run_id = null;
      branchState.lease_id = null;
      branchState.start_receipt_digest = null;
      branchState.completion_receipt_digest = null;
      branchState.pending_start_receipt_digest = digest;
      branchState.baseline_manifest = null;
      branchState.teardown_verified = false;
      branchState.result = null;
    } else if (event.event_type === 'parallel.aggregated') {
      exactPayload(event, ['output_schema', 'executor_receipt']);
      requireStatus(node.id, nodeState, ['running'], 'aggregate');
      if (node.kind !== 'parallel') throw new Error('parallel.aggregated requires a parallel node.');
      assertNoUnresolvedCapabilities(nodeState, `${node.id} aggregation`);
      if (event.payload.output_schema !== 'aggregation-result-v2' || node.output_schema !== 'aggregation-result-v2') {
        throw new Error('parallel.aggregated requires output_schema aggregation-result-v2.');
      }
      const { receipt, digest } = verifiedEventReceipt(compiled, event, {
        receipt_kind: 'integration-completed',
        branch_id: null,
        attempt: null,
      });
      assertExecutorEvent(event, 'executor', receipt.source_event_id);
      assertUnusedReceipt(state, receipt);
      if (state.current_worktree_fingerprint !== compiled.plan.baseline_fingerprint
        || nodeState.worktree_fingerprint !== compiled.plan.baseline_fingerprint) {
        throw new Error('Parallel aggregation requires the current integrated worktree to match the compiled baseline.');
      }
      if (receipt.baseline_fingerprint !== compiled.plan.baseline_fingerprint
        || receipt.worktree_fingerprint !== event.worktree_fingerprint) {
        throw new Error('Parallel aggregation receipt is stale for the compiled baseline or event fingerprint.');
      }
      const expectedBranchReceipts = node.branches.map((branch) => ({
        branch_id: branch.id,
        completion_receipt_digest: nodeState.branches[branch.id].completion_receipt_digest,
      })).sort((left, right) => compareCodeUnits(left.branch_id, right.branch_id));
      const suppliedBranchReceipts = [...receipt.branch_receipts]
        .sort((left, right) => compareCodeUnits(left.branch_id, right.branch_id));
      if (expectedBranchReceipts.some((item) => item.completion_receipt_digest === null)
        || !sameValue(suppliedBranchReceipts, expectedBranchReceipts)) {
        throw new Error('Parallel aggregation receipt does not bind every current branch completion receipt.');
      }
      if (!validAggregateVerification(receipt.verification, receipt.worktree_fingerprint)) {
        throw new Error('Parallel aggregation verification is not bound to the integrated snapshot.');
      }
      const results = Object.values(nodeState.branches).map((branch) => branch.result).filter(Boolean);
      const aggregation = aggregateParallel(
        node,
        results,
        compiled.plan.baseline_fingerprint,
        receipt.worktree_fingerprint,
        receipt.verification,
        receipt,
      );
      if (!sameValue(receipt.changed_paths, aggregation.authorized_changed_paths)) {
        throw new Error('Parallel aggregation changed paths do not match the authorized branch union.');
      }
      if (aggregation.status === 'missing_evidence') throw new Error('Cannot aggregate while required branch evidence is missing.');
      if (receipt.status !== aggregation.status) {
        throw new Error('Parallel aggregation receipt status does not match the deterministic aggregation result.');
      }
      const artifacts = validateArtifactDigests(receipt.artifact_digests, node.expected_artifacts, 'parallel aggregation');
      if (!sameValue(
        event.artifact_refs,
        artifacts.map((item) => item.artifact_ref).sort(compareCodeUnits),
      )) {
        throw new Error('Parallel aggregation artifact_refs do not match artifact_digests.');
      }
      if (!sameValue(
        [...receipt.artifact_refs].sort(compareCodeUnits),
        [...event.artifact_refs].sort(compareCodeUnits),
      )) {
        throw new Error('Parallel aggregation event artifacts do not match the signed receipt.');
      }
      if (!teardownComplete(receipt.teardown)) {
        throw new Error('Parallel aggregation requires complete integration teardown evidence.');
      }
      recordReceipt(state, receipt, { recordRun: true });
      consumeUsage(state, nodeState, node.budget, receipt, `parallel node ${node.id} aggregation`);
      nodeState.result = aggregation;
      nodeState.artifact_refs = artifacts.map((item) => item.artifact_ref);
      nodeState.artifact_digests = artifacts;
      nodeState.worktree_fingerprint = receipt.worktree_fingerprint;
      nodeState.integration_receipt_digest = digest;
      nodeState.status = aggregation.status === 'accepted' ? 'completed' : 'failed';
      nodeState.terminal_state = aggregation.status;
      state.current_worktree_fingerprint = event.worktree_fingerprint;
    } else if (event.event_type === 'evaluation.recorded') {
      requireStatus(node.id, nodeState, ['running'], 'evaluate');
      if (node.kind !== 'evaluate-optimize') throw new Error('evaluation.recorded requires an evaluate-optimize node.');
      assertNoUnresolvedCapabilities(nodeState, `${node.id} evaluation`);
      applyEvaluation(state, node, nodeState, event);
    } else if (event.event_type === 'budget.exhausted') {
      exactPayload(event, ['failure_class']);
      requireStatus(node.id, nodeState, ['ready', 'running'], 'exhaust budget for');
      assertNoUnresolvedCapabilities(nodeState, `${node.id} budget exhaustion`);
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
      recordCapabilityDecision(state, node, nodeState, event);
      nodeState.latest_capability_event = {
        event_type: event.event_type,
        sequence: event.sequence,
        payload: clone(event.payload),
      };
      nodeState.capability_event_count += 1;
    } else if (event.event_type === 'capability.outcome') {
      requireStatus(node.id, nodeState, ['running'], 'record capability outcome for');
      recordCapabilityOutcome(state, nodeState, event);
      if (mutatingCapabilityOutcome) {
        state.current_worktree_fingerprint = event.worktree_fingerprint;
      }
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
  const unresolvedNodes = unresolvedCapabilityNodes(state);
  if (unresolvedNodes.length > 0) {
    return unresolvedNodes.map((nodeId) => ({ event_type: 'capability.outcome', node_id: nodeId }));
  }
  const transitions = [{ event_type: 'worktree.changed', node_id: null }];
  for (const node of compiled.plan.nodes) {
    const current = state.nodes[node.id];
    if (current.status === 'ready') {
      const baselineAllowsStart = node.kind !== 'parallel'
        || state.current_worktree_fingerprint === compiled.plan.baseline_fingerprint;
      if (baselineAllowsStart && nodeCanStart(node, current, state)) {
        transitions.push({ event_type: 'node.started', node_id: node.id });
      }
      else if (budgetIsExhausted(node, current, state)) transitions.push({ event_type: 'budget.exhausted', node_id: node.id });
    }
    if (current.status === 'running') {
      transitions.push({ event_type: 'capability.decision', node_id: node.id });
      const hasUnresolvedCapability = unresolvedCapabilityDecisions(current).length > 0;
      if (hasUnresolvedCapability) {
        transitions.push({ event_type: 'capability.outcome', node_id: node.id });
      }
      if (node.kind === 'parallel') {
        const baselineIsCurrent = state.current_worktree_fingerprint === compiled.plan.baseline_fingerprint
          && current.worktree_fingerprint === compiled.plan.baseline_fingerprint;
        for (const branch of node.branches) {
          const branchState = current.branches[branch.id];
          if (baselineIsCurrent && branchState.status === 'ready' && branchCanStart(branch, branchState, state)) {
            transitions.push({ event_type: 'parallel.branch.started', node_id: node.id, branch_id: branch.id });
          }
          if (branchState.status === 'running') {
            transitions.push({ event_type: 'parallel.branch.completed', node_id: node.id, branch_id: branch.id });
          }
          if (baselineIsCurrent && branchState.status === 'failed' && branchCanStart(branch, branchState, state)) {
            transitions.push({ event_type: 'parallel.branch.retry_requested', node_id: node.id, branch_id: branch.id });
          }
        }
        if (baselineIsCurrent
          && !hasUnresolvedCapability
          && Object.values(current.branches).every((branch) => branch.result !== null)) {
          transitions.push({ event_type: 'parallel.aggregated', node_id: node.id });
        }
      } else if (node.kind === 'evaluate-optimize') {
        if (!hasUnresolvedCapability) {
          transitions.push({ event_type: 'evaluation.recorded', node_id: node.id });
        }
      } else {
        const canComplete = !hasUnresolvedCapability
          && (node.kind !== 'external-action'
          || matchingExternalOutcome(node, current, {
            worktree_fingerprint: state.current_worktree_fingerprint,
          }) !== undefined);
        if (canComplete) transitions.push({ event_type: 'node.completed', node_id: node.id });
      }
      if (!hasUnresolvedCapability) transitions.push({ event_type: 'node.failed', node_id: node.id });
      if (!hasUnresolvedCapability && budgetIsExhausted(node, current, state)) {
        transitions.push({ event_type: 'budget.exhausted', node_id: node.id });
      }
    }
    if (['completed', 'failed', 'blocked'].includes(current.status)) {
      transitions.push({ event_type: 'node.invalidated', node_id: node.id });
    }
  }
  return transitions;
}

export { canonicalJson };
