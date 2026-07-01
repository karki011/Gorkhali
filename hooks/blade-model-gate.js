#!/usr/bin/env node
// Author: Subash Karki
// blade-model-gate.js — PreToolUse hook that denies Blade spawns missing an
// explicit `model:` on the tool call.
//
// WHY: the `blade` agent has no frontmatter model pin (every other agent is
// pinned or intentionally inherits), so an omitted `model:` silently inherits
// the session model — usually Opus, the expensive ceiling. This gate makes
// that omission impossible: any Agent/Task spawn targeting blade must set
// model explicitly (sonnet/haiku/opus all pass); any other agent is untouched.
//
// FAIL-OPEN POLARITY — read this before editing: any crash or ambiguity in
// the enforce path must ALLOW the spawn (never block on the gate's own bug).
// Escape hatch: PHANTOM_BLADE_MODEL_GATE=0 makes the gate a no-op (armed by
// default otherwise). Always exits 0 — the decision rides the stdout JSON.
'use strict';

const fs = require('fs');

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
    const name = rawType.replace(/^phantom:/, '');
    if (name !== 'blade') return;

    const model = toolInput.model;
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
