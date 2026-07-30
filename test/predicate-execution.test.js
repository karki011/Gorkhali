// Author: Subash Karki
// predicate-execution.test.js - pins the K5 executable-predicate mechanism: the
// check:`<shell command>` clause parsed by scripts/lib/learning-grammar.cjs and
// executed (only under explicit opt-in) by scripts/evolution-runner.js.
//
// The live proof this exists for: `no-greptile-this-repo` in learnings/workflow.md
// asserted the Greptile app is NOT installed on this repo. greptile-apps[bot] both
// commented and submitted a review on PR #97 - the claim was false, was injected into
// prompts as true, and nothing could tell. A learning that asserts an environmental
// fact needs a machine-checkable predicate so it can invalidate itself.
//
// SECURITY IS THE POINT OF THIS FILE. A learnings file is data - it is written by an
// LLM, merged and synced between repos, and read on the prompt-injection hot path.
// Every test below either proves an opt-in gate holds, or proves the one place that
// must NEVER execute (hooks/memory-reader.js) still doesn't.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const RUNNER = path.join(REPO_ROOT, 'scripts', 'evolution-runner.js');
const HOOK = path.join(REPO_ROOT, 'hooks', 'memory-reader.js');
const REPO = 'fixture-repo';

function makeWorkspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-predicate-'));
  const learnings = path.join(root, 'repos', REPO, 'learnings');
  fs.mkdirSync(learnings, { recursive: true });
  fs.writeFileSync(path.join(learnings, 'INDEX.md'), '- [workflow](workflow.md) - fixture domain\n');
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(learnings, name), content);
  }
  return { root, learnings };
}

function env(root, extra = {}) {
  return { ...process.env, PHANTOM_DATA: root, PHANTOM_REPO: REPO, ...extra };
}

function runRunner(root, args = []) {
  return execFileSync('node', [RUNNER, ...args], { encoding: 'utf8', env: env(root) });
}

// ── Requirement 1: memory-reader.js never executes, on any read path ─────────────

