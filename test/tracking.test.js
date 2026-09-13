'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tracking = require('../lib/tracking');
const github = require('../lib/tracker-github');
const { run } = require('../lib/cli');
const { git } = require('../lib/git-state');

function fixture(t, reference = 'https://example.atlassian.net/browse/ENG-42') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-tracking-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  tracking.configure(dir, { reference });
  return dir;
}
function observation(dir, extra = {}) {
  const state = tracking.read(dir);
  return { attemptId: state.pending.id, ticketUrl: state.ticket.url, source: 'fixture provider read', observedAt: new Date().toISOString(),
    title: 'Implement work', status: { id: 'todo', name: 'To Do' }, assignees: [], currentUser: 'me-id', links: [],
    transitions: [{ id: 'transition-1', name: 'In Progress' }, { id: 'transition-2', name: 'In Review' }, { id: 'transition-3', name: 'Done' }], ...extra };
}
function intake(dir) { tracking.begin(dir, 'intake'); tracking.observe(dir, observation(dir)); }
const pr = 'https://github.com/owner/repo/pull/12';

test('ticket URLs and keys preserve provider identity and reject ambiguous or unsafe references', () => {
  assert.deepEqual(tracking.parseTicket('#12', { repo: 'owner/repo' }), tracking.parseTicket('https://github.com/owner/repo/issues/12'));
  assert.equal(tracking.parseTicket('eng-42', { site: 'https://example.atlassian.net' }).key, 'ENG-42');
  assert.equal(tracking.parseTicket('https://example.atlassian.net/jira/software/projects/ENG/boards/1?selectedIssue=ENG-42').key, 'ENG-42');
  for (const ref of ['42', '-1', 'https://github.com/owner/repo/pull/12', 'https://user:secret@example.atlassian.net/browse/ENG-42', 'https://example.com/unknown/12', '$(touch /tmp/unsafe)', 'https://github.com/owner/repo/issues/9007199254740993']) assert.throws(() => tracking.parseTicket(ref));
  assert.throws(() => tracking.parseTicket('42', { provider: 'jira', repo: 'owner/repo' }), /full Jira key/);
});

test('no-ticket requires a recorded user decision and persists without provider calls', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-untracked-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => tracking.requireStage(dir, 'intake'), /Ask whether/);
  assert.throws(() => tracking.configure(dir, { decision: 'none' }), /user decision/);
  tracking.configure(dir, { decision: 'none', confirmed: true, reason: 'User has no ticket' });
  assert.doesNotThrow(() => tracking.requireStage(dir, 'done'));
  assert.equal(tracking.begin(dir, 'done').decision, 'none');
});

test('assignment, transition, and PR link require provider read-back before completing stages', (t) => {
  const dir = fixture(t); intake(dir);
  tracking.begin(dir, 'start');
  assert.deepEqual(tracking.observe(dir, observation(dir)).action, { kind: 'assign', assignee: 'me-id', replace: false });
  assert.throws(() => tracking.requireStage(dir, 'start'), /read-back/);
  assert.equal(tracking.observe(dir, observation(dir, { assignees: ['me-id'] })).action.id, 'transition-1');
  tracking.observe(dir, observation(dir, { assignees: ['me-id'], status: { id: 'progress', name: 'In Progress' } }));
  tracking.requireStage(dir, 'start');
  tracking.begin(dir, 'review', { pr });
  const linked = tracking.observe(dir, observation(dir, { assignees: ['me-id'] }));
  assert.equal(linked.action.kind, 'link');
  assert.equal(linked.action.pr, pr);
  const links = [{ url: pr, marker: linked.pending.marker }];
  assert.equal(tracking.observe(dir, observation(dir, { links })).action.id, 'transition-2');
  tracking.observe(dir, observation(dir, { links, status: { id: 'review', name: 'In Review' } }));
  tracking.begin(dir, 'done', { pr });
  assert.equal(tracking.observe(dir, observation(dir)).action.id, 'transition-3');
  tracking.observe(dir, observation(dir, { status: { id: 'done', name: 'Done' } }));
  assert.deepEqual(Object.keys(tracking.read(dir).stages), ['intake', 'start', 'review', 'done']);
  assert.equal(tracking.begin(dir, 'start').pending, null, 'resume does not regress to In Progress');
});

