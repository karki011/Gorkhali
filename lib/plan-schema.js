// Author: Subash Karki
// plan-schema.js - lean validator for the plan.json shape. Checks the fields an
// Engineer and Inspector actually read (briefing, decision, outcome, scope,
// tasks) plus the task dependency graph. Extra fields on the object are never
// flagged, so a full v3 plan validates the same as a minimal one.
'use strict';

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function requireString(obj, field, path, errors) {
  if (!isNonEmptyString(obj[field])) errors.push(`${path}.${field}: required non-empty string`);
}

function requireArray(obj, field, path, errors) {
  if (!isNonEmptyArray(obj[field])) errors.push(`${path}.${field}: required non-empty array`);
}

function validateBriefing(briefing, errors) {
  if (!isObject(briefing)) {
    errors.push('briefing: required object');
    return;
  }
  requireString(briefing, 'tackling', 'briefing', errors);
  requireString(briefing, 'problem', 'briefing', errors);
  requireString(briefing, 'how', 'briefing', errors);
}

function validateDecision(decision, errors) {
  if (!isObject(decision)) {
    errors.push('decision: required object');
    return;
  }
  requireString(decision, 'question', 'decision', errors);
  requireString(decision, 'recommendation', 'decision', errors);
  requireArray(decision, 'rationale', 'decision', errors);
  requireString(decision, 'status', 'decision', errors);
}

function validateOutcome(outcome, errors) {
  if (!isObject(outcome)) {
    errors.push('outcome: required object');
    return;
  }
  requireString(outcome, 'goal', 'outcome', errors);
  requireArray(outcome, 'doneWhen', 'outcome', errors);
}

function validateScope(scope, errors) {
  if (!isObject(scope)) {
    errors.push('scope: required object');
    return;
  }
  if (!Array.isArray(scope.in)) errors.push('scope.in: required array');
  if (!Array.isArray(scope.out)) errors.push('scope.out: required array');
}

function validateTask(task, i, errors) {
  const path = `tasks[${i}]`;
  if (!isObject(task)) {
    errors.push(`${path}: required object`);
    return;
  }
  requireString(task, 'id', path, errors);
  requireString(task, 'description', path, errors);
  requireArray(task, 'files', path, errors);
  requireString(task, 'action', path, errors);
  requireArray(task, 'acceptance_criteria', path, errors);
  requireString(task, 'verify', path, errors);
  if (task.dependsOn !== undefined && !Array.isArray(task.dependsOn)) {
    errors.push(`${path}.dependsOn: must be array if present`);
  }
}

// Unknown ids and self-dependencies, then a depth-first cycle check over the
// dependsOn edges. Non-object tasks and missing ids are skipped here; they are
// already reported by validateTask.
function validateTaskGraph(tasks, errors) {
  const ids = new Set();
  for (const task of tasks) {
    if (isObject(task) && isNonEmptyString(task.id)) ids.add(task.id);
  }

  const byId = new Map(
    tasks.filter((task) => isObject(task) && isNonEmptyString(task.id)).map((task) => [task.id, task]),
  );

  for (const [i, task] of tasks.entries()) {
    if (!isObject(task) || !Array.isArray(task.dependsOn)) continue;
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) errors.push(`tasks[${i}].dependsOn: task cannot depend on itself`);
      else if (!ids.has(dependency)) errors.push(`tasks[${i}].dependsOn: unknown task id "${dependency}"`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const task = byId.get(id);
    for (const dependency of task && Array.isArray(task.dependsOn) ? task.dependsOn : []) {
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
}

function validatePlan(plan) {
  const errors = [];
  if (!isObject(plan)) return ['plan: required object'];

  validateBriefing(plan.briefing, errors);
  validateDecision(plan.decision, errors);
  validateOutcome(plan.outcome, errors);
  validateScope(plan.scope, errors);

  if (!isNonEmptyArray(plan.tasks)) {
    errors.push('tasks: required non-empty array');
    return errors;
  }
  plan.tasks.forEach((task, i) => validateTask(task, i, errors));

  const seenIds = new Set();
  plan.tasks.forEach((task, i) => {
    if (!isObject(task) || !isNonEmptyString(task.id)) return;
    if (seenIds.has(task.id)) errors.push(`tasks[${i}].id: duplicate task id "${task.id}"`);
    seenIds.add(task.id);
  });

  validateTaskGraph(plan.tasks, errors);

  return errors;
}

module.exports = { validatePlan };
