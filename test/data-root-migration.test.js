// Author: Subash Karki
// data-root-migration.test.js -- EXECUTED fixture tests for the dry-run-first,
// fingerprinted, migration-wide-locked data-root migrator (scripts/migrate-data.js).
//
// Every test builds a real temp fixture world, runs the migrator in a child
// process (env + module-cache isolation), and asserts on the resulting filesystem
// and manifest. Covers: every source class in the registry, the ZERO-write
// dry-run proof (whole-tree snapshot before/after), apply digest proofs (external
// sources byte-identical), content-addressed rollback backups for changed baseline
// files, deterministic collision parking, unresolved-mapping behavior + --map,
// idempotent reruns with changed-source rescans, and lock contention (a state
// writer racing the migration blocks or fails closed).
//
// Fixture shapes are kept deliberately awkward/real (bespoke unknown keys,
// mega-paragraph learnings values) per learning realworld-fixture-keeps-awkward-shape.
// Zero external deps: node:test + node:assert + node:fs + node:child_process.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SCRIPT = require.resolve('../scripts/migrate-data.js');
const LEARNING = require.resolve('../skills/gorkhali/scripts/gorkhali-learning.mjs');
const STATE = require.resolve('../skills/gorkhali/scripts/gorkhali-state.mjs');
const codec = require('../skills/gorkhali/scripts/lib/shared-state.cjs');
const HAS_GIT = (() => {
  try { require('child_process').execSync('git --version', { stdio: 'ignore' }); return true; } catch (_) { return false; }
})();
const MARKER = '.data-root-migrated-v3';

// A repo id that cannot be materialized as a safe path segment ('@' is outside the
// codec's [A-Za-z0-9._-] segment set). Such ids are the ONLY unresolved case: they
// require an explicit --map. Safe ids (incl. branch-name fragments) are preserved.
const UNSAFE_ID = 'weird@repo';

function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }
function write(file, content) { mkdirp(path.dirname(file)); fs.writeFileSync(file, content); }
function writeJson(file, value) { write(file, JSON.stringify(value, null, 2)); }
function cleanup(root) { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {} }

// A hashed, self-canonical repo id (codec `<name>-<10hex>`) -- resolves to itself
// without needing an alias, so it models a real remote-backed repo.
function hashedId(name, seed) {
  const hex = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 10);
  return `${name}-${hex}`;
}

/** Recursive {relative-path -> sha256} snapshot of a directory tree (sorted). */
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        out[path.relative(root, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      }
    }
  };
  walk(root);
  return out;
}

const CANON = hashedId('research-gorkhali-skills', 'origin-canonical');
const OTHER = hashedId('feature-web-apps', 'origin-other');

/**
 * Build an isolated fixture world covering every source class. Returns env + paths.
 * DEST is the canonical baseline root; the five source roots model the historical
 * scatter. Codex-upper/lower are DISTINCT temp dirs (distinct-case class).
 */
function buildWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drm-'));
  const DEST = path.join(root, 'gorkhali');
  const gorkhaliData = path.join(root, 'claude-gorkhali-data');
  const gorkhali = path.join(root, 'claude-gorkhali');
  const team = path.join(root, 'claude-team');
  const codexUpper = path.join(root, 'Codex-gorkhali');
  const codexLower = path.join(root, 'codex-gorkhali');

  // --- DEST baseline: an existing canonical repo with a learnings file whose
  // bytes a source will extend (drives the rollback-backup path).
  write(path.join(DEST, 'repos', CANON, 'learnings', 'workflow.md'),
    'CORRECTION [alpha]: baseline correction that must survive verbatim.\nshared-line\n');
  write(path.join(DEST, 'repos', CANON, 'sessions', 'KEEP', 'wrap.json'),
    JSON.stringify({ kept: true, note: 'a '.repeat(40) + 'mega paragraph value kept as-is' }));

  // --- gorkhali-data (highest priority): new session, learnings extension,
  // an EXACT duplicate of a baseline file (dedup), and an unresolved branch id.
  writeJson(path.join(gorkhaliData, 'repos', CANON, 'sessions', 'IMPORT-1', 'wrap.json'),
    { imported: true, weirdKey: 'x', prose: 'p '.repeat(30) });
  write(path.join(gorkhaliData, 'repos', CANON, 'learnings', 'workflow.md'),
    'shared-line\nLEARNING [beta]: a genuinely new learning line to append.\n');
  write(path.join(gorkhaliData, 'repos', CANON, 'sessions', 'KEEP', 'wrap.json'),
    JSON.stringify({ kept: true, note: 'a '.repeat(40) + 'mega paragraph value kept as-is' }));
  // An unsafe-segment repo id (unresolved -> requires --map) and a stale runtime
  // marker (skipped-live-state) so every artifact class is exercised.
  writeJson(path.join(gorkhaliData, 'repos', UNSAFE_ID, 'sessions', 'T', 'x.json'), { branchFragment: true });
  writeJson(path.join(gorkhaliData, 'state', 'routing-nudge', 'n.json'), { stale: true });
  // Mutable top-level classes that must be imported, and a managed worktree that
  // must NEVER be copied (it is live per-run working state, not durable knowledge).
  write(path.join(gorkhaliData, 'timing', `${CANON}.jsonl`), 'run-1 timing\n');
  write(path.join(gorkhaliData, 'events', CANON, 'e.jsonl'), 'an event line\n');
  write(path.join(gorkhaliData, 'worktrees', CANON, 'T', 'code.js'), 'live worktree file');

  // --- gorkhali: _default shard + global/root-level learnings + a decisions file.
  writeJson(path.join(gorkhali, 'repos', '_default', 'sessions', 'LOOSE-1', 'costs.json'),
    { session_id: 'sess-loose', cost: 3 });
  write(path.join(gorkhali, 'learnings', 'INDEX.md'), '# Root learnings\n\n- global note [validated:1]\n');
  write(path.join(gorkhali, 'global', 'patterns', 'p.md'), 'a promoted global pattern\n');
  write(path.join(gorkhali, 'repos', CANON, 'decisions', 'global.md'), '# Decisions\n\nkeep this decision.\n');

  // --- team: brain card + a CONFLICT (different bytes at a path gorkhali-data also
  // writes) to exercise deterministic parking under source priority.
  write(path.join(team, 'repos', CANON, 'brain', 'cards', 'rb-abc123.md'),
    '---\nid: rb-abc123\ntitle: a card\n---\nbody\n');
  writeJson(path.join(team, 'repos', CANON, 'sessions', 'IMPORT-1', 'wrap.json'),
    { imported: 'CONFLICTING-BYTES-from-team' });

  // --- Codex upper + lower (DISTINCT dirs): a .migrated-away orphan whose base id
  // is a known canonical, and a second DISTINCT hashed repo id.
  writeJson(path.join(codexUpper, 'repos', `${CANON}.migrated-away`, 'sessions', 'AWAY-1', 'note.json'),
    { fromMigratedAway: true });
  writeJson(path.join(codexLower, 'repos', OTHER, 'sessions', 'OTH-1', 'wrap.json'),
    { distinctRepo: true });

  const env = {
    ...process.env,
    GORKHALI_DATA: DEST,
    GORKHALI_MIGRATE_SRC_GORKHALI_DATA: gorkhaliData,
    GORKHALI_MIGRATE_SRC_GORKHALI: gorkhali,
    GORKHALI_MIGRATE_SRC_TEAM: team,
    GORKHALI_MIGRATE_SRC_CODEX_UPPER: codexUpper,
    GORKHALI_MIGRATE_SRC_CODEX_LOWER: codexLower,
  };
  return { root, DEST, gorkhaliData, gorkhali, team, codexUpper, codexLower, env };
}

