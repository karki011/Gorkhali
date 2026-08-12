#!/usr/bin/env node
// Author: Subash Karki
'use strict';

const fs = require('fs');
const path = require('path');
const { phantomData, detectRepo } = require('../scripts/lib/phantom-paths');
const { MARKER_FRESHNESS_MS } = require('../scripts/lib/constants');

const MAX_AGE_MS = Math.min(MARKER_FRESHNESS_MS, 24 * 60 * 60 * 1000);
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ELIGIBLE_NAME_RE = /^(?:blade|sweep)-[a-z0-9][a-z0-9-]*$/;

function markerDir(cwd = process.cwd()) {
  return path.join(phantomData(cwd), '.blade-editing.d', detectRepo(cwd));
}

function payloadId(payload = {}) {
  return String(payload.agent_id || payload.tool_use_id || payload.toolUseId || payload.id || '');
}

function payloadName(payload = {}) {
  return String(payload.agent_type || payload.name || '').toLowerCase();
}

function readMarker(file) {
  try {
    const stat = fs.statSync(file);
    const marker = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!marker || typeof marker !== 'object') return null;
    return { ...marker, mtimeMs: stat.mtimeMs };
  } catch (_) {
    return null;
  }
}

function validMarker(marker, id) {
  return Boolean(
    marker &&
    marker.id === id &&
    ELIGIBLE_NAME_RE.test(marker.name) &&
    typeof marker.sessionId === 'string' && marker.sessionId &&
    typeof marker.repo === 'string' && marker.repo
  );
}

function freshMarkers(cwd = process.cwd(), now = Date.now()) {
  const dir = markerDir(cwd);
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names.flatMap((name) => {
    if (!ID_RE.test(name)) return [];
    const marker = readMarker(path.join(dir, name));
    if (!validMarker(marker, name) || now - marker.mtimeMs >= MAX_AGE_MS) return [];
    return [{ ...marker, file: name }];
  });
}

function start(payload = {}) {
  const id = payloadId(payload);
  const name = payloadName(payload);
  const sessionId = String(payload.session_id || '');
  if (!ID_RE.test(id) || !ELIGIBLE_NAME_RE.test(name) || !sessionId) return false;
  const cwd = payload.cwd || process.cwd();
  const dir = markerDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id), JSON.stringify({
    id,
    name,
    sessionId,
    repo: detectRepo(cwd),
    startedAt: new Date().toISOString(),
  }) + '\n', { flag: 'wx' });
  return true;
}

function stop(payload = {}) {
  const id = payloadId(payload);
  if (!ID_RE.test(id)) return false;
  const cwd = payload.cwd || process.cwd();
  const file = path.join(markerDir(cwd), id);
  if (!validMarker(readMarker(file), id)) return false;
  try { fs.unlinkSync(file); return true; } catch (_) { return false; }
}

function active(payload = {}) {
  const sessionId = String(payload.session_id || '');
  if (!sessionId) return false;
  const cwd = payload.cwd || process.cwd();
  const repo = detectRepo(cwd);
  return freshMarkers(cwd).some((marker) => marker.repo === repo && marker.sessionId === sessionId);
}

function legacyActive(cwd = process.cwd(), now = Date.now()) {
  try {
    return now - fs.statSync(path.join(phantomData(cwd), '.blade-editing')).mtimeMs < MAX_AGE_MS;
  } catch (_) {
    return false;
  }
}

function readPayload() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return {}; }
}

function main() {
  const command = process.argv[2];
  const payload = readPayload();
  try {
    let result;
    if (command === 'start') result = start(payload);
    else if (command === 'stop') result = stop(payload);
    else if (command === 'legacy') result = legacyActive(payload.cwd || process.cwd());
    else result = active(payload);
    process.exitCode = command === 'start' || command === 'stop' ? 0 : result ? 0 : 1;
  } catch (_) {
    process.exitCode = 1;
  }
}

module.exports = { MAX_AGE_MS, markerDir, freshMarkers, start, stop, active, legacyActive };
if (require.main === module) main();
