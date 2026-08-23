// Author: Subash Karki
// degradation-labels.test.js - honest-degradation independence labels, adopted
// from the fable-foreman digest (research: sessions/foreman-research-rename/
// research-foreman.md). Foreman's rule: a review that resolves the same model
// as the work it checks must say so plainly ("blind-verified (same model,
// independent context)") rather than let the report imply an independent
// second opinion nobody obtained; a required independent check that was
// structurally unavailable is labeled "accepted under reduced assurance",
// never a silent clean pass.
//
// In Gorkhali the delegated roles span two tiers on claude-code (economy runs
// haiku; balanced and deep both resolve to sonnet), so same-model review is
// the NORM, not an edge case - `independence` states that evidence basis
// honestly. The
// vocabulary is DATA in scripts/lib/review-standard.js (same pattern as
// SEVERITIES/CONFIDENCE, B10/B11) and enforced by scripts/validate-artifact.js.
//
// `label` went through three shapes before landing here, and this file only
// tests the last one:
//   1. free text - no relationship to `basis` enforced at all.
//   2. a REQUIRED PREFIX per basis - closed until a label could still append
//      a stronger basis's phrase after its own prefix.
//   3. a FINITE FOREIGN-PHRASE BLOCKLIST - closed that, until a label could
//      still overstate independence in words the blocklist never enumerated
//      ("independently reviewed by a different model" names no reserved
//      phrase yet still smuggles the same claim past a reduced-assurance
//      basis). No finite check bounds English, so prose stopped being
//      validated at all: `label` is now DERIVED, a pure function of `basis`
//      and `evidenceTier` (`canonicalIndependenceLabel`), checked with ONE
//      strict-equality comparison. The human explanation moved to a
//      separate, bounded `reason` field.
//
// This file proves:
//   (a) a review payload with a valid independence block validates;
//   (b) an unknown basis/evidenceTier token is rejected (closed vocabulary);
//   (c) `label` must exactly equal the canonical derivation - any deviation,
//       including a smuggling variant no blocklist could have named, is
//       rejected;
//   (d) `reason` is required non-empty for `reduced-assurance`, optional
//       elsewhere, and capped at 500 UTF-8 bytes;
//   (e) an old payload with no independence block still validates (back-compat);
//   (f) the three basis tokens and two evidence-tier tokens are collision-free
//       against the vocabularies test/status-vocab.test.js already guards.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-artifact.js');

