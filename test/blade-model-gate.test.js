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

// RULE 3 (name gate) fires on every roster role and checks the name against
// reference/roster.md, so spawns built here default to that role's real slot-1
// name — the MODEL-rule tests must not trip the name gate instead. The RULE 3
// tests below pass `name:` explicitly (or omit it via `{ name: undefined }`).
const DEFAULT_NAMES = {
  blade: 'blade-kaze',
  sweep: 'sweep-nix',
  ward: 'ward-brann',
  warden: 'warden-gorath',
  gaze: 'gaze-elden',
  lens: 'lens-yara',
  archer: 'archer-sylas',
  hound: 'hound-fenrik',
  rival: 'rival-dask',
  sage: 'sage-blade-kaze',
};

function agentSpawn(subagentType, toolInput = {}) {
  const role = String(subagentType).replace(/^phantom:/i, '').toLowerCase();
  return {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: subagentType,
      name: DEFAULT_NAMES[role] || 'test-agent',
      ...toolInput,
    },
  };
}

function assertWorkerDeny(res) {
  assert.equal(res.code, 0, 'decision rides the JSON, not the exit code');
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /WORKER MODEL GATE/);
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
  const res = runGate(agentSpawn('phantom:blade'));
  assertDeny(res);
});

test('4. model:"   " (whitespace-only), blade → DENY (treated as empty)', () => {
  const res = runGate(bladeSpawn({ model: '   ' }));
  assertDeny(res);
});

test('5. non-blade agent (gaze), no model → ALLOW', () => {
  const res = runGate(agentSpawn('gaze'));
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
  assertWorkerDeny(res);
});

test('10. subagent_type:"phantom:sweep" + model:"fable" → DENY (prefix stripped, exact match)', () => {
  const res = runGate(agentSpawn('phantom:sweep', { model: 'fable' }));
  assertWorkerDeny(res);
});

test('11. warden + model:"claude-fable-5" → DENY (full model id, not just bare alias)', () => {
  const res = runGate(agentSpawn('warden', { model: 'claude-fable-5' }));
  assertWorkerDeny(res);
});

test('11b. lens + model:"fable" → DENY with role-specific guidance', () => {
  const res = runGate(agentSpawn('lens', { model: 'fable' }));
  assertWorkerDeny(res);
  assert.match(JSON.parse(res.stdout).hookSpecificOutput.permissionDecisionReason, /role "lens"/);
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
  assertWorkerDeny(res);
});

test('17. subagent_type:"PHANTOM:SWEEP" (uppercase) + model:"fable" → DENY (case-insensitive, prefix stripped)', () => {
  const res = runGate(agentSpawn('PHANTOM:SWEEP', { model: 'fable' }));
  assertWorkerDeny(res);
});

// ── RULE 3: roster name gate ────────────────────────────────────────────────

function assertNameDeny(res) {
  assert.equal(res.code, 0, 'decision rides the JSON, not the exit code');
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /AGENT NAME GATE/);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /roster\.md/);
}

test('20. blade spawn with model but NO name → DENY (name gate)', () => {
  const res = runGate(agentSpawn('blade', { model: 'sonnet', name: undefined }));
  assertNameDeny(res);
});

test('21. non-implementer roster role (gaze) with no name → DENY (gate covers the whole roster)', () => {
  const res = runGate(agentSpawn('gaze', { name: undefined }));
  assertNameDeny(res);
});

test('22. roster role with a malformed name → DENY (uppercase, spaces, leading digit)', () => {
  for (const bad of ['Ward-Brann', 'ward brann', '9-lives', '', '-ward', 'ward_brann']) {
    assertNameDeny(runGate(agentSpawn('ward', { name: bad })));
  }
});

test('23. roster role with a non-string name → DENY (fail closed on the name, not on the payload)', () => {
  assertNameDeny(runGate(agentSpawn('hound', { name: 42 })));
  assertNameDeny(runGate(agentSpawn('hound', { name: null })));
});

test('24. non-phantom agent types with no name → ALLOW (gate never touches them)', () => {
  for (const type of ['general-purpose', 'Explore', 'statusline-setup', 'Plan', 'apex']) {
    assertAllow(runGate(agentSpawn(type, { name: undefined })), type + ' must stay unaffected');
  }
});

