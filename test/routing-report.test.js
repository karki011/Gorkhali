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
const BASELINE_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'baseline-report.js');
const OUTCOME_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'outcome-write.js');
const { buildReport, extractRecords, collectJsonFiles } = require('../scripts/routing-report');
const {
  BUNDLE_VERSION,
  stateEnvelopeErrors,
} = require('../scripts/lib/state-envelope-contract');

const TIMESTAMP = '2026-07-31T12:00:00.000Z';

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'routing-report-')));
}

// Write a routed artifact (envelope with producer.role + model_routing) to
// <sessionDir>/<relPath>, creating parent dirs as needed.
function writeArtifact(sessionDir, relPath, role, routing, schemaVersion = 2) {
  const full = path.join(sessionDir, relPath);
  const type = path.basename(relPath, '.json');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    JSON.stringify({
      schema_version: schemaVersion,
      artifact_type: type,
      repo_id: 'routing-report-repo',
      task_id: 'ROUTING-1',
      status: routing.outcome,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
      producer: role == null ? {} : { role, compute_profile: routing.requested_profile },
      bundle_version: BUNDLE_VERSION,
      record_sequence: 1,
      model_routing: routing,
      evidence: type === 'delegation-task'
        ? { role, profile: routing.requested_profile, risk: 'moderate' }
        : {},
    }),
  );
  return full;
}

function writeSession(sessionDir, overrides = {}) {
  const pending = { status: 'pending', decided_at: null };
  const session = {
    schema_version: 2,
    artifact_type: 'session',
    repo_id: 'analytics-state-v2',
    task_id: 'ANALYTICS-1',
    status: 'active',
    created_at: '2026-07-31T12:00:00.000Z',
    updated_at: '2026-07-31T12:00:01.000Z',
    producer: { role: 'apex', compute_profile: 'frontier' },
    bundle_version: BUNDLE_VERSION,
    workspace: '/workspace/analytics-state-v2',
    route: 'plan',
    intent_summary: 'Measure a canonical session.',
    work_kind: 'implementation',
    lifecycle: {
      mode: 'standard',
      approvals: { direction: pending, plan: pending, wiring: pending },
      authorizations: {
        implementation: pending,
        'ship-draft-pr': pending,
        'tracker-comment': pending,
      },
      actions: { execute: pending, ship: pending },
    },
    authority_trust: null,
    authority_decisions: [],
    ...overrides,
  };
  fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(session));
  return session;
}

function routing(requested, actual = null, fallback_reason = null, outcome = 'passed') {
  return { requested_profile: requested, actual_profile: actual, fallback_reason, outcome };
}

function mutateJson(file, mutate) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(value);
  fs.writeFileSync(file, JSON.stringify(value));
}

