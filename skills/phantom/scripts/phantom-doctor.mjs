#!/usr/bin/env node

// Author: Subash Karki
// Read-only, sanitized readiness report for Phantom's execution boundaries.

import { lstatSync } from 'node:fs';
import { join } from 'node:path';

import {
  authorityTrustFile,
  verifyCapabilityProbe,
} from './lib/authority-decision.mjs';
import { readRegularFileOnce, workspaceSnapshot } from './lib/filesystem-snapshot.mjs';
import {
  hostAdapterReadiness,
  SUPPORTED_ADAPTER_CAPABILITIES,
} from './lib/host-adapter-contracts.mjs';
import {
  executorProbeFile,
  executorTrustFile,
  verifyExecutorProbe,
} from './lib/isolated-executor-attestation.mjs';
import {
  classifyLegacyPointer,
  classifyLegacySession,
  legacyMigrationRequirement,
} from './lib/legacy-session-classifier.mjs';
import {
  currentSessionFile,
  dataRoot,
  isMainModule,
  parseArgs,
  repoIdentity,
  sessionPaths,
  workspacePath,
} from './lib/portable.mjs';
import { pointerErrors, sessionErrors } from './lib/session-contracts.mjs';

const HOST_TRUST_FILE = 'host-adapter-registry-trust.json';
const HOST_REGISTRATION_FILE = 'host-adapter-registration.json';
const NATIVE_CAPABILITY = 'workspace.write';
const ISOLATED_CAPABILITY = 'parallel.branch';
const SECTION_STATUSES = new Set(['not_applicable', 'not_registered', 'ready', 'blocked']);
const MIGRATION_STATUSES = new Set(['required', 'not_required', 'blocked']);
const MIGRATION_RESOURCE = 'scripts/migrate-session-state.mjs';

class DoctorProblem extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const problem = (code) => ({ code });
const sanitizeProblems = (codes) => codes.map((code) => problem(code));
const isMissing = (error) => error?.code === 'ENOENT' || error?.code === 'ENOTDIR';

function readPrivateJson(file, root, invalidCode) {
  let record;
  try {
    record = readRegularFileOnce(file, root);
  } catch (error) {
    if (isMissing(error)) return null;
    throw new DoctorProblem(invalidCode);
  }
  if (record.mode !== 0o600 || record.physical.nlink !== 1) {
    throw new DoctorProblem(invalidCode);
  }
  try {
    return { ...record, value: JSON.parse(record.bytes.toString('utf8')), file, root };
  } catch {
    throw new DoctorProblem(invalidCode);
  }
}

function assertUnchanged(record, invalidCode) {
  const current = readPrivateJson(record.file, record.root, invalidCode);
  if (current === null
    || current.generation !== record.generation
    || !current.bytes.equals(record.bytes)) {
    throw new DoctorProblem(invalidCode);
  }
}

const section = (status, capability, problems = []) => {
  if (!SECTION_STATUSES.has(status)) throw new Error('Unsupported doctor section status.');
  return {
    status,
    capabilities: { [capability]: { status } },
    problems: sanitizeProblems(problems),
  };
};

const allHostCapabilities = (status) => Object.fromEntries(
  SUPPORTED_ADAPTER_CAPABILITIES.map((capability) => [capability, { status }]),
);

function hostSection(status, capabilities = allHostCapabilities(status), problems = []) {
  if (!SECTION_STATUSES.has(status)) throw new Error('Unsupported doctor section status.');
  return {
    status,
    capabilities: Object.fromEntries(Object.entries(capabilities)
      .map(([capability, value]) => [capability, { status: value.status }])),
    problems: sanitizeProblems(problems),
  };
}

const unavailableSections = (status, code = null) => ({
  native: section(status, NATIVE_CAPABILITY, code ? [code] : []),
  host: hostSection(status, allHostCapabilities(status), code ? [code] : []),
  isolated: section(status, ISOLATED_CAPABILITY, code ? [code] : []),
});

function migrationDescriptor(status, reason) {
  if (!MIGRATION_STATUSES.has(status) || !/^[a-z][a-z0-9_]*$/.test(reason)) {
    throw new Error('Unsupported doctor migration descriptor.');
  }
  return {
    status,
    reason,
    resource: MIGRATION_RESOURCE,
    command: status === 'required' ? ['inventory', '--workspace', '<workspace>'] : null,
  };
}

