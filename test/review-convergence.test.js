// Author: Subash Karki
// review-convergence.test.js — B12. The observable behaviour is the ROADMAP's
// own test, run end to end against the real CLI: a review returns one blocking
// and two advisory findings, only the blocking one is fixed, and round 2 reports
// the remaining advisories BY COUNT without adding new ones.
//
// The design problem underneath it is the one this file mostly pins:
// `commands/review.md` step 4 deletes `{SESSION_DIR}/reviews/auditor.json` before
// every pass so a truncated run cannot reuse a stale verdict. That delete stays.
// So the prior round's finding ids have to survive it — and the ledger that
// carries them must not become a new way to resurrect a verdict. Both halves are
// asserted below by deleting auditor.json between rounds, exactly as the command
// does, and by grepping the ledger for anything verdict-shaped.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const ROUND = path.join(REPO_ROOT, 'scripts', 'review-round.js');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-artifact.js');

const std = require('../scripts/lib/review-standard');
const rf = require('../scripts/lib/review-finding');

function run(bin, args) {
  try {
    return { code: 0, stdout: execFileSync('node', [bin, ...args], { encoding: 'utf-8' }), stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: (e.stdout || '').toString(),
      stderr: (e.stderr || '').toString(),
    };
  }
}

function session() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-rounds-'));
  const reviews = path.join(dir, 'reviews');
  fs.mkdirSync(reviews, { recursive: true });
  return {
    reviews,
    auditor: path.join(reviews, 'auditor.json'),
    ledger: path.join(reviews, std.REVIEW_ROUNDS_FILE),
    write(findings, verdict = 'fail') {
      fs.writeFileSync(
        path.join(reviews, 'auditor.json'),
        JSON.stringify({ role: 'auditor', verdict, findings, observationGaps: [] }, null, 2)
      );
    },
    // Exactly what commands/review.md step 4 does before every pass.
    deleteGazeArtifact() {
      fs.rmSync(path.join(reviews, 'auditor.json'), { force: true });
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const BLOCKING = {
  severity: 'blocking',
  confidence: 'confirmed',
  file: 'src/pay/refund.ts',
  line: 88,
  evidence: 'issueRefund() calls charge.capture() after the early return on line 84',
  impact: 'A partial refund silently no-ops',
  remediation: 'Move the capture above the return',
};
const ADVISORY_A = {
  severity: 'advisory',
  confidence: 'confirmed',
  file: 'src/pay/refund.ts',
  evidence: 'src/pay/refund.ts changed and no test file with the stem "refund" changed with it',
  remediation: 'Add one case to refund.test.ts',
};
const ADVISORY_B = {
  severity: 'advisory',
  confidence: 'possible',
  file: 'src/pay/ledger.ts',
  line: 12,
  evidence: 'postEntry() logs the full request body, which may carry a card token',
  remediation: 'Log the entry id only',
};

// --- the ROADMAP's own test, end to end ---------------------------------------

test('round 2 reports the remaining advisories BY COUNT and adds none of its own', () => {
  const s = session();
  try {
    // Round 1: one blocking, two advisory. Everything is reported.
    s.write([BLOCKING, ADVISORY_A, ADVISORY_B]);
    const first = JSON.parse(run(ROUND, ['close', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(first.round, 1);
    assert.equal(first.reported.length, 3, 'round 1 reports everything');
    assert.deepEqual(first.suppressed, { total: 0, carriedOver: 0, new: 0 });

    // The fix loop fixes only the blocking finding. The command deletes the
    // artifact before the next pass; the ledger is a different file and stays.
    s.deleteGazeArtifact();
    assert.equal(fs.existsSync(s.auditor), false, 'the pre-pass delete really happened');
    assert.equal(fs.existsSync(s.ledger), true, 'the carry-over ledger survives the delete');

    // Round 2: the blocking finding is gone, both advisories are still there.
    s.write([ADVISORY_A, ADVISORY_B]);
    const second = run(ROUND, ['close', '--reviews', s.reviews]);
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /round 2/);
    assert.match(second.stdout, /reported 0 blocking finding\(s\)/);
    assert.match(second.stdout, /suppressed 2: 2 carried over from an earlier round, 0 first seen this round/);
  } finally {
    s.cleanup();
  }
});

test('a NEW advisory in round 2 is suppressed and counted separately from a carried-over one', () => {
  const s = session();
  try {
    s.write([BLOCKING, ADVISORY_A]);
    run(ROUND, ['close', '--reviews', s.reviews]);
    s.deleteGazeArtifact();

    // Round 2 invents a fresh advisory the fix could not have caused.
    s.write([ADVISORY_A, ADVISORY_B]);
    const second = JSON.parse(run(ROUND, ['close', '--reviews', s.reviews, '--json']).stdout);
    assert.deepEqual(second.suppressed, { total: 2, carriedOver: 1, new: 1 });
    assert.deepEqual(second.reported, [], 'nothing blocking, so round 2 itemizes nothing');
  } finally {
    s.cleanup();
  }
});

test('a NEW BLOCKING finding in round 2 is always reported - the fix may have broken something', () => {
  const s = session();
  try {
    s.write([BLOCKING, ADVISORY_A]);
    run(ROUND, ['close', '--reviews', s.reviews]);
    s.deleteGazeArtifact();

    const regression = {
      severity: 'blocking',
      confidence: 'confirmed',
      file: 'src/pay/refund.ts',
      line: 84,
      evidence: 'the round-1 fix moved capture() above the auth check on line 82',
      impact: 'An unauthenticated caller can capture a charge',
      remediation: 'Move the auth check back above capture()',
    };
    s.write([regression, ADVISORY_A]);
    const second = JSON.parse(run(ROUND, ['close', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(second.reported.length, 1);
    assert.equal(second.reported[0].file, 'src/pay/refund.ts');
    assert.equal(second.reported[0].line, 84);
    assert.equal(second.suppressed.total, 1, 'the advisory is still suppressed');
  } finally {
    s.cleanup();
  }
});

// --- the ledger cannot resurrect a verdict ------------------------------------

test('the ledger carries ids and severities and NOTHING that reads as a verdict', () => {
  const s = session();
  try {
    s.write([BLOCKING, ADVISORY_A], 'fail');
    run(ROUND, ['close', '--reviews', s.reviews]);
    const raw = fs.readFileSync(s.ledger, 'utf8');
    const ledger = JSON.parse(raw);

    assert.equal(ledger.schema, std.REVIEW_ROUNDS_SCHEMA);
    assert.equal(ledger.rounds.length, 1);
    assert.deepEqual(Object.keys(ledger.rounds[0].findings[0]).sort(), ['blocking', 'file', 'id', 'severity']);

    // The freshness property the delete exists to protect: there is no verdict
    // in this file to reuse, so a truncated run cannot find one here.
    assert.doesNotMatch(raw, /"verdict"/, 'the ledger must not carry a verdict');
    assert.doesNotMatch(raw, /\bpass\b|\bblocked\b/, 'nor any verdict-shaped word');
    assert.equal('findings' in ledger, false, 'no top-level findings array a reader could mistake for a review');
  } finally {
    s.cleanup();
  }
});

test('a truncated round records nothing, so the next pass is still the same round', () => {
  const s = session();
  try {
    s.write([BLOCKING]);
    run(ROUND, ['close', '--reviews', s.reviews]);
    assert.equal(JSON.parse(run(ROUND, ['status', '--reviews', s.reviews, '--json']).stdout).round, 2);

    // Round 2 is spawned and dies before writing anything: the command deleted
    // auditor.json and there is no artifact to close.
    s.deleteGazeArtifact();
    const failed = run(ROUND, ['close', '--reviews', s.reviews]);
    assert.equal(failed.code, 1, 'a missing artifact is an error, never an empty round');
    assert.match(failed.stderr, /cannot read review artifact/);

    const status = JSON.parse(run(ROUND, ['status', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(status.round, 2, 'the truncated pass did not consume round 2');
    assert.equal(status.roundsRecorded, 1);
  } finally {
    s.cleanup();
  }
});

test('the miner does not mistake the ledger for a reviewer artifact', () => {
  const s = session();
  try {
    s.write([BLOCKING]);
    run(ROUND, ['close', '--reviews', s.reviews]);
    const ledger = JSON.parse(fs.readFileSync(s.ledger, 'utf8'));
    // scripts/baseline-report.js reads any reviews/*.json whose shape carries a
    // top-level `findings` array. The ledger deliberately does not.
    assert.equal(Array.isArray(ledger.findings), false);
  } finally {
    s.cleanup();
  }
});

// --- the round number, and what the reviewer is told --------------------------

test('status reports round 1 with no ledger and names what round 2 changes', () => {
  const s = session();
  try {
    const first = JSON.parse(run(ROUND, ['status', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(first.round, 1);
    assert.equal(first.ledgerSource, 'absent');
    assert.match(first.instruction, /Round 1: report everything/);
    assert.deepEqual(first.priorFindingIds, []);

    s.write([BLOCKING, ADVISORY_A]);
    run(ROUND, ['close', '--reviews', s.reviews]);
    const second = run(ROUND, ['status', '--reviews', s.reviews]);
    assert.match(second.stdout, /^round 2 /m);
    assert.match(second.stdout, /Round 2: itemize blocking findings only/);
    assert.match(second.stdout, /prior finding ids \(2\): f_[0-9a-f]{12} f_[0-9a-f]{12}/);
  } finally {
    s.cleanup();
  }
});

test('a corrupt ledger falls back to round 1 rather than breaking the review', () => {
  const s = session();
  try {
    fs.writeFileSync(s.ledger, '{ this is not json');
    const status = JSON.parse(run(ROUND, ['status', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(status.round, 1);
    assert.equal(status.ledgerSource, 'unreadable');
  } finally {
    s.cleanup();
  }
});

// --- identity is what makes the count honest ---------------------------------

test('carry-over is decided by the B9 content id, not by position or wording', () => {
  const s = session();
  try {
    s.write([ADVISORY_B]);
    run(ROUND, ['close', '--reviews', s.reviews]);
    s.deleteGazeArtifact();

    // Same claim, same file, different line and different severity: still the
    // same finding, because the B9 id excludes both.
    const moved = { ...ADVISORY_B, line: 47, severity: 'advisory', confidence: 'possible' };
    assert.equal(rf.findingId(moved), rf.findingId(ADVISORY_B), 'line and severity are not part of the id');
    s.write([moved]);
    const second = JSON.parse(run(ROUND, ['close', '--reviews', s.reviews, '--json']).stdout);
    assert.deepEqual(second.suppressed, { total: 1, carriedOver: 1, new: 0 });
  } finally {
    s.cleanup();
  }
});

test('closing a round never moves a finding id', () => {
  const s = session();
  try {
    const before = [BLOCKING, ADVISORY_A, ADVISORY_B].map((f) => rf.findingId(f));
    s.write([BLOCKING, ADVISORY_A, ADVISORY_B]);
    run(ROUND, ['close', '--reviews', s.reviews]);
    const ledger = JSON.parse(fs.readFileSync(s.ledger, 'utf8'));
    assert.deepEqual(ledger.rounds[0].findings.map((f) => f.id), before);
  } finally {
    s.cleanup();
  }
});

// --- the convergence record on the artifact ----------------------------------

test('close hands back a convergence object the review payload can carry, and it validates', () => {
  const s = session();
  try {
    s.write([BLOCKING, ADVISORY_A, ADVISORY_B]);
    run(ROUND, ['close', '--reviews', s.reviews]);
    s.deleteGazeArtifact();
    s.write([ADVISORY_A, ADVISORY_B]);
    const second = JSON.parse(run(ROUND, ['close', '--reviews', s.reviews, '--json']).stdout);
    assert.deepEqual(second.convergence, { round: 2, suppressed: { total: 2, carriedOver: 2, new: 0 } });

    const payload = {
      role: 'auditor',
      verdict: 'pass',
      findings: [ADVISORY_A, ADVISORY_B],
      convergence: second.convergence,
      observationGaps: [],
    };
    const file = path.join(s.reviews, 'payload.json');
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    assert.equal(run(VALIDATOR, ['review', file]).code, 0);
  } finally {
    s.cleanup();
  }
});

test('a convergence count that does not add up is rejected', () => {
  const s = session();
  try {
    const file = path.join(s.reviews, 'bad.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        role: 'auditor',
        verdict: 'pass',
        findings: [],
        convergence: { round: 2, suppressed: { total: 5, carriedOver: 1, new: 1 } },
        observationGaps: [],
      })
    );
    const res = run(VALIDATOR, ['review', file]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /convergence\.suppressed\.total: must equal carriedOver \+ new \(1 \+ 1\)/);
  } finally {
    s.cleanup();
  }
});

test('an artifact with no convergence key still validates - round 1 has none', () => {
  const s = session();
  try {
    const file = path.join(s.reviews, 'r1.json');
    fs.writeFileSync(file, JSON.stringify({ role: 'auditor', verdict: 'pass', findings: [], observationGaps: [] }));
    assert.equal(run(VALIDATOR, ['review', file]).code, 0);
  } finally {
    s.cleanup();
  }
});

// --- the commands still delete the artifact, and never the ledger -------------

test('commands/review.md still deletes auditor.json and explicitly spares the ledger', () => {
  const review = fs.readFileSync(path.join(REPO_ROOT, 'commands', 'review.md'), 'utf8');
  assert.match(review, /Delete only `\{SESSION_DIR\}\/reviews\/auditor\.json`/);
  assert.match(review, /never\s+`\{SESSION_DIR\}\/reviews\/rounds\.json`/);
  assert.match(review, /prevents a failed or truncated run\s+from reusing an older verdict/);
  assert.match(review, /holds no verdict to reuse/);
  // The path form is the plugin-root bootstrap (`_shared.md` §Paths), so the
  // script name is followed by a closing quote before the action.
  assert.match(review, /review-round\.js"? status/);
  assert.match(review, /review-round\.js"? close/);
});

test('commands/verify.md runs the same pass and spares the same ledger', () => {
  const verify = fs.readFileSync(path.join(REPO_ROOT, 'commands', 'verify.md'), 'utf8');
  assert.match(verify, /Delete only `\{SESSION_DIR\}\/reviews\/auditor\.json` — never `\{SESSION_DIR\}\/reviews\/rounds\.json`/);
  assert.match(verify, /review-round\.js close/);
});

test('the shared review standard carries the round rule and does not claim to count rounds itself', () => {
  const standard = fs.readFileSync(path.join(REPO_ROOT, 'reference', 'review-standard.md'), 'utf8');
  assert.match(standard, /## Re-review rounds/);
  assert.match(standard, /report `blocking` findings only/);
  assert.match(standard, /You are TOLD which round this is; you never count rounds yourself/);
  // The artifact stays complete: suppression is about what a round SAYS.
  assert.match(standard, /Keep every finding you stand behind in the artifact/);
});

// --- an invalid review must not consume a round (Greptile, PR #114) -----------
// The ledger's freshness property is "a round is appended only after a VALID
// artifact was read". A shape-only check broke it: a file that merely had a
// `findings` array consumed a round, and the next real pass then suppressed its
// advisories on the strength of a round that never validly happened.

test('a schema-invalid review does not consume a round, so the next valid pass is still round 1', () => {
  const s = session();
  try {
    // Has a findings array, so the old shape check accepted it - but the finding
    // carries no evidence and no severity, which the review schema rejects.
    fs.writeFileSync(s.auditor, JSON.stringify({ role: 'auditor', verdict: 'fail', findings: [{ file: 'a.ts' }] }));
    const bad = run(ROUND, ['close', '--reviews', s.reviews, '--json']);
    assert.notEqual(bad.code, 0, 'an invalid review artifact is rejected');
    assert.match(bad.stderr, /not a valid review artifact/);
    assert.equal(fs.existsSync(s.ledger), false, 'nothing was appended to the ledger');

    // The next VALID pass is still round 1, so it reports its advisories in full.
    s.deleteGazeArtifact();
    s.write([BLOCKING, ADVISORY_A, ADVISORY_B]);
    const good = JSON.parse(run(ROUND, ['close', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(good.round, 1, 'the invalid pass did not advance the round');
    assert.equal(good.reported.length, 3, 'advisories are NOT suppressed by a round that never happened');
  } finally {
    s.cleanup();
  }
});

test('a blocked review does not consume a round', () => {
  const s = session();
  try {
    s.write([], 'blocked');
    const blocked = run(ROUND, ['close', '--reviews', s.reviews, '--json']);
    assert.notEqual(blocked.code, 0, 'a blocked review is rejected');
    assert.match(blocked.stderr, /did not complete and does not consume a round/);
    assert.equal(fs.existsSync(s.ledger), false, 'nothing was appended to the ledger');

    s.deleteGazeArtifact();
    s.write([BLOCKING, ADVISORY_A]);
    const good = JSON.parse(run(ROUND, ['close', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(good.round, 1, 'the blocked pass did not advance the round');
    assert.equal(good.reported.length, 2);
  } finally {
    s.cleanup();
  }
});

// --- the ledger is also the fix-loop counter ---------------------------------
// B12 bounded review NOISE. It did not bound the number of ROUNDS, and the thing
// that was supposed to (FIX_LOOP_CEILING) counted a field on verification.json
// that the portable lifecycle stopped writing — so the ceiling never fired and
// the verify -> review -> fix -> verify cycle ran unbounded. The ledger is the
// artifact that already knows how many rounds happened, so it is now the count.

const lc = require('../hooks/loop-controller');

test('the fix-loop standing is reported on every pass, and round 1 is not a fix loop', () => {
  const s = session();
  try {
    const before = JSON.parse(run(ROUND, ['status', '--reviews', s.reviews, '--json']).stdout);
    assert.deepEqual(
      { fixLoops: before.loop.fixLoops, source: before.loop.source, escalate: before.loop.decision.escalate },
      { fixLoops: 0, source: 'rounds-ledger', escalate: false },
      'no rounds recorded: no fix loop has run'
    );

    s.write([BLOCKING]);
    const first = JSON.parse(run(ROUND, ['close', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(first.loop.fixLoops, 0, 'the first review is not a fix loop');
    assert.equal(first.loop.ceiling, lc.FIX_LOOP_CEILING, 'the ceiling comes from the controller, not from here');
    assert.equal(first.loop.decision.continue, true);
  } finally {
    s.cleanup();
  }
});

test('closing the ceiling-th round escalates instead of inviting another fix loop', () => {
  const s = session();
  try {
    // Round 1 = first review. Rounds 2 and 3 each follow a fix loop, so closing
    // round 3 is the ceiling with FIX_LOOP_CEILING = 2.
    for (const round of [1, 2, 3]) {
      s.deleteGazeArtifact();
      s.write([BLOCKING]);
      const r = JSON.parse(run(ROUND, ['close', '--reviews', s.reviews, '--json']).stdout);
      assert.equal(r.round, round);
      assert.equal(r.loop.fixLoops, round - 1, 'N rounds mean N-1 fix loops');
      assert.equal(
        r.loop.decision.escalate,
        round > lc.FIX_LOOP_CEILING,
        `round ${round} escalation`
      );
    }

    // And the operator can SEE it without --json, which is the half that was
    // missing: a count nobody is shown is a count nobody acts on.
    const text = run(ROUND, ['status', '--reviews', s.reviews]);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /FIX LOOP CEILING REACHED: 2\/2 — ceiling-reached/);
    assert.match(text.stdout, /commands\/fix\.md step 9/);
  } finally {
    s.cleanup();
  }
});

test('a round that does not validly close does not advance the fix-loop count either', () => {
  const s = session();
  try {
    s.write([BLOCKING]);
    run(ROUND, ['close', '--reviews', s.reviews, '--json']);

    // A blocked pass records nothing (asserted above); the standing must not move
    // with it, or a truncated run would spend a fix loop it never used.
    s.deleteGazeArtifact();
    s.write([BLOCKING], 'blocked');
    const blocked = run(ROUND, ['close', '--reviews', s.reviews, '--json']);
    assert.notEqual(blocked.code, 0, 'a blocked review does not consume a round');

    const after = JSON.parse(run(ROUND, ['status', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(after.round, 2, 'still the same next round');
    assert.equal(after.loop.fixLoops, 0, 'and still the same fix-loop count');
  } finally {
    s.cleanup();
  }
});

test('a dry run reports the standing it would produce and still writes nothing', () => {
  const s = session();
  try {
    for (const _ of [1, 2]) {
      s.deleteGazeArtifact();
      s.write([BLOCKING]);
      run(ROUND, ['close', '--reviews', s.reviews, '--json']);
    }
    const before = fs.readFileSync(s.ledger, 'utf-8');

    s.deleteGazeArtifact();
    s.write([BLOCKING]);
    const dry = JSON.parse(run(ROUND, ['close', '--reviews', s.reviews, '--json', '--dry-run']).stdout);
    assert.equal(dry.recorded, false);
    assert.equal(dry.loop.fixLoops, 2, 'the standing round 3 WOULD produce');
    assert.equal(dry.loop.decision.escalate, true);
    assert.equal(fs.readFileSync(s.ledger, 'utf-8'), before, 'the ledger is untouched');
  } finally {
    s.cleanup();
  }
});

test('reference/fix-loop.md names the ledger as the counter and no longer claims wrap reviews', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'reference', 'fix-loop.md'), 'utf8');
  assert.match(doc, /rounds\.json/, 'the counter has a named home');
  assert.ok(
    !/prose discipline and wrap review still apply/.test(doc),
    'commands/wrap.md validates recorded review artifacts and runs no review of its own'
  );
});

// --- what code review caught on the counter, pinned -------------------------

test('re-reviewing an unchanged worktree does not spend the ceiling', () => {
  const s = session();
  try {
    // Three read-only reviews of ONE untouched diff. Counting rounds alone would
    // report 2/2 here and escalate the first genuine fix that follows.
    for (const _ of [1, 2, 3]) {
      s.deleteGazeArtifact();
      s.write([BLOCKING]);
      run(ROUND, ['close', '--reviews', s.reviews, '--fingerprint', 'sha256:unchanged', '--json']);
    }
    const after = JSON.parse(run(ROUND, ['status', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(after.round, 4, 'three rounds were recorded');
    assert.equal(after.loop.fixLoops, 0, 'but the worktree never changed, so no fix was attempted');
    assert.equal(after.loop.decision.escalate, false);
  } finally {
    s.cleanup();
  }
});

test('distinct reviewed fingerprints are what count as attempts', () => {
  const s = session();
  try {
    for (const fp of ['sha256:a', 'sha256:b', 'sha256:c']) {
      s.deleteGazeArtifact();
      s.write([BLOCKING]);
      run(ROUND, ['close', '--reviews', s.reviews, '--fingerprint', fp, '--json']);
    }
    const after = JSON.parse(run(ROUND, ['status', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(after.loop.fixLoops, 2, 'two fixes changed the worktree between three reviews');
    assert.equal(after.loop.decision.escalate, true);
  } finally {
    s.cleanup();
  }
});

test('an unreadable ledger reports UNKNOWN, never a fresh zero', () => {
  const s = session();
  try {
    fs.writeFileSync(s.ledger, '{"rounds": [{"round": 1}');

    const status = JSON.parse(run(ROUND, ['status', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(status.ledgerSource, 'unreadable');
    assert.equal(status.loop.fixLoops, null, 'corruption must not hand back a ceiling of attempts');
    assert.equal(status.loop.source, 'unknown');
    assert.equal(status.loop.decision, null, 'unknown is not a decision');

    const text = run(ROUND, ['status', '--reviews', s.reviews]);
    assert.match(text.stdout, /fix loops: UNKNOWN/);
    assert.match(text.stdout, /Not zero/);
  } finally {
    s.cleanup();
  }
});

test('a logged operator override is honoured when the session is named', () => {
  const s = session();
  try {
    for (const fp of ['sha256:a', 'sha256:b', 'sha256:c']) {
      s.deleteGazeArtifact();
      s.write([BLOCKING]);
      run(ROUND, ['close', '--reviews', s.reviews, '--fingerprint', fp, '--json']);
    }
    const sessionDir = path.dirname(s.reviews);

    // Without --session no override is read, and the standing says so rather than
    // reporting an escalation the operator already authorized away.
    const blind = JSON.parse(run(ROUND, ['status', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(blind.overrideEvaluated, undefined);
    assert.equal(blind.loop.overrideEvaluated, false);
    assert.equal(blind.loop.decision.escalate, true);

    fs.writeFileSync(
      path.join(sessionDir, 'verification.json'),
      JSON.stringify({ review: { override: { newNarrowerProblem: true, justification: 'narrower repro found' } } })
    );
    const allowed = JSON.parse(
      run(ROUND, ['status', '--reviews', s.reviews, '--session', sessionDir, '--json']).stdout
    );
    assert.equal(allowed.loop.overrideEvaluated, true);
    assert.equal(allowed.loop.decision.continue, true);
    assert.equal(allowed.loop.decision.reason, 'operator-override');

    // An override with no justification is not an override.
    fs.writeFileSync(
      path.join(sessionDir, 'verification.json'),
      JSON.stringify({ review: { override: { newNarrowerProblem: true } } })
    );
    const refused = JSON.parse(
      run(ROUND, ['status', '--reviews', s.reviews, '--session', sessionDir, '--json']).stdout
    );
    assert.equal(refused.loop.decision.escalate, true, 'an unjustified override is ignored');
  } finally {
    s.cleanup();
  }
});

test('scrap-and-redo reverting the worktree still spends its fix loops', () => {
  const s = session();
  try {
    // A -> B is one fix; step 8.5 then reverts to A, which is a second attempt
    // that happened to land back where it started. Counting distinct values would
    // report 1/2 here and allow a third chained fix past the ceiling.
    for (const fp of ['sha256:a', 'sha256:b', 'sha256:a']) {
      s.deleteGazeArtifact();
      s.write([BLOCKING]);
      run(ROUND, ['close', '--reviews', s.reviews, '--fingerprint', fp, '--json']);
    }
    const after = JSON.parse(run(ROUND, ['status', '--reviews', s.reviews, '--json']).stdout);
    assert.equal(after.loop.fixLoops, 2, 'a revert is a failed attempt, not an absent one');
    assert.equal(after.loop.decision.escalate, true);
  } finally {
    s.cleanup();
  }
});
