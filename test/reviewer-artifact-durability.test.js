// Author: Subash Karki
// Semantic contracts for Phantom's lean, artifact-backed quality pipeline.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SPECIALIST_PATHS = [
  'reviews/specialists/archer.json',
];

const FILES = {
  archer: 'agents/archer.md',
  gaze: 'agents/gaze.md',
  review: 'commands/review.md',
  rpsl: 'reference/wrap/rpsl.md',
  verify: 'commands/verify.md',
  verificationReference: 'reference/verification.md',
  ward: 'agents/ward.md',
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

test('Ward is a read-only verifier and verify never auto-fixes failures', () => {
  const ward = read('ward');
  const verify = read('verify');

  assert.match(ward, /read-only verifier/i);
  assert.match(ward, /do not implement fixes|do not modify/i);
  assert.match(ward, /worktree (?:status is )?unchanged|worktree_unchanged/i);
  assert.match(verify, /never auto-fix|does not auto-fix|never edits code/i);
});

test('verify orders Ward, Sweep, affected Ward rerun, then Gaze', () => {
  assertOrdered(read('verify'), [
    /Ward[^\n]*deterministic correctness/i,
    /Sweep[^\n]*minimum-sufficient simplification/i,
    /Affected Ward rerun/i,
    /Gaze[^\n]*default independent reviewer/i,
  ]);
});

test('missing required Ward or Gaze evidence blocks the pipeline', () => {
  const verify = read('verify');
  const review = read('review');
  const wrap = read('wrap');

  assert.match(verify, /missing Ward result blocks verification/i);
  assert.match(review, /Gaze[\s\S]{0,300}remains absent[\s\S]{0,120}blocked/i);
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

test('one Gaze is the default and specialists require explicit risk triggers', () => {
  const verify = read('verify');
  const review = read('review');
  const verificationReference = read('verificationReference');

  assert.match(verify, /one fresh, read-only Gaze pass/i);
  assert.match(review, /Run one fresh, read-only Gaze pass/i);
  assert.match(verificationReference, /User-visible UI\/visual behavior[\s\S]{0,100}user verification/i);
  assert.match(verificationReference, /Auth, authorization, permissions[\s\S]{0,40}Archer/i);
  assert.match(review, /Run exactly the roles named by verification's `requiredSpecialists`/i);
  assert.match(review, /only for explicit risk triggers/i);
});

test('triggered specialist artifacts have fixed paths, shape, and blocking semantics', () => {
  const archer = read('archer');
  const verify = read('verify');
  const review = read('review');
  const rpsl = read('rpsl');

  assert.match(archer, /reviews\/specialists\/archer\.json/i);
  assert.match(archer, /"verdict": "pass\|fail\|blocked"/i);
  assert.match(archer, /"findings": \[\]/i);
  assert.match(archer, /"observationGaps": \[\]/i);
  assert.match(archer, /chat-only verdict never counts/i);

  for (const [name, content] of [['verify', verify], ['review', review]]) {
    for (const specialistPath of SPECIALIST_PATHS) {
      assert.ok(content.includes(specialistPath), `${name} must use ${specialistPath}`);
    }
    assert.match(content, /(?:clear|remove|delete)[\s\S]{0,240}(?:before spawn|then (?:immediately )?spawn)/i, `${name} must clear selected artifacts before spawn`);
    assert.match(content, /verdict[\s\S]{0,80}pass[\s\S]{0,40}fail[\s\S]{0,40}blocked/i, `${name} must validate the specialist verdict`);
    assert.match(content, /findings[\s\S]{0,40}(?:array|\[\])[\s\S]{0,80}observationGaps/i, `${name} must validate specialist arrays`);
    assert.match(content, /specialist `?fail`?[\s\S]{0,160}(?:failed|blocks)/i, `${name} must reject a failed specialist`);
    assert.match(content, /missing[\s\S]{0,100}(?:required )?specialist[\s\S]{0,100}blocked/i, `${name} must block on missing or blocked specialist evidence`);
    assert.match(content, /every (?:triggered specialist|role named[\s\S]{0,80}requiredSpecialists)[\s\S]{0,60}(?:pass|passing)/i, `${name} must require all selected specialists to pass`);
  }

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

test('Archer is risk-selected and shipping rejects unobserved required review', () => {
  const archer = read('archer');
  const wrap = read('wrap');

  assert.match(archer, /risk-triggered specialist/i);
  assert.doesNotMatch(archer, /panel's four|all four panel|mandatory RPSL/i);
  assert.match(wrap, /triggered specialist is missing, failed, blocked, or stale/i);
  assert.match(wrap, /cross-gate contract: stop/i);
  assert.doesNotMatch(wrap, /unobserved perspective does|not_observed[\s\S]{0,160}ship/i);
});
