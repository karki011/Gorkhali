// Author: Subash Karki
// gen-schema-docs.test.js - the schema-doc drift gate. The failure class: the 10
// hand-written reference/schemas/*.md files silently drifting from the validator's
// schema. So: --check exits 0 on a clean tree, exits 2 (VALIDATION_ERROR) when a
// GENERATED field row is tampered, ignores hand-prose edits OUTSIDE the markers,
// and produces byte-identical output on repeat runs. Every mutation happens in a
// throwaway temp copy - the real reference/schemas/ tree is never touched.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { applyGeneratedBlock, renderBlock, SCHEMAS, BEGIN } = require('../scripts/gen-schema-docs');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'scripts', 'gen-schema-docs.js');
const REAL_DIR = path.join(REPO_ROOT, 'reference', 'schemas');

// A temp copy of the committed schemas dir - safe to tamper.
function mkSchemasCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-schema-'));
  fs.cpSync(REAL_DIR, dir, { recursive: true });
  return dir;
}

// Run the CLI; return { code, stdout, stderr }.
function cli(args) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf-8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: (e.stdout || '').toString(),
      stderr: (e.stderr || '').toString(),
    };
  }
}

function snapshot(dir) {
  const out = {};
  for (const type of Object.keys(SCHEMAS)) {
    out[`${type}.md`] = fs.readFileSync(path.join(dir, `${type}.md`), 'utf-8');
  }
  return out;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('--check on a clean tree exits 0', () => {
  const dir = mkSchemasCopy();
  try {
    const res = cli(['--check', '--dir', dir]);
    assert.equal(res.code, 0, `expected clean, stderr: ${res.stderr}`);
    assert.match(res.stdout, /in sync/);
  } finally {
    cleanup(dir);
  }
});

test('--check exits 2 (VALIDATION_ERROR) when a generated field row is tampered', () => {
  const dir = mkSchemasCopy();
  try {
    const file = path.join(dir, 'context.md');
    // "Ticket key or task label" lives inside the generated block.
    const tampered = fs.readFileSync(file, 'utf-8').replace('Ticket key or task label', 'TAMPERED');
    assert.ok(tampered.includes('TAMPERED'), 'precondition: the row was found and edited');
    fs.writeFileSync(file, tampered);

    const res = cli(['--check', '--dir', dir]);
    assert.equal(res.code, 2, 'drift must exit 2, not 1');
    assert.match(res.stderr, /out of date/);
    assert.match(res.stderr, /context\.md/);
  } finally {
    cleanup(dir);
  }
});

test('--check ignores hand-prose edits OUTSIDE the markers (marker boundary holds)', () => {
  const dir = mkSchemasCopy();
  try {
    const file = path.join(dir, 'wrap.md');
    // The Example block is hand-owned prose below the END marker.
    const edited = fs.readFileSync(file, 'utf-8').replace('**Example:**', '**Example:** (hand note)');
    fs.writeFileSync(file, edited);

    const res = cli(['--check', '--dir', dir]);
    assert.equal(res.code, 0, `prose outside the block is not owned; stderr: ${res.stderr}`);
  } finally {
    cleanup(dir);
  }
});

test('write preserves prose outside the block and re-syncs a tampered row', () => {
  const dir = mkSchemasCopy();
  try {
    const file = path.join(dir, 'context.md');
    const before = fs.readFileSync(file, 'utf-8');
    fs.writeFileSync(file, before.replace('Ticket key or task label', 'TAMPERED'));

    const res = cli(['--dir', dir]);
    assert.equal(res.code, 0);
    const after = fs.readFileSync(file, 'utf-8');
    assert.equal(after, before, 'write restores the canonical block byte-for-byte');
    assert.ok(after.includes('**Example:**'), 'hand prose survives the rewrite');
  } finally {
    cleanup(dir);
  }
});

test('generation is deterministic: two writes are byte-identical', () => {
  const dir = mkSchemasCopy();
  try {
    cli(['--dir', dir]);
    const first = snapshot(dir);
    cli(['--dir', dir]);
    const second = snapshot(dir);
    assert.deepEqual(second, first);
  } finally {
    cleanup(dir);
  }
});

test('applyGeneratedBlock is a fixpoint (idempotent) and deterministic', () => {
  const src = fs.readFileSync(path.join(REAL_DIR, 'plan.md'), 'utf-8');
  const fields = SCHEMAS.plan.fields;
  const once = applyGeneratedBlock(src, fields, 'plan.md');
  const twice = applyGeneratedBlock(once, fields, 'plan.md');
  assert.equal(twice, once, 'applying to its own output changes nothing');
  assert.equal(applyGeneratedBlock(src, fields, 'plan.md'), once, 'same input -> same output');
});

test('renderBlock wraps the table in BEGIN/END markers and escapes pipes', () => {
  const block = renderBlock(SCHEMAS.context.fields);
  assert.ok(block.startsWith(BEGIN));
  assert.match(block, /\| Field \| Type \| Required \| Description \|/);
  // The source enum type stores raw pipes; the render escapes them for Markdown.
  assert.match(block, /`"jira"` \\\| `"args"` \\\| `"branch"`/);
});
