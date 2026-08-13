#!/usr/bin/env node
// Author: Subash Karki
// review-round.js - re-review convergence (B12). Owns the carry-over ledger
// `{SESSION_DIR}/reviews/rounds.json` and applies the round rule to a review.
//
// THE PROBLEM THIS SOLVES, and the constraint it had to solve it under:
// `commands/review.md` step 4 DELETES `{SESSION_DIR}/reviews/gaze.json` before
// every pass, so a failed or truncated run can never reuse an older verdict.
// That deletion is deliberate and stays. But round 2 has to know which findings
// round 1 raised, or a carried-over advisory and a freshly invented one are
// indistinguishable and nothing can be suppressed honestly. So the prior round's
// ids cannot live in the file being deleted.
//
// They live here instead, in a SIBLING file the delete does not name, and the
// ledger is built so the freshness property cannot be violated even by accident:
//
//   - it carries finding IDS, severities and files, and NOTHING that reads as a
//     verdict. There is no `verdict` key, no `findings` array a consumer would
//     mistake for a review, and no pass/fail anywhere in it. A truncated run
//     therefore has no stale verdict here TO reuse;
//   - it is APPEND-ONLY and is only appended after an artifact was read AND
//     validated against the `review` schema, so a truncated, malformed or
//     `blocked` run records nothing and the next pass is still the same round.
//     Shape alone is not enough: a file that merely has a `findings` array could
//     otherwise consume a round, and the next real pass would then suppress its
//     advisories on the strength of a round that never validly happened;
//   - `scripts/baseline-report.js` skips it for the same reason a reader would:
//     its reviewer-artifact shape check requires a top-level `findings` array,
//     which this file deliberately does not have.
//
// The round rule itself is DATA in scripts/lib/review-standard.js
// (`convergenceFilter`); this file is its I/O shell, the same way
// scripts/run-guard.js is the shell around the pure halt decision.
//
// Usage:
//   review-round.js status --reviews <dir> [--json]
//       What round the NEXT pass is, and the finding ids earlier rounds raised.
//       Run BEFORE spawning the reviewer; pass the round number into it.
//
//   review-round.js close --reviews <dir> [--review <file>] [--fingerprint <fp>]
//                         [--json] [--dry-run]
//       Read the review artifact this pass produced, apply the round rule, print
//       what may be reported and what is suppressed as a count, then append this
//       round to the ledger. --dry-run prints without appending.
//
// Exit codes: 0 = report produced; 1 = I/O / usage.

'use strict';

const fs = require('fs');
const path = require('path');
const {
  REVIEW_ROUNDS_FILE,
  REVIEW_ROUNDS_SCHEMA,
  priorFindingIds,
  nextRound,
  convergenceFilter,
  normalizeSeverity,
  isBlocking,
} = require('./lib/review-standard');
const { assignFindingIds } = require('./lib/review-finding');
const { validate } = require('./validate-artifact');
const { PhantomError, reportError } = require('./lib/axi-error');

const DEFAULT_REVIEW_FILE = 'gaze.json';

function ledgerPath(reviewsDir) {
  return path.join(reviewsDir, REVIEW_ROUNDS_FILE);
}

/**
 * The ledger, or an empty one. A missing file is round 1, which is the normal
 * first-pass case and not an error. A CORRUPT file is also read as empty rather
 * than fatal: convergence suppresses output, and a suppression rule that can
 * break a review is worse than one that occasionally repeats an advisory.
 */
function readLedger(reviewsDir) {
  const file = ledgerPath(reviewsDir);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return { schema: REVIEW_ROUNDS_SCHEMA, rounds: [], source: 'absent' };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.rounds)) {
      return { schema: REVIEW_ROUNDS_SCHEMA, rounds: [], source: 'unreadable' };
    }
    return { schema: REVIEW_ROUNDS_SCHEMA, rounds: parsed.rounds, source: 'read' };
  } catch (_) {
    return { schema: REVIEW_ROUNDS_SCHEMA, rounds: [], source: 'unreadable' };
  }
}

