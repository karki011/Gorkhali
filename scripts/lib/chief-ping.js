// Author: Subash Karki
// chief-ping.js — CHIEF_PING / CHIEF_ACK codec for the standing PR watch.
// Dep-free (no requires). A boolean `{new:false}` is not a ping: idle still
// wakes Chief. Missing sentinel is invalid. Every tick, including idle, must
// produce a tagged ping block Chief can ack.

'use strict';

const PING_SENTINEL = 'CHIEF_PING';
const ACK_SENTINEL = 'CHIEF_ACK';

const VERDICTS = Object.freeze(['idle', 'new_work', 'exit']);
const EXIT_REASONS = Object.freeze([
  'none', 'merged', 'closed', 'approved_clean', 'ceiling', 'user_stop',
]);
const NEXT_ACTIONS = Object.freeze(['ack_rearm', 'ack_assess', 'ack_stop']);
const ACK_KINDS = Object.freeze(['idle', 'assess', 'stop']);
const WATCH_STATUSES = Object.freeze(['watching', 'paused', 'stopped']);
const WATCH_KEYS = Object.freeze(['pr', 'status', 'tick', 'watermark', 'lastPingAt']);
const PING_KEYS = Object.freeze([
  'pr', 'tick', 'verdict', 'exit_reason', 'new_count', 'new_ids',
  'watermark', 'next_action',
]);

const ACK_FOR_NEXT_ACTION = Object.freeze({
  ack_rearm: 'idle',
  ack_assess: 'assess',
  ack_stop: 'stop',
});

// RFC3339 timestamps the watch watermark/lastPingAt must carry. Fractional
// seconds optional; timezone is Z or an explicit ±HH:MM offset.
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const BOOLEAN_ONLY_RE = /^\s*\{\s*["']?new["']?\s*:\s*(true|false)\s*\}\s*$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegInt(n) {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

function isRfc3339(s) {
  return typeof s === 'string' && RFC3339_RE.test(s);
}

function isIdOnly(value) {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * Boolean-only watcher payloads are illegal. `{new:false}` (JSON or JS-literal)
 * and any object whose only values are booleans are not a CHIEF_PING.
 */
function looksLikeBooleanOnly(input) {
  if (typeof input === 'boolean') return true;
  let obj = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (BOOLEAN_ONLY_RE.test(trimmed)) return true;
    try {
      obj = JSON.parse(trimmed);
    } catch (_) {
      return false;
    }
  }
  if (!isPlainObject(obj)) return false;
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  if (keys.length === 1 && keys[0] === 'new' && typeof obj.new === 'boolean') return true;
  return keys.every((k) => typeof obj[k] === 'boolean');
}

function fail(errors) {
  return { ok: false, errors: errors.slice() };
}

function ok(extra) {
  return { ok: true, errors: [], ...extra };
}

function validatePing(ping) {
  const errors = [];
  if (looksLikeBooleanOnly(ping)) {
    return fail(['boolean-only payload is not a CHIEF_PING']);
  }
  if (!isPlainObject(ping)) {
    return fail(['ping must be an object']);
  }

  if (!isNonNegInt(ping.pr) || ping.pr < 1) errors.push('pr: required positive integer');
  if (!isNonNegInt(ping.tick)) errors.push('tick: required non-negative integer');

  if (!VERDICTS.includes(ping.verdict)) {
    errors.push(`verdict: must be ${VERDICTS.join('|')}`);
  }
  if (!EXIT_REASONS.includes(ping.exit_reason)) {
    errors.push(`exit_reason: must be ${EXIT_REASONS.join('|')}`);
  }
  if (!NEXT_ACTIONS.includes(ping.next_action)) {
    errors.push(`next_action: must be ${NEXT_ACTIONS.join('|')}`);
  }
  if (!isRfc3339(ping.watermark)) {
    errors.push('watermark: required RFC3339 timestamp');
  }

  if (!Array.isArray(ping.new_ids)) {
    errors.push('new_ids: required array of ids');
  } else if (!ping.new_ids.every(isIdOnly)) {
    errors.push('new_ids: ids only (string or number, no bodies)');
  }
  if (!isNonNegInt(ping.new_count)) {
    errors.push('new_count: required non-negative integer');
  }

  if (errors.length) return fail(errors);

  if (ping.verdict === 'idle') {
    if (ping.new_count !== 0) errors.push('idle: new_count must be 0');
    if (ping.new_ids.length !== 0) errors.push('idle: new_ids must be empty');
    if (ping.exit_reason !== 'none') errors.push('idle: exit_reason must be none');
    if (ping.next_action !== 'ack_rearm') errors.push('idle: next_action must be ack_rearm');
  } else if (ping.verdict === 'new_work') {
    if (ping.new_count < 1) errors.push('new_work: new_count must be >= 1');
    if (ping.new_ids.length !== ping.new_count) {
      errors.push('new_work: new_ids length must equal new_count');
    }
    if (ping.next_action !== 'ack_assess') errors.push('new_work: next_action must be ack_assess');
  } else if (ping.verdict === 'exit') {
    if (ping.exit_reason === 'none') errors.push('exit: exit_reason must not be none');
    if (ping.next_action !== 'ack_stop') errors.push('exit: next_action must be ack_stop');
  }

  return errors.length ? fail(errors) : ok({ ping });
}

function formatNewIds(ids) {
  return JSON.stringify(ids);
}

function parseNewIds(raw) {
  const text = String(raw).trim();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) { /* fall through to comma-split */ }
  if (text === '' || text === '[]') return [];
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

function coerceInt(raw) {
  const n = Number(raw);
  return Number.isInteger(n) ? n : raw;
}

function parsePingFields(block) {
  const ping = {};
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === PING_SENTINEL) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (!PING_KEYS.includes(key)) continue;
    if (key === 'pr' || key === 'tick' || key === 'new_count') ping[key] = coerceInt(value);
    else if (key === 'new_ids') ping[key] = parseNewIds(value);
    else ping[key] = value;
  }
  return ping;
}

