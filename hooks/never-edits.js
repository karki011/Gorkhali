#!/usr/bin/env node
// Author: Subash Karki
// Enforce lead editing discipline while a session is active. Only the exact
// live Engineer identity may use implementation editing tools. The lead may
// write external session state and call the bounded lifecycle CLI. Repository
// commands executed by agents are not sandboxed by this workflow hook.
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
  if (!/^(gorkhali:)?engineer$/.test(payload.agent_type || '')) return 0;
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

// Match this exact Engineer, repository, and session; never borrow a peer marker.
function markerMatches(cwd, sessionId, agentId) {
  if (!ID_RE.test(agentId || '')) return false;
  const dir = editorsDir(cwd);
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return false; }
  const now = Date.now();
  const repo = paths.repoSlug(cwd);
  return names.some((name) => {
    if (name !== agentId) return false;
    try {
      const stat = fs.statSync(path.join(dir, name));
      if (now - stat.mtimeMs >= MARKER_MAX_AGE_MS) return false;
      const marker = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
      return marker && marker.agentId === agentId && marker.repo === repo && marker.sessionId === sessionId;
    } catch (_) {
      return false;
    }
  });
}

function targetPaths(toolInput) {
  const value = toolInput.file_path || toolInput.path || toolInput.notebook_path;
  return value ? [String(value)] : [];
}

// Resolve existing ancestors too, so an external-state symlink is not an edit
// escape into implementation code. Missing leaf files remain creatable.
function realTarget(target) {
  try { return fs.realpathSync(target); } catch (err) {
    if (err.code !== 'ENOENT' || path.dirname(target) === target) throw err;
    return path.join(realTarget(path.dirname(target)), path.basename(target));
  }
}

// Every target resolves inside the active session's own directory - the
// orchestrator writing its own plan.json/progress.json/scratch is fine.
function insideSessionDir(sessionDir, targets, cwd) {
  if (!sessionDir || targets.length === 0) return false;
  const root = realTarget(path.resolve(sessionDir));
  return targets.every((target) => {
    const resolved = realTarget(path.resolve(cwd, target));
    return resolved === root || resolved.startsWith(root + path.sep);
  });
}

// Every target resolves inside the Gorkhali data root - nothing under it is
// project code (preferences.md, session state, editor markers, ...), so the
// orchestrator writing there directly, e.g. appending to the preferences
// file, is fine.
function insideDataRoot(targets, cwd) {
  if (targets.length === 0) return false;
  const root = realTarget(path.resolve(paths.dataRoot(cwd)));
  return targets.every((target) => {
    const resolved = realTarget(path.resolve(cwd, target));
    return resolved === root || resolved.startsWith(root + path.sep);
  });
}

function decide(payload) {
  const cwd = payload.cwd || process.cwd();
  if (!fs.existsSync(paths.sentinelPath(cwd))) return 0;

  const active = session.activeSession(cwd);
  if (payload.tool_name === 'Bash' && !payload.agent_id) {
    const cli = path.join(__dirname, '..', 'lib', 'cli.js');
    const escaped = cli.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const command = payload.tool_input?.command || '';
    if (new RegExp(`^node (?:"${escaped}"|'${escaped}'|${escaped}) [a-z-]+(?: [A-Za-z0-9+/=_.-]+)?$`).test(command)) return 0;
    process.stderr.write('GORKHALI: lead shell access is limited to node <plugin>/lib/cli.js <action> <base64-json>. Delegate implementation and other shell work.\n');
    return 2;
  }
  if (payload.tool_name === 'Bash') return 0;
  const targets = targetPaths(payload.tool_input || {});
  if (active && insideSessionDir(active.sessionDir, targets, cwd)) return 0;

  if (insideDataRoot(targets, cwd)) return 0;

  if (markerMatches(cwd, String(payload.session_id || ''), payload.agent_id)) return 0;

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
