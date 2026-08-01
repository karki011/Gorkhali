// Author: Subash Karki
// Pure recognition of legacy session state. This module performs no I/O and
// deliberately returns only migration-safe metadata, never authority or evidence.

import { isAbsolute } from 'node:path';

const ROUTES = new Set(['direct', 'plan', 'brainstorm', 'full']);
const STATUSES = new Set(['active', 'paused', 'completed']);
const WORK_KINDS = new Set(['implementation', 'investigation']);
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,119}$/;
const POINTER_FIELDS = new Set([
  'schema_version', 'repo_id', 'task_id', 'session_dir', 'updated_at', 'status',
]);
const TELEMETRY_FIELDS = new Set(['cwd', 'session_id', 'ts']);

const classification = (kind, valid, migratable, reason, sourceSchema = null, metadata = null) => ({
  kind,
  valid,
  migratable,
  reason,
  source_schema: sourceSchema,
  metadata,
});

const invalid = (reason, sourceSchema = null) => (
  classification('invalid', false, false, reason, sourceSchema)
);

const isRecord = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasExactFields = (value, expected) => {
  const fields = Object.keys(value);
  return fields.length === expected.size && fields.every((field) => expected.has(field));
};

const hasOnlyFields = (value, expected) => Object.keys(value).every((field) => expected.has(field));

const isSafeSegment = (value) => typeof value === 'string'
  && SAFE_SEGMENT.test(value)
  && value !== '.'
  && value !== '..';

const isTimestamp = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const expectedValue = (expected, ...names) => {
  for (const name of names) {
    if (Object.hasOwn(expected, name)) return expected[name];
  }
  return undefined;
};

function classifyTelemetryPointer(value) {
  const resemblesTelemetry = Object.keys(value).some((field) => TELEMETRY_FIELDS.has(field));
  if (!resemblesTelemetry) return null;
  if (!hasExactFields(value, TELEMETRY_FIELDS)
    || typeof value.session_id !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.session_id)
    || typeof value.cwd !== 'string'
    || !isAbsolute(value.cwd)
    || !Number.isInteger(value.ts)
    || value.ts < 946_684_800_000
    || value.ts > 9_999_999_999_999) {
    return invalid('legacy_telemetry_invalid');
  }
  return classification(
    'legacy_telemetry',
    true,
    true,
    'legacy_telemetry_pointer',
  );
}

/**
 * Classify a parsed current-session pointer without reading or following paths.
 * `expected` may bind repo_id, task_id, session_dir, and completed_dir. Callers
 * must derive those values independently from their workspace and source path.
 */
export function classifyLegacyPointer(value, expected = {}) {
  if (!isRecord(value) || !isRecord(expected)) return invalid('pointer_not_object');

  const telemetry = classifyTelemetryPointer(value);
  if (telemetry !== null) return telemetry;

  if (value.schema_version === 2) {
    return classification('state_v2', true, false, 'state_envelope_v2', 2);
  }
  if (value.schema_version !== 1) {
    return classification('unknown', false, false, 'pointer_schema_unknown');
  }
  if (!hasOnlyFields(value, POINTER_FIELDS)
    || !Object.hasOwn(value, 'repo_id')
    || !Object.hasOwn(value, 'task_id')
    || !Object.hasOwn(value, 'session_dir')
    || !Object.hasOwn(value, 'updated_at')) {
    return invalid('legacy_pointer_fields_invalid', 1);
  }
  if (!isSafeSegment(value.repo_id)) return invalid('legacy_pointer_repo_unsafe', 1);
  if (!isSafeSegment(value.task_id)) return invalid('legacy_pointer_task_unsafe', 1);
  if (!isTimestamp(value.updated_at)) return invalid('legacy_pointer_timestamp_invalid', 1);
  if (value.status !== undefined && value.status !== 'completed') {
    return invalid('legacy_pointer_status_invalid', 1);
  }

  const expectedRepo = expectedValue(expected, 'repo_id', 'repoId');
  const expectedTask = expectedValue(expected, 'task_id', 'taskId');
  if (expectedRepo !== undefined && value.repo_id !== expectedRepo) {
    return invalid('legacy_pointer_repo_mismatch', 1);
  }
  if (expectedTask !== undefined && value.task_id !== expectedTask) {
    return invalid('legacy_pointer_task_mismatch', 1);
  }

  const expectedSessionDir = value.status === 'completed'
    ? expectedValue(expected, 'completed_dir', 'completedDir')
    : expectedValue(expected, 'session_dir', 'sessionDir');
  if (typeof value.session_dir !== 'string' || !isAbsolute(value.session_dir)) {
    return invalid('legacy_pointer_path_invalid', 1);
  }
  if (expectedSessionDir !== undefined && value.session_dir !== expectedSessionDir) {
    return invalid('legacy_pointer_path_mismatch', 1);
  }

  return classification('legacy_state_v1', true, true, 'state_envelope_v1', 1, {
    repo_id: value.repo_id,
    task_id: value.task_id,
    status: value.status ?? null,
    canonical_session_path: expectedSessionDir === undefined || value.session_dir === expectedSessionDir,
  });
}

