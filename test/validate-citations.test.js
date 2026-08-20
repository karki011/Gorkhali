// Author: Subash Karki
// validate-citations.test.js - B13. The fable-foreman finding contract retires
// self-rated confidence in favor of an evidence class (`quoted`/`observed`/
// `derived`/`inferred`) plus a citation a machine can resolve. This file pins:
//
//   1. `scripts/validate-artifact.js` enforces the SHAPE - an unknown
//      evidenceClass token is rejected, `citation` becomes required (in the
//      right shape) once evidenceClass is `quoted` or `observed`, and every
//      finding written before B13 (no evidenceClass at all) still validates;
//   2. `scripts/validate-citations.mjs` resolves what that shape allows - a
//      genuine quote against real file contents, a fabricated one caught, an
//      `observed` command checked structurally, and `derived`/`inferred`
//      findings counted but never asked to resolve, because they cannot be;
//   3. `--strict` is the only thing that turns an unresolved citation into a
//      non-zero exit - the reporting default stays exit 0 whenever the
//      artifact itself parses, same convention as the rest of this pipeline.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-artifact.js');
const CITATIONS = path.join(REPO_ROOT, 'scripts', 'validate-citations.mjs');

const std = require('../scripts/lib/review-standard');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-citations-shape-'));
  const file = path.join(dir, 'auditor.json');
  fs.writeFileSync(file, JSON.stringify(artifact, null, 2));
  try {
    return run(VALIDATOR, ['review', file]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes an artifact + a source tree into one tmp workspace and runs the citation resolver. */
function withWorkspace(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-citations-ws-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function resolveArtifactFile(dir, artifact, extraArgs = []) {
  const file = path.join(dir, 'auditor.json');
  fs.writeFileSync(file, JSON.stringify(artifact, null, 2));
  return run(CITATIONS, [file, '--root', dir, ...extraArgs]);
}

const baseArtifact = (findings) => ({ role: 'auditor', verdict: 'fail', findings, observationGaps: [] });

// --- scripts/lib/review-standard.js data ------------------------------------

test('the four evidence classes are exactly the ones the fable-foreman contract names', () => {
  assert.deepEqual(std.EVIDENCE_CLASS_VALUES, ['quoted', 'observed', 'derived', 'inferred']);
});

test('normalizeEvidenceClass is closed - no aliases, unknown tokens are null', () => {
  assert.equal(std.normalizeEvidenceClass('QUOTED'), 'quoted', 'case is formatting, not vocabulary');
  assert.equal(std.normalizeEvidenceClass('  observed  '), 'observed');
  assert.equal(std.normalizeEvidenceClass('confirmed'), null, 'confidence values are not evidence classes');
  assert.equal(std.normalizeEvidenceClass('QUOTE'), null, 'no partial/alias match');
  assert.equal(std.normalizeEvidenceClass(undefined), null);
});

test('CALIBRATION_RULE states confidence is superseded, not deleted', () => {
  assert.match(std.CALIBRATION_RULE.text, /superseded by `evidenceClass`/);
  assert.match(std.CALIBRATION_RULE.text, /back-compat/);
});

// --- (d) unknown evidenceClass token rejected -------------------------------

test('an evidenceClass in no vocabulary is rejected, naming the legal values', () => {
  const res = validate(baseArtifact([
    { severity: 'advisory', file: 'src/a.ts', evidence: 'a claim', evidenceClass: 'vibes' },
  ]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[0\]\.evidenceClass: must be one of quoted\|observed\|derived\|inferred/);
  assert.match(res.stderr, /got "vibes"/);
});

// --- citation becomes required, in the right shape, for quoted/observed ----

test('evidenceClass "quoted" with no citation is rejected', () => {
  const res = validate(baseArtifact([
    { severity: 'advisory', file: 'src/a.ts', evidence: 'a claim', evidenceClass: 'quoted' },
  ]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[0\]\.citation: required object when evidenceClass is "quoted"/);
});

test('evidenceClass "quoted" citation missing file is rejected', () => {
  const res = validate(baseArtifact([
    { severity: 'advisory', file: 'src/a.ts', evidence: 'a claim', evidenceClass: 'quoted', citation: { quote: 'x' } },
  ]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[0\]\.citation\.file: required non-empty string when evidenceClass is "quoted"/);
});

test('evidenceClass "quoted" with a well-shaped citation validates', () => {
  const res = validate(baseArtifact([
    {
      severity: 'advisory',
      file: 'src/a.ts',
      evidence: 'a claim',
      evidenceClass: 'quoted',
      citation: { file: 'src/a.ts', line: 10, quote: 'const x = 1' },
    },
  ]));
  assert.equal(res.code, 0, res.stderr);
});

test('evidenceClass "quoted" citation with a file but no quote text is rejected - unresolvable-as-quoted', () => {
  const noQuoteKey = validate(baseArtifact([
    { severity: 'advisory', file: 'src/a.ts', evidence: 'a claim', evidenceClass: 'quoted', citation: { file: 'src/a.ts', line: 5 } },
  ]));
  assert.equal(noQuoteKey.code, 1);
  assert.match(noQuoteKey.stderr, /findings\[0\]\.citation\.quote: required non-empty string when evidenceClass is "quoted"/);

  const blankQuote = validate(baseArtifact([
    { severity: 'advisory', file: 'src/a.ts', evidence: 'a claim', evidenceClass: 'quoted', citation: { file: 'src/a.ts', quote: '   ' } },
  ]));
  assert.equal(blankQuote.code, 1);
  assert.match(blankQuote.stderr, /findings\[0\]\.citation\.quote: required non-empty string when evidenceClass is "quoted"/);
});

test('evidenceClass "observed" with no citation, or an empty command, is rejected', () => {
  const noCitation = validate(baseArtifact([
    { severity: 'advisory', file: 'src/a.ts', evidence: 'a claim', evidenceClass: 'observed' },
  ]));
  assert.equal(noCitation.code, 1);
  assert.match(noCitation.stderr, /findings\[0\]\.citation: required object when evidenceClass is "observed"/);

  const emptyCommand = validate(baseArtifact([
    { severity: 'advisory', file: 'src/a.ts', evidence: 'a claim', evidenceClass: 'observed', citation: { command: '' } },
  ]));
  assert.equal(emptyCommand.code, 1);
  assert.match(emptyCommand.stderr, /findings\[0\]\.citation\.command: required non-empty string when evidenceClass is "observed"/);
});

test('evidenceClass "observed" with a non-empty command validates', () => {
  const res = validate(baseArtifact([
    {
      severity: 'advisory',
      file: 'src/a.ts',
      evidence: 'a claim',
      evidenceClass: 'observed',
      citation: { command: 'npm test', expect: 'exit 0' },
    },
  ]));
  assert.equal(res.code, 0, res.stderr);
});

// --- (c) inferred findings with null citation validate ----------------------

test('evidenceClass "inferred" with a null citation validates - the one class where absent is legal', () => {
  const res = validate(baseArtifact([
    { severity: 'advisory', file: 'src/a.ts', evidence: 'a hunch', evidenceClass: 'inferred', citation: null },
  ]));
  assert.equal(res.code, 0, res.stderr);
});

test('evidenceClass "inferred" with citation entirely omitted also validates', () => {
  const res = validate(baseArtifact([
    { severity: 'advisory', file: 'src/a.ts', evidence: 'a hunch', evidenceClass: 'inferred' },
  ]));
  assert.equal(res.code, 0, res.stderr);
});

test('evidenceClass "derived" takes a free-text locator string, not an object', () => {
  const res = validate(baseArtifact([
    {
      severity: 'advisory',
      file: 'src/a.ts',
      evidence: 'reasoned from two other findings',
      evidenceClass: 'derived',
      citation: 'derived from f_abc123 and f_def456',
    },
  ]));
  assert.equal(res.code, 0, res.stderr);
});

test('evidenceClass "derived" with no citation, or an empty locator, is rejected', () => {
  const noCitation = validate(baseArtifact([
    { severity: 'advisory', file: 'src/a.ts', evidence: 'reasoned from elsewhere', evidenceClass: 'derived' },
  ]));
  assert.equal(noCitation.code, 1);
  assert.match(
    noCitation.stderr,
    /findings\[0\]\.citation: required non-empty string \(a free-text locator\) when evidenceClass is "derived"/
  );

  const emptyLocator = validate(baseArtifact([
    { severity: 'advisory', file: 'src/a.ts', evidence: 'reasoned from elsewhere', evidenceClass: 'derived', citation: '   ' },
  ]));
  assert.equal(emptyLocator.code, 1);
  assert.match(
    emptyLocator.stderr,
    /findings\[0\]\.citation: required non-empty string \(a free-text locator\) when evidenceClass is "derived"/
  );

  const nullCitation = validate(baseArtifact([
    { severity: 'advisory', file: 'src/a.ts', evidence: 'reasoned from elsewhere', evidenceClass: 'derived', citation: null },
  ]));
  assert.equal(nullCitation.code, 1, 'unlike inferred, derived does not treat null as legal - it still needs a locator');
});

// --- (e) back-compat: no evidenceClass at all still validates ---------------

test('a finding with no evidenceClass validates exactly as before B13', () => {
  const res = validate(baseArtifact([
    { severity: 'blocking', file: 'src/pay/refund.ts', line: 88, evidence: 'the claim', remediation: 'the fix' },
  ]));
  assert.equal(res.code, 0, res.stderr);
});

// --- scripts/validate-citations.mjs: (a) a resolving quoted citation --------

test('(a) a quoted citation whose quote genuinely appears at the cited line resolves', () => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'refund.ts'),
      'function issueRefund() {\n  charge.capture();\n  return early;\n}\n'
    );
    const artifact = baseArtifact([
      {
        id: 'f_ok',
        evidenceClass: 'quoted',
        citation: { file: 'src/refund.ts', line: 2, quote: 'charge.capture();' },
      },
    ]);
    const res = resolveArtifactFile(dir, artifact);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /No unresolved citations/);
    assert.match(res.stdout, /Calibration: 1\/1 resolved of 1 resolvable \(1 findings total\) -> 100\.0%/);
  });
});

