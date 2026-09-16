'use strict';

// Lean orchestration policy for Gorkhali.
//
// The router stays deterministic on purpose: role defaults come from
// config/role-tiers.json, risk signals raise only the roles that benefit from
// more reasoning, and parallel execution is opt-in plus conflict checked.

const { tierForRole } = require('./tiers.js');
const path = require('node:path');
const { validateTaskGraph } = require('./plan-schema.js');

const policy = require('../config/routing.json');
const THRESHOLDS = Object.freeze(policy.thresholds);
const RISK_WEIGHTS = Object.freeze(policy.weights);

function scoreRisk(input = {}) {
  const signals = input.riskSignals && typeof input.riskSignals === 'object' ? input.riskSignals : input;
  let score = 0;

  for (const [signal, weight] of Object.entries(RISK_WEIGHTS)) {
    if (signals[signal] === true) score += weight;
  }

  const implementationFailures = Number.isInteger(input.implementationFailures)
    ? Math.max(0, input.implementationFailures)
    : 0;
  const verificationFailures = Number.isInteger(input.verificationFailures)
    ? Math.max(0, input.verificationFailures)
    : 0;

  score += Math.min(implementationFailures, THRESHOLDS.failureCap);
  score += Math.min(verificationFailures, THRESHOLDS.failureCap);
  return score;
}

function tierForTask(role, input = {}) {
  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : role;
  const baseTier = tierForRole(normalizedRole);
  if (!baseTier) return null;

  const risk = scoreRisk(input);
  const implementationFailures = input.implementationFailures || 0;
  const verificationFailures = input.verificationFailures || 0;

  if (normalizedRole === 'engineer') {
    return risk >= THRESHOLDS.engineer || implementationFailures >= THRESHOLDS.implementationFailures ? 'deep' : 'balanced';
  }

  if (normalizedRole === 'auditor') {
    return risk >= THRESHOLDS.auditor || verificationFailures >= 1 ? 'deep' : 'balanced';
  }

  if (normalizedRole === 'opposition') {
    return risk >= THRESHOLDS.opposition ? 'deep' : 'balanced';
  }

  return baseTier;
}

function normalizeStrings(values) {
  if (!Array.isArray(values)) return new Set();
  return new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()));
}

function setsOverlap(left, right) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

// Concrete relative paths or directories. Uncertain ownership stays serial.
function ownedPath(value) {
  if (typeof value !== 'string' || !value.trim() || /[\\\\*?\[\]{}\x00-\x1f]/.test(value) || path.posix.isAbsolute(value)) return null;
  const normalized = path.posix.normalize(value.trim()).replace(/\/$/, '');
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || /^[A-Za-z]:/.test(normalized)) return null;
  return normalized;
}

function pathsOverlap(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}

function dependsOn(task, candidateId, byId, seen = new Set()) {
  if (!task || !Array.isArray(task.dependsOn) || seen.has(task.id)) return false;
  seen.add(task.id);

  for (const dependencyId of task.dependsOn) {
    if (dependencyId === candidateId) return true;
    if (dependsOn(byId.get(dependencyId), candidateId, byId, seen)) return true;
  }
  return false;
}

function hasHighConflictRisk(task) {
  const signals = task && task.riskSignals;
  if (!signals || typeof signals !== 'object') return false;
  return signals.destructiveData === true || signals.publicContract === true || signals.migration === true;
}

function canRunInParallel(left, right, allTasks = []) {
  if (!left || !right || left.id === right.id) return false;
  if (left.parallelSafe !== true || right.parallelSafe !== true) return false;
  if (hasHighConflictRisk(left) || hasHighConflictRisk(right)) return false;
  const graph = allTasks.length ? allTasks : [left, right];
  const errors = [];
  validateTaskGraph(graph, errors);
  if (errors.length) return false;
  for (const task of [left, right]) {
    if (task.coordinationKeys !== undefined && (!Array.isArray(task.coordinationKeys) || task.coordinationKeys.some((key) => typeof key !== 'string' || !key.trim()))) return false;
    if (task.riskSignals !== undefined && (!task.riskSignals || Array.isArray(task.riskSignals) || typeof task.riskSignals !== 'object' || Object.entries(task.riskSignals).some(([key, value]) => !Object.hasOwn(RISK_WEIGHTS, key) || typeof value !== 'boolean'))) return false;
  }

  const byId = new Map(graph.map((task) => [task.id, task]));
  if (dependsOn(left, right.id, byId) || dependsOn(right, left.id, byId)) return false;

  if (!Array.isArray(left.files) || !left.files.length || !Array.isArray(right.files) || !right.files.length) return false;
  const leftFiles = left.files.map(ownedPath);
  const rightFiles = right.files.map(ownedPath);
  if (leftFiles.includes(null) || rightFiles.includes(null)) return false;
  if (leftFiles.some((a) => rightFiles.some((b) => pathsOverlap(a, b)))) return false;

  const leftKeys = normalizeStrings(left.coordinationKeys);
  const rightKeys = normalizeStrings(right.coordinationKeys);
  if (setsOverlap(leftKeys, rightKeys)) return false;

  return true;
}

