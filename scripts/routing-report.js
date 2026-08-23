#!/usr/bin/env node
// Author: Subash Karki
// routing-report.js - summarize model-routing evidence recorded in a session's
// JSON artifacts. Reads every top-level *.json and runs/**/*.json that carries a
// top-level `model_routing` object, then aggregates per producer.role:
// requested_profile distribution, outcome tallies, non-null fallback_reason
// frequencies, and deltas where a host-reported actual_profile differs from the
// requested one.
// Usage: routing-report.js <session-dir> [--json]
//   --json  emit the stable machine shape instead of the human table
// This tool is READ-ONLY: it never writes anything, and it never infers
// actual_profile - reconciliation is reported active only when the host itself
// recorded a non-null actual_profile (see skills/gorkhali/references/state.md).
// Exit 0 = report produced (including empty sessions); nonzero via reportError.

'use strict';

const fs = require('fs');
const path = require('path');
const { GorkhaliError, reportError, VALIDATION_ERROR } = require('./lib/axi-error');

// Label used when a routing field is absent, so distributions stay countable
// instead of dropping records with an undefined key.
const UNSET = '(unset)';

// Collect the JSON artifacts eligible for routing evidence: every *.json in the
// session root (non-recursive) plus every *.json anywhere under runs/. Missing
// runs/ is normal for early sessions and is not an error.
function collectJsonFiles(sessionDir) {
  const files = [];

  for (const entry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(path.join(sessionDir, entry.name));
    }
  }

  const runsDir = path.join(sessionDir, 'runs');
  if (fs.existsSync(runsDir) && fs.lstatSync(runsDir).isDirectory()) {
    walkJson(runsDir, files);
  }

  files.sort();
  return files;
}

// Recursively push every *.json under dir into out.
function walkJson(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJson(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
}

function isRoutingObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

// Parse each file and keep only those with a top-level model_routing object.
// Unparseable files are skipped silently - a half-written artifact must not sink
// the whole report.
function extractRecords(files) {
  const records = [];
  for (const file of files) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      continue;
    }
    if (!isRoutingObject(doc) || !isRoutingObject(doc.model_routing)) continue;

    const routing = doc.model_routing;
    const producer = isRoutingObject(doc.producer) ? doc.producer : {};
    records.push({
      role: typeof producer.role === 'string' && producer.role ? producer.role : 'unknown',
      requested: routing.requested_profile == null ? null : String(routing.requested_profile),
      actual: routing.actual_profile == null ? null : String(routing.actual_profile),
      fallback: routing.fallback_reason == null ? null : String(routing.fallback_reason),
      outcome: routing.outcome == null ? null : String(routing.outcome),
    });
  }
  return records;
}

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

// Copy a null-prototype aggregate to a plain object, preserving an own key
// literally named "constructor" or "__proto__" as data (spread uses
// CreateDataProperty, unlike Object.assign, so the __proto__ setter never
// fires).
function toPlainCounts(nullProtoMap) {
  return { ...nullProtoMap };
}

// Aggregate records into the stable report shape. actual_profile is only ever
// read here, never derived: a delta or an active reconciliation exists solely
// because the host reported a non-null actual_profile.
function buildReport(records) {
  // Null-prototype objects: a producer.role of "constructor" or "__proto__"
  // must resolve as a plain own-property lookup, never an inherited one.
  const perRole = Object.create(null);
  const deltaMap = new Map();
  const fallbackMap = new Map();
  let reconciliationActive = false;

  for (const rec of records) {
    if (rec.actual != null) reconciliationActive = true;

    const role = (perRole[rec.role] ||= { requested: Object.create(null), outcomes: Object.create(null) });
    bump(role.requested, rec.requested == null ? UNSET : rec.requested);
    bump(role.outcomes, rec.outcome == null ? UNSET : rec.outcome);

    if (rec.actual != null && rec.actual !== rec.requested) {
      const key = JSON.stringify([rec.role, rec.requested == null ? UNSET : rec.requested, rec.actual]);
      const delta = deltaMap.get(key)
        || { role: rec.role, requested: rec.requested == null ? UNSET : rec.requested, actual: rec.actual, count: 0 };
      delta.count += 1;
      deltaMap.set(key, delta);
    }

    if (rec.fallback != null) {
      const key = JSON.stringify([rec.role, rec.fallback]);
      const fb = fallbackMap.get(key) || { role: rec.role, reason: rec.fallback, count: 0 };
      fb.count += 1;
      fallbackMap.set(key, fb);
    }
  }

  const byRoleThenText = (a, b) =>
    a.role.localeCompare(b.role) || JSON.stringify(a).localeCompare(JSON.stringify(b));

  // Aggregation is done with null-prototype objects to stay immune to
  // prototype pollution; the returned shape is converted back to plain
  // objects (own keys preserved verbatim) so downstream equality checks and
  // JSON.stringify behave exactly as before.
  const plainPerRole = toPlainCounts(perRole);
  for (const role of Object.keys(plainPerRole)) {
    plainPerRole[role] = {
      requested: toPlainCounts(plainPerRole[role].requested),
      outcomes: toPlainCounts(plainPerRole[role].outcomes),
    };
  }

  return {
    perRole: plainPerRole,
    deltas: [...deltaMap.values()].sort(byRoleThenText),
    fallbacks: [...fallbackMap.values()].sort(byRoleThenText),
    records: records.length,
    reconciliationActive,
  };
}