const std = require('../scripts/lib/review-standard');
const { EXECUTION_TASK_STATUSES } = require('../scripts/validate-artifact');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'degradation-labels-'));
  const file = path.join(dir, 'auditor.json');
  fs.writeFileSync(file, JSON.stringify(artifact, null, 2));
  try {
    return run(VALIDATOR, ['review', file]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const baseArtifact = (overrides = {}) => ({
  role: 'auditor',
  verdict: 'pass',
  findings: [],
  observationGaps: [],
  ...overrides,
});

// --- (a) a valid independence block validates -------------------------------

test('the default same-model-independent-context independence block validates', () => {
  const res = validate(baseArtifact({ independence: std.DEFAULT_INDEPENDENCE }));
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
});

test('a cross-model independence block, built from the canonical derivation, validates', () => {
  const res = validate(baseArtifact({
    independence: {
      basis: 'cross-model',
      evidenceTier: 'requested',
      label: std.canonicalIndependenceLabel('cross-model', 'requested'),
    },
  }));
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
});

test('a reduced-assurance independence block, with a reason, validates', () => {
  const res = validate(baseArtifact({
    independence: {
      basis: 'reduced-assurance',
      evidenceTier: 'requested',
      label: std.canonicalIndependenceLabel('reduced-assurance', 'requested'),
      reason: 'no genuinely independent verifier could be spawned',
    },
  }));
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
});

// --- (b) unknown basis/evidenceTier tokens are rejected ---------------------

test('an unknown basis token is rejected, and the error names the closed vocabulary', () => {
  const res = validate(baseArtifact({
    independence: { basis: 'trust-me-bro', evidenceTier: 'requested', label: 'nope' },
  }));
  assert.equal(res.code, 1);
  assert.match(
    res.stderr,
    /independence\.basis: must be one of same-model-independent-context\|cross-model\|reduced-assurance/
  );
  assert.match(res.stderr, /got "trust-me-bro"/);
});

test('an unknown evidenceTier token is rejected, and the error names the closed vocabulary', () => {
  const res = validate(baseArtifact({
    independence: { basis: 'cross-model', evidenceTier: 'vibes', label: 'nope' },
  }));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /independence\.evidenceTier: must be one of requested\|served/);
  assert.match(res.stderr, /got "vibes"/);
});

// --- (c) independence.label must EXACTLY EQUAL the canonical derivation -----

test('the canonical label for every basis/evidenceTier combination validates', () => {
  const cases = [
    ['same-model-independent-context', 'requested'],
    ['same-model-independent-context', 'served'],
    ['cross-model', 'requested'],
    ['cross-model', 'served'],
    ['reduced-assurance', 'requested'],
    ['reduced-assurance', 'served'],
  ];
  for (const [basis, evidenceTier] of cases) {
    const label = std.canonicalIndependenceLabel(basis, evidenceTier);
    const independence = { basis, evidenceTier, label };
    if (basis === 'reduced-assurance') independence.reason = 'no independently-resolvable verifier could be spawned';
    const res = validate(baseArtifact({ independence }));
    assert.equal(res.code, 0, `basis ${basis}, tier ${evidenceTier}, label "${label}": stderr: ${res.stderr}`);
  }
});

test('canonicalIndependenceLabel renders the exact strings the design specifies', () => {
  assert.equal(
    std.canonicalIndependenceLabel('same-model-independent-context', 'requested'),
    'blind-verified (same model, independent context; model identity is requested-tier evidence)'
  );
  assert.equal(
    std.canonicalIndependenceLabel('same-model-independent-context', 'served'),
    'blind-verified (same model, independent context; model identity is served-tier evidence)'
  );
  assert.equal(
    std.canonicalIndependenceLabel('cross-model', 'requested'),
    'cross-model review (requested-tier evidence)'
  );
  assert.equal(
    std.canonicalIndependenceLabel('cross-model', 'served'),
    'cross-model review (served-tier evidence)'
  );
  // reduced-assurance owes no tier phrase - the label is the same constant
  // regardless of evidenceTier, because it makes no independence claim for a
  // tier phrase to attach to.
  assert.equal(std.canonicalIndependenceLabel('reduced-assurance', 'requested'), 'accepted under reduced assurance');
  assert.equal(std.canonicalIndependenceLabel('reduced-assurance', 'served'), 'accepted under reduced assurance');
  assert.equal(std.canonicalIndependenceLabel('reduced-assurance', undefined), 'accepted under reduced assurance');
});

test('canonicalIndependenceLabel returns null when it cannot derive a real answer', () => {
  assert.equal(std.canonicalIndependenceLabel('trust-me-bro', 'requested'), null, 'unrecognized basis');
  assert.equal(
    std.canonicalIndependenceLabel('same-model-independent-context', 'vibes'),
    null,
    'a basis that claims independence needs a valid tier to render'
  );
  assert.equal(std.canonicalIndependenceLabel('cross-model', undefined), null, 'missing tier, independence-claiming basis');
});

test('a mismatched label is rejected even when it is a plausible independence sentence no phrase blocklist would have caught', () => {
  // The exact case Greptile named: no reserved phrase appears anywhere in
  // this string, so a foreign-phrase blocklist would have waved it through.
  // Exact-equality against the derivation catches it anyway, because there
  // is only one correct string and this is not it.
  const res = validate(baseArtifact({
    independence: {
      basis: 'reduced-assurance',
      evidenceTier: 'requested',
      label: 'accepted under reduced assurance: independently reviewed by a different model',
      reason: 'no independently-resolvable verifier could be spawned',
    },
  }));
  assert.equal(res.code, 1);
  assert.match(
    res.stderr,
    /independence\.label: must exactly equal the canonical label derived from basis "reduced-assurance"/
  );
  assert.match(res.stderr, /"accepted under reduced assurance"/);
});

test('a same-model label wearing the wrong evidence tier is rejected', () => {
  const res = validate(baseArtifact({
    independence: {
      basis: 'same-model-independent-context',
      evidenceTier: 'requested',
      label: std.canonicalIndependenceLabel('same-model-independent-context', 'served'),
    },
  }));
  assert.equal(res.code, 1);
  assert.match(
    res.stderr,
    /independence\.label: must exactly equal the canonical label derived from basis "same-model-independent-context" and evidenceTier "requested"/
  );
});

test('a cross-model label wearing a same-model sentence is rejected', () => {
  const res = validate(baseArtifact({
    independence: {
      basis: 'cross-model',
      evidenceTier: 'requested',
      label: std.canonicalIndependenceLabel('same-model-independent-context', 'requested'),
    },
  }));
  assert.equal(res.code, 1);
  assert.match(
    res.stderr,
    /independence\.label: must exactly equal the canonical label derived from basis "cross-model" and evidenceTier "requested"/
  );
});

test('trailing or leading whitespace around an otherwise-correct label still validates (trimmed before comparison)', () => {
  const res = validate(baseArtifact({
    independence: {
      basis: 'cross-model',
      evidenceTier: 'requested',
      label: `  ${std.canonicalIndependenceLabel('cross-model', 'requested')}  `,
    },
  }));
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
});

// --- (d) independence.reason: required for reduced-assurance, bounded ------

test('reducedAssuranceLabel is a back-compat shim that ignores its argument and returns the canonical constant', () => {
  assert.equal(std.reducedAssuranceLabel('anything at all'), 'accepted under reduced assurance');
  assert.equal(std.reducedAssuranceLabel(), 'accepted under reduced assurance');
});

test('a reduced-assurance block with no reason at all is rejected', () => {
  const res = validate(baseArtifact({
    independence: {
      basis: 'reduced-assurance',
      evidenceTier: 'requested',
      label: std.canonicalIndependenceLabel('reduced-assurance', 'requested'),
    },
  }));
  assert.equal(res.code, 1);
  assert.match(
    res.stderr,
    /independence\.reason: required non-empty string when basis is "reduced-assurance"/
  );
});

test('a reduced-assurance block with an empty-string reason is rejected', () => {
  const res = validate(baseArtifact({
    independence: {
      basis: 'reduced-assurance',
      evidenceTier: 'requested',
      label: std.canonicalIndependenceLabel('reduced-assurance', 'requested'),
      reason: '   ',
    },
  }));
  assert.equal(res.code, 1);
  assert.match(
    res.stderr,
    /independence\.reason: required non-empty string when basis is "reduced-assurance"/
  );
});

test('a same-model block needs no reason at all', () => {
  const res = validate(baseArtifact({ independence: std.DEFAULT_INDEPENDENCE }));
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
});

test('a same-model block may carry a reason too - optional, not forbidden', () => {
  const res = validate(baseArtifact({
    independence: { ...std.DEFAULT_INDEPENDENCE, reason: 'context for the reader, not a requirement' },
  }));
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
});

test('a non-string reason is rejected', () => {
  const res = validate(baseArtifact({
    independence: {
      basis: 'reduced-assurance',
      evidenceTier: 'requested',
      label: std.canonicalIndependenceLabel('reduced-assurance', 'requested'),
      reason: 42,
    },
  }));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /independence\.reason: must be a string if present/);
});

