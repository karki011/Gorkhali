// Author: Subash Karki
// ladder.test.js - locks the "Climb Before You Write" YAGNI ladder
// in agents/engineer.md against accidental drift: the seven rungs in order,
// every never-cut item, the five rules, the ponytail attribution with its
// MIT credit, the ladderRung/neverCutTouched record fields, and the
// self-review sentence naming the rung. Replaces the deleted
// test/engineer-minimal-code-ladder.test.js; this is the only test allowed
// to assert a prose phrase.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ENGINEER_MD = path.join(__dirname, '..', 'agents', 'engineer.md');
const text = fs.readFileSync(ENGINEER_MD, 'utf-8');

/** Assert every phrase is present, then that their positions strictly increase. */
function assertInOrder(phrases) {
  const positions = phrases.map((phrase) => {
    const at = text.indexOf(phrase);
    assert.ok(at !== -1, `expected to find "${phrase}"`);
    return at;
  });
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1], `"${phrases[i]}" should appear after "${phrases[i - 1]}"`);
  }
}

test('has the Climb Before You Write heading', () => {
  assert.ok(text.includes('## Climb Before You Write'));
});

test('the seven ladder rungs appear in order', () => {
  assertInOrder([
    '## Climb Before You Write',
    'build at all? skip, say why',
    'codebase has it? reuse',
    'stdlib',
    'native platform',
    'installed dependency',
    'one line',
    'minimum code that works',
  ]);
});

test('every never-cut item is present', () => {
  for (const item of [
    'trust-boundary input validation',
    'error handling that prevents data loss',
    'security',
    'accessibility',
    'anything explicitly requested',
    'one runnable check per non-trivial fix',
  ]) {
    assert.ok(text.includes(item), `expected never-cut item "${item}"`);
  }
});

test('the five rules are present', () => {
  for (const rule of [
    'no unrequested abstractions',
    'no avoidable new dependency',
    'no unrequested boilerplate',
    'prefer deletion',
    'shortest diff wins only after location is confirmed',
  ]) {
    assert.ok(text.includes(rule), `expected rule "${rule}"`);
  }
});

test('the deliberate-tradeoff comment guidance is present', () => {
  assert.ok(text.includes('mark a deliberate tradeoff'));
  assert.ok(text.includes('naming its ceiling and upgrade path'));
});

test('the ponytail attribution credits Dietrich Gebert under MIT', () => {
  assert.ok(text.includes('ponytail'));
  assert.ok(text.includes('https://github.com/DietrichGebert/ponytail'));
  assert.ok(text.includes('Dietrich Gebert, MIT'));
});

test('the completion record carries ladderRung and neverCutTouched', () => {
  assert.ok(text.includes('`ladderRung`'));
  assert.ok(text.includes('`neverCutTouched`'));
});

test('the self-review sentence names the rung', () => {
  assert.ok(text.includes('Name the ladder rung stopped at and why'));
});
