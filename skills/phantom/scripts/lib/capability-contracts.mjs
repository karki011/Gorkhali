// Author: Subash Karki

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

export const capabilityRequestSchema = JSON.parse(readFileSync(
  new URL('../../schemas/capability-request.schema.json', import.meta.url),
  'utf8',
));

const RUNTIME_CAPABILITIES = {
  'workspace.write': ['workspace.write'],
  'process.exec': ['process.exec'],
  'git.commit': ['git.commit', 'version_control'],
  'git.push': ['git.push', 'version_control'],
  'github.openDraftPr': ['github.openDraftPr', 'review.publish'],
  'tracker.comment': ['tracker.comment', 'issue.tracker'],
};
const BRANCH_BOUND_MUTATIONS = new Set([
  'workspace.write',
  'process.exec',
  'git.commit',
  'git.push',
  'github.openDraftPr',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function portablePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || value.includes('\0')) {
    return false;
  }
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\')) return false;
  const normalized = posix.normalize(value);
  return normalized !== '..' && !normalized.startsWith('../') && normalized === value;
}

function schemaAtReference(reference) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return null;
  return reference.slice(2).split('/').reduce((value, segment) => value?.[
    segment.replaceAll('~1', '/').replaceAll('~0', '~')
  ], capabilityRequestSchema);
}

function matchesType(type, value) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function validateSchema(schema, value, path = '$', errors = []) {
  if (schema.oneOf) {
    const results = schema.oneOf.map((candidate) => validateSchema(candidate, value, path, []));
    const matches = results.filter((result) => result.length === 0);
    if (matches.length !== 1) {
      errors.push(`${path}: must match exactly one capability request schema`);
      if (matches.length === 0) {
        const closest = [...results].sort((left, right) => left.length - right.length)[0] || [];
        errors.push(...closest);
      }
    }
    return errors;
  }
  if (schema.$ref) {
    const resolved = schemaAtReference(schema.$ref);
    if (!resolved) errors.push(`${path}: unresolved schema reference ${schema.$ref}`);
    else validateSchema(resolved, value, path, errors);
    return errors;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(type, value))) {
      errors.push(`${path}: must be ${types.join(' or ')}`);
      return errors;
    }
  }
  if (value === null) return errors;
  if (isObject(value)) {
    for (const field of schema.required || []) {
      if (!Object.hasOwn(value, field)) errors.push(`${path}.${field}: required`);
    }
    const properties = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const field of Object.keys(value)) {
        if (!Object.hasOwn(properties, field)) errors.push(`${path}.${field}: unsupported property`);
      }
    }
    for (const [field, fieldSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, field)) validateSchema(fieldSchema, value[field], `${path}.${field}`, errors);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: requires at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: allows at most ${schema.maxItems} item(s)`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      value.forEach((item, index) => {
        const canonical = canonicalJson(item);
        if (seen.has(canonical)) errors.push(`${path}[${index}]: duplicate item`);
        seen.add(canonical);
      });
    }
    if (schema['x-maxUtf8Bytes'] !== undefined) {
      const bytes = value.reduce((total, item) => total + Buffer.byteLength(String(item), 'utf8') + 1, 0);
      if (bytes > schema['x-maxUtf8Bytes']) {
        errors.push(`${path}: exceeds ${schema['x-maxUtf8Bytes']} UTF-8 bytes`);
      }
    }
    value.forEach((item, index) => validateSchema(schema.items || {}, item, `${path}[${index}]`, errors));
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: must contain at least ${schema.minLength} character(s)`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: must contain at most ${schema.maxLength} character(s)`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${path}: does not match ${schema.pattern}`);
    }
    if (schema['x-portablePath'] && !portablePath(value)) {
      errors.push(`${path}: must be a normalized workspace-relative path`);
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }
  return errors;
}

