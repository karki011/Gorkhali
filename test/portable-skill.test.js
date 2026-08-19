// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SKILL_ROOT = path.join(REPO_ROOT, 'skills', 'phantom');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-portable-skill.mjs');
const CODEX_MANIFEST = path.join(REPO_ROOT, '.codex-plugin', 'plugin.json');
const CODEX_RUNTIME_RESOLVER = path.join(REPO_ROOT, 'codex-support', 'resolve-codex-runtime.mjs');
const MANIFEST = path.join(SKILL_ROOT, 'manifest.json');
const RESOLVER = path.join(SKILL_ROOT, 'scripts', 'resolve-profile.mjs');
const RESOLVER_URL = require('node:url').pathToFileURL(RESOLVER).href;
const PRESETS = path.join(SKILL_ROOT, 'references', 'model-presets.json');

function filesUnder(directory) {
  return fs.readdirSync(directory).flatMap((entry) => {
    const file = path.join(directory, entry);
    return fs.statSync(file).isDirectory() ? filesUnder(file) : [file];
  });
}

function treeDigest(directory) {
  const hash = crypto.createHash('sha256');
  for (const file of filesUnder(directory).sort()) {
    hash.update(path.relative(directory, file));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function runJson(file, args = []) {
  return JSON.parse(execFileSync(process.execPath, [file, ...args], { encoding: 'utf8' }));
}

function copySkill(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `phantom-${label}-`));
  const target = path.join(root, 'phantom');
  fs.cpSync(SKILL_ROOT, target, { recursive: true });
  return target;
}

function validate(directory) {
  return spawnSync(process.execPath, [VALIDATOR, directory], { encoding: 'utf8' });
}

test('portable skill passes its strict provider-neutral validator', () => {
  const result = validate(SKILL_ROOT);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Portable skill is valid/);
});

