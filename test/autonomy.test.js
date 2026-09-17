'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../lib/cli');
const { git, snapshot } = require('../lib/git-state');
const { completion } = require('../lib/execution');
const { recordInspector, recordAuditor } = require('../lib/verification');
const autonomy = require('../lib/autonomy');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-autonomy-'));
  const cwd = path.join(root, 'repo'); fs.mkdirSync(cwd);
  const previous = process.env.GORKHALI_DATA;
  process.env.GORKHALI_DATA = path.join(root, 'data');
  t.after(() => { if (previous === undefined) delete process.env.GORKHALI_DATA; else process.env.GORKHALI_DATA = previous; fs.rmSync(root, { recursive: true, force: true }); });
  git(cwd, ['init', '-q']); git(cwd, ['config', 'user.name', 'Fixture']); git(cwd, ['config', 'user.email', 'fixture@example.com']);
  fs.writeFileSync(path.join(cwd, 'a.js'), 'const original = 0;\n');
  git(cwd, ['add', '.']); git(cwd, ['commit', '-qm', 'base']); git(cwd, ['switch', '-qc', 'feature']);
  const dir = run('open', { task: 'work' }, cwd);
  const plan = {
    baseHead: snapshot(cwd).head,
    briefing: { tackling: 'work', problem: 'work', how: 'work' },
    decision: { question: 'work', recommendation: 'work', rationale: ['work'], status: 'pending' },
    outcome: { goal: 'work', doneWhen: ['work'] }, scope: { in: ['work'], out: [] },
    autonomy: { wellScoped: true, ticketProvided: false, openQuestions: [], estimatedImplementationLines: 20, ...options },
    tasks: [{ id: 'a', description: 'work', files: ['a.js', 'a.test.js'], action: 'work', acceptance_criteria: ['work'], verify: 'test' }],
  };
  run('plan', { plan }, cwd);
  return { cwd, dir, plan };
}
function commit(cwd, edits) {
  for (const [file, text] of Object.entries(edits)) fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, ['add', '.']); git(cwd, ['commit', '-qm', 'work']);
}
function implement(ctx, edits, approval = { autonomous: true }) {
  const { cwd, plan } = ctx;
  run('approve', approval, cwd);
  const wave = run('dispatch', {}, cwd);
  commit(cwd, edits);
  const record = { ...completion(plan.tasks[0], wave.baseHead, cwd), attemptId: wave.assignments[0].attemptId };
  run('result', { record }, cwd); run('integrate', { records: [record] }, cwd);
}
function inspector(ctx, scopeFiles, extra = {}) {
  return recordInspector(ctx.dir, { verdict: 'pass', worktree_unchanged: true, fingerprint: snapshot(ctx.cwd).fingerprint, scopeFiles,
    comments: { addedExplanatory: 0, exceptions: [] },
    checks: ['test', 'lint', 'build', 'typecheck'].map((name) => ({ name, result: 'absent' })), ...extra }, ctx.cwd);
}
function audit(ctx, evidence, extra = {}) {
  return recordAuditor(ctx.dir, { verdict: 'pass', inspectorId: evidence.id, fingerprint: evidence.fingerprint, findings: [], userVisible: false,
    independence: { basis: 'independent-context' }, scopeReviewed: true, comments: { addedExplanatory: 0, exceptions: [] }, ...extra }, ctx.cwd);
}
function classified(file, implementation, extra = {}) {
  return { file, implementation, tests: 0, comments: 0, blank: 0, ...extra };
}

test('clear work below 300 starts and resumes without plan or optional ticket questions', (t) => {
  const ctx = fixture(t, { estimatedImplementationLines: 299 });
  run('approve', { autonomous: true }, ctx.cwd);
  const approved = run('status', {}, ctx.cwd).checkpoint;
  assert.equal(approved.approval.mode, 'autonomous');
  assert.equal(run('tracking-status', {}, ctx.cwd).source, 'autonomous-policy');
  const resumed = run('resume', {}, ctx.cwd);
  assert.equal(resumed.checkpoint.approval.baseHead, ctx.plan.baseHead);
  assert.deepEqual(run('dispatch', {}, ctx.cwd).wave, ['a']);
});

