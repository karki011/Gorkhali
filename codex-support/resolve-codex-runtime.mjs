#!/usr/bin/env node
// Author: Subash Karki

import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function commandName(argv) {
  const index = argv.indexOf('--command');
  if (index < 0) return null;
  const name = argv[index + 1];
  if (!name || !/^[a-z0-9-]+$/.test(name)) throw new Error('--command requires a workflow slug.');
  return name;
}

export function resolveCodexRuntime(environment = process.env, workflow = null) {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runtime = {
    schema_version: 1,
    plugin_root: pluginRoot,
    portable_skill_root: join(pluginRoot, 'skills', 'phantom'),
    compatibility_scripts_root: join(pluginRoot, 'scripts'),
    data_root: resolve(environment.PHANTOM_DATA || join(homedir(), '.phantom')),
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
  const explicitPreambles = workflow === 'hound'
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
  process.stdout.write(`${JSON.stringify(resolveCodexRuntime(process.env, commandName(process.argv.slice(2))), null, 2)}\n`);
}
