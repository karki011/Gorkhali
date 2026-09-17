'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git, snapshot } = require('../lib/git-state');
const session = require('../lib/session');
const { run } = require('../lib/cli');
const { completion, integrate, prepareBranch, completedRecords, taskHash, dirtyOutsideOwnership } = require('../lib/execution');
const { recordInspector, requireInspector, recordAuditor, requireVerified, auditorWaiver } = require('../lib/verification');
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
  // A linked worktree stands in for "another checkout" in session-keying and rail tests only.
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
// What an Engineer does: align on the wave base in the integration checkout, edit, commit, record.
function implement(repo, base, task, edits) {
  prepareBranch(repo, base, repo);
  for (const [file, content] of Object.entries(edits)) change(repo, file, content);
  return completion(task, base, repo);
}
function evidence(dir, repo, userVisible = false) {
  if (!fs.existsSync(path.join(dir, 'plan.json'))) fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan()));
  const inspector = recordInspector(dir, { role: 'inspector', verdict: 'pass', worktree_unchanged: true, fingerprint: snapshot(repo).fingerprint,
    comments: { addedExplanatory: 0, exceptions: [] },
    checks: ['test', 'lint', 'build', 'typecheck'].map((name) => ({ name, command: null, provenance: null, result: 'absent' })) }, repo);
  recordAuditor(dir, { verdict: 'pass', inspectorId: inspector.id, fingerprint: inspector.fingerprint, findings: [], userVisible, comments: { addedExplanatory: 0, exceptions: [] }, independence: { basis: 'independent-context' } }, repo);
  return inspector;
}
// A fresh Inspector pass alone, with no matching current Auditor record.
function freshInspector(dir, repo) {
  return recordInspector(dir, { role: 'inspector', verdict: 'pass', worktree_unchanged: true, fingerprint: snapshot(repo).fingerprint,
    comments: { addedExplanatory: 0, exceptions: [] },
    checks: ['test', 'lint', 'build', 'typecheck'].map((name) => ({ name, command: null, provenance: null, result: 'absent' })) }, repo);
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

test('tasks integrate one at a time in the integration checkout and re-integration is idempotent', (t) => {
  const { repo, data } = fixture(t);
  const p = plan([{ id: 'a', files: ['a.txt'] }, { id: 'b', files: ['b.txt'] }]);
  const base = snapshot(repo).head;
  const first = implement(repo, base, p.tasks[0], { 'a.txt': 'from a' });
  integrate(p, [first], data, repo);
  const second = implement(repo, first.head, p.tasks[1], { 'b.txt': 'from b' });
  const journal = integrate(p, [second], data, repo);
  assert.deepEqual(journal.map((item) => item.taskId), ['a', 'b']);
  assert.deepEqual(journal.map((item) => item.integratedHead), [first.head, second.head]);
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'from a');
  assert.equal(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'from b');
  const head = snapshot(repo).head;
  assert.equal(integrate(p, [second], data, repo).length, 2);
  assert.equal(snapshot(repo).head, head);
});

test('integrate rejects more than one completion record per call', (t) => {
  const { repo, data } = fixture(t);
  const p = plan([{ id: 'a', files: ['a.txt'] }, { id: 'b', files: ['b.txt'] }]);
  const base = snapshot(repo).head;
  const first = implement(repo, base, p.tasks[0], { 'a.txt': 'from a' });
  const second = implement(repo, first.head, p.tasks[1], { 'b.txt': 'from b' });
  assert.throws(() => integrate(p, [first, second], data, repo), /one completion at a time/);
  assert.throws(() => integrate(p, [], data, repo), /one completion at a time/);
  assert.equal(fs.existsSync(path.join(data, 'integration.json')), false);
});

