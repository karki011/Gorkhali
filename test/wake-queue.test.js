// Author: Subash Karki
// wake-queue.test.js — durable wake queue tests.
// Zero external deps: node:test + node:assert + node:fs + node:os + node:path.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { append, drain, triage, resolveWakeSource } = require('../scripts/lib/wake-queue');
const CLI_PATH = require.resolve('../scripts/lib/wake-queue');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wq-test-'));
}

// ── append/drain round-trip ────────────────────────────────────────────────

test('append then drain returns the record with parsed payload', () => {
  const dir = tmpDir();
  append(dir, { kind: 'signal', key: 'agent-1', payload: { reason: 'failed', n: 3 } });

  const { records } = drain(dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'signal');
  assert.equal(records[0].key, 'agent-1');
  assert.deepEqual(records[0].payload, { reason: 'failed', n: 3 });
});

// ── dedupe on kind+key keeping latest, first-seen order ─────────────────────

test('drain dedupes on kind+key keeping the latest payload in first-seen order', () => {
  const dir = tmpDir();
  append(dir, { kind: 'signal', key: 'a', payload: { v: 1 } });
  append(dir, { kind: 'signal', key: 'b', payload: { v: 1 } });
  append(dir, { kind: 'signal', key: 'a', payload: { v: 2 } }); // supersedes first

  const { records } = drain(dir);
  assert.equal(records.length, 2);
  // first-seen order: a then b
  assert.equal(records[0].key, 'a');
  assert.deepEqual(records[0].payload, { v: 2 }, 'keeps latest payload for a');
  assert.equal(records[1].key, 'b');
});

test('same key but different kind are not deduped together', () => {
  const dir = tmpDir();
  append(dir, { kind: 'signal', key: 'x', payload: { v: 1 } });
  append(dir, { kind: 'stale', key: 'x', payload: { v: 2 } });

  const { records } = drain(dir);
  assert.equal(records.length, 2);
});

// ── drain atomicity: second drain is empty ──────────────────────────────────

test('drain atomicity: a second immediate drain returns no records', () => {
  const dir = tmpDir();
  append(dir, { kind: 'signal', key: 'a', payload: { v: 1 } });

  const first = drain(dir);
  assert.equal(first.records.length, 1);

  const second = drain(dir);
  assert.equal(second.records.length, 0);
  assert.equal(second.liveness.count, 0);
});

// ── missing dir → clean no-op ───────────────────────────────────────────────

test('drain on a missing session dir is a clean no-op', () => {
  const dir = path.join(os.tmpdir(), `wq-nonexistent-${Date.now()}`);
  let result;
  assert.doesNotThrow(() => {
    result = drain(dir);
  });
  assert.deepEqual(result.records, []);
  assert.equal(result.liveness.count, 0);
  assert.equal(result.liveness.queueAgeSeconds, null);
});

// ── tab / newline-safe payloads ─────────────────────────────────────────────

test('tab and newline in payload and key survive round-trip without breaking rows', () => {
  const dir = tmpDir();
  const messy = 'line1\nline2\tcol\r\nend';
  append(dir, { kind: 'signal', key: `k\ty\nz`, payload: { text: messy } });
  append(dir, { kind: 'signal', key: 'other', payload: { v: 2 } });

  const { records } = drain(dir);
  assert.equal(records.length, 2, 'embedded control chars must not create extra rows');
  const withText = records.find((r) => r.payload && r.payload.text);
  assert.equal(withText.payload.text, messy, 'payload text preserved verbatim via JSON encoding');
});

// ── append always appends; drain dedupe collapses same-key bursts ────────────

test('append always appends; drain dedupe collapses', () => {
  const dir = tmpDir();
  append(dir, { kind: 'signal', key: 'a', payload: { v: 1 } });
  append(dir, { kind: 'signal', key: 'a', payload: { v: 2 } });

  const raw = fs.readFileSync(path.join(dir, '.wake-queue'), 'utf8').split('\n').filter(Boolean);
  assert.equal(raw.length, 2, 'pure append leaves both rows on disk');

  const { records } = drain(dir);
  assert.equal(records.length, 1, 'dedupe-on-drain collapses to latest');
  assert.deepEqual(records[0].payload, { v: 2 });
});

// ── triage log feeds absorbed count ─────────────────────────────────────────

