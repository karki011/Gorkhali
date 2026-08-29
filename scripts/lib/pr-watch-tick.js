// Author: Subash Karki
// pr-watch-tick.js — deterministic Phase 2 PR-watch tick. GitHub classification
// lives here, not in Clerk or Chief. The watch stops as soon as every review
// thread is resolved OR Greptile reports 5/5. Idle re-arm is only for an open
// PR that is still dirty. Never merges.
//
// Usage:
//   node scripts/lib/pr-watch-tick.js --pr 123 [--watch-file path]
//   node scripts/lib/pr-watch-tick.js --watch-file {SESSION_DIR}/pr-watch.json
//
// Default stdout is a CHIEF_PING block. --json prints the ping object.

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { formatChiefPing, validateWatchState } = require('./chief-ping');
const { PR_WATCH_TICK_CEILING } = require('./constants');
const { GorkhaliError, VALIDATION_ERROR, reportError } = require('./axi-error');

const GREPTILE_LOGIN_RE = /greptile/i;
const CONFIDENCE_RE = /confidence\s*[:\s]*([1-5])\s*\/\s*5/i;
const SCORE_RE = /\b([1-5])\s*\/\s*5\b/g;

const GRAPHQL_QUERY = [
  'query($owner:String!,$name:String!,$number:Int!){',
  '  repository(owner:$owner,name:$name){',
  '    pullRequest(number:$number){',
  '      state reviewDecision',
  '      comments(last:50){nodes{id databaseId updatedAt author{login} body}}',
  '      reviews(last:50){nodes{id databaseId submittedAt author{login} body}}',
  '      reviewThreads(first:100){',
  '        pageInfo{hasNextPage}',
  '        nodes{isResolved comments(first:10){nodes{id databaseId updatedAt}}}',
  '      }',
  '    }',
  '  }',
  '}',
].join(' ');

function parseGreptileConfidence(body) {
  if (typeof body !== 'string' || !body) return null;
  const explicit = body.match(CONFIDENCE_RE);
  if (explicit) return Number(explicit[1]);
  let last = null;
  SCORE_RE.lastIndex = 0;
  let match;
  while ((match = SCORE_RE.exec(body))) last = Number(match[1]);
  return last;
}

function isGreptileLogin(login) {
  return typeof login === 'string' && GREPTILE_LOGIN_RE.test(login);
}

function toIso(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function newerThan(iso, watermark) {
  if (!iso) return false;
  const a = Date.parse(iso);
  const b = Date.parse(watermark);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function ownerRepoFromUrl(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, '') };
}

function uniqueItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || item.id == null) continue;
    const key = String(item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, updatedAt: item.updatedAt });
  }
  return out;
}

function loginOf(node) {
  return node && node.author && node.author.login;
}

/**
 * Decide one CHIEF_PING from a fetched snapshot. No GitHub I/O.
 * Stop reasons (first match): merged, closed, ceiling, threads_clean /
 * approved_clean (zero unresolved threads, listing not truncated), greptile_max
 * (score === 5). Otherwise new_work if anything is newer than the watermark,
 * else idle.
 */
