'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git, snapshot } = require('../lib/git-state');
const session = require('../lib/session');
const { run } = require('../lib/cli');
const { completion, integrate, prepareWorktree, releaseWorktrees, completedRecords, taskHash, dirtyOutsideOwnership } = require('../lib/execution');
const { recordInspector, requireInspector, recordAuditor, requireVerified } = require('../lib/verification');
const { recoveryDecision } = require('../lib/recovery');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-mvp-'));
  const repo = path.join(root, 'repo');
  const data = path.join(root, 'data');
  fs.mkdirSync(repo); fs.mkdirSync(data);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Fixture']);
  git(repo, ['config', 'user.email', 'fixture@example.com']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'base a\n');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'base b\n');
  git(repo, ['add', '.']); git(repo, ['commit', '-qm', 'initial']);
  const previous = process.env.GORKHALI_DATA;
  process.env.GORKHALI_DATA = data;
  t.after(() => { if (previous === undefined) delete process.env.GORKHALI_DATA; else process.env.GORKHALI_DATA = previous; fs.rmSync(root, { recursive: true, force: true }); });
  const worktree = (name, base = 'HEAD') => {
    const dir = path.join(root, name);
    git(repo, ['worktree', 'add', '-q', '-b', name, dir, base]);
    return dir;
  };
  return { repo, data, root, worktree };
}
// Existing lifecycle fixtures explicitly choose not to track a ticket.
function openUntracked(input, cwd) {
  const dir = run('open', input, cwd);
  run('tracking-configure', { task: input.task, decision: 'none', confirmed: true, reason: 'Fixture has no ticket' }, cwd);
  return dir;
}
function plan(tasks = [{ id: 'a', files: ['a.txt'] }]) {
  return {
    briefing: { tackling: 'test', problem: 'test', how: 'test' },
    decision: { question: 'test', recommendation: 'test', rationale: ['test'], status: 'approved' },
    outcome: { goal: 'test', doneWhen: ['test'] }, scope: { in: ['test'], out: [] },
    tasks: tasks.map((item) => ({ description: 'test', action: 'test', acceptance_criteria: ['test'], verify: 'test', ...item })),
  };
}
function change(dir, file, content) {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, ['add', file]); git(dir, ['commit', '-qm', `change ${file}`]);
}
function evidence(dir, repo, userVisible = false) {
  if (!fs.existsSync(path.join(dir, 'plan.json'))) fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan()));
  const inspector = recordInspector(dir, { role: 'inspector', verdict: 'pass', worktree_unchanged: true, fingerprint: snapshot(repo).fingerprint,
    checks: ['test', 'lint', 'build', 'typecheck'].map((name) => ({ name, command: null, provenance: null, result: 'absent' })) }, repo);
  recordAuditor(dir, { verdict: 'pass', inspectorId: inspector.id, fingerprint: inspector.fingerprint, findings: [], userVisible, independence: { basis: 'independent-context' } }, repo);
  return inspector;
}

test('fingerprint catches edits to already-dirty files, staging, deletion, untracked content and commits', (t) => {
  const { repo } = fixture(t);
  const states = [snapshot(repo).fingerprint];
  fs.writeFileSync(path.join(repo, 'a.txt'), 'first'); states.push(snapshot(repo).fingerprint);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'second'); states.push(snapshot(repo).fingerprint);
  git(repo, ['add', 'a.txt']); states.push(snapshot(repo).fingerprint);
  fs.writeFileSync(path.join(repo, 'extra'), 'first'); states.push(snapshot(repo).fingerprint);
  fs.writeFileSync(path.join(repo, 'extra'), 'second'); states.push(snapshot(repo).fingerprint);
  fs.unlinkSync(path.join(repo, 'b.txt')); states.push(snapshot(repo).fingerprint);
  git(repo, ['commit', '-qm', 'staged']); states.push(snapshot(repo).fingerprint);
  assert.equal(new Set(states).size, states.length);
});

test('resume without pause preserves approved work and invalidates changed content', (t) => {
  const { repo } = fixture(t);
  session.openSession('repo', 'task', repo);
  session.writePlan('repo', 'task', plan(), repo);
  session.appendProgress('repo', 'task', { phase: 'approved', next: 'dispatch', verification: 'passed' }, repo);
  assert.equal(session.resume('repo', 'task', repo).changed, false);
  assert.equal(session.resume('repo', 'task', repo).checkpoint.next, 'dispatch');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed');
  const resumed = session.resume('repo', 'task', repo);
  assert.equal(resumed.changed, true);
  assert.equal(resumed.checkpoint.verification, 'stale');
  assert.equal(resumed.checkpoint.next, 'reconcile');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed again');
  assert.equal(session.resume('repo', 'task', repo).changed, true);
});

test('legacy session checkpoint reconstruction never manufactures verified evidence', (t) => {
  const { repo } = fixture(t);
  const dir = session.openSession('repo', 'task', repo);
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan()));
  fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify([{ phase: 'verified', verification: 'passed' }]));
  const result = session.resume('repo', 'task', repo);
  assert.equal(result.checkpoint.verification, 'stale');
  assert.equal(result.checkpoint.next, 'reconcile');
});

test('independent Engineers integrate in order and retry without duplicating commits', (t) => {
  const { repo, data, worktree } = fixture(t);
  const base = snapshot(repo).head;
  const a = worktree('engineer-a'); const b = worktree('engineer-b');
  prepareWorktree(a, base, repo); prepareWorktree(b, base, repo);
  const p = plan([{ id: 'a', files: ['a.txt'], parallelSafe: true }, { id: 'b', files: ['b.txt'], parallelSafe: true }]);
  change(a, 'a.txt', 'from a'); change(b, 'b.txt', 'from b');
  const records = [completion(p.tasks[1], base, b), completion(p.tasks[0], base, a)];
  const journal = integrate(p, records, data, repo);
  assert.deepEqual(journal.map((item) => item.taskId), ['a', 'b']);
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'from a');
  assert.equal(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'from b');
  const head = snapshot(repo).head;
  integrate(p, records, data, repo);
  assert.equal(snapshot(repo).head, head);
  // Simulate a crash after cherry-pick succeeds but before the final journal write.
  delete journal[1].integratedHead; journal[1].applied = [];
  fs.writeFileSync(path.join(data, 'integration.json'), JSON.stringify(journal));
  integrate(p, records, data, repo);
  assert.equal(snapshot(repo).head, head);
});

test('ownership violations and unmet dependency ancestry block integration', (t) => {
  const { repo, data, worktree } = fixture(t);
  const base = snapshot(repo).head;
  const a = worktree('engineer-a'); change(a, 'b.txt', 'wrong owner');
  assert.throws(() => completion({ id: 'a', files: ['a.txt'] }, base, a), /ownership/);
  const p = plan([{ id: 'a', files: ['a.txt'] }, { id: 'b', files: ['b.txt'], dependsOn: ['a'] }]);
  const record = completion(p.tasks[1], base, a);
  assert.throws(() => integrate(p, [record], data, repo), /not integrated/);
  assert.equal(snapshot(repo).head, base);
});

