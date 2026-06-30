#!/usr/bin/env node
// Author: Subash Karki
// cost-report.js — AI cost summary for a ticket from Claude Code transcripts.
//
// Usage: node cost-report.js <TICKET> [--repo <name>]
//
// Reads the interval ledger written by cost-link.js
// (<sessions>/<TICKET>/costs.json) and prices each session's token usage from
// the local Claude Code transcript JSONL (~/.claude/projects/<cwd>/<sid>.jsonl).
// For every assistant line whose timestamp falls inside a ledger interval, the
// usage block (input / output / cache-read / cache-write tokens) is priced via
// the inline table below. Open intervals (no closed_at) extend to now.
//
// Transcripts are written live, so totals track current work closely — only the
// very last assistant turn may not be flushed to disk yet. Subagent lines
// (isSidechain:true) are real spend and ARE counted. Always exits 0.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { sessionsDir, stateDir, detectRepo } = require('./lib/phantom-paths');

const COST_MODEL_VERSION = '2026-06-30';

// USD per MILLION tokens. Longest-prefix match on lowercased model id.
// Cache read ~= 0.1x input, cache write (5m) ~= 1.25x input.
// Source: Anthropic public pricing. Opus 4.5+ dropped to $5/$25; Opus 4.0/4.1 stay $15/$75.
const PRICES = [
  { prefix: 'claude-opus-4-8', in: 5.0, out: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  { prefix: 'claude-opus-4-7', in: 5.0, out: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  { prefix: 'claude-opus-4-6', in: 5.0, out: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  { prefix: 'claude-opus-4-5', in: 5.0, out: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  { prefix: 'claude-opus-4', in: 15.0, out: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  { prefix: 'claude-opus', in: 15.0, out: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  { prefix: 'claude-fable-5', in: 10.0, out: 50.0, cacheRead: 1.0, cacheWrite: 12.5 },
  { prefix: 'claude-mythos-5', in: 10.0, out: 50.0, cacheRead: 1.0, cacheWrite: 12.5 },
  { prefix: 'claude-sonnet-4', in: 3.0, out: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  { prefix: 'claude-sonnet', in: 3.0, out: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  { prefix: 'claude-haiku-4', in: 1.0, out: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
  { prefix: 'claude-haiku', in: 0.25, out: 1.25, cacheRead: 0.025, cacheWrite: 0.3125 },
];

function priceFor(model) {
  const id = String(model || '').toLowerCase();
  let best = null;
  for (const p of PRICES) {
    if (id.startsWith(p.prefix) && (!best || p.prefix.length > best.prefix.length)) best = p;
  }
  return best;
}

function lineCost(model, usage) {
  const p = priceFor(model);
  if (!p) return 0;
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  return (
    (inTok * p.in + outTok * p.out + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) / 1e6
  );
}

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (_) { return null; }
}

/** All transcript files named <sid>.jsonl under any ~/.claude/projects/<cwd>/ dir. */
function transcriptsFor(sessionId) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const found = [];
  let dirs;
  try { dirs = fs.readdirSync(root); } catch (_) { return found; }
  for (const d of dirs) {
    const file = path.join(root, d, sessionId + '.jsonl');
    if (fs.existsSync(file)) found.push(file);
  }
  return found;
}

const args = process.argv.slice(2);
const ticket = args[0];
const repoFlag = args.indexOf('--repo');
const repo = repoFlag !== -1 ? args[repoFlag + 1] : detectRepo();

if (!ticket) {
  process.stderr.write('usage: cost-report.js <TICKET> [--repo <name>]\n');
  process.exit(0);
}

async function accumulate(acc, file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch (_) { continue; }
    if (ev.type !== 'assistant' || !ev.message || !ev.message.usage) continue;
    const ts = Date.parse(ev.timestamp);
    if (Number.isNaN(ts)) continue;
    if (!acc.intervals.some(([a, b]) => ts >= a && ts <= b)) continue;
    const usage = ev.message.usage;
    acc.cost += lineCost(ev.message.model, usage);
    acc.inTok += usage.input_tokens || 0;
    acc.outTok += usage.output_tokens || 0;
    acc.events += 1;
    if (acc.first === null || ts < acc.first) acc.first = ts;
  }
}

async function main() {
  const now = Date.now();
  const ledgerPath = path.join(sessionsDir(repo), ticket, 'costs.json');
  const ledger = loadJson(ledgerPath);

  // Per-session accumulators keyed by session_id.
  const bySession = new Map();
  let fallbackNote = null;

  const hasEntries = ledger && Array.isArray(ledger.entries) && ledger.entries.length > 0;
  if (hasEntries) {
    for (const e of ledger.entries) {
      if (!bySession.has(e.session_id)) {
        bySession.set(e.session_id, { cost: 0, inTok: 0, outTok: 0, events: 0, first: null, intervals: [] });
      }
      bySession.get(e.session_id).intervals.push([e.opened_at, e.closed_at || now]);
    }
  } else {
    // No ledger — fall back to the current-session marker, whole transcript.
    const marker = loadJson(path.join(stateDir(), 'current-session', repo + '.json'));
    if (marker && marker.session_id) {
      bySession.set(marker.session_id, { cost: 0, inTok: 0, outTok: 0, events: 0, first: null, intervals: [[0, now]] });
      fallbackNote = '(no ledger — showing current session only)';
    } else {
      const why = ledger ? 'ledger has no linked sessions yet' : `no cost ledger yet (${ledgerPath})`;
      console.log(`AI cost — ${ticket}: ${why}`);
      return;
    }
  }

  for (const [sid, acc] of bySession) {
    const files = transcriptsFor(sid);
    acc.noTranscript = files.length === 0;
    for (const f of files) await accumulate(acc, f);
  }

  let total = 0;
  const lines = [];
  for (const [sid, acc] of bySession) {
    total += acc.cost;
    const day = acc.first ? new Date(acc.first).toISOString().slice(0, 10) : '—';
    let suffix;
    if (acc.noTranscript) suffix = '  (transcript not found)';
    else if (acc.events) suffix = `  (in ${fmtTokens(acc.inTok)} / out ${fmtTokens(acc.outTok)} tok, ${acc.events} calls)`;
    else suffix = '  (no transcript activity in window)';
    lines.push(`  ${sid.slice(0, 8)}  ${day}  $${acc.cost.toFixed(2)}${suffix}`);
  }

  console.log(`AI cost — ${ticket}`);
  if (fallbackNote) console.log(`  ${fallbackNote}`);
  for (const l of lines) console.log(l);
  console.log(`  Total: $${total.toFixed(2)} across ${bySession.size} session(s)`);
}

main().catch((err) => {
  process.stderr.write('cost-report: ' + err.message + '\n');
  process.exit(0);
});
