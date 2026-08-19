// Author: Subash Karki
// migrate-data.test.js -- covers scripts/migrate-data.js's live-state handling:
// (1) a focused unit test for the liveStateReason() classifier's reachable
// branches (state/* sub-paths), and (2) an integration-level reachability test
// proving that root-level runtime state -- the active-editing markers (current
// and pre-rename spellings) and managed worktrees -- is never inventoried at
// all, because inventory() only walks source.root/<WHITELIST_DIRS entry>/...
// and those root-level paths are siblings of the whitelisted dirs, not inside
// them. A fixture that calls the classifier directly cannot prove this: it
// only proves the classifier would return a reason if reached, not that the
// real inventory() flow ever reaches it.
//
// See test/data-root-migration.test.js for the full dry-run/apply fixture
// coverage of every other artifact class.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { _internals } = require('../scripts/migrate-data.js');
const { liveStateReason, inventory } = _internals;

test('liveStateReason classifies state/* sub-paths as live state', () => {
  assert.equal(liveStateReason(['state', 'current-session']), 'current-session-pointer');
  assert.equal(liveStateReason(['state', 'session-telemetry']), 'runtime-session-telemetry');
  assert.equal(liveStateReason(['state', 'routing-nudge']), 'stale-active-marker');
  assert.equal(liveStateReason(['state', 'memory-injected']), 'stale-active-marker');
  assert.equal(liveStateReason(['state', '.active-wake-session-abc']), 'stale-active-marker');
});

test('liveStateReason does not classify an ordinary file as a marker', () => {
  assert.equal(liveStateReason(['learnings.json']), null);
  assert.equal(liveStateReason(['repos', 'some-repo', 'sessions']), null);
});

// Integration-level reachability test: plant root-level markers and a managed
// worktrees dir at a real fixture source root (as an unresolved install would
// leave them) and run the actual inventory() path. They must never appear as
// ANY item -- not imported, not skipped-live-state, not any class -- because
// the whitelist walk never descends into them. A whitelisted sibling (sessions/)
// proves the source root is otherwise fully scanned.
test('root-level runtime state is never inventoried (markers + worktrees are whitelist-excluded, not classified)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-data-root-state-'));
  try {
    const src = path.join(tmp, 'src');
    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });

    // Current and pre-rename marker spellings, at the source root (siblings of
    // the whitelisted dirs, matching how hooks/greploop-gate.js and
    // hooks/engineer-marker-state.js actually place them).
    fs.writeFileSync(path.join(src, '.chief-active'), 'marker-current\n');
    fs.writeFileSync(path.join(src, '.engineer-editing'), 'marker-current\n');
    fs.writeFileSync(path.join(src, '.apex-active'), 'marker-legacy\n');
    fs.writeFileSync(path.join(src, '.blade-editing'), 'marker-legacy\n');

    // Managed worktrees dir -- flat under the root, per phantom-paths.js.
    fs.mkdirSync(path.join(src, 'worktrees', 'some-repo', 'T'), { recursive: true });
    fs.writeFileSync(path.join(src, 'worktrees', 'some-repo', 'T', 'code.js'), 'live worktree file\n');

    // A whitelisted sibling, so we can prove the source root is scanned at all.
    fs.mkdirSync(path.join(src, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(src, 'sessions', 'hello.json'), '{"ok":true}\n');

    const sources = [{ label: 'test-src', root: src, present: true, realpath: src }];
    const context = { dest, sources, mapOverrides: {} };

    const items = inventory(context);

    assert.equal(items.length, 1, 'only the whitelisted sessions/ file should be inventoried');
    assert.equal(items[0].srcRel, path.join('sessions', 'hello.json'));
    assert.equal(items[0].class, 'imported');

    // No item of any class references the markers or the worktrees dir.
    for (const item of items) {
      assert.ok(!item.srcRel.includes('worktrees'), `unexpected worktrees item: ${item.srcRel}`);
      assert.ok(!/\.(chief|apex)-active|\.(engineer|blade)-editing/.test(item.srcRel),
        `unexpected marker item: ${item.srcRel}`);
    }

    // inventory() is pure: dest is untouched regardless.
    assert.deepEqual(fs.readdirSync(dest), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
