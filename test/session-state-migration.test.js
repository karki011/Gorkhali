// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');

const SCRIPT = require.resolve('../skills/phantom/scripts/migrate-session-state.mjs');
const STATE = require.resolve('../skills/phantom/scripts/phantom-state.mjs');
const DOCTOR = require.resolve('../skills/phantom/scripts/phantom-doctor.mjs');
const STATE_CODEC = require('../skills/phantom/scripts/lib/shared-state.cjs');
const REPO = 'migration-repo';
const TASK = 'TASK-101';
const CREATED = '2026-07-01T12:00:00.000Z';
const UPDATED = '2026-07-02T12:00:00.000Z';
const testWaiter = new Int32Array(new SharedArrayBuffer(4));

function mkdirp(directory) { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); }
function write(file, value, mode = 0o600) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, value, { mode });
}
function writeJson(file, value) { write(file, `${JSON.stringify(value, null, 2)}\n`); }
function digest(value) { return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`; }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function rebindManifest(manifest) {
  const { migration_id: ignored, ...plan } = manifest;
  return { ...plan, migration_id: digest(canonicalJson(plan)) };
}

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-state-migration-'));
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(root, 'workspace-')));
  const recordedWorkspace = options.workspaceMismatch
    ? fs.realpathSync(fs.mkdtempSync(path.join(root, 'foreign-workspace-')))
    : workspace;
  const dataInput = options.relativeData
    ? path.join(workspace, 'phantom-data')
    : path.join(root, 'phantom-data');
  const homeInput = path.join(root, 'home');
  mkdirp(dataInput);
  mkdirp(homeInput);
  const data = fs.realpathSync(dataInput);
  const home = fs.realpathSync(homeInput);
  const status = options.status || 'paused';
  const bucket = status === 'completed' ? 'completed' : 'sessions';
  const task = options.task || TASK;
  const repo = options.repo || REPO;
  const sessionDir = path.join(data, 'repos', repo, bucket, task);
  const pointer = path.join(data, 'state', 'current-session', `${repo}.json`);
  const session = {
    schema_version: 1,
    artifact_type: 'session',
    repo_id: repo,
    task_id: task,
    status,
    created_at: CREATED,
    updated_at: UPDATED,
    producer: { role: 'apex', compute_profile: 'frontier' },
    bundle_version: '0.2.11',
    workspace: recordedWorkspace,
    route: options.route || 'plan',
    intent_summary: options.intent || 'Migrate this legacy Phantom session safely.',
    lifecycle: {
      mode: options.mode || 'standard',
      approvals: { plan: { status: 'approved', decided_at: UPDATED, by: 'legacy-user' } },
      authorizations: { implementation: { status: 'authorized', decided_at: UPDATED, by: 'legacy-user' } },
      actions: { execute: { status: 'started', decided_at: UPDATED } },
    },
    legacy_authority: { must_not_survive: true },
  };
  if (options.workKind !== null) session.work_kind = options.workKind || 'implementation';
  if (status === 'paused') session.pause_reason = 'Legacy pause reason.';
  if (status === 'completed') session.completed_at = UPDATED;
  writeJson(path.join(sessionDir, 'session.json'), session);
  writeJson(path.join(sessionDir, 'intent.json'), {
    schema_version: 1,
    artifact_type: 'intent',
    repo_id: repo,
    task_id: task,
    status: 'active',
    created_at: CREATED,
    updated_at: UPDATED,
    producer: { role: 'apex', compute_profile: 'frontier' },
    bundle_version: '0.2.11',
    summary: session.intent_summary,
    route: session.route,
    work_kind: session.work_kind,
  });
  writeJson(path.join(sessionDir, 'plan.json'), { legacy_plan: true, authority: 'must-not-survive' });
  writeJson(pointer, {
    schema_version: 1,
    repo_id: repo,
    task_id: task,
    session_dir: sessionDir,
    updated_at: UPDATED,
    ...(status === 'completed' ? { status: 'completed' } : {}),
  });
  const env = {
    ...process.env,
    PHANTOM_DATA: options.relativeData ? 'phantom-data' : data,
    PHANTOM_REPO: repo,
    HOME: home,
  };
  delete env["PHANTOM_TEST_MIGRATION_CRASH_AT"];
  delete env["PHANTOM_TEST_MIGRATION_KILL_AT"];
  delete env.PHANTOM_TEST_MIGRATION_PUBLICATION_BARRIER;
  return {
    root,
    workspace,
    recordedWorkspace,
    data,
    home,
    env,
    repo,
    task,
    status,
    bucket,
    sessionDir,
    pointer,
    session,
  };
}

function addBoundRepository(world, options = {}) {
  const repo = options.repo || 'foreign-repo';
  const task = options.task || 'FOREIGN-202';
  const status = options.status || 'paused';
  const bucket = status === 'completed' ? 'completed' : 'sessions';
  const workspace = path.join(world.data, 'worktrees', repo);
  const sessionDir = path.join(world.data, 'repos', repo, bucket, task);
  const pointer = path.join(world.data, 'state', 'current-session', `${repo}.json`);
  mkdirp(workspace);
  const session = {
    ...world.session,
    repo_id: repo,
    task_id: task,
    status,
    workspace,
    pause_reason: status === 'paused' ? 'Foreign repository paused.' : undefined,
    completed_at: status === 'completed' ? UPDATED : undefined,
  };
  if (options.workKind === null) delete session.work_kind;
  else session.work_kind = options.workKind || 'implementation';
  writeJson(path.join(sessionDir, 'session.json'), session);
  writeJson(path.join(sessionDir, 'intent.json'), {
    schema_version: 1,
    artifact_type: 'intent',
    repo_id: repo,
    task_id: task,
    status: 'active',
    created_at: CREATED,
    updated_at: UPDATED,
    producer: { role: 'apex', compute_profile: 'frontier' },
    bundle_version: '0.2.11',
    summary: session.intent_summary,
    route: session.route,
    ...(session.work_kind ? { work_kind: session.work_kind } : {}),
  });
  writeJson(pointer, {
    schema_version: 1,
    repo_id: repo,
    task_id: task,
    session_dir: sessionDir,
    updated_at: UPDATED,
    ...(status === 'completed' ? { status: 'completed' } : {}),
  });
  return { repo, task, status, workspace, sessionDir, pointer, session };
}

function makeGitRootFixture(options = {}) {
  const world = fixture(options);
  const initialized = spawnSync('git', ['init', '-q', world.workspace], { encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  delete world.env.PHANTOM_REPO;
  const identity = STATE_CODEC.repoIdentity(world.workspace, { dataRoot: world.data });
  const oldRepoDir = path.join(world.data, 'repos', world.repo);
  const repoDir = path.join(world.data, 'repos', identity.id);
  fs.renameSync(oldRepoDir, repoDir);
  const oldPointer = world.pointer;
  const pointer = path.join(world.data, 'state', 'current-session', `${identity.id}.json`);
  fs.renameSync(oldPointer, pointer);
  const sessionDir = path.join(repoDir, world.bucket, world.task);
  const session = JSON.parse(fs.readFileSync(path.join(sessionDir, 'session.json'), 'utf8'));
  session.repo_id = identity.id;
  session.workspace = identity.root;
  writeJson(path.join(sessionDir, 'session.json'), session);
  const intent = JSON.parse(fs.readFileSync(path.join(sessionDir, 'intent.json'), 'utf8'));
  intent.repo_id = identity.id;
  writeJson(path.join(sessionDir, 'intent.json'), intent);
  const pointerValue = JSON.parse(fs.readFileSync(pointer, 'utf8'));
  pointerValue.repo_id = identity.id;
  pointerValue.session_dir = sessionDir;
  writeJson(pointer, pointerValue);
  world.repo = identity.id;
  world.pointer = pointer;
  world.sessionDir = sessionDir;
  world.session = session;
  return world;
}

function cleanup(world) {
  if (!fs.existsSync(world.root)) return;
  function makeRemovable(candidate) {
    let metadata;
    try { metadata = fs.lstatSync(candidate); } catch { return; }
    if (metadata.isSymbolicLink()) return;
    if (metadata.isDirectory()) {
      try { fs.chmodSync(candidate, 0o700); } catch {}
      for (const name of fs.readdirSync(candidate)) makeRemovable(path.join(candidate, name));
    } else {
      try { fs.chmodSync(candidate, 0o600); } catch {}
    }
  }
  makeRemovable(world.root);
  fs.rmSync(world.root, { recursive: true, force: true });
}

function run(world, args, envExtra = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args, '--workspace', world.workspace], {
    env: { ...world.env, ...envExtra },
    encoding: 'utf8',
  });
}

function runState(world, args, envExtra = {}) {
  return spawnSync(process.execPath, [STATE, ...args, '--workspace', world.workspace], {
    env: { ...world.env, ...envExtra },
    encoding: 'utf8',
  });
}

function runDoctor(world, envExtra = {}) {
  return spawnSync(process.execPath, [DOCTOR, '--workspace', world.workspace], {
    env: { ...world.env, ...envExtra },
    encoding: 'utf8',
  });
}

function spawnStateReader(world, token) {
  const source = `import(${JSON.stringify(pathToFileURL(STATE).href)})`
    + `.then((state) => state.workflowControlContext(${JSON.stringify(world.workspace)}))`
    + `.then((value) => process.stdout.write(JSON.stringify(value)))`
    + `.catch((error) => { process.stderr.write(error.message); process.exitCode = 1; });`;
  const child = spawn(process.execPath, ['-e', source], {
    env: { ...world.env, PHANTOM_TEST_STATE_READER_BARRIER: token },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, completed };
}

function spawnMigration(world, args, envExtra = {}) {
  const child = spawn(process.execPath, [SCRIPT, ...args, '--workspace', world.workspace], {
    env: { ...world.env, ...envExtra },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, completed };
}

function spawnWorkerMigration(world, method, manifestFile, envExtra = {}) {
  const source = `
    const { parentPort } = require('node:worker_threads');
    import(${JSON.stringify(pathToFileURL(SCRIPT).href)})
      .then((migration) => migration[${JSON.stringify(method)}]({
        workspace: ${JSON.stringify(world.workspace)},
        manifest: ${JSON.stringify(manifestFile)},
      }))
      .then((value) => parentPort.postMessage({ ok: true, value }))
      .catch((error) => parentPort.postMessage({ ok: false, error: error.message }));
  `;
  const worker = new Worker(source, {
    eval: true,
    env: { ...world.env, ...envExtra },
  });
  const completed = new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  return { worker, completed };
}

function spawnWorkerApply(world, manifestFile, envExtra = {}) {
  return spawnWorkerMigration(world, 'applyMigration', manifestFile, envExtra);
}

function waitForFile(file, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`);
    Atomics.wait(testWaiter, 0, 0, 10);
  }
}

function inventory(world, args = []) {
  const result = run(world, ['inventory', ...args]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function saveManifest(world, manifest) {
  const file = path.join(world.root, `manifest-${manifest.migration_id.slice(-12)}.json`);
  writeJson(file, manifest);
  return file;
}

function apply(world, manifest, envExtra = {}) {
  const file = saveManifest(world, manifest);
  const result = run(world, ['apply', '--manifest', file], envExtra);
  return { file, result, value: result.stdout ? JSON.parse(result.stdout) : null };
}

function treeState(root) {
  if (!fs.existsSync(root)) return [];
  const values = [];
  function visit(directory, relative = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const rel = relative ? `${relative}/${name}` : name;
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) values.push([rel, 'symlink', fs.readlinkSync(absolute)]);
      else if (metadata.isDirectory()) {
        values.push([rel, 'directory', metadata.mode & 0o777]);
        visit(absolute, rel);
      } else if (metadata.isFile()) {
        const bytes = fs.readFileSync(absolute);
        values.push([rel, 'file', digest(bytes), bytes.length, metadata.mode & 0o777, metadata.nlink]);
      } else values.push([rel, 'special', metadata.mode]);
    }
  }
  visit(root);
  return values;
}

function liveState(root) {
  return treeState(root).filter(([relative]) => relative !== 'locks' && !relative.startsWith('locks/'));
}

function durablePublicationDebris(root) {
  return treeState(root)
    .map(([relative]) => relative)
    .filter((relative) => path.basename(relative).startsWith('.phantom-publish-v1-'));
}

function publicationLink(root) {
  const files = [];
  function visit(directory) {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      const metadata = fs.lstatSync(file);
      if (metadata.isDirectory()) visit(file);
      else if (metadata.isFile()) files.push({ file, metadata });
    }
  }
  visit(root);
  const prepared = files.find(({ file, metadata }) => (
    path.basename(file).startsWith('.phantom-publish-v1-') && metadata.nlink === 2
  ));
  assert.ok(prepared, 'expected a linked durable publication');
  const target = files.find(({ file, metadata }) => (
    file !== prepared.file
      && metadata.dev === prepared.metadata.dev
      && metadata.ino === prepared.metadata.ino
  ));
  assert.ok(target, 'expected the publication target hard link');
  return {
    target: target.file,
    bytes: fs.readFileSync(target.file),
    device: target.metadata.dev,
    inode: target.metadata.ino,
  };
}

function fileWithIdentity(root, expected) {
  let match = null;
  function visit(directory) {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      const metadata = fs.lstatSync(file);
      if (metadata.isDirectory()) visit(file);
      else if (metadata.isFile()
        && metadata.dev === expected.device && metadata.ino === expected.inode) match = file;
    }
  }
  visit(root);
  return match;
}

function replaceFileGeneration(file) {
  const bytes = fs.readFileSync(file);
  const mode = fs.statSync(file).mode & 0o777;
  const replacement = `${file}.replacement-${crypto.randomUUID()}`;
  fs.writeFileSync(replacement, bytes, { mode });
  fs.renameSync(replacement, file);
}

function replaceDirectory(directory) {
  const original = `${directory}.physical-original`;
  fs.renameSync(directory, original);
  fs.cpSync(original, directory, { recursive: true, preserveTimestamps: true, errorOnExist: true });
  return original;
}

function replaceFile(file) {
  const original = `${file}.physical-original`;
  fs.renameSync(file, original);
  fs.copyFileSync(original, file, fs.constants.COPYFILE_EXCL);
  return original;
}

function mutationEntry(manifest) {
  return manifest.entries.find((entry) => ['migrate_to_paused', 'archive_completed', 'quarantine_pointer'].includes(entry.action));
}

function transactionRoot(world, manifest) {
  return path.join(world.data, 'migrations', 'session-state', manifest.migration_id.slice(7));
}

function migrationJournal(world, manifest, repo = world.repo) {
  return path.join(transactionRoot(world, manifest), 'journals', `${repo}.jsonl`);
}

function migrationJournalEvents(world, manifest, repo = world.repo) {
  return fs.readFileSync(migrationJournal(world, manifest, repo), 'utf8')
    .trim().split('\n').filter(Boolean).map(JSON.parse);
}

function rewriteJournal(file, transform) {
  const events = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  transform(events);
  let previous = null;
  const rewritten = events.map((event, index) => {
    const input = {
      ...event,
      sequence: index + 1,
      previous_event_digest: previous,
    };
    delete input.event_digest;
    const next = { ...input, event_digest: digest(canonicalJson(input)) };
    previous = next.event_digest;
    return canonicalJson(next);
  });
  fs.writeFileSync(file, `${rewritten.join('\n')}\n`, { mode: 0o600 });
}

test('inventory is canonical, stable, and performs zero filesystem writes', () => {
  const world = fixture();
  try {
    const before = treeState(world.data);
    const firstResult = run(world, ['inventory']);
    const middle = treeState(world.data);
    const secondResult = run(world, []);
    const after = treeState(world.data);
    assert.equal(firstResult.status, 0, firstResult.stderr);
    assert.equal(secondResult.status, 0, secondResult.stderr);
    assert.deepEqual(middle, before);
    assert.deepEqual(after, before);
    assert.equal(firstResult.stdout, secondResult.stdout);
    const first = JSON.parse(firstResult.stdout);
    assert.match(first.migration_id, /^sha256:[a-f0-9]{64}$/);
    assert.equal(mutationEntry(first).action, 'migrate_to_paused');
    assert.equal(firstResult.stdout.trim().includes('\n'), false, 'canonical output is a single JSON line');
  } finally { cleanup(world); }
});

