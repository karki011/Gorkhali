#!/usr/bin/env node
// Author: Subash Karki
// Validates a Phantom JSON artifact against its canonical schema.
// Usage: validate-artifact.js <artifact-type> <file-path>
// Artifact types: context, intent, plan, execution, verification, wrap, pause-state
// Exit 0 = valid, Exit 1 = invalid (errors printed to stderr)

'use strict';

const fs = require('fs');
const path = require('path');

const [,, artifactType, filePath] = process.argv;

if (!artifactType || !filePath) {
  process.stderr.write('Usage: validate-artifact.js <artifact-type> <file-path>\n');
  process.stderr.write('Types: context intent plan execution verification wrap pause-state\n');
  process.exit(1);
}

const resolvedPath = filePath.replace(/^~/, process.env.HOME);

if (!fs.existsSync(resolvedPath)) {
  process.stderr.write(`ERROR: File not found: ${resolvedPath}\n`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
} catch (e) {
  process.stderr.write(`ERROR: Invalid JSON in ${resolvedPath}: ${e.message}\n`);
  process.exit(1);
}

const errors = [];

// --- _meta validation (required on every artifact) ---
function validateMeta(obj) {
  if (!obj._meta || typeof obj._meta !== 'object') {
    errors.push('_meta: required object missing');
    return;
  }
  const m = obj._meta;
  if (!m.writtenAt || typeof m.writtenAt !== 'string') errors.push('_meta.writtenAt: required string');
  if (!m.gitHead || typeof m.gitHead !== 'string') errors.push('_meta.gitHead: required string');
  if (!m.gitBranch || typeof m.gitBranch !== 'string') errors.push('_meta.gitBranch: required string');
  if (!m.phase || typeof m.phase !== 'string') errors.push('_meta.phase: required string');
  if (!m.skill || typeof m.skill !== 'string') errors.push('_meta.skill: required string');
  if (typeof m.version !== 'number') errors.push('_meta.version: required number');
}

// --- Schema validators per artifact type ---

const validators = {
  'context': (d) => {
    validateMeta(d);
    if (!d.ticket || typeof d.ticket !== 'string') errors.push('ticket: required string');
    if (!d.summary || typeof d.summary !== 'string') errors.push('summary: required string');
    const validSources = ['jira', 'args', 'branch'];
    if (!validSources.includes(d.source)) errors.push(`source: must be one of ${validSources.join('|')}, got "${d.source}"`);
    if (d.learningsRefs !== undefined && !Array.isArray(d.learningsRefs)) errors.push('learningsRefs: must be array if present');
    if (d.blastRadius !== undefined && !Array.isArray(d.blastRadius)) errors.push('blastRadius: must be array if present');
  },

  'intent': (d) => {
    validateMeta(d);
    if (!d.goal || typeof d.goal !== 'string') errors.push('goal: required string');
    if (!Array.isArray(d.doneWhen) || d.doneWhen.length === 0) errors.push('doneWhen: required non-empty array');
    if (!Array.isArray(d.priority) || d.priority.length === 0) errors.push('priority: required non-empty array');
    if (d.tradeoffs !== undefined && !Array.isArray(d.tradeoffs)) errors.push('tradeoffs: must be array if present');
    if (d.nonNegotiables !== undefined && !Array.isArray(d.nonNegotiables)) errors.push('nonNegotiables: must be array if present');
  },

  'plan': (d) => {
    validateMeta(d);
    const validRoutes = ['solo', 'shadows'];
    if (!validRoutes.includes(d.route)) errors.push(`route: must be one of ${validRoutes.join('|')}, got "${d.route}"`);
    const validVerdicts = ['PROCEED', 'REVISE', 'RETHINK'];
    if (!validVerdicts.includes(d.devilsAdvocateVerdict)) errors.push(`devilsAdvocateVerdict: must be one of ${validVerdicts.join('|')}, got "${d.devilsAdvocateVerdict}"`);
    if (!Array.isArray(d.tasks) || d.tasks.length === 0) errors.push('tasks: required non-empty array');
    if (Array.isArray(d.tasks)) {
      d.tasks.forEach((t, i) => {
        if (!t.id || typeof t.id !== 'string') errors.push(`tasks[${i}].id: required string`);
        if (!t.description || typeof t.description !== 'string') errors.push(`tasks[${i}].description: required string`);
        if (!Array.isArray(t.files)) errors.push(`tasks[${i}].files: required array`);
        if (t.dependsOn !== undefined && !Array.isArray(t.dependsOn)) errors.push(`tasks[${i}].dependsOn: must be array if present`);
      });
    }
    if (d.antiRepetition !== undefined && !Array.isArray(d.antiRepetition)) errors.push('antiRepetition: must be array if present');
  },

  'execution': (d) => {
    validateMeta(d);
    if (!Array.isArray(d.tasks) || d.tasks.length === 0) errors.push('tasks: required non-empty array');
    if (Array.isArray(d.tasks)) {
      const validStatuses = ['done', 'failed', 'skipped'];
      d.tasks.forEach((t, i) => {
        if (!t.id || typeof t.id !== 'string') errors.push(`tasks[${i}].id: required string`);
        if (!validStatuses.includes(t.status)) errors.push(`tasks[${i}].status: must be one of ${validStatuses.join('|')}, got "${t.status}"`);
        if (!Array.isArray(t.filesChanged)) errors.push(`tasks[${i}].filesChanged: required array`);
        if (!t.outputSummary || typeof t.outputSummary !== 'string') errors.push(`tasks[${i}].outputSummary: required string`);
        if (t.selfReviewScore !== undefined && (typeof t.selfReviewScore !== 'number' || t.selfReviewScore < 0 || t.selfReviewScore > 10)) {
          errors.push(`tasks[${i}].selfReviewScore: must be number 0-10 if present`);
        }
      });
    }
    if (typeof d.totalSpawns !== 'number') errors.push('totalSpawns: required number');
  },

  'verification': (d) => {
    validateMeta(d);
    if (!d.correctness || typeof d.correctness !== 'object') {
      errors.push('correctness: required object');
    } else {
      if (typeof d.correctness.lint !== 'boolean') errors.push('correctness.lint: required boolean');
      if (typeof d.correctness.build !== 'boolean') errors.push('correctness.build: required boolean');
      if (typeof d.correctness.tests !== 'boolean') errors.push('correctness.tests: required boolean');
      if (!Array.isArray(d.correctness.commands)) errors.push('correctness.commands: required array');
    }
    if (!d.review || typeof d.review !== 'object') {
      errors.push('review: required object');
    } else {
      if (typeof d.review.temperature !== 'number') errors.push('review.temperature: required number');
      if (!Array.isArray(d.review.findings)) errors.push('review.findings: required array');
      if (typeof d.review.fixLoops !== 'number') errors.push('review.fixLoops: required number');
    }
    if (typeof d.simplifyRan !== 'boolean') errors.push('simplifyRan: required boolean');
    const validAlignments = ['aligned', 'drift', 'wrong'];
    if (!validAlignments.includes(d.intentAlignment)) errors.push(`intentAlignment: must be one of ${validAlignments.join('|')}, got "${d.intentAlignment}"`);
    const validVerdicts = ['pass', 'fail'];
    if (!validVerdicts.includes(d.verdict)) errors.push(`verdict: must be one of ${validVerdicts.join('|')}, got "${d.verdict}"`);
    if (d.score !== undefined && (typeof d.score !== 'number' || d.score < 0 || d.score > 10)) {
      errors.push('score: must be number 0-10 if present');
    }
  },

  'wrap': (d) => {
    validateMeta(d);
    if (!('pr' in d)) errors.push('pr: required field (object or null)');
    if (d.pr !== null && typeof d.pr === 'object') {
      if (typeof d.pr.number !== 'number') errors.push('pr.number: required number');
      if (!d.pr.url || typeof d.pr.url !== 'string') errors.push('pr.url: required string');
      if (!d.pr.status || typeof d.pr.status !== 'string') errors.push('pr.status: required string');
    }
    if (d.jira !== undefined && d.jira !== null) {
      if (!d.jira.ticket || typeof d.jira.ticket !== 'string') errors.push('jira.ticket: required string if jira present');
      if (!d.jira.transition || typeof d.jira.transition !== 'string') errors.push('jira.transition: required string if jira present');
      if (typeof d.jira.commented !== 'boolean') errors.push('jira.commented: required boolean if jira present');
    }
    if (!d.learnings || typeof d.learnings !== 'object') {
      errors.push('learnings: required object');
    } else {
      if (!Array.isArray(d.learnings.recorded)) errors.push('learnings.recorded: required array');
      if (!Array.isArray(d.learnings.promoted)) errors.push('learnings.promoted: required array');
      if (!Array.isArray(d.learnings.pruned)) errors.push('learnings.pruned: required array');
    }
  },

  'pause-state': (d) => {
    validateMeta(d);
    if (!d.ticket || typeof d.ticket !== 'string') errors.push('ticket: required string');
    const validPhases = ['A', 'B', 'C', 'D'];
    if (!validPhases.includes(d.phase)) errors.push(`phase: must be one of ${validPhases.join('|')}, got "${d.phase}"`);
    if (d.status !== 'paused') errors.push(`status: must be "paused", got "${d.status}"`);
    if (!d.resumeNotes || typeof d.resumeNotes !== 'string') errors.push('resumeNotes: required string');
    if (d.route !== undefined && !['solo', 'shadows'].includes(d.route)) errors.push(`route: must be "solo" or "shadows" if present, got "${d.route}"`);
    if (d.verifyStatus !== undefined && !['pass', 'fail', null].includes(d.verifyStatus)) {
      errors.push(`verifyStatus: must be "pass", "fail", or null if present`);
    }
    if (d.contracts !== undefined && !Array.isArray(d.contracts)) errors.push('contracts: must be array if present');
    if (d.contractsCompleted !== undefined && !Array.isArray(d.contractsCompleted)) errors.push('contractsCompleted: must be array if present');
    if (d.contractsPending !== undefined && !Array.isArray(d.contractsPending)) errors.push('contractsPending: must be array if present');
  },
};

const knownTypes = Object.keys(validators);
if (!validators[artifactType]) {
  process.stderr.write(`ERROR: Unknown artifact type "${artifactType}". Known types: ${knownTypes.join(', ')}\n`);
  process.exit(1);
}

validators[artifactType](data);

if (errors.length > 0) {
  process.stderr.write(`INVALID ${artifactType} at ${resolvedPath}:\n`);
  errors.forEach(e => process.stderr.write(`  - ${e}\n`));
  process.exit(1);
}

process.stdout.write(`OK: ${artifactType} at ${resolvedPath} is valid (schema v${data._meta?.version ?? '?'})\n`);
process.exit(0);
