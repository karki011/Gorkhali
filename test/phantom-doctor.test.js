// Author: Subash Karki

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
import { buildPhantomDoctorReport } from '../skills/phantom/scripts/phantom-doctor.mjs';

const STATE = fileURLToPath(new URL('../skills/phantom/scripts/phantom-state.mjs', import.meta.url));
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

test('phantom doctor v2 reports absent, invalid, expired, and valid runtime state without disclosure', (t) => {
  const context = fixture(t);
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
  const nowMs = Date.now();

  const inactive = buildPhantomDoctorReport({ workspace: context.workspace, nowMs });
  assert.equal(inactive.schema_version, 2);
  assert.equal(inactive.status, 'not_applicable');
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
    'backend_bundled', 'host', 'isolated', 'native', 'schema_version', 'status', 'verifier_bundled',
  ]);
});