test('workspace path, repository identity, and physical directory are bound before mutation', () => {
  const mismatched = fixture({ workspaceMismatch: true });
  const changedRepo = fixture();
  const replacedWorkspace = fixture();
  try {
    const mismatchManifest = inventory(mismatched);
    const mismatchEntry = mismatchManifest.entries.find((entry) => entry.repo_id === REPO);
    assert.equal(mismatchEntry.action, 'manual');
    assert.equal(mismatchEntry.reason, 'legacy_session_workspace_or_repo_binding_mismatch');
    const originalPointer = fs.readFileSync(mismatched.pointer);
    const mismatchApply = apply(mismatched, mismatchManifest);
    assert.equal(mismatchApply.result.status, 0, mismatchApply.result.stderr);
    assert.deepEqual(fs.readFileSync(mismatched.pointer), originalPointer);
    assert.equal(JSON.parse(fs.readFileSync(path.join(mismatched.sessionDir, 'session.json'), 'utf8')).schema_version, 1);

    const repoManifest = inventory(changedRepo);
    const repoFile = saveManifest(changedRepo, repoManifest);
    const repoBefore = treeState(changedRepo.data);
    const repoApply = run(changedRepo, ['apply', '--manifest', repoFile], { PHANTOM_REPO: 'different-repo' });
    assert.notEqual(repoApply.status, 0);
    assert.match(repoApply.stderr, /workspace identity changed/);
    assert.deepEqual(treeState(changedRepo.data), repoBefore);

    const physicalManifest = inventory(replacedWorkspace);
    const physicalFile = saveManifest(replacedWorkspace, physicalManifest);
    const physicalBefore = treeState(replacedWorkspace.data);
    fs.renameSync(replacedWorkspace.workspace, `${replacedWorkspace.workspace}-original`);
    fs.mkdirSync(replacedWorkspace.workspace);
    const physicalApply = run(replacedWorkspace, ['apply', '--manifest', physicalFile]);
    assert.notEqual(physicalApply.status, 0);
    assert.match(physicalApply.stderr, /workspace identity changed/);
    assert.deepEqual(treeState(replacedWorkspace.data), physicalBefore);
  } finally {
    cleanup(mismatched);
    cleanup(changedRepo);
    cleanup(replacedWorkspace);
  }
});

test('nested workspace input binds migration state to the canonical repository root', () => {
  const world = makeGitRootFixture({ relativeData: true });
  const repositoryRoot = world.workspace;
  const nested = path.join(repositoryRoot, 'packages', 'nested');
  try {
    mkdirp(nested);
    world.workspace = nested;
    const manifest = inventory(world);
    const entry = mutationEntry(manifest);
    assert.equal(manifest.workspace_binding.canonical_path, repositoryRoot);
    assert.equal(entry.workspace_binding.canonical_path, repositoryRoot);
    assert.equal(entry.metadata.workspace, repositoryRoot);
    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const session = JSON.parse(fs.readFileSync(path.join(world.sessionDir, 'session.json'), 'utf8'));
    assert.equal(session.workspace, repositoryRoot);
  } finally { cleanup(world); }
});

test('physical data, state hierarchy, and pointer replacement blocks apply, resume, verify, and rollback without writes', () => {
  const targets = [
    'data-root',
    'repo-shard',
    'pointer-parent',
    'pointer-leaf',
    'bucket',
    'live-tree',
    'archive',
  ];
  for (const operation of ['apply', 'resume', 'verify', 'rollback']) {
    for (const targetName of targets) {
      if (operation === 'apply' && targetName === 'archive') continue;
      const world = fixture();
      try {
        const manifest = inventory(world);
        const file = saveManifest(world, manifest);
        if (operation === 'resume') {
          const interrupted = run(world, ['apply', '--manifest', file], {
            PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_successor',
          });
          assert.notEqual(interrupted.status, 0);
          assert.match(interrupted.stderr, /Injected migration crash/);
        } else if (['verify', 'rollback'].includes(operation)) {
          const migrated = run(world, ['apply', '--manifest', file]);
          assert.equal(migrated.status, 0, migrated.stderr);
        }

        const tx = path.join(world.data, 'migrations', 'session-state', manifest.migration_id.slice(7));
        const targetsByName = {
          'data-root': world.data,
          'repo-shard': path.join(world.data, 'repos', world.repo),
          'pointer-parent': path.dirname(world.pointer),
          'pointer-leaf': world.pointer,
          bucket: path.join(world.data, 'repos', world.repo, 'sessions'),
          'live-tree': world.sessionDir,
          archive: path.join(tx, 'history', 'repos', world.repo, 'sessions', world.task),
        };
        const target = targetsByName[targetName];
        assert.equal(fs.existsSync(target), true, `${operation}/${targetName} fixture target`);
        const originalIdentity = fs.lstatSync(target);
        if (targetName === 'pointer-leaf') replaceFile(target);
        else replaceDirectory(target);
        const replacementIdentity = fs.lstatSync(target);
        assert.notEqual(replacementIdentity.ino, originalIdentity.ino, `${operation}/${targetName} inode changed`);
        const before = liveState(world.data);
        const command = operation === 'resume' ? 'apply' : operation;
        const result = run(world, [command, '--manifest', file]);
        assert.notEqual(result.status, 0, `${operation}/${targetName}`);
        assert.deepEqual(liveState(world.data), before, `${operation}/${targetName} live state must be zero-write`);
      } finally { cleanup(world); }
    }
  }
});

test('paused v1 migrates to a clean paused v2 successor and resets all authority/evidence', () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const { file, result, value } = apply(world, manifest);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(value.status, 'verified');
    const session = JSON.parse(fs.readFileSync(path.join(world.sessionDir, 'session.json'), 'utf8'));
    const intent = JSON.parse(fs.readFileSync(path.join(world.sessionDir, 'intent.json'), 'utf8'));
    const pointer = JSON.parse(fs.readFileSync(world.pointer, 'utf8'));
    assert.equal(session.schema_version, 2);
    assert.equal(session.status, 'paused');
    assert.equal(session.workspace, world.workspace);
    assert.equal(intent.schema_version, 2);
    assert.equal(intent.status, 'active');
    assert.equal(pointer.schema_version, 2);
    assert.equal(pointer.session_dir, world.sessionDir);
    assert.equal(session.authority_trust, null);
    assert.deepEqual(session.authority_decisions, []);
    for (const group of Object.values(session.lifecycle)) {
      if (!group || typeof group !== 'object') continue;
      for (const decision of Object.values(group)) assert.equal(decision.status, 'pending');
    }
    assert.equal(fs.existsSync(path.join(world.sessionDir, 'plan.json')), false);
    assert.equal(fs.existsSync(path.join(world.sessionDir, 'workflow')), false);
    assert.equal(fs.existsSync(path.join(world.sessionDir, 'control-inputs', '.claims')), true);
    const verify = run(world, ['verify', '--manifest', file]);
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(JSON.parse(verify.stdout).status, 'verified');
    const runtimeStatus = runState(world, ['status']);
    assert.equal(runtimeStatus.status, 0, runtimeStatus.stderr);
    assert.equal(JSON.parse(runtimeStatus.stdout).task_id, world.task);
    assert.equal(JSON.parse(runtimeStatus.stdout).status, 'paused');
    const doctor = runDoctor(world);
    assert.ok(doctor.stdout, doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.migration.status, 'not_required');
    assert.equal(report.migration.reason, 'state_envelope_v2');
  } finally { cleanup(world); }
});

test('session migration A+B: transaction-manifest crash fences safely and exact retry completes', () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const originalPointer = fs.readFileSync(world.pointer);
    const originalSource = treeState(world.sessionDir);
    const crashed = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_transaction_manifest',
    });
    assert.notEqual(crashed.status, 0);
    assert.match(crashed.stderr, /Injected migration crash at after_transaction_manifest/);
    const tx = transactionRoot(world, manifest);
    assert.deepEqual(fs.readdirSync(tx).sort(), ['manifest.json']);
    assert.deepEqual(fs.readFileSync(world.pointer), originalPointer);
    assert.deepEqual(treeState(world.sessionDir), originalSource);
    for (const name of ['.session-state-migration.lock', `${world.repo}.lock`]) {
      const lock = JSON.parse(fs.readFileSync(path.join(world.data, 'locks', name), 'utf8'));
      assert.equal(lock.state, 'recovery_required');
    }

    const recovered = run(world, ['apply', '--manifest', file]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).status, 'verified');
  } finally { cleanup(world); }
});

test('session migration A+B: exact prepared receipt resumes through retained lock provenance', () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const crashed = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_transaction_prepared',
    });
    assert.notEqual(crashed.status, 0);
    assert.match(crashed.stderr, /Injected migration crash at after_transaction_prepared/);
    const tx = transactionRoot(world, manifest);
    const receipt = JSON.parse(fs.readFileSync(path.join(tx, 'transaction-prepared.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(
      path.join(world.data, 'locks', '.session-state-migration.lock'),
      'utf8',
    ));
    assert.equal(lock.state, 'recovery_required');
    assert.equal(receipt.global_lock.token, lock.token);
    assert.equal(receipt.global_lock.claim_epoch, lock.claim_epoch);
    assert.equal(receipt.global_lock.claim_digest, lock.claim_digest);

    const recovered = run(world, ['apply', '--manifest', file]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).status, 'verified');
  } finally { cleanup(world); }
});

test('session migration A+B: preseeded or tampered transaction manifests cannot authorize apply', () => {
  const preseeded = fixture();
  const tampered = fixture();
  try {
    const preseededManifest = inventory(preseeded);
    const preseededFile = saveManifest(preseeded, preseededManifest);
    const preseededTx = transactionRoot(preseeded, preseededManifest);
    mkdirp(preseededTx);
    writeJson(path.join(preseededTx, 'manifest.json'), preseededManifest);
    const preseededLive = liveState(preseeded.data);
    const refusedPreseed = run(preseeded, ['apply', '--manifest', preseededFile]);
    assert.notEqual(refusedPreseed.status, 0);
    assert.match(refusedPreseed.stderr, /manifest lacks its retained global lock/);
    assert.deepEqual(liveState(preseeded.data), preseededLive);
    assert.equal(fs.existsSync(
      path.join(preseeded.data, 'locks', '.session-state-migration.lock'),
    ), false);

    const tamperedManifest = inventory(tampered);
    const tamperedFile = saveManifest(tampered, tamperedManifest);
    const crashed = run(tampered, ['apply', '--manifest', tamperedFile], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_transaction_manifest',
    });
    assert.notEqual(crashed.status, 0);
    const storedManifest = path.join(transactionRoot(tampered, tamperedManifest), 'manifest.json');
    const replacement = JSON.parse(fs.readFileSync(storedManifest, 'utf8'));
    replacement.confirmations.inactive = [`${tampered.repo}/${tampered.task}`];
    writeJson(storedManifest, replacement);
    const tamperedLive = liveState(tampered.data);
    const refusedTamper = run(tampered, ['apply', '--manifest', tamperedFile]);
    assert.notEqual(refusedTamper.status, 0);
    assert.match(refusedTamper.stderr, /Stored migration manifest does not match/);
    assert.deepEqual(liveState(tampered.data), tamperedLive);
  } finally {
    cleanup(preseeded);
    cleanup(tampered);
  }
});

test('session migration A+B: source-successor resume requires exact v1 or a v2 preparation receipt', () => {
  const exactLegacy = fixture();
  const driftedLegacy = fixture();
  const receiptedSuccessor = fixture();
  try {
    const exactManifest = inventory(exactLegacy);
    const exactFile = saveManifest(exactLegacy, exactManifest);
    const exactCrash = run(exactLegacy, ['apply', '--manifest', exactFile], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_phase1',
    });
    assert.notEqual(exactCrash.status, 0);
    assert.equal(JSON.parse(fs.readFileSync(
      path.join(exactLegacy.sessionDir, 'session.json'),
      'utf8',
    )).schema_version, 1);
    const exactRetry = run(exactLegacy, ['apply', '--manifest', exactFile]);
    assert.equal(exactRetry.status, 0, exactRetry.stderr);
    assert.equal(JSON.parse(exactRetry.stdout).status, 'verified');

    const driftedManifest = inventory(driftedLegacy);
    const driftedFile = saveManifest(driftedLegacy, driftedManifest);
    const driftedCrash = run(driftedLegacy, ['apply', '--manifest', driftedFile], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_phase1',
    });
    assert.notEqual(driftedCrash.status, 0);
    const legacySessionFile = path.join(driftedLegacy.sessionDir, 'session.json');
    const changedLegacy = JSON.parse(fs.readFileSync(legacySessionFile, 'utf8'));
    changedLegacy.intent_summary = 'Unreceipted drift after the backup phase.';
    writeJson(legacySessionFile, changedLegacy);
    const driftedState = liveState(driftedLegacy.data);
    const refusedDrift = run(driftedLegacy, ['apply', '--manifest', driftedFile]);
    assert.notEqual(refusedDrift.status, 0);
    assert.match(refusedDrift.stderr, /Successor activation lacks a prepared receipt/);
    assert.deepEqual(liveState(driftedLegacy.data), driftedState);

    const successorManifest = inventory(receiptedSuccessor);
    const successorFile = saveManifest(receiptedSuccessor, successorManifest);
    const successorCrash = run(receiptedSuccessor, ['apply', '--manifest', successorFile], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_successor_rename_before_commit',
    });
    assert.notEqual(successorCrash.status, 0);
    assert.equal(JSON.parse(fs.readFileSync(
      path.join(receiptedSuccessor.sessionDir, 'session.json'),
      'utf8',
    )).schema_version, 2);
    const journal = fs.readFileSync(path.join(
      transactionRoot(receiptedSuccessor, successorManifest),
      'journals',
      `${receiptedSuccessor.repo}.jsonl`,
    ), 'utf8');
    assert.match(journal, /"event_type":"successor_prepared"/);
    const successorRetry = run(receiptedSuccessor, ['apply', '--manifest', successorFile]);
    assert.equal(successorRetry.status, 0, successorRetry.stderr);
    assert.equal(JSON.parse(successorRetry.stdout).status, 'verified');
  } finally {
    cleanup(exactLegacy);
    cleanup(driftedLegacy);
    cleanup(receiptedSuccessor);
  }
});

test('session migration A+B: mismatched retained lock and prepared receipt fail closed', () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const crashed = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_transaction_prepared',
    });
    assert.notEqual(crashed.status, 0);
    const lockFile = path.join(world.data, 'locks', '.session-state-migration.lock');
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock.token = 'mismatched-retained-lock-token';
    writeJson(lockFile, lock);
    const before = liveState(world.data);
    const refused = run(world, ['apply', '--manifest', file]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /lacks a trusted prepared receipt/);
    assert.deepEqual(liveState(world.data), before);
  } finally { cleanup(world); }
});

test('active sessions require per-session inactivity confirmation and missing work kind requires override', () => {
  const active = fixture({ status: 'active' });
  const missing = fixture({ workKind: null });
  try {
    const activeDry = inventory(active);
    assert.equal(activeDry.entries.find((entry) => entry.task_id === TASK).action, 'manual');
    assert.equal(activeDry.entries.find((entry) => entry.task_id === TASK).reason, 'explicit_inactive_confirmation_required');
    const activeConfirmed = inventory(active, ['--confirm-inactive', `${REPO}/${TASK}`]);
    assert.equal(mutationEntry(activeConfirmed).action, 'migrate_to_paused');
    assert.equal(apply(active, activeConfirmed).result.status, 0);

    const missingDry = inventory(missing);
    assert.equal(missingDry.entries.find((entry) => entry.task_id === TASK).reason, 'explicit_work_kind_required');
    const overridden = inventory(missing, ['--work-kind', `${REPO}/${TASK}=investigation`]);
    assert.equal(mutationEntry(overridden).metadata.work_kind, 'investigation');
    const migrated = apply(missing, overridden);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const session = JSON.parse(fs.readFileSync(path.join(missing.sessionDir, 'session.json'), 'utf8'));
    assert.equal(session.work_kind, 'investigation');
  } finally {
    cleanup(active);
    cleanup(missing);
  }
});

test('to-plan is preserved as a permanent restriction with every decision pending', () => {
  const world = fixture({ mode: 'to-plan' });
  try {
    const migrated = apply(world, inventory(world));
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const session = JSON.parse(fs.readFileSync(path.join(world.sessionDir, 'session.json'), 'utf8'));
    assert.equal(session.lifecycle.mode, 'to-plan');
    assert.equal(session.lifecycle.authorizations.implementation.status, 'pending');
    assert.equal(session.lifecycle.actions.execute.status, 'pending');
    assert.equal(session.lifecycle.authorizations['ship-draft-pr'].status, 'pending');
  } finally { cleanup(world); }
});

test('completed v1 state becomes immutable history only and never a synthetic v2 completion', () => {
  const world = fixture({ status: 'completed' });
  try {
    const manifest = inventory(world);
    assert.equal(mutationEntry(manifest).action, 'archive_completed');
    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    assert.equal(fs.existsSync(world.sessionDir), false);
    assert.equal(fs.existsSync(world.pointer), false);
    const transaction = path.join(world.data, 'migrations', 'session-state', manifest.migration_id.slice(7));
    const history = path.join(transaction, 'history', 'repos', REPO, 'completed', TASK);
    assert.equal(fs.existsSync(path.join(history, 'session.json')), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(history, 'session.json'), 'utf8')).schema_version, 1);
    assert.equal(fs.statSync(history).mode & 0o277, 0, 'history directory is sealed');
    assert.equal(fs.statSync(path.join(history, 'session.json')).mode & 0o377, 0, 'history file is read-only');
    assert.equal(fs.existsSync(path.join(transaction, 'history', 'pointers', `${REPO}.json`)), true);
  } finally { cleanup(world); }
});