export function validateCapabilityRequest(request) {
  if (!isObject(request)) return ['request: must be an object'];
  return validateSchema(capabilityRequestSchema, request);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function capabilityRequestDigest(request) {
  return sha256(canonicalJson(request));
}

export function capabilityDecisionRecord(decision) {
  return {
    schema_version: 1,
    request_id: decision.request_id,
    idempotency_key: decision.idempotency_key,
    capability_type: decision.capability,
    request_digest: decision.request_digest,
    decision: decision.status,
    reason: decision.reason_codes.join(',') || 'policy_satisfied',
  };
}

function finalizeDecision(decision) {
  return {
    ...decision,
    decision_digest: sha256(canonicalJson(capabilityDecisionRecord(decision))),
  };
}

function granted(value) {
  return value?.status === 'authorized' || value?.status === 'approved';
}

function workflowNodes(context) {
  const source = context.workflow?.nodes;
  if (Array.isArray(source)) return source;
  if (isObject(source)) return Object.entries(source).map(([id, node]) => ({ id, ...node }));
  return [];
}

function workflowNodeState(context, nodeId) {
  const source = context.workflowState?.nodes;
  if (Array.isArray(source)) return source.find((node) => node.id === nodeId) ?? null;
  return isObject(source) ? source[nodeId] ?? null : null;
}

function withinScope(path, allowed) {
  return allowed.some((entry) => entry === '.' || path === entry || path.startsWith(`${entry.replace(/\/$/, '')}/`));
}

function protectedControlPath(path, protectedPaths = []) {
  const intrinsicControlSegments = new Set([
    '.git',
    '.gitattributes',
    '.gitconfig',
    '.gitmodules',
    '.phantom',
  ]);
  if (path.split('/').some((segment) => intrinsicControlSegments.has(segment.toLowerCase()))) {
    return true;
  }
  return protectedPaths.some((entry) => entry === '.'
    || path === entry
    || path.startsWith(`${entry.replace(/\/$/, '')}/`)
    || entry.startsWith(`${path.replace(/\/$/, '')}/`));
}

function idempotencyKey(request) {
  if (!isObject(request)) return 'invalid-request';
  if ('idempotencyKey' in request) return request.idempotencyKey;
  if (request.type === 'workspace.write') return `${request.type}:${request.patchDigest}`;
  if (request.type === 'git.commit') return `${request.type}:${request.treeDigest}`;
  return `${request.type}:${request.request_id}`;
}

function runtimeCapabilities(context) {
  if (Array.isArray(context.runtimeCapabilities)) return new Set(context.runtimeCapabilities);
  if (isObject(context.runtimeCapabilities)) {
    return new Set(Object.entries(context.runtimeCapabilities)
      .filter(([, status]) => status === true || status === 'available')
      .map(([name]) => name));
  }
  return new Set();
}

function priorReservations(context, key) {
  return (context.priorDecisions ?? []).filter((entry) => entry.idempotency_key === key
    && entry.status === 'authorized');
}

function deny(request, reasons) {
  const safeRequest = isObject(request) ? request : { invalid_request: request };
  const requestDigest = capabilityRequestDigest(safeRequest);
  const decision = {
    schema_version: 1,
    request_id: safeRequest.request_id ?? 'invalid-request',
    request_digest: requestDigest,
    workflow_id: safeRequest.workflow_id ?? 'invalid-workflow',
    node_id: safeRequest.node_id ?? 'invalid-node',
    capability: safeRequest.type ?? 'invalid',
    status: 'denied',
    reason_codes: [...new Set(reasons)].sort(),
    idempotency_key: idempotencyKey(safeRequest),
  };
  return finalizeDecision(decision);
}

export function authorizeCapability(request, context) {
  const contractErrors = validateCapabilityRequest(request);
  if (contractErrors.length > 0) return deny(request, contractErrors.map((error) => `invalid_request:${error}`));

  const reasons = [];
  const session = context.session;
  if (!isObject(session) || session.status !== 'active') reasons.push('session_not_active');
  if (context.workflow?.workflow_id !== request.workflow_id) reasons.push('workflow_mismatch');
  const node = workflowNodes(context).find((candidate) => candidate.id === request.node_id);
  if (!node) reasons.push('unknown_node');
  const nodeState = workflowNodeState(context, request.node_id);
  if (!nodeState || !['ready', 'running', 'in_progress'].includes(nodeState.status)) reasons.push('node_not_active');
  if (context.currentWorktreeFingerprint !== request.worktreeFingerprint) reasons.push('stale_worktree');
  if ((node?.risk === 'critical' || context.risk === 'critical') && session?.route === 'direct') {
    reasons.push('route_policy_violation');
  }

  const capabilities = runtimeCapabilities(context);
  if (context.trusted_interception !== true) reasons.push('host_interception_unavailable');
  if (!RUNTIME_CAPABILITIES[request.type].some((name) => capabilities.has(name))) {
    reasons.push('runtime_capability_unavailable');
  }
  if (Number.isFinite(context.remainingBudget?.cost) && context.remainingBudget.cost <= 0) {
    reasons.push('cost_budget_exhausted');
  }
  if (Number.isFinite(context.remainingBudget?.duration_ms) && context.remainingBudget.duration_ms <= 0) {
    reasons.push('time_budget_exhausted');
  }
  if (BRANCH_BOUND_MUTATIONS.has(request.type)) {
    if ((context.hard_enforcement !== true && context.trusted_interception === true)
      || !Array.isArray(context.protected_branches)
      || context.protected_branches.length === 0) {
      reasons.push('protected_branch_enforcement_unavailable');
    } else if (typeof context.current_branch !== 'string' || context.current_branch.length === 0) {
      reasons.push('current_branch_unresolved');
    } else if (context.protected_branches.includes(context.current_branch)) {
      reasons.push('protected_branch');
    }
  }

  const authorizations = session?.lifecycle?.authorizations ?? {};
  if (['workspace.write', 'process.exec', 'git.commit'].includes(request.type)
    && !granted(authorizations.implementation)) reasons.push('implementation_not_authorized');
  if (request.type === 'git.push') {
    if (node?.kind !== 'external-action' || node.action !== 'git-push') {
      reasons.push('external_action_node_required');
    }
    if (node?.idempotency_key !== request.idempotencyKey) reasons.push('idempotency_key_mismatch');
    if (!granted(authorizations['ship-draft-pr'])) reasons.push('draft_pr_not_authorized');
    if (session?.lifecycle?.actions?.ship?.status !== 'ready') reasons.push('ship_gate_not_ready');
    if (context.headSha !== request.headSha) reasons.push('head_sha_mismatch');
    if (context.current_branch !== request.branch) reasons.push('branch_mismatch');
    if (!context.remotes?.includes(request.remote)) reasons.push('remote_not_available');
  }
  if (request.type === 'github.openDraftPr') {
    if (node?.kind !== 'external-action' || node.action !== 'draft-pr') {
      reasons.push('external_action_node_required');
    }
    if (node?.idempotency_key !== request.idempotencyKey) reasons.push('idempotency_key_mismatch');
    if (!granted(authorizations['ship-draft-pr'])) reasons.push('draft_pr_not_authorized');
    if (session?.lifecycle?.actions?.ship?.status !== 'ready') reasons.push('ship_gate_not_ready');
    if (context.headSha !== request.headSha) reasons.push('head_sha_mismatch');
  }
  if (request.type === 'tracker.comment'
    && (node?.kind !== 'external-action' || node.action !== 'tracker-comment')) {
    reasons.push('external_action_node_required');
  }
  if (request.type === 'tracker.comment' && node?.idempotency_key !== request.idempotencyKey) {
    reasons.push('idempotency_key_mismatch');
  }
  if (request.type === 'tracker.comment'
    && !context.externalAuthorizations?.includes('tracker.comment')) reasons.push('tracker_comment_not_authorized');

  if (request.type === 'workspace.write' && node) {
    const allowed = node.allowed_paths ?? node.scope?.allowed_paths ?? [];
    if (!Array.isArray(allowed) || request.paths.some((path) => !withinScope(path, allowed))) {
      reasons.push('path_outside_node_scope');
    }
    if (request.paths.some((path) => protectedControlPath(path, context.protected_control_paths))) {
      reasons.push('control_plane_path_protected');
    }
  }
  if (request.type === 'process.exec') {
    reasons.push('sandbox_executor_attestation_unavailable');
  }
  if (request.type === 'process.exec' && node) {
    const allowedCommands = node.allowed_commands ?? [];
    if (!Array.isArray(allowedCommands)
      || !allowedCommands.some((allowed) => Array.isArray(allowed)
        && allowed.length === request.command.length
        && allowed.every((argument, index) => argument === request.command[index]))) {
      reasons.push('command_not_allowed');
    }
    const allowedCwds = node.allowed_cwds ?? ['.'];
    if (!allowedCwds.some((cwd) => request.cwd === cwd || request.cwd.startsWith(`${cwd.replace(/\/$/, '')}/`))) {
      reasons.push('cwd_outside_node_scope');
    }
  }
  if (request.type === 'git.commit' && context.currentTreeDigest !== request.treeDigest) {
    reasons.push('tree_digest_mismatch');
  }

  if (request.type === 'process.exec') return deny(request, reasons);

  const key = idempotencyKey(request);
  const requestDigest = capabilityRequestDigest(request);
  const reservations = priorReservations(context, key);
  const conflict = reservations.find((prior) => prior.request_digest !== requestDigest);
  if (conflict) return deny(request, ['idempotency_key_conflict']);
  const succeeded = reservations.find((prior) => prior.request_digest === requestDigest
    && prior.execution_status === 'succeeded' && prior.has_succeeded_outcome === true);
  if (succeeded) {
    const duplicate = {
      schema_version: 1,
      request_id: request.request_id,
      request_digest: requestDigest,
      workflow_id: request.workflow_id,
      node_id: request.node_id,
      capability: request.type,
      status: 'duplicate',
      reason_codes: ['idempotent_replay'],
      idempotency_key: key,
      prior_decision_digest: succeeded.decision_digest,
    };
    return finalizeDecision(duplicate);
  }
  const pending = reservations.find((prior) => prior.request_digest === requestDigest
    && prior.execution_status !== 'failed');
  if (pending) return deny(request, ['idempotency_reservation_pending']);
  const failed = reservations.find((prior) => prior.request_digest === requestDigest
    && prior.execution_status === 'failed');
  if (failed) return deny(request, ['idempotency_reservation_failed']);
  if (reasons.length > 0) return deny(request, reasons);

  const decision = {
    schema_version: 1,
    request_id: request.request_id,
    request_digest: requestDigest,
    workflow_id: request.workflow_id,
    node_id: request.node_id,
    capability: request.type,
    status: 'authorized',
    reason_codes: [],
    idempotency_key: key,
  };
  return finalizeDecision(decision);
}