test('a quote that is whitespace-reflowed still resolves (normalized comparison)', () => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'const   x   =\n    1;\n');
    const artifact = baseArtifact([
      { id: 'f_ws', evidenceClass: 'quoted', citation: { file: 'src/a.ts', quote: 'const x = 1;' } },
    ]);
    const res = resolveArtifactFile(dir, artifact);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /No unresolved citations/);
  });
});

// --- (b) a fabricated citation is flagged UNRESOLVED, --strict exits 1 -----

test('(b) a citation naming a nonexistent file is flagged UNRESOLVED, and --strict exits 1', () => {
  withWorkspace((dir) => {
    const artifact = baseArtifact([
      { id: 'f_fabricated', evidenceClass: 'quoted', citation: { file: 'src/does-not-exist.ts', quote: 'x' } },
    ]);

    const plain = resolveArtifactFile(dir, artifact);
    assert.equal(plain.code, 0, 'a reporting run never fails just because a citation is unresolved');
    assert.match(plain.stdout, /UNRESOLVED \(1\)/);
    assert.match(plain.stdout, /f_fabricated \[quoted\]: file does not exist/);
    assert.match(plain.stdout, /Calibration: 0\/1 resolved of 1 resolvable \(1 findings total\) -> 0\.0%/);

    const strict = resolveArtifactFile(dir, artifact, ['--strict']);
    assert.equal(strict.code, 1, '--strict turns an unresolved citation into a non-zero exit');
  });
});

