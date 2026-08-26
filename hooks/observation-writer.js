#!/usr/bin/env node
// Author: Subash Karki
// observation-writer.js — PostToolUse. Lean input to the auto-learn loop.
//
// Edit/Write: record the touched path (cap 40) so the next prompt injects that
// domain, not every domain. Bash: append one observations jsonl line ONLY on
// failure. Successful edits are not learnings. Never logs file contents.
// Silent; never throws; never prints.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let observationsDir, stateDir;
try {
  ({ observationsDir, stateDir } = require('../scripts/lib/gorkhali-paths'));
} catch (_) {
  const home = os.homedir();
  const data = process.env.GORKHALI_DATA ||
    (home ? path.join(home, '.gorkhali') : path.join(process.cwd(), '.gorkhali'));
  observationsDir = () => path.join(data, 'observations');
  stateDir = () => path.join(data, 'state');
}

const TOUCHED_CAP = 40;
const CMD_CAP = 180;

function readPayload() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function sessionIdOf(payload) {
  const raw = payload.session_id || process.env.CLAUDE_SESSION_ID || '';
  return typeof raw === 'string' && raw.length > 0
    ? raw.replace(/[^A-Za-z0-9_-]/g, '_')
    : '';
}

function toolNameOf(payload) {
  return String(payload.tool_name || payload.toolName || '').replace(/^mcp__/, '');
}

function pathsOf(input) {
  const out = [];
  if (!input || typeof input !== 'object') return out;
  for (const key of ['file_path', 'path', 'filePath']) {
    if (typeof input[key] === 'string' && input[key]) out.push(input[key]);
  }
  if (Array.isArray(input.files)) {
    for (const item of input.files) {
      if (typeof item === 'string') out.push(item);
      else if (item && typeof item.path === 'string') out.push(item.path);
    }
  }
  return out;
}

function recordTouched(sessionId, files) {
  if (!sessionId || files.length === 0) return;
  const dir = path.join(stateDir(), 'memory-touched');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, sessionId);
  let existing = [];
  try {
    if (fs.existsSync(file)) {
      existing = fs.readFileSync(file, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
    }
  } catch (_) { /* fail open */ }
  const seen = new Set(existing);
  for (const p of files) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    existing.push(p);
  }
  fs.writeFileSync(file, existing.slice(-TOUCHED_CAP).join('\n') + '\n');
}

function bashFailed(payload) {
  const resp = payload.tool_response || payload.response || {};
  if (typeof resp.exitCode === 'number') return resp.exitCode !== 0;
  if (typeof resp.exit_code === 'number') return resp.exit_code !== 0;
  if (payload.is_error === true) return true;
  return false;
}

function writeObservation(payload, tool) {
  const input = payload.tool_input || {};
  const resp = payload.tool_response || payload.response || {};
  const exitCode = (typeof resp.exitCode === 'number')
    ? resp.exitCode
    : (typeof resp.exit_code === 'number' ? resp.exit_code : 1);
  const command = String(input.command || '').slice(0, CMD_CAP);
  const rec = {
    ts: new Date().toISOString(),
    session: payload.session_id || process.env.CLAUDE_SESSION_ID || 'unknown',
    tool,
    file: '',
    command,
    exitCode,
    summary: 'bash failed',
  };
  const dir = observationsDir();
  fs.mkdirSync(dir, { recursive: true });
  const day = rec.ts.slice(0, 10);
  fs.appendFileSync(path.join(dir, `${day}.jsonl`), JSON.stringify(rec) + '\n');
}

try {
  const payload = readPayload();
  if (!payload) process.exit(0);
  const tool = toolNameOf(payload);
  const sid = sessionIdOf(payload);
  const input = payload.tool_input || {};

  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
    recordTouched(sid, pathsOf(input));
    process.exit(0);
  }

  if (tool === 'Bash' && bashFailed(payload)) {
    writeObservation(payload, tool);
  }
} catch (_) {
  // never break the tool
}
process.exit(0);
