// Author: Subash Karki
// router-lite.test.js — pins the LITE route (below DIRECT, orchestrator-decided)
// across the router docs, the start.md route section, and the eval vocabulary.
// LITE exists to cut spawn count on trivial work; these checks fail if a future
// edit quietly drops the route or lets it bypass a safety floor (subagent law,
// defect-proof gate, fix-loop ceiling).
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

test('router.md route table carries LITE below DIRECT with zero gates', () => {
  const doc = read('reference/router.md');
  const row = doc.split('\n').find((l) => l.includes('**LITE**'));
  assert.ok(row, 'router.md must carry a LITE row');
  assert.ok(row.includes('Execute + Inspect'), 'LITE ceremony is Execute + Inspect');
  const lite = doc.indexOf('**LITE**');
  const direct = doc.indexOf('**DIRECT**');
  assert.ok(lite !== -1 && direct !== -1 && lite < direct, 'LITE sits above DIRECT in the table (the cheaper route first)');
});

test('algorithm.md selects LITE above DIRECT and keeps the hard floors', () => {
  const doc = read('reference/router/algorithm.md');
  assert.ok(doc.indexOf('-> LITE') !== -1, 'algorithm.md must select LITE');
  assert.ok(
    doc.indexOf('-> LITE') < doc.indexOf('-> DIRECT'),
    'the LITE selection line must sit above DIRECT',
  );
  assert.ok(/never LITE/i.test(doc), 'algorithm.md must state the defect-proof floor (never LITE)');
});

test('routes.md specifies the LITE flow with Inspector-only verification', () => {
  const doc = read('reference/router/routes.md');
  assert.ok(doc.includes('## LITE'), 'routes.md must carry a LITE section');
  const section = doc.slice(doc.indexOf('## LITE'), doc.indexOf('## DIRECT'));
  assert.ok(/Inspector-only/.test(section), 'LITE verification is Inspector-only');
  assert.ok(/gorkhali:fix/.test(section), 'LITE failure chains to gorkhali:fix');
  assert.ok(/"LITE"/.test(section), 'route-decision.json records "LITE"');
});

test('routes.md LITE spec names the lifecycle recording', () => {
  const doc = read('reference/router/routes.md');
  const section = doc.slice(doc.indexOf('## LITE'), doc.indexOf('## DIRECT'));
  assert.ok(/gorkhali-state\.mjs/.test(section), 'routes.md LITE spec must name the gorkhali-state recording');
});

test('the eval route vocabulary includes LITE', () => {
  const src = read('scripts/run-evals.js');
  const match = src.match(/const ROUTES = \[([^\]]+)\]/);
  assert.ok(match, 'run-evals.js must declare ROUTES');
  assert.ok(match[1].includes("'LITE'"), 'ROUTES must include LITE');
});

// The portable lifecycle (Kimi/Codex path) must know the same route: a session
// started with --route lite would otherwise be rejected at start, nulled by
// outcome-write.js, and misattributed by route-report.js.
test('the portable lifecycle route vocabulary includes lite', () => {
  const state = read('skills/gorkhali/scripts/gorkhali-state.mjs');
  assert.ok(
    state.includes("const ROUTES = new Set(['lite', 'direct', 'plan', 'brainstorm', 'full'])"),
    'gorkhali-state.mjs ROUTES must include lite',
  );
  const approvals = state.match(/const ROUTE_APPROVALS = \{[\s\S]*?\};/);
  assert.ok(approvals && /lite: \[\]/.test(approvals[0]), 'lite carries no approval gates, same as direct');

  const outcome = read('scripts/outcome-write.js');
  assert.ok(
    outcome.includes("['lite', 'direct', 'plan', 'brainstorm', 'full']"),
    'outcome-write.js ROUTE enum must include lite',
  );
});
