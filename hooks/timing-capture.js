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
// see whether Apex's model routing fires and whether it cuts wall-clock.
//
// Silent + never throws — must never break the workflow. SubagentStop is the end
// signal (not PostToolUse) because background agents return from the Agent tool at
// LAUNCH, not completion; SubagentStop fires when the subagent actually finishes.

const fs = require('fs');
const path = require('path');

let timingDir, detectRepo, phantomData;
try {
  ({ timingDir, detectRepo, phantomData } = require('../scripts/lib/phantom-paths'));
} catch (_) {
  // fail open: resolver unavailable — degrade gracefully, never crash a spawn
  const os = require('os');
  const home = os.homedir();
  const data = process.env.PHANTOM_DATA ||
    (home ? path.join(home, '.phantom') : path.join(process.cwd(), '.phantom'));
  timingDir = () => path.join(data, 'timing');
  detectRepo = () => (process.env.PHANTOM_REPO || '_default');
  phantomData = () => data;
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

// Blade mutex read by hooks/apex-subagent-driven-law.sh. One file per live
// subagent, keyed by tool_use_id so a stop clears exactly its own spawn: with
// parallel Blades a single shared flag is cleared by whichever subagent finishes
// first, reopening the gate while its siblings still hold edits in flight.
//
// Deriving it here rather than asking Apex to touch and remove a marker by hand
// is the point: an instruction Apex can forget is not a mutex, and forgetting the
// removal fails open silently -- the law looks enforced while enforcing nothing.
// Scoped per repository, matching the session sentinel the law reads. A global
// directory means a Blade spawned for repository A reports "a Blade is editing" for
// repository B, letting Apex edit B directly and defeating the per-repo isolation.
function bladeMarkerDir() {
  return path.join(phantomData(), '.blade-editing.d', detectRepo());
}

function syncBladeMarker(mode, id) {
  const dir = bladeMarkerDir();
  const safeId = typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
  if (mode === 'spawn') {
    fs.mkdirSync(dir, { recursive: true });
    const name = safeId || `unpaired-${process.pid}-${Date.now()}`;
    fs.writeFileSync(path.join(dir, name), '', { flag: 'w' });
    return;
  }
  if (!fs.existsSync(dir)) return;
  if (safeId && fs.existsSync(path.join(dir, safeId))) {
    fs.unlinkSync(path.join(dir, safeId));
    return;
  }
  // A stop without a pairable id must still decrement, or the directory leaks and
  // the law stops enforcing. Drop the oldest marker: the count stays honest even
  // when the host does not correlate stop events with their spawn.
  const oldest = fs.readdirSync(dir)
    .map((name) => {
      try { return { name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }; }
      catch (_) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.mtime - b.mtime)[0];
  if (oldest) fs.unlinkSync(path.join(dir, oldest.name));
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

    // The native tool input is authoritative when it reports a model. Otherwise
    // record inheritance; portable skills no longer have a second agent
    // frontmatter tree from which to infer an effective model.
    const model = input.model || 'inherited';
    const modelSource = input.model ? 'param' : 'session';

    rec = {
      event: 'spawn',
      ts,
      sid,
      id,
      agent: input.subagent_type || 'unknown',
      // Model is observed from the tool input or explicitly marked inherited.
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
  syncBladeMarker(mode, id);
} catch (_) {
  // never break the workflow — silent on errors
}
process.exit(0);
