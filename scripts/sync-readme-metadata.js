#!/usr/bin/env node
// Author: Subash Karki
// Generates README and roadmap metadata from authoritative plugin, eval, and TAP data.
'use strict';

const fs = require('fs');
const path = require('path');

const START = '<!-- generated:project-metadata:start -->';
const END = '<!-- generated:project-metadata:end -->';
const ROADMAP_START = '<!-- generated:roadmap-status:start -->';
const ROADMAP_END = '<!-- generated:roadmap-status:end -->';

function parseArgs(argv) {
  const options = {
    mode: 'check',
    root: path.join(__dirname, '..'),
    tap: process.env.PHANTOM_TEST_TAP ? path.resolve(process.env.PHANTOM_TEST_TAP) : null,
  };
  const value = (flag, index) => {
    const result = argv[index];
    if (!result || result.startsWith('--')) throw new Error(`${flag} requires a value`);
    return result;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') options.mode = 'check';
    else if (arg === '--write') options.mode = 'write';
    else if (arg === '--root') options.root = path.resolve(value(arg, ++i));
    else if (arg === '--tap') options.tap = path.resolve(value(arg, ++i));
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.tap) throw new Error('--tap is required; test counts must come from a completed TAP run');
  return options;
}

function parseTapSummary(text) {
  const input = String(text).replaceAll('\r\n', '\n');
  const finalSummary = /(?:^|\n)1\.\.(\d+)\n# tests (\d+)\n# suites (\d+)\n# pass (\d+)\n# fail (\d+)\n# cancelled (\d+)\n# skipped (\d+)\n# todo (\d+)\n# duration_ms (\d+(?:\.\d+)?)/g;
  const matches = [...input.matchAll(finalSummary)];
  const match = matches.at(-1);
  if (!match) throw new Error('TAP input is missing a complete final plan and summary');
  const trailing = input.slice(match.index + match[0].length);
  if (!/^\s*$/.test(trailing)) throw new Error('TAP input has trailing content after the final summary');

  const values = match.slice(1).map(Number);
  const [planTests, tests, , pass, fail, cancelled, skipped, todo, durationMs] = values;
  if (!values.slice(0, -1).every(Number.isSafeInteger) || !Number.isFinite(durationMs)) {
    throw new Error('TAP input has an invalid final summary');
  }
  if (tests === 0) throw new Error('refusing metadata from a TAP run with zero tests');
  if (planTests !== tests) throw new Error(`TAP plan ${planTests} does not match summary test count ${tests}`);
  const summary = {
    tests,
    pass,
    fail,
    cancelled,
    skipped,
    todo,
  };
  if (summary.fail !== 0 || summary.cancelled !== 0) {
    throw new Error(`refusing metadata from an unsuccessful test run (${summary.fail} failed, ${summary.cancelled} cancelled)`);
  }
  if (summary.pass + summary.skipped + summary.todo !== summary.tests) {
    throw new Error('TAP summary is internally inconsistent');
  }
  return summary;
}

