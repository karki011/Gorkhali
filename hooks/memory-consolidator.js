// Author: Subash Karki
// memory-consolidator.js — PreCompact hook (priority 40)
// Distills session state before context compaction.
// Reads observations, builds structural summary, writes memory-snapshot.json,
// extracts high-confidence patterns to INDEX.md, and outputs compact guidance
// to stdout for Claude to preserve during compaction.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { observationsDir, learningsDir, stateDir } = require('../scripts/lib/gorkhali-paths');

let EXTRACT_TIMEOUT_MS = 5000;
try {
  EXTRACT_TIMEOUT_MS = require('../scripts/lib/constants').EXTRACT_TIMEOUT_MS ?? EXTRACT_TIMEOUT_MS;
} catch (_) { /* fail open: lib missing → inline default */ }

const LEARNINGS_DIR = learningsDir();
const OBS_DIR = observationsDir();
const STATE_DIR = stateDir();
const EXTRACT_SCRIPT = path.join(__dirname, '..', 'scripts', 'extract-learnings.js');
const HIGH_CONFIDENCE_THRESHOLD = 3; // file touched 3+ times → important

const MINIMAL_OUTPUT =
  '<!-- memory-consolidation -->\nNo observations to consolidate.\n<!-- /memory-consolidation -->';

// ── Domain routing (canonical taxonomy: scripts/lib/domains.js) ──────────────

let fileDomain = null;
try {
  ({ fileDomain } = require('../scripts/lib/domains'));
} catch (_) { /* fail open: lib missing → everything routes to 'other' */ }

function domainFromFile(filePath) {
  if (!filePath || typeof fileDomain !== 'function') return 'other';
  return fileDomain(filePath) || 'other';
}

// ── Atomic write + advisory locking ─────────────────────────────────────────────
// DRY: atomic temp+rename and the read-modify-write lock live in atomic.js now.
// Keep a LOAD-FAILURE fallback so a missing/broken atomic.js degrades to the prior
// inline behavior (unlocked best-effort write) and never crashes the PreCompact hook.

let atomicWrite;
try {
  ({ atomicWrite } = require('../scripts/lib/atomic'));
} catch (_) {
  atomicWrite = (filePath, content) => {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, filePath);
  };
}

// The shared learning index is mutated only through the canonical learning API
// (skills/gorkhali/scripts/gorkhali-learning.mjs). It takes the advisory lock, so
// this hook and memory-writer.js serialize against one lock and never write the
// index unlocked. atomicWrite above is still used for the per-session snapshot,
// which is single-writer and needs no lock.
const LEARNING_API = path.join(__dirname, '..', 'skills', 'gorkhali', 'scripts', 'gorkhali-learning.mjs');

// ── Step 1: Read stdin and determine session ──────────────────────────────────

let input = {};
let sessionId = 'unknown';

try {
  // fd 0, not '/dev/stdin' — the device path ENXIOs on Linux pipe spawns (CI-discovered).
  input = JSON.parse(fs.readFileSync(0, 'utf-8'));
  sessionId = input.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';
} catch {
  sessionId = process.env.CLAUDE_SESSION_ID || 'unknown';
}

// ── Main flow ─────────────────────────────────────────────────────────────────

