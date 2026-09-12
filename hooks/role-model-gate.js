#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { allowedTiers, tierForModel, modelForTier } = require('../lib/tiers');
function main() {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!['Agent', 'Task'].includes(payload.tool_name)) return;
  const input = payload.tool_input || {};
  const role = String(input.subagent_type || '').replace(/^gorkhali:/i, '').toLowerCase();
  const allowed = allowedTiers(role);
  if (!allowed.length) return;
  let model = input.model;
  if (!model) {
    const dir = process.env.ROLE_MODEL_GATE_AGENTS_DIR || path.join(__dirname, '..', 'agents');
    const text = fs.readFileSync(path.join(dir, `${role}.md`), 'utf8');
    model = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1].match(/^model:\s*(\S+)\s*$/m)?.[1];
    if (!model) return;
  }
  if (allowed.includes(tierForModel(model))) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: `ROLE MODEL GATE: ${role} allows ${allowed.join(', ')}. Use ${allowed.map((tier) => modelForTier(tier)).join(' or ')}; received ${model}.`,
  } }));
}
// Unknown roles and unavailable frontmatter preserve the host's fail-open policy.
try { main(); } catch (_) { /* no reliable routing decision */ }
