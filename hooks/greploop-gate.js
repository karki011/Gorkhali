#!/usr/bin/env node
// Author: Subash Karki
// greploop-gate.js — Stop hook that blocks a session from finishing while a
// freshly-created, still-LIVE PR (not merged/closed) has an unrun Greptile loop
// (greptile.status pending/missing). Forces the user/agent toward
// Skill(gorkhali:greploop) before the session ends. Liveness — not any literal
// status word — is the gate signal: wrap creates ready-for-review PRs and
// records pr.status "open", while legacy sessions recorded "draft", so we gate
// any non-settled PR.
//
// FAIL-OPEN POLARITY — read this before editing: this is a discipline gate,
// NOT a safety gate. It FAILS OPEN: any crash, missing file, unparseable JSON,
// missing helper, or ambiguity must ALLOW the stop. The decision rides the
// stdout JSON; we always exit 0. A hook bug must NEVER trap a session.
//
// ALWAYS-ON: unlike routing-gate.js (armed by GORKHALI_ROUTING_ENFORCE=1), this
// gate is armed by default — there is no enable flag. It only fires inside an
// active gorkhali session, and it is BOUNDED: it blocks at most
// GORKHALI_GREPLOOP_GATE_MAX times per PR (default 3) so a stuck greptile.status
// can never trap the user. Once the ceiling is hit, it allows.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let gorkhaliData, stateDir, detectRepo, sessionsDir;
try {
  ({ gorkhaliData, stateDir, detectRepo, sessionsDir } = require('../scripts/lib/gorkhali-paths'));
} catch (_) {
  // fail open: a missing helper means we cannot resolve the active session →
  // every path below short-circuits to allow. Inline fallbacks keep the
  // counter/marker logic alive but resolution returns null → allow.
  const home = os.homedir();
  const data = process.env.GORKHALI_DATA ||
    (home ? path.join(home, '.gorkhali') : path.join(process.cwd(), '.gorkhali'));
  gorkhaliData = () => data;
  stateDir = () => path.join(gorkhaliData(), 'state');
  detectRepo = null;
  sessionsDir = null;
}

const TICKET_RE = /[A-Z][A-Z0-9]+-\d+/;

// SHARED SEMANTICS — same rule as routing-gate.js: a gorkhali session is active
// when <GORKHALI_DATA>/.chief-active exists AND its mtime is younger than 24h.
const CHIEF_MARKER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// One-release upgrade shim: .apex-active was this marker's filename before the
// apex->chief rename. New sessions only ever write .chief-active; this dual
// read keeps a session started by a not-yet-upgraded install recognized until
// the marker naturally expires. Remove the .apex-active fallback once no
// install can still be carrying a marker from before the rename.
const MARKER_NAMES = ['.chief-active', '.apex-active'];

function sessionActive() {
  try {
    const dataDir = gorkhaliData();
    for (const name of MARKER_NAMES) {
      const marker = path.join(dataDir, name);
      if (fs.existsSync(marker)) {
        return Date.now() - fs.statSync(marker).mtimeMs < CHIEF_MARKER_MAX_AGE_MS;
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

// A repo may now have several concurrently-active tasks (see gorkhali-state.mjs
// multi-task pointer); this resolves the FOCUS task (the one a bare command
// without --task would act on), same as this hook's single-task behavior
// before that change.
function focusTaskFromPointer(sessionFile) {
  const pointer = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
  if (pointer && pointer.schema_version === 2 && typeof pointer.focus_task_id === 'string') {
    return pointer.focus_task_id;
  }
  if (pointer && pointer.schema_version === 1 && typeof pointer.task_id === 'string') {
    return pointer.task_id;
  }
  return null;
}

// Resolve the ticket for an active session, mirroring fix-loop-gate.js
// resolveTicket() MINUS the toolInput.args branch (a Stop hook has no tool
// args): current-session/<repo>.json first, then the git branch name. Returns
// null on any ambiguity (→ allow).
function resolveTicket(repo, cwd) {
  try {
    const sessionFile = path.join(stateDir(), 'current-session', repo + '.json');
    const focusTaskId = focusTaskFromPointer(sessionFile);
    if (typeof focusTaskId === 'string' && TICKET_RE.test(focusTaskId)) {
      return focusTaskId.match(TICKET_RE)[0];
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
// write-path. Same gorkhali-paths helpers both sides → byte-identical path.
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
  const raw = parseInt(process.env.GORKHALI_GREPLOOP_GATE_MAX || '', 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 3;
}

// Bounded-fire counter, one file per PR in stateDir. Returns the post-increment
// count, or Infinity on failure so a broken counter never traps (fail open).
function bumpCount(prNumber) {
  try {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `greploop-gate-${prNumber}.count`);
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

  if (!sessionActive()) return; // no live session → allow

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

  // PR LIVENESS (not a literal status word) — wrap creates ready-for-review PRs
  // and records pr.status "open" (ship-ceremony.md §4), while legacy sessions
  // recorded "draft". pr.status is freeform in the field, so gating on any one
  // literal word let the other label silently disable the gate. We gate on
  // LIVENESS instead: a PR with a number is gateable UNLESS it is closed out
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
  const count = bumpCount(pr.number);
  if (count > max) return; // ceiling hit → allow (never trap)

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason:
      `PR #${pr.number} has not been through greploop (greptile.status=${rawStatus || 'pending'}). ` +
      `Run Skill(skill="gorkhali:greploop", args="${pr.number}") before finishing. ` +
      `(Gate fail-open; fires at most ${max} times per PR.)`,
  }));
}

try {
  main();
} catch (_) { /* fail open */ }
process.exit(0);