function readReview(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new PhantomError(`ERROR: cannot read review artifact ${file}: ${err.message}`, 'IO_ERROR', [
      'A missing reviewer artifact is `blocked`, never a clean review - nothing is recorded for this round',
    ]);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PhantomError(`ERROR: ${file} is not valid JSON: ${err.message}`, 'VALIDATION_ERROR');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.findings)) {
    throw new PhantomError(`ERROR: ${file} has no findings array - it is not a review artifact`, 'VALIDATION_ERROR');
  }
  // Shape alone is not enough to consume a round. A file that merely HAS a
  // findings array can still violate the review schema, and accepting it would
  // append a round for a review that never validly completed - after which the
  // next real pass counts as a later round and suppresses its advisories on the
  // strength of a round that did not happen. Validate against the same schema
  // the artifact is held to everywhere else.
  const errors = validate('review', parsed);
  if (errors.length) {
    throw new PhantomError(
      `ERROR: ${file} is not a valid review artifact:\n  ${errors.join('\n  ')}`,
      'VALIDATION_ERROR',
      ['An invalid reviewer artifact is `blocked`, never a clean review - nothing is recorded for this round']
    );
  }
  // A `blocked` verdict means the review did not complete, so it raised no
  // findings to carry over and must not consume a round either. `pass` and
  // `fail` are both completed reviews and do.
  if (parsed.verdict === 'blocked') {
    throw new PhantomError(
      `ERROR: ${file} has verdict "blocked" - a blocked review did not complete and does not consume a round`,
      'VALIDATION_ERROR',
      ['Resolve the blocker and re-run the review; the next pass is still this round']
    );
  }
  return parsed;
}

/**
 * One ledger row per finding: the id that identifies it across rounds plus the
 * two columns the round rule needs. NO claim text, no verdict, no remediation -
 * this is an identity record, not a copy of the review.
 */
function ledgerRow(finding) {
  return {
    id: finding.id,
    severity: normalizeSeverity(finding.severity !== undefined ? finding.severity : finding.temperature) || null,
    file: (typeof finding.file === 'string' && finding.file.trim()) || (typeof finding.component === 'string' && finding.component.trim()) || null,
    blocking: isBlocking(finding),
  };
}

function runStatus(reviewsDir) {
  const ledger = readLedger(reviewsDir);
  const round = nextRound(ledger);
  const ids = priorFindingIds(ledger);
  return {
    action: 'status',
    reviewsDir,
    ledger: ledgerPath(reviewsDir),
    ledgerSource: ledger.source,
    round,
    roundsRecorded: ledger.rounds.length,
    priorFindingIds: ids,
    instruction:
      round <= 1
        ? 'Round 1: report everything. Nothing is suppressed.'
        : `Round ${round}: itemize blocking findings only. Non-blocking findings are reported as a count (B12).`,
  };
}

function runClose(reviewsDir, reviewFile, { fingerprint = null, dryRun = false } = {}) {
  const ledger = readLedger(reviewsDir);
  const review = readReview(reviewFile);
  const round = nextRound(ledger);
  const priorIds = priorFindingIds(ledger);

  // Ids are stamped mechanically before anything is compared - a reviewer never
  // writes them, and an unstamped finding would look "new" every round.
  assignFindingIds(review.findings);
  const result = convergenceFilter(review.findings, { round, priorIds });

  const entry = {
    round,
    at: new Date().toISOString(),
    findings: review.findings
      .filter((f) => f && typeof f === 'object' && !Array.isArray(f))
      .map(ledgerRow),
  };
  if (fingerprint) entry.fingerprint = fingerprint;

  if (!dryRun) {
    const next = { schema: REVIEW_ROUNDS_SCHEMA, rounds: ledger.rounds.concat([entry]) };
    try {
      fs.mkdirSync(reviewsDir, { recursive: true });
      fs.writeFileSync(ledgerPath(reviewsDir), JSON.stringify(next, null, 2) + '\n');
    } catch (err) {
      throw new PhantomError(`ERROR: cannot write ${ledgerPath(reviewsDir)}: ${err.message}`, 'IO_ERROR');
    }
  }

  return {
    action: 'close',
    reviewsDir,
    reviewFile,
    ledger: ledgerPath(reviewsDir),
    recorded: !dryRun,
    round,
    findingsTotal: review.findings.length,
    reported: result.reported.map((f) => ({
      id: f.id,
      severity: normalizeSeverity(f.severity !== undefined ? f.severity : f.temperature) || null,
      file: f.file || f.component || null,
      line: Number.isFinite(f.line) ? f.line : null,
    })),
    suppressed: { total: result.suppressed.total, carriedOver: result.suppressed.carriedOver, new: result.suppressed.new },
    // Paste this into the recorded review payload (reference/schemas/review.md).
    convergence: { round, suppressed: { total: result.suppressed.total, carriedOver: result.suppressed.carriedOver, new: result.suppressed.new } },
  };
}