function dryRun(env, extraArgs = []) {
  const res = spawnSync(process.execPath, [SCRIPT, ...extraArgs], { env, encoding: 'utf8' });
  assert.equal(res.status, 0, `dry-run exited nonzero: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function saveManifest(root, manifest) {
  const file = path.join(root, `manifest-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest));
  return file;
}

function apply(env, manifestPath, extraArgs = [], envExtra = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--apply', '--manifest', manifestPath, ...extraArgs],
    { env: { ...env, ...envExtra }, encoding: 'utf8' });
}

function runPortable(env, args) {
  const res = spawnSync(process.execPath, [STATE, ...args, '--json'], { env, encoding: 'utf8' });
  assert.equal(res.status, 0, `gorkhali-state exited nonzero: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function reportOf(applyResult) {
  return JSON.parse(fs.readFileSync(applyResult.stdout.trim().split('-> ')[1], 'utf8'));
}

// The three external source roots whose bytes must be byte-identical after apply.
function externalRoots(w) {
  return [w.gorkhaliData, w.gorkhali, w.team, w.codexUpper, w.codexLower];
}

// ---------------------------------------------------------------------------

test('dry-run performs ZERO filesystem writes (whole-tree snapshot is identical)', () => {
  const w = buildWorld();
  try {
    const before = snapshot(w.root);
    const manifest = dryRun(w.env);
    const after = snapshot(w.root);
    assert.deepEqual(after, before, 'dry-run must not write anything anywhere in the fixture tree');
    assert.equal(manifest.mode, 'dry-run');
    assert.ok(!fs.existsSync(path.join(w.DEST, MARKER)), 'no marker written in dry-run');
    assert.ok(!fs.existsSync(path.join(w.DEST, 'locks')), 'no lock dir created in dry-run');
  } finally { cleanup(w.root); }
});

test('dry-run accounts for every source class with per-root and per-artifact counts', () => {
  const w = buildWorld();
  try {
    const m = dryRun(w.env);
    // Distinct-case Codex sources are BOTH scanned (distinct dirs).
    const labels = m.sources.filter((s) => s.present && !s.skipped).map((s) => s.label);
    assert.ok(labels.includes('codex-upper') && labels.includes('codex-lower'), 'both Codex-case roots scanned');

    // Class totals: an unresolved branch id, a skipped live-state pointer are not
    // present in this world, but imports/dedup/park/unresolved are.
    assert.ok(m.counts.byClass.imported >= 5, 'imports counted');
    assert.ok(m.counts.byClass.unresolved >= 1, 'the unsafe-segment id is unresolved');
    assert.ok(m.counts.byClass.deduplicated >= 1, 'the exact-duplicate KEEP file dedups');
    assert.ok(m.counts.byClass['conflict-parked'] >= 1, 'the different-bytes IMPORT-1 conflict is parked');
    assert.ok(m.counts.byClass['skipped-live-state'] >= 1, 'the stale runtime marker is skipped');

    // Per-root + per-artifact breakdowns exist.
    assert.ok(m.counts.byRoot['gorkhali-data'], 'per-root counts present');
    assert.ok(Object.keys(m.counts.byArtifact).length >= 1, 'per-artifact counts present');

    // Unresolved ids are surfaced for --map.
    assert.deepEqual(m.unresolvedIds.map((u) => u.id), [UNSAFE_ID]);
  } finally { cleanup(w.root); }
});

test('apply preserves every external source byte-for-byte (digest proof)', () => {
  const w = buildWorld();
  try {
    const before = externalRoots(w).map((r) => snapshot(r));
    const manifest = dryRun(w.env);
    const res = apply(w.env, saveManifest(w.root, manifest));
    assert.equal(res.status, 0, res.stderr);
    const after = externalRoots(w).map((r) => snapshot(r));
    for (let i = 0; i < before.length; i++) {
      assert.deepEqual(after[i], before[i], `external source ${i} must be unchanged after apply`);
    }
  } finally { cleanup(w.root); }
});

test('apply imports unique data and preserves the baseline; distinct hashed ids stay distinct', () => {
  const w = buildWorld();
  try {
    const res = apply(w.env, saveManifest(w.root, dryRun(w.env)));
    assert.equal(res.status, 0, res.stderr);

    // New session imported into the canonical repo.
    assert.ok(fs.existsSync(path.join(w.DEST, 'repos', CANON, 'sessions', 'IMPORT-1', 'wrap.json')));
    // A distinct hashed repo id landed under its OWN canonical dir (never merged).
    assert.ok(fs.existsSync(path.join(w.DEST, 'repos', OTHER, 'sessions', 'OTH-1', 'wrap.json')));
    // The .migrated-away orphan mapped to its base canonical repo.
    assert.ok(fs.existsSync(path.join(w.DEST, 'repos', CANON, 'sessions', 'AWAY-1', 'note.json')));
    // _default shard preserved under repos/_default (reserved bucket).
    assert.ok(fs.existsSync(path.join(w.DEST, 'repos', '_default', 'sessions', 'LOOSE-1', 'costs.json')));
    // Root-level global + learnings imported path-for-path.
    assert.ok(fs.existsSync(path.join(w.DEST, 'global', 'patterns', 'p.md')));
    assert.ok(fs.existsSync(path.join(w.DEST, 'learnings', 'INDEX.md')));
    // Mutable timing/events classes imported; managed worktrees NEVER copied.
    assert.ok(fs.existsSync(path.join(w.DEST, 'timing', `${CANON}.jsonl`)), 'timing imported');
    assert.ok(fs.existsSync(path.join(w.DEST, 'events', CANON, 'e.jsonl')), 'events imported');
    assert.ok(!fs.existsSync(path.join(w.DEST, 'worktrees')), 'managed worktrees are never migrated');

    // Baseline KEEP file untouched (its exact duplicate dedups, no park).
    const keep = fs.readFileSync(path.join(w.DEST, 'repos', CANON, 'sessions', 'KEEP', 'wrap.json'), 'utf8');
    assert.ok(keep.includes('mega paragraph value kept as-is'));
    const marker = JSON.parse(fs.readFileSync(path.join(w.DEST, MARKER), 'utf8'));
    assert.equal(marker.migrationVersion, 3);
  } finally { cleanup(w.root); }
});

test('learnings merge is append-only with dedup and a content-addressed rollback backup', () => {
  const w = buildWorld();
  try {
    const workflow = path.join(w.DEST, 'repos', CANON, 'learnings', 'workflow.md');
    const beforeBytes = fs.readFileSync(workflow);
    const beforeHash = crypto.createHash('sha256').update(beforeBytes).digest('hex');

    const manifest = dryRun(w.env);
    const res = apply(w.env, saveManifest(w.root, manifest));
    assert.equal(res.status, 0, res.stderr);

    const merged = fs.readFileSync(workflow, 'utf8');
    assert.ok(merged.includes('baseline correction that must survive verbatim'), 'baseline preserved');
    assert.ok(merged.includes('a genuinely new learning line to append'), 'new line appended');
    assert.equal(merged.split('\n').filter((l) => l === 'shared-line').length, 1, 'shared line not duplicated');

    // Rollback backup holds the ORIGINAL bytes, content-addressed, with hashes recorded.
    const report = JSON.parse(fs.readFileSync(res.stdout.trim().split('-> ')[1], 'utf8'));
    const backupRec = report.rollbackBackups.find((b) => b.dest === workflow);
    assert.ok(backupRec, 'rollback backup recorded for the changed baseline file');
    assert.equal(backupRec.beforeHash, `sha256:${beforeHash}`, 'before hash recorded');
    assert.notEqual(backupRec.afterHash, backupRec.beforeHash, 'after hash differs (file changed)');
    assert.deepEqual(fs.readFileSync(backupRec.backup), beforeBytes, 'backup restores the exact original bytes');
  } finally { cleanup(w.root); }
});

test('the migrator SEEDS aliases from the live workspace and collapses a legacy id through mapRepoId', { skip: !HAS_GIT }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drm-seed-'));
  const DEST = path.join(root, 'gorkhali');
  const src = path.join(root, 'legacy-src');
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'drm-seed-repo-')));
  const rawRemote = 'git@github.com:Cloudzero/seeded-repo.git';
  const g = (args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  try {
    g(['init', '-q']);
    g(['remote', 'add', 'origin', rawRemote]);
    const canonicalId = codec.repoId(repo, { dataRoot: DEST });
    assert.match(canonicalId, /^seeded-repo-[0-9a-f]{10}$/, 'remote-backed canonical id');
    const legacyPlain = 'seeded-repo';

    // A source dir under the LEGACY plain id (an alias of the canonical id). No
    // session ran after the codec upgrade, so nothing has seeded the alias map yet.
    writeJson(path.join(src, 'repos', legacyPlain, 'sessions', 'S', 'wrap.json'), { legacy: true });

    const env = {
      ...process.env,
      GORKHALI_DATA: DEST,
      GORKHALI_MIGRATE_SRC_GORKHALI_DATA: src,
      GORKHALI_MIGRATE_SRC_GORKHALI: path.join(root, 'absent-a'),
      GORKHALI_MIGRATE_SRC_TEAM: path.join(root, 'absent-b'),
      GORKHALI_MIGRATE_SRC_CODEX_UPPER: path.join(root, 'absent-c'),
      GORKHALI_MIGRATE_SRC_CODEX_LOWER: path.join(root, 'absent-d'),
    };
    delete env.GORKHALI_REPO;

    // Run FROM the repo workspace so apply seeds the alias map from its identity.
    const dry = spawnSync(process.execPath, [SCRIPT], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(dry.status, 0, dry.stderr);
    const manifest = saveManifest(root, JSON.parse(dry.stdout));
    const res = spawnSync(process.execPath, [SCRIPT, '--apply', '--manifest', manifest],
      { cwd: repo, env, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);

    // The migrator seeded the alias map and mapRepoId collapsed the legacy id.
    const aliasMap = JSON.parse(fs.readFileSync(path.join(DEST, 'repos', '.aliases.json'), 'utf8'));
    assert.equal(aliasMap[legacyPlain], canonicalId, 'migrator persisted the legacy plain alias');
    assert.ok(fs.existsSync(path.join(DEST, 'repos', canonicalId, 'sessions', 'S', 'wrap.json')),
      'legacy source dir consolidated onto the canonical id');
    assert.ok(!fs.existsSync(path.join(DEST, 'repos', legacyPlain)),
      'nothing left under the pre-alias legacy id');
  } finally {
    cleanup(root);
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('the migrator collapses a legacy NO-REMOTE path-derived id onto the codec bare-basename id', { skip: !HAS_GIT }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drm-nore-'));
  const DEST = path.join(root, 'gorkhali');
  const src = path.join(root, 'legacy-src');
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'drm-nore-repo-')));
  const g = (args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  try {
    g(['init', '-q']); // NO remote -> the codec's no-remote (common-dir) identity path.

    const identity = codec.repoIdentity(repo, { dataRoot: DEST });
    const newId = identity.id;
    assert.equal(newId, path.basename(repo), 'the no-remote id is the bare main-root basename');
    // The pre-codec resolver hashed the realpath'd main root and prefixed the
    // sanitized, lowercased basename; the codec must record THAT exact id as the
    // sole alias so pre-upgrade state under it stays discoverable.
    const legacyId = `${codec.sanitizeName(path.basename(repo))}-${codec.shortHash(repo)}`;
    assert.deepEqual(identity.aliases, [legacyId], 'old path-derived id is the sole alias');
    assert.notEqual(legacyId, newId);

    // Pre-existing state lives under the OLD path-derived id; nothing has seeded the
    // alias map yet (no session ran after the codec upgrade).
    writeJson(path.join(src, 'repos', legacyId, 'sessions', 'S', 'wrap.json'), { legacy: true });

    const env = {
      ...process.env,
      GORKHALI_DATA: DEST,
      GORKHALI_MIGRATE_SRC_GORKHALI_DATA: src,
      GORKHALI_MIGRATE_SRC_GORKHALI: path.join(root, 'absent-a'),
      GORKHALI_MIGRATE_SRC_TEAM: path.join(root, 'absent-b'),
      GORKHALI_MIGRATE_SRC_CODEX_UPPER: path.join(root, 'absent-c'),
      GORKHALI_MIGRATE_SRC_CODEX_LOWER: path.join(root, 'absent-d'),
    };
    delete env.GORKHALI_REPO;

    // Run FROM the no-remote workspace so apply seeds the alias map from its identity.
    const dry = spawnSync(process.execPath, [SCRIPT], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(dry.status, 0, dry.stderr);
    const manifest = saveManifest(root, JSON.parse(dry.stdout));
    const res = spawnSync(process.execPath, [SCRIPT, '--apply', '--manifest', manifest],
      { cwd: repo, env, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);

    const aliasMap = JSON.parse(fs.readFileSync(path.join(DEST, 'repos', '.aliases.json'), 'utf8'));
    assert.equal(aliasMap[legacyId], newId, 'migrator persisted the no-remote legacy alias');
    assert.ok(fs.existsSync(path.join(DEST, 'repos', newId, 'sessions', 'S', 'wrap.json')),
      'legacy source dir consolidated onto the codec id');
    assert.ok(!fs.existsSync(path.join(DEST, 'repos', legacyId)),
      'nothing left under the old path-derived id');
  } finally {
    cleanup(root);
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a plain alias shared by two repos flips to AMBIGUOUS and the migrator leaves the shared dir unresolved', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drm-ambig-'));
  const DEST = path.join(root, 'gorkhali');
  const src = path.join(root, 'legacy-src');
  try {
    // Two DISTINCT canonical repos that share the plain basename 'shared-repo' (same
    // name, different owners). Detected in sequence, both legacy-claim the plain
    // alias; the SECOND must not silently last-write-win it.
    const canonA = hashedId('shared-repo', 'github.com/OwnerA/shared-repo');
    const canonB = hashedId('shared-repo', 'github.com/OwnerB/shared-repo');
    codec.recordAliases(DEST, { id: canonA, aliases: ['shared-repo'] });
    assert.equal(codec.resolveCanonical(DEST, 'shared-repo'), canonA, 'first detection claims the plain alias');
    codec.recordAliases(DEST, { id: canonB, aliases: ['shared-repo'] });

    // The plain alias is now ambiguous: resolveCanonical passes it through unchanged
    // and isAmbiguousAlias reports it -- it belongs to NEITHER repo now.
    assert.equal(codec.resolveCanonical(DEST, 'shared-repo'), 'shared-repo', 'ambiguous alias no longer collapses');
    assert.equal(codec.isAmbiguousAlias(DEST, 'shared-repo'), true, 'alias marked ambiguous');
    // A later re-detection of A must never resurrect the mapping.
    codec.recordAliases(DEST, { id: canonA, aliases: ['shared-repo'] });
    assert.equal(codec.isAmbiguousAlias(DEST, 'shared-repo'), true, 'ambiguity is permanent');
    assert.equal(codec.resolveCanonical(DEST, 'shared-repo'), 'shared-repo', 're-detection never un-ambiguates');

    // Legacy state under the shared plain dir: the migrator must import it under
    // NEITHER repo -- it classifies the dir unresolved (an explicit --map required).
    writeJson(path.join(src, 'repos', 'shared-repo', 'sessions', 'S', 'wrap.json'), { legacy: true });
    const env = {
      ...process.env,
      GORKHALI_DATA: DEST,
      GORKHALI_MIGRATE_SRC_GORKHALI_DATA: src,
      GORKHALI_MIGRATE_SRC_GORKHALI: path.join(root, 'absent-a'),
      GORKHALI_MIGRATE_SRC_TEAM: path.join(root, 'absent-b'),
      GORKHALI_MIGRATE_SRC_CODEX_UPPER: path.join(root, 'absent-c'),
      GORKHALI_MIGRATE_SRC_CODEX_LOWER: path.join(root, 'absent-d'),
    };
    delete env.GORKHALI_REPO;

    // cwd=root is not a git checkout, so the migrator's own seed is a no-op for
    // 'shared-repo' -- the pre-seeded ambiguity is what the mapper must honor.
    const dry = spawnSync(process.execPath, [SCRIPT], { cwd: root, env, encoding: 'utf8' });
    assert.equal(dry.status, 0, dry.stderr);
    const report = JSON.parse(dry.stdout);
    const unresolved = report.unresolvedIds.find((u) => u.id === 'shared-repo');
    assert.ok(unresolved, 'the shared plain dir is classified unresolved');
    assert.match(unresolved.reason, /ambiguous/, 'unresolved specifically for ambiguity');

    // Applying it must not attribute the dir to either repo.
    const manifest = saveManifest(root, report);
    const res = spawnSync(process.execPath, [SCRIPT, '--apply', '--manifest', manifest],
      { cwd: root, env, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(path.join(DEST, 'repos', canonA)), 'not imported under owner A');
    assert.ok(!fs.existsSync(path.join(DEST, 'repos', canonB)), 'not imported under owner B');
  } finally {
    cleanup(root);
  }
});

test('INDEX.md merge keeps ONE Auto-Captured header and the MAX validated count with the newest date', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drm-index-'));
  const DEST = path.join(root, 'gorkhali');
  const src = path.join(root, 'src');
  const id = 'index-repo';
  try {
    // Baseline INDEX.md: a shared lesson at [validated:2], an older date.
    write(path.join(DEST, 'repos', id, 'learnings', 'INDEX.md'),
      '# Learnings\n\n## Auto-Captured\n\nauto: shared lesson [validated:2] v:2 q:0.8 u:2026-07-01\n');
    // Source INDEX.md: SAME key at [validated:5] newer date, plus a NEW proposed entry.
    write(path.join(src, 'repos', id, 'learnings', 'INDEX.md'),
      '# Learnings\n\n## Auto-Captured\n\nauto: shared lesson [validated:5] v:5 q:0.9 u:2026-07-20\n'
      + 'auto: fresh lesson [proposed] v:0 q:0.3 u:2026-07-20\n');

    const env = {
      ...process.env,
      GORKHALI_DATA: DEST,
      GORKHALI_MIGRATE_SRC_GORKHALI_DATA: src,
      GORKHALI_MIGRATE_SRC_GORKHALI: path.join(root, 'absent-a'),
      GORKHALI_MIGRATE_SRC_TEAM: path.join(root, 'absent-b'),
      GORKHALI_MIGRATE_SRC_CODEX_UPPER: path.join(root, 'absent-c'),
      GORKHALI_MIGRATE_SRC_CODEX_LOWER: path.join(root, 'absent-d'),
    };
    const res = apply(env, saveManifest(root, dryRun(env)));
    assert.equal(res.status, 0, res.stderr);

    const merged = fs.readFileSync(path.join(DEST, 'repos', id, 'learnings', 'INDEX.md'), 'utf8');
    assert.equal((merged.match(/## Auto-Captured/g) || []).length, 1, 'exactly one Auto-Captured header');
    assert.equal(merged.split('\n').filter((l) => l.includes('shared lesson')).length, 1, 'the shared key is not duplicated');
    assert.match(merged, /auto: shared lesson \[validated:5\] v:5 q:0.9 u:2026-07-20/, 'max count + newest date wins');
    assert.match(merged, /auto: fresh lesson \[proposed\]/, 'the new source entry is merged in');
  } finally { cleanup(root); }
});

test('domain-file merge keeps ONE Validated Patterns header and preserves both sides bullets + corrections', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drm-domain-'));
  const DEST = path.join(root, 'gorkhali');
  const src = path.join(root, 'src');
  const id = 'domain-repo';
  const file = path.join('repos', id, 'learnings', 'workflow.md');
  try {
    write(path.join(DEST, file),
      '# Workflow Learnings\n\n## Validated Patterns\n\n'
      + '- pattern A always holds [validated:3] q:0.9 u:2026-07-01\n\n'
      + 'CORRECTION [alpha]: keep this correction verbatim.\n');
    write(path.join(src, file),
      '# Workflow Learnings\n\n## Validated Patterns\n\n'
      + '- pattern B also holds [validated:4] q:0.9 u:2026-07-10\n\n'
      + 'CORRECTION [beta]: a genuinely new correction.\n');

    const env = {
      ...process.env,
      GORKHALI_DATA: DEST,
      GORKHALI_MIGRATE_SRC_GORKHALI_DATA: src,
      GORKHALI_MIGRATE_SRC_GORKHALI: path.join(root, 'absent-a'),
      GORKHALI_MIGRATE_SRC_TEAM: path.join(root, 'absent-b'),
      GORKHALI_MIGRATE_SRC_CODEX_UPPER: path.join(root, 'absent-c'),
      GORKHALI_MIGRATE_SRC_CODEX_LOWER: path.join(root, 'absent-d'),
    };
    const res = apply(env, saveManifest(root, dryRun(env)));
    assert.equal(res.status, 0, res.stderr);

    const merged = fs.readFileSync(path.join(DEST, file), 'utf8');
    assert.equal((merged.match(/## Validated Patterns/g) || []).length, 1, 'exactly one Validated Patterns header');
    assert.equal(merged.split('\n').filter((l) => l.trim() === '# Workflow Learnings').length, 1, 'no injected mid-file title');
    assert.match(merged, /pattern A always holds/, 'baseline bullet preserved');
    assert.match(merged, /pattern B also holds/, 'source bullet merged under the single header');
    assert.match(merged, /CORRECTION \[alpha\]: keep this correction verbatim\./, 'baseline correction preserved');
    assert.match(merged, /CORRECTION \[beta\]: a genuinely new correction\./, 'source correction appended');
  } finally { cleanup(root); }
});

test('different-bytes collisions park deterministically under a source/content-hash suffix', () => {
  const w = buildWorld();
  try {
    const res = apply(w.env, saveManifest(w.root, dryRun(w.env)));
    assert.equal(res.status, 0, res.stderr);

    const dir = path.join(w.DEST, 'repos', CANON, 'sessions', 'IMPORT-1');
    // The winner (gorkhali-data, higher priority) occupies the canonical path.
    assert.match(fs.readFileSync(path.join(dir, 'wrap.json'), 'utf8'), /"imported": true/);
    // The team conflict is parked, never overwriting the winner.
    const parked = fs.readdirSync(dir).filter((n) => n.startsWith('wrap.json.from-team.'));
    assert.equal(parked.length, 1, 'team conflict parked under a source/content-hash suffix');
    assert.match(fs.readFileSync(path.join(dir, parked[0]), 'utf8'), /CONFLICTING-BYTES-from-team/);
  } finally { cleanup(w.root); }
});

test('unresolved repo ids are never guessed; --map resolves them explicitly', () => {
  const w = buildWorld();
  try {
    // Without --map: the unsafe-segment id is unresolved and NOT copied anywhere.
    const res1 = apply(w.env, saveManifest(w.root, dryRun(w.env)));
    assert.equal(res1.status, 0, res1.stderr);
    assert.ok(!fs.existsSync(path.join(w.DEST, 'repos', UNSAFE_ID)), 'unresolved id not migrated under its raw name');
    assert.ok(!fs.existsSync(path.join(w.DEST, 'repos', CANON, 'sessions', 'T', 'x.json')), 'unresolved id not guessed onto a repo');

    // With --map: it resolves to the named canonical repo.
    const mapped = dryRun(w.env, ['--map', `${UNSAFE_ID}=${CANON}`]);
    assert.equal(mapped.counts.byClass.unresolved, 0, 'the mapping resolves the last unresolved id');
    const res2 = apply(w.env, saveManifest(w.root, mapped), ['--force', '--map', `${UNSAFE_ID}=${CANON}`]);
    assert.equal(res2.status, 0, res2.stderr);
    assert.ok(fs.existsSync(path.join(w.DEST, 'repos', CANON, 'sessions', 'T', 'x.json')), 'mapped id migrated');
  } finally { cleanup(w.root); }
});

test('reruns are idempotent and rescan changed sources without duplicating', () => {
  const w = buildWorld();
  try {
    const res1 = apply(w.env, saveManifest(w.root, dryRun(w.env)));
    assert.equal(res1.status, 0, res1.stderr);

    // Second apply without --force: marker gates it.
    const res2 = apply(w.env, saveManifest(w.root, dryRun(w.env)));
    assert.match(res2.stdout, /already migrated/, 'marker makes a repeat apply a no-op');

    // A source file changes; a --force rerun rescans and imports only the new data.
    writeJson(path.join(w.gorkhaliData, 'repos', CANON, 'sessions', 'IMPORT-2', 'late.json'), { late: true });
    const before = snapshot(path.join(w.DEST, 'repos', CANON, 'sessions', 'IMPORT-1'));
    const res3 = apply(w.env, saveManifest(w.root, dryRun(w.env)), ['--force']);
    assert.equal(res3.status, 0, res3.stderr);
    assert.ok(fs.existsSync(path.join(w.DEST, 'repos', CANON, 'sessions', 'IMPORT-2', 'late.json')), 'new file imported');
    const after = snapshot(path.join(w.DEST, 'repos', CANON, 'sessions', 'IMPORT-1'));
    assert.deepEqual(after, before, 'already-imported data is not duplicated on rerun');
    // No stray second copy of the parked conflict.
    const parked = fs.readdirSync(path.join(w.DEST, 'repos', CANON, 'sessions', 'IMPORT-1'))
      .filter((n) => n.startsWith('wrap.json.from-team.'));
    assert.equal(parked.length, 1, 'rerun does not re-park an already-parked conflict');
  } finally { cleanup(w.root); }
});

test('apply fails closed without --apply, without a manifest, and on a manifest/dest mismatch', () => {
  const w = buildWorld();
  try {
    // --apply with no --manifest -> refused, nothing written.
    const noManifest = spawnSync(process.execPath, [SCRIPT, '--apply'], { env: w.env, encoding: 'utf8' });
    assert.notEqual(noManifest.status, 0, 'apply without a manifest is refused');
    assert.ok(!fs.existsSync(path.join(w.DEST, MARKER)), 'no marker written when refused');

    // A manifest generated for a different dest is rejected.
    const foreign = dryRun(w.env);
    foreign.dest = path.join(w.root, 'somewhere-else');
    const mismatch = apply(w.env, saveManifest(w.root, foreign));
    assert.notEqual(mismatch.status, 0, 'a foreign-dest manifest is refused');
    assert.ok(!fs.existsSync(path.join(w.DEST, MARKER)));
  } finally { cleanup(w.root); }
});

test('realpath-deduped sources: two env roots pointing at one dir are scanned once', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drm-alias-'));
  const DEST = path.join(root, 'gorkhali');
  const shared = path.join(root, 'one-dir');
  writeJson(path.join(shared, 'repos', OTHER, 'sessions', 'S', 'wrap.json'), { once: true });
  const env = {
    ...process.env,
    GORKHALI_DATA: DEST,
    GORKHALI_MIGRATE_SRC_CODEX_UPPER: shared,
    GORKHALI_MIGRATE_SRC_CODEX_LOWER: shared, // same realpath as upper
    GORKHALI_MIGRATE_SRC_GORKHALI_DATA: path.join(root, 'absent-a'),
    GORKHALI_MIGRATE_SRC_GORKHALI: path.join(root, 'absent-b'),
    GORKHALI_MIGRATE_SRC_TEAM: path.join(root, 'absent-c'),
  };
  try {
    const m = dryRun(env);
    const active = m.sources.filter((s) => s.present && !s.skipped);
    const aliased = m.sources.filter((s) => s.skipped && String(s.skipped).startsWith('alias-of'));
    assert.equal(active.length, 1, 'the shared dir is counted as a single source');
    assert.equal(aliased.length, 1, 'the duplicate case-variant is marked an alias, not rescanned');
    // Each file inventoried exactly once (no self-collision manufactured).
    assert.equal(m.items.filter((i) => i.srcRel.endsWith('wrap.json')).length, 1);
  } finally { cleanup(root); }
});

test('migration-wide lock: apply fails closed when a live lock is held, proceeds when stale', () => {
  const w = buildWorld();
  try {
    const lock = path.join(w.DEST, 'locks', '.data-migration.lock');
    write(lock, JSON.stringify({ pid: process.pid, token: 'live', created_at: new Date().toISOString() }));

    const held = apply(w.env, saveManifest(w.root, dryRun(w.env)));
    assert.match(held.stdout, /migration-wide lock/, 'apply skips while a live migration lock is held');
    assert.ok(!fs.existsSync(path.join(w.DEST, MARKER)), 'nothing migrated while locked');
    assert.ok(!fs.existsSync(path.join(w.DEST, 'repos', OTHER, 'sessions', 'OTH-1', 'wrap.json')), 'no writes while locked');

    // Age the lock past the staleness window -> reclaimed, migration proceeds.
    const old = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(lock, old, old);
    const proceed = apply(w.env, saveManifest(w.root, dryRun(w.env)), ['--force'],
      { GORKHALI_MIGRATE_LOCK_STALE_MS: '1' });
    assert.equal(proceed.status, 0, proceed.stderr);
    assert.ok(fs.existsSync(path.join(w.DEST, MARKER)), 'stale lock reclaimed and migration ran');
  } finally { cleanup(w.root); }
});

test('concurrent applies serialize: exactly one migrates, the other is a clean no-op', async () => {
  const w = buildWorld();
  try {
    const manifest = saveManifest(w.root, dryRun(w.env));
    const runOne = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SCRIPT, '--apply', '--manifest', manifest], { env: w.env });
      let stderr = '';
      child.stderr.on('data', (c) => { stderr += c; });
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stderr }));
    });
    const [a, b] = await Promise.all([runOne(), runOne()]);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, 0, b.stderr);
    // Exactly one wrote the marker; the tree is consistent and complete.
    assert.ok(fs.existsSync(path.join(w.DEST, MARKER)), 'the migration completed');
    assert.ok(fs.existsSync(path.join(w.DEST, 'repos', OTHER, 'sessions', 'OTH-1', 'wrap.json')), 'data landed exactly once');
    const applies = fs.readdirSync(path.join(w.DEST, 'audit')).filter((f) => f.startsWith('data-root-migration-v3-'));
    assert.equal(applies.length, 1, 'only one apply produced a report; the other was locked out or gated');
  } finally { cleanup(w.root); }
});

test('a state writer holding a repo lifecycle lock makes that repo fail closed (no unlocked write)', () => {
  const w = buildWorld();
  try {
    // Simulate gorkhali-state mid-mutation on OTHER: hold its lifecycle lock live.
    const repoLock = path.join(w.DEST, 'locks', `${OTHER}.lock`);
    write(repoLock, JSON.stringify({ pid: process.pid, token: 'live-writer', created_at: new Date().toISOString() }));

    const res = apply(w.env, saveManifest(w.root, dryRun(w.env)));
    assert.equal(res.status, 0, res.stderr);
    // OTHER's items are deferred (fail closed) -- never copied unlocked.
    assert.ok(!fs.existsSync(path.join(w.DEST, 'repos', OTHER, 'sessions', 'OTH-1', 'wrap.json')),
      'the locked repo is not migrated under contention');
    const report = JSON.parse(fs.readFileSync(res.stdout.trim().split('-> ')[1], 'utf8'));
    assert.ok(report.actions.some((a) => a.applied === 'deferred' && /repo-lifecycle-lock/.test(a.reason || '')),
      'the deferral is recorded in the manifest');
    // A different, unlocked repo still migrates.
    assert.ok(fs.existsSync(path.join(w.DEST, 'repos', CANON, 'sessions', 'IMPORT-1', 'wrap.json')),
      'unlocked repos are unaffected');
  } finally { cleanup(w.root); }
});

test('a concurrent learnings writer holding the T3 lock defers the merge (baseline unchanged)', () => {
  const w = buildWorld();
  try {
    // Hold the T3 per-learnings-dir lock live, exactly as gorkhali-learning would
    // mid-write. The migration routes its merge through withLearningLock, so it
    // must fail closed rather than merge unlocked.
    const learningsDir = path.join(w.DEST, 'repos', CANON, 'learnings');
    const workflow = path.join(learningsDir, 'workflow.md');
    const before = fs.readFileSync(workflow);
    write(path.join(learningsDir, '.learning.lock'),
      JSON.stringify({ pid: process.pid, token: 'live-learner', created_at: new Date().toISOString() }) + '\n');

    const res = apply(w.env, saveManifest(w.root, dryRun(w.env)));
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(fs.readFileSync(workflow), before, 'the baseline learnings file is not merged unlocked');
    const report = JSON.parse(fs.readFileSync(res.stdout.trim().split('-> ')[1], 'utf8'));
    assert.ok(report.actions.some((a) => a.applied === 'deferred' && /learnings-lock/.test(a.reason || '')),
      'the learnings deferral is recorded');
  } finally { cleanup(w.root); }
});

test('valid current-session pointers are reconstructed to the canonical root; invalid ones are classified but not copied', () => {
  const w = buildWorld();
  const workspace = path.join(w.root, 'workspace');
  try {
    mkdirp(workspace);
    // A real git repo so the workspace resolves to a canonical (non-_default) id.
    spawnSync('git', ['-C', workspace, 'init', '-q'], { encoding: 'utf8' });
    // Create a genuine active session in the gorkhali-data SOURCE root.
    const legacyEnv = { ...w.env, GORKHALI_DATA: w.gorkhaliData };
    const started = runPortable(legacyEnv, [
      'start', '--workspace', workspace, '--task', 'MIG-1',
      '--intent', 'Preserve active session discovery across the migration', '--route', 'direct',
    ]);
    const legacyPointer = path.join(w.gorkhaliData, 'state', 'current-session', `${started.repo_id}.json`);
    // Invalid pointers that must each be classified skipped-live-state, never copied:
    // a legacy-hook schema, an unknown schema, and an unsafe-segment portable-v1.
    writeJson(path.join(w.gorkhali, 'state', 'current-session', 'legacy.json'),
      { session_id: 'old-session', cwd: w.root, ticket: 'OLD-1' });
    writeJson(path.join(w.gorkhali, 'state', 'current-session', 'unknown.json'), { arbitrary: 'marker' });
    writeJson(path.join(w.team, 'state', 'current-session', 'repo.json'),
      { schema_version: 1, repo_id: 'repo', task_id: '..' });

    const res = apply(w.env, saveManifest(w.root, dryRun(w.env)));
    assert.equal(res.status, 0, res.stderr);

    // Reconstructed pointer lands at the canonical root, remapped to the dest dir.
    const destPointer = path.join(w.DEST, 'state', 'current-session', `${started.repo_id}.json`);
    const pointer = JSON.parse(fs.readFileSync(destPointer, 'utf8'));
    assert.equal(pointer.schema_version, 2);
    assert.equal(pointer.focus_task_id, 'MIG-1');
    assert.equal(
      pointer.tasks['MIG-1'].session_dir,
      path.join(w.DEST, 'repos', started.repo_id, 'sessions', 'MIG-1'),
    );

    // The session is resumable from the canonical root.
    const status = runPortable({ ...w.env, GORKHALI_DATA: w.DEST }, ['status', '--workspace', workspace]);
    assert.equal(status.task_id, 'MIG-1');
    assert.equal(status.status, 'active');

    // Every invalid pointer is classified skipped-live-state and never copied.
    assert.ok(!fs.existsSync(path.join(w.DEST, 'state', 'current-session', 'legacy.json')));
    assert.ok(!fs.existsSync(path.join(w.DEST, 'state', 'current-session', 'unknown.json')));
    const report = reportOf(res);
    const pointerReasons = report.items.filter((i) => i.kind === 'pointer').map((i) => i.reason || '');
    assert.ok(pointerReasons.some((r) => /unsupported-legacy-hook/.test(r)), 'legacy-hook pointer classified');
    assert.ok(pointerReasons.some((r) => /unsupported-unknown/.test(r)), 'unknown-schema pointer classified');
    assert.ok(pointerReasons.some((r) => /unsafe-pointer-segment/.test(r)), 'unsafe-segment pointer classified');
    // The source pointer is preserved byte-for-byte.
    assert.ok(fs.existsSync(legacyPointer), 'external source pointer is preserved');
  } finally { cleanup(w.root); }
});

test('while the migration holds the T3 learnings lock, a concurrent capture fails closed', () => {
  const w = buildWorld();
  try {
    const learningsDir = path.join(w.DEST, 'repos', CANON, 'learnings');
    mkdirp(learningsDir);
    // Hold the learnings lock as the "migration" would, then attempt a capture.
    write(path.join(learningsDir, '.learning.lock'),
      JSON.stringify({ pid: process.pid, token: 'migration-holds', created_at: new Date().toISOString() }) + '\n');
    const capture = spawnSync(process.execPath, [LEARNING, 'capture', '--learnings', learningsDir], {
      input: JSON.stringify([{ dedup_key: 'k', entry: 'e', confidence: 0.9, domain: 'workflow' }]),
      encoding: 'utf8',
    });
    assert.notEqual(capture.status, 0, 'the learning writer fails closed rather than writing unlocked');
  } finally { cleanup(w.root); }
});
