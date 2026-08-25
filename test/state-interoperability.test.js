// Author: Subash Karki
// state-interoperability.test.js - proves the lifecycle JSON envelopes, the
// learning index/domains, brain cards, runtime telemetry, and the durable task
// pointer are interoperable across the portable (ESM gorkhali-state.mjs) and the
// Claude-side (CJS hooks/libs) runtimes: what one writes, the other reads.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, 'skills', 'gorkhali', 'scripts', 'gorkhali-state.mjs');
const DECISION_CONTRACTS = path.join(ROOT, 'skills', 'gorkhali', 'scripts', 'lib', 'decision-contracts.mjs');
const LEARNING = path.join(ROOT, 'skills', 'gorkhali', 'scripts', 'gorkhali-learning.mjs');
const SESSION_MARKER = path.join(ROOT, 'hooks', 'session-marker.js');
const brain = require(path.join(ROOT, 'scripts', 'lib', 'brain-card'));

let sequence = 0;

// ── fixtures ────────────────────────────────────────────────────────────────

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-interop-'));
  const workspace = path.join(root, 'workspace');
  const data = path.join(root, 'data');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'planning.md'), '# Existing planning context\n');
  // A stable remote-backed repo id, identical for the portable path and the hooks.
  execFileSync('git', ['-C', workspace, 'init', '-q']);
  execFileSync('git', ['-C', workspace, 'remote', 'add', 'origin', 'git@github.com:org/interop.git']);
  // Pre-mark migration as done so session-marker never copies real user state in.
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, '.data-root-migrated-v2'), 'done\n');
  fs.writeFileSync(path.join(data, '.repo-dirs-migrated'), 'done\n');
  return { root, workspace, data, env: { GORKHALI_DATA: data } };
}

function treeSnapshot(root) {
  const snapshot = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file);
      if (entry.isDirectory()) visit(file);
      else snapshot[relative] = fs.readFileSync(file).toString('base64');
    }
  };
  visit(root);
  return snapshot;
}

