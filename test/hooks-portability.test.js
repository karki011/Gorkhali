// Author: Subash Karki
// hooks-portability.test.js — every command in hooks/hooks.json must be a
// silent no-op on hosts that never export CLAUDE_PLUGIN_ROOT (e.g. codex),
// and must still execute normally, with the hook's own exit code passing
// through untouched, when the variable IS set.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const HOOKS_JSON_PATH = path.join(REPO_ROOT, 'hooks', 'hooks.json');
const GUARD_PREFIX = '[ -n "${CLAUDE_PLUGIN_ROOT:-}" ] || exit 0; exec ';

function allCommands() {
  const doc = JSON.parse(fs.readFileSync(HOOKS_JSON_PATH, 'utf-8'));
  const commands = [];
  for (const [eventName, entries] of Object.entries(doc.hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks) {
        commands.push({ eventName, matcher: entry.matcher, command: hook.command });
      }
    }
  }
  return commands;
}

function envWithoutPluginRoot() {
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_ROOT;
  return env;
}

test('every hook command is guarded with the CLAUDE_PLUGIN_ROOT no-op prefix', () => {
  const commands = allCommands();
  assert.ok(commands.length > 0, 'expected at least one hook command');
  for (const { eventName, matcher, command } of commands) {
    assert.ok(
      command.startsWith(GUARD_PREFIX),
      `${eventName} (matcher "${matcher}") command is not guarded: ${command}`
    );
  }
});

test('every hook command silently no-ops when CLAUDE_PLUGIN_ROOT is unset', () => {
  const commands = allCommands();
  const env = envWithoutPluginRoot();
  for (const { eventName, matcher, command } of commands) {
    const result = spawnSync('sh', ['-c', command], {
      env,
      input: '',
      encoding: 'utf-8',
    });
    assert.equal(
      result.status,
      0,
      `${eventName} (matcher "${matcher}") did not exit 0 without CLAUDE_PLUGIN_ROOT: ${command}`
    );
    assert.equal(
      result.stdout,
      '',
      `${eventName} (matcher "${matcher}") produced stdout without CLAUDE_PLUGIN_ROOT: ${command}`
    );
    assert.equal(
      result.stderr,
      '',
      `${eventName} (matcher "${matcher}") produced stderr without CLAUDE_PLUGIN_ROOT: ${command}`
    );
  }
});

test('a guarded command still runs the underlying hook when CLAUDE_PLUGIN_ROOT is set', () => {
  const commands = allCommands();
  const memoryReader = commands.find((c) => c.command.includes('memory-reader.js'));
  assert.ok(memoryReader, 'expected a memory-reader.js command in hooks.json');

  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT };
  const result = spawnSync('sh', ['-c', memoryReader.command], {
    env,
    input: '{}',
    encoding: 'utf-8',
  });
  assert.equal(
    result.status,
    0,
    `memory-reader.js did not exit 0 with CLAUDE_PLUGIN_ROOT set: ${result.stderr}`
  );
});

test('a guarded command survives a plugin root path containing a space', () => {
  const commands = allCommands();
  const memoryReader = commands.find((c) => c.command.includes('memory-reader.js'));
  assert.ok(memoryReader, 'expected a memory-reader.js command in hooks.json');

  const spacedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali space test'));
  try {
    fs.cpSync(path.join(REPO_ROOT, 'hooks'), path.join(spacedRoot, 'hooks'), { recursive: true });

    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: spacedRoot };
    const result = spawnSync('sh', ['-c', memoryReader.command], {
      env,
      input: '{}',
      encoding: 'utf-8',
    });
    assert.equal(
      result.status,
      0,
      `memory-reader.js did not exit 0 with a spaced CLAUDE_PLUGIN_ROOT: ${result.stderr}`
    );
  } finally {
    fs.rmSync(spacedRoot, { recursive: true, force: true });
  }
});
