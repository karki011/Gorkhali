// Author: Subash Karki
// phantom-config.test.js - coverage for scripts/phantom-config.js, proven by
// spawning the REAL CLI against throwaway tmpdir git repos plus in-process library
// calls for the layers a CLI cannot express (explicit override, askPlan).
//
// Invariants pinned here:
//   - per-repo beats global beats detect; explicit beats all.
//   - an unset key reports unset with a reason and NEVER a fabricated default.
//   - closed schema: unknown key/section and off-enum values are rejected, and a
//     rejected set leaves the file untouched.
//   - the config layer never prompts; unattended + unset is INACTIVE, not an error.
//   - commands/close.md and commands/start.md name the real reader (no re-dangling).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'phantom-config.js');

// Throwaway git fixture. `remote` gives the detect layer something to see.
function mkRepo(remote) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'config-repo-')));
  execFileSync('git', ['init', '-q', '-b', 'feat/config-fixture'], { cwd: dir });
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  return dir;
}

function mkData() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'config-data-')));
}

// Spawn the real CLI with an isolated env: PHANTOM_DATA pinned to the fixture,
// ambient phantom overrides stripped so host state cannot leak in.
function cli(args, dataDir, extraEnv = {}) {
  const env = { ...process.env, PHANTOM_DATA: dataDir };
  delete env.PHANTOM_REPO;
  delete env.PHANTOM_UNATTENDED;
  for (const [k, v] of Object.entries(extraEnv)) env[k] = v; // applied last: survives the deletes
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', env });
}

// Fresh module instance with PHANTOM_DATA pinned - the layer memoizes per process.
function loadLib(dataDir) {
  const saved = process.env.PHANTOM_DATA;
  process.env.PHANTOM_DATA = dataDir;
  const id = require.resolve('../scripts/phantom-config');
  delete require.cache[id];
  const mod = require(id);
  mod.clearCache();
  return {
    mod,
    restore() {
      delete require.cache[id];
      if (saved === undefined) delete process.env.PHANTOM_DATA;
      else process.env.PHANTOM_DATA = saved;
    },
  };
}

function cleanup(...dirs) {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

function repoConfigFile(dataDir, repoDir) {
  const out = spawnSync(
    'node',
    ['-e', 'process.stdout.write(require(process.argv[1]).repoConfigPath(require(process.argv[2]).detectRepo(process.argv[3])))',
      SCRIPT, path.join(REPO_ROOT, 'scripts', 'lib', 'phantom-paths.js'), repoDir],
    { encoding: 'utf-8', env: { ...process.env, PHANTOM_DATA: dataDir, PHANTOM_REPO: '' } },
  );
  return out.stdout.trim();
}

test('set writes per-repo lazily and get resolves it with repo provenance', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    const written = cli(['set', 'tracker.provider', 'github', '--repo', repo], data);
    assert.equal(written.status, 0, 'set exits 0. stderr: ' + written.stderr);

    const got = cli(['get', 'tracker.provider', '--repo', repo], data);
    assert.equal(got.status, 0);
    assert.equal(got.stdout, 'github\n', 'human get prints the bare value');

    const json = JSON.parse(cli(['get', 'tracker.provider', '--repo', repo, '--json'], data).stdout);
    assert.equal(json.value, 'github');
    assert.equal(json.set, true);
    assert.equal(json.provenance, 'repo');

    const file = repoConfigFile(data, repo);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.equal(onDisk.schema_version, 1);
    assert.equal(onDisk.tracker.provider, 'github');
    // Setting the provider stamps the closed choice metadata, so `chosen` and
    // `chosen_at` always have a live writer rather than being schema decoration.
    assert.equal(onDisk.tracker.chosen, 'explicit');
    assert.ok(Number.isFinite(Date.parse(onDisk.tracker.chosen_at)));
  } finally {
    cleanup(repo, data);
  }
});

test('--chosen records how the value was chosen', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    assert.equal(cli(['set', 'tracker.provider', 'jira', '--chosen', 'asked', '--repo', repo], data).status, 0);
    assert.equal(cli(['get', 'tracker.chosen', '--repo', repo], data).stdout, 'asked\n');
    // --chosen is meaningless outside `set tracker.provider` and is rejected there.
    const bad = cli(['get', 'tracker.chosen', '--chosen', 'asked', '--repo', repo], data);
    assert.equal(bad.status, 2);
  } finally {
    cleanup(repo, data);
  }
});

