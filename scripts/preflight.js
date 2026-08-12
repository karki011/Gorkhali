#!/usr/bin/env node
// Author: Subash Karki
// preflight.js — report-only go/no-go gate for a ticket run.
//
// REPORT-ONLY: this script has NO side effects — it runs the gates and prints
// the verdict. queue.md Step 3b calls it as a per-ticket readiness check.
//
// Usage:
//   phantom-preflight --ticket <T> [--repo <path>] [--max-files <N>]
//                     [--strict-jira] [--json]
//
// Exit codes: 0 = all gates pass; 1 = any gate fails; 2 = usage/env error.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { phantomData, stateDir, sessionsDir, detectRepo } = require('./lib/phantom-paths');
const { PREFLIGHT_MAX_FILES, MARKER_FRESHNESS_MS } = require('./lib/constants');
const { PhantomError, exitCodeForError, reportError } = require('./lib/axi-error');
const markerState = require('../hooks/blade-marker-state');

// Staleness window for the current-session collision marker.
const FRESH_WINDOW_MS = MARKER_FRESHNESS_MS;

const USAGE =
  'usage: phantom-preflight --ticket <T> [--repo <path>] [--max-files <N>] ' +
  '[--strict-jira] [--json]\n';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (_) {
    return null;
  }
}

// Mirror hooks/feature-branch-gate.sh: PHANTOM_PROTECTED_BRANCHES env (comma /
// pipe / space separated) > default "main master develop".
function protectedBranches() {
  const raw = process.env.PHANTOM_PROTECTED_BRANCHES;
  const list = raw ? raw.split(/[,|\s]+/).filter(Boolean) : [];
  return list.length ? list : ['main', 'master', 'develop'];
}

function checkWorktreeClean(repoPath) {
  let out;
  try {
    out = git(['status', '--porcelain'], repoPath);
  } catch (err) {
    return { status: 'fail', detail: 'git status failed: ' + err.message };
  }
  const dirty = out.split('\n').filter(Boolean);
  return dirty.length === 0
    ? { status: 'pass', detail: 'worktree clean' }
    : { status: 'fail', detail: dirty.length + ' dirty path(s) in worktree' };
}

