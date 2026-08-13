// Author: Subash Karki
// baseline-review-precision.test.js — B9b. The second half of B9's stated test:
// the baseline miner printing a per-finding table with a fixed/dismissed/deferred
// column, over a REAL temp PHANTOM_DATA corpus, through the production CLI.
//
// Four failure classes are pinned here, and three of them are F8:
//
//  1. pre-B9 findings (no disposition, written against the pre-#109 pipeline)
//     being averaged into the same precision number as post-B9 ones, which
//     would report a re-baseline that never happened;
//  2. an EMPTY measurable set printing as 0% or 100% or "clean" instead of
//     UNMEASURABLE — the single most misleading thing this miner could do;
//  3. the miner INVENTING dispositions by running the fix-loop closer over
//     artifacts on disk (closeFixLoop defaults an open finding to `deferred`),
//     which would manufacture exactly the data whose absence is the finding;
//  4. a `preExisting` finding (B10 defers it BY RULE, because it never entered
//     the fix loop) being counted as a review outcome, which would measure the
//     rule rather than the review and depress precision by construction.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const MINER = path.join(REPO_ROOT, 'scripts', 'baseline-report.js');
const rf = require(path.join(REPO_ROOT, 'scripts', 'lib', 'review-finding.js'));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

// A finding in the shape agents/gaze.md writes today.
function finding(file, severity, evidence, extra = {}) {
  return { severity, file, line: 42, evidence, impact: 'x', remediation: 'y', ...extra };
}

// The same finding once the fix loop has closed over it: the id is the derived
// one (the validator rejects any other), plus the recorded outcome.
function disposed(base, disposition, reason) {
  const out = { ...base, id: rf.findingId(base), disposition };
  if (reason) out.dispositionReason = reason;
  return out;
}

const PRE_B9 = [
  finding('src/legacy/a.ts', 'blocking', 'a() dereferences opts before the guard'),
  finding('src/legacy/b.ts', 'advisory', 'b() duplicates the parser in c.ts'),
];

const GAZE_FIXED = disposed(finding('src/pay/charge.ts', 'blocking', 'charge() rounds before currency conversion'), 'fixed');
const GAZE_DISMISSED = disposed(
  finding('src/pay/charge.ts', 'advisory', 'chargeOnce() could take an options bag'),
  'dismissed',
  'speculative abstraction; no second caller exists'
);
const GAZE_DEFERRED = disposed(
  finding('src/pay/refund.ts', 'advisory', 'no focused test covers the partial-refund path'),
  'deferred',
  'fix-loop ceiling reached; tracked for the next pass'
);
// Legacy severity spellings, still on disk everywhere: the miner must fold them
// onto the one scale (B10) rather than split one severity across two rows.
const ARCHER_FIXED_P0 = disposed(finding('src/pay/ledger.ts', 'P0', 'ledger write is not idempotent under retry'), 'fixed');
const ARCHER_FIXED_P2 = disposed(finding('src/pay/ledger.ts', 'P2', 'ledger helper is dead after the retry change'), 'fixed');
// A real defect the diff did not introduce. B10 defers it by rule.
const ARCHER_PRE_EXISTING = disposed(
  finding('src/pay/legacy-ledger.ts', 'advisory', 'legacy ledger swallows the retry error', { preExisting: true }),
  'deferred',
  'pre-existing: reported, never entered the fix loop'
);

/**
 * A corpus with one pre-B9 session, one post-B9 session reviewed by both agents,
 * and one clean review. `reviews/` only counts under a canonical record dir, so
 * every session also gets the wrap.json that makes it a record.
 */
function buildCorpus() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'b9b-'));
  const base = path.join(data, 'repos', 'feature-web-apps');

  writeJson(path.join(base, 'sessions', 'CP-100', 'wrap.json'), { brief: 'pre-B9', pr: null });
  writeJson(path.join(base, 'sessions', 'CP-100', 'reviews', 'gaze.json'), {
    role: 'gaze',
    verdict: 'fail',
    findings: PRE_B9,
    observation_gaps: [],
  });

  writeJson(path.join(base, 'sessions', 'CP-200', 'wrap.json'), { brief: 'post-B9', pr: null });
  writeJson(path.join(base, 'sessions', 'CP-200', 'reviews', 'gaze.json'), {
    role: 'gaze',
    verdict: 'fail',
    findings: [GAZE_FIXED, GAZE_DISMISSED, GAZE_DEFERRED],
    observation_gaps: [],
  });
  writeJson(path.join(base, 'sessions', 'CP-200', 'reviews', 'specialists', 'archer.json'), {
    role: 'archer',
    verdict: 'fail',
    findings: [ARCHER_FIXED_P0, ARCHER_FIXED_P2, ARCHER_PRE_EXISTING],
    observationGaps: [],
  });

  writeJson(path.join(base, 'completed', 'CP-300', 'wrap.json'), { brief: 'clean', pr: null });
  writeJson(path.join(base, 'completed', 'CP-300', 'reviews', 'gaze.json'), {
    role: 'gaze',
    verdict: 'pass',
    findings: [],
    observation_gaps: [],
  });

  return data;
}

