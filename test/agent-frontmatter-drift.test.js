// Author: Subash Karki
// agent-frontmatter-drift.test.js — locks agents/*.md `model:` pins to
// skills/phantom/references/model-policy.json. Hand-editing a pin (or editing
// policy without regenerating) fails here, so the policy file stays the single
// source of truth. apex.md is exempt: it inherits the session model and carries
// no pin by design.
//
// Read-only: every assertion runs the generator in --check mode, which mutates
// nothing.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'gen-agent-frontmatter.js');
const { generate, MARKER_PREFIX } = require('../scripts/gen-agent-frontmatter');

test('every agents/*.md model pin equals the policy-resolved value', () => {
  const drifted = generate({ check: true }).files
    .filter((f) => f.status === 'drift')
    .map((f) => path.basename(f.file) + ': ' + (f.diff || []).join(' | '));
  assert.deepEqual(
    drifted,
    [],
    'frontmatter drifted from model-policy.json — run `node scripts/gen-agent-frontmatter.js`:\n' +
      drifted.join('\n')
  );
});

test('apex.md is exempt and carries no model pin', () => {
  const apex = generate({ check: true }).files.find((f) => path.basename(f.file) === 'apex.md');
  assert.equal(apex.status, 'exempt', 'apex must be exempt from generation');
  const frontmatter = fs.readFileSync(path.join(AGENTS_DIR, 'apex.md'), 'utf8').split('---')[1];
  assert.doesNotMatch(frontmatter, /^model:/m, 'apex must inherit the session model — no pin');
});

test('every non-exempt agent carries the generated-provenance marker', () => {
  for (const f of generate({ check: true }).files) {
    if (f.status === 'exempt') continue;
    const content = fs.readFileSync(f.file, 'utf8');
    assert.ok(
      content.includes(MARKER_PREFIX),
      path.basename(f.file) + ' must carry the "' + MARKER_PREFIX + '" provenance marker'
    );
  }
});

test('--check exits 0 in sync and mutates nothing', () => {
  const before = fs.readdirSync(AGENTS_DIR)
    .filter((n) => n.endsWith('.md'))
    .map((n) => fs.readFileSync(path.join(AGENTS_DIR, n), 'utf8'));
  execFileSync(process.execPath, [GENERATOR, '--check'], { encoding: 'utf8' });
  const after = fs.readdirSync(AGENTS_DIR)
    .filter((n) => n.endsWith('.md'))
    .map((n) => fs.readFileSync(path.join(AGENTS_DIR, n), 'utf8'));
  assert.deepEqual(after, before, '--check must not write');
});

test('a hand-edited pin makes --check fail with exit 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-frontmatter-'));
  fs.cpSync(AGENTS_DIR, dir, { recursive: true });
  const bladePath = path.join(dir, 'blade.md');
  fs.writeFileSync(
    bladePath,
    fs.readFileSync(bladePath, 'utf8').replace(/^model: .*$/m, 'model: haiku')
  );
  let status = 0;
  try {
    execFileSync(process.execPath, [GENERATOR, '--check', '--dir', dir], { encoding: 'utf8' });
  } catch (e) {
    status = e.status;
  }
  assert.equal(status, 1, 'a hand-edited pin must fail --check');
  const drift = generate({ check: true, dir }).files.filter((f) => f.status === 'drift');
  assert.equal(drift.length, 1, 'exactly the hand-edited file drifts');
  assert.equal(path.basename(drift[0].file), 'blade.md');
});

test('generation is idempotent — a second run writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-frontmatter-'));
  fs.cpSync(AGENTS_DIR, dir, { recursive: true });
  assert.equal(generate({ dir }).written, 0, 'checked-in frontmatter is already generated output');
  assert.equal(generate({ dir }).written, 0, 'second run must be a no-op');
});
