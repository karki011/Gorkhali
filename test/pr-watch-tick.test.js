// Author: Subash Karki
// pr-watch-tick.test.js — the watch stops on resolved threads or Greptile 5/5,
// not on idle re-arm. Classification is the script, not Clerk. Zero deps.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  parseGreptileConfidence,
  decideTick,
  runTick,
} = require('../scripts/lib/pr-watch-tick');

const CLI = path.join(__dirname, '..', 'scripts', 'lib', 'pr-watch-tick.js');
const WATERMARK = '2026-08-25T21:40:00.000Z';
const NOW = '2026-08-25T21:42:00.000Z';

function base(overrides = {}) {
  return {
    pr: 1234,
    tick: 1,
    watermark: WATERMARK,
    ceiling: 60,
    state: 'OPEN',
    unresolvedCount: 2,
    threadsTruncated: false,
    greptileScore: 4,
    items: [],
    ...overrides,
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-watch-tick-'));
}

test('parseGreptileConfidence reads Confidence: N/5 and last N/5 fallback', () => {
  assert.equal(parseGreptileConfidence('Confidence: 5/5'), 5);
  assert.equal(parseGreptileConfidence('**Confidence:** 4/5'), 4);
  assert.equal(parseGreptileConfidence('Score 3/5 then later 2/5'), 2);
  assert.equal(parseGreptileConfidence('no score here'), null);
  assert.equal(parseGreptileConfidence(''), null);
});

test('zero unresolved threads exits threads_clean even when Greptile is 4/5', () => {
  const ping = decideTick(base({ unresolvedCount: 0, greptileScore: 4 }));
  assert.equal(ping.verdict, 'exit');
  assert.equal(ping.exit_reason, 'threads_clean');
  assert.equal(ping.next_action, 'ack_stop');
});

test('zero unresolved + GitHub APPROVED exits approved_clean', () => {
  const ping = decideTick(base({
    unresolvedCount: 0,
    reviewDecision: 'APPROVED',
    greptileScore: 4,
  }));
  assert.equal(ping.exit_reason, 'approved_clean');
  assert.equal(ping.next_action, 'ack_stop');
});

test('Greptile 5/5 exits greptile_max even with unresolved threads', () => {
  const ping = decideTick(base({ unresolvedCount: 3, greptileScore: 5 }));
  assert.equal(ping.verdict, 'exit');
  assert.equal(ping.exit_reason, 'greptile_max');
  assert.equal(ping.next_action, 'ack_stop');
});

test('truncated thread list does not claim threads_clean', () => {
  const ping = decideTick(base({
    unresolvedCount: 0,
    threadsTruncated: true,
    greptileScore: 4,
  }));
  assert.equal(ping.verdict, 'idle');
  assert.equal(ping.next_action, 'ack_rearm');
});

test('unknown unresolved count does not invent threads_clean', () => {
  const ping = decideTick(base({ unresolvedCount: undefined, greptileScore: 4 }));
  assert.equal(ping.verdict, 'idle');
});

test('merged and closed beat thread/greptile stops', () => {
  assert.equal(decideTick(base({ state: 'MERGED', unresolvedCount: 0, greptileScore: 5 })).exit_reason, 'merged');
  assert.equal(decideTick(base({ state: 'CLOSED', unresolvedCount: 0, greptileScore: 5 })).exit_reason, 'closed');
});

test('tick past the ceiling exits without waiting for comments', () => {
  const ping = decideTick(base({ tick: 61, ceiling: 60, unresolvedCount: 2, greptileScore: 4 }));
  assert.equal(ping.exit_reason, 'ceiling');
});

test('tick equal to the ceiling still glances', () => {
  const ping = decideTick(base({ tick: 60, ceiling: 60, unresolvedCount: 2, greptileScore: 4 }));
  assert.equal(ping.verdict, 'idle');
});

test('new items after the watermark are new_work only when still dirty', () => {
  const ping = decideTick(base({
    items: [
      { id: 'IC_1', updatedAt: '2026-08-25T21:41:00.000Z' },
      { id: 'IC_1', updatedAt: '2026-08-25T21:41:00.000Z' },
    ],
  }));
  assert.equal(ping.verdict, 'new_work');
  assert.equal(ping.new_count, 1);
  assert.deepEqual(ping.new_ids, ['IC_1']);
  assert.equal(ping.next_action, 'ack_assess');
});

test('new items are ignored once threads are already clean', () => {
  const ping = decideTick(base({
    unresolvedCount: 0,
    items: [{ id: 'IC_1', updatedAt: '2026-08-25T21:41:00.000Z' }],
  }));
  assert.equal(ping.exit_reason, 'threads_clean');
});

test('runTick writes status stopped on threads_clean', () => {
  const dir = tmpDir();
  const watchFile = path.join(dir, 'pr-watch.json');
  fs.writeFileSync(watchFile, JSON.stringify({
    pr: 1234,
    status: 'watching',
    tick: 0,
    watermark: WATERMARK,
    lastPingAt: WATERMARK,
  }));
  const ping = runTick({
    watchFile,
    now: NOW,
    snapshot: {
      state: 'OPEN',
      unresolvedCount: 0,
      greptileScore: 4,
      items: [],
    },
  });
  assert.equal(ping.exit_reason, 'threads_clean');
  const written = JSON.parse(fs.readFileSync(watchFile, 'utf8'));
  assert.equal(written.status, 'stopped');
  assert.equal(written.tick, 1);
  assert.equal(written.lastPingAt, NOW);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runTick writes status stopped on greptile_max', () => {
  const dir = tmpDir();
  const watchFile = path.join(dir, 'pr-watch.json');
  const ping = runTick({
    pr: 99,
    watchFile,
    now: NOW,
    snapshot: {
      state: 'OPEN',
      unresolvedCount: 4,
      greptileScore: 5,
      items: [],
    },
  });
  assert.equal(ping.exit_reason, 'greptile_max');
  const written = JSON.parse(fs.readFileSync(watchFile, 'utf8'));
  assert.equal(written.status, 'stopped');
  assert.equal(written.pr, 99);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI --snapshot-file --json exits 0 with threads_clean', () => {
  const dir = tmpDir();
  const snapshotFile = path.join(dir, 'snap.json');
  fs.writeFileSync(snapshotFile, JSON.stringify({
    state: 'OPEN',
    unresolvedCount: 0,
    greptileScore: 3,
    items: [],
  }));
  const result = spawnSync(process.execPath, [
    CLI, '--pr', '7', '--snapshot-file', snapshotFile, '--json', '--now', NOW,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const ping = JSON.parse(result.stdout);
  assert.equal(ping.verdict, 'exit');
  assert.equal(ping.exit_reason, 'threads_clean');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI default stdout is a CHIEF_PING block', () => {
  const dir = tmpDir();
  const snapshotFile = path.join(dir, 'snap.json');
  fs.writeFileSync(snapshotFile, JSON.stringify({
    state: 'OPEN',
    unresolvedCount: 1,
    greptileScore: 5,
    items: [],
  }));
  const result = spawnSync(process.execPath, [
    CLI, '--pr', '7', '--snapshot-file', snapshotFile,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^CHIEF_PING\n/);
  assert.match(result.stdout, /exit_reason: greptile_max/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI missing --pr exits 2', () => {
  const result = spawnSync(process.execPath, [CLI, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});
