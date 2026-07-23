// Author: Subash Karki
// repo-dirs-migration.test.js — EXECUTED fixture tests (per [executed-review]):
// builds real temp trees, runs the migration for effect, and asserts the
// resulting filesystem + report. Covers one orphan per signal class (PR,
// gitHead, session-id) plus a collision and an unresolvable, empties pruning,
// idempotency/force, append-only learnings merge, and the auto-run hook path.
// Zero external deps: node:test + node:assert + node:fs + node:child_process.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = require.resolve('../scripts/migrate-repo-dirs.js');
const MARKER_SCRIPT = require.resolve('../hooks/session-marker.js');

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function write(p, s) { mkdirp(path.dirname(p)); fs.writeFileSync(p, s); }
function writeJson(p, o) { write(p, JSON.stringify(o, null, 2)); }

/** Build an isolated fixture world and return its env + paths. */
function buildWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdm-'));
  const DATA = path.join(root, 'data');
  const reposRoot = path.join(DATA, 'repos');
  const candParent = path.join(root, 'candidates');
  const projects = path.join(root, 'projects');
  const legacy = path.join(root, 'legacy-absent'); // intentionally missing
  mkdirp(reposRoot); mkdirp(candParent); mkdirp(projects);

  // --- candidate: a real git repo (gitHead signal) ---
  const beta = path.join(candParent, 'repo-beta');
  mkdirp(beta);
  const g = (args) => spawnSync('git', args, { cwd: beta, encoding: 'utf8' });
  g(['init', '-q']);
  g(['config', 'user.email', 'a@b.c']);
  g(['config', 'user.name', 'T']);
  write(path.join(beta, 'f.txt'), 'hello');
  g(['add', '.']);
  g(['commit', '-q', '-m', 'init']);
  const betaSha = g(['rev-parse', 'HEAD']).stdout.trim();

  // --- candidate: git repo (session-id signal target) ---
  const gamma = path.join(candParent, 'repo-gamma');
  mkdirp(gamma);
  const gg = (args) => spawnSync('git', args, { cwd: gamma, encoding: 'utf8' });
  gg(['init', '-q']); gg(['config', 'user.email', 'a@b.c']); gg(['config', 'user.name', 'T']);
  write(path.join(gamma, 'f.txt'), 'x'); gg(['add', '.']); gg(['commit', '-q', '-m', 'i']);

  // --- orphan (PR class) -> repo-alpha ---
  writeJson(path.join(reposRoot, 'br-pr', 'sessions', 'T1', 'wrap.json'),
    { pr: 'https://github.com/AcmeOrg/repo-alpha/pull/42', ok: true });
  write(path.join(reposRoot, 'br-pr', 'learnings', 'data.md'),
    'shared line\nunique-from-orphan\n');

  // --- orphan (gitHead class) -> repo-beta ---
  writeJson(path.join(reposRoot, 'br-head', 'sessions', 'T2', 'wrap.json'),
    { _meta: { gitHead: betaSha, gitBranch: 'br-head' } });

  // --- orphan (session-id class) -> repo-gamma ---
  const SID = 'abc1234a-0000-0000-0000-000000000000';
  writeJson(path.join(reposRoot, 'br-costs', 'sessions', 'T3', 'costs.json'),
    { session_id: SID, cost: 1 });
  const gammaCwd = path.join(candParent, 'repo-gamma', 'some-branch');
  write(path.join(projects, gammaCwd.replace(/[/.]/g, '-'), SID + '.jsonl'), '{"x":1}\n');

  // --- orphan (collision) -> repo-alpha, ticket dir already present in dest ---
  // repo-alpha is a canonical dir: its own artifact points back at itself, so it
  // must be recognised as canonical (self-skip), not migrated.
  writeJson(path.join(reposRoot, 'repo-alpha', 'sessions', 'self', 'wrap.json'),
    { pr: 'https://github.com/AcmeOrg/repo-alpha/pull/1' });
  write(path.join(reposRoot, 'repo-alpha', 'sessions', 'Tdup', 'existing.txt'), 'keep-me');
  write(path.join(reposRoot, 'repo-alpha', 'learnings', 'data.md'),
    'shared line\nunique-from-canonical\n');
  writeJson(path.join(reposRoot, 'br-collide', 'sessions', 'Tdup', 'wrap.json'),
    { pr: 'https://github.com/AcmeOrg/repo-alpha/pull/99' });

  // --- orphan (unresolvable) ---
  writeJson(path.join(reposRoot, 'br-orphan', 'sessions', 'T9', 'note.json'), { nothing: true });

  // --- empties ---
  mkdirp(path.join(reposRoot, 'br-empty-1'));
  mkdirp(path.join(reposRoot, 'br-empty-2', 'sessions', 'deep'));

  const env = {
    PHANTOM_DATA: DATA,
    PHANTOM_MIGRATE_CANDIDATE_DIRS: candParent,
    PHANTOM_PROJECTS_DIR: projects,
    PHANTOM_MIGRATE_LEGACY_ROOT: legacy,
    PHANTOM_MIGRATE_SRC_TEAM: legacy,
    PHANTOM_MIGRATE_SRC_PHANTOM: legacy,
    PHANTOM_MIGRATE_SRC_PHANTOM_DATA: legacy,
  };
  return { root, DATA, reposRoot, env, betaSha, SID };
}

