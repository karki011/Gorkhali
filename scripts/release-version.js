#!/usr/bin/env node
// Author: Subash Karki
// release-version.js - keeps the version in sync across the four plugin
// manifests and the README badge, which have never had anything enforcing
// agreement between them:
//
//   .claude-plugin/plugin.json        top-level  "version"
//   .claude-plugin/marketplace.json   NESTED     metadata.version
//   .codex-plugin/plugin.json         top-level  "version"
//   .kimi-plugin/plugin.json          top-level  "version"
//   README.md                         shields.io version badge
//
// Commit 7a88e0c bumped only the first and left the other two behind; the
// portable-skill validator caught it and the branch sat red until it was
// fixed by hand. This script is the fix for the root cause: no release
// tooling existed at all. The README badge later sat at 1.0.0 while the
// manifests reached 1.0.4 because it was never part of --check.
//
// These are hand-maintained JSON files (2-space indent, stable key order), so
// writes never round-trip through JSON.stringify - that would be free to
// reformat or reorder keys. Instead the version line is located by regex and
// only its value is replaced; every other byte in the file is untouched.
//
// Usage:
//   node scripts/release-version.js                    print each manifest's
//                                                        version + verdict
//   node scripts/release-version.js --check             same, exit 1 on drift
//   node scripts/release-version.js --set <semver>      write <semver> to all
//                                                        four manifests and README
//   node scripts/release-version.js [--json] [--root <dir>]
//
// Exit codes: 0 = in sync / write succeeded; 1 = drift under --check (or an
// unexpected internal error); 2 = usage or validation error (bad flags, bad
// semver).
//
// No pre-release or build-metadata handling - this repo has never used them.

'use strict';

const fs = require('fs');
const path = require('path');
const { GorkhaliError, exitCodeForError, reportError } = require('./lib/axi-error');
const { atomicWrite } = require('./lib/atomic');

const REPO_ROOT = path.join(__dirname, '..');

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// Matches a JSON "version" value line exactly as these manifests write it:
// leading indent, the key, the string value, an optional trailing comma.
// Group 1 is everything through the opening quote of the value; group 2 is
// the closing quote plus optional comma. Replacing only the middle preserves
// indentation and comma placement untouched.
const VERSION_LINE_RE = /^(\s*"version":\s*")[^"]*("[,]?)$/;

// README badge as shipped: shields.io version-* then -blue, linking the
// Claude plugin manifest. Group 1 is the semver. Anything else is drift.
const README_BADGE_RE =
  /\[!\[version\]\(https:\/\/img\.shields\.io\/badge\/version-(\d+\.\d+\.\d+)-blue\)\]\(\.claude-plugin\/plugin\.json\)/;

const USAGE =
  'usage: release-version.js [--check] [--set <semver>] [--json] [--root <dir>]\n';

function usageError(msg) {
  return new GorkhaliError(msg, 'VALIDATION_ERROR');
}

function validateSemver(version) {
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    throw usageError(
      'invalid version "' + version + '" - expected MAJOR.MINOR.PATCH (e.g. 0.2.8); ' +
        'no pre-release or build metadata'
    );
  }
  return version;
}

// The four manifests and how each nests its "version" key. `within: null`
// means top-level; `within: 'metadata'` means one level down, under that key.
function manifestsFor(root) {
  return [
    { label: '.claude-plugin/plugin.json', file: path.join(root, '.claude-plugin', 'plugin.json'), within: null },
    { label: '.claude-plugin/marketplace.json', file: path.join(root, '.claude-plugin', 'marketplace.json'), within: 'metadata' },
    { label: '.codex-plugin/plugin.json', file: path.join(root, '.codex-plugin', 'plugin.json'), within: null },
    { label: '.kimi-plugin/plugin.json', file: path.join(root, '.kimi-plugin', 'plugin.json'), within: null },
  ];
}

// Line range [start, end) of the object nested under `key` at the top of
// `lines`, found by matching the opening `"key": {` and its closing brace at
// the same indent. Returns null when `key` is not found.
function findBlockRange(lines, key) {
  const openRe = new RegExp('^(\\s*)"' + key + '":\\s*\\{\\s*$');
  const openIdx = lines.findIndex((l) => openRe.test(l));
  if (openIdx === -1) return null;
  const indent = lines[openIdx].match(/^(\s*)/)[1];
  const closeRe = new RegExp('^' + indent + '\\}');
  const closeIdx = lines.findIndex((l, i) => i > openIdx && closeRe.test(l));
  if (closeIdx === -1) return null;
  return { start: openIdx + 1, end: closeIdx };
}

function findVersionLineIndex(lines, within, label) {
  let start = 0;
  let end = lines.length;
  if (within) {
    const range = findBlockRange(lines, within);
    if (!range) {
      throw new GorkhaliError(label + ': could not find "' + within + '" block', 'IO_ERROR');
    }
    start = range.start;
    end = range.end;
  }
  for (let i = start; i < end; i++) {
    if (VERSION_LINE_RE.test(lines[i])) return i;
  }
  throw new GorkhaliError(
    label + ': could not find a "version" field' + (within ? ' inside "' + within + '"' : ''),
    'IO_ERROR'
  );
}

function readmeFile(root) {
  return path.join(root, 'README.md');
}

