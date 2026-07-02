// Author: Subash Karki
// wake-queue.js — durable, lockless wake queue for the Apex wake loop.
// Adapted from firstmate fm-wake-lib.sh (MIT, © 2026 Kun Chen) —
// github.com/kunchenguid/firstmate. Bash → Node port.
//
// Queue mechanics:
//   append(dir, {kind,key,payload})  -> one tab-delimited row appended (O_APPEND)
//   drain(dir)                       -> atomically moves the queue aside via
//                                       rename, returns deduped records + liveness
//   triage(dir, line)                -> one-line stub appended to .triage-log
//
// CONCURRENCY (no lock): Phantom runs a SINGLE consumer (Apex drains) and any
// number of lockless producers (classifier processes append/triage). append is a
// single O_APPEND write — atomic for row-sized payloads; drain moves the queue
// aside with an atomic rename, so a concurrent append either lands before the
// rename (drained now) or creates a fresh file after it (drained next). Neither
// tears the queue nor loses a row. The seq counter's read-modify-write can race
// to a duplicate value, but seq is diagnostic-only (dedupe is on kind+key, drain
// never keys off seq), so a duplicate is harmless. There is therefore nothing for
// a lock to protect; the earlier lockfile was removed (LESS IS MORE).
//
// CALLER CONTRACT: append the wake row BEFORE advancing any suppression marker.
// The row is the durable record; if the caller advances its "seen" marker first
// and then crashes before appending, the wake is lost. Append first, suppress
// second — the queue is the source of truth, the marker is only an optimization.
//
// KNOWN LIMIT: the per-repo session pointer (see resolveWakeSource) is scoped by
// repo name, so distinct repos never collide; two CONCURRENT sessions in the SAME
// repo still share one pointer and remain last-writer-wins.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const QUEUE_FILE = '.wake-queue';
const SEQ_FILE = '.wake-queue.seq';
const TRIAGE_FILE = '.triage-log';

// Pointer file naming the active wake session dir. Written under stateDir() by
// commands/start.md; read by resolveWakeSource() so the producer (classifier) and
// consumer (Apex drain) resolve the same session dir without inheriting Apex env.
// The active repo name is appended (see resolveWakeSource) so sessions in
// different repos don't clobber one global pointer.
const POINTER_FILE = '.active-wake-session';

// stateDir() locates the pointer file and is the last-resort fallback so a wake
// is never homeless. detectRepo() scopes the pointer per-repo. Same fail-open
// import pattern the classifier hook uses.
let stateDir, detectRepo;
try {
  ({ stateDir, detectRepo } = require('./phantom-paths'));
} catch (_) {
  const data = process.env.PHANTOM_DATA || path.join(os.homedir(), '.claude', 'phantom-data');
  stateDir = () => path.join(data, 'state');
  detectRepo = null;
}

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

// Per-repo pointer filename. detectRepo() may be unavailable (phantom-paths
// failed to load) or throw; either way we fall back to the un-suffixed pointer,
// preserving the pre-scoping behavior.
function pointerFileName() {
  try {
    if (typeof detectRepo === 'function') {
      const repo = detectRepo();
      if (repo && String(repo).trim()) return `${POINTER_FILE}.${String(repo).trim()}`;
    }
  } catch (_) {
    /* detectRepo threw → bare pointer */
  }
  return POINTER_FILE;
}

/**
 * resolveWakeSource() -> { dir, source } where source is one of:
 *   'env'     — PHANTOM_WAKE_SESSION_DIR (explicit per-spawn override / tests)
 *   'pointer' — the per-repo <stateDir>/.active-wake-session.<repo> file, present
 *               and naming a dir that exists
 *   'state'   — stateDir() global fallback (no env, no live pointer)
 *
 * Canonical resolver shared by producer and consumer. Exposing `source` lets the
 * classifier tell a pointed-at session ('env'/'pointer') from an unpointed global
 * fallback ('state'), so it can skip appending when no consumer exists.
 */
function resolveWakeSource() {
  const explicit = process.env.PHANTOM_WAKE_SESSION_DIR;
  if (explicit && explicit.trim()) return { dir: explicit.trim(), source: 'env' };
  try {
    const dir = fs.readFileSync(path.join(stateDir(), pointerFileName()), 'utf8').trim();
    if (dir && fs.existsSync(dir)) return { dir, source: 'pointer' };
  } catch (_) {
    /* no pointer / unreadable → fall through to the global state dir */
  }
  return { dir: stateDir(), source: 'state' };
}

// String-returning API kept for callers/commands that only need the dir.
function resolveWakeDir() {
  return resolveWakeSource().dir;
}

// Collapse tab/CR/LF to spaces so a value can never break the row framing.
// Payload is JSON-encoded (which escapes control chars) so it is inherently
// single-line; kind/key are raw and get cleaned here.
function cleanField(value) {
  return String(value == null ? '' : value).replace(/[\t\r\n]/g, ' ');
}

function fileAgeMs(p) {
  try {
    return Date.now() - fs.statSync(p).mtimeMs;
  } catch {
    return Infinity;
  }
}

function nextSeq(sessionDir) {
  const seqPath = path.join(sessionDir, SEQ_FILE);
  let seq = 0;
  try {
    const raw = fs.readFileSync(seqPath, 'utf8').trim();
    if (/^\d+$/.test(raw)) seq = parseInt(raw, 10);
  } catch {
    /* absent or garbage → start at 0 */
  }
  seq += 1;
  fs.writeFileSync(seqPath, String(seq));
  return seq;
}

function encodePayload(payload) {
  // JSON.stringify(undefined) is the JS value undefined, not a string; pin it to
  // null so the row always has a parseable, single-line payload column.
  return JSON.stringify(payload === undefined ? null : payload);
}

