// Author: Subash Karki
// Regression guard for scripts/lib/learning-grammar.cjs.
//
// The break this file exists to prevent: the writer spec (commands/learn.md) specified
// an em dash inside a CORRECTION, a standing no-em-dash convention rewrote every entry
// on disk to a plain ' - ', and the two readers required the em dash. 54 real entries
// parsed as 0 for months with no failing test and no error - promotion, staleness,
// distillation and prompt injection were all silently dark. So: BOTH separator forms
// are pinned here, and so is the negative case, because a grammar loose enough to match
// prose would inflate the counts the lifecycle arithmetic depends on.
//
// The em dash is built from an escape below rather than typed, so this file does not
// itself author the character that caused the bug.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const G = require('../scripts/lib/learning-grammar.cjs');

const EM = '—';
const EN = '–';

// --- separator forms: the exact break class -------------------------------------

test('plain-dash CORRECTION parses (the form that is actually on disk)', () => {
  const src = 'CORRECTION [blade-marker]: [cleared the marker too early] - [keep it until every editor finishes] [failed] (2026-07-02)';
  const [e] = G.parseLearningEntries(src, 'workflow.md');
  assert.equal(e.type, 'correction');
  assert.equal(e.keyword, 'blade-marker');
  assert.equal(e.wrong, 'cleared the marker too early');
  assert.equal(e.right, 'keep it until every editor finishes');
  assert.equal(e.failed, true);
  assert.equal(e.status, 'failed');
  assert.equal(e.date, '2026-07-02');
});

test('em-dash CORRECTION parses (the form the writer spec still specifies)', () => {
  const src = `CORRECTION [tilde-in-quotes]: [wrote a tilde inside double quotes] ${EM} [use $HOME in quoted expansions] [failed] (2026-07-02)`;
  const [e] = G.parseLearningEntries(src, 'workflow.md');
  assert.equal(e.type, 'correction');
  assert.equal(e.wrong, 'wrote a tilde inside double quotes');
  assert.equal(e.right, 'use $HOME in quoted expansions');
  assert.equal(e.failed, true);
});

test('en-dash CORRECTION parses too, so neither dash convention can disable the reader', () => {
  const src = `CORRECTION [x]: [went wrong] ${EN} [do this] [failed] (2026-07-02)`;
  const [e] = G.parseLearningEntries(src, 'w.md');
  assert.equal(e.wrong, 'went wrong');
  assert.equal(e.right, 'do this');
});

test('both separator forms yield IDENTICAL parses - the separator carries no meaning', () => {
  const plain = G.parseLearningEntries('CORRECTION [k]: [a] - [b] [failed] (2026-07-02)', 'w.md')[0];
  const em = G.parseLearningEntries(`CORRECTION [k]: [a] ${EM} [b] [failed] (2026-07-02)`, 'w.md')[0];
  for (const field of ['type', 'keyword', 'wrong', 'right', 'failed', 'status', 'date']) {
    assert.deepEqual(plain[field], em[field], `field ${field} diverged between dash forms`);
  }
});

// --- column-0 vs leading-dash --------------------------------------------------

test('column-0 entries parse (real files never use list dashes)', () => {
  const entries = G.parseLearningEntries(
    ['PATTERN [a]: body one (2026-07-02)', '', 'LEARNING [b]: body two (2026-07-03)'].join('\n'),
    'w.md',
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].lineNum, 0);
  assert.equal(entries[1].lineNum, 2);
});

test('leading-dash entries parse (older writers emitted bullets)', () => {
  const entries = G.parseLearningEntries('- PATTERN [a]: body (2026-07-02)', 'w.md');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, 'pattern');
  assert.equal(entries[0].keyword, 'a');
});

test('the graduateToDomainFile bullet form parses, including its u: date', () => {
  // Written by skills/phantom/scripts/phantom-learning.mjs graduateToDomainFile.
  const [e] = G.parseLearningEntries('- prefer semantic tokens [validated:7] q:0.9 u:2026-07-01', 'ui.md');
  assert.equal(e.type, 'pattern');
  assert.equal(e.validationCount, 7);
  assert.equal(e.date, '2026-07-01');
});

