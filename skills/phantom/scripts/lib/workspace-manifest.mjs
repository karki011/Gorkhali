// Author: Subash Karki

import { createHash } from 'node:crypto';

import {
  createWorkspaceSnapshotCache,
  isPortableWorkspacePath,
  snapshotDigest,
  workspaceSnapshot,
} from './filesystem-snapshot.mjs';

export const WORKSPACE_MANIFEST_ALGORITHM = 'phantom-workspace-merkle-v2';
export const WORKSPACE_DELTA_ALGORITHM = 'phantom-workspace-delta-v2';
export const WORKSPACE_MANIFEST_BUCKETS = 256;

export const WORKSPACE_MANIFEST_POLICY = Object.freeze({
  policy_id: 'portable-all-files-v2',
  tracked: 'include',
  untracked: 'include',
  ignored: 'include',
  control_exclusions: Object.freeze(['.git', '.phantom']),
  special_files: 'reject',
});

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const BUCKET = /^[a-f0-9]{2}$/;
const compareText = (left, right) => (left < right ? -1 : (left > right ? 1 : 0));

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestValue(domain, value) {
  return `sha256:${createHash('sha256')
    .update(`${domain}\0`)
    .update(canonicalJson(value))
    .digest('hex')}`;
}

function rawDigest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function bucketForPath(filePath) {
  return createHash('sha256').update(filePath, 'utf8').digest('hex').slice(0, 2);
}

function contentShardReference(shard) {
  return { bucket: shard.bucket, digest: shard.digest, entry_count: shard.entry_count };
}

function physicalShardReference(shard) {
  return {
    bucket: shard.bucket,
    digest: shard.digest,
    entry_count: shard.entry_count,
    topology_digest: shard.topology_digest,
  };
}

function contentShard(bucket, entries) {
  const unsigned = {
    schema_version: 2,
    kind: 'content',
    bucket,
    entry_count: entries.length,
    entries: entries.map((entry) => ({ ...entry })),
  };
  return { ...unsigned, digest: digestValue('phantom-workspace-content-shard-v2', unsigned) };
}

function physicalShard(bucket, entries) {
  return {
    schema_version: 2,
    kind: 'physical',
    bucket,
    entry_count: entries.length,
    entries: entries.map((entry) => ({ ...entry })),
  };
}

function buildShards(entries, factory) {
  const buckets = new Map();
  for (const entry of entries) {
    const bucket = bucketForPath(entry.path);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(entry);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([bucket, values]) => factory(
      bucket,
      values.sort((left, right) => compareText(left.path, right.path)),
    ));
}

function physicalAliasGroups(physicalShards) {
  const aliases = new Map();
  for (const entry of physicalShards.flatMap((shard) => shard.entries)) {
    const identity = `${entry.dev}:${entry.ino}`;
    const group = aliases.get(identity) ?? { paths: [], nlink: entry.nlink };
    if (group.nlink !== entry.nlink) {
      throw new Error(`Physical identity has inconsistent link counts: ${identity}.`);
    }
    group.paths.push(entry.path);
    aliases.set(identity, group);
  }
  return new Map([...aliases.entries()].map(([identity, group]) => {
    const paths = [...group.paths].sort(compareText);
    if (group.nlink < paths.length) {
      throw new Error(`Physical identity has ${paths.length} observed paths but nlink ${group.nlink}.`);
    }
    return [identity, { paths, nlink: group.nlink }];
  }));
}

function physicalShardTopologyDigest(shard, aliases) {
  const identities = [...new Set(shard.entries.map((entry) => `${entry.dev}:${entry.ino}`))];
  const groups = identities.map((identity) => aliases.get(identity))
    .sort((left, right) => compareText(left.paths[0], right.paths[0]));
  return digestValue('phantom-workspace-physical-shard-topology-v2', {
    schema_version: 2,
    bucket: shard.bucket,
    alias_groups: groups,
  });
}

function bindPhysicalTopology(physicalShards) {
  const aliases = physicalAliasGroups(physicalShards);
  return physicalShards.map((shard) => {
    const topologyDigest = physicalShardTopologyDigest(shard, aliases);
    const unsigned = { ...shard, topology_digest: topologyDigest };
    return {
      ...unsigned,
      digest: digestValue('phantom-workspace-physical-shard-v2', unsigned),
    };
  });
}

export function physicalTopologyRootFromReferences(physicalReferences) {
  return digestValue(
    'phantom-workspace-physical-topology-root-v2',
    physicalReferences.map(({ bucket, entry_count: entryCount, topology_digest: topologyDigest }) => ({
      bucket,
      entry_count: entryCount,
      topology_digest: topologyDigest,
    })),
  );
}

