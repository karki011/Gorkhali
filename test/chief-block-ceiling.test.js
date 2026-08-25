// Author: Subash Karki
// chief-block-ceiling.test.js — core behavior of the bounded escape hatch:
// recordAndCheck stays false below the ceiling, fires at the ceiling, resets
// after firing, keeps independent counters per (session, file) key, clear()
// resolves a block streak so a successful delegated edit does not leave
// leftover count for a later, unrelated stall episode on the same key, and
// the opportunistic expired-counter sweep is throttled rather than running
// on every call.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONSTANTS_PATH = require.resolve('../scripts/lib/constants');
const HOOK_PATH = require.resolve('../hooks/chief-block-ceiling');

function withConstants(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    process.env[key] = String(overrides[key]);
  }
  delete require.cache[CONSTANTS_PATH];
  delete require.cache[HOOK_PATH];
  try {
    return fn(require(HOOK_PATH));
  } finally {
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    delete require.cache[CONSTANTS_PATH];
    delete require.cache[HOOK_PATH];
  }
}

function withCeiling(ceiling, fn) {
  return withConstants({ GORKHALI_CHIEF_BLOCK_CEILING: ceiling }, fn);
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

test('clear() after a resolved block streak makes the next attempt start fresh, not carry the old count', () => {
  const f = sandbox();
  process.env.GORKHALI_DATA = f.data;
  try {
    withCeiling(3, ({ recordAndCheck, clear }) => {
      // Two blocks (not yet at the ceiling of 3) — this episode gets resolved
      // by a successful delegated edit before it ever escalates.
      assert.equal(recordAndCheck(payload(f)).count, 1);
      assert.equal(recordAndCheck(payload(f)).count, 2);

      clear(payload(f));

      // A later, unrelated block on the SAME key must not inherit count=2.
      const r = recordAndCheck(payload(f));
      assert.equal(r.escapeHatch, false);
      assert.equal(r.count, 1, 'resolved episode must not leak count into a fresh one');
    });
  } finally {
    delete process.env.GORKHALI_DATA;
    f.cleanup();
  }
});

test('clear() on a key with no counter file is a no-op', () => {
  const f = sandbox();
  process.env.GORKHALI_DATA = f.data;
  try {
    withCeiling(3, ({ clear, recordAndCheck }) => {
      assert.doesNotThrow(() => clear(payload(f)));
      assert.equal(recordAndCheck(payload(f)).count, 1);
    });
  } finally {
    delete process.env.GORKHALI_DATA;
    f.cleanup();
  }
});

test('the expired-counter sweep is throttled — a stale sibling created right after the first sweep survives a second call within the throttle interval', () => {
  const f = sandbox();
  process.env.GORKHALI_DATA = f.data;
  try {
    withConstants({
      GORKHALI_CHIEF_BLOCK_CEILING: 5,
      GORKHALI_CHIEF_BLOCK_WINDOW_MS: 50,
      GORKHALI_CHIEF_BLOCK_SWEEP_INTERVAL_MS: 10 * 60 * 1000,
    }, ({ recordAndCheck, counterDir }) => {
      // First call: no marker yet, so this sweeps (finds nothing) and lays one down.
      recordAndCheck(payload(f, { filePath: path.join(f.repo, 'seed.js') }));

      const dir = counterDir(f.repo);
      // Drop a sibling counter file that is already past the (tiny) window —
      // a sweep right now would delete it.
      const staleFile = path.join(dir, 'stale-sibling');
      fs.writeFileSync(staleFile, JSON.stringify({ count: 1, lastBlockedAt: Date.now() - 1000 }));

      // Second call arrives well within the sweep throttle interval (10 min):
      // must skip sweeping, so the stale sibling is untouched.
      recordAndCheck(payload(f, { filePath: path.join(f.repo, 'other.js') }));

      assert.equal(fs.existsSync(staleFile), true, 'throttled sweep must not run again this soon');
    });
  } finally {
    delete process.env.GORKHALI_DATA;
    f.cleanup();
  }
});