test('triage stubs are counted as absorbed and cleared on drain', () => {
  const dir = tmpDir();
  triage(dir, 'benign agent-1 passed-mid-wave');
  triage(dir, 'benign agent-2 passed-mid-wave');
  append(dir, { kind: 'signal', key: 'a', payload: { v: 1 } });

  const { liveness } = drain(dir);
  assert.equal(liveness.absorbedSinceLastDrain, 2);

  // Cleared: a second drain reports zero absorbed.
  triage(dir, 'benign agent-3 passed-mid-wave');
  const second = drain(dir);
  assert.equal(second.liveness.absorbedSinceLastDrain, 1, 'count is since last drain, not cumulative');
});

// ── append requires kind ────────────────────────────────────────────────────

test('append throws when kind is missing', () => {
  const dir = tmpDir();
  assert.throws(() => append(dir, { key: 'a', payload: {} }), /kind is required/);
});

// ── Fix B: pointer is scoped per-repo ───────────────────────────────────────

test('resolveWakeSource scopes the pointer per-repo (Fix B)', () => {
  const data = tmpDir();
  const sessionDir = path.join(data, 'session');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.join(data, 'state'), { recursive: true });
  // A pointer written by repo-a's start.
  fs.writeFileSync(path.join(data, 'state', '.active-wake-session.repo-a'), sessionDir);

  const saved = {
    data: process.env.PHANTOM_DATA,
    repo: process.env.PHANTOM_REPO,
    env: process.env.PHANTOM_WAKE_SESSION_DIR,
  };
  delete process.env.PHANTOM_WAKE_SESSION_DIR;
  process.env.PHANTOM_DATA = data;
  try {
    process.env.PHANTOM_REPO = 'repo-a';
    const a = resolveWakeSource();
    assert.equal(a.source, 'pointer', 'repo-a resolves its own pointer');
    assert.equal(a.dir, sessionDir);

    process.env.PHANTOM_REPO = 'repo-b';
    const b = resolveWakeSource();
    assert.equal(b.source, 'state', "repo-b does not see repo-a's pointer — no cross-repo collision");
  } finally {
    for (const [k, v] of [
      ['PHANTOM_DATA', saved.data],
      ['PHANTOM_REPO', saved.repo],
      ['PHANTOM_WAKE_SESSION_DIR', saved.env],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('resolveWakeSource prefers the env override and reports source env (Fix B/C)', () => {
  const dir = tmpDir();
  const prev = process.env.PHANTOM_WAKE_SESSION_DIR;
  process.env.PHANTOM_WAKE_SESSION_DIR = dir;
  try {
    const r = resolveWakeSource();
    assert.equal(r.source, 'env');
    assert.equal(r.dir, dir);
  } finally {
    if (prev === undefined) delete process.env.PHANTOM_WAKE_SESSION_DIR;
    else process.env.PHANTOM_WAKE_SESSION_DIR = prev;
  }
});

// ── Fix A: CLI harness (consumer entry point) ───────────────────────────────

test('CLI: drain [dir] drains the given dir and prints {records,liveness} JSON (Fix A)', () => {
  const dir = tmpDir();
  append(dir, { kind: 'signal', key: 'a', payload: { v: 1 } });
  append(dir, { kind: 'signal', key: 'a', payload: { v: 2 } });

  const out = execFileSync(process.execPath, [CLI_PATH, 'drain', dir], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.records.length, 1, 'dedupe-on-drain collapses to latest');
  assert.deepEqual(parsed.records[0].payload, { v: 2 });
  assert.ok(parsed.liveness && typeof parsed.liveness.count === 'number');

  // The CLI drained it: an in-process drain now sees nothing.
  const { records } = drain(dir);
  assert.equal(records.length, 0, 'CLI drain consumed the queue');
});

test('CLI: resolve prints the env-resolved wake dir (Fix A)', () => {
  const dir = tmpDir();
  const env = { ...process.env, PHANTOM_WAKE_SESSION_DIR: dir };
  const out = execFileSync(process.execPath, [CLI_PATH, 'resolve'], { encoding: 'utf8', env });
  assert.equal(out.trim(), dir);
});

// ── liveness surfaces a non-negative queue age ──────────────────────────────

test('liveness reports queue age and record counts', () => {
  const dir = tmpDir();
  append(dir, { kind: 'signal', key: 'a', payload: { v: 1 } });
  append(dir, { kind: 'signal', key: 'a', payload: { v: 2 } });

  const { liveness } = drain(dir);
  assert.ok(typeof liveness.queueAgeSeconds === 'number' && liveness.queueAgeSeconds >= 0);
  assert.equal(liveness.rawCount, 2);
  assert.equal(liveness.count, 1);
  assert.ok(typeof liveness.drainedAt === 'string');
});