test('25. "phantom:reference:blade-conventions" with no name → ALLOW (exact match, not substring)', () => {
  const res = runGate(agentSpawn('phantom:reference:blade-conventions', { name: undefined }));
  assertAllow(res);
});

test('26. valid roster names → ALLOW (prefixed + function-named + overflow forms)', () => {
  assertAllow(runGate(agentSpawn('phantom:archer', { name: 'archer-scope' })));
  assertAllow(runGate(agentSpawn('warden', { name: 'warden-gorath' })));
  assertAllow(runGate(agentSpawn('rival', { name: 'rival-veyra' })));
  assertAllow(runGate(agentSpawn('blade', { name: 'blade-24', model: 'opus' })));
});

test('27. name gate precedes the missing-model rule (blade, no name, no model → name deny)', () => {
  const res = runGate(agentSpawn('blade', { name: undefined }));
  assertNameDeny(res);
});

test('28. fable-deny still wins over the name gate (both violated → implementer deny)', () => {
  const res = runGate(agentSpawn('blade', { model: 'fable', name: undefined }));
  assertWorkerDeny(res);
});

test('29. escape hatch PHANTOM_BLADE_MODEL_GATE=0 disables the name gate too', () => {
  const res = runGate(agentSpawn('gaze', { name: undefined }), { PHANTOM_BLADE_MODEL_GATE: '0' });
  assertAllow(res);
});

// ── RULE 3b/3c: roster IDENTITY, not just syntax ────────────────────────────

test('30. well-formed but invented character → DENY (identity, not syntax)', () => {
  assertNameDeny(runGate(agentSpawn('blade', { name: 'blade-fake', model: 'sonnet' })));
  assertNameDeny(runGate(agentSpawn('gaze', { name: 'gaze-nobody' })));
  // The retired plan-checker characters left the roster with the merged critic.
  assertNameDeny(runGate(agentSpawn('rival', { name: 'rival-castor' })));
  assertNameDeny(runGate(agentSpawn('rival', { name: 'rival-lira' })));
});

test('31. wrong-role name on a valid role → DENY (role-prefix check)', () => {
  // warden-gorath is a real roster name — just not one a blade spawn may wear.
  assertNameDeny(runGate(agentSpawn('blade', { name: 'warden-gorath', model: 'sonnet' })));
  assertNameDeny(runGate(agentSpawn('gaze', { name: 'blade-kaze' })));
});

test('32. scout-* names ride legally on blade spawns (documented naming alias)', () => {
  assertAllow(runGate(agentSpawn('blade', { name: 'scout-quorra', model: 'sonnet' })));
  assertAllow(runGate(agentSpawn('blade', { name: 'scout-silven', model: 'sonnet' })));
  // ...but the alias does not license an invented scout character.
  assertNameDeny(runGate(agentSpawn('blade', { name: 'scout-fake', model: 'sonnet' })));
});

test('32b. known council-* names ride legally on blade spawns, invented names do not', () => {
  for (const name of [
    'council-mvp', 'council-risk', 'council-user', 'council-reuse', 'council-simple',
    'council-kirran', 'council-mossa', 'council-ellow', 'council-tavric',
    'council-sorne', 'council-chairman',
  ]) {
    assertAllow(runGate(agentSpawn('blade', { name, model: 'sonnet' })), name);
  }
  assertNameDeny(runGate(agentSpawn('blade', { name: 'council-fake', model: 'sonnet' })));
});

test('33. dynamic shapes IN their roster-defined range → ALLOW', () => {
  const shapes = [
    ['blade', 'blade-24'],            // roster-length overflow, blade roster is 23
    ['blade', 'blade-25'],
    ['blade', 'scout-10'],            // scout.md's area overflow, scout roster is 9
    ['ward', 'ward-12'],              // ward roster is 11
    ['blade', 'blade-task-9'],        // execute-wave band overflow starts at 9
    ['blade', 'blade-task-24'],
    ['ward', 'ward-task-9'],
    ['blade', 'blade-backfill-2-3'],  // evolve.md Tier 3 fan-out
    ['blade', 'blade-redo-1'],        // fix.md scrap-and-redo
  ];
  for (const [role, name] of shapes) {
    assertAllow(runGate(agentSpawn(role, { name, model: 'sonnet' })), name);
  }
});

