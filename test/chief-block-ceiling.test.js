// Author: Subash Karki
// chief-block-ceiling.test.js — core behavior of the bounded escape hatch:
// recordAndCheck stays false below the ceiling, fires at the ceiling, resets
// after firing, and keeps independent counters per (session, file) key.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONSTANTS_PATH = require.resolve('../scripts/lib/constants');
const HOOK_PATH = require.resolve('../hooks/chief-block-ceiling');

function withCeiling(ceiling, fn) {
  const ENV_KEY = 'GORKHALI_CHIEF_BLOCK_CEILING';
  const saved = process.env[ENV_KEY];
  process.env[ENV_KEY] = String(ceiling);
  delete require.cache[CONSTANTS_PATH];
  delete require.cache[HOOK_PATH];
  try {
    return fn(require(HOOK_PATH));
  } finally {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
    delete require.cache[CONSTANTS_PATH];
    delete require.cache[HOOK_PATH];
  }
}

function sandbox() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'chief-block-ceiling-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chief-block-ceiling-repo-'));
  fs.mkdirSync(path.join(repo, '.git'));
  return {
    data,
    repo,
    cleanup: () => {
      fs.rmSync(data, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    },
  };
}

function payload(f, { sessionId = 's1', filePath } = {}) {
  return {
    session_id: sessionId,
    cwd: f.repo,
    tool_input: { file_path: filePath || path.join(f.repo, 'a.js') },
  };
}

test('fewer than ceiling attempts on the same (session, file) never fire, count increments', () => {
  const f = sandbox();
  process.env.GORKHALI_DATA = f.data;
  try {
    withCeiling(3, ({ recordAndCheck }) => {
      const r1 = recordAndCheck(payload(f));
      assert.equal(r1.escapeHatch, false);
      assert.equal(r1.count, 1);
      const r2 = recordAndCheck(payload(f));
      assert.equal(r2.escapeHatch, false);
      assert.equal(r2.count, 2);
    });
  } finally {
    delete process.env.GORKHALI_DATA;
    f.cleanup();
  }
});

test('the Nth attempt reaching the ceiling fires the escape hatch', () => {
  const f = sandbox();
  process.env.GORKHALI_DATA = f.data;
  try {
    withCeiling(3, ({ recordAndCheck }) => {
      recordAndCheck(payload(f));
      recordAndCheck(payload(f));
      const r3 = recordAndCheck(payload(f));
      assert.equal(r3.escapeHatch, true);
      assert.equal(r3.count, 3);
      assert.equal(r3.threshold, 3);
    });
  } finally {
    delete process.env.GORKHALI_DATA;
    f.cleanup();
  }
});

test('after the escape hatch fires, the counter resets and needs the full ceiling again', () => {
  const f = sandbox();
  process.env.GORKHALI_DATA = f.data;
  try {
    withCeiling(2, ({ recordAndCheck }) => {
      assert.equal(recordAndCheck(payload(f)).escapeHatch, false);
      assert.equal(recordAndCheck(payload(f)).escapeHatch, true);

      // Fresh sequence: must not fire on the very next attempt.
      const r1 = recordAndCheck(payload(f));
      assert.equal(r1.escapeHatch, false);
      assert.equal(r1.count, 1);
      const r2 = recordAndCheck(payload(f));
      assert.equal(r2.escapeHatch, true);
      assert.equal(r2.count, 2);
    });
  } finally {
    delete process.env.GORKHALI_DATA;
    f.cleanup();
  }
});

test('a different file (same session) has an independent counter', () => {
  const f = sandbox();
  process.env.GORKHALI_DATA = f.data;
  try {
    withCeiling(2, ({ recordAndCheck }) => {
      recordAndCheck(payload(f, { filePath: path.join(f.repo, 'a.js') }));
      recordAndCheck(payload(f, { filePath: path.join(f.repo, 'a.js') }));
      const other = recordAndCheck(payload(f, { filePath: path.join(f.repo, 'b.js') }));
      assert.equal(other.escapeHatch, false);
      assert.equal(other.count, 1);
    });
  } finally {
    delete process.env.GORKHALI_DATA;
    f.cleanup();
  }
});

test('a different session (same file) has an independent counter', () => {
  const f = sandbox();
  process.env.GORKHALI_DATA = f.data;
  try {
    withCeiling(2, ({ recordAndCheck }) => {
      recordAndCheck(payload(f, { sessionId: 's1' }));
      recordAndCheck(payload(f, { sessionId: 's1' }));
      const other = recordAndCheck(payload(f, { sessionId: 's2' }));
      assert.equal(other.escapeHatch, false);
      assert.equal(other.count, 1);
    });
  } finally {
    delete process.env.GORKHALI_DATA;
    f.cleanup();
  }
});
