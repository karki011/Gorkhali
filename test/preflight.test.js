// Author: Subash Karki
// preflight.test.js — gate-by-gate coverage for scripts/preflight.js, with the
// arming polarity (report-only default, marker ONLY on --arm + pass) proven by
// spawning the REAL CLI against throwaway tmpdir git repos.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'preflight.js');
const TICKET = 'CZ-100';

// Throwaway git fixture: one commit on a non-protected branch by default.
function mkRepo(branch = 'feat/preflight-fixture') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-repo-'));
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync(
    'git',
    ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-qm', 'init'],
    { cwd: dir }
  );
  return dir;
}

function mkData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-data-'));
}

function writePlan(dataDir, repoDir, files, ticket = TICKET) {
  const repoName = path.basename(repoDir);
  const planDir = path.join(dataDir, 'repos', repoName, 'sessions', ticket);
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(
    path.join(planDir, 'plan.json'),
    JSON.stringify({ tasks: [{ id: 'T1', files }] }, null, 2)
  );
}

// Spawn the real CLI. Env is isolated: PHANTOM_DATA pinned to the fixture,
// ambient phantom overrides stripped so host state can't leak in.
function cli(args, dataDir, extraEnv = {}) {
  const env = { ...process.env, PHANTOM_DATA: dataDir, ...extraEnv };
  delete env.PHANTOM_REPO;
  delete env.PHANTOM_PROTECTED_BRANCHES;
  delete env.PHANTOM_JIRA_CHECK_CMD;
  delete env.PHANTOM_PREFLIGHT_MAX_FILES;
  return spawnSync('node', [SCRIPT, ...args, '--json'], { encoding: 'utf-8', env });
}

function parse(res) {
  try {
    return JSON.parse(res.stdout);
  } catch (e) {
    assert.fail('CLI did not emit JSON. stdout: ' + res.stdout + '\nstderr: ' + res.stderr);
  }
}

function markerPath(dataDir, repoDir) {
  return path.join(dataDir, 'state', 'unattended', path.basename(repoDir) + '.json');
}

function cleanup(...dirs) {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

test('all gates green: verdict pass, exit 0', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    writePlan(data, repo, ['a.ts', 'b.ts']);
    const res = cli(['--ticket', TICKET, '--repo', repo], data);
    const out = parse(res);
    assert.equal(res.status, 0, 'exit 0. stderr: ' + res.stderr);
    assert.equal(out.verdict, 'pass');
    assert.equal(out.checks.worktreeClean.status, 'pass');
    assert.equal(out.checks.branch.status, 'pass');
    assert.equal(out.checks.sessionCollision.status, 'pass');
    assert.equal(out.checks.blastRadius.status, 'pass');
    assert.equal(out.checks.jira.status, 'skip');
    assert.equal(out.armed, false);
  } finally {
    cleanup(repo, data);
  }
});

test('dirty worktree: worktreeClean fails, exit 1', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    writePlan(data, repo, ['a.ts']);
    fs.appendFileSync(path.join(repo, 'README.md'), 'dirty\n');
    const res = cli(['--ticket', TICKET, '--repo', repo], data);
    const out = parse(res);
    assert.equal(res.status, 1);
    assert.equal(out.verdict, 'fail');
    assert.equal(out.checks.worktreeClean.status, 'fail');
  } finally {
    cleanup(repo, data);
  }
});

test('protected branch (main): branch check fails', () => {
  const repo = mkRepo('main');
  const data = mkData();
  try {
    writePlan(data, repo, ['a.ts']);
    const res = cli(['--ticket', TICKET, '--repo', repo], data);
    const out = parse(res);
    assert.equal(res.status, 1);
    assert.equal(out.checks.branch.status, 'fail');
  } finally {
    cleanup(repo, data);
  }
});

test('fresh session marker for a DIFFERENT ticket: collision fails', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    writePlan(data, repo, ['a.ts']);
    const sessDir = path.join(data, 'state', 'current-session');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessDir, path.basename(repo) + '.json'),
      JSON.stringify({ session_id: 'other-sess', ticket: 'CZ-999' })
    );
    const res = cli(['--ticket', TICKET, '--repo', repo], data);
    const out = parse(res);
    assert.equal(res.status, 1);
    assert.equal(out.checks.sessionCollision.status, 'fail');
  } finally {
    cleanup(repo, data);
  }
});

