'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { git, snapshot, digest } = require('./git-state');
const { buildExecutionWaves } = require('./routing');
const { writeJsonAtomic } = require('./session');
const SHA = /^[a-f0-9]{40,64}$/;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function taskHash(task) { return digest(JSON.stringify(canonical(task))); }
function taskRevisions(plan) {
  buildExecutionWaves(plan.tasks);
  const revisions = new Map();
  const visit = (task) => {
    if (!revisions.has(task.id)) revisions.set(task.id, digest(JSON.stringify({ task: taskHash(task), dependencies: (task.dependsOn || []).map((id) => [id, visit(plan.tasks.find((item) => item.id === id))]) })));
    return revisions.get(task.id);
  };
  plan.tasks.forEach(visit);
  return revisions;
}
function readJournal(dir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(dir, 'integration.json'), 'utf8'));
    if (!Array.isArray(value)) throw new Error('Invalid integration journal');
    return value;
  } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
}
function completedRecords(plan, dir, cwd) {
  const revisions = taskRevisions(plan);
  const journal = readJournal(dir);
  const completed = new Map();
  for (const task of plan.tasks) {
    const record = journal.findLast((item) => item.taskId === task.id && item.revision === revisions.get(task.id) && item.integratedHead);
    if (!record) continue;
    try { git(cwd, ['merge-base', '--is-ancestor', record.integratedHead, 'HEAD']); } catch (_) { continue; }
    completed.set(task.id, record);
  }
  return completed;
}
// Every Engineer commits directly on the integration branch, so there is nothing to
// fast-forward: the clean integration checkout must already sit at the wave base.
function prepareBranch(cwd, baseHead, integrationRoot) {
  if (!SHA.test(baseHead)) throw new Error('Expected full base commit ID');
  const state = snapshot(cwd);
  if (state.worktree !== fs.realpathSync(integrationRoot)) throw new Error('Engineer must run in the integration checkout');
  if (state.dirtyFiles.length) throw new Error('Engineer must start from a clean integration tree');
  if (state.head !== baseHead) throw new Error('Engineer must start at the approved wave base');
  return state;
}
function ownershipSpec(value) {
  if (typeof value !== 'string' || !value.trim() || /[\\\x00-\x1f]/.test(value) || value.startsWith('/') || value.includes(':') || value.split('/').includes('..')) throw new Error('Invalid task ownership path');
  const name = path.posix.normalize(value.trim()).replace(/\/$/, '');
  if (name === '.') return ':(top)**';
  // Git matches both added and deleted paths. Legacy globs still authorize
  // matching paths during completion validation.
  return /[*?\[]/.test(name) ? `:(top,glob)${name}` : `:(top,literal)${name}`;
}
// Scans every commit between baseHead and head for files outside the task's declared
// ownership. `outside` lists exactly those files; an empty result means every commit
// in range only touched declared files.
function ownershipReport(task, baseHead, head, cwd) {
  const specs = task.files.map(ownershipSpec);
  const commits = git(cwd, ['rev-list', '--reverse', `${baseHead}..${head}`]).trim().split('\n').filter(Boolean);
  const outside = new Set();
  for (const commit of commits) {
    const args = ['diff-tree', '--no-commit-id', '--no-renames', '--name-only', '-r', '-z', commit, '--'];
    const all = git(cwd, args).split('\0').filter(Boolean);
    const allowed = new Set(git(cwd, [...args, ...specs]).split('\0').filter(Boolean));
    all.forEach((file) => { if (!allowed.has(file)) outside.add(file); });
  }
  return { commits, outside: [...outside].sort() };
}
// Dirty files (tracked modifications against HEAD plus untracked content) that fall
// outside the task's declared ownership specs. An empty result means every dirty
// file, if any, is already covered by the task's own files.
function dirtyOutsideOwnership(task, cwd) {
  const specs = task.files.map(ownershipSpec);
  const modified = git(cwd, ['diff', '--name-only', '-z', 'HEAD', '--']).split('\0').filter(Boolean);
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const allowedModified = git(cwd, ['diff', '--name-only', '-z', 'HEAD', '--', ...specs]).split('\0').filter(Boolean);
  const allowedUntracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...specs]).split('\0').filter(Boolean);
  const allowed = new Set([...allowedModified, ...allowedUntracked]);
  const outside = new Set();
  [...modified, ...untracked].forEach((file) => { if (!allowed.has(file)) outside.add(file); });
  return [...outside].sort();
}
function completion(task, baseHead, cwd) {
  const state = snapshot(cwd);
  if (!SHA.test(baseHead) || state.dirtyFiles.length) throw new Error('Completion requires a valid base and committed clean worktree');
  git(cwd, ['merge-base', '--is-ancestor', baseHead, state.head]);
  if (git(cwd, ['rev-list', '--merges', `${baseHead}..${state.head}`]).trim()) throw new Error('Engineer completion must not contain merge commits');
  const { commits, outside } = ownershipReport(task, baseHead, state.head, cwd);
  if (outside.length) throw new Error('Engineer changed files outside declared task ownership in commit history; re-plan before integration');
  const touched = new Set();
  for (const commit of commits) {
    const args = ['diff-tree', '--no-commit-id', '--no-renames', '--name-only', '-r', '-z', commit, '--'];
    git(cwd, args).split('\0').filter(Boolean).forEach((file) => touched.add(file));
  }
  const filesChanged = git(cwd, ['diff', '--no-renames', '--name-only', '-z', baseHead, state.head, '--']).split('\0').filter(Boolean).sort();
  return { taskId: task.id, taskHash: taskHash(task), status: 'done', baseHead, head: state.head, worktree: state.worktree, filesChanged, filesTouched: [...touched].sort() };
}
function integrate(plan, records, dir, cwd) {
  const revisions = taskRevisions(plan);
  if (!Array.isArray(records) || records.length !== 1) throw new Error('Integrate one completion at a time');
  const [record] = records;
  const journal = readJournal(dir);
  const save = () => writeJsonAtomic(path.join(dir, 'integration.json'), journal);
  const task = plan.tasks.find((item) => item.id === record.taskId);
  if (!task || record.taskHash !== taskHash(task)) throw new Error('Completion does not match current task revision');
  const revision = revisions.get(task.id);
  const operation = journal.find((item) => item.taskId === task.id && item.sourceHead === record.head && item.revision === revision);
  const current = snapshot(cwd);
  if (current.dirtyFiles.length) throw new Error('Integration requires a clean worktree');
  if (operation?.integratedHead) {
    try { git(cwd, ['merge-base', '--is-ancestor', operation.integratedHead, current.head]); return journal; }
    catch (_) { delete operation.integratedHead; }
  }
  if (record.status !== 'done' || !SHA.test(record.head) || !SHA.test(record.baseHead)) throw new Error('Incomplete Engineer record');
  if (fs.realpathSync(record.worktree) !== current.worktree) throw new Error('Completion must come from the integration checkout');
  // completion() below scans commits between baseHead and the current head, so the
  // integration branch must not have moved past the record before that scan runs.
  if (current.head !== record.head) throw new Error('Integration branch HEAD does not match the completion; reconcile before integrating');
  const actual = completion(task, record.baseHead, cwd);
  if (actual.head !== record.head || JSON.stringify(actual.filesChanged) !== JSON.stringify(record.filesChanged)) throw new Error('Completion record does not match Git');
  const completed = completedRecords(plan, dir, cwd);
  for (const dependency of task.dependsOn || []) {
    const done = completed.get(dependency);
    if (!done) throw new Error(`Dependency ${dependency} is not integrated at its current revision`);
    git(cwd, ['merge-base', '--is-ancestor', done.integratedHead, record.baseHead]);
  }
  const commits = git(cwd, ['rev-list', '--reverse', `${record.baseHead}..${record.head}`]).trim().split('\n').filter(Boolean);
  // The commits already sit on the integration branch, so applied maps each one to itself.
  journal.push({ taskId: task.id, revision, taskHash: record.taskHash, sourceHead: record.head, sourceWorktree: current.worktree, sourceBranch: branchOf(cwd), beforeHead: record.baseHead, commits, applied: commits.map((commit) => ({ source: commit, head: commit })), integratedHead: record.head });
  save();
  return journal;
}
function branchOf(worktree) {
  const ref = git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  return ref === 'HEAD' ? null : ref;
}
module.exports = { prepareBranch, completion, integrate, readJournal, taskHash, taskRevisions, completedRecords, ownershipSpec, ownershipReport, dirtyOutsideOwnership };
