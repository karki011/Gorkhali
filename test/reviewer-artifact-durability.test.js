// Author: Subash Karki
// reviewer-artifact-durability.test.js — pins the artifact-first reviewer contract.
// Reviewer deliverables must be durable on disk, not carried in a final message that
// a truncated turn destroys. Asserts the contract is documented in every surface an
// agent actually reads: reference/wrap/rpsl.md (per-role path, addressed to the
// agents, race rationale, empty-result resume guard, Apex merge), the three reviewer
// agent definitions (artifact-first ordering), and reference/_base-agent.md (the
// deliverable-before-verification ordering rule).
//
// Assertions target STABLE identifiers — the `reviews/` path, role names, the
// `SendMessage` resume — not full sentences, so harmless rewording doesn't break them.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

const RPSL = 'reference/wrap/rpsl.md';
const BASE_AGENT = 'reference/_base-agent.md';

// Each reviewer surface: the file, and the role name its artifact path must carry.
const REVIEWER_AGENTS = [
  { file: 'agents/archer.md', role: 'archer' },
  { file: 'agents/gaze.md', role: 'gaze' },
  { file: 'agents/plan-checker.md', role: 'plan-checker' },
];

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

// Matches a reviews/<something>.json artifact path, with or without a
// {SESSION_DIR} prefix and with either literal or templated role segment.
const REVIEWS_PATH = /reviews\/[{A-Za-z*][\w{}*-]*\.json/;

// ── reference/wrap/rpsl.md: the panel contract ────────────────────────────────

test('rpsl.md names the per-role reviews/<role>.json artifact path', () => {
  const content = read(RPSL);
  assert.match(
    content,
    REVIEWS_PATH,
    `${RPSL} must name the per-role reviews/<role>.json artifact path`
  );
  assert.ok(
    /SESSION_DIR\}?\/reviews\//.test(content),
    `${RPSL} must anchor the reviews/ path under SESSION_DIR`
  );
});

