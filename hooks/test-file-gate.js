#!/usr/bin/env node
// Author: Subash Karki
// test-file-gate.js — PreToolUse: during an active fix, deny edits to test
// files so the agent cannot weaken the check it is supposed to satisfy.
//
// Armed only when `{SESSION_DIR}/fix-active` exists. Unknown session, missing
// marker, non-test path, or unparseable stdin → allow. Always exits 0; deny
// rides stdout JSON. GORKHALI_FIX_TESTS=1 is a logged override.
'use strict';

const fs = require('fs');
const path = require('path');

let activeSessionDir;
let classifyPath;
try {
  ({ activeSessionDir } = require('../scripts/lib/routing-state'));
  ({ classifyPath } = require('../scripts/lib/test-companion'));
} catch (_) {
  process.exit(0);
}

function readPayload() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (_) {
    return null;
  }
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

function main() {
  const payload = readPayload();
  if (!payload) return;

  const toolInput = payload.tool_input || {};
  const rawTarget = toolInput.file_path || toolInput.path || null;
  if (!rawTarget) return;

  const cwd = payload.cwd || process.cwd();
  const relative = path.isAbsolute(rawTarget)
    ? path.relative(cwd, rawTarget)
    : rawTarget;
  if (classifyPath(relative) !== 'test' && classifyPath(String(rawTarget).replace(/\\/g, '/')) !== 'test') {
    return;
  }

  const sessionDir = activeSessionDir(cwd);
  if (!sessionDir) return;
  if (!fs.existsSync(path.join(sessionDir, 'fix-active'))) return;

  if (process.env.GORKHALI_FIX_TESTS === '1') {
    try {
      const { stateDir } = require('../scripts/lib/gorkhali-paths');
      fs.mkdirSync(stateDir(), { recursive: true });
      fs.appendFileSync(
        path.join(stateDir(), 'fix-test-bypass.jsonl'),
        JSON.stringify({ ts: new Date().toISOString(), file: rawTarget, cwd }) + '\n',
      );
    } catch (_) { /* logging must not block the override */ }
    return;
  }

  deny(
    'FIX GATE: do not edit test files while repairing a known failure. Fix the code, not the test. Set GORKHALI_FIX_TESTS=1 to override (logged).',
  );
}

try {
  main();
} catch (_) {
  // fail open
}
process.exit(0);
