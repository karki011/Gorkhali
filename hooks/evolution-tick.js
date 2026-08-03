#!/usr/bin/env node
// Author: Subash Karki
// evolution-tick.js — Stop hook that runs the learning lifecycle on a throttle.
//
// WHY A HOOK AND NOT THE SKILL: scripts/evolution-runner.js is repository
// maintenance tooling, and the portable skill in skills/phantom must stay
// standalone, so phantom:evolve cannot reach it. Hooks ship with the plugin and
// already depend on scripts/lib, so this is the one place that can invoke it
// without breaking the portable boundary.
//
// WHY Stop AND NOT MID-SESSION: the runner credits a learning only when a session
// recorded an observed verification pass. Running earlier would credit unverified
// work, so the soundest automatic moment is after a turn settles.
//
// WHY THROTTLED: the runner rescans every session and every learnings file. Once a
// turn would be wasteful and slow; once a day keeps promotion current at negligible
// cost. The stamp is per repo so one repo's tick never starves another's.
//
// FAIL-OPEN, ALWAYS: promotion is a background nicety and must never cost the user
// a turn. Every failure path exits 0 silently, and removal stays report-only because
// no mutation flag is passed — this path can promote and report, never delete.
'use strict';

const fs = require('fs');
const path = require('path');

const THROTTLE_MS = 20 * 60 * 60 * 1000; // once per day, with slack for a shifting schedule

try {
  const { phantomData, stateDir, detectRepo } = require('../scripts/lib/phantom-paths');
  const runner = path.join(__dirname, '..', 'scripts', 'evolution-runner.js');
  if (!fs.existsSync(runner)) process.exit(0);

  const repo = detectRepo();
  const stampDir = path.join(stateDir(), 'evolution');
  const stamp = path.join(stampDir, `${repo}.json`);

  let last = 0;
  try { last = Number(JSON.parse(fs.readFileSync(stamp, 'utf8')).ran_at_ms) || 0; }
  catch (_) { /* absent or corrupt -> treat as never run */ }
  if (Date.now() - last < THROTTLE_MS) process.exit(0);

  // Stamp BEFORE running. A runner that hangs or crashes must not re-fire on every
  // subsequent Stop; the next tick is a day away either way, and a missed promotion
  // costs nothing because the count is derived from artifacts and recomputable.
  fs.mkdirSync(stampDir, { recursive: true });
  fs.writeFileSync(stamp, `${JSON.stringify({
    schema_version: 1,
    repo,
    ran_at_ms: Date.now(),
    ran_at: new Date().toISOString(),
  }, null, 2)}\n`);

  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, [runner], {
    stdio: 'ignore',
    timeout: 20_000,
    env: { ...process.env, PHANTOM_DATA: phantomData(), PHANTOM_REPO: repo },
  });
} catch (_) {
  // Never break the session.
}
process.exit(0);
