// Author: Subash Karki
'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { generateKeyPairSync, sign } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, 'skills/phantom/scripts/phantom-state.mjs');
const DOCTOR = path.join(ROOT, 'skills/phantom/scripts/phantom-doctor.mjs');
const HOOK = path.join(ROOT, 'hooks/capability-gate.mjs');
const ADVANCE = path.join(ROOT, 'skills/phantom/scripts/advance-workflow.mjs');
const AUTHORIZE = path.join(ROOT, 'skills/phantom/scripts/authorize-capability.mjs');
const COMPILE = path.join(ROOT, 'skills/phantom/scripts/compile-workflow.mjs');
const EXECUTE_PARALLEL = path.join(ROOT, 'skills/phantom/scripts/execute-parallel.mjs');
const REPLAY = path.join(ROOT, 'skills/phantom/scripts/replay-workflow.mjs');
const VALIDATE = path.join(ROOT, 'skills/phantom/scripts/validate-workflow.mjs');

let advanceWorkflowFile;
let assertTrustedHostInterception;
let capabilityRequestDigest;
let compileWorkflowFile;
let nativeEffectEvidence;
let normalizeToolEvent;
let postToolUse;
let preToolUse;
let runCapabilityBroker;
let sessionPaths;
let sha256;
let workflowPaths;
let worktreeFingerprint;

