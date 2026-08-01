// Author: Subash Karki

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  capabilityProbeSigningPayload,
} from '../skills/phantom/scripts/lib/authority-decision.mjs';
import { workspaceSnapshot } from '../skills/phantom/scripts/lib/filesystem-snapshot.mjs';
import {
  hostAdapterRegistrationSigningPayload,
  validateHostAdapterRegistration,
} from '../skills/phantom/scripts/lib/host-adapter-contracts.mjs';
import {
  executorProbeSigningPayload,
} from '../skills/phantom/scripts/lib/isolated-executor-attestation.mjs';
import { sessionPaths } from '../skills/phantom/scripts/lib/portable.mjs';
import { buildPhantomDoctorReport } from '../skills/phantom/scripts/phantom-doctor.mjs';

const STATE = fileURLToPath(new URL('../skills/phantom/scripts/phantom-state.mjs', import.meta.url));
const DOCTOR = fileURLToPath(new URL('../skills/phantom/scripts/phantom-doctor.mjs', import.meta.url));
const PRIVATE_MODE = 0o600;
const PUBLIC_KEY_MARKER = 'BEGIN PUBLIC KEY';

const publicPem = (key) => key.export({ type: 'spki', format: 'pem' }).toString();
const iso = (atMs) => new Date(atMs).toISOString();
const digest = (fill) => `sha256:${fill.repeat(64)}`;

function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: PRIVATE_MODE });
  fs.chmodSync(file, PRIVATE_MODE);
}

function startSession(context) {
  const result = spawnSync(process.execPath, [
    STATE,
    'start',
    '--workspace', context.workspace,
    '--task', 'DOCTOR-1',
    '--intent', 'Inspect runtime readiness',
    '--route', 'direct',
  ], {
    encoding: 'utf8',
    env: { ...process.env, PHANTOM_DATA: context.data },
  });
  assert.equal(result.status, 0, result.stderr);
  const session = JSON.parse(result.stdout);
  const sessionDir = path.join(context.data, 'repos', session.repo_id, 'sessions', session.task_id);
  return { ...session, sessionDir };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-doctor-v2-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'source.txt'), 'stable workspace\n');

  const authorityKeys = generateKeyPairSync('ed25519');
  writePrivateJson(path.join(data, 'config', 'authority-trust.json'), {
    schema_version: 1,
    key_id: 'native-key-secret-marker',
    source: 'native-source-secret-marker',
    public_key: publicPem(authorityKeys.publicKey),
  });
  return { root, workspace, data, authorityKeys };
}

function nestedGitFixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-doctor-nested-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'repository');
  const nested = path.join(workspace, 'packages', 'nested');
  const data = path.join(root, 'data');
  fs.mkdirSync(nested, { recursive: true });
  const initialized = spawnSync('git', ['init', '--quiet', workspace], { encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  fs.writeFileSync(path.join(workspace, 'source.txt'), 'nested workspace\n');
  return { root, workspace, nested, data };
}

function useFixtureEnvironment(t, context) {
  const priorData = process.env.PHANTOM_DATA;
  const priorRepo = process.env.PHANTOM_REPO;
  process.env.PHANTOM_DATA = context.data;
  process.env.PHANTOM_REPO = 'phantom-doctor-fixture';
  t.after(() => {
    if (priorData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = priorData;
    if (priorRepo === undefined) delete process.env.PHANTOM_REPO;
    else process.env.PHANTOM_REPO = priorRepo;
  });
}

function useRelativeDataEnvironment(t) {
  const priorData = process.env.PHANTOM_DATA;
  const priorRepo = process.env.PHANTOM_REPO;
  process.env.PHANTOM_DATA = '../data';
  delete process.env.PHANTOM_REPO;
  t.after(() => {
    if (priorData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = priorData;
    if (priorRepo === undefined) delete process.env.PHANTOM_REPO;
    else process.env.PHANTOM_REPO = priorRepo;
  });
}

function installLegacyState(context, {
  task = 'DOCTOR-LEGACY',
  status = 'active',
  workKind = 'implementation',
  mode = 'standard',
  intent = 'Legacy secret intent marker',
  pointerOverrides = {},
  sessionOverrides = {},
} = {}) {
  const paths = sessionPaths(fs.realpathSync(context.workspace), task);
  const createdAt = '2026-07-31T12:00:00.000Z';
  const updatedAt = '2026-07-31T12:05:00.000Z';
  const session = {
    schema_version: 1,
    artifact_type: 'session',
    repo_id: paths.repo.id,
    task_id: paths.task,
    status,
    created_at: createdAt,
    updated_at: updatedAt,
    producer: { role: 'apex', compute_profile: 'frontier' },
    bundle_version: '2.11.0',
    workspace: paths.repo.root,
    route: 'plan',
    intent_summary: intent,
    lifecycle: { mode },
    ...(workKind === null ? {} : { work_kind: workKind }),
    ...(status === 'paused' ? { pause_reason: 'Awaiting migration.' } : {}),
    ...(status === 'completed' ? { completed_at: updatedAt } : {}),
    ...sessionOverrides,
  };
  const sessionDir = status === 'completed' ? paths.completedDir : paths.sessionDir;
  const sessionFile = path.join(sessionDir, 'session.json');
  writePrivateJson(sessionFile, session);
  const pointer = {
    schema_version: 1,
    repo_id: paths.repo.id,
    task_id: paths.task,
    session_dir: sessionDir,
    updated_at: updatedAt,
    ...(status === 'completed' ? { status: 'completed' } : {}),
    ...pointerOverrides,
  };
  writePrivateJson(paths.currentFile, pointer);
  return { paths, pointer, pointerFile: paths.currentFile, session, sessionFile };
}

function runDoctorWithReplacementRace(context, {
  triggerFile,
  triggerCount = 1,
  targetFile,
  replacementFile,
  nowMs = Date.now(),
}) {
  const preload = path.join(context.root, 'doctor-race-preload.mjs');
  const runner = path.join(context.root, 'doctor-race-runner.mjs');
  fs.writeFileSync(preload, [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const originalOpenSync = fs.openSync;',
    'globalThis.__raceTriggerReads = 0;',
    'globalThis.__raceApplied = false;',
    'fs.openSync = function racedOpenSync(file, ...args) {',
    '  if (typeof file === \'string\' && file === process.env.RACE_TRIGGER_FILE) {',
    '    globalThis.__raceTriggerReads += 1;',
    '    if (globalThis.__raceTriggerReads === Number(process.env.RACE_TRIGGER_COUNT)) {',
    '      fs.renameSync(process.env.RACE_REPLACEMENT_FILE, process.env.RACE_TARGET_FILE);',
    '      globalThis.__raceApplied = true;',
    '    }',
    '  }',
    '  return originalOpenSync.call(this, file, ...args);',
    '};',
    'syncBuiltinESMExports();',
  ].join('\n'));
  fs.writeFileSync(runner, [
    'const { buildPhantomDoctorReport } = await import(process.env.DOCTOR_MODULE);',
    'const report = buildPhantomDoctorReport({',
    '  workspace: process.env.DOCTOR_WORKSPACE,',
    '  nowMs: Number(process.env.DOCTOR_NOW_MS),',
    '});',
    'process.stdout.write(JSON.stringify({',
    '  triggerReads: globalThis.__raceTriggerReads,',
    '  raceApplied: globalThis.__raceApplied,',
    '  report,',
    '}));',
  ].join('\n'));
  const raced = spawnSync(process.execPath, [
    '--import', pathToFileURL(preload).href, runner,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOCTOR_MODULE: pathToFileURL(DOCTOR).href,
      DOCTOR_WORKSPACE: context.workspace,
      DOCTOR_NOW_MS: String(nowMs),
      RACE_TRIGGER_FILE: fs.realpathSync(triggerFile),
      RACE_TRIGGER_COUNT: String(triggerCount),
      RACE_TARGET_FILE: fs.existsSync(targetFile)
        ? fs.realpathSync(targetFile)
        : path.join(fs.realpathSync(path.dirname(targetFile)), path.basename(targetFile)),
      RACE_REPLACEMENT_FILE: replacementFile,
    },
  });
  assert.equal(raced.status, 0, raced.stderr);
  return JSON.parse(raced.stdout);
}

function runDoctorWithMigrationLookupFailure(context, targetFile) {
  const preload = path.join(context.root, 'doctor-lstat-error-preload.mjs');
  const runner = path.join(context.root, 'doctor-lstat-error-runner.mjs');
  fs.writeFileSync(preload, [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const originalLstatSync = fs.lstatSync;',
    'fs.lstatSync = function failedMigrationLookup(file, ...args) {',
    '  if (typeof file === \'string\' && file === process.env.LSTAT_ERROR_FILE) {',
    "    const error = new Error('lookup denied');",
    "    error.code = 'EACCES';",
    '    throw error;',
    '  }',
    '  return originalLstatSync.call(this, file, ...args);',
    '};',
    'syncBuiltinESMExports();',
  ].join('\n'));
  fs.writeFileSync(runner, [
    'const { buildPhantomDoctorReport } = await import(process.env.DOCTOR_MODULE);',
    'const report = buildPhantomDoctorReport({ workspace: process.env.DOCTOR_WORKSPACE });',
    'process.stdout.write(JSON.stringify(report));',
  ].join('\n'));
  const failed = spawnSync(process.execPath, [
    '--import', pathToFileURL(preload).href, runner,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOCTOR_MODULE: pathToFileURL(DOCTOR).href,
      DOCTOR_WORKSPACE: context.workspace,
      LSTAT_ERROR_FILE: path.resolve(targetFile),
    },
  });
  assert.equal(failed.status, 0, failed.stderr);
  return JSON.parse(failed.stdout);
}

function nativeProbe(context, session, nowMs, { expired = false } = {}) {
  const probe = {
    schema_version: 1,
    probe_kind: 'native-tool-interception',
    repo_id: session.repo_id,
    task_id: session.task_id,
    worktree_fingerprint: workspaceSnapshot(context.workspace).digest,
    adapter_binding: 'native-tool-gate-v1',
    capabilities: { 'lifecycle.hooks': 'available' },
    hooks: { pre_tool_use: 'enforced', post_tool_use: 'enforced' },
    host: 'native-host-secret-marker',
    issued_at: iso(nowMs - (expired ? 11 * 60_000 : 60_000)),
    expires_at: iso(expired ? nowMs - 10 * 60_000 : nowMs + 5 * 60_000),
    source: 'native-source-secret-marker',
    source_event_id: 'native-event-secret-marker',
    replay_id: 'native-replay-secret-marker',
    key_id: 'native-key-secret-marker',
    signature: '',
  };
  probe.signature = sign(
    null,
    capabilityProbeSigningPayload(probe),
    context.authorityKeys.privateKey,
  ).toString('base64');
  return probe;
}

function hostRecords(session, nowMs, { expired = false } = {}) {
  const registryKeys = generateKeyPairSync('ed25519');
  const adapterKeys = generateKeyPairSync('ed25519');
  const trust = {
    schema_version: 1,
    trust_kind: 'host-adapter-registry',
    trust_id: 'host-trust-secret-marker',
    key_id: 'host-registry-key-secret-marker',
    source: 'host-registry-source-secret-marker',
    algorithm: 'ed25519',
    public_key: publicPem(registryKeys.publicKey),
    valid_from: iso(nowMs - 60 * 60_000),
    valid_until: iso(nowMs + 60 * 60_000),
  };
  const registration = {
    schema_version: 1,
    registration_kind: 'host-adapter',
    registration_id: 'host-registration-secret-marker',
    adapter: {
      adapter_id: 'host-adapter-secret-marker',
      adapter_version: '1.0.0',
      host_instance_id: 'host-instance-secret-marker',
      attestation_key_id: 'adapter-key-secret-marker',
      attestation_public_key: publicPem(adapterKeys.publicKey),
    },
    scope: { repo_id: session.repo_id, task_id: session.task_id },
    capabilities: [{
      type: 'process.exec',
      contract: 'sandbox-exec-v1',
      policy: {
        shell: 'disabled',
        stdin: 'closed',
        network: 'denied',
        filesystem: 'request-scoped',
        repository_control: 'inaccessible',
        phantom_control: 'inaccessible',
        environment: 'allowlist-only',
        credentials: 'absent',
        allowed_environment_names: ['LANG'],
        process_tree: 'terminate-on-timeout',
        max_duration_ms: 60_000,
        max_output_bytes: 1_000_000,
        max_processes: 8,
      },
    }],
    issued_at: iso(nowMs - (expired ? 11 * 60_000 : 60_000)),
    expires_at: iso(expired ? nowMs - 10 * 60_000 : nowMs + 5 * 60_000),
    source: trust.source,
    source_event_id: 'host-event-secret-marker',
    replay_id: 'host-replay-secret-marker',
    registry_key_id: trust.key_id,
    signature: '',
  };
  registration.signature = sign(
    null,
    hostAdapterRegistrationSigningPayload(registration),
    registryKeys.privateKey,
  ).toString('base64');
  assert.deepEqual(validateHostAdapterRegistration(registration), []);
  return { trust, registration };
}

function isolatedRecords(context, session, nowMs, { expired = false } = {}) {
  const keys = generateKeyPairSync('ed25519');
  const trust = {
    schema_version: 1,
    trust_kind: 'isolated-executor-trust',
    generation: 1,
    key_id: 'isolated-key-secret-marker',
    source: 'isolated-source-secret-marker',
    public_key: publicPem(keys.publicKey),
    activated_at: iso(nowMs - 60 * 60_000),
    expires_at: iso(nowMs + 60 * 60_000),
    replaces_key_id: null,
  };
  const probe = {
    schema_version: 1,
    probe_kind: 'isolated-branch-executor',
    executor_id: 'isolated-executor-secret-marker',
    contract_version: 'isolated-branch-executor-v1',
    repo_id: session.repo_id,
    task_id: session.task_id,
    worktree_fingerprint: workspaceSnapshot(context.workspace).digest,
    isolation_profile: {
      profile_id: 'continuous-isolation-v1',
      platform: process.platform === 'darwin' ? 'darwin' : 'linux',
      backend: 'external-backend-secret-marker',
      backend_digest: digest('b'),
      filesystem: 'private-root-no-host-writes',
      process: 'contained-and-reaped',
      tool_plane: 'lease-scoped',
      artifact_egress: 'digest-bound',
      network: 'denied',
    },
    self_test: {
      status: 'passed',
      observed_at: iso(nowMs - (expired ? 12 * 60_000 : 90_000)),
      evidence_digest: digest('e'),
    },
    issued_at: iso(nowMs - (expired ? 11 * 60_000 : 60_000)),
    expires_at: iso(expired ? nowMs - 10 * 60_000 : nowMs + 5 * 60_000),
    source: trust.source,
    source_event_id: 'isolated-event-secret-marker',
    replay_id: 'isolated-replay-secret-marker',
    key_id: trust.key_id,
    signature: '',
  };
  probe.signature = sign(null, executorProbeSigningPayload(probe), keys.privateKey).toString('base64');
  return { trust, probe };
}

function installRecords(context, session, nowMs, options = {}) {
  const native = nativeProbe(context, session, nowMs, options);
  const host = hostRecords(session, nowMs, options);
  const isolated = isolatedRecords(context, session, nowMs, options);
  writePrivateJson(path.join(session.sessionDir, 'capability-probe.json'), native);
  writePrivateJson(path.join(context.data, 'config', 'host-adapter-registry-trust.json'), host.trust);
  writePrivateJson(path.join(session.sessionDir, 'host-adapter-registration.json'), host.registration);
  writePrivateJson(path.join(context.data, 'config', 'executor-trust.json'), isolated.trust);
  writePrivateJson(path.join(session.sessionDir, 'isolated-executor-probe.json'), isolated.probe);
}

test('phantom doctor v3 reports absent, invalid, expired, and valid runtime state without disclosure', (t) => {
  const context = fixture(t);
  useFixtureEnvironment(t, context);
  const nowMs = Date.now();

  const inactive = buildPhantomDoctorReport({ workspace: context.workspace, nowMs });
  assert.equal(inactive.schema_version, 3);
  assert.equal(inactive.status, 'not_applicable');
  assert.deepEqual(inactive.migration, {
    status: 'not_required',
    reason: 'no_current_session',
    resource: 'scripts/migrate-session-state.mjs',
    command: null,
  });
  assert.deepEqual(
    [inactive.native.status, inactive.host.status, inactive.isolated.status],
    ['not_applicable', 'not_applicable', 'not_applicable'],
  );

  const session = startSession(context);
  const absent = buildPhantomDoctorReport({ workspace: context.workspace, nowMs });
  assert.equal(absent.status, 'not_registered');
  assert.deepEqual(
    [absent.native.status, absent.host.status, absent.isolated.status],
    ['not_registered', 'not_registered', 'not_registered'],
  );
  assert.equal(absent.verifier_bundled, true);
  assert.equal(absent.backend_bundled, false);
  assert.equal(absent.migration.status, 'not_required');
  assert.equal(absent.migration.reason, 'state_envelope_v2');

  const invalidHost = hostRecords(session, nowMs);
  writePrivateJson(
    path.join(context.data, 'config', 'host-adapter-registry-trust.json'),
    invalidHost.trust,
  );
  writePrivateJson(path.join(session.sessionDir, 'host-adapter-registration.json'), {
    schema_version: 1,
    TOP_SECRET_MARKER: 'do-not-leak',
  });
  const invalid = buildPhantomDoctorReport({ workspace: context.workspace, nowMs });
  assert.equal(invalid.host.status, 'blocked');
  assert.deepEqual(invalid.host.problems, [{ code: 'contract_invalid' }]);
  assert.doesNotMatch(JSON.stringify(invalid), /TOP_SECRET_MARKER|do-not-leak/);

  const registrationFile = path.join(session.sessionDir, 'host-adapter-registration.json');
  fs.chmodSync(registrationFile, 0o644);
  const insecure = buildPhantomDoctorReport({ workspace: context.workspace, nowMs });
  assert.deepEqual(insecure.host.problems, [{ code: 'host_runtime_state_invalid' }]);

  fs.chmodSync(registrationFile, PRIVATE_MODE);
  const hardlink = path.join(session.sessionDir, 'host-adapter-registration-alias.json');
  fs.linkSync(registrationFile, hardlink);
  const linked = buildPhantomDoctorReport({ workspace: context.workspace, nowMs });
  assert.deepEqual(linked.host.problems, [{ code: 'host_runtime_state_invalid' }]);
  fs.unlinkSync(hardlink);

  installRecords(context, session, nowMs, { expired: true });
  const expired = buildPhantomDoctorReport({ workspace: context.workspace, nowMs });
  assert.deepEqual(
    [expired.native.status, expired.host.status, expired.isolated.status],
    ['blocked', 'blocked', 'blocked'],
  );
  assert.deepEqual(expired.native.problems, [{ code: 'native_evidence_expired' }]);
  assert.deepEqual(expired.host.problems, [{ code: 'expired' }]);
  assert.deepEqual(expired.isolated.problems, [{ code: 'isolated_evidence_expired' }]);

  installRecords(context, session, nowMs);
  const ready = buildPhantomDoctorReport({ workspace: context.workspace, nowMs });
  assert.equal(ready.status, 'ready');
  assert.deepEqual(
    [ready.native.status, ready.host.status, ready.isolated.status],
    ['ready', 'ready', 'ready'],
  );
  assert.equal(ready.native.capabilities['workspace.write'].status, 'ready');
  assert.equal(ready.host.capabilities['process.exec'].status, 'ready');
  assert.equal(ready.host.capabilities['git.push'].status, 'not_registered');
  assert.equal(ready.isolated.capabilities['parallel.branch'].status, 'ready');

  const serialized = JSON.stringify(ready);
  assert.doesNotMatch(serialized, new RegExp([
    PUBLIC_KEY_MARKER,
    'secret-marker',
    context.root.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'external-backend',
    'signature',
    'artifact',
  ].join('|'), 'i'));
  assert.deepEqual(Object.keys(ready).sort(), [
    'backend_bundled', 'host', 'isolated', 'migration', 'native', 'schema_version', 'status',
    'verifier_bundled',
  ]);
});

test('phantom doctor requires offline migration for genuine v1 sessions in every lifecycle status', (t) => {
  const context = fixture(t);
  useFixtureEnvironment(t, context);

  for (const status of ['active', 'paused', 'completed']) {
    installLegacyState(context, { task: `DOCTOR-${status.toUpperCase()}`, status });
    const report = buildPhantomDoctorReport({ workspace: context.workspace });
    assert.equal(report.schema_version, 3);
    assert.equal(report.status, 'blocked');
    assert.deepEqual(report.migration, {
      status: 'required',
      reason: 'state_envelope_v1',
      resource: 'scripts/migrate-session-state.mjs',
      command: ['inventory', '--workspace', '<workspace>'],
    });
    for (const section of [report.native, report.host, report.isolated]) {
      assert.equal(section.status, 'blocked');
      assert.deepEqual(section.problems, [{ code: 'migration_required' }]);
    }
  }

  installLegacyState(context, { task: 'DOCTOR-UNCLASSIFIED', workKind: null });
  const unclassified = buildPhantomDoctorReport({ workspace: context.workspace });
  assert.equal(unclassified.migration.status, 'required');
  assert.equal(unclassified.migration.reason, 'legacy_session_work_kind_missing');
});

test('phantom doctor recognizes misplaced telemetry and discloses only a portable command', (t) => {
  const context = fixture(t);
  useFixtureEnvironment(t, context);
  const paths = sessionPaths(context.workspace, 'DOCTOR-TELEMETRY');
  writePrivateJson(paths.currentFile, {
    session_id: 'legacy-session-01',
    cwd: context.workspace,
    ts: 1_785_499_200_000,
  });

  const report = buildPhantomDoctorReport({ workspace: context.workspace });
  assert.equal(report.status, 'blocked');
  assert.deepEqual(report.migration, {
    status: 'required',
    reason: 'legacy_telemetry_pointer',
    resource: 'scripts/migrate-session-state.mjs',
    command: ['inventory', '--workspace', '<workspace>'],
  });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /legacy-session-01|DOCTOR-TELEMETRY|phantom-doctor-fixture/);
  assert.doesNotMatch(serialized, new RegExp(context.root.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('phantom doctor blocks malformed, unknown, unsafe, and linked legacy state without migration', (t) => {
  const context = fixture(t);
  useFixtureEnvironment(t, context);
  const installed = installLegacyState(context);

  const assertInvalid = () => {
    const report = buildPhantomDoctorReport({ workspace: context.workspace });
    assert.equal(report.status, 'blocked');
    assert.deepEqual(report.migration, {
      status: 'blocked',
      reason: 'active_session_invalid',
      resource: 'scripts/migrate-session-state.mjs',
      command: null,
    });
    assert.deepEqual(report.native.problems, [{ code: 'active_session_invalid' }]);
    assert.doesNotMatch(JSON.stringify(report), /migratable|Legacy secret intent marker/);
  };

  writePrivateJson(installed.pointerFile, { ...installed.pointer, updated_at: 'not-a-timestamp' });
  assertInvalid();

  writePrivateJson(installed.pointerFile, { ...installed.pointer, schema_version: 99 });
  assertInvalid();

  writePrivateJson(installed.pointerFile, { ...installed.pointer, task_id: '..' });
  assertInvalid();

  writePrivateJson(installed.pointerFile, installed.pointer);
  writePrivateJson(installed.sessionFile, { ...installed.session, route: 'unknown' });
  assertInvalid();

  writePrivateJson(installed.sessionFile, installed.session);
  const alias = `${installed.pointerFile}.alias`;
  fs.linkSync(installed.pointerFile, alias);
  assertInvalid();
  fs.unlinkSync(alias);
});

test('phantom doctor resolves nested Git invocations to the canonical repository workspace', (t) => {
  const context = nestedGitFixture(t);
  useRelativeDataEnvironment(t);
  installLegacyState(context, { task: 'DOCTOR-NESTED-V1' });

  const legacy = buildPhantomDoctorReport({ workspace: context.nested });
  assert.equal(legacy.status, 'blocked');
  assert.equal(legacy.migration.status, 'required');
  assert.equal(legacy.migration.reason, 'state_envelope_v1');

  fs.rmSync(context.data, { recursive: true, force: true });
  startSession(context);
  const current = buildPhantomDoctorReport({ workspace: context.nested });
  assert.equal(current.status, 'not_registered');
  assert.equal(current.migration.status, 'not_required');
  assert.equal(current.migration.reason, 'state_envelope_v2');
  assert.doesNotMatch(JSON.stringify({ legacy, current }), new RegExp(
    context.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ));
});

test('phantom doctor maps an active-pointer generation race to blocked invalid state', {
  concurrency: false,
}, (t) => {
  const context = fixture(t);
  useFixtureEnvironment(t, context);
  startSession(context);
  const paths = sessionPaths(fs.realpathSync(context.workspace), 'DOCTOR-1');
  const pointer = JSON.parse(fs.readFileSync(paths.currentFile, 'utf8'));
  const replacement = `${paths.currentFile}.replacement`;
  writePrivateJson(replacement, pointer);
  const raced = runDoctorWithReplacementRace(context, {
    triggerFile: paths.currentFile,
    triggerCount: 2,
    targetFile: paths.currentFile,
    replacementFile: replacement,
  });
  const { triggerReads, raceApplied, report } = raced;

  assert.ok(triggerReads >= 2, 'the pointer was not revalidated');
  assert.equal(raceApplied, true);
  assert.equal(report.status, 'blocked');
  assert.deepEqual(report.migration, {
    status: 'blocked',
    reason: 'active_session_invalid',
    resource: 'scripts/migrate-session-state.mjs',
    command: null,
  });
  assert.deepEqual(report.native.problems, [{ code: 'active_session_invalid' }]);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(
    context.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ));
});

test('phantom doctor rejects readiness generations that never coexisted', {
  concurrency: false,
}, (t) => {
  const context = fixture(t);
  useFixtureEnvironment(t, context);
  const nowMs = Date.now();
  const session = startSession(context);
  installRecords(context, session, nowMs);
  const nativeProbe = path.join(session.sessionDir, 'capability-probe.json');
  const hostRegistration = path.join(session.sessionDir, 'host-adapter-registration.json');
  const replacement = `${nativeProbe}.replacement`;
  writePrivateJson(replacement, JSON.parse(fs.readFileSync(nativeProbe, 'utf8')));

  const { raceApplied, report } = runDoctorWithReplacementRace(context, {
    triggerFile: hostRegistration,
    targetFile: nativeProbe,
    replacementFile: replacement,
    nowMs,
  });

  assert.equal(raceApplied, true);
  assert.equal(report.status, 'blocked');
  assert.deepEqual(
    [report.native.status, report.host.status, report.isolated.status],
    ['blocked', 'blocked', 'blocked'],
  );
  for (const section of [report.native, report.host, report.isolated]) {
    assert.deepEqual(section.problems, [{ code: 'native_runtime_state_invalid' }]);
  }
  assert.equal(report.migration.status, 'not_required');
  assert.equal(report.migration.reason, 'state_envelope_v2');
  assert.doesNotMatch(JSON.stringify(report), new RegExp(
    context.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ));
});

test('phantom doctor blocks every migration state node before pointer inspection', (t) => {
  const context = fixture(t);
  useFixtureEnvironment(t, context);
  const paths = sessionPaths(fs.realpathSync(context.workspace), 'DOCTOR-LOCKED');
  writePrivateJson(paths.currentFile, {
    schema_version: 99,
    secret_pointer_marker: 'DOCTOR_LOCKED_POINTER_SECRET',
  });
  const locks = path.join(context.data, 'locks');
  fs.mkdirSync(locks, { recursive: true });

  const assertBlocked = () => {
    const report = buildPhantomDoctorReport({ workspace: context.workspace });
    assert.equal(report.status, 'blocked');
    assert.deepEqual(report.migration, {
      status: 'blocked',
      reason: 'migration_in_progress_or_recovery_required',
      resource: 'scripts/migrate-session-state.mjs',
      command: null,
    });
    for (const section of [report.native, report.host, report.isolated]) {
      assert.deepEqual(section.problems, [{
        code: 'migration_in_progress_or_recovery_required',
      }]);
    }
    assert.doesNotMatch(
      JSON.stringify(report),
      /DOCTOR_LOCKED_POINTER_SECRET|inventory|session-state-migration/,
    );
  };

  for (const name of [
    '.session-state-migration.lock',
    '.session-state-migration.recovery.lock',
  ]) {
    const node = path.join(locks, name);
    fs.writeFileSync(node, 'malformed lock bytes\n', { mode: PRIVATE_MODE });
    assertBlocked();
    fs.rmSync(node, { force: true });

    fs.mkdirSync(node);
    assertBlocked();
    fs.rmSync(node, { recursive: true, force: true });

    if (process.platform !== 'win32') {
      fs.symlinkSync(path.join(context.root, 'missing-lock-target'), node);
      assertBlocked();
      fs.unlinkSync(node);
    }
  }
});

test('phantom doctor sanitizes a recovery-claim lookup failure before state inspection', (t) => {
  const context = fixture(t);
  useFixtureEnvironment(t, context);
  const paths = sessionPaths(fs.realpathSync(context.workspace), 'DOCTOR-CLAIM-LOOKUP');
  writePrivateJson(paths.currentFile, {
    schema_version: 99,
    secret_pointer_marker: 'DOCTOR_CLAIM_LOOKUP_SECRET',
  });
  const claim = path.join(
    context.data,
    'locks',
    '.session-state-migration.recovery.lock',
  );
  fs.mkdirSync(path.dirname(claim), { recursive: true });

  const report = runDoctorWithMigrationLookupFailure(context, claim);

  assert.equal(report.status, 'blocked');
  assert.deepEqual(report.migration, {
    status: 'blocked',
    reason: 'migration_in_progress_or_recovery_required',
    resource: 'scripts/migrate-session-state.mjs',
    command: null,
  });
  for (const section of [report.native, report.host, report.isolated]) {
    assert.deepEqual(section.problems, [{
      code: 'migration_in_progress_or_recovery_required',
    }]);
  }
  assert.doesNotMatch(
    JSON.stringify(report),
    /DOCTOR_CLAIM_LOOKUP_SECRET|inventory|session-state-migration/,
  );
});

test('phantom doctor blocks a recovery claim created during state inspection', {
  concurrency: false,
}, (t) => {
  const context = fixture(t);
  useFixtureEnvironment(t, context);
  startSession(context);
  const paths = sessionPaths(fs.realpathSync(context.workspace), 'DOCTOR-1');
  const claim = path.join(
    context.data,
    'locks',
    '.session-state-migration.recovery.lock',
  );
  fs.mkdirSync(path.dirname(claim), { recursive: true });
  const replacement = path.join(context.root, 'staged-recovery-claim');
  fs.writeFileSync(replacement, 'opaque recovery claim\n', { mode: PRIVATE_MODE });

  const { raceApplied, report } = runDoctorWithReplacementRace(context, {
    triggerFile: paths.currentFile,
    targetFile: claim,
    replacementFile: replacement,
  });

  assert.equal(raceApplied, true);
  assert.equal(report.status, 'blocked');
  assert.deepEqual(report.migration, {
    status: 'blocked',
    reason: 'migration_in_progress_or_recovery_required',
    resource: 'scripts/migrate-session-state.mjs',
    command: null,
  });
  for (const section of [report.native, report.host, report.isolated]) {
    assert.deepEqual(section.problems, [{
      code: 'migration_in_progress_or_recovery_required',
    }]);
  }
  assert.doesNotMatch(JSON.stringify(report), /inventory|session-state-migration/);
});

test('portable phantom doctor exits one for legacy migration without leaking legacy state', (t) => {
  const context = fixture(t);
  useFixtureEnvironment(t, context);
  installLegacyState(context, {
    mode: 'to-plan',
    intent: 'DOCTOR_PRIVATE_INTENT_MARKER',
    sessionOverrides: {
      authority_decisions: [{ signature: 'DOCTOR_PRIVATE_SIGNATURE_MARKER' }],
    },
  });

  const result = spawnSync(process.execPath, [DOCTOR, '--workspace', context.workspace], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PHANTOM_DATA: context.data,
      PHANTOM_REPO: 'phantom-doctor-fixture',
    },
  });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema_version, 3);
  assert.equal(report.migration.status, 'required');
  assert.deepEqual(report.migration.command, ['inventory', '--workspace', '<workspace>']);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /DOCTOR_PRIVATE_INTENT_MARKER|DOCTOR_PRIVATE_SIGNATURE_MARKER|DOCTOR-LEGACY/,
  );
});
