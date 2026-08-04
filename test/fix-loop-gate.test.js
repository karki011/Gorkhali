// Author: Subash Karki
// fix-loop-gate.test.js — proves the Skill-boundary fix-loop gate is ADVISORY-ONLY.
//
// Invariant under test: the gate NEVER denies. At/over ceiling (or a same-class
// repeat) it emits an advisory via additionalContext; under-ceiling, errors, and
// unresolvable state all stay silent. Spawns the REAL hook process (seam-
// integration pattern) with the PreToolUse JSON on stdin and PHANTOM_DATA →
// tmpdir, so stdin parsing, path resolution, and exit code are production paths.
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

function assertSilent(res, msg) {
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), '', msg || 'a silent pass carries no decision JSON');
}

function assertAdvisory(res, contextRe) {
  assert.equal(res.code, 0, 'advisory rides the JSON, not the exit code');
  const out = parseOut(res.stdout);
  assert.ok(out, 'an advisory is emitted');
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined,
    'advisory mode must NEVER carry a permissionDecision');
  if (contextRe) assert.match(out.hookSpecificOutput.additionalContext, contextRe);
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

test('2. at-ceiling → exit 0, advisory only, NEVER a deny', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedVerification(data, { fixLoops: 2, classHistory: ['type'], lastAttempt: { class: 'build' } });
    const res = runGate({ PHANTOM_DATA: data, PHANTOM_REPO: REPO }, fixPayload(cwd));
    assertAdvisory(res, /FIX LOOP advisory: 2\/2/);
  } finally {
    cleanup();
  }
});

test('3. under-ceiling with valid artifact → silent (no advisory)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedVerification(data, { fixLoops: 1, classHistory: ['type'], lastAttempt: { class: 'build' } });
    const res = runGate({ PHANTOM_DATA: data, PHANTOM_REPO: REPO }, fixPayload(cwd));
    assertSilent(res, 'under-ceiling must pass silently');
  } finally {
    cleanup();
  }
});

test('4. same-class repeat under the ceiling → advisory (never a deny)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedVerification(data, { fixLoops: 1, classHistory: ['type'], lastAttempt: { class: 'type' } });
    const res = runGate({ PHANTOM_DATA: data, PHANTOM_REPO: REPO }, fixPayload(cwd));
    assertAdvisory(res, /same-finding-class/);
  } finally {
    cleanup();
  }
});

test('5. missing verification.json → silent (errors never gate in advisory mode)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    const res = runGate({ PHANTOM_DATA: data, PHANTOM_REPO: REPO }, fixPayload(cwd));
    assertSilent(res, 'missing artifact must stay silent — never blocks');
  } finally {
    cleanup();
  }
});

test('6. garbage verification.json → silent (errors never gate in advisory mode)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    const dir = path.join(data, 'repos', REPO, 'sessions', TICKET);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'verification.json'), '{{{not json');
    const res = runGate({ PHANTOM_DATA: data, PHANTOM_REPO: REPO }, fixPayload(cwd));
    assertSilent(res, 'unparseable artifact must stay silent — never blocks');
  } finally {
    cleanup();
  }
});

test('7. unresolvable ticket → silent (errors never gate in advisory mode)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    const res = runGate(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO },
      { tool_name: 'Skill', tool_input: { skill: 'phantom:fix', args: 'just fix it' }, cwd }
    );
    assertSilent(res, 'unresolvable ticket must stay silent — never blocks');
  } finally {
    cleanup();
  }
});

test('8. at-ceiling WITH valid operator override → silent (override allows)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedVerification(data, {
      fixLoops: 2,
      classHistory: ['type'],
      lastAttempt: { class: 'build' },
      override: { newNarrowerProblem: true, justification: 'x' },
    });
    const res = runGate({ PHANTOM_DATA: data, PHANTOM_REPO: REPO }, fixPayload(cwd));
    assertSilent(res, 'operator override past the ceiling passes silently');
  } finally {
    cleanup();
  }
});
