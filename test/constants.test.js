// Author: Subash Karki
// constants.test.js — pins the single-source runtime constants: defaults match the
// pre-centralization literals, env overrides apply, garbage env values fail open.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const CONSTANTS_PATH = require.resolve('../scripts/lib/constants');

const OVERRIDE_ENVS = [
  'PHANTOM_FIX_LOOP_CEILING',
  'PHANTOM_GRADUATION_THRESHOLD',
  'PHANTOM_PROMOTE_THRESHOLD',
  'PHANTOM_EXTRACT_TIMEOUT_MS',
  'PHANTOM_LEARNING_STALE_DAYS',
  'PHANTOM_LEARNING_REMOVE_DAYS',
  'PHANTOM_LEARNING_DISTILL_CAP',
  'PHANTOM_MARKER_FRESHNESS_MS',
];

// Env is read at require time — bust the cache around each load, clearing all
// override envs first so ambient shell state can't leak into assertions.
function freshConstants(overrides = {}) {
  const saved = {};
  for (const key of [...OVERRIDE_ENVS, ...Object.keys(overrides)]) {
    saved[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    delete process.env[key];
  }
  for (const [key, val] of Object.entries(overrides)) process.env[key] = val;
  delete require.cache[CONSTANTS_PATH];
  try {
    return require(CONSTANTS_PATH);
  } finally {
    delete require.cache[CONSTANTS_PATH];
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }
}

test('defaults match the pre-centralization literals exactly', () => {
  const C = freshConstants();
  assert.equal(C.FIX_LOOP_CEILING, 2);
  assert.equal(C.GRADUATION_THRESHOLD, 5);
  assert.equal(C.PROMOTE_THRESHOLD, 5);
  assert.equal(C.EXTRACT_TIMEOUT_MS, 5000);
  assert.equal(C.PHANTOM_DATA_DIRNAME, 'phantom-data');
  assert.equal(C.LEARNING_STALE_DAYS, 30);
  assert.equal(C.LEARNING_REMOVE_DAYS, 60);
  assert.equal(C.LEARNING_DISTILL_CAP, 50);
  assert.equal(C.DEFAULT_HOOK_TIMEOUT_SECONDS, 10);
  assert.equal(C.MARKER_FRESHNESS_MS, 12 * 60 * 60 * 1000);
});

test('PHANTOM_DATA_DIRNAME is legacy-only; the canonical data-root dirname is codec-owned', () => {
  const C = freshConstants();
  // Retained ONLY as a migration source; T2 removes provider-owned operational
  // defaults. The canonical root dirname now lives in the shared codec.
  assert.equal(C.PHANTOM_DATA_DIRNAME, 'phantom-data');
  const codec = require('../skills/phantom/scripts/lib/shared-state.cjs');
  assert.equal(codec.ROOT_DIRNAME, '.phantom');
  assert.notEqual(C.PHANTOM_DATA_DIRNAME, codec.ROOT_DIRNAME);
});

test('env overrides apply to every numeric constant', () => {
  const C = freshConstants({
    PHANTOM_FIX_LOOP_CEILING: '4',
    PHANTOM_GRADUATION_THRESHOLD: '7',
    PHANTOM_PROMOTE_THRESHOLD: '8',
    PHANTOM_EXTRACT_TIMEOUT_MS: '9000',
    PHANTOM_LEARNING_STALE_DAYS: '14',
    PHANTOM_LEARNING_REMOVE_DAYS: '90',
    PHANTOM_LEARNING_DISTILL_CAP: '25',
  });
  assert.equal(C.FIX_LOOP_CEILING, 4);
  assert.equal(C.GRADUATION_THRESHOLD, 7);
  assert.equal(C.PROMOTE_THRESHOLD, 8);
  assert.equal(C.EXTRACT_TIMEOUT_MS, 9000);
  assert.equal(C.LEARNING_STALE_DAYS, 14);
  assert.equal(C.LEARNING_REMOVE_DAYS, 90);
  assert.equal(C.LEARNING_DISTILL_CAP, 25);
});

test('garbage env values fail open to the defaults', () => {
  const C = freshConstants({
    PHANTOM_FIX_LOOP_CEILING: 'banana',
    PHANTOM_EXTRACT_TIMEOUT_MS: '',
    PHANTOM_GRADUATION_THRESHOLD: 'NaN',
  });
  assert.equal(C.FIX_LOOP_CEILING, 2);
  assert.equal(C.EXTRACT_TIMEOUT_MS, 5000);
  assert.equal(C.GRADUATION_THRESHOLD, 5);
});

test('loop ceilings reject floats while non-ceiling floats remain valid', () => {
  const C = freshConstants({
    PHANTOM_FIX_LOOP_CEILING: '2.5',
    PHANTOM_EXTRACT_TIMEOUT_MS: '2500.5',
  });
  assert.equal(C.FIX_LOOP_CEILING, 2);
  assert.equal(C.EXTRACT_TIMEOUT_MS, 2500.5);
});

test('loop-controller sources its ceiling from constants (env overridable, default 2)', () => {
  const LC_PATH = require.resolve('../hooks/loop-controller');
  const saved = process.env.PHANTOM_FIX_LOOP_CEILING;
  try {
    process.env.PHANTOM_FIX_LOOP_CEILING = '5';
    delete require.cache[LC_PATH];
    delete require.cache[CONSTANTS_PATH];
    assert.equal(require(LC_PATH).FIX_LOOP_CEILING, 5);
  } finally {
    if (saved === undefined) delete process.env.PHANTOM_FIX_LOOP_CEILING;
    else process.env.PHANTOM_FIX_LOOP_CEILING = saved;
    // Reload clean so other test files see the default ceiling.
    delete require.cache[LC_PATH];
    delete require.cache[CONSTANTS_PATH];
    assert.equal(require(LC_PATH).FIX_LOOP_CEILING, 2);
  }
});
