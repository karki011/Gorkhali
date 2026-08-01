// Author: Subash Karki
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const {
  stateEnvelopeErrors: analyticsEnvelopeErrors,
} = require('../scripts/lib/state-envelope-contract');

const CONTRACTS = pathToFileURL(path.join(
  __dirname,
  '..',
  'skills',
  'phantom',
  'scripts',
  'lib',
  'session-contracts.mjs',
)).href;
const PROFILE = pathToFileURL(path.join(
  __dirname,
  '..',
  'skills',
  'phantom',
  'scripts',
  'resolve-profile.mjs',
)).href;
const TIMESTAMP = '2026-07-31T12:00:00.000Z';

function validState(newLifecycle, bundleVersion) {
  const paths = {
    repo: { id: 'repo-contract-test', root: '/workspace/repo-contract-test' },
    task: 'session-contract-test',
    sessionDir: '/phantom/sessions/session-contract-test',
    completedDir: '/phantom/completed/session-contract-test',
  };
  const pointer = {
    schema_version: 2,
    repo_id: paths.repo.id,
    task_id: paths.task,
    session_dir: paths.sessionDir,
    updated_at: TIMESTAMP,
  };
  const session = {
    schema_version: 2,
    artifact_type: 'session',
    repo_id: paths.repo.id,
    task_id: paths.task,
    status: 'active',
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    producer: { role: 'apex', compute_profile: 'frontier' },
    bundle_version: bundleVersion,
    workspace: paths.repo.root,
    route: 'plan',
    intent_summary: 'Preserve the current session contract.',
    work_kind: 'implementation',
    lifecycle: newLifecycle('standard'),
    authority_trust: null,
    authority_decisions: [],
  };
  const intent = {
    schema_version: 2,
    artifact_type: 'intent',
    repo_id: paths.repo.id,
    task_id: paths.task,
    status: 'active',
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    producer: { role: 'apex', compute_profile: 'frontier' },
    bundle_version: bundleVersion,
    summary: session.intent_summary,
    route: session.route,
    work_kind: session.work_kind,
  };
  return { paths, pointer, session, intent };
}

function recordedEnvelope(type, paths, bundleVersion, overrides = {}) {
  const fixed = {
    execution: ['blade', 'balanced'],
    wrap: ['warden', 'economy'],
    'delegation-task': ['blade', 'balanced'],
    'delegation-result': ['blade', 'balanced'],
  };
  const [role, profile] = fixed[type] || ['apex', 'frontier'];
  return {
    schema_version: 2,
    artifact_type: type,
    repo_id: paths.repo.id,
    task_id: paths.task,
    status: type === 'delegation-task' ? 'pending' : 'passed',
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    producer: { role, compute_profile: profile },
    bundle_version: bundleVersion,
    record_sequence: 1,
    model_routing: {
      requested_profile: profile,
      actual_profile: null,
      fallback_reason: null,
      outcome: type === 'delegation-task' ? 'pending' : 'passed',
    },
    evidence: type === 'delegation-task'
      ? { role, profile, risk: 'moderate' }
      : {},
    ...overrides,
  };
}

test('canonical session, lifecycle, pointer, and intent envelopes remain valid', async () => {
  const {
    canonicalLifecycle,
    intentErrors,
    newLifecycle,
    pointerErrors,
    sessionErrors,
  } = await import(CONTRACTS);
  const { BUNDLE_VERSION } = await import(PROFILE);
  const state = validState(newLifecycle, BUNDLE_VERSION);

  assert.deepEqual(pointerErrors(state.pointer, state.paths), []);
  assert.deepEqual(sessionErrors(state.session, state.paths, state.pointer), []);
  assert.deepEqual(intentErrors(state.intent, state.paths, state.session), []);
  assert.deepEqual(analyticsEnvelopeErrors(state.session, 'session'), []);
  assert.deepEqual(analyticsEnvelopeErrors(state.intent, 'intent'), []);
  const lifecycle = canonicalLifecycle(state.session.lifecycle);
  assert.deepEqual(lifecycle, state.session.lifecycle);
  assert.notEqual(lifecycle, state.session.lifecycle);
  assert.notEqual(lifecycle.approvals, state.session.lifecycle.approvals);
});

test('analytics and portable readers both reject malformed nested v2 session state', async () => {
  const { newLifecycle, sessionErrors } = await import(CONTRACTS);
  const { BUNDLE_VERSION } = await import(PROFILE);
  const state = validState(newLifecycle, BUNDLE_VERSION);
  state.session.lifecycle = {};
  state.session.authority_trust = { legacy: true };
  state.session.authority_decisions = [{ legacy: true }];

  const portable = sessionErrors(state.session, state.paths, state.pointer).join('\n');
  const analytics = analyticsEnvelopeErrors(state.session, 'session').join('\n');
  for (const message of [
    /session\.lifecycle\.mode must be standard\|to-plan/,
    /session\.authority_trust\.legacy is unsupported/,
    /session\.authority_decisions\[0\]\.legacy is unsupported/,
  ]) {
    assert.match(portable, message);
    assert.match(analytics, message);
  }
});

