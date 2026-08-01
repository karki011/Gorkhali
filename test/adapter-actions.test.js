// Author: Subash Karki
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'skills');
const ACTIONS = [
  'brainstorm', 'close', 'contract', 'eval', 'evolve', 'execute', 'fix',
  'greploop', 'grill', 'health', 'hound', 'learn', 'loop', 'pause', 'recruit',
  'resume', 'review', 'scout', 'sessions', 'start', 'status', 'validate',
  'verify', 'visual', 'visualflow', 'wire', 'wrap',
];

test('public action registry and discovered skills stay in exact parity', () => {
  const discovered = fs.readdirSync(SKILLS)
    .filter((entry) => entry !== 'phantom')
    .filter((entry) => fs.existsSync(path.join(SKILLS, entry, 'SKILL.md')))
    .sort();
  assert.deepEqual(discovered, [...ACTIONS].sort());
});

test('every public action is a direct first-class portable entrypoint', () => {
  for (const action of ACTIONS) {
    const file = path.join(SKILLS, action, 'SKILL.md');
    const content = fs.readFileSync(file, 'utf8');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, `${action} is missing frontmatter`);
    assert.match(frontmatter[1], new RegExp(`^name: ${action}$`, 'm'));
    assert.ok(content.includes('Read `../phantom/SKILL.md` completely'));
    assert.ok(content.includes('Portable action: `' + action + '`.'));
    assert.doesNotMatch(content, /route chained|another skill|delegated command|compatibility/i);
  }
});
