// Author: Subash Karki
// decision-contract-parity.test.js — the plan/brainstorm validators in
// scripts/validate-artifact.js and the portable
// skills/gorkhali/scripts/lib/decision-contracts.mjs are intentionally
// duplicated (the portable bundle cannot import the native validator). This
// file feeds BOTH the same on-disk rich fixture clone and checks that
// overlapping new-rule error strings fire together. Zero external deps.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { validate } = require('../scripts/validate-artifact');

const portableContracts = import(pathToFileURL(
  path.resolve(__dirname, '../skills/gorkhali/scripts/lib/decision-contracts.mjs'),
).href);

const loadRich = (type) => JSON.parse(
  fs.readFileSync(path.join(__dirname, `fixtures/decision-first/${type}-v3-rich.json`), 'utf8'),
);

const clone = (value) => JSON.parse(JSON.stringify(value));

const OVERLAPPING_NEW_RULES = [
  /briefing: required object/,
  /briefing\.how/,
  /evidence\[0\]\.implication/,
  /reasonNotSelected or reason must be unique/,
  /duplicate whyLens/,
  /duplicate thesis/,
  /effort, risk, and reversibility must not all be identical/,
];

async function runBoth(type, mutator) {
  const payload = clone(loadRich(type));
  if (mutator) mutator(payload);
  const { validateDecisionContract } = await portableContracts;
  return {
    native: validate(type, payload),
    portable: validateDecisionContract(type, payload),
  };
}

function assertBothFailWith(native, portable, expected, label) {
  assert.notEqual(native.length, 0, `${label}: native should return errors`);
  assert.notEqual(portable.length, 0, `${label}: portable should return errors`);
  assert.match(native.join('\n'), expected, `${label}: native missing ${expected}`);
  assert.match(portable.join('\n'), expected, `${label}: portable missing ${expected}`);
}

test('unmodified rich fixtures pass overlapping new-rule checks on both validators', async () => {
  const plan = await runBoth('plan');
  const brainstorm = await runBoth('brainstorm');

  // Prefer both validators returning []. If native extra-errors on a field
  // the portable one ignores, do not weaken either validator — parity here
  // is that the overlapping new-rule strings are absent from both lists.
  if (plan.native.length === 0 && plan.portable.length === 0) {
    assert.deepEqual(plan.native, []);
    assert.deepEqual(plan.portable, []);
  } else {
    for (const re of OVERLAPPING_NEW_RULES.slice(0, 4)) {
      assert.doesNotMatch(plan.native.join('\n'), re, `plan native extra ${re}`);
      assert.doesNotMatch(plan.portable.join('\n'), re, `plan portable extra ${re}`);
    }
  }

  if (brainstorm.native.length === 0 && brainstorm.portable.length === 0) {
    assert.deepEqual(brainstorm.native, []);
    assert.deepEqual(brainstorm.portable, []);
  } else {
    for (const re of OVERLAPPING_NEW_RULES.slice(4)) {
      assert.doesNotMatch(brainstorm.native.join('\n'), re, `brainstorm native extra ${re}`);
      assert.doesNotMatch(brainstorm.portable.join('\n'), re, `brainstorm portable extra ${re}`);
    }
  }
});

test('plan: missing briefing fails both validators', async () => {
  const { native, portable } = await runBoth('plan', (payload) => {
    delete payload.briefing;
  });
  assertBothFailWith(native, portable, /briefing: required object/, 'missing briefing');
});

test('plan: missing briefing.how fails both validators', async () => {
  const { native, portable } = await runBoth('plan', (payload) => {
    delete payload.briefing.how;
  });
  assertBothFailWith(native, portable, /briefing\.how/, 'missing briefing.how');
});

test('plan: verified evidence without implication fails both validators', async () => {
  const { native, portable } = await runBoth('plan', (payload) => {
    delete payload.evidence[0].implication;
  });
  assertBothFailWith(native, portable, /evidence\[0\]\.implication/, 'missing implication');
});

test('plan: duplicate alternative reasons fail both validators', async () => {
  const { native, portable } = await runBoth('plan', (payload) => {
    const first = payload.alternatives[0];
    const firstReason = first.reasonNotSelected || first.reason;
    if (!payload.alternatives[1]) {
      payload.alternatives.push({
        name: `${first.name} (copy)`,
        reasonNotSelected: firstReason,
      });
      return;
    }
    payload.alternatives[1].reasonNotSelected = firstReason;
    if (payload.alternatives[1].reason !== undefined) {
      payload.alternatives[1].reason = firstReason;
    }
  });
  assertBothFailWith(
    native,
    portable,
    /reasonNotSelected or reason must be unique/,
    'duplicate alternative reasons',
  );
});

test('brainstorm: duplicate whyLens fails both validators', async () => {
  const { native, portable } = await runBoth('brainstorm', (payload) => {
    payload.approaches[1].whyLens = payload.approaches[0].whyLens;
  });
  assertBothFailWith(native, portable, /duplicate whyLens/, 'duplicate whyLens');
});

test('brainstorm: duplicate thesis fails both validators', async () => {
  const { native, portable } = await runBoth('brainstorm', (payload) => {
    payload.approaches[1].thesis = payload.approaches[0].thesis;
  });
  assertBothFailWith(native, portable, /duplicate thesis/, 'duplicate thesis');
});

test('brainstorm: identical effort/risk/reversibility fails both validators', async () => {
  const { native, portable } = await runBoth('brainstorm', (payload) => {
    const { effort, risk, reversibility } = payload.approaches[0];
    for (const approach of payload.approaches) {
      approach.effort = effort;
      approach.risk = risk;
      approach.reversibility = reversibility;
    }
  });
  assertBothFailWith(
    native,
    portable,
    /effort, risk, and reversibility must not all be identical/,
    'identical effort/risk/reversibility',
  );
});
