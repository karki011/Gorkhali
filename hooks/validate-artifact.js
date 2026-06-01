// validate-artifact.js — PostToolUse hook
// Validates JSON artifacts in <data>/repos/<repo>/sessions/ have proper _meta headers
// Author: Subash Karki

const fs = require('fs');
const path = require('path');

const REQUIRED_META = ['writtenAt', 'gitHead', 'gitBranch', 'phase', 'skill', 'version'];

// Sessions are now per-repo: <data>/repos/<repo>/sessions. A write can target ANY
// repo's sessions dir, so match the per-repo root (<data>/repos) + a /sessions/ segment
// + .json — same artifact set as the old flat <data>/state/sessions match, just repo-aware.
function isArtifact(filePath, reposRootPath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  const reposPrefix = reposRootPath.endsWith(path.sep) ? reposRootPath : reposRootPath + path.sep;
  return (
    resolved.startsWith(reposPrefix) &&
    resolved.includes(`${path.sep}sessions${path.sep}`) &&
    resolved.endsWith('.json')
  );
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
  const { phantomData } = require('../scripts/lib/phantom-paths');
  // Per-repo sessions live under <data>/repos/<repo>/sessions; match the shared repos root.
  const REPOS_ROOT = path.join(phantomData(), 'repos');

  const event = JSON.parse(process.argv[2] || '{}');
  const toolName = event.tool_name || '';
  const filePath = event.tool_input?.file_path || '';

  if ((toolName === 'Write' || toolName === 'Edit') && isArtifact(filePath, REPOS_ROOT)) {
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
