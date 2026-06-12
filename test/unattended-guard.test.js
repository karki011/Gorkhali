// Author: Subash Karki
// unattended-guard.test.js — proves the unattended tripwire guard's POLARITY.
//
// Prime invariant under test: attended sessions (no env, no marker) are a free
// no-op for EVERY tool call; activated sessions deny destructive Bash shapes,
// sensitive Reads, and out-of-root writes — and deny on ambiguity. Spawns the
// REAL hook process (seam-integration pattern) with the PreToolUse JSON on
// stdin and PHANTOM_DATA → tmpdir, so stdin parsing, path resolution, and the
// exit code are the production code paths.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'unattended-guard.js');

const REPO = 'testrepo';

// Spawn the real hook as Claude Code does: JSON payload on stdin, env-driven
// path resolution. Returns { code, stdout, stderr }.
function runGuard(envOverrides, payload) {
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

// Fresh PHANTOM_DATA root + a non-git cwd standing in for the worktree.
function setup() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-data-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-cwd-'));
  return { data, cwd, cleanup: () => {
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  } };
}

// Arming marker exactly as scripts/preflight.js writes it.
function seedMarker(data, worktreeRoot) {
  const dir = path.join(data, 'state', 'unattended');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, REPO + '.json'),
    JSON.stringify({ worktreeRoot, ticket: 'PROJ-123', ts: new Date().toISOString() }, null, 2)
  );
}

function bashPayload(cwd, command) {
  return { tool_name: 'Bash', tool_input: { command }, cwd };
}

function readPayload(cwd, file_path) {
  return { tool_name: 'Read', tool_input: { file_path }, cwd };
}

function writePayload(cwd, file_path) {
  return { tool_name: 'Write', tool_input: { file_path, content: 'x' }, cwd };
}

function parseOut(stdout) {
  return stdout.trim() ? JSON.parse(stdout) : null;
}

function assertDeny(res, reasonRe) {
  assert.equal(res.code, 0, 'decision rides the JSON, not the exit code');
  const out = parseOut(res.stdout);
  assert.ok(out, 'a deny decision is emitted');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /^UNATTENDED GUARD: /);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, reasonRe);
}

function assertAllow(res, msg) {
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), '', msg || 'an allow carries no decision JSON');
}

test('1. attended (no env, no marker) → exit 0, empty stdout even for rm -rf (fast-path no-op)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    const res = runGuard(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO },
      bashPayload(cwd, 'rm -rf /tmp/x')
    );
    assertAllow(res, 'attended sessions must never be evaluated, let alone denied');
  } finally {
    cleanup();
  }
});

test('2. env-activated: each destructive Bash class denies', () => {
  const { data, cwd, cleanup } = setup();
  try {
    const cases = [
      ['rm -rf /tmp/x', /rm -rf/],
      ['rm -fr /tmp/x', /rm -rf/],
      ['rm -r -f /tmp/x', /rm -rf/],
      ['rm --no-preserve-root -rf /', /rm/],
      ['git push -f origin main', /git push --force/],
      ['git push --force origin main', /git push --force/],
      ['git reset --hard origin/main', /git reset --hard/],
      ['git reset --hard @{u}', /git reset --hard/],
      ['git clean -fd', /git clean -fd/],
      ['git clean -f -d', /git clean -fd/],
      ['chmod -R 777 /srv/app', /chmod -R 777/],
    ];
    for (const [command, reasonRe] of cases) {
      const res = runGuard(
        { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
        bashPayload(cwd, command)
      );
      assertDeny(res, reasonRe);
    }
  } finally {
    cleanup();
  }
});

test('3. env-activated: git push --force-with-lease and benign commands ALLOWED', () => {
  const { data, cwd, cleanup } = setup();
  try {
    for (const command of ['git push --force-with-lease origin x', 'ls -la', 'git status']) {
      const res = runGuard(
        { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
        bashPayload(cwd, command)
      );
      assertAllow(res, `'${command}' must be allowed`);
    }
  } finally {
    cleanup();
  }
});

test('4. env-activated: sensitive Reads deny, .env.example and normal files allowed', () => {
  const { data, cwd, cleanup } = setup();
  try {
    const env = { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' };
    for (const fp of ['.env', 'config/.env.production', 'certs/server.pem', 'aws-credentials.json', 'keys/deploy.key']) {
      assertDeny(runGuard(env, readPayload(cwd, fp)), /sensitive file read/);
    }
    for (const fp of ['.env.example', 'src/a.js']) {
      assertAllow(runGuard(env, readPayload(cwd, fp)), `Read of '${fp}' must be allowed`);
    }
  } finally {
    cleanup();
  }
});

test('5. env-activated with marker: Write inside the worktree root → ALLOWED', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedMarker(data, fs.realpathSync(cwd));
    const res = runGuard(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      writePayload(cwd, path.join(cwd, 'src', 'new-file.ts'))
    );
    assertAllow(res, 'writes inside the armed worktree must pass');
  } finally {
    cleanup();
  }
});

test('6. env-activated with marker: relative ../escape outside the worktree → deny', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedMarker(data, fs.realpathSync(cwd));
    const res = runGuard(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      writePayload(cwd, '../escape.txt')
    );
    assertDeny(res, /outside allowed roots/);
  } finally {
    cleanup();
  }
});

