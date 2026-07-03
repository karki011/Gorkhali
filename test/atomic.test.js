// Author: Subash Karki
// atomic.test.js — atomic write + advisory lock tests.
// Zero external deps: node:test + node:assert + node:fs + node:os + node:path.
// Concurrency is exercised with REAL child processes against real fs, no mocks.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { atomicWrite, atomicUpdate, withLock, readFileSafe, LockTimeoutError } = require('../scripts/lib/atomic');
const CLI = require.resolve('../scripts/lib/atomic');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-test-'));
}

// Run the module as a child process, feeding `stdin` when given.
function run(args, stdin) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, out, err }));
    p.stdin.end(stdin === undefined ? '' : stdin);
  });
}

// ── atomicWrite basics ──────────────────────────────────────────────────────

test('atomicWrite writes content and leaves no temp file behind', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'nested', 'f.txt');
  atomicWrite(target, 'hello');
  assert.equal(fs.readFileSync(target, 'utf8'), 'hello');
  atomicWrite(target, 'world'); // overwrite
  assert.equal(fs.readFileSync(target, 'utf8'), 'world');
  const leftovers = fs.readdirSync(path.dirname(target)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'temp files are renamed away, not left');
});

test('readFileSafe returns null for a missing file', () => {
  const dir = tmpDir();
  assert.equal(readFileSafe(path.join(dir, 'nope.txt')), null);
});

// ── unique-tmp concurrency: two rapid writers, file never torn/empty ─────────

test('concurrent CLI writers never corrupt the target (unique temp + atomic rename)', async () => {
  const dir = tmpDir();
  const target = path.join(dir, 'data.txt');
  const a = `a${'x'.repeat(500_000)}a`;
  const b = `b${'y'.repeat(500_000)}b`;

  const results = await Promise.all([run([CLI, 'write', target], a), run([CLI, 'write', target], b)]);
  for (const r of results) assert.equal(r.code, 0, r.err);

  const final = fs.readFileSync(target, 'utf8');
  assert.ok(final === a || final === b, 'file is exactly one full write — never torn or empty');
  const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'no temp collisions left behind');
});

// ── lock mutual exclusion: two processes contend on a counter ────────────────

test('atomicUpdate serializes read-modify-write across processes (no lost updates)', async () => {
  const dir = tmpDir();
  const counter = path.join(dir, 'counter.txt');
  fs.writeFileSync(counter, '0');

  // A widened critical section (busy loop) makes any broken mutual exclusion show up
  // as a lost increment — this is the exact shape of the create-then-write takeover
  // race, where a contender reading an empty mid-creation lockfile wrongly breaks it.
  const worker = path.join(dir, 'worker.js');
  fs.writeFileSync(
    worker,
    `const { atomicUpdate } = require(${JSON.stringify(CLI)});
const [file, iters] = [process.argv[2], Number(process.argv[3])];
for (let i = 0; i < iters; i++) {
  atomicUpdate(file, (c) => {
    let x = 0;
    for (let k = 0; k < 20000; k++) x += k; // hold the section open a beat
    return String(Number(c || '0') + 1 + (x & 0));
  }, { onContended: 'throw', timeoutMs: 20000, retryMs: 2 });
}
`,
  );

  const ITERS = 40;
  const WORKERS = 3;
  const results = await Promise.all(
    Array.from({ length: WORKERS }, () => run([worker, counter, String(ITERS)])),
  );
  for (const r of results) assert.equal(r.code, 0, r.err);

  assert.equal(
    fs.readFileSync(counter, 'utf8'),
    String(ITERS * WORKERS),
    'every increment survived — lock serialized all contenders',
  );
});

// ── stale-lock takeover ──────────────────────────────────────────────────────

test('acquireLock breaks a lock owned by a dead pid (fresh mtime isolates the pid path)', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'f.txt');
  // spawnSync returns after the child exits, so its pid is guaranteed dead.
  const deadPid = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  fs.writeFileSync(`${target}.lock`, `${deadPid}:nonce:${Date.now()}:1\n`);

  let ran = false;
  withLock(target, () => (ran = true), { timeoutMs: 200 });
  assert.ok(ran, 'dead-owner lock was broken and fn ran');
});

test('acquireLock breaks a lock aged past staleMs even with a live owner pid', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'f.txt');
  const lock = `${target}.lock`;
  fs.writeFileSync(lock, `${process.pid}:nonce:${Date.now()}:1\n`); // our own LIVE pid
  const old = Date.now() / 1000 - 120; // 120s ago
  fs.utimesSync(lock, old, old);

  let ran = false;
  withLock(target, () => (ran = true), { timeoutMs: 200, staleMs: 30_000 });
  assert.ok(ran, 'aged lock broken despite a live owner');
});

// ── concurrent double-takeover: many contenders race ONE stale lock ──────────

