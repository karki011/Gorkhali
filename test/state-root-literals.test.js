// Author: Subash Karki
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  scanForLegacyRoots,
  assertAllowlistFullyUsed,
} = require('./lib/legacy-root-policy');

const SELF = 'test/state-root-literals.test.js';

const ALLOWLIST = new Map([
  ['project-docs/install.md', [
    {
      kind: 'literal',
      context: '`~/.claude/gorkhali-data` directory, the optional',
      reason: 'documents the source accepted by the legacy data migration',
    },
  ]],
  ['evals/evals.json', [
    {
      kind: 'literal',
      context: 'The Engineer hits a hard decision',
      reason: 'historical compatibility fixture for the retired config-driven flow',
    },
  ]],
  ['scripts/migrate-data.js', [
    {
      kind: 'constructed',
      context: "path.join(os.homedir(), '.claude', 'gorkhali-data')",
      reason: 'copy-only source for migrating legacy state into the portable root',
    },
  ]],
]);

const DETECTORS = [
  {
    kind: 'literal',
    pattern: /\.claude\/gorkhali-data/g,
  },
  {
    kind: 'constructed',
    pattern: /path\.(?:join|resolve)\([^;\n]*['"]\.claude['"]\s*,\s*['"]gorkhali-data['"]\s*\)/g,
  },
  {
    kind: 'constructed-variable',
    pattern: /path\.(?:join|resolve)\([^;\n]*['"]\.claude['"][^;\n]*(?:GORKHALI_DATA_DIRNAME|DATA_DIRNAME)[^;\n]*\)/g,
  },
  {
    kind: 'shell-variable',
    pattern: /(?:\$HOME|\$\{HOME\})\/\.claude\/["']?\$\{?(?:GORKHALI_DATA_DIRNAME|DATA_DIRNAME)\}?["']?/g,
  },
];

test('legacy provider-owned state roots remain only in explicit migration/history contexts', () => {
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

test('detectors cover common JavaScript and shell root-composition bypasses', () => {
  const bypasses = [
    {
      kind: 'constructed',
      text: "path.resolve(process.env.HOME, '.claude', 'gorkhali-data')",
    },
    {
      kind: 'constructed-variable',
      text: "path.join(os.homedir(), '.claude', DATA_DIRNAME)",
    },
    {
      kind: 'shell-variable',
      text: '$HOME/.claude/${GORKHALI_DATA_DIRNAME}',
    },
  ];

  for (const bypass of bypasses) {
    const detector = DETECTORS.find(candidate => candidate.kind === bypass.kind);
    detector.pattern.lastIndex = 0;
    assert.match(bypass.text, detector.pattern, `${bypass.kind} composition must be detected`);
  }
});
