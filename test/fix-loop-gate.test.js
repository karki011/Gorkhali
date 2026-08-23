// Author: Subash Karki
// fix-loop-gate.test.js — proves the Skill-boundary fix-loop gate is ADVISORY-ONLY.
//
// Invariant under test: the gate NEVER denies. At/over ceiling (or a same-class
// repeat) it emits an advisory via additionalContext; under-ceiling, errors, and
// unresolvable state all stay silent. Spawns the REAL hook process (seam-
// integration pattern) with the PreToolUse JSON on stdin and GORKHALI_DATA →
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

// Fresh GORKHALI_DATA root + a non-git cwd (so `git branch` cannot leak a ticket).
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

// The artifact the PORTABLE flow writes: one append per validly completed review
// round. `rounds` entries only need to exist — the gate counts them, it does not
// read them.
function seedRounds(data, count, contents = null) {
  const dir = path.join(data, 'repos', REPO, 'sessions', TICKET, 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  const body =
    contents !== null
      ? contents
      : JSON.stringify({
          schema: 'gorkhali.review-rounds/1',
          rounds: Array.from({ length: count }, (_, i) => ({ round: i + 1, findings: [] })),
        });
  fs.writeFileSync(path.join(dir, 'rounds.json'), body);
}

function fixPayload(cwd, extraInput = {}) {
  return {
    tool_name: 'Skill',
    tool_input: { skill: 'gorkhali:fix', args: TICKET, ...extraInput },
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
      { GORKHALI_DATA: data, GORKHALI_REPO: REPO },
      { tool_name: 'Skill', tool_input: { skill: 'gorkhali:verify', args: TICKET }, cwd }
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
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
    assertAdvisory(res, /FIX LOOP advisory: 2\/2/);
  } finally {
    cleanup();
  }
});

test('3. under-ceiling with valid artifact → silent (no advisory)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedVerification(data, { fixLoops: 1, classHistory: ['type'], lastAttempt: { class: 'build' } });
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
    assertSilent(res, 'under-ceiling must pass silently');
  } finally {
    cleanup();
  }
});

test('4. same-class repeat under the ceiling → advisory (never a deny)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedVerification(data, { fixLoops: 1, classHistory: ['type'], lastAttempt: { class: 'type' } });
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
    assertAdvisory(res, /same-finding-class/);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// The portable path. Tests 2-4 and 8 above seed the LEGACY artifact, which no
// live path has written since verify/review moved onto the portable lifecycle —
// which is exactly how this gate came to resolve `verification-missing` and stay
// silent through every loop it exists to bound. These pin the ledger source.
// ---------------------------------------------------------------------------

test('9. round ledger at the ceiling → advisory, with no verification.json anywhere', () => {
  const { data, cwd, cleanup } = setup();
  try {
    // 3 recorded rounds = the first review + 2 fix loops = the ceiling.
    seedRounds(data, 3);
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
    assertAdvisory(res, /FIX LOOP advisory: 2\/2 — ceiling-reached \(counted from rounds-ledger\)/);
  } finally {
    cleanup();
  }
});

test('10. round ledger under the ceiling → silent', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedRounds(data, 2); // first review + 1 fix loop
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
    assertSilent(res, 'one fix loop is under the ceiling');
  } finally {
    cleanup();
  }
});

test('11. the first review is not a fix loop', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedRounds(data, 1);
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
    assertSilent(res, 'round 1 is the first review, before any fix');
  } finally {
    cleanup();
  }
});

test('12. the ledger wins over a stale legacy artifact', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedVerification(data, { fixLoops: 0 }); // stale: nothing has written it in this session
    seedRounds(data, 3);
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
    assertAdvisory(res, /2\/2 — ceiling-reached \(counted from rounds-ledger\)/);
  } finally {
    cleanup();
  }
});

test('13. a corrupt ledger falls back to the legacy artifact rather than fabricating 0', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedRounds(data, 0, '{{{not json');
    seedVerification(data, { fixLoops: 2 });
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
    assertAdvisory(res, /2\/2 — ceiling-reached \(counted from verification-artifact\)/);
  } finally {
    cleanup();
  }
});

test('14. an operator override on the legacy artifact still allows a ledger-counted loop past the ceiling', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedRounds(data, 3);
    seedVerification(data, { override: { newNarrowerProblem: true, justification: 'narrower repro found' } });
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
    assertSilent(res, 'a logged override is the one documented way past the ceiling');
  } finally {
    cleanup();
  }
});

test('5. missing verification.json → silent (errors never gate in advisory mode)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
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
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
    assertSilent(res, 'unparseable artifact must stay silent — never blocks');
  } finally {
    cleanup();
  }
});

test('7. unresolvable ticket → silent (errors never gate in advisory mode)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    const res = runGate(
      { GORKHALI_DATA: data, GORKHALI_REPO: REPO },
      { tool_name: 'Skill', tool_input: { skill: 'gorkhali:fix', args: 'just fix it' }, cwd }
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
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
    assertSilent(res, 'operator override past the ceiling passes silently');
  } finally {
    cleanup();
  }
});

test('15. the gate counts distinct reviewed fingerprints, not rounds', () => {
  const { data, cwd, cleanup } = setup();
  try {
    const dir = path.join(data, 'repos', REPO, 'sessions', TICKET, 'reviews');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'rounds.json'),
      JSON.stringify({
        schema: 'gorkhali.review-rounds/1',
        rounds: [1, 2, 3].map((round) => ({ round, findings: [], fingerprint: 'sha256:unchanged' })),
      })
    );
    const res = runGate({ GORKHALI_DATA: data, GORKHALI_REPO: REPO }, fixPayload(cwd));
    assertSilent(res, 'three reviews of one untouched diff are not three fix attempts');
  } finally {
    cleanup();
  }
});
