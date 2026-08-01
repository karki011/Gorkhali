#!/usr/bin/env node
// Author: Subash Karki
// outcome-write.js - derives and atomically writes outcome.json for one ticket.
//
// A SCRIPT authors this record, not prose. That is the whole point: 201 wrap.json
// files carry 89 distinct top-level keys and 16 free-text pr.status variants because
// an LLM writes them freehand at every wrap. Every field here is derived from a
// ground-truth source (gh, verification.json, the timing jsonl, git) and the shape
// is CLOSED, so it cannot drift the way the prose-authored artifact did.
//
// ABSENT POLICY: a field whose source is unavailable is written as null AND named in
// unresolved[] with a reason. Never fabricated, never estimated, and never inferred
// from an existing wrap.json status string.
//
// CLOSED SCHEMA: closed metadata and identifiers only. No transcripts, no prompt
// text, no model output, no arbitrary blobs - a durable record stores references,
// not bytes.
//
// Usage:
//   node scripts/outcome-write.js --ticket <T> [--repo-path <path>] [--out <file>]
//                                 [--no-gh] [--dry-run] [--json]
//
// Exit codes: 0 = record produced; 1 = write or internal error; 2 = usage error.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { taskDir, completedTaskDir, timingDir, detectRepo } = require('./lib/phantom-paths');
const { atomicWrite } = require('./lib/atomic');
const { PhantomError, exitCodeForError, reportError } = require('./lib/axi-error');

const USAGE =
  'usage: node scripts/outcome-write.js --ticket <T> [--repo-path <path>] [--out <file>] ' +
  '[--no-gh] [--dry-run] [--json]\n';

// The ONLY legal pr_state values. Anything gh reports that does not map onto one of
// these leaves pr_state null plus an unresolved[] entry.
const PR_STATE = ['draft', 'open', 'merged', 'closed', 'absent'];

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (_) {
    return null;
  }
}

