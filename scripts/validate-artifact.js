#!/usr/bin/env node
// Author: Subash Karki
// Validates a Gorkhali JSON artifact against its canonical schema, and is the
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
// Artifact types: context, intent, brainstorm, decisions, plan, execution, verification, review, wrap, pause-state
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
const { GorkhaliError, reportError } = require('./lib/axi-error');

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

// --- review-finding element validation (B9) ---
// Identity and the disposition vocabulary live in scripts/lib/review-finding.js
// so the validator, hooks/loop-controller.js (which WRITES the disposition when
// the fix loop closes), and any consumer reading artifacts off disk agree on
// them without three private copies.
const {
  FINDING_ID_RE,
  DISPOSITIONS,
  DISPOSITIONS_REQUIRING_REASON,
  findingId,
} = require('./lib/review-finding');

// --- the review standard (B10) ---
// The severity scale, the finding shape and the reporting rules are DATA in
// scripts/lib/review-standard.js and prose everywhere else is generated from it
// (scripts/gen-review-standard.js). This file is where the vocabulary becomes
// enforceable: F9's four vocabularies went unnoticed precisely because nothing
// ever checked a finding's severity against a list.
const {
  SEVERITY_VALUES,
  SEVERITY_ALIASES,
  DIMENSIONS,
  normalizeSeverity,
  CONFIDENCE_VALUES,
  CONFIDENCE_ALIASES,
  normalizeConfidence,
  EVIDENCE_CLASS_VALUES,
  normalizeEvidenceClass,
  INDEPENDENCE_BASIS_VALUES,
  INDEPENDENCE_EVIDENCE_TIERS,
  normalizeIndependenceBasis,
  normalizeIndependenceEvidenceTier,
  canonicalIndependenceLabel,
  CLAIM_KEYS,
  GAPS_KEY,
  LEGACY_GAPS_KEY,
} = require('./lib/review-standard');

const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const hasUnresolvedPlaceholder = (value) =>
  typeof value === 'string' && /(\{[A-Z][A-Z0-9_]*\}|\bTODO\b|\bTBD\b)/i.test(value);

// A `quoted` citation's `file` is untrusted artifact content that
// scripts/validate-citations.mjs ultimately resolves against the real
// filesystem - an absolute path, a `../` traversal, or a backslash (Windows
// separator smuggled into a path this repo always treats as POSIX-relative)
// would flow straight into that resolver otherwise. This is the shape-level
// half of containment; the resolver itself re-checks by CANONICAL path
// against the workspace root, which also catches a symlink escape this check
// cannot see. Same rule skills/gorkhali/scripts/lib/decision-contracts.mjs's
// `validatePortablePath` already enforces for task paths ("must be a
// normalized repository-relative path without traversal") - replicated
// minimally here rather than imported: that module is ESM with no path-only
// export, and it belongs to the portable skill's own surface, not this
// validator's.
const isWorkspaceRelativeCitationPath = (value) =>
  isNonEmptyString(value) && !value.includes('\\') && !path.isAbsolute(value) && !value.split('/').includes('..');

