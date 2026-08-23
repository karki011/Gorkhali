// Author: Subash.karki
// route-bias.test.js - EXECUTED tests for scripts/route-bias.js, the router's
// measurement loop. Pinned, watchable:
//   1. small samples REFUSE to tune the router (dry-run says so, --apply exits 2);
//   2. the proposal math: per-route signals from verified pass rates, record-
//      weighted delta, clamped to ±0.3;
//   3. current bias comes from the newest PATTERN [routing-bias] learnings entry;
//   4. dry-run writes nothing; --apply appends exactly the printed entry.
// Fixtures mirror test/route-report.test.js: a real corpus in tmpdir, CLI as a
// child process with GORKHALI_DATA pointed at it.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'route-bias.js');
const bias = require('../scripts/route-bias');

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'route-bias-')));
}

function writeRecord(dataRoot, ticket, route, verified, source = 'explicit') {
  const dir = path.join(dataRoot, 'repos', 'r1', 'completed', ticket);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'outcome.json'), JSON.stringify({
    route, route_source: source, pr_state: 'merged', verified, unresolved: [],
  }));
}

// n records for a route, `passed` of them verified 'pass'.
function seedRoute(dataRoot, route, n, passed, startIndex = 0) {
  for (let i = 0; i < n; i++) {
    writeRecord(dataRoot, `${route.toUpperCase()}-${startIndex + i}`, route, i < passed ? 'pass' : 'fail');
  }
}

function runCli(dataRoot, args = []) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GORKHALI_DATA: dataRoot },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

test('below the minimum sample the router is never tuned', () => {
  const data = mkTmp();
  const learnings = mkTmp();
  try {
    seedRoute(data, 'direct', 9, 9);
    const res = runCli(data, ['--learnings', learnings]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /REFUSED: 9 explicit record\(s\) < min sample 10/);
    assert.match(res.stdout, /small sample must not tune the router/i);

    const applied = runCli(data, ['--learnings', learnings, '--apply']);
    assert.equal(applied.code, 2, applied.stdout);
    assert.match(applied.stderr, /refusing to apply/);
    assert.ok(!fs.existsSync(path.join(learnings, 'shadows.md')), 'a refused apply writes nothing');
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(learnings, { recursive: true, force: true });
  }
});

test('the proposal is the record-weighted signal mean, and unattributable records never count', () => {
  const data = mkTmp();
  const learnings = mkTmp();
  try {
    // direct: 10/10 pass (signal -1, weight 10); plan: 0/2 pass (signal +1, weight 2).
    // weighted mean = (-10 + 2)/12 -> delta = round2(0.10 * -0.667) = -0.07.
    seedRoute(data, 'direct', 10, 10);
    seedRoute(data, 'plan', 2, 0);
    // A defaulted-route record measures the default, not a decision: excluded.
    writeRecord(data, 'LEGACY-1', 'direct', 'fail', 'default');

    const res = runCli(data, ['--learnings', learnings]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /sample: 12 explicit-route record\(s\) \(\+1 unattributable/);
    assert.match(res.stdout, /route: direct/);
    assert.match(res.stdout, /pass rate\s+over 10 record\(s\): 100\.0% \(10\/10\)/);
    assert.match(res.stdout, /pass rate\s+over 2 record\(s\): 0\.0% \(0\/2\)/);
    assert.match(res.stdout, /current bias:\s+\+0\.00/);
    assert.match(res.stdout, /proposed delta:\s+-0\.07/);
    assert.match(res.stdout, /proposed bias:\s+-0\.07 \(clamped to ±0\.3\)/);
    assert.match(res.stdout, /dry-run only - re-run with --apply/);
    assert.ok(!fs.existsSync(path.join(learnings, 'shadows.md')), 'dry-run writes nothing');
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(learnings, { recursive: true, force: true });
  }
});

test('the proposal clamps at +0.3 and reads the current bias from the newest entry', () => {
  const data = mkTmp();
  const learnings = mkTmp();
  try {
    seedRoute(data, 'direct', 10, 0); // all failing: signal +1, delta +0.10
    fs.writeFileSync(path.join(learnings, 'shadows.md'),
      '# Shadows\n\nPATTERN [routing-bias]: correction.bias +0.15 - older (2026-08-01)\n'
      + 'PATTERN [routing-bias]: correction.bias +0.28 - newest wins (2026-08-10)\n');

    const res = runCli(data, ['--learnings', learnings]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /current bias:\s+\+0\.28/);
    assert.match(res.stdout, /proposed bias:\s+\+0\.30 \(clamped to ±0\.3\)/);

    const json = JSON.parse(runCli(data, ['--learnings', learnings, '--json']).stdout);
    assert.equal(json.current_bias, 0.28);
    assert.equal(json.proposed_bias, 0.3);
    assert.equal(json.applied, false);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(learnings, { recursive: true, force: true });
  }
});

test('--apply appends exactly the printed entry, and the next run reads it as current', () => {
  const data = mkTmp();
  const learnings = mkTmp();
  try {
    seedRoute(data, 'direct', 10, 10); // delta -0.10 from 0

    const dry = JSON.parse(runCli(data, ['--learnings', learnings, '--json']).stdout);
    assert.equal(dry.proposed_bias, -0.1);

    const applied = runCli(data, ['--learnings', learnings, '--apply']);
    assert.equal(applied.code, 0, applied.stderr);
    const shadows = fs.readFileSync(path.join(learnings, 'shadows.md'), 'utf8');
    assert.ok(shadows.includes(dry.entry), 'the written line is byte-identical to the dry-run entry');
    assert.match(shadows, /PATTERN \[routing-bias\]: correction\.bias -0\.10/);

    const after = JSON.parse(runCli(data, ['--learnings', learnings, '--json']).stdout);
    assert.equal(after.current_bias, -0.1, 'the applied entry becomes the current bias');
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(learnings, { recursive: true, force: true });
  }
});

test('unit: currentBias parses the newest entry only, propose() signals by pass rate', () => {
  assert.equal(bias.currentBias(''), 0);
  assert.equal(bias.currentBias('PATTERN [routing-bias]: correction.bias -0.20 - x (2026-08-01)\n'), -0.2);
  assert.equal(
    bias.currentBias(
      'PATTERN [routing-bias]: correction.bias +0.05 - old (2026-08-01)\n'
      + 'PATTERN [other-kw]: correction.bias +0.99 - not ours (2026-08-02)\n',
    ),
    0.05,
    'an entry with a different keyword is not a routing bias',
  );

  const proposal = bias.propose({
    routes: {
      lite: { records: 4, passed: 4, costN: 0, costSum: 0 },
      full: { records: 4, passed: 1, costN: 0, costSum: 0 },
      plan: { records: 5, passed: 4, costN: 0, costSum: 0 }, // 80%: between the floors, hold
    },
  });
  assert.equal(proposal.perRoute.lite.signal, -1);
  assert.equal(proposal.perRoute.full.signal, 1);
  assert.equal(proposal.perRoute.plan.signal, 0, 'a middling pass rate holds');
  // (-4 + 4 + 0)/13 = 0 -> no delta from a balanced corpus.
  assert.equal(proposal.delta, 0);
});

test('an unknown flag exits 2', () => {
  const res = runCli(mkTmp(), ['--nope']);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /unknown option: --nope/);
});
