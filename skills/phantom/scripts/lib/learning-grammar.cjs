// Author: Subash Karki
// learning-grammar.cjs -- the pure, dependency-free grammar for the auto-learning
// files (INDEX.md's `## Auto-Captured` section, auto-captures.md, and graduated
// domain files) plus the semantic MERGE used when one learnings tree is
// consolidated into another.
//
// It is the ONE representation of the learning format, shared by three runtimes so
// they never diverge:
//   * the ESM learning API (phantom-learning.mjs) imports it via createRequire, so
//     capture/consolidate/graduate parse and rebuild through this grammar;
//   * the CommonJS data-root migrator (scripts/migrate-data.js) requires it to
//     merge learnings semantically under the T3 per-dir lock;
//   * the CommonJS repo-dirs steward (scripts/migrate-repo-dirs.js) requires it so a
//     branch-named orphan's learnings merge the SAME way.
//
// Pure string operations only -- no fs, no lock, no I/O -- so every caller composes
// its own atomicity and locking around it. Uses only the language, so the portable
// skill that ships this file stays standalone.

'use strict';

const AUTO_HEADER = '## Auto-Captured';
const VALIDATED_HEADER = '## Validated Patterns';

// --- auto-line grammar (one shared representation for every policy) ----------

/**
 * Parse an auto-entry line: `auto: <text> [<status>] v:N q:C u:date`.
 * Returns null when the line is not a recognized auto entry.
 */
function parseAutoLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('auto:')) return null;

  const statusMatch = trimmed.match(/\[(proposed|validated:\d+|failed)\]/);
  if (!statusMatch) return null;
  const vMatch = trimmed.match(/\bv:(\d+)\b/);
  const qMatch = trimmed.match(/\bq:([\d.]+)\b/);
  const uMatch = trimmed.match(/\bu:(\d{4}-\d{2}-\d{2})\b/);

  const textStart = trimmed.indexOf(' ') + 1;
  const textEnd = trimmed.indexOf('[' + statusMatch[1] + ']');
  const text = trimmed.slice(textStart, textEnd).trim();

  const status = statusMatch[1];
  const validatedCount = status.startsWith('validated:') ? (parseInt(status.split(':')[1], 10) || 0) : 0;

  return {
    text,
    status,
    validatedCount,
    version: parseInt(vMatch?.[1] || '0', 10),
    confidence: parseFloat(qMatch?.[1] || '0'),
    date: uMatch?.[1] || '',
    isProposed: status === 'proposed',
    isFailed: status === 'failed',
    isValidated: status.startsWith('validated:'),
  };
}

/** Serialize a parsed auto entry back to its line form. */
function serializeAutoEntry(entry) {
  return `auto: ${entry.text} [${entry.status}] v:${entry.version} q:${entry.confidence} u:${entry.date}`;
}

