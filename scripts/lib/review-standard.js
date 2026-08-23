// Author: Subash Karki
// review-standard.js — the SINGLE SOURCE OF TRUTH for what a review finding is
// (B10). One severity scale, one finding shape, one security checklist, one set
// of reporting rules.
//
// WHY THIS FILE EXISTS: F9 counted four severity vocabularies for one concept
// (auditor `blocking`/`advisory`, justice `P0`-`P2`, temperature-review `P0`-`P3`,
// the verification schema's `"warn"`), three finding shapes for the same
// `auditor.json` path, and two spellings of the same array. All of it was stated in
// prose, in N files, with nothing enforcing agreement — the F1/F5 pattern. A
// fifth prose restatement would drift the same way, so the vocabulary is DATA
// here and the prose is GENERATED from it:
//
//   scripts/lib/review-standard.js   (this file — the values and their rules)
//     -> scripts/validate-artifact.js   enforces the enum on artifacts
//        -> reference/schemas/review.md via scripts/gen-schema-docs.js --check
//     -> scripts/gen-review-standard.js  renders the prose blocks into
//        reference/review-standard.md (the single generated home the reviewer
//        agent prompts read at runtime), reference/agent-protocols/justice-protocol.md,
//        reference/temperature-review.md — all drift-checked in CI by
//        test/review-standard.test.js.
//
// Pure data + string rendering. No fs, no project deps, so the validator, the
// generator, the loop controller and any miner reading artifacts off disk all
// reach the same answer without private copies.

'use strict';

// ---------------------------------------------------------------------------
// The one scale.
// ---------------------------------------------------------------------------
// TWO values, not four, and not a 0-3 ordinal. The reason is behavioural, not
// aesthetic: every live consumer already collapses its scale to a binary before
// acting. Justice triages P0/P1 -> FIX and P2 -> SKIP; temperature-review fixes
// P0/P1 and DROPS P2/P3 unreported. So the extra levels carried no decision —
// they only gave the same finding four spellings. `blocking`/`advisory` is the
// pair that survives, because it is what Auditor (the one default reviewer) already
// writes, which means the corpus on disk needs no rewrite and the B9 finding ids
// — which deliberately exclude severity — stay stable.
//
// Importance ONLY. Whether the claim is confirmed is a separate axis (B11's
// `confidence`); do not smuggle uncertainty into severity by downgrading a bug
// you are unsure of.
const SEVERITIES = [
  {
    value: 'blocking',
    bar: 'the diff makes something WORSE than it was before, or fails the stated intent',
    action: 'enters the fix loop; the ship waits',
  },
  {
    value: 'advisory',
    bar: 'worth the author knowing, but the diff neither degrades the file nor misses its intent',
    action: 'reported once; never enters the fix loop, never gates the ship',
  },
];

const SEVERITY_VALUES = SEVERITIES.map((s) => s.value);

// Legacy severity spellings, mapped rather than rejected: artifacts written
// before B10 are on disk in every session directory and must keep validating.
// Exactly the four vocabularies F9 names, nothing invented on top.
//   P0/P1 -> blocking : both were "auto-fix, block ship" in every table that used them.
//   P2/P3 -> advisory : both were "drop, do not fix" — the non-gating half.
//   warn  -> advisory : the verification schema's single non-gating marker.
const SEVERITY_ALIASES = Object.freeze({
  P0: 'blocking',
  P1: 'blocking',
  P2: 'advisory',
  P3: 'advisory',
  warn: 'advisory',
});

/** Canonical severity for any accepted spelling, or `null` if it is not one. */
function normalizeSeverity(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '') return null;
  if (SEVERITY_VALUES.includes(raw.toLowerCase())) return raw.toLowerCase();
  const alias = Object.keys(SEVERITY_ALIASES).find((key) => key.toLowerCase() === raw.toLowerCase());
  return alias ? SEVERITY_ALIASES[alias] : null;
}

// ---------------------------------------------------------------------------
// The OTHER axis: confidence (B11).
// ---------------------------------------------------------------------------
// Severity says how much a finding MATTERS. Confidence says how sure you are it
// is TRUE. They are different questions with different answers, and collapsing
// them is the defect Gap 2 names: an `advisory` today may be a confident nit or
// an unsure bug, the author cannot tell which, so they skim both.
//
// F9 already recorded this exact class of mistake once — `review.temperature`
// (an input knob on how hard the reviewer looks) was miscounted as a fifth
// severity vocabulary (an output score). The correction there and the rule here
// are the same rule: DO NOT DERIVE ONE AXIS FROM ANOTHER. Nothing below reads
// severity, nothing in SEVERITIES reads confidence, no validator rule couples
// them, and all six combinations are legal. A `blocking` finding may be
// `possible`; an `advisory` finding may be `confirmed`.
//
// The values come from the Rephrase article's uncertainty step (§1.1), which is
// the one thing that source gets straightforwardly right.
const CONFIDENCE = [
  {
    value: 'confirmed',
    bar: 'you re-opened the cited file at the cited line and the behaviour the finding claims is there',
    action: 'reported normally',
  },
  {
    value: 'possible',
    bar: 'the cited line reads as claimed, but whether it produces the stated impact depends on a path you could not follow',
    action: 'reported, and the author is told the consequence is the uncertain part - not the code',
  },
  {
    value: 'needs-verification',
    bar: 'the cited source could not be re-read at all (generated, vendored, outside the worktree, unreadable)',
    action: 'reported ONLY with a matching `observationGaps` entry naming what blocked the re-read',
  },
];

const CONFIDENCE_VALUES = CONFIDENCE.map((c) => c.value);

// The article's own phrasings, folded in rather than left to become a second
// vocabulary. Exactly the three it names; nothing invented on top.
const CONFIDENCE_ALIASES = Object.freeze({
  'confirmed issue': 'confirmed',
  'possible risk': 'possible',
  'needs more context': 'needs-verification',
});

/** Canonical confidence for any accepted spelling, or `null` if it is not one. */
function normalizeConfidence(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (raw === '') return null;
  if (CONFIDENCE_VALUES.includes(raw)) return raw;
  return CONFIDENCE_ALIASES[raw] || null;
}

// The three axes a review carries, named together in ONE place so no future
// reader has to infer which of them are the same thing. Two are outputs scored
// per finding; one is an input knob on the whole review. Rendered into reviewer
// prose so the distinction is stated where the mistake would be made.
const REVIEW_AXES = Object.freeze([
  {
    axis: 'strictness',
    key: '`review.temperature`',
    kind: 'input, per review',
    question: 'how hard does the reviewer look?',
    values: '0-1',
  },
  {
    axis: 'severity',
    key: '`findings[].severity`',
    kind: 'output, per finding',
    question: 'how much does this finding matter?',
    values: SEVERITY_VALUES.map((v) => `\`${v}\``).join(' \\| '),
  },
  {
    axis: 'confidence',
    key: '`findings[].confidence`',
    kind: 'output, per finding',
    question: 'how sure are you the claim is true?',
    values: CONFIDENCE_VALUES.map((v) => `\`${v}\``).join(' \\| '),
  },
]);

