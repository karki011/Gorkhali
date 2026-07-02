#!/usr/bin/env node
// Author: Subash Karki
// wake-classifier.js — SubagentStop hook. Classifies a stopping agent's typed
// execution record (reference/schemas/execution.md) into ACTIONABLE (Apex must
// wake) or BENIGN (absorb), then routes it to the durable wake queue.
//
// Adapted from firstmate fm-classify-lib.sh (MIT, © 2026 Kun Chen) —
// github.com/kunchenguid/firstmate. The bash original tests free-text status
// lines against a captain-relevant verb regex; this port classifies the typed
// Blade→Apex completion record instead, which carries status/blocker/score
// directly and needs no verb-matching.
//
// FAIL-OPEN, ALWAYS: the entire body is wrapped so any thrown error still does a
// best-effort append and exits 0. A classifier crash must NEVER block
// SubagentStop or silently lose a wake — losing a wake is the one unrecoverable
// failure, so an unknown/garbage record surfaces (actionable) rather than absorbs.

const fs = require('fs');
const path = require('path');

// Self-review below this is actionable. Scores are 0-10 (execution.md). No
// existing constant in scripts/lib/constants.js covers self-review, so it lives
// here rather than adding a 7th file to this task's scope. Env-overridable.
const SELF_REVIEW_THRESHOLD = (() => {
  const raw = Number(process.env.PHANTOM_WAKE_SELF_REVIEW_THRESHOLD);
  return Number.isFinite(raw) && raw >= 0 ? raw : 7;
})();

let append, resolveWakeDir, resolveWakeSource;
try {
  ({ append, resolveWakeDir, resolveWakeSource } = require('../scripts/lib/wake-queue'));
} catch (_) {
  append = null; // resolved lazily below; a load failure still exits 0
  resolveWakeDir = null;
  resolveWakeSource = null;
}

let stateDir;
try {
  ({ stateDir } = require('../scripts/lib/phantom-paths'));
} catch (_) {
  const os = require('os');
  const data = process.env.PHANTOM_DATA || path.join(os.homedir(), '.claude', 'phantom-data');
  stateDir = () => path.join(data, 'state');
}

// Native Claude Code passes the hook payload as JSON on stdin; the internal
// router passes it in an argv slot. Try stdin first, then argv (mirrors
// timing-capture.js). Returns null when no payload is present at all.
function readPayload() {
  const sources = [() => fs.readFileSync(0, 'utf-8'), () => process.argv[3], () => process.argv[2]];
  for (const get of sources) {
    try {
      const raw = get();
      if (raw && String(raw).trim().startsWith('{')) return JSON.parse(raw);
    } catch (_) {
      /* try next source */
    }
  }
  return null;
}

// Resolve where wakes are queued. Delegates to wake-queue's canonical
// resolveWakeDir (env → pointer file → state dir) so producer and consumer agree
// on the same session dir. Falls back to the local resolver only if wake-queue
// failed to load. mkdir is append's job.
function resolveSessionDir() {
  if (resolveWakeDir) return resolveWakeDir();
  const explicit = process.env.PHANTOM_WAKE_SESSION_DIR;
  if (explicit && explicit.trim()) return explicit.trim();
  return stateDir();
}

// Read the per-agent record stub Apex writes at spawn (commands/execute.md) into
// <wakeDir>/agent-records/<id>.json, resolved on SubagentStop. The stub is keyed
// by agent identity; we try each identity field the payload may carry.
//
// LIMITATION (payload identity): native SubagentStop does NOT guarantee an
// agent-name — timing-capture.js, the actual production reader, extracts only
// session_id + tool_use_id on stop. So this resolves only when the runtime
// surfaces a per-agent id (agent name or tool_use_id); when it does not, we fall
// through to null → classify() returns actionable('missing-record'), i.e.
// fail-open (surface rather than absorb — never lose a wake).
function readAgentRecordFile(payload, wakeDir) {
  if (!wakeDir || !payload) return null;
  const ids = [payload.agent, payload.subagent_type, payload.tool_use_id, payload.toolUseId, payload.id];
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim()) continue;
    // basename guards against a crafted id escaping the agent-records dir.
    const file = path.join(wakeDir, 'agent-records', path.basename(`${id}.json`));
    try {
      const s = fs.readFileSync(file, 'utf-8');
      if (s && String(s).trim().startsWith('{')) return s;
    } catch (_) {
      /* absent/unreadable for this id → try the next */
    }
  }
  return null;
}

// Load the execution record for the stopping agent, or null if none can be
// resolved. Sources, in order: inline env JSON, env file path, on-disk
// agent-records stub, inline payload field. An execution.json (tasks[] shape)
// resolves to the matching task (by tool_use_id/agent, else the last task);
// wave bookkeeping is carried alongside so the last-in-wave test can run.
function resolveRecord(payload, wakeDir) {
  let raw = null;
  const candidates = [
    () => process.env.PHANTOM_EXECUTION_RECORD,
    () => (process.env.PHANTOM_EXECUTION_FILE ? fs.readFileSync(process.env.PHANTOM_EXECUTION_FILE, 'utf-8') : null),
    () => readAgentRecordFile(payload, wakeDir),
  ];
  for (const get of candidates) {
    try {
      const s = get();
      if (s && String(s).trim().startsWith('{')) {
        raw = JSON.parse(s);
        break;
      }
    } catch (_) {
      /* try next source */
    }
  }
  if (!raw && payload && typeof payload.execution_record === 'object') raw = payload.execution_record;
  if (!raw || typeof raw !== 'object') return null;

  if (Array.isArray(raw.tasks)) {
    const id = payload && (payload.tool_use_id || payload.toolUseId || payload.id);
    const agent = payload && payload.agent;
    const task =
      raw.tasks.find((t) => t && (t.id === id || t.agent === agent)) || raw.tasks[raw.tasks.length - 1] || null;
    if (!task) return null;
    return { ...task, wave: raw.wave !== undefined ? raw.wave : task.wave };
  }
  return raw;
}

