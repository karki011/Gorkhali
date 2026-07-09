#!/usr/bin/env node
// Author: Subash Karki
// blade-model-gate.js - PreToolUse hook enforcing two implementer model rules
// on Agent/Task spawns.
//
// RULE 1 (fable-deny): blade|sweep|ward|lens|warden are implementer agents -
// none may run on a Fable-tier model (bare alias "fable" or full id like
// "claude-fable-5"). Fable is reserved for Apex/Sage-level judgment calls.
// Matching on subagent_type is EXACT and case-insensitive after stripping the "phantom:" prefix -
// never substring - so "phantom:reference:blade-conventions" does not match
// "blade". config.yaml model overrides (see evals/evals.json) surface here as
// an explicit `model:` param on the spawn, so this gate sees them same as any
// other explicit choice.
//
// RULE 2 (blade missing-model): blade.md now pins model: sonnet, so an omitted
// model falls back to the pin - RULE 2 is kept as defense-in-depth so Apex
// always makes the routing choice explicitly instead of leaning on fallback
// behavior. Any Agent/Task spawn targeting blade must set model explicitly
// (sonnet/haiku/opus all pass); any other agent is untouched by this rule.
//
// FAIL-OPEN POLARITY — read this before editing: any crash or ambiguity in
// the enforce path must ALLOW the spawn (never block on the gate's own bug).
// Escape hatch: PHANTOM_BLADE_MODEL_GATE=0 makes the gate a no-op (armed by
// default otherwise). Always exits 0 — the decision rides the stdout JSON.
'use strict';

const fs = require('fs');

const IMPLEMENTER_AGENTS = new Set(['blade', 'sweep', 'ward', 'lens', 'warden']);

function main() {
  if (process.env.PHANTOM_BLADE_MODEL_GATE === '0') return;

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (_) {
    return; // unparseable stdin → allow
  }

  try {
    const toolName = payload.tool_name;
    if (toolName !== 'Agent' && toolName !== 'Task') return;

    const toolInput = payload.tool_input || {};
    const rawType = toolInput.subagent_type || '';
    const name = rawType.replace(/^phantom:/i, '').toLowerCase();
    const model = toolInput.model;

    // RULE 1: fable-deny - must run before RULE 2's non-empty-model early
    // return, or an explicit model:"fable" on a blade spawn would already
    // satisfy RULE 2 and never reach this check.
    if (IMPLEMENTER_AGENTS.has(name) && typeof model === 'string' && /fable/i.test(model)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'IMPLEMENTER MODEL GATE: Fable is a top-tier reasoning model reserved ' +
            'for Apex/Sage-level judgment calls, not implementer subtasks ' +
            '("blade", "sweep", "ward", "lens", "warden"). Re-spawn with model: ' +
            '"opus" for complex/ambiguous work, or model: "sonnet" for ' +
            'well-scoped, contract-backed subtasks. See reference/agents.md → ' +
            'Model Routing.',
        },
      }));
      return;
    }

    // RULE 2: blade missing-model (unchanged)
    if (name !== 'blade') return;
    if (typeof model === 'string' && model.trim() !== '') return; // explicit choice made

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'BLADE MODEL GATE: Blade has no default model — you must set model: ' +
          'explicitly on the spawn. Use model: "sonnet" for well-scoped, ' +
          'contract-backed subtasks; escalate to model: "opus" for complex, ' +
          'ambiguous, or cross-cutting work; model: "haiku" only for trivial ' +
          'mechanical single-file edits. Re-spawn with an explicit model:. ' +
          'See reference/agents.md → Model Routing.',
      },
    }));
  } catch (_) {
    // fail OPEN — a discipline gate never blocks on its own bugs
  }
}

try {
  main();
} catch (_) { /* fail open */ }
process.exit(0);