// One review finding. The element shape `verification.review.findings` had
// always been declared but never checked - which is exactly how the F9 drift
// (three finding shapes, four severity vocabularies) went unnoticed.
//
// B9 validated the finding as reviewers wrote it and deliberately legislated no
// vocabulary. B10 collapses it: ONE scale (`blocking`/`advisory`) and ONE shape,
// both sourced from scripts/lib/review-standard.js.
//
// BACKWARD COMPATIBILITY, stated rather than assumed: every legacy spelling is
// ACCEPTED AND NORMALIZED, never rejected. Legacy severities (`P0`-`P3`,
// `warn`) map onto the two canonical values; legacy keys (`temperature`,
// `component`, `issue`, `message`, `description`, `fix`) fold onto their
// canonical key. So no reviewer artifact already on disk starts failing, and
// none of them re-ids - the B9 id excludes severity and hashes `file ||
// component` and the first present claim key, all of which normalization
// preserves. `scripts/migrate-review-findings.js` rewrites an artifact into the
// canonical shape when a reader wants the file itself cleaned up.
function validateFinding(finding, i, errors) {
  const at = `findings[${i}]`;
  if (!isObject(finding)) {
    errors.push(`${at}: must be an object`);
    return;
  }
  if (!isNonEmptyString(finding.file) && !isNonEmptyString(finding.component)) {
    errors.push(`${at}.file: required string (the file the finding is about; legacy key "component" accepted)`);
  }
  // `temperature` is the legacy key for the same axis (reference/temperature-review.md).
  const rawSeverity = isNonEmptyString(finding.severity) ? finding.severity : finding.temperature;
  const severity = normalizeSeverity(rawSeverity);
  if (!isNonEmptyString(rawSeverity)) {
    errors.push(`${at}.severity: required non-empty string (legacy key "temperature" accepted)`);
  } else if (!severity) {
    errors.push(
      `${at}.severity: must be one of ${SEVERITY_VALUES.join('|')} ` +
        `(legacy ${Object.keys(SEVERITY_ALIASES).join('/')} accepted), got "${String(rawSeverity).trim()}"`
    );
  }
  // B11: the OTHER axis. Optional so no artifact on disk starts failing (none
  // carries the key), closed so it cannot become a fifth vocabulary the way
  // severity did, and DELIBERATELY unrelated to `severity` above: there is no
  // rule here coupling the two, because severity is importance and confidence is
  // certainty. All six combinations validate. Deriving one from the other is the
  // conflation F9 recorded once already (`review.temperature` read as a severity)
  // and Gap 2 names again.
  const confidence = normalizeConfidence(finding.confidence);
  if (finding.confidence !== undefined) {
    if (!confidence) {
      errors.push(
        `${at}.confidence: must be one of ${CONFIDENCE_VALUES.join('|')} ` +
          `(also accepted: ${Object.keys(CONFIDENCE_ALIASES).map((k) => `"${k}"`).join('/')}), ` +
          `got "${typeof finding.confidence === 'string' ? finding.confidence.trim() : String(finding.confidence)}"`
      );
    }
  }
  // B13: evidence class + citation (fable-foreman finding contract), superseding
  // self-rated `confidence` above. Optional and closed so no artifact on disk
  // before this existed starts failing. `citation` becomes REQUIRED, in the
  // shape that class demands to be deterministically resolvable
  // (scripts/validate-citations.mjs), once `evidenceClass` is `quoted` or
  // `observed` - the two classes a machine can actually check.
  const evidenceClass = normalizeEvidenceClass(finding.evidenceClass);
  if (finding.evidenceClass !== undefined && !evidenceClass) {
    errors.push(
      `${at}.evidenceClass: must be one of ${EVIDENCE_CLASS_VALUES.join('|')}, ` +
        `got "${typeof finding.evidenceClass === 'string' ? finding.evidenceClass.trim() : String(finding.evidenceClass)}"`
    );
  }
  if (evidenceClass === 'quoted' || evidenceClass === 'observed') {
    const citation = finding.citation;
    if (!isObject(citation)) {
      errors.push(`${at}.citation: required object when evidenceClass is "${evidenceClass}"`);
    } else if (evidenceClass === 'quoted') {
      if (!isNonEmptyString(citation.file)) {
        errors.push(`${at}.citation.file: required non-empty string when evidenceClass is "quoted"`);
      } else if (!isWorkspaceRelativeCitationPath(citation.file)) {
        errors.push(
          `${at}.citation.file: must be a normalized workspace-relative path without an absolute ` +
            `path, "../" traversal, or backslash, got "${citation.file.trim()}"`
        );
      }
      if (citation.line !== undefined && citation.line !== null && !Number.isFinite(citation.line)) {
        errors.push(`${at}.citation.line: must be a number if present`);
      }
      // A quoted citation with no quote text is unresolvable-as-quoted, not a
      // weaker legal one - the shape check must reject what the resolver
      // (scripts/validate-citations.mjs) cannot resolve, rather than let a
      // vacuous "quoted" finding validate and only fail later at resolution.
      if (!isNonEmptyString(citation.quote)) {
        errors.push(`${at}.citation.quote: required non-empty string when evidenceClass is "quoted"`);
      }
    } else {
      if (!isNonEmptyString(citation.command)) {
        errors.push(`${at}.citation.command: required non-empty string when evidenceClass is "observed"`);
      }
      if (citation.expect !== undefined && typeof citation.expect !== 'string') {
        errors.push(`${at}.citation.expect: must be a string if present`);
      }
    }
  } else if (evidenceClass === 'derived') {
    // Unlike quoted/observed (structured citations) or inferred (citation
    // legitimately absent), `derived` REQUIRES a non-empty free-text locator -
    // a derived finding must still say where its reasoning came from, even
    // though that locator is not machine-resolvable.
    if (!isNonEmptyString(finding.citation)) {
      errors.push(`${at}.citation: required non-empty string (a free-text locator) when evidenceClass is "derived"`);
    }
  } else if (evidenceClass === 'inferred') {
    // `null` or absent is the norm - the only class where an absent citation is
    // legal - but a present one is still shape-checked rather than accepted blind.
    if (
      finding.citation !== undefined &&
      finding.citation !== null &&
      typeof finding.citation !== 'string' &&
      !isObject(finding.citation)
    ) {
      errors.push(`${at}.citation: must be null, a string, or an object if present when evidenceClass is "inferred"`);
    }
  }

  if (finding.line !== undefined && finding.line !== null && !Number.isFinite(finding.line)) {
    errors.push(`${at}.line: must be a number if present`);
  }
  for (const key of ['evidence', 'impact', 'remediation', 'issue', 'fix', 'message', 'description']) {
    if (finding[key] !== undefined && typeof finding[key] !== 'string') {
      errors.push(`${at}.${key}: must be string if present`);
    }
  }

  // B10(b): a defect the diff did not introduce REPORTS, it never blocks. The
  // rule is mechanical rather than advisory prose because "reports, never
  // blocks" is exactly the promise a reviewer under time pressure breaks.
  if (finding.preExisting !== undefined && typeof finding.preExisting !== 'boolean') {
    errors.push(`${at}.preExisting: must be boolean if present`);
  } else if (finding.preExisting === true && severity === 'blocking') {
    errors.push(
      `${at}.preExisting: a pre-existing defect reports and never blocks - use severity "advisory" ` +
        '(a defect the diff did not introduce cannot make the diff worse than before)'
    );
  }

  // B10(a): a behavioural claim cites file:line in the source. An inference from
  // a symbol's NAME is not evidence, and a citation is the cheapest thing that
  // separates the two. Enforced on blocking findings only: those are the ones
  // that stop a ship and open a fix loop, so they are the ones that must be
  // checkable. An advisory ("no test covers this file") can legitimately be
  // about a whole file, and a finding that names a `component` rather than a
  // file has no line to cite.
  if (severity === 'blocking' && isNonEmptyString(finding.file)) {
    if (!Number.isFinite(finding.line) || finding.line < 1) {
      errors.push(
        `${at}.line: required for a blocking finding - a behavioural claim must cite file:line in the ` +
          'source, not an inference from a symbol name (downgrade to "advisory" if there is no line to cite)'
      );
    }
  }

  if (finding.id !== undefined) {
    if (typeof finding.id !== 'string' || !FINDING_ID_RE.test(finding.id)) {
      errors.push(`${at}.id: must match f_<12 hex> (derived - see scripts/lib/review-finding.js), got "${finding.id}"`);
    } else {
      const derived = findingId(finding);
      // A hand-typed or random id would make the same finding uncountable across
      // re-review rounds, which is the one thing B9 exists to prevent.
      if (finding.id !== derived) errors.push(`${at}.id: must be the content-derived id "${derived}", got "${finding.id}"`);
    }
  }

  // Optional and closed. Before B10 the dimension lived only in Justice's chat
  // output, so the baseline miner could break precision down per severity and
  // per agent but never per dimension - the field the artifact needed did not
  // exist. A free-form string would have made that breakdown as unreliable as
  // the four severity vocabularies it just replaced.
  if (finding.dimension !== undefined && !DIMENSIONS.includes(finding.dimension)) {
    errors.push(`${at}.dimension: must be one of ${DIMENSIONS.join('|')} if present, got "${finding.dimension}"`);
  }

  if (finding.dispositionReason !== undefined && typeof finding.dispositionReason !== 'string') {
    errors.push(`${at}.dispositionReason: must be string if present`);
  }
  if (finding.disposition !== undefined) {
    if (!DISPOSITIONS.includes(finding.disposition)) {
      errors.push(`${at}.disposition: must be one of ${DISPOSITIONS.join('|')} if present, got "${finding.disposition}"`);
    } else {
      // The outcome is attributed to an INDIVIDUAL finding, so it needs the
      // finding's stable handle - a disposition with no id is unattributable.
      if (finding.id === undefined) errors.push(`${at}.id: required once a disposition is recorded`);
      if (DISPOSITIONS_REQUIRING_REASON.includes(finding.disposition) && !isNonEmptyString(finding.dispositionReason)) {
        errors.push(`${at}.dispositionReason: required non-empty string when disposition is "${finding.disposition}"`);
      }
    }
  }
}

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

