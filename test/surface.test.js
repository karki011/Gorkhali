'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tierForRole, modelForTier } = require('../lib/tiers');
const root = path.join(__dirname, '..');
test('only MVP commands and roles are discoverable', () => {
  const commands = fs.readdirSync(path.join(root, 'commands')).filter((name) => !name.startsWith('_')).map((name) => name.replace('.md', '')).sort();
  assert.deepEqual(commands, ['close', 'learn', 'pause', 'resume', 'start', 'status', 'verify', 'wrap']);
  const roles = fs.readdirSync(path.join(root, 'agents')).map((name) => name.replace('.md', '')).sort();
  assert.deepEqual(roles, ['auditor', 'detective', 'engineer', 'inspector', 'opposition']);
  for (const role of roles) {
    const text = fs.readFileSync(path.join(root, 'agents', role + '.md'), 'utf8');
    assert.equal(text.match(/^model:\s*(\S+)/m)[1], modelForTier(tierForRole(role)));
  }
});
test('package and plugin versions agree on the breaking MVP release', () => {
  const plugin = require('../.claude-plugin/plugin.json');
  assert.equal(plugin.version, '3.0.0');
  assert.equal(require('../.claude-plugin/marketplace.json').metadata.version, plugin.version);
  assert.equal(require('../package.json').version, plugin.version);
});
test('tracked legacy sessions have been removed from the working tree', () => {
  const files = execFileSync('git', ['ls-files', '.gorkhali'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  assert.deepEqual(files.filter((file) => fs.existsSync(path.join(root, file))), []);
});