test('unclear, oversized, and unresolved ticket requests cannot self-approve', (t) => {
  const ctx = fixture(t);
  for (const update of [{ estimatedImplementationLines: 300 }, { wellScoped: false }, { openQuestions: ['Which consumer?'] }, { ticketProvided: true }]) {
    const plan = { ...ctx.plan, autonomy: { ...ctx.plan.autonomy, ...update } };
    run('plan', { plan }, ctx.cwd);
    assert.throws(() => run('approve', { autonomous: true }, ctx.cwd));
    assert.equal(run('status', {}, ctx.cwd).checkpoint.approval, undefined);
  }
  run('plan', { plan: { ...ctx.plan, tasks: [{ ...ctx.plan.tasks[0], riskSignals: { architectureAmbiguity: true } }] } }, ctx.cwd);
  assert.throws(() => run('approve', { autonomous: true }, ctx.cwd), /ambiguity/);
  const { autonomy: omitted, ...legacy } = ctx.plan;
  run('plan', { plan: legacy }, ctx.cwd);
  assert.throws(() => run('approve', {}, ctx.cwd), /Explicit plan approval/);
});

test('bound tickets still require intake and start receipts', (t) => {
  const ctx = fixture(t, { ticketProvided: true });
  run('tracking-configure', { reference: 'https://example.atlassian.net/browse/ENG-42' }, ctx.cwd);
  assert.throws(() => run('approve', { autonomous: true }, ctx.cwd), /intake/);
  const state = run('tracking-begin', { stage: 'intake' }, ctx.cwd);
  run('tracking-observe', { observation: { attemptId: state.pending.id, ticketUrl: state.ticket.url, source: 'fixture', observedAt: new Date().toISOString(), title: 'Work', status: { id: 'todo', name: 'To Do' }, assignees: [] } }, ctx.cwd);
  run('approve', { autonomous: true }, ctx.cwd);
  assert.throws(() => run('dispatch', {}, ctx.cwd), /start/);
});

test('299 implementation lines qualify despite large tests', (t) => {
  const ctx = fixture(t, { estimatedImplementationLines: 299 });
  const implementation = Array.from({ length: 298 }, (_, index) => `const value${index} = ${index};\n`).join('');
  const tests = 'assert.ok(true);\n'.repeat(500);
  implement(ctx, { 'a.js': implementation, 'a.test.js': tests });
  const files = [classified('a.js', 299), classified('a.test.js', 0, { tests: 500, reason: 'Test assertions in a.test.js' })];
  assert.equal(run('scope', { files }, ctx.cwd).implementationLines, 299);
  const check = inspector(ctx, files);
  assert.throws(() => audit(ctx, check, { scopeReviewed: false }), /exclusions/);
  audit(ctx, check);
  assert.equal(run('verify', {}, ctx.cwd).inspector.scope.implementationLines, 299);
});

test('actual 300-line scope blocks further dispatch and passing verification until human approval', (t) => {
  const ctx = fixture(t);
  implement(ctx, { 'a.js': 'run();\n'.repeat(299) });
  const files = [classified('a.js', 300)];
  run('scope', { files }, ctx.cwd);
  assert.throws(() => run('dispatch', {}, ctx.cwd), /300 implementation lines/);
  assert.throws(() => inspector(ctx, files), /300 implementation lines/);
  run('approve', { confirmed: true }, ctx.cwd);
  const check = inspector(ctx); audit(ctx, check);
  assert.doesNotThrow(() => run('verify', {}, ctx.cwd));
});

test('scope accounting includes deletions and rejects omissions, duplicates, stale counts, and binaries', (t) => {
  const ctx = fixture(t);
  implement(ctx, { 'a.js': 'run();\n', 'a.test.js': 'test();\n' });
  const files = [classified('a.js', 2), classified('a.test.js', 0, { tests: 1, reason: 'Test call' })];
  assert.throws(() => autonomy.measure(ctx.plan.baseHead, files.slice(0, 1), ctx.cwd), /every changed/);
  assert.throws(() => autonomy.measure(ctx.plan.baseHead, [files[0], files[0]], ctx.cwd), /every changed/);
  assert.throws(() => autonomy.measure(ctx.plan.baseHead, [classified('a.js', 1), files[1]], ctx.cwd), /complete Git diff/);
  assert.throws(() => autonomy.measure(ctx.plan.baseHead, [files[0], { ...files[1], reason: '' }], ctx.cwd), /Explain/);
  run('scope', { files }, ctx.cwd);
  commit(ctx.cwd, { 'a.js': 'run();\n'.repeat(300) });
  assert.throws(() => autonomy.requireScope(ctx.dir, ctx.cwd), /Classify current scope/);
  commit(ctx.cwd, { 'a.js': Buffer.from([0, 1, 2]) });
  assert.throws(() => autonomy.changes(ctx.plan.baseHead, ctx.cwd), /Binary/);
});

