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

let stateDir, detectRepo, gorkhaliData, learningsDir, sessionTelemetryDir;
try {
  ({ stateDir, detectRepo, gorkhaliData, learningsDir, sessionTelemetryDir } = require('../scripts/lib/gorkhali-paths'));
} catch (_) {
  const base = process.cwd();
  const data = process.env.GORKHALI_DATA
    ? path.resolve(base, process.env.GORKHALI_DATA)
    : process.env.HOME
      ? path.resolve(base, process.env.HOME, '.gorkhali')
      : path.join(base, '.gorkhali');
  stateDir = () => path.join(data, 'state');
  detectRepo = () => (process.env.GORKHALI_REPO || '_default');
  gorkhaliData = () => data;
  learningsDir = (repo) => path.join(data, 'repos', repo, 'learnings');
  sessionTelemetryDir = () => path.join(data, 'state', 'session-telemetry');
}

let sweepStaleArtifacts;
try {
  ({ sweepStaleArtifacts } = require('../scripts/lib/atomic'));
} catch (_) {
  sweepStaleArtifacts = () => 0; // atomic.js missing -> sweep is a no-op, never block the prompt
}

// Auto-run: consolidate branch-named orphan repo dirs into their canonical dirs.
// This is idempotent, marker-gated, and safe to run every prompt.
//
// The cross-root DATA-ROOT migration (scripts/migrate-data.js) is deliberately NOT
// auto-applied here: it is dry-run-FIRST and its apply is an explicitly gated,
// operator-reviewed step (a prior dry-run manifest is required, and the real apply
// is signed off separately). The prompt path never auto-mutates the accumulated
// cross-root knowledge; it only runs the in-root repo-dirs sweep.
function maybeSweepRepoDirs() {
  try {
    const dataRoot = gorkhaliData();
    const repoMarker = path.join(dataRoot, '.repo-dirs-migrated');
    if (fs.existsSync(repoMarker)) return;
    const script = path.join(__dirname, '..', 'scripts', 'migrate-repo-dirs.js');
    if (!fs.existsSync(script)) return;
    const args = [script, '--apply'];
    if (process.env.GORKHALI_MIGRATE_SYNC) {
      spawnSync(process.execPath, args, { stdio: 'ignore', timeout: 30000 });
    } else {
      const child = spawn(process.execPath, args, { stdio: 'ignore', detached: true });
      child.on('error', () => {});
      child.unref();
    }
  } catch (_) { /* silent - the sweep must never break a prompt */ }
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
    // Runtime telemetry lives under state/session-telemetry, NOT
    // state/current-session. The latter holds the durable portable task pointer
    // written by gorkhali-state.mjs; keeping them on separate paths makes it
    // physically impossible for a per-prompt telemetry write to clobber the
    // active task pointer.
    const dir = sessionTelemetryDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, repo + '.json');
    maybeSweepStaleLocks(file, sessionId, repo);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ session_id: sessionId, cwd, ts: Date.now() }));
    fs.renameSync(tmp, file);
  }
} catch (_) { /* silent — never block the prompt */ }

// Runs after the primary marker job so a sweep hiccup can never affect it.
maybeSweepRepoDirs();

process.exit(0);
