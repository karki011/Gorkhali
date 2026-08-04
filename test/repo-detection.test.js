// Author: Subash Karki
// repo-detection.test.js — EXECUTED tests for the shared identity codec's git
// resolution. Per [executed-review]: every git-backed branch RUNS real detection
// in real fixture repos (git init / remote add / worktree add) and asserts the
// JS resolver (detectRepo) and the sh mirror (phantom_detect_repo) AGREE — both
// route through skills/phantom/scripts/lib/shared-state.cjs. Remote-backed repos
// resolve to a canonical `<name>-<hash>` id (normalized remote); no-remote repos
// keep their plain main-root basename. The pure-path branches (PHANTOM_REPO,
// walk-up, no-git, worktrees fast-path) also live in phantom-paths.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const { detectRepo, learningsDir, resolveRepoSubdir } = require('../scripts/lib/phantom-paths');
const codec = require('../skills/phantom/scripts/lib/shared-state.cjs');
const SH_LIB = path.resolve(__dirname, '..', 'scripts', 'lib', 'phantom-paths.sh');
const PORTABLE = path.resolve(__dirname, '..', 'skills', 'phantom', 'scripts', 'lib', 'portable.mjs');
// Plugin root the shell mirror needs to find the codec. In production a bash
// caller sets this via BASH_SOURCE self-location; strict POSIX sh (dash on
// Ubuntu CI) cannot self-locate a *sourced* file, so the caller must export it.
// That is exactly what these test invocations do below.
const PLUGIN_ROOT = path.resolve(__dirname, '..');

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
  env.PHANTOM_PLUGIN_ROOT = PLUGIN_ROOT;
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

