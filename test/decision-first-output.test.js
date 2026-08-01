// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const { validate } = require('../scripts/validate-artifact');

const richFixture = (type) => JSON.parse(
  fs.readFileSync(path.join(__dirname, `fixtures/decision-first/${type}-v3-rich.json`), 'utf8'),
);
const portableContracts = import(pathToFileURL(
  path.resolve(__dirname, '../skills/phantom/scripts/lib/decision-contracts.mjs'),
).href);
const clone = (value) => JSON.parse(JSON.stringify(value));
const removeFields = (value, fields) => {
  for (const field of fields) delete value[field];
  return value;
};
const addEvidenceFreshness = (payload) => {
  payload.evidence = payload.evidence.map((item) => ({
    ...item,
    observed_at: '2026-07-21T12:00:00Z',
    confidence: item.status === 'unknown' ? 0 : 0.9,
  }));
  return payload;
};

const meta = (version = 3) => ({
  writtenAt: '2026-07-19T00:00:00Z',
  gitHead: 'abc1234',
  gitBranch: 'feat/decision-first',
  phase: 'B',
  skill: 'phantom:start',
  version,
});

const planTask = {
  id: 'T1',
  description: 'Render a decision brief before execution mechanics',
  read_first: ['skills/phantom/scripts/validate-review-html.mjs'],
  action: 'Reorder plan sections around the decision contract',
  files: ['skills/phantom/scripts/validate-review-html.mjs'],
  new_files: [],
  dependsOn: [],
  acceptance_criteria: ['Decision brief appears before Waves'],
  consumes: ['Validated plan artifact'],
  produces: ['Decision-first plan review'],
  verify: 'node --test test/decision-first-output.test.js',
  risk: 'Renderer ordering regression',
  recovery: 'Retain tolerant rendering for v1 and v2 plans',
  profile: 'balanced',
};

const validPlan = () => ({
  _meta: meta(),
  depth: 'standard',
  title: 'Decision-first planning',
  problem: 'Task-first plans hide the reasoning a human needs to approve',
  decision: {
    question: 'Approve decision-first planning output?',
    recommendation: 'Lead with evidence and architecture, then show execution details',
    rationale: ['Approval quality depends on understanding why the direction is correct'],
    status: 'pending',
  },
  outcome: {
    goal: 'A reviewer can understand the proposed direction before reading tasks',
    doneWhen: ['The decision brief precedes execution sections'],
  },
  scope: {
    in: ['Plan and brainstorm artifacts'],
    out: ['Implementation runtime changes'],
    constraints: ['Self-contained offline HTML'],
  },
  solution_shape: {
    summary: 'Generate a human review view from a machine source of truth',
    components: ['artifact validator', 'AI-authored review'],
    dataFlow: ['plan.json', 'validate JSON', 'author HTML', 'validate HTML', 'human review'],
  },
  change_set: {
    added: ['Decision-first review'],
    modified: ['Plan presentation'],
    removed: [],
    unchanged: ['JSON source of truth'],
  },
  scenarios: [
    {
      id: 'S1',
      given: 'A valid plan exists',
      when: 'the reviewer opens its HTML projection',
      then: 'the decision and its proof precede execution mechanics',
    },
  ],
  evidence: [
    {
      claim: 'The previous required fields were execution-centric',
      source: 'scripts/validate-artifact.js',
      status: 'verified',
      observed_at: '2026-07-21T12:00:00Z',
      confidence: 0.9,
      conflicts: [],
    },
  ],
  alternatives: [
    {
      name: 'Keep task-first output',
      tradeoffs: ['Smaller artifact but poor decision support'],
      reasonNotSelected: 'Does not address the user correction',
    },
  ],
  assumptions: [],
  open_questions: [{ question: 'Approve this direction?', blocking: true }],
  decisions_for_approval: [{ decision: 'Use decision-first output' }],
  risks: [
    {
      risk: 'Long narrative can obscure execution',
      impact: 'medium',
      mitigation: 'Keep execution in a final appendix',
      reversibility: 'high',
    },
  ],
  validation: {
    strategy: 'Schema and renderer-order tests',
    definitionOfDone: ['Canonical v3 artifact validates and renders'],
    checks: ['node --test test/decision-first-output.test.js'],
  },
  coverage: [
    {
      requirement: 'A reviewer can approve the direction before reading tasks',
      scenarioIds: ['S1'],
      taskIds: ['T1'],
      checks: ['Decision brief appears before execution'],
    },
  ],
  readiness: {
    verdict: 'READY',
    reasons: ['The decision contract and deterministic verification are complete'],
    unresolved: [],
  },
  route: 'solo',
  devilsAdvocateVerdict: 'PROCEED',
  tasks: [{ ...planTask }],
});

