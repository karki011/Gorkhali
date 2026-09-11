// Author: Subash Karki
// preferences.test.js - lib/preferences.js: per-repo layer, global layer,
// per-repo winning outright over global, the 20-line cap, a missing file, an
// unreadable file, every returned path rooted under the data root, and a
// stray in-repo .gorkhali/preferences.md that must be ignored entirely.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const preferences = require('../lib/preferences');
const paths = require('../lib/paths');

// Each test points GORKHALI_DATA at its own fresh temp dir so paths.dataRoot()
// resolves there instead of the real $HOME/.gorkhali, then restores whatever
// was set before.
function withTmpDataRoot(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-test-'));
  const prev = process.env.GORKHALI_DATA;
  process.env.GORKHALI_DATA = dir;
  try {
    fn(dir);
  } finally {
    if (prev === undefined) delete process.env.GORKHALI_DATA;
    else process.env.GORKHALI_DATA = prev;
  }
}

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

test('preferencePaths returns the per-repo path then the global path, both under the data root', () => {
  withTmpDataRoot((cwd) => {
    const [perRepoPath, globalPath] = preferences.preferencePaths('gorkhali', cwd);
    const root = paths.dataRoot(cwd);
    assert.ok(perRepoPath.startsWith(root));
    assert.ok(globalPath.startsWith(root));
    assert.equal(perRepoPath, path.join(root, 'repos', 'gorkhali', 'preferences.md'));
    assert.equal(globalPath, path.join(root, 'preferences.md'));
  });
});

test('reads the per-repo layer when only it exists', () => {
  withTmpDataRoot((cwd) => {
    const [perRepoPath] = preferences.preferencePaths('gorkhali', cwd);
    writeFile(perRepoPath, 'rule one\nrule two\n');

    const result = preferences.readPreferences('gorkhali', cwd);
    assert.equal(result.text, 'rule one\nrule two');
    assert.equal(result.layer, 'repo');
    assert.equal(result.truncated, false);
  });
});

test('falls back to the global layer when no per-repo file exists', () => {
  withTmpDataRoot((cwd) => {
    const [, globalPath] = preferences.preferencePaths('gorkhali', cwd);
    writeFile(globalPath, 'global rule\n');

    const result = preferences.readPreferences('gorkhali', cwd);
    assert.equal(result.text, 'global rule');
    assert.equal(result.layer, 'global');
  });
});

test('per-repo wins over global outright - it replaces the global text, never merges', () => {
  withTmpDataRoot((cwd) => {
    const [perRepoPath, globalPath] = preferences.preferencePaths('gorkhali', cwd);
    writeFile(globalPath, 'global only rule\n');
    writeFile(perRepoPath, 'repo only rule\n');

    const result = preferences.readPreferences('gorkhali', cwd);
    assert.equal(result.text, 'repo only rule');
    assert.equal(result.layer, 'repo');
    assert.ok(!result.text.includes('global only rule'));
  });
});

test('caps at the first 20 non-empty lines and reports truncation', () => {
  withTmpDataRoot((cwd) => {
    const [perRepoPath] = preferences.preferencePaths('gorkhali', cwd);
    const lines = [];
    for (let i = 1; i <= 25; i++) lines.push(`line ${i}`);
    writeFile(perRepoPath, lines.join('\n') + '\n');

    const result = preferences.readPreferences('gorkhali', cwd);
    const returned = result.text.split('\n');
    assert.equal(returned.length, 20);
    assert.equal(returned[0], 'line 1');
    assert.equal(returned[19], 'line 20');
    assert.equal(result.truncated, true);
  });
});

test('blank lines are not counted toward the 20-line cap', () => {
  withTmpDataRoot((cwd) => {
    const [perRepoPath] = preferences.preferencePaths('gorkhali', cwd);
    const lines = [];
    for (let i = 1; i <= 20; i++) lines.push(`line ${i}`, '');
    writeFile(perRepoPath, lines.join('\n') + '\n');

    const result = preferences.readPreferences('gorkhali', cwd);
    assert.equal(result.text.split('\n').length, 20);
    assert.equal(result.truncated, false);
  });
});

test('returns an empty string when neither file exists', () => {
  withTmpDataRoot((cwd) => {
    const result = preferences.readPreferences('gorkhali', cwd);
    assert.equal(result.text, '');
    assert.equal(result.layer, 'none');
    assert.equal(result.truncated, false);
  });
});

test('an unreadable per-repo file falls back to the global layer rather than throwing', () => {
  withTmpDataRoot((cwd) => {
    const [perRepoPath, globalPath] = preferences.preferencePaths('gorkhali', cwd);
    writeFile(perRepoPath, 'unreachable rule\n');
    writeFile(globalPath, 'global rule\n');
    fs.chmodSync(perRepoPath, 0o000);

    try {
      const result = preferences.readPreferences('gorkhali', cwd);
      assert.equal(result.text, 'global rule');
      assert.equal(result.layer, 'global');
    } finally {
      fs.chmodSync(perRepoPath, 0o644);
    }
  });
});

test('a stray in-repo .gorkhali/preferences.md is ignored entirely', () => {
  withTmpDataRoot((cwd) => {
    const repoCheckout = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-repo-'));
    writeFile(path.join(repoCheckout, '.gorkhali', 'preferences.md'), 'stray rule\n');

    // Nothing under the data root exists, and the repo checkout's own
    // .gorkhali/preferences.md must never be consulted.
    const result = preferences.readPreferences('gorkhali', cwd);
    assert.equal(result.text, '');
    assert.equal(result.layer, 'none');

    for (const p of preferences.preferencePaths('gorkhali', cwd)) {
      assert.ok(!p.startsWith(repoCheckout));
    }
  });
});

test('exports the single literal preferences block header', () => {
  assert.equal(preferences.PREFERENCES_BLOCK_HEADER, '## User Preferences (verbatim)');
});