/** Run migrate-repo-dirs in a child process for env + module-cache isolation. */
function runMigrate(env, args = []) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args],
    { env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(res.status, 0, 'migrator exited nonzero: ' + res.stderr);
  return res;
}

function latestReport(DATA, mode) {
  const dir = path.join(DATA, 'audit');
  const files = fs.readdirSync(dir).filter(f => f.startsWith(`repo-dirs-migration-${mode}-`));
  files.sort();
  return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
}

function cleanup(root) { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {} }

// ---------------------------------------------------------------------------

test('dry-run mutates nothing but reports the full plan', () => {
  const w = buildWorld();
  try {
    runMigrate(w.env); // default = dry-run
    // No mutation: orphans still present, no .migrated-away, no marker.
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'br-pr')), 'orphan untouched');
    assert.ok(!fs.existsSync(path.join(w.reposRoot, 'br-pr.migrated-away')));
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'br-empty-1')), 'empty not pruned in dry-run');
    assert.ok(!fs.existsSync(path.join(w.DATA, '.repo-dirs-migrated')), 'no marker in dry-run');

    const rep = latestReport(w.DATA, 'dry-run');
    assert.equal(rep.mode, 'dry-run');
    const targets = Object.fromEntries(rep.resolved.map(r => [r.src, r.target]));
    assert.equal(targets['br-pr'], 'repo-alpha', 'PR signal');
    assert.equal(targets['br-head'], 'repo-beta', 'gitHead signal');
    assert.equal(targets['br-costs'], 'repo-gamma', 'session-id signal');
    assert.equal(targets['br-collide'], 'repo-alpha', 'collision orphan resolved');
    assert.deepEqual(rep.unresolved.map(u => u.src), ['br-orphan'], 'only the signal-less orphan is unresolved');
    assert.ok(rep.canonical.some(c => c.src === 'repo-alpha'), 'canonical dir self-skips (not migrated)');
    assert.equal(rep.pruned.length, 2, 'both empties flagged for prune');
  } finally { cleanup(w.root); }
});

test('--apply resolves all signal classes, prunes empties, preserves bytes', () => {
  const w = buildWorld();
  try {
    runMigrate(w.env, ['--apply']);

    // PR orphan merged into repo-alpha, source parked as .migrated-away.
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'repo-alpha', 'sessions', 'T1', 'wrap.json')));
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'br-pr.migrated-away')), 'source preserved, never deleted');
    assert.ok(!fs.existsSync(path.join(w.reposRoot, 'br-pr')), 'original name gone (renamed aside)');

    // gitHead + session orphans landed in their canonical dirs.
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'repo-beta', 'sessions', 'T2', 'wrap.json')));
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'repo-gamma', 'sessions', 'T3', 'costs.json')));

    // Empties pruned.
    assert.ok(!fs.existsSync(path.join(w.reposRoot, 'br-empty-1')));
    assert.ok(!fs.existsSync(path.join(w.reposRoot, 'br-empty-2')));

    // Unresolvable left in place.
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'br-orphan', 'sessions', 'T9', 'note.json')));

    // Marker written.
    assert.ok(fs.existsSync(path.join(w.DATA, '.repo-dirs-migrated')));

    const rep = latestReport(w.DATA, 'apply');
    assert.ok(rep.counts.resolved >= 4);
    assert.equal(rep.counts.pruned, 2);
  } finally { cleanup(w.root); }
});

