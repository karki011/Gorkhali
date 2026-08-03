// Author: Subash Karki
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const VALIDATOR = path.join(ROOT, 'scripts', 'validate-portable-skill.mjs');

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).flatMap((entry) => {
    const file = path.join(root, entry);
    return fs.statSync(file).isDirectory() ? filesUnder(file) : [file];
  });
}

test('portable skills are the only published workflow authority', async () => {
  for (const retired of ['agents', 'codex-support', 'commands']) {
    assert.deepEqual(filesUnder(path.join(ROOT, retired)), [], `${retired}/ must stay retired`);
  }

  const validator = await import(pathToFileURL(VALIDATOR).href);
  assert.deepEqual(validator.validateActionEntrypoints(path.join(ROOT, 'skills')), []);
});

// The deterministic-workflow-harness rewrite retired every discipline hook on the
// bet that the workflow contract and capability gate would subsume them. That bet
// did not survive contact: the capability gate denied every tool it saw, and its
// approval gate required a signature no shipped code could produce, so the
// enforcement those hooks provided was not replaced -- it was removed. Four are
// deliberately back, each verified inert until its own precondition holds:
//   apex-subagent-driven-law  keeps implementation in subagents so Apex holds the
//                             expensive tier for decomposition and Blades run cheaper
//   blade-model-gate          refuses a Blade spawn with no explicit model
//   routing-gate              routes implementation through a session, fail-open,
//                             with PHANTOM_ADHOC=1 as the logged escape hatch
//   fix-loop-gate             fix-loop ceiling (needs loop-controller)
//   greploop-gate             holds a session open while a live PR has an unrun
//                             Greptile loop, which is the review step this project
//                             actually depends on
// These two stay retired, and this guard still protects that:
//   router-nudge     a nudge, superseded by routing-gate actually gating
//   wake-classifier  depends on wake-queue.js, which was also deleted
test('retired enforcement hooks cannot be registered', () => {
  const hooks = fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8');
  for (const retired of [
    'router-nudge',
    'wake-classifier',
  ]) {
    assert.doesNotMatch(hooks, new RegExp(retired));
    assert.equal(fs.existsSync(path.join(ROOT, 'hooks', `${retired}.js`)), false);
    assert.equal(fs.existsSync(path.join(ROOT, 'hooks', `${retired}.sh`)), false);
  }
});

test('historical repo aliases are reachable only from explicit offline tools', () => {
  const importPattern = /(?:require\s*\(\s*|from\s+|import\s*\(\s*)['"][^'"]*historical-repo-aliases(?:\.js)?['"]/;
  const importers = ['hooks', 'scripts', 'skills']
    .flatMap((directory) => filesUnder(path.join(ROOT, directory)))
    .filter((file) => /\.(?:c?js|mjs)$/.test(file) && importPattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    .sort();

  assert.deepEqual(importers, [
    'scripts/baseline-report.js',
    'scripts/migrate-data.js',
    'scripts/migrate-repo-dirs.js',
  ]);
});

test('deprecated q action is absent', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'skills', 'q', 'SKILL.md')), false);
});
