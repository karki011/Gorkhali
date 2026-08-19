#!/usr/bin/env node
// Author: Subash Karki
// engineer-model-gate.js - PreToolUse hook enforcing two implementer model rules
// and the roster name rule on Agent/Task spawns.
//
// RULE 1 (fable-deny): engineer|steward|inspector|surveyor|clerk are bounded worker agents -
// none may run on a Fable-tier model (bare alias "fable" or full id like
// "claude-fable-5"). Fable is retired from Phantom's routing; this rule stays as
// a defensive guard so a stray fable pin never reaches an implementer. Note the
// gate does NOT enforce the current "every delegated role runs sonnet" mapping:
// that lives in model-presets.json, and a user's explicit model choice is still
// theirs to make (reference/agents.md -> Model Routing, Precedence).
// Matching on subagent_type is EXACT and case-insensitive after stripping the "phantom:" prefix -
// never substring - so "phantom:reference:engineer-conventions" does not match
// "engineer". config.yaml model overrides (see evals/evals.json) surface here as
// an explicit `model:` param on the spawn, so this gate sees them same as any
// other explicit choice.
//
// RULE 3 (name gate): every Phantom-role spawn must carry a `name:` param drawn
// from reference/roster.md. The spawn's `name:`, its agent-records stub filename
// and hooks/wake-classifier.js's `payload.agent_type` are all the SAME string, so
// a name-less spawn is unresolvable at wake time, and a WRONG name binds the
// completion to some other site's stub. Three layers, cheapest first:
//   3a SYNTAX   - matches NAME_RE.
//   3b PREFIX   - starts with the spawn's own role, or a documented naming alias
//                 for it (scout and council names ride on `engineer` spawns).
//                 This layer needs no file and always runs.
//   3c IDENTITY - the character/function segment is one roster.md actually
//                 defines, or one of the dynamic shapes roster.md defines by
//                 GRAMMAR rather than by listing ({role}-{N}, {role}-task-{N},
//                 {role}-backfill-{B}-{S}, {role}-redo-{N}, advisor-{parent name}).
//                 ADVISORY SOURCE, same discipline as the policy read below:
//                 unreadable or unparseable roster.md skips 3c silently and
//                 allows - the gate never blocks because it could not read a doc.
// Matching uses the same exact, prefix-stripped, case-insensitive role name as
// the rules above, so non-Phantom agent types (general-purpose, Explore,
// statusline-setup, ...) and `phantom:reference:*` docs pass through untouched.
//
// RULE 2 (engineer missing-model): engineer.md carries a generated `model:` pin (see
// scripts/gen-agent-frontmatter.js), so an omitted model falls back to the pin -
// RULE 2 is kept as defense-in-depth so Chief always makes the routing choice
// explicitly instead of leaning on fallback behavior. Any Agent/Task spawn
// targeting engineer must set model explicitly (any non-fable value passes); any
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

const FABLE_DENIED_WORKERS = new Set(['engineer', 'steward', 'inspector', 'surveyor', 'clerk']);

// Roles carried by reference/roster.md - every one of them has a static name and
// a `agent-records/<name>.json` stub, so RULE 3 requires a `name:` on their
// spawns. `chief` is absent on purpose: it is the orchestrator, never spawned as
// a named worker.
const ROSTER_ROLES = new Set([
  'engineer', 'justice', 'auditor', 'inspector', 'detective', 'surveyor', 'steward',
  'opposition', 'advisor', 'clerk',
]);

const NAME_RE = /^[a-z][a-z0-9-]*$/;

// Roles whose NAMES legitimately ride on a different `subagent_type`. Scouts and
// Council members are read-only Engineer spawns, so their distinct names prevent
// either role from being mistaken for an implementation Engineer.
const NAME_ROLE_ALIASES = { engineer: ['scout', 'council'] };

const POLICY_FILE = path.join(
  __dirname, '..', 'skills', 'phantom', 'references', 'model-policy.json'
);

const ROSTER_FILE = path.join(__dirname, '..', 'reference', 'roster.md');

// Roles that may consult Advisor, and therefore the only roles an `advisor-{parent}`
// name may derive from: the ones whose agent definition cites
// reference/_base-agent.md's Advisor Escalation (Auditor and Clerk opt out). Parsed
// from roster.md's Ad Hoc section when its wording still matches, since that is
// the SSoT; this constant is the fallback when it does not. `advisor` itself is
// never a parent - Advisor cannot escalate to itself.
const ADVISOR_PARENT_ROLES = ['engineer', 'inspector', 'steward', 'justice'];

