// Author: Subash Karki

import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';

const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const hasUnresolvedPlaceholder = (value) =>
  typeof value === 'string' && /(\{[A-Z][A-Z0-9_]*\}|\bTODO\b|\bTBD\b)/i.test(value);

const requireArray = (value, path, errors, nonEmpty = false) => {
  if (!Array.isArray(value)) {
    errors.push(`${path}: required array`);
    return [];
  }
  if (nonEmpty && value.length === 0) errors.push(`${path}: required non-empty array`);
  return value;
};

const requireTextFields = (value, path, fields, errors) => {
  if (!isObject(value)) return;
  for (const field of fields) {
    if (!isText(value[field])) errors.push(`${path}.${field}: required string`);
  }
};

const requireEnum = (value, path, allowed, errors) => {
  if (!allowed.includes(value)) errors.push(`${path}: must be ${allowed.join('|')}`);
};

const requireTextArray = (value, path, errors, nonEmpty = false) => {
  const items = requireArray(value, path, errors, nonEmpty);
  items.forEach((item, index) => {
    if (!isText(item)) errors.push(`${path}[${index}]: required string`);
  });
  return items;
};

const isObservedAt = (value) => isText(value)
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value));

const duplicateIds = (items, path, errors) => {
  const ids = items.filter(isObject).map(({ id }) => id).filter(isText);
  if (new Set(ids).size !== ids.length) errors.push(`${path}[].id: duplicate id`);
  return ids;
};

const hasAnyField = (value, fields) => fields.some((field) => value[field] !== undefined);

const validateBriefing = (payload, errors, fields) => {
  if (!isObject(payload.briefing)) errors.push('briefing: required object');
  else requireTextFields(payload.briefing, 'briefing', fields, errors);
};

const validatePlanBriefing = (payload, errors) => {
  validateBriefing(payload, errors, ['tackling', 'problem', 'how']);
};

const validateEvidenceImplications = (evidence, depth, errors) => {
  if (depth === 'quick') return;
  evidence.forEach((item, index) => {
    if (!isObject(item)) return;
    if ((item.status === 'verified' || item.status === 'supported') && !isText(item.implication)) {
      errors.push(`evidence[${index}].implication: required string for verified|supported evidence`);
    }
  });
};

const validateAlternativeReasons = (alternatives, errors) => {
  const seen = new Set();
  alternatives.forEach((item, index) => {
    if (!isObject(item)) {
      errors.push(`alternatives[${index}]: required object`);
      return;
    }
    requireTextFields(item, `alternatives[${index}]`, ['name'], errors);
    const reason = isText(item.reasonNotSelected)
      ? item.reasonNotSelected
      : (isText(item.reason) ? item.reason : '');
    if (!isText(reason)) {
      errors.push(`alternatives[${index}]: required unique reasonNotSelected or reason`);
      return;
    }
    if (seen.has(reason)) errors.push(`alternatives[${index}]: reasonNotSelected or reason must be unique`);
    seen.add(reason);
  });
};

const validateApproachDistinctness = (approaches, errors) => {
  const lenses = new Set();
  const theses = new Set();
  const triples = [];
  let duplicateLens = false;
  let duplicateThesis = false;
  for (const approach of approaches) {
    if (!isObject(approach)) continue;
    if (isText(approach.whyLens)) {
      if (lenses.has(approach.whyLens)) duplicateLens = true;
      lenses.add(approach.whyLens);
    }
    if (isText(approach.thesis)) {
      if (theses.has(approach.thesis)) duplicateThesis = true;
      theses.add(approach.thesis);
    }
    if (isText(approach.effort) && isText(approach.risk) && isText(approach.reversibility)) {
      triples.push(`${approach.effort}\n${approach.risk}\n${approach.reversibility}`);
    }
  }
  if (duplicateLens) errors.push('approaches[].whyLens: duplicate whyLens');
  if (duplicateThesis) errors.push('approaches[].thesis: duplicate thesis');
  if (triples.length >= 2 && triples.every((triple) => triple === triples[0])) {
    errors.push('approaches: effort, risk, and reversibility must not all be identical');
  }
};

const isWithin = (root, candidate) => {
  const offset = relative(root, candidate);
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset));
};

const validatePortablePath = (value, path, errors) => {
  if (!isText(value)) {
    errors.push(`${path}: required non-empty path`);
    return false;
  }
  if (
    value.includes('\\')
    || isAbsolute(value)
    || /^[A-Za-z]:/.test(value)
    || value === '.'
    || posix.normalize(value) !== value
    || value.split('/').includes('..')
    || /[*?\[\]{}]/.test(value)
    || hasUnresolvedPlaceholder(value)
  ) {
    errors.push(`${path}: must be a normalized repository-relative path without traversal, globs, or placeholders`);
    return false;
  }
  return true;
};

