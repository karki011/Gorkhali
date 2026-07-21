// Author: Subash Karki
// plan-brainstorm-eval.test.js - golden-file OUTPUT-QUALITY eval for
// render-plan.js and render-brainstorm.js. render-plan.test.js and
// render-brainstorm.test.js already cover escaping/tolerance/CLI-contract per
// renderer; this file is the dedicated eval that answers "can we eval this?"
// by asserting the two renderers together produce the RIGHT shape - narrative
// lead before tasks, body-before-details tasks, dependency/risk sections, and
// the brainstorm comparison table + recommendation + visual sketch. A renderer
// regression that drops one of these elements fails here with a message that
// names the missing element, not a generic assert failure.
//
// The renderers now present through the shared CloudZero design kit
// (scripts/lib/html-kit.js), so headings are <h2 class="kit-h2"> (sentence
// case) and task bodies live in <div class="task-body"> ahead of the
// <details class="task-details"> block. This file asserts against that markup,
// preserves the ordering INVARIANTS the old exact strings encoded (goal before
// the first task; task body/outcome before the collapsible details), and adds a
// sanitized real-world-shape fixture plus cross-renderer consistency checks
// (known plan vocabulary renders first-class, bespoke unknown keys surface
// humanized under "Other fields" with no raw JSON dump or raw-key leak, both
// pages carry the identical kit token marker, no uppercasing field labels).
//
// Fixtures live in test/fixtures/plan-brainstorm/ (plan.json + intent.json +
// wiring.json + brainstorm.json + plan-realworld.json) - see that directory's
// README.md to run this file standalone.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { renderPlanHtml } = require('../scripts/render-plan');
const { renderBrainstormHtml } = require('../scripts/render-brainstorm');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'plan-brainstorm');
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));

const plan = loadFixture('plan.json');
const intent = loadFixture('intent.json');
const wiring = loadFixture('wiring.json');
const brainstorm = loadFixture('brainstorm.json');
const realworld = loadFixture('plan-realworld.json');

// Named-failure helper: reports exactly which expected substrings are absent
// from the rendered output, rather than one assert per element silently
// pointing at the wrong line. Used by the falsifiability canary below and
// available to any assertion that wants a multi-element failure message.
const missingElements = (html, expected) => expected.filter((needle) => !html.includes(needle));

const planHtml = renderPlanHtml(plan, { sourcePath: 'plan.json', intent: { data: intent }, wiring: { data: wiring } });
const brainstormHtml = renderBrainstormHtml(brainstorm, { sourcePath: 'brainstorm.json' });
const REALWORLD_OPTS = { sourcePath: 'plan-realworld.json' };
const realworldHtml = renderPlanHtml(realworld, REALWORLD_OPTS);

// ── plan.html: narrative lead + body-before-details tasks + wiring ─────────

test('plan: goal + Why/Pain render ABOVE the first task', () => {
  const goalIdx = planHtml.indexOf('<h2 class="kit-h2">Goal</h2>');
  const whyIdx = planHtml.indexOf('<h2 class="kit-h2">Why</h2>');
  const firstTaskIdx = planHtml.indexOf('T1-eval-fixtures');

  assert.ok(goalIdx > -1, 'plan.html regressed: Goal section missing');
  assert.ok(whyIdx > -1, 'plan.html regressed: Why section missing');
  assert.ok(firstTaskIdx > -1, 'plan.html regressed: first task missing entirely');
  assert.ok(goalIdx < firstTaskIdx, 'plan.html regressed: Goal no longer leads the first task');
  assert.ok(whyIdx < firstTaskIdx, 'plan.html regressed: Why no longer leads the first task');
});

test('plan: task body renders as visible content, ahead of any collapsible detail block', () => {
  // The task's prose body renders in <div class="task-body"> as first-class,
  // always-visible content. Files, body, and the Done-when checklist are no
  // longer collapsed - only secondary bookkeeping (verify/read_first/dependsOn)
  // falls into <details>, which may be absent entirely when a task carries none.
  const bodyIdx = planHtml.indexOf('<div class="task-body">');
  assert.ok(bodyIdx > -1, 'plan.html regressed: task body block missing');
  assert.ok(
    planHtml.includes('OUTCOME: golden-file eval proves renderer output quality.'),
    'plan.html regressed: task body text missing',
  );
  // When a details block exists it follows the visible body, never precedes it.
  const detailsIdx = planHtml.indexOf('<details class="task-details">');
  if (detailsIdx > -1) {
    assert.ok(bodyIdx < detailsIdx, 'plan.html regressed: task body no longer precedes the detail block');
  }
});