test('shared-state codec ships inside the skill and depends only on node built-ins', () => {
  const codecPath = path.join(SKILL_ROOT, 'scripts', 'lib', 'shared-state.cjs');
  assert.ok(fs.existsSync(codecPath), 'codec is bundled inside the portable skill');
  const source = fs.readFileSync(codecPath, 'utf8');
  const targets = [...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.ok(targets.length > 0, 'codec requires at least one module');
  const builtins = new Set(['fs', 'path', 'crypto', 'child_process', 'os', 'url', 'util', 'module']);
  for (const target of targets) {
    const bare = target.replace(/^node:/, '');
    assert.ok(
      builtins.has(bare),
      `codec must stay standalone: forbidden non-builtin require('${target}')`,
    );
  }
  // Resolvable in isolation: a copied skill can load it with no external tree.
  const copied = copySkill('codec-standalone');
  const isolated = require(path.join(copied, 'scripts', 'lib', 'shared-state.cjs'));
  assert.equal(typeof isolated.repoId, 'function');
  assert.equal(typeof isolated.resolveDataRoot, 'function');
  assert.equal(isolated.ROOT_DIRNAME, '.phantom');
});

test('command adapter validation rejects blank descriptions and orphaned adapters', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-adapters-'));
  const commands = path.join(root, 'commands');
  const skills = path.join(root, 'skills');
  fs.mkdirSync(commands);
  fs.mkdirSync(path.join(skills, 'start'), { recursive: true });
  fs.mkdirSync(path.join(skills, 'orphan'), { recursive: true });
  fs.writeFileSync(path.join(commands, 'start.md'), '# Start\n');
  fs.writeFileSync(path.join(skills, 'start', 'SKILL.md'), [
    '---',
    'name: start',
    'description:',
    '---',
    '',
    'Read `../phantom/SKILL.md` and `../phantom/references/planning.md`.',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(skills, 'orphan', 'SKILL.md'), '---\nname: orphan\ndescription: Orphan.\n---\n');

  const validator = await import(pathToFileURL(VALIDATOR).href);
  const errors = validator.validateCommandAdapters(commands, skills);
  assert.ok(errors.some((error) => error.includes('description must contain 1-1024 characters')));
  assert.ok(errors.some((error) => error.includes('has no matching public command')));
  assert.ok(errors.some((error) => error.includes('compatibility contract is missing')));
});

test('Codex manifest discovers every public workflow skill', () => {
  const manifest = JSON.parse(fs.readFileSync(CODEX_MANIFEST, 'utf8'));
  const skillRoot = path.resolve(REPO_ROOT, manifest.skills);
  const commands = fs.readdirSync(path.join(REPO_ROOT, 'commands'))
    .filter((entry) => entry.endsWith('.md') && !entry.startsWith('_'))
    .map((entry) => entry.slice(0, -3))
    .sort();
  const discovered = fs.readdirSync(skillRoot)
    .filter((entry) => fs.existsSync(path.join(skillRoot, entry, 'SKILL.md')))
    .sort();

  assert.deepEqual(discovered, [...commands, 'phantom'].sort());
});

test('every public workflow adapter is tracked by git', () => {
  const commands = fs.readdirSync(path.join(REPO_ROOT, 'commands'))
    .filter((entry) => entry.endsWith('.md') && !entry.startsWith('_'))
    .map((entry) => entry.slice(0, -3))
    .sort();
  const tracked = new Set(execFileSync('git', ['ls-files', '--', 'skills/*/SKILL.md'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim().split('\n'));

  for (const command of commands) {
    assert.ok(tracked.has(`skills/${command}/SKILL.md`), `${command} adapter is not tracked`);
  }
});

test('public Claude command frontmatter names match filename stems', () => {
  const commandsRoot = path.join(REPO_ROOT, 'commands');
  const commands = fs.readdirSync(commandsRoot)
    .filter((entry) => entry.endsWith('.md') && !entry.startsWith('_'))
    .sort();

  for (const entry of commands) {
    const stem = entry.slice(0, -3);
    const content = fs.readFileSync(path.join(commandsRoot, entry), 'utf8');
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(frontmatter, `${entry} is missing YAML frontmatter`);
    const name = frontmatter[1].match(/^name:\s*(\S+)\s*$/m);
    assert.ok(name, `${entry} frontmatter is missing a name`);
    assert.equal(name[1], stem, `${entry} frontmatter name must match filename stem`);
    assert.doesNotMatch(name[1], /^phantom:/, `${entry} frontmatter name must not use the phantom namespace`);
  }
});

test('documented checkpoint writes provide JSON stdin and fail open', () => {
  const expectedWrites = [
    'execute.md:dispatch-wave-complete',
    'execute.md:execution-json-written',
    'execute.md:plan-loaded',
    'resume.md:resume-restore',
    'start.md:brainstorm-gate1-approved',
    'start.md:phase-a-context',
    'start.md:phase-b-route',
    'start.md:plan-gate-approved',
  ];
  const checkpointWrites = fs.readdirSync(path.join(REPO_ROOT, 'commands'))
    .filter((entry) => entry.endsWith('.md'))
    .flatMap((entry) => fs.readFileSync(path.join(REPO_ROOT, 'commands', entry), 'utf8')
      .split('\n')
      .filter((line) => line.includes('scripts/lib/checkpoint.js" write'))
      .map((line) => ({ entry, line })));

  const observedWrites = checkpointWrites.map(({ entry, line }) => {
    const phase = line.match(/\bwrite \{SESSION_DIR\}\/checkpoints ([a-z0-9-]+)/);
    assert.ok(phase, `${entry} checkpoint write must name its expected phase`);
    return `${entry}:${phase[1]}`;
  }).sort();
  assert.deepEqual(observedWrites, expectedWrites);

  for (const { entry, line } of checkpointWrites) {
    assert.ok(
      line.includes('PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)}"; PR="${PR%/}";'),
      `${entry} checkpoint write must resolve and normalize PR inline`,
    );
    assert.match(line, /if \[ -n "\$PR" \]; then/, `${entry} must skip when PR is empty`);
    const input = line.match(
      /printf '%s\\n' '([^']+)' \| node "\$PR\/scripts\/lib\/checkpoint\.js" write\b/,
    );
    assert.ok(input, `${entry} checkpoint write must receive JSON stdin`);
    assert.doesNotThrow(() => JSON.parse(input[1]), `${entry} checkpoint stdin must be valid JSON`);
    assert.equal(JSON.parse(input[1]).ticket, '{TICKET}', `${entry} checkpoint JSON must identify the ticket`);
    assert.match(line, /\|\| :; fi/, `${entry} checkpoint write must fail open`);
  }
});

test('Codex runtime resolver returns package-relative roots and neutral state', () => {
  const dataRoot = path.join(os.tmpdir(), 'phantom-codex-state');
  const output = execFileSync(process.execPath, [CODEX_RUNTIME_RESOLVER], {
    encoding: 'utf8',
    env: { ...process.env, PHANTOM_DATA: dataRoot },
  });
  const runtime = JSON.parse(output);

  assert.equal(runtime.plugin_root, REPO_ROOT);
  assert.equal(runtime.portable_skill_root, path.join(REPO_ROOT, 'skills', 'phantom'));
  assert.equal(runtime.compatibility_scripts_root, path.join(REPO_ROOT, 'scripts'));
  assert.equal(runtime.data_root, dataRoot);
});

test('installed-cache resolver loads deterministic preambles for every workflow', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-codex-cache-'));
  const cachedPlugin = path.join(root, 'cache', 'phantom', 'phantom', '0.2.1');
  for (const directory of ['.codex-plugin', 'codex-support', 'commands', 'scripts', 'skills']) {
    fs.cpSync(path.join(REPO_ROOT, directory), path.join(cachedPlugin, directory), { recursive: true });
  }
  const resolver = path.join(cachedPlugin, 'codex-support', 'resolve-codex-runtime.mjs');
  const commands = fs.readdirSync(path.join(cachedPlugin, 'commands'))
    .filter((entry) => entry.endsWith('.md') && !entry.startsWith('_'))
    .map((entry) => entry.slice(0, -3));
  const expectedPreambles = {
    T1: ['_shared.md'],
    T2: ['_shared.md', '_shared-repo-detection.md', '_shared-auto-learning.md'],
    T3: [
      '_shared.md',
      '_shared-repo-detection.md',
      '_shared-auto-learning.md',
      '_shared-shadows.md',
      '_shared-discipline.md',
      '_shared-contracts.md',
    ],
    T4: [
      '_shared.md',
      '_shared-repo-detection.md',
      '_shared-auto-learning.md',
      '_shared-shadows.md',
      '_shared-discipline.md',
      '_shared-contracts.md',
      '_shared-detective.md',
    ],
  };

  for (const command of commands) {
    const runtime = JSON.parse(execFileSync(process.execPath, [resolver, '--command', command], { encoding: 'utf8' }));
    const realPlugin = fs.realpathSync(cachedPlugin);
    assert.equal(runtime.plugin_root, realPlugin);
    assert.equal(runtime.command_file, path.join(realPlugin, 'commands', `${command}.md`));
    assert.match(runtime.preamble_tier, /^T[1-4]$/);
    const expected = command === 'detective'
      ? [...expectedPreambles[runtime.preamble_tier], '_shared-detective.md']
      : expectedPreambles[runtime.preamble_tier];
    assert.deepEqual(runtime.preamble_files.map((file) => path.basename(file)), expected);
    assert.ok(!runtime.preamble_files.some((file) => file.endsWith('_shared-brain.md')));
    const commandContent = fs.readFileSync(runtime.command_file, 'utf8');
    assert.match(commandContent, new RegExp(`Preamble Tier: ${runtime.preamble_tier}`));
    for (const file of runtime.preamble_files) {
      assert.ok(file.startsWith(path.join(realPlugin, 'commands')));
      assert.ok(fs.existsSync(file), `${command} preamble is missing: ${file}`);
    }
    if (['verify', 'fix', 'detective'].includes(command)) {
      assert.ok(runtime.conditional_preamble_files.some((entry) => entry.file.endsWith('_shared-detective.md')));
    }
  }
});

