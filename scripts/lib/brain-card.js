// Author: Subash Karki
// brain-card.js — pure library for the per-repo Linked Card Brain.
// Distilled knowledge cards live at <data>/repos/{repo}/brain/cards/{id}.md as
// markdown + a flat, grep-friendly YAML frontmatter (one key per line — T4 rg
// recipes target it). No external deps: hand-rolled emit/parse for the FROZEN
// schema below. Atomic writes via write-to-tmp + fs.renameSync (same-dir tmp).
//
// FROZEN schema (contract T3 — T4/T5/T6 build on it):
//   frontmatter: id, ticket, title, type(episode|decision|gotcha|pattern),
//     status(active|superseded), date, superseded_by?, files[],
//     edges[{relates_to|supersedes|caused_by: rb-*}], trace{session,transcript,pr,commit}
//   body: '## What', '## Why (and what we rejected)', '## Gotchas'
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveRepoSubdir } = require('./phantom-paths');

// md-grammar lets a read-modify-write (supersede) rewrite ONLY the frontmatter while
// the human-authored body prose (## What / ## Why / ## Gotchas) keeps its exact bytes
// instead of being trimmed and re-flowed through renderCard. LOAD-FAILURE fallback:
// absent/broken → the full renderCard re-render, so a card write never crashes.
let mdGrammar = null;
try {
  mdGrammar = require('./md-grammar');
} catch (_) { /* fail open: md-grammar missing → full-card re-render below */ }

const EDGE_KINDS = ['relates_to', 'supersedes', 'caused_by'];
const TRACE_KEYS = ['session', 'transcript', 'pr', 'commit'];
const CARD_TYPES = ['episode', 'decision', 'gotcha', 'pattern'];
const ID_RE = /^rb-[0-9a-f]{6}$/;

/**
 * Cards dir for a repo: <data>/repos/{repo}/brain/cards, or the aliased dir that
 * actually holds the cards. Alias-aware because detectRepo() returns the CANONICAL
 * id while existing cards can still sit under an earlier id (see resolveRepoSubdir):
 * a bare join greps an empty dir and recall silently reports no matches.
 */
function cardsDir(repo) {
  return resolveRepoSubdir(repo, 'brain', 'cards');
}

/** Absolute path to a card file. Rejects any id that isn't rb-<6hex> — the
 * only defense between an attacker-controlled id and a path-traversal write. */
function cardPath(repo, id) {
  if (!ID_RE.test(id)) throw new Error(`brain-card: invalid card id: ${JSON.stringify(id)}`);
  return path.join(cardsDir(repo), `${id}.md`);
}

/**
 * Deterministic, merge-safe card id: rb-<6hex> of sha256(repo+ticket+date+title).
 * Same inputs -> same id (that IS the dedup); distinct (repo,ticket,date,title)
 * tuples across concurrent worktrees cannot collide.
 */
function makeCardId({ repo, ticket, date, title }) {
  const digest = crypto
    .createHash('sha256')
    .update([repo, ticket, date, title].join('\0'), 'utf8')
    .digest('hex');
  return 'rb-' + digest.slice(0, 6);
}

// --- minimal YAML for the flat card schema -----------------------------------

// Quote only when a bare scalar would be ambiguous; keeps the common case
// (paths, ids, plain titles) unquoted and greppable.
function needsQuote(s) {
  return s === '' || /[:#[\]{}",]|^[\s>|&*!?%@`-]|\s$|\n/.test(s);
}
function emitScalar(v) {
  const s = v == null ? '' : String(v);
  return needsQuote(s) ? JSON.stringify(s) : s;
}
function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if (s[0] === '"') {
    try { return JSON.parse(s); } catch { return s; }
  }
  return s;
}

function normalizeCard(input) {
  const c = input || {};
  const edges = Array.isArray(c.edges)
    ? c.edges.filter(e => e && typeof e === 'object' && Object.keys(e).length)
    : [];
  const trace = {};
  for (const k of TRACE_KEYS) trace[k] = (c.trace && c.trace[k]) || '';
  return {
    id: c.id || '',
    ticket: c.ticket || '',
    title: c.title || '',
    type: CARD_TYPES.includes(c.type) ? c.type : 'episode',
    status: c.status === 'superseded' ? 'superseded' : 'active',
    date: c.date || new Date().toISOString().slice(0, 10),
    superseded_by: c.superseded_by || '',
    files: Array.isArray(c.files) ? c.files.map(String) : [],
    edges,
    trace,
    what: c.what || '',
    why: c.why || '',
    gotchas: c.gotchas || '',
  };
}