function readProjectMetadata(root, tapPath) {
  const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  const evalDoc = JSON.parse(fs.readFileSync(path.join(root, 'evals', 'evals.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'skills', 'phantom', 'manifest.json'), 'utf8'));
  if (typeof plugin.version !== 'string' || !plugin.version) throw new Error('plugin.json version is missing');
  if (evalDoc.schema_version !== 2 || !Array.isArray(evalDoc.evals)) throw new Error('evals.json must use schema_version 2');
  if (typeof manifest.bundle_version !== 'string' || !manifest.bundle_version) {
    throw new Error('skills/phantom/manifest.json bundle_version is missing');
  }
  if (!manifest.contracts || typeof manifest.contracts !== 'object' || Array.isArray(manifest.contracts)) {
    throw new Error('skills/phantom/manifest.json contracts registry is missing');
  }
  for (const [name, contract] of Object.entries(manifest.contracts)) {
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)
      || !Number.isInteger(contract.version) || contract.version < 1
      || !Array.isArray(contract.resources) || contract.resources.length === 0) {
      throw new Error(`skills/phantom/manifest.json contract ${name} is invalid`);
    }
  }
  const evalKinds = { trigger: 0, route: 0, convention: 0 };
  for (const c of evalDoc.evals) {
    const kind = c.kind || 'trigger';
    if (!(kind in evalKinds)) throw new Error(`unknown eval kind: ${kind}`);
    evalKinds[kind]++;
  }
  return {
    version: plugin.version,
    bundleVersion: manifest.bundle_version,
    contractCount: Object.keys(manifest.contracts).length,
    tests: parseTapSummary(fs.readFileSync(tapPath, 'utf8')),
    evals: { total: evalDoc.evals.length, ...evalKinds },
  };
}

function renderRoadmapStatus(metadata) {
  return [
    ROADMAP_START,
    `Package \`${metadata.version}\` publishes portable bundle \`${metadata.bundleVersion}\` with ${metadata.contractCount} versioned contracts, ${metadata.tests.tests} completed test cases (${metadata.tests.pass} passed, ${metadata.tests.skipped} skipped, ${metadata.tests.todo} todo), and ${metadata.evals.total} declared isolated evaluation cases.`,
    ROADMAP_END,
  ].join('\n');
}

function renderMetadataBlock(metadata) {
  return [
    START,
    `[![version](https://img.shields.io/badge/version-${metadata.version}-blue)](.claude-plugin/plugin.json)`,
    `[![tests](https://img.shields.io/badge/tests-${metadata.tests.tests}-brightgreen)](test/)`,
    `[![declared evals](https://img.shields.io/badge/declared_evals-${metadata.evals.total}-brightgreen)](evals/)`,
    END,
  ].join('\n');
}

function replaceMetadataBlock(readme, block, startMarker = START, endMarker = END) {
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);
  if (start < 0 || end < start) throw new Error('generated metadata markers are missing or out of order');
  return `${readme.slice(0, start)}${block}${readme.slice(end + endMarker.length)}`;
}

function syncMetadata(options) {
  const readmePath = path.join(options.root, 'README.md');
  const roadmapPath = path.join(options.root, 'ROADMAP.md');
  const current = fs.readFileSync(readmePath, 'utf8');
  const currentRoadmap = fs.readFileSync(roadmapPath, 'utf8');
  const metadata = readProjectMetadata(options.root, options.tap);
  const expected = replaceMetadataBlock(current, renderMetadataBlock(metadata));
  const expectedRoadmap = replaceMetadataBlock(
    currentRoadmap,
    renderRoadmapStatus(metadata),
    ROADMAP_START,
    ROADMAP_END,
  );
  if (options.mode === 'write') {
    fs.writeFileSync(readmePath, expected);
    fs.writeFileSync(roadmapPath, expectedRoadmap);
    return { changed: expected !== current || expectedRoadmap !== currentRoadmap, metadata };
  }
  if (expected !== current || expectedRoadmap !== currentRoadmap) {
    throw new Error('generated README or roadmap metadata is stale; run sync-readme-metadata.js --write with a passing TAP file');
  }
  return { changed: false, metadata };
}

function main(argv) {
  const options = parseArgs(argv);
  const result = syncMetadata(options);
  const verb = options.mode === 'write' ? (result.changed ? 'updated' : 'current') : 'verified';
  console.log(`project metadata ${verb}: version ${result.metadata.version}, ${result.metadata.tests.tests} tests, ${result.metadata.evals.total} evals`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  START,
  END,
  ROADMAP_START,
  ROADMAP_END,
  parseArgs,
  parseTapSummary,
  readProjectMetadata,
  renderMetadataBlock,
  renderRoadmapStatus,
  replaceMetadataBlock,
  syncMetadata,
};
