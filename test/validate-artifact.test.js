// Author: Subash Karki
// validate-artifact.test.js — covers the schema hardening added on top of the
// hand-rolled validator (scripts/validate-artifact.js): the plan v1/v2 version
// gate on tasks[].acceptance_criteria + tasks[].verify, the optional
// intent.problem field, and the two new artifact types (brainstorm, decisions).
// Also covers the execution artifact's tasks[].testResult three-state contract
// (reference/schemas/execution.md lines 17-20): legacy `{ passed, summary }`,
// a plain string for a check that ran, and the `not_observed` object form for a
// check that did not run, where `passed` must be omitted and `summary` required.
// These tests spawn the REAL validator CLI, same pattern as execution-schema.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-artifact.js');

const metaFor = (overrides = {}) => ({
  writtenAt: '2026-06-03T00:00:00Z',
  gitHead: 'abc1234',
  gitBranch: 'main',
  phase: 'B',
  skill: 'phantom:start',
  version: 1,
  ...overrides,
});

// Spawn the real validator: node scripts/validate-artifact.js <type> <file>.
function runValidator(type, artifact) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-artifact-'));
  const file = path.join(dir, `${type}.json`);
  fs.writeFileSync(file, JSON.stringify(artifact));
  try {
    const stdout = execFileSync('node', [VALIDATOR, type, file], { encoding: 'utf-8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: (e.stdout || '').toString(),
      stderr: (e.stderr || '').toString(),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- plan: v1/v2 version gate on acceptance_criteria + verify ---

const basePlanTask = { id: 'T1', description: 'Add hook', files: ['src/a.ts'] };

test('plan: v2 task missing acceptance_criteria and verify is rejected', () => {
  const res = runValidator('plan', {
    _meta: metaFor({ version: 2 }),
    route: 'solo',
    devilsAdvocateVerdict: 'PROCEED',
    tasks: [basePlanTask],
  });
  assert.equal(res.code, 1, `v2 plan without task quality fields must fail, got stderr: ${res.stderr}`);
  assert.match(res.stderr, /tasks\[0\]\.acceptance_criteria/);
  assert.match(res.stderr, /tasks\[0\]\.verify/);
});

test('plan: v2 task with acceptance_criteria and verify passes', () => {
  const res = runValidator('plan', {
    _meta: metaFor({ version: 2 }),
    route: 'solo',
    devilsAdvocateVerdict: 'PROCEED',
    tasks: [
      {
        ...basePlanTask,
        acceptance_criteria: ["grep -r 'export.*useCostByTag' src/hooks/ finds exactly one match"],
        verify: 'pnpm test -- useCostByTag',
      },
    ],
  });
  assert.equal(res.code, 0, `expected valid, got stderr: ${res.stderr}`);
});

test('plan: v1 plan without acceptance_criteria/verify stays lenient (backward compat)', () => {
  const res = runValidator('plan', {
    _meta: metaFor({ version: 1 }),
    route: 'solo',
    devilsAdvocateVerdict: 'PROCEED',
    tasks: [basePlanTask],
  });
  assert.equal(res.code, 0, `v1 plan must not require the new fields, got stderr: ${res.stderr}`);
});

test('plan: missing _meta.version defaults to v1 leniency', () => {
  const meta = metaFor();
  delete meta.version;
  const res = runValidator('plan', {
    _meta: meta,
    route: 'solo',
    devilsAdvocateVerdict: 'PROCEED',
    tasks: [basePlanTask],
  });
  // _meta.version itself is required by validateMeta, so this still fails —
  // but it must fail on THAT field, not on acceptance_criteria/verify.
  assert.equal(res.code, 1);
  assert.match(res.stderr, /_meta\.version/);
  assert.doesNotMatch(res.stderr, /acceptance_criteria/);
});

// --- intent: optional problem field ---

const baseIntent = {
  goal: 'Render a cost-per-tag breakdown table',
  doneWhen: ['Table renders with correct data'],
  priority: ['Correctness'],
  specDelta: 'none',
};

test('intent: with problem field passes', () => {
  const res = runValidator('intent', {
    _meta: metaFor(),
    problem: "Users can't see per-tag cost without exporting to a spreadsheet",
    ...baseIntent,
  });
  assert.equal(res.code, 0, `expected valid, got stderr: ${res.stderr}`);
});

test('intent: without problem field still passes', () => {
  const res = runValidator('intent', { _meta: metaFor(), ...baseIntent });
  assert.equal(res.code, 0, `problem is optional, got stderr: ${res.stderr}`);
});

test('intent: non-string problem field is rejected', () => {
  const res = runValidator('intent', { _meta: metaFor(), problem: 42, ...baseIntent });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /problem: must be string/);
});

// --- decisions ---

const validDecision = {
  id: 'decision-001-state-management',
  decision: 'Use Jotai atoms for filter state',
  status: 'locked',
  rationale: 'Matches existing @cloudzero/forms pattern',
  alternatives: ['React Context (rejected)'],
};

test('decisions: entry with a stable slug id passes', () => {
  const res = runValidator('decisions', { _meta: metaFor(), decisions: [validDecision] });
  assert.equal(res.code, 0, `expected valid, got stderr: ${res.stderr}`);
});

test('decisions: entry without an id is rejected by name', () => {
  const { id, ...noId } = validDecision;
  const res = runValidator('decisions', { _meta: metaFor(), decisions: [noId] });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /decisions\[0\]\.id/);
});

test('decisions: non-slug id (spaces/uppercase) is rejected', () => {
  const res = runValidator('decisions', {
    _meta: metaFor(),
    decisions: [{ ...validDecision, id: 'Decision 001' }],
  });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /decisions\[0\]\.id/);
});

