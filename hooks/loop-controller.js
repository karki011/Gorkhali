// Author: Subash Karki
// loop-controller.js — canonical authority for the verify/fix loop ceiling.
//
// Standalone library (NOT wired into hooks.json). Prose in fix.md/verify.md/apex.md
// DEFERS to this module so the Markdown and the count can't drift. The counter is
// the same `review.fixLoops` field in verification.json
// — there is no parallel source of truth.
//
// Rationale for the ceiling: user's CLAUDE.md — "if a fix attempt fails twice with
// the same error class, STOP patching; the approach is wrong."
//
// NOT the VISUAL fix loop (commands/visual.md, agents/reference/visual-protocol.md),
// which is a separate iteration loop with its own ceiling (3).
'use strict';

const FIX_LOOP_CEILING = 2;

// Read the loop count off a verification artifact (review.fixLoops). Missing/garbage
// state fails safe to 0 (loop has not run).
function getFixLoops(verification) {
  const n = verification && verification.review && verification.review.fixLoops;
  return typeof n === 'number' && n >= 0 ? n : 0;
}

// Increment the counter on the artifact in place and return the new count. Keeps
// review.fixLoops as the single source of truth that validate-artifact.js checks.
function incrementFixLoops(verification) {
  if (!verification.review || typeof verification.review !== 'object') verification.review = {};
  verification.review.fixLoops = getFixLoops(verification) + 1;
  return verification.review.fixLoops;
}

// Same-finding-class escalation: the same failure class appearing twice means we're
// patch-stacking on a wrong hypothesis. classHistory is the per-loop list of finding
// classes attempted so far (e.g. ['type', 'type']).
function sameClassRepeated(classHistory, currentClass) {
  if (!Array.isArray(classHistory) || !currentClass) return false;
  return classHistory.includes(currentClass);
}

// The decision. Default behavior is the hard stop at the ceiling. The ONLY way past
// it is an explicit operator override: the latest attempt uncovered a NEW, narrower
// problem (genuine progress, not the same hypothesis) AND a non-empty justification
// string is recorded. Same-class repetition forces a stop regardless of override.
function shouldContinue({ fixLoops, currentClass, classHistory = [], override = null } = {}) {
  const loops = typeof fixLoops === 'number' && fixLoops >= 0 ? fixLoops : 0;

  if (sameClassRepeated(classHistory, currentClass)) {
    return { continue: false, reason: 'same-finding-class', escalate: true };
  }
  if (loops < FIX_LOOP_CEILING) {
    return { continue: true, reason: 'under-ceiling', escalate: false };
  }

  const j = override && typeof override.justification === 'string' ? override.justification.trim() : '';
  if (override && override.newNarrowerProblem === true && j) {
    return { continue: true, reason: 'operator-override', escalate: false, justification: j };
  }
  return { continue: false, reason: 'ceiling-reached', escalate: true };
}

module.exports = {
  FIX_LOOP_CEILING,
  getFixLoops,
  incrementFixLoops,
  sameClassRepeated,
  shouldContinue,
};
