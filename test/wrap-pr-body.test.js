// Author: Subash Karki
// wrap-pr-body.test.js - pins B13's structured PR body: the fixed five-section
// template in reference/wrap/pr-body.md, its stated-gap degradation rule, the
// commands/wrap.md Step 2 render step, the ship-ceremony --body-file handoff,
// and warden's no-authoring boundary.
//
// The gate tests EXECUTE the preflight snippet lifted verbatim out of
// reference/wrap/ship-ceremony.md against real bodies on disk, so a template
// drift or a broken snippet shows up as a body that ships when it should have
// been rejected - not merely as prose that no longer matches.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

// The five headings, in the order the template fixes them.
const SECTIONS = [
  'Goal',
  'Approach',
  'Risk',
  'Verification evidence',
  'What to look at first',
];

// ── reference/wrap/pr-body.md - the template itself ───────────────────────────

test('reference/wrap/pr-body.md exists', () => {
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, 'reference/wrap/pr-body.md')),
    'reference/wrap/pr-body.md must exist'
  );
});

test('pr-body.md fixes the five headings in order', () => {
  const content = read('reference/wrap/pr-body.md');
  const positions = SECTIONS.map((heading) => {
    const idx = content.indexOf(`\`## ${heading}\``);
    assert.notEqual(idx, -1, `pr-body.md must name the exact heading "## ${heading}"`);
    return idx;
  });
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(
      positions[i] > positions[i - 1],
      `"## ${SECTIONS[i]}" must be documented after "## ${SECTIONS[i - 1]}"`
    );
  }
});

const SECTION_SOURCES = [
  ['Goal', ['intent.json', 'goal', 'doneWhen']],
  ['Approach', ['plan.json', 'decision.recommendation', 'execution.json', 'filesChanged']],
  ['Risk', ['risks[]', 'tradeoffs[]']],
  ['Verification evidence', ['checks[]', 'userVerification', 'specialists[]', 'verdict']],
  ['What to look at first', ['path:line', 'execution.json']],
];

for (const [heading, sources] of SECTION_SOURCES) {
  test(`pr-body.md sources "## ${heading}" from named session artifacts`, () => {
    const content = read('reference/wrap/pr-body.md');
    for (const source of sources) {
      assert.ok(
        content.includes(source),
        `the "${heading}" section must name \`${source}\` as a value source`
      );
    }
  });
}

test('pr-body.md gives a stated-gap line for every degradable section', () => {
  const content = read('reference/wrap/pr-body.md');
  for (const heading of ['Goal', 'Approach', 'Risk', 'What to look at first']) {
    const idx = content.indexOf(`\`## ${heading}\``);
    const row = content.slice(idx, content.indexOf('\n', idx));
    assert.ok(
      row.includes('_Not recorded:'),
      `the "${heading}" row must carry a "_Not recorded:" stated-gap line`
    );
  }
});

test('pr-body.md forbids invented text in place of a missing artifact', () => {
  const content = read('reference/wrap/pr-body.md');
  assert.ok(
    /gap line is the only permitted substitute/i.test(content),
    'pr-body.md must state the gap line is the only permitted substitute'
  );
  assert.ok(
    /`N\/A`.*guess|guess.*`N\/A`/is.test(content),
    'pr-body.md must reject N/A and guesses as fallbacks'
  );
});

test('pr-body.md states Verification evidence does not degrade to a gap', () => {
  const content = read('reference/wrap/pr-body.md');
  assert.ok(
    /Section 4 does not degrade/i.test(content),
    'pr-body.md must state the verification-evidence section has no gap form'
  );
  assert.ok(
    /blocked ship gate/i.test(content),
    'pr-body.md must say missing required evidence is a blocked ship gate'
  );
});

