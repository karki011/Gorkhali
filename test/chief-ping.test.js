// Author: Subash Karki
// chief-ping.test.js — pins the CHIEF_PING / CHIEF_ACK contract: idle is still
// a ping, boolean-only `{new:false}` is illegal, missing sentinel is invalid,
// and watch state may carry only the five keys. Zero external deps.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  PING_SENTINEL,
  ACK_SENTINEL,
  parseChiefPing,
  formatChiefPing,
  parseChiefAck,
  formatChiefAck,
  validatePing,
  validateWatchState,
  looksLikeBooleanOnly,
} = require('../scripts/lib/chief-ping');

const WATERMARK = '2026-08-25T21:40:00Z';

function idlePing(overrides = {}) {
  return {
    pr: 1234,
    tick: 12,
    verdict: 'idle',
    exit_reason: 'none',
    new_count: 0,
    new_ids: [],
    watermark: WATERMARK,
    next_action: 'ack_rearm',
    ...overrides,
  };
}

function newWorkPing(overrides = {}) {
  return idlePing({
    verdict: 'new_work',
    new_count: 2,
    new_ids: ['IC_1', 'PRRC_2'],
    next_action: 'ack_assess',
    ...overrides,
  });
}

function exitPing(overrides = {}) {
  return idlePing({
    verdict: 'exit',
    exit_reason: 'merged',
    next_action: 'ack_stop',
    ...overrides,
  });
}

test('sentinels are the greppable speech-act tokens', () => {
  assert.equal(PING_SENTINEL, 'CHIEF_PING');
  assert.equal(ACK_SENTINEL, 'CHIEF_ACK');
});