function runState(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STATE, ...args, '--json'], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function ok(result) {
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function recordGazeDelegation(ctx, runId) {
  const { delegationTaskDigest } = await import(pathToFileURL(DECISION_CONTRACTS).href);
  const task = {
    contract_version: 2,
    task_id: `auditor-${runId}`,
    delegation_id: `auditor-${runId}-attempt-1`,
    role: 'auditor',
    profile: 'deep',
    risk: 'moderate',
    requires_judgment: true,
    objective: 'Independently review the verified work',
    locked_decisions: [], corrections: [], constraints: [],
    deliverables: ['Review verdict'],
    acceptance_criteria: ['Review completes'],
    write_scope: [], context_refs: [],
  };
  const taskInput = path.join(ctx.root, `${runId}-auditor-task.json`);
  fs.writeFileSync(taskInput, JSON.stringify(task));
  ok(await runState([
    'record', '--workspace', ctx.workspace, '--type', 'delegation-task',
    '--status', 'pending', '--run', runId, '--input', taskInput,
  ], ctx.env));
  const result = {
    contract_version: 2,
    task_id: task.task_id,
    delegation_id: task.delegation_id,
    task_digest: delegationTaskDigest(task),
    status: 'ok',
    output: {
      summary: 'Independent review complete', files_changed: [], checks: [{
        name: 'user-verification-classification',
        status: 'passed',
        summary: 'The final diff is correctly classified for user verification',
      }],
      findings: [], risks: [], blocker: null,
    },
    error: null,
  };
  const resultInput = path.join(ctx.root, `${runId}-auditor-result.json`);
  fs.writeFileSync(resultInput, JSON.stringify(result));
  ok(await runState([
    'record', '--workspace', ctx.workspace, '--type', 'delegation-result',
    '--status', 'passed', '--run', runId, '--input', resultInput,
  ], ctx.env));
}

async function recordArtifact(ctx, type, payload, { status = 'passed', run } = {}) {
  sequence += 1;
  if (type === 'review') await recordGazeDelegation(ctx, run);
  const input = path.join(ctx.root, `${type}-${sequence}.json`);
  fs.writeFileSync(input, JSON.stringify(payload));
  const args = ['record', '--workspace', ctx.workspace, '--type', type, '--status', status, '--input', input];
  if (run) args.push('--run', run);
  if (type === 'review') args.push('--role', 'auditor');
  return ok(await runState(args, ctx.env));
}

// Minimal contract-valid v3 payloads (mirrors test/portable-lifecycle.test.js).
const portablePlan = () => ({
  contract_version: 3,
  depth: 'quick',
  summary: 'Reviewers need the decision before its execution details. Lead with the researched direction, preserve the compact evidence, and generate the offline review from canonical JSON. The result is a decision-useful review without architecture-grade filler.',
  problem: 'Reviewers need to understand the decision before execution tasks',
  decision: {
    question: 'Use decision-first review output?',
    recommendation: 'Lead with the researched direction',
    rationale: ['It makes approval informed and fast'],
    status: 'pending',
  },
  outcome: { goal: 'A decision-useful review', doneWhen: ['The recommendation precedes tasks'] },
  scope: { in: ['Review output'], out: [], constraints: ['Offline HTML'] },
  scenarios: [],
  evidence: [{
    claim: 'Task-first output hid the rationale',
    source: 'user correction',
    status: 'verified',
    observed_at: '2026-07-19T12:00:00Z',
    confidence: 1,
    conflicts: [],
  }],
  alternatives: [],
  assumptions: [],
  open_questions: [],
  risks: [],
  validation: {
    strategy: 'Render and inspect the saved artifact',
    definitionOfDone: ['Decision-first HTML is generated'],
    checks: ['node --test test/state-interoperability.test.js'],
  },
  coverage: [],
  tasks: [{
    id: 'T1',
    description: 'Generate the review',
    action: 'Render the recorded plan envelope',
    read_first: ['planning.md'],
    files: ['plan.html'],
    new_files: ['plan.html'],
    acceptance_criteria: ['Decision brief appears before execution appendix'],
    verify: 'node --test test/state-interoperability.test.js',
    profile: 'economy',
  }],
});

const portableApproach = (id, name) => ({
  id,
  name,
  thesis: `${name} thesis`,
  description: `${name} description`,
  whyLens: 'decision clarity',
  effort: 'low',
  risk: 'low',
  reversibility: 'high',
  whatBreaks: ['The review contract must be revised'],
  whenToPick: 'Pick when it best meets the criteria',
});

const portableBrainstorm = () => ({
  contract_version: 3,
  depth: 'quick',
  stance: { mode: 'creative-partner', reason: 'The user owns the outcome while the agent develops alternatives' },
  phase: 'decision',
  decision: {
    question: 'How should review output be organized?',
    outcome: 'Fast informed approval',
    audience: ['Maintainers'],
    nonGoals: [],
    constraints: ['Offline HTML'],
    evaluationCriteria: ['Decision clarity'],
  },
  evidence: [{
    claim: 'Recommendation must lead',
    source: 'user correction',
    status: 'verified',
    observed_at: '2026-07-19T12:00:00Z',
    confidence: 1,
    conflicts: [],
  }],
  openQuestions: [],
  ideas: [
    { id: 'I1', title: 'Decision-first review', summary: 'Lead with the recommendation and evidence', lens: 'reviewer', technique: 'outcome-backward', evidence: ['The recommendation must lead'], assumptions: [] },
    { id: 'I2', title: 'Task-first review', summary: 'Lead with execution mechanics', lens: 'implementer', technique: 'simplest-path', evidence: ['Tasks are directly actionable'], assumptions: [] },
  ],
  clusters: [],
  approaches: [portableApproach('decision-first', 'Decision first'), portableApproach('task-first', 'Task first')],
  recommendedDefault: { id: 'decision-first', reason: 'It supports informed approval' },
  shortlist: [
    { approachId: 'decision-first', drivers: ['Decision clarity'], reservation: 'More review structure' },
    { approachId: 'task-first', drivers: ['Speed'], reservation: 'Hides rationale' },
  ],
  cheapestExperiment: { question: 'Can the reviewer find the recommendation first?', method: 'Render the saved artifact', successSignal: 'Recommendation appears before comparison', cost: 'One render' },
  directionGate: { question: 'Which direction should be used?', options: ['decision-first', 'task-first'] },
});

// Envelopes are readable by a plain-JSON (Claude-side) reader; assert the shared
// version-1 contract and that the workflow payload unwraps from `evidence`.
function assertEnvelope(file, type, ctx, taskId) {
  const raw = fs.readFileSync(file, 'utf8');
  const envelope = JSON.parse(raw);
  assert.equal(envelope.schema_version, 1, `${type} schema_version`);
  assert.equal(envelope.artifact_type, type, `${type} artifact_type`);
  assert.equal(envelope.task_id, taskId, `${type} task_id`);
  assert.ok(typeof envelope.repo_id === 'string' && envelope.repo_id, `${type} repo_id`);
  assert.ok(envelope.created_at && envelope.updated_at, `${type} timestamps`);
  return envelope;
}

// ── tests ────────────────────────────────────────────────────────────────────

test('portable-written lifecycle envelopes are readable by a Claude-side JSON reader across all artifact classes', async () => {
  const ctx = fixture();
  const common = ['--workspace', ctx.workspace];
  const taskId = 'INTEROP-1';

  const started = ok(await runState([
    'start', ...common, '--task', taskId, '--intent', 'Prove cross-runtime state', '--route', 'full',
  ], ctx.env));
  const repoId = started.repo_id;
  const sessionDir = path.join(ctx.data, 'repos', repoId, 'sessions', taskId);

  // sessions + intent
  assertEnvelope(path.join(sessionDir, 'session.json'), 'session', ctx, taskId);
  assertEnvelope(path.join(sessionDir, 'intent.json'), 'intent', ctx, taskId);

  // durable task pointer (portable pointer, not telemetry)
  const pointer = JSON.parse(fs.readFileSync(path.join(ctx.data, 'state', 'current-session', `${repoId}.json`), 'utf8'));
  assert.equal(pointer.schema_version, 2);
  assert.equal(pointer.focus_task_id, taskId);
  assert.equal(pointer.repo_id, repoId);
  assert.equal(pointer.tasks[taskId].session_dir, sessionDir);

  // context
  await recordArtifact(ctx, 'context', {}, { status: 'pending' });
  const context = assertEnvelope(path.join(sessionDir, 'context.json'), 'context', ctx, taskId);
  assert.deepEqual(context.evidence, {});

  // brainstorm + direction approval
  const brainstorm = await recordArtifact(ctx, 'brainstorm', portableBrainstorm());
  assert.deepEqual(assertEnvelope(brainstorm.file, 'brainstorm', ctx, taskId).evidence, portableBrainstorm());
  ok(await runState(['approve', ...common, '--gate', 'direction'], ctx.env));

  // plan + plan approval
  const plan = await recordArtifact(ctx, 'plan', portablePlan());
  assert.deepEqual(assertEnvelope(plan.file, 'plan', ctx, taskId).evidence, portablePlan());
  ok(await runState(['approve', ...common, '--gate', 'plan'], ctx.env));

  // decisions + wiring approval
  const decisions = await recordArtifact(ctx, 'decisions', { wiring: 'Use the approved plan dependency order.' });
  assert.equal(assertEnvelope(decisions.file, 'decisions', ctx, taskId).evidence.wiring, 'Use the approved plan dependency order.');
  ok(await runState(['approve', ...common, '--gate', 'wiring'], ctx.env));

  // authorize + execute
  ok(await runState(['authorize', ...common, '--scope', 'implementation'], ctx.env));
  ok(await runState(['execute', ...common], ctx.env));

  // verification + review (run artifacts)
  const verification = await recordArtifact(ctx, 'verification', {
    checks: [{ name: 'unit', result: 'passed' }],
    requiredSpecialists: [],
    userVerification: { required: false },
  }, { run: 'run-1' });
  assertEnvelope(verification.file, 'verification', ctx, taskId);
  const review = await recordArtifact(ctx, 'review', {
    verdict: 'pass',
    findings: [],
    specialists: [],
  }, { run: 'run-1' });
  assertEnvelope(review.file, 'review', ctx, taskId);

  // wrap (run artifact)
  const wrap = await recordArtifact(ctx, 'wrap', { summary: 'Shipped' }, { run: 'run-1' });
  assertEnvelope(wrap.file, 'wrap', ctx, taskId);

  // pause / resume transitions persist on the session envelope
  const paused = ok(await runState(['pause', ...common, '--reason', 'Context boundary'], ctx.env));
  assert.equal(paused.status, 'paused');
  const resumed = ok(await runState(['resume', ...common], ctx.env));
  assert.equal(resumed.status, 'active');

  // authorize ship + ship + complete (the "close" class: archived, never deleted)
  ok(await runState(['authorize', ...common, '--scope', 'ship-pr'], ctx.env));
  ok(await runState(['ship', ...common], ctx.env));
  const completed = ok(await runState(['complete', ...common], ctx.env));
  assert.equal(completed.status, 'completed');
  const completedDir = path.join(ctx.data, 'repos', repoId, 'completed', taskId);
  assert.ok(fs.existsSync(completedDir), 'session archived to completed');
  assert.equal(fs.existsSync(sessionDir), false, 'active session dir moved, not left behind');
  assertEnvelope(path.join(completedDir, 'session.json'), 'session', ctx, taskId);
});

test('a Claude-authored legacy top-level session is readable by the portable path', async () => {
  const ctx = fixture();
  const common = ['--workspace', ctx.workspace];
  const started = ok(await runState([
    'start', ...common, '--task', 'LEGACY-INTEROP', '--intent', 'Recover legacy state', '--route', 'direct',
  ], ctx.env));
  const sessionFile = path.join(ctx.data, 'repos', started.repo_id, 'sessions', 'LEGACY-INTEROP', 'session.json');

  // Rewrite as a legacy artifact: drop the lifecycle object, put plan-only mode
  // at the TOP LEVEL the way an older Claude-side writer did.
  const legacy = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  delete legacy.lifecycle;
  legacy.to_plan = true;
  fs.writeFileSync(sessionFile, JSON.stringify(legacy));

  const before = treeSnapshot(ctx.data);
  const recovered = ok(await runState(['status', ...common], ctx.env));
  assert.equal(recovered.lifecycle.mode, 'to-plan', 'portable path unwraps legacy top-level mode');
  assert.equal(recovered.lifecycle.authorizations.implementation.status, 'pending');
  assert.deepEqual(treeSnapshot(ctx.data), before, 'legacy inspection must not rewrite or migrate state');
});

test('legacy completed sessions remain readable without mutation', async () => {
  const ctx = fixture();
  const common = ['--workspace', ctx.workspace];
  const started = ok(await runState([
    'start', ...common, '--task', 'LEGACY-COMPLETE', '--intent', 'Inspect completed legacy state', '--route', 'direct',
  ], ctx.env));
  const repoRoot = path.join(ctx.data, 'repos', started.repo_id);
  const activeDirectory = path.join(repoRoot, 'sessions', 'LEGACY-COMPLETE');
  const completedDirectory = path.join(repoRoot, 'completed', 'LEGACY-COMPLETE');
  const sessionFile = path.join(activeDirectory, 'session.json');
  const pointerFile = path.join(ctx.data, 'state', 'current-session', `${started.repo_id}.json`);
  const legacy = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  delete legacy.lifecycle;
  legacy.status = 'completed';
  fs.writeFileSync(sessionFile, JSON.stringify(legacy));
  fs.mkdirSync(path.dirname(completedDirectory), { recursive: true });
  fs.renameSync(activeDirectory, completedDirectory);
  // A genuine version-1 scalar pointer, as an older (pre-multi-task) install
  // would have left behind - not the current version-2 shape.
  fs.writeFileSync(pointerFile, JSON.stringify({
    schema_version: 1,
    repo_id: started.repo_id,
    task_id: 'LEGACY-COMPLETE',
    session_dir: completedDirectory,
    updated_at: new Date().toISOString(),
  }));

  const before = treeSnapshot(ctx.data);
  const recovered = ok(await runState(['status', ...common], ctx.env));
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.lifecycle.mode, 'standard');
  assert.deepEqual(treeSnapshot(ctx.data), before, 'completed legacy inspection must be read-only');
});

