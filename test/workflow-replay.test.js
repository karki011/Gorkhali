// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FINGERPRINT = `sha256:${'3'.repeat(64)}`;

const plan = () => ({
  schema_version: 2,
  workflow_id: 'wf-replay-1',
  route: 'direct',
  risk: 'low',
  baseline_fingerprint: FINGERPRINT,
  session_binding: {
    repo_id: 'fixture', task_id: 'replay-test', route: 'direct', approved_plan: null,
  },
  routing: {
    recommended_route: 'direct', confidence: 0.95, fallback_route: null, signals: {},
  },
  execution_mode: 'attended',
  acceptance_criteria: ['journal replay reproduces live state'],
  budget: { max_cost_units: 10, max_duration_ms: 10_000, max_attempts: 3 },
  nodes: [{
    id: 'work', kind: 'task', depends_on: [], retry_limit: 1,
    budget: { max_cost_units: 5, max_duration_ms: 5_000 },
    role: 'blade', output_schema: 'workflow-output-v1', expected_artifacts: ['work.json'],
    acceptance_criteria: ['work artifact is complete'],
  }],
});

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-workflow-replay-'));
const digestBytes = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const workflowOutput = () => Buffer.from(JSON.stringify({
  schema_version: 1,
  node_id: 'work',
  status: 'completed',
  evidence: [{ name: 'unit', result: 'passed' }],
  output: {},
}));

const writeCapabilityArtifact = ({ sessionDir, kind, value, canonicalJson, digestValue }) => {
  const digest = digestValue(value);
  const artifactRef = `capability/artifacts/${kind}/${digest.slice('sha256:'.length)}.json`;
  const file = path.join(sessionDir, artifactRef);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
  return { artifactRef, digest, file, value };
};

test('append-only journal replays to the materialized control-plane state', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { replayWorkflowDirectory } = await import('../skills/phantom/scripts/replay-workflow.mjs');
  const {
    appendWorkflowEvent,
    replayWorkflow,
    replayWorkflowSession,
    workflowPaths,
    writeCompiledWorkflow,
  } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const sessionDir = fixture();
  const compiled = compileWorkflow(plan());
  assert.equal(compiled.schema_version, 2);
  writeCompiledWorkflow(sessionDir, compiled);
  const artifactBytes = workflowOutput();
  const artifactDigest = digestBytes(artifactBytes);
  fs.writeFileSync(path.join(sessionDir, 'work.json'), artifactBytes);
  const append = (input) => appendWorkflowEvent({
    sessionDir,
    compiled,
    input: { worktree_fingerprint: FINGERPRINT, ...input },
  });
  append({
    event_id: 'evt-replay-1', recorded_at: '2026-07-31T12:04:01.000Z',
    event_type: 'workflow.started', producer: { role: 'apex', runtime: 'test' },
    worktree_fingerprint: FINGERPRINT,
  });
  append({
    event_id: 'evt-replay-2', recorded_at: '2026-07-31T12:04:02.000Z',
    event_type: 'node.started', node_id: 'work', producer: { role: 'blade', runtime: 'test' },
    payload: { input_refs: [] },
  });
  const completed = append({
    event_id: 'evt-replay-3', recorded_at: '2026-07-31T12:04:03.000Z',
    event_type: 'node.completed', node_id: 'work', producer: { role: 'blade', runtime: 'test' },
    artifact_refs: ['work.json'], worktree_fingerprint: FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'work.json', digest: artifactDigest }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  assert.equal(completed.state.status, 'accepted');

  const replayed = replayWorkflowSession(sessionDir);
  const materialized = JSON.parse(fs.readFileSync(workflowPaths(sessionDir).stateFile, 'utf8'));
  assert.deepEqual(replayed.state, materialized);
  assert.deepEqual(replayWorkflow(compiled, replayed.events), materialized);
  assert.equal(materialized.schema_version, 1);
  assert.ok(replayed.events.every((event) => event.schema_version === 2));
  assert.equal(replayed.events.length, 3);
  assert.equal(replayed.events[1].previous_event_digest, replayed.events[0].event_digest);

  const output = path.join(sessionDir, 'replay-report.json');
  const report = replayWorkflowDirectory({ sessionDir, output });
  assert.deepEqual(report.legal_transitions, [
    { event_type: 'worktree.changed', node_id: null },
    { event_type: 'node.invalidated', node_id: 'work' },
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), {
    state: report.state,
    legal_transitions: report.legal_transitions,
  });
});

