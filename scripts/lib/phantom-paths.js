// Author: Subash Karki
// phantom-paths.js — single source of truth for Phantom mutable-state paths.
// Pure path computation: no side effects, no mkdir at import time.
// Callers create directories as needed.

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

/** Root for all Phantom mutable state. PHANTOM_DATA overrides the default. */
function phantomData() {
  return process.env.PHANTOM_DATA || path.join(os.homedir(), '.claude', 'phantom-data');
}

/**
 * Resolve the current repo name. PHANTOM_REPO overrides; otherwise walk up
 * from cwd to the first dir holding a `.git` entry (dir or file) and take its
 * basename; no `.git` anywhere up the tree -> '_default'. Never throws.
 */
function detectRepo(cwd = process.cwd()) {
  try {
    const override = process.env.PHANTOM_REPO;
    if (override && override.trim()) return override.trim();
    let dir = path.resolve(cwd);
    while (true) {
      if (fs.existsSync(path.join(dir, '.git'))) return path.basename(dir);
      const parent = path.dirname(dir);
      if (parent === dir) return '_default'; // reached filesystem root
      dir = parent;
    }
  } catch (_err) {
    return '_default';
  }
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

/** Per-repo session dir: <data>/repos/<repo>/sessions */
function sessionsDir(repo = detectRepo())  { return path.join(repoDir(repo), 'sessions'); }

/** Per-repo archived session dir: <data>/repos/<repo>/completed */
function completedDir(repo = detectRepo()) { return path.join(repoDir(repo), 'completed'); }

/** Per-repo learnings dir: <data>/repos/<repo>/learnings */
function learningsDir(repo = detectRepo()) { return path.join(repoDir(repo), 'learnings'); }

/** Audit log dir: <data>/audit */
function auditDir()     { return path.join(phantomData(), 'audit'); }

module.exports = {
  phantomData,
  detectRepo,
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
