'use strict';
const MAX_REPAIRS = 2;
// Attempts count actual Engineer repairs across the session, not diagnoses.
function recoveryDecision({ attempts = 0, diagnosed = false, unclear = false, repeated = false, flaky = false, infrastructure = false } = {}) {
  if (!Number.isInteger(attempts) || attempts < 0) throw new Error('Invalid repair counter');
  if (infrastructure) return { next: 'human', reason: 'Restore the unavailable environment or tool; no code repair justified' };
  if (attempts >= MAX_REPAIRS) return { next: 'human', reason: 'Repair budget exhausted' };
  if ((unclear || repeated || flaky) && !diagnosed) return { next: 'detective', reason: 'Diagnosis required before another repair' };
  return { next: 'engineer', reason: 'Scoped repair with current evidence' };
}
module.exports = { MAX_REPAIRS, recoveryDecision };