function renderFrontmatter(c) {
  const lines = ['---'];
  lines.push(`id: ${emitScalar(c.id)}`);
  lines.push(`ticket: ${emitScalar(c.ticket)}`);
  lines.push(`title: ${emitScalar(c.title)}`);
  lines.push(`type: ${c.type}`);
  lines.push(`status: ${c.status}`);
  lines.push(`date: ${emitScalar(c.date)}`);
  if (c.superseded_by) lines.push(`superseded_by: ${emitScalar(c.superseded_by)}`);

  if (c.files.length === 0) lines.push('files: []');
  else {
    lines.push('files:');
    for (const f of c.files) lines.push(`  - ${emitScalar(f)}`);
  }

  if (c.edges.length === 0) lines.push('edges: []');
  else {
    lines.push('edges:');
    for (const e of c.edges) {
      const [k, v] = Object.entries(e)[0];
      lines.push(`  - ${k}: ${emitScalar(v)}`);
    }
  }

  lines.push('trace:');
  for (const k of TRACE_KEYS) lines.push(`  ${k}: ${emitScalar(c.trace[k])}`);

  lines.push('---');
  return lines.join('\n');
}

/** Full card markdown string. Requires c.id already set. */
function renderCard(input) {
  const c = normalizeCard(input);
  return [
    renderFrontmatter(c),
    '',
    '## What',
    '',
    c.what.trim(),
    '',
    '## Why (and what we rejected)',
    '',
    c.why.trim(),
    '',
    '## Gotchas',
    '',
    c.gotchas.trim(),
    '',
  ].join('\n');
}

function parseFrontmatter(fmLines) {
  const obj = {};
  let i = 0;
  while (i < fmLines.length) {
    const line = fmLines[i];
    if (!line.trim()) { i++; continue; }
    const m = /^(\S[^:]*):\s?(.*)$/.exec(line);
    if (!m) { i++; continue; }
    const key = m[1].trim();
    const rest = m[2];
    if (rest === '[]') { obj[key] = []; i++; continue; }
    if (rest !== '') { obj[key] = parseScalar(rest); i++; continue; }

    // Block scalar: gather indented child lines.
    const block = [];
    i++;
    while (i < fmLines.length && /^\s+\S/.test(fmLines[i])) { block.push(fmLines[i]); i++; }
    if (block.length && /^\s*-\s/.test(block[0])) {
      obj[key] = block.map(bl => {
        const item = bl.replace(/^\s*-\s?/, '');
        const im = /^([^:]+):\s?(.*)$/.exec(item);
        return im ? { [im[1].trim()]: parseScalar(im[2]) } : parseScalar(item);
      });
    } else {
      const sub = {};
      for (const bl of block) {
        const bm = /^\s*([^:]+):\s?(.*)$/.exec(bl);
        if (bm) sub[bm[1].trim()] = parseScalar(bm[2]);
      }
      obj[key] = sub;
    }
  }
  return obj;
}

function parseBody(bodyLines) {
  const out = { what: '', why: '', gotchas: '' };
  let current = null;
  const buf = { what: [], why: [], gotchas: [] };
  for (const line of bodyLines) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      const title = h[1].trim().toLowerCase();
      if (title.startsWith('what')) current = 'what';
      else if (title.startsWith('why')) current = 'why';
      else if (title.startsWith('gotcha')) current = 'gotchas';
      else current = null;
      continue;
    }
    if (current) buf[current].push(line);
  }
  for (const k of Object.keys(out)) out[k] = buf[k].join('\n').trim();
  return out;
}

/** Parse a card markdown string back into a normalized card object. */
function parseCard(content) {
  const text = String(content).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (start === -1) start = i;
      else { end = i; break; }
    }
  }
  const fm = start !== -1 && end !== -1 ? parseFrontmatter(lines.slice(start + 1, end)) : {};
  const body = parseBody(end !== -1 ? lines.slice(end + 1) : lines);
  return normalizeCard({ ...fm, ...body });
}

/**
 * writeCard(card, { repo }) -> { id, file, card }.
 * Computes id from (repo,ticket,date,title) when absent. Creates the cards dir
 * and writes atomically. THROWS on IO failure — callers in wrap/close guard the
 * RUN (never block the ship on a brain-write); see commands/wrap.md.
 */
function writeCard(card, { repo } = {}) {
  if (!repo) throw new Error('writeCard: repo is required');
  const c = normalizeCard(card);
  if (!c.id || !ID_RE.test(c.id)) {
    c.id = makeCardId({ repo, ticket: c.ticket, date: c.date, title: c.title });
  }
  // One cardsDir() resolution, not two: it now reads the filesystem, so resolving
  // separately for the mkdir and for the file could mkdir one dir and write in another.
  const file = cardPath(repo, c.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, renderCard(c), 'utf8');
  fs.renameSync(tmp, file);
  return { id: c.id, file, card: c };
}