const validateTaskPaths = (task, index, errors, workspace) => {
  const fields = {
    read_first: Array.isArray(task.read_first) ? task.read_first : [],
    files: Array.isArray(task.files) ? task.files : [],
    new_files: task.new_files === undefined
      ? []
      : requireArray(task.new_files, `tasks[${index}].new_files`, errors),
  };
  const validFields = {};
  for (const [field, paths] of Object.entries(fields)) {
    const seen = new Set();
    validFields[field] = [];
    paths.forEach((value, pathIndex) => {
      const label = `tasks[${index}].${field}[${pathIndex}]`;
      if (!validatePortablePath(value, label, errors)) return;
      if (seen.has(value)) errors.push(`${label}: duplicate path`);
      seen.add(value);
      validFields[field].push([value, pathIndex]);
    });
  }

  const readFirst = new Set(validFields.read_first.map(([value]) => value));
  const files = new Set(validFields.files.map(([value]) => value));
  const newFiles = new Set(validFields.new_files.map(([value]) => value));
  for (const value of newFiles) {
    if (!files.has(value)) errors.push(`tasks[${index}].new_files: "${value}" must also appear in files`);
    if (readFirst.has(value)) errors.push(`tasks[${index}].new_files: "${value}" must not appear in read_first`);
  }
  if (!workspace) return;

  let root;
  try {
    root = realpathSync(resolve(workspace));
  } catch {
    errors.push('workspace: path does not exist or cannot be resolved');
    return;
  }
  const validateExisting = (value, label) => {
    const candidate = resolve(root, value);
    if (!isWithin(root, candidate) || !existsSync(candidate)) {
      errors.push(`${label}: path does not exist in the workspace`);
      return;
    }
    try {
      if (!isWithin(root, realpathSync(candidate))) errors.push(`${label}: path resolves outside the workspace`);
    } catch {
      errors.push(`${label}: path cannot be resolved in the workspace`);
    }
  };
  for (const field of ['read_first', 'files']) {
    validFields[field].forEach(([value, pathIndex]) => {
      if (!newFiles.has(value)) validateExisting(value, `tasks[${index}].${field}[${pathIndex}]`);
    });
  }
  validFields.new_files.forEach(([value, pathIndex]) => {
    const label = `tasks[${index}].new_files[${pathIndex}]`;
    const candidate = resolve(root, value);
    if (existsSync(candidate)) {
      errors.push(`${label}: declared new path already exists in the workspace`);
      return;
    }
    let ancestor = dirname(candidate);
    while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor);
    let resolvedAncestor;
    try {
      resolvedAncestor = realpathSync(ancestor);
    } catch {
      errors.push(`${label}: nearest existing ancestor cannot be resolved`);
      return;
    }
    if (!isWithin(root, ancestor) || !isWithin(root, resolvedAncestor)) {
      errors.push(`${label}: nearest existing ancestor resolves outside the workspace`);
    }
  });
};

const validateEvidence = (items, errors, { requireFreshness = false } = {}) => {
  const states = new Set(['verified', 'supported', 'inferred', 'unknown']);
  items.forEach((item, index) => {
    if (!isObject(item)) errors.push(`evidence[${index}]: required object`);
    else {
      requireTextFields(item, `evidence[${index}]`, ['claim', 'source'], errors);
      if (!states.has(item.status)) errors.push(`evidence[${index}].status: invalid evidence state`);
      if (requireFreshness || item.observed_at !== undefined) {
        if (!isObservedAt(item.observed_at)) {
          errors.push(`evidence[${index}].observed_at: required RFC 3339 timestamp with timezone`);
        }
      }
      if (requireFreshness || item.confidence !== undefined) {
        if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
          errors.push(`evidence[${index}].confidence: required number from 0 to 1`);
        }
      }
      if (item.conflicts !== undefined) {
        requireTextArray(item.conflicts, `evidence[${index}].conflicts`, errors);
      }
      if (item.kind !== undefined && !['user', 'repo'].includes(item.kind)) {
        errors.push(`evidence[${index}].kind: must be user|repo when present`);
      }
    }
  });
};

const DELEGATION_PROFILES = ['inherit', 'economy', 'balanced', 'deep', 'research', 'frontier'];
const DELEGATION_RISKS = ['low', 'moderate', 'high', 'critical'];
const DELEGATION_TASK_MAX_BYTES = 64_000;
const DELEGATION_RESULT_MAX_BYTES = 32_000;

