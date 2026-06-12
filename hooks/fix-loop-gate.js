#!/usr/bin/env node
// Author: Subash Karki
// fix-loop-gate.js — PreToolUse hook that machine-enforces the fix-loop ceiling
// at the Skill boundary. Decision logic lives in hooks/loop-controller.js (the
// loop authority) — this hook only resolves the artifact and applies polarity:
//
//   ATTENDED   (default)        → NEVER deny; at/over ceiling emits an advisory
//                                 via additionalContext only.
//   UNATTENDED (explicit opt-in) → deny at/over ceiling, same-class repeat, AND
//                                 fail-safe deny on any ambiguity (missing/garbage
//                                 verification.json, unresolvable ticket, crash).
//
// Prime invariant: absence/ambiguity → MORE gating in unattended, ZERO gating in
// attended. Always exits 0 — the decision rides the stdout JSON; a non-zero exit
// would block attended sessions on hook bugs, which is forbidden.
'use strict';

const fs = require('fs');
const path = require('path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch (_) {
    return '';
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function advisory(text) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: text,
    },
  });
}

function deny(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

// ---------------------------------------------------------------------------
// Line-1 fast path: not a fix-skill invocation → silent exit before loading
// any further machinery.
// ---------------------------------------------------------------------------
let payload = {};
try {
  payload = JSON.parse(readStdin());
} catch (_) {
  process.exit(0); // unparseable payload → not our call to judge; stay silent
}

const toolName = payload.tool_name;
const toolInput = payload.tool_input || {};
if (toolName !== 'Skill' || !/(^|:)fix$/.test(String(toolInput.skill || ''))) {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Shared resolution helpers (loaded only past the fast path). A require failure
// must still honor polarity: deny in unattended (can't evaluate → gate), exit 0
// in attended (hook bugs never block a human session).
// ---------------------------------------------------------------------------
let stateDir, sessionsDir, detectRepo, loopController, execFileSync;
try {
  ({ stateDir, sessionsDir, detectRepo } = require('../scripts/lib/phantom-paths'));
  loopController = require('./loop-controller');
  ({ execFileSync } = require('child_process'));
} catch (_) {
  if (process.env.PHANTOM_UNATTENDED === '1') {
    deny('FIX LOOP gate (unattended): support libraries unavailable — denying fail-safe');
  }
  process.exit(0);
}

const TICKET_RE = /[A-Z][A-Z0-9]+-\d+/;
const MARKER_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const cwd = payload.cwd || process.cwd();
const repo = detectRepo(cwd);

function isUnattended() {
  if (process.env.PHANTOM_UNATTENDED === '1') return true;
  try {
    const markerPath = path.join(stateDir(), 'unattended', repo + '.json');
    if (Date.now() - fs.statSync(markerPath).mtimeMs > MARKER_MAX_AGE_MS) return false;
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    if (typeof marker.worktreeRoot !== 'string' || !marker.worktreeRoot) return false;
    const realCwd = fs.realpathSync(cwd);
    const realRoot = fs.realpathSync(marker.worktreeRoot);
    return realCwd === realRoot || realCwd.startsWith(realRoot + path.sep);
  } catch (_) {
    // Marker missing/garbage/unverifiable cwd → marker channel does NOT activate.
    // A dropped marker must never silently enforce.
    return false;
  }
}

function resolveTicket() {
  const fromArgs = String(toolInput.args || '').match(TICKET_RE);
  if (fromArgs) return fromArgs[0];

  try {
    const sessionFile = path.join(stateDir(), 'current-session', repo + '.json');
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    if (typeof session.ticket === 'string' && TICKET_RE.test(session.ticket)) {
      return session.ticket.match(TICKET_RE)[0];
    }
  } catch (_) { /* fall through to git */ }

  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const fromBranch = branch.match(TICKET_RE);
    if (fromBranch) return fromBranch[0];
  } catch (_) { /* unresolvable */ }

  return null;
}

// Returns { decision, loops, ceiling } or throws/returns error markers for the
// caller to apply polarity-appropriate handling.
function evaluate() {
  const ticket = resolveTicket();
  if (!ticket) return { error: 'ticket-unresolvable' };

  const verificationPath = path.join(sessionsDir(repo), ticket, 'verification.json');
  // Explicit existence check: do NOT lean on getFixLoops fail-open-to-0 for a
  // missing artifact — in unattended mode "no artifact" must gate, not allow.
  if (!fs.existsSync(verificationPath)) return { error: 'verification-missing', ticket };

  let verification;
  try {
    verification = JSON.parse(fs.readFileSync(verificationPath, 'utf-8'));
  } catch (_) {
    return { error: 'verification-unparseable', ticket };
  }

  const review = (verification && verification.review) || {};
  const fixLoops = loopController.getFixLoops(verification);
  const decision = loopController.shouldContinue({
    fixLoops,
    currentClass: review.lastAttempt && review.lastAttempt.class,
    classHistory: review.classHistory,
    override: review.override,
  });
  return { decision, loops: fixLoops, ceiling: loopController.FIX_LOOP_CEILING, ticket };
}

// ---------------------------------------------------------------------------
// Polarity branches
// ---------------------------------------------------------------------------
if (isUnattended()) {
  // UNATTENDED: fail-safe — any ambiguity or error denies.
  try {
    const result = evaluate();
    if (result.error) {
      deny(`FIX LOOP gate (unattended): ${result.error} — cannot verify loop state; denying fail-safe`);
    } else if (result.decision.continue === true) {
      // allow: exit 0 with no decision JSON
    } else {
      deny(`FIX LOOP ${result.loops}/${result.ceiling}: ${result.decision.reason}`);
    }
  } catch (_err) {
    deny('FIX LOOP gate (unattended): internal error evaluating loop state — denying fail-safe');
  }
} else {
  // ATTENDED: never deny; worst case is an advisory.
  try {
    const result = evaluate();
    if (!result.error && result.decision.continue !== true) {
      advisory(`FIX LOOP advisory: ${result.loops}/${result.ceiling} — ${result.decision.reason}`);
    }
    // errors / under-ceiling → stay silent
  } catch (_err) { /* attended sessions are never blocked or nagged by hook bugs */ }
}

process.exit(0);
