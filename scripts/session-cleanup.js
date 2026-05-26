#!/usr/bin/env node
// Author: Subash Karki
// Auto-archives stale team skill sessions.
// Scans state/sessions/*/context.json for timestamps; moves stale sessions
// to state/completed/{TICKET}/ with an archive-summary.json.
//
// Usage:
//   session-cleanup.js [--dry-run] [--days=N] [--force-ticket=TICKET]
//
// Flags:
//   --dry-run           Show what would be archived without moving
//   --days=N            Override stale threshold (default: 7)
//   --force-ticket=T    Archive a specific ticket regardless of age

'use strict';

const fs = require('fs');
const path = require('path');

// --- Config ---
const TEAM_ROOT = path.join(process.env.HOME, '.claude', 'team');
const SESSIONS_DIR = path.join(TEAM_ROOT, 'state', 'sessions');
const COMPLETED_DIR = path.join(TEAM_ROOT, 'state', 'completed');

// --- Parse args ---
const args = process.argv.slice(2);
let dryRun = false;
let staleDays = 7;
let forceTicket = null;

for (const arg of args) {
  if (arg === '--dry-run') {
    dryRun = true;
  } else if (arg.startsWith('--days=')) {
    staleDays = parseInt(arg.split('=')[1], 10);
    if (isNaN(staleDays) || staleDays < 1) {
      process.stderr.write('ERROR: --days must be a positive integer\n');
      process.exit(1);
    }
  } else if (arg.startsWith('--force-ticket=')) {
    forceTicket = arg.split('=')[1];
    if (!forceTicket) {
      process.stderr.write('ERROR: --force-ticket requires a ticket name\n');
      process.exit(1);
    }
  } else if (arg === '--help' || arg === '-h') {
    process.stdout.write(
      'Usage: session-cleanup.js [--dry-run] [--days=N] [--force-ticket=TICKET]\n' +
      '\n' +
      'Flags:\n' +
      '  --dry-run           Show what would be archived without moving\n' +
      '  --days=N            Override stale threshold (default: 7)\n' +
      '  --force-ticket=T    Archive a specific ticket regardless of age\n'
    );
    process.exit(0);
  } else {
    process.stderr.write(`Unknown argument: ${arg}\nUse --help for usage.\n`);
    process.exit(1);
  }
}

// --- Helpers ---

/** Read JSON file, return parsed data or null on failure. */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Get the earliest _meta.writtenAt from any artifact in a session dir. */
function getSessionCreated(sessionDir) {
  const artifacts = ['context.json', 'intent.json', 'plan.json', 'pause-state.json'];
  let earliest = null;

  for (const name of artifacts) {
    const fp = path.join(sessionDir, name);
    if (!fs.existsSync(fp)) continue;
    const data = readJson(fp);
    if (!data || !data._meta || !data._meta.writtenAt) continue;
    const ts = new Date(data._meta.writtenAt);
    if (isNaN(ts.getTime())) continue;
    if (!earliest || ts < earliest) earliest = ts;
  }

  return earliest;
}

/** Get the most recent mtime of any file in a directory (recursive).
 *  Falls back to the directory's own mtime if no files are found. */
function getLatestMtime(dir) {
  let latest = new Date(0);
  let foundFile = false;

  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        foundFile = true;
        try {
          const stat = fs.statSync(full);
          if (stat.mtime > latest) latest = stat.mtime;
        } catch { /* skip unreadable */ }
      }
    }
  }

  walk(dir);

  // If no files found, use the directory's own mtime
  if (!foundFile) {
    try {
      latest = fs.statSync(dir).mtime;
    } catch { /* keep epoch */ }
  }

  return latest;
}

/** Count files in a directory (non-recursive, files only). */
function countArtifacts(dir) {
  let count = 0;

  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        count++;
      }
    }
  }

  walk(dir);
  return count;
}

/** Determine final status from session artifacts. */
function detectStatus(sessionDir) {
  if (fs.existsSync(path.join(sessionDir, 'wrap.json'))) return 'completed';
  if (fs.existsSync(path.join(sessionDir, 'verification.json'))) {
    const v = readJson(path.join(sessionDir, 'verification.json'));
    if (v && v.verdict === 'pass') return 'completed';
  }
  return 'stale';
}

