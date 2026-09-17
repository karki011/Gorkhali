'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { snapshot, digest } = require('./git-state');
const { randomUUID } = require('node:crypto');
const { discoverChecks } = require('./checks');
const { writeJsonAtomic } = require('./session');
const reviewPolicy = require('../config/routing.json').review || {};
const autonomy = require('./autonomy');
function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function planHash(dir) {
  const plan = read(path.join(dir, 'plan.json'));
  return plan ? digest(JSON.stringify(plan)) : null;
}
function commentsPass(record) {
  const review = record?.comments;
  return review?.addedExplanatory === 0 && Array.isArray(review.exceptions) && review.exceptions.every((entry) =>
    ['license', 'tool-directive'].includes(entry?.kind) && typeof entry.file === 'string' && entry.file.trim() && typeof entry.reason === 'string' && entry.reason.trim());
}
function inspectorPass(record, state, cwd) {
  if (!record || record.role !== 'inspector' || record.verdict !== 'pass' || record.worktree_unchanged !== true ||
      record.fingerprint !== state.fingerprint || !Array.isArray(record.checks) || !commentsPass(record)) return false;
  return Object.entries(discoverChecks(cwd)).every(([name, expected]) => {
    const matches = record.checks.filter((check) => check.name === name);
    if (matches.length !== 1) return false;
    const check = matches[0];
    return expected.command ? check.command === expected.command && check.provenance === expected.provenance && check.result === 'checked_pass' : check.result === 'absent';
  });
}
function recordInspector(dir, record, cwd) {
  const state = snapshot(cwd);
  const value = { ...record, role: 'inspector', planHash: planHash(dir) };
  if (!value.planHash) throw new Error('Inspector requires the exact session directory containing plan.json');
  if (value.verdict === 'pass' && !inspectorPass(value, state, cwd)) throw new Error('Inspector pass lacks current complete evidence');
  if (value.verdict === 'pass' && read(path.join(dir, 'checkpoint.json'))?.approval?.mode === 'autonomous') {
    if (!Array.isArray(value.scopeFiles)) throw new Error('Inspector must independently classify autonomous diff lines');
    value.scope = autonomy.requireScope(dir, cwd, value.scopeFiles);
  }
  value.id = randomUUID();
  writeJsonAtomic(path.join(dir, 'inspector.json'), value);
  return value;
}
function requireInspector(dir, cwd) {
  const state = snapshot(cwd);
  const inspector = read(path.join(dir, 'inspector.json'));
  if (!planHash(dir) || !inspectorPass(inspector, state, cwd) || inspector.planHash !== planHash(dir)) throw new Error('Inspector evidence missing, failed, incomplete or stale');
  if (read(path.join(dir, 'checkpoint.json'))?.approval?.mode === 'autonomous') {
    if (!Array.isArray(inspector.scopeFiles)) throw new Error('Inspector must independently classify autonomous diff lines');
    autonomy.requireScope(dir, cwd, inspector.scopeFiles);
  }
  return inspector;
}
function recordAuditor(dir, record, cwd) {
  const inspector = requireInspector(dir, cwd);
  if (record.inspectorId !== inspector.id || record.fingerprint !== inspector.fingerprint) throw new Error('Auditor must review this Inspector evidence and state');
  if (record.verdict === 'pass' && inspector.scope && record.scopeReviewed !== true) throw new Error('Auditor must review autonomous line exclusions and scope');
  if (record.verdict === 'pass' && !commentsPass(record)) throw new Error('Auditor must confirm no added explanatory comments and identify required license/tool exceptions');
  if (record.verdict === 'pass' && (!Array.isArray(record.findings) || record.findings.some((finding) => finding.severity === 'blocking') ||
      typeof record.userVisible !== 'boolean' || !['independent-context', 'same-model-independent-context', 'different-model-independent-context'].includes(record.independence?.basis))) throw new Error('Auditor pass lacks review evidence');
  const value = { ...record, role: 'auditor', id: randomUUID() };
  writeJsonAtomic(path.join(dir, 'reviews', 'auditor.json'), value);
  return value;
}
// Pure so the required-policy case is a unit test, not a config mutation.
function auditorWaiver(checkpoint, latestAuditor, policy) {
  if (policy !== 'optional') return null;
  if (typeof checkpoint?.pr !== 'string' || !checkpoint.pr) return null;
  if (!latestAuditor || latestAuditor.verdict !== 'pass') return null;
  if (!Array.isArray(latestAuditor.findings) || latestAuditor.findings.some((item) => item.severity === 'blocking')) return null;
  return 'post-ship: last Auditor passed; external reviewers review each push';
}
function requireVerified(dir, cwd) {
  const inspector = requireInspector(dir, cwd);
  const auditor = read(path.join(dir, 'reviews', 'auditor.json'));
  if (auditor?.verdict === 'pass' && !commentsPass(auditor)) throw new Error('Current no-comment policy review required');
  const current = !!auditor && auditor.inspectorId === inspector.id && auditor.fingerprint === inspector.fingerprint;
  if (inspector.scope && (!current || auditor.scopeReviewed !== true)) throw new Error('Autonomous changes require a current independent scope review');
  const requireHuman = (record) => {
    if (!record.userVisible) return;
    const human = read(path.join(dir, 'human-confirmation.json'));
    if (!human?.confirmed || human.fingerprint !== inspector.fingerprint) throw new Error('Current explicit human visual confirmation required');
  };
  if (current) {
    if (auditor.role !== 'auditor' || auditor.verdict !== 'pass' || typeof auditor.userVisible !== 'boolean' ||
        !['independent-context', 'same-model-independent-context', 'different-model-independent-context'].includes(auditor.independence?.basis) ||
        !Array.isArray(auditor.findings) || auditor.findings.some((item) => item.severity === 'blocking')) {
      throw new Error('Auditor evidence missing, failed or stale');
    }
    requireHuman(auditor);
    return { inspector, auditor };
  }
  const checkpoint = read(path.join(dir, 'checkpoint.json'));
  const reason = auditorWaiver(checkpoint, auditor, reviewPolicy.postShipAuditor || 'required');
  if (!reason) throw new Error('Auditor evidence missing, failed or stale');
  requireHuman(auditor);
  return { inspector, auditor: null, auditorWaived: reason };
}
module.exports = { recordInspector, requireInspector, recordAuditor, requireVerified, auditorWaiver };
