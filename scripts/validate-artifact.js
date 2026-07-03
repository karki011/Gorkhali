#!/usr/bin/env node
// Author: Subash Karki
// Validates a Phantom JSON artifact against its canonical schema, and is the
// single source of truth for the schema docs under reference/schemas/.
//
// Each entry in SCHEMAS carries two co-located halves:
//   - `fields`:   the full documented field catalog (rendered by
//                 scripts/gen-schema-docs.js; a superset of what is enforced).
//   - `validate`: the enforcement logic (a byte-identical move of the original
//                 per-type validators). Some documented fields are intentionally
//                 NOT enforced yet (e.g. intent.specDelta, wrap.brief) - see the
//                 CONTRACT NOTE below.
//
// Usage: validate-artifact.js <artifact-type> <file-path>
// Artifact types: context, intent, plan, execution, verification, wrap, pause-state
// Exit 0 = valid, Exit 1 = invalid (errors printed to stderr).
//
// CONTRACT NOTE (exit codes): this CLI returns 1 for EVERY failure, including an
// invalid artifact. That predates - and is inconsistent with - the shared
// VALIDATION_ERROR -> 2 taxonomy in scripts/lib/axi-error.js. The value is
// preserved at 1 on purpose: execution-schema.test.js locks it, and downstream
// callers key on it. Changing it is a breaking (major) change, not done here.

'use strict';

const fs = require('fs');
const path = require('path');
const { PhantomError, reportError } = require('./lib/axi-error');

