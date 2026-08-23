#!/usr/bin/env node
// Author: Subash Karki
// cost-report.js — AI cost summary for a ticket from Claude Code transcripts.
//
// Claude-transcript-only: every number below comes from ~/.claude/projects
// JSONL written by the claude-code host. Kimi sessions write no such
// transcripts, so host=kimi spend is simply invisible here (pricedSessions 0,
// usd null) — the kimi-k3 row in the price table is a stub for the day a kimi
// transcript reader exists, not a live data path.
//
// Usage: node cost-report.js <TICKET> [--repo <name>] [--fields a,b,c] [--full] [--help]
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
// (isSidechain:true) are real spend and ARE counted.
//
// Output is one plain object rendered once via render-output.js's render() -
// no console.log mid-computation. `--fields`/`--full` narrow the default
// {ticket, count, sessions, Total} down to or beyond that set (fields.js).
// `Total` stays capitalized (not `total`) because commands/status.md and
// friends grep this script's stdout for the literal `Total:` line - renaming
// it would silently break every caller that shells out to this script.
// Validation failures (bad --fields, unknown flags) exit 2; everything else
// (missing ledger, no ticket) exits 0 - this is an advisory report and must
// never break the skill that invoked it.
//
// Also exports spendForTicket() so scripts/run-guard.js can ENFORCE against the
// same numbers this report prints, instead of forking the price table.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { sessionsDir, completedDir, sessionTelemetryFile, detectRepo } = require('./lib/phantom-paths');
const { render } = require('./lib/render-output');
const { resolveFields, pickFields } = require('./lib/fields');
const { PhantomError, reportError, VALIDATION_ERROR } = require('./lib/axi-error');

const COST_MODEL_VERSION = '2026-06-30';

