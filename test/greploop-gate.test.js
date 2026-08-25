// Author: Subash Karki
// greploop-gate.test.js — locks the greploop Stop gate's behavior. This is a
// discipline gate that FAILS OPEN: it only BLOCKS the stop when an active
// gorkhali session has a freshly-created LIVE PR whose greptile loop has not
// settled (greptile.status missing/pending). Any ambiguity, inactive session,
// settled (merged/closed) PR, or settled loop ALLOWS. The fixtures below still
// carry pr.status "draft" alongside "open" because the gate is status-agnostic:
// wrap now writes "open", legacy sessions wrote "draft", and both must gate.
// It is BOUNDED — at most
// GORKHALI_GREPLOOP_GATE_MAX blocks per PR (default 3), then it allows forever.
//
// Spawns the REAL hook process. Env is read at INVOCATION time, so every spawn
// pins GORKHALI_DATA to a fresh tmpdir, and GORKHALI_GREPLOOP_GATE_MAX is set
// only when the case overrides it (never inherited from the outer shell).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'greploop-gate.js');

function runGate(envOverrides, stdinObj, cwd) {
  const env = { ...process.env, ...envOverrides };
  // The bound is read from env at invocation; outer shell state must not leak.
  if (!envOverrides.GORKHALI_GREPLOOP_GATE_MAX) delete env.GORKHALI_GREPLOOP_GATE_MAX;
  // Session resolution is cwd-scoped: detectRepo walks from cwd. Drive it via
  // the cwd in the Stop payload (matching how the hook reads cwd).
  const stdinText = typeof stdinObj === 'string'
    ? stdinObj
    : JSON.stringify({ cwd, ...stdinObj });
  try {
    const stdout = execFileSync('node', [HOOK], {
      input: stdinText,
      env,
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
    });
    return { code: 0, stdout };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: (e.stdout || '').toString(),
    };
  }
}

// Fresh GORKHALI_DATA + a fake worktree cwd. Writes the .chief-active marker, the
// current-session/<repo>.json pointer (so ticket resolution succeeds), and the
// session wrap.json at the SAME path the gate resolves. `wrap` is written
// verbatim when a string (malformed case), else JSON.stringified. Pass
// active:false to skip .chief-active; resolvable:false to omit the
// current-session pointer AND use a detached cwd (→ fail-open). markerName
// overrides the marker filename (default '.chief-active') to exercise the
// .apex-active upgrade-shim fallback.
function setup({ wrap, active = true, repo = 'myrepo', ticket = 'PROJ-1', resolvable = true, markerName = '.chief-active' } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-data-'));
  if (active) fs.writeFileSync(path.join(data, markerName), '');

  // cwd under <data>/worktrees/<repo>/<ticket> → detectRepo returns <repo>
  // (not <ticket>), exercising the worktree-aware path.
  const cwd = path.join(data, 'worktrees', repo, ticket);
  fs.mkdirSync(cwd, { recursive: true });

  if (resolvable) {
    const csDir = path.join(data, 'state', 'current-session');
    fs.mkdirSync(csDir, { recursive: true });
    // Version-2 multi-task pointer shape: the gate resolves the FOCUS task id
    // (here, the ticket itself) rather than a dedicated `ticket` field.
    fs.writeFileSync(path.join(csDir, repo + '.json'), JSON.stringify({
      schema_version: 2,
      repo_id: repo,
      focus_task_id: ticket,
      tasks: { [ticket]: { session_dir: path.join(data, 'repos', repo, 'sessions', ticket), updated_at: new Date().toISOString() } },
    }));
  }

  const sessDir = path.join(data, 'repos', repo, 'sessions', ticket);
  fs.mkdirSync(sessDir, { recursive: true });
  if (wrap !== undefined) {
    const body = typeof wrap === 'string' ? wrap : JSON.stringify(wrap);
    fs.writeFileSync(path.join(sessDir, 'wrap.json'), body);
  }

  return { data, cwd, env: { GORKHALI_DATA: data } };
}