test('per-repo wins over global, and global is used when per-repo is silent', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    cli(['set', 'review.external', 'none', '--global', '--repo', repo], data);
    cli(['set', 'spend.ceiling_usd', '12.5', '--global', '--repo', repo], data);
    assert.ok(fs.existsSync(path.join(data, 'config.json')), 'global file created lazily');

    let out = JSON.parse(cli(['get', 'review.external', '--repo', repo, '--json'], data).stdout);
    assert.equal(out.value, 'none');
    assert.equal(out.provenance, 'global');

    cli(['set', 'review.external', 'greptile', '--repo', repo], data);
    out = JSON.parse(cli(['get', 'review.external', '--repo', repo, '--json'], data).stdout);
    assert.equal(out.value, 'greptile');
    assert.equal(out.provenance, 'repo', 'per-repo wins');

    // The global-only key still resolves from the global layer, typed as a number.
    out = JSON.parse(cli(['get', 'spend.ceiling_usd', '--repo', repo, '--json'], data).stdout);
    assert.equal(out.value, 12.5);
    assert.equal(out.provenance, 'global');
  } finally {
    cleanup(repo, data);
  }
});

test('unset key reports unset with a reason, exit 1, and no value on stdout', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    const res = cli(['get', 'jira.auto_transition', '--repo', repo], data);
    assert.equal(res.status, 1, 'unset is a miss, not a success');
    assert.equal(res.stdout, '', 'empty stdout so a shell caller cannot read a reason as a value');
    assert.match(res.stderr, /jira\.auto_transition is unset/);
    assert.match(res.stderr, /nothing in per-repo config/);
    assert.match(res.stderr, /no detector/);

    const json = JSON.parse(cli(['get', 'jira.auto_transition', '--repo', repo, '--json'], data).stdout);
    assert.equal(json.set, false);
    assert.equal(json.provenance, 'unset');
    assert.equal('value' in json, false, 'no fabricated default in the JSON either');
  } finally {
    cleanup(repo, data);
  }
});

test('list reports provenance per key, including unset keys', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    cli(['set', 'jira.auto_transition', 'false', '--repo', repo], data);
    cli(['set', 'review.external', 'greptile', '--global', '--repo', repo], data);

    const human = cli(['list', '--repo', repo], data);
    assert.equal(human.status, 0);
    assert.match(human.stdout, /jira\.auto_transition\s+false\s+repo/);
    assert.match(human.stdout, /review\.external\s+greptile\s+global/);
    assert.match(human.stdout, /spend\.ceiling_usd\s+\(unset\)\s+unset/);

    const report = JSON.parse(cli(['list', '--repo', repo, '--json'], data).stdout);
    assert.deepEqual(Object.keys(report.keys).sort(), [
      'jira.auto_transition',
      'review.external',
      'spend.ceiling_usd',
      'tracker.chosen',
      'tracker.chosen_at',
      'tracker.provider',
      'tracker.ready_signal',
    ]);
    assert.equal(report.keys['jira.auto_transition'].provenance, 'repo');
    assert.equal(report.keys['review.external'].provenance, 'global');
    assert.equal(report.keys['spend.ceiling_usd'].provenance, 'unset');
    assert.equal(report.paths.global, path.join(data, 'config.json'));
  } finally {
    cleanup(repo, data);
  }
});

test('detect layer: a github origin supplies tracker.provider until a value is stored', () => {
  const repo = mkRepo('git@github.com:Cloudzero/fixture.git');
  const data = mkData();
  try {
    let out = JSON.parse(cli(['get', 'tracker.provider', '--repo', repo, '--json'], data).stdout);
    assert.equal(out.value, 'github');
    assert.equal(out.provenance, 'detect', 'detected, not stored - provenance says so');
    assert.match(out.source, /github\.com\/Cloudzero\/fixture/);

    // A stored value outranks detection.
    cli(['set', 'tracker.provider', 'jira', '--repo', repo], data);
    out = JSON.parse(cli(['get', 'tracker.provider', '--repo', repo, '--json'], data).stdout);
    assert.equal(out.value, 'jira');
    assert.equal(out.provenance, 'repo');
  } finally {
    cleanup(repo, data);
  }
});

test('detect stays silent for a non-github remote', () => {
  const repo = mkRepo('git@gitlab.example.com:team/fixture.git');
  const data = mkData();
  try {
    const res = cli(['get', 'tracker.provider', '--repo', repo], data);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /the repository detected no value/);
  } finally {
    cleanup(repo, data);
  }
});

test('closed enums and unknown keys are rejected, and a rejected set writes nothing', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    const badEnum = cli(['set', 'tracker.provider', 'bogus', '--repo', repo], data);
    assert.equal(badEnum.status, 2, 'validation error exits 2');
    assert.match(badEnum.stderr, /must be one of: jira, linear, github, file, none/);
    assert.equal(fs.existsSync(repoConfigFile(data, repo)), false, 'no file created by a rejected set');

    assert.equal(cli(['set', 'tracker.vendor', 'jira', '--repo', repo], data).status, 2);
    assert.match(cli(['get', 'nope.nope', '--repo', repo], data).stderr, /unknown key/);
    assert.equal(cli(['set', 'jira.auto_transition', 'yes', '--repo', repo], data).status, 2);
    assert.equal(cli(['set', 'spend.ceiling_usd', 'lots', '--repo', repo], data).status, 2);
    assert.equal(cli(['set', 'spend.ceiling_usd', '-1', '--repo', repo], data).status, 2);
    assert.equal(cli(['bogus-cmd'], data).status, 2);
    // A flag with no value is a usage error, not a silent fallback to the default.
    assert.equal(cli(['set', 'tracker.provider', 'jira', '--chosen'], data).status, 2);
    assert.equal(cli(['list', '--repo'], data).status, 2);
    assert.equal(fs.existsSync(repoConfigFile(data, repo)), false, 'still nothing written');
  } finally {
    cleanup(repo, data);
  }
});

