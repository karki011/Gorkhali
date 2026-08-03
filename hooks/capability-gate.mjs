#!/usr/bin/env node
// Provider-neutral one-shot capability gate for native host tools.
// Author: Subash Karki

import { randomUUID } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  delimiter,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import { finalizeClaimedCapability } from '../skills/phantom/scripts/authorize-capability.mjs';
import {
  assertCapabilityReservation,
  assertCapabilityReservationTransition,
  canonicalJson,
  capabilityRequestDigest,
  sha256,
  validateCapabilityReservation,
} from '../skills/phantom/scripts/lib/capability-contracts.mjs';
import { buildPhantomDoctorReport } from '../skills/phantom/scripts/phantom-doctor.mjs';
import {
  currentSessionFile,
  readJson,
  repoIdentity,
  workspacePath,
} from '../skills/phantom/scripts/lib/portable.mjs';
import {
  readWorkflowJournal,
  workflowPaths,
} from '../skills/phantom/scripts/lib/workflow-journal.mjs';
import {
  MAX_CONTROL_INPUT_BYTES,
  readControlInputJson,
  readRegularFileOnce,
  readStableJsonFile,
} from '../skills/phantom/scripts/lib/filesystem-snapshot.mjs';
import {
  assertCurrentLifecycleAuthorization,
  assertTrustedHostInterception,
  branchPolicyContext,
  workflowCompilationContext,
  workflowControlContext,
} from '../skills/phantom/scripts/phantom-state.mjs';

