// Author: Subash Karki
// wrap-defense-brief.test.js - pins the always-on Defense Brief that replaced
// the wrap-time auto-grill: commands/wrap.md Step 2, the Step 6 wrap.json
// spec line, commands/grill.md's manual-only Integration section, and the
// new reference/wrap/defense-brief.md authoring protocol.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

const SECTION_HEADINGS = [
  'What we did',
  'Why we did it',
  'Watch out for',
  'What you need to know',
  'Likely questions and answers',
  'Decision log',
];

// -- commands/wrap.md - Step 2 Defense Brief -------------------------------

test('wrap.md contains the Defense Brief step', () => {
  const content = read('commands/wrap.md');
  assert.ok(
    content.includes('## Step 2: Defense Brief (auto, always)'),
    'wrap.md must contain the Step 2 Defense Brief heading'
  );
});

test('wrap.md Step 2 states it runs regardless of file count', () => {
  const content = read('commands/wrap.md');
  assert.ok(
    /regardless of file count/i.test(content),
    'wrap.md must state the Defense Brief runs on every wrap regardless of file count'
  );
});

for (const heading of SECTION_HEADINGS) {
  test(`wrap.md Step 2 lists the "${heading}" section heading`, () => {
    const content = read('commands/wrap.md');
    assert.ok(
      content.includes(`## ${heading}`),
      `wrap.md Step 2 must list the exact heading "## ${heading}"`
    );
  });
}

test('wrap.md contains the clerk preflight grep for all six section headings', () => {
  const content = read('commands/wrap.md');
  for (const heading of SECTION_HEADINGS) {
    assert.ok(
      content.includes(`"${heading}"`),
      `wrap.md preflight grep must reference "${heading}"`
    );
  }
  assert.ok(
    content.includes('grep -qF "## $h"'),
    'wrap.md must give clerk the exact grep -qF "## $h" preflight command'
  );
  assert.ok(
    content.includes('defense-brief.md'),
    'wrap.md preflight must target defense-brief.md'
  );
});

test('wrap.md Step 2 references reference/wrap/defense-brief.md', () => {
  const content = read('commands/wrap.md');
  assert.ok(
    content.includes('reference/wrap/defense-brief.md'),
    'wrap.md Step 2 must link the defense-brief authoring protocol'
  );
});

test('wrap.md Step 2 is Chief judgment work, never clerk', () => {
  const content = read('commands/wrap.md');
  assert.ok(
    /never clerk/i.test(content),
    'wrap.md must state defense brief authoring is never clerk'
  );
});

test('wrap.md no longer auto-invokes grill at Step 2', () => {
  const content = read('commands/wrap.md');
  assert.ok(
    !/Grill Gate \(auto-triggered/i.test(content),
    'wrap.md must not retain the old auto-triggered Grill Gate step'
  );
});

test('wrap.md mentions gorkhali:grill only in the --grill flag context', () => {
  const content = read('commands/wrap.md');
  const lines = content.split('\n').filter((line) => line.includes('gorkhali:grill'));
  assert.ok(lines.length > 0, 'wrap.md must still mention gorkhali:grill for the --grill flag');
  for (const line of lines) {
    assert.ok(
      line.includes('--grill'),
      `every gorkhali:grill mention in wrap.md must be in --grill flag context, got: ${line}`
    );
  }
});

// -- commands/wrap.md - Step 6 wrap.json spec ------------------------------

test('wrap.md Step 6 wrap.json spec includes defenseBrief', () => {
  const content = read('commands/wrap.md');
  assert.ok(
    content.includes('`defenseBrief`'),
    'wrap.md Step 6 wrap.json field list must include `defenseBrief`'
  );
});

test('wrap.md Step 6 defenseBrief spec documents path, questions, and sections', () => {
  const content = read('commands/wrap.md');
  const idx = content.indexOf('`defenseBrief`');
  assert.notEqual(idx, -1, 'defenseBrief field must exist before checking its shape');
  const nearby = content.slice(idx, idx + 400);
  assert.ok(nearby.includes('path'), 'defenseBrief spec must document a path field');
  assert.ok(nearby.includes('questions'), 'defenseBrief spec must document a questions field');
  assert.ok(nearby.includes('sections'), 'defenseBrief spec must document a sections field');
});

// ── reference/wrap/defense-brief.md ────────────────────────────────────────

test('reference/wrap/defense-brief.md exists', () => {
  assert.ok(
    exists('reference/wrap/defense-brief.md'),
    'reference/wrap/defense-brief.md must exist'
  );
});

for (const heading of SECTION_HEADINGS) {
  test(`reference/wrap/defense-brief.md documents the "${heading}" section`, () => {
    const content = read('reference/wrap/defense-brief.md');
    assert.ok(
      content.includes(`## ${heading}`),
      `defense-brief.md must document the exact heading "## ${heading}"`
    );
  });
}

test('reference/wrap/defense-brief.md states the file:line/artifact citation bar', () => {
  const content = read('reference/wrap/defense-brief.md');
  assert.ok(
    /file:line/i.test(content),
    'defense-brief.md must require file:line citations'
  );
  assert.ok(
    /artifact/i.test(content),
    'defense-brief.md must allow session-artifact citations'
  );
});

// -- commands/grill.md - manual-only Integration ---------------------------

test('grill.md Integration section reflects manual-only invocation', () => {
  const content = read('commands/grill.md');
  const idx = content.indexOf('## Integration');
  assert.notEqual(idx, -1, 'grill.md must have an Integration section');
  const section = content.slice(idx);
  assert.ok(
    /manual only/i.test(section),
    'grill.md Integration must state grill is manual only'
  );
  assert.ok(
    !/auto-called/i.test(section),
    'grill.md Integration must not claim wrap auto-calls grill'
  );
  assert.ok(
    section.includes('--grill'),
    'grill.md Integration must reference the --grill flag path'
  );
});
