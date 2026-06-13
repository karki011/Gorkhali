// Author: Subash Karki
// phantom-loop.test.js — bin/phantom-loop launcher:
// source pins (exec lines, header distinction, uninstall scope, plist heredoc,
// shim resolver parity) and behavioral coverage (headless lock, stale pidfile
// recovery, install/uninstall-autolaunch, status, arg validation).
// Zero external deps: node:test + node:assert + child_process only.
// Every spawn isolates PHANTOM_DATA, PHANTOM_LEGACY_HOME, HOME, and PATH
// (stub `claude` + `caffeinate` in a tmpdir bin) from the real host.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'bin', 'phantom-loop');
const SRC = fs.readFileSync(SCRIPT, 'utf8');
const SRC_LINES = SRC.split('\n');
// No real `claude` on this PATH — install-autolaunch's claude check must rely
// solely on the stub bin.
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-loop-'));
}

function writeStub(dir, name, body) {
  fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
}

/**
 * Build an isolated fixture: tmp HOME / PHANTOM_DATA / PHANTOM_LEGACY_HOME,
 * plus a stub bin with `claude` (records args + env to CLAUDE_STUB_LOG;
 * optionally sleeps for lock tests) and `caffeinate` (drops flags, execs rest).
 */
function makeFixture({ claudeSleep = 0, withClaude = true } = {}) {
  const tmp = mkTmp();
  const bin = path.join(tmp, 'bin');
  const data = path.join(tmp, 'data');
  const legacy = path.join(tmp, 'legacy');
  const home = path.join(tmp, 'home');
  [bin, data, legacy, home].forEach(d => fs.mkdirSync(d, { recursive: true }));
  const stubLog = path.join(tmp, 'claude-stub.log');

  if (withClaude) {
    writeStub(bin, 'claude', [
      '#!/usr/bin/env bash',
      '{',
      '  echo "args: $*"',
      '  echo "PHANTOM_QUEUE_HEADLESS=${PHANTOM_QUEUE_HEADLESS:-}"',
      '} >> "${CLAUDE_STUB_LOG:-/dev/null}"',
      'echo "stub claude output"',
      claudeSleep > 0 ? `sleep ${claudeSleep}` : ':',
      '',
    ].join('\n'));
  }
  writeStub(bin, 'caffeinate', [
    '#!/usr/bin/env bash',
    'while [ $# -gt 0 ] && [ "${1#-}" != "$1" ]; do shift; done',
    'exec "$@"',
    '',
  ].join('\n'));

  const env = {
    ...process.env,
    HOME: home,
    PHANTOM_DATA: data,
    PHANTOM_LEGACY_HOME: legacy,
    PATH: `${bin}:${SYSTEM_PATH}`,
    CLAUDE_STUB_LOG: stubLog,
    PHANTOM_LOOP_SKIP_LAUNCHCTL: '1',
  };
  return { tmp, bin, data, home, env, stubLog };
}

function run(args, env) {
  return spawnSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8' });
}

function plistPathFor(fx) {
  return path.join(fx.home, 'Library', 'LaunchAgents', 'com.phantom.queue.plist');
}

function cleanup(fx) {
  fs.rmSync(fx.tmp, { recursive: true, force: true });
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 50));
  }
  return predicate();
}

// ── source pins ──────────────────────────────────────────────────────────────

test('source: all phantom:queue invocations carry bypassPermissions', () => {
  // Collect ALL lines that invoke claude with phantom:queue (regex: /claude.*phantom:queue/).
  // Filter out comments and shim/plist heredocs. Assert each carries bypassPermissions.
  const claudeQueueLines = SRC_LINES.filter(l => {
    const trimmed = l.trim();
    if (trimmed.startsWith('#') || trimmed === '') return false;
    // Match lines containing 'claude' and 'phantom:queue' (ignoring SHIM_EOF/PLIST_EOF markers).
    return /\bclaude\b/.test(l) && /phantom:queue/.test(l);
  });

  assert.ok(claudeQueueLines.length >= 3, `must have at least 3 claude phantom:queue invocations (default + once + headless); found ${claudeQueueLines.length}`);

  for (const line of claudeQueueLines) {
    assert.ok(
      line.includes('--permission-mode bypassPermissions'),
      `missing --permission-mode bypassPermissions: ${line}`
    );
  }
});

