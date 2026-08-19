#!/usr/bin/env node
// Author: Subash Karki
// brain-backfill.js — tiered, idempotent backfill of the per-repo Linked Card
// Brain from EXISTING session artifacts. Cards are written ONLY via T3's
// brain-card.js API (makeCardId dedup = re-run safety); trace pointers are built
// from T2's resolver signals (scripts/lib/session-trace.js).
//
// Tiers (select with --tiers; default 1,2,3):
//   1  wrap.json briefs  -> episode cards      (scripted, no LLM)
//   2  learnings entries -> gotcha|pattern cards, ONLY when the entry carries a
//                           ticket reference (e.g. "(CP-43187)"). Traceless
//                           entries produce ZERO cards.
//   3  transcript MANIFEST only — maps ticket -> transcript JSONL paths WITHOUT
//      reading transcript content. Distillation is a separate bounded-parallel
//      Engineer pass driven off the manifest (see commands/evolve.md --backfill).
//
// CLI:
//   node scripts/brain-backfill.js [--repo <name>] [--tiers 1,2] [--apply]
//   (default: DRY-RUN — reports counts, writes nothing. --apply writes cards +
//    the Tier3 manifest.)
//
// Per-source guard (per [guards]): one corrupt wrap.json / learnings file is
// skipped and counted, never aborts the run.

'use strict';

const fs = require('fs');
const path = require('path');

const { phantomData, repoDir } = require('./lib/phantom-paths');
const { collectSessionIds, findTranscript, projectsRoot } = require('./lib/session-trace');
const brain = require('./lib/brain-card');

const TICKET_RE = /\b((?:CP|CLOUD|CLOUDINT)-\d+)\b/i;
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;
const IGNORED_LEARNINGS = new Set(['INDEX.md', 'EDGES.md']);

// --- fs helpers --------------------------------------------------------------

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }

/** Deterministic YYYY-MM-DD from a source file's mtime — the wall-clock-independent
 *  fallback for date-less sources. Hashing the run date into makeCardId would mint a
 *  fresh id (thus a duplicate card) on every re-run day; the source mtime is stable. */
function mtimeDate(file) {
  try { return fs.statSync(file).mtime.toISOString().slice(0, 10); } catch (_) { return undefined; }
}

/** Immediate `<parent>/<child>/<file>` matches (e.g. sessions/<t>/wrap.json). */
function childArtifacts(parentDir, file) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(parentDir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const f = path.join(parentDir, e.name, file);
    if (fs.existsSync(f)) out.push({ dir: path.join(parentDir, e.name), name: e.name, file: f });
  }
  return out;
}

/** Every session dir holding a wrap.json across sessions/ + completed/. */
function wrapSources(repo) {
  const base = repoDir(repo);
  return [
    ...childArtifacts(path.join(base, 'completed'), 'wrap.json'),
    ...childArtifacts(path.join(base, 'sessions'), 'wrap.json'),
  ];
}

// --- narrative extraction (heterogeneous wrap.json shapes) -------------------

function asText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('; ');
  if (typeof v === 'object') return Object.values(v).map(asText).filter(Boolean).join('; ');
  return String(v);
}

function firstLine(s) {
  const line = String(s || '').split(/[.\n;]/)[0].trim();
  return line.slice(0, 90);
}