const approach = (id, name, lens) => ({
  id,
  name,
  thesis: `${name} thesis`,
  description: `${name} description`,
  whyLens: lens,
  effort: 'medium',
  risk: 'low',
  reversibility: 'high',
  whatBreaks: ['The review contract would need revision'],
  whenToPick: 'Pick when it best matches the decision criteria',
});

const validBrainstorm = () => ({
  _meta: meta(),
  depth: 'standard',
  title: 'Planning output options',
  problem: 'Users see tasks and waves instead of a researched recommendation',
  stance: {
    mode: 'creative-partner',
    reason: 'The user owns the outcome while the agent develops and challenges alternatives',
  },
  phase: 'decision',
  decision: {
    question: 'How should planning results be presented?',
    outcome: 'Fast, informed human approval',
    audience: ['Maintainers'],
    nonGoals: ['Implement before direction approval'],
    constraints: ['Offline HTML'],
    evaluationCriteria: ['Decision clarity', 'Evidence quality'],
  },
  evidence: [
    {
      claim: 'Recommendation currently renders after approaches',
      source: 'skills/phantom/references/review-html.md',
      status: 'verified',
      observed_at: '2026-07-21T12:00:00Z',
      confidence: 0.9,
      conflicts: [],
    },
  ],
  openQuestions: [{ question: 'Should the recommendation lead?', blocking: true }],
  ideas: [
    {
      id: 'I1',
      title: 'Decision-first review',
      summary: 'Place the recommendation and proof before execution',
      lens: 'reviewer',
      technique: 'outcome-backward',
      evidence: ['The current output hides the recommendation'],
      assumptions: ['Reviewers prefer a fast decision spine'],
    },
    {
      id: 'I2',
      title: 'Task-first review',
      summary: 'Keep execution mechanics as the primary artifact',
      lens: 'implementer',
      technique: 'simplest-path',
      evidence: ['Tasks are directly actionable'],
      assumptions: ['The implementation path is already approved'],
    },
  ],
  clusters: [
    {
      id: 'C1',
      name: 'Review hierarchy',
      ideaIds: ['I1', 'I2'],
      insight: 'The presentation order depends on whether the pending decision is direction or execution',
    },
  ],
  approaches: [
    approach('decision-first', 'Decision first', 'user-first'),
    approach('task-first', 'Task first', 'simplest'),
  ],
  recommendedDefault: { id: 'decision-first', reason: 'Supports informed approval' },
  shortlist: [
    { approachId: 'decision-first', drivers: ['Decision clarity'], reservation: 'More presentation structure' },
    { approachId: 'task-first', drivers: ['Implementation speed'], reservation: 'Hides decision rationale' },
  ],
  dissent: {
    approachId: 'task-first',
    case: 'A task-first view is faster when the direction is already approved',
    trigger: 'Use it when no architectural or product decision remains',
  },
  cheapestExperiment: {
    question: 'Can a reviewer identify the recommendation immediately?',
    method: 'Render a representative artifact',
    successSignal: 'Recommendation is visible before comparison details',
    cost: 'One validated AI-authored review artifact',
  },
  directionGate: {
    question: 'Which approach should Phantom use?',
    options: ['decision-first', 'task-first'],
  },
});

test('canonical plan v3 requires and accepts a decision-first contract', () => {
  assert.deepEqual(validate('plan', validPlan()), []);
  const invalid = validPlan();
  delete invalid.decision;
  assert.match(validate('plan', invalid).join('\n'), /decision: required object/);
});