test('state envelope v1 is rejected without migration or fallback', async () => {
  const { intentErrors, newLifecycle, pointerErrors, sessionErrors } = await import(CONTRACTS);
  const { BUNDLE_VERSION } = await import(PROFILE);
  const state = validState(newLifecycle, BUNDLE_VERSION);

  state.pointer.schema_version = 1;
  state.session.schema_version = 1;
  state.intent.schema_version = 1;

  assert.match(pointerErrors(state.pointer, state.paths).join('\n'), /schema_version must be 2/);
  assert.match(sessionErrors(state.session, state.paths, state.pointer).join('\n'), /schema_version must be 2/);
  assert.match(intentErrors(state.intent, state.paths, state.session).join('\n'), /schema_version must be 2/);
});

test('every recorded v2 artifact has a closed envelope and canonical producer contract', async () => {
  const { newLifecycle, stateEnvelopeErrors } = await import(CONTRACTS);
  const { BUNDLE_VERSION } = await import(PROFILE);
  const { paths } = validState(newLifecycle, BUNDLE_VERSION);

  for (const type of [
    'context', 'capabilities', 'brainstorm', 'plan', 'decisions',
    'delegation-task', 'delegation-result', 'execution', 'wrap',
  ]) {
    const artifact = recordedEnvelope(type, paths, BUNDLE_VERSION);
    assert.deepEqual(stateEnvelopeErrors(artifact, type, paths), [], type);
    assert.deepEqual(analyticsEnvelopeErrors(artifact, type), [], `${type} analytics`);
  }

  const relabeled = recordedEnvelope('plan', paths, BUNDLE_VERSION);
  relabeled.legacy_payload = { schema_version: 1 };
  delete relabeled.evidence;
  assert.match(
    stateEnvelopeErrors(relabeled, 'plan', paths).join('\n'),
    /legacy_payload is unsupported.*evidence is required/s,
  );
  assert.match(
    analyticsEnvelopeErrors(relabeled, 'plan').join('\n'),
    /legacy_payload is unsupported.*evidence is required/s,
  );

  const malformedProducer = recordedEnvelope('execution', paths, BUNDLE_VERSION);
  malformedProducer.producer = { role: 'apex', compute_profile: 'balanced', runtime: 'legacy' };
  assert.match(
    stateEnvelopeErrors(malformedProducer, 'execution', paths).join('\n'),
    /producer\.runtime is unsupported.*producer\.role must be blade/s,
  );
  assert.match(
    analyticsEnvelopeErrors(malformedProducer, 'execution').join('\n'),
    /producer\.runtime is unsupported.*producer\.role must be blade/s,
  );

  const emptyProducer = recordedEnvelope('wrap', paths, BUNDLE_VERSION);
  emptyProducer.producer = {};
  assert.match(
    stateEnvelopeErrors(emptyProducer, 'wrap', paths).join('\n'),
    /producer\.role is required.*producer\.compute_profile is required/s,
  );
});

test('delegation producers bind to typed task role and resolved profile', async () => {
  const { newLifecycle, stateEnvelopeErrors } = await import(CONTRACTS);
  const { BUNDLE_VERSION } = await import(PROFILE);
  const { paths } = validState(newLifecycle, BUNDLE_VERSION);
  const task = recordedEnvelope('delegation-task', paths, BUNDLE_VERSION, {
    producer: { role: 'blade', compute_profile: 'deep' },
    model_routing: {
      requested_profile: 'deep',
      actual_profile: null,
      fallback_reason: null,
      outcome: 'pending',
    },
    evidence: { role: 'blade', profile: 'balanced', risk: 'critical' },
  });
  assert.deepEqual(stateEnvelopeErrors(task, 'delegation-task', paths), []);

  task.producer.role = 'gaze';
  assert.match(
    stateEnvelopeErrors(task, 'delegation-task', paths).join('\n'),
    /producer\.role must match evidence\.role/,
  );
  task.producer.role = 'blade';
  task.producer.compute_profile = 'balanced';
  task.model_routing.requested_profile = 'balanced';
  assert.match(
    stateEnvelopeErrors(task, 'delegation-task', paths).join('\n'),
    /producer\.compute_profile must match the resolved evidence profile/,
  );
});

