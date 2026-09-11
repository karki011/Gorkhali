// Author: Subash Karki
// Semantic contracts for Gorkhali's lean, artifact-backed quality pipeline.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

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

// Four tests removed (W2-T8): "verify orders Inspector, Steward, affected
// Inspector rerun, then Auditor", "verification and review share the portable
// lifecycle fingerprint", "one Auditor is the default and specialists require
// explicit risk triggers", and "triggered specialist artifacts have fixed
// paths, shape, and blocking semantics". All four pinned machinery the lean
// rewrite of commands/verify.md and commands/review.md retires outright: the
// Steward simplification stage and its affected-Inspector rerun, the shared
// worktree-fingerprint freshness contract between verify and review, the
// requiredSpecialists risk-trigger selection, and the specialist artifact
// paths/shapes (reviews/specialists/justice.json, RPSL). Auditor now absorbs
// Steward and Justice directly and emits one fixed record with a single
// user-verification-classification check; there is no specialist array, no
// fingerprint ledger, and no round to share between the two commands.

test('missing required Inspector evidence blocks verification', () => {
  const verify = read('verify');
  assert.match(verify, /missing Inspector result blocks verification/i);
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

test('Justice is risk-selected, not a mandatory panel', () => {
  const justice = read('justice');
  assert.match(justice, /risk-triggered specialist/i);
  assert.doesNotMatch(justice, /panel's four|all four panel|mandatory RPSL/i);
});
