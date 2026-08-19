// Author: Subash Karki
// wrap-pr-body.test.js - pins the concise three-section PR body: the contract in
// reference/wrap/pr-body.md, its cannot-degrade Verification rule, the
// stated-gap convention, the derived Review-focus ranking, the single-copy
// discipline (wrap.md and ship-ceremony.md point at the spec, never restate it),
// the ready-for-review `gh pr create` (no --draft), and clerk's
// substitute-only boundary.
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

// The three headings, in the order the contract fixes them.
const SECTIONS = ['What & why', 'Verification', 'Review focus'];

// ── reference/wrap/pr-body.md - the contract itself ──────────────────────────

test('pr-body.md fixes the three headings in order', () => {
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
  assert.ok(
    !/## (Goal|Approach|Risk|Verification evidence|What to look at first)`/.test(content),
    'the retired five-section headings must be gone from the contract'
  );
});

const SECTION_SOURCES = [
  ['What & why', ['intent.json', 'doneWhen[]', 'decision.recommendation']],
  ['Verification', ['checks[]', 'userVerification', 'specialists[]', 'verdict']],
  ['Review focus', ['path:line', 'execution.json', 'numstat']],
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

test('pr-body.md caps the body at 40 lines and 2500 characters', () => {
  const content = read('reference/wrap/pr-body.md');
  assert.ok(/40 lines and 2500 characters/i.test(content), 'the hard caps must be stated');
});

test('pr-body.md gives a stated-gap line for every degradable section', () => {
  const content = read('reference/wrap/pr-body.md');
  for (const heading of ['What & why', 'Review focus']) {
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

test('pr-body.md states Verification does not degrade to a gap', () => {
  const content = read('reference/wrap/pr-body.md');
  assert.ok(
    /This section does not degrade/i.test(content),
    'pr-body.md must state the Verification section has no gap form'
  );
  assert.ok(
    /blocked ship gate/i.test(content),
    'pr-body.md must say missing required evidence is a blocked ship gate'
  );
  assert.ok(
    /[Nn]ever omit required validation and never invent/.test(content),
    'pr-body.md must forbid both omitting and inventing required evidence'
  );
  const row = content.slice(content.indexOf('| 2 | `## Verification`'));
  assert.ok(
    !row.slice(0, row.indexOf('\n')).includes('_Not recorded:'),
    'the Verification row must NOT carry a stated-gap line'
  );
});

test('pr-body.md ranks "Review focus" by a derived rule, not judgment', () => {
  const content = read('reference/wrap/pr-body.md');
  const idx = content.indexOf('### 3. `## Review focus`');
  assert.notEqual(idx, -1, 'pr-body.md must document section 3');
  const section = content.slice(idx, idx + 1200);
  assert.ok(
    /derived, not judged/i.test(section),
    'the ranking must be stated as derived rather than judged'
  );
  for (const signal of ['unfixed', 'severity', 'risk', 'numstat']) {
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
  assert.deepEqual(found, [], `unexpected PR template in this repo: ${found.join(', ')}`);
  assert.ok(
    !fs.existsSync(path.join(REPO_ROOT, '.github/PULL_REQUEST_TEMPLATE')),
    'unexpected .github/PULL_REQUEST_TEMPLATE directory'
  );
  assert.ok(
    /This repository has no PR template/i.test(read('reference/wrap/pr-body.md')),
    'pr-body.md must record that this repo has no PR template'
  );
});

test('the example skeleton stays inside the 40-line cap', () => {
  const content = read('reference/wrap/pr-body.md');
  const block = (content.match(/```markdown\n([\s\S]*?)```/) || [])[1];
  assert.ok(block, 'pr-body.md must carry an example skeleton in a ```markdown block');
  assert.ok(
    block.trimEnd().split('\n').length <= 40,
    'the example skeleton must not exceed the 40-line body cap'
  );
  assert.ok(
    block.length <= 2500,
    'the example skeleton must not exceed the 2500-character body cap'
  );
});

// ── ownership: Chief renders, clerk substitutes ──────────────────────────────

test('pr-body.md keeps rendering with Chief and substitution with clerk', () => {
  const content = read('reference/wrap/pr-body.md');
  assert.ok(
    /Clerk never authors/i.test(content),
    'pr-body.md must state clerk never authors a section'
  );
  assert.ok(content.includes('--body-file'), 'pr-body.md must confine clerk to --body-file');
});

test('clerk.md takes the body as a file and forbids authoring it', () => {
  const content = read('agents/clerk.md');
  assert.ok(
    content.includes('--body-file'),
    'clerk.md PR ops must take the body as --body-file'
  );
  assert.ok(
    /three-heading preflight/i.test(content),
    'clerk.md must run the three-heading preflight'
  );
  const notOwned = content.slice(content.indexOf('## What you do NOT own'));
  assert.ok(
    /never write, fill, summarize, re-order, or repair/i.test(notOwned),
    'clerk.md must spell out that it never fills or repairs a section'
  );
});

// ── single-copy discipline ───────────────────────────────────────────────────

for (const file of ['commands/wrap.md', 'reference/wrap/ship-ceremony.md']) {
  test(`${file} points at pr-body.md instead of restating the spec`, () => {
    const content = read(file);
    assert.ok(
      content.includes('reference/wrap/pr-body.md'),
      `${file} must point at the single copy of the contract`
    );
    for (const token of ['intent.json', 'solution_shape', '_Not recorded:']) {
      assert.ok(
        !content.includes(token),
        `${file} must not restate the section spec (found "${token}")`
      );
    }
  });
}

test('wrap.md Step 3 renders pr-body.md and names the three headings', () => {
  const content = read('commands/wrap.md');
  assert.ok(
    /never clerk work/i.test(content),
    'wrap.md must state PR body rendering is never clerk work'
  );
  for (const heading of SECTIONS) {
    assert.ok(
      content.includes(`## ${heading}`),
      `wrap.md must name the exact heading "## ${heading}"`
    );
  }
});

test('wrap.md offers a Surveyor screenshot as optional, never-blocking evidence', () => {
  const content = read('commands/wrap.md');
  const idx = content.indexOf('Surveyor screenshot');
  assert.notEqual(idx, -1, 'wrap.md must mention the optional Surveyor screenshot');
  const nearby = content.slice(idx - 200, idx + 300);
  assert.ok(/MAY/.test(nearby), 'the Surveyor screenshot must be optional');
  assert.ok(/never blocks/i.test(nearby), 'the Surveyor screenshot must never block the wrap');
});

test('wrap.md records prBody in the wrap.json outcome', () => {
  const content = read('commands/wrap.md');
  const idx = content.indexOf('`prBody`');
  assert.notEqual(idx, -1, 'wrap.md must include `prBody` in the recorded outcome');
  const nearby = content.slice(idx, idx + 400);
  for (const field of ['path', 'sections', 'gaps']) {
    assert.ok(nearby.includes(field), `prBody spec must document a ${field} field`);
  }
  assert.ok(/`sections` is 3/.test(nearby), 'prBody must record 3 sections');
});

// ── the PR is born ready for review ──────────────────────────────────────────

test('ship-ceremony creates a ready-for-review PR with the body as a file', () => {
  const content = read('reference/wrap/ship-ceremony.md');
  const line = content.split('\n').find((l) => l.includes('gh pr create'));
  assert.ok(line, 'ship-ceremony must carry the gh pr create command');
  assert.ok(!line.includes('--draft'), 'the PR must be created ready for review, not as a draft');
  assert.ok(
    content.includes('--body-file "{SESSION_DIR}/pr-body.md"'),
    'ship-ceremony must call gh pr create with --body-file'
  );
  assert.ok(
    !/--draft/.test(content),
    'no --draft may survive anywhere in the ship ceremony, fallbacks included'
  );
  assert.ok(
    /## 4\. PR Creation \(ready for review\)/.test(content),
    'section 4 must be titled for ready-for-review PR creation'
  );
});

// ── no live instruction file still promises a draft PR ───────────────────────
//
// This is a directory scanner, not a file enumeration: an enumerated list only
// ever catches the files someone remembered to add to it (that is how
// reference/greploop.md and skills/phantom/SKILL.md leaked stale "draft PR"
// language past this guard before). Walking every instruction root makes a new
// or unlisted file just as visible as the ones already known about.

const SCAN_ROOTS = [
  'commands', 'reference', 'skills', 'agents', 'project-docs',
  'templates', 'hooks', 'scripts',
];
const SCAN_EXTENSIONS = new Set(['.md', '.js', '.mjs', '.sh']);

// PR-bound phrasings only — never the bare word "draft", which has legitimate
// uses unrelated to PR shipping (e.g. "draft contract", "Draft one comment",
// "drafts all approaches").
const DRAFT_PR_PATTERNS = [
  /--draft/,
  /\bdraft[- ]PR\b/i,
  /\bdrafts?\s+the\s+PR\b/i,
  /marks?\b[^.\n]*\bready[- ]to[- ]review/i,
  /always draft|created as drafts?/i,
];

function walkScanRoot(root, out) {
  const dir = path.join(REPO_ROOT, root);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walkScanRoot(path.join(root, entry.name), out);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(path.join(root, entry.name));
    }
  }
}

test('no live instruction file still promises a draft PR', () => {
  const files = [];
  for (const root of SCAN_ROOTS) walkScanRoot(root, files);
  assert.ok(files.length > 20, 'the scan must actually walk a non-trivial number of files');

  const offenses = [];
  for (const rel of files) {
    const content = read(rel);
    const lines = content.split('\n');
    lines.forEach((rawLine, i) => {
      // `ship-draft-pr` is the legacy name of the ship-pr authorization scope, not a
      // claim about what kind of PR wrap creates; strip it before matching so it never
      // trips the "draft PR" patterns. Nothing else is exempt: an exemption broader
      // than the phrase it names would silently swallow a future leak.
      const line = rawLine.replace(/ship-draft-pr/g, '');
      for (const re of DRAFT_PR_PATTERNS) {
        if (re.test(line)) {
          offenses.push(`${rel}:${i + 1}: ${rawLine.trim()}`);
          break;
        }
      }
    });
  }

  assert.deepEqual(offenses, [], `draft-PR language found:\n${offenses.join('\n')}`);
});

test('known-good draft mentions survive the scanner', () => {
  // These use the word "draft" but are not PR-shipping instructions, so the
  // scanner above must not flag them.
  assert.match(read('reference/greploop.md'), /\(drafts included\)/);
  assert.match(read('reference/wrap/ship-ceremony.md'), /drafting bought no review control/);
});

// ── the preflight actually gates ─────────────────────────────────────────────

// Lift the preflight verbatim out of the doc so the test exercises the exact
// snippet clerk is told to run.
function preflightScript() {
  const content = read('reference/wrap/ship-ceremony.md');
  const blocks = content.match(/```bash\n([\s\S]*?)```/g) || [];
  const block = blocks.find((b) => b.includes("awk '/^## /"));
  assert.ok(block, 'ship-ceremony.md must carry the preflight bash block');
  return block.replace(/^```bash\n/, '').replace(/```$/, '');
}

const POPULATED_BODY = [
  '## What & why',
  'ENG-1234: totals doubled on date-range change. Fixed the shared reducer.',
  '',
  '## Verification',
  '- focused tests — passed',
  '- auditor — pass — 0 findings',
  '',
  '## Review focus',
  '- `src/hooks/useUsageRange.ts:47` — plan risk lands here',
  '',
].join('\n');

function runPreflight(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-pr-body-'));
  const file = path.join(dir, 'pr-body.md');
  fs.writeFileSync(file, body);
  const script = preflightScript().replace(/BODY="[^"]*"/, `BODY=${JSON.stringify(file)}`);
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return result.status;
}

test('preflight ACCEPTS a body with all three sections populated', () => {
  assert.equal(runPreflight(POPULATED_BODY), 0, 'a populated body must pass the ship preflight');
});

test('preflight ACCEPTS stated gaps as populated sections', () => {
  const gapped = POPULATED_BODY.replace(
    'ENG-1234: totals doubled on date-range change. Fixed the shared reducer.',
    '_Not recorded: intent.json — no goal contract was captured for this session._'
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
    let end = idx + 1;
    while (end < lines.length && !lines[end].startsWith('## ')) end += 1;
    lines.splice(idx, end - idx);
    assert.equal(runPreflight(lines.join('\n')), 1, `dropping "## ${heading}" must block PR creation`);
  });
}

test('preflight REJECTS an empty section in the middle of the body', () => {
  const empty = POPULATED_BODY.replace(
    '## Verification\n- focused tests — passed\n- auditor — pass — 0 findings\n',
    '## Verification\n'
  );
  assert.equal(
    runPreflight(empty),
    1,
    'an empty "## Verification" section must block PR creation rather than ship blank'
  );
});

test('preflight REJECTS an empty trailing section', () => {
  const empty = POPULATED_BODY.replace(
    '- `src/hooks/useUsageRange.ts:47` — plan risk lands here\n',
    ''
  );
  assert.equal(runPreflight(empty), 1, 'an empty final section must block PR creation');
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
