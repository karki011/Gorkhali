// Author: Subash Karki
// wrap-greploop-watch.test.js — pins wrap → greploop → CHIEF_PING watch
// contracts so they cannot silently regress. Zero external deps.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

test('wrap.md invokes greploop after PR creation and never auto-merges', () => {
  const content = read('commands/wrap.md');
  assert.ok(
    content.includes('Skill(skill="gorkhali:greploop")'),
    'wrap.md must invoke Skill(skill="gorkhali:greploop") after PR creation'
  );
  assert.ok(content.includes('Do not ask'), 'wrap.md must contain "Do not ask"');
  assert.match(content, /do not merge|never merge/i);
  assert.doesNotMatch(
    content,
    /do not start an automatic/,
    'wrap.md must not retain the retired automatic-start instruction'
  );
});

test('ship-ceremony.md arms all-author review and CHIEF_PING watch', () => {
  const content = read('reference/wrap/ship-ceremony.md');
  assert.ok(
    content.includes('All-author review + CHIEF_PING watch'),
    'ship-ceremony.md must keep the All-author review + CHIEF_PING watch heading'
  );
  assert.ok(content.includes('Skill(skill="gorkhali:greploop"'));
  assert.ok(content.includes('{new:false}'));
  assert.match(content, /never merge/i);
});

test('greploop skill describes all-author review and Phase 2 5/5 stop', () => {
  const content = read('skills/greploop/SKILL.md');
  assert.match(content, /all-author|ALL review comments/);
  assert.ok(content.includes('CHIEF_PING'));
  assert.match(content, /5\/5/);
});

test('reference/greploop.md pins all-author CHIEF_PING watch', () => {
  const content = read('reference/greploop.md');
  assert.match(content, /all-author/);
  assert.ok(content.includes('CHIEF_PING'));
  assert.match(content, /never merge/i);
  assert.ok(content.includes('pr-watch-tick.js'));
});

test('reference/pr-watch.md pins the tick script, illegal {new:false}, never merge', () => {
  const content = read('reference/pr-watch.md');
  assert.ok(content.includes('CHIEF_PING'));
  assert.ok(content.includes('{new:false}'));
  assert.match(content, /illegal/);
  assert.match(content, /never merge/i);
  assert.ok(content.includes('clerk-herald'));
  assert.ok(
    content.includes('scripts/lib/pr-watch-tick.js'),
    'pr-watch.md must require the production pr-watch-tick.js tick CLI'
  );
  assert.ok(content.includes('threads_clean'));
  assert.ok(content.includes('greptile_max'));
});

test('start.md PLAN gate is chat-only and offers implementation detail on request', () => {
  const content = read('commands/start.md');
  const idx = content.indexOf('HUMAN GATE');
  assert.notEqual(idx, -1, 'start.md must have a HUMAN GATE');
  const gate = content.slice(idx, idx + 3500);
  assert.ok(gate.includes('briefing.tackling'));
  assert.ok(gate.includes('briefing.problem'));
  assert.ok(gate.includes('briefing.how'));
  assert.ok(
    gate.includes('no page, no artifact'),
    'PLAN gate must be chat-only: no page, no artifact'
  );
  assert.ok(
    gate.includes('Say that implementation detail - files, tasks, waves, and dependency order - is available on request.'),
    'PLAN gate must offer implementation detail (files, tasks, waves, dependency order) on request'
  );
  assert.match(gate, /never tasks|Never degrade to a task-only gate/);
});

test('brainstorm.md converges chat-only with Pick A/B/C and a comparison of approaches', () => {
  const content = read('commands/brainstorm.md');
  assert.ok(content.includes('Pick A / B / C'));
  assert.ok(
    content.includes('Chat-only convergence'),
    'brainstorm.md convergence must be chat-only'
  );
  assert.ok(
    content.includes('no page, no artifact'),
    'brainstorm.md convergence must say no page, no artifact'
  );
  assert.match(
    content,
    /comparison of the distinct approaches/,
    'brainstorm.md must present a comparison of the distinct approaches in chat'
  );
  assert.ok(content.includes('How without supporting evidence is an assumption'));
  assert.ok(content.includes('briefing.tackling'));
  assert.ok(content.includes('briefing.scope'));
  assert.ok(content.includes('briefing.risks'));
});
