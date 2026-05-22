// validate-artifact.js — PostToolUse hook
// Validates JSON artifacts in state/sessions/ have proper _meta headers
// Author: Subash Karki

const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = path.join(process.env.HOME, '.claude/team/state/sessions');
const REQUIRED_META = ['writtenAt', 'gitHead', 'gitBranch', 'phase', 'skill', 'version'];

function isArtifact(filePath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  return resolved.startsWith(SESSIONS_DIR) && resolved.endsWith('.json');
}

function validate(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (!data._meta) {
      return { valid: false, error: `Missing _meta header in ${path.basename(filePath)}` };
    }

    const missing = REQUIRED_META.filter(f => !(f in data._meta));
    if (missing.length > 0) {
      return { valid: false, error: `_meta missing fields: ${missing.join(', ')}` };
    }

    return { valid: true };
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { valid: false, error: `Invalid JSON in ${path.basename(filePath)}: ${e.message}` };
    }
    // File read errors (e.g. not yet written) — don't block
    return { valid: true };
  }
}

const event = JSON.parse(process.argv[2] || '{}');
const toolName = event.tool_name || '';
const filePath = event.tool_input?.file_path || '';

if ((toolName === 'Write' || toolName === 'Edit') && isArtifact(filePath)) {
  const result = validate(filePath);
  if (!result.valid) {
    console.error(`ARTIFACT VALIDATION FAILED: ${result.error}`);
    process.exit(1);
  }
}
