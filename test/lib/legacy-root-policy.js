// Author: Subash Karki
// legacy-root-policy.js -- shared scanner for provider-owned legacy state
// root literals (old Claude and Codex data-root conventions, pre-unification).
// Used by test/state-root-literals.test.js (the phantom-data-named detector)
// and test/active-state-paths.test.js (the broader policy that also covers
// the other retired roots). Kept as one walker so both suites agree on repo
// enumeration, allowlist matching, and stale-entry detection.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function repositoryFiles(excludeFiles = []) {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean)
    .filter(file => !excludeFiles.includes(file));
}

function lineAt(text, offset) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = text.indexOf('\n', offset);
  return text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
}

/**
 * Scan every tracked file for `detectors`, flagging any hit whose line is not
 * covered by a matching `allowlist` entry (same file, same detector kind,
 * line includes the entry's context substring). Returns the violation list
 * plus a usage map so callers can also assert every allowlist entry fired
 * exactly once (catches stale/ambiguous entries).
 */
function scanForLegacyRoots({ detectors, allowlist, excludeFiles = [] }) {
  const violations = [];
  const usage = new Map();

  for (const file of repositoryFiles(excludeFiles)) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (text.includes('\0')) continue;

    for (const detector of detectors) {
      detector.pattern.lastIndex = 0;
      for (const match of text.matchAll(detector.pattern)) {
        const line = lineAt(text, match.index);
        const entries = allowlist.get(file) || [];
        const allowed = entries.find(entry =>
          entry.kind === detector.kind && line.includes(entry.context),
        );

        if (!allowed) {
          const lineNumber = text.slice(0, match.index).split('\n').length;
          violations.push(`${file}:${lineNumber}: ${line.trim()}`);
          continue;
        }

        const key = `${file}\0${allowed.kind}\0${allowed.context}`;
        usage.set(key, (usage.get(key) || 0) + 1);
      }
    }
  }

  return { violations, usage };
}

function assertAllowlistFullyUsed(assert, allowlist, usage) {
  for (const [file, entries] of allowlist) {
    for (const entry of entries) {
      const key = `${file}\0${entry.kind}\0${entry.context}`;
      assert.equal(
        usage.get(key),
        1,
        `stale or ambiguous legacy allowlist entry: ${file} (${entry.reason})`,
      );
    }
  }
}

module.exports = {
  ROOT,
  repositoryFiles,
  lineAt,
  scanForLegacyRoots,
  assertAllowlistFullyUsed,
};
