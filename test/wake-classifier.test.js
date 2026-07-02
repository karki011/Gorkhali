// Author: Subash Karki
// wake-classifier.test.js — SubagentStop wake classifier tests.
// Pure classify() verdicts + end-to-end hook runs (child process, fail-open, exit 0).
// Zero external deps: node:test + node:assert + node:fs + node:os + node:path + node:child_process.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK_PATH = require.resolve('../hooks/wake-classifier');
const { classify, SELF_REVIEW_THRESHOLD } = require(HOOK_PATH);
const { drain } = require('../scripts/lib/wake-queue');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wc-test-'));
}

// Run the hook as a child process. Returns { code } — the hook must always exit 0.
function runHook({ dir, record, stdin } = {}) {
  const env = { ...process.env };
  delete env.PHANTOM_EXECUTION_RECORD;
  delete env.PHANTOM_EXECUTION_FILE;
  if (dir) env.PHANTOM_WAKE_SESSION_DIR = dir;
  if (record !== undefined) env.PHANTOM_EXECUTION_RECORD = typeof record === 'string' ? record : JSON.stringify(record);

  let code = 0;
  try {
    execFileSync(process.execPath, [HOOK_PATH], { input: stdin ?? '', env, encoding: 'utf8' });
  } catch (err) {
    code = typeof err.status === 'number' ? err.status : 1;
  }
  return { code };
}

const doneMidWave = {
  status: 'done',
  blocker: null,
  selfReviewScore: 9,
  wave: { isLastInWave: false },
};

// ── pure classify(): each ACTIONABLE trigger ────────────────────────────────

const actionableCases = [
  ['status failed', { ...doneMidWave, status: 'failed' }, 'failed'],
  ['non-null blocker', { ...doneMidWave, blocker: 'waiting on API' }, 'blocker'],
  ['low self-review', { ...doneMidWave, selfReviewScore: SELF_REVIEW_THRESHOLD - 1 }, 'low-self-review'],
  ['drift flag', { ...doneMidWave, drift: true }, 'drift'],
  ['last agent in wave', { ...doneMidWave, wave: { isLastInWave: true } }, 'last-in-wave'],
  ['wave underivable', { status: 'done', blocker: null, selfReviewScore: 9 }, 'wave-underivable'],
  ['missing record', null, 'missing-record'],
];

for (const [name, record, reason] of actionableCases) {
  test(`classify: ${name} → actionable (${reason})`, () => {
    const result = classify(record, SELF_REVIEW_THRESHOLD);
    assert.equal(result.verdict, 'actionable');
    assert.equal(result.reason, reason);
  });
}

// ── pure classify(): the benign path ────────────────────────────────────────

test('classify: passed + mid-wave → benign', () => {
  const result = classify(doneMidWave, SELF_REVIEW_THRESHOLD);
  assert.equal(result.verdict, 'benign');
  assert.equal(result.reason, 'passed-mid-wave');
});

test('classify: a missing self-review score does not by itself trigger low-self-review', () => {
  const record = { status: 'done', blocker: null, wave: { isLastInWave: false } };
  const result = classify(record, SELF_REVIEW_THRESHOLD);
  assert.equal(result.verdict, 'benign', 'no numeric score → score rule does not fire');
});

// ── end-to-end: actionable record lands in the queue ────────────────────────

test('hook: actionable record is appended to the wake queue, exit 0', () => {
  const dir = tmpDir();
  const { code } = runHook({
    dir,
    record: { ...doneMidWave, status: 'failed', agent: 'blade' },
    stdin: '{"session_id":"s1","tool_use_id":"t1"}',
  });
  assert.equal(code, 0);

  const { records } = drain(dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'signal');
  assert.equal(records[0].key, 't1');
  assert.equal(records[0].payload.reason, 'failed');
});

// ── end-to-end: benign record is triaged, not queued ────────────────────────

test('hook: benign record is triaged (absorbed), not queued, exit 0', () => {
  const dir = tmpDir();
  const { code } = runHook({
    dir,
    record: doneMidWave,
    stdin: '{"session_id":"s2","tool_use_id":"t2"}',
  });
  assert.equal(code, 0);

  const { records, liveness } = drain(dir);
  assert.equal(records.length, 0, 'benign wake is not queued');
  assert.equal(liveness.absorbedSinceLastDrain, 1, 'benign wake is triaged as absorbed');
});

// ── end-to-end: fail-open on a garbage record ───────────────────────────────

test('hook: garbage execution record fails open — exit 0 and a wake still lands', () => {
  const dir = tmpDir();
  const { code } = runHook({
    dir,
    record: '{ this is not valid json ]]]',
    stdin: '{"session_id":"s3","tool_use_id":"t3"}',
  });
  assert.equal(code, 0);

  const { records } = drain(dir);
  assert.equal(records.length, 1, 'unparseable record surfaces rather than being lost');
  assert.equal(records[0].payload.reason, 'missing-record');
});

// ── end-to-end: empty payload / missing session context → clean no-op ───────

test('hook: empty payload is a clean no-op — exit 0 and nothing written', () => {
  const dir = tmpDir();
  const { code } = runHook({ dir, stdin: '' });
  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(dir, '.wake-queue')), false, 'no queue file created');
  assert.equal(fs.existsSync(path.join(dir, '.triage-log')), false, 'no triage file created');
});

// ── HONEST e2e: production-shaped payload + pointer file + on-disk stub ──────
// No PHANTOM_EXECUTION_RECORD injection. The record is resolved the way it is in
// production: the pointer file (FIX 1) locates the session dir, and the agent's
// record is read from an on-disk agent-records stub (FIX 2) keyed by tool_use_id
// — the identity timing-capture.js actually reads off a SubagentStop payload.

