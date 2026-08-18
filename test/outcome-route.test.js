// Author: Subash Karki
// outcome-route.test.js - EXECUTED tests for outcome-write.js's route telemetry
// (and the first coverage of outcome-write.js at all).
//
// The router's chosen SESSION route (direct|plan|brainstorm|full, recorded in
// session.json by phantom-state.mjs) was never copied into the durable
// outcome.json, so route effectiveness could not be scored. What is pinned here,
// watchable rather than "it passes":
//
//   1. route + route_source are copied verbatim from session.json into the
//      outcome record when both are present and legal - with NO unresolved[]
//      entries for them;
//   2. a legacy session that predates route_source still yields its route, and
//      route_source becomes 'unknown' WITH an unresolved[] entry saying why -
//      explicit-vs-defaulted is unattributable, never guessed;
//   3. an absent or routeless session.json yields null for both, named in
//      unresolved[] - never fabricated;
//   4. an out-of-enum session route is NEVER written verbatim: it is nulled with
//      an unresolved[] entry naming the illegal value, mirroring how pr_state
//      handles unmappable gh states.
//
// Every case builds a real fake data root (PHANTOM_DATA) and pins the repo id
// deterministically via PHANTOM_REPO (the per-spawn override detectRepo honors),
// then runs the CLI as a child process with --no-gh --dry-run so gh and the
// filesystem are never touched. Assertions are dual-surface: regex on the human
// stdout AND equality on the --json parse.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'outcome-write.js');
const { ROUTE, ROUTE_SOURCE, validRoute } = require('../scripts/outcome-write');

const REPO = 'route-copy-repo';
const TICKET = 'RT-1';

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-route-')));
}

// Fake data root with one session dir for TICKET; `session` null means the dir
// exists but holds NO session.json (resolveSessionDir still finds the ticket).
function buildDataRoot(root, session) {
  const sessionDir = path.join(root, 'data', 'repos', REPO, 'sessions', TICKET);
  fs.mkdirSync(sessionDir, { recursive: true });
  if (session !== null) {
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(session, null, 2));
  }
  const repoPath = path.join(root, 'repo');
  fs.mkdirSync(repoPath, { recursive: true });
  return { dataRoot: path.join(root, 'data'), repoPath };
}

