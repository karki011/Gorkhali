#!/usr/bin/env node
// Author: Subash Karki
// role-model-gate.js - PreToolUse hook on Agent|Task spawns. Denies a spawn
// whose explicit `model:` param contradicts the tier its role resolves to.
//
// Role -> tier comes from config/role-tiers.json; tier -> model for the
// current host comes from lib/tiers.js (config/hosts/claude-code.json).
// A spawn with no explicit model, or for a role outside role-tiers.json, is
// untouched - this gate only catches an EXPLICIT contradiction, it never
// invents a requirement to set model at all.
//
// FAIL OPEN: any read/parse error, or an unresolved tier/host mapping,
// allows the spawn. Always exits 0 - the decision rides the stdout JSON.
'use strict';

const fs = require('fs');
const { tierForRole, modelForTier } = require('../lib/tiers');

const HOST = 'claude-code';

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (_) {
    return; // unparseable stdin -> allow
  }

  const toolName = payload.tool_name;
  if (toolName !== 'Agent' && toolName !== 'Task') return;

  const toolInput = payload.tool_input || {};
  const model = toolInput.model;
  if (typeof model !== 'string' || !model.trim()) return; // nothing explicit to contradict

  const rawType = toolInput.subagent_type || '';
  const role = String(rawType).replace(/^gorkhali:/i, '').toLowerCase();

  const tier = tierForRole(role);
  if (!tier) return; // role not in config/role-tiers.json -> untouched

  const expected = modelForTier(tier, HOST);
  if (!expected) return; // no host mapping -> fail open

  const explicit = model.trim().toLowerCase();
  const wanted = expected.toLowerCase();
  if (explicit === wanted || explicit.includes(wanted)) return; // matches -> allow

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `ROLE MODEL GATE: role "${role}" is tier "${tier}", which resolves to ` +
        `model "${expected}" on host "${HOST}". Got explicit model "${model}". ` +
        `Re-spawn with model: "${expected}", or omit model to inherit the tier default.`,
    },
  }));
}

try {
  main();
} catch (_) {
  // fail OPEN - a discipline gate never blocks on its own bugs
}
process.exit(0);
