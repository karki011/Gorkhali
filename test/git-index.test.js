// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MANIFEST_MODULE = '../skills/phantom/scripts/lib/workspace-manifest.mjs';
const REPOSITORY_ROOT = path.resolve(__dirname, '..');

function git(workspace, ...args) {
  return execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8' }).trim();
}

test('Git index, staging, gitlink, and fsmonitor metadata never enter the v2 fingerprint', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-git-index-invariance-'));
  try {
    git(workspace, 'init');
    git(workspace, 'config', 'user.name', 'Phantom Test');
    git(workspace, 'config', 'user.email', 'phantom@example.invalid');
    fs.writeFileSync(path.join(workspace, '.gitignore'), '*.ignored\n');
    fs.writeFileSync(path.join(workspace, 'source.txt'), 'baseline\n');
    git(workspace, 'add', '.gitignore', 'source.txt');
    git(workspace, 'commit', '-m', 'baseline');

    const { buildWorkspaceManifest } = await import(MANIFEST_MODULE);
    const baseline = buildWorkspaceManifest(workspace);
    fs.writeFileSync(path.join(workspace, 'source.txt'), 'staged content\n');
    git(workspace, 'add', 'source.txt');
    fs.writeFileSync(path.join(workspace, 'source.txt'), 'baseline\n');
    assert.equal(buildWorkspaceManifest(workspace).evidence.fingerprint, baseline.evidence.fingerprint);

    const head = git(workspace, 'rev-parse', 'HEAD');
    git(workspace, 'update-index', '--add', '--cacheinfo', `160000,${head},vendor/submodule`);
    git(workspace, 'config', 'core.fsmonitor', '!exit 99');
    assert.equal(buildWorkspaceManifest(workspace).evidence.fingerprint, baseline.evidence.fingerprint);

    fs.writeFileSync(path.join(workspace, 'generated.ignored'), 'ignored but relevant\n');
    assert.notEqual(buildWorkspaceManifest(workspace).evidence.fingerprint, baseline.evidence.fingerprint);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('production fingerprint modules contain no ambient Git command path', () => {
  for (const file of [
    'skills/phantom/scripts/lib/filesystem-snapshot.mjs',
    'skills/phantom/scripts/lib/workspace-manifest.mjs',
    'skills/phantom/scripts/lib/git-metadata.mjs',
  ]) {
    const source = fs.readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8');
    assert.doesNotMatch(source, /node:child_process|execFile|spawnSync|\bgit\s+(?:status|ls-files|diff)\b/);
  }
});
