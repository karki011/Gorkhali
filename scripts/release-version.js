#!/usr/bin/env node
// Author: Subash Karki
// release-version.js - keeps the version in sync across the three plugin
// manifests, which have never had anything enforcing agreement between them:
//
//   .claude-plugin/plugin.json        top-level  "version"
//   .claude-plugin/marketplace.json   NESTED     metadata.version
//   .codex-plugin/plugin.json         top-level  "version"
//
// Commit 7a88e0c bumped only the first and left the other two behind; the
// portable-skill validator caught it and the branch sat red until it was
// fixed by hand. This script is the fix for the root cause: no release
// tooling existed at all.
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
//   node scripts/release-version.js --check
//     --base-ref origin/main                             also require the
//                                                        feature version to
//                                                        advance beyond base
//   node scripts/release-version.js --set <semver>      write <semver> to all
//                                                        three manifests
//   node scripts/release-version.js [--json] [--root <dir>]
//
// Exit codes: 0 = in sync / write succeeded; 1 = drift under --check (or an
// unexpected internal error); 2 = usage or validation error (bad flags, bad
// semver).
//
// No pre-release or build-metadata handling - this repo has never used them.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PhantomError, exitCodeForError, reportError } = require('./lib/axi-error');
const { atomicWrite } = require('./lib/atomic');

const REPO_ROOT = path.join(__dirname, '..');

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SAFE_GIT_REF_RE = /^(?!.*(?:\.\.|@\{|[\\\s~^:?*\[]))[A-Za-z0-9._\/-]{1,255}$/;

// Matches a JSON "version" value line exactly as these manifests write it:
// leading indent, the key, the string value, an optional trailing comma.
// Group 1 is everything through the opening quote of the value; group 2 is
// the closing quote plus optional comma. Replacing only the middle preserves
// indentation and comma placement untouched.
const VERSION_LINE_RE = /^(\s*"version":\s*")[^"]*("[,]?)$/;

const USAGE =
  'usage: release-version.js [--check [--base-ref <git-ref>]] [--set <semver>] [--json] [--root <dir>]\n';

function usageError(msg) {
  return new PhantomError(msg, 'VALIDATION_ERROR');
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

// The three manifests and how each nests its "version" key. `within: null`
// means top-level; `within: 'metadata'` means one level down, under that key.
function manifestsFor(root) {
  return [
    { label: '.claude-plugin/plugin.json', file: path.join(root, '.claude-plugin', 'plugin.json'), within: null },
    { label: '.claude-plugin/marketplace.json', file: path.join(root, '.claude-plugin', 'marketplace.json'), within: 'metadata' },
    { label: '.codex-plugin/plugin.json', file: path.join(root, '.codex-plugin', 'plugin.json'), within: null },
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
      throw new PhantomError(label + ': could not find "' + within + '" block', 'IO_ERROR');
    }
    start = range.start;
    end = range.end;
  }
  for (let i = start; i < end; i++) {
    if (VERSION_LINE_RE.test(lines[i])) return i;
  }
  throw new PhantomError(
    label + ': could not find a "version" field' + (within ? ' inside "' + within + '"' : ''),
    'IO_ERROR'
  );
}

function readVersion(manifest) {
  let raw;
  try {
    raw = fs.readFileSync(manifest.file, 'utf-8');
  } catch (err) {
    throw new PhantomError(manifest.label + ': ' + err.message, 'IO_ERROR');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PhantomError(manifest.label + ': invalid JSON - ' + err.message, 'IO_ERROR');
  }
  const version = manifest.within ? parsed[manifest.within] && parsed[manifest.within].version : parsed.version;
  if (typeof version !== 'string') {
    throw new PhantomError(
      manifest.label + ': no "version" string found' + (manifest.within ? ' under "' + manifest.within + '"' : ''),
      'IO_ERROR'
    );
  }
  return version;
}

function versionFromRaw(raw, manifest) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PhantomError(manifest.label + ': invalid base JSON - ' + err.message, 'IO_ERROR');
  }
  const version = manifest.within
    ? parsed[manifest.within] && parsed[manifest.within].version
    : parsed.version;
  if (typeof version !== 'string') {
    throw new PhantomError(manifest.label + ': base manifest has no version string', 'IO_ERROR');
  }
  return validateSemver(version);
}

function sanitizedGitEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'GIT_DIR'
      || key === 'GIT_WORK_TREE'
      || key === 'GIT_INDEX_FILE'
      || key === 'GIT_OBJECT_DIRECTORY'
      || key === 'GIT_ALTERNATE_OBJECT_DIRECTORIES'
      || key === 'GIT_COMMON_DIR'
      || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) {
      delete env[key];
    }
  }
  return {
    ...env,
    GIT_CONFIG_COUNT: '0',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
  };
}