test('selected telemetry, dangling, and malformed pointer files are parked without becoming sessions', () => {
  const cases = [
    { name: 'telemetry', value: { cwd: '/tmp/workspace', session_id: 'abc:123', ts: 1_800_000_000_000 } },
    { name: 'dangling', value: null },
    { name: 'malformed', raw: '{not-json\n' },
  ];
  for (const scenario of cases) {
    const world = fixture();
    try {
      fs.rmSync(world.sessionDir, { recursive: true, force: true });
      if (scenario.name === 'dangling') {
        scenario.value = {
          schema_version: 1,
          repo_id: REPO,
          task_id: TASK,
          session_dir: world.sessionDir,
          updated_at: UPDATED,
        };
      }
      if (scenario.raw) write(world.pointer, scenario.raw);
      else writeJson(world.pointer, scenario.value);
      const manifest = inventory(world);
      const selected = mutationEntry(manifest);
      assert.equal(selected.repo_id, world.repo, scenario.name);
      assert.equal(selected.action, 'quarantine_pointer', scenario.name);
      if (scenario.name === 'malformed') {
        assert.match(selected.reason, /^unsafe_or_malformed_pointer:/);
      }
      const migrated = apply(world, manifest);
      assert.equal(migrated.result.status, 0, `${scenario.name}: ${migrated.result.stderr}`);
      assert.equal(fs.existsSync(world.pointer), false);
      const quarantine = path.join(
        world.data, 'migrations', 'session-state', manifest.migration_id.slice(7),
        'quarantine', 'pointers', `${REPO}.json`,
      );
      assert.equal(fs.existsSync(quarantine), true);
      assert.equal(fs.existsSync(path.join(world.data, 'repos', REPO, 'sessions', TASK)), false);
    } finally { cleanup(world); }
  }
});

test('foreign malformed pointers stay visible and untouched while the selected repository migrates', () => {
  const world = fixture();
  const foreignRepo = 'foreign-repo';
  const foreignPointer = path.join(world.data, 'state', 'current-session', `${foreignRepo}.json`);
  const foreignBytes = Buffer.from('{foreign-malformed-json\n');
  try {
    write(foreignPointer, foreignBytes);
    const manifest = inventory(world);
    const selected = manifest.entries.find((entry) => entry.repo_id === world.repo && entry.task_id === world.task);
    const foreign = manifest.entries.find((entry) => entry.repo_id === foreignRepo);
    assert.equal(selected.action, 'migrate_to_paused');
    assert.equal(foreign.action, 'manual');
    assert.match(foreign.reason, /^unsafe_or_malformed_pointer:/);
    assert.deepEqual(fs.readFileSync(foreignPointer), foreignBytes);

    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    assert.equal(migrated.value.status, 'verified');
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 2);
    assert.deepEqual(fs.readFileSync(foreignPointer), foreignBytes);

    const verified = run(world, ['verify', '--manifest', migrated.file]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).status, 'verified');
    assert.deepEqual(fs.readFileSync(foreignPointer), foreignBytes);
  } finally { cleanup(world); }
});

test('malformed v2 and future-schema pointers are never silently accepted or mutated', () => {
  const selectedV2 = fixture();
  const foreignFuture = fixture();
  try {
    writeJson(selectedV2.pointer, { schema_version: 2 });
    const malformedManifest = inventory(selectedV2);
    const malformed = malformedManifest.entries.find((entry) => entry.pointer_relative === `state/current-session/${REPO}.json`);
    assert.equal(malformed.action, 'manual');
    assert.match(malformed.reason, /invalid_v2_pointer/);
    const malformedBytes = fs.readFileSync(selectedV2.pointer);
    const malformedApply = apply(selectedV2, malformedManifest);
    assert.equal(malformedApply.result.status, 0, malformedApply.result.stderr);
    assert.deepEqual(fs.readFileSync(selectedV2.pointer), malformedBytes);

    const foreign = addBoundRepository(foreignFuture);
    const futurePointer = {
      schema_version: 99,
      repo_id: foreign.repo,
      opaque_future_state: { must_survive: true },
    };
    writeJson(foreign.pointer, futurePointer);
    const futureBytes = fs.readFileSync(foreign.pointer);
    const futureManifest = inventory(foreignFuture);
    const future = futureManifest.entries.find((entry) => entry.repo_id === foreign.repo
      && entry.pointer_relative === `state/current-session/${foreign.repo}.json`);
    assert.equal(future.action, 'manual');
    assert.equal(future.reason, 'unsupported_future_state_schema:99');
    const migrated = apply(foreignFuture, futureManifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    assert.deepEqual(fs.readFileSync(foreign.pointer), futureBytes);
    assert.equal(fs.existsSync(path.join(
      transactionRoot(foreignFuture, futureManifest),
      'quarantine',
      'pointers',
      `${foreign.repo}.json`,
    )), false);

    const postMigration = inventory(foreignFuture);
    const selected = postMigration.entries.find((entry) => entry.repo_id === REPO
      && entry.pointer_relative === `state/current-session/${REPO}.json`);
    assert.equal(selected.action, 'ignore_v2');
    assert.equal(selected.reason, 'state_envelope_v2');
  } finally {
    cleanup(selectedV2);
    cleanup(foreignFuture);
  }
});

test('two repository leases preserve exact seven-event apply and nine-event rollback journals', () => {
  const world = fixture();
  const foreign = addBoundRepository(world);
  try {
    const selectedBytes = fs.readFileSync(world.pointer);
    const foreignBytes = fs.readFileSync(foreign.pointer);
    const manifest = inventory(world);
    const mutations = manifest.entries.filter((entry) => entry.action === 'migrate_to_paused');
    assert.deepEqual(mutations.map((entry) => entry.repo_id).sort(), [foreign.repo, world.repo].sort());
    assert.equal(new Set(mutations.map((entry) => entry.workspace_binding.canonical_path)).size, 2);

    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    assert.equal(migrated.value.entries_verified, 2);
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 2);
    assert.equal(JSON.parse(fs.readFileSync(foreign.pointer, 'utf8')).schema_version, 2);
    const appliedState = treeState(world.data);
    const repeatedApply = run(world, ['apply', '--manifest', migrated.file]);
    assert.equal(repeatedApply.status, 0, repeatedApply.stderr);
    assert.equal(JSON.parse(repeatedApply.stdout).status, 'verified');
    assert.deepEqual(treeState(world.data), appliedState, 'repeated apply has zero journal or state drift');
    const verified = run(world, ['verify', '--manifest', migrated.file]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).entries_verified, 2);
    const tx = path.join(world.data, 'migrations', 'session-state', manifest.migration_id.slice(7));
    for (const repo of [world.repo, foreign.repo]) {
      const journal = path.join(tx, 'journals', `${repo}.jsonl`);
      assert.deepEqual(
        fs.readFileSync(journal, 'utf8').trim().split('\n').map((line) => JSON.parse(line).event_type),
        [
          'entry_started', 'backup_verified', 'source_archived', 'successor_prepared',
          'successor_activated', 'pointer_prepared', 'pointer_committed',
        ],
      );
      assert.ok(fs.statSync(journal).size < 32 * 1024 * 1024);
    }

    const rolledBack = run(world, ['rollback', '--manifest', migrated.file]);
    assert.equal(rolledBack.status, 0, rolledBack.stderr);
    assert.equal(JSON.parse(rolledBack.stdout).entries_restored, 2);
    assert.deepEqual(fs.readFileSync(world.pointer), selectedBytes);
    assert.deepEqual(fs.readFileSync(foreign.pointer), foreignBytes);
    for (const repo of [world.repo, foreign.repo]) {
      const journal = path.join(tx, 'journals', `${repo}.jsonl`);
      assert.deepEqual(
        fs.readFileSync(journal, 'utf8').trim().split('\n').map((line) => JSON.parse(line).event_type),
        [
          'entry_started', 'backup_verified', 'source_archived', 'successor_prepared',
          'successor_activated', 'pointer_prepared', 'pointer_committed',
          'rollback_pointer_prepared', 'rollback_completed',
        ],
      );
      assert.ok(fs.statSync(journal).size < 32 * 1024 * 1024);
    }
    const rolledBackState = treeState(world.data);
    const repeatedRollback = run(world, ['rollback', '--manifest', migrated.file]);
    assert.equal(repeatedRollback.status, 0, repeatedRollback.stderr);
    assert.equal(JSON.parse(repeatedRollback.stdout).status, 'rolled_back');
    assert.deepEqual(treeState(world.data), rolledBackState, 'repeated rollback has zero journal or state drift');
  } finally { cleanup(world); }
});

test('first atomic journal event repairs a real death after no-replace link', {
  skip: process.platform === 'win32',
}, () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const killed = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_KILL_AT: 'atomic_journal_after_no_replace_link',
    });
    assert.equal(killed.signal, 'SIGKILL');
    const journal = migrationJournal(world, manifest);
    const temporaryPrefix = `.${path.basename(journal)}.atomic-journal.tmp-`;
    const temporary = fs.readdirSync(path.dirname(journal))
      .find((name) => name.startsWith(temporaryPrefix));
    assert.ok(temporary, 'publisher death retains its two-link staging name');
    const journalStat = fs.lstatSync(journal);
    const temporaryStat = fs.lstatSync(path.join(path.dirname(journal), temporary));
    assert.equal(journalStat.nlink, 2);
    assert.equal(temporaryStat.nlink, 2);
    assert.equal(journalStat.dev, temporaryStat.dev);
    assert.equal(journalStat.ino, temporaryStat.ino);

    const recovered = run(world, ['apply', '--manifest', file]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).status, 'verified');
    assert.equal(migrationJournalEvents(world, manifest).length, 7);
    assert.equal(fs.lstatSync(journal).nlink, 1);
    assert.equal(fs.readdirSync(path.dirname(journal)).some(
      (name) => name.startsWith(temporaryPrefix),
    ), false);
  } finally { cleanup(world); }
});

test('later atomic journal event retry after rename is durable and never duplicates', () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const crashed = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'atomic_journal_after_rename',
    });
    assert.notEqual(crashed.status, 0);
    assert.match(crashed.stderr, /atomic_journal_after_rename/);
    assert.deepEqual(
      migrationJournalEvents(world, manifest).map((event) => event.event_type),
      ['entry_started', 'backup_verified'],
    );
    const recovered = run(world, ['apply', '--manifest', file]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.deepEqual(
      migrationJournalEvents(world, manifest).map((event) => event.event_type),
      [
        'entry_started', 'backup_verified', 'source_archived', 'successor_prepared',
        'successor_activated', 'pointer_prepared', 'pointer_committed',
      ],
    );
  } finally { cleanup(world); }
});

test('atomic migration journals reject tampered, truncated, noncanonical, identity, and predecessor input', () => {
  const scenarios = {
    tampered(events) {
      events[0].payload.cutover_at = '2026-08-01T00:00:00.000Z';
      return `${events.map(canonicalJson).join('\n')}\n`;
    },
    truncated(events, bytes) {
      return bytes.subarray(0, -1);
    },
    noncanonical(events) {
      return `${events.map((event) => `{ ${canonicalJson(event).slice(1)}`).join('\n')}\n`;
    },
    identity(events) {
      events[0].repo_id = 'different-repository';
      let previous = null;
      return `${events.map((event, index) => {
        const input = { ...event, sequence: index + 1, previous_event_digest: previous };
        delete input.event_digest;
        const next = { ...input, event_digest: digest(canonicalJson(input)) };
        previous = next.event_digest;
        return canonicalJson(next);
      }).join('\n')}\n`;
    },
    predecessor(events) {
      events[1].previous_event_digest = `sha256:${'0'.repeat(64)}`;
      const { event_digest: ignored, ...input } = events[1];
      events[1] = { ...input, event_digest: digest(canonicalJson(input)) };
      return `${events.map(canonicalJson).join('\n')}\n`;
    },
  };
  for (const [name, corrupt] of Object.entries(scenarios)) {
    const world = fixture();
    try {
      const manifest = inventory(world);
      const file = saveManifest(world, manifest);
      const partial = run(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_phase1',
      });
      assert.notEqual(partial.status, 0, name);
      const journal = migrationJournal(world, manifest);
      const bytes = fs.readFileSync(journal);
      const events = bytes.toString('utf8').trim().split('\n').map(JSON.parse);
      fs.writeFileSync(journal, corrupt(events, bytes), { mode: 0o600 });
      const corrupted = fs.readFileSync(journal);
      const liveBefore = liveState(world.data);
      const refused = run(world, ['apply', '--manifest', file]);
      assert.notEqual(refused.status, 0, name);
      assert.match(refused.stderr, /journal|canonical|predecessor/i, `${name}: ${refused.stderr}`);
      assert.deepEqual(fs.readFileSync(journal), corrupted, `${name}: journal unchanged`);
      assert.deepEqual(liveState(world.data), liveBefore, `${name}: live state unchanged`);
    } finally { cleanup(world); }
  }
});

test('foreign binding drift blocks the entire multi-repository apply before writes', () => {
  const world = fixture();
  const foreign = addBoundRepository(world);
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    replaceDirectory(foreign.workspace);
    const before = treeState(world.data);
    const result = run(world, ['apply', '--manifest', file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /workspace identity changed/i);
    assert.deepEqual(treeState(world.data), before);
  } finally { cleanup(world); }
});

test('workspace and storage bindings are revalidated after every migration lock is held', async () => {
  for (const targetKind of ['foreign-workspace', 'pointer-parent']) {
    const world = fixture();
    let running;
    try {
      const foreign = addBoundRepository(world);
      const manifest = inventory(world);
      const file = saveManifest(world, manifest);
      const token = `locked-${targetKind}`;
      running = spawnMigration(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_LOCK_BARRIER: token,
      });
      const ready = path.join(world.data, 'locks', `.migration-lock-${token}.ready`);
      const resume = path.join(world.data, 'locks', `.migration-lock-${token}.resume`);
      waitForFile(ready);
      if (targetKind === 'foreign-workspace') replaceDirectory(foreign.workspace);
      else replaceDirectory(path.dirname(world.pointer));
      const selectedPointer = fs.readFileSync(world.pointer);
      const foreignPointer = fs.readFileSync(foreign.pointer);
      write(resume, 'resume\n');
      const result = await running.completed;
      assert.notEqual(result.code, 0, targetKind);
      assert.match(result.stderr, /identity changed|hierarchy identity changed/, targetKind);
      assert.deepEqual(fs.readFileSync(world.pointer), selectedPointer);
      assert.deepEqual(fs.readFileSync(foreign.pointer), foreignPointer);
      assert.equal(fs.existsSync(path.join(world.data, 'migrations', 'session-state')), false);
      assert.equal(fs.existsSync(path.join(world.data, 'locks', '.session-state-migration.lock')), false);
    } finally {
      if (running?.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGKILL');
      cleanup(world);
    }
  }
});

test('confirmations and work-kind overrides bind only to the entry that consumes them', () => {
  const world = fixture();
  const foreign = addBoundRepository(world, { status: 'active', workKind: null });
  try {
    const key = `${foreign.repo}/${foreign.task}`;
    const withoutInputs = inventory(world);
    const foreignWithout = withoutInputs.entries.find((entry) => entry.repo_id === foreign.repo);
    assert.equal(foreignWithout.action, 'manual');
    assert.equal(foreignWithout.reason, 'explicit_work_kind_required');

    const applicable = inventory(world, ['--confirm-inactive', key, '--work-kind', `${key}=investigation`]);
    const foreignEntry = applicable.entries.find((entry) => entry.repo_id === foreign.repo);
    assert.equal(foreignEntry.action, 'migrate_to_paused');
    assert.equal(foreignEntry.metadata.work_kind, 'investigation');

    const unused = run(world, ['inventory', '--confirm-inactive', `${world.repo}/${world.task}`]);
    assert.equal(unused.status, 0);
    const unusedManifest = JSON.parse(unused.stdout);
    assert.ok(unusedManifest.issues.includes(`unused_inactive_confirmation:${world.repo}/${world.task}`));
    const unusedFile = saveManifest(world, unusedManifest);
    const rejected = run(world, ['apply', '--manifest', unusedFile]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /unresolved issues/);

    for (const [kind, issue] of [
      ['implementation', 'redundant_work_kind_override'],
      ['investigation', 'conflicting_work_kind_override'],
    ]) {
      const selectedKey = `${world.repo}/${world.task}`;
      const result = run(world, ['inventory', '--work-kind', `${selectedKey}=${kind}`]);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(JSON.parse(result.stdout).issues.includes(`${issue}:${selectedKey}`));
    }
  } finally { cleanup(world); }
});

test('symlink and hardlink inputs fail closed as manual entries', { skip: process.platform === 'win32' }, () => {
  const symlinkWorld = fixture();
  const hardlinkWorld = fixture();
  try {
    const realPointer = `${symlinkWorld.pointer}.real`;
    fs.renameSync(symlinkWorld.pointer, realPointer);
    fs.symlinkSync(realPointer, symlinkWorld.pointer);
    const symlinkManifest = inventory(symlinkWorld);
    assert.equal(symlinkManifest.entries.find((entry) => entry.repo_id === REPO).action, 'manual');

    const sessionFile = path.join(hardlinkWorld.sessionDir, 'session.json');
    fs.linkSync(sessionFile, path.join(hardlinkWorld.sessionDir, 'session-hardlink.json'));
    const hardlinkManifest = inventory(hardlinkWorld);
    const pointed = hardlinkManifest.entries.find((entry) => entry.task_id === TASK);
    assert.equal(pointed.action, 'manual');
    assert.match(pointed.reason, /Hard-linked/);
  } finally {
    cleanup(symlinkWorld);
    cleanup(hardlinkWorld);
  }
});

