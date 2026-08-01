#!/usr/bin/env node
// Author: Subash Karki

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  isMainModule,
  now,
  parseArgs,
  readJson,
  sessionPaths,
  workspacePath,
} from './lib/portable.mjs';
import {
  canonicalJson,
  isPortableWorkflowPath,
  validateEvaluationResult,
  validateSchema,
} from './lib/workflow-contracts.mjs';
import {
  appendWorkflowEvent,
  readWorkflowJournal,
  workflowPaths,
} from './lib/workflow-journal.mjs';
import { readRegularFileOnce, readStableJsonFile } from './lib/filesystem-snapshot.mjs';
import {
  workflowCompilationContext,
  workflowStartContext,
  worktreeFingerprint,
} from './phantom-state.mjs';

const BROKER_ONLY_EVENTS = new Set([
  'capability.decision',
  'capability.outcome',
  'parallel.branch.started',
  'parallel.branch.completed',
  'parallel.branch.retry_requested',
  'parallel.aggregated',
]);
const PUBLIC_EVENT_TYPES = new Set([
  'workflow.started',
  'worktree.changed',
  'node.started',
  'node.completed',
  'node.failed',
  'node.invalidated',
  'evaluation.recorded',
  'budget.exhausted',
]);
const OUTPUT_SCHEMAS = Object.freeze({
  'aggregation-result-v2': 'aggregation-result.schema.json',
  'evaluation-result-v1': 'evaluation-result.schema.json',
  'workflow-output-v1': 'workflow-output.schema.json',
});
const compareText = (left, right) => (left < right ? -1 : (left > right ? 1 : 0));

const within = (root, candidate) => {
  const offset = relative(root, candidate);
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset));
};

const exactKeys = (value, required, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const expected = new Set(required);
  for (const field of required) {
    if (!Object.hasOwn(value, field)) throw new Error(`${label}.${field} is required.`);
  }
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) throw new Error(`${label}.${field} is unsupported.`);
  }
};

const exactStringSet = (actual, expected, label) => {
  if (!Array.isArray(actual)
    || actual.some((value) => typeof value !== 'string')
    || new Set(actual).size !== actual.length
    || new Set(expected).size !== expected.length
    || canonicalJson([...actual].sort()) !== canonicalJson([...expected].sort())) {
    throw new Error(`${label} must exactly match the declared artifacts or checks.`);
  }
};

const nonnegativeUsage = (payload, label) => {
  if (typeof payload.cost_units !== 'number' || !Number.isFinite(payload.cost_units) || payload.cost_units < 0) {
    throw new Error(`${label}.cost_units must be a non-negative number.`);
  }
  if (!Number.isInteger(payload.duration_ms) || payload.duration_ms < 0) {
    throw new Error(`${label}.duration_ms must be a non-negative integer.`);
  }
};

function artifactRecord(sessionDir, artifactRef) {
  if (!isPortableWorkflowPath(artifactRef) || artifactRef === '.') {
    throw new Error(`Artifact reference must be a normalized session-relative file: ${artifactRef}`);
  }
  const root = resolve(realpathSync(sessionDir));
  const candidate = resolve(root, artifactRef);
  if (!within(root, candidate)) throw new Error(`Artifact escapes the active session: ${artifactRef}`);
  let file;
  try {
    file = readRegularFileOnce(candidate, root);
  } catch (error) {
    throw new Error(`Artifact must be one stable regular non-symlink file: ${artifactRef}: ${error.message}`);
  }
  return {
    artifact_ref: artifactRef,
    bytes: file.bytes,
    digest: `sha256:${createHash('sha256').update(file.bytes).digest('hex')}`,
  };
}

export function loadArtifactRecords(sessionDir, refs) {
  return [...refs].sort().map((artifactRef) => artifactRecord(sessionDir, artifactRef));
}

export function artifactDigests(records) {
  return records.map(({ artifact_ref: artifactRef, digest }) => ({ artifact_ref: artifactRef, digest }));
}

