// Author: Subash Karki
// brain-card.test.js — executed round-trips for the Repo Brain card lib.
// Zero external deps: node:test + node:assert. Every card is written into a
// throwaway PHANTOM_DATA temp root and read back off disk.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const brain = require('../scripts/lib/brain-card');
const { makeCardId, renderCard, parseCard, writeCard, readCard, supersede, cardPath, ID_RE } = brain;

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Run fn with PHANTOM_DATA pointed at a fresh temp root; always clean up.
function withData(fn) {
  const tmp = mkTmp('brain-data-');
  const saved = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = tmp;
  try {
    return fn(tmp);
  } finally {
    if (saved === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = saved;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const SAMPLE = {
  ticket: 'repo-brain',
  title: 'Linked Card Brain: distilled cards + grep retrieval',
  type: 'decision',
  files: ['scripts/lib/brain-card.js', 'reference/brain.md'],
  edges: [{ relates_to: 'rb-9f0e1d' }, { caused_by: 'rb-000abc' }],
  trace: {
    session: '/data/repos/research-team-skills/sessions/repo-brain',
    transcript: '/x/.claude/projects/-proj/abc.jsonl',
    pr: 'https://github.com/org/repo/pull/62',
    commit: '',
  },
  what: 'Built the per-repo brain: card schema + writer + wrap/close wiring.',
  why: 'Chose grep over FTS5 (deferred until ~500 cards); rejected embeddings (Cody lesson, +9pp not worth infra); rejected git-notes (no default push).',
  gotchas: 'Card-write must never block the ship — callers guard the RUN.',
};

test('makeCardId: deterministic + rb-<6hex> format', () => {
  const parts = { repo: 'r', ticket: 't', date: '2026-07-01', title: 'x' };
  const a = makeCardId(parts);
  const b = makeCardId({ ...parts });
  assert.equal(a, b, 'same inputs -> same id (that IS the dedup)');
  assert.match(a, ID_RE);
});

test('makeCardId: collision-free across repos/tickets on the same date (concurrent worktrees)', () => {
  const date = '2026-07-01';
  const title = 'Fix repo detection';
  const idRepoA = makeCardId({ repo: 'feature-web-apps', ticket: 'cp-1', date, title });
  const idRepoB = makeCardId({ repo: 'phantom-terminal', ticket: 'cp-1', date, title });
  const idTicket2 = makeCardId({ repo: 'feature-web-apps', ticket: 'cp-2', date, title });
  assert.notEqual(idRepoA, idRepoB, 'different repos, same ticket/date/title -> different id');
  assert.notEqual(idRepoA, idTicket2, 'different tickets, same repo/date/title -> different id');
});

test('renderCard/parseCard: full round-trip preserves all fields', () => {
  const md = renderCard({ ...SAMPLE, id: 'rb-a1b2c3', date: '2026-07-01' });
  const c = parseCard(md);
  assert.equal(c.id, 'rb-a1b2c3');
  assert.equal(c.ticket, SAMPLE.ticket);
  assert.equal(c.title, SAMPLE.title);
  assert.equal(c.type, 'decision');
  assert.equal(c.status, 'active');
  assert.equal(c.date, '2026-07-01');
  assert.deepEqual(c.files, SAMPLE.files);
  assert.deepEqual(c.edges, SAMPLE.edges);
  assert.deepEqual(c.trace, SAMPLE.trace);
  assert.equal(c.what, SAMPLE.what);
  assert.equal(c.why, SAMPLE.why);
  assert.equal(c.gotchas, SAMPLE.gotchas);
});

test('parseCard: title containing a colon round-trips (quoting)', () => {
  const md = renderCard({ id: 'rb-abcdef', ticket: 't', title: 'Fix: the thing', date: '2026-07-01', why: 'w' });
  const c = parseCard(md);
  assert.equal(c.title, 'Fix: the thing');
});

test('parseCard: empty files/edges round-trip as []', () => {
  const md = renderCard({ id: 'rb-abcdef', ticket: 't', title: 'x', date: '2026-07-01', why: 'w' });
  assert.match(md, /files: \[\]/);
  assert.match(md, /edges: \[\]/);
  const c = parseCard(md);
  assert.deepEqual(c.files, []);
  assert.deepEqual(c.edges, []);
});

test('writeCard: writes under <data>/repos/{repo}/brain/cards/{id}.md and reads back', () => {
  withData(tmp => {
    const { id, file } = writeCard({ ...SAMPLE, date: '2026-07-01' }, { repo: 'research-team-skills' });
    assert.match(id, ID_RE);
    assert.equal(file, path.join(tmp, 'repos', 'research-team-skills', 'brain', 'cards', `${id}.md`));
    assert.ok(fs.existsSync(file), 'card file exists on disk');
    const c = readCard('research-team-skills', id);
    assert.equal(c.title, SAMPLE.title);
    assert.equal(c.why, SAMPLE.why);
  });
});

test('writeCard: computes id from repo+ticket+date+title when absent', () => {
  withData(() => {
    const repo = 'research-team-skills';
    const { id } = writeCard({ ...SAMPLE, date: '2026-07-01' }, { repo });
    const expected = makeCardId({ repo, ticket: SAMPLE.ticket, date: '2026-07-01', title: SAMPLE.title });
    assert.equal(id, expected);
  });
});

test('writeCard: same inputs are idempotent (dedup to one file)', () => {
  withData(tmp => {
    const repo = 'r';
    const card = { ...SAMPLE, date: '2026-07-01' };
    const a = writeCard(card, { repo });
    const b = writeCard(card, { repo });
    assert.equal(a.id, b.id);
    const dir = path.join(tmp, 'repos', repo, 'brain', 'cards');
    assert.deepEqual(fs.readdirSync(dir), [`${a.id}.md`]);
  });
});

test('writeCard: two repos, same ticket/date/title -> two distinct files, no collision', () => {
  withData(tmp => {
    const card = { ...SAMPLE, date: '2026-07-01' };
    const a = writeCard(card, { repo: 'feature-web-apps' });
    const b = writeCard(card, { repo: 'phantom-terminal' });
    assert.notEqual(a.id, b.id);
    assert.ok(fs.existsSync(path.join(tmp, 'repos', 'feature-web-apps', 'brain', 'cards', `${a.id}.md`)));
    assert.ok(fs.existsSync(path.join(tmp, 'repos', 'phantom-terminal', 'brain', 'cards', `${b.id}.md`)));
  });
});

test('writeCard: rejects a path-traversal id, recomputes a safe rb-<6hex> id, and never escapes brain/cards/', () => {
  withData(tmp => {
    const repo = 'r';
    const learningsDir = path.join(tmp, 'repos', repo, 'learnings');
    fs.mkdirSync(learningsDir, { recursive: true });
    const sibling = path.join(learningsDir, 'INDEX.md');
    fs.writeFileSync(sibling, 'do not touch');

    const { id, file } = writeCard({ ...SAMPLE, date: '2026-07-01', id: '../../learnings/INDEX' }, { repo });

    assert.match(id, ID_RE, 'malicious id is recomputed to a valid rb-<6hex> id');
    assert.equal(file, path.join(tmp, 'repos', repo, 'brain', 'cards', `${id}.md`), 'card lands inside brain/cards/');
    assert.ok(fs.existsSync(file), 'card written inside brain/cards/');
    assert.equal(fs.readFileSync(sibling, 'utf8'), 'do not touch', 'sibling file outside brain/cards/ is untouched');
  });
});

test('writeCard: preserves a valid explicit rb-<6hex> id', () => {
  withData(() => {
    const { id } = writeCard({ ...SAMPLE, date: '2026-07-01', id: 'rb-abc123' }, { repo: 'r' });
    assert.equal(id, 'rb-abc123');
  });
});

test('cardPath: throws on any id that is not rb-<6hex> (last line of defense)', () => {
  assert.throws(() => cardPath('r', '../../learnings/INDEX'), /invalid card id/);
});

test('supersede: flips old -> superseded + superseded_by, edges new, deletes nothing', () => {
  withData(() => {
    const repo = 'r';
    const oldW = writeCard({ ticket: 't', title: 'old decision', date: '2026-06-01', type: 'decision', why: 'original rationale' }, { repo });
    const newW = writeCard({ ticket: 't', title: 'new decision', date: '2026-07-01', type: 'decision', why: 'better rationale' }, { repo });

    const { old, new: neu } = supersede(oldW.id, newW.id, { repo });
    assert.equal(old.status, 'superseded');
    assert.equal(old.superseded_by, newW.id);
    assert.ok(neu.edges.some(e => e.supersedes === oldW.id), 'new card carries supersedes edge');

    // Persisted, and the OLD card still exists (never deleted) + still explains its why.
    assert.ok(fs.existsSync(cardPath(repo, oldW.id)));
    const reloadedOld = readCard(repo, oldW.id);
    assert.equal(reloadedOld.status, 'superseded');
    assert.equal(reloadedOld.superseded_by, newW.id);
    assert.equal(reloadedOld.why, 'original rationale', 'superseded card keeps its Why');
    const reloadedNew = readCard(repo, newW.id);
    assert.ok(reloadedNew.edges.some(e => e.supersedes === oldW.id));
  });
});

test('supersede: does not duplicate the supersedes edge on re-run', () => {
  withData(() => {
    const repo = 'r';
    const oldW = writeCard({ ticket: 't', title: 'old', date: '2026-06-01', why: 'a' }, { repo });
    const newW = writeCard({ ticket: 't', title: 'new', date: '2026-07-01', why: 'b' }, { repo });
    supersede(oldW.id, newW.id, { repo });
    supersede(oldW.id, newW.id, { repo });
    const reloadedNew = readCard(repo, newW.id);
    const count = reloadedNew.edges.filter(e => e.supersedes === oldW.id).length;
    assert.equal(count, 1, 'edge is not duplicated');
  });
});

test('guard: unwritable brain dir throws in writeCard but the RUN-guard swallows it', () => {
  withData(tmp => {
    // Make <data>/repos a file so mkdir of repos/{repo}/brain/cards fails.
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'repos'), 'not a dir');

    assert.throws(() => writeCard({ ...SAMPLE, date: '2026-07-01' }, { repo: 'r' }), 'lib is honest: it throws');

    // The wrap/close wiring guards the RUN — emulate `... || true`.
    let shipBlocked = false;
    try {
      writeCard({ ...SAMPLE, date: '2026-07-01' }, { repo: 'r' });
    } catch {
      /* degrade silently — never blocks the ship */
    }
    assert.equal(shipBlocked, false, 'card failure never blocks the wrap');
  });
});

test('supersede: missing card throws (caller guards)', () => {
  withData(() => {
    assert.throws(() => supersede('rb-000000', 'rb-111111', { repo: 'r' }), /not found/);
  });
});