// The four role names out of roster.md's Advisor bullet ("today that is Engineer,
// Inspector, Steward, and Justice"), or the constant above when that sentence has been
// reworded. Never returns `advisor`.
function advisorParentRoles(text) {
  const m = text.match(/Advisor Escalation is inherited by[\s\S]{0,200}?today that is ([^(.]+)/);
  const parsed = m
    ? m[1].toLowerCase().split(/,|\band\b/).map((s) => s.trim()).filter((s) => /^[a-z][a-z-]*$/.test(s))
    : [];
  const roles = parsed.length > 0 ? parsed : ADVISOR_PARENT_ROLES;
  return new Set(roles.filter((r) => r !== 'advisor'));
}

// Roles, per-role roster LENGTHS, and full names reference/roster.md defines, or
// null when the file is missing or yields nothing parseable. Deliberately
// TOLERANT: roles and lengths come from the Roster Table's `| role | a, b, c |`
// rows, names from every backticked `{role}-{...}` token anywhere in the file
// (roster rows, slot tables, the ad hoc and fan-out sections). Over-collecting
// only ever makes layer 3c more permissive, which is the correct direction for a
// live gate; a role whose length does not parse simply skips its range check.
function rosterIndex() {
  try {
    const text = fs.readFileSync(ROSTER_FILE, 'utf-8');
    const roles = new Set();
    const lengths = new Map();
    const names = new Set();
    for (const m of text.matchAll(/^\|\s*([a-z][a-z-]*)\s*\|(.*)\|\s*$/gm)) {
      roles.add(m[1]);
      // Slot annotations like *(1-8, execute-wave reserved)* carry their own
      // commas - strip them before splitting, or they inflate the count.
      const slots = m[2]
        .replace(/\*\([^)]*\)\*/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^[a-z][a-z-]*$/.test(s));
      if (slots.length > 0) lengths.set(m[1], slots.length);
      // The table lists characters UNQUALIFIED ("varek, dunmar, ..."), so they
      // must be qualified here. The backtick harvest below cannot stand in for
      // this: it only sees names some prose happens to spell out, which covers
      // the dedicated slot-table sites but misses most execute-wave characters
      // (engineer/inspector slots 1-8 are derived, never written out) - and every one
      // of those is a legal spawn name.
      for (const slot of slots) names.add(m[1] + '-' + slot);
    }
    // Function names (justice-scope, council-mvp), reference-level sites, and the
    // ad hoc/fan-out sections only ever appear as backticked full strings.
    for (const m of text.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g)) names.add(m[1]);
    if (roles.size === 0 || names.size === 0) return null; // unparseable → skip 3c
    return { roles, lengths, names, advisorParents: advisorParentRoles(text) };
  } catch (_) {
    return null; // unreadable → skip 3c
  }
}

// Task indexes 1-8 derive CHARACTER names, so the execute-wave band-overflow
// shape starts at 9 (reference/roster.md → Execute-Wave Reservation).
const EXECUTE_WAVE_BAND = 8;

// Roles that participate in execute-wave task-index derivation, and therefore
// the only ones the `-task-` shape may name.
const EXECUTE_WAVE_ROLES = new Set(['engineer', 'inspector']);

// A 1-based decimal index, no leading zeros - roster names are canonical
// strings, so `engineer-024` is not a second spelling of `engineer-24`.
const INDEX_RE = /^[1-9]\d*$/;

// Is `name` (already known to start with `role-`) one roster.md defines, either
// by listing it or by one of its dynamic-shape grammars? Each grammar carries a
// role set and a valid RANGE - an in-shape string outside its range names a slot
// that belongs to some other site (`engineer-9` is `engineer-dovrin`'s), which is
// exactly the stub collision this gate exists to stop.
// A dynamic shape's RANGE VERDICT IS FINAL - it must be decided before the
// listed-name fallback, never after. roster.md's prose cites out-of-range
// strings as counterexamples (Rule 3 spells out `engineer-9` and `scout-6` as the
// forms a site must NOT use), so the tolerant name harvest contains them; a
// names-first order would let exactly the strings the roster forbids through.
function nameIsKnown(role, name, index) {
  const rest = name.slice(role.length + 1);
  let m;

  // Roster-length overflow: only past the END of this role's own roster.
  if (INDEX_RE.test(rest)) {
    const length = index.lengths.get(role);
    return length === undefined || Number(rest) > length;
  }
  // Execute-wave band overflow: engineer/inspector only, and only past the 1-8 band.
  if ((m = rest.match(/^task-(\d+)$/))) {
    return EXECUTE_WAVE_ROLES.has(role)
      && INDEX_RE.test(m[1])
      && Number(m[1]) > EXECUTE_WAVE_BAND;
  }
  // evolve.md Tier 3 backfill fan-out: engineer only, both indexes 1-based.
  // Deliberately NO upper bound on slotInBatch: roster.md's "≤ 5" bounds
  // TICKETS per Engineer, not Engineers per batch, so a batch's slot count is
  // unbounded in the same way its ticket count is.
  if ((m = rest.match(/^backfill-(\d+)-(\d+)$/))) {
    return role === 'engineer' && INDEX_RE.test(m[1]) && INDEX_RE.test(m[2]);
  }
  // fix.md scrap-and-redo: engineer only, 1-based fix-packet owner position.
  if ((m = rest.match(/^redo-(\d+)$/))) {
    return role === 'engineer' && INDEX_RE.test(m[1]);
  }
  // Rule 4: advisor-{parent's own full spawn name}. Only the escalation-eligible
  // roles can be a parent, so `advisor-clerk-scrivet` and `advisor-auditor-ledgard` are
  // shapes the roster can never assign - and `advisor` is not among them, so an
  // Advisor consultation can never itself be consulted (`advisor-advisor-*`). Decisive:
  // an advisor name that derives from nothing does not fall through to the
  // listed-name lookup below.
  if (role === 'advisor') {
    for (const parent of index.advisorParents) {
      if (rest.startsWith(parent + '-') && nameIsKnown(parent, rest, index)) return true;
    }
    return false;
  }
  // No dynamic shape claimed it: it must be a character or function roster.md
  // actually assigns.
  return index.names.has(name);
}

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

