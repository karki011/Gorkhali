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
// Artifact types: context, intent, brainstorm, decisions, plan, execution, verification, wrap, pause-state
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

const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const hasUnresolvedPlaceholder = (value) =>
  typeof value === 'string' && /(\{[A-Z][A-Z0-9_]*\}|\bTODO\b|\bTBD\b)/i.test(value);

function requireArray(obj, field, errors, { nonEmpty = false, label = field } = {}) {
  const value = obj[field];
  if (!Array.isArray(value)) {
    errors.push(`${label}: required array (schema v3+)`);
    return [];
  }
  if (nonEmpty && value.length === 0) errors.push(`${label}: required non-empty array (schema v3+)`);
  return value;
}

function validatePlanTaskGraph(tasks, errors) {
  const ids = new Set();
  for (const [i, task] of tasks.entries()) {
    if (!isObject(task)) continue;
    if (!isNonEmptyString(task.id)) continue;
    if (ids.has(task.id)) errors.push(`tasks[${i}].id: duplicate task id "${task.id}"`);
    ids.add(task.id);
  }
  for (const [i, task] of tasks.entries()) {
    if (!isObject(task)) continue;
    if (!Array.isArray(task.dependsOn)) continue;
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) errors.push(`tasks[${i}].dependsOn: task cannot depend on itself`);
      else if (!ids.has(dependency)) errors.push(`tasks[${i}].dependsOn: unknown task id "${dependency}"`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(
    tasks.filter((task) => isObject(task) && isNonEmptyString(task.id)).map((task) => [task.id, task]),
  );
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const task = byId.get(id);
    for (const dependency of task && Array.isArray(task.dependsOn) ? task.dependsOn : []) {
      if (byId.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of byId.keys()) {
    if (visit(id)) {
      errors.push('tasks[].dependsOn: dependency cycle detected');
      break;
    }
  }
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
      { field: 'problem', type: 'string', required: 'no', description: 'The pain statement being solved — leads the goal in the plan review' },
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
      if (d.problem !== undefined && typeof d.problem !== 'string') errors.push('problem: must be string if present');
    },
  },

  brainstorm: {
    fields: [
      { field: 'decision', type: 'object', required: '_meta.version >= 3: yes; older: no', description: 'Decision frame shown before approaches' },
      { field: 'decision.question', type: 'string', required: '_meta.version >= 3: yes; older: no', description: 'The choice the user is being asked to make' },
      { field: 'decision.outcome', type: 'string', required: '_meta.version >= 3: yes; older: no', description: 'Desired observable outcome' },
      { field: 'decision.constraints', type: 'string[]', required: '_meta.version >= 3: yes; older: no', description: 'Hard boundaries every approach must satisfy' },
      { field: 'decision.evaluationCriteria', type: 'string[]', required: '_meta.version >= 3: yes; older: no', description: 'Criteria fixed before candidate evaluation' },
      { field: 'evidence', type: 'object[]', required: '_meta.version >= 3: yes; older: no', description: 'Claims and sources gathered before divergence' },
      { field: 'openQuestions', type: 'object[]', required: '_meta.version >= 3: yes; older: no', description: 'Unresolved questions, including whether each blocks the decision' },
      { field: 'approaches', type: 'object[]', required: 'yes', description: 'Candidate approach cards from the diverge phase' },
      { field: 'approaches[].id', type: 'string', required: 'yes', description: 'Stable slug identifying this approach' },
      { field: 'approaches[].name', type: 'string', required: 'yes', description: 'Short approach label' },
      { field: 'approaches[].thesis', type: 'string', required: 'yes', description: 'One-sentence core argument for this approach' },
      { field: 'approaches[].description', type: 'string', required: 'yes', description: 'Fuller explanation of the approach' },
      { field: 'approaches[].whyLens', type: 'string', required: 'yes', description: 'Generating lens (e.g. `simplest`, `robust`, `reuse`) or reasoning behind proposing this shape' },
      { field: 'approaches[].effort', type: 'string', required: 'yes', description: 'Relative implementation effort (e.g. `low`/`medium`/`high`)' },
      { field: 'approaches[].risk', type: 'string', required: 'yes', description: 'Relative risk level (e.g. `low`/`medium`/`high`)' },
      { field: 'approaches[].reversibility', type: 'string', required: 'yes', description: 'How easily this choice can be undone later' },
      { field: 'approaches[].whatBreaks', type: 'string[]', required: 'yes', description: 'Things that would need rework if this approach is chosen' },
      { field: 'approaches[].whenToPick', type: 'string', required: 'yes', description: 'Guidance on when this approach is the right call' },
      { field: 'approaches[].mutualExclusivity', type: 'string[]', required: 'no', description: 'IDs of other approaches this one cannot be combined with' },
      { field: 'approaches[].visualType', type: '`"diagram"` | `"flow"` | `"sitemap"` | `"mockup"` | `null`', required: 'no', description: 'Kind of visual artifact best suited to convey this approach, if any' },
      { field: 'recommendedDefault', type: 'object', required: 'yes', description: 'The coordinator\'s or Chairman\'s recommended pick' },
      { field: 'recommendedDefault.id', type: 'string', required: 'yes', description: 'Must match one of `approaches[].id`' },
      { field: 'recommendedDefault.reason', type: 'string', required: 'yes', description: 'Why this approach is recommended' },
      { field: 'cheapestExperiment', type: 'object', required: '_meta.version >= 3: yes; older: no', description: 'Lowest-cost experiment that can resolve material uncertainty' },
      { field: 'directionGate', type: 'object', required: '_meta.version >= 3: yes; older: no', description: 'Explicit user choice prompt and valid approach IDs' },
    ],
    validate: (d, errors) => {
      validateMeta(d, errors);
      const brainstormVersion = d._meta && typeof d._meta.version === 'number' ? d._meta.version : 1;
      const validVisualTypes = ['diagram', 'flow', 'sitemap', 'mockup', null];
      const ids = [];
      if (!Array.isArray(d.approaches) || d.approaches.length === 0) {
        errors.push('approaches: required non-empty array');
      } else {
        d.approaches.forEach((a, i) => {
          if (!isObject(a)) {
            errors.push(`approaches[${i}]: required object`);
            return;
          }
          if (!a.id || typeof a.id !== 'string') errors.push(`approaches[${i}].id: required string`);
          else ids.push(a.id);
          if (!a.name || typeof a.name !== 'string') errors.push(`approaches[${i}].name: required string`);
          if (!a.thesis || typeof a.thesis !== 'string') errors.push(`approaches[${i}].thesis: required string`);
          if (!a.description || typeof a.description !== 'string') errors.push(`approaches[${i}].description: required string`);
          if (!a.whyLens || typeof a.whyLens !== 'string') errors.push(`approaches[${i}].whyLens: required string`);
          if (!a.effort || typeof a.effort !== 'string') errors.push(`approaches[${i}].effort: required string`);
          if (!a.risk || typeof a.risk !== 'string') errors.push(`approaches[${i}].risk: required string`);
          if (!a.reversibility || typeof a.reversibility !== 'string') errors.push(`approaches[${i}].reversibility: required string`);
          if (!Array.isArray(a.whatBreaks) || a.whatBreaks.length === 0) errors.push(`approaches[${i}].whatBreaks: required non-empty array`);
          if (!a.whenToPick || typeof a.whenToPick !== 'string') errors.push(`approaches[${i}].whenToPick: required string`);
          if (a.mutualExclusivity !== undefined && !Array.isArray(a.mutualExclusivity)) {
            errors.push(`approaches[${i}].mutualExclusivity: must be array if present`);
          }
          if (a.visualType !== undefined && !validVisualTypes.includes(a.visualType)) {
            errors.push(`approaches[${i}].visualType: must be one of ${validVisualTypes.filter(Boolean).join('|')} or null, got "${a.visualType}"`);
          }
        });
      }
      if (!d.recommendedDefault || typeof d.recommendedDefault !== 'object') {
        errors.push('recommendedDefault: required object');
      } else {
        if (!d.recommendedDefault.id || typeof d.recommendedDefault.id !== 'string') {
          errors.push('recommendedDefault.id: required string');
        } else if (ids.length > 0 && !ids.includes(d.recommendedDefault.id)) {
          errors.push(`recommendedDefault.id: "${d.recommendedDefault.id}" does not match any approaches[].id`);
        }
        if (!d.recommendedDefault.reason || typeof d.recommendedDefault.reason !== 'string') {
          errors.push('recommendedDefault.reason: required string');
        }
      }
      if (brainstormVersion >= 3) {
        if (!isObject(d.decision)) errors.push('decision: required object (schema v3+)');
        else {
          if (!isNonEmptyString(d.decision.question)) errors.push('decision.question: required string (schema v3+)');
          if (!isNonEmptyString(d.decision.outcome)) errors.push('decision.outcome: required string (schema v3+)');
          if (!Array.isArray(d.decision.constraints)) errors.push('decision.constraints: required array (schema v3+)');
          if (!Array.isArray(d.decision.evaluationCriteria) || d.decision.evaluationCriteria.length === 0) {
            errors.push('decision.evaluationCriteria: required non-empty array (schema v3+)');
          }
        }
        const evidence = requireArray(d, 'evidence', errors, { nonEmpty: true });
        const evidenceStates = ['verified', 'supported', 'inferred', 'unknown'];
        evidence.forEach((item, i) => {
          if (!isObject(item) || !isNonEmptyString(item.claim) || !isNonEmptyString(item.source)) {
            errors.push(`evidence[${i}]: claim and source are required strings (schema v3+)`);
          }
          if (!isObject(item) || !evidenceStates.includes(item.status)) {
            errors.push(`evidence[${i}].status: must be ${evidenceStates.join('|')} (schema v3+)`);
          }
        });
        requireArray(d, 'openQuestions', errors);
        if (!Array.isArray(d.approaches) || d.approaches.length < 2 || d.approaches.length > 3) {
          errors.push('approaches: schema v3 requires 2-3 approaches');
        }
        const uniqueIds = new Set(ids);
        if (uniqueIds.size !== ids.length) errors.push('approaches[].id: duplicate approach id');
        if (Array.isArray(d.approaches)) {
          d.approaches.forEach((approach, i) => {
            if (!isObject(approach) || !Array.isArray(approach.mutualExclusivity)) return;
            for (const excluded of approach.mutualExclusivity) {
              if (excluded === approach.id) {
                errors.push(`approaches[${i}].mutualExclusivity: approach cannot exclude itself`);
              } else if (!ids.includes(excluded)) {
                errors.push(`approaches[${i}].mutualExclusivity: unknown approach id "${excluded}"`);
              }
            }
          });
        }
        if (!isObject(d.cheapestExperiment)) errors.push('cheapestExperiment: required object (schema v3+)');
        else if (d.cheapestExperiment.status === 'not-applicable') {
          if (!isNonEmptyString(d.cheapestExperiment.reason)) {
            errors.push('cheapestExperiment.reason: required when status is not-applicable (schema v3+)');
          }
        } else {
          for (const field of ['question', 'method', 'successSignal', 'cost']) {
            if (!isNonEmptyString(d.cheapestExperiment[field])) {
              errors.push(`cheapestExperiment.${field}: required string (schema v3+)`);
            }
          }
        }
        if (!isObject(d.directionGate)) errors.push('directionGate: required object (schema v3+)');
        else {
          if (!isNonEmptyString(d.directionGate.question)) {
            errors.push('directionGate.question: required string (schema v3+)');
          }
          if (!Array.isArray(d.directionGate.options) || d.directionGate.options.length === 0) {
            errors.push('directionGate.options: required non-empty array (schema v3+)');
          } else {
            for (const option of d.directionGate.options) {
              if (!ids.includes(option)) errors.push(`directionGate.options: unknown approach id "${option}"`);
            }
          }
        }
      }
    },
  },

  decisions: {
    fields: [
      { field: 'decisions', type: 'object[]', required: 'yes', description: 'Array of decision records (a `{ decisions: [] }` wrapper around the same array is also accepted)' },
      { field: 'decisions[].id', type: 'string', required: 'yes', description: 'Stable slug, e.g. `decision-001-state-management`' },
      { field: 'decisions[].decision', type: 'string', required: 'yes', description: 'What was decided' },
      { field: 'decisions[].status', type: 'string', required: 'yes', description: 'Decision lifecycle state, e.g. `"locked"`' },
      { field: 'decisions[].rationale', type: 'string', required: 'yes', description: 'Why this decision was made' },
      { field: 'decisions[].alternatives', type: 'string[]', required: 'yes', description: 'Alternatives considered and ruled out' },
      { field: 'councilUsed', type: 'boolean', required: 'no', description: 'Whether brainstorm Council Mode ran (see reference/brainstorm.md)' },
      { field: 'peerRankings', type: 'object[]', required: 'no', description: 'Aggregate rank per anonymized approach, present when councilUsed' },
      { field: 'chairmanRationale', type: 'string', required: 'no', description: 'Chairman synthesis rationale, present when councilUsed' },
    ],
    validate: (d, errors) => {
      validateMeta(d, errors);
      let entries = d.decisions;
      if (!Array.isArray(entries) && entries && Array.isArray(entries.decisions)) {
        entries = entries.decisions;
      }
      const idPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
      if (!Array.isArray(entries) || entries.length === 0) {
        errors.push('decisions: required non-empty array (or a `{ decisions: [] }` wrapper)');
      } else {
        entries.forEach((e, i) => {
          if (!e.id || typeof e.id !== 'string' || !idPattern.test(e.id)) {
            errors.push(`decisions[${i}].id: required stable slug string (e.g. "decision-001-name"), got ${JSON.stringify(e.id)}`);
          }
          if (!e.decision || typeof e.decision !== 'string') errors.push(`decisions[${i}].decision: required string`);
          if (!e.status || typeof e.status !== 'string') errors.push(`decisions[${i}].status: required string`);
          if (!e.rationale || typeof e.rationale !== 'string') errors.push(`decisions[${i}].rationale: required string`);
          if (!Array.isArray(e.alternatives)) errors.push(`decisions[${i}].alternatives: required array`);
        });
      }
      if (d.councilUsed !== undefined && typeof d.councilUsed !== 'boolean') errors.push('councilUsed: must be boolean if present');
      if (d.peerRankings !== undefined && !Array.isArray(d.peerRankings)) errors.push('peerRankings: must be array if present');
      if (d.chairmanRationale !== undefined && typeof d.chairmanRationale !== 'string') errors.push('chairmanRationale: must be string if present');
    },
  },

  plan: {
    fields: [
      { field: 'depth', type: '`"quick"` | `"standard"` | `"deep"`', required: '_meta.version >= 3: yes; older: no', description: 'Adaptive planning depth; controls optional architecture and research breadth' },
      { field: 'problem', type: 'string', required: '_meta.version >= 3: yes; older: no', description: 'Problem the plan resolves' },
      { field: 'decision', type: 'object', required: '_meta.version >= 3: yes; older: no', description: 'Recommendation and approval question shown first' },
      { field: 'decision.question', type: 'string', required: '_meta.version >= 3: yes; older: no', description: 'What the user is approving' },
      { field: 'decision.recommendation', type: 'string', required: '_meta.version >= 3: yes; older: no', description: 'Recommended direction in one sentence' },
      { field: 'decision.rationale', type: 'string[]', required: '_meta.version >= 3: yes; older: no', description: 'Evidence-backed reasons for the recommendation' },
      { field: 'decision.status', type: '`"pending"` | `"delegated"`', required: '_meta.version >= 3: yes; older: no', description: 'Approval state; the model never marks its own plan approved' },
      { field: 'outcome', type: 'object', required: '_meta.version >= 3: yes; older: no', description: 'Goal and observable definition of done' },
      { field: 'scope', type: 'object', required: '_meta.version >= 3: yes; older: no', description: 'In-scope, out-of-scope, and constraints' },
      { field: 'solution_shape', type: 'object', required: 'v3 standard/deep: yes; v3 quick and older: no', description: 'Architecture summary, components, and data flow' },
      { field: 'evidence', type: 'object[]', required: '_meta.version >= 3: yes; older: no', description: 'Claims, sources, and evidence states' },
      { field: 'alternatives', type: 'object[]', required: '_meta.version >= 3: array; standard/deep non-empty', description: 'Considered alternatives and why they were not selected' },
      { field: 'assumptions', type: 'object[]', required: '_meta.version >= 3: yes; older: no', description: 'Explicit assumptions rather than hidden guesses' },
      { field: 'open_questions', type: 'object[]', required: '_meta.version >= 3: yes; older: no', description: 'Unresolved questions and whether they block execution' },
      { field: 'risks', type: 'object[]', required: '_meta.version >= 3: yes; older: no', description: 'Risks, mitigations, reversibility, and recovery' },
      { field: 'validation', type: 'object', required: '_meta.version >= 3: yes; older: no', description: 'Validation strategy, checks, and definition of done' },
      { field: 'route', type: '`"solo"` | `"shadows"`', required: 'yes', description: 'Whether to spawn agents or work inline' },
      { field: 'devilsAdvocateVerdict', type: '`"PROCEED"` | `"REVISE"` | `"RETHINK"`', required: 'yes', description: 'Grill gate outcome' },
      { field: 'tasks', type: 'object[]', required: 'yes', description: 'Ordered list of task objects' },
      { field: 'tasks[].id', type: 'string', required: 'yes', description: 'Unique task ID' },
      { field: 'tasks[].description', type: 'string', required: 'yes', description: 'What this task does' },
      { field: 'tasks[].files', type: 'string[]', required: 'yes', description: 'Files expected to be touched' },
      { field: 'tasks[].acceptance_criteria', type: 'string[]', required: '_meta.version >= 2: yes; v1: no', description: 'Shell commands or observable facts Ward checks; each item a command/fact, never prose' },
      { field: 'tasks[].verify', type: 'string', required: '_meta.version >= 2: yes; v1: no', description: 'Single command that exits 0 on success; must be runnable by Ward' },
      { field: 'tasks[].dependsOn', type: 'string[]', required: 'no', description: 'Task IDs this task must wait for' },
      { field: 'tasks[].agent', type: 'string', required: 'no', description: 'Agent role for shadows route' },
      { field: 'tasks[].read_first', type: 'string[]', required: '_meta.version >= 3: yes; older: no', description: 'Files and references to inspect before editing' },
      { field: 'tasks[].action', type: 'string', required: '_meta.version >= 3: yes; older: no', description: 'Concrete implementation action' },
      { field: 'tasks[].risk', type: 'string', required: 'v3 standard/deep: yes; quick/older: no', description: 'Task-local failure risk' },
      { field: 'tasks[].recovery', type: 'string', required: 'v3 standard/deep: yes; quick/older: no', description: 'Task-local rollback or recovery path' },
      { field: 'tasks[].profile', type: '`"economy"` | `"balanced"` | `"deep"`', required: '_meta.version >= 3: yes; older: no', description: 'Lowest sufficient delegated compute profile' },
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
      // v1 plans predate task-quality fields and stay lenient; v2+ requires them so Ward has
      // something concrete to check. Missing/non-numeric _meta.version is treated as v1.
      const planVersion = d._meta && typeof d._meta.version === 'number' ? d._meta.version : 1;
      if (Array.isArray(d.tasks)) {
        d.tasks.forEach((t, i) => {
          if (!isObject(t)) {
            errors.push(`tasks[${i}]: required object`);
            return;
          }
          if (!t.id || typeof t.id !== 'string') errors.push(`tasks[${i}].id: required string`);
          if (!t.description || typeof t.description !== 'string') errors.push(`tasks[${i}].description: required string`);
          if (!Array.isArray(t.files)) errors.push(`tasks[${i}].files: required array`);
          if (t.dependsOn !== undefined && !Array.isArray(t.dependsOn)) errors.push(`tasks[${i}].dependsOn: must be array if present`);
          if (planVersion >= 2) {
            if (!Array.isArray(t.acceptance_criteria) || t.acceptance_criteria.length === 0) {
              errors.push(`tasks[${i}].acceptance_criteria: required non-empty array (schema v2+)`);
            }
            if (!t.verify || typeof t.verify !== 'string') {
              errors.push(`tasks[${i}].verify: required string (schema v2+)`);
            }
          }
          if (planVersion >= 3) {
            if (!Array.isArray(t.files) || t.files.length === 0) {
              errors.push(`tasks[${i}].files: required non-empty array (schema v3+)`);
            }
            if (!Array.isArray(t.read_first) || t.read_first.length === 0) {
              errors.push(`tasks[${i}].read_first: required non-empty array (schema v3+)`);
            }
            if (!isNonEmptyString(t.action)) {
              errors.push(`tasks[${i}].action: required string (schema v3+)`);
            }
            if (!['economy', 'balanced', 'deep'].includes(t.profile)) {
              errors.push(`tasks[${i}].profile: must be economy|balanced|deep (schema v3+)`);
            }
            for (const [field, value] of [
              ['action', t.action],
              ['verify', t.verify],
              ['acceptance_criteria', Array.isArray(t.acceptance_criteria) ? t.acceptance_criteria.join(' ') : ''],
            ]) {
              if (hasUnresolvedPlaceholder(value)) {
                errors.push(`tasks[${i}].${field}: unresolved placeholder is not allowed (schema v3+)`);
              }
            }
          }
        });
      }
      if (planVersion >= 3) {
        const planDepth = d.depth;
        if (!['quick', 'standard', 'deep'].includes(planDepth)) {
          errors.push('depth: must be quick|standard|deep (schema v3+)');
        }
        if (!isNonEmptyString(d.problem)) errors.push('problem: required string (schema v3+)');
        if (!isObject(d.decision)) errors.push('decision: required object (schema v3+)');
        else {
          if (!isNonEmptyString(d.decision.question)) errors.push('decision.question: required string (schema v3+)');
          if (!isNonEmptyString(d.decision.recommendation)) {
            errors.push('decision.recommendation: required string (schema v3+)');
          }
          if (!Array.isArray(d.decision.rationale) || d.decision.rationale.length === 0) {
            errors.push('decision.rationale: required non-empty array (schema v3+)');
          }
          if (!['pending', 'delegated'].includes(d.decision.status)) {
            errors.push('decision.status: must be pending|delegated (schema v3+)');
          }
        }
        if (!isObject(d.outcome)) errors.push('outcome: required object (schema v3+)');
        else {
          if (!isNonEmptyString(d.outcome.goal)) errors.push('outcome.goal: required string (schema v3+)');
          if (!Array.isArray(d.outcome.doneWhen) || d.outcome.doneWhen.length === 0) {
            errors.push('outcome.doneWhen: required non-empty array (schema v3+)');
          }
        }
        if (!isObject(d.scope)) errors.push('scope: required object (schema v3+)');
        else {
          for (const field of ['in', 'out', 'constraints']) {
            requireArray(d.scope, field, errors, { label: `scope.${field}` });
          }
        }
        if (planDepth !== 'quick' && !isObject(d.solution_shape)) {
          errors.push('solution_shape: required object for standard/deep plans (schema v3+)');
        } else if (isObject(d.solution_shape)) {
          if (!isNonEmptyString(d.solution_shape.summary)) {
            errors.push('solution_shape.summary: required string (schema v3+)');
          }
          requireArray(d.solution_shape, 'components', errors, {
            nonEmpty: true,
            label: 'solution_shape.components',
          });
          requireArray(d.solution_shape, 'dataFlow', errors, {
            nonEmpty: true,
            label: 'solution_shape.dataFlow',
          });
        }
        const evidence = requireArray(d, 'evidence', errors, { nonEmpty: true });
        const evidenceStates = ['verified', 'supported', 'inferred', 'unknown'];
        evidence.forEach((item, i) => {
          if (!isObject(item) || !isNonEmptyString(item.claim) || !isNonEmptyString(item.source)) {
            errors.push(`evidence[${i}]: claim and source are required strings (schema v3+)`);
          }
          if (!isObject(item) || !evidenceStates.includes(item.status)) {
            errors.push(`evidence[${i}].status: must be ${evidenceStates.join('|')} (schema v3+)`);
          }
        });
        const alternatives = requireArray(d, 'alternatives', errors);
        if (planDepth !== 'quick' && alternatives.length === 0) {
          errors.push('alternatives: required non-empty array for standard/deep plans (schema v3+)');
        }
        requireArray(d, 'assumptions', errors);
        requireArray(d, 'open_questions', errors);
        requireArray(d, 'risks', errors);
        if (!isObject(d.validation)) errors.push('validation: required object (schema v3+)');
        else {
          if (!isNonEmptyString(d.validation.strategy)) {
            errors.push('validation.strategy: required string (schema v3+)');
          }
          requireArray(d.validation, 'definitionOfDone', errors, {
            nonEmpty: true,
            label: 'validation.definitionOfDone',
          });
          requireArray(d.validation, 'checks', errors, { nonEmpty: true, label: 'validation.checks' });
        }
        if (Array.isArray(d.tasks)) validatePlanTaskGraph(d.tasks, errors);
        if (planDepth !== 'quick' && Array.isArray(d.tasks)) {
          d.tasks.forEach((task, i) => {
            if (!isObject(task)) return;
            for (const field of ['risk', 'recovery']) {
              if (!isNonEmptyString(task[field])) {
                errors.push(`tasks[${i}].${field}: required string for standard/deep plans (schema v3+)`);
              }
            }
          });
        }
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
      { field: 'tasks[].testResult', type: 'object | string', required: 'no', description: '`{ passed: bool, summary?: string }` or a short string. The string form is only for a check that ran' },
      { field: 'tasks[].testResult.observation', type: '`"checked:pass"` | `"checked:fail"` | `"not_observed"`', required: 'no', description: 'Whether the check actually ran - same vocabulary as `agents/ward.md`. A check that has not run is recorded `not_observed`, which is its only legal spelling here' },
      { field: 'tasks[].testResult.passed', type: 'boolean', required: 'yes, unless `observation` is `not_observed`', description: 'Whether the check passed. Must agree with `observation` when both are present (`checked:pass` means true, `checked:fail` means false), and must be omitted when `observation` is `not_observed` - an unrun check has no boolean truth' },
      { field: 'tasks[].testResult.summary', type: 'string', required: 'when `observation` is `not_observed`; else no', description: 'What ran and the outcome; carries the reason the check did not run when `observation` is `not_observed`' },
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
            const tr = t.testResult;
            const observations = ['checked:pass', 'checked:fail', 'not_observed'];
            if (tr.observation !== undefined && !observations.includes(tr.observation)) {
              errors.push(`tasks[${i}].testResult.observation: must be one of ${observations.join('|')} if present, got "${tr.observation}"`);
            }
            // A check that never ran has no boolean truth: false reads as "tests failed"
            // and true as "tests passed", so not_observed carries it and passed is absent.
            if (tr.observation === 'not_observed') {
              if (tr.passed !== undefined) errors.push(`tasks[${i}].testResult.passed: must be omitted when testResult.observation is not_observed`);
              if (typeof tr.summary !== 'string') errors.push(`tasks[${i}].testResult.summary: required string when testResult.observation is not_observed - record why the check did not run`);
            } else if (typeof tr.passed !== 'boolean') {
              errors.push(`tasks[${i}].testResult.passed: required boolean when testResult is object, unless testResult.observation is not_observed`);
            } else if (tr.observation !== undefined && tr.passed !== (tr.observation === 'checked:pass')) {
              errors.push(`tasks[${i}].testResult.passed: must agree with testResult.observation (checked:pass -> true, checked:fail -> false)`);
            }
            if (tr.summary !== undefined && typeof tr.summary !== 'string') errors.push(`tasks[${i}].testResult.summary: must be string if present`);
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
        'Types: context intent brainstorm decisions plan execution verification wrap pause-state',
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