test('integration preserves conflicts instead of resetting away work', (t) => {
  const { repo, data, worktree } = fixture(t);
  const base = snapshot(repo).head;
  const a = worktree('engineer-a'); change(a, 'a.txt', 'agent\n');
  change(repo, 'a.txt', 'user\n');
  const p = plan(); const record = completion(p.tasks[0], base, a);
  assert.throws(() => integrate(p, [record], data, repo));
  assert.ok(git(repo, ['rev-parse', '--verify', 'CHERRY_PICK_HEAD']).trim());
  assert.match(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), /user/);
});

test('Auditor and ship reject stale Inspector evidence and require current human confirmation', (t) => {
  const { repo, data } = fixture(t);
  assert.throws(() => requireInspector(data, repo), /missing/);
  const inspector = evidence(data, repo, true);
  assert.throws(() => requireVerified(data, repo), /human/);
  session.writeJsonAtomic(path.join(data, 'human-confirmation.json'), { confirmed: true, fingerprint: inspector.fingerprint });
  assert.equal(requireVerified(data, repo).inspector.id, inspector.id);
  fs.writeFileSync(path.join(repo, 'new.txt'), 'new');
  assert.throws(() => requireVerified(data, repo), /stale/);
});

test('a newly discovered check cannot inherit an absent or incomplete result', (t) => {
  const { repo, data } = fixture(t);
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  assert.throws(() => evidence(data, repo), /complete evidence/);
  assert.throws(() => recordInspector(data, { role: 'inspector', verdict: 'pass', fingerprint: snapshot(repo).fingerprint, worktree_unchanged: true, checks: [] }, repo), /complete evidence/);
});

test('bounded recovery diagnoses repeated failures and stops after two Engineer repairs', () => {
  assert.equal(recoveryDecision().next, 'engineer');
  assert.equal(recoveryDecision({ attempts: 1, repeated: true }).next, 'detective');
  assert.equal(recoveryDecision({ attempts: 1, repeated: true, diagnosed: true }).next, 'engineer');
  assert.equal(recoveryDecision({ attempts: 2, repeated: true }).next, 'human');
  assert.equal(recoveryDecision({ infrastructure: true }).next, 'human');
});

test('CLI refuses unapproved or overlapping dispatch and unstable pause', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo); run('plan', { plan: plan() }, repo);
  assert.throws(() => run('dispatch', {}, repo), /approval/);
  run('approve', { confirmed: true }, repo);
  assert.deepEqual(run('dispatch', {}, repo).wave, ['a']);
  assert.throws(() => run('dispatch', {}, repo), /running wave/);
  assert.throws(() => run('pause', {}, repo), /running Engineers/);
  run('progress', { entry: { activeEngineers: [] } }, repo);
  assert.equal(run('pause', {}, repo).phase, 'paused');
});

test('session identifiers cannot escape the data root', (t) => {
  const { repo } = fixture(t);
  assert.throws(() => session.openSession('repo', '../escape', repo), /Invalid task/);
  assert.throws(() => session.openSession('../escape', 'task', repo), /Invalid repository/);
  assert.throws(() => session.scratchPath('repo', 'task', '../escape', repo), /escapes/);
});

test('a new Inspector run invalidates prior Auditor approval even on unchanged content', (t) => {
  const { repo, data } = fixture(t);
  const first = evidence(data, repo);
  const next = recordInspector(data, first, repo);
  assert.notEqual(first.id, next.id);
  assert.throws(() => requireVerified(data, repo), /Auditor/);
});

test('CLI recovery persists its budget across resume and cannot replay one failure', (t) => {
  const { repo } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo);
  run('plan', { plan: plan() }, repo); run('approve', { confirmed: true }, repo);
  const failed = () => recordInspector(dir, { verdict: 'fail', fingerprint: snapshot(repo).fingerprint, checks: [] }, repo);
  const one = failed();
  assert.equal(run('recover', { failureId: one.id, failureClass: 'assertion', repairTaskId: 'a' }, repo).next, 'engineer');
  assert.throws(() => run('recover', { failureId: one.id, failureClass: 'assertion', repairTaskId: 'a' }, repo), /already dispatched/);
  run('progress', { entry: { activeEngineers: [] } }, repo);
  run('resume', {}, repo);
  const two = failed();
  assert.equal(run('recover', { failureId: two.id, failureClass: 'assertion', repairTaskId: 'a' }, repo).next, 'detective');
  assert.equal(run('recover', { failureId: two.id, failureClass: 'assertion', repairTaskId: 'a', diagnosed: true }, repo).next, 'engineer');
  run('progress', { entry: { activeEngineers: [] } }, repo);
  const three = failed();
  assert.equal(run('recover', { failureId: three.id, failureClass: 'assertion', repairTaskId: 'a' }, repo).next, 'human');
  assert.throws(() => run('progress', { entry: { repairAttempts: 0 } }, repo), /cannot decrease/);
});

test('changing approved plan content requires a new approval', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo); run('plan', { plan: plan() }, repo); run('approve', { confirmed: true }, repo);
  const updated = plan([{ id: 'b', files: ['b.txt'] }]);
  run('plan', { plan: updated }, repo);
  assert.throws(() => run('dispatch', {}, repo), /approval/);
});

test('changed plan intent invalidates evidence even without a Git change', (t) => {
  const { repo, data } = fixture(t);
  fs.writeFileSync(path.join(data, 'plan.json'), JSON.stringify(plan()));
  evidence(data, repo);
  requireVerified(data, repo);
  fs.writeFileSync(path.join(data, 'plan.json'), JSON.stringify(plan([{ id: 'b', files: ['b.txt'] }])));
  assert.throws(() => requireVerified(data, repo), /stale/);
});

