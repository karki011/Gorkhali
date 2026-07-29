// Author: Subash Karki
// learning-grammar.cjs - the ONE parser for learnings domain files, INDEX.md and
// auto-captures. Dep-free apart from the domain taxonomy (scripts/lib/domains.js).
//
// WHY THIS MODULE EXISTS
// The writers are prose (commands/learn.md) and the readers were private regexes
// (scripts/evolution-runner.js, hooks/memory-reader.js). The writer spec said the
// separator inside a CORRECTION was an em dash; a standing no-em-dash convention then
// rewrote every entry on disk to a plain ' - '. Both readers required the em dash, so
// 54 real entries parsed as 0: promotion, staleness and distillation had never once
// seen an entry, and prompt injection was dark. Fixing the DATA would re-break on the
// next convention change. One shared grammar that accepts BOTH separator forms is the
// structural fix, and test/learning-grammar.test.js pins both so this class of break
// fails loudly instead of silently.
//
// ACCEPTED ENTRY SHAPES
// Every prefixed shape is accepted at column 0 (what is on disk) or behind a '- '
// bullet (what older writers emitted). Both dash forms are accepted everywhere.
//   CORRECTION [kw]: [what went wrong] - [what to do instead] [failed] (2026-07-02)
//   PATTERN [kw]: body (2026-07-02) RECURRED: ... [validated:1] (2026-07-23)
//   LEARNING [kw]: body (2026-07-02)
//   - body [validated:N] q:0.9 u:2026-07-01     (graduateToDomainFile writer)
//   - body (2026-07-02)                         (legacy date-stamped bullet)
//
// LEARNING appears in no spec - it is an emergent third class with real entries on
// disk, so it is accepted and documented here rather than dropped on the floor.
//
// A RECURRED continuation accretes a second date and a [validated:N] onto the SAME
// entry, so an entry carries a date LIST; `date` is the newest one, which is what
// makes a recurrence count as freshness rather than as staleness.
//
// DELIBERATE TIGHTNESS: the un-prefixed shapes require a leading bullet. A bare
// column-0 line ending in a date is ordinary prose (these files contain committed chat
// preamble and commentary), and matching it would inflate the counts the lifecycle
// arithmetic depends on.
//
// OPTIONAL PREDICATE: any shape above may carry a trailing check:`<shell command>`,
// e.g. `PATTERN [kw]: body [validated:1] check:`gh api ... | grep -q x``. It is parsed
// into `entry.predicate` and stripped from `content`/`text` - this module only parses
// it. Whether/when it runs is entirely owned by scripts/evolution-runner.js, behind
// two opt-in flags; nothing in this file, or on any read path, executes anything.

'use strict';

// Fail open on BOTH failure modes: the taxonomy module being absent, and the taxonomy
// module being present without the export (a bare destructure would bind undefined
// over the fallback and crash every caller).
let RETIRED_DOMAIN_FILES = ['workflow.original.md'];
try {
  const taxonomy = require('./domains');
  if (Array.isArray(taxonomy.RETIRED_DOMAIN_FILES)) {
    RETIRED_DOMAIN_FILES = taxonomy.RETIRED_DOMAIN_FILES;
  }
} catch (_) { /* fail open: taxonomy missing -> inline retirement list above */ }

const EM_DASH = '—';
const EN_DASH = '–';
// Any dash a writer might have used between the two halves of a correction.
const DASH_CLASS = `[-${EN_DASH}${EM_DASH}]`;

