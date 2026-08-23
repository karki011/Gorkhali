// Author: Subash Karki
// baseline-merge-rate.test.js — F12. Merge rate counted a still-open PR as a
// failure to merge.
//
// The 2026-08-13 run over the author's corpus resolved 11 distinct PR urls —
// 9 merged, 2 open, 0 closed — and printed 81.8%, because the denominator was
// every RESOLVED PR rather than every SETTLED one. Nine of nine settled PRs had
// merged. ROADMAP.md §3 records 99.1% over 111 merged + 1 closed with ZERO
// open, so the apparent collapse from 99.1% to 81.8% was mostly definitional:
// the two numbers never divided by the same thing.
//
// What is pinned here, watchable rather than "it passes":
//
//   1. two unfinished PRs no longer drag a perfect settled record below 100%;
//   2. the printed basis states which numbers were divided, so the old and the
//      new figure can be told apart on sight;
//   3. a corpus with NOTHING settled reports absent, never 0% and never 100%,
//      and says so in unresolved[].
//
// gh is the ground truth for PR state, so these tests run the production miner
// against a fake `gh` on PATH rather than stubbing the miner's internals.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const MINER = path.join(REPO_ROOT, 'scripts', 'baseline-report.js');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/**
 * A `gh` that answers the miner's two calls — `gh --version` and the batched
 * `gh api graphql` PR-state query — from a state map handed in by env.
 */
function fakeGhDir(states) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f12-gh-'));
  fs.writeFileSync(
    path.join(dir, 'gh.js'),
    `'use strict';
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('gh version 2.0.0 (fake)\\n'); process.exit(0); }
const states = JSON.parse(process.env.FAKE_GH_STATES || '{}');
const query = (argv.find((a) => a.startsWith('query=')) || '');
const out = {};
for (const m of query.matchAll(/p(\\d+):pullRequest/g)) {
  const n = m[1];
  const state = states[n];
  out['p' + n] = state
    ? { state, isDraft: state === 'DRAFT', reviews: { totalCount: 1 }, comments: { totalCount: 2 } }
    : null;
  if (state === 'DRAFT') out['p' + n].state = 'OPEN';
}
process.stdout.write(JSON.stringify({ data: { r: out } }) + '\\n');
`
  );
  fs.writeFileSync(path.join(dir, 'gh'), '#!/bin/sh\nexec node "$(dirname "$0")/gh.js" "$@"\n', { mode: 0o755 });
  return { dir, states };
}

/** One wrapped ticket per PR number, all in one repo so it is a single query. */
function buildCorpus(numbers) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'f12-'));
  const base = path.join(data, 'repos', 'feature-web-apps');
  for (const n of numbers) {
    writeJson(path.join(base, 'completed', 'CP-' + n, 'wrap.json'), {
      brief: 'ticket ' + n,
      pr: { number: n, url: 'https://github.com/acme/feature-web-apps/pull/' + n, status: 'whatever free text' },
    });
  }
  return data;
}

function mine(dataRoot, gh, extraArgs = []) {
  return execFileSync('node', [MINER, ...extraArgs], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      GORKHALI_DATA: dataRoot,
      PATH: gh.dir + path.delimiter + process.env.PATH,
      FAKE_GH_STATES: JSON.stringify(gh.states),
    },
  });
}

function withCorpus(states, fn) {
  const numbers = Object.keys(states).map(Number);
  const data = buildCorpus(numbers);
  const gh = fakeGhDir(states);
  try {
    fn(data, gh);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(gh.dir, { recursive: true, force: true });
  }
}

// The exact shape of the real run: 9 merged, 2 open, 0 closed.
const NINE_MERGED_TWO_OPEN = {};
for (let n = 1; n <= 9; n++) NINE_MERGED_TWO_OPEN[n] = 'MERGED';
NINE_MERGED_TWO_OPEN[10] = 'OPEN';
NINE_MERGED_TWO_OPEN[11] = 'OPEN';

