// pre-phase-context.js — PreToolUse hook
// Injects reference content based on current session phase
// Author: Subash Karki

const fs = require('fs');
const path = require('path');

const PHASE_REFS = {
  'A': ['governance.md'],
  'B': ['agents.md', 'contracts.md', 'governance.md'],
  'C': ['contracts.md'],
  'D': ['agents.md'],
  'verify': ['verification.md', 'power-level.md'],
  'wrap': ['governance.md']
};

function getCurrentPhase(stateDirPath) {
  try {
    // Per-repo sessions dir may not exist yet for a fresh repo — guard the readdir.
    if (!fs.existsSync(stateDirPath)) return null;
    const sessions = fs.readdirSync(stateDirPath).filter(d => {
      const stat = fs.statSync(path.join(stateDirPath, d));
      return stat.isDirectory();
    });
    for (const session of sessions.sort().reverse()) {
      const pauseFile = path.join(stateDirPath, session, 'pause-state.json');
      if (fs.existsSync(pauseFile)) {
        const data = JSON.parse(fs.readFileSync(pauseFile, 'utf-8'));
        if (data.status === 'paused') return data.phase;
      }
    }
  } catch (e) {
    // No session state — return null
  }
  return null;
}

function getRefsForPhase(phase, refDir) {
  const refs = PHASE_REFS[phase] || PHASE_REFS['B'];
  const contents = [];
  for (const ref of refs) {
    const refPath = path.join(refDir, ref);
    if (fs.existsSync(refPath)) {
      contents.push(`<!-- Reference: ${ref} -->\n${fs.readFileSync(refPath, 'utf-8')}`);
    }
  }
  return contents.join('\n---\n');
}

function main() {
  // Resolver require lives inside the guard so a load failure fails open (exit 0), not a crash.
  const { sessionsDir } = require('../scripts/lib/phantom-paths');
  // shipped content (read-only), install-dir-relative
  const REF_DIR = path.join(__dirname, '..', 'reference');
  const STATE_DIR = sessionsDir();

  const event = JSON.parse(process.argv[2] || '{}');
  const toolName = event.tool_name || '';

  if (toolName === 'Agent' || toolName === 'Skill') {
    const phase = getCurrentPhase(STATE_DIR);
    if (phase) {
      const refs = getRefsForPhase(phase, REF_DIR);
      if (refs) {
        console.log(refs);
      }
    }
  }
}

// fail open: any error (incl. resolver-require failure on PreToolUse) must exit 0, never block the user
try {
  main();
} catch (_) {
  process.exit(0);
}
