#!/usr/bin/env node
// Author: Subash Karki
// gen-agent-frontmatter.js - regenerates the `model:` pin in agents/*.md from
// skills/phantom/references/model-policy.json so model policy is stated ONCE.
//
// Chain (no second source of truth): model-policy.json maps role -> profile,
// model-presets.json maps profile + host -> concrete model, and this script
// stamps the result into frontmatter. Resolution itself is delegated to
// skills/phantom/scripts/resolve-profile.mjs - never re-implemented here.
//
// Only the `model:` line is generated. `effort` is deliberately untouched:
// effort is uniform `high` and session-inherited (reference/agents.md), so it
// is not part of the policy chain.
//
// chief.md is SKIPPED by design - Chief must track whatever model the session
// runs on, so it carries no pin at all (see agents/chief.md frontmatter).
//
// RECORDED DECISIONS - do not "fix" these back:
//   clerk -> economy. Clerk is a mechanical git/gh/Jira/cost-script executor
//     with no design authority, so the cheapest rung is the intent. Policy stays
//     economy on purpose even though claude-code currently maps every profile
//     onto the same delegate model: the rung governs how Chief briefs the role,
//     and it still separates tiers on hosts whose presets are not flat.
//   steward  -> balanced (sonnet). Code simplification is judgment work: a weak
//     model's bad suggestion costs more review time than the tokens it saves.
//     Here the POLICY was wrong (it said economy) and the sonnet pin was right,
//     so policy moved up to balanced rather than the pin moving down.
//
// Usage:
//   phantom-gen-agent-frontmatter [--check] [--json] [--dir <agents dir>]
//
// Exit codes: 0 = in sync (or written); 1 = drift found under --check;
// 2 = usage/validation error.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PhantomError, exitCodeForError, reportError } = require('./lib/axi-error');

const REPO_ROOT = path.join(__dirname, '..');
const RESOLVER = path.join(REPO_ROOT, 'skills', 'phantom', 'scripts', 'resolve-profile.mjs');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');

// The host whose presets the checked-in frontmatter represents. Other hosts
// resolve the same profiles at spawn time via resolve-profile.mjs --host.
// agents/*.md pins are the claude-code rendering, consumed only by that host.
const HOST = 'claude-code';

// Roles that intentionally carry no pin. Handled explicitly, never by accident.
const EXEMPT_ROLES = new Set(['chief']);

const MARKER_PREFIX = '# GENERATED from model-policy.json';

const USAGE =
  'usage: phantom-gen-agent-frontmatter [--check] [--json] [--dir <agents dir>]\n';

function usageError(msg) {
  return new PhantomError(msg, 'VALIDATION_ERROR');
}

function resolveRole(role) {
  let raw;
  try {
    raw = execFileSync(process.execPath, [RESOLVER, '--role', role, '--host', HOST], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new PhantomError('resolve-profile.mjs failed for role ' + role + ': ' + err.message, 'IO_ERROR');
  }
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new PhantomError('resolve-profile.mjs returned non-JSON for role ' + role, 'IO_ERROR');
  }
}

// Index of the closing `---` of the leading YAML frontmatter block, or -1.
function frontmatterEnd(lines) {
  if (lines[0] !== '---') return -1;
  return lines.indexOf('---', 1);
}

function pinLines(role, resolved) {
  return [
    'model: ' + resolved.model,
    MARKER_PREFIX + ' (role: ' + role + ' -> profile: ' + resolved.requested_profile +
      ') - do not hand-edit',
  ];
}

/**
 * Return `source` with the frontmatter `model:` line (and its provenance
 * marker) set to the policy-resolved value. Hand-written rationale comments
 * elsewhere in the block are preserved. Idempotent.
 */
