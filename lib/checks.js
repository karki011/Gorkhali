// Author: Subash Karki
// checks.js - Inspector check discovery: resolve the test, lint, build and
// typecheck commands for a repository without guessing blind.
//
// Precedence, first match per command wins (a scoped slice of the fuller
// order in skills/gorkhali/references/verification.md -- this module only
// ever reads scripts, CI workflows and stack markers, never an instruction
// file's prose or narrow per-package commands):
//   1. package.json scripts (test, lint, build, typecheck/type-check/tsc)
//   2. a CI workflow's run: lines (.github/workflows/*.yml|*.yaml)
//   3. a stack default keyed off a lockfile or manifest marker
// A command that resolves nowhere comes back null with its provenance unset,
// so Inspector records it as not observed rather than as a false failure.
//
// Pure filesystem reads. No side effects, no shelling out.

'use strict';

const fs = require('fs');
const path = require('path');

const CHECK_NAMES = ['test', 'lint', 'build', 'typecheck'];

// Alternate package.json script keys accepted for typecheck, checked in order.
const TYPECHECK_KEYS = ['typecheck', 'type-check', 'tsc'];

// Stack defaults, checked in this order -- first marker file present wins.
// Mirrors the "Stack defaults" table in verification.md. `null` means the
// stack has no universal default (repository-defined instead).
const STACK_DEFAULTS = [
  {
    marker: 'pnpm-lock.yaml',
    test: 'pnpm test',
    lint: 'pnpm lint',
    build: 'pnpm build',
    typecheck: 'pnpm exec tsc --noEmit',
  },
  {
    marker: 'yarn.lock',
    test: 'yarn test',
    lint: 'yarn lint',
    build: 'yarn build',
    typecheck: 'yarn tsc --noEmit',
  },
  {
    marker: 'bun.lockb',
    test: 'bun test',
    lint: 'bun run lint',
    build: 'bun run build',
    typecheck: 'bunx tsc --noEmit',
  },
  {
    marker: 'package-lock.json',
    test: 'npm test',
    lint: 'npm run lint',
    build: 'npm run build',
    typecheck: 'npx tsc --noEmit',
  },
  {
    marker: 'go.mod',
    test: 'go test ./...',
    lint: 'go vet ./...',
    build: 'go build ./...',
    typecheck: null,
  },
  {
    marker: 'Cargo.toml',
    test: 'cargo test',
    lint: 'cargo clippy',
    build: 'cargo build',
    typecheck: 'cargo check',
  },
  {
    marker: 'pyproject.toml',
    test: 'pytest',
    lint: null,
    build: null,
    typecheck: null,
  },
];

/** One resolved check entry: a command plus where it came from, or both null. */
function entry(command, provenance) {
  return command ? { command, provenance } : { command: null, provenance: null };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function emptyResult() {
  return {
    test: entry(null, null),
    lint: entry(null, null),
    build: entry(null, null),
    typecheck: entry(null, null),
  };
}

/** Tier 1: package.json scripts. */
function fromPackageJson(repoRoot) {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const result = emptyResult();

  if (typeof scripts.test === 'string' && scripts.test.trim()) {
    result.test = entry(scripts.test, 'package.json scripts.test');
  }
  if (typeof scripts.lint === 'string' && scripts.lint.trim()) {
    result.lint = entry(scripts.lint, 'package.json scripts.lint');
  }
  if (typeof scripts.build === 'string' && scripts.build.trim()) {
    result.build = entry(scripts.build, 'package.json scripts.build');
  }
  const typecheckKey = TYPECHECK_KEYS.find(
    (key) => typeof scripts[key] === 'string' && scripts[key].trim()
  );
  if (typecheckKey) {
    result.typecheck = entry(scripts[typecheckKey], `package.json scripts.${typecheckKey}`);
  }
  return result;
}

/**
 * Tier 2: a CI workflow's `run:` lines. Heuristic and line-based on purpose --
 * this is a backup for repositories with no package.json script, not a YAML
 * parser. The first matching run: line per check wins; a line naming
 * typecheck is checked before lint/build/test so a combined command like
 * "npm run build && tsc --noEmit" is not misread as a build-only check.
 */
function fromCiWorkflows(repoRoot) {
  const dir = path.join(repoRoot, '.github', 'workflows');
  const result = emptyResult();
  let files;
  try {
    files = fs.readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));
  } catch (_) {
    return result;
  }

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, file), 'utf-8');
    } catch (_) {
      continue;
    }
    const provenance = `CI workflow .github/workflows/${file}`;
    for (const rawLine of text.split('\n')) {
      const match = rawLine.match(/^\s*-?\s*run:\s*(.+)$/);
      if (!match) continue;
      const cmd = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (!cmd) continue;
      const lower = cmd.toLowerCase();
      if (!result.typecheck.command && (lower.includes('tsc') || lower.includes('typecheck') || lower.includes('type-check'))) {
        result.typecheck = entry(cmd, provenance);
      } else if (!result.lint.command && lower.includes('lint')) {
        result.lint = entry(cmd, provenance);
      } else if (!result.build.command && lower.includes('build')) {
        result.build = entry(cmd, provenance);
      } else if (!result.test.command && (lower.includes('pytest') || lower.includes('test'))) {
        result.test = entry(cmd, provenance);
      }
    }
  }
  return result;
}

/** Tier 3: stack default keyed off the first marker file present. */
function fromStackDefault(repoRoot) {
  const stack = STACK_DEFAULTS.find((candidate) => fs.existsSync(path.join(repoRoot, candidate.marker)));
  if (!stack) return emptyResult();
  const provenance = `stack default (${stack.marker})`;
  return {
    test: entry(stack.test, stack.test ? provenance : null),
    lint: entry(stack.lint, stack.lint ? provenance : null),
    build: entry(stack.build, stack.build ? provenance : null),
    typecheck: entry(stack.typecheck, stack.typecheck ? provenance : null),
  };
}

/**
 * Resolve test, lint, build and typecheck commands for repoRoot, first match
 * per command wins across package.json scripts, then a CI workflow, then a
 * stack default. Every entry carries { command, provenance }; an unresolved
 * check comes back as { command: null, provenance: null }.
 *
 * @param {string} repoRoot
 * @returns {{test: object, lint: object, build: object, typecheck: object}}
 */
function discoverChecks(repoRoot) {
  const root = repoRoot || process.cwd();
  const tiers = [fromPackageJson(root), fromCiWorkflows(root), fromStackDefault(root)];

  const result = emptyResult();
  for (const name of CHECK_NAMES) {
    const hit = tiers.find((tier) => tier[name] && tier[name].command);
    result[name] = hit ? hit[name] : entry(null, null);
  }
  return result;
}

module.exports = {
  CHECK_NAMES,
  discoverChecks,
};