test('unsupported or missing session schema representations fail closed without mutation', async () => {
  const ctx = fixture();
  const common = ['--workspace', ctx.workspace];
  const started = ok(await runState([
    'start', ...common, '--task', 'FUTURE-SCHEMA', '--intent', 'Reject unknown state', '--route', 'direct',
  ], ctx.env));
  const sessionFile = path.join(
    ctx.data, 'repos', started.repo_id, 'sessions', 'FUTURE-SCHEMA', 'session.json',
  );
  const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  for (const unsupported of ['2', 1.5, 0, null, 2, undefined]) {
    const candidate = { ...session, schema_version: unsupported };
    if (unsupported === undefined) delete candidate.schema_version;
    fs.writeFileSync(sessionFile, JSON.stringify(candidate));
    const before = treeSnapshot(ctx.data);
    const result = await runState(['status', ...common], ctx.env);
    assert.equal(result.code, 1, `schema ${JSON.stringify(unsupported)} must fail closed`);
    assert.match(result.stderr, /Unsupported Gorkhali session schema version/);
    assert.deepEqual(treeSnapshot(ctx.data), before, 'failed inspection must not rewrite unsupported state');
  }
});

test('Claude session telemetry cannot overwrite the durable portable task pointer (hook after start)', async () => {
  const ctx = fixture();
  const common = ['--workspace', ctx.workspace];
  const started = ok(await runState([
    'start', ...common, '--task', 'POINTER-1', '--intent', 'Protect the durable pointer', '--route', 'direct',
  ], ctx.env));
  const repoId = started.repo_id;
  const pointerFile = path.join(ctx.data, 'state', 'current-session', `${repoId}.json`);
  const before = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
  assert.equal(before.focus_task_id, 'POINTER-1');
  assert.ok(before.tasks['POINTER-1'], 'pointer tracks the started task');

  // Fire the UserPromptSubmit hook the way Claude Code does: session_id on stdin.
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SESSION_MARKER], { env: { ...process.env, ...ctx.env } });
    child.on('error', reject);
    child.on('close', () => resolve());
    child.stdin.end(JSON.stringify({ session_id: 'claude-session-42', cwd: ctx.workspace }));
  });

  // The durable pointer is byte-for-byte unchanged: telemetry landed elsewhere.
  const after = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
  assert.deepEqual(after, before, 'durable task pointer untouched by telemetry write');
  assert.equal(after.focus_task_id, 'POINTER-1');

  const telemetry = JSON.parse(fs.readFileSync(
    path.join(ctx.data, 'state', 'session-telemetry', `${repoId}.json`), 'utf8',
  ));
  assert.equal(telemetry.session_id, 'claude-session-42');
  assert.ok(!('task_id' in telemetry), 'telemetry carries runtime session id, not the task pointer');
});

