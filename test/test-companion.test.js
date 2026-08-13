// Author: Subash Karki
// test-companion.test.js — B10(f). "Which source files changed without their
// tests changing?" must be DERIVABLE from the changed-file list, not a
// judgement. `agents/gaze.md` previously asked for "missing focused tests for
// non-trivial logic", which nobody can audit: "non-trivial" is unfalsifiable, so
// a reviewer can honour or ignore it and the artifact looks identical either way.
//
// What is pinned here: the same file list always produces the same answer, the
// answer names the file and WHY, and the classification never flags things that
// are not source.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'scripts', 'review-gaps.js');
const tc = require('../scripts/lib/test-companion');

const files = (result) => result.gaps.map((g) => g.file);

test('a source file changed with no test change is named, with the reason', () => {
  const result = tc.report(['src/session/resume.ts', 'README.md']);
  assert.deepEqual(files(result), ['src/session/resume.ts']);
  assert.equal(result.gaps[0].reason, 'no changed test file matches the stem "resume"');
  assert.equal(result.checked, 1, 'one source file was considered');
});

test('adding the matching test to the SAME diff clears the flag', () => {
  assert.deepEqual(files(tc.report(['src/session/resume.ts', 'test/resume.test.js'])), []);
  assert.deepEqual(files(tc.report(['src/session/Resume.ts', '__tests__/resume.spec.tsx'])), []);
  assert.deepEqual(files(tc.report(['pkg/ledger.go', 'pkg/ledger_test.go'])), []);
  assert.deepEqual(files(tc.report(['app/billing.py', 'tests/test_billing.py'])), []);
});

test('a test for a DIFFERENT file does not clear the flag', () => {
  const result = tc.report(['src/session/resume.ts', 'test/pause.test.js']);
  assert.deepEqual(files(result), ['src/session/resume.ts'], 'pause.test.js is not resume.ts\'s test');
});

test('non-source changes are never flagged', () => {
  for (const file of ['README.md', 'package.json', 'src/theme.css', 'docs/adr/0007.md', '.github/workflows/ci.yml']) {
    assert.deepEqual(files(tc.report([file])), [], `${file} must not be flagged`);
  }
  const docsOnly = tc.report(['README.md', 'ROADMAP.md']);
  assert.equal(docsOnly.checked, 0, 'no source files considered');
  assert.deepEqual(docsOnly.gaps, []);
});

test('a test-only diff flags nothing', () => {
  assert.deepEqual(files(tc.report(['test/resume.test.js', 'test/pause.test.js'])), []);
});

test('classification: a test wins over source, and path spelling is irrelevant', () => {
  assert.equal(tc.classifyPath('test/resume.test.js'), 'test');
  assert.equal(tc.classifyPath('src/resume.ts'), 'source');
  assert.equal(tc.classifyPath('.\\src\\resume.ts'), 'source', 'windows separators normalize');
  assert.equal(tc.classifyPath('./src/resume.ts'), 'source', 'a leading ./ is the same path');
  assert.equal(tc.classifyPath('src/styles.css'), 'other');
  assert.equal(tc.stem('src/session/Resume.ts'), tc.stem('test/resume.test.js'));
});

test('the answer is a pure function of the list: order and duplicates change nothing', () => {
  const a = files(tc.report(['src/a.ts', 'src/b.ts', 'test/a.test.js']));
  const b = files(tc.report(['test/a.test.js', 'src/b.ts', 'src/a.ts', 'src/b.ts']));
  assert.deepEqual(a, ['src/b.ts']);
  assert.deepEqual(b, ['src/b.ts'], 'same set in, same answer out');
});

// --- the CLI a reviewer actually runs ---------------------------------------

function cli(args, input) {
  return execFileSync('node', [CLI, ...args], { encoding: 'utf-8', input, cwd: REPO_ROOT });
}

test('the CLI prints the flagged file and tells the reviewer it is advisory', () => {
  const out = cli(['--files', 'src/session/resume.ts', 'README.md']);
  assert.match(out, /NO TEST CHANGE \(1 of 1 changed source file\(s\)\)/);
  assert.match(out, /src\/session\/resume\.ts {2}- {2}no changed test file matches the stem "resume"/);
  assert.match(out, /advisory finding/);
});

test('the CLI distinguishes "no gaps" from "no source files" instead of printing an empty report twice', () => {
  assert.match(cli(['--files', 'src/a.ts', 'test/a.test.js']), /OK: all 1 changed source file\(s\) have a matching changed test file/);
  assert.match(cli(['--files', 'README.md']), /No changed source files in this diff/);
});

test('the CLI reads a changed-file list on stdin and emits JSON on request', () => {
  const out = cli(['--json'], 'src/a.ts\nsrc/b.ts\ntest/a.test.js\n');
  const parsed = JSON.parse(out);
  assert.equal(parsed.checked, 2);
  assert.deepEqual(parsed.gaps.map((g) => g.file), ['src/b.ts']);
  assert.deepEqual(parsed.counts, { source: 2, test: 1, other: 0 });
});

test('the CLI reports and does not gate - exit 0 with gaps unless --exit-code is asked for', () => {
  // Default: gaps present, still exit 0. A missing test cannot clear the
  // blocking bar, so this must never fail a pipeline by accident.
  execFileSync('node', [CLI, '--files', 'src/ungated.ts'], { encoding: 'utf-8', cwd: REPO_ROOT });

  let status = 0;
  try {
    execFileSync('node', [CLI, '--exit-code', '--files', 'src/ungated.ts'], { encoding: 'utf-8', cwd: REPO_ROOT });
  } catch (e) {
    status = e.status;
  }
  assert.equal(status, 1, '--exit-code is opt-in for a caller that wants the signal');
});