test('ownership violations and unmet dependency ancestry block integration', (t) => {
  const { repo, data } = fixture(t);
  const base = snapshot(repo).head;
  change(repo, 'b.txt', 'wrong owner');
  assert.throws(() => completion({ id: 'a', files: ['a.txt'] }, base, repo), /ownership/);
  const p = plan([{ id: 'a', files: ['a.txt'] }, { id: 'b', files: ['b.txt'], dependsOn: ['a'] }]);
  const record = completion(p.tasks[1], base, repo);
  const head = snapshot(repo).head;
  assert.throws(() => integrate(p, [record], data, repo), /not integrated/);
  assert.equal(snapshot(repo).head, head, 'a rejected integration never moves or resets HEAD');
  assert.equal(fs.existsSync(path.join(data, 'integration.json')), false);
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

test('pre-ship, a fresh Inspector pass without a current Auditor still requires the Auditor', (t) => {
  const { repo, data } = fixture(t);
  evidence(data, repo);
  session.writeJsonAtomic(path.join(data, 'checkpoint.json'), { phase: 'integrated' });
  freshInspector(data, repo);
  assert.throws(() => requireVerified(data, repo), /Auditor/);
});

test('once a PR exists a fresh Inspector pass alone satisfies verify when the last Auditor passed', (t) => {
  const { repo } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const wave = run('dispatch', {}, repo);
  run('integrate', { records: [implement(repo, wave.baseHead, p.tasks[0], { 'a.txt': 'ship me' })] }, repo);
  evidence(dir, repo);
  run('progress', { entry: { pr: 'https://github.com/o/r/pull/1' } }, repo);
  change(repo, 'a.txt', 'post ship follow up');
  const fresh = freshInspector(dir, repo);
  const result = run('verify', {}, repo);
  assert.equal(result.auditor, null);
  assert.match(result.auditorWaived, /post-ship/);
  assert.equal(result.inspector.id, fresh.id);
});

test('a failing latest Auditor record still blocks verify once a PR exists', (t) => {
  const { repo } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const wave = run('dispatch', {}, repo);
  run('integrate', { records: [implement(repo, wave.baseHead, p.tasks[0], { 'a.txt': 'ship me' })] }, repo);
  const inspector = evidence(dir, repo);
  recordAuditor(dir, { verdict: 'fail', inspectorId: inspector.id, fingerprint: inspector.fingerprint, findings: [] }, repo);
  run('progress', { entry: { pr: 'https://github.com/o/r/pull/2' } }, repo);
  change(repo, 'a.txt', 'post ship follow up');
  freshInspector(dir, repo);
  assert.throws(() => run('verify', {}, repo), /Auditor/);
});

test('the post-ship waiver still requires an initial human confirmation for user-visible work', (t) => {
  const { repo } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const wave = run('dispatch', {}, repo);
  run('integrate', { records: [implement(repo, wave.baseHead, p.tasks[0], { 'a.txt': 'ship me' })] }, repo);
  evidence(dir, repo, true);
  run('progress', { entry: { pr: 'https://github.com/o/r/pull/3' } }, repo);
  change(repo, 'a.txt', 'post ship follow up');
  const fresh = freshInspector(dir, repo);
  assert.throws(() => run('verify', {}, repo), /human/);
  run('human-confirmation', { confirmed: true }, repo);
  const result = run('verify', {}, repo);
  assert.match(result.auditorWaived, /post-ship/);
  assert.equal(result.inspector.id, fresh.id);
});

test('visual confirmation survives an in-scope repair while mechanical evidence must be refreshed', (t) => {
  const { repo } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo);
  run('plan', { plan: plan() }, repo);
  evidence(dir, repo, true);
  assert.equal(run('visual-status', {}, repo).reusable, false);
  assert.throws(() => requireVerified(dir, repo), /human visual confirmation/);
  run('human-confirmation', { confirmed: true }, repo);
  const original = fs.readFileSync(path.join(dir, 'human-confirmation.json'), 'utf8');
  change(repo, 'a.txt', 'in-scope repair');
  assert.equal(run('visual-status', {}, repo).basis, 'same-visual-scope');
  assert.throws(() => requireVerified(dir, repo), /Inspector/);
  evidence(dir, repo, true);
  assert.doesNotThrow(() => requireVerified(dir, repo));
  assert.equal(fs.readFileSync(path.join(dir, 'human-confirmation.json'), 'utf8'), original);
});

test('post-ship repairs reuse visual confirmation without requiring another Auditor or user pass', (t) => {
  const { repo } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const wave = run('dispatch', {}, repo);
  run('integrate', { records: [implement(repo, wave.baseHead, p.tasks[0], { 'a.txt': 'approved UI' })] }, repo);
  run('human-confirmation', { confirmed: true }, repo);
  evidence(dir, repo, true);
  run('progress', { entry: { pr: 'https://github.com/o/r/pull/4' } }, repo);
  change(repo, 'a.txt', 'restore intended revoked-device behavior');
  freshInspector(dir, repo);
  assert.equal(run('visual-status', {}, repo).reusable, true);
  assert.match(run('verify', {}, repo).auditorWaived, /post-ship/);
});

test('implementation-only amendments retain visual approval but changed acceptance requires a new pass', (t) => {
  const { repo } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo);
  const p = { ...plan(), visualReview: { scope: 'Device list', checklist: ['Revoked devices remain searchable and use a gray status dot'] } };
  run('plan', { plan: p }, repo);
  run('human-confirmation', { confirmed: true }, repo);
  const revised = { ...p, tasks: [{ ...p.tasks[0], action: 'Use the shared selector' }] };
  run('plan', { plan: revised }, repo);
  assert.equal(run('visual-status', {}, repo).reusable, true);
  change(repo, 'a.txt', 'shared selector');
  evidence(dir, repo, true);
  assert.doesNotThrow(() => requireVerified(dir, repo));
  run('plan', { plan: { ...revised, visualReview: { ...p.visualReview, checklist: ['Hide revoked devices by default'] } } }, repo);
  assert.equal(run('visual-status', {}, repo).reusable, false);
  evidence(dir, repo, true);
  assert.throws(() => requireVerified(dir, repo), /visual acceptance scope changed/);
});

