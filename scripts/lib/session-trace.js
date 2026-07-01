// Author: Subash Karki
// session-trace.js — shared session→transcript resolver signals.
//
// Factored out of migrate-repo-dirs.js (T2) so the brain backfill (T5) reuses
// the SAME costs.json → session_id → transcript logic instead of forking it.
// Pure reads, no mutation, no external deps.
//
//   costs.json  entries[].session_id  (recursed — id can sit at any depth)
//        │
//        ▼
//   ~/.claude/projects/<encoded-cwd>/<session_id>.jsonl   (the transcript)

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * All session ids referenced by the given files. Only costs.json files are
 * inspected; the id lives at `entries[].session_id` but we recurse so it is
 * caught wherever it sits. Corrupt/unreadable JSON is skipped, never thrown.
 */
function collectSessionIds(files) {
  const ids = new Set();
  const dig = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(dig); return; }
    for (const [k, val] of Object.entries(v)) {
      if (k === 'session_id' && val) ids.add(String(val).trim());
      else dig(val);
    }
  };
  for (const f of files) {
    if (path.basename(f) !== 'costs.json') continue;
    try { dig(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch (_) { /* skip */ }
  }
  return [...ids];
}

/**
 * Absolute path to the transcript JSONL for a session id, or null. Claude flattens
 * a cwd into a projects/ dir name, so the owning dir is unknown up front — scan the
 * projects root for the first `<sessionId>.jsonl`. Does NOT read the transcript.
 */
function findTranscript(sessionId, projectsDir) {
  if (!sessionId || !projectsDir) return null;
  let dirs;
  try { dirs = fs.readdirSync(projectsDir); } catch (_) { return null; }
  const leaf = sessionId + '.jsonl';
  for (const d of dirs) {
    const candidate = path.join(projectsDir, d, leaf);
    try { if (fs.existsSync(candidate)) return candidate; } catch (_) { /* skip */ }
  }
  return null;
}

/** Default Claude transcript root; PHANTOM_PROJECTS_DIR overrides (testing). */
function projectsRoot() {
  return process.env.PHANTOM_PROJECTS_DIR ||
    path.join(require('os').homedir(), '.claude', 'projects');
}

module.exports = { collectSessionIds, findTranscript, projectsRoot };