// --- all three prefixes ---------------------------------------------------------

test('all three observed prefixes parse, including the undocumented LEARNING class', () => {
  const src = [
    'CORRECTION [c]: [a] - [b] [failed] (2026-07-02)',
    'PATTERN [p]: pattern body (2026-07-02)',
    'LEARNING [l]: learning body (2026-07-02)',
  ].join('\n\n');
  const types = G.parseLearningEntries(src, 'w.md').map((e) => e.type);
  assert.deepEqual(types, ['correction', 'pattern', 'learning']);
});

test('an unknown prefix does NOT parse - the accepted set is closed', () => {
  assert.equal(G.matchEntryHead('NOTE [x]: something (2026-07-02)'), null);
  assert.equal(G.matchEntryHead('TODO [x]: something (2026-07-02)'), null);
});

// --- RECURRED continuations -----------------------------------------------------

test('a RECURRED continuation accretes a second date and a validated count onto ONE entry', () => {
  const src = 'PATTERN [nul-byte]: raw control byte makes git treat the file as binary (2026-07-03) RECURRED: blade emitted raw NULs again [validated:1] (2026-07-23)';
  const entries = G.parseLearningEntries(src, 'workflow.md');
  assert.equal(entries.length, 1, 'a recurrence must not become a second entry');
  const [e] = entries;
  assert.equal(e.recurred, true);
  assert.equal(e.validationCount, 1);
  assert.deepEqual(e.dates, ['2026-07-03', '2026-07-23']);
  assert.equal(e.firstDate, '2026-07-03');
  // The NEWEST date is the entry's date, so a recurrence reads as freshness. If this
  // inverted, a re-confirmed learning would be the first thing an expiry pass deleted.
  assert.equal(e.date, '2026-07-23');
});

test('the newest date wins even when the dates appear out of order in the text', () => {
  const [e] = G.parseLearningEntries('PATTERN [x]: body (2026-07-23) earlier note (2026-07-03)', 'w.md');
  assert.equal(e.date, '2026-07-23');
  assert.equal(e.firstDate, '2026-07-03');
});

// --- header-less files ----------------------------------------------------------

test('a file with ZERO section headers still parses every entry', () => {
  // infra.md has no headings at all; the old reader skipped entries outside a
  // recognized section and therefore dropped all 18 of them.
  const src = [
    '# Learnings - infra',
    '',
    'PATTERN [guards]: a silent-skip guard must cover the run failure (2026-06-09)',
    '',
    'PATTERN [vendoring]: vendor third-party code verbatim (2026-06-09)',
  ].join('\n');
  const entries = G.parseLearningEntries(src, 'infra.md');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.section), ['', '']);
});

test('sections are recorded when present but never required', () => {
  const src = ['## Corrections', 'CORRECTION [a]: [x] - [y] [failed] (2026-07-02)'].join('\n');
  const [e] = G.parseLearningEntries(src, 'w.md');
  assert.equal(e.section, 'corrections');
});

// --- NEGATIVE cases: prose must not parse --------------------------------------

test('NEGATIVE: committed chat prose does not parse as an entry', () => {
  // Both of these are real committed lines in workflow.md (lines 1 and 74): a
  // compressor's preamble and its commentary. Line 74 is especially dangerous - it
  // talks ABOUT em-dash separators and dash rules, so a loose grammar would eat it.
  const prose = [
    'Subash, here is the compressed caveman-format markdown. Headings, code blocks, backticked content, paths, and commands untouched; only prose squeezed.',
    'Two notes on choices I made: I replaced the em-dash separators in the CORRECTION entries with plain " - " per your global dash rule, and I kept every keyword tag, date, [failed]/[validated] marker, commit hash, version number, and metric intact since those are the load-bearing facts in a learnings file.',
  ];
  for (const line of prose) {
    assert.equal(G.matchEntryHead(line), null, `prose parsed as an entry: ${line.slice(0, 50)}`);
    assert.equal(G.parseLearningEntries(line, 'workflow.md').length, 0);
  }
});