// ---------------------------------------------------------------------------
// Evidence class + citation (B13, adopted from the fable-foreman digest's
// finding contract).
// ---------------------------------------------------------------------------
// The digest names a failure this repo had not yet closed: a reviewer asked to
// self-rate confidence can rate confidently and be wrong, because nothing checks
// the rating against anything. Its fix is to stop asking for a rating at all -
// every finding instead carries an EVIDENCE CLASS (how the claim was reached)
// plus a CITATION a machine can resolve, and calibration is COMPUTED from
// whether citations resolve (`scripts/validate-citations.mjs`), never self-rated.
// A resolved citation proves the cited text/command EXISTS, not that it supports
// the claim - that judgment call stays with whoever reads the review, same as it
// always has.
const EVIDENCE_CLASSES = [
  {
    value: 'quoted',
    text:
      'Verbatim text cited from the source. `citation` is `{ file, line?, quote }`; `quote` is ' +
      'REQUIRED non-empty text - a quoted citation with no quote text is unresolvable-as-quoted, ' +
      'not a weaker resolvable claim. `scripts/validate-citations.mjs` resolves it ' +
      'deterministically: the file must exist, the `quote` must appear in it (whitespace-' +
      'normalized), and a given `line` must fall within 5 lines of an occurrence of the quote.',
  },
  {
    value: 'observed',
    text:
      'A command was run and its output is what the finding cites. `citation` is ' +
      '`{ command, expect? }`; resolution is structural (the command is non-empty) - the ' +
      'command is not re-run.',
  },
  {
    value: 'derived',
    text:
      'Reasoned from other cited facts rather than a fresh read of source or a fresh command. ' +
      '`citation` is a REQUIRED free-text locator naming what it was derived from; not machine-' +
      'resolved, but a derived finding must still say where its reasoning came from.',
  },
  {
    value: 'inferred',
    text:
      'A hypothesis with no direct citation. `citation` may be omitted or `null` - the only ' +
      'evidence class where an absent citation is legal.',
  },
];

const EVIDENCE_CLASS_VALUES = EVIDENCE_CLASSES.map((e) => e.value);

/** Canonical evidence class for an exact token, or `null`. Closed vocabulary - no aliases. */
function normalizeEvidenceClass(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  return EVIDENCE_CLASS_VALUES.includes(raw) ? raw : null;
}

// The confidence axis above (`confirmed`/`possible`/`needs-verification`) is a
// reviewer SELF-RATING: the reviewer decides how sure it is and writes that down.
// The digest's hard rule is to never ask for that rating - "calibration is
// computed by the foreman from whether the citations resolve" - so evidence
// class + citation SUPERSEDES it for any finding that carries them. `confidence`
// is kept, unchanged, for back-compat with every artifact already on disk and
// every consumer that reads it (B11's precision gate among them); a NEW finding
// should carry `evidenceClass`/`citation` instead of a self-rated `confidence`.
const CALIBRATION_RULE = {
  title: 'Confidence is computed, not self-rated',
  text:
    'Per-finding `confidence` is a reviewer self-rating. It is superseded by `evidenceClass` + ' +
    '`citation`: calibration is COMPUTED from whether citations resolve ' +
    '(`scripts/validate-citations.mjs`), never asked of the reviewer as a confidence score. ' +
    'Kept on the schema for back-compat with artifacts written before this existed - write ' +
    '`evidenceClass`/`citation` on every new finding instead of self-rating `confidence`.',
};

// ---------------------------------------------------------------------------
// The reviewer model (F11).
// ---------------------------------------------------------------------------
// F11: a run on 2026-08-13 shows `auditor` — the one default reviewer, pinned
// `opus` in frontmatter and `deep` in model-policy.json — actually spawning
// `opus:18 sonnet:7`. The frontmatter drift check passes anyway, because it
// compares the PIN against the POLICY and neither one is what ran.
//
// So the model is a property of ONE REVIEW RUN, not of the repo's config and
// not of an individual finding: every finding in a single artifact was produced
// by the same reviewer in the same spawn, and no finding can carry a different
// model from its siblings. It is therefore recorded once per ARTIFACT.
//
// It is recorded VERBATIM and never inferred. A frontmatter pin is what was
// ASKED for; the whole point of F11 is that the two differ 28% of the time, so
// a `model` copied from `agents/auditor.md` would be worse than an absent one — it
// would make a confounded comparison look controlled.
const REVIEWER_MODEL = Object.freeze({
  field: 'model',
  scope: 'artifact',
  required: false,
  text:
    'OPTIONAL, and recorded once for the whole artifact: the model this review actually RAN on. ' +
    'Write it only from what the host reports about the running model. NEVER copy it from a ' +
    'frontmatter pin or from model-policy.json — a pin is what was requested, and F11 measured the ' +
    'default reviewer running the cheaper tier on 7 of 25 spawns while its pin still read `opus`. ' +
    'Omit the key when nothing told you; an absent model is honest, a guessed one is not.',
  whyItMatters:
    'The B11 precision gate compares findings that carry a `confidence` against findings that do ' +
    'not. If those two populations ran on different models the gate measures the MODEL, not the ' +
    'verification pass, so it REFUSES to produce a verdict unless both sides share one recorded model.',
});

/**
 * Canonical form of a recorded reviewer model, or `null` when nothing was
 * recorded. Case and surrounding space are noise; everything else is kept
 * verbatim. Deliberately NOT a tier fold: `opus` and `claude-opus-4-5` stay
 * different strings, because collapsing them would be this file guessing that
 * two names mean one model — the exact inference F11 exists to stop. Hosts do
 * not share a vocabulary either (`model-presets.json` maps codex to
 * `gpt-5.6-sol`), so there is no closed enum to check against.
 */
function normalizeReviewerModel(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return raw === '' ? null : raw;
}

// ---------------------------------------------------------------------------
// Independence disclosure (honest-degradation labels, adopted from the
// fable-foreman digest).
// ---------------------------------------------------------------------------
// Foreman's rule: when a verifier and the work it checks resolve to the same
// model, say so plainly - "blind-verified (same model, independent context)"
// - rather than letting the report imply an independent second opinion nobody
// obtained; when no legal independent check exists at all, label the
// acceptance "accepted under reduced assurance", never a silent clean pass.
//
// In Phantom this is COMMON, not an edge case: the delegated roles span two
// model-policy tiers on claude-code (economy -> haiku, balanced/deep ->
// sonnet), so an Engineer (balanced) verified by an Inspector (economy) is
// already a cross-tier pair - but same-tier pairs (an Auditor reviewing
// deep-tier work) remain the norm on every ship. The label exists to
// state that evidence basis honestly rather than dress it up as more than it
// is. `evidenceTier` borrows its two values from project-docs/seat-provenance
// -design.md's REQUESTED/SERVED tier model: everything `hooks/timing-capture.js`
// resolves today is REQUESTED (what was asked for), never SERVED (post-
// resolution proof of what actually answered) - so `model` itself, on this
// same artifact, is requested-tier evidence until that design's v1 lands.
const INDEPENDENCE_BASIS = [
  {
    value: 'same-model-independent-context',
    text:
      'The reviewer resolved to the same model as the work under review, in its own separate ' +
      'context/spawn. A common case: the policy tiers overlap (balanced and deep both resolve to ' +
      'sonnet on claude-code), so same-model review happens on most ships.',
  },
  {
    value: 'cross-model',
    text:
      'The reviewer resolved to a model different from the work under review - a genuine second ' +
      'opinion, not merely a second context.',
  },
  {
    value: 'reduced-assurance',
    text:
      'A structurally required independent check was unavailable (no legal cross-model reviewer, a ' +
      'specialist role that could not be spawned, and so on). The acceptance is labeled reduced, ' +
      'never silently treated as a clean pass.',
  },
];