// The pointer is scoped per-repo (Fix B). Pin the repo with PHANTOM_REPO so the
// pointer filename is deterministic and independent of the checkout's git remote.
const TEST_REPO = 'testrepo';

// Drive the real hook with only PHANTOM_DATA + PHANTOM_REPO set (pointer-based
// resolution). PHANTOM_REPO makes detectRepo return TEST_REPO, so the hook reads
// the same per-repo pointer seedSession writes.
function runHookProd({ data, stdin }) {
  const env = { ...process.env, PHANTOM_DATA: data, PHANTOM_REPO: TEST_REPO };
  delete env.PHANTOM_EXECUTION_RECORD;
  delete env.PHANTOM_EXECUTION_FILE;
  delete env.PHANTOM_WAKE_SESSION_DIR;
  let code = 0;
  try {
    execFileSync(process.execPath, [HOOK_PATH], { input: stdin ?? '', env, encoding: 'utf8' });
  } catch (err) {
    code = typeof err.status === 'number' ? err.status : 1;
  }
  return { code };
}

// Lay out a PHANTOM_DATA root: state/ (with the per-repo pointer) + a session dir
// the pointer names.
function seedSession(data) {
  const stateDir = path.join(data, 'state');
  const sessionDir = path.join(data, 'session');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'agent-records'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, `.active-wake-session.${TEST_REPO}`), sessionDir);
  return { stateDir, sessionDir };
}

test('hook (production shape): benign resolves from an on-disk agent-records stub via the pointer file, exit 0', () => {
  const data = tmpDir();
  const { sessionDir } = seedSession(data);
  // Apex-written stub, keyed by the tool_use_id the SubagentStop payload carries.
  fs.writeFileSync(
    path.join(sessionDir, 'agent-records', 't-benign.json'),
    JSON.stringify({ status: 'done', blocker: null, selfReviewScore: 9, wave: { index: 0, isLastInWave: false } })
  );

  const { code } = runHookProd({ data, stdin: '{"session_id":"s-benign","tool_use_id":"t-benign"}' });
  assert.equal(code, 0);

  const { records, liveness } = drain(sessionDir);
  assert.equal(records.length, 0, 'passed + mid-wave stub → benign, nothing queued');
  assert.equal(liveness.absorbedSinceLastDrain, 1, 'benign wake triaged as absorbed');
});

test('hook (production shape): no stub on disk fails open to actionable missing-record, exit 0', () => {
  const data = tmpDir();
  const { sessionDir } = seedSession(data); // agent-records dir exists but is empty

  const { code } = runHookProd({ data, stdin: '{"session_id":"s-missing","tool_use_id":"t-missing"}' });
  assert.equal(code, 0);

  const { records } = drain(sessionDir);
  assert.equal(records.length, 1, 'no resolvable record → surfaces rather than absorbs');
  assert.equal(records[0].key, 't-missing');
  assert.equal(records[0].payload.reason, 'missing-record');
});

// ── Fix C: no consumer (no pointer, no env) → skip, don't grow the state dir ──

test('hook (Fix C): no live pointer for this repo and no env override → exit 0 and nothing is appended', () => {
  const data = tmpDir();
  const stateDir = path.join(data, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  // No .active-wake-session.<repo> pointer written → resolveWakeSource falls
  // through to the global state dir (source 'state'). With no env override, the
  // classifier must NOT append — otherwise the global state dir grows unbounded
  // with wakes no Apex is draining.
  const env = { ...process.env, PHANTOM_DATA: data, PHANTOM_REPO: TEST_REPO };
  delete env.PHANTOM_EXECUTION_RECORD;
  delete env.PHANTOM_EXECUTION_FILE;
  delete env.PHANTOM_WAKE_SESSION_DIR;

  let code = 0;
  try {
    execFileSync(process.execPath, [HOOK_PATH], {
      input: '{"session_id":"s-nogate","tool_use_id":"t-nogate"}',
      env,
      encoding: 'utf8',
    });
  } catch (err) {
    code = typeof err.status === 'number' ? err.status : 1;
  }
  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(stateDir, '.wake-queue')), false, 'no consumer → no wake queued in the state dir');
  assert.equal(fs.existsSync(path.join(stateDir, '.triage-log')), false, 'no consumer → nothing triaged either');
});

// ── fail-open on a post-validation crash (FIX 5) ────────────────────────────

test('hook: a post-validation crash exits 0 and lands a classifier-error wake in the state-dir fallback', () => {
  const data = tmpDir();
  // Poison the wake dir: a FILE sits where the session dir's parent must be a
  // dir, so append's mkdirSync throws AFTER payload validation. The catch block
  // then falls back to the (clean) global state dir so the crash still surfaces.
  const blocker = path.join(data, 'blocker');
  fs.writeFileSync(blocker, 'not a directory');
  const poisoned = path.join(blocker, 'session');

  const env = { ...process.env, PHANTOM_DATA: data, PHANTOM_WAKE_SESSION_DIR: poisoned };
  delete env.PHANTOM_EXECUTION_RECORD;
  delete env.PHANTOM_EXECUTION_FILE;

  let code = 0;
  try {
    execFileSync(process.execPath, [HOOK_PATH], {
      input: '{"session_id":"s-crash","tool_use_id":"t-crash"}',
      env,
      encoding: 'utf8',
    });
  } catch (err) {
    code = typeof err.status === 'number' ? err.status : 1;
  }
  assert.equal(code, 0, 'a classifier crash must still exit 0');

  const { records } = drain(path.join(data, 'state'));
  assert.equal(records.length, 1, 'the crash still surfaces a wake in the fallback state dir');
  assert.equal(records[0].payload.reason, 'classifier-error');
});