test('NEGATIVE: a bare column-0 line ending in a date is prose, not an entry', () => {
  // This is the specific over-match that would corrupt the counts: the un-prefixed
  // date-stamped shape is accepted ONLY behind a list bullet.
  assert.equal(G.matchEntryHead('We shipped the gate refactor on (2026-07-02)'), null);
  assert.equal(G.matchEntryHead('Release notes for the sprint (2026-07-02)'), null);
  // ...while the bulleted form still parses, so the tightening is a real distinction.
  assert.ok(G.matchEntryHead('- we shipped the gate refactor (2026-07-02)'));
});

test('NEGATIVE: headings, tables and blockquotes are not entries', () => {
  const src = [
    '## From PLAN-HTML-UX (2026-07-07)',
    '### Corrections',
    '> quoted aside about a CORRECTION [thing] (2026-07-02)',
    '| Domain | `ui.md` | 3 |',
  ].join('\n');
  assert.deepEqual(G.parseLearningEntries(src, 'w.md'), []);
});

test('NEGATIVE: an untagged undated bullet of ordinary prose is not an entry', () => {
  assert.equal(G.matchEntryHead('- just some notes with no tag and no date'), null);
});

test('NEGATIVE: the whole grammar over a prose-only document yields zero entries', () => {
  const src = [
    'Subash, here is the compressed markdown.',
    '',
    'I replaced the em-dash separators with plain dashes per the global rule.',
    '',
    'No corrections recorded yet.',
  ].join('\n');
  assert.deepEqual(G.parseLearningEntries(src, 'w.md'), []);
});

// --- continuation absorption must not merge two entries ------------------------

test('a wrapped entry absorbs its continuation but two adjacent entries stay separate', () => {
  const wrapped = G.parseLearningEntries(
    ['PATTERN [a]: first half of the body', 'and the wrapped remainder (2026-07-02)'].join('\n'),
    'w.md',
  );
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].endLine, 1);
  assert.equal(wrapped[0].date, '2026-07-02');

  const adjacent = G.parseLearningEntries(
    ['CORRECTION [a]: [x] - [y] [failed] (2026-07-02)', 'CORRECTION [b]: [x] - [y] [failed] (2026-07-03)'].join('\n'),
    'w.md',
  );
  assert.equal(adjacent.length, 2, 'adjacent entries must never merge');
  assert.deepEqual(adjacent.map((e) => e.keyword), ['a', 'b']);
});

// --- lifecycle tags -------------------------------------------------------------

test('inline lifecycle tags are read wherever they sit on the line', () => {
  const failed = G.parseLearningEntries('PATTERN [a]: body [failed] (2026-07-02)', 'w.md')[0];
  assert.equal(G.lifecycleClass(failed, 5), 'failed');

  const high = G.parseLearningEntries('PATTERN [a]: body [validated:7] (2026-07-02)', 'w.md')[0];
  assert.equal(G.lifecycleClass(high, 5), 'validated-high');

  const low = G.parseLearningEntries('PATTERN [a]: body [validated:2] (2026-07-02)', 'w.md')[0];
  assert.equal(G.lifecycleClass(low, 5), 'validated-low');

  const proposed = G.parseLearningEntries('PATTERN [a]: body [proposed] (2026-07-02)', 'w.md')[0];
  assert.equal(G.lifecycleClass(proposed, 5), 'proposed');

  const correction = G.parseLearningEntries('CORRECTION [a]: [x] - [y] (2026-07-02)', 'w.md')[0];
  assert.equal(G.lifecycleClass(correction, 5), 'correction');
});

test('a CORRECTION missing its bracket pair is still an entry, never dropped', () => {
  // Strict readers are how this bug happened. A malformed body loses wrong/right, but
  // the entry itself must survive.
  const [e] = G.parseLearningEntries('CORRECTION [a]: freeform body with no brackets [failed] (2026-07-02)', 'w.md');
  assert.equal(e.type, 'correction');
  assert.equal(e.wrong, null);
  assert.equal(e.right, null);
  assert.equal(e.failed, true);
});

// --- check:`<cmd>` predicate (K5) -------------------------------------------------