test('authoritative replay rejects missing, mutated, linked, and symlinked artifacts', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const {
    appendWorkflowEvent,
    replayWorkflowSession,
    writeCompiledWorkflow,
  } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const sessionDir = fixture();
  const declared = plan();
  declared.nodes[0].expected_artifacts = ['artifacts/work.json'];
  const compiled = compileWorkflow(declared);
  const artifactRef = 'artifacts/work.json';
  const artifactFile = path.join(sessionDir, artifactRef);
  const artifactBytes = workflowOutput();
  const artifactDigest = digestBytes(artifactBytes);
  writeCompiledWorkflow(sessionDir, compiled);
  fs.mkdirSync(path.dirname(artifactFile));
  fs.writeFileSync(artifactFile, artifactBytes);
  const append = (input) => appendWorkflowEvent({
    sessionDir,
    compiled,
    input: { worktree_fingerprint: FINGERPRINT, ...input },
  });
  append({
    event_id: 'evt-artifact-1', recorded_at: '2026-07-31T12:14:01.000Z',
    event_type: 'workflow.started', producer: { role: 'apex' },
  });
  append({
    event_id: 'evt-artifact-2', recorded_at: '2026-07-31T12:14:02.000Z',
    event_type: 'node.started', node_id: 'work', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  append({
    event_id: 'evt-artifact-3', recorded_at: '2026-07-31T12:14:03.000Z',
    event_type: 'node.completed', node_id: 'work', producer: { role: 'blade' },
    artifact_refs: [artifactRef],
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: artifactRef, digest: artifactDigest }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  assert.equal(replayWorkflowSession(sessionDir).state.status, 'accepted');

  fs.writeFileSync(artifactFile, 'mutated');
  assert.throws(() => replayWorkflowSession(sessionDir), /work\.json digest mismatch/);

  fs.writeFileSync(artifactFile, artifactBytes);
  const alias = path.join(sessionDir, 'work-alias.json');
  fs.linkSync(artifactFile, alias);
  assert.throws(() => replayWorkflowSession(sessionDir), /single-link regular file/);
  fs.unlinkSync(alias);

  const target = path.join(path.dirname(artifactFile), 'work-target.json');
  fs.renameSync(artifactFile, target);
  fs.symlinkSync('work-target.json', artifactFile);
  assert.throws(() => replayWorkflowSession(sessionDir), /work\.json.*missing or unsafe/);
  fs.unlinkSync(artifactFile);

  fs.renameSync(target, artifactFile);
  const artifactDirectory = path.dirname(artifactFile);
  const inSessionTarget = path.join(sessionDir, 'artifacts-real');
  fs.renameSync(artifactDirectory, inSessionTarget);
  fs.symlinkSync(path.basename(inSessionTarget), artifactDirectory, 'dir');
  assert.throws(() => replayWorkflowSession(sessionDir), /work\.json.*missing or unsafe/);

  fs.unlinkSync(artifactDirectory);
  const outsideRoot = fixture();
  const outsideTarget = path.join(outsideRoot, 'artifacts');
  fs.renameSync(inSessionTarget, outsideTarget);
  fs.symlinkSync(outsideTarget, artifactDirectory, 'dir');
  assert.throws(() => replayWorkflowSession(sessionDir), /work\.json.*missing or unsafe/);

  fs.unlinkSync(artifactDirectory);
  assert.throws(() => replayWorkflowSession(sessionDir), /work\.json.*missing or unsafe/);
});

test('append rejects artifact reference rebinding before journaling an invalidated retry', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const {
    appendWorkflowEvent,
    workflowPaths,
    writeCompiledWorkflow,
  } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const sessionDir = fixture();
  const compiled = compileWorkflow(plan());
  const artifactFile = path.join(sessionDir, 'work.json');
  writeCompiledWorkflow(sessionDir, compiled);

  const append = (input) => appendWorkflowEvent({
    sessionDir,
    compiled,
    input: { worktree_fingerprint: FINGERPRINT, ...input },
  });
  append({
    event_id: 'evt-rebind-1', recorded_at: '2026-07-31T12:15:01.000Z',
    event_type: 'workflow.started', producer: { role: 'apex' },
  });
  append({
    event_id: 'evt-rebind-2', recorded_at: '2026-07-31T12:15:02.000Z',
    event_type: 'node.started', node_id: 'work', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  const initialBytes = workflowOutput();
  fs.writeFileSync(artifactFile, initialBytes);
  append({
    event_id: 'evt-rebind-3', recorded_at: '2026-07-31T12:15:03.000Z',
    event_type: 'node.completed', node_id: 'work', producer: { role: 'blade' },
    artifact_refs: ['work.json'],
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'work.json', digest: digestBytes(initialBytes) }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  append({
    event_id: 'evt-rebind-4', recorded_at: '2026-07-31T12:15:04.000Z',
    event_type: 'node.invalidated', node_id: 'work', producer: { role: 'apex' },
    payload: { reason: 'rebuild the artifact' },
  });
  append({
    event_id: 'evt-rebind-5', recorded_at: '2026-07-31T12:15:05.000Z',
    event_type: 'node.started', node_id: 'work', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });

  const replacementBytes = Buffer.from(JSON.stringify({
    schema_version: 1,
    node_id: 'work',
    status: 'completed',
    evidence: [{ name: 'unit', result: 'passed' }],
    output: { generation: 2 },
  }));
  fs.writeFileSync(artifactFile, replacementBytes);
  const journalFile = workflowPaths(sessionDir).journalFile;
  const recordsBefore = fs.readFileSync(journalFile, 'utf8').trimEnd().split('\n');
  assert.throws(() => append({
    event_id: 'evt-rebind-6', recorded_at: '2026-07-31T12:15:06.000Z',
    event_type: 'node.completed', node_id: 'work', producer: { role: 'blade' },
    artifact_refs: ['work.json'],
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'work.json', digest: digestBytes(replacementBytes) }],
      cost_units: 1,
      duration_ms: 100,
    },
  }), /artifact reference work\.json.*(?:rebound|immutable)/i);
  const recordsAfter = fs.readFileSync(journalFile, 'utf8').trimEnd().split('\n');
  assert.deepEqual(recordsAfter, recordsBefore);
});

test('replay rejects corruption, reordering, duplicate IDs, and partial records', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { digestValue } = await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
  const {
    buildWorkflowEvent,
    parseWorkflowJournal,
    replayWorkflow,
  } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const compiled = compileWorkflow(plan());
  const first = buildWorkflowEvent(null, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-duplicate',
    recorded_at: '2026-07-31T12:05:01.000Z',
    event_type: 'workflow.started',
    worktree_fingerprint: FINGERPRINT,
    producer: { role: 'apex' },
  });
  const second = buildWorkflowEvent(first, {
    workflow_id: compiled.plan.workflow_id,
    event_id: 'evt-start-work',
    recorded_at: '2026-07-31T12:05:02.000Z',
    event_type: 'node.started',
    node_id: 'work',
    producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  const legacyEvent = structuredClone(first);
  legacyEvent.schema_version = 1;
  const { event_digest: legacyDigest, ...legacyUnsigned } = legacyEvent;
  void legacyDigest;
  legacyEvent.event_digest = digestValue(legacyUnsigned);
  assert.throws(
    () => replayWorkflow(compiled, [legacyEvent]),
    /unsupported workflow event contract version 1; expected 2/,
  );
  assert.throws(() => replayWorkflow(compiled, [second, first]), /sequence must be 1/);

  const tampered = structuredClone(second);
  tampered.payload.changed = true;
  assert.throws(() => replayWorkflow(compiled, [first, tampered]), /payload digest is invalid/);

  const duplicate = structuredClone(second);
  duplicate.event_id = first.event_id;
  const { event_digest: ignored, ...unsigned } = duplicate;
  void ignored;
  duplicate.event_digest = digestValue(unsigned);
  assert.throws(() => replayWorkflow(compiled, [first, duplicate]), /Duplicate workflow event_id/);

  assert.throws(() => parseWorkflowJournal(`${JSON.stringify(first)}\n{"broken"`), /line 2 is invalid JSON/);
  assert.throws(() => parseWorkflowJournal(`${JSON.stringify(first)}\n\n`), /empty record/);
});

test('optimistic tail binding rejects a concurrent stale append', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const {
    appendWorkflowEvent,
    WorkflowJournalConflictError,
  } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const compiled = compileWorkflow(plan());
  const sessionDir = fixture();
  const first = appendWorkflowEvent({
    sessionDir,
    compiled,
    expected_previous_event_digest: null,
    input: {
      event_id: 'evt-tail-1', recorded_at: '2026-07-31T12:06:01.000Z',
      event_type: 'workflow.started', producer: { role: 'apex' },
      worktree_fingerprint: FINGERPRINT,
    },
  });
  assert.throws(() => appendWorkflowEvent({
    sessionDir,
    compiled,
    expected_previous_event_digest: null,
    input: {
      event_id: 'evt-tail-2', recorded_at: '2026-07-31T12:06:02.000Z',
      event_type: 'node.started', node_id: 'work', producer: { role: 'blade' },
    },
  }), (error) => error instanceof WorkflowJournalConflictError
    && error.code === 'WORKFLOW_JOURNAL_CONFLICT'
    && error.actual === first.event.event_digest);
});