test('wide empty-directory and deep session trees fail inventory deterministically without writes', () => {
  for (const kind of ['wide', 'deep']) {
    const world = fixture();
    try {
      if (kind === 'wide') {
        const directory = path.join(world.sessionDir, 'wide');
        mkdirp(directory);
        for (let index = 0; index < 4_100; index += 1) {
          fs.mkdirSync(path.join(directory, `d-${String(index).padStart(4, '0')}`));
        }
      } else {
        let directory = world.sessionDir;
        for (let depth = 0; depth < 66; depth += 1) {
          directory = path.join(directory, `d${depth}`);
          fs.mkdirSync(directory);
        }
      }
      const before = treeState(world.data);
      const result = run(world, ['inventory']);
      assert.notEqual(result.status, 0, kind);
      assert.match(result.stderr, /maximum (?:entry count|depth)/i, kind);
      assert.deepEqual(treeState(world.data), before, `${kind} inventory is read-only`);
    } finally { cleanup(world); }
  }
});

test('inventory entry and aggregate tree-record budgets reject over-limit roots without writes', () => {
  const entryWorld = fixture();
  const aggregateWorld = fixture();
  try {
    const bulk = path.join(entryWorld.data, 'repos', 'bulk-repo', 'sessions');
    mkdirp(bulk);
    for (let index = 0; index < 4_095; index += 1) {
      fs.mkdirSync(path.join(bulk, `task-${String(index).padStart(4, '0')}`));
    }
    const source = `import(${JSON.stringify(pathToFileURL(SCRIPT).href)})`
      + `.then((migration) => migration.inventoryMigration({ workspace: ${JSON.stringify(entryWorld.workspace)} }))`
      + `.then((manifest) => process.stdout.write(String(manifest.entries.length)))`
      + `.catch((error) => { process.stderr.write(error.message); process.exitCode = 1; });`;
    const boundary = spawnSync(process.execPath, ['-e', source], {
      env: entryWorld.env,
      encoding: 'utf8',
    });
    assert.equal(boundary.status, 0, boundary.stderr);
    assert.equal(boundary.stdout, '4096');
    fs.mkdirSync(path.join(bulk, 'task-over-limit'));
    const beforePointer = fs.readFileSync(entryWorld.pointer);
    const overLimit = spawnSync(process.execPath, ['-e', source], {
      env: entryWorld.env,
      encoding: 'utf8',
    });
    assert.notEqual(overLimit.status, 0);
    assert.match(overLimit.stderr, /maximum entry count 4096/);
    assert.deepEqual(fs.readFileSync(entryWorld.pointer), beforePointer);
    assert.equal(fs.existsSync(path.join(entryWorld.data, 'migrations')), false);

    const aggregateRoot = path.join(aggregateWorld.data, 'repos', 'aggregate-repo', 'sessions');
    for (const task of ['A', 'B']) {
      const directory = path.join(aggregateRoot, task);
      mkdirp(directory);
      for (let index = 0; index < 4_095; index += 1) {
        fs.mkdirSync(path.join(directory, `d-${String(index).padStart(4, '0')}`));
      }
    }
    const aggregateBefore = fs.readFileSync(aggregateWorld.pointer);
    const aggregate = run(aggregateWorld, ['inventory']);
    assert.notEqual(aggregate.status, 0);
    assert.match(aggregate.stderr, /maximum aggregate tree records 8192/);
    assert.deepEqual(fs.readFileSync(aggregateWorld.pointer), aggregateBefore);
    assert.equal(fs.existsSync(path.join(aggregateWorld.data, 'migrations')), false);
  } finally {
    cleanup(entryWorld);
    cleanup(aggregateWorld);
  }
});

test('aggregate source bytes and free-space reservation fail before migration state changes', () => {
  const aggregateWorld = fixture();
  const spaceWorld = fixture();
  try {
    const foreignA = addBoundRepository(aggregateWorld, { repo: 'bytes-a', task: 'BYTES-A' });
    const foreignB = addBoundRepository(aggregateWorld, { repo: 'bytes-b', task: 'BYTES-B' });
    for (const directory of [aggregateWorld.sessionDir, foreignA.sessionDir, foreignB.sessionDir]) {
      write(path.join(directory, 'one-megabyte.bin'), Buffer.alloc(1024 * 1024, 0x5a));
    }
    const aggregateBefore = liveState(aggregateWorld.data);
    const aggregate = run(aggregateWorld, ['inventory'], {
      PHANTOM_TEST_MIGRATION_AGGREGATE_TREE_BYTES: String((2 * 1024 * 1024) + 16_384),
    });
    assert.notEqual(aggregate.status, 0);
    assert.match(aggregate.stderr, /maximum aggregate tree bytes/);
    assert.deepEqual(liveState(aggregateWorld.data), aggregateBefore);
    assert.equal(fs.existsSync(path.join(aggregateWorld.data, 'migrations')), false);

    const manifest = inventory(spaceWorld);
    const file = saveManifest(spaceWorld, manifest);
    const before = liveState(spaceWorld.data);
    const insufficient = run(spaceWorld, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_AVAILABLE_BYTES: '0',
    });
    assert.notEqual(insufficient.status, 0);
    assert.match(insufficient.stderr, /Insufficient free space/);
    assert.deepEqual(liveState(spaceWorld.data), before);
    assert.equal(fs.existsSync(path.join(spaceWorld.data, 'migrations')), false);
    assert.equal(fs.existsSync(path.join(spaceWorld.data, 'locks', '.session-state-migration.lock')), false);
  } finally {
    cleanup(aggregateWorld);
    cleanup(spaceWorld);
  }
});

test('atomic journal scratch reservation is enforced at the exact free-space boundary', () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const probe = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_AVAILABLE_BYTES: '0',
    });
    assert.notEqual(probe.status, 0);
    const match = /requires (\d+) bytes/.exec(probe.stderr);
    assert.ok(match, probe.stderr);
    const required = BigInt(match[1]);
    const atomicScratchBytes = 144n * 1024n;
    const scratchWithMargin = atomicScratchBytes + (atomicScratchBytes / 4n);
    const withoutAtomicScratch = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_AVAILABLE_BYTES: String(required - scratchWithMargin),
    });
    assert.notEqual(withoutAtomicScratch.status, 0);
    assert.match(withoutAtomicScratch.stderr, /Insufficient free space/);
    const oneByteShort = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_AVAILABLE_BYTES: String(required - 1n),
    });
    assert.notEqual(oneByteShort.status, 0);
    assert.match(oneByteShort.stderr, /Insufficient free space/);
    const exact = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_AVAILABLE_BYTES: String(required),
    });
    assert.equal(exact.status, 0, exact.stderr);
    assert.equal(JSON.parse(exact.stdout).status, 'verified');
  } finally { cleanup(world); }
});

test('pretty-serialized manifest and mutating-entry limits fail before state writes', async () => {
  const world = fixture({ status: 'paused' });
  const quarantineWorld = fixture();
  try {
    const migration = await import(`${pathToFileURL(SCRIPT).href}?bounds=${Date.now()}`);
    const base = inventory(world);
    let padding = Array(260_000).fill(0);
    for (let depth = 0; depth < 64; depth += 1) padding = [padding];
    const oversized = {
      ...base,
      entries: [...base.entries, {
        entry_id: 'manual-padding',
        repo_id: null,
        task_id: null,
        task_segment: null,
        pointer_relative: null,
        pointer: null,
        source_relative: null,
        source: null,
        metadata: null,
        action: 'manual',
        reason: 'size-boundary',
        padding,
      }],
    };
    assert.ok(Buffer.byteLength(canonicalJson(oversized)) < 32 * 1024 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(oversized, null, 2)) > 32 * 1024 * 1024);
    const before = treeState(world.data);
    assert.throws(
      () => migration.applyMigration({ workspace: world.workspace, manifest: oversized }),
      /maximum serialized size/,
    );
    assert.deepEqual(treeState(world.data), before);

    fs.rmSync(quarantineWorld.sessionDir, { recursive: true, force: true });
    write(quarantineWorld.pointer, '{malformed-selected\n');
    const quarantine = inventory(quarantineWorld);
    const template = mutationEntry(quarantine);
    const entries = [];
    for (let index = 0; index < 65; index += 1) {
      const repo = `bounded-repo-${String(index).padStart(2, '0')}`;
      entries.push({
        ...template,
        entry_id: `${repo}/@pointer`,
        repo_id: repo,
        pointer_relative: `state/current-session/${repo}.json`,
        quarantine_relative: `quarantine/pointers/${repo}.json`,
        workspace_binding: { ...template.workspace_binding, repo_id: repo },
      });
    }
    const overMutating = rebindManifest({ ...quarantine, entries });
    const file = saveManifest(quarantineWorld, overMutating);
    const mutatingBefore = treeState(quarantineWorld.data);
    const rejected = run(quarantineWorld, ['apply', '--manifest', file]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /maximum mutating entry count 64/);
    assert.deepEqual(treeState(quarantineWorld.data), mutatingBefore);
  } finally {
    cleanup(world);
    cleanup(quarantineWorld);
  }
});

test('tree generation fences reject child add, remove, and rename before migration mutation', async () => {
  const inventoryWorld = fixture();
  try {
    const token = 'inventory-child-add';
    const running = spawnMigration(inventoryWorld, ['inventory'], {
      PHANTOM_TEST_TREE_SNAPSHOT_BARRIER: token,
    });
    const ready = path.join(inventoryWorld.data, 'locks', `.tree-snapshot-${token}.ready`);
    const resume = path.join(inventoryWorld.data, 'locks', `.tree-snapshot-${token}.resume`);
    waitForFile(ready);
    write(path.join(inventoryWorld.sessionDir, 'added-during-snapshot.json'), '{}\n');
    write(resume, 'resume\n');
    const result = await running.completed;
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /changed while it was inventoried/i);
    assert.equal(JSON.parse(fs.readFileSync(inventoryWorld.pointer, 'utf8')).schema_version, 1);
  } finally { cleanup(inventoryWorld); }

  for (const operation of ['add', 'remove', 'rename']) {
    const world = fixture();
    try {
      const raceFile = path.join(world.sessionDir, 'race.json');
      if (operation !== 'add') write(raceFile, '{}\n');
      const manifest = inventory(world);
      const file = saveManifest(world, manifest);
      const token = `apply-child-${operation}`;
      const running = spawnMigration(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_TREE_SNAPSHOT_BARRIER: token,
      });
      const ready = path.join(world.data, 'locks', `.tree-snapshot-${token}.ready`);
      const resume = path.join(world.data, 'locks', `.tree-snapshot-${token}.resume`);
      waitForFile(ready);
      if (operation === 'add') write(path.join(world.sessionDir, 'race-added.json'), '{}\n');
      else if (operation === 'remove') fs.unlinkSync(raceFile);
      else fs.renameSync(raceFile, path.join(world.sessionDir, 'race-renamed.json'));
      write(resume, 'resume\n');
      const result = await running.completed;
      assert.notEqual(result.code, 0, operation);
      assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 1);
      assert.equal(fs.existsSync(path.join(world.data, 'migrations', 'session-state')), false, operation);
    } finally { cleanup(world); }
  }
});

test('tree snapshots recheck files already read while later siblings are traversed', async () => {
  const world = fixture();
  let running;
  try {
    const token = 'early-file-change';
    running = spawnMigration(world, ['inventory'], {
      PHANTOM_TEST_TREE_FILE_RECHECK_BARRIER: token,
    });
    const ready = path.join(world.data, 'locks', `.tree-file-recheck-${token}.ready`);
    const resume = path.join(world.data, 'locks', `.tree-file-recheck-${token}.resume`);
    waitForFile(ready);
    const intentFile = path.join(world.sessionDir, 'intent.json');
    fs.appendFileSync(intentFile, ' \n');
    write(resume, 'resume\n');
    const result = await running.completed;
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /file changed while its tree was inventoried/i);
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 1);
    assert.equal(fs.existsSync(path.join(world.data, 'migrations')), false);
  } finally {
    if (running?.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGKILL');
    cleanup(world);
  }
});

test('session migration C+D: concurrent file growth beyond the read limit fails closed', async () => {
  const world = fixture();
  let running;
  try {
    const token = 'bounded-growth';
    running = spawnMigration(world, ['inventory'], {
      PHANTOM_TEST_TREE_FILE_RECHECK_BARRIER: token,
    });
    const ready = path.join(world.data, 'locks', `.tree-file-recheck-${token}.ready`);
    const resume = path.join(world.data, 'locks', `.tree-file-recheck-${token}.resume`);
    waitForFile(ready);
    fs.appendFileSync(
      path.join(world.sessionDir, 'intent.json'),
      Buffer.alloc((1024 * 1024) + 1, 0x20),
    );
    write(resume, 'resume\n');
    const result = await running.completed;
    assert.equal(result.code, 0, result.stderr);
    const manifest = JSON.parse(result.stdout);
    const entry = manifest.entries.find((candidate) => candidate.task_id === world.task);
    assert.equal(entry.action, 'manual');
    assert.match(entry.reason, /Input exceeds 1048576 bytes|Input file is oversized/);
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 1);
    assert.equal(fs.existsSync(path.join(world.data, 'migrations')), false);
  } finally {
    if (running?.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGKILL');
    cleanup(world);
  }
});

test('session migration C+D: byte-identical path generation replacement fails closed', async () => {
  const world = fixture();
  let running;
  try {
    const token = 'generation-swap';
    running = spawnMigration(world, ['inventory'], {
      PHANTOM_TEST_TREE_FILE_RECHECK_BARRIER: token,
    });
    const ready = path.join(world.data, 'locks', `.tree-file-recheck-${token}.ready`);
    const resume = path.join(world.data, 'locks', `.tree-file-recheck-${token}.resume`);
    waitForFile(ready);
    const intentFile = path.join(world.sessionDir, 'intent.json');
    const original = path.join(world.root, 'generation-swap-original.json');
    fs.renameSync(intentFile, original);
    fs.copyFileSync(original, intentFile, fs.constants.COPYFILE_EXCL);
    assert.deepEqual(fs.readFileSync(intentFile), fs.readFileSync(original));
    assert.notEqual(fs.lstatSync(intentFile).ino, fs.lstatSync(original).ino);
    write(resume, 'resume\n');
    const result = await running.completed;
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /file changed while its tree was inventoried/i);
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 1);
    assert.equal(fs.existsSync(path.join(world.data, 'migrations')), false);
  } finally {
    if (running?.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGKILL');
    cleanup(world);
  }
});

test('bounded backup and archive verification rejects adversarial wide and deep trees', () => {
  for (const kind of ['wide-backup', 'deep-archive']) {
    const world = fixture();
    try {
      const manifest = inventory(world);
      const migrated = apply(world, manifest);
      assert.equal(migrated.result.status, 0, migrated.result.stderr);
      const entry = mutationEntry(manifest);
      const tx = path.join(world.data, 'migrations', 'session-state', manifest.migration_id.slice(7));
      const target = kind === 'wide-backup'
        ? path.join(tx, 'backups', 'trees', entry.source.tree_digest.slice(7), 'source')
        : path.join(tx, 'history', 'repos', world.repo, 'sessions', world.task);
      fs.chmodSync(target, 0o700);
      if (kind === 'wide-backup') {
        const wide = path.join(target, 'wide');
        fs.mkdirSync(wide);
        for (let index = 0; index < 4_100; index += 1) {
          fs.mkdirSync(path.join(wide, `d-${String(index).padStart(4, '0')}`));
        }
      } else {
        let directory = target;
        for (let depth = 0; depth < 66; depth += 1) {
          directory = path.join(directory, `d${depth}`);
          fs.mkdirSync(directory);
        }
      }
      const verified = run(world, ['verify', '--manifest', migrated.file]);
      assert.equal(verified.status, 1, kind);
      assert.match(
        JSON.parse(verified.stdout).errors.join(' '),
        /maximum (?:entry count|depth)|Legacy archive differs/i,
      );
      const rollback = run(world, ['rollback', '--manifest', migrated.file]);
      assert.equal(rollback.status, 1, kind);
      assert.equal(JSON.parse(rollback.stdout).status, 'human_decision_required');
    } finally { cleanup(world); }
  }
});

test('normalization or case-fold collisions block the manifest when the filesystem supports both names', (context) => {
  const world = fixture();
  try {
    const upper = path.join(world.data, 'repos', REPO, 'sessions', 'CASE-TASK');
    const lower = path.join(world.data, 'repos', REPO, 'sessions', 'case-task');
    mkdirp(upper);
    mkdirp(lower);
    const names = fs.readdirSync(path.dirname(upper));
    if (!names.includes('CASE-TASK') || !names.includes('case-task')) {
      context.skip('fixture filesystem is case-insensitive');
      return;
    }
    const result = run(world, ['inventory']);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(result.stdout);
    assert.match(manifest.issues.join(' '), /collision/i);
    const blocked = apply(world, manifest);
    assert.notEqual(blocked.result.status, 0);
    assert.match(blocked.result.stderr, /unresolved issues/i);
  } finally { cleanup(world); }
});