test('plan v3 rejects dependency defects and unresolved placeholders', () => {
  const plan = validPlan();
  plan.tasks.push({ ...planTask, id: 'T1', verify: '{TEST_CMD}', dependsOn: ['missing'] });
  const errors = validate('plan', plan).join('\n');
  assert.match(errors, /duplicate task id/);
  assert.match(errors, /unknown task id/);
  assert.match(errors, /unresolved placeholder/);
});

test('quick plan v3 stays decision-useful without invented architecture or alternatives', () => {
  const plan = validPlan();
  plan.depth = 'quick';
  plan.alternatives = [];
  delete plan.solution_shape;
  delete plan.tasks[0].risk;
  delete plan.tasks[0].recovery;
  assert.deepEqual(validate('plan', plan), []);
});

test('portable plan contract accepts only the canonical quick shape', async () => {
  const { validateDecisionContract } = await portableContracts;
  const canonical = { ...validPlan(), contract_version: 3, depth: 'quick' };
  delete canonical._meta;
  removeFields(canonical, ['solution_shape', 'change_set', 'readiness']);
  canonical.scenarios = [];
  canonical.alternatives = [];
  canonical.coverage = [];
  removeFields(canonical.tasks[0], ['risk', 'recovery']);
  assert.deepEqual(validateDecisionContract('plan', canonical), []);

  const legacy = { ...validPlan(), contract_version: 3, depth: 'quick' };
  delete legacy._meta;
  removeFields(legacy.tasks[0], ['risk', 'recovery']);
  assert.match(
    validateDecisionContract('plan', legacy).join('\n'),
    /solution_shape: omit for quick plans[\s\S]*change_set: omit for quick plans[\s\S]*readiness: omit for quick plans[\s\S]*scenarios: must be empty for quick plans[\s\S]*alternatives: must be empty for quick plans[\s\S]*coverage: must be empty for quick plans/,
  );

  const missingArrays = clone(canonical);
  removeFields(missingArrays, ['scenarios', 'alternatives', 'coverage']);
  assert.match(
    validateDecisionContract('plan', missingArrays).join('\n'),
    /scenarios: required empty array for quick plans[\s\S]*alternatives: required empty array for quick plans[\s\S]*coverage: required empty array for quick plans/,
  );
});

test('portable plan paths are explicit, normalized, and distinguish intentional new files', async () => {
  const { validateDecisionContract } = await portableContracts;
  const base = { ...validPlan(), contract_version: 3 };
  delete base._meta;
  base.tasks[0].files.push('src/new-renderer.js');
  base.tasks[0].new_files = ['src/new-renderer.js'];
  assert.deepEqual(validateDecisionContract('plan', base), []);

  const cases = [
    ['traversal', (plan) => { plan.tasks[0].read_first = ['../secret']; }, /normalized repository-relative path/],
    ['absolute', (plan) => { plan.tasks[0].files = ['/tmp/output']; }, /normalized repository-relative path/],
    ['glob', (plan) => { plan.tasks[0].files = ['src/*.js']; }, /normalized repository-relative path/],
    ['duplicate', (plan) => { plan.tasks[0].files = ['src/index.js', 'src/index.js']; }, /duplicate path/],
    ['undeclared touch', (plan) => { plan.tasks[0].new_files = ['src/missing.js']; }, /must also appear in files/],
    ['new file read first', (plan) => {
      plan.tasks[0].files = ['src/new.js'];
      plan.tasks[0].read_first = ['src/new.js'];
      plan.tasks[0].new_files = ['src/new.js'];
    }, /must not appear in read_first/],
  ];
  for (const [label, mutate, expected] of cases) {
    const plan = clone(base);
    mutate(plan);
    assert.match(validateDecisionContract('plan', plan).join('\n'), expected, label);
  }

  const legacy = clone(base);
  legacy.tasks[0].files = ['src\\legacy.ts'];
  assert.match(
    validateDecisionContract('plan', legacy).join('\n'),
    /normalized repository-relative path/,
  );

  const malformed = clone(base);
  malformed.tasks[0].read_first = [null];
  assert.match(
    validateDecisionContract('plan', malformed, {
      workspace: path.join(__dirname, '..'),
    }).join('\n'),
    /read_first\[0\]: required non-empty path/,
  );
});