function legacyMode(value) {
  if (value.lifecycle !== undefined && !isRecord(value.lifecycle)) {
    return { valid: false, mode: null };
  }
  const lifecycleMode = value.lifecycle?.mode;
  if (lifecycleMode !== undefined && !['standard', 'to-plan'].includes(lifecycleMode)) {
    return { valid: false, mode: null };
  }
  if (value.mode !== undefined && !['standard', 'to-plan'].includes(value.mode)) {
    return { valid: false, mode: null };
  }
  if (value.to_plan !== undefined && typeof value.to_plan !== 'boolean') {
    return { valid: false, mode: null };
  }
  const toPlan = lifecycleMode === 'to-plan' || value.mode === 'to-plan' || value.to_plan === true;
  return { valid: true, mode: toPlan ? 'to-plan' : 'standard' };
}

/**
 * Classify a parsed session.json without trusting its lifecycle authority.
 * `expected` may bind repo_id, task_id, workspace, source_path and session_file.
 * If both path fields are supplied they must be identical; neither is read here.
 */
export function classifyLegacySession(value, expected = {}) {
  if (!isRecord(value) || !isRecord(expected)) return invalid('session_not_object');
  if (value.schema_version === 2) {
    return classification('state_v2', true, false, 'state_envelope_v2', 2);
  }
  if (value.schema_version !== 1) {
    return classification('unknown', false, false, 'session_schema_unknown');
  }
  if (value.artifact_type !== 'session') return invalid('legacy_session_type_invalid', 1);
  if (!isSafeSegment(value.repo_id)) return invalid('legacy_session_repo_unsafe', 1);
  if (!isSafeSegment(value.task_id)) return invalid('legacy_session_task_unsafe', 1);

  const expectedRepo = expectedValue(expected, 'repo_id', 'repoId');
  const expectedTask = expectedValue(expected, 'task_id', 'taskId');
  const expectedWorkspace = expectedValue(expected, 'workspace');
  if (expectedRepo !== undefined && value.repo_id !== expectedRepo) {
    return invalid('legacy_session_repo_mismatch', 1);
  }
  if (expectedTask !== undefined && value.task_id !== expectedTask) {
    return invalid('legacy_session_task_mismatch', 1);
  }
  if (typeof value.workspace !== 'string' || !isAbsolute(value.workspace)) {
    return invalid('legacy_session_workspace_invalid', 1);
  }
  if (expectedWorkspace !== undefined && value.workspace !== expectedWorkspace) {
    return invalid('legacy_session_workspace_mismatch', 1);
  }

  const sourcePath = expectedValue(expected, 'source_path', 'sourcePath');
  const sessionFile = expectedValue(expected, 'session_file', 'sessionFile', 'canonical_session_file');
  if (sourcePath !== undefined && sessionFile !== undefined && sourcePath !== sessionFile) {
    return invalid('legacy_session_path_mismatch', 1);
  }
  if (!STATUSES.has(value.status)) return invalid('legacy_session_status_invalid', 1);
  if (!ROUTES.has(value.route)) return invalid('legacy_session_route_invalid', 1);
  if (typeof value.intent_summary !== 'string' || !value.intent_summary.trim()) {
    return invalid('legacy_session_intent_invalid', 1);
  }
  if (!isTimestamp(value.created_at) || !isTimestamp(value.updated_at)
    || Date.parse(value.updated_at) < Date.parse(value.created_at)) {
    return invalid('legacy_session_timestamp_invalid', 1);
  }
  for (const field of ['resumed_at', 'completed_at']) {
    if (value[field] !== undefined && !isTimestamp(value[field])) {
      return invalid('legacy_session_timestamp_invalid', 1);
    }
  }
  if (value.status === 'completed' && !isTimestamp(value.completed_at)) {
    return invalid('legacy_session_completion_timestamp_missing', 1);
  }
  if (value.pause_reason !== undefined
    && (typeof value.pause_reason !== 'string' || !value.pause_reason.trim())) {
    return invalid('legacy_session_pause_reason_invalid', 1);
  }

  const mode = legacyMode(value);
  if (!mode.valid) return invalid('legacy_session_mode_invalid', 1);
  if (value.work_kind !== undefined && !WORK_KINDS.has(value.work_kind)) {
    return invalid('legacy_session_work_kind_invalid', 1);
  }

  const workKindMissing = value.work_kind === undefined;
  return classification(
    'legacy_state_v1',
    true,
    true,
    workKindMissing ? 'legacy_session_work_kind_missing' : 'state_envelope_v1',
    1,
    {
      repo_id: value.repo_id,
      task_id: value.task_id,
      status: value.status,
      workspace: value.workspace,
      route: value.route,
      intent_summary: value.intent_summary,
      work_kind: value.work_kind ?? null,
      mode: mode.mode,
      pause_reason: value.pause_reason ?? null,
      timestamps: {
        created_at: value.created_at,
        updated_at: value.updated_at,
        resumed_at: value.resumed_at ?? null,
        completed_at: value.completed_at ?? null,
      },
    },
  );
}