const MIGRATION_STATE_NODES = Object.freeze([
  '.session-state-migration.lock',
  '.session-state-migration.recovery.lock',
]);

function assertNoMigrationStateNodes(workspace) {
  const locks = join(dataRoot(workspace), 'locks');
  for (const name of MIGRATION_STATE_NODES) {
    try {
      lstatSync(join(locks, name));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
    }
    throw new DoctorProblem('migration_in_progress_or_recovery_required');
  }
}

function canonicalRepositoryWorkspace(workspaceInput) {
  const requested = workspacePath(workspaceInput);
  const root = repoIdentity(requested).root;
  if (typeof root !== 'string' || !root) throw new DoctorProblem('active_session_invalid');
  return workspacePath(root);
}

function readReadinessInput(inputs, file, root, invalidCode) {
  const record = readPrivateJson(file, root, invalidCode);
  inputs.push({ record, file, root, invalidCode });
  return record;
}

function assertReadinessInputsUnchanged(inputs) {
  for (const input of inputs) {
    if (input.record !== null) {
      assertUnchanged(input.record, input.invalidCode);
    } else if (readPrivateJson(input.file, input.root, input.invalidCode) !== null) {
      throw new DoctorProblem(input.invalidCode);
    }
  }
}

function classifyVerificationProblem(error, prefix) {
  if (error instanceof DoctorProblem) return error.code;
  if (typeof error?.code === 'string' && /^[a-z][a-z0-9_]*$/.test(error.code)) return error.code;
  const message = String(error?.message || '');
  if (/not current|not active|expired|lifetime/i.test(message)) return `${prefix}_evidence_expired`;
  if (/signature/i.test(message)) return `${prefix}_signature_invalid`;
  if (/trust.*unavailable|no pinned host trust/i.test(message)) return `${prefix}_trust_unavailable`;
  if (/trust|public key|key or source/i.test(message)) return `${prefix}_trust_invalid`;
  if (/stale|repository or task|binding/i.test(message)) return `${prefix}_binding_stale`;
  return `${prefix}_contract_invalid`;
}

function activeSession(workspace, requestedTask) {
  const root = dataRoot(workspace);
  const pointer = readPrivateJson(currentSessionFile(workspace), root, 'active_session_invalid');
  if (pointer === null) {
    return {
      status: 'not_applicable',
      migration: { status: 'not_required', reason: 'no_current_session' },
    };
  }

  const initialClassification = classifyLegacyPointer(pointer.value);
  if (initialClassification.kind === 'legacy_telemetry') {
    const migration = legacyMigrationRequirement(initialClassification);
    assertUnchanged(pointer, 'active_session_invalid');
    return { status: 'migration_required', migration, records: [pointer] };
  }
  if (!['legacy_state_v1', 'state_v2'].includes(initialClassification.kind)) {
    throw new DoctorProblem('active_session_invalid');
  }
  if (typeof pointer.value?.task_id !== 'string' || !pointer.value.task_id.trim()) {
    throw new DoctorProblem('active_session_invalid');
  }
  const paths = sessionPaths(workspace, pointer.value.task_id);
  if (requestedTask !== null && requestedTask !== paths.task) {
    throw new DoctorProblem('active_session_invalid');
  }

  if (initialClassification.kind === 'legacy_state_v1') {
    const pointerClassification = classifyLegacyPointer(pointer.value, {
      repo_id: paths.repo.id,
      task_id: paths.task,
      session_dir: paths.sessionDir,
      completed_dir: paths.completedDir,
    });
    if (!pointerClassification.valid) throw new DoctorProblem('active_session_invalid');
    const canonicalDirectory = pointer.value.status === 'completed'
      ? paths.completedDir
      : paths.sessionDir;
    const sessionFile = join(canonicalDirectory, 'session.json');
    const session = readPrivateJson(sessionFile, root, 'active_session_invalid');
    if (session === null) throw new DoctorProblem('active_session_invalid');
    const sessionClassification = classifyLegacySession(session.value, {
      repo_id: paths.repo.id,
      task_id: paths.task,
      workspace: paths.repo.root,
      source_path: sessionFile,
      session_file: sessionFile,
    });
    const migration = legacyMigrationRequirement(pointerClassification, sessionClassification);
    if (migration.status !== 'required') throw new DoctorProblem('active_session_invalid');
    assertUnchanged(pointer, 'active_session_invalid');
    assertUnchanged(session, 'active_session_invalid');
    return { status: 'migration_required', migration, records: [pointer, session] };
  }

  if (pointerErrors(pointer.value, paths).length) throw new DoctorProblem('active_session_invalid');
  if (pointer.value.status === 'completed') {
    assertUnchanged(pointer, 'active_session_invalid');
    return {
      status: 'not_applicable',
      migration: { status: 'not_required', reason: 'state_envelope_v2' },
    };
  }

  const session = readPrivateJson(join(paths.sessionDir, 'session.json'), root, 'active_session_invalid');
  if (session === null || sessionErrors(session.value, paths, pointer.value).length) {
    throw new DoctorProblem('active_session_invalid');
  }
  assertUnchanged(pointer, 'active_session_invalid');
  assertUnchanged(session, 'active_session_invalid');
  if (session.value.status !== 'active') {
    return {
      status: 'not_applicable',
      migration: { status: 'not_required', reason: 'state_envelope_v2' },
    };
  }
  return {
    status: 'ready',
    paths,
    session: session.value,
    records: [pointer, session],
    migration: { status: 'not_required', reason: 'state_envelope_v2' },
  };
}

