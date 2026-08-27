// Author: Subash Karki
// memory-reader.test.js — proves the per-session injection dedup: a first prompt
// injects available learnings, a second prompt in the SAME session does not
// re-inject those same entries, a different session_id injects fresh, malformed
// stdin exits 0 silently, and a payload with NO session_id skips dedup entirely
// (repeat runs keep injecting, and no shared 'unknown' marker file is written).
//
// Spawns the REAL hook process (subprocess seam pattern from
// test/router-nudge.test.js:21-72). Each spawn pins GORKHALI_DATA to a tmpdir and
// GORKHALI_REPO to a fixed id so learningsDir() resolves to fixture content we
// control, independent of this repo's own learnings.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'memory-reader.js');
const REPO = 'memory-reader-test-repo';

function runHook(env, stdinText) {
  try {
    const stdout = execFileSync('node', [HOOK], { input: stdinText, env, encoding: 'utf-8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : -1, stdout: (e.stdout || '').toString() };
  }
}

function setup() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-data-'));
  const learnings = path.join(data, 'repos', REPO, 'learnings');
  fs.mkdirSync(learnings, { recursive: true });
  fs.writeFileSync(path.join(learnings, 'INDEX.md'), '# Learnings Index\n');
  fs.writeFileSync(
    path.join(learnings, 'shadows.md'),
    'LEARNING [alpha]: Entry Alpha describes a stable pattern worth remembering for tests (2026-01-01)\n' +
    'LEARNING [beta]: Entry Beta describes a second stable pattern worth remembering for tests (2026-01-01)\n'
  );
  return {
    env: { ...process.env, GORKHALI_DATA: data, GORKHALI_REPO: REPO },
    cleanup: () => fs.rmSync(data, { recursive: true, force: true }),
  };
}

function payload(sessionId) {
  return JSON.stringify({ prompt: 'please summarize the quarterly numbers for finance review', session_id: sessionId });
}

function payloadNoSessionId() {
  return JSON.stringify({ prompt: 'please summarize the quarterly numbers for finance review' });
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
    ...(options.updatedAt ? { updated_at: options.updatedAt } : {}),
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

function findCitedFiles(root) {
  const hits = [];
  const walk = (dir) => {
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of names) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'learnings-cited.json') hits.push(full);
    }
  };
  walk(root);
  return hits;
}

test('1. first prompt injects available learnings', () => {
  const { env, cleanup } = setup();
  try {
    const res = runHook(env, payload('session-1'));
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Entry Alpha/);
    assert.match(res.stdout, /Entry Beta/);
  } finally {
    cleanup();
  }
});

test('2. second prompt, same session_id → same entries not re-injected', () => {
  const { env, cleanup } = setup();
  try {
    const first = runHook(env, payload('session-2'));
    assert.match(first.stdout, /Entry Alpha/);
    const second = runHook(env, payload('session-2'));
    assert.equal(second.code, 0);
    assert.equal(second.stdout.trim(), '', 'no new entries remain to inject this session');
  } finally {
    cleanup();
  }
});

test('3. different session_id injects fresh, independent of session-2 markers', () => {
  const { env, cleanup } = setup();
  try {
    runHook(env, payload('session-3a'));
    const other = runHook(env, payload('session-3b'));
    assert.equal(other.code, 0);
    assert.match(other.stdout, /Entry Alpha/);
    assert.match(other.stdout, /Entry Beta/);
  } finally {
    cleanup();
  }
});

test('4. malformed stdin → exit 0 silently', () => {
  const { env, cleanup } = setup();
  try {
    const res = runHook(env, '{{{not json');
    assert.equal(res.code, 0);
    assert.equal(res.stdout.trim(), '');
  } finally {
    cleanup();
  }
});

test('5. no session_id → dedup skipped entirely, no shared "unknown" marker', () => {
  const { env, cleanup } = setup();
  try {
    const first = runHook(env, payloadNoSessionId());
    assert.equal(first.code, 0);
    assert.match(first.stdout, /Entry Alpha/);
    assert.match(first.stdout, /Entry Beta/);

    const second = runHook(env, payloadNoSessionId());
    assert.equal(second.code, 0);
    assert.match(second.stdout, /Entry Alpha/, 'no session_id means no dedup — every run injects');
    assert.match(second.stdout, /Entry Beta/);

    const markerDir = path.join(env.GORKHALI_DATA, 'state', 'memory-injected');
    if (fs.existsSync(markerDir)) {
      assert.equal(
        fs.readdirSync(markerDir).includes('unknown'),
        false,
        'no shared "unknown" marker file should be written for id-less sessions'
      );
    }
  } finally {
    cleanup();
  }
});