test('(b) a citation whose quote is absent from a real file is flagged UNRESOLVED, and --strict exits 1', () => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'const x = 1;\n');
    const artifact = baseArtifact([
      { id: 'f_absent_quote', evidenceClass: 'quoted', citation: { file: 'src/a.ts', quote: 'this text is not in the file' } },
    ]);

    const plain = resolveArtifactFile(dir, artifact);
    assert.equal(plain.code, 0);
    assert.match(plain.stdout, /UNRESOLVED \(1\)/);
    assert.match(plain.stdout, /f_absent_quote \[quoted\]: quote not found/);

    const strict = resolveArtifactFile(dir, artifact, ['--strict']);
    assert.equal(strict.code, 1);
  });
});

test('a quoted citation whose file exists but carries no quote text is UNRESOLVED, not a weak pass', () => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'const x = 1;\n');
    // This shape (file present, quote absent) is now rejected outright by
    // validate-artifact.js - this artifact bypasses that shape check (as a
    // hand-authored fixture) to prove the resolver itself also refuses to
    // treat "file exists" as sufficient for a `quoted` citation.
    const artifact = baseArtifact([
      { id: 'f_no_quote', evidenceClass: 'quoted', citation: { file: 'src/a.ts', line: 1 } },
    ]);
    const res = resolveArtifactFile(dir, artifact);
    assert.equal(res.code, 0, 'reporting run - unresolved does not fail the exit code without --strict');
    assert.match(res.stdout, /UNRESOLVED \(1\)/);
    assert.match(res.stdout, /f_no_quote \[quoted\]: quoted citation carries no quote text/);

    const strict = resolveArtifactFile(dir, artifact, ['--strict']);
    assert.equal(strict.code, 1);
  });
});

