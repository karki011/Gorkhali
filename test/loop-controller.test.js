// Author: Subash Karki
// loop-controller.test.js — proves the fix-loop ceiling is CODE, not drifting prose.
//
// The unified ceiling is 2 (user's CLAUDE.md: "fails twice with the same error class
// → STOP patching"). These tests pin: the counter rides review.fixLoops (the same field
// validate-artifact.js checks — no parallel state), the hard stop at 2, the explicit
// operator override (NEW narrower problem + logged justification), and same-class
// escalation. If a future edit reverts the ceiling to 3 or weakens the override, these flip.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const lc = require(path.join('..', 'hooks', 'loop-controller.js'));

test('canonical ceiling is 2', () => {
  assert.equal(lc.FIX_LOOP_CEILING, 2, 'ceiling must be 2 (unified fix/review loop)');
});

test('counter rides review.fixLoops on the verification artifact', () => {
  const v = { review: { findings: [], fixLoops: 0 } };
  assert.equal(lc.getFixLoops(v), 0, 'reads the artifact field');
  assert.equal(lc.incrementFixLoops(v), 1, 'increment returns new count');
  assert.equal(v.review.fixLoops, 1, 'mutates the same field validate-artifact.js checks');
  lc.incrementFixLoops(v);
  assert.equal(v.review.fixLoops, 2, 'increments cumulatively');
});

test('getFixLoops fails safe to 0 on missing/garbage state', () => {
  assert.equal(lc.getFixLoops(undefined), 0);
  assert.equal(lc.getFixLoops({}), 0);
  assert.equal(lc.getFixLoops({ review: { fixLoops: 'nope' } }), 0);
  assert.equal(lc.getFixLoops({ review: { fixLoops: -3 } }), 0);
});

test('continues while under the ceiling', () => {
  const d0 = lc.shouldContinue({ fixLoops: 0, currentClass: 'type' });
  assert.equal(d0.continue, true);
  assert.equal(d0.escalate, false);
  const d1 = lc.shouldContinue({ fixLoops: 1, currentClass: 'build', classHistory: ['type'] });
  assert.equal(d1.continue, true, 'a different class at loop 1 may proceed');
});

test('HARD STOP at the ceiling (2) with no override → escalate', () => {
  const d = lc.shouldContinue({ fixLoops: 2, currentClass: 'build', classHistory: ['type'] });
  assert.equal(d.continue, false, 'must stop at the ceiling by default');
  assert.equal(d.escalate, true);
  assert.equal(d.reason, 'ceiling-reached');
});

test('operator override CONTINUES past the ceiling only with new narrower problem + justification', () => {
  const ok = lc.shouldContinue({
    fixLoops: 2,
    currentClass: 'integration',
    classHistory: ['type', 'build'],
    override: { newNarrowerProblem: true, justification: 'loop 2 surfaced a distinct race in the event queue' },
  });
  assert.equal(ok.continue, true, 'genuine progress + logged justification continues');
  assert.equal(ok.reason, 'operator-override');
  assert.ok(ok.justification && ok.justification.length > 0, 'justification is recorded');
});

test('override REJECTED without justification or without new narrower problem', () => {
  const noJustification = lc.shouldContinue({
    fixLoops: 2,
    currentClass: 'integration',
    classHistory: ['type', 'build'],
    override: { newNarrowerProblem: true, justification: '   ' },
  });
  assert.equal(noJustification.continue, false, 'blank justification is not an override');

  const noProgress = lc.shouldContinue({
    fixLoops: 2,
    currentClass: 'integration',
    classHistory: ['type', 'build'],
    override: { newNarrowerProblem: false, justification: 'just trying again' },
  });
  assert.equal(noProgress.continue, false, 'no new narrower problem → no override');
});

test('same-finding-class repetition escalates regardless of loop count or override', () => {
  const underCeiling = lc.shouldContinue({ fixLoops: 1, currentClass: 'type', classHistory: ['type'] });
  assert.equal(underCeiling.continue, false, 'same class twice stops even under the ceiling');
  assert.equal(underCeiling.reason, 'same-finding-class');
  assert.equal(underCeiling.escalate, true);

  const withOverride = lc.shouldContinue({
    fixLoops: 1,
    currentClass: 'type',
    classHistory: ['type'],
    override: { newNarrowerProblem: true, justification: 'still the same type error' },
  });
  assert.equal(withOverride.continue, false, 'patch-stacking on the same class cannot be overridden');
});

test('sameClassRepeated guards bad input', () => {
  assert.equal(lc.sameClassRepeated(null, 'type'), false);
  assert.equal(lc.sameClassRepeated(['type'], ''), false);
  assert.equal(lc.sameClassRepeated(['build'], 'type'), false);
});
