// Author: Subash Karki
// constants.test.js — pins the single-source runtime constants: defaults stay
// stable, env overrides apply, and garbage values fail open.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const CONSTANTS_PATH = require.resolve('../scripts/lib/constants');

const OVERRIDE_ENVS = [
  'PHANTOM_GRADUATION_THRESHOLD',
  'PHANTOM_PROMOTE_THRESHOLD',
  'PHANTOM_EXTRACT_TIMEOUT_MS',
  'PHANTOM_LEARNING_STALE_DAYS',
  'PHANTOM_LEARNING_REMOVE_DAYS',
  'PHANTOM_LEARNING_DISTILL_CAP',
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

test('runtime defaults remain stable', () => {
  const C = freshConstants();
  assert.equal(C.GRADUATION_THRESHOLD, 5);
  assert.equal(C.PROMOTE_THRESHOLD, 5);
  assert.equal(C.EXTRACT_TIMEOUT_MS, 5000);
  assert.equal(C.LEARNING_STALE_DAYS, 30);
  assert.equal(C.LEARNING_REMOVE_DAYS, 60);
  assert.equal(C.LEARNING_DISTILL_CAP, 50);
  assert.equal(C.DEFAULT_HOOK_TIMEOUT_SECONDS, 10);
});

test('env overrides apply to every numeric constant', () => {
  const C = freshConstants({
    PHANTOM_GRADUATION_THRESHOLD: '7',
    PHANTOM_PROMOTE_THRESHOLD: '8',
    PHANTOM_EXTRACT_TIMEOUT_MS: '9000',
    PHANTOM_LEARNING_STALE_DAYS: '14',
    PHANTOM_LEARNING_REMOVE_DAYS: '90',
    PHANTOM_LEARNING_DISTILL_CAP: '25',
  });
  assert.equal(C.GRADUATION_THRESHOLD, 7);
  assert.equal(C.PROMOTE_THRESHOLD, 8);
  assert.equal(C.EXTRACT_TIMEOUT_MS, 9000);
  assert.equal(C.LEARNING_STALE_DAYS, 14);
  assert.equal(C.LEARNING_REMOVE_DAYS, 90);
  assert.equal(C.LEARNING_DISTILL_CAP, 25);
});

test('garbage env values fail open to the defaults', () => {
  const C = freshConstants({
    PHANTOM_EXTRACT_TIMEOUT_MS: '',
    PHANTOM_GRADUATION_THRESHOLD: 'NaN',
  });
  assert.equal(C.EXTRACT_TIMEOUT_MS, 5000);
  assert.equal(C.GRADUATION_THRESHOLD, 5);
});

test('integer constants reject floats while number constants retain them', () => {
  const C = freshConstants({
    PHANTOM_INJECTION_SLOTS: '2.5',
    PHANTOM_EXTRACT_TIMEOUT_MS: '2500.5',
  });
  assert.equal(C.INJECTION_SLOTS, 5);
  assert.equal(C.EXTRACT_TIMEOUT_MS, 2500.5);
});