test('apply rejects source drift and lock contention before changing session state', () => {
  const drift = fixture();
  const locked = fixture();
  try {
    const driftManifest = inventory(drift);
    writeJson(path.join(drift.sessionDir, 'late.json'), { changed: true });
    const driftApply = apply(drift, driftManifest);
    assert.notEqual(driftApply.result.status, 0);
    assert.match(driftApply.result.stderr, /drifted after inventory/);
    assert.equal(JSON.parse(fs.readFileSync(drift.pointer, 'utf8')).schema_version, 1);

    const lockManifest = inventory(locked);
    write(path.join(locked.data, 'locks', '.session-state-migration.lock'), '{"pid":1}\n');
    const lockApply = apply(locked, lockManifest);
    assert.notEqual(lockApply.result.status, 0);
    assert.match(lockApply.result.stderr, /already held/);
    assert.equal(JSON.parse(fs.readFileSync(locked.pointer, 'utf8')).schema_version, 1);
  } finally {
    cleanup(drift);
    cleanup(locked);
  }
});

test('editable manifest paths and data roots are never trusted for mutation', () => {
  const pathWorld = fixture();
  const rootWorld = fixture();
  try {
    const pathManifest = inventory(pathWorld);
    mutationEntry(pathManifest).source_relative = '../outside';
    const pathFile = saveManifest(pathWorld, pathManifest);
    const pathApply = run(pathWorld, ['apply', '--manifest', pathFile]);
    assert.notEqual(pathApply.status, 0);
    assert.match(pathApply.stderr, /digest does not match/);
    assert.equal(JSON.parse(fs.readFileSync(pathWorld.pointer, 'utf8')).schema_version, 1);

    const rootManifest = inventory(rootWorld);
    rootManifest.data_root = path.join(rootWorld.root, 'attacker-selected-root');
    const rebound = rebindManifest(rootManifest);
    const rootFile = saveManifest(rootWorld, rebound);
    const rootApply = run(rootWorld, ['apply', '--manifest', rootFile]);
    assert.notEqual(rootApply.status, 0);
    assert.match(rootApply.stderr, /data[- ]root (?:bindings differ|does not match)/);
    assert.equal(JSON.parse(fs.readFileSync(rootWorld.pointer, 'utf8')).schema_version, 1);
  } finally {
    cleanup(pathWorld);
    cleanup(rootWorld);
  }
});

test('relative PHANTOM_DATA remains bound to the originally selected workspace during apply', () => {
  const world = fixture({ relativeData: true });
  try {
    const manifest = inventory(world);
    assert.equal(manifest.data_root, world.data);
    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 2);
  } finally { cleanup(world); }
});

test('symlinked migrations, locks, and rollback output parents cannot redirect writes outside the data root', { skip: process.platform === 'win32' }, () => {
  const migrationsWorld = fixture();
  const locksWorld = fixture();
  const rollbackWorld = fixture();
  try {
    const migrationsManifest = inventory(migrationsWorld);
    const migrationsOutside = path.join(migrationsWorld.root, 'outside-migrations');
    mkdirp(migrationsOutside);
    fs.symlinkSync(migrationsOutside, path.join(migrationsWorld.data, 'migrations'), 'dir');
    const migrationsApply = apply(migrationsWorld, migrationsManifest);
    assert.notEqual(migrationsApply.result.status, 0);
    assert.match(migrationsApply.result.stderr, /output parent|Symbolic links/i);
    assert.deepEqual(treeState(migrationsOutside), []);
    assert.equal(JSON.parse(fs.readFileSync(migrationsWorld.pointer, 'utf8')).schema_version, 1);

    const locksManifest = inventory(locksWorld);
    const locksOutside = path.join(locksWorld.root, 'outside-locks');
    mkdirp(locksOutside);
    fs.symlinkSync(locksOutside, path.join(locksWorld.data, 'locks'), 'dir');
    const locksApply = apply(locksWorld, locksManifest);
    assert.notEqual(locksApply.result.status, 0);
    assert.match(locksApply.result.stderr, /output parent|Symbolic links/i);
    assert.deepEqual(treeState(locksOutside), []);
    assert.equal(JSON.parse(fs.readFileSync(locksWorld.pointer, 'utf8')).schema_version, 1);

    const rollbackManifest = inventory(rollbackWorld);
    const migrated = apply(rollbackWorld, rollbackManifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const rollbackOutside = path.join(rollbackWorld.root, 'outside-rollback');
    mkdirp(rollbackOutside);
    const tx = path.join(
      rollbackWorld.data, 'migrations', 'session-state', rollbackManifest.migration_id.slice(7),
    );
    fs.symlinkSync(rollbackOutside, path.join(tx, 'rollback'), 'dir');
    const rollback = run(rollbackWorld, ['rollback', '--manifest', migrated.file]);
    assert.notEqual(rollback.status, 0);
    assert.match(rollback.stderr, /output parent|Symbolic links/i);
    assert.deepEqual(treeState(rollbackOutside), []);
    assert.equal(JSON.parse(fs.readFileSync(rollbackWorld.pointer, 'utf8')).schema_version, 2);
  } finally {
    cleanup(migrationsWorld);
    cleanup(locksWorld);
    cleanup(rollbackWorld);
  }
});

test('backup bytes are exact, restrictive, and independent copies', () => {
  const world = fixture();
  try {
    const originalPointer = fs.readFileSync(world.pointer);
    const originalSession = fs.readFileSync(path.join(world.sessionDir, 'session.json'));
    const manifest = inventory(world);
    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const tx = path.join(world.data, 'migrations', 'session-state', manifest.migration_id.slice(7));
    const entry = mutationEntry(manifest);
    const pointerBackup = path.join(tx, 'backups', 'files', entry.pointer.digest.slice(7), 'pointer.json');
    const sessionRecord = entry.source.records.find((record) => record.path === 'session.json');
    const treeBackup = path.join(tx, 'backups', 'trees', entry.source.tree_digest.slice(7), 'source', 'session.json');
    assert.deepEqual(fs.readFileSync(pointerBackup), originalPointer);
    assert.deepEqual(fs.readFileSync(treeBackup), originalSession);
    assert.equal(fs.statSync(pointerBackup).nlink, 1);
    assert.equal(fs.statSync(treeBackup).nlink, 1);
    assert.equal(fs.statSync(pointerBackup).mode & 0o377, 0);
    assert.equal(fs.statSync(treeBackup).mode & 0o377, 0);
    assert.equal(sessionRecord.digest, digest(originalSession));
  } finally { cleanup(world); }
});

test('writable pointer backups fail closed on apply resume, verification, and rollback', () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const entry = mutationEntry(manifest);
    const tx = path.join(world.data, 'migrations', 'session-state', manifest.migration_id.slice(7));
    const pointerBackup = path.join(tx, 'backups', 'files', entry.pointer.digest.slice(7), 'pointer.json');
    fs.chmodSync(pointerBackup, 0o600);
    const tamperedState = liveState(world.data);

    const resumed = run(world, ['apply', '--manifest', migrated.file]);
    assert.notEqual(resumed.status, 0);
    assert.match(resumed.stderr, /Pointer backup (?:integrity failed|differs)/);

    const verified = run(world, ['verify', '--manifest', migrated.file]);
    assert.equal(verified.status, 1, verified.stderr);
    const verification = JSON.parse(verified.stdout);
    assert.equal(verification.status, 'failed');
    assert.match(verification.errors.join(' '), /Pointer backup differs/);

    const rollback = run(world, ['rollback', '--manifest', migrated.file]);
    assert.equal(rollback.status, 1, rollback.stderr);
    const refused = JSON.parse(rollback.stdout);
    assert.equal(refused.status, 'human_decision_required');
    assert.match(refused.errors.join(' '), /Pointer backup differs/);
    assert.deepEqual(liveState(world.data), tamperedState);
    assert.equal(fs.existsSync(path.join(world.data, 'locks', '.session-state-migration.lock')), true);
  } finally { cleanup(world); }
});

test('pointer-last crash is resumable and repeated apply is idempotent', () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const crashed = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_successor',
    });
    assert.notEqual(crashed.status, 0);
    assert.match(crashed.stderr, /Injected migration crash/);
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 1, 'pointer remains v1');
    const recovered = run(world, ['apply', '--manifest', file]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).status, 'verified');
    const afterFirst = treeState(world.data);
    const repeated = run(world, ['apply', '--manifest', file]);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(JSON.parse(repeated.stdout).status, 'verified');
    assert.deepEqual(treeState(world.data), afterFirst);
  } finally { cleanup(world); }
});

test('durable artifact publication retries prepare, two-link, and parent-fsync crash windows without debris', () => {
  for (const crashPoint of [
    'publication_transaction-manifest_before_prepared_install',
    'publication_transaction-manifest_after_prepared_install',
    'publication_transaction-manifest_before_published_parent_fsync',
  ]) {
    const world = fixture();
    try {
      const manifest = inventory(world);
      const file = saveManifest(world, manifest);
      const crashed = run(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_CRASH_AT: crashPoint,
      });
      assert.notEqual(crashed.status, 0, crashPoint);
      assert.match(crashed.stderr, /Injected migration crash/);
      if (crashPoint.endsWith('after_prepared_install')) {
        const transaction = transactionRoot(world, manifest);
        const linked = fs.readdirSync(transaction)
          .filter((name) => name.startsWith('.phantom-publish-v1-'))
          .map((name) => fs.statSync(path.join(transaction, name)).nlink);
        assert.deepEqual(linked, [2, 2]);
      }
      const recovered = run(world, ['apply', '--manifest', file]);
      assert.equal(recovered.status, 0, `${crashPoint}: ${recovered.stderr}`);
      assert.equal(JSON.parse(recovered.stdout).status, 'verified');
      assert.deepEqual(durablePublicationDebris(world.data), [], crashPoint);
    } finally { cleanup(world); }
  }
});

test('durable typed artifacts recover exact after-link generations and reach terminal apply', () => {
  for (const operation of [
    'transaction-manifest',
    'transaction-prepared-receipt',
    'tree-backup',
    'pointer-backup',
    'successor-session',
    'successor-intent',
    'pointer-stage',
  ]) {
    const world = fixture();
    try {
      const manifest = inventory(world);
      const file = saveManifest(world, manifest);
      const crashPoint = `publication_${operation}_after_absent_link`;
      const crashed = run(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_CRASH_AT: crashPoint,
      });
      assert.notEqual(crashed.status, 0, crashPoint);
      assert.match(crashed.stderr, /after_absent_link/, crashed.stderr);
      const linked = publicationLink(world.data);
      if (operation === 'transaction-prepared-receipt') {
        const lock = JSON.parse(fs.readFileSync(
          path.join(world.data, 'locks', '.session-state-migration.lock'),
          'utf8',
        ));
        const receipt = JSON.parse(linked.bytes.toString('utf8'));
        assert.deepEqual(receipt.global_lock, {
          token: lock.token,
          claim_epoch: lock.claim_epoch,
          claim_digest: lock.claim_digest,
        });
      }
      const recovered = run(world, ['apply', '--manifest', file]);
      assert.equal(recovered.status, 0, `${crashPoint}: ${recovered.stderr}`);
      assert.equal(JSON.parse(recovered.stdout).status, 'verified');
      const stableFile = fileWithIdentity(world.data, linked);
      assert.ok(stableFile, `${operation}: published physical identity must survive retry`);
      assert.deepEqual(fs.readFileSync(stableFile), linked.bytes, operation);
      assert.equal(fs.statSync(stableFile).nlink, 1, operation);
      assert.deepEqual(durablePublicationDebris(world.data), [], operation);
    } finally { cleanup(world); }
  }
});

test('prepared transaction receipt recovers module-owned stage and prepared crash windows with G0 binding', () => {
  for (const step of ['before_prepared_install', 'after_prepared_install']) {
    const world = fixture();
    try {
      const manifest = inventory(world);
      const file = saveManifest(world, manifest);
      const crashPoint = `publication_transaction-prepared-receipt_${step}`;
      const crashed = run(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_CRASH_AT: crashPoint,
      });
      assert.notEqual(crashed.status, 0, crashPoint);
      assert.match(crashed.stderr, new RegExp(step), crashed.stderr);
      const lock = JSON.parse(fs.readFileSync(
        path.join(world.data, 'locks', '.session-state-migration.lock'),
        'utf8',
      ));
      const preparedBefore = step === 'after_prepared_install' ? publicationLink(world.data) : null;
      const recovered = run(world, ['apply', '--manifest', file]);
      assert.equal(recovered.status, 0, `${crashPoint}: ${recovered.stderr}`);
      assert.equal(JSON.parse(recovered.stdout).status, 'verified');
      const receiptFile = path.join(transactionRoot(world, manifest), 'transaction-prepared.json');
      const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
      assert.deepEqual(receipt.global_lock, {
        token: lock.token,
        claim_epoch: lock.claim_epoch,
        claim_digest: lock.claim_digest,
      });
      if (preparedBefore) {
        const metadata = fs.statSync(receiptFile);
        assert.equal(metadata.dev, preparedBefore.device);
        assert.equal(metadata.ino, preparedBefore.inode);
        assert.deepEqual(fs.readFileSync(receiptFile), preparedBefore.bytes);
      }
      assert.deepEqual(durablePublicationDebris(world.data), [], step);
    } finally { cleanup(world); }
  }
});

test('durable absent-target publication loses a race without overwriting the winner', () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const crashed = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'publication_transaction-manifest_before_absent_link',
    });
    assert.notEqual(crashed.status, 0);
    const target = path.join(transactionRoot(world, manifest), 'manifest.json');
    const winner = Buffer.from('{"racing_writer":true}\n');
    fs.writeFileSync(target, winner, { flag: 'wx', mode: 0o600 });
    const refused = run(world, ['apply', '--manifest', file]);
    assert.notEqual(refused.status, 0);
    assert.deepEqual(fs.readFileSync(target), winner);
  } finally { cleanup(world); }
});

test('write-ahead identities resume unmodified successor and pointer rename crashes', { skip: process.platform === 'win32' }, () => {
  for (const crashPoint of [
    'after_successor_rename_before_commit',
    'after_pointer_rename_before_commit',
  ]) {
    const world = fixture();
    try {
      const manifest = inventory(world);
      const file = saveManifest(world, manifest);
      const killed = run(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_KILL_AT: crashPoint,
      });
      assert.equal(killed.signal, 'SIGKILL', crashPoint);
      const pointerVersion = JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version;
      assert.equal(pointerVersion, crashPoint.startsWith('after_pointer') ? 2 : 1, crashPoint);
      const recovered = run(world, ['apply', '--manifest', file]);
      assert.equal(recovered.status, 0, `${crashPoint}: ${recovered.stderr}`);
      assert.equal(JSON.parse(recovered.stdout).status, 'verified');
    } finally { cleanup(world); }
  }
});

test('write-ahead identities reject byte-identical replacements after uncommitted renames', { skip: process.platform === 'win32' }, () => {
  const scenarios = [
    ['after_successor_rename_before_commit', 'successor'],
    ['after_pointer_rename_before_commit', 'pointer'],
  ];
  for (const [crashPoint, targetKind] of scenarios) {
    for (const operation of ['apply', 'verify', 'rollback']) {
      const world = fixture();
      try {
        const manifest = inventory(world);
        const file = saveManifest(world, manifest);
        const killed = run(world, ['apply', '--manifest', file], {
          PHANTOM_TEST_MIGRATION_KILL_AT: crashPoint,
        });
        assert.equal(killed.signal, 'SIGKILL', `${crashPoint}/${operation}`);
        const target = targetKind === 'successor' ? world.sessionDir : world.pointer;
        if (targetKind === 'successor') replaceDirectory(target);
        else replaceFile(target);
        const replacementInode = fs.lstatSync(target).ino;
        const tx = path.join(world.data, 'migrations', 'session-state', manifest.migration_id.slice(7));
        const journal = path.join(tx, 'journals', `${world.repo}.jsonl`);
        const journalBefore = fs.readFileSync(journal);

        const result = run(world, [operation, '--manifest', file]);
        assert.notEqual(result.status, 0, `${crashPoint}/${operation}`);
        assert.equal(fs.lstatSync(target).ino, replacementInode, `${crashPoint}/${operation} target unchanged`);
        assert.deepEqual(fs.readFileSync(journal), journalBefore, `${crashPoint}/${operation} journal unchanged`);
      } finally { cleanup(world); }
    }
  }
});

