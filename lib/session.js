// Author: Subash Karki
// session.js - the plan.json plus scratch-folder session model: three files
// per task, plan.json, progress.json and a scratch/ dir, plus an
// active-session sentinel keyed by checkout, with a legacy global fallback.
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { snapshot, git } = require('./git-state');
const { randomUUID } = require('node:crypto');

/** Write JSON atomically: unique same-dir tmp file, then rename. */
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Read and parse a JSON file. Returns `fallback` for a missing or unparseable file. */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function planFile(repo, task, cwd) {
  return path.join(paths.sessionDir(repo, task, cwd), 'plan.json');
}

function progressFile(repo, task, cwd) {
  return path.join(paths.sessionDir(repo, task, cwd), 'progress.json');
}

/** Scratch dir for a task: <sessionDir>/scratch, isolated per repo+task. */
function scratchDir(repo, task, cwd = process.cwd()) {
  const dir = path.join(paths.sessionDir(repo, task, cwd), 'scratch');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A path inside a task's scratch dir; ensures its parent directory exists. */
function scratchPath(repo, task, relPath, cwd = process.cwd()) {
  const dir = scratchDir(repo, task, cwd);
  const target = path.join(dir, relPath);
  if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) throw new Error('Scratch path escapes session');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

/**
 * Open a session for repo+task: ensures the session dir and scratch dir
 * exist, and writes the checkout-keyed active-session sentinel recording
 * which session is now live. Idempotent: reopening an existing session never
 * touches its plan.json or progress.json.
 */
function openSession(repo, task, cwd = process.cwd()) {
  const dir = paths.sessionDir(repo, task, cwd);
  fs.mkdirSync(dir, { recursive: true });
  scratchDir(repo, task, cwd);
  const identity = paths.repositoryIdentity(cwd);
  writeJsonAtomic(paths.identityFile(cwd), { identity, repo });
  writeJsonAtomic(paths.sentinelPath(cwd), {
    repo,
    identity,
    task,
    sessionDir: dir,
    openedAt: new Date().toISOString(),
  });
  return dir;
}

function unlinkIfExists(file) {
  try { fs.unlinkSync(file); } catch (err) { if (err.code !== 'ENOENT') throw err; }
}

/**
 * Close the active session: removes this checkout's keyed sentinel and, when
 * it names the same session (or no keyed sentinel exists and it matches this
 * repo), also removes the legacy global sentinel so it never lingers.
 */
function closeSession(cwd = process.cwd()) {
  const keyed = readJson(paths.sentinelPath(cwd), null);
  unlinkIfExists(paths.sentinelPath(cwd));
  const legacy = readJson(paths.legacySentinelPath(cwd), null);
  if (legacy && (keyed ? legacy.sessionDir === keyed.sessionDir : activeMatchesRepo(legacy, cwd))) {
    unlinkIfExists(paths.legacySentinelPath(cwd));
  }
}

/**
 * The active session record ({ repo, task, sessionDir, openedAt }), or null
 * when no session is open. Reads this checkout's keyed sentinel first; when
 * absent, falls back to the legacy global sentinel only if it matches this repo.
 */
function activeSession(cwd = process.cwd()) {
  const keyed = readJson(paths.sentinelPath(cwd), null);
  if (keyed) return keyed;
  const legacy = readJson(paths.legacySentinelPath(cwd), null);
  return activeMatchesRepo(legacy, cwd) ? legacy : null;
}

function activeMatchesRepo(active, cwd = process.cwd()) {
  if (!active) return false;
  if (process.env.GORKHALI_REPO?.trim() && process.env.GORKHALI_REPO.trim() !== active.repo) return false;
  if (active.identity) return active.identity === paths.repositoryIdentity(cwd);
  const old = readJson(path.join(active.sessionDir || '', 'checkpoint.json'), null);
  if (old?.worktree && fs.existsSync(old.worktree)) return paths.repositoryIdentity(old.worktree) === paths.repositoryIdentity(cwd);
  return active.repo === paths.repoSlug(cwd);
}

/** Read plan.json for repo+task. Returns null when the session or file does not exist. */
function readPlan(repo, task, cwd = process.cwd()) {
  return readJson(planFile(repo, task, cwd), null);
}

/** Write plan.json for repo+task, creating the session dir if needed. */
function writePlan(repo, task, data, cwd = process.cwd()) {
  writeJsonAtomic(planFile(repo, task, cwd), data);
  checkpoint(repo, task, { phase: 'planned', next: 'approve', verification: 'not_started', completedTasks: [], pendingTasks: data.tasks?.map((item) => item.id) || [] }, cwd);
}

/** Read progress.json for repo+task as an array. Returns [] when absent. */
function readProgress(repo, task, cwd = process.cwd()) {
  const value = readJson(progressFile(repo, task, cwd), []);
  return Array.isArray(value) ? value : [];
}

/** Append one entry to progress.json, stamping `at`, and return the updated array. */
function appendProgress(repo, task, entry, cwd = process.cwd()) {
  const list = readProgress(repo, task, cwd);
  list.push({ at: new Date().toISOString(), ...entry });
  writeJsonAtomic(progressFile(repo, task, cwd), list);
  checkpoint(repo, task, entry, cwd);
  return list;
}

function readCheckpoint(repo, task, cwd = process.cwd()) {
  return readJson(path.join(paths.sessionDir(repo, task, cwd), 'checkpoint.json'), null);
}

function checkpoint(repo, task, entry = {}, cwd = process.cwd()) {
  const previous = readCheckpoint(repo, task, cwd);
  let state;
  try { state = snapshot(cwd); } catch (_) { state = { head: null, branch: null, worktree: cwd, dirtyFiles: [], fingerprint: null }; }
  const value = { schemaVersion: 1, phase: 'planned', wave: 0, completedTasks: [], pendingTasks: [], blocked: [], verification: 'not_started', next: 'approve', ...previous };
  for (const key of ['phase', 'wave', 'completedTasks', 'pendingTasks', 'blocked', 'next', 'verification', 'activeEngineers', 'repairAttempts', 'pr', 'approvedPlanHash', 'baseHead', 'routing', 'implementationFailures', 'verificationFailures', 'failureClass', 'failureId', 'lastRepairFailureId', 'reviewRound', 'handledReviewIds', 'assignments', 'consumedResults', 'reconciliationRequired', 'reconciliationReason', 'reviewHead', 'reviewChecks', 'escalationReason', 'pendingFailureIds', 'reviewItemVersions']) {
    if (entry[key] !== undefined) value[key] = entry[key];
  }
  if (entry.mergedPr !== undefined) value.mergedPr = entry.mergedPr;
  if (previous?.fingerprint !== state.fingerprint && previous?.verification === 'passed' && entry.verification !== 'passed') value.verification = 'stale';
  if (!state.fingerprint && value.verification === 'passed') value.verification = 'stale';
  Object.assign(value, state, { at: new Date().toISOString() });
  writeJsonAtomic(path.join(paths.sessionDir(repo, task, cwd), 'checkpoint.json'), value);
  return value;
}

/**
 * Classify a fingerprint change against the saved checkpoint: `unchanged` when
 * fingerprints match; `branch_work` when the checkout is still the dispatched
 * branch and worktree and every active engineer is a branch-mode assignment
 * whose base is HEAD or an ancestor of it, meaning the change is that
 * Engineer's own in-progress commits rather than external drift; `divergent`
 * otherwise, the general "something else touched Git" case.
 */
function classifyChange(saved, current, cwd) {
  if (saved?.fingerprint === current.fingerprint) return 'unchanged';
  const activeIds = saved?.activeEngineers;
  // A branch switch or a move to another worktree means this is no longer the
  // dispatched Engineer's own checkout, even if HEAD still descends from its base.
  if (Array.isArray(activeIds) && activeIds.length && current.branch === saved.branch && current.worktree === saved.worktree) {
    const isBranchWork = activeIds.every((id) => {
      const assignment = saved.assignments?.find((item) => item.id === id);
      if (!assignment || assignment.isolation !== 'branch') return false;
      if (current.head === assignment.baseHead) return true;
      try { git(cwd, ['merge-base', '--is-ancestor', assignment.baseHead, current.head]); return true; }
      catch (_) { return false; }
    });
    if (isBranchWork) return 'branch_work';
  }
  return 'divergent';
}

function resume(repo, task, cwd = process.cwd()) {
  const plan = readPlan(repo, task, cwd);
  if (!plan) throw new Error('No readable plan for this session');
  const saved = readCheckpoint(repo, task, cwd);
  const current = snapshot(cwd);
  const classification = classifyChange(saved, current, cwd);
  const changed = classification !== 'unchanged';
  const progress = readProgress(repo, task, cwd);
  const legacy = saved ? {} : { phase: plan.phase || progress.at(-1)?.phase || 'planned', next: 'reconcile', pendingTasks: plan.tasks.map((item) => item.id) };
  const divergenceEntry = classification === 'divergent' ? { verification: 'stale', next: 'reconcile', reconciliationRequired: true }
    : classification === 'branch_work' ? { verification: 'stale', next: 'result' }
    : {};
  const restored = checkpoint(repo, task, { ...legacy, ...divergenceEntry }, cwd);
  openSession(repo, task, cwd);
  return { checkpoint: restored, previous: saved, changed, plan, ...(classification === 'branch_work' ? { branchWork: true } : {}) };
}

module.exports = {
  openSession,
  closeSession,
  activeSession,
  activeMatchesRepo,
  readPlan,
  writePlan,
  readProgress,
  appendProgress,
  scratchDir,
  scratchPath,
  writeJsonAtomic,
  readCheckpoint,
  checkpoint,
  classifyChange,
  resume,
};