test('validatePing accepts idle with count 0, empty ids, reason none, ack_rearm', () => {
  const result = validatePing(idlePing());
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('validatePing accepts new_work with count>=1, ids length=count, ack_assess', () => {
  const result = validatePing(newWorkPing());
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('validatePing accepts exit when reason !== none and next_action is ack_stop', () => {
  for (const reason of ['merged', 'closed', 'approved_clean', 'ceiling', 'user_stop']) {
    const result = validatePing(exitPing({ exit_reason: reason }));
    assert.equal(result.ok, true, `${reason}: ${result.errors.join('; ')}`);
  }
});

test('idle rejects non-zero count, leftover ids, a real exit_reason, or the wrong ack', () => {
  assert.equal(validatePing(idlePing({ new_count: 1 })).ok, false);
  assert.equal(validatePing(idlePing({ new_ids: ['IC_1'] })).ok, false);
  assert.equal(validatePing(idlePing({ exit_reason: 'merged' })).ok, false);
  assert.equal(validatePing(idlePing({ next_action: 'ack_assess' })).ok, false);
});

test('new_work rejects count 0, mismatched ids length, and the wrong ack', () => {
  assert.equal(validatePing(newWorkPing({ new_count: 0, new_ids: [] })).ok, false);
  assert.equal(validatePing(newWorkPing({ new_count: 2, new_ids: ['only-one'] })).ok, false);
  assert.equal(validatePing(newWorkPing({ next_action: 'ack_rearm' })).ok, false);
});

test('new_work rejects comment bodies in new_ids — ids only', () => {
  const result = validatePing(newWorkPing({
    new_count: 1,
    new_ids: [{ id: 'IC_1', body: 'please fix this' }],
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /ids only/i.test(e)));
});

test('exit rejects exit_reason none and a non-stop next_action', () => {
  assert.equal(validatePing(exitPing({ exit_reason: 'none' })).ok, false);
  assert.equal(validatePing(exitPing({ next_action: 'ack_rearm' })).ok, false);
});

test('watermark must be RFC3339', () => {
  assert.equal(validatePing(idlePing({ watermark: 'not-a-date' })).ok, false);
  assert.equal(validatePing(idlePing({ watermark: '2026-08-25 21:40:00' })).ok, false);
  // Shape-valid (regex) but calendar-impossible — Date.parse is NaN.
  assert.equal(validatePing(idlePing({ watermark: '2026-13-45T99:99:99Z' })).ok, false);
  assert.equal(validatePing(idlePing({ watermark: '2026-08-25T21:40:00.123Z' })).ok, true);
  assert.equal(validatePing(idlePing({ watermark: '2026-08-25T21:40:00+00:00' })).ok, true);
});

test('formatChiefPing / parseChiefPing round-trip idle, new_work, and exit', () => {
  for (const ping of [idlePing(), newWorkPing(), exitPing({ exit_reason: 'ceiling' })]) {
    const text = formatChiefPing(ping);
    assert.match(text, /^CHIEF_PING\n/);
    const parsed = parseChiefPing(text);
    assert.equal(parsed.ok, true, parsed.errors.join('; '));
    assert.deepEqual(parsed.ping, ping);
  }
});

test('parseChiefPing finds the sentinel inside surrounding Clerk prose', () => {
  const block = formatChiefPing(idlePing());
  const parsed = parseChiefPing(`checking github...\n${block}\nwaiting for ack`);
  assert.equal(parsed.ok, true, parsed.errors.join('; '));
  assert.equal(parsed.ping.verdict, 'idle');
});

test('missing sentinel is invalid', () => {
  const noPing = parseChiefPing('pr: 1\ntick: 0\nverdict: idle');
  assert.equal(noPing.ok, false);
  assert.ok(noPing.errors.some((e) => /missing sentinel/i.test(e)));

  const noAck = parseChiefAck('tick=12 idle');
  assert.equal(noAck.ok, false);
  assert.ok(noAck.errors.some((e) => /missing sentinel/i.test(e)));
});

test('boolean-only JSON is invalid — {new:false} is not a ping', () => {
  assert.equal(looksLikeBooleanOnly({ new: false }), true);
  assert.equal(looksLikeBooleanOnly({ new: true }), true);
  assert.equal(looksLikeBooleanOnly('{"new":false}'), true);
  assert.equal(looksLikeBooleanOnly('{new:false}'), true);
  assert.equal(looksLikeBooleanOnly('{ "new": false }'), true);
  assert.equal(looksLikeBooleanOnly(false), true);

  for (const payload of ['{"new":false}', '{new:false}', { new: false }]) {
    const parsed = typeof payload === 'string'
      ? parseChiefPing(payload)
      : validatePing(payload);
    assert.equal(parsed.ok, false, `should reject ${JSON.stringify(payload)}`);
    assert.ok(parsed.errors.some((e) => /boolean-only/i.test(e)));
  }
});

test('looksLikeBooleanOnly is false for a real ping object or CHIEF_PING block', () => {
  assert.equal(looksLikeBooleanOnly(idlePing()), false);
  assert.equal(looksLikeBooleanOnly(formatChiefPing(idlePing())), false);
  assert.equal(looksLikeBooleanOnly('still watching'), false);
});

test('formatChiefAck / parseChiefAck: CHIEF_ACK tick=N idle|assess|stop', () => {
  const cases = [
    [{ tick: 12, kind: 'idle' }, 'CHIEF_ACK tick=12 idle'],
    [{ tick: 0, kind: 'assess' }, 'CHIEF_ACK tick=0 assess'],
    [{ tick: 60, kind: 'stop' }, 'CHIEF_ACK tick=60 stop'],
  ];
  for (const [ack, expected] of cases) {
    assert.equal(formatChiefAck(ack), expected);
    const parsed = parseChiefAck(expected);
    assert.equal(parsed.ok, true, parsed.errors.join('; '));
    assert.deepEqual(parsed.ack, ack);
  }
});

test('ack kind must match ping next_action', () => {
  const idle = parseChiefAck('CHIEF_ACK tick=12 idle', idlePing());
  assert.equal(idle.ok, true, idle.errors.join('; '));

  const mismatchIdle = parseChiefAck('CHIEF_ACK tick=12 assess', idlePing());
  assert.equal(mismatchIdle.ok, false);

  const assess = parseChiefAck('CHIEF_ACK tick=12 assess', newWorkPing());
  assert.equal(assess.ok, true, assess.errors.join('; '));

  const stop = parseChiefAck('CHIEF_ACK tick=12 stop', exitPing());
  assert.equal(stop.ok, true, stop.errors.join('; '));

  const wrongTick = parseChiefAck('CHIEF_ACK tick=99 idle', idlePing());
  assert.equal(wrongTick.ok, false);
});

test('validateWatchState allows only pr, status, tick, watermark, lastPingAt', () => {
  const state = {
    pr: 1234,
    status: 'watching',
    tick: 12,
    watermark: WATERMARK,
    lastPingAt: '2026-08-25T21:42:00Z',
  };
  assert.equal(validateWatchState(state).ok, true);

  for (const status of ['watching', 'paused', 'stopped']) {
    assert.equal(validateWatchState({ ...state, status }).ok, true, status);
  }

  assert.equal(validateWatchState({ ...state, extra: 1 }).ok, false);
  assert.equal(validateWatchState({ ...state, comments: [] }).ok, false);
  const missing = { ...state };
  delete missing.lastPingAt;
  assert.equal(validateWatchState(missing).ok, false);
  assert.equal(validateWatchState({ ...state, status: 'paused-ceiling' }).ok, false);
  assert.equal(validateWatchState({ ...state, watermark: 'soon' }).ok, false);
  assert.equal(validateWatchState({ ...state, lastPingAt: '2026-13-45T99:99:99Z' }).ok, false);
});

test('formatChiefPing throws on an illegal ping rather than emitting a quiet idle', () => {
  assert.throws(() => formatChiefPing({ new: false }), /boolean-only|invalid CHIEF_PING/);
  assert.throws(() => formatChiefPing(idlePing({ next_action: 'ack_stop' })), /invalid CHIEF_PING/);
});
