// Author: Subash Karki
// route-report.test.js - EXECUTED tests for the route effectiveness report.
//
// route-report.js scores the router by aggregating outcome.json records per
// SESSION route (lite|direct|plan|brainstorm|full). What is pinned here, watchable
// rather than "it passes":
//
//   1. per-route aggregation is correct, and the merge-rate denominator is
//      SETTLED records only (merged+closed) - open/unset records are excluded
//      from the denominator, not from the report, and the sample is stated
//      before the rate;
//   2. legacy records (outcome.json predating the route field) fall back to
//      session.json for route, bucket under '(unset)' when neither has one, and
//      the explicit-vs-unattributable split is present on BOTH output surfaces -
//      the caveat block never lets a defaulted route pass as a decision;
//   3. an empty corpus exits 0 with an honest zero report, never an error;
//   4. an unknown flag exits 2 (VALIDATION_ERROR);
//   5. an unparseable outcome.json is counted as skipped, never fatal, and
//      nested/off-bucket copies are counted, never aggregated.
//
// Every case builds a real corpus in tmpdir and runs the CLI as a child process
// with GORKHALI_DATA pointed at it; assertions are dual-surface (regex on the
// human stdout AND deepEqual/equal on the --json parse).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'route-report.js');

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'route-report-')));
}

// Write an outcome.json (and optionally a sibling session.json) under a record
// dir, creating parents as needed.
function writeRecord(dataRoot, repo, bucket, ticket, outcome, session) {
  const dir = path.join(dataRoot, 'repos', repo, bucket, ticket);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'outcome.json'), JSON.stringify(outcome, null, 2));
  if (session !== undefined) {
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(session, null, 2));
  }
  return dir;
}

function outcome(route, source, prState, verified = null, fixLoops = null, reviewComments = null) {
  return {
    route,
    route_source: source,
    pr_state: prState,
    verified,
    fix_loops: fixLoops,
    review_comments: reviewComments,
    unresolved: [],
  };
}

function runCli(dataRoot, args = []) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GORKHALI_DATA: dataRoot },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

