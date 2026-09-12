'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { snapshot, digest } = require('./git-state');
const { randomUUID } = require('node:crypto');
const { discoverChecks } = require('./checks');
const { writeJsonAtomic } = require('./session');
function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function planHash(dir) {
  const plan = read(path.join(dir, 'plan.json'));
  return plan ? digest(JSON.stringify(plan)) : null;
}
function inspectorPass(record, state, cwd) {
  if (!record || record.role !== 'inspector' || record.verdict !== 'pass' || record.worktree_unchanged !== true ||
      record.fingerprint !== state.fingerprint || !Array.isArray(record.checks)) return false;
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
  value.id = randomUUID();
  writeJsonAtomic(path.join(dir, 'inspector.json'), value);
  return value;
}
function requireInspector(dir, cwd) {
  const state = snapshot(cwd);
  const inspector = read(path.join(dir, 'inspector.json'));
  if (!planHash(dir) || !inspectorPass(inspector, state, cwd) || inspector.planHash !== planHash(dir)) throw new Error('Inspector evidence missing, failed, incomplete or stale');
  return inspector;
}
function recordAuditor(dir, record, cwd) {
  const inspector = requireInspector(dir, cwd);
  if (record.inspectorId !== inspector.id || record.fingerprint !== inspector.fingerprint) throw new Error('Auditor must review this Inspector evidence and state');
  if (record.verdict === 'pass' && (!Array.isArray(record.findings) || record.findings.some((finding) => finding.severity === 'blocking') ||
      typeof record.userVisible !== 'boolean' || !['independent-context', 'same-model-independent-context', 'different-model-independent-context'].includes(record.independence?.basis))) throw new Error('Auditor pass lacks review evidence');
  const value = { ...record, role: 'auditor', id: randomUUID() };
  writeJsonAtomic(path.join(dir, 'reviews', 'auditor.json'), value);
  return value;
}
function requireVerified(dir, cwd) {
  const inspector = requireInspector(dir, cwd);
  const auditor = read(path.join(dir, 'reviews', 'auditor.json'));
  if (!auditor || auditor.role !== 'auditor' || auditor.verdict !== 'pass' || auditor.inspectorId !== inspector.id || auditor.fingerprint !== inspector.fingerprint ||
      typeof auditor.userVisible !== 'boolean' || !['independent-context', 'same-model-independent-context', 'different-model-independent-context'].includes(auditor.independence?.basis) || !Array.isArray(auditor.findings) || auditor.findings.some((item) => item.severity === 'blocking')) {
    throw new Error('Auditor evidence missing, failed or stale');
  }
  if (auditor.userVisible) {
    const human = read(path.join(dir, 'human-confirmation.json'));
    if (!human?.confirmed || human.fingerprint !== inspector.fingerprint) throw new Error('Current explicit human visual confirmation required');
  }
  return { inspector, auditor };
}
module.exports = { recordInspector, requireInspector, recordAuditor, requireVerified };
