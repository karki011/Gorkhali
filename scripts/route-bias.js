#!/usr/bin/env node
// Author: Subash Karki
// route-bias.js - close the router's measurement loop: read the outcome corpus
// and PROPOSE the next correction.bias for reference/router/algorithm.md's
// `adjusted_uncertainty = uncertainty * (1 + correction.bias)`.
//
// The rule, deliberately simple and stated in full:
//   per SESSION route, over route_source='explicit' records ONLY (route-report's
//   attribution wall - a defaulted route measures the default, not a decision):
//     verified pass rate < 0.70  -> signal +1 (this route needs MORE ceremony)
//     verified pass rate >= 0.90 -> signal -1 (this route earns LESS ceremony)
//     otherwise                  -> signal  0 (hold)
//   delta = 0.10 x the record-weighted mean of the signals; the proposal is
//   current + delta clamped to [-0.3, +0.3] (the algorithm's documented bounds).
//
// HONESTY: below MIN_SAMPLE explicit records the corpus cannot tune anything,
// so the script REFUSES to propose (dry-run says so, --apply exits 2). Sample
// sizes print next to every rate. Cost stats ride along only where the ticket
// ledger priced (cost-report.js); unknown cost is null, never $0.
//
// DRY-RUN FIRST (the migrate-*.js pattern): default prints current bias,
// proposed bias, the per-route evidence, and the exact learnings entry it would
// write. --apply appends that entry to <data>/repos/<repo>/learnings/shadows.md
// (the routing-history the algorithm's correction reads) in learning-grammar
// shape. Current bias is the newest `PATTERN [routing-bias]` entry there, else 0.
//
// Usage: route-bias.js [--json] [--apply] [--min-sample <n>] [--learnings <dir>]
// Exit codes: 0 = proposal or refusal printed / applied; 2 = usage error, or
// --apply refused (insufficient sample); 1 = unexpected internal error.

'use strict';

const fs = require('fs');
const path = require('path');
const { PhantomError, reportError, VALIDATION_ERROR } = require('./lib/axi-error');
const { phantomData, learningsDir, detectRepo } = require('./lib/phantom-paths');
const { findOutcomeDirs, extractRecord } = require('./route-report');
const { spendForTicket } = require('./cost-report');
const { parseLearningEntries } = require('./lib/learning-grammar.cjs');

const MIN_SAMPLE = 10; // explicit-route records; small samples must not tune the router
const PASS_LOW = 0.7;
const PASS_HIGH = 0.9;
const STEP = 0.1;
const BIAS_LIMIT = 0.3;
const BIAS_KEYWORD = 'routing-bias';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

/** Newest recorded routing bias in a shadows.md text, or 0 when none exists. */
function currentBias(shadowsText) {
  const entries = parseLearningEntries(shadowsText || '');
  let bias = 0;
  for (const entry of entries) {
    if (entry.type !== 'pattern' || entry.keyword !== BIAS_KEYWORD) continue;
    const match = /correction\.bias\s+([+-]?\d+(?:\.\d+)?)/.exec(entry.content || '');
    if (match) bias = Number(match[1]);
  }
  return bias;
}

function newRouteStats() {
  return { records: 0, passed: 0, costN: 0, costSum: 0 };
}

/** Per-route explicit-only stats over the corpus, with the cost join. */
async function gatherEvidence(dataRoot) {
  const dirs = findOutcomeDirs(dataRoot);
  const routes = Object.create(null);
  let explicit = 0;
  let unattributable = 0;
  const spendCache = new Map();

  for (const dir of dirs.canonical) {
    const rec = extractRecord(dir);
    if (!rec) continue;
    if (rec.route_source !== 'explicit' || rec.route == null) {
      unattributable += 1;
      continue;
    }
    explicit += 1;
    const stats = (routes[rec.route] ||= newRouteStats());
    stats.records += 1;
    if (rec.verified === 'pass') stats.passed += 1;

    const [repo, , ticket] = path.relative(path.join(dataRoot, 'repos'), dir).split(path.sep);
    const key = `${repo}\0${ticket}`;
    if (!spendCache.has(key)) {
      try {
        spendCache.set(key, await spendForTicket(ticket, repo));
      } catch (_) {
        spendCache.set(key, { usd: null });
      }
    }
    const spend = spendCache.get(key);
    if (spend && typeof spend.usd === 'number') {
      stats.costN += 1;
      stats.costSum += spend.usd;
    }
  }
  return { routes, explicit, unattributable };
}

/** Signal per route and the weighted proposal. Pure - no I/O. */
function propose(evidence) {
  const perRoute = Object.create(null);
  let weightedSignals = 0;
  let totalRecords = 0;
  for (const route of Object.keys(evidence.routes).sort()) {
    const s = evidence.routes[route];
    const passRate = s.records > 0 ? s.passed / s.records : null;
    const signal = passRate === null ? 0 : passRate < PASS_LOW ? 1 : passRate >= PASS_HIGH ? -1 : 0;
    perRoute[route] = {
      records: s.records,
      passed: s.passed,
      pass_rate: passRate,
      cost: { n: s.costN, mean: s.costN > 0 ? round2(s.costSum / s.costN) : null },
      signal,
    };
    weightedSignals += signal * s.records;
    totalRecords += s.records;
  }
  const delta = totalRecords > 0 ? round2(STEP * (weightedSignals / totalRecords)) : 0;
  return { perRoute, totalRecords, delta };
}

