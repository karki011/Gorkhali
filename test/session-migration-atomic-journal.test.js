// Author: Subash Karki
'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE = pathToFileURL(require.resolve(
  '../skills/phantom/scripts/lib/session-migration/atomic-journal.mjs',
)).href;
const roots = new Set();
const openLeases = new Set();
let atomic;

before(async () => { atomic = await import(MODULE); });
after(() => {
  for (const close of openLeases) close();
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-atomic-journal-')));
  fs.chmodSync(root, 0o700); roots.add(root);
  return { root, file: path.join(root, 'migration.jsonl') };
}

const digest = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
function event(sequence, previousEventDigest, value = `event-${sequence}`) {
  const input = { payload: { value }, previous_event_digest: previousEventDigest, sequence };
  return { ...input, event_digest: digest(atomic.canonicalJson(input)) };
}
const line = (value) => `${atomic.canonicalJson(value)}\n`;
function validateEvent(value, context) {
  if (value?.sequence !== context.index + 1 || value?.previous_event_digest !== context.previousDigest) return false;
  const { event_digest: supplied, ...input } = value;
  return supplied === digest(atomic.canonicalJson(input));
}
function hooks(overrides = {}) {
  return { validateEvent, eventDigest: (value) => value.event_digest,
    eventIdentity: (value) => value.sequence, ...overrides };
}
function options(world, overrides = {}) {
  return { trustedRoot: world.root, journalPath: world.file, ...hooks(), ...overrides };
}
function append(world, value, expectedPredecessor, extra = {}) {
  return atomic.appendAtomicJournalEvent(options(world, {
    canonicalLine: line(value), expectedPredecessor, ...extra,
  }));
}
function snapshot(world, extra = {}) {
  return atomic.readAtomicJournalSnapshot(options(world, extra));
}
function temporaryNames(world) {
  const prefix = atomic.atomicJournalTemporaryPrefix(world.file);
  return fs.readdirSync(world.root).filter((name) => name.startsWith(prefix));
}
function crashAfterNoReplaceLink(world, value) {
  const script = `
    import * as atomic from ${JSON.stringify(MODULE)};
    const value = JSON.parse(process.argv[1]);
    const canonicalLine = process.argv[2];
    atomic.appendAtomicJournalEvent({
      trustedRoot: process.argv[3], journalPath: process.argv[4], canonicalLine,
      expectedPredecessor: null, validateEvent: () => true,
      eventDigest: (event) => event.event_digest, eventIdentity: (event) => event.sequence,
      checkpoint(name) { if (name === 'after_no_replace_link') process.kill(process.pid, 'SIGKILL'); },
    });
  `;
  const child = childProcess.spawnSync(process.execPath,
    ['--input-type=module', '--eval', script, JSON.stringify(value), line(value), world.root, world.file]);
  assert.equal(child.signal, 'SIGKILL', child.stderr.toString());
}

function lockRaw(migrationId, token, pid = process.pid) {
  return `${JSON.stringify({
    pid, token, migration_id: migrationId,
    created_at: '2026-08-01T12:00:00.000Z', state: 'active',
    claim_epoch: null, claim_digest: null,
  })}\n`;
}
function createLease(world, repositoryId = 'migration-repo', owners = {}) {
  const locks = path.join(world.root, 'locks');
  fs.mkdirSync(locks, { mode: 0o700 }); fs.chmodSync(locks, 0o700);
  const migrationId = `sha256:${'a'.repeat(64)}`;
  function proof(name, token, pid) {
    const file = path.join(locks, name); const raw = lockRaw(migrationId, token, pid);
    fs.writeFileSync(file, raw, { mode: 0o600 });
    const descriptor = fs.openSync(file, 'r'); const stat = fs.fstatSync(descriptor, { bigint: true });
    return { file, raw, descriptor, device: stat.dev.toString(), inode: stat.ino.toString(), released: false };
  }
  const globalLock = proof('.session-state-migration.lock', 'global-token', owners.globalPid);
  const repositoryLock = proof(`${repositoryId}.lock`, 'repository-token', owners.repositoryPid);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    for (const item of [globalLock, repositoryLock]) {
      try { fs.closeSync(item.descriptor); } catch {}
    }
    openLeases.delete(close);
  };
  openLeases.add(close);
  return { migrationId, repositoryId, globalLock, repositoryLock, close };
}