function runAnalytics(script, args, env = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

const runCli = (args) => runAnalytics(SCRIPT, args);

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
    writeArtifact(dir, 'runs/a/execution.json', 'blade', routing('balanced', null, null, 'passed'));
    writeArtifact(dir, 'runs/b/execution.json', 'blade', routing('balanced', null, null, 'failed'));

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
    writeArtifact(dir, 'runs/one/execution.json', 'blade', routing('balanced', null));

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
    writeArtifact(dir, 'runs/one/execution.json', 'blade', routing('frontier', 'balanced', 'capacity', 'passed'));
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

test('malformed producers and unparseable files are skipped deterministically', () => {
  const dir = mkTmp();
  try {
    writeArtifact(dir, 'runs/one/execution.json', null, routing('balanced'));
    // A file without model_routing is not a record.
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({
      schema_version: 2,
      artifact_type: 'session',
    }));
    // A half-written artifact is skipped silently, not fatal.
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not valid json');

    const records = extractRecords(collectJsonFiles(dir));
    assert.equal(records.length, 0);

    const report = buildReport(records);
    assert.equal(report.records, 0);
    assert.deepEqual(report.perRole, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('retired v1 state envelopes are excluded from routing evidence', () => {
  const dir = mkTmp();
  try {
    writeArtifact(dir, 'plan.json', 'apex', routing('frontier'), 2);
    writeArtifact(dir, 'runs/retired/execution.json', 'blade', routing('balanced'), 1);

    const records = extractRecords(collectJsonFiles(dir));
    assert.equal(records.length, 1);
    assert.equal(records[0].role, 'apex');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('relabeled or malformed v2 routed envelopes never enter analytics', () => {
  const dir = mkTmp();
  try {
    writeArtifact(dir, 'plan.json', 'apex', routing('frontier'));
    const corruptions = [
      ['runs/legacy/execution.json', (value) => { value.legacy_payload = { schema_version: 1 }; }],
      ['runs/expanded/wrap.json', (value) => { value.producer.runtime = 'legacy'; }],
      ['runs/missing/execution.json', (value) => { delete value.evidence; }],
      ['runs/relabel/execution.json', (value) => { value.artifact_type = 'plan'; }],
      ['runs/routing/execution.json', (value) => { value.model_routing.legacy_profile = 'balanced'; }],
      ['runs/profile/execution.json', (value) => { value.producer.compute_profile = 'frontier'; }],
    ];
    for (const [relPath, mutate] of corruptions) {
      const type = path.basename(relPath, '.json');
      const role = type === 'wrap' ? 'warden' : 'blade';
      const profile = type === 'wrap' ? 'economy' : 'balanced';
      mutateJson(writeArtifact(dir, relPath, role, routing(profile)), mutate);
    }

    const records = extractRecords(collectJsonFiles(dir));
    assert.equal(records.length, 1);
    assert.equal(records[0].role, 'apex');
    assert.deepEqual(JSON.parse(runCli([dir, '--json']).stdout).perRole, {
      apex: { requested: { frontier: 1 }, outcomes: { passed: 1 } },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('baseline and outcome analytics skip retired v1 session timing explicitly', () => {
  const root = mkTmp();
  const data = path.join(root, 'data');
  const workspace = path.join(root, 'workspace');
  const repo = 'analytics-state-v2';
  const ticket = 'ANALYTICS-1';
  const sessionDir = path.join(data, 'repos', repo, 'sessions', ticket);
  const env = { PHANTOM_DATA: data, PHANTOM_REPO: repo };
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(sessionDir, 'wrap.json'), JSON.stringify({ pr: { status: 'not-started' } }));
    writeSession(sessionDir, { schema_version: 1, workspace });

    const baseline = runAnalytics(BASELINE_SCRIPT, ['--no-gh', '--json'], env);
    assert.equal(baseline.code, 0, baseline.stderr);
    const report = JSON.parse(baseline.stdout);
    assert.equal(report.wallTime.coverage, '0/1');
    assert.match(
      report.unresolved.find((entry) => entry.field === 'wall_time_ms').reason,
      /schema_version 1 is unsupported; expected 2/,
    );

    const outcome = runAnalytics(OUTCOME_SCRIPT, [
      '--ticket', ticket,
      '--repo-path', workspace,
      '--out', path.join(root, 'outcome.json'),
      '--no-gh',
      '--dry-run',
      '--json',
    ], env);
    assert.equal(outcome.code, 0, outcome.stderr);
    const record = JSON.parse(outcome.stdout);
    assert.equal(record.wall_time_ms, null);
    assert.match(
      record.unresolved.find((entry) => entry.field === 'wall_time_ms').reason,
      /schema_version 1 is unsupported; expected 2/,
    );

    writeSession(sessionDir, { workspace });
    const currentBaseline = runAnalytics(BASELINE_SCRIPT, ['--no-gh', '--json'], env);
    assert.equal(currentBaseline.code, 0, currentBaseline.stderr);
    assert.equal(JSON.parse(currentBaseline.stdout).wallTime.totalMs, 1000);

    const currentOutcome = runAnalytics(OUTCOME_SCRIPT, [
      '--ticket', ticket,
      '--repo-path', workspace,
      '--out', path.join(root, 'outcome.json'),
      '--no-gh',
      '--dry-run',
      '--json',
    ], env);
    assert.equal(currentOutcome.code, 0, currentOutcome.stderr);
    assert.equal(JSON.parse(currentOutcome.stdout).wall_time_ms, 1000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('baseline and outcome analytics reject malformed relabeled v2 sessions', () => {
  const root = mkTmp();
  const data = path.join(root, 'data');
  const workspace = path.join(root, 'workspace');
  const repo = 'analytics-state-v2';
  const ticket = 'ANALYTICS-1';
  const sessionDir = path.join(data, 'repos', repo, 'sessions', ticket);
  const env = { PHANTOM_DATA: data, PHANTOM_REPO: repo };
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(sessionDir, 'wrap.json'), JSON.stringify({ pr: { status: 'not-started' } }));

    const analyticsReasons = () => {
      const baseline = runAnalytics(BASELINE_SCRIPT, ['--no-gh', '--json'], env);
      assert.equal(baseline.code, 0, baseline.stderr);
      const report = JSON.parse(baseline.stdout);
      const outcome = runAnalytics(OUTCOME_SCRIPT, [
        '--ticket', ticket,
        '--repo-path', workspace,
        '--out', path.join(root, 'outcome.json'),
        '--no-gh',
        '--dry-run',
        '--json',
      ], env);
      assert.equal(outcome.code, 0, outcome.stderr);
      const record = JSON.parse(outcome.stdout);
      assert.equal(report.wallTime.coverage, '0/1');
      assert.equal(record.wall_time_ms, null);
      return [
        report.unresolved.find((entry) => entry.field === 'wall_time_ms').reason,
        record.unresolved.find((entry) => entry.field === 'wall_time_ms').reason,
      ];
    };

    writeSession(sessionDir, { workspace, legacy_payload: { schema_version: 1 } });
    for (const reason of analyticsReasons()) assert.match(reason, /legacy_payload is unsupported/);

    writeSession(sessionDir, { workspace, producer: {} });
    for (const reason of analyticsReasons()) assert.match(reason, /producer\.role is required/);

    writeSession(sessionDir, { workspace, lifecycle: {} });
    for (const reason of analyticsReasons()) assert.match(reason, /session\.lifecycle\.mode must be standard\|to-plan/);

    writeSession(sessionDir, { workspace, authority_trust: { legacy: true } });
    for (const reason of analyticsReasons()) assert.match(reason, /authority_trust\.schema_version must be 1/);

    writeSession(sessionDir, { workspace, authority_decisions: [{ legacy: true }] });
    for (const reason of analyticsReasons()) assert.match(reason, /authority_decisions\[0\]\.legacy is unsupported/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unknown prototype-shaped producer roles are rejected before aggregation', () => {
  const dir = mkTmp();
  try {
    writeArtifact(dir, 'runs/a/delegation-task.json', '__proto__', routing('balanced'));
    writeArtifact(dir, 'runs/b/delegation-task.json', 'constructor', routing('deep'));

    const res = runCli([dir]);
    assert.equal(res.code, 0, res.stderr);

    const json = JSON.parse(runCli([dir, '--json']).stdout);
    assert.equal(json.records, 0);
    assert.deepEqual(json.perRole, {});

    // The public pure aggregator remains safe even for an untrusted direct caller.
    const records = [
      { role: '__proto__', requested: 'balanced', actual: null, fallback: null, outcome: 'passed' },
      { role: 'constructor', requested: 'deep', actual: null, fallback: null, outcome: 'passed' },
    ];
    const report = buildReport(records);
    assert.deepEqual(report.perRole['__proto__'].requested, { balanced: 1 });
    assert.deepEqual(report.perRole.constructor.requested, { deep: 1 });
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