function readReadmeVersion(root) {
  const file = readmeFile(root);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    throw new GorkhaliError('README.md: ' + err.message, 'IO_ERROR');
  }
  const match = raw.match(README_BADGE_RE);
  if (!match) {
    throw new GorkhaliError(
      'README.md: could not find shields.io version badge linking to .claude-plugin/plugin.json',
      'IO_ERROR'
    );
  }
  return match[1];
}

function setReadmeVersion(root, newVersion) {
  const file = readmeFile(root);
  const before = readReadmeVersion(root);
  let changed = false;
  if (before !== newVersion) {
    const raw = fs.readFileSync(file, 'utf-8');
    const next = raw.replace(
      README_BADGE_RE,
      '[![version](https://img.shields.io/badge/version-' +
        newVersion +
        '-blue)](.claude-plugin/plugin.json)'
    );
    atomicWrite(file, next);
    changed = true;
  }
  return { label: 'README.md', file: file, before, after: newVersion, changed };
}

function readVersion(manifest) {
  let raw;
  try {
    raw = fs.readFileSync(manifest.file, 'utf-8');
  } catch (err) {
    throw new GorkhaliError(manifest.label + ': ' + err.message, 'IO_ERROR');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new GorkhaliError(manifest.label + ': invalid JSON - ' + err.message, 'IO_ERROR');
  }
  const version = manifest.within ? parsed[manifest.within] && parsed[manifest.within].version : parsed.version;
  if (typeof version !== 'string') {
    throw new GorkhaliError(
      manifest.label + ': no "version" string found' + (manifest.within ? ' under "' + manifest.within + '"' : ''),
      'IO_ERROR'
    );
  }
  return version;
}

/**
 * Current version of all four manifests plus the README badge. Read-only;
 * mutates nothing. Returns { root, files: [{ label, file, version }], inSync, versions }.
 */
function status(opts = {}) {
  const root = opts.root || REPO_ROOT;
  const files = manifestsFor(root).map((m) => ({ label: m.label, file: m.file, version: readVersion(m) }));
  files.push({ label: 'README.md', file: readmeFile(root), version: readReadmeVersion(root) });
  const versions = [...new Set(files.map((f) => f.version))];
  return { root, files, inSync: versions.length <= 1, versions };
}

/**
 * Write `newVersion` to all four manifests and the README badge, changing
 * only the version value. A file already at `newVersion` is left untouched
 * (byte for byte), so re-running --set with the current version is a no-op
 * diff. Returns { root, version, files: [{ label, before, after, changed }], written }.
 */
function setVersion(newVersion, opts = {}) {
  validateSemver(newVersion);
  const root = opts.root || REPO_ROOT;
  const files = manifestsFor(root).map((m) => {
    const before = readVersion(m);
    let changed = false;
    if (before !== newVersion) {
      const raw = fs.readFileSync(m.file, 'utf-8');
      const lines = raw.split('\n');
      const idx = findVersionLineIndex(lines, m.within, m.label);
      const match = lines[idx].match(VERSION_LINE_RE);
      lines[idx] = match[1] + newVersion + match[2];
      atomicWrite(m.file, lines.join('\n'));
      changed = true;
    }
    return { label: m.label, before, after: newVersion, changed };
  });
  files.push(setReadmeVersion(root, newVersion));
  return { root, version: newVersion, files, written: files.filter((f) => f.changed).length };
}

function parseArgs(argv) {
  const opts = { check: false, set: null, json: false, root: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--set') {
      opts.set = argv[++i];
      if (!opts.set) throw usageError('--set requires a version, e.g. --set 0.2.8');
    } else if (a === '--json') opts.json = true;
    else if (a === '--root') {
      opts.root = argv[++i];
      if (!opts.root) throw usageError('--root requires a path');
    } else throw usageError('unknown option: ' + a);
  }
  if (opts.check && opts.set !== null) {
    throw usageError('--check and --set are mutually exclusive');
  }
  return opts;
}

function printStatus(result) {
  process.stdout.write('release versions:\n');
  const width = Math.max(...result.files.map((f) => f.label.length)) + 2;
  for (const f of result.files) {
    process.stdout.write('  ' + f.label.padEnd(width) + f.version + '\n');
  }
  process.stdout.write(
    'verdict: ' +
      (result.inSync ? 'in sync' : 'DRIFT - versions do not agree (' + result.versions.join(', ') + ')') +
      '\n'
  );
}

function printSet(result) {
  process.stdout.write('release-version: set ' + result.version + '\n');
  const width = Math.max(...result.files.map((f) => f.label.length)) + 2;
  for (const f of result.files) {
    const detail = f.changed ? f.before + ' -> ' + f.after : f.after + ' (already set)';
    process.stdout.write('  ' + f.label.padEnd(width) + detail + '\n');
  }
  process.stdout.write('verdict: ' + result.written + ' file(s) written\n');
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write('release-version: ' + e.message + '\n' + USAGE);
    process.exitCode = exitCodeForError(e);
    return;
  }

  try {
    if (opts.set !== null) {
      const result = setVersion(opts.set, { root: opts.root });
      if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else printSet(result);
      process.exitCode = 0;
      return;
    }

    const result = status({ root: opts.root });
    if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else printStatus(result);
    process.exitCode = opts.check && !result.inSync ? 1 : 0;
  } catch (err) {
    reportError(err);
  }
}

module.exports = { status, setVersion, validateSemver, manifestsFor, main };

if (require.main === module) {
  main();
}
