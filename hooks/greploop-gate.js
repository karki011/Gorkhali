#!/usr/bin/env node
// Author: Subash Karki
// greploop-gate.js — Stop hook that blocks a session from finishing while a
// freshly-created, still-LIVE PR (not merged/closed) has an unrun Greptile loop
// (greptile.status pending/missing). Forces the user/agent toward
// Skill(phantom:greploop) before the session ends. Liveness — not the literal
// word "draft" — is the gate signal: wrap always creates drafts but labels them
// inconsistently ("draft" vs "open"), so we gate any non-settled PR.
//
// FAIL-OPEN POLARITY — read this before editing: this is a discipline gate,
// NOT a safety gate. It FAILS OPEN: any crash, missing file, unparseable JSON,
// missing helper, or ambiguity must ALLOW the stop. The decision rides the
// stdout JSON; we always exit 0. A hook bug must NEVER trap a session.
//
// ALWAYS-ON: there is no enable flag. It only fires inside an
// active phantom session, and it is BOUNDED: it blocks at most
// PHANTOM_GREPLOOP_GATE_MAX times per PR (default 3) so a stuck greptile.status
// can never trap the user. Once the ceiling is hit, it allows.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let phantomData, stateDir, detectRepo, sessionsDir;
try {
  ({ phantomData, stateDir, detectRepo, sessionsDir } = require('../scripts/lib/phantom-paths'));
} catch (_) {
  // fail open: a missing helper means we cannot resolve the active session →
  // every path below short-circuits to allow. Inline fallbacks keep the
  // counter/marker logic alive but resolution returns null → allow.
  const home = os.homedir();
  const data = process.env.PHANTOM_DATA ||
    (home ? path.join(home, '.phantom') : path.join(process.cwd(), '.phantom'));
  phantomData = () => data;
  stateDir = () => path.join(phantomData(), 'state');
  detectRepo = null;
  sessionsDir = null;
}

const TICKET_RE = /[A-Z][A-Z0-9]+-\d+/;

// SHARED SEMANTICS — same rule as routing-gate.js and
// apex-subagent-driven-law.sh: the authority is the per-repo current-session
// pointer, live when it exists, is younger than 24h, and is not completed.
//
// Reading only the retired global .apex-active marker made this gate permanently
// inert: nothing in the current runtime writes that marker, so an always-on gate
// never inspected wrap.json and never held a session open on an unreviewed PR.
// Completing a session rewrites its pointer with status "completed" and a fresh
// updated_at, so recency alone would report finished work as live.
const APEX_MARKER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function fresh(file) {
  try {
    if (!fs.existsSync(file)) return false;
    return Date.now() - fs.statSync(file).mtimeMs < APEX_MARKER_MAX_AGE_MS;
  } catch (_) {
    return false;
  }
}

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