function mine(dataRoot, extraArgs = []) {
  return execFileSync('node', [MINER, '--no-gh', ...extraArgs], {
    encoding: 'utf-8',
    env: { ...process.env, PHANTOM_DATA: dataRoot },
    cwd: REPO_ROOT,
  });
}

function mineJson(dataRoot) {
  return JSON.parse(mine(dataRoot, ['--json'])).reviewFindings;
}

function withCorpus(fn) {
  const data = buildCorpus();
  try {
    fn(data);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
}

test('the miner prints one row per finding id with a fixed/dismissed/deferred column', () => {
  withCorpus((data) => {
    const r = mineJson(data);

    assert.equal(r.findingsTotal, 8, 'two pre-B9 + three gaze + three archer findings');
    assert.equal(r.rows.length, 8, 'one row per finding, none collapsed');
    const ids = new Set(r.rows.map((row) => row.id));
    assert.equal(ids.size, 8, 'ids are distinct, so a row is addressable by id');

    const fixedRow = r.rows.find((row) => row.id === GAZE_FIXED.id);
    assert.deepEqual(
      { id: fixedRow.id, agent: fixedRow.agent, severity: fixedRow.severity, disposition: fixedRow.disposition },
      { id: GAZE_FIXED.id, agent: 'gaze', severity: 'blocking', disposition: 'fixed' }
    );

    // The hand-dismissal from B9's stated test reads back as `dismissed`, with
    // the reason that makes it falsifiable.
    const dismissedRow = r.rows.find((row) => row.id === GAZE_DISMISSED.id);
    assert.equal(dismissedRow.disposition, 'dismissed');
    assert.match(dismissedRow.reason, /speculative abstraction/);

    const human = mine(data);
    assert.match(human, /PER FINDING \(one row per finding id/);
    for (const row of [GAZE_FIXED, GAZE_DISMISSED, GAZE_DEFERRED, ARCHER_FIXED_P0]) {
      assert.ok(human.includes(row.id), 'human table prints the row for ' + row.id);
    }
    assert.match(human, new RegExp(GAZE_DISMISSED.id + '.*dismissed'));
  });
});

test('pre-B9 findings are shown as unmeasurable and never enter a denominator', () => {
  withCorpus((data) => {
    const r = mineJson(data);

    assert.equal(r.dispositionCoverage, '6/8', 'coverage is explicit, the way wall_time is');
    assert.equal(r.measurableCoverage, '5/8', 'and measurable is a tighter number than dispositioned');
    assert.deepEqual(r.artifactBuckets, { total: 4, clean: 1, measured: 2, partial: 0, unmeasured: 1 });
    assert.equal(r.sessionsWithReview, '3/3');
    assert.equal(r.sessionsMeasurable, '1/3', 'only the post-B9 session is measurable');

    // 5 measurable findings, not 8: fixed 3, dismissed 1, deferred 1.
    assert.equal(r.overall.dispositioned, 5);
    assert.equal(r.overall.fixed, 3);
    assert.equal(r.overall.precisionLower, 3 / 5, 'deferred counted against');
    assert.equal(r.overall.precisionUpper, 3 / 4, 'deferred excluded as undecided');

    // The pre-B9 rows are present and legible, with no disposition and an id
    // this miner derived rather than read.
    const preRows = r.rows.filter((row) => row.ticket === 'CP-100');
    assert.equal(preRows.length, 2);
    for (const row of preRows) {
      assert.equal(row.disposition, null);
      assert.equal(row.idSource, 'derived');
      assert.match(row.id, rf.FINDING_ID_RE);
    }

    // gaze reviewed 5 findings but only 3 are countable; the pre-B9 pair must
    // not swell the gaze denominator.
    const gaze = r.byAgent.find((t) => t.key === 'gaze');
    assert.equal(gaze.dispositioned, 3);
    assert.equal(gaze.fixed, 1);

    const human = mine(data);
    assert.match(human, /with a disposition 6\/8   measurable 5\/8/);
    assert.match(human, /RE-BASELINE \(F8\)/);
    assert.match(human, /no disposition recorded \(written before B9/);
  });
});

test('a preExisting finding is deferred by rule and never enters a rate', () => {
  withCorpus((data) => {
    const r = mineJson(data);

    assert.equal(r.preExistingExcluded, 1);
    const row = r.rows.find((x) => x.id === ARCHER_PRE_EXISTING.id);
    assert.equal(row.preExisting, true, 'the row is still printed - excluded, not hidden');
    assert.equal(row.disposition, 'deferred');

    // Were it counted, archer would read 2 fixed of 3 (66.7%) instead of 2 of 2.
    const archer = r.byAgent.find((t) => t.key === 'archer');
    assert.equal(archer.dispositioned, 2);
    assert.equal(archer.precisionLower, 1);
    assert.equal(r.overall.deferred, 1, 'only the genuinely deferred finding counts as deferred');

    const human = mine(data);
    assert.match(human, /preExisting excluded   1/);
    assert.match(human, new RegExp(ARCHER_PRE_EXISTING.id + '.*deferred\\*'));
  });
});

test('severity folds onto the one scale while the row keeps what is on disk', () => {
  withCorpus((data) => {
    const r = mineJson(data);

    // A legacy P0 and a canonical `blocking` are ONE severity, not two rows -
    // otherwise F9's drift comes back as a measurement artifact. The scale is
    // read from scripts/lib/review-standard.js, never restated here.
    assert.deepEqual(r.bySeverity.map((t) => t.key).sort(), ['advisory', 'blocking']);
    assert.match(r.severityBasis, /review-standard\.js/);

    const blocking = r.bySeverity.find((t) => t.key === 'blocking');
    assert.equal(blocking.dispositioned, 2, 'gaze blocking + archer P0');
    assert.equal(blocking.precisionLower, 1, 'both blocking findings were fixed');

    const advisory = r.bySeverity.find((t) => t.key === 'advisory');
    assert.deepEqual(
      { n: advisory.dispositioned, fixed: advisory.fixed, dismissed: advisory.dismissed, deferred: advisory.deferred },
      { n: 3, fixed: 1, dismissed: 1, deferred: 1 },
      'the preExisting advisory is NOT among these three'
    );

    // What the artifact literally says survives on the row.
    const p0 = r.rows.find((row) => row.id === ARCHER_FIXED_P0.id);
    assert.equal(p0.severityRaw, 'P0');
    assert.equal(p0.severity, 'blocking');
    assert.equal(r.legacySeveritySpellings, '2/5', 'and the fold is reported, not silent');

    // No finding schema field carries a dimension today, so per-dimension
    // precision is reported absent rather than fabricated from claim text.
    assert.deepEqual(r.byDimension, []);
    assert.equal(r.dimensionRecorded, '0/5');
    assert.match(mine(data), /BY DIMENSION[\s\S]{0,200}absent - dimension recorded on 0\/5/);
  });
});

test('an empty corpus reports UNMEASURABLE, never 0% and never a clean review', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'b9b-empty-'));
  try {
    fs.mkdirSync(path.join(data, 'repos'), { recursive: true });
    const r = mineJson(data);
    assert.equal(r.artifactsRead, 0);
    assert.equal(r.overall.precisionLower, null, 'absent, not zero');
    assert.equal(r.overall.precisionUpper, null, 'absent, not one');

    const human = mine(data);
    assert.match(human, /precision\s+UNMEASURABLE/);
    assert.doesNotMatch(human, /precision\s+(0\.0%|100\.0%)/);

    const full = JSON.parse(mine(data, ['--json']));
    const note = full.unresolved.find((u) => u.field === 'review_precision');
    assert.ok(note, 'an empty review corpus is named in unresolved[]');
    assert.match(note.reason, /NOT a clean review and NOT 100% precision/);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('the miner reads dispositions and never records one', () => {
  withCorpus((data) => {
    const preB9 = path.join(data, 'repos', 'feature-web-apps', 'sessions', 'CP-100', 'reviews', 'gaze.json');
    const before = fs.readFileSync(preB9, 'utf-8');
    mine(data);
    mine(data, ['--json']);
    assert.equal(fs.readFileSync(preB9, 'utf-8'), before, 'read-only: no disposition is written back');
    // And nothing in memory pretended either — the loop closer would have
    // defaulted both open findings to `deferred`.
    assert.equal(mineJson(data).overall.deferred, 1, 'only the one genuinely deferred finding is counted');
  });
});