test('a quote occurring multiple times resolves via the occurrence nearest the cited line, even when indexOf\'s first hit is far away', () => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    // "const shared = 1;" appears twice: line 1 (far from the cited line) and
    // line 30 (within 5 lines of it). The FIRST occurrence (line 1) is more
    // than 5 lines from the cited line 28 - a naive indexOf-only resolver
    // would wrongly unresolve this despite a genuinely near occurrence.
    const lines = ['const shared = 1;'];
    for (let i = 2; i <= 29; i++) lines.push(`// filler line ${i}`);
    lines.push('const shared = 1;');
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), lines.join('\n') + '\n');

    const artifact = baseArtifact([
      { id: 'f_near', evidenceClass: 'quoted', citation: { file: 'src/a.ts', line: 28, quote: 'const shared = 1;' } },
    ]);
    // formatReport only prints a reason for UNRESOLVED findings, so a resolved
    // citation is checked via "no unresolved" + full calibration - the far-only
    // case right below proves the reason text still names both occurrences.
    const res = resolveArtifactFile(dir, artifact);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /No unresolved citations/);
    assert.match(res.stdout, /Calibration: 1\/1 resolved of 1 resolvable \(1 findings total\) -> 100\.0%/);
  });
});

test('a quote occurring multiple times still unresolves when every occurrence is far from the cited line', () => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const lines = ['const shared = 1;'];
    for (let i = 2; i <= 29; i++) lines.push(`// filler line ${i}`);
    lines.push('const shared = 1;');
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), lines.join('\n') + '\n');

    // Cited line 15 sits more than 5 lines from BOTH occurrences (1 and 30).
    const artifact = baseArtifact([
      { id: 'f_far_both', evidenceClass: 'quoted', citation: { file: 'src/a.ts', line: 15, quote: 'const shared = 1;' } },
    ]);
    const res = resolveArtifactFile(dir, artifact);
    assert.match(res.stdout, /UNRESOLVED \(1\)/);
    assert.match(res.stdout, /f_far_both \[quoted\]: quote found at src\/a\.ts:1,30, none within 5 lines of cited line 15/);
  });
});

test('a quote found more than 5 lines from the cited line is flagged UNRESOLVED', () => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const body = Array.from({ length: 20 }, (_, i) => (i === 19 ? 'const target = 42;' : `// filler line ${i}`)).join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), body);
    const artifact = baseArtifact([
      { id: 'f_far', evidenceClass: 'quoted', citation: { file: 'src/a.ts', line: 1, quote: 'const target = 42;' } },
    ]);
    const res = resolveArtifactFile(dir, artifact);
    assert.match(res.stdout, /UNRESOLVED \(1\)/);
    assert.match(res.stdout, /f_far \[quoted\]: quote found at src\/a\.ts:20, more than 5 lines from cited line 1/);
  });
});

