// Author: Subash Karki

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

import {
  physicalTopologyRootFromReferences,
  WORKSPACE_MANIFEST_ALGORITHM,
  WORKSPACE_MANIFEST_POLICY,
  WORKSPACE_MANIFEST_POLICY_DIGEST,
} from './workspace-manifest.mjs';

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
const HOST_ATTESTED_CAPABILITIES = new Set([
  'process.exec',
  'git.commit',
  'git.push',
  'github.openDraftPr',
  'tracker.comment',
]);
const compareText = (left, right) => (left < right ? -1 : (left > right ? 1 : 0));
const RESERVED_EFFECT_EXECUTABLES = new Set([
  'git', 'gh', 'glab', 'hub', 'jira', 'linear',
  'git-receive-pack', 'git-upload-archive', 'git-upload-pack',
]);
const COMMAND_WRAPPERS = new Set([
  'bash', 'busybox', 'cmd', 'dash', 'doas', 'env', 'fish', 'ksh', 'nohup',
  'nice', 'parallel', 'powershell', 'pwsh', 'setsid', 'sh', 'stdbuf', 'sudo',
  'timeout', 'toybox', 'xargs', 'zsh',
]);
const INLINE_INTERPRETER_FLAGS = new Map([
  ['bun', new Set(['-e', '--eval'])],
  ['deno', new Set(['eval'])],
  ['node', new Set(['-e', '--eval', '-p', '--print'])],
  ['nodejs', new Set(['-e', '--eval', '-p', '--print'])],
  ['perl', new Set(['-e'])],
  ['php', new Set(['-r'])],
  ['python', new Set(['-c'])],
  ['python2', new Set(['-c'])],
  ['python3', new Set(['-c'])],
  ['ruby', new Set(['-e'])],
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

function executableName(value) {
  const name = String(value).split(/[\\/]/).at(-1).toLowerCase();
  return name.replace(/\.(?:bat|cmd|com|exe)$/u, '');
}

function reservedEffectCommand(command) {
  const executable = executableName(command[0]);
  const argumentsLower = command.slice(1).map((argument) => String(argument).toLowerCase());
  if (RESERVED_EFFECT_EXECUTABLES.has(executable)
    || executable.startsWith('git-')
    || COMMAND_WRAPPERS.has(executable)) return true;
  if (executable === 'npx' || executable === 'bunx') return true;
  if (['npm', 'pnpm'].includes(executable) && ['exec', 'x', 'dlx'].includes(argumentsLower[0])) return true;
  if (executable === 'yarn' && ['exec', 'dlx'].includes(argumentsLower[0])) return true;
  if (executable === 'find'
    && argumentsLower.some((argument) => ['-exec', '-execdir', '-ok', '-okdir'].includes(argument))) return true;
  const inlineFlags = INLINE_INTERPRETER_FLAGS.get(executable);
  return inlineFlags ? argumentsLower.some((argument) => inlineFlags.has(argument)) : false;
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

export function capabilityRequestBudget(request) {
  return {
    cost_units: request.budget.maxCostUnits,
    duration_ms: request.budget.maxDurationMs,
  };
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

export const CAPABILITY_RESERVATION_SCHEMA_VERSION = 2;
const RESERVATION_DIGEST = /^sha256:[a-f0-9]{64}$/;
const RESERVATION_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const RESERVATION_SHA = /^[a-f0-9]{7,64}$/;
const RESERVATION_ARTIFACT = /^capability\/artifacts\/([a-z-]+)\/([a-f0-9]{64})\.json$/;
const RESERVATION_CAPABILITIES = new Set([
  'workspace.write', 'process.exec', 'git.commit', 'git.push',
  'github.openDraftPr', 'tracker.comment',
]);
const RESERVATION_BASE_FIELDS = Object.freeze([
  'authorized_journal_tail_digest', 'capability_type', 'created_at', 'decision_digest',
  'execution_nonce', 'hard_enforcement', 'idempotency_key', 'node_id', 'request',
  'request_digest', 'request_id', 'reservation_binding', 'reservation_digest', 'reserved_budget',
  'reservation_kind', 'schema_version', 'status', 'workflow_id',
  'workspace_evidence_digest_before',
].sort());
const RESERVATION_BINDING_FIELDS = Object.freeze([
  'authorized_journal_tail_digest', 'capability_type', 'created_at', 'decision_digest',
  'execution_nonce', 'hard_enforcement', 'host_adapter', 'idempotency_key', 'node_id',
  'request', 'request_digest', 'request_id', 'reservation_kind', 'reserved_budget', 'schema_version',
  'workflow_id', 'workspace_evidence_digest_before',
].sort());
const NATIVE_RESERVATION_HARD_FIELDS = Object.freeze([
  'adapter_binding', 'authority_decision_digest', 'binding_digest', 'body_digest',
  'command', 'current_branch', 'cwd', 'head_sha', 'interception_probe_digest', 'paths',
  'protected_branches', 'tree_digest', 'worktree_fingerprint',
].sort());
const HOST_RESERVATION_HARD_FIELDS = Object.freeze([
  ...NATIVE_RESERVATION_HARD_FIELDS,
  'policy_digest', 'registration_digest', 'registry_trust_digest',
].sort());
const NATIVE_CLAIM_FIELDS = Object.freeze([
  'effect_digest', 'host_session_id', 'schema_version', 'tool_call_id', 'tool_name',
  'write_preflight',
].sort());
const MAX_NATIVE_WRITE_PREFLIGHT_RECORDS = 4096;
const HOST_INGEST_FIELDS = Object.freeze([
  'consuming_at', 'ingesting_attestation_digest', 'ingesting_execution_evidence',
  'ingesting_from', 'ingesting_recorded_at',
].sort());
const FINAL_FIELDS = Object.freeze([
  'completed_at', 'error', 'external_reference', 'outcome_digest',
].sort());
const HOST_FINAL_FIELDS = Object.freeze([
  'attestations', 'consuming_at', 'indeterminate_attestation_digest', ...FINAL_FIELDS,
].sort());

const exactReservationKeys = (value, expected) => isObject(value)
  && canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());

const reservationTimestamp = (value) => {
  const parsed = Date.parse(value);
  return typeof value === 'string' && Number.isFinite(parsed)
    && new Date(parsed).toISOString() === value;
};

const reservationNonce = (value) => {
  if (typeof value !== 'string') return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === value;
};

const addReservationError = (errors, condition, message) => {
  if (!condition) errors.push(message);
};

const validReservedBudget = (value) => exactReservationKeys(value, ['cost_units', 'duration_ms'])
  && typeof value.cost_units === 'number'
  && Number.isFinite(value.cost_units)
  && value.cost_units >= 0.000001
  && Number.isInteger(value.duration_ms)
  && value.duration_ms >= 1;

const validateNativeWritePreflight = (claim, request, errors) => {
  const records = claim?.write_preflight;
  addReservationError(errors, Array.isArray(records)
    && records.length > 0 && records.length <= MAX_NATIVE_WRITE_PREFLIGHT_RECORDS,
  '$.claim.write_preflight: required bounded nonempty array');
  if (!Array.isArray(records)) return;
  let previousPath = null;
  const paths = [];
  for (const [index, record] of records.entries()) {
    const recordPath = `$.claim.write_preflight[${index}]`;
    const materialized = record?.materialized;
    const fields = materialized === true
      ? ['dev', 'generation', 'ino', 'materialized', 'path']
      : ['materialized', 'path'];
    addReservationError(errors, exactReservationKeys(record, fields),
      `${recordPath}: unsupported preflight record shape`);
    if (!isObject(record)) continue;
    addReservationError(errors, typeof materialized === 'boolean',
      `${recordPath}.materialized: required boolean`);
    addReservationError(errors, portablePath(record.path),
      `${recordPath}.path: required portable path`);
    if (typeof record.path === 'string') {
      addReservationError(errors,
        previousPath === null || compareText(previousPath, record.path) < 0,
        `${recordPath}.path: paths must be unique and sorted`);
      previousPath = record.path;
      paths.push(record.path);
    }
    if (materialized === true) {
      for (const field of ['dev', 'ino', 'generation']) addReservationError(
        errors,
        typeof record[field] === 'string' && record[field].length > 0
          && record[field].length <= 256 && !record[field].includes('\0'),
        `${recordPath}.${field}: required bounded string`,
      );
    }
  }
  if (request?.type === 'workspace.write' && Array.isArray(request.paths)) {
    const expectedPaths = [...request.paths].sort(compareText);
    addReservationError(errors, canonicalJson(paths) === canonicalJson(expectedPaths),
      '$.claim.write_preflight: paths do not match the authorized request');
  }
};

const reservationDomainDigest = (domain, value) => `sha256:${createHash('sha256')
  .update(`${domain}\0`)
  .update(canonicalJson(value))
  .digest('hex')}`;

const reservationArtifactReference = (reference, digestValue, kind = null) => {
  if (typeof reference !== 'string' || !RESERVATION_DIGEST.test(digestValue || '')) return false;
  const match = RESERVATION_ARTIFACT.exec(reference);
  return Boolean(match && match[2] === digestValue.slice('sha256:'.length)
    && (kind === null || match[1] === kind));
};

const validateWorkspaceEvidence = (evidence, path, errors) => {
  const fields = [
    'algorithm', 'content_root', 'content_shards', 'entry_count', 'evidence_digest',
    'fingerprint', 'manifest_digest', 'physical_root', 'physical_shards',
    'physical_topology_root', 'policy', 'policy_digest', 'regular_file_count',
    'schema_version', 'snapshot_digest', 'symbolic_link_count',
  ];
  addReservationError(errors, exactReservationKeys(evidence, fields),
    `${path}: unsupported workspace evidence shape`);
  if (!isObject(evidence)) return;
  addReservationError(errors, evidence.schema_version === 2,
    `${path}.schema_version: must equal 2`);
  addReservationError(errors, evidence.algorithm === WORKSPACE_MANIFEST_ALGORITHM,
    `${path}.algorithm: unsupported workspace manifest algorithm`);
  addReservationError(errors, RESERVATION_DIGEST.test(evidence.snapshot_digest || ''),
    `${path}.snapshot_digest: required sha256 digest`);
  addReservationError(errors,
    canonicalJson(evidence.policy) === canonicalJson(WORKSPACE_MANIFEST_POLICY)
      && evidence.policy_digest === WORKSPACE_MANIFEST_POLICY_DIGEST,
    `${path}.policy: workspace policy or digest mismatch`);
  const validateReferences = (references, label, { physical = false } = {}) => {
    addReservationError(errors, Array.isArray(references), `${label}: required array`);
    if (!Array.isArray(references)) return false;
    let valid = true;
    const validate = (condition, message) => {
      addReservationError(errors, condition, message);
      if (!condition) valid = false;
    };
    let previous = null;
    for (const [index, reference] of references.entries()) {
      const fields = physical
        ? ['bucket', 'digest', 'entry_count', 'topology_digest']
        : ['bucket', 'digest', 'entry_count'];
      validate(exactReservationKeys(reference, fields),
        `${label}[${index}]: unsupported shard reference shape`);
      if (!isObject(reference)) {
        valid = false;
        continue;
      }
      validate(/^[a-f0-9]{2}$/.test(reference.bucket || '')
        && (previous === null || reference.bucket > previous),
      `${label}[${index}].bucket: buckets must be canonical, unique, and sorted`);
      validate(RESERVATION_DIGEST.test(reference.digest || ''),
        `${label}[${index}].digest: required sha256 digest`);
      validate(Number.isInteger(reference.entry_count) && reference.entry_count > 0,
        `${label}[${index}].entry_count: required positive integer`);
      if (physical) validate(RESERVATION_DIGEST.test(reference.topology_digest || ''),
        `${label}[${index}].topology_digest: required sha256 digest`);
      previous = reference.bucket;
    }
    return valid;
  };
  const contentValid = validateReferences(evidence.content_shards, `${path}.content_shards`);
  const physicalValid = validateReferences(
    evidence.physical_shards,
    `${path}.physical_shards`,
    { physical: true },
  );
  for (const field of ['entry_count', 'regular_file_count', 'symbolic_link_count']) {
    addReservationError(errors, Number.isInteger(evidence[field]) && evidence[field] >= 0,
      `${path}.${field}: required non-negative integer`);
  }
  if (!contentValid || !physicalValid) return;
  const contentCount = evidence.content_shards.reduce((total, item) =>
    total + (Number.isInteger(item?.entry_count) ? item.entry_count : 0), 0);
  const physicalCount = evidence.physical_shards.reduce((total, item) =>
    total + (Number.isInteger(item?.entry_count) ? item.entry_count : 0), 0);
  addReservationError(errors, evidence.entry_count === contentCount,
    `${path}.entry_count: does not match content shards`);
  addReservationError(errors, evidence.regular_file_count === physicalCount,
    `${path}.regular_file_count: does not match physical shards`);
  addReservationError(errors,
    evidence.symbolic_link_count === evidence.entry_count - evidence.regular_file_count,
    `${path}.symbolic_link_count: inconsistent counts`);
  const contentRoot = reservationDomainDigest(
    'phantom-workspace-content-root-v2',
    evidence.content_shards,
  );
  const physicalRoot = reservationDomainDigest(
    'phantom-workspace-physical-root-v2',
    evidence.physical_shards,
  );
  const physicalTopologyRoot = physicalTopologyRootFromReferences(evidence.physical_shards);
  const contentHeader = {
    schema_version: 2,
    algorithm: WORKSPACE_MANIFEST_ALGORITHM,
    policy_digest: WORKSPACE_MANIFEST_POLICY_DIGEST,
    snapshot_digest: evidence.snapshot_digest,
    content_root: contentRoot,
    entry_count: contentCount,
    regular_file_count: physicalCount,
    symbolic_link_count: contentCount - physicalCount,
    content_shards: evidence.content_shards,
  };
  const manifestDigest = reservationDomainDigest('phantom-workspace-manifest-v2', contentHeader);
  const fingerprint = reservationDomainDigest('phantom-workspace-fingerprint-v2', {
    policy_digest: WORKSPACE_MANIFEST_POLICY_DIGEST,
    content_root: contentRoot,
  });
  const unsignedEvidence = {
    ...contentHeader,
    policy: structuredClone(WORKSPACE_MANIFEST_POLICY),
    fingerprint,
    manifest_digest: manifestDigest,
    physical_root: physicalRoot,
    physical_topology_root: physicalTopologyRoot,
    physical_shards: evidence.physical_shards,
  };
  addReservationError(errors, evidence.content_root === contentRoot,
    `${path}.content_root: invalid`);
  addReservationError(errors, evidence.physical_root === physicalRoot,
    `${path}.physical_root: invalid`);
  addReservationError(errors, evidence.physical_topology_root === physicalTopologyRoot,
    `${path}.physical_topology_root: invalid`);
  addReservationError(errors, evidence.manifest_digest === manifestDigest,
    `${path}.manifest_digest: invalid`);
  addReservationError(errors, evidence.fingerprint === fingerprint,
    `${path}.fingerprint: invalid`);
  addReservationError(errors,
    evidence.evidence_digest === reservationDomainDigest('phantom-workspace-evidence-v2', unsignedEvidence),
    `${path}.evidence_digest: invalid`);
};

const validateArtifactBinding = (value, path, errors, kind = null) => {
  addReservationError(errors, exactReservationKeys(value, ['artifact_ref', 'digest']),
    `${path}: must contain exact artifact_ref and digest fields`);
  if (!isObject(value)) return;
  addReservationError(errors, RESERVATION_DIGEST.test(value.digest || ''),
    `${path}.digest: required sha256 digest`);
  addReservationError(errors, reservationArtifactReference(value.artifact_ref, value.digest, kind),
    `${path}.artifact_ref: must match the content-addressed digest${kind ? ` and ${kind} kind` : ''}`);
};

const validateHostReservationBinding = (host, errors) => {
  addReservationError(errors, exactReservationKeys(host, [
    'adapter', 'baseline_snapshot', 'policy', 'registration', 'registry_trust',
  ]), '$.reservation_binding.host_adapter: unsupported shape');
  if (!isObject(host)) return;
  validateArtifactBinding(
    host.registry_trust,
    '$.reservation_binding.host_adapter.registry_trust',
    errors,
    'registry-trust',
  );
  validateArtifactBinding(
    host.registration,
    '$.reservation_binding.host_adapter.registration',
    errors,
    'registrations',
  );
  addReservationError(errors, exactReservationKeys(host.policy, ['digest', 'value']),
    '$.reservation_binding.host_adapter.policy: unsupported shape');
  if (isObject(host.policy)) {
    addReservationError(errors, RESERVATION_DIGEST.test(host.policy.digest || ''),
      '$.reservation_binding.host_adapter.policy.digest: required sha256 digest');
    addReservationError(errors, isObject(host.policy.value),
      '$.reservation_binding.host_adapter.policy.value: required object');
  }
  addReservationError(errors, exactReservationKeys(host.baseline_snapshot, [
    'artifact_ref', 'digest', 'evidence',
  ]), '$.reservation_binding.host_adapter.baseline_snapshot: unsupported shape');
  if (isObject(host.baseline_snapshot)) {
    addReservationError(errors, RESERVATION_DIGEST.test(host.baseline_snapshot.digest || ''),
      '$.reservation_binding.host_adapter.baseline_snapshot.digest: required sha256 digest');
    addReservationError(errors, reservationArtifactReference(
      host.baseline_snapshot.artifact_ref,
      host.baseline_snapshot.digest,
      'workspace-manifests',
    ), '$.reservation_binding.host_adapter.baseline_snapshot.artifact_ref: content address mismatch');
    validateWorkspaceEvidence(
      host.baseline_snapshot.evidence,
      '$.reservation_binding.host_adapter.baseline_snapshot.evidence',
      errors,
    );
  }
  addReservationError(errors, exactReservationKeys(host.adapter, [
    'adapter_id', 'adapter_version', 'attestation_key_id', 'host_instance_id',
  ]), '$.reservation_binding.host_adapter.adapter: unsupported shape');
  if (isObject(host.adapter)) for (const field of [
    'adapter_id', 'adapter_version', 'attestation_key_id', 'host_instance_id',
  ]) addReservationError(errors, RESERVATION_IDENTIFIER.test(host.adapter[field] || ''),
    `$.reservation_binding.host_adapter.adapter.${field}: invalid identifier`);
};

const reservationLaneForStatus = (status) => {
  if (['staged', 'pending', 'consuming', 'indeterminate'].includes(status)) return status;
  if (['succeeded', 'failed'].includes(status)) return 'completed';
  return null;
};

export function capabilityReservationDigest(reservationBinding) {
  return sha256(canonicalJson(reservationBinding));
}

export function validateCapabilityReservation(reservation, { lane = null } = {}) {
  const errors = [];
  if (!isObject(reservation)) return ['$: capability reservation must be an object'];
  const binding = reservation.reservation_binding;
  const kind = reservation.reservation_kind;
  const inferredLane = reservationLaneForStatus(reservation.status);
  const operational = (() => {
    if (inferredLane === 'staged' || inferredLane === 'pending') return [];
    if (inferredLane === 'consuming' && kind === 'native-tool-execution') {
      return ['claim', 'consuming_at'];
    }
    if (inferredLane === 'consuming') {
      const reconciliation = Object.hasOwn(reservation, 'attestations');
      return reconciliation
        ? [...new Set([...HOST_INGEST_FIELDS, ...HOST_FINAL_FIELDS])]
        : HOST_INGEST_FIELDS;
    }
    if (inferredLane === 'completed' && kind === 'native-tool-execution') {
      return ['claim', 'consuming_at', ...FINAL_FIELDS];
    }
    if (inferredLane === 'completed' || inferredLane === 'indeterminate') return HOST_FINAL_FIELDS;
    return [];
  })();
  addReservationError(errors, exactReservationKeys(
    reservation,
    [...RESERVATION_BASE_FIELDS, ...operational],
  ), '$: capability reservation has unsupported or missing fields');
  addReservationError(errors, reservation.schema_version === CAPABILITY_RESERVATION_SCHEMA_VERSION,
    '$.schema_version: must equal 2');
  addReservationError(errors, inferredLane !== null, '$.status: unsupported reservation status');
  if (lane !== null) addReservationError(errors, inferredLane === lane,
    `$.status: does not belong to the ${lane} lane`);
  addReservationError(errors, ['native-tool-execution', 'host-adapter-execution'].includes(kind),
    '$.reservation_kind: unsupported reservation kind');
  addReservationError(errors, reservationTimestamp(reservation.created_at),
    '$.created_at: required canonical timestamp');
  addReservationError(errors, reservationNonce(reservation.execution_nonce),
    '$.execution_nonce: required canonical 32-byte base64url');
  for (const field of ['decision_digest', 'request_digest', 'reservation_digest']) {
    addReservationError(errors, RESERVATION_DIGEST.test(reservation[field] || ''),
      `$.${field}: required sha256 digest`);
  }
  for (const field of ['request_id', 'workflow_id', 'node_id', 'idempotency_key']) {
    addReservationError(errors, RESERVATION_IDENTIFIER.test(reservation[field] || ''),
      `$.${field}: invalid identifier`);
  }
  addReservationError(errors, RESERVATION_CAPABILITIES.has(reservation.capability_type),
    '$.capability_type: unsupported capability');
  addReservationError(errors, reservation.authorized_journal_tail_digest === null
    || RESERVATION_DIGEST.test(reservation.authorized_journal_tail_digest || ''),
  '$.authorized_journal_tail_digest: must be null or a sha256 digest');
  addReservationError(errors, reservation.workspace_evidence_digest_before === null
    || RESERVATION_DIGEST.test(reservation.workspace_evidence_digest_before || ''),
  '$.workspace_evidence_digest_before: must be null or a sha256 digest');
  const requestErrors = validateCapabilityRequest(reservation.request);
  if (requestErrors.length) errors.push(`$.request: ${requestErrors.join('; ')}`);
  addReservationError(errors, validReservedBudget(reservation.reserved_budget),
    '$.reserved_budget: required positive exact budget');
  if (requestErrors.length === 0) {
    addReservationError(errors, reservation.request_digest === capabilityRequestDigest(reservation.request),
      '$.request_digest: does not match request');
    addReservationError(errors,
      canonicalJson(reservation.reserved_budget) === canonicalJson(capabilityRequestBudget(reservation.request)),
      '$.reserved_budget: does not match request budget');
    for (const [field, requestField] of [
      ['request_id', 'request_id'], ['workflow_id', 'workflow_id'], ['node_id', 'node_id'],
      ['capability_type', 'type'],
    ]) addReservationError(errors, reservation[field] === reservation.request[requestField],
      `$.${field}: does not match request`);
  }
  addReservationError(errors, exactReservationKeys(binding, RESERVATION_BINDING_FIELDS),
    '$.reservation_binding: unsupported immutable binding shape');
  if (isObject(binding)) {
    addReservationError(errors, binding.schema_version === CAPABILITY_RESERVATION_SCHEMA_VERSION,
      '$.reservation_binding.schema_version: must equal 2');
    addReservationError(errors, binding.reservation_kind === kind,
      '$.reservation_binding.reservation_kind: does not match envelope kind');
    addReservationError(errors, capabilityReservationDigest(binding) === reservation.reservation_digest,
      '$.reservation_digest: does not match reservation_binding');
    for (const field of RESERVATION_BINDING_FIELDS.filter((entry) =>
      !['schema_version', 'host_adapter'].includes(entry))) {
      addReservationError(errors,
        canonicalJson(reservation[field]) === canonicalJson(binding[field]),
        `$.${field}: does not match reservation_binding`);
    }
  }
  const hard = reservation.hard_enforcement;
  const hardFields = kind === 'host-adapter-execution'
    ? HOST_RESERVATION_HARD_FIELDS
    : NATIVE_RESERVATION_HARD_FIELDS;
  addReservationError(errors, exactReservationKeys(hard, hardFields),
    '$.hard_enforcement: unsupported variant shape');
  if (isObject(hard)) {
    const { binding_digest: bindingDigest, ...unsignedHard } = hard;
    addReservationError(errors, bindingDigest === sha256(canonicalJson({
      request: reservation.request,
      binding: unsignedHard,
    })), '$.hard_enforcement.binding_digest: invalid');
    for (const field of ['authority_decision_digest', 'binding_digest', 'worktree_fingerprint']) {
      addReservationError(errors, RESERVATION_DIGEST.test(hard[field] || ''),
        `$.hard_enforcement.${field}: required sha256 digest`);
    }
    for (const field of ['body_digest', 'tree_digest']) addReservationError(
      errors,
      hard[field] === null || RESERVATION_DIGEST.test(hard[field] || ''),
      `$.hard_enforcement.${field}: must be null or a sha256 digest`,
    );
    addReservationError(errors, hard.head_sha === null || RESERVATION_SHA.test(hard.head_sha || ''),
      '$.hard_enforcement.head_sha: must be null or a Git object id');
    addReservationError(errors, hard.current_branch === null
      || (typeof hard.current_branch === 'string' && hard.current_branch.length > 0
        && hard.current_branch.length <= 256 && !/[\0\s\\]/.test(hard.current_branch)),
    '$.hard_enforcement.current_branch: invalid branch');
    addReservationError(errors, Array.isArray(hard.protected_branches)
      && hard.protected_branches.length > 0
      && new Set(hard.protected_branches).size === hard.protected_branches.length
      && hard.protected_branches.every((branch) => typeof branch === 'string'
        && branch.length > 0 && branch.length <= 256 && !/[\0\s\\]/.test(branch)),
    '$.hard_enforcement.protected_branches: required unique branch array');
    addReservationError(errors, hard.command === null || (Array.isArray(hard.command)
      && hard.command.length > 0 && hard.command.length <= 256
      && hard.command.every((argument) => typeof argument === 'string'
        && argument.length > 0 && argument.length <= 8192 && !argument.includes('\0'))),
    '$.hard_enforcement.command: must be null or a bounded argv array');
    addReservationError(errors, hard.cwd === null || portablePath(hard.cwd),
      '$.hard_enforcement.cwd: must be null or a portable path');
    addReservationError(errors, hard.paths === null || (Array.isArray(hard.paths)
      && hard.paths.length > 0 && new Set(hard.paths).size === hard.paths.length
      && hard.paths.every((entry) => portablePath(entry))),
    '$.hard_enforcement.paths: must be null or unique portable paths');
    if (requestErrors.length === 0) {
      const expectedBodyDigest = reservation.request.patchDigest
        ?? reservation.request.bodyDigest
        ?? (reservation.request.type === 'git.commit'
          ? sha256(reservation.request.message)
          : null);
      for (const [field, expected] of [
        ['worktree_fingerprint', reservation.request.worktreeFingerprint],
        ['body_digest', expectedBodyDigest],
        ['tree_digest', reservation.request.treeDigest ?? null],
        ['command', reservation.request.command ?? null],
        ['cwd', reservation.request.cwd ?? null],
        ['paths', reservation.request.paths ?? null],
      ]) addReservationError(errors, canonicalJson(hard[field]) === canonicalJson(expected),
        `$.hard_enforcement.${field}: does not match request`);
      if (['git.push', 'github.openDraftPr'].includes(reservation.request.type)) {
        addReservationError(errors, hard.head_sha === reservation.request.headSha,
          '$.hard_enforcement.head_sha: does not match request');
      } else if (reservation.request.type !== 'git.commit') {
        addReservationError(errors, hard.head_sha === null,
          '$.hard_enforcement.head_sha: unsupported for capability');
      }
    }
    if (kind === 'native-tool-execution') {
      addReservationError(errors, hard.adapter_binding === 'native-tool-gate-v1',
        '$.hard_enforcement.adapter_binding: invalid native binding');
      addReservationError(errors, binding?.host_adapter === null,
        '$.reservation_binding.host_adapter: native reservation requires null');
      addReservationError(errors, reservation.capability_type === 'workspace.write',
        '$.capability_type: native reservation is restricted to workspace.write');
      addReservationError(errors, reservation.workspace_evidence_digest_before === null,
        '$.workspace_evidence_digest_before: native reservation requires null');
      addReservationError(errors, RESERVATION_DIGEST.test(hard.interception_probe_digest || ''),
        '$.hard_enforcement.interception_probe_digest: native reservation requires digest');
    } else if (kind === 'host-adapter-execution') {
      addReservationError(errors, hard.adapter_binding === 'signed-host-adapter-v1',
        '$.hard_enforcement.adapter_binding: invalid host binding');
      validateHostReservationBinding(binding?.host_adapter, errors);
      const host = binding?.host_adapter;
      if (isObject(host)) {
        addReservationError(errors, hard.registry_trust_digest === host.registry_trust?.digest,
          '$.hard_enforcement.registry_trust_digest: binding mismatch');
        addReservationError(errors, hard.registration_digest === host.registration?.digest,
          '$.hard_enforcement.registration_digest: binding mismatch');
        addReservationError(errors, hard.policy_digest === host.policy?.digest,
          '$.hard_enforcement.policy_digest: binding mismatch');
      }
      addReservationError(errors, RESERVATION_DIGEST.test(
        reservation.workspace_evidence_digest_before || '',
      ), '$.workspace_evidence_digest_before: host reservation requires digest');
      addReservationError(errors, hard.interception_probe_digest === null,
        '$.hard_enforcement.interception_probe_digest: host reservation requires null');
      for (const field of ['policy_digest', 'registration_digest', 'registry_trust_digest']) {
        addReservationError(errors, RESERVATION_DIGEST.test(hard[field] || ''),
          `$.hard_enforcement.${field}: required sha256 digest`);
      }
      addReservationError(errors,
        binding?.host_adapter?.baseline_snapshot?.evidence?.evidence_digest
          === reservation.workspace_evidence_digest_before,
      '$.workspace_evidence_digest_before: does not match baseline evidence');
      addReservationError(errors, RESERVATION_DIGEST.test(
        reservation.authorized_journal_tail_digest || '',
      ), '$.authorized_journal_tail_digest: host reservation requires digest');
    }
  }
  if (Object.hasOwn(reservation, 'consuming_at')) addReservationError(
    errors,
    reservationTimestamp(reservation.consuming_at),
    '$.consuming_at: required canonical timestamp',
  );
  if (Object.hasOwn(reservation, 'claim')) {
    addReservationError(errors, exactReservationKeys(reservation.claim, NATIVE_CLAIM_FIELDS),
      '$.claim: unsupported native claim shape');
    if (isObject(reservation.claim)) {
      addReservationError(errors, reservation.claim.schema_version === 1,
        '$.claim.schema_version: must equal 1');
      addReservationError(errors, RESERVATION_DIGEST.test(reservation.claim.effect_digest || ''),
        '$.claim.effect_digest: required sha256 digest');
      addReservationError(errors, typeof reservation.claim.tool_name === 'string'
        && reservation.claim.tool_name.length > 0,
      '$.claim.tool_name: required string');
      for (const field of ['tool_call_id', 'host_session_id']) addReservationError(
        errors,
        reservation.claim[field] === null
          || (typeof reservation.claim[field] === 'string' && reservation.claim[field].length > 0),
        `$.claim.${field}: must be null or nonempty string`,
      );
      validateNativeWritePreflight(reservation.claim, reservation.request, errors);
    }
  }
  if (Object.hasOwn(reservation, 'ingesting_recorded_at')) addReservationError(
    errors,
    reservationTimestamp(reservation.ingesting_recorded_at),
    '$.ingesting_recorded_at: required canonical timestamp',
  );
  if (Object.hasOwn(reservation, 'ingesting_execution_evidence')) {
    validateArtifactBinding(
      reservation.ingesting_execution_evidence,
      '$.ingesting_execution_evidence',
      errors,
      'execution-evidence',
    );
    addReservationError(errors, RESERVATION_DIGEST.test(
      reservation.ingesting_attestation_digest || '',
    ), '$.ingesting_attestation_digest: required sha256 digest');
    addReservationError(errors, ['pending', 'indeterminate'].includes(reservation.ingesting_from),
      '$.ingesting_from: must be pending or indeterminate');
    addReservationError(errors,
      (reservation.ingesting_from === 'pending' && !Object.hasOwn(reservation, 'attestations'))
        || (reservation.ingesting_from === 'indeterminate'
          && Array.isArray(reservation.attestations)
          && reservation.attestations.length === 1
          && reservation.attestations[0]?.status === 'indeterminate'),
    '$.ingesting_from: does not match initial or reconciliation evidence');
  }
  if (Object.hasOwn(reservation, 'completed_at')) addReservationError(
    errors,
    reservationTimestamp(reservation.completed_at),
    '$.completed_at: required canonical timestamp',
  );
  if (Object.hasOwn(reservation, 'outcome_digest')) addReservationError(
    errors,
    RESERVATION_DIGEST.test(reservation.outcome_digest || ''),
    '$.outcome_digest: required sha256 digest',
  );
  if (Object.hasOwn(reservation, 'attestations')) {
    addReservationError(errors, Array.isArray(reservation.attestations)
      && reservation.attestations.length >= 1 && reservation.attestations.length <= 2,
    '$.attestations: requires one initial and at most one reconciliation attestation');
    for (const [index, entry] of (Array.isArray(reservation.attestations)
      ? reservation.attestations : []).entries()) {
      const path = `$.attestations[${index}]`;
      addReservationError(errors, exactReservationKeys(entry, [
        'artifact_ref', 'digest', 'execution_evidence', 'recorded_at', 'status',
        'workspace_after',
      ]), `${path}: unsupported shape`);
      if (!isObject(entry)) continue;
      addReservationError(errors, RESERVATION_DIGEST.test(entry.digest || ''),
        `${path}.digest: required sha256 digest`);
      addReservationError(errors, reservationArtifactReference(
        entry.artifact_ref,
        entry.digest,
        'attestations',
      ), `${path}.artifact_ref: content address mismatch`);
      addReservationError(errors, ['succeeded', 'failed', 'indeterminate'].includes(entry.status),
        `${path}.status: unsupported attestation status`);
      addReservationError(errors, reservationTimestamp(entry.recorded_at),
        `${path}.recorded_at: required canonical timestamp`);
      validateArtifactBinding(
        entry.execution_evidence,
        `${path}.execution_evidence`,
        errors,
        'execution-evidence',
      );
      addReservationError(errors, exactReservationKeys(entry.workspace_after, [
        'artifact_ref', 'digest', 'evidence',
      ]), `${path}.workspace_after: unsupported shape`);
      if (isObject(entry.workspace_after)) {
        addReservationError(errors, RESERVATION_DIGEST.test(entry.workspace_after.digest || ''),
          `${path}.workspace_after.digest: required sha256 digest`);
        addReservationError(errors, reservationArtifactReference(
          entry.workspace_after.artifact_ref,
          entry.workspace_after.digest,
          'workspace-manifests',
        ), `${path}.workspace_after.artifact_ref: content address mismatch`);
        validateWorkspaceEvidence(entry.workspace_after.evidence, `${path}.workspace_after.evidence`, errors);
      }
    }
  }
  const finalState = inferredLane === 'completed' || inferredLane === 'indeterminate';
  const reconciliationClaim = inferredLane === 'consuming' && Object.hasOwn(reservation, 'attestations');
  if (finalState || reconciliationClaim) {
    addReservationError(errors, typeof reservation.error === 'string'
      ? reservation.error.length > 0 && reservation.error.length <= 4096
      : reservation.error === null,
    '$.error: must be null or nonempty bounded string');
    addReservationError(errors, typeof reservation.external_reference === 'string'
      ? reservation.external_reference.length > 0 && reservation.external_reference.length <= 2048
      : reservation.external_reference === null,
    '$.external_reference: must be null or nonempty bounded string');
    if (finalState) {
      const failed = ['failed', 'indeterminate'].includes(reservation.status);
      addReservationError(errors, failed ? typeof reservation.error === 'string' : reservation.error === null,
        '$.error: does not match final status');
      addReservationError(errors, reservation.status !== 'indeterminate'
        || reservation.external_reference === null,
      '$.external_reference: indeterminate status requires null');
      const externalSuccess = reservation.status === 'succeeded'
        && ['git.push', 'github.openDraftPr', 'tracker.comment'].includes(reservation.capability_type);
      addReservationError(errors, externalSuccess
        ? typeof reservation.external_reference === 'string'
        : reservation.external_reference === null,
      '$.external_reference: does not match capability and status');
    }
  }
  if ((finalState || reconciliationClaim) && kind === 'host-adapter-execution'
    && Array.isArray(reservation.attestations) && reservation.attestations.length > 0) {
    const attestations = reservation.attestations;
    if (attestations.length === 1) {
      addReservationError(errors, reconciliationClaim
        ? attestations[0].status === 'indeterminate'
        : attestations[0].status === reservation.status,
      '$.attestations: initial attestation status mismatch');
    } else if (attestations.length === 2) {
      addReservationError(errors, attestations[0].status === 'indeterminate'
        && attestations[1].status === reservation.status,
      '$.attestations: reconciliation sequence is invalid');
    }
    const expectedIndeterminate = attestations[0].status === 'indeterminate'
      ? attestations[0].digest
      : null;
    addReservationError(errors,
      reservation.indeterminate_attestation_digest === expectedIndeterminate,
    '$.indeterminate_attestation_digest: does not match attestation history');
    if (finalState) addReservationError(errors,
      reservation.completed_at === attestations.at(-1).recorded_at,
    '$.completed_at: does not match final attestation recorded_at');
  }
  return errors;
}

export function assertCapabilityReservation(reservation, options = {}) {
  const errors = validateCapabilityReservation(reservation, options);
  if (errors.length) throw new Error(`Invalid capability reservation: ${errors.join('; ')}`);
  return reservation;
}

export function validateCapabilityReservationTransition({
  fromLane,
  toLane,
  before,
  after,
}) {
  const errors = [
    ...validateCapabilityReservation(before, { lane: fromLane }).map((error) => `before ${error}`),
    ...validateCapabilityReservation(after, { lane: toLane }).map((error) => `after ${error}`),
  ];
  const allowed = new Set([
    'staged:pending',
    'pending:consuming',
    'indeterminate:consuming',
    'consuming:completed',
    'consuming:indeterminate',
  ]);
  addReservationError(errors, allowed.has(`${fromLane}:${toLane}`),
    `unsupported reservation transition ${fromLane}:${toLane}`);
  if (isObject(before) && isObject(after)) {
    addReservationError(errors,
      canonicalJson(before.reservation_binding) === canonicalJson(after.reservation_binding)
        && before.reservation_digest === after.reservation_digest,
      'reservation transition changed immutable binding');
    if (fromLane === 'staged' && toLane === 'pending') {
      addReservationError(errors, canonicalJson(after) === canonicalJson({ ...before, status: 'pending' }),
        'staged publication changed fields other than status');
    }
    if (fromLane === 'consuming' && Object.hasOwn(before, 'consuming_at')) addReservationError(
      errors,
      after.consuming_at === before.consuming_at,
      'reservation transition changed consuming_at',
    );
    if (Object.hasOwn(before, 'claim')) addReservationError(
      errors,
      canonicalJson(after.claim) === canonicalJson(before.claim),
      'reservation transition changed native claim',
    );
    if (fromLane === 'pending' && toLane === 'consuming'
      && before.reservation_kind === 'native-tool-execution') addReservationError(
      errors,
      Array.isArray(after.claim?.write_preflight),
      'native claim transition did not append write_preflight',
    );
    if (fromLane === 'consuming' && toLane === 'completed'
      && before.reservation_kind === 'native-tool-execution') addReservationError(
      errors,
      canonicalJson(after.claim?.write_preflight) === canonicalJson(before.claim?.write_preflight),
      'native finalization changed write_preflight',
    );
    if (fromLane === 'indeterminate' && toLane === 'consuming') {
      for (const field of HOST_FINAL_FIELDS.filter((entry) => entry !== 'consuming_at')) addReservationError(
        errors,
        canonicalJson(after[field]) === canonicalJson(before[field]),
        `reconciliation claim changed prior ${field}`,
      );
    }
    if (fromLane === 'consuming' && ['completed', 'indeterminate'].includes(toLane)
      && before.reservation_kind === 'host-adapter-execution') {
      const prior = before.attestations ?? [];
      const finalEntries = after.attestations ?? [];
      addReservationError(errors,
        canonicalJson(finalEntries.slice(0, prior.length)) === canonicalJson(prior)
          && finalEntries.length === prior.length + 1,
        'host finalization did not append exactly one attestation');
      const appended = finalEntries.at(-1);
      addReservationError(errors,
        appended?.digest === before.ingesting_attestation_digest
          && appended?.recorded_at === before.ingesting_recorded_at
          && canonicalJson(appended?.execution_evidence)
            === canonicalJson(before.ingesting_execution_evidence),
        'host finalization does not match ingestion evidence');
    }
  }
  return errors;
}

export function assertCapabilityReservationTransition(transition) {
  const errors = validateCapabilityReservationTransition(transition);
  if (errors.length) throw new Error(`Invalid capability reservation transition: ${errors.join('; ')}`);
  return transition.after;
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
    reserved_budget: decision.reserved_budget ?? null,
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
  return Array.isArray(source) ? source : [];
}

function workflowNodeState(context, nodeId) {
  const source = context.workflowState?.nodes;
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
  if (isObject(context.runtimeCapabilities)) {
    return new Set(Object.entries(context.runtimeCapabilities)
      .filter(([, status]) => status === true || status === 'available')
      .map(([name]) => name));
  }
  return new Set();
}

function hostAdapterCapability(context, type) {
  return context.hostAdapter?.status === 'ready'
    && context.hostAdapter.capabilities?.[type]?.status === 'ready';
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
    reserved_budget: null,
  };
  return finalizeDecision(decision);
}

export function authorizeCapability(request, context) {
  const contractErrors = validateCapabilityRequest(request);
  if (contractErrors.length > 0) return deny(request, contractErrors.map((error) => `invalid_request:${error}`));

  const reasons = [];
  const requestedBudget = capabilityRequestBudget(request);
  const session = context.session;
  if (!isObject(session) || session.status !== 'active') reasons.push('session_not_active');
  if (context.workflow?.workflow_id !== request.workflow_id) reasons.push('workflow_mismatch');
  const node = workflowNodes(context).find((candidate) => candidate.id === request.node_id);
  if (!node) reasons.push('unknown_node');
  const nodeState = workflowNodeState(context, request.node_id);
  if (!nodeState || !['ready', 'running', 'in_progress'].includes(nodeState.status)) reasons.push('node_not_active');
  if (context.workflowEffectUnresolved === true) reasons.push('workflow_effect_reconciliation_required');
  if (context.currentWorktreeFingerprint !== request.worktreeFingerprint) reasons.push('stale_worktree');
  if ((node?.risk === 'critical' || context.risk === 'critical') && session?.route === 'direct') {
    reasons.push('route_policy_violation');
  }

  const capabilities = runtimeCapabilities(context);
  const hostAttested = HOST_ATTESTED_CAPABILITIES.has(request.type);
  if (hostAttested) {
    if (!hostAdapterCapability(context, request.type)) reasons.push('host_adapter_unavailable');
  } else {
    if (context.trusted_interception !== true) reasons.push('host_interception_unavailable');
    if (!RUNTIME_CAPABILITIES[request.type].some((name) => capabilities.has(name))) {
      reasons.push('runtime_capability_unavailable');
    }
  }
  const workflowBudgetAvailable = Number.isFinite(context.remainingBudget?.cost)
    && Number.isInteger(context.remainingBudget?.duration_ms)
    && context.remainingBudget.cost >= 0
    && context.remainingBudget.duration_ms >= 0;
  const nodeBudgetAvailable = Number.isFinite(node?.budget?.max_cost_units)
    && Number.isInteger(node?.budget?.max_duration_ms)
    && Number.isFinite(nodeState?.consumed_budget?.cost_units)
    && Number.isInteger(nodeState?.consumed_budget?.duration_ms)
    && Number.isFinite(nodeState?.reserved_budget?.cost_units)
    && Number.isInteger(nodeState?.reserved_budget?.duration_ms);
  if (!workflowBudgetAvailable || !nodeBudgetAvailable) {
    reasons.push('budget_state_unavailable');
  } else {
    if (requestedBudget.cost_units > context.remainingBudget.cost) {
      reasons.push('cost_budget_exhausted');
    }
    if (requestedBudget.duration_ms > context.remainingBudget.duration_ms) {
      reasons.push('time_budget_exhausted');
    }
    const remainingNodeCost = node.budget.max_cost_units
      - nodeState.consumed_budget.cost_units
      - nodeState.reserved_budget.cost_units;
    const remainingNodeDuration = node.budget.max_duration_ms
      - nodeState.consumed_budget.duration_ms
      - nodeState.reserved_budget.duration_ms;
    if (requestedBudget.cost_units > remainingNodeCost) reasons.push('node_cost_budget_exhausted');
    if (requestedBudget.duration_ms > remainingNodeDuration) reasons.push('node_time_budget_exhausted');
  }
  if (BRANCH_BOUND_MUTATIONS.has(request.type)) {
    if ((hostAttested && context.hard_enforcement !== true)
      || (!hostAttested && context.hard_enforcement !== true && context.trusted_interception === true)
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
    const allowed = node.allowed_paths ?? [];
    if (!Array.isArray(allowed) || request.paths.some((path) => !withinScope(path, allowed))) {
      reasons.push('path_outside_node_scope');
    }
    if (request.paths.some((path) => protectedControlPath(path, context.protected_control_paths))) {
      reasons.push('control_plane_path_protected');
    }
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
    if (reservedEffectCommand(request.command)) reasons.push('reserved_effect_command');
  }
  if (request.type === 'git.commit' && context.currentTreeDigest !== request.treeDigest) {
    reasons.push('tree_digest_mismatch');
  }

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
      reserved_budget: null,
    };
    return finalizeDecision(duplicate);
  }
  const indeterminate = reservations.find((prior) => prior.request_digest === requestDigest
    && prior.execution_status === 'indeterminate');
  if (indeterminate) return deny(request, ['idempotency_reconciliation_required']);
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
    reserved_budget: requestedBudget,
  };
  return finalizeDecision(decision);
}
