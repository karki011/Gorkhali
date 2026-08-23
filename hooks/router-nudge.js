#!/usr/bin/env node
// Author: Subash Karki
// router-nudge.js — UserPromptSubmit hook that nudges toward gorkhali routing
// when a prompt looks like implementation work.
//
// POLARITY: pure advisory — this hook can NEVER block anything. Every failure
// path exits 0; a one-shot-marker write failure fails toward ONE MORE emit,
// never toward silence. Enforcement (if opted in) lives in routing-gate.js.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let stateDir;
try {
  ({ stateDir } = require('../scripts/lib/gorkhali-paths'));
} catch (_) {
  const home = os.homedir();
  const data = process.env.GORKHALI_DATA ||
    (home ? path.join(home, '.gorkhali') : path.join(process.cwd(), '.gorkhali'));
  stateDir = () => path.join(data, 'state');
}

// Implementation-intent triggers. Precision over recall: interrogative-opening
// prompts (diagnostic questions) are skipped wholesale before these run.
// Single-sourced in scripts/lib/routing-patterns.js so reference/routing.md's prose
// and its sync test read the same list this hook runs.
let PATTERNS, INTERROGATIVE_RE;
try {
  ({ PATTERNS, INTERROGATIVE_RE } = require('../scripts/lib/routing-patterns'));
} catch (_) {
  // fail open: inline fallback, kept identical to the shared module.
  PATTERNS = [
    { re: /\b[A-Z][A-Z0-9]+-\d+\b/, label: 'ticket-key' },
    { re: /\b(fix|implement|build|add|refactor|create|update|work on)\b/i, label: 'imperative-verb' },
    { re: /\b(let'?s|now|please|go ahead and) (fix|change|update|implement|add)\b/i, label: 'debug-to-fix' },
  ];
  INTERROGATIVE_RE = /^\s*(why|what|how|where|when|is|are|does|did|can you explain)\b/i;
}

const NUDGE_TEXT =
  'ROUTING: this prompt matches gorkhali implementation triggers — invoke ' +
  'Skill(gorkhali:start) before the FIRST project-file edit unless the work is ' +
  'purely diagnostic. A debug session that turns into a fix routes through ' +
  'gorkhali at the FIRST edit. (One-time reminder this session — see reference/routing.md)';

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

  // Advisory nudge is on by default; silence it with GORKHALI_ROUTING_NUDGE=0.
  if (process.env.GORKHALI_ROUTING_NUDGE === '0') process.exit(0);

  if (!classify(String(payload.prompt || ''))) process.exit(0);

  // One-shot per host session: marker at state/routing-nudge/<session_id>.
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
