// Author: Subash Karki
// active-state-paths.test.js -- named policy entry point for T2 of the
// unify-gorkhali-data-root plan: no ACTIVE surface may fall back to a
// provider-owned state root (~/.claude/gorkhali, ~/.claude/team,
// ~/.codex/gorkhali). Every root/id resolution routes through T1's shared
// codec (skills/gorkhali/scripts/lib/shared-state.cjs), which fail-opens to
// $HOME/.gorkhali.
//
// This file is the umbrella: it delegates to state-root-literals.test.js
// (owns the gorkhali-data-named detector) by requiring it directly, so
// `node --test test/active-state-paths.test.js` alone still runs that check,
// then adds its own detectors for the other two retired roots plus the
// Codex convention this plan never let take hold.
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  scanForLegacyRoots,
  assertAllowlistFullyUsed,
} = require('./lib/legacy-root-policy');

require('./state-root-literals.test.js');

const SELF = 'test/active-state-paths.test.js';

// kinds are namespaced (team-*, gorkhali-bare-*, codex-*) so they never
// collide with state-root-literals.test.js's own 'literal'/'constructed'
// kinds, even though both files scan the same repository.
const DETECTORS = [
  {
    kind: 'team-literal',
    pattern: /\.claude\/team\b/g,
  },
  {
    // The negative lookahead excludes the gorkhali-data root, which
    // state-root-literals.test.js already owns.
    kind: 'gorkhali-bare-literal',
    pattern: /\.claude\/gorkhali(?!-data)\b/g,
  },
  {
    kind: 'codex-gorkhali-literal',
    pattern: /\.codex\/gorkhali\b/g,
  },
  {
    kind: 'gorkhali-team-constructed',
    pattern: /path\.(?:join|resolve)\([^;\n]*['"]\.claude['"]\s*,\s*['"](?:gorkhali|team)['"]/g,
  },
];

const ALLOWLIST = new Map([
  ['project-docs/install.md', [
    {
      kind: 'team-literal',
      context: 'you need data from an old',
      reason: 'documents the source accepted by the legacy data migration',
    },
    {
      kind: 'gorkhali-bare-literal',
      context: 'you need data from an old',
      reason: 'documents the source accepted by the legacy data migration',
    },
  ]],
  ['commands/_shared.md', [
    {
      kind: 'gorkhali-bare-literal',
      context: 'NEVER process.env.CLAUDE_PLUGIN_ROOT',
      reason: 'names an anti-pattern for PLUGIN_ROOT resolution (code location), not a state-data-root default',
    },
  ]],
  ['evals/evals.json', [
    {
      kind: 'gorkhali-bare-literal',
      context: '"pattern": "^(?![',
      reason: 'regex asserts the legacy literal is ABSENT from the response; not itself a default',
    },
    {
      kind: 'gorkhali-bare-literal',
      context: 'must NOT use the legacy',
      reason: 'expected_behavior prose describing the same absence assertion',
    },
  ]],
  ['scripts/migrate-data.js', [
    {
      kind: 'gorkhali-team-constructed',
      context: "path.join(os.homedir(), '.claude', 'gorkhali'),",
      reason: 'copy-only source for migrating the legacy gorkhali root into the portable root',
    },
    {
      kind: 'gorkhali-team-constructed',
      context: "path.join(os.homedir(), '.claude', 'team'),",
      reason: 'copy-only source for migrating the legacy team root into the portable root',
    },
  ]],
  ['scripts/migrate-repo-dirs.js', [
    {
      kind: 'gorkhali-bare-literal',
      context: 'into their CANONICAL repo dir',
      reason: 'header comment naming the legacy repos root this migrator sweeps',
    },
    {
      kind: 'gorkhali-bare-literal',
      context: 'GORKHALI_MIGRATE_LEGACY_ROOT  legacy repos root',
      reason: 'documents the default for the migration-only env override',
    },
    {
      kind: 'gorkhali-team-constructed',
      context: "path.join(os.homedir(), '.claude', 'gorkhali', 'repos');",
      reason: 'migration-only default for GORKHALI_MIGRATE_LEGACY_ROOT, never used as an operational root',
    },
  ]],
]);

test('active surfaces never fall back to ~/.claude/team, bare ~/.claude/gorkhali, or ~/.codex/gorkhali', () => {
  const { violations, usage } = scanForLegacyRoots({
    detectors: DETECTORS,
    allowlist: ALLOWLIST,
    excludeFiles: [SELF],
  });

  assertAllowlistFullyUsed(assert, ALLOWLIST, usage);

  assert.deepEqual(
    violations,
    [],
    `legacy state root escaped the migration/history allowlist:\n${violations.join('\n')}`,
  );
});

test('fail-open data-root fallback resolves to $HOME/.gorkhali, not a provider-owned root', () => {
  const codec = require('../skills/gorkhali/scripts/lib/shared-state.cjs');
  const fakeHome = '/tmp/active-state-paths-fake-home';
  const resolved = codec.resolveDataRoot('/tmp/active-state-paths-fake-workspace', {
    HOME: fakeHome,
  });

  assert.equal(resolved, require('node:path').join(fakeHome, '.gorkhali'));
});

test('constructed-detector coverage extends to the team and bare-gorkhali roots', () => {
  const bypasses = [
    { kind: 'team-literal', text: 'const p = home + "/.claude/team/sessions";' },
    { kind: 'gorkhali-bare-literal', text: "fallback ?? '~/.claude/gorkhali'" },
    { kind: 'codex-gorkhali-literal', text: 'legacyRoot ?? "~/.codex/gorkhali"' },
    { kind: 'gorkhali-team-constructed', text: "path.join(os.homedir(), '.claude', 'team')" },
  ];

  for (const bypass of bypasses) {
    const detector = DETECTORS.find(candidate => candidate.kind === bypass.kind);
    detector.pattern.lastIndex = 0;
    assert.match(bypass.text, detector.pattern, `${bypass.kind} composition must be detected`);
  }
});
