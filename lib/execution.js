'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { git, snapshot } = require('./git-state');
const { ownedPath, buildExecutionWaves, canRunInParallel } = require('./routing');
const { writeJsonAtomic } = require('./session');
const SHA = /^[a-f0-9]{40,64}$/;
function readJournal(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'integration.json'), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
}
function commonDir(cwd) { return fs.realpathSync(path.resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']).trim())); }
function prepareWorktree(cwd, baseHead, integrationRoot) {
  if (!SHA.test(baseHead)) throw new Error('Expected full base commit ID');
  const state = snapshot(cwd);
  if (state.worktree === fs.realpathSync(integrationRoot) || commonDir(cwd) !== commonDir(integrationRoot)) throw new Error('Engineer requires a separate worktree in this repository');
  if (state.dirtyFiles.length) throw new Error('Engineer worktree is not clean');
  git(cwd, ['merge', '--ff-only', baseHead]);
  if (snapshot(cwd).head !== baseHead) throw new Error('Engineer must start at the approved wave base');
  return snapshot(cwd);
}
function completion(task, baseHead, cwd) {
  const state = snapshot(cwd);
  if (!SHA.test(baseHead) || state.dirtyFiles.length) throw new Error('Completion requires a valid base and committed clean worktree');
  git(cwd, ['merge-base', '--is-ancestor', baseHead, state.head]);
  if (git(cwd, ['rev-list', '--merges', `${baseHead}..${state.head}`]).trim()) throw new Error('Engineer completion must not contain merge commits');
  const filesChanged = git(cwd, ['diff', '--no-renames', '--name-only', '-z', baseHead, state.head, '--']).split('\0').filter(Boolean).sort();
  const owns = (file) => task.files.some((entry) => {
    const owned = ownedPath(entry);
    return owned && (file === owned || file.startsWith(owned + '/'));
  });
  if (filesChanged.some((file) => !owns(file))) throw new Error('Engineer changed files outside declared task ownership; re-plan before integration');
  return { taskId: task.id, status: 'done', baseHead, head: state.head, worktree: state.worktree, filesChanged };
}
function integrate(plan, records, dir, cwd) {
  buildExecutionWaves(plan.tasks); // Reject invalid graphs even on direct calls.
  if (!records.length || new Set(records.map((record) => record.taskId)).size !== records.length) throw new Error('Expected unique completion records');
  for (let i = 0; i < records.length; i++) {
    for (const other of records.slice(i + 1)) {
      if (records[i].baseHead !== other.baseHead || !canRunInParallel(plan.tasks.find((task) => task.id === records[i].taskId), plan.tasks.find((task) => task.id === other.taskId), plan.tasks)) throw new Error('Completion records are not an eligible parallel wave');
    }
  }
  const journal = readJournal(dir);
  const save = () => writeJsonAtomic(path.join(dir, 'integration.json'), journal);
  for (const record of [...records].sort((a, b) => plan.tasks.findIndex((t) => t.id === a.taskId) - plan.tasks.findIndex((t) => t.id === b.taskId))) {
    const task = plan.tasks.find((item) => item.id === record.taskId);
    if (!task) throw new Error('Unknown completed task');
    let operation = journal.find((item) => item.taskId === task.id && item.sourceHead === record.head);
    const current = snapshot(cwd);
    if (current.dirtyFiles.length) throw new Error('Integration requires a clean worktree');
    // A completed operation stays complete even when a later task has integrated.
    if (operation?.integratedHead) {
      git(cwd, ['merge-base', '--is-ancestor', operation.integratedHead, current.head]);
      continue;
    }
    if (record.status !== 'done' || !SHA.test(record.head) || !SHA.test(record.baseHead)) throw new Error('Incomplete Engineer record');
    if (commonDir(record.worktree) !== commonDir(cwd) || fs.realpathSync(record.worktree) === current.worktree) throw new Error('Completion is not from an isolated worktree');
    const actual = completion(task, record.baseHead, record.worktree);
    if (actual.head !== record.head || JSON.stringify(actual.filesChanged) !== JSON.stringify(record.filesChanged)) throw new Error('Completion record does not match Git');
    for (const dependency of task.dependsOn || []) {
      const done = journal.find((item) => item.taskId === dependency && item.integratedHead);
      if (!done) throw new Error(`Dependency ${dependency} is not integrated`);
      git(cwd, ['merge-base', '--is-ancestor', done.integratedHead, record.baseHead]);
    }
    if (!operation) {
      git(cwd, ['merge-base', '--is-ancestor', record.baseHead, current.head]);
      operation = { taskId: task.id, sourceHead: record.head, beforeHead: current.head, commits: git(cwd, ['rev-list', '--reverse', `${record.baseHead}..${record.head}`]).trim().split('\n').filter(Boolean), applied: [] };
      journal.push(operation); save();
    }
    for (const commit of operation.commits) {
      if (operation.applied.includes(commit)) continue;
      // -x leaves a durable source ID if the process dies before journal persistence.
      const log = git(cwd, ['log', '--format=%B', `${operation.beforeHead}..HEAD`]);
      if (!log.includes(`(cherry picked from commit ${commit})`)) git(cwd, ['cherry-pick', '-x', commit]);
      operation.applied.push(commit); save();
    }
    operation.integratedHead = snapshot(cwd).head; save();
  }
  return journal;
}
module.exports = { prepareWorktree, completion, integrate, readJournal };
