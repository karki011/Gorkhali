// Author: Subash Karki
// status-vocab.test.js - guards Gorkhali's three status/verdict vocabularies
// against silent bleed, the mechanism adopted from fable-foreman's separation
// of worker status / verifier verdict / ledger lifecycle state (research:
// sessions/foreman-research-rename/research-foreman.md).
//
// Every token set here is IMPORTED OR PARSED from its real definition site,
// never re-listed by hand - a hardcoded copy in this file is the exact drift
// this test exists to catch.
//
// KNOWN COLLISIONS (see KNOWN_COLLISIONS below): the implementer (Engineer)
// task-status vocabulary and the inspector (verifier) evidence-state vocabulary
// already shared the token `failed` before this test existed - `agents/
// engineer.md`'s `status` field and `agents/inspector.md`'s per-check `result`
// field both used it independently. Renaming either is out of this PR's scope
// (extend-only; a rename would touch scripts/validate-artifact.js, commands/
// execute.md, commands/verify.md, hooks/*, and every hardcoded test string
// across the repo) and is tracked as a deferred follow-up: rename one side's
// `failed` (candidate: inspector verdict `failed` -> `check-failed`) with a
// full consumer census. This test structurally encodes that as debt rather than
// hiding it: any collision NOT in the allowlist fails the test, and the day the
// rename lands, deleting the allowlist entry makes full pairwise disjointness
// enforced with no other change needed here.
//
// NOTE for future maintainers: `gorkhali-state.mjs`'s ARTIFACT_STATUSES
// (pending/passed/failed/blocked/skipped) is a real, FOURTH status vocabulary
// (recorded workflow/run-artifact outcomes) that already collides with both of
// the vocabularies below. It is deliberately NOT part of this test - it is not
// the disjoint "lifecycle" tier fable-foreman describes (see parseLifecycleStates
// below for the one that is). Do not "helpfully" fold it in here without first
// deciding what to do about its own collisions.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { EXECUTION_TASK_STATUSES } = require('../scripts/validate-artifact');

const REPO_ROOT = path.join(__dirname, '..');

// --- Inspector (verifier) evidence-state vocabulary, parsed from its real
// definition site: agents/inspector.md's "## Evidence states" section. ---
function parseInspectorVerdicts() {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'agents', 'inspector.md'), 'utf8');
  const start = content.indexOf('## Evidence states');
  assert.ok(start !== -1, 'agents/inspector.md: "## Evidence states" section not found');
  const end = content.indexOf('## Output', start);
  assert.ok(end !== -1, 'agents/inspector.md: "## Output" section not found after evidence states');
  const section = content.slice(start, end);
  const tokens = [...section.matchAll(/^- `([a-z0-9-]+)`/gm)].map((m) => m[1]);
  assert.ok(tokens.length >= 4, `agents/inspector.md: expected at least 4 evidence-state tokens, found ${tokens.length}`);
  return tokens;
}

// --- Session lifecycle vocabulary, parsed from its real definition site:
// skills/gorkhali/references/state.md's "Session envelopes use ..." sentence.
// Deliberately NOT the ARTIFACT_STATUSES set (pending/passed/failed/blocked/
// skipped) also defined in gorkhali-state.mjs - that set is itself a mix of
// recorded workflow/run outcomes and already collides with both other
// vocabularies, so it is not the disjoint "lifecycle" tier fable-foreman
// describes. The session envelope's own active/paused/completed is. ---
function parseLifecycleStates() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, 'skills', 'gorkhali', 'references', 'state.md'),
    'utf8',
  );
  const sentence = content.match(/Session envelopes use[^.]*\./);
  assert.ok(sentence, 'skills/gorkhali/references/state.md: "Session envelopes use ..." sentence not found');
  const tokens = [...sentence[0].matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);
  assert.ok(tokens.length >= 3, `state.md: expected at least 3 lifecycle tokens, found ${tokens.length}`);
  return tokens;
}

function intersect(a, b) {
  const setB = new Set(b);
  return [...new Set(a)].filter((tok) => setB.has(tok)).sort();
}

// Pre-existing cross-vocabulary collisions, allowed ONLY here, ONLY by exact
// token. See the file-header comment for why `failed` is in this set and what
// retires it.
const KNOWN_COLLISIONS = new Set(['failed']);

function assertDisjoint(nameA, setA, nameB, setB) {
  const collision = intersect(setA, setB).filter((tok) => !KNOWN_COLLISIONS.has(tok));
  assert.deepEqual(
    collision,
    [],
    `${nameA} and ${nameB} share unexpected token(s) not in KNOWN_COLLISIONS: ${collision.join(', ')}`,
  );
}

test('implementer status vocabulary carries the extended tokens', () => {
  assert.ok(EXECUTION_TASK_STATUSES.includes('done-with-concerns'));
  assert.ok(EXECUTION_TASK_STATUSES.includes('needs-context'));
  assert.ok(EXECUTION_TASK_STATUSES.includes('done'));
  assert.ok(EXECUTION_TASK_STATUSES.includes('failed'));
  assert.ok(EXECUTION_TASK_STATUSES.includes('skipped'));
});

test('inspector verdict vocabulary carries the extended token', () => {
  const verdicts = parseInspectorVerdicts();
  assert.ok(verdicts.includes('passed-with-notes'));
  assert.ok(verdicts.includes('passed'));
  assert.ok(verdicts.includes('failed'));
  assert.ok(verdicts.includes('blocked'));
  assert.ok(verdicts.includes('not-applicable'));
});

test('lifecycle vocabulary parses to active/paused/completed/abandoned', () => {
  const lifecycle = parseLifecycleStates();
  assert.deepEqual([...lifecycle].sort(), ['abandoned', 'active', 'completed', 'paused']);
});

test('the three vocabularies are pairwise disjoint except KNOWN_COLLISIONS', () => {
  const verdicts = parseInspectorVerdicts();
  const lifecycle = parseLifecycleStates();
  assertDisjoint('lifecycle', lifecycle, 'implementer', EXECUTION_TASK_STATUSES);
  assertDisjoint('lifecycle', lifecycle, 'inspector', verdicts);
  assertDisjoint('implementer', EXECUTION_TASK_STATUSES, 'inspector', verdicts);
});

test('KNOWN_COLLISIONS holds exactly the collisions that exist today - delete an entry once its rename lands', () => {
  const verdicts = parseInspectorVerdicts();
  const lifecycle = parseLifecycleStates();
  const actual = new Set([
    ...intersect(lifecycle, EXECUTION_TASK_STATUSES),
    ...intersect(lifecycle, verdicts),
    ...intersect(EXECUTION_TASK_STATUSES, verdicts),
  ]);
  // Fails in BOTH directions on purpose: a new, unallowlisted collision fails
  // here (fix it or allowlist it deliberately); an allowlisted collision that
  // no longer exists ALSO fails here, so the allowlist entry cannot go stale
  // once the deferred rename actually lands.
  assert.deepEqual([...actual].sort(), [...KNOWN_COLLISIONS].sort());
});

test('every newly added token is collision-free against the union of all three vocabularies', () => {
  const verdicts = parseInspectorVerdicts();
  const lifecycle = parseLifecycleStates();
  const newTokens = ['done-with-concerns', 'needs-context', 'passed-with-notes'];
  const all = [...EXECUTION_TASK_STATUSES, ...verdicts, ...lifecycle];
  for (const tok of newTokens) {
    const occurrences = all.filter((t) => t === tok).length;
    assert.equal(occurrences, 1, `${tok} must appear in exactly one vocabulary, found ${occurrences} occurrences`);
  }
});