test('raw evidence remains opaque while envelope and producer fields stay closed', async () => {
  const { newLifecycle, stateEnvelopeErrors } = await import(CONTRACTS);
  const { BUNDLE_VERSION } = await import(PROFILE);
  const { paths } = validState(newLifecycle, BUNDLE_VERSION);
  const plan = recordedEnvelope('plan', paths, BUNDLE_VERSION, {
    evidence: {
      legacy_payload: { retained_as_raw_input: true },
      producer: { untrusted_payload_field: true },
    },
  });

  assert.deepEqual(stateEnvelopeErrors(plan, 'plan', paths), []);
});

test('session and intent reject empty, expanded, or non-Apex producers', async () => {
  const { intentErrors, newLifecycle, sessionErrors } = await import(CONTRACTS);
  const { BUNDLE_VERSION } = await import(PROFILE);
  const state = validState(newLifecycle, BUNDLE_VERSION);

  state.session.producer = {};
  assert.match(sessionErrors(state.session, state.paths, state.pointer).join('\n'), /producer\.role is required/);
  state.session.producer = { role: 'blade', compute_profile: 'balanced' };
  assert.match(
    sessionErrors(state.session, state.paths, state.pointer).join('\n'),
    /producer\.role must be apex.*compute_profile must be frontier/s,
  );
  state.intent.producer.runtime = 'legacy';
  assert.match(intentErrors(state.intent, state.paths, state.session).join('\n'), /producer\.runtime is unsupported/);
});

test('malformed lifecycle retains the exact fail-closed validation message', async () => {
  const { canonicalLifecycle, newLifecycle } = await import(CONTRACTS);
  const lifecycle = newLifecycle('standard');
  lifecycle.mode = 'legacy';
  lifecycle.approvals.legacy = { status: 'pending', decided_at: null };
  lifecycle.approvals.direction = { status: 'approved', decided_at: null };
  delete lifecycle.actions.ship;

  assert.throws(
    () => canonicalLifecycle(lifecycle),
    (error) => {
      assert.equal(
        error.message,
        'Noncanonical Phantom state: session.lifecycle.mode must be standard|to-plan; '
          + 'session.lifecycle.approvals.legacy is unsupported; '
          + 'session.lifecycle.approvals.direction.decided_at must be an ISO timestamp after a decision; '
          + 'session.lifecycle.approvals.direction.artifact_bindings must be an array; '
          + 'session.lifecycle.approvals.direction.authority must be an object; '
          + 'session.lifecycle.actions.ship must be an object.',
      );
      return true;
    },
  );
});

test('authority-less grants and unknown legacy envelope fields fail closed', async () => {
  const { canonicalLifecycle, newLifecycle, intentErrors, pointerErrors, sessionErrors } = await import(CONTRACTS);
  const { BUNDLE_VERSION } = await import(PROFILE);
  const state = validState(newLifecycle, BUNDLE_VERSION);
  const lifecycle = newLifecycle('standard');
  lifecycle.approvals.plan = { status: 'approved', decided_at: TIMESTAMP };
  assert.throws(() => canonicalLifecycle(lifecycle), /artifact_bindings must be an array.*authority must be an object/);

  state.pointer.telemetry = true;
  state.session.approval = { status: 'approved' };
  state.intent.legacy_route = 'plan';
  assert.match(pointerErrors(state.pointer, state.paths).join('\n'), /telemetry is unsupported/);
  assert.match(sessionErrors(state.session, state.paths, state.pointer).join('\n'), /approval is unsupported/);
  assert.match(intentErrors(state.intent, state.paths, state.session).join('\n'), /legacy_route is unsupported/);
});

test('malformed session rejects legacy lifecycle fields without parsing or migration', async () => {
  const { newLifecycle, sessionErrors } = await import(CONTRACTS);
  const { BUNDLE_VERSION } = await import(PROFILE);
  const state = validState(newLifecycle, BUNDLE_VERSION);
  const malformed = {
    ...state.session,
    bundle_version: 'legacy',
    status: 'legacy',
    route: 'legacy',
    intent_summary: '',
    work_kind: 'legacy',
    mode: 'standard',
    to_plan: true,
    lifecycle: null,
    authority_trust: 'legacy',
    authority_decisions: null,
  };

  assert.deepEqual(sessionErrors(malformed, state.paths, state.pointer), [
    `session.json bundle_version must be ${BUNDLE_VERSION}`,
    'session.json status must be active|paused|completed',
    'session.json route must be direct|plan|brainstorm|full',
    'session.json intent_summary must be a non-empty string',
    'session.json work_kind must be implementation|investigation',
    'session.json top-level mode is unsupported; use lifecycle.mode',
    'session.json top-level to_plan is unsupported; use lifecycle.mode',
    'session.lifecycle must be an object',
    'session.authority_trust must be null or an object',
    'session.authority_decisions must be an array',
  ]);
});
