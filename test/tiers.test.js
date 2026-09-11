// Author: Subash Karki

const test = require('node:test');
const assert = require('node:assert/strict');

const { tierForRole, modelForTier } = require('../lib/tiers.js');

test('tierForRole maps each of the six roles to its tier', () => {
  assert.equal(tierForRole('engineer'), 'balanced');
  assert.equal(tierForRole('inspector'), 'economy');
  assert.equal(tierForRole('auditor'), 'deep');
  assert.equal(tierForRole('opposition'), 'balanced');
  assert.equal(tierForRole('detective'), 'deep');
  assert.equal(tierForRole('surveyor'), 'balanced');
});

test('tierForRole is case-insensitive and returns null for unknown roles', () => {
  assert.equal(tierForRole('Engineer'), 'balanced');
  assert.equal(tierForRole('chief'), null);
  assert.equal(tierForRole(undefined), null);
});

test('modelForTier resolves each tier on the claude-code host', () => {
  assert.equal(modelForTier('economy', 'claude-code'), 'haiku');
  assert.equal(modelForTier('balanced', 'claude-code'), 'sonnet');
  assert.equal(modelForTier('deep', 'claude-code'), 'opus');
});

test('modelForTier lets an explicit override win regardless of host', () => {
  assert.equal(modelForTier('deep', 'claude-code', 'haiku'), 'haiku');
  assert.equal(modelForTier('deep', 'unknown-host', 'sonnet'), 'sonnet');
});

test('modelForTier falls back to inheriting the active model for an unknown host', () => {
  assert.equal(modelForTier('balanced', 'unknown-host'), null);
  assert.equal(modelForTier('balanced', undefined), null);
});
