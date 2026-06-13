// Author: Subash Karki
// config-lite.js — zero-dep config flag reader for Phantom.
//
// Resolution order (first existing file wins):
//   1. process.env.PHANTOM_CONFIG  — explicit override; tests and CI set this
//   2. phantomData()/config.yaml   — stable mutable-state root; survives plugin updates
//   3. ~/.claude/phantom/config.yaml — legacy install dir (pre-PHANTOM_DATA era)
//      Base dir overridable via PHANTOM_LEGACY_HOME (test seam: lets tests
//      isolate from a real ~/.claude/phantom/config.yaml on the host).
//
// NEVER reads from the versioned plugin cache (CLAUDE_PLUGIN_ROOT or __dirname).
// An operator's routing.enforce=true must not silently revert when the plugin updates.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let _phantomData;
try {
  _phantomData = require('./phantom-paths').phantomData;
} catch (_) {
  // fail-open: inline fallback matching phantom-paths.js logic
  _phantomData = () => process.env.PHANTOM_DATA || path.join(os.homedir(), '.claude', 'phantom-data');
}

/** First existing config file across the resolution chain, or null. */
function resolveConfigPath() {
  const candidates = [
    process.env.PHANTOM_CONFIG,
    path.join(_phantomData(), 'config.yaml'),
    path.join(process.env.PHANTOM_LEGACY_HOME || os.homedir(), '.claude', 'phantom', 'config.yaml'),
  ];
  for (const p of candidates) {
    if (!p) continue;
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch (_) { /* not found or not accessible */ }
  }
  return null;
}

/**
 * Read lines from the resolved config file.
 * Returns [] on any error (missing file, unreadable, binary garbage, etc.).
 */
function readLines() {
  try {
    const p = resolveConfigPath();
    if (!p) return [];
    const raw = fs.readFileSync(p, 'utf8');
    return raw.split('\n');
  } catch (_) {
    return [];
  }
}

/**
 * Extract raw value string for `key:` within `section:` block.
 * Scopes to the indented block that follows the unindented `<section>:` line,
 * stopping at the next unindented non-empty line (next section boundary).
 * Only accepts keys at the FIRST child indent level — deeper-nested keys are
 * ignored, preventing mis-scoped reads (e.g. section.sub.key matching section.key).
 * Returns null when section/key not found.
 */
function extractValue(section, key) {
  const lines = readLines();
  const sectionMarker = section + ':';
  const keyMarker = key + ':';

  let inSection = false;
  // Indent width of the first child line seen; -1 = not yet determined.
  let firstChildIndent = -1;

  for (const line of lines) {
    // Unindented non-empty line: section boundary
    if (line.length > 0 && line[0] !== ' ' && line[0] !== '\t' && line[0] !== '#') {
      const trimmed = line.trim();
      if (trimmed === sectionMarker || trimmed.startsWith(sectionMarker + ' ') || trimmed.startsWith(sectionMarker + '\t')) {
        inSection = true;
        firstChildIndent = -1;
      } else {
        inSection = false;
        firstChildIndent = -1;
      }
      continue;
    }

    if (!inSection) continue;

    // Within section: skip blank and comment lines (any indent)
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Measure leading whitespace of this content line
    const indent = line.length - line.trimStart().length;

    // Lock the first-child indent on first content line seen
    if (firstChildIndent === -1) firstChildIndent = indent;

    // Reject lines deeper than the first child level
    if (indent !== firstChildIndent) continue;

    if (trimmed === keyMarker || trimmed.startsWith(keyMarker + ' ') || trimmed.startsWith(keyMarker + '\t')) {
      const afterColon = trimmed.slice(keyMarker.length).trim();
      // Strip trailing comment (# ...) — but only outside quotes
      return stripTrailingComment(afterColon);
    }
  }
  return null;
}

/**
 * Strip trailing inline comment (`# ...`) from a YAML scalar value.
 * Handles single-quoted and double-quoted strings (no escape processing needed
 * for our simple flag/string use cases).
 */
function stripTrailingComment(raw) {
  if (!raw) return raw;
  // If the value is quoted, strip the comment after the closing quote
  if (raw[0] === '"' || raw[0] === "'") {
    const q = raw[0];
    const close = raw.indexOf(q, 1);
    if (close !== -1) {
      return raw.slice(0, close + 1).trim();
    }
    return raw.trim();
  }
  // Unquoted: comment starts at first ` #` (space + hash) token
  const commentIdx = raw.indexOf(' #');
  if (commentIdx !== -1) return raw.slice(0, commentIdx).trim();
  return raw.trim();
}

/**
 * Strip surrounding quotes from a string value (single or double).
 */
function stripQuotes(s) {
  if (s.length >= 2) {
    if ((s[0] === '"' && s[s.length - 1] === '"') ||
        (s[0] === "'" && s[s.length - 1] === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * Read a boolean flag from config.yaml.
 * Returns `defaultValue` when: file missing, section/key absent,
 * value is not `true`/`false`, or ANY error occurs. Never throws.
 *
 * @param {string} section  - Top-level YAML section key (e.g. 'routing')
 * @param {string} key      - Key within that section (e.g. 'enforce')
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function readFlag(section, key, defaultValue) {
  try {
    const raw = extractValue(section, key);
    if (raw === null) return defaultValue;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return defaultValue;
  } catch (_) {
    return defaultValue;
  }
}

/**
 * Read a string value from config.yaml.
 * Strips trailing comments and surrounding quotes.
 * Returns `defaultValue` on any error or when absent. Never throws.
 *
 * @param {string} section
 * @param {string} key
 * @param {string} defaultValue
 * @returns {string}
 */
function readString(section, key, defaultValue) {
  try {
    const raw = extractValue(section, key);
    if (raw === null || raw === '') return defaultValue;
    return stripQuotes(raw);
  } catch (_) {
    return defaultValue;
  }
}

module.exports = { resolveConfigPath, readFlag, readString };
