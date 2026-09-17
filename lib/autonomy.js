'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { git, snapshot, digest } = require('./git-state');
const { writeJsonAtomic } = require('./session');

const LINE_LIMIT = 300;
function read(dir, name) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
function eligibility(plan) {
  const scope = plan.autonomy;
  if (!scope || scope.wellScoped !== true || !Array.isArray(scope.openQuestions) || scope.openQuestions.length) return 'A well-scoped task with no open questions is required';
  if (!Number.isInteger(scope.estimatedImplementationLines) || scope.estimatedImplementationLines < 0 || scope.estimatedImplementationLines >= LINE_LIMIT) return `Estimated implementation changes must be fewer than ${LINE_LIMIT} lines`;
  if (typeof scope.ticketProvided !== 'boolean') return 'Record whether the user supplied a ticket';
  if (plan.tasks.some((task) => task.riskSignals?.architectureAmbiguity)) return 'Resolve architecture ambiguity before autonomous work';
  return null;
}
function changes(baseHead, cwd) {
  if (!/^[a-f0-9]{40,64}$/.test(baseHead || '')) throw new Error('Full autonomous base commit required');
  git(cwd, ['merge-base', '--is-ancestor', baseHead, 'HEAD']);
  return git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--numstat', '-z', baseHead, '--'])
    .split('\0').filter(Boolean).map((entry) => {
      const match = entry.match(/^([^\t]+)\t([^\t]+)\t([\s\S]+)$/);
      if (!match || !/^\d+$/.test(match[1]) || !/^\d+$/.test(match[2])) throw new Error('Binary or unmeasurable changes require human approval');
      return { file: match[3], changedLines: Number(match[1]) + Number(match[2]) };
    });
}
function measure(baseHead, files, cwd) {
  const actual = changes(baseHead, cwd);
  if (!Array.isArray(files) || files.length !== actual.length || new Set(files.map((entry) => entry?.file)).size !== files.length) throw new Error('Classify every changed file exactly once');
  let implementationLines = 0;
  for (const change of actual) {
    const entry = files.find((item) => item?.file === change.file);
    const counts = ['implementation', 'tests', 'comments', 'blank'].map((key) => entry?.[key]);
    if (counts.some((count) => !Number.isSafeInteger(count) || count < 0) || counts.reduce((a, b) => a + b, 0) !== change.changedLines) throw new Error(`Line classifications must account for the complete Git diff: ${change.file}`);
    if ((entry.tests || entry.comments || entry.blank) && (typeof entry.reason !== 'string' || !entry.reason.trim())) throw new Error(`Explain excluded lines: ${change.file}`);
    implementationLines += entry.implementation;
  }
  return { baseHead, implementationLines, files };
}
function recordScope(dir, files, cwd) {
  const approval = read(dir, 'checkpoint.json')?.approval;
  if (approval?.mode !== 'autonomous') throw new Error('An autonomous approval is required');
  const state = snapshot(cwd);
  if (state.dirtyFiles.length) throw new Error('Commit task changes before measuring autonomous scope');
  const report = { ...measure(approval.baseHead, files, cwd), fingerprint: state.fingerprint, planHash: approval.planHash };
  writeJsonAtomic(path.join(dir, 'scope.json'), report);
  return report;
}
function requireScope(dir, cwd, files) {
  const approval = read(dir, 'checkpoint.json')?.approval;
  if (approval?.mode !== 'autonomous') return null;
  const plan = read(dir, 'plan.json');
  if (approval.planHash !== digest(JSON.stringify(plan))) throw new Error('Autonomous scope changed; explicit plan approval required');
  const state = snapshot(cwd);
  if (state.branch !== approval.branch || state.worktree !== approval.worktree || state.dirtyFiles.length) throw new Error('Autonomous work requires the approved clean feature checkout');
  let report;
  if (files !== undefined) report = measure(approval.baseHead, files, cwd);
  else {
    const saved = read(dir, 'scope.json');
    if (saved?.fingerprint === state.fingerprint && saved.planHash === approval.planHash) report = measure(approval.baseHead, saved.files, cwd);
    else {
      const total = changes(approval.baseHead, cwd).reduce((sum, entry) => sum + entry.changedLines, 0);
      if (total >= LINE_LIMIT) throw new Error('Classify current scope before continuing; 300 or more implementation lines require human approval');
      report = { baseHead: approval.baseHead, implementationLines: total, upperBound: true };
    }
  }
  if (report.implementationLines >= LINE_LIMIT) throw new Error(`Autonomous scope reached ${report.implementationLines} implementation lines; explicit human approval required`);
  return report;
}
module.exports = { LINE_LIMIT, eligibility, changes, measure, recordScope, requireScope, read };
