// Author: Subash Karki
// fields.test.js - the --fields validate/project/resolve trio. Conventions
// match test/axi-error.test.js and test/render-output.test.js: node:test +
// node:assert/strict, execFileSync for the CLI harness, no mocks.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const MODULE_PATH = require.resolve('../scripts/lib/fields');
const { parseFields, pickFields, resolveFields } = require(MODULE_PATH);
const { VALIDATION_ERROR, exitCodeForError } = require('../scripts/lib/axi-error');

const CLI = path.resolve(__dirname, '..', 'scripts', 'lib', 'fields.js');
const AVAILABLE = ['body', 'closedAt', 'labels', 'milestone'];

// ── parseFields ──────────────────────────────────────────────────────────────

test('parseFields: returns [] when fieldsArg is undefined', () => {
  assert.deepEqual(parseFields(undefined, AVAILABLE), []);
});

test('parseFields: returns [] when fieldsArg is empty', () => {
  assert.deepEqual(parseFields('', AVAILABLE), []);
});

const PARSE_CASES = [
  { name: 'single field', fieldsArg: 'body', expected: ['body'] },
  { name: 'multiple comma-separated fields', fieldsArg: 'body,closedAt', expected: ['body', 'closedAt'] },
  { name: 'whitespace trimmed around names', fieldsArg: ' body , closedAt ', expected: ['body', 'closedAt'] },
  { name: 'repeated names deduped', fieldsArg: 'body,body', expected: ['body'] },
  { name: 'trailing comma ignored', fieldsArg: 'body,', expected: ['body'] },
  { name: 'empty segment ignored', fieldsArg: 'body,,closedAt', expected: ['body', 'closedAt'] },
];

for (const { name, fieldsArg, expected } of PARSE_CASES) {
  test(`parseFields: ${name}`, () => {
    assert.deepEqual(parseFields(fieldsArg, AVAILABLE), expected);
  });
}

test('parseFields: accepts a map whose keys are the valid names', () => {
  const available = { body: {}, closedAt: {}, labels: {}, milestone: {} };
  assert.deepEqual(parseFields('body,closedAt', available), ['body', 'closedAt']);
});

test('parseFields: throws VALIDATION_ERROR naming the unknown field and every valid name', () => {
  try {
    parseFields('body,unknownField', AVAILABLE);
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, VALIDATION_ERROR);
    assert.match(err.message, /unknownField/);
    for (const name of AVAILABLE) assert.match(err.message, new RegExp(name));
    assert.equal(exitCodeForError(err), 2);
  }
});

test('parseFields: lists all unknown fields, in supplied order', () => {
  try {
    parseFields('bad2,bad1', AVAILABLE);
    assert.fail('should have thrown');
  } catch (err) {
    assert.match(err.message, /bad2, bad1/);
  }
});

test('parseFields: valid names in the error are sorted alphabetically', () => {
  try {
    parseFields('nope', AVAILABLE);
    assert.fail('should have thrown');
  } catch (err) {
    assert.match(err.message, /Available: body, closedAt, labels, milestone/);
  }
});

// ── pickFields ───────────────────────────────────────────────────────────────

test('pickFields: projects a subset, in the requested order', () => {
  const obj = { a: 1, b: 2, c: 3 };
  assert.deepEqual(Object.keys(pickFields(obj, ['c', 'a'])), ['c', 'a']);
  assert.deepEqual(pickFields(obj, ['c', 'a']), { c: 3, a: 1 });
});

test('pickFields: empty fields returns the object unchanged', () => {
  const obj = { a: 1, b: 2 };
  assert.equal(pickFields(obj, []), obj);
});

// ── resolveFields ────────────────────────────────────────────────────────────

test('resolveFields: full=true returns allFields regardless of fieldsArg/default', () => {
  const result = resolveFields({ full: true, fieldsArg: 'body', defaultFields: ['id'], allFields: AVAILABLE });
  assert.deepEqual(result, AVAILABLE);
});

test('resolveFields: fieldsArg present resolves through parseFields against allFields', () => {
  const result = resolveFields({ fieldsArg: 'body,closedAt', defaultFields: ['id'], allFields: AVAILABLE });
  assert.deepEqual(result, ['body', 'closedAt']);
});

test('resolveFields: neither full nor fieldsArg falls back to defaultFields', () => {
  const result = resolveFields({ defaultFields: ['id', 'title'], allFields: AVAILABLE });
  assert.deepEqual(result, ['id', 'title']);
});

// ── CLI ──────────────────────────────────────────────────────────────────────

test('CLI parse: unknown field exits 2, stderr names it and lists valid fields', () => {
  assert.throws(
    () => execFileSync('node', [CLI, 'parse', 'bad', '--valid', 'a,b,c'], { encoding: 'utf-8', stdio: 'pipe' }),
    (err) => {
      assert.equal(err.status, 2);
      assert.match(err.stderr, /bad/);
      assert.match(err.stderr, /a, b, c/);
      return true;
    },
  );
});

test('CLI parse: known fields exit 0, printed one per line', () => {
  const out = execFileSync('node', [CLI, 'parse', 'a,b', '--valid', 'a,b,c'], { encoding: 'utf-8' });
  assert.equal(out, 'a\nb\n');
});

test('CLI parse: missing args exits 2 via usage', () => {
  assert.throws(
    () => execFileSync('node', [CLI, 'parse'], { encoding: 'utf-8', stdio: 'pipe' }),
    (err) => {
      assert.equal(err.status, 2);
      return true;
    },
  );
});

test('CLI pick: projects the JSON arg to the requested fields', () => {
  const out = execFileSync('node', [CLI, 'pick', '{"a":1,"b":2,"c":3}', '--fields', 'c,a'], { encoding: 'utf-8' });
  assert.equal(out, '{"c":3,"a":1}\n');
});

test('CLI pick: reads JSON from stdin when json arg is "-"', () => {
  const out = execFileSync('node', [CLI, 'pick', '-', '--fields', 'a'], {
    encoding: 'utf-8',
    input: '{"a":1,"b":2}',
  });
  assert.equal(out, '{"a":1}\n');
});

test('CLI --help exits 2', () => {
  assert.throws(
    () => execFileSync('node', [CLI, '--help'], { encoding: 'utf-8', stdio: 'pipe' }),
    (err) => {
      assert.equal(err.status, 2);
      return true;
    },
  );
});
