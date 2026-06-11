// Author: Subash Karki
// branch-gate.test.js — phantom_protected_branches (hooks/feature-branch-gate.sh):
// precedence env > config.yaml git.protected_branches (inline + multi-line) > default.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GATE_SH = path.join(__dirname, '..', 'hooks', 'feature-branch-gate.sh');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'branch-gate-'));
}

// Sources the gate in function-only mode and resolves the configured
// protected list against $PHANTOM_DATA/config.yaml.
function resolveProtected(dataDir, env = {}) {
  // Strip ambient PHANTOM_PROTECTED_BRANCHES so shell state can't leak, then apply explicit overrides.
  const fullEnv = { ...process.env, PHANTOM_GATE_SOURCE_ONLY: '1', PHANTOM_DATA: dataDir };
  delete fullEnv.PHANTOM_PROTECTED_BRANCHES;
  Object.assign(fullEnv, env);
  const out = execFileSync(
    'bash',
    ['-c', 'source "$1"; phantom_protected_branches', 'gate-runner', GATE_SH],
    { env: fullEnv, encoding: 'utf8' }
  );
  return out.trim().split(/\s+/).filter(Boolean);
}

test('no env, no config: defaults to main master develop', () => {
  const tmp = mkTmp();
  try {
    assert.deepEqual(resolveProtected(tmp), ['main', 'master', 'develop']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('PHANTOM_PROTECTED_BRANCHES accepts comma and space separators', () => {
  const tmp = mkTmp();
  try {
    const got = resolveProtected(tmp, { PHANTOM_PROTECTED_BRANCHES: 'release, staging trunk' });
    assert.deepEqual(got, ['release', 'staging', 'trunk']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('config.yaml git.protected_branches inline list is parsed', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(
      path.join(tmp, 'config.yaml'),
      // Exact shape shipped in config.yaml.example, trailing comment included.
      'jira:\n  project: CP\n\ngit:\n  protected_branches: [main, master, develop]  # Direct work blocked by feature-branch gate\n\npreferences:\n  auto_draft_pr: true\n'
    );
    assert.deepEqual(resolveProtected(tmp), ['main', 'master', 'develop']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('config.yaml git.protected_branches multi-line list is parsed', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(
      path.join(tmp, 'config.yaml'),
      'git:\n  protected_branches:\n    - release\n    - qa\n\nslack:\n  enabled: false\n'
    );
    assert.deepEqual(resolveProtected(tmp), ['release', 'qa']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('env var takes precedence over config.yaml', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, 'config.yaml'), 'git:\n  protected_branches: [qa]\n');
    const got = resolveProtected(tmp, { PHANTOM_PROTECTED_BRANCHES: 'staging' });
    assert.deepEqual(got, ['staging']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('config.yaml without a git section falls back to default', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, 'config.yaml'), 'jira:\n  project: CP\n');
    assert.deepEqual(resolveProtected(tmp), ['main', 'master', 'develop']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
