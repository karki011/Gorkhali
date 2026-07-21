// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const { validate } = require('../scripts/validate-artifact');
const { renderPlanHtml } = require('../scripts/render-plan');
const { renderBrainstormHtml } = require('../scripts/render-brainstorm');

const richFixture = (type) => JSON.parse(
  fs.readFileSync(path.join(__dirname, `fixtures/decision-first/${type}-v3-rich.json`), 'utf8'),
);
const textPattern = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const portableRenderer = import(pathToFileURL(
  path.resolve(__dirname, '../skills/phantom/scripts/render-review.mjs'),
).href);
const portableContracts = import(pathToFileURL(
  path.resolve(__dirname, '../skills/phantom/scripts/lib/decision-contracts.mjs'),
).href);
const externalAssetPattern = /<script|(?:src|href)=["']https?:\/\/|@import\s+url\(["']?https?:\/\//;
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

const relativeLuminance = (hex) => {
  const channels = hex.match(/[a-f\d]{2}/gi).map((channel) => Number.parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (foreground, background) => {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
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
  read_first: ['scripts/render-plan.js'],
  action: 'Reorder plan sections around the decision contract',
  files: ['scripts/render-plan.js'],
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
    components: ['artifact validator', 'deterministic renderer'],
    dataFlow: ['plan.json', 'validate', 'render', 'human review'],
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
      source: 'scripts/render-brainstorm.js',
      status: 'verified',
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
    cost: 'One deterministic renderer test',
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

test('portable plan contract enforces canonical quick writes without breaking legacy reads', async () => {
  const { validateDecisionContract } = await portableContracts;
  const canonical = { ...validPlan(), contract_version: 3, depth: 'quick' };
  delete canonical._meta;
  removeFields(canonical, ['solution_shape', 'change_set', 'readiness']);
  canonical.scenarios = [];
  canonical.alternatives = [];
  canonical.coverage = [];
  removeFields(canonical.tasks[0], ['risk', 'recovery']);
  assert.deepEqual(validateDecisionContract('plan', canonical, { enforceCanonicalQuick: true }), []);

  const legacy = { ...validPlan(), contract_version: 3, depth: 'quick' };
  delete legacy._meta;
  removeFields(legacy.tasks[0], ['risk', 'recovery']);
  assert.deepEqual(validateDecisionContract('plan', legacy), []);
  assert.match(
    validateDecisionContract('plan', legacy, { enforceCanonicalQuick: true }).join('\n'),
    /solution_shape: omit for quick plans[\s\S]*change_set: omit for quick plans[\s\S]*readiness: omit for quick plans[\s\S]*scenarios: must be empty for quick plans[\s\S]*alternatives: must be empty for quick plans[\s\S]*coverage: must be empty for quick plans/,
  );

  const missingArrays = clone(canonical);
  removeFields(missingArrays, ['scenarios', 'alternatives', 'coverage']);
  assert.match(
    validateDecisionContract('plan', missingArrays, { enforceCanonicalQuick: true }).join('\n'),
    /scenarios: required empty array for quick plans[\s\S]*alternatives: required empty array for quick plans[\s\S]*coverage: required empty array for quick plans/,
  );
});

test('portable plan paths are explicit, normalized, and distinguish intentional new files', async () => {
  const { validateDecisionContract } = await portableContracts;
  const base = { ...validPlan(), contract_version: 3 };
  delete base._meta;
  base.tasks[0].files.push('src/new-renderer.js');
  base.tasks[0].new_files = ['src/new-renderer.js'];
  const strictPaths = { enforcePathProvenance: true };
  assert.deepEqual(validateDecisionContract('plan', base, strictPaths), []);

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
    assert.match(validateDecisionContract('plan', plan, strictPaths).join('\n'), expected, label);
  }

  const legacy = clone(base);
  legacy.tasks[0].files = ['src\\legacy.ts'];
  assert.deepEqual(validateDecisionContract('plan', legacy), []);

  const malformed = clone(base);
  malformed.tasks[0].read_first = [null];
  assert.match(
    validateDecisionContract('plan', malformed, {
      enforcePathProvenance: true,
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

test('plan HTML leads with the decision and renders execution as an appendix', () => {
  const plan = validPlan();
  const html = renderPlanHtml(plan, {
    intent: { data: { goal: 'legacy duplicate goal', tradeoffs: ['legacy duplicate tradeoff'] } },
  });
  assert.match(html, /<body class="kit-wide">/);
  assert.match(html, /class="kit-topbar-inner"/);
  assert.match(html, /href="#main-content">Skip to content/);
  assert.match(html, /aria-label="Document sections"/);
  assert.match(html, /--content-max:1440px/);
  assert.ok(html.indexOf('Decision brief') < html.indexOf('Outcome and success'));
  assert.ok(html.indexOf('Outcome and success') < html.indexOf('Evidence'));
  assert.ok(html.indexOf('Evidence') < html.indexOf('Risks and reversibility'));
  assert.ok(html.indexOf('Risks and reversibility') < html.indexOf('Waves'));
  assert.match(html, /<caption class="kit-sr-only">Files affected by the execution plan<\/caption>/);
  assert.doesNotMatch(html, /legacy duplicate goal|legacy duplicate tradeoff/);
  assert.equal(html.split(plan.decision.recommendation).length - 1, 1, 'recommendation renders exactly once');
});

test('canonical brainstorm v3 leads with a recommendation and decision frame', () => {
  const brainstorm = validBrainstorm();
  assert.deepEqual(validate('brainstorm', brainstorm), []);
  const html = renderBrainstormHtml(brainstorm);
  assert.match(html, /<body class="kit-wide">/);
  assert.ok(html.indexOf('Recommendation') < html.indexOf('Decision frame'));
  assert.ok(html.indexOf('Decision frame') < html.indexOf('Side-by-side'));
  assert.ok(html.indexOf('Cheapest experiment') < html.indexOf('Approaches'));
  assert.match(html, /class="bs-approach-grid"/);
  assert.match(html, /Side-by-side comparison of brainstorm approaches/);
  assert.match(html, /<th scope="row" class="bs-crit">Effort<\/th>/);
  assert.match(html, /role="region" aria-label="Approach comparison; scroll horizontally for more columns" tabindex="0"/);

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

test('portable decision contract validates enriched v3 and preserves earlier v3 decision records', async () => {
  const { validateDecisionContract } = await portableContracts;
  const planPayload = { ...validPlan(), contract_version: 3 };
  delete planPayload._meta;
  assert.deepEqual(validateDecisionContract('plan', planPayload), []);
  const earlierPlan = removeFields(clone(planPayload), ['change_set', 'scenarios', 'coverage', 'readiness']);
  for (const task of earlierPlan.tasks) removeFields(task, ['consumes', 'produces']);
  assert.deepEqual(validateDecisionContract('plan', earlierPlan), []);
  const earlierBrainstorm = { ...validBrainstorm(), contract_version: 3 };
  delete earlierBrainstorm._meta;
  removeFields(earlierBrainstorm, ['depth', 'stance', 'phase', 'ideas', 'clusters', 'shortlist', 'dissent']);
  removeFields(earlierBrainstorm.decision, ['audience', 'nonGoals']);
  assert.deepEqual(validateDecisionContract('brainstorm', earlierBrainstorm), []);
  assert.match(
    validateDecisionContract('plan', { contract_version: 3 }).join('\n'),
    /decision: required object/,
  );
  assert.deepEqual(validateDecisionContract('plan', { tasks: [] }), []);
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
  const { validateDelegationResultContract, validateDelegationTaskContract } = await portableContracts;
  const task = {
    contract_version: 1,
    task_id: 'T1',
    role: 'Blade',
    profile: 'balanced',
    objective: 'Implement one bounded validator change',
    context_refs: [{ id: 'plan', kind: 'artifact', ref: 'current-plan' }],
    requires_judgment: false,
    inputs: { files: ['skills/phantom/scripts/lib/decision-contracts.mjs'] },
    constraints: ['Do not change unrelated files'],
    deliverables: ['Delegation validators'],
    acceptance_criteria: ['Focused tests pass'],
    write_scope: ['skills/phantom/scripts/lib/decision-contracts.mjs'],
  };
  assert.deepEqual(validateDelegationTaskContract(task), []);
  assert.deepEqual(validateDelegationResultContract({
    contract_version: 1,
    task_id: 'T1',
    status: 'ok',
    output: { summary: 'Implemented and verified' },
    error: null,
  }), []);
  assert.deepEqual(validateDelegationResultContract({
    contract_version: 1,
    task_id: 'T1',
    status: 'error',
    output: null,
    error: { code: 'CAPABILITY_UNAVAILABLE', message: 'No structured worker API', retryable: false },
  }), []);

  const invalidTask = clone(task);
  invalidTask.contract_version = 2;
  assert.match(validateDelegationTaskContract(invalidTask).join('\n'), /unsupported version/);
  invalidTask.contract_version = 1;
  invalidTask.context_refs = [{ id: 'plan', kind: 'filesystem-blackboard', ref: '' }];
  invalidTask.requires_judgment = 'no';
  const taskErrors = validateDelegationTaskContract(invalidTask).join('\n');
  assert.match(taskErrors, /context_refs\[0\]\.ref: required string/);
  assert.match(taskErrors, /context_refs\[0\]\.kind: must be artifact\|resource\|conversation/);
  assert.match(taskErrors, /requires_judgment: required boolean/);

  assert.match(validateDelegationResultContract({
    contract_version: 1,
    task_id: 'T1',
    status: 'ok',
    output: null,
    error: { code: 'WRONG', message: 'Inconsistent result', retryable: false },
  }).join('\n'), /output: required object[\s\S]*error: must be null/);
});

test('canonical plan and brainstorm writes require bounded evidence freshness without breaking v3 reads', async () => {
  const { validateDecisionContract } = await portableContracts;
  const plan = { ...validPlan(), contract_version: 3 };
  delete plan._meta;
  assert.deepEqual(validateDecisionContract('plan', plan), []);
  assert.match(
    validateDecisionContract('plan', plan, { enforceEvidenceFreshness: true }).join('\n'),
    /evidence\[0\]\.observed_at: required RFC 3339[\s\S]*evidence\[0\]\.confidence: required number from 0 to 1/,
  );
  addEvidenceFreshness(plan);
  plan.evidence[0].conflicts = ['A prior document describes the old behavior'];
  assert.deepEqual(validateDecisionContract('plan', plan, { enforceEvidenceFreshness: true }), []);

  const brainstorm = { ...validBrainstorm(), contract_version: 3 };
  delete brainstorm._meta;
  addEvidenceFreshness(brainstorm);
  assert.deepEqual(validateDecisionContract('brainstorm', brainstorm, { enforceEvidenceFreshness: true }), []);
  brainstorm.evidence[0].observed_at = '2026-07-21';
  brainstorm.evidence[0].confidence = 1.1;
  brainstorm.evidence[0].conflicts = [null];
  assert.match(
    validateDecisionContract('brainstorm', brainstorm, { enforceEvidenceFreshness: true }).join('\n'),
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
    const plan = clone(richFixture('plan'));
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
    const brainstorm = clone(richFixture('brainstorm'));
    mutate(brainstorm);
    assert.match(validateDecisionContract('brainstorm', brainstorm).join('\n'), expected, label);
  }
});

test('bundled portable renderer produces the same decision-first full-width review hierarchy', async () => {
  const { renderReviewHtml } = await portableRenderer;
  const payload = { ...validPlan(), contract_version: 3 };
  delete payload._meta;
  const envelope = { schema_version: 1, artifact_type: 'plan', evidence: payload };
  const html = renderReviewHtml('plan', envelope);
  assert.match(html, /width:min\(100%,1600px\)/);
  assert.match(html, /href="#main">Skip to content/);
  assert.ok(html.indexOf('<h2>Plan summary</h2>') < html.indexOf('<h2>What we picked</h2>'));
  assert.ok(html.indexOf('<h2>What we picked</h2>') < html.indexOf('<h2>Evidence</h2>'));
  for (const text of [payload.problem, payload.decision.recommendation, payload.solution_shape.summary, payload.outcome.goal]) {
    assert.match(html, textPattern(text));
  }
  assert.match(html, /Problem: Task-first plans hide the reasoning/);
  assert.ok(html.indexOf('<h2>Evidence</h2>') < html.indexOf('<h2>Execution appendix</h2>'));
  assert.match(html, /<details class="execution-details"><summary>/);
  assert.doesNotMatch(html, /<details class="execution-details" open>/);
  assert.match(html, /\.execution-details:not\(\[open\]\)>\.execution-body\{display:block!important\}/);
  assert.doesNotMatch(html, externalAssetPattern);
  assert.throws(() => renderReviewHtml('plan', { tasks: [] }), /contract_version: required/);
  assert.throws(
    () => renderReviewHtml('plan', { contract_version: 4 }),
    /contract_version: unsupported version/,
  );
});

test('bundled brainstorm renderer provides a distinct exploration workbench', async () => {
  const { renderReviewHtml } = await portableRenderer;
  const payload = { ...validBrainstorm(), contract_version: 3 };
  delete payload._meta;
  const html = renderReviewHtml('brainstorm', payload);
  assert.ok(html.indexOf('Current direction') < html.indexOf('Frame and stance'));
  assert.ok(html.indexOf('Frame and stance') < html.indexOf('Divergence field'));
  assert.ok(html.indexOf('Divergence field') < html.indexOf('Connections and clusters'));
  assert.ok(html.indexOf('Connections and clusters') < html.indexOf('Convergence and shortlist'));
  assert.ok(html.indexOf('Convergence and shortlist') < html.indexOf('Cheapest experiment'));
  assert.ok(html.indexOf('Cheapest experiment') < html.indexOf('Direction gate'));
  assert.match(html, /<caption>Side-by-side comparison of brainstorm approaches<\/caption>/);
  assert.match(html, /<th scope="col">Approach<\/th>/);
  assert.match(html, /role="region" aria-label="Approach comparison; scroll horizontally for more columns" tabindex="0"/);
});

test('review workbench small-text accents meet WCAG AA contrast in the light palette', async () => {
  const { renderReviewHtml } = await portableRenderer;
  const payload = { ...validBrainstorm(), contract_version: 3 };
  delete payload._meta;
  const html = renderReviewHtml('brainstorm', payload);
  assert.match(html, /--teal-text:#17656a/);
  assert.match(html, /--orange-text:#a52a12/);
  assert.match(html, /\.scenario-card dt\{color:var\(--teal-text\)\}/);
  assert.match(html, /\.idea-id\{color:var\(--teal-text\)/);
  assert.match(html, /\.cluster-head>span[\s\S]*color:var\(--orange-text\)/);
  assert.ok(contrastRatio('#17656a', '#ffffff') >= 4.5);
  assert.ok(contrastRatio('#a52a12', '#fff0eb') >= 4.5);
});

test('rich plan renders as a semantic engineering decision dossier', async () => {
  const { renderReviewHtml } = await portableRenderer;
  const plan = richFixture('plan');
  const html = renderReviewHtml('plan', plan);

  for (const marker of [
    'plan-summary',
    'decision-spine',
    'architecture-grid',
    'change-ledger',
    'scenario-grid',
    'coverage-table',
    'flow-track',
    'evidence-ledger',
    'alternative-grid',
    'risk-grid',
    'validation-grid',
    'execution-details',
    'execution-section',
    'task-card',
    'interface-contract',
    'readiness-card',
  ]) {
    assert.match(html, new RegExp(`class="[^"]*${marker}`));
  }
  for (const evidence of plan.evidence) {
    assert.match(html, textPattern(evidence.claim));
    assert.match(html, textPattern(evidence.source));
  }
  for (const task of plan.tasks) assert.match(html, new RegExp(`>${task.id}<`));
  for (const field of [plan.route, plan.devilsAdvocateVerdict, ...plan.tasks.flatMap(({ read_first }) => read_first)]) {
    assert.match(html, textPattern(field));
  }
  assert.equal(html.split(plan.summary).length - 1, 1, 'authored summary renders exactly once');
  assert.ok(html.indexOf('<h2>Plan summary</h2>') < html.indexOf('<h2>What we picked</h2>'));
  assert.ok(html.indexOf('<h2>What we picked</h2>') < html.indexOf('<h2>What changes</h2>'));
  assert.ok(html.indexOf('<h2>What changes</h2>') < html.indexOf('<h2>Behavior scenarios</h2>'));
  assert.ok(html.indexOf('<h2>Solution architecture</h2>') < html.indexOf('<h2>Evidence</h2>'));
  assert.ok(html.indexOf('<h2>Requirement coverage</h2>') < html.indexOf('<h2>Execution appendix</h2>'));
  assert.ok(html.indexOf('<h2>Validation strategy</h2>') < html.indexOf('<h2>Execution appendix</h2>'));
  assert.ok(html.indexOf('<h2>Readiness verdict</h2>') < html.indexOf('<h2>Execution appendix</h2>'));
  assert.match(html, /<details class="execution-details"><summary>/);
  assert.doesNotMatch(html, /<details class="execution-details" open>/);
  assert.match(html, /Open after the direction is approved and implementation begins\./);
  assert.equal(html.split(plan.open_questions[0].question).length - 1, 1, 'nonblocking question renders outside the gate');
  assert.match(html, /@media\(max-width:620px\)/);
  assert.match(html, /\.flow-track\{grid-template-columns:1fr\}/);
  assert.doesNotMatch(html, externalAssetPattern);

  const canonicalHtml = renderPlanHtml(plan);
  for (const text of [plan.decision.recommendation, plan.outcome.goal, plan.evidence[0].claim]) {
    assert.match(canonicalHtml, textPattern(text));
  }
});

test('rich brainstorm renders provenance, convergence, dissent, and a direction gate', async () => {
  const { renderReviewHtml } = await portableRenderer;
  const brainstorm = richFixture('brainstorm');
  const html = renderReviewHtml('brainstorm', brainstorm);

  for (const marker of [
    'decision-spine',
    'exploration-stagebar',
    'idea-field',
    'idea-lane',
    'cluster-board',
    'convergence-funnel',
    'shortlist-grid',
    'dissent-card',
    'direction-gate',
    'recommended-row',
    'approach-grid',
    'approach-card selected',
    'evidence-ledger',
    'experiment-track',
  ]) {
    assert.match(html, new RegExp(`class="[^"]*${marker}`));
  }
  for (const approach of brainstorm.approaches) {
    assert.match(html, textPattern(approach.name));
    assert.match(html, textPattern(approach.failureMode));
    assert.match(html, textPattern(approach.whyLens));
    for (const ruledOut of approach.mutualExclusivity) assert.match(html, textPattern(ruledOut));
  }
  for (const idea of brainstorm.ideas) {
    assert.match(html, textPattern(idea.title));
    assert.match(html, new RegExp(textPattern(idea.technique.replaceAll('-', ' ')).source, 'i'));
  }
  for (const cluster of brainstorm.clusters) assert.match(html, textPattern(cluster.insight));
  for (const item of [...brainstorm.decision.audience, ...brainstorm.decision.nonGoals]) {
    assert.match(html, textPattern(item));
  }
  assert.match(html, textPattern(brainstorm.dissent.case));
  assert.equal(html.split(brainstorm.openQuestions[0].question).length - 1, 1);
  assert.match(html, textPattern(brainstorm.problem));
  assert.ok(html.indexOf('<h2>Current direction</h2>') < html.indexOf('<h2>Frame and stance</h2>'));
  assert.ok(html.indexOf('<h2>Frame and stance</h2>') < html.indexOf('<h2>Divergence field</h2>'));
  assert.ok(html.indexOf('<h2>Divergence field</h2>') < html.indexOf('<h2>Connections and clusters</h2>'));
  assert.ok(html.indexOf('<h2>Connections and clusters</h2>') < html.indexOf('<h2>Convergence and shortlist</h2>'));
  assert.ok(html.indexOf('<h2>Convergence and shortlist</h2>') < html.indexOf('<h2>Dissenting case</h2>'));
  assert.ok(html.indexOf('<h2>Dissenting case</h2>') < html.indexOf('<h2>Cheapest experiment</h2>'));
  assert.ok(html.indexOf('<h2>Cheapest experiment</h2>') < html.indexOf('<h2>Direction gate</h2>'));
  assert.doesNotMatch(html, externalAssetPattern);

  const canonicalHtml = renderBrainstormHtml(brainstorm);
  for (const text of [brainstorm.recommendedDefault.reason, brainstorm.evidence[0].claim]) {
    assert.match(canonicalHtml, textPattern(text));
  }
});

test('enriched portable views are deterministic, distinct, and escape every new primitive', async () => {
  const { renderReviewHtml } = await portableRenderer;
  const plan = richFixture('plan');
  const brainstorm = richFixture('brainstorm');
  const planHtml = renderReviewHtml('plan', plan);
  const brainstormHtml = renderReviewHtml('brainstorm', brainstorm);

  assert.equal(renderReviewHtml('plan', clone(plan)), planHtml);
  assert.equal(renderReviewHtml('brainstorm', clone(brainstorm)), brainstormHtml);
  assert.match(planHtml, /<body class="review-plan">/);
  assert.doesNotMatch(planHtml, /class="idea-field"|class="cluster-board"/);
  assert.match(brainstormHtml, /<body class="review-brainstorm">/);
  assert.doesNotMatch(brainstormHtml, /class="change-ledger"|class="coverage-table"|class="readiness-card"/);

  const hostile = '<script>alert("review")</script>';
  const hostilePlan = clone(plan);
  hostilePlan.summary = hostile;
  hostilePlan.change_set.added[0] = hostile;
  hostilePlan.scenarios[0].given = hostile;
  hostilePlan.tasks[0].consumes[0] = hostile;
  const hostileBrainstorm = clone(brainstorm);
  hostileBrainstorm.ideas[0].title = hostile;
  hostileBrainstorm.clusters[0].insight = hostile;
  hostileBrainstorm.shortlist[0].reservation = hostile;
  hostileBrainstorm.dissent.case = hostile;
  for (const html of [renderReviewHtml('plan', hostilePlan), renderReviewHtml('brainstorm', hostileBrainstorm)]) {
    assert.match(html, /&lt;script&gt;alert\(&quot;review&quot;\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, externalAssetPattern);
  }
});
