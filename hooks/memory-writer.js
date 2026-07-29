// Author: Subash Karki
// memory-writer.js - Stop hook that extracts learning candidates from observations
// and hands them to the canonical learning API for staging, dedup, graduation,
// and a locked write. Produces ZERO stdout. All output goes to files only.
//
// The read-modify-write of the shared learning files lives entirely in
// skills/phantom/scripts/phantom-learning.mjs (the single write path shared with
// portable workflows). That API takes the advisory
// lock and NEVER writes unlocked; if it cannot take the lock within its budget it
// throws, and this hook drops the capture rather than clobbering a concurrent
// writer. Dropping an occasional best-effort capture is acceptable; a torn or
// lost index is not.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { observationsDir, learningsDir } = require('../scripts/lib/phantom-paths');

let EXTRACT_TIMEOUT_MS = 5000;
try {
  EXTRACT_TIMEOUT_MS = require('../scripts/lib/constants').EXTRACT_TIMEOUT_MS ?? EXTRACT_TIMEOUT_MS;
} catch (_) { /* fail open: lib missing → inline default */ }

const LEARNINGS_DIR = learningsDir();
const OBS_DIR = observationsDir();
const EXTRACT_SCRIPT = path.join(__dirname, '..', 'scripts', 'extract-learnings.js');
const LEARNING_API = path.join(__dirname, '..', 'skills', 'phantom', 'scripts', 'phantom-learning.mjs');
const TURN_WINDOW = 90; // seconds - capture observations from this turn only

try {
  // Read stdin-json for session info.
  let stdinData = '';
  try {
    // fd 0, not '/dev/stdin' - the device path ENXIOs on Linux pipe spawns (CI-discovered).
    stdinData = fs.readFileSync(0, 'utf-8');
  } catch {
    // No stdin available.
  }

  let sessionId = 'unknown';
  try {
    const event = JSON.parse(stdinData || '{}');
    sessionId = event.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';
  } catch {
    sessionId = process.env.CLAUDE_SESSION_ID || 'unknown';
  }

  // Step 1: Get today's observations.
  const today = new Date().toISOString().slice(0, 10);
  const obsFile = path.join(OBS_DIR, `${today}.jsonl`);
  if (!fs.existsSync(obsFile)) process.exit(0);

  // Step 2: Extract learning candidates from this turn's observations.
  let candidates;
  try {
    const result = execFileSync(process.execPath, [
      EXTRACT_SCRIPT,
      '--input', obsFile,
      '--window', String(TURN_WINDOW),
      '--session', sessionId,
    ], { encoding: 'utf-8', timeout: EXTRACT_TIMEOUT_MS });
    candidates = JSON.parse(result);
  } catch {
    process.exit(0);
  }

  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    process.exit(0);
  }

  // Step 3: Hand the candidates to the canonical learning API. It performs the
  // locked staging/dedup/graduation write. On lock contention past its budget or
  // any failure it exits non-zero and we drop the capture - there is no unlocked
  // fallback write path.
  try {
    execFileSync(process.execPath, [
      LEARNING_API, 'capture', '--learnings', LEARNINGS_DIR,
    ], { input: JSON.stringify(candidates), stdio: ['pipe', 'ignore', 'ignore'], timeout: EXTRACT_TIMEOUT_MS });
  } catch {
    // Contended past the budget or API unavailable → drop; never write unlocked.
  }
} catch {
  // Top-level catch: exit silently on any error.
  // Never throw, never log, never break the user's flow.
}
