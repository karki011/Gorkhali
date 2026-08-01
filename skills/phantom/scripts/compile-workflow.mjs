#!/usr/bin/env node
// Author: Subash Karki

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  isMainModule,
  parseArgs,
  sessionPaths,
  workspacePath,
} from './lib/portable.mjs';
import {
  executorProbeFile,
  verifyExecutorProbe,
} from './lib/isolated-executor-attestation.mjs';
import { compileWorkflow } from './lib/workflow-kernel.mjs';
import { readStableJsonFile } from './lib/filesystem-snapshot.mjs';
import { buildWorkspaceManifest } from './lib/workspace-manifest.mjs';
import { writeCompiledWorkflow } from './lib/workflow-journal.mjs';
import { workflowCompilationContext } from './phantom-state.mjs';

const canonicalSessionDirectory = (workspace, task) => sessionPaths(workspace, task).sessionDir;

const canonicalizePlanBindings = (input, context, executorBinding = null) => {
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
  if (executorBinding === null) delete plan.executor_binding;
  else plan.executor_binding = structuredClone(executorBinding);
  return plan;
};

function verifiedExecutorBinding({ workspace, sessionDir, requested, context }) {
  const hasParallel = Array.isArray(requested.nodes)
    && requested.nodes.some((node) => node?.kind === 'parallel');
  if (!hasParallel) {
    if (requested.executor_binding !== undefined) {
      throw new Error('Caller workflow executor_binding is unsupported without a parallel node.');
    }
    return null;
  }
  if (requested.executor_binding !== undefined) {
    throw new Error('Caller workflow executor_binding is not trusted; the production compiler injects it from signed host evidence.');
  }
  const file = executorProbeFile(sessionDir);
  if (!existsSync(file)) {
    throw new Error(`Parallel workflow compilation requires a signed isolated executor probe at ${file}.`);
  }
  const probe = readStableJsonFile(file).value;
  const binding = verifyExecutorProbe({
    workspace,
    probe,
    repoId: context.session_binding.repo_id,
    taskId: context.session_binding.task_id,
    worktreeFingerprint: context.fingerprint,
  }).binding;
  const baselineManifest = buildWorkspaceManifest(workspace);
  if (baselineManifest.evidence.snapshot_digest !== context.fingerprint) {
    throw new Error('Parallel workflow compilation denied: workspace changed while its executor baseline was bound.');
  }
  return {
    ...binding,
    baseline_fingerprint: context.fingerprint,
    baseline_content_manifest_digest: baselineManifest.evidence.manifest_digest,
    baseline_physical_topology_root: baselineManifest.evidence.physical_topology_root,
  };
}

export function compileWorkflowFile(options) {
  for (const field of ['offlineTest', 'output', 'sessionDir']) {
    if (Object.hasOwn(options, field)) {
      throw new Error(`compile-workflow ${field} is not available on the production file entry point.`);
    }
  }
  const { workspace, task, input } = options;
  if (!input) throw new Error('compile-workflow requires --input <workflow-plan.json>.');
  const canonicalWorkspace = workspacePath(workspace);
  const requested = readStableJsonFile(resolve(input)).value;
  const context = workflowCompilationContext(canonicalWorkspace);
  if (task && sessionPaths(canonicalWorkspace, task).task !== context.current.paths.task) {
    throw new Error(`Requested task ${task} is not the canonical active task ${context.current.paths.task}.`);
  }
  const canonicalSession = canonicalSessionDirectory(canonicalWorkspace, context.session_binding.task_id);
  const executorBinding = verifiedExecutorBinding({
    workspace: canonicalWorkspace,
    sessionDir: canonicalSession,
    requested,
    context,
  });
  const compiled = compileWorkflow(canonicalizePlanBindings(requested, context, executorBinding));
  writeCompiledWorkflow(canonicalSession, compiled);
  return compiled;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (!args.task) throw new Error('compile-workflow requires --task <id> and --workspace <path>.');
    for (const field of ['offline-test', 'output', 'session-dir']) {
      if (args[field] !== undefined) throw new Error(`compile-workflow --${field} is unsupported.`);
    }
    const compiled = compileWorkflowFile({
      workspace: args.workspace,
      task: args.task,
      input: args.input,
    });
    process.stdout.write(`${JSON.stringify(compiled, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) main();