function nativeReadiness({ workspace, context, fingerprint, nowMs, readinessInputs }) {
  try {
    const probe = readReadinessInput(
      readinessInputs,
      join(context.paths.sessionDir, 'capability-probe.json'),
      context.paths.sessionDir,
      'native_runtime_state_invalid',
    );
    if (probe === null) return section('not_registered', NATIVE_CAPABILITY);
    const trust = readReadinessInput(
      readinessInputs,
      authorityTrustFile(workspace),
      context.paths.root,
      'native_runtime_state_invalid',
    );
    if (trust === null) {
      return section('blocked', NATIVE_CAPABILITY, ['native_trust_unavailable']);
    }
    verifyCapabilityProbe({
      workspace,
      probe: probe.value,
      pinnedTrust: context.session.authority_trust,
      repoId: context.paths.repo.id,
      taskId: context.paths.task,
      worktreeFingerprint: fingerprint,
      nowMs,
    });
    assertUnchanged(trust, 'native_runtime_state_invalid');
    assertUnchanged(probe, 'native_runtime_state_invalid');
    return section('ready', NATIVE_CAPABILITY);
  } catch (error) {
    return section('blocked', NATIVE_CAPABILITY, [classifyVerificationProblem(error, 'native')]);
  }
}

function hostReadiness({ workspace, context, nowMs, readinessInputs }) {
  try {
    const registration = readReadinessInput(
      readinessInputs,
      join(context.paths.sessionDir, HOST_REGISTRATION_FILE),
      context.paths.sessionDir,
      'host_runtime_state_invalid',
    );
    if (registration === null) return hostSection('not_registered');
    const trust = readReadinessInput(
      readinessInputs,
      join(dataRoot(workspace), 'config', HOST_TRUST_FILE),
      context.paths.root,
      'host_runtime_state_invalid',
    );
    const readiness = hostAdapterReadiness({
      registration: registration.value,
      registryTrust: trust?.value,
      expected: { repo_id: context.paths.repo.id, task_id: context.paths.task },
      atMs: nowMs,
    });
    assertUnchanged(registration, 'host_runtime_state_invalid');
    if (trust !== null) assertUnchanged(trust, 'host_runtime_state_invalid');
    if (readiness.status === 'ready') return hostSection('ready', readiness.capabilities);
    return hostSection(
      readiness.status,
      allHostCapabilities(readiness.status),
      readiness.problems.map(({ code }) => code),
    );
  } catch (error) {
    return hostSection('blocked', allHostCapabilities('blocked'), [
      classifyVerificationProblem(error, 'host'),
    ]);
  }
}

