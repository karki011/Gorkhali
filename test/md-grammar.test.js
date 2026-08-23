// Author: Subash Karki
// md-grammar.test.js — round-trip + targeted-edit tests for the markdown grammar.
// Zero external deps: node:test + node:assert. Fixtures are shaped like this repo's
// real learnings files (PATTERN/CORRECTION prose, `- file.md — hook` INDEX lines,
// `auto:` capture lines) so the byte-exact invariant is proven on our own corpus.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const md = require('../scripts/lib/md-grammar');
const { parse, render, findSection, removeSection, setSection, items, setItem, newItem } = md;
const CLI = require.resolve('../scripts/lib/md-grammar');

// A learnings-shaped corpus with deliberate byte quirks that must survive verbatim:
// a trailing-space line, a tab-indented continuation, a double-space in prose, and a
// blank line inside a section. If any of these reflow, the round-trip test fails.
const FIXTURE = [
  '# Research Gorkhali — Learnings INDEX',
  '',
  'Curated pointers. One line per learning.',
  '',
  '## Patterns',
  '- fix-worktree-symlink.md — node_modules symlink to main checkout',
  '- ag-grid-numeric-sort.md — stringComparator  overrides numericColumn   ',
  '  continues with a tab-indented note here',
  '',
  '## Corrections',
  '- CORRECTION [chakra]: used v2 recipe — v3 slot recipe [failed] (2026-06-01)',
  '- PATTERN [dates]: format via luxon UTC [validated:5] (2026-06-02)',
  '',
  '## Auto-Captured',
  '',
  'auto: gate empty-state on isSuccess not isLoading [proposed] v:0 q:0.4 u:2026-07-01',
  'auto: SettingsTable forwards GridOptions [validated:2] v:3 q:0.8 u:2026-07-02',
  '',
].join('\n');

function toCrlf(src) {
  return src.replace(/\r?\n/g, '\r\n');
}

// ── byte-exact round-trip ─────────────────────────────────────────────────────

test('render(parse(src)) === src on the learnings corpus fixture', () => {
  assert.equal(render(parse(FIXTURE)), FIXTURE);
});

test('round-trips a CRLF file byte-for-byte while still finding sections', () => {
  const src = toCrlf(FIXTURE);
  const doc = parse(src);
  assert.equal(render(doc), src);
  assert.ok(findSection(doc, 'Auto-Captured'), 'section still recognized under CRLF');
  assert.equal(items(doc).length, items(parse(FIXTURE)).length, 'same item count as LF');
});

test('round-trips an empty file', () => {
  assert.equal(render(parse('')), '');
});

test('round-trips a file with no trailing newline', () => {
  const src = '# Notes\n\n## Patterns\n- a.md — does a thing';
  assert.equal(render(parse(src)), src);
});

test('round-trips a file that is only a heading', () => {
  const src = '# Backlog\n';
  assert.equal(render(parse(src)), src);
});

test('round-trips preamble-only content (no sections)', () => {
  const src = '# Just a title\n\nsome prose\nand more\n';
  const doc = parse(src);
  assert.equal(doc.sections.length, 0);
  assert.equal(render(doc), src);
});

// ── targeted edit: one entry changes, every other byte is intact ──────────────

test('modify one entry re-renders only it; all other bytes stay byte-identical', () => {
  const doc = parse(FIXTURE);
  const target = items(doc).find((e) => e.key.startsWith('- PATTERN [dates]'));
  assert.ok(target, 'found the entry to modify');
  setItem(target, ['- PATTERN [dates]: format via luxon UTC [validated:6] (2026-06-02)']);

  const expected = FIXTURE.replace('[validated:5]', '[validated:6]');
  assert.equal(render(doc), expected);
});

