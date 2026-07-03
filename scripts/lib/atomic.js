// Author: Subash Karki
// atomic.js — atomic file writes + advisory locking for the phantom hooks.
//
// Adapted from tasks-axi lock.ts (MIT, © 2026 Kun Chen) —
// github.com/kunchenguid/tasks-axi. The TypeScript original is async and throws a
// typed AxiError on contention; this port is SYNCHRONOUS (callers are sync
// Stop/PreCompact hooks) and FAIL-OPEN (a lock it cannot acquire never throws
// through a hook's main path — the caller chooses to degrade to an unlocked
// best-effort write rather than lose the update).
//
// Two guarantees, kept separate the way lock.ts keeps them:
//   1. Corruption safety is unconditional — atomicWrite writes a UNIQUE same-dir
//      temp file then renames over the target, so a reader sees the whole old or
//      the whole new file, never a torn write. Holds with OR without a lock.
//   2. Lost-update reduction is advisory — withLock/atomicUpdate serialize the
//      read-modify-write cycles that atomic rename alone cannot (two processes
//      both read, both write, last one wins). A stale or unacquirable lock
//      degrades to unlocked; it never blocks the hook.
'use strict';

const fs = require('fs');
const path = require('path');

const LOCK_STALE_MS = 30_000; // lock older than this (or owned by a dead pid) is broken
const LOCK_TIMEOUT_MS = 2_500; // total acquisition budget before fail-open
const LOCK_RETRY_MS = 25; // backoff between acquisition attempts

let tmpCounter = 0;
let tokenCounter = 0;

// Synchronous sleep via a throwaway SharedArrayBuffer — blocks this thread for
// `ms` without busy-spinning. The hooks are synchronous, so we cannot await.
function sleepSync(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function errno(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
}

function randomNonce() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// Unique lock ownership token. The first and third colon fields (pid, acquiredAt)
// are re-parsed by stale-lock detection; the nonce + counter make it collision-
// proof so release only ever removes a lock this process still owns.
function lockToken() {
  tokenCounter += 1;
  return `${process.pid}:${randomNonce()}:${Date.now()}:${tokenCounter}`;
}

/** Read a file's UTF-8 contents, or null when it does not exist. */
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (errno(error) === 'ENOENT') return null;
    throw error;
  }
}

/**
 * atomicWrite(filePath, content) — write `content` atomically.
 * The temp file is UNIQUE per (pid, monotonic tick, counter) and in the SAME dir
 * as the target, so concurrent writers to one path never collide on the temp name
 * and the rename is never cross-device. Cleans up the temp on a rename failure.
 */