test('wrong-identity and extra journal events block apply and rollback recovery without live writes', () => {
  const applyWorld = fixture();
  const rollbackWorld = fixture();
  try {
    const applyManifest = inventory(applyWorld);
    const applyFile = saveManifest(applyWorld, applyManifest);
    const partialApply = run(applyWorld, ['apply', '--manifest', applyFile], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_successor',
    });
    assert.notEqual(partialApply.status, 0);
    const applyJournal = path.join(transactionRoot(applyWorld, applyManifest), 'journals', `${REPO}.jsonl`);
    rewriteJournal(applyJournal, (events) => {
      events.push({
        ...events.at(-1),
        entry_id: 'other-repo/EXTRA',
        event_type: 'extra_event',
        payload: {},
      });
    });
    const applyJournalBytes = fs.readFileSync(applyJournal);
    const applyLive = liveState(applyWorld.data);
    const refusedApply = run(applyWorld, ['apply', '--manifest', applyFile]);
    assert.notEqual(refusedApply.status, 0);
    assert.match(refusedApply.stderr, /journal identity differs|journal event type is unsupported/i);
    assert.deepEqual(fs.readFileSync(applyJournal), applyJournalBytes);
    assert.deepEqual(liveState(applyWorld.data), applyLive);

    const rollbackManifest = inventory(rollbackWorld);
    const migrated = apply(rollbackWorld, rollbackManifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const partialRollback = run(rollbackWorld, ['rollback', '--manifest', migrated.file], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_rollback_successor_parked',
    });
    assert.notEqual(partialRollback.status, 0);
    const rollbackJournal = path.join(
      transactionRoot(rollbackWorld, rollbackManifest),
      'journals',
      `${REPO}.jsonl`,
    );
    rewriteJournal(rollbackJournal, (events) => {
      events.push({
        ...events.at(-1),
        migration_id: `sha256:${'0'.repeat(64)}`,
        event_type: 'rollback_pointer_prepared',
      });
    });
    const rollbackJournalBytes = fs.readFileSync(rollbackJournal);
    const rollbackLive = liveState(rollbackWorld.data);
    const refusedRollback = run(rollbackWorld, ['rollback', '--manifest', migrated.file]);
    assert.equal(refusedRollback.status, 1, refusedRollback.stderr);
    assert.equal(JSON.parse(refusedRollback.stdout).status, 'human_decision_required');
    assert.deepEqual(fs.readFileSync(rollbackJournal), rollbackJournalBytes);
    assert.deepEqual(liveState(rollbackWorld.data), rollbackLive);
  } finally {
    cleanup(applyWorld);
    cleanup(rollbackWorld);
  }
});

test('post-pointer SIGKILL blocks runtime state and resumes only through the exact migrator', { skip: process.platform === 'win32' }, () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const killed = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_KILL_AT: 'after_pointer',
    });
    assert.equal(killed.signal, 'SIGKILL');
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 2);
    const globalLock = path.join(world.data, 'locks', '.session-state-migration.lock');
    const repoLock = path.join(world.data, 'locks', `${REPO}.lock`);
    const globalBytes = fs.readFileSync(globalLock);
    const repoBytes = fs.readFileSync(repoLock);
    const successorState = treeState(world.sessionDir);
    for (const command of [['status'], ['resume']]) {
      const blocked = runState(world, command);
      assert.notEqual(blocked.status, 0);
      assert.match(blocked.stderr, /session-state migration.*runtime state access is blocked/i);
    }
    assert.deepEqual(fs.readFileSync(globalLock), globalBytes);
    assert.deepEqual(fs.readFileSync(repoLock), repoBytes);
    assert.deepEqual(treeState(world.sessionDir), successorState);
    const recovered = run(world, ['apply', '--manifest', file]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).status, 'verified');
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 2);
    assert.equal(fs.existsSync(globalLock), false);
    assert.equal(fs.existsSync(repoLock), false);
  } finally { cleanup(world); }
});

test('ordinary partial apply and rollback errors retain recovery barriers until exact completion', () => {
  for (const crashPoint of ['after_successor', 'after_pointer']) {
    const world = fixture();
    try {
      const manifest = inventory(world);
      const file = saveManifest(world, manifest);
      const crashed = run(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_CRASH_AT: crashPoint,
      });
      assert.notEqual(crashed.status, 0);
      for (const lock of ['.session-state-migration.lock', `${REPO}.lock`]) {
        const value = JSON.parse(fs.readFileSync(path.join(world.data, 'locks', lock), 'utf8'));
        assert.equal(value.state, 'recovery_required');
      }
      const blocked = runState(world, ['status']);
      assert.notEqual(blocked.status, 0);
      assert.match(blocked.stderr, /migration.*blocked/i);
      const doctor = runDoctor(world);
      assert.notEqual(doctor.status, 0);
      assert.match(`${doctor.stdout}\n${doctor.stderr}`, /migration|recovery/i);
      const resumed = run(world, ['apply', '--manifest', file]);
      assert.equal(resumed.status, 0, resumed.stderr);
      assert.equal(JSON.parse(resumed.stdout).status, 'verified');
      assert.equal(fs.existsSync(path.join(world.data, 'locks', '.session-state-migration.lock')), false);
    } finally { cleanup(world); }
  }

  const rollbackWorld = fixture();
  try {
    const migrated = apply(rollbackWorld, inventory(rollbackWorld));
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const crashed = run(rollbackWorld, ['rollback', '--manifest', migrated.file], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_rollback_successor_parked',
    });
    assert.notEqual(crashed.status, 0);
    assert.equal(JSON.parse(fs.readFileSync(
      path.join(rollbackWorld.data, 'locks', '.session-state-migration.lock'),
      'utf8',
    )).state, 'recovery_required');
    assert.notEqual(runState(rollbackWorld, ['resume']).status, 0);
    assert.notEqual(runDoctor(rollbackWorld).status, 0);
    const resumed = run(rollbackWorld, ['rollback', '--manifest', migrated.file]);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).status, 'rolled_back');
    assert.equal(fs.existsSync(path.join(rollbackWorld.data, 'locks', '.session-state-migration.lock')), false);
  } finally { cleanup(rollbackWorld); }
});

test('worker-thread mutation is rejected before locking and termination cannot strand a lock', async () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    for (const method of ['applyMigration', 'verifyMigration', 'rollbackMigration']) {
      const deniedWorker = spawnWorkerMigration(world, method, file, {
        PHANTOM_TEST_MIGRATION_LOCK_BARRIER: 'must-not-be-reached',
      });
      const denied = await deniedWorker.completed;
      assert.equal(denied.ok, false, method);
      assert.match(denied.error, /require the process main thread/i, method);
      await deniedWorker.worker.terminate();
      for (const name of [
        '.session-state-migration.lock',
        '.session-state-migration.recovery.lock',
        `${REPO}.lock`,
        `${REPO}.lock.recovery`,
      ]) {
        assert.equal(fs.existsSync(path.join(world.data, 'locks', name)), false, `${method}: ${name}`);
      }
    }
    assert.equal(
      fs.existsSync(path.join(world.data, 'locks', '.migration-lock-must-not-be-reached.ready')),
      false,
    );
    const completed = run(world, ['apply', '--manifest', file]);
    assert.equal(completed.status, 0, completed.stderr);
    assert.equal(JSON.parse(completed.stdout).status, 'verified');
  } finally {
    cleanup(world);
  }
});

test('atomic lock and claim publication recovers every prepared and published SIGKILL window', { skip: process.platform === 'win32' }, () => {
  for (const point of ['after_lock_prepare', 'after_lock_publish']) {
    const world = fixture();
    try {
      const manifest = inventory(world);
      const file = saveManifest(world, manifest);
      const killed = run(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_KILL_AT: point,
      });
      assert.equal(killed.signal, 'SIGKILL', point);
      const lock = path.join(world.data, 'locks', '.session-state-migration.lock');
      if (point === 'after_lock_prepare') assert.equal(fs.existsSync(lock), false);
      else {
        assert.equal(fs.lstatSync(lock).nlink, 2);
        assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).migration_id, manifest.migration_id);
        assert.notEqual(runState(world, ['status']).status, 0);
      }
      const recovered = run(world, ['apply', '--manifest', file]);
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(JSON.parse(recovered.stdout).status, 'verified');
      assert.equal(
        fs.readdirSync(path.join(world.data, 'locks')).some((name) => name.startsWith('.migration-publish-')),
        false,
      );
    } finally { cleanup(world); }
  }

  for (const point of ['after_claim_prepare', 'after_claim_publish']) {
    const world = fixture();
    try {
      const manifest = inventory(world);
      const file = saveManifest(world, manifest);
      const interrupted = run(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_KILL_AT: 'after_pointer',
      });
      assert.equal(interrupted.signal, 'SIGKILL');
      const killed = run(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_KILL_AT: point,
      });
      assert.equal(killed.signal, 'SIGKILL', point);
      const claims = path.join(world.data, 'locks', '.session-state-migration.recovery.lock');
      assert.equal(fs.lstatSync(claims).isDirectory(), true);
      if (point === 'after_claim_publish') {
        const epoch = path.join(claims, 'epoch-00.json');
        assert.equal(fs.lstatSync(epoch).nlink, 2);
        assert.equal(JSON.parse(fs.readFileSync(epoch, 'utf8')).epoch, 0);
      }
      assert.notEqual(runState(world, ['resume']).status, 0);
      const recovered = run(world, ['apply', '--manifest', file]);
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(JSON.parse(recovered.stdout).status, 'verified');
      assert.equal(fs.existsSync(claims), false);
      assert.equal(
        fs.readdirSync(path.join(world.data, 'locks')).some((name) => name.startsWith('.migration-publish-')),
        false,
      );
    } finally { cleanup(world); }
  }
});

test('same-process ordinary failure fences every lock and exact retry completes', async () => {
  const world = fixture();
  const previousData = process.env.PHANTOM_DATA;
  const previousRepo = process.env.PHANTOM_REPO;
  const previousCrash = process.env.PHANTOM_TEST_MIGRATION_CRASH_AT;
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    process.env.PHANTOM_DATA = world.data;
    process.env.PHANTOM_REPO = REPO;
    process.env.PHANTOM_TEST_MIGRATION_CRASH_AT = 'after_successor';
    const migration = await import(pathToFileURL(SCRIPT).href);
    assert.throws(
      () => migration.applyMigration({ workspace: world.workspace, manifest: file }),
      /Injected migration crash/,
    );
    for (const name of ['.session-state-migration.lock', `${REPO}.lock`]) {
      const owner = JSON.parse(fs.readFileSync(path.join(world.data, 'locks', name), 'utf8'));
      assert.equal(owner.state, 'recovery_required');
    }
    delete process.env.PHANTOM_TEST_MIGRATION_CRASH_AT;
    const recovered = migration.applyMigration({ workspace: world.workspace, manifest: file });
    assert.equal(recovered.status, 'verified');
    assert.equal(fs.existsSync(path.join(world.data, 'locks', '.session-state-migration.lock')), false);
  } finally {
    if (previousData === undefined) delete process.env.PHANTOM_DATA;
    else process.env.PHANTOM_DATA = previousData;
    if (previousRepo === undefined) delete process.env.PHANTOM_REPO;
    else process.env.PHANTOM_REPO = previousRepo;
    if (previousCrash === undefined) delete process.env.PHANTOM_TEST_MIGRATION_CRASH_AT;
    else process.env.PHANTOM_TEST_MIGRATION_CRASH_AT = previousCrash;
    cleanup(world);
  }
});

test('byte-identical lock replacement is refused at release and exact recovery remains possible', { skip: process.platform === 'win32' }, async () => {
  const world = fixture();
  let applying;
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const token = 'release-identity';
    applying = spawnMigration(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_RELEASE_BARRIER: token,
    });
    const ready = path.join(world.data, 'locks', `.migration-release-${token}.ready`);
    const resume = path.join(world.data, 'locks', `.migration-release-${token}.resume`);
    waitForFile(ready);
    const globalLock = path.join(world.data, 'locks', '.session-state-migration.lock');
    const original = replaceFile(globalLock);
    assert.deepEqual(fs.readFileSync(globalLock), fs.readFileSync(original));
    write(resume, 'resume\n');
    const refused = await applying.completed;
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /lock release failed|ownership changed|recovery fencing/i);
    assert.equal(fs.existsSync(globalLock), true);
    assert.notEqual(runState(world, ['status']).status, 0);
    const recovered = run(world, ['verify', '--manifest', file]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).status, 'verified');
  } finally {
    if (applying?.child.exitCode === null && applying.child.signalCode === null) applying.child.kill('SIGKILL');
    cleanup(world);
  }
});

test('verify after completed rollback proves rolled_back and releases fresh locks', () => {
  const world = fixture();
  try {
    const migrated = apply(world, inventory(world));
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const rolledBack = run(world, ['rollback', '--manifest', migrated.file]);
    assert.equal(rolledBack.status, 0, rolledBack.stderr);
    assert.equal(JSON.parse(rolledBack.stdout).status, 'rolled_back');
    const verified = run(world, ['verify', '--manifest', migrated.file]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).status, 'rolled_back');
    assert.equal(fs.existsSync(path.join(world.data, 'locks', '.session-state-migration.lock')), false);
    assert.equal(fs.existsSync(path.join(world.data, 'locks', '.session-state-migration.recovery.lock')), false);
  } finally { cleanup(world); }
});

test('bounded claim exhaustion returns human decision required and retains the global barrier', { skip: process.platform === 'win32' }, () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const interrupted = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_KILL_AT: 'after_pointer',
      PHANTOM_TEST_MIGRATION_MAX_CLAIM_EPOCHS: '2',
    });
    assert.equal(interrupted.signal, 'SIGKILL');
    const claimDirectory = path.join(
      world.data,
      'locks',
      '.session-state-migration.recovery.lock',
    );
    const firstEpoch = path.join(claimDirectory, 'epoch-00.json');
    let firstEpochProof;
    for (let epoch = 0; epoch < 2; epoch += 1) {
      const killed = run(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_KILL_AT: 'after_lock_adoption_replace',
        PHANTOM_TEST_MIGRATION_MAX_CLAIM_EPOCHS: '2',
      });
      assert.equal(killed.signal, 'SIGKILL', `epoch ${epoch}`);
      if (epoch === 0) {
        const metadata = fs.lstatSync(firstEpoch, { bigint: true });
        firstEpochProof = {
          bytes: fs.readFileSync(firstEpoch),
          device: metadata.dev.toString(),
          inode: metadata.ino.toString(),
        };
      }
    }
    assert.deepEqual(fs.readdirSync(claimDirectory).sort(), ['epoch-00.json', 'epoch-01.json']);
    const unchangedEpoch = fs.lstatSync(firstEpoch, { bigint: true });
    assert.deepEqual(fs.readFileSync(firstEpoch), firstEpochProof.bytes);
    assert.equal(unchangedEpoch.dev.toString(), firstEpochProof.device);
    assert.equal(unchangedEpoch.ino.toString(), firstEpochProof.inode);
    const exhausted = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_MAX_CLAIM_EPOCHS: '2',
    });
    assert.equal(exhausted.status, 1, exhausted.stderr);
    assert.equal(JSON.parse(exhausted.stdout).status, 'human_decision_required');
    assert.equal(fs.existsSync(path.join(world.data, 'locks', '.session-state-migration.lock')), true);
    assert.deepEqual(fs.readdirSync(claimDirectory).sort(), ['epoch-00.json', 'epoch-01.json']);
    const retainedEpoch = fs.lstatSync(firstEpoch, { bigint: true });
    assert.deepEqual(fs.readFileSync(firstEpoch), firstEpochProof.bytes);
    assert.equal(retainedEpoch.dev.toString(), firstEpochProof.device);
    assert.equal(retainedEpoch.ino.toString(), firstEpochProof.inode);
    assert.notEqual(runState(world, ['status']).status, 0);
    const recovered = run(world, ['apply', '--manifest', file]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).status, 'verified');
  } finally { cleanup(world); }
});

test('a delayed claim publisher restarts after winner terminal cleanup without recreating debris', { skip: process.platform === 'win32' }, async () => {
  const world = fixture();
  let delayed;
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const interrupted = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_KILL_AT: 'after_pointer',
    });
    assert.equal(interrupted.signal, 'SIGKILL');
    const token = 'late-loser';
    delayed = spawnMigration(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_CLAIM_PUBLISH_BARRIER: token,
    });
    const ready = path.join(world.data, 'locks', `.migration-claim-publish-${token}.ready`);
    const resume = path.join(world.data, 'locks', `.migration-claim-publish-${token}.resume`);
    waitForFile(ready);
    const winner = run(world, ['apply', '--manifest', file]);
    assert.equal(winner.status, 0, winner.stderr);
    assert.equal(JSON.parse(winner.stdout).status, 'verified');
    write(resume, 'resume\n');
    const restarted = await delayed.completed;
    assert.equal(restarted.code, 0, restarted.stderr);
    assert.equal(JSON.parse(restarted.stdout).status, 'verified');
    assert.equal(fs.existsSync(path.join(world.data, 'locks', '.session-state-migration.recovery.lock')), false);
    assert.equal(
      fs.readdirSync(path.join(world.data, 'locks')).some((name) => name.startsWith('.migration-publish-')),
      false,
    );
  } finally {
    if (delayed?.child.exitCode === null && delayed.child.signalCode === null) delayed.child.kill('SIGKILL');
    cleanup(world);
  }
});

