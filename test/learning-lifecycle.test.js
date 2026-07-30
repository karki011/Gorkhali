// Author: Subash karki
// learning-lifecycle.test.js - pins the learning lifecycle ARITHMETIC.
//
// Three behaviours that used to be judgment calls or silent contradictions:
//   1. Injection ranking (hooks/memory-reader.js). Corrections outranked validated
//      patterns AND nothing expired them, so the 5-slot / 1600-char budget was owned
//      permanently by the oldest corrections and no [validated:N] entry was reachable at
//      any prompt. Slots AND chars are now partitioned; both are pinned here, because
//      partitioning slots alone did not fix it - chars are the binding constraint.
//   2. Expiry (scripts/evolution-runner.js). reference/evolution.md exempts [failed]
//      entries from deletion; scanStaleness had no such exemption. Code and prose now
//      agree, and the prose's "unless explicitly overridden" clause has a real reader.
//   3. [validated:N]. Derived from artifacts (cited + observed verification pass), not
//      from an LLM deciding a pattern "was successfully used".
//
// Every test drives a REAL ENTRY POINT as a child process against a temp PHANTOM_DATA
// root, so nothing here can pass by require()-ing an internal that the CLI never calls.
// Dates are deliberately fixed in the far past/near present rather than mocked, so the
// arithmetic under test is the production arithmetic.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'memory-reader.js');
const RUNNER = path.join(REPO_ROOT, 'scripts', 'evolution-runner.js');
const REPO = 'fixture-repo';

// Comfortably outside LEARNING_REMOVE_DAYS (60) no matter when the suite runs.
const ANCIENT = '2020-01-01';

function makeWorkspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-lifecycle-'));
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

function runHook(root, prompt, extra = {}) {
  return execFileSync('node', [HOOK], {
    input: JSON.stringify({ prompt }),
    encoding: 'utf8',
    env: env(root, extra),
  });
}

function runRunner(root, args = [], extra = {}) {
  return execFileSync('node', [RUNNER, ...args], {
    encoding: 'utf8',
    env: env(root, extra),
  });
}

/** Write a session whose artifacts make it count (or not) as validation evidence. */
function writeSession(root, name, { cited, verdict = 'pass', testsObservation = 'checked:pass' }) {
  const dir = path.join(root, 'repos', REPO, 'sessions', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'context.json'), JSON.stringify({
    ticket: name, summary: 'fixture', source: 'args', learningsCited: cited,
  }));
  fs.writeFileSync(path.join(dir, 'verification.json'), JSON.stringify({
    correctness: { lint: true, build: true, tests: true, commands: ['npm test'], observations: { lint: 'checked:pass', build: 'checked:pass', tests: testsObservation } },
    review: { temperature: 0.7, findings: [], fixLoops: 0 },
    simplifyRan: true, intentAlignment: 'aligned', verdict,
  }));
}

const longText = (n) => 'y'.repeat(n);

// ── Injection: both classes must be reachable in one budget ───────────────────

// The regression this whole conversion exists for, and the CHAR partition specifically.
// Sizing matters: two 700-char corrections both fit inside the full ~1525-char budget but
// only one fits inside the correction cap (budget minus the validated reserve). So this
// fixture passes only while the reserve exists - drop the reserve and the second
// correction eats the validated entry's room. A single shorter correction would leave
// slack and let the test pass with the reserve removed, which is a vacuous assertion.
test('injection surfaces a correction AND a validated entry in the same budget', () => {
  const { root } = makeWorkspace({
    'workflow.md': [
      `CORRECTION [c-one]: [${longText(660)}] - [do the other thing] [failed] (2026-07-20)`,
      `CORRECTION [c-two]: [${longText(660)}] - [do the other thing] [failed] (2026-07-19)`,
      'PATTERN [p-short]: a short proven pattern worth surfacing [validated:2] (2026-07-20)',
      '',
    ].join('\n'),
  });

  const out = runHook(root, 'anything at all');
  assert.match(out, /\[failed\]/, 'a [failed] correction must still surface');
  assert.match(out, /\[validated:2\]/, 'a [validated:N] entry must be reachable alongside it');
});

// Slot partition, isolated from the char partition: every correction here is short, so
// only the CORRECTION_SLOTS cap can free a slot for the validated entry.
test('the correction slot cap leaves a slot for a validated entry when corrections outnumber slots', () => {
  const corrections = Array.from({ length: 8 }, (_, i) =>
    `CORRECTION [c-${i}]: [went wrong ${i}] - [fix ${i}] [failed] (2026-07-2${i % 10})`);
  const { root } = makeWorkspace({
    'workflow.md': [...corrections, 'PATTERN [p-win]: proven pattern [validated:3] (2026-06-01)', ''].join('\n'),
  });

  const out = runHook(root, 'anything at all');
  assert.match(out, /\[validated:3\]/, 'eight corrections must not consume all five slots');
  assert.match(out, /\[failed\]/, 'corrections must still surface - this is not a blanket inversion');
});