test('plan validator reports a non-object task instead of throwing', () => {
  const plan = validPlan();
  plan.tasks = [null];
  assert.match(validate('plan', plan).join('\n'), /tasks\[0\]: required object/);
});

test('canonical brainstorm v3 requires a recommendation and decision frame', () => {
  const brainstorm = validBrainstorm();
  assert.deepEqual(validate('brainstorm', brainstorm), []);
  const invalid = validBrainstorm();
  invalid.approaches[0].mutualExclusivity = [invalid.approaches[0].id, 'missing'];
  const errors = validate('brainstorm', invalid).join('\n');
  assert.match(errors, /cannot exclude itself/);
  assert.match(errors, /unknown approach id/);
});

test('representative deep fixtures exercise the complete decision-review contract', () => {
  const plan = richFixture('plan');
  const brainstorm = richFixture('brainstorm');
  assert.deepEqual(validate('plan', plan), []);
  assert.deepEqual(validate('brainstorm', brainstorm), []);
  assert.equal(plan.depth, 'deep');
  assert.ok(plan.evidence.length >= 4);
  assert.ok(plan.alternatives.length >= 3);
  assert.ok(plan.risks.length >= 3);
  assert.ok(plan.tasks.length >= 4);
  assert.ok(plan.solution_shape.dataFlow.length >= 4);
  assert.deepEqual(new Set(plan.evidence.map(({ status }) => status)), new Set([
    'verified',
    'supported',
    'inferred',
    'unknown',
  ]));
  assert.equal(brainstorm.approaches.length, 3);
  assert.ok(brainstorm.evidence.length >= 4);
  assert.ok(brainstorm.decision.evaluationCriteria.length >= 3);
  assert.ok(brainstorm.openQuestions.length >= 1);
  for (const field of ['question', 'method', 'successSignal', 'cost']) {
    assert.ok(brainstorm.cheapestExperiment[field]);
  }
});

test('portable decision contract rejects earlier and undeclared contract shapes', async () => {
  const { validateDecisionContract } = await portableContracts;
  const planPayload = { ...validPlan(), contract_version: 3 };
  delete planPayload._meta;
  assert.deepEqual(validateDecisionContract('plan', planPayload), []);
  const earlierPlan = removeFields(clone(planPayload), ['change_set', 'scenarios', 'coverage', 'readiness']);
  for (const task of earlierPlan.tasks) removeFields(task, ['consumes', 'produces']);
  assert.match(
    validateDecisionContract('plan', earlierPlan).join('\n'),
    /change_set: required object[\s\S]*scenarios: required array[\s\S]*coverage: required array[\s\S]*readiness: required object/,
  );
  const earlierBrainstorm = { ...validBrainstorm(), contract_version: 3 };
  delete earlierBrainstorm._meta;
  removeFields(earlierBrainstorm, ['depth', 'stance', 'phase', 'ideas', 'clusters', 'shortlist', 'dissent']);
  removeFields(earlierBrainstorm.decision, ['audience', 'nonGoals']);
  assert.match(
    validateDecisionContract('brainstorm', earlierBrainstorm).join('\n'),
    /depth: must be quick\|standard\|deep[\s\S]*stance: required object[\s\S]*phase: must be frame\|diverge\|cluster\|converge\|decision/,
  );
  assert.match(
    validateDecisionContract('plan', { contract_version: 3 }).join('\n'),
    /decision: required object/,
  );
  assert.match(
    validateDecisionContract('plan', { tasks: [] }).join('\n'),
    /contract_version: required and must be 3/,
  );
  assert.match(
    validateDecisionContract('plan', { contract_version: 4 }).join('\n'),
    /unsupported version/,
  );
  assert.match(
    validateDecisionContract('unknown', { contract_version: 3 }).join('\n'),
    /unsupported decision contract type/,
  );
});