test('comment-only and blank lines are excluded while mixed code/comment lines count as implementation', (t) => {
  const ctx = fixture(t);
  commit(ctx.cwd, { 'a.js': '/*\nexisting explanation\n*/\n\nrun(); // existing explanation\n' });
  const count = autonomy.measure(ctx.plan.baseHead, [classified('a.js', 2, { comments: 3, blank: 1, reason: 'Three comment-only lines and one blank; code with trailing comment still counts' })], ctx.cwd);
  assert.equal(count.implementationLines, 2);
});

test('plan amendments cannot reset autonomous scope and progress cannot forge approval', (t) => {
  const ctx = fixture(t);
  run('approve', { autonomous: true }, ctx.cwd);
  const revised = { ...ctx.plan, scope: { in: ['more work'], out: [] } };
  run('plan', { plan: revised }, ctx.cwd);
  assert.throws(() => run('approve', { autonomous: true }, ctx.cwd), /human approval/);
  assert.throws(() => run('dispatch', {}, ctx.cwd), /approval/);
  assert.throws(() => run('progress', { entry: { approvedPlanHash: 'forged' } }, ctx.cwd), /authorization/);
  run('approve', { confirmed: true }, ctx.cwd);
  assert.equal(run('status', {}, ctx.cwd).checkpoint.approval.mode, 'human');
});

test('auditor cannot pass added explanatory comments or unexplained exceptions', (t) => {
  const ctx = fixture(t);
  implement(ctx, { 'a.js': 'run();\n' });
  const check = inspector(ctx, [classified('a.js', 2)]);
  for (const comments of [undefined, { addedExplanatory: 1, exceptions: [] }, { addedExplanatory: 0, exceptions: [{ kind: 'style', file: 'a.js', reason: 'Helpful' }] }]) {
    assert.throws(() => audit(ctx, check, { comments }), /explanatory comments/);
  }
  audit(ctx, check, { comments: { addedExplanatory: 0, exceptions: [{ kind: 'license', file: 'a.js', reason: 'Required attribution retained' }] } });
  assert.doesNotThrow(() => run('verify', {}, ctx.cwd));
});

test('Inspector rejects missing or failing comment evidence before any Auditor waiver', (t) => {
  const ctx = fixture(t);
  implement(ctx, { 'a.js': 'run();\n' });
  const files = [classified('a.js', 2)];
  for (const comments of [undefined, { addedExplanatory: 1, exceptions: [] }]) {
    assert.throws(() => inspector(ctx, files, { comments }), /complete evidence/);
  }
});

test('manually approved work without autonomy metadata enforces the same no-comment rule', (t) => {
  const ctx = fixture(t);
  delete ctx.plan.autonomy;
  run('plan', { plan: ctx.plan }, ctx.cwd);
  run('tracking-configure', { decision: 'none', confirmed: true, reason: 'Fixture user has no ticket' }, ctx.cwd);
  implement(ctx, { 'a.js': 'run();\n' }, { confirmed: true });
  assert.equal(run('status', {}, ctx.cwd).checkpoint.approval.mode, 'human');
  const noisy = { addedExplanatory: 1, exceptions: [] };
  assert.throws(() => inspector(ctx, undefined, { comments: noisy }), /complete evidence/);
  const check = inspector(ctx);
  assert.equal(check.scope, undefined);
  assert.throws(() => audit(ctx, check, { comments: noisy }), /explanatory comments/);
  assert.throws(() => audit(ctx, check, { comments: undefined }), /explanatory comments/);
  audit(ctx, check);
  assert.doesNotThrow(() => run('verify', {}, ctx.cwd));
});

test('autonomous approval requires the planned clean feature checkout', (t) => {
  const ctx = fixture(t);
  fs.writeFileSync(path.join(ctx.cwd, 'untracked'), 'work');
  assert.throws(() => run('approve', { autonomous: true }, ctx.cwd), /clean feature/);
  fs.unlinkSync(path.join(ctx.cwd, 'untracked'));
  commit(ctx.cwd, { 'a.js': 'moved();\n' });
  assert.throws(() => run('approve', { autonomous: true }, ctx.cwd), /base/);
});