test('existing assignees are preserved and explicit reassignment needs authorization', (t) => {
  const dir = fixture(t); intake(dir); tracking.begin(dir, 'start');
  const next = tracking.observe(dir, observation(dir, { assignees: ['existing-owner'], currentUser: null }));
  assert.equal(next.action.kind, 'transition');
  const other = fixture(t);
  assert.throws(() => tracking.configure(other, { reference: 'https://example.atlassian.net/browse/ENG-42', assignee: 'new-owner', reassign: true }), /authorization/);
  tracking.configure(other, { reference: 'https://example.atlassian.net/browse/ENG-42', assignee: 'new-owner', reassign: true, confirmed: true });
  intake(other); tracking.begin(other, 'start');
  assert.deepEqual(tracking.observe(other, observation(other, { assignees: ['existing-owner'] })).action, { kind: 'assign', assignee: 'new-owner', replace: true });
});

test('unknown or ambiguous statuses block until an explicit mapping is selected', (t) => {
  const dir = fixture(t); intake(dir); tracking.begin(dir, 'start');
  const obs = observation(dir, { assignees: ['owner'], transitions: [{ id: 'custom', name: 'Building' }] });
  assert.throws(() => tracking.observe(dir, obs), /status mapping/);
  tracking.settings(dir, { confirmed: true, statusNames: { start: 'Building' } });
  assert.equal(tracking.observe(dir, obs).action.id, 'custom');
  assert.throws(() => tracking.observe(dir, { ...obs, transitions: [...obs.transitions, { id: 'duplicate', name: 'Building' }] }), /2 matching/);
});

test('closed tickets and writes not visible in read-back cannot trigger repeated mutations', (t) => {
  const dir = fixture(t); intake(dir); tracking.begin(dir, 'start');
  assert.throws(() => tracking.observe(dir, observation(dir, { closed: true })), /already closed/);
  tracking.observe(dir, observation(dir));
  assert.throws(() => tracking.observe(dir, observation(dir)), /Previous tracker write/);
  assert.equal(tracking.read(dir).pending.action.kind, 'assign');
  tracking.settings(dir, { confirmed: true });
  assert.equal(tracking.observe(dir, observation(dir)).action.kind, 'assign', 'a user-authorized retry still requires fresh observation');
});

test('ticket mismatch, stale evidence, incomplete reads, and invalid transitions cannot complete a stage', (t) => {
  const dir = fixture(t); tracking.begin(dir, 'intake');
  for (const extra of [{ ticketUrl: 'https://example.atlassian.net/browse/ENG-99' }, { attemptId: 'other' }, { observedAt: '2000-01-01T00:00:00Z' }, { truncated: true }, { assignees: null }, { source: '' }]) assert.throws(() => tracking.observe(dir, observation(dir, extra)));
  assert.deepEqual(tracking.read(dir).stages, {});
  assert.throws(() => tracking.configure(dir, { reference: 'https://other.atlassian.net/browse/ENG-42' }), /different ticket/);
  assert.throws(() => tracking.begin(dir, 'review', { pr }), /start update/);
});

function githubFixture(t) {
  const dir = fixture(t, 'https://github.com/owner/repo/issues/42');
  const issue = { html_url: 'https://github.com/owner/repo/issues/42', title: 'Work', node_id: 'I_42', state: 'open', assignees: [] };
  const model = { status: 'Todo', comments: [], writes: [], loseResponse: false };
  const call = (args, body) => {
    if (args[1] === 'user') return { login: 'owner' };
    if (args[1] === 'graphql') {
      if (body.query.startsWith('mutation')) {
        model.writes.push(body); model.status = { doing: 'In Progress', review: 'In Review', done: 'Done' }[body.variables.option];
        return { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'item' } } } };
      }
      return { data: { node: { projectItems: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'item', isArchived: false, fieldValueByName: { optionId: model.status, name: model.status }, project: { id: 'project', title: 'Project', fields: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'field', name: 'Status', options: [{ id: 'doing', name: 'In Progress' }, { id: 'review', name: 'In Review' }, { id: 'done', name: 'Done' }] }] } } }] } } } };
    }
    if (args.includes('PATCH')) { model.writes.push(body); if (body.assignees) issue.assignees = body.assignees.map((login) => ({ login })); if (body.state) issue.state = body.state; return issue; }
    if (args.includes('POST')) {
      model.comments.push(body); model.writes.push(body);
      if (model.loseResponse) { model.loseResponse = false; throw new Error('Response lost after successful write'); }
      return body;
    }
    if (args[1].includes('/comments')) return [model.comments];
    return issue;
  };
  function finish(stage) {
    tracking.begin(dir, stage, { pr });
    for (let n = 0; n < 5 && tracking.read(dir).pending; n++) github.sync(dir, '.', call);
    tracking.requireStage(dir, stage);
  }
  return { dir, model, issue, call, finish };
}