test('an oversized reason (over 500 UTF-8 bytes) is rejected, and the byte count is named', () => {
  const reason = 'x'.repeat(501);
  const res = validate(baseArtifact({
    independence: {
      basis: 'reduced-assurance',
      evidenceTier: 'requested',
      label: std.canonicalIndependenceLabel('reduced-assurance', 'requested'),
      reason,
    },
  }));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /independence\.reason: must be at most 500 UTF-8 bytes, got 501/);
});

test('a reason at exactly the 500 UTF-8 byte cap is accepted', () => {
  const reason = 'x'.repeat(500);
  const res = validate(baseArtifact({
    independence: {
      basis: 'reduced-assurance',
      evidenceTier: 'requested',
      label: std.canonicalIndependenceLabel('reduced-assurance', 'requested'),
      reason,
    },
  }));
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
});

test('a present independence object still requires basis, evidenceTier and label', () => {
  const missingBasis = validate(baseArtifact({ independence: { evidenceTier: 'requested', label: 'x' } }));
  assert.equal(missingBasis.code, 1);
  assert.match(missingBasis.stderr, /independence\.basis: required non-empty string/);

  const missingTier = validate(baseArtifact({ independence: { basis: 'cross-model', label: 'x' } }));
  assert.equal(missingTier.code, 1);
  assert.match(missingTier.stderr, /independence\.evidenceTier: required non-empty string/);

  const missingLabel = validate(baseArtifact({ independence: { basis: 'cross-model', evidenceTier: 'served' } }));
  assert.equal(missingLabel.code, 1);
  assert.match(missingLabel.stderr, /independence\.label: required non-empty string/);
});

test('independence must be an object, not a bare string or array', () => {
  const res = validate(baseArtifact({ independence: 'blind-verified' }));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /independence: must be an object if present/);
});