function applyPin(source, role, resolved) {
  const lines = source.split('\n');
  const end = frontmatterEnd(lines);
  if (end === -1) {
    throw usageError(role + ': no leading YAML frontmatter block');
  }
  const pin = pinLines(role, resolved);
  let modelIndex = -1;
  for (let i = 1; i < end; i++) {
    if (/^model:/.test(lines[i])) {
      modelIndex = i;
      break;
    }
  }
  if (modelIndex === -1) {
    lines.splice(end, 0, ...pin);
    return lines.join('\n');
  }
  const hasMarker = (lines[modelIndex + 1] || '').startsWith(MARKER_PREFIX);
  lines.splice(modelIndex, hasMarker ? 2 : 1, ...pin);
  return lines.join('\n');
}

// Line-level diff of the frontmatter block only. Changes are confined to the
// pin, so set difference reads cleaner than a full unified diff here.
function frontmatterDiff(before, after) {
  const block = (text) => {
    const lines = text.split('\n');
    const end = frontmatterEnd(lines);
    return end === -1 ? [] : lines.slice(1, end);
  };
  const oldLines = block(before);
  const newLines = block(after);
  return [
    ...oldLines.filter((l) => !newLines.includes(l)).map((l) => '- ' + l),
    ...newLines.filter((l) => !oldLines.includes(l)).map((l) => '+ ' + l),
  ];
}

/**
 * Regenerate (or check) every agent pin. `opts.check` mutates nothing.
 * Returns { host, dir, drift, written, files: [...] }.
 */
function generate(opts = {}) {
  const dir = opts.dir || AGENTS_DIR;
  const check = !!opts.check;
  const files = [];
  let drift = 0;
  let written = 0;

  const names = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort();

  for (const name of names) {
    const role = name.replace(/\.md$/, '');
    const file = path.join(dir, name);
    if (EXEMPT_ROLES.has(role)) {
      files.push({ file, role, status: 'exempt', reason: 'inherits the session model - no pin by design' });
      continue;
    }
    const resolved = resolveRole(role);
    if (!resolved.model) {
      files.push({
        file,
        role,
        profile: resolved.requested_profile,
        status: 'exempt',
        reason: 'profile ' + resolved.requested_profile + ' resolves to no concrete model (' + resolved.resolution + ')',
      });
      continue;
    }
    const before = fs.readFileSync(file, 'utf-8');
    const after = applyPin(before, role, resolved);
    const entry = {
      file,
      role,
      profile: resolved.requested_profile,
      model: resolved.model,
      status: 'ok',
    };
    if (after !== before) {
      entry.diff = frontmatterDiff(before, after);
      if (check) {
        entry.status = 'drift';
        drift++;
      } else {
        fs.writeFileSync(file, after);
        entry.status = 'written';
        written++;
      }
    }
    files.push(entry);
  }

  return { host: HOST, dir, drift, written, files };
}

function parseArgs(argv) {
  const opts = { check: false, json: false, dir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--dir') opts.dir = argv[++i];
    else throw usageError('unknown option: ' + a);
  }
  if (opts.dir !== null && !opts.dir) throw usageError('--dir requires a path');
  return opts;
}

function printHuman(result, check) {
  process.stdout.write('agent frontmatter: ' + result.files.length + ' file(s) @ host ' + result.host + '\n');
  for (const f of result.files) {
    const label = path.basename(f.file).padEnd(18);
    const detail = f.status === 'exempt'
      ? f.reason
      : f.profile + ' -> ' + f.model;
    process.stdout.write('  ' + label + f.status.toUpperCase().padEnd(8) + detail + '\n');
    for (const line of f.diff || []) process.stdout.write('      ' + line + '\n');
  }
  process.stdout.write(
    check
      ? 'verdict: ' + (result.drift ? result.drift + ' file(s) drifted from model-policy.json' : 'in sync') + '\n'
      : 'verdict: ' + result.written + ' file(s) written\n'
  );
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write('gen-agent-frontmatter: ' + e.message + '\n' + USAGE);
    process.exitCode = exitCodeForError(e);
    return;
  }

  const result = generate(opts);
  if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else printHuman(result, opts.check);
  process.exitCode = opts.check && result.drift > 0 ? 1 : 0;
}

module.exports = { generate, applyPin, main, MARKER_PREFIX, EXEMPT_ROLES };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    reportError(err);
  }
}