test('an entry with a check: predicate parses it out and strips it from the body', () => {
  const src = "PATTERN [no-greptile-this-repo]: greptile is not installed on this repo [validated:1] check:`gh api repos/x/y/issues/comments --jq '.[].user.login' | grep -q greptile-apps`";
  const [e] = G.parseLearningEntries(src, 'workflow.md');
  assert.equal(e.predicate, "gh api repos/x/y/issues/comments --jq '.[].user.login' | grep -q greptile-apps");
  assert.equal(e.text, 'PATTERN [no-greptile-this-repo]: greptile is not installed on this repo [validated:1]');
  assert.doesNotMatch(e.text, /check:/);
  assert.doesNotMatch(e.content, /check:/);
  // Existing fields must be untouched by the addition.
  assert.equal(e.keyword, 'no-greptile-this-repo');
  assert.equal(e.validationCount, 1);
});

test('an entry with NO check: clause is unchanged - predicate absent, body identical', () => {
  const withoutPredicate = 'PATTERN [x]: an ordinary entry with no predicate at all [validated:1] (2026-07-02)';
  const [e] = G.parseLearningEntries(withoutPredicate, 'w.md');
  assert.equal(e.predicate, null);
  assert.equal(e.text, withoutPredicate);
  assert.equal(e.content, 'an ordinary entry with no predicate at all [validated:1] (2026-07-02)');
});

test('a malformed unterminated check: clause yields NO predicate and leaves the body intact', () => {
  const malformed = 'PATTERN [x]: body with an unterminated check:`gh api repos/x/y --jq .foo (2026-07-02)';
  const [e] = G.parseLearningEntries(malformed, 'w.md');
  assert.equal(e.predicate, null, 'an unterminated backtick must never half-parse into a predicate');
  assert.equal(e.text, malformed, 'the malformed clause must survive verbatim in the body, not be dropped or half-stripped');
});

test('the check: predicate parses at column 0 (the PREFIX shape)', () => {
  const [e] = G.parseLearningEntries('PATTERN [k]: body [validated:2] check:`true`', 'w.md');
  assert.equal(e.predicate, 'true');
});

test('the check: predicate parses behind a leading bullet (the older-writer shape)', () => {
  const [e] = G.parseLearningEntries('- prefer semantic tokens [validated:7] check:`true` q:0.9 u:2026-07-01', 'ui.md');
  assert.equal(e.predicate, 'true');
  assert.doesNotMatch(e.content, /check:/);
});

test('an empty check: command (no command text) is treated as no predicate', () => {
  const [e] = G.parseLearningEntries('PATTERN [x]: body [validated:1] check:``', 'w.md');
  assert.equal(e.predicate, null);
});

// --- INDEX.md: both shapes ------------------------------------------------------

test('INDEX.md bullet-list form resolves domain files (the real shape)', () => {
  const src = [
    '# Learnings Index',
    '',
    `- workflow.md ${EM} em-dash-in-new-text [failed]; grep-count-exit [failed]`,
    `- [infra](infra.md) ${EM} guards must cover run-failure. (4 entries) [validated:1]`,
  ].join('\n');
  const map = G.parseIndexDomainFiles(src);
  assert.equal(map.workflow, 'workflow.md');
  assert.equal(map.infra, 'infra.md');
});

test('INDEX.md markdown-table form still resolves domain files', () => {
  const src = ['| Domain | File | Entries |', '|---|---|---|', '| ui | `ui.md` | 4 |'].join('\n');
  assert.equal(G.parseIndexDomainFiles(src).ui, 'ui.md');
});

test('INDEX.md never resolves to itself or to a retired snapshot', () => {
  const src = ['- INDEX.md is this file', '- workflow.original.md stale snapshot', '- workflow.md real'].join('\n');
  const map = G.parseIndexDomainFiles(src);
  assert.equal(map.workflow, 'workflow.md');
  assert.ok(!Object.values(map).includes('INDEX.md'));
  assert.ok(!Object.values(map).includes('workflow.original.md'));
});

// --- INDEX.md: the bare bullet form is anchored, not a scan of the whole line ----
//
// Same defect class as the em-dash break above: a bare `.md` match that is not
// anchored to the bullet position will happily resolve the FIRST `.md` token
// anywhere in the line, including one sitting in an entry's prose body. The two
// fixtures below are lifted verbatim from auto-captures.md on this repo (the
// PR #97 mutation-audit retro and the scope-not-tier correction), reshaped only
// from `auto: ...` prefix to a bullet so BULLET_RE accepts them - the awkward
// real-world wording is kept intact rather than sanitized into a tidy string.

