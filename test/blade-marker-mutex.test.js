// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'blade-marker-state.js');
const LAW = path.join(ROOT, 'hooks', 'apex-subagent-driven-law.sh');
const MODEL_GATE = path.join(ROOT, 'hooks', 'blade-model-gate.js');
const HOOKS = path.join(ROOT, 'hooks', 'hooks.json');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blade-marker-'));
  const repo = path.join(dir, 'repo');
  const data = path.join(dir, 'data');
  fs.mkdirSync(repo, { recursive: true });
  return { dir, repo, data };
}

function runHook(mode, payload, fixture, extraEnv = {}) {
  return spawnSync('node', [HOOK, mode], {
    cwd: fixture.repo,
    input: JSON.stringify({ cwd: fixture.repo, ...payload }),
    encoding: 'utf8',
    env: { ...process.env, PHANTOM_DATA: fixture.data, PHANTOM_REPO: 'repo-a', ...extraEnv },
  });
}

function markerDir(fixture, repo = 'repo-a') {
  return path.join(fixture.data, '.blade-editing.d', repo);
}

function markerNames(fixture, repo) {
  try { return fs.readdirSync(markerDir(fixture, repo)).sort(); } catch (_) { return []; }
}

function activateLaw(fixture) {
  fs.mkdirSync(fixture.data, { recursive: true });
  fs.writeFileSync(path.join(fixture.data, '.apex-active'), '');
}

function runLaw(fixture, payload, extraEnv = {}) {
  return spawnSync('bash', [LAW], {
    cwd: fixture.repo,
    input: JSON.stringify({ cwd: fixture.repo, tool_name: 'Edit', tool_input: { file_path: path.join(fixture.repo, 'a.js') }, ...payload }),
    encoding: 'utf8',
    env: { ...process.env, PHANTOM_DATA: fixture.data, PHANTOM_REPO: 'repo-a', PHANTOM_AUDIT_DIR: path.join(fixture.data, 'audit'), ...extraEnv },
  });
}

test('hooks register marker lifecycle on SubagentStart and SubagentStop', () => {
  const hooks = JSON.parse(fs.readFileSync(HOOKS, 'utf8')).hooks;
  assert.match(JSON.stringify(hooks.SubagentStart), /blade-marker-state\.js start/);
  assert.match(JSON.stringify(hooks.SubagentStop), /blade-marker-state\.js stop/);
});

