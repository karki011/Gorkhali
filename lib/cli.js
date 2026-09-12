#!/usr/bin/env node
// The lead's bounded shell entry point. No eval, arbitrary command or code writer.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const session = require('./session');
const paths = require('./paths');
const { git, snapshot, digest } = require('./git-state');
const verification = require('./verification');
const { validatePlan } = require('./plan-schema');
const { scoreRisk, tierForTask, buildExecutionWaves, THRESHOLDS } = require('./routing');
const { modelForTier } = require('./tiers');
const { integrate, readJournal } = require('./execution');
function run(action, input = {}, cwd = process.cwd()) {
  const active = session.activeSession(cwd);
  const repo = paths.repoSlug(cwd);
  const task = input.task || (active?.repo === repo ? active.task : null);
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
  const integrated = () => {
    const journal = readJournal(dir);
    for (const item of plan().tasks) {
      const record = journal.findLast((entry) => entry.taskId === item.id && entry.integratedHead);
      if (!record) throw new Error(`Task ${item.id} has no integrated completion evidence`);
      git(cwd, ['merge-base', '--is-ancestor', record.integratedHead, 'HEAD']);
    }
    if (session.readCheckpoint(repo, task, cwd)?.activeEngineers?.length) throw new Error('Engineers are still active');
  };
  switch (action) {
    case 'open': return session.openSession(repo, task, cwd);
    case 'branch': {
      if (typeof input.name !== 'string' || ['main', 'master', 'HEAD'].includes(input.name)) throw new Error('Feature branch name required');
      git(cwd, ['check-ref-format', '--branch', input.name]);
      if (snapshot(cwd).dirtyFiles.length) throw new Error('Reconcile dirty work before creating a branch');
      git(cwd, ['switch', '-c', input.name]); return snapshot(cwd);
    }
    case 'plan': {
      const errors = validatePlan(input.plan);
      if (errors.length) throw new Error(errors.join('; '));
      session.writePlan(repo, task, input.plan, cwd); return input.plan;
    }
    case 'approve':
      if (input.confirmed !== true) throw new Error('Explicit plan approval required');
      return progress({ phase: 'approved', next: 'dispatch', approvedPlanHash: digest(JSON.stringify(plan())) });
    case 'progress': {
      const saved = session.readCheckpoint(repo, task, cwd);
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
    case 'resume': return session.resume(repo, task, cwd);
    case 'status': return { checkpoint: session.readCheckpoint(repo, task, cwd), current: snapshot(cwd), progress: session.readProgress(repo, task, cwd) };
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
      approved();
      const state = snapshot(cwd);
      if (state.dirtyFiles.length) throw new Error('Commit or reconcile existing changes before isolated dispatch');
      const saved = session.readCheckpoint(repo, task, cwd);
      if (saved?.activeEngineers?.length) throw new Error('Reconcile the running wave before dispatching again');
      const value = plan();
      const completed = new Set();
      for (const item of readJournal(dir).filter((record) => record.integratedHead)) {
        git(cwd, ['merge-base', '--is-ancestor', item.integratedHead, state.head]);
        completed.add(item.taskId);
      }
      if ((saved?.completedTasks || []).some((id) => !completed.has(id))) throw new Error('Completed task evidence requires reconciliation');
      const remaining = value.tasks.filter((item) => !completed.has(item.id)).map((item) => ({ ...item, dependsOn: (item.dependsOn || []).filter((id) => !completed.has(id)) }));
      const wave = buildExecutionWaves(remaining)[0] || [];
      const routing = wave.map((id) => {
        const risk = { ...value.tasks.find((item) => item.id === id), implementationFailures: saved?.implementationFailures || 0, verificationFailures: saved?.verificationFailures || 0 };
        const tier = tierForTask('engineer', risk);
        return { id, risk: scoreRisk(risk), tier, model: modelForTier(tier) };
      });
      progress({ phase: 'dispatched', wave: (saved?.wave || 0) + 1, activeEngineers: wave, baseHead: state.head, routing, next: wave.length ? 'integrate' : 'verify' });
      return { baseHead: state.head, wave, routing };
    }
    case 'recover': {
      approved();
      const saved = session.readCheckpoint(repo, task, cwd);
      const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (_) { return null; } };
      const failure = [read('inspector.json'), read('reviews/auditor.json')].find((record) => record?.id === input.failureId && record.verdict !== 'pass');
      if (!failure || !input.failureClass) throw new Error('A recorded blocking failure and classification are required');
      if (failure.fingerprint !== snapshot(cwd).fingerprint) throw new Error('Failure evidence is stale; reconcile before repair');
      if (saved?.lastRepairFailureId === failure.id) throw new Error('This failure already dispatched a repair; collect its result before retrying');
      const attempts = saved?.repairAttempts || 0;
      const result = require('./recovery').recoveryDecision({ attempts, diagnosed: input.diagnosed === true, unclear: input.unclear === true, flaky: input.flaky === true,
        infrastructure: input.infrastructure === true, repeated: attempts > 0 && saved?.failureClass === input.failureClass });
      const counters = { verificationFailures: (saved?.verificationFailures || 0) + (saved?.failureId === failure.id ? 0 : 1), repairAttempts: attempts };
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
      }
      progress({ ...counters, ...extra, phase: 'recovery', verification: 'failed', failureId: failure.id, failureClass: input.failureClass, next: result.next,
        blocked: result.next === 'human' ? [result.reason] : [] });
      return result;
    }
    case 'integrate': {
      approved();
      const records = integrate(plan(), input.records, dir, cwd);
      const completedTasks = [...new Set(records.filter((record) => record.integratedHead).map((record) => record.taskId))];
      progress({ phase: 'integrated', completedTasks, pendingTasks: plan().tasks.map((item) => item.id).filter((id) => !completedTasks.includes(id)), activeEngineers: [], next: 'dispatch_or_verify', verification: 'stale' });
      return records;
    }
    case 'verify': {
      const evidence = verification.requireVerified(dir, cwd);
      progress({ phase: 'verified', verification: 'passed', next: 'wrap' }); return evidence;
    }
    case 'human-confirmation': {
      if (input.confirmed !== true) throw new Error('Explicit user confirmation required');
      const state = snapshot(cwd);
      session.writeJsonAtomic(path.join(dir, 'human-confirmation.json'), { confirmed: true, fingerprint: state.fingerprint }); return state;
    }
    case 'ship': {
      approved();
      integrated();
      if (input.authorized !== true) throw new Error('Ship authorization required');
      verification.requireVerified(dir, cwd);
      const state = snapshot(cwd);
      if (state.dirtyFiles.length || ['main', 'master', 'HEAD'].includes(state.branch)) throw new Error('Ship a clean committed feature branch');
      const gh = (args) => execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const existing = JSON.parse(gh(['pr', 'list', '--head', state.branch, '--state', 'open', '--json', 'url']));
      let url = existing[0]?.url;
      if (!url && (!input.title || !input.body)) throw new Error('PR title and body required');
      git(cwd, ['push', '-u', 'origin', state.branch]);
      if (!url) {
        const bodyFile = path.join(dir, 'pr-body.md');
        fs.writeFileSync(bodyFile, input.body);
        url = gh(['pr', 'create', '--title', input.title, '--body-file', bodyFile]).trim();
      }
      progress({ phase: 'shipped', pr: url, next: 'external_review' }); return url;
    }
    case 'review-state': {
      if (!Number.isInteger(input.pr) || input.pr < 1) throw new Error('PR number required');
      return require('./pr-watch').tick(input.pr);
    }
    case 'close': {
      if (!Number.isInteger(input.pr) || input.pr < 1) throw new Error('PR number required');
      const result = JSON.parse(execFileSync('gh', ['pr', 'view', String(input.pr), '--json', 'state,mergeCommit'], { cwd, encoding: 'utf8' }));
      if (result.state !== 'MERGED') throw new Error('PR is not merged');
      progress({ phase: 'closed', next: 'none' });
      session.closeSession(cwd); return result;
    }
    default: throw new Error('Unknown lifecycle action');
  }
}
if (require.main === module) {
  try {
    const [action, encoded] = process.argv.slice(2);
    const active = session.activeSession();
    const request = active?.repo === paths.repoSlug() ? path.join(active.sessionDir, 'request.json') : null;
    const input = action === 'open' ? { task: encoded } : encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) : request && fs.existsSync(request) ? JSON.parse(fs.readFileSync(request, 'utf8')) : {};
    const result = run(action, input);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) { process.stderr.write(err.message + '\n'); process.exitCode = 1; }
}
module.exports = { run };
