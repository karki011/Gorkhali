// Author: Subash Karki
// resolve-profile-normalization.test.js - EXECUTED tests for role normalization
// in resolveProfile(). Delegation-v2 tasks carry a title-cased role such as
// "Blade" (see skills/phantom/references/roles.md), but model-policy.json keys
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

test('title-cased "Blade" role with critical risk elevates to deep', () => {
  const result = runJson(['--role', 'Blade', '--risk', 'critical', '--host', 'claude-code']);
  assert.equal(result.role, 'blade');
  assert.equal(result.requested_profile, 'deep');
});

test('title-cased "Apex" role resolves frontier regardless of case', () => {
  const result = runJson(['--role', 'Apex', '--host', 'claude-code']);
  assert.equal(result.role, 'apex');
  assert.equal(result.requested_profile, 'frontier');
});

test('lowercase roles keep their existing behavior unchanged', () => {
  const eligible = runJson(['--role', 'blade', '--risk', 'critical', '--host', 'claude-code']);
  assert.equal(eligible.role, 'blade');
  assert.equal(eligible.requested_profile, 'deep');

  const apex = runJson(['--role', 'apex', '--host', 'claude-code']);
  assert.equal(apex.role, 'apex');
  assert.equal(apex.requested_profile, 'frontier');
});

test('unknown role falls back to default_profile', () => {
  const result = runJson(['--role', 'Nonexistent-Role', '--host', 'claude-code']);
  assert.equal(result.role, 'nonexistent-role');
  assert.equal(result.requested_profile, 'balanced');
});

test('mixed-case ineligible role does not elevate under critical risk', () => {
  const result = runJson(['--role', 'Ward', '--risk', 'critical', '--host', 'claude-code']);
  assert.equal(result.role, 'ward');
  assert.equal(result.requested_profile, 'economy');
});
