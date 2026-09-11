// Author: Subash Karki
// hooks-registration.test.js — hooks/hooks.json registers exactly the four
// entries the two lean hook programs need: never-edits.js on the Edit
// matcher plus SubagentStart/SubagentStop (one enforcement unit), and
// role-model-gate.js on Agent|Task. Every command must also stay a silent
// no-op on hosts that never export CLAUDE_PLUGIN_ROOT (e.g. codex).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
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

function targetFile(command) {
  const match = command.match(/hooks\/[a-z-]+\.[a-z]+/);
  return match ? match[0] : null;
}

function envWithoutPluginRoot() {
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_ROOT;
  return env;
}

test('hooks.json registers exactly four hook commands', () => {
  const commands = allCommands();
  assert.equal(commands.length, 4, JSON.stringify(commands, null, 2));
});

test('the four commands point at exactly two distinct target files, both present on disk', () => {
  const commands = allCommands();
  const files = new Set(commands.map((c) => targetFile(c.command)));
  assert.equal(files.size, 2, [...files].join(', '));
  for (const file of files) {
    assert.ok(file, 'every command must name a hooks/ target file');
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, file)),
      `${file} does not exist on disk`
    );
  }
});

test('SubagentStart and SubagentStop target the same file as the Edit matcher (never-edits enforcement unit)', () => {
  const doc = JSON.parse(fs.readFileSync(HOOKS_JSON_PATH, 'utf-8'));
  const editEntry = doc.hooks.PreToolUse.find((e) => e.matcher === 'Edit|Write|MultiEdit|NotebookEdit');
  assert.ok(editEntry, 'expected a PreToolUse entry for the Edit matcher');
  const editFile = targetFile(editEntry.hooks[0].command);

  const startFile = targetFile(doc.hooks.SubagentStart[0].hooks[0].command);
  const stopFile = targetFile(doc.hooks.SubagentStop[0].hooks[0].command);

  assert.equal(startFile, editFile);
  assert.equal(stopFile, editFile);
});

test('the Agent|Task matcher targets a different file than the Edit matcher', () => {
  const doc = JSON.parse(fs.readFileSync(HOOKS_JSON_PATH, 'utf-8'));
  const editEntry = doc.hooks.PreToolUse.find((e) => e.matcher === 'Edit|Write|MultiEdit|NotebookEdit');
  const agentEntry = doc.hooks.PreToolUse.find((e) => e.matcher === 'Agent|Task');
  assert.ok(agentEntry, 'expected a PreToolUse entry for the Agent|Task matcher');

  const editFile = targetFile(editEntry.hooks[0].command);
  const agentFile = targetFile(agentEntry.hooks[0].command);
  assert.notEqual(agentFile, editFile);
});

test('every hook command is guarded with the CLAUDE_PLUGIN_ROOT no-op prefix', () => {
  const commands = allCommands();
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
  const roleModelGate = commands.find((c) => c.command.includes('role-model-gate.js'));
  assert.ok(roleModelGate, 'expected a role-model-gate.js command in hooks.json');

  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT };
  const result = spawnSync('sh', ['-c', roleModelGate.command], {
    env,
    input: '{}',
    encoding: 'utf-8',
  });
  assert.equal(
    result.status,
    0,
    `role-model-gate.js did not exit 0 with CLAUDE_PLUGIN_ROOT set: ${result.stderr}`
  );
});
