// Author: Subash Karki
// fix-loop-gate.test.js — proves the Skill-boundary fix-loop gate's POLARITY.
//
// Prime invariant under test: absence/ambiguity → MORE gating in unattended,
// ZERO gating in attended. Spawns the REAL hook process (seam-integration
// pattern) with the PreToolUse JSON on stdin and PHANTOM_DATA → tmpdir, so the
// stdin parsing, path resolution, and exit code are the production code paths.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'fix-loop-gate.js');

const REPO = 'testrepo';
const TICKET = 'PROJ-123';

// Spawn the real hook as Claude Code does: JSON payload on stdin, env-driven
// path resolution. Returns { code, stdout, stderr }.
function runGate(envOverrides, payload) {
  const env = { ...process.env, ...envOverrides };
  delete env.PHANTOM_UNATTENDED; // never inherit from the outer session
  if (envOverrides.PHANTOM_UNATTENDED) env.PHANTOM_UNATTENDED = envOverrides.PHANTOM_UNATTENDED;
  try {
    const stdout = execFileSync('node', [HOOK], {
      input: JSON.stringify(payload),
      env,
      encoding: 'utf-8',
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: (e.stdout || '').toString(),
      stderr: (e.stderr || '').toString(),
    };
  }
}

// Fresh PHANTOM_DATA root + a non-git cwd (so `git branch` cannot leak a ticket).
function setup() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'flg-data-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'flg-cwd-'));
  return { data, cwd, cleanup: () => {
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  } };
}

function seedVerification(data, review) {
  const dir = path.join(data, 'repos', REPO, 'sessions', TICKET);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'verification.json'), JSON.stringify({ review }));
}

function fixPayload(cwd, extraInput = {}) {
  return {
    tool_name: 'Skill',
    tool_input: { skill: 'phantom:fix', args: TICKET, ...extraInput },
    cwd,
  };
}

function parseOut(stdout) {
  return stdout.trim() ? JSON.parse(stdout) : null;
}

function assertAllow(res, msg) {
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), '', msg || 'an allow carries no decision JSON');
}

function assertDeny(res, reasonRe) {
  assert.equal(res.code, 0, 'decision rides the JSON, not the exit code');
  const out = parseOut(res.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  if (reasonRe) assert.match(out.hookSpecificOutput.permissionDecisionReason, reasonRe);
}

test('1. non-fix Skill invocation → exit 0, empty stdout (fast path)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    const res = runGate(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO },
      { tool_name: 'Skill', tool_input: { skill: 'phantom:verify', args: TICKET }, cwd }
    );
    assert.equal(res.code, 0);
    assert.equal(res.stdout.trim(), '', 'non-fix skills must pass through silently');
  } finally {
    cleanup();
  }
});

test('2. attended at-ceiling → exit 0, advisory only, NEVER a deny', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedVerification(data, { fixLoops: 2, classHistory: ['type'], lastAttempt: { class: 'build' } });
    const res = runGate({ PHANTOM_DATA: data, PHANTOM_REPO: REPO }, fixPayload(cwd));
    assert.equal(res.code, 0, 'attended sessions must never be blocked');
    const out = parseOut(res.stdout);
    assert.ok(out, 'an advisory is emitted at the ceiling');
    assert.match(out.hookSpecificOutput.additionalContext, /FIX LOOP advisory: 2\/2/);
    assert.equal(out.hookSpecificOutput.permissionDecision, undefined,
      'attended mode must not carry ANY permissionDecision');
  } finally {
    cleanup();
  }
});

test('3. unattended (env) under-ceiling with valid artifact → ALLOW', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedVerification(data, { fixLoops: 1, classHistory: ['type'], lastAttempt: { class: 'build' } });
    const res = runGate(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      fixPayload(cwd)
    );
    assertAllow(res);
  } finally {
    cleanup();
  }
});

test('4. unattended at-ceiling → deny', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedVerification(data, { fixLoops: 2, classHistory: ['type'], lastAttempt: { class: 'build' } });
    const res = runGate(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      fixPayload(cwd)
    );
    assertDeny(res, /FIX LOOP 2\/2: ceiling-reached/);
  } finally {
    cleanup();
  }
});

test('5. unattended same-class repeat → deny even under the ceiling', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedVerification(data, { fixLoops: 1, classHistory: ['type'], lastAttempt: { class: 'type' } });
    const res = runGate(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      fixPayload(cwd)
    );
    assertDeny(res, /same-finding-class/);
  } finally {
    cleanup();
  }
});

test('6. unattended missing verification.json → fail-safe deny', () => {
  const { data, cwd, cleanup } = setup();
  try {
    const res = runGate(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      fixPayload(cwd)
    );
    assertDeny(res, /verification-missing/);
  } finally {
    cleanup();
  }
});

test('7. unattended garbage verification.json → fail-safe deny', () => {
  const { data, cwd, cleanup } = setup();
  try {
    const dir = path.join(data, 'repos', REPO, 'sessions', TICKET);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'verification.json'), '{{{not json');
    const res = runGate(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      fixPayload(cwd)
    );
    assertDeny(res, /verification-unparseable/);
  } finally {
    cleanup();
  }
});

test('8. unattended unresolvable ticket → fail-safe deny', () => {
  const { data, cwd, cleanup } = setup();
  try {
    // No ticket in args, no current-session file, cwd is not a git repo.
    const res = runGate(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      { tool_name: 'Skill', tool_input: { skill: 'phantom:fix', args: 'just fix it' }, cwd }
    );
    assertDeny(res, /ticket-unresolvable/);
  } finally {
    cleanup();
  }
});

test('9. unattended at-ceiling WITH valid operator override → allow', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedVerification(data, {
      fixLoops: 2,
      classHistory: ['type'],
      lastAttempt: { class: 'build' },
      override: { newNarrowerProblem: true, justification: 'x' },
    });
    const res = runGate(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      fixPayload(cwd)
    );
    assertAllow(res, 'operator override past the ceiling allows silently');
  } finally {
    cleanup();
  }
});
