#!/usr/bin/env node
// Author: Subash Karki
// chief-block-ceiling.js — bounded escape hatch for chief-subagent-driven-law.sh.
// Counts CONSECUTIVE, UNRESOLVED blocked Chief edit attempts on the exact same
// (repo, session_id, file_path) within CHIEF_BLOCK_WINDOW_MS. Once the count
// reaches CHIEF_BLOCK_CEILING the caller is told to allow the write through
// (and the counter resets), so a genuinely stuck delegation attempt cannot
// block Chief forever on the same file. "Unresolved" is load-bearing: the law
// script clears the counter on every SUCCESSFUL delegated edit (the engineer/
// legacy marker branch), so a resolved episode never contributes leftover
// count toward a later, unrelated block streak on the same key.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { gorkhaliData, detectRepo } = require('../scripts/lib/gorkhali-paths');
const { CHIEF_BLOCK_CEILING, CHIEF_BLOCK_WINDOW_MS } = require('../scripts/lib/constants');
const { atomicWrite } = require('../scripts/lib/atomic');

// session_id + file_path are untrusted and filesystem-unsafe; a stable hash
// keys the counter file without embedding the raw path in its name.
function counterKey(sessionId, filePath) {
  return crypto.createHash('sha256').update(String(sessionId) + '\0' + String(filePath)).digest('hex');
}

function counterDir(cwd) {
  return path.join(gorkhaliData(cwd), '.chief-block-ceiling.d', detectRepo(cwd));
}

function counterFile(cwd, sessionId, filePath) {
  return path.join(counterDir(cwd), counterKey(sessionId, filePath));
}

// Shared payload parsing for both recordAndCheck and clear: same hook payload
// shape (session_id, tool_input.file_path or .path, cwd).
function keyInputs(payload = {}) {
  const sessionId = String(payload.session_id || '');
  const toolInput = payload.tool_input || {};
  const filePath = String(toolInput.file_path || toolInput.path || '');
  const cwd = payload.cwd || process.cwd();
  return { sessionId, filePath, cwd };
}

function readCounter(file, now) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data.count !== 'number' || typeof data.lastBlockedAt !== 'number') return null;
    if (now - data.lastBlockedAt >= CHIEF_BLOCK_WINDOW_MS) return null;
    return data;
  } catch (_) {
    return null;
  }
}

// Opportunistic cleanup: a block streak that never reaches the ceiling (the
// normal, healthy case) would otherwise leave its counter file under
// counterDir() forever, since session ids make most keys effectively one-shot
// and nothing else ever revisits them. Piggybacks on recordAndCheck's own
// directory touch rather than a separate cron/daemon. Best-effort: a single
// bad entry or read race is skipped, never allowed to fail the caller.
function sweepExpired(dir, now, exceptFile) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (_) {
    return;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    if (full === exceptFile) continue;
    try {
      const data = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (!data || typeof data.lastBlockedAt !== 'number' || now - data.lastBlockedAt >= CHIEF_BLOCK_WINDOW_MS) {
        fs.unlinkSync(full);
      }
    } catch (_) {
      /* corrupt or raced entry — best-effort, skip */
    }
  }
}

function recordAndCheck(payload = {}) {
  const { sessionId, filePath, cwd } = keyInputs(payload);
  const now = Date.now();
  const dir = counterDir(cwd);
  const file = path.join(dir, counterKey(sessionId, filePath));

  fs.mkdirSync(dir, { recursive: true });
  sweepExpired(dir, now, file);

  const existing = readCounter(file, now);
  const count = (existing ? existing.count : 0) + 1;
  const escapeHatch = count >= CHIEF_BLOCK_CEILING;

  if (escapeHatch) {
    // Reset so the next stall episode on this same key needs the full ceiling again.
    try { fs.unlinkSync(file); } catch (_) { /* already absent */ }
  } else {
    // No locking here (deliberate — see hooks.json's per-hook timeout budget):
    // two blocked attempts on the exact same key racing can both read the same
    // pre-increment count, in which case one increment is lost (delays the
    // ceiling — the safe direction) or, more rarely, both compute the same
    // escapeHatch verdict off stale data (imprecise, not dangerous — this is a
    // narrow safety valve, not a security boundary). atomicWrite still
    // guarantees no reader ever observes a torn/partial counter file.
    atomicWrite(file, JSON.stringify({ count, lastBlockedAt: now }) + '\n');
  }

  return { escapeHatch, count, threshold: CHIEF_BLOCK_CEILING };
}

// Called on every SUCCESSFUL delegated edit (the law script's engineer/legacy
// marker branch) to clear this exact key's counter, so a resolved block
// episode never carries leftover count into a later, unrelated one. No-op if
// the key has no counter file (the common case: most blocks never escalate).
function clear(payload = {}) {
  const { sessionId, filePath, cwd } = keyInputs(payload);
  const file = counterFile(cwd, sessionId, filePath);
  try { fs.unlinkSync(file); } catch (_) { /* already absent */ }
}

function readPayload() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return {}; }
}

function main() {
  const command = process.argv[2];
  const payload = readPayload();
  try {
    if (command === 'record-and-check') {
      process.exitCode = recordAndCheck(payload).escapeHatch ? 0 : 1;
    } else if (command === 'clear') {
      clear(payload);
      process.exitCode = 0;
    } else {
      process.exitCode = 1;
    }
  } catch (_) {
    process.exitCode = 1;
  }
}

module.exports = { recordAndCheck, clear, counterFile, counterKey, counterDir };
if (require.main === module) main();
