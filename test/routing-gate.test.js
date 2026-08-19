// Author: Subash Karki
// routing-gate.test.js — proves the routing gate's INVERSE polarity: an opt-in
// discipline gate that fails OPEN. Only PHANTOM_ROUTING_ENFORCE=1 arms it; it
// covers Phantom-known repositories (or all Git repositories by explicit
// scope); PHANTOM_ADHOC=1 bypasses with a logged line; and only valid
// repository-scoped portable lifecycle state satisfies routing.
//
// Spawns the REAL hook process. Env is read at INVOCATION time, so every
// spawn pins PHANTOM_DATA to a tmpdir and sets PHANTOM_ROUTING_ENFORCE only
// when the case under test arms the gate.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'routing-gate.js');
const STATE = path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'phantom-state.mjs');

function runGate(envOverrides, stdinText) {
  const env = { ...process.env, ...envOverrides };
  delete env.PHANTOM_ADHOC; // never inherit from the outer session
  if (envOverrides.PHANTOM_ADHOC) env.PHANTOM_ADHOC = envOverrides.PHANTOM_ADHOC;
  // Same isolation for the arm toggle: outer shell state must not leak in.
  if (!envOverrides.PHANTOM_ROUTING_ENFORCE) delete env.PHANTOM_ROUTING_ENFORCE;
  if (!envOverrides.PHANTOM_ROUTING_SCOPE) delete env.PHANTOM_ROUTING_SCOPE;
  try {
    const stdout = execFileSync(process.execPath, [HOOK], {
      input: stdinText,
      env,
      encoding: 'utf-8',
    });
    return { code: 0, stdout };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: (e.stdout || '').toString(),
    };
  }
}

// Fresh PHANTOM_DATA, a controlled config, and a git-repo fixture.
// gitKind: 'dir' (normal repo) | 'file' (worktree pointer) | 'none'.
function setup({ enforce = true, known = true, gitKind = 'dir' } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-data-'));

  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-repo-'));
  if (gitKind === 'dir') {
    fs.mkdirSync(path.join(repoRoot, '.git'));
  } else if (gitKind === 'file') {
    // W8: linked worktrees have a .git FILE pointing at the real gitdir.
    fs.writeFileSync(path.join(repoRoot, '.git'), 'gitdir: /elsewhere/worktrees/x\n');
  }
  if (known) {
    fs.mkdirSync(path.join(data, 'repos', path.basename(repoRoot)), { recursive: true });
  }
  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  const target = path.join(repoRoot, 'src', 'index.ts');
  fs.writeFileSync(target, '// fixture\n');

  return {
    data,
    repoRoot,
    target,
    env: {
      PHANTOM_DATA: data,
      PHANTOM_REPO: path.basename(repoRoot),
      ...(enforce ? { PHANTOM_ROUTING_ENFORCE: '1' } : {}),
    },
    cleanup: () => {
      fs.rmSync(data, { recursive: true, force: true });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    },
  };
}

function editPayload(target, cwd) {
  return JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: target }, cwd });
}

function writePortableSession(data, repoRoot, status = 'active', options = {}) {
  const repo = options.repo || path.basename(repoRoot);
  const task = options.task || 'TEST-1';
  const collection = status === 'completed' ? 'completed' : 'sessions';
  const sessionDir = options.sessionDir || path.join(data, 'repos', repo, collection, task);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify({
    schema_version: 1,
    repo_id: options.sessionRepo || repo,
    task_id: task,
    status,
    workspace: options.workspace || fs.realpathSync(repoRoot),
  }));
  const pointerDir = path.join(data, 'state', 'current-session');
  fs.mkdirSync(pointerDir, { recursive: true });
  fs.writeFileSync(path.join(pointerDir, `${repo}.json`), JSON.stringify({
    schema_version: 1,
    repo_id: repo,
    task_id: task,
    session_dir: sessionDir,
  }));
  return { repo, task, sessionDir };
}

function assertAllow(res, msg) {
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), '', msg || 'an allow carries no decision JSON');
}

function assertDeny(res) {
  assert.equal(res.code, 0, 'decision rides the JSON, not the exit code');
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /ROUTING GATE/);
}

test('1. enforce: false + phantom-known repo edit → no-op allow', () => {
  const { env, repoRoot, target, cleanup } = setup({ enforce: false });
  try {
    assertAllow(runGate(env, editPayload(target, repoRoot)),
      'gate must stay disarmed unless enforce is the literal true');
  } finally {
    cleanup();
  }
});

