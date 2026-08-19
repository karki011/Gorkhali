// Author: Subash Karki
// resolve-profile-normalization.test.js - EXECUTED tests for role normalization
// in resolveProfile(). Delegation-v2 tasks carry a title-cased role such as
// "Engineer" (see skills/phantom/references/roles.md), but model-policy.json keys
// its roles lowercase. Role matching must normalize case so that neither the
// policy.roles lookup nor the critical_elevation.eligible_roles check silently
// falls through to the default profile.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const RESOLVER = path.join(REPO_ROOT, 'skills', 'phantom', 'scripts', 'resolve-profile.mjs');

function runJson(args) {
  return JSON.parse(execFileSync(process.execPath, [RESOLVER, ...args], { encoding: 'utf8' }));
}

test('title-cased "Engineer" role with critical risk elevates to deep', () => {
  const result = runJson(['--role', 'Engineer', '--risk', 'critical', '--host', 'claude-code']);
  assert.equal(result.role, 'engineer');
  assert.equal(result.requested_profile, 'deep');
});

test('title-cased "Chief" role resolves frontier regardless of case', () => {
  const result = runJson(['--role', 'Chief', '--host', 'claude-code']);
  assert.equal(result.role, 'chief');
  assert.equal(result.requested_profile, 'frontier');
});

test('lowercase roles keep their existing behavior unchanged', () => {
  const eligible = runJson(['--role', 'engineer', '--risk', 'critical', '--host', 'claude-code']);
  assert.equal(eligible.role, 'engineer');
  assert.equal(eligible.requested_profile, 'deep');

  const chief = runJson(['--role', 'chief', '--host', 'claude-code']);
  assert.equal(chief.role, 'chief');
  assert.equal(chief.requested_profile, 'frontier');
});

test('unknown role falls back to default_profile', () => {
  const result = runJson(['--role', 'Nonexistent-Role', '--host', 'claude-code']);
  assert.equal(result.role, 'nonexistent-role');
  assert.equal(result.requested_profile, 'balanced');
});

test('mixed-case ineligible role does not elevate under critical risk', () => {
  const result = runJson(['--role', 'Inspector', '--risk', 'critical', '--host', 'claude-code']);
  assert.equal(result.role, 'inspector');
  assert.equal(result.requested_profile, 'economy');
});