test('a config file that violates the schema is a loud validation error, not a silent skip', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    const file = repoConfigFile(data, repo);
    fs.mkdirSync(path.dirname(file), { recursive: true });

    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, tracker: { provider: 'bitbucket' } }));
    let res = cli(['get', 'tracker.provider', '--repo', repo], data);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /tracker\.provider must be one of/);

    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, secrets: { token: 'abc' } }));
    res = cli(['list', '--repo', repo], data);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /unknown section "secrets"/);

    fs.writeFileSync(file, JSON.stringify({ tracker: { provider: 'jira' } }));
    res = cli(['list', '--repo', repo], data);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /schema_version/);

    fs.writeFileSync(file, '{ not json');
    res = cli(['list', '--repo', repo], data);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /not valid JSON/);
  } finally {
    cleanup(repo, data);
  }
});

test('explicit override beats every stored layer', () => {
  const repo = mkRepo();
  const data = mkData();
  const lib = loadLib(data);
  try {
    lib.mod.set('review.external', 'greptile', { cwd: repo });
    let r = lib.mod.resolve('review.external', { cwd: repo });
    assert.equal(r.provenance, 'repo');

    r = lib.mod.resolve('review.external', { cwd: repo, explicit: { 'review.external': 'none' } });
    assert.equal(r.value, 'none');
    assert.equal(r.provenance, 'explicit');

    // An explicit override is validated like any other value - never trusted blindly.
    assert.throws(
      () => lib.mod.resolve('review.external', { cwd: repo, explicit: { 'review.external': 'bogus' } }),
      /must be one of: greptile, none/,
    );
  } finally {
    lib.restore();
    cleanup(repo, data);
  }
});

test('askPlan reports what to ask and never prompts; unattended + unset is INACTIVE', () => {
  const repo = mkRepo();
  const data = mkData();
  const lib = loadLib(data);
  try {
    const attended = lib.mod.askPlan('tracker.provider', { cwd: repo, env: {} });
    assert.equal(attended.needed, true);
    assert.equal(attended.guidance, 'ask');
    assert.equal(attended.unattended, false);
    assert.match(attended.question, /tracker/i);
    assert.deepEqual(attended.choices, ['jira', 'linear', 'github', 'file', 'none']);
    assert.equal(attended.inactive_message, null);

    const unattended = lib.mod.askPlan('tracker.provider', { cwd: repo, env: { PHANTOM_UNATTENDED: '1' } });
    assert.equal(unattended.needed, true);
    assert.equal(unattended.unattended, true);
    assert.equal(unattended.guidance, 'inactive', 'unconfigured is INACTIVE, not an error');
    assert.match(unattended.inactive_message, /^INACTIVE: tracker\.provider is not configured/);

    lib.mod.set('tracker.provider', 'jira', { cwd: repo });
    const resolved = lib.mod.askPlan('tracker.provider', { cwd: repo, env: { PHANTOM_UNATTENDED: '1' } });
    assert.equal(resolved.needed, false);
    assert.equal(resolved.guidance, 'resolved');
    assert.equal(resolved.resolved.value, 'jira');
  } finally {
    lib.restore();
    cleanup(repo, data);
  }
});

test('the CLI never reads stdin (an unattended caller can never be blocked)', () => {
  const repo = mkRepo();
  const data = mkData();
  try {
    // stdin is an open pipe that is never written to. A layer that prompted would
    // hang here; the timeout turns that failure mode into a red test instead of a
    // wedged run.
    const res = spawnSync('node', [SCRIPT, 'get', 'tracker.provider', '--repo', repo], {
      encoding: 'utf-8',
      env: { ...process.env, PHANTOM_DATA: data, PHANTOM_UNATTENDED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    });
    assert.equal(res.signal, null, 'CLI must exit on its own, not on the timeout signal');
    assert.equal(res.status, 1, 'unset, reported honestly');
  } finally {
    cleanup(repo, data);
  }
});

test('jira.auto_transition prose in close.md and start.md names the real reader', () => {
  for (const file of ['close.md', 'start.md']) {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'commands', file), 'utf-8');
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l.includes('jira.auto_transition'));
    assert.ok(at >= 0, file + ' must still govern jira.auto_transition');
    assert.match(
      lines[at],
      /scripts\/phantom-config\.js" get jira\.auto_transition/,
      file + ' must name the real reader, not a config that does not exist',
    );
    // The skip condition may sit on a following line (one sentence per line).
    const block = lines.slice(at, at + 3).join('\n');
    assert.match(block, /`false`/, file + ' must keep the explicitly-false skip condition');
  }
});
