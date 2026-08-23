// Author: Subash Karki
// brain-backfill.test.js — EXECUTED fixture tests (per [executed-review]): builds
// a real temp GORKHALI_DATA world (wrap.json / learnings / costs.json + a fake
// transcript), runs the backfill for effect, and asserts the cards on disk +
// their retrievability via the T4 grep recipes. Zero external deps.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const backfill = require('../scripts/brain-backfill');
const brain = require('../scripts/lib/brain-card');

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function writeJson(p, o) { mkdirp(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(o, null, 2)); }
function write(p, s) { mkdirp(path.dirname(p)); fs.writeFileSync(p, s); }

const REPO = 'feature-web-apps';
const SID = 'aaaa1111-2222-3333-4444-555555555555';

/** Build an isolated GORKHALI_DATA world and return env + paths. */
function buildWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  const DATA = path.join(root, 'data');
  const projects = path.join(root, 'projects');
  const base = path.join(DATA, 'repos', REPO);

  // Tier1 source: a rich wrap.json with a PR + costs.json → transcript.
  writeJson(path.join(base, 'sessions', 'CP-43208', 'wrap.json'), {
    _meta: { writtenAt: '2026-06-15', gitHead: 'cdb231919', gitBranch: 'cp-43208-pagination' },
    reviewPanel: { perspectives: { architecture: 'cursor encodes limit; cost_totals = grand total' } },
    fixesAfterReview: ['Split isError vs isFetchNextPageError'],
    pr: { number: 1321, url: 'https://github.com/Cloudzero/feature-web-apps/pull/1321' },
    jira: { ticket: 'CP-43208' },
    outcome: 'Additive pagination shipped with load-more retry',
    learnings: { recorded: ['additive-pagination-split'] },
    filesChanged: ['src/table.tsx'],
  });
  writeJson(path.join(base, 'sessions', 'CP-43208', 'costs.json'),
    { ticket: 'CP-43208', entries: [{ session_id: SID, opened_at: 'x' }] });
  // The transcript the session_id resolves to (content irrelevant — never read).
  write(path.join(projects, '-Users-x-CZ-feature-web-apps', SID + '.jsonl'), '{"x":1}\n');

  // Tier1 source: a corrupt wrap.json — must be skipped, not fatal.
  write(path.join(base, 'sessions', 'CP-BROKEN', 'wrap.json'), '{ not json');

  // Tier1 source: a completed/ wrap with ship.pr shape + no jira ticket.
  writeJson(path.join(base, 'completed', 'discovery', 'wrap.json'), {
    _meta: { writtenAt: '2026-06-01', gitHead: 'abc0001' },
    ship: { pr: null }, outcome: 'Discovery endpoint spike',
  });

  // Tier2 source: learnings with a traceable entry, a traceless entry, a CORRECTION.
  write(path.join(base, 'learnings', 'data.md'), [
    '# Data learnings',
    '',
    '### Filter empty row vanishing (CP-39160)',
    'Empty filter rows disappeared because the reducer dropped falsy keys. (CP-39160)',
    '',
    '### Generic tip with no ticket',
    'Always memoize selectors. This entry has no ticket ref, so ZERO cards.',
    '',
    '### CORRECTION [403-sigv4] (CP-42655)',
    'Was "wrong service URL" — actually "route not deployed" (2026-05-28)',
  ].join('\n'));
  // INDEX.md must be ignored even though it has a ticket ref.
  write(path.join(base, 'learnings', 'INDEX.md'), '### Index (CP-99999)\nmeta only');
  // A real session dir for the CORRECTION ticket → trace.session points at it.
  mkdirp(path.join(base, 'sessions', 'CP-42655'));

  return {
    root,
    env: { GORKHALI_DATA: DATA, GORKHALI_PROJECTS_DIR: projects },
    DATA, base, projects,
  };
}

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try { return fn(); }
  finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

function cleanup(root) { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {} }
function cardsDir(base) { return path.join(base, 'brain', 'cards'); }
function listCards(base) { try { return fs.readdirSync(cardsDir(base)); } catch (_) { return []; } }

// ---------------------------------------------------------------------------

