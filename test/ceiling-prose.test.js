// Author: Subash Karki
// ceiling-prose.test.js — pins two invariants:
// NEGATIVE: no file in commands/ reference/ agents/ templates/ contains a
//   "max 3 fix attempts"-class phrase for the verify/fix loop (oracle/sage
//   budget mentions excluded by context).
// POSITIVE: scripts/lib/constants.js FIX_LOOP_CEILING default is 2, and
//   reference/temperature-review.md contains the canonical
//   "fix-loop ceiling is 2" statement.
// Zero external deps: node:test + node:assert only.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// Dirs scanned by the negative check.
const SCAN_DIRS = ['commands', 'reference', 'agents', 'templates'];

// Matches the ceiling-prose pattern: "max 3 fix attempts" class.
// Uses git grep for correct .gitignore / binary-skip behaviour.
function gitGrep(pattern, dirs) {
  try {
    const output = execFileSync(
      'git',
      ['grep', '-nEi', pattern, '--', ...dirs],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return output.trim().split('\n').filter(Boolean);
  } catch (err) {
    // git grep exits 1 when no matches — that is the success case here.
    if (err.status === 1) return [];
    throw err;
  }
}

test('NEGATIVE: no "max 3 fix attempts"-class phrase in prose (oracle/sage context excluded)', () => {
  // Pattern: max/maximum followed by optional gap then 3/three then fix/attempt(s)
  // OR: fix then 3/three then attempt(s)
  const raw = gitGrep(
    'max(imum)?\\s+(3|three)\\s+(fix|attempt)|fix.{0,12}(3|three).{0,12}attempt',
    SCAN_DIRS
  );

  // Allowed exclusions: sage/oracle budget lines use a distinct counter.
  const stragglers = raw.filter(line => {
    const lower = line.toLowerCase();
    // Exclude sage/oracle budget context
    if (lower.includes('oracle') || lower.includes('sage')) return false;
    return true;
  });

  assert.deepEqual(
    stragglers,
    [],
    `Found straggler "max 3 fix attempts"-class phrases outside allowed contexts:\n${stragglers.join('\n')}`
  );
});

test('POSITIVE: scripts/lib/constants.js FIX_LOOP_CEILING default is 2', () => {
  const CONSTANTS_PATH = require.resolve('../scripts/lib/constants');
  // Clear cache so env overrides from other tests don't leak.
  const saved = process.env.PHANTOM_FIX_LOOP_CEILING;
  delete process.env.PHANTOM_FIX_LOOP_CEILING;
  delete require.cache[CONSTANTS_PATH];
  let C;
  try {
    C = require(CONSTANTS_PATH);
  } finally {
    delete require.cache[CONSTANTS_PATH];
    if (saved === undefined) delete process.env.PHANTOM_FIX_LOOP_CEILING;
    else process.env.PHANTOM_FIX_LOOP_CEILING = saved;
  }
  assert.equal(C.FIX_LOOP_CEILING, 2, 'FIX_LOOP_CEILING default must be 2');
});

test('POSITIVE: reference/temperature-review.md contains canonical "fix-loop ceiling is 2" statement', () => {
  const docPath = path.join(REPO_ROOT, 'reference', 'temperature-review.md');
  const content = fs.readFileSync(docPath, 'utf8');
  // The canonical phrase lives in the Fix-Loop Ceiling section.
  assert.ok(
    /fix-loop ceiling is (owned by|2)/i.test(content),
    'reference/temperature-review.md must contain the canonical fix-loop ceiling statement'
  );
  // Also verify the specific "default 2" claim is present.
  assert.ok(
    /default\s+2/i.test(content),
    'reference/temperature-review.md must state the default is 2'
  );
});
