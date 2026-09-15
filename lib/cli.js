#!/usr/bin/env node
// The lead's bounded shell entry point. No eval, arbitrary command or code writer.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const session = require('./session');
const paths = require('./paths');
const { git, snapshot, digest } = require('./git-state');
const verification = require('./verification');
const { validatePlan } = require('./plan-schema');
const { scoreRisk, tierForTask, buildExecutionWaves, THRESHOLDS } = require('./routing');
const { modelForTier } = require('./tiers');
const { integrate, releaseWorktrees, readJournal, completedRecords, taskHash } = require('./execution');
const tracking = require('./tracking');
function run(action, input = {}, cwd = process.cwd()) {
  const active = session.activeSession(cwd);
  const matchingActive = session.activeMatchesRepo(active, cwd);
  const repo = matchingActive ? active.repo : paths.repoSlug(cwd);
  const task = input.task || (matchingActive ? active.task : null);
  if (!task) throw new Error('Task ID required');
  const dir = paths.sessionDir(repo, task, cwd);
  const plan = () => {
    const value = session.readPlan(repo, task, cwd);
    const errors = validatePlan(value);
    if (errors.length) throw new Error(errors.join('; '));
    return value;
  };
  const progress = (entry) => session.appendProgress(repo, task, entry, cwd);
  const approved = () => {
    if (session.readCheckpoint(repo, task, cwd)?.approvedPlanHash !== digest(JSON.stringify(plan()))) throw new Error('Current plan requires explicit approval');
  };
  const reconciled = () => {
    if (session.readCheckpoint(repo, task, cwd)?.reconciliationRequired) throw new Error('Git divergence requires a scope reconciliation before continuing');
  };
  const integrated = () => {
    const completed = completedRecords(plan(), dir, cwd);
    for (const item of plan().tasks) {
      const record = completed.get(item.id);
      if (!record) throw new Error(`Task ${item.id} has no integrated completion evidence`);
      git(cwd, ['merge-base', '--is-ancestor', record.integratedHead, 'HEAD']);
    }
    if (session.readCheckpoint(repo, task, cwd)?.activeEngineers?.length) throw new Error('Engineers are still active');
    if (session.readCheckpoint(repo, task, cwd)?.pendingFailureIds?.length) throw new Error('Unresolved Engineer failures block verification');
  };
  // The worktree report is advisory. A failure inside it must never fail a ship whose PR exists, or a status read.
  const worktreeReport = (apply, protect = []) => {
    try { return releaseWorktrees(dir, cwd, apply, protect); } catch (err) { return { released: [], kept: [], unintegrated: [], error: String(err.stderr || err.message).trim() }; }
  };
  const trackingContext = () => {
    const pending = tracking.read(dir).pending;
    const saved = session.readCheckpoint(repo, task, cwd);
    if (pending?.stage === 'start') { approved(); reconciled(); }
    if (['review', 'done'].includes(pending?.stage) && saved?.pr !== pending.pr) throw new Error('Pending ticket update must match the shipped PR');
    if (pending?.stage === 'done' && saved?.mergedPr !== pending.pr) throw new Error('Ticket completion requires confirmed merge evidence');
  };
  switch (action) {
    case 'open': return session.openSession(repo, task, cwd);
    case 'tracking-configure': {
      let githubRepo;
      try { githubRepo = git(cwd, ['remote', 'get-url', 'origin']).match(/(?:github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1]; } catch (_) { /* Ask for repository context when absent. */ }
      const { provider } = require('./tracker').resolveTracker({ cwd });
      return tracking.configure(dir, { provider, repo: githubRepo, ...input });
    }
    case 'tracking-settings': return tracking.settings(dir, input);
    case 'tracking-status': return tracking.read(dir);
    case 'tracking-begin': {
      const saved = session.readCheckpoint(repo, task, cwd);
      if (input.stage === 'start') { approved(); reconciled(); }
      if (input.stage === 'review' && !saved?.pr) throw new Error('Create or recover the PR before moving the ticket to review');
      if (input.stage === 'done' && (!saved?.pr || saved.mergedPr !== saved.pr)) throw new Error('Confirm the shipped PR merge with close before completing the ticket');
      return tracking.begin(dir, input.stage, { pr: saved?.pr });
    }
    case 'tracking-observe': {
      if (tracking.read(dir).ticket?.provider !== 'jira') throw new Error('GitHub observations must come from tracking-sync');
      trackingContext();
      try { return tracking.observe(dir, input.observation); }
      catch (err) { tracking.fail(dir, err.message); throw err; }
    }
    case 'tracking-failure': return tracking.fail(dir, input.reason);
    case 'tracking-sync': trackingContext(); return require('./tracker-github').sync(dir, cwd);
    case 'branch': {
      if (typeof input.name !== 'string' || ['main', 'master', 'HEAD'].includes(input.name)) throw new Error('Feature branch name required');
      git(cwd, ['check-ref-format', '--branch', input.name]);
      if (snapshot(cwd).dirtyFiles.length) throw new Error('Reconcile dirty work before creating a branch');
      git(cwd, ['switch', '-c', input.name]); return snapshot(cwd);
    }
    case 'plan': {
      const errors = validatePlan(input.plan);
      if (errors.length) throw new Error(errors.join('; '));
      if (session.readCheckpoint(repo, task, cwd)?.activeEngineers?.length) throw new Error('Stop or collect active Engineers before changing the plan');
      session.writePlan(repo, task, input.plan, cwd); return input.plan;
    }
    case 'approve':
      if (input.confirmed !== true) throw new Error('Explicit plan approval required');
      tracking.requireStage(dir, 'intake');
      return progress({ phase: 'approved', next: 'dispatch', approvedPlanHash: digest(JSON.stringify(plan())), reconciliationRequired: false });
    case 'progress': {
      const saved = session.readCheckpoint(repo, task, cwd);
      if (input.entry?.mergedPr !== undefined) throw new Error('Merge evidence must come from close');
      for (const key of ['repairAttempts', 'implementationFailures', 'verificationFailures']) {
        if (input.entry?.[key] !== undefined && (!Number.isInteger(input.entry[key]) || input.entry[key] < (saved?.[key] || 0))) throw new Error('Failure counters cannot decrease within a session');
      }
      return progress(input.entry);
    }
    case 'pause': {
      const saved = session.readCheckpoint(repo, task, cwd);
      if (saved?.activeEngineers?.length) throw new Error('Stop or collect running Engineers before claiming a stable pause');
      return session.checkpoint(repo, task, { phase: 'paused' }, cwd);
    }
    case 'resume': {
      const result = session.resume(repo, task, cwd);
      result.tracking = tracking.read(dir);
      if (!result.changed && !result.checkpoint.reconciliationRequired) {
        try {
          approved(); integrated(); verification.requireVerified(dir, cwd);
          result.checkpoint = session.checkpoint(repo, task, { verification: 'passed', ...(!result.checkpoint.pr ? { phase: 'verified', next: 'wrap' } : {}) }, cwd);
        } catch (_) { /* Partial evidence never creates a pass. */ }
      }
      return result;
    }
    case 'reconcile': {
      if (!['unchanged', 'changed'].includes(input.scope) || typeof input.reason !== 'string' || !input.reason.trim()) throw new Error('Record scope classification and Git evidence');
      const completed = [...completedRecords(plan(), dir, cwd).keys()];
      return progress({ reconciliationRequired: input.scope === 'changed', reconciliationReason: input.reason,
        completedTasks: completed, pendingTasks: plan().tasks.map((item) => item.id).filter((id) => !completed.includes(id)),
        verification: 'stale', next: input.scope === 'changed' ? 'approve' : 'dispatch_or_verify',
        ...(input.scope === 'changed' ? { approvedPlanHash: null } : {}) });
    }
    case 'status': {
      const current = snapshot(cwd);
      const saved = session.readCheckpoint(repo, task, cwd);
      return { checkpoint: saved && saved.fingerprint !== current.fingerprint ? { ...saved, verification: 'stale', reconciliationRequired: true, next: 'reconcile' } : saved, current, tracking: tracking.read(dir), progress: session.readProgress(repo, task, cwd), worktrees: worktreeReport(false) };
    }
    case 'snapshot': return snapshot(cwd);
    case 'diff': {
      if (!/^[a-f0-9]{40,64}$/.test(input.baseHead)) throw new Error('Full approved base commit required');
      return git(cwd, ['diff', '--no-ext-diff', '--no-textconv', input.baseHead, '--']);
    }
    case 'route': {
      const value = plan();
      const saved = session.readCheckpoint(repo, task, cwd);
      const counters = { implementationFailures: saved?.implementationFailures || 0, verificationFailures: saved?.verificationFailures || 0 };
      const combined = { ...counters, riskSignals: {} };
      for (const item of value.tasks) for (const [key, enabled] of Object.entries(item.riskSignals || {})) if (enabled) combined.riskSignals[key] = true;
      const reviewerTier = tierForTask('auditor', combined);
      const oppositionTier = tierForTask('opposition', combined);
      return { waves: buildExecutionWaves(value.tasks), auditor: { tier: reviewerTier, model: modelForTier(reviewerTier), risk: scoreRisk(combined) },
        opposition: { needed: !!combined.riskSignals.architectureAmbiguity || scoreRisk(combined) >= THRESHOLDS.opposition, tier: oppositionTier, model: modelForTier(oppositionTier) },
        tasks: value.tasks.map((item) => {
        const risk = { ...item, ...counters };
        const tier = tierForTask('engineer', risk);
        return { id: item.id, risk: scoreRisk(risk), tier, model: modelForTier(tier) };
      }) };
    }
    case 'dispatch': {
      approved(); reconciled();
      tracking.requireStage(dir, 'start');
      const state = snapshot(cwd);
      if (state.dirtyFiles.length) throw new Error('Commit or reconcile existing changes before isolated dispatch');
      const saved = session.readCheckpoint(repo, task, cwd);
      if (saved?.activeEngineers?.length) throw new Error('Reconcile the running wave before dispatching again');
      if (saved?.pendingFailureIds?.length) throw new Error('Unresolved Engineer failures must use bounded recovery before dispatch');
      const value = plan();
      const completed = new Set(completedRecords(value, dir, cwd).keys());
      const remaining = value.tasks.filter((item) => !completed.has(item.id)).map((item) => ({ ...item, dependsOn: (item.dependsOn || []).filter((id) => !completed.has(id)) }));
      const wave = buildExecutionWaves(remaining)[0] || [];
      const routing = wave.map((id) => {
        const risk = { ...value.tasks.find((item) => item.id === id), implementationFailures: saved?.implementationFailures || 0, verificationFailures: saved?.verificationFailures || 0 };
        const tier = tierForTask('engineer', risk);
        return { id, risk: scoreRisk(risk), tier, model: modelForTier(tier) };
      });
      const assignments = routing.map((assignment) => ({ ...assignment, attemptId: randomUUID(), baseHead: state.head, taskHash: taskHash(value.tasks.find((item) => item.id === assignment.id)) }));
      progress({ phase: 'dispatched', wave: (saved?.wave || 0) + 1, activeEngineers: wave, assignments, baseHead: state.head, routing, next: wave.length ? 'integrate' : 'verify' });
      return { baseHead: state.head, wave, routing, assignments };
    }
    case 'result': {
      const saved = session.readCheckpoint(repo, task, cwd);
      const record = input.record;
      const assignment = saved?.assignments?.find((item) => item.attemptId === record?.attemptId && item.id === record?.taskId);
      if (!assignment || !['done', 'failed', 'blocked', 'needs-context'].includes(record.status)) throw new Error('Result must match a dispatched Engineer attempt');
      if ((saved.consumedResults || []).includes(record.attemptId)) return { alreadyRecorded: true };
      const result = { ...record, assignment, id: record.attemptId, role: 'engineer', verdict: record.status === 'done' ? 'pass' : 'fail', fingerprint: snapshot(cwd).fingerprint };
      session.writeJsonAtomic(path.join(dir, 'engineer-results', `${record.attemptId}.json`), result);
      const failed = record.status === 'failed';
      progress({ phase: 'engineer_result', consumedResults: [...(saved.consumedResults || []), record.attemptId],
        pendingFailureIds: record.status === 'done' ? saved.pendingFailureIds || [] : [...(saved.pendingFailureIds || []), record.attemptId],
        implementationFailures: (saved.implementationFailures || 0) + (failed ? 1 : 0),
        activeEngineers: record.status === 'done' ? saved.activeEngineers : saved.activeEngineers.filter((id) => id !== record.taskId),
        blocked: ['blocked', 'needs-context'].includes(record.status) ? [record.summary || record.status] : [], next: record.status === 'done' ? 'integrate' : failed ? 'recover' : 'human' });
      return result;
    }
    case 'resolve-failures': {
      const saved = session.readCheckpoint(repo, task, cwd);
      if (input.confirmed !== true || typeof input.reason !== 'string' || !input.reason.trim() || !Array.isArray(input.failureIds) || !input.failureIds.length) throw new Error('Explicit human decision, reason, and pending failure IDs required');
      if (saved?.activeEngineers?.length) throw new Error('Collect active Engineers before resolving failures');
      if (input.failureIds.some((id) => !(saved?.pendingFailureIds || []).includes(id))) throw new Error('Resolve only pending failures');
      return progress({ phase: 'human_resolution', pendingFailureIds: saved.pendingFailureIds.filter((id) => !input.failureIds.includes(id)),
        resolvedFailureIds: input.failureIds, humanDecision: input.reason, blocked: [], next: 'dispatch_or_verify' });
    }
    case 'recover': {
      approved(); reconciled();
      tracking.requireStage(dir, 'start');
      const saved = session.readCheckpoint(repo, task, cwd);
      const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (_) { return null; } };
      const engineerFailure = /^[a-f0-9-]{36}$/.test(input.failureId || '') ? read(`engineer-results/${input.failureId}.json`) : null;
      const failure = [read('inspector.json'), read('reviews/auditor.json'), engineerFailure].find((record) => record?.id === input.failureId && record.verdict !== 'pass');
      if (!failure || !input.failureClass) throw new Error('A recorded blocking failure and classification are required');
      if (failure.role === 'engineer') {
        const currentTask = plan().tasks.find((item) => item.id === failure.taskId);
        if (!currentTask || taskHash(currentTask) !== failure.assignment?.taskHash) throw new Error('Engineer failure belongs to an obsolete task revision');
        git(cwd, ['merge-base', '--is-ancestor', failure.assignment.baseHead, 'HEAD']);
      } else if (failure.fingerprint !== snapshot(cwd).fingerprint) throw new Error('Failure evidence is stale; reconcile before repair');
      if (saved?.lastRepairFailureId === failure.id) throw new Error('This failure already dispatched a repair; collect its result before retrying');
      const attempts = saved?.repairAttempts || 0;
      const result = require('./recovery').recoveryDecision({ attempts, diagnosed: input.diagnosed === true, unclear: input.unclear === true, flaky: input.flaky === true,
        infrastructure: input.infrastructure === true || ['blocked', 'needs-context'].includes(failure.status), repeated: attempts > 0 && saved?.failureClass === input.failureClass });
      const counters = { verificationFailures: (saved?.verificationFailures || 0) + (saved?.failureId === failure.id || failure.role === 'engineer' ? 0 : 1), repairAttempts: attempts };
      const extra = {};
      if (result.next === 'engineer') {
        if (saved?.activeEngineers?.length) throw new Error('Collect the active Engineer before repair');
        const repairTask = plan().tasks.find((item) => item.id === input.repairTaskId);
        if (!repairTask) throw new Error('Repair must name an approved task ownership scope');
        const state = snapshot(cwd);
        if (state.dirtyFiles.length) throw new Error('Reconcile dirty work before repair');
        extra.activeEngineers = [repairTask.id]; extra.baseHead = state.head; extra.lastRepairFailureId = failure.id;
        counters.repairAttempts++;
        const tier = tierForTask('engineer', { ...repairTask, ...counters, implementationFailures: saved?.implementationFailures || 0 });
        Object.assign(result, { task: repairTask, baseHead: state.head, tier, model: modelForTier(tier) });
        extra.assignments = [{ id: repairTask.id, attemptId: randomUUID(), baseHead: state.head, taskHash: taskHash(repairTask), tier, model: result.model }];
        extra.pendingFailureIds = (saved.pendingFailureIds || []).filter((id) => id !== failure.id);
        result.assignment = extra.assignments[0];
      }
      progress({ ...counters, ...extra, phase: 'recovery', verification: 'failed', failureId: failure.id, failureClass: input.failureClass, next: result.next,
        blocked: result.next === 'human' ? [result.reason] : [], escalationReason: result.reason });
      return result;
    }
    case 'integrate': {
      approved(); reconciled();
      const saved = session.readCheckpoint(repo, task, cwd);
      for (const record of input.records || []) {
        const assignment = saved?.assignments?.find((item) => item.id === record.taskId);
        if (!assignment || assignment.baseHead !== record.baseHead || assignment.taskHash !== record.taskHash) throw new Error('Completion is not from the dispatched wave/base');
      }
      const records = integrate(plan(), input.records, dir, cwd);
      const completedTasks = [...completedRecords(plan(), dir, cwd).keys()];
      const integratedIds = new Set(input.records.map((item) => item.taskId));
      const activeEngineers = (saved.activeEngineers || []).filter((id) => !integratedIds.has(id));
      progress({ phase: 'integrated', completedTasks, pendingTasks: plan().tasks.map((item) => item.id).filter((id) => !completedTasks.includes(id)), activeEngineers, next: activeEngineers.length ? 'integrate' : saved.pendingFailureIds?.length ? 'recover' : 'dispatch_or_verify', verification: 'stale' });
      return records;
    }
    case 'verify': {
      approved(); reconciled(); integrated();
      const evidence = verification.requireVerified(dir, cwd);
      progress({ phase: 'verified', verification: 'passed', next: 'wrap' }); return evidence;
    }
    case 'human-confirmation': {
      if (input.confirmed !== true) throw new Error('Explicit user confirmation required');
      const state = snapshot(cwd);
      session.writeJsonAtomic(path.join(dir, 'human-confirmation.json'), { confirmed: true, fingerprint: state.fingerprint }); return state;
    }
    case 'ship': {
      approved(); reconciled();
      tracking.requireStage(dir, 'start');
      integrated();
      if (input.authorized !== true) throw new Error('Ship authorization required');
      verification.requireVerified(dir, cwd);
      const state = snapshot(cwd);
      if (state.dirtyFiles.length || ['main', 'master', 'HEAD'].includes(state.branch)) throw new Error('Ship a clean committed feature branch');
      const remoteHead = git(cwd, ['ls-remote', '--symref', 'origin', 'HEAD']);
      const defaultBranch = remoteHead.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1];
      if (!defaultBranch) throw new Error('Cannot establish origin default branch; shipping blocked');
      if (state.branch === defaultBranch) throw new Error('Cannot ship directly from the origin default branch');
      const gh = (args) => execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const existing = JSON.parse(gh(['pr', 'list', '--head', state.branch, '--state', 'open', '--json', 'url']));
      let url = existing[0]?.url;
      if (!url && (!input.title || !input.body)) throw new Error('PR title and body required');
      git(cwd, ['push', '-u', 'origin', `refs/heads/${state.branch}:refs/heads/${state.branch}`]);
      if (!url) {
        const bodyFile = path.join(dir, 'pr-body.md');
        fs.writeFileSync(bodyFile, input.body);
        url = gh(['pr', 'create', '--title', input.title, '--body-file', bodyFile]).trim();
      }
      progress({ phase: 'shipped', pr: url, next: 'external_review' });
      tracking.begin(dir, 'review', { pr: url });
      // The branch is now proven and pushed, so Engineer worktrees whose commits are in it are released.
      return { url, worktrees: worktreeReport(true, [defaultBranch]) };
    }
    case 'review-state': {
      const shipped = session.readCheckpoint(repo, task, cwd)?.pr;
      tracking.requireStage(dir, 'review', shipped);
      if (!Number.isInteger(input.pr) || input.pr < 1) throw new Error('PR number required');
      if (!shipped?.endsWith(`/pull/${input.pr}`)) throw new Error('Review must name this session\'s shipped PR');
      const review = require('./pr-watch');
      const observed = review.tick(input.pr);
      const transition = review.reviewTransition(session.readCheckpoint(repo, task, cwd) || {}, observed, input.classifications || []);
      progress({ phase: 'external_review', ...transition });
      return { ...observed, ...transition };
    }
    case 'close': {
      if (!Number.isInteger(input.pr) || input.pr < 1) throw new Error('PR number required');
      const shipped = session.readCheckpoint(repo, task, cwd)?.pr;
      if (typeof shipped !== 'string' || !shipped.endsWith(`/pull/${input.pr}`)) throw new Error('Close must name this session\'s shipped PR');
      const result = JSON.parse(execFileSync('gh', ['pr', 'view', String(input.pr), '--json', 'state,mergeCommit,url'], { cwd, encoding: 'utf8' }));
      if (result.url !== shipped) throw new Error('Merged PR does not match this session repository and PR');
      if (result.state !== 'MERGED') throw new Error('PR is not merged');
      progress({ phase: 'merged', mergedPr: shipped, next: 'tracking_done' });
      const tracked = tracking.read(dir);
      if (tracked.decision !== 'none') {
        tracking.requireStage(dir, 'review', shipped);
        tracking.begin(dir, 'done', { pr: shipped });
        if (!tracking.read(dir).stages.done) return { ...result, tracking: tracking.read(dir), needsTracking: true };
      }
      progress({ phase: 'closed', next: 'none' });
      if (matchingActive && active.task === task) session.closeSession(cwd);
      return result;
    }
    default: throw new Error('Unknown lifecycle action');
  }
}
if (require.main === module) {
  try {
    const [action, encoded] = process.argv.slice(2);
    const active = session.activeSession();
    const request = session.activeMatchesRepo(active) ? path.join(active.sessionDir, 'request.json') : null;
    const input = action === 'open' ? { task: encoded } : encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) : request && fs.existsSync(request) ? JSON.parse(fs.readFileSync(request, 'utf8')) : {};
    const result = run(action, input);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) { process.stderr.write(err.message + '\n'); process.exitCode = 1; }
}
module.exports = { run };