test('CLI ships integrated verified work and recovers an existing PR without another create', (t) => {
  const { repo, root, worktree } = fixture(t);
  const remote = path.join(root, 'remote.git');
  git(repo, ['init', '--bare', '-q', remote]);
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', 'origin', 'HEAD:refs/heads/trunk']);
  git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);
  const dir = openUntracked({ task: 'task' }, repo);
  const tracking = require('../lib/tracking');
  run('tracking-configure', { reference: 'https://example.atlassian.net/browse/TEST-1' }, repo);
  const receipt = (name) => {
    const tracked = tracking.read(dir);
    run('tracking-observe', { observation: { attemptId: tracked.pending.id, ticketUrl: tracked.ticket.url,
      source: 'fixture Jira read', observedAt: new Date().toISOString(), title: 'Test',
      status: { id: name, name }, assignees: ['owner'], links: tracked.pending.pr ? [{ url: tracked.pending.pr, marker: tracked.pending.marker }] : [] } }, repo);
  };
  run('tracking-begin', { stage: 'intake' }, repo); receipt('To Do');
  run('branch', { name: 'feature/mvp' }, repo);
  const p = plan(); p.isolation = 'worktree'; run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  run('tracking-begin', { stage: 'start' }, repo); receipt('In Progress');
  evidence(dir, repo);
  assert.throws(() => run('ship', { authorized: true, title: 'test', body: 'test' }, repo), /completion evidence/);
  const dispatched = run('dispatch', {}, repo);
  const a = worktree('engineer-ship'); change(a, 'a.txt', 'ship me');
  run('integrate', { records: [completion(p.tasks[0], dispatched.baseHead, a)] }, repo);
  evidence(dir, repo); run('verify', {}, repo);
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  const stateFile = path.join(root, 'created');
  const logFile = path.join(root, 'calls');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${logFile}'\nif [ "$2" = list ]; then\n  if [ -e '${stateFile}' ]; then printf '[{"url":"https://github.com/example/repo/pull/1"}]'; else printf '[]'; fi\nelse\n  touch '${stateFile}'\n  printf 'https://github.com/example/repo/pull/1\\n'\nfi\n`, { mode: 0o755 });
  const previousPath = process.env.PATH; process.env.PATH = bin + path.delimiter + previousPath;
  t.after(() => { process.env.PATH = previousPath; });
  assert.deepEqual(run('status', {}, repo).worktrees.released.map((item) => item.branch), ['engineer-ship'], 'status previews releasable Engineer worktrees');
  assert.ok(fs.existsSync(a), 'status never removes a worktree');
  // A broken results store degrades the report; it never fails status or ship.
  fs.writeFileSync(path.join(dir, 'engineer-results'), 'not a directory');
  assert.match(run('status', {}, repo).worktrees.error, /ENOTDIR/);
  fs.rmSync(path.join(dir, 'engineer-results'));
  const engineerPath = fs.realpathSync(a); const engineerHead = snapshot(a).head;
  // The remote default is `trunk` and no local refs/remotes/origin/HEAD exists. A hook that put
  // the Engineer on a branch of that name must not cost the default branch at ship time.
  const journal = JSON.parse(fs.readFileSync(path.join(dir, 'integration.json'), 'utf8'));
  journal[0].sourceBranch = 'trunk';
  fs.writeFileSync(path.join(dir, 'integration.json'), JSON.stringify(journal));
  git(a, ['checkout', '-q', '-b', 'trunk']);
  assert.throws(() => git(repo, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']), 'fixture has no local default-branch ref');
  const shipped = run('ship', { authorized: true, title: 'test', body: 'test' }, repo);
  assert.equal(shipped.url, 'https://github.com/example/repo/pull/1');
  assert.deepEqual(shipped.worktrees, { released: [{ worktree: engineerPath, branch: null, taskId: 'a', sourceHead: engineerHead, ignored: [] }], kept: [], unintegrated: [] });
  assert.ok(!fs.existsSync(a), 'ship removes the integrated Engineer worktree');
  assert.equal(git(repo, ['rev-parse', 'refs/heads/trunk']).trim(), engineerHead, 'ship never deletes the remote default branch');
  assert.equal(tracking.read(dir).pending.stage, 'review');
  assert.throws(() => run('review-state', { pr: 1 }, repo), /review update/);
  // Simulate interruption after the external PR exists but before checkpointing it.
  run('progress', { entry: { pr: null, phase: 'verified' } }, repo);
  const recovered = run('ship', { authorized: true }, repo);
  assert.equal(recovered.url, 'https://github.com/example/repo/pull/1');
  assert.deepEqual(recovered.worktrees, { released: [], kept: [], unintegrated: [] }, 'a recovered ship has nothing left to release');
  assert.equal(fs.readFileSync(logFile, 'utf8').split('\n').filter((line) => line.startsWith('pr create ')).length, 1);
  assert.equal(git(repo, ['ls-remote', 'origin', 'refs/heads/feature/mvp']).split('\t')[0], snapshot(repo).head);
  receipt('In Review');
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf \'{"state":"OPEN","url":"https://github.com/example/repo/pull/1"}\'\n', { mode: 0o755 });
  assert.throws(() => run('close', { pr: 1 }, repo), /not merged/);
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf \'{"state":"MERGED","url":"https://github.com/example/repo/pull/1","mergeCommit":{"oid":"fixture"}}\'\n', { mode: 0o755 });
  assert.equal(run('close', { pr: 1 }, repo).needsTracking, true);
  assert.equal(tracking.read(dir).pending.stage, 'done');
  run('tracking-failure', { reason: 'Tracker unavailable' }, repo);
  assert.ok(session.activeSession(repo), 'merge alone does not orphan a failed ticket update');
  assert.equal(run('resume', {}, repo).tracking.error, 'Tracker unavailable');
  receipt('Done');
  assert.equal(run('close', { pr: 1 }, repo).state, 'MERGED');
  assert.equal(session.activeSession(repo), null);
});

