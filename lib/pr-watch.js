// Author: Subash Karki
// pr-watch.js - greploop's post-PR poll. One tick(prNumber) call reads the
// PR's current state and review threads via gh and classifies each thread as
// resolved or open. No watch file, no wake queue, no watermark, no tick
// ceiling - nothing is persisted between calls. The greploop command decides
// whether to poll again and renders the result it gets back.

'use strict';

const { spawnSync } = require('node:child_process');

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

const REVIEW_THREADS_QUERY = [
  'query($owner:String!,$name:String!,$number:Int!){',
  '  repository(owner:$owner,name:$name){',
  '    pullRequest(number:$number){',
  '      reviewThreads(first:100){',
  '        pageInfo{hasNextPage}',
  '        nodes{id isResolved}',
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
  const conn = pull.reviewThreads || {};
  const nodes = Array.isArray(conn.nodes) ? conn.nodes : [];
  return {
    threads: nodes.map((node) => ({
      id: node.id,
      status: node.isResolved ? 'resolved' : 'open',
    })),
    truncated: !!(conn.pageInfo && conn.pageInfo.hasNextPage),
  };
}

/**
 * Poll one PR and return a compact, render-ready result:
 *   { pr, state, stop, reason, unresolvedCount, threads }
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
    run(['pr', 'view', String(pr), '--json', 'number,state,url']),
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
    };
  }

  const loc = ownerRepoFromUrl(view.url);
  if (!loc) {
    throw new Error('gh pr view did not return a github.com url');
  }
  const { threads, truncated } = fetchThreads(run, loc, pr);
  const unresolvedCount = threads.filter((t) => t.status === 'open').length;
  const clean = threads.length > 0 && unresolvedCount === 0 && !truncated;

  return {
    pr,
    state,
    stop: clean,
    reason: clean ? 'clean' : 'open',
    unresolvedCount,
    threads,
  };
}

module.exports = { tick, ownerRepoFromUrl };