const INDEPENDENCE_BASIS_VALUES = INDEPENDENCE_BASIS.map((b) => b.value);

// REQUESTED/SERVED, unchanged from project-docs/seat-provenance-design.md §2:
// REQUESTED is what timing-capture.js resolves today (spawn param, frontmatter
// pin, or session inheritance); SERVED is post-resolution proof of what
// actually answered, not yet reachable for an Agent-tool dispatch. This field
// says which tier the recorded `basis` itself rests on - it is never upgraded
// to `served` by this file, only by whatever eventually implements that design.
const INDEPENDENCE_EVIDENCE_TIERS = ['requested', 'served'];

/** Canonical independence basis for an exact token, or `null`. Closed vocabulary - no aliases. */
function normalizeIndependenceBasis(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  return INDEPENDENCE_BASIS_VALUES.includes(raw) ? raw : null;
}

/** Canonical evidence tier for an exact token, or `null`. Closed vocabulary - no aliases. */
function normalizeIndependenceEvidenceTier(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  return INDEPENDENCE_EVIDENCE_TIERS.includes(raw) ? raw : null;
}

// Iteration history, kept here because it explains why the label is built
// the way it is below rather than restated as tribal knowledge:
//   1. `label` started as pure free text - "independent" could quietly mean
//      whatever the writer felt like.
//   2. A REQUIRED PREFIX per basis closed that, until a reviewer noticed the
//      prefix only constrains the START of the string: a reduced-assurance
//      label could still append "...but blind-verified (same model,
//      independent context) anyway" after its own prefix.
//   3. A FINITE FOREIGN-PHRASE BLOCKLIST closed THAT gap, checking the other
//      bases' phrases anywhere in the string - until a reviewer pointed out
//      the obvious next hole: no finite list bounds English. A
//      reduced-assurance suffix reading "independently reviewed by a
//      different model" contains none of the three reserved phrases and
//      would sail through a blocklist forever.
//
// There is no fourth patch, because the failure mode is structural, not a
// missing case: prose is unbounded and a validator cannot enumerate it. The
// fix is to STOP VALIDATING PROSE. `label` is no longer free text - it is
// DERIVED, a pure function of `basis` and `evidenceTier`
// (`canonicalIndependenceLabel` below), and `scripts/validate-artifact.js`
// checks it with ONE strict-equality comparison against that derivation.
// There is nothing left for a writer to phrase, so there is nothing left to
// smuggle. The human explanation that used to live inside the label - what,
// specifically, was unavailable - moves to a separate `independence.reason`
// field, which is validated as bounded free text (a reader's context, never
// a machine-checked claim) and REQUIRED when `basis` is `reduced-assurance`.

/**
 * The independence label, DERIVED from `basis` and `evidenceTier` - never
 * hand-written, never free text. `null` when either input does not resolve
 * to a closed-vocabulary token, or (for `same-model-independent-context` /
 * `cross-model`) when `evidenceTier` is missing: those two bases render a
 * tier phrase into the label, so there is nothing correct to derive without
 * one. `reduced-assurance` needs no tier to render - it makes no
 * independence claim for a tier phrase to attach to, which is also why its
 * label is the same constant regardless of `evidenceTier`.
 */
function canonicalIndependenceLabel(basis, evidenceTier) {
  const b = normalizeIndependenceBasis(basis);
  if (!b) return null;
  if (b === 'reduced-assurance') return 'accepted under reduced assurance';
  const t = normalizeIndependenceEvidenceTier(evidenceTier);
  if (!t) return null;
  if (b === 'same-model-independent-context') {
    return `blind-verified (same model, independent context; model identity is ${t}-tier evidence)`;
  }
  // b === 'cross-model'
  return `cross-model review (${t}-tier evidence)`;
}

// Today's truthful default, everywhere: same-model review is the common case
// (balanced and deep resolve to the same delegate model on claude-code), and
// model identity itself is only requested-tier evidence until
// seat-provenance-design.md's v1 lands.
// `label` is DERIVED, not typed by hand, so it cannot drift from what
// `canonicalIndependenceLabel` itself would produce for these two inputs.
const DEFAULT_INDEPENDENCE = Object.freeze({
  basis: 'same-model-independent-context',
  evidenceTier: 'requested',
  label: canonicalIndependenceLabel('same-model-independent-context', 'requested'),
});

/**
 * BACK-COMPAT SHIM ONLY. This used to build the `reduced-assurance` label by
 * embedding a caller-supplied reason as free text after the prefix
 * (`accepted under reduced assurance: <reason>`) - exactly the shape a
 * validator can never fully bound (see the iteration history above). The
 * label is now the canonical CONSTANT alone; the explanation belongs in the
 * separate `independence.reason` field instead, which `scripts/validate-
 * artifact.js` requires (non-empty, capped) whenever `basis` is
 * `reduced-assurance`. The parameter is accepted so existing call sites keep
 * compiling, but it is IGNORED - pass the same text to `independence.reason`
 * directly rather than through this function.
 */
function reducedAssuranceLabel(_reason) {
  return canonicalIndependenceLabel('reduced-assurance', 'requested');
}

// ---------------------------------------------------------------------------
// The one shape.
// ---------------------------------------------------------------------------
// Canonical keys, in the order the schema documents them. `id` and the
// disposition fields are stamped mechanically (scripts/lib/review-finding.js,
// hooks/loop-controller.js); a reviewer writes the rest.
const CANONICAL_FINDING_KEYS = Object.freeze([
  'id',
  'severity',
  'confidence',
  'evidenceClass',
  'citation',
  'preExisting',
  'dimension',
  'file',
  'line',
  'evidence',
  'impact',
  'remediation',
  'disposition',
  'dispositionReason',
]);

// Justice's five review dimensions, which until B10 existed ONLY in its chat
// output format — so `scripts/baseline-report.js` could break precision down
// per severity and per agent but never per dimension, because no artifact field
// carried one. Optional and closed: a reviewer either names one of these or
// omits the key. Auditor has no dimension vocabulary and writes nothing here.
const DIMENSIONS = Object.freeze([
  'cross-file-coherence',
  'regression',
  'semantic-accuracy',
  'dead-code',
  'convention-deviation',
]);