const SCRIPT_DIRECTORY = fileURLToPath(new URL('../skills/phantom/scripts/', import.meta.url));
const TRUSTED_SCRIPTS = Object.freeze(Object.fromEntries([
  'advance-workflow.mjs',
  'authorize-capability.mjs',
  'compile-workflow.mjs',
  'execute-parallel.mjs',
  'phantom-doctor.mjs',
  'phantom-state.mjs',
  'replay-workflow.mjs',
  'validate-workflow.mjs',
].map((name) => [name, realpathSync(join(SCRIPT_DIRECTORY, name))])));
const TRUSTED_NODE_EXECUTABLE = realpathSync(process.execPath);
const READ_ONLY_TOOLS = new Set(['glob', 'grep', 'listdirectory', 'read', 'readfile']);
const WRITE_TOOLS = new Set(['write', 'edit', 'multiedit', 'notebookedit', 'applypatch']);
const EXEC_TOOLS = new Set([
  'bash', 'execcommand', 'shell', 'shellcommand', 'runcommand', 'containerexec',
]);
const EXTERNAL_TOOLS = new Map([
  ['gitcommit', 'git.commit'],
  ['gitpush', 'git.push'],
  ['createpullrequest', 'github.openDraftPr'],
  ['opendraftpr', 'github.openDraftPr'],
  ['trackercomment', 'tracker.comment'],
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => canonicalJson(left) === canonicalJson(right);

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = openSync(directory, 'r');
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function exclusiveWriteJson(file, value) {
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(file, 'wx', 0o600);
    created = true;
    writeFileSync(descriptor, `${canonicalJson(value)}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    fsyncDirectory(dirname(file));
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created) {
      try { unlinkSync(file); } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      }
      fsyncDirectory(dirname(file));
    }
    throw error;
  }
}

function parseObject(value) {
  if (isObject(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toolKey(name) {
  return String(name || '')
    .split('.').at(-1)
    .replaceAll('_', '')
    .replaceAll('-', '')
    .toLowerCase();
}

function repositoryRoot(candidate) {
  return realpathSync(workspacePath(candidate));
}

function policyRoot(candidate) {
  const canonical = repositoryRoot(candidate);
  const identityRoot = repoIdentity(canonical).root;
  if (typeof identityRoot !== 'string' || !existsSync(identityRoot)) return canonical;
  return repositoryRoot(identityRoot);
}

function pathCandidate(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) ?? null;
}

export function normalizeToolEvent(eventInput) {
  if (!isObject(eventInput)) throw new Error('Tool hook input must be a JSON object.');
  const rawName = eventInput.tool_name
    ?? eventInput.name
    ?? eventInput.tool
    ?? eventInput.function?.name
    ?? '';
  const input = parseObject(
    eventInput.tool_input
      ?? eventInput.arguments
      ?? eventInput.input
      ?? eventInput.params
      ?? eventInput.function?.arguments,
  );
  const trustedCandidate = pathCandidate(
    process.env.CLAUDE_PROJECT_DIR,
    eventInput.project_dir,
    eventInput.projectDir,
  );
  const invocationCandidate = pathCandidate(eventInput.cwd, process.cwd());
  const executionCandidate = pathCandidate(input.workdir, input.cwd);
  const trustedWorkspace = trustedCandidate ? policyRoot(trustedCandidate) : null;
  const invocationWorkspace = repositoryRoot(invocationCandidate);
  const invocationPolicyWorkspace = policyRoot(invocationWorkspace);
  const executionWorkspace = executionCandidate ? policyRoot(executionCandidate) : null;
  return {
    raw: eventInput,
    name: String(rawName),
    key: toolKey(rawName),
    input,
    workspace: trustedWorkspace ?? invocationPolicyWorkspace,
    trusted_workspace: trustedWorkspace,
    invocation_workspace: invocationWorkspace,
    invocation_policy_workspace: invocationPolicyWorkspace,
    execution_workspace: executionWorkspace,
    correlation_id: String(
      eventInput.tool_use_id
        ?? eventInput.tool_call_id
        ?? eventInput.call_id
        ?? eventInput.toolUseId
        ?? '',
    ) || null,
    session_id: String(eventInput.session_id ?? eventInput.sessionId ?? '') || null,
  };
}

function classifyTool(event) {
  const fullKey = String(event.name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const externalCapability = EXTERNAL_TOOLS.get(event.key) ?? EXTERNAL_TOOLS.get(fullKey);
  if (externalCapability) {
    return { effectful: true, kind: 'external', capability: externalCapability };
  }
  if (READ_ONLY_TOOLS.has(event.key)) return { effectful: false, kind: 'read-only' };
  if (WRITE_TOOLS.has(event.key)) return { effectful: true, kind: 'workspace.write' };
  if (EXEC_TOOLS.has(event.key)) return { effectful: true, kind: 'process.exec' };
  return { effectful: true, kind: 'unknown' };
}

function within(root, candidate) {
  const offset = relative(root, candidate);
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset));
}

function existingAncestor(candidate) {
  let current = candidate;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function portableEffectPath(workspace, inputPath, pathBase = workspace) {
  if (typeof inputPath !== 'string' || !inputPath.trim() || inputPath.includes('\0')) {
    throw new Error('Native write tool supplied an invalid path.');
  }
  const lexicalCandidate = resolve(pathBase, inputPath);
  const ancestor = existingAncestor(lexicalCandidate);
  if (!ancestor) throw new Error(`Native write path has no resolvable workspace ancestor: ${inputPath}`);
  const canonicalWorkspace = realpathSync(workspace);
  const candidate = resolve(realpathSync(ancestor), relative(ancestor, lexicalCandidate));
  if (!within(canonicalWorkspace, candidate)) {
    throw new Error(`Native write path resolves outside the workspace: ${inputPath}`);
  }
  if (existsSync(lexicalCandidate) && lstatSync(lexicalCandidate).isSymbolicLink()) {
    throw new Error(`Native write path is a symbolic link: ${inputPath}`);
  }
  if (existsSync(lexicalCandidate)) {
    const target = lstatSync(lexicalCandidate, { bigint: true });
    if (target.isFile() && target.nlink !== 1n) {
      throw new Error(`Native write target is hard-linked and physically unsafe: ${inputPath}`);
    }
  }
  const portable = relative(canonicalWorkspace, candidate).split(sep).join('/') || '.';
  const components = portable.toLowerCase().split('/');
  const base = components.at(-1);
  if (components.some((component) => ['.git', '.phantom'].includes(component))
    || ['.gitattributes', '.gitconfig', '.gitmodules'].includes(base)) {
    throw new Error(`Native writes to repository control metadata are forbidden: ${inputPath}`);
  }
  return portable;
}

function patchPaths(patch) {
  const paths = [];
  for (const line of patch.split(/\r?\n/)) {
    const custom = line.match(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/);
    if (custom) {
      paths.push(custom[1].trim());
      continue;
    }
    const unified = line.match(/^(?:\+\+\+|---) (?:[ab]\/)?(.+)$/);
    if (unified && unified[1] !== '/dev/null') paths.push(unified[1].trim());
    const rename = line.match(/^rename (?:from|to) (.+)$/);
    if (rename) paths.push(rename[1].trim());
  }
  return paths;
}

function scalar(input, fields) {
  for (const field of fields) {
    if (typeof input[field] === 'string') return input[field];
  }
  return null;
}

function writeMutation(event) {
  let rawPaths;
  let body;
  if (event.key === 'applypatch') {
    body = scalar(event.input, ['patch', 'command', 'input', 'text']);
    if (body === null) throw new Error('apply_patch requires an exact patch body.');
    rawPaths = patchPaths(body);
  } else if (event.key === 'write') {
    rawPaths = [scalar(event.input, ['file_path', 'path'])];
    body = scalar(event.input, ['content']);
  } else if (event.key === 'edit') {
    rawPaths = [scalar(event.input, ['file_path', 'path'])];
    body = canonicalJson({
      old_string: event.input.old_string,
      new_string: event.input.new_string,
      replace_all: event.input.replace_all === true,
    });
  } else if (event.key === 'multiedit') {
    rawPaths = [scalar(event.input, ['file_path', 'path'])];
    body = canonicalJson({ edits: event.input.edits });
  } else {
    rawPaths = [scalar(event.input, ['notebook_path', 'file_path', 'path'])];
    body = canonicalJson({
      cell_id: event.input.cell_id ?? null,
      cell_type: event.input.cell_type ?? null,
      edit_mode: event.input.edit_mode ?? null,
      new_source: event.input.new_source,
    });
  }
  if (body === null || body === undefined || rawPaths.length === 0 || rawPaths.some((item) => !item)) {
    throw new Error(`${event.name || 'Native write tool'} lacks exact path or mutation-body evidence.`);
  }
  return { rawPaths, body };
}

function writeTargetPolicyRoots(event) {
  const pathBase = event.invocation_workspace ?? event.workspace;
  return writeMutation(event).rawPaths.map((inputPath) => {
    const lexical = resolve(pathBase, inputPath);
    const ancestor = existingAncestor(lexical);
    if (!ancestor) {
      throw new Error(`Native write path has no resolvable workspace ancestor: ${inputPath}`);
    }
    const materialized = realpathSync(ancestor);
    const directory = statSync(materialized).isDirectory() ? materialized : dirname(materialized);
    return policyRoot(directory);
  });
}

function processTargetPolicyRoots(event) {
  const argv = Array.isArray(event.input.argv)
    && event.input.argv.every((value) => typeof value === 'string')
    ? event.input.argv
    : shellArgv(scalar(event.input, ['command', 'cmd']));
  if (!argv) return [];
  return [...new Set(argv.slice(1).filter(isAbsolute).map((inputPath) => {
    const ancestor = existingAncestor(inputPath);
    if (!ancestor) return null;
    const materialized = realpathSync(ancestor);
    const directory = statSync(materialized).isDirectory() ? materialized : dirname(materialized);
    return policyRoot(directory);
  }).filter(Boolean))];
}

function bindPolicyWorkspace(event, classification) {
  const candidates = new Set([
    event.trusted_workspace,
    event.invocation_policy_workspace,
    event.execution_workspace,
  ].filter(Boolean));
  if (classification.kind === 'workspace.write') {
    for (const targetRoot of writeTargetPolicyRoots(event)) candidates.add(targetRoot);
  }
  if (classification.kind === 'process.exec') {
    for (const targetRoot of processTargetPolicyRoots(event)) candidates.add(targetRoot);
  }
  const governed = [...candidates].filter((candidate) => existsSync(currentSessionFile(candidate)));
  if (governed.length > 1) {
    throw new Error('Native effect resolves to multiple governed Phantom workspaces.');
  }
  const workspace = governed[0]
    ?? event.trusted_workspace
    ?? event.invocation_policy_workspace
    ?? event.workspace;
  return workspace === event.workspace ? event : { ...event, workspace };
}

function writeEvidence(event) {
  const { rawPaths, body } = writeMutation(event);
  const pathBase = event.invocation_workspace ?? event.workspace;
  const paths = [...new Set(rawPaths.map((item) =>
    portableEffectPath(event.workspace, item, pathBase)))].sort();
  if (paths.length === 0) throw new Error('Native write tool did not identify any affected workspace path.');
  return {
    capability_type: 'workspace.write',
    paths,
    body_digest: sha256(body),
  };
}

function nativeWriteTargetState(event, requireMaterialized) {
  const { rawPaths } = writeMutation(event);
  const root = realpathSync(event.workspace);
  const pathBase = event.invocation_workspace ?? root;
  return rawPaths.map((inputPath) => {
    const path = portableEffectPath(root, inputPath, pathBase);
    const lexical = resolve(pathBase, inputPath);
    if (!existsSync(lexical)) {
      if (requireMaterialized && event.key !== 'applypatch') {
        throw new Error(`Native write target did not materialize at its exact path: ${inputPath}`);
      }
      return { path, materialized: false };
    }
    const candidate = resolve(realpathSync(lexical));
    const file = readRegularFileOnce(candidate, root);
    if (file.physical.nlink !== 1) {
      throw new Error(`Native write target is hard-linked and physically unsafe: ${inputPath}`);
    }
    return {
      path,
      materialized: true,
      dev: file.physical.dev,
      ino: file.physical.ino,
      generation: file.generation,
    };
  }).sort((left, right) => (left.path < right.path ? -1 : (left.path > right.path ? 1 : 0)));
}

function assertNotControlPlaneWrite(event, active) {
  if (event.key !== 'write' && !WRITE_TOOLS.has(event.key)) return;
  const roots = [active.dataRoot, active.sessionDir, join(active.sessionDir, 'control-inputs')]
    .map((root) => resolve(realpathSync(root)));
  const pathBase = event.invocation_workspace ?? event.workspace;
  for (const inputPath of writeMutation(event).rawPaths) {
    const lexical = resolve(pathBase, inputPath);
    const ancestor = existingAncestor(lexical);
    if (!ancestor) throw new Error(`Native write path has no resolvable workspace ancestor: ${inputPath}`);
    const candidate = resolve(realpathSync(ancestor), relative(ancestor, lexical));
    if (roots.some((root) => within(root, candidate))) {
      throw new Error(`Native writes to Phantom control-plane state are forbidden: ${inputPath}`);
    }
  }
}

export function nativeEffectEvidence(eventInput) {
  const event = eventInput?.key ? eventInput : normalizeToolEvent(eventInput);
  const classification = classifyTool(event);
  if (!classification.effectful) return null;
  if (classification.kind === 'workspace.write') return writeEvidence(event);
  if (classification.kind === 'process.exec') {
    throw new Error(
      'Native shell and process tools are not capability executors; '
      + 'process.exec is unavailable until a versioned signed sandbox enforcement contract exists.',
    );
  }
  if (classification.kind === 'external') {
    throw new Error(
      `${classification.capability} requires an explicit registered external adapter; `
      + 'native interception cannot execute it.',
    );
  }
  throw new Error(`Unknown consequential tool ${event.name || '<unnamed>'} is not capability-bound.`);
}

function shellArgv(command) {
  if (typeof command !== 'string' || !command.trim() || /[\0\n\r;&|`$<>]/.test(command)) return null;
  const values = [];
  let value = '';
  let quote = null;
  let escaped = false;
  let started = false;
  for (const character of command) {
    if (escaped) {
      value += character;
      escaped = false;
      started = true;
    } else if (character === '\\' && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else value += character;
      started = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        values.push(value);
        value = '';
        started = false;
      }
    } else {
      value += character;
      started = true;
    }
  }
  if (escaped || quote) return null;
  if (started) values.push(value);
  return values;
}

