// Author: Subash Karki
// Semantic contracts for Gorkhali's lean, artifact-backed quality pipeline.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SPECIALIST_PATHS = [
  'reviews/specialists/justice.json',
];

const FILES = {
  justice: 'agents/justice.md',
  auditor: 'agents/auditor.md',
  review: 'commands/review.md',
  rpsl: 'reference/wrap/rpsl.md',
  verify: 'commands/verify.md',
  verificationReference: 'skills/gorkhali/references/verification.md',
  inspector: 'agents/inspector.md',
  wrap: 'commands/wrap.md',
};

function read(name) {
  return fs.readFileSync(path.join(ROOT, FILES[name]), 'utf8');
}

function assertOrdered(content, patterns) {
  let previous = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(content);
    assert.ok(match, `missing pipeline stage ${pattern}`);
    assert.ok(match.index > previous, `${pattern} is out of order`);
    previous = match.index;
  }
}

test('Inspector is a read-only verifier and verify never auto-fixes failures', () => {
  const inspector = read('inspector');
  const verify = read('verify');

  assert.match(inspector, /read-only verifier/i);
  assert.match(inspector, /do not implement fixes|do not modify/i);
  assert.match(inspector, /worktree (?:status is )?unchanged|worktree_unchanged/i);
  assert.match(verify, /never auto-fix|does not auto-fix|never edits code/i);
});

test('verify orders Inspector, Steward, affected Inspector rerun, then Auditor', () => {
  assertOrdered(read('verify'), [
    /Inspector[^\n]*deterministic correctness/i,
    /Steward[^\n]*minimum-sufficient simplification/i,
    /Affected Inspector rerun/i,
    /Auditor[^\n]*default independent reviewer/i,
  ]);
});

test('missing required Inspector or Auditor evidence blocks the pipeline', () => {
  const verify = read('verify');
  const review = read('review');
  const wrap = read('wrap');

  assert.match(verify, /missing Inspector result blocks verification/i);
  assert.match(review, /Auditor[\s\S]{0,300}remains absent[\s\S]{0,120}blocked/i);
  assert.match(wrap, /triggered specialist is missing, failed, blocked, or stale/i);
  assert.match(wrap, /cross-gate contract: stop/i);
});

test('verification and review share the portable lifecycle fingerprint', () => {
  const verify = read('verify');
  const review = read('review');
  const wrap = read('wrap');

  assert.match(verify, /portable helper[\s\S]{0,220}worktree\s+fingerprint/i);
  assert.match(review, /portable verification artifact[\s\S]{0,160}fingerprint/i);
  assert.match(review, /review must be newer[\s\S]{0,100}verification/i);
  assert.match(wrap, /portable lifecycle state, worktree fingerprint,[\s\S]{0,100}authority/i);
});

test('one Auditor is the default and specialists require explicit risk triggers', () => {
  const verify = read('verify');
  const review = read('review');
  const verificationReference = read('verificationReference');

  assert.match(verify, /one fresh, read-only Auditor pass/i);
  assert.match(review, /Run one fresh, read-only Auditor pass/i);
  assert.match(verificationReference, /User-visible UI\/visual behavior[\s\S]{0,100}user verification/i);
  assert.match(verificationReference, /Auth, authorization, permissions[\s\S]{0,40}Justice/i);
  assert.match(review, /Run exactly the roles named by verification's `requiredSpecialists`/i);
  assert.match(review, /only for explicit risk triggers/i);
});

test('triggered specialist artifacts have fixed paths, shape, and blocking semantics', () => {
  const justice = read('justice');
  const verify = read('verify');
  const review = read('review');
  const rpsl = read('rpsl');
  const standard = fs.readFileSync(path.join(ROOT, 'reference', 'review-standard.md'), 'utf8');

  assert.match(justice, /reviews\/specialists\/justice\.json/i);
  assert.match(justice, /chat-only verdict never counts/i);
  // The artifact shape literals live in the shared review standard, which
  // justice.md reads at runtime (kept inline there, generated + drift-checked).
  assert.match(justice, /review-standard\.md/);
  assert.match(standard, /"verdict": "pass\|fail\|blocked"/i);
  assert.match(standard, /"findings": \[\]/i);
  assert.match(standard, /"observationGaps": \[\]/i);

  for (const [name, content] of [['verify', verify], ['review', review]]) {
    for (const specialistPath of SPECIALIST_PATHS) {
      assert.ok(content.includes(specialistPath), `${name} must use ${specialistPath}`);
    }
    assert.match(content, /(?:clear|remove|delete)[\s\S]{0,240}(?:before spawn|then (?:immediately )?spawn)/i, `${name} must clear selected artifacts before spawn`);
  }

  // commands/review.md is the single owner of the verdict shape, array shape,
  // and fail/blocked reduction rules; commands/verify.md is a pointer only
  // (one-owner-one-statement — see commands/verify.md's "Required check" and
  // "Specialists" bullets).
  assert.match(review, /verdict[\s\S]{0,80}pass[\s\S]{0,40}fail[\s\S]{0,40}blocked/i, 'review must validate the specialist verdict');
  assert.match(review, /findings[\s\S]{0,40}(?:array|\[\])[\s\S]{0,80}observationGaps/i, 'review must validate specialist arrays');
  assert.match(review, /specialist `?fail`?[\s\S]{0,160}(?:failed|blocks)/i, 'review must reject a failed specialist');
  assert.match(review, /missing[\s\S]{0,100}(?:required )?specialist[\s\S]{0,100}blocked/i, 'review must block on missing or blocked specialist evidence');
  assert.match(review, /every (?:triggered specialist|role named[\s\S]{0,80}requiredSpecialists)[\s\S]{0,60}(?:pass|passing)/i, 'review must require all selected specialists to pass');
  assert.match(verify, /review\.md.{0,20}steps? [\d,\s-]+(?:and \d )?own the (?:verdict shape|pass\/duplicate\/missing consequences)/i, 'verify must point at review.md for the verdict/fail/blocked rules rather than restate them');

  assert.match(rpsl, /missing selected\s+artifact is `?blocked`?, not pass/i);
});

test('RPSL is optional and its selected perspectives are non-overlapping', () => {
  const rpsl = read('rpsl');
  const rows = rpsl
    .split('\n')
    .filter((line) => /^\| `(scope|regression|architecture|operations)` \|/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));

  assert.match(rpsl, /optional deep-review preset/i);
  assert.match(rpsl, /not part of normal verify or wrap/i);
  assert.match(rpsl, /Do not spawn four agents by habit/i);
  assert.ok(rows.length >= 2, 'RPSL must define bounded perspective contracts');
  assert.equal(new Set(rows.map((row) => row[1])).size, rows.length, 'perspective questions must be distinct');
  assert.ok(rows.every((row) => row[2]), 'each perspective must state what is out of scope');
});

test('Justice is risk-selected and shipping rejects unobserved required review', () => {
  const justice = read('justice');
  const wrap = read('wrap');

  assert.match(justice, /risk-triggered specialist/i);
  assert.doesNotMatch(justice, /panel's four|all four panel|mandatory RPSL/i);
  assert.match(wrap, /triggered specialist is missing, failed, blocked, or stale/i);
  assert.match(wrap, /cross-gate contract: stop/i);
  assert.doesNotMatch(wrap, /unobserved perspective does|not_observed[\s\S]{0,160}ship/i);
});