test('pr-body.md ranks "what to look at first" by a derived rule, not judgment', () => {
  const content = read('reference/wrap/pr-body.md');
  const idx = content.indexOf('### 5. `## What to look at first`');
  assert.notEqual(idx, -1, 'pr-body.md must document section 5');
  const section = content.slice(idx, idx + 1200);
  assert.ok(
    /derived, not judged/i.test(section),
    'the ranking must be stated as derived rather than judged'
  );
  for (const signal of ['unfixed', 'risk', 'nonNegotiables', 'numstat']) {
    assert.ok(
      new RegExp(signal, 'i').test(section),
      `the ranking rule must name the "${signal}" signal`
    );
  }
});

test('pr-body.md handles a repo PR template by mirroring its headings', () => {
  const content = read('reference/wrap/pr-body.md');
  assert.ok(
    content.includes('.github/pull_request_template.md'),
    'pr-body.md must give the .github template detection path'
  );
  assert.ok(
    /No template found/i.test(content) && /Template found/i.test(content),
    'pr-body.md must cover both the template-present and template-absent cases'
  );
  assert.ok(
    /appended under its canonical heading rather than dropped/i.test(content),
    'pr-body.md must keep evidence that has no matching repo heading'
  );
});

test('this repo has no .github PR template, so the canonical headings apply', () => {
  const candidates = [
    '.github/pull_request_template.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'docs/pull_request_template.md',
    'pull_request_template.md',
  ];
  const found = candidates.filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)));
  const dir = path.join(REPO_ROOT, '.github/PULL_REQUEST_TEMPLATE');
  assert.deepEqual(found, [], `unexpected PR template in this repo: ${found.join(', ')}`);
  assert.ok(!fs.existsSync(dir), 'unexpected .github/PULL_REQUEST_TEMPLATE directory');
  assert.ok(
    /This repository has no PR template/i.test(read('reference/wrap/pr-body.md')),
    'pr-body.md must record that this repo has no PR template'
  );
});

// ── ownership: Apex renders, warden substitutes ───────────────────────────────

test('pr-body.md keeps rendering with Apex and substitution with warden', () => {
  const content = read('reference/wrap/pr-body.md');
  assert.ok(
    /Warden never authors/i.test(content),
    'pr-body.md must state warden never authors a section'
  );
  assert.ok(
    content.includes('--body-file'),
    'pr-body.md must confine warden to --body-file'
  );
});

test('warden.md takes the body as a file and forbids authoring it', () => {
  const content = read('agents/warden.md');
  assert.ok(
    content.includes('--body-file'),
    'warden.md PR ops must take the body as --body-file'
  );
  assert.ok(
    /PR body authoring/i.test(content),
    'warden.md "What you do NOT own" must list PR body authoring'
  );
  const notOwned = content.slice(content.indexOf('## What you do NOT own'));
  assert.ok(
    /never write, fill, summarize, re-order, or repair/i.test(notOwned),
    'warden.md must spell out that it never fills or repairs a section'
  );
});

test('wrap.md Step 2 renders pr-body.md and lists all five sections', () => {
  const content = read('commands/wrap.md');
  assert.ok(
    content.includes('reference/wrap/pr-body.md'),
    'wrap.md must link the pr-body authoring protocol'
  );
  assert.ok(
    /never warden work/i.test(content),
    'wrap.md must state PR body rendering is never warden work'
  );
  for (const heading of SECTIONS) {
    assert.ok(
      content.includes(`## ${heading}`),
      `wrap.md Step 2 must list the exact heading "## ${heading}"`
    );
  }
});

test('wrap.md records prBody in the wrap.json outcome', () => {
  const content = read('commands/wrap.md');
  const idx = content.indexOf('`prBody`');
  assert.notEqual(idx, -1, 'wrap.md Step 9 must include `prBody`');
  const nearby = content.slice(idx, idx + 400);
  for (const field of ['path', 'sections', 'gaps']) {
    assert.ok(nearby.includes(field), `prBody spec must document a ${field} field`);
  }
});

test('ship-ceremony hands the body to gh as a file, not as prose', () => {
  const content = read('reference/wrap/ship-ceremony.md');
  assert.ok(
    content.includes('--body-file "{SESSION_DIR}/pr-body.md"'),
    'ship-ceremony must call gh pr create with --body-file'
  );
  assert.ok(
    !/^## Test plan$/m.test(content),
    'ship-ceremony must no longer carry the old free-prose "Test plan" section'
  );
  for (const heading of SECTIONS) {
    assert.ok(
      content.includes(`## ${heading}`),
      `ship-ceremony body template must contain "## ${heading}"`
    );
  }
});