test('2. enforce: true + phantom-known repo + no session → DENY', () => {
  const { env, repoRoot, target, cleanup } = setup();
  try {
    assertDeny(runGate(env, editPayload(target, repoRoot)));
  } finally {
    cleanup();
  }
});

test('3. enforce: true + previously unknown Git repo → ALLOW by default', () => {
  const { env, repoRoot, target, cleanup } = setup({ known: false });
  try {
    assertAllow(runGate(env, editPayload(target, repoRoot)));
  } finally {
    cleanup();
  }
});

test('3b. PHANTOM_ROUTING_SCOPE=all-git gates a previously unknown Git repo', () => {
  const { env, repoRoot, target, cleanup } = setup({ known: false });
  try {
    assertDeny(runGate({ ...env, PHANTOM_ROUTING_SCOPE: 'all-git' }, editPayload(target, repoRoot)));
  } finally {
    cleanup();
  }
});

test('4. W8: worktree fixture (.git is a FILE) in phantom-known repo → DENY', () => {
  const { env, repoRoot, target, cleanup } = setup({ gitKind: 'file' });
  try {
    assertDeny(runGate(env, editPayload(target, repoRoot)));
  } finally {
    cleanup();
  }
});

test('5. fresh legacy .chief-active alone → DENY', () => {
  const { data, env, repoRoot, target, cleanup } = setup();
  try {
    fs.writeFileSync(path.join(data, '.chief-active'), '');
    assertDeny(runGate(env, editPayload(target, repoRoot)));
  } finally {
    cleanup();
  }
});

test('6. valid active portable state for the same repository → ALLOW', () => {
  const { data, env, repoRoot, target, cleanup } = setup();
  try {
    writePortableSession(data, repoRoot);
    assertAllow(runGate(env, editPayload(target, repoRoot)));
  } finally {
    cleanup();
  }
});

test('7. PHANTOM_ADHOC=1 → allow AND bypass is logged with file+cwd', () => {
  const { data, env, repoRoot, target, cleanup } = setup();
  try {
    const res = runGate({ ...env, PHANTOM_ADHOC: '1' }, editPayload(target, repoRoot));
    assertAllow(res, 'the escape hatch allows');
    const log = fs.readFileSync(path.join(data, 'state', 'routing-bypass.jsonl'), 'utf-8');
    const lines = log.trim().split('\n');
    assert.equal(lines.length, 1, 'exactly one bypass line');
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.file, target);
    assert.equal(entry.cwd, repoRoot);
    assert.ok(entry.ts, 'bypass line carries a timestamp');
  } finally {
    cleanup();
  }
});

test('8. target under PHANTOM_DATA → allow', () => {
  const { data, env, repoRoot, cleanup } = setup();
  try {
    const target = path.join(data, 'repos', 'somerepo', 'sessions', 'PROJ-1', 'plan.json');
    assertAllow(runGate(env, editPayload(target, repoRoot)),
      "phantom's own data tree is never gated");
  } finally {
    cleanup();
  }
});

test('9. non-repo target (no .git up the tree) → allow', () => {
  const { env, repoRoot, cleanup } = setup();
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-plain-'));
  try {
    const target = path.join(plain, 'notes.txt');
    fs.writeFileSync(target, 'x');
    assertAllow(runGate(env, editPayload(target, repoRoot)),
      'outside any repo the gate has no jurisdiction');
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
    cleanup();
  }
});

test('10. garbage stdin → exit 0 silent', () => {
  const { env, cleanup } = setup();
  try {
    assertAllow(runGate(env, '{{{not json'));
  } finally {
    cleanup();
  }
});

for (const status of ['paused', 'completed']) {
  test(`portable ${status} state does not satisfy routing`, () => {
    const { data, env, repoRoot, target, cleanup } = setup();
    try {
      writePortableSession(data, repoRoot, status);
      assertDeny(runGate(env, editPayload(target, repoRoot)));
    } finally {
      cleanup();
    }
  });
}