function decideTick(snapshot) {
  const pr = snapshot.pr;
  const tick = snapshot.tick;
  const watermark = snapshot.watermark;
  const ceiling = snapshot.ceiling == null ? PR_WATCH_TICK_CEILING : snapshot.ceiling;
  const items = uniqueItems(Array.isArray(snapshot.items) ? snapshot.items : []);

  const ping = {
    pr,
    tick,
    verdict: 'idle',
    exit_reason: 'none',
    new_count: 0,
    new_ids: [],
    watermark,
    next_action: 'ack_rearm',
  };

  const state = String(snapshot.state || '').toUpperCase();
  if (state === 'MERGED') {
    return { ...ping, verdict: 'exit', exit_reason: 'merged', next_action: 'ack_stop' };
  }
  if (state === 'CLOSED') {
    return { ...ping, verdict: 'exit', exit_reason: 'closed', next_action: 'ack_stop' };
  }
  if (tick > ceiling) {
    return { ...ping, verdict: 'exit', exit_reason: 'ceiling', next_action: 'ack_stop' };
  }

  const unresolved = snapshot.unresolvedCount;
  if (typeof unresolved === 'number' && unresolved === 0 && snapshot.threadsTruncated !== true) {
    const approved = String(snapshot.reviewDecision || '').toUpperCase() === 'APPROVED';
    return {
      ...ping,
      verdict: 'exit',
      exit_reason: approved ? 'approved_clean' : 'threads_clean',
      next_action: 'ack_stop',
    };
  }

  if (snapshot.greptileScore === 5) {
    return { ...ping, verdict: 'exit', exit_reason: 'greptile_max', next_action: 'ack_stop' };
  }

  const fresh = items.filter((item) => newerThan(item.updatedAt, watermark));
  if (fresh.length > 0) {
    const newest = fresh.reduce((acc, item) => maxIso(acc, item.updatedAt), watermark);
    return {
      ...ping,
      verdict: 'new_work',
      new_count: fresh.length,
      new_ids: fresh.map((item) => item.id),
      watermark: newest || watermark,
      next_action: 'ack_assess',
    };
  }

  return ping;
}

function runGh(args, opts = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    cwd: opts.cwd,
  });
  if (result.error) {
    throw new GorkhaliError(`gh unavailable: ${result.error.message}`, 'IO_ERROR');
  }
  if (result.status !== 0) {
    const err = (result.stderr || '').trim().split('\n')[0] || `exit ${result.status}`;
    throw new GorkhaliError(`gh ${args.join(' ')} failed: ${err}`, 'IO_ERROR');
  }
  return result.stdout;
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new GorkhaliError(`${label} returned unparseable JSON`, 'IO_ERROR');
  }
}

function pushNode(items, node, timestamp) {
  if (!node) return;
  const id = node.databaseId != null ? node.databaseId : node.id;
  const updatedAt = toIso(timestamp);
  if (id == null || !updatedAt) return;
  items.push({ id, updatedAt });
}

function fetchSnapshot(pr, opts = {}) {
  const run = opts.runGh || ((args) => runGh(args, opts));
  const view = parseJson(
    run(['pr', 'view', String(pr), '--json', 'number,state,url,reviewDecision']),
    'gh pr view'
  );
  const loc = ownerRepoFromUrl(view.url);
  if (!loc) {
    throw new GorkhaliError('gh pr view did not return a github.com url', 'IO_ERROR');
  }

  const gql = parseJson(
    run([
      'api', 'graphql',
      '-F', `owner=${loc.owner}`,
      '-F', `name=${loc.repo}`,
      '-F', `number=${pr}`,
      '-f', `query=${GRAPHQL_QUERY}`,
    ]),
    'gh api graphql'
  );
  const pull = gql && gql.data && gql.data.repository && gql.data.repository.pullRequest;
  if (!pull) {
    throw new GorkhaliError('graphql returned no pullRequest', 'IO_ERROR');
  }

  const threadConn = pull.reviewThreads || {};
  const threads = Array.isArray(threadConn.nodes) ? threadConn.nodes : [];
  const unresolvedCount = threads.filter((thread) => thread && thread.isResolved === false).length;
  const threadsTruncated = !!(threadConn.pageInfo && threadConn.pageInfo.hasNextPage);

  const comments = (pull.comments && pull.comments.nodes) || [];
  const reviews = (pull.reviews && pull.reviews.nodes) || [];
  const greptileBodies = [...comments, ...reviews]
    .filter((node) => isGreptileLogin(loginOf(node)) && node.body)
    .sort((a, b) => {
      const aTs = Date.parse(toIso(a.updatedAt || a.submittedAt) || 0);
      const bTs = Date.parse(toIso(b.updatedAt || b.submittedAt) || 0);
      return aTs - bTs;
    });
  const latestGreptile = greptileBodies[greptileBodies.length - 1];
  const greptileScore = latestGreptile
    ? parseGreptileConfidence(latestGreptile.body)
    : null;

  const items = [];
  for (const node of comments) pushNode(items, node, node.updatedAt);
  for (const node of reviews) pushNode(items, node, node.submittedAt);
  for (const thread of threads) {
    for (const node of (thread.comments && thread.comments.nodes) || []) {
      pushNode(items, node, node.updatedAt);
    }
  }

  return {
    pr: Number.isInteger(view.number) ? view.number : Number(pr),
    state: pull.state || view.state,
    reviewDecision: pull.reviewDecision || view.reviewDecision || null,
    unresolvedCount,
    threadsTruncated,
    greptileScore,
    items,
  };
}

