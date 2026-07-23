// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SCRIPT = require.resolve('../scripts/migrate-data.js');
const SESSION_MARKER = require.resolve('../hooks/session-marker.js');
const PORTABLE_STATE = path.resolve(
  __dirname,
  '..',
  'skills',
  'phantom',
  'scripts',
  'phantom-state.mjs',
);
const VERSION_MARKER = '.data-root-migrated-v2';
const VERSION_LOCK = '.data-root-migrating-v2.lock';
const REPORT = '.data-root-migration-v2-report.json';

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(file, content) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, content);
}

function writeJson(file, value) {
  write(file, JSON.stringify(value, null, 2));
}

function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-data-v2-'));
  const dest = path.join(root, 'dest');
  const team = path.join(root, 'team');
  const phantom = path.join(root, 'phantom');
  const phantomData = path.join(root, 'legacy-phantom-data');
  const candidates = path.join(root, 'candidates');
  const projects = path.join(root, 'projects');
  const repoLegacy = path.join(root, 'repo-legacy-absent');
  mkdirp(candidates);
  mkdirp(projects);
  return {
    root,
    dest,
    team,
    phantom,
    phantomData,
    env: {
      ...process.env,
      PHANTOM_DATA: dest,
      PHANTOM_MIGRATE_SRC_TEAM: team,
      PHANTOM_MIGRATE_SRC_PHANTOM: phantom,
      PHANTOM_MIGRATE_SRC_PHANTOM_DATA: phantomData,
      PHANTOM_MIGRATE_CANDIDATE_DIRS: candidates,
      PHANTOM_PROJECTS_DIR: projects,
      PHANTOM_MIGRATE_LEGACY_ROOT: repoLegacy,
    },
  };
}

