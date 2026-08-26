// Author: Subash Karki
// safety-wiring.test.js — every brake in this repo has to have something
// PULLING it. The defect this file guards against is not a wrong decision, it is
// a correct decision nobody calls:
//
//   - `loop-controller.incrementFixLoops()` was exported, tested, and invoked by
//     nothing. The fix-loop ceiling read the counter it was supposed to bump, so
//     the counter stayed 0, the hard stop never fired, and the
//     verify -> review -> fix -> verify cycle ran unbounded.
//   - `scripts/run-guard.js` — the unattended-run spend ceiling, whose own header
//     names `commands/loop.md` as the reason it exists — was called by no command
//     at all.
//
// Both were invisible because every unit test passed: the logic WAS correct. What
// was missing was a caller, and only a wiring test sees that. So this file
// asserts the callers, in the live files a reader would look in.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

function read(...parts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...parts), 'utf8');
}

test('commands/loop.md invokes the unattended run guard it was built for', () => {
  const doc = read('commands', 'loop.md');
  assert.match(doc, /scripts\/run-guard\.js/, 'the unattended path must call the guard');
  assert.match(doc, /--unattended/, 'the guard binds unattended runs only, so the flag is required');
  assert.match(doc, /[Ee]xit 1/, 'the caller must be told which exit code halts');
});

test('commands/fix.md reads the fix-loop standing from the ledger, not a dead field', () => {
  const doc = read('commands', 'fix.md');
  assert.match(doc, /review-round\.js"? status/, 'the loop count comes from the round ledger CLI');
  assert.match(doc, /rounds\.json/, 'and the artifact is named where a reader will look');
  assert.match(doc, /--session \{SESSION_DIR\}/, 'so a logged operator override is honoured');
});

test('the loop brakes are invoked through the plugin root, never a bare relative path', () => {
  // A bare `node scripts/...` in a command resolves against the USER'S project,
  // where the plugin's scripts do not exist. For a reporting script that means it
  // silently never runs; for run-guard it is worse, because its MODULE_NOT_FOUND
  // exit 1 is the same code that means "confirmed budget halt".
  const GUARDS = ['run-guard.js', 'review-round.js', 'outcome-write.js'];
  const offenders = [];
  for (const file of fs.readdirSync(path.join(REPO_ROOT, 'commands'))) {
    if (!file.endsWith('.md')) continue;
    read('commands', file)
      .split('\n')
      .forEach((line, i) => {
        if (!GUARDS.some((g) => line.includes(g))) return;
        if (/node\s+"?\$PR\//.test(line)) return; // resolved through the plugin root
        if (!/node\s/.test(line)) return; // prose mention, not an invocation
        offenders.push(`commands/${file}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(offenders, [], `unresolved brake invocations:\n${offenders.join('\n')}`);
});

test('the fix-loop gate reads the artifact the portable flow writes', () => {
  const hook = read('hooks', 'fix-loop-gate.js');
  assert.match(hook, /'reviews', 'rounds\.json'/, 'the ledger is the primary source');
  assert.match(hook, /'verification\.json'/, 'the legacy artifact stays as the fallback');
});

test('nothing exports a fix-loop increment for a caller to forget', () => {
  const lc = require(path.join(REPO_ROOT, 'hooks', 'loop-controller.js'));
  assert.equal(
    typeof lc.incrementFixLoops,
    'undefined',
    'the append-only round ledger increments itself; a manual increment is a caller waiting to be forgotten'
  );
});

test('the durable outcome record counts loops from the ledger too', () => {
  const src = read('scripts', 'outcome-write.js');
  assert.match(src, /rounds\.json/, 'fix_loops must not be mined from an artifact nothing writes');
  assert.match(src, /resolveFixLoops/, 'and it uses the one resolver, not a private copy');
});

test('wrap.md invokes outcome-write for the durable record', () => {
  const doc = read('commands', 'wrap.md');
  assert.match(doc, /scripts\/outcome-write\.js/, 'wrap must call the script, not invent wrap.json measurement keys');
  assert.match(doc, /outcome\.json/, 'the durable record is named');
  assert.match(doc, /--repo-path/, 'wrap passes the workspace so git/gh resolve');
  assert.match(doc, /never blocks wrap|outcome\.json not written, wrap continues/, 'outcome-write failure is non-blocking');
});
