// Author: Subash Karki

import { lstatSync, realpathSync } from 'node:fs';
import {
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';

const WORK_KINDS = new Set(['implementation', 'investigation']);
const DEFECT_SIGNAL = /\b(?:bug|defect|regression|incident)\b|\bflaky failure\b/i;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const CLEANUP_STATUSES = new Set(['not_required', 'pending', 'cleaned', 'approved_in_scope']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function nonemptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonempty);
}

function validTime(value) {
  return nonempty(value) && Number.isFinite(Date.parse(value));
}

function portablePath(value) {
  return nonempty(value)
    && !value.includes('\\')
    && !isAbsolute(value)
    && !/^[A-Za-z]:/.test(value)
    && value !== '.'
    && posix.normalize(value) === value
    && !value.split('/').includes('..');
}

function pathAllowed(path, scopes) {
  return scopes.some((scope) => path === scope || path.startsWith(`${scope}/`));
}

function evidenceRefErrors(refs, label, sessionDir) {
  const errors = [];
  let sessionRoot;
  try {
    sessionRoot = realpathSync(sessionDir);
  } catch {
    return [`${label} cannot be validated without the active session directory`];
  }

  refs.forEach((ref, index) => {
    const refLabel = `${label}[${index}]`;
    if (!portablePath(ref)) {
      errors.push(`${refLabel} must be a normalized session-relative path`);
      return;
    }

    const candidate = resolve(sessionRoot, ref);
    let resolved;
    let resolvedArtifact;
    try {
      resolved = realpathSync(candidate);
      resolvedArtifact = lstatSync(resolved);
    } catch {
      errors.push(`${refLabel} does not reference an existing file`);
      return;
    }

    const fromSession = relative(sessionRoot, resolved);
    if (isAbsolute(fromSession) || fromSession === '..' || fromSession.startsWith(`..${sep}`)) {
      errors.push(`${refLabel} resolves outside the active session directory`);
      return;
    }
    if (!resolvedArtifact.isFile()) {
      errors.push(`${refLabel} must reference a regular file`);
    }
  });
  return errors;
}

export function hasDefectSignal(intent = '') {
  return DEFECT_SIGNAL.test(String(intent));
}

// The marker key, not object shape, decides whether a session field is a correction record.
export function workKindCorrectionErrors(correction) {
  if (!isObject(correction)) return ['work_kind_correction must be an object'];
  const errors = [];
  if (correction.record_type !== 'work_kind_correction') {
    errors.push('work_kind_correction.record_type must be work_kind_correction');
  }
  for (const key of ['from', 'to']) {
    if (!WORK_KINDS.has(correction[key])) {
      errors.push(`work_kind_correction.${key} must be implementation or investigation`);
    }
  }
  if (correction.from === correction.to) {
    errors.push('work_kind_correction.to must differ from work_kind_correction.from');
  }
  if (!nonempty(correction.granted_by)) errors.push('work_kind_correction.granted_by is required');
  if (!nonempty(correction.reason)) errors.push('work_kind_correction.reason is required');
  if (!validTime(correction.at)) errors.push('work_kind_correction.at must be an ISO timestamp');
  return errors;
}

export function correctedWorkKind(correction) {
  if (correction === null || correction === undefined) return null;
  return workKindCorrectionErrors(correction).length === 0 ? correction.to : null;
}

export function resolveWorkKind(explicit, intent = '', correction = null) {
  if (explicit !== undefined) {
    if (!WORK_KINDS.has(explicit)) {
      throw new Error('work-kind must be implementation or investigation.');
    }
  }
  if (hasDefectSignal(intent)) return correctedWorkKind(correction) ?? 'investigation';
  return explicit ?? 'implementation';
}

