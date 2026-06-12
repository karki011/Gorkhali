#!/usr/bin/env node
// Author: Subash Karki
// routing-gate.js — PreToolUse hook that denies implementation edits in
// phantom-known repos when no phantom session is active.
//
// INVERSE POLARITY — read this before editing: this is an opt-in DISCIPLINE
// gate, NOT a safety gate. It FAILS OPEN: any crash, missing config, garbage
// config, or ambiguity in the enforce branch must ALLOW the edit. This is the
// exact opposite of unattended-guard's fail-closed safety polarity. A missing
// or unparseable config can NEVER enable the gate (enforce defaults to false,
// and only the literal `true` arms it). Always exits 0 — the decision rides
// the stdout JSON.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let phantomData, stateDir;
try {
  ({ phantomData, stateDir } = require('../scripts/lib/phantom-paths'));
} catch (_) {
  // fail open: inline fallback matching phantom-paths.js logic
  phantomData = () => process.env.PHANTOM_DATA || path.join(os.homedir(), '.claude', 'phantom-data');
  stateDir = () => path.join(phantomData(), 'state');
}

let readFlag = null;
try {
  ({ readFlag } = require('../scripts/lib/config-lite'));
} catch (_) {
  // config reader unavailable → gate can never arm (fail open)
}

// SHARED SEMANTICS — keep identical in hooks/router-nudge.js: a phantom
// session is active when <PHANTOM_DATA>/.apex-active exists AND its mtime is
// younger than 24h. A stale marker left by a crashed session must NOT
// silently disable routing — older than 24h is treated as absent.
const APEX_MARKER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sessionActive() {
  try {
    const marker = path.join(phantomData(), '.apex-active');
    if (!fs.existsSync(marker)) return false;
    return Date.now() - fs.statSync(marker).mtimeMs < APEX_MARKER_MAX_AGE_MS;
  } catch (_) {
    return false;
  }
}

// Resolve symlinks via the nearest EXISTING ancestor, then re-join the
// not-yet-existing tail — write targets usually don't exist yet.
// (Same approach as unattended-guard.js.)
function realResolve(p) {
  let dir = p;
  const rest = [];
  while (!fs.existsSync(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) return p; // hit fs root without an existing ancestor
    rest.unshift(path.basename(dir));
    dir = parent;
  }
  return path.join(fs.realpathSync(dir), ...rest);
}

function within(target, root) {
  return target === root || target.startsWith(root + path.sep);
}

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (_) {
    return; // unparseable stdin → allow
  }

  // Cheapest check first (existsSync+stat only, before any config read):
  // live phantom session → routing requirement is satisfied.
  if (sessionActive()) return;

  // Opt-in only: anything other than an explicit routing.enforce: true → no-op.
  if (!readFlag || readFlag('routing', 'enforce', false) !== true) return;

  // ── Enforce branch: every error path below ALLOWS (fail open). ──
  try {
    const toolInput = payload.tool_input || {};
    const rawTarget = toolInput.file_path || toolInput.path || null;
    const cwd = payload.cwd || process.cwd();

    // Logged escape hatch for deliberate ad-hoc work.
    if (process.env.PHANTOM_ADHOC === '1') {
      try {
        fs.mkdirSync(stateDir(), { recursive: true });
        fs.appendFileSync(
          path.join(stateDir(), 'routing-bypass.jsonl'),
          JSON.stringify({ ts: new Date().toISOString(), file: rawTarget, cwd }) + '\n'
        );
      } catch (_) { /* logging failure must not block the bypass */ }
      return;
    }

    if (!rawTarget) return; // no resolvable target → allow

    const target = realResolve(path.isAbsolute(rawTarget) ? rawTarget : path.resolve(cwd, rawTarget));

    // Phantom's own data tree is never gated.
    if (within(target, realResolve(phantomData()))) return;

    // Walk up from the target dir to the repo boundary. W8: `.git` may be a
    // FILE (worktree pointer) or a DIRECTORY — both count; existsSync covers
    // both. Repo name = basename of the dir containing `.git`.
    let dir = path.dirname(target);
    let repoName = null;
    while (true) {
      if (fs.existsSync(path.join(dir, '.git'))) { repoName = path.basename(dir); break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!repoName) return; // not inside a repo → not phantom's business

    // Gate covers ONLY phantom-known repos (a <data>/repos/<name> dir exists).
    if (!fs.existsSync(path.join(phantomData(), 'repos', repoName))) return;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'ROUTING GATE: implementation edit outside a phantom session — run ' +
          '/phantom:start <ticket>, or set PHANTOM_ADHOC=1 for ad-hoc work ' +
          '(logged). See reference/routing.md',
      },
    }));
  } catch (_) {
    // fail OPEN — a discipline gate never blocks on its own bugs
  }
}

try {
  main();
} catch (_) { /* fail open */ }
process.exit(0);