// Legacy key -> canonical key. The three shapes F9 names, collapsed:
//   auditor                 {severity, file, line, evidence, impact, remediation}  (already canonical)
//   temperature-review   {temperature, file, line, issue, fix}
//   verification schema  {file, line, severity, message}
// `component` folds into `file` because one shape means one key for "where";
// review-finding.js already hashes `file || component`, so folding it changes
// no id.
const FINDING_KEY_ALIASES = Object.freeze({
  temperature: 'severity',
  component: 'file',
  issue: 'evidence',
  message: 'evidence',
  description: 'evidence',
  fix: 'remediation',
});

// Claim-text keys in precedence order — the text the finding id hashes. Kept
// here with the aliases so the id derivation and the shape cannot disagree;
// scripts/lib/review-finding.js imports it rather than keeping a second list.
const CLAIM_KEYS = Object.freeze(['evidence', 'issue', 'message', 'description']);

// One spelling for the not-observed array. Auditor wrote `observation_gaps`,
// Justice wrote `observationGaps`; camelCase wins because every other key in
// every Phantom artifact is camelCase.
const GAPS_KEY = 'observationGaps';
const LEGACY_GAPS_KEY = 'observation_gaps';

/**
 * Rewrite one finding into the canonical shape. Pure: returns a new object and
 * never mutates the input. Legacy keys are folded onto their canonical key
 * unless the canonical key is already present (an artifact carrying both keeps
 * the canonical one). Severity is normalized; an unknown severity is passed
 * through UNCHANGED so the validator can name it in an error rather than having
 * it silently vanish here.
 */
function normalizeFinding(finding) {
  if (finding == null || typeof finding !== 'object' || Array.isArray(finding)) return finding;
  const out = {};
  for (const [key, value] of Object.entries(finding)) {
    const canonical = FINDING_KEY_ALIASES[key] || key;
    if (canonical !== key && Object.prototype.hasOwnProperty.call(finding, canonical)) continue;
    out[canonical] = value;
  }
  const severity = normalizeSeverity(out.severity);
  if (severity) out.severity = severity;
  // Same treatment on the OTHER axis, and deliberately in a separate statement
  // that reads neither value: an unknown confidence passes through unchanged for
  // the validator to name, exactly as an unknown severity does.
  const confidence = normalizeConfidence(out.confidence);
  if (confidence) out.confidence = confidence;
  return out;
}

/** Normalize a whole review artifact: gaps key + every finding. Pure. */
function normalizeReview(review) {
  if (review == null || typeof review !== 'object' || Array.isArray(review)) return review;
  const out = { ...review };
  if (out[GAPS_KEY] === undefined && out[LEGACY_GAPS_KEY] !== undefined) out[GAPS_KEY] = out[LEGACY_GAPS_KEY];
  delete out[LEGACY_GAPS_KEY];
  if (Array.isArray(out.findings)) out.findings = out.findings.map(normalizeFinding);
  return out;
}

/** A finding that must not gate the ship: advisory, or flagged pre-existing. */
function isBlocking(finding) {
  if (finding == null || typeof finding !== 'object') return false;
  if (finding.preExisting === true) return false;
  return normalizeSeverity(finding.severity !== undefined ? finding.severity : finding.temperature) === 'blocking';
}

/**
 * The findings a fix loop is allowed to act on. Everything else reports and
 * stops there — which is the whole point of `preExisting`.
 */
function fixLoopFindings(findings) {
  return (Array.isArray(findings) ? findings : []).filter(isBlocking);
}

// The disposition reason stamped on a pre-existing finding when the loop
// closes. It is `deferred`, never `fixed`, even if the loop happened to touch
// the same file: counting a defect the diff never introduced as a fix would
// inflate the precision number B9 exists to measure honestly.
const PRE_EXISTING_DEFER_REASON = 'pre-existing: reported, never entered the fix loop';

// ---------------------------------------------------------------------------
// The rules (B10 a-d, f). Prose lives here so auditor.md, justice.md and the
// schema docs render the SAME words instead of four paraphrases of them.
// ---------------------------------------------------------------------------

const EVIDENCE_RULE = {
  title: 'Cite the source, not the name',
  text:
    'A behavioural claim must cite `file:line` in the source you actually read; an inference from ' +
    'a symbol\'s NAME is not evidence, because `validateInput()` may validate nothing. ' +
    'A `blocking` finding always carries a `line`; the schema rejects one that does not.',
};

const BLOCKING_BAR = {
  title: 'Blocking means the diff made it worse',
  text:
    'Mark a finding `blocking` only when the diff makes something WORSE than it was before, ' +
    'or fails the stated intent, judged against the PRIOR state of the code rather than the ' +
    'repository ideal. Everything else is `advisory`.',
};

const PRE_EXISTING_RULE = {
  title: 'Pre-existing defects report, they never block',
  text:
    'A real defect the diff did NOT introduce is reported with `preExisting: true` and severity ' +
    '`advisory`: it never blocks, never enters the fix loop, and is never counted as a defect ' +
    'this diff caused.',
};

const TEST_COMPANION_RULE = {
  title: 'Source changed, tests did not',
  text:
    'Run `node scripts/review-gaps.js --from-git` (or pass the changed-file list with `--files`); ' +
    'it names every changed SOURCE file with no corresponding changed test file. Report each one ' +
    'as a single `advisory` finding citing the source file.',
};

const VERIFICATION_RULE = {
  title: 'Verify against the source before the finding lands',
  text:
    'Between finding something and writing the artifact, re-open the cited `file:line` and ' +
    'confirm the claimed behaviour is actually there. Anything you cannot confirm at the source ' +
    'is DISCARDED, not downgraded — record it in `discardedFindings` with the reason. This is a ' +
    'pass over the CODE, never a second look at your own finding list: same-context self-critique ' +
    'produces false negatives on your own output, while re-checking a claim against the source is ' +
    'what cuts false positives.',
};

// The pass itself, as an ordered procedure: every step names a source-side
// action, because "verify your findings" degrades into re-reading the findings.
const VERIFICATION_PASS = {
  title: 'The verification pass',
  intro:
    'Run this once, after investigating and BEFORE writing the artifact. Only findings that ' +
    'survive it are written.',
  steps: [
    'RE-OPEN the file at the cited line with a read of the source, now. Not the diff hunk, not ' +
      'your earlier notes, not the summary you already wrote.',
    'READ the whole enclosing definition, plus the callers you claimed are affected.',
    'QUOTE what you just read into `evidence`.',
    'DECIDE against the source, not against how good the finding sounds: the behaviour is there ' +
      '(`confirmed`); the line reads as claimed but the consequence depends on a path you could ' +
      'not follow (`possible`); or the source does not support the claim (DISCARD it).',
    'DISCARD by moving the finding into `discardedFindings` with a `reason` naming what the source ' +
      'actually says. A discarded finding is never silently deleted and never quietly re-scored ' +
      'into an advisory.',
    'Use `needs-verification` ONLY when the source could not be re-read at all, and add the ' +
      'matching `observationGaps` entry saying why.',
  ],
  antipattern:
    'If your check did not involve opening a file, it did not happen. Reading the finding list ' +
    'again and agreeing with it is not this pass.',
};

