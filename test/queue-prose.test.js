// Author: Subash Karki
// queue-prose.test.js — pins cross-file invariants for Mission Control queue commands.
// Mirrors ceiling-prose.test.js style: read files, assert literals and patterns.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// commands/start.md
// ---------------------------------------------------------------------------

test('start.md: contains HUMAN GATE literal', () => {
  const content = read('commands/start.md');
  assert.ok(
    content.includes('**HUMAN GATE**: approve plan'),
    'commands/start.md must contain the literal \'**HUMAN GATE**: approve plan\''
  );
});

test('start.md: contains ## Mode: --to-plan section', () => {
  const content = read('commands/start.md');
  assert.ok(
    content.includes('## Mode: --to-plan'),
    'commands/start.md must contain a "## Mode: --to-plan" section header'
  );
});

test('start.md: --to-plan section contains never-ask-questions clause', () => {
  const content = read('commands/start.md');
  assert.ok(
    /[Nn][Ee][Vv][Ee][Rr] ask/i.test(content),
    'commands/start.md must contain a never-ask-questions clause (matches NEVER ask / Never ask)'
  );
});

test('start.md: --to-plan section prohibits execute/wrap in that mode', () => {
  const content = read('commands/start.md');
  // The prohibition block lists execute, verify, fix, wrap as banned in to-plan mode.
  // Presence of both "NOTHING EVER EXECUTES" pattern and "wrap" in the prohibition sentence.
  assert.ok(
    /NOTHING EVER EXECUTES/i.test(content) || /Prohibited in this mode.*wrap/i.test(content),
    'commands/start.md must contain prohibition language for execute/wrap in --to-plan mode'
  );
});

test('start.md: queue entry carries status: "queued"', () => {
  const content = read('commands/start.md');
  assert.ok(
    content.includes('status: "queued"') || content.includes("status:\"queued\""),
    'commands/start.md must reference status: "queued" in the queue entry spec'
  );
});

// ---------------------------------------------------------------------------
// commands/queue.md
// ---------------------------------------------------------------------------

test('queue.md: contains /loop /phantom:queue recurrence instruction', () => {
  const content = read('commands/queue.md');
  assert.ok(
    content.includes('/loop /phantom:queue'),
    'commands/queue.md must contain "/loop /phantom:queue" recurrence instruction'
  );
});

test('queue.md: contains QUEUE INACTIVE inactive-state message', () => {
  const content = read('commands/queue.md');
  assert.ok(
    content.includes('QUEUE INACTIVE'),
    'commands/queue.md must contain the "QUEUE INACTIVE" inactive-state message'
  );
});

test('queue.md: does NOT contain --arm flag', () => {
  const content = read('commands/queue.md');
  assert.ok(
    !content.includes('--arm'),
    'commands/queue.md must NOT contain the obsolete --arm flag'
  );
});

test('queue.md: contains no-ai label exclusion in poll filter', () => {
  const content = read('commands/queue.md');
  assert.ok(
    content.includes('no-ai'),
    'commands/queue.md must contain the "no-ai" label exclusion in the Jira poll filter'
  );
});

test('queue.md: contains planner_timeout_minutes config key', () => {
  const content = read('commands/queue.md');
  assert.ok(
    content.includes('planner_timeout_minutes'),
    'commands/queue.md must reference the planner_timeout_minutes config key'
  );
});

test('queue.md: mandates resolveConfigPath for config reads', () => {
  const content = read('commands/queue.md');
  assert.ok(
    content.includes('resolveConfigPath'),
    'commands/queue.md must mandate config-lite resolveConfigPath — never a bare config.yaml path'
  );
});

test('queue.md: contains planner_max_concurrent interactive planner cap', () => {
  const content = read('commands/queue.md');
  assert.ok(
    content.includes('planner_max_concurrent'),
    'commands/queue.md must reference the planner_max_concurrent config key — no hardcoded planner cap'
  );
});

test('queue.md: launch instructions lead with /phantom:loop', () => {
  const content = read('commands/queue.md');
  assert.ok(
    content.includes('/phantom:loop'),
    'commands/queue.md launch instructions must lead with the /phantom:loop entry'
  );
});

test('queue.md: visibility block covers agents view and /background', () => {
  const content = read('commands/queue.md');
  assert.ok(
    content.includes('agents view'),
    'commands/queue.md must point at Claude Code\'s agents view for watching planners'
  );
  assert.ok(
    content.includes('/background'),
    'commands/queue.md must mention sending the coordinator session to the background via /background'
  );
});

