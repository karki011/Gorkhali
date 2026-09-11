// Author: Subash Karki
// session.test.js - lib/session.js: creation, idempotent reopen, progress
// append, scratch isolation, missing-session read, and the .session-active
// sentinel appearing on open and disappearing on close.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const session = require('../lib/session');
const paths = require('../lib/paths');

// Each test points GORKHALI_DATA at its own fresh temp dir so paths.dataRoot()
// resolves there instead of the real $HOME/.gorkhali, then restores whatever
// was set before. The `cwd` passed to session/paths helpers only matters for
// git-derived repo-slug lookups here, so any dir works.
function withTmpDataRoot(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
  const prev = process.env.GORKHALI_DATA;
  process.env.GORKHALI_DATA = dir;
  try {
    fn(dir);
  } finally {
    if (prev === undefined) delete process.env.GORKHALI_DATA;
    else process.env.GORKHALI_DATA = prev;
  }
}

test('openSession creates the session dir, scratch dir and sentinel', () => {
  withTmpDataRoot((cwd) => {
    const dir = session.openSession('repo-a', 'TASK-1', cwd);

    assert.equal(dir, paths.sessionDir('repo-a', 'TASK-1', cwd));
    assert.ok(fs.statSync(dir).isDirectory());
    assert.ok(fs.statSync(path.join(dir, 'scratch')).isDirectory());

    const sentinel = paths.sentinelPath(cwd);
    assert.ok(fs.existsSync(sentinel), 'sentinel should exist after open');

    const active = session.activeSession(cwd);
    assert.equal(active.repo, 'repo-a');
    assert.equal(active.task, 'TASK-1');
    assert.equal(active.sessionDir, dir);
  });
});

test('reopening an existing session is idempotent and never clobbers plan/progress', () => {
  withTmpDataRoot((cwd) => {
    session.openSession('repo-a', 'TASK-1', cwd);
    session.writePlan('repo-a', 'TASK-1', { hello: 'world' }, cwd);
    session.appendProgress('repo-a', 'TASK-1', { note: 'first' }, cwd);

    // Reopen: must not touch plan.json or progress.json.
    session.openSession('repo-a', 'TASK-1', cwd);

    assert.deepEqual(session.readPlan('repo-a', 'TASK-1', cwd), { hello: 'world' });
    const progress = session.readProgress('repo-a', 'TASK-1', cwd);
    assert.equal(progress.length, 1);
    assert.equal(progress[0].note, 'first');
  });
});

test('appendProgress accumulates entries in order with timestamps', () => {
  withTmpDataRoot((cwd) => {
    session.openSession('repo-a', 'TASK-1', cwd);

    session.appendProgress('repo-a', 'TASK-1', { note: 'step one' }, cwd);
    session.appendProgress('repo-a', 'TASK-1', { note: 'step two' }, cwd);

    const progress = session.readProgress('repo-a', 'TASK-1', cwd);
    assert.equal(progress.length, 2);
    assert.equal(progress[0].note, 'step one');
    assert.equal(progress[1].note, 'step two');
    assert.ok(progress[0].at && progress[1].at, 'each entry should be stamped');
  });
});

test('scratch dirs are isolated per repo+task', () => {
  withTmpDataRoot((cwd) => {
    session.openSession('repo-a', 'TASK-1', cwd);
    session.openSession('repo-a', 'TASK-2', cwd);

    const fileOne = session.scratchPath('repo-a', 'TASK-1', 'draft.txt', cwd);
    fs.writeFileSync(fileOne, 'task one content', 'utf8');

    const scratchTwo = session.scratchDir('repo-a', 'TASK-2', cwd);
    assert.notEqual(scratchTwo, path.dirname(fileOne));
    assert.deepEqual(fs.readdirSync(scratchTwo), []);
    assert.equal(fs.readFileSync(fileOne, 'utf8'), 'task one content');
  });
});

test('reading a session that was never opened returns empty/null without throwing', () => {
  withTmpDataRoot((cwd) => {
    assert.equal(session.readPlan('repo-b', 'TASK-9', cwd), null);
    assert.deepEqual(session.readProgress('repo-b', 'TASK-9', cwd), []);
    assert.equal(session.activeSession(cwd), null);
  });
});

test('closeSession removes the sentinel; open then close leaves no sentinel behind', () => {
  withTmpDataRoot((cwd) => {
    session.openSession('repo-a', 'TASK-1', cwd);
    assert.ok(fs.existsSync(paths.sentinelPath(cwd)));

    session.closeSession(cwd);
    assert.equal(fs.existsSync(paths.sentinelPath(cwd)), false);
    assert.equal(session.activeSession(cwd), null);

    // Closing again (no sentinel present) must not throw.
    assert.doesNotThrow(() => session.closeSession(cwd));
  });
});