test('ship-time cleanup releases only clean Engineer worktrees whose commits are integrated', (t) => {
  const { repo, data, worktree } = fixture(t);
  change(repo, '.gitignore', 'local.db\n');
  const base = snapshot(repo).head;
  const a = worktree('engineer-a'); const b = worktree('engineer-b'); const c = worktree('engineer-c'); const d = worktree('engineer-d'); const other = worktree('another-session');
  const p = plan([{ id: 'a', files: ['a.txt'], parallelSafe: true }, { id: 'b', files: ['b.txt'], parallelSafe: true }, { id: 'c', files: ['c.txt'], parallelSafe: true }]);
  change(a, 'a.txt', 'from a'); change(b, 'b.txt', 'from b'); change(c, 'c.txt', 'from c');
  const aHead = snapshot(a).head;
  integrate(p, [completion(p.tasks[0], base, a), completion(p.tasks[1], base, b), completion(p.tasks[2], base, c)], data, repo);
  change(b, 'b.txt', 'follow-up that nobody integrated');
  fs.writeFileSync(path.join(c, 'c.txt'), 'uncommitted edit');
  // Ignored content is disposable by the repository's own rules; a branch switched after
  // completion is not proven agent-owned and must survive.
  fs.writeFileSync(path.join(a, 'local.db'), 'scratch');
  git(a, ['checkout', '-q', '-b', 'keep-me']);
  // Blocked attempts never reach the journal; only their persisted results know the worktree.
  fs.writeFileSync(path.join(d, 'd.txt'), 'half-finished work');
  const e = worktree('engineer-e', aHead);
  fs.mkdirSync(path.join(data, 'engineer-results'));
  fs.writeFileSync(path.join(data, 'engineer-results', 'blocked-d.json'), JSON.stringify({ taskId: 'd', attemptId: 'blocked-d', status: 'blocked', worktree: d }));
  fs.writeFileSync(path.join(data, 'engineer-results', 'blocked-e.json'), JSON.stringify({ taskId: 'e', attemptId: 'blocked-e', status: 'blocked', worktree: e, head: aHead }));
  const preview = releaseWorktrees(data, repo, false);
  assert.deepEqual(preview.released.map((item) => [item.branch, item.ignored]), [['engineer-a', ['local.db']]]);
  assert.deepEqual(preview.kept.map((item) => [item.taskId, item.reason]), [['b', 'commits beyond the integrated completion'], ['c', 'uncommitted changes']]);
  assert.equal(preview.kept[0].commits.length, 1, 'kept entries name the commits beyond the integrated completion');
  assert.deepEqual(preview.kept[1].dirtyFiles, ['c.txt'], 'kept entries name the dirty files');
  assert.deepEqual(preview.unintegrated.map((item) => [item.taskId, item.status, item.dirtyFiles]), [['d', 'blocked', ['d.txt']], ['e', 'blocked', []]],
    'an attempt sharing another task\'s integrated commit is still unintegrated for its own task');
  assert.ok(fs.existsSync(a), 'preview removes nothing');
  const result = releaseWorktrees(data, repo);
  assert.deepEqual(result.released.map((item) => item.branch), ['engineer-a']);
  assert.ok(!fs.existsSync(a));
  assert.throws(() => git(repo, ['rev-parse', '--verify', '-q', 'refs/heads/engineer-a']), 'the agent branch at its completion is deleted');
  assert.equal(git(repo, ['rev-parse', 'refs/heads/keep-me']).trim(), aHead, 'a branch that is not proven agent-owned survives');
  assert.ok(fs.existsSync(b) && fs.existsSync(c) && fs.existsSync(d) && fs.existsSync(e) && fs.existsSync(other), 'unintegrated work and other sessions\' worktrees survive');
  assert.match(git(repo, ['worktree', 'list']), /another-session/);
  assert.deepEqual(releaseWorktrees(data, repo).released, [], 'release is idempotent');
  // A worktree deleted by hand leaves only its Git registration behind; release prunes it.
  fs.rmSync(b, { recursive: true, force: true });
  assert.match(git(repo, ['worktree', 'list']), /engineer-b/);
  releaseWorktrees(data, repo);
  assert.doesNotMatch(git(repo, ['worktree', 'list']), /engineer-b/);
});

test('release never deletes a protected branch and integrate records the Engineer branch', (t) => {
  const { repo, data, worktree } = fixture(t);
  const base = snapshot(repo).head;
  const a = worktree('engineer-a');
  const p = plan();
  change(a, 'a.txt', 'from a');
  const journal = integrate(p, [completion(p.tasks[0], base, a)], data, repo);
  assert.equal(journal[0].sourceBranch, 'engineer-a');
  // Simulate a hook that put the Engineer on a branch named like a default branch.
  const protectedName = snapshot(repo).branch === 'main' ? 'master' : 'main';
  journal[0].sourceBranch = protectedName;
  git(a, ['checkout', '-q', '-b', protectedName]);
  fs.writeFileSync(path.join(data, 'integration.json'), JSON.stringify(journal));
  const result = releaseWorktrees(data, repo);
  assert.deepEqual(result.released.map((item) => item.branch), [null]);
  assert.ok(!fs.existsSync(a));
  assert.equal(git(repo, ['rev-parse', `refs/heads/${protectedName}`]).trim(), journal[0].sourceHead, 'the protected branch survives release');
});

test('release treats an already deleted Engineer branch as gone and still frees the worktree', (t) => {
  const { repo, data, worktree } = fixture(t);
  const base = snapshot(repo).head;
  const a = worktree('engineer-a');
  const p = plan(); change(a, 'a.txt', 'from a');
  integrate(p, [completion(p.tasks[0], base, a)], data, repo);
  git(a, ['checkout', '-q', '--detach']);
  git(repo, ['branch', '-D', 'engineer-a']);
  const result = releaseWorktrees(data, repo);
  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.released.map((item) => item.branch), [null]);
  assert.ok(!fs.existsSync(a));
});

test('interrupted integration reconstructs applied commits after Git resets them away', (t) => {
  const { repo, data, worktree } = fixture(t);
  const p = plan(); const base = snapshot(repo).head; const a = worktree('reset-recovery');
  change(a, 'a.txt', 'implemented'); const record = completion(p.tasks[0], base, a);
  const journal = integrate(p, [record], data, repo);
  delete journal[0].integratedHead;
  fs.writeFileSync(path.join(data, 'integration.json'), JSON.stringify(journal));
  git(repo, ['reset', '--hard', base]);
  integrate(p, [record], data, repo);
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'implemented');
  assert.notEqual(snapshot(repo).head, base);
});

test('task revisions and dependent revisions invalidate completed journal entries', (t) => {
  const { repo, worktree } = fixture(t);
  openUntracked({ task: 'task' }, repo); const p = plan(); p.isolation = 'worktree';
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const wave = run('dispatch', {}, repo); const a = worktree('revision-a'); change(a, 'a.txt', 'first');
  run('integrate', { records: [completion(p.tasks[0], wave.baseHead, a)] }, repo);
  const revised = plan([{ id: 'a', files: ['a.txt', 'b.txt'], action: 'also change b' }]);
  run('plan', { plan: revised }, repo); run('approve', { confirmed: true }, repo);
  assert.deepEqual(run('dispatch', {}, repo).wave, ['a']);
  const { taskRevisions } = require('../lib/execution');
  const withDependency = plan([{ id: 'a', files: ['a.txt'] }, { id: 'b', files: ['b.txt'], dependsOn: ['a'] }]);
  const before = taskRevisions(withDependency).get('b');
  withDependency.tasks[0].action = 'new requirement';
  assert.notEqual(taskRevisions(withDependency).get('b'), before);
});

test('ownership validation rejects forbidden intermediate commits even when reverted', (t) => {
  const { repo, worktree } = fixture(t); const base = snapshot(repo).head;
  const a = worktree('intermediate-owner'); change(a, 'b.txt', 'forbidden'); change(a, 'b.txt', 'base b\n'); change(a, 'a.txt', 'allowed');
  assert.throws(() => completion(plan().tasks[0], base, a), /ownership in commit history/);
});

test('legacy glob ownership runs serially and accepts matching added, edited and deleted files', (t) => {
  const { repo, worktree, data } = fixture(t); const base = snapshot(repo).head;
  const p = plan([{ id: 'glob', files: ['*.txt'] }]); const a = worktree('legacy-glob');
  change(a, 'a.txt', 'changed'); change(a, 'new.txt', 'added');
  git(a, ['rm', 'b.txt']); git(a, ['commit', '-qm', 'delete matching file']);
  const record = completion(p.tasks[0], base, a);
  integrate(p, [record], data, repo);
  assert.deepEqual(record.filesChanged, ['a.txt', 'b.txt', 'new.txt']);
  assert.equal(fs.existsSync(path.join(repo, 'b.txt')), false);
});

