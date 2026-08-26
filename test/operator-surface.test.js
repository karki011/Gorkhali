// Author: Subash Karki
// Pins operator-surface honesty: start does not wrap on verify PASS, leftover
// P0/P1 and 5/5 claims stay gone, wrap.json is not a post-merge artifact.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('start Auto-chaining does not wrap on verify PASS', () => {
  const start = read('commands/start.md');
  const begin = start.indexOf('## Auto-chaining (default flow)');
  assert.notEqual(begin, -1, 'commands/start.md must have ## Auto-chaining (default flow)');
  const rest = start.slice(begin);
  const next = rest.indexOf('\n## ', 3);
  const auto = next === -1 ? rest : rest.slice(0, next);
  assert.doesNotMatch(
    auto,
    /verify PASS continues to[\s\S]*Skill\(skill="gorkhali:wrap"\)/,
    'verify PASS must not invoke wrap',
  );
  assert.match(auto, /Verify PASS does \*\*not\*\* wrap/);
  assert.match(auto, /ship-pr|\/gorkhali:wrap/);
});

test('README.md does not claim P0/P1 auto-fixed', () => {
  assert.doesNotMatch(read('README.md'), /P0\/P1 auto-fixed/);
});

test('commands.md does not claim P0 auto-fix or perfect Greptile', () => {
  const commands = read('project-docs/commands.md');
  assert.doesNotMatch(commands, /auto-fix for P0/);
  assert.doesNotMatch(commands, /perfect Greptile/);
});

test('wrap.md intro does not say wrap is post-merge', () => {
  const wrap = read('reference/schemas/wrap.md');
  const marker = wrap.indexOf('BEGIN GENERATED');
  assert.notEqual(marker, -1, 'wrap.md must have BEGIN GENERATED');
  const intro = wrap.slice(0, marker);
  assert.doesNotMatch(intro, /post-merge/i);
});

test('greploop-gate.js does not promise a 5/5 score', () => {
  assert.doesNotMatch(read('hooks/greploop-gate.js'), /drive it to 5\/5/);
});
