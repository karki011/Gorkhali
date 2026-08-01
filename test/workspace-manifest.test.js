// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MANIFEST_MODULE = '../skills/phantom/scripts/lib/workspace-manifest.mjs';
const SNAPSHOT_MODULE = '../skills/phantom/scripts/lib/filesystem-snapshot.mjs';
const REPOSITORY_ROOT = path.resolve(__dirname, '..');

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function contentEntries(bundle) {
  return bundle.content_shards.flatMap((shard) => shard.entries)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function physicalEntries(bundle) {
  return bundle.physical_shards.flatMap((shard) => shard.entries)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function domainDigest(domain, value) {
  return `sha256:${createHash('sha256')
    .update(`${domain}\0`)
    .update(canonicalJson(value))
    .digest('hex')}`;
}

test('v2 manifests are path-independent, policy-bound, and content-addressed', async () => {
  const outer = temporaryDirectory('phantom-manifest-contract-');
  try {
    const left = path.join(outer, 'left');
    const right = path.join(outer, 'right');
    for (const root of [left, right]) {
      fs.mkdirSync(path.join(root, '.git'), { recursive: true });
      fs.mkdirSync(path.join(root, '.phantom'), { recursive: true });
      fs.mkdirSync(path.join(root, 'node_modules', 'fixture'), { recursive: true });
      fs.writeFileSync(path.join(root, '.git', 'index'), 'control metadata differs by checkout\n');
      fs.writeFileSync(path.join(root, '.phantom', 'state.json'), '{}\n');
      fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
      fs.writeFileSync(path.join(root, 'source.txt'), 'same bytes\n');
      fs.writeFileSync(path.join(root, 'node_modules', 'fixture', 'ignored.js'), 'still relevant\n');
      if (process.platform !== 'win32') fs.symlinkSync('missing-target', path.join(root, 'dangling'));
    }

    const {
      WORKSPACE_MANIFEST_ALGORITHM,
      WORKSPACE_MANIFEST_POLICY_DIGEST,
      buildWorkspaceManifest,
      compactWorkspaceEvidence,
      physicalTopologyRootFromReferences,
      verifyWorkspaceManifest,
      workspaceManifestArtifacts,
    } = await import(MANIFEST_MODULE);
    const leftManifest = buildWorkspaceManifest(left);
    const rightManifest = buildWorkspaceManifest(right);
    const { workspaceSnapshot } = await import(SNAPSHOT_MODULE);

    assert.equal(verifyWorkspaceManifest(leftManifest), true);
    assert.equal(leftManifest.evidence.schema_version, 2);
    assert.equal(leftManifest.evidence.algorithm, WORKSPACE_MANIFEST_ALGORITHM);
    assert.equal(leftManifest.evidence.policy_digest, WORKSPACE_MANIFEST_POLICY_DIGEST);
    assert.equal(leftManifest.evidence.snapshot_digest, workspaceSnapshot(left).digest);
    assert.equal(rightManifest.evidence.snapshot_digest, workspaceSnapshot(right).digest);
    assert.deepEqual(leftManifest.evidence.policy, {
      policy_id: 'portable-all-files-v2',
      tracked: 'include',
      untracked: 'include',
      ignored: 'include',
      control_exclusions: ['.git', '.phantom'],
      special_files: 'reject',
    });
    assert.equal(leftManifest.evidence.fingerprint, rightManifest.evidence.fingerprint);
    assert.equal(leftManifest.evidence.manifest_digest, rightManifest.evidence.manifest_digest);
    assert.equal(
      leftManifest.evidence.physical_topology_root,
      rightManifest.evidence.physical_topology_root,
    );
    assert.notEqual(leftManifest.evidence.physical_root, rightManifest.evidence.physical_root);
    assert.notEqual(leftManifest.evidence.evidence_digest, rightManifest.evidence.evidence_digest);
    const topologyReferences = (manifest) => manifest.evidence.physical_shards.map((reference) => ({
      bucket: reference.bucket,
      entry_count: reference.entry_count,
      topology_digest: reference.topology_digest,
    }));
    assert.deepEqual(topologyReferences(leftManifest), topologyReferences(rightManifest));
    assert.equal(
      physicalTopologyRootFromReferences(leftManifest.evidence.physical_shards),
      leftManifest.evidence.physical_topology_root,
    );
    for (const shard of leftManifest.physical_shards) {
      const reference = leftManifest.evidence.physical_shards.find(
        (candidate) => candidate.bucket === shard.bucket,
      );
      assert.deepEqual(Object.keys(shard).sort(), [
        'bucket', 'digest', 'entries', 'entry_count', 'kind', 'schema_version', 'topology_digest',
      ]);
      assert.deepEqual(Object.keys(reference).sort(), [
        'bucket', 'digest', 'entry_count', 'topology_digest',
      ]);
      assert.equal(reference.topology_digest, shard.topology_digest);
      assert.match(shard.topology_digest, /^sha256:[a-f0-9]{64}$/);
    }

    const paths = contentEntries(leftManifest).map((entry) => entry.path);
    assert.ok(paths.includes('node_modules/fixture/ignored.js'), 'ignored content remains fingerprint-relevant');
    assert.ok(!paths.some((file) => file === '.git' || file.startsWith('.git/')));
    assert.ok(!paths.some((file) => file === '.phantom' || file.startsWith('.phantom/')));
    assert.deepEqual(compactWorkspaceEvidence(leftManifest), leftManifest.evidence);

    const artifacts = workspaceManifestArtifacts(leftManifest);
    assert.ok(artifacts.length > 2);
    assert.equal(new Set(artifacts.map((artifact) => artifact.path)).size, artifacts.length);
    for (const artifact of artifacts) {
      assert.equal(
        artifact.digest,
        `sha256:${createHash('sha256').update(artifact.bytes).digest('hex')}`,
      );
    }
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('generation cache hashes only changed bytes without trusting directory mtimes', async () => {
  const outer = temporaryDirectory('phantom-manifest-cache-');
  const workspace = path.join(outer, 'workspace');
  fs.mkdirSync(workspace);
  try {
    fs.writeFileSync(path.join(workspace, 'alpha.txt'), 'alpha');
    fs.writeFileSync(path.join(workspace, 'beta.txt'), 'beta');
    const {
      buildWorkspaceManifest,
      createWorkspaceManifestCache,
      diffWorkspaceManifests,
    } = await import(MANIFEST_MODULE);
    const cache = createWorkspaceManifestCache();
    const cold = buildWorkspaceManifest(workspace, { cache });
    assert.equal(cold.instrumentation.content_files_hashed, 2);
    assert.equal(cold.instrumentation.content_bytes_hashed, 9);

    const warm = buildWorkspaceManifest(workspace, { cache });
    assert.equal(warm.instrumentation.content_files_hashed, 0);
    assert.equal(warm.instrumentation.content_bytes_hashed, 0);
    assert.equal(warm.instrumentation.cache_hits, 2);
    assert.equal(warm.evidence.evidence_digest, cold.evidence.evidence_digest);

    const directoryTimes = fs.statSync(workspace);
    fs.writeFileSync(path.join(workspace, 'alpha.txt'), 'ALPHA');
    fs.utimesSync(workspace, directoryTimes.atime, directoryTimes.mtime);
    const edited = buildWorkspaceManifest(workspace, { cache });
    assert.equal(edited.instrumentation.content_files_hashed, 1);
    assert.equal(edited.instrumentation.content_bytes_hashed, 5);
    assert.equal(edited.instrumentation.cache_hits, 1);
    assert.notEqual(edited.evidence.fingerprint, warm.evidence.fingerprint);
    assert.deepEqual(diffWorkspaceManifests(warm, edited).changed_paths, ['alpha.txt']);

    const outsideLink = path.join(outer, 'alpha-link.txt');
    fs.linkSync(path.join(workspace, 'alpha.txt'), outsideLink);
    const linked = buildWorkspaceManifest(workspace, { cache });
    assert.equal(linked.instrumentation.content_files_hashed, 1, 'nlink generation changes cannot reuse content');
    assert.equal(linked.evidence.fingerprint, edited.evidence.fingerprint);
    assert.notEqual(linked.evidence.physical_topology_root, edited.evidence.physical_topology_root);
    const physicalDelta = diffWorkspaceManifests(edited, linked);
    assert.deepEqual(physicalDelta.changed_paths, []);
    assert.deepEqual(physicalDelta.changed_physical_paths, ['alpha.txt']);
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('physical evidence preserves and verifies hardlink topology without changing content roots', async () => {
  const outer = temporaryDirectory('phantom-manifest-hardlinks-');
  try {
    const linkedRoot = path.join(outer, 'linked');
    const independentRoot = path.join(outer, 'independent');
    fs.mkdirSync(linkedRoot);
    fs.mkdirSync(independentRoot);
    fs.writeFileSync(path.join(linkedRoot, 'alpha.txt'), 'same\n');
    fs.linkSync(path.join(linkedRoot, 'alpha.txt'), path.join(linkedRoot, 'beta.txt'));
    fs.writeFileSync(path.join(independentRoot, 'alpha.txt'), 'same\n');
    fs.writeFileSync(path.join(independentRoot, 'beta.txt'), 'same\n');

    const { buildWorkspaceManifest, verifyWorkspaceManifest } = await import(MANIFEST_MODULE);
    const linked = buildWorkspaceManifest(linkedRoot);
    const independent = buildWorkspaceManifest(independentRoot);
    const [alpha, beta] = physicalEntries(linked);

    assert.equal(alpha.dev, beta.dev);
    assert.equal(alpha.ino, beta.ino);
    assert.equal(alpha.nlink, 2);
    assert.equal(beta.nlink, 2);
    assert.equal(linked.evidence.content_root, independent.evidence.content_root);
    assert.equal(linked.evidence.fingerprint, independent.evidence.fingerprint);
    assert.equal(linked.evidence.manifest_digest, independent.evidence.manifest_digest);
    assert.notEqual(
      linked.evidence.physical_topology_root,
      independent.evidence.physical_topology_root,
    );
    assert.notEqual(linked.evidence.physical_root, independent.evidence.physical_root);
    assert.notEqual(linked.evidence.evidence_digest, independent.evidence.evidence_digest);

    const partitionMutation = structuredClone(linked);
    const betaShard = partitionMutation.physical_shards.find((shard) =>
      shard.entries.some((entry) => entry.path === 'beta.txt'));
    const betaEntry = betaShard.entries.find((entry) => entry.path === 'beta.txt');
    betaEntry.ino = String(BigInt(betaEntry.ino) + 1n);
    const { digest: ignoredDigest, ...unsignedShard } = betaShard;
    void ignoredDigest;
    betaShard.digest = domainDigest('phantom-workspace-physical-shard-v2', unsignedShard);
    assert.throws(
      () => verifyWorkspaceManifest(partitionMutation),
      /topology digest is invalid/,
      'full verification must derive portable topology from the raw dev/ino partition',
    );
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('large regular files are hashed in bounded descriptor reads', async () => {
  const workspace = temporaryDirectory('phantom-manifest-streaming-');
  try {
    const size = (4 * 1024 * 1024) + 17;
    const bytes = Buffer.alloc(size, 0x5a);
    fs.writeFileSync(path.join(workspace, 'large.bin'), bytes);
    const { buildWorkspaceManifest } = await import(MANIFEST_MODULE);
    const manifest = buildWorkspaceManifest(workspace);

    assert.equal(
      contentEntries(manifest)[0].digest,
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    );
    assert.equal(manifest.instrumentation.content_files_hashed, 1);
    assert.equal(manifest.instrumentation.content_bytes_hashed, size);
    assert.ok(manifest.instrumentation.content_read_operations > 1);
    assert.ok(manifest.instrumentation.max_content_chunk_bytes <= 64 * 1024);
    assert.ok(manifest.instrumentation.max_content_chunk_bytes < size);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('post-traversal validation rejects mixed-time cache publication', () => {
  const script = String.raw`
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const { createWorkspaceSnapshotCache, workspaceSnapshot } =
  await import('./skills/phantom/scripts/lib/filesystem-snapshot.mjs?race-regression');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-snapshot-race-'));
const early = path.join(workspace, 'a-early.txt');
const late = path.join(workspace, 'z-large.bin');
const cache = createWorkspaceSnapshotCache();
let originalReadSync;
try {
  fs.writeFileSync(early, 'before');
  fs.writeFileSync(late, Buffer.alloc((2 * 1024 * 1024) + 17, 0x31));
  workspaceSnapshot(workspace, { cache });
  fs.writeFileSync(late, Buffer.alloc((2 * 1024 * 1024) + 19, 0x32));

  originalReadSync = fs.readSync;
  let mutated = false;
  fs.readSync = function patchedReadSync(...args) {
    if (!mutated) {
      mutated = true;
      fs.writeFileSync(early, 'during');
    }
    return originalReadSync.apply(this, args);
  };
  syncBuiltinESMExports();

  let raceError = null;
  try {
    workspaceSnapshot(workspace, { cache });
  } catch (error) {
    raceError = error.message;
  } finally {
    fs.readSync = originalReadSync;
    syncBuiltinESMExports();
  }

  fs.writeFileSync(early, 'before');
  const retry = workspaceSnapshot(workspace, { cache });
  console.log(JSON.stringify({
    mutated,
    raceError,
    retryFilesHashed: retry.instrumentation.content_files_hashed,
  }));
} finally {
  if (originalReadSync) {
    fs.readSync = originalReadSync;
    syncBuiltinESMExports();
  }
  fs.rmSync(workspace, { recursive: true, force: true });
}
`;
  const result = JSON.parse(execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  ));

  assert.equal(result.mutated, true);
  assert.match(result.raceError, /changed during snapshot validation/);
  assert.equal(result.retryFilesHashed, 2, 'a failed traversal must not publish its cache');
});

test('artifact paths reject non-portable forms', async () => {
  const workspace = temporaryDirectory('phantom-manifest-portable-paths-');
  try {
    fs.writeFileSync(path.join(workspace, 'safe.txt'), 'safe\n');
    const {
      buildWorkspaceManifest,
      workspaceManifestArtifacts,
    } = await import(MANIFEST_MODULE);
    const manifest = buildWorkspaceManifest(workspace);
    for (const prefix of [
      '/absolute',
      '//server/share',
      'C:/drive',
      'C:drive-relative',
      'C:\\drive',
      './dot',
      '../dotdot',
      'nested/./dot',
      'nested/../dotdot',
      'nested//repeated',
      'nul\0name',
    ]) {
      assert.throws(
        () => workspaceManifestArtifacts(manifest, prefix),
        /prefix must be portable/,
      );
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('construction rejects POSIX filesystem names containing backslashes', {
  skip: process.platform === 'win32' ? 'POSIX backslash filenames are not constructible on Windows.' : false,
}, async () => {
  const workspace = temporaryDirectory('phantom-manifest-backslash-path-');
  try {
    fs.writeFileSync(path.join(workspace, 'bad\\name.txt'), 'unsafe\n');
    const { buildWorkspaceManifest } = await import(MANIFEST_MODULE);
    assert.throws(
      () => buildWorkspaceManifest(workspace),
      /non-portable path/,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('manifest and delta verification reject omitted or altered evidence', async () => {
  const workspace = temporaryDirectory('phantom-manifest-verification-');
  try {
    fs.writeFileSync(path.join(workspace, 'one.txt'), 'one\n');
    fs.writeFileSync(path.join(workspace, 'two.txt'), 'two\n');
    const {
      buildWorkspaceManifest,
      diffWorkspaceManifests,
      verifyWorkspaceDelta,
      verifyWorkspaceManifest,
    } = await import(MANIFEST_MODULE);
    const before = buildWorkspaceManifest(workspace);
    fs.writeFileSync(path.join(workspace, 'one.txt'), 'changed\n');
    fs.unlinkSync(path.join(workspace, 'two.txt'));
    fs.writeFileSync(path.join(workspace, 'three.txt'), 'three\n');
    const after = buildWorkspaceManifest(workspace);
    const delta = diffWorkspaceManifests(before, after);

    assert.deepEqual(delta.changed_paths, ['one.txt', 'three.txt', 'two.txt']);
    assert.equal(verifyWorkspaceDelta(delta, before, after), true);
    assert.equal(delta.from.snapshot_digest, before.evidence.snapshot_digest);
    assert.equal(delta.to.snapshot_digest, after.evidence.snapshot_digest);

    const oldShape = structuredClone(before);
    delete oldShape.evidence.snapshot_digest;
    assert.throws(
      () => verifyWorkspaceManifest(oldShape),
      /evidence does not match its shards/,
      'pre-snapshot-digest v2 evidence must not receive a compatibility path',
    );
    const omitted = structuredClone(delta);
    omitted.changed_paths.pop();
    assert.throws(
      () => verifyWorkspaceDelta(omitted, before, after),
      /does not match/,
    );

    const altered = structuredClone(after);
    altered.content_shards[0].entries[0].digest = `sha256:${'0'.repeat(64)}`;
    assert.throws(
      () => verifyWorkspaceManifest(altered),
      /digest is invalid/,
    );

    const extended = structuredClone(after);
    extended.content_shards[0].entries[0].unexpected = true;
    assert.throws(
      () => verifyWorkspaceManifest(extended),
      /invalid entry/,
    );

    const emptyShard = structuredClone(after);
    emptyShard.content_shards.push({
      schema_version: 2,
      kind: 'content',
      bucket: 'ff',
      entry_count: 0,
      entries: [],
      digest: `sha256:${'0'.repeat(64)}`,
    });
    assert.throws(
      () => verifyWorkspaceManifest(emptyShard),
      /malformed/,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('workspace scanner has no file ceiling and reuses all 25,001 stable generations', async () => {
  const workspace = temporaryDirectory('phantom-manifest-large-');
  try {
    const count = 25_001;
    for (let index = 0; index < count; index += 1) {
      fs.writeFileSync(path.join(workspace, `f-${String(index).padStart(5, '0')}`), '');
    }
    const {
      buildWorkspaceManifest,
      createWorkspaceManifestCache,
      verifyWorkspaceManifest,
    } = await import(MANIFEST_MODULE);
    const snapshotExports = await import(SNAPSHOT_MODULE);
    assert.equal(Object.hasOwn(snapshotExports, 'MAX_SNAPSHOT_FILES'), false);

    const cache = createWorkspaceManifestCache();
    const cold = buildWorkspaceManifest(workspace, { cache });
    assert.equal(cold.evidence.entry_count, count);
    assert.equal(cold.instrumentation.content_files_hashed, count);
    assert.ok(cold.evidence.content_shards.length <= 256);
    assert.equal(verifyWorkspaceManifest(cold), true);

    const warm = buildWorkspaceManifest(workspace, { cache });
    assert.equal(warm.evidence.entry_count, count);
    assert.equal(warm.instrumentation.content_files_hashed, 0);
    assert.equal(warm.instrumentation.cache_hits, count);
    assert.equal(warm.evidence.evidence_digest, cold.evidence.evidence_digest);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('only opaque cache handles created by the v2 API are accepted', async () => {
  const workspace = temporaryDirectory('phantom-manifest-opaque-cache-');
  try {
    fs.writeFileSync(path.join(workspace, 'safe.txt'), 'safe\n');
    const { workspaceSnapshot } = await import(SNAPSHOT_MODULE);
    assert.throws(
      () => workspaceSnapshot(workspace, { cache: { records: new Map() } }),
      /must come from createWorkspaceSnapshotCache/,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