const CONFIDENCE_RULE = {
  title: 'Confidence is not severity',
  text:
    'Severity is importance, confidence is certainty, and neither is computed from the other. ' +
    'All six combinations are legal: an unsure bug is `blocking` and `possible`, a certain nit is ' +
    '`advisory` and `confirmed`.',
};

// B12. The round is supplied by the caller (scripts/review-round.js reads the
// carry-over ledger); a reviewer never counts rounds itself.
const CONVERGENCE_RULE = {
  title: 'Round 2 and later: blocking only',
  text:
    'On the second and later review pass over the same session, report `blocking` findings only. ' +
    'Non-blocking findings are suppressed and reported as a COUNT, split into the ones carried ' +
    'over from an earlier round and the ones first seen this round. A NEW blocking finding is ' +
    'always reported — the fix may have broken something, and that is what a re-review is for.',
};

// ---------------------------------------------------------------------------
// The promote/revert gate on measured precision (B11), modelled on B6.
// ---------------------------------------------------------------------------
// B6 gates a down-pin on wall-clock against the incumbent. This gates the
// verification pass on PRECISION against the un-verified corpus, and it is the
// same shape: a stated input, a stated comparison, one verdict word.
//
// WHAT IT READS: the two precision bands `scripts/baseline-report.js` already
// computes (`reviewFindings.byConfidence`) — findings written WITH a recorded
// confidence, which are the post-B11 verified ones, against findings written
// WITHOUT one. Precision itself is Martian's online true-positive definition
// (B9b): fixed/(fixed+dismissed+deferred) as the lower bound and
// fixed/(fixed+dismissed) as the upper.
//
// WHY THERE IS NO THRESHOLD NUMBER HERE, stated rather than papered over: the
// corpus is 0/0 measurable today. B9b reports precision as UNMEASURABLE until
// the first post-B9 fix loop closes, so any number written into this file now
// would be taste wearing the costume of a measurement — which is exactly what
// D4 and B6 exist to prevent. Two consequences, both deliberate:
//
//   1. `minSample` is null. The gate returns `unmeasurable` until a human sets
//      it against real data, and says so in its reason.
//   2. The comparison is BAND-vs-BAND, not point-vs-threshold. Promote needs the
//      verified LOWER bound above the unverified UPPER bound; revert needs the
//      verified UPPER below the unverified LOWER. Overlapping bands are
//      `inconclusive`. That decides on non-overlap, which needs no invented
//      margin, and it cannot fire on an empty or tiny denominator.
//
// AND THE THIRD REFUSAL, added for F11. The two sides are only comparable if
// they were produced by the SAME reviewer. They were not: auditor ran
// `opus:18 sonnet:7` against an opus pin, engineer `sonnet:128 opus:23 haiku:12`.
// A gate fed one model on one side and another on the other measures the model,
// so the model precondition is checked BEFORE the sample size — more samples
// cannot un-confound a comparison — and a missing model is a refusal too, not a
// benefit of the doubt. Nothing here estimates or adjusts for the difference;
// the confound is named in words and the verdict stays `unmeasurable`.
const PRECISION_GATE = Object.freeze({
  input:
    'scripts/baseline-report.js REVIEW FINDINGS -> reviewFindings.byConfidence: the precision ' +
    'band of findings carrying a recorded `confidence` (verified, post-B11) against the band of ' +
    'findings carrying none (unverified). Precision = fixed/(fixed+dismissed+deferred) lower, ' +
    'fixed/(fixed+dismissed) upper (B9b). PRECONDITION (F11): both sides must carry the SAME ' +
    'single recorded reviewer `model` (per artifact).',
  // Deliberately unset. See the block comment above.
  minSample: null,
  minSampleReason:
    'unset: the review corpus is 0/0 measurable (B9b) until the first post-B9 fix loop closes',
  modelPrecondition:
    'the verified and unverified populations must share ONE recorded model, or the gate compares ' +
    'reviewers instead of comparing the verification pass (F11)',
  verdicts: Object.freeze(['promote', 'revert', 'inconclusive', 'unmeasurable']),
  confounds: Object.freeze(['reviewer-model']),
});

// A band with no measurable finding, or with an undefined upper bound (every
// disposition deferred, so fixed is 0 and the upper bound is not a number), is
// read at its most permissive: 1. That makes both promote and revert HARDER to
// reach on thin data rather than easier, in both directions.
function bandOf(side) {
  if (!side || typeof side !== 'object') return null;
  const n = typeof side.dispositioned === 'number' ? side.dispositioned : 0;
  if (n <= 0) return null;
  const lower = typeof side.precisionLower === 'number' ? side.precisionLower : 0;
  const upper = typeof side.precisionUpper === 'number' ? side.precisionUpper : 1;
  return { n, lower, upper };
}

/**
 * Which models one side of the comparison ran on. `values` is the recorded
 * `model` of each measurable finding's ARTIFACT, in any order; an entry that is
 * absent, empty, or not a string counts as UNRECORDED. A list shorter than the
 * side's population is short by that many unrecorded entries — a missing model
 * is never read as "same as the others".
 */
function modelPopulation(values, n) {
  const list = Array.isArray(values) ? values : [];
  const models = new Set();
  let unrecorded = 0;
  for (const value of list) {
    const model = normalizeReviewerModel(value);
    if (model) models.add(model);
    else unrecorded += 1;
  }
  const size = typeof n === 'number' && n > list.length ? n : list.length;
  unrecorded += size - list.length;
  return { models: [...models].sort(), unrecorded, n: size };
}

/**
 * The F11 confound check. Returns the reason the two sides are not comparable,
 * or `null` when they demonstrably ran on ONE shared model. It never resolves a
 * disagreement and never estimates around one - it only says what is wrong.
 */
function modelConfound(beforeModels, afterModels) {
  const list = (side) => (side.models.length ? side.models.join(', ') : 'nothing');
  const missing = [];
  if (beforeModels.unrecorded > 0) missing.push(`unverified ${beforeModels.unrecorded}/${beforeModels.n}`);
  if (afterModels.unrecorded > 0) missing.push(`verified ${afterModels.unrecorded}/${afterModels.n}`);
  if (missing.length) {
    return (
      `the reviewer model is UNRECORDED on ${missing.join(' and ')} measurable finding(s), so the two ` +
      'sides cannot be shown to have run on one model. Record `model` on the review artifact ' +
      '(per artifact, from what the host reports); it is never inferred from a frontmatter pin, ' +
      'because F11 measured the default reviewer running the cheaper tier on 7 of 25 spawns while ' +
      'its pin still read `opus`'
    );
  }
  if (beforeModels.models.length > 1 || afterModels.models.length > 1) {
    return (
      `a side spans more than one model - unverified ran ${list(beforeModels)}, verified ran ` +
      `${list(afterModels)}. A mixed-model population measures the MODEL, not the verification pass (F11)`
    );
  }
  if (beforeModels.models[0] !== afterModels.models[0]) {
    return (
      `the two sides ran on DIFFERENT models - unverified ${beforeModels.models[0]}, verified ` +
      `${afterModels.models[0]}. Comparing them would measure the model, not the verification pass (F11)`
    );
  }
  return null;
}