// --- _meta validation (required on every artifact) ---
function validateMeta(obj, errors) {
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

// --- Schema definitions (data) + per-type validators (enforcement) ---
// `fields` order is the rendered table order. Cells are stored with raw `|`;
// the doc generator escapes them to `\|`.

const SCHEMAS = {
  context: {
    fields: [
      { field: 'ticket', type: 'string', required: 'yes', description: 'Ticket key or task label' },
      { field: 'summary', type: 'string', required: 'yes', description: 'Human-readable ticket summary' },
      { field: 'source', type: '`"jira"` | `"args"` | `"branch"`', required: 'yes', description: 'Where context was sourced from' },
      { field: 'jira', type: 'object | `null`', required: 'no', description: 'Raw Jira issue fields (if source=jira)' },
      { field: 'learningsRefs', type: 'string[]', required: 'no', description: 'Paths to relevant learning files' },
      { field: 'phantomStrategy', type: 'string', required: 'no', description: 'Strategy from phantom_orchestrator_process' },
      { field: 'blastRadius', type: 'string[]', required: 'no', description: 'Files flagged by phantom_graph_blast_radius' },
      { field: 'modelOverride', type: 'string | `null`', required: 'no', description: 'Force a specific model for spawns' },
    ],
    validate: (d, errors) => {
      validateMeta(d, errors);
      if (!d.ticket || typeof d.ticket !== 'string') errors.push('ticket: required string');
      if (!d.summary || typeof d.summary !== 'string') errors.push('summary: required string');
      const validSources = ['jira', 'args', 'branch'];
      if (!validSources.includes(d.source)) errors.push(`source: must be one of ${validSources.join('|')}, got "${d.source}"`);
      if (d.learningsRefs !== undefined && !Array.isArray(d.learningsRefs)) errors.push('learningsRefs: must be array if present');
      if (d.blastRadius !== undefined && !Array.isArray(d.blastRadius)) errors.push('blastRadius: must be array if present');
    },
  },

  intent: {
    fields: [
      { field: 'goal', type: 'string', required: 'yes', description: 'Single clear goal statement' },
      { field: 'doneWhen', type: 'string[]', required: 'yes', description: 'Acceptance criteria (observable, testable)' },
      { field: 'priority', type: 'string[]', required: 'yes', description: 'Ordered implementation priorities' },
      { field: 'tradeoffs', type: 'string[]', required: 'no', description: 'Acknowledged tradeoffs' },
      { field: 'nonNegotiables', type: 'string[]', required: 'no', description: 'Hard constraints that must not be violated' },
      { field: 'specDelta', type: 'string', required: 'yes', description: 'What changed from original requirements — or `"none"` if first pass' },
    ],
    validate: (d, errors) => {
      validateMeta(d, errors);
      if (!d.goal || typeof d.goal !== 'string') errors.push('goal: required string');
      if (!Array.isArray(d.doneWhen) || d.doneWhen.length === 0) errors.push('doneWhen: required non-empty array');
      if (!Array.isArray(d.priority) || d.priority.length === 0) errors.push('priority: required non-empty array');
      if (d.tradeoffs !== undefined && !Array.isArray(d.tradeoffs)) errors.push('tradeoffs: must be array if present');
      if (d.nonNegotiables !== undefined && !Array.isArray(d.nonNegotiables)) errors.push('nonNegotiables: must be array if present');
    },
  },

  plan: {
    fields: [
      { field: 'route', type: '`"solo"` | `"shadows"`', required: 'yes', description: 'Whether to spawn agents or work inline' },
      { field: 'devilsAdvocateVerdict', type: '`"PROCEED"` | `"REVISE"` | `"RETHINK"`', required: 'yes', description: 'Grill gate outcome' },
      { field: 'tasks', type: 'object[]', required: 'yes', description: 'Ordered list of task objects' },
      { field: 'tasks[].id', type: 'string', required: 'yes', description: 'Unique task ID' },
      { field: 'tasks[].description', type: 'string', required: 'yes', description: 'What this task does' },
      { field: 'tasks[].files', type: 'string[]', required: 'yes', description: 'Files expected to be touched' },
      { field: 'tasks[].dependsOn', type: 'string[]', required: 'no', description: 'Task IDs this task must wait for' },
      { field: 'tasks[].agent', type: 'string', required: 'no', description: 'Agent role for shadows route' },
      { field: 'antiRepetition', type: 'string[]', required: 'no', description: 'Patterns to avoid (from learnings)' },
      { field: 'estimatedSpawns', type: 'number', required: 'no', description: 'Expected agent count for shadows route' },
    ],
    validate: (d, errors) => {
      validateMeta(d, errors);
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
  },

  execution: {
    fields: [
      { field: 'tasks', type: 'object[]', required: 'yes', description: 'Per-task execution results' },
      { field: 'tasks[].id', type: 'string', required: 'yes', description: 'Task ID from plan.json' },
      { field: 'tasks[].status', type: '`"done"` | `"failed"` | `"skipped"`', required: 'yes', description: 'Final task status' },
      { field: 'tasks[].agent', type: 'string', required: 'no', description: 'Agent that ran this task' },
      { field: 'tasks[].filesChanged', type: 'string[]', required: 'yes', description: 'Files actually modified' },
      { field: 'tasks[].filesRead', type: 'string[]', required: 'no', description: 'Files read but NOT changed (wave-handoff awareness)' },
      { field: 'tasks[].selfReviewScore', type: 'number', required: 'no', description: 'Agent\'s self-review score (0-10)' },
      { field: 'tasks[].testResult', type: 'object | string', required: 'no', description: '`{ passed: bool, summary?: string }` or a short string' },
      { field: 'tasks[].blocker', type: 'string | null', required: 'no', description: 'Blocker description; null/absent when none' },
      { field: 'tasks[].wave', type: 'object', required: 'no', description: 'Wave membership `{ index, isLastInWave }` — drives the wake classifier\'s last-in-wave surface' },
      { field: 'tasks[].drift', type: 'boolean', required: 'no', description: 'True when output drifted from stated intent; drives an actionable wake' },
      { field: 'tasks[].outputSummary', type: 'string', required: 'yes', description: '1-2 sentence summary of what was done' },
      { field: 'totalSpawns', type: 'number', required: 'yes', description: 'Total agent instances spawned' },
      { field: 'agentOutputs', type: 'string', required: 'no', description: 'Path to raw agent output logs' },
    ],
    validate: (d, errors) => {
      validateMeta(d, errors);
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
          if (t.filesRead !== undefined && !Array.isArray(t.filesRead)) {
            errors.push(`tasks[${i}].filesRead: must be array if present`);
          }
          if (t.testResult !== undefined && typeof t.testResult !== 'object' && typeof t.testResult !== 'string') {
            errors.push(`tasks[${i}].testResult: must be object or string if present`);
          }
          if (t.testResult !== undefined && t.testResult !== null && typeof t.testResult === 'object') {
            if (typeof t.testResult.passed !== 'boolean') errors.push(`tasks[${i}].testResult.passed: required boolean when testResult is object`);
            if (t.testResult.summary !== undefined && typeof t.testResult.summary !== 'string') errors.push(`tasks[${i}].testResult.summary: must be string if present`);
          }
          if (t.blocker !== undefined && t.blocker !== null && typeof t.blocker !== 'string') {
            errors.push(`tasks[${i}].blocker: must be string or null if present`);
          }
        });
      }
      if (typeof d.totalSpawns !== 'number') errors.push('totalSpawns: required number');
    },
  },

  verification: {
    fields: [
      { field: 'correctness', type: 'object', required: 'yes', description: 'Mechanical checks (lint, build, tests)' },
      { field: 'correctness.lint', type: 'boolean', required: 'yes', description: 'Lint passed' },
      { field: 'correctness.build', type: 'boolean', required: 'yes', description: 'Build passed' },
      { field: 'correctness.tests', type: 'boolean', required: 'yes', description: 'Tests passed' },
      { field: 'correctness.commands', type: 'string[]', required: 'yes', description: 'Commands actually run' },
      { field: 'correctness.observations', type: 'object', required: 'yes', description: 'Per-check observation confidence' },
      { field: 'correctness.observations.lint', type: '`"checked:pass"` | `"checked:fail"` | `"not_observed"`', required: 'yes', description: 'Lint check status' },
      { field: 'correctness.observations.build', type: '`"checked:pass"` | `"checked:fail"` | `"not_observed"`', required: 'yes', description: 'Build check status' },
      { field: 'correctness.observations.tests', type: '`"checked:pass"` | `"checked:fail"` | `"not_observed"`', required: 'yes', description: 'Test check status' },
      { field: 'review', type: 'object', required: 'yes', description: 'Self-review results' },
      { field: 'review.temperature', type: 'number', required: 'yes', description: 'Reviewer strictness (0-1)' },
      { field: 'review.findings', type: 'object[]', required: 'yes', description: 'Array of finding objects' },
      { field: 'review.fixLoops', type: 'number', required: 'yes', description: 'How many fix/re-verify loops ran. Counter owned by `hooks/loop-controller.js`; capped at the fix-loop ceiling (canonical: `reference/temperature-review.md`, currently 2) unless a logged operator override extended it' },
      { field: 'simplifyRan', type: 'boolean', required: 'yes', description: 'Whether simplify was run on changed files' },
      { field: 'intentAlignment', type: '`"aligned"` | `"drift"` | `"wrong"`', required: 'yes', description: 'How well output matches intent.json' },
      { field: 'visualVerification', type: 'object | `null`', required: 'no', description: 'Lens browser-agent result; present only when UI files changed (else absent/null). Written by `phantom:visual`, read by the verdict' },
      { field: 'visualVerification.status', type: '`"pass"` | `"partial"` | `"skipped"`', required: 'no', description: '`partial` = unresolved after the ≤3 visual fix-loop ceiling; `skipped` = no UI change or `agent-browser` unavailable' },
      { field: 'visualVerification.routes', type: 'string[]', required: 'no', description: 'Routes Lens inspected' },
      { field: 'visualVerification.fixLoops', type: 'number', required: 'no', description: 'Visual fix-loop iterations run (≤3)' },
      { field: 'visualVerification.skipReason', type: 'string', required: 'no', description: 'Present when status is `skipped`' },
      { field: 'verdict', type: '`"pass"` | `"fail"`', required: 'yes', description: 'Overall gate result' },
      { field: 'score', type: 'number (0-10)', required: 'no', description: 'Numeric quality score' },
    ],
    validate: (d, errors) => {
      validateMeta(d, errors);
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
  },

  wrap: {
    fields: [
      { field: 'brief', type: 'string', required: 'yes', description: '3-6 sentence plain-language recap of the whole session: goal, what changed, notable decisions/corrections, outcome + open follow-ups. Rendered above the SESSION WRAPPED box.' },
      { field: 'pr', type: 'object | `null`', required: 'yes', description: 'PR details, or null if no PR' },
      { field: 'pr.number', type: 'number', required: 'yes', description: 'PR number' },
      { field: 'pr.url', type: 'string', required: 'yes', description: 'PR URL' },
      { field: 'pr.status', type: 'string', required: 'yes', description: 'PR status: `"draft"` (wrap ALWAYS creates draft PRs — see `reference/wrap/ship-ceremony.md` §4), `"open"`, `"merged"`, `"closed"`. The Stop-hook gate (`hooks/greploop-gate.js`) gates on PR *liveness* — it blocks any PR that is NOT `merged`/`closed` (matched case-insensitively), so a draft labeled `"draft"` OR `"open"` is still gated until greploop settles.' },
      { field: 'jira', type: 'object | `null`', required: 'no', description: 'Jira update result' },
      { field: 'jira.ticket', type: 'string', required: 'yes (if present)', description: 'Ticket key' },
      { field: 'jira.transition', type: 'string', required: 'yes (if present)', description: 'Transition applied' },
      { field: 'jira.commented', type: 'boolean', required: 'yes (if present)', description: 'Whether comment was posted' },
      { field: 'greptile', type: 'object | `null`', required: 'no', description: 'Greptile review result' },
      { field: 'greptile.requested', type: 'boolean', required: 'yes (if present)', description: 'Whether review was requested' },
      { field: 'greptile.status', type: 'string', required: 'yes (if present)', description: 'Canonical values greploop writes: `"done"` (completed, 5/5) and `"skipped"` (Greptile unavailable on the repo) — greploop is the sole writer of these. `"pending"` (or missing) = loop not yet run → the Stop-hook gate `hooks/greploop-gate.js` blocks the session at end while a live PR sits here. The gate matches **case-insensitively by PREFIX**, so freeform suffixes are tolerated as settled (e.g. `"skipped — availability guard (Greptile not installed on this repo)"`, `"done — 5/5"`); only `"pending…"`/`"requested"`/empty/missing block. Bias is to ALLOW on unknown values.' },
      { field: 'learnings', type: 'object', required: 'yes', description: 'Learning record actions' },
      { field: 'learnings.recorded', type: 'string[]', required: 'yes', description: 'Learnings written this session' },
      { field: 'learnings.promoted', type: 'string[]', required: 'yes', description: 'Learnings promoted to validated' },
      { field: 'learnings.pruned', type: 'string[]', required: 'yes', description: 'Stale learnings removed' },
    ],
    validate: (d, errors) => {
      validateMeta(d, errors);
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
  },

  'pause-state': {
    fields: [
      { field: 'ticket', type: 'string', required: 'yes', description: 'Jira ticket key or task ID' },
      { field: 'phase', type: 'string (`A`/`B`/`C`/`D`)', required: 'yes', description: 'Phase where work was paused' },
      { field: 'phaseStep', type: 'string', required: 'no', description: 'Sub-step within the phase' },
      { field: 'status', type: '`"paused"`', required: 'yes', description: 'Always `"paused"`' },
      { field: 'intent', type: 'string', required: 'no', description: 'File path to `intent.json`' },
      { field: 'plan', type: 'string', required: 'no', description: 'File path to `plan.json`' },
      { field: 'contracts', type: 'string[]', required: 'no', description: 'File paths to contract files' },
      { field: 'contractsCompleted', type: 'string[]', required: 'no', description: 'Contract IDs already fulfilled' },
      { field: 'contractsPending', type: 'string[]', required: 'no', description: 'Contract IDs still pending' },
      { field: 'route', type: '`"solo"` | `"shadows"`', required: 'no', description: 'Execution route chosen in phase B' },
      { field: 'verifyStatus', type: '`"pass"` | `"fail"` | `null`', required: 'no', description: 'Result of last verify run' },
      { field: 'resumeNotes', type: 'string', required: 'yes', description: 'Human-readable context for resume' },
    ],
    validate: (d, errors) => {
      validateMeta(d, errors);
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
  },
};

/** Validate `data` against the named artifact type. Returns an array of error strings (empty = valid). */
function validate(type, data) {
  const errors = [];
  const schema = SCHEMAS[type];
  if (schema) schema.validate(data, errors);
  return errors;
}

function main(argv) {
  const artifactType = argv[2];
  const filePath = argv[3];

  if (!artifactType || !filePath) {
    throw new PhantomError(
      'Usage: validate-artifact.js <artifact-type> <file-path>\n' +
        'Types: context intent plan execution verification wrap pause-state',
      'USAGE'
    );
  }

  const resolvedPath = filePath.replace(/^~/, process.env.HOME);

  if (!fs.existsSync(resolvedPath)) {
    throw new PhantomError(`ERROR: File not found: ${resolvedPath}`, 'IO_ERROR');
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (e) {
    throw new PhantomError(`ERROR: Invalid JSON in ${resolvedPath}: ${e.message}`, 'PARSE_ERROR');
  }

  if (!SCHEMAS[artifactType]) {
    const knownTypes = Object.keys(SCHEMAS);
    throw new PhantomError(
      `ERROR: Unknown artifact type "${artifactType}". Known types: ${knownTypes.join(', ')}`,
      'USAGE'
    );
  }

  const errors = validate(artifactType, data);

  if (errors.length > 0) {
    // Stays exit 1 by contract (see header CONTRACT NOTE) - not the 2 the shared
    // taxonomy would assign a validation failure.
    process.stderr.write(`INVALID ${artifactType} at ${resolvedPath}:\n`);
    errors.forEach((e) => process.stderr.write(`  - ${e}\n`));
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`OK: ${artifactType} at ${resolvedPath} is valid (schema v${data._meta?.version ?? '?'})\n`);
}

module.exports = { SCHEMAS, validate, validateMeta, main };

if (require.main === module) {
  try {
    main(process.argv);
  } catch (err) {
    reportError(err);
  }
}
