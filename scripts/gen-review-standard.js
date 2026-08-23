#!/usr/bin/env node
// Author: Subash Karki
// gen-review-standard.js - renders the review-standard blocks (severity scale,
// finding rules, security categories, finding shape) into the prose files that
// tell reviewers what to do, from the data in scripts/lib/review-standard.js.
//
// Same shape as scripts/gen-schema-docs.js and scripts/gen-agent-frontmatter.js,
// for the same reason: F9 counted four severity vocabularies for one concept,
// all of them prose, none of them enforced. A generator plus a --check drift
// test in CI is the only thing in this repo that has ever stopped that class of
// drift (F1, F5). Prose outside the markers is hand-written and preserved.
//
// Marker form (one file may carry several blocks):
//   <!-- BEGIN GENERATED review-standard:<block> - regenerate with scripts/gen-review-standard.js; do not edit by hand -->
//   ...rendered...
//   <!-- END GENERATED review-standard:<block> -->
//
// Usage:
//   gen-review-standard.js [--dir <repo root>]     rewrite target files in place
//   gen-review-standard.js --check [--dir <root>]  verify no drift; exit 2 on drift
//   gen-review-standard.js --list
//   gen-review-standard.js --help
//
// Exit codes: 0 = clean; 2 = drift (VALIDATION_ERROR); 1 = I/O / usage / internal.

'use strict';

const fs = require('fs');
const path = require('path');
const { renderBlock, BLOCKS } = require('./lib/review-standard');
const { PhantomError, reportError } = require('./lib/axi-error');

const DEFAULT_ROOT = path.join(__dirname, '..');

// Which file carries which blocks. A file not listed here is not generated, so
// adding a target is a deliberate edit rather than a wildcard surprise.
// reference/review-standard.md is the single generated home the reviewer agent
// prompts (agents/auditor.md, agents/justice.md) point at runtime; the two
// reference docs below stay generated inline because they are read standalone,
// mid-review, where a second hop would cost more than the bytes save.
const TARGETS = Object.freeze({
  'reference/review-standard.md': [
    'security-categories',
    'severity-table',
    'confidence-table',
    'finding-rules',
    'verification-pass',
    'convergence-rule',
    'finding-shape',
  ],
  'reference/agent-protocols/justice-protocol.md': ['severity-table'],
  'reference/temperature-review.md': ['severity-table', 'confidence-table', 'finding-rules', 'verification-pass', 'finding-shape'],
});

const begin = (name) =>
  `<!-- BEGIN GENERATED review-standard:${name} - regenerate with scripts/gen-review-standard.js; do not edit by hand -->`;
const end = (name) => `<!-- END GENERATED review-standard:${name} -->`;

/**
 * Replace one named block in `content`. Unlike gen-schema-docs there is NO
 * first-run fallback that guesses the region: a target file must already carry
 * the marker pair. Guessing where a prose block starts in an agent prompt is
 * how a generator eats a paragraph nobody meant it to own.
 */
function applyBlock(content, name, file) {
  const lines = content.split('\n');
  const b = lines.findIndex((l) => l.trim() === begin(name));
  if (b === -1) {
    throw new PhantomError(`ERROR: missing marker "${begin(name)}" in ${file}`, 'VALIDATION_ERROR', [
      `Add the BEGIN/END marker pair for block "${name}" to ${file}`,
    ]);
  }
  const e = lines.findIndex((l, i) => i > b && l.trim() === end(name));
  if (e === -1) {
    throw new PhantomError(`ERROR: unterminated block "${name}" in ${file}`, 'VALIDATION_ERROR');
  }
  const rendered = renderBlock(name).split('\n');
  return [...lines.slice(0, b + 1), ...rendered, ...lines.slice(e)].join('\n');
}

/** Rendered content for one target file, against what is on disk. */
function renderFile(root, relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    throw new PhantomError(`ERROR: review-standard target not found: ${file}`, 'IO_ERROR');
  }
  const current = fs.readFileSync(file, 'utf8');
  let next = current;
  for (const name of TARGETS[relative]) next = applyBlock(next, name, relative);
  return { file, relative, current, next };
}

const TARGET_FILES = Object.keys(TARGETS);

function runWrite(root) {
  const written = [];
  for (const relative of TARGET_FILES) {
    const { file, current, next } = renderFile(root, relative);
    if (next !== current) {
      fs.writeFileSync(file, next);
      written.push(relative);
    }
  }
  if (written.length) process.stdout.write(`Regenerated: ${written.join(', ')}\n`);
  else process.stdout.write(`No changes - ${TARGET_FILES.length} review-standard target(s) already current.\n`);
  return written;
}

function runCheck(root) {
  const drifted = [];
  for (const relative of TARGET_FILES) {
    const { current, next } = renderFile(root, relative);
    if (next !== current) drifted.push(relative);
  }
  if (drifted.length) {
    throw new PhantomError(
      `Review-standard prose is out of date: ${drifted.join(', ')}`,
      'VALIDATION_ERROR',
      ['Run: node scripts/gen-review-standard.js', 'Then commit the regenerated files']
    );
  }
  process.stdout.write(
    `OK: ${TARGET_FILES.length} review-standard target(s) in sync with scripts/lib/review-standard.js.\n`
  );
  return drifted;
}

const HELP =
  'gen-review-standard.js - render the review standard into reviewer prose from scripts/lib/review-standard.js\n\n' +
  'Usage:\n' +
  '  gen-review-standard.js [--dir <repo root>]    rewrite target files in place\n' +
  '  gen-review-standard.js --check [--dir <root>] verify no drift; exit 2 on drift\n' +
  '  gen-review-standard.js --list                 print targets and their blocks\n' +
  '  gen-review-standard.js --help\n\n' +
  `Blocks: ${Object.keys(BLOCKS).join(', ')}\n`;

function parseArgs(argv) {
  const args = { check: false, help: false, list: false, dir: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--help') args.help = true;
    else if (a === '--list') args.list = true;
    else if (a === '--dir') args.dir = argv[++i];
    else throw new PhantomError(`ERROR: unknown option: ${a}`, 'USAGE');
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.list) {
    for (const [file, blocks] of Object.entries(TARGETS)) process.stdout.write(`${file}: ${blocks.join(', ')}\n`);
    return;
  }
  const root = args.dir || DEFAULT_ROOT;
  if (args.check) runCheck(root);
  else runWrite(root);
}

module.exports = { TARGETS, TARGET_FILES, begin, end, applyBlock, renderFile, runCheck, runWrite, main };

if (require.main === module) {
  try {
    main(process.argv);
  } catch (err) {
    reportError(err);
  }
}