test('exports stable bounds, scratch reservation, and error codes', () => {
  assert.equal(atomic.MAX_ATOMIC_JOURNAL_EVENTS, 9);
  assert.equal(atomic.MAX_ATOMIC_JOURNAL_LINE_BYTES, 16 * 1024);
  assert.equal(atomic.MAX_ATOMIC_JOURNAL_BYTES, 144 * 1024);
  assert.equal(atomic.ATOMIC_JOURNAL_FREE_SPACE_SCRATCH_BYTES, 144 * 1024);
  assert.equal(atomic.MAX_ATOMIC_JOURNAL_JSON_DEPTH, 64);
  assert.equal(atomic.ATOMIC_JOURNAL_ERROR_CODES.LEASE_REQUIRED, 'PHANTOM_JOURNAL_LEASE_REQUIRED');
});

test('absent publication prepares fully then installs one private link', () => {
  const world = fixture(); const first = event(1, null); let prepared = false;
  const result = append(world, first, null, { checkpoint(name, context) {
    if (name !== 'after_prepare') return;
    prepared = true; assert.equal(fs.existsSync(world.file), false);
    assert.equal(fs.readFileSync(context.temporaryPath, 'utf8'), line(first));
    assert.equal(fs.statSync(context.temporaryPath).mode & 0o777, 0o600);
  } });
  assert.equal(prepared, true); assert.equal(result.status, 'appended');
  assert.equal(fs.readFileSync(world.file, 'utf8'), line(first));
  const stat = fs.lstatSync(world.file);
  assert.equal(stat.nlink, 1); assert.equal(stat.mode & 0o777, 0o600);
  assert.deepEqual(temporaryNames(world), []);
});

test('absent boundary admits exactly one of two competing no-replace publishers', () => {
  const world = fixture(); const first = event(1, null, 'first'); const winner = event(1, null, 'winner');
  let nested;
  assert.throws(() => append(world, first, null, { checkpoint(name) {
    if (name === 'before_no_replace' && !nested) nested = append(world, winner, null);
  } }), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.EXISTS);
  assert.equal(nested.status, 'appended'); assert.equal(fs.readFileSync(world.file, 'utf8'), line(winner));
  assert.deepEqual(temporaryNames(world), []);
});

test('real publisher death after no-replace link recovers only its exact two-link inode', () => {
  const world = fixture(); const first = event(1, null);
  crashAfterNoReplaceLink(world, first);
  const staging = temporaryNames(world);
  assert.equal(staging.length, 1);
  const journalStat = fs.lstatSync(world.file);
  const stagingStat = fs.lstatSync(path.join(world.root, staging[0]));
  assert.equal(journalStat.nlink, 2); assert.equal(stagingStat.nlink, 2);
  assert.equal(journalStat.dev, stagingStat.dev); assert.equal(journalStat.ino, stagingStat.ino);
  assert.deepEqual(snapshot(world).events, [first]);
  assert.equal(fs.lstatSync(world.file).nlink, 1); assert.deepEqual(temporaryNames(world), []);
  assert.equal(append(world, first, null).status, 'already_present');
});

