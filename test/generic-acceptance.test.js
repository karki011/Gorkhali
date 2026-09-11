// Author: Subash Karki
// generic-acceptance.test.js - executable form of the "generic" decision: a
// fixture repo with no tracker and no preferences reaches the plan gate
// without any plugin edit. Builds a temp Python fixture (pyproject.toml,
// tests/, git-initialised, no issue tracker and no gh) and a temp
// GORKHALI_DATA with no preferences files, then drives only lib/ modules:
// checks discovers pytest
// via the stack default, tracker resolves none with all-null ops,
// preferences comes back empty with layer none, session opens and writes a
// plan.json that plan-schema validates, and tiers resolves engineer to the
// balanced tier. No live network, no MCP.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { discoverChecks } = require('../lib/checks');
const { resolveTracker } = require('../lib/tracker');
const { readPreferences } = require('../lib/preferences');
const session = require('../lib/session');
const { validatePlan } = require('../lib/plan-schema');
const { tierForRole } = require('../lib/tiers');

/** A Python fixture repo: pyproject.toml, an empty tests/ dir, git-initialised. */
function makeFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-acceptance-fixture-'));
  fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname = "fixture"\nversion = "0.1.0"\n');
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

/** Point GORKHALI_DATA at a fresh temp dir with no preferences.md anywhere, run fn, restore. */
function withEmptyDataRoot(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-acceptance-data-'));
  const prev = process.env.GORKHALI_DATA;
  process.env.GORKHALI_DATA = dataDir;
  try {
    fn(dataDir);
  } finally {
    if (prev === undefined) delete process.env.GORKHALI_DATA;
    else process.env.GORKHALI_DATA = prev;
  }
}

function minimalPlan() {
  return {
    briefing: { tackling: 'fixture task', problem: 'no tracker, no preferences', how: 'lib-only acceptance test' },
    decision: { question: 'does the generic path reach the plan gate', recommendation: 'yes', rationale: ['fixture repo has no plugin-specific config'], status: 'locked' },
    outcome: { goal: 'plan.json validates', doneWhen: ['validatePlan returns no errors'] },
    scope: { in: ['lib/'], out: ['plugin edits'] },
    tasks: [
      {
        id: 'FIX-1',
        description: 'run pytest',
        files: ['tests/'],
        action: 'no-op fixture task',
        acceptance_criteria: ['pytest exits 0'],
        verify: 'pytest',
      },
    ],
  };
}

test('generic repo with no tracker and no preferences reaches the plan gate', () => {
  const repoDir = makeFixtureRepo();

  withEmptyDataRoot((dataDir) => {
    // No file inside the plugin checkout is touched by any of this.
    const pluginStatusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: __dirname + '/..' }).toString();

    const checks = discoverChecks(repoDir);
    assert.equal(checks.test.command, 'pytest');
    assert.equal(checks.test.provenance, 'stack default (pyproject.toml)');

    const prefs = readPreferences('generic-acceptance-fixture', repoDir);
    assert.equal(prefs.text, '');
    assert.equal(prefs.layer, 'none');

    const tracker = resolveTracker({ preferencesText: prefs.text });
    assert.equal(tracker.provider, 'none');
    assert.deepEqual(tracker.ops, { fetch: null, start: null, done: null, comment: null });

    const repo = 'generic-acceptance-fixture';
    const task = 'FIX-1';
    session.openSession(repo, task, repoDir);
    const plan = minimalPlan();
    session.writePlan(repo, task, plan, repoDir);
    const readBack = session.readPlan(repo, task, repoDir);
    assert.deepEqual(readBack, plan);
    const errors = validatePlan(readBack);
    assert.deepEqual(errors, []);

    assert.equal(tierForRole('engineer'), 'balanced');

    const pluginStatusAfter = execFileSync('git', ['status', '--porcelain'], { cwd: __dirname + '/..' }).toString();
    assert.equal(pluginStatusAfter, pluginStatusBefore, 'the plugin checkout must stay untouched');
    assert.equal(dataDir, process.env.GORKHALI_DATA);
  });
});
