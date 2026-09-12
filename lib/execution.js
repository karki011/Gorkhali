'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { git, snapshot, digest } = require('./git-state');
const { buildExecutionWaves, canRunInParallel } = require('./routing');
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
function commonDir(cwd) { return fs.realpathSync(path.resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']).trim())); }
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
function prepareWorktree(cwd, baseHead, integrationRoot) {
  if (!SHA.test(baseHead)) throw new Error('Expected full base commit ID');
  const state = snapshot(cwd);
  if (state.worktree === fs.realpathSync(integrationRoot) || commonDir(cwd) !== commonDir(integrationRoot)) throw new Error('Engineer requires a separate worktree in this repository');
  if (state.dirtyFiles.length) throw new Error('Engineer worktree is not clean');
  git(cwd, ['merge', '--ff-only', baseHead]);
  if (snapshot(cwd).head !== baseHead) throw new Error('Engineer must start at the approved wave base');
  return snapshot(cwd);
}
function ownershipSpec(value) {
  if (typeof value !== 'string' || !value.trim() || /[\\\x00-\x1f]/.test(value) || value.startsWith('/') || value.includes(':') || value.split('/').includes('..')) throw new Error('Invalid task ownership path');
  const name = path.posix.normalize(value.trim()).replace(/\/$/, '');
  if (name === '.') return ':(top)**';
  // Git matches both added and deleted paths. Globs remain serial scheduling
  // evidence, but still authorize matching paths during completion validation.
  return /[*?\[]/.test(name) ? `:(top,glob)${name}` : `:(top,literal)${name}`;
}
function completion(task, baseHead, cwd) {
  const state = snapshot(cwd);
  if (!SHA.test(baseHead) || state.dirtyFiles.length) throw new Error('Completion requires a valid base and committed clean worktree');
  git(cwd, ['merge-base', '--is-ancestor', baseHead, state.head]);
  if (git(cwd, ['rev-list', '--merges', `${baseHead}..${state.head}`]).trim()) throw new Error('Engineer completion must not contain merge commits');
  const specs = task.files.map(ownershipSpec);
  const commits = git(cwd, ['rev-list', '--reverse', `${baseHead}..${state.head}`]).trim().split('\n').filter(Boolean);
  const touched = new Set();
  for (const commit of commits) {
    const args = ['diff-tree', '--no-commit-id', '--no-renames', '--name-only', '-r', '-z', commit, '--'];
    const all = git(cwd, args).split('\0').filter(Boolean);
    const allowed = new Set(git(cwd, [...args, ...specs]).split('\0').filter(Boolean));
    if (all.some((file) => !allowed.has(file))) throw new Error('Engineer changed files outside declared task ownership in commit history; re-plan before integration');
    all.forEach((file) => touched.add(file));
  }
  const filesChanged = git(cwd, ['diff', '--no-renames', '--name-only', '-z', baseHead, state.head, '--']).split('\0').filter(Boolean).sort();
  return { taskId: task.id, taskHash: taskHash(task), status: 'done', baseHead, head: state.head, worktree: state.worktree, filesChanged, filesTouched: [...touched].sort() };
}
function appliedCommits(cwd, beforeHead, source) {
  git(cwd, ['merge-base', '--is-ancestor', beforeHead, 'HEAD']);
  const commits = git(cwd, ['rev-list', '--reverse', `${beforeHead}..HEAD`]).trim().split('\n').filter(Boolean);
  return commits.filter((head) => git(cwd, ['show', '-s', '--format=%B', head]).split('\n').includes(`(cherry picked from commit ${source})`));
}
function integrate(plan, records, dir, cwd) {
  const revisions = taskRevisions(plan);
  if (!Array.isArray(records) || !records.length || new Set(records.map((record) => record.taskId)).size !== records.length) throw new Error('Expected unique completion records');
  for (let i = 0; i < records.length; i++) {
    for (const other of records.slice(i + 1)) {
      if (records[i].baseHead !== other.baseHead || !canRunInParallel(plan.tasks.find((task) => task.id === records[i].taskId), plan.tasks.find((task) => task.id === other.taskId), plan.tasks)) throw new Error('Completion records are not an eligible parallel wave');
    }
  }
  const journal = readJournal(dir);
  const save = () => writeJsonAtomic(path.join(dir, 'integration.json'), journal);
  for (const record of [...records].sort((a, b) => plan.tasks.findIndex((t) => t.id === a.taskId) - plan.tasks.findIndex((t) => t.id === b.taskId))) {
    const task = plan.tasks.find((item) => item.id === record.taskId);
    if (!task || record.taskHash !== taskHash(task)) throw new Error('Completion does not match current task revision');
    const revision = revisions.get(task.id);
    let operation = journal.find((item) => item.taskId === task.id && item.sourceHead === record.head && item.revision === revision);
    const current = snapshot(cwd);
    if (current.dirtyFiles.length) throw new Error('Integration requires a clean worktree');
    if (operation?.integratedHead) {
      try { git(cwd, ['merge-base', '--is-ancestor', operation.integratedHead, current.head]); continue; }
      catch (_) { delete operation.integratedHead; }
    }
    if (record.status !== 'done' || !SHA.test(record.head) || !SHA.test(record.baseHead)) throw new Error('Incomplete Engineer record');
    if (commonDir(record.worktree) !== commonDir(cwd) || fs.realpathSync(record.worktree) === current.worktree) throw new Error('Completion is not from an isolated worktree');
    const actual = completion(task, record.baseHead, record.worktree);
    if (actual.head !== record.head || JSON.stringify(actual.filesChanged) !== JSON.stringify(record.filesChanged)) throw new Error('Completion record does not match Git');
    const completed = completedRecords(plan, dir, cwd);
    for (const dependency of task.dependsOn || []) {
      const done = completed.get(dependency);
      if (!done) throw new Error(`Dependency ${dependency} is not integrated at its current revision`);
      git(cwd, ['merge-base', '--is-ancestor', done.integratedHead, record.baseHead]);
    }
    if (!operation) {
      git(cwd, ['merge-base', '--is-ancestor', record.baseHead, current.head]);
      operation = { taskId: task.id, revision, taskHash: record.taskHash, sourceHead: record.head, beforeHead: current.head, commits: git(cwd, ['rev-list', '--reverse', `${record.baseHead}..${record.head}`]).trim().split('\n').filter(Boolean), applied: [] };
      journal.push(operation); save();
    }
    // Rebuild applied evidence from current Git history, including after a crash
    // or reset. An applied[] entry alone never proves that a commit is present.
    git(cwd, ['merge-base', '--is-ancestor', operation.beforeHead, current.head]);
    const present = operation.commits.map((commit) => appliedCommits(cwd, operation.beforeHead, commit));
    let missing = false;
    for (const found of present) {
      if (!found.length) missing = true;
      else if (missing || found.length > 1) throw new Error('Non-prefix integration history requires reconciliation');
    }
    operation.applied = [];
    for (const commit of operation.commits) {
      const found = appliedCommits(cwd, operation.beforeHead, commit);
      if (found.length > 1) throw new Error('Duplicate integration markers require reconciliation');
      if (!found.length) git(cwd, ['cherry-pick', '-x', commit]);
      operation.applied.push({ source: commit, head: found[0] || snapshot(cwd).head }); save();
    }
    operation.integratedHead = snapshot(cwd).head; save();
  }
  return journal;
}
module.exports = { prepareWorktree, completion, integrate, readJournal, taskHash, taskRevisions, completedRecords, ownershipSpec };