function resolvedNodeExecutable(token, workspace) {
  if (isAbsolute(token)) {
    try {
      return realpathSync(token);
    } catch {
      return null;
    }
  }
  if (token !== 'node') return null;
  for (const directory of String(process.env.PATH || '').split(delimiter)) {
    const candidate = resolve(directory || workspace, token);
    try {
      accessSync(candidate, constants.X_OK);
      if (!statSync(candidate).isFile()) continue;
      return realpathSync(candidate);
    } catch {
      // Match shell PATH lookup: continue until the first executable file.
    }
  }
  return null;
}

function exactInvocation(argv, positionals, requiredFlags, optionalFlags = []) {
  if (argv.length < positionals.length
    || positionals.some((value, index) => argv[index] !== value)) return null;
  const allowed = new Set([...requiredFlags, ...optionalFlags]);
  const values = {};
  for (let index = positionals.length; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || Object.hasOwn(values, flag)
      || typeof value !== 'string' || !value || value.startsWith('--')) return null;
    values[flag] = value;
  }
  if (requiredFlags.some((flag) => !Object.hasOwn(values, flag))) return null;
  return values;
}

function canonicalSessionInput(value, active) {
  try {
    const input = readControlInputJson(value, active.sessionDir);
    const { reserved, staged } = controlInputClaims(value, active);
    if (!same(Object.keys(reserved).sort(), [
      'body_digest', 'byte_length', 'schema_version', 'status', 'target',
    ])
      || reserved.schema_version !== 1
      || reserved.status !== 'reserved'
      || reserved.target !== basename(value)
      || reserved.body_digest !== input.digest
      || reserved.byte_length !== input.bytes.length
      || !same(Object.keys(staged).sort(), [
        'body_digest', 'byte_length', 'generation', 'reservation_digest',
        'schema_version', 'status', 'target',
      ])
      || staged.schema_version !== 1
      || staged.status !== 'staged'
      || staged.target !== basename(value)
      || staged.body_digest !== input.digest
      || staged.byte_length !== input.bytes.length
      || staged.generation !== input.generation
      || staged.reservation_digest !== sha256(canonicalJson(reserved))) return false;
    return true;
  } catch {
    return false;
  }
}

