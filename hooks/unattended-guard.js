#!/usr/bin/env node
// Author: Subash Karki
// unattended-guard.js — PreToolUse tripwire for unattended (bypassPermissions)
// runs. Activation mirrors fix-loop-gate.js exactly: PHANTOM_UNATTENDED=1 env
// (primary) OR a fresh arming marker <stateDir>/unattended/<repo>.json whose
// worktreeRoot contains realpath(cwd).
//
//   ATTENDED   (default)         → exit 0 with ZERO evaluation. This hook
//                                  matches Read, so it spawns on every Read in
//                                  every session — the no-op path must be as
//                                  close to free as possible.
//   UNATTENDED (explicit opt-in) → deny destructive Bash patterns, sensitive
//                                  Read targets, and writes outside the active
//                                  worktree / PHANTOM_DATA subtree. Ambiguity
//                                  (undeterminable root, crash) → deny.
//
// Always exits 0 — the decision rides the stdout JSON.
'use strict';

const fs = require('fs');
const path = require('path');

// Tripwire, not a security boundary — sh -c, variable expansion, and heredocs
// can bypass regex matching; the operator-level settings.json deny rules
// (reference/unattended.md) are the layer above.
const DENY_PATTERNS = [
  // rm with both a recursive and a force flag in the same command segment:
  // covers -rf, -fr, -rfv, and split "rm -r -f".
  { re: /\brm\b(?=[^|;&\n]*\s-[a-zA-Z]*[rR])(?=[^|;&\n]*\s-[a-zA-Z]*f)/, label: 'rm -rf' },
  { re: /\brm\b[^|;&\n]*--no-preserve-root/, label: 'rm --no-preserve-root' },
  { re: /\bgit\s+push\b[^|;&\n]*(?:\s-f\b|\s--force(?!-with-lease))/, label: 'git push --force' },
  { re: /\bgit\s+reset\b[^|;&\n]*--hard\b[^|;&\n]*(?:@\{u\}|\borigin\/)/, label: 'git reset --hard <remote-ref>' },
  { re: /\bgit\s+clean\b(?=[^|;&\n]*\s-[a-zA-Z]*f)(?=[^|;&\n]*\s-[a-zA-Z]*d)/, label: 'git clean -fd' },
  { re: /\bchmod\b(?=[^|;&\n]*\s-[a-zA-Z]*R)(?=[^|;&\n]*\b777\b)/, label: 'chmod -R 777' },
];

module.exports = { DENY_PATTERNS };