test('collision on an existing ticket dir routes to <ticket>-migrated, never overwrites', () => {
  const w = buildWorld();
  try {
    runMigrate(w.env, ['--apply']);
    // Pre-existing dest ticket untouched...
    assert.equal(fs.readFileSync(path.join(w.reposRoot, 'repo-alpha', 'sessions', 'Tdup', 'existing.txt'), 'utf8'), 'keep-me');
    // ...and the colliding orphan ticket landed beside it under -migrated.
    const migrated = fs.readdirSync(path.join(w.reposRoot, 'repo-alpha', 'sessions'))
      .filter(n => n.startsWith('Tdup-migrated'));
    assert.equal(migrated.length, 1, 'collision produced exactly one -migrated ticket');
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'repo-alpha', 'sessions', migrated[0], 'wrap.json')));
  } finally { cleanup(w.root); }
});

test('learnings merge is append-only with dedup + source attribution', () => {
  const w = buildWorld();
  try {
    runMigrate(w.env, ['--apply']);
    const merged = fs.readFileSync(path.join(w.reposRoot, 'repo-alpha', 'learnings', 'data.md'), 'utf8');
    // Canonical bytes preserved.
    assert.ok(merged.includes('unique-from-canonical'));
    // Orphan-only line appended.
    assert.ok(merged.includes('unique-from-orphan'));
    // Shared line NOT duplicated (dedup).
    assert.equal(merged.split('\n').filter(l => l === 'shared line').length, 1);
    // Attribution header present.
    assert.ok(/merged from br-pr/.test(merged));
  } finally { cleanup(w.root); }
});

test('--apply is idempotent; --force re-runs on a new orphan', () => {
  const w = buildWorld();
  try {
    runMigrate(w.env, ['--apply']);
    const out2 = runMigrate(w.env, ['--apply']);
    assert.match(out2.stdout, /already migrated/, 'second --apply no-ops via marker');

    // A brand-new orphan appears after migration.
    writeJson(path.join(w.reposRoot, 'br-late', 'sessions', 'T5', 'wrap.json'),
      { pr: 'https://github.com/AcmeOrg/repo-alpha/pull/7' });
    runMigrate(w.env, ['--apply']); // still marker-gated -> ignored
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'br-late')), '--apply respects marker');

    runMigrate(w.env, ['--apply', '--force']);
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'br-late.migrated-away')), '--force picks up new orphan');
  } finally { cleanup(w.root); }
});

test('--map override wins over signals', () => {
  const w = buildWorld();
  try {
    // br-pr would resolve to repo-alpha by PR; force it elsewhere.
    runMigrate(w.env, ['--apply', '--map', 'br-pr=repo-override']);
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'repo-override', 'sessions', 'T1', 'wrap.json')));
  } finally { cleanup(w.root); }
});

test('two orphans colliding on the same top-level filename park distinctly (never overwrite)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdm-park-'));
  const DATA = path.join(root, 'data');
  const reposRoot = path.join(DATA, 'repos');
  const candParent = path.join(root, 'candidates'); // empty: no candidate git repos
  const projects = path.join(root, 'projects');
  const legacy = path.join(root, 'legacy-absent');
  mkdirp(reposRoot); mkdirp(candParent); mkdirp(projects);

  // Canonical dest repo-alpha: a self PR (recognised as canonical, self-skips) and
  // a top-level notes.txt that both orphans will collide with.
  writeJson(path.join(reposRoot, 'repo-alpha', 'sessions', 'self', 'wrap.json'),
    { pr: 'https://github.com/AcmeOrg/repo-alpha/pull/1' });
  write(path.join(reposRoot, 'repo-alpha', 'notes.txt'), 'canonical');

  // Two orphans, each resolving to repo-alpha by PR, each with a colliding notes.txt.
  writeJson(path.join(reposRoot, 'br-a', 'sessions', 'Ta', 'wrap.json'),
    { pr: 'https://github.com/AcmeOrg/repo-alpha/pull/10' });
  write(path.join(reposRoot, 'br-a', 'notes.txt'), 'from-a');
  writeJson(path.join(reposRoot, 'br-b', 'sessions', 'Tb', 'wrap.json'),
    { pr: 'https://github.com/AcmeOrg/repo-alpha/pull/11' });
  write(path.join(reposRoot, 'br-b', 'notes.txt'), 'from-b');

  const env = {
    PHANTOM_DATA: DATA,
    PHANTOM_MIGRATE_CANDIDATE_DIRS: candParent,
    PHANTOM_PROJECTS_DIR: projects,
    PHANTOM_MIGRATE_LEGACY_ROOT: legacy,
  };
  try {
    runMigrate(env, ['--apply']);
    const dir = path.join(reposRoot, 'repo-alpha');
    // Canonical file untouched.
    assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'canonical');
    // Both colliding orphans parked to DISTINCT spots — second never overwrote first.
    const parked = fs.readdirSync(dir).filter(n => n.startsWith('notes.txt.migrated'));
    assert.equal(parked.length, 2, 'both colliding orphans parked distinctly');
    const contents = parked.map(n => fs.readFileSync(path.join(dir, n), 'utf8')).sort();
    assert.deepEqual(contents, ['from-a', 'from-b'], 'both orphan payloads preserved');
  } finally { cleanup(root); }
});

