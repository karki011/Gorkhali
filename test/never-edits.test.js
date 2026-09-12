// Author: Subash Karki
// never-edits.test.js - drives hooks/never-edits.js end to end through its
// own start/stop modes and its default PreToolUse decision, as a real child
// process (seam-integration pattern, the same pattern every hook test in
// this suite follows).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'never-edits.js');
const REPO = process.cwd();

function run(mode, input, dataDir) {
  const args = mode ? [HOOK, mode] : [HOOK];
  const env = { ...process.env, GORKHALI_DATA: dataDir, GORKHALI_REPO: 'test-repo' };
  try {
    const stdout = execFileSync('node', args, {
      input: JSON.stringify(input),
      env,
      encoding: 'utf-8',
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : -1, stdout: (e.stdout || '').toString() };
  }
}

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'never-edits-'));
}

function editPayload(sessionId, filePath) {
  return {
    tool_name: 'Edit',
    session_id: sessionId,
    cwd: REPO,
    tool_input: { file_path: filePath },
  };
}

function writePayload(sessionId, filePath) {
  return {
    tool_name: 'Write',
    session_id: sessionId,
    cwd: REPO,
    tool_input: { file_path: filePath },
  };
}

test('allows any edit when no gorkhali session is active', () => {
  const dataDir = tmpDataDir();
  const res = run(undefined, editPayload('s1', path.join(REPO, 'lib/paths.js')), dataDir);
  assert.equal(res.code, 0);
});

test('denies an Edit from the orchestrating session', () => {
  const dataDir = tmpDataDir();
  fs.writeFileSync(path.join(dataDir, '.session-active'), '');
  const res = run(undefined, editPayload('s1', path.join(REPO, 'lib/paths.js')), dataDir);
  assert.equal(res.code, 2);
});

test('allows an Edit while a subagent marker is live', () => {
  const dataDir = tmpDataDir();
  fs.writeFileSync(path.join(dataDir, '.session-active'), '');

  const startRes = run('start', {
    agent_id: 'a1',
    agent_type: 'engineer',
    session_id: 's1',
    cwd: REPO,
  }, dataDir);
  assert.equal(startRes.code, 0, 'start mode should exit 0');

  const marker = path.join(dataDir, 'editors', 'test-repo', 'a1');
  assert.ok(fs.existsSync(marker), 'start mode should write a marker file');

  const res = run(undefined, { ...editPayload('s1', path.join(REPO, 'lib/paths.js')), agent_id: 'a1' }, dataDir);
  assert.equal(res.code, 0);
});

test('denies once the subagent marker is cleared by stop mode', () => {
  const dataDir = tmpDataDir();
  fs.writeFileSync(path.join(dataDir, '.session-active'), '');

  run('start', { agent_id: 'a1', agent_type: 'engineer', session_id: 's1', cwd: REPO }, dataDir);
  const stopRes = run('stop', { agent_id: 'a1', cwd: REPO }, dataDir);
  assert.equal(stopRes.code, 0);

  const marker = path.join(dataDir, 'editors', 'test-repo', 'a1');
  assert.ok(!fs.existsSync(marker), 'stop mode should remove the marker file');

  const res = run(undefined, editPayload('s1', path.join(REPO, 'lib/paths.js')), dataDir);
  assert.equal(res.code, 2);
});

test('denies when a live marker matches a different session id', () => {
  const dataDir = tmpDataDir();
  fs.writeFileSync(path.join(dataDir, '.session-active'), '');

  run('start', { agent_id: 'a1', agent_type: 'engineer', session_id: 's1', cwd: REPO }, dataDir);
  const res = run(undefined, editPayload('other-session', path.join(REPO, 'lib/paths.js')), dataDir);
  assert.equal(res.code, 2);
});

test('allows an Edit whose target path resolves inside the session directory', () => {
  const dataDir = tmpDataDir();
  const sessionDir = path.join(dataDir, 'repos', 'test-repo', 'sessions', 'W1-T8');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, '.session-active'), JSON.stringify({
    repo: 'test-repo',
    task: 'W1-T8',
    sessionDir,
  }));

  const target = path.join(sessionDir, 'progress.json');
  const res = run(undefined, editPayload('s1', target), dataDir);
  assert.equal(res.code, 0);
});

test('allows an Edit to the preferences file under the data root, and still denies a project file, with an active session', () => {
  const dataDir = tmpDataDir();
  const sessionDir = path.join(dataDir, 'repos', 'test-repo', 'sessions', 'W1-T8');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, '.session-active'), JSON.stringify({
    repo: 'test-repo',
    task: 'W1-T8',
    sessionDir,
  }));

  const prefsPath = path.join(dataDir, 'repos', 'test-repo', 'preferences.md');
  const allowedRes = run(undefined, editPayload('s1', prefsPath), dataDir);
  assert.equal(allowedRes.code, 0);

  const deniedRes = run(undefined, writePayload('s1', path.join(REPO, 'lib/paths.js')), dataDir);
  assert.equal(deniedRes.code, 2);
});

test('another live Engineer never grants implementation edits to the lead or reviewer', () => {
  const dataDir = tmpDataDir();
  fs.writeFileSync(path.join(dataDir, '.session-active'), '');
  run('start', { agent_id: 'a1', agent_type: 'engineer', session_id: 's1', cwd: REPO }, dataDir);
  assert.equal(run(undefined, editPayload('s1', 'index.js'), dataDir).code, 2);
  assert.equal(run(undefined, { ...editPayload('s1', 'index.js'), agent_id: 'reviewer' }, dataDir).code, 2);
});

test('reviewer start cannot acquire an editor marker', () => {
  const dataDir = tmpDataDir();
  fs.writeFileSync(path.join(dataDir, '.session-active'), '');
  run('start', { agent_id: 'a1', agent_type: 'auditor', session_id: 's1', cwd: REPO }, dataDir);
  assert.equal(run(undefined, { ...editPayload('s1', 'index.js'), agent_id: 'a1' }, dataDir).code, 2);
});

test('lead Bash is restricted to the installed lifecycle entry point', () => {
  const dataDir = tmpDataDir();
  fs.writeFileSync(path.join(dataDir, '.session-active'), '');
  const bash = (command) => run(undefined, { tool_name: 'Bash', session_id: 's1', cwd: REPO, tool_input: { command } }, dataDir);
  const cli = path.join(REPO, 'lib', 'cli.js');
  assert.equal(bash(`node "${cli}" snapshot`).code, 0);
  assert.equal(bash(`node "${cli}" open MVP-1`).code, 0);
  assert.equal(bash(`node "${cli}" snapshot; touch index.js`).code, 2);
  assert.equal(bash('python -c "open(\'index.js\',\'w\').write(\'x\')"').code, 2);
  assert.equal(bash('echo x > index.js').code, 2);
});

test('a symlink under external state cannot authorize an implementation edit', () => {
  const dataDir = tmpDataDir();
  fs.writeFileSync(path.join(dataDir, '.session-active'), '');
  fs.symlinkSync(REPO, path.join(dataDir, 'escape'));
  assert.equal(run(undefined, writePayload('s1', path.join(dataDir, 'escape', 'package.json')), dataDir).code, 2);
});
