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
  pickLatestGreptileScore,
  decideTick,
  snapshotFromPull,
  fetchSnapshot,
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

test('parseGreptileConfidence reads labeled Confidence only', () => {
  assert.equal(parseGreptileConfidence('Confidence: 5/5'), 5);
  assert.equal(parseGreptileConfidence('**Confidence:** 4/5'), 4);
  assert.equal(parseGreptileConfidence('Score 3/5 then later 2/5'), null);
  assert.equal(parseGreptileConfidence('3/5 files'), null);
  assert.equal(parseGreptileConfidence('no score here'), null);
  assert.equal(parseGreptileConfidence(''), null);
});

test('later unlabeled Greptile body does not hide prior labeled score', () => {
  assert.equal(pickLatestGreptileScore([
    {
      updatedAt: '2026-08-25T21:40:00.000Z',
      author: { login: 'greptile[bot]' },
      body: 'Confidence: 5/5',
    },
    {
      updatedAt: '2026-08-25T21:41:00.000Z',
      author: { login: 'greptile[bot]' },
      body: 'looking again, no labeled confidence here',
    },
  ]), 5);
});

test('zero unresolved threads exits threads_clean even when Greptile is 4/5', () => {
  const ping = decideTick(base({ unresolvedCount: 0, threadCount: 2, greptileScore: 4 }));
  assert.equal(ping.verdict, 'exit');
  assert.equal(ping.exit_reason, 'threads_clean');
  assert.equal(ping.next_action, 'ack_stop');
});

test('zero unresolved + GitHub APPROVED exits approved_clean', () => {
  const ping = decideTick(base({
    unresolvedCount: 0,
    threadCount: 1,
    reviewDecision: 'APPROVED',
    greptileScore: 4,
  }));
  assert.equal(ping.exit_reason, 'approved_clean');
  assert.equal(ping.next_action, 'ack_stop');
});

test('zero review threads stays idle, not threads_clean', () => {
  const zero = decideTick(base({ unresolvedCount: 0, threadCount: 0, greptileScore: 4 }));
  assert.equal(zero.verdict, 'idle');
  assert.equal(zero.exit_reason, 'none');
  const omitted = decideTick(base({ unresolvedCount: 0, greptileScore: 4 }));
  assert.equal(omitted.verdict, 'idle');
  const max = decideTick(base({ unresolvedCount: 0, threadCount: 0, greptileScore: 5 }));
  assert.equal(max.exit_reason, 'greptile_max');
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
    threadCount: 2,
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
    threadCount: 1,
    items: [{ id: 'IC_1', updatedAt: '2026-08-25T21:41:00.000Z' }],
  }));
  assert.equal(ping.exit_reason, 'threads_clean');
});

test('snapshotFromPull sets truncation flags from pageInfo', () => {
  const truncated = snapshotFromPull({
    state: 'OPEN',
    reviewDecision: 'REVIEW_REQUIRED',
    comments: { pageInfo: { hasPreviousPage: true }, nodes: [] },
    reviews: { pageInfo: { hasPreviousPage: true }, nodes: [] },
    reviewThreads: {
      pageInfo: { hasNextPage: true },
      nodes: [
        { isResolved: true, comments: { nodes: [] } },
        { isResolved: false, comments: { nodes: [] } },
      ],
    },
  }, { number: 12, state: 'OPEN' });
  assert.equal(truncated.pr, 12);
  assert.equal(truncated.commentsTruncated, true);
  assert.equal(truncated.reviewsTruncated, true);
  assert.equal(truncated.threadsTruncated, true);
  assert.equal(truncated.threadCount, 2);
  assert.equal(truncated.unresolvedCount, 1);

  const full = snapshotFromPull({
    comments: { pageInfo: { hasPreviousPage: false }, nodes: [] },
    reviews: { pageInfo: { hasPreviousPage: false }, nodes: [] },
    reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] },
  }, { number: 1 });
  assert.equal(full.commentsTruncated, false);
  assert.equal(full.reviewsTruncated, false);
  assert.equal(full.threadsTruncated, false);
  assert.equal(full.threadCount, 0);
});

