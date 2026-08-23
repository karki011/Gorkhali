#!/usr/bin/env node
// Author: Subash Karki
// review-gaps.js - the mechanically-derivable half of a review (B10(f)).
// Names every changed SOURCE file with no corresponding changed TEST file.
//
// This exists so one review priority stops being a judgement call. `agents/
// auditor.md` asked for "missing focused tests for non-trivial logic"; nobody can
// audit whether that was honoured, because "non-trivial" is unfalsifiable. This
// answers the narrow, checkable question instead, from the changed-file list.
//
// REPORTS, NEVER GATES: exit status is 0 whether or not gaps are found. A
// missing test does not make the diff worse than it was before, so it cannot
// clear the blocking bar (scripts/lib/review-standard.js). Findings derived
// from this output are `advisory` by construction. Use --exit-code only when a
// caller explicitly wants a non-zero signal for scripting.
//
// Usage:
//   review-gaps.js --from-git [<base>]    changed files vs <base> (default: HEAD)
//   review-gaps.js --files <a> <b> ...     explicit changed-file list
//   review-gaps.js                         reads a newline-separated list on stdin
//   review-gaps.js --json                  machine-readable output
//   review-gaps.js --exit-code             exit 1 when gaps were found
//
// Exit codes: 0 = report produced; 1 = I/O / usage (or gaps with --exit-code).

'use strict';

const { execFileSync } = require('child_process');
const { report } = require('./lib/test-companion');
const { GorkhaliError, reportError } = require('./lib/axi-error');

function changedFilesFromGit(base) {
  const args = base ? ['diff', '--name-only', base] : ['diff', '--name-only', 'HEAD'];
  let out;
  try {
    out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    throw new GorkhaliError(`ERROR: git ${args.join(' ')} failed: ${err.message}`, 'IO_ERROR', [
      'Pass the changed-file list explicitly: review-gaps.js --files <paths...>',
    ]);
  }
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function readStdin() {
  const fs = require('fs');
  try {
    return fs.readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function renderText(result) {
  const lines = [];
  if (result.checked === 0) {
    lines.push('No changed source files in this diff - nothing to check.');
  } else if (result.gaps.length === 0) {
    lines.push(`OK: all ${result.checked} changed source file(s) have a matching changed test file.`);
  } else {
    lines.push(`NO TEST CHANGE (${result.gaps.length} of ${result.checked} changed source file(s)):`);
    for (const gap of result.gaps) lines.push(`  ${gap.file}  -  ${gap.reason}`);
    lines.push('');
    lines.push('Report each as ONE advisory finding citing the source file. Advisory by');
    lines.push('construction: a missing test does not make the diff worse than before.');
  }
  return lines.join('\n') + '\n';
}

const HELP =
  'review-gaps.js - changed source files with no corresponding changed test file\n\n' +
  'Usage:\n' +
  '  review-gaps.js --from-git [<base>]   changed files vs <base> (default: HEAD)\n' +
  '  review-gaps.js --files <a> <b> ...   explicit changed-file list\n' +
  '  review-gaps.js                       newline-separated list on stdin\n\n' +
  'Options:\n' +
  '  --json        machine-readable output\n' +
  '  --exit-code   exit 1 when gaps were found (default: always 0 - this reports, it does not gate)\n' +
  '  --help\n';

function parseArgs(argv) {
  const args = { files: null, fromGit: false, base: null, json: false, exitCode: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help') args.help = true;
    else if (a === '--json') args.json = true;
    else if (a === '--exit-code') args.exitCode = true;
    else if (a === '--from-git') {
      args.fromGit = true;
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) args.base = argv[++i];
    } else if (a === '--files') {
      args.files = [];
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.files.push(argv[++i]);
    } else throw new GorkhaliError(`ERROR: unknown option: ${a}`, 'USAGE');
  }
  return args;
}

function main(argv, { stdout = process.stdout } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(HELP);
    return 0;
  }
  let files;
  if (args.files) files = args.files;
  else if (args.fromGit) files = changedFilesFromGit(args.base);
  else files = readStdin();

  const result = report(files);
  stdout.write(args.json ? JSON.stringify(result, null, 2) + '\n' : renderText(result));
  return args.exitCode && result.gaps.length ? 1 : 0;
}

module.exports = { main, renderText, changedFilesFromGit };

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (err) {
    reportError(err);
  }
}
