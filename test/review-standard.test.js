// Author: Subash Karki
// review-standard.test.js — B10. F9 counted four severity vocabularies, three
// finding shapes and two spellings of one array, all stated in prose, with
// nothing enforcing agreement. This file pins the collapse and, more
// importantly, pins the MECHANISM that keeps it collapsed:
//
//   1. one scale, sourced from scripts/lib/review-standard.js, enforced by the
//      validator — an unknown severity is rejected, a legacy one is normalized;
//   2. one shape — every legacy key folds onto its canonical key, and folding
//      NEVER moves a B9 finding id;
//   3. the reviewer prose is GENERATED from (1) and (2), so a hand-edit fails
//      `--check` in CI rather than quietly becoming a fifth vocabulary;
//   4. no P0-P3 severity vocabulary survives anywhere in the review prose.
//
// Validator tests spawn the REAL CLI, so exit codes and stderr are production
// paths.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-artifact.js');
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'gen-review-standard.js');
const MIGRATOR = path.join(REPO_ROOT, 'scripts', 'migrate-review-findings.js');

const std = require('../scripts/lib/review-standard');
const rf = require('../scripts/lib/review-finding');
const lc = require('../hooks/loop-controller');
const gen = require('../scripts/gen-review-standard');

function run(bin, args) {
  try {
    return { code: 0, stdout: execFileSync('node', [bin, ...args], { encoding: 'utf-8' }), stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: (e.stdout || '').toString(),
      stderr: (e.stderr || '').toString(),
    };
  }
}