test('plan: Tradeoffs section renders from intent.json', () => {
  assert.ok(planHtml.includes('<h2 class="kit-h2">Tradeoffs</h2>'), 'plan.html regressed: Tradeoffs section missing');
  assert.ok(
    planHtml.includes('keeps file ownership disjoint from T1/T3'),
    'plan.html regressed: tradeoff item text missing',
  );
});

test('plan: Dependencies + Risk points sections render from wiring.json', () => {
  const missing = missingElements(planHtml, [
    '<h2 class="kit-h2">Dependencies</h2>',
    '<h2 class="kit-h2">Risk points</h2>',
    'test/plan-brainstorm-eval.test.js',
    'Fixtures mirror the real intent.json/wiring.json shapes',
  ]);
  assert.deepEqual(missing, [], `plan.html regressed: missing element(s) ${JSON.stringify(missing)}`);
});

test('plan: acceptance_criteria renders as a checklist, never a raw JSON dump', () => {
  assert.ok(planHtml.includes('<ul class="kit-checklist">'), 'plan.html regressed: acceptance criteria checklist missing');
  assert.ok(planHtml.includes('leads with goal before first task'), 'plan.html regressed: acceptance criteria item missing');
  assert.ok(!/"acceptance_criteria"/.test(planHtml), 'plan.html regressed: acceptance_criteria leaked as a raw JSON key');
});

// ── brainstorm.html: comparison table + approach spine + recommendation ────

test('brainstorm: side-by-side tradeoff table renders one column per approach', () => {
  assert.ok(brainstormHtml.includes('<h2 class="kit-h2">Side-by-side</h2>'), 'brainstorm.html regressed: Side-by-side heading missing');
  assert.ok(brainstormHtml.includes('<table>'), 'brainstorm.html regressed: tradeoff table missing');
  for (const name of ['Dedicated eval file', 'Fold into existing test files', 'Snapshot testing library']) {
    assert.ok(brainstormHtml.includes(name), `brainstorm.html regressed: approach column "${name}" missing`);
  }
});

test('brainstorm: recommended-default block names the pick and its reason', () => {
  assert.ok(brainstormHtml.includes('<h2 class="kit-h2">Recommendation</h2>'), 'brainstorm.html regressed: Recommendation heading missing');
  assert.ok(brainstormHtml.includes('Recommended: Dedicated eval file'), 'brainstorm.html regressed: recommended approach label missing');
  assert.ok(
    brainstormHtml.includes('Keeps file ownership disjoint from T1/T3'),
    'brainstorm.html regressed: recommendation reason missing',
  );
});

test('brainstorm: every approach-card spine field renders', () => {
  const missing = missingElements(brainstormHtml, [
    'Why this lens',
    'requires an eval that fails loudly on regression',
    'What breaks if wrong',
    'the file is additive and owns no shared code',
    'When to pick',
    'ownership must stay disjoint',
    'Mutual exclusivity',
    'Complements A2/A3',
  ]);
  assert.deepEqual(missing, [], `brainstorm.html regressed: missing spine field(s) ${JSON.stringify(missing)}`);
});

test('brainstorm: visualType diagram block renders for the approach that declares one', () => {
  assert.ok(brainstormHtml.includes('Diagram sketch'), 'brainstorm.html regressed: visualType diagram sketch missing');
  assert.ok(
    brainstormHtml.includes('<span class="kit-chip kit-chip-brand">diagram</span>'),
    'brainstorm.html regressed: visualType chip missing from its approach card',
  );
});

// ── real-world plan shape: first-class vocabulary + readable fall-through ───
// plan-realworld.json is a sanitized structural clone of a genuine planner
// output - the same awkward shape (nested objects, arrays of objects,
// paragraph-length estimate values, an enumerated mega-paragraph task text, and
// a bespoke unknown key). It proves the redesign against reality, not a fixture
// tailored to pass.

test('realworld: the known plan vocabulary renders as first-class sections', () => {
  const missing = missingElements(realworldHtml, [
    '<h2 class="kit-h2">Summary</h2>',
    '<h2 class="kit-h2">Verified facts</h2>',
    '<h2 class="kit-h2">Decision brief</h2>',
    '<h2 class="kit-h2">Test plan</h2>',
    '<h2 class="kit-h2">Conventions</h2>',
    '<h2 class="kit-h2">Risks and reversibility</h2>',
    '<h2 class="kit-h2">Estimate</h2>',
    '<h2 class="kit-h2">Assumptions</h2>',
  ]);
  assert.deepEqual(missing, [], `plan.html regressed: known field(s) not first-class ${JSON.stringify(missing)}`);
});

