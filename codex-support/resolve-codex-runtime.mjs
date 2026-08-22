#!/usr/bin/env node
// Author: Subash Karki
// Backward-compatible shim: the canonical resolver moved to
// host-support/resolve-runtime.mjs. This keeps the Codex-era path and the
// resolveCodexRuntime export working for installed Codex adapters.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveRuntime } from '../host-support/resolve-runtime.mjs';

export function resolveCodexRuntime(environment = process.env, workflow = null) {
  return resolveRuntime(environment, workflow, 'codex');
}

if (process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf('--command');
  const workflow = index < 0 ? null : argv[index + 1];
  if (workflow !== null && !/^[a-z0-9-]+$/.test(workflow || '')) {
    throw new Error('--command requires a workflow slug.');
  }
  process.stdout.write(`${JSON.stringify(resolveCodexRuntime(process.env, workflow), null, 2)}\n`);
}