test('decisions: `{ decisions: [] }` double-wrapper is unwrapped, not rejected', () => {
  const res = runValidator('decisions', { _meta: metaFor(), decisions: { decisions: [validDecision] } });
  assert.equal(res.code, 0, `wrapper form must be accepted, got stderr: ${res.stderr}`);
});

test('decisions: empty decisions array is rejected', () => {
  const res = runValidator('decisions', { _meta: metaFor(), decisions: [] });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /decisions: required non-empty array/);
});

// --- brainstorm ---

const validApproach = {
  id: 'approach-a-hooks-first',
  name: 'Hooks-first refactor',
  thesis: 'Extract shared fetch/memo logic into one hook',
  description: 'Add useCostByTag alongside useCostData',
  whyLens: 'reuse',
  effort: 'low',
  risk: 'low',
  reversibility: 'high',
  whatBreaks: ['Callers relying on useCostData return shape'],
  whenToPick: 'Pick when the two call sites should stay close in shape',
  visualType: 'diagram',
};

test('brainstorm: full spine with visualType passes', () => {
  const res = runValidator('brainstorm', {
    _meta: metaFor(),
    approaches: [validApproach],
    recommendedDefault: { id: 'approach-a-hooks-first', reason: 'Lowest risk' },
  });
  assert.equal(res.code, 0, `expected valid, got stderr: ${res.stderr}`);
});

test('brainstorm: bad visualType enum value is rejected', () => {
  const res = runValidator('brainstorm', {
    _meta: metaFor(),
    approaches: [{ ...validApproach, visualType: 'wireframe' }],
    recommendedDefault: { id: 'approach-a-hooks-first', reason: 'Lowest risk' },
  });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /approaches\[0\]\.visualType/);
});

test('brainstorm: recommendedDefault.id not matching any approach is rejected', () => {
  const res = runValidator('brainstorm', {
    _meta: metaFor(),
    approaches: [validApproach],
    recommendedDefault: { id: 'approach-z-does-not-exist', reason: 'Lowest risk' },
  });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /recommendedDefault\.id/);
});