function controlClaimsDirectory(active) {
  const controlDirectory = join(realpathSync(active.sessionDir), 'control-inputs');
  const claimsDirectory = join(controlDirectory, '.claims');
  const metadata = lstatSync(claimsDirectory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || realpathSync(claimsDirectory) !== claimsDirectory) {
    throw new Error('Canonical control-input claims directory is not a regular directory.');
  }
  return claimsDirectory;
}

function controlInputClaimFiles(file, active) {
  const claimsDirectory = controlClaimsDirectory(active);
  const name = basename(file);
  return {
    reserved: join(claimsDirectory, `${name}.reserved.json`),
    staged: join(claimsDirectory, `${name}.staged.json`),
  };
}

function controlInputClaims(file, active) {
  const claims = controlInputClaimFiles(file, active);
  return {
    reserved: readStableJsonFile(claims.reserved).value,
    staged: readStableJsonFile(claims.staged).value,
  };
}

function controlInputBody(event, active) {
  if (event.key !== 'write') return null;
  const file = scalar(event.input, ['file_path', 'path']);
  if (typeof file !== 'string' || !isAbsolute(file)) return null;
  const controlDirectory = join(realpathSync(active.sessionDir), 'control-inputs');
  if (dirname(file) !== controlDirectory) return null;
  const metadata = lstatSync(controlDirectory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Canonical control-inputs directory is not a regular directory.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.json$/.test(basename(file))) {
    throw new Error('Control input filename must be a safe unique JSON name.');
  }
  const content = scalar(event.input, ['content']);
  if (typeof content !== 'string'
    || Buffer.byteLength(content) === 0
    || Buffer.byteLength(content) > MAX_CONTROL_INPUT_BYTES) {
    throw new Error(`Control input must contain 1-${MAX_CONTROL_INPUT_BYTES} bytes.`);
  }
  let value;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new Error(`Control input is not valid JSON: ${error.message}`);
  }
  if (!isObject(value)) throw new Error('Control input must contain one JSON object.');
  return {
    file,
    content,
    bytes: Buffer.from(content, 'utf8'),
    digest: sha256(content),
  };
}

function reserveControlInput(event, active) {
  const body = controlInputBody(event, active);
  if (!body) return null;
  if (existsSync(body.file)) {
    throw new Error('Control inputs are strictly new-only and cannot be overwritten or replayed.');
  }
  const reservation = {
    schema_version: 1,
    status: 'reserved',
    target: basename(body.file),
    body_digest: body.digest,
    byte_length: body.bytes.length,
  };
  const claims = controlInputClaimFiles(body.file, active);
  try {
    exclusiveWriteJson(claims.reserved, reservation);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('Control input filename already has an immutable reservation.');
    }
    throw error;
  }
  if (existsSync(body.file)) {
    throw new Error('Control input target appeared while its filename was being reserved.');
  }
  return { path: body.file, digest: body.digest, status: 'reserved' };
}

function finalizeControlInput(event, active) {
  const body = controlInputBody(event, active);
  if (!body) return null;
  const outcome = failureDetails(event);
  if (outcome.status !== 'succeeded') {
    throw new Error('Control input write failed and its reserved filename cannot be reused.');
  }
  const claims = controlInputClaimFiles(body.file, active);
  const reserved = readStableJsonFile(claims.reserved).value;
  const input = readControlInputJson(body.file, active.sessionDir);
  if (!same(reserved, {
    schema_version: 1,
    status: 'reserved',
    target: basename(body.file),
    body_digest: body.digest,
    byte_length: body.bytes.length,
  }) || !input.bytes.equals(body.bytes)) {
    throw new Error('Control input body does not match its immutable reservation.');
  }
  const staged = {
    schema_version: 1,
    status: 'staged',
    target: basename(body.file),
    body_digest: input.digest,
    byte_length: input.bytes.length,
    generation: input.generation,
    reservation_digest: sha256(canonicalJson(reserved)),
  };
  try {
    exclusiveWriteJson(claims.staged, staged);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Control input generation was already staged.');
    throw error;
  }
  const verified = readControlInputJson(body.file, active.sessionDir);
  if (verified.digest !== staged.body_digest || verified.generation !== staged.generation) {
    throw new Error('Control input changed while its immutable generation was staged.');
  }
  return { path: body.file, digest: input.digest, generation: input.generation, status: 'staged' };
}

function boundWorkspace(values, active, requireTask = true) {
  return values?.['--workspace'] === active.workspace
    && (!requireTask || values['--task'] === active.task);
}

