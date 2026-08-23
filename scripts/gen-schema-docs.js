#!/usr/bin/env node
// Author: Subash Karki
// gen-schema-docs.js - renders the field tables in reference/schemas/*.md from
// the SCHEMAS data exported by scripts/validate-artifact.js (the single source of
// truth). Only the artifact types the validator covers are owned; each owned file
// gets its field table regenerated between BEGIN/END markers, and EVERYTHING else
// in the file (intro prose, the JSON example, extended-template sections) is
// hand-written and preserved untouched.
//
// Usage:
//   gen-schema-docs.js [--dir <schemas-dir>]     rewrite owned files in place
//   gen-schema-docs.js --check [--dir <dir>]     verify no drift; exit 2 on drift
//   gen-schema-docs.js --help
//
// Exit codes: 0 = clean; 2 = drift (VALIDATION_ERROR); 1 = I/O / usage / internal.

'use strict';

const fs = require('fs');
const path = require('path');
const { SCHEMAS } = require('./validate-artifact');
const { GorkhaliError, reportError } = require('./lib/axi-error');

const DEFAULT_DIR = path.join(__dirname, '..', 'reference', 'schemas');

// Files that carry these markers are owned by the generator. Prose outside them
// survives regeneration; the block inside is data-derived and must not be edited.
const BEGIN = '<!-- BEGIN GENERATED FIELDS - regenerate with scripts/gen-schema-docs.js; do not edit by hand -->';
const END = '<!-- END GENERATED FIELDS -->';

// Markdown table cells can't contain a bare pipe - escape it. Field/required/
// description cells never contain one; type cells store enum unions with raw ` | `
// and this is where they become `\|`.
const cell = (s) => String(s).replace(/\|/g, '\\|');

function renderBlock(fields) {
  const header = '| Field | Type | Required | Description |';
  const sep = '| --- | --- | --- | --- |';
  const rows = fields.map(
    (f) => `| ${cell(f.field)} | ${cell(f.type)} | ${cell(f.required)} | ${cell(f.description)} |`
  );
  return [BEGIN, header, sep, ...rows, END].join('\n');
}

// Replace the generated block in `content`. If markers are present, swap what's
// between them; otherwise (first run) swap the first Markdown table - the field
// table always leads each file, ahead of the JSON example and any later tables.
function applyGeneratedBlock(content, fields, file) {
  const block = renderBlock(fields).split('\n');
  const lines = content.split('\n');

  const bIdx = lines.findIndex((l) => l.trim() === BEGIN);
  if (bIdx !== -1) {
    const eIdx = lines.findIndex((l, i) => i > bIdx && l.trim() === END);
    if (eIdx === -1) {
      throw new GorkhaliError(`ERROR: unterminated generated block in ${file}`, 'VALIDATION_ERROR');
    }
    return [...lines.slice(0, bIdx), ...block, ...lines.slice(eIdx + 1)].join('\n');
  }

  const first = lines.findIndex((l) => /^\s*\|/.test(l));
  if (first === -1) {
    throw new GorkhaliError(`ERROR: no field table found in ${file}`, 'IO_ERROR');
  }
  let last = first;
  while (last + 1 < lines.length && /^\s*\|/.test(lines[last + 1])) last++;
  return [...lines.slice(0, first), ...block, ...lines.slice(last + 1)].join('\n');
}

function ownedFile(dir, type) {
  return path.join(dir, `${type}.md`);
}

/** Compute the rendered content for one type against its committed file on disk. */
function renderFile(dir, type) {
  const file = ownedFile(dir, type);
  if (!fs.existsSync(file)) {
    throw new GorkhaliError(`ERROR: schema file not found: ${file}`, 'IO_ERROR');
  }
  const current = fs.readFileSync(file, 'utf8');
  return { file, current, next: applyGeneratedBlock(current, SCHEMAS[type].fields, file) };
}

const OWNED_TYPES = Object.keys(SCHEMAS);

function runWrite(dir) {
  const written = [];
  for (const type of OWNED_TYPES) {
    const { file, current, next } = renderFile(dir, type);
    if (next !== current) {
      fs.writeFileSync(file, next);
      written.push(path.basename(file));
    }
  }
  if (written.length) process.stdout.write(`Regenerated: ${written.join(', ')}\n`);
  else process.stdout.write(`No changes - ${OWNED_TYPES.length} schema doc(s) already current.\n`);
}

function runCheck(dir) {
  const drifted = [];
  for (const type of OWNED_TYPES) {
    const { file, current, next } = renderFile(dir, type);
    if (next !== current) drifted.push(path.basename(file));
  }
  if (drifted.length) {
    throw new GorkhaliError(
      `Schema docs are out of date: ${drifted.join(', ')}`,
      'VALIDATION_ERROR',
      ['Run: node scripts/gen-schema-docs.js', 'Then commit the regenerated reference/schemas/*.md']
    );
  }
  process.stdout.write(`OK: ${OWNED_TYPES.length} schema doc(s) in sync with validate-artifact.js.\n`);
}

const HELP =
  'gen-schema-docs.js - render reference/schemas/*.md from validate-artifact.js SCHEMAS\n\n' +
  'Usage:\n' +
  '  gen-schema-docs.js [--dir <schemas-dir>]   rewrite owned files in place\n' +
  '  gen-schema-docs.js --check [--dir <dir>]   verify no drift; exit 2 on drift\n' +
  '  gen-schema-docs.js --help\n\n' +
  `Owned types: ${OWNED_TYPES.join(', ')}\n`;

function parseArgs(argv) {
  const args = { check: false, help: false, dir: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--help') args.help = true;
    else if (a === '--dir') args.dir = argv[++i];
    else throw new GorkhaliError(`ERROR: unknown option: ${a}`, 'USAGE');
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  const dir = args.dir || DEFAULT_DIR;
  if (args.check) runCheck(dir);
  else runWrite(dir);
}

module.exports = { SCHEMAS, renderBlock, applyGeneratedBlock, renderFile, runCheck, runWrite, main, BEGIN, END };

if (require.main === module) {
  try {
    main(process.argv);
  } catch (err) {
    reportError(err);
  }
}
