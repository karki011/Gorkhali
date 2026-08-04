// Author: Subash Karki
// routing-report.test.js - EXECUTED tests for the routing evidence report.
// Every case builds a real session fixture in tmpdir, runs the CLI as a child
// process, and asserts on exit code + output; the aggregation logic is also
// exercised directly through the module's exports.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'routing-report.js');
const { buildReport, extractRecords, collectJsonFiles } = require('../scripts/routing-report');

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'routing-report-')));
}

// Write a routed artifact (envelope with producer.role + model_routing) to
// <sessionDir>/<relPath>, creating parent dirs as needed.
function writeArtifact(sessionDir, relPath, role, routing) {
  const full = path.join(sessionDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    JSON.stringify({
      schema_version: 1,
      producer: role == null ? {} : { role },
      model_routing: routing,
    }),
  );
  return full;
}

function routing(requested, actual = null, fallback_reason = null, outcome = 'passed') {
  return { requested_profile: requested, actual_profile: actual, fallback_reason, outcome };
}

function runCli(args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

test('empty session: exit 0 with a clear no-records line', () => {
  const dir = mkTmp();
  try {
    const res = runCli([dir]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /no routing records/);

    const json = JSON.parse(runCli([dir, '--json']).stdout);
    assert.equal(json.records, 0);
    assert.equal(json.reconciliationActive, false);
    assert.deepEqual(json.perRole, {});
    assert.deepEqual(json.deltas, []);
    assert.deepEqual(json.fallbacks, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('multi-role: per-role requested distribution and outcome tallies', () => {
  const dir = mkTmp();
  try {
    writeArtifact(dir, 'plan.json', 'apex', routing('frontier', null, null, 'passed'));
    writeArtifact(dir, 'a.task.json', 'blade', routing('balanced', null, null, 'passed'));
    writeArtifact(dir, 'b.task.json', 'blade', routing('balanced', null, null, 'failed'));

    const res = runCli([dir]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /apex\s+requested: frontier×1/);
    assert.match(res.stdout, /blade\s+requested: balanced×2/);
    assert.match(res.stdout, /outcomes: failed×1, passed×1/);

    const json = JSON.parse(runCli([dir, '--json']).stdout);
    assert.equal(json.records, 3);
    assert.equal(typeof json.reconciliationActive, 'boolean');
    assert.equal(json.reconciliationActive, false);
    assert.deepEqual(json.perRole.apex.requested, { frontier: 1 });
    assert.deepEqual(json.perRole.blade.requested, { balanced: 2 });
    assert.deepEqual(json.perRole.blade.outcomes, { failed: 1, passed: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runs/ subdir layout: nested artifacts are collected', () => {
  const dir = mkTmp();
  try {
    writeArtifact(dir, 'plan.json', 'apex', routing('frontier'));
    writeArtifact(dir, 'runs/handoff/delegation-task.json', 'blade', routing('balanced'));
    writeArtifact(dir, 'runs/handoff/delegation-result.json', 'blade', routing('balanced'));

    const files = collectJsonFiles(dir);
    assert.equal(files.filter((f) => f.includes(`${path.sep}runs${path.sep}`)).length, 2);

    const json = JSON.parse(runCli([dir, '--json']).stdout);
    assert.equal(json.records, 3);
    assert.deepEqual(json.perRole.blade.requested, { balanced: 2 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('all-null actuals: reconciliation inactive, no deltas', () => {
  const dir = mkTmp();
  try {
    writeArtifact(dir, 'plan.json', 'apex', routing('frontier', null));
    writeArtifact(dir, 'run.json', 'blade', routing('balanced', null));

    const res = runCli([dir]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /reconciliation inactive: no host-reported actuals in this session/);

    const json = JSON.parse(runCli([dir, '--json']).stdout);
    assert.equal(json.reconciliationActive, false);
    assert.deepEqual(json.deltas, []);
    assert.deepEqual(json.fallbacks, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('non-null actual + fallback: deltas and fallbacks populated, active', () => {
  const dir = mkTmp();
  try {
    // Host reported actual_profile that differs from requested, plus a reason.
    writeArtifact(dir, 'run.json', 'blade', routing('frontier', 'balanced', 'capacity', 'passed'));
    // A record whose actual equals requested contributes no delta.
    writeArtifact(dir, 'plan.json', 'apex', routing('frontier', 'frontier', null, 'passed'));

    const res = runCli([dir]);
    assert.equal(res.code, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /reconciliation inactive/);
    assert.match(res.stdout, /blade: frontier -> balanced ×1/);
    assert.match(res.stdout, /blade: capacity ×1/);

    const json = JSON.parse(runCli([dir, '--json']).stdout);
    assert.equal(json.reconciliationActive, true);
    assert.equal(json.deltas.length, 1);
    assert.deepEqual(json.deltas[0], { role: 'blade', requested: 'frontier', actual: 'balanced', count: 1 });
    assert.equal(json.fallbacks.length, 1);
    assert.deepEqual(json.fallbacks[0], { role: 'blade', reason: 'capacity', count: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing producer.role falls back to "unknown"; unparseable files skipped', () => {
  const dir = mkTmp();
  try {
    writeArtifact(dir, 'norole.json', null, routing('balanced'));
    // A file without model_routing is not a record.
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ schema_version: 1 }));
    // A half-written artifact is skipped silently, not fatal.
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not valid json');

    const records = extractRecords(collectJsonFiles(dir));
    assert.equal(records.length, 1);
    assert.equal(records[0].role, 'unknown');

    const report = buildReport(records);
    assert.equal(report.records, 1);
    assert.deepEqual(report.perRole.unknown.requested, { balanced: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('producer.role of "__proto__" or "constructor" does not throw and is counted', () => {
  const dir = mkTmp();
  try {
    writeArtifact(dir, 'a.json', '__proto__', routing('balanced'));
    writeArtifact(dir, 'b.json', 'constructor', routing('deep'));
    writeArtifact(dir, 'c.json', 'constructor', routing('deep'));

    const res = runCli([dir]);
    assert.equal(res.code, 0, res.stderr);

    const json = JSON.parse(runCli([dir, '--json']).stdout);
    assert.equal(json.records, 3);
    assert.deepEqual(json.perRole['__proto__'].requested, { balanced: 1 });
    assert.deepEqual(json.perRole.constructor.requested, { deep: 2 });

    const records = extractRecords(collectJsonFiles(dir));
    const report = buildReport(records);
    assert.deepEqual(report.perRole['__proto__'].requested, { balanced: 1 });
    assert.deepEqual(report.perRole.constructor.requested, { deep: 2 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a symlinked runs/ directory is skipped, matching walkJson\'s non-follow policy', (t) => {
  const dir = mkTmp();
  const realRunsTarget = mkTmp();
  try {
    writeArtifact(dir, 'plan.json', 'apex', routing('frontier'));
    writeArtifact(realRunsTarget, 'delegation-task.json', 'blade', routing('balanced'));

    const runsLink = path.join(dir, 'runs');
    try {
      fs.symlinkSync(realRunsTarget, runsLink, 'dir');
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'ENOSYS') {
        t.skip('platform does not permit creating symlinks');
        return;
      }
      throw err;
    }

    const files = collectJsonFiles(dir);
    assert.ok(!files.some((f) => f.startsWith(runsLink) || f.includes(`${path.sep}runs${path.sep}`)));

    const json = JSON.parse(runCli([dir, '--json']).stdout);
    assert.equal(json.records, 1);
    assert.deepEqual(json.perRole, { apex: { requested: { frontier: 1 }, outcomes: { passed: 1 } } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(realRunsTarget, { recursive: true, force: true });
  }
});

test('missing session directory exits nonzero (validation error)', () => {
  const res = runCli([path.join(os.tmpdir(), 'routing-report-does-not-exist-xyz')]);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /not found/i);
});
