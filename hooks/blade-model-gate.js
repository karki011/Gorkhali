#!/usr/bin/env node
// Author: Subash Karki
// blade-model-gate.js - PreToolUse hook enforcing two implementer model rules
// on Agent/Task spawns.
//
// RULE 1 (fable-deny): blade|sweep|ward|lens|warden are implementer agents -
// none may run on a Fable-tier model (bare alias "fable" or full id like
// "claude-fable-5"). Fable is retired from Phantom's routing (opus/Opus 5 is
// the top tier); this rule stays as a defensive guard so a stray fable pin
// never reaches an implementer.
// Matching on subagent_type is EXACT and case-insensitive after stripping the "phantom:" prefix -
// never substring - so "phantom:reference:blade-conventions" does not match
// "blade". config.yaml model overrides (see evals/evals.json) surface here as
// an explicit `model:` param on the spawn, so this gate sees them same as any
// other explicit choice.
//
// RULE 2 (blade missing-model): blade.md carries a generated `model:` pin (see
// scripts/gen-agent-frontmatter.js), so an omitted model falls back to the pin -
// RULE 2 is kept as defense-in-depth so Apex always makes the routing choice
// explicitly instead of leaning on fallback behavior. Any Agent/Task spawn
// targeting blade must set model explicitly (any non-fable value passes); any
// other agent is untouched by this rule.
//
// POLICY READ (advisory): the concrete tier names this gate used to hardcode in
// its deny reasons now come from skills/phantom/references/model-policy.json —
// the single source of truth for role -> profile. The read is ADVISORY ONLY: it
// shapes the wording (which profile the role should run at, whether risk can
// elevate it), never the allow/deny decision, and unreadable policy degrades to
// a generic reason instead of changing behavior. The deny PREDICATES stay
// hardcoded on purpose: policy expresses profiles, not which roles are
// implementers nor which tiers are retired, so deriving the predicates from it
// would widen what this live gate blocks. Concrete model aliases belong in
// model-presets.json and generated agent frontmatter — not here.
//
// FAIL-OPEN POLARITY — read this before editing: any crash or ambiguity in
// the enforce path must ALLOW the spawn (never block on the gate's own bug).
// Escape hatch: PHANTOM_BLADE_MODEL_GATE=0 makes the gate a no-op (armed by
// default otherwise). Always exits 0 — the decision rides the stdout JSON.
'use strict';

const fs = require('fs');
const path = require('path');

const IMPLEMENTER_AGENTS = new Set(['blade', 'sweep', 'ward', 'lens', 'warden']);

// timing-capture.js writes a Blade marker on every Agent/Task spawn attempt, and
// that marker is what permits Apex to write while a subagent is editing. A spawn
// this gate denies never produces a subagent, so its marker would be orphaned: no
// SubagentStop will ever arrive to clear it, and until it expires Apex can edit
// directly with no Blade running at all -- the gate's own denial would hand back
// the permission it exists to withhold. Clearing it here keeps the mutex counting
// only spawns that were actually allowed to happen.
function releaseBladeMarker(payload) {
  try {
    const id = payload.tool_use_id || payload.toolUseId || payload.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return;
    let phantomData;
    let detectRepo;
    try {
      ({ phantomData, detectRepo } = require('../scripts/lib/phantom-paths'));
    } catch (_) {
      return; // resolver unavailable → the marker expires on its own
    }
    const marker = path.join(phantomData(), '.blade-editing.d', detectRepo(payload.cwd), id);
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
  } catch (_) {
    // Never let cleanup failure change the decision.
  }
}

const POLICY_FILE = path.join(
  __dirname, '..', 'skills', 'phantom', 'references', 'model-policy.json'
);

const RESOLVER_HINT =
  'node skills/phantom/scripts/resolve-profile.mjs --role <role> --host <host>';

// Advisory sentence naming the role's policy profile (and whether a critical
// risk elevates it). Returns '' when policy is missing or unparseable — never
// throws, so the gate keeps working without the policy file.
function policyGuidance(role) {
  try {
    const policy = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf-8'));
    const profile = policy.roles[role] || policy.default_profile;
    if (!profile) return '';
    const elevation = policy.critical_elevation || {};
    const elevates = Array.isArray(elevation.eligible_roles)
      && elevation.eligible_roles.includes(role)
      && elevation.profile;
    return ' model-policy.json puts "' + role + '" on profile "' + profile + '"'
      + (elevates
        ? ' and elevates it to "' + elevation.profile + '" at risk "' + elevation.risk + '"'
        : ' and never elevates it')
      + '; resolve that profile to a model with `' + RESOLVER_HINT + '`.';
  } catch (_) {
    return ''; // policy unreadable → generic reason, same decision
  }
}

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
      releaseBladeMarker(payload);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'IMPLEMENTER MODEL GATE: Fable is retired from Phantom\'s routing ' +
            'and is never a legal implementer model for "blade", "sweep", ' +
            '"ward", "lens", or "warden". Re-spawn with the model this role\'s ' +
            'policy profile resolves to.' + policyGuidance(name) +
            ' See reference/agents.md → Model Routing.',
        },
      }));
      return;
    }

    // RULE 2: blade missing-model (unchanged)
    if (name !== 'blade') return;
    if (typeof model === 'string' && model.trim() !== '') return; // explicit choice made

    releaseBladeMarker(payload);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'BLADE MODEL GATE: Blade has no default model — you must set model: ' +
          'explicitly on the spawn.' + policyGuidance(name) +
          ' Stay on the role profile for well-scoped, contract-backed subtasks; ' +
          'raise the assignment risk (not a bare model alias) for complex, ' +
          'ambiguous, or cross-cutting work. Re-spawn with an explicit model:. ' +
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
