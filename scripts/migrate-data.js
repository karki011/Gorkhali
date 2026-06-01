#!/usr/bin/env node
// Author: Subash Karki
// migrate-data.js — one-time, idempotent, non-destructive migration of legacy
// Phantom mutable state into the new stable data root (PHANTOM_DATA).
//
// Legacy roots:
//   P1  ~/.claude/team     — JS-hook data root
//   P2  ~/.claude/phantom  — repo clone; we copy ONLY its data subdirs, never code.
//
// Copies (recursively) a fixed WHITELIST of data subdirs/files from each legacy
// root into PHANTOM_DATA. Sources are never modified or deleted. On a per-file
// collision in DEST the NEWER mtime wins; conflicts are recorded in the report.
//
// Idempotency: writes a `.migrated` marker; subsequent runs no-op (unless --force).
//
// Env overrides (for testing):
//   PHANTOM_DATA                  — destination root (via phantom-paths resolver)
//   PHANTOM_MIGRATE_SRC_TEAM      — override P1 source (default ~/.claude/team)
//   PHANTOM_MIGRATE_SRC_PHANTOM   — override P2 source (default ~/.claude/phantom)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { phantomData } = require('./lib/phantom-paths');

// Data-only whitelist. Code dirs (commands/agents/hooks/scripts/reference/
// templates/evals) and root files (*.md/*.html/install.sh/setup.sh/
// .git) are deliberately absent so they are NEVER copied.
const WHITELIST_DIRS = [
  'sessions',
  'state',
  'observations',
  'learnings',
  'audit',
  'repos',
  'global',
];
const WHITELIST_FILES = ['config.yaml'];

const DEST = phantomData();
const MARKER = path.join(DEST, '.migrated');
const REPORT = path.join(DEST, '.migration-report.json');

const SRC_TEAM =
  process.env.PHANTOM_MIGRATE_SRC_TEAM ||
  path.join(os.homedir(), '.claude', 'team');
const SRC_PHANTOM =
  process.env.PHANTOM_MIGRATE_SRC_PHANTOM ||
  path.join(os.homedir(), '.claude', 'phantom');

const FORCE = process.argv.includes('--force');

/** Recursively copy `src` file/dir into `dest`, applying newer-mtime collision
 *  policy on files. Mutates `stats` in place. */
function copyTree(src, dest, sourceLabel, stats) {
  const st = fs.statSync(src);

  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyTree(
        path.join(src, entry),
        path.join(dest, entry),
        sourceLabel,
        stats
      );
    }
    return;
  }

  if (!st.isFile()) {
    stats.skipped++;
    return; // symlinks, sockets, etc. — skip
  }

  let destStat = null;
  try { destStat = fs.statSync(dest); } catch {}
  if (destStat) {
    const destMtime = destStat.mtimeMs;
    const srcWins = st.mtimeMs > destMtime;
    stats.conflicts.push({
      src,
      dest,
      source: sourceLabel,
      srcMtime: st.mtimeMs,
      destMtime,
      won: srcWins ? sourceLabel : 'existing',
    });
    if (!srcWins) {
      stats.skipped++;
      return; // keep existing (newer-or-equal) file
    }
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  fs.utimesSync(dest, st.atime, st.mtime); // preserve mtime for future runs
  stats.copied++;
  stats.bySubdir[sourceLabel] = stats.bySubdir[sourceLabel] || {};
  const top = path.relative(DEST, dest).split(path.sep)[0];
  stats.bySubdir[sourceLabel][top] =
    (stats.bySubdir[sourceLabel][top] || 0) + 1;
}

/** Copy the whitelist from one legacy `srcRoot` into DEST. */
function migrateSource(srcRoot, sourceLabel, stats) {
  if (!fs.existsSync(srcRoot)) {
    return; // legacy root absent — nothing to do
  }
  for (const dir of WHITELIST_DIRS) {
    const src = path.join(srcRoot, dir);
    let srcStat = null;
    try { srcStat = fs.statSync(src); } catch {}
    if (srcStat && srcStat.isDirectory()) {
      copyTree(src, path.join(DEST, dir), sourceLabel, stats);
    }
  }
  for (const file of WHITELIST_FILES) {
    const src = path.join(srcRoot, file);
    let srcStat = null;
    try { srcStat = fs.statSync(src); } catch {}
    if (srcStat && srcStat.isFile()) {
      copyTree(src, path.join(DEST, file), sourceLabel, stats);
    }
  }
}

function main() {
  if (fs.existsSync(MARKER) && !FORCE) {
    console.log('  ○ migration: already migrated (skipping)');
    return 0;
  }

  fs.mkdirSync(DEST, { recursive: true });

  // Process P1 (team) first, then P2 (phantom) — order matters: later sources
  // resolve DEST collisions by mtime against what earlier sources already copied.
  const SOURCES = [
    { label: 'team', root: SRC_TEAM },
    { label: 'phantom', root: SRC_PHANTOM },
  ];

  const stats = {};
  for (const { label, root } of SOURCES) {
    stats[label] = { copied: 0, skipped: 0, conflicts: [], bySubdir: {} };
    migrateSource(root, label, stats[label]);
  }

  const sources = {};
  const conflicts = [];
  let totalCopied = 0;
  for (const { label, root } of SOURCES) {
    const s = stats[label];
    sources[label] = { root, copied: s.copied, skipped: s.skipped, bySubdir: s.bySubdir };
    conflicts.push(...s.conflicts);
    totalCopied += s.copied;
  }

  const report = {
    migratedAt: new Date().toISOString(),
    dest: DEST,
    sources,
    conflicts,
    whitelist: { dirs: WHITELIST_DIRS, files: WHITELIST_FILES },
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

  fs.writeFileSync(
    MARKER,
    JSON.stringify(
      {
        migratedAt: report.migratedAt,
        sources: SOURCES.map(s => s.root),
        copied: totalCopied,
      },
      null,
      2
    )
  );

  const perSource = SOURCES.map(s => `${s.label}=${stats[s.label].copied}`).join(', ');
  console.log(
    `  ✓ migration: copied ${totalCopied} files ` +
      `(${perSource}, conflicts=${report.conflicts.length}) → ${DEST}`
  );
  return 0;
}

process.exit(main());