test('portable delegation contracts validate typed tasks and consistent results', async () => {
  const {
    delegationTaskDigest,
    validateDelegationResultContract,
    validateDelegationTaskContract,
  } = await portableContracts;
  const task = {
    contract_version: 2,
    task_id: 'T1',
    delegation_id: 'delegation-T1-attempt-1',
    role: 'Blade',
    profile: 'balanced',
    risk: 'moderate',
    objective: 'Implement one bounded validator change',
    context_refs: [{
      id: 'plan',
      kind: 'artifact',
      source: 'session',
      locator: 'plan.json',
      content_sha256: '0'.repeat(64),
      observed_at: '2026-07-23T12:00:00.000Z',
    }],
    requires_judgment: false,
    locked_decisions: [],
    corrections: [],
    constraints: ['Do not change unrelated files'],
    deliverables: ['Delegation validators'],
    acceptance_criteria: ['Focused tests pass'],
    write_scope: ['skills/phantom/scripts/lib/decision-contracts.mjs'],
  };
  const taskDigest = delegationTaskDigest(task);
  assert.deepEqual(validateDelegationTaskContract(task), []);
  assert.deepEqual(validateDelegationResultContract({
    contract_version: 2,
    task_id: 'T1',
    delegation_id: 'delegation-T1-attempt-1',
    task_digest: taskDigest,
    status: 'ok',
    output: {
      summary: 'Implemented and verified',
      files_changed: ['skills/phantom/scripts/lib/decision-contracts.mjs'],
      checks: [{ name: 'focused tests', status: 'passed' }],
      findings: [],
      risks: [],
      blocker: null,
    },
    error: null,
  }), []);
  assert.deepEqual(validateDelegationResultContract({
    contract_version: 2,
    task_id: 'T1',
    delegation_id: 'delegation-T1-attempt-1',
    task_digest: taskDigest,
    status: 'error',
    output: null,
    error: { code: 'CAPABILITY_UNAVAILABLE', message: 'No structured worker API', retryable: false },
  }), []);

  const invalidTask = clone(task);
  invalidTask.contract_version = 1;
  assert.match(validateDelegationTaskContract(invalidTask).join('\n'), /unsupported version/);
  invalidTask.contract_version = 2;
  invalidTask.context_refs = [{
    id: 'plan',
    kind: 'filesystem-blackboard',
    source: 'conversation',
    locator: '../plan.json',
    content_sha256: 'ABC',
    observed_at: '2026-07-23',
  }];
  invalidTask.requires_judgment = 'no';
  const taskErrors = validateDelegationTaskContract(invalidTask).join('\n');
  assert.match(taskErrors, /context_refs\[0\]\.kind: must be artifact\|resource/);
  assert.match(taskErrors, /context_refs\[0\]\.source: must be workspace\|session/);
  assert.match(taskErrors, /context_refs\[0\]\.locator: must be a normalized repository-relative path/);
  assert.match(taskErrors, /context_refs\[0\]\.content_sha256: required lowercase 64-hex/);
  assert.match(taskErrors, /context_refs\[0\]\.observed_at: required RFC 3339 timestamp with timezone/);
  assert.match(taskErrors, /requires_judgment: required boolean/);

  assert.match(validateDelegationResultContract({
    contract_version: 2,
    task_id: 'T1',
    delegation_id: 'delegation-T1-attempt-1',
    task_digest: taskDigest,
    status: 'ok',
    output: null,
    error: { code: 'WRONG', message: 'Inconsistent result', retryable: false },
  }).join('\n'), /output: required object[\s\S]*error: must be null/);

  const legacyResult = {
    contract_version: 1,
    task_id: 'T1',
    status: 'ok',
    output: { summary: 'Stored v1 task result' },
    error: null,
  };
  assert.match(validateDelegationResultContract(legacyResult).join('\n'), /unsupported version/);
});

