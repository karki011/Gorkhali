#!/usr/bin/env node
// Author: Subash Karki
// routing-gate.js — PreToolUse hook that denies implementation edits in
// Git repositories when no matching portable Gorkhali session is active.
//
// FAIL-OPEN POLARITY — read this before editing: this is an opt-in DISCIPLINE
// gate, NOT a safety gate. It FAILS OPEN: any crash or ambiguity in the enforce
// branch must ALLOW the edit. The gate is armed ONLY by the env var
// GORKHALI_ROUTING_ENFORCE=1; with it unset (the default) the gate is a no-op.
// Always exits 0 — the decision rides the stdout JSON.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let gorkhaliData, stateDir, detectRepo, resolveRepoSubdir, routingState;
try {
  ({ gorkhaliData, stateDir, detectRepo, resolveRepoSubdir } = require('../scripts/lib/gorkhali-paths'));
  ({ routingState } = require('../scripts/lib/routing-state'));
} catch (_) {
  // fail open: inline fallback matching gorkhali-paths.js logic
  const home = os.homedir();
  const data = process.env.GORKHALI_DATA ||
    (home ? path.join(home, '.gorkhali') : path.join(process.cwd(), '.gorkhali'));
  gorkhaliData = () => data;
  stateDir = () => path.join(gorkhaliData(), 'state');
  detectRepo = null;
  resolveRepoSubdir = null;
  routingState = null;
}

// Resolve symlinks via the nearest EXISTING ancestor, then re-join the
// not-yet-existing tail — write targets usually don't exist yet.
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

  // Opt-in only: armed solely by GORKHALI_ROUTING_ENFORCE=1 → otherwise no-op.
  if (process.env.GORKHALI_ROUTING_ENFORCE !== '1') return;

  // ── Enforce branch: every error path below ALLOWS (fail open). ──
  try {
    const toolInput = payload.tool_input || {};
    const rawTarget = toolInput.file_path || toolInput.path || null;
    const cwd = payload.cwd || process.cwd();

    // Logged escape hatch for deliberate ad-hoc work.
    if (process.env.GORKHALI_ADHOC === '1') {
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

    // Gorkhali's own data tree is never gated.
    if (within(target, realResolve(gorkhaliData()))) return;

    // Walk up from the target dir to the repo boundary. W8: `.git` may be a
    // FILE (worktree pointer) or a DIRECTORY — both count; existsSync covers
    // both.
    let dir = path.dirname(target);
    let repoRoot = null;
    while (true) {
      if (fs.existsSync(path.join(dir, '.git'))) { repoRoot = dir; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!repoRoot) return; // not inside a repo → not gorkhali's business

    // Preserve the existing Gorkhali-known scope unless the operator explicitly
    // opts into all Git repositories. Missing hook code and operational read
    // failures are gate failures and therefore allow the edit.
    if (!detectRepo || !resolveRepoSubdir || !routingState) return;
    const repo = detectRepo(repoRoot);
    const known = fs.existsSync(resolveRepoSubdir(repo));
    if (!known && process.env.GORKHALI_ROUTING_SCOPE !== 'all-git') return;
    const state = routingState(repoRoot);
    if (state === 'active' || state === 'unknown') return;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'ROUTING GATE: implementation edit outside a matching Gorkhali session — invoke ' +
          'gorkhali:start, or set GORKHALI_ADHOC=1 for ad-hoc work ' +
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