function buildExecutionWaves(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];

  const errors = [];
  validateTaskGraph(tasks, errors);
  if (new Set(tasks.map((task) => task?.id)).size !== tasks.length) errors.push('duplicate task id');
  if (errors.length) throw new Error(errors.join('; '));

  const completed = new Set();
  const scheduled = new Set();
  const waves = [];

  while (scheduled.size < tasks.length) {
    const ready = tasks.filter((task) => {
      if (scheduled.has(task.id)) return false;
      const dependencies = Array.isArray(task.dependsOn) ? task.dependsOn : [];
      return dependencies.every((id) => completed.has(id));
    });

    if (ready.length === 0) {
      throw new Error('task graph has no schedulable task; validate dependencies before routing');
    }

    const wave = [ready[0]];
    if (ready[0].parallelSafe === true) {
      for (const candidate of ready.slice(1)) {
        if (wave.every((selected) => canRunInParallel(selected, candidate, tasks))) wave.push(candidate);
      }
    }

    waves.push(wave.map((task) => task.id));
    for (const task of wave) {
      scheduled.add(task.id);
      completed.add(task.id);
    }
  }

  return waves;
}

function hasActiveEngineers(state) {
  const value = state && state.activeEngineers;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Set) return value.size > 0;
  return false;
}

function otherPendingIds(task, state) {
  const pending = state && Array.isArray(state.pending) ? state.pending : [];
  return pending.filter((id) => id !== task.id);
}

// Subsumed by otherPendingIds, but checked on its own so the code names the
// two documented conditions the table calls out explicitly.
function otherPendingTaskDependsOnThis(task, plan, state) {
  const pendingIds = new Set(otherPendingIds(task, state));
  const tasks = plan && Array.isArray(plan.tasks) ? plan.tasks : [];
  return tasks.some((other) => pendingIds.has(other.id) && Array.isArray(other.dependsOn) && other.dependsOn.includes(task.id));
}

function otherPendingTaskSharesCoordinationKey(task, plan, state) {
  const pendingIds = new Set(otherPendingIds(task, state));
  const tasks = plan && Array.isArray(plan.tasks) ? plan.tasks : [];
  const ownKeys = normalizeStrings(task.coordinationKeys);
  if (ownKeys.size === 0) return false;
  return tasks.some((other) => pendingIds.has(other.id) && setsOverlap(ownKeys, normalizeStrings(other.coordinationKeys)));
}

// Decides whether an Engineer runs in its own worktree or shares a branch.
// Structural rails (multi-task waves, other active Engineers, an explicit
// choice) are checked before the "auto" heuristics that look at coordination
// with other pending work and risk-driven tier escalation.
function isolationForTask(task, wave, plan, state = {}) {
  const explicit = (task && task.isolation) || (plan && plan.isolation) || 'auto';

  if (explicit === 'worktree') return 'worktree';
  if (Array.isArray(wave) && wave.length > 1) return 'worktree';
  if (hasActiveEngineers(state)) return 'worktree';
  if (explicit === 'branch') return 'branch';

  if (
    otherPendingIds(task, state).length > 0 ||
    otherPendingTaskDependsOnThis(task, plan, state) ||
    otherPendingTaskSharesCoordinationKey(task, plan, state)
  ) return 'worktree';

  const implementationFailures = state.implementationFailures || 0;
  const verificationFailures = state.verificationFailures || 0;
  if (tierForTask('engineer', { ...task, implementationFailures, verificationFailures }) === 'deep') return 'worktree';
  if (implementationFailures > 0) return 'worktree';

  return 'branch';
}

module.exports = {
  THRESHOLDS,
  ownedPath,
  pathsOverlap,
  RISK_WEIGHTS,
  scoreRisk,
  tierForTask,
  canRunInParallel,
  buildExecutionWaves,
  isolationForTask,
};
