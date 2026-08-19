// Author: Subash Karki
// preflight.test.js — gate-by-gate coverage for scripts/preflight.js, proven by
// spawning the REAL CLI against throwaway tmpdir git repos. Report-only: the
// script has no side effects.
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

test('.engineer-editing present: collision fails', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    writePlan(data, repo, ['a.ts']);
    fs.writeFileSync(path.join(data, '.engineer-editing'), '');
    const res = cli(['--ticket', TICKET, '--repo', repo], data);
    const out = parse(res);
    assert.equal(res.status, 1);
    assert.equal(out.checks.sessionCollision.status, 'fail');
  } finally {
    cleanup(repo, data);
  }
});

test('fresh repo-scoped editing marker collides; stale marker is report-only and ignored', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    writePlan(data, repo, ['a.ts']);
    const env = { PHANTOM_REPO: path.basename(repo) };
    const dir = path.join(data, '.engineer-editing.d', path.basename(repo));
    fs.mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, 'agent-1');
    fs.writeFileSync(marker, JSON.stringify({
      id: 'agent-1', name: 'engineer-varek', sessionId: 's1', repo: path.basename(repo),
    }));
    let res = cli(['--ticket', TICKET, '--repo', repo], data, env);
    assert.equal(parse(res).checks.sessionCollision.status, 'fail');
    fs.utimesSync(marker, new Date(0), new Date(0));
    res = cli(['--ticket', TICKET, '--repo', repo], data, env);
    assert.equal(parse(res).checks.sessionCollision.status, 'pass');
    assert.equal(fs.existsSync(marker), true, 'preflight must not delete stale markers');
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

test('report-only: a pass run has no side effects (no marker, no unattended dir)', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    writePlan(data, repo, ['a.ts']);
    const res = cli(['--ticket', TICKET, '--repo', repo], data);
    assert.equal(res.status, 0);
    assert.equal(parse(res).armed, undefined, 'no armed field — arming is gone');
    assert.ok(
      !fs.existsSync(path.join(data, 'state', 'unattended')),
      'report-only run writes nothing under state/'
    );
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
