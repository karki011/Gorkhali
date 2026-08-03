// Author: Subash Karki
// discipline-hooks.test.js - EXECUTED tests for the PreToolUse discipline hooks.
// Every case builds a real fixture on disk and runs the hook as a child process,
// asserting on the permission decision it writes to stdout. These hooks had no
// coverage at all, which is how routing-gate shipped reading only the legacy
// global session marker: armed, it denied edits inside the very session its own
// message told the user to start.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { detectRepo } = require('../scripts/lib/phantom-paths');

/**
 * The workspace lives OUTSIDE the data root on purpose: Phantom's own data tree is
 * never gated, so a workspace nested inside it makes every case allow and the
 * fixture proves nothing.
 */
function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-discipline-'));
  const data = path.join(base, 'data');
  const workspace = path.join(base, 'ws');
  fs.mkdirSync(path.join(data, 'state', 'current-session'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'feat/discipline', '.'], { cwd: workspace });
  // The known-repo test keys on the basename of the directory holding .git.
  fs.mkdirSync(path.join(data, 'repos', path.basename(workspace)), { recursive: true });
  return { base, data, workspace, repo: detectRepo(workspace) };
}

function runHook(hook, payload, { data, env = {} }) {
  const isShell = hook.endsWith('.sh');
  const result = spawnSync(
    isShell ? 'bash' : process.execPath,
    [path.join(ROOT, 'hooks', hook)],
    {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, PHANTOM_DATA: data, ...env },
    },
  );
  let decision = 'allow';
  try {
    decision = JSON.parse(result.stdout).hookSpecificOutput.permissionDecision;
  } catch (_) { /* no JSON on stdout means the hook allowed by staying silent */ }
  return { decision, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const writeEvent = (workspace) => ({
  tool_name: 'Write',
  tool_input: { file_path: path.join(workspace, 'app.js') },
  cwd: workspace,
  session_id: 'sess-discipline',
});

const stale = (file) => {
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  fs.utimesSync(file, old, old);
};

test('routing-gate reads the per-repo session pointer, not only the legacy marker', () => {
  const fx = makeFixture();
  try {
    const event = writeEvent(fx.workspace);
    const pointer = path.join(fx.data, 'state', 'current-session', `${fx.repo}.json`);

    assert.equal(
      runHook('routing-gate.js', event, fx).decision,
      'deny',
      'a tracked repo with no session must be gated',
    );

    // THE REGRESSION: a real session writes this pointer and nothing writes the
    // legacy global marker, so reading only the marker denied inside a live session.
    fs.writeFileSync(pointer, JSON.stringify({ task_id: 'T-1' }));
    assert.equal(
      runHook('routing-gate.js', event, fx).decision,
      'allow',
      'a live session for this repo must satisfy the gate',
    );

    stale(pointer);
    assert.equal(
      runHook('routing-gate.js', event, fx).decision,
      'deny',
      'a pointer older than the marker window is treated as absent',
    );

    // A session already in flight across an upgrade keeps its allowance.
    fs.rmSync(pointer);
    fs.writeFileSync(path.join(fx.data, '.apex-active'), '');
    assert.equal(
      runHook('routing-gate.js', event, fx).decision,
      'allow',
      'the legacy global marker stays honored for compatibility',
    );
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test('routing-gate is always armed and leaves a logged escape hatch', () => {
  const fx = makeFixture();
  try {
    const event = writeEvent(fx.workspace);

    // No enable flag: the gate used to require PHANTOM_ROUTING_ENFORCE=1, so it
    // enforced nothing unless someone exported a variable no document mentioned.
    assert.equal(runHook('routing-gate.js', event, fx).decision, 'deny');

    const adhoc = runHook('routing-gate.js', event, { ...fx, env: { PHANTOM_ADHOC: '1' } });
    assert.equal(adhoc.decision, 'allow', 'deliberate ad-hoc work stays possible');
    const log = path.join(fx.data, 'state', 'routing-bypass.jsonl');
    assert.ok(fs.existsSync(log), 'a bypass must be recorded, never invisible');
    assert.match(fs.readFileSync(log, 'utf8'), /app\.js/);

    // A repository Phantom does not track is not its business.
    const untracked = path.join(fx.base, 'elsewhere');
    fs.mkdirSync(untracked, { recursive: true });
    execFileSync('git', ['init', '-q', '.'], { cwd: untracked });
    assert.equal(
      runHook('routing-gate.js', writeEvent(untracked), fx).decision,
      'allow',
      'an untracked repository must not be gated',
    );
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test('the apex law keeps implementation in subagents and survives parallel Blades', () => {
  const fx = makeFixture();
  try {
    const event = writeEvent(fx.workspace);
    const pointer = path.join(fx.data, 'state', 'current-session', `${fx.repo}.json`);
    const markers = path.join(fx.data, '.blade-editing.d', fx.repo);
    const law = 'apex-subagent-driven-law.sh';
    const env = { PHANTOM_REPO: fx.repo };

    assert.equal(
      runHook(law, event, { ...fx, env }).status,
      0,
      'with no session the law must be inert',
    );

    fs.writeFileSync(pointer, JSON.stringify({ task_id: 'T-1' }));
    assert.equal(
      runHook(law, event, { ...fx, env }).status,
      2,
      'inside a session Apex must not edit directly',
    );

    // Per-Blade markers, not a shared flag: a shared flag is cleared by whichever
    // subagent stops first, reopening the gate while its siblings still hold edits.
    fs.mkdirSync(markers, { recursive: true });
    fs.writeFileSync(path.join(markers, 'toolu_A'), '');
    fs.writeFileSync(path.join(markers, 'toolu_B'), '');
    assert.equal(runHook(law, event, { ...fx, env }).status, 0, 'a live Blade may edit');

    fs.rmSync(path.join(markers, 'toolu_A'));
    assert.equal(
      runHook(law, event, { ...fx, env }).status,
      0,
      'one Blade stopping must not revoke a sibling that is still editing',
    );

    fs.rmSync(path.join(markers, 'toolu_B'));
    assert.equal(runHook(law, event, { ...fx, env }).status, 2, 'the last Blade stopping re-arms the law');

    // Orchestration artifacts stay writable by Apex.
    assert.equal(
      runHook(law, {
        ...event,
        tool_input: { file_path: path.join(fx.workspace, 'sessions', 'plan.json') },
      }, { ...fx, env }).status,
      0,
      'Apex must still write its own orchestration artifacts',
    );

    stale(pointer);
    assert.equal(
      runHook(law, event, { ...fx, env }).status,
      0,
      'a crashed session must not block writes forever',
    );
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

// Completing a session rewrites its pointer with status "completed" AND a fresh
// updated_at. An age-only liveness check therefore reported finished work as live
// and kept gating for a further 24h after the session ended.
test('a completed session pointer is not a live session', () => {
  const fx = makeFixture();
  try {
    const event = writeEvent(fx.workspace);
    const pointer = path.join(fx.data, 'state', 'current-session', `${fx.repo}.json`);
    const env = { PHANTOM_REPO: fx.repo };

    fs.writeFileSync(pointer, JSON.stringify({ task_id: 'T-1', status: 'completed' }));
    assert.equal(
      runHook('apex-subagent-driven-law.sh', event, { ...fx, env }).status,
      0,
      'a completed session must not keep blocking Apex writes',
    );
    assert.equal(
      runHook('routing-gate.js', event, fx).decision,
      'deny',
      'a completed session must not keep satisfying the routing requirement',
    );

    fs.writeFileSync(pointer, JSON.stringify({ task_id: 'T-1' }));
    assert.equal(
      runHook('apex-subagent-driven-law.sh', event, { ...fx, env }).status,
      2,
      'an active session still gates',
    );
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

// The sentinel was scoped per repository but the Blade marker directory was not, so
// a Blade running for repository A reported "a Blade is editing" for repository B
// and let Apex edit B directly.
test('Blade markers do not leak across repositories', () => {
  const a = makeFixture();
  const b = makeFixture();
  try {
    // One shared data root so a leak would be observable at all.
    const data = a.data;
    for (const fx of [a, b]) {
      fs.mkdirSync(path.join(data, 'repos', path.basename(fx.workspace)), { recursive: true });
      fs.writeFileSync(
        path.join(data, 'state', 'current-session', `${fx.repo}.json`),
        JSON.stringify({ task_id: 'T-1' }),
      );
    }

    spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'timing-capture.js'), 'spawn'], {
      input: JSON.stringify({
        tool_name: 'Agent',
        tool_use_id: 'toolu_A',
        tool_input: { subagent_type: 'blade' },
      }),
      encoding: 'utf8',
      env: { ...process.env, PHANTOM_DATA: data, PHANTOM_REPO: a.repo },
    });

    assert.equal(
      runHook('apex-subagent-driven-law.sh', writeEvent(a.workspace), {
        data, env: { PHANTOM_REPO: a.repo },
      }).status,
      0,
      'the repository whose Blade is live may be edited',
    );
    assert.equal(
      runHook('apex-subagent-driven-law.sh', writeEvent(b.workspace), {
        data, env: { PHANTOM_REPO: b.repo },
      }).status,
      2,
      'a Blade in another repository must not unlock this one',
    );
  } finally {
    fs.rmSync(a.base, { recursive: true, force: true });
    fs.rmSync(b.base, { recursive: true, force: true });
  }
});

// The behavioural tests above only exercise whichever `stat` this platform ships, so
// they cannot see a helper that works on one and silently fails on the other. The
// original chained `stat -f %m || stat -c %Y`, and on GNU `-f` is --file-system: it
// exits 0 while printing a non-timestamp, so the fallback never ran, every freshness
// check failed, and the law was inert on Linux. macOS could not reveal it because the
// BSD form ran first. This asserts the structure instead of the platform.
test('the timestamp helper validates its output rather than trusting exit status', () => {
  const source = fs.readFileSync(path.join(ROOT, 'hooks', 'apex-subagent-driven-law.sh'), 'utf8');
  assert.doesNotMatch(
    source,
    /stat -f %m [^\n]*\|\|[^\n]*stat -c %Y/,
    'chaining the two stat dialects on exit status is not portable',
  );
  assert.match(
    source,
    /case "\$value" in ''\|\*\[!0-9\]\*\)/,
    'the helper must reject a non-numeric result before using it',
  );
});

// The marker is written for every spawn ATTEMPT, before this gate can reject one.
// A denied spawn produces no subagent, so no SubagentStop ever arrives to clear its
// marker: the gate's own denial would leave Apex free to write with no Blade running,
// handing back the exact permission the gate exists to withhold.
test('a denied spawn leaves no write-unlocking Blade marker', () => {
  const fx = makeFixture();
  try {
    const pointer = path.join(fx.data, 'state', 'current-session', `${fx.repo}.json`);
    fs.writeFileSync(pointer, JSON.stringify({ task_id: 'T-1' }));
    const spawn = {
      tool_name: 'Agent',
      tool_use_id: 'toolu_X',
      cwd: fx.workspace,
      tool_input: { subagent_type: 'blade', prompt: 'x' }, // no model -> denied
    };
    const markers = path.join(fx.data, '.blade-editing.d', fx.repo);

    spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'timing-capture.js'), 'spawn'], {
      input: JSON.stringify(spawn),
      encoding: 'utf8',
      env: { ...process.env, PHANTOM_DATA: fx.data, PHANTOM_REPO: fx.repo },
    });
    assert.equal(fs.readdirSync(markers).length, 1, 'the attempt records a marker');

    assert.equal(runHook('blade-model-gate.js', spawn, fx).decision, 'deny');
    assert.equal(
      fs.existsSync(markers) ? fs.readdirSync(markers).length : 0,
      0,
      'the denied spawn must not leave its marker behind',
    );
    assert.equal(
      runHook('apex-subagent-driven-law.sh', writeEvent(fx.workspace), {
        ...fx, env: { PHANTOM_REPO: fx.repo },
      }).status,
      2,
      'Apex must still be blocked after a spawn was denied',
    );
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test('blade-model-gate refuses a spawn that inherits its model silently', () => {
  const fx = makeFixture();
  try {
    const denied = runHook('blade-model-gate.js', {
      tool_name: 'Agent',
      tool_input: { subagent_type: 'blade', prompt: 'do the thing' },
      cwd: fx.workspace,
    }, fx);
    assert.equal(denied.decision, 'deny', 'an omitted model must not inherit the orchestrator tier');
    assert.match(denied.stdout, /model-policy\.json|resolve-profile/, 'the denial must name where a model comes from');

    assert.equal(
      runHook('blade-model-gate.js', {
        tool_name: 'Write',
        tool_input: { file_path: path.join(fx.workspace, 'app.js') },
        cwd: fx.workspace,
      }, fx).decision,
      'allow',
      'the gate only governs subagent spawns',
    );
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});
