// Author: Subash Karki
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('the optional Phantom Lens agent ships with only its private protocols', () => {
  for (const file of [
    'agents/lens.md',
    'reference/agent-protocols/smart-auth.md',
    'reference/agent-protocols/visual-protocol.md',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), true, `${file} must be shipped`);
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'reference/smart-auth.md')), false);
});

test('visual verification defaults to the user and activates Lens only explicitly', () => {
  const command = read('commands/visual.md');
  const adapter = read('skills/visual/SKILL.md');

  assert.match(command, /user checklist by default/i);
  assert.match(command, /only when.*--lens.*affirmatively.*run, use, or invoke Phantom Lens/is);
  assert.match(command, /Merely naming,\s+asking about, or negating Lens.*do not use Phantom Lens.*does not\s+activate it/is);
  assert.match(command, /exactly one read-only Lens named `lens-yara`/i);
  assert.match(command, /do not create a\s+review specialist artifact/i);
  assert.match(command, /never replaces explicit user\s+confirmation/i);
  assert.doesNotMatch(command, /--autonomous/i);
  assert.match(command, /There is no autonomous mode, code modification, or visual fix\s+loop/i);
  assert.match(command, /reference\/agent-protocols\/visual-protocol\.md/);
  assert.match(command, /keep this Lens request pending\s+until the user supplies the exact Dev URL/i);
  assert.match(adapter, /Do not invoke Lens unless the user explicitly requests it/i);
  assert.match(adapter, /never replaces the checklist confirmation or becomes a ship gate/i);
});

test('Lens is registered for explicit delegation but cannot auto-route or gate shipping', () => {
  const policy = JSON.parse(read('skills/phantom/references/model-policy.json'));
  assert.equal(policy.roles.lens, 'balanced');
  assert.equal(policy.critical_elevation.eligible_roles.includes('lens'), true);

  for (const file of ['commands/start.md', 'commands/verify.md']) {
    assert.doesNotMatch(read(file), /subagent_type:\s*["']?lens|spawn.*\bLens\b/i,
      `${file} must not auto-route Lens`);
  }

  const roster = read('reference/roster.md');
  assert.match(roster, /^\| lens \|/im);
  assert.match(roster, /`visual\.md` \| Explicit `--lens` advisory inspection/i);
  assert.doesNotMatch(roster, /\| `visual\.md` \|.*Visual Fix Loop|blade-brakka/i);

  const agent = read('agents/lens.md');
  assert.match(agent, /advisory, read-only inspector/i);
  assert.match(agent, /never edits code.*or becomes a verification, review, shipping,\s+or completion prerequisite/is);
  assert.match(agent, /user must still confirm\s+the UI/i);
  assert.match(agent, /canonical current worktree path and exact Git branch/i);
  assert.match(agent, /request the exact URL through the caller/i);
  assert.match(agent, /keep the inspection\s+pending/i);

  const protocol = read('reference/agent-protocols/visual-protocol.md');
  assert.match(protocol, /http:\/\/localhost:3333/);
  assert.match(protocol, /exact canonical worktree path first/i);
  assert.match(protocol, /exact branch match that identifies\s+exactly one card/i);
  assert.match(protocol, /follow only its displayed Dev link/i);
  assert.match(protocol, /manager is unavailable.*card is absent or ambiguous.*no\s+running Dev link.*ask through the caller for the exact URL/is);
  assert.match(protocol, /Never click Start\/Restart Dev,\s+guess a port, or select a different worktree/i);

  const state = read('skills/phantom/scripts/phantom-state.mjs');
  assert.match(state, /SPECIALIST_ROLES\s*=\s*new Set\(\['archer'\]\)/);
  assert.doesNotMatch(state, /SPECIALIST_ROLES[^;]*lens/i);
});