test('an observed citation with an empty command is UNRESOLVED; a non-empty one resolves without running it', () => {
  withWorkspace((dir) => {
    const artifact = baseArtifact([
      { id: 'f_obs_ok', evidenceClass: 'observed', citation: { command: 'echo hi && exit 1' } },
      { id: 'f_obs_bad', evidenceClass: 'observed', citation: { command: '' } },
    ]);
    const res = resolveArtifactFile(dir, artifact);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /UNRESOLVED \(1\)/);
    assert.match(res.stdout, /f_obs_bad \[observed\]: citation\.command is missing or empty/);
    assert.match(res.stdout, /Calibration: 1\/2 resolved of 2 resolvable/, 'f_obs_ok resolved; the command with exit 1 was never run to find that out');
  });
});

// --- (c) derived/inferred are counted but never asked to resolve -----------

test('(c) derived and inferred findings are excluded from the resolvable population entirely', () => {
  withWorkspace((dir) => {
    const artifact = baseArtifact([
      { id: 'f_inferred', evidenceClass: 'inferred', citation: null },
      { id: 'f_derived', evidenceClass: 'derived', citation: 'reasoned from elsewhere' },
      { id: 'f_none' },
    ]);
    const res = resolveArtifactFile(dir, artifact);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /No unresolved citations/, 'nothing here is resolvable, so nothing can be unresolved');
    assert.match(res.stdout, /Not machine-resolvable \(derived\/inferred\/no evidenceClass\): 3/);
    assert.match(res.stdout, /Calibration: 0\/0 resolved of 0 resolvable \(3 findings total\) -> unmeasurable \(0 resolvable findings\)/);

    // --strict has nothing resolvable to fail on.
    const strict = resolveArtifactFile(dir, artifact, ['--strict']);
    assert.equal(strict.code, 0);
  });
});

test('a mixed artifact reports UNRESOLVED prominently ahead of the calibration line', () => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'const real = true;\n');
    const artifact = baseArtifact([
      { id: 'f_real', evidenceClass: 'quoted', citation: { file: 'src/a.ts', quote: 'const real = true;' } },
      { id: 'f_fake', evidenceClass: 'quoted', citation: { file: 'src/missing.ts', quote: 'x' } },
      { id: 'f_guess', evidenceClass: 'inferred' },
    ]);
    const res = resolveArtifactFile(dir, artifact);
    const unresolvedIdx = res.stdout.indexOf('UNRESOLVED');
    const calibrationIdx = res.stdout.indexOf('Calibration:');
    assert.ok(unresolvedIdx >= 0 && calibrationIdx > unresolvedIdx, 'UNRESOLVED must print before the calibration summary');
    assert.match(res.stdout, /Calibration: 1\/2 resolved of 2 resolvable \(3 findings total\)/);
  });
});

// --- containment: a citation.file cannot escape the workspace root ---------
// `citation.file` is untrusted artifact content that flows into a real
// filesystem read (scripts/validate-citations.mjs). Without containment, an
// absolute path, a "../" traversal, or a symlink planted inside the root but
// pointing outside it turns the resolver into a quote-match oracle over any
// process-readable file - existence and line numbers leak via the report and
// the --strict exit code. Two layers are proven here: the SHAPE check
// (scripts/validate-artifact.js, rejects absolute/traversing paths outright)
// and the RESOLVER's own containment (scripts/validate-citations.mjs, which
// re-checks by canonical path regardless of what shape-checking ran before
// it, and is the only layer that catches a symlink escape).