export function diagnosticGrantErrors(grant, options = {}) {
  if (grant === null || grant === undefined) return [];
  if (!isObject(grant)) return ['diagnosticGrant must be an object or null'];

  const errors = [];
  if (!nonempty(grant.grantedBy)) errors.push('diagnosticGrant.grantedBy is required');
  if (!nonempty(grant.objective)) errors.push('diagnosticGrant.objective is required');
  if (typeof grant.cleanupRequired !== 'boolean') {
    errors.push('diagnosticGrant.cleanupRequired must be a boolean');
  }
  if (!validTime(grant.grantedAt)) errors.push('diagnosticGrant.grantedAt must be an ISO timestamp');
  if (!validTime(grant.expiresAt)) errors.push('diagnosticGrant.expiresAt must be an ISO timestamp');
  if (validTime(grant.grantedAt) && validTime(grant.expiresAt)
    && Date.parse(grant.expiresAt) <= Date.parse(grant.grantedAt)) {
    errors.push('diagnosticGrant.expiresAt must be after grantedAt');
  }
  const nowMs = options.nowMs ?? Date.now();
  if (validTime(grant.expiresAt) && Date.parse(grant.expiresAt) <= nowMs) {
    errors.push('diagnosticGrant is expired');
  }
  if (grant.revokedAt !== null && grant.revokedAt !== undefined) {
    if (!validTime(grant.revokedAt)) errors.push('diagnosticGrant.revokedAt must be null or an ISO timestamp');
    else errors.push('diagnosticGrant is revoked');
  }
  const validAllowedActions = nonemptyStrings(grant.allowedActions);
  if (!validAllowedActions) {
    errors.push('diagnosticGrant.allowedActions must be a non-empty string array');
  }
  const validAllowedPaths = nonemptyStrings(grant.allowedPaths)
    && grant.allowedPaths.every(portablePath);
  if (!validAllowedPaths) {
    errors.push('diagnosticGrant.allowedPaths must contain normalized workspace-relative paths');
  }
  if (!FINGERPRINT.test(grant.baselineFingerprint || '')) {
    errors.push('diagnosticGrant.baselineFingerprint must be a sha256 fingerprint');
  }
  if (!CLEANUP_STATUSES.has(grant.cleanupStatus)) {
    errors.push('diagnosticGrant.cleanupStatus is invalid');
  }

  const instrumentation = grant.instrumentation;
  if (!Array.isArray(instrumentation)) {
    errors.push('diagnosticGrant.instrumentation must be an array');
  } else {
    instrumentation.forEach((record, index) => {
      const label = `diagnosticGrant.instrumentation[${index}]`;
      if (!isObject(record)) {
        errors.push(`${label} must be an object`);
        return;
      }
      if (!nonempty(record.action)) {
        errors.push(`${label}.action is required`);
      } else if (validAllowedActions && !grant.allowedActions.includes(record.action)) {
        errors.push(`${label}.action is outside allowedActions`);
      }
      if (!portablePath(record.path)) {
        errors.push(`${label}.path must be a normalized workspace-relative path`);
      } else if (validAllowedPaths && !pathAllowed(record.path, grant.allowedPaths)) {
        errors.push(`${label}.path is outside allowedPaths`);
      }
      if (!nonemptyStrings(record.evidenceRefs)) {
        errors.push(`${label}.evidenceRefs must be non-empty`);
      } else {
        errors.push(...evidenceRefErrors(
          record.evidenceRefs,
          `${label}.evidenceRefs`,
          options.sessionDir,
        ));
      }
    });
  }

  const hasInstrumentation = Array.isArray(instrumentation) && instrumentation.length > 0;
  if (grant.cleanupRequired === false && grant.cleanupStatus !== 'not_required') {
    errors.push('diagnosticGrant cleanupStatus must be not_required when cleanupRequired is false');
  }
  if (grant.cleanupRequired === true && grant.cleanupStatus === 'not_required') {
    errors.push('diagnosticGrant cleanupStatus cannot be not_required when cleanupRequired is true');
  }
  if (grant.cleanupStatus === 'not_required' && hasInstrumentation) {
    errors.push('diagnosticGrant cleanup cannot be not_required after instrumentation');
  }
  if (grant.cleanupStatus === 'pending') {
    errors.push('diagnosticGrant cleanup is pending');
  }
  if (grant.cleanupStatus === 'cleaned') {
    if (!validTime(grant.cleanedAt)) errors.push('diagnosticGrant.cleanedAt is required when cleaned');
    if (!nonemptyStrings(grant.cleanupEvidenceRefs)) {
      errors.push('diagnosticGrant.cleanupEvidenceRefs are required when cleaned');
    } else {
      errors.push(...evidenceRefErrors(
        grant.cleanupEvidenceRefs,
        'diagnosticGrant.cleanupEvidenceRefs',
        options.sessionDir,
      ));
    }
  }
  if (grant.cleanupStatus === 'approved_in_scope') {
    if (!nonempty(grant.cleanupApprovedBy)) {
      errors.push('diagnosticGrant.cleanupApprovedBy is required when approved_in_scope');
    }
    if (!validTime(grant.cleanupApprovedAt)) {
      errors.push('diagnosticGrant.cleanupApprovedAt is required when approved_in_scope');
    }
  }
  return errors;
}

