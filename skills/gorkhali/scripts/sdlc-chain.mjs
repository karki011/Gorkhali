#!/usr/bin/env node
// Author: Subash Karki
// Dual-readable SDLC projections of canonical session JSON.
// Markdown is never parsed back into lifecycle state except parse-intent,
// which returns a draft summary for start --intent.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isMainModule, parseArgs } from './lib/portable.mjs';

const MISSING = '_Not recorded';
const INTENT_LOCATORS = [
  (task) => `.gorkhali/sdlc/${task}/intent.md`,
  (task) => `intent/${task}.md`,
];

const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const text = (value) => (isText(value) ? value.trim() : MISSING);

function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function parseIntentMarkdown(source) {
  const lines = String(source || '').split(/\r?\n/);
  let title = '';
  let author = '';
  let status = '';
  const sections = {};
  let current = null;
  const preamble = [];

  for (const line of lines) {
    const heading = line.match(/^#\s+(?:Intent:\s*)?(.+)$/i);
    if (heading && !title && !current) {
      title = heading[1].trim();
      continue;
    }
    const sub = line.match(/^##\s+(.+)$/);
    if (sub) {
      current = sub[1].trim().toLowerCase();
      sections[current] = [];
      continue;
    }
    if (!current && /^Author:/i.test(line)) {
      const statusOnLine = line.match(/Status:\s*([^.\n]+)/i);
      if (statusOnLine) status = statusOnLine[1].trim().toLowerCase();
      author = line
        .replace(/^Author:\s*/i, '')
        .replace(/\.\s*Status:.*$/i, '')
        .trim();
      continue;
    }
    const statusMatch = line.match(/^Status:\s*(.+)$/i);
    if (statusMatch && !current) {
      status = statusMatch[1].replace(/\.$/, '').trim().toLowerCase();
      continue;
    }
    if (current) sections[current].push(line);
    else if (line.trim()) preamble.push(line);
  }

  const body = (name) => (sections[name] || []).join('\n').trim();
  const problem = body('problem');
  const proposed = body('proposed outcome') || body('outcome');
  const affected = body('affected users and systems') || body('affected');
  const constraints = body('constraints');
  const openQuestions = body('open questions');
  const summaryParts = [proposed, problem].filter(isText);
  const summary = summaryParts.join(' — ') || title || preamble.join(' ').trim();

  return {
    title: title || MISSING,
    author: author || MISSING,
    status: status || 'draft',
    problem: problem || MISSING,
    proposed_outcome: proposed || MISSING,
    affected: affected || MISSING,
    constraints: constraints || MISSING,
    open_questions: openQuestions || MISSING,
    summary: isText(summary) ? summary : MISSING,
  };
}

export function locateIntentFile(workspace, task) {
  if (!isText(task)) return null;
  for (const locate of INTENT_LOCATORS) {
    const relative = locate(task);
    const absolute = join(workspace, relative);
    if (existsSync(absolute)) return { relative, absolute };
  }
  return null;
}

export function ingestIntent(workspace, task) {
  const located = locateIntentFile(workspace, task);
  if (!located) return { found: false };
  const parsed = parseIntentMarkdown(readFileSync(located.absolute, 'utf8'));
  return {
    found: true,
    relative: located.relative,
    status: parsed.status,
    summary: parsed.summary,
  };
}

function uniquePaths(plan) {
  const files = new Set();
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  for (const task of tasks) {
    if (!isObject(task) || !Array.isArray(task.files)) continue;
    for (const file of task.files) {
      if (isText(file)) files.add(file.trim());
    }
  }
  return [...files];
}

function taskOrder(plan) {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  return tasks
    .filter((task) => isObject(task) && isText(task.id))
    .map((task) => {
      const id = task.id.trim();
      const description = text(task.description);
      return description === MISSING ? id : `${id}. ${description}`;
    });
}

function riskLines(plan) {
  const risks = Array.isArray(plan?.risks) ? plan.risks : [];
  return risks
    .filter((item) => isObject(item) && (isText(item.risk) || isText(item.trigger)))
    .map((item) => text(item.risk === undefined ? item.trigger : item.risk));
}

function proofLines(plan) {
  const doneWhen = Array.isArray(plan?.outcome?.doneWhen) ? plan.outcome.doneWhen : [];
  const checks = Array.isArray(plan?.validation?.checks) ? plan.validation.checks : [];
  const lines = [...doneWhen, ...checks].filter(isText).map((item) => item.trim());
  return lines;
}

function bullet(items) {
  if (items.length === 0) return `- ${MISSING}`;
  return items.map((item) => `- ${item}`).join('\n');
}

function linkageBlock({ taskId, trackerId, commitSha }) {
  return [
    '## Linkage',
    `- Task: ${text(taskId)}`,
    `- Tracker: ${text(trackerId)}`,
    `- Commit: ${text(commitSha)}`,
    '- Canonical record: session JSON (not this file)',
  ].join('\n');
}

export function renderIntentMarkdown(session, options = {}) {
  const intent = isObject(session.intent) ? session.intent : {};
  const title = text(intent.title || session.task_id);
  const author = text(intent.author);
  const status = text(intent.status || 'active');
  const problem = text(intent.problem || intent.summary || session.intent_summary);
  const outcome = text(intent.proposed_outcome || intent.summary || session.intent_summary);
  return [
    `# Intent: ${title === MISSING ? text(session.task_id) : title}`,
    `Author: ${author}. Status: ${status}.`,
    '',
    '## Problem',
    problem,
    '',
    '## Proposed outcome',
    outcome,
    '',
    '## Affected users and systems',
    text(intent.affected),
    '',
    '## Constraints',
    text(intent.constraints),
    '',
    '## Open questions',
    text(intent.open_questions),
    '',
    linkageBlock(options),
    '',
  ].join('\n');
}

export function renderSpecMarkdown(brainstorm, options = {}) {
  if (!isObject(brainstorm)) return null;
  const approaches = Array.isArray(brainstorm.approaches) ? brainstorm.approaches : [];
  const named = approaches
    .filter((item) => isObject(item) && isText(item.name))
    .map((item) => item.name.trim());
  const concerns = Array.isArray(brainstorm.flagged_concerns) ? brainstorm.flagged_concerns : [];
  const flagged = concerns.filter(isText).map((item) => item.trim());
  return [
    `# Spec: ${text(brainstorm.title || options.taskId)}`,
    '',
    '## Recommendation',
    text(brainstorm.recommendation || brainstorm.decision?.recommendation),
    '',
    '## Approaches considered',
    bullet(named),
    '',
    '## Flagged concerns',
    bullet(flagged),
    '',
    linkageBlock(options),
    '',
  ].join('\n');
}

export function renderPlanMarkdown(plan, options = {}) {
  if (!isObject(plan)) return null;
  return [
    `# Plan: ${text(plan.title || options.taskId)}`,
    '',
    '## Files that change',
    bullet(uniquePaths(plan)),
    '',
    '## Order of work',
    bullet(taskOrder(plan)),
    '',
    '## Risks',
    bullet(riskLines(plan)),
    '',
    '## Proof',
    bullet(proofLines(plan)),
    '',
    linkageBlock(options),
    '',
  ].join('\n');
}

export function renderChain(sessionDir, options = {}) {
  const session = readJson(join(sessionDir, 'session.json')) || {};
  const intent = readJson(join(sessionDir, 'intent.json')) || {};
  const plan = readJson(join(sessionDir, 'plan.json'));
  const brainstorm = readJson(join(sessionDir, 'brainstorm.json'));
  const meta = {
    taskId: options.taskId || session.task_id || intent.task_id,
    trackerId: options.trackerId,
    commitSha: options.commitSha,
  };
  const files = {
    'intent.md': renderIntentMarkdown({ ...session, intent }, meta),
  };
  const spec = renderSpecMarkdown(brainstorm, meta);
  if (spec) files['spec.md'] = spec;
  const planMarkdown = renderPlanMarkdown(plan, meta);
  if (planMarkdown) files['plan.md'] = planMarkdown;
  return { files, meta };
}

function normalizeChanged(value) {
  if (Array.isArray(value)) return value.filter(isText).map((item) => item.trim());
  if (!isText(value)) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function planCompliance(plan, changed) {
  if (!isObject(plan)) {
    return { status: 'n/a', reason: 'no plan', planned: [], extra: [], missing: [] };
  }
  const planned = uniquePaths(plan);
  const actual = [...new Set(normalizeChanged(changed))];
  if (planned.length === 0) {
    return { status: 'n/a', reason: 'plan lists no files', planned, extra: actual, missing: [] };
  }
  const plannedSet = new Set(planned);
  const actualSet = new Set(actual);
  const extra = actual.filter((file) => !plannedSet.has(file));
  const missing = planned.filter((file) => !actualSet.has(file));
  if (actual.length === 0) {
    return { status: 'drift', planned, extra, missing, reason: 'no changed files given' };
  }
  const overlap = actual.filter((file) => plannedSet.has(file));
  if (overlap.length === 0) {
    return { status: 'wrong', planned, extra, missing };
  }
  if (extra.length || missing.length) {
    return { status: 'drift', planned, extra, missing };
  }
  return { status: 'aligned', planned, extra: [], missing: [] };
}

function writeChain(outDir, files) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [name, body] of Object.entries(files)) {
    const target = join(outDir, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    written.push(name);
  }
  return written;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const command = args._[0];
    if (command === 'parse-intent') {
      const file = args.file || args._[1];
      if (!isText(file) || !existsSync(file)) {
        throw new Error('parse-intent requires --file pointing at an existing markdown file.');
      }
      printJson(parseIntentMarkdown(readFileSync(file, 'utf8')));
      return;
    }
    if (command === 'locate-intent') {
      const located = locateIntentFile(args.workspace || process.cwd(), args.task);
      printJson(located || { relative: null, absolute: null });
      return;
    }
    if (command === 'ingest') {
      printJson(ingestIntent(args.workspace || process.cwd(), args.task));
      return;
    }
    if (command === 'render') {
      if (!isText(args.session)) throw new Error('render requires --session <dir>.');
      const chain = renderChain(args.session, {
        taskId: args.task,
        trackerId: args['tracker-id'],
        commitSha: args['commit-sha'],
      });
      const written = isText(args.out)
        ? writeChain(args.out, chain.files)
        : Object.keys(chain.files);
      printJson({ written, task: chain.meta.taskId || MISSING });
      return;
    }
    if (command === 'plan-compliance') {
      const plan = isText(args.plan)
        ? readJson(args.plan)
        : (isText(args.session) ? readJson(join(args.session, 'plan.json')) : null);
      printJson(planCompliance(plan, args.changed));
      return;
    }
    process.stderr.write(
      'Usage: sdlc-chain.mjs <parse-intent|locate-intent|ingest|render|plan-compliance>\n',
    );
    process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`sdlc-chain: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) main();
