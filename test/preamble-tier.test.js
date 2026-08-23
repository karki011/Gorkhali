// Author: Subash Karki
// preamble-tier.test.js — kills the three-copy tier drift. The tier registry
// lived in scripts/preamble-tier.js, the _shared.md Preamble Tiers table, and
// 29 command blockquotes, and they had already drifted apart (T2 blockquotes
// omitting _shared-auto-learning.md, a 'note' command with no file). The
// registry in preamble-tier.js is canonical; this test pins the other two
// renderings to it.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const COMMANDS_DIR = path.join(REPO_ROOT, 'commands');
const { TIERS } = require('../scripts/preamble-tier');

const TIER_KEYS = Object.keys(TIERS);

// The ONE blockquote shape per tier. Blockquotes carry no file lists (the
// drift vector); the conditional detective load is behavior, not a list copy.
const CANONICAL_BLOCKQUOTE = {
  T1: '> **Preamble Tier: T1** — loads `_shared.md` only (canonical registry: `scripts/preamble-tier.js`)',
  T2: '> **Preamble Tier: T2** — shared contexts per the canonical registry (`scripts/preamble-tier.js`); `_shared-detective.md` also loads on the detective trigger',
  T3: '> **Preamble Tier: T3** — shared contexts per the canonical registry (`scripts/preamble-tier.js`)',
  T4: '> **Preamble Tier: T4** — loads ALL shared contexts (canonical registry: `scripts/preamble-tier.js`)',
};

function commandFiles() {
  return fs.readdirSync(COMMANDS_DIR)
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .map((name) => name.replace(/\.md$/, ''))
    .sort();
}

function registryCommands() {
  return TIER_KEYS.flatMap((key) => TIERS[key].commands).sort();
}

test('the registry covers exactly the commands that exist, once each', () => {
  assert.deepEqual(
    registryCommands(),
    commandFiles(),
    'preamble-tier.js commands must equal commands/*.md (no gorkhali entries, none missing, none twice)',
  );
});

test('every registry shared-context file exists under commands/', () => {
  for (const key of TIER_KEYS) {
    for (const file of TIERS[key].sharedContexts) {
      assert.ok(
        fs.existsSync(path.join(COMMANDS_DIR, file)),
        `${key} names ${file}, which does not exist`,
      );
    }
  }
});

test('every command blockquote is the canonical rendering of its registry tier', () => {
  for (const key of TIER_KEYS) {
    for (const command of TIERS[key].commands) {
      const content = fs.readFileSync(path.join(COMMANDS_DIR, `${command}.md`), 'utf8');
      const lines = content.split('\n').filter((l) => l.includes('Preamble Tier:'));
      assert.equal(lines.length, 1, `commands/${command}.md must carry exactly one Preamble Tier line`);
      assert.equal(
        lines[0],
        CANONICAL_BLOCKQUOTE[key],
        `commands/${command}.md blockquote drifted from the canonical ${key} form`,
      );
    }
  }
});

function tableRow(content, tierKey) {
  const line = content.split('\n').find((l) => l.startsWith(`| **${tierKey}**`));
  assert.ok(line, `_shared.md Preamble Tiers table must carry a ${tierKey} row`);
  return line;
}

test('the _shared.md tier table renders the registry (commands and context files)', () => {
  const content = fs.readFileSync(path.join(COMMANDS_DIR, '_shared.md'), 'utf8');
  for (const key of TIER_KEYS) {
    const row = tableRow(content, key);
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    assert.equal(cells.length, 3, `${key} row must have Tier/Commands/Shared Contexts cells`);
    const tableCommands = cells[1].split(',').map((c) => c.trim()).sort();
    assert.deepEqual(
      tableCommands,
      [...TIERS[key].commands].sort(),
      `_shared.md ${key} row command list drifted from the registry`,
    );
    const tableFiles = [...cells[2].matchAll(/`(_shared[^`]*\.md)`/g)].map((m) => m[1]);
    const registryFiles = [
      ...TIERS[key].sharedContexts,
      ...(TIERS[key].conditionalContexts || []).map((c) => c.split(' ')[0]),
    ];
    assert.deepEqual(
      tableFiles,
      registryFiles,
      `_shared.md ${key} row context files drifted from the registry`,
    );
  }
});
