// Author: Subash Karki
// checkpoint.test.js — atomic phase-checkpoint library tests.
// Zero external deps: node:test + node:assert + node:fs + node:os + node:path + node:child_process.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CHECKPOINT_PATH = require.resolve('../scripts/lib/checkpoint');
const { writeCheckpoint, readCheckpoints, latestCheckpoint } = require(CHECKPOINT_PATH);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
}

// ── atomic write: no *.tmp files remain after writeCheckpoint ──────────────

test('atomic write leaves no .tmp files in dir', () => {
  const dir = tmpDir();
  writeCheckpoint(dir, 'context', { ticket: 'TEST-1', foo: 'bar' });
  const leftover = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
  assert.deepEqual(leftover, []);
});

// ── monotonic seq across repeated writes, including pre-existing chunks ────

test('monotonic seq: 001 002 003 including pre-existing chunks', () => {
  const dir = tmpDir();

  // Pre-seed with a manually created chunk at seq 001 so _nextSeq must skip it.
  fs.writeFileSync(
    path.join(dir, '001-seed.json'),
    JSON.stringify({ _meta: { phase: 'seed', ts: new Date().toISOString(), ticket: null }, data: null }),
    'utf8'
  );

  const r2 = writeCheckpoint(dir, 'phase-b', { ticket: 'T-2' });
  const r3 = writeCheckpoint(dir, 'phase-c', { ticket: 'T-3' });

  assert.equal(r2.seq, 2);
  assert.equal(r3.seq, 3);
  assert.ok(r2.file.includes('002-phase-b.json'), `expected 002-phase-b.json, got ${r2.file}`);
  assert.ok(r3.file.includes('003-phase-c.json'), `expected 003-phase-c.json, got ${r3.file}`);

  // readCheckpoints returns all three in order
  const entries = readCheckpoints(dir);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].seq, 1);
  assert.equal(entries[1].seq, 2);
  assert.equal(entries[2].seq, 3);
});

// ── garbage chunk skipped, no throw, latestCheckpoint returns newest valid ─

test('garbage chunk skipped by readCheckpoints; latestCheckpoint returns newest valid', () => {
  const dir = tmpDir();

  const r1 = writeCheckpoint(dir, 'phase-a', { ticket: 'T-10' });
  const r2 = writeCheckpoint(dir, 'phase-b', { ticket: 'T-10' });

  // Inject unparseable JSON between the two valid chunks (seq 002 already taken, use 003).
  const garbageFile = path.join(dir, '003-garbage.json');
  fs.writeFileSync(garbageFile, '{ this is not : valid json ]]]', 'utf8');

  // readCheckpoints must not throw; garbage chunk must be absent from results.
  let entries;
  assert.doesNotThrow(() => { entries = readCheckpoints(dir); });
  assert.equal(entries.length, 2, 'garbage chunk must be excluded');
  assert.equal(entries[0].seq, r1.seq);
  assert.equal(entries[1].seq, r2.seq);

  // latestCheckpoint must return the last VALID chunk (seq 2), not seq 3 garbage.
  const latest = latestCheckpoint(dir);
  assert.ok(latest !== null);
  assert.equal(latest.seq, r2.seq);
  assert.equal(latest.phase, 'phase-b');
});

// ── missing dir → readCheckpoints returns [] ──────────────────────────────

test('missing dir returns empty array from readCheckpoints', () => {
  const dir = path.join(os.tmpdir(), `cp-nonexistent-${Date.now()}`);
  const entries = readCheckpoints(dir);
  assert.deepEqual(entries, []);
});

// ── missing dir → latestCheckpoint returns null ───────────────────────────

test('missing dir returns null from latestCheckpoint', () => {
  const dir = path.join(os.tmpdir(), `cp-nonexistent-${Date.now()}-b`);
  assert.equal(latestCheckpoint(dir), null);
});

// ── phase filter ──────────────────────────────────────────────────────────

test('readCheckpoints phase filter returns only matching phase', () => {
  const dir = tmpDir();
  writeCheckpoint(dir, 'alpha', {});
  writeCheckpoint(dir, 'beta', {});
  writeCheckpoint(dir, 'alpha', {});

  const alphas = readCheckpoints(dir, { phase: 'alpha' });
  assert.equal(alphas.length, 2);
  for (const e of alphas) assert.equal(e.phase, 'alpha');
});

// ── payload shape: _meta and data fields present ──────────────────────────

test('writeCheckpoint stores _meta and data in file', () => {
  const dir = tmpDir();
  const { file } = writeCheckpoint(dir, 'shape-test', { ticket: 'X-99', extra: true });
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed._meta.phase, 'shape-test');
  assert.equal(parsed._meta.ticket, 'X-99');
  assert.ok(typeof parsed._meta.ts === 'string');
  assert.equal(parsed.data.extra, true);
});

// ── ticket defaults to null when not provided ─────────────────────────────

test('ticket defaults to null when not present in data', () => {
  const dir = tmpDir();
  const { file } = writeCheckpoint(dir, 'no-ticket', { something: 1 });
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed._meta.ticket, null);
});

// ── CLI round-trip: write via stdin → latest returns it ───────────────────

test('CLI round-trip: write with stdin JSON → latest returns it', () => {
  const dir = tmpDir();
  const input = JSON.stringify({ ticket: 'CLI-1', value: 42 });

  const writeOut = execFileSync(
    process.execPath,
    [CHECKPOINT_PATH, 'write', dir, 'cli-phase'],
    { input, encoding: 'utf8' }
  ).trim();

  const writeResult = JSON.parse(writeOut);
  assert.equal(writeResult.seq, 1);
  assert.ok(writeResult.file.includes('001-cli-phase.json'));

  const latestOut = execFileSync(
    process.execPath,
    [CHECKPOINT_PATH, 'latest', dir],
    { encoding: 'utf8' }
  ).trim();

  const latestResult = JSON.parse(latestOut);
  assert.ok(latestResult !== null);
  assert.equal(latestResult.seq, 1);
  assert.equal(latestResult.phase, 'cli-phase');
  assert.equal(latestResult.data.value, 42);
});

// ── CLI list ──────────────────────────────────────────────────────────────

test('CLI list returns ordered JSON array', () => {
  const dir = tmpDir();
  writeCheckpoint(dir, 'p1', { n: 1 });
  writeCheckpoint(dir, 'p2', { n: 2 });

  const out = execFileSync(
    process.execPath,
    [CHECKPOINT_PATH, 'list', dir],
    { encoding: 'utf8' }
  ).trim();

  const entries = JSON.parse(out);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].seq, 1);
  assert.equal(entries[1].seq, 2);
});

// ── CLI latest on empty dir returns null ──────────────────────────────────

test('CLI latest on empty dir returns null', () => {
  const dir = tmpDir();
  const out = execFileSync(
    process.execPath,
    [CHECKPOINT_PATH, 'latest', dir],
    { encoding: 'utf8' }
  ).trim();
  assert.equal(JSON.parse(out), null);
});
