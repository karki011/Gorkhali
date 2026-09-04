// Author: Subash Karki
// engineer-model-gate.test.js — locks the PreToolUse gate that denies Engineer
// spawns missing an explicit `model:`. FAIL-OPEN: any ambiguity, non-engineer
// agent, non-Agent/Task tool, or unparseable stdin ALLOWS. Escape hatch:
// GORKHALI_BLADE_MODEL_GATE=0 always allows. Always exits 0 — the decision
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

const HOOK = path.join(__dirname, '..', 'hooks', 'engineer-model-gate.js');

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
  return agentSpawn('engineer', toolInput);
}

function assertDeny(res) {
  assert.equal(res.code, 0, 'decision rides the JSON, not the exit code');
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /ENGINEER MODEL GATE/);
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
  engineer: 'engineer-varek',
  steward: 'steward-ordwin',
  inspector: 'inspector-yarnell',
  clerk: 'clerk-ledgett',
  auditor: 'auditor-ledgard',
  surveyor: 'surveyor-meridan',
  justice: 'justice-gavelin',
  detective: 'detective-draget',
  opposition: 'opposition-contrell',
  advisor: 'advisor-engineer-varek',
};

function agentSpawn(subagentType, toolInput = {}) {
  const role = String(subagentType).replace(/^gorkhali:/i, '').toLowerCase();
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

test('1. engineer spawn, no model → DENY', () => {
  const res = runGate(bladeSpawn());
  assertDeny(res);
});

test('2. engineer spawn WITH model:"sonnet" → ALLOW', () => {
  const res = runGate(bladeSpawn({ model: 'sonnet' }));
  assertAllow(res);
});

test('3. subagent_type:"gorkhali:engineer" (prefixed), no model → DENY (prefix stripping)', () => {
  const res = runGate(agentSpawn('gorkhali:engineer'));
  assertDeny(res);
});

test('4. model:"   " (whitespace-only), engineer → DENY (treated as empty)', () => {
  const res = runGate(bladeSpawn({ model: '   ' }));
  assertDeny(res);
});

test('5. non-engineer agent (auditor), no model → ALLOW', () => {
  const res = runGate(agentSpawn('auditor'));
  assertAllow(res);
});

test('6. tool_name not Agent/Task (e.g. Edit) with engineer-ish input → ALLOW', () => {
  const res = runGate({ tool_name: 'Edit', tool_input: { subagent_type: 'engineer' } });
  assertAllow(res);
});

test('7. escape hatch GORKHALI_BLADE_MODEL_GATE=0 → ALLOW even without model', () => {
  const res = runGate(bladeSpawn(), { GORKHALI_BLADE_MODEL_GATE: '0' });
  assertAllow(res, 'escape hatch disables the gate entirely');
});

test('8. garbage/non-JSON stdin → ALLOW, exit 0', () => {
  const res = runGate('{{{not json');
  assertAllow(res, 'unparseable stdin must fail open');
});

test('9. engineer + model:"fable" → DENY (implementer fable-deny)', () => {
  const res = runGate(agentSpawn('engineer', { model: 'fable' }));
  assertWorkerDeny(res);
});

test('10. subagent_type:"gorkhali:steward" + model:"fable" → DENY (prefix stripped, exact match)', () => {
  const res = runGate(agentSpawn('gorkhali:steward', { model: 'fable' }));
  assertWorkerDeny(res);
});

test('11. clerk + model:"claude-fable-5" → DENY (full model id, not just bare alias)', () => {
  const res = runGate(agentSpawn('clerk', { model: 'claude-fable-5' }));
  assertWorkerDeny(res);
});

test('11b. surveyor + model:"fable" → DENY with role-specific guidance', () => {
  const res = runGate(agentSpawn('surveyor', { model: 'fable' }));
  assertWorkerDeny(res);
  assert.match(JSON.parse(res.stdout).hookSpecificOutput.permissionDecisionReason, /role "surveyor"/);
});

test('12. engineer + model:"opus" → ALLOW', () => {
  const res = runGate(agentSpawn('engineer', { model: 'opus' }));
  assertAllow(res);
});

test('13. steward with omitted model → ALLOW (frontmatter pin applies, steward has no missing-model rule)', () => {
  const res = runGate(agentSpawn('steward'));
  assertAllow(res);
});

test('14. auditor + model:"fable" → ALLOW (not an implementer agent)', () => {
  const res = runGate(agentSpawn('auditor', { model: 'fable' }));
  assertAllow(res);
});

test('15. subagent_type:"gorkhali:reference:engineer-conventions" + model:"fable" → ALLOW (exact-match guard, not substring)', () => {
  const res = runGate(agentSpawn('gorkhali:reference:engineer-conventions', { model: 'fable' }));
  assertAllow(res);
});

test('16. subagent_type:"Engineer" (capitalized) + model:"fable" → DENY (case-insensitive matching)', () => {
  const res = runGate(agentSpawn('Engineer', { model: 'fable' }));
  assertWorkerDeny(res);
});

test('17. subagent_type:"GORKHALI:STEWARD" (uppercase) + model:"fable" → DENY (case-insensitive, prefix stripped)', () => {
  const res = runGate(agentSpawn('GORKHALI:STEWARD', { model: 'fable' }));
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

test('20. engineer spawn with model but NO name → DENY (name gate)', () => {
  const res = runGate(agentSpawn('engineer', { model: 'sonnet', name: undefined }));
  assertNameDeny(res);
});

test('21. non-implementer roster role (auditor) with no name → DENY (gate covers the whole roster)', () => {
  const res = runGate(agentSpawn('auditor', { name: undefined }));
  assertNameDeny(res);
});

test('22. roster role with a malformed name → DENY (uppercase, spaces, leading digit)', () => {
  for (const bad of ['Inspector-Yarnell', 'inspector yarnell', '9-lives', '', '-inspector', 'ward_brann']) {
    assertNameDeny(runGate(agentSpawn('inspector', { name: bad })));
  }
});

test('23. roster role with a non-string name → DENY (fail closed on the name, not on the payload)', () => {
  assertNameDeny(runGate(agentSpawn('detective', { name: 42 })));
  assertNameDeny(runGate(agentSpawn('detective', { name: null })));
});

test('24. non-gorkhali agent types with no name → ALLOW (gate never touches them)', () => {
  for (const type of ['general-purpose', 'Explore', 'statusline-setup', 'Plan', 'chief']) {
    assertAllow(runGate(agentSpawn(type, { name: undefined })), type + ' must stay unaffected');
  }
});

test('25. "gorkhali:reference:engineer-conventions" with no name → ALLOW (exact match, not substring)', () => {
  const res = runGate(agentSpawn('gorkhali:reference:engineer-conventions', { name: undefined }));
  assertAllow(res);
});

test('26. valid roster names → ALLOW (prefixed + function-named + overflow forms)', () => {
  assertAllow(runGate(agentSpawn('gorkhali:justice', { name: 'justice-scope' })));
  assertAllow(runGate(agentSpawn('clerk', { name: 'clerk-ledgett' })));
  assertAllow(runGate(agentSpawn('opposition', { name: 'opposition-parlow' })));
  assertAllow(runGate(agentSpawn('engineer', { name: 'engineer-24', model: 'opus' })));
});

test('27. name gate precedes the missing-model rule (engineer, no name, no model → name deny)', () => {
  const res = runGate(agentSpawn('engineer', { name: undefined }));
  assertNameDeny(res);
});

test('28. fable-deny still wins over the name gate (both violated → implementer deny)', () => {
  const res = runGate(agentSpawn('engineer', { model: 'fable', name: undefined }));
  assertWorkerDeny(res);
});

test('29. escape hatch GORKHALI_BLADE_MODEL_GATE=0 disables the name gate too', () => {
  const res = runGate(agentSpawn('auditor', { name: undefined }), { GORKHALI_BLADE_MODEL_GATE: '0' });
  assertAllow(res);
});

// ── RULE 3b/3c: roster IDENTITY, not just syntax ────────────────────────────

test('30. well-formed but invented character → DENY (identity, not syntax)', () => {
  assertNameDeny(runGate(agentSpawn('engineer', { name: 'engineer-fake', model: 'sonnet' })));
  assertNameDeny(runGate(agentSpawn('auditor', { name: 'auditor-nobody' })));
  // The retired plan-checker characters left the roster with the merged critic.
  assertNameDeny(runGate(agentSpawn('opposition', { name: 'opposition-castor' })));
  assertNameDeny(runGate(agentSpawn('opposition', { name: 'opposition-lira' })));
});

test('31. wrong-role name on a valid role → DENY (role-prefix check)', () => {
  // clerk-ledgett is a real roster name — just not one an engineer spawn may wear.
  assertNameDeny(runGate(agentSpawn('engineer', { name: 'clerk-ledgett', model: 'sonnet' })));
  assertNameDeny(runGate(agentSpawn('auditor', { name: 'engineer-varek' })));
});

test('32. scout-* names ride legally on engineer spawns (documented naming alias)', () => {
  assertAllow(runGate(agentSpawn('engineer', { name: 'scout-wrennick', model: 'sonnet' })));
  assertAllow(runGate(agentSpawn('engineer', { name: 'scout-crandal', model: 'sonnet' })));
  // ...but the alias does not license an invented scout character.
  assertNameDeny(runGate(agentSpawn('engineer', { name: 'scout-fake', model: 'sonnet' })));
});

test('32b. known council-* names ride legally on engineer spawns, invented names do not', () => {
  for (const name of [
    'council-mvp', 'council-risk', 'council-user', 'council-reuse', 'council-simple',
    'council-ostrem', 'council-pellam', 'council-rendal', 'council-senwick',
    'council-tarvel', 'council-chairman',
  ]) {
    assertAllow(runGate(agentSpawn('engineer', { name, model: 'sonnet' })), name);
  }
  assertNameDeny(runGate(agentSpawn('engineer', { name: 'council-fake', model: 'sonnet' })));
});

test('32c. planner-drafton rides legally on an engineer spawn (research-profile planner), invented planner names do not', () => {
  // reference/planning.md Codebase Research: the planner is an engineer-typed
  // spawn on the research profile, so its roster name must pass the gate.
  assertAllow(runGate(agentSpawn('engineer', { name: 'planner-drafton', model: 'opus' })));
  assertNameDeny(runGate(agentSpawn('engineer', { name: 'planner-fake', model: 'opus' })));
});

test('33. dynamic shapes IN their roster-defined range → ALLOW', () => {
  const shapes = [
    ['engineer', 'engineer-24'],            // roster-length overflow, engineer roster is 23
    ['engineer', 'engineer-25'],
    ['engineer', 'scout-10'],            // scout.md's area overflow, scout roster is 9
    ['inspector', 'inspector-12'],              // inspector roster is 11
    ['engineer', 'engineer-task-9'],        // execute-wave band overflow starts at 9
    ['engineer', 'engineer-task-24'],
    ['inspector', 'inspector-task-9'],
    ['engineer', 'engineer-backfill-2-3'],  // evolve.md Tier 3 fan-out
    ['engineer', 'engineer-redo-1'],        // fix.md scrap-and-redo
  ];
  for (const [role, name] of shapes) {
    assertAllow(runGate(agentSpawn(role, { name, model: 'sonnet' })), name);
  }
});

test('33b. dynamic shapes OUTSIDE their range or on the wrong role → DENY', () => {
  const bad = [
    // Bare overflow may only start PAST the role's own roster: slot 9 of the
    // engineer roster is engineer-dovrin's, slot 6 of the scout roster is scout-wrennick's.
    ['engineer', 'engineer-9'], ['engineer', 'engineer-23'],
    ['engineer', 'scout-6'], ['engineer', 'scout-9'],
    ['inspector', 'inspector-11'],
    // Task indexes 1-8 derive CHARACTERS, so the -task- shape starts at 9...
    ['engineer', 'engineer-task-3'], ['engineer', 'engineer-task-8'],
    // ...and only engineer/inspector derive from a task index at all.
    ['clerk', 'clerk-task-9'], ['auditor', 'auditor-task-9'],
    // -backfill- and -redo- are engineer-only, 1-based.
    ['inspector', 'inspector-backfill-1-1'], ['engineer', 'engineer-backfill-0-1'],
    ['inspector', 'inspector-redo-1'], ['engineer', 'engineer-redo-0'],
    // Canonical decimals only — engineer-024 is not a second spelling of engineer-24.
    ['engineer', 'engineer-024'],
  ];
  for (const [role, name] of bad) {
    assertNameDeny(runGate(agentSpawn(role, { name, model: 'sonnet' })));
  }
});

test('34. advisor names are parent-derived (Rule 4)', () => {
  assertAllow(runGate(agentSpawn('advisor', { name: 'advisor-engineer-varek' })));
  assertAllow(runGate(agentSpawn('advisor', { name: 'advisor-inspector-halden' })));
  // EVERY advisor name derives from an eligible parent — there is no fixed name for
  // an Advisor spawned straight from the orchestrator, because planning.md's
  // mandatory gate now spawns Opposition rather than an Advisor-tier agent.
  assertNameDeny(runGate(agentSpawn('advisor', { name: 'advisor-orchestrator' })));
  assertNameDeny(runGate(agentSpawn('advisor', { name: 'advisor-planner-drafton' })));
  assertNameDeny(runGate(agentSpawn('advisor', { name: 'advisor-engineer-fake' })));
  // The parent form is range-checked too — there is no engineer-9 parent to derive from.
  assertNameDeny(runGate(agentSpawn('advisor', { name: 'advisor-engineer-9' })));
});

test('34b. only escalation-eligible roles may parent an advisor name', () => {
  // roster.md, Ad Hoc Sites → Advisor: escalation is inherited by Engineer, Inspector,
  // Steward and Justice; Auditor and Clerk opt out.
  for (const name of ['advisor-engineer-varek', 'advisor-inspector-halden', 'advisor-steward-ordwin', 'advisor-justice-scope']) {
    assertAllow(runGate(agentSpawn('advisor', { name })), name);
  }
  for (const name of ['advisor-clerk-scrivet', 'advisor-auditor-ledgard', 'advisor-opposition-contrell']) {
    assertNameDeny(runGate(agentSpawn('advisor', { name })));
  }
  // Advisor is not its own parent — a consultation cannot be consulted.
  assertNameDeny(runGate(agentSpawn('advisor', { name: 'advisor-advisor-engineer-varek' })));
  assertNameDeny(runGate(agentSpawn('advisor', { name: 'advisor-advisor-inspector-halden' })));
});

test('34c. LIVE roster.md still names exactly the four Advisor-eligible roles', () => {
  // The gate parses that sentence and falls back to a hardcoded set when it no
  // longer matches. This asserts the two agree, so adding or removing an
  // escalation-eligible role fails here instead of silently keeping the old set.
  const roster = fs.readFileSync(
    path.join(__dirname, '..', 'reference', 'roster.md'), 'utf8'
  );
  const m = roster.match(/Advisor Escalation is inherited by[\s\S]{0,200}?today that is ([^(.]+)/);
  assert.ok(m, 'roster.md must state which roles inherit Advisor Escalation');
  const parsed = m[1].toLowerCase().split(/,|\band\b/).map((s) => s.trim())
    .filter((s) => /^[a-z][a-z-]*$/.test(s));
  assert.deepEqual(parsed.sort(), ['engineer', 'inspector', 'justice', 'steward']);
});

test('35. every name reference/roster.md actually assigns is ALLOWED by the gate', () => {
  // Guards against the identity check drifting away from the roster it enforces.
  const spawns = [
    ['justice', 'justice-gavelin'], ['justice', 'justice-scope'], ['engineer', 'council-chairman'],
    ['engineer', 'council-mvp'], ['engineer', 'engineer-norvale'], ['auditor', 'auditor-pruett'],
    ['surveyor', 'surveyor-gantrey'],
    ['detective', 'detective-colven'], ['opposition', 'opposition-contrell'], ['opposition', 'opposition-parlow'],
    ['steward', 'steward-tessle'], ['inspector', 'inspector-tindal'], ['clerk', 'clerk-scrivet'],
  ];
  for (const [role, name] of spawns) {
    assertAllow(runGate(agentSpawn(role, { name, model: 'sonnet' })), name);
  }
});

test('35b. execute-wave characters are ALLOWED (roster rows list them unqualified)', () => {
  // The Roster Table spells characters without their role prefix, and engineer/inspector
  // slots 1-8 are DERIVED from a task index, so nothing in the doc ever writes
  // `engineer-dunmar` out in full. Harvesting only backticked strings denied every
  // execute-wave spawn from task 2 on.
  for (const name of ['engineer-varek', 'engineer-dunmar', 'engineer-brasco', 'engineer-maren']) {
    assertAllow(runGate(agentSpawn('engineer', { name, model: 'sonnet' })), name);
  }
  for (const name of ['inspector-halden', 'inspector-corliss', 'inspector-welden']) {
    assertAllow(runGate(agentSpawn('inspector', { name })), name);
  }
  // Qualifying the rows must not loosen the identity layer.
  assertNameDeny(runGate(agentSpawn('engineer', { name: 'engineer-fake', model: 'sonnet' })));
  // ...nor let one role wear another's character: varek is an engineer, not an inspector.
  assertNameDeny(runGate(agentSpawn('inspector', { name: 'inspector-varek' })));
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
  // rest (explore/planner/hunter name non-Gorkhali agent types) are skipped.
  const GATED = new Set([
    'engineer', 'justice', 'auditor', 'inspector', 'detective', 'surveyor', 'steward',
    'opposition', 'advisor', 'clerk',
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-roster-'));
  const isolated = path.join(dir, 'hooks');
  fs.mkdirSync(isolated);
  const hookCopy = path.join(isolated, 'engineer-model-gate.js');
  fs.copyFileSync(HOOK, hookCopy);
  const call = (name) => execFileSync('node', [hookCopy], {
    input: JSON.stringify(agentSpawn('engineer', { name, model: 'sonnet' })),
    encoding: 'utf-8',
  });
  try {
    assert.equal(call('engineer-fake').trim(), '', 'no roster → no identity check, allow');
    // Layers 3a/3b need no file and MUST still deny.
    const wrongRole = JSON.parse(call('clerk-ledgett'));
    assert.equal(wrongRole.hookSpecificOutput.permissionDecision, 'deny');
    const noName = execFileSync('node', [hookCopy], {
      input: JSON.stringify(agentSpawn('engineer', { name: undefined, model: 'sonnet' })),
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
    fs.readFileSync(path.join(__dirname, '..', 'skills', 'gorkhali', 'references', 'model-policy.json'), 'utf8')
  );
  assert.match(reason, new RegExp(`profile "${policy.roles.engineer}"`), 'reason states the policy profile');
  assert.match(reason, /critical_elevation|risk "critical"/, 'reason points at the risk-elevation path');
  assert.doesNotMatch(reason, /"(sonnet|haiku|opus)"/, 'concrete aliases live in model-presets.json, not in the gate');
});

test('19. unreadable policy → still DENY with a generic reason (advisory read never changes the decision)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-gate-'));
  const isolated = path.join(dir, 'hooks');
  fs.mkdirSync(isolated);
  const hookCopy = path.join(isolated, 'engineer-model-gate.js');
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
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /ENGINEER MODEL GATE/);
  assert.doesNotMatch(
    out.hookSpecificOutput.permissionDecisionReason,
    /model-policy\.json puts/,
    'no policy file → no policy sentence, same decision'
  );
});