// Implementer (Engineer) completion-record status vocabulary - single source of
// truth, also asserted disjoint from the Inspector verdict and session lifecycle
// vocabularies by test/status-vocab.test.js. Extend here, not by hand-listing
// elsewhere.
const EXECUTION_TASK_STATUSES = ['done', 'failed', 'skipped', 'done-with-concerns', 'needs-context'];

const SCHEMAS = {
  context: {
    fields: [
      { field: 'ticket', type: 'string', required: 'yes', description: 'Ticket key or task label' },
      { field: 'summary', type: 'string', required: 'yes', description: 'Human-readable ticket summary' },
      { field: 'source', type: '`"jira"` | `"args"` | `"branch"`', required: 'yes', description: 'Where context was sourced from' },
      { field: 'jira', type: 'object | `null`', required: 'no', description: 'Raw Jira issue fields (if source=jira)' },
      { field: 'learningsRefs', type: 'string[]', required: 'no', description: 'Paths to relevant learning files' },
      { field: 'modelOverride', type: 'string | `null`', required: 'no', description: 'Force a specific model for spawns' },
    ],
    validate: (d, errors) => {
      validateMeta(d, errors);
      if (!d.ticket || typeof d.ticket !== 'string') errors.push('ticket: required string');
      if (!d.summary || typeof d.summary !== 'string') errors.push('summary: required string');
      const validSources = ['jira', 'args', 'branch'];
      if (!validSources.includes(d.source)) errors.push(`source: must be one of ${validSources.join('|')}, got "${d.source}"`);
      if (d.learningsRefs !== undefined && !Array.isArray(d.learningsRefs)) errors.push('learningsRefs: must be array if present');
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
        if (Array.isArray(d.approaches) && d.approaches.length >= 2) {
          const lenses = new Set();
          const theses = new Set();
          const triples = [];
          let duplicateLens = false;
          let duplicateThesis = false;
          d.approaches.forEach((approach) => {
            if (!isObject(approach)) return;
            if (isNonEmptyString(approach.whyLens)) {
              if (lenses.has(approach.whyLens)) duplicateLens = true;
              lenses.add(approach.whyLens);
            }
            if (isNonEmptyString(approach.thesis)) {
              if (theses.has(approach.thesis)) duplicateThesis = true;
              theses.add(approach.thesis);
            }
            if (isNonEmptyString(approach.effort) && isNonEmptyString(approach.risk) && isNonEmptyString(approach.reversibility)) {
              triples.push(approach.effort + '\n' + approach.risk + '\n' + approach.reversibility);
            }
          });
          if (duplicateLens) errors.push('approaches[].whyLens: duplicate whyLens');
          if (duplicateThesis) errors.push('approaches[].thesis: duplicate thesis');
          if (triples.length >= 2 && triples.every((triple) => triple === triples[0])) {
            errors.push('approaches: effort, risk, and reversibility must not all be identical');
          }
        }
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
      { field: 'briefing', type: 'object', required: '_meta.version >= 3: yes; older: no', description: 'Plain-English What/Problem/How the human gate leads with' },
      { field: 'briefing.tackling', type: 'string', required: '_meta.version >= 3: yes; older: no', description: 'What this plan is tackling, in one sentence' },
      { field: 'briefing.problem', type: 'string', required: '_meta.version >= 3: yes; older: no', description: 'The pain this plan resolves, in plain language' },
      { field: 'briefing.how', type: 'string', required: '_meta.version >= 3: yes; older: no', description: 'How the recommendation solves it; a How without evidence is an assumption' },
      { field: 'decision', type: 'object', required: '_meta.version >= 3: yes; older: no', description: 'Recommendation and approval question shown first' },
      { field: 'decision.question', type: 'string', required: '_meta.version >= 3: yes; older: no', description: 'What the user is approving' },
      { field: 'decision.recommendation', type: 'string', required: '_meta.version >= 3: yes; older: no', description: 'Recommended direction in one sentence' },
      { field: 'decision.rationale', type: 'string[]', required: '_meta.version >= 3: yes; older: no', description: 'Evidence-backed reasons for the recommendation' },
      { field: 'decision.status', type: '`"pending"` | `"delegated"`', required: '_meta.version >= 3: yes; older: no', description: 'Approval state; the model never marks its own plan approved' },
      { field: 'outcome', type: 'object', required: '_meta.version >= 3: yes; older: no', description: 'Goal and observable definition of done' },
      { field: 'scope', type: 'object', required: '_meta.version >= 3: yes; older: no', description: 'In-scope, out-of-scope, and constraints' },
      { field: 'solution_shape', type: 'object', required: 'v3 standard/deep: yes; v3 quick and older: no', description: 'Architecture summary, components, and data flow' },
      { field: 'evidence', type: 'object[]', required: '_meta.version >= 3: yes; older: no', description: 'Claims, sources, and evidence states' },
      { field: 'evidence[].implication', type: 'string', required: 'v3 standard/deep when status is verified or supported', description: 'What the claim implies for the recommendation' },
      { field: 'alternatives', type: 'object[]', required: '_meta.version >= 3: array; standard/deep non-empty', description: 'Considered alternatives and why they were not selected' },
      { field: 'alternatives[].name', type: 'string', required: 'when an alternative is present', description: 'Short label for the considered option' },
      { field: 'alternatives[].reasonNotSelected', type: 'string', required: 'unique reasonNotSelected or reason per alternative', description: 'Why this option was not chosen; must be unique across alternatives' },
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
      { field: 'tasks[].acceptance_criteria', type: 'string[]', required: '_meta.version >= 2: yes; v1: no', description: 'Shell commands or observable facts Inspector checks; each item a command/fact, never prose' },
      { field: 'tasks[].verify', type: 'string', required: '_meta.version >= 2: yes; v1: no', description: 'Single command that exits 0 on success; must be runnable by Inspector' },
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
      // v1 plans predate task-quality fields and stay lenient; v2+ requires them so Inspector has
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
        if (!isObject(d.briefing)) errors.push('briefing: required object');
        else {
          for (const field of ['tackling', 'problem', 'how']) {
            if (!isNonEmptyString(d.briefing[field])) errors.push(`briefing.${field}: required string`);
          }
        }
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
          if (planDepth !== 'quick' && isObject(item) && (item.status === 'verified' || item.status === 'supported') && !isNonEmptyString(item.implication)) {
            errors.push(`evidence[${i}].implication: required string for verified|supported evidence`);
          }
        });
        const alternatives = requireArray(d, 'alternatives', errors);
        if (planDepth !== 'quick' && alternatives.length === 0) {
          errors.push('alternatives: required non-empty array for standard/deep plans (schema v3+)');
        }
        const seenReasons = new Set();
        alternatives.forEach((item, i) => {
          if (!isObject(item)) {
            errors.push(`alternatives[${i}]: required object`);
            return;
          }
          if (!isNonEmptyString(item.name)) errors.push(`alternatives[${i}].name: required string`);
          const reason = isNonEmptyString(item.reasonNotSelected)
            ? item.reasonNotSelected
            : (isNonEmptyString(item.reason) ? item.reason : '');
          if (!isNonEmptyString(reason)) {
            errors.push(`alternatives[${i}]: required unique reasonNotSelected or reason`);
            return;
          }
          if (seenReasons.has(reason)) errors.push(`alternatives[${i}]: reasonNotSelected or reason must be unique`);
          seenReasons.add(reason);
        });
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
      { field: 'tasks[].status', type: '`"done"` | `"failed"` | `"skipped"` | `"done-with-concerns"` | `"needs-context"`', required: 'yes', description: 'Final task status. `done-with-concerns` is done, but carries a concern Chief must read in the handoff note - treated as done for gating. `needs-context` is a resume-with-context case, not a failure: the task cannot proceed without information only Chief has, recorded in `blocker`' },
      { field: 'tasks[].agent', type: 'string', required: 'no', description: 'Agent that ran this task' },
      { field: 'tasks[].filesChanged', type: 'string[]', required: 'yes', description: 'Files actually modified' },
      { field: 'tasks[].filesRead', type: 'string[]', required: 'no', description: 'Files read but NOT changed (wave-handoff awareness)' },
      { field: 'tasks[].selfReviewScore', type: 'number', required: 'no', description: 'Agent\'s self-review score (0-10)' },
      { field: 'tasks[].testResult', type: 'object | string', required: 'no', description: '`{ passed: bool, summary?: string }` or a short string. The string form is only for a check that ran' },
      { field: 'tasks[].testResult.observation', type: '`"checked:pass"` | `"checked:fail"` | `"not_observed"`', required: 'no', description: 'Whether the check actually ran - same vocabulary as `agents/inspector.md`. A check that has not run is recorded `not_observed`, which is its only legal spelling here' },
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
        const validStatuses = EXECUTION_TASK_STATUSES;
        d.tasks.forEach((t, i) => {
          if (!t.id || typeof t.id !== 'string') errors.push(`tasks[${i}].id: required string`);
          if (!validStatuses.includes(t.status)) errors.push(`tasks[${i}].status: must be one of ${validStatuses.join('|')}, got "${t.status}"`);
          if (t.status === 'needs-context' && (!t.blocker || typeof t.blocker !== 'string')) {
            errors.push(`tasks[${i}].blocker: required string when status is needs-context - record the exact question only Chief can answer`);
          }
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
      { field: 'review.temperature', type: 'number', required: 'yes', description: 'Reviewer strictness (0-1). NOT a severity: it is a knob on how hard the reviewer looks, orthogonal to how a finding is scored once found (`findings[].severity`)' },
      { field: 'review.findings', type: 'object[]', required: 'yes', description: 'Array of finding objects. Element shape is the review artifact\'s finding (`reference/schemas/review.md`) — ONE shape and ONE severity scale, enforced there; array-only here so no verification artifact already on disk starts failing' },
      { field: 'review.fixLoops', type: 'number', required: 'yes', description: 'How many fix/re-verify loops ran. LEGACY source: the portable flow counts the review round ledger (`{SESSION_DIR}/reviews/rounds.json`) instead, and this field is read only for sessions written before that move. Either way the count is owned by `hooks/loop-controller.js` and capped at the fix-loop ceiling (canonical: `reference/fix-loop.md`) unless a logged operator override extended it' },
      { field: 'simplifyRan', type: 'boolean', required: 'yes', description: 'Whether simplify was run on changed files' },
      { field: 'intentAlignment', type: '`"aligned"` | `"drift"` | `"wrong"`', required: 'yes', description: 'How well output matches intent.json' },
      { field: 'userVerification', type: 'object', required: 'yes for passed verdict', description: 'Compact UI classification and conditional user-verification result; use `{ "required": false }` for non-UI work' },
      { field: 'userVerification.required', type: 'boolean', required: 'yes', description: 'Whether this change requires user verification' },
      { field: 'userVerification.status', type: '`"confirmed"` | `"pending"`', required: 'yes when required', description: '`confirmed` is an explicit user confirmation; `pending` cannot produce a passing verdict' },
      { field: 'userVerification.routes', type: 'string[]', required: 'yes when required', description: 'Routes presented to the user; non-empty when verification is required' },
      { field: 'userVerification.confirmedBy', type: '`"user"`', required: 'yes (when confirmed)', description: 'Records that confirmation came from the user' },
      { field: 'userVerification.observations', type: 'string[]', required: 'yes when required', description: 'User observations; may be empty when the user confirmed without notes' },
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
      if (d.visualVerification !== undefined) {
        errors.push('visualVerification: unsupported; use userVerification');
      }
      if (d.userVerificationRequired !== undefined) {
        errors.push('userVerificationRequired: unsupported; use userVerification.required');
      }
      const uv = d.userVerification;
      if (d.verdict === 'pass' && (!uv || typeof uv !== 'object' || Array.isArray(uv))) {
        errors.push('userVerification: required object for passed verdict; use {"required":false} when not needed');
      } else if (uv !== undefined && uv !== null) {
        if (typeof uv !== 'object' || Array.isArray(uv)) {
          errors.push('userVerification: must be object if present');
        } else {
          if (typeof uv.required !== 'boolean') errors.push('userVerification.required: required boolean');
          if (uv.required === true) {
            const allowed = new Set(['required', 'status', 'routes', 'confirmedBy', 'observations']);
            for (const field of Object.keys(uv).filter((key) => !allowed.has(key))) {
              errors.push(`userVerification.${field}: unsupported field`);
            }
            const validStatuses = ['confirmed', 'pending'];
            if (!validStatuses.includes(uv.status)) {
              errors.push(`userVerification.status: must be one of ${validStatuses.join('|')}, got "${uv.status}"`);
            }
            if (!Array.isArray(uv.routes) || !uv.routes.every((route) => typeof route === 'string' && route.trim())) {
              errors.push('userVerification.routes: required string array');
            } else if (uv.routes.length === 0) {
              errors.push('userVerification.routes: must be non-empty when user verification is required');
            }
            if (!Array.isArray(uv.observations) || !uv.observations.every((observation) => typeof observation === 'string' && observation.trim())) {
              errors.push('userVerification.observations: required string array');
            }
            if (uv.status === 'confirmed' && uv.confirmedBy !== 'user') {
              errors.push('userVerification.confirmedBy: must be "user" when status is confirmed');
            } else if (uv.status !== 'confirmed' && uv.confirmedBy !== undefined) {
              errors.push('userVerification.confirmedBy: must be omitted unless status is confirmed');
            }
            if (uv.status === 'pending' && d.verdict === 'pass') {
              errors.push('verdict: cannot be pass while required user verification is pending');
            }
          } else if (uv.required === false) {
            for (const field of Object.keys(uv).filter((key) => key !== 'required')) {
              errors.push(`userVerification.${field}: must be omitted when user verification is not required`);
            }
          }
        }
      }
      if (d.score !== undefined && (typeof d.score !== 'number' || d.score < 0 || d.score > 10)) {
        errors.push('score: must be number 0-10 if present');
      }
    },
  },

  review: {
    fields: [
      { field: 'role', type: 'string', required: 'yes', description: 'Reviewer that wrote the artifact: `"auditor"` for the one default reviewer, `"justice"` for the risk-triggered specialist' },
      { field: 'model', type: 'string', required: 'no', description: 'The model this review RAN on, recorded verbatim (F11). PER ARTIFACT, not per finding: one review run is one reviewer in one spawn, so every finding in the file shares it. Never inferred — a frontmatter pin or a `model-policy.json` profile is what was REQUESTED, and F11 measured `auditor` running `opus:18 sonnet:7` against an `opus` pin, so a copied pin would make a confounded comparison look controlled. Optional and absent on every artifact written before F11; while it is absent the B11 precision gate refuses to produce a verdict rather than compare two possibly-different reviewers' },
      { field: 'independence', type: 'object', required: 'no', description: 'Honest-degradation disclosure (adopted from the fable-foreman digest), recorded once for the whole artifact same as `model`. Optional for back-compat - absent on every artifact written before this field existed - but a present object is fully validated against the closed vocabularies below' },
      { field: 'independence.basis', type: '`"same-model-independent-context"` | `"cross-model"` | `"reduced-assurance"`', required: 'yes (if `independence` present)', description: 'Whether this review is a genuine second opinion (`cross-model`), the same model reviewing in its own separate context (`same-model-independent-context` - the common case while balanced and deep resolve to the same delegate model), or a required independent check was structurally unavailable (`reduced-assurance`)' },
      { field: 'independence.evidenceTier', type: '`"requested"` | `"served"`', required: 'yes (if `independence` present)', description: "What the `basis` claim itself rests on, borrowed from project-docs/seat-provenance-design.md's tier model: `requested` (what was asked for) or `served` (post-resolution proof of what actually answered). Every recorded `model` on this artifact is requested-tier today, so `basis` is too, until that design's served-tier probe lands" },
      { field: 'independence.label', type: 'string', required: 'yes (if `independence` present)', description: 'The human-readable sentence a reader sees without decoding the two tokens above. NOT free text: it is DERIVED, a pure function of `basis` and `evidenceTier` (`canonicalIndependenceLabel` in `scripts/lib/review-standard.js`), and must EXACTLY EQUAL that function\'s output for the recorded tokens - one strict-equality check, no prefix match, no phrase check. A hand-phrased label can always find wording no finite check enumerates, so the claim sentence is no longer something a reviewer writes; only `basis`/`evidenceTier` are choices' },
      { field: 'independence.reason', type: 'string', required: 'yes (if `basis` is `reduced-assurance`), optional otherwise', description: 'The human explanation the label used to embed as free text - what, specifically, made the independent check unavailable. Bounded free text (a reader\'s context, never a machine-checked claim): at most 500 UTF-8 bytes. Required non-empty when `basis` is `reduced-assurance` - a reduced-assurance acceptance with no stated reason is meaningless - optional for the other two bases' },
      { field: 'verdict', type: '`"pass"` | `"fail"` | `"blocked"`', required: 'yes', description: 'Review result. A missing or unreadable artifact is `blocked`, never a clean review' },
      { field: 'findings', type: 'object[]', required: 'yes', description: 'Findings. A written `[]` is a clean review; an absent key is not the same result and must not report as one' },
      { field: 'findings[].id', type: 'string (`f_<12 hex>`)', required: 'no (required once a disposition is recorded)', description: 'Stable finding id, DERIVED from content: `f_` + first 12 hex of `sha256(file + US + claim)`. Reviewers do not write it — it is stamped mechanically by `scripts/lib/review-finding.js`, which is the derivation authority. When present it must equal the derived value' },
      { field: 'findings[].severity', type: '`"blocking"` | `"advisory"`', required: 'yes', description: 'Importance, on the one scale (`scripts/lib/review-standard.js`). `blocking` = the diff makes something WORSE than before or fails the stated intent; `advisory` = everything else worth saying. There is no third level: a finding clearing neither bar is not reported at all. Legacy spellings are accepted and normalized — `P0`/`P1` to `blocking`, `P2`/`P3`/`warn` to `advisory`, legacy key `temperature` to `severity`' },
      { field: 'findings[].confidence', type: '`"confirmed"` \\| `"possible"` \\| `"needs-verification"`', required: 'no', description: 'Certainty, on its own axis (B11). `confirmed` = the cited line was re-read and the claimed behaviour is there; `possible` = the line reads as claimed but the impact depends on an unfollowed path; `needs-verification` = the source could not be re-read at all, which requires a matching `observationGaps` entry. ORTHOGONAL to `severity` — severity is importance, confidence is certainty, neither is derived from the other, and all six combinations are legal. Optional: artifacts written before B11 carry no confidence and are read as unverified, never as confirmed. SUPERSEDED (B13) by `evidenceClass` + `citation` for any finding that carries them - a reviewer self-rating, kept only for back-compat' },
      { field: 'findings[].evidenceClass', type: '`"quoted"` \\| `"observed"` \\| `"derived"` \\| `"inferred"`', required: 'no', description: 'B13, adopted from the fable-foreman digest. How the claim was reached - never self-rated confidence, which it supersedes. `quoted` and `observed` require a matching structured `citation` (below); `derived` requires a non-empty free-text locator; only `inferred` may omit it. Resolved deterministically, never asked of the reviewer as a score, by `scripts/validate-citations.mjs`, which computes calibration = resolved/resolvable across the artifact' },
      { field: 'findings[].citation', type: 'object | string | `null`', required: "yes when evidenceClass is `quoted`, `observed`, or `derived`; else no", description: 'Shape follows `evidenceClass`: `{ file, line?, quote }` for `quoted` (file must exist; must be a normalized workspace-relative path - no absolute path, `../` traversal, or backslash, since it is untrusted content that `scripts/validate-citations.mjs` resolves against the real filesystem, which re-checks by canonical path against the workspace root for the symlink escapes this shape check cannot see; `quote` is REQUIRED non-empty text - a quoted citation with no quote is unresolvable-as-quoted, not a weaker legal one; it must appear in the file, whitespace-normalized; a given line must be within 5 lines of an occurrence of the quote); `{ command, expect? }` for `observed` (command must be non-empty - resolution is structural, the command is never re-run); a REQUIRED non-empty free-text locator string for `derived`; `null` or omitted for `inferred` - the only class where an absent citation is legal. A resolved citation proves the cited text/command EXISTS, not that it supports the claim; that judgment stays with the reader' },
      { field: 'findings[].preExisting', type: 'boolean', required: 'no', description: 'True for a real defect the diff did NOT introduce. It reports, never blocks, and never enters a fix loop, so `preExisting: true` alongside severity `blocking` is rejected. Omit when false' },
      { field: 'findings[].dimension', type: '`"cross-file-coherence"` | `"regression"` | `"semantic-accuracy"` | `"dead-code"` | `"convention-deviation"`', required: 'no', description: "Justice's review dimension. Optional and closed: before B10 it existed only in Justice's chat output format, so `scripts/baseline-report.js` could report precision per severity and per agent but never per dimension. Auditor has no dimension vocabulary and omits the key" },
      { field: 'findings[].file', type: 'string', required: 'yes', description: 'File the finding is about. Legacy key `component` is accepted and folds onto `file`' },
      { field: 'findings[].line', type: 'number', required: 'yes for a `blocking` finding', description: 'The cited source line. Required on a blocking finding: a behavioural claim must cite `file:line` in source, and an inference from a symbol NAME is not evidence. Excluded from the id on purpose — an unrelated fix upstream shifts line numbers, and a finding that merely moved is the same finding' },
      { field: 'findings[].evidence', type: 'string', required: 'no', description: 'What was read at that line. Legacy keys `issue`/`message`/`description` fold onto it; the first one present is the claim text the id hashes' },
      { field: 'findings[].impact', type: 'string', required: 'no', description: 'User-visible consequence' },
      { field: 'findings[].remediation', type: 'string', required: 'no', description: 'Smallest valid fix. Legacy key `fix` folds onto it' },
      { field: 'findings[].disposition', type: '`"fixed"` | `"dismissed"` | `"deferred"`', required: 'no', description: 'Outcome attributed to THIS finding when the fix loop closed, written by `hooks/loop-controller.js`. Absent until the loop closes; absent forever on artifacts written before B9. A `preExisting` finding closes as `deferred`, never `fixed` — it never entered the loop' },
      { field: 'findings[].dispositionReason', type: 'string', required: 'yes when disposition is `dismissed` or `deferred`', description: 'Why the finding was not fixed. Required for `dismissed`/`deferred` because nothing in the diff evidences them; `fixed` needs none — the changed code is the evidence' },
      { field: 'discardedFindings', type: 'object[]', required: 'no', description: 'What the B11 verification pass DROPPED: candidate findings whose claim the cited source did not support on re-read. Each element needs a `file` (legacy `component` accepted), a claim (`evidence`/`issue`/`message`/`description`), and a non-empty `reason` naming what the source actually says. Recorded rather than deleted so a dropped false positive is evidence the pass ran, and so the same claim reappearing next round is visible. Omit when nothing was discarded' },
      { field: 'convergence', type: 'object', required: 'no', description: 'Re-review convergence for this pass (B12), stamped mechanically by `scripts/review-round.js` — reviewers never write it. Absent on a round-1 review' },
      { field: 'convergence.round', type: 'number', required: 'yes (if present)', description: 'Which pass over this session this is, 1-based. Derived from the carry-over ledger `{SESSION_DIR}/reviews/rounds.json`, which survives the deliberate pre-pass delete of `auditor.json` because it is a different file and holds no verdict' },
      { field: 'convergence.suppressed', type: 'object', required: 'yes (if present)', description: 'Non-blocking findings this round reported as a count instead of itemizing: `{ total, carriedOver, new }`, all numbers. On round 2+ a non-blocking finding is suppressed whether or not round 1 raised it; the split says which' },
      { field: 'observationGaps', type: 'string[]', required: 'yes', description: 'Parts of the assigned scope that were not observed. ONE spelling, camelCase like every other artifact key; the legacy `observation_gaps` is accepted and normalized' },
      { field: '_meta', type: 'object', required: 'no', description: 'Validated when present, never required. DECIDED in B10: the reviewer artifact is the one documented exception to `reference/schemas/_meta.md`, because a subagent-written artifact would have to GUESS the session `phase`/`skill`/`version`, and the portable lifecycle already binds the review to a worktree fingerprint — a guessed provenance header is worse than an absent one' },
    ],
    validate: (d, errors) => {
      // Deliberately NOT validateMeta(d, errors) unconditionally - see the _meta field note.
      if (d._meta !== undefined) validateMeta(d, errors);
      if (!isNonEmptyString(d.role)) errors.push('role: required string');
      // F11: optional, so no artifact on disk starts failing - but a present
      // `model` must be a real recorded name. There is no enum to check it
      // against on purpose: model-presets.json maps the same profile to `opus`
      // on claude-code and `gpt-5.6-sol` on codex, so a closed list here would
      // reject a true value. An empty string is not a recorded model, it is an
      // absent one wearing a key, and the gate must be able to tell them apart.
      if (d.model !== undefined && !isNonEmptyString(d.model)) {
        errors.push(
          'model: must be a non-empty string when present - the model this review RAN on, recorded ' +
            'verbatim from the host and never copied from a frontmatter pin (F11). Omit the key ' +
            'entirely when nothing recorded it'
        );
      }

      // Honest-degradation disclosure, adopted from the fable-foreman digest.
      // Optional so no artifact on disk before this field existed starts
      // failing - but a PRESENT object is fully enforced.
      //
      // `label` used to be free text checked against a required prefix, then
      // against a finite blocklist of foreign phrases - both closed one
      // smuggling shape and left the next one open, because prose is
      // unbounded and neither a prefix nor a blocklist can enumerate it (a
      // reduced-assurance suffix reading "independently reviewed by a
      // different model" names none of the reserved phrases yet still
      // overstates the acceptance). So `label` is no longer validated as
      // prose at all: it is DERIVED from `basis`/`evidenceTier`
      // (`canonicalIndependenceLabel`, scripts/lib/review-standard.js) and
      // checked with ONE strict-equality comparison against that derivation.
      // There is nothing left for a writer to phrase, so there is nothing
      // left to smuggle. The human explanation moves to the separate
      // `reason` field below, which is bounded free text rather than a
      // machine-checked claim.
      if (d.independence !== undefined) {
        if (!isObject(d.independence)) {
          errors.push('independence: must be an object if present');
        } else {
          const { basis, evidenceTier, label, reason } = d.independence;
          const normalizedBasis = normalizeIndependenceBasis(basis);
          if (!isNonEmptyString(basis)) {
            errors.push('independence.basis: required non-empty string when independence is present');
          } else if (!normalizedBasis) {
            errors.push(
              `independence.basis: must be one of ${INDEPENDENCE_BASIS_VALUES.join('|')}, got "${String(basis).trim()}"`
            );
          }
          const normalizedTier = normalizeIndependenceEvidenceTier(evidenceTier);
          if (!isNonEmptyString(evidenceTier)) {
            errors.push('independence.evidenceTier: required non-empty string when independence is present');
          } else if (!normalizedTier) {
            errors.push(
              `independence.evidenceTier: must be one of ${INDEPENDENCE_EVIDENCE_TIERS.join('|')}, got "${String(evidenceTier).trim()}"`
            );
          }
          if (!isNonEmptyString(label)) {
            errors.push(
              'independence.label: required non-empty string when independence is present - it must ' +
                'exactly equal canonicalIndependenceLabel(basis, evidenceTier)'
            );
          } else if (normalizedBasis) {
            // `null` here means either basis/evidenceTier did not themselves
            // validate (already reported above) or the basis needs a tier to
            // render one and did not get it - either way there is no
            // canonical string yet to compare against, so the label is left
            // unchecked rather than compared to nothing.
            const expected = canonicalIndependenceLabel(normalizedBasis, normalizedTier);
            if (expected && label.trim() !== expected) {
              errors.push(
                `independence.label: must exactly equal the canonical label derived from basis ` +
                  `"${normalizedBasis}"${normalizedTier ? ` and evidenceTier "${normalizedTier}"` : ''}: ` +
                  `"${expected}", got "${label.trim()}"`
              );
            }
          }

          // `reason` carries the human explanation the label used to embed as
          // free text. It is bounded (never a machine-checked claim, so a
          // byte cap is enough) and REQUIRED for `reduced-assurance`: an
          // acceptance labeled reduced with no stated reason is meaningless -
          // indistinguishable from one that quietly forgot why.
          if (reason !== undefined && typeof reason !== 'string') {
            errors.push('independence.reason: must be a string if present');
          } else {
            if (typeof reason === 'string') {
              const reasonBytes = Buffer.byteLength(reason, 'utf8');
              if (reasonBytes > 500) {
                errors.push(`independence.reason: must be at most 500 UTF-8 bytes, got ${reasonBytes}`);
              }
            }
            if (normalizedBasis === 'reduced-assurance' && !isNonEmptyString(reason)) {
              errors.push(
                'independence.reason: required non-empty string when basis is "reduced-assurance" - a ' +
                  'reduced-assurance acceptance with no stated reason is meaningless'
              );
            }
          }
        }
      }

      const validVerdicts = ['pass', 'fail', 'blocked'];
      if (!validVerdicts.includes(d.verdict)) errors.push(`verdict: must be one of ${validVerdicts.join('|')}, got "${d.verdict}"`);

      // One spelling (GAPS_KEY); the other is read and normalized, never rejected.
      const gaps = d[GAPS_KEY] !== undefined ? d[GAPS_KEY] : d[LEGACY_GAPS_KEY];
      const gapsKey = d[GAPS_KEY] !== undefined ? GAPS_KEY : LEGACY_GAPS_KEY;
      if (gaps === undefined) errors.push(`${GAPS_KEY}: required array (legacy key "${LEGACY_GAPS_KEY}" accepted)`);
      else if (!Array.isArray(gaps) || !gaps.every((gap) => typeof gap === 'string')) {
        errors.push(`${gapsKey}: must be a string array`);
      }

      // B11: `needs-verification` means the source could not be re-read, so it
      // owes the reader the reason. Without this it is a free pass that lets an
      // unchecked claim land looking checked - which is the false positive the
      // verification pass exists to remove, wearing a label.
      const gapList = Array.isArray(gaps) ? gaps : [];

      // B12: stamped by scripts/review-round.js, never by a reviewer.
      if (d.convergence !== undefined) {
        if (!isObject(d.convergence)) {
          errors.push('convergence: must be an object if present');
        } else {
          if (!Number.isInteger(d.convergence.round) || d.convergence.round < 1) {
            errors.push('convergence.round: required integer >= 1');
          }
          const s = d.convergence.suppressed;
          if (!isObject(s)) errors.push('convergence.suppressed: required object {total, carriedOver, new}');
          else {
            for (const key of ['total', 'carriedOver', 'new']) {
              if (!Number.isInteger(s[key]) || s[key] < 0) errors.push(`convergence.suppressed.${key}: required integer >= 0`);
            }
            if (Number.isInteger(s.total) && Number.isInteger(s.carriedOver) && Number.isInteger(s.new) &&
                s.total !== s.carriedOver + s.new) {
              errors.push(`convergence.suppressed.total: must equal carriedOver + new (${s.carriedOver} + ${s.new})`);
            }
          }
        }
      }

      // B11: what the verification pass dropped. A discard with no reason is
      // indistinguishable from a finding that was quietly deleted, which is the
      // one outcome the record exists to rule out.
      if (d.discardedFindings !== undefined) {
        if (!Array.isArray(d.discardedFindings)) {
          errors.push('discardedFindings: must be an array if present');
        } else {
          d.discardedFindings.forEach((entry, i) => {
            const where = `discardedFindings[${i}]`;
            if (!isObject(entry)) {
              errors.push(`${where}: must be an object`);
              return;
            }
            if (!isNonEmptyString(entry.file) && !isNonEmptyString(entry.component)) {
              errors.push(`${where}.file: required string (legacy key "component" accepted)`);
            }
            if (!CLAIM_KEYS.some((key) => isNonEmptyString(entry[key]))) {
              errors.push(`${where}.evidence: required string (the claim that was discarded; ${CLAIM_KEYS.join('/')} accepted)`);
            }
            if (!isNonEmptyString(entry.reason)) {
              errors.push(
                `${where}.reason: required non-empty string - a discard records what the source ` +
                  'actually says at the line you re-read, so a dropped finding is evidence the ' +
                  'verification pass ran rather than a finding that quietly vanished'
              );
            }
          });
        }
      }

      if (!Array.isArray(d.findings)) {
        errors.push('findings: required array');
        return;
      }
      d.findings.forEach((finding, i) => validateFinding(finding, i, errors));
      d.findings.forEach((finding, i) => {
        if (!isObject(finding)) return;
        if (normalizeConfidence(finding.confidence) !== 'needs-verification') return;
        if (gapList.length === 0) {
          errors.push(
            `findings[${i}].confidence: "needs-verification" requires a matching ${GAPS_KEY} entry ` +
              'naming what blocked the re-read - it marks source that could not be verified, not a ' +
              'finding that was not checked'
          );
        }
      });
      // Two findings sharing an id would each claim the other's disposition, so the
      // per-finding attribution B9 buys would be exactly as coarse as the review-level
      // number it replaces.
      const seen = new Set();
      d.findings.forEach((finding, i) => {
        if (!isObject(finding) || typeof finding.id !== 'string') return;
        if (seen.has(finding.id)) errors.push(`findings[${i}].id: duplicate finding id "${finding.id}"`);
        seen.add(finding.id);
      });
    },
  },

  wrap: {
    fields: [
      { field: 'brief', type: 'string', required: 'yes', description: '3-6 sentence plain-language recap of the whole session: goal, what changed, notable decisions/corrections, outcome + open follow-ups. Rendered above the SESSION WRAPPED box.' },
      { field: 'pr', type: 'object | `null`', required: 'yes', description: 'PR details, or null if no PR' },
      { field: 'pr.number', type: 'number', required: 'yes', description: 'PR number' },
      { field: 'pr.url', type: 'string', required: 'yes', description: 'PR URL' },
      { field: 'pr.status', type: 'string', required: 'yes', description: 'PR status: `"open"` is what wrap writes — PRs are created ready for review (see `reference/wrap/ship-ceremony.md` §4); `"merged"`, `"closed"`. `"draft"` stays legal for legacy sessions. The Stop-hook gate (`hooks/greploop-gate.js`) gates on PR *liveness* — it blocks any PR that is NOT `merged`/`closed` (matched case-insensitively), so `"open"` or legacy `"draft"` is still gated until greploop settles.' },
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
    throw new GorkhaliError(
      'Usage: validate-artifact.js <artifact-type> <file-path>\n' +
        'Types: context intent brainstorm decisions plan execution verification review wrap pause-state',
      'USAGE'
    );
  }

  const resolvedPath = filePath.replace(/^~/, process.env.HOME);

  if (!fs.existsSync(resolvedPath)) {
    throw new GorkhaliError(`ERROR: File not found: ${resolvedPath}`, 'IO_ERROR');
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (e) {
    throw new GorkhaliError(`ERROR: Invalid JSON in ${resolvedPath}: ${e.message}`, 'PARSE_ERROR');
  }

  if (!SCHEMAS[artifactType]) {
    const knownTypes = Object.keys(SCHEMAS);
    throw new GorkhaliError(
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

module.exports = { SCHEMAS, validate, validateMeta, main, EXECUTION_TASK_STATUSES };

if (require.main === module) {
  try {
    main(process.argv);
  } catch (err) {
    reportError(err);
  }
}
