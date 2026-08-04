// Author: Subash Karki
// routing-prose.test.js — pins structural and content invariants for the
// routing discipline system: reference/routing.md and the hooks.
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

function exists(rel) {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

// ── reference/routing.md ──────────────────────────────────────────────────

test('reference/routing.md exists', () => {
  assert.ok(exists('reference/routing.md'), 'reference/routing.md must exist');
});

test('routing.md contains fail-open polarity language', () => {
  const content = read('reference/routing.md');
  assert.ok(
    /fail[s]? open|fail-open/i.test(content),
    'routing.md must state that the gate fails open'
  );
});

test('routing.md contains the Bash loophole note (sed -i or shell redirect)', () => {
  const content = read('reference/routing.md');
  assert.ok(
    /sed -i|shell redirect/i.test(content),
    'routing.md must document the Bash/shell loophole (sed -i or shell redirect)'
  );
});

test('routing.md documents phantom-known scoping', () => {
  const content = read('reference/routing.md');
  assert.ok(
    /phantom-known/i.test(content),
    'routing.md must describe phantom-known repo scoping'
  );
});

// ── env-var toggle (replaces the removed config.yaml) ─────────────────────

test('routing.md documents the PHANTOM_ROUTING_ENFORCE env toggle', () => {
  const content = read('reference/routing.md');
  assert.ok(
    /PHANTOM_ROUTING_ENFORCE/.test(content),
    'routing.md must document PHANTOM_ROUTING_ENFORCE as the opt-in arm toggle'
  );
});

// ── hooks/routing-gate.js ─────────────────────────────────────────────────

test("hooks/routing-gate.js deny reason contains '/phantom:start'", () => {
  const content = read('hooks/routing-gate.js');
  assert.ok(
    content.includes('/phantom:start'),
    "routing-gate.js deny reason must reference '/phantom:start'"
  );
});

test("hooks/routing-gate.js deny reason contains 'PHANTOM_ADHOC'", () => {
  const content = read('hooks/routing-gate.js');
  assert.ok(
    content.includes('PHANTOM_ADHOC'),
    "routing-gate.js must reference 'PHANTOM_ADHOC' in its deny reason or bypass logic"
  );
});

// ── hooks/router-nudge.js ─────────────────────────────────────────────────

test("hooks/router-nudge.js contains 'FIRST' (first-edit language)", () => {
  const content = read('hooks/router-nudge.js');
  assert.ok(
    content.includes('FIRST'),
    "router-nudge.js must contain 'FIRST' documenting the first-edit routing trigger"
  );
});

// ── .claude-plugin/hooks.json ─────────────────────────────────────────────

test("hooks.json contains 'router-nudge'", () => {
  const content = read('hooks/hooks.json');
  assert.ok(
    content.includes('router-nudge'),
    "hooks.json must register the 'router-nudge' hook"
  );
});

test("hooks.json contains 'routing-gate'", () => {
  const content = read('hooks/hooks.json');
  assert.ok(
    content.includes('routing-gate'),
    "hooks.json must register the 'routing-gate' hook"
  );
});
