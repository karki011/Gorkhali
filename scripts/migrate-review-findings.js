#!/usr/bin/env node
// Author: Subash Karki
// migrate-review-findings.js - rewrite a reviewer artifact into the canonical
// B10 shape: one severity scale, one finding shape, one gaps key.
//
// WHY THIS IS OPTIONAL, and says so out loud: the validator ACCEPTS every legacy
// spelling and normalizes on read, so no artifact on disk fails and nothing is
// forced through this script. It exists for the reader who wants the file itself
// cleaned up - a corpus of mixed vocabularies is readable by machine and
// miserable to eyeball.
//
// SAFETY: normalization cannot change a finding id. The id hashes
// `file || component` plus the first present claim key, and every rewrite here
// preserves both values (`component` -> `file` carries the same string;
// `issue`/`message` -> `evidence` carries the same text). The script asserts
// that per finding and REFUSES to write a file where any id would move, because
// a re-id silently breaks the link to a disposition already recorded against it.
//
// Usage:
//   migrate-review-findings.js <file>...            rewrite in place
//   migrate-review-findings.js --check <file>...    report only; exit 2 if any file would change
//   migrate-review-findings.js --help
//
// Exit codes: 0 = clean/written; 2 = --check found pending changes, or an id
// would move; 1 = I/O / usage.

'use strict';

const fs = require('fs');
const { normalizeReview, normalizeFinding } = require('./lib/review-standard');
const { findingId } = require('./lib/review-finding');
const { PhantomError, reportError } = require('./lib/axi-error');

/** What would change in one artifact, without touching disk. */
function planFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new PhantomError(`ERROR: cannot read ${file}: ${err.message}`, 'IO_ERROR');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PhantomError(`ERROR: ${file} is not valid JSON: ${err.message}`, 'VALIDATION_ERROR');
  }

  const next = normalizeReview(parsed);
  const idShifts = [];
  if (Array.isArray(parsed.findings)) {
    parsed.findings.forEach((finding, i) => {
      if (finding == null || typeof finding !== 'object' || Array.isArray(finding)) return;
      const before = findingId(finding);
      const after = findingId(normalizeFinding(finding));
      if (before !== after) idShifts.push({ index: i, before, after });
    });
  }

  const serialized = JSON.stringify(next, null, 2) + '\n';
  return { file, changed: serialized !== raw, idShifts, serialized };
}

function describe(plan) {
  if (plan.idShifts.length) {
    return `${plan.file}: REFUSED - normalization would move ${plan.idShifts.length} finding id(s): ` +
      plan.idShifts.map((s) => `findings[${s.index}] ${s.before}->${s.after}`).join(', ');
  }
  return `${plan.file}: ${plan.changed ? 'would rewrite into the canonical shape' : 'already canonical'}`;
}

const HELP =
  'migrate-review-findings.js - rewrite reviewer artifacts into the canonical B10 shape\n\n' +
  'Usage:\n' +
  '  migrate-review-findings.js <file>...          rewrite in place\n' +
  '  migrate-review-findings.js --check <file>...  report only; exit 2 if any file would change\n' +
  '  migrate-review-findings.js --help\n\n' +
  'Optional: the validator accepts every legacy spelling and normalizes on read.\n';

function parseArgs(argv) {
  const args = { check: false, help: false, files: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--help') args.help = true;
    else if (a.startsWith('--')) throw new PhantomError(`ERROR: unknown option: ${a}`, 'USAGE');
    else args.files.push(a);
  }
  return args;
}

function main(argv, { stdout = process.stdout } = {}) {
  const args = parseArgs(argv);
  if (args.help || args.files.length === 0) {
    stdout.write(HELP);
    return 0;
  }

  const plans = args.files.map(planFile);
  for (const plan of plans) stdout.write(describe(plan) + '\n');

  const refused = plans.filter((p) => p.idShifts.length);
  if (refused.length) {
    throw new PhantomError(
      `Refusing to migrate: ${refused.length} file(s) would move a finding id, breaking the link to any recorded disposition.`,
      'VALIDATION_ERROR',
      ['Report this: normalization is supposed to be id-preserving, so a shift means a bug in scripts/lib/review-standard.js']
    );
  }

  const pending = plans.filter((p) => p.changed);
  if (args.check) {
    if (pending.length) {
      throw new PhantomError(
        `${pending.length} file(s) are not in the canonical shape.`,
        'VALIDATION_ERROR',
        ['Run: node scripts/migrate-review-findings.js ' + pending.map((p) => p.file).join(' ')]
      );
    }
    stdout.write(`OK: ${plans.length} artifact(s) already canonical.\n`);
    return 0;
  }

  for (const plan of pending) fs.writeFileSync(plan.file, plan.serialized);
  stdout.write(`Migrated ${pending.length} of ${plans.length} artifact(s).\n`);
  return 0;
}

module.exports = { planFile, describe, main };

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (err) {
    reportError(err);
  }
}