// The live session dir, else the archived one (close.md runs after the archive move).
function resolveSessionDir(ticket, repo) {
  for (const dir of [taskDir(ticket, repo), completedTaskDir(ticket, repo)]) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

// ── pr_state: gh ground truth only ─────────────────────────────────────────

// gh's own enum -> the closed pr_state enum. draft is a property of an OPEN pr, so
// isDraft is checked first. An unmapped state returns null, never a guess.
function ghStateToEnum(state, isDraft) {
  if (isDraft === true && state === 'OPEN') return 'draft';
  if (state === 'OPEN') return 'open';
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed';
  return null;
}

/**
 * Query gh for this branch's PR. Returns { url, state, reviews, comments, reason }.
 * `state: 'absent'` means gh answered and there is NO pr for the branch - a real,
 * closed-enum answer. `state: null` with a reason means gh could not be asked.
 */
function readPr(repoPath, opts) {
  if (opts.noGh) return { url: null, state: null, reviews: null, comments: null, reason: '--no-gh: gh not queried' };

  const res = spawnSync('gh', ['pr', 'view', '--json', 'url,state,isDraft,reviews,comments'], {
    cwd: repoPath,
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error) {
    return { url: null, state: null, reviews: null, comments: null, reason: 'gh unavailable: ' + res.error.message };
  }
  if (res.status !== 0) {
    const err = (res.stderr || '').trim();
    // gh's own "no pr for this branch" answer is ground truth, not a failure.
    if (/no pull requests? found|no open pull requests/i.test(err)) {
      return { url: null, state: 'absent', reviews: null, comments: null, reason: null };
    }
    return {
      url: null,
      state: null,
      reviews: null,
      comments: null,
      reason: 'gh pr view failed: ' + (err.split('\n')[0] || 'exit ' + res.status),
    };
  }

  let pr;
  try {
    pr = JSON.parse(res.stdout);
  } catch (e) {
    return { url: null, state: null, reviews: null, comments: null, reason: 'gh pr view returned unparseable JSON' };
  }
  const state = ghStateToEnum(pr.state, pr.isDraft);
  return {
    url: typeof pr.url === 'string' ? pr.url : null,
    state,
    reviews: Array.isArray(pr.reviews) ? pr.reviews.length : null,
    comments: Array.isArray(pr.comments) ? pr.comments.length : null,
    reason: state ? null : 'gh reported state ' + JSON.stringify(pr.state) + ' which maps to no pr_state enum value',
  };
}

// ── agents: timing jsonl spawn/stop, paired the way timing-report.js pairs ──

// Same normalization timing-report.js applies: records with modelSource 'session'
// (or legacy records with no modelSource) fall in the 'inherited' bucket; 'param'
// and 'pinned' records count under their real tier.
function normModel(model, modelSource) {
  const m = model || 'inherited';
  if (!modelSource || modelSource === 'session') {
    return m === 'inherited' || m === 'opus(inherited)' ? 'inherited' : m;
  }
  if (m === 'inherited' || m === 'opus(inherited)') return 'inherited';
  if (m.startsWith('opus')) return 'opus';
  if (m.startsWith('fable')) return 'fable';
  return m;
}

/**
 * Per-agent {agent, model, spawns, ms} for this repo's timing log, pairing
 * spawn -> stop by tool_use id when the harness supplied one on both events and
 * FIFO within a session id otherwise. Counts are EXACT; FIFO-paired durations are
 * approximate when background agents run in parallel, and that caveat travels with
 * the record (agents_pairing) rather than being dropped.
 */
function readAgents(repo) {
  const file = path.join(timingDir(), repo + '.jsonl');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (_) {
    return { agents: null, pairing: null, reason: 'no timing log at ' + file };
  }

  const spawns = [];
  const stops = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch (_) {
      continue;
    }
    (r.event === 'stop' ? stops : spawns).push(r);
  }
  if (spawns.length === 0) return { agents: null, pairing: null, reason: 'timing log has no spawn records' };

  const stopById = new Map();
  for (const st of stops) if (st.id) stopById.set(st.id, st);
  const fifoStops = new Map();
  for (const st of stops) {
    if (st.id) continue;
    if (!fifoStops.has(st.sid)) fifoStops.set(st.sid, []);
    fifoStops.get(st.sid).push(st);
  }

  const byKey = new Map();
  let pairedById = 0;
  let pairedByFifo = 0;
  for (const sp of spawns) {
    const key = (sp.agent || '(unnamed)') + '\0' + normModel(sp.model, sp.modelSource);
    if (!byKey.has(key)) byKey.set(key, { spawns: 0, ms: 0, paired: 0 });
    const entry = byKey.get(key);
    entry.spawns += 1;

    let stop = sp.id ? stopById.get(sp.id) : null;
    if (stop) pairedById += 1;
    else {
      const q = fifoStops.get(sp.sid);
      if (q && q.length) {
        stop = q.shift();
        pairedByFifo += 1;
      }
    }
    if (!stop) continue;
    const dur = Date.parse(stop.ts) - Date.parse(sp.ts);
    if (dur >= 0) {
      entry.ms += dur;
      entry.paired += 1;
    }
  }

  const agents = [...byKey.entries()]
    .map(([key, v]) => {
      const [agent, model] = key.split('\0');
      return { agent, model, spawns: v.spawns, ms: v.paired ? v.ms : null };
    })
    .sort((a, b) => b.spawns - a.spawns || a.agent.localeCompare(b.agent));

  return {
    agents,
    pairing:
      pairedById >= pairedByFifo
        ? 'tool-use-id (exact)'
        : 'fifo-per-session (spawn counts exact; ms approximate when agents run in parallel)',
    reason: null,
  };
}

// ── the record ─────────────────────────────────────────────────────────────

function sessionWallTimeMs(session) {
  if (!session) return null;
  const start = Date.parse(session.created_at);
  const end = Date.parse(session.completed_at || session.updated_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

/**
 * Derive the outcome record. Pure derivation, no writes - main() does the write.
 * Every null field is accompanied by an unresolved[] entry naming it and why.
 */
function deriveOutcome(opts) {
  const repoPath = path.resolve(opts.repoPath || process.cwd());
  const repo = detectRepo(repoPath);
  const ticket = opts.ticket;
  const unresolved = [];

  const add = (field, reason) => unresolved.push({ field, reason });

  const sessionDir = resolveSessionDir(ticket, repo);
  if (!sessionDir) add('session_dir', 'no session dir for ' + ticket + ' under repo ' + repo);

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
  if (!branch) add('branch', 'git rev-parse --abbrev-ref HEAD failed');

  const pr = readPr(repoPath, opts);
  if (pr.reason) add('pr_state', pr.reason);
  if (!pr.url && pr.state !== 'absent') add('pr_url', pr.reason || 'gh returned no url');

  const verification = sessionDir ? loadJson(path.join(sessionDir, 'verification.json')) : null;
  if (!verification) add('verified', 'verification.json absent - verify has not run for this ticket');
  const verdict = verification && typeof verification.verdict === 'string' ? verification.verdict : null;
  if (verification && !verdict) add('verified', 'verification.json has no verdict field');

  // Historical verification artifacts recorded review.fixLoops directly. The
  // workflow kernel now owns retry limits; this writer only reports old data.
  const recordedFixLoops = verification?.review?.fixLoops;
  const fixLoops = verification
    ? (typeof recordedFixLoops === 'number' && recordedFixLoops >= 0 ? recordedFixLoops : 0)
    : null;
  if (!verification) add('fix_loops', 'verification.json absent - no recorded review.fixLoops value');

  const session = sessionDir ? loadJson(path.join(sessionDir, 'session.json')) : null;
  const wallTimeMs = sessionWallTimeMs(session);
  if (wallTimeMs == null) {
    add('wall_time_ms', session
      ? 'session.json has no usable created_at/completed_at pair'
      : 'session.json absent - no session start/end timestamps');
  }

  const timing = readAgents(repo);
  if (timing.reason) add('agents', timing.reason);

  const reviewComments =
    pr.reviews == null && pr.comments == null ? null : (pr.reviews || 0) + (pr.comments || 0);
  if (reviewComments == null) add('review_comments', pr.reason || 'gh returned no reviews/comments');

  return {
    _meta: {
      writtenAt: new Date().toISOString(),
      phase: 'outcome',
      producer: 'scripts/outcome-write.js',
      version: 1,
    },
    ticket,
    repo,
    branch,
    pr_url: pr.url,
    pr_state: pr.state,
    verified: verdict,
    fix_loops: fixLoops,
    review_comments: reviewComments,
    wall_time_ms: wallTimeMs,
    agents: timing.agents,
    agents_pairing: timing.pairing,
    unresolved,
  };
}

/** True when `record.pr_state` is a legal value of the closed enum. */
function validPrState(record) {
  return record.pr_state === null || PR_STATE.includes(record.pr_state);
}

function usageError(msg) {
  return new PhantomError(msg, 'VALIDATION_ERROR');
}

function parseArgs(argv) {
  const opts = { ticket: null, repoPath: process.cwd(), out: null, noGh: false, dryRun: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ticket') opts.ticket = argv[++i];
    else if (a === '--repo-path') opts.repoPath = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--no-gh') opts.noGh = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') return { ...opts, help: true };
    else throw usageError('unknown option: ' + a);
  }
  if (!opts.ticket || !opts.ticket.trim()) throw usageError('--ticket is required');
  return opts;
}

function printHuman(record, target) {
  const w = (s) => process.stdout.write(s + '\n');
  w('outcome: ' + record.ticket + ' @ ' + record.repo);
  w('  pr_state       ' + (record.pr_state === null ? 'null' : record.pr_state));
  w('  pr_url         ' + (record.pr_url || 'null'));
  w('  verified       ' + (record.verified || 'null'));
  w('  fix_loops      ' + (record.fix_loops === null ? 'null' : record.fix_loops));
  w('  review_comments ' + (record.review_comments === null ? 'null' : record.review_comments));
  w('  wall_time_ms   ' + (record.wall_time_ms === null ? 'null' : record.wall_time_ms));
  w('  agents         ' + (record.agents ? record.agents.length + ' entries, pairing ' + record.agents_pairing : 'null'));
  w('  unresolved[' + record.unresolved.length + ']');
  for (const u of record.unresolved) w('    ' + u.field + ': ' + u.reason);
  w(target ? 'wrote: ' + target : 'dry run: nothing written');
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write('outcome-write: ' + e.message + '\n' + USAGE);
    process.exitCode = exitCodeForError(e);
    return;
  }
  if (opts.help) {
    process.stdout.write(USAGE + '\npr_state is a closed enum: ' + PR_STATE.join(' | ') + '\n');
    process.exitCode = 0;
    return;
  }

  const record = deriveOutcome(opts);
  if (!validPrState(record)) {
    throw new PhantomError(
      'refusing to write: pr_state ' + JSON.stringify(record.pr_state) + ' is outside the closed enum',
      'VALIDATION_ERROR',
    );
  }

  let target = null;
  if (!opts.dryRun) {
    const sessionDir = resolveSessionDir(record.ticket, record.repo);
    target = opts.out || (sessionDir ? path.join(sessionDir, 'outcome.json') : null);
    if (!target) {
      throw new PhantomError(
        'no session dir for ' + record.ticket + ' and no --out given - nothing to write to',
        'VALIDATION_ERROR',
      );
    }
    atomicWrite(target, JSON.stringify(record, null, 2) + '\n');
  }

  if (opts.json) process.stdout.write(JSON.stringify(record, null, 2) + '\n');
  else printHuman(record, target);
  process.exitCode = 0;
}

module.exports = { deriveOutcome, ghStateToEnum, validPrState, PR_STATE, main };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    reportError(err);
  }
}