test('append one entry preserves everything above it verbatim', () => {
  const doc = parse(FIXTURE);
  const patterns = findSection(doc, 'Patterns');
  patterns.entries.push(newItem('- new-learning.md — fresh', ['- new-learning.md — fresh insight']));

  const out = render(doc);
  // Everything up to and including the last original Patterns line is untouched.
  const anchor = '- ag-grid-numeric-sort.md — stringComparator  overrides numericColumn   \n  continues with a tab-indented note here';
  assert.ok(out.includes(anchor), 'original Patterns lines kept verbatim');
  assert.ok(out.includes('- new-learning.md — fresh insight'), 'appended line present');
  // The Corrections section below is unchanged.
  assert.ok(out.includes('## Corrections\n- CORRECTION [chakra]:'), 'sections below untouched');
});

// ── section helpers: regenerate one section, protect the rest ──────────────────

test('setSection replaces a managed section body and keeps preamble + siblings byte-exact', () => {
  const doc = parse(FIXTURE);
  setSection(doc, 'Auto-Captured', [
    '',
    'auto: brand new capture [proposed] v:0 q:0.5 u:2026-07-03',
    '',
  ]);
  const out = render(doc);

  // The regenerated section holds only the new body.
  assert.ok(out.includes('auto: brand new capture [proposed] v:0 q:0.5 u:2026-07-03'));
  assert.ok(!out.includes('gate empty-state on isSuccess'), 'old auto lines replaced');
  // Everything above the auto section is byte-identical to the original.
  const preambleThroughCorrections = FIXTURE.slice(0, FIXTURE.indexOf('## Auto-Captured'));
  assert.ok(out.startsWith(preambleThroughCorrections), 'preamble + sibling sections untouched');
});

test('setSection appends a new section with a blank separator when absent', () => {
  const doc = parse('# Title\n\n## Patterns\n- a.md — x\n');
  setSection(doc, 'Auto-Captured', ['', 'auto: first [proposed] v:0 q:0.1 u:2026-07-03', '']);
  const out = render(doc);
  assert.ok(out.includes('## Patterns\n- a.md — x'), 'existing content intact');
  assert.match(out, /- a\.md — x\n\n## Auto-Captured/, 'blank line separates the appended section');
});

test('removeSection drops one section and leaves the others byte-exact', () => {
  const doc = parse(FIXTURE);
  const removed = removeSection(doc, 'Auto-Captured');
  assert.ok(removed, 'section found and removed');
  const out = render(doc);
  assert.ok(!out.includes('## Auto-Captured'), 'section gone');
  assert.ok(out.includes('## Corrections\n- CORRECTION [chakra]:'), 'other sections intact');
});

// ── idempotency: a normalize cycle is stable ──────────────────────────────────

test('a mark-all-dirty normalize cycle is idempotent', () => {
  const doc1 = parse(FIXTURE);
  for (const e of items(doc1)) setItem(e, e.raw); // canonical == raw → no visible change
  const once = render(doc1);
  const doc2 = parse(once);
  for (const e of items(doc2)) setItem(e, e.raw);
  assert.equal(render(doc2), once);
  assert.equal(once, FIXTURE, 'canonical == raw leaves the corpus byte-identical');
});

// ── CLI self-test harness ─────────────────────────────────────────────────────

function tmpFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdgrammar-test-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, contents);
  return file;
}

test('CLI roundtrip exits 0 on a byte-identical file', () => {
  const file = tmpFile(FIXTURE);
  const r = spawnSync(process.execPath, [CLI, 'roundtrip', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /byte-identical/);
});

test('CLI roundtrip exits 0 on a CRLF learnings file', () => {
  const file = tmpFile(toCrlf(FIXTURE));
  const r = spawnSync(process.execPath, [CLI, 'roundtrip', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('CLI --help exits 0; a bad command exits 2', () => {
  assert.equal(spawnSync(process.execPath, [CLI, '--help']).status, 0);
  assert.equal(spawnSync(process.execPath, [CLI, 'bogus']).status, 2);
});