const sortJson = (value) => {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
  );
};

export const canonicalDelegationJson = (value) => JSON.stringify(sortJson(value));
export const canonicalDelegationBytes = (value) =>
  Buffer.byteLength(canonicalDelegationJson(value), 'utf8');
export const delegationTaskDigest = (value) =>
  createHash('sha256').update(canonicalDelegationJson(value), 'utf8').digest('hex');

const requireMaxBytes = (value, path, maximum, errors) => {
  const size = canonicalDelegationBytes(value);
  if (size > maximum) errors.push(`${path}: canonical JSON is ${size} UTF-8 bytes; maximum is ${maximum}`);
};

const requireMaxItems = (value, path, maximum, errors) => {
  const items = requireArray(value, path, errors);
  if (items.length > maximum) errors.push(`${path}: maximum ${maximum} items`);
  return items;
};

const requireBoundedText = (value, path, maximum, errors, { nullable = false } = {}) => {
  if (nullable && value === null) return;
  if (!isText(value)) {
    errors.push(`${path}: required ${nullable ? 'null or ' : ''}string`);
    return;
  }
  const size = Buffer.byteLength(value, 'utf8');
  if (size > maximum) errors.push(`${path}: maximum ${maximum} UTF-8 bytes`);
};

const requireBoundedTextArray = (value, path, maximumItems, maximumBytes, errors) => {
  const items = requireMaxItems(value, path, maximumItems, errors);
  items.forEach((item, index) => requireBoundedText(item, `${path}[${index}]`, maximumBytes, errors));
  return items;
};

const validateDelegationVersion = (payload, errors, allowed) => {
  if (!isObject(payload)) {
    errors.push('payload: required object');
    return false;
  }
  if (!allowed.includes(payload.contract_version)) {
    errors.push(
      `contract_version: unsupported version "${payload.contract_version}"; expected ${allowed.join('|')}`,
    );
    return false;
  }
  return true;
};

const validateDelegationResultV1 = (payload, errors) => {
  requireTextFields(payload, 'result', ['task_id'], errors);
  requireEnum(payload.status, 'result.status', ['ok', 'error'], errors);
  if (payload.status === 'ok') {
    if (!isObject(payload.output)) errors.push('result.output: required object when status is ok');
    if (payload.error !== null) errors.push('result.error: must be null when status is ok');
  }
  if (payload.status === 'error') {
    if (payload.output !== null) errors.push('result.output: must be null when status is error');
    if (!isObject(payload.error)) errors.push('result.error: required object when status is error');
    else {
      requireTextFields(payload.error, 'result.error', ['code', 'message'], errors);
      if (typeof payload.error.retryable !== 'boolean') {
        errors.push('result.error.retryable: required boolean');
      }
    }
  }
};

export function validateDelegationTaskContract(payload) {
  const errors = [];
  if (!validateDelegationVersion(payload, errors, [2])) return errors;
  requireMaxBytes(payload, 'task', DELEGATION_TASK_MAX_BYTES, errors);
  requireTextFields(payload, 'task', ['task_id', 'delegation_id', 'role', 'objective'], errors);
  requireEnum(payload.profile, 'task.profile', DELEGATION_PROFILES, errors);
  requireEnum(payload.risk, 'task.risk', DELEGATION_RISKS, errors);
  if (typeof payload.requires_judgment !== 'boolean') {
    errors.push('task.requires_judgment: required boolean');
  }
  for (const [field, maximum] of [
    ['locked_decisions', 5],
    ['corrections', 5],
    ['constraints', 8],
    ['deliverables', 8],
    ['acceptance_criteria', 8],
  ]) {
    requireTextArray(
      requireMaxItems(payload[field], `task.${field}`, maximum, errors),
      `task.${field}`,
      errors,
    );
  }
  const writeScope = requireMaxItems(payload.write_scope, 'task.write_scope', 12, errors);
  writeScope.forEach((value, index) => {
    validatePortablePath(value, `task.write_scope[${index}]`, errors);
  });
  const contextRefs = requireMaxItems(payload.context_refs, 'task.context_refs', 8, errors);
  contextRefs.forEach((item, index) => {
    const label = `task.context_refs[${index}]`;
    if (!isObject(item)) {
      errors.push(`${label}: required object`);
      return;
    }
    requireTextFields(item, label, ['id', 'locator', 'content_sha256'], errors);
    requireEnum(item.kind, `${label}.kind`, ['artifact', 'resource'], errors);
    requireEnum(item.source, `${label}.source`, ['workspace', 'session'], errors);
    validatePortablePath(item.locator, `${label}.locator`, errors);
    if (!/^[a-f0-9]{64}$/.test(item.content_sha256 || '')) {
      errors.push(`${label}.content_sha256: required lowercase 64-hex digest`);
    }
    if (!isObservedAt(item.observed_at)) {
      errors.push(`${label}.observed_at: required RFC 3339 timestamp with timezone`);
    }
  });
  duplicateIds(contextRefs, 'task.context_refs', errors);
  return errors;
}

