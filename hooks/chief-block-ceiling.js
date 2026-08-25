#!/usr/bin/env node
// Author: Subash Karki
// chief-block-ceiling.js — bounded escape hatch for chief-subagent-driven-law.sh.
// Counts consecutive blocked Chief edit attempts on the exact same
// (repo, session_id, file_path) within CHIEF_BLOCK_WINDOW_MS. Once the count
// reaches CHIEF_BLOCK_CEILING the caller is told to allow the write through
// (and the counter resets), so a genuinely stuck delegation attempt cannot
// block Chief forever on the same file.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { gorkhaliData, detectRepo } = require('../scripts/lib/gorkhali-paths');
const { CHIEF_BLOCK_CEILING, CHIEF_BLOCK_WINDOW_MS } = require('../scripts/lib/constants');

// session_id + file_path are untrusted and filesystem-unsafe; a stable hash
// keys the counter file without embedding the raw path in its name.
function counterKey(sessionId, filePath) {
  return crypto.createHash('sha256').update(String(sessionId) + '\0' + String(filePath)).digest('hex');
}

function counterFile(cwd, sessionId, filePath) {
  const repo = detectRepo(cwd);
  return path.join(gorkhaliData(cwd), '.chief-block-ceiling.d', repo, counterKey(sessionId, filePath));
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

function recordAndCheck(payload = {}) {
  const sessionId = String(payload.session_id || '');
  const toolInput = payload.tool_input || {};
  const filePath = String(toolInput.file_path || toolInput.path || '');
  const cwd = payload.cwd || process.cwd();
  const now = Date.now();

  const file = counterFile(cwd, sessionId, filePath);
  const existing = readCounter(file, now);
  const count = (existing ? existing.count : 0) + 1;
  const escapeHatch = count >= CHIEF_BLOCK_CEILING;

  if (escapeHatch) {
    // Reset so the next stall episode on this same key needs the full ceiling again.
    try { fs.unlinkSync(file); } catch (_) { /* already absent */ }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ count, lastBlockedAt: now }) + '\n');
  }

  return { escapeHatch, count, threshold: CHIEF_BLOCK_CEILING };
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
    } else {
      process.exitCode = 1;
    }
  } catch (_) {
    process.exitCode = 1;
  }
}

module.exports = { recordAndCheck, counterFile, counterKey };
if (require.main === module) main();