function stateControlInvocation(args, active) {
  const action = args[0];
  if (['complete', 'execute', 'fingerprint', 'resume', 'ship', 'status'].includes(action)) {
    const values = exactInvocation(args, [action], ['--workspace']);
    return boundWorkspace(values, active, false);
  }
  if (action === 'pause') {
    const values = exactInvocation(args, [action], ['--workspace'], ['--reason']);
    return boundWorkspace(values, active, false);
  }
  if (action === 'approve') {
    const values = exactInvocation(args, [action], ['--workspace', '--gate', '--decision']);
    return boundWorkspace(values, active, false)
      && ['direction', 'plan', 'wiring'].includes(values['--gate'])
      && canonicalSessionInput(values['--decision'], active);
  }
  if (action === 'authorize') {
    const values = exactInvocation(args, [action], ['--workspace', '--scope', '--decision']);
    return boundWorkspace(values, active, false)
      && ['implementation', 'ship-draft-pr', 'tracker-comment'].includes(values['--scope'])
      && canonicalSessionInput(values['--decision'], active);
  }
  if (action === 'record') {
    const values = exactInvocation(
      args,
      [action],
      ['--workspace', '--type', '--status', '--input'],
      [
        '--actual-profile', '--fallback-reason', '--profile', '--role', '--run',
        '--tool-turns', '--wall-time-ms',
      ],
    );
    return boundWorkspace(values, active, false)
      && /^[a-z][a-z0-9-]*$/.test(values['--type'] || '')
      && ['blocked', 'failed', 'passed', 'pending'].includes(values['--status'])
      && canonicalSessionInput(values['--input'], active);
  }
  return false;
}

function capabilityControlInvocation(args, active) {
  const action = args[0];
  if (action === 'authorize' || action === 'attest') {
    const values = exactInvocation(args, [action], ['--workspace', '--task', '--input']);
    return boundWorkspace(values, active) && canonicalSessionInput(values['--input'], active);
  }
  if (action === 'outcome') {
    const values = exactInvocation(
      args,
      [action],
      ['--workspace', '--task', '--input', '--decision-digest', '--status'],
      ['--error', '--external-id'],
    );
    return boundWorkspace(values, active)
      && canonicalSessionInput(values['--input'], active)
      && DIGEST.test(values['--decision-digest'] || '')
      && ['failed', 'succeeded'].includes(values['--status'])
      && (values['--status'] !== 'failed' || typeof values['--error'] === 'string');
  }
  return false;
}

function bootstrapDiagnosticCommand(event) {
  if (!EXEC_TOOLS.has(event.key)) return false;
  const command = scalar(event.input, ['command', 'cmd']);
  const stderrMerge = typeof command === 'string' ? command.match(/[ \t]+2>&1[ \t]*$/) : null;
  const argv = shellArgv(stderrMerge ? command.slice(0, stderrMerge.index) : command);
  if (!argv || argv.length !== 4 || !isAbsolute(argv[1]) || argv[2] !== '--workspace') {
    return false;
  }
  try {
    const canonicalWorkspace = realpathSync(event.workspace);
    const requestedCwd = resolve(canonicalWorkspace, event.input.workdir ?? event.input.cwd ?? '.');
    return resolvedNodeExecutable(argv[0], canonicalWorkspace) === TRUSTED_NODE_EXECUTABLE
      && realpathSync(argv[1]) === TRUSTED_SCRIPTS['phantom-doctor.mjs']
      && policyRoot(argv[3]) === event.workspace
      && resolve(realpathSync(requestedCwd)) === canonicalWorkspace;
  } catch {
    return false;
  }
}

function controlPlaneCommand(event, active) {
  if (!EXEC_TOOLS.has(event.key)) return false;
  const command = scalar(event.input, ['command', 'cmd']);
  const argv = shellArgv(command);
  if (!argv || argv.length < 2 || !isAbsolute(argv[1])) return false;
  const executable = resolvedNodeExecutable(argv[0], event.workspace);
  let script;
  try {
    script = realpathSync(argv[1]);
  } catch {
    return false;
  }
  const canonicalWorkspace = realpathSync(event.workspace);
  const requestedCwd = resolve(canonicalWorkspace, event.input.workdir ?? event.input.cwd ?? '.');
  if (executable !== TRUSTED_NODE_EXECUTABLE
    || resolve(realpathSync(requestedCwd)) !== canonicalWorkspace) return false;
  const args = argv.slice(2);
  if (script === TRUSTED_SCRIPTS['validate-workflow.mjs']) {
    const values = exactInvocation(args, [], ['--input']);
    return canonicalSessionInput(values?.['--input'], active);
  }
  if (script === TRUSTED_SCRIPTS['compile-workflow.mjs']
    || script === TRUSTED_SCRIPTS['advance-workflow.mjs']) {
    const values = exactInvocation(args, [], ['--workspace', '--task', '--input']);
    return boundWorkspace(values, active) && canonicalSessionInput(values['--input'], active);
  }
  if (script === TRUSTED_SCRIPTS['execute-parallel.mjs']) {
    const values = exactInvocation(args, [], ['--workspace', '--task', '--receipt']);
    return boundWorkspace(values, active) && canonicalSessionInput(values['--receipt'], active);
  }
  if (script === TRUSTED_SCRIPTS['replay-workflow.mjs']) {
    return boundWorkspace(exactInvocation(args, [], ['--workspace', '--task']), active);
  }
  if (script === TRUSTED_SCRIPTS['authorize-capability.mjs']) {
    return capabilityControlInvocation(args, active);
  }
  if (script === TRUSTED_SCRIPTS['phantom-state.mjs']) {
    return stateControlInvocation(args, active);
  }
  return false;
}