test('source: headless invocation has PHANTOM_QUEUE_HEADLESS=1, -p, bypassPermissions', () => {
  const headlessLines = SRC_LINES.filter(
    l => l.includes('PHANTOM_QUEUE_HEADLESS=1') && !l.trim().startsWith('#')
  );
  assert.equal(headlessLines.length, 1, 'exactly one headless claude invocation');
  const line = headlessLines[0];
  assert.ok(line.includes(' -p '), `missing -p: ${line}`);
  assert.ok(line.includes('--permission-mode bypassPermissions'), `missing bypassPermissions: ${line}`);
});

test('source: header documents the workflow-no-autolaunch distinction', () => {
  assert.ok(SRC.includes('workflow-no-autolaunch'), 'header must carry the no-autolaunch distinction');
});

test('source: uninstall-autolaunch rm targets only its own plist', () => {
  const m = SRC.match(/cmd_uninstall_autolaunch\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'cmd_uninstall_autolaunch function must exist');
  const rmLines = m[1].split('\n').filter(l => /(^|[;\s])rm\s/.test(l));
  assert.equal(rmLines.length, 1, 'exactly one rm in uninstall');
  assert.match(rmLines[0].trim(), /^rm -f "\$PLIST_PATH"$/);
});

test('source: plist heredoc sets RunAtLoad false', () => {
  assert.match(SRC, /<key>RunAtLoad<\/key>\s*\n\s*<false\/>/);
});

test('source: shim heredoc resolver text matches the pre-echo resolver text', () => {
  const resolverLines = SRC_LINES
    .map(l => l.trim())
    .filter(l => l.startsWith('cache_dir="$(ls -dt'));
  assert.equal(resolverLines.length, 2, 'resolver must appear in pre-echo AND shim heredoc');
  assert.equal(resolverLines[0], resolverLines[1], 'resolver text must be identical');
});

// ── behavioral: --headless ──────────────────────────────────────────────────

test('--headless runs claude with headless env/args and writes a queue-pass log', () => {
  const fx = makeFixture();
  try {
    const r = run(['--headless'], fx.env);
    assert.equal(r.status, 0, r.stderr);

    const stub = fs.readFileSync(fx.stubLog, 'utf8');
    assert.match(stub, /args: -p \/phantom:queue --permission-mode bypassPermissions/);
    assert.match(stub, /PHANTOM_QUEUE_HEADLESS=1/);

    const logs = fs.readdirSync(path.join(fx.data, 'logs'))
      .filter(f => /^queue-pass-\d{8}-\d{6}\.log$/.test(f));
    assert.equal(logs.length, 1, 'one queue-pass log written');
    const logBody = fs.readFileSync(path.join(fx.data, 'logs', logs[0]), 'utf8');
    assert.match(logBody, /stub claude output/);
  } finally {
    cleanup(fx);
  }
});

test('second concurrent --headless skips while first holds the lock', async () => {
  const fx = makeFixture({ claudeSleep: 15 });
  let first;
  try {
    first = spawn('bash', [SCRIPT, '--headless'], { env: fx.env, stdio: 'ignore' });
    const pidfile = path.join(fx.data, 'state', 'phantom-loop.pid');
    const appeared = await waitFor(() => fs.existsSync(pidfile), 5000);
    assert.ok(appeared, 'first pass must write the pidfile');

    const r2 = run(['--headless'], fx.env);
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /pass skipped: prior pass \(pid \d+\) still running/);
  } finally {
    if (first) first.kill('SIGKILL');
    cleanup(fx);
  }
});

test('stale pidfile (dead pid) is recovered and the pass runs', () => {
  const fx = makeFixture();
  try {
    // Capture a pid that is guaranteed dead (the shell already exited).
    const deadPid = spawnSync('bash', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim();
    const stateDir = path.join(fx.data, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'phantom-loop.pid'), deadPid + '\n');

    const r = run(['--headless'], fx.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /stale pidfile/);
    const stub = fs.readFileSync(fx.stubLog, 'utf8');
    assert.match(stub, /PHANTOM_QUEUE_HEADLESS=1/);
  } finally {
    cleanup(fx);
  }
});

