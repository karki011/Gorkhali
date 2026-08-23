// Author: Subash Karki
// memory-reader.test.js — proves the per-session injection dedup: a first prompt
// injects available learnings, a second prompt in the SAME session does not
// re-inject those same entries, a different session_id injects fresh, malformed
// stdin exits 0 silently, and a payload with NO session_id skips dedup entirely
// (repeat runs keep injecting, and no shared 'unknown' marker file is written).
//
// Spawns the REAL hook process (subprocess seam pattern from
// test/router-nudge.test.js:21-72). Each spawn pins GORKHALI_DATA to a tmpdir and
// GORKHALI_REPO to a fixed id so learningsDir() resolves to fixture content we
// control, independent of this repo's own learnings.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'memory-reader.js');
const REPO = 'memory-reader-test-repo';

function runHook(env, stdinText) {
  try {
    const stdout = execFileSync('node', [HOOK], { input: stdinText, env, encoding: 'utf-8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : -1, stdout: (e.stdout || '').toString() };
  }
}

function setup() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-data-'));
  const learnings = path.join(data, 'repos', REPO, 'learnings');
  fs.mkdirSync(learnings, { recursive: true });
  fs.writeFileSync(path.join(learnings, 'INDEX.md'), '# Learnings Index\n');
  fs.writeFileSync(
    path.join(learnings, 'general.md'),
    'LEARNING [alpha]: Entry Alpha describes a stable pattern worth remembering for tests (2026-01-01)\n' +
    'LEARNING [beta]: Entry Beta describes a second stable pattern worth remembering for tests (2026-01-01)\n'
  );
  return {
    env: { ...process.env, GORKHALI_DATA: data, GORKHALI_REPO: REPO },
    cleanup: () => fs.rmSync(data, { recursive: true, force: true }),
  };
}

function payload(sessionId) {
  return JSON.stringify({ prompt: 'please summarize the quarterly numbers for finance review', session_id: sessionId });
}

function payloadNoSessionId() {
  return JSON.stringify({ prompt: 'please summarize the quarterly numbers for finance review' });
}

test('1. first prompt injects available learnings', () => {
  const { env, cleanup } = setup();
  try {
    const res = runHook(env, payload('session-1'));
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Entry Alpha/);
    assert.match(res.stdout, /Entry Beta/);
  } finally {
    cleanup();
  }
});

test('2. second prompt, same session_id → same entries not re-injected', () => {
  const { env, cleanup } = setup();
  try {
    const first = runHook(env, payload('session-2'));
    assert.match(first.stdout, /Entry Alpha/);
    const second = runHook(env, payload('session-2'));
    assert.equal(second.code, 0);
    assert.equal(second.stdout.trim(), '', 'no new entries remain to inject this session');
  } finally {
    cleanup();
  }
});

test('3. different session_id injects fresh, independent of session-2 markers', () => {
  const { env, cleanup } = setup();
  try {
    runHook(env, payload('session-3a'));
    const other = runHook(env, payload('session-3b'));
    assert.equal(other.code, 0);
    assert.match(other.stdout, /Entry Alpha/);
    assert.match(other.stdout, /Entry Beta/);
  } finally {
    cleanup();
  }
});

test('4. malformed stdin → exit 0 silently', () => {
  const { env, cleanup } = setup();
  try {
    const res = runHook(env, '{{{not json');
    assert.equal(res.code, 0);
    assert.equal(res.stdout.trim(), '');
  } finally {
    cleanup();
  }
});

test('5. no session_id → dedup skipped entirely, no shared "unknown" marker', () => {
  const { env, cleanup } = setup();
  try {
    const first = runHook(env, payloadNoSessionId());
    assert.equal(first.code, 0);
    assert.match(first.stdout, /Entry Alpha/);
    assert.match(first.stdout, /Entry Beta/);

    const second = runHook(env, payloadNoSessionId());
    assert.equal(second.code, 0);
    assert.match(second.stdout, /Entry Alpha/, 'no session_id means no dedup — every run injects');
    assert.match(second.stdout, /Entry Beta/);

    const markerDir = path.join(env.GORKHALI_DATA, 'state', 'memory-injected');
    if (fs.existsSync(markerDir)) {
      assert.equal(
        fs.readdirSync(markerDir).includes('unknown'),
        false,
        'no shared "unknown" marker file should be written for id-less sessions'
      );
    }
  } finally {
    cleanup();
  }
});