test('canonical capability events are audited without advancing the active node', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const {
    appendWorkflowEvent,
    replayWorkflowSession,
  } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const {
    canonicalJson,
    digestValue,
  } = await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
  const compiled = compileWorkflow(plan());
  const sessionDir = fixture();
  const append = (input) => appendWorkflowEvent({
    sessionDir,
    compiled,
    input: { worktree_fingerprint: FINGERPRINT, ...input },
  });
  append({
    event_id: 'evt-capability-1', recorded_at: '2026-07-31T12:07:01.000Z',
    event_type: 'workflow.started', producer: { role: 'apex' },
    worktree_fingerprint: FINGERPRINT,
  });
  const started = append({
    event_id: 'evt-capability-2', recorded_at: '2026-07-31T12:07:02.000Z',
    event_type: 'node.started', node_id: 'work', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  const request = {
    schema_version: 1,
    type: 'workspace.write',
    request_id: 'request-1',
    workflow_id: compiled.plan.workflow_id,
    node_id: 'work',
    worktreeFingerprint: FINGERPRINT,
    paths: ['work.json'],
    patchDigest: `sha256:${'4'.repeat(64)}`,
    budget: { maxCostUnits: 0.5, maxDurationMs: 50 },
  };
  const requestArtifact = writeCapabilityArtifact({
    sessionDir,
    kind: 'requests',
    value: request,
    canonicalJson,
    digestValue,
  });
  const requestDigest = requestArtifact.digest;
  const decisionUnsigned = {
    schema_version: 1,
    request_id: 'request-1',
    idempotency_key: `workspace.write:${request.patchDigest}`,
    capability_type: 'workspace.write',
    request_digest: requestDigest,
    decision: 'authorized',
    reason: 'Bound authorization is valid',
    reserved_budget: { cost_units: 0.5, duration_ms: 50 },
  };
  const decisionPayload = { ...decisionUnsigned, decision_digest: digestValue(decisionUnsigned) };
  const executionNonce = Buffer.alloc(32, 5).toString('base64url');
  const reservationBinding = {
    schema_version: 2,
    reservation_kind: 'native-tool-execution',
    decision_digest: decisionPayload.decision_digest,
    request_digest: requestDigest,
    request_id: request.request_id,
    workflow_id: request.workflow_id,
    node_id: request.node_id,
    capability_type: request.type,
    idempotency_key: decisionPayload.idempotency_key,
    execution_nonce: executionNonce,
    authorized_journal_tail_digest: started.event.event_digest,
    workspace_evidence_digest_before: null,
    created_at: '2026-07-31T12:07:02.500Z',
    request,
    reserved_budget: decisionPayload.reserved_budget,
    hard_enforcement: { adapter_binding: 'native-tool-gate-v1' },
    host_adapter: null,
  };
  const reservationArtifact = writeCapabilityArtifact({
    sessionDir,
    kind: 'reservations',
    value: reservationBinding,
    canonicalJson,
    digestValue,
  });
  const artifactRefs = [requestArtifact.artifactRef, reservationArtifact.artifactRef];

  const reboundUnsigned = {
    ...decisionUnsigned,
    decision: 'denied',
    reason: 'policy denied',
    reserved_budget: null,
  };
  const otherRequest = writeCapabilityArtifact({
    sessionDir,
    kind: 'requests',
    value: { ...request, request_id: 'rebound-request' },
    canonicalJson,
    digestValue,
  });
  assert.throws(() => append({
    event_id: 'evt-capability-rebound', recorded_at: '2026-07-31T12:07:02.750Z',
    event_type: 'capability.decision', node_id: 'work', producer: { role: 'capability-broker' },
    artifact_refs: [otherRequest.artifactRef],
    payload: { ...reboundUnsigned, decision_digest: digestValue(reboundUnsigned) },
  }), /request evidence was rebound/);

  const decision = append({
    event_id: 'evt-capability-3', recorded_at: '2026-07-31T12:07:03.000Z',
    event_type: 'capability.decision', node_id: 'work', producer: { role: 'capability-broker' },
    artifact_refs: artifactRefs,
    payload: decisionPayload,
  });
  assert.equal(decision.state.nodes.work.status, 'running');
  assert.equal(decision.state.nodes.work.capability_event_count, 1);

  const outcomeUnsigned = {
    schema_version: 2,
    outcome_kind: 'native-tool-execution',
    request_id: 'request-1',
    idempotency_key: decisionPayload.idempotency_key,
    capability_type: 'workspace.write',
    request_digest: requestDigest,
    decision_digest: decisionPayload.decision_digest,
    reservation_digest: reservationArtifact.digest,
    execution_nonce: executionNonce,
    status: 'succeeded',
    external_reference: null,
    error: null,
    recorded_at: '2026-07-31T12:07:04.000Z',
    budget_charge: decisionPayload.reserved_budget,
  };
  const outcome = append({
    event_id: 'evt-capability-4', recorded_at: '2026-07-31T12:07:04.000Z',
    event_type: 'capability.outcome', node_id: 'work', producer: { role: 'capability-broker' },
    artifact_refs: artifactRefs,
    payload: { ...outcomeUnsigned, outcome_digest: digestValue(outcomeUnsigned) },
  });
  assert.equal(outcome.state.nodes.work.status, 'running');
  assert.equal(outcome.state.nodes.work.capability_event_count, 2);
  assert.equal(outcome.state.nodes.work.latest_capability_event.event_type, 'capability.outcome');

  assert.equal(replayWorkflowSession(sessionDir).state.nodes.work.capability_event_count, 2);
  const requestBytes = fs.readFileSync(requestArtifact.file);
  fs.writeFileSync(requestArtifact.file, `${canonicalJson({ ...request, request_id: 'mutated' })}\n`);
  assert.throws(() => replayWorkflowSession(sessionDir), /requests\/.*digest mismatch/);

  fs.writeFileSync(requestArtifact.file, `${JSON.stringify(request, null, 2)}\n`);
  assert.throws(() => replayWorkflowSession(sessionDir), /not canonical JSON/);

  fs.writeFileSync(requestArtifact.file, requestBytes);
  const alias = `${requestArtifact.file}.alias`;
  fs.linkSync(requestArtifact.file, alias);
  assert.throws(() => replayWorkflowSession(sessionDir), /single-link regular file/);
  fs.unlinkSync(alias);

  const target = `${requestArtifact.file}.target`;
  fs.renameSync(requestArtifact.file, target);
  fs.symlinkSync(path.basename(target), requestArtifact.file);
  assert.throws(() => replayWorkflowSession(sessionDir), /requests\/.*missing or unsafe/);
  fs.unlinkSync(requestArtifact.file);

  fs.renameSync(target, requestArtifact.file);
  const requestDirectory = path.dirname(requestArtifact.file);
  const inSessionTarget = `${requestDirectory}-real`;
  fs.renameSync(requestDirectory, inSessionTarget);
  fs.symlinkSync(path.basename(inSessionTarget), requestDirectory, 'dir');
  assert.throws(() => replayWorkflowSession(sessionDir), /requests\/.*missing or unsafe/);

  fs.unlinkSync(requestDirectory);
  const outsideRoot = fixture();
  const outsideTarget = path.join(outsideRoot, 'requests');
  fs.renameSync(inSessionTarget, outsideTarget);
  fs.symlinkSync(outsideTarget, requestDirectory, 'dir');
  assert.throws(() => replayWorkflowSession(sessionDir), /requests\/.*missing or unsafe/);

  fs.unlinkSync(requestDirectory);
  assert.throws(() => replayWorkflowSession(sessionDir), /requests\/.*missing or unsafe/);
});

test('replay rejects capability execution evidence reused across workflow nodes', async () => {
  const { compileWorkflow } = await import('../skills/phantom/scripts/lib/workflow-kernel.mjs');
  const { digestValue } = await import('../skills/phantom/scripts/lib/workflow-contracts.mjs');
  const {
    buildWorkflowEvent,
    replayWorkflow,
  } = await import('../skills/phantom/scripts/lib/workflow-journal.mjs');
  const taskNode = (id) => ({
    id,
    kind: 'task',
    depends_on: [],
    retry_limit: 1,
    budget: { max_cost_units: 5, max_duration_ms: 5_000 },
    role: 'blade',
    output_schema: 'workflow-output-v1',
    expected_artifacts: [`${id}.json`],
    acceptance_criteria: [`${id} is complete`],
  });
  const compiled = compileWorkflow({
    ...plan(),
    workflow_id: 'wf-global-capability-evidence',
    nodes: [taskNode('work-a'), taskNode('work-b')],
  });
  const sessionDir = fixture();
  const events = [];
  let previous = null;
  const append = (input) => {
    const event = buildWorkflowEvent(previous, {
      workflow_id: compiled.plan.workflow_id,
      worktree_fingerprint: FINGERPRINT,
      ...input,
    });
    const state = replayWorkflow(compiled, [...events, event]);
    events.push(event);
    previous = event;
    return { event, state };
  };
  const digest = (value) => `sha256:${(value % 16).toString(16).repeat(64)}`;
  append({
    event_id: 'evt-global-capability-1', recorded_at: '2026-07-31T13:00:00.000Z',
    event_type: 'workflow.started', producer: { role: 'apex' },
    worktree_fingerprint: FINGERPRINT,
  });
  for (const [index, nodeId] of ['work-a', 'work-b'].entries()) {
    append({
      event_id: `evt-global-capability-start-${index}`,
      recorded_at: `2026-07-31T13:00:0${index + 1}.000Z`,
      event_type: 'node.started', node_id: nodeId, producer: { role: 'blade' },
      payload: { input_refs: [] },
    });
  }

  const decisions = [];
  for (const [index, nodeId] of ['work-a', 'work-b'].entries()) {
    const unsigned = {
      schema_version: 1,
      request_id: `request-${nodeId}`,
      idempotency_key: `effect:${nodeId}`,
      capability_type: 'github.openDraftPr',
      request_digest: digest(index + 4),
      decision: 'authorized',
      reason: 'Bound authorization is valid',
      reserved_budget: { cost_units: 0.5, duration_ms: 50 },
    };
    const payload = { ...unsigned, decision_digest: digestValue(unsigned) };
    decisions.push(payload);
  }

  const sharedNonce = Buffer.alloc(32, 12).toString('base64url');
  const outcome = (index, executionNonce = sharedNonce) => {
    const decision = decisions[index];
    const unsigned = {
      schema_version: 2,
      outcome_kind: 'signed-host-adapter-execution',
      request_id: decision.request_id,
      idempotency_key: decision.idempotency_key,
      capability_type: decision.capability_type,
      request_digest: decision.request_digest,
      decision_digest: decision.decision_digest,
      reservation_digest: digest(index + 6),
      execution_nonce: executionNonce,
      status: 'succeeded',
      external_reference: `https://example.invalid/pull/${index + 1}`,
      error: null,
      recorded_at: `2026-07-31T13:00:0${index + 5}.000Z`,
      registry_trust_digest: digest(index + 8),
      registration_digest: digest(index + 10),
      policy_digest: digest(index + 12),
      attestation_digest: digest(index + 14),
      result_digest: digest(index + 16),
      reconciliation_of: null,
      budget_charge: decision.reserved_budget,
    };
    return { ...unsigned, outcome_digest: digestValue(unsigned) };
  };
  append({
    event_id: 'evt-global-capability-decision-0', recorded_at: '2026-07-31T13:00:03.000Z',
    event_type: 'capability.decision', node_id: 'work-a',
    producer: { role: 'capability-broker' }, payload: decisions[0],
  });
  const firstOutcome = append({
    event_id: 'evt-global-capability-outcome-0', recorded_at: outcome(0).recorded_at,
    event_type: 'capability.outcome', node_id: 'work-a',
    producer: { role: 'capability-broker' }, payload: outcome(0),
  });
  assert.equal(firstOutcome.state.capability_decision_history.length, 1);
  assert.equal(firstOutcome.state.capability_outcome_history.length, 1);
  append({
    event_id: 'evt-global-capability-decision-1', recorded_at: '2026-07-31T13:00:06.000Z',
    event_type: 'capability.decision', node_id: 'work-b',
    producer: { role: 'capability-broker' }, payload: decisions[1],
  });
  assert.throws(() => append({
    event_id: 'evt-global-capability-outcome-1', recorded_at: outcome(1).recorded_at,
    event_type: 'capability.outcome', node_id: 'work-b',
    producer: { role: 'capability-broker' }, payload: outcome(1),
  }), /reservation or execution nonce is already recorded/);
  const uniqueNonce = Buffer.alloc(32, 13).toString('base64url');
  append({
    event_id: 'evt-global-capability-outcome-1-valid', recorded_at: outcome(1, uniqueNonce).recorded_at,
    event_type: 'capability.outcome', node_id: 'work-b',
    producer: { role: 'capability-broker' }, payload: outcome(1, uniqueNonce),
  });

  const workABytes = Buffer.from(JSON.stringify({
    schema_version: 1,
    node_id: 'work-a',
    status: 'completed',
    evidence: [{ name: 'unit', result: 'passed' }],
    output: {},
  }));
  fs.writeFileSync(path.join(sessionDir, 'work-a.json'), workABytes);
  append({
    event_id: 'evt-global-capability-complete-a', recorded_at: '2026-07-31T13:00:07.000Z',
    event_type: 'node.completed', node_id: 'work-a', producer: { role: 'blade' },
    artifact_refs: ['work-a.json'], worktree_fingerprint: FINGERPRINT,
    payload: {
      output_schema: 'workflow-output-v1',
      artifact_digests: [{ artifact_ref: 'work-a.json', digest: digestBytes(workABytes) }],
      cost_units: 1,
      duration_ms: 100,
    },
  });
  const invalidated = append({
    event_id: 'evt-global-capability-invalidate-a', recorded_at: '2026-07-31T13:00:08.000Z',
    event_type: 'node.invalidated', node_id: 'work-a', producer: { role: 'apex' },
    payload: { reason: 'force retry without restoring consumed capability evidence' },
  });
  assert.deepEqual(invalidated.state.nodes['work-a'].capability_outcomes, []);
  assert.equal(invalidated.state.capability_outcome_history.length, 2);
  append({
    event_id: 'evt-global-capability-restart-a', recorded_at: '2026-07-31T13:00:09.000Z',
    event_type: 'node.started', node_id: 'work-a', producer: { role: 'blade' },
    payload: { input_refs: [] },
  });
  assert.throws(() => append({
    event_id: 'evt-global-capability-replay-decision', recorded_at: '2026-07-31T13:00:10.000Z',
    event_type: 'capability.decision', node_id: 'work-a',
    producer: { role: 'capability-broker' }, payload: decisions[0],
  }), /decision digest is already recorded/);
});
