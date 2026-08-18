#!/usr/bin/env node
// Author: Subash Karki
// fix-loop-gate.js — PreToolUse hook that surfaces the fix-loop ceiling at the
// Skill boundary. Decision logic lives in hooks/loop-controller.js (the loop
// authority) — this hook only resolves the artifact and emits an advisory:
//
//   at/over ceiling (or same-class repeat) → advisory via additionalContext.
//   NEVER denies — worst case is an advisory; under-ceiling/errors stay silent.
//
// WHICH ARTIFACT IT READS. The review round ledger
// ({SESSION_DIR}/reviews/rounds.json) first: it is what the portable
// verify/review flow writes, one append per validly completed review round.
// {SESSION_DIR}/verification.json second, for sessions predating the portable
// move — nothing writes that file any more, and reading only it is why this
// gate resolved `verification-missing` and stayed silent through every loop it
// existed to bound.
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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (_) {
    return null;
  }
}

// The ledger's rounds, or null when there is no readable ledger. A corrupt
// ledger reads as null rather than an empty array so the legacy artifact still
// gets its turn and corruption never reads as "no loops have run yet".
function ledgerRounds(sessionDir) {
  const ledger = readJson(path.join(sessionDir, 'reviews', 'rounds.json'));
  if (!ledger || typeof ledger !== 'object' || !Array.isArray(ledger.rounds)) return null;
  return ledger.rounds;
}

// Returns { decision, loops, ceiling, source } or an { error } marker. Errors
// stay silent in advisory mode — they never block.
function evaluate() {
  const ticket = resolveTicket();
  if (!ticket) return { error: 'ticket-unresolvable' };

  const sessionDir = path.join(sessionsDir(repo), ticket);
  const rounds = ledgerRounds(sessionDir);
  const verification = readJson(path.join(sessionDir, 'verification.json'));
  const { loops, source } = loopController.resolveFixLoops({ rounds, verification });
  // Neither artifact present: the ceiling is unenforceable for this session, and
  // an advisory built on a fabricated zero would be worse than none.
  if (source === 'none') return { error: 'loop-state-missing', ticket };

  // classHistory / lastAttempt / override live only on the legacy artifact; the
  // ledger carries no failure class and no override. Absent, they are simply not
  // evaluated, and the ceiling branch decides on its own.
  const review = (verification && verification.review) || {};
  const decision = loopController.shouldContinue({
    fixLoops: loops,
    currentClass: review.lastAttempt && review.lastAttempt.class,
    classHistory: review.classHistory,
    override: review.override,
  });
  return { decision, loops, ceiling: loopController.FIX_LOOP_CEILING, source, ticket };
}

// ---------------------------------------------------------------------------
// Advisory-only: never deny; worst case is an advisory. Errors / under-ceiling
// stay silent. Hook bugs never block or nag a session.
// ---------------------------------------------------------------------------
try {
  const result = evaluate();
  if (!result.error && result.decision.continue !== true) {
    advisory(
      `FIX LOOP advisory: ${result.loops}/${result.ceiling} — ${result.decision.reason} ` +
        `(counted from ${result.source})`
    );
  }
} catch (_err) { /* never blocked or nagged by hook bugs */ }

process.exit(0);