test('33b. dynamic shapes OUTSIDE their range or on the wrong role → DENY', () => {
  const bad = [
    // Bare overflow may only start PAST the role's own roster: slot 9 of the
    // blade roster is blade-dorik's, slot 6 of the scout roster is scout-quorra's.
    ['blade', 'blade-9'], ['blade', 'blade-23'],
    ['blade', 'scout-6'], ['blade', 'scout-9'],
    ['ward', 'ward-11'],
    // Task indexes 1-8 derive CHARACTERS, so the -task- shape starts at 9...
    ['blade', 'blade-task-3'], ['blade', 'blade-task-8'],
    // ...and only blade/ward derive from a task index at all.
    ['warden', 'warden-task-9'], ['gaze', 'gaze-task-9'],
    // -backfill- and -redo- are blade-only, 1-based.
    ['ward', 'ward-backfill-1-1'], ['blade', 'blade-backfill-0-1'],
    ['ward', 'ward-redo-1'], ['blade', 'blade-redo-0'],
    // Canonical decimals only — blade-024 is not a second spelling of blade-24.
    ['blade', 'blade-024'],
  ];
  for (const [role, name] of bad) {
    assertNameDeny(runGate(agentSpawn(role, { name, model: 'sonnet' })));
  }
});

test('34. sage names are parent-derived (Rule 4)', () => {
  assertAllow(runGate(agentSpawn('sage', { name: 'sage-blade-kaze' })));
  assertAllow(runGate(agentSpawn('sage', { name: 'sage-ward-torvan' })));
  // EVERY sage name derives from an eligible parent — there is no fixed name for
  // a Sage spawned straight from the orchestrator, because planning.md's
  // mandatory gate now spawns Rival rather than a Sage-tier agent.
  assertNameDeny(runGate(agentSpawn('sage', { name: 'sage-orchestrator' })));
  assertNameDeny(runGate(agentSpawn('sage', { name: 'sage-planner-rooke' })));
  assertNameDeny(runGate(agentSpawn('sage', { name: 'sage-blade-fake' })));
  // The parent form is range-checked too — there is no blade-9 parent to derive from.
  assertNameDeny(runGate(agentSpawn('sage', { name: 'sage-blade-9' })));
});

test('34b. only escalation-eligible roles may parent a sage name', () => {
  // roster.md, Ad Hoc Sites → Sage: escalation is inherited by Blade, Ward,
  // Sweep and Archer; Gaze and Warden opt out.
  for (const name of ['sage-blade-kaze', 'sage-ward-torvan', 'sage-sweep-nix', 'sage-archer-scope']) {
    assertAllow(runGate(agentSpawn('sage', { name })), name);
  }
  for (const name of ['sage-warden-sena', 'sage-gaze-elden', 'sage-rival-dask']) {
    assertNameDeny(runGate(agentSpawn('sage', { name })));
  }
  // Sage is not its own parent — a consultation cannot be consulted.
  assertNameDeny(runGate(agentSpawn('sage', { name: 'sage-sage-blade-kaze' })));
  assertNameDeny(runGate(agentSpawn('sage', { name: 'sage-sage-ward-torvan' })));
});

