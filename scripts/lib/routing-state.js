// Author: Subash Karki
// Read-only projection of portable Gorkhali lifecycle state for routing hooks.
'use strict';

const fs = require('fs');
const path = require('path');
const codec = require('../../skills/gorkhali/scripts/lib/shared-state.cjs');
const { SESSION_ABANDON_AFTER_MS } = require('./constants');

const ACTIVE = 'active';
const INACTIVE = 'inactive';
const UNKNOWN = 'unknown';
const STRUCTURAL_ERRORS = new Set(['EISDIR', 'ENOTDIR', 'ELOOP']);

function filesystemFailure(error) {
  return error?.code === 'ENOENT' || STRUCTURAL_ERRORS.has(error?.code)
    ? INACTIVE
    : UNKNOWN;
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { state: filesystemFailure(error) };
  }
  try {
    return { state: ACTIVE, value: JSON.parse(text) };
  } catch (_) {
    return { state: INACTIVE };
  }
}

function realpath(file) {
  try {
    return { state: ACTIVE, value: fs.realpathSync(file) };
  } catch (error) {
    return { state: filesystemFailure(error) };
  }
}

function within(target, root) {
  return target === root || target.startsWith(root + path.sep);
}

// Mirrors gorkhali-state.mjs's isStaleActive(): an unparseable updated_at is
// treated as NOT stale (fail-safe, matching the write-side reader exactly) so
// the two never disagree about the same session. This module is read-only by
// design (a hook helper) - it never performs the lock-guarded write-back that
// currentSession() does on the write side; it only stops COUNTING a session
// that has aged past the threshold as currently active.
function isStaleActive(session) {
  const updatedAt = Date.parse(session?.updated_at);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > SESSION_ABANDON_AFTER_MS;
}

// Pointer task ids to check for this repo: every entry of a version-2
// multi-task record, or the single implicit task of a version-1 scalar record
// left behind by an older install. Malformed/foreign records yield none.
function pointerTaskIds(pointer, repo) {
  if (!pointer || pointer.repo_id !== repo) return [];
  if (pointer.schema_version === 2 && pointer.tasks && typeof pointer.tasks === 'object'
    && !Array.isArray(pointer.tasks)) {
    return Object.keys(pointer.tasks);
  }
  if (pointer.schema_version === 1 && pointer.task_id) return [pointer.task_id];
  return [];
}

function pointerSessionDir(pointer, taskId) {
  if (pointer.schema_version === 2) return pointer.tasks[taskId]?.session_dir;
  return pointer.session_dir;
}

function routingState(workspace) {
  try {
    const root = path.resolve(codec.resolveDataRoot(workspace));
    const identity = codec.repoIdentity(workspace, {
      dataRoot: root,
      gorkhaliRepo: process.env.GORKHALI_REPO,
    });
    if (identity.kind === 'walk-up' || identity.kind === 'default') return UNKNOWN;
    const repo = identity.id;
    const pointerResult = readJson(path.join(root, 'state', 'current-session', `${repo}.json`));
    if (pointerResult.state !== ACTIVE) return pointerResult.state;

    const pointer = pointerResult.value;
    const taskIds = pointerTaskIds(pointer, repo);
    if (taskIds.length === 0) return INACTIVE;

    const sessionsRootResult = realpath(path.join(root, 'repos', repo, 'sessions'));
    if (sessionsRootResult.state !== ACTIVE) return sessionsRootResult.state;

    // ACTIVE as soon as one task in the set is genuinely active. A genuinely
    // ambiguous (non-ENOENT/structural) filesystem error on any one of them
    // aborts the scan as UNKNOWN rather than being silently skipped; anything
    // else about that task just means it is not the active one, and the scan
    // continues to the next candidate.
    for (const taskId of taskIds) {
      const sessionDir = pointerSessionDir(pointer, taskId);
      if (typeof sessionDir !== 'string' || !path.isAbsolute(sessionDir)) continue;
      const sessionDirResult = realpath(sessionDir);
      if (sessionDirResult.state !== ACTIVE) {
        if (sessionDirResult.state === UNKNOWN) return UNKNOWN;
        continue;
      }
      if (!within(sessionDirResult.value, sessionsRootResult.value)) continue;

      const sessionResult = readJson(path.join(sessionDirResult.value, 'session.json'));
      if (sessionResult.state === UNKNOWN) return UNKNOWN;
      if (sessionResult.state !== ACTIVE) continue;
      const session = sessionResult.value;
      const isActive = session?.schema_version === 1
        && session.repo_id === repo
        && session.task_id === taskId
        && session.status === 'active'
        && session.workspace === identity.root
        && !isStaleActive(session);
      if (isActive) return ACTIVE;
    }
    return INACTIVE;
  } catch (_) {
    return UNKNOWN;
  }
}

module.exports = { ACTIVE, INACTIVE, UNKNOWN, routingState };