test('INDEX.md bare form does not resolve a .md token sitting in the entry prose', () => {
  const src =
    '- a path merely ending in review.md, one where reverting the verdict enum cell left the suite passing';
  const map = G.parseIndexDomainFiles(src);
  assert.ok(!('review' in map));
  assert.ok(!Object.values(map).includes('review.md'));
});

test('INDEX.md bare form does not resolve a .md token inside a path-bearing citation', () => {
  const src =
    '- routed nearly every subtask to opus, justified as subtle or high-consequence, the exact reason reference/agents.md:40 rejects';
  const map = G.parseIndexDomainFiles(src);
  assert.ok(!('agents' in map));
  assert.ok(!Object.values(map).includes('agents.md'));
});

test('INDEX.md bare form still resolves when the .md token is the bullet reference itself', () => {
  const src = '- workflow.md - em-dash-in-new-text [failed]; grep-count-exit [failed]';
  assert.equal(G.parseIndexDomainFiles(src).workflow, 'workflow.md');
});

// --- retirement -----------------------------------------------------------------

test('retired and non-domain files are excluded from live knowledge', () => {
  assert.equal(G.isLiveDomainFile('workflow.md'), true);
  assert.equal(G.isLiveDomainFile('infra.md'), true);
  assert.equal(G.isLiveDomainFile('workflow.original.md'), false);
  assert.equal(G.isLiveDomainFile('INDEX.md'), false);
  assert.equal(G.isLiveDomainFile('EDGES.md'), false);
  assert.equal(G.isLiveDomainFile('notes.txt'), false);
  assert.equal(G.isLiveDomainFile(''), false);
});

// --- auto-captures --------------------------------------------------------------

test('auto-capture lines parse with their v: count and u: date', () => {
  const [e] = G.parseAutoCaptures('auto: prefer semantic tokens [proposed] v:3 q:0.8 u:2026-07-02');
  assert.equal(e.validationCount, 3);
  assert.equal(e.date, '2026-07-02');
  assert.match(e.text, /^auto:/);
  assert.deepEqual(G.parseAutoCaptures('- not an auto line (2026-07-02)'), []);
});

// --- the real files on disk -----------------------------------------------------

