// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'engineer-marker-state.js');
const LAW = path.join(ROOT, 'hooks', 'chief-subagent-driven-law.sh');
const MODEL_GATE = path.join(ROOT, 'hooks', 'engineer-model-gate.js');
const HOOKS = path.join(ROOT, 'hooks', 'hooks.json');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engineer-marker-'));
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
    env: { ...process.env, GORKHALI_DATA: fixture.data, GORKHALI_REPO: 'repo-a', ...extraEnv },
  });
}

function markerDir(fixture, repo = 'repo-a') {
  return path.join(fixture.data, '.engineer-editing.d', repo);
}

function markerNames(fixture, repo) {
  try { return fs.readdirSync(markerDir(fixture, repo)).sort(); } catch (_) { return []; }
}

function activateLaw(fixture) {
  fs.mkdirSync(fixture.data, { recursive: true });
  fs.writeFileSync(path.join(fixture.data, '.chief-active'), '');
}

function runLaw(fixture, payload, extraEnv = {}) {
  return spawnSync('bash', [LAW], {
    cwd: fixture.repo,
    input: JSON.stringify({ cwd: fixture.repo, tool_name: 'Edit', tool_input: { file_path: path.join(fixture.repo, 'a.js') }, ...payload }),
    encoding: 'utf8',
    env: { ...process.env, GORKHALI_DATA: fixture.data, GORKHALI_REPO: 'repo-a', GORKHALI_AUDIT_DIR: path.join(fixture.data, 'audit'), ...extraEnv },
  });
}

test('hooks register marker lifecycle on SubagentStart and SubagentStop', () => {
  const hooks = JSON.parse(fs.readFileSync(HOOKS, 'utf8')).hooks;
  const startCommand = hooks.SubagentStart[0].hooks.find((h) => h.command.includes('engineer-marker-state.js')).command;
  const stopCommand = hooks.SubagentStop[0].hooks.find((h) => h.command.includes('engineer-marker-state.js')).command;
  assert.equal(
    startCommand,
    '[ -n "${CLAUDE_PLUGIN_ROOT:-}" ] || exit 0; exec node "${CLAUDE_PLUGIN_ROOT}/hooks/engineer-marker-state.js" start'
  );
  assert.equal(
    stopCommand,
    '[ -n "${CLAUDE_PLUGIN_ROOT:-}" ] || exit 0; exec node "${CLAUDE_PLUGIN_ROOT}/hooks/engineer-marker-state.js" stop'
  );
});

