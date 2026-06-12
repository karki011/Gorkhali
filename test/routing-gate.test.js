// Author: Subash Karki
// routing-gate.test.js — proves the routing gate's INVERSE polarity: an opt-in
// discipline gate that fails OPEN. Only routing.enforce: true arms it; it
// covers only phantom-known repos; PHANTOM_ADHOC=1 bypasses with a logged
// line; any ambiguity (no target, non-repo, unknown repo) allows.
//
// Spawns the REAL hook process. Env is read at INVOCATION time, so every
// spawn pins PHANTOM_DATA to a tmpdir AND PHANTOM_CONFIG to a controlled
// file — this dev machine has a legacy ~/.claude/phantom/config.yaml that
// would otherwise win resolution.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'routing-gate.js');

function runGate(envOverrides, stdinText) {
  const env = { ...process.env, ...envOverrides };
  delete env.PHANTOM_ADHOC; // never inherit from the outer session
  if (envOverrides.PHANTOM_ADHOC) env.PHANTOM_ADHOC = envOverrides.PHANTOM_ADHOC;
  try {
    const stdout = execFileSync('node', [HOOK], {
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
  const cfg = path.join(data, 'test-config.yaml');
  fs.writeFileSync(cfg, `routing:\n  enforce: ${enforce}\n`);

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
    env: { PHANTOM_DATA: data, PHANTOM_CONFIG: cfg },
    cleanup: () => {
      fs.rmSync(data, { recursive: true, force: true });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    },
  };
}

function editPayload(target, cwd) {
  return JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: target }, cwd });
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

test('3. enforce: true + repo NOT phantom-known → ALLOW', () => {
  const { env, repoRoot, target, cleanup } = setup({ known: false });
  try {
    assertAllow(runGate(env, editPayload(target, repoRoot)),
      'the gate covers only phantom-known repos');
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

test('5. fresh .apex-active → allow (phantom session is live)', () => {
  const { data, env, repoRoot, target, cleanup } = setup();
  try {
    fs.writeFileSync(path.join(data, '.apex-active'), '');
    assertAllow(runGate(env, editPayload(target, repoRoot)));
  } finally {
    cleanup();
  }
});

test('6. STALE .apex-active (25h) → deny (crashed session must not disable the gate)', () => {
  const { data, env, repoRoot, target, cleanup } = setup();
  try {
    const marker = path.join(data, '.apex-active');
    fs.writeFileSync(marker, '');
    const old = (Date.now() - 25 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(marker, old, old);
    assertDeny(runGate(env, editPayload(target, repoRoot)));
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