/**
 * Parse a CHIEF_PING block out of Clerk's turn. Missing sentinel is invalid.
 * Boolean-only JSON (`{new:false}`) is invalid — idle is still a ping.
 */
function parseChiefPing(text) {
  if (looksLikeBooleanOnly(text)) {
    return fail(['boolean-only payload is not a CHIEF_PING']);
  }
  if (typeof text !== 'string' || !text.includes(PING_SENTINEL)) {
    return fail(['missing sentinel']);
  }
  const start = text.indexOf(PING_SENTINEL);
  let rest = text.slice(start);
  const ackAt = rest.indexOf(ACK_SENTINEL);
  if (ackAt !== -1) rest = rest.slice(0, ackAt);
  const ping = parsePingFields(rest);
  const result = validatePing(ping);
  return result.ok ? ok({ ping }) : result;
}

function formatChiefPing(ping) {
  const result = validatePing(ping);
  if (!result.ok) {
    throw new Error(`invalid CHIEF_PING: ${result.errors.join('; ')}`);
  }
  return [
    PING_SENTINEL,
    `pr: ${ping.pr}`,
    `tick: ${ping.tick}`,
    `verdict: ${ping.verdict}`,
    `exit_reason: ${ping.exit_reason}`,
    `new_count: ${ping.new_count}`,
    `new_ids: ${formatNewIds(ping.new_ids)}`,
    `watermark: ${ping.watermark}`,
    `next_action: ${ping.next_action}`,
  ].join('\n');
}

const ACK_RE = new RegExp(
  `${ACK_SENTINEL}\\s+tick=(\\d+)\\s+(${ACK_KINDS.join('|')})\\b`
);

function validateAck(ack, ping) {
  const errors = [];
  if (!isPlainObject(ack)) return fail(['ack must be an object']);
  if (!isNonNegInt(ack.tick)) errors.push('tick: required non-negative integer');
  if (!ACK_KINDS.includes(ack.kind)) {
    errors.push(`kind: must be ${ACK_KINDS.join('|')}`);
  }
  if (errors.length) return fail(errors);
  if (ping) {
    if (ack.tick !== ping.tick) errors.push(`ack tick ${ack.tick} does not match ping tick ${ping.tick}`);
    const expected = ACK_FOR_NEXT_ACTION[ping.next_action];
    if (expected && ack.kind !== expected) {
      errors.push(`ack kind ${ack.kind} does not match next_action ${ping.next_action}`);
    }
  }
  return errors.length ? fail(errors) : ok({ ack });
}

function parseChiefAck(text, ping) {
  if (typeof text !== 'string' || !text.includes(ACK_SENTINEL)) {
    return fail(['missing sentinel']);
  }
  const match = text.match(ACK_RE);
  if (!match) return fail(['missing sentinel']);
  const ack = { tick: Number(match[1]), kind: match[2] };
  return validateAck(ack, ping);
}

function formatChiefAck(ack) {
  const result = validateAck(ack);
  if (!result.ok) {
    throw new Error(`invalid CHIEF_ACK: ${result.errors.join('; ')}`);
  }
  return `${ACK_SENTINEL} tick=${ack.tick} ${ack.kind}`;
}

function validateWatchState(state) {
  const errors = [];
  if (!isPlainObject(state)) return fail(['watch state must be an object']);
  const keys = Object.keys(state);
  for (const key of keys) {
    if (!WATCH_KEYS.includes(key)) errors.push(`unknown key: ${key}`);
  }
  for (const key of WATCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(state, key)) {
      errors.push(`missing key: ${key}`);
    }
  }
  if (errors.length) return fail(errors);

  if (!isNonNegInt(state.pr) || state.pr < 1) errors.push('pr: required positive integer');
  if (!WATCH_STATUSES.includes(state.status)) {
    errors.push(`status: must be ${WATCH_STATUSES.join('|')}`);
  }
  if (!isNonNegInt(state.tick)) errors.push('tick: required non-negative integer');
  if (!isRfc3339(state.watermark)) errors.push('watermark: required RFC3339 timestamp');
  if (!isRfc3339(state.lastPingAt)) errors.push('lastPingAt: required RFC3339 timestamp');
  return errors.length ? fail(errors) : ok({ state });
}

module.exports = {
  PING_SENTINEL,
  ACK_SENTINEL,
  VERDICTS,
  EXIT_REASONS,
  NEXT_ACTIONS,
  ACK_KINDS,
  ACK_FOR_NEXT_ACTION,
  WATCH_STATUSES,
  WATCH_KEYS,
  parseChiefPing,
  formatChiefPing,
  parseChiefAck,
  formatChiefAck,
  validatePing,
  validateWatchState,
  looksLikeBooleanOnly,
};
