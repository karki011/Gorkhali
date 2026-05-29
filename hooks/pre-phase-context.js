// pre-phase-context.js — PreToolUse hook
// Injects reference content based on current session phase
// Author: Subash Karki

const fs = require('fs');
const path = require('path');

const REF_DIR = path.join(process.env.HOME, '.claude/phantom/reference');
const STATE_DIR = path.join(process.env.HOME, '.claude/phantom/state/sessions');

const PHASE_REFS = {
  'A': ['governance.md'],
  'B': ['agents.md', 'contracts.md', 'governance.md'],
  'C': ['contracts.md'],
  'D': ['agents.md'],
  'verify': ['verification.md', 'power-level.md'],
  'wrap': ['governance.md']
};

function getCurrentPhase() {
  try {
    const sessions = fs.readdirSync(STATE_DIR).filter(d => {
      const stat = fs.statSync(path.join(STATE_DIR, d));
      return stat.isDirectory();
    });
    for (const session of sessions.sort().reverse()) {
      const pauseFile = path.join(STATE_DIR, session, 'pause-state.json');
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

function getRefsForPhase(phase) {
  const refs = PHASE_REFS[phase] || PHASE_REFS['B'];
  const contents = [];
  for (const ref of refs) {
    const refPath = path.join(REF_DIR, ref);
    if (fs.existsSync(refPath)) {
      contents.push(`<!-- Reference: ${ref} -->\n${fs.readFileSync(refPath, 'utf-8')}`);
    }
  }
  return contents.join('\n---\n');
}

// Hook entry: detect phase, output reference content
const event = JSON.parse(process.argv[2] || '{}');
const toolName = event.tool_name || '';

if (toolName === 'Agent' || toolName === 'Skill') {
  const phase = getCurrentPhase();
  if (phase) {
    const refs = getRefsForPhase(phase);
    if (refs) {
      console.log(refs);
    }
  }
}