/** PR url across the shapes seen in the wild: pr{url}|pr(string)|ship.pr|companionPr. */
function prUrl(wrap) {
  const cands = [wrap.pr, wrap.ship && wrap.ship.pr, wrap.companionPr];
  for (const c of cands) {
    if (!c) continue;
    if (typeof c === 'string') { if (/^https?:\/\//.test(c)) return c; }
    else if (typeof c === 'object' && c.url) return c.url;
  }
  return '';
}

function whyFromWrap(wrap) {
  const parts = [];
  const push = (label, v) => { const t = asText(v); if (t) parts.push(`${label}: ${t}`); };
  push('Brief', wrap.brief);
  push('Summary', wrap.summary);
  push('Decisions', wrap.decisions);
  if (wrap.learnings) push('Decisions', wrap.learnings.decisions);
  if (wrap.reviewPanel && wrap.reviewPanel.perspectives) {
    push('Architecture', wrap.reviewPanel.perspectives.architecture);
    push('Skeptic', wrap.reviewPanel.perspectives.skeptic);
  }
  push('Fixes after review', wrap.fixesAfterReview);
  return parts.join('\n');
}

function recordedLearnings(wrap) {
  return wrap.learnings && Array.isArray(wrap.learnings.recorded)
    ? wrap.learnings.recorded.map(asText).filter(Boolean)
    : [];
}

function whatFromWrap(wrap) {
  const head = asText(wrap.outcome) || asText(wrap.summary) || asText(wrap.brief);
  const recorded = recordedLearnings(wrap);
  const lines = [];
  if (head) lines.push(head);
  if (recorded.length) lines.push('Learnings: ' + recorded.join('; '));
  return lines.join('\n');
}

/** A human title phrase for the card: prefer a real narrative field, then the
 *  first recorded learning / fix, before falling back. Never the "Learnings:"
 *  label prefix (that pollutes keyword search). */
function titlePhrase(wrap) {
  const head = asText(wrap.outcome) || asText(wrap.summary) || asText(wrap.brief);
  if (head) return firstLine(head);
  const recorded = recordedLearnings(wrap);
  if (recorded.length) return firstLine(recorded[0]);
  const fixes = asText(wrap.fixesAfterReview);
  if (fixes) return firstLine(fixes);
  return 'session wrap';
}

/** Transcript path for a session dir via its costs.json session ids (no content read). */
function transcriptForSession(sessionDir, projectsDir) {
  const costs = path.join(sessionDir, 'costs.json');
  const ids = collectSessionIds(fs.existsSync(costs) ? [costs] : []);
  for (const sid of ids) {
    const t = findTranscript(sid, projectsDir);
    if (t) return t;
  }
  return '';
}

// --- Tier 1: wrap.json -> episode cards --------------------------------------

/** Build one episode card object from a wrap.json + its context. Pure. */
function cardFromWrap(wrap, { repo, sessionDir, sessionName, projectsDir, sourceFile }) {
  const meta = wrap._meta || {};
  const ticket = (wrap.jira && wrap.jira.ticket) || (typeof wrap.ticket === 'string' && wrap.ticket) || sessionName;
  const date = String(meta.writtenAt || '').slice(0, 10) || mtimeDate(sourceFile);
  const what = whatFromWrap(wrap);
  const title = `${ticket}: ${titlePhrase(wrap)}`;
  const files = Array.isArray(wrap.filesChanged) ? wrap.filesChanged.map(String) : [];
  return {
    ticket,
    title,
    type: 'episode',
    date,
    files,
    what,
    why: whyFromWrap(wrap),
    trace: {
      session: sessionDir,
      transcript: transcriptForSession(sessionDir, projectsDir),
      pr: prUrl(wrap),
      commit: meta.gitHead || '',
    },
  };
}

// --- Tier 2: learnings entries -> gotcha|pattern cards (traceable only) -------

/** Split a learnings .md into `### `-delimited entries. Preamble before the first
 *  header is dropped (it is meta, not a traceable entry). */
function splitLearningEntries(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const h = /^###\s+(.+)$/.exec(line);
    if (h) {
      if (cur) entries.push(cur);
      cur = { title: h[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) entries.push(cur);
  return entries.map(e => ({ title: e.title, body: e.body.join('\n').trim() }));
}

/** Cards from one learnings file. Only ticket-referenced entries yield cards. */
function cardsFromLearnings(text, { repo, learningsFile, projectsDir }) {
  const base = repoDir(repo);
  const out = [];
  for (const entry of splitLearningEntries(text)) {
    const blob = `${entry.title}\n${entry.body}`;
    const tm = blob.match(TICKET_RE);
    if (!tm) continue; // ZERO cards without a trace.
    const ticket = tm[1].toUpperCase();
    const dm = blob.match(DATE_RE);
    const isCorrection = /\bCORRECTION\b/i.test(blob);
    const sessionDir = path.join(base, 'sessions', ticket);
    const hasSession = isDir(sessionDir);
    const title = entry.title.replace(/\s*\((?:CP|CLOUD|CLOUDINT)-\d+\)\s*$/i, '').trim() || ticket;
    out.push({
      ticket,
      title,
      type: isCorrection ? 'gotcha' : 'pattern',
      date: dm ? dm[1] : mtimeDate(learningsFile),
      what: title,
      why: entry.body,
      gotchas: isCorrection ? entry.body : '',
      trace: {
        session: hasSession ? sessionDir : learningsFile,
        transcript: hasSession ? transcriptForSession(sessionDir, projectsDir) : '',
        pr: '',
        commit: '',
      },
    });
  }
  return out;
}

// --- card sink (dry-run counts vs --apply writes, both dedup-aware) ----------

function makeSink(repo, apply) {
  const stats = { candidates: 0, written: 0, skipped: 0, errors: 0 };
  return {
    stats,
    add(card) {
      stats.candidates++;
      const norm = brain.normalizeCard(card);
      const id = norm.id || brain.makeCardId({ repo, ticket: norm.ticket, date: norm.date, title: norm.title });
      const exists = fs.existsSync(brain.cardPath(repo, id));
      if (exists) { stats.skipped++; return { id, action: 'skip' }; }
      if (!apply) { stats.written++; return { id, action: 'would-write' }; }
      try {
        brain.writeCard(card, { repo });
        stats.written++;
        return { id, action: 'write' };
      } catch (e) {
        stats.errors++;
        return { id, action: 'error', error: e.message };
      }
    },
  };
}

function runTier1(repo, apply, projectsDir) {
  const sink = makeSink(repo, apply);
  for (const src of wrapSources(repo)) {
    const wrap = readJson(src.file);
    if (!wrap || typeof wrap !== 'object') { sink.stats.errors++; continue; }
    try {
      sink.add(cardFromWrap(wrap, { repo, sessionDir: src.dir, sessionName: src.name, projectsDir, sourceFile: src.file }));
    } catch (_) { sink.stats.errors++; }
  }
  return sink.stats;
}

function runTier2(repo, apply, projectsDir) {
  const sink = makeSink(repo, apply);
  const dir = path.join(repoDir(repo), 'learnings');
  let files;
  try { files = fs.readdirSync(dir); } catch (_) { files = []; }
  for (const name of files) {
    if (path.extname(name) !== '.md' || IGNORED_LEARNINGS.has(name)) continue;
    const learningsFile = path.join(dir, name);
    let text;
    try { text = fs.readFileSync(learningsFile, 'utf8'); } catch (_) { sink.stats.errors++; continue; }
    let cards;
    try { cards = cardsFromLearnings(text, { repo, learningsFile, projectsDir }); } catch (_) { sink.stats.errors++; continue; }
    for (const c of cards) sink.add(c);
  }
  return sink.stats;
}

/** Tier 3: build (and, on --apply, write) the ticket->transcripts manifest.
 *  Reads costs.json only — never the transcript body. */
function runTier3(repo, apply, projectsDir) {
  const base = repoDir(repo);
  const seen = new Set();
  const tickets = [];
  let transcriptCount = 0;
  const sources = [
    ...childArtifacts(path.join(base, 'completed'), 'costs.json'),
    ...childArtifacts(path.join(base, 'sessions'), 'costs.json'),
  ];
  for (const src of sources) {
    if (seen.has(src.name)) continue;
    seen.add(src.name);
    const ids = collectSessionIds([src.file]);
    const transcripts = ids.map(sid => findTranscript(sid, projectsDir)).filter(Boolean);
    transcriptCount += transcripts.length;
    tickets.push({ ticket: src.name, sessionDir: src.dir, sessionIds: ids, transcripts });
  }
  const manifestPath = path.join(base, 'brain', 'backfill-manifest.json');
  const manifest = { repo, generatedFrom: 'costs.json session ids (no transcript content read)', tickets };
  if (apply) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
  return { tickets: tickets.length, transcripts: transcriptCount, manifestPath, written: apply };
}

// --- repo enumeration + entry point ------------------------------------------

function allRepos() {
  const root = path.join(phantomData(), 'repos');
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return []; }
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map(e => e.name)
    .filter(name => !name.endsWith('.migrated-away'));
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  let repo = null;
  let tiers = [1, 2, 3];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repo = argv[i + 1] || null;
    else if (argv[i].startsWith('--repo=')) repo = argv[i].slice('--repo='.length) || null;
    else if (argv[i] === '--tiers') tiers = parseTiers(argv[i + 1]);
    else if (argv[i].startsWith('--tiers=')) tiers = parseTiers(argv[i].slice('--tiers='.length));
  }
  return { apply, repo, tiers };
}

function parseTiers(raw) {
  if (!raw) return [1, 2, 3];
  const set = new Set(String(raw).split(',').map(s => parseInt(s.trim(), 10)).filter(n => [1, 2, 3].includes(n)));
  return set.size ? [...set].sort() : [1, 2, 3];
}

function run(argv = process.argv.slice(2)) {
  const { apply, repo, tiers } = parseArgs(argv);
  const projectsDir = projectsRoot();
  const repos = repo ? [repo] : allRepos();
  const report = { mode: apply ? 'apply' : 'dry-run', at: new Date().toISOString(), tiers, repos: {} };
  for (const r of repos) {
    const per = {};
    if (tiers.includes(1)) per.tier1 = runTier1(r, apply, projectsDir);
    if (tiers.includes(2)) per.tier2 = runTier2(r, apply, projectsDir);
    if (tiers.includes(3)) per.tier3 = runTier3(r, apply, projectsDir);
    report.repos[r] = per;
  }
  return report;
}

module.exports = {
  run,
  cardFromWrap,
  cardsFromLearnings,
  splitLearningEntries,
  prUrl,
  runTier1,
  runTier2,
  runTier3,
};

if (require.main === module) {
  const report = run();
  const fmt = (t) => t ? `cand=${t.candidates} write=${t.written} skip=${t.skipped} err=${t.errors}` : '-';
  console.log(`brain-backfill [${report.mode}] tiers=${report.tiers.join(',')}`);
  for (const [r, per] of Object.entries(report.repos)) {
    const bits = [];
    if (per.tier1) bits.push(`T1(${fmt(per.tier1)})`);
    if (per.tier2) bits.push(`T2(${fmt(per.tier2)})`);
    if (per.tier3) bits.push(`T3(tickets=${per.tier3.tickets} transcripts=${per.tier3.transcripts}${per.tier3.written ? ' →manifest' : ''})`);
    console.log(`  ${r}: ${bits.join(' ')}`);
  }
  process.exit(0);
}