test('canonical plan and brainstorm contracts always require bounded evidence freshness', async () => {
  const { validateDecisionContract } = await portableContracts;
  const plan = { ...validPlan(), contract_version: 3 };
  delete plan._meta;
  delete plan.evidence[0].observed_at;
  delete plan.evidence[0].confidence;
  assert.match(
    validateDecisionContract('plan', plan).join('\n'),
    /evidence\[0\]\.observed_at: required RFC 3339[\s\S]*evidence\[0\]\.confidence: required number from 0 to 1/,
  );
  addEvidenceFreshness(plan);
  plan.evidence[0].conflicts = ['A prior document describes the old behavior'];
  assert.deepEqual(validateDecisionContract('plan', plan), []);

  const brainstorm = { ...validBrainstorm(), contract_version: 3 };
  delete brainstorm._meta;
  addEvidenceFreshness(brainstorm);
  assert.deepEqual(validateDecisionContract('brainstorm', brainstorm), []);
  brainstorm.evidence[0].observed_at = '2026-07-21';
  brainstorm.evidence[0].confidence = 1.1;
  brainstorm.evidence[0].conflicts = [null];
  assert.match(
    validateDecisionContract('brainstorm', brainstorm).join('\n'),
    /observed_at: required RFC 3339[\s\S]*confidence: required number from 0 to 1[\s\S]*conflicts\[0\]: required string/,
  );
});

test('portable brainstorm contract validates each active exploration phase', async () => {
  const { validateDecisionContract } = await portableContracts;
  const afterPhase = {
    frame: ['ideas', 'clusters', 'approaches', 'recommendedDefault', 'shortlist', 'dissent', 'cheapestExperiment', 'directionGate'],
    diverge: ['clusters', 'approaches', 'recommendedDefault', 'shortlist', 'dissent', 'cheapestExperiment', 'directionGate'],
    cluster: ['approaches', 'recommendedDefault', 'shortlist', 'dissent', 'cheapestExperiment', 'directionGate'],
    converge: ['recommendedDefault', 'dissent', 'cheapestExperiment', 'directionGate'],
    decision: [],
  };
  for (const [phase, fields] of Object.entries(afterPhase)) {
    const brainstorm = { ...clone(validBrainstorm()), contract_version: 3, phase };
    delete brainstorm._meta;
    removeFields(brainstorm, fields);
    assert.deepEqual(validateDecisionContract('brainstorm', brainstorm), [], phase);
  }

  const quick = { ...clone(validBrainstorm()), contract_version: 3, depth: 'quick' };
  delete quick._meta;
  removeFields(quick, ['clusters', 'dissent']);
  assert.deepEqual(validateDecisionContract('brainstorm', quick), []);

  const incompleteDivergence = { ...clone(validBrainstorm()), contract_version: 3, phase: 'diverge' };
  delete incompleteDivergence._meta;
  removeFields(incompleteDivergence, ['ideas', 'clusters', 'approaches', 'recommendedDefault', 'shortlist', 'dissent', 'cheapestExperiment', 'directionGate']);
  assert.match(validateDecisionContract('brainstorm', incompleteDivergence).join('\n'), /ideas: required array/);
});

test('portable plan contract rejects unsafe approval, graph, and placeholder defects', async () => {
  const { validateDecisionContract } = await portableContracts;
  const payload = { ...validPlan(), contract_version: 3 };
  delete payload._meta;
  payload.decision.status = 'approved';
  payload.tasks = [
    { ...planTask, id: 'T1', dependsOn: ['T2'], verify: '{TEST_CMD}' },
    { ...planTask, id: 'T2', dependsOn: ['T1'] },
    { ...planTask, id: 'T2', dependsOn: ['T1'] },
    { ...planTask, id: 'T3', dependsOn: ['missing'] },
  ];
  const errors = validateDecisionContract('plan', payload).join('\n');
  assert.match(errors, /decision.status: must be pending\|delegated/);
  assert.match(errors, /duplicate task id/);
  assert.match(errors, /unknown task id/);
  assert.match(errors, /dependency cycle/);
  assert.match(errors, /unresolved placeholder/);
});

