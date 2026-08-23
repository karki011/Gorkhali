// Author: Subash Karki
// review-model-confound.test.js — F11. The B11 precision gate compares findings
// that carry a `confidence` against findings that carry none. That is only a
// comparison of the VERIFICATION PASS if both populations came out of the same
// reviewer, and the 2026-08-13 baseline run says they did not: `auditor` is pinned
// `opus` in frontmatter and in model-policy.json, and it spawned
// `opus:18 sonnet:7`. 28% of the default reviewer's runs were the cheaper tier
// while the frontmatter drift check still read `match`.
//
// So two things are pinned here, both watchable rather than "it passes":
//
//   1. the review artifact can RECORD the model it ran on — optional, per
//      artifact, and no artifact already on disk starts failing without it;
//   2. the gate REFUSES on a confounded population. Mixed models, different
//      models, or no recorded model at all produce UNMEASURABLE plus a named
//      confound and an unresolved[] entry — never an adjusted or estimated
//      verdict.
//
// What is NOT fixed here, stated so nobody reads the green test as more than it
// is: the underlying drift (auditor running sonnet against an opus pin) is B1's
// scope. This is the gate being honest about it.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-artifact.js');
const MINER = path.join(REPO_ROOT, 'scripts', 'baseline-report.js');
const std = require(path.join(REPO_ROOT, 'scripts', 'lib', 'review-standard.js'));
const rf = require(path.join(REPO_ROOT, 'scripts', 'lib', 'review-finding.js'));

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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function validate(artifact) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f11-validate-'));
  const file = path.join(dir, 'auditor.json');
  writeJson(file, artifact);
  try {
    return run(VALIDATOR, ['review', file]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- 1. THE FIELD IS OPTIONAL AND PER ARTIFACT -------------------------------

const finding = (overrides = {}) => ({
  severity: 'blocking',
  file: 'src/pay/refund.ts',
  line: 88,
  evidence: 'issueRefund() calls charge.capture() after the early return on line 84',
  impact: 'A partial refund silently no-ops',
  remediation: 'Move the capture above the return',
  ...overrides,
});

const artifact = (overrides = {}) => ({
  role: 'auditor',
  verdict: 'fail',
  findings: [finding()],
  observationGaps: [],
  ...overrides,
});

test('an artifact with NO model still validates - nothing on disk starts failing', () => {
  const res = validate(artifact());
  assert.equal(res.code, 0, res.stderr);
});

test('the model is recorded ONCE for the artifact, and validates when present', () => {
  assert.equal(std.REVIEWER_MODEL.scope, 'artifact', 'a review run has one model; a finding has no separate one');
  assert.equal(std.REVIEWER_MODEL.required, false);

  const res = validate(artifact({ model: 'sonnet' }));
  assert.equal(res.code, 0, res.stderr);

  // An empty string is an ABSENT model wearing a key. The gate has to be able
  // to tell "nothing recorded" from "recorded as X", so this is rejected.
  const empty = validate(artifact({ model: '   ' }));
  assert.equal(empty.code, 1, 'an empty model is a validation error, not a recorded one');
  assert.match(empty.stderr + empty.stdout, /model: must be a non-empty string when present/);

  const wrongType = validate(artifact({ model: 4 }));
  assert.equal(wrongType.code, 1);
});

test('recording the model moves NO finding id - B9 ids are content-derived', () => {
  const f = finding();
  const idWithout = rf.findingId(f);
  const withModel = validate(artifact({ model: 'opus', findings: [{ ...f, id: idWithout }] }));
  assert.equal(withModel.code, 0, 'the derived id is still the right id on a model-carrying artifact');

  // And the id derivation never sees the artifact at all: same finding, same id,
  // whatever the review it sits in ran on.
  assert.equal(rf.findingId({ ...f }), idWithout);
  assert.equal(rf.findingId(std.normalizeFinding({ ...f })), idWithout);
});

test('the prose tells reviewers never to copy the model from a frontmatter pin', () => {
  const shape = std.renderFindingShape();
  assert.match(shape, /NEVER copy it from a\s+frontmatter pin/);
  assert.match(shape, /7 of 25 spawns/);
  // Every reviewer that gets the shape gets the rule, because it is generated
  // into the one shared standard the reviewer prompts read at runtime.
  const text = fs.readFileSync(path.join(REPO_ROOT, 'reference', 'review-standard.md'), 'utf8');
  assert.match(text, /`model` is OPTIONAL/, 'review-standard.md carries the model rule');
});

// --- 2. THE GATE REFUSES ON A CONFOUNDED POPULATION --------------------------

const tally = (fixed, dismissed, deferred) => ({
  dispositioned: fixed + dismissed + deferred,
  fixed,
  dismissed,
  deferred,
  precisionLower: fixed + dismissed + deferred ? fixed / (fixed + dismissed + deferred) : null,
  precisionUpper: fixed + dismissed ? fixed / (fixed + dismissed) : null,
});

// The shape of the real confound: a population that would PROMOTE on the
// numbers alone. before = 10 findings at 10% precision, after = 10 at 90%.
const BEFORE = tally(1, 9, 0);
const AFTER = tally(9, 1, 0);
const fill = (n, model) => Array(n).fill(model);

test('a MIXED-model population produces no verdict, however good the numbers look', () => {
  // Exactly the split F11 measured on auditor: most of the side on the pinned
  // model, a quarter of it on the cheaper one.
  const mixed = std.precisionGate({
    before: BEFORE,
    after: AFTER,
    minSample: 10,
    models: { before: fill(10, 'opus'), after: [...fill(7, 'opus'), ...fill(3, 'sonnet')] },
  });
  assert.equal(mixed.verdict, 'unmeasurable', 'a 10%-to-90% jump must NOT promote across two models');
  assert.equal(mixed.confound, 'reviewer-model');
  assert.match(mixed.reason, /a side spans more than one model/);
  assert.match(mixed.reason, /verified ran opus, sonnet/);
  assert.match(mixed.reason, /measures the MODEL, not the verification pass \(F11\)/);
  // Nothing was adjusted, weighted or estimated: no verdict word other than the
  // refusal appears, and the bands are still reported as they were measured.
  assert.equal(mixed.after.lower, 0.9);
  assert.equal(mixed.before.upper, 0.1);
});

test('two DIFFERENT single models is a refusal that names both', () => {
  const split = std.precisionGate({
    before: BEFORE,
    after: AFTER,
    minSample: 10,
    models: { before: fill(10, 'sonnet'), after: fill(10, 'opus') },
  });
  assert.equal(split.verdict, 'unmeasurable');
  assert.equal(split.confound, 'reviewer-model');
  assert.match(split.reason, /ran on DIFFERENT models - unverified sonnet, verified opus/);
});

test('an UNRECORDED model is a confound too, not a benefit of the doubt', () => {
  const none = std.precisionGate({ before: BEFORE, after: AFTER, minSample: 10 });
  assert.equal(none.verdict, 'unmeasurable', 'silence about the model is not evidence of one model');
  assert.equal(none.confound, 'reviewer-model');
  assert.match(none.reason, /UNRECORDED on unverified 10\/10 and verified 10\/10/);

  // Half a side recorded is still unrecorded for the rest of it.
  const partial = std.precisionGate({
    before: BEFORE,
    after: AFTER,
    minSample: 10,
    models: { before: fill(10, 'opus'), after: fill(6, 'opus') },
  });
  assert.equal(partial.verdict, 'unmeasurable');
  assert.match(partial.reason, /verified 4\/10/);
});

test('the confound is checked BEFORE the sample size - more data cannot un-confound it', () => {
  const huge = std.precisionGate({
    before: tally(100, 900, 0),
    after: tally(900, 100, 0),
    minSample: 10,
    models: { before: fill(1000, 'sonnet'), after: fill(1000, 'opus') },
  });
  assert.equal(huge.verdict, 'unmeasurable');
  assert.match(huge.reason, /DIFFERENT models/);
  assert.doesNotMatch(huge.reason, /sample too small/);
});

test('one shared recorded model is what lets the gate speak at all', () => {
  const ok = std.precisionGate({
    before: BEFORE,
    after: AFTER,
    minSample: 10,
    models: { before: fill(10, 'Opus'), after: fill(10, ' opus ') },
  });
  assert.equal(ok.verdict, 'promote', 'case and padding are noise, not a second model');
  assert.equal(ok.confound, null);
  assert.match(ok.reason, /\(both sides on opus\)/);

  // `opus` and `claude-opus-4-5` are NOT folded together: that would be this
  // file guessing that two names mean one model, which is the inference F11
  // exists to stop.
  const versioned = std.precisionGate({
    before: BEFORE,
    after: AFTER,
    minSample: 10,
    models: { before: fill(10, 'opus'), after: fill(10, 'claude-opus-4-5') },
  });
  assert.equal(versioned.verdict, 'unmeasurable');
  assert.equal(versioned.confound, 'reviewer-model');
});

// --- 3. THE MINER REFUSES ON A REAL CORPUS -----------------------------------

const disposed = (base, disposition, reason) => {
  const out = { ...base, id: rf.findingId(base), disposition };
  if (reason) out.dispositionReason = reason;
  return out;
};

/**
 * Two sessions whose reviews were produced by DIFFERENT models: the verified
 * side (findings carrying a `confidence`) on opus, the unverified side on
 * sonnet. On the numbers alone this is the promote case; the model is the only
 * thing standing between the miner and a verdict about the verification pass.
 */
function buildConfoundedCorpus() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'f11-corpus-'));
  const base = path.join(data, 'repos', 'feature-web-apps');

  const verified = [
    disposed(finding({ file: 'src/a.ts', evidence: 'a() double-charges on retry', confidence: 'confirmed' }), 'fixed'),
    disposed(finding({ file: 'src/b.ts', evidence: 'b() drops the idempotency key', confidence: 'confirmed' }), 'fixed'),
  ];
  const unverified = [
    disposed(finding({ file: 'src/c.ts', evidence: 'c() might race with the writer' }), 'dismissed', 'no writer exists'),
    disposed(finding({ file: 'src/d.ts', evidence: 'd() could leak the handle' }), 'dismissed', 'the handle is pooled'),
  ];

  writeJson(path.join(base, 'sessions', 'CP-900', 'wrap.json'), { brief: 'verified on opus', pr: null });
  writeJson(path.join(base, 'sessions', 'CP-900', 'reviews', 'auditor.json'), {
    role: 'auditor',
    model: 'opus',
    verdict: 'fail',
    findings: verified,
    observationGaps: [],
  });

  writeJson(path.join(base, 'sessions', 'CP-901', 'wrap.json'), { brief: 'unverified on sonnet', pr: null });
  writeJson(path.join(base, 'sessions', 'CP-901', 'reviews', 'auditor.json'), {
    role: 'auditor',
    model: 'sonnet',
    verdict: 'fail',
    findings: unverified,
    observationGaps: [],
  });

  return data;
}

