// Author: Subash Karki
// Pins the four-review-surface map so users cannot be sent to the wrong skill.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('portable SKILL.md maps the four review surfaces without host slash-commands', () => {
  const skill = read('skills/gorkhali/SKILL.md');
  assert.ok(skill.includes('## Which review to run'));
  assert.ok(skill.includes('| Someone else\'s pull request | `pr-review` |'));
  assert.doesNotMatch(skill, /\/gorkhali:/);
});

test('adapter skills name the wrong surface for review, wrap, and pr-review', () => {
  const review = read('skills/review/SKILL.md');
  const wrap = read('skills/wrap/SKILL.md');
  const prReview = read('skills/pr-review/SKILL.md');
  assert.match(review, /Wrong surface/);
  assert.match(wrap, /does not run Auditor/i);
  assert.match(prReview, /Will not post unless you ask/);
  assert.match(prReview, /Wrong surface/);
});

test('pr-review records honest intent sources and a five-line checklist', () => {
  const cmd = read('commands/pr-review.md');
  assert.match(cmd, /intentSource: "ticket"/);
  assert.match(cmd, /intentSource: "issue"/);
  assert.match(cmd, /intentSource: "pr-body"/);
  assert.match(cmd, /gh pr view --json closingIssuesReferences/);
  assert.doesNotMatch(cmd, /gh pr view --json closingIssues[^\w]/);
  assert.doesNotMatch(cmd, /intentSource: "inferred"/);
  assert.match(cmd, /Intent delivered/);
  assert.match(cmd, /reachable in production/);
  assert.match(cmd, /REVIEW\.md/);
  assert.match(cmd, /What landed properly/);
  assert.match(cmd, /no `open` attribute/);
});