function schemaForOutput(outputSchema) {
  const candidate = OUTPUT_SCHEMAS[outputSchema];
  if (!candidate) return null;
  try {
    return JSON.parse(readFileSync(new URL(`../schemas/${candidate}`, import.meta.url), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function validateArtifactSchemas(records, outputSchema, expectedNodeId = null) {
  const schema = schemaForOutput(outputSchema);
  if (!schema) throw new Error(`Output schema is not registered: ${outputSchema}`);
  const values = [];
  for (const record of records) {
    let value;
    try {
      value = JSON.parse(record.bytes.toString('utf8'));
    } catch (error) {
      throw new Error(`Artifact ${record.artifact_ref} is not valid JSON: ${error.message}`);
    }
    const errors = validateSchema(schema, value);
    if (errors.length) {
      throw new Error(`Artifact ${record.artifact_ref} does not satisfy ${outputSchema}: ${errors.join('; ')}`);
    }
    if (expectedNodeId !== null && value.node_id !== expectedNodeId) {
      throw new Error(`Artifact ${record.artifact_ref} node_id does not match ${expectedNodeId}.`);
    }
    values.push(value);
  }
  return values;
}

const nodeById = (compiled, nodeId) => compiled.plan.nodes.find((node) => node.id === nodeId);

function computedInputs(snapshot, node, sessionDir) {
  return node.depends_on.flatMap((sourceNode) => {
    const source = snapshot.state.nodes[sourceNode];
    if (!source || source.status !== 'completed') throw new Error(`Dependency ${sourceNode} is not complete.`);
    return artifactDigests(loadArtifactRecords(sessionDir, source.artifact_refs))
      .map((binding) => ({ source_node: sourceNode, ...binding }));
  }).sort((left, right) => compareText(canonicalJson(left), canonicalJson(right)));
}

function assertSuppliedValue(supplied, canonical, label) {
  if (supplied !== undefined && canonicalJson(supplied) !== canonicalJson(canonical)) {
    throw new Error(`${label} does not match canonical runtime evidence.`);
  }
}

function completionPayload({ input, node, sessionDir }) {
  const payload = input.payload || {};
  exactKeys(payload, ['output_schema', 'artifact_digests', 'cost_units', 'duration_ms'], 'payload');
  const refs = input.artifact_refs || [];
  exactStringSet(refs, node.expected_artifacts || [], 'artifact_refs');
  if (payload.output_schema !== node.output_schema) throw new Error('payload.output_schema does not match the node contract.');
  const records = loadArtifactRecords(sessionDir, refs);
  const digests = artifactDigests(records);
  assertSuppliedValue(payload.artifact_digests, digests, 'payload.artifact_digests');
  nonnegativeUsage(payload, 'payload');
  if (payload.cost_units > node.budget.max_cost_units || payload.duration_ms > node.budget.max_duration_ms) {
    throw new Error(`Node ${node.id} completion exceeds its declared budget.`);
  }
  const artifacts = validateArtifactSchemas(records, node.output_schema, node.id);
  if (node.output_schema === 'workflow-output-v1'
    && artifacts.some((artifact) => artifact.status !== 'completed'
      || artifact.evidence.length === 0
      || artifact.evidence.some((item) => item.result !== 'passed'))) {
    throw new Error(`Node ${node.id} completion requires a completed artifact with passing evidence.`);
  }
  return { ...payload, artifact_digests: digests };
}

function assertOrdinaryEvent(eventType) {
  if (BROKER_ONLY_EVENTS.has(eventType)) {
    throw new Error(`${eventType} is broker-only and cannot be appended through advance-workflow.`);
  }
  if (!PUBLIC_EVENT_TYPES.has(eventType)) throw new Error(`Unsupported public workflow event: ${eventType}`);
}

export function canonicalEventInput({ input, compiled, snapshot, sessionDir, fingerprint }) {
  assertOrdinaryEvent(input.event_type);
  const node = input.node_id ? nodeById(compiled, input.node_id) : null;
  let payload = input.payload || {};
  let artifactRefs = input.artifact_refs || [];
  if (input.event_type === 'workflow.started' || input.event_type === 'worktree.changed') {
    exactKeys(payload, [], 'payload');
    exactStringSet(artifactRefs, [], 'artifact_refs');
    if (input.event_type === 'workflow.started' && fingerprint !== compiled.plan.baseline_fingerprint) {
      throw new Error('workflow.started requires the compiled baseline to match the current worktree fingerprint.');
    }
  } else if (!node) {
    throw new Error(`Unknown workflow node: ${input.node_id ?? 'missing'}`);
  } else if (input.event_type === 'node.started') {
    exactStringSet(artifactRefs, [], 'artifact_refs');
    const inputRefs = computedInputs(snapshot, node, sessionDir);
    if (Object.keys(payload).length) {
      exactKeys(payload, ['input_refs'], 'payload');
      assertSuppliedValue(payload.input_refs, inputRefs, 'payload.input_refs');
    }
    payload = { input_refs: inputRefs };
  } else if (input.event_type === 'node.completed') {
    payload = completionPayload({ input, node, sessionDir });
  } else if (input.event_type === 'node.failed') {
    exactStringSet(artifactRefs, [], 'artifact_refs');
    exactKeys(payload, ['failure_class', 'cost_units', 'duration_ms'], 'payload');
    if (typeof payload.failure_class !== 'string' || !payload.failure_class) {
      throw new Error('payload.failure_class is required.');
    }
    nonnegativeUsage(payload, 'payload');
  } else if (input.event_type === 'node.invalidated') {
    exactStringSet(artifactRefs, [], 'artifact_refs');
    exactKeys(payload, ['reason'], 'payload');
    if (typeof payload.reason !== 'string' || !payload.reason) throw new Error('payload.reason is required.');
  } else if (input.event_type === 'evaluation.recorded') {
    exactStringSet(artifactRefs, node.expected_artifacts || [], 'artifact_refs');
    const records = loadArtifactRecords(sessionDir, artifactRefs);
    const digests = artifactDigests(records);
    assertSuppliedValue(payload.artifact_digests, digests, 'payload.artifact_digests');
    const artifactPayload = { ...payload };
    delete artifactPayload.artifact_digests;
    const artifacts = validateArtifactSchemas(records, 'evaluation-result-v1', node.id);
    if (artifacts.some((artifact) => Object.hasOwn(artifact, 'artifact_digests')
      || canonicalJson(artifact) !== canonicalJson(artifactPayload))) {
      throw new Error('Evaluation artifacts must exactly contain the canonical evaluation result.');
    }
    payload = { ...artifactPayload, artifact_digests: digests };
    const errors = validateEvaluationResult(payload);
    if (errors.length) throw new Error(`Invalid evaluation payload: ${errors.join('; ')}`);
  } else if (input.event_type === 'budget.exhausted') {
    exactStringSet(artifactRefs, [], 'artifact_refs');
    exactKeys(payload, ['failure_class'], 'payload');
    if (payload.failure_class !== 'budget_exhausted') {
      throw new Error('payload.failure_class must be budget_exhausted.');
    }
  }
  if (Object.hasOwn(input, 'worktree_fingerprint') && input.worktree_fingerprint !== fingerprint) {
    throw new Error('Caller worktree_fingerprint does not match canonical runtime evidence.');
  }
  let producerRole = 'apex';
  if (input.event_type === 'evaluation.recorded') {
    producerRole = node.evaluator_role;
  } else if (['node.started', 'node.completed', 'node.failed'].includes(input.event_type)) {
    if (node?.kind === 'task') producerRole = node.role;
    if (node?.kind === 'evaluate-optimize') producerRole = node.generator_role;
  }
  return {
    event_id: input.event_id,
    event_type: input.event_type,
    node_id: input.node_id ?? null,
    recorded_at: now(),
    artifact_refs: artifactRefs,
    worktree_fingerprint: fingerprint,
    producer: { role: producerRole, runtime: 'advance-workflow-v1' },
    payload,
  };
}

function assertCompiledBinding(compiled, context) {
  const binding = compiled?.plan?.session_binding;
  if (!binding || canonicalJson(binding) !== canonicalJson(context.session_binding)) {
    throw new Error('Compiled workflow is not bound to the canonical active session and approved plan.');
  }
  if (compiled.plan.route !== context.current.session.route) {
    throw new Error('Compiled workflow route does not match the active session.');
  }
}

export function advanceWorkflowFile(options) {
  for (const field of ['offlineTest', 'sessionDir']) {
    if (Object.hasOwn(options, field)) {
      throw new Error(`advance-workflow ${field} is not available on the production file entry point.`);
    }
  }
  const { workspace, task, input } = options;
  if (!input) throw new Error('advance-workflow requires --input <event-input.json>.');
  const canonicalWorkspace = workspacePath(workspace);
  const canonicalSession = sessionPaths(canonicalWorkspace, task).sessionDir;
  const compiled = readJson(workflowPaths(canonicalSession).planFile);
  if (!compiled) throw new Error('Workflow plan is not initialized for this canonical session.');
  const eventInput = readStableJsonFile(resolve(input)).value;
  assertOrdinaryEvent(eventInput.event_type);
  const fingerprint = worktreeFingerprint(canonicalWorkspace);
  const context = eventInput.event_type === 'workflow.started'
    ? workflowStartContext(canonicalWorkspace)
    : workflowCompilationContext(canonicalWorkspace, { requireDefectProof: false });
  if (sessionPaths(canonicalWorkspace, task).task !== context.current.paths.task) {
    throw new Error(`Requested task ${task} is not the canonical active task ${context.current.paths.task}.`);
  }
  assertCompiledBinding(compiled, context);
  const snapshot = readWorkflowJournal(canonicalSession, compiled);
  const canonicalInput = canonicalEventInput({
    input: eventInput,
    compiled,
    snapshot,
    sessionDir: canonicalSession,
    fingerprint,
  });
  return appendWorkflowEvent({
    sessionDir: canonicalSession,
    compiled,
    input: canonicalInput,
    expected_previous_event_digest: eventInput.expected_previous_event_digest,
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (!args.task) throw new Error('advance-workflow requires --task <id> and --workspace <path>.');
    if (args.plan) throw new Error('--plan is unsupported; only the canonical session-bound plan may advance.');
    for (const field of ['offline-test', 'session-dir']) {
      if (args[field] !== undefined) throw new Error(`advance-workflow --${field} is unsupported.`);
    }
    const result = advanceWorkflowFile({
      workspace: args.workspace,
      task: args.task,
      input: args.input,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) main();
