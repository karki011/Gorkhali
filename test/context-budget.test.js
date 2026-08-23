// Author: Subash Karki
// context-budget.test.js — regression guard for the token diet. Every byte in
// agents/*.md and commands/_shared*.md is paid on the host's context on every
// activation, and every command description sits in the permanent registry —
// this test is what stops the bloat from creeping back. Ceilings are each
// file's post-token-diet size plus ~5% headroom; when a legitimate addition
// needs more, raise THAT file's ceiling here with a note saying why.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(ROOT, 'agents');
const COMMANDS_DIR = path.join(ROOT, 'commands');

// Byte ceilings: post-token-diet size + ~5% headroom, hardcoded per file so a
// growing file names itself in the failure.
const AGENT_CEILINGS = {
  'advisor.md': 2120,
  'auditor.md': 4475,
  'chief.md': 10350,
  'clerk.md': 3830,
  'detective.md': 2590,
  'engineer.md': 7310,
  'inspector.md': 3010,
  'justice.md': 5540,
  'opposition.md': 6450,
  'steward.md': 4210,
  'surveyor.md': 2510,
};

const SHARED_CEILINGS = {
  '_shared-auto-learning.md': 1015,
  '_shared-brain.md': 1410,
  '_shared-contracts.md': 350,
  '_shared-detective.md': 3410,
  '_shared-discipline.md': 4560,
  '_shared-justice.md': 1030,
  '_shared-repo-detection.md': 2940,
  '_shared-shadows.md': 2900,
  '_shared.md': 11175,
};

// Command descriptions load into the host's permanent registry; 250 chars is
// the hard cap (the token diet brought every command under 200).
const DESCRIPTION_CHAR_CEILING = 250;

const bytes = (file) => fs.statSync(file).size;

function checkCeilings(dir, ceilings, t, filter = () => true) {
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.md') && filter(name)).sort();
  assert.deepEqual(
    files,
    Object.keys(ceilings).sort(),
    `${path.relative(ROOT, dir)} membership changed — add or remove the ceiling entry to match`,
  );
  for (const name of files) {
    const size = bytes(path.join(dir, name));
    const ceiling = ceilings[name];
    t.diagnostic(`${name}: ${size} / ${ceiling}`);
    assert.ok(
      size <= ceiling,
      `${path.relative(ROOT, dir)}/${name} grew to ${size} bytes; ceiling is ${ceiling}. `
        + 'Trim the file, or raise its ceiling in test/context-budget.test.js with a reason.',
    );
  }
}

test('agent definitions stay within their per-file byte budgets', (t) => {
  checkCeilings(AGENTS_DIR, AGENT_CEILINGS, t);
});

test('shared command preambles stay within their per-file byte budgets', (t) => {
  checkCeilings(COMMANDS_DIR, SHARED_CEILINGS, t, (name) => name.startsWith('_shared'));
});

test('every command frontmatter description stays under the registry cap', () => {
  const commands = fs.readdirSync(COMMANDS_DIR)
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .sort();
  assert.ok(commands.length > 0, 'expected command files');
  for (const name of commands) {
    const source = fs.readFileSync(path.join(COMMANDS_DIR, name), 'utf8');
    const match = source.match(/^description:\s*"(.*)"$/m) || source.match(/^description:\s*(.*)$/m);
    assert.ok(match, `commands/${name} must carry a frontmatter description`);
    assert.ok(
      match[1].length <= DESCRIPTION_CHAR_CEILING,
      `commands/${name} description is ${match[1].length} chars; cap is ${DESCRIPTION_CHAR_CEILING}. `
        + 'Tighten the wording, keeping its trigger keywords.',
    );
  }
});