test('queue.md: fires display notification when plans are queued', () => {
  const content = read('commands/queue.md');
  assert.ok(
    content.includes('display notification'),
    'commands/queue.md must fire an osascript display notification when a pass queues new plans'
  );
});

// ---------------------------------------------------------------------------
// commands/approve.md
// ---------------------------------------------------------------------------

test('approve.md: references queue.max_concurrent (no bare hardcoded cap)', () => {
  const content = read('commands/approve.md');
  assert.ok(
    content.includes('max_concurrent'),
    'commands/approve.md must reference queue.max_concurrent — never a bare hardcoded number'
  );
});

test('approve.md: references running/ directory state', () => {
  const content = read('commands/approve.md');
  assert.ok(
    content.includes('running/'),
    'commands/approve.md must reference the running/ lifecycle directory'
  );
});

test('approve.md: pins model: "sonnet" for executor spawns', () => {
  const content = read('commands/approve.md');
  assert.ok(
    content.includes('sonnet'),
    'commands/approve.md must pin model: "sonnet" for executor spawns'
  );
});

test('approve.md: uses git status --porcelain for clean-check', () => {
  const content = read('commands/approve.md');
  assert.ok(
    content.includes('porcelain'),
    'commands/approve.md must use git status --porcelain for worktree cleanliness check'
  );
});

test('approve.md: mandates resolveConfigPath for config reads', () => {
  const content = read('commands/approve.md');
  assert.ok(
    content.includes('resolveConfigPath'),
    'commands/approve.md must mandate config-lite resolveConfigPath — never a bare config.yaml path'
  );
});

// ---------------------------------------------------------------------------
// commands/wrap.md
// ---------------------------------------------------------------------------

test('wrap.md: contains draft-PR rule sentence', () => {
  const content = read('commands/wrap.md');
  assert.ok(
    /[Dd]raft PR|DRAFT PR/.test(content),
    'commands/wrap.md must contain a draft-PR rule sentence (matches /[Dd]raft PR|DRAFT PR/)'
  );
});

test('wrap.md: contains worktree cleanup hint', () => {
  const content = read('commands/wrap.md');
  assert.ok(
    /worktree remove/.test(content),
    'commands/wrap.md must contain a worktree cleanup hint (matches /worktree remove/)'
  );
});

// ---------------------------------------------------------------------------
// config.yaml.example
// ---------------------------------------------------------------------------

test('config.yaml.example: queue section with enabled: false', () => {
  const content = read('config.yaml.example');
  assert.ok(
    content.includes('enabled: false'),
    'config.yaml.example must contain "enabled: false" in the queue section'
  );
  assert.ok(
    content.includes('queue:'),
    'config.yaml.example must contain a "queue:" section'
  );
});

test('config.yaml.example: queue section declares planner_max_concurrent', () => {
  const content = read('config.yaml.example');
  assert.ok(
    content.includes('planner_max_concurrent'),
    'config.yaml.example must declare planner_max_concurrent in the queue section'
  );
});

// ---------------------------------------------------------------------------
// scripts/lib/phantom-paths.js — require() and assert QUEUE_STATES export
// ---------------------------------------------------------------------------

test('phantom-paths.js: QUEUE_STATES exports exactly 4 states', () => {
  const phantomPaths = require('../scripts/lib/phantom-paths');
  assert.ok(
    phantomPaths.QUEUE_STATES !== undefined,
    'scripts/lib/phantom-paths.js must export QUEUE_STATES'
  );
  assert.equal(
    phantomPaths.QUEUE_STATES.length,
    4,
    `QUEUE_STATES must have exactly 4 states, got ${phantomPaths.QUEUE_STATES.length}: ${JSON.stringify([...phantomPaths.QUEUE_STATES])}`
  );
});

test('phantom-paths.js: QUEUE_STATES contains queued, approved, running, rejected', () => {
  const { QUEUE_STATES } = require('../scripts/lib/phantom-paths');
  const states = [...QUEUE_STATES];
  for (const expected of ['queued', 'approved', 'running', 'rejected']) {
    assert.ok(
      states.includes(expected),
      `QUEUE_STATES must include '${expected}' (got: ${JSON.stringify(states)})`
    );
  }
});