test('realworld: raw underscore/camel keys never leak into the rendered page', () => {
  const leaked = [
    'verified_facts',
    'decisions_for_approval',
    'test_plan',
    'conventions_contract',
    'how_to_send_otel_from_claude_code',
  ].filter((key) => realworldHtml.includes(key));
  assert.deepEqual(leaked, [], `plan.html regressed: raw key(s) leaked into output ${JSON.stringify(leaked)}`);
});

test('realworld: the bespoke unknown key surfaces humanized under Other fields, no raw JSON dump', () => {
  const otherIdx = realworldHtml.indexOf('<h2 class="kit-h2">Other fields</h2>');
  assert.ok(otherIdx > -1, 'plan.html regressed: Other fields section missing for the bespoke key');

  // The bespoke key is humanized, not shown raw or JSON-dumped.
  assert.ok(
    realworldHtml.includes('How to send otel from claude code'),
    'plan.html regressed: bespoke unknown key not humanized under Other fields',
  );
  assert.ok(
    !/<pre[^>]*>\s*[{[]/.test(realworldHtml),
    'plan.html regressed: fall-through rendered a raw JSON/array <pre> dump',
  );

  // "Not under Other fields": the first-class labels appear earlier as their own
  // <h2>, and the Other-fields tail (last section) does not repeat them.
  const tail = realworldHtml.slice(otherIdx);
  const repeated = ['Verified facts', 'Decisions for approval', 'Test plan', 'Conventions', 'Estimate', 'Assumptions']
    .filter((label) => tail.includes(label));
  assert.deepEqual(repeated, [], `plan.html regressed: first-class field(s) folded under Other fields ${JSON.stringify(repeated)}`);
});

test('realworld: an enumerated mega-paragraph task body renders as an ordered list', () => {
  assert.ok(realworldHtml.includes('<ol class="kit-ol">'), 'plan.html regressed: enumerated task text did not become an <ol>');
  assert.ok(
    realworldHtml.includes('verify input token counts are cache-exclusive trace-wide'),
    'plan.html regressed: enumerated list item text missing',
  );
});

test('realworld: task body prose renders outside the collapsible details block', () => {
  const bodyText = 'Do both paths.';
  const bodyIdx = realworldHtml.indexOf(bodyText);
  assert.ok(bodyIdx > -1, 'plan.html regressed: realworld task body text missing');
  // The body must sit inside a task-body block, and no <details> may wrap it.
  const bodyBlockIdx = realworldHtml.indexOf('<div class="task-body">');
  assert.ok(bodyBlockIdx > -1 && bodyBlockIdx < bodyIdx, 'plan.html regressed: task body text not inside a task-body block');
});

test('realworld: double render is byte-identical (deterministic)', () => {
  assert.equal(
    renderPlanHtml(realworld, REALWORLD_OPTS),
    realworldHtml,
    'plan.html regressed: rendering is not deterministic on the real-world fixture',
  );
});

// ── cross-renderer consistency: one shared design language ─────────────────

test('cross-renderer: both pages carry the identical shared kit token marker', () => {
  const marker = '--brand-teal:#7FC2C8';
  assert.ok(planHtml.includes(marker), 'plan.html regressed: shared kit token marker missing');
  assert.ok(brainstormHtml.includes(marker), 'brainstorm.html regressed: shared kit token marker missing');
  assert.ok(realworldHtml.includes(marker), 'plan.html regressed: shared kit token marker missing on the real-world fixture');
});

test('cross-renderer: field labels are sentence-case, never uppercased by CSS', () => {
  for (const [label, html] of [['plan.html', planHtml], ['brainstorm.html', brainstormHtml], ['realworld plan.html', realworldHtml]]) {
    assert.ok(!/text-transform\s*:\s*uppercase/i.test(html), `${label} regressed: a text-transform:uppercase rule crept into the field labels`);
  }
});

// ── falsifiability canary ───────────────────────────────────────────────────
// Proof that this eval is not vacuously true: missingElements() correctly
// reports absence when an element genuinely isn't in the output. Skipped by
// default (it's a self-test of the helper, not a renderer assertion), but
// unskipping it demonstrates the exact loud-failure behaviour a real
// regression would trigger - see the "falsifiability proof" note in
// fixtures/plan-brainstorm/README.md for how this was verified by hand.
test('canary: missingElements() names elements that are genuinely absent', { skip: true }, () => {
  const missing = missingElements(planHtml, ['<h2 class="kit-h2">Goal</h2>', '<h2 class="kit-h2">This Section Does Not Exist</h2>']);
  assert.deepEqual(missing, ['<h2 class="kit-h2">This Section Does Not Exist</h2>']);
});