test('without an explicit visual scope a plan amendment requires renewed visual approval', (t) => {
  const { repo } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo);
  run('plan', { plan: plan() }, repo); run('human-confirmation', { confirmed: true }, repo);
  const revised = { ...plan(), outcome: { goal: 'different experience', doneWhen: ['different result'] } };
  run('plan', { plan: revised }, repo);
  evidence(dir, repo, true);
  assert.throws(() => requireVerified(dir, repo), /visual acceptance scope changed/);
});

test('post-ship plan amendments need fresh independent review even when visual approval carries forward', (t) => {
  const { repo } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo);
  const p = { ...plan(), visualReview: { scope: 'Device list', checklist: ['Revoked devices have an inactive indicator'] } };
  run('plan', { plan: p }, repo); run('human-confirmation', { confirmed: true }, repo);
  evidence(dir, repo, true);
  run('progress', { entry: { pr: 'https://github.com/o/r/pull/5' } }, repo);
  run('plan', { plan: { ...p, tasks: [{ ...p.tasks[0], action: 'Use the shared selector' }] } }, repo);
  freshInspector(dir, repo);
  assert.equal(run('visual-status', {}, repo).reusable, true);
  assert.throws(() => requireVerified(dir, repo), /current Auditor/);
  evidence(dir, repo, true);
  assert.doesNotThrow(() => requireVerified(dir, repo));
});

test('visual approval cannot carry across branches, dirty work, or rewritten ancestry', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo); run('plan', { plan: plan() }, repo);
  const base = snapshot(repo).head;
  const branch = snapshot(repo).branch;
  change(repo, 'a.txt', 'approved UI'); run('human-confirmation', { confirmed: true }, repo);
  git(repo, ['switch', '-qc', 'other']);
  assert.equal(run('visual-status', {}, repo).reusable, false);
  git(repo, ['switch', branch]);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'uncommitted');
  assert.equal(run('visual-status', {}, repo).reusable, false);
  assert.throws(() => run('human-confirmation', { confirmed: true }, repo), /commit work/);
  git(repo, ['reset', '--hard', base]);
  assert.equal(run('visual-status', {}, repo).reusable, false);
});

test('legacy visual evidence remains valid only for its original fingerprint', (t) => {
  const { repo } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo); run('plan', { plan: plan() }, repo);
  session.writeJsonAtomic(path.join(dir, 'human-confirmation.json'), { confirmed: true, fingerprint: snapshot(repo).fingerprint });
  assert.equal(run('visual-status', {}, repo).reusable, true);
  change(repo, 'a.txt', 'later commit');
  assert.equal(run('visual-status', {}, repo).reusable, false);
  assert.match(run('visual-status', {}, repo).reason, /Legacy/);
});

