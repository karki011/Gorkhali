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
import { compileWorkflow } from './lib/workflow-kernel.mjs';
import { readStableJsonFile } from './lib/filesystem-snapshot.mjs';
import { writeCompiledWorkflow } from './lib/workflow-journal.mjs';
import {
  workflowCompilationContext,
  worktreeFingerprint,
} from './phantom-state.mjs';

const canonicalSessionDirectory = (workspace, task) => sessionPaths(workspace, task).sessionDir;

const canonicalizePlanBindings = (input, context) => {
  const plan = structuredClone(input);
  if (plan.route !== context.session_binding.route) {
    throw new Error(
      `Workflow route ${plan.route ?? 'missing'} does not match active session route ${context.session_binding.route}.`,
    );
  }
  if (plan.session_binding !== undefined) {
    for (const field of ['repo_id', 'task_id', 'route']) {
      if (plan.session_binding?.[field] !== context.session_binding[field]) {
        throw new Error(`Caller workflow session_binding.${field} does not match canonical session state.`);
      }
    }
  }
  plan.baseline_fingerprint = context.fingerprint;
  plan.session_binding = structuredClone(context.session_binding);
  for (const node of plan.nodes || []) {
    for (const branch of node.branches || []) branch.baseline_fingerprint = context.fingerprint;
  }
  return plan;
};

function offlineCompilationContext(workspace, task, input) {
  if (!task) throw new Error('Offline/test compilation requires --task.');
  const fingerprint = worktreeFingerprint(workspace);
  return {
    fingerprint,
    session_binding: {
      repo_id: sessionPaths(workspace, task).repo.id,
      task_id: sessionPaths(workspace, task).task,
      route: input.route,
      approved_plan: input.session_binding?.approved_plan ?? null,
    },
  };
}

export function compileWorkflowFile({
  workspace,
  task,
  input,
  output = null,
  sessionDir = null,
  offlineTest = false,
}) {
  if (!input) throw new Error('compile-workflow requires --input <workflow-plan.json>.');
  const canonicalWorkspace = workspacePath(workspace);
  const requested = readStableJsonFile(resolve(input)).value;
  if (!offlineTest && Array.isArray(requested?.nodes)
    && requested.nodes.some((node) => node?.kind === 'parallel')) {
    throw new Error(
      'Native parallel branch execution is disabled because no trusted isolated executor attestation is bundled; '
      + 'lower the workflow to current-agent or sequential chain nodes.',
    );
  }
  const context = offlineTest
    ? offlineCompilationContext(canonicalWorkspace, task, requested)
    : workflowCompilationContext(canonicalWorkspace);
  if (!offlineTest && task && sessionPaths(canonicalWorkspace, task).task !== context.current.paths.task) {
    throw new Error(`Requested task ${task} is not the canonical active task ${context.current.paths.task}.`);
  }
  const canonicalSession = canonicalSessionDirectory(canonicalWorkspace, context.session_binding.task_id);
  if (sessionDir !== null) {
    if (!offlineTest) {
      throw new Error('--session-dir is available only with explicit --offline-test opt-in.');
    }
    if (resolve(sessionDir) !== resolve(canonicalSession)) {
      throw new Error('--session-dir must equal the canonical session directory for --workspace and --task.');
    }
  }
  if (output !== null && !offlineTest) {
    throw new Error('--output is available only with explicit --offline-test opt-in.');
  }
  const compiled = compileWorkflow(canonicalizePlanBindings(requested, context));
  if (output) atomicWriteJson(resolve(output), compiled);
  writeCompiledWorkflow(canonicalSession, compiled);
  return compiled;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (!args.task) throw new Error('compile-workflow requires --task <id> and --workspace <path>.');
    const compiled = compileWorkflowFile({
      workspace: args.workspace,
      task: args.task,
      input: args.input,
      output: args.output || null,
      sessionDir: args['session-dir'] || null,
      offlineTest: args['offline-test'] === true,
    });
    process.stdout.write(`${JSON.stringify(compiled, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) main();