test('34c. LIVE roster.md still names exactly the four Sage-eligible roles', () => {
  // The gate parses that sentence and falls back to a hardcoded set when it no
  // longer matches. This asserts the two agree, so adding or removing an
  // escalation-eligible role fails here instead of silently keeping the old set.
  const roster = fs.readFileSync(
    path.join(__dirname, '..', 'reference', 'roster.md'), 'utf8'
  );
  const m = roster.match(/Sage Escalation is inherited by[\s\S]{0,200}?today that is ([^(.]+)/);
  assert.ok(m, 'roster.md must state which roles inherit Sage Escalation');
  const parsed = m[1].toLowerCase().split(/,|\band\b/).map((s) => s.trim())
    .filter((s) => /^[a-z][a-z-]*$/.test(s));
  assert.deepEqual(parsed.sort(), ['archer', 'blade', 'sweep', 'ward']);
});

test('35. every name reference/roster.md actually assigns is ALLOWED by the gate', () => {
  // Guards against the identity check drifting away from the roster it enforces.
  const spawns = [
    ['archer', 'archer-sylas'], ['archer', 'archer-scope'], ['blade', 'council-chairman'],
    ['blade', 'council-mvp'], ['blade', 'blade-doven'], ['gaze', 'gaze-sura'],
    ['lens', 'lens-thal'],
    ['hound', 'hound-corva'], ['rival', 'rival-dask'], ['rival', 'rival-veyra'],
    ['sweep', 'sweep-oda'], ['ward', 'ward-corben'], ['warden', 'warden-sena'],
  ];
  for (const [role, name] of spawns) {
    assertAllow(runGate(agentSpawn(role, { name, model: 'sonnet' })), name);
  }
});

test('35b. execute-wave characters are ALLOWED (roster rows list them unqualified)', () => {
  // The Roster Table spells characters without their role prefix, and blade/ward
  // slots 1-8 are DERIVED from a task index, so nothing in the doc ever writes
  // `blade-joran` out in full. Harvesting only backticked strings denied every
  // execute-wave spawn from task 2 on.
  for (const name of ['blade-kaze', 'blade-joran', 'blade-sabin', 'blade-orin']) {
    assertAllow(runGate(agentSpawn('blade', { name, model: 'sonnet' })), name);
  }
  for (const name of ['ward-torvan', 'ward-ilkka', 'ward-sull']) {
    assertAllow(runGate(agentSpawn('ward', { name })), name);
  }
  // Qualifying the rows must not loosen the identity layer.
  assertNameDeny(runGate(agentSpawn('blade', { name: 'blade-fake', model: 'sonnet' })));
  // ...nor let one role wear another's character: kaze is a blade, not a ward.
  assertNameDeny(runGate(agentSpawn('ward', { name: 'ward-kaze' })));
});

test('35c. LIVE roster.md: every character in every roster row is a legal name for its role', () => {
  // Fixture-driven tests could not catch the bug above — the synthetic rosters
  // qualified their names. This one parses the REAL file and asserts the gate
  // accepts everything the file assigns, so a future roster row (or a change to
  // the table's shape) cannot silently fall outside the parser again.
  const roster = fs.readFileSync(
    path.join(__dirname, '..', 'reference', 'roster.md'), 'utf8'
  );
  const rows = [...roster.matchAll(/^\|\s*([a-z][a-z-]*)\s*\|(.*)\|\s*$/gm)];
  assert.ok(rows.length >= 10, 'roster table rows must parse — got ' + rows.length);

  // Only roles the gate actually fires on can be asserted through a spawn; the
  // rest (explore/planner/hunter name non-Phantom agent types) are skipped.
  const GATED = new Set([
    'blade', 'archer', 'gaze', 'ward', 'hound', 'lens', 'sweep',
    'rival', 'sage', 'warden',
  ]);
  let checked = 0;
  for (const [, role, cell] of rows) {
    if (!GATED.has(role)) continue;
    const characters = cell
      .replace(/\*\([^)]*\)\*/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[a-z][a-z-]*$/.test(s));
    for (const character of characters) {
      const name = role + '-' + character;
      assertAllow(runGate(agentSpawn(role, { name, model: 'sonnet' })), name);
      checked++;
    }
  }
  assert.ok(checked >= 40, 'expected to exercise the whole roster — checked ' + checked);
});

test('36. unreadable roster.md → identity check SKIPPED, spawn ALLOWED (fail open)', () => {
  // Same isolation trick as test 19: copy the hook somewhere with no repo around
  // it, so reference/roster.md cannot be read.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-roster-'));
  const isolated = path.join(dir, 'hooks');
  fs.mkdirSync(isolated);
  const hookCopy = path.join(isolated, 'blade-model-gate.js');
  fs.copyFileSync(HOOK, hookCopy);
  const call = (name) => execFileSync('node', [hookCopy], {
    input: JSON.stringify(agentSpawn('blade', { name, model: 'sonnet' })),
    encoding: 'utf-8',
  });
  try {
    assert.equal(call('blade-fake').trim(), '', 'no roster → no identity check, allow');
    // Layers 3a/3b need no file and MUST still deny.
    const wrongRole = JSON.parse(call('warden-gorath'));
    assert.equal(wrongRole.hookSpecificOutput.permissionDecision, 'deny');
    const noName = execFileSync('node', [hookCopy], {
      input: JSON.stringify(agentSpawn('blade', { name: undefined, model: 'sonnet' })),
      encoding: 'utf-8',
    });
    assert.equal(JSON.parse(noName).hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