// The untagged decision, made observable: with exactly one slot reserved for the
// validated class and zero for corrections, an untagged entry must NOT be able to claim
// it - even though it is newer than the validated entry it competes with.
test('an untagged entry does not count as validated and cannot claim the validated reserve', () => {
  const { root } = makeWorkspace({
    'workflow.md': [
      'PATTERN [p-untagged]: newer but never once confirmed by anything (2026-07-25)',
      'PATTERN [p-real]: older and carries a real confirmation [validated:1] (2026-06-01)',
      '',
    ].join('\n'),
  });

  const out = runHook(root, 'anything at all', {
    PHANTOM_INJECTION_SLOTS: '1',
    PHANTOM_INJECTION_CORRECTION_SLOTS: '0',
    PHANTOM_INJECTION_VALIDATED_SLOTS: '1',
  });
  assert.match(out, /p-real/, 'the reserve belongs to the entry with a real [validated:N]');
  assert.doesNotMatch(out, /p-untagged/, 'an untagged entry is validated:0, not validated');
});

// ── Expiry: report-only by default ────────────────────────────────────────────

test('expiry is report-only by default: candidates are printed and the file is untouched', () => {
  const content = `PATTERN [p-old]: an ancient unproven entry (${ANCIENT})\n`;
  const { root, learnings } = makeWorkspace({ 'workflow.md': content });
  const target = path.join(learnings, 'workflow.md');
  const before = fs.readFileSync(target);

  const out = runRunner(root);
  assert.match(out, /Removable \(60\+ days\): 1/, 'the candidate set must be reported');
  assert.match(out, /report-only; pass --prune to act/, 'the report must name the opt-in flag');
  assert.match(out, /p-old/, 'the report must identify WHICH entry it would remove');
  assert.deepEqual(fs.readFileSync(target), before, 'a default run must not modify the file');
});

test('--prune is the opt-in that actually removes an expired untagged entry', () => {
  const { root, learnings } = makeWorkspace({
    'workflow.md': `PATTERN [p-old]: an ancient unproven entry (${ANCIENT})\nPATTERN [p-new]: recent enough to keep (2026-07-20)\n`,
  });
  const target = path.join(learnings, 'workflow.md');

  runRunner(root, ['--prune']);
  const after = fs.readFileSync(target, 'utf8');
  assert.ok(!after.includes('p-old'), '--prune must remove the expired entry');
  assert.ok(after.includes('p-new'), '--prune must not touch entries inside the window');
});

// ── Expiry: the [failed] exemption, code and prose agreeing ───────────────────

test('an ancient [failed] entry is exempt from removal even under --prune', () => {
  const { root, learnings } = makeWorkspace({
    'workflow.md': `CORRECTION [c-ancient]: [went wrong] - [do better] [failed] (${ANCIENT})\n`,
  });
  const target = path.join(learnings, 'workflow.md');
  const before = fs.readFileSync(target);

  const out = runRunner(root, ['--prune']);
  assert.match(out, /PROTECTED as \[failed\]: 1/, 'the exemption must be reported, not silent');
  assert.match(out, /Removable \(60\+ days\): 0/, 'a [failed] entry is never a removal candidate');
  assert.deepEqual(fs.readFileSync(target), before, '--prune alone must not delete a correction');
});

test('--prune-failed is the explicit override the exemption prose promises', () => {
  const { root, learnings } = makeWorkspace({
    'workflow.md': `CORRECTION [c-ancient]: [went wrong] - [do better] [failed] (${ANCIENT})\n`,
  });
  const target = path.join(learnings, 'workflow.md');

  runRunner(root, ['--prune', '--prune-failed']);
  assert.ok(!fs.readFileSync(target, 'utf8').includes('c-ancient'), 'the override must actually release the exemption');
});

