// Author: Subash Karki
'use strict';

const manifest = require('../../skills/phantom/manifest.json');
const modelPolicy = require('../../skills/phantom/references/model-policy.json');

const STATE_ENVELOPE_VERSION = manifest.contracts.state_envelope.version;
const BUNDLE_VERSION = manifest.bundle_version;
const PROFILES = new Set(modelPolicy.profiles);
const ROLES = new Set(Object.keys(modelPolicy.roles));
const ROUTES = new Set(['direct', 'plan', 'brainstorm', 'full']);
const WORK_KINDS = new Set(['implementation', 'investigation']);
const APPROVAL_GATES = new Set(['direction', 'plan', 'wiring']);
const AUTHORIZATION_SCOPES = new Set(['implementation', 'ship-draft-pr', 'tracker-comment']);
const SESSION_STATUSES = new Set(['active', 'paused', 'completed']);
const RECORD_STATUSES = new Set(['pending', 'passed', 'failed', 'blocked', 'skipped']);
const CORE_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const ROUTED_TYPES = new Set([
  'context',
  'capabilities',
  'brainstorm',
  'plan',
  'decisions',
  'delegation-task',
  'delegation-result',
  'execution',
  'wrap',
]);
const APEX_TYPES = new Set([
  'session',
  'intent',
  'context',
  'capabilities',
  'brainstorm',
  'plan',
  'decisions',
]);
const FIXED_ROLES = new Map([
  ...[...APEX_TYPES].map((type) => [type, 'apex']),
  ['execution', 'blade'],
  ['wrap', 'warden'],
]);
const BASE_FIELDS = [
  'schema_version',
  'artifact_type',
  'repo_id',
  'task_id',
  'status',
  'created_at',
  'updated_at',
  'producer',
  'bundle_version',
];
const SESSION_FIELDS = new Set([
  ...BASE_FIELDS,
  'workspace',
  'route',
  'intent_summary',
  'work_kind',
  'lifecycle',
  'authority_trust',
  'authority_decisions',
  'last_record_sequence',
  'pause_reason',
  'resumed_at',
  'completed_at',
]);
const INTENT_FIELDS = new Set([
  ...BASE_FIELDS,
  'summary',
  'route',
  'work_kind',
]);
const ROUTED_FIELDS = new Set([
  ...BASE_FIELDS,
  'record_sequence',
  'model_routing',
  'evidence',
]);
const ROUTING_FIELDS = new Set([
  'requested_profile',
  'actual_profile',
  'fallback_reason',
  'outcome',
  'wall_time_ms',
  'tool_turns',
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const AUTHORITY_FIELDS = new Set([
  'decision_digest', 'actor', 'source', 'source_event_id', 'replay_id', 'key_id',
  'issued_at', 'expires_at', 'worktree_fingerprint', 'approval_artifact_bindings',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCoreSemVer(value) {
  return typeof value === 'string' && CORE_SEMVER.test(value);
}

function isTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function normalizedRole(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function compareText(left, right) {
  return left < right ? -1 : (left > right ? 1 : 0);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function exactFieldErrors(value, allowed, label) {
  if (!isObject(value)) return [];
  return Object.keys(value)
    .filter((field) => !allowed.has(field))
    .map((field) => `${label}.${field} is unsupported`);
}

function requiredFieldErrors(value, required, label) {
  return required
    .filter((field) => !Object.hasOwn(value, field))
    .map((field) => `${label}.${field} is required`);
}

function expectedDelegationProfile(evidence) {
  if (!isObject(evidence)) return null;
  const role = normalizedRole(evidence.role);
  if (!ROLES.has(role) || !PROFILES.has(evidence.profile)) return null;
  const base = role === 'apex'
    ? modelPolicy.roles.apex
    : evidence.profile || modelPolicy.roles[role] || modelPolicy.default_profile;
  const elevation = modelPolicy.critical_elevation;
  return evidence.risk === elevation.risk
    && elevation.eligible_roles.includes(role)
    && !['deep', 'frontier'].includes(base)
    ? elevation.profile
    : base;
}

function producerErrors(value, type, routing) {
  const label = `${type}.json producer`;
  if (!isObject(value)) return [`${label} must be an object`];
  const errors = exactFieldErrors(value, new Set(['role', 'compute_profile']), label);
  errors.push(...requiredFieldErrors(value, ['role', 'compute_profile'], label));

  const role = normalizedRole(value.role);
  if (!role) errors.push(`${label}.role must be a non-empty string`);
  const fixedRole = FIXED_ROLES.get(type);
  if (fixedRole && role !== fixedRole) {
    errors.push(`${label}.role must be ${fixedRole}`);
  } else if (!fixedRole && !ROLES.has(role)) {
    errors.push(`${label}.role must be a known Phantom role`);
  }

  if (!PROFILES.has(value.compute_profile)) {
    errors.push(`${label}.compute_profile must be ${[...PROFILES].join('|')}`);
  }
  if (APEX_TYPES.has(type) && value.compute_profile !== modelPolicy.roles.apex) {
    errors.push(`${label}.compute_profile must be ${modelPolicy.roles.apex}`);
  }
  if (isObject(routing) && value.compute_profile !== routing.requested_profile) {
    errors.push(`${label}.compute_profile must match model_routing.requested_profile`);
  }
  return errors;
}

function modelRoutingErrors(value, type) {
  const label = `${type}.json model_routing`;
  if (!isObject(value)) return [`${label} must be an object`];
  const errors = exactFieldErrors(value, ROUTING_FIELDS, label);
  errors.push(...requiredFieldErrors(
    value,
    ['requested_profile', 'actual_profile', 'fallback_reason', 'outcome'],
    label,
  ));
  if (!PROFILES.has(value.requested_profile)) {
    errors.push(`${label}.requested_profile must be ${[...PROFILES].join('|')}`);
  }
  if (value.actual_profile !== null && !PROFILES.has(value.actual_profile)) {
    errors.push(`${label}.actual_profile must be null or a known profile`);
  }
  if (value.fallback_reason !== null
    && (typeof value.fallback_reason !== 'string' || !value.fallback_reason.trim())) {
    errors.push(`${label}.fallback_reason must be null or a non-empty string`);
  }
  if (!RECORD_STATUSES.has(value.outcome)) {
    errors.push(`${label}.outcome must be pending|passed|failed|blocked|skipped`);
  }
  if (value.wall_time_ms !== undefined
    && (!Number.isFinite(value.wall_time_ms) || value.wall_time_ms < 0)) {
    errors.push(`${label}.wall_time_ms must be a non-negative number`);
  }
  if (value.tool_turns !== undefined
    && (!Number.isInteger(value.tool_turns) || value.tool_turns < 0)) {
    errors.push(`${label}.tool_turns must be a non-negative integer`);
  }
  return errors;
}

function commonEnvelopeErrors(value, type) {
  const label = `${type}.json`;
  const errors = [];
  if (value.schema_version !== STATE_ENVELOPE_VERSION) {
    errors.push(
      `${label} schema_version ${JSON.stringify(value.schema_version)} is unsupported; `
      + `expected ${STATE_ENVELOPE_VERSION}`,
    );
  }
  if (value.artifact_type !== type) errors.push(`${label} artifact_type must be ${type}`);
  for (const field of ['repo_id', 'task_id']) {
    if (typeof value[field] !== 'string' || !value[field].trim()) {
      errors.push(`${label} ${field} must be a non-empty string`);
    }
  }
  if (!isTimestamp(value.created_at)) errors.push(`${label} created_at must be an ISO timestamp`);
  if (!isTimestamp(value.updated_at)) errors.push(`${label} updated_at must be an ISO timestamp`);
  if (!isCoreSemVer(value.bundle_version)) {
    errors.push(`${label} bundle_version must be a strict core SemVer x.y.z string`);
  }
  return errors;
}

function bindingErrors(value, label, { signed = false } = {}) {
  if (!Array.isArray(value)) return [`${label} must be an array`];
  const errors = [];
  const seen = new Set();
  value.forEach((binding, index) => {
    const path = `${label}[${index}]`;
    if (!isObject(binding)) {
      errors.push(`${path} must be an object`);
      return;
    }
    const fields = new Set(['artifact_type', 'record_sequence', 'digest', ...(signed ? ['gate'] : [])]);
    errors.push(...exactFieldErrors(binding, fields, path));
    if (signed && !APPROVAL_GATES.has(binding.gate)) {
      errors.push(`${path}.gate must be direction|plan|wiring`);
    }
    if (typeof binding.artifact_type !== 'string' || !binding.artifact_type) {
      errors.push(`${path}.artifact_type must be a non-empty string`);
    }
    if (!Number.isInteger(binding.record_sequence) || binding.record_sequence < 1) {
      errors.push(`${path}.record_sequence must be a positive integer`);
    }
    if (!DIGEST.test(binding.digest || '')) errors.push(`${path}.digest must be a SHA-256 digest`);
    const key = `${binding.gate ?? ''}\0${binding.artifact_type}\0${binding.record_sequence}\0${binding.digest}`;
    if (seen.has(key)) errors.push(`${path} is duplicated`);
    seen.add(key);
  });
  return errors;
}

function authorityErrors(value, label, { strict = true } = {}) {
  if (!isObject(value)) return [`${label} must be an object`];
  const errors = strict ? exactFieldErrors(value, AUTHORITY_FIELDS, label) : [];
  for (const field of ['actor', 'source', 'source_event_id', 'replay_id', 'key_id']) {
    if (typeof value[field] !== 'string' || !value[field].trim()) {
      errors.push(`${label}.${field} is required`);
    }
  }
  for (const field of ['decision_digest', 'worktree_fingerprint']) {
    if (!DIGEST.test(value[field] || '')) errors.push(`${label}.${field} must be a SHA-256 digest`);
  }
  if (!isTimestamp(value.issued_at)) errors.push(`${label}.issued_at must be an ISO timestamp`);
  if (!isTimestamp(value.expires_at)) errors.push(`${label}.expires_at must be an ISO timestamp`);
  if (isTimestamp(value.issued_at) && isTimestamp(value.expires_at)
    && Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
    errors.push(`${label}.expires_at must be after issued_at`);
  }
  errors.push(...bindingErrors(
    value.approval_artifact_bindings,
    `${label}.approval_artifact_bindings`,
    { signed: true },
  ));
  return errors;
}

function decisionErrors(value, label, allowedStatuses, kind, name) {
  if (!isObject(value)) return [`${label} must be an object`];
  const errors = [];
  if (!allowedStatuses.includes(value.status)) {
    errors.push(`${label}.status must be ${allowedStatuses.join('|')}`);
  }
  if (value.status === 'pending') {
    if (value.decided_at !== null) errors.push(`${label}.decided_at must be null while pending`);
  } else if (!isTimestamp(value.decided_at)) {
    errors.push(`${label}.decided_at must be an ISO timestamp after a decision`);
  }
  if (value.status === 'pending') {
    errors.push(...exactFieldErrors(value, new Set(['status', 'decided_at']), label));
  } else if (kind === 'approvals') {
    errors.push(...exactFieldErrors(
      value,
      new Set(['status', 'decided_at', 'artifact_bindings', 'authority']),
      label,
    ));
    errors.push(...bindingErrors(value.artifact_bindings, `${label}.artifact_bindings`));
    errors.push(...authorityErrors(value.authority, `${label}.authority`));
    if (Array.isArray(value.artifact_bindings) && isObject(value.authority)
      && Array.isArray(value.authority.approval_artifact_bindings)) {
      const expected = value.artifact_bindings
        .map((binding) => ({ gate: name, ...binding }))
        .sort((left, right) => compareText(canonicalJson(left), canonicalJson(right)));
      if (canonicalJson(expected) !== canonicalJson(value.authority.approval_artifact_bindings)) {
        errors.push(`${label}.authority approval artifact bindings must match the approved artifacts`);
      }
    }
  } else if (kind === 'authorizations') {
    errors.push(...exactFieldErrors(value, new Set(['status', 'decided_at', 'authority']), label));
    errors.push(...authorityErrors(value.authority, `${label}.authority`));
  } else {
    errors.push(...exactFieldErrors(
      value,
      new Set(['status', 'decided_at', 'worktree_fingerprint']),
      label,
    ));
    if (!DIGEST.test(value.worktree_fingerprint || '')) {
      errors.push(`${label}.worktree_fingerprint must be a SHA-256 digest`);
    }
  }
  return errors;
}

function lifecycleErrors(lifecycle) {
  if (!isObject(lifecycle)) return ['session.lifecycle must be an object'];
  const errors = exactFieldErrors(
    lifecycle,
    new Set(['mode', 'approvals', 'authorizations', 'actions']),
    'session.lifecycle',
  );
  if (!['standard', 'to-plan'].includes(lifecycle.mode)) {
    errors.push('session.lifecycle.mode must be standard|to-plan');
  }
  for (const [group, decisions] of [
    ['approvals', {
      direction: ['pending', 'approved'],
      plan: ['pending', 'approved'],
      wiring: ['pending', 'approved'],
    }],
    ['authorizations', {
      implementation: ['pending', 'authorized'],
      'ship-draft-pr': ['pending', 'authorized'],
      'tracker-comment': ['pending', 'authorized'],
    }],
    ['actions', {
      execute: ['pending', 'started'],
      ship: ['pending', 'ready'],
    }],
  ]) {
    if (!isObject(lifecycle[group])) {
      errors.push(`session.lifecycle.${group} must be an object`);
      continue;
    }
    const expectedNames = new Set(Object.keys(decisions));
    for (const name of Object.keys(lifecycle[group])) {
      if (!expectedNames.has(name)) errors.push(`session.lifecycle.${group}.${name} is unsupported`);
    }
    for (const [name, statuses] of Object.entries(decisions)) {
      errors.push(...decisionErrors(
        lifecycle[group][name],
        `session.lifecycle.${group}.${name}`,
        statuses,
        group,
        name,
      ));
    }
  }
  return errors;
}

function authorityTrustErrors(value) {
  if (value === null) return [];
  if (!isObject(value)) return ['session.authority_trust must be null or an object'];
  const errors = [];
  const fields = new Set(['schema_version', 'key_id', 'source', 'public_key_digest']);
  if (value.schema_version !== 1) errors.push('session.authority_trust.schema_version must be 1');
  for (const field of ['key_id', 'source']) {
    if (typeof value[field] !== 'string' || !value[field].trim()) {
      errors.push(`session.authority_trust.${field} must be a non-empty string`);
    }
  }
  if (!DIGEST.test(value.public_key_digest || '')) {
    errors.push('session.authority_trust.public_key_digest must be a SHA-256 digest');
  }
  errors.push(...exactFieldErrors(value, fields, 'session.authority_trust'));
  return errors;
}

function authorityHistoryErrors(value) {
  if (!Array.isArray(value)) return ['session.authority_decisions must be an array'];
  const errors = [];
  const replayIds = new Set();
  const sourceEventIds = new Set();
  value.forEach((entry, index) => {
    const label = `session.authority_decisions[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${label} must be an object`);
      return;
    }
    errors.push(...exactFieldErrors(
      entry,
      new Set(['decision_kind', 'target', 'decided_at', ...AUTHORITY_FIELDS]),
      label,
    ));
    if (!['approval', 'authorization'].includes(entry.decision_kind)) {
      errors.push(`${label}.decision_kind must be approval|authorization`);
    }
    const targets = entry.decision_kind === 'approval' ? APPROVAL_GATES : AUTHORIZATION_SCOPES;
    if (!targets.has(entry.target)) errors.push(`${label}.target is invalid for decision_kind`);
    if (!isTimestamp(entry.decided_at)) errors.push(`${label}.decided_at must be an ISO timestamp`);
    errors.push(...authorityErrors(entry, label, { strict: false }));
    if (replayIds.has(entry.replay_id)) errors.push(`${label}.replay_id is duplicated`);
    if (sourceEventIds.has(entry.source_event_id)) errors.push(`${label}.source_event_id is duplicated`);
    replayIds.add(entry.replay_id);
    sourceEventIds.add(entry.source_event_id);
  });
  return errors;
}

function authorityLinkErrors(session) {
  if (!isObject(session.lifecycle) || !Array.isArray(session.authority_decisions)) return [];
  const errors = [];
  for (const [kind, decisions, grantedStatus] of [
    ['approval', session.lifecycle.approvals, 'approved'],
    ['authorization', session.lifecycle.authorizations, 'authorized'],
  ]) {
    if (!isObject(decisions)) continue;
    for (const [target, decision] of Object.entries(decisions)) {
      if (decision?.status !== grantedStatus || !isObject(decision.authority)) continue;
      const history = session.authority_decisions
        .filter((entry) => entry?.decision_kind === kind && entry.target === target)
        .at(-1);
      const group = kind === 'approval' ? 'approvals' : 'authorizations';
      if (!history) {
        errors.push(`session.lifecycle.${group}.${target} has no authority history`);
        continue;
      }
      const persisted = Object.fromEntries(
        [...AUTHORITY_FIELDS].map((field) => [field, history[field]]),
      );
      if (canonicalJson(decision.authority) !== canonicalJson(persisted)) {
        errors.push(`session.lifecycle.${group}.${target} authority does not match history`);
      }
      if (!isObject(session.authority_trust)
        || decision.authority.key_id !== session.authority_trust.key_id
        || decision.authority.source !== session.authority_trust.source) {
        errors.push(`session.lifecycle.${group}.${target} authority does not match pinned trust`);
      }
    }
  }
  return errors;
}

function sessionSpecificErrors(value) {
  const errors = [];
  if (!SESSION_STATUSES.has(value.status)) {
    errors.push('session.json status must be active|paused|completed');
  }
  if (typeof value.workspace !== 'string' || !value.workspace.trim()) {
    errors.push('session.json workspace must be a non-empty string');
  }
  if (!ROUTES.has(value.route)) errors.push('session.json route must be direct|plan|brainstorm|full');
  if (typeof value.intent_summary !== 'string' || !value.intent_summary.trim()) {
    errors.push('session.json intent_summary must be a non-empty string');
  }
  if (!WORK_KINDS.has(value.work_kind)) {
    errors.push('session.json work_kind must be implementation|investigation');
  }
  errors.push(...lifecycleErrors(value.lifecycle));
  errors.push(...authorityTrustErrors(value.authority_trust));
  errors.push(...authorityHistoryErrors(value.authority_decisions));
  errors.push(...authorityLinkErrors(value));
  if (value.last_record_sequence !== undefined
    && (!Number.isInteger(value.last_record_sequence) || value.last_record_sequence < 1)) {
    errors.push('session.json last_record_sequence must be a positive integer');
  }
  if (value.pause_reason !== undefined
    && (typeof value.pause_reason !== 'string' || !value.pause_reason.trim())) {
    errors.push('session.json pause_reason must be a non-empty string');
  }
  for (const field of ['resumed_at', 'completed_at']) {
    if (value[field] !== undefined && !isTimestamp(value[field])) {
      errors.push(`session.json ${field} must be an ISO timestamp`);
    }
  }
  if (value.status === 'completed' && !isTimestamp(value.completed_at)) {
    errors.push('session.json completed_at is required for a completed session');
  }
  return errors;
}

function intentSpecificErrors(value) {
  const errors = [];
  if (value.status !== 'active') errors.push('intent.json status must be active');
  if (typeof value.summary !== 'string' || !value.summary.trim()) {
    errors.push('intent.json summary must be a non-empty string');
  }
  if (!ROUTES.has(value.route)) errors.push('intent.json route must be direct|plan|brainstorm|full');
  if (!WORK_KINDS.has(value.work_kind)) {
    errors.push('intent.json work_kind must be implementation|investigation');
  }
  return errors;
}

function stateEnvelopeErrors(value, expectedType) {
  const type = expectedType || (isObject(value) ? value.artifact_type : 'state');
  if (!isObject(value)) return [`${type}.json must be an object`];
  if (!['session', 'intent', ...ROUTED_TYPES].includes(type)) {
    return [`${type}.json artifact_type is not governed by state_envelope`];
  }

  const allowed = type === 'session'
    ? SESSION_FIELDS
    : type === 'intent'
      ? INTENT_FIELDS
      : ROUTED_FIELDS;
  const required = type === 'session'
    ? [...BASE_FIELDS, 'workspace', 'route', 'intent_summary', 'work_kind', 'lifecycle', 'authority_trust', 'authority_decisions']
    : type === 'intent'
      ? [...BASE_FIELDS, 'summary', 'route', 'work_kind']
      : [...ROUTED_FIELDS];
  const errors = [
    ...exactFieldErrors(value, allowed, `${type}.json`),
    ...requiredFieldErrors(value, required, `${type}.json`),
    ...commonEnvelopeErrors(value, type),
  ];

  if (type === 'session') errors.push(...sessionSpecificErrors(value));
  else if (type === 'intent') errors.push(...intentSpecificErrors(value));
  else {
    if (!RECORD_STATUSES.has(value.status)) {
      errors.push(`${type}.json status must be pending|passed|failed|blocked|skipped`);
    }
    if (!Number.isInteger(value.record_sequence) || value.record_sequence < 1) {
      errors.push(`${type}.json record_sequence must be a positive integer`);
    }
    errors.push(...modelRoutingErrors(value.model_routing, type));
  }

  errors.push(...producerErrors(value.producer, type, value.model_routing));
  if (type === 'delegation-task' && isObject(value.evidence)) {
    if (normalizedRole(value.producer?.role) !== normalizedRole(value.evidence.role)) {
      errors.push('delegation-task.json producer.role must match evidence.role');
    }
    const expectedProfile = expectedDelegationProfile(value.evidence);
    if (expectedProfile !== null && value.producer?.compute_profile !== expectedProfile) {
      errors.push('delegation-task.json producer.compute_profile must match the resolved evidence profile');
    }
  }
  return errors;
}

function sessionEnvelopeError(value) {
  if (value === null) return null;
  return stateEnvelopeErrors(value, 'session')[0] || null;
}

function routedEnvelopeErrors(value, expectedType) {
  if (!ROUTED_TYPES.has(expectedType)) {
    return [`${expectedType}.json artifact_type is not a routed state envelope`];
  }
  return stateEnvelopeErrors(value, expectedType);
}

module.exports = {
  BUNDLE_VERSION,
  STATE_ENVELOPE_VERSION,
  ROUTED_TYPES,
  routedEnvelopeErrors,
  sessionEnvelopeError,
  stateEnvelopeErrors,
};