test('rpsl.md addresses the AGENTS, instructing them to write the artifact', () => {
  const content = read(RPSL);
  // The instruction must be directed at the reviewers, not only at Apex.
  assert.ok(
    /addresses the four review agents|not Apex|your deliverable is a file/i.test(content),
    `${RPSL} must state that the output contract addresses the review agents, not only Apex`
  );
  assert.ok(
    /write `?\{?SESSION_DIR/i.test(content),
    `${RPSL} must give the agents an imperative "write {SESSION_DIR}/..." instruction`
  );
});

test('rpsl.md names all four per-role artifact files', () => {
  const content = read(RPSL);
  for (const role of ['scope', 'regression', 'architecture', 'skeptic']) {
    assert.ok(
      content.includes(`reviews/${role}.json`),
      `${RPSL} must name reviews/${role}.json explicitly (per-role files, never one shared file)`
    );
  }
});

test('rpsl.md gives the parallel-write race as the reason for per-role files', () => {
  const content = read(RPSL);
  // \b-anchored: an unanchored /race/ matches "traceable" in the Protocol section,
  // which would let this test pass with the whole contract deleted.
  assert.ok(
    /\brace\b/i.test(content),
    `${RPSL} must name the concurrent-write race as the reason for per-role files`
  );
  assert.ok(
    /(run in parallel|four agents run|in parallel)[^.]{0,120}\brace\b/i.test(content),
    `${RPSL} must tie the race to the four agents running in parallel, not just assert per-role files`
  );
});

test('rpsl.md states that Apex reads reviews/*.json and merges into review-panel.json', () => {
  const content = read(RPSL);
  assert.ok(
    /reviews\/\*\.json/.test(content),
    `${RPSL} must state that Apex reads reviews/*.json`
  );
  assert.ok(
    /merge[sd]?[^.]{0,80}review-panel\.json/i.test(content),
    `${RPSL} must state that Apex merges the per-role files into review-panel.json`
  );
});

test('rpsl.md documents the empty-result / missing-artifact SendMessage resume guard', () => {
  const content = read(RPSL);
  assert.ok(
    /SendMessage/.test(content),
    `${RPSL} must document the SendMessage resume for a missing or empty reviewer artifact`
  );
  assert.ok(
    /missing|empty/i.test(content) && /resume/i.test(content),
    `${RPSL} must tie the resume to a missing/empty artifact`
  );
});

test('rpsl.md keeps the guard as resume-then-proceed, not a terminal block', () => {
  const content = read(RPSL);
  assert.ok(
    /not a terminal block|resume-then-proceed/i.test(content),
    `${RPSL} guard must be resume-then-proceed; a hard block on a documentation contract could wedge a session`
  );
});

test('rpsl.md preserves the verdict JSON shape', () => {
  const content = read(RPSL);
  for (const field of ['"role"', '"verdict"', '"findings"', '"confidence"']) {
    assert.ok(content.includes(field), `${RPSL} must keep the ${field} field in the verdict JSON`);
  }
  assert.ok(
    content.includes('"pass|fail"'),
    `${RPSL} must keep the pass|fail verdict enum`
  );
});

test('rpsl.md preserves the four perspectives and the no-override panel rule', () => {
  const content = read(RPSL);
  for (const perspective of ['Scope Agent', 'Regression Agent', 'Architecture Agent', 'Skeptic Agent']) {
    assert.ok(content.includes(perspective), `${RPSL} must keep the ${perspective} perspective`);
  }
  assert.ok(
    /No override/i.test(content),
    `${RPSL} must keep the no-override panel rule`
  );
  assert.ok(
    /ALL PASS/.test(content),
    `${RPSL} must keep the ALL PASS panel decision rule`
  );
});

// ── reviewer agent definitions: artifact-first ordering ───────────────────────

for (const { file, role } of REVIEWER_AGENTS) {
  test(`${file} requires writing the verdict to a reviews/<role>.json artifact`, () => {
    const content = read(file);
    assert.ok(
      content.includes(`reviews/${role}.json`) || REVIEWS_PATH.test(content),
      `${file} must name its reviews/<role>.json artifact path (expected reviews/${role}.json)`
    );
    assert.ok(
      /SESSION_DIR\}?\/reviews\//.test(content),
      `${file} must anchor the reviews/ artifact under SESSION_DIR`
    );
  });

  test(`${file} orders the artifact before refining or long-running commands`, () => {
    const content = read(file);
    assert.ok(
      /before refin/i.test(content),
      `${file} must require the artifact BEFORE refining`
    );
    assert.ok(
      /long[- ]running/i.test(content),
      `${file} must require the artifact before any long-running command`
    );
    assert.ok(
      /after (investigating|checking)/i.test(content),
      `${file} must place the artifact AFTER investigation, so the ordering rule can't be read as "report before you check"`
    );
  });

  test(`${file} carries the no-gate-runs line as guidance, not prohibition`, () => {
    const content = read(file);
    assert.ok(
      /don't run the project's build\/test gates|do not run the project's build\/test gates/i.test(content),
      `${file} must carry the reviewers-don't-run-gates line`
    );
    assert.ok(
      /guidance, not prohibition/i.test(content),
      `${file} must phrase the no-gate-runs line as guidance, not prohibition (the evidence is correlational)`
    );
  });
}

test('the three reviewer agent definitions are the only agent files carrying the contract', () => {
  const agentsDir = path.join(REPO_ROOT, 'agents');
  const carriers = fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => /SESSION_DIR\}?\/reviews\//.test(fs.readFileSync(path.join(agentsDir, f), 'utf8')));
  assert.deepEqual(
    carriers.sort(),
    ['archer.md', 'gaze.md', 'plan-checker.md'],
    'only archer, gaze and plan-checker carry the reviews/ artifact contract; other agent definitions must be untouched'
  );
});

// ── reference/_base-agent.md: the inherited ordering rule ─────────────────────

test('_base-agent.md carries the deliverable-before-verification ordering rule', () => {
  const content = read(BASE_AGENT);
  const section = content.slice(content.indexOf('## On Task Completion'));
  assert.ok(section.length > 0, `${BASE_AGENT} must still have an "On Task Completion" section`);
  assert.ok(
    /before refin/i.test(section),
    `${BASE_AGENT} must order the deliverable BEFORE refinement`
  );
  assert.ok(
    /verification|verify|test suite/i.test(section),
    `${BASE_AGENT} must order the deliverable before long-running verification`
  );
});

test('_base-agent.md states that a turn ending early ends AFTER the deliverable', () => {
  const content = read(BASE_AGENT);
  assert.ok(
    /end[s]? early[^.]{0,60}after the deliverable/i.test(content),
    `${BASE_AGENT} must state that a turn which must end early ends AFTER the deliverable`
  );
});

test('_base-agent.md preserves the existing handoff-note guidance', () => {
  const content = read(BASE_AGENT);
  assert.ok(
    content.includes(
      'what was done, key decisions, files changed, what the next agent needs to know, and any remaining concerns'
    ),
    `${BASE_AGENT} must preserve the handoff-note content; this change is about ordering, not replacement`
  );
});

test('_base-agent.md leaves the unrelated sections intact', () => {
  const content = read(BASE_AGENT);
  const count = (needle) => content.split(needle).length - 1;
  assert.equal(count('## Sage Escalation'), 1, 'Sage Escalation section must be untouched');
  assert.equal(count('## Model Behavior Notes'), 1, 'Model Behavior Notes section must be untouched');
});