test('--prune-failed without --prune is inert: no single flag reaches the corrections', () => {
  const { root, learnings } = makeWorkspace({
    'workflow.md': `CORRECTION [c-ancient]: [went wrong] - [do better] [failed] (${ANCIENT})\n`,
  });
  const target = path.join(learnings, 'workflow.md');
  const before = fs.readFileSync(target);

  const out = runRunner(root, ['--prune-failed']);
  assert.deepEqual(fs.readFileSync(target), before, '--prune-failed must require --prune');
  // The file being unchanged is also true when nothing prunes at all, so it cannot on its
  // own show the override was withheld. The report is what distinguishes them: the entry
  // must still be classified PROTECTED, proving --prune-failed did not take effect.
  assert.match(out, /PROTECTED as \[failed\]: 1/, 'the override must not take effect without --prune');
  assert.doesNotMatch(out, /override active/, 'the override must not report itself as active');
});

// Removal is by line RANGE. A first-line-only delete left continuation lines behind as
// orphaned prose that parses as nothing.
test('removing a wrapped entry deletes its continuation lines too', () => {
  const { root, learnings } = makeWorkspace({
    'workflow.md': [
      `PATTERN [p-wrapped]: first line of an ancient entry (${ANCIENT})`,
      'CONTINUATION-LINE-MARKER wrapped remainder of that same entry',
      '',
      'PATTERN [p-keep]: a recent entry (2026-07-20)',
      '',
    ].join('\n'),
  });
  const target = path.join(learnings, 'workflow.md');

  runRunner(root, ['--prune']);
  const after = fs.readFileSync(target, 'utf8');
  assert.ok(!after.includes('p-wrapped'), 'the entry head must be removed');
  assert.ok(!after.includes('CONTINUATION-LINE-MARKER'), 'the continuation line must go with its head');
  assert.ok(after.includes('p-keep'), 'unrelated entries must survive');
});

// ── Computed validation: derived from artifacts, not judgment ──────────────────

test('validated:N is computed from cited sessions with an observed verification pass', () => {
  const { root } = makeWorkspace({
    'workflow.md': 'PATTERN [p-cited]: a pattern with no tag at all on disk (2026-07-20)\n',
  });
  for (let i = 0; i < 5; i++) writeSession(root, `s-${i}`, { cited: ['p-cited'] });

  const out = runRunner(root);
  assert.match(out, /5 verified session citations/, 'each passing cited session must count once');
  assert.match(out, /\[Tier 2\] Promoted: 1 patterns/, 'a computed count at the threshold must promote an entry that carries no tag');
});

test('a citation from a failed session is not evidence', () => {
  const { root } = makeWorkspace({
    'workflow.md': 'PATTERN [p-cited]: a pattern with no tag at all on disk (2026-07-20)\n',
  });
  for (let i = 0; i < 4; i++) writeSession(root, `s-${i}`, { cited: ['p-cited'] });
  writeSession(root, 's-bad', { cited: ['p-cited'], verdict: 'fail' });

  const out = runRunner(root);
  assert.match(out, /4 verified session citations/, 'a failed session must not be counted');
  assert.match(out, /\[Tier 2\] Promoted: 0 patterns/, 'four is below the promote threshold');
});

test('a pass that was never observed is a claim, not evidence', () => {
  const { root } = makeWorkspace({
    'workflow.md': 'PATTERN [p-cited]: a pattern with no tag at all on disk (2026-07-20)\n',
  });
  for (let i = 0; i < 4; i++) writeSession(root, `s-${i}`, { cited: ['p-cited'] });
  writeSession(root, 's-unobserved', { cited: ['p-cited'], testsObservation: 'not_observed' });

  const out = runRunner(root);
  assert.match(out, /4 verified session citations/, 'verdict pass with tests not_observed must not count');
  assert.match(out, /\[Tier 2\] Promoted: 0 patterns/, 'four is below the promote threshold');
});

test('a computed count keeps an otherwise-expired entry alive', () => {
  const { root, learnings } = makeWorkspace({
    'workflow.md': `PATTERN [p-proven]: ancient but repeatedly proven (${ANCIENT})\n`,
  });
  for (let i = 0; i < 5; i++) writeSession(root, `s-${i}`, { cited: ['p-proven'] });
  const target = path.join(learnings, 'workflow.md');
  const before = fs.readFileSync(target);

  const out = runRunner(root, ['--prune']);
  assert.match(out, /Removable \(60\+ days\): 0/, 'a proven entry is not a removal candidate at any age');
  assert.deepEqual(fs.readFileSync(target), before, 'the entry must survive --prune on computed evidence alone');
});

test('the runner reports the untagged population rather than leaving it invisible', () => {
  const { root } = makeWorkspace({
    'workflow.md': [
      'PATTERN [p-a]: untagged one (2026-07-20)',
      'PATTERN [p-b]: untagged two (2026-07-20)',
      'PATTERN [p-c]: tagged one [validated:1] (2026-07-20)',
      '',
    ].join('\n'),
  });

  assert.match(runRunner(root), /untagged \(= validated:0, unproven and expirable\): 2/);
});