test('a live lock makes --apply skip; a stale lock is reclaimed', () => {
  const w = buildWorld();
  const lock = path.join(w.DATA, '.repo-dirs-migrating');
  try {
    // A fresh lock from a concurrent run -> skip, mutate nothing, leave the lock.
    write(lock, JSON.stringify({ pid: 999999 }));
    const out = runMigrate(w.env, ['--apply']);
    assert.match(out.stdout, /in progress/, 'live lock -> skipped');
    assert.ok(!fs.existsSync(path.join(w.reposRoot, 'br-pr.migrated-away')), 'no mutation while locked');
    assert.ok(!fs.existsSync(path.join(w.DATA, '.repo-dirs-migrated')), 'no marker while locked');
    assert.ok(fs.existsSync(lock), 'live lock left in place');

    // Age the lock past the stale threshold -> reclaimed, migration proceeds.
    const old = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(lock, old, old);
    runMigrate(w.env, ['--apply']);
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'br-pr.migrated-away')), 'stale lock reclaimed, migration ran');
    assert.ok(!fs.existsSync(lock), 'lock released after the run');
  } finally { cleanup(w.root); }
});

test('an inherited PHANTOM_REPO override never collapses candidate resolution', () => {
  const w = buildWorld();
  const prevOverride = process.env.PHANTOM_REPO;
  process.env.PHANTOM_REPO = 'evil-override';
  try {
    // session-marker.js spawns the migrator inheriting process.env, so a
    // shell-exported PHANTOM_REPO reaches the child exactly like this.
    runMigrate(w.env); // dry-run: candidates() resolves off two DISTINCT git checkouts

    const rep = latestReport(w.DATA, 'dry-run');
    const targets = Object.fromEntries(rep.resolved.map(r => [r.src, r.target]));
    // Each orphan must still land on its TRUE candidate repo, not the override.
    assert.equal(targets['br-head'], 'repo-beta', 'gitHead signal unaffected by override');
    assert.equal(targets['br-costs'], 'repo-gamma', 'session-id signal unaffected by override');
    assert.notEqual(targets['br-head'], 'evil-override');
    assert.notEqual(targets['br-costs'], 'evil-override');
    // No plan merges anything into the override name — candidates never collapsed to one.
    assert.ok(!Object.values(targets).includes('evil-override'), 'override never used as a merge target');
  } finally {
    if (prevOverride === undefined) delete process.env.PHANTOM_REPO;
    else process.env.PHANTOM_REPO = prevOverride;
    cleanup(w.root);
  }
});

test('auto-run hook (session-marker) triggers exactly one migration, then self-gates', () => {
  const w = buildWorld();
  try {
    const env = { ...process.env, ...w.env, PHANTOM_MIGRATE_SYNC: '1' };
    const payload = JSON.stringify({ session_id: 'sess-1', cwd: w.reposRoot });

    const r1 = spawnSync(process.execPath, [MARKER_SCRIPT], { env, input: payload, encoding: 'utf8' });
    assert.equal(r1.status, 0, 'hook must exit 0: ' + r1.stderr);
    assert.ok(fs.existsSync(path.join(w.DATA, '.repo-dirs-migrated')), 'hook ran the migration');
    assert.ok(fs.existsSync(path.join(w.reposRoot, 'br-pr.migrated-away')), 'orphans consolidated via hook');

    const applyReports = () => fs.readdirSync(path.join(w.DATA, 'audit'))
      .filter(f => f.startsWith('repo-dirs-migration-apply-'));
    assert.equal(applyReports().length, 1, 'exactly one apply run');

    // Second prompt: marker present -> migrator must NOT run again.
    const r2 = spawnSync(process.execPath, [MARKER_SCRIPT], { env, input: payload, encoding: 'utf8' });
    assert.equal(r2.status, 0);
    assert.equal(applyReports().length, 1, 'no second migration — marker self-gates');
  } finally { cleanup(w.root); }
});
