// Author: Subash Karki
// pr-watch.js - wrap's post-PR poll. One tick(prNumber) call reads the
// PR's current state, review threads, top-level reviews, and issue comments
// via gh, and classifies each thread as resolved or open. No watch file, no
// wake queue, no watermark, no tick ceiling - nothing is persisted between
// calls. The wrap command decides whether to poll again and renders the
// result it gets back.

'use strict';

const { spawnSync } = require('node:child_process');
const { digest } = require('./git-state');

function runGh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) {
    throw new Error(`gh unavailable: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const line = (result.stderr || '').trim().split('\n')[0] || `exit ${result.status}`;
    throw new Error(`gh ${args.join(' ')} failed: ${line}`);
  }
  return result.stdout;
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} returned unparseable JSON`);
  }
}

function ownerRepoFromUrl(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, '') };
}

// Fetches inline review threads plus top-level reviews and issue comments in
// one call - a reviewer's feedback can land in any of the three, and
// wrap must see all of it, not just inline threads.
const REVIEW_THREADS_QUERY = [
  'query($owner:String!,$name:String!,$number:Int!){',
  '  repository(owner:$owner,name:$name){',
  '    pullRequest(number:$number){',
  '      reviewThreads(first:100){',
  '        pageInfo{hasNextPage}',
  '        nodes{id isResolved path line comments(first:100){pageInfo{hasNextPage} nodes{id author{login} body path line}}}',
  '      }',
  '      reviews(first:100){',
  '        pageInfo{hasNextPage}',
  '        nodes{id author{login} body}',
  '      }',
  '      comments(first:100){',
  '        pageInfo{hasNextPage}',
  '        nodes{id author{login} body}',
  '      }',
  '    }',
  '  }',
  '}',
].join(' ');

function fetchThreads(run, loc, pr) {
  const raw = run([
    'api', 'graphql',
    '-F', `owner=${loc.owner}`,
    '-F', `name=${loc.repo}`,
    '-F', `number=${pr}`,
    '-f', `query=${REVIEW_THREADS_QUERY}`,
  ]);
  const gql = parseJson(raw, 'gh api graphql');
  const pull = gql && gql.data && gql.data.repository && gql.data.repository.pullRequest;
  if (!pull) {
    throw new Error('graphql returned no pullRequest');
  }

  const threadsConn = pull.reviewThreads || {};
  const threadNodes = Array.isArray(threadsConn.nodes) ? threadsConn.nodes : [];
  const threads = threadNodes.map((node) => ({
    id: node.id,
    status: node.isResolved ? 'resolved' : 'open',
    ...(node.comments ? { path: node.path, line: node.line, comments: node.comments.nodes.map((comment) => ({ id: comment.id, author: comment.author?.login || null, body: comment.body, path: comment.path, line: comment.line })) } : {}),
  }));

  const reviewsConn = pull.reviews || {};
  const reviewNodes = Array.isArray(reviewsConn.nodes) ? reviewsConn.nodes : [];
  const reviews = reviewNodes
    .filter((node) => typeof node.body === 'string' && node.body.trim())
    .map((node) => ({
      id: node.id,
      kind: 'review',
      author: node.author && node.author.login,
      body: node.body,
    }));

  const commentsConn = pull.comments || {};
  const commentNodes = Array.isArray(commentsConn.nodes) ? commentsConn.nodes : [];
  const comments = commentNodes.map((node) => ({
    id: node.id,
    kind: 'comment',
    author: node.author && node.author.login,
    body: node.body,
  }));

  const items = [
    ...threads.map((t) => ({ ...t, kind: 'thread' })),
    ...reviews,
    ...comments,
  ];

  const truncated = !!(
    (threadsConn.pageInfo && threadsConn.pageInfo.hasNextPage) ||
    (reviewsConn.pageInfo && reviewsConn.pageInfo.hasNextPage) ||
    (commentsConn.pageInfo && commentsConn.pageInfo.hasNextPage) || threadNodes.some((node) => node.comments?.pageInfo?.hasNextPage)
  );

  return { threads, items, truncated };
}