test('partial wave integration keeps its remaining Engineer active', (t) => {
  const { repo, worktree } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'], parallelSafe: true }, { id: 'b', files: ['b.txt'], parallelSafe: true }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const wave = run('dispatch', {}, repo); const a = worktree('partial-a'); change(a, 'a.txt', 'first');
  run('integrate', { records: [completion(p.tasks[0], wave.baseHead, a)] }, repo);
  assert.deepEqual(run('status', {}, repo).checkpoint.activeEngineers, ['b']);
  assert.throws(() => run('pause', {}, repo), /running Engineers/);
  assert.throws(() => run('dispatch', {}, repo), /running wave/);
});

test('explicit resume reactivates the requested session and enforces divergence reconciliation', (t) => {
  const { repo } = fixture(t);
  for (const task of ['first', 'second']) { openUntracked({ task }, repo); run('plan', { plan: plan() }, repo); run('approve', { confirmed: true }, repo); }
  run('resume', { task: 'first' }, repo);
  assert.equal(session.activeSession(repo).task, 'first');
  change(repo, 'a.txt', 'outside change');
  run('resume', {}, repo);
  assert.throws(() => run('dispatch', {}, repo), /reconciliation/);
  run('reconcile', { scope: 'changed', reason: 'Approved requirement changed with the external commit' }, repo);
  assert.throws(() => run('dispatch', {}, repo), /approval/);
  run('approve', { confirmed: true }, repo);
  assert.deepEqual(run('dispatch', {}, repo).wave, ['a']);
});

test('final verification cannot pass before approved tasks integrate', (t) => {
  const { repo } = fixture(t); const dir = openUntracked({ task: 'task' }, repo);
  run('plan', { plan: plan() }, repo); evidence(dir, repo);
  assert.throws(() => run('verify', {}, repo), /approval/);
  run('approve', { confirmed: true }, repo); run('dispatch', {}, repo);
  assert.throws(() => run('verify', {}, repo), /completion evidence/);
});

test('failed Engineer results increment once and escalate the second implementation failure', (t) => {
  const { repo } = fixture(t); openUntracked({ task: 'task' }, repo); run('plan', { plan: plan() }, repo); run('approve', { confirmed: true }, repo);
  const first = run('dispatch', {}, repo).assignments[0];
  const record = { taskId: 'a', attemptId: first.attemptId, status: 'failed', summary: 'implementation failed' };
  const failure = run('result', { record }, repo);
  assert.equal(run('result', { record }, repo).alreadyRecorded, true);
  assert.equal(run('status', {}, repo).checkpoint.implementationFailures, 1);
  const repair = run('recover', { failureId: failure.id, failureClass: 'implementation', repairTaskId: 'a' }, repo);
  assert.equal(repair.assignment.isolation, 'worktree');
  run('result', { record: { ...record, attemptId: repair.assignment.attemptId } }, repo);
  assert.equal(run('route', {}, repo).tasks[0].tier, 'deep');
  assert.equal(run('status', {}, repo).checkpoint.implementationFailures, 2);
});

test('parallel peer integration preserves failed attempt recovery and blocks ordinary redispatch', (t) => {
  const { repo, worktree } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'], parallelSafe: true }, { id: 'b', files: ['b.txt'], parallelSafe: true }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const wave = run('dispatch', {}, repo);
  const failed = wave.assignments.find((item) => item.id === 'b');
  const failure = run('result', { record: { taskId: 'b', attemptId: failed.attemptId, status: 'failed', summary: 'implementation failed' } }, repo);
  const a = worktree('good-peer'); change(a, 'a.txt', 'implemented');
  run('integrate', { records: [completion(p.tasks[0], wave.baseHead, a)] }, repo);
  assert.throws(() => run('dispatch', {}, repo), /bounded recovery/);
  assert.equal(run('recover', { failureId: failure.id, failureClass: 'implementation', repairTaskId: 'b' }, repo).next, 'engineer');
});

test('blocked Engineer cannot become a code repair by omitting infrastructure flag', (t) => {
  const { repo } = fixture(t); openUntracked({ task: 'task' }, repo);
  run('plan', { plan: plan() }, repo); run('approve', { confirmed: true }, repo);
  const assignment = run('dispatch', {}, repo).assignments[0];
  const failure = run('result', { record: { taskId: 'a', attemptId: assignment.attemptId, status: 'blocked', summary: 'missing tool' } }, repo);
  assert.equal(run('recover', { failureId: failure.id, failureClass: 'tool', repairTaskId: 'a' }, repo).next, 'human');
  assert.throws(() => run('dispatch', {}, repo), /bounded recovery/);
});

test('explicit human resolution unlocks revised and restored tasks without resetting counters', (t) => {
  const { repo } = fixture(t); openUntracked({ task: 'task' }, repo);
  run('plan', { plan: plan() }, repo); run('approve', { confirmed: true }, repo);
  const assignment = run('dispatch', {}, repo).assignments[0];
  const failure = run('result', { record: { taskId: 'a', attemptId: assignment.attemptId, status: 'needs-context', summary: 'clarify requirement' } }, repo);
  run('progress', { entry: { repairAttempts: 2, implementationFailures: 2 } }, repo);
  run('plan', { plan: plan([{ id: 'a', files: ['a.txt'], action: 'clarified behavior' }]) }, repo);
  run('approve', { confirmed: true }, repo);
  assert.throws(() => run('dispatch', {}, repo), /bounded recovery/);
  assert.throws(() => run('resolve-failures', { failureIds: [failure.id], reason: 'clarified' }, repo), /Explicit human/);
  run('resolve-failures', { confirmed: true, failureIds: [failure.id], reason: 'User clarified revised requirement and authorized continuation' }, repo);
  assert.equal(run('dispatch', {}, repo).wave[0], 'a');
  assert.equal(run('status', {}, repo).checkpoint.repairAttempts, 2);
  assert.equal(run('status', {}, repo).checkpoint.implementationFailures, 2);
});

test('human can release a restored environment without revising the task', (t) => {
  const { repo } = fixture(t); openUntracked({ task: 'task' }, repo);
  run('plan', { plan: plan() }, repo); run('approve', { confirmed: true }, repo);
  const assignment = run('dispatch', {}, repo).assignments[0];
  const failure = run('result', { record: { taskId: 'a', attemptId: assignment.attemptId, status: 'blocked', summary: 'tool unavailable' } }, repo);
  assert.equal(run('recover', { failureId: failure.id, failureClass: 'tool', repairTaskId: 'a' }, repo).next, 'human');
  run('resolve-failures', { confirmed: true, failureIds: [failure.id], reason: 'User restored tool and asked to continue' }, repo);
  assert.equal(run('dispatch', {}, repo).wave[0], 'a');
});

