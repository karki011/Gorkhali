// Author: Subash Karki
// repo-detection.test.js — EXECUTED tests for the 6-step detectRepo precedence.
// Per [executed-review]: every git-backed branch RUNS real detection in real
// fixture repos (git init / remote add / worktree add), and asserts the JS and
// sh mirrors AGREE. The pure-path branches (PHANTOM_REPO, walk-up, no-git,
// worktrees fast-path) live in phantom-paths.test.js; here we cover the git
// steps (3, 4) the shell mirror gained and that need a real git binary.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const { detectRepo } = require('../scripts/lib/phantom-paths');
const SH_LIB = path.resolve(__dirname, '..', 'scripts', 'lib', 'phantom-paths.sh');

const HAS_GIT = (() => {
  try { execSync('git --version', { stdio: 'ignore' }); return true; } catch (_) { return false; }
})();

function mkTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// Deterministic git without depending on the caller's global config.
function git(cwd, args) {
  execSync(
    'git -c user.email=t@t -c user.name=t -c commit.gpgsign=false -c init.defaultBranch=main ' + args,
    { cwd, stdio: 'ignore' }
  );
}

// Run the sh mirror exactly as a sourced shell would, for the given cwd/env.
function shDetect(cwd, { data, repo } = {}) {
  const env = { ...process.env };
  env.PHANTOM_DATA = data || path.join(mkTmp('sh-nodata-'), 'empty');
  if (repo === undefined) delete env.PHANTOM_REPO;
  else env.PHANTOM_REPO = repo;
  const script = '. "' + SH_LIB + '"; phantom_detect_repo "' + cwd + '"';
  return execFileSync('sh', ['-c', script], { env, encoding: 'utf8' }).trim();
}

// JS detection with a scoped env (PHANTOM_DATA/PHANTOM_REPO), always restored.
function jsDetect(cwd, { data, repo } = {}) {
  const saved = { d: process.env.PHANTOM_DATA, r: process.env.PHANTOM_REPO };
  try {
    if (data === undefined) delete process.env.PHANTOM_DATA; else process.env.PHANTOM_DATA = data;
    if (repo === undefined) delete process.env.PHANTOM_REPO; else process.env.PHANTOM_REPO = repo;
    return detectRepo(cwd);
  } finally {
    if (saved.d === undefined) delete process.env.PHANTOM_DATA; else process.env.PHANTOM_DATA = saved.d;
    if (saved.r === undefined) delete process.env.PHANTOM_REPO; else process.env.PHANTOM_REPO = saved.r;
  }
}

// A data root whose worktrees/ subdir cannot contain the fixture → step 1 off.
function isolatedData() {
  return mkTmp('rd-data-');
}

