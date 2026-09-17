'use strict';

// Lean orchestration policy for Gorkhali.
//
// The router stays deterministic on purpose: role defaults come from
// config/role-tiers.json, risk signals raise only the roles that benefit from
// more reasoning, and execution is strictly serial: one task per wave.

const { tierForRole } = require('./tiers.js');
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

    // Strictly one task per wave: Engineers commit directly on the integration
    // branch, so plan order among ready tasks is the only tie-break.
    waves.push([ready[0].id]);
    scheduled.add(ready[0].id);
    completed.add(ready[0].id);
  }

  return waves;
}

module.exports = {
  THRESHOLDS,
  RISK_WEIGHTS,
  scoreRisk,
  tierForTask,
  buildExecutionWaves,
};
