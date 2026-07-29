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
const fs = require('fs');
const os = require('os');
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
  return agentSpawn('blade', toolInput);
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

function agentSpawn(subagentType, toolInput = {}) {
  return { tool_name: 'Agent', tool_input: { subagent_type: subagentType, ...toolInput } };
}

function assertImplementerDeny(res) {
  assert.equal(res.code, 0, 'decision rides the JSON, not the exit code');
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /IMPLEMENTER MODEL GATE/);
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

test('9. blade + model:"fable" → DENY (implementer fable-deny)', () => {
  const res = runGate(agentSpawn('blade', { model: 'fable' }));
  assertImplementerDeny(res);
});

test('10. subagent_type:"phantom:sweep" + model:"fable" → DENY (prefix stripped, exact match)', () => {
  const res = runGate(agentSpawn('phantom:sweep', { model: 'fable' }));
  assertImplementerDeny(res);
});

test('11. warden + model:"claude-fable-5" → DENY (full model id, not just bare alias)', () => {
  const res = runGate(agentSpawn('warden', { model: 'claude-fable-5' }));
  assertImplementerDeny(res);
});

test('12. blade + model:"opus" → ALLOW', () => {
  const res = runGate(agentSpawn('blade', { model: 'opus' }));
  assertAllow(res);
});

test('13. sweep with omitted model → ALLOW (frontmatter pin applies, sweep has no missing-model rule)', () => {
  const res = runGate(agentSpawn('sweep'));
  assertAllow(res);
});

test('14. gaze + model:"fable" → ALLOW (not an implementer agent)', () => {
  const res = runGate(agentSpawn('gaze', { model: 'fable' }));
  assertAllow(res);
});

test('15. subagent_type:"phantom:reference:blade-conventions" + model:"fable" → ALLOW (exact-match guard, not substring)', () => {
  const res = runGate(agentSpawn('phantom:reference:blade-conventions', { model: 'fable' }));
  assertAllow(res);
});

test('16. subagent_type:"Blade" (capitalized) + model:"fable" → DENY (case-insensitive matching)', () => {
  const res = runGate(agentSpawn('Blade', { model: 'fable' }));
  assertImplementerDeny(res);
});

test('17. subagent_type:"PHANTOM:SWEEP" (uppercase) + model:"fable" → DENY (case-insensitive, prefix stripped)', () => {
  const res = runGate(agentSpawn('PHANTOM:SWEEP', { model: 'fable' }));
  assertImplementerDeny(res);
});

// ── policy-sourced deny wording (advisory read, never the decision) ─────────

test('18. deny reason names the role\'s model-policy.json profile, not a bare model alias', () => {
  const res = runGate(bladeSpawn());
  const reason = JSON.parse(res.stdout).hookSpecificOutput.permissionDecisionReason;
  const policy = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'skills', 'phantom', 'references', 'model-policy.json'), 'utf8')
  );
  assert.match(reason, new RegExp(`profile "${policy.roles.blade}"`), 'reason states the policy profile');
  assert.match(reason, /critical_elevation|risk "critical"/, 'reason points at the risk-elevation path');
  assert.doesNotMatch(reason, /"(sonnet|haiku|opus)"/, 'concrete aliases live in model-presets.json, not in the gate');
});

test('19. unreadable policy → still DENY with a generic reason (advisory read never changes the decision)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-gate-'));
  const isolated = path.join(dir, 'hooks');
  fs.mkdirSync(isolated);
  const hookCopy = path.join(isolated, 'blade-model-gate.js');
  fs.copyFileSync(HOOK, hookCopy);
  let stdout = '';
  try {
    stdout = execFileSync('node', [hookCopy], {
      input: JSON.stringify(bladeSpawn()),
      encoding: 'utf-8',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const out = JSON.parse(stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /BLADE MODEL GATE/);
  assert.doesNotMatch(
    out.hookSpecificOutput.permissionDecisionReason,
    /model-policy\.json puts/,
    'no policy file → no policy sentence, same decision'
  );
});
