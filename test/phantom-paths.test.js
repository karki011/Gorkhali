// Author: Subash Karki
// phantom-paths.test.js — unit tests for the resolver API (detectRepo + dir resolution).
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const paths = require('../scripts/lib/phantom-paths');
const {
  detectRepo,
  learningsDir,
  sessionsDir,
  completedDir,
  globalPatternsDir,
  auditDir,
  repoDir,
  runsDir,
  runDir,
  currentRunPointer,
  worktreesRoot,
  worktreeDir,
} = paths;

// --- env helpers (set/restore around each assertion) ---
function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = Object.prototype.hasOwnProperty.call(process.env, key)
      ? process.env[key]
      : undefined;
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// Tmp tree bookkeeping — every mkdtemp gets cleaned in finally blocks below.
function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('detectRepo: PHANTOM_REPO env override wins (trimmed)', () => {
  withEnv({ PHANTOM_REPO: '  my-override-repo  ' }, () => {
    assert.equal(detectRepo('/literally/anywhere'), 'my-override-repo');
  });
});

test('detectRepo: empty/whitespace PHANTOM_REPO is ignored, falls through to walk-up', () => {
  const tmp = mkTmp('paths-empty-env-');
  try {
    fs.mkdirSync(path.join(tmp, '.git'), { recursive: true });
    const nested = path.join(tmp, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    withEnv({ PHANTOM_REPO: '   ' }, () => {
      // realpath: macOS tmpdir is a symlink (/var -> /private/var); compare basenames.
      assert.equal(detectRepo(nested), path.basename(fs.realpathSync(tmp)));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detectRepo: .git DIR walk-up returns top dir basename from nested subdir', () => {
  const tmp = mkTmp('paths-gitdir-');
  try {
    const top = fs.realpathSync(tmp);
    fs.mkdirSync(path.join(top, '.git'), { recursive: true });
    const sub = path.join(top, 'src', 'deep', 'nested');
    fs.mkdirSync(sub, { recursive: true });
    withEnv({ PHANTOM_REPO: undefined }, () => {
      assert.equal(detectRepo(sub), path.basename(top));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detectRepo: .git FILE (git worktree case) is also detected', () => {
  const tmp = mkTmp('paths-gitfile-');
  try {
    const top = fs.realpathSync(tmp);
    // git worktrees use a `.git` FILE ("gitdir: ..."), not a dir.
    fs.writeFileSync(path.join(top, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');
    const sub = path.join(top, 'pkg', 'lib');
    fs.mkdirSync(sub, { recursive: true });
    withEnv({ PHANTOM_REPO: undefined }, () => {
      assert.equal(detectRepo(sub), path.basename(top));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detectRepo: no .git anywhere up the tree -> "_default" (NOT basename of cwd)', () => {
  withEnv({ PHANTOM_REPO: undefined }, () => {
    // '/' has no .git up the tree; basename('/') would be '' — must be '_default'.
    assert.equal(detectRepo('/'), '_default');
  });
});

test('detectRepo: never throws on a bogus/garbage cwd, returns non-empty string', () => {
  withEnv({ PHANTOM_REPO: undefined }, () => {
    let result;
    assert.doesNotThrow(() => {
      result = detectRepo('/no/such/path/' + Math.random() + '/\x00garbage');
    });
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0, 'returns a non-empty string');
    assert.equal(result, '_default');
  });
});

test('dir resolution: learningsDir/sessionsDir/completedDir resolve under <data>/repos/<repo>/...', () => {
  const tmp = mkTmp('paths-resolve-');
  try {
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'acme' }, () => {
      assert.equal(learningsDir(), path.join(tmp, 'repos', 'acme', 'learnings'));
      assert.equal(sessionsDir(), path.join(tmp, 'repos', 'acme', 'sessions'));
      assert.equal(completedDir(), path.join(tmp, 'repos', 'acme', 'completed'));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dir resolution: explicit repo arg overrides detection', () => {
  const tmp = mkTmp('paths-explicit-');
  try {
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'detected' }, () => {
      // Contract invariant: learningsDir('x') === path.join(repoDir('x'), 'learnings')
      assert.equal(learningsDir('explicit'), path.join(repoDir('explicit'), 'learnings'));
      assert.equal(learningsDir('explicit'), path.join(tmp, 'repos', 'explicit', 'learnings'));
      // Explicit arg must NOT use the PHANTOM_REPO-detected name.
      assert.ok(!learningsDir('explicit').includes('detected'));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dir resolution: globalPatternsDir/auditDir stay FLAT (not under repos/)', () => {
  const tmp = mkTmp('paths-flat-');
  try {
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'acme' }, () => {
      assert.equal(globalPatternsDir(), path.join(tmp, 'global', 'patterns'));
      assert.equal(auditDir(), path.join(tmp, 'audit'));
      // Regression guard: flat dirs must never be relocated under repos/<repo>/.
      assert.ok(!globalPatternsDir().includes(path.sep + 'repos' + path.sep));
      assert.ok(!auditDir().includes(path.sep + 'repos' + path.sep));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('run artifacts: runsDir resolves under sessionsDir/<ticket>/runs', () => {
  const tmp = mkTmp('paths-runs-');
  try {
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'r' }, () => {
      assert.equal(runsDir('T-1'), path.join(tmp, 'repos', 'r', 'sessions', 'T-1', 'runs'));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('run artifacts: runDir resolves to runsDir/<ts>', () => {
  const tmp = mkTmp('paths-rundir-');
  try {
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'r' }, () => {
      assert.equal(runDir('T-1', 'x'), path.join(tmp, 'repos', 'r', 'sessions', 'T-1', 'runs', 'x'));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('run artifacts: currentRunPointer resolves to runsDir/current', () => {
  const tmp = mkTmp('paths-ptr-');
  try {
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'r' }, () => {
      assert.equal(currentRunPointer('T-1'), path.join(tmp, 'repos', 'r', 'sessions', 'T-1', 'runs', 'current'));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('run artifacts: PHANTOM_DATA env override honored by run functions', () => {
  const tmp = mkTmp('paths-run-env-');
  try {
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'myrepo' }, () => {
      assert.ok(runsDir('ENG-1').startsWith(tmp));
      assert.ok(runDir('ENG-1', 'ts1').startsWith(tmp));
      assert.ok(currentRunPointer('ENG-1').startsWith(tmp));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('run artifacts: no directory created by merely requiring the lib', () => {
  const tmp = mkTmp('paths-no-mkdir-');
  try {
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'r' }, () => {
      // Compute paths — must not create dirs.
      runsDir('T-1');
      runDir('T-1', 'ts1');
      currentRunPointer('T-1');
      assert.ok(!fs.existsSync(path.join(tmp, 'repos')), 'require must not create directories');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('worktrees: worktreesRoot stays FLAT under the data root (regression: NOT under repos/)', () => {
  const tmp = mkTmp('paths-wtroot-');
  try {
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'acme' }, () => {
      assert.equal(worktreesRoot(), path.join(tmp, 'worktrees'));
      assert.ok(!worktreesRoot().includes(path.sep + 'repos' + path.sep));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('worktrees: worktreeDir resolves to <data>/worktrees/<repo>/<ticket>', () => {
  const tmp = mkTmp('paths-wtdir-');
  try {
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'acme' }, () => {
      assert.equal(worktreeDir('T-1'), path.join(tmp, 'worktrees', 'acme', 'T-1'));
      assert.equal(worktreeDir('T-1', 'other'), path.join(tmp, 'worktrees', 'other', 'T-1'));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detectRepo: cwd inside <data>/worktrees/<repo>/<ticket>/... -> <repo>, beating env AND walk-up', () => {
  const tmp = mkTmp('paths-wt-detect-');
  try {
    const wt = path.join(tmp, 'worktrees', 'acme', 'T-1');
    const nested = path.join(wt, 'sub', 'dir');
    fs.mkdirSync(nested, { recursive: true });
    // git worktree marker — the legacy walk-up would return 'T-1' (the TICKET).
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /somewhere/.git/worktrees/T-1\n');
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'conflicting-env-repo' }, () => {
      assert.equal(detectRepo(nested), 'acme', 'worktree containment is ground truth');
    });
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: undefined }, () => {
      assert.equal(detectRepo(nested), 'acme', 'must NOT shard under the ticket basename');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detectRepo: PHANTOM_REPO still beats the .git walk-up OUTSIDE worktrees', () => {
  const data = mkTmp('paths-wt-env-data-');
  const repo = mkTmp('paths-wt-env-repo-');
  try {
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    const nested = path.join(repo, 'src');
    fs.mkdirSync(nested, { recursive: true });
    withEnv({ PHANTOM_DATA: data, PHANTOM_REPO: 'env-wins' }, () => {
      assert.equal(detectRepo(nested), 'env-wins');
    });
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('worktrees: pure path computation — no mkdir on compute', () => {
  const tmp = mkTmp('paths-wt-no-mkdir-');
  try {
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'r' }, () => {
      worktreesRoot();
      worktreeDir('T-1');
      assert.ok(!fs.existsSync(path.join(tmp, 'worktrees')), 'worktree fns must not create directories');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