/** The exact learnings line --apply writes. Grammar: PATTERN [kw]: body (date). */
function formatEntry(proposedBias, proposal, date) {
  const sign = proposedBias >= 0 ? '+' : '';
  const evidence = Object.entries(proposal.perRoute)
    .map(([route, r]) => `${route} ${r.passed}/${r.records} pass`)
    .join(', ');
  return `PATTERN [${BIAS_KEYWORD}]: correction.bias ${sign}${proposedBias.toFixed(2)}`
    + ` - measured over explicit-route outcomes (${evidence}) (${date})`;
}

function buildProposal(dataRoot, evidence, proposal, current, minSample) {
  const proposed = round2(clamp(current + proposal.delta, -BIAS_LIMIT, BIAS_LIMIT));
  return {
    data_root: dataRoot,
    min_sample: minSample,
    sample: { explicit: evidence.explicit, unattributable: evidence.unattributable },
    sufficient: evidence.explicit >= minSample,
    current_bias: current,
    delta: proposal.delta,
    proposed_bias: proposed,
    per_route: proposal.perRoute,
    entry: formatEntry(proposed, proposal, new Date().toISOString().slice(0, 10)),
  };
}

function renderHuman(result) {
  const lines = [
    'Route bias proposal (dry-run)' ,
    `data root: ${result.data_root}`,
    `sample: ${result.sample.explicit} explicit-route record(s)`
      + ` (+${result.sample.unattributable} unattributable, never used)`,
    '',
  ];
  if (!result.sufficient) {
    lines.push(
      `REFUSED: ${result.sample.explicit} explicit record(s) < min sample ${result.min_sample}.`,
      'A small sample must not tune the router. Record more explicit-route outcomes first.',
    );
    return lines.join('\n') + '\n';
  }
  for (const [route, r] of Object.entries(result.per_route)) {
    lines.push(
      `route: ${route}`,
      `  pass rate        over ${r.records} record(s): ${(r.pass_rate * 100).toFixed(1)}% (${r.passed}/${r.records})`,
      `  cost             over ${r.cost.n} record(s): `
        + (r.cost.mean === null ? 'no priced cost data' : `mean $${r.cost.mean.toFixed(2)}`),
      `  signal           ${r.signal > 0 ? '+' : ''}${r.signal}`,
    );
  }
  lines.push(
    '',
    `current bias:    ${result.current_bias >= 0 ? '+' : ''}${result.current_bias.toFixed(2)}`,
    `proposed delta:  ${result.delta >= 0 ? '+' : ''}${result.delta.toFixed(2)}`,
    `proposed bias:   ${result.proposed_bias >= 0 ? '+' : ''}${result.proposed_bias.toFixed(2)} (clamped to ±${BIAS_LIMIT})`,
    '',
    'learnings entry this would write:',
    `  ${result.entry}`,
    '',
    'dry-run only - re-run with --apply to write it.',
  );
  return lines.join('\n') + '\n';
}

function usageError(msg) {
  return new PhantomError(`ERROR: ${msg}`, VALIDATION_ERROR, [
    'Usage: route-bias.js [--json] [--apply] [--min-sample <n>] [--learnings <dir>]',
  ]);
}

function parseArgs(argv) {
  const opts = { json: false, apply: false, minSample: MIN_SAMPLE, learnings: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--apply') opts.apply = true;
    else if (a === '--min-sample') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw usageError('--min-sample requires a positive integer');
      opts.minSample = n;
    } else if (a === '--learnings') {
      opts.learnings = argv[++i];
      if (!opts.learnings) throw usageError('--learnings requires a path');
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else {
      throw usageError(`unknown option: ${a}`);
    }
  }
  return opts;
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(
      'route-bias - propose the router correction.bias from measured per-route outcomes\n\n'
      + 'Usage: node scripts/route-bias.js [--json] [--apply] [--min-sample <n>] [--learnings <dir>]\n\n'
      + 'Default is DRY-RUN: prints current bias, proposed bias, per-route evidence,\n'
      + 'and the exact learnings entry. --apply appends it to shadows.md.\n',
    );
    return;
  }

  const dataRoot = phantomData();
  const learnings = opts.learnings || learningsDir(detectRepo());
  const shadows = path.join(learnings, 'shadows.md');
  let shadowsText = '';
  try {
    shadowsText = fs.readFileSync(shadows, 'utf8');
  } catch (_) { /* no routing history yet - current bias is 0 */ }

  const evidence = await gatherEvidence(dataRoot);
  const proposal = propose(evidence);
  const result = buildProposal(dataRoot, evidence, proposal, currentBias(shadowsText), opts.minSample);

  if (opts.apply && !result.sufficient) {
    throw new PhantomError(
      `ERROR: refusing to apply: ${result.sample.explicit} explicit record(s) < min sample ${opts.minSample}.`,
      VALIDATION_ERROR,
    );
  }
  if (opts.apply) {
    fs.mkdirSync(learnings, { recursive: true });
    const prefix = shadowsText && !shadowsText.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(shadows, `${shadowsText}${prefix}${result.entry}\n`);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ...result, applied: !!opts.apply }, null, 2) + '\n');
  } else {
    process.stdout.write(renderHuman(result));
    if (opts.apply) process.stdout.write(`applied: appended to ${shadows}\n`);
  }
}

if (require.main === module) {
  main(process.argv).catch((err) => reportError(err));
}

module.exports = { currentBias, propose, formatEntry, buildProposal, MIN_SAMPLE, BIAS_LIMIT };
