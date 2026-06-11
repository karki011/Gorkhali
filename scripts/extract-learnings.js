#!/usr/bin/env node
// Author: Subash Karki
// extract-learnings.js — Pure Node.js CLI that reads NDJSON observations
// and extracts learning candidates (domain, type, entry, confidence, dedup_key).
// No LLM, no external deps.

'use strict';

const fs = require('fs');
const path = require('path');

// ── Arg parsing ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { input: '', window: 0, session: '' };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--input':   args.input   = argv[++i] || ''; break;
      case '--window':  args.window  = parseInt(argv[++i], 10) || 0; break;
      case '--session': args.session = argv[++i] || ''; break;
    }
  }
  return args;
}

// ── Domain routing (canonical taxonomy: scripts/lib/domains.js) ────────────────

let fileDomain = null;
try {
  ({ fileDomain } = require('./lib/domains'));
} catch (_) { /* fail open: lib missing → ext-map fallback only */ }

const EXT_DOMAIN_MAP = {
  '.go': 'backend',
  '.ts': 'tooling',
  '.js': 'tooling',
  '.md': 'docs',
};

function domainFromFile(filePath) {
  if (!filePath) return 'unknown';
  if (typeof fileDomain === 'function') {
    const d = fileDomain(filePath);
    if (d) return d;
  }
  const ext = path.extname(filePath).toLowerCase();
  return EXT_DOMAIN_MAP[ext] || 'unknown';
}

const BASH_DOMAIN_SIGNALS = [
  { test: c => /\b(test|jest|vitest|mocha|pytest)\b/i.test(c),         domain: 'testing' },
  { test: c => /\b(lint|eslint|prettier|tsc)\b/i.test(c),              domain: 'tooling' },
  { test: c => /\b(deploy|docker|kubectl)\b/i.test(c),                 domain: 'infra' },
  { test: c => /\b(build|compile|webpack|vite)\b/i.test(c),            domain: 'tooling' },
  { test: c => /\b(git|commit|push|merge)\b/i.test(c),                 domain: 'shadows' },
];

function domainFromBash(command) {
  if (!command) return 'unknown';
  for (const sig of BASH_DOMAIN_SIGNALS) {
    if (sig.test(command)) return sig.domain;
  }
  return 'unknown';
}

// ── Type classification ────────────────────────────────────────────────────────

function classifyType(entry, readCounts) {
  const tool = entry.tool;
  if (tool === 'Edit' || tool === 'Write') {
    return 'pattern';
  }
  if (tool === 'Bash') {
    if (entry.exitCode !== 0) return 'correction';
    const cmd = (entry.command || '').toLowerCase();
    if (/test|lint|jest|vitest|mocha|pytest|eslint|prettier|tsc/.test(cmd)) {
      return 'validation';
    }
    return 'pattern'; // successful bash with no test/lint signal → pattern
  }
  if (tool === 'Read') {
    const count = readCounts.get(entry.file) || 0;
    if (count >= 3) return 'reference';
  }
  return null; // skip
}

// ── Confidence scoring ─────────────────────────────────────────────────────────

const BASE_CONFIDENCE = {
  pattern: 0.3,
  validation: 0.5,
  correction: 0.6,
  reference: 0.2,
};

function confidence(type, file, fileCounts) {
  const base = BASE_CONFIDENCE[type] || 0.3;
  const recurrences = (fileCounts.get(file) || 1) - 1;
  return Math.min(1.0, +(base + recurrences * 0.1).toFixed(2));
}

// ── Dedup key ──────────────────────────────────────────────────────────────────

function dedupKey(type, domain, entry) {
  let tail;
  if (entry.tool === 'Bash') {
    const first = (entry.command || '').trim().split(/\s+/)[0] || 'unknown';
    tail = first.toLowerCase().replace(/\.[^.]+$/, '');
  } else {
    const base = path.basename(entry.file || 'unknown');
    tail = base.toLowerCase().replace(/\.[^.]+$/, '');
  }
  return `${type}:${domain}:${tail}`;
}

// ── Entry text ─────────────────────────────────────────────────────────────────

function entryText(type, entry, readCount) {
  const base = entry.file ? path.basename(entry.file) : '';
  const summary = entry.summary || '';
  switch (type) {
    case 'pattern':
      if (entry.tool === 'Bash') {
        return `${entry.command} succeeded — ${summary}`;
      }
      return `Edit succeeded on ${base} — ${summary}`;
    case 'validation':
      return `${entry.command} passed — ${summary}`;
    case 'correction':
      return `${entry.command} failed (exit ${entry.exitCode}) — ${summary}`;
    case 'reference':
      return `${base} read ${readCount}x — key reference file`;
    default:
      return summary;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (!args.input) {
    process.stdout.write('[]\n');
    process.exit(0);
  }

  // Resolve ~ in path
  const inputPath = args.input.replace(/^~/, process.env.HOME || '');

  if (!fs.existsSync(inputPath)) {
    process.stdout.write('[]\n');
    process.exit(0);
  }

  let lines;
  try {
    lines = fs.readFileSync(inputPath, 'utf8').split('\n').filter(Boolean);
  } catch {
    process.stdout.write('[]\n');
    process.exit(0);
  }

  // Parse entries, skip malformed
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip
    }
  }

  // Apply window filter
  const now = Date.now();
  const windowMs = args.window > 0 ? args.window * 1000 : 0;
  const filtered = entries.filter(e => {
    if (args.session && e.session !== args.session) return false;
    if (windowMs > 0 && e.ts) {
      const ts = new Date(e.ts).getTime();
      if (now - ts > windowMs) return false;
    }
    return true;
  });

  // Count file occurrences (for recurrence bonus + reference detection)
  const fileCounts = new Map();
  const readCounts = new Map();
  for (const e of filtered) {
    if (e.file) {
      fileCounts.set(e.file, (fileCounts.get(e.file) || 0) + 1);
    }
    if (e.tool === 'Read' && e.file) {
      readCounts.set(e.file, (readCounts.get(e.file) || 0) + 1);
    }
  }

  // Extract learnings
  const seen = new Set();
  const results = [];

  for (const e of filtered) {
    const type = classifyType(e, readCounts);
    if (!type) continue;

    const domain = e.tool === 'Bash'
      ? domainFromBash(e.command)
      : domainFromFile(e.file);

    const dk = dedupKey(type, domain, e);
    if (seen.has(dk)) continue;
    seen.add(dk);

    const file = e.file || '';
    const conf = confidence(type, file, fileCounts);
    const text = entryText(type, e, readCounts.get(file) || 0);

    results.push({
      domain,
      type,
      entry: text,
      confidence: conf,
      dedup_key: dk,
    });
  }

  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}

main();
