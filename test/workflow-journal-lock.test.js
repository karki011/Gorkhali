// Author: Subash Karki
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-journal-lock-'));

test('journal locks never age out a live owner and reclaim only provable stale generations', async () => {
  const { workflowJournalLockInternals } = await import(
    '../skills/phantom/scripts/lib/workflow-journal.mjs'
  );
  const directory = fixture();
  const lock = path.join(directory, '.journal.lock');
  const live = `${JSON.stringify({ pid: process.pid, token: 'live', created_at: new Date().toISOString() })}\n`;
  fs.writeFileSync(lock, live);
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lock, old, old);
  assert.equal(workflowJournalLockInternals.judgedStaleGeneration(lock), null);

  const dead = `${JSON.stringify({ pid: 2_000_000_000, token: 'dead', created_at: new Date().toISOString() })}\n`;
  fs.writeFileSync(lock, dead);
  assert.equal(workflowJournalLockInternals.judgedStaleGeneration(lock), dead);

  fs.writeFileSync(lock, '{"pid":');
  assert.equal(workflowJournalLockInternals.judgedStaleGeneration(lock), null);
  fs.utimesSync(lock, old, old);
  assert.equal(workflowJournalLockInternals.judgedStaleGeneration(lock), '{"pid":');
});

test('generation-checked relocation restores a replacement instead of unlinking it', async () => {
  const { workflowJournalLockInternals } = await import(
    '../skills/phantom/scripts/lib/workflow-journal.mjs'
  );
  const directory = fixture();
  const lock = path.join(directory, '.journal.lock');
  const judged = `${JSON.stringify({ pid: 999_999, token: 'stale' })}\n`;
  const replacement = `${JSON.stringify({ pid: process.pid, token: 'replacement' })}\n`;
  fs.writeFileSync(lock, replacement);
  assert.equal(
    workflowJournalLockInternals.relocateExactGeneration(lock, judged, 'test'),
    false,
  );
  assert.equal(fs.readFileSync(lock, 'utf8'), replacement);
  assert.deepEqual(fs.readdirSync(directory), ['.journal.lock']);

  assert.equal(
    workflowJournalLockInternals.relocateExactGeneration(lock, replacement, 'test'),
    true,
  );
  assert.equal(fs.existsSync(lock), false);
  assert.deepEqual(fs.readdirSync(directory), []);
});
