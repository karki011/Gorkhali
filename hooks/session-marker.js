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

let stateDir, detectRepo;
try {
  ({ stateDir, detectRepo } = require('../scripts/lib/phantom-paths'));
} catch (_) {
  const os = require('os');
  const data = process.env.PHANTOM_DATA || path.join(os.homedir(), '.claude', 'phantom-data');
  stateDir = () => path.join(data, 'state');
  detectRepo = () => (process.env.PHANTOM_REPO || '_default');
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

try {
  const payload = readPayload();
  const sessionId = payload.session_id;
  if (sessionId) {
    const cwd = payload.cwd || process.cwd();
    const repo = detectRepo(cwd);
    const dir = path.join(stateDir(), 'current-session');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, repo + '.json');
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ session_id: sessionId, cwd, ts: Date.now() }));
    fs.renameSync(tmp, file);
  }
} catch (_) { /* silent — never block the prompt */ }

process.exit(0);