test('portable brainstorm contract requires complete distinct approach cards', async () => {
  const { validateDecisionContract } = await portableContracts;
  const payload = { ...validBrainstorm(), contract_version: 3 };
  delete payload._meta;
  delete payload.approaches[0].thesis;
  payload.approaches[0].whatBreaks = [];
  payload.approaches[0].visualType = 'wireframe';
  payload.approaches[0].mutualExclusivity = [payload.approaches[0].id, 'missing'];
  payload.approaches[1].id = payload.approaches[0].id;
  const errors = validateDecisionContract('brainstorm', payload).join('\n');
  assert.match(errors, /approaches\[0\]\.thesis: required string/);
  assert.match(errors, /approaches\[0\]\.whatBreaks: required non-empty array/);
  assert.match(errors, /duplicate approach id/);
  assert.match(errors, /invalid visual type/);
  assert.match(errors, /cannot exclude itself/);
  assert.match(errors, /unknown approach id/);
});

test('portable plan contract enforces enriched traceability and readiness', async () => {
  const { validateDecisionContract } = await portableContracts;
  const cases = [
    ['empty change set', (plan) => {
      plan.change_set = { added: [], modified: [], removed: [], unchanged: [] };
    }, /change_set: at least one change is required/],
    ['duplicate scenario', (plan) => {
      plan.scenarios[1].id = plan.scenarios[0].id;
    }, /scenarios\[\]\.id: duplicate id/],
    ['unknown coverage references', (plan) => {
      plan.coverage[0].scenarioIds = ['missing-scenario'];
      plan.coverage[0].taskIds = ['missing-task'];
    }, /unknown scenario id[\s\S]*unknown task id/],
    ['uncovered task', (plan) => {
      plan.coverage = plan.coverage.filter(({ taskIds }) => !taskIds.includes('T4'));
    }, /coverage: task "T4" is not covered/],
    ['empty task interface', (plan) => {
      plan.tasks[0].consumes = [];
      plan.tasks[0].produces = [];
    }, /tasks\[0\]\.consumes: required non-empty array[\s\S]*tasks\[0\]\.produces: required non-empty array/],
    ['invalid readiness', (plan) => {
      plan.readiness.verdict = 'MAYBE';
    }, /readiness\.verdict: must be READY\|CONCERNS\|BLOCKED/],
  ];
  for (const [label, mutate, expected] of cases) {
    const plan = addEvidenceFreshness(clone(richFixture('plan')));
    mutate(plan);
    assert.match(validateDecisionContract('plan', plan).join('\n'), expected, label);
  }
});

test('portable brainstorm contract enforces provenance and minority dissent', async () => {
  const { validateDecisionContract } = await portableContracts;
  const cases = [
    ['invalid stance', (brainstorm) => {
      brainstorm.stance.mode = 'oracle';
    }, /stance\.mode: must be facilitator\|creative-partner\|generate-for-me/],
    ['invalid phase', (brainstorm) => {
      brainstorm.phase = 'implement';
    }, /phase: must be frame\|diverge\|cluster\|converge\|decision/],
    ['duplicate idea', (brainstorm) => {
      brainstorm.ideas[1].id = brainstorm.ideas[0].id;
    }, /ideas\[\]\.id: duplicate id/],
    ['unknown cluster idea', (brainstorm) => {
      brainstorm.clusters[0].ideaIds = ['missing-idea'];
    }, /unknown idea id/],
    ['unconnected idea', (brainstorm) => {
      for (const cluster of brainstorm.clusters) cluster.ideaIds = cluster.ideaIds.filter((id) => id !== 'I6');
    }, /clusters: idea "I6" is not connected/],
    ['missing shortlist entry', (brainstorm) => {
      brainstorm.shortlist.pop();
    }, /shortlist: approach "markdown-record" is not represented/],
    ['duplicate shortlist entry', (brainstorm) => {
      brainstorm.shortlist[1].approachId = brainstorm.shortlist[0].approachId;
    }, /shortlist\[1\]\.approachId: duplicate approach id/],
    ['recommended dissent', (brainstorm) => {
      brainstorm.dissent.approachId = brainstorm.recommendedDefault.id;
    }, /must challenge the recommended approach/],
  ];
  for (const [label, mutate, expected] of cases) {
    const brainstorm = addEvidenceFreshness(clone(richFixture('brainstorm')));
    mutate(brainstorm);
    assert.match(validateDecisionContract('brainstorm', brainstorm).join('\n'), expected, label);
  }
});