test('installed-cache portable lifecycle keeps Codex state out of .claude', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-codex-lifecycle-'));
  const cachedPlugin = path.join(root, 'cache', 'phantom', 'phantom', '0.2.1');
  fs.cpSync(path.join(REPO_ROOT, 'skills'), path.join(cachedPlugin, 'skills'), { recursive: true });
  const state = path.join(cachedPlugin, 'skills', 'phantom', 'scripts', 'phantom-state.mjs');
  const workspace = path.join(root, 'workspace');
  const dataRoot = path.join(root, 'phantom-data');
  const fakeHome = path.join(root, 'home');
  fs.mkdirSync(workspace);
  const environment = { ...process.env, HOME: fakeHome, PHANTOM_DATA: dataRoot };
  const run = (...args) => execFileSync(process.execPath, [state, ...args, '--workspace', workspace], {
    encoding: 'utf8',
    env: environment,
  });

  run('start', '--task', 'codex-cache-smoke', '--intent', 'Smoke test', '--route', 'direct');
  run('pause', '--reason', 'Smoke pause');
  run('resume');
  const status = JSON.parse(run('status'));

  assert.equal(status.status, 'active');
  assert.ok(fs.existsSync(dataRoot));
  assert.ok(!fs.existsSync(path.join(fakeHome, '.claude')));
});

test('portable bundle manifest versions every public contract', async () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.deepEqual(manifest, {
    name: 'phantom',
    bundle_version: '2.4.1',
    contract_resource_digest: manifest.contract_resource_digest,
    contract_versions: {
      capability_ledger: 1,
      state_envelope: 1,
      decision_artifact: 3,
      defect_proof: 1,
      delegation: 2,
      model_policy: 2,
      model_presets: 1,
      model_routing: 1,
      impact_report: 1,
    },
  });
  assert.match(manifest.contract_resource_digest, /^sha256:[a-f0-9]{64}$/);
  const { BUNDLE_VERSION } = await import(RESOLVER_URL);
  assert.equal(BUNDLE_VERSION, manifest.bundle_version);
});