test('unrelated two-link and multiply-linked staging are never accepted as recovery', async (suite) => {
  await suite.test('unrelated two-link inode', () => {
    const world = fixture(); const first = event(1, null); append(world, first, null);
    const unrelated = path.join(world.root, 'unrelated.jsonl');
    const temporary = path.join(world.root,
      `${atomic.atomicJournalTemporaryPrefix(world.file)}99999999-${crypto.randomUUID()}`);
    fs.writeFileSync(unrelated, line(first), { mode: 0o600 }); fs.linkSync(unrelated, temporary);
    assert.throws(() => snapshot(world), (error) => [
      atomic.ATOMIC_JOURNAL_ERROR_CODES.STAGING, atomic.ATOMIC_JOURNAL_ERROR_CODES.TYPE,
    ].includes(error.code));
    assert.equal(fs.existsSync(temporary), true); assert.equal(fs.lstatSync(world.file).nlink, 1);
  });
  await suite.test('three-link inode', () => {
    const world = fixture(); const first = event(1, null); crashAfterNoReplaceLink(world, first);
    fs.linkSync(world.file, path.join(world.root, 'third-link.jsonl'));
    assert.throws(() => snapshot(world),
      (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.TYPE);
    assert.equal(fs.lstatSync(world.file).nlink, 3); assert.equal(temporaryNames(world).length, 1);
  });
  await suite.test('linked recovery staging swap', () => {
    const world = fixture(); const first = event(1, null); crashAfterNoReplaceLink(world, first);
    const temporary = path.join(world.root, temporaryNames(world)[0]); let swapped = false;
    assert.throws(() => snapshot(world, { checkpoint(name) {
      if (name !== 'before_linked_recovery_cleanup' || swapped) return;
      swapped = true; const replacement = path.join(world.root, 'replacement.tmp');
      fs.writeFileSync(replacement, line(first), { mode: 0o600 }); fs.renameSync(replacement, temporary);
    } }), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.CHANGED);
    assert.equal(fs.existsSync(temporary), true); assert.equal(fs.lstatSync(world.file).nlink, 1);
  });
});

test('N to N+1 replacement requires and accepts exact global plus repository lease proof', () => {
  const world = fixture(); const first = event(1, null); const second = event(2, first.event_digest);
  append(world, first, null);
  assert.throws(() => append(world, second, first.event_digest),
    (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.LEASE_REQUIRED);
  const lease = createLease(world);
  const result = append(world, second, first.event_digest, { replacementLease: lease });
  assert.equal(result.status, 'appended'); assert.deepEqual(snapshot(world).events, [first, second]);
  lease.close();
});

test('closed and revoked replacement leases fail without journal mutation', () => {
  const invalidWorld = fixture(); const first = event(1, null); const second = event(2, first.event_digest);
  append(invalidWorld, first, null); const invalid = createLease(invalidWorld);
  fs.closeSync(invalid.repositoryLock.descriptor); invalid.repositoryLock.descriptor = -1;
  assert.throws(() => append(invalidWorld, second, first.event_digest, { replacementLease: invalid }),
    (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID);
  invalid.close(); assert.equal(fs.readFileSync(invalidWorld.file, 'utf8'), line(first));

  const revokedWorld = fixture(); append(revokedWorld, first, null); const revoked = createLease(revokedWorld);
  assert.throws(() => append(revokedWorld, second, first.event_digest, {
    replacementLease: revoked, checkpoint(name) {
      if (name === 'after_prepare') fs.unlinkSync(revoked.repositoryLock.file);
    },
  }), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID);
  assert.equal(fs.readFileSync(revokedWorld.file, 'utf8'), line(first));
  assert.deepEqual(temporaryNames(revokedWorld), []); revoked.close();
});

test('foreign and mixed lock owners cannot authorize replacement', () => {
  for (const owners of [{ globalPid: process.pid + 100000 }, { repositoryPid: process.pid + 100001 }]) {
    const world = fixture(); const first = event(1, null); append(world, first, null);
    const lease = createLease(world, 'migration-repo', owners);
    assert.throws(() => append(world, event(2, first.event_digest), first.event_digest,
      { replacementLease: lease }),
    (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID);
    assert.equal(fs.readFileSync(world.file, 'utf8'), line(first)); lease.close();
  }
});

test('byte-identical predecessor replacement is refused under a valid lease', () => {
  const world = fixture(); const first = event(1, null); const second = event(2, first.event_digest);
  append(world, first, null); const lease = createLease(world);
  assert.throws(() => append(world, second, first.event_digest, {
    replacementLease: lease, checkpoint(name) {
      if (name !== 'after_prepare') return;
      const replacement = path.join(world.root, 'replacement.jsonl');
      fs.writeFileSync(replacement, fs.readFileSync(world.file), { mode: 0o600 });
      fs.renameSync(replacement, world.file);
    },
  }), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.CHANGED);
  assert.equal(fs.readFileSync(world.file, 'utf8'), line(first)); lease.close();
});

test('post-rename pre-fsync retry binds and durably flushes the published inode', () => {
  const world = fixture(); const first = event(1, null); const second = event(2, first.event_digest);
  append(world, first, null); const lease = createLease(world);
  assert.throws(() => append(world, second, first.event_digest, {
    replacementLease: lease, checkpoint(name) {
      if (name === 'after_rename') throw new Error('post-rename interruption');
    },
  }), /post-rename interruption/);
  const syncStages = [];
  const retry = append(world, second, first.event_digest, { fsyncFault(stage) { syncStages.push(stage); } });
  assert.equal(retry.status, 'already_present');
  assert.deepEqual(syncStages, ['retry-file', 'retry-parent']);
  assert.equal(snapshot(world).events.length, 2); assert.deepEqual(temporaryNames(world), []); lease.close();
  assert.throws(() => append(world, event(2, first.event_digest, 'mismatch'), first.event_digest),
    (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.DUPLICATE);
});

test('pathname replacement during an opened snapshot is detected', () => {
  const world = fixture(); const first = event(1, null); append(world, first, null); let replaced = false;
  assert.throws(() => snapshot(world, { checkpoint(name) {
    if (name !== 'after_path_open' || replaced) return;
    replaced = true; const replacement = path.join(world.root, 'same-bytes.jsonl');
    fs.writeFileSync(replacement, line(first), { mode: 0o600 }); fs.renameSync(replacement, world.file);
  } }), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.CHANGED);
});

test('already-present retry rejects a pathname swap after opening its durable inode', () => {
  const world = fixture(); const first = event(1, null); append(world, first, null); let opens = 0;
  assert.throws(() => append(world, first, null, { checkpoint(name) {
    if (name !== 'after_path_open' || ++opens !== 2) return;
    const replacement = path.join(world.root, 'retry-swap.jsonl');
    fs.writeFileSync(replacement, line(first), { mode: 0o600 }); fs.renameSync(replacement, world.file);
  } }), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.CHANGED);
});

test('truncated, blank, noncanonical, oversized, and bad semantic input fail closed', async (suite) => {
  for (const [name, raw, code] of [
    ['truncated', () => atomic.canonicalJson(event(1, null)), 'CANONICAL'],
    ['blank', () => `${line(event(1, null))}\n`, 'CANONICAL'],
    ['noncanonical', () => `${JSON.stringify(event(1, null))}\n`, 'CANONICAL'],
  ]) {
    await suite.test(name, () => {
      const world = fixture(); fs.writeFileSync(world.file, raw(), { mode: 0o600 });
      assert.throws(() => snapshot(world),
        (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES[code]);
    });
  }
  await suite.test('oversized', () => {
    const world = fixture(); const value = event(1, null, 'x'.repeat(atomic.MAX_ATOMIC_JOURNAL_LINE_BYTES));
    assert.throws(() => append(world, value, null),
      (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.BOUNDS);
  });
  await suite.test('semantic callback', () => {
    const world = fixture();
    assert.throws(() => append(world, event(1, null), null, { validateEvent: () => false }),
      (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.SEMANTIC);
  });
});

test('iterative JSON bounds reject excessive depth and node count before caller canonicalization', () => {
  const deepWorld = fixture(); let deep = 'leaf';
  for (let index = 0; index < atomic.MAX_ATOMIC_JOURNAL_JSON_DEPTH + 2; index += 1) deep = { child: deep };
  assert.throws(() => atomic.appendAtomicJournalEvent(options(deepWorld, {
    canonicalLine: `${JSON.stringify(deep)}\n`, expectedPredecessor: null,
    canonicalize: JSON.stringify, validateEvent: () => true,
    eventDigest: () => 'digest', eventIdentity: () => 'identity',
  })), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.BOUNDS);

  const wideWorld = fixture(); const wide = Array.from({ length: atomic.MAX_ATOMIC_JOURNAL_JSON_NODES }, () => 0);
  assert.throws(() => atomic.appendAtomicJournalEvent(options(wideWorld, {
    canonicalLine: `${JSON.stringify(wide)}\n`, expectedPredecessor: null,
    canonicalize: JSON.stringify, validateEvent: () => true,
    eventDigest: () => 'digest', eventIdentity: () => 'identity',
  })), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.BOUNDS);
});

test('unsupported and non-finite JSON scalars have stable canonical errors', () => {
  for (const value of [1n, NaN, Infinity, -Infinity, undefined, Symbol('invalid')]) {
    assert.throws(() => atomic.canonicalJson(value),
      (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.CANONICAL);
  }
});

test('trusted root, parent privacy, and ownership boundary fail closed', () => {
  const world = fixture(); fs.chmodSync(world.root, 0o755);
  assert.throws(() => snapshot(world),
    (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.PATH);
  fs.chmodSync(world.root, 0o700);
  assert.throws(() => snapshot({ root: world.root, file: path.join(world.root, '..', 'escape.jsonl') }),
    (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.PATH);
});

test('reserved lock namespace is rejected before lock bytes or inodes can change', () => {
  const world = fixture(); const lease = createLease(world);
  const locks = [lease.globalLock.file, lease.repositoryLock.file];
  const before = locks.map((file) => ({ bytes: fs.readFileSync(file), stat: fs.lstatSync(file) }));
  for (const journalPath of [path.join(world.root, 'locks', 'journal.jsonl'),
    path.join(lease.globalLock.file, 'descendant.jsonl'),
    path.join(lease.repositoryLock.file, 'descendant.jsonl'), ...locks]) {
    assert.throws(() => atomic.appendAtomicJournalEvent(options(world, {
      journalPath, canonicalLine: line(event(1, null)), expectedPredecessor: null,
    })), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.PATH);
  }
  locks.forEach((file, index) => {
    const afterStat = fs.lstatSync(file);
    assert.deepEqual(fs.readFileSync(file), before[index].bytes);
    assert.equal(afterStat.dev, before[index].stat.dev); assert.equal(afterStat.ino, before[index].stat.ino);
  });
  lease.close();
});

test('symlinked root, parent, journal, and repository lock paths fail closed', () => {
  const world = fixture(); const rootLink = `${world.root}-link`; fs.symlinkSync(world.root, rootLink, 'dir');
  assert.throws(() => snapshot({ root: rootLink, file: path.join(rootLink, 'journal.jsonl') }),
    (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.PATH);
  fs.unlinkSync(rootLink);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-journal-outside-')));
  fs.chmodSync(outside, 0o700); roots.add(outside);
  const parentLink = path.join(world.root, 'linked-parent'); fs.symlinkSync(outside, parentLink, 'dir');
  assert.throws(() => snapshot({ root: world.root, file: path.join(parentLink, 'journal.jsonl') }),
    (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.PATH);
  fs.unlinkSync(parentLink);
  const target = path.join(world.root, 'target.jsonl'); fs.writeFileSync(target, line(event(1, null)), { mode: 0o600 });
  fs.symlinkSync(target, world.file);
  assert.throws(() => snapshot(world), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.TYPE);
  fs.unlinkSync(world.file); append(world, event(1, null), null);
  const lease = createLease(world); fs.unlinkSync(lease.repositoryLock.file);
  fs.symlinkSync(lease.globalLock.file, lease.repositoryLock.file);
  assert.throws(() => append(world, event(2, event(1, null).event_digest), event(1, null).event_digest,
    { replacementLease: lease }), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.LEASE_INVALID);
  lease.close();
});

test('unsafe, malformed, and path-replaced stale staging is retained and rejected', async (suite) => {
  function stale(world, suffix = `99999999-${crypto.randomUUID()}`) {
    return path.join(world.root, `${atomic.atomicJournalTemporaryPrefix(world.file)}${suffix}`);
  }
  await suite.test('unsafe mode', () => {
    const world = fixture(); const temporary = stale(world);
    fs.writeFileSync(temporary, line(event(1, null)), { mode: 0o644 });
    assert.throws(() => snapshot(world), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.TYPE);
    assert.equal(fs.existsSync(temporary), true);
  });
  await suite.test('malformed name', () => {
    const world = fixture(); const temporary = stale(world, 'malformed');
    fs.writeFileSync(temporary, line(event(1, null)), { mode: 0o600 });
    assert.throws(() => snapshot(world), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.STAGING);
    assert.equal(fs.existsSync(temporary), true);
  });
  await suite.test('malformed content', () => {
    const world = fixture(); const temporary = stale(world);
    fs.writeFileSync(temporary, '{"truncated":true}', { mode: 0o600 });
    assert.throws(() => snapshot(world),
      (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.CANONICAL);
    assert.equal(fs.existsSync(temporary), true);
  });
  await suite.test('path replacement before unlink', () => {
    const world = fixture(); const temporary = stale(world); let swapped = false;
    fs.writeFileSync(temporary, line(event(1, null)), { mode: 0o600 });
    assert.throws(() => snapshot(world, { checkpoint(name) {
      if (name !== 'before_staging_cleanup' || swapped) return;
      swapped = true; const replacement = path.join(world.root, 'replacement.tmp');
      fs.writeFileSync(replacement, line(event(1, null)), { mode: 0o600 }); fs.renameSync(replacement, temporary);
    } }), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.CHANGED);
    assert.equal(fs.existsSync(temporary), true);
  });
});

test('safe stale staging cleanup is exact and streaming directory bound is enforced', () => {
  const cleanWorld = fixture();
  const temporary = path.join(cleanWorld.root,
    `${atomic.atomicJournalTemporaryPrefix(cleanWorld.file)}99999999-${crypto.randomUUID()}`);
  fs.writeFileSync(temporary, line(event(1, null)), { mode: 0o600 });
  assert.equal(snapshot(cleanWorld).exists, false); assert.equal(fs.existsSync(temporary), false);

  const boundedWorld = fixture();
  for (let index = 0; index < 4097; index += 1) fs.writeFileSync(path.join(boundedWorld.root, `entry-${index}`), '');
  assert.throws(() => snapshot(boundedWorld),
    (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.BOUNDS);
});

test('every fsync stage fails stably with exact cleanup or durable retry', () => {
  const injected = (wanted) => (stage) => {
    if (stage === wanted) { const error = new Error(`injected ${stage}`); error.code = 'EIO'; throw error; }
  };
  for (const stage of ['prepared-file', 'prepared-parent']) {
    const world = fixture();
    assert.throws(() => append(world, event(1, null), null, { fsyncFault: injected(stage) }),
      (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.DURABILITY);
    assert.equal(fs.existsSync(world.file), false); assert.deepEqual(temporaryNames(world), []);
  }
  for (const stage of ['no-replace-parent', 'published-file', 'published-parent']) {
    const world = fixture(); const first = event(1, null);
    assert.throws(() => append(world, first, null, { fsyncFault: injected(stage) }),
      (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.DURABILITY);
    assert.equal(append(world, first, null).status, 'already_present');
    assert.deepEqual(temporaryNames(world), []);
  }
  const cleanupWorld = fixture();
  assert.throws(() => append(cleanupWorld, event(1, null), null, {
    checkpoint(name) { if (name === 'after_prepare') throw new Error('primary failure'); },
    fsyncFault: injected('cleanup-parent'),
  }), (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.STAGING);
  assert.equal(fs.existsSync(cleanupWorld.file), false); assert.deepEqual(temporaryNames(cleanupWorld), []);
  for (const stage of ['retry-file', 'retry-parent']) {
    const world = fixture(); const first = event(1, null); append(world, first, null);
    assert.throws(() => append(world, first, null, { fsyncFault: injected(stage) }),
      (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.DURABILITY);
    assert.equal(append(world, first, null).status, 'already_present');
  }
  for (const stage of ['recovery-file', 'recovery-parent']) {
    const world = fixture(); const first = event(1, null); crashAfterNoReplaceLink(world, first);
    assert.throws(() => snapshot(world, { fsyncFault: injected(stage) }),
      (error) => error.code === atomic.ATOMIC_JOURNAL_ERROR_CODES.DURABILITY);
    assert.deepEqual(snapshot(world).events, [first]); assert.deepEqual(temporaryNames(world), []);
    assert.equal(fs.lstatSync(world.file).nlink, 1);
  }
});