export function defectProofErrors(proof, context = {}) {
  if (!isObject(proof)) return ['defect-proof.json is missing or malformed'];
  const errors = [];
  const meta = proof._meta;
  if (!isObject(meta) || meta.version !== 1) errors.push('_meta.version must be 1');
  if (meta?.repoId !== context.repoId) errors.push('_meta.repoId does not match the active session');
  if (meta?.taskId !== context.taskId) errors.push('_meta.taskId does not match the active session');
  if (!FINGERPRINT.test(meta?.baselineFingerprint || '')) {
    errors.push('_meta.baselineFingerprint must be a sha256 fingerprint');
  } else if (context.baselineFingerprint && meta.baselineFingerprint !== context.baselineFingerprint) {
    errors.push('defect proof is stale for the current worktree');
  }
  if (proof.workKind !== 'investigation') errors.push('workKind must be investigation');
  if (proof.state !== 'ready_for_fix') errors.push('state must be ready_for_fix');
  if (proof.verdict !== 'confirmed_defect') errors.push('verdict must be confirmed_defect');

  const reproduction = proof.reproduction;
  if (!isObject(reproduction) || reproduction.status !== 'observed') {
    errors.push('reproduction.status must be observed');
  } else {
    for (const key of ['scenario', 'expected', 'actual']) {
      if (!nonempty(reproduction[key])) errors.push(`reproduction.${key} is required`);
    }
    if (!validTime(reproduction.observedAt)) errors.push('reproduction.observedAt must be an ISO timestamp');
    if (!nonemptyStrings(reproduction.evidenceRefs)) {
      errors.push('reproduction.evidenceRefs must be non-empty');
    } else {
      errors.push(...evidenceRefErrors(
        reproduction.evidenceRefs,
        'reproduction.evidenceRefs',
        context.sessionDir,
      ));
    }
  }

  const rootCause = proof.rootCause;
  if (!isObject(rootCause) || rootCause.status !== 'confirmed') {
    errors.push('rootCause.status must be confirmed');
  } else {
    if (!nonemptyStrings(rootCause.exactCodePath)) {
      errors.push('rootCause.exactCodePath must be non-empty');
    }
    if (!nonempty(rootCause.claim)) errors.push('rootCause.claim is required');
    if (!nonemptyStrings(rootCause.evidenceRefs)) {
      errors.push('rootCause.evidenceRefs must be non-empty');
    } else {
      errors.push(...evidenceRefErrors(
        rootCause.evidenceRefs,
        'rootCause.evidenceRefs',
        context.sessionDir,
      ));
    }
    if (rootCause.confirmedByUser !== true) errors.push('rootCause.confirmedByUser must be true');
    if (!validTime(rootCause.confirmedAt)) errors.push('rootCause.confirmedAt must be an ISO timestamp');
  }

  const regression = proof.focusedRegressionCheck;
  if (!isObject(regression)) {
    errors.push('focusedRegressionCheck must be an object');
  } else {
    if (!nonempty(regression.commandOrScenario)) {
      errors.push('focusedRegressionCheck.commandOrScenario is required');
    }
    if (regression.preFixStatus !== 'failed') {
      errors.push('focusedRegressionCheck.preFixStatus must be failed');
    }
    if (!nonemptyStrings(regression.evidenceRefs)) {
      errors.push('focusedRegressionCheck.evidenceRefs must be non-empty');
    } else {
      errors.push(...evidenceRefErrors(
        regression.evidenceRefs,
        'focusedRegressionCheck.evidenceRefs',
        context.sessionDir,
      ));
    }
  }
  errors.push(...diagnosticGrantErrors(proof.diagnosticGrant, context));
  if (isObject(proof.diagnosticGrant)
    && FINGERPRINT.test(meta?.baselineFingerprint || '')
    && proof.diagnosticGrant.baselineFingerprint !== meta.baselineFingerprint) {
    errors.push('diagnosticGrant.baselineFingerprint does not match the defect proof baseline');
  }
  return errors;
}