test('portable validator rejects malformed manifest contract keys and versions', () => {
  for (const [label, mutate, expected] of [
    ['unknown-key', (manifest) => { manifest.contract_versions.unknown = 1; }, /must contain exactly/],
    ['invalid-version', (manifest) => { manifest.contract_versions.delegation = 99; }, /must be 2/],
  ]) {
    const target = copySkill(`manifest-${label}`);
    const file = path.join(target, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    mutate(manifest);
    fs.writeFileSync(file, JSON.stringify(manifest));
    const result = validate(target);
    assert.notEqual(result.status, 0, `${label} unexpectedly passed`);
    assert.match(result.stderr, expected);
  }
});

test('portable validator detects stale bundle metadata after a lifecycle contract resource changes', () => {
  const staleResource = copySkill('stale-contract-resource');
  fs.appendFileSync(
    path.join(staleResource, 'references', 'state.md'),
    '\nA changed lifecycle rule requires refreshed bundle metadata.\n',
  );
  const changed = validate(staleResource);
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /contract_resource_digest is stale.*bump bundle_version/s);

  const staleVersion = copySkill('stale-lifecycle-version');
  const manifestFile = path.join(staleVersion, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.bundle_version = '2.0.0';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const versioned = validate(staleVersion);
  assert.notEqual(versioned.status, 0);
  assert.match(versioned.stderr, /bundle_version must be at least 2\.2\.0/);
});

test('portable validator requires every bundled planning and AI review resource', () => {
  for (const resource of [
    'references/execution.md',
    'references/planning.md',
    'references/shipping.md',
    'references/brainstorming.md',
    'references/review-html.md',
    'scripts/lib/decision-contracts.mjs',
    'scripts/validate-review-html.mjs',
  ]) {
    const target = copySkill(`missing-${resource.replaceAll('/', '-')}`);
    fs.rmSync(path.join(target, resource));
    const result = validate(target);
    assert.notEqual(result.status, 0, `${resource} unexpectedly passed`);
    assert.match(result.stderr, new RegExp(`Required portable resource is missing: ${resource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
});

test('planning instructions enforce JSON validation before AI-generated HTML', () => {
  const skill = fs.readFileSync(path.join(SKILL_ROOT, 'SKILL.md'), 'utf8');
  const planning = fs.readFileSync(path.join(SKILL_ROOT, 'references', 'planning.md'), 'utf8');
  const normalized = planning.replace(/\s+/g, ' ');
  const validateJson = normalized.search(/Validate canonical JSON/i);
  const generate = normalized.search(/generate the disposable HTML/i);
  const validateHtml = normalized.search(/validate-review-html\.mjs/i);
  assert.ok(validateJson >= 0 && validateJson < generate && generate < validateHtml);
  assert.match(normalized, /review HTML guidance/i);
  assert.match(normalized, /file writing is unavailable.*fenced `json` block/i);
  assert.match(skill, /\[Planning\]\(references\/planning\.md\)/);
  assert.doesNotMatch(skill, /validate-review-html\.mjs/i, 'router must not duplicate phase procedure');
});

test('official skill validator accepts the canonical skill when available', (context) => {
  const pythonValidator = path.join(
    os.homedir(),
    '.codex',
    'skills',
    '.system',
    'skill-creator',
    'scripts',
    'quick_validate.py',
  );
  if (!fs.existsSync(pythonValidator)) {
    context.skip('No local skill-creator checkout; CI runs the pinned reference validator.');
    return;
  }
  if (spawnSync('python3', ['-c', 'import yaml']).status !== 0) {
    context.skip('PyYAML is unavailable locally; CI runs the pinned reference validator.');
    return;
  }
  const result = spawnSync('python3', [pythonValidator, SKILL_ROOT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Skill is valid/);
});

test('one unchanged skill tree installs byte-identically in three discovery layouts', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-portability-'));
  const targets = [
    path.join(fixture, '.claude', 'skills', 'phantom'),
    path.join(fixture, '.agents', 'skills', 'phantom'),
    path.join(fixture, 'third-host', '.agents', 'skills', 'phantom'),
  ];
  const expected = treeDigest(SKILL_ROOT);
  const expectedManifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(SKILL_ROOT, target, { recursive: true });
    assert.equal(treeDigest(target), expected);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8')),
      expectedManifest,
    );
    const validation = validate(target);
    assert.equal(validation.status, 0, validation.stderr);
  }
});

test('a copied skill ships review guidance and validation without a renderer', () => {
  const copiedSkill = copySkill('copied-review-guidance');
  for (const resource of [
    'references/review-html.md',
    'scripts/validate-review-html.mjs',
  ]) {
    assert.ok(fs.existsSync(path.join(copiedSkill, resource)), `${resource} is bundled`);
  }
  assert.equal(fs.existsSync(path.join(copiedSkill, 'scripts', 'render-review.mjs')), false);
  const result = spawnSync(process.execPath, [
    path.join(copiedSkill, 'scripts', 'validate-review-html.mjs'),
  ], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: node validate-review-html\.mjs/);
});

test('every role resolves to a declared semantic profile and a missing host inherits', async () => {
  const { resolveProfile } = await import(RESOLVER_URL);
  const policy = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'references', 'model-policy.json'), 'utf8'));
  for (const [role, profile] of Object.entries(policy.roles)) {
    const result = resolveProfile({ role });
    assert.equal(result.bundle_version, '2.4.1');
    assert.equal(result.requested_profile, profile);
    assert.equal(result.model, null);
    assert.equal(result.effort, null);
    assert.equal(result.resolution, 'inherit-active-model');
  }
  assert.equal(policy.roles.chief, 'frontier');
  assert.equal(policy.roles.opposition, 'balanced');
  assert.equal(policy.roles.surveyor, 'balanced');
});

test('critical risk elevates eligible roles before preset lookup and preserves exemptions', () => {
  for (const role of ['engineer', 'auditor', 'advisor', 'surveyor', 'justice', 'opposition', 'detective']) {
    const result = runJson(RESOLVER, ['--role', role, '--risk', 'critical', '--host', 'claude-code']);
    assert.equal(result.risk, 'critical');
    assert.equal(result.requested_profile, 'deep');
    // claude-code maps every delegated profile onto sonnet: the elevation is
    // visible in requested_profile, not in the model it resolves to.
    assert.equal(result.model, 'sonnet');
  }

  for (const [role, profile] of [
    ['chief', 'frontier'],
    ['inspector', 'economy'],
    ['steward', 'balanced'],
    ['clerk', 'economy'],
  ]) {
    const result = runJson(RESOLVER, ['--role', role, '--risk', 'critical']);
    assert.equal(result.requested_profile, profile);
  }

  for (const profile of ['deep', 'frontier']) {
    const result = runJson(RESOLVER, [
      '--role', 'engineer', '--profile', profile, '--risk', 'critical',
    ]);
    assert.equal(result.requested_profile, profile);
  }

  const semanticOnly = runJson(RESOLVER, ['--role', 'opposition', '--risk', 'critical']);
  assert.equal(semanticOnly.requested_profile, 'deep');
  assert.equal(semanticOnly.model, null);
  const explicit = runJson(RESOLVER, [
    '--role', 'opposition', '--risk', 'critical', '--model', 'user-selected',
  ]);
  assert.equal(explicit.model, 'user-selected');
  assert.equal(explicit.resolution, 'explicit-user-choice');

  const invalid = spawnSync(process.execPath, [RESOLVER, '--role', 'engineer', '--risk', 'urgent'], {
    encoding: 'utf8',
  });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unknown risk level/);
});

test('portable validator pins the delegation-v2 critical-risk model policy', () => {
  for (const [label, mutate, expected] of [
    ['schema', (policy) => { policy.schema_version = 1; }, /schema_version must be 2/],
    ['risk-levels', (policy) => { policy.risk_levels = ['critical']; }, /risk_levels must be/],
    ['eligible', (policy) => { policy.critical_elevation.eligible_roles.pop(); }, /eligible_roles is invalid/],
    ['exempt', (policy) => { policy.critical_elevation.exempt_roles = []; }, /exempt_roles is invalid/],
    ['missing-surveyor', (policy) => { delete policy.roles.surveyor; }, /exactly the active portable roles/],
    ['opposition', (policy) => { policy.roles.opposition = 'deep'; }, /ordinary opposition must use balanced/],
  ]) {
    const target = copySkill(`invalid-model-policy-${label}`);
    const file = path.join(target, 'references', 'model-policy.json');
    const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
    mutate(policy);
    fs.writeFileSync(file, `${JSON.stringify(policy, null, 2)}\n`);
    const result = validate(target);
    assert.notEqual(result.status, 0, `${label} unexpectedly passed`);
    assert.match(result.stderr, expected);
  }
});

test('bundled presets cover every profile and resolve each role tier', () => {
  const presets = JSON.parse(fs.readFileSync(PRESETS, 'utf8'));
  const expected = {
    'claude-code': {
      inherit: [null, null],
      // Flat on purpose: Opus is reserved for the orchestrating session, so
      // every delegated profile resolves to sonnet on this host.
      economy: ['sonnet', null],
      balanced: ['sonnet', 'high'],
      deep: ['sonnet', 'high'],
      frontier: ['sonnet', 'high'],
    },
    codex: {
      inherit: [null, null],
      economy: ['gpt-5.6-luna', 'low'],
      balanced: ['gpt-5.6-terra', 'high'],
      deep: ['gpt-5.6-sol', 'high'],
      frontier: ['gpt-5.6-sol', 'max'],
    },
  };
  const roleForProfile = { economy: 'inspector', balanced: 'engineer', deep: 'auditor', frontier: 'chief' };

  for (const [host, profiles] of Object.entries(expected)) {
    assert.deepEqual(Object.keys(presets.hosts[host].profiles).sort(), Object.keys(profiles).sort());
    for (const [profile, [model, effort]] of Object.entries(profiles)) {
      assert.deepEqual(presets.hosts[host].profiles[profile], { model, effort });
      if (profile === 'inherit') continue;
      const result = runJson(RESOLVER, ['--role', roleForProfile[profile], '--host', host.toUpperCase()]);
      assert.equal(result.host, host);
      assert.equal(result.requested_profile, profile);
      assert.equal(result.model, model);
      assert.equal(result.effort, effort);
      assert.equal(result.resolution, 'bundled-host-preset');
    }
  }
});

test('model resolution honors user choice, external map, bundled preset, then inheritance', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-models-'));
  const mapFile = path.join(fixture, 'models.json');
  fs.writeFileSync(mapFile, JSON.stringify({
    profiles: { balanced: { model: 'runtime-balanced', effort: 'custom' } },
  }));

  const mapped = runJson(RESOLVER, ['--role', 'engineer', '--host', 'codex', '--map', mapFile]);
  assert.equal(mapped.requested_profile, 'balanced');
  assert.equal(mapped.model, 'runtime-balanced');
  assert.equal(mapped.effort, 'custom');
  assert.equal(mapped.resolution, 'external-profile-map');

  fs.writeFileSync(mapFile, JSON.stringify({ profiles: { balanced: 'legacy-balanced' } }));
  const legacy = runJson(RESOLVER, ['--role', 'engineer', '--host', 'codex', '--map', mapFile]);
  assert.equal(legacy.model, 'legacy-balanced');
  assert.equal(legacy.effort, null);
  assert.equal(legacy.resolution, 'external-profile-map');

  const explicit = runJson(RESOLVER, [
    '--role', 'engineer',
    '--host', 'codex',
    '--map', mapFile,
    '--model', 'user-selected',
  ]);
  assert.equal(explicit.model, 'user-selected');
  assert.equal(explicit.effort, null);
  assert.equal(explicit.resolution, 'explicit-user-choice');

  for (const args of [
    ['--role', 'chief'],
    ['--role', 'chief', '--host', 'future-host'],
  ]) {
    const inherited = runJson(RESOLVER, args);
    assert.equal(inherited.requested_profile, 'frontier');
    assert.equal(inherited.model, null);
    assert.equal(inherited.effort, null);
    assert.equal(inherited.resolution, 'inherit-active-model');
  }
});

// The profile ladder is SEMANTIC, and this test is what keeps that honest now
// that claude-code's presets are flat: a downshift must still be visible in
// `requested_profile` even where it buys no cheaper model, and it must still
// move the model on a host whose presets are not flat. Asserting only the
// claude-code side would let a future edit collapse the profiles themselves
// without failing anything.
test('delegated profiles downshift semantically while Chief stays frontier', () => {
  const claudeCode = {};
  for (const profile of ['economy', 'balanced', 'deep']) {
    const result = runJson(RESOLVER, [
      '--role', 'engineer', '--profile', profile, '--host', 'claude-code',
    ]);
    assert.equal(result.requested_profile, profile, `${profile} must survive resolution`);
    assert.equal(result.model, 'sonnet', `${profile} resolves to sonnet on claude-code`);
    claudeCode[profile] = result;
  }
  assert.equal(claudeCode.balanced.effort, 'high');

  // Same three requests on a host whose ladder is not flat still spread.
  const codex = ['economy', 'balanced', 'deep'].map((profile) => runJson(RESOLVER, [
    '--role', 'engineer', '--profile', profile, '--host', 'codex',
  ]).model);
  assert.equal(new Set(codex).size, 3, 'a non-flat host must still spread the profiles');

  const chief = runJson(RESOLVER, [
    '--role', 'chief', '--profile', 'economy', '--host', 'claude-code',
  ]);
  assert.equal(chief.requested_profile, 'frontier', 'Chief ignores a downshift request');
  assert.equal(chief.model, 'sonnet');
});

test('portable CLI entrypoints execute through a symlinked skill installation', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-linked-install-'));
  const linkedSkill = path.join(fixture, 'phantom');
  fs.symlinkSync(SKILL_ROOT, linkedSkill, process.platform === 'win32' ? 'junction' : 'dir');

  const resolver = runJson(path.join(linkedSkill, 'scripts', 'resolve-profile.mjs'), [
    '--role', 'chief', '--host', 'claude-code',
  ]);
  assert.equal(resolver.bundle_version, '2.4.1');
  assert.equal(resolver.model, 'sonnet');

  const impact = runJson(path.join(linkedSkill, 'scripts', 'inspect-impact.mjs'), [
    'inspect', '--workspace', REPO_ROOT, 'skills/phantom/scripts/lib/portable.mjs',
  ]);
  assert.ok(['complete', 'partial'].includes(impact.status));
  assert.equal(impact.source, 'bundled-local-analysis');

  const stateResult = spawnSync(process.execPath, [
    path.join(linkedSkill, 'scripts', 'phantom-state.mjs'),
    'status', '--workspace', REPO_ROOT,
  ], {
    encoding: 'utf8',
    env: { ...process.env, PHANTOM_DATA: path.join(fixture, 'state') },
  });
  assert.equal(stateResult.status, 0, stateResult.stderr);
  assert.equal(JSON.parse(stateResult.stdout).status, 'none');

  assert.equal(fs.existsSync(path.join(linkedSkill, 'scripts', 'render-review.mjs')), false);
  const reviewValidator = path.join(linkedSkill, 'scripts', 'validate-review-html.mjs');
  assert.ok(fs.existsSync(reviewValidator));
  const validatorResult = spawnSync(process.execPath, [reviewValidator], { encoding: 'utf8' });
  assert.equal(validatorResult.status, 1);
  assert.match(validatorResult.stderr, /Usage: node validate-review-html\.mjs/);
});

test('provider identifiers are allowed only in the controlled preset registry', () => {
  const markdownLeak = copySkill('provider-leak');
  fs.appendFileSync(path.join(markdownLeak, 'references', 'models.md'), '\nCodex\n');
  const leaked = validate(markdownLeak);
  assert.notEqual(leaked.status, 0);
  assert.match(leaked.stderr, /forbidden provider name/);

  const copiedPreset = copySkill('copied-preset');
  fs.copyFileSync(
    path.join(copiedPreset, 'references', 'model-presets.json'),
    path.join(copiedPreset, 'references', 'other-presets.json'),
  );
  const copied = validate(copiedPreset);
  assert.notEqual(copied.status, 0);
  assert.match(copied.stderr, /forbidden provider (?:name|model alias)/);

  const textLeak = copySkill('provider-text-leak');
  fs.writeFileSync(path.join(textLeak, 'references', 'provider-data.txt'), 'Codex gpt-5.6-sol\n');
  const textResult = validate(textLeak);
  assert.notEqual(textResult.status, 0);
  assert.match(textResult.stderr, /forbidden provider (?:name|model alias)/);
});

test('preset schema rejects incomplete, unsafe, and unexpected entries', () => {
  const cases = [
    ['missing profile', (value) => { delete value.hosts.codex.profiles.frontier; }],
    ['invalid model', (value) => { value.hosts.codex.profiles.deep.model = 42; }],
    ['invalid effort', (value) => { value.hosts.codex.profiles.deep.effort = []; }],
    ['concrete inherit', (value) => { value.hosts.codex.profiles.inherit.model = 'unexpected'; }],
    ['invalid fallback', (value) => { value.unknown_host.fallback = 'guess-a-model'; }],
    ['invalid selection order', (value) => { value.selection_order.reverse(); }],
    ['combined profile key', (value) => {
      value.hosts.codex.profiles['balanced,deep'] = value.hosts.codex.profiles.balanced;
      delete value.hosts.codex.profiles.balanced;
      delete value.hosts.codex.profiles.deep;
    }],
    ['unexpected key', (value) => { value.hosts.codex.extra = true; }],
  ];

  for (const [label, mutate] of cases) {
    const target = copySkill(`invalid-preset-${label.replaceAll(' ', '-')}`);
    const presetFile = path.join(target, 'references', 'model-presets.json');
    const value = JSON.parse(fs.readFileSync(presetFile, 'utf8'));
    mutate(value);
    fs.writeFileSync(presetFile, `${JSON.stringify(value, null, 2)}\n`);
    const result = validate(target);
    assert.notEqual(result.status, 0, `${label} unexpectedly passed`);
  }

  const nullRoot = copySkill('invalid-preset-null-root');
  fs.writeFileSync(path.join(nullRoot, 'references', 'model-presets.json'), 'null\n');
  const nullResult = validate(nullRoot);
  assert.notEqual(nullResult.status, 0, 'null preset root unexpectedly passed');
  assert.match(nullResult.stderr, /Model presets must be an object/);
});

test('capability contract preserves all required degradation paths', () => {
  const capabilities = fs.readFileSync(path.join(SKILL_ROOT, 'references', 'capabilities.md'), 'utf8')
    .replace(/\s+/g, ' ');
  for (const capability of [
    'Delegation',
    'Parallelism',
    'Compute selection',
    'Dependency graph',
    'Hooks',
    'Visual presentation',
    'Web research',
    'Issue integration',
    'Review publishing',
  ]) {
    assert.match(capabilities, new RegExp(`\\| ${capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`));
  }
  assert.match(capabilities, /Implementation additionally requires a write mechanism/i);
  assert.match(capabilities, /Automated verification requires command execution or an equivalent test facility/i);
  assert.match(capabilities, /stop only the affected stage/i);
  assert.match(capabilities, /Never silently convert an unavailable check into a pass/i);
});

test('portable workflow makes delegation an automatic, native Chief decision', () => {
  const read = (file) => fs.readFileSync(path.join(SKILL_ROOT, file), 'utf8').replace(/\s+/g, ' ');
  const skill = read('SKILL.md');
  const execution = read('references/execution.md');
  const roles = read('references/roles.md');
  const capabilities = read('references/capabilities.md');
  const models = read('references/models.md');
  const verification = read('references/verification.md');

  assert.match(skill, /\[Execution\]\(references\/execution\.md\)/);
  assert.match(execution, /current agent for one tightly coupled scope/i);
  assert.match(execution, /serial isolated passes/i);
  assert.match(execution, /parallel delegates only for proven independent scopes/i);
  assert.match(execution, /non-overlapping write ownership/i);
  assert.match(execution, /Use native delegation only/i);
  assert.match(execution, /labeled sequential passes without removing any gate/i);
  assert.match(roles, /explicit user instruction to require, limit, or disable delegation within repository safety/i);
  assert.match(roles, /runtime requires approval, request it before spawning/i);
  assert.match(roles, /without shared writes or unresolved producer-consumer edges/i);
  assert.match(roles, /\| Surveyor \|.*explicit user request.*advisory evidence.*never.*lifecycle gate/is);
  assert.match(capabilities, /dedicated native mechanism for bounded worker contexts or sessions/i);
  assert.match(capabilities, /Never recursively launch another copy of the current runtime/i);
  assert.match(capabilities, /unknown optional capability behaves as unavailable/i);
  assert.match(models, /chooses the execution topology before resolving worker compute/i);
  assert.match(verification, /independent review/i);
  assert.match(verification, /user verification in the ordinary verification artifact/i);
  assert.match(verification, /does not create a specialist artifact/i);
});

test('minimum-sufficient solution policy is ordered, automatic, inherited, and safety bounded', () => {
  const read = (file) => fs.readFileSync(path.join(SKILL_ROOT, file), 'utf8').replace(/\s+/g, ' ');
  const skill = read('SKILL.md');
  const planning = read('references/planning.md');
  const execution = read('references/execution.md');
  const verification = read('references/verification.md');

  const ladder = [
    'omit unnecessary machinery',
    'reuse the repository',
    'prefer standard or native behavior',
    'reuse installed dependencies',
    'smallest custom implementation',
  ];
  let cursor = -1;
  for (const rung of ladder) {
    const next = planning.indexOf(rung, cursor + 1);
    assert.ok(next > cursor, `missing or unordered solution rung: ${rung}`);
    cursor = next;
  }

  assert.match(skill, /Prefer omission, reuse, standard or native behavior, and installed dependencies before custom machinery/i);
  assert.match(execution, /selected minimum-sufficient solution/i);
  assert.match(verification, /may not remove approved behavior, validation, compatibility, accessibility, security controls, or evidence/i);
  assert.match(verification, /rerun every affected correctness check/i);
});

test('portable lifecycle authority is explicit, validated, and provider mechanics cannot override it', () => {
  const compatibility = fs.readFileSync(
    path.join(REPO_ROOT, 'codex-support', 'codex-compatibility.md'),
    'utf8',
  );
  const start = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'start', 'SKILL.md'), 'utf8');
  const skill = fs.readFileSync(path.join(SKILL_ROOT, 'SKILL.md'), 'utf8');
  const state = fs.readFileSync(path.join(SKILL_ROOT, 'references', 'state.md'), 'utf8');
  const planning = fs.readFileSync(path.join(SKILL_ROOT, 'references', 'planning.md'), 'utf8');
  const verification = fs.readFileSync(path.join(SKILL_ROOT, 'references', 'verification.md'), 'utf8');
  const shipping = fs.readFileSync(path.join(SKILL_ROOT, 'references', 'shipping.md'), 'utf8');

  const authority = [
    'User instructions, repository instructions, and runtime safety',
    'The portable skill and its references',
    'Compatible legacy command intent',
    'Legacy or provider-specific mechanics',
  ];
  let cursor = -1;
  for (const level of authority) {
    const next = compatibility.indexOf(level, cursor + 1);
    assert.ok(next > cursor, `missing or unordered authority level: ${level}`);
    cursor = next;
  }
  assert.match(
    compatibility,
    /legacy command text may not add or override delegation, approval,\s+phase, state-path, or lifecycle authority/i,
  );
  assert.match(start, /local planning and implementation only/i);
  assert.match(start, /no implicit PR lifecycle/i);
  assert.match(start, /PR shipping requires separate, explicit authorization/i);
  assert.doesNotMatch(start, /codex-compatibility|commands\/start|_shared/i);
  assert.match(skill, /scripts\/phantom-state\.mjs` is the sole lifecycle authority/i);
  assert.match(skill, /`direct`.*None; implementation authorization is still required/is);
  assert.match(skill, /`plan`.*Approved plan/is);
  assert.match(skill, /`brainstorm`.*Approved direction, then approved plan/is);
  assert.match(skill, /`full`.*Approved direction, plan, and wiring/is);
  assert.match(skill, /`--mode to-plan` is permanently plan-only/i);
  assert.match(state, /schema_version: 1/i);
  assert.match(state, /older sessions must synthesize missing\s+pending values/i);
  assert.match(state, /worktree_fingerprint/i);
  assert.match(state, /route and material intent are immutable/i);
  assert.match(state, /Direction binds the current passed\s+`brainstorm`/i);
  assert.match(state, /wiring binds both the\s+current passed `plan` and current passed `decisions`/i);
  assert.match(state, /failed\s+artifact write must leave those lifecycle actions unchanged/i);
  assert.match(state, /authoritative review must have a later\s+`record_sequence`/i);
  assert.match(planning, /route and material intent are immutable/i);
  assert.match(planning, /`brainstorm` requires direction before plan/i);
  assert.match(verification, /A later verification\s+also makes an earlier review stale/i);
  assert.match(shipping, /Local implementation\s+authorization never authorizes shipping/i);

  const invalid = copySkill('missing-lifecycle-contract');
  const invalidState = path.join(invalid, 'references', 'state.md');
  fs.writeFileSync(
    invalidState,
    fs.readFileSync(invalidState, 'utf8').replaceAll('worktree_fingerprint', 'workspace_snapshot'),
  );
  const result = validate(invalid);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /references\/state\.md must define portable lifecycle contract token: worktree_fingerprint/);
});