before(async () => {
  ({ advanceWorkflowFile } = await import(pathToFileURL(
    path.join(ROOT, 'skills/phantom/scripts/advance-workflow.mjs'),
  ).href));
  ({ compileWorkflowFile } = await import(pathToFileURL(
    path.join(ROOT, 'skills/phantom/scripts/compile-workflow.mjs'),
  ).href));
  ({ capabilityRequestDigest, sha256 } = await import(pathToFileURL(
    path.join(ROOT, 'skills/phantom/scripts/lib/capability-contracts.mjs'),
  ).href));
  ({ sessionPaths } = await import(pathToFileURL(
    path.join(ROOT, 'skills/phantom/scripts/lib/portable.mjs'),
  ).href));
  ({ workflowPaths } = await import(pathToFileURL(
    path.join(ROOT, 'skills/phantom/scripts/lib/workflow-journal.mjs'),
  ).href));
  ({ runCapabilityBroker } = await import(pathToFileURL(
    path.join(ROOT, 'skills/phantom/scripts/authorize-capability.mjs'),
  ).href));
  ({ assertTrustedHostInterception, worktreeFingerprint } = await import(pathToFileURL(STATE).href));
  ({ nativeEffectEvidence, normalizeToolEvent, postToolUse, preToolUse } = await import(
    pathToFileURL(HOOK).href
  ));
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function runState(args, env) {
  const result = spawnSync(process.execPath, [STATE, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function hookFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-capability-hook-'));
  const workspaceDirectory = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  fs.mkdirSync(workspaceDirectory);
  const workspace = fs.realpathSync(workspaceDirectory);
  fs.writeFileSync(path.join(workspace, 'app.js'), 'export const value = 1;\n');
  execFileSync('git', ['init', '-q', '-b', 'feat/capability-hook'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'phantom@example.invalid'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Subash Karki'], { cwd: workspace });
  execFileSync('git', ['add', 'app.js'], { cwd: workspace });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: workspace });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeJson(path.join(data, 'config', 'authority-trust.json'), {
    schema_version: 1,
    key_id: 'capability-hook-key',
    source: 'capability-hook-host',
    public_key: publicKey.export({ type: 'spki', format: 'pem' }),
  });
  return {
    root,
    workspace,
    data,
    privateKey,
    env: { PHANTOM_DATA: data },
    task: 'capability-hook',
  };
}

function installLegacyState(context, { pointer = {}, session = {} } = {}) {
  const paths = sessionPaths(context.workspace, context.task);
  const now = new Date().toISOString();
  writeJson(paths.currentFile, {
    schema_version: 1, repo_id: paths.repo.id, task_id: paths.task,
    session_dir: paths.sessionDir, updated_at: now, ...pointer,
  });
  writeJson(path.join(paths.sessionDir, 'session.json'), {
    schema_version: 1, artifact_type: 'session', repo_id: paths.repo.id,
    task_id: paths.task, workspace: paths.repo.root, status: 'active', route: 'direct',
    intent_summary: 'Migrate legacy state', work_kind: 'implementation',
    created_at: now, updated_at: now, ...session,
  });
  return paths;
}

function authorizeImplementation(context) {
  const paths = sessionPaths(context.workspace, context.task);
  const fingerprint = worktreeFingerprint(context.workspace);
  const now = new Date();
  const unsigned = {
    schema_version: 1,
    repo_id: paths.repo.id,
    task_id: context.task,
    decision_kind: 'authorization',
    gate: null,
    scope: 'implementation',
    decision: 'authorized',
    worktree_fingerprint: fingerprint,
    approval_artifact_bindings: [],
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 5 * 60_000).toISOString(),
    actor: 'capability-hook-test-user',
    source: 'capability-hook-host',
    source_event_id: `source-${Date.now()}-${Math.random()}`,
    replay_id: `replay-${Date.now()}-${Math.random()}`,
    key_id: 'capability-hook-key',
  };
  const decision = {
    ...unsigned,
    signature: sign(null, Buffer.from(canonicalJson(unsigned)), context.privateKey).toString('base64'),
  };
  const file = path.join(context.root, `authority-${Date.now()}.json`);
  writeJson(file, decision);
  runState([
    'authorize', '--workspace', context.workspace, '--scope', 'implementation', '--decision', file,
  ], context.env);
  return fingerprint;
}

function writeInterceptionProbe(context, {
  fingerprint = worktreeFingerprint(context.workspace),
  issuedAt = new Date(),
  expiresAt = new Date(issuedAt.getTime() + 5 * 60_000),
  mutate = null,
} = {}) {
  const paths = sessionPaths(context.workspace, context.task);
  const unsigned = {
    schema_version: 1,
    probe_kind: 'native-tool-interception',
    repo_id: paths.repo.id,
    task_id: context.task,
    worktree_fingerprint: fingerprint,
    adapter_binding: 'native-tool-gate-v1',
    capabilities: { 'lifecycle.hooks': 'available' },
    hooks: { pre_tool_use: 'enforced', post_tool_use: 'enforced' },
    host: 'capability-hook-test-host',
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    source: 'capability-hook-host',
    source_event_id: `probe-source-${Date.now()}-${Math.random()}`,
    replay_id: `probe-replay-${Date.now()}-${Math.random()}`,
    key_id: 'capability-hook-key',
  };
  const probe = {
    ...unsigned,
    signature: sign(null, Buffer.from(canonicalJson(unsigned)), context.privateKey).toString('base64'),
  };
  if (mutate) mutate(probe);
  writeJson(path.join(paths.sessionDir, 'capability-probe.json'), probe);
  return probe;
}

function workflowPlan() {
  return {
    schema_version: 2,
    workflow_id: 'wf-capability-hook',
    route: 'direct',
    risk: 'low',
    baseline_fingerprint: `sha256:${'0'.repeat(64)}`,
    routing: {
      recommended_route: 'direct',
      confidence: 0.95,
      fallback_route: null,
      signals: {},
    },
    execution_mode: 'attended',
    acceptance_criteria: ['one native write consumes one authorization'],
    budget: { max_cost_units: 10, max_duration_ms: 10_000, max_attempts: 2 },
    nodes: [{
      id: 'implement',
      kind: 'task',
      depends_on: [],
      retry_limit: 0,
      budget: { max_cost_units: 5, max_duration_ms: 5_000 },
      role: 'blade',
      output_schema: 'workflow-output-v1',
      expected_artifacts: ['execution.json'],
      acceptance_criteria: ['write is capability-bound'],
      allowed_paths: ['app.js'],
      allowed_commands: [['git', 'status', '--short']],
      allowed_cwds: ['.'],
    }],
  };
}

function advance(context, name, input) {
  const file = path.join(context.root, `${name}.json`);
  writeJson(file, input);
  return advanceWorkflowFile({
    workspace: context.workspace,
    task: context.task,
    input: file,
  });
}

test('Claude and Codex native tool events normalize to exact capability evidence', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-hook-normalize-'));
  try {
    fs.writeFileSync(path.join(workspace, 'app.js'), 'old\n');
    const write = nativeEffectEvidence(normalizeToolEvent({
      tool_name: 'Write',
      cwd: workspace,
      tool_input: { file_path: path.join(workspace, 'app.js'), content: 'new\n' },
    }));
    assert.deepEqual(write, {
      capability_type: 'workspace.write',
      paths: ['app.js'],
      body_digest: sha256('new\n'),
    });

    const editBody = canonicalJson({ old_string: 'old', new_string: 'new', replace_all: false });
    const edit = nativeEffectEvidence({
      tool_name: 'Edit', cwd: workspace,
      tool_input: { file_path: 'app.js', old_string: 'old', new_string: 'new' },
    });
    assert.equal(edit.body_digest, sha256(editBody));

    const patch = '*** Begin Patch\n*** Update File: app.js\n@@\n-old\n+new\n*** End Patch';
    const codex = nativeEffectEvidence({
      name: 'functions.apply_patch',
      cwd: workspace,
      arguments: { patch },
    });
    assert.deepEqual(codex, {
      capability_type: 'workspace.write',
      paths: ['app.js'],
      body_digest: sha256(patch),
    });

    for (const event of [
      { tool_name: 'Bash', cwd: workspace, tool_input: { command: 'node --test' } },
      { name: 'functions.exec_command', cwd: workspace, arguments: { cmd: 'node --test' } },
      { name: 'functions.exec_command', cwd: workspace, arguments: { argv: ['git', 'status', '--short'] } },
      { name: 'functions.exec_command', cwd: workspace, arguments: { argv: ['node', '--test'] } },
    ]) {
      assert.throws(() => nativeEffectEvidence(event), /signed sandbox enforcement contract/);
    }

    assert.throws(() => nativeEffectEvidence({
      tool_name: 'Write',
      cwd: workspace,
      tool_input: { file_path: '.git/config', content: 'forged' },
    }), /repository control metadata/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('native workspace writes reject hard-linked targets before outside bytes can change', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-hook-hardlink-'));
  try {
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'outside.txt');
    fs.mkdirSync(workspace);
    fs.writeFileSync(outside, 'outside sentinel\n');
    fs.linkSync(outside, path.join(workspace, 'linked.txt'));
    assert.throws(() => nativeEffectEvidence({
      tool_name: 'Write', cwd: workspace,
      tool_input: { file_path: 'linked.txt', content: 'mutated\n' },
    }), /hard-linked and physically unsafe/);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'outside sentinel\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('effectful hooks allow no session and fail closed for active missing or corrupt workflow state', () => {
  const context = hookFixture();
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = context.data;
  const event = {
    tool_name: 'Write',
    cwd: context.workspace,
    tool_input: { file_path: 'app.js', content: 'export const value = 2;\n' },
  };
  try {
    for (const handler of [preToolUse, postToolUse]) {
      assert.deepEqual(handler(event), { allowed: true, reason: 'no_active_session' });
    }
    runState([
      'start', '--workspace', context.workspace, '--task', context.task,
      '--intent', 'Keep active sessions fail closed', '--route', 'direct',
    ], context.env);
    for (const handler of [preToolUse, postToolUse]) {
      assert.throws(() => handler(event), /compiled workflow plan is missing/);
    }
    const paths = sessionPaths(context.workspace, context.task);
    writeJson(workflowPaths(paths.sessionDir).planFile, { corrupt: true });
    for (const handler of [preToolUse, postToolUse]) {
      assert.throws(() => handler(event), /workflow plan is malformed/);
    }
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test('genuine v1 state bootstraps only safe Write and Edit effects', () => {
  const context = hookFixture();
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = context.data;
  try {
    installLegacyState(context);
    const write = { tool_name: 'Write', cwd: context.workspace, tool_input: {
      file_path: 'legacy.txt', content: 'first\n',
    } };
    assert.equal(preToolUse(write).reason, 'legacy_state_write_bootstrap');
    fs.writeFileSync(path.join(context.workspace, 'legacy.txt'), 'first\n');
    assert.equal(postToolUse(write).reason, 'legacy_state_write_bootstrap');
    const edit = { tool_name: 'Edit', cwd: context.workspace, tool_input: {
      file_path: 'legacy.txt', old_string: 'first', new_string: 'second',
    } };
    assert.equal(preToolUse(edit).reason, 'legacy_state_write_bootstrap');
    fs.writeFileSync(path.join(context.workspace, 'legacy.txt'), 'second\n');
    assert.equal(postToolUse(edit).reason, 'legacy_state_write_bootstrap');

    const recovery = /requires recovery through phantom:health before this consequential tool can run/;
    for (const event of [
      { tool_name: 'ApplyPatch', cwd: context.workspace, tool_input: {
        patch: '*** Begin Patch\n*** Update File: legacy.txt\n@@\n-first\n+second\n*** End Patch',
      } },
      { tool_name: 'MultiEdit', cwd: context.workspace, tool_input: { file_path: 'legacy.txt', edits: [] } },
      { tool_name: 'NotebookEdit', cwd: context.workspace, tool_input: { notebook_path: 'x.ipynb' } },
      { tool_name: 'Bash', cwd: context.workspace, tool_input: { command: 'pwd' } },
      { tool_name: 'VendorEffect', cwd: context.workspace, tool_input: {} },
      { tool_name: 'Vendor.Write', cwd: context.workspace, tool_input: write.tool_input },
      { tool_name: 'Vendor.Edit', cwd: context.workspace, tool_input: edit.tool_input },
      { function: { name: 'Write', arguments: JSON.stringify(write.tool_input) }, cwd: context.workspace },
    ]) {
      for (const handler of [preToolUse, postToolUse]) {
        assert.throws(() => handler(event), (error) => recovery.test(error.message)
          && !error.message.includes('schema_version'));
      }
    }
    for (const filePath of ['../outside.txt', '.git/config', '.phantom/state']) {
      assert.throws(() => preToolUse({ ...write, tool_input: { ...write.tool_input, file_path: filePath } }));
    }
    fs.symlinkSync('legacy.txt', path.join(context.workspace, 'legacy-link.txt'));
    assert.throws(() => preToolUse({
      ...write,
      tool_input: { ...write.tool_input, file_path: 'legacy-link.txt' },
    }), /symbolic link/);

    installLegacyState(context, { session: { schema_version: 2 } });
    assert.throws(() => preToolUse(write), recovery);
    installLegacyState(context, { pointer: { schema_version: 99 } });
    assert.throws(() => preToolUse(write), recovery);
    installLegacyState(context, { session: { route: 'invalid' } });
    assert.throws(() => preToolUse(write), recovery);

    fs.rmSync(context.data, { recursive: true, force: true });
    runState([
      'start', '--workspace', context.workspace, '--task', context.task,
      '--intent', 'Validate mixed state recovery', '--route', 'direct',
    ], context.env);
    const v2Paths = sessionPaths(context.workspace, context.task);
    const v2Pointer = JSON.parse(fs.readFileSync(v2Paths.currentFile, 'utf8'));
    installLegacyState(context);
    writeJson(v2Paths.currentFile, v2Pointer);
    assert.throws(() => preToolUse(write), (error) => recovery.test(error.message)
      && !error.message.includes('schema_version'));
    for (const session of [{ malformed: true }, { schema_version: 99 }]) {
      writeJson(path.join(v2Paths.sessionDir, 'session.json'), session);
      assert.throws(() => preToolUse(write), (error) => recovery.test(error.message)
        && !error.message.includes('schema_version'));
    }
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test('read-only tools and the exact bundled Doctor bypass legacy state validation', () => {
  const context = hookFixture();
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = context.data;
  try {
    runState([
      'start', '--workspace', context.workspace, '--task', context.task,
      '--intent', 'Keep read-only tools available during state migration', '--route', 'direct',
    ], context.env);
    const pointerFile = sessionPaths(context.workspace, context.task).currentFile;
    const pointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
    writeJson(pointerFile, { ...pointer, schema_version: 1 });
    const read = {
      tool_name: 'Read',
      cwd: context.workspace,
      tool_input: { file_path: 'app.js' },
    };
    const command = (argv) => argv.map((value) => JSON.stringify(value)).join(' ');
    const doctorEvent = {
      tool_name: 'Bash',
      cwd: context.workspace,
      tool_input: {
        command: command([process.execPath, DOCTOR, '--workspace', context.workspace]),
        workdir: context.workspace,
      },
    };
    const mergedDoctorEvent = {
      ...doctorEvent,
      tool_input: {
        ...doctorEvent.tool_input,
        command: `${doctorEvent.tool_input.command} 2>&1`,
      },
    };
    for (const handler of [preToolUse, postToolUse]) {
      assert.deepEqual(handler(read), { allowed: true, reason: 'read_only_allowlist' });
      for (const event of [doctorEvent, mergedDoctorEvent]) {
        assert.deepEqual(handler(event), {
          allowed: true,
          reason: 'phantom_bootstrap_diagnostic',
        });
      }
      assert.deepEqual(handler({
        tool_name: 'Skill', cwd: context.workspace,
        tool_input: { skill: 'phantom:start', args: '' },
      }), { allowed: true, reason: 'phantom_bootstrap_skill' });
      assert.deepEqual(handler({
        tool_name: 'Skill', cwd: context.workspace,
        tool_input: { skill: 'phantom:health', args: '' },
      }), { allowed: true, reason: 'phantom_diagnostic_skill' });
    }
    const doctor = spawnSync(process.execPath, [DOCTOR, '--workspace', context.workspace], {
      encoding: 'utf8',
      env: { ...process.env, ...context.env },
    });
    assert.equal(doctor.status, 1, doctor.stderr);
    assert.deepEqual(JSON.parse(doctor.stdout).migration, {
      status: 'blocked',
      reason: 'active_session_invalid',
      resource: 'scripts/migrate-session-state.mjs',
      command: null,
    });

    const rejectedRedirections = [
      ' > output.json',
      ' 2>output.json',
      ' | cat',
      ' && pwd',
      ' 2>&1 2>&1',
      ' 2>&1 trailing',
    ].map((suffix) => ({
      ...doctorEvent,
      tool_input: {
        ...doctorEvent.tool_input,
        command: `${doctorEvent.tool_input.command}${suffix}`,
      },
    }));
    const nearMisses = [
      ...rejectedRedirections,
      {
        ...doctorEvent,
        tool_input: { ...doctorEvent.tool_input, cmd: doctorEvent.tool_input.command },
      },
      {
        ...doctorEvent,
        tool_input: {
          ...doctorEvent.tool_input,
          argv: [process.execPath, DOCTOR, '--workspace', context.workspace],
        },
      },
      {
        ...doctorEvent,
        tool_input: { ...doctorEvent.tool_input, cwd: context.workspace },
      },
      {
        ...doctorEvent,
        tool_input: {
          ...doctorEvent.tool_input,
          command: `${doctorEvent.tool_input.command} --task ${JSON.stringify(context.task)}`,
        },
      },
      (() => {
        const alias = path.join(context.root, 'doctor-alias.mjs');
        fs.symlinkSync(DOCTOR, alias);
        return {
          ...doctorEvent,
          tool_input: {
            ...doctorEvent.tool_input,
            command: command([process.execPath, alias, '--workspace', context.workspace]),
          },
        };
      })(),
      (() => {
        const subdirectory = path.join(context.workspace, 'nested');
        fs.mkdirSync(subdirectory);
        return {
          tool_name: 'Bash', cwd: subdirectory,
          tool_input: { command: doctorEvent.tool_input.command },
        };
      })(),
      {
        ...doctorEvent,
        tool_input: {
          ...doctorEvent.tool_input,
          command: command([process.execPath, STATE, '--workspace', context.workspace]),
        },
      },
      {
        ...doctorEvent,
        tool_input: {
          ...doctorEvent.tool_input,
          command: command([process.execPath, DOCTOR, '--workspace', context.root]),
        },
      },
      {
        ...doctorEvent,
        tool_input: { ...doctorEvent.tool_input, workdir: context.root },
      },
      {
        ...doctorEvent,
        tool_input: { ...doctorEvent.tool_input, command: `${doctorEvent.tool_input.command}; pwd` },
      },
      {
        ...doctorEvent,
        tool_input: {
          ...doctorEvent.tool_input,
          command: command(['/usr/bin/env', 'node', DOCTOR, '--workspace', context.workspace]),
        },
      },
      {
        tool_name: 'Bash',
        cwd: context.workspace,
        tool_input: { command: 'pwd', workdir: context.workspace },
      },
      {
        tool_name: 'Bash',
        cwd: context.workspace,
        tool_input: {
          command: command([
            process.execPath,
            STATE,
            'start',
            '--workspace', context.workspace,
            '--task', 'replacement',
            '--intent', 'Replace legacy state',
            '--route', 'direct',
          ]),
          workdir: context.workspace,
        },
      },
      {
        tool_name: 'Skill',
        cwd: context.workspace,
        tool_input: { skill: 'phantom:execute', args: '' },
      },
    ];
    for (const event of nearMisses) {
      for (const handler of [preToolUse, postToolUse]) {
        assert.throws(
          () => handler(event),
          /requires recovery through phantom:health before this consequential tool can run/,
        );
      }
    }
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test('process hooks ignore active sessions in unrelated repositories', () => {
  const context = hookFixture();
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = context.data;
  const unrelated = path.join(context.root, 'unrelated-workspace');
  fs.mkdirSync(unrelated);
  execFileSync('git', ['init', '-q', '-b', 'feat/unrelated'], { cwd: unrelated });
  try {
    installLegacyState(context);
    for (const command of ['pwd', 'echo probe', `${process.execPath} --version`]) {
      const event = {
        tool_name: 'Bash',
        cwd: unrelated,
        project_dir: unrelated,
        tool_input: { command, workdir: unrelated },
      };
      for (const handler of [preToolUse, postToolUse]) {
        assert.deepEqual(handler(event), { allowed: true, reason: 'no_active_session' });
      }
    }
    const targeted = {
      tool_name: 'Bash', cwd: unrelated, project_dir: unrelated,
      tool_input: {
        command: `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(context.workspace, 'app.js'))}`,
        workdir: unrelated,
      },
    };
    for (const handler of [preToolUse, postToolUse]) {
      assert.throws(() => handler(targeted), (error) => (
        /requires recovery through phantom:health before this consequential tool can run/.test(error.message)
        && !error.message.includes('schema_version')
      ));
    }
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test('governed capability policy is invariant to a mutable hook cwd', () => {
  const context = hookFixture();
  const previousData = process.env.PHANTOM_DATA;
  const previousProject = process.env.CLAUDE_PROJECT_DIR;
  process.env.PHANTOM_DATA = context.data;
  delete process.env.CLAUDE_PROJECT_DIR;
  const sibling = path.join(context.root, 'sibling');
  const outsideTarget = path.join(sibling, 'outside.txt');
  const workspaceAlias = path.join(sibling, 'workspace-alias');
  fs.mkdirSync(sibling);
  fs.writeFileSync(outsideTarget, 'outside sentinel\n');
  fs.symlinkSync(context.workspace, workspaceAlias, 'dir');
  const governedTarget = path.join(context.workspace, 'app.js');
  const outsideWrite = {
    tool_name: 'Write', cwd: sibling,
    tool_input: { file_path: outsideTarget, content: 'outside update\n' },
  };
  const outsideExec = {
    tool_name: 'Bash', cwd: sibling, project_dir: sibling,
    tool_input: { command: 'pwd', workdir: sibling },
  };
  try {
    for (const handler of [preToolUse, postToolUse]) {
      assert.deepEqual(handler(outsideWrite), { allowed: true, reason: 'no_active_session' });
      assert.deepEqual(handler(outsideExec), { allowed: true, reason: 'no_active_session' });
    }

    runState([
      'start', '--workspace', context.workspace, '--task', context.task,
      '--intent', 'Bind native effects independently of mutable cwd', '--route', 'direct',
    ], context.env);

    const writeFrom = (cwd, target = governedTarget) => ({
      tool_name: 'Write',
      cwd,
      tool_input: { file_path: target, content: 'forged\n' },
    });
    for (const handler of [preToolUse, postToolUse]) {
      assert.throws(() => handler(writeFrom(context.workspace)), /compiled workflow plan is missing/);
      assert.throws(() => handler(writeFrom(sibling)), /compiled workflow plan is missing/);
      assert.throws(
        () => handler(writeFrom(sibling, path.join(workspaceAlias, 'new-file.js'))),
        /compiled workflow plan is missing/,
      );
    }

    for (const event of [
      {
        tool_name: 'Bash', cwd: sibling,
        tool_input: { command: 'node --test', workdir: context.workspace },
      },
      {
        tool_name: 'Bash', cwd: sibling, project_dir: context.workspace,
        tool_input: { command: 'node --test', workdir: sibling },
      },
    ]) {
      for (const handler of [preToolUse, postToolUse]) {
        assert.throws(() => handler(event), /compiled workflow plan is missing/);
      }
    }

    process.env.CLAUDE_PROJECT_DIR = context.workspace;
    try {
      const conflictingProjectEvent = {
        tool_name: 'Bash', cwd: sibling, project_dir: sibling,
        tool_input: { command: 'node --test', workdir: sibling },
      };
      assert.equal(normalizeToolEvent(conflictingProjectEvent).workspace, context.workspace);
      for (const handler of [preToolUse, postToolUse]) {
        assert.throws(() => handler(conflictingProjectEvent), /compiled workflow plan is missing/);
      }
    } finally {
      delete process.env.CLAUDE_PROJECT_DIR;
    }

    for (const handler of [preToolUse, postToolUse]) {
      assert.deepEqual(handler(outsideWrite), { allowed: true, reason: 'no_active_session' });
      assert.deepEqual(handler(outsideExec), { allowed: true, reason: 'no_active_session' });
      assert.throws(() => handler({
        tool_name: 'Bash', cwd: sibling,
        tool_input: { command: `node ${governedTarget}` },
      }), /compiled workflow plan is missing/);
    }
    assert.equal(fs.readFileSync(governedTarget, 'utf8'), 'export const value = 1;\n');
    assert.equal(fs.readFileSync(outsideTarget, 'utf8'), 'outside sentinel\n');
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    if (previousProject === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = previousProject;
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test('native Write staging and exact literal-node control commands complete a bootstrap round trip', () => {
  const context = hookFixture();
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = context.data;
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  try {
    runState([
      'start', '--workspace', context.workspace, '--task', context.task,
      '--intent', 'Bootstrap only through staged control inputs', '--route', 'direct',
    ], context.env);
    const paths = sessionPaths(context.workspace, context.task);
    const controlDirectory = fs.realpathSync(path.join(paths.sessionDir, 'control-inputs'));
    const noWorkflowCompletion = spawnSync(process.execPath, [STATE, 'complete', '--workspace', context.workspace], {
      encoding: 'utf8', env: { ...process.env, ...context.env },
    });
    assert.equal(noWorkflowCompletion.status, 1);
    assert.match(noWorkflowCompletion.stderr, /authoritative workflow replay failed/);
    const stage = (name, value) => {
      const file = path.join(controlDirectory, name);
      const content = `${JSON.stringify(value, null, 2)}\n`;
      const event = {
        tool_name: 'Write',
        cwd: context.workspace,
        tool_input: { file_path: file, content },
      };
      assert.equal(preToolUse(event).reason, 'phantom_control_input');
      fs.writeFileSync(file, content, { flag: 'wx' });
      assert.equal(postToolUse(event).reason, 'phantom_control_input');
      return file;
    };
    const control = (script, args) => {
      const command = ['node', script, ...args].map(quote).join(' ');
      const event = { tool_name: 'Bash', cwd: context.workspace, tool_input: { command } };
      assert.equal(preToolUse(event).reason, 'phantom_control_plane');
      const execution = spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...context.env },
      });
      assert.equal(execution.status, 0, `${execution.stderr}\n${execution.stdout}`);
      assert.equal(postToolUse(event).reason, 'phantom_control_plane');
      return JSON.parse(execution.stdout);
    };

    const raceContent = '{"event_type":"workflow.started"}\n';
    const raceEvent = {
      tool_name: 'Write', cwd: context.workspace,
      tool_input: { file_path: path.join(controlDirectory, 'atomic-race.json'), content: raceContent },
    };
    assert.equal(preToolUse(raceEvent).reason, 'phantom_control_input');
    assert.throws(() => preToolUse(raceEvent), /immutable reservation/);

    const stagedPlan = workflowPlan();
    stagedPlan.baseline_fingerprint = worktreeFingerprint(context.workspace);
    stagedPlan.session_binding = {
      repo_id: paths.repo.id,
      task_id: context.task,
      route: 'direct',
      approved_plan: null,
    };
    const planFile = stage('plan-bootstrap.json', stagedPlan);
    assert.equal(control(VALIDATE, ['--input', planFile]).valid, true);
    const compiled = control(COMPILE, [
      '--workspace', context.workspace, '--task', context.task, '--input', planFile,
    ]);
    assert.equal(compiled.plan.workflow_id, 'wf-capability-hook');
    const signedReceipt = stage('parallel-receipt.json', { signed: 'host-verifies-content' });
    const parallelCommand = [
      'node', EXECUTE_PARALLEL,
      '--workspace', context.workspace,
      '--task', context.task,
      '--receipt', signedReceipt,
    ].map(quote).join(' ');
    const parallelEvent = {
      tool_name: 'Bash', cwd: context.workspace, tool_input: { command: parallelCommand },
    };
    assert.equal(preToolUse(parallelEvent).reason, 'phantom_control_plane');
    assert.equal(postToolUse(parallelEvent).reason, 'phantom_control_plane');
    assert.throws(() => preToolUse({
      tool_name: 'Bash', cwd: context.workspace,
      tool_input: { command: `${parallelCommand} --offline-test true` },
    }), /signed sandbox enforcement contract/);
    const outsideReceipt = path.join(context.root, 'outside-receipt.json');
    writeJson(outsideReceipt, { signed: 'outside-session' });
    assert.throws(() => preToolUse({
      tool_name: 'Bash', cwd: context.workspace,
      tool_input: {
        command: [
          'node', EXECUTE_PARALLEL,
          '--workspace', context.workspace,
          '--task', context.task,
          '--receipt', outsideReceipt,
        ].map(quote).join(' '),
      },
    }), /signed sandbox enforcement contract/);
    const signedAttestation = stage('capability-attestation.json', { signed: 'adapter-result' });
    const attestationCommand = [
      'node', AUTHORIZE, 'attest',
      '--workspace', context.workspace,
      '--task', context.task,
      '--input', signedAttestation,
    ].map(quote).join(' ');
    const attestationEvent = {
      tool_name: 'Bash', cwd: context.workspace, tool_input: { command: attestationCommand },
    };
    assert.equal(preToolUse(attestationEvent).reason, 'phantom_control_plane');
    assert.equal(postToolUse(attestationEvent).reason, 'phantom_control_plane');
    fs.writeFileSync(workflowPaths(paths.sessionDir).journalFile, '{corrupt journal}\n');
    const corruptCompletion = spawnSync(process.execPath, [STATE, 'complete', '--workspace', context.workspace], {
      encoding: 'utf8', env: { ...process.env, ...context.env },
    });
    assert.equal(corruptCompletion.status, 1);
    assert.match(corruptCompletion.stderr, /authoritative workflow replay failed/);
    fs.unlinkSync(workflowPaths(paths.sessionDir).journalFile);

    const syntheticVerification = stage('synthetic-verification.json', {
      checks: [{ name: 'forged', result: 'passed' }],
    });
    const syntheticArgs = [
      'record', '--workspace', context.workspace, '--type', 'verification', '--status', 'passed',
      '--input', syntheticVerification,
    ];
    const syntheticCommand = ['node', STATE, ...syntheticArgs].map(quote).join(' ');
    const syntheticEvent = {
      tool_name: 'Bash', cwd: context.workspace, tool_input: { command: syntheticCommand },
    };
    assert.equal(preToolUse(syntheticEvent).reason, 'phantom_control_plane');
    const synthetic = spawnSync(process.execPath, [STATE, ...syntheticArgs], {
      encoding: 'utf8', env: { ...process.env, ...context.env },
    });
    assert.equal(synthetic.status, 1);
    assert.match(synthetic.stderr, /Unsupported artifact type: verification/);
    assert.equal(postToolUse(syntheticEvent).reason, 'phantom_control_plane');

    const swapFile = stage('pre-command-swap.json', {
      event_id: 'swapped-event', event_type: 'workflow.started', payload: {},
    });
    fs.writeFileSync(swapFile, '{"event_id":"attacker","event_type":"workflow.started","payload":{}}\n');
    assert.throws(() => preToolUse({
      tool_name: 'Bash', cwd: context.workspace,
      tool_input: {
        command: ['node', ADVANCE, '--workspace', context.workspace, '--task', context.task,
          '--input', swapFile].map(quote).join(' '),
      },
    }), /signed sandbox enforcement contract/);

    for (const protectedTarget of [
      path.join(paths.sessionDir, 'session.json'),
      path.join(paths.sessionDir, 'workflow', 'events.jsonl'),
      path.join(paths.sessionDir, 'plan.json'),
      path.join(paths.sessionDir, 'capability', 'reservations', 'pending', `${'a'.repeat(64)}.json`),
    ]) {
      assert.throws(() => preToolUse({
        tool_name: 'Write', cwd: context.workspace,
        tool_input: { file_path: protectedTarget, content: '{}\n' },
      }), /control-plane state/);
    }
    assert.throws(() => preToolUse({
      tool_name: 'Write', cwd: context.workspace,
      tool_input: { file_path: path.join(context.workspace, '.phantom', 'session.json'), content: '{}\n' },
    }), /repository control metadata/);

    assert.throws(() => preToolUse({
      tool_name: 'Write', cwd: context.workspace,
      tool_input: { file_path: planFile, content: '{"changed":true}\n' },
    }), /strictly new-only/);
    assert.throws(() => preToolUse({
      tool_name: 'Write', cwd: context.workspace,
      tool_input: { file_path: planFile, content: fs.readFileSync(planFile, 'utf8') },
    }), /strictly new-only/);
    const outsideInput = path.join(context.root, 'outside-event.json');
    writeJson(outsideInput, { event_type: 'workflow.started' });
    assert.throws(() => preToolUse({
      tool_name: 'Bash', cwd: context.workspace,
      tool_input: {
        command: ['node', ADVANCE, '--workspace', context.workspace, '--task', context.task,
          '--input', outsideInput].map(quote).join(' '),
      },
    }), /signed sandbox enforcement contract/);
    assert.throws(() => preToolUse({
      tool_name: 'Bash', cwd: context.workspace,
      tool_input: {
        command: ['node', COMPILE, '--workspace', context.workspace, '--task', context.task,
          '--input', planFile, '--offline-test', 'true'].map(quote).join(' '),
      },
    }), /signed sandbox enforcement contract/);

    const fakeBin = path.join(context.root, 'fake-bin');
    fs.mkdirSync(fakeBin);
    const fakeNode = path.join(fakeBin, 'node');
    fs.writeFileSync(fakeNode, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const originalPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    try {
      assert.throws(() => preToolUse({
        tool_name: 'Bash', cwd: context.workspace,
        tool_input: {
          command: ['node', REPLAY, '--workspace', context.workspace, '--task', context.task]
            .map(quote).join(' '),
        },
      }), /signed sandbox enforcement contract/);
    } finally {
      process.env.PATH = originalPath;
    }

    const fingerprint = worktreeFingerprint(context.workspace);
    const issuedAt = new Date();
    const authority = {
      schema_version: 1,
      repo_id: paths.repo.id,
      task_id: context.task,
      decision_kind: 'authorization',
      gate: null,
      scope: 'implementation',
      decision: 'authorized',
      worktree_fingerprint: fingerprint,
      approval_artifact_bindings: [],
      issued_at: issuedAt.toISOString(),
      expires_at: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
      actor: 'capability-hook-test-user',
      source: 'capability-hook-host',
      source_event_id: 'bootstrap-authority-source',
      replay_id: 'bootstrap-authority-replay',
      key_id: 'capability-hook-key',
    };
    authority.signature = sign(
      null,
      Buffer.from(canonicalJson(authority)),
      context.privateKey,
    ).toString('base64');
    const authorityFile = stage('implementation-authority.json', authority);
    control(STATE, [
      'authorize', '--workspace', context.workspace, '--scope', 'implementation',
      '--decision', authorityFile,
    ]);
    control(STATE, ['execute', '--workspace', context.workspace]);

    const startFile = stage('event-workflow-started.json', {
      event_id: 'bootstrap-workflow-started', event_type: 'workflow.started', payload: {},
    });
    control(ADVANCE, [
      '--workspace', context.workspace, '--task', context.task, '--input', startFile,
    ]);
    const nodeFile = stage('event-node-started.json', {
      event_id: 'bootstrap-node-started', event_type: 'node.started', node_id: 'implement', payload: {},
    });
    control(ADVANCE, [
      '--workspace', context.workspace, '--task', context.task, '--input', nodeFile,
    ]);

    writeJson(path.join(paths.sessionDir, 'capabilities.json'), {
      evidence: { capabilities: { 'lifecycle.hooks': 'available', 'workspace.write': 'available' } },
    });
    writeInterceptionProbe(context, { fingerprint });
    const request = {
      schema_version: 1,
      request_id: 'bootstrap-request',
      workflow_id: compiled.plan.workflow_id,
      node_id: 'implement',
      worktreeFingerprint: fingerprint,
      budget: { maxCostUnits: 1, maxDurationMs: 4_000 },
      type: 'workspace.write',
      paths: ['app.js'],
      patchDigest: sha256('export const value = 2;\n'),
    };
    const requestFile = stage('request-workspace-write.json', request);
    const decision = control(AUTHORIZE, [
      'authorize', '--workspace', context.workspace, '--task', context.task, '--input', requestFile,
    ]);
    assert.equal(decision.status, 'authorized');
    const replay = control(REPLAY, ['--workspace', context.workspace, '--task', context.task]);
    assert.equal(replay.state.nodes.implement.status, 'running');
    const writeContent = 'export const value = 2;\n';
    const writeEvent = {
      tool_name: 'Write',
      tool_use_id: 'bootstrap-tool-call',
      session_id: 'bootstrap-host-session',
      cwd: context.workspace,
      tool_input: {
        file_path: path.join(context.workspace, 'app.js'),
        content: writeContent,
      },
    };
    preToolUse(writeEvent);
    fs.writeFileSync(path.join(context.workspace, 'app.js'), writeContent);
    postToolUse({ ...writeEvent, tool_response: { success: true } });
    for (const action of ['ship', 'complete']) {
      const args = [action, '--workspace', context.workspace];
      const command = ['node', STATE, ...args].map(quote).join(' ');
      const event = { tool_name: 'Bash', cwd: context.workspace, tool_input: { command } };
      assert.equal(preToolUse(event).reason, 'phantom_control_plane');
      const deniedByLifecycle = spawnSync(process.execPath, [STATE, ...args], {
        encoding: 'utf8', env: { ...process.env, ...context.env },
      });
      assert.equal(deniedByLifecycle.status, 1);
      assert.match(deniedByLifecycle.stderr, /Cannot (?:ship|complete)/);
      assert.equal(postToolUse(event).reason, 'phantom_control_plane');
    }
    const executionArtifact = {
      schema_version: 1,
      node_id: 'implement',
      status: 'completed',
      evidence: [{ name: 'unit', result: 'passed' }],
      output: {},
    };
    const executionBytes = Buffer.from(`${JSON.stringify(executionArtifact)}\n`);
    fs.writeFileSync(path.join(paths.sessionDir, 'execution.json'), executionBytes);
    const completionFile = stage('event-node-completed.json', {
      event_id: 'bootstrap-node-completed',
      event_type: 'node.completed',
      node_id: 'implement',
      artifact_refs: ['execution.json'],
      payload: {
        output_schema: 'workflow-output-v1',
        artifact_digests: [{ artifact_ref: 'execution.json', digest: sha256(executionBytes) }],
        cost_units: 1,
        duration_ms: 10,
      },
    });
    const accepted = control(ADVANCE, [
      '--workspace', context.workspace, '--task', context.task, '--input', completionFile,
    ]);
    assert.equal(accepted.state.status, 'accepted');
    assert.throws(() => preToolUse({
      tool_name: 'Bash', cwd: context.workspace,
      tool_input: {
        command: ['node', AUTHORIZE, 'execute', '--workspace', context.workspace,
          '--task', context.task, '--input', requestFile].map(quote).join(' '),
      },
    }), /signed sandbox enforcement contract/);
    const completeArgs = ['complete', '--workspace', context.workspace];
    const completeEvent = {
      tool_name: 'Bash', cwd: context.workspace,
      tool_input: { command: ['node', STATE, ...completeArgs].map(quote).join(' ') },
    };
    assert.equal(preToolUse(completeEvent).reason, 'phantom_control_plane');
    const completed = spawnSync(process.execPath, [STATE, ...completeArgs], {
      encoding: 'utf8', env: { ...process.env, ...context.env },
    });
    assert.equal(completed.status, 0, completed.stderr);
    assert.equal(JSON.parse(completed.stdout).status, 'completed');
    assert.equal(postToolUse(completeEvent).reason, 'no_active_session');
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test('effectful hooks fail closed when active workflow evidence is corrupt', () => {
  const context = hookFixture();
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = context.data;
  const event = {
    name: 'functions.apply_patch',
    cwd: context.workspace,
    arguments: { patch: '*** Begin Patch\n*** Update File: app.js\n@@\n-1\n+2\n*** End Patch' },
  };
  try {
    runState([
      'start', '--workspace', context.workspace, '--task', context.task,
      '--intent', 'Reject corrupt workflow evidence', '--route', 'direct',
    ], context.env);
    authorizeImplementation(context);
    runState(['execute', '--workspace', context.workspace], context.env);
    const planFile = path.join(context.root, 'workflow-plan.json');
    writeJson(planFile, workflowPlan());
    compileWorkflowFile({ workspace: context.workspace, task: context.task, input: planFile });
    const paths = sessionPaths(context.workspace, context.task);
    fs.writeFileSync(workflowPaths(paths.sessionDir).journalFile, '{\n');
    for (const handler of [preToolUse, postToolUse]) {
      assert.throws(() => handler(event), /Workflow journal line 1 is invalid JSON/);
    }
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test('trusted host interception rejects absent, stale, expired, and forged probes', () => {
  const context = hookFixture();
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = context.data;
  try {
    runState([
      'start', '--workspace', context.workspace, '--task', context.task,
      '--intent', 'Verify signed native interception evidence', '--route', 'direct',
    ], context.env);
    const verify = () => assertTrustedHostInterception(context.workspace, {
      task: context.task,
      fingerprint: worktreeFingerprint(context.workspace),
    });
    assert.throws(verify, /signed host interception evidence is unavailable/);

    writeInterceptionProbe(context, { fingerprint: `sha256:${'0'.repeat(64)}` });
    assert.throws(verify, /worktree fingerprint is stale/);

    const issuedAt = new Date(Date.now() - 10 * 60_000);
    writeInterceptionProbe(context, {
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 5 * 60_000),
    });
    assert.throws(verify, /expired/);

    writeInterceptionProbe(context, { mutate: (probe) => { probe.host = 'forged-host'; } });
    assert.throws(verify, /signature is invalid/);

    writeInterceptionProbe(context);
    assert.match(verify().probe_digest, /^sha256:[a-f0-9]{64}$/);
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test('native hook claims one signed reservation, records its outcome, and blocks replay', () => {
  const context = hookFixture();
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = context.data;
  try {
    runState([
      'start', '--workspace', context.workspace, '--task', context.task,
      '--intent', 'Implement a capability-bound native write', '--route', 'direct',
    ], context.env);
    const fingerprint = authorizeImplementation(context);
    runState(['execute', '--workspace', context.workspace], context.env);
    const planFile = path.join(context.root, 'workflow-plan.json');
    writeJson(planFile, workflowPlan());
    const compiled = compileWorkflowFile({
      workspace: context.workspace,
      task: context.task,
      input: planFile,
    });
    advance(context, 'workflow-started', { event_type: 'workflow.started', node_id: null });
    advance(context, 'node-started', { event_type: 'node.started', node_id: 'implement' });

    const paths = sessionPaths(context.workspace, context.task);
    writeJson(path.join(paths.sessionDir, 'capabilities.json'), {
      evidence: { capabilities: {
        'lifecycle.hooks': 'available',
        'workspace.write': 'available',
      } },
    });
    writeInterceptionProbe(context, { fingerprint });
    const content = 'export const value = 2;\n';
    const request = {
      schema_version: 1,
      request_id: 'request-native-write',
      workflow_id: compiled.plan.workflow_id,
      node_id: 'implement',
      worktreeFingerprint: fingerprint,
      budget: { maxCostUnits: 1, maxDurationMs: 5_000 },
      type: 'workspace.write',
      paths: ['app.js'],
      patchDigest: sha256(content),
    };
    const requestFile = path.join(context.root, 'request.json');
    writeJson(requestFile, request);
    const decision = runCapabilityBroker([
      'authorize', '--workspace', context.workspace, '--task', context.task, '--input', requestFile,
    ]);
    assert.equal(decision.status, 'authorized');
    assert.match(capabilityRequestDigest(request), /^sha256:/);
    const reservations = path.join(paths.sessionDir, 'capability', 'reservations');
    const pendingName = fs.readdirSync(path.join(reservations, 'pending'))[0];
    const pendingFile = path.join(reservations, 'pending', pendingName);
    const pendingBytes = fs.readFileSync(pendingFile);

    const event = {
      tool_name: 'Write',
      tool_use_id: 'tool-call-1',
      session_id: 'host-session-1',
      cwd: context.workspace,
      tool_input: { file_path: path.join(context.workspace, 'app.js'), content },
    };
    const claimed = preToolUse(event);
    assert.equal(claimed.decision_digest, decision.decision_digest);
    fs.writeFileSync(pendingFile, pendingBytes, { flag: 'wx', mode: 0o600 });
    assert.throws(() => preToolUse(event), /already consuming and requires reconciliation/);
    assert.deepEqual(fs.readdirSync(path.join(reservations, 'pending')), []);
    const consumingFile = path.join(reservations, 'consuming', pendingName);
    assert.equal(fs.statSync(consumingFile).nlink, 1);
    const beforeOutcome = fs.readFileSync(workflowPaths(paths.sessionDir).journalFile, 'utf8')
      .trim().split('\n').map(JSON.parse);
    assert.equal(beforeOutcome.at(-1).event_type, 'capability.decision');
    assert.throws(() => preToolUse(event), /consuming without an outcome/);

    fs.writeFileSync(path.join(context.workspace, 'app.js'), content);
    const completed = postToolUse({ ...event, tool_response: { success: true } });
    assert.equal(completed.decision_digest, decision.decision_digest);
    assert.match(completed.outcome_digest, /^sha256:/);
    const replayFingerprint = authorizeImplementation(context);
    writeInterceptionProbe(context, { fingerprint: replayFingerprint });
    assert.throws(() => preToolUse(event), /already consumed/);

    assert.deepEqual(fs.readdirSync(path.join(reservations, 'pending')), []);
    assert.deepEqual(fs.readdirSync(path.join(reservations, 'consuming')), []);
    assert.equal(fs.readdirSync(path.join(reservations, 'completed')).length, 1);
    const journal = fs.readFileSync(workflowPaths(paths.sessionDir).journalFile, 'utf8')
      .trim().split('\n').map(JSON.parse);
    assert.equal(journal.at(-1).event_type, 'capability.outcome');
    assert.equal(journal.at(-1).payload.status, 'succeeded');
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test('active workflows fail closed for unknown effects and native shell strings', () => {
  const context = hookFixture();
  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = context.data;
  try {
    runState([
      'start', '--workspace', context.workspace, '--task', context.task,
      '--intent', 'Implement fail-closed tool interception', '--route', 'direct',
    ], context.env);
    authorizeImplementation(context);
    runState(['execute', '--workspace', context.workspace], context.env);
    const planFile = path.join(context.root, 'workflow-plan.json');
    writeJson(planFile, workflowPlan());
    compileWorkflowFile({ workspace: context.workspace, task: context.task, input: planFile });
    advance(context, 'workflow-started', { event_type: 'workflow.started', node_id: null });
    advance(context, 'node-started', { event_type: 'node.started', node_id: 'implement' });
    const editEvent = { tool_name: 'Edit', cwd: context.workspace, tool_input: {
      file_path: 'app.js', old_string: 'value = 1', new_string: 'value = 3',
    } };
    assert.throws(() => preToolUse(editEvent), /signed host interception evidence is unavailable/);
    writeInterceptionProbe(context, { mutate: (probe) => { probe.host = 'forged-host'; } });
    assert.throws(() => preToolUse(editEvent), /signature is invalid/);
    writeInterceptionProbe(context);

    execFileSync('git', ['switch', '-qc', 'main'], { cwd: context.workspace });
    writeInterceptionProbe(context);
    assert.throws(() => preToolUse(editEvent), /named, unprotected feature branch/);
    execFileSync('git', ['switch', '-q', 'feat/capability-hook'], { cwd: context.workspace });
    writeInterceptionProbe(context);

    for (const [event, expected] of [
      [{ tool_name: 'Bash', cwd: context.workspace, tool_input: { command: 'node --test' } }, /signed sandbox enforcement contract/],
      [{ name: 'functions.exec_command', cwd: context.workspace, arguments: { cmd: 'node --test' } }, /signed sandbox enforcement contract/],
      [
        { name: 'functions.exec_command', cwd: context.workspace, arguments: { argv: ['node', '--test'] } },
        /signed sandbox enforcement contract/,
      ],
      [{ tool_name: 'VendorWriteEverything', cwd: context.workspace, tool_input: { path: 'app.js' } }, /Unknown consequential tool/],
      [{ tool_name: 'mcp__vendor__merge', cwd: context.workspace, tool_input: {} }, /Unknown consequential tool/],
      [{ tool_name: 'mcp__vendor__deploy', cwd: context.workspace, tool_input: {} }, /Unknown consequential tool/],
      [{ tool_name: 'mcp__vendor__read', cwd: context.workspace, tool_input: {} }, /Unknown consequential tool/],
      [{ tool_name: 'Write', cwd: context.workspace, tool_input: {
        file_path: '.git/config', content: 'forged',
      } }, /repository control metadata/],
      [{ name: 'functions.apply_patch', cwd: context.workspace, arguments: {
        patch: '*** Begin Patch\n*** Add File: .gitmodules\n+forged\n*** End Patch',
      } }, /repository control metadata/],
      [{ tool_name: 'git_commit', cwd: context.workspace, tool_input: { message: 'change' } }, /explicit registered external adapter/],
      [{ tool_name: 'git_push', cwd: context.workspace, tool_input: { remote: 'origin' } }, /explicit registered external adapter/],
      [{ name: 'github.create_pull_request', cwd: context.workspace, arguments: { draft: true } }, /explicit registered external adapter/],
      [{ name: 'tracker.comment', cwd: context.workspace, arguments: { body: 'status' } }, /explicit registered external adapter/],
      [editEvent, /No current, exactly bound pending/],
    ]) {
      assert.throws(() => preToolUse(event), expected);
    }
    assert.equal(preToolUse({ tool_name: 'Read', cwd: context.workspace, tool_input: {
      file_path: 'app.js',
    } }).reason, 'read_only_allowlist');
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test('hook registration covers provider-neutral pre/post enforcement', () => {
  const codexManifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(codexManifest.hooks, './hooks/hooks.json');
  assert.equal(path.resolve(ROOT, codexManifest.hooks), path.join(ROOT, 'hooks', 'hooks.json'));
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8')).hooks;
  assert.ok(hooks.PreToolUse.some((entry) => entry.matcher === '.*'
    && entry.hooks.some((hook) => hook.command.includes('capability-gate.mjs')
      && /\s+pre$/.test(hook.command))));
  assert.ok(hooks.PostToolUse.some((entry) => entry.matcher === '.*'
    && entry.hooks.some((hook) => hook.command.includes('capability-gate.mjs')
      && /\s+post$/.test(hook.command))));
  assert.equal(hooks.PreToolUse.find((entry) => entry.matcher === '.*').hooks.length, 1);
  for (const phase of ['PreToolUse', 'PostToolUse']) {
    const commands = hooks[phase].flatMap((entry) => entry.hooks.map((hook) => hook.command));
    assert.ok(commands.some((command) => command.includes('${PLUGIN_ROOT}')));
  }

  const capabilityCommand = hooks.PreToolUse
    .find((entry) => entry.matcher === '.*').hooks
    .find((hook) => hook.command.includes('capability-gate.mjs')).command;
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-hook-registration-'));
  const isolatedWorkspace = path.join(isolatedRoot, 'workspace');
  const isolatedData = path.join(isolatedRoot, 'data');
  fs.mkdirSync(isolatedWorkspace);
  const codexInvocation = spawnSync(capabilityCommand, {
    cwd: isolatedWorkspace,
    shell: true,
    input: JSON.stringify({ name: 'functions.read_file', cwd: isolatedWorkspace, arguments: {} }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PHANTOM_DATA: isolatedData,
      CLAUDE_PLUGIN_ROOT: '',
      PLUGIN_ROOT: ROOT,
    },
  });
  assert.equal(codexInvocation.status, 0, codexInvocation.stderr);
  assert.equal(JSON.parse(codexInvocation.stdout).phantom.reason, 'read_only_allowlist');

  const previousData = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = isolatedData;
  const doctor = spawnSync(process.execPath, [HOOK, 'doctor', isolatedWorkspace], {
    encoding: 'utf8',
    env: { ...process.env, PHANTOM_DATA: isolatedData },
  });
  assert.equal(doctor.status, 0, doctor.stderr);
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.schema_version, 3);
  assert.equal(report.status, 'not_applicable');
  assert.equal(report.verifier_bundled, true);
  assert.equal(report.backend_bundled, false);
  assert.deepEqual(report.migration, {
    status: 'not_required',
    reason: 'no_current_session',
    resource: 'scripts/migrate-session-state.mjs',
    command: null,
  });
  assert.deepEqual(
    [report.native.status, report.host.status, report.isolated.status],
    ['not_applicable', 'not_applicable', 'not_applicable'],
  );

  const migrationLock = path.join(isolatedData, 'locks', '.session-state-migration.lock');
  fs.mkdirSync(path.dirname(migrationLock), { recursive: true });
  fs.writeFileSync(migrationLock, 'not trusted lock metadata\n', { mode: 0o600 });
  const lockedDoctor = spawnSync(process.execPath, [HOOK, 'doctor', isolatedWorkspace], {
    encoding: 'utf8',
    env: { ...process.env, PHANTOM_DATA: isolatedData },
  });
  assert.equal(lockedDoctor.status, 0, lockedDoctor.stderr);
  const lockedReport = JSON.parse(lockedDoctor.stdout);
  assert.equal(lockedReport.status, 'blocked');
  assert.deepEqual(lockedReport.migration, {
    status: 'blocked',
    reason: 'migration_in_progress_or_recovery_required',
    resource: 'scripts/migrate-session-state.mjs',
    command: null,
  });
  assert.deepEqual(lockedReport.native.problems, [{
    code: 'migration_in_progress_or_recovery_required',
  }]);

  fs.rmSync(migrationLock, { force: true });
  const recoveryClaim = path.join(
    isolatedData,
    'locks',
    '.session-state-migration.recovery.lock',
  );
  fs.writeFileSync(recoveryClaim, 'not trusted recovery metadata\n', { mode: 0o600 });
  const recoveryDoctor = spawnSync(process.execPath, [HOOK, 'doctor', isolatedWorkspace], {
    encoding: 'utf8',
    env: { ...process.env, PHANTOM_DATA: isolatedData },
  });
  assert.equal(recoveryDoctor.status, 0, recoveryDoctor.stderr);
  const recoveryReport = JSON.parse(recoveryDoctor.stdout);
  assert.deepEqual(recoveryReport, lockedReport);
  assert.doesNotMatch(
    JSON.stringify(recoveryReport),
    /inventory|session-state-migration/,
  );

  const malformed = spawnSync(process.execPath, [HOOK, 'pre'], {
    cwd: ROOT,
    input: '{',
    encoding: 'utf8',
  });
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /capability gate denied/);
  if (previousData === undefined) delete process.env.PHANTOM_DATA;
  else process.env.PHANTOM_DATA = previousData;
  fs.rmSync(isolatedRoot, { recursive: true, force: true });
});