test('7. env-activated with marker: Write into the PHANTOM_DATA subtree → ALLOWED', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedMarker(data, fs.realpathSync(cwd));
    const res = runGuard(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      writePayload(cwd, path.join(data, 'repos', REPO, 'sessions', 'PROJ-123', 'execution.json'))
    );
    assertAllow(res, 'session-artifact writes under PHANTOM_DATA must pass');
  } finally {
    cleanup();
  }
});

test('8. marker-activated (no env), cwd inside worktreeRoot → guard enforces', () => {
  const { data, cwd, cleanup } = setup();
  try {
    seedMarker(data, fs.realpathSync(cwd));
    const res = runGuard(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO },
      bashPayload(cwd, 'rm -rf build')
    );
    assertDeny(res, /rm -rf/);
  } finally {
    cleanup();
  }
});

test('9. marker-activated with cwd OUTSIDE marker.worktreeRoot → exit 0, not activated', () => {
  const { data, cwd, cleanup } = setup();
  const otherCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-other-'));
  try {
    seedMarker(data, fs.realpathSync(cwd));
    const res = runGuard(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO },
      bashPayload(otherCwd, 'rm -rf /tmp/x')
    );
    assertAllow(res, 'a marker for another worktree must not enforce here');
  } finally {
    fs.rmSync(otherCwd, { recursive: true, force: true });
    cleanup();
  }
});

test('10. env-activated, no marker, non-git cwd → worktree root undeterminable → fail-safe deny', () => {
  const { data, cwd, cleanup } = setup();
  try {
    // No marker seeded and cwd is a bare tmpdir, so git rev-parse fails.
    const res = runGuard(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      writePayload(cwd, path.join(cwd, 'x.txt'))
    );
    assertDeny(res, /undeterminable/);
  } finally {
    cleanup();
  }
});

// --- worktrees carve-out: <data>/worktrees/ holds repo SOURCE and must NOT
// inherit the blanket PHANTOM_DATA state allowlist. ---

test('11. worktrees carve-out: Write into ANOTHER worktree under PHANTOM_DATA, cwd outside it → deny', () => {
  const { data, cwd, cleanup } = setup();
  try {
    // Own worktree is cwd (marker-supplied); the target is repo source in a
    // DIFFERENT ticket's worktree under the data root. Pre-carve-out this
    // passed via the dataRoot blanket — it must now deny.
    seedMarker(data, fs.realpathSync(cwd));
    const res = runGuard(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      writePayload(cwd, path.join(data, 'worktrees', 'other-repo', 'T-9', 'src', 'x.ts'))
    );
    assertDeny(res, /outside allowed roots/);
  } finally {
    cleanup();
  }
});

test('12. worktrees carve-out: Write inside OWN worktree under <data>/worktrees (git toplevel) → ALLOWED', () => {
  const { data, cleanup } = setup();
  const wt = path.join(data, 'worktrees', 'myrepo', 'T-1');
  fs.mkdirSync(wt, { recursive: true });
  // tmpdir fixture repo so git rev-parse --show-toplevel resolves to the worktree.
  execFileSync('git', ['init', '-q'], { cwd: wt });
  try {
    const res = runGuard(
      { PHANTOM_DATA: data, PHANTOM_UNATTENDED: '1' },
      writePayload(wt, path.join(wt, 'src', 'x.ts'))
    );
    assertAllow(res, 'own-worktree writes pass via the worktree-root rule, not the data allowlist');
  } finally {
    cleanup();
  }
});

test('13. worktrees carve-out: state writes under <data>/repos/... stay ALLOWED (allowlist intact)', () => {
  const { data, cwd, cleanup } = setup();
  try {
    // No marker, non-git cwd → worktree root undeterminable, yet state-dir
    // writes must still pass through the (carved) PHANTOM_DATA allowlist.
    const res = runGuard(
      { PHANTOM_DATA: data, PHANTOM_REPO: REPO, PHANTOM_UNATTENDED: '1' },
      writePayload(cwd, path.join(data, 'repos', REPO, 'sessions', 'T-1', 'plan.md'))
    );
    assertAllow(res, 'the state allowlist outside worktrees/ must remain intact');
  } finally {
    cleanup();
  }
});
