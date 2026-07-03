// Author: Subash Karki
// axi-error.test.js - the typed error + exit-code taxonomy that the Phantom CLIs
// route through. The failure class this guards: silent absorption - an
// unexpected internal error exiting 0 instead of non-zero. So the load-bearing
// assertions are (a) VALIDATION_ERROR -> 2, (b) EVERYTHING else, including a bare
// Error or a non-error value, -> 1 (never 0), and (c) reportError sets
// process.exitCode without calling process.exit.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  PhantomError,
  exitCodeForError,
  reportError,
  isPhantomError,
  VALIDATION_ERROR,
} = require('../scripts/lib/axi-error');

const CLI = path.resolve(__dirname, '..', 'scripts', 'lib', 'axi-error.js');

function fakeStream() {
  return { data: '', write(s) { this.data += s; } };
}

// reportError mutates process.exitCode by design. Restore it so a test that
// exercises the failure path can't leave the whole runner exiting non-zero.
function withExitCode(fn) {
  const saved = process.exitCode;
  try {
    fn();
  } finally {
    process.exitCode = saved === undefined ? 0 : saved;
  }
}

test('PhantomError carries message, code, and suggestions', () => {
  const e = new PhantomError('boom', 'IO_ERROR', ['do x', 'do y']);
  assert.equal(e.name, 'PhantomError');
  assert.equal(e.message, 'boom');
  assert.equal(e.code, 'IO_ERROR');
  assert.deepEqual(e.suggestions, ['do x', 'do y']);
  assert.ok(e instanceof Error);
});

test('PhantomError defaults suggestions to []', () => {
  assert.deepEqual(new PhantomError('x', 'C').suggestions, []);
  // Non-array suggestions are coerced away, never left as a foot-gun.
  assert.deepEqual(new PhantomError('x', 'C', 'nope').suggestions, []);
});

test('exitCodeForError: VALIDATION_ERROR -> 2', () => {
  assert.equal(exitCodeForError(new PhantomError('x', VALIDATION_ERROR)), 2);
  assert.equal(exitCodeForError({ code: 'VALIDATION_ERROR' }), 2);
});

test('exitCodeForError: anything else -> 1, never 0 (absorption direction)', () => {
  assert.equal(exitCodeForError(new PhantomError('x', 'IO_ERROR')), 1);
  assert.equal(exitCodeForError(new Error('plain')), 1);
  assert.equal(exitCodeForError('a string'), 1);
  assert.equal(exitCodeForError(null), 1);
  assert.equal(exitCodeForError(undefined), 1);
  assert.equal(exitCodeForError({}), 1);
});

test('isPhantomError duck-types across a name match, not just instanceof', () => {
  assert.ok(isPhantomError(new PhantomError('x', 'C')));
  assert.ok(isPhantomError({ name: 'PhantomError', message: 'x' }));
  assert.ok(!isPhantomError(new Error('x')));
  assert.ok(!isPhantomError(null));
});

test('reportError: PhantomError prints message + suggestions, sets exitCode', () => {
  withExitCode(() => {
    const s = fakeStream();
    reportError(new PhantomError('bad input', VALIDATION_ERROR, ['fix it']), s);
    assert.equal(s.data, 'bad input\n  → fix it\n');
    assert.equal(process.exitCode, 2);
  });
});

test('reportError: unexpected error prints its stack and exits 1', () => {
  withExitCode(() => {
    const s = fakeStream();
    reportError(new Error('kaboom'), s);
    assert.match(s.data, /Error: kaboom/);
    assert.ok(s.data.includes('\n'));
    assert.equal(process.exitCode, 1);
  });
});

test('reportError: a non-error value still exits 1, never 0', () => {
  withExitCode(() => {
    const s = fakeStream();
    reportError('just a string', s);
    assert.equal(s.data, 'just a string\n');
    assert.equal(process.exitCode, 1);
  });
});

test('CLI --help prints the taxonomy and exits 0', () => {
  const out = execFileSync('node', [CLI, '--help'], { encoding: 'utf-8' });
  assert.match(out, /VALIDATION_ERROR -> 2/);
  assert.match(out, /<anything else>  -> 1/);
});

test('CLI demo reports the mapped code for a given error code', () => {
  assert.match(execFileSync('node', [CLI, 'VALIDATION_ERROR'], { encoding: 'utf-8' }), /= 2/);
  assert.match(execFileSync('node', [CLI, 'WHATEVER'], { encoding: 'utf-8' }), /= 1/);
});
