// Author: Subash Karki
// loop-controller.js — canonical authority for the verify/fix loop ceiling.
//
// Standalone library (NOT wired into hooks.json). Prose in fix.md/verify.md/apex.md
// DEFERS to this module so the Markdown and the count can't drift. The counter is
// the same `review.fixLoops` field in verification.json
// — there is no parallel source of truth.
//
// Rationale for the ceiling: user's CLAUDE.md — "if a fix attempt fails twice with
// the same error class, STOP patching; the approach is wrong."
//
// Also the authority for CLOSING that loop: closeFixLoop() attributes a
// disposition (fixed/dismissed/deferred) to each INDIVIDUAL finding, because the
// fixLoops counter answers "how many loops ran" and never "which finding was
// acted on" (B9). Same module because it is the same loop, one step later.
//
// Also the authority for the RUN-level halt of an UNATTENDED run (spend ceiling +
// stuck detection) via unattendedHalt() — same module because it is the same
// question one level up: may this loop keep going? scripts/run-guard.js is its
// I/O shell (observes spend, records the halt); this file stays pure.
//
'use strict';

let FIX_LOOP_CEILING = 2;
let SPEND_CEILING_USD = 5;
let STUCK_REPEAT_LIMIT = 2;
try {
  const C = require('../scripts/lib/constants');
  FIX_LOOP_CEILING = C.FIX_LOOP_CEILING ?? 2;
  SPEND_CEILING_USD = C.SPEND_CEILING_USD ?? 5;
  STUCK_REPEAT_LIMIT = C.STUCK_REPEAT_LIMIT ?? 2;
} catch (_) { /* fail open: lib missing → inline defaults */ }

// Finding identity + the disposition vocabulary (B9). Same fail-open load as
// constants: a recorder that cannot load its lib must not crash the fix loop it
// is only observing. Missing → closeFixLoop() records nothing and says so.
let findingLib = null;
try {
  findingLib = require('../scripts/lib/review-finding');
} catch (_) { /* fail open: lib missing → closeFixLoop reports recorded:false */ }

// The review standard (B10): which findings a fix loop may act on, and the
// reason stamped on the ones it may not. Same fail-open load; without it the
// controller keeps B9 behaviour and simply never special-cases preExisting.
let standard = null;
try {
  standard = require('../scripts/lib/review-standard');
} catch (_) { /* fail open */ }

// Read the loop count off a verification artifact (review.fixLoops). Missing/garbage
// state fails safe to 0 (loop has not run).
function getFixLoops(verification) {
  const n = verification && verification.review && verification.review.fixLoops;
  return typeof n === 'number' && n >= 0 ? n : 0;
}

// Increment the counter on the artifact in place and return the new count. Keeps
// review.fixLoops as the single source of truth that validate-artifact.js checks.
function incrementFixLoops(verification) {
  if (!verification.review || typeof verification.review !== 'object') verification.review = {};
  verification.review.fixLoops = getFixLoops(verification) + 1;
  return verification.review.fixLoops;
}

// ---------------------------------------------------------------------------
// B9: per-finding disposition at fix-loop close.
//
// The counter above answers "how many loops ran?" for the review AS A WHOLE.
// That is the wrong grain for review quality: it cannot say WHICH finding was
// acted on, so precision per severity, per dimension, per agent is uncomputable
// from it. closeFixLoop() attributes an outcome to the INDIVIDUAL finding,
// which is the half the data path was missing.
//
// Pure like the rest of this module: no fs, no clock. The caller supplies the
// changed-file list (git already knows it) and any explicit dismissals, and gets
// back the artifact mutated in place plus the per-finding rows a miner prints.
// ---------------------------------------------------------------------------

// Attribution rules, in order. Rule 2 is Martian's Code Review Bench online
// metric — a finding counts as acted on if the code changed after it — which
// needs no human labelling and so cannot rot the way a hand-kept ledger does.
//   1. an explicit dismissal wins, always: a human said no, and a later loop
//      must not overwrite that (the "hand-dismiss without re-running the
//      review" case);
//   2. else a disposition already recorded stands (first close wins, so a
//      second call is idempotent);
//   2b. else `deferred` when the finding is `preExisting` (B10) — it never
//      entered the loop, so no outcome of the loop belongs to it;
//   3. else `fixed` when the finding's file is in changedFiles;
//   4. else `deferred` — the loop closed with the finding still open. Never
//      silently dropped: an unfixed finding that nobody dismissed is a real
//      outcome and gets recorded as one.
const DEFAULT_DEFER_REASON = 'fix loop closed with the finding still open';

