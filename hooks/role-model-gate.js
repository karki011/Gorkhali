#!/usr/bin/env node
// Author: Subash Karki
// role-model-gate.js - PreToolUse hook on Agent|Task spawns. Denies a spawn
// whose model contradicts the tier its role resolves to - whether that
// model came in as an explicit `model:` param, or (with none given) is the
// model the role's own agents/<role>.md frontmatter would supply instead.
//
// Role -> tier comes from config/role-tiers.json; tier -> model for the
// current host comes from lib/tiers.js (config/hosts/claude-code.json). A
// role outside role-tiers.json is untouched - this gate only catches an
// EXPLICIT contradiction between the tier and the model that will actually
// run, it never invents a requirement to set model at all.
//
// FAIL OPEN: any read/parse error, or an unresolved tier/host/frontmatter
// mapping, allows the spawn. Always exits 0 - the decision rides the stdout
// JSON.
'use strict';

const fs = require('fs');
const path = require('path');
const { tierForRole, modelForTier } = require('../lib/tiers');

const HOST = 'claude-code';
// ROLE_MODEL_GATE_AGENTS_DIR overrides where agent frontmatter is read from,
// same pattern as GORKHALI_DATA elsewhere - test isolation only; unset in
// real use, so the real agents/ dir is always what ships.
const AGENTS_DIR = process.env.ROLE_MODEL_GATE_AGENTS_DIR
  ? path.resolve(process.env.ROLE_MODEL_GATE_AGENTS_DIR)
  : path.join(__dirname, '..', 'agents');
const ROLE_RE = /^[a-z][a-z-]*$/;

// The `model:` value from agents/<role>.md's frontmatter (between the first
// two `---` lines), or null when the role, file, or field can't be read.
function frontmatterModel(role) {
  if (!ROLE_RE.test(role)) return null;
  let text;
  try {
    text = fs.readFileSync(path.join(AGENTS_DIR, `${role}.md`), 'utf-8');
  } catch (_) {
    return null;
  }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const line = match[1].match(/^model:\s*(\S+)\s*$/m);
  return line ? line[1] : null;
}

function matches(actual, expected) {
  const a = actual.trim().toLowerCase();
  const e = expected.trim().toLowerCase();
  return a === e || a.includes(e);
}

function deny(role, tier, expected, got, source) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `ROLE MODEL GATE: role "${role}" is tier "${tier}", which resolves to ` +
        `model "${expected}" on host "${HOST}". ${source} is "${got}". ` +
        `Re-spawn with model: "${expected}", omit model to inherit the tier ` +
        `default, or fix agents/${role}.md's frontmatter to match.`,
    },
  }));
}

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

  const rawType = toolInput.subagent_type || '';
  const role = String(rawType).replace(/^gorkhali:/i, '').toLowerCase();

  const tier = tierForRole(role);
  if (!tier) return; // role not in config/role-tiers.json -> untouched

  const expected = modelForTier(tier, HOST);
  if (!expected) return; // no host mapping -> fail open

  if (typeof model === 'string' && model.trim()) {
    // Explicit model given - it must agree with the tier.
    if (matches(model, expected)) return;
    deny(role, tier, expected, model, 'Got explicit model');
    return;
  }

  // No explicit model - the role's own agent frontmatter supplies one
  // instead, so that must agree with the tier too.
  const fromFrontmatter = frontmatterModel(role);
  if (!fromFrontmatter) return; // can't verify -> fail open
  if (matches(fromFrontmatter, expected)) return;
  deny(role, tier, expected, fromFrontmatter, `agents/${role}.md's frontmatter model`);
}

try {
  main();
} catch (_) {
  // fail OPEN - a discipline gate never blocks on its own bugs
}
process.exit(0);
