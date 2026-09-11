// Author: Subash Karki
// engineer-minimal-code-ladder.test.js - guards the ponytail-derived
// minimalism discipline folded into agents/engineer.md: the seven-rung
// ladder, the never-cut safety list, the attribution, and the completion-
// record fields that make the ladder something Engineers actually report
// against rather than a decorative list.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENGINEER = path.join(__dirname, '..', 'agents', 'engineer.md');
const source = fs.readFileSync(ENGINEER, 'utf8');

const RUNGS = [
  'build at all',
  'codebase has it',
  'stdlib',
  'native platform',
  'installed dependency',
  'one line',
  'minimum code',
];

const NEVER_CUT = [
  'trust-boundary input validation',
  'error handling that prevents data loss',
  'security',
  'accessibility',
  'anything explicitly requested',
  'one runnable check per non-trivial fix',
];

test('the seven YAGNI-ladder rungs appear in agents/engineer.md, in order', () => {
  let cursor = -1;
  for (const rung of RUNGS) {
    const idx = source.indexOf(rung);
    assert.ok(idx !== -1, `rung "${rung}" missing from agents/engineer.md`);
    assert.ok(idx > cursor, `rung "${rung}" is out of order in agents/engineer.md`);
    cursor = idx;
  }
});

test('every never-cut item is present', () => {
  for (const item of NEVER_CUT) {
    assert.ok(source.includes(item), `never-cut item "${item}" missing from agents/engineer.md`);
  }
});

test('the minimalism rules are present', () => {
  for (const rule of ['unrequested abstractions', 'avoidable new dependency', 'prefer deletion', 'shortest diff wins only after location is confirmed', 'ceiling and upgrade path']) {
    assert.ok(source.includes(rule), `rule "${rule}" missing from agents/engineer.md`);
  }
});

test('attribution names ponytail and MIT', () => {
  assert.match(source, /ponytail/i);
  assert.match(source, /DietrichGebert\/ponytail/);
  assert.match(source, /\bMIT\b/);
});

test('the completion record documents ladderRung and neverCutTouched', () => {
  assert.match(source, /`ladderRung`/);
  assert.match(source, /`neverCutTouched`/);
});

test('the self-review section references the ladder', () => {
  const section = source.slice(source.indexOf('## Self-Review'), source.indexOf('### Generated-code style contract'));
  assert.match(section, /ladder/i);
  assert.match(section, /never-cut/i);
});