test('concurrent stale-lock takeover never double-holds (no lost increment)', async () => {
  const dir = tmpDir();
  const counter = path.join(dir, 'counter.txt');
  fs.writeFileSync(counter, '0');

  // A dead-pid stale lock seeded up front makes every worker's FIRST acquisition
  // hit the takeover path at the same instant — a genuine N-way takeover race.
  // The old unlink-by-path takeover let two winners each break a DIFFERENT
  // generation (the second deleting a fresh lock the first just created), a
  // double-hold that loses an increment. Single-winner rename takeover must leave
  // every increment intact. spawnSync returns after exit, so its pid is dead.
  const deadPid = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  fs.writeFileSync(`${counter}.lock`, `${deadPid}:seeded:${Date.now()}:1\n`);

  const worker = path.join(dir, 'worker.js');
  fs.writeFileSync(
    worker,
    `const { atomicUpdate } = require(${JSON.stringify(CLI)});
const [file, iters] = [process.argv[2], Number(process.argv[3])];
for (let i = 0; i < iters; i++) {
  atomicUpdate(file, (c) => {
    let x = 0;
    for (let k = 0; k < 20000; k++) x += k; // widen the section so any double-hold loses a count
    return String(Number(c || '0') + 1 + (x & 0));
  }, { onContended: 'throw', timeoutMs: 20000, retryMs: 2 });
}
`,
  );

  const ITERS = 30;
  const WORKERS = 4;
  const results = await Promise.all(
    Array.from({ length: WORKERS }, () => run([worker, counter, String(ITERS)])),
  );
  for (const r of results) assert.equal(r.code, 0, r.err);

  assert.equal(
    fs.readFileSync(counter, 'utf8'),
    String(ITERS * WORKERS),
    'single-winner takeover preserved every increment despite the initial stale-lock stampede',
  );

  // Takeover renames the stale lockfile to a unique name then deletes it — none may leak.
  const staleLeftovers = fs.readdirSync(dir).filter((f) => f.includes('.lock.stale.'));
  assert.deepEqual(staleLeftovers, [], 'renamed stale lockfiles are cleaned up, not orphaned');
});

// ── lock-budget-exhausted fallback direction ─────────────────────────────────

test('budget exhausted: default withLock surfaces (throws), it does not silently run', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'f.txt');
  const lock = `${target}.lock`;
  // A held, non-stale lock: our own live pid, fresh mtime, huge staleMs.
  fs.writeFileSync(lock, `${process.pid}:held:${Date.now()}:1\n`);
  try {
    assert.throws(
      () =>
        withLock(
          target,
          () => {
            throw new Error('fn must not run on a held lock');
          },
          { timeoutMs: 60, staleMs: 60_000 },
        ),
      (e) => e instanceof LockTimeoutError,
    );
  } finally {
    fs.unlinkSync(lock);
  }
});

test('budget exhausted: atomicUpdate surfaces by default; run-unlocked is opt-in', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'f.txt');
  const lock = `${target}.lock`;
  fs.writeFileSync(lock, `${process.pid}:held:${Date.now()}:1\n`);
  try {
    // Default direction is SURFACE: a serialization primitive must NOT silently do
    // the unlocked write it exists to prevent — that would lose the update.
    assert.throws(
      () => atomicUpdate(target, () => 'should-not-write', { timeoutMs: 60, staleMs: 60_000 }),
      (e) => e instanceof LockTimeoutError,
    );
    assert.equal(fs.existsSync(target), false, 'default did not write behind the held lock');

    // Explicit opt-in accepts last-writer-wins and writes anyway.
    const wrote = atomicUpdate(target, () => 'written-unlocked', {
      timeoutMs: 60,
      staleMs: 60_000,
      onContended: 'run-unlocked',
    });
    assert.equal(wrote, true);
    assert.equal(readFileSafe(target), 'written-unlocked', 'opt-in degraded to unlocked best-effort');
  } finally {
    fs.unlinkSync(lock);
  }
});

// ── atomicUpdate transform contract ──────────────────────────────────────────

test('atomicUpdate passes null for a missing file and skips the write on null return', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'f.txt');

  let seen = 'unset';
  const wrote = atomicUpdate(target, (current) => {
    seen = current;
    return null; // decline
  });
  assert.equal(seen, null, 'transform sees null for an absent file');
  assert.equal(wrote, false);
  assert.equal(fs.existsSync(target), false, 'null return writes nothing');
});

// ── CLI harness smoke ────────────────────────────────────────────────────────

test('CLI write reads stdin and writes it atomically', async () => {
  const dir = tmpDir();
  const target = path.join(dir, 'cli.txt');
  const r = await run([CLI, 'write', target], 'hello cli');
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(target, 'utf8'), 'hello cli');
});

test('CLI update reads stdin and writes under the lock', async () => {
  const dir = tmpDir();
  const target = path.join(dir, 'cli.txt');
  const r = await run([CLI, 'update', target], 'via update');
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(target, 'utf8'), 'via update');
});

test('CLI --help exits 0; a bad command exits 2', async () => {
  const help = await run([CLI, '--help']);
  assert.equal(help.code, 0);
  const bad = await run([CLI, 'bogus', 'x']);
  assert.equal(bad.code, 2);
});
