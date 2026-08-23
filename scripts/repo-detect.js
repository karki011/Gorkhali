#!/usr/bin/env node
// Author: Subash Karki
// repo-detect.js - emits the per-repo FACTS that commands/_shared-repo-detection.md's
// policy consumes, as one compact JSON object, so command preambles stop
// restating discovery prose the runtime can compute. Read-only: no writes, and
// every fact degrades (null / false / {}) instead of throwing - a fact the
// script could not establish is stated as absent, never guessed.
//
// Usage:
//   node scripts/repo-detect.js [--workspace <path>]   human-readable facts
//   node scripts/repo-detect.js --json [--workspace <path>]
//
// Exit codes: 0 always (informational tool); 2 on usage error.

'use strict';

const fs = require('fs');
const path = require('path');
const { detectRepo, aliasCandidates, gorkhaliData } = require('./lib/gorkhali-paths');
const { GorkhaliError, exitCodeForError, reportError } = require('./lib/axi-error');

// Marker tables lifted from commands/_shared-repo-detection.md - the doc keeps
// the POLICY (what the facts mean), this script computes the facts. First match
// wins in each table.
const STACK_MARKERS = [
  [['go.mod'], 'go'],
  [['Cargo.toml'], 'rust'],
  [['pyproject.toml', 'setup.py'], 'python'],
  [['package.json'], 'node'],
  [['mix.exs'], 'elixir'],
  [['build.gradle', 'pom.xml'], 'jvm'],
];
const PACKAGE_MANAGER_MARKERS = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];
const MONOREPO_MARKERS = [
  ['nx.json', 'nx'],
  ['turbo.json', 'turborepo'],
  ['pnpm-workspace.yaml', 'pnpm-workspaces'],
];
// UI layer: a components/pages/ui directory, a styled-UI dependency, or any
// .tsx/.jsx source file (bounded walk - node_modules and hidden dirs skipped).
const UI_DIRS = ['libs/ui', 'src/components', 'src/pages'];
const UI_DEP_RE = /^(@chakra-ui\/|@mui\/|tailwindcss$)/;

const VERIFY_SCRIPT_KEYS = ['test', 'lint', 'build', 'typecheck'];

function exists(root, rel) {
  try {
    return fs.existsSync(path.join(root, rel));
  } catch (_) {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function detectStack(root) {
  for (const [markers, stack] of STACK_MARKERS) {
    if (markers.some((m) => exists(root, m))) return stack;
  }
  return null;
}

function detectFirst(root, table) {
  for (const [marker, value] of table) {
    if (exists(root, marker)) return value;
  }
  return null;
}

function hasJsxSource(root, dir, depth) {
  if (depth > 3) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return false;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasJsxSource(root, full, depth + 1)) return true;
    } else if (/\.[jt]sx$/.test(entry.name)) {
      return true;
    }
  }
  return false;
}

function detectUi(root) {
  if (UI_DIRS.some((d) => exists(root, d))) return true;
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg) {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    if (deps.some((d) => UI_DEP_RE.test(d))) return true;
  }
  return hasJsxSource(root, root, 0);
}

// Verification Command Discovery (precedence policy lives in
// _shared-repo-detection.md): package.json scripts, then Makefile/justfile/
// Taskfile targets. Repo-instruction files (CLAUDE.md/AGENTS.md) outrank these
// but are prose - the model reads them itself; this script reports the
// machine-readable layer only.
function detectVerifyCommands(root) {
  const found = {};
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg && pkg.scripts) {
    for (const key of VERIFY_SCRIPT_KEYS) {
      if (typeof pkg.scripts[key] === 'string' && pkg.scripts[key].trim()) {
        found[key] = { command: key, source: 'package.json' };
      }
    }
  }
  for (const [file, tool] of [['Makefile', 'make'], ['justfile', 'just'], ['Taskfile.yml', 'task']]) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch (_) {
      continue;
    }
    for (const key of VERIFY_SCRIPT_KEYS) {
      if (!found[key] && new RegExp(`^${key}\\s*:`, 'm').test(text)) {
        found[key] = { command: `${tool} ${key}`, source: file };
      }
    }
  }
  return found;
}

function detectFacts(workspace) {
  const root = path.resolve(workspace || process.cwd());
  const facts = {
    workspace: root,
    repo_id: null,
    aliases: [],
    data_root: null,
    stack: detectStack(root),
    package_manager: detectFirst(root, PACKAGE_MANAGER_MARKERS),
    monorepo: detectFirst(root, MONOREPO_MARKERS),
    has_ui: detectUi(root),
    verify_commands: detectVerifyCommands(root),
  };
  try {
    facts.repo_id = detectRepo(root);
    facts.aliases = aliasCandidates(facts.repo_id);
    facts.data_root = gorkhaliData(root);
  } catch (_) {
    // Repo identity must never break detection of the rest - fail open.
  }
  return facts;
}

function usageError(msg) {
  return new GorkhaliError(msg, 'VALIDATION_ERROR');
}

function parseArgs(argv) {
  const opts = { json: false, workspace: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--workspace') opts.workspace = argv[++i];
    else throw usageError('unknown option: ' + a);
  }
  if (opts.workspace === '') throw usageError('--workspace requires a path');
  return opts;
}

function printHuman(facts) {
  const verify = Object.entries(facts.verify_commands)
    .map(([key, v]) => `${key}=${v.command} (${v.source})`)
    .join(', ');
  process.stdout.write(`repo-detect @ ${facts.workspace}\n`);
  process.stdout.write(`  repo_id:        ${facts.repo_id}\n`);
  process.stdout.write(`  aliases:        ${facts.aliases.length ? facts.aliases.join(', ') : '(none)'}\n`);
  process.stdout.write(`  data_root:      ${facts.data_root}\n`);
  process.stdout.write(`  stack:          ${facts.stack}\n`);
  process.stdout.write(`  package_manager:${facts.package_manager ? ' ' + facts.package_manager : ' null'}\n`);
  process.stdout.write(`  monorepo:       ${facts.monorepo}\n`);
  process.stdout.write(`  has_ui:         ${facts.has_ui}\n`);
  process.stdout.write(`  verify_commands:${verify ? ' ' + verify : ' {}'}\n`);
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const facts = detectFacts(opts.workspace);
  if (opts.json) process.stdout.write(`${JSON.stringify(facts, null, 2)}\n`);
  else printHuman(facts);
}

module.exports = { detectFacts, main };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.exitCode = exitCodeForError(err);
    reportError(err);
  }
}