export function validateDelegationResultContract(payload, { allowVersion1 = false } = {}) {
  const errors = [];
  if (!validateDelegationVersion(payload, errors, allowVersion1 ? [1, 2] : [2])) return errors;
  if (payload.contract_version === 1) {
    validateDelegationResultV1(payload, errors);
    return errors;
  }

  requireMaxBytes(payload, 'result', DELEGATION_RESULT_MAX_BYTES, errors);
  requireTextFields(payload, 'result', ['task_id', 'delegation_id'], errors);
  if (!/^[a-f0-9]{64}$/.test(payload.task_digest || '')) {
    errors.push('result.task_digest: required lowercase 64-hex digest');
  }
  requireEnum(payload.status, 'result.status', ['ok', 'error'], errors);
  if (payload.status === 'ok') {
    if (!isObject(payload.output)) errors.push('result.output: required object when status is ok');
    else {
      requireBoundedText(payload.output.summary, 'result.output.summary', 8_000, errors);
      requireBoundedTextArray(
        payload.output.files_changed,
        'result.output.files_changed',
        12,
        2_000,
        errors,
      );
      const checks = requireMaxItems(payload.output.checks, 'result.output.checks', 12, errors);
      checks.forEach((check, index) => {
        const label = `result.output.checks[${index}]`;
        if (!isObject(check)) {
          errors.push(`${label}: required object`);
          return;
        }
        requireTextFields(check, label, ['name'], errors);
        requireEnum(check.status, `${label}.status`, ['passed', 'failed', 'skipped'], errors);
        if (check.summary !== undefined) {
          requireBoundedText(check.summary, `${label}.summary`, 2_000, errors);
        }
      });
      requireBoundedTextArray(payload.output.findings, 'result.output.findings', 8, 2_000, errors);
      requireBoundedTextArray(payload.output.risks, 'result.output.risks', 8, 2_000, errors);
      requireBoundedText(
        payload.output.blocker,
        'result.output.blocker',
        4_000,
        errors,
        { nullable: true },
      );
    }
    if (payload.error !== null) errors.push('result.error: must be null when status is ok');
  }
  if (payload.status === 'error') {
    if (payload.output !== null) errors.push('result.output: must be null when status is error');
    if (!isObject(payload.error)) errors.push('result.error: required object when status is error');
    else {
      requireTextFields(payload.error, 'result.error', ['code', 'message'], errors);
      if (typeof payload.error.retryable !== 'boolean') {
        errors.push('result.error.retryable: required boolean');
      }
    }
  }
  return errors;
}