test('auditorWaiver applies only under the optional policy with a recorded pr and a passing last Auditor', () => {
  const passing = { verdict: 'pass', findings: [] };
  const blocking = { verdict: 'pass', findings: [{ severity: 'blocking' }] };
  const failing = { verdict: 'fail', findings: [] };
  assert.equal(auditorWaiver({ pr: 'https://example.com/pull/1' }, passing, 'required'), null);
  assert.match(auditorWaiver({ pr: 'https://example.com/pull/1' }, passing, 'optional'), /post-ship/);
  assert.equal(auditorWaiver({}, passing, 'optional'), null);
  assert.equal(auditorWaiver({ pr: '' }, passing, 'optional'), null);
  assert.equal(auditorWaiver({ pr: 'https://example.com/pull/1' }, failing, 'optional'), null);
  assert.equal(auditorWaiver({ pr: 'https://example.com/pull/1' }, blocking, 'optional'), null);
  assert.equal(auditorWaiver({ pr: 'https://example.com/pull/1' }, null, 'optional'), null);
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

test('amending a plan after passed verification reports the discarded evidence', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo); run('plan', { plan: plan() }, repo); run('approve', { confirmed: true }, repo);
  assert.equal(run('plan', { plan: plan() }, repo).notice, undefined, 'no notice before any verification passed');
  run('approve', { confirmed: true }, repo);
  run('progress', { entry: { phase: 'verified', verification: 'passed', next: 'wrap' } }, repo);
  const amended = run('plan', { plan: plan([{ id: 'b', files: ['b.txt'] }]) }, repo);
  assert.match(amended.notice, /Batch further amendments/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.GORKHALI_DATA, 'repos', fs.readdirSync(path.join(process.env.GORKHALI_DATA, 'repos'))[0], 'sessions', 'task', 'plan.json'), 'utf8')).notice, undefined, 'notice is not persisted into plan.json');
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
  const { repo, root } = fixture(t);
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
  const p = plan(); run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  run('tracking-begin', { stage: 'start' }, repo); receipt('In Progress');
  evidence(dir, repo);
  assert.throws(() => run('ship', { authorized: true, title: 'test', body: 'test' }, repo), /completion evidence/);
  const dispatched = run('dispatch', {}, repo);
  run('integrate', { records: [implement(repo, dispatched.baseHead, p.tasks[0], { 'a.txt': 'ship me' })] }, repo);
  evidence(dir, repo); run('verify', {}, repo);
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  const stateFile = path.join(root, 'created');
  const logFile = path.join(root, 'calls');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${logFile}'\nif [ "$2" = list ]; then\n  if [ -e '${stateFile}' ]; then printf '[{"url":"https://github.com/example/repo/pull/1"}]'; else printf '[]'; fi\nelse\n  touch '${stateFile}'\n  printf 'https://github.com/example/repo/pull/1\\n'\nfi\n`, { mode: 0o755 });
  const previousPath = process.env.PATH; process.env.PATH = bin + path.delimiter + previousPath;
  t.after(() => { process.env.PATH = previousPath; });
  assert.equal('worktrees' in run('status', {}, repo), false, 'status carries no worktree release preview');
  const remoteTrunk = git(remote, ['rev-parse', 'trunk']).trim();
  assert.throws(() => git(repo, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']), 'fixture has no local default-branch ref');
  const shipped = run('ship', { authorized: true, title: 'test', body: 'test' }, repo);
  assert.deepEqual(shipped, { url: 'https://github.com/example/repo/pull/1' });
  assert.equal(git(remote, ['rev-parse', 'trunk']).trim(), remoteTrunk, 'ship never touches the remote default branch');
  assert.equal(tracking.read(dir).pending.stage, 'review');
  assert.throws(() => run('review-state', { pr: 1 }, repo), /review update/);
  // Simulate interruption after the external PR exists but before checkpointing it.
  run('progress', { entry: { pr: null, phase: 'verified' } }, repo);
  const recovered = run('ship', { authorized: true }, repo);
  assert.deepEqual(recovered, { url: 'https://github.com/example/repo/pull/1' });
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

test('task revisions and dependent revisions invalidate completed journal entries', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo); const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const wave = run('dispatch', {}, repo);
  run('integrate', { records: [implement(repo, wave.baseHead, p.tasks[0], { 'a.txt': 'first' })] }, repo);
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
  const { repo } = fixture(t); const base = snapshot(repo).head;
  change(repo, 'b.txt', 'forbidden'); change(repo, 'b.txt', 'base b\n'); change(repo, 'a.txt', 'allowed');
  assert.throws(() => completion(plan().tasks[0], base, repo), /ownership in commit history/);
});

