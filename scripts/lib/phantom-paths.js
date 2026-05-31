// Author: Subash Karki
// phantom-paths.js — single source of truth for Phantom mutable-state paths.
// Pure path computation: no side effects, no mkdir at import time.
// Callers create directories as needed.

'use strict';

const os = require('os');
const path = require('path');

/** Root for all Phantom mutable state. PHANTOM_DATA overrides the default. */
function phantomData() {
  return process.env.PHANTOM_DATA || path.join(os.homedir(), '.claude', 'phantom-data');
}

/** Per-repo state dir: <data>/repos/<repoName> */
function repoDir(repoName) {
  return path.join(phantomData(), 'repos', repoName);
}

/** Per-repo event log dir: <data>/events/<repo> */
function eventsDir(repo) {
  return path.join(phantomData(), 'events', repo);
}

/** Observation capture dir: <data>/observations */
function observationsDir() {
  return path.join(phantomData(), 'observations');
}

/** Promoted global patterns dir: <data>/global/patterns */
function globalPatternsDir() {
  return path.join(phantomData(), 'global', 'patterns');
}

/** Hook/session state dir: <data>/state */
function stateDir()     { return path.join(phantomData(), 'state'); }

/** Per-session state dir: <data>/state/sessions */
function sessionsDir()  { return path.join(stateDir(), 'sessions'); }

/** Archived session dir: <data>/state/completed */
function completedDir() { return path.join(stateDir(), 'completed'); }

/** Learnings dir: <data>/learnings */
function learningsDir() { return path.join(phantomData(), 'learnings'); }

/** Audit log dir: <data>/audit */
function auditDir()     { return path.join(phantomData(), 'audit'); }

module.exports = {
  phantomData,
  repoDir,
  eventsDir,
  observationsDir,
  globalPatternsDir,
  stateDir,
  sessionsDir,
  completedDir,
  learningsDir,
  auditDir,
};
