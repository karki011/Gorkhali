// Author: Subash Karki
// blade-model-gate.test.js — locks the PreToolUse gate that denies Blade
// spawns missing an explicit `model:`. FAIL-OPEN: any ambiguity, non-blade
// agent, non-Agent/Task tool, or unparseable stdin ALLOWS. Escape hatch:
// PHANTOM_BLADE_MODEL_GATE=0 always allows. Always exits 0 — the decision
// rides the stdout JSON.
//
// Spawns the REAL hook process (seam-integration pattern), matching
// greploop-gate.test.js / fix-loop-gate.test.js: JSON payload on stdin,
// assert on stdout only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'blade-model-gate.js');

function runGate(input, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  const stdinText = typeof input === 'string' ? input : JSON.stringify(input);
  try {
    const stdout = execFileSync('node', [HOOK], {
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

function bladeSpawn(toolInput = {}) {
  return { tool_name: 'Agent', tool_input: { subagent_type: 'blade', ...toolInput } };
}

function assertDeny(res) {
  assert.equal(res.code, 0, 'decision rides the JSON, not the exit code');
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /BLADE MODEL GATE/);
}

function assertAllow(res, msg) {
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), '', msg || 'an allow carries no decision JSON');
}

test('1. blade spawn, no model → DENY', () => {
  const res = runGate(bladeSpawn());
  assertDeny(res);
});

test('2. blade spawn WITH model:"sonnet" → ALLOW', () => {
  const res = runGate(bladeSpawn({ model: 'sonnet' }));
  assertAllow(res);
});

test('3. subagent_type:"phantom:blade" (prefixed), no model → DENY (prefix stripping)', () => {
  const res = runGate({ tool_name: 'Agent', tool_input: { subagent_type: 'phantom:blade' } });
  assertDeny(res);
});

test('4. model:"   " (whitespace-only), blade → DENY (treated as empty)', () => {
  const res = runGate(bladeSpawn({ model: '   ' }));
  assertDeny(res);
});

test('5. non-blade agent (gaze), no model → ALLOW', () => {
  const res = runGate({ tool_name: 'Agent', tool_input: { subagent_type: 'gaze' } });
  assertAllow(res);
});

test('6. tool_name not Agent/Task (e.g. Edit) with blade-ish input → ALLOW', () => {
  const res = runGate({ tool_name: 'Edit', tool_input: { subagent_type: 'blade' } });
  assertAllow(res);
});

test('7. escape hatch PHANTOM_BLADE_MODEL_GATE=0 → ALLOW even without model', () => {
  const res = runGate(bladeSpawn(), { PHANTOM_BLADE_MODEL_GATE: '0' });
  assertAllow(res, 'escape hatch disables the gate entirely');
});

test('8. garbage/non-JSON stdin → ALLOW, exit 0', () => {
  const res = runGate('{{{not json');
  assertAllow(res, 'unparseable stdin must fail open');
});