/** Move directory recursively (rename if same device, copy+delete otherwise). */
function moveDir(src, dest) {
  // Ensure parent exists
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  try {
    fs.renameSync(src, dest);
  } catch {
    // Cross-device: copy then delete
    copyDirSync(src, dest);
    fs.rmSync(src, { recursive: true, force: true });
  }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// --- Main ---

if (!fs.existsSync(SESSIONS_DIR)) {
  process.stdout.write('No sessions directory found. Nothing to archive.\n');
  process.exit(0);
}

const now = new Date();
const thresholdMs = staleDays * 24 * 60 * 60 * 1000;
const archived = [];
const skipped = [];

let tickets;
try {
  tickets = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
} catch (e) {
  process.stderr.write(`ERROR: Cannot read sessions directory: ${e.message}\n`);
  process.exit(1);
}

if (forceTicket) {
  tickets = tickets.filter(t => t === forceTicket);
  if (tickets.length === 0) {
    process.stderr.write(`ERROR: Ticket "${forceTicket}" not found in ${SESSIONS_DIR}\n`);
    process.exit(1);
  }
}

for (const ticket of tickets) {
  const sessionDir = path.join(SESSIONS_DIR, ticket);
  const created = getSessionCreated(sessionDir);
  const lastModified = getLatestMtime(sessionDir);
  const artifactCount = countArtifacts(sessionDir);

  // Determine if stale
  const isForced = forceTicket === ticket;
  const ageDays = created ? (now - created) / (24 * 60 * 60 * 1000) : null;
  const inactiveDays = (now - lastModified) / (24 * 60 * 60 * 1000);

  const isOldEnough = ageDays !== null ? ageDays >= staleDays : inactiveDays >= staleDays;
  const isInactive = inactiveDays >= staleDays;
  const shouldArchive = isForced || (isOldEnough && isInactive);

  if (!shouldArchive) {
    skipped.push({
      ticket,
      reason: !isOldEnough ? `age ${ageDays !== null ? ageDays.toFixed(1) : '?'}d < ${staleDays}d` : `active ${inactiveDays.toFixed(1)}d ago`,
    });
    continue;
  }

  const finalStatus = detectStatus(sessionDir);
  const destDir = path.join(COMPLETED_DIR, ticket);

  const summary = {
    ticket,
    archived_date: now.toISOString(),
    original_created: created ? created.toISOString() : null,
    last_modified: lastModified.toISOString(),
    artifacts_count: artifactCount,
    final_status: finalStatus,
  };

  if (dryRun) {
    process.stdout.write(`[DRY RUN] Would archive: ${ticket}\n`);
    process.stdout.write(`  created:       ${summary.original_created || 'unknown'}\n`);
    process.stdout.write(`  last_modified: ${summary.last_modified}\n`);
    process.stdout.write(`  artifacts:     ${summary.artifacts_count}\n`);
    process.stdout.write(`  status:        ${summary.final_status}\n`);
    process.stdout.write(`  dest:          ${destDir}\n\n`);
  } else {
    // Check for collision
    if (fs.existsSync(destDir)) {
      process.stderr.write(`WARN: ${destDir} already exists, overwriting.\n`);
      fs.rmSync(destDir, { recursive: true, force: true });
    }

    moveDir(sessionDir, destDir);

    // Write archive summary
    const summaryPath = path.join(destDir, 'archive-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');

    process.stdout.write(`Archived: ${ticket} -> state/completed/${ticket}/ (${finalStatus})\n`);
  }

  archived.push(summary);
}

// --- Report ---
process.stdout.write('\n--- Session Cleanup Report ---\n');
process.stdout.write(`Threshold:  ${staleDays} day(s)\n`);
process.stdout.write(`Archived:   ${archived.length}\n`);
process.stdout.write(`Skipped:    ${skipped.length}\n`);

if (skipped.length > 0) {
  process.stdout.write('\nSkipped sessions:\n');
  for (const s of skipped) {
    process.stdout.write(`  ${s.ticket}: ${s.reason}\n`);
  }
}

if (dryRun && archived.length > 0) {
  process.stdout.write('\nRe-run without --dry-run to archive.\n');
}

process.exit(0);