test('brainstorm: omitting optional visualType and mutualExclusivity still passes', () => {
  const { visualType, ...noVisualType } = validApproach;
  const res = runValidator('brainstorm', {
    _meta: metaFor(),
    approaches: [noVisualType],
    recommendedDefault: { id: 'approach-a-hooks-first', reason: 'Lowest risk' },
  });
  assert.equal(res.code, 0, `both are optional, got stderr: ${res.stderr}`);
});

// --- execution: tasks[].testResult three-state contract ---
// reference/schemas/execution.md lines 17-20: testResult is an object or a
// string; the string form is only for a check that ran. observation is
// checked:pass | checked:fail | not_observed. passed is required unless
// observation is not_observed, must agree with observation when both are
// present, and must be omitted when observation is not_observed. summary is
// required when observation is not_observed.

const baseExecTask = (testResult) => ({
  id: 'T1',
  status: 'done',
  filesChanged: ['src/a.ts'],
  outputSummary: 'Did the thing.',
  ...(testResult !== undefined ? { testResult } : {}),
});

const execArtifact = (testResult) => ({
  _meta: metaFor(),
  tasks: [baseExecTask(testResult)],
  totalSpawns: 1,
});

test('execution: legacy `{ passed, summary }` shape (no observation) still passes', () => {
  const res = runValidator('execution', execArtifact({ passed: true, summary: '12 tests green' }));
  assert.equal(res.code, 0, `legacy shape must stay valid, got stderr: ${res.stderr}`);
});

test('execution: testResult as a plain string (a check that ran) passes', () => {
  const res = runValidator('execution', execArtifact('12 tests passed'));
  assert.equal(res.code, 0, `string form must be valid for a ran check, got stderr: ${res.stderr}`);
});

test('execution: `{ observation: "not_observed", summary }` with passed omitted passes', () => {
  const res = runValidator(
    'execution',
    execArtifact({ observation: 'not_observed', summary: 'tests not run: blocked on a dependency' })
  );
  assert.equal(res.code, 0, `not_observed with passed omitted must be valid, got stderr: ${res.stderr}`);
});

test('execution: `{ observation: "checked:pass", passed: true, summary }` (both present, agreeing) passes', () => {
  const res = runValidator(
    'execution',
    execArtifact({ observation: 'checked:pass', passed: true, summary: 'suite green' })
  );
  assert.equal(res.code, 0, `agreeing observation+passed must be valid, got stderr: ${res.stderr}`);
});

test('execution: not_observed with passed present is rejected (passed must be omitted)', () => {
  const res = runValidator(
    'execution',
    execArtifact({ observation: 'not_observed', passed: false, summary: 'blocked on a dependency' })
  );
  assert.equal(res.code, 1, `passed must be omitted when observation is not_observed`);
  assert.match(
    res.stderr,
    /tasks\[0\]\.testResult\.passed: must be omitted when testResult\.observation is not_observed/
  );
});

test('execution: checked:pass with passed: false is rejected (observation/passed disagree)', () => {
  const res = runValidator('execution', execArtifact({ observation: 'checked:pass', passed: false }));
  assert.equal(res.code, 1, `disagreeing observation+passed must be rejected`);
  assert.match(
    res.stderr,
    /tasks\[0\]\.testResult\.passed: must agree with testResult\.observation \(checked:pass -> true, checked:fail -> false\)/
  );
});

test('execution: not_observed with no summary is rejected (the reason is required)', () => {
  const res = runValidator('execution', execArtifact({ observation: 'not_observed' }));
  assert.equal(res.code, 1, `not_observed with no summary must be rejected`);
  assert.match(
    res.stderr,
    /tasks\[0\]\.testResult\.summary: required string when testResult\.observation is not_observed/
  );
});

test('execution: an unknown observation value is rejected', () => {
  const res = runValidator('execution', execArtifact({ observation: 'maybe', passed: true }));
  assert.equal(res.code, 1, `unknown observation value must be rejected`);
  assert.match(
    res.stderr,
    /tasks\[0\]\.testResult\.observation: must be one of checked:pass\|checked:fail\|not_observed if present, got "maybe"/
  );
});
