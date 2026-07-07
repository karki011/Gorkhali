#!/usr/bin/env node
// Author: Subash Karki
// session-marker.js — UserPromptSubmit hook that records the current Claude
// session_id per repo. Hooks receive session_id on stdin; in-session bash does
// not (no CLAUDE_SESSION_ID env), so this marker is how skill-driven scripts
// (scripts/cost-link.js) bind a ticket to the session working on it.
//
// Writes <data>/state/current-session/<repo>.json = { session_id, cwd, ts }.
// Silent + never throws — must never break a prompt.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

let stateDir, detectRepo, phantomData, learningsDir;
try {
  ({ stateDir, detectRepo, phantomData, learningsDir } = require('../scripts/lib/phantom-paths'));
} catch (_) {
  const os = require('os');
  const data = process.env.PHANTOM_DATA || path.join(os.homedir(), '.claude', 'phantom-data');
  stateDir = () => path.join(data, 'state');
  detectRepo = () => (process.env.PHANTOM_REPO || '_default');
  phantomData = () => data;
  learningsDir = (repo) => path.join(data, 'repos', repo, 'learnings');
}

let sweepStaleArtifacts;
try {
  ({ sweepStaleArtifacts } = require('../scripts/lib/atomic'));
} catch (_) {
  sweepStaleArtifacts = () => 0; // atomic.js missing -> sweep is a no-op, never block the prompt
}

// Cut-over auto-run: on the FIRST prompt after the detection fix ships, sweep the
// branch-named orphan repo dirs into their canonical dirs so detection and data
// agree in one version (per [guards]: gate is cheap, the RUN is wrapped and can
// never block the prompt). Marker-gated so we spawn the migrator at most once;
// the migrator itself is independently idempotent.
function maybeMigrateRepoDirs() {
  try {
    const marker = path.join(phantomData(), '.repo-dirs-migrated');
    if (fs.existsSync(marker)) return; // already migrated — skip the spawn entirely
    const script = path.join(__dirname, '..', 'scripts', 'migrate-repo-dirs.js');
    if (!fs.existsSync(script)) return;
    const opts = { stdio: 'ignore', timeout: 30000 };
    if (process.env.PHANTOM_MIGRATE_SYNC) {
      spawnSync(process.execPath, [script, '--apply'], opts); // deterministic for tests
    } else {
      const child = spawn(process.execPath, [script, '--apply'], { ...opts, detached: true });
      child.unref(); // fire-and-forget: never delays the prompt
    }
  } catch (_) { /* silent — migration must never break a prompt */ }
}

function readPayload() {
  const sources = [
    () => fs.readFileSync(0, 'utf-8'),
    () => process.argv[3],
    () => process.argv[2],
  ];
  for (const get of sources) {
    try {
      const raw = get();
      if (raw && String(raw).trim().startsWith('{')) return JSON.parse(raw);
    } catch (_) { /* try next source */ }
  }
  return {};
}

// First-prompt-of-session sweep: reclaim orphaned `*.lock.stale.<pid>.<nonce>`
// takeover artifacts (scripts/lib/atomic.js sweepStaleArtifacts) from this repo's
// learnings dir - the only path anything in this repo ever locks (memory-writer/
// memory-consolidator's INDEX.md). Gated on the marker's PREVIOUS session_id so
// it fires once per session, not once per prompt; best-effort, never blocks.
function maybeSweepStaleLocks(markerFile, sessionId, repo) {
  try {
    const prev = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    if (prev && prev.session_id === sessionId) return; // same session, already swept
  } catch (_) { /* missing/corrupt marker -> treat as a new session, sweep */ }
  try {
    sweepStaleArtifacts(learningsDir(repo));
  } catch (_) { /* best-effort - never block the prompt */ }
}

try {
  const payload = readPayload();
  const sessionId = payload.session_id;
  if (sessionId) {
    const cwd = payload.cwd || process.cwd();
    const repo = detectRepo(cwd);
    const dir = path.join(stateDir(), 'current-session');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, repo + '.json');
    maybeSweepStaleLocks(file, sessionId, repo);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ session_id: sessionId, cwd, ts: Date.now() }));
    fs.renameSync(tmp, file);
  }
} catch (_) { /* silent — never block the prompt */ }

// Runs after the primary marker job so a migration hiccup can never affect it.
maybeMigrateRepoDirs();

process.exit(0);
