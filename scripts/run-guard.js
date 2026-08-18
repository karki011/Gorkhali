#!/usr/bin/env node
// Author: Subash Karki
// run-guard.js - unattended-run safety check: spend ceiling + stuck detection.
//
// WHY THIS EXISTS: commands/loop.md runs FULLY AUTONOMOUSLY for solid-AC tickets -
// it auto-approves the plan gate, chains verify -> fix -> wrap to a ready-for-review PR, and
// never asks the user a question. Before this script there was no dollar ceiling
// anywhere in the repo, so a thrashing unattended run had no ceiling and no honest
// halt. This is that ceiling.
//
// SEPARATION OF CONCERNS: the DECISION is hooks/loop-controller.js (pure, tested,
// already the loop authority). This file is only its I/O shell - observe spend,
// read the failure-class history, record the halt. No decision logic lives here.
//
// BINDS UNATTENDED RUNS ONLY. Without --unattended (or PHANTOM_UNATTENDED=1) this
// script reports and exits 0 without writing anything: an interactive session has a
// human watching and the human is the ceiling. Passing the flag is the same
// authorization model as commands/loop.md:12 - invoking it IS the authorization.
//
// FAIL-OPEN POLARITY, and where it deliberately stops:
//   exit 0 (continue) - not unattended, under ceiling, spend UNKNOWN, or ANY
//                       internal failure of this guard. A broken guard must never
//                       trap a run.
//   exit 1 (halt)     - CONFIRMED at/over the ceiling, or a confirmed no-progress
//                       repeat. The only non-open branch, and only because a
//                       confirmed overage is the absence of ambiguity.
//   exit 2 (usage)    - caller bug (bad flags). Callers must halt ONLY on 1.
// The honest cost of that polarity: an unreadable cost ledger means an uncapped
// run. This guard says so in its output rather than implying a guarantee it cannot
// make - see the `spend` line it prints.
//
// Usage:
//   node scripts/run-guard.js --ticket <T> [--repo <name>] [--repo-path <path>]
//                             [--unattended] [--spend-usd <N>] [--ceiling-usd <N>]
//                             [--json] [--dry-run]

'use strict';

const fs = require('fs');
const path = require('path');
const { sessionsDir, detectRepo } = require('./lib/phantom-paths');
const { atomicWrite } = require('./lib/atomic');
const { PhantomError, exitCodeForError, VALIDATION_ERROR } = require('./lib/axi-error');
const loopController = require('../hooks/loop-controller');

const USAGE =
  'usage: node scripts/run-guard.js --ticket <T> [--repo <name>] [--repo-path <path>] ' +
  '[--unattended] [--spend-usd <N>] [--ceiling-usd <N>] [--json] [--dry-run]\n';

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (_) {
    return null;
  }
}

// An unattended run is IN FLIGHT, so only the live session dir applies - a run
// cannot be guarded after close.md archived it.
function sessionDirFor(ticket, repo) {
  const dir = path.join(sessionsDir(repo), ticket);
  return fs.existsSync(dir) ? dir : null;
}

/**
 * Observe spend for this ticket. Returns { usd, source, reason } where usd is a
 * NUMBER or null - never 0 standing in for unknown. --spend-usd short-circuits the
 * transcript read: it is how a caller that already measured spend (and how a test)
 * supplies the number, so the ceiling is provable without synthesizing transcripts.
 */
async function observeSpend(opts, repo) {
  if (opts.spendUsd !== null) {
    return { usd: opts.spendUsd, source: 'caller-supplied (--spend-usd)', reason: null };
  }
  try {
    const { spendForTicket } = require('./cost-report');
    const spend = await spendForTicket(opts.ticket, repo);
    return {
      usd: typeof spend.usd === 'number' ? spend.usd : null,
      source: 'cost-report transcripts',
      reason: spend.reason,
    };
  } catch (err) {
    // Cannot read spend -> unknown, which ALLOWS. Recorded, never fabricated.
    return { usd: null, source: 'cost-report transcripts', reason: 'spend read failed: ' + err.message };
  }
}

/**
 * Evaluate the guard. Pure-ish: reads state, returns the decision + what it saw.
 * The halt decision itself is loop-controller.unattendedHalt().
 */
async function evaluate(opts) {
  const repoPath = path.resolve(opts.repoPath || process.cwd());
  const repo = opts.repo || detectRepo(repoPath);
  const sessionDir = sessionDirFor(opts.ticket, repo);

  const spend = await observeSpend(opts, repo);

  // Failure-class history rides the SAME field the fix loop uses
  // (verification.json review.classHistory / review.lastAttempt.class). No
  // parallel stuck-state file: if verify has not run, there is no history and the
  // stuck check simply has nothing to fire on. HONEST LIMIT: no live path writes
  // those fields, so the stuck branch is currently inert and the spend ceiling is
  // what this guard actually enforces. The loop count below does not share that
  // limit - it reads the review round ledger the portable flow writes.
  const verification = sessionDir ? loadJson(path.join(sessionDir, 'verification.json')) : null;
  const review = (verification && verification.review) || {};
  const classHistory = Array.isArray(review.classHistory) ? review.classHistory : [];
  const currentClass = (review.lastAttempt && review.lastAttempt.class) || null;

  const roundsLedger = sessionDir ? loadJson(path.join(sessionDir, 'reviews', 'rounds.json')) : null;
  const rounds = roundsLedger && Array.isArray(roundsLedger.rounds) ? roundsLedger.rounds : null;
  const loopState = loopController.resolveFixLoops({ rounds, verification });

  const decision = loopController.unattendedHalt({
    unattended: opts.unattended,
    spendUsd: spend.usd,
    spendCeilingUsd: opts.ceilingUsd,
    currentClass,
    classHistory,
  });

  return {
    repo,
    sessionDir,
    spend,
    fixLoops: loopState.source === 'none' ? null : loopState.loops,
    decision,
  };
}