test('memory-reader.js source contains no child-process execution', () => {
  const src = fs.readFileSync(HOOK, 'utf8');
  assert.doesNotMatch(src, /require\(['"]child_process['"]\)/, 'memory-reader.js must never import child_process');
  assert.doesNotMatch(src, /\bexecSync\b|\bspawnSync\b|\bexecFileSync\b|\bexec\(|\bspawn\(/, 'memory-reader.js must never call an execution primitive');
});

test('memory-reader.js stays non-empty against a hermetic learnings fixture (regression smoke)', () => {
  // Was: invoked with no env override, so it resolved learningsDir() against the
  // developer's real ~/.phantom data. That passes on a machine with learnings on disk
  // and produces 0 bytes on a clean CI runner - the hook was correctly emitting nothing
  // for an empty state, but the test asserted "non-empty" unconditionally. Build the
  // learnings fixture the same way every other test in this file does, so the assertion
  // is checking the hook's behavior, not the developer's disk.
  const { root } = makeWorkspace({
    'workflow.md': [
      'PATTERN [p-smoke]: a validated entry the hook should inject (2026-07-20) [validated:1]',
      '',
    ].join('\n'),
  });

  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ prompt: 'nul byte binary diff' }),
    encoding: 'utf8',
    env: env(root),
  });

  assert.match(out, /<!-- memory-injection -->/, 'memory-reader.js must emit the injection block when learnings exist');
});

// ── Requirement: default run parses and COUNTS but never executes ────────────────

test('default run reports the predicate population but never executes one', () => {
  const { root } = makeWorkspace({
    'workflow.md': [
      `PATTERN [p-side]: an entry whose predicate has an observable side effect (2026-07-20) check:\`echo ran >> "\${SIDE_EFFECT_FILE}"\``,
      '',
    ].join('\n'),
  });
  const sideEffectFile = path.join(root, 'side-effect.txt');

  const out = execFileSync('node', [RUNNER], {
    encoding: 'utf8',
    env: env(root, { SIDE_EFFECT_FILE: sideEffectFile }),
  });

  assert.match(out, /1 entries carry a check: predicate/, 'the population must be reported');
  assert.doesNotMatch(out, /\[Predicates\] Checked/, 'a default run must not report a checked count - it never ran anything');
  assert.equal(fs.existsSync(sideEffectFile), false, 'a default run must not execute a predicate - the side effect must not appear');
});

// ── --check-predicates: executes and reports pass/fail, writes nothing ───────────

test('--check-predicates runs predicates and reports pass/fail without writing', () => {
  const { root, learnings } = makeWorkspace({
    'workflow.md': [
      'PATTERN [p-pass]: a predicate that exits zero (2026-07-20) check:`true`',
      'PATTERN [p-fail]: a predicate that exits non-zero (2026-07-20) check:`false`',
      '',
    ].join('\n'),
  });
  const target = path.join(learnings, 'workflow.md');
  const before = fs.readFileSync(target);

  const out = runRunner(root, ['--check-predicates']);

  assert.match(out, /Checked 2: 1 pass, 1 fail/, 'both predicates must be executed and counted correctly');
  assert.match(out, /p-pass/);
  assert.match(out, /p-fail/);
  assert.deepEqual(fs.readFileSync(target), before, '--check-predicates alone must not write to the file');
});

// ── --flag-stale requires --check-predicates; only failing entries are flagged ───

test('--check-predicates alone does not write [stale]; --flag-stale does, and only on the failing entry', () => {
  const { root, learnings } = makeWorkspace({
    'workflow.md': [
      'PATTERN [p-pass]: a predicate that exits zero (2026-07-20) check:`true`',
      'PATTERN [p-fail]: a predicate that exits non-zero (2026-07-20) check:`false`',
      '',
    ].join('\n'),
  });
  const target = path.join(learnings, 'workflow.md');

  runRunner(root, ['--check-predicates']);
  assert.doesNotMatch(fs.readFileSync(target, 'utf8'), /\[stale\]/, '--check-predicates alone must never write [stale]');

  runRunner(root, ['--check-predicates', '--flag-stale']);
  const after = fs.readFileSync(target, 'utf8');
  const passLine = after.split('\n').find((l) => l.includes('p-pass'));
  const failLine = after.split('\n').find((l) => l.includes('p-fail'));
  assert.doesNotMatch(passLine, /\[stale\]/, 'a passing predicate must not be flagged stale');
  assert.match(failLine, /\[stale\]/, 'a failing predicate must be flagged stale');
});

// ── Summary line: "identified" and "written" are different numbers, not one ─────
//
// Review finding, confidence 4/5: the console summary's stale count conflated two
// unrelated things under one word. `stale.length` (Tier 1, age-based) is how many
// entries the scan FOUND old enough to flag - it never writes anything. The number of
// entries `--flag-stale` actually wrote `[stale]` onto is `staleFlagResult.flagged`,
// a completely different count driven by predicate failures, not age. With one entry
// that is old by age but has a PASSING predicate, and one that is fresh by age but has
// a FAILING predicate, the two counts must diverge and the summary must report both.
test('the summary reports entries identified by age and entries actually flagged by predicate as separate counts', () => {
  // 40 days old: inside the [STALE_DAYS(30), REMOVE_DAYS(60)) window, so Tier 1's age
  // scan identifies it as stale. It must NOT land in REMOVE_DAYS territory (that would
  // make it "removable" instead, a different bucket entirely).
  const staleWindowDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { root } = makeWorkspace({
    'workflow.md': [
      // Old enough for Tier 1 to "identify" as stale, but its predicate passes -
      // must NOT be counted in the actual-write figure.
      `PATTERN [p-old-passing]: 40 days old, predicate still holds (${staleWindowDate}) check:\`true\``,
      // Fresh by age - Tier 1 will not identify it - but its predicate fails, so
      // --flag-stale must write [stale] onto it.
      'PATTERN [p-fresh-failing]: recent by age, predicate fails (2026-07-20) check:`false`',
      '',
    ].join('\n'),
  });

  const out = runRunner(root, ['--check-predicates', '--flag-stale']);

  assert.match(out, /Stale identified \(\d+\+ days\): 1/, 'age-based identification must count only the 40-day-old entry');
  assert.match(out, /Stale flagged \(predicate\): 1/, 'the predicate-write count must count only the failing entry, a different one than the age-identified entry');
});

// ── --prune and --flag-stale together: pruning must not blind the flagger ───────
//
// P1 #3: removeEntries ran before flagEntriesStale, and flagEntriesStale's own TOCTOU
// guard compares onDisk against the PRE-prune snapshot, so the prune's own write made
// the guard treat the run as a concurrent external writer and silently skip the domain
// - a retained entry with a failing predicate never got [stale]. The fix must also not
// write the flag onto the WRONG line: p-mid sits between the removable entry and the
// retained failing one, so if a line-number shift from the prune were not accounted
// for, the flag would land on p-mid instead of p-fail. Both effects are asserted here.
test('--prune removes a candidate AND --flag-stale still tags the correct retained entry', () => {
  const { root, learnings } = makeWorkspace({
    'workflow.md': [
      'PATTERN [p-old]: an ancient removable entry (2020-01-01)',
      'PATTERN [p-mid]: a decoy entry that must never be touched (2026-07-20)',
      'PATTERN [p-fail]: a retained entry whose predicate fails (2026-07-20) check:`false`',
      '',
    ].join('\n'),
  });
  const target = path.join(learnings, 'workflow.md');

  const out = runRunner(root, ['--prune', '--check-predicates', '--flag-stale']);
  const after = fs.readFileSync(target, 'utf8');

  assert.doesNotMatch(out, /changed on disk since scan - skipped/, 'the prune must not blind the flagger to its own write');
  assert.ok(!after.includes('p-old'), '--prune must still remove the expired candidate');
  const midLine = after.split('\n').find((l) => l.includes('p-mid'));
  const failLine = after.split('\n').find((l) => l.includes('p-fail'));
  assert.ok(midLine, 'the decoy entry must survive');
  assert.ok(failLine, 'the retained failing-predicate entry must survive');
  assert.doesNotMatch(midLine, /\[stale\]/, 'a line-number shift must not tag the wrong (decoy) entry');
  assert.match(failLine, /\[stale\]/, 'the entry whose predicate actually failed must be tagged, on its own line');
});

test('--flag-stale without --check-predicates is inert: no single flag executes or writes', () => {
  const { root, learnings } = makeWorkspace({
    'workflow.md': 'PATTERN [p-fail]: a predicate that exits non-zero (2026-07-20) check:`false`\n',
  });
  const target = path.join(learnings, 'workflow.md');
  const before = fs.readFileSync(target);

  const out = runRunner(root, ['--flag-stale']);
  assert.doesNotMatch(out, /\[Predicates\] Checked/, '--flag-stale alone must not execute anything');
  assert.deepEqual(fs.readFileSync(target), before, '--flag-stale alone must not write to the file');
});

// ── A timing-out predicate counts as FAILED, never as passed ─────────────────────

test('a timing-out predicate counts as failed, not passed', () => {
  const { root } = makeWorkspace({
    'workflow.md': 'PATTERN [p-hang]: a predicate that never exits (2026-07-20) check:`sleep 20`\n',
  });

  const start = Date.now();
  const out = runRunner(root, ['--check-predicates']);
  const elapsedMs = Date.now() - start;

  assert.match(out, /Checked 1: 0 pass, 1 fail/, 'a hang must be counted as a failure, never a pass');
  assert.match(out, /TIMED OUT/, 'a timeout must be distinguishable in the report from an ordinary non-zero exit');
  assert.ok(elapsedMs < 15000, `the runner must not wait out the full 20s sleep (took ${elapsedMs}ms)`);
});

// ── Local canonical dir only: execution never reaches outside the resolved dir ───

test('execution only ever considers entries from the resolved local learnings dir', () => {
  // A predicate placed in a domain file OUTSIDE the resolved learnings dir (a sibling
  // directory that a merge/sync could plausibly drop a file into) must never run, because
  // readDomainFiles only ever reads LEARNINGS_DIR = learningsDir(REPO).
  const { root, learnings } = makeWorkspace({
    'workflow.md': 'PATTERN [p-local]: lives in the real learnings dir (2026-07-20) check:`true`\n',
  });
  const outsideDir = path.join(root, 'repos', REPO, 'not-learnings');
  fs.mkdirSync(outsideDir, { recursive: true });
  const outsideSideEffect = path.join(root, 'outside-side-effect.txt');
  fs.writeFileSync(
    path.join(outsideDir, 'sneaky.md'),
    `PATTERN [p-outside]: must never execute (2026-07-20) check:\`touch "${outsideSideEffect}"\`\n`,
  );

  const out = runRunner(root, ['--check-predicates']);
  assert.match(out, /Checked 1: 1 pass, 0 fail/, 'only the entry inside the resolved learnings dir is executed');
  assert.doesNotMatch(out, /p-outside/, 'an entry outside the resolved dir must never be considered');
  assert.equal(fs.existsSync(outsideSideEffect), false, 'a predicate outside the resolved dir must never run');
  // Sanity: the fixture's own learnings dir IS the one that got used.
  assert.ok(fs.existsSync(path.join(learnings, 'workflow.md')));
});
