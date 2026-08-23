// Author: Subash Karki
// release-version.test.js - locks scripts/release-version.js, which keeps
// the version in sync across .claude-plugin/plugin.json,
// .claude-plugin/marketplace.json (nested under metadata),
// .codex-plugin/plugin.json, and .kimi-plugin/plugin.json.
//
// Every test runs against a throwaway --root fixture copied from the real
// manifests, never against the live repo files - this suite must stay green
// on a clean checkout regardless of the repo's current release state.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'release-version.js');
const { status, setVersion } = require('../scripts/release-version');

const MANIFEST_PATHS = [
  ['.claude-plugin', 'plugin.json'],
  ['.claude-plugin', 'marketplace.json'],
  ['.codex-plugin', 'plugin.json'],
  ['.kimi-plugin', 'plugin.json'],
];

// Copies the repo's real manifests into a fresh tmp dir so tests exercise
// real formatting/shape without ever touching the checked-in files.
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-release-version-'));
  for (const [subdir, name] of MANIFEST_PATHS) {
    fs.mkdirSync(path.join(dir, subdir), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, subdir, name), path.join(dir, subdir, name));
  }
  return dir;
}

function readManifests(dir) {
  return Object.fromEntries(
    MANIFEST_PATHS.map(([subdir, name]) => [
      subdir + '/' + name,
      fs.readFileSync(path.join(dir, subdir, name), 'utf8'),
    ])
  );
}

// A version guaranteed to differ from whatever the fixture (copied from the
// live repo) currently holds - a hardcoded literal would go stale the moment
// the real manifests happen to reach it.
function otherVersion(dir) {
  const [major, minor, patch] = status({ root: dir }).versions[0].split('.').map(Number);
  return [major, minor, patch + 1].join('.');
}

test('--check passes and exits 0 when all four manifests agree', () => {
  const dir = makeFixture();
  assert.equal(status({ root: dir }).inSync, true);
  execFileSync(process.execPath, [SCRIPT, '--check', '--root', dir], { encoding: 'utf8' });
});

test('--check fails and exits 1 when a manifest is hand-skewed', () => {
  const dir = makeFixture();
  const codexFile = path.join(dir, '.codex-plugin', 'plugin.json');
  fs.writeFileSync(
    codexFile,
    fs.readFileSync(codexFile, 'utf8').replace(/"version": "[^"]*"/, '"version": "0.0.1"')
  );
  assert.equal(status({ root: dir }).inSync, false);

  let exitStatus = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--check', '--root', dir], { encoding: 'utf8' });
  } catch (e) {
    exitStatus = e.status;
  }
  assert.equal(exitStatus, 1, 'a hand-skewed manifest must fail --check');
});

test('--set updates all four manifests to the requested version', () => {
  const dir = makeFixture();
  const target = otherVersion(dir);
  const result = setVersion(target, { root: dir });
  assert.equal(result.written, 4);
  for (const f of result.files) assert.equal(f.after, target);
  assert.deepEqual(status({ root: dir }).versions, [target]);
});

test('an invalid semver is rejected and nothing is written', () => {
  const dir = makeFixture();
  const before = readManifests(dir);

  for (const bad of ['1.2', '1.2.3.4', '1.2.3-beta', '1.2.x', 'v1.2.3', '']) {
    assert.throws(
      () => setVersion(bad, { root: dir }),
      /expected MAJOR\.MINOR\.PATCH/,
      'expected rejection for ' + JSON.stringify(bad)
    );
  }
  assert.deepEqual(readManifests(dir), before, 'a rejected --set must not write');
});

test('formatting survives a round trip - only the version value changes', () => {
  const dir = makeFixture();
  const target = otherVersion(dir);
  const before = readManifests(dir);
  setVersion(target, { root: dir });
  const after = readManifests(dir);

  const targetRe = new RegExp('"version":\\s*"' + target.replace(/\./g, '\\.') + '"');
  for (const key of Object.keys(before)) {
    const beforeLines = before[key].split('\n');
    const afterLines = after[key].split('\n');
    assert.equal(afterLines.length, beforeLines.length, key + ': line count must not change');
    const changed = afterLines.filter((l, i) => l !== beforeLines[i]);
    assert.equal(changed.length, 1, key + ': exactly one line should differ');
    assert.match(changed[0], targetRe);
  }
});

test('--set to the current version is idempotent - no diff', () => {
  const dir = makeFixture();
  const target = otherVersion(dir);
  setVersion(target, { root: dir });
  const snapshot = readManifests(dir);

  const result = setVersion(target, { root: dir });
  assert.equal(result.written, 0, 'setting the already-current version must write nothing');
  assert.deepEqual(readManifests(dir), snapshot);
});

test('CLI --set writes all four and CLI --check confirms sync afterward', () => {
  const dir = makeFixture();
  const target = otherVersion(dir);
  execFileSync(process.execPath, [SCRIPT, '--set', target, '--root', dir], { encoding: 'utf8' });
  assert.deepEqual(status({ root: dir }).versions, [target]);
  execFileSync(process.execPath, [SCRIPT, '--check', '--root', dir], { encoding: 'utf8' });
});
