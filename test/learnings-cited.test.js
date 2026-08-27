// Author: Subash Karki
// learnings-cited.test.js — sidecar + context.json citation store.
// Pins normalize/unique, sidecar create/merge, context merge/skip rules, and
// readSessionCited's three-source union. Requires the lib directly (same
// pattern as test/atomic.test.js); no mocks.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CITATION_FILE,
  normalizeKeyword,
  uniqueKeywords,
  readSessionCited,
  recordSessionCited,
} = require('../scripts/lib/learnings-cited');

function tmpSession() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'learnings-cited-'));
}

test('normalizeKeyword trims, strips surrounding brackets, lowercases', () => {
  assert.equal(normalizeKeyword('  [Alpha]  '), 'alpha');
  assert.equal(normalizeKeyword('[beta]'), 'beta');
  assert.equal(normalizeKeyword('Gamma'), 'gamma');
  assert.equal(normalizeKeyword('[]'), '');
  assert.equal(normalizeKeyword(null), '');
  assert.equal(normalizeKeyword(undefined), '');
});

test('uniqueKeywords is first-seen, skips empty, non-array yields []', () => {
  assert.deepEqual(uniqueKeywords(['[Alpha]', ' beta ', '[alpha]', '', 'Gamma', '[]']), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(uniqueKeywords(null), []);
  assert.deepEqual(uniqueKeywords('alpha'), []);
  assert.deepEqual(uniqueKeywords(undefined), []);
});

test('recordSessionCited creates a sidecar and merges on a second write', () => {
  const dir = tmpSession();
  recordSessionCited(dir, ['[Alpha]', 'beta']);
  const sidecar = JSON.parse(fs.readFileSync(path.join(dir, CITATION_FILE), 'utf8'));
  assert.equal(sidecar.schema_version, 1);
  assert.deepEqual(sidecar.learningsCited, ['alpha', 'beta']);

  recordSessionCited(dir, ['beta', 'gamma', 'alpha']);
  const merged = JSON.parse(fs.readFileSync(path.join(dir, CITATION_FILE), 'utf8'));
  assert.deepEqual(merged.learningsCited, ['alpha', 'beta', 'gamma']);
});

test('recordSessionCited merges onto existing context.json and evidence', () => {
  const dir = tmpSession();
  fs.writeFileSync(path.join(dir, 'context.json'), JSON.stringify({
    ticket: 'T-1',
    summary: 'fixture',
    source: 'args',
    evidence: { foo: 1 },
  }));
  recordSessionCited(dir, ['alpha']);
  const ctx = JSON.parse(fs.readFileSync(path.join(dir, 'context.json'), 'utf8'));
  assert.deepEqual(ctx.learningsCited, ['alpha']);
  assert.deepEqual(ctx.evidence.learningsCited, ['alpha']);
  assert.equal(ctx.evidence.foo, 1);
  assert.equal(ctx.ticket, 'T-1');
  const sidecar = JSON.parse(fs.readFileSync(path.join(dir, CITATION_FILE), 'utf8'));
  assert.deepEqual(sidecar.learningsCited, ['alpha']);
});

test('recordSessionCited does not create a missing context.json', () => {
  const dir = tmpSession();
  recordSessionCited(dir, ['alpha']);
  assert.equal(fs.existsSync(path.join(dir, 'context.json')), false);
  assert.equal(fs.existsSync(path.join(dir, CITATION_FILE)), true);
});

test('recordSessionCited leaves a corrupt context.json untouched and still writes the sidecar', () => {
  const dir = tmpSession();
  const corrupt = '{not-json';
  fs.writeFileSync(path.join(dir, 'context.json'), corrupt);
  recordSessionCited(dir, ['alpha']);
  assert.equal(fs.readFileSync(path.join(dir, 'context.json'), 'utf8'), corrupt);
  const sidecar = JSON.parse(fs.readFileSync(path.join(dir, CITATION_FILE), 'utf8'));
  assert.deepEqual(sidecar.learningsCited, ['alpha']);
});

test('readSessionCited unions sidecar then context then evidence', () => {
  const dir = tmpSession();
  fs.writeFileSync(path.join(dir, CITATION_FILE), JSON.stringify({
    schema_version: 1, learningsCited: ['alpha', 'beta'],
  }));
  fs.writeFileSync(path.join(dir, 'context.json'), JSON.stringify({
    learningsCited: ['beta', 'gamma'],
    evidence: { learningsCited: ['gamma', 'delta'] },
  }));
  assert.deepEqual(readSessionCited(dir), ['alpha', 'beta', 'gamma', 'delta']);
});

test('empty keywords are a no-op', () => {
  const dir = tmpSession();
  recordSessionCited(dir, ['', '[]', '   ']);
  assert.equal(fs.existsSync(path.join(dir, CITATION_FILE)), false);
  assert.equal(fs.existsSync(path.join(dir, 'context.json')), false);
});