// USD per MILLION tokens. Longest-prefix match on lowercased model id.
// Cache read ~= 0.1x input, cache write (5m) ~= 1.25x input.
// Source: Anthropic public pricing. Opus 5 and Opus 4.5+ are $5/$25; Opus 4.0/4.1 stay $15/$75.
const PRICES = [
  { prefix: 'claude-opus-5', in: 5.0, out: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
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
  // Kimi stub (host=kimi). UNVERIFIED against Moonshot's published table:
  // kimi-k3 is reported at $3/M input, $0.30/M cached input, $15/M output; no
  // cache-write rate is published, hence 0. Inert on the claude-code path —
  // Claude transcripts never carry kimi model ids.
  { prefix: 'kimi-k3', in: 3.0, out: 15.0, cacheRead: 0.3, cacheWrite: 0 },
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

const DEFAULT_FIELDS = ['ticket', 'count', 'sessions', 'Total'];
const ALL_FIELDS = ['ticket', 'note', 'count', 'sessions', 'Total'];

const HELP =
  'cost-report - AI cost summary for a ticket from Claude Code transcripts\n\n' +
  'Usage: node cost-report.js <TICKET> [--repo <name>] [--fields a,b,c] [--full]\n\n' +
  `Fields: ${ALL_FIELDS.join(', ')} (default: ${DEFAULT_FIELDS.join(', ')})\n\n` +
  'Examples:\n' +
  '  node cost-report.js CP-12345\n' +
  '  node cost-report.js CP-12345 --repo feature-web-apps\n' +
  '  node cost-report.js CP-12345 --fields ticket,Total\n';

/**
 * buildResult(ticket, repo) -> { full, help }
 *
 * Computes the full result object (every ALL_FIELDS key this ticket can
 * populate) plus any contextual next-step hints. No printing happens here -
 * that's the caller's job, once, at the boundary.
 */
async function buildResult(ticket, repo) {
  const now = Date.now();
  // The ledger lives beside the record: sessions/<ticket> while active,
  // completed/<ticket> after wrap archives it. An active ticket's ledger wins;
  // a completed ticket's costs.json travels with its record.
  const ledgerPath = path.join(sessionsDir(repo), ticket, 'costs.json');
  let ledger = loadJson(ledgerPath);
  if (!ledger) {
    ledger = loadJson(path.join(completedDir(repo), ticket, 'costs.json'));
  }

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
    // No ledger - fall back to the runtime session-telemetry marker, whole transcript.
    const marker = loadJson(sessionTelemetryFile(repo));
    if (marker && marker.session_id) {
      bySession.set(marker.session_id, { cost: 0, inTok: 0, outTok: 0, events: 0, first: null, intervals: [[0, now]] });
      fallbackNote = 'no ledger - showing current session only';
    } else {
      const why = ledger ? 'ledger has no linked sessions yet' : `no cost ledger yet (${ledgerPath})`;
      return {
        full: { ticket, note: `0 sessions found for ${ticket}: ${why}`, count: { count: 0 } },
        help: [`Run \`node scripts/cost-link.js open ${ticket}\` to start tracking cost for this ticket`],
        spend: { usd: null, pricedSessions: 0, reason: why },
      };
    }
  }

  for (const [sid, acc] of bySession) {
    const files = transcriptsFor(sid);
    acc.noTranscript = files.length === 0;
    for (const f of files) await accumulate(acc, f);
  }

  let total = 0;
  let pricedSessions = 0;
  const rows = [];
  for (const [sid, acc] of bySession) {
    total += acc.cost;
    if (acc.events > 0) pricedSessions += 1;
    const day = acc.first ? new Date(acc.first).toISOString().slice(0, 10) : '—';
    let suffix;
    if (acc.noTranscript) suffix = '  (transcript not found)';
    else if (acc.events) suffix = `  (in ${fmtTokens(acc.inTok)} / out ${fmtTokens(acc.outTok)} tok, ${acc.events} calls)`;
    else suffix = '  (no transcript activity in window)';
    rows.push(`${sid.slice(0, 8)}  ${day}  $${acc.cost.toFixed(2)}${suffix}`);
  }

  return {
    full: {
      ticket,
      ...(fallbackNote ? { note: fallbackNote } : {}),
      count: { count: pricedSessions, totalCount: bySession.size },
      sessions: rows.join('\n  '),
      Total: `$${total.toFixed(2)} across ${bySession.size} session(s)`,
    },
    // Machine-readable sibling of `Total`, for callers that must ACT on spend
    // rather than print it (scripts/run-guard.js). usd is a number ONLY when at
    // least one session was actually priced from a transcript; otherwise null +
    // a reason. A $0.00 total with zero priced sessions is "unknown", NOT zero —
    // conflating those two would let an unreadable ledger read as free.
    spend: pricedSessions > 0
      ? { usd: total, pricedSessions, reason: null }
      : {
        usd: null,
        pricedSessions: 0,
        reason: `no transcript activity priced for ${bySession.size} linked session(s)`,
      },
    help: fallbackNote
      ? [`Total reflects the current session only (${fallbackNote}) - run \`node scripts/cost-link.js open ${ticket}\` to track full multi-session history.`]
      : [],
  };
}

async function main(ticket, repo, resolvedFields) {
  const { full, help } = await buildResult(ticket, repo);
  const projected = pickFields(full, resolvedFields);
  for (const key of Object.keys(projected)) {
    if (projected[key] === undefined) delete projected[key];
  }
  if (help.length > 0) projected.help = help;
  process.stdout.write(render(projected) + '\n');
}

/**
 * Spend for one ticket as { usd, pricedSessions, reason } — `usd` is null, never
 * 0, when it cannot be determined. The one export of this file: scripts/run-guard.js
 * needs spend as a NUMBER to compare against a ceiling, and re-deriving pricing
 * there would fork the price table. Same reader, same prices, one source.
 */
async function spendForTicket(ticket, repo) {
  const { spend } = await buildResult(ticket, repo);
  return spend || { usd: null, pricedSessions: 0, reason: 'cost-report produced no spend block' };
}

module.exports = { spendForTicket };

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    process.stderr.write(HELP);
    process.exit(0);
  }

  const KNOWN_FLAGS = new Set(['--repo', '--fields', '--full']);
  const flagValue = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };

  const unknownFlags = args.filter((a) => a.startsWith('--') && !KNOWN_FLAGS.has(a));
  if (unknownFlags.length > 0) {
    reportError(new PhantomError(
      `Unknown flag(s): ${unknownFlags.join(', ')}. Known flags: ${[...KNOWN_FLAGS].sort().join(', ')}, --help`,
      VALIDATION_ERROR,
    ));
    return;
  }

  const ticket = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
  if (!ticket) {
    process.stderr.write('usage: cost-report.js <TICKET> [--repo <name>] [--fields a,b,c] [--full] [--help]\n');
    process.exit(0);
  }

  const repo = flagValue('--repo') || detectRepo();

  let resolvedFields;
  try {
    resolvedFields = resolveFields({
      fieldsArg: flagValue('--fields'),
      full: args.includes('--full'),
      defaultFields: DEFAULT_FIELDS,
      allFields: ALL_FIELDS,
    });
  } catch (err) {
    reportError(err);
    return;
  }

  main(ticket, repo, resolvedFields).catch((err) => {
    process.stderr.write('cost-report: ' + err.message + '\n');
    process.exit(0);
  });
}