function mine(dataRoot, extraArgs = []) {
  return execFileSync('node', [MINER, '--no-gh', ...extraArgs], {
    encoding: 'utf-8',
    env: { ...process.env, GORKHALI_DATA: dataRoot },
    cwd: REPO_ROOT,
  });
}

test('the miner reads the per-artifact model onto every finding and refuses the comparison', () => {
  const data = buildConfoundedCorpus();
  try {
    const report = JSON.parse(mine(data, ['--json']));
    const r = report.reviewFindings;

    // The model reached every finding of its artifact, and only its artifact.
    assert.equal(r.modelRecorded, '4/4');
    assert.deepEqual(
      r.rows.filter((row) => row.ticket === 'CP-900').map((row) => row.model),
      ['opus', 'opus']
    );
    assert.deepEqual(
      r.rows.filter((row) => row.ticket === 'CP-901').map((row) => row.model),
      ['sonnet', 'sonnet']
    );

    // Both sides have data, and the numbers alone would favour the verified
    // side outright: 100% against 0%.
    assert.equal(r.verificationGate.verified.precisionLower, 1);
    assert.equal(r.verificationGate.unverified.precisionUpper, 0);

    // And the gate still says nothing.
    assert.equal(r.verificationGate.verdict, 'unmeasurable');
    assert.equal(r.verificationGate.confound, 'reviewer-model');
    assert.match(r.verificationGate.reason, /DIFFERENT models - unverified sonnet, verified opus/);
    assert.deepEqual(r.verificationGate.models.after.models, ['opus']);
    assert.deepEqual(r.verificationGate.models.before.models, ['sonnet']);

    // Named in unresolved[], in the house style: what is unmeasurable, and why.
    const note = report.unresolved.find((u) => u.field === 'review_model_confound');
    assert.ok(note, 'the confound is an unresolved[] entry, not just a printed line');
    assert.match(note.reason, /CONFOUNDED by the reviewer model and produces no verdict/);
    assert.match(note.reason, /B1/, "and it says whose job the underlying drift is");

    const human = mine(data);
    assert.match(human, /CONFOUND\s+REVIEWER-MODEL - no verdict is produced, and none is estimated/);
    assert.match(human, /VERDICT\s+UNMEASURABLE/);
    assert.match(human, /unverified \(before\).*model sonnet/);
    assert.match(human, /verified {3}\(after\).*model opus/);
    // The per-model precision table is printed, so the confound is visible as
    // data and not only as a refusal.
    assert.match(human, /BY MODEL \(measurable findings only\)/);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('an artifact with no model leaves the side UNRECORDED and the gate silent', () => {
  const data = buildConfoundedCorpus();
  try {
    // Drop the model from the opus side only.
    const file = path.join(data, 'repos', 'feature-web-apps', 'sessions', 'CP-900', 'reviews', 'auditor.json');
    const art = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete art.model;
    writeJson(file, art);

    const report = JSON.parse(mine(data, ['--json']));
    const g = report.reviewFindings.verificationGate;
    assert.equal(report.reviewFindings.modelRecorded, '2/4');
    assert.equal(g.verdict, 'unmeasurable');
    assert.equal(g.confound, 'reviewer-model');
    assert.match(g.reason, /UNRECORDED on verified 2\/2/);
    assert.equal(g.models.after.unrecorded, 2, 'unrecorded is counted, never filled in from the pin');
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});
