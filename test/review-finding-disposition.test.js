// Author: Subash Karki
// review-finding-disposition.test.js — B9. Three failure classes are pinned here:
//
//  1. the reviewer artifact having NO schema at all (which is how F9's drift —
//     two finding shapes, four severity vocabularies — went unnoticed): the new
//     `review` type validates the finding ELEMENT, not just "is an array";
//  2. finding ids that are not stable across re-review rounds, which would make
//     a carried-over finding indistinguishable from a newly invented one and
//     leave the B9 baseline with nothing to count;
//  3. a disposition that attaches to the review rather than to the individual
//     finding, which is the exact gap `review.fixLoops` already has.
//
// The validator tests spawn the REAL CLI (same pattern as validate-artifact.test.js)
// so exit codes and stderr are production paths.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-artifact.js');
const rf = require(path.join(REPO_ROOT, 'scripts', 'lib', 'review-finding.js'));
const lc = require(path.join(REPO_ROOT, 'hooks', 'loop-controller.js'));

function runValidator(artifact) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-artifact-'));
  const file = path.join(dir, 'gaze.json');
  fs.writeFileSync(file, JSON.stringify(artifact));
  try {
    const stdout = execFileSync('node', [VALIDATOR, 'review', file], { encoding: 'utf-8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: (e.stdout || '').toString(),
      stderr: (e.stderr || '').toString(),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The shape agents/gaze.md documents today, verbatim: no _meta, snake-case gaps,
// no id, no disposition.
const gazeFinding = (overrides = {}) => ({
  severity: 'blocking',
  file: 'src/example.ts',
  line: 42,
  evidence: 'parseConfig() dereferences opts.root before the null guard',
  impact: 'A config without a root crashes the session at start',
  remediation: 'Move the guard above the dereference',
  ...overrides,
});

const gazeArtifact = (findings = [gazeFinding()]) => ({
  role: 'gaze',
  verdict: 'fail',
  findings,
  observation_gaps: [],
});

// --- the artifact shape written today keeps validating (backward compatibility) ---

test('review: the gaze artifact as written today (no _meta, no id, no disposition) passes', () => {
  const res = runValidator(gazeArtifact());
  assert.equal(res.code, 0, `existing reviewer artifacts must not start failing, stderr: ${res.stderr}`);
});

test('review: a clean review is a written empty findings array', () => {
  const res = runValidator({ role: 'gaze', verdict: 'pass', findings: [], observation_gaps: [] });
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
});

test('review: the archer specialist artifact (camelCase gaps) passes on the same schema', () => {
  const res = runValidator({ role: 'archer', verdict: 'pass', findings: [], observationGaps: [] });
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
});

test('review: the legacy temperature-review finding shape (temperature/issue) passes', () => {
  const res = runValidator(
    gazeArtifact([{ temperature: 'P0', file: 'src/Example.tsx', line: 42, issue: 'Null check missing', fix: 'Add optional chaining' }])
  );
  assert.equal(res.code, 0, `B9 changes no reviewer vocabulary, stderr: ${res.stderr}`);
});

test('review: a missing findings array is rejected (absent is not a clean review)', () => {
  const res = runValidator({ role: 'gaze', verdict: 'pass', observation_gaps: [] });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings: required array/);
});

// --- malformed findings ---

test('review: a non-object finding is rejected', () => {
  const res = runValidator(gazeArtifact(['looks bad to me']));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[0\]: must be an object/);
});

test('review: a finding with no file and no severity is rejected on BOTH fields', () => {
  const res = runValidator(gazeArtifact([{ evidence: 'something is wrong somewhere' }]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[0\]\.file: required string/);
  assert.match(res.stderr, /findings\[0\]\.severity: required non-empty string/);
});

test('review: a non-numeric line and a non-string evidence are rejected', () => {
  const res = runValidator(gazeArtifact([gazeFinding({ line: 'forty-two', evidence: { text: 'x' } })]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[0\]\.line: must be a number/);
  assert.match(res.stderr, /findings\[0\]\.evidence: must be string/);
});

test('review: an unknown verdict is rejected', () => {
  const res = runValidator({ role: 'gaze', verdict: 'looks-good', findings: [], observation_gaps: [] });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /verdict: must be one of pass\|fail\|blocked/);
});

test('review: an id that is not the derived id is rejected', () => {
  const finding = gazeFinding({ id: 'f_000000000000' });
  const res = runValidator(gazeArtifact([finding]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, new RegExp(`must be the content-derived id "${rf.findingId(finding)}"`));
});

test('review: a random-looking (non f_<12 hex>) id is rejected on format', () => {
  const res = runValidator(gazeArtifact([gazeFinding({ id: '8f14e45f-ceea-467a-9c1e-3a1c9e77b204' })]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /id: must match f_<12 hex>/);
});

test('review: two findings sharing one id are rejected', () => {
  const finding = gazeFinding();
  const id = rf.findingId(finding);
  const res = runValidator(gazeArtifact([{ ...finding, id }, { ...finding, id }]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[1\]\.id: duplicate finding id/);
});

// --- disposition ---

test('review: an unknown disposition value is rejected', () => {
  const finding = gazeFinding();
  const res = runValidator(gazeArtifact([{ ...finding, id: rf.findingId(finding), disposition: 'wontfix' }]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /disposition: must be one of fixed\|dismissed\|deferred/);
});

test('review: a disposition with no id is rejected (an outcome must attach to a finding)', () => {
  const res = runValidator(gazeArtifact([gazeFinding({ disposition: 'fixed' })]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[0\]\.id: required once a disposition is recorded/);
});

test('review: dismissed and deferred require a reason; fixed does not', () => {
  const finding = gazeFinding();
  const id = rf.findingId(finding);
  for (const disposition of ['dismissed', 'deferred']) {
    const res = runValidator(gazeArtifact([{ ...finding, id, disposition }]));
    assert.equal(res.code, 1, `${disposition} without a reason must fail`);
    assert.match(res.stderr, new RegExp(`dispositionReason: required non-empty string when disposition is "${disposition}"`));
  }
  const ok = runValidator(gazeArtifact([{ ...finding, id, disposition: 'fixed' }]));
  assert.equal(ok.code, 0, `fixed is evidenced by the changed code, stderr: ${ok.stderr}`);
});

// --- id derivation: stability is the whole point ---

test('id is stable across two runs on identical content', () => {
  const first = rf.findingId(gazeFinding());
  const second = rf.findingId(gazeFinding());
  assert.equal(first, second, 'same content -> same id');
  assert.match(first, rf.FINDING_ID_RE);
});

test('id survives what changes between re-review rounds: line, severity, key order, whitespace, case', () => {
  const base = gazeFinding();
  const id = rf.findingId(base);

  // The fix loop shifted the file; the finding moved but did not change.
  assert.equal(rf.findingId({ ...base, line: 907 }), id, 'line is not part of the identity');
  // Round 2 re-scored it.
  assert.equal(rf.findingId({ ...base, severity: 'advisory' }), id, 'severity is not part of the identity');
  // The reviewer re-wrapped and re-capitalized the same sentence.
  assert.equal(
    rf.findingId({ ...base, evidence: '  PARSECONFIG() dereferences opts.root\n  before the null guard  ' }),
    id,
    'whitespace and case are formatting, not content'
  );
  // Serialization reordered the keys.
  assert.equal(rf.findingId({ evidence: base.evidence, file: base.file, severity: base.severity }), id, 'key order is irrelevant');
  // Path spelling of the same file.
  assert.equal(rf.findingId({ ...base, file: './src/example.ts' }), id, 'a leading ./ is the same path');
  // And the disposition the loop writes must not re-id the finding it attaches to.
  assert.equal(rf.findingId({ ...base, disposition: 'fixed' }), id, 'the outcome cannot change the identity');
});

test('id separates findings that differ in file or in claim', () => {
  const base = gazeFinding();
  assert.notEqual(rf.findingId({ ...base, file: 'src/other.ts' }), rf.findingId(base));
  assert.notEqual(rf.findingId({ ...base, evidence: 'a different claim entirely' }), rf.findingId(base));
  // The unit separator between the parts stops file and claim bleeding together.
  assert.notEqual(
    rf.findingId({ file: 'src/a', evidence: 'b' }),
    rf.findingId({ file: 'src/ab', evidence: '' })
  );
});

test('assignFindingIds stamps missing ids and never overwrites one already present', () => {
  const findings = [gazeFinding(), gazeFinding({ file: 'src/other.ts', id: 'f_deadbeef0000' })];
  rf.assignFindingIds(findings);
  assert.equal(findings[0].id, rf.findingId(gazeFinding()));
  assert.equal(findings[1].id, 'f_deadbeef0000', 'a recorded id keeps its link to any disposition already against it');
});

// --- disposition round-trip through the loop controller and back out ---

function verificationWith(findings) {
  return { review: { temperature: 0.7, findings, fixLoops: 1 } };
}

test('closeFixLoop attributes an outcome per finding, and it round-trips through the schema', () => {
  const fixed = gazeFinding();
  const open = gazeFinding({ file: 'src/untouched.ts', evidence: 'no focused test covers the guarded path' });
  const bogus = gazeFinding({ file: 'src/other.ts', evidence: 'this reads like a false positive' });
  const v = verificationWith([fixed, open, bogus]);

  const result = lc.closeFixLoop(v, {
    changedFiles: ['./src/example.ts'],
    dismissals: [{ id: rf.findingId(bogus), reason: 'the symbol is generated; the diff cannot reach it' }],
  });

  assert.equal(result.recorded, true);
  assert.deepEqual(result.counts, { fixed: 1, dismissed: 1, deferred: 1 });
  assert.equal(v.review.findings[0].disposition, 'fixed', 'the loop changed its file');
  assert.equal(v.review.findings[1].disposition, 'deferred', 'still open when the loop closed');
  assert.equal(v.review.findings[2].disposition, 'dismissed', 'explicitly waived');
  assert.equal(v.review.findings[1].dispositionReason, lc.DEFAULT_DEFER_REASON);
  assert.equal(v.review.findings[0].dispositionReason, undefined, 'fixed needs no reason');

  // One row per finding id — the per-finding table, not one number for the review.
  assert.deepEqual(result.rows.map((r) => r.id), v.review.findings.map((f) => f.id));
  assert.equal(new Set(result.rows.map((r) => r.id)).size, 3, 'ids are distinct per finding');

  // Round-trip: serialize as the artifact on disk, and the schema accepts it.
  const res = runValidator({ role: 'gaze', verdict: 'fail', findings: v.review.findings, observation_gaps: [] });
  assert.equal(res.code, 0, `dispositioned findings must validate, stderr: ${res.stderr}`);

  // And the ids survive the round-trip unchanged.
  const reread = JSON.parse(JSON.stringify(v.review.findings));
  for (const finding of reread) assert.equal(finding.id, rf.findingId(finding));
});

test('closeFixLoop is idempotent, and a hand-dismissal overrides an earlier outcome', () => {
  const finding = gazeFinding();
  const v = verificationWith([finding]);

  const first = lc.closeFixLoop(v, { changedFiles: ['src/example.ts'] });
  assert.deepEqual(first.counts, { fixed: 1, dismissed: 0, deferred: 0 });

  // A second close with nothing changed must not flip a recorded outcome.
  const second = lc.closeFixLoop(v, { changedFiles: [] });
  assert.deepEqual(second.counts, { fixed: 1, dismissed: 0, deferred: 0 }, 'first close wins');

  // A human dismissing it later flips that row, with no review re-run.
  const third = lc.closeFixLoop(v, { changedFiles: [], dismissals: [{ id: rf.findingId(finding), reason: 'pre-existing; out of scope' }] });
  assert.deepEqual(third.counts, { fixed: 0, dismissed: 1, deferred: 0 });
  assert.equal(v.review.findings[0].disposition, 'dismissed');
  assert.equal(v.review.findings[0].dispositionReason, 'pre-existing; out of scope');
});

test('closeFixLoop leaves the fixLoops counter alone and fails safe on a garbage artifact', () => {
  const v = verificationWith([gazeFinding()]);
  lc.closeFixLoop(v, { changedFiles: [] });
  assert.equal(v.review.fixLoops, 1, 'closing the loop records outcomes; it does not count loops');

  for (const bad of [undefined, null, {}, { review: {} }, { review: { findings: 'nope' } }]) {
    const out = lc.closeFixLoop(bad, {});
    assert.equal(out.recorded, false, 'unusable state records nothing rather than throwing');
    assert.deepEqual(out.counts, { fixed: 0, dismissed: 0, deferred: 0 });
  }
});