test('pidfile of a live NON-claude process is treated stale (ps command check)', async () => {
  const fx = makeFixture();
  let sleeper;
  try {
    sleeper = spawn('sleep', ['30'], { stdio: 'ignore' });
    const alive = await waitFor(() => {
      try { process.kill(sleeper.pid, 0); return true; } catch (_) { return false; }
    }, 2000);
    assert.ok(alive, 'sleeper must be running');

    const stateDir = path.join(fx.data, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'phantom-loop.pid'), String(sleeper.pid) + '\n');

    const r = run(['--headless'], fx.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /stale pidfile/);
    const stub = fs.readFileSync(fx.stubLog, 'utf8');
    assert.match(stub, /PHANTOM_QUEUE_HEADLESS=1/);
  } finally {
    if (sleeper) sleeper.kill('SIGKILL');
    cleanup(fx);
  }
});

// ── behavioral: install / uninstall / status ────────────────────────────────

test('install-autolaunch writes plist + executable resolver shim under PHANTOM_DATA', () => {
  const fx = makeFixture();
  try {
    const r = run(['install-autolaunch'], fx.env);
    assert.equal(r.status, 0, r.stderr);

    const plist = fs.readFileSync(plistPathFor(fx), 'utf8');
    assert.match(plist, /<string>com\.phantom\.queue<\/string>/);
    assert.match(plist, /<integer>1800<\/integer>/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<false\/>/);

    const shim = path.join(fx.data, 'bin', 'phantom-loop-shim');
    assert.ok(plist.includes(`<string>${shim}</string>`), 'plist must point at the PHANTOM_DATA shim');
    assert.ok(!plist.includes('plugins/cache'), 'plist must not bake a versioned plugins/cache path');

    fs.accessSync(shim, fs.constants.X_OK);
    const shimBody = fs.readFileSync(shim, 'utf8');
    const shimResolver = shimBody.split('\n').find(l => l.trim().startsWith('cache_dir="$(ls -dt'));
    assert.ok(shimResolver, 'shim must contain the cache resolver');
    const preEchoResolver = SRC_LINES.map(l => l.trim()).find(l => l.startsWith('cache_dir="$(ls -dt'));
    assert.equal(shimResolver.trim(), preEchoResolver, 'shim resolver must match pre-echo resolver');
  } finally {
    cleanup(fx);
  }
});

test('install-autolaunch --interval-minutes 7 writes StartInterval 420', () => {
  const fx = makeFixture();
  try {
    const r = run(['install-autolaunch', '--interval-minutes', '7'], fx.env);
    assert.equal(r.status, 0, r.stderr);
    const plist = fs.readFileSync(plistPathFor(fx), 'utf8');
    assert.match(plist, /<integer>420<\/integer>/);
  } finally {
    cleanup(fx);
  }
});

test('uninstall-autolaunch removes the plist', () => {
  const fx = makeFixture();
  try {
    assert.equal(run(['install-autolaunch'], fx.env).status, 0);
    assert.ok(fs.existsSync(plistPathFor(fx)));

    const r = run(['uninstall-autolaunch'], fx.env);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(plistPathFor(fx)), 'plist must be removed');
  } finally {
    cleanup(fx);
  }
});

test('status exits 0 with nothing installed', () => {
  const fx = makeFixture();
  try {
    const r = run(['status'], fx.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /autolaunch: not installed/);
    assert.match(r.stdout, /last pass: never recorded/);
  } finally {
    cleanup(fx);
  }
});

test('install-autolaunch exits 2 when claude is absent from PATH', () => {
  const fx = makeFixture({ withClaude: false });
  try {
    const r = run(['install-autolaunch'], fx.env);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /claude not found/);
  } finally {
    cleanup(fx);
  }
});

test('unknown argument exits 2 with usage', () => {
  const fx = makeFixture();
  try {
    const r = run(['--bogus'], fx.env);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage: phantom-loop/);
  } finally {
    cleanup(fx);
  }
});

