// Author: Subash Karki
// test-companion.js — B10(f). "Which source files did this diff change without
// changing their tests?", answered from the changed-file LIST alone.
//
// WHY MECHANICAL: `agents/auditor.md` already asks for "missing focused tests for
// non-trivial logic". That is the right intent stated unfalsifiably — "non-
// trivial" is a judgement, so the instruction is un-auditable and a reviewer can
// satisfy or ignore it at will and nobody can tell which happened. This module
// answers a narrower question that is fully derivable: a changed source file,
// and no changed test file that names it. It is deliberately NOT an opinion
// about what deserves a test.
//
// The output is ALWAYS advisory (see scripts/lib/review-standard.js): a missing
// test does not make the diff worse than it was before, so it can never clear
// the blocking bar.
//
// Pure. No fs, no git, no clock — the caller supplies the paths.

'use strict';

// Extensions we call source. Conservative on purpose: a file type not listed is
// reported as `other` and never flagged, because a false "you forgot a test for
// styles.css" is exactly the noise this repo's review standard exists to cut.
const SOURCE_EXTENSIONS = Object.freeze([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts',
  'py', 'go', 'rb', 'rs', 'java', 'kt', 'kts', 'swift', 'php', 'cs',
  'c', 'h', 'cc', 'cpp', 'hpp', 'm', 'mm', 'scala', 'ex', 'exs', 'sh', 'bash',
]);

// Directory segments that make a path a test regardless of its filename.
const TEST_DIR_SEGMENTS = Object.freeze(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'testdata']);

// Filename forms that make a path a test regardless of its directory.
// Covers the JS/TS `.test.`/`.spec.` convention, Go's `_test.go`, Python's
// `test_x.py` / `x_test.py`, and JVM's `XTest.java` / `XSpec.kt`.
const TEST_FILE_PATTERNS = Object.freeze([
  /\.(test|spec)\.[a-z]+$/i,
  /_test\.[a-z]+$/i,
  /^test_[^/]+\.[a-z]+$/i,
  /(Test|Tests|Spec|Specs)\.[a-z]+$/,
]);

function normalize(file) {
  return String(file == null ? '' : file).trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function basename(file) {
  const i = file.lastIndexOf('/');
  return i === -1 ? file : file.slice(i + 1);
}

function extension(file) {
  const name = basename(file);
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** `test` | `source` | `other`. Test wins over source: a `.test.ts` is a test. */
function classifyPath(file) {
  const p = normalize(file);
  if (p === '') return 'other';
  const segments = p.split('/').slice(0, -1);
  const name = basename(p);
  if (segments.some((s) => TEST_DIR_SEGMENTS.includes(s.toLowerCase()))) return 'test';
  if (TEST_FILE_PATTERNS.some((re) => re.test(name))) return 'test';
  if (SOURCE_EXTENSIONS.includes(extension(p))) return 'source';
  return 'other';
}

/**
 * The identifying stem of a path: the basename with its extension and any test
 * affix removed, lowercased. `src/session/Resume.ts` and
 * `test/resume.test.js` both stem to `resume`, which is what makes the two
 * recognisable as a pair from the file list alone.
 */
function stem(file) {
  let name = basename(normalize(file));
  const dot = name.indexOf('.');
  if (dot > 0) name = name.slice(0, dot);
  name = name.replace(/_test$/i, '').replace(/^test_/i, '').replace(/(Test|Tests|Spec|Specs)$/, '');
  return name.toLowerCase();
}

/**
 * Source files changed with no changed test that names them.
 *
 * @param {string[]} changedFiles  paths from the diff (any separator, any `./`)
 * @returns {Array<{file: string, stem: string, reason: string}>} one row per gap,
 *   in the order the files were given, deduplicated.
 */
function untestedSourceChanges(changedFiles) {
  const files = (Array.isArray(changedFiles) ? changedFiles : []).map(normalize).filter(Boolean);
  const testStems = new Set(files.filter((f) => classifyPath(f) === 'test').map(stem));

  const gaps = [];
  const seen = new Set();
  for (const file of files) {
    if (classifyPath(file) !== 'source') continue;
    if (seen.has(file)) continue;
    seen.add(file);
    const s = stem(file);
    if (testStems.has(s)) continue;
    gaps.push({
      file,
      stem: s,
      reason: `no changed test file matches the stem "${s}"`,
    });
  }
  return gaps;
}

/**
 * The whole answer, for a caller that wants the counts too. `checked` is the
 * number of changed source files considered, so "0 gaps" can be told apart from
 * "no source files in this diff" — an empty report for two different reasons is
 * the absorption failure this repo keeps guarding against.
 */
function report(changedFiles) {
  const files = (Array.isArray(changedFiles) ? changedFiles : []).map(normalize).filter(Boolean);
  const counts = { source: 0, test: 0, other: 0 };
  for (const f of files) counts[classifyPath(f)] += 1;
  const gaps = untestedSourceChanges(files);
  return { checked: counts.source, counts, gaps };
}

module.exports = {
  SOURCE_EXTENSIONS,
  TEST_DIR_SEGMENTS,
  TEST_FILE_PATTERNS,
  classifyPath,
  stem,
  untestedSourceChanges,
  report,
};
