// Author: Subash Karki
// review-verification.test.js — B11. Three things, each pinned by what a human
// can watch happen rather than by "it passes":
//
//   1. the VERIFICATION PASS is a pass over the SOURCE. The literature is
//      explicit that same-context self-critique produces false negatives on the
//      model's own output while independent re-checking against the code cuts
//      false positives, so the prose is asserted to instruct re-reading the
//      cited file and to forbid re-reading the finding list — the failure mode
//      it is one careless edit away from becoming;
//   2. CONFIDENCE is orthogonal to severity. Proved by enumeration: all six
//      combinations validate, neither vocabulary parses as the other, and no
//      validator rule couples them;
//   3. the PRECISION GATE reads a stated input, produces one verdict word, and
//      CANNOT FIRE on today's corpus — which is 0/0 measurable (B9b).
//
// Validator tests spawn the REAL CLI, so exit codes and stderr are production
// paths.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
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

function validate(artifact) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-verify-'));
  const file = path.join(dir, 'auditor.json');
  fs.writeFileSync(file, JSON.stringify(artifact, null, 2));
  try {
    return run(VALIDATOR, ['review', file]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const artifact = (overrides = {}) => ({
  role: 'auditor',
  verdict: 'fail',
  findings: [],
  observationGaps: [],
  ...overrides,
});
const finding = (overrides = {}) => ({
  severity: 'blocking',
  file: 'src/pay/refund.ts',
  line: 88,
  evidence: 'issueRefund() calls charge.capture() after the early return on line 84',
  impact: 'A partial refund silently no-ops',
  remediation: 'Move the capture above the return',
  ...overrides,
});

// --- 1. THE VERIFICATION PASS IS AGAINST THE SOURCE --------------------------

test('the verification pass instructs re-reading the CITED SOURCE, not the finding list', () => {
  const pass = std.renderVerificationPass();

  // The first step is a source-side action, and it names the three substitutes a
  // reviewer would otherwise reach for.
  assert.match(pass, /RE-OPEN the file at the cited line/);
  assert.match(pass, /Not the diff hunk, not your earlier notes, not the summary you already wrote/);
  // The decision is made against the source, not against the finding's prose.
  assert.match(pass, /DECIDE against the source, not against how good the finding sounds/);
  // And the anti-pattern is stated as an anti-pattern.
  assert.match(pass, /If your check did not involve opening a file, it did not happen/);
  assert.match(pass, /Reading the finding list again and agreeing with it is not this pass/);
});

test('the rule names WHY self-critique is the weak version, so it cannot be edited back in', () => {
  assert.match(std.VERIFICATION_RULE.text, /never a second look at your own finding list/);
  assert.match(std.VERIFICATION_RULE.text, /same-context self-critique/);
  assert.match(std.VERIFICATION_RULE.text, /false negatives on your own output/);
  assert.match(std.VERIFICATION_RULE.text, /re-checking a claim against the source is what cuts\s+false positives/);
});

test('an unconfirmable finding is DISCARDED with a reason, never downgraded', () => {
  assert.match(std.VERIFICATION_RULE.text, /DISCARDED, not downgraded/);
  const steps = std.VERIFICATION_PASS.steps.join('\n');
  assert.match(steps, /never silently deleted and never quietly re-scored into an advisory/);
});

test('the verification pass lives in the shared standard, and the auditor reads it BEFORE the artifact write', () => {
  const standard = fs.readFileSync(path.join(REPO_ROOT, 'reference', 'review-standard.md'), 'utf8');
  assert.match(standard, /## Verification pass/);
  assert.match(standard, /RE-OPEN the file at the cited line/);
  // The pass has to precede the finding shape, or a finding lands before it is
  // checked and the whole step is decoration.
  assert.ok(
    standard.indexOf('## Verification pass') < standard.indexOf('## Finding shape'),
    'the verification pass must come before the finding shape in the shared standard'
  );
  const auditor = fs.readFileSync(path.join(REPO_ROOT, 'agents', 'auditor.md'), 'utf8');
  assert.ok(
    auditor.indexOf('## Review standard') < auditor.indexOf('### Artifact First'),
    'auditor.md must read the standard before the artifact-write instruction'
  );
  assert.match(auditor, /which ends with the verification pass from the review\s+standard, not before it/);
});

test('a discarded finding needs a reason - a discard with none is rejected by name', () => {
  const ok = validate(
    artifact({
      discardedFindings: [
        {
          file: 'src/pay/refund.ts',
          evidence: 'issueRefund() was going to be flagged for capturing after the return',
          reason: 're-read refund.ts:84 - the early return is inside a branch that cannot be taken here',
        },
      ],
    })
  );
  assert.equal(ok.code, 0, `a recorded discard must validate, stderr: ${ok.stderr}`);

  const bad = validate(
    artifact({ discardedFindings: [{ file: 'src/pay/refund.ts', evidence: 'the claim' }] })
  );
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /discardedFindings\[0\]\.reason: required non-empty string/);
  assert.match(bad.stderr, /rather than a finding that quietly vanished/);
});

test('`needs-verification` requires an observation gap - it is not a label for "did not check"', () => {
  const unexplained = validate(artifact({ findings: [finding({ confidence: 'needs-verification' })] }));
  assert.equal(unexplained.code, 1);
  assert.match(unexplained.stderr, /"needs-verification" requires a matching observationGaps entry/);

  const explained = validate(
    artifact({
      findings: [finding({ confidence: 'needs-verification' })],
      observationGaps: ['src/pay/refund.ts is generated at build time and is not in the worktree'],
    })
  );
  assert.equal(explained.code, 0, `stderr: ${explained.stderr}`);
});

// --- 2. CONFIDENCE IS ORTHOGONAL TO SEVERITY ---------------------------------

test('severity and confidence are different vocabularies, and neither parses as the other', () => {
  assert.deepEqual(std.SEVERITY_VALUES, ['blocking', 'advisory']);
  assert.deepEqual(std.CONFIDENCE_VALUES, ['confirmed', 'possible', 'needs-verification']);

  const overlap = std.SEVERITY_VALUES.filter((v) => std.CONFIDENCE_VALUES.includes(v));
  assert.deepEqual(overlap, [], 'one value cannot belong to both axes');

  for (const v of std.CONFIDENCE_VALUES) {
    assert.equal(std.normalizeSeverity(v), null, `${v} is not a severity`);
  }
  for (const v of std.SEVERITY_VALUES) {
    assert.equal(std.normalizeConfidence(v), null, `${v} is not a confidence`);
  }
});

test('all six severity x confidence combinations validate - the axes are not coupled', () => {
  const accepted = [];
  for (const severity of std.SEVERITY_VALUES) {
    for (const confidence of std.CONFIDENCE_VALUES) {
      const gaps = confidence === 'needs-verification' ? ['the cited file is vendored'] : [];
      const res = validate(artifact({ findings: [finding({ severity, confidence })], observationGaps: gaps }));
      assert.equal(res.code, 0, `${severity} + ${confidence} must validate, stderr: ${res.stderr}`);
      accepted.push(`${severity}/${confidence}`);
    }
  }
  assert.equal(accepted.length, 6);
  // The two that would be forbidden if uncertainty were smuggled into severity.
  assert.ok(accepted.includes('blocking/possible'), 'an unsure bug stays blocking');
  assert.ok(accepted.includes('advisory/confirmed'), 'a certain nit stays advisory');
});

test('the three axes are named together, with strictness kept apart from both (the F9 correction)', () => {
  const axes = std.REVIEW_AXES.map((a) => a.axis);
  assert.deepEqual(axes, ['strictness', 'severity', 'confidence']);
  const strictness = std.REVIEW_AXES[0];
  assert.match(strictness.key, /review\.temperature/);
  assert.match(strictness.kind, /input/);
  for (const a of std.REVIEW_AXES.slice(1)) assert.match(a.kind, /output/);
  assert.match(std.CONFIDENCE_RULE.text, /neither is computed from the other/);
});

test('an unknown confidence is rejected and the error names the three legal values', () => {
  const res = validate(artifact({ findings: [finding({ confidence: 'pretty sure' })] }));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[0\]\.confidence: must be one of confirmed\|possible\|needs-verification/);
  assert.match(res.stderr, /got "pretty sure"/);
});

test('an artifact with NO confidence still validates - nothing on disk starts failing', () => {
  assert.equal(validate(artifact({ findings: [finding()] })).code, 0);
  const legacy = validate({
    role: 'auditor',
    verdict: 'fail',
    findings: [{ temperature: 'P0', component: 'src/a.ts', line: 7, issue: 'the claim', fix: 'the fix' }],
    observation_gaps: [],
  });
  assert.equal(legacy.code, 0, `pre-B10 artifacts must keep validating, stderr: ${legacy.stderr}`);
});

test('adding confidence does not move a B9 finding id', () => {
  const before = finding();
  const after = finding({ confidence: 'confirmed' });
  assert.equal(rf.findingId(after), rf.findingId(before), 'confidence is not part of the identity');
  // And normalizing an aliased spelling does not move it either.
  const aliased = finding({ confidence: 'Confirmed Issue' });
  assert.equal(std.normalizeFinding(aliased).confidence, 'confirmed');
  assert.equal(rf.findingId(std.normalizeFinding(aliased)), rf.findingId(before));
});

// --- 3. THE PROMOTE/REVERT GATE ----------------------------------------------

const tally = (fixed, dismissed, deferred) => ({
  dispositioned: fixed + dismissed + deferred,
  fixed,
  dismissed,
  deferred,
  precisionLower: fixed + dismissed + deferred ? fixed / (fixed + dismissed + deferred) : null,
  precisionUpper: fixed + dismissed ? fixed / (fixed + dismissed) : null,
});

// F11: the gate only compares two populations that ran on ONE shared model, so
// every case below that expects a verdict has to say which model that was. The
// refusals themselves are pinned in test/review-model-confound.test.js.
const onOneModel = (before, after, model = 'opus') => ({
  before: Array(before.dispositioned).fill(model),
  after: Array(after.dispositioned).fill(model),
});
const gate = (before, after, extra = {}) =>
  std.precisionGate({ before, after, models: onOneModel(before, after), ...extra });

test('the gate CANNOT FIRE today: the corpus is 0/0 measurable and no threshold is invented', () => {
  assert.equal(std.PRECISION_GATE.minSample, null, 'no sample size may be set before data exists');
  assert.match(std.PRECISION_GATE.minSampleReason, /0\/0 measurable/);

  const verdict = std.precisionGate({ before: tally(0, 0, 0), after: tally(0, 0, 0) });
  assert.equal(verdict.verdict, 'unmeasurable');
  assert.match(verdict.reason, /precision is UNMEASURABLE, not 0%/);
});

test('even with data on both sides the gate stays unmeasurable while minSample is unset', () => {
  const verdict = gate(tally(1, 9, 0), tally(9, 1, 0));
  assert.equal(verdict.verdict, 'unmeasurable', 'a threshold nobody set cannot be met');
  assert.match(verdict.reason, /no minimum sample size is set/);
});

test('given a sample size, the gate promotes, reverts, or says the bands overlap', () => {
  const promote = gate(tally(1, 9, 0), tally(9, 1, 0), { minSample: 10 });
  assert.equal(promote.verdict, 'promote');
  assert.match(promote.reason, /verified 90\.0%-90\.0% is entirely above unverified 10\.0%-10\.0%/);
  // F11: a firing verdict states the control it held constant.
  assert.match(promote.reason, /\(both sides on opus\)/);

  const revert = gate(tally(9, 1, 0), tally(1, 9, 0), { minSample: 10 });
  assert.equal(revert.verdict, 'revert');
  assert.match(revert.reason, /entirely below/);

  // A real improvement that the UNCERTAINTY still covers: deferred findings
  // widen both bands, they overlap, and the gate declines to call it.
  const overlap = gate(tally(5, 3, 2), tally(6, 2, 2), { minSample: 10 });
  assert.equal(overlap.verdict, 'inconclusive');
  assert.match(overlap.reason, /bands overlap: verified 60\.0%-75\.0% against unverified 50\.0%-62\.5%/);
});

test('a thin sample cannot promote, and a deferred-only side cannot either', () => {
  const thin = gate(tally(1, 0, 0), tally(1, 0, 0), { minSample: 10 });
  assert.equal(thin.verdict, 'unmeasurable');
  assert.match(thin.reason, /sample too small: unverified 1, verified 1, minimum 10/);

  // Every disposition deferred: no upper bound exists, so the band is read at
  // its most permissive and the gate refuses to move in either direction.
  const allDeferred = gate(tally(0, 0, 12), tally(11, 1, 0), { minSample: 10 });
  assert.equal(allDeferred.verdict, 'inconclusive', 'an undefined upper bound must not manufacture a promote');
});

test('the baseline miner prints the gate with both sides and an UNMEASURABLE verdict', () => {
  const report = run(path.join(REPO_ROOT, 'scripts', 'baseline-report.js'), []);
  assert.equal(report.code, 0, report.stderr);
  assert.match(report.stdout, /VERIFICATION GATE \(B11\)/);
  assert.match(report.stdout, /unverified \(before\)/);
  assert.match(report.stdout, /verified {3}\(after\)/);
  assert.match(report.stdout, /minimum sample\s+UNSET/);
  assert.match(report.stdout, /VERDICT\s+UNMEASURABLE/);
  // The input is printed next to the verdict so the number can never be quoted
  // without what produced it.
  assert.match(report.stdout, /input\s+scripts\/baseline-report\.js REVIEW FINDINGS/);
});

test('the gate input names byConfidence, and the miner actually emits that key', () => {
  assert.match(std.PRECISION_GATE.input, /reviewFindings\.byConfidence/);
  const report = run(path.join(REPO_ROOT, 'scripts', 'baseline-report.js'), ['--json']);
  assert.equal(report.code, 0, report.stderr);
  const parsed = JSON.parse(report.stdout);
  assert.ok(Array.isArray(parsed.reviewFindings.byConfidence), 'byConfidence must exist for the gate to read');
  assert.equal(parsed.reviewFindings.verificationGate.verdict, 'unmeasurable');
  assert.equal(parsed.reviewFindings.verificationGate.minSample, null);
  assert.ok(
    parsed.unresolved.some((u) => u.field === 'review_verification_gate'),
    'a gate that cannot fire says so in unresolved[] rather than reporting a verdict'
  );
});