// Default used before constants.js is lazily loaded past the fast path.
let MARKER_MAX_AGE_MS = 12 * 60 * 60 * 1000; // fallback if constants unavailable

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function deny(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'UNATTENDED GUARD: ' + reason,
    },
  });
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch (_) {
    return '';
  }
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
  const ENV_ARMED = process.env.PHANTOM_UNATTENDED === '1';

  let payload = {};
  try {
    payload = JSON.parse(readStdin());
  } catch (_) {
    if (ENV_ARMED) deny('unparseable hook payload — denying fail-safe');
    process.exit(0);
  }

  const cwd = payload.cwd || process.cwd();

  // Marker path needs phantom-paths (lean: os/fs/path only). Loaded lazily so
  // a require failure in attended mode stays a silent no-op.
  let pp = null;
  let markerPath = null;
  try {
    pp = require('../scripts/lib/phantom-paths');
    markerPath = path.join(pp.stateDir(), 'unattended', pp.detectRepo(cwd) + '.json');
  } catch (_) { /* env branch falls back to git; attended branch bails below */ }

  // -------------------------------------------------------------------------
  // FAST PATH: attended session (no env) with no arming marker → free no-op.
  // -------------------------------------------------------------------------
  // Lazy constants load — must stay after the fast path above.
  try {
    MARKER_MAX_AGE_MS = require('../scripts/lib/constants').MARKER_FRESHNESS_MS ?? MARKER_MAX_AGE_MS;
  } catch (_) { /* fail open: inline default above */ }

  let marker = null;
  if (!ENV_ARMED) {
    if (!markerPath || !fs.existsSync(markerPath)) process.exit(0);
    // Marker channel activates only when fresh AND realpath(cwd) is within
    // worktreeRoot — identical semantics to fix-loop-gate.js isUnattended().
    try {
      if (Date.now() - fs.statSync(markerPath).mtimeMs > MARKER_MAX_AGE_MS) process.exit(0);
      const m = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      if (typeof m.worktreeRoot !== 'string' || !m.worktreeRoot) process.exit(0);
      const realCwd = fs.realpathSync(cwd);
      const realRoot = fs.realpathSync(m.worktreeRoot);
      if (realCwd !== realRoot && !realCwd.startsWith(realRoot + path.sep)) process.exit(0);
      marker = m;
    } catch (_) {
      // Marker garbage/unverifiable → the marker channel does NOT activate.
      process.exit(0);
    }
  } else if (markerPath) {
    // Env is the activation authority; the marker only supplies worktreeRoot.
    try {
      marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    } catch (_) { /* no marker → git-toplevel fallback in resolveWorktreeRoot */ }
  }

  // -------------------------------------------------------------------------
  // ACTIVE: evaluate the tool call. Any crash → deny fail-safe, exit 0.
  // -------------------------------------------------------------------------
  function resolveWorktreeRoot() {
    if (marker && typeof marker.worktreeRoot === 'string' && marker.worktreeRoot) {
      try {
        return fs.realpathSync(marker.worktreeRoot);
      } catch (_) { /* dangling root → git fallback */ }
    }
    try {
      const { execFileSync } = require('child_process');
      const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: fs.realpathSync(cwd),
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (top) return fs.realpathSync(top);
    } catch (_) { /* undeterminable */ }
    return null;
  }

  function evaluate() {
    const tool = String(payload.tool_name || '');
    const ti = payload.tool_input || {};

    if (tool === 'Bash') {
      const cmd = String(ti.command || '');
      for (const { re, label } of DENY_PATTERNS) {
        if (re.test(cmd)) return "command matches deny pattern '" + label + "'";
      }
      return null;
    }

    if (tool === 'Read') {
      const base = path.basename(String(ti.file_path || ti.path || '')).toLowerCase();
      if (!base) return null;
      const sensitive =
        (base.startsWith('.env') && base !== '.env.example') ||
        base.endsWith('.pem') ||
        base.endsWith('.key') ||
        base.includes('credentials');
      return sensitive ? 'sensitive file read blocked (' + base + ')' : null;
    }

    if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
      const raw = ti.file_path || ti.notebook_path || ti.path;
      if (!raw || typeof raw !== 'string') return 'write target missing from tool input — denying fail-safe';
      const target = realResolve(path.isAbsolute(raw) ? raw : path.resolve(cwd, raw));

      const roots = [];
      const worktreeRoot = resolveWorktreeRoot();
      if (worktreeRoot) roots.push(worktreeRoot);
      let dataRoot = null;
      try {
        dataRoot = realResolve(pp.phantomData());
        roots.push(dataRoot);
      } catch (_) { /* phantom-paths unavailable → worktree root only */ }

      if (!worktreeRoot && !(dataRoot && within(target, dataRoot))) {
        return 'worktree root undeterminable — denying write fail-safe (' + target + ')';
      }
      if (!roots.some((r) => within(target, r))) {
        return 'write target outside allowed roots (' + target + ')';
      }
      return null;
    }

    return null; // tools outside our matcher pass through
  }

  let reason = null;
  try {
    reason = evaluate();
  } catch (_) {
    reason = 'internal error evaluating tool call — denying fail-safe';
  }
  if (reason) deny(reason);
  process.exit(0);
}

if (require.main === module) main();