function runCli(fixture, extraArgs = []) {
  const res = spawnSync(
    process.execPath,
    [SCRIPT, '--ticket', TICKET, '--repo-path', fixture.repoPath, '--no-gh', '--dry-run', ...extraArgs],
    {
      encoding: 'utf8',
      env: { ...process.env, PHANTOM_DATA: fixture.dataRoot, PHANTOM_REPO: REPO },
    },
  );
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function unresolvedFields(record) {
  return record.unresolved.map((u) => u.field);
}

test('route + route_source explicit: both copied, no unresolved entries for them', () => {
  const root = mkTmp();
  try {
    const fixture = buildDataRoot(root, {
      schema_version: 1,
      status: 'active',
      route: 'brainstorm',
      route_source: 'explicit',
    });

    const res = runCli(fixture);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /route\s+brainstorm/);
    assert.match(res.stdout, /route_source\s+explicit/);

    const json = runCli(fixture, ['--json']);
    assert.equal(json.code, 0, json.stderr);
    const record = JSON.parse(json.stdout);
    assert.equal(record.route, 'brainstorm');
    assert.equal(record.route_source, 'explicit');
    assert.ok(!unresolvedFields(record).includes('route'));
    assert.ok(!unresolvedFields(record).includes('route_source'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('legacy session with route but no route_source: route copied, source unknown + unresolved', () => {
  const root = mkTmp();
  try {
    const fixture = buildDataRoot(root, { schema_version: 1, status: 'active', route: 'direct' });

    const res = runCli(fixture);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /route\s+direct/);
    assert.match(res.stdout, /route_source\s+unknown/);
    assert.match(res.stdout, /route_source: session\.json predates route_source/);

    const record = JSON.parse(runCli(fixture, ['--json']).stdout);
    assert.equal(record.route, 'direct');
    assert.equal(record.route_source, 'unknown');
    assert.ok(!unresolvedFields(record).includes('route'));
    const entry = record.unresolved.find((u) => u.field === 'route_source');
    assert.ok(entry, 'route_source must be named in unresolved[]');
    assert.match(entry.reason, /predates route_source.*unattributable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('session.json absent: route and route_source both null + unresolved', () => {
  const root = mkTmp();
  try {
    const fixture = buildDataRoot(root, null);

    const res = runCli(fixture);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /route\s+null/);
    assert.match(res.stdout, /route_source\s+null/);
    assert.match(res.stdout, /route: session\.json absent/);

    const record = JSON.parse(runCli(fixture, ['--json']).stdout);
    assert.equal(record.route, null);
    assert.equal(record.route_source, null);
    const entry = record.unresolved.find((u) => u.field === 'route');
    assert.ok(entry, 'route must be named in unresolved[]');
    assert.match(entry.reason, /session\.json absent/);
    // One unresolved entry for route is enough when route is null.
    assert.ok(!unresolvedFields(record).includes('route_source'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('routeless session.json: route and route_source both null + unresolved', () => {
  const root = mkTmp();
  try {
    const fixture = buildDataRoot(root, { schema_version: 1, status: 'active' });

    const record = JSON.parse(runCli(fixture, ['--json']).stdout);
    assert.equal(record.route, null);
    assert.equal(record.route_source, null);
    const entry = record.unresolved.find((u) => u.field === 'route');
    assert.ok(entry, 'route must be named in unresolved[]');
    assert.match(entry.reason, /no usable route/);

    const res = runCli(fixture);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /route\s+null/);
    assert.match(res.stdout, /route: session\.json has no usable route/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('out-of-enum session route is nulled + unresolved, never written verbatim', () => {
  const root = mkTmp();
  try {
    const fixture = buildDataRoot(root, {
      schema_version: 1,
      status: 'active',
      route: 'shadows', // the EXECUTION-route vocabulary leaking into session.json
      route_source: 'explicit',
    });

    const record = JSON.parse(runCli(fixture, ['--json']).stdout);
    assert.equal(record.route, null, 'an illegal route must never survive into the record');
    assert.equal(record.route_source, null);
    const entry = record.unresolved.find((u) => u.field === 'route');
    assert.ok(entry, 'route must be named in unresolved[]');
    assert.match(entry.reason, /"shadows".*maps to no route enum value/);
    assert.equal(validRoute(record), true, 'the nulled record passes the refuse-to-write guard');

    const res = runCli(fixture);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /route\s+null/);
    assert.doesNotMatch(res.stdout, /route\s+shadows/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the exported enums are closed and validRoute enforces them', () => {
  assert.deepEqual(ROUTE, ['direct', 'plan', 'brainstorm', 'full']);
  assert.deepEqual(ROUTE_SOURCE, ['explicit', 'default', 'unknown']);
  assert.equal(validRoute({ route: null }), true);
  assert.equal(validRoute({ route: 'plan' }), true);
  assert.equal(validRoute({ route: 'shadows' }), false, 'the execution route is not a session route');
  assert.equal(validRoute({ route: 'solo' }), false);
});

// --- fix_loops: the durable record reads the ledger the portable flow writes ---
// outcome.json's fix_loops fed the router/baseline scoring off `verification.json`
// review.fixLoops. Nothing has written that file since verify/review moved onto
// the portable lifecycle, so every portable session recorded fix_loops: null and
// the metric was starved. It now counts the review round ledger.

function seedRounds(fixture, count) {
  const dir = path.join(fixture.dataRoot, 'repos', REPO, 'sessions', TICKET, 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'rounds.json'),
    JSON.stringify({
      schema: 'phantom.review-rounds/1',
      rounds: Array.from({ length: count }, (_, i) => ({ round: i + 1, findings: [] })),
    }),
  );
}

function seedLegacyVerification(fixture, fixLoops) {
  const dir = path.join(fixture.dataRoot, 'repos', REPO, 'sessions', TICKET);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'verification.json'), JSON.stringify({ verdict: 'pass', review: { fixLoops } }));
}

function recordOf(fixture) {
  const json = runCli(fixture, ['--json']);
  assert.equal(json.code, 0, json.stderr);
  return JSON.parse(json.stdout);
}

test('fix_loops is counted from the review round ledger, with no verification.json present', () => {
  const root = mkTmp();
  try {
    const fixture = buildDataRoot(root, { schema_version: 1, status: 'active', route: 'direct' });
    seedRounds(fixture, 3); // first review + 2 fix loops

    const record = recordOf(fixture);
    assert.equal(record.fix_loops, 2);
    assert.ok(!unresolvedFields(record).includes('fix_loops'), 'a counted value is not unresolved');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fix_loops prefers the ledger over a stale legacy artifact', () => {
  const root = mkTmp();
  try {
    const fixture = buildDataRoot(root, { schema_version: 1, status: 'active', route: 'direct' });
    seedLegacyVerification(fixture, 0);
    seedRounds(fixture, 2);

    assert.equal(recordOf(fixture).fix_loops, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fix_loops falls back to a pre-portable verification artifact', () => {
  const root = mkTmp();
  try {
    const fixture = buildDataRoot(root, { schema_version: 1, status: 'active', route: 'direct' });
    seedLegacyVerification(fixture, 2);

    assert.equal(recordOf(fixture).fix_loops, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fix_loops with neither artifact is null and named in unresolved - never a fabricated 0', () => {
  const root = mkTmp();
  try {
    const fixture = buildDataRoot(root, { schema_version: 1, status: 'active', route: 'direct' });

    const record = recordOf(fixture);
    assert.equal(record.fix_loops, null);
    assert.ok(unresolvedFields(record).includes('fix_loops'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