test('an absolute citation.file path is rejected by validate-artifact.js (shape layer)', () => {
  const res = validate(baseArtifact([
    {
      severity: 'advisory',
      file: 'src/a.ts',
      evidence: 'a claim',
      evidenceClass: 'quoted',
      citation: { file: '/etc/passwd', quote: 'root:' },
    },
  ]));
  assert.equal(res.code, 1);
  assert.match(
    res.stderr,
    /findings\[0\]\.citation\.file: must be a normalized workspace-relative path without an absolute path/
  );
});

test('a "../" traversal citation.file path is rejected by validate-artifact.js (shape layer)', () => {
  const res = validate(baseArtifact([
    {
      severity: 'advisory',
      file: 'src/a.ts',
      evidence: 'a claim',
      evidenceClass: 'quoted',
      citation: { file: '../../etc/passwd', quote: 'root:' },
    },
  ]));
  assert.equal(res.code, 1);
  assert.match(
    res.stderr,
    /findings\[0\]\.citation\.file: must be a normalized workspace-relative path without an absolute path, "\.\.\/" traversal, or backslash/
  );
});

test('a backslash in citation.file is rejected by validate-artifact.js (shape layer)', () => {
  const res = validate(baseArtifact([
    {
      severity: 'advisory',
      file: 'src/a.ts',
      evidence: 'a claim',
      evidenceClass: 'quoted',
      citation: { file: 'src\\a.ts', quote: 'x' },
    },
  ]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /findings\[0\]\.citation\.file: must be a normalized workspace-relative path/);
});

test('a normal relative citation still resolves - containment does not touch the legitimate path', () => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'ok.ts'), 'const ok = true;\n');
    const artifact = baseArtifact([
      { id: 'f_ok', evidenceClass: 'quoted', citation: { file: 'src/ok.ts', quote: 'const ok = true;' } },
    ]);
    const res = resolveArtifactFile(dir, artifact);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /No unresolved citations/);
  });
});