/**
 * classify(record, threshold) -> { verdict: 'actionable'|'benign', reason }
 *
 * ACTIONABLE when any of: missing/garbage record; status 'failed'; a non-null
 * blocker; a numeric selfReviewScore below threshold; a drift flag; or
 * last-agent-in-wave. Wave membership is derived from record.wave.isLastInWave;
 * when it is not a boolean the position is underivable, so we fail open to
 * actionable. BENIGN only when the record positively proves passed + mid-wave.
 */
function classify(record, threshold) {
  if (!record || typeof record !== 'object') return { verdict: 'actionable', reason: 'missing-record' };
  if (record.status === 'failed') return { verdict: 'actionable', reason: 'failed' };
  if (record.blocker != null) return { verdict: 'actionable', reason: 'blocker' };
  if (typeof record.selfReviewScore === 'number' && record.selfReviewScore < threshold) {
    return { verdict: 'actionable', reason: 'low-self-review' };
  }
  if (record.drift) return { verdict: 'actionable', reason: 'drift' };

  const waveKnown = record.wave && typeof record.wave.isLastInWave === 'boolean';
  if (!waveKnown) return { verdict: 'actionable', reason: 'wave-underivable' };
  if (record.wave.isLastInWave) return { verdict: 'actionable', reason: 'last-in-wave' };

  return { verdict: 'benign', reason: 'passed-mid-wave' };
}

function agentKey(payload, record) {
  return (
    (payload && (payload.tool_use_id || payload.toolUseId || payload.id)) ||
    (record && record.id) ||
    (payload && payload.session_id) ||
    'unknown'
  );
}

function main() {
  const payload = readPayload();

  // No payload at all → no stopping agent → clean no-op. There is no wake to
  // lose, so nothing is written.
  if (!payload || (!payload.session_id && payload.execution_record === undefined)) {
    return;
  }

  // Resolve the wake dir AND which source produced it. Fix C: when no phantom
  // session is pointed at this repo (source 'state' = fell through to the global
  // state dir with no pointer and no env override) there is no Apex consumer, so
  // appending would grow the global state dir unbounded with wakes nobody drains.
  // Skip cleanly. A live pointer or env override ('pointer'/'env') → append as before.
  let sessionDir, source;
  if (resolveWakeSource) {
    ({ dir: sessionDir, source } = resolveWakeSource());
  } else {
    sessionDir = resolveSessionDir();
    source = process.env.PHANTOM_WAKE_SESSION_DIR && process.env.PHANTOM_WAKE_SESSION_DIR.trim() ? 'env' : 'state';
  }
  if (source === 'state') return;

  const record = resolveRecord(payload, sessionDir);
  const { verdict, reason } = classify(record, SELF_REVIEW_THRESHOLD);
  const key = agentKey(payload, record);

  if (verdict === 'benign') {
    const { triage } = require('../scripts/lib/wake-queue');
    triage(sessionDir, `benign ${key} ${reason}`);
    return;
  }

  const doAppend = append || require('../scripts/lib/wake-queue').append;
  doAppend(sessionDir, {
    kind: 'signal',
    key,
    payload: {
      reason,
      sid: payload.session_id || null,
      agent: (payload && payload.agent) || (record && record.agent) || null,
      status: record && record.status,
      blocker: (record && record.blocker) || null,
      selfReviewScore: record && record.selfReviewScore,
    },
  });
}

module.exports = { classify, SELF_REVIEW_THRESHOLD };

// Only run the hook when invoked as a script — required by tests, the pure
// exports above are all that load (no side effects, no process.exit).
if (require.main === module) {
  try {
    main();
  } catch (err) {
    // Best-effort surface: never lose a wake to our own crash. Try the resolved
    // session dir first; if the session dir is itself what broke, fall back to
    // the global state dir so the crash still surfaces as a wake.
    let doAppend = append;
    if (!doAppend) {
      try {
        ({ append: doAppend } = require('../scripts/lib/wake-queue'));
      } catch (_) {
        doAppend = null;
      }
    }
    if (doAppend) {
      const row = {
        kind: 'signal',
        key: 'classifier-error',
        payload: { reason: 'classifier-error', error: String(err && err.message) },
      };
      for (const resolve of [resolveSessionDir, stateDir]) {
        let dir = null;
        try {
          dir = resolve();
        } catch (_) {
          continue;
        }
        try {
          doAppend(dir, row);
          break;
        } catch (_) {
          /* this home is broken too — try the next */
        }
      }
    }
  }
  process.exit(0);
}