export const WORKSPACE_MANIFEST_POLICY_DIGEST = digestValue(
  'phantom-workspace-policy-v2',
  WORKSPACE_MANIFEST_POLICY,
);

function evidenceFromShards(contentShards, physicalShards) {
  const contentReferences = contentShards.map(contentShardReference);
  const physicalReferences = physicalShards.map(physicalShardReference);
  const snapshotDigestValue = snapshotDigest(contentShards
    .flatMap((shard) => shard.entries)
    .sort((left, right) => compareText(left.path, right.path)));
  const entryCount = contentReferences.reduce((total, item) => total + item.entry_count, 0);
  const regularFileCount = physicalReferences.reduce((total, item) => total + item.entry_count, 0);
  const contentRoot = digestValue('phantom-workspace-content-root-v2', contentReferences);
  const physicalRoot = digestValue('phantom-workspace-physical-root-v2', physicalReferences);
  const topologyRoot = physicalTopologyRootFromReferences(physicalReferences);
  const contentHeader = {
    schema_version: 2,
    algorithm: WORKSPACE_MANIFEST_ALGORITHM,
    policy_digest: WORKSPACE_MANIFEST_POLICY_DIGEST,
    snapshot_digest: snapshotDigestValue,
    content_root: contentRoot,
    entry_count: entryCount,
    regular_file_count: regularFileCount,
    symbolic_link_count: entryCount - regularFileCount,
    content_shards: contentReferences,
  };
  const manifestDigest = digestValue('phantom-workspace-manifest-v2', contentHeader);
  const fingerprint = digestValue('phantom-workspace-fingerprint-v2', {
    policy_digest: WORKSPACE_MANIFEST_POLICY_DIGEST,
    content_root: contentRoot,
  });
  const unsignedEvidence = {
    ...contentHeader,
    policy: structuredClone(WORKSPACE_MANIFEST_POLICY),
    fingerprint,
    manifest_digest: manifestDigest,
    physical_root: physicalRoot,
    physical_topology_root: topologyRoot,
    physical_shards: physicalReferences,
  };
  return {
    ...unsignedEvidence,
    evidence_digest: digestValue('phantom-workspace-evidence-v2', unsignedEvidence),
  };
}

export function createWorkspaceManifestCache() {
  return createWorkspaceSnapshotCache();
}

export function buildWorkspaceManifest(workspaceInput, { cache = null } = {}) {
  const snapshot = workspaceSnapshot(workspaceInput, { cache });
  const contentShards = buildShards(snapshot.files, contentShard);
  const physicalShards = bindPhysicalTopology(buildShards(snapshot.physical_files, physicalShard));
  const evidence = evidenceFromShards(contentShards, physicalShards);
  if (evidence.snapshot_digest !== snapshot.digest) {
    throw new Error('Workspace manifest snapshot digest does not match its source workspace snapshot.');
  }
  return {
    schema_version: 2,
    evidence,
    content_shards: contentShards,
    physical_shards: physicalShards,
    instrumentation: structuredClone(snapshot.instrumentation),
  };
}

