#!/usr/bin/env node
// Author: Subash Karki
// cost-report.js — AI cost summary for a ticket from local telemetry.
//
// Usage: node cost-report.js <TICKET> [--repo <name>]
//
// Reads the interval ledger written by cost-link.js
// (<sessions>/<TICKET>/costs.json) and sums estimated_cost_usd from the
// CloudZero agent-telemetry event log (~/.claude/telemetry.jsonl) for events
// whose session_id + timestamp fall inside a ledger interval. Open intervals
// extend to now. Prints a compact human report; always exits 0.
//
// Caveat: the OTEL exporter batches (~60s), so totals can trail live work by
// up to a minute. A staleness warning prints if the telemetry file looks dead.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { sessionsDir, detectRepo } = require('./lib/phantom-paths');

const TELEMETRY_FILE =
  process.env.CLAUDE_TELEMETRY_FILE || path.join(os.homedir(), '.claude', 'telemetry.jsonl');
const STALE_MS = 10 * 60 * 1000;

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

const args = process.argv.slice(2);
const ticket = args[0];
const repoFlag = args.indexOf('--repo');
const repo = repoFlag !== -1 ? args[repoFlag + 1] : detectRepo();

if (!ticket) {
  process.stderr.write('usage: cost-report.js <TICKET> [--repo <name>]\n');
  process.exit(0);
}

async function main() {
  const ledgerPath = path.join(sessionsDir(repo), ticket, 'costs.json');
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
  } catch (_) {
    console.log(`AI cost — ${ticket}: no cost ledger yet (${ledgerPath})`);
    return;
  }
  if (!Array.isArray(ledger.entries) || ledger.entries.length === 0) {
    console.log(`AI cost — ${ticket}: ledger has no linked sessions yet`);
    return;
  }

  let telemetryMtime = 0;
  try { telemetryMtime = fs.statSync(TELEMETRY_FILE).mtimeMs; } catch (_) {
    console.log(`AI cost — ${ticket}: telemetry log not found (${TELEMETRY_FILE}) — is the collector running?`);
    return;
  }

  const now = Date.now();
  // Per-session accumulators keyed by session_id.
  const bySession = new Map();
  for (const e of ledger.entries) {
    if (!bySession.has(e.session_id)) {
      bySession.set(e.session_id, { cost: 0, inTok: 0, outTok: 0, events: 0, first: null, last: null, intervals: [] });
    }
    bySession.get(e.session_id).intervals.push([e.opened_at, e.closed_at || now]);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(TELEMETRY_FILE),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch (_) { continue; }
    const acc = bySession.get(ev.session_id);
    if (!acc) continue;
    if (!acc.intervals.some(([a, b]) => ev.timestamp >= a && ev.timestamp <= b)) continue;
    acc.cost += ev.estimated_cost_usd || 0;
    acc.inTok += ev.input_tokens || 0;
    acc.outTok += ev.output_tokens || 0;
    acc.events += 1;
    if (acc.first === null || ev.timestamp < acc.first) acc.first = ev.timestamp;
    if (acc.last === null || ev.timestamp > acc.last) acc.last = ev.timestamp;
  }

  let total = 0;
  const lines = [];
  for (const [sid, acc] of bySession) {
    total += acc.cost;
    const day = acc.first ? new Date(acc.first).toISOString().slice(0, 10) : '—';
    lines.push(
      `  ${sid.slice(0, 8)}  ${day}  $${acc.cost.toFixed(2)}` +
        (acc.events ? `  (in ${fmtTokens(acc.inTok)} / out ${fmtTokens(acc.outTok)} tok, ${acc.events} calls)` : '  (no telemetry yet)')
    );
  }

  console.log(`AI cost — ${ticket}`);
  for (const l of lines) console.log(l);
  console.log(`  Total: $${total.toFixed(2)} across ${bySession.size} session(s)`);
  const hasOpen = ledger.entries.some((e) => !e.closed_at);
  if (hasOpen && now - telemetryMtime > STALE_MS) {
    console.log('  ⚠ telemetry log is stale (>10 min) — collector may be down; total likely undercounts');
  }
}

main().catch((err) => {
  process.stderr.write('cost-report: ' + err.message + '\n');
  process.exit(0);
});
