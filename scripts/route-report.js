#!/usr/bin/env node
// Author: Subash Karki
// route-report.js - score the router: aggregate per-ticket outcome records by the
// SESSION route (lite | direct | plan | brainstorm | full) so route effectiveness can be
// read from the corpus. The route here is the one phantom-state.mjs records in
// session.json and outcome-write.js copies into outcome.json - it is NOT the
// solo|shadows EXECUTION route in wrap.json/plan.json.
//
// This tool is READ-ONLY: this script has NO side effects. It never writes,
// migrates, or repairs anything.
//
// Corpus: every canonical record dir <data>/repos/<repo>/{sessions,completed}/
// <ticket>/ (exactly depth 3) holding an outcome.json. When an outcome.json
// predates the route field, route/route_source fall back to the session.json in
// the same dir. Nested and off-bucket outcome copies are counted and reported,
// never aggregated. Unparseable JSON is skipped and counted, never fatal.
//
// HONESTY: only records whose route_source is 'explicit' measure a routing
// DECISION. Records whose route_source is 'default', 'unknown', or unset measure
// the router's DEFAULT, not a choice. Both outputs carry that caveat, print the
// explicit-vs-unattributable split per route, and state every sample size before
// the rate computed over it.
//
// COST JOIN: where the record's ticket has a cost ledger priced by
// cost-report.js, the priced USD total/mean rides alongside the outcome metrics
// per attribution class. The join states its own coverage (n of records);
// uncosted records never enter the mean, and an unpriceable ledger is unknown,
// never $0.
//
// Usage: route-report.js [--json]
//   --json  emit the stable machine shape instead of the human table
// Data root: ${PHANTOM_DATA:-~/.phantom} via scripts/lib/phantom-paths.js.
//
// Exit codes: 0 = report produced (including an empty corpus); 2 = unknown flag
// or unexpected argument; 1 = unexpected internal error (via reportError).

'use strict';

const fs = require('fs');
const path = require('path');
const { PhantomError, reportError, VALIDATION_ERROR } = require('./lib/axi-error');
const { phantomData } = require('./lib/phantom-paths');
const { spendForTicket } = require('./cost-report');

// Label used when a field is absent, so distributions stay countable instead of
// dropping records with an undefined key.
const UNSET = '(unset)';

// The closed route_source vocabulary written by phantom-state.mjs / outcome-write.js.
const ROUTE_SOURCE = ['explicit', 'default', 'unknown'];

// ── Corpus discovery ────────────────────────────────────────────────────────

// One walk of <data>/repos collecting every dir that holds an outcome.json, keyed
// by path shape exactly like baseline-report.js's findRecordDirs:
//   canonical  <repo>/{sessions,completed}/<ticket>/  (depth 3) - aggregated
//   nested     the same plus runs/<run>/ etc.         - counted, never aggregated
//   offBucket  anything else                          - counted, never aggregated
function findOutcomeDirs(dataRoot) {
  const reposRoot = path.join(dataRoot, 'repos');
  const canonical = [];
  let nestedCopies = 0;
  let offBucket = 0;

  function walk(dir, segments) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    const bucketed = segments.length >= 3 && (segments[1] === 'sessions' || segments[1] === 'completed');
    let hasOutcome = false;
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name), segments.concat(e.name));
      else if (e.name === 'outcome.json') hasOutcome = true;
    }
    if (!hasOutcome) return;
    if (!bucketed) offBucket += 1;
    else if (segments.length === 3) canonical.push(dir);
    else nestedCopies += 1;
  }

  walk(reposRoot, []);
  return { canonical, nestedCopies, offBucket };
}

// ── Record extraction ───────────────────────────────────────────────────────

