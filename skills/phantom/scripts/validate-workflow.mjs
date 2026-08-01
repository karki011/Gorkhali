#!/usr/bin/env node
// Author: Subash Karki

import { isMainModule, parseArgs } from './lib/portable.mjs';
import { compileWorkflow } from './lib/workflow-kernel.mjs';
import { readStableJsonFile } from './lib/filesystem-snapshot.mjs';

export function validateWorkflowFile(file) {
  if (!file) throw new Error('validate-workflow requires --input <workflow-plan.json>.');
  const plan = readStableJsonFile(file).value;
  try {
    const compiled = compileWorkflow(plan);
    return { schema_version: 1, valid: true, errors: [], plan_digest: compiled.plan_digest };
  } catch (error) {
    return { schema_version: 1, valid: false, errors: error.errors || [error.message] };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = validateWorkflowFile(args.input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) main();