function normalizeChangedFile(file) {
  return String(file == null ? '' : file).trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Record a disposition for every finding on `verification.review.findings`,
 * assigning each its stable id first. Mutates in place (same as
 * incrementFixLoops - one artifact, no parallel state) and returns
 * `{ recorded, rows, counts }`; `rows` is one row per finding id, which is the
 * per-finding table the baseline miner prints.
 *
 * @param {object} verification  the verification artifact
 * @param {object} opts
 * @param {string[]} opts.changedFiles  files the fix loop actually changed
 * @param {Array}  opts.dismissals      `[{ id, reason }]` - explicit human waivers
 * @param {string} opts.deferReason     reason stamped on findings left open
 */
function closeFixLoop(verification, { changedFiles = [], dismissals = [], deferReason = DEFAULT_DEFER_REASON } = {}) {
  const empty = { recorded: false, rows: [], counts: { fixed: 0, dismissed: 0, deferred: 0 } };
  if (!findingLib) return empty;
  if (!verification || typeof verification !== 'object') return empty;
  const findings = verification.review && verification.review.findings;
  if (!Array.isArray(findings)) return empty;

  findingLib.assignFindingIds(findings);

  const changed = new Set((Array.isArray(changedFiles) ? changedFiles : []).map(normalizeChangedFile));
  const waived = new Map();
  for (const d of Array.isArray(dismissals) ? dismissals : []) {
    if (d && typeof d.id === 'string') waived.set(d.id, typeof d.reason === 'string' ? d.reason : '');
  }

  const counts = { fixed: 0, dismissed: 0, deferred: 0 };
  const rows = [];
  for (const finding of findings) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) continue;

    if (waived.has(finding.id)) {
      finding.disposition = 'dismissed';
      // A dismissal with no stated reason is unfalsifiable, and the schema
      // rejects it - so an empty reason is recorded as exactly that, not hidden.
      finding.dispositionReason = waived.get(finding.id) || 'dismissed without a recorded reason';
    } else if (!findingLib.DISPOSITIONS.includes(finding.disposition)) {
      const file = normalizeChangedFile(finding.file || finding.component || '');
      if (finding.preExisting === true) {
        // B10(b): a defect the diff did not introduce never entered the loop, so
        // it cannot be `fixed` BY the loop - not even when the loop happened to
        // touch the same file. Counting it as fixed would inflate exactly the
        // precision number B9 exists to measure honestly.
        finding.disposition = 'deferred';
        finding.dispositionReason =
          finding.dispositionReason ||
          (standard ? standard.PRE_EXISTING_DEFER_REASON : 'pre-existing: reported, never entered the fix loop');
      } else if (file && changed.has(file)) {
        finding.disposition = 'fixed';
        delete finding.dispositionReason;
      } else {
        finding.disposition = 'deferred';
        finding.dispositionReason = finding.dispositionReason || deferReason;
      }
    }

    counts[finding.disposition] += 1;
    const rawSeverity = finding.severity || finding.temperature || null;
    rows.push({
      id: finding.id,
      file: finding.file || finding.component || null,
      // The ONE scale (B10). A legacy P0/P2/warn on disk reports as the canonical
      // value it means, so a miner counting precision per severity never has to
      // know which of the four vocabularies wrote the row.
      severity: (standard && standard.normalizeSeverity(rawSeverity)) || rawSeverity,
      preExisting: finding.preExisting === true,
      disposition: finding.disposition,
      reason: finding.dispositionReason || null,
    });
  }

  return { recorded: true, rows, counts };
}

// Same-finding-class escalation: the same failure class appearing twice means we're
// patch-stacking on a wrong hypothesis. classHistory is the per-loop list of finding
// classes attempted so far (e.g. ['type', 'type']).
function sameClassRepeated(classHistory, currentClass) {
  if (!Array.isArray(classHistory) || !currentClass) return false;
  return classHistory.includes(currentClass);
}

// The decision. Default behavior is the hard stop at the ceiling. The ONLY way past
// it is an explicit operator override: the latest attempt uncovered a NEW, narrower
// problem (genuine progress, not the same hypothesis) AND a non-empty justification
// string is recorded. Same-class repetition forces a stop regardless of override.
function shouldContinue({ fixLoops, currentClass, classHistory = [], override = null } = {}) {
  const loops = typeof fixLoops === 'number' && fixLoops >= 0 ? fixLoops : 0;

  if (sameClassRepeated(classHistory, currentClass)) {
    return { continue: false, reason: 'same-finding-class', escalate: true };
  }
  if (loops < FIX_LOOP_CEILING) {
    return { continue: true, reason: 'under-ceiling', escalate: false };
  }

  const j = override && typeof override.justification === 'string' ? override.justification.trim() : '';
  if (override && override.newNarrowerProblem === true && j) {
    return { continue: true, reason: 'operator-override', escalate: false, justification: j };
  }
  return { continue: false, reason: 'ceiling-reached', escalate: true };
}

// ---------------------------------------------------------------------------
// RUN-LEVEL halt (unattended runs only). shouldContinue() above governs ONE
// loop; this governs the whole unattended run that contains it — the thing
// commands/loop.md drives to a draft PR with no human present.
// ---------------------------------------------------------------------------

// The ONLY legal halt states. One home for the enum: scripts/run-guard.js writes
// them into halt.json and scripts/outcome-write.js folds them into outcome.json
// run_state — neither is allowed its own private list.
const HALT_STATES = ['halted_budget', 'halted_stuck'];