test('a recovery snapshot loser restarts preflight after winner terminal cleanup', { skip: process.platform === 'win32' }, async () => {
  const world = fixture();
  let delayed;
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const interrupted = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_transaction_prepared',
    });
    assert.notEqual(interrupted.status, 0);
    const prepared = path.join(transactionRoot(world, manifest), 'transaction-prepared.json');
    const preparedBytes = fs.readFileSync(prepared);
    const preparedIdentity = fs.lstatSync(prepared, { bigint: true });
    const token = 'terminal-cleanup';
    delayed = spawnMigration(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_RECOVERY_SNAPSHOT_BARRIER: token,
    });
    const ready = path.join(world.data, 'locks', `.migration-recovery-snapshot-${token}.ready`);
    const resume = path.join(world.data, 'locks', `.migration-recovery-snapshot-${token}.resume`);
    waitForFile(ready);
    const winner = run(world, ['apply', '--manifest', file]);
    assert.equal(winner.status, 0, winner.stderr);
    assert.equal(JSON.parse(winner.stdout).status, 'verified');
    write(resume, 'resume\n');
    const restarted = await delayed.completed;
    assert.equal(restarted.code, 0, restarted.stderr);
    assert.equal(JSON.parse(restarted.stdout).status, 'verified');
    const retainedIdentity = fs.lstatSync(prepared, { bigint: true });
    assert.deepEqual(fs.readFileSync(prepared), preparedBytes);
    assert.equal(retainedIdentity.dev, preparedIdentity.dev);
    assert.equal(retainedIdentity.ino, preparedIdentity.ino);
    assert.equal(fs.existsSync(path.join(world.data, 'locks', '.session-state-migration.lock')), false);
    assert.equal(fs.existsSync(path.join(world.data, 'locks', '.session-state-migration.recovery.lock')), false);
    assert.equal(
      fs.readdirSync(path.join(world.data, 'locks')).some((name) => name.startsWith('.migration-publish-')),
      false,
    );
  } finally {
    if (delayed?.child.exitCode === null && delayed.child.signalCode === null) delayed.child.kill('SIGKILL');
    cleanup(world);
  }
});

test('two recovery snapshot losers outer-restart across a replacement claim generation', { skip: process.platform === 'win32' }, async () => {
  const world = fixture();
  let loserA;
  let loserB;
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const interrupted = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_CRASH_AT: 'after_transaction_prepared',
    });
    assert.notEqual(interrupted.status, 0);
    const prepared = path.join(transactionRoot(world, manifest), 'transaction-prepared.json');
    const preparedBytes = fs.readFileSync(prepared);
    const preparedIdentity = fs.lstatSync(prepared, { bigint: true });
    const locks = path.join(world.data, 'locks');
    const claim = path.join(locks, '.session-state-migration.recovery.lock');
    const barriers = {
      aSnapshot: 'two-loser-a',
      bSnapshot: 'two-loser-b',
      aBeforeEnsure: 'two-loser-a-before',
      aAfterEnsure: 'two-loser-a-after',
      bBeforeRestart: 'two-loser-b-restart',
    };
    const barrierFile = (point, token, state) => path.join(
      locks,
      `.migration-recovery-${point}-${token}.${state}`,
    );
    loserA = spawnMigration(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_RECOVERY_SNAPSHOT_BARRIER: barriers.aSnapshot,
      PHANTOM_TEST_MIGRATION_RECOVERY_BEFORE_ENSURE_BARRIER: barriers.aBeforeEnsure,
      PHANTOM_TEST_MIGRATION_RECOVERY_AFTER_ENSURE_BARRIER: barriers.aAfterEnsure,
    });
    loserB = spawnMigration(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_RECOVERY_SNAPSHOT_BARRIER: barriers.bSnapshot,
      PHANTOM_TEST_MIGRATION_RECOVERY_BEFORE_RESTART_BARRIER: barriers.bBeforeRestart,
    });
    const aSnapshotReady = barrierFile('snapshot', barriers.aSnapshot, 'ready');
    const bSnapshotReady = barrierFile('snapshot', barriers.bSnapshot, 'ready');
    waitForFile(aSnapshotReady);
    waitForFile(bSnapshotReady);
    write(barrierFile('snapshot', barriers.aSnapshot, 'resume'), 'resume\n');
    waitForFile(barrierFile('before-ensure', barriers.aBeforeEnsure, 'ready'));
    const winner = run(world, ['apply', '--manifest', file]);
    assert.equal(winner.status, 0, winner.stderr);
    assert.equal(JSON.parse(winner.stdout).status, 'verified');
    write(barrierFile('before-ensure', barriers.aBeforeEnsure, 'resume'), 'resume\n');
    waitForFile(barrierFile('after-ensure', barriers.aAfterEnsure, 'ready'));
    const replacementIdentity = fs.lstatSync(claim, { bigint: true });
    write(barrierFile('snapshot', barriers.bSnapshot, 'resume'), 'resume\n');
    waitForFile(barrierFile('before-restart', barriers.bBeforeRestart, 'ready'));
    const observedIdentity = fs.lstatSync(claim, { bigint: true });
    assert.equal(observedIdentity.dev, replacementIdentity.dev);
    assert.equal(observedIdentity.ino, replacementIdentity.ino);
    write(barrierFile('after-ensure', barriers.aAfterEnsure, 'resume'), 'resume\n');
    const restartedA = await loserA.completed;
    assert.equal(restartedA.code, 0, restartedA.stderr);
    assert.equal(JSON.parse(restartedA.stdout).status, 'verified');
    assert.equal(fs.existsSync(claim), false);
    write(barrierFile('before-restart', barriers.bBeforeRestart, 'resume'), 'resume\n');
    const restartedB = await loserB.completed;
    assert.equal(restartedB.code, 0, restartedB.stderr);
    assert.equal(JSON.parse(restartedB.stdout).status, 'verified');
    const retainedIdentity = fs.lstatSync(prepared, { bigint: true });
    assert.deepEqual(fs.readFileSync(prepared), preparedBytes);
    assert.equal(retainedIdentity.dev, preparedIdentity.dev);
    assert.equal(retainedIdentity.ino, preparedIdentity.ino);
    for (const name of fs.readdirSync(locks)) {
      if (name.startsWith('.migration-recovery-')) fs.unlinkSync(path.join(locks, name));
    }
    assert.deepEqual(fs.readdirSync(locks), []);
  } finally {
    for (const loser of [loserA, loserB]) {
      if (loser?.child.exitCode === null && loser.child.signalCode === null) loser.child.kill('SIGKILL');
    }
    cleanup(world);
  }
});

test('recovery claims continuously block runtime and permit one exact adopter without tombstones', { skip: process.platform === 'win32' }, async () => {
  for (const claimOnly of [false, true]) {
    const world = fixture();
    let recovering;
    try {
      const manifest = inventory(world);
      const file = saveManifest(world, manifest);
      const killed = run(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_KILL_AT: 'after_pointer',
      });
      assert.equal(killed.signal, 'SIGKILL');
      const token = claimOnly ? 'claim-only' : 'global-and-claim';
      recovering = spawnMigration(world, ['apply', '--manifest', file], {
        PHANTOM_TEST_MIGRATION_RECOVERY_BARRIER: token,
      });
      const ready = path.join(world.data, 'locks', `.migration-recovery-${token}.ready`);
      waitForFile(ready);
      const globalLock = path.join(world.data, 'locks', '.session-state-migration.lock');
      const claim = path.join(world.data, 'locks', '.session-state-migration.recovery.lock');
      assert.equal(fs.existsSync(globalLock), true);
      assert.equal(fs.existsSync(claim), true);
      assert.notEqual(runState(world, ['status']).status, 0);
      assert.notEqual(runDoctor(world).status, 0);
      const contender = run(world, ['apply', '--manifest', file]);
      assert.notEqual(contender.status, 0);
      recovering.child.kill('SIGKILL');
      const killedRecovery = await recovering.completed;
      assert.equal(killedRecovery.signal, 'SIGKILL');
      if (claimOnly) fs.unlinkSync(globalLock);
      assert.notEqual(runState(world, ['resume']).status, 0, 'claim alone remains a runtime barrier');
      const resumed = run(world, ['apply', '--manifest', file]);
      assert.equal(resumed.status, 0, resumed.stderr);
      assert.equal(JSON.parse(resumed.stdout).status, 'verified');
      assert.equal(fs.existsSync(globalLock), false);
      assert.equal(fs.existsSync(claim), false);
      assert.equal(fs.readdirSync(path.join(world.data, 'locks')).some((name) => name.includes('.dead-')), false);
    } finally {
      if (recovering?.child.exitCode === null && recovering.child.signalCode === null) recovering.child.kill('SIGKILL');
      cleanup(world);
    }
  }
});

test('imported readers discard state when migration starts after their initial lock check', { skip: process.platform === 'win32' }, async () => {
  const world = fixture();
  const token = 'migration-overlap';
  let reader;
  try {
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    reader = spawnStateReader(world, token);
    const ready = path.join(world.data, 'locks', `.state-reader-${token}.ready`);
    const resume = path.join(world.data, 'locks', `.state-reader-${token}.resume`);
    waitForFile(ready);

    const killed = run(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_KILL_AT: 'after_pointer',
    });
    assert.equal(killed.signal, 'SIGKILL');
    fs.writeFileSync(resume, 'resume\n', { mode: 0o600 });
    const read = await reader.completed;
    assert.equal(read.code, 1, read.stderr);
    assert.equal(read.stdout, '', 'overlapping reader must not return state');
    assert.match(read.stderr, /session-state migration.*runtime state access is blocked/i);

    const recovered = run(world, ['apply', '--manifest', file]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).status, 'verified');
  } finally {
    if (reader?.child.exitCode === null && reader.child.signalCode === null) reader.child.kill('SIGKILL');
    cleanup(world);
  }
});

test('SIGKILL windows before manifest and before completed-history sealing resume safely', { skip: process.platform === 'win32' }, () => {
  const transactionWorld = fixture();
  const completedWorld = fixture({ status: 'completed' });
  try {
    const transactionManifest = inventory(transactionWorld);
    const transactionFile = saveManifest(transactionWorld, transactionManifest);
    const beforeManifest = run(transactionWorld, ['apply', '--manifest', transactionFile], {
      PHANTOM_TEST_MIGRATION_KILL_AT: 'after_transaction_directory',
    });
    assert.equal(beforeManifest.signal, 'SIGKILL');
    assert.equal(JSON.parse(fs.readFileSync(transactionWorld.pointer, 'utf8')).schema_version, 1);
    const transactionRecovered = run(transactionWorld, ['apply', '--manifest', transactionFile]);
    assert.equal(transactionRecovered.status, 0, transactionRecovered.stderr);
    assert.equal(JSON.parse(transactionRecovered.stdout).status, 'verified');

    const completedManifest = inventory(completedWorld);
    const completedFile = saveManifest(completedWorld, completedManifest);
    const beforeSeal = run(completedWorld, ['apply', '--manifest', completedFile], {
      PHANTOM_TEST_MIGRATION_KILL_AT: 'after_completed_archive_rename',
    });
    assert.equal(beforeSeal.signal, 'SIGKILL');
    assert.equal(JSON.parse(fs.readFileSync(completedWorld.pointer, 'utf8')).schema_version, 1);
    const completedRecovered = run(completedWorld, ['apply', '--manifest', completedFile]);
    assert.equal(completedRecovered.status, 0, completedRecovered.stderr);
    assert.equal(JSON.parse(completedRecovered.stdout).status, 'verified');
    assert.equal(fs.existsSync(completedWorld.pointer), false);
  } finally {
    cleanup(transactionWorld);
    cleanup(completedWorld);
  }
});

test('SIGKILL during rollback data restoration resumes and still restores the pointer last', { skip: process.platform === 'win32' }, () => {
  const world = fixture();
  try {
    const originalPointer = fs.readFileSync(world.pointer);
    const originalTree = treeState(world.sessionDir);
    const manifest = inventory(world);
    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const killed = run(world, ['rollback', '--manifest', migrated.file], {
      PHANTOM_TEST_MIGRATION_KILL_AT: 'after_rollback_successor_parked',
    });
    assert.equal(killed.signal, 'SIGKILL');
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 2);
    const globalLock = path.join(world.data, 'locks', '.session-state-migration.lock');
    const repoLock = path.join(world.data, 'locks', `${REPO}.lock`);
    const globalBytes = fs.readFileSync(globalLock);
    const repoBytes = fs.readFileSync(repoLock);
    const interruptedState = treeState(world.data);
    const blocked = runState(world, ['resume']);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /session-state migration.*runtime state access is blocked/i);
    assert.deepEqual(fs.readFileSync(globalLock), globalBytes);
    assert.deepEqual(fs.readFileSync(repoLock), repoBytes);
    assert.deepEqual(treeState(world.data), interruptedState);
    const recovered = run(world, ['rollback', '--manifest', migrated.file]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).status, 'rolled_back');
    assert.deepEqual(fs.readFileSync(world.pointer), originalPointer);
    assert.deepEqual(treeState(world.sessionDir), originalTree);
  } finally { cleanup(world); }
});

function rollbackActionFixture(action) {
  if (action === 'migrate_to_paused') return fixture();
  if (action === 'archive_completed') return fixture({ status: 'completed' });
  const world = fixture();
  fs.rmSync(world.sessionDir, { recursive: true, force: true });
  write(world.pointer, '{selected-malformed-json\n');
  return world;
}

test('rollback pointer write-ahead receipt resumes every unmodified action after rename', { skip: process.platform === 'win32' }, () => {
  for (const action of ['migrate_to_paused', 'archive_completed', 'quarantine_pointer']) {
    const world = rollbackActionFixture(action);
    try {
      const originalPointer = fs.readFileSync(world.pointer);
      const manifest = inventory(world);
      assert.equal(mutationEntry(manifest).action, action);
      const migrated = apply(world, manifest);
      assert.equal(migrated.result.status, 0, migrated.result.stderr);
      const killed = run(world, ['rollback', '--manifest', migrated.file], {
        PHANTOM_TEST_MIGRATION_KILL_AT: 'after_rollback_pointer',
      });
      assert.equal(killed.signal, 'SIGKILL', action);
      const recovered = run(world, ['rollback', '--manifest', migrated.file]);
      assert.equal(recovered.status, 0, `${action}: ${recovered.stderr}`);
      assert.equal(JSON.parse(recovered.stdout).status, 'rolled_back');
      assert.deepEqual(fs.readFileSync(world.pointer), originalPointer);
    } finally { cleanup(world); }
  }
});

test('rollback typed artifacts recover after-link publication windows without debris', () => {
  for (const operation of ['rollback-marker-in-progress', 'rollback-pointer-stage']) {
    const world = fixture();
    try {
      const originalPointer = fs.readFileSync(world.pointer);
      const manifest = inventory(world);
      const migrated = apply(world, manifest);
      assert.equal(migrated.result.status, 0, migrated.result.stderr);
      const crashPoint = `publication_${operation}_after_absent_link`;
      const crashed = run(world, ['rollback', '--manifest', migrated.file], {
        PHANTOM_TEST_MIGRATION_CRASH_AT: crashPoint,
      });
      assert.notEqual(crashed.status, 0, crashPoint);
      assert.match(crashed.stderr, /after_absent_link/, crashed.stderr);
      const linked = publicationLink(world.data);
      if (operation === 'rollback-marker-in-progress') {
        assert.equal(JSON.parse(linked.bytes.toString('utf8')).status, 'in_progress');
      }
      const recovered = run(world, ['rollback', '--manifest', migrated.file]);
      assert.equal(recovered.status, 0, `${crashPoint}: ${recovered.stderr}`);
      assert.equal(JSON.parse(recovered.stdout).status, 'rolled_back');
      assert.deepEqual(fs.readFileSync(world.pointer), originalPointer);
      if (operation === 'rollback-pointer-stage') {
        const stableFile = fileWithIdentity(world.data, linked);
        assert.equal(stableFile, world.pointer);
        assert.deepEqual(fs.readFileSync(stableFile), linked.bytes);
        assert.equal(fs.statSync(stableFile).nlink, 1);
      }
      const marker = JSON.parse(fs.readFileSync(
        path.join(transactionRoot(world, manifest), 'rollback-state.json'),
        'utf8',
      ));
      assert.equal(marker.status, 'completed');
      assert.deepEqual(durablePublicationDebris(world.data), [], operation);
    } finally { cleanup(world); }
  }
});