function renderStatus(r) {
  const lines = [`round ${r.round} (${r.roundsRecorded} round(s) recorded in ${r.ledger})`, r.instruction];
  if (r.priorFindingIds.length) {
    lines.push(`prior finding ids (${r.priorFindingIds.length}): ${r.priorFindingIds.join(' ')}`);
  } else {
    lines.push('prior finding ids: none');
  }
  return lines.join('\n');
}

function renderClose(r) {
  const lines = [];
  lines.push(`round ${r.round}: ${r.findingsTotal} finding(s) in ${path.basename(r.reviewFile)}`);
  if (r.round <= 1) {
    lines.push(`reported ${r.reported.length} (round 1 reports everything)`);
  } else {
    lines.push(`reported ${r.reported.length} blocking finding(s); non-blocking findings are suppressed (B12)`);
    lines.push(
      `suppressed ${r.suppressed.total}: ${r.suppressed.carriedOver} carried over from an earlier round, ` +
        `${r.suppressed.new} first seen this round`
    );
  }
  for (const f of r.reported) {
    lines.push(`  ${f.severity || '-'}  ${f.file || '-'}${f.line ? ':' + f.line : ''}  ${f.id}`);
  }
  lines.push(r.recorded ? `recorded round ${r.round} in ${r.ledger}` : 'dry run - the ledger was not written');
  return lines.join('\n');
}

const HELP =
  'review-round.js - re-review convergence (B12): the carry-over ledger and the round rule\n\n' +
  'Usage:\n' +
  '  review-round.js status --reviews <dir> [--json]\n' +
  '  review-round.js close  --reviews <dir> [--review <file>] [--fingerprint <fp>] [--json] [--dry-run]\n\n' +
  `The ledger is <dir>/${REVIEW_ROUNDS_FILE}. It survives the deliberate pre-pass delete of\n` +
  `${DEFAULT_REVIEW_FILE} because it is a different file, and it carries no verdict, so the\n` +
  'freshness property that delete exists to protect is preserved.\n';

function parseArgs(argv) {
  const args = { action: null, reviews: null, review: null, fingerprint: null, json: false, dryRun: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--json') args.json = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--reviews') args.reviews = argv[++i];
    else if (a === '--review') args.review = argv[++i];
    else if (a === '--fingerprint') args.fingerprint = argv[++i];
    else if (!a.startsWith('-') && args.action === null) args.action = a;
    else throw new PhantomError(`ERROR: unknown option: ${a}`, 'USAGE', ['Run review-round.js --help']);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help || !args.action) {
    process.stdout.write(HELP);
    return;
  }
  if (!args.reviews) {
    throw new PhantomError('ERROR: --reviews <dir> is required', 'USAGE', [
      'Point it at {SESSION_DIR}/reviews - the directory holding gaze.json and the round ledger',
    ]);
  }
  let result;
  if (args.action === 'status') {
    result = runStatus(args.reviews);
    if (!args.json) process.stdout.write(renderStatus(result) + '\n');
  } else if (args.action === 'close') {
    const reviewFile = args.review || path.join(args.reviews, DEFAULT_REVIEW_FILE);
    result = runClose(args.reviews, reviewFile, { fingerprint: args.fingerprint, dryRun: args.dryRun });
    if (!args.json) process.stdout.write(renderClose(result) + '\n');
  } else {
    throw new PhantomError(`ERROR: unknown action: ${args.action}`, 'USAGE', ['Actions: status, close']);
  }
  if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { readLedger, ledgerPath, ledgerRow, runStatus, runClose, renderStatus, renderClose, main };

if (require.main === module) {
  try {
    main(process.argv);
  } catch (err) {
    reportError(err);
  }
}