function statusAtRef(ref, opts = {}) {
  if (typeof ref !== 'string' || !SAFE_GIT_REF_RE.test(ref)) {
    throw usageError('invalid --base-ref; expected a simple Git ref such as origin/main');
  }
  const root = path.resolve(opts.root || REPO_ROOT);
  const files = manifestsFor(root).map((manifest) => {
    const repositoryPath = path.relative(root, manifest.file).split(path.sep).join('/');
    let raw;
    try {
      raw = execFileSync('git', [
        '-c', 'core.fsmonitor=false',
        '-c', 'core.hooksPath=/dev/null',
        '-C', root,
        'show', `${ref}:${repositoryPath}`,
      ], {
        encoding: 'utf8',
        env: sanitizedGitEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const detail = String(err.stderr || err.message || err).trim();
      throw new PhantomError(
        `could not read ${manifest.label} from ${ref}${detail ? `: ${detail}` : ''}`,
        'IO_ERROR'
      );
    }
    return { label: manifest.label, file: manifest.file, version: versionFromRaw(raw, manifest) };
  });
  const versions = [...new Set(files.map((file) => file.version))];
  return { root, ref, files, inSync: versions.length === 1, versions };
}

function compareSemver(left, right) {
  const a = validateSemver(left).split('.').map(Number);
  const b = validateSemver(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function baseVerdict(current, base) {
  if (!base.inSync) {
    return { advanced: false, reason: `base manifests drift at ${base.ref}: ${base.versions.join(', ')}` };
  }
  if (!current.inSync) return { advanced: false, reason: 'current manifests are not synchronized' };
  const comparison = compareSemver(current.versions[0], base.versions[0]);
  if (comparison <= 0) {
    return {
      advanced: false,
      reason: comparison === 0
        ? `feature PR version must advance beyond ${base.versions[0]}`
        : `current version ${current.versions[0]} is older than base ${base.versions[0]}`,
    };
  }
  return { advanced: true, reason: `${base.versions[0]} -> ${current.versions[0]}` };
}

/**
 * Current version of all three manifests. Read-only; mutates nothing.
 * Returns { root, files: [{ label, file, version }], inSync, versions }.
 */
function status(opts = {}) {
  const root = opts.root || REPO_ROOT;
  const files = manifestsFor(root).map((m) => ({ label: m.label, file: m.file, version: readVersion(m) }));
  const versions = [...new Set(files.map((f) => f.version))];
  const result = { root, files, inSync: versions.length <= 1, versions };
  if (opts.baseRef) {
    result.base = statusAtRef(opts.baseRef, { root });
    result.baseVerdict = baseVerdict(result, result.base);
  }
  return result;
}

/**
 * Write `newVersion` to all three manifests, changing only the version
 * line's value. A manifest already at `newVersion` is left untouched (byte
 * for byte), so re-running --set with the current version is a no-op diff.
 * Returns { root, version, files: [{ label, before, after, changed }], written }.
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
  return { root, version: newVersion, files, written: files.filter((f) => f.changed).length };
}

function parseArgs(argv) {
  const opts = { check: false, set: null, json: false, root: null, baseRef: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--set') {
      opts.set = argv[++i];
      if (!opts.set) throw usageError('--set requires a version, e.g. --set 0.2.8');
    } else if (a === '--json') opts.json = true;
    else if (a === '--base-ref') {
      opts.baseRef = argv[++i];
      if (!opts.baseRef) throw usageError('--base-ref requires a Git ref such as origin/main');
    }
    else if (a === '--root') {
      opts.root = argv[++i];
      if (!opts.root) throw usageError('--root requires a path');
    } else throw usageError('unknown option: ' + a);
  }
  if (opts.check && opts.set !== null) {
    throw usageError('--check and --set are mutually exclusive');
  }
  if (opts.baseRef !== null && !opts.check) {
    throw usageError('--base-ref requires --check');
  }
  return opts;
}

function printStatus(result) {
  process.stdout.write('manifest versions:\n');
  const width = Math.max(...result.files.map((f) => f.label.length)) + 2;
  for (const f of result.files) {
    process.stdout.write('  ' + f.label.padEnd(width) + f.version + '\n');
  }
  process.stdout.write(
    'verdict: ' +
      (result.inSync ? 'in sync' : 'DRIFT - versions do not agree (' + result.versions.join(', ') + ')') +
      '\n'
  );
  if (result.base) {
    process.stdout.write(
      `base version (${result.base.ref}): ${result.base.versions.join(', ')}\n`
      + `version advancement: ${result.baseVerdict.advanced ? 'yes' : `NO - ${result.baseVerdict.reason}`}\n`
    );
  }
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

    const result = status({ root: opts.root, baseRef: opts.baseRef });
    if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else printStatus(result);
    process.exitCode = opts.check && (!result.inSync || result.baseVerdict?.advanced === false) ? 1 : 0;
  } catch (err) {
    reportError(err);
  }
}

module.exports = {
  baseVerdict,
  compareSemver,
  manifestsFor,
  main,
  setVersion,
  status,
  statusAtRef,
  validateSemver,
};

if (require.main === module) {
  main();
}