test('completed rollback marker publication resumes after its replacement rename and leaves no debris', () => {
  for (const step of ['before_prepared_install', 'after_prepared_install', 'after_rename']) {
    const world = fixture();
    try {
      const manifest = inventory(world);
      const migrated = apply(world, manifest);
      assert.equal(migrated.result.status, 0, migrated.result.stderr);
      const crashed = run(world, ['rollback', '--manifest', migrated.file], {
        PHANTOM_TEST_MIGRATION_CRASH_AT: `publication_rollback-marker-completed_${step}`,
      });
      assert.notEqual(crashed.status, 0);
      assert.match(crashed.stderr, new RegExp(step), crashed.stderr);
      const markerFile = path.join(transactionRoot(world, manifest), 'rollback-state.json');
      const linked = step === 'after_prepared_install' ? publicationLink(world.data) : null;
      const completed = step === 'after_rename' ? {
        bytes: fs.readFileSync(markerFile),
        ...fs.statSync(markerFile),
      } : null;
      if (completed) assert.equal(JSON.parse(completed.bytes.toString('utf8')).status, 'completed');
      const recovered = run(world, ['rollback', '--manifest', migrated.file]);
      assert.equal(recovered.status, 0, `${recovered.stderr}\n${recovered.stdout}`);
      assert.equal(JSON.parse(recovered.stdout).status, 'rolled_back');
      const finalMarker = fs.statSync(markerFile);
      if (linked) {
        assert.equal(finalMarker.dev, linked.device);
        assert.equal(finalMarker.ino, linked.inode);
        assert.deepEqual(fs.readFileSync(markerFile), linked.bytes);
      }
      if (completed) {
        assert.deepEqual(fs.readFileSync(markerFile), completed.bytes);
        assert.equal(finalMarker.dev, completed.dev);
        assert.equal(finalMarker.ino, completed.ino);
      }
      assert.equal(JSON.parse(fs.readFileSync(markerFile, 'utf8')).status, 'completed');
      assert.deepEqual(durablePublicationDebris(world.data), []);
    } finally { cleanup(world); }
  }
});

test('completed rollback marker CAS rejects a byte-identical replacement of its validated in-progress generation', async () => {
  const world = fixture();
  let running;
  try {
    const manifest = inventory(world);
    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const token = `marker-${process.pid}-${Date.now()}`;
    running = spawnMigration(world, ['rollback', '--manifest', migrated.file], {
      PHANTOM_TEST_MIGRATION_PUBLICATION_BARRIER:
        `rollback-marker-completed_before_generation_check:${token}`,
    });
    const ready = path.join(world.data, 'locks', `.migration-publication-${token}.ready`);
    const resume = path.join(world.data, 'locks', `.migration-publication-${token}.resume`);
    waitForFile(ready);
    const markerFile = path.join(transactionRoot(world, manifest), 'rollback-state.json');
    const originalInode = fs.lstatSync(markerFile).ino;
    replaceFileGeneration(markerFile);
    const replacementInode = fs.lstatSync(markerFile).ino;
    const replacementBytes = fs.readFileSync(markerFile);
    assert.notEqual(replacementInode, originalInode);
    write(resume, 'resume\n');
    const result = await running.completed;
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /generation changed/i);
    assert.equal(JSON.parse(fs.readFileSync(markerFile, 'utf8')).status, 'in_progress');
    assert.equal(fs.lstatSync(markerFile).ino, replacementInode);
    assert.deepEqual(fs.readFileSync(markerFile), replacementBytes);
  } finally {
    if (running?.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGKILL');
    cleanup(world);
  }
});

test('completed rollback marker lease proves every acquired repository lock', async () => {
  const world = fixture();
  let running;
  try {
    const foreign = addBoundRepository(world);
    const manifest = inventory(world);
    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const token = `locks-${process.pid}-${Date.now()}`;
    running = spawnMigration(world, ['rollback', '--manifest', migrated.file], {
      PHANTOM_TEST_MIGRATION_PUBLICATION_BARRIER:
        `rollback-marker-completed_before_generation_check:${token}`,
    });
    const ready = path.join(world.data, 'locks', `.migration-publication-${token}.ready`);
    const resume = path.join(world.data, 'locks', `.migration-publication-${token}.resume`);
    waitForFile(ready);
    const markerFile = path.join(transactionRoot(world, manifest), 'rollback-state.json');
    const markerInode = fs.lstatSync(markerFile).ino;
    const markerBytes = fs.readFileSync(markerFile);
    const foreignLock = path.join(world.data, 'locks', `${foreign.repo}.lock`);
    const originalInode = fs.lstatSync(foreignLock).ino;
    replaceFileGeneration(foreignLock);
    assert.notEqual(fs.lstatSync(foreignLock).ino, originalInode);
    write(resume, 'resume\n');
    const result = await running.completed;
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /locks could not be fenced for recovery/i);
    assert.equal(JSON.parse(fs.readFileSync(markerFile, 'utf8')).status, 'in_progress');
    assert.equal(fs.lstatSync(markerFile).ino, markerInode);
    assert.deepEqual(fs.readFileSync(markerFile), markerBytes);
  } finally {
    if (running?.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGKILL');
    cleanup(world);
  }
});

test('rollback pointer write-ahead receipt rejects byte-identical post-rename replacement', { skip: process.platform === 'win32' }, () => {
  for (const action of ['migrate_to_paused', 'archive_completed', 'quarantine_pointer']) {
    const world = rollbackActionFixture(action);
    try {
      const migrated = apply(world, inventory(world));
      assert.equal(migrated.result.status, 0, migrated.result.stderr);
      const killed = run(world, ['rollback', '--manifest', migrated.file], {
        PHANTOM_TEST_MIGRATION_KILL_AT: 'after_rollback_pointer',
      });
      assert.equal(killed.signal, 'SIGKILL', action);
      replaceFile(world.pointer);
      const replacementInode = fs.lstatSync(world.pointer).ino;
      const tx = path.join(world.data, 'migrations', 'session-state', migrated.value.migration_id.slice(7));
      const journal = path.join(tx, 'journals', `${world.repo}.jsonl`);
      const journalBefore = fs.readFileSync(journal);
      const refused = run(world, ['rollback', '--manifest', migrated.file]);
      assert.equal(refused.status, 1, action);
      assert.equal(JSON.parse(refused.stdout).status, 'human_decision_required');
      assert.equal(fs.lstatSync(world.pointer).ino, replacementInode);
      assert.deepEqual(fs.readFileSync(journal), journalBefore);
    } finally { cleanup(world); }
  }
});

test('completed rollback receipts reject later byte-identical pointer and source replacements', () => {
  for (const action of ['migrate_to_paused', 'archive_completed', 'quarantine_pointer']) {
    for (const targetKind of action === 'quarantine_pointer' ? ['pointer'] : ['pointer', 'source']) {
      const world = rollbackActionFixture(action);
      try {
        const migrated = apply(world, inventory(world));
        assert.equal(migrated.result.status, 0, migrated.result.stderr);
        const rolledBack = run(world, ['rollback', '--manifest', migrated.file]);
        assert.equal(rolledBack.status, 0, rolledBack.stderr);
        const target = targetKind === 'pointer' ? world.pointer : world.sessionDir;
        if (targetKind === 'pointer') replaceFile(target);
        else replaceDirectory(target);
        const replacementInode = fs.lstatSync(target).ino;
        const refused = run(world, ['rollback', '--manifest', migrated.file]);
        assert.equal(refused.status, 1, `${action}/${targetKind}`);
        assert.equal(JSON.parse(refused.stdout).status, 'human_decision_required');
        assert.equal(fs.lstatSync(target).ino, replacementInode);
      } finally { cleanup(world); }
    }
  }
});

test('SIGKILL around completed-history restore rename resumes modes and restores the pointer last', { skip: process.platform === 'win32' }, () => {
  for (const [crashPoint, sourceRestored] of [
    ['after_rollback_completed_archive_unsealed', false],
    ['after_rollback_completed_restore_rename', true],
  ]) {
    const world = fixture({ status: 'completed' });
    try {
      const originalPointer = fs.readFileSync(world.pointer);
      const originalTree = treeState(world.sessionDir);
      const manifest = inventory(world);
      const migrated = apply(world, manifest);
      assert.equal(migrated.result.status, 0, migrated.result.stderr);
      const killed = run(world, ['rollback', '--manifest', migrated.file], {
        PHANTOM_TEST_MIGRATION_KILL_AT: crashPoint,
      });
      assert.equal(killed.signal, 'SIGKILL', JSON.stringify({
        crashPoint,
        status: killed.status,
        stdout: killed.stdout,
        stderr: killed.stderr,
      }));
      assert.equal(fs.existsSync(world.pointer), false, 'pointer remains absent until restored data is durable');
      assert.equal(fs.existsSync(world.sessionDir), sourceRestored);
      const recovered = run(world, ['rollback', '--manifest', migrated.file]);
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(JSON.parse(recovered.stdout).status, 'rolled_back');
      assert.deepEqual(fs.readFileSync(world.pointer), originalPointer);
      assert.deepEqual(treeState(world.sessionDir), originalTree);
    } finally { cleanup(world); }
  }
});

test('verify detects tampering and rollback refuses after post-migration use', () => {
  const world = fixture();
  try {
    const manifest = inventory(world);
    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    writeJson(path.join(world.sessionDir, 'workflow', 'state.json'), { post_migration_use: true });
    const verify = run(world, ['verify', '--manifest', migrated.file]);
    assert.equal(verify.status, 1, verify.stderr);
    const verified = JSON.parse(verify.stdout);
    assert.equal(verified.status, 'failed');
    assert.match(verified.errors.join(' '), /(?:changed after cutover|physical identity changed)/);
    const rollback = run(world, ['rollback', '--manifest', migrated.file]);
    assert.equal(rollback.status, 1, rollback.stderr);
    assert.equal(JSON.parse(rollback.stdout).status, 'human_decision_required');
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 2);
  } finally { cleanup(world); }
});

test('guarded rollback restores original data first and exact v1 pointer last', () => {
  const world = fixture();
  try {
    const originalPointer = fs.readFileSync(world.pointer);
    const originalTree = treeState(world.sessionDir);
    const manifest = inventory(world);
    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    const rollback = run(world, ['rollback', '--manifest', migrated.file]);
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.equal(JSON.parse(rollback.stdout).status, 'rolled_back');
    assert.deepEqual(fs.readFileSync(world.pointer), originalPointer);
    assert.deepEqual(treeState(world.sessionDir), originalTree);
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 1);
    const rolledBackState = treeState(world.data);
    const reapplied = run(world, ['apply', '--manifest', migrated.file]);
    assert.notEqual(reapplied.status, 0);
    assert.match(reapplied.stderr, /entered rollback|terminal or non-resumable/);
    assert.deepEqual(treeState(world.data), rolledBackState, 'terminal rollback makes same-manifest reapply zero-write');
  } finally { cleanup(world); }
});

test('mutation commands privately normalize only owned migration control directories', () => {
  const world = fixture();
  const symlinkWorld = fixture();
  try {
    const locks = path.join(world.data, 'locks');
    const migrations = path.join(world.data, 'migrations');
    mkdirp(locks);
    mkdirp(migrations);
    for (const directory of [world.data, locks, migrations]) fs.chmodSync(directory, 0o755);

    const manifest = inventory(world);
    for (const directory of [world.data, locks, migrations]) {
      assert.equal(fs.lstatSync(directory).mode & 0o777, 0o755, 'inventory preserves directory mode');
    }

    const migrated = apply(world, manifest);
    assert.equal(migrated.result.status, 0, migrated.result.stderr);
    assert.equal(migrated.value.status, 'verified');
    const transaction = transactionRoot(world, manifest);
    for (const directory of [
      world.data,
      locks,
      migrations,
      path.join(migrations, 'session-state'),
      transaction,
    ]) {
      assert.equal(fs.lstatSync(directory).mode & 0o777, 0o700, `${directory} is private`);
    }
    const verified = run(world, ['verify', '--manifest', migrated.file]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).status, 'verified');

    const symlinkManifest = inventory(symlinkWorld);
    const symlinkFile = saveManifest(symlinkWorld, symlinkManifest);
    const externalLocks = path.join(symlinkWorld.root, 'external-locks');
    mkdirp(externalLocks);
    fs.symlinkSync(externalLocks, path.join(symlinkWorld.data, 'locks'));
    const refused = run(symlinkWorld, ['apply', '--manifest', symlinkFile]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Migration output parent is not a real directory/);
    assert.equal(fs.lstatSync(externalLocks).mode & 0o777, 0o700);
    assert.deepEqual(JSON.parse(fs.readFileSync(symlinkWorld.pointer, 'utf8')).schema_version, 1);
  } finally {
    cleanup(world);
    cleanup(symlinkWorld);
  }
});

test('directory-mode normalization cannot follow a replacement symlink after validation', {
  skip: process.platform === 'win32',
}, async () => {
  const world = fixture();
  let running;
  try {
    const locks = path.join(world.data, 'locks');
    const movedLocks = path.join(world.data, 'locks-before-race');
    const external = path.join(world.root, 'external-owned-directory');
    mkdirp(locks);
    mkdirp(external);
    fs.chmodSync(locks, 0o755);
    fs.chmodSync(external, 0o755);
    const manifest = inventory(world);
    const file = saveManifest(world, manifest);
    const token = 'locks-path-swap';
    running = spawnMigration(world, ['apply', '--manifest', file], {
      PHANTOM_TEST_MIGRATION_DIRECTORY_MODE_BARRIER: `${token}:locks`,
    });
    const ready = path.join(world.data, `.migration-directory-mode-${token}.ready`);
    const resume = path.join(world.data, `.migration-directory-mode-${token}.resume`);
    waitForFile(ready);
    fs.renameSync(locks, movedLocks);
    fs.symlinkSync(external, locks, 'dir');
    write(resume, 'resume\n');
    const result = await running.completed;
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /path changed during private-mode normalization/);
    assert.equal(fs.lstatSync(external).mode & 0o777, 0o755, 'replacement target is untouched');
    assert.equal(fs.lstatSync(movedLocks).mode & 0o777, 0o700, 'opened original descriptor is hardened');
    assert.equal(JSON.parse(fs.readFileSync(world.pointer, 'utf8')).schema_version, 1);
  } finally {
    if (running?.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGKILL');
    cleanup(world);
  }
});

test('session migration C+D: inventory output is private while stdout and return stay redacted', () => {
  const world = fixture();
  try {
    const expectedManifest = inventory(world);
    const output = path.join(world.root, 'private-migration-manifest.json');
    const result = run(world, ['inventory', '--output', output]);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.deepEqual(receipt, {
      migration_id: expectedManifest.migration_id,
      schema_version: 1,
      status: 'inventory_written',
    });
    assert.deepEqual(Object.keys(receipt).sort(), ['migration_id', 'schema_version', 'status']);
    const metadata = fs.lstatSync(output);
    assert.equal(metadata.isFile(), true);
    assert.equal(metadata.nlink, 1);
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), expectedManifest);
    for (const sensitive of [
      'data_root', 'workspace_binding', 'storage_binding', 'confirmations', 'entries',
      'device', 'inode', 'source_relative', world.workspace, world.data, world.sessionDir,
    ]) {
      assert.equal(result.stdout.includes(sensitive), false, `stdout leaked ${sensitive}`);
    }

    const returnedOutput = path.join(world.root, 'returned-private-manifest.json');
    const source = `
      import(${JSON.stringify(pathToFileURL(SCRIPT).href)})
        .then((migration) => {
          let printed = '';
          const returned = migration.runSessionMigration(
            ${JSON.stringify(['inventory', '--workspace', world.workspace, '--output', returnedOutput])},
            { stdout: { write(value) { printed += value; } } },
          );
          process.stdout.write(JSON.stringify({ returned, printed: JSON.parse(printed) }));
        })
        .catch((error) => { process.stderr.write(error.message); process.exitCode = 1; });
    `;
    const programmatic = spawnSync(process.execPath, ['-e', source], {
      env: world.env,
      encoding: 'utf8',
    });
    assert.equal(programmatic.status, 0, programmatic.stderr);
    const observed = JSON.parse(programmatic.stdout);
    assert.deepEqual(observed.returned, receipt);
    assert.deepEqual(observed.printed, receipt);
    const returnedMetadata = fs.lstatSync(returnedOutput);
    assert.equal(returnedMetadata.mode & 0o777, 0o600);
    assert.equal(returnedMetadata.nlink, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(returnedOutput, 'utf8')), expectedManifest);

    const duplicate = run(world, ['inventory', '--output', output]);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /already exists/);

    fs.chmodSync(output, 0o644);
    const before = liveState(world.data);
    const rejected = run(world, ['apply', '--manifest', output]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /must be private/);
    assert.deepEqual(liveState(world.data), before);
    assert.equal(fs.existsSync(path.join(world.data, 'locks', '.session-state-migration.lock')), false);
  } finally { cleanup(world); }
});

test('physical identity normalization preserves bigint device and inode values exactly', async () => {
  const migration = await import(`${pathToFileURL(SCRIPT).href}?physical-identity=${Date.now()}`);
  const identity = migration.physicalIdentity({
    dev: 9_007_199_254_740_993n,
    ino: 18_446_744_073_709_551_615n,
  });
  assert.deepEqual(identity, {
    device: '9007199254740993',
    inode: '18446744073709551615',
  });
  assert.throws(
    () => migration.physicalIdentity({ dev: Number.MAX_SAFE_INTEGER + 1, ino: 1 }),
    /safe integer/,
  );
});

test('CLI rejects force, unknown options, and mutation commands without a manifest', () => {
  const world = fixture();
  try {
    for (const args of [
      ['inventory', '--force'],
      ['inventory', '--unknown', 'x'],
      ['inventory', '--manifest', 'ignored.json'],
      ['apply', '--output', 'ignored.json'],
      ['apply'],
      ['verify'],
      ['rollback'],
    ]) {
      const result = run(world, args);
      assert.notEqual(result.status, 0, args.join(' '));
    }
  } finally { cleanup(world); }
});