// The most-repeated signature in a history plus its occurrence count, counting
// `current` (the attempt about to be made) as one more occurrence. Signature is
// just a string, so this works for failure classes AND for repeated-identical-
// action histories — a caller holding tool-call signatures passes them as the
// history and gets the same answer. sameClassRepeated() above is the limit-2
// special case of this signal and stays the fix-loop's entry point.
function dominantSignature(history, current) {
  const counts = new Map();
  if (Array.isArray(history)) {
    for (const s of history) if (s) counts.set(s, (counts.get(s) || 0) + 1);
  }
  if (current) counts.set(current, (counts.get(current) || 0) + 1);
  let best = { signature: null, occurrences: 0 };
  for (const [s, n] of counts) if (n > best.occurrences) best = { signature: s, occurrences: n };
  return best;
}

/**
 * The unattended-run halt decision. Pure — no I/O, no clock, no fs.
 * Returns { halt, state, reason, observed } where state is one of
 * 'halted_budget' | 'halted_stuck' | null. Callers turn a halt into an honest
 * record (scripts/run-guard.js) — never into a success or a plain failure.
 *
 * FAIL-OPEN POLARITY, and the one place it is deliberately NOT open:
 *   - unattended !== true → NEVER halts. An interactive session has a human
 *     watching, and the human is the ceiling.
 *   - spend UNKNOWN (null / NaN / non-finite, e.g. no cost ledger, no
 *     transcript, unpriceable model) → does NOT halt on budget. We cannot
 *     fabricate a number, and a guard that cannot read spend must not trap a
 *     run. `observed.spendUsd` stays null and the reason says so.
 *   - spend CONFIRMED at/over the ceiling → HALTS. This is the single
 *     non-open branch in the module, and it is not a contradiction of the
 *     repo's fail-open rule: fail-open covers AMBIGUITY, and a confirmed
 *     overage is the absence of ambiguity. Every ambiguous input above still
 *     allows the run to continue.
 *
 * The honest consequence, stated rather than papered over: because unknown
 * spend allows, this cap is a CEILING ON OBSERVED SPEND, not a hard guarantee
 * of total spend. A run whose cost ledger is missing is uncapped, and
 * run-guard says so out loud instead of implying protection it does not have.
 */
function unattendedHalt({
  unattended = false,
  spendUsd = null,
  spendCeilingUsd = SPEND_CEILING_USD,
  currentClass = null,
  classHistory = [],
  stuckLimit = STUCK_REPEAT_LIMIT,
} = {}) {
  const spendKnown = typeof spendUsd === 'number' && Number.isFinite(spendUsd) && spendUsd >= 0;
  const ceiling =
    typeof spendCeilingUsd === 'number' && Number.isFinite(spendCeilingUsd) && spendCeilingUsd > 0
      ? spendCeilingUsd
      : SPEND_CEILING_USD;
  // A limit below 2 would halt on a class's FIRST appearance, which is not a
  // repeat; normalize so a misconfigured env var cannot make the guard trigger-happy.
  const limit = Number.isInteger(stuckLimit) && stuckLimit >= 2 ? stuckLimit : 2;
  const dominant = dominantSignature(classHistory, currentClass);

  const observed = {
    spendUsd: spendKnown ? spendUsd : null,
    spendCeilingUsd: ceiling,
    repeatedClass: dominant.signature,
    repeatOccurrences: dominant.occurrences,
    stuckLimit: limit,
  };

  if (unattended !== true) {
    return { halt: false, state: null, reason: 'interactive-not-capped', observed };
  }
  if (spendKnown && spendUsd >= ceiling) {
    return {
      halt: true,
      state: 'halted_budget',
      reason: `observed spend $${spendUsd.toFixed(2)} reached the unattended ceiling $${ceiling.toFixed(2)}`,
      observed,
    };
  }
  if (dominant.signature && dominant.occurrences >= limit) {
    return {
      halt: true,
      state: 'halted_stuck',
      reason: `no progress: failure class '${dominant.signature}' seen ${dominant.occurrences}x (limit ${limit})`,
      observed,
    };
  }
  return {
    halt: false,
    state: null,
    reason: spendKnown ? 'under-ceiling' : 'spend-unknown-cannot-cap',
    observed,
  };
}

module.exports = {
  FIX_LOOP_CEILING,
  SPEND_CEILING_USD,
  STUCK_REPEAT_LIMIT,
  HALT_STATES,
  DEFAULT_DEFER_REASON,
  getFixLoops,
  incrementFixLoops,
  closeFixLoop,
  // B10: the findings a fix loop may act on - blocking, and not preExisting.
  // Re-exported from the review standard so a caller holding the controller
  // does not have to know a second module exists to answer "fix what?".
  fixLoopFindings: (findings) => (standard ? standard.fixLoopFindings(findings) : []),
  sameClassRepeated,
  shouldContinue,
  dominantSignature,
  unattendedHalt,
};