test('legacy glob ownership accepts matching added, edited and deleted files', (t) => {
  const { repo, data } = fixture(t); const base = snapshot(repo).head;
  const p = plan([{ id: 'glob', files: ['*.txt'] }]);
  change(repo, 'a.txt', 'changed'); change(repo, 'new.txt', 'added');
  git(repo, ['rm', 'b.txt']); git(repo, ['commit', '-qm', 'delete matching file']);
  const record = completion(p.tasks[0], base, repo);
  integrate(p, [record], data, repo);
  assert.deepEqual(record.filesChanged, ['a.txt', 'b.txt', 'new.txt']);
  assert.equal(fs.existsSync(path.join(repo, 'b.txt')), false);
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
  assert.equal('isolation' in repair.assignment, false);
  run('result', { record: { ...record, attemptId: repair.assignment.attemptId } }, repo);
  assert.equal(run('route', {}, repo).tasks[0].tier, 'deep');
  assert.equal(run('status', {}, repo).checkpoint.implementationFailures, 2);
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
  // The sentinel is keyed per checkout, so a linked worktree of the same repo
  // never sees the main checkout's active session, even though its identity matches.
  const linked = worktree('linked-identity');
  assert.equal(session.activeSession(linked), null);
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
  const { repo, root } = fixture(t);
  const remote = path.join(root, 'remote.git'); git(repo, ['init', '--bare', '-q', remote]);
  git(repo, ['remote', 'add', 'origin', remote]); git(repo, ['branch', '-M', 'trunk']); git(repo, ['push', 'origin', 'trunk']); git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);
  const originalRemote = git(remote, ['rev-parse', 'trunk']).trim();
  const dir = openUntracked({ task: 'task' }, repo); const p = plan(); run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const wave = run('dispatch', {}, repo);
  run('integrate', { records: [implement(repo, wave.baseHead, p.tasks[0], { 'a.txt': 'updated' })] }, repo); evidence(dir, repo); run('verify', {}, repo);
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

test('route and dispatch carry no isolation field', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  run('plan', { plan: plan() }, repo); run('approve', { confirmed: true }, repo);
  assert.equal('isolation' in run('route', {}, repo).tasks[0], false);
  const dispatched = run('dispatch', {}, repo);
  assert.equal('isolation' in dispatched.routing[0], false);
  assert.equal('isolation' in dispatched.assignments[0], false);
});

test('dispatch never yields a multi-task wave, even for parallelSafe tasks with disjoint files', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'], parallelSafe: true, coordinationKeys: ['x'] }, { id: 'b', files: ['b.txt'], parallelSafe: true, coordinationKeys: ['y'] }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  assert.deepEqual(run('route', {}, repo).waves, [['a'], ['b']]);
  const dispatched = run('dispatch', {}, repo);
  assert.deepEqual(dispatched.wave, ['a']);
  assert.equal(dispatched.assignments.length, 1);
  run('integrate', { records: [implement(repo, dispatched.baseHead, p.tasks[0], { 'a.txt': 'from a' })] }, repo);
  assert.deepEqual(run('status', {}, repo).checkpoint.activeEngineers, []);
  assert.deepEqual(run('dispatch', {}, repo).wave, ['b']);
});

test('dispatch commits directly on the integration branch and CLI integrate journals the existing commits', (t) => {
  const { repo } = fixture(t);
  const dir = openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  const record = { ...implement(repo, dispatched.baseHead, p.tasks[0], { 'a.txt': 'direct commit' }), attemptId: dispatched.assignments[0].attemptId };
  const headBefore = snapshot(repo).head;
  run('result', { record: { taskId: 'a', attemptId: record.attemptId, status: 'done' } }, repo);
  const journal = run('integrate', { records: [record] }, repo);
  assert.equal(snapshot(repo).head, headBefore, 'integration never advances HEAD past the completion');
  const entry = journal.find((item) => item.taskId === 'a');
  assert.equal(entry.integratedHead, record.head);
  assert.equal(entry.sourceBranch, snapshot(repo).branch);
  assert.deepEqual(entry.applied, entry.commits.map((commit) => ({ source: commit, head: commit })));
  assert.equal(completedRecords(p, dir, repo).get('a').integratedHead, record.head);
  // Calling integrate again with the same record is idempotent.
  const headAfterFirst = snapshot(repo).head;
  const secondJournal = run('integrate', { records: [record] }, repo);
  assert.equal(snapshot(repo).head, headAfterFirst);
  assert.equal(secondJournal.filter((item) => item.taskId === 'a').length, 1);
});

test('a record whose commits touch a file outside ownership fails with the ownership message and leaves HEAD unchanged', (t) => {
  const { repo, data } = fixture(t);
  const base = snapshot(repo).head;
  const p = plan([{ id: 'a', files: ['a.txt'] }]);
  change(repo, 'b.txt', 'outside ownership');
  const head = snapshot(repo).head;
  const record = { taskId: 'a', taskHash: taskHash(p.tasks[0]), status: 'done', baseHead: base, head, worktree: repo, filesChanged: ['b.txt'] };
  assert.throws(() => integrate(p, [record], data, repo), /ownership in commit history/);
  assert.equal(snapshot(repo).head, head);
});

