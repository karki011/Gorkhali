#!/usr/bin/env node
// Author: Subash Karki

import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Route the data root through the shared codec so every host resolves the same
// neutral root as every other layer. The codec ships inside the portable skill.
const require = createRequire(import.meta.url);
const codec = require('../skills/phantom/scripts/lib/shared-state.cjs');

function optionValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || !/^[a-z0-9-]+$/.test(value)) {
    throw new Error(`${flag} requires a lowercase slug value.`);
  }
  return value;
}

export function resolveRuntime(environment = process.env, workflow = null, host = 'codex') {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runtime = {
    schema_version: 1,
    host,
    plugin_root: pluginRoot,
    portable_skill_root: join(pluginRoot, 'skills', 'phantom'),
    compatibility_scripts_root: join(pluginRoot, 'scripts'),
    data_root: codec.resolveDataRoot(process.cwd(), environment),
  };
  if (!workflow) return runtime;

  const commandFile = join(pluginRoot, 'commands', `${workflow}.md`);
  if (!existsSync(commandFile)) throw new Error(`Unknown Phantom workflow: ${workflow}`);
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

if (process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  process.stdout.write(`${JSON.stringify(
    resolveRuntime(process.env, optionValue(argv, '--command'), optionValue(argv, '--host') || 'codex'),
    null,
    2,
  )}\n`);
}
