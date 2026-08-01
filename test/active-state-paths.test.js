// Author: Subash Karki
// active-state-paths.test.js -- named policy entry point for T2 of the
// unify-phantom-data-root plan: no ACTIVE surface may fall back to a
// provider-owned state root (~/.claude/phantom, ~/.claude/team,
// ~/.codex/phantom). Every root/id resolution routes through T1's shared
// codec (skills/phantom/scripts/lib/shared-state.cjs), which fail-opens to
// $HOME/.phantom.
//
// This file is the umbrella: it delegates to state-root-literals.test.js
// (owns the phantom-data-named detector) by requiring it directly, so
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

// kinds are namespaced (team-*, phantom-bare-*, codex-*) so they never
// collide with state-root-literals.test.js's own 'literal'/'constructed'
// kinds, even though both files scan the same repository.
const DETECTORS = [
  {
    kind: 'team-literal',
    pattern: /\.claude\/team\b/g,
  },
  {
    // The negative lookahead excludes the phantom-data root, which
    // state-root-literals.test.js already owns.
    kind: 'phantom-bare-literal',
    pattern: /\.claude\/phantom(?!-data)\b/g,
  },
  {
    kind: 'codex-phantom-literal',
    pattern: /\.codex\/phantom\b/g,
  },
  {
    kind: 'phantom-team-constructed',
    pattern: /path\.(?:join|resolve)\([^;\n]*['"]\.claude['"]\s*,\s*['"](?:phantom|team)['"]/g,
  },
];

const ALLOWLIST = new Map([
  ['evals/evals.json', [
    {
      kind: 'phantom-bare-literal',
      context: '"pattern": "^(?![',
      reason: 'regex asserts the retired path is absent from generated output',
    },
  ]],
  ['scripts/migrate-data.js', [
    {
      kind: 'phantom-team-constructed',
      context: "path.join(os.homedir(), '.claude', 'phantom'),",
      reason: 'copy-only source for migrating the legacy phantom root into the portable root',
    },
    {
      kind: 'phantom-team-constructed',
      context: "path.join(os.homedir(), '.claude', 'team'),",
      reason: 'copy-only source for migrating the legacy team root into the portable root',
    },
  ]],
  ['scripts/migrate-repo-dirs.js', [
    {
      kind: 'phantom-bare-literal',
      context: 'into their CANONICAL repo dir',
      reason: 'header comment naming the legacy repos root this migrator sweeps',
    },
    {
      kind: 'phantom-bare-literal',
      context: 'PHANTOM_MIGRATE_LEGACY_ROOT  legacy repos root',
      reason: 'documents the default for the migration-only env override',
    },
    {
      kind: 'phantom-team-constructed',
      context: "path.join(os.homedir(), '.claude', 'phantom', 'repos');",
      reason: 'migration-only default for PHANTOM_MIGRATE_LEGACY_ROOT, never used as an operational root',
    },
  ]],
]);

test('active surfaces never fall back to ~/.claude/team, bare ~/.claude/phantom, or ~/.codex/phantom', () => {
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

test('fail-open data-root fallback resolves to $HOME/.phantom, not a provider-owned root', () => {
  const codec = require('../skills/phantom/scripts/lib/shared-state.cjs');
  const fakeHome = '/tmp/active-state-paths-fake-home';
  const resolved = codec.resolveDataRoot('/tmp/active-state-paths-fake-workspace', {
    HOME: fakeHome,
  });

  assert.equal(resolved, require('node:path').join(fakeHome, '.phantom'));
});

test('constructed-detector coverage extends to the team and bare-phantom roots', () => {
  const bypasses = [
    { kind: 'team-literal', text: 'const p = home + "/.claude/team/sessions";' },
    { kind: 'phantom-bare-literal', text: "fallback ?? '~/.claude/phantom'" },
    { kind: 'codex-phantom-literal', text: 'legacyRoot ?? "~/.codex/phantom"' },
    { kind: 'phantom-team-constructed', text: "path.join(os.homedir(), '.claude', 'team')" },
  ];

  for (const bypass of bypasses) {
    const detector = DETECTORS.find(candidate => candidate.kind === bypass.kind);
    detector.pattern.lastIndex = 0;
    assert.match(bypass.text, detector.pattern, `${bypass.kind} composition must be detected`);
  }
});
