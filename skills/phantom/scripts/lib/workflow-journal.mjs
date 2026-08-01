// Author: Subash Karki
// Durable append-only journal and strict replay for workflow contract v1.

import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { atomicWriteJson, now, readJson } from './portable.mjs';
import {
  WorkflowContractError,
  assertContract,
  canonicalJson,
  digestValue,
  validateWorkflowEvent,
} from './workflow-contracts.mjs';
import {
  compileWorkflow,
  createInitialState,
  reduceWorkflowEvent,
} from './workflow-kernel.mjs';

const LOCK_WAIT_MS = 2_000;
const STALE_LOCK_MS = 5 * 60_000;
const waiter = new Int32Array(new SharedArrayBuffer(4));

const fsyncDirectory = (directory) => {
  let descriptor;
  try {
    descriptor = openSync(directory, 'r');
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

export const workflowPaths = (sessionDir) => {
  if (typeof sessionDir !== 'string' || sessionDir.length === 0) throw new Error('sessionDir is required.');
  const directory = join(sessionDir, 'workflow');
  return {
    directory,
    planFile: join(directory, 'plan.json'),
    journalFile: join(directory, 'events.jsonl'),
    stateFile: join(directory, 'state.json'),
    lockFile: join(directory, '.journal.lock'),
  };
};

const processAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const readLockGeneration = (file) => {
  let descriptor;
  try {
    descriptor = openSync(file, 'r');
    const metadata = fstatSync(descriptor);
    return { raw: readFileSync(descriptor, 'utf8'), mtimeMs: metadata.mtimeMs };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

const judgedStaleGeneration = (file) => {
  const generation = readLockGeneration(file);
  if (!generation) return null;
  const complete = generation.raw.endsWith('\n');
  try {
    const value = complete ? JSON.parse(generation.raw) : null;
    if (Number.isInteger(value?.pid) && value.pid > 0) {
      return processAlive(value.pid) ? null : generation.raw;
    }
  } catch {
    // A malformed or partially written owner is unknown, not provably dead.
  }
  return Date.now() - generation.mtimeMs > STALE_LOCK_MS ? generation.raw : null;
};

const restoreRelocatedGeneration = (relocated, file) => {
  try {
    linkSync(relocated, file);
    fsyncDirectory(dirname(file));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    try { unlinkSync(relocated); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    fsyncDirectory(dirname(file));
  }
};

const relocateExactGeneration = (file, judgedRaw, purpose) => {
  const relocated = `${file}.${purpose}.${process.pid}.${randomUUID()}`;
  try {
    renameSync(file, relocated);
    fsyncDirectory(dirname(file));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const moved = readFileSync(relocated, 'utf8');
  if (moved !== judgedRaw) {
    restoreRelocatedGeneration(relocated, file);
    return false;
  }
  unlinkSync(relocated);
  fsyncDirectory(dirname(file));
  return true;
};

const withJournalLock = (paths, action) => {
  mkdirSync(paths.directory, { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  const token = randomUUID();
  const lockRecord = `${JSON.stringify({ pid: process.pid, token, created_at: now() })}\n`;
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(paths.lockFile, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stale = judgedStaleGeneration(paths.lockFile);
      if (stale !== null && relocateExactGeneration(paths.lockFile, stale, 'stale')) continue;
      if (Date.now() >= deadline) throw new Error('Workflow journal mutation is already in progress.');
      Atomics.wait(waiter, 0, 0, 10);
    }
  }
  try {
    writeFileSync(descriptor, lockRecord, 'utf8');
    fsyncSync(descriptor);
    fsyncDirectory(paths.directory);
  } catch (error) {
    closeSync(descriptor);
    const generation = readLockGeneration(paths.lockFile);
    if (generation?.raw === lockRecord) relocateExactGeneration(paths.lockFile, lockRecord, 'failed');
    throw error;
  }
  try {
    return action();
  } finally {
    closeSync(descriptor);
    const generation = readLockGeneration(paths.lockFile);
    if (generation) {
      let owner = null;
      try { owner = JSON.parse(generation.raw); } catch {}
      if (owner?.token === token) relocateExactGeneration(paths.lockFile, generation.raw, 'release');
    }
  }
};

const assertCompiled = (compiled) => {
  const canonical = compileWorkflow(compiled?.plan || {});
  if (compiled?.schema_version !== 1
    || compiled.plan_digest !== canonical.plan_digest
    || canonicalJson(compiled) !== canonicalJson(canonical)) {
    throw new WorkflowContractError('Invalid compiled workflow', ['compiled plan or digest is inconsistent']);
  }
  return canonical;
};

export function writeCompiledWorkflow(sessionDir, compiled) {
  const canonical = assertCompiled(compiled);
  const paths = workflowPaths(sessionDir);
  mkdirSync(paths.directory, { recursive: true });
  fsyncDirectory(dirname(paths.directory));
  return withJournalLock(paths, () => bindCompiledWorkflow(paths, canonical));
}

const bindCompiledWorkflow = (paths, canonical) => {
  const existing = readJson(paths.planFile);
  if (existing) {
    const bound = assertCompiled(existing);
    if (bound.plan_digest !== canonical.plan_digest) {
      throw new Error('A different workflow plan is already bound to this session.');
    }
  }
  if (!existing) {
    atomicWriteJson(paths.planFile, canonical);
    fsyncDirectory(paths.directory);
  }
  return { paths, compiled: canonical };
};

export function buildWorkflowEvent(previousEvent, input) {
  if (!input || typeof input !== 'object') throw new Error('Workflow event input is required.');
  const event = {
    schema_version: 1,
    sequence: previousEvent ? previousEvent.sequence + 1 : 1,
    event_id: input.event_id || `evt-${randomUUID()}`,
    workflow_id: input.workflow_id,
    event_type: input.event_type,
    node_id: input.node_id ?? null,
    recorded_at: input.recorded_at || now(),
    previous_event_digest: previousEvent?.event_digest || null,
    payload_digest: digestValue(input.payload || {}),
    artifact_refs: [...new Set(input.artifact_refs || [])].sort(),
    worktree_fingerprint: input.worktree_fingerprint ?? null,
    producer: structuredClone(input.producer || { role: 'apex' }),
    payload: structuredClone(input.payload || {}),
  };
  event.event_digest = digestValue(event);
  assertContract('Invalid workflow event', validateWorkflowEvent(event));
  return event;
}

export function parseWorkflowJournal(journalText) {
  if (journalText === '') return [];
  const lines = journalText.endsWith('\n') ? journalText.slice(0, -1).split('\n') : journalText.split('\n');
  if (lines.some((line) => line.length === 0)) throw new Error('Workflow journal contains an empty record.');
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Workflow journal line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
}

export function replayWorkflow(compiledInput, journalInput = '') {
  const compiled = assertCompiled(compiledInput);
  const events = Array.isArray(journalInput) ? structuredClone(journalInput) : parseWorkflowJournal(journalInput);
  const eventIds = new Set();
  let state = createInitialState(compiled);
  for (const event of events) {
    if (eventIds.has(event.event_id)) throw new Error(`Duplicate workflow event_id: ${event.event_id}`);
    eventIds.add(event.event_id);
    state = reduceWorkflowEvent(compiled, state, event);
  }
  return state;
}

export function readWorkflowJournal(sessionDir, compiledInput) {
  const paths = workflowPaths(sessionDir);
  const text = existsSync(paths.journalFile) ? readFileSync(paths.journalFile, 'utf8') : '';
  const events = parseWorkflowJournal(text);
  return { paths, events, state: replayWorkflow(compiledInput, events) };
}

const appendDurably = (file, event) => {
  const descriptor = openSync(file, 'a', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(event)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncDirectory(dirname(file));
};

/**
 * Public broker/kernel integration API. The caller supplies the active session,
 * compiled v1 plan, and an unhashed event input; this function serializes,
 * validates, appends, replays, and atomically refreshes the materialized view.
 */
export class WorkflowJournalConflictError extends Error {
  constructor(expected, actual) {
    super(`Workflow journal tail changed: expected ${expected ?? 'null'}, found ${actual ?? 'null'}.`);
    this.name = 'WorkflowJournalConflictError';
    this.code = 'WORKFLOW_JOURNAL_CONFLICT';
    this.expected = expected;
    this.actual = actual;
  }
}

export function appendWorkflowEvent({
  sessionDir,
  compiled: compiledInput,
  input,
  expected_previous_event_digest,
}) {
  const compiled = assertCompiled(compiledInput);
  const paths = workflowPaths(sessionDir);
  return withJournalLock(paths, () => {
    bindCompiledWorkflow(paths, compiled);
    const before = readWorkflowJournal(sessionDir, compiled);
    if (input.event_id && before.events.some((event) => event.event_id === input.event_id)) {
      throw new Error(`Duplicate workflow event_id: ${input.event_id}`);
    }
    const previous = before.events.at(-1) || null;
    const actualPreviousDigest = previous?.event_digest || null;
    if (expected_previous_event_digest !== undefined
      && expected_previous_event_digest !== actualPreviousDigest) {
      throw new WorkflowJournalConflictError(expected_previous_event_digest, actualPreviousDigest);
    }
    const event = buildWorkflowEvent(previous, { ...input, workflow_id: compiled.plan.workflow_id });
    const state = reduceWorkflowEvent(compiled, before.state, event);
    appendDurably(paths.journalFile, event);
    atomicWriteJson(paths.stateFile, state);
    fsyncDirectory(paths.directory);
    return { event, state, paths };
  });
}

export const appendAndReduce = appendWorkflowEvent;

export function replayWorkflowSession(sessionDir) {
  const paths = workflowPaths(sessionDir);
  const compiled = readJson(paths.planFile);
  if (!compiled) throw new Error('Workflow plan is not initialized for this session.');
  const { events, state } = readWorkflowJournal(sessionDir, compiled);
  return { compiled: assertCompiled(compiled), events, state, paths };
}

export const workflowJournalLockInternals = Object.freeze({
  judgedStaleGeneration,
  relocateExactGeneration,
});
