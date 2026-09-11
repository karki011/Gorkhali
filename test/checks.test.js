// Author: Subash Karki
// checks.test.js - discoverChecks resolves per the precedence in lib/checks.js:
// package.json scripts, then a CI workflow, then a stack default, each entry
// carrying its provenance and a null command when nothing is found.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverChecks } = require('../lib/checks');

function makeRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'checks-fixture-'));
}

function write(repoRoot, relPath, contents) {
  const full = path.join(repoRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

test('node repo: package.json scripts win over the pnpm stack default, run through pnpm', () => {
  const repo = makeRepo();
  write(repo, 'pnpm-lock.yaml', '');
  write(
    repo,
    'package.json',
    JSON.stringify({
      scripts: {
        test: 'node --test test/*.test.js',
        lint: 'biome lint .',
        build: 'tsup src/index.ts',
        typecheck: 'tsc --noEmit',
      },
    })
  );

  const result = discoverChecks(repo);
  assert.deepEqual(result.test, { command: 'pnpm run test', provenance: 'package.json scripts.test' });
  assert.deepEqual(result.lint, { command: 'pnpm run lint', provenance: 'package.json scripts.lint' });
  assert.deepEqual(result.build, { command: 'pnpm run build', provenance: 'package.json scripts.build' });
  assert.deepEqual(result.typecheck, { command: 'pnpm run typecheck', provenance: 'package.json scripts.typecheck' });
});

test('node repo: an alternate typecheck key (type-check) is accepted and run through npm by default', () => {
  const repo = makeRepo();
  write(repo, 'package.json', JSON.stringify({ scripts: { test: 'npm run jest', 'type-check': 'tsc -p .' } }));

  const result = discoverChecks(repo);
  assert.equal(result.typecheck.command, 'npm run type-check');
  assert.equal(result.typecheck.provenance, 'package.json scripts.type-check');
});

test('node repo: yarn.lock present runs scripts through yarn (no "run")', () => {
  const repo = makeRepo();
  write(repo, 'yarn.lock', '');
  write(repo, 'package.json', JSON.stringify({ scripts: { test: 'jest', lint: 'eslint .' } }));

  const result = discoverChecks(repo);
  assert.equal(result.test.command, 'yarn test');
  assert.equal(result.lint.command, 'yarn lint');
});

test('node repo: bun.lockb present runs scripts through bun run', () => {
  const repo = makeRepo();
  write(repo, 'bun.lockb', '');
  write(repo, 'package.json', JSON.stringify({ scripts: { build: 'vite build' } }));

  const result = discoverChecks(repo);
  assert.equal(result.build.command, 'bun run build');
});

test('node repo with no scripts falls back to the lockfile stack default', () => {
  const repo = makeRepo();
  write(repo, 'pnpm-lock.yaml', '');
  write(repo, 'package.json', JSON.stringify({ name: 'bare' }));

  const result = discoverChecks(repo);
  assert.deepEqual(result.test, { command: 'pnpm test', provenance: 'stack default (pnpm-lock.yaml)' });
  assert.deepEqual(result.lint, { command: 'pnpm lint', provenance: 'stack default (pnpm-lock.yaml)' });
  assert.deepEqual(result.build, { command: 'pnpm build', provenance: 'stack default (pnpm-lock.yaml)' });
  assert.deepEqual(result.typecheck, { command: 'pnpm exec tsc --noEmit', provenance: 'stack default (pnpm-lock.yaml)' });
});

test('node repo with no scripts and no recognized lockfile falls back to a CI workflow', () => {
  const repo = makeRepo();
  write(
    repo,
    '.github/workflows/ci.yml',
    ['jobs:', '  build:', '    steps:', '      - run: npm test', '      - run: npm run lint'].join('\n')
  );

  const result = discoverChecks(repo);
  assert.equal(result.test.command, 'npm test');
  assert.equal(result.test.provenance, 'CI workflow .github/workflows/ci.yml');
  assert.equal(result.lint.command, 'npm run lint');
  assert.equal(result.build.command, null);
  assert.equal(result.build.provenance, null);
});

test('python repo: pytest resolves from the stack default, the rest stay null', () => {
  const repo = makeRepo();
  write(repo, 'pyproject.toml', '[project]\nname = "fixture"\n');

  const result = discoverChecks(repo);
  assert.deepEqual(result.test, { command: 'pytest', provenance: 'stack default (pyproject.toml)' });
  assert.deepEqual(result.lint, { command: null, provenance: null });
  assert.deepEqual(result.build, { command: null, provenance: null });
  assert.deepEqual(result.typecheck, { command: null, provenance: null });
});

test('empty repo: every check comes back null with no provenance', () => {
  const repo = makeRepo();

  const result = discoverChecks(repo);
  for (const name of ['test', 'lint', 'build', 'typecheck']) {
    assert.deepEqual(result[name], { command: null, provenance: null }, `${name} should be unresolved`);
  }
});

test('default repoRoot falls back to process.cwd() without throwing', () => {
  assert.doesNotThrow(() => discoverChecks());
});