function readWatchFile(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new GorkhaliError(`cannot read watch file: ${err.message}`, 'IO_ERROR');
  }
  const result = validateWatchState(parsed);
  if (!result.ok) {
    throw new GorkhaliError(`invalid watch state: ${result.errors.join('; ')}`, VALIDATION_ERROR);
  }
  return result.state;
}

function applyWatchFile(filePath, ping, nowIso) {
  const state = {
    pr: ping.pr,
    status: ping.verdict === 'exit' ? 'stopped' : 'watching',
    tick: ping.tick,
    watermark: ping.watermark,
    lastPingAt: nowIso,
  };
  const result = validateWatchState(state);
  if (!result.ok) {
    throw new GorkhaliError(`invalid watch state: ${result.errors.join('; ')}`, VALIDATION_ERROR);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
  return state;
}

function positiveInt(raw, label) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new GorkhaliError(`${label} must be a positive integer`, VALIDATION_ERROR);
  }
  return n;
}

function nonNegInt(raw, label) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new GorkhaliError(`${label} must be a non-negative integer`, VALIDATION_ERROR);
  }
  return n;
}

function runTick(opts = {}) {
  const nowIso = opts.now || new Date().toISOString();
  let watch = null;
  if (opts.watchFile && fs.existsSync(opts.watchFile)) {
    watch = readWatchFile(opts.watchFile);
  }

  const prRaw = opts.pr != null ? opts.pr : (watch && watch.pr);
  const pr = positiveInt(prRaw, '--pr');
  const tick = opts.tick != null
    ? nonNegInt(opts.tick, '--tick')
    : (watch ? watch.tick + 1 : 1);
  const watermark = opts.watermark || (watch && watch.watermark) || nowIso;
  const ceiling = opts.ceiling != null ? nonNegInt(opts.ceiling, '--ceiling') : PR_WATCH_TICK_CEILING;

  let snapshot;
  if (opts.snapshot) {
    snapshot = opts.snapshot;
  } else if (opts.snapshotFile) {
    snapshot = parseJson(fs.readFileSync(opts.snapshotFile, 'utf8'), 'snapshot file');
  } else {
    snapshot = fetchSnapshot(pr, opts);
  }

  const ping = decideTick({
    ...snapshot,
    pr,
    tick,
    watermark,
    ceiling,
  });

  if (opts.watchFile) applyWatchFile(opts.watchFile, ping, nowIso);
  return ping;
}

function parseCli(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    if (key === 'json' || key === 'help') {
      args[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

const HELP =
  'pr-watch-tick - deterministic Phase 2 PR-watch tick\n\n' +
  'Usage:\n' +
  '  node scripts/lib/pr-watch-tick.js --pr 123 [--watch-file path]\n' +
  '  node scripts/lib/pr-watch-tick.js --watch-file {SESSION_DIR}/pr-watch.json\n\n' +
  'Stops (verdict: exit) when the PR is merged/closed, the tick ceiling is hit,\n' +
  'every review thread is resolved, or Greptile reports 5/5. Never merges.\n';

module.exports = {
  parseGreptileConfidence,
  decideTick,
  fetchSnapshot,
  runTick,
  applyWatchFile,
  ownerRepoFromUrl,
};

if (require.main === module) {
  const args = parseCli(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
  } else {
    try {
      const ping = runTick({
        pr: args.pr,
        tick: args.tick,
        watermark: args.watermark,
        ceiling: args.ceiling,
        watchFile: args['watch-file'],
        snapshotFile: args['snapshot-file'],
        now: args.now,
      });
      if (args.json) process.stdout.write(JSON.stringify(ping) + '\n');
      else process.stdout.write(formatChiefPing(ping) + '\n');
    } catch (err) {
      reportError(err);
    }
  }
}