/**
 * Combine pure classifications into the migration decision used by Doctor and
 * the offline migrator. This function never promotes legacy authority/evidence.
 */
export function legacyMigrationRequirement(pointer, session = null) {
  if (!isRecord(pointer)) {
    return { status: 'blocked', reason: 'legacy_pointer_classification_invalid' };
  }
  if (pointer.kind === 'state_v2') {
    return { status: 'not_required', reason: 'state_envelope_v2' };
  }
  if (pointer.kind === 'legacy_telemetry' && pointer.valid && pointer.migratable) {
    return { status: 'required', reason: 'legacy_telemetry_pointer' };
  }
  if (pointer.kind !== 'legacy_state_v1' || !pointer.valid || !pointer.migratable) {
    return { status: 'blocked', reason: pointer.reason || 'legacy_pointer_invalid' };
  }
  if (session === null) return { status: 'blocked', reason: 'legacy_session_missing' };
  if (!isRecord(session) || session.kind !== 'legacy_state_v1'
    || !session.valid || !session.migratable) {
    return { status: 'blocked', reason: session?.reason || 'legacy_session_invalid' };
  }
  if (pointer.metadata.repo_id !== session.metadata.repo_id
    || pointer.metadata.task_id !== session.metadata.task_id) {
    return { status: 'blocked', reason: 'legacy_state_identity_mismatch' };
  }
  const pointerCompleted = pointer.metadata.status === 'completed';
  const sessionCompleted = session.metadata.status === 'completed';
  if (pointerCompleted !== sessionCompleted) {
    return { status: 'blocked', reason: 'legacy_state_status_mismatch' };
  }
  return {
    status: 'required',
    reason: session.reason === 'legacy_session_work_kind_missing'
      ? 'legacy_session_work_kind_missing'
      : 'state_envelope_v1',
  };
}