function validate(artifact) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-standard-'));
  const file = path.join(dir, 'auditor.json');
  fs.writeFileSync(file, JSON.stringify(artifact, null, 2));
  try {
    return run(VALIDATOR, ['review', file]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const artifact = (findings) => ({ role: 'auditor', verdict: 'fail', findings, observationGaps: [] });
const finding = (overrides = {}) => ({
  severity: 'blocking',
  file: 'src/pay/refund.ts',
  line: 88,
  evidence: 'issueRefund() calls charge.capture() after the early return on line 84',
  impact: 'A partial refund silently no-ops',
  remediation: 'Move the capture above the return',
  ...overrides,
});

// --- (e) ONE SCALE -----------------------------------------------------------

test('the scale has exactly two values, and both are the ones the corpus already uses', () => {
  assert.deepEqual(std.SEVERITY_VALUES, ['blocking', 'advisory']);
});

test('every value of all four F9 vocabularies resolves onto the one scale', () => {
  const expected = {
    // auditor (already canonical)
    blocking: 'blocking', advisory: 'advisory',
    // justice P0-P2 and temperature-review P0-P3
    P0: 'blocking', P1: 'blocking', P2: 'advisory', P3: 'advisory',
    // the verification schema's fifth spelling
    warn: 'advisory',
  };
  for (const [input, want] of Object.entries(expected)) {
    assert.equal(std.normalizeSeverity(input), want, `${input} must resolve to ${want}`);
    assert.equal(std.normalizeSeverity(input.toLowerCase()), want, 'case is formatting, not vocabulary');
  }
});

test('a severity in NO vocabulary is rejected, and the error names both legal values', () => {
  const res = validate(artifact([finding({ severity: 'kinda bad' })]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[0\]\.severity: must be one of blocking\|advisory/);
  assert.match(res.stderr, /got "kinda bad"/);
});

test('a legacy P0 artifact still validates - nothing on disk starts failing', () => {
  const res = validate(artifact([{ temperature: 'P0', file: 'src/Example.tsx', line: 42, issue: 'Null check missing', fix: 'Optional chaining' }]));
  assert.equal(res.code, 0, `legacy artifacts must keep validating, stderr: ${res.stderr}`);
});

// --- (e) ONE SHAPE -----------------------------------------------------------

test('all three F9 finding shapes normalize to the same canonical object', () => {
  const auditor = { severity: 'blocking', file: 'src/a.ts', line: 7, evidence: 'the claim', remediation: 'the fix' };
  const temperature = { temperature: 'P0', file: 'src/a.ts', line: 7, issue: 'the claim', fix: 'the fix' };
  const verification = { severity: 'P0', component: 'src/a.ts', line: 7, message: 'the claim', remediation: 'the fix' };

  for (const legacy of [temperature, verification]) {
    assert.deepEqual(
      std.normalizeFinding(legacy),
      std.normalizeFinding(auditor),
      'three shapes, one canonical result'
    );
  }
});

test('normalizing a finding NEVER moves its B9 id (the corpus is not re-id-ed)', () => {
  const legacy = [
    { temperature: 'P1', file: 'src/a.ts', line: 7, issue: 'the claim' },
    { severity: 'warn', component: 'src/a.ts', line: 7, message: 'the claim' },
    { severity: 'P2', file: './src/a.ts', description: 'THE CLAIM  ' },
  ];
  for (const f of legacy) {
    assert.equal(rf.findingId(std.normalizeFinding(f)), rf.findingId(f), 'normalization is id-preserving');
  }
  // And all three are the SAME finding: same file, same claim.
  const ids = new Set(legacy.map((f) => rf.findingId(f)));
  assert.equal(ids.size, 1, 'one claim about one file is one id whichever vocabulary wrote it');
});

test('observationGaps is the one spelling, and the legacy one is read, not rejected', () => {
  assert.equal(std.GAPS_KEY, 'observationGaps');
  assert.equal(validate({ role: 'auditor', verdict: 'pass', findings: [], observation_gaps: [] }).code, 0);
  const normalized = std.normalizeReview({ role: 'auditor', findings: [], observation_gaps: ['x'] });
  assert.deepEqual(normalized.observationGaps, ['x']);
  assert.equal('observation_gaps' in normalized, false, 'the legacy key does not survive normalization');
});

// --- (a) EVIDENCE IS A CITATION ---------------------------------------------

test('a blocking finding with no line is rejected: a name is not evidence', () => {
  const res = validate(artifact([finding({ line: undefined, evidence: 'validateInput() does not appear to validate anything' })]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[0\]\.line: required for a blocking finding/);
  assert.match(res.stderr, /not an inference from a symbol name/);
});

test('the same claim as an advisory is accepted - only a blocking claim must cite a line', () => {
  assert.equal(validate(artifact([finding({ line: undefined, severity: 'advisory' })])).code, 0);
  assert.equal(validate(artifact([finding()])).code, 0, 'a cited blocking finding is fine');
});

test('a legacy P0 with no line is caught too - the rule follows the meaning, not the spelling', () => {
  const res = validate(artifact([{ temperature: 'P0', file: 'src/a.ts', issue: 'looks wrong' }]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /line: required for a blocking finding/);
});

// --- (b) PRE-EXISTING REPORTS, NEVER BLOCKS ---------------------------------

test('preExisting + blocking is rejected; preExisting + advisory validates', () => {
  const bad = validate(artifact([finding({ preExisting: true })]));
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /a pre-existing defect reports and never blocks/);

  const ok = validate(artifact([finding({ preExisting: true, severity: 'advisory' })]));
  assert.equal(ok.code, 0, `stderr: ${ok.stderr}`);
});

test('a pre-existing finding closes as deferred even when the loop changed its file', () => {
  const pre = finding({ severity: 'advisory', preExisting: true });
  const real = finding({ evidence: 'the diff introduced this one', file: 'src/pay/refund.ts' });
  const v = { review: { temperature: 0.7, findings: [pre, real], fixLoops: 1 } };

  const result = lc.closeFixLoop(v, { changedFiles: ['src/pay/refund.ts'] });

  assert.equal(v.review.findings[0].disposition, 'deferred', 'it never entered the loop, so the loop did not fix it');
  assert.equal(v.review.findings[0].dispositionReason, std.PRE_EXISTING_DEFER_REASON);
  assert.equal(v.review.findings[1].disposition, 'fixed', 'the finding the diff DID cause is attributed normally');
  assert.deepEqual(result.counts, { fixed: 1, dismissed: 0, deferred: 1 });
  assert.equal(result.rows[0].preExisting, true, 'the per-finding row carries the flag a miner needs');
});

test('the fix loop may act only on blocking, non-preExisting findings', () => {
  const findings = [
    finding({ evidence: 'blocking, introduced here' }),
    finding({ severity: 'advisory', evidence: 'advisory' }),
    finding({ severity: 'advisory', preExisting: true, evidence: 'pre-existing' }),
    { temperature: 'P0', file: 'src/legacy.ts', line: 3, issue: 'legacy vocabulary, still blocking' },
  ];
  const selected = lc.fixLoopFindings(findings).map((f) => f.evidence || f.issue);
  assert.deepEqual(selected, ['blocking, introduced here', 'legacy vocabulary, still blocking']);
});

// --- Justice's dimension becomes a FIELD, not just chat output ---------------

test("a finding may carry one of Justice's five dimensions, and nothing else", () => {
  assert.deepEqual(std.DIMENSIONS, [
    'cross-file-coherence', 'regression', 'semantic-accuracy', 'dead-code', 'convention-deviation',
  ]);
  for (const dimension of std.DIMENSIONS) {
    assert.equal(validate(artifact([finding({ dimension })])).code, 0, `${dimension} must validate`);
  }
  const res = validate(artifact([finding({ dimension: 'vibes' })]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[0\]\.dimension: must be one of cross-file-coherence\|regression/);
  assert.equal(validate(artifact([finding()])).code, 0, 'the key stays optional - Auditor has no dimension vocabulary');
});

test('agents/justice.md tells Justice to carry the dimension into the artifact', () => {
  const justice = fs.readFileSync(path.join(REPO_ROOT, 'agents', 'justice.md'), 'utf8');
  for (const dimension of std.DIMENSIONS) assert.ok(justice.includes(dimension), `justice.md must name ${dimension}`);
  assert.match(justice, /Carry\s+the dimension from your output format INTO the artifact/);
});

// --- (c) THE BLOCKING BAR ---------------------------------------------------

test('the blocking bar is stated once, in data, and says "worse than before"', () => {
  const blocking = std.SEVERITIES.find((s) => s.value === 'blocking');
  assert.match(blocking.bar, /WORSE than it was before/);
  assert.match(blocking.bar, /fails the stated intent/);
  assert.match(std.BLOCKING_BAR.text, /judged against the PRIOR state of the code rather than the repository ideal/);
});

// --- (d) NAMED SECURITY CATEGORIES ------------------------------------------

test('the six OWASP-anchored categories are named, and reach the shared review standard verbatim', () => {
  const names = std.SECURITY_CATEGORIES.map((c) => c.name);
  assert.deepEqual(names, [
    'Broken access control (including SSRF)',
    'Injection',
    'Cryptographic failures',
    'Secrets in code, config or logs',
    'Unsafe defaults',
    'Data exposure',
  ]);
  const standard = fs.readFileSync(path.join(REPO_ROOT, 'reference', 'review-standard.md'), 'utf8');
  for (const name of names) assert.ok(standard.includes(name), `reference/review-standard.md must name "${name}"`);
  // The reviewer prompts no longer carry the blocks inline - they point at the
  // shared standard and read it at runtime.
  for (const agent of ['auditor', 'justice']) {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'agents', `${agent}.md`), 'utf8');
    assert.ok(
      text.includes('cat "$PR/reference/review-standard.md"'),
      `agents/${agent}.md must read reference/review-standard.md at runtime`,
    );
    assert.ok(!text.includes('BEGIN GENERATED'), `agents/${agent}.md must not carry generated blocks inline`);
  }
});

// --- (e) DRIFT-PROOFING: the prose is generated, and CI checks it ------------

test('--check reports the checked-in reviewer prose as in sync, and writes nothing', () => {
  const before = gen.TARGET_FILES.map((f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'));
  const res = run(GENERATOR, ['--check']);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /in sync with scripts\/lib\/review-standard\.js/);
  const after = gen.TARGET_FILES.map((f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'));
  assert.deepEqual(after, before, '--check must not write');
});

test('hand-editing a generated severity table fails --check with exit 2 and names the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-standard-drift-'));
  fs.cpSync(REPO_ROOT, dir, {
    recursive: true,
    filter: (src) => !/(^|\/)(\.git|node_modules)(\/|$)/.test(src.slice(REPO_ROOT.length)),
  });
  try {
    const standard = path.join(dir, 'reference', 'review-standard.md');
    fs.writeFileSync(
      standard,
      fs.readFileSync(standard, 'utf8').replace('| `advisory` |', '| `P2` |')
    );
    const res = run(GENERATOR, ['--check', '--dir', dir]);
    assert.equal(res.code, 2, 'doc drift is VALIDATION_ERROR -> exit 2');
    assert.match(res.stderr, /Review-standard prose is out of date: reference\/review-standard\.md/);

    // ...and regenerating puts it back, byte for byte.
    assert.equal(run(GENERATOR, ['--dir', dir]).code, 0);
    assert.equal(
      fs.readFileSync(standard, 'utf8'),
      fs.readFileSync(path.join(REPO_ROOT, 'reference', 'review-standard.md'), 'utf8')
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every block the standard defines is rendered into at least one file', () => {
  // A block defined here but wired to no target is prose that exists in the
  // source of truth and reaches no reviewer - the drift F9 named, inverted.
  const rendered = new Set(Object.values(gen.TARGETS).flat());
  const orphans = Object.keys(std.BLOCKS).filter((name) => !rendered.has(name));
  assert.deepEqual(orphans, [], `these blocks are rendered nowhere: ${orphans.join(', ')}`);
  // ...and every target block is a real one.
  const unknown = [...rendered].filter((name) => !(name in std.BLOCKS));
  assert.deepEqual(unknown, [], `these targets name a block that does not exist: ${unknown.join(', ')}`);
});

test('generation is idempotent - a second run writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-standard-idem-'));
  fs.cpSync(REPO_ROOT, dir, {
    recursive: true,
    filter: (src) => !/(^|\/)(\.git|node_modules)(\/|$)/.test(src.slice(REPO_ROOT.length)),
  });
  try {
    assert.deepEqual(gen.runWrite(dir), [], 'checked-in prose is already generated output');
    assert.deepEqual(gen.runWrite(dir), [], 'second run is a no-op');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A P0-P3 mention is only allowed to say the scale is GONE. This is what keeps
// a fifth vocabulary from being introduced by a future prose edit: a line that
// tells a reviewer to write P0 cannot carry any of these words honestly.
const RETIRED_VOCABULARY_CONTEXT = /legacy|no third level|retired|normaliz|accepted|historical|superseded|drift/i;

test('no P0-P3 severity vocabulary survives as an INSTRUCTION in reviewer prose', () => {
  // git grep so .gitignore and binaries behave. Scans the files that TELL a
  // reviewer what to write; ROADMAP/project-docs record the history of the drift
  // on purpose and are not scanned.
  let hits = [];
  try {
    hits = execFileSync(
      'git',
      ['grep', '-nE', '\\bP[0-3]\\b', '--', 'agents', 'commands', 'reference'],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    ).trim().split('\n').filter(Boolean);
  } catch (err) {
    if (err.status !== 1) throw err; // 1 = no matches, which is the pass case
  }
  const instructions = hits.filter((line) => !RETIRED_VOCABULARY_CONTEXT.test(line));
  assert.deepEqual(
    instructions,
    [],
    `these lines still speak P0-P3 as a live vocabulary rather than a retired one:\n${instructions.join('\n')}`
  );
});

test('the drift check has teeth: a re-introduced P0 instruction is caught', () => {
  // Same predicate the test above applies, against a line of the kind that
  // caused F9 in the first place. Without this, "0 hits" could mean the filter
  // swallows everything.
  const reintroduced = 'agents/auditor.md:59:  SEVERITY: P0 (critical), P1 (bugs), P2 (quality)';
  assert.ok(!RETIRED_VOCABULARY_CONTEXT.test(reintroduced), 'a live P0 instruction must NOT be excused');
  const excused = 'agents/auditor.md:84:Legacy spellings still on disk are read as `P0`->`blocking`; never write them.';
  assert.ok(RETIRED_VOCABULARY_CONTEXT.test(excused), 'a legacy-mapping line IS excused');
});

test('the ceiling doc and the severity doc are two files with two jobs', () => {
  const ceiling = fs.readFileSync(path.join(REPO_ROOT, 'reference', 'fix-loop.md'), 'utf8');
  const severity = fs.readFileSync(path.join(REPO_ROOT, 'reference', 'temperature-review.md'), 'utf8');

  assert.match(ceiling, /FIX_LOOP_CEILING/, 'fix-loop.md owns the ceiling');
  assert.doesNotMatch(ceiling, /^\| Severity \|/m, 'fix-loop.md must not carry a severity table');
  assert.match(severity, /^\| Severity \|/m, 'temperature-review.md owns severity');
  assert.doesNotMatch(severity, /FIX_LOOP_CEILING/, 'temperature-review.md must not restate the ceiling');
});

// --- backward compatibility, and the migration path -------------------------

test('the migrator rewrites a legacy artifact into the canonical shape, id unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-migrate-'));
  const file = path.join(dir, 'auditor.json');
  const legacy = {
    role: 'auditor',
    verdict: 'fail',
    findings: [{ temperature: 'P0', component: 'src/a.ts', line: 7, issue: 'the claim', fix: 'the fix' }],
    observation_gaps: ['dependency graph unavailable'],
  };
  fs.writeFileSync(file, JSON.stringify(legacy, null, 2));
  const idBefore = rf.findingId(legacy.findings[0]);

  try {
    const pending = run(MIGRATOR, ['--check', file]);
    assert.equal(pending.code, 2, 'a legacy artifact is reported as not yet canonical');

    assert.equal(run(MIGRATOR, [file]).code, 0);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(after.findings[0], {
      severity: 'blocking',
      file: 'src/a.ts',
      line: 7,
      evidence: 'the claim',
      remediation: 'the fix',
    });
    assert.deepEqual(after.observationGaps, ['dependency graph unavailable']);
    assert.equal(rf.findingId(after.findings[0]), idBefore, 'migration must not break the link to a recorded disposition');

    // Idempotent, and the result validates.
    assert.equal(run(MIGRATOR, ['--check', file]).code, 0);
    assert.equal(run(VALIDATOR, ['review', file]).code, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