test('active and saved session identity survives origin changes without leaking to another clone', (t) => {
  const { repo, root, worktree } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo); run('plan', { plan: plan() }, repo); run('approve', { confirmed: true }, repo);
  git(repo, ['remote', 'add', 'origin', 'https://example.invalid/one/repo.git']);
  assert.equal(run('resume', {}, repo).plan.tasks[0].id, 'a');
  git(repo, ['remote', 'set-url', 'origin', 'https://example.invalid/fork/repo.git']);
  assert.equal(run('status', {}, repo).checkpoint.phase, 'approved');
  const linked = worktree('linked-identity');
  assert.equal(session.activeMatchesRepo(session.activeSession(linked), linked), true);
  const alias = path.join(root, 'alias'); fs.symlinkSync(repo, alias);
  assert.equal(session.activeMatchesRepo(session.activeSession(alias), alias), true);
  const other = path.join(root, 'other', 'repo'); fs.mkdirSync(other, { recursive: true }); git(other, ['init', '-q']);
  git(other, ['remote', 'add', 'origin', 'https://example.invalid/fork/repo.git']);
  assert.equal(session.activeMatchesRepo(session.activeSession(other), other), false);
  assert.throws(() => run('status', {}, other), /Task ID/);
  session.closeSession(repo);
  assert.equal(run('resume', { task: 'task' }, repo).plan.tasks[0].id, 'a');
  assert.equal(session.activeSession(repo).sessionDir, dir);
  git(repo, ['remote', 'remove', 'origin']);
  assert.equal(run('status', {}, repo).checkpoint.phase, 'approved');
});

test('ship rejects the actual remote default branch before pushing and close rejects unrelated PRs', (t) => {
  const { repo, root, worktree } = fixture(t);
  const remote = path.join(root, 'remote.git'); git(repo, ['init', '--bare', '-q', remote]);
  git(repo, ['remote', 'add', 'origin', remote]); git(repo, ['branch', '-M', 'trunk']); git(repo, ['push', 'origin', 'trunk']); git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);
  const originalRemote = git(remote, ['rev-parse', 'trunk']).trim();
  const dir = openUntracked({ task: 'task' }, repo); const p = plan(); p.isolation = 'worktree'; run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const wave = run('dispatch', {}, repo); const a = worktree('default-guard'); change(a, 'a.txt', 'updated');
  run('integrate', { records: [completion(p.tasks[0], wave.baseHead, a)] }, repo); evidence(dir, repo); run('verify', {}, repo);
  assert.throws(() => run('ship', { authorized: true, title: 'test', body: 'test' }, repo), /origin default branch/);
  assert.equal(git(remote, ['rev-parse', 'trunk']).trim(), originalRemote);
  run('progress', { entry: { pr: 'https://github.com/example/repo/pull/23' } }, repo);
  assert.throws(() => run('close', { pr: 22 }, repo), /session's shipped PR/);
  assert.equal(session.activeSession(repo).task, 'task');
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf \'{"state":"MERGED","url":"https://github.com/other/repo/pull/23","mergeCommit":{"oid":"abc"}}\'\n', { mode: 0o755 });
  const prior = process.env.PATH; process.env.PATH = bin + path.delimiter + prior; t.after(() => { process.env.PATH = prior; });
  assert.throws(() => run('close', { pr: 23 }, repo), /repository and PR/);
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf \'{"state":"MERGED","url":"https://github.com/example/repo/pull/23","mergeCommit":{"oid":"abc"}}\'\n', { mode: 0o755 });
  assert.equal(run('close', { pr: 23 }, repo).state, 'MERGED');
  assert.equal(session.activeSession(repo), null);
});

test('Inspector rejects the data root when the exact session directory was omitted', (t) => {
  const { repo, data } = fixture(t); openUntracked({ task: 'task' }, repo); run('plan', { plan: plan() }, repo);
  assert.throws(() => recordInspector(data, { verdict: 'fail', fingerprint: snapshot(repo).fingerprint, checks: [] }, repo), /exact session directory/);
  assert.equal(fs.existsSync(path.join(data, 'inspector.json')), false);
});

test('route computes isolation for every task and dispatch persists it on routing and assignments', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const single = plan();
  run('plan', { plan: single }, repo); run('approve', { confirmed: true }, repo);
  assert.equal(run('route', {}, repo).tasks[0].isolation, 'branch');
  const dispatched = run('dispatch', {}, repo);
  assert.equal(dispatched.routing[0].isolation, 'branch');
  assert.equal(dispatched.assignments[0].isolation, 'branch');
});

test('two parallel-safe tasks dispatch both as worktree', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'], parallelSafe: true }, { id: 'b', files: ['b.txt'], parallelSafe: true }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const routed = run('route', {}, repo);
  assert.deepEqual(routed.tasks.map((item) => item.isolation), ['worktree', 'worktree']);
  const dispatched = run('dispatch', {}, repo);
  assert.deepEqual(dispatched.routing.map((item) => item.isolation), ['worktree', 'worktree']);
  assert.deepEqual(dispatched.assignments.map((item) => item.isolation), ['worktree', 'worktree']);
});

test('branch-mode dispatch commits directly on the integration branch and CLI integrate journals it without a cherry-pick', (t) => {
  const { repo } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  assert.equal(dispatched.assignments[0].isolation, 'branch');
  change(repo, 'a.txt', 'branch mode commit');
  const headBefore = snapshot(repo).head;
  const record = { ...completion(p.tasks[0], dispatched.baseHead, repo, 'branch'), attemptId: dispatched.assignments[0].attemptId };
  run('result', { record: { taskId: 'a', attemptId: record.attemptId, status: 'done' } }, repo);
  const journal = run('integrate', { records: [record] }, repo);
  assert.equal(snapshot(repo).head, headBefore, 'branch-mode integration never advances HEAD past the completion');
  const entry = journal.find((item) => item.taskId === 'a');
  assert.equal(entry.isolation, 'branch');
  assert.equal(entry.integratedHead, record.head);
  const commitMessage = git(repo, ['show', '-s', '--format=%B', record.head]);
  assert.doesNotMatch(commitMessage, /cherry picked from/);
  assert.equal(completedRecords(p, dir, repo).get('a').integratedHead, record.head);
  // Calling integrate again with the same record is idempotent.
  const headAfterFirst = snapshot(repo).head;
  const secondJournal = run('integrate', { records: [record] }, repo);
  assert.equal(snapshot(repo).head, headAfterFirst);
  assert.equal(secondJournal.filter((item) => item.taskId === 'a').length, 1);
});

test('a branch-mode record whose commits touch a file outside ownership fails with the existing ownership message and leaves HEAD unchanged', (t) => {
  const { repo, data } = fixture(t);
  const base = snapshot(repo).head;
  const p = plan([{ id: 'a', files: ['a.txt'] }]);
  change(repo, 'b.txt', 'outside ownership');
  const head = snapshot(repo).head;
  const record = { taskId: 'a', taskHash: taskHash(p.tasks[0]), status: 'done', baseHead: base, head, worktree: repo, filesChanged: ['b.txt'], isolation: 'branch' };
  assert.throws(() => integrate(p, [record], data, repo), /ownership in commit history/);
  assert.equal(snapshot(repo).head, head);
});