// Parse one canonical record dir into {route, route_source, pr_state, verified,
// fix_loops, review_comments}. Route falls back to session.json ONLY when the
// outcome.json predates the field (route key absent entirely, not null - a null
// route is a real recorded answer). Returns null when outcome.json is
// unparseable; the caller counts the skip.
function extractRecord(dir) {
  let outcome;
  try {
    outcome = JSON.parse(fs.readFileSync(path.join(dir, 'outcome.json'), 'utf8'));
  } catch (_) {
    return null;
  }
  if (outcome == null || typeof outcome !== 'object' || Array.isArray(outcome)) return null;

  let route = typeof outcome.route === 'string' ? outcome.route : null;
  let source = ROUTE_SOURCE.includes(outcome.route_source) ? outcome.route_source : null;
  if (!('route' in outcome)) {
    // outcome.json predates the route field: fall back to the session.json in the
    // same record dir. Skipping the fallback would silently drop every record
    // written before route telemetry existed.
    let session = null;
    try {
      session = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
    } catch (_) { /* no session.json (or half-written) - route stays unset */ }
    if (session != null && typeof session === 'object' && !Array.isArray(session)) {
      if (typeof session.route === 'string') route = session.route;
      if (ROUTE_SOURCE.includes(session.route_source)) source = session.route_source;
    }
  }

  return {
    route,
    route_source: source,
    pr_state: typeof outcome.pr_state === 'string' ? outcome.pr_state : null,
    verified: typeof outcome.verified === 'string' ? outcome.verified : null,
    fix_loops: typeof outcome.fix_loops === 'number' ? outcome.fix_loops : null,
    review_comments: typeof outcome.review_comments === 'number' ? outcome.review_comments : null,
  };
}

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

// Copy a null-prototype aggregate to a plain object (spread uses
// CreateDataProperty, so an own "__proto__" key stays data).
function toPlainCounts(nullProtoMap) {
  return { ...nullProtoMap };
}

// ── Aggregation ─────────────────────────────────────────────────────────────

const CAVEAT = [
  'Only records whose route_source is \'explicit\' measure a routing DECISION.',
  'Records whose route_source is \'default\', \'unknown\', or unset measure the',
  'router\'s DEFAULT, not a decision. Each class gets its own metric block;',
  'no combined number exists, because a rate over mixed attribution would',
  'ascribe the default\'s outcomes to the router\'s decisions.',
];

// One empty outcome-metrics accumulator. Every route bucket holds two of
// these - one per attribution class - and a record only ever lands in one.
function newMetrics() {
  return {
    records: 0,
    pr_state: Object.create(null),
    verified: Object.create(null),
    merged: 0,
    closed: 0,
    fixLoopsN: 0,
    fixLoopsSum: 0,
    reviewCommentsN: 0,
    reviewCommentsSum: 0,
    costN: 0,
    costSum: 0,
  };
}

function accumulate(m, rec) {
  m.records += 1;
  bump(m.pr_state, rec.pr_state == null ? UNSET : rec.pr_state);
  bump(m.verified, rec.verified == null ? UNSET : rec.verified);
  if (rec.pr_state === 'merged') m.merged += 1;
  if (rec.pr_state === 'closed') m.closed += 1;
  if (rec.fix_loops != null) {
    m.fixLoopsN += 1;
    m.fixLoopsSum += rec.fix_loops;
  }
  if (rec.review_comments != null) {
    m.reviewCommentsN += 1;
    m.reviewCommentsSum += rec.review_comments;
  }
  // Cost joins only where the ticket's ledger priced at least one session; an
  // uncosted record contributes to `records` but never to the cost mean - the
  // printed n-vs-records gap IS the coverage statement.
  if (typeof rec.cost_usd === 'number') {
    m.costN += 1;
    m.costSum += rec.cost_usd;
  }
}

