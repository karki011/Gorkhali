// Author: Subash Karki
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const REFERENCES = path.join(ROOT, 'skills', 'phantom', 'references');

test('review preserves complete findings before deterministic filtering', () => {
  const verification = fs.readFileSync(path.join(REFERENCES, 'verification.md'), 'utf8');
  const roles = fs.readFileSync(path.join(REFERENCES, 'roles.md'), 'utf8');
  const review = fs.readFileSync(path.join(ROOT, 'skills', 'review', 'SKILL.md'), 'utf8');

  assert.match(verification, /Record every evidence-backed supported\s+severity/i);
  assert.match(verification, /acceptance policy separately identifies blockers/i);
  assert.match(roles, /findings.*every evidence-backed supported severity/is);
  assert.match(review, /report every evidence-backed finding/i);
  assert.match(review, /complete finding record separate from the\s+deterministic gate decision/i);
});

test('evaluation is conditional, bounded, and terminal', () => {
  const workflows = fs.readFileSync(path.join(REFERENCES, 'workflows.md'), 'utf8');
  const verification = fs.readFileSync(path.join(REFERENCES, 'verification.md'), 'utf8');

  assert.match(workflows, /never merely\s+to\s+double-check the active agent/i);
  assert.match(workflows, /not a fixed role stack/i);
  for (const terminal of [
    'budget_exhausted',
    'iteration_limit',
    'stuck_same_failure',
    'missing_evidence',
    'human_decision_required',
  ]) {
    assert.match(verification, new RegExp(terminal));
  }
});

test('ordinary review uses balanced compute and elevates by risk', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(REFERENCES, 'model-policy.json'), 'utf8'));
  assert.equal(policy.roles.gaze, 'balanced');
  assert.equal(policy.roles.archer, 'balanced');
  assert.ok(policy.critical_elevation.eligible_roles.includes('gaze'));
  assert.ok(policy.critical_elevation.eligible_roles.includes('archer'));
});
