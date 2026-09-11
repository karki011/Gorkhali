#!/usr/bin/env node
// Author: Subash Karki
// never-edits.js - Core Discipline #13: the orchestrating session must not
// call Edit/Write/MultiEdit/NotebookEdit directly; all implementation goes
// through spawned subagents (Engineer et al). One self-contained program,
// three argv modes:
//
//   start  (SubagentStart) - writes a marker for the spawned agent under
//                            <data root>/editors/<repo slug>/<agent id>,
//                            so the marker exists whether or not a session
//                            directory has been created yet.
//   stop   (SubagentStop)  - removes that marker.
//   (none) (PreToolUse Edit|Write|MultiEdit|NotebookEdit) - reads the hook
//                            payload from stdin and decides allow/deny.
//
// The default mode ALLOWS when: no gorkhali session is active (the
// .session-active sentinel is absent); every target path resolves inside
// the active session's own directory (plan.json, progress.json, scratch/,
// ...); every target path resolves inside the Gorkhali data root (nothing
// under it is project code, e.g. the preferences file); or a marker younger
// than MARKER_MAX_AGE_MS names this exact repo and session id (a live
// subagent is editing). Otherwise it exits 2.
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('../lib/paths');
const session = require('../lib/session');

const MARKER_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function editorsDir(cwd) {
  return path.join(paths.dataRoot(cwd), 'editors', paths.repoSlug(cwd));
}

function markerFile(cwd, agentId) {
  return path.join(editorsDir(cwd), agentId);
}

function readPayload() {
  try { return JSON.parse(fs.readFileSync(0, 'utf-8')); } catch (_) { return {}; }
}

function start(payload) {
  const agentId = String(payload.agent_id || '');
  if (!ID_RE.test(agentId)) return 1;
  const cwd = payload.cwd || process.cwd();
  const dir = editorsDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(markerFile(cwd, agentId), JSON.stringify({
    agentId,
    sessionId: String(payload.session_id || ''),
    repo: paths.repoSlug(cwd),
    startedAt: new Date().toISOString(),
  }) + '\n');
  return 0;
}

function stop(payload) {
  const agentId = String(payload.agent_id || '');
  if (ID_RE.test(agentId)) {
    const cwd = payload.cwd || process.cwd();
    try { fs.unlinkSync(markerFile(cwd, agentId)); } catch (_) { /* already gone */ }
  }
  return 0;
}

// A marker younger than MARKER_MAX_AGE_MS whose repo and session id match
// this exact edit means a live subagent is doing the editing.
function markerMatches(cwd, sessionId) {
  const dir = editorsDir(cwd);
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return false; }
  const now = Date.now();
  const repo = paths.repoSlug(cwd);
  return names.some((name) => {
    if (!ID_RE.test(name)) return false;
    try {
      const stat = fs.statSync(path.join(dir, name));
      if (now - stat.mtimeMs >= MARKER_MAX_AGE_MS) return false;
      const marker = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
      return marker && marker.repo === repo && marker.sessionId === sessionId;
    } catch (_) {
      return false;
    }
  });
}

function targetPaths(toolInput) {
  const value = toolInput.file_path || toolInput.path;
  return value ? [String(value)] : [];
}

// Every target resolves inside the active session's own directory - the
// orchestrator writing its own plan.json/progress.json/scratch is fine.
function insideSessionDir(sessionDir, targets, cwd) {
  if (!sessionDir || targets.length === 0) return false;
  const root = path.resolve(sessionDir);
  return targets.every((target) => {
    const resolved = path.resolve(cwd, target);
    return resolved === root || resolved.startsWith(root + path.sep);
  });
}

// Every target resolves inside the Gorkhali data root - nothing under it is
// project code (preferences.md, session state, editor markers, ...), so the
// orchestrator writing there directly, e.g. appending to the preferences
// file, is fine.
function insideDataRoot(targets, cwd) {
  if (targets.length === 0) return false;
  const root = path.resolve(paths.dataRoot(cwd));
  return targets.every((target) => {
    const resolved = path.resolve(cwd, target);
    return resolved === root || resolved.startsWith(root + path.sep);
  });
}

function decide(payload) {
  const cwd = payload.cwd || process.cwd();
  if (!fs.existsSync(paths.sentinelPath(cwd))) return 0;

  const active = session.activeSession(cwd);
  const targets = targetPaths(payload.tool_input || {});
  if (active && insideSessionDir(active.sessionDir, targets, cwd)) return 0;

  if (insideDataRoot(targets, cwd)) return 0;

  if (markerMatches(cwd, String(payload.session_id || ''))) return 0;

  process.stderr.write(
    'CORE DISCIPLINE #13 VIOLATION - the orchestrating session must not edit ' +
    'files directly.\n\n  Tool: ' + (payload.tool_name || 'unknown') +
    '\n  File: ' + (targets[0] || 'unknown') +
    '\n\nSpawn an Engineer agent via the Agent tool instead. All implementation ' +
    'goes through subagents.\n'
  );
  return 2;
}

function main() {
  const mode = process.argv[2];
  const payload = readPayload();
  if (mode === 'start') process.exitCode = start(payload);
  else if (mode === 'stop') process.exitCode = stop(payload);
  else process.exitCode = decide(payload);
}

main();