function loadActiveWorkflow(workspace) {
  const pointerFile = currentSessionFile(workspace);
  if (!existsSync(pointerFile)) return null;
  let lifecycle;
  try {
    lifecycle = workflowCompilationContext(workspace, { requireDefectProof: false });
  } catch (error) {
    if (error.message === 'The current Phantom session is already completed.') return null;
    throw error;
  }
  const expected = lifecycle.current.paths;
  const planFile = workflowPaths(expected.sessionDir).planFile;
  if (!existsSync(planFile)) {
    throw new Error('Active Phantom session compiled workflow plan is missing.');
  }
  let compiled;
  try {
    compiled = readJson(planFile);
  } catch (error) {
    throw new Error(`Active Phantom workflow plan is corrupt: ${error.message}`);
  }
  if (!compiled?.plan || compiled.plan.workflow_id === undefined) {
    throw new Error('Active Phantom workflow plan is malformed.');
  }
  if (compiled.plan.session_binding?.repo_id !== lifecycle.current.paths.repo.id
    || compiled.plan.session_binding?.task_id !== lifecycle.current.paths.task
    || compiled.plan.session_binding?.route !== lifecycle.current.session.route) {
    throw new Error('Active Phantom workflow is not bound to the canonical session.');
  }
  const snapshot = readWorkflowJournal(expected.sessionDir, compiled);
  return {
    workspace,
    task: lifecycle.current.paths.task,
    sessionDir: expected.sessionDir,
    session: lifecycle.current.session,
    compiled,
    snapshot,
    fingerprint: lifecycle.fingerprint,
  };
}

function capabilityScope(type) {
  if (['workspace.write', 'process.exec', 'git.commit'].includes(type)) return 'implementation';
  if (['git.push', 'github.openDraftPr'].includes(type)) return 'ship-draft-pr';
  if (type === 'tracker.comment') return 'tracker-comment';
  throw new Error(`Unsupported capability type: ${type}`);
}

function reservationDirectory(sessionDir, lane) {
  return join(sessionDir, 'capability', 'reservations', lane);
}

function reservationFiles(sessionDir, lane) {
  const directory = reservationDirectory(sessionDir, lane);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry))
    .sort()
    .map((entry) => join(directory, entry));
}

function readReservation(file, sessionDir) {
  const snapshot = readRegularFileOnce(file, sessionDir);
  if (snapshot.physical.nlink !== 1 || (snapshot.mode & 0o077) !== 0) {
    throw new Error(`Capability reservation must be a private single-link file: ${file}`);
  }
  const raw = snapshot.bytes.toString('utf8');
  if (!raw.endsWith('\n')) throw new Error(`Capability reservation is partially written: ${file}`);
  let reservation;
  try {
    reservation = JSON.parse(raw);
  } catch {
    throw new Error(`Capability reservation is malformed: ${file}`);
  }
  if (raw !== `${canonicalJson(reservation)}\n`) {
    throw new Error(`Capability reservation is not canonical JSON: ${file}`);
  }
  return { raw, reservation };
}

function decisionDigest(payload) {
  const unsigned = {
    schema_version: payload.schema_version,
    request_id: payload.request_id,
    idempotency_key: payload.idempotency_key,
    capability_type: payload.capability_type,
    request_digest: payload.request_digest,
    decision: payload.decision,
    reason: payload.reason,
    reserved_budget: payload.reserved_budget,
  };
  return sha256(canonicalJson(unsigned));
}

function reservationStaticErrors(active, file, reservation, lane) {
  const errors = validateCapabilityReservation(reservation, { lane });
  if (errors.length) return errors;
  const request = reservation.request;
  if (request.workflow_id !== active.compiled.plan.workflow_id) {
    errors.push('request workflow binding mismatch');
  }
  const expectedName = `${reservation.decision_digest.replace(/^sha256:/, '')}.json`;
  if (basename(file) !== expectedName) errors.push('reservation filename does not match decision digest');
  const decision = active.snapshot.events.find((event) =>
    event.event_type === 'capability.decision'
    && event.node_id === request.node_id
    && event.payload?.decision === 'authorized'
    && event.payload?.decision_digest === reservation.decision_digest);
  if (!decision
    || decision.payload.request_id !== request.request_id
    || decision.payload.request_digest !== reservation.request_digest
    || decision.payload.capability_type !== request.type
    || decision.payload.idempotency_key !== reservation.idempotency_key
    || decisionDigest(decision.payload) !== reservation.decision_digest) {
    errors.push('authorized journal decision binding mismatch');
  }
  return errors;
}

function expectedHardBinding(request, policy, authorityDigest, interceptionProbeDigest) {
  const binding = {
    adapter_binding: 'native-tool-gate-v1',
    worktree_fingerprint: request.worktreeFingerprint,
    current_branch: policy.current_branch,
    protected_branches: [...policy.protected_branches],
    authority_decision_digest: authorityDigest,
    interception_probe_digest: interceptionProbeDigest,
    head_sha: request.headSha ?? null,
    body_digest: request.patchDigest ?? request.bodyDigest ?? null,
    tree_digest: request.treeDigest ?? null,
    command: request.command ?? null,
    cwd: request.cwd ?? null,
    paths: request.paths ?? null,
  };
  return { ...binding, binding_digest: sha256(canonicalJson({ request, binding })) };
}

function evidenceMatches(request, evidence) {
  if (request.type !== evidence.capability_type) return false;
  if (request.type === 'workspace.write') {
    return same([...request.paths].sort(), evidence.paths)
      && request.patchDigest === evidence.body_digest;
  }
  if (request.type === 'process.exec') {
    return same(request.command, evidence.command) && request.cwd === evidence.cwd;
  }
  return false;
}

function correlation(event, evidence) {
  return {
    schema_version: 1,
    tool_name: event.name,
    effect_digest: sha256(canonicalJson(evidence)),
    tool_call_id: event.correlation_id,
    host_session_id: event.session_id,
  };
}