const validateTaskGraph = (tasks, errors) => {
  const ids = new Set();
  for (const [index, task] of tasks.entries()) {
    if (!isObject(task) || !isText(task.id)) continue;
    if (ids.has(task.id)) errors.push(`tasks[${index}].id: duplicate task id "${task.id}"`);
    ids.add(task.id);
  }

  const byId = new Map(
    tasks.filter((task) => isObject(task) && isText(task.id)).map((task) => [task.id, task]),
  );
  for (const [index, task] of tasks.entries()) {
    if (!isObject(task) || !Array.isArray(task.dependsOn)) continue;
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) errors.push(`tasks[${index}].dependsOn: task cannot depend on itself`);
      else if (!ids.has(dependency)) errors.push(`tasks[${index}].dependsOn: unknown task id "${dependency}"`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const task = byId.get(id);
    for (const dependency of Array.isArray(task?.dependsOn) ? task.dependsOn : []) {
      if (byId.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of byId.keys()) {
    if (visit(id)) {
      errors.push('tasks[].dependsOn: dependency cycle detected');
      break;
    }
  }
  return ids;
};

const validatePlan = (
  payload,
  errors,
  {
    enforceCanonicalQuick = false,
    enforceEvidenceFreshness = false,
    enforcePathProvenance = false,
    workspace,
  } = {},
) => {
  for (const key of ['decision', 'outcome', 'scope', 'validation']) {
    if (!isObject(payload[key])) errors.push(`${key}: required object`);
  }
  const depth = payload.depth;
  const enriched = hasAnyField(payload, ['change_set', 'scenarios', 'coverage', 'readiness']);
  requireEnum(depth, 'depth', ['quick', 'standard', 'deep'], errors);
  if (depth === 'quick' && enforceCanonicalQuick) {
    for (const field of ['solution_shape', 'change_set', 'readiness']) {
      if (payload[field] !== undefined) errors.push(`${field}: omit for quick plans`);
    }
    for (const field of ['scenarios', 'alternatives', 'coverage']) {
      if (!Array.isArray(payload[field])) errors.push(`${field}: required empty array for quick plans`);
      else if (payload[field].length > 0) errors.push(`${field}: must be empty for quick plans`);
    }
  }
  if (depth !== 'quick' && !isObject(payload.solution_shape)) errors.push('solution_shape: required object');
  if (!isText(payload.problem)) errors.push('problem: required string');
  if (isObject(payload.decision)) {
    requireTextFields(payload.decision, 'decision', ['question', 'recommendation'], errors);
    requireArray(payload.decision.rationale, 'decision.rationale', errors, true);
    if (!['pending', 'delegated'].includes(payload.decision.status)) {
      errors.push('decision.status: must be pending|delegated');
    }
  }
  validatePlanBriefing(payload, errors);
  if (isObject(payload.outcome)) {
    requireTextFields(payload.outcome, 'outcome', ['goal'], errors);
    requireArray(payload.outcome.doneWhen, 'outcome.doneWhen', errors, true);
    if (payload.outcome.signal !== undefined && !isText(payload.outcome.signal)) {
      errors.push('outcome.signal: must be a non-empty string when present');
    }
  }
  if (depth !== 'quick') {
    const keys = ['security', 'privacy', 'observability', 'rollout', 'docs'];
    if (!isObject(payload.crossCutting)) errors.push('crossCutting: required object');
    else {
      for (const key of keys) {
        const item = payload.crossCutting[key];
        if (!isObject(item)) {
          errors.push(`crossCutting.${key}: required object`);
          continue;
        }
        if (!['n/a', 'note'].includes(item.status)) {
          errors.push(`crossCutting.${key}.status: must be n/a|note`);
        }
        if (!isText(item.detail)) errors.push(`crossCutting.${key}.detail: required string`);
      }
    }
  }
  if (isObject(payload.scope)) {
    for (const field of ['in', 'out', 'constraints']) requireArray(payload.scope[field], `scope.${field}`, errors);
  }
  if (isObject(payload.solution_shape)) {
    requireTextFields(payload.solution_shape, 'solution_shape', ['summary'], errors);
    requireArray(payload.solution_shape.components, 'solution_shape.components', errors, true);
    requireArray(payload.solution_shape.dataFlow, 'solution_shape.dataFlow', errors, true);
  }
  if (enriched && depth !== 'quick' && !isObject(payload.change_set)) errors.push('change_set: required object');
  if (isObject(payload.change_set)) {
    const changes = ['added', 'modified', 'removed', 'unchanged']
      .flatMap((field) => requireArray(payload.change_set[field], `change_set.${field}`, errors));
    if (enriched && depth !== 'quick' && changes.length === 0) errors.push('change_set: at least one change is required');
  }
  const scenarios = payload.scenarios === undefined && (!enriched || depth === 'quick')
    ? []
    : requireArray(payload.scenarios, 'scenarios', errors, enriched && depth !== 'quick');
  scenarios.forEach((scenario, index) => {
    if (!isObject(scenario)) errors.push(`scenarios[${index}]: required object`);
    else requireTextFields(scenario, `scenarios[${index}]`, ['id', 'given', 'when', 'then'], errors);
  });
  const scenarioIds = duplicateIds(scenarios, 'scenarios', errors);
  const evidence = requireArray(payload.evidence, 'evidence', errors, true);
  validateEvidence(evidence, errors, { requireFreshness: enforceEvidenceFreshness });
  validateEvidenceImplications(evidence, depth, errors);
  const alternatives = requireArray(payload.alternatives, 'alternatives', errors);
  if (depth !== 'quick' && alternatives.length === 0) errors.push('alternatives: required non-empty array');
  validateAlternativeReasons(alternatives, errors);
  requireArray(payload.assumptions, 'assumptions', errors);
  requireArray(payload.open_questions, 'open_questions', errors);
  requireArray(payload.risks, 'risks', errors);
  if (isObject(payload.validation)) {
    requireTextFields(payload.validation, 'validation', ['strategy'], errors);
    requireArray(payload.validation.definitionOfDone, 'validation.definitionOfDone', errors, true);
    requireArray(payload.validation.checks, 'validation.checks', errors, true);
  }
  const tasks = requireArray(payload.tasks, 'tasks', errors, true);
  tasks.forEach((task, index) => {
    if (!isObject(task)) errors.push(`tasks[${index}]: required object`);
    else {
      requireTextFields(task, `tasks[${index}]`, ['id', 'description', 'action', 'verify'], errors);
      requireArray(task.read_first, `tasks[${index}].read_first`, errors, true);
      requireArray(task.files, `tasks[${index}].files`, errors, true);
      if (enforcePathProvenance) validateTaskPaths(task, index, errors, workspace);
      requireArray(task.acceptance_criteria, `tasks[${index}].acceptance_criteria`, errors, true);
      for (const field of ['consumes', 'produces']) {
        if (task[field] !== undefined || (enriched && depth !== 'quick')) {
          requireArray(task[field], `tasks[${index}].${field}`, errors, enriched && depth !== 'quick');
        }
      }
      if (task.dependsOn !== undefined && !Array.isArray(task.dependsOn)) {
        errors.push(`tasks[${index}].dependsOn: must be array if present`);
      }
      if (!['economy', 'balanced', 'deep'].includes(task.profile)) {
        errors.push(`tasks[${index}].profile: invalid profile`);
      }
      if (depth !== 'quick') requireTextFields(task, `tasks[${index}]`, ['risk', 'recovery'], errors);
      for (const [field, value] of [
        ['action', task.action],
        ['verify', task.verify],
        ['acceptance_criteria', Array.isArray(task.acceptance_criteria) ? task.acceptance_criteria.join(' ') : ''],
      ]) {
        if (hasUnresolvedPlaceholder(value)) {
          errors.push(`tasks[${index}].${field}: unresolved placeholder is not allowed`);
        }
      }
    }
  });
  const taskIds = validateTaskGraph(tasks, errors);
  const coverage = payload.coverage === undefined && (!enriched || depth === 'quick')
    ? []
    : requireArray(payload.coverage, 'coverage', errors, enriched && depth !== 'quick');
  const coveredTasks = new Set();
  coverage.forEach((item, index) => {
    if (!isObject(item)) {
      errors.push(`coverage[${index}]: required object`);
      return;
    }
    requireTextFields(item, `coverage[${index}]`, ['requirement'], errors);
    const coveredScenarioIds = requireArray(item.scenarioIds, `coverage[${index}].scenarioIds`, errors, true);
    const coveredTaskIds = requireArray(item.taskIds, `coverage[${index}].taskIds`, errors, true);
    requireArray(item.checks, `coverage[${index}].checks`, errors, true);
    coveredScenarioIds.forEach((id) => {
      if (!scenarioIds.includes(id)) errors.push(`coverage[${index}].scenarioIds: unknown scenario id "${id}"`);
    });
    coveredTaskIds.forEach((id) => {
      if (!taskIds.has(id)) errors.push(`coverage[${index}].taskIds: unknown task id "${id}"`);
      else coveredTasks.add(id);
    });
  });
  if (enriched && depth !== 'quick') {
    for (const id of taskIds) if (!coveredTasks.has(id)) errors.push(`coverage: task "${id}" is not covered`);
  }
  if (enriched && depth !== 'quick' && !isObject(payload.readiness)) errors.push('readiness: required object');
  if (isObject(payload.readiness)) {
    requireEnum(payload.readiness.verdict, 'readiness.verdict', ['READY', 'CONCERNS', 'BLOCKED'], errors);
    requireArray(payload.readiness.reasons, 'readiness.reasons', errors, true);
    requireArray(payload.readiness.unresolved, 'readiness.unresolved', errors);
  }
};

const validateBrainstorm = (payload, errors, { enforceEvidenceFreshness = false } = {}) => {
  validateBriefing(payload, errors, ['tackling', 'problem', 'how', 'scope', 'risks']);
  const enriched = hasAnyField(payload, ['depth', 'stance', 'phase', 'ideas', 'clusters', 'shortlist', 'dissent']);
  const depth = payload.depth;
  const phase = payload.phase;
  const phases = ['frame', 'diverge', 'cluster', 'converge', 'decision'];
  const phaseAtLeast = (target) => phases.includes(phase) && phases.indexOf(phase) >= phases.indexOf(target);
  if (enriched) {
    requireEnum(depth, 'depth', ['quick', 'standard', 'deep'], errors);
    if (!isObject(payload.stance)) errors.push('stance: required object');
    else {
      requireEnum(payload.stance.mode, 'stance.mode', ['facilitator', 'creative-partner', 'generate-for-me'], errors);
      requireTextFields(payload.stance, 'stance', ['reason'], errors);
    }
    requireEnum(phase, 'phase', phases, errors);
  }
  if (!isObject(payload.decision)) errors.push('decision: required object');
  else {
    requireTextFields(payload.decision, 'decision', ['question', 'outcome'], errors);
    requireArray(payload.decision.constraints, 'decision.constraints', errors);
    requireArray(payload.decision.nonGoals, 'decision.nonGoals', errors);
    requireTextFields(payload.decision, 'decision', ['successSignal'], errors);
    if (enriched) {
      requireArray(payload.decision.audience, 'decision.audience', errors, true);
    }
    requireArray(payload.decision.evaluationCriteria, 'decision.evaluationCriteria', errors, true);
  }
  const evidence = requireArray(payload.evidence, 'evidence', errors, true);
  validateEvidence(evidence, errors, { requireFreshness: enforceEvidenceFreshness });
  requireArray(payload.openQuestions, 'openQuestions', errors);
  const ideas = payload.ideas === undefined && !phaseAtLeast('diverge')
    ? []
    : requireArray(payload.ideas, 'ideas', errors, phaseAtLeast('diverge'));
  ideas.forEach((idea, index) => {
    if (!isObject(idea)) errors.push(`ideas[${index}]: required object`);
    else {
      requireTextFields(idea, `ideas[${index}]`, ['id', 'title', 'summary', 'lens', 'technique'], errors);
      requireArray(idea.evidence, `ideas[${index}].evidence`, errors);
      requireArray(idea.assumptions, `ideas[${index}].assumptions`, errors);
    }
  });
  const ideaIds = duplicateIds(ideas, 'ideas', errors);
  const clustersRequired = phaseAtLeast('cluster') && depth !== 'quick';
  const clusters = payload.clusters === undefined && !clustersRequired
    ? []
    : requireArray(payload.clusters, 'clusters', errors, clustersRequired);
  const clusteredIdeas = new Set();
  clusters.forEach((cluster, index) => {
    if (!isObject(cluster)) {
      errors.push(`clusters[${index}]: required object`);
      return;
    }
    requireTextFields(cluster, `clusters[${index}]`, ['id', 'name', 'insight'], errors);
    const memberIds = requireArray(cluster.ideaIds, `clusters[${index}].ideaIds`, errors, true);
    memberIds.forEach((id) => {
      if (!ideaIds.includes(id)) errors.push(`clusters[${index}].ideaIds: unknown idea id "${id}"`);
      else clusteredIdeas.add(id);
    });
  });
  duplicateIds(clusters, 'clusters', errors);
  if (phaseAtLeast('cluster') && depth !== 'quick') {
    for (const id of ideaIds) if (!clusteredIdeas.has(id)) errors.push(`clusters: idea "${id}" is not connected`);
  }
  const approachesRequired = !enriched || phaseAtLeast('converge');
  const approaches = payload.approaches === undefined && !approachesRequired
    ? []
    : requireArray(payload.approaches, 'approaches', errors, approachesRequired);
  if (approaches.length > 0 && (approaches.length < 2 || approaches.length > 3)) {
    errors.push('approaches: contract v3 requires 2-3 approaches');
  }
  const ids = [];
  approaches.forEach((approach, index) => {
    if (!isObject(approach)) {
      errors.push(`approaches[${index}]: required object`);
      return;
    }
    requireTextFields(
      approach,
      `approaches[${index}]`,
      ['id', 'name', 'thesis', 'description', 'whyLens', 'effort', 'risk', 'reversibility', 'whenToPick'],
      errors,
    );
    requireArray(approach.whatBreaks, `approaches[${index}].whatBreaks`, errors, true);
    if (approach.visualType !== undefined && !['diagram', 'flow', 'sitemap', 'mockup', null].includes(approach.visualType)) {
      errors.push(`approaches[${index}].visualType: invalid visual type`);
    }
    if (approach.mutualExclusivity !== undefined && !Array.isArray(approach.mutualExclusivity)) {
      errors.push(`approaches[${index}].mutualExclusivity: must be array if present`);
    }
    if (isText(approach.id)) ids.push(approach.id);
  });
  if (new Set(ids).size !== ids.length) errors.push('approaches[].id: duplicate approach id');
  validateApproachDistinctness(approaches, errors);
  if (enriched && ideas.length < approaches.length) {
    errors.push('ideas: divergence must contain at least as many ideas as shortlisted approaches');
  }
  approaches.forEach((approach, index) => {
    if (!isObject(approach) || !Array.isArray(approach.mutualExclusivity)) return;
    for (const excluded of approach.mutualExclusivity) {
      if (excluded === approach.id) {
        errors.push(`approaches[${index}].mutualExclusivity: approach cannot exclude itself`);
      } else if (!ids.includes(excluded)) {
        errors.push(`approaches[${index}].mutualExclusivity: unknown approach id "${excluded}"`);
      }
    }
  });
  const decisionStage = !enriched || phase === 'decision';
  if (decisionStage && !isObject(payload.recommendedDefault)) errors.push('recommendedDefault: required object');
  if (isObject(payload.recommendedDefault)) {
    requireTextFields(payload.recommendedDefault, 'recommendedDefault', ['id', 'reason'], errors);
    if (!ids.includes(payload.recommendedDefault.id)) errors.push('recommendedDefault.id: unknown approach id');
  }
  const shortlistRequired = enriched && phaseAtLeast('converge');
  const shortlist = payload.shortlist === undefined && !shortlistRequired
    ? []
    : requireArray(payload.shortlist, 'shortlist', errors, shortlistRequired);
  const shortlisted = new Set();
  shortlist.forEach((item, index) => {
    if (!isObject(item)) {
      errors.push(`shortlist[${index}]: required object`);
      return;
    }
    requireTextFields(item, `shortlist[${index}]`, ['approachId', 'reservation'], errors);
    requireArray(item.drivers, `shortlist[${index}].drivers`, errors, true);
    if (!ids.includes(item.approachId)) errors.push(`shortlist[${index}].approachId: unknown approach id`);
    if (shortlisted.has(item.approachId)) errors.push(`shortlist[${index}].approachId: duplicate approach id`);
    shortlisted.add(item.approachId);
  });
  if (shortlistRequired) {
    for (const id of ids) if (!shortlisted.has(id)) errors.push(`shortlist: approach "${id}" is not represented`);
  }
  if (phase === 'decision' && depth !== 'quick' && !isObject(payload.dissent)) errors.push('dissent: required object');
  if (isObject(payload.dissent)) {
    requireTextFields(payload.dissent, 'dissent', ['approachId', 'case', 'trigger'], errors);
    if (!ids.includes(payload.dissent.approachId)) errors.push('dissent.approachId: unknown approach id');
    if (payload.dissent.approachId === payload.recommendedDefault?.id) {
      errors.push('dissent.approachId: must challenge the recommended approach');
    }
  }
  if (decisionStage && !isObject(payload.cheapestExperiment)) errors.push('cheapestExperiment: required object');
  if (payload.cheapestExperiment?.status === 'not-applicable') {
    requireTextFields(payload.cheapestExperiment, 'cheapestExperiment', ['reason'], errors);
  } else if (isObject(payload.cheapestExperiment)) {
    requireTextFields(payload.cheapestExperiment, 'cheapestExperiment', ['question', 'method', 'successSignal', 'cost'], errors);
  }
  if (decisionStage && !isObject(payload.directionGate)) errors.push('directionGate: required object');
  if (isObject(payload.directionGate)) {
    requireTextFields(payload.directionGate, 'directionGate', ['question'], errors);
    const options = requireArray(payload.directionGate.options, 'directionGate.options', errors, true);
    for (const option of options) if (!ids.includes(option)) errors.push(`directionGate.options: unknown approach id "${option}"`);
  }
};

export function validateDecisionContract(
  type,
  payload,
  {
    requireV3 = false,
    enforceCanonicalQuick = false,
    enforceEvidenceFreshness = false,
    enforcePathProvenance = false,
    workspace,
  } = {},
) {
  const errors = [];
  if (!isObject(payload)) {
    if (requireV3) errors.push('payload: required object');
    return errors;
  }
  if (payload.contract_version === undefined) {
    if (requireV3) errors.push('contract_version: required and must be 3');
    return errors;
  }
  if (payload.contract_version !== 3) {
    errors.push(`contract_version: unsupported version "${payload.contract_version}"; expected 3`);
    return errors;
  }
  if (!['plan', 'brainstorm'].includes(type)) {
    errors.push(`artifact type: unsupported decision contract type "${type}"`);
    return errors;
  }
  if (type === 'plan') {
    validatePlan(payload, errors, {
      enforceCanonicalQuick,
      enforceEvidenceFreshness,
      enforcePathProvenance,
      workspace,
    });
  }
  else validateBrainstorm(payload, errors, { enforceEvidenceFreshness });
  return errors;
}