function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  tmpCounter += 1;
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Math.floor(performance.now() * 1000)}.${tmpCounter}.tmp`,
  );
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best-effort temp cleanup */
    }
    throw error;
  }
}

// True when `pid` names a live process. process.kill(pid, 0) sends no signal, it
// only probes: ESRCH → gone, EPERM → alive but not ours (still alive).
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errno(error) === 'EPERM';
  }
}

// The owner recorded in a lockfile, or null when the file is gone. Parsed from the
// lockToken() format: pid is field 0, acquiredAt is field 2.
//
// acquireLock creates the lockfile EMPTY (openSync 'wx') and fills it a syscall
// later (writeSync), so a concurrent reader can catch it mid-creation: empty, or a
// partially-written token. A complete token always ends in '\n'; until that lands
// the owner is UNKNOWN (pid null), NEVER inferred dead — otherwise a contender
// reading `pid: 0` from an empty file would break a lock that is being legitimately
// acquired, and two processes would hold at once (the lost-update bug this guards).
function readLockOwner(lockPath) {
  const raw = readFileSafe(lockPath);
  if (raw == null) return null;
  const complete = raw.endsWith('\n');
  const parts = raw.trim().split(':');
  const pid = Number(parts[0]);
  const acquiredAt = Number(parts[2]);
  return {
    raw,
    pid: complete && Number.isInteger(pid) && pid > 0 ? pid : null,
    acquiredAt: Number.isFinite(acquiredAt) ? acquiredAt : null,
  };
}

// Stale-lock decision — lock.ts's semantics (age past staleMs, measured from the
// lockfile mtime so it stands even when the token can't be parsed), extended with
// pid liveness: a dead owner is stale regardless of age.
//
// Returns the EXACT raw bytes of the generation judged stale (the lockToken plus its
// trailing newline), or null when the lock is live or already gone. The takeover
// path compares these bytes against the file it relocates: that is what makes the
// takeover a VERIFIED single-winner — a contender only claims the precise generation
// it judged, never a fresh live lock that replaced it after the judgment.
function judgeStaleGeneration(lockPath, staleMs) {
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(lockPath).mtimeMs;
  } catch (error) {
    if (errno(error) === 'ENOENT') return null; // already gone → nothing to break
    throw error;
  }
  const owner = readLockOwner(lockPath);
  if (owner == null) return null; // vanished between stat and read → nothing to break
  // Only a VALID, provably-dead owner is stale-by-pid. An unknown owner (empty or
  // mid-write lockfile) is NOT proof of death — fall through to the age check, which
  // still reclaims a genuinely orphaned empty lockfile once it passes staleMs.
  const dead = owner.pid != null && !pidAlive(owner.pid);
  if (dead || Date.now() - mtimeMs > staleMs) return owner.raw;
  return null;
}

// Non-clobbering restore of a lock a contender misappropriated. When takeover
// relocates a generation it did NOT judge stale (a fresh live lock installed at the
// path after the judgment), the displaced owner must be put back — but only if the
// path is still empty. linkSync creates lockPath atomically and fails EEXIST when a
// NEWER holder has already taken the momentarily-empty path; we must never overwrite
// that live lock. Returns 'restored' when the displaced owner is reinstated,
// 'superseded' when a newer holder already owns the path. Either way our relocated
// copy is dropped so no `.stale.` artifact leaks. 'superseded' is the one residual
// double-hold window pure-POSIX advisory locking cannot close (see takeoverStaleLock).
function restoreMisappropriated(staleName, lockPath) {
  let status;
  try {
    fs.linkSync(staleName, lockPath);
    status = 'restored';
  } catch (error) {
    if (errno(error) !== 'EEXIST') throw error;
    status = 'superseded';
  }
  try {
    fs.unlinkSync(staleName);
  } catch {
    /* best-effort: the restored copy or a superseding lock is authoritative now */
  }
  return status;
}

// Verified single-winner takeover of the generation whose raw bytes are `judgedRaw`.
// renameSync moves the inode atomically, so exactly one contender relocates a given
// lockfile; the rest get ENOENT ('lost') and back off. After relocating, we CONFIRM
// the bytes match the judged generation:
//   'won'       → relocated the exact stale generation; caller retries the create.
//   'lost'      → path already empty; another contender got there first.
//   'repaired'  → relocated a fresh live lock (a winner recreated between our
//                 judgment and our rename); restored it, we did not acquire.
//   'superseded'→ same, but a newer holder claimed the empty path before our
//                 restore — the displaced owner is a zombie. Irreducible residual.
function takeoverStaleLock(lockPath, judgedRaw) {
  const staleName = `${lockPath}.stale.${process.pid}.${randomNonce()}`;
  try {
    fs.renameSync(lockPath, staleName);
  } catch (error) {
    if (errno(error) !== 'ENOENT') throw error;
    return 'lost'; // path already empty → another contender relocated it first
  }
  if (readFileSafe(staleName) === judgedRaw) {
    try {
      fs.unlinkSync(staleName);
    } catch {
      /* best-effort: never let a leftover takeover artifact block acquisition */
    }
    return 'won';
  }
  return restoreMisappropriated(staleName, lockPath) === 'restored' ? 'repaired' : 'superseded';
}

// Remove the lockfile only if we still own it: a stale-lock takeover may have
// handed the lock to another process, whose token now differs — never unlink that.
function releaseLock(lockPath, token) {
  const owner = readLockOwner(lockPath);
  if (!owner || owner.raw.trim() !== token) return;
  try {
    fs.unlinkSync(lockPath);
  } catch (error) {
    if (errno(error) !== 'ENOENT') throw error;
  }
}

// Acquire the advisory lock for `targetPath`, or return null when the budget is
// exhausted (fail-open — the caller decides what to do without a lock). Breaks a
// stale lock (dead owner or aged past staleMs) and retries. Never throws on
// contention; only a genuinely unexpected fs error propagates.
function acquireLock(targetPath, options = {}) {
  const lockPath = `${targetPath}.lock`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS;
  const retryMs = options.retryMs ?? LOCK_RETRY_MS;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      const token = lockToken();
      try {
        fs.writeSync(fd, `${token}\n`);
      } finally {
        fs.closeSync(fd);
      }
      return { release: () => releaseLock(lockPath, token) };
    } catch (error) {
      if (errno(error) !== 'EEXIST') throw error;

      // Verified single-winner takeover. Unlink-by-path is unsafe here: two contenders
      // that both judged THIS lock stale would each remove whatever generation sits at
      // lockPath when their unlink runs — the second deleting a fresh lock the first
      // just created, so both hold at once (lost update). Instead we judge the exact
      // stale generation (its raw bytes), relocate it atomically with renameSync, and
      // CONFIRM we moved that same generation before claiming the takeover. A contender
      // that finds it relocated a fresh live lock (a winner recreated between judgment
      // and rename) repairs it back without clobbering and backs off — never robs a
      // live holder. Only 'won' means the path is ours to recreate.
      const judgedRaw = judgeStaleGeneration(lockPath, staleMs);
      if (judgedRaw != null && takeoverStaleLock(lockPath, judgedRaw) === 'won') {
        continue; // took over the exact judged generation — retry the create immediately
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      sleepSync(Math.min(retryMs, remaining));
    }
  }
}

class LockTimeoutError extends Error {
  constructor(filePath) {
    super(`atomic: could not acquire lock for ${filePath}`);
    this.name = 'LockTimeoutError';
    this.code = 'ELOCKTIMEOUT';
  }
}

/**
 * withLock(filePath, fn, opts) — run `fn` while holding the advisory lock for
 * `filePath`, releasing it in a finally. Synchronous; returns fn's result.
 *
 * On contention (budget exhausted) the fail-open direction is the CALLER's:
 *   opts.onContended === 'run-unlocked' → run `fn` anyway, unlocked. No update is
 *       lost; the only casualty is serialization (last-writer-wins — the
 *       pre-existing lockless behavior, so no regression). This is the writers' path.
 *   otherwise (default) → throw LockTimeoutError so the caller's own try/catch
 *       decides. A caller must OPT IN to running unlocked.
 *
 * Errors thrown BY `fn` (a real write failure) always propagate — only lock
 * ACQUISITION failure is absorbed, and only into the chosen fail-open direction.
 */
function withLock(filePath, fn, opts = {}) {
  const handle = acquireLock(filePath, opts);
  if (!handle) {
    if (opts.onContended === 'run-unlocked') return fn();
    throw new LockTimeoutError(filePath);
  }
  try {
    return fn();
  } finally {
    handle.release();
  }
}

/**
 * atomicUpdate(filePath, transform, opts) — locked read-modify-write.
 * Reads the current contents (null when absent), passes them to `transform`, and
 * atomically writes the result. A null/undefined return means "no change" and skips
 * the write, returning false; a written update returns true.
 *
 * Contention direction defaults to SURFACE (throw): this is a serialization
 * primitive, so silently doing the unlocked read-modify-write it exists to prevent
 * would lose the very updates it guards. Callers that genuinely accept last-writer-
 * wins (e.g. best-effort learnings capture) must opt in with onContended:'run-unlocked'.
 */
function atomicUpdate(filePath, transform, opts = {}) {
  return withLock(
    filePath,
    () => {
      const next = transform(readFileSafe(filePath));
      if (next == null) return false;
      atomicWrite(filePath, next);
      return true;
    },
    opts,
  );
}

module.exports = { atomicWrite, atomicUpdate, withLock, readFileSafe, LockTimeoutError };

// Internal takeover primitives, exported for deterministic single-winner tests only.
// Not part of the public API — callers use withLock/atomicUpdate.
module.exports._internals = { judgeStaleGeneration, takeoverStaleLock, restoreMisappropriated };

// CLI: node atomic.js write <file>    # read stdin, write it atomically
//      node atomic.js update <file>   # same, but under the advisory lock
// The skill prose shells out (it cannot require()), so both are reachable here.
if (require.main === module) {
  const [, , cmd, file] = process.argv;

  function usage(code) {
    process.stderr.write(
      'Usage:\n' +
        '  node atomic.js write <file>    # read stdin, write it atomically (temp + rename)\n' +
        '  node atomic.js update <file>   # same, but hold the advisory lock across the write\n',
    );
    process.exit(code);
  }

  if (cmd === '--help' || cmd === '-h') usage(0);
  if ((cmd !== 'write' && cmd !== 'update') || !file) usage(2);

  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    try {
      if (cmd === 'write') atomicWrite(file, raw);
      else atomicUpdate(file, () => raw);
      process.exit(0);
    } catch (error) {
      process.stderr.write(`[atomic] ${cmd} failed: ${error.message}\n`);
      process.exit(1);
    }
  });
}