test('normalizeIndependenceBasis and normalizeIndependenceEvidenceTier reject anything outside the closed vocabulary', () => {
  assert.equal(std.normalizeIndependenceBasis('cross-model'), 'cross-model');
  assert.equal(std.normalizeIndependenceBasis('Cross-Model'), 'cross-model', 'case is formatting, not vocabulary');
  assert.equal(std.normalizeIndependenceBasis('sorta-independent'), null);
  assert.equal(std.normalizeIndependenceBasis(42), null);

  assert.equal(std.normalizeIndependenceEvidenceTier('served'), 'served');
  assert.equal(std.normalizeIndependenceEvidenceTier('SERVED'), 'served', 'case is formatting, not vocabulary');
  assert.equal(std.normalizeIndependenceEvidenceTier('billed'), null);
});

// --- (e) an old payload with no independence block still validates ---------

test('a legacy review artifact with no independence key at all still validates - back-compat', () => {
  const res = validate({
    role: 'auditor',
    verdict: 'pass',
    findings: [],
    observation_gaps: [],
  });
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
});

test('a review artifact recorded before this field existed round-trips through normalizeReview unchanged', () => {
  const legacy = { role: 'auditor', verdict: 'pass', findings: [], observationGaps: [] };
  const normalized = std.normalizeReview(legacy);
  assert.equal('independence' in normalized, false, 'normalization must not invent a default independence block');
});

// --- (f) collision-free against the vocabularies status-vocab.test.js guards -

// Same sourcing pattern as test/status-vocab.test.js: every token set is
// PARSED from its real definition site, never re-listed by hand, so this file
// cannot drift from what that test itself guards. status-vocab.test.js does
// not export its parse helpers (it is a test file, not a module), so the same
// definition sites are parsed again here rather than re-typing the vocabularies.

function parseInspectorVerdicts() {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'agents', 'inspector.md'), 'utf8');
  const start = content.indexOf('## Evidence states');
  assert.ok(start !== -1, 'agents/inspector.md: "## Evidence states" section not found');
  const end = content.indexOf('## Output', start);
  assert.ok(end !== -1, 'agents/inspector.md: "## Output" section not found after evidence states');
  const section = content.slice(start, end);
  return [...section.matchAll(/^- `([a-z0-9-]+)`/gm)].map((m) => m[1]);
}

function parseLifecycleStates() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, 'skills', 'gorkhali', 'references', 'state.md'),
    'utf8',
  );
  const sentence = content.match(/Session envelopes use[^.]*\./);
  assert.ok(sentence, 'skills/gorkhali/references/state.md: "Session envelopes use ..." sentence not found');
  return [...sentence[0].matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);
}

test('the independence vocabularies are exactly the tokens the design specifies', () => {
  assert.deepEqual(std.INDEPENDENCE_BASIS_VALUES, [
    'same-model-independent-context',
    'cross-model',
    'reduced-assurance',
  ]);
  assert.deepEqual(std.INDEPENDENCE_EVIDENCE_TIERS, ['requested', 'served']);
});

test('every independence token is collision-free against the implementer, inspector and lifecycle vocabularies', () => {
  const inspectorVerdicts = parseInspectorVerdicts();
  const lifecycle = parseLifecycleStates();
  const otherVocabularies = new Set([
    ...EXECUTION_TASK_STATUSES,
    ...inspectorVerdicts,
    ...lifecycle,
  ]);

  const independenceTokens = [...std.INDEPENDENCE_BASIS_VALUES, ...std.INDEPENDENCE_EVIDENCE_TIERS];
  const collisions = independenceTokens.filter((tok) => otherVocabularies.has(tok));
  assert.deepEqual(
    collisions,
    [],
    `independence token(s) collide with an existing status/verdict/lifecycle vocabulary: ${collisions.join(', ')}`
  );
});

test('every independence token is also collision-free against the severity and confidence axes on the same artifact', () => {
  // Not one of the three status-vocab.test.js vocabularies, but the closest
  // neighbor: independence lives on the same review artifact as severity and
  // confidence, so a shared token there would be just as confusing to a reader.
  const sameArtifactVocabularies = new Set([...std.SEVERITY_VALUES, ...std.CONFIDENCE_VALUES]);
  const independenceTokens = [...std.INDEPENDENCE_BASIS_VALUES, ...std.INDEPENDENCE_EVIDENCE_TIERS];
  const collisions = independenceTokens.filter((tok) => sameArtifactVocabularies.has(tok));
  assert.deepEqual(collisions, []);
});
