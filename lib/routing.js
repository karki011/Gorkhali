'use strict';

// Lean orchestration policy for Gorkhali.
//
// The router stays deterministic on purpose: role defaults come from
// config/role-tiers.json, risk signals raise only the roles that benefit from
// more reasoning, and parallel execution is opt-in plus conflict checked.

const { tierForRole } = require('./tiers.js');

const RISK_WEIGHTS = Object.freeze({
  security: 2,
  destructiveData: 2,
  publicContract: 2,
  architectureAmbiguity: 2,
  crossPackage: 1,
  concurrency: 1,
  migration: 1,
  priorFailure: 1,
});

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

  score += Math.min(implementationFailures, 2);
  score += Math.min(verificationFailures, 2);
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
    return risk >= 6 || implementationFailures >= 2 ? 'deep' : 'balanced';
  }

  if (normalizedRole === 'auditor') {
    return risk >= 3 || verificationFailures >= 1 ? 'deep' : 'balanced';
  }

  if (normalizedRole === 'opposition') {
    return risk >= 6 ? 'deep' : 'balanced';
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

  const byId = new Map(allTasks.map((task) => [task.id, task]));
  if (dependsOn(left, right.id, byId) || dependsOn(right, left.id, byId)) return false;

  const leftFiles = normalizeStrings(left.files);
  const rightFiles = normalizeStrings(right.files);
  if (setsOverlap(leftFiles, rightFiles)) return false;

  const leftKeys = normalizeStrings(left.coordinationKeys);
  const rightKeys = normalizeStrings(right.coordinationKeys);
  if (setsOverlap(leftKeys, rightKeys)) return false;

  return true;
}

function buildExecutionWaves(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const completed = new Set();
  const scheduled = new Set();
  const waves = [];

  while (scheduled.size < tasks.length) {
    const ready = tasks.filter((task) => {
      if (scheduled.has(task.id)) return false;
      const dependencies = Array.isArray(task.dependsOn) ? task.dependsOn : [];
      return dependencies.every((id) => completed.has(id) || !byId.has(id));
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

module.exports = {
  RISK_WEIGHTS,
  scoreRisk,
  tierForTask,
  canRunInParallel,
  buildExecutionWaves,
};