function runMigration(env, args = []) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function runPortable(env, args) {
  const result = spawnSync(process.execPath, [PORTABLE_STATE, ...args], {
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runMigrationAsync(env, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('copies every legacy source and mutable timing/events while preserving sources', () => {
  const w = world();
  try {
    write(path.join(w.dest, '.migrated'), 'legacy marker must not gate v2');
    write(path.join(w.team, 'sessions', 'team.json'), 'team');
    write(path.join(w.phantom, 'timing', 'repo.jsonl'), 'timing');
    write(path.join(w.phantomData, 'events', 'repo', 'events.jsonl'), 'events');
    write(path.join(w.phantomData, 'state', 'durable.json'), 'durable');

    write(path.join(w.phantomData, 'worktrees', 'repo', 'ticket', 'code.js'), 'managed');
    write(path.join(w.phantomData, '.apex-active'), 'stale');
    write(path.join(w.phantomData, '.blade-editing'), 'stale');
    write(path.join(w.phantomData, 'state', '.active-wake-session.repo'), '/old/session');
    write(path.join(w.phantomData, 'state', 'current-session', 'repo.json'), 'stale');

    runMigration(w.env);

    assert.equal(fs.readFileSync(path.join(w.dest, 'sessions', 'team.json'), 'utf8'), 'team');
    assert.equal(fs.readFileSync(path.join(w.dest, 'timing', 'repo.jsonl'), 'utf8'), 'timing');
    assert.equal(fs.readFileSync(path.join(w.dest, 'events', 'repo', 'events.jsonl'), 'utf8'), 'events');
    assert.equal(fs.readFileSync(path.join(w.dest, 'state', 'durable.json'), 'utf8'), 'durable');

    assert.ok(!fs.existsSync(path.join(w.dest, 'worktrees')));
    assert.ok(!fs.existsSync(path.join(w.dest, '.apex-active')));
    assert.ok(!fs.existsSync(path.join(w.dest, '.blade-editing')));
    assert.ok(!fs.existsSync(path.join(w.dest, 'state', '.active-wake-session.repo')));
    assert.ok(!fs.existsSync(path.join(w.dest, 'state', 'current-session')));

    assert.equal(fs.readFileSync(path.join(w.team, 'sessions', 'team.json'), 'utf8'), 'team');
    assert.equal(fs.readFileSync(path.join(w.phantom, 'timing', 'repo.jsonl'), 'utf8'), 'timing');
    assert.equal(
      fs.readFileSync(path.join(w.phantomData, 'events', 'repo', 'events.jsonl'), 'utf8'),
      'events',
    );

    const report = JSON.parse(fs.readFileSync(path.join(w.dest, REPORT), 'utf8'));
    assert.equal(report.migrationVersion, 2);
    assert.deepEqual(Object.keys(report.sources), ['phantom-data', 'phantom', 'team']);
    assert.deepEqual(report.sourcePriority, ['phantom-data', 'phantom', 'team']);
    assert.ok(report.whitelist.dirs.includes('timing'));
    assert.ok(report.whitelist.dirs.includes('events'));
    assert.ok(report.excluded.some(entry => entry.reason === 'stale-active-marker'));
    assert.ok(fs.existsSync(path.join(w.dest, VERSION_MARKER)));
  } finally {
    cleanup(w.root);
  }
});

test('canonical destination wins every collision even when the source is newer', () => {
  const w = world();
  const relative = path.join('repos', 'repo', 'learnings', 'data.md');
  try {
    write(path.join(w.dest, relative), 'canonical');
    write(path.join(w.team, relative), 'legacy-newer');
    write(path.join(w.phantom, relative), 'legacy-phantom');
    write(path.join(w.phantomData, relative), 'legacy-phantom-data');
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(w.team, relative), future, future);

    runMigration(w.env);

    assert.equal(fs.readFileSync(path.join(w.dest, relative), 'utf8'), 'canonical');
    assert.equal(fs.readFileSync(path.join(w.team, relative), 'utf8'), 'legacy-newer');
    const report = JSON.parse(fs.readFileSync(path.join(w.dest, REPORT), 'utf8'));
    assert.equal(report.conflicts.length, 3);
    assert.deepEqual(
      report.conflicts.map(entry => [entry.source, entry.won, entry.winnerOrigin]),
      [
        ['phantom-data', 'destination', 'canonical-destination'],
        ['phantom', 'destination', 'canonical-destination'],
        ['team', 'destination', 'canonical-destination'],
      ],
    );
  } finally {
    cleanup(w.root);
  }
});

test('legacy source collisions use deterministic active-root priority and report every loser', () => {
  const w = world();
  const relative = path.join('repos', 'repo', 'learnings', 'shared.md');
  try {
    write(path.join(w.team, relative), 'team');
    write(path.join(w.phantom, relative), 'phantom');
    write(path.join(w.phantomData, relative), 'phantom-data');

    runMigration(w.env);

    assert.equal(fs.readFileSync(path.join(w.dest, relative), 'utf8'), 'phantom-data');
    const report = JSON.parse(fs.readFileSync(path.join(w.dest, REPORT), 'utf8'));
    const collisions = report.conflicts.filter(entry => entry.dest === path.join(w.dest, relative));
    assert.deepEqual(
      collisions.map(entry => ({
        source: entry.source,
        won: entry.won,
        winnerOrigin: entry.winnerOrigin,
      })),
      [
        { source: 'phantom', won: 'phantom-data', winnerOrigin: 'legacy-source' },
        { source: 'team', won: 'phantom-data', winnerOrigin: 'legacy-source' },
      ],
    );
    assert.equal(report.collisionPolicy, 'canonical-destination-then-source-priority');
  } finally {
    cleanup(w.root);
  }
});

test('versioned marker makes repeated invocations idempotent', () => {
  const w = world();
  try {
    write(path.join(w.team, 'audit', 'first.jsonl'), 'first');
    runMigration(w.env);
    write(path.join(w.team, 'audit', 'late.jsonl'), 'late');

    const second = runMigration(w.env);
    assert.match(second.stdout, /already migrated/);
    assert.ok(!fs.existsSync(path.join(w.dest, 'audit', 'late.jsonl')));
    assert.ok(fs.existsSync(path.join(w.dest, VERSION_MARKER)));
    assert.ok(!fs.existsSync(path.join(w.dest, VERSION_LOCK)));
  } finally {
    cleanup(w.root);
  }
});

test('concurrent invocations serialize safely and leave one complete result', async () => {
  const w = world();
  try {
    for (let index = 0; index < 500; index++) {
      write(path.join(w.team, 'events', 'repo', `${index}.json`), String(index));
    }

    const [first, second] = await Promise.all([
      runMigrationAsync(w.env),
      runMigrationAsync(w.env),
    ]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(path.join(w.dest, 'events', 'repo', '499.json'), 'utf8'), '499');
    assert.ok(fs.existsSync(path.join(w.dest, VERSION_MARKER)));
    assert.ok(fs.existsSync(path.join(w.dest, REPORT)));
    assert.ok(!fs.existsSync(path.join(w.dest, VERSION_LOCK)));
  } finally {
    cleanup(w.root);
  }
});

test('stale lock is reclaimed when its live PID has a different owner identity', () => {
  const w = world();
  try {
    mkdirp(w.dest);
    writeJson(path.join(w.dest, VERSION_LOCK), {
      pid: process.pid,
      token: 'stale',
      ownerIdentity: 'not-the-current-process',
    });
    const old = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(path.join(w.dest, VERSION_LOCK), old, old);
    write(path.join(w.team, 'observations', 'one.json'), 'one');

    runMigration(w.env);

    assert.equal(fs.readFileSync(path.join(w.dest, 'observations', 'one.json'), 'utf8'), 'one');
    assert.ok(!fs.existsSync(path.join(w.dest, VERSION_LOCK)));
    assert.ok(fs.existsSync(path.join(w.dest, VERSION_MARKER)));
  } finally {
    cleanup(w.root);
  }
});

test('a genuinely live migration owner is not reclaimed only because its lock is old', () => {
  const w = world();
  try {
    mkdirp(w.dest);
    writeJson(path.join(w.dest, VERSION_LOCK), { pid: process.pid, token: 'still-live' });
    const old = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(path.join(w.dest, VERSION_LOCK), old, old);
    write(path.join(w.team, 'observations', 'one.json'), 'one');

    const result = runMigration({ ...w.env, PHANTOM_MIGRATE_LOCK_STALE_MS: '1' });

    assert.match(result.stdout, /migration in progress/);
    assert.ok(fs.existsSync(path.join(w.dest, VERSION_LOCK)));
    assert.ok(!fs.existsSync(path.join(w.dest, VERSION_MARKER)));
    assert.ok(!fs.existsSync(path.join(w.dest, 'observations', 'one.json')));
  } finally {
    cleanup(w.root);
  }
});

test('stale takeover repairs a fresh replacement installed after the judged snapshot', () => {
  const w = world();
  try {
    const worker = path.join(w.root, 'lock-generation-race.js');
    write(
      worker,
      `
'use strict';
const fs = require('fs');
const { spawnSync } = require('child_process');
process.env.PHANTOM_DATA = ${JSON.stringify(w.dest)};
const { LOCK, lockSnapshot, reclaimStaleLock } =
  require(${JSON.stringify(SCRIPT)})._internals;
fs.mkdirSync(${JSON.stringify(w.dest)}, { recursive: true });
const deadPid = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
fs.writeFileSync(LOCK, JSON.stringify({ pid: deadPid, token: 'judged-stale' }));
const snapshot = lockSnapshot();
fs.unlinkSync(LOCK);
const fresh = JSON.stringify({ pid: process.pid, token: 'fresh-replacement' });
fs.writeFileSync(LOCK, fresh);
const reclaimed = reclaimStaleLock(snapshot);
process.stdout.write(JSON.stringify({
  reclaimed,
  current: fs.readFileSync(LOCK, 'utf8'),
  fresh,
  leftovers: fs.readdirSync(${JSON.stringify(w.dest)})
    .filter(name => name.includes('.lock.stale.')),
}));
`,
    );

    const result = spawnSync(process.execPath, [worker], {
      env: w.env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const outcome = JSON.parse(result.stdout);
    assert.equal(outcome.reclaimed, false, 'mismatched generation is not reclaimed');
    assert.equal(outcome.current, outcome.fresh, 'fresh replacement is restored byte-for-byte');
    assert.deepEqual(outcome.leftovers, [], 'successful repair leaves no takeover artifact');
  } finally {
    cleanup(w.root);
  }
});

test('valid portable current-session pointer is reconstructed and remains resumable', () => {
  const w = world();
  const workspace = path.join(w.root, 'workspace');
  try {
    mkdirp(workspace);
    const legacyEnv = { ...w.env, PHANTOM_DATA: w.phantomData };
    const started = runPortable(legacyEnv, [
      'start',
      '--workspace', workspace,
      '--task', 'MIGRATE-1',
      '--intent', 'Preserve active session discovery',
      '--route', 'direct',
    ]);
    const legacyPointer = path.join(
      w.phantomData,
      'state',
      'current-session',
      `${started.repo_id}.json`,
    );

    runMigration(w.env);

    const status = runPortable(
      { ...w.env, PHANTOM_DATA: w.dest },
      ['status', '--workspace', workspace],
    );
    assert.equal(status.task_id, 'MIGRATE-1');
    assert.equal(status.status, 'active');

    const resumed = runPortable(
      { ...w.env, PHANTOM_DATA: w.dest },
      ['resume', '--workspace', workspace],
    );
    assert.equal(resumed.task_id, 'MIGRATE-1');
    assert.equal(resumed.status, 'active');
    assert.ok(resumed.resumed_at);

    const destinationPointer = path.join(
      w.dest,
      'state',
      'current-session',
      `${started.repo_id}.json`,
    );
    const pointer = JSON.parse(fs.readFileSync(destinationPointer, 'utf8'));
    assert.equal(
      pointer.session_dir,
      path.join(w.dest, 'repos', started.repo_id, 'sessions', 'MIGRATE-1'),
    );
    assert.ok(fs.existsSync(legacyPointer), 'legacy current-session pointer remains source-preserved');
  } finally {
    cleanup(w.root);
  }
});

test('stale and unsupported current-session pointers are classified but not copied', () => {
  const w = world();
  try {
    writeJson(path.join(w.phantomData, 'state', 'current-session', 'legacy.json'), {
      session_id: 'old-session',
      cwd: w.root,
      ticket: 'OLD-1',
    });
    writeJson(path.join(w.phantom, 'state', 'current-session', 'unknown.json'), {
      arbitrary: 'marker',
    });
    writeJson(path.join(w.team, 'state', 'current-session', 'repo.json'), {
      schema_version: 1,
      repo_id: 'repo',
      task_id: '..',
    });

    runMigration(w.env);

    assert.ok(!fs.existsSync(path.join(w.dest, 'state', 'current-session', 'legacy.json')));
    assert.ok(!fs.existsSync(path.join(w.dest, 'state', 'current-session', 'unknown.json')));
    const report = JSON.parse(fs.readFileSync(path.join(w.dest, REPORT), 'utf8'));
    assert.deepEqual(
      report.sources['phantom-data'].pointers.map(pointer => [pointer.schema, pointer.status]),
      [['legacy-hook', 'rejected']],
    );
    assert.deepEqual(
      report.sources.phantom.pointers.map(pointer => [pointer.schema, pointer.status]),
      [['unknown', 'rejected']],
    );
    assert.deepEqual(
      report.sources.team.pointers.map(pointer => [pointer.schema, pointer.reason]),
      [['portable-v1', 'unsafe-pointer-segment']],
    );
  } finally {
    cleanup(w.root);
  }
});

test('session-marker migrates the data root before repo-dir consolidation', () => {
  const w = world();
  try {
    writeJson(
      path.join(w.phantomData, 'repos', 'legacy-branch', 'sessions', 'T1', 'wrap.json'),
      { pr: 'https://github.com/AcmeOrg/repo-alpha/pull/42' },
    );
    const payload = JSON.stringify({ session_id: 'session-1', cwd: w.root });
    const result = spawnSync(process.execPath, [SESSION_MARKER], {
      env: { ...w.env, PHANTOM_MIGRATE_SYNC: '1' },
      input: payload,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(w.dest, VERSION_MARKER)));
    assert.ok(fs.existsSync(path.join(w.dest, '.repo-dirs-migrated')));
    assert.ok(
      fs.existsSync(path.join(w.dest, 'repos', 'repo-alpha', 'sessions', 'T1', 'wrap.json')),
      'repo-dir sweep saw data copied from the legacy root',
    );
    assert.ok(
      fs.existsSync(path.join(w.dest, 'repos', 'legacy-branch.migrated-away')),
      'legacy repo dir was consolidated only after it reached the destination',
    );
  } finally {
    cleanup(w.root);
  }
});

test('session-marker remains fail-open when migration cannot initialize', () => {
  const w = world();
  try {
    write(w.dest, 'destination is a file');
    const result = spawnSync(process.execPath, [SESSION_MARKER], {
      env: { ...w.env, PHANTOM_MIGRATE_SYNC: '1' },
      input: JSON.stringify({ session_id: 'session-2', cwd: w.root }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    cleanup(w.root);
  }
});

test('session-marker attaches an asynchronous spawn error handler before detaching', () => {
  const source = fs.readFileSync(SESSION_MARKER, 'utf8');
  const spawnAt = source.indexOf('const child = spawn(');
  const errorHandlerAt = source.indexOf("child.on('error'", spawnAt);
  const unrefAt = source.indexOf('child.unref()', spawnAt);

  assert.ok(spawnAt >= 0, 'detached migration child is present');
  assert.ok(errorHandlerAt > spawnAt, 'child has an asynchronous error handler');
  assert.ok(unrefAt > errorHandlerAt, 'error handler is attached before unref');
});