test('concurrent Engineer and Steward starts get independent markers', () => {
  const f = sandbox();
  try {
    runHook('start', { agent_id: 'a1', agent_type: 'engineer-varek', session_id: 's1' }, f);
    runHook('start', { agent_id: 'a2', agent_type: 'steward-ordwin', session_id: 's1' }, f);
    assert.deepEqual(markerNames(f), ['a1', 'a2']);
    const marker = JSON.parse(fs.readFileSync(path.join(markerDir(f), 'a1'), 'utf8'));
    assert.equal(marker.name, 'engineer-varek');
    assert.equal(marker.sessionId, 's1');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('read-only Engineer-typed scout and other agents never create markers', () => {
  const f = sandbox();
  try {
    for (const agent_type of ['scout-wrennick', 'inspector-yarnell', 'auditor-ledgard', 'clerk-ledgett']) {
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
      'council-ostrem', 'council-pellam', 'council-rendal', 'council-senwick',
      'council-tarvel', 'council-chairman',
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
        tool_input: { subagent_type: 'engineer', name: 'engineer-varek' },
      }),
      encoding: 'utf8',
      env: { ...process.env, GORKHALI_DATA: f.data, GORKHALI_REPO: 'repo-a' },
    });
    assert.match(denied.stdout, /permissionDecision[^}]*deny/);
    assert.deepEqual(markerNames(f), []);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('exact id cleanup leaves concurrent sibling marker active', () => {
  const f = sandbox();
  try {
    runHook('start', { agent_id: 'a1', agent_type: 'engineer-varek', session_id: 's1' }, f);
    runHook('start', { agent_id: 'a2', agent_type: 'engineer-varek', session_id: 's1' }, f);
    runHook('stop', { agent_id: 'a1', agent_type: 'engineer-varek', session_id: 's1' }, f);
    assert.deepEqual(markerNames(f), ['a2']);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('ID-less and unknown-ID stops are no-ops', () => {
  const f = sandbox();
  try {
    runHook('start', { agent_id: 'a1', agent_type: 'engineer-varek', session_id: 's1' }, f);
    runHook('stop', { agent_type: 'engineer-varek', session_id: 's1' }, f);
    assert.deepEqual(markerNames(f), ['a1']);
    runHook('stop', { agent_id: 'unknown', agent_type: 'engineer-varek', session_id: 's1' }, f);
    assert.deepEqual(markerNames(f), ['a1']);
    const malformed = path.join(markerDir(f), 'bad-id');
    fs.writeFileSync(malformed, '{not-json');
    runHook('stop', { agent_id: 'bad-id', agent_type: 'engineer-varek', session_id: 's1' }, f);
    assert.equal(fs.existsSync(malformed), true, 'invalid exact-ID marker must not be deleted');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('delayed ID-less old stop cannot clear a same-named replacement marker', () => {
  const f = sandbox();
  try {
    runHook('start', { agent_id: 'old-id', agent_type: 'engineer-varek', session_id: 's1' }, f);
    runHook('stop', { agent_id: 'old-id', agent_type: 'engineer-varek', session_id: 's1' }, f);
    runHook('start', { agent_id: 'replacement-id', agent_type: 'engineer-varek', session_id: 's1' }, f);
    runHook('stop', { agent_type: 'engineer-varek', session_id: 's1' }, f);
    assert.deepEqual(markerNames(f), ['replacement-id']);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('law requires fresh marker for the same repo and session', () => {
  const f = sandbox();
  try {
    activateLaw(f);
    runHook('start', { agent_id: 'a1', agent_type: 'engineer-varek', session_id: 's1' }, f);
    assert.equal(runLaw(f, { session_id: 's1' }).status, 0);
    assert.equal(runLaw(f, { session_id: 's2' }).status, 2);
    assert.equal(runLaw(f, { session_id: 's1' }, { GORKHALI_REPO: 'repo-b' }).status, 2);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('stale markers fail closed without being deleted', () => {
  const f = sandbox();
  try {
    activateLaw(f);
    runHook('start', { agent_id: 'a1', agent_type: 'engineer-varek', session_id: 's1' }, f, { GORKHALI_MARKER_FRESHNESS_MS: '10' });
    const file = path.join(markerDir(f), 'a1');
    fs.utimesSync(file, new Date(0), new Date(0));
    assert.equal(runLaw(f, { session_id: 's1' }, { GORKHALI_MARKER_FRESHNESS_MS: '10' }).status, 2);
    assert.equal(fs.existsSync(file), true);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('malformed marker state cannot open the Chief edit gate', () => {
  const f = sandbox();
  try {
    activateLaw(f);
    fs.mkdirSync(markerDir(f), { recursive: true });
    fs.writeFileSync(path.join(markerDir(f), 'a1'), '{not-json');
    assert.equal(runLaw(f, { session_id: 's1' }).status, 2);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('legacy .apex-active sentinel (pre-rename filename) activates the law like .chief-active', () => {
  // .apex-active is the marker's filename before the apex->chief rename; a
  // not-yet-upgraded install may still write it. The law must treat it as
  // equivalent to .chief-active, not just skip enforcement entirely.
  const f = sandbox();
  try {
    fs.mkdirSync(f.data, { recursive: true });
    fs.writeFileSync(path.join(f.data, '.apex-active'), '');
    runHook('start', { agent_id: 'a1', agent_type: 'engineer-varek', session_id: 's1' }, f);
    assert.equal(runLaw(f, { session_id: 's1' }).status, 0, 'fresh engineer marker allows the edit');
    assert.equal(runLaw(f, { session_id: 's2' }).status, 2, 'a different session is still blocked');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('legacy global marker is honored only while fresh', () => {
  const f = sandbox();
  try {
    activateLaw(f);
    const legacy = path.join(f.data, '.engineer-editing');
    fs.writeFileSync(legacy, '');
    assert.equal(runLaw(f, { session_id: 's1' }).status, 0);
    fs.utimesSync(legacy, new Date(0), new Date(0));
    assert.equal(runLaw(f, { session_id: 's1' }).status, 2);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('pre-rename .blade-editing global marker is honored only while fresh', () => {
  // .blade-editing is this marker's filename before the blade->engineer
  // rename; a not-yet-upgraded install may still write it. legacyActive()
  // must treat it as equivalent to .engineer-editing, not just skip
  // enforcement entirely.
  const f = sandbox();
  try {
    activateLaw(f);
    const legacy = path.join(f.data, '.blade-editing');
    fs.writeFileSync(legacy, '');
    assert.equal(runLaw(f, { session_id: 's1' }).status, 0, 'fresh pre-rename marker allows the edit');
    fs.utimesSync(legacy, new Date(0), new Date(0));
    assert.equal(runLaw(f, { session_id: 's1' }).status, 2, 'stale pre-rename marker fails closed');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('pre-rename .blade-editing.d per-agent marker is visible to a fresh preflight-style check', () => {
  // .blade-editing.d/<repo> is the per-agent marker dir before the rename
  // (mirrors .blade-editing above). A still-running old Blade must be
  // visible to freshMarkers()/the law, not silently invisible because only
  // the new .engineer-editing.d namespace was read.
  const f = sandbox();
  try {
    activateLaw(f);
    const legacyDir = path.join(f.data, '.blade-editing.d', 'repo-a');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'old-a1'), JSON.stringify({
      id: 'old-a1',
      name: 'engineer-varek',
      sessionId: 's1',
      repo: 'repo-a',
      startedAt: new Date().toISOString(),
    }) + '\n');
    assert.equal(runLaw(f, { session_id: 's1' }).status, 0, 'fresh pre-rename per-agent marker allows the same session');
    assert.equal(runLaw(f, { session_id: 's2' }).status, 2, 'a different session is still blocked');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});
