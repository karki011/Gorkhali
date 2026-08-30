// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'test-file-gate.js');

function runGate(envOverrides, stdinText) {
  const env = { ...process.env, ...envOverrides };
  delete env.GORKHALI_FIX_TESTS;
  if (envOverrides.GORKHALI_FIX_TESTS) env.GORKHALI_FIX_TESTS = envOverrides.GORKHALI_FIX_TESTS;
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

function setup() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tfg-data-'));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tfg-repo-'));
  fs.mkdirSync(path.join(repoRoot, '.git'));
  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'test'), { recursive: true });
  const source = path.join(repoRoot, 'src', 'index.ts');
  const testFile = path.join(repoRoot, 'test', 'index.test.ts');
  fs.writeFileSync(source, '// src\n');
  fs.writeFileSync(testFile, '// test\n');
  const repo = path.basename(repoRoot);
  const task = 'TEST-1';
  const sessionDir = path.join(data, 'repos', repo, 'sessions', task);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify({
    schema_version: 1,
    repo_id: repo,
    task_id: task,
    status: 'active',
    workspace: fs.realpathSync(repoRoot),
  }));
  const pointerDir = path.join(data, 'state', 'current-session');
  fs.mkdirSync(pointerDir, { recursive: true });
  fs.writeFileSync(path.join(pointerDir, `${repo}.json`), JSON.stringify({
    schema_version: 1,
    repo_id: repo,
    task_id: task,
    session_dir: sessionDir,
  }));
  return {
    data,
    repoRoot,
    source,
    testFile,
    sessionDir,
    env: { GORKHALI_DATA: data, GORKHALI_REPO: repo },
    cleanup: () => {
      fs.rmSync(data, { recursive: true, force: true });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    },
  };
}

function editPayload(target, cwd) {
  return JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: target }, cwd });
}

function assertAllow(res) {
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), '');
}

function assertDeny(res) {
  assert.equal(res.code, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /FIX GATE/);
}

test('no fix-active: test file edit allowed', () => {
  const ctx = setup();
  try {
    assertAllow(runGate(ctx.env, editPayload(ctx.testFile, ctx.repoRoot)));
  } finally {
    ctx.cleanup();
  }
});

test('fix-active: source edit allowed, test file denied', () => {
  const ctx = setup();
  try {
    fs.writeFileSync(path.join(ctx.sessionDir, 'fix-active'), '');
    assertAllow(runGate(ctx.env, editPayload(ctx.source, ctx.repoRoot)));
    assertDeny(runGate(ctx.env, editPayload(ctx.testFile, ctx.repoRoot)));
  } finally {
    ctx.cleanup();
  }
});

test('GORKHALI_FIX_TESTS=1 overrides and logs', () => {
  const ctx = setup();
  try {
    fs.writeFileSync(path.join(ctx.sessionDir, 'fix-active'), '');
    assertAllow(runGate(
      { ...ctx.env, GORKHALI_FIX_TESTS: '1' },
      editPayload(ctx.testFile, ctx.repoRoot),
    ));
    const log = path.join(ctx.data, 'state', 'fix-test-bypass.jsonl');
    assert.ok(fs.existsSync(log));
  } finally {
    ctx.cleanup();
  }
});

test('unparseable stdin allows', () => {
  const ctx = setup();
  try {
    assertAllow(runGate(ctx.env, 'not-json'));
  } finally {
    ctx.cleanup();
  }
});