function exactGenerationUnlink(file, raw, purpose, sessionDir) {
  const relocated = `${file}.${purpose}.${process.pid}.${randomUUID()}`;
  try {
    renameSync(file, relocated);
    fsyncDirectory(dirname(file));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const moved = readRegularFileOnce(relocated, sessionDir);
  if (moved.physical.nlink !== 1 || moved.bytes.toString('utf8') !== raw) {
    if (existsSync(file)) {
      throw new Error(`Capability reservation changed while ${purpose}; preserved conflicting generation at ${relocated}.`);
    }
    renameSync(relocated, file);
    fsyncDirectory(dirname(file));
    return false;
  }
  unlinkSync(relocated);
  fsyncDirectory(dirname(file));
  return true;
}

function claimReservation(candidate, claim) {
  const consumingDirectory = reservationDirectory(candidate.active.sessionDir, 'consuming');
  mkdirSync(consumingDirectory, { recursive: true });
  fsyncDirectory(dirname(consumingDirectory));
  const consuming = join(consumingDirectory, basename(candidate.file));
  const claimedReservation = {
    ...candidate.reservation,
    status: 'consuming',
    consuming_at: new Date().toISOString(),
    claim,
  };
  assertCapabilityReservationTransition({
    fromLane: 'pending',
    toLane: 'consuming',
    before: candidate.reservation,
    after: claimedReservation,
  });
  try {
    exclusiveWriteJson(consuming, claimedReservation);
  } catch (error) {
    if (error.code === 'EEXIST') {
      const existing = readReservation(consuming, candidate.active.sessionDir).reservation;
      assertCapabilityReservation(existing, { lane: 'consuming' });
      if (existing.reservation_digest === candidate.reservation.reservation_digest
        && existing.status === 'consuming') {
        assertCapabilityReservationTransition({
          fromLane: 'pending',
          toLane: 'consuming',
          before: candidate.reservation,
          after: existing,
        });
        if (!exactGenerationUnlink(
          candidate.file,
          candidate.raw,
          'duplicate-claim',
          candidate.active.sessionDir,
        )) {
          throw new Error('Capability reservation generation changed during duplicate-claim recovery.');
        }
        throw new Error('Capability reservation is already consuming and requires reconciliation.');
      }
      throw new Error('Capability reservation consuming lane conflicts with a different reservation.');
    }
    throw error;
  }
  const created = readReservation(consuming, candidate.active.sessionDir);
  assertCapabilityReservationTransition({
    fromLane: 'pending',
    toLane: 'consuming',
    before: candidate.reservation,
    after: created.reservation,
  });
  if (!exactGenerationUnlink(candidate.file, candidate.raw, 'claim', candidate.active.sessionDir)) {
    if (!exactGenerationUnlink(consuming, created.raw, 'rollback', candidate.active.sessionDir)) {
      throw new Error('Capability reservation rollback found a conflicting consuming generation.');
    }
    throw new Error('Capability reservation generation changed during one-shot claim.');
  }
  return { ...candidate, consuming, claim };
}

function matchingLane(active, lane, evidence, eventCorrelation) {
  const matches = [];
  for (const file of reservationFiles(active.sessionDir, lane)) {
    const { raw, reservation } = readReservation(file, active.sessionDir);
    const staticErrors = reservationStaticErrors(active, file, reservation, lane);
    if (staticErrors.length) throw new Error(`Invalid ${lane} capability reservation: ${staticErrors.join(', ')}.`);
    if (!evidenceMatches(reservation.request, evidence)) continue;
    if (lane === 'consuming' && isObject(reservation.claim)) {
      if (reservation.claim.effect_digest !== eventCorrelation.effect_digest) continue;
      if (reservation.claim.tool_call_id && eventCorrelation.tool_call_id
        && reservation.claim.tool_call_id !== eventCorrelation.tool_call_id) continue;
    }
    matches.push({ active, file, raw, reservation });
  }
  return matches;
}

function pendingCandidate(active, event, evidence) {
  const scope = capabilityScope(evidence.capability_type);
  const authorization = assertCurrentLifecycleAuthorization(active.workspace, {
    task: active.task,
    scope,
    fingerprint: active.fingerprint,
    action: `execute ${evidence.capability_type}`,
  });
  const interception = assertTrustedHostInterception(active.workspace, {
    task: active.task,
    fingerprint: active.fingerprint,
    action: `execute ${evidence.capability_type}`,
  });
  const policy = branchPolicyContext(active.workspace);
  if (!policy.current_branch || policy.protected_branches.includes(policy.current_branch)) {
    throw new Error('Capability effect requires a named, unprotected feature branch.');
  }
  const matches = matchingLane(active, 'pending', evidence, correlation(event, evidence));
  const valid = matches.filter((candidate) => {
    const request = candidate.reservation.request;
    if (request.worktreeFingerprint !== active.fingerprint) return false;
    const expected = expectedHardBinding(
      request,
      policy,
      authorization.authority.decision_digest,
      interception.probe_digest,
    );
    return same(candidate.reservation.hard_enforcement, expected);
  });
  if (valid.length !== 1) {
    if (valid.length > 1) throw new Error('Multiple pending capability reservations match one native effect.');
    const consuming = matchingLane(active, 'consuming', evidence, correlation(event, evidence));
    if (consuming.length) {
      throw new Error('Matching capability reservation is consuming without an outcome; reconcile it explicitly.');
    }
    const completed = matchingLane(active, 'completed', evidence, correlation(event, evidence));
    if (completed.length) throw new Error('Matching capability reservation was already consumed; replay is denied.');
    throw new Error('No current, exactly bound pending capability reservation matches this native effect.');
  }
  return valid[0];
}

function failureDetails(event) {
  const raw = event.raw;
  const output = parseObject(raw.tool_output ?? raw.tool_response ?? raw.output ?? raw.result);
  const failed = raw.error != null
    || output.isError === true
    || output.is_error === true
    || output.success === false
    || (Number.isInteger(output.exit_code) && output.exit_code !== 0);
  if (!failed) return { status: 'succeeded', error: null };
  const detail = raw.error
    ?? output.error
    ?? output.message
    ?? `Native tool ${event.name || '<unnamed>'} reported failure.`;
  return { status: 'failed', error: String(detail).slice(0, 4096) };
}

function bootstrapSkillAllowance(event) {
  if (event.key !== 'skill') return null;
  if (event.input.skill === 'phantom:start') {
    return { allowed: true, reason: 'phantom_bootstrap_skill' };
  }
  if (event.input.skill === 'phantom:health') {
    return { allowed: true, reason: 'phantom_diagnostic_skill' };
  }
  return null;
}

export function preToolUse(eventInput) {
  const normalized = normalizeToolEvent(eventInput);
  const classification = classifyTool(normalized);
  if (classification.kind === 'read-only') return { allowed: true, reason: 'read_only_allowlist' };
  const bootstrap = bootstrapSkillAllowance(normalized);
  if (bootstrap) return bootstrap;
  if (bootstrapDiagnosticCommand(normalized)) {
    return { allowed: true, reason: 'phantom_bootstrap_diagnostic' };
  }
  const event = bindPolicyWorkspace(normalized, classification);
  const control = workflowControlContext(event.workspace);
  const controlInput = control && reserveControlInput(event, control);
  if (controlInput) {
    return { allowed: true, reason: 'phantom_control_input', control_input: controlInput };
  }
  if (control && classification.kind === 'workspace.write') assertNotControlPlaneWrite(event, control);
  if (control && controlPlaneCommand(event, control)) {
    return { allowed: true, reason: 'phantom_control_plane' };
  }
  const active = loadActiveWorkflow(event.workspace);
  if (!active) return { allowed: true, reason: 'no_active_session' };
  const evidence = nativeEffectEvidence(event);
  const candidate = pendingCandidate(active, event, evidence);
  const claim = correlation(event, evidence);
  if (classification.kind === 'workspace.write') {
    claim.write_preflight = nativeWriteTargetState(event, false);
  }
  claimReservation(candidate, claim);
  return {
    allowed: true,
    reason: 'authorized_capability_claimed',
    decision_digest: candidate.reservation.decision_digest,
  };
}

export function postToolUse(eventInput) {
  const normalized = normalizeToolEvent(eventInput);
  const classification = classifyTool(normalized);
  if (classification.kind === 'read-only') return { allowed: true, reason: 'read_only_allowlist' };
  const bootstrap = bootstrapSkillAllowance(normalized);
  if (bootstrap) return bootstrap;
  if (bootstrapDiagnosticCommand(normalized)) {
    return { allowed: true, reason: 'phantom_bootstrap_diagnostic' };
  }
  const event = bindPolicyWorkspace(normalized, classification);
  const control = workflowControlContext(event.workspace);
  const controlInput = control && finalizeControlInput(event, control);
  if (controlInput) {
    return { allowed: true, reason: 'phantom_control_input', control_input: controlInput };
  }
  if (control && classification.kind === 'workspace.write') assertNotControlPlaneWrite(event, control);
  if (control && controlPlaneCommand(event, control)) {
    return { allowed: true, reason: 'phantom_control_plane' };
  }
  const active = loadActiveWorkflow(event.workspace);
  if (!active) return { allowed: true, reason: 'no_active_session' };
  const evidence = nativeEffectEvidence(event);
  const claim = correlation(event, evidence);
  const matches = matchingLane(active, 'consuming', evidence, claim);
  if (matches.length !== 1) {
    throw new Error(matches.length > 1
      ? 'Multiple consuming capability reservations match one native outcome.'
      : 'Native effect has no consuming reservation; an explicit reconciliation outcome is required.');
  }
  const outcome = failureDetails(event);
  if (classification.kind === 'workspace.write') {
    const postflight = nativeWriteTargetState(event, outcome.status === 'succeeded');
    const expectedPaths = (matches[0].reservation.claim?.write_preflight || [])
      .map((record) => record.path)
      .sort();
    if (!same(postflight.map((record) => record.path), expectedPaths)) {
      throw new Error('Native write postflight paths do not match the claimed preflight targets.');
    }
  }
  const payload = finalizeClaimedCapability({
    workspace: active.workspace,
    task: active.task,
    decisionDigest: matches[0].reservation.decision_digest,
    status: outcome.status,
    error: outcome.error,
  });
  return {
    allowed: true,
    reason: 'capability_outcome_recorded',
    decision_digest: matches[0].reservation.decision_digest,
    outcome_digest: payload.outcome_digest,
  };
}

function readHookInput() {
  const raw = readFileSync(0, 'utf8');
  if (!raw.trim()) throw new Error('Capability hook requires a JSON event on stdin.');
  return JSON.parse(raw);
}

function deny(phase, error) {
  const reason = `Phantom ${phase} capability gate denied the tool: ${error.message || String(error)}`;
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: phase === 'pre' ? 'PreToolUse' : 'PostToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  })}\n`);
  process.stderr.write(`${reason}\n`);
  process.exitCode = 2;
}

async function main() {
  const phase = process.argv[2];
  if (phase === 'doctor') {
    const report = buildPhantomDoctorReport({ workspace: process.argv[3] ?? process.cwd() });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (!['pre', 'post'].includes(phase)) throw new Error('Capability hook phase must be pre, post, or doctor.');
  const event = readHookInput();
  const result = phase === 'pre' ? preToolUse(event) : postToolUse(event);
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: phase === 'pre' ? 'PreToolUse' : 'PostToolUse',
      ...(phase === 'pre' ? { permissionDecision: 'allow' } : { additionalContext: '' }),
    },
    phantom: result,
  })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phase = process.argv[2] || 'pre';
  main().catch((error) => {
    if (phase !== 'doctor') {
      deny(phase, error);
      return;
    }
    process.stderr.write(`Phantom capability doctor failed: ${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