test('learning index/domains written via the canonical API are readable by both runtimes and survive concurrent writers', async () => {
  const ctx = fixture();
  const learnings = path.join(ctx.data, 'repos', 'interop', 'learnings');

  // Real concurrent processes, each contributing a distinct entry.
  const writers = 8;
  await Promise.all(Array.from({ length: writers }, (_, i) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [LEARNING, 'capture', '--learnings', learnings], {
      env: { ...process.env, ...ctx.env },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`writer ${i} exited ${code}`))));
    child.stdin.end(JSON.stringify([{ dedup_key: `k${i}`, entry: `concurrent lesson number ${i}`, confidence: 0.5, domain: 'workflow' }]));
  })));

  // Every entry survived - no writer clobbered another (locked, never unlocked).
  const indexContent = fs.readFileSync(path.join(learnings, 'INDEX.md'), 'utf8');
  const autoContent = fs.readFileSync(path.join(learnings, 'auto-captures.md'), 'utf8');
  for (let i = 0; i < writers; i += 1) {
    assert.match(indexContent, new RegExp(`concurrent lesson number ${i}\\b`), `INDEX keeps entry ${i}`);
    assert.match(autoContent, new RegExp(`concurrent lesson number ${i}\\b`), `auto-captures keeps entry ${i}`);
  }

  // The index remains valid (every auto line is well-formed) - the portable
  // validator and the Claude-side check-learnings-index agree on the format.
  const autoLines = indexContent.split('\n').filter((l) => l.trim().startsWith('auto:'));
  assert.equal(autoLines.length, writers, 'exactly one line per distinct entry');
  for (const line of autoLines) {
    assert.match(line, /^auto: .+ \[(proposed|validated:\d+|failed)\] v:\d+ q:[\d.]+ u:\d{4}-\d{2}-\d{2}$/);
  }

  // The consolidate policy reads the same index the capture policy wrote.
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [LEARNING, 'consolidate', '--learnings', learnings], {
      env: { ...process.env, ...ctx.env }, stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`consolidate exited ${code}`))));
    child.stdin.end(JSON.stringify([{ entry: 'a consolidated high-confidence pattern', confidence: 0.9 }]));
  });
  const afterConsolidate = fs.readFileSync(path.join(learnings, 'INDEX.md'), 'utf8');
  assert.match(afterConsolidate, /a consolidated high-confidence pattern \[validated:1\]/);
});