test('.blade-editing present: collision fails', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    writePlan(data, repo, ['a.ts']);
    fs.writeFileSync(path.join(data, '.blade-editing'), '');
    const res = cli(['--ticket', TICKET, '--repo', repo], data);
    const out = parse(res);
    assert.equal(res.status, 1);
    assert.equal(out.checks.sessionCollision.status, 'fail');
  } finally {
    cleanup(repo, data);
  }
});

test('plan.json missing: blastRadius fails (fail-safe)', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    const res = cli(['--ticket', TICKET, '--repo', repo], data);
    const out = parse(res);
    assert.equal(res.status, 1);
    assert.equal(out.checks.blastRadius.status, 'fail');
  } finally {
    cleanup(repo, data);
  }
});

test('plan files over --max-files: blastRadius fails', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    writePlan(data, repo, ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']);
    const res = cli(['--ticket', TICKET, '--repo', repo, '--max-files', '3'], data);
    const out = parse(res);
    assert.equal(res.status, 1);
    assert.equal(out.checks.blastRadius.status, 'fail');
  } finally {
    cleanup(repo, data);
  }
});

test('POLARITY: pass WITHOUT --arm writes no marker (report-only default)', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    writePlan(data, repo, ['a.ts']);
    const res = cli(['--ticket', TICKET, '--repo', repo], data);
    assert.equal(res.status, 0);
    assert.equal(parse(res).armed, false);
    assert.ok(!fs.existsSync(markerPath(data, repo)), 'no arming marker without --arm');
    assert.ok(
      !fs.existsSync(path.join(data, 'state', 'unattended')),
      'unattended dir is not even created in report-only mode'
    );
  } finally {
    cleanup(repo, data);
  }
});

test('POLARITY: --arm + pass writes marker with realpath worktreeRoot; rewrite refreshes mtime', async () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    writePlan(data, repo, ['a.ts']);
    const res = cli(['--ticket', TICKET, '--repo', repo, '--arm'], data);
    assert.equal(res.status, 0);
    assert.equal(parse(res).armed, true);

    const marker = markerPath(data, repo);
    assert.ok(fs.existsSync(marker), 'arming marker written');
    const body = JSON.parse(fs.readFileSync(marker, 'utf-8'));
    assert.equal(body.worktreeRoot, fs.realpathSync(repo), 'worktreeRoot is the repo realpath');
    assert.equal(body.ticket, TICKET);
    assert.ok(body.ts, 'marker carries an ISO timestamp');

    // Gate-hook contract: re-arming must refresh the marker mtime (12h window).
    const before = fs.statSync(marker).mtimeMs;
    await new Promise((r) => setTimeout(r, 50));
    const res2 = cli(['--ticket', TICKET, '--repo', repo, '--arm'], data);
    assert.equal(res2.status, 0);
    assert.ok(fs.statSync(marker).mtimeMs > before, 're-arm refreshes marker mtime');
  } finally {
    cleanup(repo, data);
  }
});

test('jira stub: --strict-jira with no provider fails; without it, skip + stubbed + pass', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    writePlan(data, repo, ['a.ts']);

    const strict = cli(['--ticket', TICKET, '--repo', repo, '--strict-jira'], data);
    const strictOut = parse(strict);
    assert.equal(strict.status, 1);
    assert.equal(strictOut.checks.jira.status, 'fail');
    assert.ok(!fs.existsSync(markerPath(data, repo)), 'strict fail never arms');

    const lax = cli(['--ticket', TICKET, '--repo', repo], data);
    const laxOut = parse(lax);
    assert.equal(lax.status, 0);
    assert.equal(laxOut.verdict, 'pass');
    assert.equal(laxOut.checks.jira.status, 'skip');
    assert.equal(laxOut.checks.jira.stubbed, true, 'JSON records stubbed:true when no provider');
  } finally {
    cleanup(repo, data);
  }
});