function finalizeMetrics(m) {
  // merge rate = merged / (merged + closed): the denominator is SETTLED
  // records only; open/draft/absent/unset records are excluded from the
  // denominator, not from the report.
  const settled = m.merged + m.closed;
  return {
    records: m.records,
    pr_state: toPlainCounts(m.pr_state),
    merge: {
      merged: m.merged,
      closed: m.closed,
      settled,
      rate: settled > 0 ? m.merged / settled : null,
    },
    verified: toPlainCounts(m.verified),
    fix_loops: { n: m.fixLoopsN, mean: m.fixLoopsN > 0 ? m.fixLoopsSum / m.fixLoopsN : null },
    review_comments: {
      n: m.reviewCommentsN,
      mean: m.reviewCommentsN > 0 ? m.reviewCommentsSum / m.reviewCommentsN : null,
    },
    // Priced USD over the records whose ticket ledger produced a price. n is the
    // join coverage: compare it against `records` before trusting the mean.
    cost: {
      n: m.costN,
      total: m.costN > 0 ? m.costSum : null,
      mean: m.costN > 0 ? m.costSum / m.costN : null,
    },
  };
}

// Aggregate records into the stable report shape. Aggregation maps are
// null-prototype (route values and route_sources come from on-disk JSON -
// hostile-ish keys like "__proto__" must resolve as own properties) and are
// converted back to plain objects for output.
function buildReport(records, scanned) {
  const perRoute = Object.create(null);

  for (const rec of records) {
    const routeKey = rec.route == null ? UNSET : rec.route;
    const agg = (perRoute[routeKey] ||= {
      records: 0,
      route_source: Object.create(null),
      explicit: newMetrics(),
      unattributable: newMetrics(),
    });

    agg.records += 1;
    bump(agg.route_source, rec.route_source == null ? UNSET : rec.route_source);
    // The attribution wall: only route_source 'explicit' measures a decision;
    // everything else (default/unknown/unset) accumulates separately.
    accumulate(rec.route_source === 'explicit' ? agg.explicit : agg.unattributable, rec);
  }

  // Null-prototype here too: assigning a route literally named "__proto__" onto a
  // plain object would hit the prototype setter and silently drop the bucket. The
  // final spread copies own keys with CreateDataProperty, so the key survives as
  // data in the returned plain object.
  const plainPerRoute = Object.create(null);
  for (const route of Object.keys(perRoute).sort()) {
    const a = perRoute[route];
    plainPerRoute[route] = {
      records: a.records,
      attribution: { explicit: a.explicit.records, unattributable: a.unattributable.records },
      route_source: toPlainCounts(a.route_source),
      explicit: finalizeMetrics(a.explicit),
      unattributable: finalizeMetrics(a.unattributable),
    };
  }

  return {
    records: records.length,
    perRoute: toPlainCounts(plainPerRoute),
    scanned,
    caveat: CAVEAT.join(' '),
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────

// Render a "value×count" distribution with deterministic key ordering.
function formatDistribution(counts) {
  return Object.keys(counts)
    .sort()
    .map((k) => `${k}×${counts[k]}`)
    .join(', ');
}

function pct(rate) {
  return (rate * 100).toFixed(1) + '%';
}

function renderHuman(report, dataRoot) {
  const lines = ['Route effectiveness report', `data root: ${dataRoot}`, ''];
  const s = report.scanned;
  lines.push(
    `${report.records} canonical outcome record(s)`,
    `excluded (counted, never aggregated): ${s.nestedCopies} nested cop${s.nestedCopies === 1 ? 'y' : 'ies'}, `
      + `${s.offBucket} off-bucket, ${s.skippedUnparseable} unparseable outcome.json skipped`,
    '',
    'CAVEAT - attribution:',
    ...CAVEAT.map((l) => '  ' + l),
    '',
  );

  if (report.records === 0) {
    lines.push('no outcome records - nothing to aggregate');
    return lines.join('\n') + '\n';
  }

  for (const route of Object.keys(report.perRoute)) {
    const r = report.perRoute[route];
    // Repo convention: the sample is stated before the number.
    lines.push(
      `route: ${route}`,
      `  records          ${r.records} (explicit ${r.attribution.explicit}, unattributable ${r.attribution.unattributable})`,
      `  route_source     ${formatDistribution(r.route_source)}`,
    );
    // One metric block per attribution class, never a combined one: a rate over
    // mixed attribution would ascribe the default's outcomes to the decisions.
    for (const cls of ['explicit', 'unattributable']) {
      const m = r[cls];
      if (m.records === 0) {
        lines.push(`  ${cls}: 0 records`);
        continue;
      }
      lines.push(
        `  ${cls}: ${m.records} record(s)`,
        `    pr_state         ${formatDistribution(m.pr_state)}`,
        `    merge rate       over ${m.merge.settled} settled (merged+closed): `
          + (m.merge.rate === null ? 'n/a (nothing settled)' : `${pct(m.merge.rate)} (${m.merge.merged}/${m.merge.settled})`),
        `    verified         ${formatDistribution(m.verified)}`,
        `    fix_loops        over ${m.fix_loops.n} non-null: `
          + (m.fix_loops.mean === null ? 'n/a' : 'mean ' + m.fix_loops.mean.toFixed(2)),
        `    review_comments  over ${m.review_comments.n} non-null: `
          + (m.review_comments.mean === null ? 'n/a' : 'mean ' + m.review_comments.mean.toFixed(2)),
        `    cost             over ${m.cost.n} of ${m.records} record(s): `
          + (m.cost.mean === null
            ? 'no priced cost data'
            : `total $${m.cost.total.toFixed(2)}, mean $${m.cost.mean.toFixed(2)}`),
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const HELP =
  'route-report - score the router by aggregating per-ticket outcome records\n' +
  'per SESSION route (lite|direct|plan|brainstorm|full - not the solo|shadows\n' +
  'execution route in wrap.json/plan.json).\n\n' +
  'Usage: node scripts/route-report.js [--json]\n\n' +
  '  --json  emit the stable machine shape instead of the human table\n\n' +
  'Reads ${PHANTOM_DATA:-~/.phantom}/repos/*/{sessions,completed}/<ticket>/.\n' +
  'READ-ONLY: this script has NO side effects.\n';

function parseArgs(argv) {
  const rest = argv.slice(2);
  let json = false;
  for (const arg of rest) {
    if (arg === '--json') {
      json = true;
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else {
      throw new PhantomError(`ERROR: Unknown ${arg.startsWith('-') ? 'flag' : 'argument'}: ${arg}`, VALIDATION_ERROR, [
        'Usage: route-report.js [--json]',
      ]);
    }
  }
  return { json };
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  const dataRoot = phantomData();
  const dirs = findOutcomeDirs(dataRoot);

  // Cost join: price each record's ticket once (memoized - a ticket can hold
  // both a sessions/ and a completed/ record) through cost-report's one price
  // table. usd is a number ONLY when a transcript was actually priced; null
  // (unknown) never reads as $0.
  const spendCache = new Map();
  async function costFor(repo, ticket) {
    const key = `${repo}\0${ticket}`;
    if (!spendCache.has(key)) {
      try {
        spendCache.set(key, await spendForTicket(ticket, repo));
      } catch (_) {
        spendCache.set(key, { usd: null });
      }
    }
    return spendCache.get(key);
  }

  const records = [];
  let skippedUnparseable = 0;
  for (const dir of dirs.canonical) {
    const rec = extractRecord(dir);
    if (rec === null) {
      skippedUnparseable += 1;
      continue;
    }
    // dir is <data>/repos/<repo>/{sessions,completed}/<ticket> by construction.
    const [repo, , ticket] = path.relative(path.join(dataRoot, 'repos'), dir).split(path.sep);
    const spend = await costFor(repo, ticket);
    rec.cost_usd = spend && typeof spend.usd === 'number' ? spend.usd : null;
    records.push(rec);
  }

  const report = buildReport(records, {
    nestedCopies: dirs.nestedCopies,
    offBucket: dirs.offBucket,
    skippedUnparseable,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderHuman(report, dataRoot));
  }
}

if (require.main === module) {
  main(process.argv).catch((err) => reportError(err));
}

module.exports = { findOutcomeDirs, extractRecord, buildReport, renderHuman };
