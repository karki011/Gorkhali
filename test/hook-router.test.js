// Author: Subash Karki
// hook-router.test.js — pins the per-hook timeout contract: loadConfig defaults a
// numeric `timeout` (seconds, parity with hooks.json), and a timed-out child
// (spawnSync status === null) is a FAILURE, never a silent success.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadConfig, executeHook } = require('../hooks/hook-router');

const ARGS = { event: 'PreToolUse', tool: 'Edit', phase: '', sessionId: 'test-session' };

function writeTmpScript(name, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-router-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, source);
  return { dir, file };
}

test('loadConfig defaults every hook to a numeric timeout (seconds)', () => {
  const hooks = loadConfig();
  assert.ok(hooks.length > 0, 'shipped hooks-config.json has hooks');
  for (const h of hooks) {
    assert.equal(typeof h.timeout, 'number', `${h.name} has a numeric timeout`);
    assert.ok(h.timeout > 0, `${h.name} timeout is positive`);
  }
});

test('timed-out hook (status === null) returns FAILURE, not 0', () => {
  // Sleeps far past the 1s per-hook timeout; spawnSync kills it → status null.
  const { dir, file } = writeTmpScript('sleeper.js', 'setTimeout(() => {}, 30000);\n');
  try {
    const code = executeHook({ name: 'sleeper', script: file, input: 'arg1-json', timeout: 1 }, ARGS);
    assert.notEqual(code, 0, 'timeout kill must not be reported as success');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('exit codes still pass through unchanged (success and failure parity)', () => {
  const ok = writeTmpScript('ok.js', 'process.exit(0);\n');
  const fail = writeTmpScript('fail.js', 'process.exit(3);\n');
  try {
    assert.equal(executeHook({ name: 'ok', script: ok.file, input: 'arg1-json', timeout: 5 }, ARGS), 0);
    assert.equal(executeHook({ name: 'fail', script: fail.file, input: 'arg1-json', timeout: 5 }, ARGS), 3);
  } finally {
    fs.rmSync(ok.dir, { recursive: true, force: true });
    fs.rmSync(fail.dir, { recursive: true, force: true });
  }
});

test('garbage per-hook timeout falls back to the default instead of crashing', () => {
  const ok = writeTmpScript('ok2.js', 'process.exit(0);\n');
  try {
    assert.equal(executeHook({ name: 'ok2', script: ok.file, input: 'arg1-json', timeout: 'banana' }, ARGS), 0);
  } finally {
    fs.rmSync(ok.dir, { recursive: true, force: true });
  }
});