// ── the preflight actually gates ──────────────────────────────────────────────

// Lift the preflight verbatim out of the doc so the test exercises the exact
// snippet warden is told to run.
function preflightScript() {
  const content = read('reference/wrap/ship-ceremony.md');
  const blocks = content.match(/```bash\n([\s\S]*?)```/g) || [];
  const block = blocks.find((b) => b.includes("awk '/^## /"));
  assert.ok(block, 'ship-ceremony.md must carry the preflight bash block');
  return block.replace(/^```bash\n/, '').replace(/```$/, '');
}

const POPULATED_BODY = [
  '## Goal',
  'ENG-1234: totals doubled on date-range change.',
  '',
  '## Approach',
  'Fix the shared reducer, not the consumer.',
  '',
  '## Risk',
  'Return-shape change — all callers bumped — revert is one commit.',
  '',
  '## Verification evidence',
  'focused tests — passed',
  'gaze — pass — 0 findings',
  '',
  '## What to look at first',
  '- `src/hooks/useUsageRange.ts:47` — plan risk lands here',
  '',
].join('\n');

function runPreflight(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-pr-body-'));
  const file = path.join(dir, 'pr-body.md');
  fs.writeFileSync(file, body);
  const script = preflightScript().replace(
    /BODY="[^"]*"/,
    `BODY=${JSON.stringify(file)}`
  );
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return result.status;
}

test('preflight ACCEPTS a body with all five sections populated', () => {
  assert.equal(
    runPreflight(POPULATED_BODY),
    0,
    'a fully populated five-section body must pass the ship preflight'
  );
});

test('preflight ACCEPTS stated gaps as populated sections', () => {
  const gapped = POPULATED_BODY.replace(
    'Fix the shared reducer, not the consumer.',
    '_Not recorded: plan.json — this session shipped without a recorded plan._'
  );
  assert.equal(
    runPreflight(gapped),
    0,
    'a stated gap is real content and must not be treated as an empty section'
  );
});

for (const heading of SECTIONS) {
  test(`preflight REJECTS a body missing "## ${heading}"`, () => {
    const lines = POPULATED_BODY.split('\n');
    const idx = lines.indexOf(`## ${heading}`);
    assert.notEqual(idx, -1, 'fixture must contain the heading being dropped');
    // Drop the heading and its body, up to the next heading.
    let end = idx + 1;
    while (end < lines.length && !lines[end].startsWith('## ')) end += 1;
    lines.splice(idx, end - idx);
    assert.equal(
      runPreflight(lines.join('\n')),
      1,
      `dropping "## ${heading}" must block PR creation`
    );
  });
}

test('preflight REJECTS an empty section in the middle of the body', () => {
  const empty = POPULATED_BODY.replace(
    '## Risk\nReturn-shape change — all callers bumped — revert is one commit.\n',
    '## Risk\n'
  );
  assert.equal(
    runPreflight(empty),
    1,
    'an empty "## Risk" section must block PR creation rather than ship blank'
  );
});

test('preflight REJECTS an empty trailing section', () => {
  const empty = POPULATED_BODY.replace(
    '- `src/hooks/useUsageRange.ts:47` — plan risk lands here\n',
    ''
  );
  assert.equal(
    runPreflight(empty),
    1,
    'an empty final section must block PR creation'
  );
});

test('wrap.md carries the same preflight as ship-ceremony', () => {
  const wrap = read('commands/wrap.md');
  assert.ok(
    wrap.includes("awk '/^## /{if (h) exit 1; h=1; next} NF {h=0} END {exit h}'"),
    'wrap.md must carry the identical empty-section awk check'
  );
  for (const heading of SECTIONS) {
    assert.ok(
      wrap.includes(`"${heading}"`),
      `wrap.md preflight loop must reference "${heading}"`
    );
  }
});
