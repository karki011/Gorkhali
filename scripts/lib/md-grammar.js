// Author: Subash Karki
// md-grammar.js — pure parse / render for markdown docs, with a byte-exact round-trip.
//
// Adapted from tasks-axi markdown-grammar.ts (MIT, © 2026 Kun Chen) —
// github.com/kunchenguid/tasks-axi. The TypeScript original is a task-backlog
// grammar (in-flight/queued/done sections, blocked-by edges, tag extraction). This
// port keeps its round-trip MECHANISM and drops the task semantics: entry
// recognition is pluggable so the same grammar serves the learnings INDEX.md,
// domain files, and brain cards this repo actually writes.
//
// The one absolute invariant (report §2.4, decision D1): render(parse(src)) === src
// byte-for-byte on a document nobody has mutated.
//   - Every entry keeps its exact original source lines (`raw`). An unmodified item
//     and every free-form line is emitted verbatim, so CRLF, a missing trailing
//     newline, and odd spacing in untouched entries all survive a round-trip.
//   - When a caller mutates an item it sets `dirty` + `canonical`; that one entry
//     re-renders from the canonical lines while every other byte stays verbatim, so
//     a targeted edit never reflows the rest of the file.
'use strict';

// The CR is data on a CRLF line: `raw` keeps it, but matching runs on the semantic
// (CR-stripped) line so a CRLF file is still recognized the same as an LF file.
function stripCr(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

const HEADER_RE = /^##\s+/;
// The default item is a markdown bullet or an `auto:` learnings line. Callers with a
// narrower grammar pass their own matchItem; the round-trip holds either way because
// raw is retained regardless of what a line is classified as.
const DEFAULT_ITEM_RE = /^\s*(?:[-*+]\s+|auto:\s+)/;

function defaultMatchItem(semantic) {
  return DEFAULT_ITEM_RE.test(semantic) ? { key: semantic.trim() } : null;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseEntries(lines, matchItem) {
  const entries = [];
  let rawRun = [];

  const flushRaw = () => {
    if (rawRun.length > 0) {
      entries.push({ kind: 'raw', lines: rawRun });
      rawRun = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = matchItem(stripCr(line));

    if (match) {
      flushRaw();
      const raw = [line];
      // Consume indented, non-blank continuation lines as part of this item's raw
      // (the same rule the source uses for a task body). A blank line or a
      // dedented line ends the item.
      while (i + 1 < lines.length) {
        const next = stripCr(lines[i + 1]);
        if (next.length === 0 || !/^\s/.test(next)) break;
        i++;
        raw.push(lines[i]);
      }
      entries.push({ kind: 'item', key: match.key, raw, dirty: false, canonical: null });
      continue;
    }

    rawRun.push(line);
  }

  flushRaw();
  return entries;
}

function parse(src, opts = {}) {
  const matchItem = opts.matchItem || defaultMatchItem;
  const isHeader = opts.isHeader || ((semantic) => HEADER_RE.test(semantic));

  if (src === '') {
    return { finalNewline: false, preamble: [], sections: [] };
  }

  // Split on \n only; a CRLF line keeps its trailing \r in `raw`, and the final
  // newline is tracked separately so it round-trips whether present or not.
  const finalNewline = src.endsWith('\n');
  const body = finalNewline ? src.slice(0, -1) : src;
  const lines = body.split('\n');

  const preamble = [];
  const sections = [];
  let current = null;
  let buffer = [];

  const closeSection = () => {
    if (current) {
      current.entries = parseEntries(buffer, matchItem);
      sections.push(current);
    }
    buffer = [];
  };

  for (const line of lines) {
    if (isHeader(stripCr(line))) {
      closeSection();
      current = { headerLine: line, entries: [] };
      continue;
    }
    if (current) buffer.push(line);
    else preamble.push(line);
  }
  closeSection();

  return { finalNewline, preamble, sections };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderEntry(entry) {
  if (entry.kind === 'raw') return entry.lines;
  // A dirty item without canonical lines falls back to raw rather than dropping
  // content — losing a line is never an acceptable failure mode.
  return entry.dirty && entry.canonical ? entry.canonical : entry.raw;
}

function render(doc) {
  const lines = [...doc.preamble];
  for (const section of doc.sections) {
    lines.push(section.headerLine);
    for (const entry of section.entries) {
      lines.push(...renderEntry(entry));
    }
  }
  if (doc.preamble.length === 0 && doc.sections.length === 0) return '';
  return lines.join('\n') + (doc.finalNewline ? '\n' : '');
}

// ---------------------------------------------------------------------------
// Mutation helpers — protect what the caller does NOT touch
// ---------------------------------------------------------------------------

function headerText(headerLine) {
  const m = stripCr(headerLine).match(/^##\s+(.*?)\s*$/);
  return m ? m[1] : '';
}

function findSection(doc, name) {
  const want = name.trim().toLowerCase();
  return doc.sections.find((s) => headerText(s.headerLine).trim().toLowerCase() === want);
}

function removeSection(doc, name) {
  const want = name.trim().toLowerCase();
  const idx = doc.sections.findIndex(
    (s) => headerText(s.headerLine).trim().toLowerCase() === want,
  );
  return idx === -1 ? undefined : doc.sections.splice(idx, 1)[0];
}

// The last rendered line of the document, or null when it is empty. Used to decide
// whether a freshly appended section needs a blank separator in front of it.
function lastLine(doc) {
  if (doc.sections.length > 0) {
    const s = doc.sections[doc.sections.length - 1];
    if (s.entries.length > 0) {
      const lines = renderEntry(s.entries[s.entries.length - 1]);
      return lines.length > 0 ? stripCr(lines[lines.length - 1]) : stripCr(s.headerLine);
    }
    return stripCr(s.headerLine);
  }
  if (doc.preamble.length > 0) return stripCr(doc.preamble[doc.preamble.length - 1]);
  return null;
}

function ensureTrailingBlank(doc) {
  const tail = lastLine(doc);
  if (tail === null || tail === '') return;
  if (doc.sections.length > 0) {
    doc.sections[doc.sections.length - 1].entries.push({ kind: 'raw', lines: [''] });
  } else {
    doc.preamble.push('');
  }
}

/**
 * Replace the body of the named `## ` section with `bodyLines` (verbatim), or append
 * a new section when it is absent. The preamble and every other section keep their
 * exact original bytes — this is the "regenerate one managed section, protect the
 * rest" primitive the learnings writers need. Returns the section.
 */
function setSection(doc, name, bodyLines, opts = {}) {
  const entries = bodyLines && bodyLines.length > 0 ? [{ kind: 'raw', lines: bodyLines.slice() }] : [];
  const existing = findSection(doc, name);
  if (existing) {
    existing.entries = entries;
    return existing;
  }
  ensureTrailingBlank(doc);
  const section = { headerLine: opts.headerLine || `## ${name}`, entries };
  doc.sections.push(section);
  return section;
}

/** Flat list of item entries across all sections (references — mutate in place). */
function items(doc) {
  const out = [];
  for (const section of doc.sections) {
    for (const entry of section.entries) {
      if (entry.kind === 'item') out.push(entry);
    }
  }
  return out;
}

/** Mark an existing item to re-render from `lines` instead of its original bytes. */
function setItem(entry, lines) {
  entry.canonical = lines.slice();
  entry.dirty = true;
  return entry;
}

/** A brand-new item that renders `lines` (no original bytes to preserve). */
function newItem(key, lines) {
  return { kind: 'item', key, raw: [], dirty: true, canonical: lines.slice() };
}

module.exports = {
  parse,
  render,
  headerText,
  findSection,
  removeSection,
  setSection,
  items,
  setItem,
  newItem,
  stripCr,
};

// CLI: node md-grammar.js roundtrip <file>   # exit 0 iff render(parse(file)) === file
// A self-test on real learnings files — a non-zero exit means the grammar would
// reflow that file, which must never happen on an unmodified document.
if (require.main === module) {
  const fs = require('fs');
  const { PhantomError, reportError } = require('./axi-error');
  const [, , cmd, file] = process.argv;
  const USAGE = 'Usage:\n  node md-grammar.js roundtrip <file>\n';

  function main() {
    if (cmd === '--help' || cmd === '-h') {
      process.stderr.write(USAGE);
      return;
    }
    if (cmd !== 'roundtrip' || !file) {
      throw new PhantomError(USAGE, 'VALIDATION_ERROR');
    }

    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch (error) {
      throw new PhantomError(`[md-grammar] cannot read ${file}: ${error.message}`, 'IO_ERROR');
    }

    const out = render(parse(src));
    if (out === src) {
      process.stdout.write(`[md-grammar] byte-identical: ${file}\n`);
      return;
    }

    // Report the first divergent line so a real reflow is diagnosable, not just "!=".
    const a = src.split('\n');
    const b = out.split('\n');
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    throw new PhantomError(
      `[md-grammar] NOT byte-identical: ${file}\n` +
        `  first diff at line ${n + 1}:\n` +
        `    src: ${JSON.stringify(a[n])}\n` +
        `    out: ${JSON.stringify(b[n])}`,
      'DIFF',
    );
  }

  try {
    main();
  } catch (err) {
    reportError(err);
  }
}