/**
 * The promote/revert verdict for the verification pass. Pure.
 *
 * @param {object} opts
 * @param {object} opts.before  precision tally for UNVERIFIED findings (no `confidence` recorded)
 * @param {object} opts.after   precision tally for VERIFIED findings (a `confidence` recorded)
 * @param {number|null} opts.minSample  minimum measurable findings per side; null = gate disabled
 * @param {{before: string[], after: string[]}} [opts.models]  the recorded reviewer model behind
 *        each measurable finding on each side (F11). OMITTING IT IS NOT A PASS: an unrecorded
 *        model is a confound, so a caller that supplies nothing gets `unmeasurable`.
 * @returns {{verdict: string, reason: string, confound: string|null, before: object|null,
 *           after: object|null, minSample: number|null, models: object}}
 */
function precisionGate({ before, after, minSample = PRECISION_GATE.minSample, models } = {}) {
  const b = bandOf(before);
  const a = bandOf(after);
  const out = {
    verdict: 'unmeasurable',
    reason: '',
    confound: null,
    before: b,
    after: a,
    minSample: minSample == null ? null : minSample,
    models: { before: null, after: null },
  };

  if (!b || !a) {
    const sides = [!b ? 'unverified' : null, !a ? 'verified' : null].filter(Boolean).join(' and ');
    out.reason = `no measurable finding on the ${sides} side - precision is UNMEASURABLE, not 0%`;
    return out;
  }

  // F11 BEFORE the sample-size check: a bigger sample cannot un-confound a
  // comparison between two different reviewers.
  const bm = modelPopulation(models && models.before, b.n);
  const am = modelPopulation(models && models.after, a.n);
  out.models = { before: bm, after: am };
  const confound = modelConfound(bm, am);
  if (confound) {
    out.confound = 'reviewer-model';
    out.reason = confound;
    return out;
  }

  if (!(Number.isInteger(minSample) && minSample > 0)) {
    out.reason = `no minimum sample size is set (${PRECISION_GATE.minSampleReason})`;
    return out;
  }
  if (b.n < minSample || a.n < minSample) {
    out.reason = `sample too small: unverified ${b.n}, verified ${a.n}, minimum ${minSample} per side`;
    return out;
  }
  const band = (x) => `${(x.lower * 100).toFixed(1)}%-${(x.upper * 100).toFixed(1)}%`;
  // Every firing verdict states the model both sides held constant, so no
  // verdict can be quoted without the control that made it a comparison.
  const on = ` (both sides on ${am.models[0]})`;
  if (a.lower > b.upper) {
    out.verdict = 'promote';
    out.reason = `verified ${band(a)} is entirely above unverified ${band(b)}${on}`;
    return out;
  }
  if (a.upper < b.lower) {
    out.verdict = 'revert';
    out.reason = `verified ${band(a)} is entirely below unverified ${band(b)}${on}`;
    return out;
  }
  out.verdict = 'inconclusive';
  out.reason = `bands overlap: verified ${band(a)} against unverified ${band(b)}${on}`;
  return out;
}

// ---------------------------------------------------------------------------
// Re-review convergence (B12).
// ---------------------------------------------------------------------------
// `commands/review.md` step 4 DELETES `{SESSION_DIR}/reviews/auditor.json` before
// every pass, so a failed or truncated run cannot reuse an older verdict. That
// deletion stays. The prior round's finding ids therefore cannot live in the
// file being deleted — they live in a sibling ledger the delete does not name.
//
// The ledger holds IDS AND SEVERITIES ONLY, never a verdict and never a
// findings array a consumer could mistake for a review. That is what preserves
// the freshness property by construction rather than by discipline: there is no
// stale verdict in it TO reuse. scripts/review-round.js owns the file I/O.
const REVIEW_ROUNDS_FILE = 'rounds.json';
const REVIEW_ROUNDS_SCHEMA = 'phantom.review-rounds/1';

