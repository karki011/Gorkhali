// Author: Subash Karki
// config-lite.test.js — zero-dep config flag reader (scripts/lib/config-lite.js):
// resolution order (PHANTOM_CONFIG > PHANTOM_DATA > legacy), section scoping,
// boolean parse, string parse, missing-file/garbage/non-boolean fallback, never-throws.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_LITE = path.join(__dirname, '..', 'scripts', 'lib', 'config-lite.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'config-lite-'));
}

/**
 * Purge the module cache and load config-lite with the given env overrides.
 * Caller is responsible for restoring env (via withEnv helper).
 */
function freshLoad() {
  // Purge all cached modules so phantom-paths.js and config-lite.js re-read process.env.
  Object.keys(require.cache).forEach(k => { delete require.cache[k]; });
  return require(CONFIG_LITE);
}

/**
 * Run fn with process.env temporarily patched by envPatch.
 * Removes keys whose value in the patch is undefined.
 * Always restores env and purges cache on exit.
 */
function withEnv(envPatch, fn) {
  const saved = {};
  const managed = Object.keys(envPatch);
  // Save current values (undefined = was absent)
  managed.forEach(k => { saved[k] = process.env[k]; });
  // Remove keys that should be absent, set ones that should be present
  managed.forEach(k => {
    if (envPatch[k] === undefined) delete process.env[k];
    else process.env[k] = envPatch[k];
  });
  try {
    return fn(freshLoad());
  } finally {
    // Restore
    managed.forEach(k => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
    // Purge so subsequent tests start clean
    Object.keys(require.cache).forEach(k => { delete require.cache[k]; });
  }
}

// ── resolution order ────────────────────────────────────────────────────────

test('PHANTOM_CONFIG beats PHANTOM_DATA config', () => {
  const tmpA = mkTmp(); // PHANTOM_CONFIG target dir
  const tmpB = mkTmp(); // fake PHANTOM_DATA dir
  try {
    const cfgA = path.join(tmpA, 'config.yaml');
    const cfgB = path.join(tmpB, 'config.yaml');
    fs.writeFileSync(cfgA, 'routing:\n  enforce: true\n');
    fs.writeFileSync(cfgB, 'routing:\n  enforce: false\n');

    withEnv({ PHANTOM_CONFIG: cfgA, PHANTOM_DATA: tmpB }, ({ resolveConfigPath, readFlag }) => {
      assert.equal(resolveConfigPath(), cfgA);
      assert.equal(readFlag('routing', 'enforce', false), true);
    });
  } finally {
    fs.rmSync(tmpA, { recursive: true, force: true });
    fs.rmSync(tmpB, { recursive: true, force: true });
  }
});

test('PHANTOM_DATA config used when PHANTOM_CONFIG absent', () => {
  const tmpB = mkTmp();
  try {
    const cfgB = path.join(tmpB, 'config.yaml');
    fs.writeFileSync(cfgB, 'routing:\n  enforce: true\n');
    withEnv({ PHANTOM_CONFIG: undefined, PHANTOM_DATA: tmpB }, ({ resolveConfigPath, readFlag }) => {
      assert.equal(resolveConfigPath(), cfgB);
      assert.equal(readFlag('routing', 'enforce', false), true);
    });
  } finally {
    fs.rmSync(tmpB, { recursive: true, force: true });
  }
});

test('resolveConfigPath returns null when no config exists anywhere', () => {
  const tmpB = mkTmp(); // empty — no config.yaml
  const missingCfg = path.join(tmpB, 'does-not-exist.yaml');
  try {
    withEnv({ PHANTOM_CONFIG: missingCfg, PHANTOM_DATA: tmpB, PHANTOM_LEGACY_HOME: tmpB }, ({ resolveConfigPath }) => {
      // PHANTOM_CONFIG points at a missing file (skipped).
      // PHANTOM_DATA dir has no config.yaml (skipped).
      // PHANTOM_LEGACY_HOME isolates from any real ~/.claude/phantom/config.yaml.
      assert.equal(resolveConfigPath(), null);
    });
  } finally {
    fs.rmSync(tmpB, { recursive: true, force: true });
  }
});

// ── section scoping ─────────────────────────────────────────────────────────

test('same key under different sections returns the right value', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(
      path.join(tmp, 'config.yaml'),
      'alpha:\n  enforce: true\n\nbeta:\n  enforce: false\n'
    );
    withEnv({ PHANTOM_CONFIG: path.join(tmp, 'config.yaml'), PHANTOM_DATA: tmp }, ({ readFlag }) => {
      assert.equal(readFlag('alpha', 'enforce', false), true);
      assert.equal(readFlag('beta',  'enforce', true),  false);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('key in section does not bleed into adjacent section', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(
      path.join(tmp, 'config.yaml'),
      'routing:\n  enforce: true\n\npreferences:\n  nudge: false\n'
    );
    withEnv({ PHANTOM_CONFIG: path.join(tmp, 'config.yaml'), PHANTOM_DATA: tmp }, ({ readFlag }) => {
      // routing.nudge absent → default
      assert.equal(readFlag('routing', 'nudge', true), true);
      // preferences.enforce absent → default
      assert.equal(readFlag('preferences', 'enforce', false), false);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── boolean parsing ─────────────────────────────────────────────────────────

test('parses true', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'routing:\n  enforce: true\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readFlag }) => {
      assert.equal(readFlag('routing', 'enforce', false), true);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('parses false', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'routing:\n  enforce: false\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readFlag }) => {
      assert.equal(readFlag('routing', 'enforce', true), false);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('parses true with trailing comment', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'routing:\n  enforce: true  # gate is on\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readFlag }) => {
      assert.equal(readFlag('routing', 'enforce', false), true);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('parses false with trailing comment', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'routing:\n  nudge: false               # one-shot reminder\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readFlag }) => {
      assert.equal(readFlag('routing', 'nudge', true), false);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── missing file / section / key → default ──────────────────────────────────

test('missing file returns default for readFlag', () => {
  const tmp = mkTmp(); // no config.yaml written
  const missing = path.join(tmp, 'no-such.yaml');
  try {
    withEnv({ PHANTOM_CONFIG: missing, PHANTOM_DATA: tmp, PHANTOM_LEGACY_HOME: tmp }, ({ readFlag }) => {
      assert.equal(readFlag('routing', 'enforce', true), true);
      assert.equal(readFlag('routing', 'enforce', false), false);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing section returns default', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'jira:\n  project: CP\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readFlag }) => {
      assert.equal(readFlag('routing', 'enforce', true), true);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing key within section returns default', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'routing:\n  nudge: true\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readFlag }) => {
      assert.equal(readFlag('routing', 'enforce', false), false);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── garbage / binary content → default ─────────────────────────────────────

test('garbage content returns default, does not throw', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x41, 0x42]));
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readFlag, readString }) => {
      assert.equal(readFlag('routing', 'enforce', true), true);
      assert.equal(readString('routing', 'enforce', 'sentinel'), 'sentinel');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── non-boolean value → default ─────────────────────────────────────────────

test('non-boolean value returns default for readFlag', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'routing:\n  enforce: maybe\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readFlag }) => {
      assert.equal(readFlag('routing', 'enforce', true), true);
      assert.equal(readFlag('routing', 'enforce', false), false);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('numeric string value returns default for readFlag', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'routing:\n  enforce: 1\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readFlag }) => {
      assert.equal(readFlag('routing', 'enforce', false), false);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── readString ───────────────────────────────────────────────────────────────

test('readString returns raw value', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'models:\n  sage: fable\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readString }) => {
      assert.equal(readString('models', 'sage', 'opus'), 'fable');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readString strips double quotes', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'models:\n  sage: "fable"\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readString }) => {
      assert.equal(readString('models', 'sage', 'opus'), 'fable');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readString strips single quotes', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, "models:\n  sage: 'fable'\n");
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readString }) => {
      assert.equal(readString('models', 'sage', 'opus'), 'fable');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readString strips trailing comment', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'models:\n  sage: fable  # Set to opus if you lack Fable 5 entitlement\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readString }) => {
      assert.equal(readString('models', 'sage', 'opus'), 'fable');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readString missing key returns default', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'models:\n  sage: fable\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readString }) => {
      assert.equal(readString('models', 'missing', 'default-val'), 'default-val');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readString missing file returns default', () => {
  const tmp = mkTmp();
  const missing = path.join(tmp, 'no-such.yaml');
  try {
    withEnv({ PHANTOM_CONFIG: missing, PHANTOM_DATA: tmp, PHANTOM_LEGACY_HOME: tmp }, ({ readString }) => {
      assert.equal(readString('models', 'sage', 'sentinel'), 'sentinel');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── never-throws ─────────────────────────────────────────────────────────────

test('PHANTOM_CONFIG pointing at a directory does not throw, returns default', () => {
  const tmp = mkTmp(); // a directory, not a file
  try {
    withEnv({ PHANTOM_CONFIG: tmp, PHANTOM_DATA: tmp, PHANTOM_LEGACY_HOME: tmp }, ({ resolveConfigPath, readFlag, readString }) => {
      let resolvedResult;
      assert.doesNotThrow(() => { resolvedResult = resolveConfigPath(); });
      // tmp is a directory → skipped. PHANTOM_DATA has no config.yaml → skipped.
      // PHANTOM_LEGACY_HOME isolates from the host legacy config → null.
      assert.equal(resolvedResult, null);
      assert.doesNotThrow(() => readFlag('routing', 'enforce', false));
      assert.doesNotThrow(() => readString('routing', 'enforce', 'default'));
      // Both must return their defaults (no valid config was readable)
      assert.equal(readFlag('routing', 'enforce', false), false);
      assert.equal(readString('routing', 'enforce', 'sentinel'), 'sentinel');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readFlag never throws on any input combination', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'routing:\n  enforce: true\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readFlag }) => {
      assert.doesNotThrow(() => readFlag('routing', 'enforce', false));
      assert.doesNotThrow(() => readFlag('', '', false));
      assert.doesNotThrow(() => readFlag('nonexistent', 'nonexistent', true));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── depth-scoping (P1 finding) ───────────────────────────────────────────────

test('deeply-nested key does NOT match top-level readFlag (P1 finding)', () => {
  // routing.enforce is set at depth 2 (advanced.enforce), not depth 1.
  // readFlag('routing','enforce',false) must return the default false.
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'routing:\n  advanced:\n    enforce: true\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readFlag }) => {
      assert.equal(readFlag('routing', 'enforce', false), false);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('first-level key after a nested block is read correctly', () => {
  // advanced.enforce: true is nested; the subsequent enforce: false is at depth 1.
  // readFlag must pick up the depth-1 value (false) and ignore the nested one.
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(
      cfg,
      'routing:\n  advanced:\n    enforce: true\n  enforce: false\n'
    );
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readFlag }) => {
      assert.equal(readFlag('routing', 'enforce', true), false);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readString depth rule: nested key not returned for first-level lookup', () => {
  const tmp = mkTmp();
  try {
    const cfg = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfg, 'models:\n  overrides:\n    sage: fable\n');
    withEnv({ PHANTOM_CONFIG: cfg, PHANTOM_DATA: tmp }, ({ readString }) => {
      // 'sage' exists only at depth 2 — must return the default
      assert.equal(readString('models', 'sage', 'default-model'), 'default-model');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