test('GitHub driver assigns, updates Projects, links PR once across a lost response, and closes after merge stage', (t) => {
  const { dir, model, issue, call, finish } = githubFixture(t);
  finish('intake'); finish('start');
  assert.deepEqual(issue.assignees, [{ login: 'owner' }]);
  assert.equal(model.status, 'In Progress');
  assert.equal(tracking.read(dir).projectId, 'project');
  tracking.begin(dir, 'review', { pr }); model.loseResponse = true;
  const attempt = tracking.read(dir).pending.id;
  assert.throws(() => github.sync(dir, '.', call), /Response lost/);
  assert.equal(tracking.read(dir).pending.id, attempt);
  assert.equal(model.comments.length, 1);
  finish('review');
  assert.equal(model.comments.length, 1);
  assert.equal(model.status, 'In Review');
  finish('done');
  assert.equal(issue.state, 'closed'); assert.equal(model.status, 'Done');
  const writes = model.writes.length; finish('start'); finish('review'); finish('done');
  assert.equal(model.writes.length, writes);
});

test('GitHub fails closed on missing project access and never interprets a PR as a ticket', (t) => {
  const { dir, issue, call, finish } = githubFixture(t);
  finish('intake'); tracking.begin(dir, 'start');
  assert.throws(() => github.sync(dir, '.', (args, body) => args[1] === 'graphql' ? { errors: [{ message: 'No project access' }] } : call(args, body)), /project access/);
  assert.equal(tracking.read(dir).stages.start, undefined);
  issue.pull_request = {};
  assert.throws(() => github.sync(dir, '.', call), /not a PR/);
});

test('CLI requires intake and start receipts, and gates review/done on PR/merge events', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-tracking-cli-'));
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  git(repo, ['init', '-q']); git(repo, ['config', 'user.name', 'Fixture']); git(repo, ['config', 'user.email', 'fixture@example.com']);
  fs.writeFileSync(path.join(repo, 'a'), 'a'); git(repo, ['add', '.']); git(repo, ['commit', '-qm', 'base']);
  const previous = process.env.GORKHALI_DATA; process.env.GORKHALI_DATA = path.join(root, 'data');
  t.after(() => { if (previous === undefined) delete process.env.GORKHALI_DATA; else process.env.GORKHALI_DATA = previous; fs.rmSync(root, { recursive: true, force: true }); });
  const dir = run('open', { task: 'work' }, repo);
  const plan = { briefing: { tackling: 'work', problem: 'work', how: 'work' }, decision: { question: 'work', recommendation: 'work', rationale: ['work'], status: 'approved' }, outcome: { goal: 'work', doneWhen: ['work'] }, scope: { in: ['a'], out: [] }, tasks: [{ id: 'a', description: 'work', files: ['a'], action: 'work', acceptance_criteria: ['work'], verify: 'true' }] };
  run('plan', { plan }, repo);
  assert.throws(() => run('approve', { confirmed: true }, repo), /Ask whether/);
  run('tracking-configure', { reference: 'https://example.atlassian.net/browse/ENG-42' }, repo);
  assert.throws(() => run('tracking-begin', { stage: 'start' }, repo), /approval/);
  run('tracking-begin', { stage: 'intake' }, repo); run('tracking-observe', { observation: observation(dir) }, repo);
  run('approve', { confirmed: true }, repo);
  assert.throws(() => run('dispatch', {}, repo), /start update/);
  assert.throws(() => run('tracking-begin', { stage: 'review' }, repo), /Create or recover/);
  assert.throws(() => run('tracking-begin', { stage: 'done' }, repo), /Confirm/);
  assert.throws(() => run('progress', { entry: { mergedPr: pr } }, repo), /Merge evidence/);
  run('tracking-begin', { stage: 'start' }, repo);
  const attempt = tracking.read(dir).pending.id;
  run('tracking-failure', { reason: 'Missing transition' }, repo);
  run('pause', {}, repo);
  const resumed = run('resume', {}, repo);
  assert.equal(resumed.tracking.pending.id, attempt); assert.equal(resumed.tracking.error, 'Missing transition');
  run('tracking-observe', { observation: observation(dir, { assignees: ['existing'], status: { id: 'doing', name: 'In Progress' } }) }, repo);
  assert.deepEqual(run('dispatch', {}, repo).wave, ['a']);
});