test('the real learnings files parse to a NON-ZERO count with no entry losing its date', () => {
  let learningsPath;
  try {
    learningsPath = require('../scripts/lib/phantom-paths').learningsDir();
  } catch (_) {
    return; // paths lib unavailable in this environment
  }
  if (!fs.existsSync(learningsPath)) return; // no learnings on this machine

  const files = fs.readdirSync(learningsPath).filter(G.isLiveDomainFile);
  if (files.length === 0) return;

  let total = 0;
  for (const file of files) {
    const content = fs.readFileSync(path.join(learningsPath, file), 'utf8');
    const entries = G.parseLearningEntries(content, file);
    total += entries.length;

    // Every prefix occurrence at column 0 must become exactly one entry: this is the
    // count that was 54-on-disk versus 0-parsed.
    const rawHeads = (content.match(/^(?:CORRECTION|PATTERN|LEARNING) \[/gm) || []).length;
    assert.ok(
      entries.length >= rawHeads,
      `${file}: ${rawHeads} prefixed lines on disk but only ${entries.length} parsed`,
    );
    for (const entry of entries) {
      assert.ok(entry.date, `${file}:${entry.lineNum + 1} parsed without a date`);
    }
  }
  assert.ok(total > 0, 'real learnings files parsed to zero entries - the original bug');
});

// --- falsification: prove the fixtures actually fire ---------------------------

test('FALSIFY: the em-dash-only grammar this replaced fails the plain-dash fixture', () => {
  // The exact regex evolution-runner.js used to carry. Kept here as a mutation so the
  // fixtures above are proven to discriminate rather than merely pass.
  const oldCorrectionRe = new RegExp(
    `^(?:-\\s*)?(?:\\*\\*)?CORRECTION\\s*\\[([^\\]]+)\\]:\\s*\\[([^\\]]*)\\]\\s*${EM}\\s*\\[([^\\]]*)\\]`,
    'i',
  );
  const onDisk = 'CORRECTION [blade-marker]: [went wrong] - [do instead] [failed] (2026-07-02)';
  assert.equal(oldCorrectionRe.test(onDisk), false, 'the old regex must fail the real shape');
  assert.ok(G.matchEntryHead(onDisk), 'the new grammar must accept the real shape');
});

test('FALSIFY: the leading-dash-only grammar this replaced fails every column-0 entry', () => {
  const oldValidatedRe = /^-\s*(.+?)\s*\[validated:(\d+)\]/;
  const onDisk = 'PATTERN [gate-surface]: body [validated:2] (2026-07-03)';
  assert.equal(oldValidatedRe.test(onDisk), false, 'the old regex must fail a column-0 entry');
  assert.equal(G.parseLearningEntries(onDisk, 'w.md')[0].validationCount, 2);
});

test('FALSIFY: the table-only INDEX parser this replaced resolves nothing from a bullet list', () => {
  const bulletIndex = `- workflow.md ${EM} some entries [failed]`;
  const oldTableRe = /\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/g;
  assert.equal(oldTableRe.exec(bulletIndex), null, 'the old regex must find no mapping');
  assert.equal(G.parseIndexDomainFiles(bulletIndex).workflow, 'workflow.md');
});

// --- consumer wiring: one parser, and injection is not dark --------------------

test('neither consumer keeps a private entry regex', () => {
  const consumers = ['../scripts/evolution-runner.js', '../hooks/memory-reader.js'];
  for (const rel of consumers) {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    assert.match(src, /learning-grammar\.cjs/, `${rel} must route through the shared grammar`);
    // The three private parse regexes that caused the bug, plus the table-only INDEX
    // parser. Their absence is what keeps a second parser from coming back to life.
    assert.doesNotMatch(src, /CORRECTION\\s\*\\\[/, `${rel} still builds a CORRECTION regex`);
    assert.doesNotMatch(src, /\\\[validated:\(\\d\+\)\\\]/, `${rel} still builds a validated regex`);
    assert.doesNotMatch(src, /tableRowRe/, `${rel} still builds an INDEX table regex`);
  }
});

test('memory-reader emits a NON-EMPTY injection block for a prompt with no matching domain file', () => {
  // The headline regression. A 'ui' prompt in a repo whose only files are infra.md and
  // workflow.md resolved to no file at all and injected silence.
  // learningsDir() resolves <PHANTOM_DATA>/repos/<PHANTOM_REPO>/learnings, so those two
  // env vars are the seam that points the hook at a fixture instead of real state.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-memory-reader-'));
  const dir = path.join(root, 'repos', 'grammar-fixture', 'learnings');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(
      path.join(dir, 'INDEX.md'),
      ['# Learnings Index', '', `- workflow.md ${EM} grep-count-exit [failed]`].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'workflow.md'),
      [
        'Subash, here is the compressed markdown preamble that must not be injected.',
        '',
        'CORRECTION [grep-count-exit]: [wrote grep -c X finds 0 matches] - [write absence checks as ! grep -q X] [failed] (2026-07-07)',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(dir, 'workflow.original.md'), 'PATTERN [retired]: stale snapshot entry (2026-01-01)\n');

    const { execFileSync } = require('node:child_process');
    const out = execFileSync('node', [path.join(__dirname, '..', 'hooks', 'memory-reader.js')], {
      input: JSON.stringify({ prompt: 'fix the react component css layout' }),
      env: { ...process.env, PHANTOM_DATA: root, PHANTOM_REPO: 'grammar-fixture' },
      encoding: 'utf8',
    });

    assert.match(out, /<!-- memory-injection -->/, 'injection block was empty - the headline bug');
    assert.match(out, /grep-count-exit/, 'the recorded correction was not injected');
    assert.doesNotMatch(out, /compressed markdown preamble/, 'prose leaked into the injection');
    assert.doesNotMatch(out, /stale snapshot entry/, 'a retired file leaked into the injection');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