// ── Code and prose must agree ─────────────────────────────────────────────────

// The contradiction K4 was assigned to close: the prose exempted [failed] entries while
// the code did not. Pinned as a two-sided assertion so a future edit cannot silently
// re-open the gap by changing only one side.
test('reference/evolution.md and evolution-runner.js agree on the [failed] exemption', () => {
  const prose = fs.readFileSync(path.join(REPO_ROOT, 'reference', 'evolution.md'), 'utf8');
  const code = fs.readFileSync(RUNNER, 'utf8');

  // Two SEPARATE places must name the flag, asserted separately. A single
  // /`--prune-failed`/ over the whole file is satisfied by either one alone, so deleting
  // the exemption bullet's own reference would pass - the exact shape of vacuous
  // assertion this file exists to avoid.
  assert.match(
    prose,
    /Never delete `\[failed\]` entries[^\n]*`--prune-failed`/,
    'the exemption bullet itself must name the override that makes its "unless overridden" clause real',
  );
  assert.match(prose, /^- `--prune-failed`/m, 'the flag list must document --prune-failed');
  assert.match(prose, /\*\*Removal is report-only by default\.\*\*/, 'the prose must state that removal is report-only by default');
  assert.ok(
    code.includes("includes('--prune-failed')"),
    'evolution-runner.js must actually read --prune-failed; a documented flag with no reader is the defect',
  );
  assert.ok(
    code.includes("includes('--prune')"),
    'evolution-runner.js must actually read --prune',
  );
  assert.match(prose, /`learningsCited: string\[\]`/, 'the prose must name the missing citation field precisely');
});

// ── Concurrency: lifecycle writes must serialize against the capture-path lock ──
//
// hooks/memory-writer.js (via phantom-learning.mjs's withLearningLock) and
// evolution-runner.js's prune/promote/flag-stale writes both rewrite the SAME domain
// files. Before this fix, evolution-runner.js wrote with a bare fs.writeFileSync and
// no lock at all, so a capture graduating an entry into a domain file mid-run could be
// clobbered by a concurrent prune. This test proves REAL mutual exclusion: it holds
// the exact lockfile the capture path holds (`<learnings>/.learning.lock`, same shape
// phantom-learning.mjs's acquireLock writes - see test/repo-dirs-migration.test.js's
// equivalent pattern), then asserts a prune run defers rather than clobbering, and
// proceeds once the lock clears.
test('a prune run defers while the capture-path learnings lock is held, and proceeds once it clears', () => {
  const { root, learnings } = makeWorkspace({
    'workflow.md': `PATTERN [p-ancient]: an ancient, never-cited, never-proven entry (${ANCIENT})\n`,
  });
  const target = path.join(learnings, 'workflow.md');
  const before = fs.readFileSync(target);
  const lockFile = path.join(learnings, '.learning.lock');

  // Simulate a concurrent capture mid-write: a live lock owned by THIS test process
  // (so the runner's own stale-lock check can never judge it dead and take it over).
  fs.writeFileSync(lockFile, JSON.stringify({
    pid: process.pid, token: 'concurrent-capture', created_at: new Date().toISOString(),
  }) + '\n');

  let out;
  try {
    out = runRunner(root, ['--prune']);
  } finally {
    fs.unlinkSync(lockFile);
  }

  assert.deepEqual(fs.readFileSync(target), before,
    'the domain file must be byte-identical - no unlocked write while the capture lock is held');
  assert.match(out, /learnings lock unavailable/, 'contention must be reported, not silently swallowed');
  assert.match(out, /Removed: 0/, 'nothing may be counted as removed while locked out');

  // Lock cleared: the same prune now proceeds normally against the untouched file.
  const out2 = runRunner(root, ['--prune']);
  assert.ok(!fs.readFileSync(target, 'utf8').includes('p-ancient'),
    'once the lock clears, the prune removes the entry as normal');
  assert.match(out2, /Removed: 1/);
});