test('dry-run writes no cards and no manifest, but counts candidates', () => {
  const w = buildWorld();
  try {
    const rep = withEnv(w.env, () => backfill.run(['--repo', REPO]));
    assert.equal(rep.mode, 'dry-run');
    assert.ok(rep.repos[REPO].tier1.candidates >= 2, 'both valid wraps counted');
    assert.equal(listCards(w.base).length, 0, 'no card files written in dry-run');
    assert.ok(!fs.existsSync(path.join(w.base, 'brain', 'backfill-manifest.json')), 'no manifest in dry-run');
  } finally { cleanup(w.root); }
});

test('Tier1 --apply: episode card with valid trace, retrievable via T4 recipe', () => {
  const w = buildWorld();
  try {
    withEnv(w.env, () => backfill.run(['--repo', REPO, '--tiers', '1', '--apply']));

    // The CP-43208 card exists and parses.
    const expectId = brain.makeCardId({
      repo: REPO, ticket: 'CP-43208', date: '2026-06-15',
      title: 'CP-43208: Additive pagination shipped with load-more retry',
    });
    const file = path.join(cardsDir(w.base), expectId + '.md');
    assert.ok(fs.existsSync(file), 'CP-43208 card written');
    const card = brain.parseCard(fs.readFileSync(file, 'utf8'));
    assert.equal(card.type, 'episode');
    assert.equal(card.ticket, 'CP-43208');
    assert.match(card.trace.pr, /pull\/1321$/);
    assert.equal(card.trace.commit, 'cdb231919');

    // trace pointers exist on disk.
    assert.ok(fs.existsSync(card.trace.session), 'trace.session dir exists');
    assert.ok(fs.existsSync(card.trace.transcript), 'trace.transcript jsonl exists (resolved via costs.json)');
    assert.match(card.trace.transcript, new RegExp(SID + '\\.jsonl$'));

    // Retrievable via the T4 ripgrep recipe: rg -l "^ticket: CP-43208".
    const rg = execFileSync('rg', ['-l', '^ticket: CP-43208', cardsDir(w.base)], { encoding: 'utf8' }).trim();
    assert.equal(rg, file, 'card is grep-retrievable by ticket');
  } finally { cleanup(w.root); }
});

test('Tier1: corrupt wrap.json is skipped (counted as error), never aborts', () => {
  const w = buildWorld();
  try {
    const rep = withEnv(w.env, () => backfill.run(['--repo', REPO, '--tiers', '1', '--apply']));
    assert.ok(rep.repos[REPO].tier1.errors >= 1, 'corrupt wrap counted as error');
    // The two healthy wraps still produced cards.
    assert.ok(rep.repos[REPO].tier1.written >= 2, 'healthy wraps still written despite the corrupt one');
  } finally { cleanup(w.root); }
});

test('Tier2: only ticket-referenced entries become cards; traceless => zero', () => {
  const w = buildWorld();
  try {
    withEnv(w.env, () => backfill.run(['--repo', REPO, '--tiers', '2', '--apply']));
    const cards = listCards(w.base).map(f => brain.parseCard(fs.readFileSync(path.join(cardsDir(w.base), f), 'utf8')));
    const tickets = cards.map(c => c.ticket).sort();
    assert.deepEqual(tickets, ['CP-39160', 'CP-42655'], 'traceless + INDEX entries excluded');

    const correction = cards.find(c => c.ticket === 'CP-42655');
    assert.equal(correction.type, 'gotcha', 'CORRECTION entry -> gotcha');
    assert.ok(correction.trace.session.endsWith(path.join('sessions', 'CP-42655')), 'trace points at the ticket session dir');

    const pattern = cards.find(c => c.ticket === 'CP-39160');
    assert.equal(pattern.type, 'pattern', 'header entry -> pattern');
    assert.ok(pattern.trace.session.endsWith('data.md'), 'no session dir -> trace points at learnings file');
  } finally { cleanup(w.root); }
});

test('re-run is idempotent: second --apply writes nothing new, all skipped', () => {
  const w = buildWorld();
  try {
    withEnv(w.env, () => backfill.run(['--repo', REPO, '--apply']));
    const first = listCards(w.base).slice().sort();
    const rep2 = withEnv(w.env, () => backfill.run(['--repo', REPO, '--apply']));
    const second = listCards(w.base).slice().sort();
    assert.deepEqual(second, first, 'no new card files on re-run');
    assert.equal(rep2.repos[REPO].tier1.written, 0, 'tier1 wrote nothing on re-run');
    assert.ok(rep2.repos[REPO].tier1.skipped >= 2, 'tier1 counted existing cards as skipped');
  } finally { cleanup(w.root); }
});

