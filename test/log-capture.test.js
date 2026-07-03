// Author: Subash Karki
// log-capture.test.js - bounded-summary + full-log capture tests.
// Real fs/child_process, no mocks: node:test + node:assert + node:fs + node:os
// + node:path + node:child_process.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MODULE_PATH = require.resolve('../scripts/lib/log-capture');
const { captureOutput, headTailTruncate, suggestGrepPattern, MAX_CHARS, HEAD_LINES, DEFAULT_TAIL_LINES } = require(MODULE_PATH);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'log-capture-test-'));
}

function bigLines(count) {
  return Array.from({ length: count }, (_, i) => `line-${i}`).join('\n');
}

// ── headTailTruncate ─────────────────────────────────────────────────────────

test('headTailTruncate: small input passes through untruncated', () => {
  const input = 'hello\nworld';
  const { summary, truncated } = headTailTruncate(input);
  assert.equal(truncated, false);
  assert.equal(summary, input);
});

test('headTailTruncate: big input keeps head+tail and drops the middle', () => {
  const input = bigLines(HEAD_LINES + DEFAULT_TAIL_LINES + 500);
  const { summary, truncated } = headTailTruncate(input);
  assert.equal(truncated, true);
  assert.ok(summary.includes('line-0'), 'keeps the first head line');
  assert.ok(summary.includes(`line-${HEAD_LINES + DEFAULT_TAIL_LINES + 499}`), 'keeps the last tail line');
  assert.ok(!summary.includes('line-1000'), 'omits the middle');
  assert.ok(summary.length <= MAX_CHARS, 'stays under the char budget');
});

test('headTailTruncate: opts.headLines/tailLines override the defaults', () => {
  const input = bigLines(100);
  const { summary, truncated } = headTailTruncate(input, { headLines: 2, tailLines: 3 });
  assert.equal(truncated, true);
  assert.ok(summary.includes('line-0') && summary.includes('line-1'));
  assert.ok(summary.includes('line-97') && summary.includes('line-98') && summary.includes('line-99'));
  assert.ok(!summary.includes('line-50'), 'middle is omitted under the tighter budget');
});

test('headTailTruncate: hard char cap trims further and keeps the tail', () => {
  const input = 'x'.repeat(50000);
  const { summary, truncated } = headTailTruncate(input, { maxChars: 100, headLines: 1, tailLines: 1 });
  assert.equal(truncated, true);
  assert.ok(summary.endsWith('x'.repeat(100)), 'tail wins under the char cap');
  assert.ok(summary.length <= 100 + 60, 'result stays close to the requested cap');
});

// ── suggestGrepPattern ───────────────────────────────────────────────────────

test('suggestGrepPattern: picks the first hint keyword present', () => {
  assert.equal(suggestGrepPattern('build ok\nFATAL Error: boom\nexiting'), 'error');
  assert.equal(suggestGrepPattern('everything is fine'), 'error|fail');
});

// ── captureOutput ────────────────────────────────────────────────────────────

test('captureOutput: small input - no file written, no hint appended', () => {
  const dir = tmpDir();
  const input = 'all good\nno issues';
  const result = captureOutput(input, { label: 'unit-small', dir });
  assert.equal(result.truncated, false);
  assert.equal(result.summary, input);
  assert.equal(result.fullLogPath, null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('captureOutput: big input - full log saved at mode 0600, grep hint points at it', () => {
  const dir = tmpDir();
  const lines = Array.from({ length: HEAD_LINES + DEFAULT_TAIL_LINES + 500 }, (_, i) => `line-${i}`);
  lines.splice(300, 0, 'FATAL ERROR: build failed');
  const input = lines.join('\n');

  const result = captureOutput(input, { label: 'unit-big', dir });

  assert.equal(result.truncated, true);
  assert.ok(result.fullLogPath, 'full log path is returned');
  assert.ok(fs.existsSync(result.fullLogPath), 'full log file exists on disk');
  assert.equal(fs.readFileSync(result.fullLogPath, 'utf8'), input, 'full log preserves the untruncated output');

  const mode = fs.statSync(result.fullLogPath).mode & 0o777;
  assert.equal(mode, 0o600, 'full log file is written at mode 0600');

  assert.ok(result.summary.includes(`full log: ${result.fullLogPath}`), 'hint names the saved file');
  assert.match(result.summary, /grep -n '.+' for details/, 'hint suggests a grep pattern');
});

test('captureOutput: fail-open on a broken save dir still returns a summary', () => {
  // A file (not a dir) at the target path makes mkdirSync fail - captureOutput
  // must still return the truncated summary, just without a full log path.
  const parent = tmpDir();
  const blockedDir = path.join(parent, 'blocked');
  fs.writeFileSync(blockedDir, 'not a directory');

  const input = bigLines(HEAD_LINES + DEFAULT_TAIL_LINES + 50);
  const result = captureOutput(input, { label: 'unit-fail-open', dir: blockedDir });

  assert.equal(result.truncated, true);
  assert.equal(result.fullLogPath, null);
  assert.match(result.summary, /full log unavailable/);
});

// ── CLI harness ──────────────────────────────────────────────────────────────

function runCli(input, extraArgs = []) {
  return execFileSync(process.execPath, [MODULE_PATH, ...extraArgs], { input, encoding: 'utf8' });
}

test('CLI: small input passes through unchanged', () => {
  const dir = tmpDir();
  const out = runCli('hello\nworld', ['--label', 'cli-small', '--dir', dir]);
  assert.equal(out.trim(), 'hello\nworld');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('CLI: big input is truncated, saves a 0600 full log, and always exits 0', () => {
  const dir = tmpDir();
  const lines = Array.from({ length: HEAD_LINES + DEFAULT_TAIL_LINES + 500 }, (_, i) => `line-${i}`);
  lines.splice(300, 0, 'Exception: something broke');
  const input = lines.join('\n');

  let code = 0;
  let out = '';
  try {
    out = runCli(input, ['--label', 'cli-big', '--dir', dir]);
  } catch (err) {
    code = typeof err.status === 'number' ? err.status : 1;
  }

  assert.equal(code, 0, 'the CLI never exits non-zero, even on truncation');
  assert.match(out, /full log: /);
  assert.match(out, /grep -n '/);

  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  const mode = fs.statSync(path.join(dir, files[0])).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('CLI: --tail override shrinks the tail window', () => {
  const dir = tmpDir();
  const input = bigLines(100);
  const out = runCli(input, ['--label', 'cli-tail', '--dir', dir, '--tail', '3']);
  assert.ok(out.includes('line-97') && out.includes('line-98') && out.includes('line-99'));
  assert.ok(!out.includes('line-90'), 'tail window shrunk to 3 lines');
});

test('CLI: never throws through the pipe on garbage/binary-ish stdin', () => {
  const dir = tmpDir();
  const garbage = Buffer.from([0, 1, 2, 255, 254, 253]).toString('binary').repeat(5000);
  let code = 0;
  try {
    runCli(garbage, ['--label', 'cli-garbage', '--dir', dir]);
  } catch (err) {
    code = typeof err.status === 'number' ? err.status : 1;
  }
  assert.equal(code, 0, 'garbage input still exits 0 - pipefail integrity relies on this');
});
