// Author: Subash Karki
// observation-writer.test.js — PostToolUse lean capture: touched paths on
// Edit, observations jsonl only on failed Bash, silence on success.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'observation-writer.js');

function run(env, payload) {
  execFileSync('node', [HOOK], {
    input: JSON.stringify(payload),
    env,
    encoding: 'utf-8',
  });
}

function setup() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-data-'));
  return {
    env: { ...process.env, GORKHALI_DATA: data, GORKHALI_REPO: 'obs-test-repo' },
    data,
    cleanup: () => fs.rmSync(data, { recursive: true, force: true }),
  };
}

test('Edit records a touched path and writes no observations', () => {
  const { env, data, cleanup } = setup();
  try {
    run(env, {
      session_id: 's1',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/components/Pay.tsx' },
    });
    const touched = path.join(data, 'state', 'memory-touched', 's1');
    assert.equal(fs.readFileSync(touched, 'utf-8').trim(), 'src/components/Pay.tsx');
    const obs = path.join(data, 'observations');
    assert.equal(fs.existsSync(obs), false);
  } finally {
    cleanup();
  }
});

test('successful Bash writes nothing', () => {
  const { env, data, cleanup } = setup();
  try {
    run(env, {
      session_id: 's2',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test' },
      tool_response: { exitCode: 0 },
    });
    assert.equal(fs.existsSync(path.join(data, 'observations')), false);
  } finally {
    cleanup();
  }
});

test('failed Bash appends one observations jsonl line', () => {
  const { env, data, cleanup } = setup();
  try {
    run(env, {
      session_id: 's3',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test' },
      tool_response: { exitCode: 1 },
    });
    const dir = path.join(data, 'observations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    assert.equal(files.length, 1);
    const line = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8').trim());
    assert.equal(line.tool, 'Bash');
    assert.equal(line.exitCode, 1);
    assert.equal(line.session, 's3');
    assert.equal(line.command, 'pnpm test');
  } finally {
    cleanup();
  }
});

test('failed Bash redacts assignment-like secrets in the command', () => {
  const { env, data, cleanup } = setup();
  try {
    run(env, {
      session_id: 's4',
      tool_name: 'Bash',
      tool_input: { command: 'export API_TOKEN=supersecret pnpm test' },
      tool_response: { exitCode: 1 },
    });
    const dir = path.join(data, 'observations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    assert.equal(files.length, 1);
    const line = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8').trim());
    assert.equal(line.command.includes('supersecret'), false);
    assert.match(line.command, /API_TOKEN=\*\*\*/);
  } finally {
    cleanup();
  }
});

test('failed Bash redacts URL userinfo in the command', () => {
  const { env, data, cleanup } = setup();
  try {
    run(env, {
      session_id: 's5',
      tool_name: 'Bash',
      tool_input: { command: 'curl https://user:s3cret@example.com/x' },
      tool_response: { exitCode: 1 },
    });
    const dir = path.join(data, 'observations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    assert.equal(files.length, 1);
    const line = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8').trim());
    assert.equal(line.command.includes('s3cret'), false);
    assert.match(line.command, /:\/\/\*\*\*:\*\*\*@/);
  } finally {
    cleanup();
  }
});