test('integrate rejects a completion recorded in another checkout of the repository', (t) => {
  const { repo, worktree } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  const elsewhere = worktree('another-checkout'); change(elsewhere, 'a.txt', 'from elsewhere');
  const record = completion(p.tasks[0], dispatched.baseHead, elsewhere);
  assert.throws(() => run('integrate', { records: [record] }, repo), /integration checkout/);
  assert.equal(snapshot(repo).head, dispatched.baseHead);
});

test('a record fails when the integration HEAD has moved past the recorded head', (t) => {
  const { repo, data } = fixture(t);
  const base = snapshot(repo).head;
  const p = plan();
  const record = implement(repo, base, p.tasks[0], { 'a.txt': 'first commit' });
  change(repo, 'a.txt', 'integration branch moved on');
  const headBeforeIntegrate = snapshot(repo).head;
  assert.throws(() => integrate(p, [record], data, repo), /does not match/);
  assert.equal(snapshot(repo).head, headBeforeIntegrate);
});

test('prepareBranch enforces the integration checkout, a clean tree, and the approved base', (t) => {
  const { repo, worktree } = fixture(t);
  const base = snapshot(repo).head;
  assert.throws(() => prepareBranch(repo, 'abc123', repo), /full base commit/);
  const other = worktree('not-integration-root');
  assert.throws(() => prepareBranch(other, base, repo), /integration checkout/);
  fs.writeFileSync(path.join(repo, 'scratch.txt'), 'dirty');
  assert.throws(() => prepareBranch(repo, base, repo), /clean integration tree/);
  fs.rmSync(path.join(repo, 'scratch.txt'));
  change(repo, 'a.txt', 'moved past base');
  assert.throws(() => prepareBranch(repo, base, repo), /approved wave base/);
  git(repo, ['reset', '--hard', base]);
  const state = prepareBranch(repo, base, repo);
  assert.equal(state.head, base);
  assert.equal(snapshot(repo).head, base, 'prepareBranch never fast-forwards or otherwise moves HEAD');
});

test('resume and status classify an active Engineer\'s own commits as in-progress work, not divergence', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  run('dispatch', {}, repo);
  change(repo, 'a.txt', 'in progress');
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
  run('dispatch', {}, repo);
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

test('resume and status fall back to divergence when HEAD no longer descends from the dispatched base', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan();
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  run('dispatch', {}, repo);
  // Rewrites the dispatched base itself so it no longer shares ancestry with the new HEAD,
  // simulating an unrelated Git rewrite rather than the Engineer's own commits.
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

test('a failed result with leftover commits outside ownership blocks recover until reconciled', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'] }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
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

test('a failed result with leftover commits inside ownership reconciles as unchanged and recover succeeds', (t) => {
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

test('a failed result with dirty files outside ownership and no commits reports only the dirty clause', (t) => {
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

test('a failed result with dirty files inside ownership and no commits reports the dirty clause as clean', (t) => {
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
  // dirty file themselves, so recover keeps rejecting a dirty integration tree.
  assert.throws(() => run('recover', { failureId: failure.id, failureClass: 'implementation', repairTaskId: 'a' }, repo), /dirty/);
  git(repo, ['checkout', '--', 'a.txt']);
  assert.equal(run('recover', { failureId: failure.id, failureClass: 'implementation', repairTaskId: 'a' }, repo).next, 'engineer');
});

test('a failed result with no leftover commits and a clean tree goes straight to recover', (t) => {
  const { repo } = fixture(t);
  openUntracked({ task: 'task' }, repo);
  const p = plan([{ id: 'a', files: ['a.txt'] }]);
  run('plan', { plan: p }, repo); run('approve', { confirmed: true }, repo);
  const dispatched = run('dispatch', {}, repo);
  const result = run('result', { record: { taskId: 'a', attemptId: dispatched.assignments[0].attemptId, status: 'failed', summary: 'could not start' } }, repo);
  const status = run('status', {}, repo);
  assert.equal(status.checkpoint.reconciliationRequired, false);
  assert.equal(status.checkpoint.next, 'recover');
  assert.equal(run('recover', { failureId: result.id, failureClass: 'implementation', repairTaskId: 'a' }, repo).next, 'engineer');
});