// ── P1 blocker fixes: XML escape + launchctl failure detection ────────────────

test('install-autolaunch escapes hostile PATH chars in plist XML', () => {
  const fx = makeFixture();
  // Inject a PATH component whose name contains XML-hostile chars: & < >
  // Use a real tmpdir prefix so it physically exists (install only needs
  // the claude stub, not the actual hostile dir).
  const hostileDir = '/tmp/evil&<>dir';
  const env = {
    ...fx.env,
    PATH: `${path.join(fx.tmp, 'bin')}:${hostileDir}:${SYSTEM_PATH}`,
  };
  try {
    const r = run(['install-autolaunch'], env);
    assert.equal(r.status, 0, `install failed: ${r.stderr}`);

    const plist = fs.readFileSync(plistPathFor(fx), 'utf8');

    // Must contain escaped forms — never raw & < > inside EnvironmentVariables.
    assert.ok(plist.includes('&amp;'), 'plist must contain &amp; (escaped ampersand)');
    assert.ok(plist.includes('&lt;'), 'plist must contain &lt; (escaped <)');
    assert.ok(plist.includes('&gt;'), 'plist must contain &gt; (escaped >)');

    // Must NOT contain the raw hostile chars inside the PATH string value.
    // Locate the PATH <string>…</string> block and check it.
    const pathMatch = plist.match(/<key>PATH<\/key>\s*<string>([\s\S]*?)<\/string>/);
    assert.ok(pathMatch, 'plist must have a PATH EnvironmentVariables entry');
    const pathValue = pathMatch[1];
    assert.ok(!pathValue.includes('&<>'), 'raw & < > must not appear in PATH value');

    // If plutil is available on this machine, the generated plist must pass lint.
    const plutil = spawnSync('plutil', ['-lint', plistPathFor(fx)], { encoding: 'utf8' });
    if (plutil.status !== null) {
      // plutil was found — assert it passes
      assert.equal(plutil.status, 0, `plutil lint failed: ${plutil.stdout} ${plutil.stderr}`);
    }
    // else: plutil not present on this machine — skip the lint assertion
  } finally {
    cleanup(fx);
  }
});

test('install-autolaunch exits non-zero and prints NOT installed when launchctl load fails', () => {
  const fx = makeFixture();
  // Stub a launchctl that exits 1 (simulates load failure).
  writeStub(fx.bin, 'launchctl', [
    '#!/usr/bin/env bash',
    '# First call is `unload` (ignored); second call is `load` (fail it).',
    'if [ "${1:-}" = "load" ]; then',
    '  echo "launchctl: load failed (stub)" >&2',
    '  exit 1',
    'fi',
    'exit 0',
    '',
  ].join('\n'));

  // Do NOT set SKIP_LAUNCHCTL so the load path is exercised.
  const env = { ...fx.env };
  delete env.PHANTOM_LOOP_SKIP_LAUNCHCTL;

  try {
    const r = run(['install-autolaunch'], env);
    assert.notEqual(r.status, 0, 'install must exit non-zero when launchctl load fails');
    assert.match(r.stderr, /NOT installed/, 'stderr must mention NOT installed');
  } finally {
    cleanup(fx);
  }
});

test('existing install tests still pass: plist has StartInterval, RunAtLoad false, shim path', () => {
  // Regression guard: escaping must not break the core content assertions.
  const fx = makeFixture();
  try {
    const r = run(['install-autolaunch', '--interval-minutes', '7'], fx.env);
    assert.equal(r.status, 0, r.stderr);
    const plist = fs.readFileSync(plistPathFor(fx), 'utf8');

    assert.match(plist, /<integer>420<\/integer>/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<false\/>/);

    const shim = path.join(fx.data, 'bin', 'phantom-loop-shim');
    // SHIM_PATH has no XML-hostile chars in a normal tmpdir — escaped form
    // equals the original, so the plain string must still appear.
    assert.ok(plist.includes(`<string>${shim}</string>`), 'plist must point at shim');

    assert.match(r.stdout, /autolaunch installed/);
  } finally {
    cleanup(fx);
  }
});
