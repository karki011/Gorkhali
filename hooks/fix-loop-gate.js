#!/usr/bin/env node
// Author: Subash Karki
// fix-loop-gate.js — PreToolUse hook that surfaces the fix-loop ceiling at the
// Skill boundary. Decision logic lives in hooks/loop-controller.js (the loop
// authority) — this hook only resolves the artifact and emits an advisory:
//
//   at/over ceiling (or same-class repeat) → advisory via additionalContext.
//   NEVER denies — worst case is an advisory; under-ceiling/errors stay silent.
//
// Always exits 0 — the advisory rides the stdout JSON; a non-zero exit would
// block sessions on hook bugs, which is forbidden.
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
// stays silent — hook bugs never block or nag a session.
// ---------------------------------------------------------------------------
let stateDir, sessionsDir, detectRepo, loopController, execFileSync;
try {
  ({ stateDir, sessionsDir, detectRepo } = require('../scripts/lib/phantom-paths'));
  loopController = require('./loop-controller');
  ({ execFileSync } = require('child_process'));
} catch (_) {
  process.exit(0);
}

const TICKET_RE = /[A-Z][A-Z0-9]+-\d+/;

const cwd = payload.cwd || process.cwd();
const repo = detectRepo(cwd);

function resolveTicket() {
  const fromArgs = String(toolInput.args || '').match(TICKET_RE);
  if (fromArgs) return fromArgs[0];

  try {
    const sessionFile = path.join(stateDir(), 'current-session', repo + '.json');
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    // `task_id` is the field the current pointer carries; `ticket` is the pre-v2
    // name. Reading only `ticket` meant the ticket could be resolved solely from a
    // branch name, so a branch without an id silently disabled this gate.
    for (const value of [session.task_id, session.ticket]) {
      if (typeof value === 'string' && TICKET_RE.test(value)) {
        return value.match(TICKET_RE)[0];
      }
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

// Returns { decision, loops, ceiling } or an { error } marker. Errors stay
// silent in advisory mode — they never block.
function evaluate() {
  const ticket = resolveTicket();
  if (!ticket) return { error: 'ticket-unresolvable' };

  const verificationPath = path.join(sessionsDir(repo), ticket, 'verification.json');
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
// Advisory-only: never deny; worst case is an advisory. Errors / under-ceiling
// stay silent. Hook bugs never block or nag a session.
// ---------------------------------------------------------------------------
try {
  const result = evaluate();
  if (!result.error && result.decision.continue !== true) {
    advisory(`FIX LOOP advisory: ${result.loops}/${result.ceiling} — ${result.decision.reason}`);
  }
} catch (_err) { /* never blocked or nagged by hook bugs */ }

process.exit(0);