test('step 3: git remote origin basename wins (js + sh agree)', { skip: !HAS_GIT }, () => {
  const repoDir = mkTmp('rd-remote-');
  const data = isolatedData();
  try {
    git(repoDir, 'init -q');
    git(repoDir, 'remote add origin git@github.com:Cloudzero/research-team-skills.git');
    const sub = path.join(repoDir, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });

    assert.equal(jsDetect(sub, { data }), 'research-team-skills', 'js: remote basename');
    assert.equal(shDetect(sub, { data }), 'research-team-skills', 'sh: remote basename');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('step 3: https remote and .git suffix both stripped', { skip: !HAS_GIT }, () => {
  const repoDir = mkTmp('rd-https-');
  const data = isolatedData();
  try {
    git(repoDir, 'init -q');
    git(repoDir, 'remote add origin https://github.com/org/my-cool-repo.git');
    assert.equal(jsDetect(repoDir, { data }), 'my-cool-repo');
    assert.equal(shDetect(repoDir, { data }), 'my-cool-repo');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('step 4: no remote -> main-root basename via git-common-dir (js + sh agree)', { skip: !HAS_GIT }, () => {
  const repoDir = mkTmp('rd-noremote-');
  const data = isolatedData();
  try {
    git(repoDir, 'init -q'); // no remote added
    const sub = path.join(repoDir, 'pkg');
    fs.mkdirSync(sub, { recursive: true });
    const expected = path.basename(repoDir);

    assert.equal(jsDetect(sub, { data }), expected, 'js: main-root basename');
    assert.equal(shDetect(sub, { data }), expected, 'sh: main-root basename');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('worktree WITH remote: detects the REPO not the branch (js + sh agree)', { skip: !HAS_GIT }, () => {
  const mainDir = mkTmp('rd-wt-main-');
  const wtParent = mkTmp('rd-wt-tree-');
  const data = isolatedData();
  try {
    git(mainDir, 'init -q');
    git(mainDir, 'remote add origin git@github.com:Cloudzero/research-team-skills.git');
    git(mainDir, 'commit -q --allow-empty -m init');
    const wt = path.join(wtParent, 'feature-branch');
    git(mainDir, 'worktree add -q "' + wt + '" -b feature-branch');
    // Sanity: the worktree marker is a .git FILE named after the branch dir —
    // a naive walk-up would return 'feature-branch'.
    assert.ok(fs.statSync(path.join(wt, '.git')).isFile(), 'worktree .git is a file');

    assert.equal(jsDetect(wt, { data }), 'research-team-skills', 'js: repo, not branch');
    assert.equal(shDetect(wt, { data }), 'research-team-skills', 'sh: repo, not branch');
  } finally {
    execSync('git -C "' + mainDir + '" worktree prune', { stdio: 'ignore' });
    fs.rmSync(wtParent, { recursive: true, force: true });
    fs.rmSync(mainDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('worktree WITHOUT remote: step 4 returns MAIN-root basename, not branch dir', { skip: !HAS_GIT }, () => {
  const mainDir = mkTmp('rd-wt2-main-');
  const wtParent = mkTmp('rd-wt2-tree-');
  const data = isolatedData();
  try {
    git(mainDir, 'init -q'); // no remote
    git(mainDir, 'commit -q --allow-empty -m init');
    const wt = path.join(wtParent, 'some-ticket');
    git(mainDir, 'worktree add -q "' + wt + '" -b some-ticket');
    const expected = path.basename(mainDir);

    assert.equal(jsDetect(wt, { data }), expected, 'js: main-root basename (worktree-safe)');
    assert.equal(shDetect(wt, { data }), expected, 'sh: main-root basename (worktree-safe)');
    assert.notEqual(jsDetect(wt, { data }), 'some-ticket', 'must NOT shard under the branch');
  } finally {
    execSync('git -C "' + mainDir + '" worktree prune', { stdio: 'ignore' });
    fs.rmSync(wtParent, { recursive: true, force: true });
    fs.rmSync(mainDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('PHANTOM_REPO (step 2) beats git remote (step 3)', { skip: !HAS_GIT }, () => {
  const repoDir = mkTmp('rd-envwins-');
  const data = isolatedData();
  try {
    git(repoDir, 'init -q');
    git(repoDir, 'remote add origin git@github.com:org/remote-name.git');
    assert.equal(jsDetect(repoDir, { data, repo: 'env-name' }), 'env-name');
    assert.equal(shDetect(repoDir, { data, repo: 'env-name' }), 'env-name');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('worktrees fast-path (step 1) beats git remote (step 3)', { skip: !HAS_GIT }, () => {
  const data = isolatedData();
  try {
    // cwd is under <data>/worktrees/<repo>/... AND is a git repo with a DIFFERENT
    // remote. Step 1 must win over step 3.
    const inside = path.join(data, 'worktrees', 'phantom-repo', 'T-9');
    fs.mkdirSync(inside, { recursive: true });
    git(inside, 'init -q');
    git(inside, 'remote add origin git@github.com:org/some-other-name.git');
    assert.equal(jsDetect(inside, { data }), 'phantom-repo', 'js: fast-path wins');
    assert.equal(shDetect(inside, { data }), 'phantom-repo', 'sh: fast-path wins');
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('git RUN fails -> degrades to walk-up without throwing (js + sh; [guards])', { skip: !HAS_GIT }, () => {
  const repoDir = mkTmp('rd-gitfail-');
  const data = isolatedData();
  // A `git` shim that ALWAYS exits nonzero — git is PRESENT (command -v finds it)
  // but every invocation fails. Proves the guard wraps the RUN, not just the
  // `command -v git` precondition. Prepended to PATH so coreutils still resolve.
  const shimBin = mkTmp('rd-gitfail-bin-');
  try {
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true }); // walk-up target
    const sub = path.join(repoDir, 'a');
    fs.mkdirSync(sub, { recursive: true });
    const shim = path.join(shimBin, 'git');
    fs.writeFileSync(shim, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(shim, 0o755);
    const shimPath = shimBin + path.delimiter + process.env.PATH;

    const savedPath = process.env.PATH;
    let jsResult;
    try {
      process.env.PATH = shimPath;
      assert.doesNotThrow(() => { jsResult = jsDetect(sub, { data }); });
    } finally {
      process.env.PATH = savedPath;
    }
    assert.equal(jsResult, path.basename(repoDir), 'js: walk-up when every git RUN fails');

    const out = execFileSync('/bin/sh', ['-c', '. "' + SH_LIB + '"; phantom_detect_repo "' + sub + '"'], {
      env: { ...process.env, PATH: shimPath, PHANTOM_DATA: data },
      encoding: 'utf8',
    }).trim();
    assert.equal(out, path.basename(repoDir), 'sh: walk-up when every git RUN fails');
  } finally {
    fs.rmSync(shimBin, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('step 6: no-git dir -> "_default" (sh, mirrors the js "/" case)', { skip: !HAS_GIT }, () => {
  const nogit = mkTmp('rd-default-'); // no .git anywhere up the tree
  const data = isolatedData();
  try {
    assert.equal(jsDetect(nogit, { data }), '_default', 'js: _default');
    assert.equal(shDetect(nogit, { data }), '_default', 'sh: _default');
  } finally {
    fs.rmSync(nogit, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('memoization: warm JS resolve is a cache hit (<10ms) after a cold git resolve', { skip: !HAS_GIT }, () => {
  const repoDir = mkTmp('rd-memo-');
  const data = isolatedData();
  try {
    git(repoDir, 'init -q');
    git(repoDir, 'remote add origin git@github.com:org/warm-repo.git');
    const t0 = process.hrtime.bigint();
    assert.equal(jsDetect(repoDir, { data }), 'warm-repo');
    const cold = Number(process.hrtime.bigint() - t0) / 1e6;
    const t1 = process.hrtime.bigint();
    assert.equal(jsDetect(repoDir, { data }), 'warm-repo');
    const warm = Number(process.hrtime.bigint() - t1) / 1e6;
    assert.ok(warm < 10, `warm resolve must be <10ms (was ${warm.toFixed(2)}ms; cold ${cold.toFixed(2)}ms)`);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});
