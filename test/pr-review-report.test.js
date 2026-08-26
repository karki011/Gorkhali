// Author: Subash Karki
// Pins the pr-review comment contract: every section is collapsed <details>,
// positives and quality are required and cited, and a review cannot be invented
// from vibe or the PR body's self-description.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CMD = fs.readFileSync(path.join(__dirname, '..', 'commands', 'pr-review.md'), 'utf8');
const STEP6 = CMD.slice(CMD.indexOf('## 6. Report'));

test('pr-review report leads with a verdict line, then only collapsed sections', () => {
  assert.match(STEP6, /one verdict line/);
  assert.match(STEP6, /<details>/);
  assert.match(STEP6, /<summary>/);
  assert.match(STEP6, /no `open` attribute/);
  assert.doesNotMatch(STEP6, /above the fold/);
});

test('pr-review report requires What landed properly and What can improve', () => {
  assert.match(STEP6, /What landed properly/);
  assert.match(STEP6, /required even on FAIL/);
  assert.match(STEP6, /Never generic praise/);
  assert.match(STEP6, /What can improve/);
});

test('pr-review report requires evidence-based repo and code-quality lines', () => {
  assert.match(STEP6, /Repo and code quality/);
  assert.match(STEP6, /existing patterns/);
  assert.match(STEP6, /code-quality bar/);
  assert.match(STEP6, /not to a generic standard/);
});

test('pr-review report keeps the five-line checklist inside a collapsed section', () => {
  assert.match(STEP6, /Intent delivered/);
  assert.match(STEP6, /reachable in production/);
  assert.match(STEP6, /worse than before/);
  assert.match(STEP6, /review-gaps\.js/);
  assert.match(STEP6, /Docs\/ops/);
  assert.match(STEP6, /Inventing a yes is not/);
});

test('pr-review report refuses unconfirmed claims as facts', () => {
  assert.match(STEP6, /needs-verification/);
  assert.match(STEP6, /Do not manufacture a review/);
  assert.match(CMD, /Do not ask the reviewer for praise/);
});
