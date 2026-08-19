// Author: Subash Karki
// domains.test.js — pins the canonical domain taxonomy. The old consumer copies
// conflicted (extract-learnings' loose /ui|frontend/i substring vs consolidator's
// scripts/→tooling); resolution: segment-scoped ui matching + scripts/→tooling kept,
// so loose substring hits like scripts/build.sh now route tooling, not ui.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { DOMAIN_NAMES, fileDomain, DOMAIN_KEYWORDS, KNOWN_DOMAIN_FILES } = require('../scripts/lib/domains');

test('every rule arm shared by BOTH old copies still routes the same', () => {
  // shadows
  assert.equal(fileDomain('hooks/x.sh'), 'shadows');
  assert.equal(fileDomain('src/agent-spawner.ts'), 'shadows');
  // testing
  assert.equal(fileDomain('test/foo.js'), 'testing');
  assert.equal(fileDomain('src/a.test.ts'), 'testing');
  // ui (path/ext arms — present in both old copies)
  assert.equal(fileDomain('src/components/Button.jsx'), 'ui');
  assert.equal(fileDomain('a/B.tsx'), 'ui');
  assert.equal(fileDomain('m.css'), 'ui');
  // data
  assert.equal(fileDomain('src/api/users.js'), 'data');
  assert.equal(fileDomain('lib/fetcher.js'), 'data');
  // auth
  assert.equal(fileDomain('auth/login.js'), 'auth');
  assert.equal(fileDomain('lib/jwt-utils.js'), 'auth');
  // migration
  assert.equal(fileDomain('migrations/001.js'), 'migration');
  assert.equal(fileDomain('db/schema/x.js'), 'migration');
  // tooling
  assert.equal(fileDomain('config/x.js'), 'tooling');
  assert.equal(fileDomain('tsconfig.json'), 'tooling');
});

test('divergence fix: ui/frontend arm kept but segment-scoped (loose substring was the bug)', () => {
  // Old memory-consolidator routed these to 'other'; old extract-learnings → 'ui'.
  assert.equal(fileDomain('frontend/page.js'), 'ui');
  assert.equal(fileDomain('src/ui-helpers.py'), 'ui');
});

test('P1 regression: ui matches only as a path segment/word, not a substring', () => {
  // scripts/→tooling wins now that 'build' no longer substring-matches ui.
  assert.equal(fileDomain('scripts/build.sh'), 'tooling');
  assert.notEqual(fileDomain('src/rebuild.js'), 'ui');
  assert.equal(fileDomain('src/rebuild.js'), null);
  assert.notEqual(fileDomain('circuit-breaker.go'), 'ui');
  assert.notEqual(fileDomain('gui/main.go'), 'ui');
  // Segment/boundary forms still route ui.
  assert.equal(fileDomain('frontend/app.js'), 'ui');
  assert.equal(fileDomain('src/ui/x.ts'), 'ui');
  assert.equal(fileDomain('my-ui-kit/button.js'), 'ui');
  assert.equal(fileDomain('app.ui.ts'), 'ui');
});

test('consolidator-only scripts/→tooling arm is kept', () => {
  // Old extract-learnings had no scripts rule (fell through to ext map).
  assert.equal(fileDomain('scripts/run.py'), 'tooling');
});

test('no match → null so each caller keeps its own fallback (other/unknown/ext map)', () => {
  assert.equal(fileDomain(''), null);
  assert.equal(fileDomain(null), null);
  assert.equal(fileDomain('notes.txt'), null);
});

test('DOMAIN_KEYWORDS is exactly the canonical set (keys AND keywords)', () => {
  assert.deepEqual(DOMAIN_KEYWORDS, {
    ui: ['react', 'jsx', 'tsx', 'component', 'css', 'style', 'chakra', 'layout', 'render', 'frontend', 'tailwind', 'svg', 'figma'],
    data: ['api', 'fetch', 'axios', 'graphql', 'endpoint', 'route', 'rest', 'http', 'query', 'mutation', 'request', 'response'],
    auth: ['auth', 'jwt', 'token', 'oauth', 'session', 'login', 'password', 'credential', 'permission', 'rbac'],
    testing: ['test', 'spec', 'mock', 'jest', 'vitest', 'mocha', 'assert', 'expect', 'coverage', 'fixture'],
    shadows: ['agent', 'shadows', 'skill', 'spawn', 'hook', 'chief', 'engineer', 'advisor', 'inspector', 'auditor', 'justice', 'detective'],
    migration: ['migrate', 'schema', 'migration', 'alter', 'column', 'table', 'database', 'sql', 'prisma', 'drizzle'],
    tooling: ['config', 'eslint', 'tsconfig', 'webpack', 'vite', 'prettier', 'lint', 'build', 'ci', 'pipeline', 'docker', 'deploy'],
    'model-routing': ['model-routing', 'compute-profile', 'fallback', 'requested_profile', 'actual_profile', 'frontier'],
    infra: ['infra', 'installer', 'plugin', 'marketplace', 'vendor', 'release', 'version', 'cache', 'regex', 'resolver'],
    workflow: ['workflow', 'session', 'wrap', 'gate', 'marker', 'lock', 'commit', 'worktree', 'prompt', 'injection'],
  });
});

test('KNOWN_DOMAIN_FILES matches the canonical domain list (order preserved)', () => {
  assert.deepEqual(KNOWN_DOMAIN_FILES, ['ui.md', 'data.md', 'auth.md', 'testing.md', 'tooling.md', 'migration.md', 'shadows.md', 'model-routing.md', 'infra.md', 'workflow.md']);
  assert.deepEqual(KNOWN_DOMAIN_FILES, DOMAIN_NAMES.map(d => `${d}.md`));
});

// infra.md and workflow.md are the only domain files that actually exist on disk.
// Before they were declared, every real learnings file was an "Unknown domain file"
// warning from check-learnings-index.js, whose sole input is KNOWN_DOMAIN_FILES.
test('the domain files that exist on disk are declared, so they stop reporting as unknown', () => {
  assert.ok(KNOWN_DOMAIN_FILES.includes('infra.md'));
  assert.ok(KNOWN_DOMAIN_FILES.includes('workflow.md'));
});

// Retired snapshots must stay UNdeclared: the unknown-domain warning is the only
// human-visible trace that a stale file is still on disk awaiting deletion.
// Do not "fix" this warning by declaring the file - that hides the signal.
test('retired domain files are excluded from the known set on purpose', () => {
  const { RETIRED_DOMAIN_FILES } = require('../scripts/lib/domains');
  assert.deepEqual(RETIRED_DOMAIN_FILES, ['workflow.original.md']);
  for (const retired of RETIRED_DOMAIN_FILES) {
    assert.ok(!KNOWN_DOMAIN_FILES.includes(retired), `${retired} must not be declared known`);
    assert.ok(!DOMAIN_NAMES.includes(retired.replace(/\.md$/, '')), `${retired} must not be a domain name`);
  }
});
