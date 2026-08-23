#!/usr/bin/env node
// Author: Subash Karki
// timing-report.js — aggregate agent timing captured by hooks/timing-capture.js.
//
// Answers two questions:
//   1. Is Chief's model routing actually firing? (exact: spawn counts per model)
//   2. Do downshifted models cut wall-clock? (approximate: per-model durations from paired spawn->stop)
//
// Usage:
//   node scripts/timing-report.js                 # auto-detect repo, full report
//   node scripts/timing-report.js --routing       # just the model split (no pairing)
//   node scripts/timing-report.js --repo NAME     # pick a specific repo log
//   node scripts/timing-report.js --since 2026-06-05
//
// Pairing: exact when the harness supplies a tool_use id on both events; otherwise
// FIFO per session — which keeps per-model COUNTS exact but makes individual
// durations approximate when background agents run in parallel. Caveat is printed.

const fs = require('fs');
const path = require('path');
const { timingDir, detectRepo } = require('./lib/gorkhali-paths');

function parseArgs() {
  const a = { routing: false, repo: '', since: '' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--routing') a.routing = true;
    else if (argv[i] === '--repo') a.repo = argv[++i] || '';
    else if (argv[i] === '--since') a.since = argv[++i] || '';
  }
  return a;
}

function resolveFile(repoArg) {
  const dir = timingDir();
  if (repoArg) {
    const f = path.join(dir, `${repoArg}.jsonl`);
    if (!fs.existsSync(f)) { console.error(`No timing log for repo "${repoArg}" (${f}).`); process.exit(1); }
    return f;
  }
  const detected = path.join(dir, `${detectRepo()}.jsonl`);
  if (fs.existsSync(detected)) return detected;
  // fall back: if exactly one repo log exists, use it; else guide the user
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch (_) {}
  if (files.length === 1) return path.join(dir, files[0]);
  if (files.length === 0) { console.error(`No timing logs in ${dir}. Run a Gorkhali session first.`); process.exit(1); }
  console.error(`Multiple repos logged. Pass one with --repo:\n  ${files.map((f) => f.replace(/\.jsonl$/, '')).join('\n  ')}`);
  process.exit(1);
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
const fmt = (ms) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`);
// bucket across eras: records with modelSource 'session' (or legacy records missing modelSource)
// fall in the 'inherited' bucket; records with modelSource 'param' or 'pinned' count under their
// real tier. 'opus(inherited)' is kept for backward compat with old logs.
const norm = (m, modelSource) => {
  // Legacy records (no modelSource) and session-inherited records → 'inherited' bucket.
  if (!modelSource || modelSource === 'session') {
    return m === 'inherited' || m === 'opus(inherited)' ? 'inherited' : m;
  }
  // param or pinned: count under real model tier.
  if (m === 'inherited' || m === 'opus(inherited)') return 'inherited';
  if (m.startsWith('opus')) return 'opus';
  if (m.startsWith('fable')) return 'fable';
  return m;
};

function main() {
  const args = parseArgs();
  const file = resolveFile(args.repo);
  const sinceMs = args.since ? Date.parse(`${args.since}T00:00:00Z`) : 0;

  const spawns = [];
  const stops = [];
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch (_) { continue; }
    if (sinceMs && Date.parse(r.ts) < sinceMs) continue;
    (r.event === 'stop' ? stops : spawns).push(r);
  }

  // ── Routing split (exact) ──────────────────────────────────────────────
  const byModel = {};
  for (const s of spawns) {
    const m = norm(s.model || 'inherited', s.modelSource);
    byModel[m] = byModel[m] || { count: 0, durations: [] };
    byModel[m].count++;
  }
  const total = spawns.length;

  console.log(`\n  Gorkhali agent timing — ${path.basename(file, '.jsonl')}${args.since ? ` (since ${args.since})` : ''}`);
  console.log(`  ${total} spawns, ${stops.length} stops\n`);
  console.log('  MODEL ROUTING (exact)');
  for (const m of Object.keys(byModel).sort((a, b) => byModel[b].count - byModel[a].count)) {
    const c = byModel[m].count;
    const pct = total ? Math.round((c / total) * 100) : 0;
    console.log(`    ${m.padEnd(16)} ${String(c).padStart(4)}  ${String(pct).padStart(3)}%  ${'█'.repeat(Math.round(pct / 4))}`);
  }

  if (args.routing) { console.log(''); return; }

  // ── Pair spawn -> stop (by id, else FIFO per session) ──────────────────
  const stopById = new Map();
  for (const st of stops) if (st.id) stopById.set(st.id, st);
  const openBySid = {}; // sid -> queue of unpaired spawns (FIFO fallback)
  const fifoStops = {};  // sid -> queue of stops without id
  for (const st of stops) if (!st.id) (fifoStops[st.sid] = fifoStops[st.sid] || []).push(st);

  let pairedById = 0, pairedByFifo = 0;
  for (const sp of spawns) {
    let stop = sp.id ? stopById.get(sp.id) : null;
    if (stop) pairedById++;
    else {
      const q = fifoStops[sp.sid];
      if (q && q.length) { stop = q.shift(); pairedByFifo++; }
    }
    if (!stop) continue;
    const dur = Date.parse(stop.ts) - Date.parse(sp.ts);
    if (dur >= 0) byModel[norm(sp.model || 'inherited', sp.modelSource)].durations.push(dur);
  }

  console.log('\n  DURATION PER MODEL (paired spawn→stop)');
  console.log(`    ${'model'.padEnd(16)} ${'n'.padStart(4)}  ${'avg'.padStart(7)}  ${'median'.padStart(7)}  ${'total'.padStart(8)}`);
  for (const m of Object.keys(byModel).sort()) {
    const d = byModel[m].durations;
    if (!d.length) { console.log(`    ${m.padEnd(16)} ${'0'.padStart(4)}      —        —         —`); continue; }
    const avg = Math.round(d.reduce((a, b) => a + b, 0) / d.length);
    const tot = d.reduce((a, b) => a + b, 0);
    console.log(`    ${m.padEnd(16)} ${String(d.length).padStart(4)}  ${fmt(avg).padStart(7)}  ${fmt(median(d)).padStart(7)}  ${fmt(tot).padStart(8)}`);
  }

  const pairing = pairedById >= pairedByFifo ? 'tool-use id (exact)' : 'FIFO per session (approximate for parallel agents)';
  console.log(`\n  Pairing: ${pairing}. Counts above are exact; durations are indicative when agents run in parallel.\n`);
}

try { main(); } catch (e) { console.error(`timing-report: ${e.message}`); process.exit(1); }