test('CLI integrate rejects a worktree-mode record presented under a branch assignment', (t) => {
  const { repo, worktree } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  assert.equal(dispatched.assignments[0].isolation, 'branch');
  const a = worktree('engineer-a'); change(a, 'a.txt', 'from a');
  const record = completion(p.tasks[0], dispatched.baseHead, a);
  assert.throws(() => run('integrate', { records: [record] }, repo), /Isolation mode mismatch/);
});

test('CLI integrate rejects a branch-mode record presented under a worktree assignment', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'], parallelSafe: true }, { id: 'b', files: ['b.txt'], parallelSafe: true }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  assert.equal(dispatched.assignments[0].isolation, 'worktree');
  change(repo, 'a.txt', 'direct commit');
  const record = completion(p.tasks[0], dispatched.baseHead, repo, 'branch');
  assert.throws(() => run('integrate', { records: [record] }, repo), /Isolation mode mismatch/);
});

test('a branch-mode record fails when the integration HEAD has moved past the recorded head', (t) => {
  const { repo, data } = fixture(t);
  const base = snapshot(repo).head;
  const p = plan();
  change(repo, 'a.txt', 'first commit');
  const record = completion(p.tasks[0], base, repo, 'branch');
  change(repo, 'a.txt', 'integration branch moved on');
  const headBeforeIntegrate = snapshot(repo).head;
  assert.throws(() => integrate(p, [record], data, repo), /does not match/);
  assert.equal(snapshot(repo).head, headBeforeIntegrate);
});

test('a multi-record integrate rejects any branch-mode record', (t) => {
  const { repo, data, worktree } = fixture(t);
  const base = snapshot(repo).head;
  const p = plan([{ id: 'a', files: ['a.txt'], parallelSafe: true }, { id: 'b', files: ['b.txt'], parallelSafe: true }]);
  const a = worktree('engineer-a'); change(a, 'a.txt', 'from a');
  const worktreeRecord = completion(p.tasks[0], base, a);
  change(repo, 'b.txt', 'branch mode commit');
  const branchRecord = completion(p.tasks[1], base, repo, 'branch');
  assert.throws(() => integrate(p, [worktreeRecord, branchRecord], data, repo), /one completion at a time/);
});

test('prepareWorktree in branch mode enforces the integration worktree, a clean tree, and the approved base', (t) => {
  const { repo, worktree } = fixture(t);
  const base = snapshot(repo).head;
  const other = worktree('not-integration-root');
  assert.throws(() => prepareWorktree(other, base, repo, 'branch'), /Branch-mode Engineer/);
  fs.writeFileSync(path.join(repo, 'scratch.txt'), 'dirty');
  assert.throws(() => prepareWorktree(repo, base, repo, 'branch'), /Branch-mode Engineer/);
  fs.rmSync(path.join(repo, 'scratch.txt'));
  change(repo, 'a.txt', 'moved past base');
  assert.throws(() => prepareWorktree(repo, base, repo, 'branch'), /Branch-mode Engineer/);
  git(repo, ['reset', '--hard', base]);
  const state = prepareWorktree(repo, base, repo, 'branch');
  assert.equal(state.head, base);
  assert.equal(snapshot(repo).head, base, 'branch mode never fast-forwards or otherwise moves HEAD');
});

test('releaseWorktrees ignores an integrated branch-mode operation and never reports the integration worktree', (t) => {
  const { repo, data } = fixture(t);
  const base = snapshot(repo).head;
  const p = plan();
  change(repo, 'a.txt', 'branch mode work');
  const record = completion(p.tasks[0], base, repo, 'branch');
  integrate(p, [record], data, repo);
  const result = releaseWorktrees(data, repo);
  assert.deepEqual(result, { released: [], kept: [], unintegrated: [] });
});

test('releaseWorktrees ignores an engineer-results attempt record whose worktree is the integration root', (t) => {
  const { repo, data } = fixture(t);
  fs.mkdirSync(path.join(data, 'engineer-results'));
  fs.writeFileSync(path.join(data, 'engineer-results', 'branch-attempt.json'),
    JSON.stringify({ taskId: 'a', attemptId: 'branch-attempt', status: 'done', worktree: repo, head: snapshot(repo).head }));
  const result = releaseWorktrees(data, repo);
  assert.deepEqual(result, { released: [], kept: [], unintegrated: [] });
});

test('status never lists the integration worktree for a branch-mode completion', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  change(repo, 'a.txt', 'branch mode via CLI');
  const record = completion(p.tasks[0], dispatched.baseHead, repo, 'branch');
  run('integrate', { records: [record] }, repo);
  const status = run('status', {}, repo);
  assert.deepEqual(status.worktrees, { released: [], kept: [], unintegrated: [] });
});

test('resume and status classify an active branch-mode Engineer\'s own commits as in-progress work, not divergence', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  assert.equal(dispatched.assignments[0].isolation, 'branch');
  change(repo, 'a.txt', 'branch mode in progress');
  // status is read-only preview: check it before resume persists a checkpoint at the new fingerprint.
  const status = run('status', {}, repo);
  assert.equal(status.checkpoint.branchWork, true);
  assert.equal(status.checkpoint.reconciliationRequired, false);
  assert.equal(status.checkpoint.next, 'result');
  const resumed = run('resume', {}, repo);
  assert.equal(resumed.changed, true);
  assert.equal(resumed.branchWork, true);
  assert.equal(resumed.checkpoint.next, 'result');
  assert.equal(resumed.checkpoint.reconciliationRequired, false);
});

test('resume and status require reconciliation when the checkout switches to another branch at the same commit', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  assert.equal(dispatched.assignments[0].isolation, 'branch');
  // Same commit as the dispatched base, but no longer the dispatched branch: not the
  // Engineer's own in-progress work even though HEAD still descends from the base.
  git(repo, ['switch', '-c', 'other-branch']);
  const status = run('status', {}, repo);
  assert.equal(status.checkpoint.branchWork, undefined);
  assert.equal(status.checkpoint.reconciliationRequired, true);
  assert.equal(status.checkpoint.next, 'reconcile');
  const resumed = run('resume', {}, repo);
  assert.equal(resumed.changed, true);
  assert.equal(resumed.branchWork, undefined);
  assert.equal(resumed.checkpoint.reconciliationRequired, true);
  assert.equal(resumed.checkpoint.next, 'reconcile');
});

test('resume and status fall back to divergence when HEAD no longer descends from the branch-mode base', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  assert.equal(dispatched.assignments[0].isolation, 'branch');
  // Rewrites the dispatched base itself so it no longer shares ancestry with the new HEAD,
  // simulating an unrelated Git rewrite rather than the branch-mode Engineer's own commits.
  git(repo, ['commit', '--amend', '--allow-empty', '-qm', 'rewritten base']);
  const resumed = run('resume', {}, repo);
  assert.equal(resumed.changed, true);
  assert.equal(resumed.branchWork, undefined);
  assert.equal(resumed.checkpoint.reconciliationRequired, true);
  assert.equal(resumed.checkpoint.next, 'reconcile');
  const status = run('status', {}, repo);
  assert.equal(status.checkpoint.branchWork, undefined);
  assert.equal(status.checkpoint.reconciliationRequired, true);
  assert.equal(status.checkpoint.next, 'reconcile');
});