test('Tier3 --apply: manifest maps ticket -> transcript without reading content', () => {
  const w = buildWorld();
  try {
    const rep = withEnv(w.env, () => backfill.run(['--repo', REPO, '--tiers', '3', '--apply']));
    const manifestPath = path.join(w.base, 'brain', 'backfill-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest written on --apply');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entry = manifest.tickets.find(t => t.ticket === 'CP-43208');
    assert.ok(entry, 'CP-43208 in manifest');
    assert.equal(entry.transcripts.length, 1, 'one transcript resolved');
    assert.match(entry.transcripts[0], new RegExp(SID + '\\.jsonl$'));
    assert.ok(rep.repos[REPO].tier3.transcripts >= 1);
  } finally { cleanup(w.root); }
});

test('date-less source: card id derives from source mtime, stable across re-runs (not run-date)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-mtime-'));
  const DATA = path.join(root, 'data');
  const projects = path.join(root, 'projects');
  const repo = 'mtime-repo';
  const base = path.join(DATA, 'repos', repo);
  const env = { GORKHALI_DATA: DATA, GORKHALI_PROJECTS_DIR: projects };

  // Tier1 wrap.json with NO _meta.writtenAt (and no date anywhere) — the case that
  // used to default to TODAY and mint a fresh id per run day.
  const wrapFile = path.join(base, 'sessions', 'CP-70001', 'wrap.json');
  writeJson(wrapFile, { outcome: 'Dateless wrap outcome', jira: { ticket: 'CP-70001' } });
  // Tier2 date-less learnings entry (ticket ref, but no (YYYY-MM-DD)).
  const learnFile = path.join(base, 'learnings', 'data.md');
  write(learnFile, '### Dateless pattern (CP-70002)\nA traceable entry with no date.');

  // Pin both source mtimes to a fixed past date, distinct from today (2026-*).
  const mtime = new Date('2023-01-02T03:04:05Z');
  fs.utimesSync(wrapFile, mtime, mtime);
  fs.utimesSync(learnFile, mtime, mtime);

  try {
    withEnv(env, () => backfill.run(['--repo', repo, '--apply']));

    // Both ids computed off the mtime date (2023-01-02), NOT the run date.
    const wrapId = brain.makeCardId({
      repo, ticket: 'CP-70001', date: '2023-01-02',
      title: 'CP-70001: Dateless wrap outcome',
    });
    const learnId = brain.makeCardId({
      repo, ticket: 'CP-70002', date: '2023-01-02', title: 'Dateless pattern',
    });
    assert.ok(fs.existsSync(path.join(cardsDir(base), wrapId + '.md')), 'Tier1 id from source mtime');
    assert.ok(fs.existsSync(path.join(cardsDir(base), learnId + '.md')), 'Tier2 id from source mtime');
    for (const id of [wrapId, learnId]) {
      const c = brain.parseCard(fs.readFileSync(path.join(cardsDir(base), id + '.md'), 'utf8'));
      assert.equal(c.date, '2023-01-02', 'card date = source mtime (wall-clock-independent)');
    }

    // Re-run (a later "run day" leaves mtime unchanged) => no duplicate cards.
    const before = listCards(base).slice().sort();
    const rep2 = withEnv(env, () => backfill.run(['--repo', repo, '--apply']));
    assert.deepEqual(listCards(base).slice().sort(), before, 'no duplicate cards on re-run');
    assert.equal(rep2.repos[repo].tier1.written, 0, 'tier1 wrote nothing on re-run');
    assert.equal(rep2.repos[repo].tier2.written, 0, 'tier2 wrote nothing on re-run');
  } finally { cleanup(root); }
});

test('cards from both tiers coexist and every card is schema-valid', () => {
  const w = buildWorld();
  try {
    withEnv(w.env, () => backfill.run(['--repo', REPO, '--apply']));
    const files = listCards(w.base);
    assert.ok(files.length >= 4, 'tier1 + tier2 cards present');
    for (const f of files) {
      const c = brain.parseCard(fs.readFileSync(path.join(cardsDir(w.base), f), 'utf8'));
      assert.match(f, new RegExp('^' + c.id.replace('rb-', 'rb-') + '\\.md$'));
      assert.ok(['episode', 'gotcha', 'pattern', 'decision'].includes(c.type));
      assert.ok(c.ticket, 'card has a ticket');
      assert.ok(c.title, 'card has a title');
    }
  } finally { cleanup(w.root); }
});
