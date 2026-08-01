// Author: Subash Karki
// Fresh v1 contracts for Phantom's deterministic workflow control plane.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';


const SCHEMA_ROOT = new URL('../../schemas/', import.meta.url);

const loadSchema = (name) => JSON.parse(readFileSync(new URL(name, SCHEMA_ROOT), 'utf8'));

export const workflowPlanSchema = loadSchema('workflow-plan.schema.json');
export const workflowEventSchema = loadSchema('workflow-event.schema.json');
export const aggregationResultSchema = loadSchema('aggregation-result.schema.json');
export const evaluationResultSchema = loadSchema('evaluation-result.schema.json');

export const WORKFLOW_EVENT_TYPES = Object.freeze(workflowEventSchema.properties.event_type.enum);
export const EVALUATION_TERMINAL_STATES = Object.freeze([
  'accepted',
  'rejected',
  'budget_exhausted',
  'iteration_limit',
  'stuck_same_failure',
  'missing_evidence',
  'human_decision_required',
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const sortedValue = (value) => {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]));
};

export const canonicalJson = (value) => JSON.stringify(sortedValue(value));

export const digestValue = (value) =>
  `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;

const typeMatches = (type, value) => {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
};

export function validateSchema(schema, value, path = '$', errors = []) {
  if (Object.hasOwn(schema, 'const') && value !== schema.const) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.some((candidate) => canonicalJson(candidate) === canonicalJson(value))) {
    errors.push(`${path}: must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    return errors;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(type, value))) {
      errors.push(`${path}: must be ${types.join(' or ')}`);
      return errors;
    }
  }
  if (value === null) return errors;

  if (isObject(value)) {
    for (const field of schema.required || []) {
      if (!Object.hasOwn(value, field)) errors.push(`${path}.${field}: required`);
    }
    const properties = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const field of Object.keys(value)) {
        if (!Object.hasOwn(properties, field)) errors.push(`${path}.${field}: unsupported property`);
      }
    }
    for (const [field, fieldSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, field)) validateSchema(fieldSchema, value[field], `${path}.${field}`, errors);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: requires at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: allows at most ${schema.maxItems} item(s)`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      value.forEach((item, index) => {
        const canonical = canonicalJson(item);
        if (seen.has(canonical)) errors.push(`${path}[${index}]: duplicate item`);
        seen.add(canonical);
      });
    }
    if (schema.items) {
      value.forEach((item, index) => validateSchema(schema.items, item, `${path}[${index}]`, errors));
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: must contain at least ${schema.minLength} character(s)`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match ${schema.pattern}`);
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }
  return errors;
}

export function isPortableWorkflowPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0')) return false;
  if (value === '.') return true;
  if (posix.isAbsolute(value)) return false;
  const normalized = posix.normalize(value);
  return normalized === value && !normalized.split('/').some((part) => part === '..' || part === '.');
}

export const pathWithinScope = (changedPath, scope) =>
  isPortableWorkflowPath(changedPath)
  && (scope === '.' || changedPath === scope || changedPath.startsWith(`${scope}/`));

const pathsOverlap = (left, right) => pathWithinScope(left, right) || pathWithinScope(right, left);

const uniqueFieldErrors = (items, field, path) => {
  const errors = [];
  const seen = new Set();
  items.forEach((item, index) => {
    const value = item?.[field];
    if (seen.has(value)) errors.push(`${path}[${index}].${field}: duplicate ${JSON.stringify(value)}`);
    seen.add(value);
  });
  return errors;
};

const exactObjectKeys = (value, required, path) => {
  if (!isObject(value)) return [`${path}: must be an object`];
  const errors = [];
  const expected = new Set(required);
  for (const field of required) {
    if (!Object.hasOwn(value, field)) errors.push(`${path}.${field}: required`);
  }
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) errors.push(`${path}.${field}: unsupported property`);
  }
  return errors;
};

const validateNodeContract = (node, index, plan) => {
  const errors = [];
  const path = `$.nodes[${index}]`;
  for (const [field, values] of [
    ['allowed_paths', node.allowed_paths],
    ['allowed_cwds', node.allowed_cwds],
  ]) {
    for (const [itemIndex, value] of (values || []).entries()) {
      if (!isPortableWorkflowPath(value)) errors.push(`${path}.${field}[${itemIndex}]: must be a portable relative path`);
    }
  }
  for (const [itemIndex, value] of (node.expected_artifacts || []).entries()) {
    if (!isPortableWorkflowPath(value) || value === '.') {
      errors.push(`${path}.expected_artifacts[${itemIndex}]: must be a portable artifact file reference`);
    }
  }
  for (const [commandIndex, command] of (node.allowed_commands || []).entries()) {
    if (!Array.isArray(command) || command.length === 0
      || command.some((argument) => typeof argument !== 'string' || argument.length === 0 || argument.includes('\0'))) {
      errors.push(`${path}.allowed_commands[${commandIndex}]: must be a non-empty exact argv array`);
    }
    if (Array.isArray(command) && !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(command[0] || '')) {
      errors.push(`${path}.allowed_commands[${commandIndex}][0]: executable must be a portable name, not a path`);
    }
  }
  const evaluatorBudget = ['max_iterations', 'max_duration_ms', 'max_cost_units', 'stuck_failure_limit'];
  const standardBudget = ['max_cost_units', 'max_duration_ms'];
  errors.push(...exactObjectKeys(
    node.budget,
    node.kind === 'evaluate-optimize' ? evaluatorBudget : standardBudget,
    `${path}.budget`,
  ));
  if (node.kind === 'task') {
    if (!node.role) errors.push(`${path}.role: required for task`);
    if (!node.output_schema) errors.push(`${path}.output_schema: required for task`);
    if (!node.expected_artifacts?.length) errors.push(`${path}.expected_artifacts: required for task`);
    if (!node.acceptance_criteria?.length) errors.push(`${path}.acceptance_criteria: required for task`);
  } else if (node.kind === 'parallel') {
    if (node.output_schema !== 'aggregation-result-v1') {
      errors.push(`${path}.output_schema: parallel nodes require aggregation-result-v1`);
    }
    if (node.dependency_evidence !== 'complete') {
      errors.push(`${path}.dependency_evidence: parallel execution requires complete dependency evidence`);
    }
    if (!Array.isArray(node.branches)) return [...errors, `${path}.branches: required for parallel`];
    errors.push(...uniqueFieldErrors(node.branches, 'id', `${path}.branches`));
    const scopes = [];
    node.branches.forEach((branch, branchIndex) => {
      const branchPath = `${path}.branches[${branchIndex}]`;
      if (branch.baseline_fingerprint !== plan.baseline_fingerprint) {
        errors.push(`${branchPath}.baseline_fingerprint: must match the workflow baseline`);
      }
      for (const [inputIndex, input] of (branch.dependency_inputs || []).entries()) {
        if (!node.depends_on.includes(input.source_node)) {
          errors.push(`${branchPath}.dependency_inputs[${inputIndex}].source_node: must appear in node depends_on`);
        }
        if (!isPortableWorkflowPath(input.artifact_ref) || input.artifact_ref === '.') {
          errors.push(`${branchPath}.dependency_inputs[${inputIndex}].artifact_ref: must be a portable artifact file reference`);
        }
      }
      for (const [artifactIndex, artifact] of (branch.expected_artifacts || []).entries()) {
        if (!isPortableWorkflowPath(artifact) || artifact === '.') {
          errors.push(`${branchPath}.expected_artifacts[${artifactIndex}]: must be a portable artifact file reference`);
        }
      }
      branch.allowed_paths?.forEach((scope, scopeIndex) => {
        if (!isPortableWorkflowPath(scope)) {
          errors.push(`${path}.branches[${branchIndex}].allowed_paths[${scopeIndex}]: must be a portable relative path`);
        }
        scopes.push({ branch: branch.id, scope });
      });
    });
    if (!node.expected_artifacts?.length) errors.push(`${path}.expected_artifacts: required for parallel integration`);
    if (!node.verification?.length) errors.push(`${path}.verification: required for parallel aggregation`);
    for (let left = 0; left < scopes.length; left += 1) {
      for (let right = left + 1; right < scopes.length; right += 1) {
        if (scopes[left].branch !== scopes[right].branch && pathsOverlap(scopes[left].scope, scopes[right].scope)) {
          errors.push(`${path}.branches: write scopes overlap between ${scopes[left].branch} and ${scopes[right].branch}`);
        }
      }
    }
  } else if (node.kind === 'aggregate') {
    if (!Array.isArray(node.sources) || node.sources.length === 0) errors.push(`${path}.sources: required for aggregate`);
    for (const source of node.sources || []) {
      if (!node.depends_on.includes(source)) errors.push(`${path}.sources: ${source} must also appear in depends_on`);
    }
    if (!node.output_schema) errors.push(`${path}.output_schema: required for aggregate`);
    if (!node.expected_artifacts?.length) errors.push(`${path}.expected_artifacts: required for aggregate`);
  } else if (node.kind === 'evaluate-optimize') {
    if (node.output_schema !== 'evaluation-result-v1') {
      errors.push(`${path}.output_schema: evaluate-optimize nodes require evaluation-result-v1`);
    }
    if (!node.generator_role) errors.push(`${path}.generator_role: required for evaluate-optimize`);
    if (!node.evaluator_role) errors.push(`${path}.evaluator_role: required for evaluate-optimize`);
    if (node.generator_role && node.generator_role === node.evaluator_role) {
      errors.push(`${path}.evaluator_role: must be independent from generator_role`);
    }
    if (!node.budget) errors.push(`${path}.budget: required for evaluate-optimize`);
    if (!node.expected_artifacts?.length) errors.push(`${path}.expected_artifacts: required for evaluate-optimize`);
  } else if (node.kind === 'external-action') {
    if (!node.action) errors.push(`${path}.action: required for external-action`);
    if (!node.idempotency_key) errors.push(`${path}.idempotency_key: required for external-action`);
    if (node.depends_on.length === 0) errors.push(`${path}.depends_on: external-action requires an upstream gate`);
    if (!node.output_schema) errors.push(`${path}.output_schema: required for external-action`);
    if (!node.expected_artifacts?.length) errors.push(`${path}.expected_artifacts: required for external-action`);
  }
  if (plan.execution_mode === 'unattended' && !node.acceptance_criteria?.length) {
    errors.push(`${path}.acceptance_criteria: unattended nodes require testable acceptance criteria`);
  }
  return errors;
};

export function validateWorkflowPlan(value) {
  const errors = validateSchema(workflowPlanSchema, value);
  if (!isObject(value) || !Array.isArray(value.nodes)) return errors;
  errors.push(...uniqueFieldErrors(value.nodes, 'id', '$.nodes'));
  if (value.session_binding?.route !== value.route) {
    errors.push('$.session_binding.route: must match the workflow route');
  }
  if (value.route === 'direct' && ['high', 'critical'].includes(value.risk)) {
    errors.push('$.route: high- or critical-risk work cannot use direct');
  }
  if (value.risk === 'critical' && value.route !== 'full') {
    errors.push('$.route: critical-risk work requires full');
  }
  if (value.route !== 'direct' && value.session_binding?.approved_plan === null) {
    errors.push('$.session_binding.approved_plan: planned routes require an approved plan binding');
  }
  if (value.route === 'direct' && value.session_binding?.approved_plan !== null) {
    errors.push('$.session_binding.approved_plan: direct route must not claim a plan approval');
  }
  const routeRank = { direct: 0, plan: 1, brainstorm: 2, full: 3 };
  const threshold = { direct: 0.9, plan: 0.7, brainstorm: 0, full: 0 };
  if (isObject(value.routing)) {
    const recommended = value.routing.recommended_route;
    const fallback = value.routing.fallback_route;
    if (fallback !== null && routeRank[fallback] <= routeRank[recommended]) {
      errors.push('$.routing.fallback_route: must be safer than the recommended route');
    }
    if (value.routing.confidence < threshold[recommended] && fallback === null) {
      errors.push('$.routing.fallback_route: required when confidence is below the route threshold');
    }
    const selected = value.routing.confidence >= threshold[recommended] ? recommended : fallback;
    if (selected !== value.route) {
      errors.push(`$.routing: deterministic confidence policy selects ${selected}, not ${value.route}`);
    }
  }
  if (value.route === 'full' && value.nodes.length < 2) {
    errors.push('$.nodes: full route requires a staged topology with at least two nodes');
  }
  value.nodes.forEach((node, index) => errors.push(...validateNodeContract(node, index, value)));
  return errors;
}

export function validateWorkflowEvent(value) {
  const errors = validateSchema(workflowEventSchema, value);
  if (!isObject(value)) return errors;
  const workflowEvents = new Set(['workflow.started', 'worktree.changed']);
  if (workflowEvents.has(value.event_type) && value.node_id !== null) {
    errors.push('$.node_id: must be null for workflow-wide events');
  }
  if (!workflowEvents.has(value.event_type) && typeof value.node_id !== 'string') {
    errors.push('$.node_id: required for node event');
  }
  if (value.event_type === 'capability.decision') {
    errors.push(...validateCapabilityDecisionPayload(value.payload));
  } else if (value.event_type === 'capability.outcome') {
    errors.push(...validateCapabilityOutcomePayload(value.payload));
  }
  return errors;
}

const digestPattern = /^sha256:[a-f0-9]{64}$/;

const requireExactFields = (payload, required, path) => {
  const errors = [];
  if (!isObject(payload)) return [`${path}: required object`];
  for (const field of required) {
    if (!Object.hasOwn(payload, field)) errors.push(`${path}.${field}: required`);
  }
  for (const field of Object.keys(payload)) {
    if (!required.includes(field)) errors.push(`${path}.${field}: unsupported property`);
  }
  return errors;
};

export function validateCapabilityDecisionPayload(payload) {
  const required = [
    'schema_version', 'request_id', 'idempotency_key', 'capability_type', 'request_digest',
    'decision', 'decision_digest', 'reason',
  ];
  const errors = requireExactFields(payload, required, '$.payload');
  if (!isObject(payload)) return errors;
  if (payload.schema_version !== 1) errors.push('$.payload.schema_version: must equal 1');
  for (const field of ['request_id', 'idempotency_key', 'capability_type', 'reason']) {
    if (typeof payload[field] !== 'string' || payload[field].length === 0) errors.push(`$.payload.${field}: required string`);
  }
  for (const field of ['request_digest', 'decision_digest']) {
    if (!digestPattern.test(payload[field] || '')) errors.push(`$.payload.${field}: required sha256 digest`);
  }
  if (!['authorized', 'denied', 'duplicate'].includes(payload.decision)) {
    errors.push('$.payload.decision: must be authorized, denied, or duplicate');
  }
  return errors;
}

export function validateCapabilityOutcomePayload(payload) {
  const required = [
    'schema_version', 'request_id', 'idempotency_key', 'capability_type', 'request_digest',
    'decision_digest', 'status', 'outcome_digest', 'external_reference', 'error',
  ];
  const errors = requireExactFields(payload, required, '$.payload');
  if (!isObject(payload)) return errors;
  if (payload.schema_version !== 1) errors.push('$.payload.schema_version: must equal 1');
  for (const field of ['request_id', 'idempotency_key', 'capability_type']) {
    if (typeof payload[field] !== 'string' || payload[field].length === 0) errors.push(`$.payload.${field}: required string`);
  }
  for (const field of ['request_digest', 'decision_digest', 'outcome_digest']) {
    if (!digestPattern.test(payload[field] || '')) errors.push(`$.payload.${field}: required sha256 digest`);
  }
  if (!['succeeded', 'failed', 'deduplicated'].includes(payload.status)) {
    errors.push('$.payload.status: must be succeeded, failed, or deduplicated');
  }
  if (payload.external_reference !== null && (typeof payload.external_reference !== 'string'
    || payload.external_reference.length === 0)) {
    errors.push('$.payload.external_reference: must be null or non-empty string');
  }
  if (payload.error !== null && (typeof payload.error !== 'string' || payload.error.length === 0)) {
    errors.push('$.payload.error: must be null or non-empty string');
  }
  if (payload.status === 'failed' && payload.error === null) errors.push('$.payload.error: failed outcome requires an error');
  if (payload.status !== 'failed' && payload.error !== null) errors.push('$.payload.error: non-failed outcome requires null');
  return errors;
}

export function validateAggregationResult(value) {
  const errors = validateSchema(aggregationResultSchema, value);
  if (!isObject(value) || !Array.isArray(value.branches)) return errors;
  errors.push(...uniqueFieldErrors(value.branches, 'branch_id', '$.branches'));
  if (value.status === 'accepted') {
    if (value.branches.length === 0) errors.push('$.branches: accepted aggregation requires branches');
    if (value.branches.some((branch) => branch.status !== 'passed')) errors.push('$.branches: every branch must pass');
    if (value.conflicts?.length) errors.push('$.conflicts: accepted aggregation cannot contain conflicts');
    if (!value.aggregate_verification?.length
      || value.aggregate_verification.some((check) => check.result !== 'passed')) {
      errors.push('$.aggregate_verification: accepted aggregation requires passing aggregate verification');
    }
  }
  return errors;
}

export function validateEvaluationResult(value) {
  const errors = validateSchema(evaluationResultSchema, value);
  if (!isObject(value)) return errors;
  if (value.verdict === 'pass') {
    if (!value.evidence?.length || value.evidence.some((item) => item.result !== 'passed')) {
      errors.push('$.evidence: pass requires explicit passing evidence');
    }
    if (value.failure_class !== null) errors.push('$.failure_class: pass requires null');
    if (value.retryable !== false) errors.push('$.retryable: pass cannot be retryable');
  } else if (typeof value.failure_class !== 'string' || value.failure_class.length === 0) {
    errors.push('$.failure_class: fail or blocked verdict requires a classification');
  }
  return errors;
}

export class WorkflowContractError extends Error {
  constructor(label, errors) {
    super(`${label}: ${errors.join('; ')}`);
    this.name = 'WorkflowContractError';
    this.errors = errors;
  }
}

export function assertContract(label, errors) {
  if (errors.length) throw new WorkflowContractError(label, errors);
}