// Resolve the ticket for an active session, mirroring fix-loop-gate.js
// resolveTicket() MINUS the toolInput.args branch (a Stop hook has no tool
// args): current-session/<repo>.json first, then the git branch name. Returns
// null on any ambiguity (→ allow).
function resolveTicket(repo, cwd) {
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
    const { execFileSync } = require('child_process');
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

// Resolve the ACTIVE session's wrap.json — read-path must equal greploop's
// write-path. Same phantom-paths helpers both sides → byte-identical path.
// Returns null on any ambiguity (→ allow, never newest-anywhere).
function resolveActiveWrapJson(cwd) {
  if (!detectRepo || !sessionsDir) return null; // helper missing → allow
  const repo = detectRepo(cwd);
  if (!repo) return null;
  const ticket = resolveTicket(repo, cwd);
  if (!ticket) return null;
  return path.join(sessionsDir(repo), ticket, 'wrap.json');
}

function gateMax() {
  const raw = parseInt(process.env.PHANTOM_GREPLOOP_GATE_MAX || '', 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 3;
}

// Bounded-fire counter, one file per PR in stateDir. Returns the post-increment
// count, or Infinity on failure so a broken counter never traps (fail open).
// Keyed by repository AND pull-request number. Numbering restarts per repository,
// so keying on the number alone makes two repositories share one counter: blocks
// consumed in the first exhaust the second's allowance and silently stop gating it.
function bumpCount(repo, prNumber) {
  try {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    const scope = String(repo || '_unknown').replace(/[^A-Za-z0-9._-]/g, '-');
    const file = path.join(dir, `greploop-gate-${scope}-${prNumber}.count`);
    let n = 0;
    try { n = parseInt(fs.readFileSync(file, 'utf-8').trim(), 10) || 0; } catch (_) { n = 0; }
    n += 1;
    fs.writeFileSync(file, String(n));
    return n;
  } catch (_) {
    return Infinity;
  }
}

function main() {
  // Stop hook receives a payload on stdin; parse it for cwd (fail-soft). An
  // unparseable/empty stdin must not block — fall back to process.cwd().
  let cwd = process.cwd();
  try {
    const payload = JSON.parse(fs.readFileSync(0, 'utf-8'));
    if (payload && typeof payload.cwd === 'string' && payload.cwd) cwd = payload.cwd;
  } catch (_) { /* keep process.cwd() */ }

  if (!sessionActive(cwd)) return; // no live session for this repo → allow

  const wrapPath = resolveActiveWrapJson(cwd);
  if (!wrapPath) return; // repo/ticket unresolvable → allow (never newest-anywhere)

  let wrap;
  try {
    wrap = JSON.parse(fs.readFileSync(wrapPath, 'utf-8'));
  } catch (_) {
    return; // unparseable → allow
  }

  const pr = wrap && wrap.pr;
  if (!pr || typeof pr.number !== 'number') return; // no real PR → allow

  // PR LIVENESS (not literal "draft") — wrap ALWAYS creates draft PRs
  // (ship-ceremony.md §4), but pr.status is recorded inconsistently in the
  // field: schema says "open"/"merged", wrap writes "draft" in practice, and a
  // schema-following wrap could write "open". Gating on the literal word
  // "draft" let an "open"-labeled draft silently disable the gate. So we gate
  // on LIVENESS instead: a PR with a number is gateable UNLESS it is closed out
  // (merged/closed). Normalize before comparing — values arrive mixed-case/padded.
  const prStatus = typeof pr.status === 'string' ? pr.status.trim().toLowerCase() : '';
  if (prStatus === 'merged' || prStatus === 'closed') return; // settled PR → allow

  // GREPTILE SETTLED-DETECTION — greptile.status is FREEFORM in the wild, not a
  // clean enum. Real recorded values include "skipped — availability guard
  // (Greptile not installed on this repo)", "n/a", "unavailable — no auto-review
  // in 200s ...", "done — 5/5", "complete". greploop writes clean "done"/"skipped"
  // but suffixes appear. So we BIAS TO ALLOW: only the narrow "loop has not run"
  // signal blocks — object missing, status empty/missing, status prefixed
  // "pending", or exactly "requested". Everything else (any "skipped …"/"done …"
  // /"n/a"/"unavailable …"/unknown) is treated as SETTLED → allow.
  // DO NOT tighten this back to exact equality: freeform suffixes are real and
  // a settled/unknown state must never false-block (fail-open philosophy).
  const rawStatus = wrap.greptile && wrap.greptile.status;
  const status = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : '';
  const notRun = !wrap.greptile || status === '' || status.startsWith('pending') || status === 'requested';
  if (!notRun) return; // settled / unknown → allow

  // greptile loop has not run on a live PR → block, but bounded.
  const max = gateMax();
  const count = bumpCount(detectRepo ? detectRepo(cwd) : null, pr.number);
  if (count > max) return; // ceiling hit → allow (never trap)

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason:
      `PR #${pr.number} has not been through greploop (greptile.status=${rawStatus || 'pending'}). ` +
      `Run Skill(skill="phantom:greploop", args="${pr.number}") to drive it to 5/5 before finishing. ` +
      `(Gate fail-open; fires at most ${max} times per PR.)`,
  }));
}

try {
  main();
} catch (_) { /* fail open */ }
process.exit(0);