function isolatedReadiness({ workspace, context, fingerprint, nowMs, readinessInputs }) {
  try {
    const probe = readReadinessInput(
      readinessInputs,
      executorProbeFile(context.paths.sessionDir),
      context.paths.sessionDir,
      'isolated_runtime_state_invalid',
    );
    if (probe === null) return section('not_registered', ISOLATED_CAPABILITY);
    const trust = readReadinessInput(
      readinessInputs,
      executorTrustFile(workspace),
      context.paths.root,
      'isolated_runtime_state_invalid',
    );
    if (trust === null) {
      return section('blocked', ISOLATED_CAPABILITY, ['isolated_trust_unavailable']);
    }
    verifyExecutorProbe({
      workspace,
      probe: probe.value,
      repoId: context.paths.repo.id,
      taskId: context.paths.task,
      worktreeFingerprint: fingerprint,
      atTime: new Date(nowMs),
    });
    assertUnchanged(trust, 'isolated_runtime_state_invalid');
    assertUnchanged(probe, 'isolated_runtime_state_invalid');
    return section('ready', ISOLATED_CAPABILITY);
  } catch (error) {
    return section('blocked', ISOLATED_CAPABILITY, [
      classifyVerificationProblem(error, 'isolated'),
    ]);
  }
}

function overallStatus(sections) {
  const statuses = Object.values(sections).map(({ status }) => status);
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.includes('ready')) return 'ready';
  if (statuses.includes('not_registered')) return 'not_registered';
  return 'not_applicable';
}

function workspaceFingerprint(workspace) {
  try {
    return workspaceSnapshot(workspace).digest;
  } catch {
    throw new DoctorProblem('workspace_snapshot_invalid');
  }
}

export function buildPhantomDoctorReport({
  workspace: workspaceInput = process.cwd(),
  task = null,
  nowMs = Date.now(),
} = {}) {
  let sections;
  let migration = migrationDescriptor('not_required', 'no_current_session');
  const readinessInputs = [];
  try {
    if (!Number.isFinite(nowMs)) throw new DoctorProblem('observation_time_invalid');
    const workspace = canonicalRepositoryWorkspace(workspaceInput);
    assertNoMigrationStateNodes(workspace);
    const context = activeSession(workspace, task);
    migration = migrationDescriptor(context.migration.status, context.migration.reason);
    if (context.status === 'migration_required') {
      sections = unavailableSections('blocked', 'migration_required');
      context.records.forEach((record) => assertUnchanged(record, 'active_session_invalid'));
    } else if (context.status === 'not_applicable') {
      sections = unavailableSections('not_applicable');
    } else {
      const fingerprint = workspaceFingerprint(workspace);
      const inputs = { workspace, context, fingerprint, nowMs, readinessInputs };
      sections = {
        native: nativeReadiness(inputs),
        host: hostReadiness(inputs),
        isolated: isolatedReadiness(inputs),
      };
      context.records.forEach((record) => assertUnchanged(record, 'active_session_invalid'));
      if (workspaceFingerprint(workspace) !== fingerprint) {
        throw new DoctorProblem('workspace_snapshot_changed');
      }
    }
    assertNoMigrationStateNodes(workspace);
    assertReadinessInputsUnchanged(readinessInputs);
  } catch (error) {
    const code = error instanceof DoctorProblem ? error.code : 'doctor_verification_failed';
    sections = unavailableSections('blocked', code);
    if (['active_session_invalid', 'migration_in_progress_or_recovery_required'].includes(code)) {
      migration = migrationDescriptor('blocked', code);
    }
  }
  return {
    schema_version: 3,
    status: overallStatus(sections),
    verifier_bundled: true,
    backend_bundled: false,
    migration,
    ...sections,
  };
}

const ALLOWED_OPTIONS = new Set(['_', 'workspace', 'task', 'at']);

export function runPhantomDoctor(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const unknown = Object.keys(args).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (args._.length || unknown.length) throw new DoctorProblem('invalid_input');
  const nowMs = args.at === undefined ? Date.now() : Date.parse(args.at);
  if (!Number.isFinite(nowMs)
    || (args.at !== undefined && new Date(nowMs).toISOString() !== args.at)) {
    throw new DoctorProblem('invalid_input');
  }
  const report = buildPhantomDoctorReport({
    workspace: args.workspace || process.cwd(),
    task: args.task === undefined ? null : args.task,
    nowMs,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === 'blocked') process.exitCode = 1;
  return report;
}

if (isMainModule(import.meta.url)) {
  try {
    runPhantomDoctor();
  } catch {
    process.stderr.write(`${JSON.stringify({
      schema_version: 3,
      status: 'blocked',
      code: 'invalid_input',
      migration: migrationDescriptor('blocked', 'invalid_input'),
    })}\n`);
    process.exitCode = 2;
  }
}