test('INDEX.md content below Auto-Captured (operator notes, a custom section) survives a capture/consolidate round-trip byte-for-byte', () => {
  const ctx = fixture();
  const learnings = path.join(ctx.data, 'repos', 'interop', 'learnings');
  fs.mkdirSync(learnings, { recursive: true });
  // rebuildIndex is called on every capture/consolidate write, whether or not the
  // auto entries change -- if it only preserved preamble + auto lines, this
  // freeform tail would be silently dropped on the very first write.
  const trailing = '## Operator Notes\n\nDo not hand-edit the Auto-Captured section above.\n';
  const seeded = `# Learnings\n\n## Auto-Captured\n\nauto: seeded lesson [validated:1] v:1 q:0.5 u:2026-07-01\n\n${trailing}`;
  fs.writeFileSync(path.join(learnings, 'INDEX.md'), seeded);

  execFileSync(process.execPath, [LEARNING, 'capture', '--learnings', learnings], {
    input: JSON.stringify([{ dedup_key: 'k-trailing', entry: 'a captured lesson', confidence: 0.6, domain: 'workflow' }]),
    env: { ...process.env, ...ctx.env }, stdio: ['pipe', 'ignore', 'ignore'],
  });

  let indexContent = fs.readFileSync(path.join(learnings, 'INDEX.md'), 'utf8');
  assert.ok(indexContent.endsWith(trailing), 'operator notes below Auto-Captured survive capture, byte-for-byte');
  assert.match(indexContent, /a captured lesson/, 'the new capture is still recorded');

  execFileSync(process.execPath, [LEARNING, 'consolidate', '--learnings', learnings], {
    input: JSON.stringify([{ entry: 'a consolidated pattern', confidence: 0.9 }]),
    env: { ...process.env, ...ctx.env }, stdio: ['pipe', 'ignore', 'ignore'],
  });

  indexContent = fs.readFileSync(path.join(learnings, 'INDEX.md'), 'utf8');
  assert.ok(indexContent.endsWith(trailing), 'operator notes survive a second write (consolidate), byte-for-byte');
  assert.match(indexContent, /a consolidated pattern \[validated:1\]/, 'the consolidated entry is recorded');
});