function assertBlock(res, prNumber) {
  assert.equal(res.code, 0, 'decision rides the JSON, not the exit code');
  const out = JSON.parse(res.stdout);
  assert.equal(out.decision, 'block');
  if (prNumber !== undefined) {
    assert.match(out.reason, new RegExp(`#${prNumber}\\b`), 'reason names the PR number');
  }
}

function assertAllow(res, msg) {
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), '', msg || 'an allow carries no decision JSON');
}

test('1. draft + greptile pending → BLOCK (reason names the PR)', () => {
  const { env, cwd } = setup({ wrap: { pr: { number: 42, status: 'draft' }, greptile: { status: 'pending' } } });
  assertBlock(runGate(env, {}, cwd), 42);
});

test('2. draft + greptile done → ALLOW (loop already settled)', () => {
  const { env, cwd } = setup({ wrap: { pr: { number: 42, status: 'draft' }, greptile: { status: 'done' } } });
  assertAllow(runGate(env, {}, cwd));
});

test('3. draft + greptile skipped → ALLOW', () => {
  const { env, cwd } = setup({ wrap: { pr: { number: 42, status: 'draft' }, greptile: { status: 'skipped' } } });
  assertAllow(runGate(env, {}, cwd));
});

test('4. draft + greptile object absent → BLOCK', () => {
  const { env, cwd } = setup({ wrap: { pr: { number: 42, status: 'draft' } } });
  assertBlock(runGate(env, {}, cwd), 42);
});

test('5. pr.status open-LABELED draft + pending → BLOCK (liveness, not literal "draft")', () => {
  // wrap writes pr.status "open" for the ready-for-review PR it creates.
  // Gating on liveness — not any literal status word — means this open PR is
  // gated exactly like the legacy "draft" fixtures above.
  const { env, cwd } = setup({ wrap: { pr: { number: 42, status: 'open' }, greptile: { status: 'pending' } } });
  assertBlock(runGate(env, {}, cwd), 42);
});

test('6. pr null / absent → ALLOW (no real PR)', () => {
  const { env, cwd } = setup({ wrap: { pr: null, greptile: { status: 'pending' } } });
  assertAllow(runGate(env, {}, cwd));
});

test('7. no .chief-active marker (inactive session) → ALLOW even with draft+pending', () => {
  const { env, cwd } = setup({ active: false, wrap: { pr: { number: 42, status: 'draft' }, greptile: { status: 'pending' } } });
  assertAllow(runGate(env, {}, cwd), 'gate only fires inside a live session');
});

test('7b. legacy .apex-active marker alone (upgrade shim) → BLOCK same as .chief-active', () => {
  // .apex-active is the pre-rename marker filename; a not-yet-upgraded install
  // may still be writing it. The gate must recognize it exactly like
  // .chief-active until it naturally ages out.
  const { env, cwd } = setup({
    markerName: '.apex-active',
    wrap: { pr: { number: 42, status: 'draft' }, greptile: { status: 'pending' } },
  });
  assertBlock(runGate(env, {}, cwd), 42);
});

test('8. malformed wrap.json → ALLOW (fail-open)', () => {
  const { env, cwd } = setup({ wrap: '{{{not json' });
  assertAllow(runGate(env, {}, cwd));
});

test('9. bounded-fire: default max blocks 3x then allows the 4th', () => {
  // One GORKHALI_DATA reused across all 4 spawns so the counter file persists.
  const { env, cwd } = setup({ wrap: { pr: { number: 7, status: 'draft' }, greptile: { status: 'pending' } } });
  assertBlock(runGate(env, {}, cwd), 7);
  assertBlock(runGate(env, {}, cwd), 7);
  assertBlock(runGate(env, {}, cwd), 7);
  assertAllow(runGate(env, {}, cwd), 'ceiling hit → never trap');
});