test('corrupt portable pointer does not satisfy routing', () => {
  const { data, env, repoRoot, target, cleanup } = setup();
  try {
    const repo = path.basename(repoRoot);
    const dir = path.join(data, 'state', 'current-session');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${repo}.json`), '{not-json');
    assertDeny(runGate(env, editPayload(target, repoRoot)));
  } finally {
    cleanup();
  }
});

test('structurally corrupt pointer path does not satisfy routing', () => {
  const { data, env, repoRoot, target, cleanup } = setup();
  try {
    const repo = path.basename(repoRoot);
    const file = path.join(data, 'state', 'current-session', `${repo}.json`);
    fs.mkdirSync(file, { recursive: true });
    assertDeny(runGate(env, editPayload(target, repoRoot)));
  } finally {
    cleanup();
  }
});

test('active state for repository A does not unlock repository B', () => {
  const { data, env, repoRoot, cleanup } = setup();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-other-'));
  try {
    fs.mkdirSync(path.join(other, '.git'));
    const target = path.join(other, 'index.ts');
    fs.writeFileSync(target, '// other\n');
    fs.mkdirSync(path.join(data, 'repos', path.basename(other)), { recursive: true });
    writePortableSession(data, repoRoot);
    assertDeny(runGate(env, editPayload(target, other)));
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
    cleanup();
  }
});

test('active state from another worktree does not unlock this worktree', () => {
  const { data, env, repoRoot, target, cleanup } = setup();
  try {
    writePortableSession(data, repoRoot, 'active', { workspace: os.tmpdir() });
    assertDeny(runGate(env, editPayload(target, repoRoot)));
  } finally {
    cleanup();
  }
});

test('operational state read failure follows the gate fail-open contract', () => {
  const { data, env, repoRoot, target, cleanup } = setup();
  let sessionDir;
  try {
    ({ sessionDir } = writePortableSession(data, repoRoot));
    fs.chmodSync(sessionDir, 0o000);
    assertAllow(runGate(env, editPayload(target, repoRoot)));
  } finally {
    if (sessionDir) fs.chmodSync(sessionDir, 0o700);
    cleanup();
  }
});

test('all-git scope fails open when Git identity resolution is unavailable', () => {
  const { env, repoRoot, target, cleanup } = setup({ known: false });
  const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-path-'));
  try {
    const degraded = { ...env, PATH: emptyPath, PHANTOM_REPO: '', PHANTOM_ROUTING_SCOPE: 'all-git' };
    assertAllow(runGate(degraded, editPayload(target, repoRoot)));
  } finally {
    fs.rmSync(emptyPath, { recursive: true, force: true });
    cleanup();
  }
});

test('real no-origin linked worktree shares the portable lifecycle common-root identity', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-data-'));
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-main-'));
  const linked = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-linked-parent-'));
  const worktree = path.join(linked, 'worktree');
  const env = { ...process.env, PHANTOM_DATA: data, PHANTOM_ROUTING_ENFORCE: '1' };
  try {
    execFileSync('git', ['init', '-q'], { cwd: main });
    execFileSync('git', ['config', 'user.email', 'phantom@example.invalid'], { cwd: main });
    execFileSync('git', ['config', 'user.name', 'Phantom Test'], { cwd: main });
    fs.writeFileSync(path.join(main, 'index.ts'), '// main\n');
    execFileSync('git', ['add', 'index.ts'], { cwd: main });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: main });
    execFileSync('git', ['worktree', 'add', '-qb', 'linked-test', worktree], { cwd: main });
    execFileSync(process.execPath, [STATE, 'start', '--workspace', worktree,
      '--task', 'WORKTREE-1', '--intent', 'Test linked worktree routing', '--route', 'direct'], { env });
    assertAllow(runGate(env, editPayload(path.join(worktree, 'index.ts'), worktree)));
  } finally {
    try { execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: main }); } catch (_) {}
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
    fs.rmSync(linked, { recursive: true, force: true });
  }
});

test('remote-backed linked worktree does not unlock a sibling checkout', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-data-'));
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-main-'));
  const linked = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-linked-parent-'));
  const worktree = path.join(linked, 'worktree');
  const env = { ...process.env, PHANTOM_DATA: data, PHANTOM_ROUTING_ENFORCE: '1' };
  try {
    execFileSync('git', ['init', '-q'], { cwd: main });
    execFileSync('git', ['config', 'user.email', 'phantom@example.invalid'], { cwd: main });
    execFileSync('git', ['config', 'user.name', 'Phantom Test'], { cwd: main });
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/phantom/routing.git'], { cwd: main });
    fs.writeFileSync(path.join(main, 'index.ts'), '// main\n');
    execFileSync('git', ['add', 'index.ts'], { cwd: main });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: main });
    execFileSync('git', ['worktree', 'add', '-qb', 'linked-test', worktree], { cwd: main });
    execFileSync(process.execPath, [STATE, 'start', '--workspace', worktree,
      '--task', 'WORKTREE-REMOTE-1', '--intent', 'Test remote worktree routing', '--route', 'direct'], { env });
    assertAllow(runGate(env, editPayload(path.join(worktree, 'index.ts'), worktree)));
    assertDeny(runGate(env, editPayload(path.join(main, 'index.ts'), main)));
  } finally {
    try { execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: main }); } catch (_) {}
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
    fs.rmSync(linked, { recursive: true, force: true });
  }
});