/** The halt record. Written ONLY on a halt, atomically, in the session dir. */
function haltRecord(opts, result) {
  const { decision, spend } = result;
  return {
    _meta: {
      writtenAt: new Date().toISOString(),
      phase: 'run-guard',
      producer: 'scripts/run-guard.js',
      version: 1,
    },
    ticket: opts.ticket,
    repo: result.repo,
    state: decision.state,
    reason: decision.reason,
    observed: {
      spend_usd: decision.observed.spendUsd,
      spend_ceiling_usd: decision.observed.spendCeilingUsd,
      spend_source: spend.source,
      spend_unresolved: spend.usd === null ? spend.reason || 'spend not determinable' : null,
      repeated_class: decision.observed.repeatedClass,
      repeat_occurrences: decision.observed.repeatOccurrences,
      stuck_limit: decision.observed.stuckLimit,
      fix_loops: result.fixLoops,
    },
  };
}

function usageError(msg) {
  return new PhantomError(msg, VALIDATION_ERROR);
}

function parseArgs(argv) {
  const opts = {
    ticket: null,
    repo: null,
    repoPath: process.cwd(),
    unattended: process.env.PHANTOM_UNATTENDED === '1',
    spendUsd: null,
    ceilingUsd: loopController.SPEND_CEILING_USD,
    json: false,
    dryRun: false,
    help: false,
  };
  const num = (raw, flag) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw usageError(flag + ' requires a non-negative number');
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ticket') opts.ticket = argv[++i];
    else if (a === '--repo') opts.repo = argv[++i];
    else if (a === '--repo-path') opts.repoPath = argv[++i];
    else if (a === '--unattended') opts.unattended = true;
    else if (a === '--spend-usd') opts.spendUsd = num(argv[++i], '--spend-usd');
    else if (a === '--ceiling-usd') opts.ceilingUsd = num(argv[++i], '--ceiling-usd');
    else if (a === '--json') opts.json = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') return { ...opts, help: true };
    else throw usageError('unknown option: ' + a);
  }
  if (!opts.ticket || !opts.ticket.trim()) throw usageError('--ticket is required');
  return opts;
}

function printHuman(opts, result, written) {
  const w = (s) => process.stdout.write(s + '\n');
  const { decision, spend } = result;
  w('run-guard: ' + opts.ticket + ' @ ' + result.repo);
  w('  mode      ' + (opts.unattended ? 'unattended (capped)' : 'interactive (NOT capped - the human is the ceiling)'));
  w('  spend     ' +
    (decision.observed.spendUsd === null
      ? 'unknown (' + (spend.reason || 'no reason given') + ') - CANNOT CAP, run continues uncapped'
      : '$' + decision.observed.spendUsd.toFixed(2) + ' of $' + decision.observed.spendCeilingUsd.toFixed(2) +
        ' ceiling [' + spend.source + ']'));
  w('  stuck     ' +
    (decision.observed.repeatedClass
      ? "'" + decision.observed.repeatedClass + "' x" + decision.observed.repeatOccurrences +
        ' (limit ' + decision.observed.stuckLimit + ')'
      : 'no failure-class history'));
  w('  fix_loops ' + (result.fixLoops === null ? 'null (verify has not run)' : result.fixLoops));
  w('state: ' + (decision.state || 'running'));
  w('reason: ' + decision.reason);
  if (decision.halt) w(written ? 'halt recorded: ' + written : 'halt NOT recorded: ' + (opts.dryRun ? 'dry run' : 'no session dir'));
}

async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write('run-guard: ' + e.message + '\n' + USAGE);
    return exitCodeForError(e);
  }
  if (opts.help) {
    process.stdout.write(
      USAGE +
      '\nExit codes: 0 = continue, 1 = HALTED (' + loopController.HALT_STATES.join(' | ') + '), 2 = usage.\n' +
      'Halt states are recorded in <session>/halt.json and surface as outcome.json run_state.\n');
    return 0;
  }

  const result = await evaluate(opts);
  let written = null;
  if (result.decision.halt && !opts.dryRun && result.sessionDir) {
    const target = path.join(result.sessionDir, 'halt.json');
    atomicWrite(target, JSON.stringify(haltRecord(opts, result), null, 2) + '\n');
    written = target;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ...haltRecord(opts, result), halt: result.decision.halt, written }, null, 2) + '\n');
  } else {
    printHuman(opts, result, written);
  }
  return result.decision.halt ? 1 : 0;
}

module.exports = { evaluate, haltRecord, main };

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      // FAIL OPEN: a bug in the guard itself must not stop a run. Loud on stderr,
      // exit 0. Only a CONFIRMED overage/repeat is allowed to produce exit 1.
      process.stderr.write('run-guard failed open (run continues): ' + ((err && err.stack) || err) + '\n');
      process.exitCode = 0;
    });
}