function checkBranch(repoPath) {
  let branch = '';
  try {
    branch = git(['branch', '--show-current'], repoPath).trim();
  } catch (_) { /* fail open below, mirroring the gate hook */ }
  if (!branch) {
    return { status: 'pass', detail: 'no current branch (detached HEAD) — gate not applicable' };
  }
  // Auto-detected default branch (fail-open: empty if origin/HEAD unset).
  let detected = '';
  try {
    detected = git(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoPath)
      .trim()
      .replace(/^refs\/remotes\/origin\//, '');
  } catch (_) { /* no remote — fine */ }
  const protectedSet = new Set(protectedBranches());
  if (detected) protectedSet.add(detected);
  return protectedSet.has(branch)
    ? { status: 'fail', detail: "on protected branch '" + branch + "'" }
    : { status: 'pass', detail: "on feature branch '" + branch + "'" };
}

function checkSessionCollision(repo, ticket, repoPath) {
  if (markerState.freshMarkers(repoPath).length > 0) {
    return { status: 'fail', detail: '.blade-editing.d contains a live editing agent' };
  }
  if (markerState.legacyActive(repoPath)) {
    return { status: 'fail', detail: '.blade-editing present — a Blade is mid-edit' };
  }
  const markerPath = path.join(stateDir(), 'current-session', repo + '.json');
  let st;
  try {
    st = fs.statSync(markerPath);
  } catch (_) {
    return { status: 'pass', detail: 'no active session marker' };
  }
  if (Date.now() - st.mtimeMs >= FRESH_WINDOW_MS) {
    return { status: 'pass', detail: 'session marker stale (>12h)' };
  }
  const marker = loadJson(markerPath) || {};
  if (marker.ticket && marker.ticket !== ticket) {
    return {
      status: 'fail',
      detail: 'fresh session marker references different ticket ' + marker.ticket,
    };
  }
  return { status: 'pass', detail: 'fresh session marker does not reference another ticket' };
}

function checkBlastRadius(repo, ticket, maxFiles) {
  const planPath = path.join(sessionsDir(repo), ticket, 'plan.json');
  if (!fs.existsSync(planPath)) {
    return { status: 'fail', detail: 'plan.json missing — no plan, no autonomous run' };
  }
  const plan = loadJson(planPath);
  if (!plan || !Array.isArray(plan.tasks)) {
    return { status: 'fail', detail: 'plan.json unparseable or missing tasks[] — no plan, no autonomous run' };
  }
  const files = new Set();
  for (const t of plan.tasks) {
    if (t && Array.isArray(t.files)) for (const f of t.files) files.add(f);
  }
  return files.size > maxFiles
    ? { status: 'fail', detail: files.size + ' unique plan files exceeds max ' + maxFiles }
    : { status: 'pass', detail: files.size + ' unique plan files within max ' + maxFiles };
}

function checkJira(ticket, strictJira) {
  const cmd = process.env.PHANTOM_JIRA_CHECK_CMD;
  if (cmd && cmd.trim()) {
    const res = spawnSync('/bin/sh', ['-c', cmd + ' "$1"', 'phantom-preflight-jira', ticket], {
      encoding: 'utf-8',
    });
    return res.status === 0
      ? { status: 'pass', detail: 'jira provider exited 0' }
      : { status: 'fail', detail: 'jira provider exited ' + (res.status === null ? 'on signal' : res.status) };
  }
  if (strictJira) {
    return { status: 'fail', detail: 'no jira provider configured and --strict-jira set' };
  }
  return { status: 'skip', detail: 'no jira provider configured (PHANTOM_JIRA_CHECK_CMD unset)', stubbed: true };
}

/**
 * Run all preflight gates. Throws Error with code 'ENOTGIT' if repoPath is not
 * inside a git repo. Report-only — no side effects.
 */
function runPreflight(opts) {
  const repoPath = path.resolve(opts.repoPath || process.cwd());
  try {
    git(['rev-parse', '--git-dir'], repoPath);
  } catch (_) {
    const e = new Error('not a git repository: ' + repoPath);
    e.code = 'ENOTGIT';
    throw e;
  }

  const ticket = opts.ticket;
  const repo = detectRepo(repoPath);
  const maxFiles = opts.maxFiles != null ? opts.maxFiles : PREFLIGHT_MAX_FILES;

  const checks = {
    worktreeClean: checkWorktreeClean(repoPath),
    branch: checkBranch(repoPath),
    sessionCollision: checkSessionCollision(repo, ticket, repoPath),
    blastRadius: checkBlastRadius(repo, ticket, maxFiles),
    jira: checkJira(ticket, !!opts.strictJira),
  };
  const verdict = Object.values(checks).some((c) => c.status === 'fail') ? 'fail' : 'pass';

  return { ticket, repo, ts: new Date().toISOString(), checks, verdict };
}

// Usage errors are VALIDATION_ERROR-class -> exitCodeForError maps them to 2,
// preserving preflight's historical usage exit code.
function usageError(msg) {
  return new PhantomError(msg, 'VALIDATION_ERROR');
}

function parseArgs(argv) {
  const opts = {
    ticket: null,
    repoPath: process.cwd(),
    maxFiles: null,
    strictJira: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ticket') opts.ticket = argv[++i];
    else if (a === '--repo') opts.repoPath = argv[++i];
    else if (a === '--max-files') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0) throw usageError('--max-files requires a non-negative integer');
      opts.maxFiles = n;
    } else if (a === '--strict-jira') opts.strictJira = true;
    else if (a === '--json') opts.json = true;
    else throw usageError('unknown option: ' + a);
  }
  if (!opts.ticket || !opts.ticket.trim()) throw usageError('--ticket is required');
  return opts;
}

function printHuman(result) {
  process.stdout.write('preflight: ' + result.ticket + ' @ ' + result.repo + '\n');
  for (const [name, check] of Object.entries(result.checks)) {
    process.stdout.write(
      '  ' + name.padEnd(18) + check.status.toUpperCase().padEnd(6) + check.detail + '\n'
    );
  }
  process.stdout.write('verdict: ' + result.verdict + '\n');
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write('preflight: ' + e.message + '\n' + USAGE);
    process.exitCode = exitCodeForError(e);
    return;
  }

  let result;
  try {
    result = runPreflight(opts);
  } catch (e) {
    if (e.code === 'ENOTGIT') {
      process.stderr.write('preflight: ' + e.message + '\n');
      process.exitCode = 2;
      return;
    }
    throw e;
  }

  if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else printHuman(result);
  process.exitCode = result.verdict === 'pass' ? 0 : 1;
}

module.exports = { runPreflight, main };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    reportError(err);
  }
}