/** Normalize an entry key for dedup comparison. */
function normalizeKey(key) {
  return String(key).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Rebuild a parsed auto entry's derived boolean flags from a status string. */
function entryFromStatus(text, status, { version = 0, confidence = 0, date = '' } = {}) {
  const validatedCount = status.startsWith('validated:') ? (parseInt(status.split(':')[1], 10) || 0) : 0;
  return {
    text,
    status,
    validatedCount,
    version,
    confidence,
    date,
    isProposed: status === 'proposed',
    isFailed: status === 'failed',
    isValidated: status.startsWith('validated:'),
  };
}

// --- INDEX.md read / rebuild -----------------------------------------------

/**
 * Split INDEX.md into { preamble, autoLines, trailing } around the
 * `## Auto-Captured` header. `trailing` is whatever freeform content (operator
 * notes, a future section) follows the auto entries verbatim -- the first
 * non-blank line after the last parseable `auto:` line through EOF -- so
 * rebuildIndex never has to silently discard it.
 */
function parseIndex(content) {
  const idx = content.indexOf(AUTO_HEADER);
  if (idx === -1) return { preamble: content, autoLines: [], trailing: '' };
  const preamble = content.slice(0, idx);
  const rest = content.slice(idx + AUTO_HEADER.length);
  const autoLines = [];
  let pos = 0;
  let trailingStart = -1;
  while (pos <= rest.length) {
    const nl = rest.indexOf('\n', pos);
    const lineEnd = nl === -1 ? rest.length : nl;
    const line = rest.slice(pos, lineEnd);
    const parsed = parseAutoLine(line);
    if (parsed) {
      autoLines.push(parsed);
    } else if (line.trim() !== '') {
      trailingStart = pos;
      break;
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  const trailing = trailingStart === -1 ? '' : rest.slice(trailingStart);
  return { preamble, autoLines, trailing };
}

/**
 * Rebuild INDEX.md: the manual preamble is preserved (only trailing whitespace is
 * normalized), the `## Auto-Captured` section is regenerated from `autoLines`,
 * and any trailing content below the auto block (per parseIndex) is re-emitted
 * verbatim afterward -- so a rebuild never drops operator notes or a future
 * section. A pure string implementation -- unrelated sections are preserved by
 * leaving the preamble and trailing content untouched rather than by byte-diffing.
 */
function rebuildIndex(originalContent, autoLines) {
  const parsed = parseIndex(originalContent || '');
  const preamble = parsed.preamble.trimEnd();
  const trailing = parsed.trailing;
  const serialized = autoLines.map(serializeAutoEntry);
  const body = serialized.length ? `${AUTO_HEADER}\n\n${serialized.join('\n')}\n` : '';
  if (!body) {
    if (!trailing) return preamble ? `${preamble}\n` : '';
    return preamble ? `${preamble}\n\n${trailing}` : trailing;
  }
  const head = preamble ? `${preamble}\n\n${body}` : body;
  return trailing ? `${head}\n${trailing}` : head;
}

// --- semantic merge of auto entries -----------------------------------------

// Reconcile two same-key auto entries. A failure dominates (it blocks the twin);
// otherwise the merged entry carries the MAX validated count, the newest date's
// confidence/date, and the max version -- so a repeated lesson never loses count
// and memory-reader's validated-count priority stays coherent.
function mergeAutoEntries(dest, incoming) {
  const newest = (incoming.date || '') > (dest.date || '') ? incoming : dest;
  const version = Math.max(dest.version || 0, incoming.version || 0);
  if (dest.isFailed || incoming.isFailed) {
    return entryFromStatus(dest.text, 'failed', { version, confidence: newest.confidence, date: newest.date });
  }
  const validatedCount = Math.max(dest.validatedCount || 0, incoming.validatedCount || 0);
  const status = validatedCount > 0 ? `validated:${validatedCount}` : 'proposed';
  return entryFromStatus(dest.text, status, { version, confidence: newest.confidence, date: newest.date });
}

// Merge incoming auto entries into dest entries, deduping by normalized text so a
// same-key entry differing only in count/date collapses to one line (max count,
// newest date). Returns { lines, changed, added }.
function mergeAutoLines(destLines, srcLines) {
  const lines = destLines.map((entry) => ({ ...entry }));
  const indexByKey = new Map();
  lines.forEach((entry, index) => indexByKey.set(normalizeKey(entry.text), index));
  let changed = false;
  let added = 0;
  for (const incoming of srcLines) {
    const key = normalizeKey(incoming.text);
    if (indexByKey.has(key)) {
      const index = indexByKey.get(key);
      const merged = mergeAutoEntries(lines[index], incoming);
      if (serializeAutoEntry(merged) !== serializeAutoEntry(lines[index])) {
        lines[index] = merged;
        changed = true;
      }
    } else {
      indexByKey.set(key, lines.length);
      lines.push({ ...incoming });
      changed = true;
      added += 1;
    }
  }
  return { lines, changed, added };
}

// --- learnings merges (one entry point per file class) ----------------------

/**
 * Merge a source INDEX.md into the destination through the auto-line grammar: the
 * dest preamble wins, auto entries merge by key (single `## Auto-Captured`
 * header, no duplicate keys). Returns { content, changed, added }.
 */
function mergeIndexContent(destContent, srcContent) {
  const dest = parseIndex(destContent || '');
  const src = parseIndex(srcContent || '');
  const { lines, changed, added } = mergeAutoLines(dest.autoLines, src.autoLines);
  if (!changed) return { content: destContent, changed: false, added: 0 };
  return { content: rebuildIndex(destContent, lines), changed: true, added };
}

function parseAutoEntries(content) {
  const entries = [];
  for (const line of (content || '').split('\n')) {
    const parsed = parseAutoLine(line);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

// The header/preamble of auto-captures.md is everything up to the first entry line.
function autoCapturesPreamble(content) {
  const out = [];
  for (const line of (content || '').split('\n')) {
    if (parseAutoLine(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Merge a source auto-captures.md into the destination: preserve the dest header,
 * merge entries by key (same reconciliation as the index), and re-emit one entry
 * per key so the staging file never grows a second header. Returns
 * { content, changed, added }.
 */
function mergeAutoCapturesContent(destContent, srcContent) {
  const { lines, changed, added } = mergeAutoLines(
    parseAutoEntries(destContent),
    parseAutoEntries(srcContent),
  );
  if (!changed) return { content: destContent, changed: false, added: 0 };
  const preamble = autoCapturesPreamble(destContent).replace(/\s*$/, '');
  const body = lines.map(serializeAutoEntry).join('\n');
  const content = preamble ? `${preamble}\n\n${body}\n` : `${body}\n`;
  return { content, changed: true, added };
}

// Insert validated-pattern bullets under the single `## Validated Patterns`
// header, creating the header once if the file has none.
function insertUnderValidatedHeader(content, bullets) {
  const block = bullets.join('\n');
  const idx = content.indexOf(VALIDATED_HEADER);
  if (idx === -1) {
    const base = content.replace(/\s*$/, '');
    return `${base ? `${base}\n\n` : ''}${VALIDATED_HEADER}\n\n${block}\n`;
  }
  const afterHeader = idx + VALIDATED_HEADER.length;
  const nextSection = content.indexOf('\n## ', afterHeader + 1);
  const insertAt = nextSection === -1 ? content.length : nextSection;
  const before = content.slice(0, insertAt).replace(/\s*$/, '');
  const after = content.slice(insertAt);
  return `${before}\n${block}\n${after}`;
}

/**
 * Merge a source domain file into the destination. The source's title and section
 * headers are stripped (so the dest never grows a duplicate `## Validated Patterns`
 * header or a mid-file title); validated-pattern bullets land under the single
 * dest header, and remaining content lines (corrections, notes) append once,
 * deduped and source-attributed. Returns { content, changed, added }.
 */
function mergeDomainContent(destContent, srcContent, sourceLabel) {
  const destLines = new Set((destContent || '').split('\n'));
  const validatedBullets = [];
  const otherLines = [];
  for (const line of (srcContent || '').split('\n')) {
    if (!line.trim()) continue;
    if (/^#{1,6}\s/.test(line)) continue; // strip the source title and section headers
    if (destLines.has(line)) continue; // never duplicate an existing line
    if (/^\s*-\s/.test(line) && line.includes('[validated:')) validatedBullets.push(line);
    else otherLines.push(line);
  }
  const added = validatedBullets.length + otherLines.length;
  if (added === 0) return { content: destContent || '', changed: false, added: 0 };

  let content = destContent || '';
  if (validatedBullets.length) content = insertUnderValidatedHeader(content, validatedBullets);
  if (otherLines.length) {
    const base = content.replace(/\s*$/, '');
    const attribution = sourceLabel
      ? `\n\n<!-- merged from ${sourceLabel} (append-only, ${otherLines.length} new lines) -->\n`
      : '\n\n';
    content = `${base}${attribution}${otherLines.join('\n')}\n`;
  }
  return { content, changed: true, added };
}

/**
 * Merge one source learnings .md into the destination, routed by file class:
 * INDEX.md and auto-captures.md through the auto-line grammar; every other .md
 * (graduated domain files, and any manual file) through the domain merge. Returns
 * { content, changed, added }; callers own locking and the atomic write.
 */
function mergeLearningContent(fileName, destContent, srcContent, sourceLabel) {
  if (fileName === 'INDEX.md') return mergeIndexContent(destContent, srcContent);
  if (fileName === 'auto-captures.md') return mergeAutoCapturesContent(destContent, srcContent);
  return mergeDomainContent(destContent, srcContent, sourceLabel);
}

module.exports = {
  AUTO_HEADER,
  VALIDATED_HEADER,
  parseAutoLine,
  serializeAutoEntry,
  normalizeKey,
  parseIndex,
  rebuildIndex,
  mergeAutoLines,
  mergeIndexContent,
  mergeAutoCapturesContent,
  mergeDomainContent,
  mergeLearningContent,
};