/** Every finding id recorded by any earlier round, de-duplicated, in order. */
function priorFindingIds(ledger) {
  const out = [];
  const seen = new Set();
  const rounds = ledger && Array.isArray(ledger.rounds) ? ledger.rounds : [];
  for (const round of rounds) {
    const findings = round && Array.isArray(round.findings) ? round.findings : [];
    for (const f of findings) {
      const id = f && typeof f.id === 'string' ? f.id.trim() : '';
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/** Which round the NEXT pass is: one more than however many are recorded. */
function nextRound(ledger) {
  const rounds = ledger && Array.isArray(ledger.rounds) ? ledger.rounds : [];
  return rounds.length + 1;
}

/**
 * Split a round's findings into what it may report and what it may only count.
 * Pure.
 *
 * Round 1 reports everything. Round 2+ reports blocking findings only — INCLUDING
 * a blocking finding that is new, because the fix may have broken something and
 * catching that is what a re-review is for. Non-blocking findings are suppressed
 * and counted, split by whether an earlier round already raised them.
 *
 * `idOf` defaults to the finding's own `id`, which assumes ids are already
 * stamped (scripts/lib/review-finding.js `assignFindingIds`) — this module keeps
 * no crypto dependency, and review-finding.js already imports THIS file, so the
 * derivation is injected rather than required back the other way.
 */
function convergenceFilter(findings, { round = 1, priorIds = [], idOf = (f) => (f && f.id) || null } = {}) {
  const list = Array.isArray(findings) ? findings.filter((f) => f && typeof f === 'object' && !Array.isArray(f)) : [];
  const n = Number.isInteger(round) && round >= 1 ? round : 1;
  const prior = new Set((Array.isArray(priorIds) ? priorIds : []).filter((id) => typeof id === 'string' && id.trim()));

  if (n <= 1) {
    return {
      round: n,
      reported: list,
      suppressed: { total: 0, carriedOver: 0, new: 0, ids: [] },
      reason: 'round 1 reports everything; there is no earlier round to converge on',
    };
  }

  const reported = [];
  const suppressedIds = [];
  let carriedOver = 0;
  let fresh = 0;
  for (const f of list) {
    if (isBlocking(f)) {
      reported.push(f);
      continue;
    }
    const id = idOf(f);
    if (id && prior.has(id)) carriedOver += 1;
    else fresh += 1;
    if (id) suppressedIds.push(id);
  }
  return {
    round: n,
    reported,
    suppressed: { total: carriedOver + fresh, carriedOver, new: fresh, ids: suppressedIds },
    reason: `round ${n}: blocking findings only (B12)`,
  };
}

// OWASP Top 10:2025 anchored. Named categories, because the secure-review
// literature finds reviewers systematically UNDER-discuss the weakness classes
// behind real CVEs, and a generic instruction ("check security") does not
// correct a systematic blind spot — an explicit checklist does.
const SECURITY_CATEGORIES = Object.freeze([
  {
    name: 'Broken access control (including SSRF)',
    check: 'missing or wrong authorization on a new route, handler, query or job; an object id taken from the request and trusted; a server-side fetch whose URL the caller controls',
  },
  {
    name: 'Injection',
    check: 'SQL/NoSQL/shell/template/LDAP built by string concatenation from request, file or environment data instead of parameterized or escaped',
  },
  {
    name: 'Cryptographic failures',
    check: 'home-rolled crypto, a broken primitive (MD5/SHA-1/ECB), a static IV or salt, a non-constant-time comparison of secrets, TLS verification disabled',
  },
  {
    name: 'Secrets in code, config or logs',
    check: 'a key, token, password or connection string committed, defaulted in config, echoed into a log line, or attached to an error report',
  },
  {
    name: 'Unsafe defaults',
    check: 'a new option, flag or config key whose DEFAULT is the permissive value: auth off, verification skipped, debug on, CORS `*`, a wide-open bind address',
  },
  {
    name: 'Data exposure',
    check: 'a response, log, error message, cache key or analytics event that newly carries PII, credentials or another tenant\'s data',
  },
]);

// ---------------------------------------------------------------------------
// Rendering. Every consumer file gets its block from here.
// ---------------------------------------------------------------------------

/**
 * Greedy wrap to `width` columns, for prose rendered out of a data constant
 * rather than typed as literal lines. Deterministic, so `--check` stays stable.
 */
function wrap(text, width = 95) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The severity scale as a Markdown table plus the no-third-level rule. */
function renderSeverityTable() {
  const rows = SEVERITIES.map((s) => `| \`${s.value}\` | ${s.bar} | ${s.action} |`);
  return [
    '| Severity | Bar | Action |',
    '| --- | --- | --- |',
    ...rows,
    '',
    'These are the only two values. There is no third level and no P0-P3 ordinal: a finding that',
    'clears neither bar is NOT REPORTED at all — lint, style, naming and preference nits are',
    'enforced mechanically elsewhere, and restating them is noise the author pays for.',
    `Legacy spellings still on disk are read as ${Object.entries(SEVERITY_ALIASES)
      .map(([from, to]) => `\`${from}\`->\`${to}\``)
      .join(', ')}; never write them.`,
  ].join('\n');
}

/** The reporting rules, as a numbered list. */
function renderFindingRules() {
  return [EVIDENCE_RULE, BLOCKING_BAR, PRE_EXISTING_RULE, TEST_COMPANION_RULE, VERIFICATION_RULE]
    .map((rule, i) => `${i + 1}. **${rule.title}.** ${rule.text}`)
    .join('\n');
}

/** The confidence scale, plus the three axes it must not be confused with. */
function renderConfidenceTable() {
  const rows = CONFIDENCE.map((c) => `| \`${c.value}\` | ${c.bar} | ${c.action} |`);
  return [
    '| Confidence | Bar | Action |',
    '| --- | --- | --- |',
    ...rows,
    '',
    `**${CONFIDENCE_RULE.title}.** ${CONFIDENCE_RULE.text}`,
    '',
    `**${CALIBRATION_RULE.title}.** ${CALIBRATION_RULE.text}`,
    '',
    'Three axes, three questions, none of them derived from another:',
    '',
    '| Axis | Field | Kind | Question | Values |',
    '| --- | --- | --- | --- | --- |',
    ...REVIEW_AXES.map((a) => `| ${a.axis} | ${a.key} | ${a.kind} | ${a.question} | ${a.values} |`),
    '',
    'The confidence axis is what the verification pass MOVES: an unverified claim is either',
    'confirmed against the source or discarded. It is not a place to park a guess.',
  ].join('\n');
}

/** The verification pass, as an ordered source-side procedure. */
function renderVerificationPass() {
  return [
    VERIFICATION_PASS.intro,
    '',
    ...VERIFICATION_PASS.steps.map((step, i) => `${i + 1}. ${step}`),
    '',
    `**Not this:** ${VERIFICATION_PASS.antipattern}`,
  ].join('\n');
}

/** The re-review convergence rule. */
function renderConvergenceRule() {
  return [
    `${CONVERGENCE_RULE.text}`,
    '',
    'You are TOLD which round this is; you never count rounds yourself: the caller runs',
    '`node scripts/review-round.js status --reviews {SESSION_DIR}/reviews` before spawning you and',
    'passes the round number in. Absent a stated round, this is round 1 and nothing is suppressed.',
    '',
    'What changes on round 2 and later:',
    '',
    '- **Your attention.** Re-review the FIX diff and the blocking classes, not the whole change.',
    '- **What you SAY.** Your chat summary itemizes `blocking` findings only; non-blocking ones',
    '  are given as a single count.',
    '- **What you WRITE stays complete.** Keep every finding you stand behind in the artifact —',
    '  `node scripts/review-round.js close` matches its finding ids against the earlier rounds and',
    '  reports the carried-over and newly-raised counts for you.',
  ].join('\n');
}

/** The named security categories, as a checklist. */
function renderSecurityCategories() {
  return [
    'Check each named category against the diff. Naming them is the point: "check security" does',
    'not correct a blind spot, a list does.',
    '',
    ...SECURITY_CATEGORIES.map((c) => `- **${c.name}** — ${c.check}`),
  ].join('\n');
}

/** The canonical finding shape, as a fenced JSON example. */
function renderFindingShape() {
  return [
    '```json',
    '{',
    '  "role": "auditor",',
    '  "model": "the model this review RAN on - omit unless the host told you",',
    '  "independence": {',
    `    "basis": "${INDEPENDENCE_BASIS_VALUES.join('|')}",`,
    `    "evidenceTier": "${INDEPENDENCE_EVIDENCE_TIERS.join('|')}",`,
    '    "label": "DERIVED - must exactly equal canonicalIndependenceLabel(basis, evidenceTier)",',
    '    "reason": "free text; required when basis is reduced-assurance, optional otherwise"',
    '  },',
    '  "verdict": "pass|fail|blocked",',
    '  "findings": [',
    '    {',
    `      "severity": "${SEVERITY_VALUES.join('|')}",`,
    `      "confidence": "${CONFIDENCE_VALUES.join('|')}",`,
    `      "evidenceClass": "${EVIDENCE_CLASS_VALUES.join('|')}",`,
    '      "citation": { "file": "src/example.ts", "line": 42, "quote": "what you read, verbatim" },',
    '      "preExisting": false,',
    '      "file": "src/example.ts",',
    '      "line": 42,',
    '      "evidence": "what you read at that line, quoted or paraphrased",',
    '      "impact": "the user-visible consequence",',
    '      "remediation": "the smallest valid fix"',
    '    }',
    '  ],',
    '  "discardedFindings": [',
    '    {',
    '      "file": "src/example.ts",',
    '      "evidence": "the claim you were going to make",',
    '      "reason": "what the source actually says at the line you re-read"',
    '    }',
    '  ],',
    `  "${GAPS_KEY}": []`,
    '}',
    '```',
    '',
    'One shape, every reviewer, every path. `line` is required whenever `severity` is `blocking`.',
    '`preExisting` may be omitted when false. `severity` and `confidence` are independent: score',
    'each on its own axis and never derive one from the other. `discardedFindings` is what the',
    'verification pass dropped and may be omitted when it dropped nothing — an omitted key and an',
    'empty array both mean "nothing discarded". `id`, `disposition`, `dispositionReason` and',
    '`convergence` are stamped mechanically after you report (`scripts/lib/review-finding.js`,',
    '`hooks/loop-controller.js`, `scripts/review-round.js`) — never write them yourself.',
    '',
    ...wrap(
      `\`evidenceClass\` is OPTIONAL (back-compat) and closed: ${EVIDENCE_CLASS_VALUES.join('/')}. ` +
        'It supersedes self-rated `confidence` (see the confidence section above) - write it on ' +
        'every new finding instead. `citation` is REQUIRED once `evidenceClass` is `quoted`, ' +
        '`observed`, or `derived`, and its shape follows the class: `{ file, line?, quote }` for ' +
        '`quoted` (quote text is required - a quoted citation with no quote is unresolvable-as-' +
        'quoted, not a weaker legal one), `{ command, expect? }` for `observed`, a non-empty ' +
        'free-text locator string for `derived`, and `null` (or omitted) for `inferred` - the ' +
        'only class where an absent citation is legal. Run `node scripts/validate-citations.mjs ' +
        '<artifact> --root <workspace-root>` to resolve every citation deterministically and ' +
        'compute calibration; `--root` is REQUIRED because an artifact lives in a session ' +
        'directory while citation file paths are workspace-relative. It never asks you, or ' +
        'anyone, to self-rate.'
    ),
    '',
    ...wrap(`\`${REVIEWER_MODEL.field}\` is ${REVIEWER_MODEL.text} ${REVIEWER_MODEL.whyItMatters}`),
    '',
    ...wrap(
      '`independence` is OPTIONAL (back-compat: absent on every artifact written before this field ' +
        'existed) but STRONGLY EXPECTED going forward, and recorded once for the whole artifact, same ' +
        'as `model`. `basis` names whether this review is a genuine second opinion ' +
        `(\`${INDEPENDENCE_BASIS_VALUES[1]}\`) or the same model reviewing in its own separate context ` +
        `(\`${INDEPENDENCE_BASIS_VALUES[0]}\`, the common case while balanced and deep resolve to ` +
        `the same delegate model), or that a required independent check was structurally unavailable ` +
        `(\`${INDEPENDENCE_BASIS_VALUES[2]}\`). \`evidenceTier\` states what that claim itself rests on: ` +
        '`requested` (what was asked for) or `served` (post-resolution proof of what actually answered) ' +
        '- today every recorded `model` is requested-tier, so `basis` is too, until seat-provenance-' +
        'design.md\'s served-tier probe lands. `label` is NOT free text: it is DERIVED, a pure ' +
        'function of `basis` and `evidenceTier` (`canonicalIndependenceLabel` in review-standard.js), ' +
        'and must EXACTLY EQUAL that function\'s output for the two tokens you recorded - no prefix ' +
        'match, no phrase check, one strict-equality comparison. A hand-phrased label can always find ' +
        'wording no finite check enumerates ("independently reviewed by a different model" names no ' +
        'reserved phrase yet still overstates a reduced-assurance acceptance), so the claim sentence ' +
        'is no longer something you write at all - only `basis` and `evidenceTier` are choices; the ' +
        'label follows mechanically. The human explanation - what, specifically, made the check ' +
        'unavailable - goes in the separate `reason` field instead: free text, capped at 500 UTF-8 ' +
        'bytes, REQUIRED (non-empty) when `basis` is `reduced-assurance` because a reduced-assurance ' +
        'acceptance with no stated reason is meaningless, optional for the other two bases.'
    ),
    '',
    'A clean review is `"verdict": "pass"` with a written `"findings": []`. An absent key is a',
    'DIFFERENT result — it means no review landed — and must never report as a clean one.',
  ].join('\n');
}

const BLOCKS = Object.freeze({
  'severity-table': renderSeverityTable,
  'confidence-table': renderConfidenceTable,
  'finding-rules': renderFindingRules,
  'verification-pass': renderVerificationPass,
  'convergence-rule': renderConvergenceRule,
  'security-categories': renderSecurityCategories,
  'finding-shape': renderFindingShape,
});

/** Render one named block, or throw for an unknown name. */
function renderBlock(name) {
  const fn = BLOCKS[name];
  if (!fn) throw new Error(`unknown review-standard block: ${name} (known: ${Object.keys(BLOCKS).join(', ')})`);
  return fn();
}

module.exports = {
  SEVERITIES,
  SEVERITY_VALUES,
  DIMENSIONS,
  SEVERITY_ALIASES,
  normalizeSeverity,
  CONFIDENCE,
  CONFIDENCE_VALUES,
  CONFIDENCE_ALIASES,
  normalizeConfidence,
  EVIDENCE_CLASSES,
  EVIDENCE_CLASS_VALUES,
  normalizeEvidenceClass,
  CALIBRATION_RULE,
  REVIEWER_MODEL,
  normalizeReviewerModel,
  INDEPENDENCE_BASIS,
  INDEPENDENCE_BASIS_VALUES,
  INDEPENDENCE_EVIDENCE_TIERS,
  normalizeIndependenceBasis,
  normalizeIndependenceEvidenceTier,
  canonicalIndependenceLabel,
  DEFAULT_INDEPENDENCE,
  reducedAssuranceLabel,
  REVIEW_AXES,
  PRECISION_GATE,
  precisionGate,
  modelPopulation,
  REVIEW_ROUNDS_FILE,
  REVIEW_ROUNDS_SCHEMA,
  priorFindingIds,
  nextRound,
  convergenceFilter,
  CANONICAL_FINDING_KEYS,
  FINDING_KEY_ALIASES,
  CLAIM_KEYS,
  GAPS_KEY,
  LEGACY_GAPS_KEY,
  normalizeFinding,
  normalizeReview,
  isBlocking,
  fixLoopFindings,
  PRE_EXISTING_DEFER_REASON,
  EVIDENCE_RULE,
  BLOCKING_BAR,
  PRE_EXISTING_RULE,
  TEST_COMPANION_RULE,
  VERIFICATION_RULE,
  VERIFICATION_PASS,
  CONFIDENCE_RULE,
  CONVERGENCE_RULE,
  SECURITY_CATEGORIES,
  BLOCKS,
  renderBlock,
  renderSeverityTable,
  renderConfidenceTable,
  renderFindingRules,
  renderVerificationPass,
  renderConvergenceRule,
  renderSecurityCategories,
  renderFindingShape,
};
