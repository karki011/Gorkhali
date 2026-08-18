// Author: Subash Karki
// loop-controller.test.js — proves the fix-loop ceiling is CODE, not drifting prose.
//
// The unified ceiling is 2 (user's CLAUDE.md: "fails twice with the same error class
// → STOP patching"). These tests pin: the counter is DERIVED from the review round
// ledger (the artifact the portable flow actually writes — no increment call to
// forget, and no parallel state), the legacy verification.json fallback, the hard
// stop at 2, the explicit operator override (NEW narrower problem + logged
// justification), and same-class escalation. If a future edit reverts the ceiling
// to 3 or weakens the override, these flip.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const lc = require(path.join('..', 'hooks', 'loop-controller.js'));

test('canonical ceiling is 2', () => {
  assert.equal(lc.FIX_LOOP_CEILING, 2, 'ceiling must be 2 (unified fix/review loop)');
});

const round = (fingerprint) => (fingerprint ? { round: 1, fingerprint } : { round: 1 });

test('the count is derived from recorded review rounds, not from a separate counter', () => {
  // Round 1 is the FIRST review — nothing has been fixed yet, so no fix loop has
  // run. Every later round exists because a fix changed the worktree.
  assert.equal(lc.fixLoopsFromLedger([]), 0, 'no rounds recorded → no fix loop has run');
  assert.equal(lc.fixLoopsFromLedger([round()]), 0, 'the first review is not a fix loop');
  assert.equal(lc.fixLoopsFromLedger([round(), round()]), 1);
  assert.equal(lc.fixLoopsFromLedger([round(), round(), round()]), 2, 'closing round 3 reaches the ceiling');
});

test('a re-review of an UNCHANGED worktree is a round but not an attempt', () => {
  // /phantom:review is read-only and re-runnable. Counting rounds alone would let
  // three reviews of one untouched diff spend the whole ceiling and escalate the
  // first genuine fix. A fingerprint CHANGE is the evidence a fix happened.
  assert.equal(lc.fixLoopsFromLedger([round('fp-a'), round('fp-a'), round('fp-a')]), 0);
  assert.equal(lc.fixLoopsFromLedger([round('fp-a'), round('fp-a'), round('fp-b')]), 1);
  assert.equal(lc.fixLoopsFromLedger([round('fp-a'), round('fp-b'), round('fp-c')]), 2);
});

test('a REVERT to an earlier worktree is a failed attempt, not an absent one', () => {
  // commands/fix.md step 8.5 scrap-and-redo does `git checkout -- <touched
  // files>`, which restores an earlier worktree — so A,B,A is the sequence this
  // repo runs on purpose. Counting the SET of fingerprints would call it one
  // attempt and hand back a chained fix after the loop should have escalated.
  assert.equal(lc.fixLoopsFromLedger([round('fp-a'), round('fp-b'), round('fp-a')]), 2);
  assert.equal(lc.fixLoopsFromLedger([round('fp-a'), round('fp-b'), round('fp-a'), round('fp-b')]), 3);
  // ...and a revert followed by a re-review of the reverted state is still two.
  assert.equal(lc.fixLoopsFromLedger([round('fp-a'), round('fp-b'), round('fp-a'), round('fp-a')]), 2);
});

test('an unstamped ledger falls back to counting rounds — early, never late', () => {
  // Mixed or missing fingerprints cannot answer "did the code change?", so the
  // count takes the conservative direction rather than assuming no fix happened.
  assert.equal(lc.fixLoopsFromLedger([round('fp-a'), round(), round('fp-a')]), 2);
  assert.equal(lc.fixLoopsFromLedger([round('fp-a'), round('  ')]), 1);
});

test('fixLoopsFromLedger fails safe to 0 on garbage', () => {
  assert.equal(lc.fixLoopsFromLedger(undefined), 0);
  assert.equal(lc.fixLoopsFromLedger(null), 0);
  assert.equal(lc.fixLoopsFromLedger('3'), 0);
  assert.equal(lc.fixLoopsFromLedger([null, 'x', []]), 0, 'non-object entries are not rounds');
});

test('there is no increment function to forget to call', () => {
  // The regression this whole change exists for: incrementFixLoops() was exported
  // and called by nothing but its own test, so the counter stayed 0 and the
  // ceiling never fired. The append-only ledger increments itself, so the
  // function is gone rather than rewired — re-adding one re-opens the gap.
  assert.equal(typeof lc.incrementFixLoops, 'undefined');
});

test('resolveFixLoops prefers the ledger and names the source it used', () => {
  const legacy = { review: { findings: [], fixLoops: 1 } };

  assert.deepEqual(
    lc.resolveFixLoops({ rounds: [round(), round(), round()], verification: legacy }),
    { loops: 2, source: 'rounds-ledger' },
    'a present ledger wins over the legacy artifact'
  );
  assert.deepEqual(
    lc.resolveFixLoops({ rounds: [], verification: legacy }),
    { loops: 0, source: 'rounds-ledger' },
    'an empty ledger is a real observation, not a failure to read one'
  );
  assert.deepEqual(
    lc.resolveFixLoops({ rounds: null, verification: legacy }),
    { loops: 1, source: 'verification-artifact' },
    'an UNREADABLE ledger falls through; it never reads as zero loops so far'
  );
  assert.deepEqual(
    lc.resolveFixLoops({}),
    { loops: 0, source: 'none' },
    'neither artifact → the source says so rather than passing off a fabricated zero'
  );
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
