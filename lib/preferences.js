// Author: Subash Karki
// preferences.js - a capped two-layer preferences loader. Both layers live
// under the Gorkhali data root (never inside the repo checkout, and never
// committed): a per-repo file and a global fallback. One developer's
// preferences are not another's, so the per-repo file replaces the global
// file outright rather than merging with it.
//
// Layers, in precedence order:
//   <dataRoot>/repos/<repo>/preferences.md   (per-repo - same root sessions use)
//   <dataRoot>/preferences.md                (global)
//
// Both paths are resolved through lib/paths.js so the GORKHALI_DATA override
// always applies. Nothing here joins a path onto a repo checkout.
'use strict';

const fs = require('fs');
const path = require('path');
const { dataRoot, repoDir } = require('./paths');

const MAX_LINES = 20;

// The single literal header every command/agent prompt uses to open an
// injected preferences block, so every caller imports one string.
const PREFERENCES_BLOCK_HEADER = '## User Preferences (verbatim)';

/**
 * The two candidate preference file paths for a repo, in precedence order:
 * per-repo first, then global. Both come from lib/paths.js's data root, so
 * every returned path starts with that root.
 */
function preferencePaths(repo, cwd) {
  const perRepo = path.join(repoDir(repo, cwd), 'preferences.md');
  const global = path.join(dataRoot(cwd), 'preferences.md');
  return [perRepo, global];
}

function readFileIfPresent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    // Missing or unreadable: treated the same - fall through to the next
    // layer (or to "nothing found" if there is no next layer).
    return null;
  }
}

function nonEmptyLines(text) {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

/**
 * Read preferences for a repo. Tries the per-repo file first; only when it
 * is absent or unreadable does the global file get read - the per-repo file
 * never merges with the global one, it replaces it. The result is capped at
 * the first 20 non-empty lines and reports which layer supplied the text and
 * whether the cap truncated it. Returns an empty string when neither file
 * exists (or neither is readable).
 */
function readPreferences(repo, cwd) {
  const [repoLayerFile, globalPath] = preferencePaths(repo, cwd);

  let layer = 'none';
  let raw = readFileIfPresent(repoLayerFile);
  if (raw !== null) {
    layer = 'repo';
  } else {
    raw = readFileIfPresent(globalPath);
    if (raw !== null) layer = 'global';
  }

  if (layer === 'none') {
    return { text: '', layer, truncated: false };
  }

  const lines = nonEmptyLines(raw);
  const truncated = lines.length > MAX_LINES;
  return { text: lines.slice(0, MAX_LINES).join('\n'), layer, truncated };
}

module.exports = {
  preferencePaths,
  readPreferences,
  PREFERENCES_BLOCK_HEADER,
};