// The portable ESM layer's repoIdentity().id for the same cwd/env, spawned so
// its env resolution is exercised end-to-end.
function esmDetect(cwd, { data, repo } = {}) {
  const env = { ...process.env };
  if (data === undefined) delete env.PHANTOM_DATA; else env.PHANTOM_DATA = data;
  if (repo === undefined) delete env.PHANTOM_REPO; else env.PHANTOM_REPO = repo;
  const url = pathToFileURL(PORTABLE).href;
  return execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { repoIdentity } from ${JSON.stringify(url)}; process.stdout.write(String(repoIdentity(process.argv[1]).id));`,
    cwd,
  ], { env, encoding: 'utf8' }).trim();
}

// A data root whose worktrees/ subdir cannot contain the fixture → step 1 off.
function isolatedData() {
  return mkTmp('rd-data-');
}

// Independent oracle: the canonical remote-backed id is `<name>-<hash>` where the
// hash is sha256 of the NORMALIZED remote (host lowercased, credentials/default
// ports/.git stripped, owner/repo case preserved). Computed here from a
// hand-normalized string so the codec is checked against a real expectation, not
// against itself.
function expectedRemoteId(normalizedRemote, name) {
  const hash = crypto.createHash('sha256').update(normalizedRemote).digest('hex').slice(0, 10);
  return `${name}-${hash}`;
}

test('step 3: origin remote resolves to a canonical <name>-<hash> id (js + sh agree)', { skip: !HAS_GIT }, () => {
  const repoDir = mkTmp('rd-remote-');
  const data = isolatedData();
  try {
    git(repoDir, 'init -q');
    git(repoDir, 'remote add origin git@github.com:Cloudzero/research-team-skills.git');
    const sub = path.join(repoDir, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });

    const expected = expectedRemoteId('github.com/Cloudzero/research-team-skills', 'research-team-skills');
    assert.equal(jsDetect(sub, { data }), expected, 'js: canonical remote id');
    assert.equal(shDetect(sub, { data }), expected, 'sh: canonical remote id');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('step 3: https remote lowercases host and strips .git before hashing (js + sh agree)', { skip: !HAS_GIT }, () => {
  const repoDir = mkTmp('rd-https-');
  const data = isolatedData();
  try {
    git(repoDir, 'init -q');
    git(repoDir, 'remote add origin https://GitHub.com/org/my-cool-repo.git');
    const expected = expectedRemoteId('github.com/org/my-cool-repo', 'my-cool-repo');
    assert.equal(jsDetect(repoDir, { data }), expected);
    assert.equal(shDetect(repoDir, { data }), expected);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('equivalent SSH/HTTPS/SCP remotes of one repo converge to a single id', { skip: !HAS_GIT }, () => {
  const data = isolatedData();
  const forms = [
    'git@github.com:Acme/Repo.git',
    'ssh://git@github.com:22/Acme/Repo',
    'https://user:pass@GitHub.com/Acme/Repo.git',
  ];
  const dirs = [];
  try {
    // Owner/repo case is preserved in the hashed source; the display name is lower.
    const expected = expectedRemoteId('github.com/Acme/Repo', 'repo');
    for (const form of forms) {
      const repoDir = mkTmp('rd-equiv-');
      dirs.push(repoDir);
      git(repoDir, 'init -q');
      git(repoDir, `remote add origin ${form}`);
      assert.equal(jsDetect(repoDir, { data }), expected, `js converges: ${form}`);
      assert.equal(shDetect(repoDir, { data }), expected, `sh converges: ${form}`);
    }
  } finally {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('same repo name under different owners stays distinct (collision-resistant)', { skip: !HAS_GIT }, () => {
  const data = isolatedData();
  const a = mkTmp('rd-ownerA-');
  const b = mkTmp('rd-ownerB-');
  try {
    git(a, 'init -q');
    git(a, 'remote add origin git@github.com:owner-one/shared-name.git');
    git(b, 'init -q');
    git(b, 'remote add origin git@github.com:owner-two/shared-name.git');
    const idA = jsDetect(a, { data });
    const idB = jsDetect(b, { data });
    assert.match(idA, /^shared-name-[0-9a-f]{10}$/);
    assert.match(idB, /^shared-name-[0-9a-f]{10}$/);
    assert.notEqual(idA, idB, 'different owners must not collide');
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('a renamed clone (same remote, different dir) keeps one id', { skip: !HAS_GIT }, () => {
  const data = isolatedData();
  const original = mkTmp('rd-clone-original-');
  const renamed = mkTmp('rd-clone-renamed-');
  try {
    for (const dir of [original, renamed]) {
      git(dir, 'init -q');
      git(dir, 'remote add origin git@github.com:org/portable-tool.git');
    }
    const expected = expectedRemoteId('github.com/org/portable-tool', 'portable-tool');
    assert.equal(jsDetect(original, { data }), expected);
    assert.equal(jsDetect(renamed, { data }), expected, 'clone dir name must not change the id');
  } finally {
    fs.rmSync(original, { recursive: true, force: true });
    fs.rmSync(renamed, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('CJS, ESM, and shell resolve one identical id for the same fixture repo', { skip: !HAS_GIT }, () => {
  const data = isolatedData();
  const remoteRepo = mkTmp('rd-parity-remote-');
  const localRepo = mkTmp('rd-parity-local-');
  try {
    git(remoteRepo, 'init -q');
    git(remoteRepo, 'remote add origin git@github.com:Cloudzero/parity-check.git');
    const remoteExpected = expectedRemoteId('github.com/Cloudzero/parity-check', 'parity-check');
    assert.equal(jsDetect(remoteRepo, { data }), remoteExpected, 'CJS');
    assert.equal(esmDetect(remoteRepo, { data }), remoteExpected, 'ESM');
    assert.equal(shDetect(remoteRepo, { data }), remoteExpected, 'shell');

    // No-remote repo: all three agree on the plain main-root basename.
    git(localRepo, 'init -q');
    const localExpected = path.basename(localRepo);
    assert.equal(jsDetect(localRepo, { data }), localExpected, 'CJS no-remote');
    assert.equal(esmDetect(localRepo, { data }), localExpected, 'ESM no-remote');
    assert.equal(shDetect(localRepo, { data }), localExpected, 'shell no-remote');
  } finally {
    fs.rmSync(remoteRepo, { recursive: true, force: true });
    fs.rmSync(localRepo, { recursive: true, force: true });
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

test('no-remote identity records the pre-codec path-derived id as an alias (continuity)', { skip: !HAS_GIT }, () => {
  const repoDir = fs.realpathSync(mkTmp('rd-noremote-alias-'));
  const data = isolatedData();
  try {
    git(repoDir, 'init -q'); // no remote -> the codec's no-remote (common-dir) identity.
    const identity = codec.repoIdentity(repoDir, { dataRoot: data });
    assert.equal(identity.id, path.basename(repoDir), 'id is the bare main-root basename');

    // The pre-codec resolver derived `<sanitized-lowercased-basename>-<hash-of-realpath'd-root>`.
    // The new bare-basename identity must alias that exact id so pre-upgrade state stays reachable.
    const legacyId = `${codec.sanitizeName(path.basename(repoDir))}-${codec.shortHash(repoDir)}`;
    assert.deepEqual(identity.aliases, [legacyId], 'old path-derived id is the sole alias');
    assert.ok(!identity.aliases.includes(identity.id), 'canonical id is never its own alias');

    // Persisted, the legacy id resolves back to the canonical id; the canonical id is stable.
    codec.recordAliases(data, identity);
    assert.equal(codec.resolveCanonical(data, legacyId), identity.id, 'legacy id resolves to the codec id');
    assert.equal(codec.resolveCanonical(data, identity.id), identity.id, 'codec id resolves to itself');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('worktree WITH remote: converges on the repo id, not the branch (js + sh agree)', { skip: !HAS_GIT }, () => {
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

    const expected = expectedRemoteId('github.com/Cloudzero/research-team-skills', 'research-team-skills');
    assert.equal(jsDetect(wt, { data }), expected, 'js: repo id, not branch');
    assert.equal(shDetect(wt, { data }), expected, 'sh: repo id, not branch');
    assert.equal(jsDetect(mainDir, { data }), expected, 'worktree and main checkout share one id');
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

test('PHANTOM_REPO (step 2) beats git remote (step 3), verbatim', { skip: !HAS_GIT }, () => {
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

test('worktrees fast-path (step 1) beats git remote (step 3), verbatim segment', { skip: !HAS_GIT }, () => {
  const data = isolatedData();
  try {
    // cwd is under <data>/worktrees/<seg>/... AND is a git repo with a DIFFERENT
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

test('git RUN fails -> degrades to walk-up basename without throwing (js + sh; [guards])', { skip: !HAS_GIT }, () => {
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
      env: { ...process.env, PATH: shimPath, PHANTOM_DATA: data, PHANTOM_PLUGIN_ROOT: PLUGIN_ROOT },
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

test('legacy plain and raw-hash ids remain discoverable through persisted aliases', { skip: !HAS_GIT }, () => {
  const repoDir = mkTmp('rd-alias-');
  const data = isolatedData();
  const rawRemote = 'git@github.com:Cloudzero/research-team-skills.git';
  try {
    git(repoDir, 'init -q');
    git(repoDir, `remote add origin ${rawRemote}`);
    const identity = codec.repoIdentity(repoDir);
    const canonicalId = expectedRemoteId('github.com/Cloudzero/research-team-skills', 'research-team-skills');
    assert.equal(identity.id, canonicalId);

    // The alias set covers the pre-codec plain name and the un-normalized raw-hash id.
    const rawHash = crypto.createHash('sha256').update(rawRemote).digest('hex').slice(0, 10);
    const rawHashId = `research-team-skills-${rawHash}`;
    assert.ok(identity.aliases.includes('research-team-skills'), 'legacy plain name is an alias');
    assert.ok(identity.aliases.includes(rawHashId), 'raw-hash id is an alias');
    assert.ok(!identity.aliases.includes(canonicalId), 'canonical id is never its own alias');

    // Persist, then resolve any known id back to the canonical id (merge-only).
    codec.recordAliases(data, identity);
    assert.equal(codec.resolveCanonical(data, 'research-team-skills'), canonicalId);
    assert.equal(codec.resolveCanonical(data, rawHashId), canonicalId);
    assert.equal(codec.resolveCanonical(data, canonicalId), canonicalId);
    assert.equal(codec.resolveCanonical(data, 'never-seen'), 'never-seen', 'unknown ids pass through');

    // Merge-only: a second record keeps prior aliases.
    codec.recordAliases(data, { id: 'other-canonical', aliases: ['other-plain'] });
    assert.equal(codec.resolveCanonical(data, 'research-team-skills'), canonicalId, 'earlier alias survives');
    assert.equal(codec.resolveCanonical(data, 'other-plain'), 'other-canonical');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('detectRepo and the portable resolver PERSIST aliases as a side effect of resolution', { skip: !HAS_GIT }, () => {
  const repoDir = mkTmp('rd-persist-');
  const rawRemote = 'git@github.com:Cloudzero/research-team-skills.git';
  try {
    git(repoDir, 'init -q');
    git(repoDir, `remote add origin ${rawRemote}`);
    const canonicalId = expectedRemoteId('github.com/Cloudzero/research-team-skills', 'research-team-skills');

    // CJS consumer: resolving through detectRepo writes <data>/repos/.aliases.json
    // (recordAliases has no other operational caller). A fresh data root proves the
    // write, not a pre-seeded fixture.
    const cjsData = isolatedData();
    jsDetect(repoDir, { data: cjsData });
    assert.ok(fs.existsSync(path.join(cjsData, 'repos', '.aliases.json')), 'CJS detectRepo persisted the alias map');
    assert.equal(codec.resolveCanonical(cjsData, 'research-team-skills'), canonicalId, 'CJS seeded the legacy plain alias');
    assert.equal(codec.resolveCanonical(cjsData, canonicalId), canonicalId, 'canonical id resolves to itself');

    // ESM consumer: the portable repoIdentity seeds the same map (own fresh root).
    const esmData = isolatedData();
    esmDetect(repoDir, { data: esmData });
    assert.equal(codec.resolveCanonical(esmData, 'research-team-skills'), canonicalId, 'ESM seeded the legacy plain alias');

    fs.rmSync(cjsData, { recursive: true, force: true });
    fs.rmSync(esmData, { recursive: true, force: true });
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

// Alias-aware learnings resolution. No git fixture: the repo id is supplied
// explicitly, and only PHANTOM_DATA has to be scoped so the pure path fns read the
// temp root. Env is saved/restored the same way jsDetect does.
function withData(data, fn) {
  const saved = { d: process.env.PHANTOM_DATA, r: process.env.PHANTOM_REPO };
  try {
    process.env.PHANTOM_DATA = data;
    delete process.env.PHANTOM_REPO;
    return fn();
  } finally {
    if (saved.d === undefined) delete process.env.PHANTOM_DATA; else process.env.PHANTOM_DATA = saved.d;
    if (saved.r === undefined) delete process.env.PHANTOM_REPO; else process.env.PHANTOM_REPO = saved.r;
  }
}

function seedLearnings(data, repoId) {
  const dir = path.join(data, 'repos', repoId, 'learnings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'INDEX.md'), '# learnings\n');
  return dir;
}

test('alias-aware learningsDir: a legacy plain-named dir with learnings RESOLVES when the canonical dir is absent', () => {
  const data = isolatedData();
  const CANON = 'research-phantom-skills-490f3d276e';
  const LEGACY = 'research-phantom-skills';
  try {
    const legacyLearnings = seedLearnings(data, LEGACY);
    codec.recordAliases(data, { id: CANON, aliases: [LEGACY] });
    assert.ok(!fs.existsSync(path.join(data, 'repos', CANON, 'learnings')), 'canonical dir is absent');

    withData(data, () => {
      assert.equal(learningsDir(CANON), legacyLearnings, 'resolves to the aliased dir that holds the learnings');
      assert.equal(resolveRepoSubdir(CANON, 'learnings'), legacyLearnings, 'learningsDir is a thin wrapper');
    });
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('alias-aware learningsDir: the CANONICAL dir WINS when both are populated (never serve stale knowledge)', () => {
  const data = isolatedData();
  const CANON = 'research-phantom-skills-490f3d276e';
  const LEGACY = 'research-phantom-skills';
  try {
    const canonicalLearnings = seedLearnings(data, CANON);
    seedLearnings(data, LEGACY);
    codec.recordAliases(data, { id: CANON, aliases: [LEGACY] });

    withData(data, () => {
      assert.equal(learningsDir(CANON), canonicalLearnings, 'fresh canonical data always wins over an alias');
    });
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('alias-aware learningsDir: an orphan id with NO alias-map entry does NOT resolve', () => {
  const data = isolatedData();
  // 0 references in the production alias map, so nothing maps this id to a legacy dir.
  const CANON = 'research-phantom-skills-7be68ce7fa';
  const LEGACY = 'research-phantom-skills';
  try {
    seedLearnings(data, LEGACY); // populated, but unclaimed by CANON
    codec.recordAliases(data, { id: CANON, aliases: [] }); // no-op: no aliases recorded

    withData(data, () => {
      const resolved = learningsDir(CANON);
      assert.equal(resolved, path.join(data, 'repos', CANON, 'learnings'), 'plain canonical join');
      assert.ok(!resolved.split(path.sep).includes(LEGACY), 'an unmapped populated dir is never adopted');
    });
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('alias-aware learningsDir: a malformed .aliases.json does not throw and falls back to the canonical path', () => {
  const data = isolatedData();
  const CANON = 'research-phantom-skills-490f3d276e';
  try {
    seedLearnings(data, 'research-phantom-skills');
    fs.mkdirSync(path.join(data, 'repos'), { recursive: true });
    fs.writeFileSync(path.join(data, 'repos', '.aliases.json'), '{not json at all');

    withData(data, () => {
      let resolved;
      assert.doesNotThrow(() => { resolved = learningsDir(CANON); });
      assert.equal(resolved, path.join(data, 'repos', CANON, 'learnings'), 'degrades to the canonical path');
    });
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('memoization: warm JS resolve is a cache hit (<10ms) after a cold git resolve', { skip: !HAS_GIT }, () => {
  const repoDir = mkTmp('rd-memo-');
  const data = isolatedData();
  try {
    git(repoDir, 'init -q');
    git(repoDir, 'remote add origin git@github.com:org/warm-repo.git');
    const expected = expectedRemoteId('github.com/org/warm-repo', 'warm-repo');
    const t0 = process.hrtime.bigint();
    assert.equal(jsDetect(repoDir, { data }), expected);
    const cold = Number(process.hrtime.bigint() - t0) / 1e6;
    const t1 = process.hrtime.bigint();
    assert.equal(jsDetect(repoDir, { data }), expected);
    const warm = Number(process.hrtime.bigint() - t1) / 1e6;
    assert.ok(warm < 10, `warm resolve must be <10ms (was ${warm.toFixed(2)}ms; cold ${cold.toFixed(2)}ms)`);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});