test('two unfinished PRs do not drag a 9-of-9 settled record below 100%', () => {
  withCorpus(NINE_MERGED_TWO_OPEN, (data, gh) => {
    const r = JSON.parse(mine(data, gh, ['--json'])).prs;

    assert.equal(r.ghResolved, 11, 'all 11 urls resolved, exactly as the real run did');
    assert.deepEqual(r.stateCounts, { draft: 0, open: 2, merged: 9, closed: 0 });

    // The open pair is counted and reported — it is excluded from the
    // denominator, not from the report.
    assert.equal(r.settledPrs, 9);
    assert.equal(r.unfinishedPrs, 2);

    assert.equal(r.mergeRate, 1, '9 merged of 9 SETTLED is 100%, not 9 of 11');
    assert.notEqual(r.mergeRate, 9 / 11, 'the old denominator would have read 81.8%');

    const human = mine(data, gh);
    assert.match(human, /merge rate\s+100\.0%/);
    assert.doesNotMatch(human, /merge rate\s+81\.8%/);
    assert.match(human, /settled \/ unfinished\s+9 \(merged\+closed\) \/ 2 \(open\+draft\)/);
  });
});

test('the basis names the denominator, so the old and new numbers cannot be confused', () => {
  withCorpus(NINE_MERGED_TWO_OPEN, (data, gh) => {
    const basis = JSON.parse(mine(data, gh, ['--json'])).prs.mergeRateBasis;

    // Which numbers were divided, literally.
    assert.match(basis, /merged\/\(merged\+closed\) = 9\/9 settled distinct PR url\(s\)/);
    // What was left out, and why it is not a failure.
    assert.match(basis, /2 unfinished \(open 2, draft 0\) EXCLUDED from the denominator/);
    assert.match(basis, /an unfinished PR is not a failed one/);
    // And the coverage it rests on.
    assert.match(basis, /gh ground truth over 11 resolved/);

    // ROADMAP §3's 99.1% was 111 merged + 1 closed with zero open. A basis that
    // says "0 open and 0 draft" is what makes that one comparable to this one.
    const allSettled = { 1: 'MERGED', 2: 'MERGED', 3: 'CLOSED' };
    withCorpus(allSettled, (d2, gh2) => {
      const b2 = JSON.parse(mine(d2, gh2, ['--json'])).prs.mergeRateBasis;
      assert.match(b2, /merged\/\(merged\+closed\) = 2\/3 settled/);
      assert.match(b2, /0 open and 0 draft, so settled = every resolved PR/);
    });

    const report = JSON.parse(mine(data, gh, ['--json']));
    const note = report.unresolved.find((u) => u.field === 'merge_rate' && /F12/.test(u.reason));
    assert.ok(note, 'the excluded PRs are named in unresolved[], the way every other gap is');
    assert.match(note.reason, /2 resolved distinct PR url\(s\) are still open\/draft/);
    assert.match(note.reason, /their eventual outcome is not estimated here/);
  });
});

test('a draft PR is unfinished too - it is not a closed one', () => {
  withCorpus({ 1: 'MERGED', 2: 'DRAFT' }, (data, gh) => {
    const r = JSON.parse(mine(data, gh, ['--json'])).prs;
    assert.deepEqual(r.stateCounts, { draft: 1, open: 0, merged: 1, closed: 0 });
    assert.equal(r.settledPrs, 1);
    assert.equal(r.unfinishedPrs, 1);
    assert.equal(r.mergeRate, 1);
    assert.match(r.mergeRateBasis, /1 unfinished \(open 0, draft 1\)/);
  });
});

test('nothing settled yet is UNMEASURABLE - never 0%, never 100%', () => {
  withCorpus({ 1: 'OPEN', 2: 'OPEN', 3: 'DRAFT' }, (data, gh) => {
    const report = JSON.parse(mine(data, gh, ['--json']));
    const r = report.prs;

    assert.equal(r.ghResolved, 3, 'the PRs exist and were read');
    assert.equal(r.settledPrs, 0);
    assert.equal(r.mergeRate, null, 'an empty denominator has no rate - not zero, not one');
    assert.match(r.mergeRateBasis, /UNMEASURABLE: 0 settled PRs \(merged\+closed\) among 3 resolved/);

    const human = mine(data, gh);
    assert.match(human, /merge rate\s+absent/);
    assert.doesNotMatch(human, /merge rate\s+(0\.0%|100\.0%)/);

    const note = report.unresolved.find((u) => u.field === 'merge_rate' && /UNMEASURABLE/.test(u.reason));
    assert.ok(note, 'an unmeasurable merge rate is named in unresolved[]');
    assert.match(note.reason, /not 0% and not 100%/);
  });
});