/** Read + parse a card by id, or null if absent/unreadable. */
function readCard(repo, id) {
  try {
    return parseCard(fs.readFileSync(cardPath(repo, id), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Re-render ONLY the frontmatter of an existing card, keeping the human-authored body
 * prose byte-for-byte via md-grammar. Everything before the first `## ` body section is
 * the frontmatter block; it is swapped, the body stays verbatim. Falls back to a full
 * renderCard write when md-grammar is unavailable or the file won't parse (the card's
 * id already names an existing file, so it is a valid rb-<6hex>).
 */
function rewriteFrontmatter(card, { repo }) {
  const c = normalizeCard(card);
  if (mdGrammar) {
    try {
      const file = cardPath(repo, c.id);
      const doc = mdGrammar.parse(fs.readFileSync(file, 'utf8'));
      doc.preamble = [...renderFrontmatter(c).split('\n'), ''];
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, mdGrammar.render(doc), 'utf8');
      fs.renameSync(tmp, file);
      return c;
    } catch (_) { /* fall through to a full re-render */ }
  }
  return writeCard(c, { repo }).card;
}

/**
 * supersede(oldId, newId, { repo }) — link, never delete.
 *   old: status -> superseded + `superseded_by: newId`
 *   new: append edge { supersedes: oldId }
 * Returns { old, new } written card objects. Throws if either card is missing.
 * Only the frontmatter is rewritten; each card's body prose is preserved verbatim.
 */
function supersede(oldId, newId, { repo } = {}) {
  if (!repo) throw new Error('supersede: repo is required');
  const oldCard = readCard(repo, oldId);
  const newCard = readCard(repo, newId);
  if (!oldCard) throw new Error(`supersede: old card not found: ${oldId}`);
  if (!newCard) throw new Error(`supersede: new card not found: ${newId}`);

  oldCard.status = 'superseded';
  oldCard.superseded_by = newId;

  const already = newCard.edges.some(e => e.supersedes === oldId);
  if (!already) newCard.edges.push({ supersedes: oldId });

  const oldWritten = rewriteFrontmatter(oldCard, { repo });
  const newWritten = rewriteFrontmatter(newCard, { repo });
  return { old: oldWritten, new: newWritten };
}

module.exports = {
  EDGE_KINDS,
  TRACE_KEYS,
  CARD_TYPES,
  ID_RE,
  cardsDir,
  cardPath,
  makeCardId,
  normalizeCard,
  renderCard,
  parseCard,
  writeCard,
  readCard,
  supersede,
};

// CLI — lets wrap/close emit cards as a guarded RUN (`... || true`), never
// blocking the ship. JSON card on stdin for `write`.
//   node brain-card.js write <repo>            # card JSON on stdin -> {id,file}
//   node brain-card.js supersede <repo> <old> <new>
//   node brain-card.js parse <file>            # -> card JSON
if (require.main === module) {
  const [, , cmd, ...rest] = process.argv;

  function fail(msg, code = 1) {
    process.stderr.write(`[brain-card] ${msg}\n`);
    process.exit(code);
  }

  if (cmd === 'write') {
    const repo = rest[0];
    if (!repo) fail('usage: write <repo>  (card JSON on stdin)', 2);
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { raw += d; });
    process.stdin.on('end', () => {
      let card;
      try { card = JSON.parse(raw); } catch (e) { fail(`invalid JSON on stdin: ${e.message}`); }
      try {
        const { id, file } = writeCard(card, { repo });
        process.stdout.write(JSON.stringify({ id, file }) + '\n');
      } catch (e) { fail(`write failed: ${e.message}`); }
    });
  } else if (cmd === 'supersede') {
    const [repo, oldId, newId] = rest;
    if (!repo || !oldId || !newId) fail('usage: supersede <repo> <oldId> <newId>', 2);
    try {
      const r = supersede(oldId, newId, { repo });
      process.stdout.write(JSON.stringify({ old: r.old.id, new: r.new.id }) + '\n');
    } catch (e) { fail(`supersede failed: ${e.message}`); }
  } else if (cmd === 'parse') {
    const file = rest[0];
    if (!file) fail('usage: parse <file>', 2);
    try {
      process.stdout.write(JSON.stringify(parseCard(fs.readFileSync(file, 'utf8')), null, 2) + '\n');
    } catch (e) { fail(`parse failed: ${e.message}`); }
  } else {
    fail('usage: write <repo> | supersede <repo> <old> <new> | parse <file>', 2);
  }
}
