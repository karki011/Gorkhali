// Author: Subash Karki
// phantom-paths.test.js — unit tests for the resolver API (detectRepo + dir resolution).
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const paths = require('../scripts/lib/phantom-paths');
const COMMONJS_PATHS = require.resolve('../scripts/lib/phantom-paths');
const SHELL_PATHS = path.resolve(__dirname, '..', 'scripts', 'lib', 'phantom-paths.sh');
const PORTABLE_PATHS = path.resolve(
  __dirname,
  '..',
  'skills',
  'phantom',
  'scripts',
  'lib',
  'portable.mjs',
);
const {
  detectRepo,
  learningsDir,
  sessionsDir,
  completedDir,
  taskDir,
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

function expectedLocalId(root) {
  const canonical = fs.realpathSync(root);
  const name = path.basename(canonical).toLowerCase();
  const hash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 10);
  return `${name}-${hash}`;
}

function resolvedRoot(kind, { cwd, workspace = cwd, env }) {
  let result;
  if (kind === 'commonjs') {
    result = spawnSync(
      process.execPath,
      [
        '-e',
        'process.stdout.write(require(process.argv[1]).phantomData(process.argv[2]))',
        COMMONJS_PATHS,
        workspace,
      ],
      { cwd, env, encoding: 'utf8' },
    );
  } else if (kind === 'shell') {
    result = spawnSync(
      '/bin/sh',
      ['-c', '. "$1"; printf "%s" "$PHANTOM_DATA"', 'sh', SHELL_PATHS],
      { cwd, env, encoding: 'utf8' },
    );
  } else {
    const moduleUrl = pathToFileURL(PORTABLE_PATHS).href;
    result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { dataRoot } from ${JSON.stringify(moduleUrl)}; ` +
          'process.stdout.write(dataRoot(process.argv[1]));',
        workspace,
      ],
      { cwd, env, encoding: 'utf8' },
    );
  }
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('phantomData: explicit PHANTOM_DATA override has highest precedence', () => {
  const explicit = path.join(os.tmpdir(), 'phantom-explicit-root');
  withEnv({ PHANTOM_DATA: explicit }, () => {
    assert.equal(paths.phantomData(), explicit);
  });
});

test('phantomData: default root is neutral ~/.phantom', () => {
  const home = mkTmp('paths-home-');
  try {
    withEnv({ PHANTOM_DATA: undefined, HOME: home }, () => {
      assert.equal(paths.phantomData(), path.join(home, '.phantom'));
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('shell resolver matches explicit override and neutral default root', () => {
  const home = mkTmp('paths-shell-home-');
  const shellLib = path.resolve(__dirname, '..', 'scripts', 'lib', 'phantom-paths.sh');
  const command = '. "$1"; printf "%s" "$PHANTOM_DATA"';
  try {
    const defaultEnv = { ...process.env, HOME: home };
    delete defaultEnv.PHANTOM_DATA;
    const defaultRun = spawnSync('/bin/sh', ['-c', command, 'sh', shellLib], {
      env: defaultEnv,
      encoding: 'utf8',
    });
    assert.equal(defaultRun.status, 0, defaultRun.stderr);
    assert.equal(defaultRun.stdout, path.join(home, '.phantom'));

    const explicit = path.join(home, 'explicit');
    const explicitRun = spawnSync('/bin/sh', ['-c', command, 'sh', shellLib], {
      env: { ...defaultEnv, PHANTOM_DATA: explicit },
      encoding: 'utf8',
    });
    assert.equal(explicitRun.status, 0, explicitRun.stderr);
    assert.equal(explicitRun.stdout, explicit);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('all root resolvers normalize relative overrides against their workspace or cwd', () => {
  const root = mkTmp('paths-cross-relative-');
  const workspace = path.join(root, 'workspace');
  const otherCwd = path.join(root, 'other-cwd');
  fs.mkdirSync(workspace);
  fs.mkdirSync(otherCwd);
  const canonicalWorkspace = fs.realpathSync(workspace);
  const env = { ...process.env, PHANTOM_DATA: path.join('relative', '..', 'state') };
  try {
    assert.equal(
      resolvedRoot('commonjs', { cwd: otherCwd, workspace, env }),
      path.join(canonicalWorkspace, 'state'),
    );
    assert.equal(
      resolvedRoot('shell', { cwd: workspace, env }),
      path.join(canonicalWorkspace, 'state'),
    );
    assert.equal(
      resolvedRoot('portable', { cwd: otherCwd, workspace, env }),
      path.join(canonicalWorkspace, 'state'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('all root resolvers treat an empty override as unset and use workspace when HOME is unset', () => {
  const root = mkTmp('paths-cross-fallback-');
  const workspace = path.join(root, 'workspace');
  const otherCwd = path.join(root, 'other-cwd');
  fs.mkdirSync(workspace);
  fs.mkdirSync(otherCwd);
  const canonicalWorkspace = fs.realpathSync(workspace);
  const env = { ...process.env, PHANTOM_DATA: '', HOME: '' };
  try {
    assert.equal(
      resolvedRoot('commonjs', { cwd: otherCwd, workspace, env }),
      path.join(canonicalWorkspace, '.phantom'),
    );
    assert.equal(
      resolvedRoot('shell', { cwd: workspace, env }),
      path.join(canonicalWorkspace, '.phantom'),
    );
    assert.equal(
      resolvedRoot('portable', { cwd: otherCwd, workspace, env }),
      path.join(canonicalWorkspace, '.phantom'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('detectRepo: PHANTOM_REPO env override wins (trimmed)', () => {
  withEnv({ PHANTOM_REPO: '  my-override-repo  ' }, () => {
    assert.equal(detectRepo('/literally/anywhere'), 'my-override-repo');
  });
});

test('detectRepo: empty/whitespace PHANTOM_REPO is ignored, falls through to hashed walk-up', () => {
  const tmp = mkTmp('paths-empty-env-');
  try {
    fs.mkdirSync(path.join(tmp, '.git'), { recursive: true });
    const nested = path.join(tmp, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    withEnv({ PHANTOM_REPO: '   ' }, () => {
      assert.equal(detectRepo(nested), expectedLocalId(tmp));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detectRepo: .git DIR walk-up hashes the canonical top directory', () => {
  const tmp = mkTmp('paths-gitdir-');
  try {
    const top = fs.realpathSync(tmp);
    fs.mkdirSync(path.join(top, '.git'), { recursive: true });
    const sub = path.join(top, 'src', 'deep', 'nested');
    fs.mkdirSync(sub, { recursive: true });
    withEnv({ PHANTOM_REPO: undefined }, () => {
      assert.equal(detectRepo(sub), expectedLocalId(top));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detectRepo: .git FILE walk-up also hashes the canonical top directory', () => {
  const tmp = mkTmp('paths-gitfile-');
  try {
    const top = fs.realpathSync(tmp);
    // git worktrees use a `.git` FILE ("gitdir: ..."), not a dir.
    fs.writeFileSync(path.join(top, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');
    const sub = path.join(top, 'pkg', 'lib');
    fs.mkdirSync(sub, { recursive: true });
    withEnv({ PHANTOM_REPO: undefined }, () => {
      assert.equal(detectRepo(sub), expectedLocalId(top));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detectRepo rejects unsafe PHANTOM_REPO values instead of joining them into state paths', () => {
  for (const value of ['../outside', 'two/segments', '.', '..', 'has space']) {
    withEnv({ PHANTOM_REPO: value }, () => {
      assert.throws(() => detectRepo('/'), /PHANTOM_REPO must be one safe path segment/);
    });
  }
  assert.throws(() => repoDir('../outside'), /repository id must be one safe path segment/);
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

test('task paths encode unsafe ids losslessly without colliding with similar safe ids', () => {
  const tmp = mkTmp('paths-task-codec-');
  try {
    withEnv({ PHANTOM_DATA: tmp, PHANTOM_REPO: 'r' }, () => {
      const taskId = 'feature/api:v1';
      const encoded = `id~${Buffer.from(taskId).toString('base64url')}`;
      assert.equal(taskDir(taskId), path.join(tmp, 'repos', 'r', 'sessions', encoded));
      assert.equal(runsDir(taskId), path.join(tmp, 'repos', 'r', 'sessions', encoded, 'runs'));
      assert.notEqual(taskDir(taskId), taskDir('feature-api-v1'));
      assert.equal(Buffer.from(path.basename(taskDir(taskId)).slice(3), 'base64url').toString(), taskId);
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

test('shell run path wrappers fail closed when the shared task codec is unavailable', () => {
  const tmp = mkTmp('paths-shell-no-codec-');
  try {
    for (const invocation of [
      'phantom_run_dir T-1 run-1',
      'phantom_current_run_pointer T-1',
    ]) {
      const result = spawnSync('sh', ['-c', `. "${SHELL_PATHS}"; ${invocation}`], {
        env: {
          ...process.env,
          PHANTOM_DATA: tmp,
          PHANTOM_PLUGIN_ROOT: path.join(tmp, 'missing-plugin'),
          PHANTOM_REPO: 'repo',
        },
        encoding: 'utf8',
      });
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /task identity requires Node and the bundled codec/);
    }
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
