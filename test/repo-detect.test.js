// Author: Subash Karki
// repo-detect.test.js - fixture tests for scripts/repo-detect.js, the script
// that replaced _shared-repo-detection.md's discovery prose. Pins the marker
// tables (stack, package manager, monorepo), UI detection, verify-command
// discovery precedence, and the never-throws contract on a bare directory.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'repo-detect.js');

function fixture(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repo-detect-')));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

function detect(workspace) {
  // PHANTOM_DATA pinned to a temp dir: detectRepo records aliases into
  // <data>/repos/.aliases.json as a side effect, and a test must never write
  // into the developer's real data root.
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-detect-data-'));
  const raw = execFileSync(process.execPath, [SCRIPT, '--json', '--workspace', workspace], {
    encoding: 'utf8',
    env: { ...process.env, PHANTOM_DATA: dataRoot, PHANTOM_REPO: '' },
  });
  return JSON.parse(raw);
}

test('a node + pnpm + nx repo with UI reports every fact', () => {
  const dir = fixture({
    'package.json': JSON.stringify({
      scripts: { test: 'node --test', lint: 'eslint .', build: 'tsc', typecheck: 'tsc -p .' },
      dependencies: { '@chakra-ui/react': '^3.0.0' },
    }),
    'pnpm-lock.yaml': '',
    'nx.json': '{}',
  });
  const facts = detect(dir);
  assert.equal(facts.repo_id, '_default', 'no git and no .git walk-up hit in the fixture: the last-resort id');
  assert.equal(facts.data_root && facts.data_root.length > 0, true);
  assert.equal(facts.stack, 'node');
  assert.equal(facts.package_manager, 'pnpm');
  assert.equal(facts.monorepo, 'nx');
  assert.equal(facts.has_ui, true, 'a styled-UI dependency marks HAS_UI');
  for (const key of ['test', 'lint', 'build', 'typecheck']) {
    assert.equal(facts.verify_commands[key].source, 'package.json');
  }
});

test('a python repo with a Makefile test target reports stack and verify command', () => {
  const dir = fixture({
    'pyproject.toml': '[project]\nname = "x"\n',
    Makefile: 'test:\n\tpytest\n',
  });
  const facts = detect(dir);
  assert.equal(facts.stack, 'python');
  assert.equal(facts.package_manager, null);
  assert.equal(facts.monorepo, null);
  assert.equal(facts.has_ui, false);
  assert.deepEqual(facts.verify_commands, { test: { command: 'make test', source: 'Makefile' } });
});

test('package.json outranks the Makefile for the same command', () => {
  const dir = fixture({
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    Makefile: 'test:\n\tpytest\n',
  });
  const facts = detect(dir);
  assert.equal(facts.verify_commands.test.source, 'package.json');
});

test('a components directory or a .tsx file marks HAS_UI', () => {
  assert.equal(detect(fixture({ 'src/components/.gitkeep': '' })).has_ui, true);
  assert.equal(detect(fixture({ 'src/deep/nested/view.tsx': 'export const V = () => null;' })).has_ui, true);
});

test('a bare directory degrades every fact instead of throwing', () => {
  const facts = detect(fixture({}));
  assert.equal(typeof facts.repo_id, 'string');
  assert.deepEqual(facts.aliases, []);
  assert.equal(facts.stack, null);
  assert.equal(facts.package_manager, null);
  assert.equal(facts.monorepo, null);
  assert.equal(facts.has_ui, false);
  assert.deepEqual(facts.verify_commands, {});
});

test('an unknown flag is a usage error (exit 2)', () => {
  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8', stdio: 'pipe' }),
    (err) => err.status === 2,
  );
});
