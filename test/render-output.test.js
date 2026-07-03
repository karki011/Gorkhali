// Author: Subash Karki
// render-output.test.js - count phrasing, help numbering, the already:true
// idempotent marker, and render()'s stable-order / print-nothing-until-called
// discipline. Conventions match test/log-capture.test.js: node:test +
// node:assert/strict, execFileSync for the CLI harness, no mocks.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');

const MODULE_PATH = require.resolve('../scripts/lib/render-output');
const { formatCount, renderHelp, withAlready, render } = require(MODULE_PATH);

// ── formatCount ──────────────────────────────────────────────────────────────

test('formatCount: returns simple count when no truncation', () => {
  assert.equal(formatCount({ count: 5 }), 'count: 5');
});

test('formatCount: returns count with total when totalCount is provided', () => {
  assert.equal(formatCount({ count: 30, totalCount: 150 }), 'count: 30 of 150 total');
});

test('formatCount: returns showing first N when truncated (count equals limit)', () => {
  assert.equal(formatCount({ count: 30, limit: 30 }), 'count: 30 (showing first 30)');
});

test('formatCount: returns count with total even when truncated if totalCount is known', () => {
  assert.equal(formatCount({ count: 30, limit: 30, totalCount: 200 }), 'count: 30 of 200 total');
});

test('formatCount: returns simple count when count is less than limit', () => {
  assert.equal(formatCount({ count: 5, limit: 30 }), 'count: 5');
});

test('formatCount: returns count with API limit note for search', () => {
  assert.equal(formatCount({ count: 1000, apiLimitHit: true }), 'count: 1000+ (GitHub search API limit reached)');
});

test('formatCount: returns showing first N when displayLimit truncates results', () => {
  assert.equal(formatCount({ count: 50, displayLimit: 30 }), 'count: 50 (showing first 30)');
});

test('formatCount: returns simple count when displayLimit is not exceeded', () => {
  assert.equal(formatCount({ count: 20, displayLimit: 30 }), 'count: 20');
});

test('formatCount: handles zero count', () => {
  assert.equal(formatCount({ count: 0 }), 'count: 0');
});

test('formatCount: handles zero count with limit', () => {
  assert.equal(formatCount({ count: 0, limit: 30 }), 'count: 0');
});

// ── renderHelp ───────────────────────────────────────────────────────────────

test('renderHelp: numbers and indents each hint line', () => {
  assert.equal(renderHelp(['Do this', 'Do that']), 'help[2]:\n  Do this\n  Do that');
});

test('renderHelp: a single hint still gets the [N] count', () => {
  assert.equal(renderHelp(['Try listing']), 'help[1]:\n  Try listing');
});

test('renderHelp: returns empty string for no lines', () => {
  assert.equal(renderHelp([]), '');
});

// ── withAlready ──────────────────────────────────────────────────────────────

test('withAlready: appends already:true after the given fields, in order', () => {
  const result = withAlready({ number: 42, state: 'closed' });
  assert.deepEqual(Object.keys(result), ['number', 'state', 'already']);
  assert.equal(result.already, true);
});

test('withAlready: composes with render() into the pr.ts idempotent-close shape', () => {
  const out = render(withAlready({ number: 42, state: 'closed' }));
  assert.equal(out, 'number: 42\nstate: closed\nalready: true');
});

// ── render ───────────────────────────────────────────────────────────────────

test('render: stable key order - lines follow the object\'s own key order, not sorted', () => {
  const out = render({ zeta: 'z', alpha: 'a', count: { count: 1 } });
  assert.equal(out, 'zeta: z\nalpha: a\ncount: 1');
});

test('render: formats a `count` key via formatCount', () => {
  const out = render({ count: { count: 30, totalCount: 150 } });
  assert.equal(out, 'count: 30 of 150 total');
});

test('render: formats a `help` key via renderHelp', () => {
  const out = render({ ok: true, help: ['Do this', 'Do that'] });
  assert.equal(out, 'ok: true\nhelp[2]:\n  Do this\n  Do that');
});

test('render: omits the help block entirely when help is an empty array', () => {
  assert.equal(render({ number: 1, help: [] }), 'number: 1');
});

test('render: joins array values for ordinary keys, "none" when empty', () => {
  assert.equal(render({ labels: ['bug', 'help wanted'] }), 'labels: bug,help wanted');
  assert.equal(render({ labels: [] }), 'labels: none');
});

test('render: null/undefined values render as the literal "null"', () => {
  assert.equal(render({ author: null }), 'author: null');
  assert.equal(render({ author: undefined }), 'author: null');
});

test('render: building blocks never print - only the caller writing render()\'s return value does', () => {
  const calls = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    calls.push(chunk);
    return true;
  };
  try {
    formatCount({ count: 3 });
    renderHelp(['a']);
    withAlready({ number: 1 });
    render({ number: 1, already: true });
  } finally {
    process.stdout.write = original;
  }
  assert.deepEqual(calls, [], 'no function under test writes to stdout on its own');
});

test('module scope prints nothing merely on require', () => {
  const out = execFileSync(process.execPath, ['-e', `require(${JSON.stringify(MODULE_PATH)})`], { encoding: 'utf8' });
  assert.equal(out, '');
});

// ── CLI harness ──────────────────────────────────────────────────────────────

function runCli(extraArgs = []) {
  return execFileSync(process.execPath, [MODULE_PATH, ...extraArgs], { encoding: 'utf8' });
}

test('CLI: --help prints a single render() block demoing count/already/help', () => {
  const out = runCli(['--help']);
  const lines = out.trimEnd().split('\n');
  assert.equal(lines[0], 'number: 42');
  assert.equal(lines[1], 'state: closed');
  assert.equal(lines[2], 'already: true');
  assert.equal(lines[3], 'count: 3 of 12 total');
  assert.equal(lines[4], 'help[2]:');
});

test('CLI: emits exactly one trailing newline, matching a single render-once write', () => {
  const out = runCli(['--help']);
  assert.ok(out.endsWith('\n'));
  assert.ok(!out.endsWith('\n\n'));
});