test('an absolute citation.file path is UNRESOLVED by the resolver, and --strict exits 1', () => {
  withWorkspace((dir) => {
    // A real file the resolver must never be able to reach, entirely outside
    // the workspace root passed as --root.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-citations-outside-'));
    try {
      const secret = path.join(outsideDir, 'secret.txt');
      fs.writeFileSync(secret, 'SECRET_CONTENT_OUTSIDE_ROOT\n');
      const artifact = baseArtifact([
        { id: 'f_absolute', evidenceClass: 'quoted', citation: { file: secret, quote: 'SECRET_CONTENT_OUTSIDE_ROOT' } },
      ]);

      const plain = resolveArtifactFile(dir, artifact);
      assert.equal(plain.code, 0, 'reporting run never fails just because a citation is unresolved');
      assert.match(plain.stdout, /UNRESOLVED \(1\)/);
      assert.match(plain.stdout, /f_absolute \[quoted\]: citation path must be workspace-relative \(absolute paths are rejected\)/);

      const strict = resolveArtifactFile(dir, artifact, ['--strict']);
      assert.equal(strict.code, 1);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

test('a "../" traversal citation.file path is UNRESOLVED by the resolver, and --strict exits 1', () => {
  withWorkspace((dir) => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-citations-outside-'));
    try {
      const secret = path.join(outsideDir, 'secret.txt');
      fs.writeFileSync(secret, 'SECRET_CONTENT_OUTSIDE_ROOT\n');
      // A relative traversal from inside `dir` back out to the sibling
      // `outsideDir` - clean-looking, but still a "../" segment.
      const traversal = path.join('..', path.basename(outsideDir), 'secret.txt');
      const artifact = baseArtifact([
        { id: 'f_traversal', evidenceClass: 'quoted', citation: { file: traversal, quote: 'SECRET_CONTENT_OUTSIDE_ROOT' } },
      ]);

      const plain = resolveArtifactFile(dir, artifact);
      assert.equal(plain.code, 0);
      assert.match(plain.stdout, /UNRESOLVED \(1\)/);
      assert.match(
        plain.stdout,
        /f_traversal \[quoted\]: citation path must be workspace-relative \("\.\.\/" traversal is rejected\)/
      );

      const strict = resolveArtifactFile(dir, artifact, ['--strict']);
      assert.equal(strict.code, 1);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

test('a symlink inside the root pointing outside it is UNRESOLVED as an escape, and --strict exits 1', (t) => {
  withWorkspace((dir) => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-citations-outside-'));
    try {
      const secret = path.join(outsideDir, 'secret.txt');
      fs.writeFileSync(secret, 'SECRET_CONTENT_OUTSIDE_ROOT\n');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      const link = path.join(dir, 'src', 'escape-link.ts');
      try {
        fs.symlinkSync(secret, link);
      } catch (err) {
        // Some platforms/CI sandboxes cannot create symlinks (e.g. missing
        // privilege on Windows) - skip rather than fail on an environment
        // limitation unrelated to the containment logic under test.
        t.skip(`cannot create a symlink in this environment: ${err.message}`);
        return;
      }

      // The citation path itself is clean - relative, no traversal - which is
      // exactly why the shape check alone cannot catch this: only resolving
      // the REAL path (through the symlink) and comparing it to the real
      // root reveals the escape.
      const artifact = baseArtifact([
        { id: 'f_symlink', evidenceClass: 'quoted', citation: { file: 'src/escape-link.ts', quote: 'SECRET_CONTENT_OUTSIDE_ROOT' } },
      ]);

      const plain = resolveArtifactFile(dir, artifact);
      assert.equal(plain.code, 0);
      assert.match(plain.stdout, /UNRESOLVED \(1\)/);
      assert.match(plain.stdout, /f_symlink \[quoted\]: citation path escapes the workspace root/);

      const strict = resolveArtifactFile(dir, artifact, ['--strict']);
      assert.equal(strict.code, 1);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

test('a symlink inside the root pointing to another file INSIDE the root still resolves', (t) => {
  withWorkspace((dir) => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const real = path.join(dir, 'src', 'real.ts');
    fs.writeFileSync(real, 'const real = true;\n');
    const link = path.join(dir, 'src', 'alias.ts');
    try {
      fs.symlinkSync(real, link);
    } catch (err) {
      t.skip(`cannot create a symlink in this environment: ${err.message}`);
      return;
    }
    const artifact = baseArtifact([
      { id: 'f_alias', evidenceClass: 'quoted', citation: { file: 'src/alias.ts', quote: 'const real = true;' } },
    ]);
    const res = resolveArtifactFile(dir, artifact);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /No unresolved citations/, 'a symlink that stays INSIDE the root is not an escape');
  });
});

test('--root that does not exist is a usage error, exit 1', () => {
  withWorkspace((dir) => {
    const file = path.join(dir, 'auditor.json');
    fs.writeFileSync(file, JSON.stringify(baseArtifact([]), null, 2));
    const res = run(CITATIONS, [file, '--root', path.join(dir, 'does-not-exist')]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /--root does not exist or cannot be resolved/);
  });
});

// --- CLI usage -----------------------------------------------------------

test('--help prints usage and exits 0 without requiring an artifact', () => {
  const res = run(CITATIONS, ['--help']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /validate-citations\.mjs - resolve B13 evidence-class citations/);
});

test('a missing artifact path is a usage error, exit 1', () => {
  const res = run(CITATIONS, ['/no/such/file/auditor.json']);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /artifact not found/);
});

test('a well-formed artifact with no --root is a usage error naming the flag, exit 1', () => {
  withWorkspace((dir) => {
    const file = path.join(dir, 'auditor.json');
    fs.writeFileSync(file, JSON.stringify(baseArtifact([]), null, 2));
    // Deliberately no --root: there is no safe default (an artifact lives in
    // a session directory; citation paths are workspace-relative), so this
    // must fail closed and name the missing flag rather than guess a root.
    const res = run(CITATIONS, [file]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /missing required --root <dir>/);
  });
});

test('unparsable JSON is a usage error, exit 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-citations-badjson-'));
  try {
    const file = path.join(dir, 'auditor.json');
    fs.writeFileSync(file, 'not json');
    const res = run(CITATIONS, [file]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /cannot parse .* as JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
