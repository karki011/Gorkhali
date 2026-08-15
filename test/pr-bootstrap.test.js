// Author: Subash Karki
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const TOKEN = '{PR_BOOTSTRAP}';
// The canonical, un-guarded bootstrap line defined once in commands/_shared.md
// (the 8 checkpoint literals in start/execute/resume use a deliberately different
// PR="${PR:-...}" guarded shape, pinned by test/portable-skill.test.js — not this line).
const CANONICAL_LINE =
  'PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"';

const SKIP_DIRS = new Set(['.git', '.claude', 'node_modules']);

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function countOccurrences(text, token) {
  return text.split(token).length - 1;
}

test('the {PR_BOOTSTRAP} token appears only in files under commands/', () => {
  const self = path.relative(REPO_ROOT, __filename);
  for (const file of listFiles(REPO_ROOT)) {
    const rel = path.relative(REPO_ROOT, file);
    if (rel === self) continue; // this test file cites the token by name, not a leak
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (_) {
      continue; // unreadable (e.g. binary) — not a text leak
    }
    if (content.includes(TOKEN)) {
      assert.ok(
        rel.startsWith(`commands${path.sep}`),
        `${TOKEN} must appear only under commands/, found in ${rel}`
      );
    }
  }
});

test('the canonical bootstrap line exists exactly once in commands/_shared.md', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'commands', '_shared.md'), 'utf8');
  assert.equal(
    countOccurrences(content, CANONICAL_LINE),
    1,
    'commands/_shared.md must define the canonical bootstrap line exactly once'
  );
});

test('zero {PR_BOOTSTRAP} occurrences under skills/ and templates/', () => {
  for (const dir of ['skills', 'templates']) {
    const root = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(root)) continue;
    for (const file of listFiles(root)) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch (_) {
        continue;
      }
      assert.equal(
        countOccurrences(content, TOKEN),
        0,
        `${path.relative(REPO_ROOT, file)} must not contain ${TOKEN}`
      );
    }
  }
});
