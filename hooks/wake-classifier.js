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
  const home = os.homedir();
  const data = process.env.PHANTOM_DATA ||
    (home ? path.join(home, '.phantom') : path.join(process.cwd(), '.phantom'));
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
// IDENTITY (payload): native SubagentStop surfaces the spawn's `name:` param as
// `payload.agent_type` (empirically confirmed against the live runtime — it is
// EXACTLY the string passed to the Agent tool at spawn, empty when none was
// passed). commands/execute.md mandates every spawn pass `name:` equal to its
// stub filename, so agent_type is the primary resolver and is tried first. We do
// NOT parse `agent_id` — it embeds the name but its format is fragile.
//
// Fail-open remains for name-less spawns: when no id field resolves a stub we
// fall through to null → classify() returns actionable('missing-record'), i.e.
// surface rather than absorb — never lose a wake.
function readAgentRecordFile(payload, wakeDir) {
  if (!wakeDir || !payload) return null;
  const ids = [payload.agent_type, payload.agent, payload.subagent_type, payload.tool_use_id, payload.toolUseId, payload.id];
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

// Load the on-disk / injected stub record for the stopping agent, or null if
// none can be resolved. Sources, in order: inline env JSON, env file path,
// on-disk agent-records stub, inline payload field. An execution.json (tasks[]
// shape) resolves to the matching task (by tool_use_id/agent, else the last
// task); wave bookkeeping is carried alongside so the last-in-wave test can run.
function resolveStubRecord(payload, wakeDir) {
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

// Return the substring from the '{' at `start` to its matching '}', honoring
// string literals and escapes so braces inside a JSON string value don't
// miscount. Returns null when unbalanced. Never throws.
function balancedObject(s, start) {
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// The Blade's typed completion record is the LAST thing in its final message
// (a Blade's convention), so we scan only the message TAIL and walk '{' positions
// from the END backwards. Front-truncation is the correct direction — records come
// last — and the FIRST status-bearing object found scanning backwards IS the last
// one, which both picks the trailing record over any earlier decoy (a stray
// `{"status":"ok"}` in prose no longer shadows it) and bounds the work.
const MSG_TAIL_LIMIT = 32 * 1024; // chars (~32KB ASCII); tail is where records live
const MAX_BRACE_STARTS = 50; // cap balancedObject attempts over untrusted input

// Extract the Blade's typed completion record from its final message.
// `last_assistant_message` carries that message verbatim (confirmed against the
// live SubagentStop payload). It is UNTRUSTED free text: find the LAST balanced-
// brace object that BOTH parses as JSON AND carries a `status` field. Bounded to
// MAX_BRACE_STARTS attempts over the last MSG_TAIL_LIMIT chars so brace-dense or
// unterminated input can't spin the synchronous hook. Never throws — any failure
// yields a null record.
//
// Both bounds are deliberate but can cut off a REAL trailing record: a long tail
// past MSG_TAIL_LIMIT, or more than MAX_BRACE_STARTS trailing brace-starts, can
// push the record outside the scanned window. Returns `{ record, capped }` —
// `capped` is true when the scan was truncated (tail cut, or the brace-start cap
// was hit while braces remained unexamined). A capped scan that finds nothing is
// "unknown, not proven absent": the caller must escalate rather than silently
// treating it the same as a message that said nothing.
function extractMessageRecord(payload) {
  const full = payload && payload.last_assistant_message;
  if (typeof full !== 'string' || full.indexOf('{') === -1) return { record: null, capped: false };
  const tailTruncated = full.length > MSG_TAIL_LIMIT;
  const msg = tailTruncated ? full.slice(full.length - MSG_TAIL_LIMIT) : full;
  let start = msg.lastIndexOf('{');
  let attempts = 0;
  let braceCapHit = false;
  while (start !== -1 && ++attempts <= MAX_BRACE_STARTS) {
    const slice = balancedObject(msg, start);
    if (slice) {
      try {
        const obj = JSON.parse(slice);
        if (obj && typeof obj === 'object' && !Array.isArray(obj) && 'status' in obj) {
          return { record: obj, capped: tailTruncated };
        }
      } catch (_) {
        /* not a JSON object from this brace — try an earlier '{' */
      }
    }
    if (start === 0) break;
    start = msg.lastIndexOf('{', start - 1);
  }
  if (attempts > MAX_BRACE_STARTS && start !== -1) braceCapHit = true;
  return { record: null, capped: tailTruncated || braceCapHit };
}

// Merge the live message record over the on-disk stub, ESCALATE-ONLY: the message
// may raise the verdict to actionable but must never lower it. Apex updates the
// stub with the real typed record after reading results (commands/execute.md), so
// on a resume/re-fire the stub can already carry status:'failed' / a blocker / a
// low score. A stale or hallucinated 'passed' in the message must not flip that
// benign — that would lose the wake.
//
// Rule: if the stub ALONE already classifies actionable (same classify() and
// threshold main() uses), keep the stub and ignore the message. Only a non-
// actionable (or absent) stub yields to the message, whose status/blocker/score/
// drift then override it; the stub still contributes wave bookkeeping the message
// can't know (isLastInWave), so wave stays from the stub when present.
//
// The remaining absorption path — message-says-passed over a non-actionable
// 'spawned' mid-wave stub → benign — is DESIGNED: at stop time a not-yet-updated
// stub is non-actionable, and the message is the agent's own self-report. A
// genuinely failed agent surfaces via its own message record ('failed'). This is
// an escalate-only rule, not the old "the stub never carries failed at stop time"
// timing assumption — that assumption was never enforced.
function mergeRecords(stub, message, threshold) {
  if (stub && message) {
    if (classify(stub, threshold).verdict === 'actionable') return stub;
    return { ...stub, ...message, wave: stub.wave !== undefined ? stub.wave : message.wave };
  }
  return message || stub || null;
}

// Load the execution record for the stopping agent, or null if none resolves.
// Merges the live message record (last_assistant_message) over the on-disk stub,
// escalate-only (see mergeRecords), using the same threshold main() classifies with.
// `truncated` is true only when the message scan was capped AND found nothing —
// a capped scan that DID find a record already governs normally via mergeRecords.
function resolveRecord(payload, wakeDir, threshold) {
  const stub = resolveStubRecord(payload, wakeDir);
  const { record: message, capped } = extractMessageRecord(payload);
  const record = mergeRecords(stub, message, threshold);
  return { record, truncated: capped && !message };
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

  const { record, truncated } = resolveRecord(payload, sessionDir, SELF_REVIEW_THRESHOLD);
  let { verdict, reason } = classify(record, SELF_REVIEW_THRESHOLD);
  if (verdict === 'benign' && truncated) {
    verdict = 'actionable';
    reason = 'record-truncated';
  }
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