test('mixed corpus: per-route aggregation with the settled-only merge-rate denominator', () => {
  const data = mkTmp();
  try {
    writeRecord(data, 'r1', 'completed', 'A-1', outcome('plan', 'explicit', 'merged', 'pass', 1, 2));
    writeRecord(data, 'r1', 'completed', 'A-2', outcome('plan', 'explicit', 'merged', 'pass', 3, 4));
    writeRecord(data, 'r1', 'completed', 'A-3', outcome('plan', 'default', 'closed', 'fail', null, null));
    // Open PR: counted in the report, excluded from the merge-rate denominator.
    writeRecord(data, 'r1', 'sessions', 'A-4', outcome('plan', 'explicit', 'open'));
    writeRecord(data, 'r2', 'completed', 'B-1', outcome('direct', 'explicit', 'merged', 'pass', 0, 0));

    const res = runCli(data);
    assert.equal(res.code, 0, res.stderr);
    // The sample is stated before the rate, the denominator is settled-only,
    // and metrics never mix attribution classes: the two explicit merges rate
    // 100% over 2 settled (the explicit open PR is excluded from the
    // denominator), while the defaulted close rates 0% in its OWN block. The
    // old mixed 66.7% (2/3) must not appear anywhere.
    assert.match(res.stdout, /route: plan/);
    assert.match(res.stdout, /records\s+4 \(explicit 3, unattributable 1\)/);
    assert.match(res.stdout, /explicit: 3 record\(s\)/);
    assert.match(res.stdout, /merge rate\s+over 2 settled \(merged\+closed\): 100\.0% \(2\/2\)/);
    assert.match(res.stdout, /unattributable: 1 record\(s\)/);
    assert.match(res.stdout, /merge rate\s+over 1 settled \(merged\+closed\): 0\.0% \(0\/1\)/);
    assert.doesNotMatch(res.stdout, /66\.7%/);
    assert.match(res.stdout, /fix_loops\s+over 2 non-null: mean 2\.00/);
    assert.match(res.stdout, /review_comments\s+over 2 non-null: mean 3\.00/);
    assert.match(res.stdout, /route: direct/);

    const json = JSON.parse(runCli(data, ['--json']).stdout);
    assert.equal(json.records, 5);
    assert.deepEqual(Object.keys(json.perRoute).sort(), ['direct', 'plan']);
    const plan = json.perRoute.plan;
    assert.equal(plan.records, 4);
    assert.deepEqual(plan.attribution, { explicit: 3, unattributable: 1 });
    assert.deepEqual(plan.route_source, { explicit: 3, default: 1 });
    // Explicit block: the two merged + the open record; the defaulted close
    // never contaminates it.
    assert.deepEqual(plan.explicit.pr_state, { merged: 2, open: 1 });
    assert.deepEqual(plan.explicit.merge, { merged: 2, closed: 0, settled: 2, rate: 1 });
    assert.deepEqual(plan.explicit.verified, { pass: 2, '(unset)': 1 });
    assert.deepEqual(plan.explicit.fix_loops, { n: 2, mean: 2 });
    assert.deepEqual(plan.explicit.review_comments, { n: 2, mean: 3 });
    // Unattributable block: the defaulted close, alone.
    assert.deepEqual(plan.unattributable.pr_state, { closed: 1 });
    assert.deepEqual(plan.unattributable.merge, { merged: 0, closed: 1, settled: 1, rate: 0 });
    assert.deepEqual(plan.unattributable.verified, { fail: 1 });
    assert.deepEqual(plan.unattributable.fix_loops, { n: 0, mean: null });
    assert.deepEqual(json.perRoute.direct.explicit.merge, { merged: 1, closed: 0, settled: 1, rate: 1 });
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('legacy records: session.json fallback, (unset) bucket, and the attribution split on both surfaces', () => {
  const data = mkTmp();
  try {
    // outcome.json predates the route field entirely -> session.json supplies it.
    writeRecord(data, 'r1', 'completed', 'L-1', { pr_state: 'merged', verified: 'pass' },
      { route: 'brainstorm', route_source: 'explicit' });
    // Legacy session without route_source: route recovered, attribution unknown.
    writeRecord(data, 'r1', 'completed', 'L-2', { pr_state: 'merged' }, { route: 'brainstorm' });
    // No route anywhere -> '(unset)' bucket, still countable.
    writeRecord(data, 'r1', 'completed', 'L-3', { pr_state: 'closed' });
    // route: null IS a recorded answer (outcome-write resolved it) - no fallback.
    writeRecord(data, 'r1', 'sessions', 'L-4', outcome(null, null, 'open'), { route: 'full', route_source: 'explicit' });

    const res = runCli(data);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /CAVEAT - attribution:/);
    assert.match(res.stdout, /measure a routing DECISION/);
    assert.match(res.stdout, /route: brainstorm/);
    assert.match(res.stdout, /records\s+2 \(explicit 1, unattributable 1\)/);
    assert.match(res.stdout, /route: \(unset\)/);
    assert.match(res.stdout, /records\s+2 \(explicit 0, unattributable 2\)/);

    const json = JSON.parse(runCli(data, ['--json']).stdout);
    assert.match(json.caveat, /measure a routing DECISION/);
    assert.deepEqual(Object.keys(json.perRoute).sort(), ['(unset)', 'brainstorm']);
    assert.deepEqual(json.perRoute.brainstorm.attribution, { explicit: 1, unattributable: 1 });
    assert.deepEqual(json.perRoute.brainstorm.route_source, { explicit: 1, '(unset)': 1 });
    // L-3 (no route field, no session) and L-4 (route recorded as null) both land
    // in '(unset)': a null route is never overwritten by the session fallback.
    assert.equal(json.perRoute['(unset)'].records, 2);
    assert.deepEqual(json.perRoute['(unset)'].attribution, { explicit: 0, unattributable: 2 });
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('empty corpus: exit 0 with an honest zero report', () => {
  const data = mkTmp();
  try {
    const res = runCli(data);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /0 canonical outcome record\(s\)/);
    assert.match(res.stdout, /no outcome records - nothing to aggregate/);
    assert.match(res.stdout, /CAVEAT - attribution:/);

    const json = JSON.parse(runCli(data, ['--json']).stdout);
    assert.equal(json.records, 0);
    assert.deepEqual(json.perRoute, {});
    assert.deepEqual(json.scanned, { nestedCopies: 0, offBucket: 0, skippedUnparseable: 0 });
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('unknown flag exits 2', () => {
  const data = mkTmp();
  try {
    const res = runCli(data, ['--nope']);
    assert.equal(res.code, 2, res.stdout);
    assert.match(res.stderr, /Unknown flag: --nope/);

    const positional = runCli(data, ['some-dir']);
    assert.equal(positional.code, 2, positional.stdout);
    assert.match(positional.stderr, /Unknown argument: some-dir/);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('unparseable outcome.json is counted as skipped; nested and off-bucket copies counted, never aggregated', () => {
  const data = mkTmp();
  try {
    writeRecord(data, 'r1', 'completed', 'OK-1', outcome('plan', 'explicit', 'merged'));
    // Half-written canonical record: skipped and counted, not fatal.
    const brokenDir = path.join(data, 'repos', 'r1', 'completed', 'BROKEN-1');
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(path.join(brokenDir, 'outcome.json'), '{ not valid json');
    // Nested copy under runs/ and an off-bucket legacy copy: counted, excluded.
    const nested = path.join(data, 'repos', 'r1', 'completed', 'OK-1', 'runs', 'x');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'outcome.json'), JSON.stringify(outcome('plan', 'explicit', 'merged')));
    const offBucket = path.join(data, 'repos', 'r1', 'state', 'completed', 'OLD-1');
    fs.mkdirSync(offBucket, { recursive: true });
    fs.writeFileSync(path.join(offBucket, 'outcome.json'), JSON.stringify(outcome('plan', 'explicit', 'merged')));

    const res = runCli(data);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /1 canonical outcome record\(s\)/);
    assert.match(res.stdout, /1 nested copy, 1 off-bucket, 1 unparseable outcome\.json skipped/);

    const json = JSON.parse(runCli(data, ['--json']).stdout);
    assert.equal(json.records, 1, 'only the parseable canonical record aggregates');
    assert.deepEqual(json.scanned, { nestedCopies: 1, offBucket: 1, skippedUnparseable: 1 });
    assert.equal(json.perRoute.plan.records, 1);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('cost join: priced ledgers ride the metrics, uncosted records never enter the mean', () => {
  const data = mkTmp();
  const home = mkTmp();
  try {
    // A-1: ledger + transcript -> priced. One assistant event: 1M input tokens
    // on claude-sonnet-4 -> exactly $3.00 by the cost-report price table.
    const dir = writeRecord(data, 'r1', 'completed', 'A-1', outcome('plan', 'explicit', 'merged', 'pass'));
    const t0 = Date.parse('2026-08-20T10:00:00Z');
    const t1 = Date.parse('2026-08-20T11:00:00Z');
    fs.writeFileSync(path.join(dir, 'costs.json'), JSON.stringify({
      entries: [{ session_id: 'sid-1', opened_at: t0, closed_at: t1 }],
    }));
    const transcriptDir = path.join(home, '.claude', 'projects', 'fake-cwd');
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.writeFileSync(path.join(transcriptDir, 'sid-1.jsonl'), `${JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-20T10:30:00Z',
      message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 1_000_000, output_tokens: 0 } },
    })}\n`);
    // A-2: same route, no ledger -> uncosted. The mean must cover A-1 alone,
    // and the coverage (1 of 2) is printed, never blended.
    writeRecord(data, 'r1', 'completed', 'A-2', outcome('plan', 'explicit', 'merged', 'pass'));

    const env = { ...process.env, GORKHALI_DATA: data, HOME: home };
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /cost\s+over 1 of 2 record\(s\): total \$3\.00, mean \$3\.00/);

    const json = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8', env }).stdout);
    assert.deepEqual(json.perRoute.plan.explicit.cost, { n: 1, total: 3, mean: 3 });
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('cost join: an unpriceable corpus says so, and never reads unknown as $0', () => {
  const data = mkTmp();
  const home = mkTmp();
  try {
    writeRecord(data, 'r1', 'completed', 'N-1', outcome('direct', 'explicit', 'merged', 'pass'));
    const env = { ...process.env, GORKHALI_DATA: data, HOME: home };
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /cost\s+over 0 of 1 record\(s\): no priced cost data/);

    const json = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8', env }).stdout);
    assert.deepEqual(json.perRoute.direct.explicit.cost, { n: 0, total: null, mean: null });
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a hostile route value like "__proto__" does not throw and is counted as data', () => {
  const data = mkTmp();
  try {
    writeRecord(data, 'r1', 'completed', 'H-1', outcome('__proto__', null, 'merged'));
    writeRecord(data, 'r1', 'completed', 'H-2', outcome('constructor', null, 'closed'));

    const res = runCli(data);
    assert.equal(res.code, 0, res.stderr);

    const json = JSON.parse(runCli(data, ['--json']).stdout);
    assert.equal(json.records, 2);
    assert.equal(json.perRoute['__proto__'].records, 1);
    assert.equal(json.perRoute.constructor.records, 1);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});