// RULE 3's decision for a spawn of `role`: a sentence describing the violation,
// or '' when the name is acceptable. Layers 3a/3b are self-contained; 3c only
// runs when roster.md parsed.
function nameViolation(role, rawName) {
  if (typeof rawName !== 'string' || !NAME_RE.test(rawName.trim())) {
    return 'every Phantom-role spawn must pass a roster name as name: - "' + role +
      '" was spawned with ' +
      (rawName === undefined ? 'no name:' : 'name: ' + JSON.stringify(rawName)) +
      ', which is not a lowercase roster name (' + NAME_RE.source + ').';
  }
  const spawnName = rawName.trim();

  const prefixes = [role].concat(NAME_ROLE_ALIASES[role] || []);
  const namedRole = prefixes.find((p) => spawnName.startsWith(p + '-'));
  if (!namedRole) {
    return 'name "' + spawnName + '" does not belong to a "' + role + '" spawn - a ' +
      'roster name starts with its own role (' +
      prefixes.map((p) => '"' + p + '-"').join(' or ') + ').';
  }

  const index = rosterIndex();
  if (index && !nameIsKnown(namedRole, spawnName, index)) {
    return 'name "' + spawnName + '" is not in reference/roster.md - no slot, ' +
      'function, or dynamic shape ({role}-{N}, {role}-task-{N}, ' +
      '{role}-backfill-{B}-{S}, {role}-redo-{N}, advisor-{parent name}) produces it.';
  }
  return '';
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
    // return, or an explicit model:"fable" on an engineer spawn would already
    // satisfy RULE 2 and never reach this check.
    if (FABLE_DENIED_WORKERS.has(name) && typeof model === 'string' && /fable/i.test(model)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `WORKER MODEL GATE: Fable is not legal for Phantom role "${name}". ` +
            'Re-spawn with the model this role\'s ' +
            'policy profile resolves to.' + policyGuidance(name) +
            ' See reference/agents.md → Model Routing.',
        },
      }));
      return;
    }

    // RULE 3: name gate - must run before RULE 2's non-engineer early return, or
    // every non-engineer roster role would exit before ever being name-checked.
    if (ROSTER_ROLES.has(name)) {
      const nameDenial = nameViolation(name, toolInput.name);
      if (nameDenial) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              'AGENT NAME GATE: ' + nameDenial + ' The spawn\'s name:, its ' +
              'agent-records/<name>.json stub filename and the SendMessage resume ' +
              'target are the SAME string, so a wrong or missing name binds the ' +
              'completion to the wrong stub - or to none. Re-spawn with the static ' +
              'name this spawn site\'s slot resolves to. See reference/roster.md → ' +
              'Spawn-Site Slot Table.',
          },
        }));
        return;
      }
    }

    // RULE 2: engineer missing-model (unchanged)
    if (name !== 'engineer') return;
    if (typeof model === 'string' && model.trim() !== '') return; // explicit choice made

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'ENGINEER MODEL GATE: Engineer has no default model — you must set model: ' +
          'explicitly on the spawn.' + policyGuidance(name) +
          ' Resolve the role profile rather than guessing an alias; a subtask ' +
          'that feels too big for the resolved model needs re-decomposing, not ' +
          'a hand-picked one. Re-spawn with an explicit model:. ' +
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