function formatRow(epoch, seq, kind, key, payload) {
  return `${epoch}\t${seq}\t${cleanField(kind)}\t${cleanField(key)}\t${encodePayload(payload)}\n`;
}

function parseRow(line) {
  const parts = line.split('\t');
  if (parts.length < 5) return null;
  const epoch = Number(parts[0]);
  const seq = Number(parts[1]);
  const kind = parts[2];
  const key = parts[3];
  const rawPayload = parts.slice(4).join('\t');
  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    payload = rawPayload; // fail open: keep the raw column rather than drop the row
  }
  return {
    epoch: Number.isFinite(epoch) ? epoch : null,
    seq: Number.isFinite(seq) ? seq : null,
    kind,
    key,
    payload,
  };
}

function readRows(queuePath) {
  let raw;
  try {
    raw = fs.readFileSync(queuePath, 'utf8');
  } catch {
    return [];
  }
  return raw.split('\n').filter(Boolean).map(parseRow).filter(Boolean);
}

// Dedupe on kind+key keeping the LATEST row's content, emitted in first-seen
// order (matches firstmate's fm_wake_print_deduped). This absorbs same-key bursts
// between drains, so producers need no append-time coalescing.
function dedupe(rows) {
  const order = [];
  const latest = new Map();
  for (const row of rows) {
    const composite = `${row.kind} ${row.key}`;
    if (!latest.has(composite)) order.push(composite);
    latest.set(composite, row);
  }
  return order.map((composite) => latest.get(composite));
}

/**
 * append(sessionDir, { kind, key, payload }) -> { seq }
 *
 * Appends one durable wake row via a single O_APPEND write. `kind` is an open
 * vocabulary (any non-empty string) — validation is the caller's job, matching
 * the open-enum convention. Creates sessionDir if absent. Same-key bursts are
 * collapsed at drain time by dedupe(), so there is no append-time coalescing.
 */
function append(sessionDir, { kind, key, payload } = {}) {
  if (!kind) throw new Error('wake-queue.append: kind is required');
  fs.mkdirSync(sessionDir, { recursive: true });
  const queuePath = path.join(sessionDir, QUEUE_FILE);
  const seq = nextSeq(sessionDir);
  fs.appendFileSync(queuePath, formatRow(nowEpoch(), seq, kind, key, payload));
  return { seq };
}

/**
 * drain(sessionDir) -> { records, liveness }
 *
 * Atomically moves the queue (and the triage log) aside via rename, then parses
 * and dedupes. A second immediate drain returns []. Missing dir/queue is a clean
 * no-op returning empty records. Never throws on absent state.
 *
 * liveness: { drainedAt, queueAgeSeconds, count, rawCount, absorbedSinceLastDrain }
 *   - queueAgeSeconds: age of the queue file at drain time (null if empty)
 *   - absorbedSinceLastDrain: triage-log lines drained (benign wakes absorbed)
 */
function drain(sessionDir) {
  const emptyLiveness = () => ({
    drainedAt: new Date().toISOString(),
    queueAgeSeconds: null,
    count: 0,
    rawCount: 0,
    absorbedSinceLastDrain: 0,
  });

  if (!sessionDir || !fs.existsSync(sessionDir)) {
    return { records: [], liveness: emptyLiveness() };
  }

  const queuePath = path.join(sessionDir, QUEUE_FILE);
  const triagePath = path.join(sessionDir, TRIAGE_FILE);

  let queueAgeSeconds = null;
  let rows = [];
  const aside = `${queuePath}.drain.${process.pid}.${Date.now()}`;
  try {
    queueAgeSeconds = Math.max(0, Math.floor(fileAgeMs(queuePath) / 1000));
    fs.renameSync(queuePath, aside); // atomic move-aside
    rows = readRows(aside);
    fs.unlinkSync(aside);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    queueAgeSeconds = null; // nothing was queued
  }

  let absorbed = 0;
  const triageAside = `${triagePath}.drain.${process.pid}.${Date.now()}`;
  try {
    fs.renameSync(triagePath, triageAside);
    absorbed = fs.readFileSync(triageAside, 'utf8').split('\n').filter(Boolean).length;
    fs.unlinkSync(triageAside);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const records = dedupe(rows);
  return {
    records,
    liveness: {
      drainedAt: new Date().toISOString(),
      queueAgeSeconds,
      count: records.length,
      rawCount: rows.length,
      absorbedSinceLastDrain: absorbed,
    },
  };
}

/**
 * triage(sessionDir, line) — append a one-line stub recording a benign wake that
 * was absorbed rather than surfaced. Feeds drain's absorbedSinceLastDrain count.
 */
function triage(sessionDir, line) {
  fs.mkdirSync(sessionDir, { recursive: true });
  const triagePath = path.join(sessionDir, TRIAGE_FILE);
  fs.appendFileSync(triagePath, `${nowEpoch()}\t${cleanField(line)}\n`);
}

module.exports = { append, drain, triage, resolveWakeDir, resolveWakeSource };

// CLI: node wake-queue.js drain [dir]   → drain resolved-or-given dir, JSON to stdout
//      node wake-queue.js resolve       → print the resolved wake dir
if (require.main === module) {
  const [, , cmd, dirArg] = process.argv;
  if (cmd === 'drain') {
    const dir = dirArg && dirArg.trim() ? dirArg.trim() : resolveWakeDir();
    process.stdout.write(JSON.stringify(drain(dir)) + '\n');
    process.exit(0);
  } else if (cmd === 'resolve') {
    process.stdout.write(resolveWakeDir() + '\n');
    process.exit(0);
  } else {
    process.stderr.write('Usage:\n  node wake-queue.js drain [dir]\n  node wake-queue.js resolve\n');
    process.exit(2);
  }
}