/**
 * Poll one PR and return a compact, render-ready result:
 *   { pr, state, stop, reason, unresolvedCount, threads, items }
 * `items` is every thread, top-level review, and issue comment, tagged
 * `kind: 'thread' | 'review' | 'comment'`, for wrap to classify -
 * `unresolvedCount` and the clean/open verdict still cover threads only,
 * since only a thread carries a resolved/open state.
 * `reason` is one of merged | closed | clean | open. `stop` is true once the
 * caller should stop polling (merged, closed, or every thread resolved).
 * Nothing is written to disk; call again for a fresh read.
 */
function tick(prNumber, opts = {}) {
  const pr = Number(prNumber);
  if (!Number.isInteger(pr) || pr < 1) {
    throw new Error('tick(prNumber): prNumber must be a positive integer');
  }
  const run = opts.runGh || runGh;

  const view = parseJson(
    run(['pr', 'view', String(pr), '--json', 'number,state,url,headRefOid,statusCheckRollup,reviewDecision']),
    'gh pr view'
  );
  const state = String(view.state || '').toUpperCase();

  if (state === 'MERGED' || state === 'CLOSED') {
    return {
      pr,
      state,
      stop: true,
      reason: state === 'MERGED' ? 'merged' : 'closed',
      unresolvedCount: 0,
      threads: [],
      items: [],
    };
  }

  const loc = ownerRepoFromUrl(view.url);
  if (!loc) {
    throw new Error('gh pr view did not return a github.com url');
  }
  const { threads, items, truncated } = fetchThreads(run, loc, pr);
  const unresolvedCount = threads.filter((t) => t.status === 'open').length;
  const checks = Array.isArray(view.statusCheckRollup) ? view.statusCheckRollup : null;
  const checksPassed = checks !== null && checks.every((check) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(check.conclusion || check.state));
  const reviewed = view.reviewDecision === 'APPROVED' || (threads.length > 0 && view.reviewDecision !== 'CHANGES_REQUESTED');
  const clean = reviewed && unresolvedCount === 0 && !truncated && checksPassed;

  return {
    pr,
    state,
    stop: clean,
    reason: clean ? 'clean' : 'open',
    unresolvedCount,
    threads,
    items,
    head: view.headRefOid || null,
    checks,
    reviewDecision: view.reviewDecision || null,
    truncated,
  };
}

const MAX_REVIEW_ROUNDS = 5;
function reviewTransition(saved, observed, classifications = []) {
  if (!Array.isArray(classifications)) throw new Error('Review classifications must be an array');
  const handled = new Set(saved.handledReviewIds || []);
  const items = new Map(observed.items.map((item) => [item.id, item]));
  const versions = { ...(saved.reviewItemVersions || {}) };
  for (const item of observed.items) {
    const version = digest(JSON.stringify(item));
    if (versions[item.id] && versions[item.id] !== version) handled.delete(item.id);
    versions[item.id] = version;
  }
  let actionable = false;
  for (const value of classifications) {
    if (!items.has(value.id) || !['actionable', 'informational', 'false-positive'].includes(value.classification)) throw new Error('Classify only observed review items');
    if (!handled.has(value.id) && value.classification === 'actionable') actionable = true;
    handled.add(value.id);
  }
  const rounds = (saved.reviewRound || 0) + (actionable ? 1 : 0);
  if (rounds > MAX_REVIEW_ROUNDS) throw new Error('External review budget exhausted; human decision required');
  const pending = observed.items.filter((item) => !handled.has(item.id) && (item.kind !== 'thread' || item.status === 'open'));
  const budgetBlocked = rounds >= MAX_REVIEW_ROUNDS && (observed.unresolvedCount > 0 || pending.length > 0);
  return { reviewRound: rounds, handledReviewIds: [...handled], reviewItemVersions: versions, reviewHead: observed.head, reviewChecks: observed.checks,
    pendingItems: pending, next: budgetBlocked ? 'human' : observed.stop && !pending.length ? 'review_complete' : 'external_review',
    blocked: budgetBlocked ? ['External review budget exhausted'] : [], headChanged: !!saved.reviewHead && saved.reviewHead !== observed.head };
}

module.exports = { tick, ownerRepoFromUrl, reviewTransition, MAX_REVIEW_ROUNDS };
