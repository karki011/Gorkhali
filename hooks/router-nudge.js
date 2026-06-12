#!/usr/bin/env node
// Author: Subash Karki
// router-nudge.js — UserPromptSubmit hook that nudges toward phantom routing
// when a prompt looks like implementation work and no phantom session is live.
//
// POLARITY: pure advisory — this hook can NEVER block anything. Every failure
// path exits 0; a one-shot-marker write failure fails toward ONE MORE emit,
// never toward silence. Enforcement (if opted in) lives in routing-gate.js.
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

let readFlag;
try {
  ({ readFlag } = require('../scripts/lib/config-lite'));
} catch (_) {
  readFlag = (_section, _key, defaultValue) => defaultValue;
}

// SHARED SEMANTICS — keep identical in hooks/routing-gate.js: a phantom
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

// Implementation-intent triggers. Precision over recall: interrogative-opening
// prompts (diagnostic questions) are skipped wholesale before these run.
const PATTERNS = [
  { re: /\b[A-Z][A-Z0-9]+-\d+\b/, label: 'ticket-key' },
  { re: /\b(fix|implement|build|add|refactor|create|update|work on)\b/i, label: 'imperative-verb' },
  { re: /\b(let'?s|now|please|go ahead and) (fix|change|update|implement|add)\b/i, label: 'debug-to-fix' },
];

const INTERROGATIVE_RE = /^\s*(why|what|how|where|when|is|are|does|did|can you explain)\b/i;

const NUDGE_TEXT =
  'ROUTING: this prompt matches phantom implementation triggers — invoke ' +
  'Skill(phantom:start) before the FIRST project-file edit unless the work is ' +
  'purely diagnostic. A debug session that turns into a fix routes through ' +
  'phantom at the FIRST edit. (One-time reminder this session — see reference/routing.md)';

function classify(prompt) {
  if (INTERROGATIVE_RE.test(prompt)) return null;
  for (const p of PATTERNS) {
    if (p.re.test(prompt)) return p.label;
  }
  return null;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (_) {
    process.exit(0); // unparseable stdin → not our call to judge
  }

  // Cheapest check first: live phantom session → routing already happened.
  if (sessionActive()) process.exit(0);

  if (readFlag('routing', 'nudge', true) === false) process.exit(0);

  if (!classify(String(payload.prompt || ''))) process.exit(0);

  // One-shot per Claude session: marker at state/routing-nudge/<session_id>.
  const sessionId = String(payload.session_id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  const markerDir = path.join(stateDir(), 'routing-nudge');
  const markerFile = path.join(markerDir, sessionId);
  if (fs.existsSync(markerFile)) process.exit(0); // already nudged this session
  try {
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(markerFile, String(Date.now()));
  } catch (_) {
    // Advisory layer fails toward one more emit, not toward silence.
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: NUDGE_TEXT,
    },
  }));
  process.exit(0);
}

if (require.main === module) main();

module.exports = { PATTERNS };
