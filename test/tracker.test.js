// Author: Subash Karki
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTracker } = require('../lib/tracker');

test('defaults to none when nothing is configured', () => {
  const r = resolveTracker({});
  assert.equal(r.provider, 'none');
  assert.deepEqual(r.ops, { fetch: null, start: null, done: null, comment: null });
});

test('none provider is fully inert', () => {
  const r = resolveTracker({ provider: 'none' });
  assert.equal(r.provider, 'none');
  assert.equal(r.ops.fetch, null);
  assert.equal(r.ops.start, null);
  assert.equal(r.ops.done, null);
  assert.equal(r.ops.comment, null);
});

test('github provider returns gh command strings for every op', () => {
  const r = resolveTracker({ provider: 'github' });
  assert.equal(r.provider, 'github');
  const keys = Object.keys(r.ops).sort();
  assert.deepEqual(keys, ['comment', 'done', 'fetch', 'start']);
  for (const key of keys) {
    assert.equal(r.ops[key].kind, 'gh');
    assert.equal(typeof r.ops[key].command, 'string');
    assert.ok(r.ops[key].command.startsWith('gh '));
  }
});

test('jira provider returns MCP tool descriptors, never a runnable command', () => {
  const r = resolveTracker({ provider: 'jira' });
  assert.equal(r.provider, 'jira');
  const keys = Object.keys(r.ops).sort();
  assert.deepEqual(keys, ['comment', 'done', 'fetch', 'start']);
  for (const key of keys) {
    assert.equal(r.ops[key].kind, 'mcp');
    assert.equal(typeof r.ops[key].tool, 'string');
    assert.ok(r.ops[key].tool.startsWith('mcp__atlassian__'));
    assert.equal(r.ops[key].command, undefined);
  }
});

test('an unknown provider falls back to none rather than throwing', () => {
  const r = resolveTracker({ provider: 'linear' });
  assert.equal(r.provider, 'none');
});

test('explicit override wins over preferences text', () => {
  const r = resolveTracker({ provider: 'github', preferencesText: 'tracker: jira\n' });
  assert.equal(r.provider, 'github');
});

test('provider is read from a `tracker:` line in preferences text', () => {
  const r = resolveTracker({ preferencesText: 'some notes\ntracker: github\nmore notes\n' });
  assert.equal(r.provider, 'github');
});