test('10. GORKHALI_GREPLOOP_GATE_MAX=1 → first BLOCKs, second ALLOWS', () => {
  const { env, cwd } = setup({ wrap: { pr: { number: 9, status: 'draft' }, greptile: { status: 'pending' } } });
  assertBlock(runGate({ ...env, GORKHALI_GREPLOOP_GATE_MAX: '1' }, {}, cwd), 9);
  assertAllow(runGate({ ...env, GORKHALI_GREPLOOP_GATE_MAX: '1' }, {}, cwd), 'env override respected');
});

test('11. repo/ticket unresolvable (no current-session, detached cwd) → ALLOW (fail-open)', () => {
  // resolvable:false omits current-session/<repo>.json. Run from a detached
  // cwd outside any worktree/repo so detectRepo can't pin a repo and git has
  // no branch → resolution returns null → allow, never newest-anywhere.
  const { env } = setup({ resolvable: false, wrap: { pr: { number: 99, status: 'draft' }, greptile: { status: 'pending' } } });
  const detached = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-detached-'));
  try {
    assertAllow(runGate(env, {}, detached), 'unresolvable session must fail open, not gate newest-anywhere');
  } finally {
    fs.rmSync(detached, { recursive: true, force: true });
  }
});

// --- Integration-shaped cases driven by REAL wrap.json field values ---------
// The greptile.status strings below are verbatim values recorded in the field
// (not idealized enums). The gate matches case-insensitively by PREFIX, so any
// "settled" prefix (skipped/done/n/a/unavailable/unknown) must ALLOW; only
// pending/requested/empty/missing on a live PR blocks.

test('12. greptile.status freeform "skipped — availability guard ..." → ALLOW', () => {
  const { env, cwd } = setup({
    wrap: { pr: { number: 42, status: 'draft' }, greptile: { status: 'skipped — availability guard (Greptile not installed on this repo)' } },
  });
  assertAllow(runGate(env, {}, cwd), 'freeform skipped prefix is settled');
});

test('13. greptile.status "n/a" → ALLOW (unknown settled value)', () => {
  const { env, cwd } = setup({ wrap: { pr: { number: 42, status: 'draft' }, greptile: { status: 'n/a' } } });
  assertAllow(runGate(env, {}, cwd), 'n/a biases to allow');
});

test('14. greptile.status "unavailable — no auto-review in 200s ..." → ALLOW', () => {
  const { env, cwd } = setup({
    wrap: { pr: { number: 42, status: 'draft' }, greptile: { status: 'unavailable — no auto-review in 200s ...' } },
  });
  assertAllow(runGate(env, {}, cwd), 'unavailable prefix is settled');
});

test('15. greptile object entirely absent on a draft PR → BLOCK', () => {
  const { env, cwd } = setup({ wrap: { pr: { number: 42, status: 'draft' } } });
  assertBlock(runGate(env, {}, cwd), 42);
});

test('16. pr.status merged + greptile pending → ALLOW (merged PR not gated)', () => {
  const { env, cwd } = setup({ wrap: { pr: { number: 42, status: 'merged' }, greptile: { status: 'pending' } } });
  assertAllow(runGate(env, {}, cwd), 'merged PR is settled, never gated');
});

test('17. pr.status closed + greptile pending → ALLOW (closed PR not gated)', () => {
  const { env, cwd } = setup({ wrap: { pr: { number: 42, status: 'closed' }, greptile: { status: 'pending' } } });
  assertAllow(runGate(env, {}, cwd), 'closed PR is settled, never gated');
});

test('18. greptile.status "done — 5/5" freeform → ALLOW (done prefix settled)', () => {
  const { env, cwd } = setup({ wrap: { pr: { number: 42, status: 'draft' }, greptile: { status: 'done — 5/5' } } });
  assertAllow(runGate(env, {}, cwd), 'freeform done prefix is settled');
});