test('resume and status still require reconciliation for a worktree-mode assignment with in-progress changes in the integration tree', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'], isolation: 'worktree' }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  assert.equal(dispatched.assignments[0].isolation, 'worktree');
  change(repo, 'a.txt', 'unexpected direct edit');
  const resumed = run('resume', {}, repo);
  assert.equal(resumed.changed, true);
  assert.equal(resumed.branchWork, undefined);
  assert.equal(resumed.checkpoint.reconciliationRequired, true);
  assert.equal(resumed.checkpoint.next, 'reconcile');
  const status = run('status', {}, repo);
  assert.equal(status.checkpoint.branchWork, undefined);
  assert.equal(status.checkpoint.reconciliationRequired, true);
  assert.equal(status.checkpoint.next, 'reconcile');
});

test('a failed branch-mode result with leftover commits outside ownership blocks recover until reconciled', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'] }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  assert.equal(dispatched.assignments[0].isolation, 'branch');
  change(repo, 'b.txt', 'outside ownership');
  const leftoverHead = snapshot(repo).head;
  const failure = run('result', { record: { taskId: 'a', attemptId: dispatched.assignments[0].attemptId, status: 'failed', summary: 'could not finish' } }, repo);
  const status = run('status', {}, repo);
  assert.equal(status.checkpoint.reconciliationRequired, true);
  assert.equal(status.checkpoint.next, 'reconcile');
  assert.match(status.checkpoint.reconciliationReason, new RegExp(failure.attemptId));
  assert.match(status.checkpoint.reconciliationReason, new RegExp(leftoverHead));
  assert.match(status.checkpoint.reconciliationReason, /b\.txt/);
  assert.match(status.checkpoint.reconciliationReason, /outside declared ownership/);
  assert.throws(() => run('recover', { failureId: failure.id, failureClass: 'implementation', repairTaskId: 'a' }, repo), /reconciliation/);
  run('reconcile', { scope: 'changed', reason: status.checkpoint.reconciliationReason }, repo);
  // Reconciling as "changed" requires a fresh approval, same as any other divergence; the
  // reconciliation-specific block is gone but recover is still not authorized to proceed.
  assert.throws(() => run('recover', { failureId: failure.id, failureClass: 'implementation', repairTaskId: 'a' }, repo), /approval/);
});

test('a failed branch-mode result with leftover commits inside ownership reconciles as unchanged and recover succeeds', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'] }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  change(repo, 'a.txt', 'partial in-ownership work');
  const failure = run('result', { record: { taskId: 'a', attemptId: dispatched.assignments[0].attemptId, status: 'failed', summary: 'could not finish' } }, repo);
  const status = run('status', {}, repo);
  assert.equal(status.checkpoint.reconciliationRequired, true);
  assert.equal(status.checkpoint.next, 'reconcile');
  assert.match(status.checkpoint.reconciliationReason, /all within declared ownership/);
  assert.throws(() => run('recover', { failureId: failure.id, failureClass: 'implementation', repairTaskId: 'a' }, repo), /reconciliation/);
  run('reconcile', { scope: 'unchanged', reason: status.checkpoint.reconciliationReason }, repo);
  assert.equal(run('recover', { failureId: failure.id, failureClass: 'implementation', repairTaskId: 'a' }, repo).next, 'engineer');
});

test('dirtyOutsideOwnership reports tracked and untracked dirty files outside the task\'s files', (t) => {
  const { repo } = fixture(t);
  const task = { id: 'a', files: ['a.txt'] };
  fs.writeFileSync(path.join(repo, 'a.txt'), 'dirty in-ownership edit');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'dirty tracked edit outside ownership');
  fs.writeFileSync(path.join(repo, 'c.txt'), 'untracked file outside ownership');
  assert.deepEqual(dirtyOutsideOwnership(task, repo), ['b.txt', 'c.txt']);
});

test('a failed branch-mode result with dirty files outside ownership and no commits reports only the dirty clause', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'] }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  fs.writeFileSync(path.join(repo, 'b.txt'), 'dirty, never committed');
  const failure = run('result', { record: { taskId: 'a', attemptId: dispatched.assignments[0].attemptId, status: 'failed', summary: 'could not finish' } }, repo);
  const status = run('status', {}, repo);
  assert.equal(status.checkpoint.reconciliationRequired, true);
  assert.equal(status.checkpoint.next, 'reconcile');
  assert.match(status.checkpoint.reconciliationReason, new RegExp(failure.attemptId));
  assert.match(status.checkpoint.reconciliationReason, /dirty files outside declared ownership: b\.txt/);
  assert.doesNotMatch(status.checkpoint.reconciliationReason, /committed files/);
  run('reconcile', { scope: 'changed', reason: status.checkpoint.reconciliationReason }, repo);
});

test('a failed branch-mode result with dirty files inside ownership and no commits reports the dirty clause as clean', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'] }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'dirty, never committed');
  const failure = run('result', { record: { taskId: 'a', attemptId: dispatched.assignments[0].attemptId, status: 'failed', summary: 'could not finish' } }, repo);
  const status = run('status', {}, repo);
  assert.equal(status.checkpoint.reconciliationRequired, true);
  assert.equal(status.checkpoint.next, 'reconcile');
  assert.match(status.checkpoint.reconciliationReason, /dirty files all within declared ownership/);
  assert.doesNotMatch(status.checkpoint.reconciliationReason, /committed files/);
  run('reconcile', { scope: 'unchanged', reason: status.checkpoint.reconciliationReason }, repo);
  // Reconcile only records the scope decision; the human must still discard or commit the
  // dirty file themselves, so recover keeps rejecting a dirty integration tree in either mode.
  assert.throws(() => run('recover', { failureId: failure.id, failureClass: 'implementation', repairTaskId: 'a' }, repo), /dirty/);
  git(repo, ['checkout', '--', 'a.txt']);
  assert.equal(run('recover', { failureId: failure.id, failureClass: 'implementation', repairTaskId: 'a' }, repo).next, 'engineer');
});

test('a failed branch-mode result with no leftover commits and a clean tree behaves exactly like a worktree-mode failure', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'] }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  assert.equal(dispatched.assignments[0].isolation, 'branch');
  const result = run('result', { record: { taskId: 'a', attemptId: dispatched.assignments[0].attemptId, status: 'failed', summary: 'could not start' } }, repo);
  const status = run('status', {}, repo);
  assert.equal(status.checkpoint.reconciliationRequired, false);
  assert.equal(status.checkpoint.next, 'recover');
  assert.equal(run('recover', { failureId: result.id, failureClass: 'implementation', repairTaskId: 'a' }, repo).next, 'engineer');
});
