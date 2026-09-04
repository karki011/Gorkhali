#!/usr/bin/env node
// Author: Subash Karki

import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';

// Route the data root through the shared codec so every host resolves the same
// neutral root as every other layer. The codec ships inside the portable skill.
const require = createRequire(import.meta.url);
const codec = require('../skills/gorkhali/scripts/lib/shared-state.cjs');

function optionValue(argv, flag, pattern = /^[a-z0-9-]+$/) {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || !pattern.test(value)) {
    throw new Error(`${flag} requires a lowercase filename-safe value.`);
  }
  return value;
}

export function resolveRuntime(environment = process.env, workflow = null, host = 'codex') {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runtime = {
    schema_version: 1,
    host,
    plugin_root: pluginRoot,
    portable_skill_root: join(pluginRoot, 'skills', 'gorkhali'),
    compatibility_scripts_root: join(pluginRoot, 'scripts'),
    data_root: codec.resolveDataRoot(process.cwd(), environment),
  };
  if (!workflow) return runtime;

  const commandFile = join(pluginRoot, 'commands', `${workflow}.md`);
  if (!existsSync(commandFile)) throw new Error(`Unknown Gorkhali workflow: ${workflow}`);
  const tierResolver = join(pluginRoot, 'scripts', 'preamble-tier.js');
  const tier = JSON.parse(execFileSync(process.execPath, [tierResolver, workflow, '--json'], {
    encoding: 'utf8',
  }));
  const conditionalPreambles = tier.conditionalContexts.map((entry) => {
    const match = entry.match(/^([^ ]+)(?: \((.+)\))?$/);
    return {
      file: join(pluginRoot, 'commands', match[1]),
      condition: match[2] || 'when activated',
    };
  });
  const explicitPreambles = workflow === 'detective'
    ? conditionalPreambles.map((entry) => entry.file)
    : [];
  return {
    ...runtime,
    workflow,
    command_file: commandFile,
    preamble_tier: tier.tier,
    preamble_files: [
      ...tier.sharedContexts.map((file) => join(pluginRoot, 'commands', file)),
      ...explicitPreambles,
    ],
    conditional_preamble_files: conditionalPreambles,
  };
}

export function readReference(runtime, slug) {
  const referenceFiles = {
    'comment-discipline.md': 'comment-discipline.md',
  };
  const relativeFile = referenceFiles[slug];
  if (!relativeFile) throw new Error(`Unknown Gorkhali reference: ${slug}`);

  let referencesRoot;
  let target;
  try {
    referencesRoot = realpathSync(join(runtime.portable_skill_root, 'references'));
    target = realpathSync(join(referencesRoot, relativeFile));
  } catch {
    throw new Error(`Gorkhali reference is unavailable: ${slug}`);
  }
  if (target !== referencesRoot && !target.startsWith(`${referencesRoot}${sep}`)) {
    throw new Error(`Gorkhali reference escapes the portable references directory: ${slug}`);
  }

  let targetStat;
  try {
    targetStat = statSync(target);
    accessSync(target, constants.R_OK);
  } catch {
    throw new Error(`Gorkhali reference is unreadable: ${slug}`);
  }
  if (!targetStat.isFile()) throw new Error(`Gorkhali reference is not a regular file: ${slug}`);
  return readFileSync(target);
}

if (process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const runtime = resolveRuntime(
    process.env,
    optionValue(argv, '--command'),
    optionValue(argv, '--host') || 'codex',
  );
  const reference = optionValue(argv, '--read-reference', /^[a-z0-9-]+\.md$/);
  if (reference) {
    process.stdout.write(readReference(runtime, reference));
  } else {
    process.stdout.write(`${JSON.stringify(runtime, null, 2)}\n`);
  }
}
