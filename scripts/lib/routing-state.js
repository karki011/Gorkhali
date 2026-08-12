// Author: Subash Karki
// Read-only projection of portable Phantom lifecycle state for routing hooks.
'use strict';

const fs = require('fs');
const path = require('path');
const codec = require('../../skills/phantom/scripts/lib/shared-state.cjs');

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

function routingState(workspace) {
  try {
    const root = path.resolve(codec.resolveDataRoot(workspace));
    const identity = codec.repoIdentity(workspace, {
      dataRoot: root,
      phantomRepo: process.env.PHANTOM_REPO,
    });
    if (identity.kind === 'walk-up' || identity.kind === 'default') return UNKNOWN;
    const repo = identity.id;
    const pointerResult = readJson(path.join(root, 'state', 'current-session', `${repo}.json`));
    if (pointerResult.state !== ACTIVE) return pointerResult.state;

    const pointer = pointerResult.value;
    if (pointer?.schema_version !== 1 || pointer.repo_id !== repo || !pointer.task_id) return INACTIVE;
    if (typeof pointer.session_dir !== 'string' || !path.isAbsolute(pointer.session_dir)) return INACTIVE;

    const sessionsRootResult = realpath(path.join(root, 'repos', repo, 'sessions'));
    const sessionDirResult = realpath(pointer.session_dir);
    if (sessionsRootResult.state !== ACTIVE) return sessionsRootResult.state;
    if (sessionDirResult.state !== ACTIVE) return sessionDirResult.state;
    if (!within(sessionDirResult.value, sessionsRootResult.value)) return INACTIVE;

    const sessionResult = readJson(path.join(sessionDirResult.value, 'session.json'));
    if (sessionResult.state !== ACTIVE) return sessionResult.state;
    const session = sessionResult.value;
    return session?.schema_version === 1
      && session.repo_id === repo
      && session.task_id === pointer.task_id
      && session.status === 'active'
      && session.workspace === identity.root
      ? ACTIVE
      : INACTIVE;
  } catch (_) {
    return UNKNOWN;
  }
}

module.exports = { ACTIVE, INACTIVE, UNKNOWN, routingState };
