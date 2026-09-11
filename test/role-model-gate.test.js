// Author: Subash Karki
// role-model-gate.test.js - locks the PreToolUse gate that denies an
// Agent/Task spawn whose explicit `model:` contradicts the model its role's
// tier resolves to on config/hosts/claude-code.json. FAIL-OPEN: any
// ambiguity, missing model, non-tiered role, or unparseable stdin ALLOWS.
// Spawns the real hook process (seam-integration pattern, the same pattern
// every hook test in this suite follows): JSON payload on stdin, assert on
// stdout only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'role-model-gate.js');

function run(input, agentsDir) {
  const stdinText = typeof input === 'string' ? input : JSON.stringify(input);
  const env = agentsDir
    ? { ...process.env, ROLE_MODEL_GATE_AGENTS_DIR: agentsDir }
    : process.env;
  try {
    const stdout = execFileSync('node', [HOOK], { input: stdinText, encoding: 'utf-8', env });
    return { code: 0, stdout };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : -1, stdout: (e.stdout || '').toString() };
  }
}

// A fixture agents/ dir with one role's frontmatter model set explicitly,
// for exercising the no-explicit-model path against a known mismatch or
// match without touching the real agents/ files.
function fixtureAgentsDir(role, model) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-model-gate-agents-'));
  fs.writeFileSync(
    path.join(dir, `${role}.md`),
    `---\nname: ${role}\nmodel: ${model}\n---\n\n# ${role}\n`
  );
  return dir;
}

function spawn(subagentType, toolInput = {}) {
  return {
    tool_name: 'Agent',
    tool_input: { subagent_type: subagentType, ...toolInput },
  };
}

function assertDeny(res) {
  assert.equal(res.code, 0, 'decision rides the JSON, not the exit code');
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /ROLE MODEL GATE/);
}

function assertAllow(res) {
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), '', 'an allow carries no decision JSON');
}

test('denies engineer (balanced tier) explicitly spawned on opus', () => {
  assertDeny(run(spawn('engineer', { model: 'opus' })));
});

test('denies auditor (balanced tier) explicitly spawned on haiku', () => {
  assertDeny(run(spawn('auditor', { model: 'haiku' })));
});

test('allows engineer explicitly spawned on its own tier model (sonnet)', () => {
  assertAllow(run(spawn('engineer', { model: 'sonnet' })));
});

test('allows a full model id that contains the tier model as a substring', () => {
  assertAllow(run(spawn('engineer', { model: 'claude-sonnet-5' })));
});

test('allows inspector (economy tier) explicitly spawned on haiku', () => {
  assertAllow(run(spawn('inspector', { model: 'haiku' })));
});

test('allows a spawn with no explicit model', () => {
  assertAllow(run(spawn('engineer', {})));
});

test('allows a role outside config/role-tiers.json regardless of model', () => {
  assertAllow(run(spawn('general-purpose', { model: 'haiku' })));
});

test('allows a non-Agent/Task tool untouched', () => {
  assertAllow(run({ tool_name: 'Edit', tool_input: { model: 'haiku' } }));
});

test('strips a gorkhali: prefix before resolving the role', () => {
  assertDeny(run(spawn('gorkhali:engineer', { model: 'opus' })));
});

test('allows unparseable stdin', () => {
  assertAllow(run('not json'));
});

test('denies a spawn with no explicit model when its own agent frontmatter contradicts the tier', () => {
  const dir = fixtureAgentsDir('engineer', 'opus');
  assertDeny(run(spawn('engineer', {}), dir));
});

test('allows a spawn with no explicit model when its own agent frontmatter agrees with the tier', () => {
  const dir = fixtureAgentsDir('engineer', 'sonnet');
  assertAllow(run(spawn('engineer', {}), dir));
});

test('allows a spawn with no explicit model when the frontmatter cannot be read (fail open)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-model-gate-empty-'));
  assertAllow(run(spawn('engineer', {}), dir));
});

test('detective (deep tier) resolves to opus, matching its real agent frontmatter', () => {
  assertAllow(run(spawn('detective', {})));
});

test('auditor (now balanced tier) resolves to sonnet, matching its real agent frontmatter', () => {
  assertAllow(run(spawn('auditor', {})));
});