try {
  // ── Step 2: Load today's observations ─────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const obsFile = path.join(OBS_DIR, `${today}.jsonl`);

  if (!fs.existsSync(obsFile)) {
    process.stdout.write(MINIMAL_OUTPUT);
    process.exit(0);
  }

  const rawLines = fs.readFileSync(obsFile, 'utf-8').split('\n').filter(Boolean);
  const allObservations = [];
  for (const line of rawLines) {
    try { allObservations.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }

  // Filter to current session (if known)
  const sessionObs = sessionId === 'unknown'
    ? allObservations
    : allObservations.filter(o => o.session === sessionId);

  if (sessionObs.length === 0) {
    process.stdout.write(MINIMAL_OUTPUT);
    process.exit(0);
  }

  // ── Step 3: Build structural summary ────────────────────────────────────

  // 3a. Files modified (Edit/Write) grouped by domain
  const filesModified = {};
  for (const obs of sessionObs) {
    if (obs.tool !== 'Edit' && obs.tool !== 'Write') continue;
    if (!obs.file) continue;
    const domain = domainFromFile(obs.file);
    if (!filesModified[domain]) filesModified[domain] = [];
    if (!filesModified[domain].includes(obs.file)) {
      filesModified[domain].push(obs.file);
    }
  }

  // 3b. Commands run (Bash)
  const bashObs = sessionObs.filter(o => o.tool === 'Bash');
  const bashKeywordSet = new Set();
  for (const obs of bashObs) {
    const cmd = (obs.command || '').trim();
    const first = cmd.split(/\s+/)[0] || '';
    const base = path.basename(first).toLowerCase();
    if (base) bashKeywordSet.add(base);
  }
  const commands = {
    total: bashObs.length,
    succeeded: bashObs.filter(o => (o.exitCode || 0) === 0).length,
    failed: bashObs.filter(o => (o.exitCode || 0) !== 0).length,
    keywords: Array.from(bashKeywordSet).slice(0, 10),
  };

  // 3c. Most-accessed reference files (Read tool, count occurrences)
  const readCounts = new Map();
  for (const obs of sessionObs) {
    if (obs.tool !== 'Read' || !obs.file) continue;
    readCounts.set(obs.file, (readCounts.get(obs.file) || 0) + 1);
  }
  const referenceFiles = Array.from(readCounts.entries())
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // 3d. High-confidence patterns (files touched 3+ times across Read/Edit/Write)
  const allFileCounts = new Map();
  for (const obs of sessionObs) {
    if (!obs.file) continue;
    if (obs.tool === 'Read' || obs.tool === 'Edit' || obs.tool === 'Write') {
      allFileCounts.set(obs.file, (allFileCounts.get(obs.file) || 0) + 1);
    }
  }
  const highConfidenceFiles = Array.from(allFileCounts.entries())
    .filter(([, count]) => count >= HIGH_CONFIDENCE_THRESHOLD)
    .map(([file]) => file);

  // ── Step 4: Write memory-snapshot.json ──────────────────────────────────

  const firstObs = sessionObs[0];
  const lastObs = sessionObs[sessionObs.length - 1];

  const snapshot = {
    _meta: {
      type: 'memory-snapshot',
      session: sessionId,
      created: new Date().toISOString(),
      author: 'memory-consolidator',
    },
    filesModified,
    commands,
    referenceFiles,
    highConfidenceFiles,
    observationCount: sessionObs.length,
    timeRange: {
      first: firstObs.ts || null,
      last: lastObs.ts || null,
    },
  };

  try {
    const sessDir = path.join(STATE_DIR, 'sessions', sessionId);
    fs.mkdirSync(sessDir, { recursive: true });
    atomicWrite(
      path.join(sessDir, 'memory-snapshot.json'),
      JSON.stringify(snapshot, null, 2)
    );
  } catch {
    // Non-fatal — snapshot write failed, continue to output
  }

  // ── Step 5: Extract high-confidence patterns to learnings ───────────────

  if (highConfidenceFiles.length > 0) {
    try {
      const extractResult = execFileSync(process.execPath, [
        EXTRACT_SCRIPT,
        '--input', obsFile,
        '--window', '0',
        '--session', sessionId,
      ], { encoding: 'utf-8', timeout: EXTRACT_TIMEOUT_MS });

      const candidates = JSON.parse(extractResult);

      // Filter to only high-confidence files
      const hcSet = new Set(highConfidenceFiles.map(f => path.basename(f).toLowerCase().replace(/\.[^.]+$/, '')));
      const matched = candidates.filter(c => {
        // dedup_key format: type:domain:basename_without_ext
        const parts = (c.dedup_key || '').split(':');
        const tail = parts[2] || '';
        return hcSet.has(tail);
      });

      if (matched.length > 0) {
        // Route through the canonical learning API. It takes the advisory lock
        // and folds these high-confidence patterns into the INDEX. Fail-closed:
        // on contention past the budget or any error we skip rather than writing
        // the index unlocked.
        const consolidatedCandidates = matched.map((m) => ({
          entry: m.entry,
          confidence: m.confidence || 0,
        }));
        try {
          execFileSync(process.execPath, [
            LEARNING_API, 'consolidate', '--learnings', LEARNINGS_DIR,
          ], {
            input: JSON.stringify(consolidatedCandidates),
            stdio: ['pipe', 'ignore', 'ignore'],
            timeout: EXTRACT_TIMEOUT_MS,
          });
        } catch {
          // Contended or unavailable → skip; never write the index unlocked.
        }
      }
    } catch {
      // Step 5 failed — non-fatal, continue to output
    }
  }

  // ── Step 6: Output compact guidance to stdout ───────────────────────────

  const modifiedCount = Object.values(filesModified).reduce((s, arr) => s + arr.length, 0);

  const lines = [];
  lines.push('<!-- memory-consolidation -->');
  lines.push('## Session Memory Snapshot');
  lines.push('');

  // Files modified
  if (modifiedCount > 0) {
    lines.push(`**Files modified (${modifiedCount}):**`);
    for (const [domain, files] of Object.entries(filesModified)) {
      const names = files.map(f => path.basename(f));
      lines.push(`${domain}: ${names.join(', ')}`);
    }
    lines.push('');
  }

  // Key reference files (top 5 for compactness)
  if (referenceFiles.length > 0) {
    lines.push('**Key reference files:**');
    for (const ref of referenceFiles.slice(0, 5)) {
      lines.push(`- ${path.basename(ref.file)} (read ${ref.count}x)`);
    }
    lines.push('');
  }

  // Command success rate
  if (commands.total > 0) {
    lines.push(`**Command success rate:** ${commands.succeeded}/${commands.total}`);
    lines.push('');
  }

  // High-confidence files
  if (highConfidenceFiles.length > 0) {
    const names = highConfidenceFiles.map(f => path.basename(f));
    lines.push(`**High-confidence files:** ${names.join(', ')}`);
    lines.push('');
  }

  lines.push(`**Snapshot saved:** state/sessions/${sessionId}/memory-snapshot.json`);
  lines.push('<!-- /memory-consolidation -->');

  process.stdout.write(lines.join('\n'));
} catch (err) {
  // Top-level catch — always output something for compaction guidance
  process.stdout.write(MINIMAL_OUTPUT);
}
