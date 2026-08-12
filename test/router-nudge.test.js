// Author: Subash Karki
// router-nudge.test.js — proves the routing nudge's ADVISORY polarity: it only
// ever adds additionalContext (never a permissionDecision), is one-shot per
// session, skips interrogative prompts (precision over recall), and goes
// silent only when PHANTOM_ROUTING_NUDGE=0.
//
// Spawns the REAL hook process (seam-integration pattern). Env is read at
// INVOCATION time, so every spawn pins PHANTOM_DATA to a tmpdir and sets
// PHANTOM_ROUTING_NUDGE only when the case under test silences the nudge.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'router-nudge.js');

function runHook(envOverrides, stdinText) {
  const env = { ...process.env, ...envOverrides };
  // Outer shell state must not leak the silence toggle into default cases.
  if (!envOverrides.PHANTOM_ROUTING_NUDGE) delete env.PHANTOM_ROUTING_NUDGE;
  try {
    const stdout = execFileSync('node', [HOOK], {
      input: stdinText,
      env,
      encoding: 'utf-8',
    });
    return { code: 0, stdout };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: (e.stdout || '').toString(),
    };
  }
}

function setup(envExtra = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-data-'));
  return {
    data,
    env: { PHANTOM_DATA: data, ...envExtra },
    cleanup: () => fs.rmSync(data, { recursive: true, force: true }),
  };
}

let seq = 0;
function payload(prompt, sessionId) {
  return JSON.stringify({
    prompt,
    session_id: sessionId || `sess-${process.pid}-${seq++}`,
    cwd: os.tmpdir(),
  });
}

function assertSilent(res, msg) {
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), '', msg || 'no nudge expected');
}

function assertNudged(res, msg) {
  assert.equal(res.code, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit', msg);
  assert.match(out.hookSpecificOutput.additionalContext, /ROUTING:/);
  assert.match(out.hookSpecificOutput.additionalContext, /phantom:start/);
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined,
    'the nudge is advisory — it must never carry a permissionDecision');
}

test('1. ticket-key prompt, no session → nudge emitted', () => {
  const { env, cleanup } = setup();
  try {
    const res = runHook(env, payload('pick up PROJ-123 and ship the retry logic'));
    assertNudged(res);
  } finally {
    cleanup();
  }
});

test('2. one-shot: same session_id second spawn → silent', () => {
  const { env, cleanup } = setup();
  try {
    const first = runHook(env, payload('fix the login bug', 'sess-oneshot'));
    assertNudged(first, 'first prompt this session nudges');
    const second = runHook(env, payload('also implement the logout flow', 'sess-oneshot'));
    assertSilent(second, 'same session must not be nudged twice');
  } finally {
    cleanup();
  }
});

test('3. interrogative opener wins over ticket key → silent (precision)', () => {
  const { env, cleanup } = setup();
  try {
    const res = runHook(env, payload('why does this error happen in PROJ-123?'));
    assertSilent(res, 'diagnostic questions are not implementation triggers');
  } finally {
    cleanup();
  }
});

test('4. imperative implementation verb → emitted', () => {
  const { env, cleanup } = setup();
  try {
    const res = runHook(env, payload('fix the login bug'));
    assertNudged(res);
  } finally {
    cleanup();
  }
});

test('5. fresh legacy .apex-active does not suppress a host-session nudge', () => {
  const { data, env, cleanup } = setup();
  try {
    fs.writeFileSync(path.join(data, '.apex-active'), '');
    const res = runHook(env, payload('fix the login bug'));
    assertNudged(res, 'legacy global state cannot prove this host session routed');
  } finally {
    cleanup();
  }
});

test('6. different host session_ids each receive one nudge', () => {
  const { env, cleanup } = setup();
  try {
    assertNudged(runHook(env, payload('fix the login bug', 'session-a')));
    assertNudged(runHook(env, payload('fix the login bug', 'session-b')));
  } finally {
    cleanup();
  }
});

test('7. PHANTOM_ROUTING_NUDGE=0 → silent', () => {
  const { env, cleanup } = setup({ PHANTOM_ROUTING_NUDGE: '0' });
  try {
    const res = runHook(env, payload('fix the login bug'));
    assertSilent(res);
  } finally {
    cleanup();
  }
});

test('8. garbage stdin → exit 0 silent', () => {
  const { env, cleanup } = setup();
  try {
    const res = runHook(env, '{{{not json');
    assertSilent(res);
  } finally {
    cleanup();
  }
});
