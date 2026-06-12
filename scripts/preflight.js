#!/usr/bin/env node
// Author: Subash Karki
// preflight.js — go/no-go gate for autonomous (unattended) ticket runs.
//
// REPORT-ONLY BY DEFAULT: this script writes NOTHING unless --arm is passed
// AND every gate passes. The arming marker <stateDir>/unattended/<repo>.json
// is the contract with the unattended gate hook: the hook reads ONLY the
// `worktreeRoot` field and uses the marker file's MTIME for its 12h freshness
// window — so worktreeRoot must be the realpath of the repo root, and
// (re)writing the marker refreshes the window.
//
// Usage:
//   phantom-preflight --ticket <T> [--repo <path>] [--max-files <N>]
//                     [--strict-jira] [--json] [--arm]
//
// Exit codes: 0 = all gates pass; 1 = any gate fails; 2 = usage/env error.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { phantomData, stateDir, sessionsDir, detectRepo } = require('./lib/phantom-paths');
const { PREFLIGHT_MAX_FILES, MARKER_FRESHNESS_MS } = require('./lib/constants');

// Matches the gate hook's freshness window for both collision and arming markers.
const FRESH_WINDOW_MS = MARKER_FRESHNESS_MS;

const USAGE =
  'usage: phantom-preflight --ticket <T> [--repo <path>] [--max-files <N>] ' +
  '[--strict-jira] [--json] [--arm]\n';

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

function checkSessionCollision(repo, ticket) {
  const bladeEditing = path.join(phantomData(), '.blade-editing');
  if (fs.existsSync(bladeEditing)) {
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
 * inside a git repo. Writes the arming marker ONLY when opts.arm is true AND
 * the verdict is pass — otherwise this function has no side effects.
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
    sessionCollision: checkSessionCollision(repo, ticket),
    blastRadius: checkBlastRadius(repo, ticket, maxFiles),
    jira: checkJira(ticket, !!opts.strictJira),
  };
  const verdict = Object.values(checks).some((c) => c.status === 'fail') ? 'fail' : 'pass';

  // ARMING POLARITY: the ONLY write in this script. Explicit --arm AND a pass
  // verdict are both required; --arm on a fail verdict writes nothing.
  let armed = false;
  if (opts.arm === true && verdict === 'pass') {
    const markerDir = path.join(stateDir(), 'unattended');
    fs.mkdirSync(markerDir, { recursive: true });
    const marker = {
      worktreeRoot: fs.realpathSync(repoPath),
      ticket,
      ts: new Date().toISOString(),
    };
    // Plain write (no atomic-rename dance): the gate hook keys its 12h window
    // off this file's mtime, and every (re)write must refresh it.
    fs.writeFileSync(path.join(markerDir, repo + '.json'), JSON.stringify(marker, null, 2) + '\n');
    armed = true;
  }

  return { ticket, repo, ts: new Date().toISOString(), checks, verdict, armed };
}

function usageError(msg) {
  const e = new Error(msg);
  e.code = 'EUSAGE';
  return e;
}

function parseArgs(argv) {
  const opts = {
    ticket: null,
    repoPath: process.cwd(),
    maxFiles: null,
    strictJira: false,
    json: false,
    arm: false,
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
    else if (a === '--arm') opts.arm = true;
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
  process.stdout.write(
    'verdict: ' + result.verdict + (result.armed ? ' (armed for unattended run)' : '') + '\n'
  );
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write('preflight: ' + e.message + '\n' + USAGE);
    process.exit(2);
  }

  let result;
  try {
    result = runPreflight(opts);
  } catch (e) {
    if (e.code === 'ENOTGIT') {
      process.stderr.write('preflight: ' + e.message + '\n');
      process.exit(2);
    }
    throw e;
  }

  if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else printHuman(result);
  process.exit(result.verdict === 'pass' ? 0 : 1);
}

module.exports = { runPreflight, main };

if (require.main === module) main();
