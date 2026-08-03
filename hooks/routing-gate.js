#!/usr/bin/env node
// Author: Subash Karki
// routing-gate.js — PreToolUse hook that denies implementation edits in
// phantom-known repos when no phantom session is active.
//
// FAIL-OPEN POLARITY — read this before editing: this is a DISCIPLINE gate, NOT
// a safety gate. It FAILS OPEN: any crash or ambiguity in the enforce branch must
// ALLOW the edit. Always exits 0 — the decision rides the stdout JSON.
//
// ALWAYS ARMED. It was previously armed only by PHANTOM_ROUTING_ENFORCE=1, which
// meant it enforced nothing unless someone remembered to export a variable no
// documentation told them about. Discipline that has to be armed by hand is
// discipline that does not exist, so the flag is gone.
//
// The gate stays narrow rather than blunt: it fires only for a resolvable edit
// target inside a repository Phantom already tracks, never for Phantom's own data
// tree, and never when a session is active. PHANTOM_ADHOC=1 remains the escape
// hatch for deliberate ad-hoc work and is logged, so a bypass is possible but
// never invisible.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let phantomData, stateDir, detectRepo;
try {
  ({ phantomData, stateDir, detectRepo } = require('../scripts/lib/phantom-paths'));
} catch (_) {
  // fail open: inline fallback matching phantom-paths.js logic
  const home = os.homedir();
  const data = process.env.PHANTOM_DATA ||
    (home ? path.join(home, '.phantom') : path.join(process.cwd(), '.phantom'));
  phantomData = () => data;
  stateDir = () => path.join(phantomData(), 'state');
  detectRepo = () => (process.env.PHANTOM_REPO || '_default');
}

// SHARED SEMANTICS — keep identical in hooks/apex-subagent-driven-law.sh: a
// session is active when its state file exists AND is younger than 24h. A marker
// left by a crashed session must NOT silently disable tools forever, and the
// recovery for a hidden file nobody documented is not something a user can find.
const APEX_MARKER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function fresh(file) {
  try {
    if (!fs.existsSync(file)) return false;
    return Date.now() - fs.statSync(file).mtimeMs < APEX_MARKER_MAX_AGE_MS;
  } catch (_) {
    return false;
  }
}

// The authority is the per-repo current-session pointer that phantom-state.mjs
// already writes on start and clears on complete. Reading only the legacy global
// .apex-active marker meant a real session did not satisfy this gate at all:
// nothing in the current runtime writes that marker, so an armed gate denied edits
// inside the very session its own message told the user to start. The legacy
// marker stays honored so a session already in flight keeps working through an
// upgrade.
// Completing a session rewrites its pointer with status "completed" AND a fresh
// updated_at, so recency alone reports finished work as live and would keep
// allowing out-of-session edits for a further 24h.
function pointerCompleted(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).status === 'completed';
  } catch (_) {
    return false; // unreadable pointer is not proof of completion
  }
}

function sessionActive(cwd) {
  try {
    const repo = detectRepo(cwd);
    if (repo) {
      const pointer = path.join(stateDir(), 'current-session', `${repo}.json`);
      if (fresh(pointer) && !pointerCompleted(pointer)) return true;
    }
  } catch (_) { /* identity unresolvable → fall through to the legacy marker */ }
  return fresh(path.join(phantomData(), '.apex-active'));
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

  // Cheapest check first (existsSync+stat only, before any config read):
  // live phantom session for THIS repo → routing requirement is satisfied.
  const invocationCwd = payload.cwd || process.cwd();
  if (sessionActive(invocationCwd)) return;

  // ── Enforce branch: every error path below ALLOWS (fail open). ──
  try {
    const toolInput = payload.tool_input || {};
    const rawTarget = toolInput.file_path || toolInput.path || null;
    const cwd = invocationCwd;

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
    let repoRoot = null;
    while (true) {
      if (fs.existsSync(path.join(dir, '.git'))) { repoRoot = dir; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!repoRoot) return; // not inside a repo → not phantom's business

    // Gate covers ONLY phantom-known repos. Identity comes from the shared codec,
    // because current state lives under the canonical id (a remote-derived name plus
    // hash, or a hashed git root) while the directory basename matches only the
    // pre-hash layout: resolving by basename alone silently allowed out-of-session
    // edits in every repository tracked under a modern id. The basename is still
    // accepted so repositories recorded under the older layout stay covered.
    const candidates = [];
    try {
      const canonical = detectRepo(repoRoot);
      if (canonical) candidates.push(canonical);
    } catch (_) { /* codec unavailable → basename below is the only signal */ }
    candidates.push(path.basename(repoRoot));
    if (!candidates.some((name) => fs.existsSync(path.join(phantomData(), 'repos', name)))) return;

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
