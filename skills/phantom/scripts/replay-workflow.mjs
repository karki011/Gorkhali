#!/usr/bin/env node
// Author: Subash Karki

import { resolve } from 'node:path';

import {
  atomicWriteJson,
  isMainModule,
  parseArgs,
  sessionPaths,
  workspacePath,
} from './lib/portable.mjs';
import { replayWorkflowSession } from './lib/workflow-journal.mjs';
import { legalTransitions } from './lib/workflow-kernel.mjs';

const requiredSession = (args) => {
  if (args['session-dir']) return resolve(args['session-dir']);
  if (args.task) return sessionPaths(workspacePath(args.workspace), args.task).sessionDir;
  throw new Error('replay-workflow requires --session-dir or --task [--workspace].');
};

export function replayWorkflowDirectory({ sessionDir, output }) {
  const result = replayWorkflowSession(sessionDir);
  const report = {
    ...result,
    legal_transitions: legalTransitions(result.compiled, result.state),
  };
  if (output) {
    atomicWriteJson(resolve(output), {
      state: report.state,
      legal_transitions: report.legal_transitions,
    });
  }
  return report;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = replayWorkflowDirectory({ sessionDir: requiredSession(args), output: args.output });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) main();
