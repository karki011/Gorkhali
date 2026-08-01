#!/usr/bin/env node
// Author: Subash Karki
// session-marker.js — UserPromptSubmit hook that records the current Claude
// session_id per repo. Hooks receive session_id on stdin; in-session bash does
// not (no CLAUDE_SESSION_ID env), so this marker is how skill-driven scripts
// (scripts/cost-link.js) bind a ticket to the session working on it.
//
// Writes <data>/state/session-telemetry/<repo>.json = { session_id, cwd, ts }.
// Silent + never throws — must never break a prompt.

'use strict';

const fs = require('fs');
const path = require('path');

let detectRepo, learningsDir, sessionTelemetryDir;
try {
  ({ detectRepo, learningsDir, sessionTelemetryDir } = require('../scripts/lib/phantom-paths'));
} catch (_) {
  const base = process.cwd();
  const data = process.env.PHANTOM_DATA
    ? path.resolve(base, process.env.PHANTOM_DATA)
    : process.env.HOME
      ? path.resolve(base, process.env.HOME, '.phantom')
      : path.join(base, '.phantom');
  detectRepo = () => {
    const repo = String(process.env.PHANTOM_REPO || '_default').trim();
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,119}$/.test(repo) || repo === '.' || repo === '..') {
      throw new TypeError('PHANTOM_REPO must be one safe path segment.');
    }
    return repo;
  };
  learningsDir = (repo) => path.join(data, 'repos', repo, 'learnings');
  sessionTelemetryDir = () => path.join(data, 'state', 'session-telemetry');
}

let atomicWrite, sweepStaleArtifacts;
try {
  ({ atomicWrite, sweepStaleArtifacts } = require('../scripts/lib/atomic'));
} catch (_) {
  atomicWrite = null;
  sweepStaleArtifacts = () => 0; // atomic.js missing -> sweep is a no-op, never block the prompt
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
// learnings dir - the only path anything in this repo ever locks (memory-writer's
// INDEX.md). Gated on the marker's PREVIOUS session_id so
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
    // written by phantom-state.mjs; keeping them on separate paths makes it
    // physically impossible for a per-prompt telemetry write to clobber the
    // active task pointer.
    const dir = sessionTelemetryDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, repo + '.json');
    maybeSweepStaleLocks(file, sessionId, repo);
    const content = JSON.stringify({ session_id: sessionId, cwd, ts: Date.now() });
    if (!atomicWrite) throw new Error('atomic session marker writer is unavailable');
    atomicWrite(file, content);
  }
} catch (_) { /* silent — never block the prompt */ }

process.exit(0);