function assertDigest(value, label) {
  if (!DIGEST.test(value || '')) throw new Error(`${label} must be a SHA-256 digest.`);
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(compareText);
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function assertSortedUniquePaths(entries, label) {
  let previous = null;
  for (const entry of entries) {
    if (!isPortableWorkspacePath(entry.path)) {
      throw new Error(`${label} contains a non-portable path.`);
    }
    if (previous !== null && entry.path <= previous) {
      throw new Error(`${label} paths must be unique and sorted.`);
    }
    previous = entry.path;
  }
}

function validateContentShard(shard) {
  if (!hasExactKeys(shard, ['bucket', 'digest', 'entries', 'entry_count', 'kind', 'schema_version'])
    || shard.schema_version !== 2 || shard.kind !== 'content'
    || !BUCKET.test(shard.bucket || '') || !Array.isArray(shard.entries) || shard.entries.length === 0
    || shard.entry_count !== shard.entries.length) {
    throw new Error('Workspace content shard is malformed.');
  }
  assertSortedUniquePaths(shard.entries, `content shard ${shard.bucket}`);
  for (const entry of shard.entries) {
    if (!hasExactKeys(entry, ['digest', 'kind', 'mode', 'path'])
      || bucketForPath(entry.path) !== shard.bucket
      || !['file', 'symlink'].includes(entry.kind)
      || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o7777) {
      throw new Error(`Content shard ${shard.bucket} contains an invalid entry.`);
    }
    assertDigest(entry.digest, `content shard ${shard.bucket} entry digest`);
  }
  const unsigned = {
    schema_version: 2,
    kind: 'content',
    bucket: shard.bucket,
    entry_count: shard.entry_count,
    entries: shard.entries,
  };
  const expected = digestValue('phantom-workspace-content-shard-v2', unsigned);
  if (shard.digest !== expected) throw new Error(`Content shard ${shard.bucket} digest is invalid.`);
}

function validatePhysicalShard(shard) {
  if (!hasExactKeys(shard, [
    'bucket', 'digest', 'entries', 'entry_count', 'kind', 'schema_version', 'topology_digest',
  ])
    || shard.schema_version !== 2 || shard.kind !== 'physical'
    || !BUCKET.test(shard.bucket || '') || !Array.isArray(shard.entries) || shard.entries.length === 0
    || shard.entry_count !== shard.entries.length) {
    throw new Error('Workspace physical shard is malformed.');
  }
  assertSortedUniquePaths(shard.entries, `physical shard ${shard.bucket}`);
  for (const entry of shard.entries) {
    if (!hasExactKeys(entry, ['dev', 'ino', 'nlink', 'path'])
      || bucketForPath(entry.path) !== shard.bucket
      || !/^[0-9]+$/.test(entry.dev || '') || !/^[0-9]+$/.test(entry.ino || '')
      || !Number.isInteger(entry.nlink) || entry.nlink < 1) {
      throw new Error(`Physical shard ${shard.bucket} contains an invalid entry.`);
    }
  }
  assertDigest(shard.topology_digest, `physical shard ${shard.bucket} topology digest`);
  const unsigned = {
    schema_version: 2,
    kind: 'physical',
    bucket: shard.bucket,
    entry_count: shard.entry_count,
    entries: shard.entries,
    topology_digest: shard.topology_digest,
  };
  const expected = digestValue('phantom-workspace-physical-shard-v2', unsigned);
  if (shard.digest !== expected) throw new Error(`Physical shard ${shard.bucket} digest is invalid.`);
}

function assertUniqueBuckets(shards, label) {
  let previous = null;
  for (const shard of shards) {
    if (previous !== null && shard.bucket <= previous) {
      throw new Error(`${label} buckets must be unique and sorted.`);
    }
    previous = shard.bucket;
  }
}

export function verifyWorkspaceManifest(bundle) {
  if (!hasExactKeys(bundle, [
    'content_shards',
    'evidence',
    'instrumentation',
    'physical_shards',
    'schema_version',
  ])
    || bundle.schema_version !== 2 || !Array.isArray(bundle.content_shards)
    || !Array.isArray(bundle.physical_shards) || !bundle.evidence) {
    throw new Error('Workspace manifest bundle is malformed.');
  }
  bundle.content_shards.forEach(validateContentShard);
  bundle.physical_shards.forEach(validatePhysicalShard);
  assertUniqueBuckets(bundle.content_shards, 'content shards');
  assertUniqueBuckets(bundle.physical_shards, 'physical shards');

  const contentEntries = bundle.content_shards.flatMap((shard) => shard.entries);
  const physicalEntries = bundle.physical_shards.flatMap((shard) => shard.entries);
  const regularPaths = contentEntries
    .filter((entry) => entry.kind === 'file')
    .map((entry) => entry.path)
    .sort(compareText);
  const physicalPaths = physicalEntries.map((entry) => entry.path).sort(compareText);
  if (canonicalJson(regularPaths) !== canonicalJson(physicalPaths)) {
    throw new Error('Physical shards must bind every regular content entry exactly once.');
  }

  const aliases = physicalAliasGroups(bundle.physical_shards);
  for (const shard of bundle.physical_shards) {
    if (shard.topology_digest !== physicalShardTopologyDigest(shard, aliases)) {
      throw new Error(`Physical shard ${shard.bucket} topology digest is invalid.`);
    }
  }

  const expectedEvidence = evidenceFromShards(bundle.content_shards, bundle.physical_shards);
  if (canonicalJson(bundle.evidence) !== canonicalJson(expectedEvidence)) {
    throw new Error('Workspace manifest evidence does not match its shards.');
  }
  return true;
}

export function compactWorkspaceEvidence(bundle) {
  verifyWorkspaceManifest(bundle);
  return structuredClone(bundle.evidence);
}

function evidenceReference(evidence) {
  return {
    algorithm: evidence.algorithm,
    fingerprint: evidence.fingerprint,
    policy_digest: evidence.policy_digest,
    snapshot_digest: evidence.snapshot_digest,
    manifest_digest: evidence.manifest_digest,
    evidence_digest: evidence.evidence_digest,
    physical_root: evidence.physical_root,
    physical_topology_root: evidence.physical_topology_root,
  };
}

function shardByBucket(shards) {
  return new Map(shards.map((shard) => [shard.bucket, shard]));
}

function changedShardReferences(beforeShards, afterShards) {
  const before = shardByBucket(beforeShards);
  const after = shardByBucket(afterShards);
  return [...new Set([...before.keys(), ...after.keys()])].sort(compareText)
    .filter((bucket) => before.get(bucket)?.digest !== after.get(bucket)?.digest)
    .map((bucket) => ({
      bucket,
      before_digest: before.get(bucket)?.digest ?? null,
      after_digest: after.get(bucket)?.digest ?? null,
    }));
}

function changedEntryPaths(beforeShards, afterShards, changedShards) {
  const before = shardByBucket(beforeShards);
  const after = shardByBucket(afterShards);
  const changed = [];
  for (const { bucket } of changedShards) {
    const beforeEntries = new Map((before.get(bucket)?.entries ?? []).map((entry) => [entry.path, entry]));
    const afterEntries = new Map((after.get(bucket)?.entries ?? []).map((entry) => [entry.path, entry]));
    for (const filePath of new Set([...beforeEntries.keys(), ...afterEntries.keys()])) {
      if (canonicalJson(beforeEntries.get(filePath) ?? null)
        !== canonicalJson(afterEntries.get(filePath) ?? null)) changed.push(filePath);
    }
  }
  return changed.sort(compareText);
}

export function diffWorkspaceManifests(beforeBundle, afterBundle) {
  verifyWorkspaceManifest(beforeBundle);
  verifyWorkspaceManifest(afterBundle);
  if (beforeBundle.evidence.policy_digest !== afterBundle.evidence.policy_digest) {
    throw new Error('Workspace manifests use different fingerprint policies.');
  }
  const changedContentShards = changedShardReferences(
    beforeBundle.content_shards,
    afterBundle.content_shards,
  );
  const changedPhysicalShards = changedShardReferences(
    beforeBundle.physical_shards,
    afterBundle.physical_shards,
  );
  const unsigned = {
    schema_version: 2,
    algorithm: WORKSPACE_DELTA_ALGORITHM,
    from: evidenceReference(beforeBundle.evidence),
    to: evidenceReference(afterBundle.evidence),
    changed_paths: changedEntryPaths(
      beforeBundle.content_shards,
      afterBundle.content_shards,
      changedContentShards,
    ),
    changed_physical_paths: changedEntryPaths(
      beforeBundle.physical_shards,
      afterBundle.physical_shards,
      changedPhysicalShards,
    ),
    changed_content_shards: changedContentShards,
    changed_physical_shards: changedPhysicalShards,
  };
  return { ...unsigned, delta_digest: digestValue('phantom-workspace-delta-evidence-v2', unsigned) };
}

export function verifyWorkspaceDelta(delta, beforeBundle, afterBundle) {
  const expected = diffWorkspaceManifests(beforeBundle, afterBundle);
  if (canonicalJson(delta) !== canonicalJson(expected)) {
    throw new Error('Workspace delta does not match its before and after manifests.');
  }
  return true;
}

export function workspaceManifestArtifacts(bundle, prefix = 'workflow/manifests') {
  verifyWorkspaceManifest(bundle);
  if (!isPortableWorkspacePath(prefix)) {
    throw new Error('Workspace manifest artifact prefix must be portable.');
  }
  const artifacts = [];
  const add = (filePath, value) => {
    const bytes = Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
    artifacts.push({ path: filePath, digest: rawDigest(bytes), bytes });
  };
  const evidenceName = bundle.evidence.evidence_digest.slice('sha256:'.length);
  add(`${prefix}/evidence/${evidenceName}.json`, bundle.evidence);
  for (const shard of bundle.content_shards) {
    add(`${prefix}/content/${shard.digest.slice('sha256:'.length)}.json`, shard);
  }
  for (const shard of bundle.physical_shards) {
    add(`${prefix}/physical/${shard.digest.slice('sha256:'.length)}.json`, shard);
  }
  return artifacts.sort((left, right) => compareText(left.path, right.path));
}