test('concurrent Blade and Sweep starts get independent markers', () => {
  const f = sandbox();
  try {
    runHook('start', { agent_id: 'a1', agent_type: 'blade-kaze', session_id: 's1' }, f);
    runHook('start', { agent_id: 'a2', agent_type: 'sweep-nix', session_id: 's1' }, f);
    assert.deepEqual(markerNames(f), ['a1', 'a2']);
    const marker = JSON.parse(fs.readFileSync(path.join(markerDir(f), 'a1'), 'utf8'));
    assert.equal(marker.name, 'blade-kaze');
    assert.equal(marker.sessionId, 's1');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('read-only Blade-typed scout and other agents never create markers', () => {
  const f = sandbox();
  try {
    for (const agent_type of ['scout-quorra', 'ward-brann', 'lens-yara', 'gaze-elden', 'warden-gorath']) {
      runHook('start', { agent_id: agent_type, agent_type, session_id: 's1' }, f);
    }
    assert.deepEqual(markerNames(f), []);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('all reasoning-only Council names create no edit marker', () => {
  const f = sandbox();
  try {
    const names = [
      'council-mvp', 'council-risk', 'council-user', 'council-reuse', 'council-simple',
      'council-kirran', 'council-mossa', 'council-ellow', 'council-tavric',
      'council-sorne', 'council-chairman',
    ];
    names.forEach((agent_type, index) => {
      runHook('start', { agent_id: `council-${index}`, agent_type, session_id: 's1' }, f);
    });
    assert.deepEqual(markerNames(f), []);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('a spawn denied before SubagentStart never creates a marker', () => {
  const f = sandbox();
  try {
    const denied = spawnSync('node', [MODEL_GATE], {
      cwd: f.repo,
      input: JSON.stringify({
        cwd: f.repo,
        tool_name: 'Agent',
        tool_input: { subagent_type: 'blade', name: 'blade-kaze' },
      }),
      encoding: 'utf8',
      env: { ...process.env, PHANTOM_DATA: f.data, PHANTOM_REPO: 'repo-a' },
    });
    assert.match(denied.stdout, /permissionDecision[^}]*deny/);
    assert.deepEqual(markerNames(f), []);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('exact id cleanup leaves concurrent sibling marker active', () => {
  const f = sandbox();
  try {
    runHook('start', { agent_id: 'a1', agent_type: 'blade-kaze', session_id: 's1' }, f);
    runHook('start', { agent_id: 'a2', agent_type: 'blade-kaze', session_id: 's1' }, f);
    runHook('stop', { agent_id: 'a1', agent_type: 'blade-kaze', session_id: 's1' }, f);
    assert.deepEqual(markerNames(f), ['a2']);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('ID-less and unknown-ID stops are no-ops', () => {
  const f = sandbox();
  try {
    runHook('start', { agent_id: 'a1', agent_type: 'blade-kaze', session_id: 's1' }, f);
    runHook('stop', { agent_type: 'blade-kaze', session_id: 's1' }, f);
    assert.deepEqual(markerNames(f), ['a1']);
    runHook('stop', { agent_id: 'unknown', agent_type: 'blade-kaze', session_id: 's1' }, f);
    assert.deepEqual(markerNames(f), ['a1']);
    const malformed = path.join(markerDir(f), 'bad-id');
    fs.writeFileSync(malformed, '{not-json');
    runHook('stop', { agent_id: 'bad-id', agent_type: 'blade-kaze', session_id: 's1' }, f);
    assert.equal(fs.existsSync(malformed), true, 'invalid exact-ID marker must not be deleted');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('delayed ID-less old stop cannot clear a same-named replacement marker', () => {
  const f = sandbox();
  try {
    runHook('start', { agent_id: 'old-id', agent_type: 'blade-kaze', session_id: 's1' }, f);
    runHook('stop', { agent_id: 'old-id', agent_type: 'blade-kaze', session_id: 's1' }, f);
    runHook('start', { agent_id: 'replacement-id', agent_type: 'blade-kaze', session_id: 's1' }, f);
    runHook('stop', { agent_type: 'blade-kaze', session_id: 's1' }, f);
    assert.deepEqual(markerNames(f), ['replacement-id']);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('law requires fresh marker for the same repo and session', () => {
  const f = sandbox();
  try {
    activateLaw(f);
    runHook('start', { agent_id: 'a1', agent_type: 'blade-kaze', session_id: 's1' }, f);
    assert.equal(runLaw(f, { session_id: 's1' }).status, 0);
    assert.equal(runLaw(f, { session_id: 's2' }).status, 2);
    assert.equal(runLaw(f, { session_id: 's1' }, { PHANTOM_REPO: 'repo-b' }).status, 2);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('stale markers fail closed without being deleted', () => {
  const f = sandbox();
  try {
    activateLaw(f);
    runHook('start', { agent_id: 'a1', agent_type: 'blade-kaze', session_id: 's1' }, f, { PHANTOM_MARKER_FRESHNESS_MS: '10' });
    const file = path.join(markerDir(f), 'a1');
    fs.utimesSync(file, new Date(0), new Date(0));
    assert.equal(runLaw(f, { session_id: 's1' }, { PHANTOM_MARKER_FRESHNESS_MS: '10' }).status, 2);
    assert.equal(fs.existsSync(file), true);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('malformed marker state cannot open the Apex edit gate', () => {
  const f = sandbox();
  try {
    activateLaw(f);
    fs.mkdirSync(markerDir(f), { recursive: true });
    fs.writeFileSync(path.join(markerDir(f), 'a1'), '{not-json');
    assert.equal(runLaw(f, { session_id: 's1' }).status, 2);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('legacy global marker is honored only while fresh', () => {
  const f = sandbox();
  try {
    activateLaw(f);
    const legacy = path.join(f.data, '.blade-editing');
    fs.writeFileSync(legacy, '');
    assert.equal(runLaw(f, { session_id: 's1' }).status, 0);
    fs.utimesSync(legacy, new Date(0), new Date(0));
    assert.equal(runLaw(f, { session_id: 's1' }).status, 2);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});
