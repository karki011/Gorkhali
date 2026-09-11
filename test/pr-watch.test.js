// Author: Subash Karki
// pr-watch.test.js - tick(prNumber) against a stubbed gh runner. Never a live
// network call.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { tick, ownerRepoFromUrl } = require('../lib/pr-watch');

const VIEW_URL = 'https://github.com/acme/widgets/pull/42';

function stubGh(responses) {
  let call = 0;
  return (args) => {
    const response = responses[call];
    call += 1;
    if (response === undefined) {
      throw new Error(`unexpected gh call #${call + 1}: ${args.join(' ')}`);
    }
    if (response instanceof Error) throw response;
    return response;
  };
}

function threadsResponse(nodes, truncated = false) {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: truncated },
            nodes,
          },
        },
      },
    },
  });
}

test('ownerRepoFromUrl parses a github.com PR url', () => {
  assert.deepEqual(ownerRepoFromUrl(VIEW_URL), { owner: 'acme', repo: 'widgets' });
  assert.equal(ownerRepoFromUrl('not-a-url'), null);
  assert.equal(ownerRepoFromUrl(undefined), null);
});

test('tick stops on a merged PR without fetching threads', () => {
  const run = stubGh([
    JSON.stringify({ number: 42, state: 'MERGED', url: VIEW_URL }),
  ]);
  const result = tick(42, { runGh: run });
  assert.deepEqual(result, {
    pr: 42,
    state: 'MERGED',
    stop: true,
    reason: 'merged',
    unresolvedCount: 0,
    threads: [],
  });
});

test('tick stops on a closed PR without fetching threads', () => {
  const run = stubGh([
    JSON.stringify({ number: 42, state: 'CLOSED', url: VIEW_URL }),
  ]);
  const result = tick(42, { runGh: run });
  assert.equal(result.stop, true);
  assert.equal(result.reason, 'closed');
});

test('tick classifies each thread as resolved or open and keeps polling while any is open', () => {
  const run = stubGh([
    JSON.stringify({ number: 42, state: 'OPEN', url: VIEW_URL }),
    threadsResponse([
      { id: 't1', isResolved: true },
      { id: 't2', isResolved: false },
    ]),
  ]);
  const result = tick(42, { runGh: run });
  assert.equal(result.stop, false);
  assert.equal(result.reason, 'open');
  assert.equal(result.unresolvedCount, 1);
  assert.deepEqual(result.threads, [
    { id: 't1', status: 'resolved' },
    { id: 't2', status: 'open' },
  ]);
});

test('tick reports clean and stops once every thread is resolved', () => {
  const run = stubGh([
    JSON.stringify({ number: 42, state: 'OPEN', url: VIEW_URL }),
    threadsResponse([
      { id: 't1', isResolved: true },
      { id: 't2', isResolved: true },
    ]),
  ]);
  const result = tick(42, { runGh: run });
  assert.equal(result.stop, true);
  assert.equal(result.reason, 'clean');
  assert.equal(result.unresolvedCount, 0);
});

test('a PR with zero review threads is open, not clean', () => {
  const run = stubGh([
    JSON.stringify({ number: 42, state: 'OPEN', url: VIEW_URL }),
    threadsResponse([]),
  ]);
  const result = tick(42, { runGh: run });
  assert.equal(result.stop, false);
  assert.equal(result.reason, 'open');
});

test('a truncated thread listing never reports clean even with zero unresolved', () => {
  const run = stubGh([
    JSON.stringify({ number: 42, state: 'OPEN', url: VIEW_URL }),
    threadsResponse([{ id: 't1', isResolved: true }], true),
  ]);
  const result = tick(42, { runGh: run });
  assert.equal(result.stop, false);
  assert.equal(result.reason, 'open');
});

test('tick rejects a non-positive-integer prNumber', () => {
  assert.throws(() => tick(0), /positive integer/);
  assert.throws(() => tick('abc'), /positive integer/);
  assert.throws(() => tick(undefined), /positive integer/);
});

test('tick surfaces a gh failure as an error', () => {
  const run = stubGh([new Error('gh pr view 42 failed: no pull requests found')]);
  assert.throws(() => tick(42, { runGh: run }), /no pull requests found/);
});

test('tick surfaces unparseable gh output as an error', () => {
  const run = stubGh(['not json']);
  assert.throws(() => tick(42, { runGh: run }), /unparseable JSON/);
});
