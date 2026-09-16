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
function prepareWorktree(cwd, baseHead, integrationRoot, isolation = 'worktree') {
  if (!SHA.test(baseHead)) throw new Error('Expected full base commit ID');
  const state = snapshot(cwd);
  if (isolation === 'branch') {
    // Branch mode commits land directly on the integration branch, so there is no
    // separate worktree to fast-forward; the base must already be HEAD.
    if (state.worktree !== fs.realpathSync(integrationRoot) || state.dirtyFiles.length || state.head !== baseHead) throw new Error('Branch-mode Engineer must start in the clean integration worktree at the approved wave base');
    return state;
  }
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
function completion(task, baseHead, cwd, isolation = 'worktree') {
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
  return { taskId: task.id, taskHash: taskHash(task), status: 'done', baseHead, head: state.head, worktree: state.worktree, filesChanged, filesTouched: [...touched].sort(), isolation };
}
function appliedCommits(cwd, beforeHead, source) {
  git(cwd, ['merge-base', '--is-ancestor', beforeHead, 'HEAD']);
  const commits = git(cwd, ['rev-list', '--reverse', `${beforeHead}..HEAD`]).trim().split('\n').filter(Boolean);
  return commits.filter((head) => git(cwd, ['show', '-s', '--format=%B', head]).split('\n').includes(`(cherry picked from commit ${source})`));
}
function integrate(plan, records, dir, cwd) {
  const revisions = taskRevisions(plan);
  if (!Array.isArray(records) || !records.length || new Set(records.map((record) => record.taskId)).size !== records.length) throw new Error('Expected unique completion records');
  if (records.length > 1 && records.some((record) => (record.isolation || 'worktree') === 'branch')) throw new Error('Branch mode integrates one completion at a time');
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
    const mode = record.isolation || 'worktree';
    const sameWorktree = fs.realpathSync(record.worktree) === current.worktree;
    // Worktree mode requires an isolated peer worktree; branch mode requires the completion
    // to already be sitting on the integration branch itself.
    if (mode === 'branch' ? !sameWorktree : (commonDir(record.worktree) !== commonDir(cwd) || sameWorktree)) throw new Error('Isolation mode mismatch');
    if (mode === 'branch') {
      // completion() below scans commits between baseHead and the current worktree head, so the
      // integration branch must not have moved past the record before that scan runs.
      if (current.head !== record.head) throw new Error('Integration branch HEAD does not match the branch-mode completion; reconcile before integrating');
      const actual = completion(task, record.baseHead, cwd, 'branch');
      if (actual.head !== record.head || JSON.stringify(actual.filesChanged) !== JSON.stringify(record.filesChanged)) throw new Error('Completion record does not match Git');
      const completed = completedRecords(plan, dir, cwd);
      for (const dependency of task.dependsOn || []) {
        const done = completed.get(dependency);
        if (!done) throw new Error(`Dependency ${dependency} is not integrated at its current revision`);
        git(cwd, ['merge-base', '--is-ancestor', done.integratedHead, record.baseHead]);
      }
      const commits = git(cwd, ['rev-list', '--reverse', `${record.baseHead}..${record.head}`]).trim().split('\n').filter(Boolean);
      operation = { taskId: task.id, revision, taskHash: record.taskHash, sourceHead: record.head, sourceWorktree: current.worktree, sourceBranch: branchOf(cwd), beforeHead: record.baseHead, commits, applied: commits.map((commit) => ({ source: commit, head: commit })), integratedHead: record.head, isolation: 'branch' };
      journal.push(operation); save();
      continue;
    }
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
      operation = { taskId: task.id, revision, taskHash: record.taskHash, sourceHead: record.head, sourceWorktree: fs.realpathSync(record.worktree), sourceBranch: branchOf(record.worktree), beforeHead: current.head, commits: git(cwd, ['rev-list', '--reverse', `${record.baseHead}..${record.head}`]).trim().split('\n').filter(Boolean), applied: [], isolation: 'worktree' };
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
// Report every worktree this session's Engineers used and release the proven ones.
// released: integrated, clean, and exactly at the integrated completion; removed together with
//   its ignored content (disposable by the repository's own ignore rules, listed for the record)
//   and, when proven agent-owned, its branch.
// kept: integrated but dirty, ahead of its completion, or otherwise unsafe; listed with evidence.
// unintegrated: attempts that never integrated (failed, blocked, superseded); listed, never removed.
// Only this session's own records are candidates because other sessions' Engineers may be
// running in the same repository. With apply=false nothing is removed.
function branchOf(worktree) {
  const ref = git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  return ref === 'HEAD' ? null : ref;
}
function statusPaths(worktree, args, accept = () => true) {
  return git(worktree, ['status', '--porcelain', '-z', '--no-renames', ...args]).split('\0').filter(Boolean).filter(accept).map((line) => line.slice(3)).sort();
}
function dirtyFiles(worktree) { return statusPaths(worktree, ['--untracked-files=all']); }
// Git only lists ignored entries alongside untracked scanning; keep just the '!!' rows.
function ignoredFiles(worktree) { return statusPaths(worktree, ['--ignored'], (line) => line.startsWith('!!')); }
function attemptRecords(dir) {
  const folder = path.join(dir, 'engineer-results');
  let names;
  try { names = fs.readdirSync(folder).filter((name) => name.endsWith('.json')); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const records = [];
  for (const name of names) {
    const file = path.join(folder, name);
    try { records.push({ at: fs.statSync(file).mtimeMs, record: JSON.parse(fs.readFileSync(file, 'utf8')) }); } catch (_) { /* A record removed or unreadable mid-scan is not evidence. */ }
  }
  return records.sort((a, b) => a.at - b.at).map((item) => item.record).filter((record) => record && typeof record.worktree === 'string');
}
// `protect` names branches that must never be deleted, such as the remote default branch the
// caller established from the remote itself. A local refs/remotes/origin/HEAD is not reliable.
function releaseWorktrees(dir, cwd, apply = true, protect = []) {
  const head = git(cwd, ['rev-parse', 'HEAD']).trim();
  const root = fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim());
  const protectedBranches = new Set(['main', 'master', branchOf(cwd), ...protect].filter(Boolean));
  const journal = readJournal(dir);
  const latest = new Map();
  // Branch-mode completions land on the integration branch itself, so their "worktree" is the
  // integration root; it is never a candidate for release, kept, or unintegrated reporting.
  for (const operation of journal) if (operation.sourceWorktree && operation.isolation !== 'branch') latest.set(operation.sourceWorktree, operation);
  const released = [];
  const kept = [];
  const unintegrated = [];
  for (const [worktree, operation] of latest) {
    const keep = (reason, extra = {}) => kept.push({ worktree, taskId: operation.taskId, reason, ...extra });
    try {
      if (!operation.integratedHead) { keep('completion is not integrated'); continue; }
      try { git(cwd, ['merge-base', '--is-ancestor', operation.integratedHead, head]); } catch (_) { keep('integrated commits are not in HEAD'); continue; }
      if (!fs.existsSync(worktree)) { if (apply) git(cwd, ['worktree', 'prune']); continue; }
      const real = fs.realpathSync(worktree);
      if (real === root || commonDir(real) !== commonDir(cwd)) { keep('not an isolated worktree of this repository'); continue; }
      const dirty = dirtyFiles(real);
      if (dirty.length) { keep('uncommitted changes', { dirtyFiles: dirty }); continue; }
      const current = git(real, ['rev-parse', 'HEAD']).trim();
      if (current !== operation.sourceHead) { keep('commits beyond the integrated completion', { commits: git(real, ['rev-list', '--reverse', `${operation.sourceHead}..${current}`]).trim().split('\n').filter(Boolean) }); continue; }
      const ignored = ignoredFiles(real);
      // Delete only the branch the Engineer completed on, still at its completion, never a protected one.
      let branch = operation.sourceBranch || null;
      if (branch) {
        let tip = null;
        try { tip = git(cwd, ['rev-parse', '-q', '--verify', `refs/heads/${branch}`]).trim(); } catch (_) { /* Already deleted or renamed: nothing to remove. */ }
        if (protectedBranches.has(branch) || tip !== operation.sourceHead) branch = null;
      }
      if (apply) {
        git(cwd, ['worktree', 'remove', real]);
        if (branch) { try { git(cwd, ['branch', '-D', branch]); } catch (_) { branch = null; } }
      }
      released.push({ worktree: real, branch, taskId: operation.taskId, sourceHead: operation.sourceHead, ignored });
    } catch (err) { keep(String(err.stderr || err.message).trim()); }
  }
  // An attempt is integrated when this task's journal integrated exactly that commit; attempts
  // that predate the journal's worktree field are covered the same way.
  const integrated = new Set(journal.filter((operation) => operation.integratedHead).map((operation) => `${operation.taskId}\0${operation.sourceHead}`));
  const seen = new Map();
  for (const record of attemptRecords(dir)) seen.set(record.worktree, record);
  for (const [worktree, record] of seen) {
    try {
      if (integrated.has(`${record.taskId}\0${record.head}`) || !fs.existsSync(worktree)) continue;
      const real = fs.realpathSync(worktree);
      if (real === root || latest.has(real) || latest.has(worktree)) continue;
      unintegrated.push({ worktree: real, taskId: record.taskId, attemptId: record.attemptId, status: record.status, head: git(real, ['rev-parse', 'HEAD']).trim(), dirtyFiles: dirtyFiles(real) });
    } catch (err) { unintegrated.push({ worktree, taskId: record.taskId, attemptId: record.attemptId, status: record.status, error: String(err.stderr || err.message).trim() }); }
  }
  return { released, kept, unintegrated };
}
module.exports = { prepareWorktree, completion, integrate, releaseWorktrees, readJournal, taskHash, taskRevisions, completedRecords, ownershipSpec, ownershipReport, dirtyOutsideOwnership };