// ── Honest reporting: a per-domain skip must not be counted as removed ──────────
//
// P1 #4: removeEntries already detects a domain that changed on disk between scan and
// write (TOCTOU) and returns it as skipped, but the caller reported removable.length
// regardless - claiming entries were gone when they were still on disk. This drives a
// REAL race: a domain with a slow `check:` predicate delays the run long enough (before
// the locked write phase starts) for a second write to land on a DIFFERENT domain's
// file, so that domain's on-disk content no longer matches what was scanned by the time
// removeEntries runs.
test('a domain that changes on disk mid-run is skipped, and the removed count/skip are reported honestly', async () => {
  const { root, learnings } = makeWorkspace({
    // A slow predicate creates the race window: predicates are checked BEFORE the
    // locked write phase, so this keeps the process busy while the concurrent write
    // below lands on workflow.md.
    'slow.md': 'PATTERN [p-slow]: entry with a slow predicate to create a race window (2026-07-20) check:`sleep 2`\n',
    'workflow.md': `PATTERN [p-old]: ancient removable entry (${ANCIENT})\n`,
  });
  fs.writeFileSync(path.join(learnings, 'INDEX.md'),
    '- [workflow](workflow.md) - fixture domain\n- [slow](slow.md) - fixture domain\n');
  const target = path.join(learnings, 'workflow.md');

  const child = spawn('node', [RUNNER, '--prune', '--check-predicates'], { env: env(root) });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });

  // Land the concurrent write while the slow predicate is still sleeping, i.e. before
  // removeEntries has run against its scanned snapshot.
  await new Promise((resolve) => setTimeout(resolve, 500));
  fs.appendFileSync(target, 'PATTERN [p-injected]: appended by a concurrent writer mid-run (2026-07-20)\n');

  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(exitCode, 0, `runner must exit 0 (stderr: ${stderr})`);

  const after = fs.readFileSync(target, 'utf8');
  assert.ok(after.includes('p-old'), 'the skipped domain must still hold its unremoved entry on disk - nothing may vanish silently');
  assert.match(out, /changed on disk since scan - skipped/, 'the skip must be reported to the operator');
  assert.match(out, /Removed: 0/, 'a skipped domain must not be counted as removed in the console summary');

  const log = JSON.parse(fs.readFileSync(path.join(root, 'state', 'evolution-log.json'), 'utf8'));
  const last = log.evolutions[log.evolutions.length - 1];
  assert.equal(last.stale_removed, 0, 'the JSON log must report the ACTUAL removed count, not the candidate count');
  assert.equal(last.removable_reported, 1, 'the candidate count is still reported separately');
  assert.deepEqual(last.prune_skipped_changed_on_disk, ['workflow'], 'the skipped domain must be surfaced explicitly, not merely implied by a mismatch');
});

// ── Fail-closed evidence: only an OBSERVED checked:pass counts ──────────────────
//
// sessionPassed used to be a BLACKLIST (only 'not_observed' was rejected), so it wrongly
// accepted a verification with no `observations` at all, or with `observations.tests`
// set to anything else - including 'checked:fail', a FAILING test run miscounted as
// validation evidence. It is now a WHITELIST: the only accepted value is an explicit,
// observed 'checked:pass'. One black-box run pins all six cases through the real CLI.
test('citation counting is a whitelist: only an observed checked:pass counts as evidence', () => {
  const { root } = makeWorkspace({
    'workflow.md': 'PATTERN [p-cited]: probe entry with no tag (2026-07-20)\n',
  });
  const sessionDir = (name) => path.join(root, 'repos', REPO, 'sessions', name);

  // 1. No verification.json at all.
  writeSession(root, 's-no-verification', { cited: ['p-cited'] });
  fs.unlinkSync(path.join(sessionDir('s-no-verification'), 'verification.json'));

  // 2. verdict !== 'pass'.
  writeSession(root, 's-wrong-verdict', { cited: ['p-cited'], verdict: 'fail' });

  // 3. observations absent entirely (verdict pass, but no correctness.observations field).
  writeSession(root, 's-absent-observations', { cited: ['p-cited'] });
  fs.writeFileSync(path.join(sessionDir('s-absent-observations'), 'verification.json'), JSON.stringify({
    correctness: { lint: true, build: true, tests: true, commands: ['npm test'] },
    review: { temperature: 0.7, findings: [], fixLoops: 0 },
    simplifyRan: true, intentAlignment: 'aligned', verdict: 'pass',
  }));

  // 4. observations.tests === 'not_observed' (a claim, not a measurement).
  writeSession(root, 's-not-observed', { cited: ['p-cited'], testsObservation: 'not_observed' });

  // 5. observations.tests === 'checked:fail' (an observed FAILURE - the worst case
  //    for the old blacklist, which accepted this as evidence).
  writeSession(root, 's-checked-fail', { cited: ['p-cited'], testsObservation: 'checked:fail' });

  // 6. The one acceptance case.
  writeSession(root, 's-checked-pass', { cited: ['p-cited'], testsObservation: 'checked:pass' });

  const out = runRunner(root);
  assert.match(out, /1 verified session citations/,
    'only the single observed checked:pass session may count; all five rejection cases must be excluded');
});
