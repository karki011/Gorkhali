// Author: Subash Karki
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SELF = 'test/state-root-literals.test.js';

const ALLOWLIST = new Map([
  ['README.md', [
    {
      kind: 'literal',
      context: '`~/.claude/phantom-data` directory, the optional',
      reason: 'documents the source accepted by the legacy data migration',
    },
  ]],
  ['evals/evals.json', [
    {
      kind: 'literal',
      context: 'The Blade hits a hard decision',
      reason: 'historical compatibility fixture for the retired config-driven flow',
    },
  ]],
  ['phantom-codex-plugin-plan.html', [
    {
      kind: 'literal',
      context: 'State</span><strong>Sessions + learnings',
      reason: 'dated portability-plan snapshot of the pre-cutover runtime',
    },
    {
      kind: 'literal',
      context: 'option value="legacy">Keep',
      reason: 'dated portability-plan legacy-state option',
    },
    {
      kind: 'literal',
      context: '<tr><td>State</td><td>',
      reason: 'dated portability-plan current-state comparison',
    },
    {
      kind: 'literal',
      context: "id:'migration',title:'Legacy state migration'",
      reason: 'dated portability-plan migration rationale',
    },
    {
      kind: 'literal',
      context: "state.stateRoot==='legacy'",
      reason: 'dated portability-plan rendering for its legacy option',
    },
  ]],
  ['research/axi-wave5-spec.html', [
    {
      kind: 'literal',
      context: "Phantom's equivalents",
      reason: 'historical research snapshot describing the former state location',
    },
  ]],
  ['scripts/migrate-data.js', [
    {
      kind: 'constructed',
      context: "path.join(os.homedir(), '.claude', 'phantom-data')",
      reason: 'copy-only source for migrating legacy state into the portable root',
    },
  ]],
]);

const DETECTORS = [
  {
    kind: 'literal',
    pattern: /\.claude\/phantom-data/g,
  },
  {
    kind: 'constructed',
    pattern: /path\.(?:join|resolve)\([^;\n]*['"]\.claude['"]\s*,\s*['"]phantom-data['"]\s*\)/g,
  },
  {
    kind: 'constructed-variable',
    pattern: /path\.(?:join|resolve)\([^;\n]*['"]\.claude['"][^;\n]*(?:PHANTOM_DATA_DIRNAME|DATA_DIRNAME)[^;\n]*\)/g,
  },
  {
    kind: 'shell-variable',
    pattern: /(?:\$HOME|\$\{HOME\})\/\.claude\/["']?\$\{?(?:PHANTOM_DATA_DIRNAME|DATA_DIRNAME)\}?["']?/g,
  },
];

function repositoryFiles() {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean)
    .filter(file => file !== SELF);
}

function lineAt(text, offset) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = text.indexOf('\n', offset);
  return text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
}

test('legacy provider-owned state roots remain only in explicit migration/history contexts', () => {
  const violations = [];
  const usage = new Map();

  for (const file of repositoryFiles()) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (text.includes('\0')) continue;

    for (const detector of DETECTORS) {
      detector.pattern.lastIndex = 0;
      for (const match of text.matchAll(detector.pattern)) {
        const line = lineAt(text, match.index);
        const entries = ALLOWLIST.get(file) || [];
        const allowed = entries.find(entry =>
          entry.kind === detector.kind && line.includes(entry.context),
        );

        if (!allowed) {
          const lineNumber = text.slice(0, match.index).split('\n').length;
          violations.push(`${file}:${lineNumber}: ${line.trim()}`);
          continue;
        }

        const key = `${file}\0${allowed.kind}\0${allowed.context}`;
        usage.set(key, (usage.get(key) || 0) + 1);
      }
    }
  }

  for (const [file, entries] of ALLOWLIST) {
    for (const entry of entries) {
      const key = `${file}\0${entry.kind}\0${entry.context}`;
      assert.equal(
        usage.get(key),
        1,
        `stale or ambiguous legacy allowlist entry: ${file} (${entry.reason})`,
      );
    }
  }

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
      text: "path.resolve(process.env.HOME, '.claude', 'phantom-data')",
    },
    {
      kind: 'constructed-variable',
      text: "path.join(os.homedir(), '.claude', DATA_DIRNAME)",
    },
    {
      kind: 'shell-variable',
      text: '$HOME/.claude/${PHANTOM_DATA_DIRNAME}',
    },
  ];

  for (const bypass of bypasses) {
    const detector = DETECTORS.find(candidate => candidate.kind === bypass.kind);
    detector.pattern.lastIndex = 0;
    assert.match(bypass.text, detector.pattern, `${bypass.kind} composition must be detected`);
  }
});