// ── deterministic single-winner takeover: drive the primitives directly ──────
// These force the exact interleaving the check-then-unlink bug got wrong, so the
// single-winner guarantee is PROVEN, not sampled. The multi-process test below can
// only observe it probabilistically (process startup jitter rarely lines up a true
// simultaneous stampede), so these are the real regression guard.

test('two contenders that judge the SAME stale learning lock -> exactly one wins the takeover', async () => {
  const { _internals } = await import(pathToFileURL(LEARNING).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-lock-'));
  const lock = path.join(dir, '.learning.lock');
  try {
    // A dead-pid lock is judged stale immediately. Both contenders read the SAME
    // generation bytes -- the exact precondition the old check-then-unlink mishandled.
    // The pid is one no platform can assign, so it stays dead for the whole test
    // (a just-exited pid can be recycled under load).
    const deadPid = 0x3fffffff;
    const seed = `${JSON.stringify({ pid: deadPid, token: 'seeded' })}\n`;
    fs.writeFileSync(lock, seed);

    const judgedA = _internals.judgeStaleLock(lock);
    const judgedB = _internals.judgeStaleLock(lock);
    assert.equal(judgedA, seed, 'A judged the seed stale (dead pid)');
    assert.equal(judgedB, seed, 'B judged the SAME generation stale');

    const rA = _internals.takeoverStaleLock(lock, judgedA); // A relocates the seed -> won
    const rB = _internals.takeoverStaleLock(lock, judgedB); // path already empty -> lost
    assert.deepEqual([rA, rB].filter((r) => r === 'won'), ['won'], 'exactly one contender wins');
    assert.equal(rB, 'lost', 'the loser gets ENOENT, never a second takeover');
    assert.ok(!fs.existsSync(lock), 'the stale generation is gone (winner will recreate)');
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.stale.')), [], 'no stale artifact leaks');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('takeover NEVER clobbers a FRESH live lock recreated after the judgment', async () => {
  const { _internals } = await import(pathToFileURL(LEARNING).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-lock-'));
  const lock = path.join(dir, '.learning.lock');
  try {
    // Never-assignable pid: dead for the whole test, no recycling lottery.
    const deadPid = 0x3fffffff;
    const seed = `${JSON.stringify({ pid: deadPid, token: 'seeded' })}\n`;
    fs.writeFileSync(lock, seed);
    const judged = _internals.judgeStaleLock(lock);

    // A winner took over and recreated a FRESH live lock between our judgment and our
    // rename. Byte confirmation must detect the mismatch and restore it un-clobbered.
    const fresh = `${JSON.stringify({ pid: process.pid, token: 'fresh-live' })}\n`;
    fs.writeFileSync(lock, fresh);

    const r = _internals.takeoverStaleLock(lock, judged);
    assert.notEqual(r, 'won', 'must not take over a generation it did not judge');
    assert.equal(fs.readFileSync(lock, 'utf8'), fresh, 'the fresh live lock is restored, not clobbered');
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.stale.')), [], 'no stale artifact leaks');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('takeover of an already-empty lock path -> lost (another contender got there first)', async () => {
  const { _internals } = await import(pathToFileURL(LEARNING).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorkhali-lock-'));
  try {
    const r = _internals.takeoverStaleLock(path.join(dir, '.learning.lock'), 'anything');
    assert.equal(r, 'lost', 'a vanished lock is nothing to break');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent writers racing a STALE learning lock do not double-hold (single-winner reclaim)', async () => {
  const ctx = fixture();
  const learnings = path.join(ctx.data, 'repos', 'interop', 'learnings');
  fs.mkdirSync(learnings, { recursive: true });

  // spawnSync returns after the child exits, so its pid is dead AT SEED TIME — but
  // a just-exited pid is only PROBABILISTICALLY dead: under load (the full suite
  // spawning hundreds of processes) the OS can reassign it to a live process before
  // the stampede reads it, and then the seed is never judged stale, every worker
  // burns its whole lock budget, and the test fails without anything being wrong
  // with the lock. The seed owner must be dead FOR THE DURATION, so it is a pid no
  // platform can assign (macOS max 99999, Linux pid_max <= 2^22): process.kill
  // probes it ESRCH always, and the stale-by-pid path this test exercises is
  // identical to a recycled one.
  //
  // The OLD check-then-unlink reclaim let writer B unlink writer A's FRESH lock after
  // A reclaimed, so BOTH entered the critical section and B's read-modify-write
  // clobbered A's entry -- an N-way stampede lost SEVERAL entries. The single-winner
  // rename takeover (renameSync moves the inode atomically; only the winner recreates,
  // losers get ENOENT and back off; a relocated fresh lock is byte-confirmed and
  // restored) collapses that to at most the ONE irreducible residual pure-POSIX
  // advisory locking cannot close (a third contender claiming the momentarily-empty
  // path during a repair) -- the exact bound atomic.test.js documents and tolerates.
  const deadPid = 0x3fffffff;
  fs.writeFileSync(
    path.join(learnings, '.learning.lock'),
    `${JSON.stringify({ pid: deadPid, token: 'seeded', created_at: new Date().toISOString() })}\n`,
  );

  const WORKERS = 8;
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [LEARNING, 'capture', '--learnings', learnings], {
      env: { ...process.env, ...ctx.env },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`writer ${i} exited ${code}`))));
    child.stdin.end(JSON.stringify([{ dedup_key: `sr-${i}`, entry: `stale reclaim lesson writer ${i}`, confidence: 0.5, domain: 'workflow' }]));
  })));

  const indexContent = fs.readFileSync(path.join(learnings, 'INDEX.md'), 'utf8');
  const autoContent = fs.readFileSync(path.join(learnings, 'auto-captures.md'), 'utf8');
  const autoLines = indexContent.split('\n').filter((l) => l.trim().startsWith('auto:'));

  // Distinct entries can never be over-counted (a real invariant); the old N-way
  // double-break lost several, so surviving all-but-at-most-one proves single-winner.
  assert.ok(autoLines.length <= WORKERS, `never more than the true total (got ${autoLines.length} > ${WORKERS})`);
  assert.ok(
    autoLines.length >= WORKERS - 1,
    `single-winner reclaim preserved all but at most the one irreducible residual (got ${autoLines.length}, expected >= ${WORKERS - 1})`,
  );

  // Whatever survived is well-formed and present in BOTH files (no torn/unlocked write).
  for (const line of autoLines) {
    assert.match(line, /^auto: .+ \[(proposed|validated:\d+|failed)\] v:\d+ q:[\d.]+ u:\d{4}-\d{2}-\d{2}$/);
    const entry = line.slice('auto: '.length, line.indexOf(' ['));
    assert.match(autoContent, new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `auto-captures keeps "${entry}"`);
  }

  // Takeover renames the stale lockfile aside then deletes it -- none may leak.
  const staleLeftovers = fs.readdirSync(learnings).filter((f) => f.includes('.learning.lock.stale.'));
  assert.deepEqual(staleLeftovers, [], 'renamed stale lockfiles are cleaned up, not orphaned');
});

