// Author: Subash Karki
// execution-schema.test.js — covers the typed Engineer->Chief completion boundary.
//
// The failure class: Blades returned free-text, Chief parsed it heuristically
// ("Engineer passed but Chief misread output"). The fix typed the per-task completion
// record by EXTENDING execution.json tasks[] with filesRead/testResult/blocker.
// These tests spawn the REAL hand-rolled validator (scripts/validate-artifact.js)
// and assert: new fields pass, omitting them still passes (backward compat),
// and malformed new fields fail.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-artifact.js');

const META = {
  writtenAt: '2026-06-03T00:00:00Z',
  gitHead: 'abc1234',
  gitBranch: 'main',
  phase: 'D',
  skill: 'gorkhali:execute',
  version: 1,
};

// Spawn the real validator: node scripts/validate-artifact.js execution <file>.
// Returns { code, stdout, stderr }.
function runValidator(artifact) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-schema-'));
  const file = path.join(dir, 'execution.json');
  fs.writeFileSync(file, JSON.stringify(artifact));
  try {
    const stdout = execFileSync('node', [VALIDATOR, 'execution', file], {
      encoding: 'utf-8',
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: (e.stdout || '').toString(),
      stderr: (e.stderr || '').toString(),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('execution: valid artifact WITH new typed fields passes', () => {
  const res = runValidator({
    _meta: META,
    tasks: [
      {
        id: 't1',
        status: 'done',
        filesChanged: ['src/a.ts'],
        filesRead: ['src/b.ts'],
        selfReviewScore: 9,
        testResult: { passed: true, summary: '5 tests green' },
        blocker: null,
        outputSummary: 'Did the thing.',
      },
      {
        id: 't2',
        status: 'done',
        filesChanged: ['src/c.ts'],
        testResult: 'snapshot test passes',
        outputSummary: 'Did another thing.',
      },
    ],
    totalSpawns: 2,
  });
  assert.equal(res.code, 0, `expected valid, got stderr: ${res.stderr}`);
  assert.ok(res.stdout.includes('is valid'), 'reports valid');
});

test('execution: omitting new optional fields still passes (backward compat)', () => {
  // The exact shape of a pre-feature artifact — no filesRead/testResult/blocker.
  const res = runValidator({
    _meta: META,
    tasks: [
      {
        id: 't1',
        status: 'done',
        filesChanged: ['src/a.ts'],
        selfReviewScore: 8,
        outputSummary: 'Added hook',
      },
    ],
    totalSpawns: 1,
  });
  assert.equal(res.code, 0, `old artifact must still validate, got stderr: ${res.stderr}`);
});

test('execution: blocker on a failed task passes (string blocker)', () => {
  const res = runValidator({
    _meta: META,
    tasks: [
      {
        id: 't1',
        status: 'failed',
        filesChanged: [],
        blocker: 'missing API contract for cost client',
        outputSummary: 'Could not complete — blocked.',
      },
    ],
    totalSpawns: 1,
  });
  assert.equal(res.code, 0, `failed+blocker must validate, got stderr: ${res.stderr}`);
});

test('execution: malformed filesRead (not array) fails', () => {
  const res = runValidator({
    _meta: META,
    tasks: [
      {
        id: 't1',
        status: 'done',
        filesChanged: ['src/a.ts'],
        filesRead: 'src/b.ts',
        outputSummary: 'x',
      },
    ],
    totalSpawns: 1,
  });
  assert.equal(res.code, 1, 'string filesRead must be rejected');
  assert.ok(res.stderr.includes('filesRead'), `error names the field. stderr: ${res.stderr}`);
});

test('execution: malformed testResult object (missing passed) fails', () => {
  const res = runValidator({
    _meta: META,
    tasks: [
      {
        id: 't1',
        status: 'done',
        filesChanged: ['src/a.ts'],
        testResult: { summary: 'ran some tests' },
        outputSummary: 'x',
      },
    ],
    totalSpawns: 1,
  });
  assert.equal(res.code, 1, 'object testResult without boolean passed must be rejected');
  assert.ok(res.stderr.includes('testResult.passed'), `error names the field. stderr: ${res.stderr}`);
});

test('execution: malformed blocker (number) fails', () => {
  const res = runValidator({
    _meta: META,
    tasks: [
      {
        id: 't1',
        status: 'done',
        filesChanged: ['src/a.ts'],
        blocker: 42,
        outputSummary: 'x',
      },
    ],
    totalSpawns: 1,
  });
  assert.equal(res.code, 1, 'numeric blocker must be rejected');
  assert.ok(res.stderr.includes('blocker'), `error names the field. stderr: ${res.stderr}`);
});