test('fetchSnapshot REST-falls back when GraphQL has no labeled Confidence', () => {
  const calls = [];
  const snap = fetchSnapshot(42, {
    runGh(args) {
      calls.push(args);
      if (args[0] === 'pr') {
        return JSON.stringify({
          number: 42,
          state: 'OPEN',
          url: 'https://github.com/acme/repo/pull/42',
          reviewDecision: null,
        });
      }
      if (args[1] === 'graphql') {
        return JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                state: 'OPEN',
                comments: { pageInfo: { hasPreviousPage: false }, nodes: [] },
                reviews: { pageInfo: { hasPreviousPage: false }, nodes: [] },
                reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] },
              },
            },
          },
        });
      }
      return JSON.stringify([
        {
          id: 99,
          updated_at: '2026-08-25T21:41:00.000Z',
          user: { login: 'greptile[bot]' },
          body: 'Confidence: 5/5',
        },
      ]);
    },
  });
  assert.equal(snap.greptileScore, 5);
  assert.equal(snap.threadCount, 0);
  const restUrl = String((calls.find((a) => a[0] === 'api' && a[1] !== 'graphql') || [])[1] || '');
  assert.ok(restUrl.includes('repos/acme/repo/issues/42/comments'));
  assert.ok(restUrl.includes('sort=updated'));
  assert.ok(restUrl.includes('direction=desc'));
  assert.ok(snap.items.some((item) => String(item.id) === '99'));
});

function mockPrView() {
  return JSON.stringify({
    number: 42,
    state: 'OPEN',
    url: 'https://github.com/acme/repo/pull/42',
    reviewDecision: null,
  });
}

function graphqlPullPayload(reviewThreads, extra = {}) {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          state: 'OPEN',
          comments: extra.comments || { pageInfo: { hasPreviousPage: false }, nodes: [] },
          reviews: extra.reviews || { pageInfo: { hasPreviousPage: false }, nodes: [] },
          reviewThreads,
        },
      },
    },
  });
}

test('fetchSnapshot paginates reviewThreads when first page hasNextPage', () => {
  const calls = [];
  const snap = fetchSnapshot(42, {
    runGh(args) {
      calls.push(args);
      if (args[0] === 'pr') return mockPrView();
      if (args[1] === 'graphql') {
        const query = String(args.find((a) => String(a).startsWith('query=')) || '');
        if (query.includes('after:$cursor')) {
          return graphqlPullPayload({
            pageInfo: { hasNextPage: false, endCursor: 'c2' },
            nodes: [{ isResolved: false, comments: { nodes: [] } }],
          });
        }
        return graphqlPullPayload({
          pageInfo: { hasNextPage: true, endCursor: 'c1' },
          nodes: [{ isResolved: true, comments: { nodes: [] } }],
        });
      }
      return JSON.stringify([]);
    },
  });
  assert.equal(snap.threadCount, 2);
  assert.equal(snap.threadsTruncated, false);
  const graphqlCalls = calls.filter((a) => a[1] === 'graphql');
  assert.equal(graphqlCalls.length, 2);
  const secondQuery = String(graphqlCalls[1].find((a) => String(a).startsWith('query=')) || '');
  assert.ok(secondQuery.includes('after:$cursor'));
});

test('fetchSnapshot does not paginate reviewThreads when first page is complete', () => {
  const calls = [];
  fetchSnapshot(42, {
    runGh(args) {
      calls.push(args);
      if (args[0] === 'pr') return mockPrView();
      if (args[1] === 'graphql') {
        return graphqlPullPayload({
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{ isResolved: true, comments: { nodes: [] } }],
        });
      }
      return JSON.stringify([]);
    },
  });
  assert.equal(calls.filter((a) => a[1] === 'graphql').length, 1);
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
      threadCount: 1,
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
    threadCount: 1,
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