test('capture graduates a repeated lesson into its domain file, readable as plain Markdown', async () => {
  const ctx = fixture();
  const learnings = path.join(ctx.data, 'repos', 'interop', 'learnings');
  const candidate = [{ dedup_key: 'grad', entry: 'graduate me after five', confidence: 0.9, domain: 'workflow' }];
  for (let i = 0; i < 6; i += 1) {
    execFileSync(process.execPath, [LEARNING, 'capture', '--learnings', learnings], {
      input: JSON.stringify(candidate), env: { ...process.env, ...ctx.env }, stdio: ['pipe', 'ignore', 'ignore'],
    });
  }
  const domainFile = path.join(learnings, 'workflow.md');
  assert.ok(fs.existsSync(domainFile), 'graduated to a domain file');
  const domain = fs.readFileSync(domainFile, 'utf8');
  assert.match(domain, /## Validated Patterns/);
  assert.match(domain, /graduate me after five \[validated:\d+\]/);
  // Once graduated it leaves the staging file.
  assert.doesNotMatch(fs.readFileSync(path.join(learnings, 'auto-captures.md'), 'utf8'), /graduate me after five/);
});

test('brain cards written by the Claude-side lib stay grep-retrievable and round-trip as plain Markdown', () => {
  const ctx = fixture();
  const saved = process.env.GORKHALI_DATA;
  process.env.GORKHALI_DATA = ctx.data;
  try {
    const { id, file } = brain.writeCard({
      ticket: 'INTEROP-CARD',
      title: 'Interop: cards remain greppable',
      type: 'decision',
      date: '2026-07-23',
      files: ['skills/gorkhali/scripts/gorkhali-learning.mjs'],
      edges: [{ relates_to: 'rb-000abc' }],
      trace: { session: '/tmp/s', transcript: '', pr: '', commit: '' },
      what: 'Unified the learning API.',
      why: 'One locked write path; rejected per-hook locks.',
      gotchas: 'Never write the index unlocked.',
    }, { repo: 'interop' });

    // Portable-runtime read #1: flat, grep-friendly frontmatter (one key per line).
    const rawCard = fs.readFileSync(file, 'utf8');
    assert.match(rawCard, new RegExp(`^ticket: INTEROP-CARD$`, 'm'));
    assert.match(rawCard, new RegExp(`^type: decision$`, 'm'));
    assert.match(rawCard, /^\s+- skills\/gorkhali\/scripts\/gorkhali-learning\.mjs$/m);

    // Claude-side read #2: the lib round-trips its own write.
    const parsed = brain.readCard('interop', id);
    assert.equal(parsed.ticket, 'INTEROP-CARD');
    assert.equal(parsed.why, 'One locked write path; rejected per-hook locks.');
  } finally {
    if (saved === undefined) delete process.env.GORKHALI_DATA;
    else process.env.GORKHALI_DATA = saved;
  }
});

test('global patterns are plain Markdown readable by any runtime', () => {
  const ctx = fixture();
  const patternsDir = path.join(ctx.data, 'global', 'patterns');
  fs.mkdirSync(patternsDir, { recursive: true });
  const file = path.join(patternsDir, 'structural-over-prose.md');
  fs.writeFileSync(file, '# Structural over prose\n\n- Enforce with code, not reminders. [scope:global]\n');
  assert.match(fs.readFileSync(file, 'utf8'), /\[scope:global\]/);
});