test('6. a touched source path injects that domain, not every file', () => {
  const { env, cleanup } = setup();
  try {
    const data = env.GORKHALI_DATA;
    const learnings = path.join(data, 'repos', REPO, 'learnings');
    fs.writeFileSync(
      path.join(learnings, 'ui.md'),
      'CORRECTION [chakra-toast]: [used window.alert] - [use the toast helper] [failed] (2026-08-01)\n',
    );
    fs.writeFileSync(
      path.join(learnings, 'workflow.md'),
      'CORRECTION [secret-workflow]: [this must not leak into a ui edit] - [keep domains split] [failed] (2026-08-01)\n',
    );
    const sid = 'session-path';
    const touchedDir = path.join(data, 'state', 'memory-touched');
    fs.mkdirSync(touchedDir, { recursive: true });
    fs.writeFileSync(path.join(touchedDir, sid), 'apps/dashboard/src/components/Pay.tsx\n');

    const res = runHook(env, JSON.stringify({
      prompt: 'continue the payment work',
      session_id: sid,
    }));
    assert.equal(res.code, 0);
    assert.match(res.stdout, /chakra-toast/);
    assert.doesNotMatch(res.stdout, /secret-workflow/);
  } finally {
    cleanup();
  }
});

test('7. missing domain file falls back to INDEX one-liners, not every domain file', () => {
  const { env, cleanup } = setup();
  try {
    const learnings = path.join(env.GORKHALI_DATA, 'repos', REPO, 'learnings');
    fs.writeFileSync(
      path.join(learnings, 'INDEX.md'),
      '# Learnings Index\n\n- workflow.md — grep-count-exit [failed]\n',
    );
    fs.writeFileSync(
      path.join(learnings, 'workflow.md'),
      'Subash, preamble that must not be injected.\n\nCORRECTION [grep-count-exit]: [wrote grep -c] - [use ! grep -q] [failed] (2026-07-07)\n',
    );
    const res = runHook(env, JSON.stringify({
      prompt: 'fix the react component css layout',
      session_id: 'session-index-fallback',
    }));
    assert.equal(res.code, 0);
    assert.match(res.stdout, /grep-count-exit/);
    assert.doesNotMatch(res.stdout, /preamble that must not/);
  } finally {
    cleanup();
  }
});

test('8. active portable session: first prompt writes sidecar keywords and merges onto context.json', () => {
  const { env, cleanup } = setup();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ws-'));
  try {
    const cwd = fs.realpathSync(repoRoot);
    const { sessionDir } = writePortableSession(env.GORKHALI_DATA, repoRoot, 'active', {
      repo: REPO,
      workspace: cwd,
    });
    fs.writeFileSync(path.join(sessionDir, 'context.json'), JSON.stringify({
      ticket: 'TEST-1', summary: 'fixture', source: 'args',
    }));
    const res = runHook(env, JSON.stringify({
      prompt: 'please summarize the quarterly numbers for finance review',
      session_id: 'session-cite',
      cwd,
    }));
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Entry Alpha/);
    assert.match(res.stdout, /Entry Beta/);
    const sidecar = JSON.parse(fs.readFileSync(path.join(sessionDir, 'learnings-cited.json'), 'utf8'));
    assert.deepEqual(sidecar.learningsCited, ['alpha', 'beta']);
    const context = JSON.parse(fs.readFileSync(path.join(sessionDir, 'context.json'), 'utf8'));
    assert.deepEqual(context.learningsCited, ['alpha', 'beta']);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    cleanup();
  }
});

test('9. no active session → injection still happens, no sidecar written', () => {
  const { env, cleanup } = setup();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ws-'));
  try {
    const cwd = fs.realpathSync(repoRoot);
    const res = runHook(env, JSON.stringify({
      prompt: 'please summarize the quarterly numbers for finance review',
      session_id: 'session-no-cite',
      cwd,
    }));
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Entry Alpha/);
    assert.deepEqual(findCitedFiles(env.GORKHALI_DATA), []);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    cleanup();
  }
});

test('10. citation write failure must not suppress injection', () => {
  const { env, cleanup } = setup();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ws-'));
  try {
    const cwd = fs.realpathSync(repoRoot);
    const { sessionDir } = writePortableSession(env.GORKHALI_DATA, repoRoot, 'active', {
      repo: REPO,
      workspace: cwd,
    });
    fs.mkdirSync(path.join(sessionDir, 'learnings-cited.json'));
    const res = runHook(env, JSON.stringify({
      prompt: 'please summarize the quarterly numbers for finance review',
      session_id: 'session-cite-fail',
      cwd,
    }));
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Entry Alpha/);
    assert.match(res.stdout, /Entry Beta/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    cleanup();
  }
});
