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

function threadsResponse(nodes, truncated = false, reviewNodes = [], commentNodes = []) {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: truncated },
            nodes,
          },
          reviews: {
            pageInfo: { hasNextPage: false },
            nodes: reviewNodes,
          },
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: commentNodes,
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
    items: [],
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
    JSON.stringify({ number: 42, state: 'OPEN', url: VIEW_URL, headRefOid: 'abc', statusCheckRollup: [] }),
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
  assert.deepEqual(result.items, [
    { id: 't1', status: 'resolved', kind: 'thread' },
    { id: 't2', status: 'open', kind: 'thread' },
  ]);
});

test('tick includes top-level PR reviews and issue comments in items, tagged by kind', () => {
  const run = stubGh([
    JSON.stringify({ number: 42, state: 'OPEN', url: VIEW_URL, headRefOid: 'abc', statusCheckRollup: [] }),
    threadsResponse(
      [{ id: 't1', isResolved: false }],
      false,
      [{ id: 'r1', author: { login: 'reviewer1' }, body: 'Looks mostly good, one nit.' }],
      [{ id: 'c1', author: { login: 'bot' }, body: 'CI failed on lint.' }]
    ),
  ]);
  const result = tick(42, { runGh: run });
  assert.equal(result.unresolvedCount, 1, 'unresolvedCount still counts threads only');
  assert.deepEqual(result.items, [
    { id: 't1', status: 'open', kind: 'thread' },
    { id: 'r1', kind: 'review', author: 'reviewer1', body: 'Looks mostly good, one nit.' },
    { id: 'c1', kind: 'comment', author: 'bot', body: 'CI failed on lint.' },
  ]);
});

test('a review with an empty body is dropped, an issue comment is kept regardless', () => {
  const run = stubGh([
    JSON.stringify({ number: 42, state: 'OPEN', url: VIEW_URL, headRefOid: 'abc', statusCheckRollup: [] }),
    threadsResponse(
      [],
      false,
      [{ id: 'r1', author: { login: 'reviewer1' }, body: '' }],
      [{ id: 'c1', author: { login: 'bot' }, body: '' }]
    ),
  ]);
  const result = tick(42, { runGh: run });
  assert.deepEqual(
    result.items.map((i) => i.id),
    ['c1'],
    'empty-body review is filtered, empty-body comment is not'
  );
});

test('tick reports clean and stops once every thread is resolved', () => {
  const run = stubGh([
    JSON.stringify({ number: 42, state: 'OPEN', url: VIEW_URL, headRefOid: 'abc', statusCheckRollup: [] }),
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
    JSON.stringify({ number: 42, state: 'OPEN', url: VIEW_URL, headRefOid: 'abc', statusCheckRollup: [] }),
    threadsResponse([]),
  ]);
  const result = tick(42, { runGh: run });
  assert.equal(result.stop, false);
  assert.equal(result.reason, 'open');
});

test('a truncated thread listing never reports clean even with zero unresolved', () => {
  const run = stubGh([
    JSON.stringify({ number: 42, state: 'OPEN', url: VIEW_URL, headRefOid: 'abc', statusCheckRollup: [] }),
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

test('inline-only feedback contains author, text and location while pending checks prevent clean', () => {
  const run = stubGh([
    JSON.stringify({ number: 42, state: 'OPEN', url: VIEW_URL, headRefOid: 'new-head', statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: '' }] }),
    threadsResponse([{ id: 'inline', isResolved: true, path: 'a.js', line: 3, comments: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'c', author: { login: 'reviewer' }, body: 'Fix the condition', path: 'a.js', line: 3 }] } }]),
  ]);
  const result = tick(42, { runGh: run });
  assert.equal(result.stop, false);
  assert.equal(result.head, 'new-head');
  assert.equal(result.items[0].comments[0].author, 'reviewer');
  assert.equal(result.items[0].comments[0].body, 'Fix the condition');
  assert.equal(result.items[0].comments[0].line, 3);
});

test('review rounds persist across head changes, ignore duplicate classifications and stop at the cap', () => {
  const { reviewTransition } = require('../lib/pr-watch');
  const observed = { head: 'a', checks: [], items: [{ id: 'one', kind: 'thread', status: 'open' }], unresolvedCount: 1, stop: false };
  const first = reviewTransition({}, observed, [{ id: 'one', classification: 'actionable' }]);
  assert.equal(first.reviewRound, 1);
  const duplicate = reviewTransition(first, observed, [{ id: 'one', classification: 'actionable' }]);
  assert.equal(duplicate.reviewRound, 1);
  assert.equal(reviewTransition(first, { ...observed, head: 'b' }).headChanged, true);
  assert.throws(() => reviewTransition({ reviewRound: 5 }, observed, [{ id: 'one', classification: 'actionable' }]), /budget/);
  assert.equal(reviewTransition({ reviewRound: 4 }, observed, [{ id: 'one', classification: 'actionable' }]).next, 'human');
});

test('new feedback on an existing thread is classified again', () => {
  const { reviewTransition } = require('../lib/pr-watch');
  const initial = { head: 'abc', checks: [], stop: false, unresolvedCount: 1, items: [{ id: 't', kind: 'thread', status: 'open', comments: [{ id: 'c1', body: 'first' }] }] };
  const saved = reviewTransition({}, initial, [{ id: 't', classification: 'actionable' }]);
  const changed = { ...initial, items: [{ ...initial.items[0], comments: [...initial.items[0].comments, { id: 'c2', body: 'another defect' }] }] };
  assert.equal(reviewTransition(saved, changed).pendingItems.length, 1);
  assert.equal(reviewTransition(saved, changed, [{ id: 't', classification: 'actionable' }]).reviewRound, 2);
});

test('threadless approved review finishes after classification; awaiting review stays pending', () => {
  const { reviewTransition } = require('../lib/pr-watch');
  const view = { number: 42, state: 'OPEN', url: VIEW_URL, headRefOid: 'abc', statusCheckRollup: [], reviewDecision: 'APPROVED' };
  const observed = tick(42, { runGh: stubGh([JSON.stringify(view), threadsResponse([], false, [{ id: 'r', author: { login: 'reviewer' }, body: 'Looks good' }])]) });
  assert.equal(reviewTransition({}, observed, [{ id: 'r', classification: 'informational' }]).next, 'review_complete');
  const waiting = tick(42, { runGh: stubGh([JSON.stringify({ ...view, reviewDecision: '' }), threadsResponse([])]) });
  assert.equal(waiting.stop, false);
});
