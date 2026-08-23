#!/usr/bin/env node
// Author: Subash Karki
// timing-capture.js — lightweight agent spawn/stop timing capture.
//
// Registered in hooks.json (native — only the native path carries real tool_input):
//   PreToolUse  (matcher "Agent")  -> node timing-capture.js spawn
//   SubagentStop                   -> node timing-capture.js stop
//
// Appends one NDJSON line per event to <data>/timing/<repo>.jsonl. The companion
// scripts/timing-report.js pairs spawn->stop and aggregates per model so you can
// see whether Chief's model routing fires and whether it cuts wall-clock.
//
// Silent + never throws — must never break the workflow. SubagentStop is the end
// signal (not PostToolUse) because background agents return from the Agent tool at
// LAUNCH, not completion; SubagentStop fires when the subagent actually finishes.

const fs = require('fs');
const path = require('path');

let timingDir, detectRepo;
try {
  ({ timingDir, detectRepo } = require('../scripts/lib/gorkhali-paths'));
} catch (_) {
  // fail open: resolver unavailable — degrade gracefully, never crash a spawn
  const os = require('os');
  const home = os.homedir();
  const data = process.env.GORKHALI_DATA ||
    (home ? path.join(home, '.gorkhali') : path.join(process.cwd(), '.gorkhali'));
  timingDir = () => path.join(data, 'timing');
  detectRepo = () => (process.env.GORKHALI_REPO || '_default');
}

// Native Claude Code passes the hook payload as JSON on stdin; the internal router
// passes it as an argv slot. Try stdin first, then argv, and tolerate either.
function readPayload() {
  const sources = [
    () => fs.readFileSync(0, 'utf-8'),
    () => process.argv[3],
    () => process.argv[2],
  ];
  for (const get of sources) {
    try {
      const raw = get();
      if (raw && String(raw).trim().startsWith('{')) return JSON.parse(raw);
    } catch (_) { /* try next source */ }
  }
  return {};
}

try {
  const mode = process.argv[2] === 'stop' ? 'stop' : 'spawn';
  const p = readPayload();
  const ts = new Date().toISOString();
  const sid = p.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';
  const id = p.tool_use_id || p.toolUseId || p.id || null;

  let rec;
  if (mode === 'spawn') {
    const toolName = p.tool_name || 'Agent';
    if (toolName !== 'Agent' && toolName !== 'Task') process.exit(0); // only agent spawns
    const input = p.tool_input || {};

    // Resolve effective model: param > frontmatter pin > inherited-from-session.
    let model = 'inherited';
    let modelSource = 'session';
    if (input.model) {
      model = input.model;
      modelSource = 'param';
    } else {
      // Strip "gorkhali:" prefix to get bare agent name, then read its frontmatter.
      try {
        const rawType = input.subagent_type || '';
        const name = rawType.replace(/^gorkhali:/, '');
        if (name) {
          const agentFile = path.join(__dirname, '..', 'agents', name + '.md');
          const content = fs.readFileSync(agentFile, 'utf-8');
          // Match `model: <value>` in the YAML front-matter block (between --- delimiters).
          const fmMatch = content.match(/^---[\s\S]*?^---/m);
          if (fmMatch) {
            const pinMatch = fmMatch[0].match(/^model:\s*(\S+)/m);
            if (pinMatch) {
              model = pinMatch[1];
              modelSource = 'pinned';
            }
          }
        }
      } catch (_) {
        // file absent or unreadable — fall back to 'inherited'/'session'
      }
    }

    rec = {
      event: 'spawn',
      ts,
      sid,
      id,
      agent: input.subagent_type || 'unknown',
      // model reflects the effective model (param, frontmatter pin, or session-inherited).
      model,
      modelSource,
      bg: input.run_in_background === true,
    };
  } else {
    rec = { event: 'stop', ts, sid, id };
  }

  const dir = timingDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${detectRepo()}.jsonl`), JSON.stringify(rec) + '\n');
} catch (_) {
  // never break the workflow — silent on errors
}
process.exit(0);