// check:`<shell command>` - an OPTIONAL machine-checkable predicate appended AFTER the
// existing trailing tokens ([validated:N], q:, u:, dates). Backtick-delimited so the
// command text cannot be confused with those tokens or with a following entry head.
// This module only PARSES the clause - it never runs it. Execution, its two opt-in
// flags and every security constraint live in scripts/evolution-runner.js.
const CHECK_RE = /\s*check:`([^`]*)`/;

/**
 * Split a `check:`...`` clause off a body/text string. Fail open on the one failure
 * mode this shape has: an opening backtick with no matching close. CHECK_RE requires
 * the closing backtick to match at all, so an unterminated clause simply does not
 * match - no half-parse, no throw, the string comes back byte-identical. An empty
 * command (`` check:`` `` ``) is treated the same as absent: a predicate with nothing
 * to run is not a predicate.
 */
function extractPredicate(text) {
  const s = String(text == null ? '' : text);
  const m = s.match(CHECK_RE);
  if (!m || !m[1]) return { text: s, predicate: null };
  return { text: (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim(), predicate: m[1] };
}

const PREFIX_TYPES = { CORRECTION: 'correction', PATTERN: 'pattern', LEARNING: 'learning' };
const PREFIXES = Object.keys(PREFIX_TYPES);

const OPTIONAL_BULLET = '(?:[-*+]\\s+)?';
// Any heading ends an entry's continuation; only `##` and deeper NAME a section. A
// lone `#` is the document title ('# Learnings - infra'), not a section, and recording
// it as one would make a header-less file look sectioned.
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.*)$/;
const SECTION_RE = /^\s{0,3}#{2,6}\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+/;
const ENTRY_HEAD_RE = new RegExp(
  `^\\s*${OPTIONAL_BULLET}(?:\\*\\*)?(${PREFIXES.join('|')})(?:\\*\\*)?\\s*\\[([^\\]\\n]+)\\]:\\s*(.*)$`,
  'i',
);
// Bracketed halves of a correction body. `[^\]]*` stops at the first `]`, so inner
// prose containing its own dashes is not a hazard.
const CORRECTION_PAIR_RE = new RegExp(`^\\[([^\\]]*)\\]\\s*${DASH_CLASS}\\s*\\[([^\\]]*)\\]`);
const LIFECYCLE_TAG_RE = /\[(?:validated:\d+|failed|proposed|stale)\]/i;
const DATED_BULLET_RE = /^\s*[-*+]\s+(?!\[)(.+?)\s*\((\d{4}-\d{2}-\d{2})\)\s*$/;
const TAGGED_BULLET_RE = /^\s*[-*+]\s+(?!\[)(.+)$/;
const AUTO_LINE_RE = /^\s*auto:\s+(.+)$/i;
const FILENAME_RE = '`?([\\w.-]+\\.md)`?';

// Template scaffolding and "nothing recorded yet" markers. Single-sourced here so the
// reader and any future consumer agree on what is not real knowledge.
const TEMPLATE_RE = /no corrections recorded|template|YYYY-MM-DD|\[describe\b|\[why\b|\[the approach|\[task types|start as \[failed\]|What failed:|Root cause:|What to do instead:|Applies to:/i;

function stripCr(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** INDEX.md, EDGES.md and retired snapshots are not live knowledge. */
function isLiveDomainFile(fileName) {
  if (!fileName || !fileName.endsWith('.md')) return false;
  if (fileName === 'INDEX.md' || fileName === 'EDGES.md') return false;
  if (fileName.endsWith('.original.md')) return false;
  return !RETIRED_DOMAIN_FILES.includes(fileName);
}

function lifecycleOf(text) {
  const dates = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]).sort();
  let validationCount = 0;
  for (const m of text.matchAll(/\[validated:(\d+)\]/gi)) {
    validationCount = Math.max(validationCount, parseInt(m[1], 10));
  }
  const failed = /\[failed\]/i.test(text);
  const proposed = /\[proposed\]/i.test(text);
  let status = '';
  if (failed) status = 'failed';
  else if (validationCount > 0) status = `validated:${validationCount}`;
  else if (proposed) status = 'proposed';
  return {
    dates,
    firstDate: dates[0] || '',
    date: dates[dates.length - 1] || '',
    failed,
    proposed,
    stale: /\[stale\]/i.test(text),
    recurred: /\bRECURRED\b/.test(text),
    validationCount,
    status,
  };
}

/** Classify one line as an entry head, or null. Does not read tags or dates. */
function matchEntryHead(line) {
  const prefixed = line.match(ENTRY_HEAD_RE);
  if (prefixed) {
    const type = PREFIX_TYPES[prefixed[1].toUpperCase()];
    const { text: body, predicate } = extractPredicate(prefixed[3]);
    const pair = body.match(CORRECTION_PAIR_RE);
    return {
      type,
      prefix: prefixed[1].toUpperCase(),
      keyword: prefixed[2].trim(),
      content: body.trim(),
      wrong: pair ? pair[1].trim() : null,
      right: pair ? pair[2].trim() : null,
      predicate,
    };
  }

  const tagged = line.match(TAGGED_BULLET_RE);
  if (tagged && LIFECYCLE_TAG_RE.test(tagged[1])) {
    const { text: body, predicate } = extractPredicate(tagged[1]);
    return {
      type: /\[failed\]/i.test(tagged[1]) ? 'correction' : 'pattern',
      prefix: null,
      keyword: '',
      content: body.trim(),
      wrong: null,
      right: null,
      predicate,
    };
  }

  const dated = line.match(DATED_BULLET_RE);
  if (dated) {
    const { text: body, predicate } = extractPredicate(dated[1]);
    return { type: 'entry', prefix: null, keyword: '', content: body.trim(), wrong: null, right: null, predicate };
  }

  return null;
}

/**
 * Parse a learnings domain file into entries.
 * Section headings are recorded but never required: infra.md has zero headings and
 * every one of its 18 entries must still parse.
 */
function parseLearningEntries(content, source = '') {
  const lines = String(content == null ? '' : content).split('\n');
  const entries = [];
  let section = '';

  for (let i = 0; i < lines.length; i++) {
    const line = stripCr(lines[i]);

    if (HEADING_RE.test(line)) {
      const named = line.match(SECTION_RE);
      section = named ? named[1].trim().toLowerCase() : '';
      continue;
    }

    const head = matchEntryHead(line);
    if (!head) continue;

    // Absorb wrapped continuation lines. A blank line, a heading, a bullet or the next
    // entry head ends the entry - the reader stays forgiving without running together
    // two adjacent entries.
    const rawLines = [line];
    let end = i;
    while (end + 1 < lines.length) {
      const next = stripCr(lines[end + 1]);
      if (next.trim() === '') break;
      if (HEADING_RE.test(next) || BULLET_RE.test(next) || matchEntryHead(next)) break;
      rawLines.push(next);
      end++;
    }

    const raw = rawLines.join('\n');
    // flat is built from the RAW lines, independent of head.content (which only ever
    // covers the first line), so a check: clause is stripped here too - this is what
    // actually keeps it out of `text` for both single-line entries and ones where the
    // predicate lands on a wrapped continuation line. lifecycleOf runs on the STRIPPED
    // flat, not the raw one, so a date-like or dash-like substring inside the shell
    // command itself can never be mistaken for a lifecycle tag.
    const flatRaw = rawLines.map((l) => l.trim()).join(' ').replace(/\*\*/g, '');
    const { text: flat, predicate: flatPredicate } = extractPredicate(flatRaw);
    entries.push({
      ...head,
      predicate: head.predicate || flatPredicate,
      ...lifecycleOf(flat),
      section,
      source,
      lineNum: i,
      endLine: end,
      raw,
      text: flat,
    });
    i = end;
  }

  return entries;
}

/**
 * Injection priority class for an entry. Owned here so the lifecycle-to-priority
 * mapping cannot drift between consumers.
 */
function lifecycleClass(entry, graduationThreshold = 5) {
  if (!entry) return 'auto';
  if (entry.failed) return 'failed';
  if (entry.validationCount >= graduationThreshold) return 'validated-high';
  if (entry.validationCount >= 1) return 'validated-low';
  if (entry.proposed) return 'proposed';
  if (entry.type === 'correction') return 'correction';
  if (String(entry.section || '').includes('habit')) return 'proposed';
  return 'validated-low';
}

/** True when the text is template scaffolding rather than recorded knowledge. */
function isTemplatePlaceholder(text) {
  return TEMPLATE_RE.test(String(text || ''));
}

/**
 * Map domain label -> domain file from INDEX.md, accepting BOTH shapes that exist:
 * a markdown table (`| Domain | `file.md` |`) and a bullet list (`- file.md - ...`
 * or `- [infra](infra.md) - ...`). The reader previously accepted the table only,
 * against a bullet-list INDEX, so no domain ever resolved.
 *
 * The bare bullet form is anchored to the position immediately after the bullet
 * marker so a `.md` token sitting in an entry's prose body is never mistaken for
 * the domain reference.
 */
function parseIndexDomainFiles(indexContent) {
  const map = {};
  const put = (label, file) => {
    const key = String(label || '').trim().toLowerCase().replace(/`/g, '').replace(/\s+/g, '-');
    if (!key || !isLiveDomainFile(file)) return;
    if (!(key in map)) map[key] = file;
  };

  for (const rawLine of String(indexContent == null ? '' : indexContent).split('\n')) {
    const line = stripCr(rawLine);

    const row = line.match(new RegExp(`^\\s*\\|\\s*([^|]+?)\\s*\\|\\s*${FILENAME_RE}\\s*\\|`));
    if (row) {
      put(row[1], row[2]);
      continue;
    }

    if (!BULLET_RE.test(line)) continue;

    // Link form carries a human label; also index it under its basename so a keyword
    // match on either spelling resolves.
    const link = line.match(new RegExp(`\\[([^\\]]+)\\]\\([^)]*?${FILENAME_RE}\\s*\\)`));
    if (link) {
      put(link[1], link[2]);
      put(link[2].replace(/\.md$/, ''), link[2]);
      continue;
    }

    const bare = line.match(new RegExp(`^\\s*[-*+]\\s+${FILENAME_RE}`));
    if (bare) put(bare[1].replace(/\.md$/, ''), bare[1]);
  }

  return map;
}

/** auto-captures.md lines: `auto: {text} [proposed] v:{N} q:{conf} u:{date}`. */
function parseAutoCaptures(content) {
  const out = [];
  for (const rawLine of String(content == null ? '' : content).split('\n')) {
    const line = stripCr(rawLine).trim();
    const m = line.match(AUTO_LINE_RE);
    if (!m) continue;
    const v = line.match(/\bv:(\d+)/);
    const u = line.match(/\bu:(\d{4}-\d{2}-\d{2})/);
    out.push({
      type: 'auto',
      text: line,
      content: m[1].trim(),
      validationCount: v ? parseInt(v[1], 10) : 0,
      date: u ? u[1] : '',
    });
  }
  return out;
}

module.exports = {
  parseLearningEntries,
  parseIndexDomainFiles,
  parseAutoCaptures,
  matchEntryHead,
  extractPredicate,
  lifecycleOf,
  lifecycleClass,
  isTemplatePlaceholder,
  isLiveDomainFile,
  PREFIX_TYPES,
  RETIRED_DOMAIN_FILES,
};
