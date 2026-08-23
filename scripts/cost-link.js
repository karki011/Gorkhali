#!/usr/bin/env node
// Author: Subash Karki
// cost-link.js — bind the current Claude session to a ticket's cost ledger.
//
// Usage:
//   node cost-link.js open  <TICKET>   # gorkhali:start / gorkhali:resume
//   node cost-link.js close <TICKET>   # gorkhali:pause / gorkhali:wrap
//
// Reads the current session_id from the marker written by hooks/session-marker.js
// and upserts an interval entry into <sessions>/<TICKET>/costs.json:
//   { ticket, entries: [{ session_id, opened_at, closed_at? }] }
//
// Intervals (not whole sessions) are attributed so one Claude session that
// touches two tickets doesn't double-count. scripts/cost-report.js sums
// telemetry events inside these intervals. Always exits 0 — cost tracking
// must never block the workflow.

'use strict';

const fs = require('fs');
const path = require('path');
const { sessionTelemetryFile, sessionsDir, detectRepo } = require('./lib/gorkhali-paths');

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (_) { return null; }
}

function atomicWrite(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

const [action, ticket] = process.argv.slice(2);
if (!action || !ticket || !['open', 'close'].includes(action)) {
  process.stderr.write('usage: cost-link.js open|close <TICKET>\n');
  process.exit(0);
}

try {
  const repo = detectRepo();
  const marker = loadJson(sessionTelemetryFile(repo));
  const ticketDir = path.join(sessionsDir(repo), ticket);
  fs.mkdirSync(ticketDir, { recursive: true });
  const ledgerPath = path.join(ticketDir, 'costs.json');
  const ledger = loadJson(ledgerPath) || { ticket, entries: [] };
  const now = Date.now();

  if (action === 'open') {
    if (!marker || !marker.session_id) {
      process.stderr.write('cost-link: no session marker for repo ' + repo + ' — skipping\n');
      process.exit(0);
    }
    const alreadyOpen = ledger.entries.some(
      (e) => e.session_id === marker.session_id && !e.closed_at
    );
    if (!alreadyOpen) {
      ledger.entries.push({ session_id: marker.session_id, opened_at: now });
      atomicWrite(ledgerPath, ledger);
    }
  } else {
    let changed = false;
    for (const e of ledger.entries) {
      if (!e.closed_at) { e.closed_at = now; changed = true; }
    }
    if (changed) atomicWrite(ledgerPath, ledger);
  }
} catch (err) {
  process.stderr.write('cost-link: ' + err.message + '\n');
}

process.exit(0);
