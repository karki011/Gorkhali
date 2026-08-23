// Author: Subash Karki
// marker-freshness.test.js — pins MARKER_FRESHNESS_MS as the single source for
// the 12h freshness window. Asserts the default, env override, and — critically
// — that the consumer file does not contain a re-hardcoded literal.
// Zero external deps: node:test + node:assert + node:child_process + node:fs.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');

const CONSTANTS_PATH = require.resolve('../scripts/lib/constants');

// Bust the cache + clear the override env, then load fresh.
function freshConstants(overrides = {}) {
  const ENV_KEY = 'GORKHALI_MARKER_FRESHNESS_MS';
  const saved = Object.prototype.hasOwnProperty.call(process.env, ENV_KEY)
    ? process.env[ENV_KEY]
    : undefined;
  delete process.env[ENV_KEY];
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
  delete require.cache[CONSTANTS_PATH];
  try {
    return require(CONSTANTS_PATH);
  } finally {
    delete require.cache[CONSTANTS_PATH];
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
    for (const k of Object.keys(overrides)) {
      if (!(k in (saved ? { [ENV_KEY]: saved } : {}))) delete process.env[k];
    }
  }
}

test('MARKER_FRESHNESS_MS default is 43200000 (12h in ms)', () => {
  const C = freshConstants();
  assert.equal(C.MARKER_FRESHNESS_MS, 43200000);
});

test('MARKER_FRESHNESS_MS env override applies', () => {
  // Use a child process to avoid contaminating the parent's require cache state.
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `process.env.GORKHALI_MARKER_FRESHNESS_MS='7200000';` +
        `const C=require(${JSON.stringify(CONSTANTS_PATH)});` +
        `process.stdout.write(String(C.MARKER_FRESHNESS_MS));`,
    ],
    { encoding: 'utf-8' }
  );
  assert.equal(result.status, 0, 'child exited non-zero: ' + result.stderr);
  assert.equal(result.stdout.trim(), '7200000');
});

test('garbage env value for MARKER_FRESHNESS_MS fails open to default', () => {
  const C = freshConstants({ GORKHALI_MARKER_FRESHNESS_MS: 'banana' });
  assert.equal(C.MARKER_FRESHNESS_MS, 43200000);
});

// ---------------------------------------------------------------------------
// Lockstep pin: the consumer file may not re-hardcode the literal.
// If it does, a future drift would silently break the single-source guarantee.
// ---------------------------------------------------------------------------
const CONSUMERS = [
  require.resolve('../scripts/preflight.js'),
];

// Matches the old hardcoded form: bare 43200000, or 12 * 60 * 60 * 1000 (with
// any whitespace around the operators), used as an assignment / comparison value.
// Does NOT flag the default-argument literal inside constants.js itself.
const HARDCODED_RE = /\b43200000\b|12\s*\*\s*60\s*\*\s*60\s*\*\s*1000/;

for (const filePath of CONSUMERS) {
  const label = filePath.split('/').slice(-2).join('/');
  test(`${label} does not hardcode the 12h literal (references MARKER_FRESHNESS_MS)`, () => {
    const src = fs.readFileSync(filePath, 'utf-8');
    const lines = src.split('\n').filter((l) => {
      const trimmed = l.trimStart();
      // Pure comment lines are never violations.
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
      // Lines that declare a named fallback default (e.g. `let X = 12*60*60*1000; // fallback`)
      // are intentional fail-open defaults, not drift — exclude them.
      if (/fallback/.test(l)) return false;
      return true;
    });
    const hit = lines.find((l) => HARDCODED_RE.test(l));
    assert.equal(
      hit,
      undefined,
      `Found hardcoded freshness literal in ${label}:\n  ${hit}`
    );
  });
}