// Render a "profile×count" distribution with deterministic key ordering.
function formatDistribution(counts) {
  return Object.keys(counts)
    .sort()
    .map((k) => `${k}×${counts[k]}`)
    .join(', ');
}

function renderHuman(report, sessionDir) {
  const lines = [`Routing evidence report`, `session: ${sessionDir}`, ''];

  if (report.records === 0) {
    lines.push('no routing records');
    return lines.join('\n') + '\n';
  }

  lines.push(`${report.records} routing record(s)`, '', 'Per role:');
  const roles = Object.keys(report.perRole).sort();
  const width = Math.max(...roles.map((r) => r.length));
  for (const role of roles) {
    const r = report.perRole[role];
    lines.push(
      `  ${role.padEnd(width)}  requested: ${formatDistribution(r.requested)}  |  outcomes: ${formatDistribution(r.outcomes)}`
    );
  }

  if (report.deltas.length > 0) {
    lines.push('', 'Profile deltas (requested -> actual):');
    for (const d of report.deltas) {
      lines.push(`  ${d.role}: ${d.requested} -> ${d.actual} ×${d.count}`);
    }
  }

  if (report.fallbacks.length > 0) {
    lines.push('', 'Fallback reasons:');
    for (const f of report.fallbacks) {
      lines.push(`  ${f.role}: ${f.reason} ×${f.count}`);
    }
  }

  if (!report.reconciliationActive) {
    lines.push('', 'reconciliation inactive: no host-reported actuals in this session');
  }

  return lines.join('\n') + '\n';
}

function parseArgs(argv) {
  const rest = argv.slice(2);
  let json = false;
  let sessionDir = null;
  for (const arg of rest) {
    if (arg === '--json') {
      json = true;
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else if (arg.startsWith('-')) {
      throw new GorkhaliError(`ERROR: Unknown flag: ${arg}`, VALIDATION_ERROR, [
        'Usage: routing-report.js <session-dir> [--json]',
      ]);
    } else if (sessionDir === null) {
      sessionDir = arg;
    } else {
      throw new GorkhaliError(`ERROR: Unexpected extra argument: ${arg}`, VALIDATION_ERROR, [
        'Usage: routing-report.js <session-dir> [--json]',
      ]);
    }
  }
  return { json, sessionDir };
}

const HELP =
  'routing-report - summarize model-routing evidence in a Gorkhali session\n\n' +
  'Usage: node scripts/routing-report.js <session-dir> [--json]\n\n' +
  '  <session-dir>  session directory holding routed JSON artifacts\n' +
  '  --json         emit the stable machine shape instead of the human table\n';

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  if (!opts.sessionDir) {
    throw new GorkhaliError('ERROR: Missing required <session-dir> argument', VALIDATION_ERROR, [
      'Usage: routing-report.js <session-dir> [--json]',
    ]);
  }

  const sessionDir = opts.sessionDir.replace(/^~/, process.env.HOME || '');
  if (!fs.existsSync(sessionDir)) {
    throw new GorkhaliError(`ERROR: Session directory not found: ${sessionDir}`, VALIDATION_ERROR);
  }
  if (!fs.statSync(sessionDir).isDirectory()) {
    throw new GorkhaliError(`ERROR: Not a directory: ${sessionDir}`, VALIDATION_ERROR);
  }

  const records = extractRecords(collectJsonFiles(sessionDir));
  const report = buildReport(records);

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderHuman(report, sessionDir));
  }
}

if (require.main === module) {
  try {
    main(process.argv);
  } catch (err) {
    reportError(err);
  }
}

module.exports = { collectJsonFiles, extractRecords, buildReport, renderHuman };
