// validate-artifact.js — PostToolUse hook
// Validates JSON artifacts in state/sessions/ have proper _meta headers
// Author: Subash Karki

const fs = require('fs');
const path = require('path');

const REQUIRED_META = ['writtenAt', 'gitHead', 'gitBranch', 'phase', 'skill', 'version'];

function isArtifact(filePath, sessionsDirPath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  return resolved.startsWith(sessionsDirPath) && resolved.endsWith('.json');
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

function main() {
  // Resolver require lives inside the guard so a load failure fails open, not a crash.
  const { sessionsDir } = require('../scripts/lib/phantom-paths');
  const SESSIONS_DIR = sessionsDir();

  const event = JSON.parse(process.argv[2] || '{}');
  const toolName = event.tool_name || '';
  const filePath = event.tool_input?.file_path || '';

  if ((toolName === 'Write' || toolName === 'Edit') && isArtifact(filePath, SESSIONS_DIR)) {
    const result = validate(filePath);
    if (!result.valid) {
      // Real validation block — escapes the fail-open catch via process.exit (does not throw).
      console.error(`ARTIFACT VALIDATION FAILED: ${result.error}`);
      process.exit(1);
    }
  }
}

// fail open: an internal/resolver error must not masquerade as a validation block — exit 0 on any throw.
// A genuine validation failure exits 1 above (process.exit doesn't throw, so it bypasses this catch).
try {
  main();
} catch (_) {
  process.exit(0);
}
